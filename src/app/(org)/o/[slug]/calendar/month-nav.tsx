import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buildCalendarHref, type CalendarView } from "@/lib/calendar/filters";
import { monthLabel, nextMonth, prevMonth, type MonthRef } from "@/lib/calendar/month";
import { cn } from "@/lib/utils";

const CONTROL_CLASSES =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * The month heading with previous / next. Every link carries the current
 * `types` and `view` (a filter must survive paging); only the Today control,
 * in the action bar, drops `month`. At the 2000-01 and 2100-12 edges the
 * control is an `aria-disabled` span rather than a link to nowhere.
 *
 * The heading stays in print; the paging controls do not.
 */
export function MonthNav({
  slug,
  month,
  types,
  view,
}: {
  slug: string;
  month: MonthRef;
  types: readonly string[];
  view: CalendarView;
}) {
  const prev = prevMonth(month);
  const next = nextMonth(month);

  return (
    <nav aria-label="Month" className="flex items-center justify-between gap-3">
      {prev ? (
        <Link
          href={buildCalendarHref(slug, { month: prev, types, view })}
          aria-label={`Previous month, ${monthLabel(prev)}`}
          className={cn(CONTROL_CLASSES, "print:hidden")}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </Link>
      ) : (
        <span
          aria-disabled="true"
          aria-label="Previous month, not available"
          className={cn(CONTROL_CLASSES, "cursor-not-allowed opacity-50 hover:bg-background print:hidden")}
        >
          <ChevronLeft className="size-5" aria-hidden />
        </span>
      )}

      <h2 className="text-center text-xl font-semibold">{monthLabel(month)}</h2>

      {next ? (
        <Link
          href={buildCalendarHref(slug, { month: next, types, view })}
          aria-label={`Next month, ${monthLabel(next)}`}
          className={cn(CONTROL_CLASSES, "print:hidden")}
        >
          <ChevronRight className="size-5" aria-hidden />
        </Link>
      ) : (
        <span
          aria-disabled="true"
          aria-label="Next month, not available"
          className={cn(CONTROL_CLASSES, "cursor-not-allowed opacity-50 hover:bg-background print:hidden")}
        >
          <ChevronRight className="size-5" aria-hidden />
        </span>
      )}
    </nav>
  );
}
