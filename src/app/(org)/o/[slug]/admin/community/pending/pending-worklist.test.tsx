// @vitest-environment jsdom
/**
 * `PendingWorklist`, the queue UI. Mocked at the `./actions` boundary. Pins:
 * both empty states, the badges (self-proposed, ended, deceased, future-dated),
 * decide vs read mode, selection and the sticky bulk bar, the bulk dialog's
 * partial-result panel, and the Approve, Deny and Withdraw AlertDialogs (never a
 * native confirm, Rule 2): required reasons, typed refusals kept in the dialog.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockApprove = vi.hoisted(() => vi.fn());
const mockApproveMany = vi.hoisted(() => vi.fn());
const mockDeny = vi.hoisted(() => vi.fn());
const mockWithdraw = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  approveRollActionAction: (...args: unknown[]) => mockApprove(...args),
  approveRollActionsAction: (...args: unknown[]) => mockApproveMany(...args),
  denyRollActionAction: (...args: unknown[]) => mockDeny(...args),
  withdrawRollActionAction: (...args: unknown[]) => mockWithdraw(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const toastWarning = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError, warning: toastWarning },
}));

import { PendingWorklist } from "./pending-worklist";
import type { PendingQueueViewer, PendingRollAction } from "@/lib/roll";

const ACTION: PendingRollAction = {
  id: "ra-1",
  personId: "person-9",
  personDisplayName: "Nora Ashgrove",
  kind: "profession_of_faith",
  effectiveDate: "2026-06-01",
  minuteReference: null,
  proposedOn: "2026-05-20",
  proposedByIsViewer: false,
  membershipEnded: false,
  personDeceased: false,
};
const SECOND: PendingRollAction = {
  ...ACTION,
  id: "ra-2",
  personId: "person-10",
  personDisplayName: "Owen Pell",
};

const DECIDE: PendingQueueViewer = {
  canApprove: true,
  canPropose: false,
  canManagePeople: true,
};
const READ: PendingQueueViewer = {
  canApprove: false,
  canPropose: true,
  canManagePeople: false,
};
const TODAY = "2026-06-15";

function renderList(
  actions: PendingRollAction[],
  opts: { mode?: "decide" | "read"; viewer?: PendingQueueViewer } = {},
) {
  const mode = opts.mode ?? "decide";
  return render(
    <PendingWorklist
      slug="alder-creek"
      actions={actions}
      mode={mode}
      viewer={opts.viewer ?? (mode === "decide" ? DECIDE : READ)}
      today={TODAY}
    />,
  );
}

afterEach(() => {
  cleanup();
  mockRefresh.mockClear();
  for (const m of [mockApprove, mockApproveMany, mockDeny, mockWithdraw]) m.mockReset();
  toastSuccess.mockClear();
  toastError.mockClear();
  toastWarning.mockClear();
});

describe("PendingWorklist — empty states", () => {
  it("decide mode: a designed empty state, not a blank screen", () => {
    renderList([]);
    expect(screen.getByText(/nothing waiting for your approval/i)).toBeTruthy();
    expect(screen.getByText(/proposed by the clerk or other administrators/i)).toBeTruthy();
  });

  it("read mode: its own empty copy", () => {
    renderList([], { mode: "read" });
    expect(screen.getByText("Nothing is waiting")).toBeTruthy();
    expect(screen.getByText(/member proposals you make appear here/i)).toBeTruthy();
  });
});

describe("PendingWorklist — badges", () => {
  it("shows 'You proposed this' only when proposedByIsViewer is true", () => {
    renderList([{ ...ACTION, proposedByIsViewer: true }]);
    expect(screen.getByText(/you proposed this/i)).toBeTruthy();
    cleanup();
    renderList([ACTION]);
    expect(screen.queryByText(/you proposed this/i)).toBeNull();
  });

  it("shows Connection ended, Recorded as deceased and Takes effect for a future date", () => {
    renderList([
      {
        ...ACTION,
        membershipEnded: true,
        personDeceased: true,
        effectiveDate: "2026-09-01",
      },
    ]);
    expect(screen.getByText("Connection ended")).toBeTruthy();
    expect(screen.getByText("Recorded as deceased")).toBeTruthy();
    expect(screen.getByText(/takes effect/i)).toBeTruthy();
  });

  it("no 'Takes effect' badge for a past or same-day row", () => {
    renderList([{ ...ACTION, effectiveDate: TODAY }]);
    expect(screen.queryByText(/takes effect/i)).toBeNull();
  });

  it("links the name to the edit page only for people.manage holders", () => {
    renderList([ACTION]);
    expect(
      screen.getByRole("link", { name: "Nora Ashgrove" }).getAttribute("href"),
    ).toBe("/o/alder-creek/admin/community/person-9/edit");
    cleanup();
    renderList([ACTION], { viewer: { ...DECIDE, canManagePeople: false } });
    expect(screen.queryByRole("link", { name: "Nora Ashgrove" })).toBeNull();
  });
});

describe("PendingWorklist — read mode", () => {
  it("shows no checkbox, Approve, Deny, select-all or bulk bar; Withdraw for a proposer", () => {
    renderList([ACTION, SECOND], { mode: "read" });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /^approve/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^deny/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /select all/i })).toBeNull();
    expect(screen.getAllByRole("button", { name: /withdraw proposal for/i })).toHaveLength(2);
  });
});

describe("PendingWorklist — selection and the bulk bar", () => {
  it("has no bar until something is selected, then 'Approve N selected'", () => {
    renderList([ACTION, SECOND]);
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /select nora/i }));
    expect(screen.getByRole("button", { name: "Approve 1 selected" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /select owen/i }));
    expect(screen.getByRole("button", { name: "Approve 2 selected" })).toBeTruthy();
  });

  it("select all picks every selectable row, and Clear selection undoes it", () => {
    renderList([ACTION, SECOND]);
    fireEvent.click(screen.getByRole("button", { name: /select all on this page/i }));
    expect(screen.getByRole("button", { name: "Approve 2 selected" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /clear selection/i }));
    expect(screen.queryByTestId("bulk-bar")).toBeNull();
  });

  it("a row approval would refuse (ended, deceased, non-approvable kind) is not selectable", () => {
    renderList([
      { ...ACTION, membershipEnded: true },
      { ...SECOND, personDeceased: true },
      { ...ACTION, id: "ra-3", personDisplayName: "Pia Vane", kind: "other_participant_enrolled" },
    ]);
    for (const box of screen.getAllByRole("checkbox")) {
      expect((box as HTMLInputElement).disabled).toBe(true);
    }
    expect(screen.queryByRole("button", { name: /select all on this page/i })).toBeNull();
  });

  it("each checkbox has a 44px label target", () => {
    renderList([ACTION]);
    const label = screen.getByRole("checkbox").closest("label");
    expect(label?.className).toMatch(/size-11/);
  });

  it("bulk approve submits the ids and the shared minute reference, then closes on full success", async () => {
    mockApproveMany.mockResolvedValue({
      ok: true,
      data: { approved: 2, failed: [], affectsFiledPeriod: false, shadowedCount: 0 },
    });
    renderList([ACTION, SECOND]);
    fireEvent.click(screen.getByRole("button", { name: /select all on this page/i }));
    fireEvent.click(screen.getByRole("button", { name: "Approve 2 selected" }));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Approve 2 roll actions?")).toBeTruthy();
    expect(
      within(dialog).getByText(/each one is approved and recorded separately/i),
    ).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/minute reference/i), {
      target: { value: "Minutes 6/15" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve 2" }));

    await waitFor(() =>
      expect(mockApproveMany).toHaveBeenCalledWith("alder-creek", {
        rollActionIds: ["ra-1", "ra-2"],
        minuteReference: "Minutes 6/15",
      }),
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("2 roll actions approved."),
    );
    expect(mockRefresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("a partial result keeps the dialog open and names each row that needs attention", async () => {
    mockApproveMany.mockResolvedValue({
      ok: true,
      data: {
        approved: 1,
        failed: [{ rollActionId: "ra-2", error: "Someone already decided this one. Refresh to see the current status." }],
        affectsFiledPeriod: true,
        shadowedCount: 1,
      },
    });
    renderList([ACTION, SECOND]);
    fireEvent.click(screen.getByRole("button", { name: /select all on this page/i }));
    fireEvent.click(screen.getByRole("button", { name: "Approve 2 selected" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Approve 2" }),
    );

    const panel = await screen.findByTestId("bulk-attention");
    expect(within(panel).getByText("Owen Pell")).toBeTruthy();
    expect(within(panel).getByText(/already decided this one/i)).toBeTruthy();
    expect(screen.getByText(/1 approved, 1 need attention/i)).toBeTruthy();
    expect(toastWarning).toHaveBeenCalledWith("1 approved, 1 need attention.");
    // The filed-period and shadowed warnings are separate warning toasts.
    expect(toastWarning).toHaveBeenCalledWith(
      expect.stringMatching(/year that has already been filed/i),
    );
    expect(toastWarning).toHaveBeenCalledWith(
      expect.stringMatching(/dated before a person's latest roll entry/i),
    );
  });

  it("the partial-result panel is the title plus each name and reason, with no instruction sentence", async () => {
    mockApproveMany.mockResolvedValue({
      ok: true,
      data: {
        approved: 1,
        failed: [{ rollActionId: "ra-2", error: "Someone already decided this one. Refresh to see the current status." }],
        affectsFiledPeriod: false,
        shadowedCount: 0,
      },
    });
    renderList([ACTION, SECOND]);
    fireEvent.click(screen.getByRole("button", { name: /select all on this page/i }));
    fireEvent.click(screen.getByRole("button", { name: "Approve 2 selected" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Approve 2" }),
    );
    const panel = await screen.findByTestId("bulk-attention");
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("1 approved, 1 need attention")).toBeTruthy();
    expect(panel.textContent).toBe(
      "Owen Pell: Someone already decided this one. Refresh to see the current status.",
    );
    expect(dialog.textContent).not.toMatch(/withdraw/i);
    expect(dialog.textContent).not.toMatch(/open each one/i);
  });

  it("a request-level refusal is an error toast and the dialog stays open", async () => {
    mockApproveMany.mockResolvedValue({
      ok: false,
      error: "You don't have permission to approve or deny roll actions here.",
    });
    renderList([ACTION]);
    fireEvent.click(screen.getByRole("checkbox", { name: /select nora/i }));
    fireEvent.click(screen.getByRole("button", { name: "Approve 1 selected" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Approve 1" }),
    );
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "You don't have permission to approve or deny roll actions here.",
      ),
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });
});

describe("PendingWorklist — approve", () => {
  it("opens an AlertDialog (not a native confirm) with an optional minute-reference field", () => {
    renderList([ACTION]);
    fireEvent.click(screen.getByRole("button", { name: /^approve nora/i }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByLabelText(/minute reference/i)).toBeTruthy();
  });

  it("submits with the minute reference and shows the success toast", async () => {
    mockApprove.mockResolvedValue({
      ok: true,
      data: {
        rollActionId: "ra-1",
        effectiveDate: "2026-06-01",
        futureDated: false,
        affectsFiledPeriod: false,
        shadowed: null,
        selfApproved: false,
      },
    });
    renderList([ACTION]);
    fireEvent.click(screen.getByRole("button", { name: /^approve nora/i }));
    fireEvent.change(screen.getByLabelText(/minute reference/i), {
      target: { value: "2026-06 §4" },
    });
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: /^approve$/i }),
    );

    await waitFor(() =>
      expect(mockApprove).toHaveBeenCalledWith("alder-creek", {
        rollActionId: "ra-1",
        minuteReference: "2026-06 §4",
      }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Nora Ashgrove's roll action approved.");
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("a future-dated approval says when it takes effect; shadowed and filed-period add warnings", async () => {
    mockApprove.mockResolvedValue({
      ok: true,
      data: {
        rollActionId: "ra-1",
        effectiveDate: "2026-09-01",
        futureDated: true,
        affectsFiledPeriod: true,
        shadowed: { kind: "opening_balance", effectiveDate: "2026-10-01" },
        selfApproved: false,
      },
    });
    renderList([ACTION]);
    fireEvent.click(screen.getByRole("button", { name: /^approve nora/i }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: /^approve$/i }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    // A node (the date is rendered through FormattedDate), not a string.
    expect(typeof toastSuccess.mock.calls[0]![0]).toBe("object");
    expect(toastWarning).toHaveBeenCalledWith(
      "Approved. Note: this is dated before Nora Ashgrove's latest roll entry, so it doesn't change their current status.",
    );
    expect(toastWarning).toHaveBeenCalledWith(
      expect.stringMatching(/year that has already been filed/i),
    );
  });

  it("a typed refusal is shown verbatim and the dialog stays open so the approver can deny instead", async () => {
    mockApprove.mockResolvedValue({
      ok: false,
      error: "This person is recorded as deceased. Deny this action or correct the record first.",
    });
    renderList([ACTION]);
    fireEvent.click(screen.getByRole("button", { name: /^approve nora/i }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: /^approve$/i }),
    );
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "This person is recorded as deceased. Deny this action or correct the record first.",
      ),
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

describe("PendingWorklist — deny", () => {
  it("cannot submit without a reason (never a native confirm)", () => {
    renderList([ACTION]);
    fireEvent.click(screen.getByRole("button", { name: /^deny nora/i }));
    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: /^deny$/i });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirm);
    expect(mockDeny).not.toHaveBeenCalled();
  });

  it("submits with the reason and shows the success toast", async () => {
    mockDeny.mockResolvedValue({ ok: true, data: { rollActionId: "ra-1" } });
    renderList([ACTION]);
    fireEvent.click(screen.getByRole("button", { name: /^deny nora/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: "Duplicate entry" },
    });
    expect(screen.getByText("15 / 500")).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: /^deny$/i }),
    );

    await waitFor(() =>
      expect(mockDeny).toHaveBeenCalledWith("alder-creek", {
        rollActionId: "ra-1",
        reason: "Duplicate entry",
      }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Nora Ashgrove's roll action denied.");
  });
});

describe("PendingWorklist — withdraw", () => {
  it("uses the Phase 3 copy and requires a reason", () => {
    renderList([ACTION], { mode: "read" });
    fireEvent.click(screen.getByRole("button", { name: /withdraw proposal for nora/i }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Withdraw this proposal?")).toBeTruthy();
    expect(
      within(dialog).getByText(/takes Nora Ashgrove out of the Session's queue/i),
    ).toBeTruthy();
    expect(
      within(dialog).getByLabelText("Reason (required, up to 500 characters)"),
    ).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Keep it" })).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: "Withdraw" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });

  it("submits the reason and shows the success toast", async () => {
    mockWithdraw.mockResolvedValue({ ok: true, data: { rollActionId: "ra-1" } });
    renderList([ACTION], { mode: "read" });
    fireEvent.click(screen.getByRole("button", { name: /withdraw proposal for nora/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: "Entered by mistake" },
    });
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Withdraw" }),
    );
    await waitFor(() =>
      expect(mockWithdraw).toHaveBeenCalledWith("alder-creek", {
        rollActionId: "ra-1",
        reason: "Entered by mistake",
      }),
    );
    expect(toastSuccess).toHaveBeenCalledWith(
      "Proposal withdrawn. Nora Ashgrove is no longer waiting for the Session.",
    );
  });

  it("an already-decided refusal is shown and the dialog stays open", async () => {
    mockWithdraw.mockResolvedValue({
      ok: false,
      error: "The Session already decided this one, so it can't be withdrawn. Refresh to see what happened.",
    });
    renderList([ACTION], { mode: "read" });
    fireEvent.click(screen.getByRole("button", { name: /withdraw proposal for nora/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "x" } });
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Withdraw" }),
    );
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        expect.stringMatching(/already decided this one/i),
      ),
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("a decide-mode viewer who also proposes sees Approve, Deny and Withdraw", () => {
    renderList([ACTION], { viewer: { ...DECIDE, canPropose: true } });
    expect(screen.getByRole("button", { name: /^approve nora/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^deny nora/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /withdraw proposal for nora/i })).toBeTruthy();
  });
});
