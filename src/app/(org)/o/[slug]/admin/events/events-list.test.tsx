// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EventsList } from "./events-list";
import type { EventListEntry } from "@/lib/events";

afterEach(cleanup);

function entry(overrides: Partial<EventListEntry> = {}): EventListEntry {
  return {
    eventId: "event-1",
    title: "Session meeting",
    startsAt: "2027-03-01T19:00:00",
    endsAt: null,
    isPublic: true,
    allowsCheckin: false,
    cancelledAt: null,
    isRecurringSeries: false,
    isSeriesOccurrence: false,
    ...overrides,
  };
}

describe("EventsList — empty state", () => {
  it("renders the empty-state card when there are zero entries, no table", () => {
    render(<EventsList slug="alder-creek" entries={[]} />);
    expect(screen.getByText(/no events yet/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("EventsList — populated", () => {
  it("renders a table row per entry, each linking to its own detail page", () => {
    render(
      <EventsList
        slug="alder-creek"
        entries={[entry({ eventId: "event-1", title: "Session meeting" })]}
      />,
    );
    expect(screen.getByRole("table")).toBeTruthy();
    const link = screen.getByRole("link", { name: /session meeting/i });
    expect(link.getAttribute("href")).toBe("/o/alder-creek/admin/events/event-1");
  });

  it("marks a cancelled event with the Cancelled badge, not a Scheduled label", () => {
    render(
      <EventsList
        slug="alder-creek"
        entries={[entry({ cancelledAt: "2027-02-01T00:00:00.000Z" })]}
      />,
    );
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.queryByText("Scheduled")).toBeNull();
  });

  it("shows Scheduled for a non-cancelled event", () => {
    render(<EventsList slug="alder-creek" entries={[entry()]} />);
    expect(screen.getByText("Scheduled")).toBeTruthy();
    expect(screen.queryByText("Cancelled")).toBeNull();
  });

  it("marks a series parent AND a series occurrence with a 'Series' badge", () => {
    render(
      <EventsList
        slug="alder-creek"
        entries={[
          entry({ eventId: "parent-1", title: "Choir practice", isRecurringSeries: true }),
          entry({ eventId: "child-1", title: "Choir practice (2)", isSeriesOccurrence: true }),
        ]}
      />,
    );
    expect(screen.getAllByText("Series")).toHaveLength(2);
  });

  it("does not mark a standalone event with a 'Series' badge", () => {
    render(<EventsList slug="alder-creek" entries={[entry()]} />);
    expect(screen.queryByText("Series")).toBeNull();
  });

  it("renders visibility text on the sm+ column", () => {
    render(
      <EventsList
        slug="alder-creek"
        entries={[
          entry({ eventId: "e1", title: "Public event", isPublic: true }),
          entry({ eventId: "e2", title: "Private event", isPublic: false }),
        ]}
      />,
    );
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByText("Members only")).toBeTruthy();
  });
});
