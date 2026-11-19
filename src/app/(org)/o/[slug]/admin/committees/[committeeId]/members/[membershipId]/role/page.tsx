import { notFound } from "next/navigation";
import { OrgAccessError } from "@/lib/authz";
import { REFUSAL, roleLabel } from "@/lib/committees/copy";
import { classifySeat } from "@/lib/committees/derive";
import { readSeat } from "@/lib/committees/reads";
import { isUuid } from "@/lib/is-uuid";
import { gateCommitteesPage } from "@/lib/presbytery-reports/gate";
import { AREA, backTo, CHANGE } from "@/lib/committees/ui-copy";
import { FormattedDate } from "@/components/shared/formatted-date";
import { ChangeRoleForm } from "@/components/committees/change-role-form";
import { CommitteesForbidden, CommitteesLoadError, FormUnavailable } from "@/components/committees/committee-states";
import { FormPageFrame } from "@/components/committees/form-page-frame";
import { CommitteeGateStateView } from "../../../../committee-gate-state";

/**
 * `/o/<slug>/admin/committees/<committeeId>/members/<membershipId>/role`: change one
 * seat's role. Both ids are checked as UUIDs before any read; a seat that belongs to
 * another committee is the one `not_found`. A seat that has already ended cannot be
 * changed: the page says so (C6) instead of showing a form that would be refused.
 */
export default async function ChangeRolePage({
  params,
}: {
  params: Promise<{ slug: string; committeeId: string; membershipId: string }>;
}) {
  const { slug, committeeId, membershipId } = await params;
  const path = `/o/${slug}/admin/committees/${committeeId}`;

  const gate = await gateCommitteesPage({ slug, path: `${path}/members/${membershipId}/role` });
  if (!gate.ok) return <CommitteeGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;
  if (!isUuid(committeeId) || !isUuid(membershipId)) notFound();

  let result;
  try {
    result = await readSeat(identity, committeeId, membershipId);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <CommitteesLoadError href={`${path}/members/${membershipId}/role`} />;
  }
  if (result.kind === "forbidden") return <CommitteesForbidden name={identity.organizationName} />;
  if (result.kind === "not_found") notFound();
  if (result.kind !== "ok") return <CommitteesLoadError href={`${path}/members/${membershipId}/role`} />;

  const { committeeName, seat, today } = result.data;
  if (classifySeat(seat, today) === "past") {
    return <FormUnavailable title={AREA} message={REFUSAL.already_ended} backHref={path} backLabel={backTo(committeeName)} />;
  }

  return (
    <FormPageFrame
      backHref={path}
      backLabel={backTo(committeeName)}
      title={CHANGE.title(seat.displayName)}
      presbyteryName={identity.organizationName}
      subtitle={
        classifySeat(seat, today) === "planned" ? (
          <>
            {roleLabel(seat.role)}. Starts <FormattedDate value={seat.startsOn} mode="date" />.
          </>
        ) : (
          <>
            Now {roleLabel(seat.role)}, since <FormattedDate value={seat.startsOn} mode="date" />.
            {seat.endsOn ? (
              <>
                {" "}
                It ends <FormattedDate value={seat.endsOn} mode="date" />.
              </>
            ) : null}
          </>
        )
      }
    >
      <ChangeRoleForm slug={slug} committeeId={committeeId} seat={seat} today={today} />
    </FormPageFrame>
  );
}
