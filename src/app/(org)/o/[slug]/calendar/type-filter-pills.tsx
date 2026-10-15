import Link from "next/link";
import { Check } from "lucide-react";
import { EventTypeIcon } from "@/components/org-portal/event-types/event-type-icon";
import {
  buildCalendarHref,
  toggleTypeSelection,
  type CalendarView,
} from "@/lib/calendar/filters";
import type { MonthRef } from "@/lib/calendar/month";
import type { MemberEventType } from "@/lib/calendar";
import { typeColorClasses } from "@/lib/events/type-palette";
import { cn } from "@/lib/utils";

const PILL_BASE =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * The event-type filter: plain links, so they work before hydration and need
 * no JavaScript. "All" first, then one pill per ACTIVE type (the default type
 * last). Selected is `aria-current` plus a check icon plus a heavier border -
 * never colour alone. Rendered twice on the page (once inside the phone
 * disclosure, once inline at md+); CSS hides one copy with `display:none`, so
 * assistive technology reads exactly one.
 */
export function TypeFilterPills({
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
  const allIds = types.map((t) => t.id);
  const allSelected = activeTypeIds.length === 0;

  return (
    <nav aria-label="Filter by event type">
      <ul className="flex flex-wrap gap-2">
        <li>
          <Link
            href={buildCalendarHref(slug, { month, types: [], view })}
            aria-current={allSelected ? "true" : undefined}
            className={cn(
              PILL_BASE,
              "border-input bg-background text-foreground hover:bg-accent",
              allSelected && "border-2 border-foreground font-semibold",
            )}
          >
            {allSelected && <Check className="size-4 shrink-0" aria-hidden />}
            All
          </Link>
        </li>
        {types.map((type) => {
          const selected = activeTypeIds.includes(type.id);
          const classes = typeColorClasses(type.colorToken);
          return (
            <li key={type.id}>
              <Link
                href={buildCalendarHref(slug, {
                  month,
                  types: toggleTypeSelection(activeTypeIds, type.id, allIds),
                  view,
                })}
                aria-current={selected ? "true" : undefined}
                className={cn(
                  PILL_BASE,
                  classes.chip,
                  classes.border,
                  selected && "border-2 font-semibold",
                )}
              >
                {selected && <Check className="size-4 shrink-0" aria-hidden />}
                <EventTypeIcon iconKey={type.iconKey} />
                {type.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
