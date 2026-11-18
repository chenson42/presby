import { notFound } from "next/navigation";
import { FormPageFrame } from "@/components/oversight/form-page-frame";
import { LockedPage } from "@/components/oversight/locked-page";
import { readBuilding, readFormEnv } from "@/lib/oversight/reads";
import { gateOversightPage } from "@/lib/presbytery-reports/gate";
import { OversightGateStateView } from "../../../../oversight-gate-state";
import { OversightLoadError } from "../../../../oversight-states";
import { openRecord, settle } from "../../../../record-front-door";
import { BuildingForm } from "../../building-form";

/** `.../oversight/<aboutOrgId>/buildings/<buildingId>/edit`: "Edit building" (manage). */
export default async function EditBuildingPage({
  params,
}: {
  params: Promise<{ slug: string; aboutOrgId: string; buildingId: string }>;
}) {
  const { slug, aboutOrgId, buildingId } = await params;

  const gate = await gateOversightPage({ slug, path: `/o/${slug}/admin/oversight/${aboutOrgId}/buildings/${buildingId}/edit` });
  if (!gate.ok) return <OversightGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  const opened = await openRecord(identity, slug, [aboutOrgId, buildingId]);
  if (!opened.ok) return opened.view;
  const recordHref = `/o/${slug}/admin/oversight/${aboutOrgId}`;
  const back = `Back to ${opened.congregation.name}`;

  const settled = await settle(Promise.all([readBuilding(identity, aboutOrgId, buildingId), readFormEnv(identity)]));
  if (!settled.ok) return <OversightLoadError slug={slug} />;
  const [read, env] = settled.value;
  if (read.kind === "forbidden") return <LockedPage title="Edit building" need="manage" backHref={recordHref} backLabel={back} />;
  if (read.kind === "not_found") notFound();

  return (
    <FormPageFrame backHref={`${recordHref}/buildings/${buildingId}`} backLabel={`Back to ${read.data.name}`} title="Edit building" presbyteryName={identity.organizationName}>
      <BuildingForm slug={slug} aboutOrgId={aboutOrgId} env={env} building={read.data} />
    </FormPageFrame>
  );
}
