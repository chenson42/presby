import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { withOrgContext, type OrgTx } from "@/lib/authz";
import { givingKeysInTx } from "./keys";
import {
  givingFunctionCode,
  isNotPermitted,
  isoTs,
  rowsOf,
} from "./db-util";
import { findPossibleDuplicate, type GiftFingerprint } from "./duplicate-gift";
import { CSV_MAX_ROWS, type CsvGiftRow } from "./csv";
import { offlineAmountCents, type GiftFilters, type OfflineGiftValues } from "./gift-input";
import type { FieldErrors } from "./field-errors";

/**
 * Gifts: the list, the detail, offline recording, voiding, the recorder's own
 * recent entries, and the CSV export's query - docs/work-log/
 * 2026-10-15-online-giving.md, Phase 3 API contract "Admin - gifts" and the
 * S4 scope ruling (P3-4).
 *
 * WHO MAY DO WHAT (each function re-checks inside its own transaction; the page
 * and action gate is a courtesy, never the authority):
 *   listGifts / getGift / exportGifts   giving.view
 *   recordOfflineGift                   giving.record
 *   voidGift                            giving.record AND (giving.manage, for
 *                                        any offline gift, OR the gift is the
 *                                        actor's own entry made <= 30 days ago)
 *   listRecentOwnEntries                giving.record - the recorder's own
 *                                        last-30-days entries and nothing else
 *
 * `giving.record` is part of every void because the database says so: the
 * SECURITY DEFINER function `presby_giving_void_gift` requires its claimed actor
 * to hold `giving.record` (Batch 1a deviation D2). A `giving.manage`-only holder
 * is therefore told plainly instead of reaching a database refusal.
 *
 * GIFTS ARE NEVER INSERTED OR UPDATED HERE. `giving_gifts` and
 * `giving_gift_reversals` have no INSERT/UPDATE grant for anyone (P3-7); both
 * writes go through the DEFINER functions, which arm the transaction-local
 * write marker themselves. This file only reads gifts and calls those two
 * functions.
 *
 * Reads join the donor's ROOT (a merged donor's gifts stay attributed to the
 * donor they were written to, and are read through `merged_into_id`, which is
 * flat), and sum reversals as signed (`reinstatement` offsets).
 *
 * Every gift row carries `g.livemode`. A test-mode gift is listed with a "Test"
 * badge so an operator exercising Stripe in test mode can see their own test
 * activity, but it never reaches an aggregate or the CSV (P3-17).
 */

const PAGE_SIZE = 50;
const OWN_ENTRY_WINDOW_DAYS = 30;

export interface GiftListRow {
  id: string;
  /** 'YYYY-MM-DD', the organization's local date. */
  occurredOn: string;
  donorId: string;
  donorName: string;
  fundId: string;
  fundName: string;
  source: "online" | "offline";
  method: string | null;
  status: "succeeded" | "pending" | "failed";
  /** True for a Stripe test-mode gift (excluded from every total and the CSV). */
  testMode: boolean;
  amountCents: number;
  donorCoveredFeeCents: number;
  feeCents: number | null;
  netCents: number | null;
  checkNumber: string | null;
  /** Net of reversals and reinstatements, 0..amount. */
  reversedCents: number;
  voided: boolean;
}

/** The shared read: one row per gift, joined (no N+1), root donor, signed reversals. */
const GIFT_SELECT = sql`
  select g.id, g.occurred_on::text as occurred_on,
         coalesce(rd.id, d.id) as donor_id, coalesce(rd.display_name, d.display_name) as donor_name,
         f.id as fund_id, f.name as fund_name, g.source, g.method, g.status, g.livemode,
         g.amount_cents, g.donor_covered_fee_cents, g.fee_cents, g.net_cents, g.check_number,
         coalesce(rv.reversed, 0) as reversed_cents, coalesce(rv.voided, false) as voided
    from giving_gifts g
    join giving_donors d on d.id = g.donor_id and d.organization_id = g.organization_id
    left join giving_donors rd on rd.id = d.merged_into_id and rd.organization_id = d.organization_id
    join giving_funds f on f.id = g.fund_id and f.organization_id = g.organization_id
    left join lateral (
      select sum(case when r.kind = 'reinstatement' then -r.amount_cents else r.amount_cents end)::int as reversed,
             bool_or(r.kind = 'void') as voided
        from giving_gift_reversals r
       where r.gift_id = g.id and r.organization_id = g.organization_id
    ) rv on true
`;

function mapGift(r: Record<string, unknown>): GiftListRow {
  return {
    id: String(r.id),
    occurredOn: String(r.occurred_on),
    donorId: String(r.donor_id),
    donorName: String(r.donor_name),
    fundId: String(r.fund_id),
    fundName: String(r.fund_name),
    source: r.source as GiftListRow["source"],
    method: (r.method as string | null) ?? null,
    status: r.status as GiftListRow["status"],
    testMode: r.livemode !== true,
    amountCents: Number(r.amount_cents),
    donorCoveredFeeCents: Number(r.donor_covered_fee_cents),
    feeCents: r.fee_cents === null || r.fee_cents === undefined ? null : Number(r.fee_cents),
    netCents: r.net_cents === null || r.net_cents === undefined ? null : Number(r.net_cents),
    checkNumber: (r.check_number as string | null) ?? null,
    reversedCents: Number(r.reversed_cents),
    voided: r.voided === true,
  };
}

/** The WHERE clauses a filter set adds (all bound parameters, none interpolated). */
function filterClauses(filters: GiftFilters): SQL[] {
  const clauses: SQL[] = [];
  if (filters.from) clauses.push(sql`g.occurred_on >= ${filters.from}::date`);
  if (filters.to) clauses.push(sql`g.occurred_on <= ${filters.to}::date`);
  if (filters.fundId) clauses.push(sql`g.fund_id = ${filters.fundId}::uuid`);
  if (filters.status) clauses.push(sql`g.status = ${filters.status}`);
  if (filters.source) clauses.push(sql`g.source = ${filters.source}`);
  if (filters.donorId) {
    clauses.push(sql`(d.id = ${filters.donorId}::uuid or d.merged_into_id = ${filters.donorId}::uuid)`);
  }
  return clauses;
}

// ---------------------------------------------------------------------------
// Cursor (keyset on (occurred_on desc, id desc))
// ---------------------------------------------------------------------------

const CURSOR = /^(\d{4}-\d{2}-\d{2})\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function encodeGiftCursor(row: { occurredOn: string; id: string }): string {
  return `${row.occurredOn}|${row.id}`;
}

/** A tampered cursor is dropped (page one), never an error. */
export function decodeGiftCursor(cursor: string | undefined): { occurredOn: string; id: string } | null {
  if (!cursor) return null;
  const match = CURSOR.exec(cursor);
  return match ? { occurredOn: match[1]!, id: match[2]!.toLowerCase() } : null;
}

// ---------------------------------------------------------------------------
// listGifts
// ---------------------------------------------------------------------------

export type ListGiftsResult =
  | { kind: "ok"; gifts: GiftListRow[]; nextCursor: string | null }
  | { kind: "forbidden" };

/** The ledger. `giving.view` ONLY - a recorder never reaches this (S4). 50 per page. */
export async function listGifts(
  personId: string,
  organizationId: string,
  input: { filters: GiftFilters; cursor?: string },
): Promise<ListGiftsResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.view) return { kind: "forbidden" };

    const clauses: SQL[] = [sql`g.organization_id = ${organizationId}::uuid`, ...filterClauses(input.filters)];
    const cursor = decodeGiftCursor(input.cursor);
    if (cursor) clauses.push(sql`(g.occurred_on, g.id) < (${cursor.occurredOn}::date, ${cursor.id}::uuid)`);

    const result = await tx.execute(sql`
      ${GIFT_SELECT}
      where ${sql.join(clauses, sql` and `)}
      order by g.occurred_on desc, g.id desc
      limit ${PAGE_SIZE + 1}
    `);
    const rows = rowsOf(result).map(mapGift);
    const hasMore = rows.length > PAGE_SIZE;
    const gifts = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
    return {
      kind: "ok",
      gifts,
      nextCursor: hasMore ? encodeGiftCursor(gifts[gifts.length - 1]!) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// exportGifts (the CSV route's query)
// ---------------------------------------------------------------------------

export type ExportGiftsResult =
  | { kind: "ok"; rows: CsvGiftRow[] }
  | { kind: "too_many" }
  | { kind: "forbidden" };

/**
 * The live-mode gifts for the CSV (P3-17, G25), in date order, at most
 * `CSV_MAX_ROWS`. One more row than the cap is read to tell "exactly at the cap"
 * from "over it". `giving.view`. No email, address or memo is selected - the
 * row type has no field for them.
 */
export async function exportGifts(
  personId: string,
  organizationId: string,
  filters: GiftFilters,
): Promise<ExportGiftsResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.view) return { kind: "forbidden" };

    const clauses: SQL[] = [
      sql`g.organization_id = ${organizationId}::uuid`,
      sql`g.livemode`,
      ...filterClauses(filters),
    ];
    const result = await tx.execute(sql`
      ${GIFT_SELECT}
      where ${sql.join(clauses, sql` and `)}
      order by g.occurred_on asc, g.id asc
      limit ${CSV_MAX_ROWS + 1}
    `);
    const mapped = rowsOf(result).map(mapGift);
    if (mapped.length > CSV_MAX_ROWS) return { kind: "too_many" };
    return {
      kind: "ok",
      rows: mapped.map((g) => ({
        giftId: g.id,
        occurredOn: g.occurredOn,
        donorId: g.donorId,
        donorName: g.donorName,
        fundName: g.fundName,
        source: g.source,
        method: g.method,
        status: g.status,
        amountCents: g.amountCents,
        donorCoveredFeeCents: g.donorCoveredFeeCents,
        feeCents: g.feeCents,
        netCents: g.netCents,
        reversedCents: g.reversedCents,
        checkNumber: g.checkNumber,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// getGift
// ---------------------------------------------------------------------------

export interface GiftReversalRow {
  id: string;
  kind: "refund" | "dispute" | "ach_return" | "void" | "reinstatement";
  amountCents: number;
  reason: string | null;
  occurredOn: string;
  /** Who recorded a void; null for a provider-originated reversal. */
  recordedByName: string | null;
}

export interface GiftDetail extends GiftListRow {
  stockDescription: string | null;
  stockQuantity: string | null;
  memo: string | null;
  failureCode: string | null;
  /** The signed-in team member who recorded an offline gift; null for an online gift. */
  recordedByName: string | null;
  /** ISO-8601 UTC. */
  createdAt: string;
  reversals: GiftReversalRow[];
  /** The caller may void this gift now (see the module header). */
  canVoid: boolean;
}

export type GetGiftResult =
  | { kind: "ok"; gift: GiftDetail }
  | { kind: "forbidden" }
  | { kind: "not_found" };

export async function getGift(
  personId: string,
  organizationId: string,
  userId: string,
  giftId: string,
): Promise<GetGiftResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.view) return { kind: "forbidden" };

    const result = await tx.execute(sql`
      ${GIFT_SELECT}
      where g.organization_id = ${organizationId}::uuid and g.id = ${giftId}::uuid
    `);
    const base = rowsOf(result)[0];
    if (!base) return { kind: "not_found" };

    const detailRow = rowsOf(
      await tx.execute(sql`
        select g.stock_description, g.stock_quantity::text as stock_quantity, g.memo, g.failure_code,
               g.recorded_by, ${isoTs("g.created_at")} as created_at,
               (g.created_at > now() - make_interval(days => ${OWN_ENTRY_WINDOW_DAYS})) as within_window,
               coalesce(u.name, 'A team member') as recorded_by_name
          from giving_gifts g
          left join users u on u.id = g.recorded_by
         where g.id = ${giftId}::uuid and g.organization_id = ${organizationId}::uuid
      `),
    )[0]!;

    const reversals = rowsOf(
      await tx.execute(sql`
        select r.id, r.kind, r.amount_cents, r.reason, r.occurred_on::text as occurred_on,
               case when r.recorded_by is null then null else coalesce(u.name, 'A team member') end as recorded_by_name
          from giving_gift_reversals r
          left join users u on u.id = r.recorded_by
         where r.gift_id = ${giftId}::uuid and r.organization_id = ${organizationId}::uuid
         order by r.created_at asc, r.id asc
      `),
    ).map(
      (r): GiftReversalRow => ({
        id: String(r.id),
        kind: r.kind as GiftReversalRow["kind"],
        amountCents: Number(r.amount_cents),
        reason: (r.reason as string | null) ?? null,
        occurredOn: String(r.occurred_on),
        recordedByName: (r.recorded_by_name as string | null) ?? null,
      }),
    );

    const gift = mapGift(base);
    const own = detailRow.recorded_by === userId && detailRow.within_window === true;
    const canVoid =
      has.record &&
      gift.source === "offline" &&
      gift.status === "succeeded" &&
      !gift.voided &&
      (has.manage || own);

    return {
      kind: "ok",
      gift: {
        ...gift,
        stockDescription: (detailRow.stock_description as string | null) ?? null,
        stockQuantity: (detailRow.stock_quantity as string | null) ?? null,
        memo: (detailRow.memo as string | null) ?? null,
        failureCode: (detailRow.failure_code as string | null) ?? null,
        recordedByName: gift.source === "offline" ? String(detailRow.recorded_by_name) : null,
        createdAt: String(detailRow.created_at),
        reversals,
        canVoid,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// orgLocalToday
// ---------------------------------------------------------------------------

/**
 * "Today" in the organization's own time zone ('YYYY-MM-DD'): the date the
 * offline-gift form defaults to. `organization_settings.time_zone` with the
 * `America/New_York` fallback when the org has no settings row (F132) - the
 * same rule `presby_giving__local_date` applies in the database, so the default
 * the form shows is a date the function will accept.
 */
export async function orgLocalToday(tx: OrgTx, organizationId: string): Promise<string> {
  const result = await tx.execute(sql`
    select (now() at time zone coalesce(
             (select s.time_zone from organization_settings s where s.organization_id = ${organizationId}::uuid),
             'America/New_York'))::date::text as today
  `);
  return String(rowsOf(result)[0]!.today);
}

/** The form's default date, for a page that holds no transaction. `giving.record`. */
export async function getRecordingDefaults(
  personId: string,
  organizationId: string,
): Promise<{ kind: "ok"; today: string } | { kind: "forbidden" }> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.record) return { kind: "forbidden" };
    return { kind: "ok", today: await orgLocalToday(tx, organizationId) };
  });
}

// ---------------------------------------------------------------------------
// recordOfflineGift
// ---------------------------------------------------------------------------

export type RecordOfflineGiftResult =
  | { kind: "ok"; giftId: string; donorId: string; amountCents: number; createdDonor: boolean }
  | { kind: "forbidden" }
  /** Inline, per-field. Keys are dotted form paths (`amount`, `donor.donorId`). */
  | { kind: "invalid"; fieldErrors: FieldErrors }
  | { kind: "retired_fund" }
  | { kind: "future_date" }
  | { kind: "unidentified_method" }
  /** Same donor, date, amount and check number as an earlier gift: warn, do not block. */
  | { kind: "duplicate_warning"; giftId: string }
  /** A new donor whose name or email matches an existing one: warn, do not block. */
  | { kind: "duplicate_donor"; donors: Array<{ id: string; displayName: string }> };

/**
 * Records one offline gift. ONE transaction: resolve (or create) the donor ->
 * soft duplicate checks -> `presby_giving_record_offline_gift`. If the function
 * raises, the transaction rolls back, so a half-made donor can never be left
 * behind by a refused gift.
 *
 * `userId` is the signed-in user (`recorded_by`, a `users.id`); the DEFINER
 * function re-proves that this user's live person is an active member holding
 * `giving.record` (D2), so the claim cannot be forged by a caller who has the
 * wrong key.
 */
export async function recordOfflineGift(
  personId: string,
  organizationId: string,
  userId: string,
  values: OfflineGiftValues,
): Promise<RecordOfflineGiftResult> {
  const amountCents = offlineAmountCents(values.amount);

  try {
    return await withOrgContext(personId, organizationId, async (tx): Promise<RecordOfflineGiftResult> => {
      const has = await givingKeysInTx(tx, { personId, organizationId });
      if (!has.record) return { kind: "forbidden" };

      // -- 1. the donor ------------------------------------------------------
      let donorId: string;
      let createdDonor = false;
      const choice = values.donor;
      if (choice.mode === "existing") {
        const found = rowsOf(
          await tx.execute(sql`
            select id from giving_donors
             where id = ${choice.donorId}::uuid and organization_id = ${organizationId}::uuid
               and merged_into_id is null
          `),
        )[0];
        if (!found) {
          return { kind: "invalid", fieldErrors: { "donor.donorId": "That donor is no longer available. Pick them again." } };
        }
        donorId = choice.donorId;
      } else if (choice.mode === "unidentified") {
        donorId = await ensureUnidentifiedDonor(tx, organizationId, userId);
      } else {
        if (values.acknowledgeDuplicate !== true) {
          const matches = await findDonorMatches(tx, organizationId, choice.displayName, choice.email);
          if (matches.length > 0) return { kind: "duplicate_donor", donors: matches };
        }
        const created = rowsOf(
          await tx.execute(sql`
            insert into giving_donors (organization_id, display_name, email, address_line1, address_line2,
                   city, region, postal_code, country, created_by, updated_by)
            values (${organizationId}::uuid, ${choice.displayName}, ${choice.email}, ${choice.addressLine1},
                    ${choice.addressLine2}, ${choice.city}, ${choice.region}, ${choice.postalCode},
                    ${choice.country}, ${userId}::uuid, ${userId}::uuid)
            returning id
          `),
        )[0]!;
        donorId = String(created.id);
        createdDonor = true;
      }

      // -- 2. the soft duplicate check (existing donors only) -----------------
      if (!createdDonor && values.acknowledgeDuplicate !== true) {
        const candidates = rowsOf(
          await tx.execute(sql`
            select g.id, g.amount_cents, g.check_number,
                   exists (select 1 from giving_gift_reversals r
                            where r.gift_id = g.id and r.organization_id = g.organization_id and r.kind = 'void') as voided
              from giving_gifts g
             where g.organization_id = ${organizationId}::uuid and g.donor_id = ${donorId}::uuid
               and g.occurred_on = ${values.occurredOn}::date and g.source = 'offline'
          `),
        ).map(
          (r): GiftFingerprint => ({
            id: String(r.id),
            amountCents: Number(r.amount_cents),
            checkNumber: (r.check_number as string | null) ?? null,
            voided: r.voided === true,
          }),
        );
        const duplicate = findPossibleDuplicate(candidates, { amountCents, checkNumber: values.checkNumber });
        if (duplicate) return { kind: "duplicate_warning", giftId: duplicate.id };
      }

      // -- 3. the write, through the DEFINER function --------------------------
      const written = rowsOf(
        await tx.execute(sql`
          select presby_giving_record_offline_gift(
                   ${donorId}::uuid, ${values.fundId}::uuid, ${values.occurredOn}::date, ${values.method},
                   ${amountCents}::int, ${values.checkNumber}, ${values.stockDescription},
                   ${values.stockQuantity}::numeric, ${values.memo}, ${userId}::uuid) as id
        `),
      )[0]!;
      return { kind: "ok", giftId: String(written.id), donorId, amountCents, createdDonor };
    });
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "forbidden" };
    const code = givingFunctionCode(err, "giving_offline_gift");
    switch (code) {
      case "fund_unavailable":
        return { kind: "retired_fund" };
      case "date_out_of_range":
        return { kind: "future_date" };
      case "method_not_allowed":
        return values.donor.mode === "unidentified"
          ? { kind: "unidentified_method" }
          : { kind: "invalid", fieldErrors: { method: "That way of giving can't be recorded for this donor." } };
      case "donor_unavailable":
        return { kind: "invalid", fieldErrors: { "donor.donorId": "That donor is no longer available. Pick them again." } };
      case "amount_out_of_range":
        return { kind: "invalid", fieldErrors: { amount: "That amount can't be recorded." } };
      case "shape_invalid":
        return { kind: "invalid", fieldErrors: { _form: "Some of those details don't fit together. Check the method, check number and stock details." } };
      default:
        throw err;
    }
  }
}

/** The plate-offering donor for an org: created on first use (one per org, by partial unique index). */
async function ensureUnidentifiedDonor(tx: OrgTx, organizationId: string, userId: string): Promise<string> {
  await tx.execute(sql`
    insert into giving_donors (organization_id, kind, display_name, created_by, updated_by)
    values (${organizationId}::uuid, 'unidentified', 'Unidentified (plate offering)', ${userId}::uuid, ${userId}::uuid)
    on conflict (organization_id) where kind = 'unidentified' do nothing
  `);
  const row = rowsOf(
    await tx.execute(sql`
      select id from giving_donors
       where organization_id = ${organizationId}::uuid and kind = 'unidentified'
    `),
  )[0]!;
  return String(row.id);
}

/** Donors an identified new donor might really be: same email, or the same name. Names only. */
async function findDonorMatches(
  tx: OrgTx,
  organizationId: string,
  displayName: string,
  email: string | null,
): Promise<Array<{ id: string; displayName: string }>> {
  const result = await tx.execute(sql`
    select id, display_name from giving_donors
     where organization_id = ${organizationId}::uuid and kind = 'identified' and merged_into_id is null
       and (lower(display_name) = lower(${displayName}) or (${email}::text is not null and email = ${email}))
     order by lower(display_name) asc
     limit 5
  `);
  return rowsOf(result).map((r) => ({ id: String(r.id), displayName: String(r.display_name) }));
}

// ---------------------------------------------------------------------------
// voidGift
// ---------------------------------------------------------------------------

export type VoidGiftResult =
  | { kind: "ok"; reversalId: string; amountCents: number }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  /** Not an offline, succeeded, not-yet-voided gift - or a recorder past their own 30 days. */
  | { kind: "not_voidable"; reason: "not_offline" | "already_voided" | "not_succeeded" | "outside_window" }
  | { kind: "invalid"; fieldErrors: FieldErrors };

export async function voidGift(
  personId: string,
  organizationId: string,
  userId: string,
  input: { giftId: string; reason: string },
): Promise<VoidGiftResult> {
  try {
    return await withOrgContext(personId, organizationId, async (tx): Promise<VoidGiftResult> => {
      const has = await givingKeysInTx(tx, { personId, organizationId });
      // The database requires giving.record for the claimed actor (D2), so a
      // void without it cannot succeed whatever else the caller holds.
      if (!has.record) return { kind: "forbidden" };

      const gift = rowsOf(
        await tx.execute(sql`
          select g.source, g.status, g.amount_cents, g.recorded_by,
                 (g.created_at > now() - make_interval(days => ${OWN_ENTRY_WINDOW_DAYS})) as within_window,
                 exists (select 1 from giving_gift_reversals r
                          where r.gift_id = g.id and r.organization_id = g.organization_id and r.kind = 'void') as voided
            from giving_gifts g
           where g.id = ${input.giftId}::uuid and g.organization_id = ${organizationId}::uuid
        `),
      )[0];
      if (!gift) return { kind: "not_found" };
      if (gift.source !== "offline") return { kind: "not_voidable", reason: "not_offline" };
      if (gift.status !== "succeeded") return { kind: "not_voidable", reason: "not_succeeded" };
      if (gift.voided === true) return { kind: "not_voidable", reason: "already_voided" };

      // giving.manage may void any offline gift; a recorder only their own
      // entry, and only within the window.
      const own = gift.recorded_by === userId && gift.within_window === true;
      if (!has.manage && !own) {
        return gift.recorded_by === userId
          ? { kind: "not_voidable", reason: "outside_window" }
          : { kind: "forbidden" };
      }

      const written = rowsOf(
        await tx.execute(sql`
          select presby_giving_void_gift(${input.giftId}::uuid, ${input.reason}, ${userId}::uuid) as id
        `),
      )[0]!;
      return { kind: "ok", reversalId: String(written.id), amountCents: Number(gift.amount_cents) };
    });
  } catch (err) {
    if (isNotPermitted(err)) return { kind: "forbidden" };
    switch (givingFunctionCode(err, "giving_void")) {
      case "reason_required":
        return { kind: "invalid", fieldErrors: { reason: "Give a reason for voiding this gift." } };
      case "already_voided":
        return { kind: "not_voidable", reason: "already_voided" };
      case "not_offline":
        return { kind: "not_voidable", reason: "not_offline" };
      case "gift_unavailable":
        return { kind: "not_found" };
      default:
        throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// listRecentOwnEntries (S4)
// ---------------------------------------------------------------------------

export interface OwnEntryRow {
  id: string;
  occurredOn: string;
  donorName: string;
  fundName: string;
  method: string | null;
  amountCents: number;
  voided: boolean;
  /** ISO-8601 UTC, when the entry was made. */
  createdAt: string;
  /** Still inside the recorder's own void window. */
  canVoid: boolean;
}

export type ListRecentOwnEntriesResult =
  | { kind: "ok"; entries: OwnEntryRow[] }
  | { kind: "forbidden" };

/**
 * The recorder's OWN entries from the last 30 days - the whole of what S4 lets
 * `giving.record` read about gifts. Keyed on `recorded_by = userId` in SQL;
 * there is no parameter that selects another person's entries, no totals and no
 * donor contact detail. `giving.record`.
 */
export async function listRecentOwnEntries(
  personId: string,
  organizationId: string,
  userId: string,
): Promise<ListRecentOwnEntriesResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.record) return { kind: "forbidden" };

    const result = await tx.execute(sql`
      select g.id, g.occurred_on::text as occurred_on, coalesce(rd.display_name, d.display_name) as donor_name,
             f.name as fund_name, g.method, g.amount_cents, g.livemode, ${isoTs("g.created_at")} as created_at,
             exists (select 1 from giving_gift_reversals r
                      where r.gift_id = g.id and r.organization_id = g.organization_id and r.kind = 'void') as voided
        from giving_gifts g
        join giving_donors d on d.id = g.donor_id and d.organization_id = g.organization_id
        left join giving_donors rd on rd.id = d.merged_into_id and rd.organization_id = d.organization_id
        join giving_funds f on f.id = g.fund_id and f.organization_id = g.organization_id
       where g.organization_id = ${organizationId}::uuid and g.recorded_by = ${userId}::uuid
         and g.source = 'offline'
         and g.created_at > now() - make_interval(days => ${OWN_ENTRY_WINDOW_DAYS})
       order by g.created_at desc, g.id desc
       limit 100
    `);
    return {
      kind: "ok",
      entries: rowsOf(result).map(
        (r): OwnEntryRow => ({
          id: String(r.id),
          occurredOn: String(r.occurred_on),
          donorName: String(r.donor_name),
          fundName: String(r.fund_name),
          method: (r.method as string | null) ?? null,
          amountCents: Number(r.amount_cents),
          voided: r.voided === true,
          createdAt: String(r.created_at),
          canVoid: r.voided !== true,
        }),
      ),
    };
  });
}
