"use server";

import { revalidatePath } from "next/cache";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import {
  gateGivingAction,
  invalidInput,
  type GivingActionFailure,
  type GivingActionIdentity,
  type GivingActionResult,
} from "@/lib/giving/action-gate";
import {
  attestPayouts,
  continueConnect,
  disconnectConnection,
  refreshConnection,
  setPublicPage,
  startConnect,
  updateRates,
  type ConnectIdentity,
} from "@/lib/giving/connection";
import { connectionRatesSchema } from "@/lib/giving/connection-input";
import type { ConnectionStatusInput } from "@/lib/giving/types";

/**
 * Server Actions for the Stripe connection - docs/work-log/2026-10-15-online-
 * giving.md, Batch 3a and Phase 3 "Admin - connection". Every action: the shared
 * gate (sign-in -> Node-side 2FA -> four-way org resolve -> applicability and
 * toggle -> `giving.manage`), validation, exactly one `connection.ts` call, the
 * audit write AFTER the commit and only on success, then `revalidatePath`.
 *
 * Results are `GivingActionResult<T>` (see `action-gate.ts`): on failure
 * `error` is the sentence to show and `kind` says when the UI must react
 * differently (`stripe_unconfigured`, `already_connected`, `provider_error`,
 * `no_connection`, `not_ready` + `missing`, `two_factor_required` +
 * `redirectTo`). A redirect result's URL has been origin-asserted by
 * `client.ts`; the client asserts it again before navigating.
 *
 * Audit metadata is ids, flags and field NAMES: never an account holder's name
 * or email, never a Stripe account id.
 */

export type ConnectRedirect = { kind: "redirect"; url: string };

const UNCONFIGURED: GivingActionFailure = {
  ok: false,
  kind: "stripe_unconfigured",
  error: "Online giving isn't enabled on this installation.",
};
const PROVIDER_ERROR: GivingActionFailure = {
  ok: false,
  kind: "provider_error",
  error: "We couldn't reach Stripe. Nothing was changed.",
};
const NO_CONNECTION: GivingActionFailure = {
  ok: false,
  kind: "no_connection",
  error: "There's no Stripe connection to do that with.",
};
const FORBIDDEN: GivingActionFailure = {
  ok: false,
  error: "You don't have permission to manage the Stripe connection here.",
};

const MISSING_TEXT: Record<string, string> = {
  connection_active: "the Stripe account has to finish setup and be active",
  online_fund: "at least one fund has to be offered online",
  payouts_attested: "you need to confirm that payouts to your bank are automatic",
};

function revalidate(slug: string) {
  revalidatePath(`/o/${slug}/admin/giving`);
  revalidatePath(`/o/${slug}/admin/giving/connect`);
}

function identityOf(gate: GivingActionIdentity): ConnectIdentity {
  return { personId: gate.personId, organizationId: gate.organizationId, userId: gate.userId, email: gate.email };
}

/** Creates the Stripe account (if there is no open connection) and returns the onboarding URL. */
export async function startConnectAction(slug: string): Promise<GivingActionResult<ConnectRedirect>> {
  const gate = await gateGivingAction(slug, ["manage"]);
  if (!gate.ok) return gate;

  const { result, created, connectionId, livemode } = await startConnect(identityOf(gate), slug);

  if (created && connectionId) {
    await recordAudit({
      action: AUDIT_ACTIONS.GIVING_CONNECTION_CREATED,
      resourceType: "giving_provider_connection",
      resourceId: connectionId,
      metadata: { organizationId: gate.organizationId, connectionId, livemode },
    });
    revalidate(slug);
  }

  switch (result.kind) {
    case "redirect":
      return { ok: true, data: { kind: "redirect", url: result.url } };
    case "stripe_unconfigured":
      return UNCONFIGURED;
    case "already_connected":
      return {
        ok: false,
        kind: "already_connected",
        error: "Your congregation already has a Stripe account connected. Use Continue to finish setting it up.",
      };
    case "forbidden":
      return FORBIDDEN;
    case "provider_error":
      return created
        ? {
            ok: false,
            kind: "provider_error",
            error: "Your Stripe account was created, but we couldn't open the setup page. Choose Continue to try again.",
          }
        : PROVIDER_ERROR;
  }
}

/** A fresh onboarding link for the open connection. */
export async function continueConnectAction(slug: string): Promise<GivingActionResult<ConnectRedirect>> {
  const gate = await gateGivingAction(slug, ["manage"]);
  if (!gate.ok) return gate;
  const result = await continueConnect(identityOf(gate), slug);
  switch (result.kind) {
    case "redirect":
      return { ok: true, data: { kind: "redirect", url: result.url } };
    case "stripe_unconfigured":
      return UNCONFIGURED;
    case "no_connection":
      return NO_CONNECTION;
    case "forbidden":
      return FORBIDDEN;
    case "provider_error":
      return PROVIDER_ERROR;
  }
}

/**
 * "Refresh status": retrieves the account from Stripe and lets the database map
 * it. A status change is audited inside `refreshConnection()` (the connect-return
 * PAGE calls it directly), so this action adds no second row.
 */
export async function refreshConnectionAction(
  slug: string,
): Promise<GivingActionResult<{ outcome: "applied" | "applied:status_changed" | "noop"; status: ConnectionStatusInput }>> {
  const gate = await gateGivingAction(slug, ["manage"]);
  if (!gate.ok) return gate;
  const result = await refreshConnection(identityOf(gate));
  switch (result.kind) {
    case "ok":
      revalidate(slug);
      return { ok: true, data: { outcome: result.outcome, status: result.status } };
    case "stripe_unconfigured":
      return UNCONFIGURED;
    case "no_connection":
      return NO_CONNECTION;
    case "forbidden":
      return FORBIDDEN;
    case "provider_error":
      return PROVIDER_ERROR;
  }
}

/**
 * Q8: records that the treasurer confirms the congregation's Stripe payouts are
 * automatic (manual payouts cannot be reconciled). The row keeps who and when
 * (`payouts_attested_by` / `_at`); `AUDIT_ACTIONS` has no key of its own for
 * it and this batch adds none, so the attestation shows in the audit trail via
 * the go-live toggle's metadata, which refuses to enable without it.
 */
export async function attestPayoutsAction(slug: string): Promise<GivingActionResult<{ changed: boolean }>> {
  const gate = await gateGivingAction(slug, ["manage"]);
  if (!gate.ok) return gate;
  const result = await attestPayouts(identityOf(gate));
  switch (result.kind) {
    case "ok":
      revalidate(slug);
      return { ok: true, data: { changed: result.changed } };
    case "no_connection":
      return NO_CONNECTION;
    case "forbidden":
      return FORBIDDEN;
  }
}

/** Go live (`enabled: true`, refused with `not_ready` + `missing` until ready) or take the give page offline. */
export async function setPublicPageAction(
  slug: string,
  enabled: boolean,
): Promise<GivingActionResult<{ enabled: boolean; changed: boolean }>> {
  const gate = await gateGivingAction(slug, ["manage"]);
  if (!gate.ok) return gate;
  const result = await setPublicPage(identityOf(gate), enabled === true);
  switch (result.kind) {
    case "ok":
      if (result.changed) {
        await recordAudit({
          action: AUDIT_ACTIONS.GIVING_PUBLIC_PAGE_TOGGLED,
          resourceType: "giving_provider_connection",
          resourceId: result.connectionId,
          metadata: { organizationId: gate.organizationId, connectionId: result.connectionId, enabled: enabled === true },
        });
      }
      revalidate(slug);
      return { ok: true, data: { enabled: enabled === true, changed: result.changed } };
    case "not_ready":
      return {
        ok: false,
        kind: "not_ready",
        missing: result.missing,
        error: `The give page can't go live yet: ${result.missing.map((m) => MISSING_TEXT[m] ?? m).join("; ")}.`,
      };
    case "no_connection":
      return NO_CONNECTION;
    case "forbidden":
      return FORBIDDEN;
  }
}

/** Local disconnect. The Stripe account is not closed; the data says how many monthly gifts keep charging there. */
export async function disconnectAction(slug: string): Promise<GivingActionResult<{ activeSchedules: number }>> {
  const gate = await gateGivingAction(slug, ["manage"]);
  if (!gate.ok) return gate;
  const result = await disconnectConnection(identityOf(gate));
  switch (result.kind) {
    case "ok":
      await recordAudit({
        action: AUDIT_ACTIONS.GIVING_CONNECTION_DISCONNECTED,
        resourceType: "giving_provider_connection",
        resourceId: result.connectionId,
        metadata: {
          organizationId: gate.organizationId,
          connectionId: result.connectionId,
          reason: "treasurer",
          activeSchedules: result.activeSchedules,
        },
      });
      revalidate(slug);
      return { ok: true, data: { activeSchedules: result.activeSchedules } };
    case "no_connection":
      return NO_CONNECTION;
    case "forbidden":
      return FORBIDDEN;
  }
}

/** Card / ACH fee rates for the donor-covers-fees preview (G21). Bounded by the schema's CHECKs. */
export async function updateRatesAction(slug: string, input: unknown): Promise<GivingActionResult> {
  const gate = await gateGivingAction(slug, ["manage"]);
  if (!gate.ok) return gate;
  const parsed = connectionRatesSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);

  const result = await updateRates(identityOf(gate), parsed.data);
  switch (result.kind) {
    case "ok":
      if (result.changedFields.length > 0) {
        await recordAudit({
          action: AUDIT_ACTIONS.GIVING_CONNECTION_RATES_CHANGED,
          resourceType: "giving_provider_connection",
          resourceId: result.connectionId,
          metadata: {
            organizationId: gate.organizationId,
            connectionId: result.connectionId,
            fields: result.changedFields,
          },
        });
      }
      revalidate(slug);
      return { ok: true };
    case "no_connection":
      return NO_CONNECTION;
    case "forbidden":
      return FORBIDDEN;
  }
}
