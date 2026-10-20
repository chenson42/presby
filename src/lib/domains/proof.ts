/**
 * proof.ts - the TXT ownership proof's naming, PURE (shared by the service,
 * the DNS checks and the checklist view-model).
 *
 * The proof for a claim name N sits at `_presby-challenge.N` with the value
 * `presby-verify=<token>` and covers N and `www.N`; a proof at `www.N` covers
 * only itself (Phase 2 R10). The token is per claim group (same organization +
 * claim name) and is minted by the service; it is a bearer of "I may claim
 * this name", so it is NEVER written to an audit row, a log line or an email.
 */

export const PROOF_LABEL = "_presby-challenge";
export const PROOF_VALUE_PREFIX = "presby-verify=";

export function proofRecordName(claimName: string): string {
  return `${PROOF_LABEL}.${claimName}`;
}

export function proofRecordValue(token: string): string {
  return `${PROOF_VALUE_PREFIX}${token}`;
}

/** The `presby-verify=` values among a set of TXT strings (other TXT is ignored). */
export function proofValuesIn(txtValues: readonly string[]): string[] {
  return txtValues.filter((v) => v.startsWith(PROOF_VALUE_PREFIX));
}
