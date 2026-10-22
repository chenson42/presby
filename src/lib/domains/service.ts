import "server-only";
import { randomBytes } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  notInArray,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { withOrgContext, OrgAccessError, type OrgTx } from "@/lib/authz";
import { getPlatformDb } from "@/lib/db";
// The canonical entry point first, so the domain module cycle initialises from
// schema.ts (events.schema.test.ts); ./domains is not re-exported from the
// domain index until integration (Rule 16).
import { auditEvents, organizations } from "@/lib/db/schema";
import {
  organizationDomains,
  type OrganizationDomain,
  type OrganizationDomainCheckClass,
  type OrganizationDomainReleaseCause,
} from "@/lib/db/domain/domains";
import { orgFeatureEnabledInTx } from "@/lib/org-features";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAdapters } from "./adapters";
import type { DnsObserver } from "./adapters/dns";
import type {
  AddResult,
  ConfigResult,
  GetResult,
  HostingProvider,
  RemoveResult as HostingRemoveResult,
  VerifyResult,
} from "./adapters/hosting";
import type { ProbeClient, ProbeOutcome } from "./adapters/probe";
import { buildActivity, type ActivityItem } from "./activity";
import { AUDIT_ACTIONS, insertAuditRow } from "@/lib/audit-tx";
import {
  buildChecklist,
  readObservation,
  type ChecklistGroup,
  type ChecklistRow,
} from "./checklist";
import { stepProbeStreak, stepProofStreak, type ProofObservation } from "./debounce";
import {
  checkProof,
  checkRouting,
  GENERIC_HOSTING_TARGETS,
  lookupNsFingerprint,
  type NsFingerprint,
  type ProofCheck,
  type RoutingCheck,
  type RoutingTargets,
} from "./dns-checks";
import { normalizeClaimInput, type ClaimRefusal } from "./hostname-rules";
import {
  collectNotificationContext,
  collectOperatorContext,
  sendDomainNotification,
  sendOperatorAlert,
  type DomainNotification,
  type DomainNotificationEvent,
  type NotificationContext,
  type OperatorAlertKind,
} from "./notify";
import { cadenceMs, DOMAIN_POLICY, nextCheckCapMs } from "./policy";
import { proofRecordName, proofRecordValue } from "./proof";
import {
  TERMINAL_STATES,
  auditKeyNameFor,
  isTerminal,
  nextState,
  type DomainEvent,
  type DomainState,
} from "./state";

/**
 * service.ts - the ONLY writer of `organization_domains` (A4;
 * service-only-writes.test.ts enforces it), and the home of the single
 * transition-and-audit choke point (R8).
 *
 * docs/work-log/2026-10-19-custom-domains.md: Phase 2 R7/R8/R10/R13, addendum
 * T4/A1-A4; Phase 3 API Contract section 6; DECISIONS 176/179/180.
 *
 * THE SHAPE OF IT.
 *   - `transitionDomain(tx, row, event, actor, opts)` is the one function that
 *     moves a row between states. It validates the edge against `state.ts`,
 *     writes the new state with an optimistic `where state = <from>` guard, and
 *     inserts EXACTLY ONE `audit_events` row in the SAME transaction. A caller
 *     never writes `state` any other way. The database trigger
 *     (`presby_org_domains_guard_update`) independently refuses an illegal
 *     edge on either connection, so this table is a convenience and the
 *     trigger is the authority.
 *   - The public functions (`claimDomain`, `checkClaim`, `changeCanonical`,
 *     `removeClaim`, `reconnectClaim`, `readDomainsView`) each take an ACTOR
 *     and run on the right connection for it: a tenant actor runs inside
 *     `withOrgContext` on the RLS-enforced `presby_app` connection (the (org)
 *     contract), a platform or machine actor on the platform connection.
 *     They return a closed `kind` union; expected outcomes are never thrown.
 *   - Network I/O (DNS, the hosting provider, the live-ness probe) happens with
 *     NO transaction held. A check is three steps: read the rows; do the
 *     network work; re-read FOR UPDATE, confirm the state has not moved, and
 *     apply (`observeAndAdvance`). If a row moved, its result is dropped.
 *
 * TENANT WRITES ARE COLUMN-LIMITED BY THE DATABASE (T4/A1). `presby_app` can
 * write state and observation columns only; it cannot touch the hold columns,
 * `force_release_reason`, the identity columns or the six trigger-owned
 * timestamps. So a tenant actor can never `force_release` (refused here before
 * the round trip, and by the grant), and nothing here ever `.set()`s a
 * trigger-owned column. The platform-only operations (`setDomainHold`,
 * `forceReleaseDomain`) run on the platform connection because the columns they
 * write are owner-only.
 *
 * NO PROVIDER CALL WITHOUT PROOF (G1). A row's provider calls (attach, the
 * config / verification reads, the probe) are made only when the SAME check saw
 * the ownership proof present; absent, wrong or unknown proof makes none. DNS
 * is the only thing read for a row that has not proven control. Intent is
 * committed before the provider call (`verified -> attach_pending`, then the
 * call), and `attach_pending` / `release_pending` rows are simply due rows the
 * sweep retries - the provider's add and remove are idempotent - so a crash
 * leaves a retryable state, never a half-attached host.
 *
 *  * AUDIT. Library and cron paths are invisible to `check:audit` (it scans only
 * actions.ts), so coverage is proven by `service.db.test.ts`: one test per
 * edge that asserts exactly one audit row, and none for an observation-only
 * check. The proof TOKEN never enters an audit row, a notification or a log.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const DOMAIN_PERMISSION = "domains.manage";
export const DOMAIN_TOGGLE = "org_portal.domains";

export type DomainActor =
  | { kind: "tenant"; userId: string; email: string | null; personId: string }
  | { kind: "platform"; userId: string; email: string | null }
  | { kind: "machine"; trigger: "cron" | "probe" | "webhook" };

/** A tenant tx (`withOrgContext`) and a platform tx share one Drizzle type. */
export type DomainTx = OrgTx;
export type DomainExec = <T>(fn: (tx: DomainTx) => Promise<T>) => Promise<T>;

export interface DomainServiceDeps {
  dns?: DnsObserver;
  /** The hosting provider; defaults to `DOMAINS_PROVIDER` (unset = unconfigured). */
  hosting?: HostingProvider;
  /** The live-ness probe client. */
  probe?: ProbeClient;
  /** The application clock, for streak spans and timestamps written into jsonb. The database clock still owns grace and expiry. */
  now?: () => Date;
}

/** A row as the service hands it back to callers: no token, no internals. */
export interface DomainSummary {
  id: string;
  hostname: string;
  claimName: string;
  purpose: "web" | "mail";
  webRole: "canonical" | "alias" | null;
  state: DomainState;
}

function summarize(row: OrganizationDomain): DomainSummary {
  return {
    id: row.id,
    hostname: row.hostname,
    claimName: row.claimName,
    purpose: row.purpose,
    webRole: row.webRole,
    state: row.state,
  };
}

type Gate = "forbidden" | "feature_off" | "not_found";
const TERMINAL: DomainState[] = [...TERMINAL_STATES];

function rowsOf<T>(result: unknown): T[] {
  const r = result as { rows?: T[] } | T[];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

/** The DB clock as an SQL expression: the trigger's `now()`, so a cap or deadline written here can never be rejected for clock skew. */
function dbNowPlus(ms: number): SQL {
  return sql`now() + (${ms / 1000}::double precision * interval '1 second')`;
}
const dbNow = (): SQL => sql`now()`;

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

/**
 * The transaction runner for an actor acting at an organization. Tenants enter
 * through `withOrgContext` (membership verified before the GUC is set);
 * platform and machine actors run on the platform connection.
 */
export function domainExec(actor: DomainActor, organizationId: string): DomainExec {
  if (actor.kind === "tenant") {
    return (fn) => withOrgContext(actor.personId, organizationId, fn);
  }
  return (fn) => getPlatformDb().transaction((tx) => fn(tx as DomainTx));
}

function actorAudit(actor: DomainActor) {
  return actor.kind === "machine" ? null : { userId: actor.userId, email: actor.email };
}

function actorLabel(actor: DomainActor): string {
  return actor.kind === "machine" ? `machine:${actor.trigger}` : (actor.email ?? actor.userId);
}

// ---------------------------------------------------------------------------
// Database error classification
// ---------------------------------------------------------------------------

export type DomainDbError =
  | { kind: "cap" }
  | { kind: "held_elsewhere" }
  | { kind: "duplicate_in_org" }
  | { kind: "second_canonical" }
  | { kind: "guard"; message: string }
  | { kind: "denied" };

interface PgErrorLike {
  code?: string;
  constraint?: string;
  message?: string;
  cause?: unknown;
}

/**
 * Maps a Postgres error from the domain tables (Drizzle wraps the driver error
 * as `.cause`) to what 0057 means by it:
 *   23505 + `organization_domains_hostname_holding_uq` -> held_elsewhere (name
 *         NO organization, A12); `..._org_host_uq` -> duplicate in this org;
 *         `..._one_canonical_uq` -> a second canonical host.
 *   23514 `organization_domains: cap` -> the per-org cap; any other
 *         `organization_domains:` raise -> a guard refusal.
 *   42501 -> denied.
 * Anything else is `null`: not ours, rethrow.
 */
export function classifyDomainDbError(err: unknown): DomainDbError | null {
  for (let e = err as PgErrorLike | undefined, depth = 0; e && depth < 6; e = e.cause as PgErrorLike | undefined, depth++) {
    if (typeof e.code !== "string") continue;
    if (e.code === "23505") {
      switch (e.constraint) {
        case "organization_domains_hostname_holding_uq":
          return { kind: "held_elsewhere" };
        case "organization_domains_org_host_uq":
          return { kind: "duplicate_in_org" };
        case "organization_domains_one_canonical_uq":
          return { kind: "second_canonical" };
        default:
          return null;
      }
    }
    if (e.code === "23514" && typeof e.message === "string" && e.message.startsWith("organization_domains:")) {
      return e.message.startsWith("organization_domains: cap")
        ? { kind: "cap" }
        : { kind: "guard", message: e.message };
    }
    if (e.code === "42501") return { kind: "denied" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The choke point
// ---------------------------------------------------------------------------

export class DomainTransitionError extends Error {
  constructor(
    readonly code: "illegal_edge" | "stale" | "forbidden_actor" | "bad_cause",
    message: string,
  ) {
    super(message);
    this.name = "DomainTransitionError";
  }
}

/** The observation-side columns a transition may write alongside the state. */
export interface DomainPatch {
  webRole?: "canonical" | "alias";
  proofLastOkAt?: SQL | null;
  proofMissCount?: number;
  probeMissCount?: number;
  nextCheckAt?: SQL | null;
  lastCheckedAt?: SQL | null;
  lastCheckClass?: OrganizationDomainCheckClass | null;
  observation?: Record<string, unknown>;
  providerChallenge?: unknown;
  nsFingerprint?: string | null;
  notifyState?: Record<string, unknown>;
}

export interface TransitionOptions {
  /** For `remove`: `removed` (default) or `org_closed`. For `force_release`: `force_released` or `evicted`. */
  cause?: OrganizationDomainReleaseCause;
  /** Required for `force_release`; the owner-only evidence column. */
  forceReleaseReason?: string;
  patch?: DomainPatch;
  /** `metadata.trigger` when the cause is not a person's click ("check_now", "cron"). */
  trigger?: string;
  /** Extra audit metadata. Never the proof token. */
  metadata?: Record<string, unknown>;
}

type TransitionRow = Pick<
  OrganizationDomain,
  "id" | "organizationId" | "hostname" | "claimName" | "purpose" | "state" | "releaseCause"
>;

function releaseCauseFor(
  row: TransitionRow,
  event: DomainEvent,
  to: DomainState,
  opts: TransitionOptions,
): OrganizationDomainReleaseCause | undefined {
  if (to !== "parked" && to !== "release_pending" && to !== "released") return undefined;
  switch (event) {
    case "remove": {
      const cause = opts.cause ?? "removed";
      if (cause !== "removed" && cause !== "org_closed") {
        throw new DomainTransitionError("bad_cause", `remove carries removed or org_closed, not ${cause}`);
      }
      return cause;
    }
    case "force_release": {
      const cause = opts.cause;
      if (cause !== "force_released" && cause !== "evicted") {
        throw new DomainTransitionError("bad_cause", "force_release carries force_released or evicted");
      }
      return cause;
    }
    case "grace_elapsed":
      return row.state === "lapsed" ? "lapsed_grace" : (row.releaseCause ?? undefined);
    case "detach_ok":
      return row.releaseCause ?? undefined;
    default:
      return undefined;
  }
}

/**
 * Moves one row along one legal edge and writes exactly one audit row, in the
 * caller's transaction. Throws `DomainTransitionError` for an illegal edge, a
 * tenant attempting a platform-only event, or a row that moved under it
 * (`stale`); lets a database error (a unique violation, a guard) propagate for
 * the caller to classify.
 */
export async function transitionDomain(
  tx: DomainTx,
  row: TransitionRow,
  event: DomainEvent,
  actor: DomainActor,
  opts: TransitionOptions = {},
): Promise<OrganizationDomain> {
  const to = nextState(row.state, event, row.purpose);
  if (to === null) {
    throw new DomainTransitionError("illegal_edge", `${row.state} -${event}-> is not a legal edge for a ${row.purpose} row`);
  }
  if (event === "force_release") {
    if (actor.kind !== "platform") {
      throw new DomainTransitionError("forbidden_actor", "only a platform actor may force-release a domain");
    }
    if (!opts.forceReleaseReason || opts.forceReleaseReason.trim() === "") {
      throw new DomainTransitionError("bad_cause", "force_release requires a reason");
    }
  }

  const cause = releaseCauseFor(row, event, to, opts);
  const cadence = cadenceMs(to);

  const patch = opts.patch ?? {};
  const set: PgUpdateSetSource<typeof organizationDomains> = { ...patch, state: to };
  if (cause !== undefined) set.releaseCause = cause;
  if (event === "force_release") set.forceReleaseReason = opts.forceReleaseReason!.trim();
  // Re-schedule for the new state unless the caller chose a time. A terminal
  // row is never due again.
  if (patch.nextCheckAt === undefined) {
    set.nextCheckAt = cadence === null ? null : dbNowPlus(cadence);
  }

  const [updated] = await tx
    .update(organizationDomains)
    .set(set)
    .where(and(eq(organizationDomains.id, row.id), eq(organizationDomains.state, row.state)))
    .returning();
  if (!updated) {
    throw new DomainTransitionError("stale", `${row.hostname} is no longer ${row.state}`);
  }

  await insertAuditRow(tx, {
    action: AUDIT_ACTIONS[auditKeyNameFor(row.state, event, to)],
    actor: actorAudit(actor),
    resourceType: "organization_domain",
    resourceId: row.id,
    metadata: {
      organizationId: row.organizationId,
      hostname: row.hostname,
      claimName: row.claimName,
      purpose: row.purpose,
      from: row.state,
      to,
      event,
      actorKind: actor.kind,
      ...(actor.kind === "machine" ? { trigger: actor.trigger } : {}),
      ...(opts.trigger ? { trigger: opts.trigger } : {}),
      ...(cause !== undefined ? { releaseCause: cause } : {}),
      ...(event === "force_release" ? { reason: opts.forceReleaseReason!.trim() } : {}),
      ...(opts.metadata ?? {}),
    },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** Permission and toggle, in the order Phase 3 fixes: flag -> toggle -> permission is the tenant order; here the permission is read first so a non-holder learns nothing about the toggle. */
type GateActor = { kind: "tenant"; personId: string } | { kind: "platform" } | { kind: "machine" };

async function gate(tx: DomainTx, actor: GateActor, organizationId: string): Promise<Gate | null> {
  if (actor.kind === "machine") return null;
  if (actor.kind === "tenant") {
    const allowed = rowsOf<{ allowed?: boolean }>(
      await tx.execute(sql`
        select presby_has_permission(
                 ${actor.personId}::uuid,
                 ${organizationId}::uuid,
                 ${DOMAIN_PERMISSION}
               ) as allowed
      `),
    )[0]?.allowed;
    if (allowed !== true) return "forbidden";
  } else {
    const [org] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);
    if (!org) return "not_found";
  }
  // The category axis is deliberately off: a curation preference must not hide
  // domain management (T10).
  if (!(await orgFeatureEnabledInTx(tx, organizationId, DOMAIN_TOGGLE, false))) return "feature_off";
  return null;
}

async function orgWebRows(tx: DomainTx, organizationId: string, lock: boolean) {
  const q = tx
    .select()
    .from(organizationDomains)
    .where(
      and(
        eq(organizationDomains.organizationId, organizationId),
        eq(organizationDomains.purpose, "web"),
        notInArray(organizationDomains.state, TERMINAL),
      ),
    )
    .orderBy(asc(organizationDomains.createdAt), asc(organizationDomains.hostname));
  return lock ? q.for("update") : q;
}

async function groupRows(tx: DomainTx, organizationId: string, claimName: string, lock: boolean) {
  const q = tx
    .select({
      ...getTableColumns(organizationDomains),
      dbExpired: sql<boolean>`${organizationDomains.expiresAt} <= now()`.as("db_expired"),
      dbGraceElapsed: sql<boolean>`(${organizationDomains.graceEndsAt} is not null and ${organizationDomains.graceEndsAt} <= now())`.as(
        "db_grace_elapsed",
      ),
    })
    .from(organizationDomains)
    .where(
      and(
        eq(organizationDomains.organizationId, organizationId),
        eq(organizationDomains.claimName, claimName),
        notInArray(organizationDomains.state, TERMINAL),
      ),
    )
    .orderBy(asc(organizationDomains.hostname));
  return lock ? q.for("update") : q;
}

async function rateLimited(
  actor: DomainActor,
  key: string,
  limit: { max: number; windowSeconds: number },
  reason: string,
): Promise<number | null> {
  const result = await checkRateLimit(key, limit, {
    userId: actor.kind === "machine" ? null : actor.userId,
    actor: actorLabel(actor),
    reason,
  });
  return result.allowed ? null : result.retryAfterSeconds;
}

/** Runs `fn`, turning a membership that ended mid-request into `forbidden`. */
async function guarded<T extends { kind: string }>(
  fn: () => Promise<T>,
): Promise<T | { kind: "forbidden" }> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof OrgAccessError) return { kind: "forbidden" };
    throw err;
  }
}

async function notifyAfterCommit(
  ctx: NotificationContext | null,
  event: DomainNotificationEvent,
  hostnames: string[],
  actor: DomainActor,
): Promise<void> {
  const n: DomainNotification = { event, hostnames, actorKind: actor.kind };
  try {
    await sendDomainNotification(ctx, n);
  } catch {
    console.error(`[domains] notification failed (event ${event})`);
  }
}

export interface ProofRecord {
  type: "TXT";
  name: string;
  value: string;
}

// ---------------------------------------------------------------------------
// claimDomain
// ---------------------------------------------------------------------------

export interface ClaimInput {
  domain: string;
  /** Which of an apex's pair is the canonical host. Ignored for a name that does not pair. */
  canonical: "www" | "apex";
}

export type ClaimResult =
  | {
      kind: "ok";
      claimName: string;
      displayName: string;
      created: DomainSummary[];
      proof: ProofRecord;
    }
  | { kind: "invalid"; reason: ClaimRefusal }
  | { kind: "exists"; claimName: string; parked: boolean }
  | { kind: "cap_reached" }
  | { kind: "conflict" }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "forbidden" }
  | { kind: "feature_off" }
  | { kind: "not_found" };

/**
 * Starts a claim: validates and normalizes the typed name, then inserts one
 * `pending` row per host (the apex and its `www.` pair, or the one row typed)
 * with a per-claim-group proof token. NOTHING is attached anywhere (G1): the
 * result carries the TXT record to publish.
 *
 * Used by the tenant action and, with a platform actor, by the Q2 on-behalf
 * path (`created_via = 'platform'`, DNS proof still required, web only - there
 * is no mail claim in this batch).
 *
 * Pre-proof responses are identical whatever other organizations hold: this
 * function reads no other organization's rows (A12). The cross-org fact -
 * first to VERIFY wins - surfaces only at `pending -> verified`.
 */
export async function claimDomain(
  actor: DomainActor,
  organizationId: string,
  input: ClaimInput,
): Promise<ClaimResult> {
  if (actor.kind === "machine") return { kind: "forbidden" };
  const normalized = normalizeClaimInput(input.domain);
  if (!normalized.ok) return { kind: "invalid", reason: normalized.reason };

  let notifyCtx: NotificationContext | null = null;
  let result: ClaimResult;
  try {
    result = await guarded(() =>
      domainExec(actor, organizationId)(async (tx): Promise<ClaimResult> => {
        const refused = await gate(tx, actor, organizationId);
        if (refused) return { kind: refused };

        const retryAfter = await rateLimited(
          actor,
          `domains:claim:${organizationId}`,
          DOMAIN_POLICY.claimsPerOrg,
          "domain claim",
        );
        if (retryAfter !== null) return { kind: "rate_limited", retryAfterSeconds: retryAfter };

        const existing = await orgWebRows(tx, organizationId, false);
        const have = new Set(existing.map((r) => r.hostname));
        const missing = normalized.hostnames.filter((h) => !have.has(h));
        if (missing.length === 0) {
          return {
            kind: "exists",
            claimName: normalized.claimName,
            parked: existing.some((r) => r.claimName === normalized.claimName && r.state === "parked"),
          };
        }
        if (existing.length + missing.length > DOMAIN_POLICY.webCap) return { kind: "cap_reached" };

        // One token per claim group: reuse the group's if part of it is held.
        const token =
          existing.find((r) => r.claimName === normalized.claimName)?.proofToken ??
          randomBytes(24).toString("base64url");

        const hasCanonical = existing.some((r) => r.webRole === "canonical");
        const canonicalHost = hasCanonical
          ? null
          : normalized.pairable
            ? input.canonical === "www"
              ? `www.${normalized.claimName}`
              : normalized.claimName
            : normalized.claimName;

        // RAW INSERT NAMING EXACTLY THE EIGHT GRANTED COLUMNS. The query builder
        // lists every column of the table with DEFAULT for the ones it was not
        // given, and Postgres checks INSERT privilege on every column NAMED in
        // the statement - so a builder insert fails for presby_app, whose grant
        // is column-limited (0057 section 5, A1). `next_check_at` is not in the
        // insert grant either; it is set by the UPDATE below (which is).
        const createdVia = actor.kind === "platform" ? "platform" : "tenant";
        const tuples = missing.map(
          (hostname) =>
            sql`(${organizationId}::uuid, 'web', ${hostname}, ${normalized.claimName},
                 ${hostname === canonicalHost ? "canonical" : "alias"}, ${token},
                 ${createdVia}, ${actor.userId}::uuid)`,
        );
        const inserted = rowsOf<{ id: string }>(
          await tx.execute(sql`
            insert into organization_domains
              (organization_id, purpose, hostname, claim_name, web_role, proof_token,
               created_via, created_by_user_id)
            values ${sql.join(tuples, sql`, `)}
            returning id
          `),
        );
        const ids = inserted.map((r) => r.id);
        await tx
          .update(organizationDomains)
          .set({ nextCheckAt: dbNowPlus(cadenceMs("pending")!) })
          .where(inArray(organizationDomains.id, ids));
        const created = await tx
          .select()
          .from(organizationDomains)
          .where(inArray(organizationDomains.id, ids))
          .orderBy(asc(organizationDomains.hostname));

        for (const row of created) {
          await insertAuditRow(tx, {
            action: AUDIT_ACTIONS.DOMAIN_CLAIMED,
            actor: actorAudit(actor),
            resourceType: "organization_domain",
            resourceId: row.id,
            metadata: {
              organizationId,
              hostname: row.hostname,
              claimName: row.claimName,
              purpose: row.purpose,
              webRole: row.webRole,
              from: null,
              to: "pending",
              event: "claim",
              actorKind: actor.kind,
              via: row.createdVia,
            },
          });
        }

        notifyCtx = await collectNotificationContext(tx, organizationId);
        return {
          kind: "ok",
          claimName: normalized.claimName,
          displayName: normalized.displayName,
          created: created.map(summarize),
          proof: {
            type: "TXT",
            name: proofRecordName(normalized.claimName),
            value: proofRecordValue(token),
          },
        };
      }),
    );
  } catch (err) {
    const db = classifyDomainDbError(err);
    if (db?.kind === "cap") return { kind: "cap_reached" };
    if (db?.kind === "duplicate_in_org") return { kind: "exists", claimName: normalized.claimName, parked: false };
    if (db?.kind === "second_canonical") return { kind: "conflict" };
    throw err;
  }

  if (result.kind === "ok") {
    await notifyAfterCommit(notifyCtx, "claimed", result.created.map((c) => c.hostname), actor);
  }
  return result;
}

// ---------------------------------------------------------------------------
// observeAndAdvance (the one check routine) and checkClaim
// ---------------------------------------------------------------------------

export type CheckOutcome =
  | "verified"
  | "recovered"
  | "expired"
  | "held_elsewhere"
  | "attached"
  | "attach_waiting"
  | "live"
  | "live_lost"
  | "lapsed"
  | "release_requested"
  | "released"
  | "removed"
  | "unchanged"
  | "deferred";

export type CheckResult =
  | { kind: "ok"; outcome: CheckOutcome; proof: ProofCheck["status"] | null; checkedAt: string }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "forbidden" }
  | { kind: "feature_off" }
  | { kind: "not_found" };

/** The most significant outcome wins when a claim group's rows disagree. */
const OUTCOME_PRIORITY: readonly CheckOutcome[] = [
  "lapsed",
  "live_lost",
  "released",
  "release_requested",
  "removed",
  "expired",
  "held_elsewhere",
  "live",
  "attached",
  "attach_waiting",
  "verified",
  "recovered",
  "unchanged",
  "deferred",
];

type GroupRow = Awaited<ReturnType<typeof groupRows>>[number];

/** The states whose check begins with the ownership-proof lookup. */
const PROOF_STATES: ReadonlySet<DomainState> = new Set([
  "pending",
  "verified",
  "attach_pending",
  "attached",
  "live",
  "lapsed",
]);

interface ResolvedDeps {
  dns: DnsObserver;
  hosting: HostingProvider;
  probe: ProbeClient;
  now: () => Date;
}

function resolveDeps(deps: DomainServiceDeps | undefined): ResolvedDeps {
  const adapters = getAdapters(process.env, { dns: deps?.dns, hosting: deps?.hosting, probe: deps?.probe });
  return { ...adapters, now: deps?.now ?? (() => new Date()) };
}

/** What the network told us about one row, gathered with NO transaction held. */
interface RowEvidence {
  proof: ProofObservation | null;
  add?: AddResult;
  domain?: GetResult;
  verify?: VerifyResult;
  config?: ConfigResult;
  routing?: RoutingCheck;
  probe?: ProbeOutcome;
  remove?: HostingRemoveResult;
  ns?: NsFingerprint;
  /** `attached`/`live` rows the provider no longer knew about, re-added (reconciliation). */
  readded?: AddResult;
  /** The provider's targets as resolved for this row (fresh config, else cached, else generic). */
  targets?: { value: RoutingTargets; source: "provider" | "generic" };
}

function cachedTargets(observation: unknown): { value: RoutingTargets; source: "provider" | "generic" } | null {
  const t = readObservation(observation).targets;
  if (!t || (!t.cname && !(t.ipv4 && t.ipv4.length > 0))) return null;
  return { value: { cname: t.cname ?? null, ipv4: t.ipv4 ?? [] }, source: t.source ?? "provider" };
}

/** Fresh provider config wins; otherwise the cached recommendation; otherwise Vercel's generic targets (displayed, flagged `generic`). */
function resolveTargets(
  config: ConfigResult | undefined,
  observation: unknown,
): { value: RoutingTargets; source: "provider" | "generic" } {
  if (config?.kind === "ok" && (config.recommendedCname || config.recommendedIpv4.length > 0)) {
    return {
      value: { cname: config.recommendedCname, ipv4: config.recommendedIpv4 },
      source: "provider",
    };
  }
  return cachedTargets(observation) ?? { value: GENERIC_HOSTING_TARGETS, source: "generic" };
}

interface NotifyState {
  proofMissing?: boolean;
  alerted?: Record<string, string>;
  parkedReminderAt?: string;
}

function readNotifyState(value: unknown): NotifyState {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...(value as NotifyState) } : {};
}

function reminderDue(ns: NotifyState, now: Date): boolean {
  return !ns.parkedReminderAt || now.getTime() - Date.parse(ns.parkedReminderAt) >= DOMAIN_POLICY.parkedReminderMs;
}

/**
 * Network I/O for a claim group, in the order Phase 3 fixes: the proof first
 * (one lookup per distinct token), then - ONLY for a row whose proof is
 * present - the provider calls that row's state calls for. A row whose proof is
 * absent, wrong or unknown makes NO provider call (G1: no provider call
 * without proof), and `unknown` is never treated as a verdict.
 */
async function gatherEvidence(
  rows: readonly GroupRow[],
  claimName: string,
  proofSeen: Map<string, ProofObservation>,
  d: ResolvedDeps,
): Promise<Map<string, RowEvidence>> {
  for (const token of new Set(rows.filter((r) => PROOF_STATES.has(r.state)).map((r) => r.proofToken))) {
    if (!proofSeen.has(token)) proofSeen.set(token, (await checkProof(d.dns, claimName, token)).status);
  }

  let ns: NsFingerprint | undefined;
  const nsOnce = async () => (ns ??= await lookupNsFingerprint(d.dns, claimName));

  const out = new Map<string, RowEvidence>();
  for (const row of rows) {
    const ev: RowEvidence = { proof: PROOF_STATES.has(row.state) ? (proofSeen.get(row.proofToken) ?? null) : null };
    out.set(row.id, ev);
    const host = row.hostname;

    switch (row.state) {
      case "verified":
        if (ev.proof === "present" && row.nsFingerprint === null) ev.ns = await nsOnce();
        break;

      case "attach_pending": {
        // The records the church must publish are shown whether or not the
        // provider can be reached ("your DNS changes are safe to make").
        ev.targets = resolveTargets(undefined, row.observation);
        if (ev.proof === "present") {
          ev.add = await d.hosting.addDomain(host);
          ev.config = await d.hosting.getConfig(host);
          ev.targets = resolveTargets(ev.config, row.observation);
          if (ev.add.kind === "ok" || ev.add.kind === "already_on_project") {
            ev.domain = await d.hosting.getDomain(host);
          }
        }
        // ...and so is whether the church has published them yet: routing is
        // read-only DNS, independent of the provider, and it is the feedback
        // loop while a host waits to attach. Judged against the provider's own
        // recommendation when we could read it, so a custom target is not
        // called "wrong".
        ev.routing = await checkRouting(d.dns, host, ev.targets.value, { diagnose: false });
        break;
      }

      case "attached":
      case "live": {
        if (ev.proof !== "present") break;
        ev.domain = await d.hosting.getDomain(host);
        if (ev.domain.kind === "not_found") {
          // Reconciliation: we believe it is attached and the provider has no
          // record of it. add is idempotent, so just put it back.
          ev.readded = await d.hosting.addDomain(host);
        } else if (ev.domain.kind === "ok" && !ev.domain.verified) {
          ev.verify = await d.hosting.verifyDomain(host);
        }
        ev.config = await d.hosting.getConfig(host);
        ev.targets = resolveTargets(ev.config, row.observation);
        ev.routing = await checkRouting(d.dns, host, ev.targets.value, { diagnose: row.state === "attached" });
        // A live host is probed whatever DNS says (the probe IS the verdict). An
        // attached one is probed unless DNS definitively points elsewhere.
        if (row.state === "live" || ev.routing.pointsAtProvider !== false) ev.probe = await d.probe.probe(host);
        ev.ns = await nsOnce();
        break;
      }

      case "parked": {
        if (row.dbGraceElapsed) break;
        if (!reminderDue(readNotifyState(row.notifyState), d.now())) break;
        const targets = resolveTargets(undefined, row.observation);
        ev.targets = targets;
        ev.routing = await checkRouting(d.dns, host, targets.value, { diagnose: false });
        break;
      }

      case "release_pending":
        ev.remove = await d.hosting.removeDomain(host);
        break;

      default:
        break;
    }
  }
  return out;
}

/** Everything the apply step accumulates besides the writes themselves. */
interface ApplyEnv {
  tx: DomainTx;
  actor: DomainActor;
  trigger: string | undefined;
  now: Date;
  forced: boolean;
  organizationId: string;
  notifications: Map<DomainNotificationEvent, string[]>;
  alerts: Map<OperatorAlertKind, string[]>;
  /** Rows that just entered `attach_pending`: the second pass makes their provider call. */
  followUp: string[];
}

function note(env: ApplyEnv, event: DomainNotificationEvent, row: Pick<OrganizationDomain, "hostname">) {
  const list = env.notifications.get(event) ?? [];
  if (!list.includes(row.hostname)) list.push(row.hostname);
  env.notifications.set(event, list);
}

/** Queues an operator alert for the row, at most once per `operatorAlertRepeatMs` per kind. Returns the notify state to persist. */
function alertOperator(
  env: ApplyEnv,
  row: Pick<OrganizationDomain, "hostname">,
  ns: NotifyState,
  kind: OperatorAlertKind,
): NotifyState {
  const last = ns.alerted?.[kind];
  if (last && env.now.getTime() - Date.parse(last) < DOMAIN_POLICY.operatorAlertRepeatMs) return ns;
  const list = env.alerts.get(kind) ?? [];
  if (!list.includes(row.hostname)) list.push(row.hostname);
  env.alerts.set(kind, list);
  return { ...ns, alerted: { ...(ns.alerted ?? {}), [kind]: env.now.toISOString() } };
}

/** The proof streak for the rows that must keep their ownership proof (G9). */
function proofPersistence(env: ApplyEnv, row: GroupRow, ev: RowEvidence) {
  const prev = readObservation(row.observation);
  const observed: ProofObservation = ev.proof ?? "unknown";
  const step = stepProofStreak({ count: row.proofMissCount, since: prev.proofMissSince ?? null }, observed, env.now);
  let ns = readNotifyState(row.notifyState);
  if (step.firstMiss && !ns.proofMissing) {
    note(env, "proof_missing", row);
    ns = { ...ns, proofMissing: true };
  }
  if (observed === "present" && ns.proofMissing) {
    const { proofMissing: _cleared, ...rest } = ns;
    void _cleared;
    ns = rest;
  }
  const observation: Record<string, unknown> = {
    ...prev,
    checkedAt: env.now.toISOString(),
    ...(ev.proof ? { proof: { status: ev.proof } } : {}),
  };
  if (step.next.since) observation.proofMissSince = step.next.since;
  else delete observation.proofMissSince;
  const checkClass: OrganizationDomainCheckClass =
    observed === "present" ? "ok" : observed === "unknown" ? "dns_unknown" : "proof_absent";
  return {
    present: observed === "present",
    lost: step.lost,
    proofMissCount: step.next.count,
    observation,
    notifyState: ns,
    checkClass,
  };
}

type Persistence = ReturnType<typeof proofPersistence>;

interface CheckWrite {
  checkClass: OrganizationDomainCheckClass;
  observation: Record<string, unknown>;
  nextInMs: number;
  proofMissCount?: number;
  probeMissCount?: number;
  notifyState?: NotifyState;
  nsFingerprint?: string | null;
  providerChallenge?: unknown;
  proofSeenOk?: boolean;
}

/** An observation-only write: no state change, so no audit row (high-volume, not security-sensitive). */
async function writeCheck(env: ApplyEnv, row: GroupRow, w: CheckWrite): Promise<void> {
  const set: PgUpdateSetSource<typeof organizationDomains> = {
    observation: w.observation,
    lastCheckedAt: dbNow(),
    lastCheckClass: w.checkClass,
    nextCheckAt: dbNowPlus(Math.min(w.nextInMs, nextCheckCapMs(row.state))),
  };
  if (w.proofMissCount !== undefined) set.proofMissCount = w.proofMissCount;
  if (w.probeMissCount !== undefined) set.probeMissCount = w.probeMissCount;
  if (w.notifyState !== undefined) set.notifyState = w.notifyState as Record<string, unknown>;
  if (w.nsFingerprint !== undefined) set.nsFingerprint = w.nsFingerprint;
  if (w.providerChallenge !== undefined) set.providerChallenge = w.providerChallenge;
  if (w.proofSeenOk) set.proofLastOkAt = dbNow();
  await env.tx
    .update(organizationDomains)
    .set(set)
    .where(and(eq(organizationDomains.id, row.id), eq(organizationDomains.state, row.state)));
}

function patchFrom(
  p: Persistence,
  extra: Partial<DomainPatch> & { observation?: Record<string, unknown> } = {},
): DomainPatch {
  return {
    proofMissCount: p.proofMissCount,
    lastCheckedAt: dbNow(),
    lastCheckClass: p.checkClass,
    observation: p.observation,
    notifyState: p.notifyState as Record<string, unknown>,
    ...(p.present ? { proofLastOkAt: dbNow() } : {}),
    ...extra,
  };
}

/** `proof_lost`: enough consecutive definitive misses over enough time. */
async function loseProof(env: ApplyEnv, row: GroupRow, p: Persistence): Promise<CheckOutcome> {
  await transitionDomain(env.tx, row, "proof_lost", env.actor, {
    trigger: env.trigger,
    patch: patchFrom(p, { lastCheckClass: "proof_absent" }),
  });
  note(env, "lapsed", row);
  return "lapsed";
}

function rowAgeMs(row: GroupRow, now: Date): number {
  return Math.max(0, now.getTime() - row.stateChangedAt.getTime());
}

function failureClass(r: { kind: string; reason?: string }): OrganizationDomainCheckClass {
  switch (r.kind) {
    case "retryable":
      return r.reason === "rate_limited" ? "rate_limited" : "provider_unavailable";
    case "config_error":
      return "config_error";
    case "blocked":
    case "rejected":
      return "provider_rejected";
    default:
      return "provider_unavailable";
  }
}

/**
 * A provider failure on `attach_pending` or `release_pending`: the row stays
 * where it is, the backoff grows with the consecutive failures, a rate limit's
 * `retry-after` is honoured (capped by the trigger's 6 hour ceiling), and the
 * operator hears about anything only they can fix - once per day per kind.
 */
async function recordProviderFailure(
  env: ApplyEnv,
  row: GroupRow,
  p: Persistence | null,
  baseObservation: Record<string, unknown>,
  result: AddResult | HostingRemoveResult,
  which: "attach" | "release",
): Promise<void> {
  const prev = readObservation(row.observation);
  const attempts = (prev.attempts ?? 0) + 1;
  const failingSince = prev.failingSince ?? env.now.toISOString();
  const state = which === "attach" ? "attach_pending" : "release_pending";
  const retryAfterMs = (result.kind === "retryable" ? (result.retryAfterSeconds ?? 0) : 0) * 1000;
  const nextInMs = Math.max(cadenceMs(state, { attempt: attempts - 1 }) ?? 0, retryAfterMs);

  let ns = p?.notifyState ?? readNotifyState(row.notifyState);
  if (result.kind === "config_error") ns = alertOperator(env, row, ns, "provider_config_error");
  else if (result.kind === "rejected") ns = alertOperator(env, row, ns, "provider_rejected");
  else if (result.kind === "blocked") ns = alertOperator(env, row, ns, "provider_blocked");
  if (env.now.getTime() - Date.parse(failingSince) >= DOMAIN_POLICY.providerFailingAlertMs) {
    ns = alertOperator(env, row, ns, which === "attach" ? "attach_failing" : "release_failing");
  }

  await writeCheck(env, row, {
    checkClass: failureClass(result),
    observation: { ...baseObservation, checkedAt: env.now.toISOString(), attempts, failingSince },
    nextInMs,
    proofMissCount: p?.proofMissCount,
    notifyState: ns,
  });
}

/** The observation a successful provider step leaves behind: the failure run is over. */
function clearedFailures(observation: Record<string, unknown>): Record<string, unknown> {
  const { attempts: _a, failingSince: _f, ...rest } = observation as Record<string, unknown> & {
    attempts?: unknown;
    failingSince?: unknown;
  };
  void _a;
  void _f;
  return rest;
}

/** What to persist about routing, targets and the probe after a serving-state check. */
function servingObservation(
  base: Record<string, unknown>,
  row: GroupRow,
  ev: RowEvidence,
  now: Date,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  if (ev.targets) {
    out.targets = { cname: ev.targets.value.cname, ipv4: ev.targets.value.ipv4, source: ev.targets.source };
  }
  if (ev.routing) {
    out.routing = {
      records: [
        { hostname: row.hostname, status: ev.routing.status, hint: ev.routing.hint, apex: ev.routing.apex },
      ],
    };
  }
  if (ev.probe) out.probe = { status: ev.probe, at: now.toISOString() };
  return out;
}

/** Vercel's own challenge, as the provider currently reports it (null once verified or when we could not read it). */
function challengeFrom(ev: RowEvidence): unknown {
  const verified = ev.verify?.kind === "ok" ? ev.verify : ev.domain?.kind === "ok" ? ev.domain : null;
  if (verified === null) return undefined; // not readable this round: leave what we have
  return verified.verified || verified.verification.length === 0 ? null : verified.verification;
}

/** The nameserver tripwire: first sight is recorded silently; a later difference notifies once and re-baselines. */
function nsDecision(env: ApplyEnv, row: GroupRow, ev: RowEvidence): string | null | undefined {
  if (ev.ns?.kind !== "ok") return undefined;
  if (row.nsFingerprint === null) return ev.ns.fingerprint;
  if (row.nsFingerprint !== ev.ns.fingerprint) {
    note(env, "ns_changed", row);
    return ev.ns.fingerprint;
  }
  return undefined;
}

// ---- per-state apply ------------------------------------------------------

async function applyPending(env: ApplyEnv, row: GroupRow, ev: RowEvidence): Promise<CheckOutcome> {
  const proof = ev.proof ?? "unknown";
  const checkClass: OrganizationDomainCheckClass =
    proof === "present" ? "ok" : proof === "unknown" ? "dns_unknown" : "proof_absent";
  const observation = {
    ...readObservation(row.observation),
    checkedAt: env.now.toISOString(),
    proof: { status: proof },
  };

  if (proof === "present") {
    try {
      // A SAVEPOINT: a unique violation here (another organization verified
      // this name first) must not abort the whole check.
      await env.tx.transaction((sp) =>
        transitionDomain(sp, row, "proof_ok", env.actor, {
          trigger: env.trigger,
          patch: {
            proofLastOkAt: dbNow(),
            proofMissCount: 0,
            lastCheckedAt: dbNow(),
            lastCheckClass: "ok",
            observation,
          },
        }),
      );
      return "verified";
    } catch (err) {
      if (classifyDomainDbError(err)?.kind !== "held_elsewhere") throw err;
      await writeCheck(env, row, { checkClass: "held_elsewhere", observation, nextInMs: cadenceMs("pending")! });
      return "held_elsewhere";
    }
  }
  // Absent or wrong value, on a claim past its expiry: it expires. An
  // `unknown` lookup never expires a claim (the proof may be there).
  if (row.dbExpired && (proof === "absent" || proof === "wrong_value")) {
    await transitionDomain(env.tx, row, "expire", env.actor, {
      trigger: env.trigger,
      patch: { lastCheckedAt: dbNow(), lastCheckClass: checkClass, observation },
    });
    return "expired";
  }
  await writeCheck(env, row, { checkClass, observation, nextInMs: cadenceMs("pending")! });
  return "unchanged";
}

async function applyVerified(env: ApplyEnv, row: GroupRow, ev: RowEvidence): Promise<CheckOutcome> {
  const p = proofPersistence(env, row, ev);
  if (p.lost) return loseProof(env, row, p);
  if (!p.present || row.purpose !== "web") {
    await writeCheck(env, row, {
      checkClass: p.checkClass,
      observation: p.observation,
      nextInMs: cadenceMs("verified")!,
      proofMissCount: p.proofMissCount,
      notifyState: p.notifyState,
      nsFingerprint: nsDecision(env, row, ev),
      proofSeenOk: p.present,
    });
    return "unchanged";
  }
  // Intent first: commit `attach_pending` BEFORE the provider call, so a crash
  // between the two leaves a retryable state, never a half-attached host.
  await transitionDomain(env.tx, row, "attach_start", env.actor, {
    trigger: env.trigger,
    patch: patchFrom(p, { nsFingerprint: nsDecision(env, row, ev) }),
  });
  env.followUp.push(row.id);
  return "attach_waiting";
}

async function applyAttachPending(env: ApplyEnv, row: GroupRow, ev: RowEvidence): Promise<CheckOutcome> {
  const p = proofPersistence(env, row, ev);
  if (p.lost) return loseProof(env, row, p);
  const prev = readObservation(row.observation);
  if (!p.present || !ev.add) {
    // No proof, no provider call. The backoff does not advance on a round we did not try.
    await writeCheck(env, row, {
      checkClass: p.checkClass,
      observation: servingObservation(p.observation, row, ev, env.now),
      nextInMs: cadenceMs("attach_pending", { attempt: Math.max(0, (prev.attempts ?? 1) - 1) })!,
      proofMissCount: p.proofMissCount,
      notifyState: p.notifyState,
    });
    return "attach_waiting";
  }

  if (ev.add.kind === "ok" || ev.add.kind === "already_on_project") {
    const challenge =
      ev.add.kind === "ok"
        ? ev.add.verified
          ? null
          : ev.add.verification
        : ev.domain?.kind === "ok" && !ev.domain.verified
          ? ev.domain.verification
          : null;
    await transitionDomain(env.tx, row, "attach_ok", env.actor, {
      trigger: env.trigger,
      patch: patchFrom(p, {
        providerChallenge: challenge,
        observation: servingObservation(clearedFailures(p.observation), row, ev, env.now),
      }),
    });
    return "attached";
  }

  await recordProviderFailure(env, row, p, servingObservation(p.observation, row, ev, env.now), ev.add, "attach");
  return "attach_waiting";
}

async function applyServing(env: ApplyEnv, row: GroupRow, ev: RowEvidence): Promise<CheckOutcome> {
  const p = proofPersistence(env, row, ev);
  if (p.lost) return loseProof(env, row, p);

  if (!p.present) {
    await writeCheck(env, row, {
      checkClass: p.checkClass,
      observation: p.observation,
      nextInMs: cadenceMs(row.state, { sinceStateChangedMs: rowAgeMs(row, env.now) })!,
      proofMissCount: p.proofMissCount,
      notifyState: p.notifyState,
    });
    return "unchanged";
  }

  const observation = servingObservation(p.observation, row, ev, env.now);
  const providerChallenge = challengeFrom(ev);
  const nsFingerprint = nsDecision(env, row, ev);
  const routingBad =
    ev.routing !== undefined &&
    (ev.routing.hint === "proxied" ||
      ev.routing.status === "wrong_value" ||
      ev.routing.status === "missing" ||
      ev.routing.status === "conflicting");
  const providerFailing = [ev.domain, ev.verify].some(
    (r) => r !== undefined && (r.kind === "config_error" || r.kind === "rejected"),
  );
  let ns = p.notifyState;
  if (providerFailing) ns = alertOperator(env, row, ns, "provider_config_error");

  if (row.state === "attached") {
    // `live` means: proof valid and the probe came back from THIS deployment.
    // Operator Q7 (a Cloudflare-proxied record may not go live) is enforced one
    // step earlier, in gatherEvidence: a host whose records definitively point
    // somewhere else - which is what a proxied record is - is never probed, so
    // it cannot be acknowledged.
    if (ev.probe === "ack") {
      await transitionDomain(env.tx, row, "live_ok", env.actor, {
        trigger: env.trigger,
        patch: patchFrom(p, {
          probeMissCount: 0,
          lastCheckClass: "ok",
          observation: clearedFailures(observation),
          providerChallenge,
          nsFingerprint,
          notifyState: ns as Record<string, unknown>,
        }),
      });
      return "live";
    }
    await writeCheck(env, row, {
      checkClass: routingBad ? "routing_wrong" : providerFailing ? "config_error" : "ok",
      observation,
      nextInMs: cadenceMs("attached", { sinceStateChangedMs: rowAgeMs(row, env.now) })!,
      proofMissCount: p.proofMissCount,
      notifyState: ns,
      nsFingerprint,
      providerChallenge,
      proofSeenOk: true,
    });
    return "unchanged";
  }

  // live
  const probeStep = stepProbeStreak(row.probeMissCount, ev.probe ?? "unknown", env.forced);
  if (probeStep.lost) {
    await transitionDomain(env.tx, row, "live_lost", env.actor, {
      trigger: env.trigger,
      patch: patchFrom(p, {
        probeMissCount: 0,
        lastCheckClass: "routing_wrong",
        observation,
        providerChallenge,
        nsFingerprint,
        notifyState: ns as Record<string, unknown>,
      }),
    });
    return "live_lost";
  }
  await writeCheck(env, row, {
    checkClass: routingBad || ev.probe === "negative" ? "routing_wrong" : providerFailing ? "config_error" : "ok",
    observation,
    nextInMs: cadenceMs("live")!,
    proofMissCount: p.proofMissCount,
    probeMissCount: probeStep.count,
    notifyState: ns,
    nsFingerprint,
    providerChallenge,
    proofSeenOk: true,
  });
  return "unchanged";
}

async function applyLapsed(env: ApplyEnv, row: GroupRow, ev: RowEvidence): Promise<CheckOutcome> {
  const proof = ev.proof ?? "unknown";
  const checkClass: OrganizationDomainCheckClass =
    proof === "present" ? "ok" : proof === "unknown" ? "dns_unknown" : "proof_absent";
  const observation = {
    ...readObservation(row.observation),
    checkedAt: env.now.toISOString(),
    proof: { status: proof },
  };
  delete (observation as { proofMissSince?: string }).proofMissSince;

  if (proof === "present") {
    await transitionDomain(env.tx, row, "proof_ok", env.actor, {
      trigger: env.trigger,
      patch: {
        proofLastOkAt: dbNow(),
        proofMissCount: 0,
        lastCheckedAt: dbNow(),
        lastCheckClass: "ok",
        observation,
      },
    });
    return "recovered";
  }
  if (row.dbGraceElapsed && row.purpose === "web") {
    await transitionDomain(env.tx, row, "grace_elapsed", env.actor, {
      trigger: env.trigger,
      patch: { lastCheckedAt: dbNow(), lastCheckClass: checkClass, observation },
    });
    return "release_requested";
  }
  await writeCheck(env, row, { checkClass, observation, nextInMs: cadenceMs("lapsed")! });
  return "unchanged";
}

async function applyParked(env: ApplyEnv, row: GroupRow, ev: RowEvidence): Promise<CheckOutcome> {
  const observation = { ...readObservation(row.observation), checkedAt: env.now.toISOString() };
  if (row.dbGraceElapsed) {
    await transitionDomain(env.tx, row, "grace_elapsed", env.actor, {
      trigger: env.trigger,
      patch: { lastCheckedAt: dbNow(), lastCheckClass: "ok", observation },
    });
    return "release_requested";
  }
  let ns = readNotifyState(row.notifyState);
  if (ev.routing?.pointsAtProvider === true && reminderDue(ns, env.now)) {
    note(env, "records_still_pointing", row);
    ns = { ...ns, parkedReminderAt: env.now.toISOString() };
  }
  await writeCheck(env, row, {
    checkClass: "ok",
    observation,
    nextInMs: cadenceMs("parked")!,
    notifyState: ns,
  });
  return "unchanged";
}

async function applyReleasePending(env: ApplyEnv, row: GroupRow, ev: RowEvidence): Promise<CheckOutcome> {
  const prev = readObservation(row.observation);
  const observation = { ...prev, checkedAt: env.now.toISOString() };
  if (!ev.remove) return "deferred";
  if (ev.remove.kind === "ok") {
    await transitionDomain(env.tx, row, "detach_ok", env.actor, {
      trigger: env.trigger,
      patch: { lastCheckedAt: dbNow(), lastCheckClass: "ok", observation: clearedFailures(observation) },
    });
    note(env, "released", row);
    return "released";
  }
  await recordProviderFailure(env, row, null, observation, ev.remove, "release");
  return "unchanged";
}

async function applyRow(env: ApplyEnv, row: GroupRow, ev: RowEvidence): Promise<CheckOutcome> {
  switch (row.state) {
    case "pending":
      return applyPending(env, row, ev);
    case "verified":
      return applyVerified(env, row, ev);
    case "attach_pending":
      return applyAttachPending(env, row, ev);
    case "attached":
    case "live":
      return applyServing(env, row, ev);
    case "lapsed":
      return applyLapsed(env, row, ev);
    case "parked":
      return applyParked(env, row, ev);
    case "release_pending":
      return applyReleasePending(env, row, ev);
    default:
      return "deferred";
  }
}

/**
 * Canonical promotion (Batch 1a-ii deviation 6, ruled in 1b): an organization
 * with NO canonical web host at all (its canonical claim was removed, and the
 * hosts that remain were claimed as aliases) promotes the first host of THIS
 * group that is `live` and not held. Self-healing and idempotent: it runs after
 * every group check, so it does not matter which transition made a host live.
 *
 * It does NOT replace a canonical that exists but is not serving (lapsed,
 * attached, held): that would be a surprise redirect, and the predicate already
 * darkens the aliases rather than redirect them nowhere. Only the absence of
 * any canonical is repaired - the same thing that makes a first-ever claim's
 * host canonical. The group is already locked; a rival promotion from another
 * group loses to `organization_domains_one_canonical_uq` and is simply skipped.
 */
async function ensureCanonical(env: ApplyEnv, group: readonly GroupRow[]): Promise<void> {
  const web = group.filter((r) => r.purpose === "web");
  if (web.length === 0) return;
  const org = await env.tx
    .select({ id: organizationDomains.id })
    .from(organizationDomains)
    .where(
      and(
        eq(organizationDomains.organizationId, env.organizationId),
        eq(organizationDomains.purpose, "web"),
        eq(organizationDomains.webRole, "canonical"),
        notInArray(organizationDomains.state, TERMINAL),
      ),
    )
    .limit(1);
  if (org.length > 0) return;

  // Re-read the group's rows as they are NOW (this check may have just made one live).
  const fresh = await env.tx
    .select()
    .from(organizationDomains)
    .where(inArray(organizationDomains.id, web.map((r) => r.id)));
  const candidates = fresh
    .filter((r) => r.state === "live" && r.platformHold === null)
    .sort((a, b) => Number(b.hostname.startsWith("www.")) - Number(a.hostname.startsWith("www.")) || a.hostname.localeCompare(b.hostname));
  const pick = candidates[0];
  if (!pick) return;

  try {
    await env.tx.transaction(async (sp) => {
      await sp.update(organizationDomains).set({ webRole: "canonical" }).where(eq(organizationDomains.id, pick.id));
      await insertAuditRow(sp, {
        action: AUDIT_ACTIONS.DOMAIN_CANONICAL_CHANGED,
        actor: actorAudit(env.actor),
        resourceType: "organization_domain",
        resourceId: pick.id,
        metadata: {
          organizationId: env.organizationId,
          hostname: pick.hostname,
          claimName: pick.claimName,
          purpose: pick.purpose,
          fromHostname: null,
          toHostname: pick.hostname,
          actorKind: env.actor.kind,
          ...(env.actor.kind === "machine" ? { trigger: env.actor.trigger } : {}),
          reason: "no_canonical",
        },
      });
    });
    // An automatic re-point of where the slug URL redirects is as notice-worthy
    // as the manual `changeCanonical` (tech-lead ruling on 1b Deviation 1,
    // follow-up B). Only a promotion that COMMITTED reaches here: the idempotent
    // no-op (a canonical already exists) and the rival-promotion loser return
    // above or in the catch, so neither sends a notice.
    note(env, "canonical_changed", pick);
  } catch (err) {
    if (classifyDomainDbError(err)?.kind !== "second_canonical") throw err;
  }
}

async function orgIsClosed(tx: DomainTx, organizationId: string): Promise<boolean> {
  const row = rowsOf<{ lifecycle_status: string }>(
    await tx.execute(sql`select lifecycle_status from organizations where id = ${organizationId}::uuid`),
  )[0];
  return row !== undefined && row.lifecycle_status !== "active";
}

export interface ObserveOptions {
  /** A person pressed "Check now" (rate-limited; a single negative probe is enough to demote a live host). The cron passes false. */
  forced: boolean;
  deps?: DomainServiceDeps;
  /** Restrict the check to these rows of the claim (the sweep passes the rows it leased). */
  rowIds?: ReadonlySet<string>;
}

interface ApplyResult {
  kind: "ok";
  outcomes: Map<string, CheckOutcome>;
  followUp: string[];
  notifications: Array<{ event: DomainNotificationEvent; hostnames: string[] }>;
  alerts: Array<{ kind: OperatorAlertKind; hostnames: string[] }>;
  ctx: NotificationContext | null;
  operatorCtx: NotificationContext | null;
}

/**
 * THE one check routine (Phase 3 section 6): the cron, a church's "Check now"
 * and the platform's "Check now" all land here. Three steps per pass, so no
 * transaction is ever held across the network:
 *
 *   1. READ the claim group (and gate it).
 *   2. NETWORK: the proof lookup, then the provider calls each row's state
 *      calls for (gatherEvidence). No transaction is open.
 *   3. APPLY: re-read the group FOR UPDATE, drop any row whose state moved
 *      while we were out, and advance each row through `transitionDomain` (one
 *      audit row per edge) or an observation-only write.
 *
 * INTENT FIRST. `verified -> attach_pending` commits in pass one; pass two
 * (same call) makes the provider call for exactly those rows. A crash between
 * the commit and the call leaves `attach_pending`, which the sweep retries
 * idempotently - the provider's add is idempotent - so there is never a
 * half-attached host and never an attached host we have no row for.
 *
 * Notifications and operator alerts are collected inside the transaction (on
 * the caller's own connection) and SENT only after it commits.
 */
export async function observeAndAdvance(
  actor: DomainActor,
  organizationId: string,
  claimName: string,
  opts: ObserveOptions,
): Promise<CheckResult> {
  const d = resolveDeps(opts.deps);
  const exec = domainExec(actor, organizationId);
  const trigger = opts.forced ? "check_now" : undefined;

  // Step 1: read (and gate), no lock held past this transaction.
  const snapshot = await guarded(() =>
    exec(async (tx) => {
      const refused = await gate(tx, actor, organizationId);
      if (refused) return { kind: refused } as const;
      const all = await groupRows(tx, organizationId, claimName, false);
      if (all.length === 0) return { kind: "not_found" } as const;
      const rows = opts.rowIds ? all.filter((r) => opts.rowIds!.has(r.id)) : all;
      // Only the sweep removes a closed organization's domains.
      const closed = actor.kind === "machine" ? await orgIsClosed(tx, organizationId) : false;
      return { kind: "ok", rows, closed } as const;
    }),
  );
  if (snapshot.kind !== "ok") return snapshot;

  if (opts.forced) {
    const perClaim = await rateLimited(
      actor,
      `domains:check:${organizationId}:${claimName}`,
      DOMAIN_POLICY.checkNowPerClaim,
      "domain check now (claim)",
    );
    if (perClaim !== null) return { kind: "rate_limited", retryAfterSeconds: perClaim };
    const perOrg = await rateLimited(
      actor,
      `domains:check-org:${organizationId}`,
      DOMAIN_POLICY.checkNowPerOrg,
      "domain check now (organization)",
    );
    if (perOrg !== null) return { kind: "rate_limited", retryAfterSeconds: perOrg };
  }

  const proofSeen = new Map<string, ProofObservation>();
  const outcomes = new Map<string, CheckOutcome>();
  let rows: GroupRow[] = snapshot.rows;

  for (let pass = 0; pass < 2 && rows.length > 0; pass += 1) {
    // A closed organization's rows are removed without looking at the network;
    // rows already parked or releasing keep going through the normal checks.
    const evidenceRows = snapshot.closed ? rows.filter((r) => r.state === "parked" || r.state === "release_pending") : rows;
    const evidence = await gatherEvidence(evidenceRows, claimName, proofSeen, d);

    const seenState = new Map(rows.map((r) => [r.id, r.state] as const));
    const applied = await guarded(() =>
      exec(async (tx): Promise<ApplyResult> => {
        const env: ApplyEnv = {
          tx,
          actor,
          trigger,
          now: d.now(),
          forced: opts.forced,
          organizationId,
          notifications: new Map(),
          alerts: new Map(),
          followUp: [],
        };
        const locked = await groupRows(tx, organizationId, claimName, true);
        const out = new Map<string, CheckOutcome>();
        for (const row of locked) {
          if (seenState.get(row.id) !== row.state) continue; // moved under us (or not ours this pass): drop it
          if (snapshot.closed && row.state !== "parked" && row.state !== "release_pending") {
            await transitionDomain(tx, row, "remove", actor, {
              cause: "org_closed",
              trigger: "org_closed",
              patch: row.webRole === "canonical" ? { webRole: "alias" } : undefined,
            });
            note(env, "removed", row);
            out.set(row.id, "removed");
            continue;
          }
          const ev = evidence.get(row.id);
          if (!ev) continue;
          out.set(row.id, await applyRow(env, row, ev));
        }
        await ensureCanonical(env, locked.filter((r) => seenState.has(r.id)));

        const ctx = env.notifications.size > 0 ? await collectNotificationContext(tx, organizationId) : null;
        const operatorCtx = env.alerts.size > 0 ? await collectOperatorContext(tx, organizationId) : null;
        return {
          kind: "ok",
          outcomes: out,
          followUp: env.followUp,
          notifications: [...env.notifications].map(([event, hostnames]) => ({ event, hostnames })),
          alerts: [...env.alerts].map(([kind, hostnames]) => ({ kind, hostnames })),
          ctx,
          operatorCtx,
        };
      }),
    );
    if (applied.kind !== "ok") return applied;

    for (const [id, outcome] of applied.outcomes) outcomes.set(id, outcome);
    for (const n of applied.notifications) await notifyAfterCommit(applied.ctx, n.event, n.hostnames, actor);
    for (const a of applied.alerts) {
      try {
        await sendOperatorAlert(applied.operatorCtx, a.kind, a.hostnames);
      } catch {
        console.error(`[domains] operator alert failed (${a.kind})`);
      }
    }

    if (applied.followUp.length === 0) break;
    // Pass two: the rows that just committed `attach_pending` now make their provider call.
    const ids = new Set(applied.followUp);
    const reread = await guarded(() =>
      exec(async (tx) => ({
        kind: "ok" as const,
        rows: (await groupRows(tx, organizationId, claimName, false)).filter((r) => ids.has(r.id)),
      })),
    );
    if (reread.kind !== "ok") return reread;
    rows = reread.rows;
  }

  const found = [...outcomes.values()];
  const outcome = OUTCOME_PRIORITY.find((o) => found.includes(o)) ?? "deferred";
  const statuses = [...proofSeen.values()];
  return { kind: "ok", outcome, proof: statuses[0] ?? null, checkedAt: new Date().toISOString() };
}

/**
 * "Check now" and the cron's per-claim work. Kept under its Batch 1a-ii name so
 * the actions and their tests are untouched; it IS `observeAndAdvance`.
 */
export async function checkClaim(
  actor: DomainActor,
  organizationId: string,
  claimName: string,
  opts: { forced: boolean; deps?: DomainServiceDeps },
): Promise<CheckResult> {
  return observeAndAdvance(actor, organizationId, claimName, opts);
}

// ---------------------------------------------------------------------------
// changeCanonical
// ---------------------------------------------------------------------------

export type CanonicalResult =
  | { kind: "ok"; changed: boolean; canonical: DomainSummary }
  | { kind: "not_live" }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "feature_off" };

/**
 * Makes `domainId` the organization's canonical web host. Only a `live` host
 * with no platform hold qualifies (a canonical that is dark would darken the
 * aliases that redirect to it). Demote-then-promote in one transaction:
 * `organization_domains_one_canonical_uq` is not deferrable, so the old
 * canonical becomes an alias BEFORE the new one is promoted. One
 * `domain.canonical_changed` audit row for the swap (a role change is not a
 * state edge).
 */
export async function changeCanonical(
  actor: DomainActor,
  organizationId: string,
  domainId: string,
): Promise<CanonicalResult> {
  if (actor.kind === "machine") return { kind: "forbidden" };
  let notifyCtx: NotificationContext | null = null;
  const result = await guarded(() =>
    domainExec(actor, organizationId)(async (tx): Promise<CanonicalResult> => {
      const refused = await gate(tx, actor, organizationId);
      if (refused) return { kind: refused };

      const rows = await orgWebRows(tx, organizationId, true);
      const target = rows.find((r) => r.id === domainId);
      if (!target) return { kind: "not_found" };
      if (target.state !== "live" || target.platformHold !== null) return { kind: "not_live" };
      if (target.webRole === "canonical") {
        return { kind: "ok", changed: false, canonical: summarize(target) };
      }

      const old = rows.find((r) => r.webRole === "canonical");
      if (old) {
        await tx
          .update(organizationDomains)
          .set({ webRole: "alias" })
          .where(eq(organizationDomains.id, old.id));
      }
      const [promoted] = await tx
        .update(organizationDomains)
        .set({ webRole: "canonical" })
        .where(eq(organizationDomains.id, target.id))
        .returning();

      await insertAuditRow(tx, {
        action: AUDIT_ACTIONS.DOMAIN_CANONICAL_CHANGED,
        actor: actorAudit(actor),
        resourceType: "organization_domain",
        resourceId: target.id,
        metadata: {
          organizationId,
          hostname: target.hostname,
          claimName: target.claimName,
          purpose: target.purpose,
          fromHostname: old?.hostname ?? null,
          toHostname: target.hostname,
          actorKind: actor.kind,
        },
      });
      notifyCtx = await collectNotificationContext(tx, organizationId);
      return { kind: "ok", changed: true, canonical: summarize(promoted!) };
    }),
  );
  if (result.kind === "ok" && result.changed) {
    await notifyAfterCommit(notifyCtx, "canonical_changed", [result.canonical.hostname], actor);
  }
  return result;
}

// ---------------------------------------------------------------------------
// removeClaim
// ---------------------------------------------------------------------------

export type RemoveResult =
  | { kind: "ok"; removed: DomainSummary[]; promoted: DomainSummary | null }
  | { kind: "needs_canonical"; candidates: DomainSummary[] }
  | { kind: "invalid_target" }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "feature_off" };

/**
 * Removes a claim group. Each host leaves along its own legal `remove` edge:
 * `pending` / `verified` -> `released`; `attach_pending` / `attached` / `live`
 * / `lapsed` -> `parked` (still attached, serving a neutral 404 for the 30-day
 * grace, G10); a `lapsed` MAIL row -> `released`. Rows already `parked` or
 * `release_pending` are left alone.
 *
 * Removing the group that holds the canonical host while OTHER hosts are live
 * would strand them, so it needs `promoteDomainId` (one of those live hosts):
 * the removed canonical is demoted to alias first (the unique index is not
 * deferrable), then the target is promoted. With no live host elsewhere it
 * simply proceeds.
 */
export async function removeClaim(
  actor: DomainActor,
  organizationId: string,
  claimName: string,
  promoteDomainId?: string,
): Promise<RemoveResult> {
  if (actor.kind === "machine") return { kind: "forbidden" };
  let notifyCtx: NotificationContext | null = null;
  const result = await guarded(() =>
    domainExec(actor, organizationId)(async (tx): Promise<RemoveResult> => {
      const refused = await gate(tx, actor, organizationId);
      if (refused) return { kind: refused };

      const all = await orgWebRows(tx, organizationId, true);
      const group = all.filter((r) => r.claimName === claimName);
      if (group.length === 0) return { kind: "not_found" };

      const removable = group.filter((r) => r.state !== "parked" && r.state !== "release_pending");
      const others = all.filter((r) => r.claimName !== claimName);
      const strands = removable.some((r) => r.webRole === "canonical");
      const liveElsewhere = others.filter((r) => r.state === "live" && r.platformHold === null);

      // A promotion target matters only when removing this group would strand
      // live hosts elsewhere; otherwise a canonical already exists outside the
      // group (or nothing else is live) and a stray target is ignored.
      let promote: (typeof all)[number] | null = null;
      if (strands && liveElsewhere.length > 0) {
        if (!promoteDomainId) return { kind: "needs_canonical", candidates: liveElsewhere.map(summarize) };
        promote = liveElsewhere.find((r) => r.id === promoteDomainId) ?? null;
        if (!promote) return { kind: "invalid_target" };
      }

      const removed: DomainSummary[] = [];
      for (const row of removable) {
        const updated = await transitionDomain(tx, row, "remove", actor, {
          patch: row.webRole === "canonical" ? { webRole: "alias" } : undefined,
        });
        removed.push(summarize(updated));
      }

      let promoted: DomainSummary | null = null;
      if (promote) {
        const [row] = await tx
          .update(organizationDomains)
          .set({ webRole: "canonical" })
          .where(eq(organizationDomains.id, promote.id))
          .returning();
        promoted = summarize(row!);
        await insertAuditRow(tx, {
          action: AUDIT_ACTIONS.DOMAIN_CANONICAL_CHANGED,
          actor: actorAudit(actor),
          resourceType: "organization_domain",
          resourceId: promote.id,
          metadata: {
            organizationId,
            hostname: promote.hostname,
            claimName: promote.claimName,
            purpose: promote.purpose,
            fromHostname: group.find((r) => r.webRole === "canonical")?.hostname ?? null,
            toHostname: promote.hostname,
            actorKind: actor.kind,
            reason: "canonical_group_removed",
          },
        });
      }

      if (removed.length > 0) notifyCtx = await collectNotificationContext(tx, organizationId);
      return { kind: "ok", removed, promoted };
    }),
  );
  if (result.kind === "ok" && result.removed.length > 0) {
    await notifyAfterCommit(notifyCtx, "removed", result.removed.map((r) => r.hostname), actor);
  }
  return result;
}

// ---------------------------------------------------------------------------
// reconnectClaim
// ---------------------------------------------------------------------------

export type ReconnectResult =
  | { kind: "ok"; reconnected: DomainSummary[] }
  | { kind: "proof_missing"; proof: "absent" | "wrong_value" }
  | { kind: "dns_unknown" }
  | { kind: "not_parked" }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "stale" }
  | { kind: "forbidden" }
  | { kind: "feature_off" }
  | { kind: "not_found" };

/**
 * Brings a parked (removed) claim back: `parked -> verified`, but only after
 * the service confirms the TXT proof is live again (a parked name is still
 * attached and held, so reconnecting without proof would resurrect a claim the
 * church may no longer control). From `verified`, Batch 1b's attach step takes
 * over; the host is already on the project, so that is an idempotent
 * "already attached".
 */
export async function reconnectClaim(
  actor: DomainActor,
  organizationId: string,
  claimName: string,
  opts: { deps?: DomainServiceDeps } = {},
): Promise<ReconnectResult> {
  if (actor.kind === "machine") return { kind: "forbidden" };
  const dns = opts.deps?.dns ?? getAdapters().dns;
  const exec = domainExec(actor, organizationId);

  const snapshot = await guarded(() =>
    exec(async (tx) => {
      const refused = await gate(tx, actor, organizationId);
      if (refused) return { kind: refused } as const;
      const rows = await groupRows(tx, organizationId, claimName, false);
      if (rows.length === 0) return { kind: "not_found" } as const;
      const parked = rows.filter((r) => r.state === "parked");
      return parked.length === 0 ? ({ kind: "not_parked" } as const) : ({ kind: "ok", parked } as const);
    }),
  );
  if (snapshot.kind !== "ok") return snapshot;

  // A reconnect triggers outbound lookups the same way "Check now" does.
  const limited =
    (await rateLimited(
      actor,
      `domains:check:${organizationId}:${claimName}`,
      DOMAIN_POLICY.checkNowPerClaim,
      "domain reconnect (claim)",
    )) ??
    (await rateLimited(
      actor,
      `domains:check-org:${organizationId}`,
      DOMAIN_POLICY.checkNowPerOrg,
      "domain reconnect (organization)",
    ));
  if (limited !== null) return { kind: "rate_limited", retryAfterSeconds: limited };

  const proofs = new Map<string, ProofCheck["status"]>();
  for (const token of new Set(snapshot.parked.map((r) => r.proofToken))) {
    proofs.set(token, (await checkProof(dns, claimName, token)).status);
  }
  const statuses = [...proofs.values()];
  if (statuses.includes("unknown")) return { kind: "dns_unknown" };
  const failed = statuses.find((s) => s !== "present");
  if (failed) return { kind: "proof_missing", proof: failed === "wrong_value" ? "wrong_value" : "absent" };

  let notifyCtx: NotificationContext | null = null;
  const result = await guarded(() =>
    exec(async (tx): Promise<ReconnectResult> => {
      const locked = (await groupRows(tx, organizationId, claimName, true)).filter(
        (r) => r.state === "parked",
      );
      if (locked.length !== snapshot.parked.length) return { kind: "stale" };
      const observation = (row: GroupRow) => ({
        ...readObservation(row.observation),
        checkedAt: new Date().toISOString(),
        proof: { status: "present" as const },
      });
      const reconnected: DomainSummary[] = [];
      for (const row of locked) {
        const updated = await transitionDomain(tx, row, "reconnect", actor, {
          trigger: "reconnect",
          patch: {
            proofLastOkAt: dbNow(),
            proofMissCount: 0,
            probeMissCount: 0,
            lastCheckedAt: dbNow(),
            lastCheckClass: "ok",
            observation: observation(row),
          },
        });
        reconnected.push(summarize(updated));
      }
      notifyCtx = await collectNotificationContext(tx, organizationId);
      return { kind: "ok", reconnected };
    }),
  );
  if (result.kind === "ok") {
    await notifyAfterCommit(notifyCtx, "reconnected", result.reconnected.map((r) => r.hostname), actor);
  }
  return result;
}

// ---------------------------------------------------------------------------
// readDomainsView (the page's read: the gate, the rows, the pre-flight)
// ---------------------------------------------------------------------------

export type DomainsViewResult =
  | { kind: "ok"; groups: ChecklistGroup[]; siteStatus: string | null; activity: ActivityItem[] }
  | { kind: "forbidden" }
  | { kind: "feature_off" };

/**
 * Everything the domains page renders, behind the same gate as the writes:
 * `domains.manage`, then the operator-enabled `org_portal.domains` toggle. The
 * rows go through the pure checklist builder. `siteStatus` comes from the
 * tenant-callable, argument-free `presby_current_org_site_status()` (T12), the
 * only way a tenant connection can see its own site's status (the table has no
 * `presby_app` grant).
 */
export async function readDomainsView(
  personId: string,
  organizationId: string,
  context: { platformSiteUrl: string },
): Promise<DomainsViewResult> {
  return guarded(() =>
    withOrgContext(personId, organizationId, async (tx): Promise<DomainsViewResult> => {
      const refused = await gate(tx, { kind: "tenant", personId }, organizationId);
      if (refused === "forbidden") return { kind: "forbidden" };
      if (refused === "feature_off") return { kind: "feature_off" };
      if (refused) return { kind: "forbidden" };

      const rows = await tx
        .select()
        .from(organizationDomains)
        .where(
          and(
            eq(organizationDomains.organizationId, organizationId),
            notInArray(organizationDomains.state, TERMINAL),
          ),
        );
      const siteStatus =
        rowsOf<{ status: string | null }>(
          await tx.execute(sql`select presby_current_org_site_status() as status`),
        )[0]?.status ?? null;

      const checklistRows: ChecklistRow[] = rows.map((r) => ({
        id: r.id,
        hostname: r.hostname,
        claimName: r.claimName,
        purpose: r.purpose,
        webRole: r.webRole,
        state: r.state,
        platformHold: r.platformHold,
        proofToken: r.proofToken,
        lastCheckedAt: r.lastCheckedAt,
        lastCheckClass: r.lastCheckClass,
        expiresAt: r.expiresAt,
        graceEndsAt: r.graceEndsAt,
        observation: r.observation,
        providerChallenge: r.providerChallenge,
        createdAt: r.createdAt,
        stateChangedAt: r.stateChangedAt,
      }));

      // "Recent activity": this organization's own `domain.*` audit rows, newest
      // first. audit_events carries no organization column and no RLS, so the
      // metadata.organizationId filter (written by this service on every row) is
      // an application field, not a database property. Batch 1e anchors the read
      // to the database as well: a row is shown only if its resource_id is the id
      // of an `organization_domains` row THIS connection can see (that table is
      // FORCE-RLS under the caller's org GUC), so a row naming another
      // organization's domain cannot appear however its metadata was stamped.
      // Both clauses stay. The cast is on the organization_domains side
      // (`id::text`), never on audit_events.resource_id, so an index on that
      // column stays usable. Only the `domain.` action family is selected, and
      // activity.ts maps rows to hostnames and a who-category, never an email,
      // id or IP. (Increment 2's `mail_domain.*` reader is written anchored the
      // same way from its first line.)
      const auditRows = await tx
        .select({ id: auditEvents.id, action: auditEvents.action, createdAt: auditEvents.createdAt, metadata: auditEvents.metadata })
        .from(auditEvents)
        .where(
          and(
            sql`${auditEvents.action} like 'domain.%'`,
            sql`${auditEvents.metadata}->>'organizationId' = ${organizationId}`,
            eq(auditEvents.resourceType, "organization_domain"),
            sql`${auditEvents.resourceId} in (select ${organizationDomains.id}::text from ${organizationDomains})`,
          ),
        )
        .orderBy(desc(auditEvents.createdAt))
        .limit(25);
      return {
        kind: "ok",
        groups: buildChecklist(checklistRows, { siteStatus, platformSiteUrl: context.platformSiteUrl }),
        siteStatus,
        activity: buildActivity(auditRows).slice(0, 10),
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// The sweep (the cron's whole job)
// ---------------------------------------------------------------------------

export interface SweepOptions {
  /** Most rows to lease in this invocation (default 50, max 200). */
  limit?: number;
  /** Claim groups processed at once (default 5). */
  concurrency?: number;
  /** Epoch ms after which no NEW group is started (the invocation's time budget). */
  deadlineMs?: number;
  /** Restrict the sweep to these organizations (used by tests and a future per-org "sweep now"). */
  organizationIds?: readonly string[];
  deps?: DomainServiceDeps;
}

/** Counts only: never a hostname, an error message or a provider string. */
export interface SweepSummary {
  picked: number;
  groups: number;
  advanced: number;
  failed: number;
  outcomes: Record<string, number>;
}

interface LeasedRow {
  id: string;
  organization_id: string;
  claim_name: string;
}

/**
 * Leases the rows that are due. ONE statement: it picks `limit` due rows
 * `FOR UPDATE SKIP LOCKED` and pushes their `next_check_at` out by the lease,
 * so two overlapping sweeps (a retried invocation, a slow run still going when
 * the next tick fires) can never take the same row - the second sees the rows
 * the first locked, skips them, and takes the next. A row whose processing dies
 * is simply due again when its lease runs out. A non-terminal row with no
 * `next_check_at` at all (one created out of band) is treated as due.
 */
export async function leaseDueDomains(limit: number, organizationIds?: readonly string[]): Promise<LeasedRow[]> {
  const scope =
    organizationIds && organizationIds.length > 0
      ? sql`and organization_id in (${sql.join(organizationIds.map((id) => sql`${id}::uuid`), sql`, `)})`
      : sql``;
  const leaseSeconds = DOMAIN_POLICY.sweep.leaseMs / 1000;
  const result = await getPlatformDb().execute(sql`
    update organization_domains d
       set next_check_at = now() + (${leaseSeconds}::double precision * interval '1 second')
     where d.id in (
       select id
         from organization_domains
        where state not in ('expired', 'released')
          and (next_check_at is null or next_check_at <= now())
          ${scope}
        order by next_check_at nulls first, id
        limit ${limit}
          for update skip locked
     )
    returning d.id, d.organization_id, d.claim_name
  `);
  return rowsOf<LeasedRow>(result);
}

/**
 * One cron tick: lease the due rows, group them by claim, and run each group
 * through `observeAndAdvance` as the machine actor. Idempotent by
 * construction - every step is a function of stored state plus what the
 * network says now, and every transition is optimistic (`where state = from`) -
 * so a duplicated or missed invocation costs nothing. Reconciliation of
 * `attach_pending` and `release_pending` is not a separate pass: they are
 * simply due rows whose check retries the idempotent provider call.
 */
export async function sweepDueDomains(opts: SweepOptions = {}): Promise<SweepSummary> {
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? DOMAIN_POLICY.sweep.defaultLimit)), DOMAIN_POLICY.sweep.maxLimit);
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? DOMAIN_POLICY.sweep.concurrency));
  const leased = await leaseDueDomains(limit, opts.organizationIds);

  const groups = new Map<string, { organizationId: string; claimName: string; ids: Set<string> }>();
  for (const r of leased) {
    const key = `${r.organization_id}\u0000${r.claim_name}`;
    const g = groups.get(key) ?? { organizationId: r.organization_id, claimName: r.claim_name, ids: new Set<string>() };
    g.ids.add(r.id);
    groups.set(key, g);
  }

  const summary: SweepSummary = { picked: leased.length, groups: groups.size, advanced: 0, failed: 0, outcomes: {} };
  const queue = [...groups.values()];
  const machine: DomainActor = { kind: "machine", trigger: "cron" };

  const worker = async () => {
    for (let g = queue.shift(); g !== undefined; g = queue.shift()) {
      if (opts.deadlineMs !== undefined && Date.now() >= opts.deadlineMs) return;
      try {
        const r = await observeAndAdvance(machine, g.organizationId, g.claimName, {
          forced: false,
          deps: opts.deps,
          rowIds: g.ids,
        });
        const label = r.kind === "ok" ? r.outcome : r.kind;
        summary.outcomes[label] = (summary.outcomes[label] ?? 0) + 1;
        if (r.kind === "ok" && r.outcome !== "unchanged" && r.outcome !== "deferred") summary.advanced += 1;
      } catch {
        summary.failed += 1;
        console.error(`[domains] sweep group failed (organization ${g.organizationId})`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return summary;
}

// ---------------------------------------------------------------------------
// Platform operations: check now, pause / resume, force-release
// ---------------------------------------------------------------------------

type PlatformActor = Extract<DomainActor, { kind: "platform" }>;
const isPlatform = (actor: DomainActor): actor is PlatformActor => actor.kind === "platform";

/** "Check now" from the platform admin page: finds the claim from the row, then the same routine as everyone else. */
export async function checkDomainPlatform(
  actor: DomainActor,
  domainId: string,
  opts: { deps?: DomainServiceDeps } = {},
): Promise<CheckResult> {
  if (!isPlatform(actor)) return { kind: "forbidden" };
  const [row] = await getPlatformDb()
    .select({ organizationId: organizationDomains.organizationId, claimName: organizationDomains.claimName })
    .from(organizationDomains)
    .where(eq(organizationDomains.id, domainId))
    .limit(1);
  if (!row) return { kind: "not_found" };
  return observeAndAdvance(actor, row.organizationId, row.claimName, { forced: true, deps: opts.deps });
}

export type HoldResult =
  | { kind: "ok"; changed: boolean; domain: DomainSummary }
  | { kind: "invalid_reason" }
  | { kind: "not_found" }
  | { kind: "terminal" }
  | { kind: "forbidden" };

const REASON_MIN = 10;
const REASON_MAX = 500;

/**
 * Pauses (`paused`), puts in dispute (`disputed`), or resumes (`null`) one
 * host. `platform_hold` is an owner-only column (T2): the serving predicate
 * requires it null, so a hold darkens the host immediately with no DNS change,
 * and the tenant connection cannot clear it. Platform actors only. Audited
 * (`domain.hold_set` / `domain.hold_cleared`) in the same transaction; the
 * organization's holders and the platform admins are told after commit.
 */
export async function setDomainHold(
  actor: DomainActor,
  domainId: string,
  hold: "paused" | "disputed" | null,
  reason: string | null,
): Promise<HoldResult> {
  if (!isPlatform(actor)) return { kind: "forbidden" };
  const text = (reason ?? "").trim();
  if (hold !== null && (text.length < REASON_MIN || text.length > REASON_MAX)) return { kind: "invalid_reason" };

  let ctx: NotificationContext | null = null;
  const result = await getPlatformDb().transaction(async (tx): Promise<HoldResult> => {
    const [row] = await tx
      .select()
      .from(organizationDomains)
      .where(eq(organizationDomains.id, domainId))
      .for("update")
      .limit(1);
    if (!row) return { kind: "not_found" };
    if (isTerminal(row.state)) return { kind: "terminal" };
    if ((row.platformHold ?? null) === hold) return { kind: "ok", changed: false, domain: summarize(row) };

    const [updated] = await tx
      .update(organizationDomains)
      .set({ platformHold: hold, holdReason: hold === null ? null : text })
      .where(eq(organizationDomains.id, row.id))
      .returning();
    await insertAuditRow(tx as DomainTx, {
      action: hold === null ? AUDIT_ACTIONS.DOMAIN_HOLD_CLEARED : AUDIT_ACTIONS.DOMAIN_HOLD_SET,
      actor: actorAudit(actor),
      resourceType: "organization_domain",
      resourceId: row.id,
      metadata: {
        organizationId: row.organizationId,
        hostname: row.hostname,
        claimName: row.claimName,
        purpose: row.purpose,
        state: row.state,
        previousHold: row.platformHold,
        hold,
        ...(hold === null ? {} : { reason: text }),
        actorKind: actor.kind,
      },
    });
    ctx = await collectNotificationContext(tx as DomainTx, row.organizationId);
    return { kind: "ok", changed: true, domain: summarize(updated!) };
  });

  if (result.kind === "ok" && result.changed) {
    await notifyAfterCommit(ctx, hold === null ? "hold_cleared" : "hold_set", [result.domain.hostname], actor);
  }
  return result;
}

export type ForceReleaseResult =
  | { kind: "ok"; domain: DomainSummary }
  | { kind: "invalid_reason" }
  | { kind: "not_found" }
  | { kind: "already_final" }
  | { kind: "already_releasing" }
  | { kind: "forbidden" };

/**
 * Force-releases one host (also the eviction and dispute-resolution path):
 * skips the grace, records the platform's reason in the owner-only
 * `force_release_reason` evidence column, and moves the row to `released`
 * (nothing was attached) or `release_pending` (the sweep detaches it). The
 * canonical role is handed back first, as a removal does, so a live alias can
 * take over. Platform actors only; the reason is required (10-500 characters).
 */
export async function forceReleaseDomain(
  actor: DomainActor,
  domainId: string,
  input: { reason: string; cause?: "force_released" | "evicted" },
): Promise<ForceReleaseResult> {
  if (!isPlatform(actor)) return { kind: "forbidden" };
  const reason = input.reason.trim();
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) return { kind: "invalid_reason" };

  let ctx: NotificationContext | null = null;
  const result = await getPlatformDb().transaction(async (tx): Promise<ForceReleaseResult> => {
    const [row] = await tx
      .select()
      .from(organizationDomains)
      .where(eq(organizationDomains.id, domainId))
      .for("update")
      .limit(1);
    if (!row) return { kind: "not_found" };
    if (isTerminal(row.state)) return { kind: "already_final" };
    if (row.state === "release_pending") return { kind: "already_releasing" };

    const updated = await transitionDomain(tx as DomainTx, row, "force_release", actor, {
      cause: input.cause ?? "force_released",
      forceReleaseReason: reason,
      patch: row.webRole === "canonical" ? { webRole: "alias" } : undefined,
    });
    ctx = await collectNotificationContext(tx as DomainTx, row.organizationId);
    return { kind: "ok", domain: summarize(updated) };
  });

  if (result.kind === "ok") {
    await notifyAfterCommit(ctx, "force_released", [result.domain.hostname], actor);
  }
  return result;
}
