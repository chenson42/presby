import { describe, expect, it } from "vitest";
import { GIVE_MESSAGES } from "./giving-copy";
import { GIVE_FORM_FIELDS, isSlugShaped, parseGiveForm } from "./give-input";

const FUND = "d9100000-0000-0000-0000-0000000000a1";
const KEY = "3b0f1c2e-5a4d-4c7e-9b1a-6d2f8e0a1c3d";

function form(fields: Record<string, string | undefined> = {}): FormData {
  const base: Record<string, string | undefined> = {
    amount: "25",
    fundId: FUND,
    frequency: "once",
    method: "card",
    idempotencyKey: KEY,
    ...fields,
  };
  const fd = new FormData();
  for (const [name, value] of Object.entries(base)) if (value !== undefined) fd.set(name, value);
  return fd;
}

describe("parseGiveForm", () => {
  it("parses a well-formed form to integer cents and normalized fields", () => {
    const parsed = parseGiveForm(form({ amount: "37.50", frequency: "monthly", coverFees: "on", method: "bank" }));
    expect(parsed).toEqual({
      ok: true,
      value: {
        amountCents: 3750,
        fundId: FUND,
        frequency: "monthly",
        coverFees: true,
        method: "bank",
        idempotencyKey: KEY,
      },
    });
  });

  it("an absent coverFees is false; only `on` and `true` are true", () => {
    expect(parseGiveForm(form({ coverFees: undefined }))).toMatchObject({ ok: true, value: { coverFees: false } });
    expect(parseGiveForm(form({ coverFees: "on" }))).toMatchObject({ ok: true, value: { coverFees: true } });
    expect(parseGiveForm(form({ coverFees: "true" }))).toMatchObject({ ok: true, value: { coverFees: true } });
    expect(parseGiveForm(form({ coverFees: "yes" }))).toMatchObject({ ok: true, value: { coverFees: false } });
  });

  it("lowercases an uppercase fund id and key (the database wants lowercase hex)", () => {
    const parsed = parseGiveForm(form({ fundId: FUND.toUpperCase(), idempotencyKey: KEY.toUpperCase() }));
    expect(parsed).toMatchObject({ ok: true, value: { fundId: FUND, idempotencyKey: KEY } });
  });

  // regression for the amount-tampering row of the adversarial table
  it.each([
    ["10.999", "amount"],
    ["1e3", "amount"],
    ["-5", "amount"],
    ["٣٠", "amount"], // Arabic-Indic digits
    ["３０", "amount"], // fullwidth digits
    ["1,000", "amount"],
    ["$25", "amount"],
    [".5", "amount"],
    ["5.", "amount"],
    ["0x10", "amount"],
    ["25 ", "ok"], // trimmed
    ["", "amount"],
    ["   ", "amount"],
    ["0.99", "amount"],
    ["25000.01", "amount"],
    ["99999999999999999999", "amount"],
    ["1".repeat(500), "amount"],
  ])("amount %j -> %s", (amount, expected) => {
    const parsed = parseGiveForm(form({ amount }));
    if (expected === "ok") {
      expect(parsed.ok).toBe(true);
    } else {
      expect(parsed).toMatchObject({ ok: false, result: { kind: "invalid", field: expected } });
    }
  });

  it("names the amount problem in words a donor can act on", () => {
    expect(parseGiveForm(form({ amount: "" }))).toMatchObject({ result: { message: GIVE_MESSAGES.amountEmpty } });
    expect(parseGiveForm(form({ amount: "abc" }))).toMatchObject({ result: { message: GIVE_MESSAGES.amountFormat } });
    expect(parseGiveForm(form({ amount: "0.50" }))).toMatchObject({ result: { message: GIVE_MESSAGES.amountTooSmall } });
    expect(parseGiveForm(form({ amount: "30000" }))).toMatchObject({ result: { message: GIVE_MESSAGES.amountTooLarge } });
  });

  it("accepts exactly the online bounds, $1.00 and $25,000.00", () => {
    expect(parseGiveForm(form({ amount: "1" }))).toMatchObject({ ok: true, value: { amountCents: 100 } });
    expect(parseGiveForm(form({ amount: "25000" }))).toMatchObject({ ok: true, value: { amountCents: 2_500_000 } });
  });

  it("refuses a missing or malformed fund, frequency, method and key, each naming its field", () => {
    expect(parseGiveForm(form({ fundId: undefined }))).toMatchObject({ result: { field: "fund" } });
    expect(parseGiveForm(form({ fundId: "not-a-uuid" }))).toMatchObject({ result: { field: "fund" } });
    expect(parseGiveForm(form({ frequency: "weekly" }))).toMatchObject({ result: { field: "frequency" } });
    expect(parseGiveForm(form({ frequency: undefined }))).toMatchObject({ result: { field: "frequency" } });
    expect(parseGiveForm(form({ method: "cash" }))).toMatchObject({ result: { field: "method" } });
    expect(parseGiveForm(form({ method: undefined }))).toMatchObject({ result: { field: "method" } });
    expect(parseGiveForm(form({ idempotencyKey: "abc" }))).toMatchObject({ result: { field: "form" } });
    expect(parseGiveForm(form({ idempotencyKey: undefined }))).toMatchObject({ result: { field: "form" } });
  });

  it("covering the fees needs a chosen method: coverFees with `either` is a method error", () => {
    expect(parseGiveForm(form({ coverFees: "on", method: "either" }))).toMatchObject({
      ok: false,
      result: { field: "method", message: GIVE_MESSAGES.methodForFees },
    });
    expect(parseGiveForm(form({ coverFees: undefined, method: "either" })).ok).toBe(true);
  });

  it("reports the FIRST wrong field in form order: amount before fund before frequency before method", () => {
    const fd = form({ amount: "x", fundId: "x", frequency: "x", method: "x" });
    expect(parseGiveForm(fd)).toMatchObject({ result: { field: "amount" } });
    const fd2 = form({ fundId: "x", frequency: "x", method: "x" });
    expect(parseGiveForm(fd2)).toMatchObject({ result: { field: "fund" } });
    const fd3 = form({ frequency: "x", method: "x" });
    expect(parseGiveForm(fd3)).toMatchObject({ result: { field: "frequency" } });
  });

  it("a File where a string belongs reads as empty, never as its filename", () => {
    const fd = form();
    fd.set("amount", new File(["25"], "25"));
    expect(parseGiveForm(fd)).toMatchObject({ ok: false, result: { field: "amount", message: GIVE_MESSAGES.amountEmpty } });
  });

  it("ignores fields it does not know (a membership id in the form changes nothing)", () => {
    const parsed = parseGiveForm(form({ membershipId: "11111111-1111-1111-1111-111111111111", donorId: "x" }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(Object.keys(parsed.value).sort()).toEqual(
      ["amountCents", "coverFees", "frequency", "fundId", "idempotencyKey", "method"],
    );
  });
});

describe("GIVE_FORM_FIELDS", () => {
  it("is the contract the form must honour", () => {
    expect(GIVE_FORM_FIELDS).toEqual({
      amount: "amount",
      fundId: "fundId",
      frequency: "frequency",
      coverFees: "coverFees",
      method: "method",
      idempotencyKey: "idempotencyKey",
      honeypot: "_hp",
      turnstileToken: "turnstileToken",
      turnstileWidgetField: "cf-turnstile-response",
    });
  });
});

describe("isSlugShaped", () => {
  it("accepts a DNS label and nothing else", () => {
    expect(isSlugShaped("alder-creek")).toBe(true);
    expect(isSlugShaped("a")).toBe(true);
    for (const bad of ["", "Alder", "-a", "a-", "a_b", "a/b", "a b", "a".repeat(64), "../etc", "a:b", 7, null, undefined]) {
      expect(isSlugShaped(bad), String(bad)).toBe(false);
    }
  });
});
