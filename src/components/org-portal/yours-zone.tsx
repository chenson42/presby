import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { PortalHomeHousehold } from "@/lib/org-portal/home-data";

/**
 * The "yours" zone (Phase 1's Flow 1). Increment 1 ships exactly one card —
 * the household — because that is the only "yours" data presby's schema can
 * answer today: no events/signups feature exists (Church Events / My
 * Signups, Phase 1's Out of Scope) and My Groups depends on `groups.ts`
 * being surfaced on the member side (also deferred). The zone omits itself
 * ENTIRELY when there is nothing to show — never an empty card, never a
 * "you have no household" message — per Phase 3's edge-case note: a member
 * with no household is common (a visitor, a person imported before
 * household assignment) and is not a broken or incomplete state to call
 * attention to.
 */
export function YoursZone({
  slug,
  household,
}: {
  slug: string;
  household: PortalHomeHousehold | null;
}) {
  if (!household) return null;

  return (
    <section aria-labelledby="yours-zone-heading" className="space-y-3">
      <h2 id="yours-zone-heading" className="text-xl font-semibold">
        Yours
      </h2>
      <Card>
        <CardHeader>
          <h3 className="text-lg font-medium">{household.name}</h3>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {household.memberCount === 1
              ? "1 member"
              : `${household.memberCount} members`}
          </p>
          <Link
            href={`/o/${slug}/directory`}
            className="inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            View directory →
          </Link>
        </CardContent>
      </Card>
    </section>
  );
}
