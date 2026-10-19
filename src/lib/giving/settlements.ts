import "server-only";
import { sql } from "drizzle-orm";
import { withOrgContext } from "@/lib/authz";
import { isoTs, rowsOf } from "./db-util";
import { givingKeysInTx } from "./keys";
import type { SettlementRow } from "./settlement-display";

export type { SettlementRow };

/**
 * The payouts list - docs/work-log/2026-10-15-online-giving.md, Phase 3
 * "Settlements" and Batch 6 (droppable): what Stripe paid out to the
 * congregation's bank, and what each deposit CONTAINED, so a treasurer can
 * match a bank-statement line to gifts. READ-ONLY: the rows are written by the
 * ingest path (`presby_giving_apply_settlement` for the header on `payout.paid`
 * / `payout.failed`; `presby_giving_apply_settlement_lines` for the contents of
 * an AUTOMATIC payout, `ingest/settlement-lines.ts`). No tenant connection holds
 * INSERT or UPDATE on either table; this file only selects.
 *
 *   listSettlements    giving.view   (re-checked here, inside its own
 *                                     transaction - the page's gate is a courtesy)
 *
 * What a row says, and the three honest states of its contents:
 *   - AUTOMATIC payout, lines loaded: counts and totals by kind, the fees Stripe
 *     took, the net, how many charges match a recorded gift, and whether the
 *     lines add up to the payout (`reconciled`);
 *   - AUTOMATIC payout, lines not loaded yet: the header alone ("still loading" -
 *     the read retries on the cron's back-off);
 *   - MANUAL payout (`automatic = false`): Stripe cannot list the contents of a
 *     manual payout, so none are ever loaded - the page says "reconciliation
 *     unavailable", never zero lines.
 * A FAILED payout is a header too (the money returns to the Stripe balance).
 *
 * A Stripe TEST-mode payout is listed with a "Test" flag (so a treasurer who is
 * exercising Stripe can see their own test activity) and never reaches a total:
 * this file computes totals PER PAYOUT only, never across payouts (P3-17).
 *
 * Amounts are `bigint` in the table and arrive here as numbers (cents; a
 * congregation's payouts are nowhere near 2^53). Lines are SIGNED: a refund is
 * negative. At most `LIMIT` payouts are returned, newest first.
 */

const LIMIT = 100;

export type ListSettlementsResult =
  | { kind: "forbidden" }
  | { kind: "ok"; settlements: SettlementRow[]; truncated: boolean };

export async function listSettlements(personId: string, organizationId: string): Promise<ListSettlementsResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.view) return { kind: "forbidden" as const };

    const rows = rowsOf(
      await tx.execute(sql`
        select s.id::text as id, s.external_settlement_id, s.arrival_date::text as arrival_date, s.status,
               s.automatic, s.livemode, s.gross_cents::text as amount_cents, ${isoTs("s.created_at")} as recorded_at,
               (s.lines_loaded_at is not null) as lines_loaded,
               coalesce(a.line_count, 0) as line_count,
               coalesce(a.charge_count, 0) as charge_count, coalesce(a.charge_gross, 0)::text as charge_gross,
               coalesce(a.return_count, 0) as return_count, coalesce(a.return_gross, 0)::text as return_gross,
               coalesce(a.fee_total, 0)::text as fee_total, coalesce(a.net_total, 0)::text as net_total,
               coalesce(a.unmatched_charges, 0) as unmatched_charges
          from giving_settlements s
          left join lateral (
            select count(*) as line_count,
                   count(*) filter (where l.kind = 'charge') as charge_count,
                   sum(l.gross_cents) filter (where l.kind = 'charge') as charge_gross,
                   count(*) filter (where l.kind in ('refund', 'dispute')) as return_count,
                   sum(l.gross_cents) filter (where l.kind in ('refund', 'dispute')) as return_gross,
                   sum(l.fee_cents) as fee_total,
                   sum(l.net_cents) as net_total,
                   count(*) filter (where l.kind = 'charge' and l.gift_id is null) as unmatched_charges
              from giving_settlement_lines l
             where l.settlement_id = s.id and l.organization_id = s.organization_id
          ) a on true
         where s.organization_id = ${organizationId}::uuid
         order by s.arrival_date desc nulls last, s.created_at desc, s.id desc
         limit ${LIMIT + 1}`),
    );

    return {
      kind: "ok" as const,
      truncated: rows.length > LIMIT,
      settlements: rows.slice(0, LIMIT).map((r) => ({
        id: String(r.id),
        payoutId: String(r.external_settlement_id),
        arrivalDate: (r.arrival_date as string | null) ?? null,
        status: r.status as SettlementRow["status"],
        automatic: r.automatic === true,
        testMode: r.livemode !== true,
        amountCents: Number(r.amount_cents),
        recordedAt: String(r.recorded_at),
        linesLoaded: r.lines_loaded === true,
        lineCount: Number(r.line_count),
        chargeCount: Number(r.charge_count),
        chargeGrossCents: Number(r.charge_gross),
        returnCount: Number(r.return_count),
        returnGrossCents: Number(r.return_gross),
        feeCents: Number(r.fee_total),
        netCents: Number(r.net_total),
        unmatchedCharges: Number(r.unmatched_charges),
      })),
    };
  });
}
