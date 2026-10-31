import { describe, expect, it } from "vitest";
import { COPY } from "@/lib/reimbursement/copy";
import {
  buildSavePayload,
  detailToFormValues,
  emptyFormValues,
  mapServerFieldErrors,
  validateForDraft,
  validateForSend,
  type RequestFormValues,
} from "./request-form-model";

const G = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";
const full = (over: Partial<RequestFormValues> = {}): RequestFormValues => ({
  ...emptyFormValues(),
  groupId: G,
  categoryId: "c",
  amountDigits: "4250",
  expenseDate: "2026-10-01",
  purpose: "Tables",
  noReceiptClaimed: true,
  ...over,
});

describe("buildSavePayload", () => {
  it("sends only what the chosen mode owns", () => {
    const vendorLeftover = full({ mode: "me", vendorName: "Abandoned", beneficiaryPersonId: P });
    const p = buildSavePayload(vendorLeftover, { clientKey: "k".repeat(8), saved: null });
    expect(p).toMatchObject({ kind: "reimburse", vendorName: null, beneficiaryPersonId: null, amountCents: 4250 });
    const v = buildSavePayload(full({ mode: "vendor", vendorName: "Harbor" }), { clientKey: "k".repeat(8), saved: null });
    expect(v).toMatchObject({ kind: "vendor", vendorName: "Harbor", beneficiaryPersonId: null });
    const o = buildSavePayload(full({ mode: "other", beneficiaryPersonId: P }), { clientKey: "k".repeat(8), saved: null });
    expect(o).toMatchObject({ kind: "reimburse", beneficiaryPersonId: P });
  });
  it("turns a save into an edit once the request exists", () => {
    const p = buildSavePayload(full(), { clientKey: "k".repeat(8), saved: { requestId: G, revision: 3 } });
    expect(p).toMatchObject({ requestId: G, expectedRevision: 3 });
    expect(buildSavePayload(full(), { clientKey: "k".repeat(8), saved: null })).not.toHaveProperty("requestId");
  });
  it("blank optional text and an empty amount are null, never empty strings or zero", () => {
    const p = buildSavePayload(full({ purpose: "  ", amountDigits: "", expenseDate: "", categoryId: "", preApprovedBy: "" }), { clientKey: "k".repeat(8), saved: null });
    expect(p).toMatchObject({ purpose: null, amountCents: null, expenseDate: null, categoryId: null, preApprovedBy: null });
  });
});

describe("validation", () => {
  it("a draft needs a group, and for someone else, the person", () => {
    expect(validateForDraft(full())).toEqual({});
    expect(validateForDraft(full({ groupId: "" }))).toEqual({ groupId: COPY.fieldErrors.group });
    expect(validateForDraft(full({ mode: "other" }))).toEqual({ beneficiaryPersonId: COPY.fieldErrors.beneficiary });
  });
  it("Send names every missing field with the Copy sentence", () => {
    const errors = validateForSend(emptyFormValues(), { hasCategories: true, receiptCount: 0 });
    expect(errors).toEqual({
      groupId: COPY.fieldErrors.group,
      amountDigits: COPY.fieldErrors.amount,
      expenseDate: COPY.fieldErrors.date,
      purpose: COPY.fieldErrors.purpose,
      categoryId: COPY.fieldErrors.category,
      noReceiptClaimed: COPY.fieldErrors.receipt,
    });
  });
  it("a complete form passes; a receipt or the box satisfies the receipt rule; no categories means none required", () => {
    expect(validateForSend(full(), { hasCategories: true, receiptCount: 0 })).toEqual({});
    expect(validateForSend(full({ noReceiptClaimed: false }), { hasCategories: false, receiptCount: 1 })).toEqual({});
    expect(validateForSend(full({ categoryId: "" }), { hasCategories: false, receiptCount: 0 })).toEqual({});
  });
  it("a vendor request needs the vendor, and over-long text is a named error", () => {
    expect(validateForSend(full({ mode: "vendor" }), { hasCategories: false, receiptCount: 0 }).vendorName).toBe(COPY.fieldErrors.vendor);
    expect(validateForSend(full({ purpose: "x".repeat(501) }), { hasCategories: false, receiptCount: 0 }).purpose).toBe(COPY.fieldErrors.tooLong(500));
  });
  it("an amount over the maximum is refused", () => {
    expect(validateForSend(full({ amountDigits: "10000001" }), { hasCategories: false, receiptCount: 0 }).amountDigits).toBe(COPY.fieldErrors.amount);
  });
});

describe("mapServerFieldErrors", () => {
  it("maps the schema's names to the form's and returns the rest", () => {
    const { errors, unmapped } = mapServerFieldErrors({ amountCents: "a", receipts: "r", vendorName: "v", mystery: "m" });
    expect(errors).toEqual({ amountDigits: "a", noReceiptClaimed: "r", vendorName: "v" });
    expect(unmapped).toEqual(["m"]);
  });
});

describe("detailToFormValues", () => {
  const detail = {
    kind: "reimburse" as const,
    group: { id: G, name: "Property" },
    category: { id: "c", name: "Supplies", retired: false },
    payee: { kind: "person" as const, name: "Someone", personId: P },
    amountCents: 1999,
    expenseDate: "2026-10-02",
    purpose: "Kit",
    preApprovedByName: "Pat",
    noReceiptClaimed: true,
  };
  it("is 'me' when the payee is the viewer and 'other' when it is not", () => {
    expect(detailToFormValues(detail, P).mode).toBe("me");
    const other = detailToFormValues(detail, "someone-else");
    expect(other).toMatchObject({ mode: "other", beneficiaryPersonId: P, beneficiaryName: "Someone", amountDigits: "1999", noReceiptClaimed: true });
  });
  it("reads a vendor request", () => {
    const v = detailToFormValues({ ...detail, kind: "vendor", payee: { kind: "vendor", name: "Harbor" } }, P);
    expect(v).toMatchObject({ mode: "vendor", vendorName: "Harbor", beneficiaryPersonId: "" });
  });
});
