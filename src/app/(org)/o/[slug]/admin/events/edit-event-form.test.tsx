// @vitest-environment jsdom
/**
 * Component test for `EditEventForm` — docs/work-log/
 * 2026-08-26-events-model.md, Phase 4 commit 2. Mirrors `members/[id]/edit/
 * edit-person-form.test.tsx`'s style: NO recurrence controls anywhere in
 * this form (Phase 3's Component Plan — that's `ExtendSeriesForm`'s job),
 * and a failed save leaves every field exactly as entered (no reset).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { EventDetail } from "@/lib/events";

const mockUpdateEventAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  updateEventAction: (...args: unknown[]) => mockUpdateEventAction(...args),
}));

const mockPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { EditEventForm } from "./edit-event-form";

function makeEvent(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    eventId: "event-1",
    title: "Session meeting",
    description: "Stated meeting",
    location: "Fellowship hall",
    startsAt: "2027-03-01T19:00:00",
    endsAt: "2027-03-01T20:00:00",
    isPublic: true,
    allowsCheckin: false,
    cancelledAt: null,
    isRecurringSeries: false,
    isSeriesOccurrence: false,
    parentEventId: null,
    recurrencePattern: null,
    recurrenceCount: null,
    seriesOccurrences: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  mockUpdateEventAction.mockReset();
  mockPush.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("EditEventForm", () => {
  it("pre-fills every field from the event", () => {
    render(<EditEventForm slug="alder-creek" event={makeEvent()} />);
    expect(screen.getByDisplayValue("Session meeting")).toBeTruthy();
    expect(screen.getByDisplayValue("Fellowship hall")).toBeTruthy();
  });

  it("renders no recurrence controls at all, even for a series parent", () => {
    render(
      <EditEventForm
        slug="alder-creek"
        event={makeEvent({
          isRecurringSeries: true,
          recurrencePattern: "weekly",
          recurrenceCount: 6,
        })}
      />,
    );
    expect(screen.queryByText(/repeat pattern/i)).toBeNull();
    expect(screen.queryByLabelText(/number of occurrences/i)).toBeNull();
  });

  it("submits the edited fields and redirects to the detail page on success", async () => {
    mockUpdateEventAction.mockResolvedValueOnce({ ok: true, data: { eventId: "event-1" } });

    render(<EditEventForm slug="alder-creek" event={makeEvent()} />);
    fireEvent.change(screen.getByDisplayValue("Session meeting"), {
      target: { value: "Session meeting (updated)" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    });

    expect(mockUpdateEventAction).toHaveBeenCalledWith(
      "alder-creek",
      expect.objectContaining({ eventId: "event-1", title: "Session meeting (updated)" }),
    );
    expect(toastSuccess).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/o/alder-creek/admin/events/event-1");
  });

  it("does NOT reset the form on a failed save — mid-failure never discards data", async () => {
    mockUpdateEventAction.mockResolvedValueOnce({
      ok: false,
      error: "That event doesn't exist, or can't be edited directly.",
    });

    render(<EditEventForm slug="alder-creek" event={makeEvent()} />);
    fireEvent.change(screen.getByDisplayValue("Session meeting"), {
      target: { value: "Session meeting (in progress)" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    });

    expect(toastError).toHaveBeenCalledWith(
      "That event doesn't exist, or can't be edited directly.",
    );
    expect(screen.getByDisplayValue("Session meeting (in progress)")).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
