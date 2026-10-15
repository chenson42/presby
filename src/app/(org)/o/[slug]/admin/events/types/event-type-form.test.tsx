// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockCreate = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  createEventTypeAction: (...args: unknown[]) => mockCreate(...args),
  updateEventTypeAction: (...args: unknown[]) => mockUpdate(...args),
}));

const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { EventTypeForm } from "./event-type-form";

afterEach(() => {
  cleanup();
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockRefresh.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

const EXISTING = { id: "11111111-1111-4111-8111-111111111111", name: "Worship", color: "teal" as const, icon: "Church" as const };

describe("EventTypeForm — structure", () => {
  it("renders inside a HydrationGate (a disabled-until-hydrated fieldset)", () => {
    const { container } = render(<EventTypeForm slug="alder-creek" mode="create" />);
    expect(container.querySelector('fieldset[data-slot="hydration-gate"]')).toBeTruthy();
  });

  it("offers eight selectable colours (never neutral) and fifteen icons, each a labelled radio", () => {
    render(<EventTypeForm slug="alder-creek" mode="create" />);
    const color = screen.getByRole("group", { name: "Color" });
    expect(color.querySelectorAll('input[type="radio"]')).toHaveLength(8);
    expect(screen.queryByLabelText("Neutral")).toBeNull();
    expect(screen.getByLabelText("Sky blue")).toBeTruthy();
    const icon = screen.getByRole("group", { name: "Icon" });
    expect(icon.querySelectorAll('input[type="radio"]')).toHaveLength(15);
    expect(screen.getByLabelText("Open book")).toBeTruthy();
  });

  it("starts with a defined colour and icon selected (no defaultChecked)", () => {
    const { container } = render(<EventTypeForm slug="alder-creek" mode="create" />);
    expect(container.querySelectorAll('input[type="radio"][checked]')).toHaveLength(0);
    expect((screen.getByLabelText("Rose") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Calendar") as HTMLInputElement).checked).toBe(true);
  });

  it("every colour and icon option is a 44px target", () => {
    render(<EventTypeForm slug="alder-creek" mode="create" />);
    for (const label of [screen.getByLabelText("Rose").closest("label")!, screen.getByLabelText("Microphone").closest("label")!]) {
      expect(label.className).toContain("min-h-11");
    }
  });

  it("the default type's colour is read-only text, and edit mode pre-fills from the type", () => {
    render(
      <EventTypeForm
        slug="alder-creek"
        mode="edit"
        isFallback
        initial={{ id: "g", name: "General", color: "neutral", icon: "CalendarDays" }}
      />,
    );
    expect(screen.queryByRole("group", { name: "Color" })).toBeNull();
    expect(screen.getByText("Color: Neutral (the default type is always neutral)")).toBeTruthy();
    expect(screen.getByDisplayValue("General")).toBeTruthy();
  });

  it("pre-fills an existing type's name, colour and icon in edit mode", () => {
    render(<EventTypeForm slug="alder-creek" mode="edit" initial={EXISTING} />);
    expect(screen.getByDisplayValue("Worship")).toBeTruthy();
    expect((screen.getByLabelText("Teal") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Church") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
  });
});

describe("EventTypeForm — create", () => {
  it("submits the trimmed name, chosen colour and icon, toasts, refreshes and resets", async () => {
    mockCreate.mockResolvedValueOnce({ ok: true, data: { id: "new-1" } });
    render(<EventTypeForm slug="alder-creek" mode="create" />);

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "  Choir rehearsal " } });
    fireEvent.click(screen.getByLabelText("Violet"));
    fireEvent.click(screen.getByLabelText("Music"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add event type" }));
    });

    expect(mockCreate).toHaveBeenCalledWith("alder-creek", {
      name: "Choir rehearsal",
      color: "violet",
      icon: "Music",
    });
    expect(toastSuccess).toHaveBeenCalledWith("Event type added.");
    expect(mockRefresh).toHaveBeenCalled();
    expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe("");
  });

  it("shows the server's duplicate-name message in a toast and does NOT reset the form", async () => {
    mockCreate.mockResolvedValueOnce({ ok: false, error: "You already have an event type called 'Worship'." });
    render(<EventTypeForm slug="alder-creek" mode="create" />);
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Worship" } });
    fireEvent.click(screen.getByLabelText("Lime"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add event type" }));
    });

    expect(toastError).toHaveBeenCalledWith("You already have an event type called 'Worship'.");
    expect(toastSuccess).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe("Worship");
    expect((screen.getByLabelText("Lime") as HTMLInputElement).checked).toBe(true);
  });

  it("blocks an empty name client-side with an inline message and no round trip", async () => {
    render(<EventTypeForm slug="alder-creek" mode="create" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add event type" }));
    });
    expect(screen.getByText("Name is required")).toBeTruthy();
    expect(screen.getByLabelText(/^name/i).getAttribute("aria-invalid")).toBe("true");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("caps the name input at 60 characters", () => {
    render(<EventTypeForm slug="alder-creek" mode="create" />);
    expect(screen.getByLabelText(/^name/i).getAttribute("maxlength")).toBe("60");
  });
});

describe("EventTypeForm — edit", () => {
  it("sends the type's id with the edits, then calls onDone", async () => {
    mockUpdate.mockResolvedValueOnce({ ok: true, data: { id: EXISTING.id } });
    const onDone = vi.fn();
    render(<EventTypeForm slug="alder-creek" mode="edit" initial={EXISTING} onDone={onDone} />);

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: "Sunday worship" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });

    expect(mockUpdate).toHaveBeenCalledWith("alder-creek", {
      id: EXISTING.id,
      name: "Sunday worship",
      color: "teal",
      icon: "Church",
    });
    expect(toastSuccess).toHaveBeenCalledWith("Event type saved.");
    expect(onDone).toHaveBeenCalled();
  });

  it("still submits neutral for the default type, so the server's rule is met", async () => {
    mockUpdate.mockResolvedValueOnce({ ok: true, data: { id: "g" } });
    render(
      <EventTypeForm
        slug="alder-creek"
        mode="edit"
        isFallback
        initial={{ id: "g", name: "General", color: "neutral", icon: "CalendarDays" }}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    expect(mockUpdate).toHaveBeenCalledWith("alder-creek", expect.objectContaining({ id: "g", color: "neutral" }));
  });

  it("does not call onDone on a failed save", async () => {
    mockUpdate.mockResolvedValueOnce({ ok: false, error: "That event type doesn't exist." });
    const onDone = vi.fn();
    render(<EventTypeForm slug="alder-creek" mode="edit" initial={EXISTING} onDone={onDone} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });
    expect(toastError).toHaveBeenCalledWith("That event type doesn't exist.");
    expect(onDone).not.toHaveBeenCalled();
  });
});
