import type {
  AddResult,
  ConfigResult,
  GetResult,
  HostingChallenge,
  HostingProvider,
  RemoveResult,
  VerifyResult,
} from "./hosting";

/**
 * vercel.ts - the Vercel REST adapter (Phase 2 R7; Phase 3 API Contract
 * section 5; DECISION-179). Five endpoints over `fetch`, no SDK (`@vercel/sdk`
 * was rejected: size and version churn for something the interface already
 * hides).
 *
 *   addDomain     POST   /v10/projects/{id}/domains          body { name }
 *   getDomain     GET    /v9/projects/{id}/domains/{host}
 *   verifyDomain  POST   /v9/projects/{id}/domains/{host}/verify
 *   getConfig     GET    /v6/domains/{host}/config?projectIdOrName={id}   (best effort)
 *   removeDomain  DELETE /v9/projects/{id}/domains/{host}
 *
 * Every request carries `teamId` when configured, an 8 second timeout, the
 * bearer token, and `redirect: "error"` (the token must never follow a
 * redirect to another origin). The base URL is a constant; the host is placed
 * in the path only after it passes a hostname-shape check, so a malformed name
 * cannot steer a request anywhere.
 *
 * NO PROVIDER TEXT LEAVES THIS FILE (G30). The error body's `code` and
 * `message` are read to CLASSIFY the failure and then dropped: nothing here
 * logs, returns or throws them, and the token is never placed in a result,
 * an error or a log line. The status classes below come from Vercel's
 * documented responses; the exact `error.code` strings and message wording are
 * to be pinned from recorded responses during the real-domain acceptance pass,
 * which is why classification leans on the HTTP status first and on a message
 * pattern only where one status carries two meanings (400 "already on this
 * project" vs "deployment not ready" vs a genuine refusal; 403 "no access to
 * the domain" vs a token that may not call the endpoint). An unrecognised 4xx
 * maps to `rejected: unknown` - never to a guess - and the operator is alerted.
 *
 *   status / message                                         -> result
 *   2xx                                                       ok
 *   400 "already exists on (this|the) project"                already_on_project (idempotent success)
 *   400 "latest production deployment ... not successful"     retryable: deployment_not_ready
 *   400 other                                                 rejected: invalid_domain
 *   401                                                       config_error: token_invalid
 *   402                                                       config_error: payment_required
 *   403 "no access to the domain"                             blocked: no_access
 *   403 other                                                 config_error: token_forbidden
 *   404 (project)                                             config_error: project_missing
 *   404 (domain) on get / remove                              not_found / ok (idempotent)
 *   409                                                       blocked: other_project
 *   429                                                       retryable: rate_limited (+ retry-after)
 *   5xx, network, timeout                                     retryable: unavailable
 *   other 4xx                                                 rejected: unknown
 */

export const VERCEL_API_BASE = "https://api.vercel.com";
const DEFAULT_TIMEOUT_MS = 8000;
/** A `retry-after` beyond a day is treated as garbage and ignored. */
const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60;

export interface VercelConfig {
  token: string;
  /** Project id or name. */
  projectId: string;
  /** Team id; omitted for a personal account. */
  teamId?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

type Json = Record<string, unknown>;

interface Response_ {
  status: number;
  json: Json | null;
  retryAfterSeconds?: number;
}

type CallOutcome = { kind: "response"; res: Response_ } | { kind: "network" };

/** What a non-2xx answer means, before an operation decides what to do with it. */
type Failure =
  | { kind: "already_on_project" }
  | { kind: "deployment_not_ready" }
  | { kind: "invalid_domain" }
  | { kind: "token_invalid" }
  | { kind: "payment_required" }
  | { kind: "no_access" }
  | { kind: "token_forbidden" }
  | { kind: "project_missing" }
  | { kind: "domain_not_found" }
  | { kind: "other_project" }
  | { kind: "rate_limited"; retryAfterSeconds?: number }
  | { kind: "unavailable"; retryAfterSeconds?: number }
  | { kind: "unknown" };

const HOST_SHAPE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const ALREADY_ON_PROJECT = /already\s+(?:exists|assigned|added|in\s+use)\b[^.]*\b(?:this|the)\s+project\b/i;
const DEPLOYMENT_NOT_READY = /(?:latest|last)\s+production\s+deployment[^.]*\bnot\s+(?:been\s+)?(?:successful|ready)/i;
const NO_ACCESS_TO_DOMAIN = /(?:don'?t|do\s+not)\s+have\s+access\s+to\s+the\s+domain/i;

function errorOf(json: Json | null): { code: string; message: string } {
  const e = json && typeof json.error === "object" && json.error !== null ? (json.error as Json) : null;
  return {
    code: typeof e?.code === "string" ? e.code : "",
    message: typeof e?.message === "string" ? e.message : "",
  };
}

function classify(res: Response_): Failure {
  const { message } = errorOf(res.json);
  const { status } = res;
  if (status === 400) {
    if (ALREADY_ON_PROJECT.test(message)) return { kind: "already_on_project" };
    if (DEPLOYMENT_NOT_READY.test(message)) return { kind: "deployment_not_ready" };
    return { kind: "invalid_domain" };
  }
  if (status === 401) return { kind: "token_invalid" };
  if (status === 402) return { kind: "payment_required" };
  if (status === 403) {
    return NO_ACCESS_TO_DOMAIN.test(message) ? { kind: "no_access" } : { kind: "token_forbidden" };
  }
  if (status === 404) {
    // A missing PROJECT is our configuration; a missing DOMAIN is ordinary.
    return /project/i.test(message) && !/domain/i.test(message)
      ? { kind: "project_missing" }
      : { kind: "domain_not_found" };
  }
  if (status === 409) return { kind: "other_project" };
  if (status === 429) return { kind: "rate_limited", retryAfterSeconds: res.retryAfterSeconds };
  if (status >= 500) return { kind: "unavailable", retryAfterSeconds: res.retryAfterSeconds };
  return { kind: "unknown" };
}

function parseChallenges(raw: unknown): HostingChallenge[] {
  if (!Array.isArray(raw)) return [];
  const out: HostingChallenge[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Json;
    if (typeof e.type !== "string" || typeof e.domain !== "string" || typeof e.value !== "string") continue;
    out.push({
      type: e.type,
      domain: e.domain,
      value: e.value,
      reason: typeof e.reason === "string" ? e.reason : "",
    });
  }
  return out;
}

function parseDomainBody(json: Json | null): { verified: boolean; verification: HostingChallenge[] } | null {
  if (json === null) return null;
  const verification = parseChallenges(json.verification);
  const verified = typeof json.verified === "boolean" ? json.verified : verification.length === 0;
  return { verified, verification };
}

export class VercelHosting implements HostingProvider {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: VercelConfig) {
    this.base = config.baseUrl ?? VERCEL_API_BASE;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // -------------------------------------------------------------------------
  // transport
  // -------------------------------------------------------------------------

  private url(path: string, extra: Record<string, string> = {}): string {
    const q = new URLSearchParams(extra);
    if (this.config.teamId) q.set("teamId", this.config.teamId);
    const qs = q.toString();
    return `${this.base}${path}${qs ? `?${qs}` : ""}`;
  }

  private projectPath(suffix: string): string {
    return `/projects/${encodeURIComponent(this.config.projectId)}${suffix}`;
  }

  private async call(
    method: "GET" | "POST" | "DELETE",
    path: string,
    opts: { query?: Record<string, string>; body?: unknown } = {},
  ): Promise<CallOutcome> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path, opts.query), {
        method,
        headers: {
          authorization: `Bearer ${this.config.token}`,
          accept: "application/json",
          ...(opts.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      return { kind: "network" };
    }

    let json: Json | null = null;
    try {
      const parsed: unknown = await response.json();
      json = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Json) : null;
    } catch {
      json = null;
    }

    const raw = response.headers.get("retry-after");
    const seconds = raw === null ? NaN : Number(raw);
    const retryAfterSeconds =
      Number.isFinite(seconds) && seconds > 0 && seconds <= MAX_RETRY_AFTER_SECONDS ? Math.ceil(seconds) : undefined;

    return { kind: "response", res: { status: response.status, json, retryAfterSeconds } };
  }

  private static ok(status: number): boolean {
    return status >= 200 && status < 300;
  }

  // -------------------------------------------------------------------------
  // operations
  // -------------------------------------------------------------------------

  async addDomain(host: string): Promise<AddResult> {
    if (!HOST_SHAPE.test(host)) return { kind: "rejected", reason: "invalid_domain" };
    const out = await this.call("POST", `/v10${this.projectPath("/domains")}`, { body: { name: host } });
    if (out.kind === "network") return { kind: "retryable", reason: "unavailable" };

    if (VercelHosting.ok(out.res.status)) {
      const body = parseDomainBody(out.res.json);
      // A 2xx we cannot read is not a success we can build on; the add is idempotent, so retry.
      return body === null ? { kind: "retryable", reason: "unavailable" } : { kind: "ok", ...body };
    }

    const f = classify(out.res);
    switch (f.kind) {
      case "already_on_project":
        return { kind: "already_on_project" };
      case "deployment_not_ready":
        return { kind: "retryable", reason: "deployment_not_ready" };
      case "invalid_domain":
        return { kind: "rejected", reason: "invalid_domain" };
      case "token_invalid":
      case "payment_required":
      case "token_forbidden":
        return { kind: "config_error", reason: f.kind };
      case "no_access":
        return { kind: "blocked", reason: "no_access" };
      case "project_missing":
      case "domain_not_found":
        // Adding to a project that does not exist: a 404 here is ours to fix.
        return { kind: "config_error", reason: "project_missing" };
      case "other_project":
        return { kind: "blocked", reason: "other_project" };
      case "rate_limited":
        return { kind: "retryable", reason: "rate_limited", retryAfterSeconds: f.retryAfterSeconds };
      case "unavailable":
        return { kind: "retryable", reason: "unavailable", retryAfterSeconds: f.retryAfterSeconds };
      case "unknown":
        return { kind: "rejected", reason: "unknown" };
    }
  }

  async getDomain(host: string): Promise<GetResult> {
    if (!HOST_SHAPE.test(host)) return { kind: "rejected", reason: "unknown" };
    const out = await this.call("GET", `/v9${this.projectPath(`/domains/${encodeURIComponent(host)}`)}`);
    if (out.kind === "network") return { kind: "retryable", reason: "unavailable" };

    if (VercelHosting.ok(out.res.status)) {
      const body = parseDomainBody(out.res.json);
      return body === null ? { kind: "retryable", reason: "unavailable" } : { kind: "ok", ...body };
    }
    return this.readFailure(out.res);
  }

  async verifyDomain(host: string): Promise<VerifyResult> {
    if (!HOST_SHAPE.test(host)) return { kind: "rejected", reason: "unknown" };
    const out = await this.call("POST", `/v9${this.projectPath(`/domains/${encodeURIComponent(host)}/verify`)}`);
    if (out.kind === "network") return { kind: "retryable", reason: "unavailable" };

    if (VercelHosting.ok(out.res.status)) {
      const body = parseDomainBody(out.res.json);
      return body === null ? { kind: "retryable", reason: "unavailable" } : { kind: "ok", ...body };
    }
    // A 400 here is "I looked for the challenge and it is not there yet".
    if (out.res.status === 400) return { kind: "not_verified" };
    return this.readFailure(out.res);
  }

  async getConfig(host: string): Promise<ConfigResult> {
    if (!HOST_SHAPE.test(host)) return { kind: "unavailable", reason: "unavailable" };
    const out = await this.call("GET", `/v6/domains/${encodeURIComponent(host)}/config`, {
      query: { projectIdOrName: this.config.projectId },
    });
    if (out.kind === "network") return { kind: "unavailable", reason: "unavailable" };

    if (!VercelHosting.ok(out.res.status)) {
      switch (out.res.status) {
        case 401:
        case 403:
          return { kind: "unavailable", reason: "denied" };
        case 404:
          return { kind: "unavailable", reason: "not_found" };
        case 429:
          return { kind: "unavailable", reason: "rate_limited" };
        default:
          return { kind: "unavailable", reason: "unavailable" };
      }
    }
    const j = out.res.json;
    if (j === null || typeof j.misconfigured !== "boolean") return { kind: "unavailable", reason: "unavailable" };
    return {
      kind: "ok",
      misconfigured: j.misconfigured,
      recommendedCname: rankedValue(j.recommendedCNAME, (v) => (typeof v === "string" ? v : null)),
      recommendedIpv4:
        rankedValue(j.recommendedIPv4, (v) =>
          Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null,
        ) ?? [],
    };
  }

  async removeDomain(host: string): Promise<RemoveResult> {
    if (!HOST_SHAPE.test(host)) return { kind: "rejected", reason: "unknown" };
    const out = await this.call("DELETE", `/v9${this.projectPath(`/domains/${encodeURIComponent(host)}`)}`);
    if (out.kind === "network") return { kind: "retryable", reason: "unavailable" };
    if (VercelHosting.ok(out.res.status)) return { kind: "ok" };

    const f = classify(out.res);
    switch (f.kind) {
      case "domain_not_found":
        return { kind: "ok" }; // idempotent: it is already not attached
      case "project_missing":
        return { kind: "config_error", reason: "project_missing" };
      case "token_invalid":
      case "payment_required":
      case "token_forbidden":
        return { kind: "config_error", reason: f.kind };
      case "rate_limited":
        return { kind: "retryable", reason: "rate_limited", retryAfterSeconds: f.retryAfterSeconds };
      case "unavailable":
        return { kind: "retryable", reason: "unavailable", retryAfterSeconds: f.retryAfterSeconds };
      default:
        // 400 / 403-no-access / 409 on a detach are not meaningful to retry blindly.
        return { kind: "rejected", reason: "unknown" };
    }
  }

  /** The failure half shared by getDomain and verifyDomain. */
  private readFailure(res: Response_):
    | { kind: "not_found" }
    | { kind: "retryable"; reason: "rate_limited" | "unavailable"; retryAfterSeconds?: number }
    | { kind: "config_error"; reason: "token_invalid" | "token_forbidden" | "project_missing" | "payment_required" }
    | { kind: "rejected"; reason: "unknown" } {
    const f = classify(res);
    switch (f.kind) {
      case "domain_not_found":
        return { kind: "not_found" };
      case "project_missing":
        return { kind: "config_error", reason: "project_missing" };
      case "token_invalid":
      case "payment_required":
      case "token_forbidden":
        return { kind: "config_error", reason: f.kind };
      case "rate_limited":
        return { kind: "retryable", reason: "rate_limited", retryAfterSeconds: f.retryAfterSeconds };
      case "unavailable":
        return { kind: "retryable", reason: "unavailable", retryAfterSeconds: f.retryAfterSeconds };
      default:
        return { kind: "rejected", reason: "unknown" };
    }
  }
}

/** The lowest-ranked entry's `value` of a `[{ rank, value }]` list, mapped through `pick`. */
function rankedValue<T>(raw: unknown, pick: (value: unknown) => T | null): T | null {
  if (!Array.isArray(raw)) return null;
  const entries = raw
    .filter((e): e is Json => typeof e === "object" && e !== null)
    .map((e) => ({ rank: typeof e.rank === "number" ? e.rank : Number.MAX_SAFE_INTEGER, value: pick(e.value) }))
    .filter((e): e is { rank: number; value: T } => e.value !== null)
    .sort((a, b) => a.rank - b.rank);
  return entries[0]?.value ?? null;
}
