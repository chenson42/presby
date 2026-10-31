/**
 * The reimbursement permission keys and the org-toggle key -
 * docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 "Permissions & Flags".
 * PURE: no database, no `server-only`; a `'use client'` file may import it.
 *
 * There is NO `reimbursement.request` key (DECISION-269): who may FILE is
 * `presby_reimbursement_may_file` (an active membership, an unmerged person
 * linked to the acting user, and a roll status or engagement of regular or
 * staff). Approval is a SEAT (chair or leader of the charged group), checked
 * live in a definer (DECISION-268), never a key. These four keys are the
 * tier-2 money keys, added by drizzle/0074.
 *
 * Permissions and flags stay separate (DECISION-003): this feature has no
 * platform flag. `REIMBURSEMENT_TOGGLE_KEY` is a per-ORGANIZATION toggle
 * (`org_portal.reimbursement`, provisioned off), enforced in TypeScript only
 * (P3-15).
 */

export const REIMBURSEMENT_TOGGLE_KEY = "org_portal.reimbursement" as const;

export const REIMBURSEMENT_KEYS = {
  requestForOthers: "reimbursement.request_for_others",
  view: "reimbursement.view",
  pay: "reimbursement.pay",
  manage: "reimbursement.manage",
} as const;

export type ReimbursementKey = (typeof REIMBURSEMENT_KEYS)[keyof typeof REIMBURSEMENT_KEYS];

/** The viewer's four keys, as read live in one round trip (no key implies another). */
export interface ReimbursementHas {
  requestForOthers: boolean;
  view: boolean;
  pay: boolean;
  manage: boolean;
}

/** A page, action or route is open to a holder of ANY of the named keys. */
export type ReimbursementNeed = keyof ReimbursementHas;

/** The treasury keys: holding any of these makes the "Treasurer view" link appear. */
export const TREASURY_NEEDS: readonly ReimbursementNeed[] = ["view", "pay", "manage"];

/**
 * The role templates the Treasury team page may set up (`ensureTreasuryRoleAction`'s
 * closed list): the Treasurer, and the Reimbursement Clerk that carries
 * `request_for_others` alone (P3-2). `team.db.test.ts` pins it equal to
 * `TEAM_SURFACES.reimbursement.templateKeys`, which is what the library reads.
 */
export const TEAM_TEMPLATE_KEYS = ["treasurer", "reimbursement_clerk"] as const;
export type TeamTemplateKey = (typeof TEAM_TEMPLATE_KEYS)[number];
