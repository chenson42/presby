import { notFound } from "next/navigation";
import { FormPageFrame } from "@/components/oversight/form-page-frame";
import { LockedPage } from "@/components/oversight/locked-page";
import { readFormEnv, readLoan } from "@/lib/oversight/reads";
import { gateOversightPage } from "@/lib/presbytery-reports/gate";
import { OversightGateStateView } from "../../../../oversight-gate-state";
import { OversightLoadError } from "../../../../oversight-states";
import { openRecord, settle } from "../../../../record-front-door";
import { LoanForm } from "../../loan-form";

/** `.../oversight/<aboutOrgId>/loans/<loanId>/edit`: "Edit loan" (finance). */
export default async function EditLoanPage({
  params,
}: {
  params: Promise<{ slug: string; aboutOrgId: string; loanId: string }>;
}) {
  const { slug, aboutOrgId, loanId } = await params;

  const gate = await gateOversightPage({ slug, path: `/o/${slug}/admin/oversight/${aboutOrgId}/loans/${loanId}/edit` });
  if (!gate.ok) return <OversightGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  const opened = await openRecord(identity, slug, [aboutOrgId, loanId]);
  if (!opened.ok) return opened.view;
  const recordHref = `/o/${slug}/admin/oversight/${aboutOrgId}`;
  const back = `Back to ${opened.congregation.name}`;

  const settled = await settle(Promise.all([readLoan(identity, aboutOrgId, loanId), readFormEnv(identity)]));
  if (!settled.ok) return <OversightLoadError slug={slug} />;
  const [read, env] = settled.value;
  if (read.kind === "forbidden") return <LockedPage title="Edit loan" need="finance" backHref={recordHref} backLabel={back} />;
  if (read.kind === "not_found") notFound();

  return (
    <FormPageFrame backHref={recordHref} backLabel={back} title="Edit loan" presbyteryName={identity.organizationName}>
      <LoanForm slug={slug} aboutOrgId={aboutOrgId} env={env} loan={read.data} />
    </FormPageFrame>
  );
}
