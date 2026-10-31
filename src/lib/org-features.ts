import "server-only";
import { cache } from "react";
import { and, eq, sql } from "drizzle-orm";
import {
  withOrgContext,
  type OrgTx,
  type OrganizationType,
} from "@/lib/authz";
import { organizationFeatureToggles } from "@/lib/db/domain/org-features";
import { organizations } from "@/lib/db/schema";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { isFlagEnabled } from "@/lib/flags";
import {
  categoryEnabledInTx,
  type OrgFeatureCategory,
} from "@/lib/org-feature-categories";
import { DOMAIN_LABELS } from "@/lib/org-portal/tiles";

/**
 * Per-org feature enablement — the third gating axis (DECISION-097,
 * docs/work-log/2026-08-25-member-management.md "Per-Org Feature Enablement —
 * Architectural Ruling", refined by Phase 3's design). Composes with, never
 * replaces, the global `feature_flags` kill switch and the per-user
 * `permissions` catalog (DECISION-003): flag -> org toggle -> permission,
 * cheapest and most centrally-controlled first.
 *
 * SIGNATURE DEVIATION FROM THE RULING, STATED EXPLICITLY (Phase 3's own
 * text): the ruling's shorthand was `isOrgFeatureEnabled(organizationId,
 * key)`. Reading the toggle row requires the RLS org GUC to be set, and the
 * Isolation invariant is unconditional — "verify membership before calling
 * set_config" — so this resolver cannot set `app.current_org_id` from a bare
 * `organizationId` without a `personId` to check membership against first.
 * Every real call site already has `personId` in hand (a page or action that
 * has already run `resolveOrgContext()`), so the actual signature threads it
 * through: `isOrgFeatureEnabled(personId, organizationId, key)`.
 *
 * FOURTH AXIS, ADDED (docs/work-log/2026-08-27-feature-categories.md, Phase
 * 3; DECISION-130): a coarser, org-chosen "which ministry areas apply to
 * this org" checkpoint composed IN FRONT of the per-feature toggle read
 * below — flag -> CATEGORY -> org toggle -> permission. Composition lives
 * HERE, inside `isOrgFeatureEnabled()` itself, specifically so every
 * existing and future call site inherits it for free with no changes at the
 * call site (Phase 1's adversarial-pass requirement: server-side
 * enforcement, not just page-render gating). The category check only runs
 * when `org_portal.feature_categories` is on — see `categoryEnabledInTx()`
 * (`src/lib/org-feature-categories.ts`) for the axis kill-switch and the
 * default-on resolution it implements. This is a fourth, coarser version of
 * the same "does this org have this" question the toggle already answers,
 * not a permission and not a flag itself (Permissions vs Flags holds
 * structurally) — documented here per the architect's Phase 2 instruction
 * not to describe it as "just derivation."
 */

const CATEGORY_AXIS_FLAG = "org_portal.feature_categories";

const ORG_FEATURES_MANAGE = "org_features.manage";

/**
 * The whitelist the admin UI renders and `toggleOrgFeature()` validates
 * against. Lives here, NOT `src/lib/permissions.ts` — that catalog is
 * platform-shell-only and frozen (its own header says so).
 */
export const ORG_FEATURE_CATALOG = [
  {
    key: "org_portal.members_create",
    name: "Community: add people and record roll actions",
    description:
      "Lets this organization's admins add people, record participants and propose roll actions.",
    // Feature-categories axis (docs/work-log/2026-08-27-feature-categories.md,
    // Phase 3) — the people domain (labelled Community).
    category: "people" as const,
    // The platform flag that kill-switches this feature globally. Call sites
    // gate on `entry.flag === null || await isFlagEnabled(entry.flag)`, THEN
    // the org toggle, THEN the permission (DECISION-160, R1).
    flag: "org_portal.members_create" as const,
    // Whether `createOrganization()` writes an enabled toggle row for a new
    // org. A missing row still means OFF (DECISION-097) — the default-on is a
    // stored row, never a code constant.
    provisionedOn: false as const,
    orgTypes: null,
    operatorEnabled: false as const,
  },
  // Member edit: tiered sensitive information (docs/work-log/
  // 2026-08-26-member-sensitive-info.md, Phase 3/DECISION-108). A DEDICATED
  // key, NOT reusing org_portal.members_create — that flag's kill switch
  // covers person/roll creation, a materially different risk profile than
  // leaking pastoral/medical/demographic data to the wrong role.
  {
    key: "org_portal.sensitive_info",
    name: "Tiered sensitive information",
    description:
      "Lets this organization enter pastoral notes, demographics, medical/allergy info, and disability records for its members, subject to each viewer's own tier-3 permission grants.",
    category: "people" as const,
    flag: "org_portal.sensitive_info" as const,
    provisionedOn: false as const,
    orgTypes: null,
    operatorEnabled: false as const,
  },
  // Member calendar (docs/work-log/2026-10-14-member-calendar.md, DECISION-160
  // R1). TOGGLE-ONLY: there is no platform flag for it (`flag: null`), so the
  // org toggle is the only off switch and call sites skip the flag step.
  // Provisioned ON: migration 0054 writes an explicit enabled row for every
  // existing org and `createOrganization()` writes one for every new org.
  {
    key: "org_portal.calendar",
    name: "Member calendar",
    description:
      "Shows the calendar of this organization's events to every member who has calendar access, with event types, colors and filters.",
    category: "worship" as const,
    flag: null,
    provisionedOn: true as const,
    orgTypes: null,
    operatorEnabled: false as const,
  },
  // Connect people when they sign in (docs/work-log/2026-10-22-founding-admin-
  // directory.md, Increment 2b, Phase 3 amendment 2 section 6; R47,
  // DECISION-226). TOGGLE-ONLY (`flag: null`): the operator's standing rule is a
  // per-org toggle, not a new global flag, before go-live. Provisioned ON:
  // migration 0065 writes an explicit enabled row for every existing
  // organization and `createOrganization()` writes one for every new one, so
  // DECISION-097's "a missing row is off" stays unconditional (an organization
  // created by raw SQL, as the fixtures are, has no row and is off).
  //
  // REACH: auto-connect only. It never touches invitations, in-place
  // acceptance or an existing connection, and turning it off disconnects
  // nobody. It grants nothing. A SECURITY DEFINER function reads the row
  // (`presby_connect_signed_in_account`), from the row only: the
  // category-curation axis is NOT consulted for it (a curation preference never
  // changes a security behaviour). The card reads it in TypeScript.
  {
    key: "org_portal.sign_in_connect",
    name: "Connect people when they sign in",
    description:
      "When someone signs in with an email address on their record, PresbyPortal connects their sign-in to that record, so they don't need an invitation. People who hold a role or a seat connect only after confirming two-factor sign-in. Some people are never connected this way, such as visitors, people marked inactive or moved away, and addresses shared by more than one person. Turning this off stops new connections only: invitations still work and people already connected stay connected.",
    category: "people" as const,
    flag: null,
    provisionedOn: true as const,
    orgTypes: null,
    operatorEnabled: false as const,
  },
  // Public events calendar (docs/work-log/2026-10-25-public-events-calendar.md,
  // Phase 3 "Names"; DECISION-238, DECISION-241). TOGGLE-ONLY (`flag: null`), no
  // platform flag (operator: per-org toggles, not new global flags, pre-live).
  // Provisioned OFF: a missing row is off, `createOrganization()` writes nothing
  // for it and 0067 backfills no rows. SELF-SERVICE (`operatorEnabled: false`,
  // Q3): the congregation's `org_features.manage` holder turns it on.
  //
  // THE ANONYMOUS READ COMPOSES THIS ENTRY IN SQL. `presby_public_events_calendar`
  // (drizzle/0067) repeats this entry's key, its `category` and its `orgTypes`
  // (null: presbyteries and synods have sites and events too) and the category
  // axis flag, because an anonymous request has no `personId` and cannot call
  // `orgFeatureEnabledInTx`. `public-calendar.test.ts` pins every one of those
  // literals to this entry, and `public-calendar.db.test.ts` compares the SQL
  // with `orgFeatureEnabledInTx` over the whole axis x category x toggle matrix.
  // Changing the key, category or `orgTypes` here without the migration fails
  // those tests, on purpose.
  {
    key: "org_portal.public_calendar",
    name: "Public events calendar",
    description:
      "Shows the events your team has marked for the website on your public website. Only marked events appear. Whoever maintains your website must also place the calendar on a page.",
    category: "worship" as const,
    flag: null,
    provisionedOn: false as const,
    orgTypes: null,
    operatorEnabled: false as const,
  },
  // Job openings (docs/work-log/2026-10-25-careers-inc1.md, Phase 3
  // "Permissions & Flags"; DECISION-264/265). TOGGLE-ONLY (`flag: null`), no
  // platform flag (operator: per-org toggles, not new global flags, pre-live).
  // Provisioned OFF: a missing row is off, `createOrganization()` writes nothing
  // for it and 0071 backfills no rows. SELF-SERVICE (`operatorEnabled: false`):
  // the congregation's `org_features.manage` holder turns it on. `orgTypes: null`
  // because presbyteries and synods hire too. Category `people` (Community).
  //
  // THE ANONYMOUS READ COMPOSES THIS ENTRY IN SQL. `presby_public_careers`
  // (drizzle/0071) repeats this entry's key, its `category` and its `orgTypes`
  // (null) and the category axis flag, because an anonymous request has no
  // `personId` and cannot call `orgFeatureEnabledInTx`. `public.test.ts` pins
  // every one of those literals to this entry and `public.db.test.ts` compares
  // the SQL with `orgFeatureEnabledInTx` over the axis x category x toggle
  // matrix. Changing the key, category or `orgTypes` here without the migration
  // fails those tests, on purpose.
  {
    key: "org_portal.careers",
    name: "Job openings",
    description:
      "Lets your congregation post job openings on its public website. People are asked to contact the church to apply. Whoever maintains your website can also place the openings on a page.",
    category: "people" as const,
    flag: null,
    provisionedOn: false as const,
    orgTypes: null,
    operatorEnabled: false as const,
  },
  // Online giving (docs/work-log/2026-10-15-online-giving.md, Phase 3
  // "Permissions & Flags"; R11 / DECISION-172). TOGGLE-ONLY: there is NO
  // platform flag (`flag: null`) — drizzle/0055 deleted the old
  // `org_portal.giving` feature_flags row and `scripts/seed.ts` no longer
  // seeds it; the per-org toggle is the whole off switch. Provisioned OFF
  // (`provisionedOn: false`): a missing row is off, `createOrganization()`
  // writes nothing for it, and 0055 backfills no rows — giving is something a
  // congregation's `org_features.manage` holder turns on deliberately.
  //
  // `orgTypes` is the applicability allow-list (see `OrgFeatureOrgTypes`):
  // the toggle exists only for a congregation or a new worshiping community.
  // A presbytery or synod gets no toggle row in the list, `invalid_key` from
  // `toggleOrgFeature`, and `false` from `orgFeatureEnabledInTx` even if a
  // stray row exists. The tile's `orgTypeScope` must equal this list
  // (set-equality, pinned in tiles.test.ts).
  {
    key: "org_portal.giving",
    name: "Giving",
    description:
      "Online giving, offline gift recording and year-end statements for this congregation. Turning this off hides every giving page; it never stops Stripe events from being recorded.",
    category: "giving" as const,
    flag: null,
    provisionedOn: false as const,
    orgTypes: ["congregation", "new_worshiping_community"] as const,
    operatorEnabled: false as const,
  },
  // Reimbursements (docs/work-log/2026-10-25-treasury-inc1.md, Phase 3
  // "Permissions & Flags", P3-15; DECISION-267 to 271). TOGGLE-ONLY (`flag:
  // null`): no platform flag and nothing added to e2e-baseline-flags.sql
  // (operator: per-org toggles, not new global flags, pre-live). Provisioned
  // OFF: a missing row is off and `createOrganization()` writes nothing for it.
  // Same applicability as Giving (a congregation or a new worshiping
  // community; the tile `orgTypeScope` and TREASURER_DESIGNATION_ORG_TYPES are
  // set-equal, pinned in tiles.test.ts). The toggle is enforced in TypeScript
  // only (`src/lib/reimbursement/access.ts`); the database does not read it
  // (accepted residual 9). Turning it off hides the pages and deletes nothing.
  {
    key: "org_portal.reimbursement",
    name: "Reimbursements",
    description:
      "Lets members ask for reimbursement or a vendor payment, lets the chairs and leaders of a group approve it, and lets the treasurer record the payment. It doesn't send money. Turning this off hides every reimbursement page and deletes nothing.",
    category: "giving" as const,
    flag: null,
    provisionedOn: false as const,
    orgTypes: ["congregation", "new_worshiping_community"] as const,
    operatorEnabled: false as const,
  },
  // Parish management (docs/work-log/2026-10-25-parish-management.md, Phase 3
  // "Permissions & Flags"; DECISION-242 to 245). TOGGLE-ONLY (`flag: null`):
  // the operator's standing rule is a per-org toggle, not a new global flag,
  // before go-live. Provisioned OFF: a congregation's `org_features.manage`
  // holder turns it on. Congregations only - presbyteries and synods have no
  // Board of Deacons. Turning it off hides the new pages and refuses the
  // actions; data are untouched, and the legacy Parishes read is unchanged.
  {
    key: "org_portal.parishes",
    name: "Parish management",
    description:
      "Deacon districts for this congregation: set them up, put households in them, and let the Moderator of the Board of Deacons (once recorded as an officer) assign households. Administrators can assign too. Turning this off hides the pages and refuses changes; nothing already assigned is removed.",
    category: "people" as const,
    flag: null,
    provisionedOn: false as const,
    orgTypes: ["congregation"] as const,
    operatorEnabled: false as const,
  },
  // Custom domains (docs/work-log/2026-10-19-custom-domains.md, Phase 3
  // "Permissions & Flags"; T9; DECISION-180; operator ruling Q1, 2026-10-19:
  // "platform admin only, for now"). TOGGLE-ONLY (`flag: null`): the operator's
  // standing rule is a per-org toggle, not a new global flag, before go-live.
  // Provisioned OFF.
  //
  // `operatorEnabled: true` is the self-service switch Q1 asked for. While it is
  // true the entry is NOT a tenant control at all: `listFeatureToggles()` omits
  // it, so /o/<slug>/admin/features never shows it, and `toggleOrgFeature()`
  // answers `invalid_key` for it, so an `org_features.manage` holder cannot
  // flip it by posting the key. A platform admin flips it from
  // /admin/organizations/<id> through `src/lib/domains/toggles.ts`. Changing it
  // to `false` later is the entire change to make the toggle self-service.
  //
  // `org_portal.domains` gates web claims, the admin page and serving (the
  // owner-only SQL predicate reads this toggle row). `org_portal.mail_domain`
  // gates the church-mail section (Increment 2) and is the practical valve for
  // the Resend domain cap. `orgTypes: null`: presbyteries and synods get sites
  // and domains too (G32).
  {
    key: "org_portal.domains",
    name: "Website domain",
    description:
      "Lets this organization connect its own web address to its public site.",
    category: "communications" as const,
    flag: null,
    provisionedOn: false as const,
    orgTypes: null,
    operatorEnabled: true as const,
  },
  {
    key: "org_portal.mail_domain",
    name: "Email from your domain",
    description:
      "Lets this organization send its own notices from its own domain instead of through PresbyPortal.",
    category: "communications" as const,
    flag: null,
    provisionedOn: false as const,
    orgTypes: null,
    operatorEnabled: true as const,
  },
] as const;

/**
 * The applicability list on a catalog entry: `null` means the feature applies
 * to every organization type (the three pre-giving entries); an array is an
 * ALLOW-LIST — check membership, never exclusion (the org-type enum has five
 * values, and a new one must default to "not applicable", not "applicable").
 * Same allow-list convention as `PortalTile.orgTypeScope`.
 */
export type OrgFeatureOrgTypes = readonly OrganizationType[] | null;

/** Whether `organizationType` is in `orgTypes`. `null` allows every type; an
 * unknown organization (`organizationType === null`) is never admitted by an
 * allow-list — fail closed. */
export function orgTypeAdmitted(
  orgTypes: OrgFeatureOrgTypes,
  organizationType: OrganizationType | null,
): boolean {
  if (orgTypes === null) return true;
  return organizationType !== null && orgTypes.includes(organizationType);
}

/** True when at least one catalog entry carries an applicability list, so the
 * organization-type read is worth making at all. Static for a given build. */
const CATALOG_HAS_ORG_TYPE_RULES = ORG_FEATURE_CATALOG.some(
  (entry) => entry.orgTypes !== null,
);

/**
 * One read of `organizations.organization_type` in the caller's transaction.
 * `organizations` is deliberately not tenant-isolated (the org tree is
 * public), so this works under the org GUC. `null` for a row that does not
 * exist — treated as "not admitted" by `orgTypeAdmitted`.
 */
async function readOrganizationTypeInTx(
  tx: OrgTx,
  organizationId: string,
): Promise<OrganizationType | null> {
  const [row] = await tx
    .select({ organizationType: organizations.organizationType })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return row?.organizationType ?? null;
}

export type OrgFeatureKey = (typeof ORG_FEATURE_CATALOG)[number]["key"];

function isCatalogKey(key: string): key is OrgFeatureKey {
  return ORG_FEATURE_CATALOG.some((entry) => entry.key === key);
}

/** The single-permission gate every write/list function below checks first,
 * a single `presby_has_permission(..., 'org_features.manage')` call — same
 * pattern as `role-grants.ts`'s `hasRoleGrantsManage()` and `directory.ts`'s
 * `checkDirectoryView()`. */
async function hasOrgFeaturesManage(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid,
             ${organizationId}::uuid,
             ${ORG_FEATURES_MANAGE}
           ) as allowed
  `);
  return (
    (result as unknown as { rows?: Array<{ allowed?: boolean }> }).rows?.[0]
      ?.allowed === true
  );
}

/**
 * Reads whether `key` is enabled for `organizationId`, as seen by `personId`.
 * Deduplicated via React `cache()` within one RSC render pass, matching
 * `isFlagEnabled()`'s own shape — a no-op (and therefore harmless) inside a
 * server action, per that file's own note.
 *
 * Missing row -> `false`. This is NOT an auth-critical flag per DECISION-026
 * — it composes *underneath* a permission check, never instead of one, so
 * "false on any ambiguity" is the right default, same as `isFlagEnabled()`.
 *
 * Throws `OrgAccessError` (via `withOrgContext`) if `personId` holds no
 * active membership at `organizationId` — genuinely broken, not a "disabled"
 * answer, same distinction `directory.ts`'s header draws.
 */
export const isOrgFeatureEnabled = cache(
  async (
    personId: string,
    organizationId: string,
    key: string,
  ): Promise<boolean> => {
    // Fourth axis composition (DECISION-130) — see this file's own header.
    // The flag read happens ONCE, outside the transaction (isFlagEnabled()
    // has its own cache()/connection, not `tx`); the category read itself
    // happens INSIDE the same withOrgContext transaction as the toggle read
    // below, so composing two axes costs one transaction, not two.
    const catalogEntry = ORG_FEATURE_CATALOG.find((entry) => entry.key === key);
    const categoryAxisOn = catalogEntry ? await isCategoryAxisOn() : false;

    return withOrgContext(personId, organizationId, (tx) =>
      orgFeatureEnabledInTx(tx, organizationId, key, categoryAxisOn),
    );
  },
);

/**
 * The category-axis kill switch (`org_portal.feature_categories`), read ONCE
 * and OUTSIDE any transaction — `isFlagEnabled()` runs on its own connection,
 * so calling it inside a `withOrgContext` callback would hold two connections
 * for one request. Callers that compose several gates in one transaction (the
 * member calendar read path) read this first, then pass the boolean to
 * `orgFeatureEnabledInTx`.
 */
export function isCategoryAxisOn(): Promise<boolean> {
  return isFlagEnabled(CATEGORY_AXIS_FLAG);
}

/**
 * The in-transaction half of `isOrgFeatureEnabled`: category (only when the
 * axis is on and `key` is a catalog entry) -> toggle row. Missing toggle row
 * -> `false`, unconditionally (DECISION-097): a code default must never be
 * able to flip every org that has no row.
 *
 * Does NOT read the entry's platform `flag`. That is the call site's job:
 * `entry.flag === null || await isFlagEnabled(entry.flag)`, then this, then the
 * permission. `isOrgFeatureEnabled` itself still reads only the category axis,
 * which is why the existing `admin/community/**` call sites — which already do
 * `isFlagEnabled(KEY)` first — need no change.
 */
export async function orgFeatureEnabledInTx(
  tx: OrgTx,
  organizationId: string,
  key: string,
  categoryAxisOn: boolean,
): Promise<boolean> {
  const catalogEntry = ORG_FEATURE_CATALOG.find((entry) => entry.key === key);
  // Applicability first (online-giving): an inapplicable organization type is
  // OFF no matter what row exists — a stray `org_portal.giving` row at a
  // presbytery must not enable anything. One read, and only for an entry that
  // actually carries an allow-list, so calendar/people pay nothing.
  if (catalogEntry && catalogEntry.orgTypes !== null) {
    const organizationType = await readOrganizationTypeInTx(tx, organizationId);
    if (!orgTypeAdmitted(catalogEntry.orgTypes, organizationType)) return false;
  }
  if (catalogEntry && categoryAxisOn) {
    const categoryEnabled = await categoryEnabledInTx(
      tx,
      organizationId,
      catalogEntry.category,
    );
    if (!categoryEnabled) {
      // A category-off result short-circuits to false without the second
      // round trip to organization_feature_toggles.
      return false;
    }
  }

  const [row] = await tx
    .select({ enabled: organizationFeatureToggles.enabled })
    .from(organizationFeatureToggles)
    .where(
      and(
        eq(organizationFeatureToggles.organizationId, organizationId),
        eq(organizationFeatureToggles.featureKey, key),
      ),
    )
    .limit(1);
  return row?.enabled ?? false;
}

export interface FeatureToggleEntry {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  /** ISO-8601, or `null` when the org has never toggled this key. */
  updatedAt: string | null;
  updatedByEmail: string | null;
  /** Feature-categories axis (DECISION-130). */
  category: OrgFeatureCategory;
  categoryLabel: string;
  /** `true` when `org_portal.feature_categories` is off (axis inert) or
   * when the category resolves enabled; `false` only when the flag is on
   * AND an explicit off row exists for this entry's category. */
  categoryEnabled: boolean;
}

export type ListFeatureTogglesResult =
  | { kind: "ok"; toggles: FeatureToggleEntry[] }
  | { kind: "forbidden" };

interface ToggleRow {
  feature_key: string;
  enabled: boolean;
  updated_at: string;
  updated_by_email: string | null;
}

/**
 * Every catalog entry, with this org's current state — a missing row
 * defaults to `enabled: false`, same convention as the resolver, so the
 * admin page never has to special-case "never toggled" vs "explicitly off".
 */
export async function listFeatureToggles(
  viewerPersonId: string,
  organizationId: string,
): Promise<ListFeatureTogglesResult> {
  // Same "read the flag once, outside the transaction" shape as
  // isOrgFeatureEnabled() above.
  const categoryAxisOn = await isCategoryAxisOn();

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasOrgFeaturesManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const result = await tx.execute(sql`
      select ft.feature_key as feature_key,
             ft.enabled as enabled,
             to_json(ft.updated_at) #>> '{}' as updated_at,
             u.email as updated_by_email
        from organization_feature_toggles ft
        left join users u on u.id = ft.updated_by
       where ft.organization_id = ${organizationId}::uuid
    `);
    const rows = (result as unknown as { rows?: ToggleRow[] }).rows ?? [];
    const byKey = new Map(rows.map((row) => [row.feature_key, row]));

    // One category read per DISTINCT category (today just "people"), cached
    // for the duration of this call — never one read per catalog entry.
    const categoryCache = new Map<OrgFeatureCategory, boolean>();
    async function categoryEnabledCached(
      category: OrgFeatureCategory,
    ): Promise<boolean> {
      if (!categoryAxisOn) return true;
      let cached = categoryCache.get(category);
      if (cached === undefined) {
        cached = await categoryEnabledInTx(tx, organizationId, category);
        categoryCache.set(category, cached);
      }
      return cached;
    }

    // Applicability (online-giving): omit entries that do not apply to this
    // organization's type. One read, only when some entry has an allow-list.
    const organizationType = CATALOG_HAS_ORG_TYPE_RULES
      ? await readOrganizationTypeInTx(tx, organizationId)
      : null;
    // Operator-only entries (Q1) are not a tenant control and never listed.
    const applicable = ORG_FEATURE_CATALOG.filter(
      (entry) =>
        !entry.operatorEnabled && orgTypeAdmitted(entry.orgTypes, organizationType),
    );

    const toggles: FeatureToggleEntry[] = await Promise.all(
      applicable.map(async (entry) => {
        const row = byKey.get(entry.key);
        return {
          key: entry.key,
          name: entry.name,
          description: entry.description,
          enabled: row?.enabled ?? false,
          updatedAt: row?.updated_at ?? null,
          updatedByEmail: row?.updated_by_email ?? null,
          category: entry.category,
          categoryLabel: DOMAIN_LABELS[entry.category],
          categoryEnabled: await categoryEnabledCached(entry.category),
        };
      }),
    );

    return { kind: "ok", toggles };
  });
}

export type ToggleOrgFeatureResult =
  | { kind: "ok" }
  | { kind: "forbidden" }
  | { kind: "invalid_key" };

/**
 * Turns `key` on or off for `organizationId`. Gated on `org_features.manage`
 * (checked inside the same transaction as the write, same discipline as
 * every other module in this tree). Rejects a `key` outside
 * `ORG_FEATURE_CATALOG` with `invalid_key` — an expected outcome, not a
 * crash, same "expected outcome, not a thrown error" contract `grantRole`'s
 * `invalid_role` establishes.
 *
 * `recordAudit()` is called from HERE, not from a co-located `actions.ts` —
 * a deliberate divergence from `role-grants.ts`/`admin/roles/actions.ts`'s
 * split (lib does the check+write, the Server Action does the audit+
 * revalidate). This Phase 4 pass builds no `actions.ts` files at all (those
 * are the next agent's UI-layer work per this pipeline's task split), and
 * `org_features.manage` is a permission/access-control-adjacent mutation
 * that must never ship un-audited — see the work-log's Phase 4 note.
 * Audited AFTER the transaction commits (`result.kind === "ok"`, checked
 * outside `withOrgContext`), so a row is never recorded for a write that
 * rolled back.
 */
export async function toggleOrgFeature(
  actorPersonId: string,
  organizationId: string,
  actorUserId: string,
  key: string,
  enabled: boolean,
): Promise<ToggleOrgFeatureResult> {
  if (!isCatalogKey(key)) {
    return { kind: "invalid_key" };
  }

  const result = await withOrgContext(
    actorPersonId,
    organizationId,
    async (tx): Promise<ToggleOrgFeatureResult> => {
      if (!(await hasOrgFeaturesManage(tx, actorPersonId, organizationId))) {
        return { kind: "forbidden" };
      }

      // Applicability (online-giving): a key that exists in the catalog but
      // does not apply to this organization's type is, for THIS organization,
      // not a key — the same `invalid_key` an unknown string gets, so a
      // presbytery can never write a giving toggle row. After the permission
      // check, so a non-holder learns nothing from the difference.
      const entry = ORG_FEATURE_CATALOG.find((e) => e.key === key);
      // Operator-only (Q1): for a tenant, not a key - the same `invalid_key` an
      // unknown string gets, after the permission check so a non-holder learns
      // nothing from the difference. The platform path is
      // src/lib/domains/toggles.ts.
      if (entry?.operatorEnabled) return { kind: "invalid_key" };
      if (entry && entry.orgTypes !== null) {
        const organizationType = await readOrganizationTypeInTx(
          tx,
          organizationId,
        );
        if (!orgTypeAdmitted(entry.orgTypes, organizationType)) {
          return { kind: "invalid_key" };
        }
      }

      await tx
        .insert(organizationFeatureToggles)
        .values({
          organizationId,
          featureKey: key,
          enabled,
          updatedBy: actorUserId,
        })
        .onConflictDoUpdate({
          target: [
            organizationFeatureToggles.organizationId,
            organizationFeatureToggles.featureKey,
          ],
          set: { enabled, updatedBy: actorUserId, updatedAt: new Date() },
        });

      return { kind: "ok" };
    },
  );

  if (result.kind === "ok") {
    await recordAudit({
      action: AUDIT_ACTIONS.ORG_FEATURE_TOGGLED,
      resourceType: "organization_feature_toggle",
      resourceId: key,
      metadata: { organizationId, featureKey: key, enabled },
    });
  }

  return result;
}
