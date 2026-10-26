"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shared/use-hydrated";
import type { PublicCalendarView } from "@/lib/calendar/public-contract";

/**
 * The public events calendar's ONE client island (docs/work-log/
 * 2026-10-25-public-events-calendar.md, Phase 3 "Layout"; DECISION-239/241).
 *
 * It holds the active month INDEX, the layout and the "earlier days" state, and
 * nothing else. It receives the pre-rendered month panels as `ReactNode`s (the
 * server already rendered every month) and NO event data as props, so there is
 * no payload to parse and no request to make: switching months is a state
 * change, which is why a church's own domain (where every `/api/*` path 404s)
 * works unchanged and DECISION-132's live-slot redline needs no amendment.
 *
 * IT NEVER CALLS `new Date()` OR READS A CLOCK. The month it opens on
 * (`initialIndex`) and the org's current month (`currentIndex`) were computed
 * on the server in the organization's own zone and arrive as props, so the
 * server HTML, the hydrated page and a visitor in another zone agree.
 *
 * BEFORE HYDRATION the page is already a working read-only calendar: the first
 * panel is visible, the others carry `hidden`, the layout is chosen by CSS, and
 * every control here is `disabled` (`useHydrated`) - an arrow that does nothing
 * is never presented as live. The wrapper's `data-view` / `data-earlier` and
 * the `group/cal` class are what the panels' `group-data-[...]/cal:` variants
 * key off.
 */

export interface CalendarMonthSlice {
  /** 'YYYY-MM' */
  key: string;
  /** 'November 2026' */
  label: string;
  panel: ReactNode;
}

export function EventsCalendarSwitcher({
  months,
  initialIndex,
  currentIndex,
  initialView,
  hasEarlierInCurrent,
  edgeNote,
}: {
  months: CalendarMonthSlice[];
  initialIndex: number;
  /** The org's current month, or null when the window does not hold it. */
  currentIndex: number | null;
  initialView: PublicCalendarView;
  hasEarlierInCurrent: boolean;
  /** P6: what the window covers, shown on its last month. */
  edgeNote: string;
}) {
  const hydrated = useHydrated();
  const [index, setIndex] = useState(initialIndex);
  const [view, setView] = useState<PublicCalendarView>(initialView);
  const [earlier, setEarlier] = useState<"hide" | "show">("hide");

  const last = months.length - 1;
  const active = months[index]!;
  const previous = index > 0 ? months[index - 1]! : null;
  const next = index < last ? months[index + 1]! : null;

  return (
    <div
      data-testid="public-calendar"
      data-view={view}
      data-earlier={earlier}
      className="group/cal"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div aria-live="polite">
          <h2 className="text-xl font-semibold" data-testid="public-calendar-month">
            {active.label}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 min-w-11"
            disabled={!hydrated || previous === null}
            aria-label={previous ? `Previous month, ${previous.label}` : "Previous month"}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 min-w-11"
            disabled={!hydrated || currentIndex === null || index === currentIndex}
            onClick={() => {
              if (currentIndex !== null) setIndex(currentIndex);
            }}
          >
            Today
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 min-w-11"
            disabled={!hydrated || next === null}
            aria-label={next ? `Next month, ${next.label}` : "Next month"}
            onClick={() => setIndex((i) => Math.min(last, i + 1))}
          >
            Next
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {/* The layout choice means something only where the grid can show. */}
        <div role="group" aria-label="Calendar layout" className="hidden gap-2 md:flex">
          <Button
            type="button"
            variant={view === "month" ? "default" : "outline"}
            className="min-h-11"
            aria-pressed={view === "month"}
            disabled={!hydrated}
            onClick={() => setView("month")}
          >
            Month
          </Button>
          <Button
            type="button"
            variant={view === "list" ? "default" : "outline"}
            className="min-h-11"
            aria-pressed={view === "list"}
            disabled={!hydrated}
            onClick={() => setView("list")}
          >
            List
          </Button>
        </div>

        {hasEarlierInCurrent && currentIndex !== null && index === currentIndex && (
          <div className="md:group-data-[view=month]/cal:hidden">
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              disabled={!hydrated}
              onClick={() => setEarlier((e) => (e === "hide" ? "show" : "hide"))}
            >
              {earlier === "hide" ? "Show earlier this month" : "Hide earlier this month"}
            </Button>
          </div>
        )}
      </div>

      <div className="mt-4">
        {months.map((month, i) => (
          <div key={month.key} data-month={month.key} hidden={i !== index}>
            {month.panel}
          </div>
        ))}
      </div>

      {index === last && (
        <p className="mt-4 text-sm text-muted-foreground" data-testid="public-calendar-edge-note">
          {edgeNote}
        </p>
      )}
    </div>
  );
}
