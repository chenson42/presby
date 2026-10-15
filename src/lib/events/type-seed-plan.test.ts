import { describe, expect, it } from "vitest";
import type { OrganizationType } from "@/lib/authz";
import {
  EVENT_TYPE_COLORS,
  SELECTABLE_EVENT_TYPE_COLORS,
  isEventTypeColor,
  isEventTypeIcon,
} from "./type-palette";
import {
  FALLBACK_EVENT_TYPE,
  STANDARD_EVENT_TYPES,
  eventTypeSeedPlan,
  type EventTypeSeed,
} from "./type-seed-plan";

const ALL_ORG_TYPES: OrganizationType[] = [
  "congregation",
  "new_worshiping_community",
  "presbytery",
  "synod",
  "general_assembly",
];

/** The rules drizzle/0054's constraints enforce, checked against a plan. */
function expectSatisfiesConstraints(plan: readonly EventTypeSeed[]) {
  const fallbacks = plan.filter((t) => t.isFallback);
  // event_types_one_fallback_idx (at most one) + the paper "at least one".
  expect(fallbacks).toHaveLength(1);
  // event_types_fallback_active and event_types_neutral_is_fallback.
  expect(fallbacks[0].isActive).toBe(true);
  for (const t of plan) {
    expect(t.color === "neutral", `${t.name}: neutral iff fallback`).toBe(t.isFallback);
    expect(isEventTypeColor(t.color)).toBe(true);
    expect(isEventTypeIcon(t.icon)).toBe(true);
    // event_types_name_shape.
    expect(t.name).toBe(t.name.trim());
    expect(t.name.length).toBeGreaterThanOrEqual(1);
    expect(t.name.length).toBeLessThanOrEqual(60);
    expect(Number.isInteger(t.sortOrder)).toBe(true);
  }
  // event_types_org_lower_name_idx: unique case-insensitively.
  const lower = plan.map((t) => t.name.toLowerCase());
  expect(new Set(lower).size).toBe(plan.length);
}

describe("FALLBACK_EVENT_TYPE", () => {
  it("is the neutral, active 'General' type with the calendar icon", () => {
    expect(FALLBACK_EVENT_TYPE).toEqual({
      name: "General",
      color: "neutral",
      icon: "CalendarDays",
      sortOrder: 99,
      isActive: true,
      isFallback: true,
    });
  });
});

describe("STANDARD_EVENT_TYPES", () => {
  it("satisfies every event_types constraint as a set", () => {
    expectSatisfiesConstraints(STANDARD_EVENT_TYPES);
  });

  it("is nine types, five active including the fallback, with the fallback last", () => {
    expect(STANDARD_EVENT_TYPES).toHaveLength(9);
    expect(STANDARD_EVENT_TYPES.filter((t) => t.isActive)).toHaveLength(5);
    expect(STANDARD_EVENT_TYPES.at(-1)).toBe(FALLBACK_EVENT_TYPE);
  });

  it("uses each of the eight selectable colours exactly once on the non-fallback types", () => {
    const colours = STANDARD_EVENT_TYPES.filter((t) => !t.isFallback).map((t) => t.color);
    expect(new Set(colours).size).toBe(8);
    expect([...colours].sort()).toEqual([...SELECTABLE_EVENT_TYPE_COLORS].sort());
    // and between them, with the fallback, the whole palette
    expect(STANDARD_EVENT_TYPES.map((t) => t.color).sort()).toEqual(
      [...EVENT_TYPE_COLORS].sort(),
    );
  });

  it("has no non-fallback neutral type", () => {
    expect(
      STANDARD_EVENT_TYPES.filter((t) => !t.isFallback && t.color === "neutral"),
    ).toEqual([]);
  });

  it("sorts strictly ascending, so the default order is the table's order", () => {
    const orders = STANDARD_EVENT_TYPES.map((t) => t.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("names exactly the design's standard set (Phase 3 'The standard type set')", () => {
    expect(
      STANDARD_EVENT_TYPES.map((t) => [t.sortOrder, t.name, t.color, t.icon, t.isActive]),
    ).toEqual([
      [10, "Worship", "teal", "Church", true],
      [20, "Special Services and Holidays", "violet", "Sparkles", false],
      [30, "Music", "fuchsia", "Music", false],
      [40, "Classes and Bible Study", "sky", "BookOpen", true],
      [50, "Youth and Children", "lime", "Backpack", true],
      [60, "Meals and Fellowship", "amber", "Utensils", false],
      [70, "Mission and Outreach", "rose", "HeartHandshake", false],
      [80, "Committees", "orange", "Gavel", true],
      [99, "General", "neutral", "CalendarDays", true],
    ]);
  });

  it("is frozen, so no caller can mutate the shared plan", () => {
    expect(Object.isFrozen(STANDARD_EVENT_TYPES)).toBe(true);
    expect(Object.isFrozen(FALLBACK_EVENT_TYPE)).toBe(true);
  });
});

describe("eventTypeSeedPlan", () => {
  it.each(["congregation", "new_worshiping_community"] as const)(
    "gives a %s the full standard set",
    (orgType) => {
      expect(eventTypeSeedPlan(orgType)).toBe(STANDARD_EVENT_TYPES);
    },
  );

  it.each(["presbytery", "synod", "general_assembly"] as const)(
    "gives a %s the fallback only",
    (orgType) => {
      expect(eventTypeSeedPlan(orgType)).toEqual([FALLBACK_EVENT_TYPE]);
    },
  );

  it.each(ALL_ORG_TYPES)("yields a constraint-satisfying plan for a %s", (orgType) => {
    expectSatisfiesConstraints(eventTypeSeedPlan(orgType));
  });
});
