import { notFound } from "next/navigation";
import { OrgAccessError } from "@/lib/authz";
import { readCommission, readCommissionFormOptions } from "@/lib/committees/reads";
import { isUuid } from "@/lib/is-uuid";
import { gateCommitteesPage } from "@/lib/presbytery-reports/gate";
import { backTo, COMMISSIONS } from "@/lib/committees/ui-copy";
import { CommissionForm } from "@/components/committees/commission-form";
import { CommitteesForbidden, CommitteesLoadError } from "@/components/committees/committee-states";
import { FormPageFrame } from "@/components/committees/form-page-frame";
import { CommitteeGateStateView } from "../../../committee-gate-state";

/**
 * `/o/<slug>/admin/committees/commissions/<commissionId>/edit`. An ended record may
 * still be corrected (the guard freezes only the end and removal fields), so this page
 * does not refuse one. The id is checked as a UUID before any read; a removed, foreign
 * or wrong-kind record is a 404.
 */
export default async function EditCommissionPage({ params }: { params: Promise<{ slug: string; commissionId: string }> }) {
  const { slug, commissionId } = await params;
  const path = `/o/${slug}/admin/committees/commissions/${commissionId}`;

  const gate = await gateCommitteesPage({ slug, path: `${path}/edit` });
  if (!gate.ok) return <CommitteeGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;
  if (!isUuid(commissionId)) notFound();

  let record;
  let options;
  try {
    [record, options] = await Promise.all([readCommission(identity, commissionId), readCommissionFormOptions(identity)]);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <CommitteesLoadError href={`${path}/edit`} />;
  }
  if (record.kind === "forbidden" || options.kind === "forbidden") return <CommitteesForbidden name={identity.organizationName} />;
  if (record.kind === "not_found") notFound();
  if (record.kind !== "ok" || options.kind !== "ok") return <CommitteesLoadError href={`${path}/edit`} />;

  const { commission } = record.data;
  return (
    <FormPageFrame backHref={path} backLabel={backTo(commission.title)} title={COMMISSIONS.editTitle} presbyteryName={identity.organizationName}>
      <CommissionForm slug={slug} congregations={options.data.congregations} today={options.data.today} commission={commission} />
    </FormPageFrame>
  );
}
