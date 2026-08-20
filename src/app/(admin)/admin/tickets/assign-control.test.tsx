// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockAssignTicketAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  assignTicketAction: (...args: unknown[]) => mockAssignTicketAction(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { AssignControl } from "./assign-control";

afterEach(() => {
  cleanup();
  mockAssignTicketAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

const OPERATORS = [
  { userId: "op-1", email: "ops1@example.invalid", name: "Ops One" },
  { userId: "op-2", email: "ops2@example.invalid", name: null },
];

describe("AssignControl — options", () => {
  it("renders 'Unassigned' plus one option per operator", () => {
    render(
      <AssignControl
        ticketId="ticket-1"
        currentAssigneeUserId={null}
        operators={OPERATORS}
      />,
    );
    const select = screen.getByLabelText(/update ticket assignee/i) as HTMLSelectElement;
    expect(select.options.length).toBe(OPERATORS.length + 1);
    expect(select.value).toBe("none");
  });

  it("falls back to email when an operator has no name", () => {
    render(
      <AssignControl
        ticketId="ticket-1"
        currentAssigneeUserId={null}
        operators={OPERATORS}
      />,
    );
    expect(screen.getByText("ops2@example.invalid")).toBeTruthy();
  });
});

describe("AssignControl — optimistic update and revert", () => {
  it("calls assignTicketAction with null for the 'Unassigned' sentinel, and with the userId otherwise", async () => {
    mockAssignTicketAction.mockResolvedValueOnce({ ok: true });
    render(
      <AssignControl
        ticketId="ticket-1"
        currentAssigneeUserId={null}
        operators={OPERATORS}
      />,
    );
    const select = screen.getByLabelText(/update ticket assignee/i) as HTMLSelectElement;

    await act(async () => {
      fireEvent.change(select, { target: { value: "op-1" } });
    });

    expect(mockAssignTicketAction).toHaveBeenCalledWith("ticket-1", "op-1");
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("reverts and toasts the server's error on failure", async () => {
    mockAssignTicketAction.mockResolvedValueOnce({
      ok: false,
      error: "That person doesn't hold access to tickets.",
    });
    render(
      <AssignControl
        ticketId="ticket-1"
        currentAssigneeUserId={null}
        operators={OPERATORS}
      />,
    );
    const select = screen.getByLabelText(/update ticket assignee/i) as HTMLSelectElement;

    await act(async () => {
      fireEvent.change(select, { target: { value: "op-2" } });
    });

    expect(select.value).toBe("none");
    expect(toastError).toHaveBeenCalledWith(
      "That person doesn't hold access to tickets.",
    );
  });
});
