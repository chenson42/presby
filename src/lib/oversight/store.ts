import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { OrgAccessError, withOrgContext, type OrgTx } from "@/lib/authz";
import { AUDIT_ACTIONS, insertAuditRow } from "@/lib/audit-tx";
import {
  OVERSIGHT_GUARD_CODES,
  oversightBuildingAppraisals,
  oversightBuildings,
  oversightInsuranceYears,
  oversightLoans,
  oversightProfiles,
} from "@/lib/db/domain/oversight";
import { pgErrorField, pgErrorMessages } from "@/lib/db/errors";
import { holdsPermissions } from "@/lib/org-portal/permission-check";
import { resolveMemberCongregation } from "@/lib/presbytery";
import {
  OVERSIGHT_FINANCE_KEY,
  OVERSIGHT_MANAGE_KEY,
  type ChangedField,
  type OversightCtx,
  type Outcome,
  type Refusal,
  type Written,
} from "./contract";
import { VALIDATION } from "./copy";
import type {
  AppraisalInput,
  BuildingInput,
  InsuranceInput,
  LoanInput,
  ProfileInput,
  RetireInput,
} from "./validate";

/**
 * THE ONLY WRITER of five congregation-record tables in `src/` (profiles,
 * buildings, appraisals, insurance years, loans; photos are `photo-store.ts`'s,
 * Increment 2). docs/work-log/2026-11-17-congregation-profile.md, Phase 3 "API
 * Contract" and R4; DECISION-344, 349. `boundaries.test.ts` pins the list.
 *
 * EVERY WRITE is one `withOrgContext()` transaction (the actor must be an
 * active member of the presbytery) that repeats the whole check, cheapest and
 * least informative first:
 *
 *   1. the table's OWN key, by `presby_has_permission` through `holdsPermissions`
 *      (live; RLS is tenancy only)                              -> forbidden
 *   2. `aboutOrgId` is a member congregation of THIS presbytery  -> not_found
 *   3. the row, when the call names one, is live and belongs to that
 *      congregation and presbytery                               -> not_found
 *   4. for an edit, `row_version` still matches                  -> stale
 *
 * then writes, then writes ONE audit row with `insertAuditRow(tx, ...)` in the
 * SAME transaction, so a failed audit insert undoes the change. Never
 * `recordAudit()` (it opens its own connection and swallows its failure). An
 * edit that changes nothing writes nothing and audits nothing.
 *
 * The organization and the acting person come from `resolveOrgContext()` in the
 * action, never from the request. Nothing here deletes a row: removal is a
 * `removed_at`/`removed_by` pair (the database revoked DELETE and guards it,
 * 0089), and a retired building is a status, not a removal.
 *
 * AUDIT METADATA is ids, closed enumerations, booleans, years and field NAMES
 * only (`CHANGED_FIELDS`): never an amount, a policy number, a carrier, a lender,
 * a caption, a note or an address, because `audit_events` is platform-readable.
 *
 * CONCURRENCY. Two creates of one live building name: the partial unique index
 * serializes them and the loser is `duplicate_name`. Two "make primary": an
 * advisory lock on (presbytery, congregation), taken BEFORE any row lock, makes
 * the second wait, demote the first and take the mark (exactly one primary, no
 * error). A removal racing a new child is serialized by the database's
 * `FOR SHARE` guard (0089 section 6) and the loser is `building_removed`.
 */

/** Thrown inside a transaction to roll it back with a typed refusal. */
class Refuse extends Error {
  constructor(readonly reason: Refusal) {
    super(reason);
    this.name = "Refuse";
  }
}

/** Thrown inside a transaction to roll it back with a field-level validation message (a rule only the stored row can decide). */
class Invalid extends Error {
  constructor(
    readonly field: string,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "Invalid";
  }
}

const GUARD_CODES: Record<string, Refusal> = {
  [OVERSIGHT_GUARD_CODES.buildingRemoved]: "building_removed",
  [OVERSIGHT_GUARD_CODES.removalFinal]: "not_found",
};

const UNIQUE_CONSTRAINTS: Record<string, Refusal> = {
  oversight_buildings_live_name_idx: "duplicate_name",
  oversight_insurance_years_live_year_idx: "duplicate_policy_year",
  oversight_building_appraisals_live_year_idx: "duplicate_appraisal_year",
  // A concurrent first save of the profile, or a second primary the lock should have prevented: the page the user holds is out of date.
  oversight_profiles_org_about_key: "stale",
  oversight_buildings_one_primary_idx: "stale",
};

/** The about-org trigger's refusal (0045's deny helper, SQLSTATE 42501): the congregation is not (or no longer) affiliated. */
const NOT_AFFILIATED_MARKER = "was not affiliated with this council";

/** Maps whatever a transaction threw to the one answer the caller gets. */
function outcomeFor(err: unknown): Outcome<never> {
  if (err instanceof Refuse) return { kind: "refused", reason: err.reason };
  if (err instanceof Invalid) return { kind: "invalid", field: err.field, message: err.detail };
  if (err instanceof OrgAccessError) return { kind: "refused", reason: "forbidden" };

  const code = pgErrorField(err, "code");
  const constraint = pgErrorField(err, "constraint");
  if (code === "23505" && constraint && constraint in UNIQUE_CONSTRAINTS) {
    return { kind: "refused", reason: UNIQUE_CONSTRAINTS[constraint]! };
  }
  if (code === "23514" && constraint && constraint in GUARD_CODES) {
    return { kind: "refused", reason: GUARD_CODES[constraint]! };
  }
  if (code === "42501" && pgErrorMessages(err).includes(NOT_AFFILIATED_MARKER)) {
    return { kind: "refused", reason: "not_found" };
  }
  // A fixed line: the SQLSTATE and nothing else. No message, no id, no content.
  console.error(`[oversight] save failed (sqlstate ${code ?? "none"})`);
  return { kind: "refused", reason: "save_failed" };
}

async function attempt<T>(fn: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { kind: "ok", data: await fn() };
  } catch (err) {
    return outcomeFor(err);
  }
}

function inTransaction<T>(ctx: OversightCtx, fn: (tx: OrgTx) => Promise<T>): Promise<Outcome<T>> {
  return attempt(() => withOrgContext(ctx.personId, ctx.organizationId, fn));
}

type OversightAuditAction =
  | typeof AUDIT_ACTIONS.OVERSIGHT_PROFILE_SET
  | typeof AUDIT_ACTIONS.OVERSIGHT_BUILDING_CREATED
  | typeof AUDIT_ACTIONS.OVERSIGHT_BUILDING_UPDATED
  | typeof AUDIT_ACTIONS.OVERSIGHT_BUILDING_RETIRED
  | typeof AUDIT_ACTIONS.OVERSIGHT_BUILDING_REMOVED
  | typeof AUDIT_ACTIONS.OVERSIGHT_APPRAISAL_RECORDED
  | typeof AUDIT_ACTIONS.OVERSIGHT_APPRAISAL_REMOVED
  | typeof AUDIT_ACTIONS.OVERSIGHT_INSURANCE_RECORDED
  | typeof AUDIT_ACTIONS.OVERSIGHT_INSURANCE_UPDATED
  | typeof AUDIT_ACTIONS.OVERSIGHT_INSURANCE_REMOVED
  | typeof AUDIT_ACTIONS.OVERSIGHT_LOAN_RECORDED
  | typeof AUDIT_ACTIONS.OVERSIGHT_LOAN_UPDATED
  | typeof AUDIT_ACTIONS.OVERSIGHT_LOAN_PAID_OFF
  | typeof AUDIT_ACTIONS.OVERSIGHT_LOAN_REMOVED;

/** The one audit write: in the mutation's own transaction (a failure here undoes the change). */
async function audit(
  tx: OrgTx,
  ctx: OversightCtx,
  action: OversightAuditAction,
  resourceType: string,
  resourceId: string,
  aboutOrgId: string,
  metadata: Record<string, string | number | boolean | null | ChangedField[]>,
): Promise<void> {
  await insertAuditRow(tx, {
    action,
    actor: ctx.actor,
    resourceType,
    resourceId,
    metadata: { organizationId: ctx.organizationId, aboutOrgId, ...metadata },
  });
}

/** Steps 1 and 2 of the check order: the table's key, then the congregation. */
async function gate(tx: OrgTx, ctx: OversightCtx, key: string, aboutOrgId: string): Promise<void> {
  const [held] = await holdsPermissions(tx, ctx, [key]);
  if (!held) throw new Refuse("forbidden");
  const congregation = await resolveMemberCongregation(tx, ctx.organizationId, aboutOrgId);
  if (!congregation) throw new Refuse("not_found");
}

/** The advisory lock the primary mark needs, taken before any row lock so two movers cannot deadlock. */
async function lockPrimary(tx: OrgTx, ctx: OversightCtx, aboutOrgId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`oversight_primary:${ctx.organizationId}:${aboutOrgId}`}, 0))`,
  );
}

const nowStamp = () => sql`now()`;

/** The changed field names of an edit: the names whose stored value differs from the new one. */
function changedNames<C extends string>(
  stored: { [P in C]: unknown },
  next: { [P in C]: unknown },
  pairs: ReadonlyArray<readonly [ChangedField, C]>,
): ChangedField[] {
  return pairs.filter(([, column]) => stored[column] !== next[column]).map(([name]) => name);
}

// ---------------------------------------------------------------------------
// Profile (tier 1)
// ---------------------------------------------------------------------------

const PROFILE_FIELDS = [
  ["streetAddress", "streetAddress"],
  ["city", "city"],
  ["county", "county"],
  ["yearOrganized", "yearOrganized"],
  ["phone", "phone"],
] as const satisfies ReadonlyArray<readonly [ChangedField, keyof ProfileInput]>;

/**
 * Upsert on `(presbytery, congregation)`. `expectedVersion: null` means "create"
 * (the page showed no profile): an existing profile, or a concurrent first save,
 * is `stale`. A create with every field empty writes nothing. A profile is
 * cleared by saving empty fields, so there is no removal.
 */
export function setProfile(
  ctx: OversightCtx,
  aboutOrgId: string,
  input: ProfileInput,
  expectedVersion: number | null,
): Promise<Outcome<Written & { created: boolean }>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx, OVERSIGHT_MANAGE_KEY, aboutOrgId);

    const [stored] = await tx
      .select()
      .from(oversightProfiles)
      .where(and(eq(oversightProfiles.organizationId, ctx.organizationId), eq(oversightProfiles.aboutOrgId, aboutOrgId)))
      .for("update");

    let id: string;
    let created: boolean;
    let changed: ChangedField[];
    if (expectedVersion === null) {
      if (stored) throw new Refuse("stale");
      changed = PROFILE_FIELDS.filter(([, column]) => input[column] !== null).map(([name]) => name);
      if (changed.length === 0) return { id: "", created: false, unchanged: true as const };
      const [row] = await tx
        .insert(oversightProfiles)
        .values({
          organizationId: ctx.organizationId,
          aboutOrgId,
          ...input,
          createdBy: ctx.actor.userId,
          updatedBy: ctx.actor.userId,
        })
        .returning({ id: oversightProfiles.id });
      id = row!.id;
      created = true;
    } else {
      if (!stored || stored.rowVersion !== expectedVersion) throw new Refuse("stale");
      changed = changedNames(stored, input, PROFILE_FIELDS);
      if (changed.length === 0) return { id: stored.id, created: false, unchanged: true as const };
      const updated = await tx
        .update(oversightProfiles)
        .set({ ...input, rowVersion: sql`${oversightProfiles.rowVersion} + 1`, updatedAt: nowStamp(), updatedBy: ctx.actor.userId })
        .where(and(eq(oversightProfiles.id, stored.id), eq(oversightProfiles.rowVersion, expectedVersion)))
        .returning({ id: oversightProfiles.id });
      if (updated.length === 0) throw new Refuse("stale");
      id = stored.id;
      created = false;
    }
    await audit(tx, ctx, AUDIT_ACTIONS.OVERSIGHT_PROFILE_SET, "oversight_profile", id, aboutOrgId, { created, changed });
    return { id, created };
  });
}

// ---------------------------------------------------------------------------
// Buildings (tier 1)
// ---------------------------------------------------------------------------

const BUILDING_FIELDS = [
  ["name", "name"],
  ["buildingType", "buildingType"],
  ["yearBuilt", "yearBuilt"],
  ["firstAdditionYear", "firstAdditionYear"],
  ["secondAdditionYear", "secondAdditionYear"],
  ["squareFeet", "squareFeet"],
  ["roofCondition", "roofCondition"],
  ["plumbingCondition", "plumbingCondition"],
  ["hvacCondition", "hvacCondition"],
  ["boilerCondition", "boilerCondition"],
  ["hasSprinklers", "hasSprinklers"],
  ["hasFireAlarm", "hasFireAlarm"],
  ["hasSecuritySystem", "hasSecuritySystem"],
  ["notes", "notes"],
] as const satisfies ReadonlyArray<readonly [ChangedField, keyof BuildingInput]>;

const liveBuilding = (ctx: OversightCtx, aboutOrgId: string, buildingId: string) =>
  and(
    eq(oversightBuildings.id, buildingId),
    eq(oversightBuildings.organizationId, ctx.organizationId),
    eq(oversightBuildings.aboutOrgId, aboutOrgId),
    isNull(oversightBuildings.removedAt),
  );

/** Locks and returns a live building of this congregation, or `not_found`. */
async function lockBuilding(tx: OrgTx, ctx: OversightCtx, aboutOrgId: string, buildingId: string) {
  const [row] = await tx.select().from(oversightBuildings).where(liveBuilding(ctx, aboutOrgId, buildingId)).for("update");
  if (!row) throw new Refuse("not_found");
  return row;
}

/** Clears the congregation's current primary mark (if any) and returns its id. Caller holds `lockPrimary`. */
async function demotePrimary(tx: OrgTx, ctx: OversightCtx, aboutOrgId: string, exceptId: string | null): Promise<string | null> {
  const rows = await tx
    .update(oversightBuildings)
    .set({
      isPrimary: false,
      rowVersion: sql`${oversightBuildings.rowVersion} + 1`,
      updatedAt: nowStamp(),
      updatedBy: ctx.actor.userId,
    })
    .where(
      and(
        eq(oversightBuildings.organizationId, ctx.organizationId),
        eq(oversightBuildings.aboutOrgId, aboutOrgId),
        eq(oversightBuildings.isPrimary, true),
        isNull(oversightBuildings.removedAt),
        ...(exceptId ? [sql`${oversightBuildings.id} <> ${exceptId}`] : []),
      ),
    )
    .returning({ id: oversightBuildings.id });
  return rows[0]?.id ?? null;
}

/** Adds a building. If it is the primary, the current primary is demoted in the same transaction. */
export function createBuilding(ctx: OversightCtx, aboutOrgId: string, input: BuildingInput): Promise<Outcome<Written>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx, OVERSIGHT_MANAGE_KEY, aboutOrgId);

    let previousPrimaryBuildingId: string | null = null;
    if (input.primary) {
      await lockPrimary(tx, ctx, aboutOrgId);
      previousPrimaryBuildingId = await demotePrimary(tx, ctx, aboutOrgId, null);
    }
    const { primary, ...fields } = input;
    const [row] = await tx
      .insert(oversightBuildings)
      .values({
        organizationId: ctx.organizationId,
        aboutOrgId,
        ...fields,
        isPrimary: primary,
        createdBy: ctx.actor.userId,
        updatedBy: ctx.actor.userId,
      })
      .returning({ id: oversightBuildings.id });
    await audit(tx, ctx, AUDIT_ACTIONS.OVERSIGHT_BUILDING_CREATED, "oversight_building", row!.id, aboutOrgId, {
      buildingId: row!.id,
      primary,
      previousPrimaryBuildingId,
    });
    return { id: row!.id };
  });
}

/** Edits a building. No change writes and audits nothing. Moving the primary mark demotes the previous one. */
export function updateBuilding(
  ctx: OversightCtx,
  aboutOrgId: string,
  buildingId: string,
  input: BuildingInput,
  expectedVersion: number,
): Promise<Outcome<Written>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx, OVERSIGHT_MANAGE_KEY, aboutOrgId);
    // The advisory lock first, before the row lock: see "CONCURRENCY" in the header.
    if (input.primary) await lockPrimary(tx, ctx, aboutOrgId);
    const stored = await lockBuilding(tx, ctx, aboutOrgId, buildingId);
    if (stored.rowVersion !== expectedVersion) throw new Refuse("stale");

    const { primary, ...fields } = input;
    const changed: ChangedField[] = changedNames(stored, fields, BUILDING_FIELDS);
    const primaryChanged = stored.isPrimary !== primary;
    if (primaryChanged) changed.push("primary");
    if (changed.length === 0) return { id: stored.id, unchanged: true as const };

    let previousPrimaryBuildingId: string | null = null;
    if (primary && !stored.isPrimary) previousPrimaryBuildingId = await demotePrimary(tx, ctx, aboutOrgId, stored.id);

    const updated = await tx
      .update(oversightBuildings)
      .set({
        ...fields,
        isPrimary: primary,
        rowVersion: sql`${oversightBuildings.rowVersion} + 1`,
        updatedAt: nowStamp(),
        updatedBy: ctx.actor.userId,
      })
      .where(and(liveBuilding(ctx, aboutOrgId, buildingId), eq(oversightBuildings.rowVersion, expectedVersion)))
      .returning({ id: oversightBuildings.id });
    if (updated.length === 0) throw new Refuse("stale");
    await audit(tx, ctx, AUDIT_ACTIONS.OVERSIGHT_BUILDING_UPDATED, "oversight_building", stored.id, aboutOrgId, {
      buildingId: stored.id,
      changed,
      previousPrimaryBuildingId,
    });
    return { id: stored.id };
  });
}

/** Retires a building (a status, reversible): it leaves the active list and stops being primary. */
export function retireBuilding(
  ctx: OversightCtx,
  aboutOrgId: string,
  buildingId: string,
  input: RetireInput,
): Promise<Outcome<Written>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx, OVERSIGHT_MANAGE_KEY, aboutOrgId);
    const stored = await lockBuilding(tx, ctx, aboutOrgId, buildingId);
    if (stored.retiredOn !== null) throw new Refuse("already_retired");
    await tx
      .update(oversightBuildings)
      .set({
        retiredOn: input.retiredOn,
        retiredReason: input.reason,
        isPrimary: false,
        rowVersion: sql`${oversightBuildings.rowVersion} + 1`,
        updatedAt: nowStamp(),
        updatedBy: ctx.actor.userId,
      })
      .where(liveBuilding(ctx, aboutOrgId, buildingId));
    await audit(tx, ctx, AUDIT_ACTIONS.OVERSIGHT_BUILDING_RETIRED, "oversight_building", stored.id, aboutOrgId, {
      buildingId: stored.id,
      reason: input.reason,
    });
    return { id: stored.id };
  });
}

/** "Bring back into use": clears the retirement. Audited as an update whose changed field is `retired`. */
export function reinstateBuilding(ctx: OversightCtx, aboutOrgId: string, buildingId: string): Promise<Outcome<Written>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx, OVERSIGHT_MANAGE_KEY, aboutOrgId);
    const stored = await lockBuilding(tx, ctx, aboutOrgId, buildingId);
    if (stored.retiredOn === null) throw new Refuse("not_retired");
    await tx
      .update(oversightBuildings)
      .set({
        retiredOn: null,
        retiredReason: null,
        rowVersion: sql`${oversightBuildings.rowVersion} + 1`,
        updatedAt: nowStamp(),
        updatedBy: ctx.actor.userId,
      })
      .where(liveBuilding(ctx, aboutOrgId, buildingId));
    await audit(tx, ctx, AUDIT_ACTIONS.OVERSIGHT_BUILDING_UPDATED, "oversight_building", stored.id, aboutOrgId, {
      buildingId: stored.id,
      changed: ["retired"],
      previousPrimaryBuildingId: null,
    });
    return { id: stored.id };
  });
}

/** Removes a building entered by mistake (one-way). The same UPDATE clears the primary mark. */
export function removeBuilding(ctx: OversightCtx, aboutOrgId: string, buildingId: string): Promise<Outcome<Written>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx, OVERSIGHT_MANAGE_KEY, aboutOrgId);
    const stored = await lockBuilding(tx, ctx, aboutOrgId, buildingId);
    await tx
      .update(oversightBuildings)
      .set({
        removedAt: nowStamp(),
        removedBy: ctx.actor.userId,
        isPrimary: false,
        rowVersion: sql`${oversightBuildings.rowVersion} + 1`,
        updatedAt: nowStamp(),
        updatedBy: ctx.actor.userId,
      })
      .where(liveBuilding(ctx, aboutOrgId, buildingId));
    await audit(tx, ctx, AUDIT_ACTIONS.OVERSIGHT_BUILDING_REMOVED, "oversight_building", stored.id, aboutOrgId, {
      buildingId: stored.id,
    });
    return { id: stored.id };
  });
}

// ---------------------------------------------------------------------------
// Appraisals (tier 2; never edited, T4)
// ---------------------------------------------------------------------------

/** Records an appraisal of a live building of this congregation. A second live appraisal for the year is `duplicate_appraisal_year`. */
export function recordAppraisal(
  ctx: OversightCtx,
  aboutOrgId: string,
  buildingId: string,
  input: AppraisalInput,
): Promise<Outcome<Written>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx, OVERSIGHT_FINANCE_KEY, aboutOrgId);
    const [building] = await tx
      .select({ id: oversightBuildings.id })
      .from(oversightBuildings)
      .where(liveBuilding(ctx, aboutOrgId, buildingId));
    if (!building) throw new Refuse("not_found");
    const [row] = await tx
      .insert(oversightBuildingAppraisals)
      .values({
        organizationId: ctx.organizationId,
        aboutOrgId,
        buildingId,
        assessedYear: input.assessedYear,
        amountCents: input.amountCents,
        notes: input.notes,
        createdBy: ctx.actor.userId,
      })
      .returning({ id: oversightBuildingAppraisals.id });
    await audit(tx, ctx, AUDIT_ACTIONS.OVERSIGHT_APPRAISAL_RECORDED, "oversight_appraisal", row!.id, aboutOrgId, {
      buildingId,
      appraisalId: row!.id,
      assessedYear: input.assessedYear,
    });
    return { id: row!.id };
  });
}

/** Removes an appraisal entered by mistake (one-way). To correct an amount: remove and record again. */
export function removeAppraisal(
  ctx: OversightCtx,
  aboutOrgId: string,
  buildingId: string,
  appraisalId: string,
): Promise<Outcome<Written>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx, OVERSIGHT_FINANCE_KEY, aboutOrgId);
    const [building] = await tx
      .select({ id: oversightBuildings.id })
      .from(oversightBuildings)
      .where(liveBuilding(ctx, aboutOrgId, buildingId));
    if (!building) throw new Refuse("not_found");
    const [stored] = await tx
      .select({ id: oversightBuildingAppraisals.id })
      .from(oversightBuildingAppraisals)
      .where(
        and(
          eq(oversightBuildingAppraisals.id, appraisalId),
          eq(oversightBuildingAppraisals.organizationId, ctx.organizationId),
          eq(oversightBuildingAppraisals.aboutOrgId, aboutOrgId),
          eq(oversightBuildingAppraisals.buildingId, buildingId),
          isNull(oversightBuildingAppraisals.removedAt),
        ),
      )
      .for("update");
    if (!stored) throw new Refuse("not_found");
    await tx
      .update(oversightBuildingAppraisals)
      .set({ removedAt: nowStamp(), removedBy: ctx.actor.userId })
      .where(eq(oversightBuildingAppraisals.id, appraisalId));
    await audit(tx, ctx, AUDIT_ACTIONS.OVERSIGHT_APPRAISAL_REMOVED, "oversight_appraisal", appraisalId, aboutOrgId, {
      buildingId,
      appraisalId,
    });
    return { id: appraisalId };
  });
}

// ---------------------------------------------------------------------------
// Insurance years (tier 2)
// ---------------------------------------------------------------------------

const INSURANCE_FIELDS = [
  ["carrier", "carrier"],
  ["policyNumber", "policyNumber"],
  ["policyExpiresOn", "policyExpiresOn"],
  ["recentClaims", "recentClaims"],
  ["poolInterest", "poolInterest"],
  ["notes", "notes"],
] as const satisfies ReadonlyArray<readonly [ChangedField, keyof InsuranceInput]>;

const liveInsurance = (ctx: OversightCtx, aboutOrgId: string, recordId: string) =>
  and(
    eq(oversightInsuranceYears.id, recordId),
    eq(oversightInsuranceYears.organizationId, ctx.organizationId),
    eq(oversightInsuranceYears.aboutOrgId, aboutOrgId),
    isNull(oversightInsuranceYears.removedAt),
  );

/** Records a policy year. A second live record for the year is `duplicate_policy_year`; the policy year is required. */
export function recordInsurance(ctx: OversightCtx, aboutOrgId: string, input: InsuranceInput): Promise<Outcome<Written>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx, OVERSIGHT_FINANCE_KEY, aboutOrgId);
    if (input.policyYear === null) throw new Refuse("save_failed");
    const { policyYear, ...fields } = input;
    const [row] = await tx
      .insert(oversightInsuranceYears)
      .values({
        organizationId: ctx.organizationId,
        aboutOrgId,
        policyYear,
        ...fields,
        createdBy: ctx.actor.userId,
        updatedBy: ctx.actor.userId,
      })
      .returning({ id: oversightInsuranceYears.id });
    await audit(tx, ctx, AUDIT_ACTIONS.OVERSIGHT_INSURANCE_RECORDED, "oversight_insurance", row!.id, aboutOrgId, {
      insuranceId: row!.id,
      policyYear,
    });
    return { id: row!.id };
  });
}

/** Edits a policy year's facts (the year itself is not editable). No change writes and audits nothing. */
export function updateInsurance(
  ctx: OversightCtx,
  aboutOrgId: string,
  recordId: string,
  input: InsuranceInput,
  expectedVersion: number,
): Promise<Outcome<Written>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx, OVERSIGHT_FINANCE_KEY, aboutOrgId);
    const [stored] = await tx.select().from(oversightInsuranceYears).where(liveInsurance(ctx, aboutOrgId, recordId)).for("update");
    if (!stored) throw new Refuse("not_found");
    if (stored.rowVersion !== expectedVersion) throw new Refuse("stale");

    const { policyYear: _ignored, ...fields } = input;
    void _ignored;
    const changed = changedNames(stored, fields, INSURANCE_FIELDS);
    if (changed.length === 0) return { id: stored.id, unchanged: true as const };

    const updated = await tx
      .update(oversightInsuranceYears)
      .set({ ...fields, rowVersion: sql`${oversightInsuranceYears.rowVersion} + 1`, updatedAt: nowStamp(), updatedBy: ctx.actor.userId })
      .where(and(liveInsurance(ctx, aboutOrgId, recordId), eq(oversightInsuranceYears.rowVersion, expectedVersion)))
      .returning({ id: oversightInsuranceYears.id });
    if (updated.length === 0) throw new Refuse("stale");
    await audit(tx, ctx, AUDIT_ACTIONS.OVERSIGHT_INSURANCE_UPDATED, "oversight_insurance", stored.id, aboutOrgId, {
      insuranceId: stored.id,
      policyYear: stored.policyYear,
      changed,
    });
    return { id: stored.id };
  });
}

/** Removes a policy year entered by mistake (one-way); that year can then be recorded again. */
export function removeInsurance(ctx: OversightCtx, aboutOrgId: string, recordId: string): Promise<Outcome<Written>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx, OVERSIGHT_FINANCE_KEY, aboutOrgId);
    const [stored] = await tx.select().from(oversightInsuranceYears).where(liveInsurance(ctx, aboutOrgId, recordId)).for("update");
    if (!stored) throw new Refuse("not_found");
    await tx
      .update(oversightInsuranceYears)
      .set({
        removedAt: nowStamp(),
        removedBy: ctx.actor.userId,
        rowVersion: sql`${oversightInsuranceYears.rowVersion} + 1`,
        updatedAt: nowStamp(),
        updatedBy: ctx.actor.userId,
      })
      .where(liveInsurance(ctx, aboutOrgId, recordId));
    await audit(tx, ctx, AUDIT_ACTIONS.OVERSIGHT_INSURANCE_REMOVED, "oversight_insurance", stored.id, aboutOrgId, {
      insuranceId: stored.id,
      policyYear: stored.policyYear,
    });
    return { id: stored.id };
  });
}

// ---------------------------------------------------------------------------
// Loans (tier 2)
// ---------------------------------------------------------------------------

const LOAN_FIELDS = [
  ["kind", "kind"],
  ["lender", "lender"],
  ["originalAmount", "originalAmountCents"],
  ["currentBalance", "currentBalanceCents"],
  ["balanceAsOf", "balanceAsOf"],
  ["grantsAmount", "grantsAmountCents"],
  ["guaranteeNote", "guaranteeNote"],
  ["notes", "notes"],
] as const satisfies ReadonlyArray<readonly [ChangedField, keyof LoanInput]>;

const liveLoan = (ctx: OversightCtx, aboutOrgId: string, loanId: string) =>
  and(
    eq(oversightLoans.id, loanId),
    eq(oversightLoans.organizationId, ctx.organizationId),
    eq(oversightLoans.aboutOrgId, aboutOrgId),
    isNull(oversightLoans.removedAt),
  );

/** Records a loan, always as `open`. The form's `status` is not a field of a new loan. */
export function recordLoan(ctx: OversightCtx, aboutOrgId: string, input: LoanInput): Promise<Outcome<Written>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx, OVERSIGHT_FINANCE_KEY, aboutOrgId);
    const { status: _status, ...fields } = input;
    void _status;
    const [row] = await tx
      .insert(oversightLoans)
      .values({
        organizationId: ctx.organizationId,
        aboutOrgId,
        ...fields,
        status: "open",
        createdBy: ctx.actor.userId,
        updatedBy: ctx.actor.userId,
      })
      .returning({ id: oversightLoans.id });
    await audit(tx, ctx, AUDIT_ACTIONS.OVERSIGHT_LOAN_RECORDED, "oversight_loan", row!.id, aboutOrgId, {
      loanId: row!.id,
      kind: input.kind,
    });
    return { id: row!.id };
  });
}

/**
 * Edits a loan. Two rules only the stored row can decide: a changed balance
 * needs a different "as of" date (`invalid` on `balanceAsOf`), and `status`
 * going from paid off back to open is a reopen (the paid-off date is cleared and
 * the balance is left as recorded). `status: "paid_off"` on a loan that is open
 * is `not_paid_off`: marking paid off is `markLoanPaidOff`'s act.
 */
export function updateLoan(
  ctx: OversightCtx,
  aboutOrgId: string,
  loanId: string,
  input: LoanInput,
  expectedVersion: number,
): Promise<Outcome<Written & { reopened?: true }>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx, OVERSIGHT_FINANCE_KEY, aboutOrgId);
    const [stored] = await tx.select().from(oversightLoans).where(liveLoan(ctx, aboutOrgId, loanId)).for("update");
    if (!stored) throw new Refuse("not_found");
    if (stored.rowVersion !== expectedVersion) throw new Refuse("stale");
    if (input.status === "paid_off" && stored.status === "open") throw new Refuse("not_paid_off");

    const { status, ...fields } = input;
    const changed: ChangedField[] = changedNames(stored, fields, LOAN_FIELDS);
    const reopen = status === "open" && stored.status === "paid_off";
    if (reopen) changed.push("status");
    if (changed.length === 0) return { id: stored.id, unchanged: true as const };

    if (
      changed.includes("currentBalance") &&
      fields.balanceAsOf !== null &&
      fields.balanceAsOf === stored.balanceAsOf
    ) {
      throw new Invalid("balanceAsOf", VALIDATION.balanceDateStale);
    }

    const updated = await tx
      .update(oversightLoans)
      .set({
        ...fields,
        ...(reopen ? { status: "open" as const, paidOffOn: null } : {}),
        rowVersion: sql`${oversightLoans.rowVersion} + 1`,
        updatedAt: nowStamp(),
        updatedBy: ctx.actor.userId,
      })
      .where(and(liveLoan(ctx, aboutOrgId, loanId), eq(oversightLoans.rowVersion, expectedVersion)))
      .returning({ id: oversightLoans.id });
    if (updated.length === 0) throw new Refuse("stale");
    await audit(tx, ctx, AUDIT_ACTIONS.OVERSIGHT_LOAN_UPDATED, "oversight_loan", stored.id, aboutOrgId, {
      loanId: stored.id,
      kind: fields.kind,
      changed,
    });
    return reopen ? { id: stored.id, reopened: true as const } : { id: stored.id };
  });
}

/** One UPDATE: paid off on the date, the balance $0 as of that date. */
export function markLoanPaidOff(
  ctx: OversightCtx,
  aboutOrgId: string,
  loanId: string,
  input: { paidOffOn: string },
): Promise<Outcome<Written>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx, OVERSIGHT_FINANCE_KEY, aboutOrgId);
    const [stored] = await tx.select().from(oversightLoans).where(liveLoan(ctx, aboutOrgId, loanId)).for("update");
    if (!stored) throw new Refuse("not_found");
    if (stored.status === "paid_off") throw new Refuse("already_paid_off");
    await tx
      .update(oversightLoans)
      .set({
        status: "paid_off",
        paidOffOn: input.paidOffOn,
        currentBalanceCents: 0,
        balanceAsOf: input.paidOffOn,
        rowVersion: sql`${oversightLoans.rowVersion} + 1`,
        updatedAt: nowStamp(),
        updatedBy: ctx.actor.userId,
      })
      .where(liveLoan(ctx, aboutOrgId, loanId));
    await audit(tx, ctx, AUDIT_ACTIONS.OVERSIGHT_LOAN_PAID_OFF, "oversight_loan", stored.id, aboutOrgId, {
      loanId: stored.id,
      kind: stored.kind,
    });
    return { id: stored.id };
  });
}

/** Removes a loan entered by mistake (one-way). */
export function removeLoan(ctx: OversightCtx, aboutOrgId: string, loanId: string): Promise<Outcome<Written>> {
  return inTransaction(ctx, async (tx) => {
    await gate(tx, ctx, OVERSIGHT_FINANCE_KEY, aboutOrgId);
    const [stored] = await tx.select().from(oversightLoans).where(liveLoan(ctx, aboutOrgId, loanId)).for("update");
    if (!stored) throw new Refuse("not_found");
    await tx
      .update(oversightLoans)
      .set({
        removedAt: nowStamp(),
        removedBy: ctx.actor.userId,
        rowVersion: sql`${oversightLoans.rowVersion} + 1`,
        updatedAt: nowStamp(),
        updatedBy: ctx.actor.userId,
      })
      .where(liveLoan(ctx, aboutOrgId, loanId));
    await audit(tx, ctx, AUDIT_ACTIONS.OVERSIGHT_LOAN_REMOVED, "oversight_loan", stored.id, aboutOrgId, {
      loanId: stored.id,
      kind: stored.kind,
    });
    return { id: stored.id };
  });
}
