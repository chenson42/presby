import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { OrgAccessError } from "@/lib/authz";
import { COMMITTEE_DISSOLVED_ADD } from "@/lib/committees/copy";
import { readSeatFormOptions } from "@/lib/committees/reads";
import { isUuid } from "@/lib/is-uuid";
import { gateCommitteesPage } from "@/lib/presbytery-reports/gate";
import { ADD, BACK_TO_COMMITTEES, backTo } from "@/lib/committees/ui-copy";
import { AddMemberForm } from "@/components/committees/add-member-form";
import { CarriesRoleNote } from "@/components/committees/carries-role-note";
import { CommitteesForbidden, CommitteesLoadError, FormUnavailable, GuidedEmpty } from "@/components/committees/committee-states";
import { FormPageFrame } from "@/components/committees/form-page-frame";
import { TitlesNote } from "@/components/committees/titles-note";
import { CommitteeGateStateView } from "../../../committee-gate-state";

/**
 * `/o/<slug>/admin/committees/<committeeId>/members/new`: add a member. When no one
 * is selectable (no current member of the presbytery, or every one already serves)
 * the guided empty state replaces the form and says where to add people.
 */
export default async function AddMemberPage({ params }: { params: Promise<{ slug: string; committeeId: string }> }) {
  const { slug, committeeId } = await params;
  const path = `/o/${slug}/admin/committees/${committeeId}`;

  const gate = await gateCommitteesPage({ slug, path: `${path}/members/new` });
  if (!gate.ok) return <CommitteeGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;
  if (!isUuid(committeeId)) notFound();

  let result;
  try {
    result = await readSeatFormOptions(identity, committeeId);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <CommitteesLoadError href={`${path}/members/new`} />;
  }
  if (result.kind === "forbidden") return <CommitteesForbidden name={identity.organizationName} />;
  if (result.kind === "not_found") notFound();
  if (result.kind === "committee_dissolved") {
    return (
      <FormUnavailable
        title="Committees & Commissions"
        message={COMMITTEE_DISSOLVED_ADD}
        backHref={`/o/${slug}/admin/committees`}
        backLabel={BACK_TO_COMMITTEES}
      />
    );
  }
  if (result.kind !== "ok") return <CommitteesLoadError href={`${path}/members/new`} />;

  const { committeeName, people, carriedRoles, today } = result.data;
  const selectable = people.filter((p) => !p.alreadyServes).length;

  return (
    <FormPageFrame backHref={path} backLabel={backTo(committeeName)} title={ADD.title(committeeName)} presbyteryName={identity.organizationName}>
      <TitlesNote />
      <CarriesRoleNote roleNames={carriedRoles.map((r) => r.name)} variant="warning" />
      {selectable === 0 ? (
        <GuidedEmpty title={ADD.emptyTitle}>
          <p>{ADD.emptyBody(identity.organizationName)}</p>
          <Button asChild variant="outline" className="mt-4 min-h-11">
            <Link href={path}>{backTo(committeeName)}</Link>
          </Button>
        </GuidedEmpty>
      ) : (
        <AddMemberForm slug={slug} committeeId={committeeId} people={people} today={today} />
      )}
    </FormPageFrame>
  );
}
