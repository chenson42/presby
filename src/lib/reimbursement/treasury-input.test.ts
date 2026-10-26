import { describe, expect, it } from "vitest";
import { COPY } from "./copy";
import {
  addNoteSchema,
  endCategorySchema,
  overrideApproveSchema,
  recordPaymentSchema,
  reversePaymentSchema,
  saveCategorySchema,
  setChargeableSchema,
  treasuryReturnSchema,
  voidRequestSchema,
  waiveReceiptSchema,
} from "./treasury-input";

const ID = "11111111-1111-4111-8111-111111111111";
const GROUP = "22222222-2222-4222-8222-222222222222";

const messages = (result: { success: boolean; error?: import("zod").ZodError }) =>
  result.success ? [] : result.error!.issues.map((i) => `${i.path.join(".")}: ${i.message}`);

describe("recordPaymentSchema", () => {
  const ok = { requestId: ID, method: "ach", reference: "  conf 8841 ", paidOn: "2026-10-20", note: null };

  it("cleans the free text and keeps the date as typed", () => {
    expect(recordPaymentSchema.parse(ok)).toEqual({ requestId: ID, method: "ach", reference: "conf 8841", paidOn: "2026-10-20", note: null });
  });

  it("a check needs its number: the Copy sentence, on the reference field", () => {
    const result = recordPaymentSchema.safeParse({ ...ok, method: "check", reference: "   " });
    expect(messages(result)).toEqual([`reference: ${COPY.treasury.results.checkNumberRequired}`]);
  });

  it("a check with a number passes; cash and other need none", () => {
    expect(recordPaymentSchema.safeParse({ ...ok, method: "check", reference: "1042" }).success).toBe(true);
    expect(recordPaymentSchema.safeParse({ ...ok, method: "cash", reference: null }).success).toBe(true);
    expect(recordPaymentSchema.safeParse({ ...ok, method: "other", reference: undefined }).success).toBe(true);
  });

  it("a method outside the four, and a date that is not a real date, are refused with Copy text", () => {
    expect(messages(recordPaymentSchema.safeParse({ ...ok, method: "wire" }))).toEqual([`method: ${COPY.form.saveFailed}`]);
    expect(messages(recordPaymentSchema.safeParse({ ...ok, paidOn: "2026-02-30" }))).toEqual([`paidOn: ${COPY.treasury.results.dateNotFuture}`]);
    expect(messages(recordPaymentSchema.safeParse({ ...ok, paidOn: "" }))).toEqual([`paidOn: ${COPY.treasury.results.dateNotFuture}`]);
  });

  it("over-length reference (40) and note (300) are named field errors, never truncated", () => {
    expect(messages(recordPaymentSchema.safeParse({ ...ok, reference: "x".repeat(41) }))).toEqual(["reference: Use 40 characters or fewer."]);
    expect(messages(recordPaymentSchema.safeParse({ ...ok, note: "n".repeat(301) }))).toEqual(["note: Use 300 characters or fewer."]);
    expect(recordPaymentSchema.safeParse({ ...ok, reference: "x".repeat(40), note: "n".repeat(300) }).success).toBe(true);
  });

  it("a request id that is not a uuid is the neutral unavailable string", () => {
    expect(messages(recordPaymentSchema.safeParse({ ...ok, requestId: "nope" }))).toEqual([`requestId: ${COPY.detail.unavailable}`]);
  });

  it("an organization id, a payer or a self-paid flag in the input is not a field (strips, never trusts)", () => {
    const parsed = recordPaymentSchema.parse({ ...ok, organizationId: "x", paidBy: "y", selfPaid: true, personId: "z" });
    expect(Object.keys(parsed).sort()).toEqual(["method", "note", "paidOn", "reference", "requestId"]);
  });
});

describe("the reason verbs: reverse, void, send back", () => {
  it("a reason is required (Copy 'Give a reason.') and at most 300", () => {
    for (const schema of [reversePaymentSchema, voidRequestSchema]) {
      expect(messages(schema.safeParse({ requestId: ID, reason: "   " }))).toEqual([`reason: ${COPY.treasury.results.reasonRequired}`]);
      expect(messages(schema.safeParse({ requestId: ID }))).toEqual([`reason: ${COPY.treasury.results.reasonRequired}`]);
      expect(messages(schema.safeParse({ requestId: ID, reason: "r".repeat(301) }))).toEqual(["reason: Use 300 characters or fewer."]);
      expect(schema.parse({ requestId: ID, reason: "  Duplicate of check 1041 " })).toEqual({ requestId: ID, reason: "Duplicate of check 1041" });
    }
  });

  it("the treasurer's send back carries the revision seen and a reason, and no kind: it is always 'needs changes'", () => {
    const parsed = treasuryReturnSchema.parse({ requestId: ID, expectedRevision: 3, reason: "Please add the invoice", kind: "not_approved" });
    expect(parsed).toEqual({ requestId: ID, expectedRevision: 3, reason: "Please add the invoice" });
    expect(messages(treasuryReturnSchema.safeParse({ requestId: ID, expectedRevision: 0, reason: "x" }))).toEqual([`expectedRevision: ${COPY.form.saveFailed}`]);
    expect(messages(treasuryReturnSchema.safeParse({ requestId: ID, expectedRevision: 1, reason: "" }))).toEqual([`reason: ${COPY.treasury.results.reasonRequired}`]);
  });

  it("override approve takes the request and the revision only; a posted path is dropped", () => {
    expect(overrideApproveSchema.parse({ requestId: ID, expectedRevision: 2, path: "seat" })).toEqual({ requestId: ID, expectedRevision: 2 });
  });
});

describe("waive and note", () => {
  it("the waiver note is optional, cleaned, at most 300", () => {
    expect(waiveReceiptSchema.parse({ requestId: ID })).toEqual({ requestId: ID, note: null });
    expect(waiveReceiptSchema.parse({ requestId: ID, note: "  Lost in the move " })).toEqual({ requestId: ID, note: "Lost in the move" });
    expect(messages(waiveReceiptSchema.safeParse({ requestId: ID, note: "n".repeat(301) }))).toEqual(["note: Use 300 characters or fewer."]);
  });

  it("a treasury note is required and at most 500", () => {
    expect(addNoteSchema.parse({ requestId: ID, note: " Check mailed Monday " })).toEqual({ requestId: ID, note: "Check mailed Monday" });
    expect(messages(addNoteSchema.safeParse({ requestId: ID, note: "  " }))).toEqual([`note: ${COPY.form.saveFailed}`]);
    expect(messages(addNoteSchema.safeParse({ requestId: ID, note: "n".repeat(501) }))).toEqual(["note: Use 500 characters or fewer."]);
    expect(addNoteSchema.safeParse({ requestId: ID, note: "n".repeat(500) }).success).toBe(true);
  });
});

describe("settings verbs", () => {
  it("setChargeable needs a group id and a boolean", () => {
    expect(setChargeableSchema.parse({ groupId: GROUP, chargeable: true })).toEqual({ groupId: GROUP, chargeable: true });
    expect(setChargeableSchema.safeParse({ groupId: "x", chargeable: true }).success).toBe(false);
    expect(setChargeableSchema.safeParse({ groupId: GROUP, chargeable: "yes" }).success).toBe(false);
  });

  it("a category name is 1 to 60 characters after cleaning, with the Copy sentence", () => {
    expect(saveCategorySchema.parse({ categoryId: null, name: "  Supplies ", sortOrder: null })).toEqual({ categoryId: null, name: "Supplies", sortOrder: null });
    expect(saveCategorySchema.parse({ categoryId: GROUP, name: "Música", sortOrder: 3 })).toEqual({ categoryId: GROUP, name: "Música", sortOrder: 3 });
    expect(messages(saveCategorySchema.safeParse({ categoryId: null, name: "   " }))).toEqual([`name: ${COPY.settings.categoryNameInvalid}`]);
    expect(messages(saveCategorySchema.safeParse({ categoryId: null, name: "c".repeat(61) }))).toEqual([`name: ${COPY.settings.categoryNameInvalid}`]);
    expect(saveCategorySchema.safeParse({ categoryId: null, name: "c".repeat(60) }).success).toBe(true);
  });

  it("an omitted category id is a create; a sort order must be an integer", () => {
    expect(saveCategorySchema.parse({ name: "Music" })).toEqual({ categoryId: null, name: "Music", sortOrder: null });
    expect(saveCategorySchema.safeParse({ name: "Music", sortOrder: 1.5 }).success).toBe(false);
  });

  it("endCategory needs a category id", () => {
    expect(endCategorySchema.parse({ categoryId: GROUP })).toEqual({ categoryId: GROUP });
    expect(endCategorySchema.safeParse({}).success).toBe(false);
  });
});
