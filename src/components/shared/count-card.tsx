import Link from "next/link";
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * One dashboard count card: a title, a headline number or phrase, a few lines
 * of detail, and a destination. Composes `DestinationCard`'s affordance (the
 * WHOLE card is the link, title as an `<h3>`, a chevron, one focus ring on the
 * link with an offset) so the platform dashboard and the chooser feel like the
 * same product.
 *
 * PRESENTATION ONLY. No gating and no reads: the caller mounts a card only for
 * a viewer who holds its key, and the caller's presenter turns a reader result
 * into a `CountCardState`. A failed read is its OWN state (`kind: "error"`),
 * never a zero (U2): a union the presenter cannot collapse is what stops a
 * failure reading as an all-clear.
 *
 * STATUS IS NEVER COLOUR ALONE (R4, DECISION-255 stage one). Existing tokens
 * only, always an icon plus words:
 *   attention : `border-foreground`, TriangleAlert, the words "Needs attention"
 *   clear     : muted text, CircleCheck, the headline ("Nothing waiting.")
 *   neutral   : no status row
 *   error     : dashed border, CircleAlert in `text-destructive`, a message
 * In the error state the card is NOT a link (no nested links): the title, the
 * message and a 44px "Try again" link back to the dashboard.
 */
export type CountCardState =
  | {
      kind: "ok";
      tone: "attention" | "clear" | "neutral";
      headline: string;
      lines?: readonly string[];
      /** Overrides the card's default destination (e.g. a pre-filtered list). */
      href?: string;
    }
  | { kind: "error"; retryHref: string };

export function CountCard({
  title,
  icon: Icon,
  href,
  state,
}: {
  title: string;
  icon: LucideIcon;
  href: string;
  state: CountCardState;
}) {
  if (state.kind === "error") {
    return (
      <Card className="h-full gap-3 border-dashed py-5 shadow-none">
        <CardHeader className="gap-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <h3 className="text-base font-semibold leading-snug text-foreground">
              {title}
            </h3>
          </div>
          <p className="flex items-start gap-2 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>We can&apos;t load this right now.</span>
          </p>
          <Button asChild variant="outline" className="mt-1 min-h-11 w-fit">
            <Link href={state.retryHref}>Try again</Link>
          </Button>
        </CardHeader>
      </Card>
    );
  }

  const attention = state.tone === "attention";

  return (
    <Link
      href={state.href ?? href}
      className="group block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Card
        className={cn(
          "h-full gap-3 py-5 transition-colors group-hover:border-ring group-hover:bg-accent group-active:bg-accent/70",
          attention && "border-foreground",
        )}
      >
        <CardHeader className="gap-2">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <h3 className="min-w-0 flex-1 text-base font-semibold leading-snug text-foreground">
              {title}
            </h3>
            <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
          </div>

          {attention ? (
            <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
              Needs attention
            </p>
          ) : null}

          <p
            className={cn(
              "flex min-w-0 items-start gap-1.5 break-words text-lg leading-snug",
              state.tone === "clear"
                ? "text-sm text-muted-foreground"
                : "font-semibold text-foreground",
            )}
          >
            {state.tone === "clear" ? (
              <CircleCheck
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
            ) : null}
            <span className="min-w-0">{state.headline}</span>
          </p>

          {state.lines && state.lines.length > 0 ? (
            <ul className="space-y-0.5 text-sm text-muted-foreground">
              {state.lines.map((line) => (
                <li key={line} className="break-words">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
        </CardHeader>
      </Card>
    </Link>
  );
}

/**
 * The `Suspense` fallback for one card: same footprint, pulsing blocks, and an
 * sr-only "Loading {title}" so a screen reader is told something is arriving.
 * Skeletons are used here, per card, and never in a `loading.tsx` (R1c).
 */
export function CountCardSkeleton({ title }: { title: string }) {
  return (
    <Card className="h-full gap-3 py-5" aria-busy="true">
      <CardHeader className="gap-3">
        <span className="sr-only">Loading {title}</span>
        <div className="h-5 w-1/2 animate-pulse rounded-md bg-muted" />
        <div className="h-6 w-2/3 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-1/3 animate-pulse rounded-md bg-muted" />
      </CardHeader>
    </Card>
  );
}
