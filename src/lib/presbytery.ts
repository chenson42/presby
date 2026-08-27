import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
 * (aboutOrgId, year), a `published_by_congregation` row — if one exists —
 * always wins the display, even though the presbytery's own
 * `presbytery_entered`/`imported` row (if any) is never deleted (Phase 1
 * §3). Multiple `published_by_congregation` rows can exist for the same
 * year (a republish chains via `supersedesPublicationId` rather than
 * updating in place) — the one with the latest `publishedAt` is the current
 * one; this module never needs to walk the chain itself, only pick its head.
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
}

/** The provenance-coalesce read shared by 3b's own list and (per Phase 3's
 *  Sequencing) a future dashboard rollup. See this file's header for the
 *  precedence rule. */
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
): StatisticsRollupRow {
  return {
    organizationId: cong.id,
    name: cong.name,
    platformStatus: cong.platformStatus,
    year,
    hasData: row !== undefined,
    provenance: (row?.provenance as StatisticsProvenance | undefined) ?? null,
    publishedAt: row?.publishedAt ? row.publishedAt.toISOString() : null,
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

    const byAboutOrg = await fetchStatisticsForYear(tx, organizationId, year);
    const data = congregations.map((cong) =>
      toRollupRow(cong, year, byAboutOrg.get(cong.id)),
    );

    return { kind: "ok", data };
  });
}

/** Upsert on `(organizationId, aboutOrgId, year, provenance =
 *  'presbytery_entered')` — the partial unique index deliberately excludes
 *  `published_by_congregation` rows, which chain by
 *  `supersedesPublicationId` instead (never written by this function). */
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

    const values = {
      minuteReference: input.minuteReference ?? null,
      gainsProfessionsUnder18: input.gainsProfessionsUnder18 ?? null,
      gainsProfessions18Plus: input.gainsProfessions18Plus ?? null,
      gainsCertificate: input.gainsCertificate ?? null,
      gainsOther: input.gainsOther ?? null,
      lossesCertificate: input.lossesCertificate ?? null,
      lossesDeaths: input.lossesDeaths ?? null,
      lossesOther: input.lossesOther ?? null,
      endingActive: input.endingActive ?? null,
      endingBaptized: input.endingBaptized ?? null,
      endingAffiliate: input.endingAffiliate ?? null,
      endingOtherParticipants: input.endingOtherParticipants ?? null,
      avgWeeklyWorshipAttendance: input.avgWeeklyWorshipAttendance ?? null,
      potentialGivingUnits: input.potentialGivingUnits ?? null,
      baptismsChildren: input.baptismsChildren ?? null,
      baptismsAdults: input.baptismsAdults ?? null,
      officersRulingElderCount: input.officersRulingElderCount ?? null,
      officersDeaconCount: input.officersDeaconCount ?? null,
      enteredBy: actingUserId,
    };

    const [row] = await tx
      .insert(congregationStatistics)
      .values({
        organizationId,
        aboutOrgId,
        year,
        provenance: "presbytery_entered",
        ...values,
      })
      .onConflictDoUpdate({
        target: [
          congregationStatistics.organizationId,
          congregationStatistics.aboutOrgId,
          congregationStatistics.year,
          congregationStatistics.provenance,
        ],
        targetWhere: sql`${congregationStatistics.provenance} in ('presbytery_entered', 'imported')`,
        set: values,
      })
      .returning({ id: congregationStatistics.id });

    return { kind: "ok", data: { id: row!.id } };
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
