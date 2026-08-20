// @vitest-environment jsdom
/**
 * Tests for <FileTicketForm>. `./actions` is mocked — a "use server" module
 * whose real implementation pulls `@/lib/tickets` (and the Neon pool) into
 * the module graph, same reasoning `grant-role-form.test.tsx`'s header
 * gives for its own mock.
 *
 * What this file exists to pin, per the brief:
 *   - The area/priority/category selects render EXACTLY the
 *     controlled-vocabulary options — no free text, no wildcard "select
 *     all" (mirrors Phase 1 finding 3's reasoning from the sibling
 *     role-catalog pipeline, applied here to a different form).
 *   - Priority defaults to "Normal", pre-selected.
 *   - Promote mode (`fromFeedback` supplied) shows the pre-fill banner, has
 *     NO body/attachment fields, and submits through `promoteFeedbackAction`
 *     — not `fileTicketAction`.
 *   - File mode (no `fromFeedback`) submits through `fileTicketAction` with
 *     a FormData carrying every field.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CHANGE_CLASSES, TICKET_AREAS, TICKET_PRIORITIES } from "@/lib/tickets-labels";

const mockFileTicketAction = vi.hoisted(() => vi.fn());
const mockPromoteFeedbackAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  fileTicketAction: (...args: unknown[]) => mockFileTicketAction(...args),
  promoteFeedbackAction: (...args: unknown[]) => mockPromoteFeedbackAction(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const mockRouterPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

import { FileTicketForm } from "./file-ticket-form";

afterEach(() => {
  cleanup();
  mockFileTicketAction.mockReset();
  mockPromoteFeedbackAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  mockRouterPush.mockReset();
});

describe("FileTicketForm — controlled vocabulary (no free text, no wildcard)", () => {
  it("the category select renders exactly CHANGE_CLASSES.length options", () => {
    render(<FileTicketForm slug="alder-creek" />);
    const select = screen.getByLabelText(/^category$/i) as HTMLSelectElement;
    expect(select.options.length).toBe(CHANGE_CLASSES.length);
  });

  it("the area select renders exactly TICKET_AREAS.length options", () => {
    render(<FileTicketForm slug="alder-creek" />);
    const select = screen.getByLabelText(/^area$/i) as HTMLSelectElement;
    expect(select.options.length).toBe(TICKET_AREAS.length);
  });

  it("the priority select renders exactly TICKET_PRIORITIES.length options, defaulting to Normal", () => {
    render(<FileTicketForm slug="alder-creek" />);
    const select = screen.getByLabelText(/^priority$/i) as HTMLSelectElement;
    expect(select.options.length).toBe(TICKET_PRIORITIES.length);
    expect(select.value).toBe("normal");
  });
});

describe("FileTicketForm — file mode", () => {
  it("shows the Description and Attachment fields, no promote banner", () => {
    render(<FileTicketForm slug="alder-creek" />);
    expect(screen.getByLabelText(/^description$/i)).toBeTruthy();
    expect(screen.getByLabelText(/^attachment/i)).toBeTruthy();
    expect(screen.queryByText(/promoting feedback from/i)).toBeNull();
  });

  it("submits through fileTicketAction with a FormData carrying every field", async () => {
    mockFileTicketAction.mockResolvedValueOnce({
      ok: true,
      data: { ticketId: "ticket-1" },
    });
    render(<FileTicketForm slug="alder-creek" />);

    fireEvent.change(screen.getByLabelText(/^subject$/i), {
      target: { value: "The events calendar is missing Sunday school" },
    });
    fireEvent.change(screen.getByLabelText(/^description$/i), {
      target: { value: "It would help to see the schedule." },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^file ticket$/i }));
    });

    expect(mockFileTicketAction).toHaveBeenCalledTimes(1);
    const [slugArg, formDataArg] = mockFileTicketAction.mock.calls[0];
    expect(slugArg).toBe("alder-creek");
    expect(formDataArg).toBeInstanceOf(FormData);
    expect(formDataArg.get("subject")).toBe(
      "The events calendar is missing Sunday school",
    );
    expect(formDataArg.get("body")).toBe("It would help to see the schedule.");
    expect(formDataArg.get("priority")).toBe("normal");
    expect(mockPromoteFeedbackAction).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalled();
    expect(mockRouterPush).toHaveBeenCalledWith("/o/alder-creek/tickets/ticket-1");
  });

  it("surfaces a failure via toast.error, verbatim", async () => {
    mockFileTicketAction.mockResolvedValueOnce({
      ok: false,
      error: "You don't have permission to file tickets here.",
    });
    render(<FileTicketForm slug="alder-creek" />);
    fireEvent.change(screen.getByLabelText(/^subject$/i), {
      target: { value: "Subject" },
    });
    fireEvent.change(screen.getByLabelText(/^description$/i), {
      target: { value: "Body" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^file ticket$/i }));
    });

    expect(toastError).toHaveBeenCalledWith(
      "You don't have permission to file tickets here.",
    );
  });
});

describe("FileTicketForm — promote mode (fromFeedback supplied)", () => {
  const fromFeedback = {
    feedbackId: "feedback-1",
    submitterDisplayName: "Priya Balakrishnan",
    body: "The events calendar should show Sunday school times.",
  };

  it("shows the pre-fill banner naming the submitter, and NO body/attachment fields", () => {
    render(<FileTicketForm slug="alder-creek" fromFeedback={fromFeedback} />);
    expect(
      screen.getByText(/promoting feedback from priya balakrishnan/i),
    ).toBeTruthy();
    expect(screen.getByText(/sunday school times/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^description$/i)).toBeNull();
    expect(screen.queryByLabelText(/^attachment/i)).toBeNull();
  });

  it("submits through promoteFeedbackAction, not fileTicketAction", async () => {
    mockPromoteFeedbackAction.mockResolvedValueOnce({
      ok: true,
      data: { ticketId: "ticket-2" },
    });
    render(<FileTicketForm slug="alder-creek" fromFeedback={fromFeedback} />);

    fireEvent.change(screen.getByLabelText(/^subject$/i), {
      target: { value: "Show Sunday school times on the calendar" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /promote to ticket/i }));
    });

    expect(mockPromoteFeedbackAction).toHaveBeenCalledWith(
      "alder-creek",
      "feedback-1",
      expect.objectContaining({
        subject: "Show Sunday school times on the calendar",
        priority: "normal",
      }),
    );
    expect(mockFileTicketAction).not.toHaveBeenCalled();
    expect(mockRouterPush).toHaveBeenCalledWith("/o/alder-creek/tickets/ticket-2");
  });
});
