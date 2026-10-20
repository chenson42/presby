/**
 * Composing a statement from gift rows - docs/work-log/2026-10-15-online-
 * giving.md, Batch 5b, and the counting rule drizzle/0056 enforces at COMMIT
 * (deviation S4). PURE: gift rows in, lines and totals out, no database.
 *
 * THE COUNTING RULE (this is a restatement of 0056's, not a variant - the
 * deferred consistency trigger refuses a statement that disagrees with it):
 *   - only gifts dated inside the tax year, by `occurred_on` alone (the
 *     organization-local date, F132) - never `created_at`, never a timestamp;
 *   - `remaining = gross - net reversed - (covered fee, unless the policy
 *     counts it)` - reversals are signed (a reinstatement offsets), computed
 *     by the caller and passed as `reversedCents`;
 *   - `remaining <= 0` is NOT on the statement (a fully refunded gift is gone);
 *   - `method = 'stock'` is a NON-CASH line: described, never valued, its
 *     amount is null; every other method is a cash line whose amount is
 *     `remaining`;
 *   - `line_no` runs 1..n in (occurred_on, gift id) order.
 * Live-mode and succeeded filtering happens in the query (`liveSucceededGift`);
 * this function sees only gifts that already passed it.
 *
 * Text is clamped to the column limits 0056 enforces (fund label 80,
 * description 300) so a long fund or stock description is shortened rather
 * than refused at insert. The donor's name arrives already bounded by the
 * `giving_donors` CHECK (<= 120).
 */
import type { StatementLineSnapshot, StatementSnapshot, StatementDonee, StatementDelivery } from "./snapshot";
import { DEFAULT_CLOSING, DEFAULT_GREETING } from "./wording";

/** One gift of the donor-root group as the query reads it. */
export interface CountingGift {
  giftId: string;
  /** 'YYYY-MM-DD' */
  occurredOn: string;
  source: "online" | "offline";
  method: string | null;
  fundName: string;
  stockDescription: string | null;
  /** numeric text, e.g. '10' or '2.5' */
  stockQuantity: string | null;
  checkNumber: string | null;
  grossCents: number;
  coveredFeeCents: number;
  /** Net of reversals AS OF NOW (a reinstatement subtracts). */
  reversedCents: number;
}

export interface ComposedLines {
  lines: StatementLineSnapshot[];
  cashTotalCents: number;
  giftCount: number;
  nonCashCount: number;
}

const FUND_LABEL_MAX = 80;
const DESCRIPTION_MAX = 300;

function clamp(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

/** 'YYYY-MM-DD' strictly inside [Jan 1, Dec 31] of `taxYear`. Lexicographic compare is exact for this shape. */
export function inTaxYear(occurredOn: string, taxYear: number): boolean {
  return occurredOn >= `${taxYear}-01-01` && occurredOn <= `${taxYear}-12-31`;
}

function trimQuantity(quantity: string): string {
  return quantity.includes(".") ? quantity.replace(/0+$/, "").replace(/\.$/, "") : quantity;
}

/** What a line says about how the gift arrived. Plain words; the value of stock is never among them. */
export function describeGift(gift: CountingGift): string {
  if (gift.method === "stock") {
    const what = gift.stockDescription?.trim() || "Securities";
    const quantity = gift.stockQuantity ? ` (${trimQuantity(gift.stockQuantity)} shares)` : "";
    return clamp(`Stock: ${what}${quantity}`, DESCRIPTION_MAX);
  }
  if (gift.method === "cash") return "Cash";
  if (gift.method === "check") {
    return clamp(gift.checkNumber?.trim() ? `Check #${gift.checkNumber.trim()}` : "Check", DESCRIPTION_MAX);
  }
  if (gift.source === "online") {
    if (gift.method === "card") return "Online gift (card)";
    if (gift.method === "us_bank_account") return "Online gift (bank transfer)";
    if (gift.method === "wallet") return "Online gift (digital wallet)";
    return "Online gift";
  }
  return "Gift";
}

export function composeLines(
  gifts: readonly CountingGift[],
  options: { taxYear: number; coveredFeeCounted: boolean },
): ComposedLines {
  const counted = gifts
    .filter((g) => inTaxYear(g.occurredOn, options.taxYear))
    .map((g) => ({
      gift: g,
      remaining: g.grossCents - g.reversedCents - (options.coveredFeeCounted ? 0 : g.coveredFeeCents),
    }))
    .filter((c) => c.remaining > 0)
    .sort((a, b) =>
      a.gift.occurredOn === b.gift.occurredOn
        ? a.gift.giftId < b.gift.giftId
          ? -1
          : a.gift.giftId > b.gift.giftId
            ? 1
            : 0
        : a.gift.occurredOn < b.gift.occurredOn
          ? -1
          : 1,
    );

  const lines: StatementLineSnapshot[] = counted.map(({ gift, remaining }, index) => {
    const nonCash = gift.method === "stock";
    return {
      lineNo: index + 1,
      giftId: gift.giftId,
      occurredOn: gift.occurredOn,
      fundLabel: clamp(gift.fundName, FUND_LABEL_MAX) || "Fund",
      description: describeGift(gift),
      kind: nonCash ? "non_cash" : "cash",
      amountCents: nonCash ? null : remaining,
      grossCents: gift.grossCents,
      reversedCents: gift.reversedCents,
      coveredFeeCents: gift.coveredFeeCents,
    };
  });

  return {
    lines,
    cashTotalCents: lines.reduce((sum, l) => sum + (l.kind === "cash" ? (l.amountCents ?? 0) : 0), 0),
    giftCount: lines.length,
    nonCashCount: lines.filter((l) => l.kind === "non_cash").length,
  };
}

/** What `giving_settings` holds (all nullable until saved). */
export interface SettingsForStatement {
  doneeLegalName: string | null;
  doneeAddressLine1: string | null;
  doneeAddressLine2: string | null;
  doneeCity: string | null;
  doneeRegion: string | null;
  doneePostalCode: string | null;
  doneeEin: string | null;
  signatoryName: string | null;
  signatoryTitle: string | null;
  greetingText: string | null;
  closingText: string | null;
}

export interface DonorForStatement {
  displayName: string;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
}

/** The donee snapshot, or the blockers that make one impossible. The set is exactly 0056's NOT NULL / shape set. */
export function doneeFromSettings(
  settings: SettingsForStatement,
): { ok: true; donee: StatementDonee } | { ok: false; blockers: Array<"donee_name" | "donee_address"> } {
  const blockers: Array<"donee_name" | "donee_address"> = [];
  if (!settings.doneeLegalName?.trim()) blockers.push("donee_name");
  if (
    !settings.doneeAddressLine1?.trim() ||
    !settings.doneeCity?.trim() ||
    !settings.doneeRegion ||
    !settings.doneePostalCode
  ) {
    blockers.push("donee_address");
  }
  if (blockers.length > 0) return { ok: false, blockers };
  return {
    ok: true,
    donee: {
      legalName: settings.doneeLegalName!.trim(),
      line1: settings.doneeAddressLine1!.trim(),
      line2: settings.doneeAddressLine2?.trim() || null,
      city: settings.doneeCity!.trim(),
      region: settings.doneeRegion!,
      postalCode: settings.doneePostalCode!,
      ein: settings.doneeEin || null,
      signatoryName: settings.signatoryName?.trim() || null,
      signatoryTitle: settings.signatoryTitle?.trim() || null,
    },
  };
}

export function deliveryFromDonor(donor: DonorForStatement): StatementDelivery {
  return {
    line1: donor.addressLine1,
    line2: donor.addressLine2,
    city: donor.city,
    region: donor.region,
    postalCode: donor.postalCode,
    country: donor.country,
    email: donor.email,
  };
}

/**
 * The full snapshot a statement is issued from. `greetingText` / `closingText`
 * snapshot what is PRINTED: the settings value, or the default when the
 * congregation left it blank (0056 requires both non-blank).
 */
export function buildSnapshot(input: {
  taxYear: number;
  version: number;
  wordingVersion: number;
  issuedDate: string;
  replacesDate: string | null;
  donee: StatementDonee;
  settings: Pick<SettingsForStatement, "greetingText" | "closingText">;
  donor: DonorForStatement;
  composed: ComposedLines;
  coveredFeeCounted: boolean;
}): StatementSnapshot {
  return {
    taxYear: input.taxYear,
    version: input.version,
    wordingVersion: input.wordingVersion,
    issuedDate: input.issuedDate,
    replacesDate: input.replacesDate,
    donee: input.donee,
    greetingText: input.settings.greetingText?.trim() || DEFAULT_GREETING,
    closingText: input.settings.closingText?.trim() || DEFAULT_CLOSING,
    donorName: input.donor.displayName,
    delivery: deliveryFromDonor(input.donor),
    cashTotalCents: input.composed.cashTotalCents,
    giftCount: input.composed.giftCount,
    nonCashCount: input.composed.nonCashCount,
    coveredFeeCounted: input.coveredFeeCounted,
    lines: input.composed.lines,
  };
}
