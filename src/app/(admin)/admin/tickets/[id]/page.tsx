import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { asc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getPlatformDb } from "@/lib/db";
import { organizations } from "@/lib/db/domain/org";
import { people } from "@/lib/db/domain/people";
import { ticketActions, ticketMessages, tickets } from "@/lib/db/domain/support";
import { users } from "@/lib/db/schema";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { getBlobStore } from "@/lib/storage/blob-store";
import { getTicketOperatorPool } from "@/lib/tickets-notifications";
import type {
  ChangeClass,
  TicketArea,
  TicketPriority,
  TicketStatus,
} from "@/lib/tickets";
import {
  CHANGE_CLASS_LABELS,
  PRIORITY_BADGE_VARIANT,
  STATUS_BADGE_VARIANT,
  TICKET_AREA_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
} from "@/lib/tickets-labels";
import { Badge } from "@/components/ui/badge";
import { FormattedDate } from "@/components/shared/formatted-date";
import { StatusControl } from "../status-control";
import { AssignControl } from "../assign-control";
import { ClassifyControl } from "../classify-control";
import { AreaControl } from "../area-control";
import { PriorityControl } from "../priority-control";
import { AdminReplyForm } from "../admin-reply-form";

const ACTION_LABELS: Record<string, string> = {
  created: "Ticket filed",
  promoted_from_feedback: "Promoted from feedback",
  status_changed: "Status changed",
  reclassified: "Category changed",
  area_changed: "Area changed",
  priority_changed: "Priority changed",
  assigned: "Assignee changed",
};

/**
 * `/admin/tickets/<id>` — detail: thread, the `ticket_actions` timeline
 * (operator-only — see `src/lib/tickets.ts`'s `TicketThread` header for why
 * the tenant-facing thread deliberately omits this), status/assign/
 * classify/area/priority controls, and a reply form.
 *
 * `getPlatformDb()` throughout, same reasoning as
 * `(admin)/tickets/actions.ts`'s own header — `tickets`/`ticket_messages`/
 * `ticket_actions` are FORCE RLS, so this page has no tenant person to gate
 * on and no org GUC to set; the `FEATURES.ADMIN_TICKETS` session check is
 * the entire authorization.
 */
export default async function AdminTicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/admin/tickets");
  if (!hasFeature(session.user.features, FEATURES.ADMIN_TICKETS)) {
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have permission to view this page.
      </p>
    );
  }

  const platformDb = getPlatformDb();

  const [ticket] = await platformDb
    .select({
      id: tickets.id,
      organizationId: tickets.organizationId,
      organizationName: organizations.name,
      subject: tickets.subject,
      changeClass: tickets.changeClass,
      area: tickets.area,
      priority: tickets.priority,
      status: tickets.status,
      assigneeUserId: tickets.assigneeUserId,
      submitterFirstName: people.firstName,
      submitterLastName: people.lastName,
      submitterPreferredName: people.preferredName,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .innerJoin(organizations, eq(organizations.id, tickets.organizationId))
    .innerJoin(people, eq(people.id, tickets.submitterPersonId))
    .where(eq(tickets.id, id))
    .limit(1);

  if (!ticket) notFound();

  const submitterDisplayName = `${
    ticket.submitterPreferredName ?? ticket.submitterFirstName
  } ${ticket.submitterLastName}`;

  const messageRows = await platformDb
    .select({
      id: ticketMessages.id,
      authorKind: ticketMessages.authorKind,
      body: ticketMessages.body,
      attachmentAssetKey: ticketMessages.attachmentAssetKey,
      createdAt: ticketMessages.createdAt,
      authorFirstName: people.firstName,
      authorLastName: people.lastName,
      authorPreferredName: people.preferredName,
      authorUserName: users.name,
      authorUserEmail: users.email,
    })
    .from(ticketMessages)
    .leftJoin(people, eq(people.id, ticketMessages.authorPersonId))
    .leftJoin(users, eq(users.id, ticketMessages.authorUserId))
    .where(eq(ticketMessages.ticketId, id))
    .orderBy(asc(ticketMessages.createdAt));

  const messages = await Promise.all(
    messageRows.map(async (row) => {
      let attachment: { key: string; contentType: string } | null = null;
      if (row.attachmentAssetKey) {
        const meta = await getBlobStore().resolveMeta({
          organizationId: ticket.organizationId,
          key: row.attachmentAssetKey,
        });
        if (meta) {
          attachment = { key: row.attachmentAssetKey, contentType: meta.contentType };
        }
      }
      const authorDisplayName =
        row.authorKind === "submitter" && row.authorFirstName
          ? `${row.authorPreferredName ?? row.authorFirstName} ${row.authorLastName}`
          : (row.authorUserName ?? row.authorUserEmail ?? "Unknown");
      return { ...row, attachment, authorDisplayName };
    }),
  );

  const actionRows = await platformDb
    .select({
      id: ticketActions.id,
      action: ticketActions.action,
      fromValue: ticketActions.fromValue,
      toValue: ticketActions.toValue,
      actorEmail: users.email,
      appliedAt: ticketActions.appliedAt,
    })
    .from(ticketActions)
    .leftJoin(users, eq(users.id, ticketActions.actorUserId))
    .where(eq(ticketActions.ticketId, id))
    .orderBy(asc(ticketActions.appliedAt));

  const operators = await getTicketOperatorPool();

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <Link
          href="/admin/tickets"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to tickets
        </Link>
        <h1 className="mt-3 text-2xl font-semibold">{ticket.subject}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {ticket.organizationName} &mdash; filed by {submitterDisplayName} on{" "}
          <FormattedDate value={ticket.createdAt} mode="datetime" />
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <p className="text-sm font-medium">Status</p>
          <StatusControl ticketId={ticket.id} currentStatus={ticket.status as TicketStatus} />
        </div>
        <div>
          <p className="text-sm font-medium">Assignee</p>
          <AssignControl
            ticketId={ticket.id}
            currentAssigneeUserId={ticket.assigneeUserId}
            operators={operators}
          />
        </div>
        <div>
          <p className="text-sm font-medium">Category</p>
          <ClassifyControl
            ticketId={ticket.id}
            currentChangeClass={ticket.changeClass as ChangeClass}
          />
        </div>
        <div>
          <p className="text-sm font-medium">Area</p>
          <AreaControl ticketId={ticket.id} currentArea={ticket.area as TicketArea} />
        </div>
        <div>
          <p className="text-sm font-medium">Priority</p>
          <PriorityControl
            ticketId={ticket.id}
            currentPriority={ticket.priority as TicketPriority}
          />
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Conversation</h2>
        {messages.map((message) => (
          <div key={message.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {message.authorDisplayName}{" "}
                <Badge variant="outline" className="ml-1 font-normal">
                  {message.authorKind === "operator" ? "Operator" : "Submitter"}
                </Badge>
              </span>
              <span className="text-xs text-muted-foreground">
                <FormattedDate value={message.createdAt} mode="datetime" />
              </span>
            </div>
            <p className="mt-2 text-sm whitespace-pre-wrap">{message.body}</p>
            {message.attachment &&
              (message.attachment.contentType === "application/pdf" ? (
                <a
                  href={`/admin/tickets/${id}/attachments/${message.attachment.key}`}
                  className="mt-2 inline-flex items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  Download attachment (PDF)
                </a>
              ) : (
                // Bytes come from an authenticated route handler, not a
                // static asset next/image can optimize.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/admin/tickets/${id}/attachments/${message.attachment.key}`}
                  alt="Attached image"
                  className="mt-2 h-auto max-w-full rounded-md border border-border"
                />
              ))}
          </div>
        ))}
      </div>

      <AdminReplyForm ticketId={ticket.id} organizationId={ticket.organizationId} />

      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Timeline</h2>
        {actionRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No triage activity yet.</p>
        ) : (
          <ul className="space-y-1 text-sm text-muted-foreground">
            {actionRows.map((row) => (
              <li key={row.id}>
                <FormattedDate value={row.appliedAt} mode="datetime" />{" "}
                &mdash; {ACTION_LABELS[row.action] ?? row.action}
                {row.fromValue || row.toValue
                  ? ` (${row.fromValue ?? "—"} → ${row.toValue ?? "—"})`
                  : ""}
                {row.actorEmail ? ` by ${row.actorEmail}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
