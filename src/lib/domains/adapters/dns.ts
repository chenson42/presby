import "server-only";

/**
 * dns.ts - the DNS adapter interface and its DNS-over-HTTPS implementation
 * (Phase 2 R7; Phase 3 API Contract section 5; DECISION-179).
 *
 * WHY DoH OVER `fetch` AND NOT `node:dns`: `dns/promises` reports no DNSSEC
 * (AD) status and the platform resolver caches differently locally and on
 * Vercel (Phase 2 dependency table). DoH is zero dependencies.
 *
 * TWO INDEPENDENT RESOLVERS, ONE QUORUM RULE. A lapse is a destructive
 * conclusion ("the church no longer controls this name"), so it needs both
 * resolvers to POSITIVELY answer "absent". Any error, timeout or malformed
 * answer from either is `unknown`, and `unknown` never counts toward a lapse
 * (G9). A POSITIVE needs only one: if either resolver shows the record, it is
 * there.
 *
 *   present  >= 1 resolver answered ok and shows a record that matches
 *   absent   EVERY resolver answered ok and none shows a match
 *   unknown  anything else (an error from any resolver while none shows a match)
 *
 * The endpoints are fixed, so there is no SSRF surface; the queried NAME is
 * still validated as a hostname-shaped string (underscore labels allowed,
 * because the proof sits at `_presby-challenge.<name>`) before it is placed in
 * a URL, and redirects are refused.
 */

export type DnsType = "A" | "AAAA" | "CNAME" | "TXT" | "CAA" | "SOA" | "NS";

export interface DnsRecord {
  type: DnsType;
  /** The owner name, lowercase, no trailing dot. */
  name: string;
  /** TXT: unquoted and joined; CNAME/NS: lowercase, no trailing dot; others verbatim. */
  data: string;
  ttl: number;
}

export type DnsErrorReason = "timeout" | "servfail" | "http_error" | "malformed";

export type DnsAnswer =
  | {
      kind: "ok";
      rcode: "noerror" | "nxdomain";
      /** Only records of the QUERIED type (a CNAME chain in the answer is dropped). */
      records: DnsRecord[];
      /** The DoH `AD` bit: the resolver validated DNSSEC. */
      authenticated: boolean;
    }
  | { kind: "error"; reason: DnsErrorReason };

export interface DnsResolver {
  /** A stable label for logs and the fake's per-resolver overrides; never shown to users. */
  readonly id: string;
  query(name: string, type: DnsType): Promise<DnsAnswer>;
}

export type DnsObservation =
  | { kind: "present"; records: DnsRecord[] }
  | { kind: "absent"; records: DnsRecord[] }
  | { kind: "unknown"; records: DnsRecord[] };

export interface DnsObserver {
  /**
   * Quorum lookup. `match` decides which records count as "the record" (default:
   * any record of the type). `records` is every record of that type seen by any
   * resolver that answered ok, so a caller can tell an empty name from a name
   * holding other values.
   */
  lookup(
    name: string,
    type: DnsType,
    match?: (record: DnsRecord) => boolean,
  ): Promise<DnsObservation>;
}

// ---------------------------------------------------------------------------
// Quorum
// ---------------------------------------------------------------------------

export class QuorumDnsObserver implements DnsObserver {
  constructor(private readonly resolvers: readonly DnsResolver[]) {
    if (resolvers.length === 0) throw new Error("QuorumDnsObserver needs at least one resolver");
  }

  async lookup(
    name: string,
    type: DnsType,
    match: (record: DnsRecord) => boolean = () => true,
  ): Promise<DnsObservation> {
    const answers = await Promise.all(
      this.resolvers.map((resolver) =>
        resolver.query(name, type).catch((): DnsAnswer => ({ kind: "error", reason: "http_error" })),
      ),
    );
    const ok = answers.filter(
      (a): a is Extract<DnsAnswer, { kind: "ok" }> => a.kind === "ok",
    );
    const records = ok.flatMap((a) => a.records);
    if (records.some(match)) return { kind: "present", records };
    if (ok.length === answers.length) return { kind: "absent", records };
    return { kind: "unknown", records };
  }
}

// ---------------------------------------------------------------------------
// Query-name validation
// ---------------------------------------------------------------------------

const QUERY_LABEL = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;

/** A DNS name safe to place in a DoH query string. Underscore labels are allowed. */
export function isQueryableName(name: string): boolean {
  if (name.length === 0 || name.length > 253) return false;
  return name.split(".").every((label) => QUERY_LABEL.test(label));
}

// ---------------------------------------------------------------------------
// DoH response parsing
// ---------------------------------------------------------------------------

const TYPE_NUMBER: Record<number, DnsType> = {
  1: "A",
  2: "NS",
  5: "CNAME",
  6: "SOA",
  16: "TXT",
  28: "AAAA",
  257: "CAA",
};

/**
 * Unquotes a TXT `data` string. Resolvers return `"v=a"` for one segment and
 * `"seg1" "seg2"` for a multi-segment record (joined with no separator, as DNS
 * defines). Escapes `\"`, `\\` and `\DDD` (decimal) are decoded. An unquoted
 * value is returned as-is.
 */
export function parseTxtData(data: string): string {
  const trimmed = data.trim();
  if (!trimmed.startsWith('"')) return trimmed;
  const segments = [...trimmed.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  if (segments.length === 0) return trimmed;
  return segments
    .map((s) =>
      s.replace(/\\(\d{3}|.)/g, (_m, esc: string) =>
        /^\d{3}$/.test(esc) ? String.fromCharCode(Number(esc)) : esc,
      ),
    )
    .join("");
}

function ownerName(raw: string): string {
  const lower = raw.toLowerCase();
  return lower.endsWith(".") ? lower.slice(0, -1) : lower;
}

function recordData(type: DnsType, raw: string): string {
  switch (type) {
    case "TXT":
      return parseTxtData(raw);
    case "CNAME":
    case "NS":
      return ownerName(raw.trim());
    case "A":
    case "AAAA":
      return raw.trim().toLowerCase();
    default:
      return raw.trim();
  }
}

/** Parses one DoH JSON body (Cloudflare and Google share this shape). */
export function parseDohResponse(body: unknown, queried: DnsType): DnsAnswer {
  if (typeof body !== "object" || body === null) return { kind: "error", reason: "malformed" };
  const j = body as Record<string, unknown>;
  if (typeof j.Status !== "number") return { kind: "error", reason: "malformed" };

  if (j.Status !== 0 && j.Status !== 3) return { kind: "error", reason: "servfail" };
  const rcode = j.Status === 3 ? "nxdomain" : "noerror";

  const rawAnswer = j.Answer === undefined ? [] : j.Answer;
  if (!Array.isArray(rawAnswer)) return { kind: "error", reason: "malformed" };

  const records: DnsRecord[] = [];
  for (const entry of rawAnswer) {
    if (typeof entry !== "object" || entry === null) return { kind: "error", reason: "malformed" };
    const a = entry as Record<string, unknown>;
    if (typeof a.name !== "string" || typeof a.type !== "number" || typeof a.data !== "string") {
      return { kind: "error", reason: "malformed" };
    }
    const type = TYPE_NUMBER[a.type];
    if (type !== queried) continue;
    records.push({
      type,
      name: ownerName(a.name),
      data: recordData(type, a.data),
      ttl: typeof a.TTL === "number" ? a.TTL : 0,
    });
  }
  return { kind: "ok", rcode, records, authenticated: j.AD === true };
}

// ---------------------------------------------------------------------------
// The DoH resolver
// ---------------------------------------------------------------------------

export const CLOUDFLARE_DOH = "https://cloudflare-dns.com/dns-query";
export const GOOGLE_DOH = "https://dns.google/resolve";

export class DohResolver implements DnsResolver {
  constructor(
    readonly id: string,
    private readonly endpoint: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 4000,
  ) {}

  async query(name: string, type: DnsType): Promise<DnsAnswer> {
    if (!isQueryableName(name)) return { kind: "error", reason: "malformed" };
    const url = `${this.endpoint}?name=${encodeURIComponent(name)}&type=${type}`;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: { accept: "application/dns-json" },
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "error",
        cache: "no-store",
      });
    } catch (err) {
      const aborted =
        err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      return { kind: "error", reason: aborted ? "timeout" : "http_error" };
    }
    if (!response.ok) return { kind: "error", reason: "http_error" };

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: "error", reason: "malformed" };
    }
    return parseDohResponse(body, type);
  }
}

/** The two production resolvers: Cloudflare and Google, independent operators. */
export function createDohObserver(fetchImpl: typeof fetch = fetch): DnsObserver {
  return new QuorumDnsObserver([
    new DohResolver("cloudflare", CLOUDFLARE_DOH, fetchImpl),
    new DohResolver("google", GOOGLE_DOH, fetchImpl),
  ]);
}
