import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { ConnectionPanel } from "@/lib/giving/connection";
import { deriveDisplayState, isOpenState } from "@/lib/giving/connection-display";
import {
  CONNECT_DISCLOSURE,
  DISCONNECTED_REASON,
  GIVE_PAGE_COPY,
  GO_LIVE_ITEMS,
  MONTHLY_STOP_NOTE,
  STATE_COPY,
  STRIPE_RECEIPT_NOTE,
} from "@/lib/giving/giving-copy";
import { describeBankRate, describeCardRate } from "@/lib/giving/rates-format";
import { ConnectPanel } from "./connect-panel";

/**
 * The overview's "Online giving" card and the connect-return page's result -
 * docs/work-log/2026-10-15-online-giving.md, Batch 3b and the Component / Page
 * Plan. A SERVER component: it states what is true (the state, the checklist,
 * the go-live items, the rates, the disclosure) from the `loadConnectionPanel()`
 * projection, and hands that projection to `<ConnectPanel>` (client) for the
 * controls. Reads nothing itself.
 *
 * Six states, none of them colour alone (a badge with words, plus checklist
 * rows with "Done"/"Needed" text and an icon):
 *   not started - details due - waiting for Stripe - active - needs attention -
 *   disconnected (and "not available" when the installation has no Stripe).
 */

function Fact({ done, label }: { done: boolean; label: string }) {
  const Icon = done ? CheckCircle2 : Circle;
  return (
    <li className="flex min-h-8 items-center gap-2 text-sm">
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="min-w-0 flex-1">{label}</span>
      <span className="shrink-0 text-muted-foreground">{done ? "Done" : "Needed"}</span>
    </li>
  );
}

export function ConnectionCard({ slug, panel }: { slug: string; panel: ConnectionPanel }) {
  const display = deriveDisplayState(panel);
  const copy = STATE_COPY[display];
  const c = panel.connection;
  const open = isOpenState(display);
  const badgeVariant = display === "active" ? "default" : display === "restricted" ? "destructive" : "secondary";
  const showDisclosure = display === "not_started" || display === "details_due" || display === "disconnected";
  const missing = new Set<string>(panel.readiness.missing);

  return (
    <Card data-testid="connection-card" data-state={display}>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-medium">Stripe account</h3>
          <Badge variant={badgeVariant} className="text-sm" data-testid="connection-state">
            {copy.badge}
          </Badge>
          {c && display !== "disconnected" && (
            <Badge variant="outline" className="text-sm" data-testid="connection-mode">
              {c.livemode ? "Live" : "Test mode"}
            </Badge>
          )}
        </div>

        <p className="text-sm text-muted-foreground">{copy.summary}</p>

        {display === "restricted" && c && (
          <p className="text-sm" data-testid="restricted-detail">
            {c.requirementsDue ? "Stripe is waiting on more information from your account." : "Stripe has limited what your account can do."}
            {c.disabledReason ? ` Reason from Stripe: ${c.disabledReason}.` : ""}
          </p>
        )}

        {display === "disconnected" && c && (
          <p className="text-sm text-muted-foreground" data-testid="disconnected-detail">
            {c.disconnectedReason ? DISCONNECTED_REASON[c.disconnectedReason] : "Disconnected."}
            {c.disconnectedAt && (
              <>
                {" "}
                <FormattedDate value={c.disconnectedAt} mode="date" />
              </>
            )}
          </p>
        )}

        {open && c && (
          <ul aria-label="What Stripe has confirmed" className="space-y-1" data-testid="connection-facts">
            <Fact done={c.detailsSubmitted} label="Details sent to Stripe" />
            <Fact done={c.cardEnabled} label="Card payments" />
            <Fact done={c.achEnabled} label="Bank (ACH) payments" />
            <Fact done={c.payoutsEnabled} label="Payouts to your bank" />
          </ul>
        )}

        {display === "active" && c && (
          <section aria-labelledby="give-page-heading" className="space-y-3 border-t border-border pt-4">
            <h4 id="give-page-heading" className="text-base font-medium">
              Give page
            </h4>
            {c.publicEnabledAt ? (
              <p className="text-sm" data-testid="give-page-state">
                {GIVE_PAGE_COPY.on} Turned on <FormattedDate value={c.publicEnabledAt} mode="date" />.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground" data-testid="give-page-state">
                  {GIVE_PAGE_COPY.off}
                </p>
                <p className="text-sm font-medium">{GIVE_PAGE_COPY.blocked}</p>
                <ul aria-label="What the give page needs" className="space-y-1" data-testid="go-live-checklist">
                  {Object.entries(GO_LIVE_ITEMS).map(([key, label]) => (
                    <Fact key={key} done={!missing.has(key)} label={label} />
                  ))}
                </ul>
                {missing.has("online_fund") && (
                  <Link
                    href={`/o/${slug}/admin/giving/funds`}
                    className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    Offer a fund online
                  </Link>
                )}
              </>
            )}
          </section>
        )}

        {display === "active" && c && (
          <section aria-labelledby="rates-heading" className="space-y-1 border-t border-border pt-4">
            <h4 id="rates-heading" className="text-base font-medium">
              Fee rates
            </h4>
            <p className="text-sm text-muted-foreground" data-testid="rates-summary">
              Card: {describeCardRate(c.rates.cardFeeBps, c.rates.cardFeeFixedCents)}. Bank:{" "}
              {describeBankRate(c.rates.achFeeBps, c.rates.achFeeCapCents)}.
            </p>
          </section>
        )}

        {display === "active" && (
          <div className="space-y-1 border-t border-border pt-4 text-sm text-muted-foreground">
            <p>{STRIPE_RECEIPT_NOTE}</p>
            <p>{MONTHLY_STOP_NOTE}</p>
          </div>
        )}

        <ConnectPanel slug={slug} panel={panel} />

        {showDisclosure && (
          <section aria-labelledby="disclosure-heading" className="space-y-2 border-t border-border pt-4">
            <h4 id="disclosure-heading" className="text-base font-medium">
              {CONNECT_DISCLOSURE.heading}
            </h4>
            <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground" data-testid="connect-disclosure">
              {CONNECT_DISCLOSURE.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
