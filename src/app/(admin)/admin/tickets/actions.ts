"use server";
import "server-only";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getPlatformDb } from "@/lib/db";
import { organizations } from "@/lib/db/domain/org";
import { people } from "@/lib/db/domain/people";
import { tickets, ticketMessages, ticketActions } from "@/lib/db/domain/support";
import { users } from "@/lib/db/schema";
import { FEATURES, hasFeature } from "@/lib/permissions";
import {
  CHANGE_CLASSES,
  TICKET_AREAS,
  TICKET_PRIORITIES,
  type ChangeClass,
  type TicketArea,
  type TicketPriority,
  type TicketStatus,
} from "@/lib/tickets";
import {
  notifySubmitterOfOperatorReply,
  notifySubmitterOfResolution,
  resolveOperatorByUserId,
} from "@/lib/tickets-notifications";
import { getBlobStore } from "@/lib/storage/blob-store";
import type { ActionResult } from "@/types/actions";

/**
 * Server Actions for `/admin/tickets*` — platform triage. See
 * docs/work-log/2026-08-20-support-tickets.md Phase 3, "(admin)/admin/
 * tickets/actions.ts — platform triage".
 *
 * USES `getPlatformDb()`, NOT the plain `db` export `admin/feedback/
 * actions.ts` uses. That file's `feedback` table carries no RLS at all, so
 * `db` and `getPlatformDb()` read it identically — a literal copy of that
 * pattern is WRONG here: `tickets`/`ticket_messages`/`ticket_actions` are
 * FORCE RLS (DECISION-069), so reading them through `db` with no org GUC set
 * returns zero rows for every organization, silently — the exact F26
 * failure shape this codebase has hit before (`withOrgContext`'s own header,
 * `0015_presby_membership_probe.sql`). `getPlatformDb()` is the only correct
 * connection for a cross-org triage queue.
 *
 * All five triage mutations (status/assign/reclassify/area/priority) are
 * audit-exempt — routine triage, direct precedent
 * (`admin/feedback/actions.ts`'s `updateFeedbackStatus`) and Phase 1's own
 * ruling ("what's audited is whatever underlying tenant mutation resolves
 * the ticket, under that mutation's own existing AUDIT_ACTIONS key"). Each
 * still writes its own `ticket_actions` row — that row IS this surface's own
 * record.
 */

const VALID_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  new: ["triaged", "declined"],
  triaged: ["in_progress", "declined"],
  in_progress: ["resolved", "declined"],
  resolved: [],
  declined: [],
};

async function requireAdminTicketsSession(): Promise<
  | { ok: true; userId: string; userName: string | null }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Not signed in." };
  if (!hasFeature(session.user.features, FEATURES.ADMIN_TICKETS)) {
    return { ok: false, error: "Forbidden." };
  }
  return { ok: true, userId: session.user.id, userName: session.user.name ?? null };
}

interface TicketRow {
  id: string;
  organizationId: string;
  slug: string;
  subject: string;
  status: string;
  changeClass: string;
  area: string;
  priority: string;
  submitterEmail: string | null;
  submitterFirstName: string;
  submitterLastName: string;
  submitterPreferredName: string | null;
}

async function fetchTicketRow(
  platformDb: ReturnType<typeof getPlatformDb>,
  ticketId: string,
): Promise<TicketRow | null> {
  const [row] = await platformDb
    .select({
      id: tickets.id,
      organizationId: tickets.organizationId,
      slug: organizations.slug,
      subject: tickets.subject,
      status: tickets.status,
      changeClass: tickets.changeClass,
      area: tickets.area,
      priority: tickets.priority,
      submitterEmail: users.email,
      submitterFirstName: people.firstName,
      submitterLastName: people.lastName,
      submitterPreferredName: people.preferredName,
    })
    .from(tickets)
    .innerJoin(organizations, eq(organizations.id, tickets.organizationId))
    .innerJoin(people, eq(people.id, tickets.submitterPersonId))
    .leftJoin(users, eq(users.id, people.userId))
    .where(eq(tickets.id, ticketId))
    .limit(1);
  return row ?? null;
}

function submitterDisplayName(row: TicketRow): string {
  return `${row.submitterPreferredName ?? row.submitterFirstName} ${row.submitterLastName}`;
}

function revalidateTicket(ticketId: string): void {
  revalidatePath(`/admin/tickets/${ticketId}`);
  revalidatePath(`/admin/tickets`);
}

// ---------------------------------------------------------------------------
// updateTicketStatusAction
// ---------------------------------------------------------------------------

export async function updateTicketStatusAction(
  ticketId: string,
  newStatus: TicketStatus,
): Promise<ActionResult> {
  const gate = await requireAdminTicketsSession();
  if (!gate.ok) return { ok: false, error: gate.error };

  const platformDb = getPlatformDb();
  const row = await fetchTicketRow(platformDb, ticketId);
  if (!row) return { ok: false, error: "Ticket not found." };

  const allowed = VALID_TRANSITIONS[row.status as TicketStatus] ?? [];
  if (!allowed.includes(newStatus)) {
    return {
      ok: false,
      error: `Cannot change status from '${row.status}' to '${newStatus}'.`,
    };
  }

  // audit-exempt: routine triage — the ticket_actions row below is this
  // surface's own record.
  await platformDb.transaction(async (tx) => {
    await tx.update(tickets).set({ status: newStatus }).where(eq(tickets.id, ticketId));
    await tx.insert(ticketActions).values({
      organizationId: row.organizationId,
      ticketId,
      action: "status_changed",
      fromValue: row.status,
      toValue: newStatus,
      actorUserId: gate.userId,
    });
  });

  if ((newStatus === "resolved" || newStatus === "declined") && row.submitterEmail) {
    await notifySubmitterOfResolution({
      ticketId,
      slug: row.slug,
      submitterEmail: row.submitterEmail,
      submitterName: submitterDisplayName(row),
      subject: row.subject,
      status: newStatus,
    });
  }

  revalidateTicket(ticketId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// assignTicketAction
// ---------------------------------------------------------------------------

export async function assignTicketAction(
  ticketId: string,
  assigneeUserId: string | null,
): Promise<ActionResult> {
  const gate = await requireAdminTicketsSession();
  if (!gate.ok) return { ok: false, error: gate.error };

  const platformDb = getPlatformDb();
  const row = await fetchTicketRow(platformDb, ticketId);
  if (!row) return { ok: false, error: "Ticket not found." };

  let assigneeLabel: string | null = null;
  if (assigneeUserId) {
    const operator = await resolveOperatorByUserId(assigneeUserId);
    if (!operator) {
      return { ok: false, error: "That person doesn't hold access to tickets." };
    }
    assigneeLabel = operator.email;
  }

  // audit-exempt: routine triage.
  await platformDb.transaction(async (tx) => {
    await tx.update(tickets).set({ assigneeUserId }).where(eq(tickets.id, ticketId));
    await tx.insert(ticketActions).values({
      organizationId: row.organizationId,
      ticketId,
      action: "assigned",
      fromValue: null,
      toValue: assigneeLabel,
      actorUserId: gate.userId,
    });
  });

  revalidateTicket(ticketId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// reclassifyTicketAction
// ---------------------------------------------------------------------------

export async function reclassifyTicketAction(
  ticketId: string,
  changeClass: ChangeClass,
): Promise<ActionResult> {
  const gate = await requireAdminTicketsSession();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!(CHANGE_CLASSES as readonly string[]).includes(changeClass)) {
    return { ok: false, error: "Choose a valid category." };
  }

  const platformDb = getPlatformDb();
  const row = await fetchTicketRow(platformDb, ticketId);
  if (!row) return { ok: false, error: "Ticket not found." };

  // audit-exempt: routine triage.
  await platformDb.transaction(async (tx) => {
    await tx.update(tickets).set({ changeClass }).where(eq(tickets.id, ticketId));
    await tx.insert(ticketActions).values({
      organizationId: row.organizationId,
      ticketId,
      action: "reclassified",
      fromValue: row.changeClass,
      toValue: changeClass,
      actorUserId: gate.userId,
    });
  });

  revalidateTicket(ticketId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// setTicketAreaAction
// ---------------------------------------------------------------------------

export async function setTicketAreaAction(
  ticketId: string,
  area: TicketArea,
): Promise<ActionResult> {
  const gate = await requireAdminTicketsSession();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!(TICKET_AREAS as readonly string[]).includes(area)) {
    return { ok: false, error: "Choose a valid area." };
  }

  const platformDb = getPlatformDb();
  const row = await fetchTicketRow(platformDb, ticketId);
  if (!row) return { ok: false, error: "Ticket not found." };

  // audit-exempt: routine triage.
  await platformDb.transaction(async (tx) => {
    await tx.update(tickets).set({ area }).where(eq(tickets.id, ticketId));
    await tx.insert(ticketActions).values({
      organizationId: row.organizationId,
      ticketId,
      action: "area_changed",
      fromValue: row.area,
      toValue: area,
      actorUserId: gate.userId,
    });
  });

  revalidateTicket(ticketId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// setTicketPriorityAction
// ---------------------------------------------------------------------------

export async function setTicketPriorityAction(
  ticketId: string,
  priority: TicketPriority,
): Promise<ActionResult> {
  const gate = await requireAdminTicketsSession();
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!(TICKET_PRIORITIES as readonly string[]).includes(priority)) {
    return { ok: false, error: "Choose a valid priority." };
  }

  const platformDb = getPlatformDb();
  const row = await fetchTicketRow(platformDb, ticketId);
  if (!row) return { ok: false, error: "Ticket not found." };

  // audit-exempt: routine triage.
  await platformDb.transaction(async (tx) => {
    await tx.update(tickets).set({ priority }).where(eq(tickets.id, ticketId));
    await tx.insert(ticketActions).values({
      organizationId: row.organizationId,
      ticketId,
      action: "priority_changed",
      fromValue: row.priority,
      toValue: priority,
      actorUserId: gate.userId,
    });
  });

  revalidateTicket(ticketId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// replyToTicketAsOperatorAction
// ---------------------------------------------------------------------------

export async function replyToTicketAsOperatorAction(
  ticketId: string,
  body: string,
  attachmentKey?: string,
): Promise<ActionResult<{ messageId: string }>> {
  const gate = await requireAdminTicketsSession();
  if (!gate.ok) return { ok: false, error: gate.error };

  const trimmed = body.trim();
  if (trimmed.length < 1) return { ok: false, error: "Reply can't be empty." };
  if (trimmed.length > 5000) {
    return { ok: false, error: "Reply must be 5,000 characters or fewer." };
  }

  const platformDb = getPlatformDb();
  const row = await fetchTicketRow(platformDb, ticketId);
  if (!row) return { ok: false, error: "Ticket not found." };

  if (attachmentKey) {
    const meta = await getBlobStore().resolveMeta({
      organizationId: row.organizationId,
      key: attachmentKey,
    });
    if (!meta) {
      return {
        ok: false,
        error: "That attachment couldn't be attached — try uploading it again.",
      };
    }
  }

  // No ticket_actions row — a reply is conversation, not a state
  // transition (mirrors replyToTicket()'s own tenant-side shape).
  const [message] = await platformDb
    .insert(ticketMessages)
    .values({
      organizationId: row.organizationId,
      ticketId,
      authorKind: "operator",
      authorUserId: gate.userId,
      body: trimmed,
      attachmentAssetKey: attachmentKey ?? null,
    })
    .returning({ id: ticketMessages.id });

  if (row.submitterEmail) {
    await notifySubmitterOfOperatorReply({
      ticketId,
      slug: row.slug,
      submitterEmail: row.submitterEmail,
      submitterName: submitterDisplayName(row),
      operatorName: gate.userName ?? "A platform operator",
      subject: row.subject,
      excerpt: trimmed.slice(0, 200),
    });
  }

  revalidateTicket(ticketId);
  return { ok: true, data: { messageId: message!.id } };
}
