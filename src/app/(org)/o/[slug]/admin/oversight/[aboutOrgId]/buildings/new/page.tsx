import { FormPageFrame } from "@/components/oversight/form-page-frame";
import { LockedPage } from "@/components/oversight/locked-page";
import { readFormEnv } from "@/lib/oversight/reads";
import { gateOversightPage } from "@/lib/presbytery-reports/gate";
import { OversightGateStateView } from "../../../oversight-gate-state";
import { OversightLoadError } from "../../../oversight-states";
import { openRecord, settle } from "../../../record-front-door";
import { BuildingForm } from "../building-form";

/** `.../oversight/<aboutOrgId>/buildings/new`: "Add a building" (manage). The key is the front door's live read. */
export default async function NewBuildingPage({ params }: { params: Promise<{ slug: string; aboutOrgId: string }> }) {
  const { slug, aboutOrgId } = await params;

  const gate = await gateOversightPage({ slug, path: `/o/${slug}/admin/oversight/${aboutOrgId}/buildings/new` });
  if (!gate.ok) return <OversightGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  const opened = await openRecord(identity, slug, [aboutOrgId]);
  if (!opened.ok) return opened.view;
  const recordHref = `/o/${slug}/admin/oversight/${aboutOrgId}`;
  const back = `Back to ${opened.congregation.name}`;
  if (!opened.manage) return <LockedPage title="Add a building" need="manage" backHref={recordHref} backLabel={back} />;

  const env = await settle(readFormEnv(identity));
  if (!env.ok) return <OversightLoadError slug={slug} />;

  return (
    <FormPageFrame backHref={recordHref} backLabel={back} title="Add a building" presbyteryName={identity.organizationName}>
      <BuildingForm slug={slug} aboutOrgId={aboutOrgId} env={env.value} building={null} />
    </FormPageFrame>
  );
}
