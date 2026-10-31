import { ChevronDown } from "lucide-react";
import { WEEKDAY_ABBREVIATIONS, WEEKDAY_NAMES, monthLabel } from "@/lib/calendar/month";
import type { PublicCalendarEvent } from "@/lib/calendar/public-contract";
import { describeWhen, formatTimeRange } from "@/lib/calendar/wall-clock";
import { typeColorClasses } from "@/lib/events/type-palette";
import { cn } from "@/lib/utils";
import type { DayModel, MonthModel } from "./events-calendar-model";

/**
 * One month of the public events calendar, rendered ONCE on the server
 * (docs/work-log/2026-10-25-public-events-calendar.md, Phase 3 "Layout of the
 * public calendar"; DECISION-239/241). There is ONE DOM per month, not a grid
 * plus a duplicate list: CSS lays it out.
 *
 *   - below `md`, or when the island's wrapper says `data-view="list"`: a
 *     vertical list of the days that have events;
 *   - from `md` up in `data-view="month"`: a seven-column grid with a weekday
 *     header row, leading spacers, and every day of the month as a cell.
 *
 * The switch is `group-data-[view=...]/cal:` variants keyed off the wrapper in
 * `events-calendar-switcher.tsx`, so the phone layout is correct in the very
 * first HTML, with no JavaScript and no flash of a grid. EVERY class below is a
 * full static literal (Tailwind scans source; nothing is built by
 * interpolation), there is no `<style>` element (`check:brand-scope`) and no
 * literal `<table>` (C2). Display utilities never compete: a day is `hidden`
 * only by variants that exclude the desktop grid, so cascade order cannot
 * decide a layout.
 *
 * ALL TEXT IS PLAIN TEXT. Title, location, description and type name are
 * org-authored free text: React-escaped, `whitespace-pre-line` for the
 * description at most, no Markdown, no auto-linking, no
 * `dangerouslySetInnerHTML`. `PublicCalendarEvent` has no id, so none can reach
 * this markup; React keys are indexes.
 *
 * Event details are native `<details>`/`<summary>`: no JavaScript, works before
 * hydration, crawlable. NO `display` override on a `<summary>` (it broke
 * `<details>` on iOS once; CLAUDE.md -> Verify in a Browser): layout lives on a
 * `<span>` inside it.
 */

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function EventItem({ event, anchorRight }: { event: PublicCalendarEvent; anchorRight: boolean }) {
  const classes = typeColorClasses(event.typeColor);
  const endsLine = describeWhen(event.startsAt, event.endsAt).end;
  const hasBody = Boolean(endsLine || event.location || event.typeName || event.description);

  const row = (
    <span className="flex items-start gap-2">
      <span className="min-w-0 flex-1">
        <span className="font-medium whitespace-nowrap md:group-data-[view=month]/cal:whitespace-normal">
          {formatTimeRange(event.startsAt, event.endsAt)}
        </span>{" "}
        <span className="[overflow-wrap:anywhere]">{event.title}</span>
      </span>
      {hasBody && (
        <ChevronDown
          className="mt-1 size-4 shrink-0 transition-transform group-open/ev:rotate-180"
          aria-hidden="true"
        />
      )}
    </span>
  );

  const rowClasses = cn(
    "min-h-11 rounded-md border border-transparent border-l-4 px-3 py-2 text-base md:group-data-[view=month]/cal:px-1.5 md:group-data-[view=month]/cal:py-1 md:group-data-[view=month]/cal:text-sm",
    classes.chip,
    classes.rule,
  );

  if (!hasBody) {
    return (
      <div data-testid="public-calendar-event" className={rowClasses}>
        {row}
      </div>
    );
  }

  return (
    <details data-testid="public-calendar-event" className="group/ev relative">
      <summary
        className={cn(
          rowClasses,
          "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
          FOCUS,
        )}
      >
        {row}
      </summary>
      <div
        className={cn(
          "mt-1 space-y-1.5 rounded-md border border-border bg-card p-3 text-sm text-card-foreground md:group-data-[view=month]/cal:absolute md:group-data-[view=month]/cal:top-full md:group-data-[view=month]/cal:z-20 md:group-data-[view=month]/cal:w-64 md:group-data-[view=month]/cal:shadow-lg",
          anchorRight
            ? "md:group-data-[view=month]/cal:right-0"
            : "md:group-data-[view=month]/cal:left-0",
        )}
      >
        {endsLine && <p>{endsLine}</p>}
        {event.location && (
          <p className="[overflow-wrap:anywhere]">
            <span className="font-medium">Where:</span> {event.location}
          </p>
        )}
        {event.typeName && (
          <p className="[overflow-wrap:anywhere]">
            <span className="font-medium">Event type:</span> {event.typeName}
          </p>
        )}
        {event.description && (
          <p className="whitespace-pre-line [overflow-wrap:anywhere]">{event.description}</p>
        )}
      </div>
    </details>
  );
}

function Day({ day }: { day: DayModel }) {
  const empty = day.events.length === 0;
  // The last two weekday columns open their detail card to the left.
  const anchorRight = day.weekday >= 5;

  return (
    <section
      aria-label={day.longLabel}
      aria-current={day.isToday ? "date" : undefined}
      data-testid="public-calendar-day"
      className={cn(
        "min-w-0 md:group-data-[view=month]/cal:min-h-28 md:group-data-[view=month]/cal:rounded-md md:group-data-[view=month]/cal:border md:group-data-[view=month]/cal:border-border md:group-data-[view=month]/cal:p-1",
        day.isToday && "md:group-data-[view=month]/cal:ring-2 md:group-data-[view=month]/cal:ring-primary",
        // An empty day shows only in the desktop grid.
        empty && "max-md:hidden group-data-[view=list]/cal:hidden",
        // A day before today shows only when asked for, in the list layouts.
        day.isEarlier &&
          "group-data-[earlier=hide]/cal:max-md:hidden group-data-[earlier=hide]/cal:group-data-[view=list]/cal:hidden",
      )}
    >
      <h3 className="text-lg font-semibold md:group-data-[view=month]/cal:text-sm md:group-data-[view=month]/cal:font-medium">
        <span className="md:group-data-[view=month]/cal:sr-only">
          {day.heading}
          {day.isToday ? " (today)" : ""}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "hidden size-7 items-center justify-center md:group-data-[view=month]/cal:inline-flex",
            day.isToday && "rounded-full bg-primary text-primary-foreground",
          )}
        >
          {day.day}
        </span>
      </h3>
      {!empty && (
        <ol className="mt-2 space-y-2 md:group-data-[view=month]/cal:mt-1 md:group-data-[view=month]/cal:space-y-1">
          {day.events.map((event, i) => (
            <li key={i}>
              <EventItem event={event} anchorRight={anchorRight} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function EventsCalendarPanel({ month }: { month: MonthModel }) {
  return (
    <div data-testid="public-calendar-panel">
      {month.legend.length > 0 && (
        <div className="mb-4">
          <p className="text-sm font-medium">Event types</p>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {month.legend.map((entry) => (
              <li key={entry.name} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn("size-3 shrink-0 rounded-full", typeColorClasses(entry.color).swatch)}
                />
                <span className="[overflow-wrap:anywhere]">{entry.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {month.eventCount === 0 && (
        <p className="mb-4 text-base text-muted-foreground">
          Nothing is on the calendar for {monthLabel(month.ref)}. Use the arrows to look at other
          months.
        </p>
      )}

      {month.noMoreThisMonth && (
        <p
          data-testid="public-calendar-no-more"
          className="mb-4 text-base text-muted-foreground group-data-[earlier=show]/cal:hidden md:group-data-[view=month]/cal:hidden"
        >
          No more events are scheduled this month.
        </p>
      )}

      <div className="flex flex-col gap-4 md:group-data-[view=month]/cal:grid md:group-data-[view=month]/cal:grid-cols-7 md:group-data-[view=month]/cal:gap-1">
        {WEEKDAY_ABBREVIATIONS.map((abbr, i) => (
          <div
            key={abbr}
            aria-hidden="true"
            title={WEEKDAY_NAMES[i]}
            className="hidden px-1 py-2 text-sm font-semibold md:group-data-[view=month]/cal:block"
          >
            {abbr}
          </div>
        ))}
        {Array.from({ length: month.leadingSpacers }, (_, i) => (
          <div key={`spacer-${i}`} aria-hidden="true" className="hidden md:group-data-[view=month]/cal:block" />
        ))}
        {month.days.map((day) => (
          <Day key={day.key} day={day} />
        ))}
      </div>
    </div>
  );
}
