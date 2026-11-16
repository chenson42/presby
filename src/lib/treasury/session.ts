/**
 * The Node-side 2FA check, now living in `src/lib/org-portal/session-check.ts`
 * (DECISION-338) so a non-treasury (org) surface can share it. This file keeps
 * the treasury names as aliases of the same function objects; every giving and
 * reimbursement import and test is unchanged, and `giving/access-pure.ts`
 * still re-exports from here.
 */
export {
  assertOrgSession as assertTreasurySession,
  orgTotpRedirectUrl as treasuryTotpRedirectUrl,
} from "@/lib/org-portal/session-check";
export type {
  OrgSessionLike as TreasurySessionLike,
  OrgSessionCheck as TreasurySessionCheck,
} from "@/lib/org-portal/session-check";
