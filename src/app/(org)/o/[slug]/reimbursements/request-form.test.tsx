// @vitest-environment jsdom
/**
 * The request form (docs/work-log/2026-10-25-treasury-inc1.md, Batch 5; Copy C3
 * and the Batch 2a amendment T3). Pins the promise in Copy - "Your entries are
 * still here" - for every way a save can fail, the one-request-per-form
 * idempotency, Enter never sending, the HydrationGate root, the receipt slot
 * being absent until Batch 2b, and what Send posts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const push = vi.hoisted(() => vi.fn());
const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace, refresh: vi.fn() }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const saveRequestAction = vi.hoisted(() => vi.fn());
const submitRequestAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  saveRequestAction: (...a: unknown[]) => saveRequestAction(...a),
  submitRequestAction: (...a: unknown[]) => submitRequestAction(...a),
  searchBeneficiariesAction: vi.fn().mockResolvedValue({ ok: true, data: { candidates: [] } }),
}));

import { COPY } from "@/lib/reimbursement/copy";
import { RequestForm, type RequestFormProps } from "./request-form";
import { emptyFormValues } from "./request-form-model";

const G1 = "11111111-1111-4111-8111-111111111111";
const G2 = "33333333-3333-4333-8333-333333333333";
const C1 = "22222222-2222-4222-8222-222222222222";
const REQ = "44444444-4444-4444-8444-444444444444";

function props(over: Partial<RequestFormProps> = {}): RequestFormProps {
  return {
    slug: "alder",
    initialClientKey: "client-key-0001",
    orgToday: "2026-10-26",
    groups: [{ id: G1, name: "Property Committee" }, { id: G2, name: "Worship Committee" }],
    categories: [{ id: C1, name: "Supplies" }],
    canRequestForOthers: false,
    initialValues: emptyFormValues(),
    ...over,
  };
}

const field = (label: string | RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const send = () => screen.getByTestId("request-send") as HTMLButtonElement;
const draft = () => screen.getByTestId("request-save-draft") as HTMLButtonElement;

function fillAll() {
  fireEvent.change(field("Charge to"), { target: { value: G1 } });
  fireEvent.change(field("Category"), { target: { value: C1 } });
  fireEvent.change(field("Amount"), { target: { value: "4250" } });
  fireEvent.change(field("Date of the expense"), { target: { value: "2026-10-20" } });
  fireEvent.change(field("What was it for?"), { target: { value: "Folding tables" } });
  fireEvent.click(field("I can't attach a receipt"));
}

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  saveRequestAction.mockReset();
  submitRequestAction.mockReset();
});
afterEach(cleanup);

describe("RequestForm - structure", () => {
  it("is rooted in a HydrationGate", () => {
    const { container } = render(<RequestForm {...props()} />);
    expect(container.querySelector('fieldset[data-slot="hydration-gate"]')).toBeTruthy();
  });

  it("offers 'Pay someone else back' only to a holder of request_for_others", () => {
    render(<RequestForm {...props()} />);
    expect(screen.queryByRole("radio", { name: "Pay someone else back" })).toBeNull();
    cleanup();
    render(<RequestForm {...props({ canRequestForOthers: true })} />);
    expect(screen.getByRole("radio", { name: "Pay someone else back" })).toBeTruthy();
  });

  it("with no chargeable group, says so in place of the Charge to select and keeps Send disabled (orchestrator ruling on Batch 5)", () => {
    render(<RequestForm {...props({ groups: [] })} />);
    expect(screen.queryByLabelText("Charge to")).toBeNull();
    expect(screen.getByTestId("no-chargeable-group").textContent).toBe(
      "No groups can be charged yet. Ask your treasurer to set them up.",
    );
    expect(send().disabled).toBe(true);
    // A draft can still be saved: the sentence blocks Send, not the member's work.
    expect(draft().disabled).toBe(false);
  });

  it("asks for a category only when the organization has one", () => {
    render(<RequestForm {...props({ categories: [] })} />);
    expect(screen.queryByLabelText("Category")).toBeNull();
  });

  it("has the receipts label and the box, but no picker until Batch 2b", () => {
    render(<RequestForm {...props()} />);
    expect(screen.getByText(COPY.form.receiptsLabel)).toBeTruthy();
    expect(screen.getByLabelText(COPY.form.noReceiptLabel)).toBeTruthy();
    expect(screen.getByText(COPY.form.noReceiptHint)).toBeTruthy();
    expect(screen.queryByText(COPY.form.addReceipt)).toBeNull();
    expect(screen.queryByText(COPY.form.receiptsHint)).toBeNull();
  });

  it("has no submit button: Enter in a text box can never send a request", () => {
    const { container } = render(<RequestForm {...props()} />);
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    expect(container.querySelector('input[capture], input[type="file"]')).toBeNull();
    fireEvent.submit(screen.getByTestId("request-form"));
    expect(saveRequestAction).not.toHaveBeenCalled();
  });
});

describe("RequestForm - a failed save keeps everything (regression for 'entries lost on failure')", () => {
  it("a thrown call (database or network) shows the Copy sentence and every entry is still there", async () => {
    saveRequestAction.mockRejectedValue(new Error("network"));
    render(<RequestForm {...props()} />);
    fillAll();
    fireEvent.click(send());
    await waitFor(() => expect(screen.getByTestId("request-form-banner").textContent).toBe(COPY.form.saveFailed));
    expect(field("Amount").value).toBe("$42.50");
    expect(field("What was it for?").value).toBe("Folding tables");
    expect(field("Charge to").value).toBe(G1);
    expect(field("Category").value).toBe(C1);
    expect(field("Date of the expense").value).toBe("2026-10-20");
    expect((field("I can't attach a receipt") as HTMLInputElement).checked).toBe(true);
    expect(submitRequestAction).not.toHaveBeenCalled();
    expect(send().disabled).toBe(false);
  });

  it("a refused field shows next to the field, with every entry kept", async () => {
    saveRequestAction.mockResolvedValue({
      ok: false,
      error: COPY.fieldErrors.date,
      fieldErrors: { expenseDate: COPY.fieldErrors.date },
    });
    render(<RequestForm {...props()} />);
    fillAll();
    fireEvent.click(draft());
    await waitFor(() => expect(screen.getByText(COPY.fieldErrors.date)).toBeTruthy());
    expect(field("Amount").value).toBe("$42.50");
    expect(field("What was it for?").value).toBe("Folding tables");
    expect(toast.success).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("a stale revision and a draft limit are banners, not resets", async () => {
    saveRequestAction.mockResolvedValue({ ok: false, error: COPY.form.changedInAnotherWindow, kind: "changed_since_viewed" });
    render(<RequestForm {...props()} />);
    fillAll();
    fireEvent.click(draft());
    await waitFor(() => expect(screen.getByTestId("request-form-banner").textContent).toBe(COPY.form.changedInAnotherWindow));
    expect(field("What was it for?").value).toBe("Folding tables");
  });

  it("a refused submit after a good save keeps the entries and edits the SAME draft on retry", async () => {
    saveRequestAction.mockResolvedValue({ ok: true, data: { requestId: REQ, revision: 2 } });
    submitRequestAction.mockResolvedValueOnce({
      ok: false,
      error: COPY.fieldErrors.purpose,
      fieldErrors: { purpose: COPY.fieldErrors.purpose },
    });
    render(<RequestForm {...props()} />);
    fillAll();
    fireEvent.click(send());
    await waitFor(() => expect(screen.getByText(COPY.fieldErrors.purpose)).toBeTruthy());
    expect(field("Amount").value).toBe("$42.50");
    expect(push).not.toHaveBeenCalled();

    submitRequestAction.mockResolvedValueOnce({ ok: true, data: { route: "seat", groupName: "Property Committee", message: "Sent to Property Committee for approval.", revision: 3 } });
    fireEvent.click(send());
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/o/alder/reimbursements/${REQ}`));
    const second = saveRequestAction.mock.calls[1]![1];
    expect(second).toMatchObject({ requestId: REQ, expectedRevision: 2 });
    expect(submitRequestAction.mock.calls[1]![1]).toEqual({ requestId: REQ, expectedRevision: 2 });
  });
});

describe("RequestForm - saving and sending", () => {
  it("one tap is one save; a second tap while it runs does nothing", async () => {
    let resolve!: (v: unknown) => void;
    saveRequestAction.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<RequestForm {...props()} />);
    fillAll();
    fireEvent.click(send());
    fireEvent.click(send());
    fireEvent.click(draft());
    expect(saveRequestAction).toHaveBeenCalledTimes(1);
    expect(send().disabled).toBe(true);
    expect(send().textContent).toBe(COPY.form.sending);
    resolve({ ok: false, error: COPY.form.saveFailed });
    await waitFor(() => expect(send().disabled).toBe(false));
  });

  it("Send posts what was typed, as integer cents, with the form's idempotency key, then submits that revision", async () => {
    saveRequestAction.mockResolvedValue({ ok: true, data: { requestId: REQ, revision: 1 } });
    submitRequestAction.mockResolvedValue({ ok: true, data: { route: "seat", groupName: "Property Committee", message: "Sent to Property Committee for approval.", revision: 2 } });
    render(<RequestForm {...props()} />);
    fillAll();
    fireEvent.click(send());
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(saveRequestAction).toHaveBeenCalledWith("alder", {
      clientKey: "client-key-0001",
      kind: "reimburse",
      groupId: G1,
      beneficiaryPersonId: null,
      vendorName: null,
      amountCents: 4250,
      expenseDate: "2026-10-20",
      purpose: "Folding tables",
      categoryId: C1,
      preApprovedBy: null,
      noReceiptClaimed: true,
    });
    expect(submitRequestAction).toHaveBeenCalledWith("alder", { requestId: REQ, expectedRevision: 1 });
    expect(toast.success).toHaveBeenCalledWith("Sent to Property Committee for approval.");
  });

  it("a blank Send names the missing fields and calls nothing", async () => {
    render(<RequestForm {...props()} />);
    fireEvent.click(send());
    await waitFor(() => expect(screen.getByText(COPY.fieldErrors.group)).toBeTruthy());
    expect(screen.getByText(COPY.fieldErrors.amount)).toBeTruthy();
    expect(screen.getByText(COPY.fieldErrors.purpose)).toBeTruthy();
    expect(screen.getByText(COPY.fieldErrors.receipt)).toBeTruthy();
    expect(saveRequestAction).not.toHaveBeenCalled();
  });

  it("a first Save draft moves to the edit address; a later one stays and carries the revision", async () => {
    saveRequestAction.mockResolvedValue({ ok: true, data: { requestId: REQ, revision: 1 } });
    render(<RequestForm {...props()} />);
    fireEvent.change(field("Charge to"), { target: { value: G1 } });
    fireEvent.click(draft());
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/o/alder/reimbursements/${REQ}/edit`));
    expect(toast.success).toHaveBeenCalledWith(COPY.form.draftSaved);
    saveRequestAction.mockResolvedValue({ ok: true, data: { requestId: REQ, revision: 2 } });
    fireEvent.click(draft());
    await waitFor(() => expect(saveRequestAction).toHaveBeenCalledTimes(2));
    expect(saveRequestAction.mock.calls[1]![1]).toMatchObject({ requestId: REQ, expectedRevision: 1 });
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("a two-factor refusal sends the person to the challenge", async () => {
    saveRequestAction.mockResolvedValue({ ok: false, error: COPY.gate.twoFactorRequired, kind: "two_factor_required", redirectTo: "/totp?callbackUrl=x" });
    render(<RequestForm {...props()} />);
    fillAll();
    fireEvent.click(send());
    await waitFor(() => expect(push).toHaveBeenCalledWith("/totp?callbackUrl=x"));
  });
});

describe("RequestForm - editing a sent-back request", () => {
  it("shows kind, group and payee as text once sent, and still posts them", async () => {
    saveRequestAction.mockResolvedValue({ ok: true, data: { requestId: REQ, revision: 5 } });
    submitRequestAction.mockResolvedValue({ ok: true, data: { route: "seat", groupName: "Property Committee", message: "m", revision: 6 } });
    render(
      <RequestForm
        {...props({
          initialValues: { ...emptyFormValues(), groupId: G1, categoryId: C1, amountDigits: "1999", expenseDate: "2026-10-02", purpose: "Kit", noReceiptClaimed: true },
          existing: { requestId: REQ, revision: 4, frozen: true, groupName: "Property Committee", payeeLabel: "Tamsin Brightwater", receipts: [] },
        })}
      />,
    );
    expect(screen.getByTestId("request-form-frozen").textContent).toContain("Property Committee");
    expect(screen.queryByLabelText("Charge to")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(COPY.form.editHeading);
    fireEvent.click(send());
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(saveRequestAction.mock.calls[0]![1]).toMatchObject({ requestId: REQ, expectedRevision: 4, groupId: G1, kind: "reimburse" });
  });
});
