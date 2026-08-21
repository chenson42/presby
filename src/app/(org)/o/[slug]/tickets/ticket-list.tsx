import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { FormattedDate } from "@/components/shared/formatted-date";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TicketListEntry } from "@/lib/tickets";
import {
  CHANGE_CLASS_LABELS,
  PRIORITY_BADGE_VARIANT,
  STATUS_BADGE_VARIANT,
  TICKET_AREA_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
} from "@/lib/tickets-labels";

/**
 * "Open tickets" — a `Table`, same rationale `admin/roles/roles-list.tsx`
 * gives for its own table-not-cards choice: wide, tabular data (subject,
 * priority, status, submitter, activity), not a single-column list.
 * `<Table>`'s own wrapper (`src/components/ui/table.tsx`) is
 * `overflow-x-auto`, so this survives 360px by scrolling rather than
 * truncating a column into illegibility.
 */
export function TicketList({
  tickets,
  slug,
}: {
  tickets: TicketListEntry[];
  slug: string;
}) {
  if (tickets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No tickets yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          File one to reach the platform team, or promote a piece of incoming
          feedback below.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Subject</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Submitted by</TableHead>
          <TableHead>Last activity</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tickets.map((ticket) => (
          <TableRow key={ticket.ticketId}>
            <TableCell className="max-w-xs">
              <Link
                href={`/o/${slug}/tickets/${ticket.ticketId}`}
                className="block truncate font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                title={ticket.subject}
              >
                {ticket.subject}
              </Link>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {TICKET_AREA_LABELS[ticket.area]} &middot;{" "}
                {CHANGE_CLASS_LABELS[ticket.changeClass]}
                {ticket.messageCount > 1
                  ? ` · ${ticket.messageCount} messages`
                  : ""}
              </p>
            </TableCell>
            <TableCell>
              <Badge variant={PRIORITY_BADGE_VARIANT[ticket.priority]}>
                {TICKET_PRIORITY_LABELS[ticket.priority]}
              </Badge>
            </TableCell>
            <TableCell>
              <Badge variant={STATUS_BADGE_VARIANT[ticket.status]}>
                {TICKET_STATUS_LABELS[ticket.status]}
              </Badge>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {ticket.submitterDisplayName}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              <FormattedDate value={ticket.lastActivityAt} mode="datetime" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
