// @vitest-environment jsdom
/**
 * Component test for `NewEventForm` — docs/work-log/
 * 2026-08-26-events-model.md, Phase 4 commit 2. Mirrors `groups/
 * new-group-form.test.tsx`'s style: a successful submit calls
 * `createEventAction` with the expected shape (recurrence present only when
 * "repeats" is checked, collapsed to a single pattern string) and surfaces
 * its result via toast.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockCreateEventAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  createEventAction: (...args: unknown[]) => mockCreateEventAction(...args),
}));

const mockPush = vi.hoisted(() => vi.fn());
const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { NewEventForm } from "./new-event-form";

afterEach(() => {
  cleanup();
  mockCreateEventAction.mockReset();
  mockPush.mockReset();
  mockRefresh.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("NewEventForm — a single event", () => {
  it("submits title/startsAt with no recurrence field when 'repeats' is unchecked", async () => {
    mockCreateEventAction.mockResolvedValueOnce({ ok: true, data: { eventId: "event-99" } });

    render(<NewEventForm slug="alder-creek" />);

    fireEvent.change(screen.getByLabelText(/^title/i), {
      target: { value: "Session meeting" },
    });
    fireEvent.change(screen.getByLabelText(/^starts/i), {
      target: { value: "2027-03-01T19:00" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create event/i }));
    });

    expect(mockCreateEventAction).toHaveBeenCalledWith(
      "alder-creek",
      expect.objectContaining({
        title: "Session meeting",
        startsAt: "2027-03-01T19:00",
        recurrence: undefined,
      }),
    );
    expect(toastSuccess).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/o/alder-creek/admin/events/event-99");
  });

  it("surfaces the server's error copy verbatim via toast.error on failure", async () => {
    mockCreateEventAction.mockResolvedValueOnce({
      ok: false,
      error: "Title must be 200 characters or fewer.",
    });

    render(<NewEventForm slug="alder-creek" />);
    fireEvent.change(screen.getByLabelText(/^title/i), {
      target: { value: "Session meeting" },
    });
    fireEvent.change(screen.getByLabelText(/^starts/i), {
      target: { value: "2027-03-01T19:00" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create event/i }));
    });

    expect(toastError).toHaveBeenCalledWith("Title must be 200 characters or fewer.");
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("does not reveal the repeat-pattern fields until 'repeats' is checked", () => {
    render(<NewEventForm slug="alder-creek" />);
    expect(screen.queryByLabelText(/number of occurrences/i)).toBeNull();

    fireEvent.click(screen.getByLabelText(/this event repeats/i));
    expect(screen.getByLabelText(/number of occurrences/i)).toBeTruthy();
  });
});

describe("NewEventForm — a repeating series", () => {
  it("collapses a simple-pattern repeat into a single recurrence.pattern string", async () => {
    mockCreateEventAction.mockResolvedValueOnce({ ok: true, data: { eventId: "event-1" } });

    render(<NewEventForm slug="alder-creek" />);
    fireEvent.change(screen.getByLabelText(/^title/i), {
      target: { value: "Choir practice" },
    });
    fireEvent.change(screen.getByLabelText(/^starts/i), {
      target: { value: "2027-04-01T18:00" },
    });
    fireEvent.click(screen.getByLabelText(/this event repeats/i));
    fireEvent.change(screen.getByLabelText(/^number of occurrences/i), {
      target: { value: "6" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create event/i }));
    });

    expect(mockCreateEventAction).toHaveBeenCalledWith(
      "alder-creek",
      expect.objectContaining({
        recurrence: { pattern: "weekly", count: 6 },
      }),
    );
  });

  it("collapses a day-of-week repeat into an ordinal+day pattern string", async () => {
    mockCreateEventAction.mockResolvedValueOnce({ ok: true, data: { eventId: "event-1" } });

    render(<NewEventForm slug="alder-creek" />);
    fireEvent.change(screen.getByLabelText(/^title/i), {
      target: { value: "Committee meeting" },
    });
    fireEvent.change(screen.getByLabelText(/^starts/i), {
      target: { value: "2027-04-01T18:00" },
    });
    fireEvent.click(screen.getByLabelText(/this event repeats/i));
    fireEvent.click(screen.getByLabelText(/a specific day of the month/i));
    fireEvent.change(screen.getByLabelText(/^which/i), { target: { value: "2nd" } });
    fireEvent.change(screen.getByLabelText(/^day/i), { target: { value: "Tuesday" } });
    fireEvent.change(screen.getByLabelText(/^number of occurrences/i), {
      target: { value: "3" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create event/i }));
    });

    expect(mockCreateEventAction).toHaveBeenCalledWith(
      "alder-creek",
      expect.objectContaining({
        recurrence: { pattern: "2nd Tuesday", count: 3 },
      }),
    );
  });
});
