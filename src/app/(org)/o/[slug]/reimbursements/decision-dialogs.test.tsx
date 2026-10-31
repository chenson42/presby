// @vitest-environment jsdom
/** Approve, Send back and Withdraw (Copy C6, amendment T3): the dialogs, the revision they carry, and each refusal. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const refresh = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const approve = vi.hoisted(() => vi.fn());
const returnReq = vi.hoisted(() => vi.fn());
const withdraw = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  approveRequestAction: (...a: unknown[]) => approve(...a),
  returnRequestAction: (...a: unknown[]) => returnReq(...a),
  withdrawRequestAction: (...a: unknown[]) => withdraw(...a),
}));

import { COPY } from "@/lib/reimbursement/copy";
import { DecisionPanel } from "./decision-panel";
import { WithdrawDialog } from "./withdraw-dialog";

const REQ = "44444444-4444-4444-8444-444444444444";
const panel = () => (
  <DecisionPanel slug="alder" requestId={REQ} revision={7} amount="$42.50" payee="Tamsin Brightwater" group="Property Committee" />
);

beforeEach(() => {
  for (const m of [refresh, push, approve, returnReq, withdraw, toast.success, toast.error]) m.mockReset();
});
afterEach(cleanup);

describe("DecisionPanel - Approve", () => {
  it("states the amount, payee and group, and approves on the revision the page displayed", async () => {
    approve.mockResolvedValue({ ok: true, data: { message: "Approved." } });
    render(panel());
    fireEvent.click(screen.getByTestId("approve-open"));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(COPY.decision.approveTitle)).toBeTruthy();
    expect(dialog.textContent).toContain("$42.50 to Tamsin Brightwater, charged to Property Committee. Once approved it goes to the treasurer for payment.");
    fireEvent.click(screen.getByTestId("approve-confirm"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Approved."));
    expect(approve).toHaveBeenCalledWith("alder", { requestId: REQ, expectedRevision: 7 });
    expect(refresh).toHaveBeenCalled();
  });

  it("Cancel approves nothing", () => {
    render(panel());
    fireEvent.click(screen.getByTestId("approve-open"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(approve).not.toHaveBeenCalled();
  });

  it.each([
    ["changed_since_viewed", COPY.decision.changedAfterOpened],
    ["already_decided", "This was already approved on October 25, 2026."],
    ["not_found", COPY.decision.unavailable],
  ])("%s: toasts the Copy sentence, closes and re-reads the page", async (kind, error) => {
    approve.mockResolvedValue({ ok: false, error, kind });
    render(panel());
    fireEvent.click(screen.getByTestId("approve-open"));
    fireEvent.click(screen.getByTestId("approve-confirm"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(error));
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("a thrown call is the save-failed sentence and the dialog stays for a retry", async () => {
    approve.mockRejectedValue(new Error("x"));
    render(panel());
    fireEvent.click(screen.getByTestId("approve-open"));
    fireEvent.click(screen.getByTestId("approve-confirm"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(COPY.form.saveFailed));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("a double tap is one approval", async () => {
    let done!: (v: unknown) => void;
    approve.mockReturnValue(new Promise((r) => (done = r)));
    render(panel());
    fireEvent.click(screen.getByTestId("approve-open"));
    const confirm = screen.getByTestId("approve-confirm");
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(approve).toHaveBeenCalledTimes(1);
    done({ ok: true, data: { message: "Approved." } });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe("DecisionPanel - Send back", () => {
  const open = () => {
    fireEvent.click(screen.getByTestId("send-back-open"));
    return screen.getByRole("dialog");
  };

  it("is a form under a HydrationGate, with both kinds and their hints", () => {
    render(panel());
    const dialog = open();
    expect(dialog.querySelector('fieldset[data-slot="hydration-gate"]')).toBeTruthy();
    expect(within(dialog).getByText(COPY.decision.needsChangesHint)).toBeTruthy();
    expect(within(dialog).getByText(COPY.decision.notApprovedHint)).toBeTruthy();
    expect((within(dialog).getByRole("radio", { name: /Needs changes/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("a missing reason is 'Give a reason.' and calls nothing; a long one is a named error", async () => {
    render(panel());
    const dialog = open();
    fireEvent.click(within(dialog).getByTestId("send-back-confirm"));
    await waitFor(() => expect(within(dialog).getByText(COPY.decision.reasonRequired)).toBeTruthy());
    fireEvent.change(within(dialog).getByLabelText(COPY.decision.reasonLabel), { target: { value: "x".repeat(301) } });
    fireEvent.click(within(dialog).getByTestId("send-back-confirm"));
    await waitFor(() => expect(within(dialog).getByText(COPY.fieldErrors.tooLong(300))).toBeTruthy());
    expect(returnReq).not.toHaveBeenCalled();
  });

  it("posts the kind and reason on the displayed revision", async () => {
    returnReq.mockResolvedValue({ ok: true, data: { message: "Marked not approved." } });
    render(panel());
    const dialog = open();
    fireEvent.click(within(dialog).getByRole("radio", { name: /Not approved/ }));
    fireEvent.change(within(dialog).getByLabelText(COPY.decision.reasonLabel), { target: { value: "Over budget" } });
    fireEvent.click(within(dialog).getByTestId("send-back-confirm"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Marked not approved."));
    expect(returnReq).toHaveBeenCalledWith("alder", { requestId: REQ, expectedRevision: 7, kind: "not_approved", reason: "Over budget" });
    expect(refresh).toHaveBeenCalled();
  });

  it("a refused call keeps the reason in the box", async () => {
    returnReq.mockResolvedValue({ ok: false, error: COPY.form.saveFailed });
    render(panel());
    const dialog = open();
    fireEvent.change(within(dialog).getByLabelText(COPY.decision.reasonLabel), { target: { value: "Keep me" } });
    fireEvent.click(within(dialog).getByTestId("send-back-confirm"));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toBe(COPY.form.saveFailed));
    expect((within(dialog).getByLabelText(COPY.decision.reasonLabel) as HTMLTextAreaElement).value).toBe("Keep me");
  });

  it("a request that changed closes the dialog, toasts, and re-reads", async () => {
    returnReq.mockResolvedValue({ ok: false, error: COPY.decision.changedAfterOpened, kind: "changed_since_viewed" });
    render(panel());
    const dialog = open();
    fireEvent.change(within(dialog).getByLabelText(COPY.decision.reasonLabel), { target: { value: "r" } });
    fireEvent.click(within(dialog).getByTestId("send-back-confirm"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(COPY.decision.changedAfterOpened));
    expect(refresh).toHaveBeenCalled();
  });
});

describe("WithdrawDialog (amendment T3: no reason field)", () => {
  const start = () => {
    render(<WithdrawDialog slug="alder" requestId={REQ} />);
    fireEvent.click(screen.getByTestId("withdraw-open"));
    return screen.getByRole("alertdialog");
  };

  it("asks in Copy's words, has no text field, and keeps the request on 'Keep it'", () => {
    const dialog = start();
    expect(within(dialog).getByText(COPY.decision.withdrawTitle)).toBeTruthy();
    expect(within(dialog).getByText(COPY.decision.withdrawBody)).toBeTruthy();
    expect(dialog.querySelector("textarea, input")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: COPY.decision.withdrawKeep }));
    expect(withdraw).not.toHaveBeenCalled();
  });

  it("posts only the request id and toasts 'Request withdrawn.'", async () => {
    withdraw.mockResolvedValue({ ok: true, data: undefined });
    start();
    fireEvent.click(screen.getByTestId("withdraw-confirm"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Request withdrawn."));
    expect(withdraw).toHaveBeenCalledWith("alder", { requestId: REQ });
    expect(refresh).toHaveBeenCalled();
  });

  it("a request already paid says so and is not reported as withdrawn", async () => {
    withdraw.mockResolvedValue({ ok: false, error: COPY.decision.withdrawAlreadyPaid });
    start();
    fireEvent.click(screen.getByTestId("withdraw-confirm"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(COPY.decision.withdrawAlreadyPaid));
    expect(toast.success).not.toHaveBeenCalled();
  });
});
