// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { UpcomingEventsCard } from "./upcoming-events-card";
import type { UpcomingMemberEvent } from "@/lib/calendar";

afterEach(cleanup);

function event(over: Partial<UpcomingMemberEvent> = {}): UpcomingMemberEvent {
  return {
    id: "e1",
    seriesKey: "e1",
    title: "Choir rehearsal",
    startsAtWallClock: "2026-10-18T10:30",
    endsAtWallClock: "2026-10-18T11:30",
    location: "Fellowship Hall",
    eventType: { name: "Music", colorToken: "violet", iconKey: "Music" },
    ...over,
  };
}

describe("UpcomingEventsCard — events", () => {
  it("has the heading 'Coming up'", () => {
    render(
      <UpcomingEventsCard
        slug="alder-creek"
        state={{ kind: "events", events: [event()] }}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Coming up" }),
    ).toBeTruthy();
  });

  it("links each row to the detail route with a back-to-home hint", () => {
    render(
      <UpcomingEventsCard
        slug="alder-creek"
        state={{
          kind: "events",
          events: [event(), event({ id: "e2", seriesKey: "e2", title: "Bake sale" })],
        }}
      />,
    );
    const row = screen.getByRole("link", { name: /choir rehearsal/i });
    expect(row.getAttribute("href")).toBe(
      "/o/alder-creek/calendar/e1?from=%2Fo%2Falder-creek",
    );
    expect(
      screen.getByRole("link", { name: /bake sale/i }).getAttribute("href"),
    ).toBe("/o/alder-creek/calendar/e2?from=%2Fo%2Falder-creek");
  });

  it("shows the date and the start time from the wall-clock text, no end time", () => {
    render(
      <UpcomingEventsCard
        slug="alder-creek"
        state={{ kind: "events", events: [event()] }}
      />,
    );
    expect(screen.getByText("Sun, Oct 18 · 10:30 AM")).toBeTruthy();
    expect(screen.queryByText(/11:30/)).toBeNull();
  });

  it("shows the location only when present", () => {
    const { rerender } = render(
      <UpcomingEventsCard
        slug="alder-creek"
        state={{ kind: "events", events: [event()] }}
      />,
    );
    expect(screen.getByText("Fellowship Hall")).toBeTruthy();
    rerender(
      <UpcomingEventsCard
        slug="alder-creek"
        state={{ kind: "events", events: [event({ location: null })] }}
      />,
    );
    expect(screen.queryByText("Fellowship Hall")).toBeNull();
  });

  it("renders the type chip with its name, and a nameless glyph for a null type", () => {
    const { container, rerender } = render(
      <UpcomingEventsCard
        slug="alder-creek"
        state={{ kind: "events", events: [event()] }}
      />,
    );
    expect(screen.getByText("Music")).toBeTruthy();
    rerender(
      <UpcomingEventsCard
        slug="alder-creek"
        state={{ kind: "events", events: [event({ eventType: null })] }}
      />,
    );
    expect(screen.queryByText("Music")).toBeNull();
    expect(container.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  });

  it("has a 'See the full calendar' footer link", () => {
    render(
      <UpcomingEventsCard
        slug="alder-creek"
        state={{ kind: "events", events: [event()] }}
      />,
    );
    expect(
      screen
        .getByRole("link", { name: /see the full calendar/i })
        .getAttribute("href"),
    ).toBe("/o/alder-creek/calendar");
  });

  it("a long unbroken title keeps break-words", () => {
    const long = "W".repeat(60);
    render(
      <UpcomingEventsCard
        slug="alder-creek"
        state={{ kind: "events", events: [event({ title: long })] }}
      />,
    );
    expect(screen.getByText(long).className).toContain("break-words");
  });

  it("uses no micro text size and hides the chevron from assistive tech", () => {
    const { container } = render(
      <UpcomingEventsCard
        slug="alder-creek"
        state={{ kind: "events", events: [event()] }}
      />,
    );
    expect(container.querySelector(".text-xs")).toBeNull();
    const chevrons = container.querySelectorAll("a svg.lucide-chevron-right");
    expect(chevrons).toHaveLength(1);
    expect(chevrons[0].getAttribute("aria-hidden")).toBe("true");
  });
});

describe("UpcomingEventsCard — empty and failed", () => {
  it("empty says nothing is on the calendar and offers the calendar", () => {
    render(<UpcomingEventsCard slug="alder-creek" state={{ kind: "empty" }} />);
    expect(screen.getByText("Nothing is on the calendar right now.")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /open the calendar/i })
        .getAttribute("href"),
    ).toBe("/o/alder-creek/calendar");
  });

  it("failed says so, without claiming there are no events", () => {
    render(<UpcomingEventsCard slug="alder-creek" state={{ kind: "failed" }} />);
    expect(
      screen.getByText(
        "We can't load upcoming events right now. Try again in a moment.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/nothing is on the calendar/i)).toBeNull();
    expect(screen.getByRole("link", { name: /open the calendar/i })).toBeTruthy();
  });
});
