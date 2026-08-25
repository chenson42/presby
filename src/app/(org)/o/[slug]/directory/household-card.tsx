import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { HouseholdSummary } from "@/lib/directory";

/**
 * One household's card in the households view. Household name, city/state,
 * and a member-count badge — `deaconName` is always `null` until Increment
 * 4 lands the deacon↔care-unit derivation; the slot is left here (rendered
 * only when non-null) so that increment is a pure addition, not a rewrite
 * of this component.
 */
export function HouseholdCard({
  household,
  slug,
}: {
  household: HouseholdSummary;
  slug: string;
}) {
  const cityState = [household.city, household.region]
    .filter((part): part is string => Boolean(part))
    .join(", ");

  return (
    <Card className="py-4">
      <CardContent>
        <Link
          href={`/o/${slug}/directory/households/${household.householdId}`}
          className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <h3 className="text-lg font-medium break-words hover:underline">
            {household.name}
          </h3>
        </Link>
        {cityState && (
          <p className="mt-1 text-sm text-muted-foreground">{cityState}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {household.memberCount}{" "}
            {household.memberCount === 1 ? "member" : "members"}
          </Badge>
          {/* Increment 4: a deacon badge/line renders here once
              `household.deaconName` is populated. */}
          {household.deaconName && (
            <Badge variant="outline">Deacon: {household.deaconName}</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
