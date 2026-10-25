// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SeriesWebsiteSummary } from "@/lib/events";

const mockAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  setSeriesWebsiteListingAction: (...args: unknown[]) => mockAction(...args),
}));

const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { SeriesWebsiteListing } from "./series-website-listing";

afterEach(() => {
  cleanup();
  mockAction.mockReset();
  mockRefresh.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

function summary(over: Partial<SeriesWebsiteSummary> = {}): SeriesWebsiteSummary {
  return {
    fromStartsAt: "2026-10-04T10:00",
    put: { changes: 4, skippedCancelled: 0, skippedMembersOnly: 0 },
    take: { changes: 0 },
    inheritsOnExtend: false,
    ...over,
  };
}

const PUT = "Put this and later events on the website";
const TAKE = "Take this and later events off the website";

function mount(s: SeriesWebsiteSummary) {
  return render(<SeriesWebsiteListing slug="alder-creek" eventId="event-1" summary={s} />);
}

describe("SeriesWebsiteListing - the buttons follow the counts", () => {
  it("shows the heading and the intro, and only the button that would change something", () => {
    mount(summary());
    expect(screen.getByRole("heading", { name: "Website listing" })).toBeTruthy();
    expect(
      screen.getByText(
        "Change this event and all the events after it in this series at once. To change only this event, use Edit event.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: PUT })).toBeTruthy();
    expect(screen.queryByRole("button", { name: TAKE })).toBeNull();
    expect(screen.queryByText("No later events in this series can be changed.")).toBeNull();
  });

  it("shows the take button alone when nothing can be put", () => {
    mount(summary({ put: { changes: 0, skippedCancelled: 0, skippedMembersOnly: 0 }, take: { changes: 2 } }));
    expect(screen.queryByRole("button", { name: PUT })).toBeNull();
    expect(screen.getByRole("button", { name: TAKE })).toBeTruthy();
  });

  it("shows both when both would change something", () => {
    mount(summary({ take: { changes: 1 } }));
    expect(screen.getByRole("button", { name: PUT })).toBeTruthy();
    expect(screen.getByRole("button", { name: TAKE })).toBeTruthy();
  });

  it("says so when neither would change anything", () => {
    mount(summary({ put: { changes: 0, skippedCancelled: 1, skippedMembersOnly: 0 }, take: { changes: 0 } }));
    expect(screen.queryByRole("button", { name: PUT })).toBeNull();
    expect(screen.queryByRole("button", { name: TAKE })).toBeNull();
    expect(screen.getByText("No later events in this series can be changed.")).toBeTruthy();
  });
});

describe("SeriesWebsiteListing - the put dialog", () => {
  it("states the count, the date, the public exposure and the left-out events, singular and plural", () => {
    mount(summary({ put: { changes: 31, skippedCancelled: 2, skippedMembersOnly: 1 } }));
    fireEvent.click(screen.getByRole("button", { name: PUT }));
    expect(screen.getByText("Put 31 events on the website?")).toBeTruthy();
    expect(
      screen.getByText(
        "From Sunday, October 4, 2026 on, 31 events are marked to appear on your public website's calendar. Anyone on the internet can read their titles, descriptions, locations and event types. 2 cancelled events and 1 members-only event are left out.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yes, put 31 on the website" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep as it is" })).toBeTruthy();
  });

  it("uses the singular for one event and omits a left-out clause for a zero count", () => {
    mount(summary({ put: { changes: 1, skippedCancelled: 0, skippedMembersOnly: 0 } }));
    fireEvent.click(screen.getByRole("button", { name: PUT }));
    expect(screen.getByText("Put 1 event on the website?")).toBeTruthy();
    const body = screen.getByText(/^From Sunday, October 4, 2026 on, 1 event is marked/);
    expect(body.textContent).not.toMatch(/left out/);
  });

  it("names only the clause that applies, with 'is' for exactly one left out", () => {
    mount(summary({ put: { changes: 3, skippedCancelled: 1, skippedMembersOnly: 0 } }));
    fireEvent.click(screen.getByRole("button", { name: PUT }));
    const body = screen.getByText(/^From Sunday, October 4, 2026 on, 3 events are marked/);
    expect(body.textContent).toMatch(/ 1 cancelled event is left out\.$/);
  });

  it("calls the action with { eventId, listed: true } and toasts the RETURNED counts, not the confirmation's", async () => {
    mockAction.mockResolvedValueOnce({
      ok: true,
      data: { changed: 3, unchanged: 0, skippedCancelled: 1, skippedMembersOnly: 1 },
    });
    mount(summary({ put: { changes: 4, skippedCancelled: 0, skippedMembersOnly: 0 } }));
    fireEvent.click(screen.getByRole("button", { name: PUT }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, put 4 on the website" }));
    });
    expect(mockAction).toHaveBeenCalledWith("alder-creek", { eventId: "event-1", listed: true });
    expect(toastSuccess).toHaveBeenCalledWith("3 events put on the website. 2 left out.");
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("toasts 'Nothing needed to change.' when the action changed nothing", async () => {
    mockAction.mockResolvedValueOnce({
      ok: true,
      data: { changed: 0, unchanged: 4, skippedCancelled: 0, skippedMembersOnly: 0 },
    });
    mount(summary());
    fireEvent.click(screen.getByRole("button", { name: PUT }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, put 4 on the website" }));
    });
    expect(toastSuccess).toHaveBeenCalledWith("Nothing needed to change.");
  });
});

describe("SeriesWebsiteListing - the take dialog", () => {
  it("states the count, the date and that copies may already exist", () => {
    mount(summary({ put: { changes: 0, skippedCancelled: 0, skippedMembersOnly: 0 }, take: { changes: 5 } }));
    fireEvent.click(screen.getByRole("button", { name: TAKE }));
    expect(screen.getByText("Take 5 events off the website?")).toBeTruthy();
    expect(
      screen.getByText(
        "From Sunday, October 4, 2026 on, 5 events will no longer appear on your public website. Search engines and web archives may already hold copies.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Yes, take 5 off the website" })).toBeTruthy();
  });

  it("calls the action with listed: false and toasts the returned count", async () => {
    mockAction.mockResolvedValueOnce({
      ok: true,
      data: { changed: 1, unchanged: 0, skippedCancelled: 0, skippedMembersOnly: 0 },
    });
    mount(summary({ put: { changes: 0, skippedCancelled: 0, skippedMembersOnly: 0 }, take: { changes: 5 } }));
    fireEvent.click(screen.getByRole("button", { name: TAKE }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, take 5 off the website" }));
    });
    expect(mockAction).toHaveBeenCalledWith("alder-creek", { eventId: "event-1", listed: false });
    expect(toastSuccess).toHaveBeenCalledWith("1 event taken off the website.");
  });
});

describe("SeriesWebsiteListing - failure", () => {
  it("surfaces the action's own error", async () => {
    mockAction.mockResolvedValueOnce({ ok: false, error: "You don't have permission to manage events here." });
    mount(summary());
    fireEvent.click(screen.getByRole("button", { name: PUT }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, put 4 on the website" }));
    });
    expect(toastError).toHaveBeenCalledWith("You don't have permission to manage events here.");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("falls back to a plain message when the action throws", async () => {
    mockAction.mockRejectedValueOnce(new Error("boom"));
    mount(summary());
    fireEvent.click(screen.getByRole("button", { name: PUT }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, put 4 on the website" }));
    });
    expect(toastError).toHaveBeenCalledWith("We couldn't save that change. Try again.");
  });
});
