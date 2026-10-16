import { OrgAccessError } from "@/lib/authz";
import { listGivingTeam, type ListGivingTeamResult } from "@/lib/giving/team";
import { Card, CardContent } from "@/components/ui/card";
import { GivingBackLink, GivingLoadError } from "../giving-admin-states";
import { gateGivingPage } from "../giving-page-gate";
import { GrantGivingRoleForm } from "./grant-form";
import { SetUpRoleButton } from "./setup-role-button";
import { TeamList } from "./team-list";

/**
 * `/o/<slug>/admin/giving/team` - the giving team (`giving.manage`).
 * docs/work-log/2026-10-15-online-giving.md, Phase 2 R3 (F138) and Phase 3
 * P3-18. Who holds a giving permission, a person-arm grant form restricted to
 * roles made ONLY of giving permissions, and a "set up the role" control for a
 * giving template the church has no active role for. Members are listed by name
 * only. A database failure is a load-error state, never an empty team. No
 * `loading.tsx`.
 */
export default async function GivingTeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = `/o/${slug}/admin/giving/team`;
  const gate = await gateGivingPage({ slug, path, anyOf: ["manage"], section: "Giving team" });
  if (!gate.ok) return gate.node;

  let team: ListGivingTeamResult;
  try {
    team = await listGivingTeam(gate.org.personId, gate.org.organizationId);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <GivingLoadError slug={slug} href={path} />;
  }
  if (team.kind !== "ok") return <GivingLoadError slug={slug} href={path} />;

  const setup = team.missingTemplates.map((key) => ({
    key,
    label: key === "treasurer" ? "Set up the Treasurer role" : "Set up the Giving Recorder role",
  }));

  return (
    <div className="max-w-2xl space-y-8">
      <GivingBackLink slug={slug} />
      <div>
        <h1 className="text-2xl font-semibold">Giving team</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Who can view, record and manage giving at {gate.org.name}. Anyone with one of these roles
          signs in with two-factor authentication.
        </p>
      </div>

      <section aria-labelledby="team-current" className="space-y-3">
        <h2 id="team-current" className="text-xl font-semibold">
          Who has a giving role
        </h2>
        <TeamList slug={slug} grants={team.grants} />
      </section>

      {setup.length > 0 && (
        <section aria-labelledby="team-setup" className="space-y-3">
          <h2 id="team-setup" className="text-xl font-semibold">
            Roles to set up
          </h2>
          <p className="text-sm text-muted-foreground">
            {team.missingTemplates.length === 1 ? "This role isn't" : "These roles aren't"} set up for your
            church yet, so it can&apos;t be given to anyone.
          </p>
          <div className="flex flex-wrap gap-2">
            {setup.map((item) => (
              <SetUpRoleButton key={item.key} slug={slug} templateKey={item.key} label={item.label} />
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="team-give" className="space-y-3">
        <h2 id="team-give" className="text-xl font-semibold">
          Give a role
        </h2>
        <Card>
          <CardContent>
            <GrantGivingRoleForm slug={slug} roles={team.assignableRoles} people={team.people} />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
