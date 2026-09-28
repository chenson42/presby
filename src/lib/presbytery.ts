import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { organizations } from "@/lib/db/domain/org";
import {
  congregationOversight,
  congregationStatistics,
  perCapitaRates,
  perCapitaRecords,
} from "@/lib/db/domain/presbytery";

/**
 * Presbytery-owned operational data — Increments 3 (congregation oversight)
 * and 3b (congregation statistics, presbytery-entered, + per-capita), Phase
 * 3 design in `docs/work-log/2026-08-27-presbytery-program.md`, schema in
 * `docs/work-log/2026-08-27-presbytery-oversight-statistics.md`
 * (DECISION-118 through 121).
 *
 * SAME SHAPE as `src/lib/credentials.ts`/`src/lib/person-sensitive.ts`: one
 * `withOrgContext()` transaction per exported function, a permission gate
 * checked FIRST inside every one of them, thrown exceptions reserved for
 * genuine failure (`OrgAccessError`, a malformed date/enum), every expected/
 * denied outcome a typed `PresbyteryResult` variant.
 *
 * THREE PERMISSIONS, never merged into one (Phase 3's own table):
 * `congregation_oversight.manage` (no default binding, DECISION-119),
 * `statistics.manage`, `per_capita.manage` (both bind to
 * `presbytery_stated_clerk`). The local `hasPermission()` helper below is
 * parameterized by permission key — same multi-permission shape
 * `person-sensitive.ts` already established (four independent keys sharing
 * one helper), NOT `credentials.ts`'s single-`CREDENTIALS_MANAGE` shape,
 * because this module has three.
 *
 * THE PARENT-PATH CHECK (`resolveMemberCongregation`, same adversarial
 * finding `recordAppointment`'s `servingOrgId` check documents): every
 * `aboutOrgId` accepted from a caller is re-resolved to an `organizations`
 * row whose `parentId` is THIS presbytery and whose `organizationType` is
 * `'congregation'` — never trusted as a bare id. A congregation belonging to
 * a DIFFERENT presbytery is rejected the same as a nonexistent id, both as
 * `invalid_target`.
 *
 * CONGREGATION-ONLY, NOT `new_worshiping_community` (a narrower scope than
 * `credentials.ts`'s `SERVING_ORG_TYPES`, which also admits NWCs) — Phase
 * 3's own API Contract spells the oversight validation out literally as
 * `organization_type = 'congregation'`, and 3b's statistics/per-capita follow
 * "the same pattern" per the Component/Page Plan. Read as the letter of the
 * design rather than silently widened; worth revisiting if a presbytery
 * asks to track an NWC's viability or statistics the same way.
 *
 * STATISTICS PROVENANCE COALESCE (`fetchStatisticsForYear`): for a given
 * (aboutOrgId, year), a `published_by_congregation` row — if one exists AND
 * IS NOT WITHDRAWN — always wins the display, even though the presbytery's
 * own `presbytery_entered`/`imported` row (if any) is never deleted (Phase 1
 * §3). Multiple `published_by_congregation` rows can exist for the same
 * year (a republish is a new frozen row whose PUBLICATION chains to the one
 * it corrects via `publications.supersedesId` — drizzle/0047 — rather than
 * either row being updated in place) — the one with the latest `publishedAt`
 * is the current one; this module never needs to walk the chain itself, only
 * pick its head, which is why the chain moving off this table changed
 * nothing here.
 *
 * WITHDRAWAL (DECISION-152, `drizzle/0052_presby_withdraw_publication.sql`,
 * 2026-09-26): `fetchStatisticsForYear`'s WHERE clause filters
 * `withdrawnAt is null` directly, not the coalesce branch above — a withdrawn
 * published row is excluded from the candidate set entirely, so it can never
 * win the coalesce even as the sole row on file. The practical effect: a
 * withdrawn return is treated as ABSENT for the "current" pick, and the
 * coalesce falls through to a live `presbytery_entered`/`imported` row for
 * that congregation/year if one exists, or to `hasData: false` if none does
 * — never to the withdrawn row itself. This propagates automatically to
 * `generatePerCapitaRecords()` (same helper): a withdrawn return stops being
 * a basis for a NEW bill, while a bill already issued off it before the
 * withdrawal is untouched (per-capita generation never overwrites an
 * existing record, this file's own rule below). The withdrawn row itself is
 * never deleted and stays fully readable — Option A (F52/DECISION-140) — via
 * `src/lib/filings.ts`'s own tenant-policy read (the congregation's own
 * history) and `presby_list_published_returns_to_me()` (the presbytery's
 * archival read of everything addressed to it); this function's contract is
 * narrowly "the current pick only," and teaching it to ALSO carry "a
 * withdrawn return exists for this congregation/year" would be the
 * one-column-two-facts error (F39) this design refuses everywhere else.
 *
 * CORE SASR FIELDS ONLY (LEAN CALL, same discipline the schema file itself
 * uses for race/officer breakdowns): `SasrAggregateInput`/
 * `StatisticsRollupRow` expose ending rolls, gains, losses, worship
 * attendance, giving-unit count, baptisms, and officer counts — not the
 * full ~50-column age/gender/race/disability/financial breakdown
 * `congregation_statistics` carries. No consumer in this increment (3b's
 * own list, a future dashboard) needs the finer breakdown yet; the DB
 * columns exist for import/4a to use later. Revisit if a future increment
 * needs to enter or display them.
 *
 * PER-CAPITA GENERATION NEVER OVERWRITES AN EXISTING RECORD
 * (`generatePerCapitaRecords`) — Phase 3 Edge Cases' "republish-after-
 * billing" note draws a hard line between a correction (a deliberate,
 * one-record, presbytery action — not built in this increment) and a
 * batch regenerate (this function), which must never silently clobber a
 * bill already issued (and possibly already paid). An existing row for
 * (organizationId, aboutOrgId, billingYear) is skipped and named, exactly
 * like a congregation with no statistics on file for the basis year.
 */

const CONGREGATION_OVERSIGHT_MANAGE = "congregation_oversight.manage";
const STATISTICS_MANAGE = "statistics.manage";
const PER_CAPITA_MANAGE = "per_capita.manage";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MIN = 1900;
const YEAR_MAX = 2100;
const FREE_TEXT_MAX = 4000; // redevelopmentNotes / buildingsNotes
const SHORT_TEXT_MAX = 255; // insuranceCarrier
const MINUTE_REFERENCE_MAX = 500;

/** Same shape as `CredentialsResult`/`SetPersonDemographicsResult` — every
 *  expected/denied outcome is a typed variant, never a thrown exception. */
export type PresbyteryResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "invalid_target" }
  | { kind: "invalid_input"; message: string };

/**
 * Walks the `.cause` chain Drizzle/the neon driver hangs off a thrown error
 * — same helper, same reasoning, as `src/lib/filings.ts`'s and
 * `src/lib/statistics-grants.ts`'s own `pgErrorInfo()` (per-module
 * duplication is this codebase's own established convention for it, both
 * existing copies say so explicitly — see this function's Phase 3 design
 * note in the work-log, not a shared import).
 */
function pgErrorInfo(err: unknown): { code: string | undefined; message: string } {
  const messages: string[] = [];
  let code: string | undefined;
  let current: unknown = err;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (current instanceof Error) messages.push(current.message);
    if (
      code === undefined &&
      typeof current === "object" &&
      current !== null &&
      "code" in current
    ) {
      const c = (current as { code?: unknown }).code;
      if (typeof c === "string") code = c;
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return { code, message: messages.join(" :: ") };
}

/** Safe substring of `presby_deny_about_org_write()`'s parameterized literal
 *  (drizzle/0045, `presby_check_about_org_affiliated()` ← the
 *  `congregation_statistics_about_org` trigger) — matched with `.includes()`
 *  because the message carries the table name and as-of year, never
 *  asserted verbatim. Same idiom as `filings.ts`'s
 *  `ALREADY_WITHDRAWN_MARKER`/`SUPERSEDED_MARKER`. */
const NOT_AFFILIATED_MARKER = "was not affiliated with this council as of";

/**
 * Local, parameterized-by-key gate — same shape `person-sensitive.ts`
 * defines for its own four independent permissions, not `credentials.ts`'s
 * single-permission-only helper.
 */
async function hasPermission(
  tx: OrgTx,
  personId: string,
  organizationId: string,
  permissionKey: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid,
             ${organizationId}::uuid,
             ${permissionKey}
           ) as allowed
  `);
  return (
    (result as unknown as { rows?: Array<{ allowed?: boolean }> }).rows?.[0]
      ?.allowed === true
  );
}

/**
 * The parent-path check every `aboutOrgId` goes through before a write (and
 * before a single-congregation detail read) — never a bare client-supplied
 * id. See this file's header for why the type check is `'congregation'`
 * only.
 */
async function resolveMemberCongregation(
  tx: OrgTx,
  organizationId: string,
  aboutOrgId: string,
): Promise<{ id: string; name: string; platformStatus: string } | null> {
  const [row] = await tx
    .select({
      id: organizations.id,
      name: organizations.name,
      platformStatus: organizations.platformStatus,
    })
    .from(organizations)
    .where(
      and(
        eq(organizations.id, aboutOrgId),
        eq(organizations.parentId, organizationId),
        eq(organizations.organizationType, "congregation"),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Every member congregation of this presbytery — the base row set both
 *  `getCongregationOversightList` and `getCongregationStatisticsRollup`
 *  left-join their own table against, so a congregation with NO oversight/
 *  statistics row on file still appears (the "no data on file" empty
 *  state, Phase 3 Edge Cases). */
async function listMemberCongregations(
  tx: OrgTx,
  organizationId: string,
): Promise<Array<{ id: string; name: string; platformStatus: string }>> {
  return tx
    .select({
      id: organizations.id,
      name: organizations.name,
      platformStatus: organizations.platformStatus,
    })
    .from(organizations)
    .where(
      and(
        eq(organizations.parentId, organizationId),
        eq(organizations.organizationType, "congregation"),
      ),
    )
    .orderBy(organizations.name);
}

/** One presbytery's per-congregation eligible report-year window, keyed by
 *  `subjectOrgId`. `null` on either side means unbounded on that side
 *  (still-affiliated-since-forever / currently affiliated, no end) — see
 *  this function's own reduction rule below. A congregation absent from the
 *  returned map has no affiliation row at all reachable from this presbytery
 *  and should be treated as UNCONSTRAINED (orchestrator ruling 3), not as
 *  "no eligible year." */
interface AffiliationWindow {
  minYear: number | null;
  maxYear: number | null;
}

/**
 * Reads `organization_affiliations_public` (drizzle/0044), not the base
 * `organization_affiliations` table and not `presby_org_affiliated()` in a
 * per-year loop — see this pipeline's work-log Phase 3 Design (a) for why
 * both alternatives are wrong here: the base table's tenant policy filters
 * on the RECORDING council, not the parent, so a presbytery's own
 * `withOrgContext()` read can silently miss a span it did not itself record;
 * a per-year `presby_org_affiliated()` loop would need up to 200 round trips
 * per congregation to find a boundary this one aggregate query answers.
 *
 * WINDOW MATH — the day-before-`effective_to` rule. The about-org trigger
 * accepts a year if EITHER Jan 1 or Dec 31 of that year falls inside
 * `[effective_from, effective_to)` (drizzle/0044:711-716, reused verbatim at
 * drizzle/0049:487-491). That means: `minYear = year(effective_from)` (Dec 31
 * of the start year is always >= effective_from, whatever day mid-year it
 * lands on, so the OR always passes for that year); `maxYear =
 * year(effective_to - 1 day)`, NOT `year(effective_to)` — the range is
 * half-open, so a departure exactly on January 1 excludes that whole year,
 * and subtracting a day before taking the year reproduces the OR-of-both-
 * endpoints check exactly rather than being off by one in that edge case.
 *
 * Reduces ACROSS EVERY SPAN for a subject (a congregation that left and
 * rejoined) to the min of every bounded `minYear` and the max of every
 * bounded `maxYear` — the envelope, not the precise union. A gap year in
 * between is not visibly disabled by this window; (c) below still refuses a
 * gap-year submission correctly. Named and accepted in the work-log rather
 * than built exactly — revisit only if this actually bites a real
 * redistricted-and-returned congregation.
 *
 * EXPORTED for direct testing (Phase 4 loop-back, 2026-09-28 — QA's named
 * coverage gap 1). It cannot be pinned through `getCongregationStatistics
 * Rollup()` itself: a subject only appears in that rollup's output when
 * `organizations.parentId === organizationId`, which requires an OPEN
 * (`effective_to is null`) span to that exact parent — and this function's
 * own reduction rule ("any unbounded span forces that side to null," above)
 * means a subject with an open span to `organizationId` ALWAYS gets
 * `maxYear: null` from THIS function too. So a bounded, non-null `maxYear`
 * can only ever be produced for a subject with NO open span to
 * `organizationId` — which by construction is a subject `getCongregation
 * StatisticsRollup()` never lists (confirmed empirically against the seeded
 * Quillhaven/Southern-Fields fixture before writing this comment: Southern
 * Fields' own `listMemberCongregations()` query returns zero rows for
 * Quillhaven, even though `organization_affiliations_public` still carries
 * its closed span there). The day-before-`effective_to` arithmetic and the
 * multi-span envelope reduction are real, live code paths — just not ones
 * `getCongregationStatisticsRollup()` can observe a bounded value from —
 * so `presbytery.test.ts` calls this function directly.
 */
export async function fetchAffiliationWindows(
  tx: OrgTx,
  organizationId: string,
): Promise<Map<string, AffiliationWindow>> {
  const result = await tx.execute(sql`
    select subject_org_id, effective_from, effective_to
      from organization_affiliations_public
     where parent_org_id = ${organizationId}::uuid
  `);
  const rows =
    (
      result as unknown as {
        rows?: Array<{
          subject_org_id: string;
          effective_from: string | null;
          effective_to: string | null;
        }>;
      }
    ).rows ?? [];

  const windows = new Map<string, AffiliationWindow>();
  for (const row of rows) {
    const minYear = row.effective_from
      ? new Date(`${row.effective_from}T00:00:00Z`).getUTCFullYear()
      : null;
    const maxYear = row.effective_to
      ? new Date(
          new Date(`${row.effective_to}T00:00:00Z`).getTime() - 24 * 60 * 60 * 1000,
        ).getUTCFullYear()
      : null;

    const existing = windows.get(row.subject_org_id);
    if (!existing) {
      windows.set(row.subject_org_id, { minYear, maxYear });
      continue;
    }
    existing.minYear =
      existing.minYear === null || minYear === null
        ? null
        : Math.min(existing.minYear, minYear);
    existing.maxYear =
      existing.maxYear === null || maxYear === null
        ? null
        : Math.max(existing.maxYear, maxYear);
  }
  return windows;
}

// ---------------------------------------------------------------------------
// Congregation oversight (Increment 3)
// ---------------------------------------------------------------------------

export interface OversightRow {
  organizationId: string;
  name: string;
  platformStatus: string;
  hasData: boolean;
  viabilityScore: number | null;
  redevelopmentNotes: string | null;
  buildingsNotes: string | null;
  insuranceCarrier: string | null;
  /** 'YYYY-MM-DD', or null. */
  insuranceExpiresOn: string | null;
  latitude: string | null;
  longitude: string | null;
  updatedAt: string | null;
}

/** Every child congregation of this presbytery, joined against its
 *  (possibly absent) `congregation_oversight` row. */
export async function getCongregationOversightList(
  viewerPersonId: string,
  organizationId: string,
): Promise<PresbyteryResult<OversightRow[]>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasPermission(tx, viewerPersonId, organizationId, CONGREGATION_OVERSIGHT_MANAGE))) {
      return { kind: "forbidden" };
    }

    const congregations = await listMemberCongregations(tx, organizationId);
    if (congregations.length === 0) {
      return { kind: "ok", data: [] };
    }

    const oversightRows = await tx
      .select()
      .from(congregationOversight)
      .where(
        and(
          eq(congregationOversight.organizationId, organizationId),
          inArray(
            congregationOversight.aboutOrgId,
            congregations.map((c) => c.id),
          ),
        ),
      );
    const byAboutOrg = new Map(oversightRows.map((r) => [r.aboutOrgId, r]));

    const data: OversightRow[] = congregations.map((cong) => {
      const row = byAboutOrg.get(cong.id);
      return {
        organizationId: cong.id,
        name: cong.name,
        platformStatus: cong.platformStatus,
        hasData: row !== undefined,
        viabilityScore: row?.viabilityScore ?? null,
        redevelopmentNotes: row?.redevelopmentNotes ?? null,
        buildingsNotes: row?.buildingsNotes ?? null,
        insuranceCarrier: row?.insuranceCarrier ?? null,
        insuranceExpiresOn: row?.insuranceExpiresOn ?? null,
        latitude: row?.latitude ?? null,
        longitude: row?.longitude ?? null,
        updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
      };
    });

    return { kind: "ok", data };
  });
}

/** A single congregation's oversight record, for the detail/edit page.
 *  `invalid_target` when `aboutOrgId` isn't an actual member congregation
 *  of this presbytery — same parent-path discipline as every write below. */
export async function getCongregationOversightDetail(
  viewerPersonId: string,
  organizationId: string,
  aboutOrgId: string,
): Promise<PresbyteryResult<OversightRow>> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasPermission(tx, viewerPersonId, organizationId, CONGREGATION_OVERSIGHT_MANAGE))) {
      return { kind: "forbidden" };
    }

    const cong = await resolveMemberCongregation(tx, organizationId, aboutOrgId);
    if (!cong) return { kind: "invalid_target" };

    const [row] = await tx
      .select()
      .from(congregationOversight)
      .where(
        and(
          eq(congregationOversight.organizationId, organizationId),
          eq(congregationOversight.aboutOrgId, aboutOrgId),
        ),
      )
      .limit(1);

    return {
      kind: "ok",
      data: {
        organizationId: cong.id,
        name: cong.name,
        platformStatus: cong.platformStatus,
        hasData: row !== undefined,
        viabilityScore: row?.viabilityScore ?? null,
        redevelopmentNotes: row?.redevelopmentNotes ?? null,
        buildingsNotes: row?.buildingsNotes ?? null,
        insuranceCarrier: row?.insuranceCarrier ?? null,
        insuranceExpiresOn: row?.insuranceExpiresOn ?? null,
        latitude: row?.latitude ?? null,
        longitude: row?.longitude ?? null,
        updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
      },
    };
  });
}

export interface SetOversightInput {
  viabilityScore?: number | null;
  redevelopmentNotes?: string | null;
  buildingsNotes?: string | null;
  insuranceCarrier?: string | null;
  /** 'YYYY-MM-DD', or null. */
  insuranceExpiresOn?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/** Upsert on `(organizationId, aboutOrgId)` — ONE mutable row per
 *  congregation, like `organization_profiles` (no history table; see the
 *  schema file's own header for why). */
export async function setCongregationOversight(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  aboutOrgId: string,
  input: SetOversightInput,
): Promise<PresbyteryResult<{ id: string }>> {
  if (
    input.viabilityScore !== undefined &&
    input.viabilityScore !== null &&
    (!Number.isInteger(input.viabilityScore) ||
      input.viabilityScore < 1 ||
      input.viabilityScore > 3)
  ) {
    return {
      kind: "invalid_input",
      message: "Viability score must be 1, 2, or 3.",
    };
  }
  if (
    input.insuranceExpiresOn !== undefined &&
    input.insuranceExpiresOn !== null &&
    !DATE_RE.test(input.insuranceExpiresOn)
  ) {
    return {
      kind: "invalid_input",
      message: "Insurance expiration must be a valid date.",
    };
  }
  if (
    input.redevelopmentNotes !== undefined &&
    input.redevelopmentNotes !== null &&
    input.redevelopmentNotes.length > FREE_TEXT_MAX
  ) {
    return {
      kind: "invalid_input",
      message: `Redevelopment notes must be ${FREE_TEXT_MAX} characters or fewer.`,
    };
  }
  if (
    input.buildingsNotes !== undefined &&
    input.buildingsNotes !== null &&
    input.buildingsNotes.length > FREE_TEXT_MAX
  ) {
    return {
      kind: "invalid_input",
      message: `Buildings notes must be ${FREE_TEXT_MAX} characters or fewer.`,
    };
  }
  if (
    input.insuranceCarrier !== undefined &&
    input.insuranceCarrier !== null &&
    input.insuranceCarrier.length > SHORT_TEXT_MAX
  ) {
    return {
      kind: "invalid_input",
      message: `Insurance carrier must be ${SHORT_TEXT_MAX} characters or fewer.`,
    };
  }
  if (
    input.latitude !== undefined &&
    input.latitude !== null &&
    (input.latitude < -90 || input.latitude > 90)
  ) {
    return { kind: "invalid_input", message: "Latitude must be between -90 and 90." };
  }
  if (
    input.longitude !== undefined &&
    input.longitude !== null &&
    (input.longitude < -180 || input.longitude > 180)
  ) {
    return { kind: "invalid_input", message: "Longitude must be between -180 and 180." };
  }

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasPermission(tx, viewerPersonId, organizationId, CONGREGATION_OVERSIGHT_MANAGE))) {
      return { kind: "forbidden" };
    }

    const cong = await resolveMemberCongregation(tx, organizationId, aboutOrgId);
    if (!cong) return { kind: "invalid_target" };

    const values = {
      viabilityScore: input.viabilityScore ?? null,
      redevelopmentNotes: input.redevelopmentNotes ?? null,
      buildingsNotes: input.buildingsNotes ?? null,
      insuranceCarrier: input.insuranceCarrier ?? null,
      insuranceExpiresOn: input.insuranceExpiresOn ?? null,
      latitude:
        input.latitude === undefined || input.latitude === null
          ? null
          : String(input.latitude),
      longitude:
        input.longitude === undefined || input.longitude === null
          ? null
          : String(input.longitude),
      updatedBy: actingUserId,
    };

    const [row] = await tx
      .insert(congregationOversight)
      .values({ organizationId, aboutOrgId, ...values })
      .onConflictDoUpdate({
        target: [congregationOversight.organizationId, congregationOversight.aboutOrgId],
        set: { ...values, updatedAt: new Date() },
      })
      .returning({ id: congregationOversight.id });

    return { kind: "ok", data: { id: row!.id } };
  });
}

// ---------------------------------------------------------------------------
// Congregation statistics (Increment 3b, presbytery-entered)
// ---------------------------------------------------------------------------

/** Core SASR aggregate fields this increment's form/rollup covers — see
 *  this file's header for why the full ~50-column set is not exposed yet. */
export interface SasrAggregateInput {
  minuteReference?: string | null;
  gainsProfessionsUnder18?: number | null;
  gainsProfessions18Plus?: number | null;
  gainsCertificate?: number | null;
  gainsOther?: number | null;
  lossesCertificate?: number | null;
  lossesDeaths?: number | null;
  lossesOther?: number | null;
  endingActive?: number | null;
  endingBaptized?: number | null;
  endingAffiliate?: number | null;
  endingOtherParticipants?: number | null;
  avgWeeklyWorshipAttendance?: number | null;
  potentialGivingUnits?: number | null;
  baptismsChildren?: number | null;
  baptismsAdults?: number | null;
  officersRulingElderCount?: number | null;
  officersDeaconCount?: number | null;
}

const NONNEG_INT_FIELDS = [
  "gainsProfessionsUnder18",
  "gainsProfessions18Plus",
  "gainsCertificate",
  "gainsOther",
  "lossesCertificate",
  "lossesDeaths",
  "lossesOther",
  "endingActive",
  "endingBaptized",
  "endingAffiliate",
  "endingOtherParticipants",
  "avgWeeklyWorshipAttendance",
  "potentialGivingUnits",
  "baptismsChildren",
  "baptismsAdults",
  "officersRulingElderCount",
  "officersDeaconCount",
] as const satisfies readonly (keyof SasrAggregateInput)[];

function validateSasrAggregateInput(
  input: SasrAggregateInput,
): { message: string } | null {
  for (const field of NONNEG_INT_FIELDS) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    if (!Number.isInteger(value) || value < 0) {
      return { message: `${field} must be a non-negative whole number.` };
    }
  }
  if (
    input.minuteReference !== undefined &&
    input.minuteReference !== null &&
    input.minuteReference.length > MINUTE_REFERENCE_MAX
  ) {
    return {
      message: `Minute reference must be ${MINUTE_REFERENCE_MAX} characters or fewer.`,
    };
  }
  return null;
}

export type StatisticsProvenance =
  | "presbytery_entered"
  | "published_by_congregation"
  | "imported";

export interface StatisticsRollupRow extends SasrAggregateInput {
  organizationId: string;
  name: string;
  platformStatus: string;
  year: number;
  hasData: boolean;
  provenance: StatisticsProvenance | null;
  publishedAt: string | null;
  /** This congregation's affiliation window with the presbytery, per
   *  `fetchAffiliationWindows()` — `null` on either side means unbounded on
   *  that side, and BOTH `null` (no affiliation row reachable at all) means
   *  the year picker should render unconstrained, not "no eligible year"
   *  (orchestrator ruling 3). */
  affiliationMinYear: number | null;
  affiliationMaxYear: number | null;
}

/** The provenance-coalesce read shared by 3b's own list and (per Phase 3's
 *  Sequencing) a future dashboard rollup — and, since DECISION-152, by
 *  `generatePerCapitaRecords()`'s basis-year lookup as well. See this file's
 *  header for the precedence rule. `withdrawnAt is null` is filtered HERE, in
 *  the WHERE, not in the coalesce branch below: a withdrawn
 *  `published_by_congregation` row must never be a CANDIDATE for "current,"
 *  not merely lose a tie-break it could otherwise still win as the only row
 *  on file. */
async function fetchStatisticsForYear(
  tx: OrgTx,
  organizationId: string,
  year: number,
): Promise<Map<string, typeof congregationStatistics.$inferSelect>> {
  const rows = await tx
    .select()
    .from(congregationStatistics)
    .where(
      and(
        eq(congregationStatistics.organizationId, organizationId),
        eq(congregationStatistics.year, year),
        isNull(congregationStatistics.withdrawnAt),
      ),
    )
    .orderBy(desc(congregationStatistics.publishedAt));

  const byAboutOrg = new Map<string, typeof congregationStatistics.$inferSelect>();
  for (const row of rows) {
    const existing = byAboutOrg.get(row.aboutOrgId);
    if (!existing) {
      byAboutOrg.set(row.aboutOrgId, row);
      continue;
    }
    // A published row always wins over a presbytery_entered/imported one
    // for the same congregation+year — rows are already ordered by
    // publishedAt desc, so the FIRST published row seen per congregation is
    // the current one; a non-published row already stored is replaced once
    // a published row is found (order of arrival is not guaranteed to put
    // published rows first when none exist yet for a congregation).
    if (
      row.provenance === "published_by_congregation" &&
      existing.provenance !== "published_by_congregation"
    ) {
      byAboutOrg.set(row.aboutOrgId, row);
    }
  }
  return byAboutOrg;
}

function toRollupRow(
  cong: { id: string; name: string; platformStatus: string },
  year: number,
  row: typeof congregationStatistics.$inferSelect | undefined,
  affiliationWindow: AffiliationWindow | undefined,
): StatisticsRollupRow {
  return {
    organizationId: cong.id,
    name: cong.name,
    platformStatus: cong.platformStatus,
    year,
    hasData: row !== undefined,
    provenance: (row?.provenance as StatisticsProvenance | undefined) ?? null,
    publishedAt: row?.publishedAt ? row.publishedAt.toISOString() : null,
    affiliationMinYear: affiliationWindow?.minYear ?? null,
    affiliationMaxYear: affiliationWindow?.maxYear ?? null,
    minuteReference: row?.minuteReference ?? null,
    gainsProfessionsUnder18: row?.gainsProfessionsUnder18 ?? null,
    gainsProfessions18Plus: row?.gainsProfessions18Plus ?? null,
    gainsCertificate: row?.gainsCertificate ?? null,
    gainsOther: row?.gainsOther ?? null,
    lossesCertificate: row?.lossesCertificate ?? null,
    lossesDeaths: row?.lossesDeaths ?? null,
    lossesOther: row?.lossesOther ?? null,
    endingActive: row?.endingActive ?? null,
    endingBaptized: row?.endingBaptized ?? null,
    endingAffiliate: row?.endingAffiliate ?? null,
    endingOtherParticipants: row?.endingOtherParticipants ?? null,
    avgWeeklyWorshipAttendance: row?.avgWeeklyWorshipAttendance ?? null,
    potentialGivingUnits: row?.potentialGivingUnits ?? null,
    baptismsChildren: row?.baptismsChildren ?? null,
    baptismsAdults: row?.baptismsAdults ?? null,
    officersRulingElderCount: row?.officersRulingElderCount ?? null,
    officersDeaconCount: row?.officersDeaconCount ?? null,
  };
}

/** Every child congregation of this presbytery, joined against its
 *  provenance-coalesced statistics row for `year` (possibly absent — the
 *  "no data on file" empty state). */
export async function getCongregationStatisticsRollup(
  viewerPersonId: string,
  organizationId: string,
  year: number,
): Promise<PresbyteryResult<StatisticsRollupRow[]>> {
  if (!Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX) {
    return { kind: "invalid_input", message: "Enter a valid statistical year." };
  }

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasPermission(tx, viewerPersonId, organizationId, STATISTICS_MANAGE))) {
      return { kind: "forbidden" };
    }

    const congregations = await listMemberCongregations(tx, organizationId);
    if (congregations.length === 0) return { kind: "ok", data: [] };

    const [byAboutOrg, affiliationWindows] = await Promise.all([
      fetchStatisticsForYear(tx, organizationId, year),
      fetchAffiliationWindows(tx, organizationId),
    ]);
    const data = congregations.map((cong) =>
      toRollupRow(
        cong,
        year,
        byAboutOrg.get(cong.id),
        affiliationWindows.get(cong.id),
      ),
    );

    return { kind: "ok", data };
  });
}

export interface PublishedFilingRow {
  publicationId: string;
  reportYear: number;
  /** ISO. */
  publishedAt: string;
  minuteReference: string | null;
  attestedByName: string | null;
  attestedRole: string | null;
  /** ISO, or null if not withdrawn. */
  withdrawnAt: string | null;
  withdrawnBy: string | null;
  withdrawnMinuteReference: string | null;
}

/**
 * The RECIPIENT'S own read of what it received — one congregation's full
 * publication history, withdrawn rows INCLUDED and marked (Option A, F52/
 * DECISION-140), never filtered the way `fetchStatisticsForYear()` filters
 * for "current." Backs the nested `/o/<slug>/admin/reports/<aboutOrgId>`
 * sub-view (architect's Phase 2 ruling 1d) — the presbytery reading the
 * congregation's OWN act, the other axis of Two Hierarchies from
 * `src/lib/filings.ts`'s "the congregation acting on its own act."
 *
 * DELIBERATELY IN THIS FILE, not `filings.ts`, even though Phase 3's own API
 * Contract said `presbytery.ts` would be touched "only for the
 * `fetchStatisticsForYear()` WHERE-filter edit": `resolveMemberCongregation()`
 * and `listMemberCongregations()` — the parent-path check every `aboutOrgId`
 * must go through — are module-private helpers here, never exported (this
 * file's own header, "the parent-path check… never trusted as a bare id"),
 * and this is a PRESBYTERY capability (reading what its OWN member
 * congregation published to it), not a congregation one — `getCongregation
 * OversightDetail()`'s exact precedent for a per-congregation nested-route
 * read, same permission (`statistics.manage`, matching
 * `getCongregationStatisticsRollup`'s sibling read), same parent-path gate.
 *
 * NO NEW DEFINER FUNCTION: calls the EXISTING
 * `presby_list_published_returns_to_me(p_about_org_id, p_year)`
 * (`drizzle/0047`, unchanged by this pipeline) via `tx.execute()` — Drizzle
 * has no typed call form for a set-returning SQL function, same shape
 * `hasPermission()`'s own `presby_has_permission()` call uses. Raw
 * `tx.execute()` results carry NO column-OID type information (measured,
 * `docs/work-log/2026-07-01-sql-date-tripwire.md`'s own finding): every
 * timestamptz column comes back as a Postgres-text STRING
 * ("2026-01-12 20:00:00+00"), not a JS Date, so `toIsoOrNull()` below
 * re-parses it — unlike `toRollupRow()` above, which reads a real
 * Drizzle-typed `.select()` and gets Date objects for free.
 */
function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return new Date(value as string).toISOString();
}

export async function getCongregationFilingHistory(
  viewerPersonId: string,
  organizationId: string,
  aboutOrgId: string,
  year?: number,
): Promise<PresbyteryResult<{ congregationName: string; rows: PublishedFilingRow[] }>> {
  if (
    year !== undefined &&
    (!Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX)
  ) {
    return { kind: "invalid_input", message: "Enter a valid statistical year." };
  }

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasPermission(tx, viewerPersonId, organizationId, STATISTICS_MANAGE))) {
      return { kind: "forbidden" };
    }

    const cong = await resolveMemberCongregation(tx, organizationId, aboutOrgId);
    if (!cong) return { kind: "invalid_target" };

    const result = await tx.execute(sql`
      select publication_id, published_at, minute_reference, report_year,
             attested_by_name, attested_role,
             withdrawn_at, withdrawn_by, withdrawn_minute_reference
        from presby_list_published_returns_to_me(${aboutOrgId}::uuid, ${year ?? null}::integer)
    `);
    const rows =
      (
        result as unknown as {
          rows?: Array<{
            publication_id: string;
            published_at: string;
            minute_reference: string | null;
            report_year: number;
            attested_by_name: string | null;
            attested_role: string | null;
            withdrawn_at: string | null;
            withdrawn_by: string | null;
            withdrawn_minute_reference: string | null;
          }>;
        }
      ).rows ?? [];

    const data: PublishedFilingRow[] = rows.map((r) => ({
      publicationId: r.publication_id,
      reportYear: r.report_year,
      publishedAt: toIsoOrNull(r.published_at) ?? "",
      minuteReference: r.minute_reference,
      attestedByName: r.attested_by_name,
      attestedRole: r.attested_role,
      withdrawnAt: toIsoOrNull(r.withdrawn_at),
      withdrawnBy: r.withdrawn_by,
      withdrawnMinuteReference: r.withdrawn_minute_reference,
    }));

    return { kind: "ok", data: { congregationName: cong.name, rows: data } };
  });
}

/** Upsert on `(organizationId, aboutOrgId, year, provenance =
 *  'presbytery_entered')` — the partial unique index deliberately excludes
 *  `published_by_congregation` rows, whose publications chain by
 *  `publications.supersedesId` instead (never written by this function; only
 *  `presby_publish_sasr_snapshot()` writes a published row). */
export async function setCongregationStatistics(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  aboutOrgId: string,
  year: number,
  input: SasrAggregateInput,
): Promise<PresbyteryResult<{ id: string }>> {
  if (!Number.isInteger(year) || year < YEAR_MIN || year > YEAR_MAX) {
    return { kind: "invalid_input", message: "Enter a valid statistical year." };
  }
  const invalid = validateSasrAggregateInput(input);
  if (invalid) return { kind: "invalid_input", message: invalid.message };

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasPermission(tx, viewerPersonId, organizationId, STATISTICS_MANAGE))) {
      return { kind: "forbidden" };
    }

    const cong = await resolveMemberCongregation(tx, organizationId, aboutOrgId);
    if (!cong) return { kind: "invalid_target" };

    // EXPLICIT-COLUMN RAW SQL, NOT Drizzle's insert() builder — and that is a
    // security requirement, not a style choice (F61 / eleventh Phase 3
    // loop-back; docs/schema-design-2.md sec 2h).
    //
    // `presby_app` no longer holds table-level INSERT on this table. It holds
    // a column-level INSERT grant on 68 of 71 columns, excluding
    // `publication_id`, `withdrawn_at` and `published_at` (drizzle/0047
    // section 10), which is what stops a tenant connection from self-arming
    // `presby.publication_write_active` and forging a permanent
    // `published_by_congregation` projection.
    //
    // Drizzle's `insert()` builder cannot be used against a column-level
    // grant: drizzle-orm 0.45 emits EVERY column of the table in the INSERT
    // target list, filling unspecified ones with `DEFAULT` — and Postgres
    // requires column-level INSERT privilege on every column in the target
    // list, including one supplied as the bare `DEFAULT` keyword (measured,
    // F59). Naming the columns by hand is the only shape that keeps the
    // excluded three out of the target list entirely.
    //
    // Semantics are byte-identical to the `onConflictDoUpdate()` form this
    // replaces: same 23 columns, same partial conflict target, same 19
    // columns updated from EXCLUDED. `id` and `created_at` are never named,
    // which is exactly why no privilege on them is needed either.
    try {
      const result = await tx.execute(sql`
        insert into congregation_statistics (
          organization_id, about_org_id, year, provenance,
          minute_reference,
          gains_professions_under18, gains_professions_18plus,
          gains_certificate, gains_other,
          losses_certificate, losses_deaths, losses_other,
          ending_active, ending_baptized, ending_affiliate,
          ending_other_participants, avg_weekly_worship_attendance,
          potential_giving_units, baptisms_children, baptisms_adults,
          officers_ruling_elder_count, officers_deacon_count, entered_by
        ) values (
          ${organizationId}::uuid, ${aboutOrgId}::uuid, ${year}::integer, 'presbytery_entered',
          ${input.minuteReference ?? null},
          ${input.gainsProfessionsUnder18 ?? null}, ${input.gainsProfessions18Plus ?? null},
          ${input.gainsCertificate ?? null}, ${input.gainsOther ?? null},
          ${input.lossesCertificate ?? null}, ${input.lossesDeaths ?? null}, ${input.lossesOther ?? null},
          ${input.endingActive ?? null}, ${input.endingBaptized ?? null}, ${input.endingAffiliate ?? null},
          ${input.endingOtherParticipants ?? null}, ${input.avgWeeklyWorshipAttendance ?? null},
          ${input.potentialGivingUnits ?? null}, ${input.baptismsChildren ?? null}, ${input.baptismsAdults ?? null},
          ${input.officersRulingElderCount ?? null}, ${input.officersDeaconCount ?? null}, ${actingUserId}::uuid
        )
        on conflict (organization_id, about_org_id, year, provenance)
          where provenance in ('presbytery_entered', 'imported')
        do update set
          minute_reference = excluded.minute_reference,
          gains_professions_under18 = excluded.gains_professions_under18,
          gains_professions_18plus = excluded.gains_professions_18plus,
          gains_certificate = excluded.gains_certificate,
          gains_other = excluded.gains_other,
          losses_certificate = excluded.losses_certificate,
          losses_deaths = excluded.losses_deaths,
          losses_other = excluded.losses_other,
          ending_active = excluded.ending_active,
          ending_baptized = excluded.ending_baptized,
          ending_affiliate = excluded.ending_affiliate,
          ending_other_participants = excluded.ending_other_participants,
          avg_weekly_worship_attendance = excluded.avg_weekly_worship_attendance,
          potential_giving_units = excluded.potential_giving_units,
          baptisms_children = excluded.baptisms_children,
          baptisms_adults = excluded.baptisms_adults,
          officers_ruling_elder_count = excluded.officers_ruling_elder_count,
          officers_deacon_count = excluded.officers_deacon_count,
          entered_by = excluded.entered_by
        returning id
      `);

      const row = (result as unknown as { rows?: Array<{ id?: string }> })
        .rows?.[0];
      return { kind: "ok", data: { id: row!.id! } };
    } catch (err) {
      // Expected, routine refusal (a real, in-permission congregation whose
      // year falls outside its affiliation window with this presbytery —
      // e.g. a redistricted congregation, or a clerk mistyping the year) —
      // `src/types/actions.ts`'s own contract reserves throwing for "truly
      // unexpected" failures, so this maps to the SAME `invalid_input`
      // variant the format checks above already use, rather than a new
      // `PresbyteryResult` kind (see this pipeline's work-log Phase 3
      // Design (c) for why: `actions.ts` has 6 switches over this shared
      // type, none exhaustive, and a new variant would need a no-op case
      // added to all 5 of them purely to keep TS's narrowing sound for a
      // case only this function can produce).
      const { code, message } = pgErrorInfo(err);
      if (code === "42501" && message.includes(NOT_AFFILIATED_MARKER)) {
        return {
          kind: "invalid_input",
          message: `${cong.name} wasn't affiliated with this presbytery in ${year} — check the year and try again.`,
        };
      }
      // Anything unmapped is structurally unexpected — this INSERT can only
      // trip its own about-org trigger — but matched defensively rather than
      // assumed, same discipline `filings.ts`/`statistics-grants.ts` use for
      // their own unmapped arms.
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------
// Per-capita (Increment 3b)
// ---------------------------------------------------------------------------

export interface PerCapitaRateRow {
  billingYear: number;
  basisYear: number;
  ratePerMember: string;
  updatedAt: string;
}

export interface PerCapitaRecordRow {
  recordId: string;
  organizationId: string;
  name: string;
  billingYear: number;
  basisYear: number;
  endingActiveBasis: number;
  rateApplied: string;
  amountOwed: string;
  paidStatus: string;
  paidAmount: string | null;
  paidAt: string | null;
}

export interface PerCapitaOverview {
  rate: PerCapitaRateRow | null;
  records: PerCapitaRecordRow[];
}

/** The rate (if set) and every generated record for `billingYear`. */
export async function getPerCapitaOverview(
  viewerPersonId: string,
  organizationId: string,
  billingYear: number,
): Promise<PresbyteryResult<PerCapitaOverview>> {
  if (!Number.isInteger(billingYear) || billingYear < YEAR_MIN || billingYear > YEAR_MAX) {
    return { kind: "invalid_input", message: "Enter a valid billing year." };
  }

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasPermission(tx, viewerPersonId, organizationId, PER_CAPITA_MANAGE))) {
      return { kind: "forbidden" };
    }

    const [rateRow] = await tx
      .select()
      .from(perCapitaRates)
      .where(
        and(
          eq(perCapitaRates.organizationId, organizationId),
          eq(perCapitaRates.billingYear, billingYear),
        ),
      )
      .limit(1);

    const recordRows = await tx
      .select({
        recordId: perCapitaRecords.id,
        aboutOrgId: perCapitaRecords.aboutOrgId,
        name: organizations.name,
        billingYear: perCapitaRecords.billingYear,
        basisYear: perCapitaRecords.basisYear,
        endingActiveBasis: perCapitaRecords.endingActiveBasis,
        rateApplied: perCapitaRecords.rateApplied,
        amountOwed: perCapitaRecords.amountOwed,
        paidStatus: perCapitaRecords.paidStatus,
        paidAmount: perCapitaRecords.paidAmount,
        paidAt: perCapitaRecords.paidAt,
      })
      .from(perCapitaRecords)
      .innerJoin(organizations, eq(organizations.id, perCapitaRecords.aboutOrgId))
      .where(
        and(
          eq(perCapitaRecords.organizationId, organizationId),
          eq(perCapitaRecords.billingYear, billingYear),
        ),
      )
      .orderBy(organizations.name);

    return {
      kind: "ok",
      data: {
        rate: rateRow
          ? {
              billingYear: rateRow.billingYear,
              basisYear: rateRow.basisYear,
              ratePerMember: rateRow.ratePerMember,
              updatedAt: rateRow.updatedAt.toISOString(),
            }
          : null,
        records: recordRows.map((r) => ({
          recordId: r.recordId,
          organizationId: r.aboutOrgId,
          name: r.name,
          billingYear: r.billingYear,
          basisYear: r.basisYear,
          endingActiveBasis: r.endingActiveBasis,
          rateApplied: r.rateApplied,
          amountOwed: r.amountOwed,
          paidStatus: r.paidStatus,
          paidAmount: r.paidAmount,
          paidAt: r.paidAt ? r.paidAt.toISOString() : null,
        })),
      },
    };
  });
}

export interface SetPerCapitaRateInput {
  /** Defaults to `billingYear - 2` when omitted (Operator Answer 1's
   *  two-year-arrears practice) — the default is applied HERE, not at the
   *  call site, so every caller (action, future import) gets the same
   *  default without re-deriving it. */
  basisYear?: number;
  /** Numeric string, e.g. `"12.50"`. */
  ratePerMember: string;
}

/** Upsert on `(organizationId, billingYear)`. */
export async function setPerCapitaRate(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  billingYear: number,
  input: SetPerCapitaRateInput,
): Promise<PresbyteryResult<{ id: string }>> {
  if (!Number.isInteger(billingYear) || billingYear < YEAR_MIN || billingYear > YEAR_MAX) {
    return { kind: "invalid_input", message: "Enter a valid billing year." };
  }
  const basisYear = input.basisYear ?? billingYear - 2;
  if (!Number.isInteger(basisYear) || basisYear < YEAR_MIN || basisYear > YEAR_MAX) {
    return { kind: "invalid_input", message: "Enter a valid basis year." };
  }
  const rate = Number(input.ratePerMember);
  if (!Number.isFinite(rate) || rate < 0) {
    return { kind: "invalid_input", message: "Rate per member must be a non-negative number." };
  }

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasPermission(tx, viewerPersonId, organizationId, PER_CAPITA_MANAGE))) {
      return { kind: "forbidden" };
    }

    const [row] = await tx
      .insert(perCapitaRates)
      .values({
        organizationId,
        billingYear,
        basisYear,
        ratePerMember: input.ratePerMember,
        updatedBy: actingUserId,
      })
      .onConflictDoUpdate({
        target: [perCapitaRates.organizationId, perCapitaRates.billingYear],
        set: {
          basisYear,
          ratePerMember: input.ratePerMember,
          updatedBy: actingUserId,
          updatedAt: new Date(),
        },
      })
      .returning({ id: perCapitaRates.id });

    return { kind: "ok", data: { id: row!.id } };
  });
}

/** For every member congregation: snapshot `endingActiveBasis`/
 *  `rateApplied`/`amountOwed` from the statistics rollup at the rate's own
 *  `basisYear`, frozen at generation time. Skips (never fails the batch)
 *  a congregation with no statistics on file for the basis year, or one
 *  that already has a record for this billing year (see this file's
 *  header). */
export async function generatePerCapitaRecords(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  billingYear: number,
): Promise<PresbyteryResult<{ created: number; skipped: string[] }>> {
  if (!Number.isInteger(billingYear) || billingYear < YEAR_MIN || billingYear > YEAR_MAX) {
    return { kind: "invalid_input", message: "Enter a valid billing year." };
  }

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasPermission(tx, viewerPersonId, organizationId, PER_CAPITA_MANAGE))) {
      return { kind: "forbidden" };
    }

    const [rateRow] = await tx
      .select()
      .from(perCapitaRates)
      .where(
        and(
          eq(perCapitaRates.organizationId, organizationId),
          eq(perCapitaRates.billingYear, billingYear),
        ),
      )
      .limit(1);
    if (!rateRow) {
      return {
        kind: "invalid_input",
        message: `Set a per-capita rate for ${billingYear} before generating records.`,
      };
    }

    const congregations = await listMemberCongregations(tx, organizationId);
    if (congregations.length === 0) {
      return { kind: "ok", data: { created: 0, skipped: [] } };
    }

    const existingRows = await tx
      .select({ aboutOrgId: perCapitaRecords.aboutOrgId })
      .from(perCapitaRecords)
      .where(
        and(
          eq(perCapitaRecords.organizationId, organizationId),
          eq(perCapitaRecords.billingYear, billingYear),
        ),
      );
    const alreadyGenerated = new Set(existingRows.map((r) => r.aboutOrgId));

    const statsByAboutOrg = await fetchStatisticsForYear(
      tx,
      organizationId,
      rateRow.basisYear,
    );

    const rate = Number(rateRow.ratePerMember);
    const skipped: string[] = [];
    let created = 0;

    for (const cong of congregations) {
      if (alreadyGenerated.has(cong.id)) {
        skipped.push(`${cong.name}: already has a ${billingYear} record`);
        continue;
      }
      const stats = statsByAboutOrg.get(cong.id);
      if (!stats || stats.endingActive === null) {
        skipped.push(
          `${cong.name}: no statistics on file for ${rateRow.basisYear}`,
        );
        continue;
      }

      const amountOwed = (stats.endingActive * rate).toFixed(2);
      await tx.insert(perCapitaRecords).values({
        organizationId,
        aboutOrgId: cong.id,
        billingYear,
        basisYear: rateRow.basisYear,
        endingActiveBasis: stats.endingActive,
        rateApplied: rateRow.ratePerMember,
        amountOwed,
        updatedBy: actingUserId,
      });
      created += 1;
    }

    return { kind: "ok", data: { created, skipped } };
  });
}

export interface RecordPerCapitaPaymentInput {
  /** Numeric string, e.g. `"1200.00"`. */
  paidAmount: string;
  /** 'YYYY-MM-DD'. */
  paidAt: string;
}

/** Updates `paidAmount`/`paidAt`/`paidStatus` on the EXISTING record — never
 *  a delete. `paidStatus` is DERIVED from `paidAmount` vs. the record's own
 *  frozen `amountOwed` (Phase 3's API Contract takes no explicit status
 *  input): `paid` at or above the amount owed, `partial` above zero, else
 *  `unpaid`. */
export async function recordPerCapitaPayment(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  recordId: string,
  input: RecordPerCapitaPaymentInput,
): Promise<PresbyteryResult<{ id: string }>> {
  if (!DATE_RE.test(input.paidAt)) {
    throw new Error(
      `recordPerCapitaPayment: paidAt must be 'YYYY-MM-DD', got ${JSON.stringify(input.paidAt)}`,
    );
  }
  const paidAmount = Number(input.paidAmount);
  if (!Number.isFinite(paidAmount) || paidAmount < 0) {
    return { kind: "invalid_input", message: "Payment amount must be a non-negative number." };
  }

  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasPermission(tx, viewerPersonId, organizationId, PER_CAPITA_MANAGE))) {
      return { kind: "forbidden" };
    }

    const [row] = await tx
      .select({ id: perCapitaRecords.id, amountOwed: perCapitaRecords.amountOwed })
      .from(perCapitaRecords)
      .where(
        and(
          eq(perCapitaRecords.id, recordId),
          eq(perCapitaRecords.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!row) return { kind: "invalid_target" };

    const amountOwed = Number(row.amountOwed);
    const paidStatus =
      paidAmount <= 0 ? "unpaid" : paidAmount >= amountOwed ? "paid" : "partial";

    await tx
      .update(perCapitaRecords)
      .set({
        paidAmount: input.paidAmount,
        paidAt: new Date(`${input.paidAt}T00:00:00Z`),
        paidStatus,
        updatedBy: actingUserId,
        updatedAt: new Date(),
      })
      .where(eq(perCapitaRecords.id, recordId));

    return { kind: "ok", data: { id: recordId } };
  });
}
