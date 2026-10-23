/**
 * Characterization ("golden") tests for the offline-gift schemas, written on
 * zod 3.25.76 BEFORE the zod 4 upgrade and never edited by it
 * (docs/work-log/2026-10-23-zod-4.md, Phase 3 "Tests" 1 and 2).
 *
 * Expected strings are written from the source's own copy, not copied from a
 * run. Exact text is pinned only where a user can reach it; the tamper-only
 * paths in the work-log's Edge Cases list (bad discriminator, missing-key type
 * messages, enum with no message, id with no message) assert failure and path.
 */
import { describe, expect, it } from "vitest";
import { offlineGiftSchema, voidGiftSchema } from "./gift-input";
import { zodFieldErrors } from "./field-errors";
import { resolveForm } from "@/lib/testing/zod-golden";

const NON_RFC_ROLE_ID = "00000000-0000-0000-0000-000000000005";
const NON_RFC_FIXTURE_ID = "d9100000-0000-0000-0000-000000000010";
const DONOR = "55555555-5555-4555-8555-555555555555";
const FUND = "44444444-4444-4444-8444-444444444444";

const valid = (over: Record<string, unknown> = {}) => ({
  donor: { mode: "existing", donorId: DONOR },
  fundId: FUND,
  occurredOn: "2026-04-12",
  method: "cash",
  amount: "125.50",
  ...over,
});

function errorsOf(input: unknown): Record<string, string> {
  const result = offlineGiftSchema.safeParse(input);
  if (result.success) throw new Error("expected a failure");
  return zodFieldErrors(result.error);
}

describe("offlineGiftSchema: ids", () => {
  it.each([NON_RFC_ROLE_ID, NON_RFC_FIXTURE_ID])("accepts the non-RFC id %s for donor and fund", (id) => {
    const result = offlineGiftSchema.safeParse(valid({ donor: { mode: "existing", donorId: id }, fundId: id }));
    expect(result.success).toBe(true);
  });

  it("rejects a malformed donor id and fund id with the field's own message", () => {
    expect(errorsOf(valid({ donor: { mode: "existing", donorId: "not-a-uuid" }, fundId: "not-a-uuid" }))).toEqual({
      "donor.donorId": "Choose a donor",
      fundId: "Choose a fund",
    });
  });

  it("rejects an empty donor id and fund id with the field's own message", () => {
    expect(errorsOf(valid({ donor: { mode: "existing", donorId: "" }, fundId: "" }))).toEqual({
      "donor.donorId": "Choose a donor",
      fundId: "Choose a fund",
    });
  });

  it("fails (path only, tamper-only wording) when the donor id or fund id key is missing", () => {
    expect(Object.keys(errorsOf(valid({ donor: { mode: "existing" } })))).toEqual(["donor.donorId"]);
    const { fundId: _omitted, ...withoutFund } = valid();
    expect(Object.keys(errorsOf(withoutFund))).toEqual(["fundId"]);
  });
});

describe("offlineGiftSchema: field-level messages", () => {
  it("pins the date message", () => {
    for (const bad of ["", "2026-02-30", "04/12/2026", "2026-4-12"]) {
      expect(errorsOf(valid({ occurredOn: bad }))).toEqual({
        occurredOn: "Enter the date as year-month-day, like 2026-04-12",
      });
    }
  });

  it("pins the amount reasons", () => {
    expect(errorsOf(valid({ amount: "" }))).toEqual({ amount: "Enter the amount" });
    expect(errorsOf(valid({ amount: "   " }))).toEqual({ amount: "Enter the amount" });
    expect(errorsOf(valid({ amount: "$5" }))).toEqual({
      amount: "Enter an amount like 25 or 25.00 (no $ sign or commas)",
    });
    expect(errorsOf(valid({ amount: "10.999" }))).toEqual({
      amount: "Enter an amount like 25 or 25.00 (no $ sign or commas)",
    });
    expect(errorsOf(valid({ amount: "0" }))).toEqual({ amount: "The amount must be at least one cent" });
    expect(errorsOf(valid({ amount: "1000000.01" }))).toEqual({
      amount: "That is more than we can record ($1,000,000.00 at most)",
    });
  });

  it("pins the check number, stock and memo messages", () => {
    expect(errorsOf(valid({ method: "check", checkNumber: "9".repeat(31) }))).toEqual({
      checkNumber: "A check number can be 30 characters at most",
    });
    expect(
      errorsOf(valid({ method: "stock", stockDescription: "x".repeat(201), stockQuantity: "5" })),
    ).toEqual({ stockDescription: "Describe the stock in 200 characters or fewer" });
    expect(errorsOf(valid({ memo: "m".repeat(501) }))).toEqual({
      memo: "A note can be 500 characters at most",
    });
    expect(errorsOf(valid({ memo: "bad\u0007note" }))).toEqual({ memo: "That has a character we can't store" });
  });

  it("fails (path only, tamper-only wording) on an unknown method and an unknown donor mode", () => {
    expect(Object.keys(errorsOf(valid({ method: "bitcoin" })))).toEqual(["method"]);
    expect(Object.keys(errorsOf(valid({ donor: { mode: "stranger" } })))).toEqual(["donor.mode"]);
  });
});

describe("offlineGiftSchema: cross-field messages", () => {
  it("pins each superRefine message by path", () => {
    expect(errorsOf(valid({ method: "cash", checkNumber: "1042" }))).toEqual({
      checkNumber: "A check number only goes with a check",
    });
    expect(errorsOf(valid({ method: "stock" }))).toEqual({
      stockDescription: "Describe the stock (for example, 20 shares of an index fund)",
    });
    expect(errorsOf(valid({ method: "cash", stockDescription: "20 shares" }))).toEqual({
      stockDescription: "Stock details only go with a stock gift",
    });
    expect(
      errorsOf(valid({ method: "stock", stockDescription: "20 shares", stockQuantity: "twenty" })),
    ).toEqual({ stockQuantity: "Enter the number of shares as a plain number, like 20 or 12.5" });
    expect(
      errorsOf(valid({ method: "stock", stockDescription: "20 shares", stockQuantity: "0" })),
    ).toEqual({ stockQuantity: "The number of shares must be more than zero" });
    expect(errorsOf(valid({ donor: { mode: "unidentified" }, method: "check" }))).toEqual({
      method: "Only cash can be recorded without a donor (a plate offering)",
    });
  });

  it("reports the cross-field issues together with a field-level failure in one input", () => {
    expect(
      errorsOf(valid({ fundId: "", amount: "", method: "other", checkNumber: "77" })),
    ).toEqual({
      fundId: "Choose a fund",
      amount: "Enter the amount",
      checkNumber: "A check number only goes with a check",
    });
  });

  it("reports a refine-level field failure (date) together with the cross-field issues", () => {
    expect(errorsOf(valid({ occurredOn: "2026-02-30", amount: "x" }))).toEqual({
      occurredOn: "Enter the date as year-month-day, like 2026-04-12",
      amount: "Enter an amount like 25 or 25.00 (no $ sign or commas)",
    });
  });

  it("skips the cross-field refinements after a fatal type failure on a field", () => {
    // `amount` is not a string: the type check is fatal, so the object-level
    // refinement (which would flag the check number) never runs. Only the
    // failure and its path are pinned for the type message itself.
    const errors = errorsOf(valid({ amount: 5, fundId: "", method: "other", checkNumber: "77" }));
    expect(Object.keys(errors).sort()).toEqual(["amount", "fundId"]);
    expect(errors.fundId).toBe("Choose a fund");
  });
});

describe("offlineGiftSchema: parsed output", () => {
  it("existing donor, optional keys absent", () => {
    expect(offlineGiftSchema.parse(valid())).toEqual({
      donor: { mode: "existing", donorId: DONOR },
      fundId: FUND,
      occurredOn: "2026-04-12",
      method: "cash",
      amount: "125.50",
      checkNumber: null,
      stockDescription: null,
      stockQuantity: null,
      memo: null,
    });
  });

  it("normalizes null, empty and absent optionals to null, and trims the rest", () => {
    for (const blank of [undefined, null, "", "   "]) {
      const parsed = offlineGiftSchema.parse(
        valid({ method: "check", checkNumber: blank, stockDescription: blank, stockQuantity: blank, memo: blank }),
      );
      expect(parsed.checkNumber).toBeNull();
      expect(parsed.stockDescription).toBeNull();
      expect(parsed.stockQuantity).toBeNull();
      expect(parsed.memo).toBeNull();
    }
    const trimmed = offlineGiftSchema.parse(
      valid({ method: "stock", stockDescription: "  20 shares  ", stockQuantity: " 20.5 ", memo: " thanks " }),
    );
    expect(trimmed).toMatchObject({ stockDescription: "20 shares", stockQuantity: "20.5", memo: "thanks" });
  });

  it("keeps acknowledgeDuplicate when given", () => {
    expect(offlineGiftSchema.parse(valid({ acknowledgeDuplicate: true })).acknowledgeDuplicate).toBe(true);
  });

  it("new donor: every optional key absent gets its default, with a lower-cased email", () => {
    expect(
      offlineGiftSchema.parse(valid({ donor: { mode: "new", displayName: "  Imogen Thackeray " } })).donor,
    ).toEqual({
      mode: "new",
      displayName: "Imogen Thackeray",
      email: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      region: null,
      postalCode: null,
      country: "US",
    });
    expect(
      offlineGiftSchema.parse(
        valid({ donor: { mode: "new", displayName: "A", email: " Imogen@Example.Invalid ", country: " ca " } }),
      ).donor,
    ).toMatchObject({ email: "imogen@example.invalid", country: "CA" });
  });

  it("new donor: field messages come through the donor path", () => {
    expect(
      errorsOf(valid({ donor: { mode: "new", displayName: "", email: "nope", country: "USA" } })),
    ).toEqual({
      "donor.displayName": "Enter the donor's name",
      "donor.email": "Enter an email address like name@example.org, or leave it blank",
      "donor.country": "Use a two-letter country code, like US",
    });
  });

  it("unidentified donor (cash only)", () => {
    expect(offlineGiftSchema.parse(valid({ donor: { mode: "unidentified" } })).donor).toEqual({
      mode: "unidentified",
    });
  });

  it("is idempotent: parsing its own output succeeds with the same output", () => {
    for (const input of [
      valid(),
      valid({ donor: { mode: "new", displayName: "A" }, method: "check", checkNumber: "9" }),
      valid({ donor: { mode: "unidentified" } }),
    ]) {
      const first = offlineGiftSchema.parse(input);
      expect(offlineGiftSchema.parse(first)).toEqual(first);
    }
  });

  it("gives the same messages through the react-hook-form resolver", async () => {
    const out = await resolveForm(offlineGiftSchema, valid({ fundId: "", amount: "" }));
    expect(out.errors).toEqual({ fundId: "Choose a fund", amount: "Enter the amount" });
    const ok = await resolveForm(offlineGiftSchema, valid());
    expect(ok.failed).toBe(false);
  });
});

describe("voidGiftSchema", () => {
  const reason = "Entered twice by mistake";

  it.each([NON_RFC_ROLE_ID, NON_RFC_FIXTURE_ID])("accepts the non-RFC id %s", (id) => {
    expect(voidGiftSchema.safeParse({ giftId: id, reason }).success).toBe(true);
  });

  it("rejects a malformed id (path only: an id with no message is tamper-only)", () => {
    const result = voidGiftSchema.safeParse({ giftId: "not-a-uuid", reason });
    expect(result.success).toBe(false);
    if (!result.success) expect(Object.keys(zodFieldErrors(result.error))).toEqual(["giftId"]);
  });

  it("pins the reason messages", () => {
    const check = (value: string) => {
      const result = voidGiftSchema.safeParse({ giftId: NON_RFC_FIXTURE_ID, reason: value });
      if (result.success) throw new Error("expected failure");
      return zodFieldErrors(result.error);
    };
    expect(check("ab")).toEqual({ reason: "Give a reason of at least a few words" });
    expect(check("   ")).toEqual({ reason: "Give a reason of at least a few words" });
    expect(check("x".repeat(201))).toEqual({ reason: "A reason can be 200 characters at most" });
    expect(check("bad\u0007reason")).toEqual({ reason: "That has a character we can't store" });
  });

  it("trims the reason", () => {
    expect(voidGiftSchema.parse({ giftId: DONOR, reason: `  ${reason}  ` })).toEqual({ giftId: DONOR, reason });
  });
});
