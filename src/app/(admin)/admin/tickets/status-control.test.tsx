// @vitest-environment jsdom
/**
 * Tests for <StatusControl> — mirrors
 * `admin/feedback/feedback-status-control.tsx`'s own test shape (untested
 * in this repo directly, but the same optimistic-update-and-revert
 * contract), widened by one state (`in_progress`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockUpdateTicketStatusAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  updateTicketStatusAction: (...args: unknown[]) => mockUpdateTicketStatusAction(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { StatusControl } from "./status-control";

afterEach(() => {
  cleanup();
  mockUpdateTicketStatusAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("StatusControl — non-terminal states offer only legal forward transitions", () => {
  it("'new' offers triaged and declined, not resolved or in_progress", () => {
    render(<StatusControl ticketId="ticket-1" currentStatus="new" />);
    const select = screen.getByLabelText(/update ticket status/i) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["new", "triaged", "declined"]);
  });

  it("'triaged' offers in_progress and declined", () => {
    render(<StatusControl ticketId="ticket-1" currentStatus="triaged" />);
    const select = screen.getByLabelText(/update ticket status/i) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["triaged", "in_progress", "declined"]);
  });
});

describe("StatusControl — terminal states render a plain label, no select", () => {
  it("'resolved' renders no <select>", () => {
    render(<StatusControl ticketId="ticket-1" currentStatus="resolved" />);
    expect(screen.queryByLabelText(/update ticket status/i)).toBeNull();
    expect(screen.getByText("Resolved")).toBeTruthy();
  });

  it("'declined' renders no <select>", () => {
    render(<StatusControl ticketId="ticket-1" currentStatus="declined" />);
    expect(screen.queryByLabelText(/update ticket status/i)).toBeNull();
    expect(screen.getByText("Declined")).toBeTruthy();
  });
});

describe("StatusControl — optimistic update and revert", () => {
  it("calls updateTicketStatusAction and keeps the new value on success", async () => {
    mockUpdateTicketStatusAction.mockResolvedValueOnce({ ok: true });
    render(<StatusControl ticketId="ticket-1" currentStatus="new" />);
    const select = screen.getByLabelText(/update ticket status/i) as HTMLSelectElement;

    await act(async () => {
      fireEvent.change(select, { target: { value: "triaged" } });
    });

    expect(mockUpdateTicketStatusAction).toHaveBeenCalledWith("ticket-1", "triaged");
    expect(select.value).toBe("triaged");
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("reverts to the previous value and toasts the server's error on failure", async () => {
    // "declined" is a TERMINAL status (VALID_TRANSITIONS.declined === []),
    // so the optimistic update immediately swaps the <select> for a plain
    // label — reverting on failure swaps a NEW <select> back in, a
    // different DOM node than the one captured before the change. Re-query
    // after the revert rather than reusing the stale reference.
    mockUpdateTicketStatusAction.mockResolvedValueOnce({
      ok: false,
      error: "Cannot change status from 'new' to 'declined'.",
    });
    render(<StatusControl ticketId="ticket-1" currentStatus="new" />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/update ticket status/i), {
        target: { value: "declined" },
      });
    });

    const reverted = screen.getByLabelText(/update ticket status/i) as HTMLSelectElement;
    expect(reverted.value).toBe("new");
    expect(toastError).toHaveBeenCalledWith(
      "Cannot change status from 'new' to 'declined'.",
    );
  });
});
