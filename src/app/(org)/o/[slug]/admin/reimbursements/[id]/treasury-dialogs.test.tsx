// @vitest-environment jsdom
/**
 * The treasurer's forms and dialogs (Copy C8, the Batch 4 amendment S1 to S4 and
 * X3, the Batch 4 contract): Record payment, the five text verbs, and the override
 * approval. What is pinned: the HydrationGate roots (DECISION-159), what each call
 * posts (the slug first, the revision the page displayed, no kind on a send back),
 * every field message in Copy's words, the entry staying through any failure,
 * the double tap, the X3 link (a leading space, only for `suggestTeam`), and no
 * native dialog.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const refresh = vi.hoisted(() => vi.fn());
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh, replace: vi.fn() }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const actions = vi.hoisted(() => ({
  recordPaymentAction: vi.fn(),
  reversePaymentAction: vi.fn(),
  waiveReceiptAction: vi.fn(),
  treasuryReturnAction: vi.fn(),
  voidAction: vi.fn(),
  overrideApproveAction: vi.fn(),
  addNoteAction: vi.fn(),
}));
vi.mock("../actions", () => actions);

import { COPY } from "@/lib/reimbursement/copy";
import { PaymentForm } from "./payment-form";
import { TreasuryVerbs } from "./treasury-verbs";
import type { TreasuryUi } from "./treasury-ui";

const REQ = "44444444-4444-4444-8444-444444444444";
const NONE: TreasuryUi = { payment: { kind: "none" }, reverse: false, waive: false, sendBack: null, void: false, override: false, note: false };
const verbs = (ui: Partial<TreasuryUi>) => (
  <TreasuryVerbs slug="alder" requestId={REQ} revision={7} group="Property Committee" ui={{ ...NONE, ...ui }} />
);
const pay = (over: Partial<React.ComponentProps<typeof PaymentForm>> = {}) => (
  <PaymentForm slug="alder" requestId={REQ} orgToday="2026-10-26" expenseDate="2026-10-20" {...over} />
);
const ok = (message: string) => ({ ok: true, data: { message } });

let alertSpy: ReturnType<typeof vi.spyOn>;
let confirmSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  for (const m of [refresh, push, toast.success, toast.error, ...Object.values(actions)]) m.mockReset();
  alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
  confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);
});
afterEach(() => {
  cleanup();
  expect(alertSpy).not.toHaveBeenCalled();
  expect(confirmSpy).not.toHaveBeenCalled();
  alertSpy.mockRestore();
  confirmSpy.mockRestore();
});

describe("PaymentForm - Record payment", () => {
  it("is rooted in a HydrationGate", () => {
    const { container } = render(pay());
    expect(container.querySelector('fieldset[data-slot="hydration-gate"]')).toBeTruthy();
  });

  it("has Copy's labels, the hint, and today as the default date", () => {
    render(pay());
    expect((screen.getByLabelText(COPY.treasury.paymentForm.methodLabel) as HTMLSelectElement).value).toBe("check");
    expect([...(screen.getByLabelText(COPY.treasury.paymentForm.methodLabel) as HTMLSelectElement).options].map((o) => o.textContent)).toEqual([
      "Check", "ACH", "Cash", "Other",
    ]);
    expect(screen.getByLabelText(COPY.treasury.paymentForm.checkNumber)).toBeTruthy();
    expect((screen.getByLabelText(COPY.treasury.paymentForm.datePaid) as HTMLInputElement).value).toBe("2026-10-26");
    expect(screen.getByLabelText(COPY.treasury.paymentForm.note)).toBeTruthy();
    expect(screen.getByText(COPY.treasury.paymentForm.hint)).toBeTruthy();
    expect(screen.getByRole("button", { name: COPY.treasury.paymentForm.submit })).toBeTruthy();
  });

  it("the reference box is 'Check number' for a check and 'Reference (optional)' for the others", () => {
    render(pay());
    fireEvent.change(screen.getByLabelText(COPY.treasury.paymentForm.methodLabel), { target: { value: "ach" } });
    expect(screen.queryByLabelText(COPY.treasury.paymentForm.checkNumber)).toBeNull();
    expect(screen.getByLabelText(COPY.treasury.paymentForm.reference)).toBeTruthy();
  });

  it("a check without a number is refused before the call, in Copy's words, and nothing is sent", () => {
    render(pay());
    fireEvent.click(screen.getByTestId("payment-submit"));
    expect(screen.getByText(COPY.treasury.results.checkNumberRequired)).toBeTruthy();
    expect(actions.recordPaymentAction).not.toHaveBeenCalled();
  });

  it.each([
    ["after today", "2026-10-27"],
    ["before the expense", "2026-10-19"],
    ["empty", ""],
  ])("a date %s is refused with the one range sentence", (_name, date) => {
    render(pay());
    fireEvent.change(screen.getByLabelText(COPY.treasury.paymentForm.checkNumber), { target: { value: "1001" } });
    fireEvent.change(screen.getByLabelText(COPY.treasury.paymentForm.datePaid), { target: { value: date } });
    fireEvent.click(screen.getByTestId("payment-submit"));
    expect(screen.getByText(COPY.treasury.results.dateOutOfRange)).toBeTruthy();
    expect(actions.recordPaymentAction).not.toHaveBeenCalled();
  });

  it("posts the slug first and only the request, method, reference, date and note - never a payer or a self-paid flag", async () => {
    actions.recordPaymentAction.mockResolvedValue({ ok: true, data: { message: "Payment recorded.", selfPaid: false } });
    render(pay());
    fireEvent.change(screen.getByLabelText(COPY.treasury.paymentForm.checkNumber), { target: { value: " 1001 " } });
    fireEvent.change(screen.getByLabelText(COPY.treasury.paymentForm.datePaid), { target: { value: "2026-10-25" } });
    fireEvent.change(screen.getByLabelText(COPY.treasury.paymentForm.note), { target: { value: "Mailed" } });
    fireEvent.click(screen.getByTestId("payment-submit"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Payment recorded."));
    expect(actions.recordPaymentAction).toHaveBeenCalledWith("alder", {
      requestId: REQ, method: "check", reference: " 1001 ", paidOn: "2026-10-25", note: "Mailed",
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("a refusal with no field (the approver, the receipt) is a banner above the form, and what was typed stays", async () => {
    actions.recordPaymentAction.mockResolvedValue({ ok: false, error: COPY.treasury.blocks.approverCannotPay });
    render(pay());
    fireEvent.change(screen.getByLabelText(COPY.treasury.paymentForm.checkNumber), { target: { value: "1001" } });
    fireEvent.click(screen.getByTestId("payment-submit"));
    expect((await screen.findByTestId("payment-form-banner")).textContent).toBe(COPY.treasury.blocks.approverCannotPay);
    expect((screen.getByLabelText(COPY.treasury.paymentForm.checkNumber) as HTMLInputElement).value).toBe("1001");
  });

  it("a server field error lands beside its field", async () => {
    actions.recordPaymentAction.mockResolvedValue({
      ok: false, error: COPY.treasury.results.dateOutOfRange, fieldErrors: { paidOn: COPY.treasury.results.dateOutOfRange },
    });
    render(pay());
    fireEvent.change(screen.getByLabelText(COPY.treasury.paymentForm.checkNumber), { target: { value: "1001" } });
    fireEvent.click(screen.getByTestId("payment-submit"));
    const field = screen.getByLabelText(COPY.treasury.paymentForm.datePaid);
    await waitFor(() => expect(field.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.queryByTestId("payment-form-banner")).toBeNull();
  });

  it("a thrown call is the save-failed sentence, and the entries stay", async () => {
    actions.recordPaymentAction.mockRejectedValue(new Error("x"));
    render(pay());
    fireEvent.change(screen.getByLabelText(COPY.treasury.paymentForm.checkNumber), { target: { value: "1001" } });
    fireEvent.click(screen.getByTestId("payment-submit"));
    expect((await screen.findByTestId("payment-form-banner")).textContent).toBe(COPY.form.saveFailed);
    expect((screen.getByLabelText(COPY.treasury.paymentForm.checkNumber) as HTMLInputElement).value).toBe("1001");
  });

  it("a double tap is one payment", async () => {
    let done!: (v: unknown) => void;
    actions.recordPaymentAction.mockReturnValue(new Promise((r) => (done = r)));
    render(pay());
    fireEvent.change(screen.getByLabelText(COPY.treasury.paymentForm.checkNumber), { target: { value: "1001" } });
    fireEvent.click(screen.getByTestId("payment-submit"));
    fireEvent.click(screen.getByTestId("payment-submit"));
    expect(actions.recordPaymentAction).toHaveBeenCalledTimes(1);
    done({ ok: true, data: { message: "Payment recorded.", selfPaid: false } });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("a stale 2FA claim goes to the challenge", async () => {
    actions.recordPaymentAction.mockResolvedValue({ ok: false, error: "x", kind: "two_factor_required", redirectTo: "/totp?callbackUrl=%2Fo%2Falder" });
    render(pay());
    fireEvent.change(screen.getByLabelText(COPY.treasury.paymentForm.checkNumber), { target: { value: "1001" } });
    fireEvent.click(screen.getByTestId("payment-submit"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/totp?callbackUrl=%2Fo%2Falder"));
  });
});

describe("TreasuryVerbs - which buttons", () => {
  it("renders exactly the verbs the page decided on, with Copy's labels", () => {
    render(verbs({ reverse: true, waive: true, sendBack: "approved", void: true, override: true, note: true }));
    const labels = within(screen.getByTestId("treasury-verbs")).getAllByRole("button").map((b) => b.textContent);
    expect(labels).toEqual([
      COPY.treasury.buttons.approveAsTreasurer,
      COPY.treasury.buttons.reversePayment,
      COPY.treasury.buttons.waiveReceipt,
      COPY.treasury.buttons.sendBack,
      COPY.treasury.buttons.void,
      COPY.treasury.buttons.addNote,
    ]);
    cleanup();
    render(verbs({}));
    expect(within(screen.getByTestId("treasury-verbs")).queryAllByRole("button")).toHaveLength(0);
  });
});

describe("Send back to requester (amendment S4)", () => {
  it("has NO radio - 'Needs changes' and 'Not approved' do not appear - and the body is the submitted one", () => {
    render(verbs({ sendBack: "submitted" }));
    fireEvent.click(screen.getByTestId("treasury-send-back-open"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(COPY.treasury.sendBack.title)).toBeTruthy();
    expect(dialog.textContent).toContain(COPY.treasury.sendBack.body);
    expect(dialog.textContent).not.toContain(COPY.treasury.sendBack.bodyApproved);
    expect(within(dialog).queryAllByRole("radio")).toHaveLength(0);
    expect(dialog.textContent).not.toContain("Needs changes");
    expect(dialog.textContent).not.toContain("Not approved");
    expect(within(dialog).getByLabelText(COPY.decision.reasonLabel)).toBeTruthy();
  });

  it("an approved request gets the body that says it will need approval again", () => {
    render(verbs({ sendBack: "approved" }));
    fireEvent.click(screen.getByTestId("treasury-send-back-open"));
    expect(screen.getByRole("dialog").textContent).toContain(COPY.treasury.sendBack.bodyApproved);
  });

  it("requires a reason, then posts the slug, the request, the displayed revision and the reason - no kind", async () => {
    actions.treasuryReturnAction.mockResolvedValue(ok("Sent back."));
    render(verbs({ sendBack: "approved" }));
    fireEvent.click(screen.getByTestId("treasury-send-back-open"));
    fireEvent.click(screen.getByTestId("treasury-send-back-confirm"));
    expect(screen.getByText(COPY.treasury.results.reasonRequired)).toBeTruthy();
    expect(actions.treasuryReturnAction).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(COPY.decision.reasonLabel), { target: { value: "  Wrong amount  " } });
    fireEvent.click(screen.getByTestId("treasury-send-back-confirm"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Sent back."));
    expect(actions.treasuryReturnAction).toHaveBeenCalledWith("alder", { requestId: REQ, expectedRevision: 7, reason: "  Wrong amount  " });
    expect(refresh).toHaveBeenCalled();
  });

  it.each([
    ["changed_since_viewed", COPY.decision.changedAfterOpened],
    ["already_decided", "This was already approved on October 25, 2026."],
    ["not_found", COPY.decision.unavailable],
  ])("%s: toasts the Copy sentence, closes and re-reads the page", async (kind, error) => {
    actions.treasuryReturnAction.mockResolvedValue({ ok: false, error, kind });
    render(verbs({ sendBack: "approved" }));
    fireEvent.click(screen.getByTestId("treasury-send-back-open"));
    fireEvent.change(screen.getByLabelText(COPY.decision.reasonLabel), { target: { value: "Wrong" } });
    fireEvent.click(screen.getByTestId("treasury-send-back-confirm"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(error));
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("any other refusal stays INSIDE the dialog with the reason still in the box", async () => {
    actions.treasuryReturnAction.mockResolvedValue({ ok: false, error: COPY.treasury.refusals.notReturnable });
    render(verbs({ sendBack: "approved" }));
    fireEvent.click(screen.getByTestId("treasury-send-back-open"));
    fireEvent.change(screen.getByLabelText(COPY.decision.reasonLabel), { target: { value: "Wrong" } });
    fireEvent.click(screen.getByTestId("treasury-send-back-confirm"));
    expect((await screen.findByTestId("treasury-send-back-banner")).textContent).toBe(COPY.treasury.refusals.notReturnable);
    expect((screen.getByLabelText(COPY.decision.reasonLabel) as HTMLTextAreaElement).value).toBe("Wrong");
  });

  it("a reason over 300 characters is a named field error, never a truncation", () => {
    render(verbs({ sendBack: "approved" }));
    fireEvent.click(screen.getByTestId("treasury-send-back-open"));
    fireEvent.change(screen.getByLabelText(COPY.decision.reasonLabel), { target: { value: "x".repeat(301) } });
    fireEvent.click(screen.getByTestId("treasury-send-back-confirm"));
    expect(screen.getByText(COPY.fieldErrors.tooLong(300))).toBeTruthy();
    expect(actions.treasuryReturnAction).not.toHaveBeenCalled();
  });
});

describe("Reverse, Void, Waive and Add a note", () => {
  it("Reverse: the title, the body, a required Reason, and the post", async () => {
    actions.reversePaymentAction.mockResolvedValue(ok("Payment reversed."));
    render(verbs({ reverse: true }));
    fireEvent.click(screen.getByTestId("reverse-open"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(COPY.treasury.reverse.title)).toBeTruthy();
    expect(dialog.textContent).toContain(COPY.treasury.reverse.body);
    fireEvent.click(screen.getByTestId("reverse-confirm"));
    expect(screen.getByText(COPY.treasury.results.reasonRequired)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(COPY.treasury.reverse.reason), { target: { value: "Wrong check" } });
    fireEvent.click(screen.getByTestId("reverse-confirm"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Payment reversed."));
    expect(actions.reversePaymentAction).toHaveBeenCalledWith("alder", { requestId: REQ, reason: "Wrong check" });
  });

  it("Void: the title, the body, a required Reason, and the post", async () => {
    actions.voidAction.mockResolvedValue(ok("Request voided."));
    render(verbs({ void: true }));
    fireEvent.click(screen.getByTestId("void-open"));
    expect(screen.getByRole("dialog").textContent).toContain(COPY.treasury.void.body);
    fireEvent.change(screen.getByLabelText(COPY.treasury.void.reason), { target: { value: "Duplicate" } });
    fireEvent.click(screen.getByTestId("void-confirm"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Request voided."));
    expect(actions.voidAction).toHaveBeenCalledWith("alder", { requestId: REQ, reason: "Duplicate" });
  });

  it("Waive: the note is OPTIONAL, so an empty note posts; a refusal names the cause in Copy's words", async () => {
    actions.waiveReceiptAction.mockResolvedValueOnce({ ok: false, error: COPY.treasury.refusals.receiptPresent });
    render(verbs({ waive: true }));
    fireEvent.click(screen.getByTestId("waive-open"));
    expect(screen.getByRole("dialog").textContent).toContain(COPY.treasury.waive.body);
    fireEvent.click(screen.getByTestId("waive-confirm"));
    expect((await screen.findByTestId("waive-banner")).textContent).toBe(COPY.treasury.refusals.receiptPresent);
    expect(actions.waiveReceiptAction).toHaveBeenCalledWith("alder", { requestId: REQ, note: "" });
    actions.waiveReceiptAction.mockResolvedValueOnce(ok("Receipt waived."));
    fireEvent.click(screen.getByTestId("waive-confirm"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Receipt waived."));
  });

  it("Add a note: a required Note with the internal-only hint, and 'Write a note.' for an empty one", async () => {
    actions.addNoteAction.mockResolvedValue(ok("Note added."));
    render(verbs({ note: true }));
    fireEvent.click(screen.getByTestId("note-open"));
    expect(screen.getByText(COPY.treasury.note.hint)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(COPY.treasury.note.field), { target: { value: "   " } });
    fireEvent.click(screen.getByTestId("note-confirm"));
    expect(screen.getByText(COPY.treasury.results.noteRequired)).toBeTruthy();
    expect(actions.addNoteAction).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(COPY.treasury.note.field), { target: { value: "Called the vendor." } });
    fireEvent.click(screen.getByTestId("note-confirm"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Note added."));
    expect(actions.addNoteAction).toHaveBeenCalledWith("alder", { requestId: REQ, note: "Called the vendor." });
  });

  it("a server field message lands under the box and the text stays", async () => {
    actions.voidAction.mockResolvedValue({ ok: false, error: "x", fieldErrors: { reason: COPY.treasury.results.reasonRequired } });
    render(verbs({ void: true }));
    fireEvent.click(screen.getByTestId("void-open"));
    fireEvent.change(screen.getByLabelText(COPY.treasury.void.reason), { target: { value: "Duplicate" } });
    fireEvent.click(screen.getByTestId("void-confirm"));
    expect(await screen.findByText(COPY.treasury.results.reasonRequired)).toBeTruthy();
    expect((screen.getByLabelText(COPY.treasury.void.reason) as HTMLTextAreaElement).value).toBe("Duplicate");
  });

  it("every dialog form is rooted in a HydrationGate", () => {
    render(verbs({ reverse: true, void: true }));
    fireEvent.click(screen.getByTestId("void-open"));
    expect(screen.getByTestId("void-form").closest('fieldset[data-slot="hydration-gate"]')).toBeTruthy();
  });

  it("Cancel posts nothing", () => {
    render(verbs({ void: true }));
    fireEvent.click(screen.getByTestId("void-open"));
    fireEvent.click(screen.getByRole("button", { name: COPY.decision.cancel }));
    expect(actions.voidAction).not.toHaveBeenCalled();
  });
});

describe("Approve as treasurer (override, X3)", () => {
  const open = () => {
    render(verbs({ override: true }));
    fireEvent.click(screen.getByTestId("override-open"));
  };

  it("names the group and says a different payer must pay", () => {
    open();
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(COPY.treasury.override.title)).toBeTruthy();
    expect(dialog.textContent).toContain(COPY.treasury.override.body("Property Committee"));
  });

  it("approves on the revision the page displayed", async () => {
    actions.overrideApproveAction.mockResolvedValue(ok("Approved."));
    open();
    fireEvent.click(screen.getByTestId("override-confirm"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Approved."));
    expect(actions.overrideApproveAction).toHaveBeenCalledWith("alder", { requestId: REQ, expectedRevision: 7 });
    expect(refresh).toHaveBeenCalled();
  });

  it("needs_second_payer for a manager: the sentence, then a REAL space, then the link to the Treasury team (X3)", async () => {
    actions.overrideApproveAction.mockResolvedValue({ ok: false, error: COPY.treasury.override.needsSecondPayer, suggestTeam: true });
    open();
    fireEvent.click(screen.getByTestId("override-confirm"));
    const refusal = await screen.findByTestId("override-refusal");
    expect(refusal.textContent).toBe(`${COPY.treasury.override.needsSecondPayer} Add one under Treasury team.`);
    const link = screen.getByTestId("override-team-link");
    expect(link.textContent).toBe("Add one under Treasury team.");
    expect(link.getAttribute("href")).toBe("/o/alder/admin/reimbursements/team");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a pay-only viewer (no suggestTeam) gets the sentence and no link", async () => {
    actions.overrideApproveAction.mockResolvedValue({ ok: false, error: COPY.treasury.override.needsSecondPayer });
    open();
    fireEvent.click(screen.getByTestId("override-confirm"));
    expect((await screen.findByTestId("override-refusal")).textContent).toBe(COPY.treasury.override.needsSecondPayer);
    expect(screen.queryByTestId("override-team-link")).toBeNull();
  });

  it("seat_holder_exists stays in the dialog; a stale revision closes and re-reads", async () => {
    actions.overrideApproveAction.mockResolvedValueOnce({ ok: false, error: COPY.treasury.override.seatHolderExists("Property Committee") });
    open();
    fireEvent.click(screen.getByTestId("override-confirm"));
    expect((await screen.findByTestId("override-refusal")).textContent).toBe("Someone in Property Committee can approve this, so it needs their approval.");
    actions.overrideApproveAction.mockResolvedValueOnce({ ok: false, error: COPY.decision.changedAfterOpened, kind: "changed_since_viewed" });
    fireEvent.click(screen.getByTestId("override-confirm"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(COPY.decision.changedAfterOpened));
    expect(refresh).toHaveBeenCalled();
  });

  it("a double tap is one approval", async () => {
    let done!: (v: unknown) => void;
    actions.overrideApproveAction.mockReturnValue(new Promise((r) => (done = r)));
    open();
    fireEvent.click(screen.getByTestId("override-confirm"));
    fireEvent.click(screen.getByTestId("override-confirm"));
    expect(actions.overrideApproveAction).toHaveBeenCalledTimes(1);
    done(ok("Approved."));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });
});
