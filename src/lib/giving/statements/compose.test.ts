/**
 * Composing a statement's lines (Batch 5b) - the pure restatement of the
 * counting rule drizzle/0056 enforces at COMMIT. The database-backed suite
 * proves the two agree on real rows; this one pins the arithmetic.
 */
import { describe, expect, it } from "vitest";
import { buildSnapshot, composeLines, deliveryFromDonor, describeGift, doneeFromSettings, inTaxYear, type CountingGift } from "./compose";

let n = 0;
function gift(overrides: Partial<CountingGift> = {}): CountingGift {
  n += 1;
  return {
    giftId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    occurredOn: "2027-03-07",
    source: "offline",
    method: "cash",
    fundName: "General Fund",
    stockDescription: null,
    stockQuantity: null,
    checkNumber: null,
    grossCents: 10000,
    coveredFeeCents: 0,
    reversedCents: 0,
    ...overrides,
  };
}
const opts = { taxYear: 2027, coveredFeeCounted: true };

describe("composeLines", () => {
  it("totals cash and counts non-cash separately; a stock line has no amount", () => {
    const out = composeLines(
      [gift({ grossCents: 10000 }), gift({ grossCents: 2550, method: "check", checkNumber: "1042" }), gift({ method: "stock", grossCents: 99900, stockDescription: "10 shares of Example Corp", stockQuantity: "10.000000" })],
      opts,
    );
    expect(out.giftCount).toBe(3);
    expect(out.nonCashCount).toBe(1);
    expect(out.cashTotalCents).toBe(12550);
    const stock = out.lines.find((l) => l.kind === "non_cash")!;
    expect(stock.amountCents).toBeNull();
    expect(stock.description).toBe("Stock: 10 shares of Example Corp (10 shares)");
  });

  it("nets reversals: a partial refund reduces the line, a full refund removes the gift", () => {
    const partial = gift({ grossCents: 10000, reversedCents: 2500 });
    const full = gift({ grossCents: 4000, reversedCents: 4000 });
    const out = composeLines([partial, full], opts);
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0]).toMatchObject({ giftId: partial.giftId, amountCents: 7500, grossCents: 10000, reversedCents: 2500 });
    expect(out.cashTotalCents).toBe(7500);
  });

  it("follows the covered-fee policy constant: counted keeps the whole charge, not counted removes the fee", () => {
    const g = gift({ source: "online", method: "card", grossCents: 10181, coveredFeeCents: 181 });
    expect(composeLines([g], { taxYear: 2027, coveredFeeCounted: true }).lines[0]!.amountCents).toBe(10181);
    expect(composeLines([g], { taxYear: 2027, coveredFeeCounted: false }).lines[0]!.amountCents).toBe(10000);
    expect(composeLines([g], { taxYear: 2027, coveredFeeCounted: false }).lines[0]!.coveredFeeCents).toBe(181);
  });

  it("a gift whose whole amount was the covered fee drops out when fees are not counted", () => {
    const g = gift({ grossCents: 181, coveredFeeCents: 180 });
    expect(composeLines([g], { taxYear: 2027, coveredFeeCounted: false }).lines).toHaveLength(1);
    const feeOnly = gift({ grossCents: 200, coveredFeeCents: 200 });
    expect(composeLines([feeOnly], { taxYear: 2027, coveredFeeCounted: false }).lines).toHaveLength(0);
  });

  it("decides the year by occurred_on alone: Dec 31 is in, Jan 1 of the next year and Dec 31 of the last are out", () => {
    const out = composeLines(
      [gift({ occurredOn: "2027-12-31" }), gift({ occurredOn: "2028-01-01" }), gift({ occurredOn: "2026-12-31" }), gift({ occurredOn: "2027-01-01" })],
      opts,
    );
    expect(out.lines.map((l) => l.occurredOn)).toEqual(["2027-01-01", "2027-12-31"]);
    expect(inTaxYear("2027-06-30", 2027)).toBe(true);
    expect(inTaxYear("2028-01-01", 2027)).toBe(false);
  });

  it("numbers lines 1..n in (date, id) order whatever order the gifts arrive in", () => {
    const a = gift({ occurredOn: "2027-05-01" });
    const b = gift({ occurredOn: "2027-02-01" });
    const c = gift({ occurredOn: "2027-05-01" });
    const out = composeLines([c, a, b], opts);
    expect(out.lines.map((l) => l.lineNo)).toEqual([1, 2, 3]);
    expect(out.lines.map((l) => l.giftId)).toEqual([b.giftId, a.giftId, c.giftId]);
  });

  it("an empty year composes to nothing", () => {
    expect(composeLines([], opts)).toEqual({ lines: [], cashTotalCents: 0, giftCount: 0, nonCashCount: 0 });
  });

  it("clamps text to the column limits 0056 enforces", () => {
    const out = composeLines([gift({ fundName: "F".repeat(200) }), gift({ method: "stock", stockDescription: "S".repeat(900) })], opts);
    for (const line of out.lines) {
      expect(line.fundLabel.length).toBeLessThanOrEqual(80);
      expect(line.description.length).toBeLessThanOrEqual(300);
      expect(line.fundLabel.length).toBeGreaterThan(0);
    }
  });
});

describe("describeGift", () => {
  it("speaks plainly about how each gift arrived", () => {
    expect(describeGift(gift({ method: "cash" }))).toBe("Cash");
    expect(describeGift(gift({ method: "check", checkNumber: "77" }))).toBe("Check #77");
    expect(describeGift(gift({ method: "check" }))).toBe("Check");
    expect(describeGift(gift({ source: "online", method: "card" }))).toBe("Online gift (card)");
    expect(describeGift(gift({ source: "online", method: "us_bank_account" }))).toBe("Online gift (bank transfer)");
    expect(describeGift(gift({ method: "stock", stockDescription: null }))).toBe("Stock: Securities");
    expect(describeGift(gift({ method: "other" }))).toBe("Gift");
  });
});

describe("doneeFromSettings", () => {
  const complete = {
    doneeLegalName: " Fixture Presbyterian Church ", doneeAddressLine1: "1 Fixture Way", doneeAddressLine2: null, doneeCity: "Fixtureville",
    doneeRegion: "OH", doneePostalCode: "00000", doneeEin: "00-0000000", signatoryName: null, signatoryTitle: null, greetingText: null, closingText: null,
  };
  it("names exactly the blockers when the identity is incomplete", () => {
    expect(doneeFromSettings({ ...complete, doneeLegalName: null })).toEqual({ ok: false, blockers: ["donee_name"] });
    expect(doneeFromSettings({ ...complete, doneeCity: "" })).toEqual({ ok: false, blockers: ["donee_address"] });
    expect(doneeFromSettings({ ...complete, doneeLegalName: "  ", doneePostalCode: null })).toEqual({ ok: false, blockers: ["donee_name", "donee_address"] });
  });
  it("trims and returns the snapshot when complete", () => {
    const out = doneeFromSettings(complete);
    expect(out).toMatchObject({ ok: true, donee: { legalName: "Fixture Presbyterian Church", ein: "00-0000000", line2: null } });
  });
});

describe("buildSnapshot", () => {
  it("snapshots the greeting and closing PRINTED: the settings value, or the default when blank", () => {
    const donee = (doneeFromSettings({
      doneeLegalName: "X", doneeAddressLine1: "1 A St", doneeAddressLine2: null, doneeCity: "B", doneeRegion: "OH", doneePostalCode: "00000",
      doneeEin: null, signatoryName: null, signatoryTitle: null, greetingText: null, closingText: null,
    }) as { ok: true; donee: never }).donee;
    const donor = { displayName: "Linden Marsh", email: "l@example.invalid", addressLine1: null, addressLine2: null, city: null, region: null, postalCode: null, country: "US" };
    const composed = composeLines([gift()], opts);
    const blank = buildSnapshot({ taxYear: 2027, version: 1, wordingVersion: 1, issuedDate: "2028-01-15", replacesDate: null, donee, settings: { greetingText: null, closingText: "  " }, donor, composed, coveredFeeCounted: true });
    expect(blank.greetingText).toBe("Dear {donor_name},");
    expect(blank.closingText).toBe("With gratitude for your generosity,");
    const custom = buildSnapshot({ taxYear: 2027, version: 1, wordingVersion: 1, issuedDate: "2028-01-15", replacesDate: null, donee, settings: { greetingText: "Friend {donor_name},", closingText: "Peace," }, donor, composed, coveredFeeCounted: true });
    expect(custom).toMatchObject({ greetingText: "Friend {donor_name},", closingText: "Peace,", donorName: "Linden Marsh", cashTotalCents: 10000 });
    expect(deliveryFromDonor(donor).email).toBe("l@example.invalid");
  });
});
