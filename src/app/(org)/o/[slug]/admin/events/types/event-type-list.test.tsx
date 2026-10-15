// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { EventTypeRow } from "@/lib/event-types";

const mockSetActive = vi.hoisted(() => vi.fn());
const mockMove = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  setEventTypeActiveAction: (...args: unknown[]) => mockSetActive(...args),
  moveEventTypeAction: (...args: unknown[]) => mockMove(...args),
  createEventTypeAction: vi.fn(),
  updateEventTypeAction: vi.fn(),
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

import { EventTypeList } from "./event-type-list";

afterEach(() => {
  cleanup();
  mockSetActive.mockReset();
  mockMove.mockReset();
  mockRefresh.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

function row(overrides: Partial<EventTypeRow>): EventTypeRow {
  return {
    id: "id",
    name: "Type",
    color: "teal",
    icon: "Church",
    sortOrder: 10,
    isActive: true,
    isFallback: false,
    usageCount: 0,
    ...overrides,
  };
}

const TYPES: EventTypeRow[] = [
  row({ id: "w", name: "Worship", usageCount: 3 }),
  row({ id: "s", name: "Study", color: "sky", icon: "BookOpen", sortOrder: 20, usageCount: 1 }),
  row({ id: "o", name: "Old Retreat", color: "amber", sortOrder: 30, isActive: false }),
  row({ id: "g", name: "General", color: "neutral", icon: "CalendarDays", sortOrder: 0, isFallback: true, usageCount: 12 }),
];

function card(name: string) {
  return screen.getByRole("heading", { level: 3, name }).closest("li")!;
}

describe("EventTypeList — rows", () => {
  it("lists every type with its usage count, pluralised", () => {
    render(<EventTypeList slug="alder-creek" types={TYPES} />);
    expect(within(card("Worship")).getByText("Used by 3 events")).toBeTruthy();
    expect(within(card("Study")).getByText("Used by 1 event")).toBeTruthy();
    expect(within(card("Old Retreat")).getByText("Used by 0 events")).toBeTruthy();
  });

  it("labels the default and retired types in text, not colour alone", () => {
    render(<EventTypeList slug="alder-creek" types={TYPES} />);
    expect(within(card("General")).getByText("Default")).toBeTruthy();
    expect(within(card("Old Retreat")).getByText("Retired")).toBeTruthy();
    expect(within(card("Worship")).queryByText("Retired")).toBeNull();
  });

  it("the default type's switch is disabled and says why; it has no move controls", () => {
    render(<EventTypeList slug="alder-creek" types={TYPES} />);
    const general = within(card("General"));
    expect(general.getByRole("switch").hasAttribute("disabled")).toBe(true);
    expect(general.getByText("The default type can't be retired.")).toBeTruthy();
    expect(general.queryByRole("button", { name: /move general/i })).toBeNull();
  });

  it("disables 'Move up' on the first movable row and 'Move down' on the last (retired included, default excluded)", () => {
    render(<EventTypeList slug="alder-creek" types={TYPES} />);
    expect(screen.getByRole("button", { name: "Move Worship up" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Move Worship down" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Move Study up" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Move Old Retreat down" }).hasAttribute("disabled")).toBe(true);
  });

  it("gives the move and edit buttons 44px targets", () => {
    render(<EventTypeList slug="alder-creek" types={TYPES} />);
    for (const name of ["Move Worship down", "Move Study up"]) {
      const cls = screen.getByRole("button", { name }).className;
      expect(cls).toContain("min-h-11");
      expect(cls).toContain("min-w-11");
    }
    expect(within(card("Worship")).getByRole("button", { name: /edit/i }).className).toContain("min-h-11");
  });

  it("names each switch after its type for assistive technology", () => {
    render(<EventTypeList slug="alder-creek" types={TYPES} />);
    expect(screen.getByRole("switch", { name: "Offered (Worship)" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Offered (Old Retreat)" }).getAttribute("aria-checked")).toBe("false");
  });
});

describe("EventTypeList — actions", () => {
  it("retires a type, toasts and refreshes", async () => {
    mockSetActive.mockResolvedValueOnce({ ok: true, data: { id: "s" } });
    render(<EventTypeList slug="alder-creek" types={TYPES} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "Offered (Study)" }));
    });
    expect(mockSetActive).toHaveBeenCalledWith("alder-creek", "s", false);
    expect(toastSuccess).toHaveBeenCalledWith("Study retired.");
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("offers a retired type again", async () => {
    mockSetActive.mockResolvedValueOnce({ ok: true, data: { id: "o" } });
    render(<EventTypeList slug="alder-creek" types={TYPES} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "Offered (Old Retreat)" }));
    });
    expect(mockSetActive).toHaveBeenCalledWith("alder-creek", "o", true);
    expect(toastSuccess).toHaveBeenCalledWith("Old Retreat is offered again.");
  });

  it("reverts the switch and shows the server's message when the change is refused", async () => {
    mockSetActive.mockResolvedValueOnce({ ok: false, error: "You don't have permission to manage event types here." });
    render(<EventTypeList slug="alder-creek" types={TYPES} />);
    const sw = screen.getByRole("switch", { name: "Offered (Study)" });
    await act(async () => {
      fireEvent.click(sw);
    });
    expect(toastError).toHaveBeenCalledWith("You don't have permission to manage event types here.");
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("moves a type up or down and refreshes", async () => {
    mockMove.mockResolvedValue({ ok: true, data: { id: "s" } });
    render(<EventTypeList slug="alder-creek" types={TYPES} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move Study up" }));
    });
    expect(mockMove).toHaveBeenCalledWith("alder-creek", "s", "up");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move Worship down" }));
    });
    expect(mockMove).toHaveBeenLastCalledWith("alder-creek", "w", "down");
    expect(mockRefresh).toHaveBeenCalledTimes(2);
  });

  it("toasts a refused move", async () => {
    mockMove.mockResolvedValueOnce({ ok: false, error: "That event type doesn't exist." });
    render(<EventTypeList slug="alder-creek" types={TYPES} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Move Study up" }));
    });
    expect(toastError).toHaveBeenCalledWith("That event type doesn't exist.");
  });

  it("opens an edit dialog holding the form, pre-filled", async () => {
    render(<EventTypeList slug="alder-creek" types={TYPES} />);
    fireEvent.click(within(card("Worship")).getByRole("button", { name: /edit/i }));
    const dialog = await waitFor(() => screen.getByRole("dialog"));
    expect(within(dialog).getByRole("heading", { name: "Edit event type" })).toBeTruthy();
    expect(within(dialog).getByDisplayValue("Worship")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Save changes" })).toBeTruthy();
  });
});
