import type {
  MemberEventsResult,
  UpcomingMemberEvent,
} from "@/lib/calendar";
import type { PortalHomeHousehold } from "@/lib/org-portal/home-data";
import type { ViewerGroup } from "@/lib/org-portal/my-groups";

/**
 * Which cards the portal home's main row renders, and in how many columns —
 * a PURE function of the loader results (docs/work-log/
 * 2026-10-14-portal-home-alignment.md, B.3), unit-tested the way
 * `computeDestination` is. Presence is known on the server, so a lone card
 * takes the full width with no client measurement (R5).
 *
 * No `server-only`, no React, type-only imports: this file is importable from a
 * jsdom test and from a Server Component alike.
 *
 * It does NOT re-apply household suppression ("fewer than two eligible
 * people is not shown"): that rule lives only in `getPortalHomeData`, so there
 * is exactly one copy (D2). It does not re-slice events either: the list
 * function clamps its own limit.
 */

/** How many upcoming events the card lists. One definition, tuned in the
 * browser, changed only here. */
export const UPCOMING_EVENTS_LIMIT = 4;

/** The outcome of one widget read under `loadWidget`. */
export type Loaded<T> = { ok: true; value: T } | { ok: false };

export type UpcomingCardState =
  | { kind: "events"; events: UpcomingMemberEvent[] }
  | { kind: "empty" }
  | { kind: "failed" };

export interface MainRowInput {
  household: PortalHomeHousehold | null;
  /** `[]` when the groups read failed: absence makes no claim. */
  groups: ViewerGroup[];
  events: Loaded<MemberEventsResult<UpcomingMemberEvent[]>>;
}

export interface MainRowPlan {
  layout: "none" | "single" | "double";
  yours: { household: PortalHomeHousehold | null; groups: ViewerGroup[] } | null;
  upcoming: UpcomingCardState | null;
}

function upcomingFor(events: MainRowInput["events"]): UpcomingCardState | null {
  if (!events.ok) return { kind: "failed" };
  const result = events.value;
  switch (result.kind) {
    case "disabled":
    case "forbidden":
      // Absence, never a message: a member can do nothing about a missing grant.
      return null;
    case "ok":
      return result.data.length === 0
        ? { kind: "empty" }
        : { kind: "events", events: result.data };
  }
}

export function composeMainRow(input: MainRowInput): MainRowPlan {
  const yours =
    input.household !== null || input.groups.length > 0
      ? { household: input.household, groups: input.groups }
      : null;
  const upcoming = upcomingFor(input.events);
  const count = (yours ? 1 : 0) + (upcoming ? 1 : 0);
  const layout = count === 0 ? "none" : count === 1 ? "single" : "double";
  return { layout, yours, upcoming };
}
