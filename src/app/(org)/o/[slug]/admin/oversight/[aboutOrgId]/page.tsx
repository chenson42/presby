import { HelpLink } from "@/components/help/help-link";
import { AssessmentSection } from "@/components/oversight/assessment-section";
import { BackLink } from "@/components/oversight/back-link";
import { BuildingsSection } from "@/components/oversight/buildings-section";
import { InsuranceSection } from "@/components/oversight/insurance-section";
import { LoansSection } from "@/components/oversight/loans-section";
import { ProfileSection } from "@/components/oversight/profile-section";
import type { SectionState } from "@/components/oversight/section-state";
import { helpHref } from "@/lib/help/urls";
import { STATE } from "@/lib/oversight/copy";
import { readBuildingCovers } from "@/lib/oversight/photo-reads";
import { readBuildings, readFormEnv, readInsuranceYears, readLoans, readProfile, type LoanRow } from "@/lib/oversight/reads";
import { getCongregationOversightDetail, type OversightRow } from "@/lib/presbytery";
import { gateOversightPage } from "@/lib/presbytery-reports/gate";
import { OversightGateStateView } from "../oversight-gate-state";
import { openRecord, settle } from "../record-front-door";

/** A reader's three answers as a section's state: its data, "Locked" (its key is not held), or a load error. */
function toState<T>(settled: { ok: true; value: { kind: "ok"; data: T } | { kind: "forbidden" } | { kind: "not_found" } } | { ok: false }): SectionState<T> {
  if (!settled.ok) return { kind: "error" };
  if (settled.value.kind === "ok") return { kind: "ok", data: settled.value.data };
  if (settled.value.kind === "forbidden") return { kind: "locked" };
  return { kind: "error" };
}

/**
 * `/o/<slug>/admin/oversight/<aboutOrgId>` — the record page: five sections
 * (Profile, Assessment, Buildings, Insurance, Loans) for one member congregation
 * (T1, T7, DECISION-350). ORDER: `gateOversightPage` (signed in, the second-factor
 * recheck, the four-way org miss, `assertOrgAccess`, the flag, the type), `isUuid`
 * and the either-key front door (`openRecord`), then every section's value is
 * COMPUTED BEFORE THE RETURN with `Promise.all` (never a nested async component),
 * each in its own transaction under its own key: a section whose key the viewer
 * lacks renders a visible Locked card, one that throws renders its own load error
 * with "Try again", and the rest of the page stays up.
 */
export default async function OversightRecordPage({
  params,
}: {
  params: Promise<{ slug: string; aboutOrgId: string }>;
}) {
  const { slug, aboutOrgId } = await params;

  const gate = await gateOversightPage({ slug, path: `/o/${slug}/admin/oversight/${aboutOrgId}` });
  if (!gate.ok) return <OversightGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;

  const opened = await openRecord(identity, slug, [aboutOrgId]);
  if (!opened.ok) return opened.view;
  const { congregation, manage, finance } = opened;

  const [profile, assessment, buildings, covers, insurance, loans] = await Promise.all([
    manage ? settle(readProfile(identity, aboutOrgId)) : null,
    manage ? settle(getCongregationOversightDetail(identity.personId, identity.organizationId, aboutOrgId)) : null,
    manage ? settle(readBuildings(identity, aboutOrgId)) : null,
    manage ? settle(readBuildingCovers(identity, aboutOrgId)) : null,
    finance ? settle(readInsuranceYears(identity, aboutOrgId)) : null,
    finance ? settle(Promise.all([readLoans(identity, aboutOrgId), readFormEnv(identity)])) : null,
  ]);

  const locked = { kind: "locked" } as const;
  const profileState = profile ? toState(profile) : locked;
  const buildingsState = buildings ? toState(buildings) : locked;
  // The covers are decoration on the building cards: a failed or refused read just shows the cards without a picture.
  const coversById = covers?.ok && covers.value.kind === "ok" ? covers.value.data : {};
  const insuranceState = insurance ? toState(insurance) : locked;

  // The assessment reader answers `PresbyteryResult` (its own `ok` / `forbidden` / `invalid_target`).
  let assessmentState: SectionState<OversightRow> = locked;
  if (assessment) {
    if (!assessment.ok) assessmentState = { kind: "error" };
    else if (assessment.value.kind === "ok") assessmentState = { kind: "ok", data: assessment.value.data };
    else if (assessment.value.kind !== "forbidden") assessmentState = { kind: "error" };
  }

  // Loans arrive with the organization's local date (the paid-off dialog's default).
  let loansState: SectionState<{ loans: LoanRow[]; today: string }> = locked;
  if (loans) {
    if (!loans.ok) loansState = { kind: "error" };
    else {
      const [loanRead, env] = loans.value;
      if (loanRead.kind === "ok") loansState = { kind: "ok", data: { loans: loanRead.data.loans, today: env.today } };
      else if (loanRead.kind !== "forbidden") loansState = { kind: "error" };
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <BackLink href={`/o/${slug}/admin/oversight`}>Back to oversight</BackLink>
        <h1 className="mt-3 break-words text-2xl font-semibold">{congregation.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{identity.organizationName}&apos;s own oversight record for this congregation.</p>
        {congregation.platformStatus === "managed" ? <p className="mt-2 text-sm text-muted-foreground">{STATE.managedNote}</p> : null}
        <p className="mt-1">
          <HelpLink href={helpHref("congregation-records")}>How these records work</HelpLink>
        </p>
      </div>
      <ProfileSection slug={slug} aboutOrgId={aboutOrgId} state={profileState} />
      <AssessmentSection slug={slug} aboutOrgId={aboutOrgId} state={assessmentState} />
      <BuildingsSection slug={slug} aboutOrgId={aboutOrgId} state={buildingsState} covers={coversById} />
      <InsuranceSection slug={slug} aboutOrgId={aboutOrgId} state={insuranceState} />
      <LoansSection slug={slug} aboutOrgId={aboutOrgId} state={loansState} />
    </div>
  );
}
