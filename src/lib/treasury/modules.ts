/**
 * The permission MODULES the treasury team page may delegate -
 * docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 P3-14 and Data Model
 * ("Roles that must not carry any money key"). PURE.
 *
 * A role is "treasury-only" when EVERY key it carries has `permissions.module`
 * in this set (and it carries at least one). The narrow, audited team path
 * (`./team.ts`) works only on such roles, which keeps the F138 delegation
 * path from becoming a way to hand out `roles.manage`, `directory.view` or any
 * other key outside the money surfaces.
 *
 * ADDING A MODULE HERE IS A SECURITY DECISION. Each module in the set must have
 * its own F301 downward-guard triggers (a key of that module never travels a
 * commission or delegation); `reimbursement.db.test.ts` pins this set to the
 * modules that have such guards. 'giving' has them from drizzle/0055 section 15
 * and 'reimbursement' from drizzle/0073 section 5.
 */
export const TREASURY_MODULES = ["giving", "reimbursement"] as const;

export type TreasuryModule = (typeof TREASURY_MODULES)[number];
