// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TICKET_PRIORITIES } from "@/lib/tickets-labels";

const mockSetTicketPriorityAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  setTicketPriorityAction: (...args: unknown[]) => mockSetTicketPriorityAction(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { PriorityControl } from "./priority-control";

afterEach(() => {
  cleanup();
  mockSetTicketPriorityAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("PriorityControl — controlled vocabulary", () => {
  it("renders exactly TICKET_PRIORITIES.length options", () => {
    render(<PriorityControl ticketId="ticket-1" currentPriority="normal" />);
    const select = screen.getByLabelText(/update ticket priority/i) as HTMLSelectElement;
    expect(select.options.length).toBe(TICKET_PRIORITIES.length);
  });
});

describe("PriorityControl — optimistic update and revert", () => {
  it("calls setTicketPriorityAction and keeps the new value on success", async () => {
    mockSetTicketPriorityAction.mockResolvedValueOnce({ ok: true });
    render(<PriorityControl ticketId="ticket-1" currentPriority="normal" />);
    const select = screen.getByLabelText(/update ticket priority/i) as HTMLSelectElement;

    await act(async () => {
      fireEvent.change(select, { target: { value: "urgent" } });
    });

    expect(mockSetTicketPriorityAction).toHaveBeenCalledWith("ticket-1", "urgent");
    expect(select.value).toBe("urgent");
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("reverts and toasts the server's error on failure", async () => {
    mockSetTicketPriorityAction.mockResolvedValueOnce({ ok: false, error: "Forbidden." });
    render(<PriorityControl ticketId="ticket-1" currentPriority="normal" />);
    const select = screen.getByLabelText(/update ticket priority/i) as HTMLSelectElement;

    await act(async () => {
      fireEvent.change(select, { target: { value: "low" } });
    });

    expect(select.value).toBe("normal");
    expect(toastError).toHaveBeenCalledWith("Forbidden.");
  });
});
