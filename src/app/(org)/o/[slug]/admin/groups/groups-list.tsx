import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { GroupListEntry } from "@/lib/groups";

/**
 * `/o/<slug>/admin/groups` — the managed-group list. `Table`, not cards: the
 * data (name / group type / member count) is genuinely tabular and narrow
 * enough at three columns to read cleanly at 360px without a breakpoint-
 * gated column, unlike `officer-roster.tsx`'s wider roster shape. Verified
 * at 360px in a real browser (Workflow Rule, "Verify in a Browser").
 *
 * A Server Component (read-only data), same as `officer-roster.tsx` —
 * embeds no client component of its own; the "New group" CTA lives one
 * level up, in `page.tsx`, gated the same way `admin/members/page.tsx`
 * gates "Add person".
 */
export function GroupsList({
  slug,
  entries,
}: {
  slug: string;
  entries: GroupListEntry[];
}) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No committees or groups yet</p>
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
          <TableHead>Name</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Members</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.groupId}>
            <TableCell className="font-medium">
              <Link
                href={`/o/${slug}/admin/groups/${entry.groupId}`}
                className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {entry.name}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {entry.groupTypeName}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {entry.memberCount}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
