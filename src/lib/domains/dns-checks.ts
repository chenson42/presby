import "server-only";
import { proofRecordName, proofRecordValue, PROOF_VALUE_PREFIX } from "./proof";
import type { DnsObserver } from "./adapters/dns";

/**
 * Checks built on the DNS observer. Batch 1a-ii carries the ownership proof;
 * the routing, CAA, DNSSEC, apex and Cloudflare-proxy checks arrive with the
 * hosting provider in Batch 1b (Phase 3 API Contract section 5).
 */

export type ProofCheck =
  /** The expected `presby-verify=<token>` value is at `_presby-challenge.<claim>`. */
  | { status: "present" }
  /** Both resolvers answered and the name holds no `presby-verify=` value. */
  | { status: "absent" }
  /** Both resolvers answered; the name holds `presby-verify=` values, none ours. */
  | { status: "wrong_value" }
  /** A resolver errored or the resolvers disagreed: never evidence of absence. */
  | { status: "unknown" };

export async function checkProof(
  observer: DnsObserver,
  claimName: string,
  token: string,
): Promise<ProofCheck> {
  const expected = proofRecordValue(token);
  const observation = await observer.lookup(
    proofRecordName(claimName),
    "TXT",
    (record) => record.data === expected,
  );
  if (observation.kind === "present") return { status: "present" };
  if (observation.kind === "unknown") return { status: "unknown" };
  const otherProof = observation.records.some((r) => r.data.startsWith(PROOF_VALUE_PREFIX));
  return { status: otherProof ? "wrong_value" : "absent" };
}
