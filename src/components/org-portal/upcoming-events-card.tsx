import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EventTypeChip } from "@/components/org-portal/event-types/event-type-chip";
import { EventTypeIcon } from "@/components/org-portal/event-types/event-type-icon";
import { dayKeyOf, formatTime } from "@/lib/calendar/wall-clock";
import { formatShortDate } from "@/lib/calendar/month";
import type { UpcomingCardState } from "@/lib/org-portal/main-row";

const LINK_CLASSES =
  "inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * The "Coming up" card: the next few upcoming events, one per series, read
 * through the member calendar's own list function. Server Component; it
 * receives a resolved `UpcomingCardState` from `composeMainRow` and asks no
 * permission or toggle question of its own (DECISION-162: a widget's
 * visibility is its read function's result — `disabled` / `forbidden` never
 * reach this component, the plan has no card for them).
 *
 * The heading is "Coming up", not "Church Events": org types include
 * presbyteries and synods.
 *
 * No time is formatted through `toLocale*` or a `Date`: `startsAtWallClock` is
 * wall-clock text the SQL already produced, and the calendar's pure formatters
 * read it as text. End times are not shown. Each row links to the member detail
 * route with `?from=` so the detail page reads "Back to home".
 *
 * A row's type chip carries the type name; an org with no event types at all
 * (`eventType: null`) gets the neutral calendar glyph and no label. The glyph
 * and chevron are `aria-hidden`; hover is never the only affordance.
 */
export function UpcomingEventsCard({
  slug,
  state,
}: {
  slug: string;
  state: UpcomingCardState;
}) {
  const calendarHref = `/o/${slug}/calendar`;
  const backToHome = encodeURIComponent(`/o/${slug}`);

  return (
    <section aria-labelledby="upcoming-events-heading" className="space-y-3">
      <h2 id="upcoming-events-heading" className="text-xl font-semibold">
        Coming up
      </h2>
      <Card>
        <CardContent className="space-y-4">
          {state.kind === "events" && (
            <>
              <ul className="divide-y divide-border">
                {state.events.map((event) => (
                  <li key={event.seriesKey}>
                    <Link
                      href={`/o/${slug}/calendar/${event.id}?from=${backToHome}`}
                      className="group flex min-h-11 items-start justify-between gap-3 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      <span className="min-w-0 space-y-1">
                        <span className="block break-words text-base font-medium text-primary underline-offset-4 group-hover:underline">
                          {event.title}
                        </span>
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="text-sm text-muted-foreground">
                            {formatShortDate(dayKeyOf(event.startsAtWallClock))}
                            {" · "}
                            {formatTime(event.startsAtWallClock)}
                          </span>
                          {event.eventType ? (
                            <EventTypeChip
                              name={event.eventType.name}
                              colorToken={event.eventType.colorToken}
                              iconKey={event.eventType.iconKey}
                            />
                          ) : (
                            <EventTypeIcon
                              iconKey={null}
                              className="text-muted-foreground"
                            />
                          )}
                        </span>
                        {event.location && (
                          <span className="block break-words text-sm text-muted-foreground">
                            {event.location}
                          </span>
                        )}
                      </span>
                      <ChevronRight
                        aria-hidden="true"
                        className="mt-1 size-5 shrink-0 text-muted-foreground"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href={calendarHref} className={LINK_CLASSES}>
                See the full calendar →
              </Link>
            </>
          )}
          {state.kind === "empty" && (
            <>
              <p className="text-base">Nothing is on the calendar right now.</p>
              <Link href={calendarHref} className={LINK_CLASSES}>
                Open the calendar →
              </Link>
            </>
          )}
          {state.kind === "failed" && (
            <>
              <p className="text-base">
                We can&apos;t load upcoming events right now. Try again in a
                moment.
              </p>
              <Link href={calendarHref} className={LINK_CLASSES}>
                Open the calendar →
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
