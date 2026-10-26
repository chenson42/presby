import { describe, expect, it } from "vitest";
import { zodFieldErrors } from "./action-result";
import { COPY } from "./copy";
import {
  approveRequestSchema,
  returnRequestSchema,
  saveRequestSchema,
  searchBeneficiariesSchema,
  submitRequestSchema,
  withdrawRequestSchema,
} from "./input";

const GROUP = "11111111-1111-4111-8111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";
const PERSON = "33333333-3333-4333-8333-333333333333";

const valid = {
  clientKey: "k3y-abcdefgh",
  kind: "reimburse",
  groupId: GROUP,
  amountCents: 4150,
  expenseDate: "2026-10-20",
  purpose: "Paint for the fellowship hall",
} as const;

describe("saveRequestSchema", () => {
  it("accepts a complete request and cleans the free text", () => {
    const parsed = saveRequestSchema.parse({ ...valid, purpose: "  Paint\tfor\nthe hall  ", vendorName: "   " });
    expect(parsed.purpose).toBe("Paint for the hall");
    expect(parsed.vendorName).toBeNull();
    expect(parsed.noReceiptClaimed).toBe(false);
    expect(parsed.categoryId).toBeNull();
    expect(parsed.beneficiaryPersonId).toBeNull();
  });

  it("accepts a PARTIAL draft: amount, date and purpose may be absent until Send", () => {
    const parsed = saveRequestSchema.parse({ clientKey: valid.clientKey, kind: "vendor", groupId: GROUP });
    expect(parsed.amountCents).toBeNull();
    expect(parsed.expenseDate).toBeNull();
    expect(parsed.purpose).toBeNull();
  });

  it("amountCents is an integer 1..10,000,000 and nothing else (EC3)", () => {
    for (const bad of [0, -5, 12.5, 10_000_001, Number.NaN, "100", Infinity]) {
      const result = saveRequestSchema.safeParse({ ...valid, amountCents: bad });
      expect(result.success, String(bad)).toBe(false);
      if (!result.success) expect(zodFieldErrors(result.error).amountCents).toBe(COPY.fieldErrors.amount);
    }
    for (const good of [1, 4150, 10_000_000]) {
      expect(saveRequestSchema.safeParse({ ...valid, amountCents: good }).success, String(good)).toBe(true);
    }
  });

  it("expenseDate must be a real calendar date", () => {
    for (const bad of ["2026-02-30", "10/20/2026", "2026-1-5", "not a date"]) {
      const result = saveRequestSchema.safeParse({ ...valid, expenseDate: bad });
      expect(result.success, bad).toBe(false);
      if (!result.success) expect(zodFieldErrors(result.error).expenseDate).toBe(COPY.fieldErrors.date);
    }
  });

  it("measures length AFTER cleaning, and names the field (never a silent truncation)", () => {
    const tooLong = saveRequestSchema.safeParse({ ...valid, purpose: "x".repeat(501) });
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) expect(zodFieldErrors(tooLong.error).purpose).toBe("Use 500 characters or fewer.");
    // 500 characters padded with whitespace and a zero-width space is 500 once cleaned
    const padded = `  ${"x".repeat(250)}​   \n${"y".repeat(249)} `;
    expect(saveRequestSchema.safeParse({ ...valid, purpose: padded }).success).toBe(true);
    const vendor = saveRequestSchema.safeParse({ ...valid, kind: "vendor", vendorName: "v".repeat(121) });
    if (!vendor.success) expect(zodFieldErrors(vendor.error).vendorName).toBe("Use 120 characters or fewer.");
    expect(vendor.success).toBe(false);
    const pre = saveRequestSchema.safeParse({ ...valid, preApprovedBy: "p".repeat(81) });
    expect(pre.success).toBe(false);
    if (!pre.success) expect(zodFieldErrors(pre.error).preApprovedBy).toBe("Use 80 characters or fewer.");
  });

  it("the client key is the 8..64 character idempotency key", () => {
    for (const bad of ["short", "has space here", "x".repeat(65), ""]) {
      expect(saveRequestSchema.safeParse({ ...valid, clientKey: bad }).success, bad).toBe(false);
    }
  });

  it("a group is required, and it must be a uuid", () => {
    const missing = saveRequestSchema.safeParse({ ...valid, groupId: undefined });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(zodFieldErrors(missing.error).groupId).toBe(COPY.fieldErrors.group);
    expect(saveRequestSchema.safeParse({ ...valid, groupId: "not-a-uuid" }).success).toBe(false);
  });

  it("an edit (requestId) must carry the revision it was opened at", () => {
    expect(saveRequestSchema.safeParse({ ...valid, requestId: REQ }).success).toBe(false);
    expect(saveRequestSchema.safeParse({ ...valid, requestId: REQ, expectedRevision: 3 }).success).toBe(true);
    expect(saveRequestSchema.safeParse({ ...valid, requestId: REQ, expectedRevision: 0 }).success).toBe(false);
  });

  it("a beneficiary must be a uuid when present; the empty string means none", () => {
    expect(saveRequestSchema.parse({ ...valid, beneficiaryPersonId: PERSON }).beneficiaryPersonId).toBe(PERSON);
    expect(saveRequestSchema.parse({ ...valid, beneficiaryPersonId: "" }).beneficiaryPersonId).toBeNull();
    expect(saveRequestSchema.safeParse({ ...valid, beneficiaryPersonId: "someone" }).success).toBe(false);
  });

  it("never reads an organization id or a person id from the client: unknown keys are not carried", () => {
    const parsed = saveRequestSchema.parse({ ...valid, organizationId: "x", createdByPersonId: PERSON }) as Record<string, unknown>;
    expect(parsed.organizationId).toBeUndefined();
    expect(parsed.createdByPersonId).toBeUndefined();
  });

  it("kind is one of the two", () => {
    expect(saveRequestSchema.safeParse({ ...valid, kind: "loan" }).success).toBe(false);
  });
});

describe("submitRequestSchema", () => {
  it("needs a request id and the revision the requester saw", () => {
    expect(submitRequestSchema.safeParse({ requestId: REQ, expectedRevision: 2 }).success).toBe(true);
    expect(submitRequestSchema.safeParse({ requestId: REQ }).success).toBe(false);
    expect(submitRequestSchema.safeParse({ requestId: "nope", expectedRevision: 2 }).success).toBe(false);
    expect(submitRequestSchema.safeParse({ requestId: REQ, expectedRevision: 0 }).success).toBe(false);
    expect(submitRequestSchema.safeParse({ requestId: REQ, expectedRevision: 1.5 }).success).toBe(false);
  });
});

describe("withdrawRequestSchema", () => {
  it("the reason is optional free text, at most 300", () => {
    expect(withdrawRequestSchema.parse({ requestId: REQ }).reason).toBeNull();
    expect(withdrawRequestSchema.parse({ requestId: REQ, reason: "  changed my mind " }).reason).toBe("changed my mind");
    expect(withdrawRequestSchema.safeParse({ requestId: REQ, reason: "r".repeat(301) }).success).toBe(false);
  });
});

describe("searchBeneficiariesSchema", () => {
  it("needs at least two characters after cleaning and at most eighty", () => {
    expect(searchBeneficiariesSchema.parse({ query: "  Qu  " }).query).toBe("Qu");
    expect(searchBeneficiariesSchema.safeParse({ query: "Q" }).success).toBe(false);
    expect(searchBeneficiariesSchema.safeParse({ query: "  \n " }).success).toBe(false);
    expect(searchBeneficiariesSchema.safeParse({ query: "q".repeat(81) }).success).toBe(false);
    expect(searchBeneficiariesSchema.safeParse({ query: 7 }).success).toBe(false);
  });
});

describe("approveRequestSchema", () => {
  it("takes the request and the revision the approver saw - and nothing about the path, a person or an organization", () => {
    const parsed = approveRequestSchema.parse({ requestId: REQ, expectedRevision: 3, path: "override", personId: PERSON, organizationId: GROUP });
    expect(parsed).toEqual({ requestId: REQ, expectedRevision: 3 });
  });

  it("rejects a malformed id and a missing or non-integer revision with a Copy string", () => {
    expect(zodFieldErrors(approveRequestSchema.safeParse({ requestId: "nope", expectedRevision: 1 }).error!)).toEqual({
      requestId: COPY.detail.unavailable,
    });
    expect(approveRequestSchema.safeParse({ requestId: REQ }).success).toBe(false);
    expect(approveRequestSchema.safeParse({ requestId: REQ, expectedRevision: 1.5 }).success).toBe(false);
    expect(approveRequestSchema.safeParse({ requestId: REQ, expectedRevision: 0 }).success).toBe(false);
  });
});

describe("returnRequestSchema", () => {
  const base = { requestId: REQ, expectedRevision: 2, kind: "needs_info", reason: "Please add the receipt" } as const;

  it("accepts both kinds and cleans the reason", () => {
    expect(returnRequestSchema.parse({ ...base, reason: "  Please\tadd\nit  " }).reason).toBe("Please add it");
    expect(returnRequestSchema.parse({ ...base, kind: "not_approved" }).kind).toBe("not_approved");
  });

  it("requires a reason: blank, whitespace-only, control-only and missing are all 'Give a reason.'", () => {
    for (const reason of ["", "   ", "\u0000\u200b", undefined, null]) {
      const result = returnRequestSchema.safeParse({ ...base, reason });
      expect(result.success, String(reason)).toBe(false);
      expect(zodFieldErrors(result.error!)).toEqual({ reason: COPY.decision.reasonRequired });
    }
  });

  it("names the limit when the reason is over 300 characters, measured after cleaning, and never truncates", () => {
    expect(returnRequestSchema.safeParse({ ...base, reason: "x".repeat(300) }).success).toBe(true);
    const over = returnRequestSchema.safeParse({ ...base, reason: "x".repeat(301) });
    expect(zodFieldErrors(over.error!)).toEqual({ reason: "Use 300 characters or fewer." });
  });

  it("refuses a kind that is not needs_info or not_approved", () => {
    for (const kind of ["approved", "voided", "", undefined]) {
      expect(returnRequestSchema.safeParse({ ...base, kind }).success, String(kind)).toBe(false);
    }
  });
});
