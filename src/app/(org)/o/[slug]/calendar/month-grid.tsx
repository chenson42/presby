import type { ReactNode } from "react";
import { CalendarEntryLink } from "./calendar-entry";
import type { CalendarEntry } from "@/lib/calendar";
import type { CalendarView } from "@/lib/calendar/filters";
import {
  WEEKDAY_ABBREVIATIONS,
  WEEKDAY_NAMES,
  formatLongDate,
  groupByDay,
  monthLabel,
  type MonthGrid,
  type MonthRef,
} from "@/lib/calendar/month";
import { cn } from "@/lib/utils";

/** Entries grouped by their start day, in the order they arrived (starts_at, id). */
export function groupEntriesByDay(entries: readonly CalendarEntry[]): Map<string, CalendarEntry[]> {
  return groupByDay(entries);
}

function GridTable({ children }: { children: ReactNode }) {
  return (
    // ui-ok: the month grid needs fixed seven-column cells; the Table primitive wraps its table in an overflow-x-auto box
    <table className="w-full table-fixed border-collapse">{children}</table>
  );
}

/**
 * The month as a real `<table>` (md and up). A busy day scrolls inside its own
 * cell - there is no "+N more" that would hide an event from a member - and
 * prints in full. Adjacent-month cells show their entries on a muted
 * background. Entries sit on their START day only.
 */
export function MonthGridView({
  slug,
  month,
  grid,
  entries,
  todayKey,
  view,
  fromHref,
}: {
  slug: string;
  month: MonthRef;
  grid: MonthGrid;
  entries: readonly CalendarEntry[];
  todayKey: string;
  view: CalendarView;
  fromHref: string;
}) {
  const byDay = groupEntriesByDay(entries);

  return (
    <div
      data-testid="calendar-grid"
      className={cn(view === "list" ? "hidden" : "hidden md:block")}
    >
      <GridTable>
        <caption className="sr-only">{monthLabel(month)}</caption>
        <thead>
          <tr>
            {WEEKDAY_ABBREVIATIONS.map((abbr, i) => (
              <th
                key={abbr}
                scope="col"
                className="border border-border bg-muted px-2 py-2 text-left text-sm font-semibold"
              >
                <abbr title={WEEKDAY_NAMES[i]} className="no-underline">
                  {abbr}
                </abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.weeks.map((week) => (
            <tr key={week[0].key}>
              {week.map((day) => {
                const isToday = day.key === todayKey;
                const dayEntries = byDay.get(day.key) ?? [];
                return (
                  <td
                    key={day.key}
                    className={cn(
                      "h-28 border border-border p-1 align-top",
                      !day.inMonth && "bg-muted text-muted-foreground",
                    )}
                  >
                    <time
                      dateTime={day.key}
                      aria-current={isToday ? "date" : undefined}
                      className="mb-1 flex"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "inline-flex size-7 items-center justify-center text-sm font-medium",
                          isToday && "rounded-full bg-primary text-primary-foreground",
                        )}
                      >
                        {day.day}
                      </span>
                      <span className="sr-only">
                        {formatLongDate(day.key)}
                        {isToday ? ", Today" : ""}
                      </span>
                    </time>
                    {dayEntries.length > 0 && (
                      <div className="max-h-72 min-h-16 space-y-1 overflow-y-auto print:max-h-none print:overflow-visible">
                        {dayEntries.map((entry) => (
                          <CalendarEntryLink
                            key={entry.id}
                            slug={slug}
                            entry={entry}
                            fromHref={fromHref}
                            variant="grid"
                          />
                        ))}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </GridTable>
    </div>
  );
}
