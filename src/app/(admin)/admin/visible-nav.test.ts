/**
 * `visibleAdminNav` — the one place the session's features and the nav
 * registry meet. Pins E1 and E2: a support operator (door + tickets +
 * feedback) sees Dashboard, Tickets, Feedback and Design system; a door-only
 * viewer sees Dashboard and Design system; a full admin sees everything; an
 * undefined feature list degrades to door-level only; empty groups vanish.
 */
import { describe, expect, it } from "vitest";
import { FEATURES } from "@/lib/permissions";
import { ADMIN_NAV_GROUPS } from "@/lib/admin-portal/nav";
import { visibleAdminNav } from "./visible-nav";

const labels = (features: string[] | undefined) =>
  visibleAdminNav(features).flatMap((g) => g.items.map((i) => i.label));

describe("visibleAdminNav", () => {
  it("shows a support operator Dashboard, Tickets, Feedback and Design system only (E1)", () => {
    expect(
      labels([FEATURES.ADMIN_DASHBOARD, FEATURES.ADMIN_TICKETS, FEATURES.ADMIN_FEEDBACK]),
    ).toEqual(["Dashboard", "Tickets", "Feedback", "Design system"]);
  });

  it("shows a door-only viewer Dashboard and Design system (E2)", () => {
    expect(labels([FEATURES.ADMIN_DASHBOARD])).toEqual([
      "Dashboard",
      "Design system",
    ]);
  });

  it("degrades an undefined feature list to the door-level items", () => {
    expect(labels(undefined)).toEqual(["Dashboard", "Design system"]);
  });

  it("shows a full admin every registry item", () => {
    const all = ADMIN_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.label));
    expect(labels(Object.values(FEATURES))).toEqual(all);
  });

  it("omits a group with no visible item", () => {
    const groups = visibleAdminNav([FEATURES.ADMIN_DASHBOARD]);
    expect(groups.map((g) => g.key)).toEqual(["home", "reference"]);
  });

  it("groups all four organization tools under the one organizations key", () => {
    const org = visibleAdminNav([FEATURES.ADMIN_ORGANIZATIONS]).find(
      (g) => g.key === "organizations",
    );
    expect(org?.items.map((i) => i.label)).toEqual([
      "Organizations",
      "Domains",
      "Sites",
      "Giving health",
    ]);
  });

  it("does not mutate the registry", () => {
    const before = JSON.stringify(ADMIN_NAV_GROUPS);
    visibleAdminNav([FEATURES.ADMIN_DASHBOARD]);
    expect(JSON.stringify(ADMIN_NAV_GROUPS)).toBe(before);
  });
});
