import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { OrgAccessError } from "@/lib/authz";
import { REFUSAL } from "@/lib/committees/copy";
import { readCommissionMemberFormOptions } from "@/lib/committees/reads";
import { isUuid } from "@/lib/is-uuid";
import { gateCommitteesPage } from "@/lib/presbytery-reports/gate";
import { ADD, AREA, backTo, BACK_TO_COMMITTEES, COMMISSION_MEMBER } from "@/lib/committees/ui-copy";
import { CommissionMemberForm } from "@/components/committees/commission-member-form";
import { CommitteesForbidden, CommitteesLoadError, FormUnavailable, GuidedEmpty } from "@/components/committees/committee-states";
import { FormPageFrame } from "@/components/committees/form-page-frame";
import { TitlesNote } from "@/components/committees/titles-note";
import { CommitteeGateStateView } from "../../../../committee-gate-state";

/**
 * `/o/<slug>/admin/committees/commissions/<commissionId>/members/new`: add a member to
 * a commission record. An ended record renders its own sentence instead of a form; when
 * no one is selectable the guided empty state replaces the form and says where to add
 * people.
 */
export default async function AddCommissionMemberPage({ params }: { params: Promise<{ slug: string; commissionId: string }> }) {
  const { slug, commissionId } = await params;
  const path = `/o/${slug}/admin/committees/commissions/${commissionId}`;

  const gate = await gateCommitteesPage({ slug, path: `${path}/members/new` });
  if (!gate.ok) return <CommitteeGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;
  if (!isUuid(commissionId)) notFound();

  let result;
  try {
    result = await readCommissionMemberFormOptions(identity, commissionId);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <CommitteesLoadError href={`${path}/members/new`} />;
  }
  if (result.kind === "forbidden") return <CommitteesForbidden name={identity.organizationName} />;
  if (result.kind === "not_found") notFound();
  if (result.kind === "commission_ended") {
    return (
      <FormUnavailable
        title={AREA}
        message={REFUSAL.commission_ended}
        backHref={`/o/${slug}/admin/committees`}
        backLabel={BACK_TO_COMMITTEES}
      />
    );
  }
  if (result.kind !== "ok") return <CommitteesLoadError href={`${path}/members/new`} />;

  const { commissionTitle, people, today } = result.data;
  const selectable = people.filter((p) => !p.alreadyServes).length;

  return (
    <FormPageFrame backHref={path} backLabel={backTo(commissionTitle)} title={ADD.title(commissionTitle)} presbyteryName={identity.organizationName}>
      <TitlesNote />
      {selectable === 0 ? (
        <GuidedEmpty title={ADD.emptyTitle}>
          <p>{COMMISSION_MEMBER.emptyBody(identity.organizationName)}</p>
          <Button asChild variant="outline" className="mt-4 min-h-11">
            <Link href={path}>{backTo(commissionTitle)}</Link>
          </Button>
        </GuidedEmpty>
      ) : (
        <CommissionMemberForm slug={slug} commissionId={commissionId} people={people} today={today} />
      )}
    </FormPageFrame>
  );
}
