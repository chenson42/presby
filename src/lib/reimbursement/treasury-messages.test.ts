import { describe, expect, it } from "vitest";
import { COPY } from "./copy";
import { OUTCOMES } from "./outcomes";
import {
  addNoteRefusal,
  categoryRefusal,
  chargeableRefusal,
  overrideRefusal,
  paymentRefusal,
  reasonVerbRefusal,
  treasuryReturnRefusal,
  waiveRefusal,
} from "./treasury-messages";

const NEUTRAL = { ok: false, error: COPY.detail.unavailable, kind: "not_found" };

describe("paymentRefusal maps every record_payment outcome to Copy", () => {
  it("covers every refusal the definer can return, each with a non-empty sentence", () => {
    for (const outcome of OUTCOMES.recordPayment.filter((o) => o !== "ok")) {
      const failure = paymentRefusal(outcome);
      expect(failure.ok).toBe(false);
      expect(failure.error.length, outcome).toBeGreaterThan(0);
    }
  });

  it("the pre-form blocks are the C8 sentences", () => {
    expect(paymentRefusal("payer_is_approver").error).toBe("A different person must record this payment.");
    expect(paymentRefusal("needs_another_payer").error).toBe(COPY.treasury.blocks.anotherPayer);
    expect(paymentRefusal("receipt_missing").error).toBe("Add a receipt or waive it before paying.");
    expect(paymentRefusal("not_payable").error).toBe("This request isn't waiting for payment.");
    expect(paymentRefusal("already_paid").error).toBe("This payment was already recorded.");
  });

  it("field outcomes sit next to their field", () => {
    expect(paymentRefusal("reference_required").fieldErrors).toEqual({ reference: "Enter a check number." });
    expect(paymentRefusal("reference_too_long").fieldErrors).toEqual({ reference: "Use 40 characters or fewer." });
    expect(paymentRefusal("date_out_of_range").fieldErrors).toEqual({ paidOn: "Choose a date between the day of the expense and today." });
    expect(paymentRefusal("note_too_long").fieldErrors).toEqual({ note: "Use 300 characters or fewer." });
  });

  it("not_found is the one neutral answer, and a tampered method reads as a save failure", () => {
    expect(paymentRefusal("not_found")).toEqual(NEUTRAL);
    expect(paymentRefusal("method_invalid").error).toBe(COPY.form.saveFailed);
  });
});

describe("the state verbs: void, reverse, waive, send back", () => {
  it("reason outcomes sit next to the reason field", () => {
    expect(reasonVerbRefusal("reason_required").fieldErrors).toEqual({ reason: "Give a reason." });
    expect(reasonVerbRefusal("reason_too_long").fieldErrors).toEqual({ reason: "Use 300 characters or fewer." });
  });

  it("not_found stays the one neutral answer; each state outcome is its own treasurer sentence (amendment S3)", () => {
    expect(reasonVerbRefusal("not_found")).toEqual(NEUTRAL);
    expect(reasonVerbRefusal("not_voidable")).toEqual({ ok: false, error: COPY.treasury.refusals.notVoidable });
    expect(reasonVerbRefusal("not_reversible")).toEqual({ ok: false, error: COPY.treasury.refusals.notReversible });
    for (const o of OUTCOMES.void.filter((x) => x !== "ok")) expect(reasonVerbRefusal(o).error.length).toBeGreaterThan(0);
    for (const o of OUTCOMES.reversePayment.filter((x) => x !== "ok")) expect(reasonVerbRefusal(o).error.length).toBeGreaterThan(0);
  });

  it("waive: the note limit is a field error; not_found is neutral; the two state outcomes are their sentences", () => {
    expect(waiveRefusal("note_too_long").fieldErrors).toEqual({ note: "Use 300 characters or fewer." });
    expect(waiveRefusal("not_found")).toEqual(NEUTRAL);
    expect(waiveRefusal("not_waivable")).toEqual({ ok: false, error: COPY.treasury.refusals.notWaivable });
    expect(waiveRefusal("receipt_present")).toEqual({ ok: false, error: COPY.treasury.refusals.receiptPresent });
    for (const o of OUTCOMES.waiveReceipt.filter((x) => x !== "ok")) expect(waiveRefusal(o).error.length).toBeGreaterThan(0);
  });

  it("send back (treasurer tree): not_returnable is the treasurer sentence; every other outcome is the member tree's", () => {
    expect(treasuryReturnRefusal("not_returnable")).toEqual({ ok: false, error: COPY.treasury.refusals.notReturnable });
    expect(treasuryReturnRefusal("not_found")).toEqual(NEUTRAL);
    expect(treasuryReturnRefusal("changed_since_viewed")).toMatchObject({ kind: "changed_since_viewed" });
    expect(treasuryReturnRefusal("reason_required").fieldErrors).toEqual({ reason: COPY.decision.reasonRequired });
    expect(treasuryReturnRefusal("kind_invalid")).toEqual(NEUTRAL);
  });

  it("note: too long is a field error; missing is 'Write a note.'; not_found is neutral", () => {
    expect(addNoteRefusal("note_too_long").fieldErrors).toEqual({ note: "Use 500 characters or fewer." });
    expect(addNoteRefusal("note_required").fieldErrors).toEqual({ note: "Write a note." });
    expect(addNoteRefusal("not_found")).toEqual(NEUTRAL);
  });
});

describe("overrideRefusal (C8: the group is named, the team link is for a manager)", () => {
  it("seat_holder_exists names the group (or 'the group' when the viewer cannot read it)", () => {
    expect(overrideRefusal("seat_holder_exists", { groupName: "Property Committee", holdsManage: true }).error).toBe(
      "Someone in Property Committee can approve this, so it needs their approval.",
    );
    expect(overrideRefusal("seat_holder_exists", { groupName: null, holdsManage: false }).error).toBe(
      "Someone in the group can approve this, so it needs their approval.",
    );
  });

  it("needs_second_payer is the sentence alone; suggestTeam is true ONLY for a viewer who holds manage", () => {
    const manager = overrideRefusal("needs_second_payer", { groupName: "Property Committee", holdsManage: true });
    expect(manager.error).toBe(COPY.treasury.override.needsSecondPayer);
    expect(manager.error).not.toContain("Treasury team");
    expect(manager.suggestTeam).toBe(true);
    const payOnly = overrideRefusal("needs_second_payer", { groupName: "Property Committee", holdsManage: false });
    expect(payOnly.error).toBe(COPY.treasury.override.needsSecondPayer);
    expect(payOnly.suggestTeam).toBeUndefined();
  });

  it("changed_since_viewed carries its kind; not_approvable is its sentence; not_found is neutral", () => {
    expect(overrideRefusal("changed_since_viewed", { groupName: null, holdsManage: false })).toMatchObject({
      error: COPY.decision.changedAfterOpened, kind: "changed_since_viewed",
    });
    expect(overrideRefusal("not_approvable", { groupName: null, holdsManage: false })).toEqual({
      ok: false, error: COPY.treasury.refusals.notApprovable,
    });
    expect(overrideRefusal("not_found", { groupName: null, holdsManage: false })).toEqual(NEUTRAL);
  });
});

describe("settings refusals", () => {
  it("an unavailable group is the Copy group sentence; a category name problem is the Copy sentence on the name field", () => {
    expect(chargeableRefusal("group_unavailable").error).toBe(COPY.fieldErrors.groupUnavailable);
    expect(categoryRefusal("name_invalid").fieldErrors).toEqual({ name: COPY.settings.categoryNameInvalid });
    expect(categoryRefusal("name_taken").fieldErrors).toEqual({ name: COPY.settings.categoryNameTaken });
    expect(categoryRefusal("not_found")).toEqual({ ok: false, error: COPY.settings.categoryGone });
  });
});
