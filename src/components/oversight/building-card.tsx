import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buildingSummary, formatBuildingType } from "@/lib/oversight/derive";
import type { BuildingRow } from "@/lib/oversight/reads";
import { ImportedNote } from "./imported-note";

/** One building on the record page: name, type, the Primary and Retired badges, the recorded basics, and an "Open" link. */
export function BuildingCard({
  slug,
  aboutOrgId,
  building,
}: {
  slug: string;
  aboutOrgId: string;
  building: BuildingRow;
}) {
  const summary = buildingSummary(building);
  return (
    <li className="rounded-md border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 break-words text-base font-medium">{building.name}</h3>
        <Badge variant="secondary">{formatBuildingType(building.buildingType)}</Badge>
        {building.isPrimary ? <Badge>Primary</Badge> : null}
        {building.retiredOn !== null ? <Badge variant="outline">Retired</Badge> : null}
      </div>
      {summary.length > 0 ? <p className="mt-1 text-sm text-muted-foreground">{summary.join(" · ")}</p> : null}
      <ImportedNote provenance={building.provenance} />
      <Link
        href={`/o/${slug}/admin/oversight/${aboutOrgId}/buildings/${building.id}`}
        className="mt-2 inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Open <span className="sr-only">{building.name}</span>
      </Link>
    </li>
  );
}
