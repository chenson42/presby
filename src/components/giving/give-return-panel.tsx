import Link from "next/link";
import { CheckCircle2, Clock3, Landmark, CircleAlert, SearchX, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TestModeBadge } from "@/components/giving/test-mode-badge";
import { ReturnPoller } from "@/components/giving/return-poller";
import {
  RETURN_COPY,
  RETURN_PANELS,
  TEST_MODE_DONOR_DETAIL,
  returnGiftLine,
  type ReturnPanelKey,
} from "@/lib/giving/giving-copy";
import { formatCents } from "@/lib/giving/money";
import type { ReturnState } from "@/lib/giving/public-config";

/**
 * The five panels a donor can land on after Stripe, plus the database-error
 * one - docs/work-log/2026-10-15-online-giving.md, Flow 3 / 4 / 6 and the
 * adversarial rows "State-machine shortcuts" and "Receipt versus statement".
 *
 *   confirming    paid at Stripe, the signed webhook has not landed (polls)
 *   received      recorded (a monthly gift also says how to stop it)
 *   bank_pending  a bank transfer, several days to confirm
 *   failed        no gift recorded
 *   unknown       absent, malformed or another congregation's session: ONE panel
 *   error         we could not read the database; says the gift is unaffected
 *
 * The panel is chosen by the SERVER from presby's own rows; nothing in the URL
 * marks a gift paid. It shows an amount and a fund and nothing else: never a
 * name, an email, an address or an id (ReturnState carries none). Stripe's
 * payment receipt is called a payment receipt and kept apart from the year-end
 * statement (G18). Every panel is a labelled `section` with a heading and an icon,
 * so no state is told by colour alone. A server component; the only client piece
 * is `<ReturnPoller>`, mounted for `confirming` only.
 */

const ICONS: Record<ReturnPanelKey, typeof CheckCircle2> = {
  confirming: Clock3,
  received: CheckCircle2,
  bank_pending: Landmark,
  failed: CircleAlert,
  unknown: SearchX,
  error: WifiOff,
};

export function GiveReturnPanel({
  state,
  giveHref,
  homeHref,
  homeLabel,
  retryHref,
}: {
  state: ReturnState;
  /** Where "Give again" goes. */
  giveHref: string;
  /** Where the quiet exit goes: the church website, or the member portal. */
  homeHref: string;
  homeLabel: string;
  /** Reload target for the `error` panel (this page with its own query). */
  retryHref?: string;
}) {
  const key: ReturnPanelKey = state.state;
  const copy = RETURN_PANELS[key];
  const Icon = ICONS[key];
  const hasGift = state.state === "confirming" || state.state === "received" || state.state === "bank_pending" || state.state === "failed";
  const monthly = hasGift && state.frequency === "monthly";

  return (
    <div className="space-y-4">
      {hasGift && !state.livemode && <TestModeBadge detail={TEST_MODE_DONOR_DETAIL} />}
      <section
        data-testid={`give-return-${key}`}
        aria-labelledby="give-return-heading"
        className="space-y-4 rounded-lg border border-border bg-card p-4 text-card-foreground sm:p-6"
      >
        <div className="flex items-start gap-3">
          <Icon className="mt-1 size-6 shrink-0" aria-hidden />
          <h1 id="give-return-heading" className="text-2xl font-semibold">
            {copy.heading}
          </h1>
        </div>

        {hasGift && state.state !== "failed" && (
          <p data-testid="give-return-gift" className="text-lg font-medium">
            {returnGiftLine(formatCents(state.giftAmountCents), state.fundName, monthly)}
            {state.coveredCents > 0 && (
              <span className="block text-sm font-normal text-muted-foreground">
                Includes {formatCents(state.coveredCents)} toward processing fees. Total {formatCents(state.giftAmountCents + state.coveredCents)}.
              </span>
            )}
          </p>
        )}

        <p className="text-base text-muted-foreground">{copy.body}</p>
        {monthly && (state.state === "received" || state.state === "confirming") && (
          <p data-testid="give-return-monthly" className="text-base text-muted-foreground">
            {RETURN_COPY.monthlyStop}
          </p>
        )}

        {state.state === "confirming" && <ReturnPoller />}

        <div className="flex flex-col gap-2 sm:flex-row">
          {state.state === "error" && retryHref && (
            <Button asChild variant="outline" className="min-h-11">
              <Link href={retryHref}>{RETURN_COPY.tryAgain}</Link>
            </Button>
          )}
          {(state.state === "failed" || state.state === "unknown") && (
            <Button asChild className="min-h-11">
              <Link href={giveHref}>{RETURN_COPY.giveAgain}</Link>
            </Button>
          )}
          <Button asChild variant="link" className="min-h-11">
            <Link href={homeHref}>{homeLabel}</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
