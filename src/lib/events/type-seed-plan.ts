/**
 * The standard event-type set an organization is provisioned with
 * (DECISION-161, R4; placement amendment A1 / DECISION-165).
 *
 * PURE: no database, no `server-only`. Read by three callers that must agree:
 *   - `createOrganization()` in src/lib/org-provisioning.ts, which imports and
 *     RE-EXPORTS `eventTypeSeedPlan` so the DECISION-100 adjacency with
 *     `groupSeedPlan` still holds;
 *   - the types manager's "Add the standard event types" action
 *     (src/lib/event-types.ts), which must not import the platform connection;
 *   - drizzle/0054_presby_calendar_event_types.sql section 8, the backfill for
 *     organizations that existed before this file. That SQL `VALUES` list is a
 *     second copy; src/lib/events/type-palette.test.ts pins it to the array
 *     below, and src/lib/event-types.test.ts re-executes it per org type.
 *
 * Congregations and new worshiping communities get all nine (five active,
 * including the neutral "General" fallback). Presbytery, synod and
 * general_assembly get the fallback ONLY: nobody there holds
 * `event_types.manage` to remove congregation-flavoured active types.
 */
import type { OrganizationType } from "@/lib/authz";
import type { EventTypeColor, EventTypeIcon } from "./type-palette";

export interface EventTypeSeed {
  readonly name: string;
  readonly color: EventTypeColor;
  readonly icon: EventTypeIcon;
  readonly sortOrder: number;
  readonly isActive: boolean;
  readonly isFallback: boolean;
}

/** The type an untyped event renders and filters as. Always neutral and active. */
export const FALLBACK_EVENT_TYPE: EventTypeSeed = Object.freeze({
  name: "General",
  color: "neutral",
  icon: "CalendarDays",
  sortOrder: 99,
  isActive: true,
  isFallback: true,
});

/** Every one of the eight categorical colours exactly once, then the fallback. */
export const STANDARD_EVENT_TYPES: readonly EventTypeSeed[] = Object.freeze([
  { name: "Worship", color: "teal", icon: "Church", sortOrder: 10, isActive: true, isFallback: false },
  { name: "Special Services and Holidays", color: "violet", icon: "Sparkles", sortOrder: 20, isActive: false, isFallback: false },
  { name: "Music", color: "fuchsia", icon: "Music", sortOrder: 30, isActive: false, isFallback: false },
  { name: "Classes and Bible Study", color: "sky", icon: "BookOpen", sortOrder: 40, isActive: true, isFallback: false },
  { name: "Youth and Children", color: "lime", icon: "Backpack", sortOrder: 50, isActive: true, isFallback: false },
  { name: "Meals and Fellowship", color: "amber", icon: "Utensils", sortOrder: 60, isActive: false, isFallback: false },
  { name: "Mission and Outreach", color: "rose", icon: "HeartHandshake", sortOrder: 70, isActive: false, isFallback: false },
  { name: "Committees", color: "orange", icon: "Gavel", sortOrder: 80, isActive: true, isFallback: false },
  FALLBACK_EVENT_TYPE,
] satisfies EventTypeSeed[]);

const FALLBACK_ONLY: readonly EventTypeSeed[] = Object.freeze([FALLBACK_EVENT_TYPE]);

/**
 * congregation | new_worshiping_community -> STANDARD_EVENT_TYPES;
 * presbytery | synod | general_assembly -> [FALLBACK_EVENT_TYPE].
 */
export function eventTypeSeedPlan(
  organizationType: OrganizationType,
): readonly EventTypeSeed[] {
  switch (organizationType) {
    case "congregation":
    case "new_worshiping_community":
      return STANDARD_EVENT_TYPES;
    case "presbytery":
    case "synod":
    case "general_assembly":
      return FALLBACK_ONLY;
  }
}
