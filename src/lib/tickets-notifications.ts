import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, userRoles, roles, roleFeatures } from "@/lib/db/schema";
import { FEATURES } from "@/lib/permissions";
import { enqueueEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/email/escape-html";

/**
 * Ticket lifecycle email notifications — shared by `(org)/tickets`,
 * `(org)/feedback`, and `(admin)/tickets`'s own `actions.ts` files.
 * DECISION-077. See docs/work-log/2026-08-20-support-tickets.md Phase 3 "API
 * Contract" for the full event list and reasoning (why these five events and
 * not more, why `resolved`/`declined` email but `triaged`/`in_progress`
 * don't).
 *
 * `tickets.ts` ITSELF STAYS DB-ONLY, NO EMAIL IMPORT — same split
 * `feedback/actions.ts` already draws between the query/mutation layer and
 * the side-effect layer, factored into a shared module here because these
 * events are needed from three different route trees and the "who holds
 * FEATURES.ADMIN_TICKETS" lookup would otherwise be duplicated across them.
 *
 * USES THE PLAIN `db` EXPORT, NEVER `getPlatformDb()` — confirmed directly
 * against `drizzle/0009_presby_rls.sql`'s `tenant_tables` array (the loop
 * that applies FORCE RLS + the `tenant_isolation` policy), not merely
 * asserted from the design doc: `users`, `user_roles`, `roles`, and
 * `role_features` are absent from that array. They carry no RLS policy at
 * all, so `db` (RLS-enforced, `presby_app`) and `getPlatformDb()` (bypasses
 * RLS, `presby_platform`) read them identically — there is no F26-shaped
 * connection question here, unlike the `(admin)/tickets/actions.ts` reads
 * next door, which DO need `getPlatformDb()` because `tickets`/
 * `ticket_messages` ARE FORCE RLS (DECISION-069).
 *
 * Every function below: `escapeHtml()`s every interpolated string (XSS
 * invariant — src/lib/email.ts's own header), builds a small HTML body,
 * calls `enqueueEmail()` with a `templateKey` unique per event, wrapped in
 * try/catch logged via `console.error` — NEVER throws. A notification
 * failure must never take down the mutation it reports on, the same
 * contract `recordAudit()` already holds for audit writes.
 */

export interface TicketOperator {
  userId: string;
  email: string;
  name: string | null;
}

/**
 * Every user who currently holds `FEATURES.ADMIN_TICKETS` — the join
 * `getAssignableOperators()` would otherwise have duplicated in
 * `(admin)/tickets/actions.ts`. That file imports this directly rather than
 * keeping its own separately-named copy (DECISION-077, superseding the
 * original design's separate `getAssignableOperators()` name).
 */
export async function getTicketOperatorPool(): Promise<TicketOperator[]> {
  const rows = await db
    .selectDistinct({ userId: users.id, email: users.email, name: users.name })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(roleFeatures, eq(roleFeatures.roleId, roles.id))
    .where(eq(roleFeatures.featureKey, FEATURES.ADMIN_TICKETS));
  return rows;
}

/**
 * Resolves a specific operator by `users.id`, re-verifying they still hold
 * `FEATURES.ADMIN_TICKETS` (not merely that the id is a valid user) — used
 * both for the submitter-reply fallback-to-assignee lookup and
 * `assignTicketAction`'s own "that operator doesn't hold access to tickets"
 * validation.
 */
export async function resolveOperatorByUserId(
  userId: string,
): Promise<TicketOperator | null> {
  const [row] = await db
    .selectDistinct({ userId: users.id, email: users.email, name: users.name })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .innerJoin(roleFeatures, eq(roleFeatures.roleId, roles.id))
    .where(
      and(eq(users.id, userId), eq(roleFeatures.featureKey, FEATURES.ADMIN_TICKETS)),
    )
    .limit(1);
  return row ?? null;
}

function ticketEmailFooter(href: string, label: string): string {
  return `<hr />\n<p><a href="${escapeHtml(href)}">${escapeHtml(label)} &rarr;</a></p>`;
}

// ---------------------------------------------------------------------------
// notifyOperatorsOfNewTicket
// ---------------------------------------------------------------------------

/**
 * To: every `getTicketOperatorPool()` row. Called from BOTH
 * `fileTicketAction` AND `promoteFeedbackAction` — a promoted ticket needs
 * operator attention exactly as much as a directly-filed one.
 */
export async function notifyOperatorsOfNewTicket(params: {
  ticketId: string;
  slug: string;
  organizationName: string;
  subject: string;
  changeClass: string;
  area: string;
  priority: string;
  submitterName: string;
}): Promise<void> {
  try {
    const operators = await getTicketOperatorPool();
    if (operators.length === 0) {
      console.warn(
        "[tickets-notifications] No ticket operators found — skipping new-ticket notification.",
      );
      return;
    }

    const subjectLine = `New ticket: ${params.subject}`;
    const html = [
      `<p><strong>${escapeHtml(params.organizationName)}</strong> filed a new support ticket.</p>`,
      `<p><strong>Subject:</strong> ${escapeHtml(params.subject)}</p>`,
      `<p><strong>Category:</strong> ${escapeHtml(params.changeClass)} &middot; <strong>Area:</strong> ${escapeHtml(params.area)} &middot; <strong>Priority:</strong> ${escapeHtml(params.priority)}</p>`,
      `<p><strong>Submitted by:</strong> ${escapeHtml(params.submitterName)}</p>`,
      ticketEmailFooter(`/admin/tickets/${params.ticketId}`, "View this ticket"),
    ].join("\n");

    for (const operator of operators) {
      await enqueueEmail({
        to: operator.email,
        subject: escapeHtml(subjectLine),
        html,
        templateKey: "ticket_new",
      });
    }
  } catch (err) {
    console.error("[tickets-notifications] notifyOperatorsOfNewTicket failed:", err);
  }
}

// ---------------------------------------------------------------------------
// notifySubmitterOfOperatorReply
// ---------------------------------------------------------------------------

export async function notifySubmitterOfOperatorReply(params: {
  ticketId: string;
  slug: string;
  submitterEmail: string;
  submitterName: string;
  operatorName: string;
  subject: string;
  excerpt: string;
}): Promise<void> {
  try {
    const html = [
      `<p>${escapeHtml(params.operatorName)} replied to your ticket "${escapeHtml(params.subject)}".</p>`,
      `<p style="white-space:pre-wrap">${escapeHtml(params.excerpt)}</p>`,
      ticketEmailFooter(
        `/o/${params.slug}/tickets/${params.ticketId}`,
        "View the full thread",
      ),
    ].join("\n");

    await enqueueEmail({
      to: params.submitterEmail,
      subject: escapeHtml(`New reply on your ticket: ${params.subject}`),
      html,
      templateKey: "ticket_operator_reply",
    });
  } catch (err) {
    console.error(
      "[tickets-notifications] notifySubmitterOfOperatorReply failed:",
      err,
    );
  }
}

// ---------------------------------------------------------------------------
// notifyOperatorsOfSubmitterReply
// ---------------------------------------------------------------------------

/** `assignee` non-null -> that operator only; null -> falls back to the pool. */
export async function notifyOperatorsOfSubmitterReply(params: {
  ticketId: string;
  subject: string;
  submitterName: string;
  excerpt: string;
  assignee: TicketOperator | null;
}): Promise<void> {
  try {
    const recipients = params.assignee ? [params.assignee] : await getTicketOperatorPool();
    if (recipients.length === 0) {
      console.warn(
        "[tickets-notifications] No ticket operators found — skipping submitter-reply notification.",
      );
      return;
    }

    const html = [
      `<p>${escapeHtml(params.submitterName)} replied to their ticket "${escapeHtml(params.subject)}".</p>`,
      `<p style="white-space:pre-wrap">${escapeHtml(params.excerpt)}</p>`,
      ticketEmailFooter(`/admin/tickets/${params.ticketId}`, "View this ticket"),
    ].join("\n");

    for (const operator of recipients) {
      await enqueueEmail({
        to: operator.email,
        subject: escapeHtml(`New reply on ticket: ${params.subject}`),
        html,
        templateKey: "ticket_submitter_reply",
      });
    }
  } catch (err) {
    console.error(
      "[tickets-notifications] notifyOperatorsOfSubmitterReply failed:",
      err,
    );
  }
}

// ---------------------------------------------------------------------------
// notifySubmitterOfResolution
// ---------------------------------------------------------------------------

/**
 * Fires ONLY for the two terminal statuses (`resolved`/`declined`) — see the
 * work-log's Edge Cases for why `triaged`/`in_progress` stay silent.
 */
export async function notifySubmitterOfResolution(params: {
  ticketId: string;
  slug: string;
  submitterEmail: string;
  submitterName: string;
  subject: string;
  status: "resolved" | "declined";
}): Promise<void> {
  try {
    const html = [
      `<p>Your ticket "${escapeHtml(params.subject)}" has been marked <strong>${escapeHtml(params.status)}</strong>.</p>`,
      ticketEmailFooter(
        `/o/${params.slug}/tickets/${params.ticketId}`,
        "View the full thread",
      ),
    ].join("\n");

    await enqueueEmail({
      to: params.submitterEmail,
      subject: escapeHtml(`Your ticket has been ${params.status}: ${params.subject}`),
      html,
      templateKey: "ticket_resolved",
    });
  } catch (err) {
    console.error(
      "[tickets-notifications] notifySubmitterOfResolution failed:",
      err,
    );
  }
}

// ---------------------------------------------------------------------------
// notifySubmitterOfPromotion
// ---------------------------------------------------------------------------

export async function notifySubmitterOfPromotion(params: {
  ticketId: string;
  slug: string;
  submitterEmail: string;
  submitterName: string;
  subject: string;
}): Promise<void> {
  try {
    const html = [
      `<p>Hi ${escapeHtml(params.submitterName)}, your feedback has been turned into a ticket so we can track it: "${escapeHtml(params.subject)}".</p>`,
      ticketEmailFooter(`/o/${params.slug}/tickets/${params.ticketId}`, "View the ticket"),
    ].join("\n");

    await enqueueEmail({
      to: params.submitterEmail,
      subject: escapeHtml(`Your feedback became a ticket: ${params.subject}`),
      html,
      templateKey: "ticket_feedback_promoted",
    });
  } catch (err) {
    console.error(
      "[tickets-notifications] notifySubmitterOfPromotion failed:",
      err,
    );
  }
}
