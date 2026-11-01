import { OrgAccessError } from "@/lib/authz";
import { TeamPanel } from "@/components/treasury/team-panel";
import { COPY } from "@/lib/reimbursement/copy";
import { gateReimbursementPage } from "@/lib/reimbursement/gate";
import { listTreasuryTeam, type ListTreasuryTeamResult } from "@/lib/treasury/team";
import { BackToReimbursements, ReimbursementLoadError, ReimbursementStatePage } from "../../../reimbursements/reimbursement-states";
import { ensureTreasuryRoleAction, grantTreasuryRoleAction, revokeTreasuryRoleAction } from "./actions";

/**
 * `/o/<slug>/admin/reimbursements/team` - the treasury team (`reimbursement.manage`).
 * docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 P3-14, F296, EC31, Copy C9.
 * Who holds a treasury role, a person-arm grant form restricted to roles made only
 * of treasury keys, and a "set up the role" control for a template (the Treasurer,
 * the Reimbursement Clerk) the church has no assignable role for. People are listed
 * by name only. A database failure is a load error, never an empty team. No
 * `loading.tsx`.
 */
export default async function TreasuryTeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = `/o/${slug}/admin/reimbursements/team`;
  const gate = await gateReimbursementPage({ slug, path, anyOf: ["manage"] });
  if (!gate.ok) {
    return (
      <ReimbursementStatePage
        state={gate.state}
        slug={slug}
        heading={COPY.team.heading}
        retryHref={path}
        loadErrorMessage={COPY.queue.loadError}
      />
    );
  }
  const { identity } = gate;

  let team: ListTreasuryTeamResult;
  try {
    team = await listTreasuryTeam("reimbursement", identity.personId, identity.organizationId);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <ReimbursementLoadError heading={COPY.team.heading} message={COPY.queue.loadError} href={path} />;
  }
  if (team.kind !== "ok") {
    return <ReimbursementLoadError heading={COPY.team.heading} message={COPY.queue.loadError} href={path} />;
  }

  return (
    <div className="max-w-2xl space-y-8">
      <BackToReimbursements slug={slug} href={`/o/${slug}/admin/reimbursements`} />
      <div>
        <h1 className="text-2xl font-semibold">{COPY.team.heading}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{COPY.team.intro(identity.organizationName)}</p>
      </div>
      <TeamPanel
        team={team}
        setupLabels={{ treasurer: COPY.team.setUpTreasurer, reimbursement_clerk: COPY.team.setUpClerk }}
        setupDescriptions={{ reimbursement_clerk: COPY.team.clerkDescription }}
        grant={grantTreasuryRoleAction.bind(null, slug)}
        revoke={revokeTreasuryRoleAction.bind(null, slug)}
        ensure={ensureTreasuryRoleAction.bind(null, slug)}
      />
    </div>
  );
}
