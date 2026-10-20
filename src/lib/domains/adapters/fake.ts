import "server-only";
import { readFileSync } from "node:fs";
import type {
  DnsAnswer,
  DnsErrorReason,
  DnsObserver,
  DnsRecord,
  DnsResolver,
  DnsType,
} from "./dns";
import { QuorumDnsObserver } from "./dns";

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
 * (host.ts `assertPlatformHostConfig`). 1b adds the hosting and probe sections
 * of the same file.
 */

export interface FakeDnsState {
  /** `"<TYPE> <name>"` -> the values at that name, for every resolver. */
  zone?: Record<string, string[]>;
  /** resolver id -> the error every query to it returns. */
  errors?: Record<string, DnsErrorReason>;
  /** resolver id -> a zone that REPLACES `zone` for that resolver (a disagreement). */
  perResolver?: Record<string, Record<string, string[]>>;
}

export interface FakeState {
  dns?: FakeDnsState;
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

  async query(name: string, type: DnsType): Promise<DnsAnswer> {
    this.calls.push({ name, type });
    const state = this.readState()?.dns;
    const injected = this.failure ?? state?.errors?.[this.id] ?? null;
    if (injected !== null) return { kind: "error", reason: injected };

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
    queryCount: () => cloudflare.calls.length + google.calls.length,
  };
}
