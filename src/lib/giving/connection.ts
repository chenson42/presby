import "server-only";
import { sql } from "drizzle-orm";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { withOrgContext } from "@/lib/authz";
import { rowsOf } from "./db-util";
import { givingKeysInTx } from "./keys";
import type { ConnectionRates } from "./connection-input";
import { CONNECTION_RATE_FIELDS } from "./connection-input";
import { givingOrigin } from "./origin";
import {
  createConnectedAccount,
  createOnboardingLink,
  isStripeConfigured,
  platformMode,
  retrieveConnectedAccount,
} from "./providers/stripe/client";
import { ProviderError } from "./providers/stripe/errors";
import type { ConnectionStatusInput } from "./types";

/**
 * Connecting a congregation's Stripe account - docs/work-log/2026-10-15-online-
 * giving.md, Phase 3 "Admin - connection". Everything here is `giving.manage`.
 *
 * Shape. Each exported function takes the identity `gateGivingAction()` (or a
 * page's gate) already established - person, organization, user - and re-checks
 * the key itself inside its own `withOrgContext()` transaction: the action's
 * gate is a courtesy, the data function is the authority. A Stripe call is
 * NEVER made while a database transaction is open: read -> (network) -> write,
 * each its own short transaction, so a slow Stripe cannot hold a pooled
 * connection. Money-adjacent state moves only through the database's own
 * functions or the column-limited UPDATE grant (go-live, attestation, rates);
 * status and capability flags move only through `presby_giving_refresh_my_connection()`.
 *
 * THE URL PROVES NOTHING. The onboarding `return_url` is a page a person can
 * open without having onboarded. It triggers a RETRIEVE of the account from
 * Stripe and the database function maps that; nothing on the URL, query string
 * or referrer decides a status.
 *
 * Redirect targets (`return_url`, `refresh_url`) are fixed paths on
 * `givingOrigin()` - never the request `Host`. Returned onboarding URLs are
 * origin-asserted inside `client.ts` (`accounts.stripe.com` / `connect.stripe.com`)
 * before they get here.
 *
 * AUDIT. The actions in `connect/actions.ts` write the audit rows from the
 * `created` / `changed` flags returned here. `refreshConnection` writes its own
 * (`GIVING_CONNECTION_STATUS_CHANGED`) because the connect-return PAGE calls it
 * directly - a page has no action to audit from - and the actor is the
 * signed-in user either way.
 */

export interface ConnectIdentity {
  personId: string;
  organizationId: string;
  userId: string;
  /**
   * The signed-in user's email - the Stripe account's contact. Needed only by
   * `startConnect`; a page-side caller (the connect-return page) that has no
   * email to hand may omit it.
   */
  email?: string | null;
}

export type ConnectionStatus = "onboarding" | "active" | "restricted" | "disconnected";

// ---------------------------------------------------------------------------
// read: what the connect panel renders
// ---------------------------------------------------------------------------

/** The six states the panel can be in. */
export type ConnectionPanelState = "unconfigured" | "none" | "onboarding" | "restricted" | "active" | "disconnected";

export type GoLiveBlocker = "connection_active" | "online_fund" | "payouts_attested";

export interface ConnectionView {
  id: string;
  status: ConnectionStatus;
  /** False for a Stripe test-mode account (a rehearsal: its gifts count toward nothing). */
  livemode: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  cardEnabled: boolean;
  achEnabled: boolean;
  /** Stripe still needs something from the account holder. */
  requirementsDue: boolean;
  /** A short machine code when Stripe has disabled the account, else null. */
  disabledReason: string | null;
  /** ISO-8601 UTC strings. */
  payoutsAttestedAt: string | null;
  publicEnabledAt: string | null;
  disconnectedAt: string | null;
  disconnectedReason: "treasurer" | "deauthorized" | null;
  lastStatusAt: string | null;
  createdAt: string;
  rates: ConnectionRates;
}

export interface ConnectionPanel {
  state: ConnectionPanelState;
  /** Both Stripe env vars set AND a canonical origin configured. False renders "isn't enabled on this installation". */
  stripeConfigured: boolean;
  /** The platform key's mode, read off its prefix; only meaningful when `stripeConfigured`. */
  platformMode: "live" | "test";
  /** The open connection, or the most recent (disconnected) one; null before the first connect. */
  connection: ConnectionView | null;
  onlineFundCount: number;
  /** Active monthly gifts - shown in the disconnect dialog (they keep charging in Stripe). */
  activeSchedules: number;
  /** What stands between this connection and a public give page. Empty `missing` means it can go live. */
  readiness: { missing: GoLiveBlocker[]; canGoPublic: boolean };
}

export type LoadConnectionPanelResult = { kind: "ok"; panel: ConnectionPanel } | { kind: "forbidden" };

const iso = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export function stripeUsable(): boolean {
  return isStripeConfigured() && givingOrigin() !== null;
}

export async function loadConnectionPanel(
  personId: string,
  organizationId: string,
): Promise<LoadConnectionPanelResult> {
  return withOrgContext(personId, organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, { personId, organizationId });
    if (!has.manage) return { kind: "forbidden" } as const;

    const row = rowsOf(
      await tx.execute(sql`
        select id, status, livemode, charges_enabled, payouts_enabled, details_submitted, card_enabled, ach_enabled,
               requirements_due, disabled_reason, payouts_attested_at, public_enabled_at, disconnected_at,
               disconnected_reason, last_status_at, created_at,
               card_fee_bps, card_fee_fixed_cents, ach_fee_bps, ach_fee_cap_cents
          from giving_provider_connections
         where organization_id = ${organizationId}::uuid
         order by (status <> 'disconnected') desc, created_at desc
         limit 1`),
    )[0];
    const funds = rowsOf(
      await tx.execute(sql`
        select count(*)::int as n from giving_funds
         where organization_id = ${organizationId}::uuid and is_active and offered_online`),
    )[0];
    const schedules = rowsOf(await tx.execute(sql`select presby_giving_active_schedule_count() as n`))[0];

    const connection: ConnectionView | null = row
      ? {
          id: String(row.id),
          status: String(row.status) as ConnectionStatus,
          livemode: row.livemode === true,
          chargesEnabled: row.charges_enabled === true,
          payoutsEnabled: row.payouts_enabled === true,
          detailsSubmitted: row.details_submitted === true,
          cardEnabled: row.card_enabled === true,
          achEnabled: row.ach_enabled === true,
          requirementsDue: row.requirements_due === true,
          disabledReason: row.disabled_reason === null ? null : String(row.disabled_reason),
          payoutsAttestedAt: iso(row.payouts_attested_at),
          publicEnabledAt: iso(row.public_enabled_at),
          disconnectedAt: iso(row.disconnected_at),
          disconnectedReason:
            row.disconnected_reason === "treasurer" || row.disconnected_reason === "deauthorized"
              ? row.disconnected_reason
              : null,
          lastStatusAt: iso(row.last_status_at),
          createdAt: iso(row.created_at) ?? "",
          rates: {
            cardFeeBps: Number(row.card_fee_bps),
            cardFeeFixedCents: Number(row.card_fee_fixed_cents),
            achFeeBps: Number(row.ach_fee_bps),
            achFeeCapCents: Number(row.ach_fee_cap_cents),
          },
        }
      : null;

    const usable = stripeUsable();
    const onlineFundCount = Number(funds?.n ?? 0);
    const missing = goLiveBlockers(connection, onlineFundCount);
    const state: ConnectionPanelState = !connection
      ? usable
        ? "none"
        : "unconfigured"
      : connection.status;

    return {
      kind: "ok",
      panel: {
        state,
        stripeConfigured: usable,
        platformMode: platformMode(),
        connection,
        onlineFundCount,
        activeSchedules: Number(schedules?.n ?? 0),
        readiness: { missing, canGoPublic: missing.length === 0 },
      },
    } as const;
  });
}

/** What stops a public give page: an `active` connection, one fund offered online, the payouts attestation (Q8). */
export function goLiveBlockers(
  connection: Pick<ConnectionView, "status" | "payoutsAttestedAt"> | null,
  onlineFundCount: number,
): GoLiveBlocker[] {
  const missing: GoLiveBlocker[] = [];
  if (!connection || connection.status !== "active") missing.push("connection_active");
  if (onlineFundCount < 1) missing.push("online_fund");
  if (!connection || connection.payoutsAttestedAt === null) missing.push("payouts_attested");
  return missing;
}

// ---------------------------------------------------------------------------
// start / continue: the onboarding redirect
// ---------------------------------------------------------------------------

export type StartConnectResult =
  | { kind: "redirect"; url: string }
  | { kind: "forbidden" }
  | { kind: "stripe_unconfigured" }
  | { kind: "already_connected" }
  | { kind: "provider_error" };

export type ContinueConnectResult =
  | { kind: "redirect"; url: string }
  | { kind: "forbidden" }
  | { kind: "stripe_unconfigured" }
  | { kind: "no_connection" }
  | { kind: "provider_error" };

function onboardingUrls(slug: string): { returnUrl: string; refreshUrl: string } | null {
  const origin = givingOrigin();
  if (!origin) return null;
  const base = `${origin}/o/${encodeURIComponent(slug)}/admin/giving/connect`;
  return { returnUrl: `${base}/return`, refreshUrl: `${base}/refresh` };
}

interface OpenConnection {
  id: string;
  accountId: string;
  status: ConnectionStatus;
}

async function readOpenConnection(
  identity: ConnectIdentity,
): Promise<{ forbidden: true } | { forbidden: false; open: OpenConnection | null; priorCount: number; orgName: string }> {
  return withOrgContext(identity.personId, identity.organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, identity);
    if (!has.manage) return { forbidden: true } as const;
    const open = rowsOf(
      await tx.execute(sql`
        select id, external_account_id, status from giving_provider_connections
         where organization_id = ${identity.organizationId}::uuid and status <> 'disconnected'`),
    )[0];
    const prior = rowsOf(
      await tx.execute(sql`
        select count(*)::int as n from giving_provider_connections
         where organization_id = ${identity.organizationId}::uuid`),
    )[0];
    const org = rowsOf(
      await tx.execute(sql`select name from organizations where id = ${identity.organizationId}::uuid`),
    )[0];
    return {
      forbidden: false,
      open: open
        ? { id: String(open.id), accountId: String(open.external_account_id), status: String(open.status) as ConnectionStatus }
        : null,
      priorCount: Number(prior?.n ?? 0),
      orgName: String(org?.name ?? "Congregation"),
    } as const;
  });
}

/**
 * Creates the Stripe account and its `giving_provider_connections` row (if the
 * congregation has no open connection) and mints the first onboarding link.
 *
 * `created` is true when a row was inserted, even if the link then failed - the
 * action audits `GIVING_CONNECTION_CREATED` on it, and a retry via "Continue"
 * picks the row up.
 *
 * Idempotency. The Stripe idempotency key is `giving-connect:<org>:<n>` where
 * `n` is how many connection rows the organization has ever had: two clicks (or
 * two tabs) at the same moment share `n` and so share ONE Stripe account; a
 * RE-connect after a disconnect gets a higher `n`, because Stripe would
 * otherwise hand back the disconnected account for the next 24 hours. The
 * database is the real guard: `giving_connections_one_open_idx` allows one open
 * connection per organization.
 */
export async function startConnect(
  identity: ConnectIdentity,
  slug: string,
): Promise<{ result: StartConnectResult; created: boolean; connectionId: string | null; livemode: boolean | null }> {
  const none = { created: false, connectionId: null, livemode: null } as const;
  if (!stripeUsable()) return { result: { kind: "stripe_unconfigured" }, ...none };
  const urls = onboardingUrls(slug);
  if (!urls) return { result: { kind: "stripe_unconfigured" }, ...none };

  const before = await readOpenConnection(identity);
  if (before.forbidden) return { result: { kind: "forbidden" }, ...none };
  if (before.open) return { result: { kind: "already_connected" }, ...none };
  if (!identity.email) return { result: { kind: "provider_error" }, ...none };

  let account: { accountId: string; livemode: boolean };
  try {
    account = await createConnectedAccount({
      displayName: before.orgName,
      contactEmail: identity.email,
      idempotencyKey: `giving-connect:${identity.organizationId}:${before.priorCount}`,
    });
  } catch (err) {
    if (err instanceof ProviderError) return { result: { kind: "provider_error" }, ...none };
    throw err;
  }

  // Insert; `on conflict do nothing` (any unique index) turns a lost race into
  // "no row returned" instead of an aborted transaction.
  const inserted = await withOrgContext(identity.personId, identity.organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, identity);
    if (!has.manage) return { forbidden: true } as const;
    const row = rowsOf(
      await tx.execute(sql`
        insert into giving_provider_connections (organization_id, provider, external_account_id, livemode, created_by)
        values (${identity.organizationId}::uuid, 'stripe', ${account.accountId}::text, ${account.livemode}::boolean,
                ${identity.userId}::uuid)
        on conflict do nothing
        returning id`),
    )[0];
    if (row) return { forbidden: false, id: String(row.id), created: true } as const;
    // A concurrent start won. If its account is the one Stripe gave us too (same
    // idempotency key), carry on with it; otherwise someone connected another.
    const open = rowsOf(
      await tx.execute(sql`
        select id, external_account_id from giving_provider_connections
         where organization_id = ${identity.organizationId}::uuid and status <> 'disconnected'`),
    )[0];
    if (open && String(open.external_account_id) === account.accountId) {
      return { forbidden: false, id: String(open.id), created: false } as const;
    }
    return { forbidden: false, id: null, created: false } as const;
  });
  if (inserted.forbidden) return { result: { kind: "forbidden" }, ...none };
  if (inserted.id === null) return { result: { kind: "already_connected" }, ...none };

  const meta = { created: inserted.created, connectionId: inserted.id, livemode: account.livemode };
  try {
    const link = await createOnboardingLink({ accountId: account.accountId, ...urls });
    return { result: { kind: "redirect", url: link.url }, ...meta };
  } catch (err) {
    if (err instanceof ProviderError) return { result: { kind: "provider_error" }, ...meta };
    throw err;
  }
}

/** A fresh onboarding link for the open connection (Continue / the Stripe `refresh_url`). */
export async function continueConnect(
  identity: ConnectIdentity,
  slug: string,
): Promise<ContinueConnectResult> {
  if (!stripeUsable()) return { kind: "stripe_unconfigured" };
  const urls = onboardingUrls(slug);
  if (!urls) return { kind: "stripe_unconfigured" };

  const read = await readOpenConnection(identity);
  if (read.forbidden) return { kind: "forbidden" };
  if (!read.open) return { kind: "no_connection" };

  try {
    const link = await createOnboardingLink({ accountId: read.open.accountId, ...urls });
    return { kind: "redirect", url: link.url };
  } catch (err) {
    if (err instanceof ProviderError) return { kind: "provider_error" };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// refresh: retrieve from Stripe, let the database map it
// ---------------------------------------------------------------------------

export type RefreshConnectionResult =
  | {
      kind: "ok";
      /** What `presby_giving_refresh_my_connection()` answered. */
      outcome: "applied" | "applied:status_changed" | "noop";
      status: ConnectionStatusInput;
    }
  | { kind: "forbidden" }
  | { kind: "stripe_unconfigured" }
  | { kind: "no_connection" }
  | { kind: "provider_error" };

export async function refreshConnection(identity: ConnectIdentity): Promise<RefreshConnectionResult> {
  if (!stripeUsable()) return { kind: "stripe_unconfigured" };
  const read = await readOpenConnection(identity);
  if (read.forbidden) return { kind: "forbidden" };
  if (!read.open) return { kind: "no_connection" };

  let status: ConnectionStatusInput;
  try {
    status = await retrieveConnectedAccount(read.open.accountId);
  } catch (err) {
    if (err instanceof ProviderError) return { kind: "provider_error" };
    throw err;
  }

  const outcome = await withOrgContext(identity.personId, identity.organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, identity);
    if (!has.manage) return "forbidden" as const;
    const row = rowsOf(
      await tx.execute(sql`
        select presby_giving_refresh_my_connection(
          ${status.chargesEnabled}::boolean, ${status.payoutsEnabled}::boolean, ${status.detailsSubmitted}::boolean,
          ${status.cardEnabled}::boolean, ${status.achEnabled}::boolean, ${status.requirementsDue}::boolean,
          ${status.disabledReason}::text) as outcome`),
    )[0];
    return String(row?.outcome ?? "none");
  });
  if (outcome === "forbidden") return { kind: "forbidden" };
  if (outcome === "none") return { kind: "no_connection" };
  if (outcome === "applied:status_changed") {
    await recordAudit({
      action: AUDIT_ACTIONS.GIVING_CONNECTION_STATUS_CHANGED,
      resourceType: "giving_provider_connection",
      resourceId: read.open.id,
      metadata: {
        organizationId: identity.organizationId,
        connectionId: read.open.id,
        via: "refresh",
        chargesEnabled: status.chargesEnabled,
        payoutsEnabled: status.payoutsEnabled,
        requirementsDue: status.requirementsDue,
      },
    });
  }
  return { kind: "ok", outcome: outcome === "applied:status_changed" ? outcome : outcome === "noop" ? "noop" : "applied", status };
}

// ---------------------------------------------------------------------------
// attestation, go-live, rates, disconnect (database-only)
// ---------------------------------------------------------------------------

export type AttestResult = { kind: "ok"; changed: boolean; connectionId: string } | { kind: "forbidden" } | { kind: "no_connection" };

/** Q8: the treasurer states the congregation's Stripe payouts are automatic. Recorded with who and when. */
export async function attestPayouts(identity: ConnectIdentity): Promise<AttestResult> {
  return withOrgContext(identity.personId, identity.organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, identity);
    if (!has.manage) return { kind: "forbidden" } as const;
    const updated = rowsOf(
      await tx.execute(sql`
        update giving_provider_connections
           set payouts_attested_at = now(), payouts_attested_by = ${identity.userId}::uuid, updated_at = now()
         where organization_id = ${identity.organizationId}::uuid and status <> 'disconnected'
           and payouts_attested_at is null
        returning id`),
    )[0];
    if (updated) return { kind: "ok", changed: true, connectionId: String(updated.id) } as const;
    const open = rowsOf(
      await tx.execute(sql`
        select id from giving_provider_connections
         where organization_id = ${identity.organizationId}::uuid and status <> 'disconnected'`),
    )[0];
    return open ? ({ kind: "ok", changed: false, connectionId: String(open.id) } as const) : ({ kind: "no_connection" } as const);
  });
}

export type SetPublicResult =
  | { kind: "ok"; changed: boolean; connectionId: string }
  | { kind: "not_ready"; missing: GoLiveBlocker[] }
  | { kind: "forbidden" }
  | { kind: "no_connection" };

/**
 * Go live / take offline. Enabling is refused unless the connection is `active`,
 * at least one fund is offered online and the payouts attestation exists (the
 * attestation is also a database CHECK). Taking offline is always allowed.
 * `public_enabled_at` is the single source: the funds page's "retire the last
 * online fund" confirm and the public give page both read it.
 */
export async function setPublicPage(identity: ConnectIdentity, enabled: boolean): Promise<SetPublicResult> {
  return withOrgContext(identity.personId, identity.organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, identity);
    if (!has.manage) return { kind: "forbidden" } as const;
    const conn = rowsOf(
      await tx.execute(sql`
        select id, status, payouts_attested_at, public_enabled_at from giving_provider_connections
         where organization_id = ${identity.organizationId}::uuid and status <> 'disconnected'
         for update`),
    )[0];
    if (!conn) return { kind: "no_connection" } as const;
    const connectionId = String(conn.id);
    const isPublic = conn.public_enabled_at !== null;

    if (!enabled) {
      if (!isPublic) return { kind: "ok", changed: false, connectionId } as const;
      await tx.execute(sql`
        update giving_provider_connections
           set public_enabled_at = null, public_enabled_by = null, updated_at = now()
         where id = ${connectionId}::uuid`);
      return { kind: "ok", changed: true, connectionId } as const;
    }

    const funds = rowsOf(
      await tx.execute(sql`
        select count(*)::int as n from giving_funds
         where organization_id = ${identity.organizationId}::uuid and is_active and offered_online`),
    )[0];
    const missing = goLiveBlockers(
      { status: String(conn.status) as ConnectionStatus, payoutsAttestedAt: iso(conn.payouts_attested_at) },
      Number(funds?.n ?? 0),
    );
    if (missing.length > 0) return { kind: "not_ready", missing } as const;
    if (isPublic) return { kind: "ok", changed: false, connectionId } as const;

    await tx.execute(sql`
      update giving_provider_connections
         set public_enabled_at = now(), public_enabled_by = ${identity.userId}::uuid, updated_at = now()
       where id = ${connectionId}::uuid`);
    return { kind: "ok", changed: true, connectionId } as const;
  });
}

export type UpdateRatesResult =
  | { kind: "ok"; changedFields: string[]; connectionId: string }
  | { kind: "forbidden" }
  | { kind: "no_connection" };

export async function updateRates(identity: ConnectIdentity, rates: ConnectionRates): Promise<UpdateRatesResult> {
  return withOrgContext(identity.personId, identity.organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, identity);
    if (!has.manage) return { kind: "forbidden" } as const;
    const conn = rowsOf(
      await tx.execute(sql`
        select id, card_fee_bps, card_fee_fixed_cents, ach_fee_bps, ach_fee_cap_cents
          from giving_provider_connections
         where organization_id = ${identity.organizationId}::uuid and status <> 'disconnected'
         for update`),
    )[0];
    if (!conn) return { kind: "no_connection" } as const;
    const current: ConnectionRates = {
      cardFeeBps: Number(conn.card_fee_bps),
      cardFeeFixedCents: Number(conn.card_fee_fixed_cents),
      achFeeBps: Number(conn.ach_fee_bps),
      achFeeCapCents: Number(conn.ach_fee_cap_cents),
    };
    const changedFields = CONNECTION_RATE_FIELDS.filter((f) => current[f] !== rates[f]);
    const connectionId = String(conn.id);
    if (changedFields.length === 0) return { kind: "ok", changedFields: [], connectionId } as const;
    await tx.execute(sql`
      update giving_provider_connections
         set card_fee_bps = ${rates.cardFeeBps}::integer, card_fee_fixed_cents = ${rates.cardFeeFixedCents}::integer,
             ach_fee_bps = ${rates.achFeeBps}::integer, ach_fee_cap_cents = ${rates.achFeeCapCents}::integer,
             updated_at = now()
       where id = ${connectionId}::uuid`);
    return { kind: "ok", changedFields: [...changedFields], connectionId } as const;
  });
}

export type DisconnectResult =
  | { kind: "ok"; connectionId: string; activeSchedules: number }
  | { kind: "forbidden" }
  | { kind: "no_connection" };

/**
 * Local disconnect. The Stripe account is neither closed nor deauthorized (a
 * platform cannot deauthorize a v2 account it created without closing it, and
 * closing would harm the congregation); ingest continues so recurring gifts
 * stay recorded. `activeSchedules` is the number of monthly gifts that keep
 * charging in Stripe until cancelled there - the caller's confirm dialog and
 * toast say so.
 */
export async function disconnectConnection(identity: ConnectIdentity): Promise<DisconnectResult> {
  return withOrgContext(identity.personId, identity.organizationId, async (tx) => {
    const has = await givingKeysInTx(tx, identity);
    if (!has.manage) return { kind: "forbidden" } as const;
    const conn = rowsOf(
      await tx.execute(sql`
        select id from giving_provider_connections
         where organization_id = ${identity.organizationId}::uuid and status <> 'disconnected'`),
    )[0];
    if (!conn) return { kind: "no_connection" } as const;
    const schedules = rowsOf(await tx.execute(sql`select presby_giving_active_schedule_count() as n`))[0];
    const done = rowsOf(await tx.execute(sql`select presby_giving_disconnect_my_connection() as outcome`))[0];
    if (String(done?.outcome) !== "applied:disconnected") return { kind: "no_connection" } as const;
    return { kind: "ok", connectionId: String(conn.id), activeSchedules: Number(schedules?.n ?? 0) } as const;
  });
}
