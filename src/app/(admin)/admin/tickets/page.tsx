import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { getPlatformDb } from "@/lib/db";
import { organizations } from "@/lib/db/domain/org";
import { people } from "@/lib/db/domain/people";
import { tickets } from "@/lib/db/domain/support";
import { users } from "@/lib/db/schema";
import { FEATURES, hasFeature } from "@/lib/permissions";
import {
  TICKET_AREAS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type ChangeClass,
  type TicketArea,
  type TicketPriority,
  type TicketStatus,
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
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormattedDate } from "@/components/shared/formatted-date";

const VALID_STATUSES = new Set<string>(["all", ...TICKET_STATUSES]);
const VALID_AREAS = new Set<string>(["all", ...TICKET_AREAS]);
const VALID_PRIORITIES = new Set<string>(["all", ...TICKET_PRIORITIES]);

/**
 * `/admin/tickets` — the cross-org triage queue. Mirrors
 * `admin/feedback/page.tsx`'s shape (independent `FEATURES.ADMIN_TICKETS`
 * gate on every render — the admin layout covers session, not per-page
 * features), but reads through `getPlatformDb()` rather than the plain `db`
 * export: `tickets` is FORCE RLS (DECISION-069) where `feedback` is not, so
 * a literal copy of that reference pattern would silently return zero rows
 * for every organization (the F26 shape `withOrgContext`'s own header
 * warns about).
 *
 * `?status=&area=&priority=` filters via a plain GET `<form>` — no client
 * JS required, same "native `<select>`, no combobox" convention
 * docs/ui-standards.md documents (there is no `Select` primitive in this
 * repo yet).
 */
export default async function AdminTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; area?: string; priority?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/admin/tickets");

  if (!hasFeature(session.user.features, FEATURES.ADMIN_TICKETS)) {
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have permission to view this page.
      </p>
    );
  }

  const sp = await searchParams;
  const status = sp.status && VALID_STATUSES.has(sp.status) ? sp.status : "all";
  const area = sp.area && VALID_AREAS.has(sp.area) ? sp.area : "all";
  const priority =
    sp.priority && VALID_PRIORITIES.has(sp.priority) ? sp.priority : "all";

  const platformDb = getPlatformDb();

  const conditions = [];
  if (status !== "all") conditions.push(eq(tickets.status, status));
  if (area !== "all") conditions.push(eq(tickets.area, area));
  if (priority !== "all") conditions.push(eq(tickets.priority, priority));

  const rows = await platformDb
    .select({
      id: tickets.id,
      subject: tickets.subject,
      status: tickets.status,
      changeClass: tickets.changeClass,
      area: tickets.area,
      priority: tickets.priority,
      createdAt: tickets.createdAt,
      organizationName: organizations.name,
      submitterFirstName: people.firstName,
      submitterLastName: people.lastName,
      submitterPreferredName: people.preferredName,
      assigneeEmail: users.email,
    })
    .from(tickets)
    .innerJoin(organizations, eq(organizations.id, tickets.organizationId))
    .innerJoin(people, eq(people.id, tickets.submitterPersonId))
    .leftJoin(users, eq(users.id, tickets.assigneeUserId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(
      sql`case ${tickets.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 else 4 end`,
      desc(tickets.createdAt),
    );

  const hasFilter = status !== "all" || area !== "all" || priority !== "all";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Support tickets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} ticket{rows.length !== 1 ? "s" : ""} matching this
          filter — sorted urgent first, then newest.
        </p>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 border-b border-border pb-4"
      >
        <div>
          <label htmlFor="filter-status" className="block text-sm font-medium">
            Status
          </label>
          <select
            id="filter-status"
            name="status"
            defaultValue={status}
            className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <option value="all">All statuses</option>
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TICKET_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="filter-area" className="block text-sm font-medium">
            Area
          </label>
          <select
            id="filter-area"
            name="area"
            defaultValue={area}
            className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <option value="all">All areas</option>
            {TICKET_AREAS.map((a) => (
              <option key={a} value={a}>
                {TICKET_AREA_LABELS[a]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="filter-priority" className="block text-sm font-medium">
            Priority
          </label>
          <select
            id="filter-priority"
            name="priority"
            defaultValue={priority}
            className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <option value="all">All priorities</option>
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TICKET_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          Apply
        </Button>
        {hasFilter && (
          <Link
            href="/admin/tickets"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Clear filters
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm font-medium">
            {hasFilter ? "No tickets match this filter." : "No tickets yet"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasFilter
              ? "Try a different combination, or clear the filters above."
              : "Tickets filed by congregations appear here."}
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subject</TableHead>
              <TableHead>Organization</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Area</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>Assignee</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const submitterDisplayName = `${
                row.submitterPreferredName ?? row.submitterFirstName
              } ${row.submitterLastName}`;
              return (
                <TableRow key={row.id} className="align-top">
                  <TableCell className="max-w-xs">
                    <Link
                      href={`/admin/tickets/${row.id}`}
                      className="font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      {row.subject}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {submitterDisplayName} &middot;{" "}
                      {CHANGE_CLASS_LABELS[row.changeClass as ChangeClass]}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm">
                    {row.organizationName}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={PRIORITY_BADGE_VARIANT[row.priority as TicketPriority]}
                    >
                      {TICKET_PRIORITY_LABELS[row.priority as TicketPriority]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE_VARIANT[row.status as TicketStatus]}>
                      {TICKET_STATUS_LABELS[row.status as TicketStatus]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {TICKET_AREA_LABELS[row.area as TicketArea]}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <FormattedDate value={row.createdAt} mode="datetime" />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.assigneeEmail ?? "Unassigned"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
