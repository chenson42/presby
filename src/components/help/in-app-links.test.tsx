// @vitest-environment jsdom
/**
 * The in-app help links (user-help Inc 1, R12, P3-9, P3-10, Copy C3): the six per-organization
 * toggle-off states each carry "How features are turned on", and every one points at a
 * published page. The `(auth)` and `access-pending` links are pinned in their own e2e
 * (help-gates.spec.ts); these are the pure-render cases.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CalendarDisabled } from "@/app/(org)/o/[slug]/calendar/calendar-states";
import { MembersFlagOff } from "@/app/(org)/o/[slug]/admin/community/members-states";
import { CareersFeatureOff } from "@/app/(org)/o/[slug]/admin/careers/careers-states";
import { GivingToggleOff } from "@/app/(org)/o/[slug]/admin/giving/giving-admin-states";
import { ParishesOff } from "@/app/(org)/o/[slug]/directory/parishes/parishes-states";
import { DomainsFeatureOff } from "@/app/(org)/o/[slug]/admin/domains/domains-states";
import { publishedPages } from "@/lib/help/select";

afterEach(cleanup);

const NAME = "Alder Creek Presbyterian Church";
const SLUG = "alder-creek";

const SIX: Array<[string, () => React.ReactElement]> = [
  ["calendar", () => <CalendarDisabled name={NAME} />],
  ["Community", () => <MembersFlagOff name={NAME} />],
  ["job openings", () => <CareersFeatureOff name={NAME} slug={SLUG} canManageFeatures={false} />],
  ["Giving", () => <GivingToggleOff name={NAME} slug={SLUG} canManageFeatures={false} />],
  ["Parish management", () => <ParishesOff name={NAME} />],
  ["Website domain", () => <DomainsFeatureOff name={NAME} />],
];

describe("the six toggle-off states link to turning-features-on-and-off", () => {
  it.each(SIX)("%s", (_label, make) => {
    render(make());
    const link = screen.getByRole("link", { name: "How features are turned on" });
    expect(link.getAttribute("href")).toBe("/help/turning-features-on-and-off");
    expect(link.getAttribute("target")).toBeNull();
  });

  it("the target is a published page", () => {
    expect(publishedPages().map((p) => p.slug)).toContain("turning-features-on-and-off");
  });
});
