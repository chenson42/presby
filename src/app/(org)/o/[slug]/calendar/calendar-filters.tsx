import { ChevronDown } from "lucide-react";
import { TypeFilterPills } from "./type-filter-pills";
import type { MemberEventType } from "@/lib/calendar";
import type { CalendarView } from "@/lib/calendar/filters";
import type { MonthRef } from "@/lib/calendar/month";

/**
 * The filter row, rendered TWICE: inside a native `<details>` below md and as
 * a plain block at md+. CSS cannot force a closed `<details>` open, and the
 * hidden copy is `display:none`, so assistive technology reads one.
 *
 * The `<summary>` carries NO `display` utility - `display` on a `<summary>`
 * breaks `<details>` on iOS (CLAUDE.md -> Verify in a Browser). Its layout
 * lives on an inner span. The label swap is pure CSS (`group-open:`), so the
 * toggle needs no JavaScript; the pills are links that work before hydration.
 */
export function CalendarFilters({
  slug,
  month,
  view,
  types,
  activeTypeIds,
}: {
  slug: string;
  month: MonthRef;
  view: CalendarView;
  types: readonly MemberEventType[];
  activeTypeIds: readonly string[];
}) {
  const pills = (
    <TypeFilterPills
      slug={slug}
      month={month}
      view={view}
      types={types}
      activeTypeIds={activeTypeIds}
    />
  );
  const closedLabel =
    activeTypeIds.length > 0 ? `Filters: ${activeTypeIds.length} active` : "Show filters";

  return (
    <div className="print:hidden">
      <details className="group md:hidden" data-testid="calendar-filters">
        <summary className="cursor-pointer list-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&::-webkit-details-marker]:hidden">
          <span className="flex min-h-11 items-center gap-2 text-base font-medium">
            <span className="group-open:hidden">{closedLabel}</span>
            <span className="hidden group-open:inline">Hide filters</span>
            <ChevronDown
              className="size-4 transition-transform group-open:rotate-180"
              aria-hidden
            />
          </span>
        </summary>
        <div className="pt-2">{pills}</div>
      </details>
      <div className="hidden md:block">{pills}</div>
    </div>
  );
}
