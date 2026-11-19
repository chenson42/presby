import { OrgAccessError } from "@/lib/authz";
import { readCommitteeFormDefaults } from "@/lib/committees/reads";
import { gateCommitteesPage } from "@/lib/presbytery-reports/gate";
import { BACK_TO_COMMITTEES, FORM } from "@/lib/committees/ui-copy";
import { CommitteeForm } from "@/components/committees/committee-form";
import { CommitteesForbidden, CommitteesLoadError } from "@/components/committees/committee-states";
import { FormPageFrame } from "@/components/committees/form-page-frame";
import { CommitteeGateStateView } from "../committee-gate-state";

/**
 * `/o/<slug>/admin/committees/new`: the create form. The gate runs first, then the
 * form-defaults reader (its only job here is the key check inside its own
 * transaction: nobody without `groups.manage` is shown the form).
 */
export default async function NewCommitteePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const base = `/o/${slug}/admin/committees`;

  const gate = await gateCommitteesPage({ slug, path: `${base}/new` });
  if (!gate.ok) return <CommitteeGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  let result;
  try {
    result = await readCommitteeFormDefaults(identity);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <CommitteesLoadError href={`${base}/new`} />;
  }
  if (result.kind === "forbidden") return <CommitteesForbidden name={identity.organizationName} />;
  if (result.kind !== "ok") return <CommitteesLoadError href={`${base}/new`} />;

  return (
    <FormPageFrame backHref={base} backLabel={BACK_TO_COMMITTEES} title={FORM.newTitle} presbyteryName={identity.organizationName}>
      <CommitteeForm slug={slug} />
    </FormPageFrame>
  );
}
