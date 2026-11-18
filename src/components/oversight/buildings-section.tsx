import Link from "next/link";
import { Button } from "@/components/ui/button";
import { STATE } from "@/lib/oversight/copy";
import type { BuildingCoverView } from "@/lib/oversight/photo-reads";
import type { BuildingsData } from "@/lib/oversight/reads";
import { BuildingCard } from "./building-card";
import { LockedSection } from "./locked-section";
import { SectionFrame } from "./section-frame";
import { SectionLoadError } from "./section-load-error";
import type { SectionState } from "./section-state";

/** The Buildings section (C5): one card per live building (retired ones badged), "Add a building", or "No buildings are recorded for this congregation." */
export function BuildingsSection({
  slug,
  aboutOrgId,
  state,
  covers = {},
}: {
  slug: string;
  aboutOrgId: string;
  state: SectionState<BuildingsData>;
  /** Each building's cover, by building id; a building with no photo is absent. */
  covers?: Record<string, BuildingCoverView>;
}) {
  const recordHref = `/o/${slug}/admin/oversight/${aboutOrgId}`;
  const action =
    state.kind === "ok" ? (
      <Button asChild variant="outline" className="min-h-11">
        <Link href={`${recordHref}/buildings/new`}>Add a building</Link>
      </Button>
    ) : undefined;
  return (
    <SectionFrame id="buildings" title="Buildings" action={action}>
      {state.kind === "locked" ? <LockedSection need="manage" /> : null}
      {state.kind === "error" ? <SectionLoadError href={recordHref} /> : null}
      {state.kind === "ok" && state.data.buildings.length === 0 ? (
        <p className="text-sm text-muted-foreground">{STATE.emptyBuildings}</p>
      ) : null}
      {state.kind === "ok" && state.data.buildings.length > 0 ? (
        <ul className="space-y-3">
          {state.data.buildings.map((building) => (
            <BuildingCard key={building.id} slug={slug} aboutOrgId={aboutOrgId} building={building} cover={covers[building.id]} />
          ))}
        </ul>
      ) : null}
    </SectionFrame>
  );
}
