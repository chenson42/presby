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
import type { EventTypePickerData } from "@/lib/events";

const NO_TYPES: EventTypePickerData = { options: [], fallbackName: null };
const WITH_TYPES: EventTypePickerData = {
  options: [
    { id: "11111111-1111-4111-8111-111111111111", name: "Worship", colorToken: "teal", iconKey: "Church", isRetired: false },
    { id: "22222222-2222-4222-8222-222222222222", name: "Study", colorToken: "sky", iconKey: "BookOpen", isRetired: false },
  ],
  fallbackName: "General",
};

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

    render(<NewEventForm slug="alder-creek" typePicker={NO_TYPES} orgName="Alder Creek Presbyterian Church" />);

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

    render(<NewEventForm slug="alder-creek" typePicker={NO_TYPES} orgName="Alder Creek Presbyterian Church" />);
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
    render(<NewEventForm slug="alder-creek" typePicker={NO_TYPES} orgName="Alder Creek Presbyterian Church" />);
    expect(screen.queryByLabelText(/number of occurrences/i)).toBeNull();

    fireEvent.click(screen.getByLabelText(/this event repeats/i));
    expect(screen.getByLabelText(/number of occurrences/i)).toBeTruthy();
  });
});

describe("NewEventForm — a repeating series", () => {
  it("collapses a simple-pattern repeat into a single recurrence.pattern string", async () => {
    mockCreateEventAction.mockResolvedValueOnce({ ok: true, data: { eventId: "event-1" } });

    render(<NewEventForm slug="alder-creek" typePicker={NO_TYPES} orgName="Alder Creek Presbyterian Church" />);
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

    render(<NewEventForm slug="alder-creek" typePicker={NO_TYPES} orgName="Alder Creek Presbyterian Church" />);
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

describe("NewEventForm — the event type picker", () => {
  it("renders nothing when the organization has no types to choose from", () => {
    render(<NewEventForm slug="alder-creek" typePicker={NO_TYPES} orgName="Alder Creek" />);
    expect(screen.queryByLabelText(/event type/i)).toBeNull();
  });

  it("offers 'No type (shown as General)' first, then the active types", () => {
    render(<NewEventForm slug="alder-creek" typePicker={WITH_TYPES} orgName="Alder Creek" />);
    const select = screen.getByLabelText(/event type \(optional\)/i) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "No type (shown as General)",
      "Worship",
      "Study",
    ]);
    expect(select.value).toBe("none");
    expect(screen.getByText("Colors the event on the calendar.")).toBeTruthy();
  });

  it("submits eventTypeId null for 'No type' and the id for a chosen type", async () => {
    mockCreateEventAction.mockResolvedValue({ ok: true, data: { eventId: "event-1" } });
    render(<NewEventForm slug="alder-creek" typePicker={WITH_TYPES} orgName="Alder Creek" />);
    fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "Vespers" } });
    fireEvent.change(screen.getByLabelText(/^starts/i), { target: { value: "2027-03-01T19:00" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create event/i }));
    });
    expect(mockCreateEventAction).toHaveBeenLastCalledWith(
      "alder-creek",
      expect.objectContaining({ eventTypeId: null }),
    );

    fireEvent.change(screen.getByLabelText(/event type \(optional\)/i), {
      target: { value: WITH_TYPES.options[0].id },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create event/i }));
    });
    expect(mockCreateEventAction).toHaveBeenLastCalledWith(
      "alder-creek",
      expect.objectContaining({ eventTypeId: WITH_TYPES.options[0].id }),
    );
  });

  it("says what 'Open to everyone' means when unchecked: member calendar only, out of Copy month, never on the website", () => {
    render(<NewEventForm slug="alder-creek" typePicker={NO_TYPES} orgName="Alder Creek Presbyterian Church" />);
    expect(screen.getByLabelText("Open to everyone, not only members")).toBeTruthy();
    expect(
      screen.getByText(
        "If unchecked, the event shows only on the member calendar, for members of Alder Creek Presbyterian Church who have calendar access. It also stays out of Copy month and cannot be shown on the website.",
      ),
    ).toBeTruthy();
    // The old, false wording is gone.
    expect(screen.queryByText(/visible on the public calendar/i)).toBeNull();
    expect(screen.queryByText(/just stays off the public website/i)).toBeNull();
  });
});

describe("NewEventForm - the website switch (DECISION-238)", () => {
  const WEBSITE = "Show on our website's public calendar";
  const HINT_PUBLIC =
    "Anyone on the internet can read this event's title, description, location and event type. Search engines and web archives may keep copies, so taking the event off later does not remove copies already made. Leave out private details. It appears once your congregation's public events calendar is turned on.";
  const HINT_MEMBERS_ONLY = "Only events open to everyone can be shown on the website.";

  function fillRequired() {
    fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: "Harvest supper" } });
    fireEvent.change(screen.getByLabelText(/^starts/i), { target: { value: "2027-03-01T19:00" } });
  }

  it("is unticked by default, with the free-text and archive hint", () => {
    render(<NewEventForm slug="alder-creek" typePicker={NO_TYPES} orgName="Alder Creek" />);
    const box = screen.getByLabelText(WEBSITE) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(false);
    expect(screen.getByText(HINT_PUBLIC)).toBeTruthy();
    expect(screen.queryByText(HINT_MEMBERS_ONLY)).toBeNull();
  });

  it("submits websiteListed false by default and true when ticked", async () => {
    mockCreateEventAction.mockResolvedValue({ ok: true, data: { eventId: "event-1" } });
    render(<NewEventForm slug="alder-creek" typePicker={NO_TYPES} orgName="Alder Creek" />);
    fillRequired();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create event/i }));
    });
    expect(mockCreateEventAction).toHaveBeenLastCalledWith(
      "alder-creek",
      expect.objectContaining({ isPublic: true, websiteListed: false }),
    );

    fireEvent.click(screen.getByLabelText(WEBSITE));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create event/i }));
    });
    expect(mockCreateEventAction).toHaveBeenLastCalledWith(
      "alder-creek",
      expect.objectContaining({ isPublic: true, websiteListed: true }),
    );
  });

  it("unticking 'Open to everyone' disables and clears the website box and swaps the hint; the submit says false", async () => {
    mockCreateEventAction.mockResolvedValue({ ok: true, data: { eventId: "event-1" } });
    render(<NewEventForm slug="alder-creek" typePicker={NO_TYPES} orgName="Alder Creek" />);
    fillRequired();
    fireEvent.click(screen.getByLabelText(WEBSITE));
    expect((screen.getByLabelText(WEBSITE) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByLabelText("Open to everyone, not only members"));
    const box = screen.getByLabelText(WEBSITE) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);
    expect(screen.getByText(HINT_MEMBERS_ONLY)).toBeTruthy();
    expect(screen.queryByText(HINT_PUBLIC)).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create event/i }));
    });
    expect(mockCreateEventAction).toHaveBeenLastCalledWith(
      "alder-creek",
      expect.objectContaining({ isPublic: false, websiteListed: false }),
    );
  });

  it("re-ticking 'Open to everyone' re-enables the website box, still unticked", () => {
    render(<NewEventForm slug="alder-creek" typePicker={NO_TYPES} orgName="Alder Creek" />);
    const open = screen.getByLabelText("Open to everyone, not only members");
    fireEvent.click(open);
    fireEvent.click(open);
    const box = screen.getByLabelText(WEBSITE) as HTMLInputElement;
    expect(box.disabled).toBe(false);
    expect(box.checked).toBe(false);
  });
});
