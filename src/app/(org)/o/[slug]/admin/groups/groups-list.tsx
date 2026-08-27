import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DerivedGroupListEntry, GroupListEntry } from "@/lib/groups";

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

/**
 * `/o/<slug>/admin/groups` — the "Automatic rosters" section. docs/
 * work-log/2026-08-26-groups-show-derived.md: Session, Board of Deacons, and
 * Active Membership are populated only by the `officer_terms`/`memberships`
 * triggers (CLAUDE.md, "The Court Is Not a Group") — this component renders
 * them for VISIBILITY ONLY. No edit link, no add-member form, no
 * end-membership action anywhere in this component — that would be a new
 * write path, and this increment adds none (see `src/lib/groups.ts`'s
 * `listDerivedGroups` header). `session`/`diaconate` rows link to
 * `/o/<slug>/admin/officers`, the surface that actually manages them;
 * `active_membership` has no management surface of its own — it derives
 * from the roll — so its row gets a short explanatory note instead of a
 * link.
 *
 * Renders nothing (not even the section heading) when `entries` is empty,
 * rather than an empty-state card — a brand-new org still has all three
 * derived groups seeded at creation, so an empty list here would mean the
 * `listDerivedGroups` read itself failed, not "no automatic rosters yet";
 * `page.tsx`'s own load-error branch is the correct place for that failure
 * to surface, not a misleading empty card in this section.
 */
export function DerivedGroupsList({
  slug,
  entries,
}: {
  slug: string;
  entries: DerivedGroupListEntry[];
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Automatic rosters</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Generated automatically from officer terms and the membership
          roll. Read-only here — manage who serves from the Officers page.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Members</TableHead>
            <TableHead>Managed from</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={entry.groupId}>
              <TableCell className="font-medium">{entry.name}</TableCell>
              <TableCell className="text-muted-foreground">
                {entry.groupTypeName}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {entry.memberCount}
              </TableCell>
              <TableCell>
                {entry.derivedFrom === "active_membership" ? (
                  <span className="text-sm text-muted-foreground">
                    The membership roll
                  </span>
                ) : (
                  <Link
                    href={`/o/${slug}/admin/officers`}
                    className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    Officers
                  </Link>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
