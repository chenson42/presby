import "server-only";
import { proofRecordName, proofRecordValue, PROOF_VALUE_PREFIX } from "./proof";
import type { DnsObserver, DnsRecord } from "./adapters/dns";
import { isCloudflareAddress } from "./adapters/cloudflare-ranges";
import type { RecordHint, RecordStatus } from "./checklist";

/**
 * Checks built on the DNS observer (Phase 3 API Contract section 5). Batch
 * 1a-ii carried the ownership proof; Batch 1b adds the routing checks: where a
 * host's A / AAAA / CNAME point, whether the host is a zone apex (SOA), a
 * Cloudflare-proxied record, a CAA record that blocks the certificate
 * authority, a broken DNSSEC chain, and the nameserver fingerprint.
 *
 * EVERY CHECK IS ADVISORY EXCEPT THE PROOF. Routing results feed the checklist
 * ("Wrong value", "Conflicting - leftover IPv6 record") and decide whether a
 * host may become `live` (a Cloudflare-proxied record may not, operator Q7);
 * they never move a live host out of `live` - that is the probe's job - and
 * `unknown` is its own status, never "missing" (G11, G30).
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

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/** Where the church should point the host, as the provider recommends it (cached in `observation.targets`). */
export interface RoutingTargets {
  cname: string | null;
  ipv4: string[];
}

/**
 * Vercel's long-standing generic targets. They are ACCEPTED as correct (a
 * church whose records are generic needs no change, G12) and used as the
 * DISPLAY fallback only when the provider's recommendation has never been
 * readable (a project-scoped token refused on the team-level config endpoint,
 * Phase 2 R7). The provider's own recommendation always wins when we have one.
 */
export const GENERIC_HOSTING_TARGETS: RoutingTargets = {
  cname: "cname.vercel-dns.com",
  ipv4: ["76.76.21.21"],
};

export interface RoutingCheck {
  hostname: string;
  status: RecordStatus;
  hint: RecordHint | null;
  /** The host is a zone apex (an SOA answers at the exact name): CNAME is not allowed there, so the church needs A / ALIAS. `null` when it could not be determined. */
  apex: boolean | null;
  /** The host's own A / CNAME currently point at the hosting provider: `true`/`false` when definitive, `null` when the lookups could not say. */
  pointsAtProvider: boolean | null;
}

const lower = (s: string) => s.toLowerCase().replace(/\.$/, "");

function normalizedTargets(targets: RoutingTargets | null): { cnames: Set<string>; ips: Set<string> } {
  return {
    cnames: new Set([GENERIC_HOSTING_TARGETS.cname, targets?.cname].filter((v): v is string => !!v).map(lower)),
    ips: new Set([...GENERIC_HOSTING_TARGETS.ipv4, ...(targets?.ipv4 ?? [])]),
  };
}

/** RFC 3597 `\# <len> <hex>` or presentation `<flags> <tag> "<value>"` -> parts, or null. */
export function parseCaaData(data: string): { flags: number; tag: string; value: string } | null {
  const trimmed = data.trim();
  const generic = /^\\#\s+(\d+)\s*((?:[0-9a-fA-F]{2}\s*)*)$/.exec(trimmed);
  if (generic) {
    const hex = (generic[2] ?? "").replace(/\s+/g, "");
    if (hex.length % 2 !== 0 || hex.length / 2 !== Number(generic[1])) return null;
    const bytes = Buffer.from(hex, "hex");
    if (bytes.length < 2) return null;
    const tagLength = bytes[1]!;
    if (bytes.length < 2 + tagLength) return null;
    return {
      flags: bytes[0]!,
      tag: bytes.subarray(2, 2 + tagLength).toString("ascii").toLowerCase(),
      value: bytes.subarray(2 + tagLength).toString("utf8"),
    };
  }
  const m = /^(\d+)\s+([A-Za-z0-9]+)\s+"?([^"]*)"?$/.exec(trimmed);
  if (!m) return null;
  return { flags: Number(m[1]), tag: (m[2] ?? "").toLowerCase(), value: m[3] ?? "" };
}

/** The certificate authority the hosting provider issues from. */
const CERTIFICATE_AUTHORITY = "letsencrypt.org";

/**
 * Walks from `hostname` up the name tree to the closest name that has a CAA
 * record set (RFC 8659), and reports whether that set forbids the provider's
 * certificate authority. `blocked: null` when a lookup could not say or a
 * record could not be read (never accuse on doubt).
 */
export async function checkCaa(
  observer: DnsObserver,
  hostname: string,
): Promise<{ blocked: boolean | null }> {
  const labels = hostname.split(".");
  // Never climb into the TLD: stop at two labels.
  for (let i = 0; i <= labels.length - 2; i += 1) {
    const name = labels.slice(i).join(".");
    const obs = await observer.lookup(name, "CAA");
    if (obs.kind === "unknown") return { blocked: null };
    if (obs.records.length === 0) continue;
    const parsed = obs.records.map((r) => parseCaaData(r.data));
    if (parsed.some((p) => p === null)) return { blocked: null };
    const issue = parsed.filter((p): p is NonNullable<typeof p> => p !== null && p.tag === "issue");
    if (issue.length === 0) return { blocked: false }; // a CAA set that restricts no issuance
    const allowed = issue.some((p) => p.value.split(";")[0]!.trim().toLowerCase() === CERTIFICATE_AUTHORITY);
    return { blocked: !allowed };
  }
  return { blocked: false };
}

/**
 * Where do `hostname`'s records point, and is anything wrong with them?
 *
 *   status  correct      CNAME to the provider's target, or A records all in the provider's set
 *           missing      both resolvers say there is no A and no CNAME
 *           wrong_value  records exist and point somewhere else (hint `proxied`
 *                        when the A answers are Cloudflare's edge)
 *           conflicting  A records split between the provider and elsewhere; a
 *                        leftover AAAA (hint `leftover_aaaa`); a CAA record that
 *                        forbids the provider's CA (hint `caa`); a broken DNSSEC
 *                        chain (hint `dnssec`)
 *           unknown      the lookups could not say
 *
 * `diagnose` adds the CAA and DNSSEC probing, worth its extra lookups only
 * while a host is waiting for its certificate (`attached`); a `live` host
 * already has one.
 */
export async function checkRouting(
  observer: DnsObserver,
  hostname: string,
  targets: RoutingTargets | null,
  opts: { diagnose: boolean },
): Promise<RoutingCheck> {
  const isWww = hostname.startsWith("www.");
  const [cnameObs, aObs, aaaaObs, soaObs] = await Promise.all([
    observer.lookup(hostname, "CNAME"),
    observer.lookup(hostname, "A"),
    observer.lookup(hostname, "AAAA"),
    isWww ? Promise.resolve(null) : observer.lookup(hostname, "SOA"),
  ]);
  const apex: boolean | null = isWww ? false : soaObs === null ? null : soaObs.kind === "present" ? true : soaObs.kind === "absent" ? false : null;

  // A broken DNSSEC chain looks like SERVFAIL from validating resolvers and a
  // clean answer with checking disabled.
  const servfail = (o: { kind: string; reasons?: string[] }) =>
    o.kind === "unknown" && (o.reasons?.length ?? 0) > 0 && (o.reasons ?? []).every((r) => r === "servfail");
  if (servfail(cnameObs) && servfail(aObs)) {
    const unchecked = await observer.lookup(hostname, "A", undefined, { checkingDisabled: true });
    if (unchecked.kind !== "unknown") {
      return { hostname, status: "conflicting", hint: "dnssec", apex, pointsAtProvider: null };
    }
  }

  const accepted = normalizedTargets(targets);
  const cnames = cnameObs.records.map((r: DnsRecord) => lower(r.data));
  const addresses = aObs.records.map((r: DnsRecord) => r.data);

  let status: RecordStatus;
  let hint: RecordHint | null = null;
  let pointsAtProvider: boolean | null;
  if (cnames.length > 0) {
    const good = cnames.some((c) => accepted.cnames.has(c));
    status = good ? "correct" : "wrong_value";
    pointsAtProvider = good;
  } else if (addresses.length > 0) {
    const mine = addresses.filter((a) => accepted.ips.has(a));
    pointsAtProvider = mine.length > 0;
    if (mine.length === addresses.length) {
      status = "correct";
    } else if (mine.length > 0) {
      status = "conflicting";
    } else {
      status = "wrong_value";
      if (addresses.some(isCloudflareAddress)) hint = "proxied";
    }
  } else if (aObs.kind === "absent" && cnameObs.kind === "absent") {
    status = "missing";
    pointsAtProvider = false;
  } else {
    status = "unknown";
    pointsAtProvider = null;
  }

  if (aaaaObs.records.length > 0) {
    if (status === "correct" || status === "missing" || status === "unknown") status = "conflicting";
    hint ??= "leftover_aaaa";
  }

  if (opts.diagnose) {
    const caa = await checkCaa(observer, hostname);
    if (caa.blocked === true) {
      if (status === "correct" || status === "missing" || status === "unknown") status = "conflicting";
      hint ??= "caa";
    }
  }

  return { hostname, status, hint, apex, pointsAtProvider };
}

// ---------------------------------------------------------------------------
// Nameserver fingerprint (the passive-DNS-replay tripwire)
// ---------------------------------------------------------------------------

export type NsFingerprint =
  | { kind: "ok"; fingerprint: string }
  | { kind: "none" }
  | { kind: "unknown" };

/**
 * The sorted nameserver set of the closest zone at or above `claimName`. Taken
 * once when a claim is first verified and compared on later checks: a changed
 * set is the signature of a domain that changed hands (or a delegation that
 * moved), so it NOTIFIES and never enforces (an ordinary host migration looks
 * the same).
 */
export async function lookupNsFingerprint(observer: DnsObserver, claimName: string): Promise<NsFingerprint> {
  const labels = claimName.split(".");
  for (let i = 0; i <= labels.length - 2; i += 1) {
    const obs = await observer.lookup(labels.slice(i).join("."), "NS");
    if (obs.kind === "unknown") return { kind: "unknown" };
    if (obs.records.length > 0) {
      return { kind: "ok", fingerprint: [...new Set(obs.records.map((r) => lower(r.data)))].sort().join(",") };
    }
  }
  return { kind: "none" };
}
