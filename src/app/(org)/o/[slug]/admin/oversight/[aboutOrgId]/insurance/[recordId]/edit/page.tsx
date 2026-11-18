import { notFound } from "next/navigation";
import { FormPageFrame } from "@/components/oversight/form-page-frame";
import { LockedPage } from "@/components/oversight/locked-page";
import { readFormEnv, readInsuranceYear } from "@/lib/oversight/reads";
import { gateOversightPage } from "@/lib/presbytery-reports/gate";
import { OversightGateStateView } from "../../../../oversight-gate-state";
import { OversightLoadError } from "../../../../oversight-states";
import { openRecord, settle } from "../../../../record-front-door";
import { InsuranceForm } from "../../insurance-form";

/** `.../oversight/<aboutOrgId>/insurance/<recordId>/edit`: "Edit insurance for {year}" (finance). */
export default async function EditInsurancePage({
  params,
}: {
  params: Promise<{ slug: string; aboutOrgId: string; recordId: string }>;
}) {
  const { slug, aboutOrgId, recordId } = await params;

  const gate = await gateOversightPage({ slug, path: `/o/${slug}/admin/oversight/${aboutOrgId}/insurance/${recordId}/edit` });
  if (!gate.ok) return <OversightGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  const opened = await openRecord(identity, slug, [aboutOrgId, recordId]);
  if (!opened.ok) return opened.view;
  const recordHref = `/o/${slug}/admin/oversight/${aboutOrgId}`;
  const back = `Back to ${opened.congregation.name}`;

  const settled = await settle(Promise.all([readInsuranceYear(identity, aboutOrgId, recordId), readFormEnv(identity)]));
  if (!settled.ok) return <OversightLoadError slug={slug} />;
  const [read, env] = settled.value;
  if (read.kind === "forbidden") return <LockedPage title="Edit insurance" need="finance" backHref={recordHref} backLabel={back} />;
  if (read.kind === "not_found") notFound();

  return (
    <FormPageFrame
      backHref={recordHref}
      backLabel={back}
      title={`Edit insurance for ${read.data.policyYear}`}
      presbyteryName={identity.organizationName}
    >
      <InsuranceForm slug={slug} aboutOrgId={aboutOrgId} env={env} year={read.data} />
    </FormPageFrame>
  );
}
