// @vitest-environment jsdom
/**
 * The `eventsCalendar` live slot (docs/work-log/2026-10-25-public-events-
 * calendar.md, Phase 3 T8). The reader is mocked; this proves what an
 * anonymous visitor is shown for each state, that free text is only ever text,
 * that no id can appear, and where the one outbound link goes.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { PublicCalendar, PublicCalendarEvent } from "@/lib/calendar/public-contract";
import { buildSiteUrls } from "@/lib/site-urls";

const readPublicCalendar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/public-calendar", () => ({ readPublicCalendar: (...a: unknown[]) => readPublicCalendar(...a) }));

import { PublicEventsCalendarSlot } from "./public-events-calendar-slot";

afterEach(() => {
  cleanup();
  readPublicCalendar.mockReset();
});

const PLATFORM = "https://platform.example.invalid";
const slugUrls = buildSiteUrls({ mode: "slug", slug: "alder-creek", platformOrigin: PLATFORM });
const hostUrls = buildSiteUrls({
  mode: "host",
  host: "www.church-one.invalid",
  slug: "alder-creek",
  platformOrigin: PLATFORM,
});

function ev(over: Partial<PublicCalendarEvent> & { startsAt: string; title: string }): PublicCalendarEvent {
  return {
    endsAt: null,
    dayKey: over.startsAt.slice(0, 10),
    location: null,
    description: null,
    typeName: null,
    typeColor: "neutral",
    ...over,
  };
}

function available(over: Partial<Extract<PublicCalendar, { state: "available" }>> = {}): PublicCalendar {
  return {
    state: "available",
    orgToday: "2026-11-10",
    firstMonth: { year: 2026, month: 10 },
    lastMonth: { year: 2027, month: 11 },
    truncated: false,
    memberCalendarOn: false,
    contactPhone: null,
    events: [],
    ...over,
  };
}

async function slot(filter: Record<string, unknown> = {}, urls = slugUrls) {
  const node = await PublicEventsCalendarSlot({ slug: "alder-creek", urls, filter });
  return render(node);
}

const UNAVAILABLE = "Our events calendar isn't available right now. Please check back soon.";
const EMPTY = "No events are on this calendar right now. Please check back soon.";

describe("PublicEventsCalendarSlot - states", () => {
  it("reads by the slug it was given and by nothing else", async () => {
    readPublicCalendar.mockResolvedValue({ state: "unavailable" });
    await slot();
    expect(readPublicCalendar).toHaveBeenCalledWith("alder-creek");
    expect(readPublicCalendar).toHaveBeenCalledTimes(1);
  });

  it("unavailable renders the one P1 sentence and no calendar, no prompt, no heading about events", async () => {
    readPublicCalendar.mockResolvedValue({ state: "unavailable" });
    await slot();
    expect(screen.getByText(UNAVAILABLE)).toBeTruthy();
    expect(screen.queryByTestId("public-calendar")).toBeNull();
    expect(screen.queryByText(/member sign-in/i)).toBeNull();
    expect(screen.queryByText(/no events/i)).toBeNull();
  });

  it("an available read with nothing posted says so (P2) - without a phone when the profile has none", async () => {
    readPublicCalendar.mockResolvedValue(available());
    await slot();
    expect(screen.getByTestId("public-calendar-empty").textContent).toBe(EMPTY);
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
    expect(screen.queryByText(/call us/i)).toBeNull();
    expect(screen.queryByTestId("public-calendar")).toBeNull();
  });

  it("... and adds the office phone, as plain text, only when the profile has one", async () => {
    readPublicCalendar.mockResolvedValue(available({ contactPhone: "555-0100" }));
    await slot();
    expect(screen.getByTestId("public-calendar-empty").textContent).toBe(`${EMPTY} You can also call us at 555-0100.`);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("with events: the calendar region, the island and a heading for the org's current month", async () => {
    readPublicCalendar.mockResolvedValue(available({ events: [ev({ title: "Harvest supper", startsAt: "2026-11-14T18:00" })] }));
    await slot();
    expect(screen.getByRole("region", { name: "Events calendar" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "November 2026" })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByText("Harvest supper")).toBeTruthy();
  });

  it("a month with no events says so, with the arrows hint (P3), while another month has its events", async () => {
    readPublicCalendar.mockResolvedValue(available({ events: [ev({ title: "Harvest supper", startsAt: "2026-11-14T18:00" })] }));
    await slot();
    const panels = screen.getAllByTestId("public-calendar-panel");
    expect(panels).toHaveLength(14);
    const october = panels[0]!;
    expect(october.textContent).toContain(
      "Nothing is on the calendar for October 2026. Use the arrows to look at other months.",
    );
    expect(panels[1]!.textContent).not.toContain("Nothing is on the calendar");
  });
});

describe("PublicEventsCalendarSlot - the filter", () => {
  const events = [ev({ title: "Harvest supper", startsAt: "2026-11-14T18:00" })];

  it("defaults to the month layout and honours exactly view: 'list'", async () => {
    readPublicCalendar.mockResolvedValue(available({ events }));
    const { unmount } = await slot({});
    expect(screen.getByTestId("public-calendar").getAttribute("data-view")).toBe("month");
    unmount();
    await slot({ view: "list" });
    expect(screen.getByTestId("public-calendar").getAttribute("data-view")).toBe("list");
  });

  it.each([["List"], [7], [["list"]], [{ view: "list" }], [null]])("ignores a garbled view (%j)", async (view) => {
    readPublicCalendar.mockResolvedValue(available({ events }));
    await slot({ view });
    expect(screen.getByTestId("public-calendar").getAttribute("data-view")).toBe("month");
  });
});

describe("PublicEventsCalendarSlot - free text is only text; nothing is an id", () => {
  const HOSTILE: PublicCalendarEvent[] = [
    ev({
      title: "<script>window.__pwn = 1</script>",
      startsAt: "2026-11-14T18:00",
      location: "<b>Hall</b> https://evil.example.invalid/loc",
      description: "<img src=x onerror=alert(1)> **bold** [link](https://evil.example.invalid) https://evil.example.invalid/desc",
      typeName: "<i>Pastoral</i>",
      typeColor: "violet",
    }),
  ];

  it("renders hostile strings as text: no script, img, bold, italic or link element is created from them", async () => {
    readPublicCalendar.mockResolvedValue(available({ events: HOSTILE }));
    const { container } = await slot();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("i")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(screen.getByText("<script>window.__pwn = 1</script>")).toBeTruthy();
    expect(container.textContent).toContain("<b>Hall</b> https://evil.example.invalid/loc");
    expect(container.textContent).toContain("**bold** [link](https://evil.example.invalid)");
    expect((globalThis as { __pwn?: number }).__pwn).toBeUndefined();
  });

  it("renders the description with whitespace-pre-line and breaks an unbroken title anywhere", async () => {
    readPublicCalendar.mockResolvedValue(
      available({
        events: [ev({ title: "x".repeat(200), startsAt: "2026-11-14T18:00", description: "Line one\nLine two" })],
      }),
    );
    const { container } = await slot();
    expect(container.querySelector(".whitespace-pre-line")!.textContent).toBe("Line one\nLine two");
    expect(container.querySelector("summary .\\[overflow-wrap\\:anywhere\\]")!.textContent).toBe("x".repeat(200));
  });

  it("the markup contains no uuid-shaped string anywhere", async () => {
    readPublicCalendar.mockResolvedValue(
      available({
        memberCalendarOn: true,
        events: [
          ev({ title: "A", startsAt: "2026-11-14T18:00", location: "Hall", description: "D", typeName: "T", typeColor: "teal" }),
          ev({ title: "B", startsAt: "2026-12-02T09:00" }),
        ],
      }),
    );
    const { container } = await slot();
    expect(container.innerHTML).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(container.innerHTML).not.toMatch(/\bid="[^"]*[0-9a-f]{8}/i);
  });
});

describe("PublicEventsCalendarSlot - the details of one event", () => {
  it("shows where, type, description and a later-day end inside a native <details>, and no body for a bare event", async () => {
    readPublicCalendar.mockResolvedValue(
      available({
        events: [
          ev({
            title: "Retreat",
            startsAt: "2026-11-14T18:00",
            endsAt: "2026-11-15T09:00",
            location: "Camp",
            typeName: "Fellowship",
            description: "Bring a blanket.",
          }),
          ev({ title: "Bare", startsAt: "2026-11-16T10:00" }),
        ],
      }),
    );
    const { container } = await slot();
    const items = screen.getAllByTestId("public-calendar-event");
    const retreat = items.find((i) => i.textContent?.includes("Retreat"))!;
    expect(retreat.tagName).toBe("DETAILS");
    expect(within(retreat).getByText("Ends Sunday, November 15, 2026, 9:00 AM")).toBeTruthy();
    expect(within(retreat).getByText("Camp")).toBeTruthy();
    expect(retreat.textContent).toContain("Where: Camp");
    expect(retreat.textContent).toContain("Event type: Fellowship");
    expect(retreat.textContent).toContain("Bring a blanket.");
    // A multi-day event sits on its START day only, with the start time alone in the summary.
    expect(retreat.querySelector("summary")!.textContent).toContain("6:00 PM");
    expect(retreat.querySelector("summary")!.textContent).not.toContain("9:00 AM");

    const bare = items.find((i) => i.textContent?.includes("Bare"))!;
    expect(bare.tagName).toBe("DIV");
    expect(bare.querySelector("summary")).toBeNull();
    // No summary carries a display override (it broke <details> on iOS).
    for (const summary of container.querySelectorAll("summary")) {
      expect(summary.className).not.toMatch(/(^|\s)(flex|grid|block|inline|inline-flex|inline-block|hidden)(\s|$)/);
    }
  });

  it("a legend names every type present that month, so colour is never the only signal", async () => {
    readPublicCalendar.mockResolvedValue(
      available({
        events: [
          ev({ title: "A", startsAt: "2026-11-14T18:00", typeName: "Worship", typeColor: "teal" }),
          ev({ title: "B", startsAt: "2026-11-15T18:00", typeName: "Study", typeColor: "sky" }),
        ],
      }),
    );
    await slot();
    const nov = screen.getAllByTestId("public-calendar-panel")[1]!;
    const legend = within(nov).getByText("Event types").parentElement!;
    expect(within(legend).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Study", "Worship"]);
  });
});

describe("PublicEventsCalendarSlot - the member prompt", () => {
  const events = [ev({ title: "Harvest supper", startsAt: "2026-11-14T18:00" })];
  const PROMPT = "Church members: sign in to see the member calendar, which can include events not shown here.";

  it("shows only when the member calendar is on, hedged ('can include'), never 'all events'", async () => {
    readPublicCalendar.mockResolvedValue(available({ events, memberCalendarOn: false }));
    const { unmount } = await slot();
    expect(screen.queryByText(PROMPT)).toBeNull();
    expect(screen.queryByRole("link", { name: "Member sign-in" })).toBeNull();
    unmount();

    readPublicCalendar.mockResolvedValue(available({ events, memberCalendarOn: true }));
    await slot();
    expect(screen.getByText(PROMPT)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/all events|every event/i);
  });

  it("its href is urls.portalCalendar() EXACTLY on the platform host, with no callbackUrl or query, in slug mode and in host mode", async () => {
    readPublicCalendar.mockResolvedValue(available({ events, memberCalendarOn: true }));
    const { unmount } = await slot({}, slugUrls);
    let link = screen.getByRole("link", { name: "Member sign-in" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(slugUrls.portalCalendar());
    expect(link.getAttribute("href")).toBe(`${PLATFORM}/o/alder-creek/calendar`);
    unmount();

    await slot({}, hostUrls);
    link = screen.getByRole("link", { name: "Member sign-in" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(`${PLATFORM}/o/alder-creek/calendar`);
    expect(link.getAttribute("href")).not.toMatch(/[?#]|callback/i);
    expect(link.getAttribute("href")).not.toContain("church-one");
  });

  it("is also offered when nothing is posted yet, if the member calendar is on", async () => {
    readPublicCalendar.mockResolvedValue(available({ events: [], memberCalendarOn: true }));
    await slot();
    expect(screen.getByTestId("public-calendar-empty")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Member sign-in" })).toBeTruthy();
  });

  it("is the ONLY link on the whole calendar", async () => {
    readPublicCalendar.mockResolvedValue(
      available({ memberCalendarOn: true, events: [ev({ title: "A", startsAt: "2026-11-14T18:00", location: "https://x.example.invalid" })] }),
    );
    await slot();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
