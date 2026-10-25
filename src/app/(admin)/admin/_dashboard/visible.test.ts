import { describe, expect, it } from "vitest";
import { FEATURES } from "@/lib/permissions";
import { DASHBOARD_CARDS } from "./registry";
import { visibleDashboardZones } from "./visible";

const ids = (features: string[]) =>
  visibleDashboardZones(features).flatMap((z) => z.cards.map((c) => c.id));

describe("visibleDashboardZones", () => {
  it("a full operator sees four Organizations cards, three Support, two Access and the recent-changes card (E3)", () => {
    const zones = visibleDashboardZones(Object.values(FEATURES));
    expect(zones.map((z) => [z.zone.key, z.cards.length])).toEqual([
      ["organizations", 4],
      ["support", 3],
      ["access", 2],
      ["recent", 1],
    ]);
  });

  it("a support operator sees exactly the Support cards Tickets and Feedback (E1)", () => {
    const zones = visibleDashboardZones([
      FEATURES.ADMIN_DASHBOARD,
      FEATURES.ADMIN_TICKETS,
      FEATURES.ADMIN_FEEDBACK,
    ]);
    expect(zones.map((z) => z.zone.heading)).toEqual(["Support"]);
    expect(ids([FEATURES.ADMIN_DASHBOARD, FEATURES.ADMIN_TICKETS, FEATURES.ADMIN_FEEDBACK])).toEqual([
      "tickets",
      "feedback",
    ]);
  });

  it("a door-only or featureless viewer sees no zone (E2)", () => {
    expect(visibleDashboardZones([FEATURES.ADMIN_DASHBOARD])).toEqual([]);
    expect(visibleDashboardZones(undefined)).toEqual([]);
  });

  it("every card is gated by a real, non-door key and ids are unique", () => {
    expect(new Set(DASHBOARD_CARDS.map((c) => c.id)).size).toBe(DASHBOARD_CARDS.length);
    for (const c of DASHBOARD_CARDS) {
      expect(c.requiredFeature).not.toBe(FEATURES.ADMIN_DASHBOARD);
    }
  });
});
