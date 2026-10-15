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
import type { EventTypePickerData } from "@/lib/events";

const NO_TYPES: EventTypePickerData = { options: [], fallbackName: null };
const WORSHIP_ID = "11111111-1111-4111-8111-111111111111";
const WITH_TYPES: EventTypePickerData = {
  options: [
    { id: WORSHIP_ID, name: "Worship", colorToken: "teal", iconKey: "Church", isRetired: false },
    { id: "33333333-3333-4333-8333-333333333333", name: "Old Study", colorToken: "sky", iconKey: "BookOpen", isRetired: true },
  ],
  fallbackName: "General",
};

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
    eventType: null,
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
    render(<EditEventForm slug="alder-creek" event={makeEvent()} typePicker={NO_TYPES} orgName="Alder Creek" />);
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
        typePicker={NO_TYPES}
        orgName="Alder Creek"
      />,
    );
    expect(screen.queryByText(/repeat pattern/i)).toBeNull();
    expect(screen.queryByLabelText(/number of occurrences/i)).toBeNull();
  });

  it("submits the edited fields and redirects to the detail page on success", async () => {
    mockUpdateEventAction.mockResolvedValueOnce({ ok: true, data: { eventId: "event-1" } });

    render(<EditEventForm slug="alder-creek" event={makeEvent()} typePicker={NO_TYPES} orgName="Alder Creek" />);
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

    render(<EditEventForm slug="alder-creek" event={makeEvent()} typePicker={NO_TYPES} orgName="Alder Creek" />);
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

describe("EditEventForm — the event type picker", () => {
  it("defaults to the event's own type and submits it", async () => {
    mockUpdateEventAction.mockResolvedValue({ ok: true, data: { eventId: "event-1" } });
    render(
      <EditEventForm
        slug="alder-creek"
        event={makeEvent({ eventType: { id: WORSHIP_ID, name: "Worship" } })}
        typePicker={WITH_TYPES}
        orgName="Alder Creek"
      />,
    );
    const select = screen.getByLabelText(/event type \(optional\)/i) as HTMLSelectElement;
    expect(select.value).toBe(WORSHIP_ID);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    });
    expect(mockUpdateEventAction).toHaveBeenCalledWith(
      "alder-creek",
      expect.objectContaining({ eventTypeId: WORSHIP_ID }),
    );
  });

  it("defaults to 'No type' for an untyped event and submits null", async () => {
    mockUpdateEventAction.mockResolvedValue({ ok: true, data: { eventId: "event-1" } });
    render(<EditEventForm slug="alder-creek" event={makeEvent()} typePicker={WITH_TYPES} orgName="Alder Creek" />);
    expect((screen.getByLabelText(/event type \(optional\)/i) as HTMLSelectElement).value).toBe("none");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    });
    expect(mockUpdateEventAction).toHaveBeenCalledWith(
      "alder-creek",
      expect.objectContaining({ eventTypeId: null }),
    );
  });

  it("labels a retired current type '(retired)' so editing does not silently drop it", () => {
    render(
      <EditEventForm
        slug="alder-creek"
        event={makeEvent({ eventType: { id: "33333333-3333-4333-8333-333333333333", name: "Old Study" } })}
        typePicker={WITH_TYPES}
        orgName="Alder Creek"
      />,
    );
    const select = screen.getByLabelText(/event type \(optional\)/i) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toContain("Old Study (retired)");
    expect(select.value).toBe("33333333-3333-4333-8333-333333333333");
  });

  it("says 'Changes this occurrence only.' for a series occurrence, and not otherwise", () => {
    const { unmount } = render(
      <EditEventForm
        slug="alder-creek"
        event={makeEvent({ isSeriesOccurrence: true, parentEventId: "parent-1" })}
        typePicker={WITH_TYPES}
        orgName="Alder Creek"
      />,
    );
    expect(screen.getByText("Changes this occurrence only.")).toBeTruthy();
    unmount();
    render(<EditEventForm slug="alder-creek" event={makeEvent()} typePicker={WITH_TYPES} orgName="Alder Creek" />);
    expect(screen.queryByText("Changes this occurrence only.")).toBeNull();
  });

  it("explains that an unchecked public box still shows to members", () => {
    render(<EditEventForm slug="alder-creek" event={makeEvent()} typePicker={NO_TYPES} orgName="Alder Creek" />);
    expect(screen.getByText(/still shows on the member calendar for everyone in Alder Creek/i)).toBeTruthy();
  });
});
