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
    websiteListed: false,
    allowsCheckin: false,
    cancelledAt: null,
    isRecurringSeries: false,
    isSeriesOccurrence: false,
    parentEventId: null,
    recurrencePattern: null,
    recurrenceCount: null,
    eventType: null,
    seriesOccurrences: [],
    seriesWebsite: null,
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

  it("says what 'Open to everyone' means when unchecked, and the old wording is gone", () => {
    render(<EditEventForm slug="alder-creek" event={makeEvent()} typePicker={NO_TYPES} orgName="Alder Creek" />);
    expect(screen.getByLabelText("Open to everyone, not only members")).toBeTruthy();
    expect(
      screen.getByText(
        "If unchecked, the event shows only on the member calendar, for members of Alder Creek who have calendar access. It also stays out of Copy month and cannot be shown on the website.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/visible on the public calendar/i)).toBeNull();
    expect(screen.queryByText(/just stays off the public website/i)).toBeNull();
  });
});

describe("EditEventForm - the website switch (DECISION-238)", () => {
  const WEBSITE = "Show on our website's public calendar";
  const SERIES_NOTE =
    "This changes this event only. To change this event and the ones after it, use Website listing on the event's page.";

  it("starts from the stored value: ticked for a listed event, unticked otherwise", () => {
    const { unmount } = render(
      <EditEventForm slug="alder-creek" event={makeEvent({ websiteListed: true })} typePicker={NO_TYPES} orgName="Alder Creek" />,
    );
    expect((screen.getByLabelText(WEBSITE) as HTMLInputElement).checked).toBe(true);
    unmount();
    render(<EditEventForm slug="alder-creek" event={makeEvent()} typePicker={NO_TYPES} orgName="Alder Creek" />);
    expect((screen.getByLabelText(WEBSITE) as HTMLInputElement).checked).toBe(false);
  });

  it("a members-only event shows the box disabled and unticked with the members-only hint", () => {
    render(
      <EditEventForm slug="alder-creek" event={makeEvent({ isPublic: false })} typePicker={NO_TYPES} orgName="Alder Creek" />,
    );
    const box = screen.getByLabelText(WEBSITE) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);
    expect(screen.getByText("Only events open to everyone can be shown on the website.")).toBeTruthy();
  });

  it("a round trip of an untouched listed event posts websiteListed true (an edit never flips it silently)", async () => {
    mockUpdateEventAction.mockResolvedValueOnce({ ok: true, data: { eventId: "event-1" } });
    render(
      <EditEventForm slug="alder-creek" event={makeEvent({ websiteListed: true })} typePicker={NO_TYPES} orgName="Alder Creek" />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(mockUpdateEventAction).toHaveBeenCalledWith(
      "alder-creek",
      expect.objectContaining({ isPublic: true, websiteListed: true }),
    );
  });

  it("an untouched unlisted event posts websiteListed false", async () => {
    mockUpdateEventAction.mockResolvedValueOnce({ ok: true, data: { eventId: "event-1" } });
    render(<EditEventForm slug="alder-creek" event={makeEvent()} typePicker={NO_TYPES} orgName="Alder Creek" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(mockUpdateEventAction).toHaveBeenCalledWith(
      "alder-creek",
      expect.objectContaining({ websiteListed: false }),
    );
  });

  it("unticking 'Open to everyone' on a listed event clears and disables the website box; the save posts both false (F251)", async () => {
    mockUpdateEventAction.mockResolvedValueOnce({ ok: true, data: { eventId: "event-1" } });
    render(
      <EditEventForm slug="alder-creek" event={makeEvent({ websiteListed: true })} typePicker={NO_TYPES} orgName="Alder Creek" />,
    );
    fireEvent.click(screen.getByLabelText("Open to everyone, not only members"));
    const box = screen.getByLabelText(WEBSITE) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(mockUpdateEventAction).toHaveBeenCalledWith(
      "alder-creek",
      expect.objectContaining({ isPublic: false, websiteListed: false }),
    );
  });

  it("says the switch changes this event only, for a series occurrence, and not otherwise", () => {
    const { unmount } = render(
      <EditEventForm
        slug="alder-creek"
        event={makeEvent({ isSeriesOccurrence: true, parentEventId: "parent-1" })}
        typePicker={NO_TYPES}
        orgName="Alder Creek"
      />,
    );
    expect(screen.getByText(SERIES_NOTE)).toBeTruthy();
    unmount();
    render(<EditEventForm slug="alder-creek" event={makeEvent()} typePicker={NO_TYPES} orgName="Alder Creek" />);
    expect(screen.queryByText(SERIES_NOTE)).toBeNull();
  });
});
