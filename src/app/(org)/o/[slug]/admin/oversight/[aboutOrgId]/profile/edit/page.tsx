import { FormPageFrame } from "@/components/oversight/form-page-frame";
import { LockedPage } from "@/components/oversight/locked-page";
import { readFormEnv, readProfile } from "@/lib/oversight/reads";
import { gateOversightPage } from "@/lib/presbytery-reports/gate";
import { notFound } from "next/navigation";
import { OversightGateStateView } from "../../../oversight-gate-state";
import { OversightLoadError } from "../../../oversight-states";
import { openRecord, settle } from "../../../record-front-door";
import { ProfileForm } from "./profile-form";

/** `.../oversight/<aboutOrgId>/profile/edit`: add or edit the presbytery's profile of one congregation (manage). */
export default async function ProfileEditPage({ params }: { params: Promise<{ slug: string; aboutOrgId: string }> }) {
  const { slug, aboutOrgId } = await params;

  const gate = await gateOversightPage({ slug, path: `/o/${slug}/admin/oversight/${aboutOrgId}/profile/edit` });
  if (!gate.ok) return <OversightGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  const opened = await openRecord(identity, slug, [aboutOrgId]);
  if (!opened.ok) return opened.view;
  const recordHref = `/o/${slug}/admin/oversight/${aboutOrgId}`;
  const back = `Back to ${opened.congregation.name}`;

  const settled = await settle(Promise.all([readProfile(identity, aboutOrgId), readFormEnv(identity)]));
  if (!settled.ok) return <OversightLoadError slug={slug} />;
  const [read, env] = settled.value;
  if (read.kind === "forbidden") return <LockedPage title="Edit profile" need="manage" backHref={recordHref} backLabel={back} />;
  if (read.kind === "not_found") notFound();

  return (
    <FormPageFrame backHref={recordHref} backLabel={back} title="Edit profile" presbyteryName={identity.organizationName}>
      <ProfileForm slug={slug} aboutOrgId={aboutOrgId} profile={read.data.profile} env={env} />
    </FormPageFrame>
  );
}
