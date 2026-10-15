import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { PortalHomeHousehold } from "@/lib/org-portal/home-data";
import type { ViewerGroup } from "@/lib/org-portal/my-groups";

const LINK_CLASSES =
  "inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * The "Yours" card: the viewer's household and the viewer's own groups.
 * Server Component; renders what it is given and applies no business rule
 * beyond "render nothing when there is nothing to show".
 *
 * HOUSEHOLD. `household` is non-null only when the directory counts two or
 * more eligible people (`getPortalHomeData` owns that rule, D2), so the count
 * is always plural here — the old "1 member" branch is deleted, not kept as a
 * second copy of the rule. It links to the household page when
 * `householdPageEnabled` (both `org_portal.directory` and
 * `org_portal.directory_v2` are on, the household page's own requirement),
 * otherwise to the directory.
 *
 * GROUPS. Static pills: no link, no hover affordance, no truncation, no cap.
 * Every group read requires `groups.manage`, so a member has no destination to
 * link to. `Badge`'s default is `text-xs` and `whitespace-nowrap`
 * (docs/ui-standards.md forbids `text-xs` on member-facing surfaces); both are
 * overridden here at the call site — the generated primitive is untouched. A
 * second pill consumer should reuse this exact className.
 *
 * Either block is omitted when empty, and the whole card when both are: a
 * member with no household is common and is not a state to call attention to.
 */
export function YoursZone({
  slug,
  household,
  groups,
  householdPageEnabled,
}: {
  slug: string;
  household: PortalHomeHousehold | null;
  groups: ViewerGroup[];
  householdPageEnabled: boolean;
}) {
  if (!household && groups.length === 0) return null;

  return (
    <section aria-labelledby="yours-zone-heading" className="space-y-3">
      <h2 id="yours-zone-heading" className="text-xl font-semibold">
        Yours
      </h2>
      <Card>
        <CardContent className="space-y-6">
          {household && (
            <div className="space-y-3">
              <h3 className="text-lg font-medium break-words">
                {household.name}
              </h3>
              <p className="text-sm text-muted-foreground">
                {household.memberCount} members
              </p>
              <Link
                href={
                  householdPageEnabled
                    ? `/o/${slug}/directory/households/${household.id}`
                    : `/o/${slug}/directory`
                }
                className={LINK_CLASSES}
              >
                {householdPageEnabled ? "View household →" : "View directory →"}
              </Link>
            </div>
          )}
          {groups.length > 0 && (
            <div className="space-y-3">
              <h3 id="yours-groups-heading" className="text-lg font-medium">
                My groups
              </h3>
              <ul
                aria-labelledby="yours-groups-heading"
                className="flex flex-wrap gap-2"
              >
                {groups.map((group) => (
                  <li key={group.groupId} className="min-w-0 max-w-full">
                    <Badge
                      variant="secondary"
                      className="max-w-full shrink whitespace-normal break-words px-3 py-1 text-left text-sm"
                    >
                      {group.name}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
