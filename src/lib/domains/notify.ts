import "server-only";
import { sql } from "drizzle-orm";
import { enqueueEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/email/escape-html";
import type { OrgTx } from "@/lib/authz";
import { platformOrigin } from "./host";

/**
 * notify.ts - who is told when a domain changes, and what they are told
 * (Phase 3 T7, G28, Q12: every claim, canonical change, removal and release
 * notifies every `domains.manage` holder at the organization plus the platform
 * admins).
 *
 * ALWAYS THE PLATFORM SENDER. These go through `enqueueEmail()` with
 * `templateKey: "domain_notification"`, an ACCOUNT-class template (Phase 2 R11,
 * DECISION-182): a notice about a church's domain must never depend on that
 * church's domain, DNS or mail reputation to arrive.
 *
 * TWO STEPS, SO A TENANT PATH NEVER REACHES THE PLATFORM CONNECTION. Recipients
 * are collected by `collectNotificationContext(tx, ...)` on the caller's OWN
 * transaction (a tenant `withOrgContext` tx for a church-initiated change; a
 * platform tx for a platform or machine one), and the mail is sent by
 * `sendDomainNotification()` AFTER that transaction has committed. The
 * collection runs in a SAVEPOINT so a failed query can never abort the change
 * it reports on.
 *
 * NEVER A SECRET. The body names the organization, the hostnames and the kind
 * of change. It never contains a proof token, a provider message, or who in
 * particular did it beyond "your organization's administrators" / "PresbyPortal
 * support" / "an automated check". Every interpolated string is HTML-escaped
 * (the email XSS invariant). Failure to notify never throws: it is logged with
 * ids only and the change stands.
 */

export type DomainNotificationEvent =
  | "claimed"
  | "canonical_changed"
  | "removed"
  | "reconnected"
  | "lapsed"
  | "parked"
  | "released"
  | "force_released"
  | "hold_set"
  | "hold_cleared";

export interface NotificationContext {
  organizationId: string;
  organizationName: string;
  slug: string;
  /** Distinct, lowercase, already filtered to active accounts. */
  recipients: string[];
}

export interface DomainNotification {
  event: DomainNotificationEvent;
  hostnames: string[];
  actorKind: "tenant" | "platform" | "machine";
}

interface RecipientRow {
  email: string;
}
interface OrgRow {
  name: string;
  slug: string;
}

function rowsOf<T>(result: unknown): T[] {
  const r = result as { rows?: T[] } | T[];
  return Array.isArray(r) ? r : (r.rows ?? []);
}

/**
 * Every active holder of `domains.manage` at the organization (a direct grant
 * or through a group, today's date) with a live membership and a linked,
 * active account, plus every active platform admin. Distinct, lowercased.
 */
async function recipientsIn(tx: OrgTx, organizationId: string): Promise<string[]> {
  const holders = rowsOf<RecipientRow>(
    await tx.execute(sql`
      with grants as (
        select rg.person_id, rg.group_id
          from role_grants rg
          join app_role_permissions arp on arp.role_id = rg.role_id
         where rg.organization_id = ${organizationId}::uuid
           and arp.permission_key = 'domains.manage'
           and rg.starts_on <= current_date
           and (rg.ends_on is null or rg.ends_on > current_date)
      ), holder_people as (
        select g.person_id as pid from grants g where g.person_id is not null
        union
        select gm.person_id
          from grants g
          join group_memberships gm on gm.group_id = g.group_id
         where g.group_id is not null
           and gm.organization_id = ${organizationId}::uuid
           and gm.starts_on <= current_date
           and (gm.ends_on is null or gm.ends_on > current_date)
      )
      select distinct lower(u.email) as email
        from holder_people h
        join people p on p.id = h.pid and p.merged_into_id is null
        join users u on u.id = p.user_id and u.is_active
        join memberships m on m.person_id = h.pid
         and m.organization_id = ${organizationId}::uuid
         and m.ended_on is null
    `),
  );
  const admins = rowsOf<RecipientRow>(
    await tx.execute(sql`
      select lower(email) as email from users where is_platform_admin and is_active
    `),
  );
  return [...new Set([...holders, ...admins].map((r) => r.email))].sort();
}

/**
 * Collects the organization's name, slug and recipients on the caller's
 * transaction, inside a savepoint. Returns `null` (never throws) when the
 * lookup fails; the caller then simply sends nothing.
 */
export async function collectNotificationContext(
  tx: OrgTx,
  organizationId: string,
): Promise<NotificationContext | null> {
  try {
    return await tx.transaction(async (sp) => {
      const org = rowsOf<OrgRow>(
        await sp.execute(sql`
          select name, slug from organizations where id = ${organizationId}::uuid
        `),
      )[0];
      if (!org) return null;
      return {
        organizationId,
        organizationName: org.name,
        slug: org.slug,
        recipients: await recipientsIn(sp, organizationId),
      };
    });
  } catch {
    console.error(`[domains-notify] recipient lookup failed (organization ${organizationId})`);
    return null;
  }
}

const EVENT_COPY: Record<DomainNotificationEvent, { subject: string; line: string }> = {
  claimed: {
    subject: "A domain was added",
    line: "A website domain was added to your organization and is waiting for its ownership proof.",
  },
  canonical_changed: {
    subject: "The main web address changed",
    line: "Your organization's main web address was changed.",
  },
  removed: {
    subject: "A domain was removed",
    line: "A website domain was removed from your organization.",
  },
  reconnected: {
    subject: "A domain was reconnected",
    line: "A previously removed website domain was reconnected.",
  },
  lapsed: {
    subject: "We can no longer verify a domain",
    line: "We can no longer find the ownership record for a website domain. Your site is serving from its PresbyPortal address until it is restored.",
  },
  parked: {
    subject: "A domain is being held",
    line: "A website domain is being held (not serving) before it is released.",
  },
  released: {
    subject: "A domain was released",
    line: "A website domain was released from your organization.",
  },
  force_released: {
    subject: "A domain was released by PresbyPortal support",
    line: "PresbyPortal support released a website domain from your organization.",
  },
  hold_set: {
    subject: "A domain was paused",
    line: "PresbyPortal support paused a website domain. Your site is still available at its PresbyPortal address.",
  },
  hold_cleared: {
    subject: "A domain was resumed",
    line: "PresbyPortal support resumed a paused website domain.",
  },
};

const ACTOR_COPY: Record<DomainNotification["actorKind"], string> = {
  tenant: "your organization's administrators",
  platform: "PresbyPortal support",
  machine: "an automated check",
};

/** Builds the message body. Exported for the unit test. */
export function buildDomainNotification(
  ctx: NotificationContext,
  n: DomainNotification,
): { subject: string; html: string; text: string } {
  const copy = EVENT_COPY[n.event];
  const origin = platformOrigin();
  const link = origin ? `${origin}/o/${ctx.slug}/admin/domains` : null;
  const hostLines = n.hostnames.map((h) => `- ${h}`).join("\n");
  const text = [
    `${copy.line}`,
    ``,
    `Organization: ${ctx.organizationName}`,
    `Domain${n.hostnames.length === 1 ? "" : "s"}:`,
    hostLines,
    `Made by: ${ACTOR_COPY[n.actorKind]}`,
    link ? `\nReview it here: ${link}` : "",
    `\nIf you did not expect this, contact PresbyPortal support.`,
  ]
    .filter((line) => line !== "")
    .join("\n");
  const html = [
    `<p>${escapeHtml(copy.line)}</p>`,
    `<p><strong>Organization:</strong> ${escapeHtml(ctx.organizationName)}<br />`,
    `<strong>Domain${n.hostnames.length === 1 ? "" : "s"}:</strong></p>`,
    `<ul>${n.hostnames.map((h) => `<li>${escapeHtml(h)}</li>`).join("")}</ul>`,
    `<p><strong>Made by:</strong> ${escapeHtml(ACTOR_COPY[n.actorKind])}</p>`,
    link ? `<p><a href="${escapeHtml(link)}">Review it here &rarr;</a></p>` : "",
    `<p>If you did not expect this, contact PresbyPortal support.</p>`,
  ].join("\n");
  return {
    subject: `${copy.subject} - ${ctx.organizationName}`,
    html,
    text,
  };
}

/**
 * Sends the notification to every collected recipient. Never throws; a missing
 * context or an empty recipient list is a quiet no-op (logged once, ids only).
 */
export async function sendDomainNotification(
  ctx: NotificationContext | null,
  n: DomainNotification,
): Promise<void> {
  if (ctx === null) return;
  if (ctx.recipients.length === 0) {
    console.warn(
      `[domains-notify] no recipients for ${n.event} (organization ${ctx.organizationId})`,
    );
    return;
  }
  const message = buildDomainNotification(ctx, n);
  for (const to of ctx.recipients) {
    try {
      await enqueueEmail({
        to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        templateKey: "domain_notification",
      });
    } catch {
      console.error(
        `[domains-notify] enqueue failed (organization ${ctx.organizationId}, event ${n.event})`,
      );
    }
  }
}
