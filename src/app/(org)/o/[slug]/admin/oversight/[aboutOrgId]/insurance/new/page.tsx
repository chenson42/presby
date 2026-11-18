import { FormPageFrame } from "@/components/oversight/form-page-frame";
import { LockedPage } from "@/components/oversight/locked-page";
import { readFormEnv } from "@/lib/oversight/reads";
import { gateOversightPage } from "@/lib/presbytery-reports/gate";
import { OversightGateStateView } from "../../../oversight-gate-state";
import { OversightLoadError } from "../../../oversight-states";
import { openRecord, settle } from "../../../record-front-door";
import { InsuranceForm } from "../insurance-form";

/** `.../oversight/<aboutOrgId>/insurance/new`: "Record insurance for a year" (finance). */
export default async function NewInsurancePage({ params }: { params: Promise<{ slug: string; aboutOrgId: string }> }) {
  const { slug, aboutOrgId } = await params;

  const gate = await gateOversightPage({ slug, path: `/o/${slug}/admin/oversight/${aboutOrgId}/insurance/new` });
  if (!gate.ok) return <OversightGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  const opened = await openRecord(identity, slug, [aboutOrgId]);
  if (!opened.ok) return opened.view;
  const recordHref = `/o/${slug}/admin/oversight/${aboutOrgId}`;
  const back = `Back to ${opened.congregation.name}`;
  if (!opened.finance) return <LockedPage title="Record insurance for a year" need="finance" backHref={recordHref} backLabel={back} />;

  const env = await settle(readFormEnv(identity));
  if (!env.ok) return <OversightLoadError slug={slug} />;

  return (
    <FormPageFrame backHref={recordHref} backLabel={back} title="Record insurance for a year" presbyteryName={identity.organizationName}>
      <InsuranceForm slug={slug} aboutOrgId={aboutOrgId} env={env.value} year={null} />
    </FormPageFrame>
  );
}
