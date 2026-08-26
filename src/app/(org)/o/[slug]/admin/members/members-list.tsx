import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { DirectoryEntry } from "@/lib/directory";

/**
 * Single-column card list — same shape as
 * `directory/directory-list.tsx`, reused here rather than re-invented,
 * since both read `DirectoryEntry[]`. This list additionally links each
 * card to the person's existing directory detail page rather than
 * duplicating one.
 */
export function MembersList({
  slug,
  entries,
  canCreate,
}: {
  slug: string;
  entries: DirectoryEntry[];
  canCreate: boolean;
}) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No members yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Add your first member to get started.
        </p>
        {canCreate && (
          <Button asChild className="mt-4 min-h-11">
            <Link href={`/o/${slug}/admin/members/new`}>Add person</Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.personId}>
          <MemberCard slug={slug} entry={entry} />
        </li>
      ))}
    </ul>
  );
}

function MemberCard({
  slug,
  entry,
}: {
  slug: string;
  entry: DirectoryEntry;
}) {
  const displayName = `${entry.preferredName ?? entry.firstName} ${entry.lastName}`;

  return (
    <Card className="py-4">
      <CardContent>
        <Link
          href={`/o/${slug}/directory/${entry.personId}`}
          className="block space-y-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <h3 className="text-lg font-medium">{displayName}</h3>
          {entry.email && (
            <p className="text-sm text-muted-foreground">{entry.email}</p>
          )}
        </Link>
      </CardContent>
    </Card>
  );
}
