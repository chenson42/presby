import { notFound } from "next/navigation";
import { OrgAccessError } from "@/lib/authz";
import { COMMITTEE_DISSOLVED_EDIT } from "@/lib/committees/copy";
import { readCommitteeFormDefaults } from "@/lib/committees/reads";
import { isUuid } from "@/lib/is-uuid";
import { gateCommitteesPage } from "@/lib/presbytery-reports/gate";
import { BACK_TO_COMMITTEES, backTo, FORM } from "@/lib/committees/ui-copy";
import { CommitteeForm } from "@/components/committees/committee-form";
import { CommitteesForbidden, CommitteesLoadError, FormUnavailable } from "@/components/committees/committee-states";
import { FormPageFrame } from "@/components/committees/form-page-frame";
import { CommitteeGateStateView } from "../../committee-gate-state";

/**
 * `/o/<slug>/admin/committees/<committeeId>/edit`. A dissolved committee renders the
 * C4 state instead of the form (browser back after a dissolve lands here).
 */
export default async function EditCommitteePage({ params }: { params: Promise<{ slug: string; committeeId: string }> }) {
  const { slug, committeeId } = await params;
  const path = `/o/${slug}/admin/committees/${committeeId}`;

  const gate = await gateCommitteesPage({ slug, path: `${path}/edit` });
  if (!gate.ok) return <CommitteeGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;
  if (!isUuid(committeeId)) notFound();

  let result;
  try {
    result = await readCommitteeFormDefaults(identity, committeeId);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <CommitteesLoadError href={`${path}/edit`} />;
  }
  if (result.kind === "forbidden") return <CommitteesForbidden name={identity.organizationName} />;
  if (result.kind === "not_found") notFound();
  if (result.kind === "committee_dissolved") {
    return (
      <FormUnavailable
        title="Committees & Commissions"
        message={COMMITTEE_DISSOLVED_EDIT}
        backHref={`/o/${slug}/admin/committees`}
        backLabel={BACK_TO_COMMITTEES}
      />
    );
  }
  if (result.kind !== "ok" || !result.data.committee) return <CommitteesLoadError href={`${path}/edit`} />;
  const committee = result.data.committee;

  return (
    <FormPageFrame backHref={path} backLabel={backTo(committee.name)} title={FORM.editTitle(committee.name)} presbyteryName={identity.organizationName}>
      <CommitteeForm slug={slug} committee={committee} />
    </FormPageFrame>
  );
}
