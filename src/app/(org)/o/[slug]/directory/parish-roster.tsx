import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ParishUnitEntry } from "@/lib/parishes";
import { AddDistrictForm } from "./parishes/add-district-form";
import { DistrictCardControls } from "./parishes/district-card-controls";
import { householdsLabel } from "./parishes/parish-copy";
import { SeatCallout } from "./parishes/parishes-states";

/**
 * The Parishes tab's districts, in two modes (docs/work-log/2026-10-25-parish-
 * management.md, Phase 3 "Component / Page Plan"):
 *
 * LEGACY (`managed` omitted - the org's `org_portal.parishes` toggle is off):
 * flat `bg-muted/40` information panels with no link, exactly as before
 * (portal UX review 2026-08-26, H4: they must not read as clickable while
 * there is nowhere honest to go). One panel per active unit - district name, its
 * deacon (or "Vacant") and how many households it holds. A SINGLE empty state:
 * zero units.
 *
 * MANAGED (`managed` given - the toggle is on): the same panels, but now there
 * IS a per-district page, so each links to it ("View households", for a viewer
 * who may list households), an archived district is labelled and listed apart,
 * a viewer who can define districts gets Add, Rename, Archive and Restore, the
 * households with no district are surfaced as a leading card, and a missing
 * Moderator seat is called out. Every count is the single household count
 * (`countHouseholdsByUnit`): every household in the district, not only those
 * with a directory-visible member (DECISION-244).
 *
 * Presentational and prop-driven. The controls are client islands; everything
 * else here is server-rendered.
 */
export interface ManagedParishesProps {
  slug: string;
  canDefine: boolean;
  canListHouseholds: boolean;
  archived: ParishUnitEntry[];
  /** Households in no district; `null` when the viewer may not list them. */
  unassignedCount: number | null;
  /** `null` unless the viewer can define districts. */
  seatFilled: boolean | null;
}

export function ParishRoster({
  parishes,
  orgName,
  managed,
}: {
  parishes: ParishUnitEntry[];
  orgName: string;
  managed?: ManagedParishesProps;
}) {
  if (!managed) {
    if (parishes.length === 0) {
      return (
        <p className="mt-6 rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          {orgName} has no districts or parishes set up yet.
        </p>
      );
    }
    return (
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {parishes.map((parish) => (
          <div
            key={parish.orgUnitId}
            className="rounded-lg border border-border bg-muted/40 p-4"
          >
            <h3 className="text-base font-semibold break-words">{parish.name}</h3>
            <DeaconLine name={parish.deaconName} />
            <div className="mt-2">
              <Badge variant="secondary">{householdsLabel(parish.householdCount)}</Badge>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const { slug, canDefine, canListHouseholds, archived, unassignedCount, seatFilled } = managed;

  return (
    <div className="mt-6 space-y-8">
      {canDefine && seatFilled === false ? <SeatCallout slug={slug} /> : null}

      {canListHouseholds && unassignedCount !== null && unassignedCount > 0 ? (
        <section
          aria-labelledby="no-district-heading"
          className="rounded-lg border border-border bg-muted/40 p-4"
          data-testid="no-district-card"
        >
          <h2 id="no-district-heading" className="text-base font-semibold">
            No district yet
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {unassignedCount} {unassignedCount === 1 ? "household isn't" : "households aren't"} in a
            district.
          </p>
          <Button asChild variant="outline" className="mt-3 min-h-11 w-full sm:w-auto">
            <Link href={`/o/${slug}/directory/parishes/unassigned`}>Review households</Link>
          </Button>
        </section>
      ) : null}

      <section aria-labelledby="districts-heading">
        <h2 id="districts-heading" className="text-lg font-semibold">
          Districts
        </h2>
        {canDefine ? (
          <div className="mt-3 rounded-lg border border-border p-4">
            <AddDistrictForm slug={slug} />
          </div>
        ) : null}
        {parishes.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
            {canDefine
              ? "No districts yet. Add your first district to start assigning households."
              : "No districts have been set up yet. Ask your congregation's administrator to add them."}
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {parishes.map((parish) => (
              <DistrictCard
                key={parish.orgUnitId}
                parish={parish}
                slug={slug}
                canDefine={canDefine}
                canListHouseholds={canListHouseholds}
              />
            ))}
          </div>
        )}
      </section>

      {archived.length > 0 ? (
        <section aria-labelledby="archived-heading">
          <h2 id="archived-heading" className="text-lg font-semibold">
            Archived districts
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {archived.map((parish) => (
              <DistrictCard
                key={parish.orgUnitId}
                parish={parish}
                slug={slug}
                canDefine={canDefine}
                canListHouseholds={canListHouseholds}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function DeaconLine({ name }: { name: string | null }) {
  return (
    <p className="mt-1 text-sm text-muted-foreground break-words">
      {name ? <>Deacon: {name}</> : <>Deacon: Vacant</>}
    </p>
  );
}

function DistrictCard({
  parish,
  slug,
  canDefine,
  canListHouseholds,
}: {
  parish: ParishUnitEntry;
  slug: string;
  canDefine: boolean;
  canListHouseholds: boolean;
}) {
  return (
    <div
      className="flex flex-col rounded-lg border border-border bg-muted/40 p-4"
      data-testid="district-card"
    >
      <h3 className="text-base font-semibold break-words">{parish.name}</h3>
      <DeaconLine name={parish.deaconName} />
      <div className="mt-2 flex flex-wrap gap-2">
        <Badge variant="secondary">{householdsLabel(parish.householdCount)}</Badge>
        {parish.archived ? <Badge variant="outline">Archived</Badge> : null}
      </div>
      {canListHouseholds ? (
        <Button asChild variant="outline" className="mt-3 min-h-11 w-full sm:w-auto">
          <Link
            href={`/o/${slug}/directory/parishes/${parish.orgUnitId}`}
            aria-label={`View households in ${parish.name}`}
          >
            View households
          </Link>
        </Button>
      ) : null}
      {canDefine ? (
        <div className="mt-2">
          <DistrictCardControls
            slug={slug}
            orgUnitId={parish.orgUnitId}
            name={parish.name}
            archived={parish.archived}
            householdCount={parish.householdCount}
            deaconName={parish.deaconName}
          />
        </div>
      ) : null}
    </div>
  );
}
