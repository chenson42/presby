/**
 * Invented statement snapshots for the unit tests - TEST SUPPORT ONLY. Names,
 * addresses and the EIN are synthetic (No Real Data); `example.invalid` mail.
 */
import type { StatementLineSnapshot, StatementSnapshot } from "./snapshot";

export function sampleLine(overrides: Partial<StatementLineSnapshot> = {}): StatementLineSnapshot {
  return {
    lineNo: 1,
    giftId: "00000000-0000-4000-8000-000000000001",
    occurredOn: "2027-03-07",
    fundLabel: "General Fund",
    description: "Check #1042",
    kind: "cash",
    amountCents: 25000,
    grossCents: 25000,
    reversedCents: 0,
    coveredFeeCents: 0,
    ...overrides,
  };
}

export function sampleSnapshot(overrides: Partial<StatementSnapshot> = {}): StatementSnapshot {
  const lines = overrides.lines ?? [
    sampleLine(),
    sampleLine({
      lineNo: 2,
      giftId: "00000000-0000-4000-8000-000000000002",
      occurredOn: "2027-06-20",
      fundLabel: "Building Fund",
      description: "Online gift (card)",
      amountCents: 10181,
      grossCents: 10181,
      coveredFeeCents: 181,
    }),
  ];
  const cash = lines.filter((l) => l.kind === "cash").reduce((s, l) => s + (l.amountCents ?? 0), 0);
  return {
    taxYear: 2027,
    version: 1,
    wordingVersion: 1,
    issuedDate: "2028-01-15",
    replacesDate: null,
    donee: {
      legalName: "Fixture Presbyterian Church",
      line1: "1 Fixture Way",
      line2: null,
      city: "Fixtureville",
      region: "OH",
      postalCode: "00000",
      ein: "00-0000000",
      signatoryName: "Tess Treasurer",
      signatoryTitle: "Treasurer",
    },
    greetingText: "Dear {donor_name},",
    closingText: "With gratitude for your generosity,",
    donorName: "Linden Marsh",
    delivery: {
      line1: "22 Example Lane",
      line2: null,
      city: "Fixtureville",
      region: "OH",
      postalCode: "00000",
      country: "US",
      email: "linden@example.invalid",
    },
    cashTotalCents: cash,
    giftCount: lines.length,
    nonCashCount: lines.filter((l) => l.kind === "non_cash").length,
    coveredFeeCounted: true,
    lines,
    ...overrides,
  };
}
