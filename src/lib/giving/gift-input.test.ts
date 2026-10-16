import { describe, expect, it } from "vitest";
import {
  AMOUNT_REASON_COPY,
  offlineAmountCents,
  offlineGiftSchema,
  parseGiftFilters,
  voidGiftSchema,
} from "./gift-input";
import { giftFieldName, giftFormToInput, type GiftFormValues } from "./gift-form-mapping";
import { zodFieldErrors } from "./field-errors";

const FUND = "44444444-4444-4444-8444-444444444444";
const DONOR = "55555555-5555-4555-8555-555555555555";

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

describe("offlineGiftSchema: the accepted shapes", () => {
  it("accepts a cash gift from an existing donor", () => {
    const result = offlineGiftSchema.safeParse(valid());
    expect(result.success).toBe(true);
    expect(offlineAmountCents("125.50")).toBe(12_550);
  });

  it("accepts a check with a number, normalised to null when blank", () => {
    const withNumber = offlineGiftSchema.parse(valid({ method: "check", checkNumber: " 1042 " }));
    expect(withNumber.checkNumber).toBe("1042");
    const blank = offlineGiftSchema.parse(valid({ method: "check", checkNumber: "" }));
    expect(blank.checkNumber).toBeNull();
  });

  it("accepts stock with a description and a quantity", () => {
    const parsed = offlineGiftSchema.parse(
      valid({ method: "stock", stockDescription: "20 shares of an index fund", stockQuantity: "20.5" }),
    );
    expect(parsed.stockDescription).toBe("20 shares of an index fund");
    expect(parsed.stockQuantity).toBe("20.5");
  });

  it("accepts a new donor and normalises the email", () => {
    const parsed = offlineGiftSchema.parse(
      valid({ donor: { mode: "new", displayName: "  Imogen Thackeray ", email: " Imogen@Example.Invalid " } }),
    );
    expect(parsed.donor).toMatchObject({ mode: "new", displayName: "Imogen Thackeray", email: "imogen@example.invalid", country: "US" });
  });

  it("accepts an unidentified (plate) cash gift", () => {
    expect(offlineGiftSchema.safeParse(valid({ donor: { mode: "unidentified" } })).success).toBe(true);
  });

  it("is idempotent: re-parsing its own output succeeds (the form sends output back through the action)", () => {
    const first = offlineGiftSchema.parse(valid({ method: "check", checkNumber: "9" }));
    expect(offlineGiftSchema.safeParse(first).success).toBe(true);
  });
});

describe("offlineGiftSchema: the refusals, each inline and in words", () => {
  it("names an unusable amount", () => {
    expect(errorsOf(valid({ amount: "" })).amount).toBe(AMOUNT_REASON_COPY.empty);
    expect(errorsOf(valid({ amount: "$5" })).amount).toBe(AMOUNT_REASON_COPY.format);
    expect(errorsOf(valid({ amount: "1e3" })).amount).toBe(AMOUNT_REASON_COPY.format);
    expect(errorsOf(valid({ amount: "10.999" })).amount).toBe(AMOUNT_REASON_COPY.format);
    expect(errorsOf(valid({ amount: "0" })).amount).toBe(AMOUNT_REASON_COPY.too_small);
    expect(errorsOf(valid({ amount: "1000000.01" })).amount).toBe(AMOUNT_REASON_COPY.too_large);
  });

  it("allows the top of the offline range ($1,000,000.00)", () => {
    expect(offlineGiftSchema.safeParse(valid({ amount: "1000000" })).success).toBe(true);
  });

  it("refuses a date that is not a real calendar date", () => {
    expect(errorsOf(valid({ occurredOn: "2026-02-30" })).occurredOn).toMatch(/year-month-day/);
    expect(errorsOf(valid({ occurredOn: "04/12/2026" })).occurredOn).toMatch(/year-month-day/);
    expect(errorsOf(valid({ occurredOn: "" })).occurredOn).toMatch(/year-month-day/);
  });

  it("refuses a check number on a non-check", () => {
    expect(errorsOf(valid({ method: "cash", checkNumber: "5" })).checkNumber).toMatch(/only goes with a check/);
  });

  it("requires a stock description for stock, and refuses stock details on anything else", () => {
    expect(errorsOf(valid({ method: "stock" })).stockDescription).toMatch(/Describe the stock/);
    expect(errorsOf(valid({ method: "cash", stockDescription: "x" })).stockDescription).toMatch(/only go with a stock gift/);
  });

  it("validates the share quantity", () => {
    const stock = { method: "stock", stockDescription: "ABC" };
    expect(errorsOf(valid({ ...stock, stockQuantity: "abc" })).stockQuantity).toMatch(/plain number/);
    expect(errorsOf(valid({ ...stock, stockQuantity: "0" })).stockQuantity).toMatch(/more than zero/);
    expect(errorsOf(valid({ ...stock, stockQuantity: "1.1234567" })).stockQuantity).toMatch(/plain number/);
  });

  it("allows only cash from an unidentified donor", () => {
    expect(errorsOf(valid({ donor: { mode: "unidentified" }, method: "check" })).method).toMatch(/Only cash/);
  });

  it("requires a name for a new donor and a donor id for an existing one", () => {
    expect(errorsOf(valid({ donor: { mode: "new", displayName: "  " } }))["donor.displayName"]).toMatch(/Enter the donor/);
    expect(errorsOf(valid({ donor: { mode: "existing", donorId: "nope" } }))["donor.donorId"]).toMatch(/Choose a donor/);
  });

  it("refuses an unusable new-donor email", () => {
    expect(errorsOf(valid({ donor: { mode: "new", displayName: "A", email: "not-an-email" } }))["donor.email"]).toMatch(/name@example/);
  });

  it("refuses a control character in a note", () => {
    expect(errorsOf(valid({ memo: "bad\u0007note" })).memo).toMatch(/character we can't store/);
  });

  it("refuses an unknown method and a bad fund id", () => {
    expect(offlineGiftSchema.safeParse(valid({ method: "bitcoin" })).success).toBe(false);
    expect(errorsOf(valid({ fundId: "x" })).fundId).toMatch(/Choose a fund/);
  });
});

describe("voidGiftSchema", () => {
  it("needs a reason of 3 to 200 characters", () => {
    const giftId = "66666666-6666-4666-8666-666666666666";
    expect(voidGiftSchema.safeParse({ giftId, reason: "ab" }).success).toBe(false);
    expect(voidGiftSchema.safeParse({ giftId, reason: "  keyed twice " }).success).toBe(true);
    expect(voidGiftSchema.safeParse({ giftId, reason: "x".repeat(201) }).success).toBe(false);
    expect(voidGiftSchema.safeParse({ giftId, reason: "x".repeat(200) }).success).toBe(true);
  });
});

describe("parseGiftFilters: a query string anyone can edit", () => {
  it("keeps valid filters", () => {
    expect(
      parseGiftFilters({ from: "2026-01-01", to: "2026-12-31", fund: FUND, status: "failed", source: "online", donor: DONOR }),
    ).toEqual({ from: "2026-01-01", to: "2026-12-31", fundId: FUND, status: "failed", source: "online", donorId: DONOR });
  });

  it("DROPS anything unusable instead of erroring", () => {
    expect(
      parseGiftFilters({ from: "yesterday", to: "2026-02-30", fund: "x", status: "nope", source: "mail", donor: "1" }),
    ).toEqual({});
  });

  it("takes the first of a repeated parameter and ignores blanks", () => {
    expect(parseGiftFilters({ status: ["pending", "failed"], from: "" })).toEqual({ status: "pending" });
  });
});

describe("the form <-> server mapping", () => {
  const base: GiftFormValues = {
    donorMode: "existing",
    donorId: DONOR,
    newName: "",
    newEmail: "",
    newAddressLine1: "",
    newCity: "",
    newRegion: "",
    newPostalCode: "",
    fundId: FUND,
    occurredOn: "2026-04-12",
    method: "cash",
    amount: "10",
    checkNumber: "left over",
    stockDescription: "left over",
    stockQuantity: "3",
    memo: "",
  };

  it("builds the existing-donor union branch and drops fields that don't apply to the method", () => {
    const input = giftFormToInput(base);
    expect(input.donor).toEqual({ mode: "existing", donorId: DONOR });
    expect(input.checkNumber).toBe("");
    expect(input.stockDescription).toBe("");
    expect(offlineGiftSchema.safeParse(input).success).toBe(true);
  });

  it("builds the new-donor branch from the flat fields", () => {
    const input = giftFormToInput({ ...base, donorMode: "new", newName: "Rowan Fenwick", newCity: "Dover" });
    expect(input.donor).toMatchObject({ mode: "new", displayName: "Rowan Fenwick", city: "Dover" });
  });

  it("builds the unidentified branch and carries the acknowledge flag", () => {
    const input = giftFormToInput({ ...base, donorMode: "unidentified" }, true);
    expect(input.donor).toEqual({ mode: "unidentified" });
    expect(input.acknowledgeDuplicate).toBe(true);
  });

  it("maps schema issue paths back to the flat field names", () => {
    expect(giftFieldName("donor.donorId")).toBe("donorId");
    expect(giftFieldName("donor.displayName")).toBe("newName");
    expect(giftFieldName("donor.email")).toBe("newEmail");
    expect(giftFieldName("amount")).toBe("amount");
    expect(giftFieldName("_form")).toBe("_form");
  });
});
