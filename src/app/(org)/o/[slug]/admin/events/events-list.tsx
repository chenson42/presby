import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { EventListEntry } from "@/lib/events";

/**
 * `/o/<slug>/admin/events` — the full event list, ordered by `startsAt`
 * ascending, mirroring `groups-list.tsx`'s shape. CANCELLED ROWS ARE
 * INCLUDED AND VISIBLY MARKED, NEVER FILTERED OUT (Phase 3's Edge Cases —
 * this is the admin surface, an admin needs to see what they cancelled).
 *
 * A Server Component (read-only data) — embeds no client component of its
 * own; the "New event" CTA lives one level up, in `page.tsx`, gated the same
 * way `admin/groups/page.tsx` gates "New group".
 */
export function EventsList({
  slug,
  entries,
}: {
  slug: string;
  entries: EventListEntry[];
}) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No events yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Add your first one to get started.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>When</TableHead>
          <TableHead className="hidden sm:table-cell">Visibility</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.eventId}>
            <TableCell className="max-w-[8rem] font-medium whitespace-normal sm:max-w-none">
              <Link
                href={`/o/${slug}/admin/events/${entry.eventId}`}
                className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {entry.title}
              </Link>
              {(entry.isRecurringSeries || entry.isSeriesOccurrence) && (
                <Badge variant="secondary" className="ml-2">
                  Series
                </Badge>
              )}
            </TableCell>
            <TableCell className="text-muted-foreground">
              <FormattedDate value={entry.startsAt} mode="datetime" />
            </TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">
              {entry.isPublic ? "Public" : "Members only"}
            </TableCell>
            <TableCell>
              {entry.cancelledAt ? (
                <Badge variant="destructive">Cancelled</Badge>
              ) : (
                <span className="text-sm text-muted-foreground">Scheduled</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
