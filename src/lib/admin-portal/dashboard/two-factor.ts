import "server-only";
import { countStranded } from "@/lib/admin/two-factor-stranded";
import { readCard, type CardResult } from "./read-card";

/**
 * Two-factor card: active accounts that are required to use two-factor but have
 * not enrolled. A COUNT ONLY, no address and no member count. The predicate lives
 * in `src/lib/admin/two-factor-stranded.ts`, outside this directory on purpose:
 * it resolves "required" through people and memberships, the one recorded
 * exception to the platform-axis rule (DECISION-252, F276). Operator ruling:
 * keep the card.
 */
export interface TwoFactorCard {
  notEnrolled: number;
}

export function readTwoFactorCard(): Promise<CardResult<TwoFactorCard>> {
  return readCard("two-factor", async () => ({ notEnrolled: await countStranded() }));
}
