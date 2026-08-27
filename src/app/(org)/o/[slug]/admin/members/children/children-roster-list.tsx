import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { ChildRosterEntry } from "@/lib/children";

/**
 * The children's roster list (Phase 3 Component Plan). A NEW component, not
 * a reuse of `members-list.tsx` — different columns (name, age, household,
 * guardian count / "no guardian on file" badge), no search/status-filter/
 * pagination in v1 (a congregation's children's roster is small).
 */
export function ChildrenRosterList({
  slug,
  children,
}: {
  slug: string;
  children: ChildRosterEntry[];
}) {
  if (children.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No children recorded yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Children appear here once a date of birth is on file and they are
          under 18.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        Showing {children.length}{" "}
        {children.length === 1 ? "child" : "children"}
      </p>
      <ul className="space-y-3">
        {children.map((child) => (
          <li key={child.personId}>
            <ChildCard slug={slug} child={child} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChildCard({
  slug,
  child,
}: {
  slug: string;
  child: ChildRosterEntry;
}) {
  const displayName = `${child.preferredName ?? child.firstName} ${child.lastName}`;

  return (
    <Card className="py-4">
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-lg font-medium">{displayName}</h3>
          <p className="text-sm text-muted-foreground">
            Age {child.ageYears}
            {child.householdName ? ` · ${child.householdName}` : ""}
          </p>
          {child.guardianCount === 0 ? (
            <Badge variant="outline" className="border-destructive/50 text-destructive">
              No guardian on file
            </Badge>
          ) : (
            <p className="text-xs text-muted-foreground">
              {child.guardianCount}{" "}
              {child.guardianCount === 1 ? "guardian" : "guardians"} on file
            </p>
          )}
        </div>
        <Link
          href={`/o/${slug}/admin/members/${child.personId}/edit/guardians`}
          className="min-h-11 shrink-0 rounded-md border border-input px-3 py-2 text-sm underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Guardians
        </Link>
      </CardContent>
    </Card>
  );
}
