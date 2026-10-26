/**
 * The typical-case size ceiling for the public events calendar (docs/work-log/
 * 2026-10-25-public-events-calendar.md, Phase 3 amendment 1, Ruling 3 / Phase 4
 * addition A). The page pre-renders all 14 month panels, so its weight is almost
 * all per-day markup: this fails if someone doubles the cost of a day (a new
 * wrapper, a longer class string). The ceiling is the measured HTML-only length
 * for a 2-event window rounded up by 25% to the next 10 KB. The 400-event maximum
 * is deliberately not asserted.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import type { PublicCalendar, PublicCalendarEvent } from "@/lib/calendar/public-contract";
import { buildSiteUrls } from "@/lib/site-urls";

const readPublicCalendar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/public-calendar", () => ({ readPublicCalendar: (...a: unknown[]) => readPublicCalendar(...a) }));

import { PublicEventsCalendarSlot } from "./public-events-calendar-slot";

// Measured 321,865 bytes of HTML (renderToString, no flight data) on 2026-10-25;
// x1.25 = 402,331, rounded up to the next 10 KB.
const CEILING_BYTES = 410_000;

function ev(title: string, startsAt: string): PublicCalendarEvent {
  return {
    title,
    startsAt,
    endsAt: null,
    dayKey: startsAt.slice(0, 10),
    location: "Fellowship hall",
    description: "Bring a dish to share.",
    typeName: "Worship",
    typeColor: "teal",
  };
}

describe("PublicEventsCalendarSlot - page weight", () => {
  it("renders a 2-event, 14-month window under the HTML ceiling - per-day markup cost; see Phase 3 amendment 1, Ruling 3", async () => {
    const calendar: PublicCalendar = {
      state: "available",
      orgToday: "2026-11-10",
      firstMonth: { year: 2026, month: 10 },
      lastMonth: { year: 2027, month: 11 },
      truncated: false,
      memberCalendarOn: false,
      contactPhone: null,
      events: [ev("Harvest supper", "2026-11-14T18:00"), ev("Advent lessons", "2026-12-06T16:00")],
    };
    readPublicCalendar.mockResolvedValue(calendar);
    const urls = buildSiteUrls({ mode: "slug", slug: "alder-creek", platformOrigin: "https://platform.example.invalid" });
    const node = await PublicEventsCalendarSlot({ slug: "alder-creek", urls, filter: {} });
    const bytes = Buffer.byteLength(renderToString(node), "utf8");
    expect(bytes).toBeLessThan(CEILING_BYTES);
  });
});
