// @vitest-environment jsdom
/**
 * Tests for <CongregationFeedbackForm>. `./actions` is mocked — a "use
 * server" module pulling `@/lib/tickets` (and the Neon pool) into the
 * module graph.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockSubmitCongregationFeedbackAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  submitCongregationFeedbackAction: (...args: unknown[]) =>
    mockSubmitCongregationFeedbackAction(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { CongregationFeedbackForm } from "./feedback-form";

afterEach(() => {
  cleanup();
  mockSubmitCongregationFeedbackAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("CongregationFeedbackForm", () => {
  it("disables submit when the body is empty", () => {
    render(<CongregationFeedbackForm slug="alder-creek" />);
    const submit = screen.getByRole("button", { name: /share feedback/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("submits the body to submitCongregationFeedbackAction and clears on success", async () => {
    mockSubmitCongregationFeedbackAction.mockResolvedValueOnce({
      ok: true,
      data: { feedbackId: "feedback-1" },
    });
    render(<CongregationFeedbackForm slug="alder-creek" />);

    const textarea = screen.getByLabelText(/what.s on your mind/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: "The events calendar should show class times." },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /share feedback/i }));
    });

    expect(mockSubmitCongregationFeedbackAction).toHaveBeenCalledWith(
      "alder-creek",
      "The events calendar should show class times.",
    );
    expect(toastSuccess).toHaveBeenCalled();
    expect(textarea.value).toBe("");
  });

  it("surfaces a rate-limit failure via toast.error, verbatim", async () => {
    mockSubmitCongregationFeedbackAction.mockResolvedValueOnce({
      ok: false,
      error: "Too many submissions — come back in a bit.",
    });
    render(<CongregationFeedbackForm slug="alder-creek" />);
    fireEvent.change(screen.getByLabelText(/what.s on your mind/i), {
      target: { value: "Another note." },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /share feedback/i }));
    });

    expect(toastError).toHaveBeenCalledWith(
      "Too many submissions — come back in a bit.",
    );
  });
});
