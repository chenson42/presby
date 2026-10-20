/**
 * hosting.ts - the hosting-provider interface the domain lifecycle talks to
 * (Phase 2 R7; Phase 3 API Contract section 5; DECISION-179). The only
 * implementation that ever touches the network is `vercel.ts`; everything else
 * (the fake, the unconfigured and misconfigured stand-ins) lives beside it so a
 * test or an unconfigured deployment can run the whole lifecycle with no
 * provider at all.
 *
 * TYPES AND TRIVIAL STAND-INS ONLY: no I/O, no secrets, no `server-only` (the
 * reattach script and the tests import it directly).
 *
 * THE CONTRACT IS CLOSED. Every method returns a discriminated union; none
 * throws for an expected outcome and none returns provider text. A caller
 * (service.ts) maps `kind` to a state decision and a `last_check_class`, and
 * the checklist copy is ours (G30): a provider's message never reaches a
 * person, an audit row or a log line.
 *
 *   ok          the provider did it (or already had it done)
 *   blocked     the NAME is the problem (attached to another account / project):
 *               retrying will not help, a person has to act (contact support)
 *   retryable   the provider could not answer right now: back off and try again
 *   config_error  OUR configuration is the problem (token, project, billing):
 *               every call will fail the same way until an operator acts, so
 *               the operator is alerted
 *   rejected    the provider refused this request for a reason we do not
 *               recognise (an unknown 4xx): never guessed at, operator alerted
 */

/** One challenge the provider wants published (Vercel's `verification[]`, when the name lives in another account). */
export interface HostingChallenge {
  type: string;
  domain: string;
  value: string;
  reason: string;
}

export type AddResult =
  | { kind: "ok"; verified: boolean; verification: HostingChallenge[] }
  /** 400 "already exists on the project": idempotent success, confirmed with `getDomain`. */
  | { kind: "already_on_project" }
  | { kind: "blocked"; reason: "other_project" | "no_access" }
  | {
      kind: "retryable";
      reason: "rate_limited" | "unavailable" | "deployment_not_ready";
      retryAfterSeconds?: number;
    }
  | {
      kind: "config_error";
      reason: "token_invalid" | "token_forbidden" | "project_missing" | "payment_required";
    }
  | { kind: "rejected"; reason: "invalid_domain" | "unknown" };

export type GetResult =
  | { kind: "ok"; verified: boolean; verification: HostingChallenge[] }
  | { kind: "not_found" }
  | { kind: "retryable"; reason: "rate_limited" | "unavailable"; retryAfterSeconds?: number }
  | { kind: "config_error"; reason: "token_invalid" | "token_forbidden" | "project_missing" | "payment_required" }
  | { kind: "rejected"; reason: "unknown" };

export type VerifyResult =
  | { kind: "ok"; verified: boolean; verification: HostingChallenge[] }
  /** The provider looked for the challenge and did not find it (a 400 from /verify). */
  | { kind: "not_verified" }
  | { kind: "not_found" }
  | { kind: "retryable"; reason: "rate_limited" | "unavailable"; retryAfterSeconds?: number }
  | { kind: "config_error"; reason: "token_invalid" | "token_forbidden" | "project_missing" | "payment_required" }
  | { kind: "rejected"; reason: "unknown" };

/**
 * `getConfig` is BEST EFFORT (Phase 2 R7): it is a team-level endpoint a
 * project-scoped token may be denied, and correctness never depends on it. Any
 * failure is `unavailable` and the caller falls back to `getDomain` plus its
 * own DNS observations and the last cached targets.
 */
export type ConfigResult =
  | {
      kind: "ok";
      /** The provider's own "this host is not configured correctly" opinion. */
      misconfigured: boolean;
      /** `recommendedCNAME[rank=1].value`, when present. */
      recommendedCname: string | null;
      /** `recommendedIPv4[rank=1].value[]`, when present. */
      recommendedIpv4: string[];
    }
  | { kind: "unavailable"; reason: "denied" | "rate_limited" | "unavailable" | "not_found" };

export type RemoveResult =
  /** Detached, or it was not attached (404): both mean "it is gone". */
  | { kind: "ok" }
  | { kind: "retryable"; reason: "rate_limited" | "unavailable"; retryAfterSeconds?: number }
  | { kind: "config_error"; reason: "token_invalid" | "token_forbidden" | "project_missing" | "payment_required" }
  | { kind: "rejected"; reason: "unknown" };

export interface HostingProvider {
  /** Attaches `host` to the project. Idempotent: a name already on the project is success. */
  addDomain(host: string): Promise<AddResult>;
  /** Reads the project's record of `host` (verification state and challenges). */
  getDomain(host: string): Promise<GetResult>;
  /** Asks the provider to re-check its own verification challenge for `host`. */
  verifyDomain(host: string): Promise<VerifyResult>;
  /** Best-effort: the provider's recommended DNS targets and its misconfiguration opinion. */
  getConfig(host: string): Promise<ConfigResult>;
  /** Detaches `host` from the project. Idempotent: a name not on the project is success. */
  removeDomain(host: string): Promise<RemoveResult>;
}

/**
 * `DOMAINS_PROVIDER` unset (or not honoured in this environment): every call
 * answers "unavailable". The lifecycle then does exactly what it does during a
 * real outage - rows wait in `attach_pending` with `provider_unavailable`,
 * which the checklist renders as "Connecting is temporarily unavailable. Your
 * DNS changes are safe to make" - which is the honest thing to say when
 * connecting genuinely is not available.
 */
export class UnconfiguredHosting implements HostingProvider {
  addDomain(): Promise<AddResult> {
    return Promise.resolve({ kind: "retryable", reason: "unavailable" });
  }
  getDomain(): Promise<GetResult> {
    return Promise.resolve({ kind: "retryable", reason: "unavailable" });
  }
  verifyDomain(): Promise<VerifyResult> {
    return Promise.resolve({ kind: "retryable", reason: "unavailable" });
  }
  getConfig(): Promise<ConfigResult> {
    return Promise.resolve({ kind: "unavailable", reason: "unavailable" });
  }
  removeDomain(): Promise<RemoveResult> {
    return Promise.resolve({ kind: "retryable", reason: "unavailable" });
  }
}

/**
 * `DOMAINS_PROVIDER=vercel` but the token or project id is missing: OUR
 * configuration is broken, which is different from "not configured on
 * purpose". Every call answers `config_error`, so the operator is alerted
 * rather than the church waiting forever on a silent retry.
 */
export class MisconfiguredHosting implements HostingProvider {
  constructor(private readonly reason: "token_invalid" | "project_missing") {}
  addDomain(): Promise<AddResult> {
    return Promise.resolve({ kind: "config_error", reason: this.reason });
  }
  getDomain(): Promise<GetResult> {
    return Promise.resolve({ kind: "config_error", reason: this.reason });
  }
  verifyDomain(): Promise<VerifyResult> {
    return Promise.resolve({ kind: "config_error", reason: this.reason });
  }
  getConfig(): Promise<ConfigResult> {
    return Promise.resolve({ kind: "unavailable", reason: "denied" });
  }
  removeDomain(): Promise<RemoveResult> {
    return Promise.resolve({ kind: "config_error", reason: this.reason });
  }
}
