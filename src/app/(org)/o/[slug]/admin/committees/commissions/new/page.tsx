import { OrgAccessError } from "@/lib/authz";
import { readCommissionFormOptions } from "@/lib/committees/reads";
import { gateCommitteesPage } from "@/lib/presbytery-reports/gate";
import { BACK_TO_COMMITTEES } from "@/lib/committees/ui-copy";
import { COMMISSIONS } from "@/lib/committees/ui-copy";
import { CommissionForm } from "@/components/committees/commission-form";
import { CommitteesForbidden, CommitteesLoadError } from "@/components/committees/committee-states";
import { FormPageFrame } from "@/components/committees/form-page-frame";
import { CommitteeGateStateView } from "../../committee-gate-state";

/**
 * `/o/<slug>/admin/committees/commissions/new`: record a commission. The gate runs
 * first, then the form-options reader (this presbytery's member congregations and the
 * organization's local day; its first job is the key check inside its own transaction:
 * nobody without `groups.manage` is shown the form).
 */
export default async function NewCommissionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const base = `/o/${slug}/admin/committees`;
  const path = `${base}/commissions/new`;

  const gate = await gateCommitteesPage({ slug, path });
  if (!gate.ok) return <CommitteeGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  let result;
  try {
    result = await readCommissionFormOptions(identity);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <CommitteesLoadError href={path} />;
  }
  if (result.kind === "forbidden") return <CommitteesForbidden name={identity.organizationName} />;
  if (result.kind !== "ok") return <CommitteesLoadError href={path} />;

  return (
    <FormPageFrame backHref={base} backLabel={BACK_TO_COMMITTEES} title={COMMISSIONS.newTitle} presbyteryName={identity.organizationName}>
      <CommissionForm slug={slug} congregations={result.data.congregations} today={result.data.today} />
    </FormPageFrame>
  );
}
