import type { AUDIT_ACTIONS } from "@/lib/audit";

/**
 * state.ts - the organization_domains lifecycle as a pure table.
 *
 * docs/work-log/2026-10-19-custom-domains.md Phase 3 "Data Model" (legal
 * edges), DECISION-180. This is the application's copy of the edge table that
 * `presby_org_domains_guard_update()` enforces in drizzle/0057 between its
 * `-- BEGIN LEGAL EDGES` / `-- END LEGAL EDGES` markers. The two are pinned
 * together by `state.test.ts`, which parses the migration and compares: a
 * (from, to, purpose-scope) triple present in one and not the other fails CI.
 * The database is the authority (it binds the owner connection too, F44); this
 * table exists so the service can name the edge it means, refuse an illegal one
 * before a round trip, and map each edge to exactly one audit key (R8).
 *
 * PURE: no I/O, and the only import is TYPE-ONLY (erased at build), so this
 * file is safe wherever the checklist view-model is.
 *
 * Events name the REASON for an edge, which is why one (from, to) pair can
 * carry two events: `remove` and `force_release` both take a lapsed mail row
 * to `released` (0057 notes the cause rules, not a new edge, distinguish them).
 */

export const DOMAIN_STATES = [
  "pending",
  "verified",
  "attach_pending",
  "attached",
  "live",
  "lapsed",
  "parked",
  "release_pending",
  "released",
  "expired",
] as const;
export type DomainState = (typeof DOMAIN_STATES)[number];

/** The states `organization_domains_hostname_holding_uq` covers: first to VERIFY wins. */
export const HOLDING_STATES = [
  "verified",
  "attach_pending",
  "attached",
  "live",
  "lapsed",
  "parked",
  "release_pending",
] as const satisfies readonly DomainState[];

/** Frozen by the update guard; they stay as history and takeover forensics. */
export const TERMINAL_STATES = ["released", "expired"] as const satisfies readonly DomainState[];

export type DomainPurpose = "web" | "mail";

export type DomainEvent =
  | "proof_ok"
  | "expire"
  | "remove"
  | "force_release"
  | "attach_start"
  | "attach_ok"
  | "live_ok"
  | "live_lost"
  | "proof_lost"
  | "grace_elapsed"
  | "reconnect"
  | "detach_ok";

export interface DomainEdge {
  from: DomainState;
  event: DomainEvent;
  to: DomainState;
  /** `null` = both purposes; otherwise the one purpose the edge is legal for. */
  scope: DomainPurpose | null;
}

const e = (
  from: DomainState,
  event: DomainEvent,
  to: DomainState,
  scope: DomainPurpose | null = null,
): DomainEdge => ({ from, event, to, scope });

/**
 * Every legal (from, event, to). 25 distinct (from, to) pairs in 30 rows: the
 * five extra rows are the second event on a pair (`force_release` beside
 * `remove`, `grace_elapsed` beside `force_release`).
 */
export const EDGES: readonly DomainEdge[] = [
  // pending
  e("pending", "proof_ok", "verified"),
  e("pending", "expire", "expired"),
  e("pending", "remove", "released"),
  e("pending", "force_release", "released"),
  // verified
  e("verified", "attach_start", "attach_pending", "web"),
  e("verified", "proof_lost", "lapsed"),
  e("verified", "remove", "released"),
  e("verified", "force_release", "released"),
  // attach_pending
  e("attach_pending", "attach_ok", "attached", "web"),
  e("attach_pending", "proof_lost", "lapsed", "web"),
  e("attach_pending", "remove", "parked", "web"),
  e("attach_pending", "force_release", "release_pending", "web"),
  // attached
  e("attached", "live_ok", "live", "web"),
  e("attached", "proof_lost", "lapsed", "web"),
  e("attached", "remove", "parked", "web"),
  e("attached", "force_release", "release_pending", "web"),
  // live
  e("live", "live_lost", "attached", "web"),
  e("live", "proof_lost", "lapsed", "web"),
  e("live", "remove", "parked", "web"),
  e("live", "force_release", "release_pending", "web"),
  // lapsed
  e("lapsed", "proof_ok", "verified"),
  e("lapsed", "remove", "parked", "web"),
  e("lapsed", "grace_elapsed", "release_pending", "web"),
  e("lapsed", "force_release", "release_pending", "web"),
  // lapsed -> released exists for MAIL rows only (the 25th edge): a mail row
  // never attaches, so it has nothing to park.
  e("lapsed", "remove", "released", "mail"),
  e("lapsed", "force_release", "released", "mail"),
  // parked
  e("parked", "reconnect", "verified", "web"),
  e("parked", "grace_elapsed", "release_pending", "web"),
  e("parked", "force_release", "release_pending", "web"),
  // release_pending
  e("release_pending", "detach_ok", "released", "web"),
];

export function isHolding(state: DomainState): boolean {
  return (HOLDING_STATES as readonly string[]).includes(state);
}

export function isTerminal(state: DomainState): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

/**
 * The state `event` leads to from `state` for a row of `purpose`, or `null`
 * when the edge is not legal. A single (from, event) can have a web edge and a
 * mail edge to different targets (`lapsed` + `remove`: parked vs released), so
 * the purpose is part of the lookup.
 */
export function nextState(
  state: DomainState,
  event: DomainEvent,
  purpose: DomainPurpose,
): DomainState | null {
  const edge = EDGES.find(
    (x) =>
      x.from === state &&
      x.event === event &&
      (x.scope === null || x.scope === purpose),
  );
  return edge?.to ?? null;
}

/** The distinct (from, to) pairs with their purpose scope - what the trigger holds. */
export function edgePairs(): Array<{ from: DomainState; to: DomainState; scope: DomainPurpose | null }> {
  const seen = new Map<string, { from: DomainState; to: DomainState; scope: DomainPurpose | null }>();
  for (const x of EDGES) {
    const key = `${x.from}>${x.to}`;
    if (!seen.has(key)) seen.set(key, { from: x.from, to: x.to, scope: x.scope });
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Audit mapping (R8): one explicit key per edge
// ---------------------------------------------------------------------------

export type DomainAuditKeyName = Extract<keyof typeof AUDIT_ACTIONS, `DOMAIN_${string}`>;

/**
 * The AUDIT_ACTIONS key NAME for an edge. Keyed by (event, from, to) because
 * two events are ambiguous without the states: `proof_ok` is `proof_verified`
 * from pending and `recovered` from lapsed, and `remove` / `force_release`
 * are `parked` / `release_requested` / `released` by where they land.
 * Returns the NAME (not the string) so this file need not import audit.ts
 * (which pulls in the session); the service resolves `AUDIT_ACTIONS[name]`.
 */
export function auditKeyNameFor(
  from: DomainState,
  event: DomainEvent,
  to: DomainState,
): DomainAuditKeyName {
  switch (event) {
    case "proof_ok":
      return from === "lapsed" ? "DOMAIN_RECOVERED" : "DOMAIN_PROOF_VERIFIED";
    case "expire":
      return "DOMAIN_EXPIRED";
    case "attach_start":
      return "DOMAIN_ATTACH_REQUESTED";
    case "attach_ok":
      return "DOMAIN_ATTACHED";
    case "live_ok":
      return "DOMAIN_LIVE";
    case "live_lost":
      return "DOMAIN_LIVE_LOST";
    case "proof_lost":
      return "DOMAIN_LAPSED";
    case "reconnect":
      return "DOMAIN_RECONNECTED";
    case "detach_ok":
      return "DOMAIN_RELEASED";
    case "grace_elapsed":
      return "DOMAIN_RELEASE_REQUESTED";
    case "remove":
    case "force_release":
      if (to === "parked") return "DOMAIN_PARKED";
      if (to === "release_pending") return "DOMAIN_RELEASE_REQUESTED";
      return "DOMAIN_RELEASED";
  }
}
