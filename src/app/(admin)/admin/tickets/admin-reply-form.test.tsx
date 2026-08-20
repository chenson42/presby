// @vitest-environment jsdom
/**
 * Tests for <AdminReplyForm>. `./actions` and `./upload-attachment-action`
 * are both mocked — the latter is the store-then-reply flow's first call
 * (see that file's own header for why it's a separate action).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockReplyToTicketAsOperatorAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  replyToTicketAsOperatorAction: (...args: unknown[]) =>
    mockReplyToTicketAsOperatorAction(...args),
}));

const mockUploadTicketAttachmentAction = vi.hoisted(() => vi.fn());
vi.mock("./upload-attachment-action", () => ({
  uploadTicketAttachmentAction: (...args: unknown[]) =>
    mockUploadTicketAttachmentAction(...args),
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

import { AdminReplyForm } from "./admin-reply-form";

afterEach(() => {
  cleanup();
  mockReplyToTicketAsOperatorAction.mockReset();
  mockUploadTicketAttachmentAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  mockRouterRefresh.mockReset();
});

describe("AdminReplyForm — no attachment", () => {
  it("calls replyToTicketAsOperatorAction with an undefined attachmentKey, and never calls the upload action", async () => {
    mockReplyToTicketAsOperatorAction.mockResolvedValueOnce({
      ok: true,
      data: { messageId: "message-1" },
    });
    render(<AdminReplyForm ticketId="ticket-1" organizationId="org-1" />);

    fireEvent.change(screen.getByLabelText(/^reply$/i), {
      target: { value: "Thanks for the report — looking into it." },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send reply/i }));
    });

    expect(mockUploadTicketAttachmentAction).not.toHaveBeenCalled();
    expect(mockReplyToTicketAsOperatorAction).toHaveBeenCalledWith(
      "ticket-1",
      "Thanks for the report — looking into it.",
      undefined,
    );
    expect(toastSuccess).toHaveBeenCalled();
    expect(mockRouterRefresh).toHaveBeenCalled();
  });
});

describe("AdminReplyForm — a failed upload blocks the reply", () => {
  it("toasts the upload's own error and never calls replyToTicketAsOperatorAction", async () => {
    mockUploadTicketAttachmentAction.mockResolvedValueOnce({
      ok: false,
      error: "That file isn't a PNG, JPEG, WEBP, or PDF we can accept.",
    });
    render(<AdminReplyForm ticketId="ticket-1" organizationId="org-1" />);

    fireEvent.change(screen.getByLabelText(/^reply$/i), {
      target: { value: "See attached." },
    });
    const file = new File(["not-an-image"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText(/^attachment/i), {
      target: { files: [file] },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /send reply/i }));
    });

    expect(mockUploadTicketAttachmentAction).toHaveBeenCalledWith("org-1", expect.any(FormData));
    expect(mockReplyToTicketAsOperatorAction).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "That file isn't a PNG, JPEG, WEBP, or PDF we can accept.",
    );
  });
});
