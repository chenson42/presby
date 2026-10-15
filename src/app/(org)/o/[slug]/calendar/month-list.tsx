import { CalendarEntryLink } from "./calendar-entry";
import { groupEntriesByDay } from "./month-grid";
import type { CalendarEntry } from "@/lib/calendar";
import type { CalendarView } from "@/lib/calendar/filters";
import { formatDayHeading, isSameMonth, monthOfDayKey, type MonthRef } from "@/lib/calendar/month";
import { cn } from "@/lib/utils";

/**
 * The month as a day-by-day list: only in-month days that have entries. The
 * phone layout (below md), and the whole page at md+ when `?view=list`.
 */
export function MonthListView({
  slug,
  month,
  entries,
  todayKey,
  view,
  fromHref,
}: {
  slug: string;
  month: MonthRef;
  entries: readonly CalendarEntry[];
  todayKey: string;
  view: CalendarView;
  fromHref: string;
}) {
  const byDay = groupEntriesByDay(entries);
  const days = [...byDay.keys()]
    .filter((key) => isSameMonth(monthOfDayKey(key), month))
    .sort();

  return (
    <div data-testid="calendar-list" className={cn(view === "list" ? "block" : "md:hidden")}>
      <div className="space-y-6">
        {days.map((key) => (
          <section key={key} aria-labelledby={`day-${key}`}>
            <h3 id={`day-${key}`} className="text-lg font-semibold">
              {formatDayHeading(key)}
              {key === todayKey ? " (today)" : ""}
            </h3>
            <ol className="mt-2 space-y-2">
              {(byDay.get(key) ?? []).map((entry) => (
                <li key={entry.id}>
                  <CalendarEntryLink slug={slug} entry={entry} fromHref={fromHref} variant="list" />
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
