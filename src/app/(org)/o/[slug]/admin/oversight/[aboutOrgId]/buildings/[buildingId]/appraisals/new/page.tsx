import { notFound } from "next/navigation";
import { FormPageFrame } from "@/components/oversight/form-page-frame";
import { LockedPage } from "@/components/oversight/locked-page";
import { readAppraisals, readBuilding, readFormEnv } from "@/lib/oversight/reads";
import { gateOversightPage } from "@/lib/presbytery-reports/gate";
import { OversightGateStateView } from "../../../../../oversight-gate-state";
import { OversightLoadError } from "../../../../../oversight-states";
import { openRecord, settle } from "../../../../../record-front-door";
import { AppraisalForm } from "../appraisal-form";

/**
 * `.../oversight/<aboutOrgId>/buildings/<buildingId>/appraisals/new`: "Record an
 * appraisal" (finance, on a building the viewer can open, which is manage). Both
 * keys are read live inside their own readers.
 */
export default async function NewAppraisalPage({
  params,
}: {
  params: Promise<{ slug: string; aboutOrgId: string; buildingId: string }>;
}) {
  const { slug, aboutOrgId, buildingId } = await params;

  const gate = await gateOversightPage({
    slug,
    path: `/o/${slug}/admin/oversight/${aboutOrgId}/buildings/${buildingId}/appraisals/new`,
  });
  if (!gate.ok) return <OversightGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  const opened = await openRecord(identity, slug, [aboutOrgId, buildingId]);
  if (!opened.ok) return opened.view;
  const recordHref = `/o/${slug}/admin/oversight/${aboutOrgId}`;
  const back = `Back to ${opened.congregation.name}`;

  const settled = await settle(
    Promise.all([readAppraisals(identity, aboutOrgId, buildingId), readBuilding(identity, aboutOrgId, buildingId), readFormEnv(identity)]),
  );
  if (!settled.ok) return <OversightLoadError slug={slug} />;
  const [appraisals, building, env] = settled.value;
  if (appraisals.kind === "forbidden") return <LockedPage title="Record an appraisal" need="finance" backHref={recordHref} backLabel={back} />;
  if (building.kind === "forbidden") return <LockedPage title="Record an appraisal" need="manage" backHref={recordHref} backLabel={back} />;
  if (appraisals.kind === "not_found" || building.kind === "not_found") notFound();

  return (
    <FormPageFrame
      backHref={`${recordHref}/buildings/${buildingId}`}
      backLabel={`Back to ${building.data.name}`}
      title="Record an appraisal"
      presbyteryName={identity.organizationName}
    >
      <AppraisalForm slug={slug} aboutOrgId={aboutOrgId} buildingId={buildingId} env={env} />
    </FormPageFrame>
  );
}
