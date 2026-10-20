/**
 * The shapes a contribution statement is built from and rendered from -
 * docs/work-log/2026-10-15-online-giving.md, DECISION-173 and Batch 5b. TYPES
 * ONLY (plus nothing else): no runtime code, no imports, so the composer, the
 * renderer, the wording module and the tests share one vocabulary without any
 * of them pulling a database or `server-only` in.
 *
 * A `StatementSnapshot` is exactly what `giving_statements` + its lines freeze
 * (drizzle/0056), plus the two dates the PDF prints that the row derives:
 *   issuedDate     the ORG-LOCAL calendar date of `issued_at`
 *   replacesDate   for a corrected version, the org-local date the statement it
 *                  supersedes was issued
 * The renderer is a pure function of this value (and the fonts), which is what
 * makes "render once at issue" and "re-render for the print run" agree.
 */

export type StatementLineKind = "cash" | "non_cash";

export interface StatementLineSnapshot {
  lineNo: number;
  giftId: string;
  /** 'YYYY-MM-DD', the gift's organization-local date. */
  occurredOn: string;
  fundLabel: string;
  description: string;
  kind: StatementLineKind;
  /** The COUNTED amount in cents; null for a non-cash line (its value is never printed). */
  amountCents: number | null;
  grossCents: number;
  reversedCents: number;
  coveredFeeCents: number;
}

export interface StatementDonee {
  legalName: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string;
  ein: string | null;
  signatoryName: string | null;
  signatoryTitle: string | null;
}

export interface StatementDelivery {
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  /** ISO alpha-2, or null. */
  country: string | null;
  email: string | null;
}

export interface StatementSnapshot {
  taxYear: number;
  version: number;
  wordingVersion: number;
  /** 'YYYY-MM-DD', org-local. */
  issuedDate: string;
  /** 'YYYY-MM-DD', org-local; set only on a corrected version (version > 1). */
  replacesDate: string | null;
  donee: StatementDonee;
  greetingText: string;
  closingText: string;
  donorName: string;
  delivery: StatementDelivery;
  cashTotalCents: number;
  giftCount: number;
  nonCashCount: number;
  /** The covered-fee policy in force when issued (statement-policy.ts). */
  coveredFeeCounted: boolean;
  lines: StatementLineSnapshot[];
}
