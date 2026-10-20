import { Badge } from "@/components/ui/badge";
import { FormattedDate } from "@/components/shared/formatted-date";
import { SETTLEMENTS_COPY } from "@/lib/giving/giving-copy";
import { formatCents } from "@/lib/giving/money";
import { reconciliationOf, type SettlementRow } from "@/lib/giving/settlement-display";

/**
 * The payouts as cards - one DOM for every width, phone first. Each card: the
 * arrival date and the payout's amount, the words its state wears (Paid / Failed,
 * Automatic / Manual, Test - never colour alone), Stripe's payout id (what the
 * treasurer finds in the Stripe dashboard), then ONE of five honest statements
 * about its contents, chosen by `reconciliationOf`:
 *   manual   - "Reconciliation unavailable" (Stripe can't list a manual payout;
 *              this is never shown as "no transactions");
 *   failed   - nothing to match, the money returns to the Stripe balance;
 *   waiting  - an automatic payout whose contents have not arrived yet;
 *   balanced - the contents add up to the payout (the figures, and whether every
 *              charge matches a gift recorded here);
 *   mismatch - they do not, with both numbers, never a quiet pass.
 * Read-only: no control mutates anything. A server component.
 */
export function SettlementsList({ settlements }: { settlements: SettlementRow[] }) {
  return (
    <ul className="space-y-2" data-testid="settlements-list">
      {settlements.map((row) => {
        const state = reconciliationOf(row);
        return (
          <li
            key={row.id}
            className="rounded-lg border border-border bg-card p-4 text-card-foreground"
            data-testid="settlement-row"
            data-reconciliation={state}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 text-base font-medium">
                {row.arrivalDate ? <FormattedDate value={row.arrivalDate} mode="date" /> : SETTLEMENTS_COPY.noDate}
              </p>
              <p className="shrink-0 text-base font-semibold">{formatCents(row.amountCents)}</p>
            </div>
            <p className="mt-1 break-all text-sm text-muted-foreground">{row.payoutId}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={row.status === "paid" ? "outline" : "secondary"}>
                {row.status === "paid" ? SETTLEMENTS_COPY.paid : SETTLEMENTS_COPY.failed}
              </Badge>
              <Badge variant="outline">{row.automatic ? SETTLEMENTS_COPY.automatic : SETTLEMENTS_COPY.manual}</Badge>
              {row.testMode && <Badge variant="secondary">{SETTLEMENTS_COPY.test}</Badge>}
            </div>

            {state === "manual" && (
              <div className="mt-3 rounded-md border border-dashed border-border p-3" data-testid="settlement-manual">
                <p className="text-sm font-medium">{SETTLEMENTS_COPY.manualTitle}</p>
                <p className="mt-1 text-sm text-muted-foreground">{SETTLEMENTS_COPY.manualBody}</p>
              </div>
            )}
            {state === "failed" && <p className="mt-3 text-sm text-muted-foreground">{SETTLEMENTS_COPY.failedBody}</p>}
            {state === "waiting" && (
              <p className="mt-3 text-sm text-muted-foreground" data-testid="settlement-waiting">
                {SETTLEMENTS_COPY.waiting}
              </p>
            )}
            {(state === "balanced" || state === "mismatch") && (
              <div className="mt-3 space-y-2" data-testid="settlement-contents">
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">
                    {SETTLEMENTS_COPY.charges} ({row.chargeCount})
                  </dt>
                  <dd className="text-right">{formatCents(row.chargeGrossCents)}</dd>
                  {row.returnCount > 0 && (
                    <>
                      <dt className="text-muted-foreground">
                        {SETTLEMENTS_COPY.returns} ({row.returnCount})
                      </dt>
                      <dd className="text-right">{formatCents(row.returnGrossCents)}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">{SETTLEMENTS_COPY.fees}</dt>
                  <dd className="text-right">{formatCents(-row.feeCents)}</dd>
                  <dt className="font-medium">{SETTLEMENTS_COPY.net}</dt>
                  <dd className="text-right font-medium">{formatCents(row.netCents)}</dd>
                </dl>
                {state === "mismatch" ? (
                  <p className="text-sm font-medium" role="status">
                    {SETTLEMENTS_COPY.mismatch(formatCents(row.netCents), formatCents(row.amountCents))}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">{SETTLEMENTS_COPY.balanced}</p>
                )}
                {row.chargeCount > 0 && (
                  <p className="text-sm text-muted-foreground" data-testid="settlement-matching">
                    {row.unmatchedCharges === 0 ? SETTLEMENTS_COPY.allMatched : SETTLEMENTS_COPY.unmatched(row.unmatchedCharges)}
                  </p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
