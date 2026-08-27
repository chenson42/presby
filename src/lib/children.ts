import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { withOrgContext } from "@/lib/authz";
import { memberships } from "@/lib/db/domain/people";
import { personRelationships } from "@/lib/db/domain/people";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";

/**
 * Children's ministry, Increment A (docs/work-log/
 * 2026-08-26-childrens-ministry.md, Phase 3 / DECISION-111 / DECISION-114).
 * SAME SHAPE as `person-sensitive.ts`: one `withOrgContext()` transaction per
 * exported function, permission check first, typed result variants for
 * every expected/denied outcome, enumeration-safe `not_found` collapse.
 *
 * Named `children.ts`, not `person-relationships.ts` — this module does NOT
 * cover every use of `person_relationships`, only the children's-ministry
 * guardian-linking use case, gated entirely behind `children.roster`
 * (DECISION-114). A future adult-relationships/emergency-contact feature
 * gets its own module and its own permission, not an extension of this one.
 *
 * A SINGLE permission (`children.roster`) gates every export here — reads
 * AND writes on `person_relationships` (DECISION-111 ruling 2). This is the
 * FIRST application-level permission check `person_relationships` has ever
 * had: it is a global table (no `organization_id`), RLS-gated only by the
 * child's own membership visibility (`visible_via_membership`, mirroring
 * `addresses`/`contact_methods`) — correctly narrow at the DB layer, but RLS
 * enforces tenancy, never authorization (CLAUDE.md's own invariant). Every
 * export below re-verifies `children.roster` inside its own
 * `withOrgContext()` transaction before touching `person_relationships`.
 */

type OrgTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const CHILDREN_ROSTER = "children.roster";

/**
 * Server-side length limits — the sensitive-info pipeline's Phase 6 finding
 * (docs/work-log/2026-08-26-member-sensitive-info.md): only the client-side
 * `maxLength` HTML attribute shipped there, so a request bypassing the
 * browser form could write an arbitrarily long string. Checked inline,
 * before `withOrgContext`, same "reject before any query runs" discipline.
 * Numbers match `person-sensitive.ts`'s own constants exactly (not
 * re-derived): 4000 for a free-text body, 2000 for a single-line field.
 */
const NOTES_MAX_LENGTH = 4000; // person_relationships.notes
const RELATED_NAME_MAX_LENGTH = 2000; // person_relationships.related_name

/**
 * The UI's dropdown is a narrower allow-list than the column itself, which
 * carries no DB-level CHECK constraint (confirmed against
 * drizzle/0008_presby_domain.sql: `relationship text not null`, nothing
 * more) — this allow-list is the only thing preventing junk values from a
 * bypassed client (Phase 3's own Edge Cases note). Deliberately excludes
 * `spouse`/`child`/`sibling`/`emergency_contact`/`pastor` — those don't
 * describe "who may pick this child up," and `isEmergencyContact` already
 * covers the emergency-contact case independently.
 */
export type GuardianRelationship =
  | "parent"
  | "guardian"
  | "grandparent"
  | "caregiver";

const GUARDIAN_RELATIONSHIPS: readonly GuardianRelationship[] = [
  "parent",
  "guardian",
  "grandparent",
  "caregiver",
];

function isGuardianRelationship(value: string): value is GuardianRelationship {
  return (GUARDIAN_RELATIONSHIPS as readonly string[]).includes(value);
}

async function hasChildrenRoster(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid,
             ${organizationId}::uuid,
             ${CHILDREN_ROSTER}
           ) as allowed
  `);
  return (
    (result as unknown as { rows?: Array<{ allowed?: boolean }> }).rows?.[0]
      ?.allowed === true
  );
}

async function personVisibleInOrg(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: memberships.personId })
    .from(memberships)
    .where(
      and(
        eq(memberships.personId, personId),
        eq(memberships.organizationId, organizationId),
      ),
    )
    .limit(1);
  return !!row;
}

// ---------------------------------------------------------------------------
// searchLinkablePeople — small typeahead helper for the guardian-link form
// ---------------------------------------------------------------------------

export interface LinkablePerson {
  personId: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
}

export type SearchLinkablePeopleResult =
  | { kind: "ok"; people: LinkablePerson[] }
  | { kind: "forbidden" };

interface LinkablePersonRow {
  person_id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
}

/**
 * Backs the guardian-link form's "link an existing person" default mode
 * (Phase 3 Component Plan / DECISION-111 ruling 4: "the UI defaults to
 * linking existing people rows... free-text relatedName fallback"). Gated
 * on `children.roster` — NOT `directory.view` — so a `children_ministry_
 * admin` holder who lacks `directory.view` can still search for a guardian
 * to link, the same permission that already governs every other read/write
 * in this module. At most 8 matches: this is a lightweight typeahead, not
 * an enumeration surface.
 */
export async function searchLinkablePeople(
  actingPersonId: string,
  organizationId: string,
  query: string,
): Promise<SearchLinkablePeopleResult> {
  return withOrgContext(actingPersonId, organizationId, async (tx) => {
    if (!(await hasChildrenRoster(tx, actingPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return { kind: "ok", people: [] };
    }

    const like = `%${trimmed}%`;
    const result = await tx.execute(sql`
      select distinct p.id as person_id, p.first_name as first_name,
             p.last_name as last_name, p.preferred_name as preferred_name
        from memberships m
        join people p on p.id = m.person_id
       where m.organization_id = ${organizationId}::uuid
         and p.merged_into_id is null
         and p.date_of_death is null
         and (
           p.first_name ilike ${like}
           or p.last_name ilike ${like}
           or p.preferred_name ilike ${like}
         )
       order by p.last_name, p.first_name
       limit 8
    `);
    const rows = (result as unknown as { rows?: LinkablePersonRow[] }).rows ?? [];
    return {
      kind: "ok",
      people: rows.map((row) => ({
        personId: row.person_id,
        firstName: row.first_name,
        lastName: row.last_name,
        preferredName: row.preferred_name,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// getChildrenRoster
// ---------------------------------------------------------------------------

export interface ChildRosterEntry {
  personId: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  /** 'YYYY-MM-DD'. Never null — see this module's header on the age cutoff. */
  dateOfBirth: string;
  ageYears: number;
  householdId: string | null;
  householdName: string | null;
  /** 0 renders a "no guardian on file" flag. */
  guardianCount: number;
}

export type GetChildrenRosterResult =
  | { kind: "ok"; children: ChildRosterEntry[] }
  | { kind: "forbidden" };

interface ChildRosterRow {
  person_id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  date_of_birth: string;
  age_years: number;
  household_id: string | null;
  household_name: string | null;
  guardian_count: number;
}

/**
 * The children's roster. DELIBERATELY does not route through
 * `directory.ts`'s `directoryEligibilityWhereSql()`/field-level CASE WHEN
 * machinery — two independent rulings, both DECISION-114:
 *
 *   1. `person_privacy.directory_hidden` is NOT applied — a family that
 *      opted a child out of the public congregational directory should
 *      still appear on the internal children's-ministry safety roster
 *      (mirrors `deriveDeaconsByOrgUnit()`'s "shown by role/office, not by
 *      directory privacy" precedent — a child is shown "by roster" for the
 *      same safety/staffing-accountability reason).
 *   2. `person_privacy.hide_birthday` (default TRUE for every person) is
 *      NOT applied either — `children.roster`'s entire purpose is computing
 *      and displaying age, which is impossible from a nulled birthday.
 *      Holding `children.roster` IS the authorization to see an unmasked
 *      `dateOfBirth` for anyone the roster's age-cutoff query returns. This
 *      is a narrow, single-purpose bypass of the directory's privacy layer
 *      (analogous to `person_medical`/`person_notes` already sitting
 *      entirely outside `person_privacy`'s reach) — NOT a general weakening
 *      of `hide_birthday`, which keeps nulling the column for every other
 *      reader (`getDirectory()`, `getHouseholdDetail()`, `getPersonDetail()`
 *      are all unchanged by this module).
 *
 * Age cutoff: `people.date_of_birth is not null and date_of_birth >
 * current_date - interval '18 years'` — strictly under 18, computed at READ
 * TIME, never stored (DECISION-111: no stored is-child flag). A person with
 * no `dateOfBirth` is never included, even if `grade` strongly suggests a
 * child — a named, accepted gap (Phase 3 Edge Cases), not fixed here.
 */
export async function getChildrenRoster(
  personId: string,
  organizationId: string,
): Promise<GetChildrenRosterResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    if (!(await hasChildrenRoster(tx, personId, organizationId))) {
      return { kind: "forbidden" };
    }

    const result = await tx.execute(sql`
      select
        p.id                                                as person_id,
        p.first_name                                         as first_name,
        p.last_name                                          as last_name,
        p.preferred_name                                     as preferred_name,
        p.date_of_birth::text                                as date_of_birth,
        extract(year from age(current_date, p.date_of_birth))::int as age_years,
        m.household_id                                        as household_id,
        h.name                                                as household_name,
        (
          select count(*)::int
            from person_relationships pr
           where pr.person_id = p.id
        )                                                      as guardian_count
        from memberships m
        join people p on p.id = m.person_id
        left join households h on h.id = m.household_id
       where m.organization_id = ${organizationId}::uuid
         and p.date_of_birth is not null
         and p.date_of_birth > (current_date - interval '18 years')
         and p.merged_into_id is null
         and p.date_of_death is null
       order by p.last_name, p.first_name, p.id
    `);

    const rows = (result as unknown as { rows?: ChildRosterRow[] }).rows ?? [];

    return {
      kind: "ok",
      children: rows.map((row) => ({
        personId: row.person_id,
        firstName: row.first_name,
        lastName: row.last_name,
        preferredName: row.preferred_name,
        dateOfBirth: row.date_of_birth,
        ageYears: row.age_years,
        householdId: row.household_id,
        householdName: row.household_name,
        guardianCount: row.guardian_count,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// getGuardianLinksForEdit
// ---------------------------------------------------------------------------

export interface GuardianLink {
  id: string;
  relatedPersonId: string | null;
  /** Present iff relatedPersonId is null. */
  relatedName: string | null;
  /**
   * Present iff `relatedPersonId` is set — the linked person's own display
   * name, resolved here so the edit form never has to make a second round
   * trip just to render "who this row points at."
   */
  relatedPersonName: string | null;
  relationship: GuardianRelationship;
  isEmergencyContact: boolean;
  notes: string | null;
}

export type GetGuardianLinksResult =
  | { kind: "ok"; personId: string; links: GuardianLink[] }
  | { kind: "forbidden" }
  | { kind: "not_found" };

interface GuardianLinkRow {
  id: string;
  related_person_id: string | null;
  related_name: string | null;
  related_person_first_name: string | null;
  related_person_last_name: string | null;
  relationship: string;
  is_emergency_contact: boolean;
  notes: string | null;
}

/**
 * `not_found` collapses "no such person" and "not visible in this org", same
 * enumeration-safety discipline as `getPersonForEdit`/
 * `getSensitiveInfoForEdit`. A row whose `relationship` value falls outside
 * the UI's four-value allow-list (possible via direct DB access, since the
 * column carries no CHECK constraint) still passes through here as-is —
 * this read has no reason to hide a pre-existing value from a permission
 * holder, only the WRITE path enforces the allow-list.
 */
export async function getGuardianLinksForEdit(
  actingPersonId: string,
  organizationId: string,
  childPersonId: string,
): Promise<GetGuardianLinksResult> {
  return withOrgContext(actingPersonId, organizationId, async (tx) => {
    if (!(await hasChildrenRoster(tx, actingPersonId, organizationId))) {
      return { kind: "forbidden" };
    }
    if (!(await personVisibleInOrg(tx, childPersonId, organizationId))) {
      return { kind: "not_found" };
    }

    const result = await tx.execute(sql`
      select pr.id as id, pr.related_person_id as related_person_id,
             pr.related_name as related_name,
             rp.first_name as related_person_first_name,
             rp.last_name as related_person_last_name,
             pr.relationship as relationship,
             pr.is_emergency_contact as is_emergency_contact,
             pr.notes as notes
        from person_relationships pr
        left join people rp on rp.id = pr.related_person_id
       where pr.person_id = ${childPersonId}::uuid
       order by pr.id
    `);
    const rows = (result as unknown as { rows?: GuardianLinkRow[] }).rows ?? [];

    return {
      kind: "ok",
      personId: childPersonId,
      links: rows.map((row) => ({
        id: row.id,
        relatedPersonId: row.related_person_id,
        relatedName: row.related_name,
        relatedPersonName: row.related_person_id
          ? `${row.related_person_first_name ?? ""} ${row.related_person_last_name ?? ""}`.trim()
          : null,
        relationship: row.relationship as GuardianRelationship,
        isEmergencyContact: row.is_emergency_contact,
        notes: row.notes,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// addGuardianLink / updateGuardianLink / removeGuardianLink
// ---------------------------------------------------------------------------

export interface AddGuardianLinkInput {
  /** XOR relatedName — validated server-side. */
  relatedPersonId?: string;
  relatedName?: string;
  relationship: GuardianRelationship;
  isEmergencyContact: boolean;
  notes?: string;
}

export type AddGuardianLinkResult =
  | { kind: "ok"; linkId: string }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | {
      kind: "invalid_input";
      field: "relatedName" | "relatedPersonId" | "notes" | "relationship";
    };

/**
 * Validates BEFORE any query runs, same "reject before any query runs"
 * discipline as `person-sensitive.ts`'s length checks / `roll.ts`'s
 * `recordRollAction()` re-validating `input.kind`.
 *
 *   - `relationship` must be one of the four UI values.
 *   - EXACTLY ONE of `relatedPersonId`/`relatedName` must be present — the
 *     XOR the original schema design specified as a DB CHECK constraint that
 *     `drizzle/0008` never actually applied (Phase 3 Edge Cases: a real,
 *     previously-latent gap, closed here at the layer this module can
 *     reach).
 *   - `relatedName`/`notes` length limits.
 */
function validateGuardianLinkInput(
  input: AddGuardianLinkInput,
): { field: "relatedName" | "relatedPersonId" | "notes" | "relationship" } | null {
  if (!isGuardianRelationship(input.relationship)) {
    return { field: "relationship" };
  }
  const hasRelatedPersonId =
    typeof input.relatedPersonId === "string" && input.relatedPersonId.length > 0;
  const hasRelatedName =
    typeof input.relatedName === "string" && input.relatedName.trim().length > 0;
  if (hasRelatedPersonId === hasRelatedName) {
    // Both present or both absent — the XOR the missing DB CHECK never
    // enforced. Report against whichever field is populated, defaulting to
    // relatedPersonId for the "neither" case.
    return { field: hasRelatedName ? "relatedPersonId" : "relatedName" };
  }
  if (input.relatedName && input.relatedName.length > RELATED_NAME_MAX_LENGTH) {
    return { field: "relatedName" };
  }
  if (input.notes && input.notes.length > NOTES_MAX_LENGTH) {
    return { field: "notes" };
  }
  return null;
}

export async function addGuardianLink(
  actingPersonId: string,
  organizationId: string,
  childPersonId: string,
  input: AddGuardianLinkInput,
): Promise<AddGuardianLinkResult> {
  const invalid = validateGuardianLinkInput(input);
  if (invalid) {
    return { kind: "invalid_input", ...invalid };
  }

  const result = await withOrgContext<AddGuardianLinkResult>(
    actingPersonId,
    organizationId,
    async (tx) => {
      if (!(await hasChildrenRoster(tx, actingPersonId, organizationId))) {
        return { kind: "forbidden" };
      }
      if (!(await personVisibleInOrg(tx, childPersonId, organizationId))) {
        return { kind: "not_found" };
      }

      // The existence-oracle DECISION-111 named but declined to fix at the
      // DB layer (the INSERT policy checks person_id but nothing on
      // related_person_id): when linking to an EXISTING people row, verify
      // that person also holds an active membership at THIS organization —
      // a real narrowing beyond what DECISION-111 required, cheap to add
      // now that app-level gating exists on this table for the first time.
      if (
        input.relatedPersonId &&
        !(await personVisibleInOrg(tx, input.relatedPersonId, organizationId))
      ) {
        return { kind: "invalid_input", field: "relatedPersonId" };
      }

      const [row] = await tx
        .insert(personRelationships)
        .values({
          personId: childPersonId,
          relatedPersonId: input.relatedPersonId ?? null,
          relatedName: input.relatedName ?? null,
          relationship: input.relationship,
          isEmergencyContact: input.isEmergencyContact,
          notes: input.notes ?? null,
        })
        .returning({ id: personRelationships.id });

      return { kind: "ok", linkId: row!.id };
    },
  );

  if (result.kind === "ok") {
    await recordAudit({
      action: AUDIT_ACTIONS.TENANT_PERSON_RELATIONSHIP_ADDED,
      resourceType: "person_relationship",
      resourceId: result.linkId,
      metadata: { organizationId, childPersonId, relationship: input.relationship },
    });
  }

  return result;
}

export type UpdateGuardianLinkResult = AddGuardianLinkResult;

export async function updateGuardianLink(
  actingPersonId: string,
  organizationId: string,
  childPersonId: string,
  linkId: string,
  input: AddGuardianLinkInput,
): Promise<UpdateGuardianLinkResult> {
  const invalid = validateGuardianLinkInput(input);
  if (invalid) {
    return { kind: "invalid_input", ...invalid };
  }

  const result = await withOrgContext<UpdateGuardianLinkResult>(
    actingPersonId,
    organizationId,
    async (tx) => {
      if (!(await hasChildrenRoster(tx, actingPersonId, organizationId))) {
        return { kind: "forbidden" };
      }
      if (!(await personVisibleInOrg(tx, childPersonId, organizationId))) {
        return { kind: "not_found" };
      }
      if (
        input.relatedPersonId &&
        !(await personVisibleInOrg(tx, input.relatedPersonId, organizationId))
      ) {
        return { kind: "invalid_input", field: "relatedPersonId" };
      }

      const [existing] = await tx
        .select({ id: personRelationships.id })
        .from(personRelationships)
        .where(
          and(
            eq(personRelationships.id, linkId),
            eq(personRelationships.personId, childPersonId),
          ),
        )
        .limit(1);
      if (!existing) {
        return { kind: "not_found" };
      }

      await tx
        .update(personRelationships)
        .set({
          relatedPersonId: input.relatedPersonId ?? null,
          relatedName: input.relatedName ?? null,
          relationship: input.relationship,
          isEmergencyContact: input.isEmergencyContact,
          notes: input.notes ?? null,
        })
        .where(eq(personRelationships.id, linkId));

      return { kind: "ok", linkId };
    },
  );

  if (result.kind === "ok") {
    await recordAudit({
      action: AUDIT_ACTIONS.TENANT_PERSON_RELATIONSHIP_UPDATED,
      resourceType: "person_relationship",
      resourceId: result.linkId,
      metadata: { organizationId, childPersonId, relationship: input.relationship },
    });
  }

  return result;
}

export type RemoveGuardianLinkResult =
  | { kind: "ok" }
  | { kind: "forbidden" }
  | { kind: "not_found" };

export async function removeGuardianLink(
  actingPersonId: string,
  organizationId: string,
  childPersonId: string,
  linkId: string,
): Promise<RemoveGuardianLinkResult> {
  const result = await withOrgContext<RemoveGuardianLinkResult>(
    actingPersonId,
    organizationId,
    async (tx) => {
      if (!(await hasChildrenRoster(tx, actingPersonId, organizationId))) {
        return { kind: "forbidden" };
      }
      if (!(await personVisibleInOrg(tx, childPersonId, organizationId))) {
        return { kind: "not_found" };
      }

      const [existing] = await tx
        .select({ id: personRelationships.id })
        .from(personRelationships)
        .where(
          and(
            eq(personRelationships.id, linkId),
            eq(personRelationships.personId, childPersonId),
          ),
        )
        .limit(1);
      if (!existing) {
        return { kind: "not_found" };
      }

      await tx
        .delete(personRelationships)
        .where(eq(personRelationships.id, linkId));

      return { kind: "ok" };
    },
  );

  if (result.kind === "ok") {
    await recordAudit({
      action: AUDIT_ACTIONS.TENANT_PERSON_RELATIONSHIP_REMOVED,
      resourceType: "person_relationship",
      resourceId: linkId,
      metadata: { organizationId, childPersonId },
    });
  }

  return result;
}
