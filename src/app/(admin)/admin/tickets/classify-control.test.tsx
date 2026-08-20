// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CHANGE_CLASSES } from "@/lib/tickets-labels";

const mockReclassifyTicketAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  reclassifyTicketAction: (...args: unknown[]) => mockReclassifyTicketAction(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { ClassifyControl } from "./classify-control";

afterEach(() => {
  cleanup();
  mockReclassifyTicketAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("ClassifyControl — controlled vocabulary", () => {
  it("renders exactly CHANGE_CLASSES.length options, always (no state machine to restrict it)", () => {
    render(<ClassifyControl ticketId="ticket-1" currentChangeClass="bug" />);
    const select = screen.getByLabelText(/update ticket category/i) as HTMLSelectElement;
    expect(select.options.length).toBe(CHANGE_CLASSES.length);
  });
});

describe("ClassifyControl — optimistic update and revert", () => {
  it("calls reclassifyTicketAction and keeps the new value on success", async () => {
    mockReclassifyTicketAction.mockResolvedValueOnce({ ok: true });
    render(<ClassifyControl ticketId="ticket-1" currentChangeClass="bug" />);
    const select = screen.getByLabelText(/update ticket category/i) as HTMLSelectElement;

    await act(async () => {
      fireEvent.change(select, { target: { value: "feature" } });
    });

    expect(mockReclassifyTicketAction).toHaveBeenCalledWith("ticket-1", "feature");
    expect(select.value).toBe("feature");
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("reverts and toasts the server's error on failure", async () => {
    mockReclassifyTicketAction.mockResolvedValueOnce({
      ok: false,
      error: "Forbidden.",
    });
    render(<ClassifyControl ticketId="ticket-1" currentChangeClass="bug" />);
    const select = screen.getByLabelText(/update ticket category/i) as HTMLSelectElement;

    await act(async () => {
      fireEvent.change(select, { target: { value: "theme" } });
    });

    expect(select.value).toBe("bug");
    expect(toastError).toHaveBeenCalledWith("Forbidden.");
  });
});
