import "server-only";
import { randomBytes } from "node:crypto";
import {
  and,
  asc,
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
import { organizations } from "@/lib/db/schema";
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
import { AUDIT_ACTIONS, insertAuditRow } from "./audit-tx";
import {
  buildChecklist,
  readObservation,
  type ChecklistGroup,
  type ChecklistRow,
} from "./checklist";
import { checkProof, type ProofCheck } from "./dns-checks";
import { normalizeClaimInput, type ClaimRefusal } from "./hostname-rules";
import {
  collectNotificationContext,
  sendDomainNotification,
  type DomainNotification,
  type DomainNotificationEvent,
  type NotificationContext,
} from "./notify";
import { cadenceMs, DOMAIN_POLICY } from "./policy";
import { proofRecordName, proofRecordValue } from "./proof";
import {
  TERMINAL_STATES,
  auditKeyNameFor,
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
 *   - Network I/O (DNS) happens with NO transaction held. A check is three
 *     steps: read the rows; look the proof up; re-read FOR UPDATE, confirm the
 *     state has not moved, and apply. If it moved, the check is dropped.
 *
 * TENANT WRITES ARE COLUMN-LIMITED BY THE DATABASE (T4/A1). `presby_app` can
 * write state and observation columns only; it cannot touch the hold columns,
 * `force_release_reason`, the identity columns or the six trigger-owned
 * timestamps. So a tenant actor can never `force_release` (refused here before
 * the round trip, and by the grant), and nothing here ever `.set()`s a
 * trigger-owned column.
 *
 * NO PROVIDER CALL BEFORE PROOF (G1). In this batch there is no provider call
 * at all: DNS is read-only. The Vercel adapter, `attach_*`, `live_*` and the
 * debounced lapse arrive in Batch 1b on the seams marked below.
 *
 * AUDIT. Library and cron paths are invisible to `check:audit` (it scans only
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
// checkClaim ("Check now" and the cron's per-claim work)
// ---------------------------------------------------------------------------

export type CheckOutcome =
  | "verified"
  | "recovered"
  | "expired"
  | "held_elsewhere"
  | "unchanged"
  | "deferred";

export type CheckResult =
  | { kind: "ok"; outcome: CheckOutcome; proof: ProofCheck["status"] | null; checkedAt: string }
  | { kind: "rate_limited"; retryAfterSeconds: number }
  | { kind: "forbidden" }
  | { kind: "feature_off" }
  | { kind: "not_found" };

type GroupRow = Awaited<ReturnType<typeof groupRows>>[number];

/**
 * Batch 1a-ii checks two states: `pending` (the proof appears -> `verified`;
 * a past-expiry claim with no proof -> `expired`) and `lapsed` (the proof
 * reappears -> `verified`, recorded as a recovery). Every other state is
 * `deferred`: Batch 1b extends this routine (attach, the routing checks, the
 * HTTPS probe, the debounced lapse, grace) on the `PROOF_STATES` seam below
 * without changing its shape.
 *
 * `forced` is a person pressing "Check now": it is rate-limited (6 per 10
 * minutes per claim, 30 per hour per organization, G14) because it triggers
 * outbound lookups. The cron passes `forced: false`.
 */
export async function checkClaim(
  actor: DomainActor,
  organizationId: string,
  claimName: string,
  opts: { forced: boolean; deps?: DomainServiceDeps },
): Promise<CheckResult> {
  const dns = opts.deps?.dns ?? getAdapters().dns;
  const exec = domainExec(actor, organizationId);

  // Step 1: read (and gate), no lock held past this transaction.
  const snapshot = await guarded(() =>
    exec(async (tx) => {
      const refused = await gate(tx, actor, organizationId);
      if (refused) return { kind: refused } as const;
      const rows = await groupRows(tx, organizationId, claimName, false);
      return rows.length === 0 ? ({ kind: "not_found" } as const) : ({ kind: "ok", rows } as const);
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

  // Step 2: network, no transaction. One lookup per distinct token in the group.
  const proofStates = snapshot.rows.filter((r) => PROOF_STATES.has(r.state));
  const proofByToken = new Map<string, ProofCheck["status"]>();
  for (const token of new Set(proofStates.map((r) => r.proofToken))) {
    proofByToken.set(token, (await checkProof(dns, claimName, token)).status);
  }

  // Step 3: re-read FOR UPDATE, confirm nothing moved, apply.
  const trigger = opts.forced ? "check_now" : undefined;
  const outcomes: CheckOutcome[] = [];
  const result = await guarded(() =>
    exec(async (tx) => {
      const locked = await groupRows(tx, organizationId, claimName, true);
      for (const row of locked) {
        const seen = snapshot.rows.find((r) => r.id === row.id);
        if (!seen || seen.state !== row.state) continue; // moved under us: drop it
        const status = proofByToken.get(row.proofToken) ?? null;
        if (status === null) {
          outcomes.push("deferred");
          continue;
        }
        outcomes.push(await applyProof(tx, row, status, actor, trigger));
      }
      // Notifications for a check (lapse, park, release) arrive with the 1b
      // sweeper; a verification is the church's own good news, visible on the
      // page and in the audit trail.
      return { kind: "ok" } as const;
    }),
  );
  if (result.kind !== "ok") return result;

  const order: CheckOutcome[] = ["verified", "recovered", "expired", "held_elsewhere", "unchanged", "deferred"];
  const outcome = order.find((o) => outcomes.includes(o)) ?? "deferred";
  const statuses = [...proofByToken.values()];
  return {
    kind: "ok",
    outcome,
    proof: statuses[0] ?? null,
    checkedAt: new Date().toISOString(),
  };
}

/** The states whose check is a proof lookup in this batch (1b adds the rest). */
const PROOF_STATES: ReadonlySet<DomainState> = new Set(["pending", "lapsed"]);

async function applyProof(
  tx: DomainTx,
  row: GroupRow,
  proof: ProofCheck["status"],
  actor: DomainActor,
  trigger: string | undefined,
): Promise<CheckOutcome> {
  const checkClass: OrganizationDomainCheckClass =
    proof === "present" ? "ok" : proof === "unknown" ? "dns_unknown" : "proof_absent";
  const observation = {
    ...readObservation(row.observation),
    checkedAt: new Date().toISOString(),
    proof: { status: proof },
  };

  if (row.state === "pending") {
    if (proof === "present") {
      try {
        // A SAVEPOINT: a unique violation here (another organization verified
        // this name first) must not abort the whole check.
        await tx.transaction((sp) =>
          transitionDomain(sp, row, "proof_ok", actor, {
            trigger,
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
        await writeObservation(tx, row, observation, "held_elsewhere", cadenceMs("pending")!);
        return "held_elsewhere";
      }
    }
    // Absent or wrong value, on a claim past its expiry: it expires. An
    // `unknown` lookup never expires a claim (the proof may be there).
    if (row.dbExpired && (proof === "absent" || proof === "wrong_value")) {
      await transitionDomain(tx, row, "expire", actor, {
        trigger,
        patch: { lastCheckedAt: dbNow(), lastCheckClass: checkClass, observation },
      });
      return "expired";
    }
    await writeObservation(tx, row, observation, checkClass, cadenceMs("pending")!);
    return "unchanged";
  }

  // lapsed
  if (proof === "present") {
    await transitionDomain(tx, row, "proof_ok", actor, {
      trigger,
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
  await writeObservation(tx, row, observation, checkClass, cadenceMs("lapsed")!);
  return "unchanged";
}

/** An observation-only write: no state change, so no audit row (high-volume, not security-sensitive). */
async function writeObservation(
  tx: DomainTx,
  row: Pick<OrganizationDomain, "id">,
  observation: Record<string, unknown>,
  checkClass: OrganizationDomainCheckClass,
  nextInMs: number,
): Promise<void> {
  await tx
    .update(organizationDomains)
    .set({
      observation,
      lastCheckedAt: dbNow(),
      lastCheckClass: checkClass,
      nextCheckAt: dbNowPlus(nextInMs),
    })
    .where(eq(organizationDomains.id, row.id));
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
  | { kind: "ok"; groups: ChecklistGroup[]; siteStatus: string | null }
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
      }));
      return {
        kind: "ok",
        groups: buildChecklist(checklistRows, { siteStatus, platformSiteUrl: context.platformSiteUrl }),
        siteStatus,
      };
    }),
  );
}
