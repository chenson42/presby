import "server-only";
import { readFileSync } from "node:fs";
import type {
  DnsAnswer,
  DnsErrorReason,
  DnsObserver,
  DnsQueryOptions,
  DnsRecord,
  DnsResolver,
  DnsType,
} from "./dns";
import { QuorumDnsObserver } from "./dns";
import type {
  AddResult,
  ConfigResult,
  GetResult,
  HostingChallenge,
  HostingProvider,
  RemoveResult,
  VerifyResult,
} from "./hosting";
import type { ProbeClient, ProbeOutcome } from "./probe";

/**
 * fake.ts - in-memory and file-driven fakes for the domain adapters
 * (Phase 3 API Contract section 5, "Fake"). TEST AND DEVELOPMENT ONLY.
 *
 * `FakeDnsResolver` is a zone map with error injection and a call log, so a
 * test can assert "no DNS query was made" as readily as "this answer came
 * back". `createFakeDns()` builds the two-resolver quorum the real observer
 * uses, with a handle on each resolver, so quorum behaviour (one errors, one
 * disagrees) is testable with the real `QuorumDnsObserver`.
 *
 * The state file lets a Playwright spec set DNS answers by writing a JSON file
 * on disk (Batch 1c/1d), with no code in the app under test changing between
 * "DNS says X" and "DNS says Y". It is read on EVERY query, and ignored when
 * `NODE_ENV === "production"`; the production build assertion additionally
 * refuses `DOMAINS_FAKE_STATE_FILE` and `DOMAINS_DNS_PROVIDER=fake`
 * (host.ts `assertPlatformHostConfig`). The file also carries the `hosting` and
 * `probe` sections (Batch 1b), so a cron walk on a dev server can script the
 * whole lifecycle - DNS, the hosting provider and the live-ness probe - by
 * rewriting one JSON file between sweeps.
 */

export interface FakeDnsState {
  /** `"<TYPE> <name>"` -> the values at that name, for every resolver. */
  zone?: Record<string, string[]>;
  /** resolver id -> the error every query to it returns. */
  errors?: Record<string, DnsErrorReason>;
  /** resolver id -> a zone that REPLACES `zone` for that resolver (a disagreement). */
  perResolver?: Record<string, Record<string, string[]>>;
  /** Names that SERVFAIL when validated and answer normally with checking disabled (a broken DNSSEC chain). */
  dnssecBroken?: string[];
}

/** The failures the fake hosting provider can be told to return, by operation. */
export type FakeHostingFailure =
  | "unavailable"
  | "rate_limited"
  | "deployment_not_ready"
  | "token_invalid"
  | "token_forbidden"
  | "project_missing"
  | "payment_required"
  | "blocked_other_project"
  | "blocked_no_access"
  | "rejected";

export type FakeHostingOp = "add" | "get" | "verify" | "config" | "remove";

export interface FakeHostingState {
  /** Hosts attached from the start. `verified: false` plus `verification` simulates a name in another account. */
  attached?: Record<string, { verified?: boolean; verification?: HostingChallenge[] }>;
  /** op (or "all") -> a failure every such call returns. */
  failures?: Partial<Record<FakeHostingOp | "all", FakeHostingFailure>>;
  /** `getConfig`: "denied" simulates a project-scoped token refused on the team endpoint. */
  config?:
    | "denied"
    | { misconfigured?: boolean; recommendedCname?: string | null; recommendedIpv4?: string[] };
}

export interface FakeState {
  dns?: FakeDnsState;
  hosting?: FakeHostingState;
  /** host -> the probe outcome. A host not listed is `unknown`. */
  probe?: Record<string, ProbeOutcome>;
}

export type FakeStateReader = () => FakeState | null;

/** Reads `DOMAINS_FAKE_STATE_FILE` (default `.tmp/domains-fake.json`); null when absent, unreadable, or in production. */
export function fileStateReader(
  path = process.env.DOMAINS_FAKE_STATE_FILE || ".tmp/domains-fake.json",
): FakeStateReader {
  return () => {
    if (process.env.NODE_ENV === "production") return null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      return typeof parsed === "object" && parsed !== null ? (parsed as FakeState) : null;
    } catch {
      return null;
    }
  };
}

const key = (type: DnsType, name: string) => `${type} ${name.toLowerCase()}`;

function toRecords(type: DnsType, name: string, values: readonly string[]): DnsRecord[] {
  return values.map((data) => ({ type, name: name.toLowerCase(), data, ttl: 300 }));
}

export class FakeDnsResolver implements DnsResolver {
  private readonly zone = new Map<string, string[]>();
  private failure: DnsErrorReason | null = null;
  /** Every query this resolver has answered, in order. */
  readonly calls: Array<{ name: string; type: DnsType }> = [];

  constructor(
    readonly id: string,
    private readonly readState: FakeStateReader = () => null,
  ) {}

  setRecord(type: DnsType, name: string, ...values: string[]): this {
    this.zone.set(key(type, name), [...(this.zone.get(key(type, name)) ?? []), ...values]);
    return this;
  }

  clearRecords(type: DnsType, name: string): this {
    this.zone.delete(key(type, name));
    return this;
  }

  /** Every query returns this error until cleared with `null`. */
  failWith(reason: DnsErrorReason | null): this {
    this.failure = reason;
    return this;
  }

  private readonly broken = new Set<string>();

  /** Makes validated queries for `name` SERVFAIL (a broken DNSSEC chain); `checkingDisabled` queries still answer. */
  breakDnssec(name: string): this {
    this.broken.add(name.toLowerCase());
    return this;
  }

  async query(name: string, type: DnsType, options: DnsQueryOptions = {}): Promise<DnsAnswer> {
    this.calls.push({ name, type });
    const state = this.readState()?.dns;
    const injected = this.failure ?? state?.errors?.[this.id] ?? null;
    if (injected !== null) return { kind: "error", reason: injected };
    const brokenNames = new Set([...this.broken, ...(state?.dnssecBroken ?? []).map((n) => n.toLowerCase())]);
    if (!options.checkingDisabled && brokenNames.has(name.toLowerCase())) {
      return { kind: "error", reason: "servfail" };
    }

    const merged = new Map<string, string[]>(this.zone);
    const fileZone = state?.perResolver?.[this.id] ?? state?.zone ?? {};
    for (const [k, v] of Object.entries(fileZone)) merged.set(k.replace(/^(\S+) (.*)$/, (_m, t: string, n: string) => `${t} ${n.toLowerCase()}`), v);

    const values = merged.get(key(type, name)) ?? [];
    const nameKnown = [...merged.keys()].some((k) => k.endsWith(` ${name.toLowerCase()}`));
    return {
      kind: "ok",
      rcode: nameKnown ? "noerror" : "nxdomain",
      records: toRecords(type, name, values),
      authenticated: false,
    };
  }
}

export interface FakeDns {
  observer: DnsObserver;
  cloudflare: FakeDnsResolver;
  google: FakeDnsResolver;
  /** Sets a record on BOTH resolvers (the normal case). */
  setRecord(type: DnsType, name: string, ...values: string[]): void;
  clearRecords(type: DnsType, name: string): void;
  /** Breaks the DNSSEC chain for `name` on BOTH resolvers. */
  breakDnssec(name: string): void;
  /** Total queries answered by both resolvers. */
  queryCount(): number;
}

export function createFakeDns(readState: FakeStateReader = () => null): FakeDns {
  const cloudflare = new FakeDnsResolver("cloudflare", readState);
  const google = new FakeDnsResolver("google", readState);
  return {
    observer: new QuorumDnsObserver([cloudflare, google]),
    cloudflare,
    google,
    setRecord(type, name, ...values) {
      cloudflare.setRecord(type, name, ...values);
      google.setRecord(type, name, ...values);
    },
    clearRecords(type, name) {
      cloudflare.clearRecords(type, name);
      google.clearRecords(type, name);
    },
    breakDnssec(name) {
      cloudflare.breakDnssec(name);
      google.breakDnssec(name);
    },
    queryCount: () => cloudflare.calls.length + google.calls.length,
  };
}

// ---------------------------------------------------------------------------
// Hosting provider fake
// ---------------------------------------------------------------------------

interface FakeAttachment {
  verified: boolean;
  verification: HostingChallenge[];
}

type Injected = { failure: FakeHostingFailure; retryAfterSeconds?: number; remaining: number };

/**
 * An in-memory hosting provider. Memory is the primary state (attached hosts,
 * a call log, injected failures); the state file's `hosting` section is an
 * overlay read on every call, so a spec or a dev-server cron walk can attach a
 * host, deny `getConfig`, or make every `add` fail by writing JSON.
 *
 * `add` is idempotent the way Vercel's is (a second add of an attached name is
 * `already_on_project`), which is the property reconciliation depends on, so
 * the fake is faithful to it.
 */
export class FakeHosting implements HostingProvider {
  /** Every call, in order - assert "no provider call was made" as readily as "it was made". */
  readonly calls: Array<{ op: FakeHostingOp; host: string }> = [];
  private readonly attached = new Map<string, FakeAttachment>();
  private readonly injected = new Map<FakeHostingOp | "all", Injected>();
  /** Hosts whose next `add` reports `verified: false` with this challenge until `verify` is called. */
  private readonly pendingChallenge = new Map<string, HostingChallenge[]>();
  private configState:
    | "denied"
    | { misconfigured: boolean; recommendedCname: string | null; recommendedIpv4: string[] } = {
    misconfigured: false,
    recommendedCname: "cname.vercel-dns.invalid",
    recommendedIpv4: ["192.0.2.10"],
  };

  constructor(private readonly readState: FakeStateReader = () => null) {}

  // ---- test controls ------------------------------------------------------

  callsOf(op: FakeHostingOp): string[] {
    return this.calls.filter((c) => c.op === op).map((c) => c.host);
  }

  /** `times` bounds how many calls fail (default: until cleared with `null`). */
  failWith(
    op: FakeHostingOp | "all",
    failure: FakeHostingFailure | null,
    options: { times?: number; retryAfterSeconds?: number } = {},
  ): this {
    if (failure === null) this.injected.delete(op);
    else
      this.injected.set(op, {
        failure,
        retryAfterSeconds: options.retryAfterSeconds,
        remaining: options.times ?? Number.POSITIVE_INFINITY,
      });
    return this;
  }

  attach(host: string, attachment: Partial<FakeAttachment> = {}): this {
    this.attached.set(host, { verified: attachment.verified ?? true, verification: attachment.verification ?? [] });
    return this;
  }

  detach(host: string): this {
    this.attached.delete(host);
    return this;
  }

  isAttached(host: string): boolean {
    return this.attached.has(host) || Boolean(this.readState()?.hosting?.attached?.[host]);
  }

  /** The next `add` of `host` attaches it UNVERIFIED with this challenge (a name in another account) until `verify`. */
  requireChallenge(host: string, challenge: HostingChallenge[]): this {
    this.pendingChallenge.set(host, challenge);
    return this;
  }

  /** The church published the provider's challenge: the next `verify` succeeds. */
  satisfyChallenge(host: string): this {
    this.pendingChallenge.delete(host);
    return this;
  }

  setConfig(config: { misconfigured?: boolean; recommendedCname?: string | null; recommendedIpv4?: string[] } | "denied"): this {
    this.configState =
      config === "denied"
        ? "denied"
        : {
            misconfigured: config.misconfigured ?? false,
            recommendedCname: config.recommendedCname === undefined ? "cname.vercel-dns.invalid" : config.recommendedCname,
            recommendedIpv4: config.recommendedIpv4 ?? ["192.0.2.10"],
          };
    return this;
  }

  // ---- internals ----------------------------------------------------------

  private snapshot(host: string): FakeAttachment | null {
    const mem = this.attached.get(host);
    if (mem) return mem;
    const file = this.readState()?.hosting?.attached?.[host];
    return file ? { verified: file.verified ?? true, verification: file.verification ?? [] } : null;
  }

  /** The failure to return for `op`, consuming one of its remaining uses. */
  private failureFor(op: FakeHostingOp): { failure: FakeHostingFailure; retryAfterSeconds?: number } | null {
    for (const key of [op, "all"] as const) {
      const hit = this.injected.get(key);
      if (hit && hit.remaining > 0) {
        hit.remaining -= 1;
        return hit;
      }
    }
    const file = this.readState()?.hosting?.failures;
    const failure = file?.[op] ?? file?.all;
    return failure ? { failure } : null;
  }

  private static asAdd(f: { failure: FakeHostingFailure; retryAfterSeconds?: number }): AddResult {
    switch (f.failure) {
      case "unavailable":
        return { kind: "retryable", reason: "unavailable", retryAfterSeconds: f.retryAfterSeconds };
      case "rate_limited":
        return { kind: "retryable", reason: "rate_limited", retryAfterSeconds: f.retryAfterSeconds };
      case "deployment_not_ready":
        return { kind: "retryable", reason: "deployment_not_ready" };
      case "token_invalid":
      case "token_forbidden":
      case "project_missing":
      case "payment_required":
        return { kind: "config_error", reason: f.failure };
      case "blocked_other_project":
        return { kind: "blocked", reason: "other_project" };
      case "blocked_no_access":
        return { kind: "blocked", reason: "no_access" };
      case "rejected":
        return { kind: "rejected", reason: "unknown" };
    }
  }

  /** The failures `get` / `verify` / `remove` can express. */
  private static asCommon(f: { failure: FakeHostingFailure; retryAfterSeconds?: number }):
    | { kind: "retryable"; reason: "rate_limited" | "unavailable"; retryAfterSeconds?: number }
    | { kind: "config_error"; reason: "token_invalid" | "token_forbidden" | "project_missing" | "payment_required" }
    | { kind: "rejected"; reason: "unknown" } {
    const a = FakeHosting.asAdd(f);
    if (a.kind === "retryable") {
      return {
        kind: "retryable",
        reason: a.reason === "rate_limited" ? "rate_limited" : "unavailable",
        retryAfterSeconds: a.retryAfterSeconds,
      };
    }
    if (a.kind === "config_error") return a;
    return { kind: "rejected", reason: "unknown" };
  }

  // ---- HostingProvider ----------------------------------------------------

  async addDomain(host: string): Promise<AddResult> {
    this.calls.push({ op: "add", host });
    const f = this.failureFor("add");
    if (f) return FakeHosting.asAdd(f);
    if (this.snapshot(host)) return { kind: "already_on_project" };
    const challenge = this.pendingChallenge.get(host);
    this.attached.set(host, { verified: challenge === undefined, verification: challenge ?? [] });
    return { kind: "ok", verified: challenge === undefined, verification: challenge ?? [] };
  }

  async getDomain(host: string): Promise<GetResult> {
    this.calls.push({ op: "get", host });
    const f = this.failureFor("get");
    if (f) return FakeHosting.asCommon(f);
    const a = this.snapshot(host);
    return a ? { kind: "ok", verified: a.verified, verification: a.verification } : { kind: "not_found" };
  }

  async verifyDomain(host: string): Promise<VerifyResult> {
    this.calls.push({ op: "verify", host });
    const f = this.failureFor("verify");
    if (f) return FakeHosting.asCommon(f);
    const a = this.snapshot(host);
    if (!a) return { kind: "not_found" };
    if (this.pendingChallenge.has(host)) return { kind: "not_verified" };
    this.attached.set(host, { verified: true, verification: [] });
    return { kind: "ok", verified: true, verification: [] };
  }

  async getConfig(host: string): Promise<ConfigResult> {
    this.calls.push({ op: "config", host });
    if (this.failureFor("config")) return { kind: "unavailable", reason: "unavailable" };
    const fileConfig = this.readState()?.hosting?.config;
    const config = fileConfig ?? this.configState;
    if (config === "denied") return { kind: "unavailable", reason: "denied" };
    const base = typeof this.configState === "object" ? this.configState : null;
    return {
      kind: "ok",
      misconfigured: config.misconfigured ?? base?.misconfigured ?? false,
      recommendedCname:
        config.recommendedCname === undefined ? (base?.recommendedCname ?? null) : config.recommendedCname,
      recommendedIpv4: config.recommendedIpv4 ?? base?.recommendedIpv4 ?? [],
    };
  }

  async removeDomain(host: string): Promise<RemoveResult> {
    this.calls.push({ op: "remove", host });
    const f = this.failureFor("remove");
    if (f) return FakeHosting.asCommon(f);
    this.attached.delete(host);
    return { kind: "ok" };
  }
}

// ---------------------------------------------------------------------------
// Probe fake
// ---------------------------------------------------------------------------

/** A scripted live-ness probe: each host answers `ack`, `negative` or `unknown` (the default). */
export class FakeProbe implements ProbeClient {
  readonly calls: string[] = [];
  private readonly results = new Map<string, ProbeOutcome>();

  constructor(
    private readonly readState: FakeStateReader = () => null,
    private fallback: ProbeOutcome = "unknown",
  ) {}

  set(host: string, outcome: ProbeOutcome): this {
    this.results.set(host, outcome);
    return this;
  }

  setDefault(outcome: ProbeOutcome): this {
    this.fallback = outcome;
    return this;
  }

  async probe(host: string): Promise<ProbeOutcome> {
    this.calls.push(host);
    return this.results.get(host) ?? this.readState()?.probe?.[host] ?? this.fallback;
  }
}
