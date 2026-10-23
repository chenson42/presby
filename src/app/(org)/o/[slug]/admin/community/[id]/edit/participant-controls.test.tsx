// @vitest-environment jsdom
/**
 * The Remove and Undo dialogs and the controller that lets the removal toast
 * open the undo dialog (docs/work-log/2026-10-22-founding-admin-directory.md,
 * Phase 3 Test Plan 2). Mocked at the `./actions` boundary: the actions' own
 * behaviour is `actions.test.ts`'s job. These pin the CLIENT contract: a
 * required reason, a bounded date, no native dialog, the filed-period warning,
 * triggers disabled until hydration, and Undo reachable from the toast.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";

const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }),
}));

const mockRemove = vi.hoisted(() => vi.fn());
const mockUndo = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  removeParticipantAction: (...a: unknown[]) => mockRemove(...a),
  undoParticipantEntryAction: (...a: unknown[]) => mockUndo(...a),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const toastWarning = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError, warning: toastWarning },
}));

import { ParticipantControls } from "./participant-controls";

afterEach(() => {
  cleanup();
  mockRefresh.mockClear();
  mockRemove.mockReset();
  mockUndo.mockReset();
  toastSuccess.mockClear();
  toastError.mockClear();
  toastWarning.mockClear();
});

const PROPS = {
  slug: "alder-creek",
  personId: "p-1",
  personName: "Nora Ashgrove",
  orgName: "Alder Creek Presbyterian Church",
  canRemove: true,
  undo: { rollActionId: "ra-1", entryLabel: "enrolment" as const },
};

describe("ParticipantControls — what renders", () => {
  it("renders nothing when there is neither a removal nor an undo to offer", () => {
    const { container } = render(
      <ParticipantControls {...PROPS} canRemove={false} undo={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders only Undo when canRemove is false", () => {
    render(<ParticipantControls {...PROPS} canRemove={false} />);
    expect(screen.queryByRole("button", { name: /remove as participant/i })).toBeNull();
    expect(screen.getByRole("button", { name: /undo last entry/i })).toBeTruthy();
  });

  it("both triggers are disabled in the server render, before hydration (DECISION-159)", () => {
    const html = renderToString(<ParticipantControls {...PROPS} />);
    const buttons = html.match(/<button[^>]*>/g) ?? [];
    expect(buttons.length).toBe(2);
    for (const b of buttons) expect(b).toContain('disabled=""');
  });

  it("uses an AlertDialog, never a native dialog (Rule 2)", () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => {});
    const confirm = vi.spyOn(window, "confirm").mockImplementation(() => true);
    render(<ParticipantControls {...PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: /remove as participant/i }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(alert).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    alert.mockRestore();
    confirm.mockRestore();
  });
});

describe("Remove as participant dialog", () => {
  function open() {
    render(<ParticipantControls {...PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: /remove as participant/i }));
  }

  it("says what removal does, offers a bounded date and Keep / Remove", () => {
    open();
    expect(screen.getByRole("heading", { name: /remove as participant\?/i })).toBeTruthy();
    expect(
      screen.getByText(
        /ends nora ashgrove's connection to alder creek presbyterian church from the date you choose\. they leave the directory and lose access if they have an account\. you can undo it afterward\./i,
      ),
    ).toBeTruthy();
    const date = screen.getByLabelText(/effective date/i) as HTMLInputElement;
    expect(date.type).toBe("date");
    expect(date.max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Defaults to today, so the common case needs no typing.
    expect(date.value).toBe(date.max);
    expect(screen.getByRole("button", { name: /^keep$/i })).toBeTruthy();
    expect(screen.getByLabelText(/minute reference \(optional\)/i)).toBeTruthy();
  });

  it("submits the date and minute reference, then offers Undo in a toast and refreshes", async () => {
    mockRemove.mockResolvedValue({
      ok: true,
      data: { rollActionId: "ra-new", affectsFiledPeriod: false },
    });
    open();
    fireEvent.change(screen.getByLabelText(/minute reference/i), {
      target: { value: "Session 2026-05" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));

    await waitFor(() => expect(mockRemove).toHaveBeenCalled());
    const [slug, input] = mockRemove.mock.calls[0];
    expect(slug).toBe("alder-creek");
    expect(input).toMatchObject({ personId: "p-1", minuteReference: "Session 2026-05" });
    expect(input.effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const [message, options] = toastSuccess.mock.calls[0];
    expect(message).toBe(
      "Removed as a participant. Undo is available from this page or under Former.",
    );
    expect(options.action.label).toBe("Undo");
    expect(mockRefresh).toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("a removal in a filed year adds the second, warning toast", async () => {
    mockRemove.mockResolvedValue({
      ok: true,
      data: { rollActionId: "ra-new", affectsFiledPeriod: true },
    });
    open();
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    await waitFor(() => expect(toastWarning).toHaveBeenCalled());
    expect(toastWarning.mock.calls[0][0]).toMatch(
      /this changes a year that has already been filed\. the filed return is not changed/i,
    );
  });

  it("a refusal keeps the dialog open, shows the reason, and does not refresh", async () => {
    mockRemove.mockResolvedValue({
      ok: false,
      error: "This person still holds an office, a role or a staff position here. End that first, then try again.",
    });
    open();
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/still holds an office/i)),
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("cannot be submitted with the date cleared", () => {
    open();
    fireEvent.change(screen.getByLabelText(/effective date/i), { target: { value: "" } });
    expect(
      (screen.getByRole("button", { name: /^remove$/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe("Undo last entry dialog", () => {
  function open() {
    render(<ParticipantControls {...PROPS} canRemove={false} />);
    fireEvent.click(screen.getByRole("button", { name: /undo last entry/i }));
  }

  it("requires a reason: the button stays disabled until one is typed", () => {
    open();
    expect(screen.getByRole("heading", { name: /undo this entry\?/i })).toBeTruthy();
    expect(
      screen.getByText(/this records a correction\. the original enrolment stays in the record, marked undone/i),
    ).toBeTruthy();
    const button = screen.getByRole("button", { name: /^undo entry$/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    const reason = screen.getByLabelText(/reason \(required, up to 500 characters\)/i);
    fireEvent.change(reason, { target: { value: "   " } });
    expect(button.disabled).toBe(true);
    fireEvent.change(reason, { target: { value: "Wrong person." } });
    expect(button.disabled).toBe(false);
  });

  it("caps the reason at 500 characters in the control itself", () => {
    open();
    const reason = screen.getByLabelText(/reason/i) as HTMLTextAreaElement;
    expect(reason.maxLength).toBe(500);
  });

  it("submits the target id and reason, toasts, and refreshes", async () => {
    mockUndo.mockResolvedValue({
      ok: true,
      data: {
        voidRollActionId: "ra-v",
        membershipReopened: false,
        affectsFiledPeriod: true,
        undoneKind: "other_participant_enrolled",
      },
    });
    open();
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Wrong person." } });
    fireEvent.click(screen.getByRole("button", { name: /^undo entry$/i }));

    await waitFor(() =>
      expect(mockUndo).toHaveBeenCalledWith("alder-creek", {
        rollActionId: "ra-1",
        reason: "Wrong person.",
      }),
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "Enrolment undone. They're no longer a participant.",
      ),
    );
    expect(toastWarning).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("undoing a removal says they're back as a participant", async () => {
    mockUndo.mockResolvedValue({
      ok: true,
      data: {
        voidRollActionId: "ra-v",
        membershipReopened: true,
        affectsFiledPeriod: false,
        undoneKind: "other_participant_removed",
      },
    });
    render(
      <ParticipantControls
        {...PROPS}
        canRemove={false}
        undo={{ rollActionId: "ra-2", entryLabel: "removal" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /undo last entry/i }));
    expect(screen.getByText(/the original removal stays in the record/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Mistake." } });
    fireEvent.click(screen.getByRole("button", { name: /^undo entry$/i }));
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Removal undone. They're back as a participant."),
    );
  });

  it("a refusal shows its reason and keeps the dialog open", async () => {
    mockUndo.mockResolvedValue({ ok: false, error: "That entry was already undone." });
    open();
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /^undo entry$/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("That entry was already undone."));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

describe("The removal toast's Undo opens the undo dialog on the new removal", () => {
  it("targets the removal just recorded, not the stale enrolment", async () => {
    mockRemove.mockResolvedValue({
      ok: true,
      data: { rollActionId: "ra-removal", affectsFiledPeriod: false },
    });
    mockUndo.mockResolvedValue({
      ok: true,
      data: {
        voidRollActionId: "ra-v",
        membershipReopened: true,
        affectsFiledPeriod: false,
        undoneKind: "other_participant_removed",
      },
    });
    render(<ParticipantControls {...PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: /remove as participant/i }));
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());

    // The user taps "Undo" in the toast.
    toastSuccess.mock.calls[0][1].action.onClick();

    const reason = await screen.findByLabelText(/reason/i);
    fireEvent.change(reason, { target: { value: "Removed by mistake." } });
    fireEvent.click(screen.getByRole("button", { name: /^undo entry$/i }));
    await waitFor(() =>
      expect(mockUndo).toHaveBeenCalledWith("alder-creek", {
        rollActionId: "ra-removal",
        reason: "Removed by mistake.",
      }),
    );
  });
});
