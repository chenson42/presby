import Link from "next/link";
import { ChevronRight, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { HouseholdSummary } from "@/lib/directory";

/**
 * One household's card in the households view. Household name, city/state,
 * and a member-count badge — `deaconName` is always `null` until Increment
 * 4 lands the deacon↔care-unit derivation; the slot is left here (rendered
 * only when non-null) so that increment is a pure addition, not a rewrite
 * of this component.
 *
 * CARD HOVER TREATMENT (docs/work-log/2026-08-26-portal-fpcw-directory-ux.md
 * Phase 3, Increment 1): `hover:shadow-md transition-shadow` on the outer
 * `<Card>` — shadow-lift only, no `cursor-pointer`, for the same reason
 * `PersonCard` withholds it: this card holds a name `<Link>` alongside
 * inert text (city/state, member-count badge), not one whole clickable
 * surface (Phase 3 Edge Cases, DECISION-099).
 *
 * CHEVRON AFFORDANCE (docs/work-log/2026-08-26-portal-ux-fixes.md, Wave 1B,
 * finding L1) — see `PersonCard`'s matching comment; same `group`/
 * `group-hover:translate-x-0.5` pattern, scoped to the name `<Link>` only.
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
    <Card className="py-4 transition-shadow hover:shadow-md">
      <CardContent>
        <Link
          href={`/o/${slug}/directory/households/${household.householdId}`}
          className="group flex items-center gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <h3 className="min-w-0 break-words text-lg font-medium hover:underline">
            {household.name}
          </h3>
          <ChevronRight
            className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </Link>
        {cityState && (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="size-3 shrink-0" aria-hidden />
            {cityState}
          </p>
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
