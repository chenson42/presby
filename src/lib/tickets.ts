import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { withOrgContext } from "@/lib/authz";
import type { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { people } from "@/lib/db/domain/people";
import {
  tickets,
  ticketMessages,
  ticketActions,
  congregationFeedback,
} from "@/lib/db/domain/support";
import { getBlobStore } from "@/lib/storage/blob-store";

/**
 * Support tickets — the tenant-scoped query/mutation module. See
 * docs/work-log/2026-08-20-support-tickets.md Phase 3 "API Contract",
 * DECISION-069 through DECISION-077.
 *
 * SAME SHAPE AS `src/lib/role-grants.ts` (that module's own header is the
 * canonical statement of this convention; not restated in full here): one
 * `withOrgContext()` transaction per exported function, doing everything —
 * permission check, validation, the write — inside it. Thrown exceptions
 * (`OrgAccessError`, from `withOrgContext` itself) for genuine failure; typed
 * result variants for every expected/denied outcome.
 *
 * `hasTicketsFile` is the single-permission gate every exported function
 * checks FIRST — except `submitFeedback`, which is deliberately gate-free
 * (see its own doc comment). `tickets.file` currently has ZERO holders in
 * this codebase: the sibling `2026-08-20-role-catalog` pipeline owns binding
 * a role to it (Phase 3's "Permissions & Flags" section). That is not a
 * blocker for this module — `presby_has_permission(..., 'tickets.file')`
 * is fully callable today and correctly returns `false` for everyone until
 * that binding lands, exactly like `directory.view` before DECISION-063's
 * catalog row got its first role.
 *
 * `hasTicketsFile` IS EXPORTED, unlike `role-grants.ts`'s private
 * `hasRoleGrantsManage` — the two attachment route handlers
 * (`/o/<slug>/tickets/[id]/attachments/[key]`, both `(org)` and its
 * `(admin)` counterpart's own `FEATURES.ADMIN_TICKETS` check) need the same
 * gate without going through one of this module's own exported functions,
 * and re-deriving the `presby_has_permission` call in a second file would be
 * exactly the kind of hand-copied check `directory.ts`'s own header warns
 * eventually drifts.
 *
 * ENUMERATION DISCIPLINE (Flow 2): `getTicketThread()` collapses "this
 * ticket belongs to another org" and "this ticket doesn't exist" into the
 * same `{ kind: "not_found" }` — the WHERE clause (`id = ticketId and
 * organization_id = organizationId`) and FORCE RLS both independently filter
 * a cross-org row to nothing, so there is no code path that could leak "the
 * id is real" even if one of the two were ever removed.
 */

// ---------------------------------------------------------------------------
// Shared vocabulary — mirrors the CHECK constraints in
// drizzle/0019_presby_ticket_support.sql / src/lib/db/domain/support.ts
// exactly. Exported so callers (actions.ts files) validate against the same
// list rather than hand-copying it.
// ---------------------------------------------------------------------------

export const CHANGE_CLASSES = [
  "content",
  "config",
  "theme",
  "bug",
  "feature",
] as const;
export type ChangeClass = (typeof CHANGE_CLASSES)[number];

export const TICKET_AREAS = [
  "directory",
  "roll",
  "roles",
  "giving",
  "events",
  "website",
  "account",
  "other",
] as const;
export type TicketArea = (typeof TICKET_AREAS)[number];

export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_STATUSES = [
  "new",
  "triaged",
  "in_progress",
  "resolved",
  "declined",
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const FEEDBACK_STATUSES = ["new", "promoted", "dismissed"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

type OrgTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function isChangeClass(value: string): value is ChangeClass {
  return (CHANGE_CLASSES as readonly string[]).includes(value);
}
function isTicketArea(value: string): value is TicketArea {
  return (TICKET_AREAS as readonly string[]).includes(value);
}
function isTicketPriority(value: string): value is TicketPriority {
  return (TICKET_PRIORITIES as readonly string[]).includes(value);
}

function displayName(person: {
  firstName: string;
  lastName: string;
  preferredName: string | null;
}): string {
  return `${person.preferredName ?? person.firstName} ${person.lastName}`;
}

/**
 * The single-permission gate — exported; see the module header for why this
 * diverges from `role-grants.ts`'s private-helper precedent.
 */
export async function hasTicketsFile(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid,
             ${organizationId}::uuid,
             'tickets.file'
           ) as allowed
  `);
  return (
    (result as unknown as { rows?: Array<{ allowed?: boolean }> }).rows?.[0]
      ?.allowed === true
  );
}

// ---------------------------------------------------------------------------
// Filing
// ---------------------------------------------------------------------------

export interface FileTicketInput {
  /** 1-200 chars, trimmed. */
  subject: string;
  changeClass: ChangeClass;
  area: TicketArea;
  priority: TicketPriority;
  /** 1-5000 chars, trimmed; becomes ticket_messages row 1. */
  body: string;
  /** An already store()'d blob_assets.id at this org. */
  attachmentKey?: string;
}

export type FileTicketResult =
  | { kind: "ok"; ticketId: string }
  | { kind: "forbidden" }
  | { kind: "invalid_input"; errors: string[] }
  | { kind: "invalid_attachment" };

function validateFileTicketInput(input: FileTicketInput): string[] {
  const errors: string[] = [];
  const subject = input.subject.trim();
  if (subject.length < 1) errors.push("Subject is required.");
  if (subject.length > 200) {
    errors.push("Subject must be 200 characters or fewer.");
  }
  if (!isChangeClass(input.changeClass)) errors.push("Choose a valid category.");
  if (!isTicketArea(input.area)) errors.push("Choose a valid area.");
  if (!isTicketPriority(input.priority)) errors.push("Choose a valid priority.");
  const body = input.body.trim();
  if (body.length < 1) errors.push("Description is required.");
  if (body.length > 5000) {
    errors.push("Description must be 5,000 characters or fewer.");
  }
  return errors;
}

export async function fileTicket(
  submitterPersonId: string,
  organizationId: string,
  input: FileTicketInput,
): Promise<FileTicketResult> {
  return withOrgContext(submitterPersonId, organizationId, async (tx) => {
    if (!(await hasTicketsFile(tx, submitterPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const errors = validateFileTicketInput(input);
    if (errors.length > 0) return { kind: "invalid_input", errors };

    if (input.attachmentKey) {
      const meta = await getBlobStore().resolveMeta({
        organizationId,
        key: input.attachmentKey,
      });
      if (!meta) return { kind: "invalid_attachment" };
    }

    const [ticketRow] = await tx
      .insert(tickets)
      .values({
        organizationId,
        submitterPersonId,
        subject: input.subject.trim(),
        changeClass: input.changeClass,
        area: input.area,
        priority: input.priority,
      })
      .returning({ id: tickets.id });

    await tx.insert(ticketMessages).values({
      organizationId,
      ticketId: ticketRow!.id,
      authorKind: "submitter",
      authorPersonId: submitterPersonId,
      body: input.body.trim(),
      attachmentAssetKey: input.attachmentKey ?? null,
    });

    await tx.insert(ticketActions).values({
      organizationId,
      ticketId: ticketRow!.id,
      action: "created",
      actorUserId: null,
    });

    return { kind: "ok", ticketId: ticketRow!.id };
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface TicketListEntry {
  ticketId: string;
  subject: string;
  changeClass: ChangeClass;
  area: TicketArea;
  priority: TicketPriority;
  status: TicketStatus;
  submitterDisplayName: string;
  createdAt: string;
  lastActivityAt: string;
  messageCount: number;
}

export type ListTicketsResult =
  | { kind: "ok"; tickets: TicketListEntry[] }
  | { kind: "forbidden" };

interface TicketListRow {
  ticket_id: string;
  subject: string;
  change_class: string;
  area: string;
  priority: string;
  status: string;
  submitter_first_name: string;
  submitter_last_name: string;
  created_at: string;
  last_activity_at: string;
  message_count: number;
}

/**
 * Priority ordering (urgent > high > normal > low), then most-recently-active
 * first within a band — a query-time `CASE` in `ORDER BY`, not a dedicated
 * index (Phase 3's Data Model: ticket volume at this scale doesn't earn one
 * yet). "Most recently active" is `GREATEST(created_at, MAX(message
 * created_at))`, not a denormalized column — no trigger, no staleness risk.
 */
export async function listTickets(
  viewerPersonId: string,
  organizationId: string,
  filter?: {
    status?: TicketStatus;
    area?: TicketArea;
    priority?: TicketPriority;
  },
): Promise<ListTicketsResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasTicketsFile(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const result = await tx.execute(sql`
      select t.id as ticket_id,
             t.subject,
             t.change_class,
             t.area,
             t.priority,
             t.status,
             p.first_name as submitter_first_name,
             p.last_name as submitter_last_name,
             p.preferred_name as submitter_preferred_name,
             to_json(t.created_at) #>> '{}' as created_at,
             to_json(
               greatest(t.created_at, coalesce(max(tm.created_at), t.created_at))
             ) #>> '{}' as last_activity_at,
             count(tm.id)::int as message_count
        from tickets t
        join people p on p.id = t.submitter_person_id
        left join ticket_messages tm
               on tm.ticket_id = t.id and tm.organization_id = t.organization_id
       where t.organization_id = ${organizationId}::uuid
         ${filter?.status ? sql`and t.status = ${filter.status}` : sql``}
         ${filter?.area ? sql`and t.area = ${filter.area}` : sql``}
         ${filter?.priority ? sql`and t.priority = ${filter.priority}` : sql``}
       group by t.id, p.first_name, p.last_name, p.preferred_name
       order by case t.priority
                  when 'urgent' then 0
                  when 'high' then 1
                  when 'normal' then 2
                  when 'low' then 3
                  else 4
                end,
                greatest(t.created_at, coalesce(max(tm.created_at), t.created_at)) desc
    `);

    const rows =
      (
        result as unknown as {
          rows?: Array<
            TicketListRow & { submitter_preferred_name: string | null }
          >;
        }
      ).rows ?? [];

    const list: TicketListEntry[] = rows.map((row) => ({
      ticketId: row.ticket_id,
      subject: row.subject,
      changeClass: row.change_class as ChangeClass,
      area: row.area as TicketArea,
      priority: row.priority as TicketPriority,
      status: row.status as TicketStatus,
      submitterDisplayName: displayName({
        firstName: row.submitter_first_name,
        lastName: row.submitter_last_name,
        preferredName: row.submitter_preferred_name,
      }),
      createdAt: row.created_at,
      lastActivityAt: row.last_activity_at,
      messageCount: row.message_count,
    }));

    return { kind: "ok", tickets: list };
  });
}

export interface TicketThreadMessage {
  messageId: string;
  authorKind: "submitter" | "operator";
  authorDisplayName: string;
  body: string;
  attachment: { key: string; contentType: string } | null;
  createdAt: string;
}

export interface TicketThread {
  ticketId: string;
  subject: string;
  changeClass: ChangeClass;
  area: TicketArea;
  priority: TicketPriority;
  status: TicketStatus;
  submitterDisplayName: string;
  createdAt: string;
  messages: TicketThreadMessage[];
}

export type TicketThreadResult =
  | { kind: "ok"; thread: TicketThread }
  | { kind: "forbidden" }
  // BOTH "doesn't exist" and "belongs to another org" — see the module
  // header's Enumeration Discipline note.
  | { kind: "not_found" };

interface ThreadMessageRow {
  message_id: string;
  author_kind: string;
  body: string;
  attachment_asset_key: string | null;
  created_at: string;
  author_first_name: string | null;
  author_last_name: string | null;
  author_preferred_name: string | null;
  author_user_name: string | null;
  author_user_email: string | null;
}

export async function getTicketThread(
  viewerPersonId: string,
  organizationId: string,
  ticketId: string,
): Promise<TicketThreadResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasTicketsFile(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [ticketRow] = await tx
      .select({
        id: tickets.id,
        subject: tickets.subject,
        changeClass: tickets.changeClass,
        area: tickets.area,
        priority: tickets.priority,
        status: tickets.status,
        createdAt: tickets.createdAt,
        submitterFirstName: people.firstName,
        submitterLastName: people.lastName,
        submitterPreferredName: people.preferredName,
      })
      .from(tickets)
      .innerJoin(people, eq(people.id, tickets.submitterPersonId))
      .where(
        and(eq(tickets.id, ticketId), eq(tickets.organizationId, organizationId)),
      )
      .limit(1);

    if (!ticketRow) return { kind: "not_found" };

    const messagesResult = await tx.execute(sql`
      select tm.id as message_id,
             tm.author_kind,
             tm.body,
             tm.attachment_asset_key,
             to_json(tm.created_at) #>> '{}' as created_at,
             p.first_name as author_first_name,
             p.last_name as author_last_name,
             p.preferred_name as author_preferred_name,
             u.name as author_user_name,
             u.email as author_user_email
        from ticket_messages tm
        left join people p on p.id = tm.author_person_id
        left join users u on u.id = tm.author_user_id
       where tm.ticket_id = ${ticketId}::uuid
         and tm.organization_id = ${organizationId}::uuid
       order by tm.created_at
    `);
    const messageRows =
      (messagesResult as unknown as { rows?: ThreadMessageRow[] }).rows ?? [];

    const messages: TicketThreadMessage[] = [];
    for (const row of messageRows) {
      const authorDisplayName =
        row.author_kind === "submitter" && row.author_first_name
          ? displayName({
              firstName: row.author_first_name,
              lastName: row.author_last_name ?? "",
              preferredName: row.author_preferred_name,
            })
          : (row.author_user_name ?? row.author_user_email ?? "Unknown");

      let attachment: TicketThreadMessage["attachment"] = null;
      if (row.attachment_asset_key) {
        const meta = await getBlobStore().resolveMeta({
          organizationId,
          key: row.attachment_asset_key,
        });
        if (meta) {
          attachment = { key: row.attachment_asset_key, contentType: meta.contentType };
        }
      }

      messages.push({
        messageId: row.message_id,
        authorKind: row.author_kind as "submitter" | "operator",
        authorDisplayName,
        body: row.body,
        attachment,
        createdAt: row.created_at,
      });
    }

    return {
      kind: "ok",
      thread: {
        ticketId: ticketRow.id,
        subject: ticketRow.subject,
        changeClass: ticketRow.changeClass as ChangeClass,
        area: ticketRow.area as TicketArea,
        priority: ticketRow.priority as TicketPriority,
        status: ticketRow.status as TicketStatus,
        submitterDisplayName: displayName({
          firstName: ticketRow.submitterFirstName,
          lastName: ticketRow.submitterLastName,
          preferredName: ticketRow.submitterPreferredName,
        }),
        createdAt: ticketRow.createdAt.toISOString(),
        messages,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Replying
// ---------------------------------------------------------------------------

export type ReplyResult =
  | {
      kind: "ok";
      messageId: string;
      ticketSubject: string;
      assigneeUserId: string | null;
    }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "invalid_input"; error: string }
  | { kind: "invalid_attachment" };

export async function replyToTicket(
  authorPersonId: string,
  organizationId: string,
  ticketId: string,
  input: { body: string; attachmentKey?: string },
): Promise<ReplyResult> {
  return withOrgContext(authorPersonId, organizationId, async (tx) => {
    if (!(await hasTicketsFile(tx, authorPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [ticketRow] = await tx
      .select({
        id: tickets.id,
        subject: tickets.subject,
        assigneeUserId: tickets.assigneeUserId,
      })
      .from(tickets)
      .where(
        and(eq(tickets.id, ticketId), eq(tickets.organizationId, organizationId)),
      )
      .limit(1);
    if (!ticketRow) return { kind: "not_found" };

    const body = input.body.trim();
    if (body.length < 1) return { kind: "invalid_input", error: "Reply can't be empty." };
    if (body.length > 5000) {
      return {
        kind: "invalid_input",
        error: "Reply must be 5,000 characters or fewer.",
      };
    }

    if (input.attachmentKey) {
      const meta = await getBlobStore().resolveMeta({
        organizationId,
        key: input.attachmentKey,
      });
      if (!meta) return { kind: "invalid_attachment" };
    }

    const [message] = await tx
      .insert(ticketMessages)
      .values({
        organizationId,
        ticketId: ticketRow.id,
        authorKind: "submitter",
        authorPersonId,
        body,
        attachmentAssetKey: input.attachmentKey ?? null,
      })
      .returning({ id: ticketMessages.id });

    return {
      kind: "ok",
      messageId: message!.id,
      ticketSubject: ticketRow.subject,
      assigneeUserId: ticketRow.assigneeUserId,
    };
  });
}

// ---------------------------------------------------------------------------
// Feedback (Flow 0)
// ---------------------------------------------------------------------------

export type SubmitFeedbackResult =
  | { kind: "ok"; feedbackId: string }
  | { kind: "invalid_input"; error: string };

/**
 * NO `forbidden` kind, and no permission gate at all — deliberately.
 * `withOrgContext()`'s own membership re-check is the entire gate, which is
 * the correct shape for a baseline capability any current member holds (same
 * reasoning `active_membership`'s derived-group grant already established
 * for `directory.view` — this is one rung below even that: no permission row
 * to hold at all, just presence on the roll).
 */
export async function submitFeedback(
  submitterPersonId: string,
  organizationId: string,
  body: string,
): Promise<SubmitFeedbackResult> {
  return withOrgContext(submitterPersonId, organizationId, async (tx) => {
    const trimmed = body.trim();
    if (trimmed.length < 1) return { kind: "invalid_input", error: "Say something first." };
    if (trimmed.length > 2000) {
      return {
        kind: "invalid_input",
        error: "Feedback must be 2,000 characters or fewer.",
      };
    }

    const [row] = await tx
      .insert(congregationFeedback)
      .values({ organizationId, personId: submitterPersonId, body: trimmed })
      .returning({ id: congregationFeedback.id });

    return { kind: "ok", feedbackId: row!.id };
  });
}

export interface FeedbackListEntry {
  feedbackId: string;
  submitterDisplayName: string;
  body: string;
  createdAt: string;
}

export type ListFeedbackResult =
  | { kind: "ok"; feedback: FeedbackListEntry[] }
  | { kind: "forbidden" };

interface FeedbackListRow {
  feedback_id: string;
  body: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  created_at: string;
}

/** status = 'new' ONLY — the review queue, not a full feedback history. */
export async function listPendingFeedback(
  viewerPersonId: string,
  organizationId: string,
): Promise<ListFeedbackResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasTicketsFile(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const result = await tx.execute(sql`
      select cf.id as feedback_id,
             cf.body,
             p.first_name,
             p.last_name,
             p.preferred_name,
             to_json(cf.created_at) #>> '{}' as created_at
        from congregation_feedback cf
        join people p on p.id = cf.person_id
       where cf.organization_id = ${organizationId}::uuid
         and cf.status = 'new'
       order by cf.created_at asc
    `);
    const rows = (result as unknown as { rows?: FeedbackListRow[] }).rows ?? [];

    return {
      kind: "ok",
      feedback: rows.map((row) => ({
        feedbackId: row.feedback_id,
        submitterDisplayName: displayName({
          firstName: row.first_name,
          lastName: row.last_name,
          preferredName: row.preferred_name,
        }),
        body: row.body,
        createdAt: row.created_at,
      })),
    };
  });
}

export type FeedbackPreviewResult =
  | {
      kind: "ok";
      feedback: {
        feedbackId: string;
        submitterDisplayName: string;
        body: string;
        status: FeedbackStatus;
      };
    }
  | { kind: "forbidden" }
  | { kind: "not_found" };

/**
 * Powers `/tickets/new?fromFeedback=<id>`'s pre-fill. Returns the row
 * regardless of status — the page renders "already handled" copy rather than
 * treating an already-promoted/dismissed row as not_found.
 */
export async function getFeedbackPreview(
  viewerPersonId: string,
  organizationId: string,
  feedbackId: string,
): Promise<FeedbackPreviewResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasTicketsFile(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [row] = await tx
      .select({
        id: congregationFeedback.id,
        body: congregationFeedback.body,
        status: congregationFeedback.status,
        firstName: people.firstName,
        lastName: people.lastName,
        preferredName: people.preferredName,
      })
      .from(congregationFeedback)
      .innerJoin(people, eq(people.id, congregationFeedback.personId))
      .where(
        and(
          eq(congregationFeedback.id, feedbackId),
          eq(congregationFeedback.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!row) return { kind: "not_found" };

    return {
      kind: "ok",
      feedback: {
        feedbackId: row.id,
        submitterDisplayName: displayName({
          firstName: row.firstName,
          lastName: row.lastName,
          preferredName: row.preferredName,
        }),
        body: row.body,
        status: row.status as FeedbackStatus,
      },
    };
  });
}

export type PromoteFeedbackResult =
  | {
      kind: "ok";
      ticketId: string;
      /** The ORIGINAL feedback submitter's email, resolved in this same
       * transaction. Nullable defensively (a person with no linked users
       * row); in practice always present. */
      submitterEmail: string | null;
      submitterName: string;
    }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "already_handled" }
  | { kind: "invalid_input"; errors: string[] };

function validatePromotionInput(input: {
  subject: string;
  changeClass: ChangeClass;
  area: TicketArea;
  priority: TicketPriority;
}): string[] {
  const errors: string[] = [];
  const subject = input.subject.trim();
  if (subject.length < 1) errors.push("Subject is required.");
  if (subject.length > 200) {
    errors.push("Subject must be 200 characters or fewer.");
  }
  if (!isChangeClass(input.changeClass)) errors.push("Choose a valid category.");
  if (!isTicketArea(input.area)) errors.push("Choose a valid area.");
  if (!isTicketPriority(input.priority)) errors.push("Choose a valid priority.");
  return errors;
}

/**
 * Promotes a `congregation_feedback` row into a formal ticket. The resulting
 * ticket's `submitter_person_id` is the ORIGINAL feedback submitter
 * (`feedback.person_id`), never `actingPersonId` (the promoting role-holder).
 *
 * DELIBERATELY DOES NOT RE-VERIFY the original submitter's CURRENT
 * membership. `submitter_person_id` is a plain FK to global `people` (D1),
 * and `people`'s own RLS policy has no `ended_on is null` filter — a person
 * stays nameable to this org as long as ANY membership row (ended or not)
 * exists. The report is a historical fact regardless of whether its author
 * is still a member; refusing to promote it would lose real information for
 * no isolation benefit. See the work-log's Edge Cases.
 */
export async function promoteFeedbackToTicket(
  actingPersonId: string,
  organizationId: string,
  feedbackId: string,
  input: {
    subject: string;
    changeClass: ChangeClass;
    area: TicketArea;
    priority: TicketPriority;
  },
): Promise<PromoteFeedbackResult> {
  return withOrgContext(actingPersonId, organizationId, async (tx) => {
    if (!(await hasTicketsFile(tx, actingPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const errors = validatePromotionInput(input);
    if (errors.length > 0) return { kind: "invalid_input", errors };

    const [feedbackRow] = await tx
      .select({
        id: congregationFeedback.id,
        personId: congregationFeedback.personId,
        body: congregationFeedback.body,
        status: congregationFeedback.status,
      })
      .from(congregationFeedback)
      .where(
        and(
          eq(congregationFeedback.id, feedbackId),
          eq(congregationFeedback.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!feedbackRow) return { kind: "not_found" };
    if (feedbackRow.status !== "new") return { kind: "already_handled" };

    const [ticketRow] = await tx
      .insert(tickets)
      .values({
        organizationId,
        submitterPersonId: feedbackRow.personId,
        subject: input.subject.trim(),
        changeClass: input.changeClass,
        area: input.area,
        priority: input.priority,
      })
      .returning({ id: tickets.id });

    await tx.insert(ticketMessages).values({
      organizationId,
      ticketId: ticketRow!.id,
      authorKind: "submitter",
      authorPersonId: feedbackRow.personId,
      body: feedbackRow.body,
    });

    await tx.insert(ticketActions).values({
      organizationId,
      ticketId: ticketRow!.id,
      action: "promoted_from_feedback",
      actorUserId: null,
    });

    await tx
      .update(congregationFeedback)
      .set({ status: "promoted", promotedToTicketId: ticketRow!.id })
      .where(eq(congregationFeedback.id, feedbackId));

    const [submitter] = await tx
      .select({
        email: users.email,
        firstName: people.firstName,
        lastName: people.lastName,
        preferredName: people.preferredName,
      })
      .from(people)
      .leftJoin(users, eq(users.id, people.userId))
      .where(eq(people.id, feedbackRow.personId))
      .limit(1);

    return {
      kind: "ok",
      ticketId: ticketRow!.id,
      submitterEmail: submitter?.email ?? null,
      submitterName: submitter
        ? displayName(submitter)
        : "A member",
    };
  });
}

export type DismissFeedbackResult =
  | { kind: "ok" }
  | { kind: "forbidden" }
  | { kind: "not_found" }
  | { kind: "already_handled" };

export async function dismissFeedback(
  actingPersonId: string,
  organizationId: string,
  feedbackId: string,
): Promise<DismissFeedbackResult> {
  return withOrgContext(actingPersonId, organizationId, async (tx) => {
    if (!(await hasTicketsFile(tx, actingPersonId, organizationId))) {
      return { kind: "forbidden" };
    }

    const [row] = await tx
      .select({ id: congregationFeedback.id, status: congregationFeedback.status })
      .from(congregationFeedback)
      .where(
        and(
          eq(congregationFeedback.id, feedbackId),
          eq(congregationFeedback.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!row) return { kind: "not_found" };
    if (row.status !== "new") return { kind: "already_handled" };

    await tx
      .update(congregationFeedback)
      .set({ status: "dismissed" })
      .where(eq(congregationFeedback.id, feedbackId));

    return { kind: "ok" };
  });
}
