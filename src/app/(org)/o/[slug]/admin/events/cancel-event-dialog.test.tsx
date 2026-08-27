// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockCancelEventAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  cancelEventAction: (...args: unknown[]) => mockCancelEventAction(...args),
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

import { CancelEventDialog } from "./cancel-event-dialog";

afterEach(() => {
  cleanup();
  mockCancelEventAction.mockReset();
  mockRefresh.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

const PROPS = {
  slug: "alder-creek",
  eventId: "event-1",
  eventTitle: "Session meeting",
  isSeriesParent: false,
};

describe("CancelEventDialog", () => {
  it("names the event in the confirmation copy — never a generic 'Are you sure?'", () => {
    render(<CancelEventDialog {...PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: /^cancel event$/i }));

    expect(screen.getByText(/cancel session meeting\?/i)).toBeTruthy();
  });

  it("warns that other occurrences are NOT cancelled when isSeriesParent is true", () => {
    render(<CancelEventDialog {...PROPS} isSeriesParent={true} />);
    fireEvent.click(screen.getByRole("button", { name: /^cancel event$/i }));

    expect(screen.getByText(/other occurrences.*are not cancelled/i)).toBeTruthy();
  });

  it("says nothing about a series when isSeriesParent is false", () => {
    render(<CancelEventDialog {...PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: /^cancel event$/i }));

    expect(screen.queryByText(/other occurrences/i)).toBeNull();
  });

  it("calls cancelEventAction(slug, eventId) on confirm and shows a success toast", async () => {
    mockCancelEventAction.mockResolvedValueOnce({ ok: true, data: { eventId: "event-1" } });

    render(<CancelEventDialog {...PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: /^cancel event$/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /yes, cancel event/i }));
    });

    expect(mockCancelEventAction).toHaveBeenCalledWith("alder-creek", "event-1");
    expect(toastSuccess).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("surfaces the server's error copy via toast.error on failure", async () => {
    mockCancelEventAction.mockResolvedValueOnce({
      ok: false,
      error: "You don't have permission to manage events here.",
    });

    render(<CancelEventDialog {...PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: /^cancel event$/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /yes, cancel event/i }));
    });

    expect(toastError).toHaveBeenCalledWith("You don't have permission to manage events here.");
  });
});
