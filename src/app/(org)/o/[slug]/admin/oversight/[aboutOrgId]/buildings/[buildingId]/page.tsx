import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { FormattedDate } from "@/components/shared/formatted-date";
import { AppraisalsBlock } from "@/components/oversight/appraisals-block";
import { BackLink } from "@/components/oversight/back-link";
import { BuildingActions } from "@/components/oversight/building-actions";
import { FactList } from "@/components/oversight/fact-list";
import { ImportedNote } from "@/components/oversight/imported-note";
import { LockedPage } from "@/components/oversight/locked-page";
import type { SectionState } from "@/components/oversight/section-state";
import { additionsLabel, formatBuildingType, formatCondition, formatInteger, formatTriState } from "@/lib/oversight/derive";
import { readAppraisals, readBuilding, readFormEnv, type AppraisalsData, type BuildingRow } from "@/lib/oversight/reads";
import { gateOversightPage } from "@/lib/presbytery-reports/gate";
import { OversightGateStateView } from "../../../oversight-gate-state";
import { OversightLoadError } from "../../../oversight-states";
import { openRecord, settle } from "../../../record-front-door";

const RETIRED_LABELS: Record<NonNullable<BuildingRow["retiredReason"]>, string> = {
  sold: "Sold on",
  demolished: "Demolished on",
  closed: "Closed on",
  other: "Retired on",
};

/**
 * `.../oversight/<aboutOrgId>/buildings/<buildingId>`: one building's facts, its
 * controls (edit, retire or bring back into use, remove) and its Appraisals
 * block. The building is tier 1 (manage); the Appraisals block is tier 2 and is a
 * visible Locked card without the finance key. Removing a building returns to the
 * record page; this URL then 404s.
 */
export default async function BuildingPage({
  params,
}: {
  params: Promise<{ slug: string; aboutOrgId: string; buildingId: string }>;
}) {
  const { slug, aboutOrgId, buildingId } = await params;
  const pageHref = `/o/${slug}/admin/oversight/${aboutOrgId}/buildings/${buildingId}`;

  const gate = await gateOversightPage({ slug, path: pageHref });
  if (!gate.ok) return <OversightGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  const opened = await openRecord(identity, slug, [aboutOrgId, buildingId]);
  if (!opened.ok) return opened.view;
  const recordHref = `/o/${slug}/admin/oversight/${aboutOrgId}`;
  const back = `Back to ${opened.congregation.name}`;

  const [buildingRead, appraisalsRead, envRead] = await Promise.all([
    settle(readBuilding(identity, aboutOrgId, buildingId)),
    opened.finance ? settle(readAppraisals(identity, aboutOrgId, buildingId)) : null,
    settle(readFormEnv(identity)),
  ]);
  if (!buildingRead.ok || !envRead.ok) return <OversightLoadError slug={slug} />;
  if (buildingRead.value.kind === "forbidden") {
    return <LockedPage title={opened.congregation.name} need="manage" backHref={recordHref} backLabel={back} />;
  }
  if (buildingRead.value.kind === "not_found") notFound();
  const building = buildingRead.value.data;

  let appraisals: SectionState<AppraisalsData> = { kind: "locked" };
  if (appraisalsRead) {
    if (!appraisalsRead.ok) appraisals = { kind: "error" };
    else if (appraisalsRead.value.kind === "ok") appraisals = { kind: "ok", data: appraisalsRead.value.data };
    else if (appraisalsRead.value.kind === "not_found") notFound();
  }

  const retired = building.retiredOn !== null;
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <BackLink href={recordHref}>{back}</BackLink>
        <h1 className="mt-3 break-words text-2xl font-semibold">{building.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{identity.organizationName}&apos;s own oversight record for this congregation.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{formatBuildingType(building.buildingType)}</Badge>
          {building.isPrimary ? <Badge>Primary</Badge> : null}
          {retired ? <Badge variant="outline">Retired</Badge> : null}
        </div>
        {retired ? (
          <p className="mt-2 text-sm">
            {RETIRED_LABELS[building.retiredReason ?? "other"]} <FormattedDate value={building.retiredOn!} mode="date" />
          </p>
        ) : null}
      </div>

      <section aria-labelledby="building-facts-heading" className="space-y-4 rounded-lg border border-border p-4 sm:p-6">
        <h2 id="building-facts-heading" className="text-xl font-semibold">
          Details
        </h2>
        <FactList
          facts={[
            { label: "Type", value: formatBuildingType(building.buildingType) },
            { label: "Year built", value: building.yearBuilt === null ? null : String(building.yearBuilt) },
            { label: "Additions", value: additionsLabel(building.firstAdditionYear, building.secondAdditionYear) },
            { label: "Square feet", value: building.squareFeet === null ? null : formatInteger(building.squareFeet) },
            { label: "Roof", value: formatCondition(building.roofCondition) },
            { label: "Plumbing", value: formatCondition(building.plumbingCondition) },
            { label: "Heating and cooling (HVAC)", value: formatCondition(building.hvacCondition) },
            { label: "Boiler", value: formatCondition(building.boilerCondition) },
            { label: "Sprinklers", value: formatTriState(building.hasSprinklers) },
            { label: "Fire alarm", value: formatTriState(building.hasFireAlarm) },
            { label: "Security system", value: formatTriState(building.hasSecuritySystem) },
            { label: "Notes", value: building.notes },
          ]}
        />
        <ImportedNote provenance={building.provenance} />
        <BuildingActions
          slug={slug}
          aboutOrgId={aboutOrgId}
          buildingId={buildingId}
          buildingName={building.name}
          retired={retired}
          env={envRead.value}
        />
      </section>

      <AppraisalsBlock slug={slug} aboutOrgId={aboutOrgId} buildingId={buildingId} state={appraisals} pageHref={pageHref} />
    </div>
  );
}
