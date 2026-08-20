// @vitest-environment jsdom
/**
 * Tests for <DismissFeedbackDialog> — `AlertDialog`, never `confirm()`
 * (Workflow Rule 2). Mirrors `admin/roles/revoke-dialog.test.tsx`'s shape.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockDismissFeedbackAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  dismissFeedbackAction: (...args: unknown[]) => mockDismissFeedbackAction(...args),
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

import { DismissFeedbackDialog } from "./dismiss-feedback-dialog";

afterEach(() => {
  cleanup();
  mockDismissFeedbackAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  mockRouterRefresh.mockReset();
});

describe("DismissFeedbackDialog", () => {
  it("names the submitter in the confirmation copy, not a generic 'are you sure'", () => {
    render(
      <DismissFeedbackDialog
        slug="alder-creek"
        feedbackId="feedback-1"
        submitterDisplayName="Priya Balakrishnan"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(
      screen.getByText(/dismiss feedback from priya balakrishnan/i),
    ).toBeTruthy();
  });

  it("calls dismissFeedbackAction and toasts success on confirm", async () => {
    mockDismissFeedbackAction.mockResolvedValueOnce({ ok: true });
    render(
      <DismissFeedbackDialog
        slug="alder-creek"
        feedbackId="feedback-1"
        submitterDisplayName="Priya Balakrishnan"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /yes, dismiss/i }));
    });
    expect(mockDismissFeedbackAction).toHaveBeenCalledWith(
      "alder-creek",
      "feedback-1",
    );
    expect(toastSuccess).toHaveBeenCalled();
    expect(mockRouterRefresh).toHaveBeenCalled();
  });

  it("surfaces a failure via toast.error, verbatim — not swallowed", async () => {
    mockDismissFeedbackAction.mockResolvedValueOnce({
      ok: false,
      error: "That feedback has already been handled.",
    });
    render(
      <DismissFeedbackDialog
        slug="alder-creek"
        feedbackId="feedback-1"
        submitterDisplayName="Priya Balakrishnan"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /yes, dismiss/i }));
    });
    expect(toastError).toHaveBeenCalledWith(
      "That feedback has already been handled.",
    );
  });
});
