import "server-only";
import { sql } from "drizzle-orm";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { givingKeysInTx } from "./keys";
import { rowsOf } from "./db-util";
import {
  DONOR_CONTACT_FIELDS,
  normalizeDonorQuery,
  type CreateDonorValues,
  type DonorContactField,
  type UpdateDonorContactValues,
} from "./donor-input";
import {
  listLinkSuggestions,
  proposalsForDonor,
  type LinkProposal,
  type LinkSuggestion,
} from "./link-proposals";

/**
 * Donors: search, list, detail, create, contact edits, merge, and the member
 * link - docs/work-log/2026-10-15-online-giving.md, Phase 3 API contract
 * "Admin - donors" and the S4 scope ruling (P3-4).
 *
 * WHO MAY DO WHAT (re-checked inside every function):
 *   searchDonors                    giving.record OR giving.view
 *   listDonors / getDonor           giving.view
 *   getDonorReduced                 giving.record (the S4 variant: a name, a
 *                                   kind and the link proposal - never the
 *                                   email, address, gifts or totals)
 *   createDonor                     giving.record
 *   confirmLink / dismissLink /
 *   removeLink                      giving.record
 *   updateDonorContact / mergeDonors giving.manage
 *
 * A donor is the book's record of a GIVER, not a login and not a person row:
 * `giving_donors` has no `person_id`. The optional link is a composite
 * reference to a `memberships` row, and what it does is make that member's
 * giving history visible to that member (and to nobody else). That is why a
 * link is only ever CONFIRMED from a computed proposal (never from a bare id a
 * caller supplies), why the dialog names the person, and why every link, unlink
 * and dismissal is audited by the action that calls these functions.
 *
 * A merge never touches gifts (no UPDATE grant exists): merged donors point at
 * the survivor through the flat `merged_into_id`, and every read goes through
 * the root. Depth stays 1 because dependents are repointed first and the whole
 * merge runs under a per-organization advisory lock (the trigger's own comment
 * names this as the app's half of the guarantee).
 */

// ---------------------------------------------------------------------------
// searchDonors (the picker)
// ---------------------------------------------------------------------------

export interface DonorPickerRow {
  id: string;
  displayName: string;
  kind: "identified" | "unidentified";
  /** A boolean only - the picker never shows (or ships) the address itself. */
  hasEmail: boolean;
}

export type SearchDonorsResult =
  | { kind: "ok"; donors: DonorPickerRow[] }
  | { kind: "forbidden" };

/**
 * At most 20 donors whose NAME matches `q` (case-insensitive substring), as
 * `{ id, displayName, kind, hasEmail }`. Matching is on the name alone, so the
 * result can never confirm that a given email exists in the book. An empty
 * query returns the first 20 alphabetically. Merged donors are never offered.
 */
export async function searchDonors(
  personId: string,
  organizationId: string,
  q: string,
): Promise<SearchDonorsResult> {
  const { pattern, text } = normalizeDonorQuery(q);
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.record && !has.view) return { kind: "forbidden" };
    const result = await tx.execute(sql`
      select id, display_name, kind, (email is not null) as has_email
        from giving_donors
       where organization_id = ${organizationId}::uuid and merged_into_id is null
         and (${text} = '' or display_name ilike ${pattern} escape '\\')
       order by (kind = 'unidentified') desc, lower(display_name) asc, id asc
       limit 20
    `);
    return {
      kind: "ok",
      donors: rowsOf(result).map(
        (r): DonorPickerRow => ({
          id: String(r.id),
          displayName: String(r.display_name),
          kind: r.kind as DonorPickerRow["kind"],
          hasEmail: r.has_email === true,
        }),
      ),
    };
  });
}

// ---------------------------------------------------------------------------
// listDonors
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

export interface DonorListRow {
  id: string;
  displayName: string;
  kind: "identified" | "unidentified";
  email: string | null;
  /** "City, ST" or null. */
  location: string | null;
  /** The linked member's name, or null when unlinked. */
  linkedMemberName: string | null;
}

export type ListDonorsResult =
  | { kind: "ok"; donors: DonorListRow[]; nextCursor: string | null }
  | { kind: "forbidden" };

function encodeDonorCursor(row: { displayName: string; id: string }): string {
  return Buffer.from(JSON.stringify([row.displayName.toLowerCase(), row.id])).toString("base64url");
}

function decodeDonorCursor(cursor: string | undefined): { name: string; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === "string" &&
      typeof parsed[1] === "string" &&
      /^[0-9a-f-]{36}$/i.test(parsed[1])
    ) {
      return { name: parsed[0], id: parsed[1] };
    }
  } catch {
    // A tampered cursor is page one, never an error.
  }
  return null;
}

/** Donors a-z, 50 per page, with their linked member's name. `giving.view`. */
export async function listDonors(
  personId: string,
  organizationId: string,
  input: { q?: string; cursor?: string } = {},
): Promise<ListDonorsResult> {
  const { pattern, text } = normalizeDonorQuery(input.q ?? "");
  const cursor = decodeDonorCursor(input.cursor);
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.view) return { kind: "forbidden" };

    const result = await tx.execute(sql`
      select d.id, d.display_name, d.kind, d.email, d.city, d.region,
             case when d.linked_membership_id is null then null
                  else btrim(concat_ws(' ', coalesce(nullif(p.preferred_name, ''), p.first_name), p.last_name)) end as linked_name
        from giving_donors d
        left join memberships m on m.id = d.linked_membership_id and m.organization_id = d.organization_id
        left join people p on p.id = m.person_id
       where d.organization_id = ${organizationId}::uuid and d.merged_into_id is null
         and (${text} = '' or d.display_name ilike ${pattern} escape '\\' or d.email ilike ${pattern} escape '\\')
         and (${cursor === null} or (lower(d.display_name), d.id) > (${cursor?.name ?? ""}, ${cursor?.id ?? "00000000-0000-0000-0000-000000000000"}::uuid))
       order by lower(d.display_name) asc, d.id asc
       limit ${PAGE_SIZE + 1}
    `);
    const rows = rowsOf(result).map(
      (r): DonorListRow => ({
        id: String(r.id),
        displayName: String(r.display_name),
        kind: r.kind as DonorListRow["kind"],
        email: (r.email as string | null) ?? null,
        location: [r.city, r.region].filter((x) => typeof x === "string" && x !== "").join(", ") || null,
        linkedMemberName: (r.linked_name as string | null) ?? null,
      }),
    );
    const hasMore = rows.length > PAGE_SIZE;
    const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
    return {
      kind: "ok",
      donors: page,
      nextCursor: hasMore ? encodeDonorCursor(page[page.length - 1]!) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// link suggestions (the waiting proposals)
// ---------------------------------------------------------------------------

export type ListLinkSuggestionsResult =
  | { kind: "ok"; suggestions: LinkSuggestion[] }
  | { kind: "forbidden" };

/**
 * The donors with a member-link proposal waiting: donor name and the proposed
 * member's name, nothing else - so it is safe for `giving.record` (S4) as well
 * as `giving.view`. The overview's count is `countLinkProposals`, the same query.
 */
export async function listWaitingLinkSuggestions(
  personId: string,
  organizationId: string,
): Promise<ListLinkSuggestionsResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.record && !has.view) return { kind: "forbidden" };
    return { kind: "ok", suggestions: await listLinkSuggestions(tx, organizationId) };
  });
}

// ---------------------------------------------------------------------------
// possible duplicates (shared with the overview's attention count)
// ---------------------------------------------------------------------------

/**
 * Pairs of identified, unmerged donors that look like one giver: the same
 * email, or the same name ignoring case. A pair is reported once (a.id < b.id).
 * Names only; the attention count (`attention.ts`) wraps this same fragment.
 */
export const DUPLICATE_PAIRS = (organizationId: string) => sql`
  select a.id as a_id, a.display_name as a_name, b.id as b_id, b.display_name as b_name,
         case when a.email is not null and a.email = b.email then 'same_email' else 'same_name' end as reason
    from giving_donors a
    join giving_donors b
      on b.organization_id = a.organization_id and b.id > a.id
     and b.kind = 'identified' and b.merged_into_id is null
     and ((a.email is not null and a.email = b.email) or lower(a.display_name) = lower(b.display_name))
   where a.organization_id = ${organizationId}::uuid and a.kind = 'identified' and a.merged_into_id is null
`;

export interface DuplicatePair {
  aId: string;
  aName: string;
  bId: string;
  bName: string;
  reason: "same_email" | "same_name";
}

export type ListDuplicatesResult =
  | { kind: "ok"; pairs: DuplicatePair[] }
  | { kind: "forbidden" };

/** The "possible duplicates" panel. `giving.view`. At most 25 pairs. */
export async function listPossibleDuplicates(
  personId: string,
  organizationId: string,
): Promise<ListDuplicatesResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.view) return { kind: "forbidden" };
    const result = await tx.execute(sql`
      select * from (${DUPLICATE_PAIRS(organizationId)}) x order by lower(x.a_name), x.a_id, x.b_id limit 25
    `);
    return {
      kind: "ok",
      pairs: rowsOf(result).map(
        (r): DuplicatePair => ({
          aId: String(r.a_id),
          aName: String(r.a_name),
          bId: String(r.b_id),
          bName: String(r.b_name),
          reason: r.reason as DuplicatePair["reason"],
        }),
      ),
    };
  });
}

// ---------------------------------------------------------------------------
// getDonor (full) and getDonorReduced (S4)
// ---------------------------------------------------------------------------

export interface DonorLink {
  membershipId: string;
  personName: string;
  source: "self_online" | "recorder_confirmed";
}

export interface DonorDetail {
  id: string;
  displayName: string;
  kind: "identified" | "unidentified";
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string;
  link: DonorLink | null;
  proposals: LinkProposal[];
  /** Donors merged into this one (their gifts read through this donor). */
  mergedFromCount: number;
  possibleDuplicates: Array<{ id: string; displayName: string; reason: "same_email" | "same_name" }>;
  hasProviderIdentity: boolean;
}

export type GetDonorResult =
  | { kind: "ok"; donor: DonorDetail }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  /** Merged away: carries the survivor's id so the page can send the reader there. */
  | { kind: "merged"; survivorId: string };

async function readLink(tx: OrgTx, organizationId: string, donorId: string): Promise<DonorLink | null> {
  const row = rowsOf(
    await tx.execute(sql`
      select d.linked_membership_id, d.link_source,
             btrim(concat_ws(' ', coalesce(nullif(p.preferred_name, ''), p.first_name), p.last_name)) as person_name
        from giving_donors d
        join memberships m on m.id = d.linked_membership_id and m.organization_id = d.organization_id
        join people p on p.id = m.person_id
       where d.id = ${donorId}::uuid and d.organization_id = ${organizationId}::uuid
    `),
  )[0];
  if (!row) return null;
  return {
    membershipId: String(row.linked_membership_id),
    personName: String(row.person_name),
    source: row.link_source as DonorLink["source"],
  };
}

/** Full donor detail for the treasurer. `giving.view`. */
export async function getDonor(
  personId: string,
  organizationId: string,
  donorId: string,
): Promise<GetDonorResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.view) return { kind: "forbidden" };

    const d = rowsOf(
      await tx.execute(sql`
        select id, display_name, kind, email, address_line1, address_line2, city, region, postal_code,
               country, merged_into_id,
               (select count(*)::int from giving_donors m
                 where m.merged_into_id = ${donorId}::uuid and m.organization_id = ${organizationId}::uuid) as merged_from,
               exists (select 1 from giving_donor_identities i
                        where i.donor_id = ${donorId}::uuid and i.organization_id = ${organizationId}::uuid) as has_identity
          from giving_donors
         where id = ${donorId}::uuid and organization_id = ${organizationId}::uuid
      `),
    )[0];
    if (!d) return { kind: "not_found" };
    if (d.merged_into_id) return { kind: "merged", survivorId: String(d.merged_into_id) };

    const duplicates = rowsOf(
      await tx.execute(sql`
        select * from (${DUPLICATE_PAIRS(organizationId)}) x
         where x.a_id = ${donorId}::uuid or x.b_id = ${donorId}::uuid
         order by lower(x.a_name), lower(x.b_name) limit 10
      `),
    ).map((r) => {
      const isA = String(r.a_id) === donorId;
      return {
        id: String(isA ? r.b_id : r.a_id),
        displayName: String(isA ? r.b_name : r.a_name),
        reason: r.reason as "same_email" | "same_name",
      };
    });

    return {
      kind: "ok",
      donor: {
        id: String(d.id),
        displayName: String(d.display_name),
        kind: d.kind as DonorDetail["kind"],
        email: (d.email as string | null) ?? null,
        addressLine1: (d.address_line1 as string | null) ?? null,
        addressLine2: (d.address_line2 as string | null) ?? null,
        city: (d.city as string | null) ?? null,
        region: (d.region as string | null) ?? null,
        postalCode: (d.postal_code as string | null) ?? null,
        country: String(d.country),
        link: await readLink(tx, organizationId, donorId),
        proposals: await proposalsForDonor(tx, organizationId, donorId),
        mergedFromCount: Number(d.merged_from),
        possibleDuplicates: duplicates,
        hasProviderIdentity: d.has_identity === true,
      },
    };
  });
}

export interface DonorReduced {
  id: string;
  displayName: string;
  kind: "identified" | "unidentified";
  link: DonorLink | null;
  proposals: LinkProposal[];
}

export type GetDonorReducedResult =
  | { kind: "ok"; donor: DonorReduced }
  | { kind: "forbidden" }
  | { kind: "not_found" };

/**
 * The S4 donor page: a name, a kind, the current link and the proposal - NOT the
 * email, address, gifts or totals. `giving.record`. The SELECT lists exactly the
 * columns it returns; there is no contact column to leak by accident.
 */
export async function getDonorReduced(
  personId: string,
  organizationId: string,
  donorId: string,
): Promise<GetDonorReducedResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.record) return { kind: "forbidden" };

    const d = rowsOf(
      await tx.execute(sql`
        select id, display_name, kind from giving_donors
         where id = ${donorId}::uuid and organization_id = ${organizationId}::uuid and merged_into_id is null
      `),
    )[0];
    if (!d) return { kind: "not_found" };
    return {
      kind: "ok",
      donor: {
        id: String(d.id),
        displayName: String(d.display_name),
        kind: d.kind as DonorReduced["kind"],
        link: await readLink(tx, organizationId, donorId),
        proposals: await proposalsForDonor(tx, organizationId, donorId),
      },
    };
  });
}

// ---------------------------------------------------------------------------
// createDonor
// ---------------------------------------------------------------------------

export type CreateDonorResult =
  | { kind: "ok"; donorId: string }
  | { kind: "forbidden" }
  /** A donor with this name or email already exists: warn, do not block (G24). */
  | { kind: "duplicate_warning"; donors: Array<{ id: string; displayName: string }> };

export async function createDonor(
  personId: string,
  organizationId: string,
  userId: string,
  values: CreateDonorValues,
  options: { acknowledgeDuplicate?: boolean } = {},
): Promise<CreateDonorResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.record) return { kind: "forbidden" };

    if (options.acknowledgeDuplicate !== true) {
      const matches = rowsOf(
        await tx.execute(sql`
          select id, display_name from giving_donors
           where organization_id = ${organizationId}::uuid and kind = 'identified' and merged_into_id is null
             and (lower(display_name) = lower(${values.displayName})
                  or (${values.email}::text is not null and email = ${values.email}))
           order by lower(display_name) limit 5
        `),
      );
      if (matches.length > 0) {
        return {
          kind: "duplicate_warning",
          donors: matches.map((r) => ({ id: String(r.id), displayName: String(r.display_name) })),
        };
      }
    }

    const created = rowsOf(
      await tx.execute(sql`
        insert into giving_donors (organization_id, display_name, email, address_line1, address_line2,
               city, region, postal_code, country, created_by, updated_by)
        values (${organizationId}::uuid, ${values.displayName}, ${values.email}, ${values.addressLine1},
                ${values.addressLine2}, ${values.city}, ${values.region}, ${values.postalCode},
                ${values.country}, ${userId}::uuid, ${userId}::uuid)
        returning id
      `),
    )[0]!;
    return { kind: "ok", donorId: String(created.id) };
  });
}

// ---------------------------------------------------------------------------
// updateDonorContact
// ---------------------------------------------------------------------------

export type UpdateDonorContactResult =
  | { kind: "ok"; changedFields: DonorContactField[] }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  /** The plate-offering donor and a merged donor carry no contact detail. */
  | { kind: "not_editable" };

const CONTACT_COLUMN: Record<DonorContactField, string> = {
  displayName: "display_name",
  email: "email",
  addressLine1: "address_line1",
  addressLine2: "address_line2",
  city: "city",
  region: "region",
  postalCode: "postal_code",
  country: "country",
};

/** `giving.manage`. Returns the names of the fields that changed (never their values). */
export async function updateDonorContact(
  personId: string,
  organizationId: string,
  userId: string,
  values: UpdateDonorContactValues,
): Promise<UpdateDonorContactResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.manage) return { kind: "forbidden" };

    const existing = rowsOf(
      await tx.execute(sql`
        select display_name, email, address_line1, address_line2, city, region, postal_code, country,
               kind, merged_into_id
          from giving_donors
         where id = ${values.donorId}::uuid and organization_id = ${organizationId}::uuid
         for update
      `),
    )[0];
    if (!existing) return { kind: "not_found" };
    if (existing.kind !== "identified" || existing.merged_into_id) return { kind: "not_editable" };

    const changedFields = DONOR_CONTACT_FIELDS.filter(
      (field) => (existing[CONTACT_COLUMN[field]] ?? null) !== (values[field] ?? null),
    );
    if (changedFields.length === 0) return { kind: "ok", changedFields };

    await tx.execute(sql`
      update giving_donors
         set display_name = ${values.displayName}, email = ${values.email},
             address_line1 = ${values.addressLine1}, address_line2 = ${values.addressLine2},
             city = ${values.city}, region = ${values.region}, postal_code = ${values.postalCode},
             country = ${values.country}, updated_by = ${userId}::uuid, updated_at = now()
       where id = ${values.donorId}::uuid and organization_id = ${organizationId}::uuid
    `);
    return { kind: "ok", changedFields };
  });
}

// ---------------------------------------------------------------------------
// mergeDonors
// ---------------------------------------------------------------------------

export type MergeDonorsResult =
  | { kind: "ok"; repointedCount: number; inheritedLink: boolean }
  | { kind: "forbidden" }
  | { kind: "same_donor" }
  | { kind: "not_found" }
  /** Either donor is the plate-offering donor or is already merged away. */
  | { kind: "invalid_target" }
  /** Both are linked, to different members: remove one link first. */
  | { kind: "link_conflict" };

/**
 * Merges `sourceId` into `targetId`. `giving.manage`. Under a per-organization
 * advisory lock (so two concurrent merges cannot build a depth-2 chain), both
 * rows are locked and validated, donors already merged INTO the source are
 * repointed at the target (flat), the target inherits the source's member link
 * when it has none, and the source is marked merged with its own link cleared in
 * the same UPDATE. Gifts and statements are not touched: they read through the
 * root.
 */
export async function mergeDonors(
  personId: string,
  organizationId: string,
  userId: string,
  sourceId: string,
  targetId: string,
): Promise<MergeDonorsResult> {
  if (sourceId === targetId) return { kind: "same_donor" };
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.manage) return { kind: "forbidden" };

    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`giving_donor_merge:${organizationId}`}))`);

    const rows = rowsOf(
      await tx.execute(sql`
        select id, kind, merged_into_id, linked_membership_id, link_source, linked_at, linked_by
          from giving_donors
         where organization_id = ${organizationId}::uuid and id in (${sourceId}::uuid, ${targetId}::uuid)
         order by id
         for update
      `),
    );
    const source = rows.find((r) => String(r.id) === sourceId);
    const target = rows.find((r) => String(r.id) === targetId);
    if (!source || !target) return { kind: "not_found" };
    if (
      source.kind !== "identified" ||
      target.kind !== "identified" ||
      source.merged_into_id ||
      target.merged_into_id
    ) {
      return { kind: "invalid_target" };
    }
    if (
      source.linked_membership_id &&
      target.linked_membership_id &&
      source.linked_membership_id !== target.linked_membership_id
    ) {
      return { kind: "link_conflict" };
    }

    // 1. Flatten: donors already merged into the source now point at the target.
    const repointed = rowsOf(
      await tx.execute(sql`
        update giving_donors
           set merged_into_id = ${targetId}::uuid, updated_by = ${userId}::uuid, updated_at = now()
         where organization_id = ${organizationId}::uuid and merged_into_id = ${sourceId}::uuid
        returning id
      `),
    );

    // 2. The target inherits the source's link when it has none.
    const inheritedLink = Boolean(source.linked_membership_id) && !target.linked_membership_id;
    if (inheritedLink) {
      await tx.execute(sql`
        update giving_donors
           set linked_membership_id = ${source.linked_membership_id as string}::uuid,
               link_source = ${source.link_source as string}, linked_at = now(), linked_by = ${userId}::uuid,
               updated_by = ${userId}::uuid, updated_at = now()
         where id = ${targetId}::uuid and organization_id = ${organizationId}::uuid
      `);
    }

    // 3. The source is merged away; its own link is cleared in the same UPDATE
    //    (a merged donor is frozen for every other column afterwards).
    await tx.execute(sql`
      update giving_donors
         set merged_into_id = ${targetId}::uuid, merged_at = now(), merged_by = ${userId}::uuid,
             linked_membership_id = null, link_source = null, linked_at = null, linked_by = null,
             updated_by = ${userId}::uuid, updated_at = now()
       where id = ${sourceId}::uuid and organization_id = ${organizationId}::uuid
    `);
    return { kind: "ok", repointedCount: repointed.length, inheritedLink };
  });
}

// ---------------------------------------------------------------------------
// confirmLink / dismissLink / removeLink
// ---------------------------------------------------------------------------

export type ConfirmLinkResult =
  | { kind: "ok"; personName: string }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "already_linked" }
  /** The proposal is gone (dismissed, the member left or went private). Reload. */
  | { kind: "no_proposal" };

/**
 * Links the donor to the proposed member. `giving.record`. The membership id
 * must be one of the donor's CURRENT computed proposals - a caller cannot link
 * a donor to an arbitrary membership by supplying its id (the account-takeover
 * defence: the visible effect is that member reading this donor's history).
 */
export async function confirmLink(
  personId: string,
  organizationId: string,
  userId: string,
  donorId: string,
  membershipId: string,
): Promise<ConfirmLinkResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.record) return { kind: "forbidden" };

    const donor = rowsOf(
      await tx.execute(sql`
        select linked_membership_id from giving_donors
         where id = ${donorId}::uuid and organization_id = ${organizationId}::uuid
           and kind = 'identified' and merged_into_id is null
         for update
      `),
    )[0];
    if (!donor) return { kind: "not_found" };
    if (donor.linked_membership_id) return { kind: "already_linked" };

    const proposal = (await proposalsForDonor(tx, organizationId, donorId)).find(
      (p) => p.membershipId === membershipId,
    );
    if (!proposal) return { kind: "no_proposal" };

    await tx.execute(sql`
      update giving_donors
         set linked_membership_id = ${membershipId}::uuid, link_source = 'recorder_confirmed',
             linked_at = now(), linked_by = ${userId}::uuid, updated_by = ${userId}::uuid, updated_at = now()
       where id = ${donorId}::uuid and organization_id = ${organizationId}::uuid
    `);
    return { kind: "ok", personName: proposal.personName };
  });
}

export type DismissLinkResult =
  | { kind: "ok" }
  | { kind: "forbidden" }
  | { kind: "not_found" };

/** Records "not this person" so the pair is never proposed again. `giving.record`. */
export async function dismissLink(
  personId: string,
  organizationId: string,
  userId: string,
  donorId: string,
  membershipId: string,
): Promise<DismissLinkResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.record) return { kind: "forbidden" };

    const proposal = (await proposalsForDonor(tx, organizationId, donorId)).find(
      (p) => p.membershipId === membershipId,
    );
    if (!proposal) return { kind: "not_found" };

    await tx.execute(sql`
      insert into giving_donor_link_decisions (organization_id, donor_id, membership_id, decision, decided_by)
      values (${organizationId}::uuid, ${donorId}::uuid, ${membershipId}::uuid, 'dismissed', ${userId}::uuid)
      on conflict (donor_id, membership_id) do nothing
    `);
    return { kind: "ok" };
  });
}

export type RemoveLinkResult =
  | { kind: "ok"; membershipId: string; personName: string }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "not_linked" };

/**
 * Unlinks the donor. `giving.record`. The pair is also recorded as dismissed so
 * the unlink is not undone by the very next page load re-proposing it.
 */
export async function removeLink(
  personId: string,
  organizationId: string,
  userId: string,
  donorId: string,
): Promise<RemoveLinkResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.record) return { kind: "forbidden" };

    const donor = rowsOf(
      await tx.execute(sql`
        select linked_membership_id from giving_donors
         where id = ${donorId}::uuid and organization_id = ${organizationId}::uuid and merged_into_id is null
         for update
      `),
    )[0];
    if (!donor) return { kind: "not_found" };
    if (!donor.linked_membership_id) return { kind: "not_linked" };

    const link = await readLink(tx, organizationId, donorId);
    const membershipId = String(donor.linked_membership_id);
    await tx.execute(sql`
      update giving_donors
         set linked_membership_id = null, link_source = null, linked_at = null, linked_by = null,
             updated_by = ${userId}::uuid, updated_at = now()
       where id = ${donorId}::uuid and organization_id = ${organizationId}::uuid
    `);
    await tx.execute(sql`
      insert into giving_donor_link_decisions (organization_id, donor_id, membership_id, decision, decided_by)
      values (${organizationId}::uuid, ${donorId}::uuid, ${membershipId}::uuid, 'dismissed', ${userId}::uuid)
      on conflict (donor_id, membership_id) do nothing
    `);
    return { kind: "ok", membershipId, personName: link?.personName ?? "" };
  });
}
