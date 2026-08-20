// @vitest-environment jsdom
/**
 * Tests for <ReplyForm>. `../actions` is mocked — a "use server" module
 * pulling `@/lib/tickets` into the module graph.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockReplyToTicketAction = vi.hoisted(() => vi.fn());
vi.mock("../actions", () => ({
  replyToTicketAction: (...args: unknown[]) => mockReplyToTicketAction(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const mockRouterRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRouterRefresh }),
}));

import { ReplyForm } from "./reply-form";

afterEach(() => {
  cleanup();
  mockReplyToTicketAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  mockRouterRefresh.mockReset();
});

describe("ReplyForm", () => {
  it("disables submit when the body is empty", () => {
    render(<ReplyForm slug="alder-creek" ticketId="ticket-1" />);
    const submit = screen.getByRole("button", { name: /send reply/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("submits body via FormData to replyToTicketAction and clears on success", async () => {
    mockReplyToTicketAction.mockResolvedValueOnce({
      ok: true,
      data: { messageId: "message-2" },
    });
    render(<ReplyForm slug="alder-creek" ticketId="ticket-1" />);

    const textarea = screen.getByLabelText(/^reply$/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Thanks, looking into it." } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send reply/i }));
    });

    expect(mockReplyToTicketAction).toHaveBeenCalledTimes(1);
    const [slugArg, ticketIdArg, formDataArg] = mockReplyToTicketAction.mock.calls[0];
    expect(slugArg).toBe("alder-creek");
    expect(ticketIdArg).toBe("ticket-1");
    expect(formDataArg.get("body")).toBe("Thanks, looking into it.");
    expect(toastSuccess).toHaveBeenCalled();
    expect(mockRouterRefresh).toHaveBeenCalled();
    expect(textarea.value).toBe("");
  });

  it("surfaces a failure via toast.error, verbatim", async () => {
    mockReplyToTicketAction.mockResolvedValueOnce({
      ok: false,
      error: "That ticket no longer exists.",
    });
    render(<ReplyForm slug="alder-creek" ticketId="ticket-1" />);
    fireEvent.change(screen.getByLabelText(/^reply$/i), {
      target: { value: "Hello" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send reply/i }));
    });

    expect(toastError).toHaveBeenCalledWith("That ticket no longer exists.");
  });
});
