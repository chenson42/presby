import { describe, expect, it } from "vitest";
import { COPY } from "./copy";
import { OUTCOMES } from "./outcomes";
import { alreadyDecidedFailure, decisionRefusal, incompleteRefusal, returnedMessage, saveRefusal, sentMessage, submitRefusal } from "./messages";

const ctx = { organizationName: "Alder Creek Church" };

describe("saveRefusal maps every save outcome to a Copy string", () => {
  it("covers every refusal outcome of both save doors with a message", () => {
    const all = new Set([...OUTCOMES.saveDraft, ...OUTCOMES.updateRequest].filter((o) => o !== "ok"));
    for (const outcome of all) {
      const failure = saveRefusal(outcome, ctx);
      expect(failure.ok).toBe(false);
      expect(failure.error.length, outcome).toBeGreaterThan(0);
    }
  });

  it("puts field outcomes next to their field, with Copy text", () => {
    expect(saveRefusal("amount_out_of_range", ctx).fieldErrors).toEqual({ amountCents: COPY.fieldErrors.amount });
    expect(saveRefusal("date_out_of_range", ctx).fieldErrors).toEqual({ expenseDate: COPY.fieldErrors.date });
    expect(saveRefusal("group_not_chargeable", ctx).fieldErrors).toEqual({ groupId: COPY.fieldErrors.groupUnavailable });
    expect(saveRefusal("category_unavailable", ctx).fieldErrors).toEqual({ categoryId: COPY.fieldErrors.category });
    expect(saveRefusal("not_allowed_for_others", ctx).fieldErrors).toEqual({ beneficiaryPersonId: COPY.fieldErrors.forOthers });
    expect(saveRefusal("beneficiary_unavailable", ctx).fieldErrors).toEqual({
      beneficiaryPersonId: COPY.fieldErrors.beneficiaryUnavailable,
    });
    expect(saveRefusal("purpose_too_long", ctx).fieldErrors).toEqual({ purpose: "Use 500 characters or fewer." });
    expect(saveRefusal("vendor_too_long", ctx).fieldErrors).toEqual({ vendorName: "Use 120 characters or fewer." });
    expect(saveRefusal("pre_approved_too_long", ctx).fieldErrors).toEqual({ preApprovedBy: "Use 80 characters or fewer." });
  });

  it("the toast text is the first field message", () => {
    const failure = saveRefusal("amount_out_of_range", ctx);
    expect(failure.error).toBe(COPY.fieldErrors.amount);
  });

  it("not_eligible names the organization, too_many_drafts says twenty, changed_since_viewed carries its kind", () => {
    expect(saveRefusal("not_eligible", ctx).error).toBe(COPY.page.cannotFile("Alder Creek Church"));
    expect(saveRefusal("too_many_drafts", ctx).error).toBe("You have 20 unfinished drafts. Send or withdraw one first.");
    expect(saveRefusal("changed_since_viewed", ctx)).toMatchObject({ kind: "changed_since_viewed" });
  });

  it("not_found and not_editable are ONE neutral answer (EC16), and a shape fault reads as a save failure", () => {
    expect(saveRefusal("not_found", ctx)).toEqual(saveRefusal("not_editable", ctx));
    expect(saveRefusal("not_found", ctx)).toEqual({ ok: false, error: "This request isn't available.", kind: "not_found" });
    expect(saveRefusal("invalid_shape", ctx).error).toBe(COPY.form.saveFailed);
    expect(saveRefusal("kind_invalid", ctx).error).toBe(COPY.form.saveFailed);
  });
});

describe("submit refusals", () => {
  it("incomplete lists each missing thing next to its field, once", () => {
    const failure = incompleteRefusal(["amount", "date", "purpose", "payee", "category", "receipt"]);
    expect(failure.fieldErrors).toEqual({
      amountCents: COPY.fieldErrors.amount,
      expenseDate: COPY.fieldErrors.date,
      purpose: COPY.fieldErrors.purpose,
      vendorName: COPY.fieldErrors.vendor,
      categoryId: COPY.fieldErrors.category,
      receipts: COPY.fieldErrors.receipt,
    });
    expect(incompleteRefusal(["receipt"]).error).toBe("Add a receipt, or tick “I can't attach a receipt”.");
  });

  it("an incomplete with nothing recognisable falls back to the save failure rather than an empty message", () => {
    expect(incompleteRefusal([]).error).toBe(COPY.form.saveFailed);
  });

  it("covers every other submit refusal", () => {
    for (const outcome of OUTCOMES.submit.filter((o) => !["ok", "already_submitted", "incomplete"].includes(o))) {
      expect(submitRefusal(outcome, ctx).error.length, outcome).toBeGreaterThan(0);
    }
    expect(submitRefusal("group_not_chargeable", ctx).fieldErrors).toEqual({ groupId: COPY.fieldErrors.groupUnavailable });
    expect(submitRefusal("changed_since_viewed", ctx)).toMatchObject({ kind: "changed_since_viewed" });
    expect(submitRefusal("not_found", ctx)).toEqual(submitRefusal("not_editable", ctx));
  });
});

describe("sentMessage (C3, by the route the definer computed live)", () => {
  it("says where it went, and claims no one was notified", () => {
    expect(sentMessage("seat", "Property Committee")).toBe("Sent to Property Committee for approval.");
    expect(sentMessage("treasurer", "Property Committee")).toBe(
      "No one in Property Committee is able to approve this, so it was sent to the treasurer.",
    );
    expect(sentMessage("nobody", "Property Committee")).toContain("Let your church office know.");
    expect(sentMessage(null, "Property Committee")).toBe("Sent to Property Committee for approval.");
  });
});

describe("decisionRefusal (approve and send back, Copy C6)", () => {
  it("covers every refusal outcome of both doors with a Copy string", () => {
    const all = new Set([...OUTCOMES.approve, ...OUTCOMES.return].filter((o) => o !== "ok" && o !== "already_decided"));
    for (const outcome of all) {
      const failure = decisionRefusal(outcome);
      expect(failure.ok).toBe(false);
      expect(failure.error.length, outcome).toBeGreaterThan(0);
    }
  });

  it("a stale revision says the request changed after it was opened, and is a distinct kind", () => {
    expect(decisionRefusal("changed_since_viewed")).toEqual({
      ok: false,
      error: "This request changed after you opened it. Review it again.",
      kind: "changed_since_viewed",
    });
  });

  it("missing, forbidden, not in a decidable state and not yours to decide are ONE neutral answer (EC16)", () => {
    const neutral = { ok: false, error: "This request isn't available.", kind: "not_found" };
    for (const outcome of ["not_found", "not_approvable", "not_returnable", "kind_invalid", "seat_holder_exists", "needs_second_payer", "something_new"]) {
      expect(decisionRefusal(outcome), outcome).toEqual(neutral);
    }
  });

  it("a missing reason sits next to the reason field; an over-long one names the limit", () => {
    expect(decisionRefusal("reason_required")).toMatchObject({ ok: false, error: "Give a reason.", fieldErrors: { reason: "Give a reason." } });
    expect(decisionRefusal("reason_too_long")).toMatchObject({ fieldErrors: { reason: "Use 300 characters or fewer." } });
  });
});

describe("alreadyDecidedFailure (the date of the deciding event, never the actor)", () => {
  it("an approved or paid request reads 'already approved on <date>'", () => {
    for (const status of ["approved", "paid"]) {
      expect(alreadyDecidedFailure(status, "2026-10-25")).toEqual({
        ok: false,
        error: "This was already approved on October 25, 2026.",
        kind: "already_decided",
        decidedOn: "2026-10-25",
        status,
      });
    }
  });

  it("a returned or not-approved request reads 'already sent back on <date>'", () => {
    for (const status of ["returned", "not_approved"]) {
      expect(alreadyDecidedFailure(status, "2026-01-02")).toMatchObject({
        error: "This was already sent back on January 2, 2026.",
        kind: "already_decided",
        decidedOn: "2026-01-02",
        status,
      });
    }
  });

  it("names no person: the result has no actor field", () => {
    expect(Object.keys(alreadyDecidedFailure("approved", "2026-10-25")).sort()).toEqual(["decidedOn", "error", "kind", "ok", "status"]);
  });

  it("without a date or a known status it falls back to the neutral string rather than inventing one", () => {
    expect(alreadyDecidedFailure("approved", null)).toMatchObject({ error: "This request isn't available.", kind: "already_decided" });
    expect(alreadyDecidedFailure(null, "2026-10-25")).toMatchObject({ error: "This request isn't available.", kind: "already_decided" });
  });
});

describe("returnedMessage", () => {
  it("is 'Sent back.' for needs-changes and 'Marked not approved.' for not-approved", () => {
    expect(returnedMessage("needs_info")).toBe("Sent back.");
    expect(returnedMessage("not_approved")).toBe("Marked not approved.");
  });
});
