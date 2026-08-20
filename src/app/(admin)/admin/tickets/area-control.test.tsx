// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TICKET_AREAS } from "@/lib/tickets-labels";

const mockSetTicketAreaAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  setTicketAreaAction: (...args: unknown[]) => mockSetTicketAreaAction(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { AreaControl } from "./area-control";

afterEach(() => {
  cleanup();
  mockSetTicketAreaAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("AreaControl — controlled vocabulary", () => {
  it("renders exactly TICKET_AREAS.length options", () => {
    render(<AreaControl ticketId="ticket-1" currentArea="directory" />);
    const select = screen.getByLabelText(/update ticket area/i) as HTMLSelectElement;
    expect(select.options.length).toBe(TICKET_AREAS.length);
  });
});

describe("AreaControl — optimistic update and revert", () => {
  it("calls setTicketAreaAction and keeps the new value on success", async () => {
    mockSetTicketAreaAction.mockResolvedValueOnce({ ok: true });
    render(<AreaControl ticketId="ticket-1" currentArea="directory" />);
    const select = screen.getByLabelText(/update ticket area/i) as HTMLSelectElement;

    await act(async () => {
      fireEvent.change(select, { target: { value: "roll" } });
    });

    expect(mockSetTicketAreaAction).toHaveBeenCalledWith("ticket-1", "roll");
    expect(select.value).toBe("roll");
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("reverts and toasts the server's error on failure", async () => {
    mockSetTicketAreaAction.mockResolvedValueOnce({ ok: false, error: "Forbidden." });
    render(<AreaControl ticketId="ticket-1" currentArea="directory" />);
    const select = screen.getByLabelText(/update ticket area/i) as HTMLSelectElement;

    await act(async () => {
      fireEvent.change(select, { target: { value: "other" } });
    });

    expect(select.value).toBe("directory");
    expect(toastError).toHaveBeenCalledWith("Forbidden.");
  });
});
