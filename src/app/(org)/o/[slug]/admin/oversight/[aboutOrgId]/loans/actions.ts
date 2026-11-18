"use server";

import { finish, invalidResult, parseVersion, resolveOversightActor, staleResult } from "@/lib/oversight/action-gate";
import type { OversightActionResult } from "@/lib/oversight/contract";
import { markLoanPaidOff, recordLoan, removeLoan, updateLoan } from "@/lib/oversight/store";
import { parseLoan, parsePaidOff, type LoanValues, type PaidOffValues } from "@/lib/oversight/validate";

/**
 * The loan actions (docs/work-log/2026-11-17-congregation-profile.md, Phase 3
 * "API Contract"). All `congregation_oversight.finance` (tier 2), checked inside
 * `store.ts`'s transaction, which writes the audit row in that same transaction.
 * `updateLoanAction`'s `status` is the status the form shows: a paid-off loan sent
 * back as "open" is a reopen (the result's `data.reopened`).
 */

export async function recordLoanAction(
  slug: string,
  aboutOrgId: string,
  values: LoanValues,
): Promise<OversightActionResult> {
  const gate = await resolveOversightActor(slug, { aboutOrgId });
  if (!gate.ok) return gate.result;
  const parsed = parseLoan(values, gate.identity.env);
  if (!parsed.ok) return invalidResult(parsed);
  return finish(gate.identity, aboutOrgId, await recordLoan(gate.identity.ctx, aboutOrgId, parsed.value));
}

export async function updateLoanAction(
  slug: string,
  aboutOrgId: string,
  loanId: string,
  values: LoanValues,
  expectedVersion: number,
): Promise<OversightActionResult> {
  const gate = await resolveOversightActor(slug, { aboutOrgId, loanId });
  if (!gate.ok) return gate.result;
  const parsed = parseLoan(values, gate.identity.env);
  if (!parsed.ok) return invalidResult(parsed);
  const version = parseVersion(expectedVersion);
  if (version === null) return staleResult;
  return finish(
    gate.identity,
    aboutOrgId,
    await updateLoan(gate.identity.ctx, aboutOrgId, loanId, parsed.value, version),
  );
}

export async function markLoanPaidOffAction(
  slug: string,
  aboutOrgId: string,
  loanId: string,
  values: PaidOffValues,
): Promise<OversightActionResult> {
  const gate = await resolveOversightActor(slug, { aboutOrgId, loanId });
  if (!gate.ok) return gate.result;
  const parsed = parsePaidOff(values, gate.identity.env);
  if (!parsed.ok) return invalidResult(parsed);
  return finish(gate.identity, aboutOrgId, await markLoanPaidOff(gate.identity.ctx, aboutOrgId, loanId, parsed.value));
}

export async function removeLoanAction(
  slug: string,
  aboutOrgId: string,
  loanId: string,
): Promise<OversightActionResult> {
  const gate = await resolveOversightActor(slug, { aboutOrgId, loanId });
  if (!gate.ok) return gate.result;
  return finish(gate.identity, aboutOrgId, await removeLoan(gate.identity.ctx, aboutOrgId, loanId));
}
