/**
 * Possible-duplicate detection for an offline gift - docs/work-log/
 * 2026-10-15-online-giving.md, Flow 8 ("a possible duplicate - same donor,
 * date, amount, check number - warns and does not hard-block"). PURE.
 *
 * `recordOfflineGift` narrows the candidates in SQL to the one donor's gifts on
 * the one date (cheap, indexed), then asks this function which of them is the
 * same gift. A voided gift is not a duplicate of anything (it was cancelled),
 * and a candidate with a different check number is a different cheque.
 */

export interface GiftFingerprint {
  id: string;
  amountCents: number;
  /** Normalised by `normalizeCheckNumber`; null when the gift has none. */
  checkNumber: string | null;
  voided: boolean;
}

/** Trim + collapse inner whitespace + case-fold; empty -> null. */
export function normalizeCheckNumber(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const folded = value.trim().replace(/\s+/g, " ").toLowerCase();
  return folded === "" ? null : folded;
}

/**
 * The first candidate that is the same gift as `probe`: not voided, same
 * amount, and the same check number (both absent counts as the same).
 */
export function findPossibleDuplicate(
  candidates: readonly GiftFingerprint[],
  probe: { amountCents: number; checkNumber: string | null },
): GiftFingerprint | undefined {
  const probeCheck = normalizeCheckNumber(probe.checkNumber);
  return candidates.find(
    (candidate) =>
      !candidate.voided &&
      candidate.amountCents === probe.amountCents &&
      normalizeCheckNumber(candidate.checkNumber) === probeCheck,
  );
}
