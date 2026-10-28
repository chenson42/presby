import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { OrgAccessError, withOrgContext, type OrgTx } from "@/lib/authz";
import { AUDIT_ACTIONS, insertAuditRow } from "@/lib/audit-tx";
import { attemptQueuedSend, cancelQueuedEmail, insertQueueRowInTx } from "@/lib/email/queue";
import { getPersonEmail, personIdsWithCredentialEmail } from "@/lib/contact-methods/reader";
import { orgFeatureEnabledInTx } from "@/lib/org-features";
import { isTotpConfigured } from "@/lib/two-factor";
import { platformOrigin } from "@/lib/domains/host";
import { ACCOUNT_SIGN_IN_TEMPLATE_KEY, renderInvitationEmail } from "./invitation-email";
import { mintInvitationToken } from "./invitation-token";
import { UUID_RE, normalizeInvitationEmail } from "./input";
import { deliveryState, type DeliveryState } from "./status";
import {
  MEMBERSHIP_STANDINGS,
  SIGN_IN_ACK_REASONS,
  SIGN_IN_BLOCK_OUTCOMES,
  SIGN_IN_CONNECTED_VIA,
  SIGN_IN_INVITATION_LIMITS,
  SIGN_IN_REFUSALS,
  SIGN_IN_STATES,
  connectOutlook,
  deriveSessionRowState,
  deriveSignInMarker,
  sessionRowAction,
  type MembershipStanding,
  type SessionSignInRow,
  type SignInAckReason,
  type SignInBlockOutcome,
  type SignInCardState,
  type SignInConnectedVia,
  type SignInMarker,
  type SignInRefusal,
  type SignInState,
} from "./sign-in-types";
import { SIGN_IN_REFUSALS_NAMING_THE_PERSON } from "./sign-in-copy";

/**
 * A congregation invites one of its own people to sign in (Community Increment
 * 2b, Batch B2; Phase 3 "Library" as amended by amendment 2 sections 5.8 and
 * 7.2). THE ONLY FILE that names the issue, resend, revoke, reader and
 * card-standing definers (`boundaries.test.ts` holds that line).
 *
 * CONNECTION: `db` (presby_app) through `withOrgContext()` ONLY. Never
 * `getPlatformDb()`; never `./issue` (the platform side); `presby_app` holds no
 * table privilege on `account_invitations`, so the definers are the only way
 * in. The definers derive the organization from `presby_current_org()` and
 * the actor from the `users.id` this module is handed, and they re-check
 * `people.manage` themselves; the TypeScript pre-check below is the friendly
 * `forbidden`, not the gate. THE ADDRESS IS NEVER TRUSTED FROM TYPESCRIPT: the
 * definer resolves the person's credential address in SQL, compares it with the
 * sender's confirmation (`address_changed`), and returns the address the queue
 * row's `to` must carry.
 *
 * ATOMICITY. A send, a resend and a cancel are each ONE `withOrgContext`
 * transaction: the definer's invitation row, the `email_queue` row (the id was
 * minted here and handed to the definer, so the two link in the same
 * transaction), the cancellation of a superseded still-queued email, and the
 * audit row commit together. A non-`ok` definer result aborts the transaction
 * with an internal throw (an early `return` from `db.transaction()` would
 * COMMIT; the `ParticipantAbort` lesson), and a throw from the audit insert
 * rolls the whole act back: no invitation, no queue row, no superseded row. The
 * provider call happens AFTER the commit (`attemptQueuedSend`); if it fails the
 * row stays `queued` for the worker and the caller is told `delivery:
 * "queued"`, never an error.
 *
 * WHAT THIS FILE NEVER DOES (source-scanned): read `users` (the sender's own row
 * is read in SQL by the definer, DECISION-189), name the invitation table or
 * the contact table (the address comes through `contact-methods/reader.ts`),
 * touch `email_queue` except through `insertQueueRowInTx`, `cancelQueuedEmail`
 * and `attemptQueuedSend`, or log an address, a name, a token or an id.
 *
 * AUDIT (Workflow Rule 7), existing keys, ids and enums only: `invitation.
 * created`, `.resent`, `.revoked`. Never the token, its hash, the address or a
 * name. `acknowledged` is the list the DEFINER returned with `ok`, never the
 * client's own flag (F177 condition 2).
 */

export interface SignInContext {
  organizationId: string;
  actingPersonId: string;
  /** A `users.id` bound server-side from the session. Never client input. */
  actingUserId: string;
  actingUserEmail?: string | null;
}

export interface SignInSendInput {
  personId: string;
  confirmedAddress: string;
  acknowledged: boolean;
}

export type SignInSendResult =
  | {
      kind: "ok";
      invitationId: string;
      expiresAt: Date;
      delivery: "sent" | "queued";
      address: string;
      acknowledged: SignInAckReason[];
    }
  | { kind: "forbidden" }
  | {
      kind: "refused";
      reason: SignInRefusal;
      /** `needs_acknowledgement`: what the sender must acknowledge. */
      ackReasons?: SignInAckReason[];
      /** `cooldown`: when Send again becomes available. */
      nextResendAt?: Date;
      /** `already_pending`: the open row has expired, so the card offers Send again. */
      existingExpired?: boolean;
      /** The person's name from their own record, only for the refusals whose sentence names them. */
      personName?: string | null;
    }
  | { kind: "invalid_input"; field: "confirmedAddress" }
  | { kind: "totp_unavailable" }
  | { kind: "link_origin_unavailable" }
  | { kind: "db_error" };

export type SignInRevokeResult =
  | { kind: "ok" }
  | { kind: "forbidden" }
  | { kind: "refused"; reason: "not_open" | "not_found" }
  | { kind: "db_error" };

export type SignInCardResult =
  | { kind: "ok"; card: SignInCardState }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "error" };

export type SessionSignInRowsResult =
  | { kind: "ok"; rows: SessionSignInRow[] }
  | { kind: "forbidden" }
  | { kind: "error" };

const PEOPLE_MANAGE = "people.manage";
const OFFICERS_MANAGE = "officers.manage";
export const SIGN_IN_CONNECT_TOGGLE = "org_portal.sign_in_connect";
/** The reader raises outside 1..500 ids. */
const READER_MAX_IDS = 500;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return ((result as { rows?: Row[] }).rows ?? []) as Row[];
}

/** SQLSTATE found on the error or its `cause` chain (Drizzle wraps the driver's error). */
function sqlstateOf(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let depth = 0; cur && depth < 6; depth += 1) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Error CLASS only, for logs: never the message (it can carry values). */
function errorClass(err: unknown): string {
  const code = sqlstateOf(err);
  const name = err instanceof Error ? err.name : typeof err;
  return code ? `${name}/${code}` : name;
}

/**
 * The uniform identity-refusal the definers raise (`presby_deny_sign_in_
 * invitation`, 42501), or `withOrgContext`'s own refusal (no active membership
 * here): both are "you may not", not a failure.
 */
function isIdentityRefusal(err: unknown): boolean {
  return sqlstateOf(err) === "42501" || err instanceof OrgAccessError;
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function textArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string") {
    const trimmed = value.replace(/^\{|\}$/g, "");
    return trimmed === "" ? [] : trimmed.split(",").map((v) => v.replace(/^"|"$/g, ""));
  }
  return [];
}

function ackReasons(value: unknown): SignInAckReason[] {
  const allowed: readonly string[] = SIGN_IN_ACK_REASONS;
  return textArray(value).filter((r): r is SignInAckReason => allowed.includes(r));
}

/** Thrown INSIDE a transaction so a non-ok result rolls it back; translated by the caller. */
class SignInAbort<R> extends Error {
  constructor(readonly result: R) {
    super("sign-in invitation aborted");
    this.name = "SignInAbort";
  }
}

async function holds(tx: OrgTx, personId: string, organizationId: string, key: string): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(${personId}::uuid, ${organizationId}::uuid, ${key}) as allowed
  `);
  return rowsOf(result)[0]?.allowed === true;
}

function validContext(ctx: SignInContext): boolean {
  return (
    UUID_RE.test(ctx.organizationId) && UUID_RE.test(ctx.actingPersonId) && UUID_RE.test(ctx.actingUserId)
  );
}

function uuidArray(ids: readonly string[]) {
  return sql`array[${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)}]::uuid[]`;
}

/** The person's name as their own record shows it (`preferred or first, last`), or null. RLS-scoped. */
async function personName(tx: OrgTx, personId: string): Promise<string | null> {
  const result = await tx.execute(sql`
    select coalesce(nullif(btrim(p.preferred_name), ''), p.first_name) || ' ' || p.last_name as name
      from people p where p.id = ${personId}::uuid
  `);
  const name = rowsOf(result)[0]?.name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

async function sendAfterCommit(queueId: string): Promise<"sent" | "queued"> {
  try {
    const { sentInline } = await attemptQueuedSend(queueId);
    return sentInline ? "sent" : "queued";
  } catch (err) {
    console.error("[sign-in-invite] post-commit send attempt failed:", errorClass(err));
    return "queued";
  }
}

// ---------------------------------------------------------------------------
// The reader (one call per page)
// ---------------------------------------------------------------------------

interface StateRow {
  personId: string;
  linked: boolean;
  state: SignInState;
  sentAt: Date | null;
  expiresAt: Date | null;
  resendCount: number;
  nextResendAt: Date | null;
  invitedAddress: string | null;
  addressCurrent: boolean | null;
  outcome: SignInBlockOutcome | null;
  delivery: DeliveryState;
  connectedVia: SignInConnectedVia | null;
  connectedOn: string | null;
}

/** `presby_sign_in_invitation_states`: 1..500 ids; an id with no membership here is omitted. */
async function readStates(tx: OrgTx, ctx: SignInContext, personIds: readonly string[]): Promise<Map<string, StateRow>> {
  const result = await tx.execute(sql`
    select person_id::text as person_id, linked, state, sent_at, expires_at, resend_count,
           next_resend_at, invited_address, address_current, outcome,
           queue_status, queue_delivered_at, queue_bounced_at, queue_complained_at,
           connected_via, connected_on::text as connected_on
      from presby_sign_in_invitation_states(${uuidArray(personIds)}, ${ctx.actingUserId}::uuid)
  `);
  const states: readonly string[] = SIGN_IN_STATES;
  const outcomes: readonly string[] = SIGN_IN_BLOCK_OUTCOMES;
  const vias: readonly string[] = SIGN_IN_CONNECTED_VIA;
  const out = new Map<string, StateRow>();
  for (const row of rowsOf(result)) {
    const state = String(row.state);
    if (!states.includes(state)) throw new Error("presby_sign_in_invitation_states returned an unknown state");
    const queueStatus = row.queue_status === null || row.queue_status === undefined ? null : String(row.queue_status);
    out.set(String(row.person_id), {
      personId: String(row.person_id),
      linked: row.linked === true,
      state: state as SignInState,
      sentAt: toDate(row.sent_at),
      expiresAt: toDate(row.expires_at),
      resendCount: Number(row.resend_count ?? 0),
      nextResendAt: toDate(row.next_resend_at),
      invitedAddress: typeof row.invited_address === "string" ? row.invited_address : null,
      addressCurrent: row.address_current === null || row.address_current === undefined ? null : row.address_current === true,
      outcome: typeof row.outcome === "string" && outcomes.includes(row.outcome) ? (row.outcome as SignInBlockOutcome) : null,
      delivery: deliveryState(
        queueStatus === null
          ? null
          : {
              status: queueStatus,
              deliveredAt: toDate(row.queue_delivered_at),
              bouncedAt: toDate(row.queue_bounced_at),
              complainedAt: toDate(row.queue_complained_at),
            },
      ),
      connectedVia: typeof row.connected_via === "string" && vias.includes(row.connected_via) ? (row.connected_via as SignInConnectedVia) : null,
      connectedOn: typeof row.connected_on === "string" ? row.connected_on : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// sendSignInInvitation / resendSignInInvitation
// ---------------------------------------------------------------------------

type SendKind = "send" | "resend";

function refusalFromRow(row: Row, reason: SignInRefusal, personNameValue: string | null): SignInSendResult {
  return {
    kind: "refused",
    reason,
    ...(reason === "needs_acknowledgement" ? { ackReasons: ackReasons(row.ack_reasons) } : {}),
    ...(reason === "cooldown" && toDate(row.next_resend_at) ? { nextResendAt: toDate(row.next_resend_at)! } : {}),
    ...(reason === "already_pending" ? { existingExpired: row.existing_invitation_expired === true } : {}),
    ...(SIGN_IN_REFUSALS_NAMING_THE_PERSON.has(reason) ? { personName: personNameValue } : {}),
  };
}

async function sendOrResend(kind: SendKind, ctx: SignInContext, input: SignInSendInput): Promise<SignInSendResult> {
  if (!validContext(ctx)) return { kind: "forbidden" };
  // A malformed id cannot be a person here: it is `not_found`, with no round trip.
  if (typeof input?.personId !== "string" || !UUID_RE.test(input.personId)) {
    return { kind: "refused", reason: "not_found" };
  }
  const confirmed = normalizeInvitationEmail(input.confirmedAddress);
  if (confirmed === null) return { kind: "invalid_input", field: "confirmedAddress" };
  // Checked BEFORE any write. A link built from anything but the validated
  // platform origin is phishable, and an unconfigured two-factor deployment
  // would strand an invitee whom something requires at the wall: a new
  // account's own setting is off since DECISION-291, but the congregation's
  // policy or a flagged key can still require it, and an elder's connect
  // needs a verified second factor.
  if (platformOrigin() === null) return { kind: "link_origin_unavailable" };
  if (!isTotpConfigured()) return { kind: "totp_unavailable" };

  const { token, tokenHash } = mintInvitationToken();
  const expiresAt = new Date(Date.now() + SIGN_IN_INVITATION_LIMITS.expiryDays * 24 * 60 * 60 * 1000);
  const queueId = randomUUID();
  const acknowledged = input.acknowledged === true;

  type Created = {
    kind: "created";
    invitationId: string;
    address: string;
    acknowledged: SignInAckReason[];
  };

  try {
    const created = await withOrgContext(ctx.actingPersonId, ctx.organizationId, async (tx): Promise<Created> => {
      if (!(await holds(tx, ctx.actingPersonId, ctx.organizationId, PEOPLE_MANAGE))) {
        throw new SignInAbort<SignInSendResult>({ kind: "forbidden" });
      }

      const call =
        kind === "send"
          ? sql`select * from presby_issue_sign_in_invitation(
                  ${input.personId}::uuid, ${tokenHash}::text, ${expiresAt.toISOString()}::timestamptz,
                  ${queueId}::uuid, ${confirmed}::text, ${acknowledged}::boolean, ${ctx.actingUserId}::uuid)`
          : sql`select * from presby_resend_sign_in_invitation(
                  ${input.personId}::uuid, ${tokenHash}::text, ${expiresAt.toISOString()}::timestamptz,
                  ${queueId}::uuid, ${confirmed}::text, ${acknowledged}::boolean, ${ctx.actingUserId}::uuid)`;
      const row = rowsOf(await tx.execute(call))[0];
      if (!row) throw new Error("the sign-in invitation definer returned no row");

      const outcome = String(row.outcome);
      if (outcome !== "ok") {
        const known: readonly string[] = SIGN_IN_REFUSALS;
        if (!known.includes(outcome)) throw new Error("the sign-in invitation definer returned an unknown outcome");
        const reason = outcome as SignInRefusal;
        const name = SIGN_IN_REFUSALS_NAMING_THE_PERSON.has(reason) ? await personName(tx, input.personId) : null;
        throw new SignInAbort<SignInSendResult>(refusalFromRow(row, reason, name));
      }

      const invitationId = String(row.invitation_id);
      const address = String(row.address);
      const acknowledgedByDefiner = ackReasons(row.ack_reasons);
      const invitationExpiresAt = toDate(row.invitation_expires_at) ?? expiresAt;

      const rendered = renderInvitationEmail({
        purpose: "sign_in",
        firstName: typeof row.recipient_first_name === "string" ? row.recipient_first_name : null,
        organizationName: String(row.organization_name),
        senderName: typeof row.sender_name === "string" ? row.sender_name : null,
        token,
        expiresAt: invitationExpiresAt,
      });
      if (!rendered) throw new Error("link origin vanished between check and render");

      // `to` is the address the DEFINER returned (the person's credential
      // address), never the client's string.
      await insertQueueRowInTx(tx, {
        id: queueId,
        to: address,
        message: rendered.message,
        templateKey: ACCOUNT_SIGN_IN_TEMPLATE_KEY,
      });

      const actor = { userId: ctx.actingUserId, email: ctx.actingUserEmail ?? null };
      if (kind === "send") {
        await insertAuditRow(tx, {
          action: AUDIT_ACTIONS.INVITATION_CREATED,
          actor,
          resourceType: "account_invitation",
          resourceId: invitationId,
          metadata: {
            invitationId,
            organizationId: ctx.organizationId,
            purpose: "sign_in",
            origin: "org",
            personId: input.personId,
            expiresAt: invitationExpiresAt.toISOString(),
            acknowledged: acknowledgedByDefiner,
          },
        });
      } else {
        // The chain position, read in the same transaction (the definer's OUT
        // columns do not carry it). The superseded row's id is not returned by
        // the definer, so it is not on this audit row; the table's
        // resent_from_id joins the chain.
        const after = (await readStates(tx, ctx, [input.personId])).get(input.personId);
        if (typeof row.cancel_email_queue_id === "string") {
          await cancelQueuedEmail(tx, row.cancel_email_queue_id);
        }
        await insertAuditRow(tx, {
          action: AUDIT_ACTIONS.INVITATION_RESENT,
          actor,
          resourceType: "account_invitation",
          resourceId: invitationId,
          metadata: {
            invitationId,
            organizationId: ctx.organizationId,
            purpose: "sign_in",
            origin: "org",
            personId: input.personId,
            expiresAt: invitationExpiresAt.toISOString(),
            acknowledged: acknowledgedByDefiner,
            resendCount: after?.resendCount ?? null,
          },
        });
      }

      return { kind: "created", invitationId, address, acknowledged: acknowledgedByDefiner };
    });

    const delivery = await sendAfterCommit(queueId);
    return {
      kind: "ok",
      invitationId: created.invitationId,
      expiresAt,
      delivery,
      address: created.address,
      acknowledged: created.acknowledged,
    };
  } catch (err) {
    if (err instanceof SignInAbort) return err.result as SignInSendResult;
    if (isIdentityRefusal(err)) return { kind: "forbidden" };
    console.error(`[sign-in-invite] ${kind} failed:`, errorClass(err));
    return { kind: "db_error" };
  }
}

export function sendSignInInvitation(ctx: SignInContext, input: SignInSendInput): Promise<SignInSendResult> {
  return sendOrResend("send", ctx, input);
}

export function resendSignInInvitation(ctx: SignInContext, input: SignInSendInput): Promise<SignInSendResult> {
  return sendOrResend("resend", ctx, input);
}

// ---------------------------------------------------------------------------
// revokeSignInInvitation
// ---------------------------------------------------------------------------

export async function revokeSignInInvitation(
  ctx: SignInContext,
  input: { personId: string },
): Promise<SignInRevokeResult> {
  if (!validContext(ctx)) return { kind: "forbidden" };
  if (typeof input?.personId !== "string" || !UUID_RE.test(input.personId)) {
    return { kind: "refused", reason: "not_found" };
  }
  try {
    await withOrgContext(ctx.actingPersonId, ctx.organizationId, async (tx) => {
      if (!(await holds(tx, ctx.actingPersonId, ctx.organizationId, PEOPLE_MANAGE))) {
        throw new SignInAbort<SignInRevokeResult>({ kind: "forbidden" });
      }
      const row = rowsOf(
        await tx.execute(sql`
          select * from presby_revoke_sign_in_invitation(${input.personId}::uuid, ${ctx.actingUserId}::uuid)`),
      )[0];
      if (!row) throw new Error("presby_revoke_sign_in_invitation returned no row");
      if (row.outcome === "not_open") {
        throw new SignInAbort<SignInRevokeResult>({ kind: "refused", reason: "not_open" });
      }
      if (row.outcome !== "ok") throw new Error("presby_revoke_sign_in_invitation returned an unknown outcome");

      const invitationId = String(row.invitation_id);
      // A still-queued email is cancelled in the same transaction; its stored
      // credential body is scrubbed in the same UPDATE.
      if (typeof row.cancel_email_queue_id === "string") await cancelQueuedEmail(tx, row.cancel_email_queue_id);
      await insertAuditRow(tx, {
        action: AUDIT_ACTIONS.INVITATION_REVOKED,
        actor: { userId: ctx.actingUserId, email: ctx.actingUserEmail ?? null },
        resourceType: "account_invitation",
        resourceId: invitationId,
        metadata: {
          invitationId,
          organizationId: ctx.organizationId,
          purpose: "sign_in",
          origin: "org",
          personId: input.personId,
          via: "single",
        },
      });
    });
    return { kind: "ok" };
  } catch (err) {
    if (err instanceof SignInAbort) return err.result as SignInRevokeResult;
    if (isIdentityRefusal(err)) return { kind: "forbidden" };
    console.error("[sign-in-invite] revoke failed:", errorClass(err));
    return { kind: "db_error" };
  }
}

// ---------------------------------------------------------------------------
// getSignInCard (the edit page)
// ---------------------------------------------------------------------------

const STANDINGS: readonly string[] = MEMBERSHIP_STANDINGS;

/**
 * One person's card: the reader's row, the standing core's three answers, the
 * credential address, and the organization's connect toggle, in ONE transaction
 * after `people.manage`. Own-organization facts only (R46); it reads no `users`
 * row (DECISION-189). A reader failure is `error`, which the page renders as the
 * card's honest "We couldn't load this" line; it never blocks the page.
 */
export async function getSignInCard(ctx: SignInContext, personId: string): Promise<SignInCardResult> {
  if (!validContext(ctx)) return { kind: "forbidden" };
  if (typeof personId !== "string" || !UUID_RE.test(personId)) return { kind: "not_found" };
  try {
    return await withOrgContext(ctx.actingPersonId, ctx.organizationId, async (tx): Promise<SignInCardResult> => {
      if (!(await holds(tx, ctx.actingPersonId, ctx.organizationId, PEOPLE_MANAGE))) return { kind: "forbidden" };

      const st = (await readStates(tx, ctx, [personId])).get(personId);
      // An id with no membership here is omitted by the reader: not found.
      if (!st) return { kind: "not_found" };

      const standingRow = rowsOf(
        await tx.execute(sql`
          select standing, authority_bearing, address_shared
            from presby_sign_in_card_standing(${personId}::uuid, ${ctx.actingUserId}::uuid)`),
      )[0];
      const standing: MembershipStanding | null =
        typeof standingRow?.standing === "string" && STANDINGS.includes(standingRow.standing)
          ? (standingRow.standing as MembershipStanding)
          : null;
      const authorityBearing = standingRow?.authority_bearing === true;
      const addressShared = standingRow?.address_shared === true;

      const email = await getPersonEmail(tx, personId, "credential");
      const selfConnectEnabled = await orgFeatureEnabledInTx(tx, ctx.organizationId, SIGN_IN_CONNECT_TOGGLE, false);

      const open = st.state === "pending" || st.state === "expired";
      const now = Date.now();
      const cooldownMinutes =
        open && st.nextResendAt && st.nextResendAt.getTime() > now
          ? Math.ceil((st.nextResendAt.getTime() - now) / 60_000)
          : 0;

      const card: SignInCardState = {
        personId,
        state: st.state,
        linked: st.linked,
        connectedVia: st.connectedVia,
        connectedOn: st.connectedOn,
        address: email?.address ?? null,
        invitedAddress: st.invitedAddress,
        addressCurrent: st.addressCurrent,
        sentAt: st.sentAt,
        expiresAt: st.expiresAt,
        resendCount: st.resendCount,
        nextResendAt: st.nextResendAt,
        cooldownMinutes,
        chainCapReached: open && st.resendCount >= SIGN_IN_INVITATION_LIMITS.maxResendsPerChain,
        delivery: st.delivery,
        blockedOutcome: st.outcome,
        isVisitor: standing === "visitor",
        addressDoNotContact: email?.doNotContact === true,
        authorityBearing,
        addressShared,
        selfConnectEnabled,
        outlook: connectOutlook({
          state: st.state,
          hasAddress: email !== null,
          standing,
          authorityBearing,
          addressShared,
          selfConnectEnabled,
          connectedVia: st.connectedVia,
        }),
      };
      return { kind: "ok", card };
    });
  } catch (err) {
    if (isIdentityRefusal(err)) return { kind: "forbidden" };
    console.error("[sign-in-invite] card failed:", errorClass(err));
    return { kind: "error" };
  }
}

// ---------------------------------------------------------------------------
// getSignInMarkers (the Community lists and the Officers roster)
// ---------------------------------------------------------------------------

/**
 * The marker for each of a page's people, in ONE reader call and one
 * authority-probe query (plus one credential-address presence query), all in one
 * transaction. `{}` (never an error) when the viewer lacks `people.manage`, when
 * the page has no ids, or when anything fails: a marker is chrome, and chrome
 * must never take a page down. At most 500 ids are read (the reader's bound);
 * a page is far smaller.
 *
 * The authority probe is DISPLAY ONLY. It asks whether a person holds something
 * that is inert until they are connected (an open officer term, an open staff
 * position, an open role grant made to them directly), so an ordinary member of
 * a large congregation gets no marker. The decision about who can be invited or
 * connected is the standing core's, in SQL, never this.
 */
export async function getSignInMarkers(
  ctx: SignInContext,
  personIds: readonly string[],
): Promise<Record<string, SignInMarker>> {
  try {
    if (!validContext(ctx)) return {};
    const ids = [...new Set(personIds.filter((id) => typeof id === "string" && UUID_RE.test(id)))].slice(0, READER_MAX_IDS);
    if (ids.length === 0) return {};
    return await withOrgContext(ctx.actingPersonId, ctx.organizationId, async (tx) => {
      if (!(await holds(tx, ctx.actingPersonId, ctx.organizationId, PEOPLE_MANAGE))) return {};
      const states = await readStates(tx, ctx, ids);

      const probed = [...states.values()].filter(
        (s) => !s.linked && (s.state === "none" || s.state === "revoked" || s.state === "blocked"),
      );
      const probeIds = probed.map((s) => s.personId);
      const inert = new Set<string>();
      if (probeIds.length > 0) {
        const result = await tx.execute(sql`
          select u.id::text as id
            from unnest(${uuidArray(probeIds)}) as u(id)
           where exists (select 1 from officer_terms ot
                          where ot.organization_id = ${ctx.organizationId}::uuid and ot.person_id = u.id
                            and (ot.ends_on is null or ot.ends_on > current_date))
              or exists (select 1 from staff_positions sp
                          where sp.organization_id = ${ctx.organizationId}::uuid and sp.person_id = u.id
                            and (sp.ends_on is null or sp.ends_on > current_date))
              or exists (select 1 from role_grants rg
                          where rg.organization_id = ${ctx.organizationId}::uuid and rg.person_id = u.id
                            and (rg.ends_on is null or rg.ends_on > current_date))
        `);
        for (const row of rowsOf(result)) inert.add(String(row.id));
      }

      const withAddress = await personIdsWithCredentialEmail(
        tx,
        [...states.values()].filter((s) => !s.linked && s.state !== "signs_in").map((s) => s.personId),
      );

      const out: Record<string, SignInMarker> = {};
      for (const s of states.values()) {
        const marker = deriveSignInMarker(
          { linked: s.linked, state: s.state, sentAt: s.sentAt, delivery: s.delivery },
          { holdsInertAuthority: inert.has(s.personId), hasAddress: withAddress.has(s.personId) },
        );
        if (marker) out[s.personId] = marker;
      }
      return out;
    });
  } catch (err) {
    console.error("[sign-in-invite] markers failed:", errorClass(err));
    return {};
  }
}

// ---------------------------------------------------------------------------
// listSessionSignInRows (the Session banner's hand-off)
// ---------------------------------------------------------------------------

/**
 * The Session seats in effect today whose holder has no connected sign-in, each
 * with the reader's state, for the hand-off under the `no_sign_in` banner. Only
 * for a viewer holding BOTH `people.manage` and `officers.manage` (284e: the
 * invite needs the first, a Session seat needs the second); anyone else is
 * `forbidden` and the banner shows the sentence with no names and no link.
 *
 * "In effect today" is the set `getSessionApprovalState` counts as `recorded`
 * (an open term that has started), so the rows and the banner's count agree. A
 * seat that starts later is not a row: nobody is waiting on it.
 */
export async function listSessionSignInRows(ctx: SignInContext): Promise<SessionSignInRowsResult> {
  if (!validContext(ctx)) return { kind: "forbidden" };
  try {
    return await withOrgContext(ctx.actingPersonId, ctx.organizationId, async (tx): Promise<SessionSignInRowsResult> => {
      if (
        !(await holds(tx, ctx.actingPersonId, ctx.organizationId, PEOPLE_MANAGE)) ||
        !(await holds(tx, ctx.actingPersonId, ctx.organizationId, OFFICERS_MANAGE))
      ) {
        return { kind: "forbidden" };
      }
      const seats = rowsOf(
        await tx.execute(sql`
          select p.id::text as id,
                 coalesce(nullif(btrim(p.preferred_name), ''), p.first_name) || ' ' || p.last_name as name
            from people p
           where p.user_id is null and p.merged_into_id is null and p.date_of_death is null
             and presby_membership_is_active(p.id, ${ctx.organizationId}::uuid)
             and exists (
               select 1 from group_memberships gm
                 join groups g on g.id = gm.group_id
                where gm.person_id = p.id and gm.organization_id = ${ctx.organizationId}::uuid
                  and g.organization_id = ${ctx.organizationId}::uuid and g.derived_from = 'session'
                  and gm.starts_on <= current_date
                  and (gm.ends_on is null or gm.ends_on > current_date))
           order by p.last_name, p.first_name, p.id
           limit ${READER_MAX_IDS}
        `),
      );
      if (seats.length === 0) return { kind: "ok", rows: [] };

      const ids = seats.map((r) => String(r.id));
      const states = await readStates(tx, ctx, ids);
      const withAddress = await personIdsWithCredentialEmail(tx, ids);

      const rows: SessionSignInRow[] = [];
      for (const seat of seats) {
        const id = String(seat.id);
        const s = states.get(id);
        if (!s) continue;
        const state = deriveSessionRowState(
          { linked: s.linked, state: s.state, sentAt: s.sentAt, delivery: s.delivery },
          { hasAddress: withAddress.has(id) },
        );
        rows.push({
          personId: id,
          name: String(seat.name),
          state,
          sentAt: state === "sent" || state === "bounced" || state === "expired" ? s.sentAt : null,
          action: sessionRowAction(state),
        });
      }
      return { kind: "ok", rows };
    });
  } catch (err) {
    if (isIdentityRefusal(err)) return { kind: "forbidden" };
    console.error("[sign-in-invite] session rows failed:", errorClass(err));
    return { kind: "error" };
  }
}
