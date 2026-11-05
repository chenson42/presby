import { gateWorshipPage, readOrState } from "@/app/(org)/o/[slug]/worship/worship-gate";
import { BackLink } from "@/app/(org)/o/[slug]/worship/worship-states";
import { OrgAccessError } from "@/lib/authz";
import { ACTION_COPY, NAV_COPY, TEAMS_COPY } from "@/lib/worship/copy";
import { getTeamAdmin } from "@/lib/worship/reads";
import { PeopleEditor } from "./people-editor";
import { PositionForm } from "./position-form";
import { PositionRow } from "./position-row";
import { RetireTeamDialog } from "./retire-team-dialog";

/**
 * `/o/<slug>/admin/worship/teams/<groupId>` - one team (Copy G3): its positions, its
 * people, who can fill what, and "Retire team". `worship.manage`. A team of another
 * organization or an unknown id is the organization's 404. The note about chairs and
 * leaders states the reimbursement coupling plainly (R6): a leader is more than a
 * scheduler.
 */
export default async function WorshipTeamAdminPage({ params }: { params: Promise<{ slug: string; groupId: string }> }) {
  const { slug, groupId } = await params;
  const path = `/o/${slug}/admin/worship/teams/${groupId}`;
  const gate = await gateWorshipPage({ slug, path, anyOf: ["manage"], heading: TEAMS_COPY.listHeading });
  if (!gate.ok) return gate.node;
  const { identity } = gate;

  let result: Awaited<ReturnType<typeof getTeamAdmin>>;
  try {
    result = await getTeamAdmin(identity.viewer, { groupId });
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    result = { kind: "invalid_input", message: "" };
  }
  const read = readOrState(result, { slug, name: identity.organizationName, heading: TEAMS_COPY.listHeading, retryHref: path });
  if (!read.ok) return read.node;
  const team = read.data;

  return (
    <div className="max-w-3xl space-y-8">
      <BackLink href={`/o/${slug}/admin/worship/teams`} label={NAV_COPY.backToTeams} />
      <div className="space-y-2">
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold [overflow-wrap:anywhere]">
          {team.name}
          {team.retired && (
            <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-sm font-normal">{TEAMS_COPY.retiredBadge}</span>
          )}
        </h1>
        {team.retired && <p className="text-base text-muted-foreground">{ACTION_COPY.teamRetired(team.name)}</p>}
        <p className="text-sm text-muted-foreground">{TEAMS_COPY.page.seatNote}</p>
      </div>

      <section aria-labelledby="positions-heading" className="space-y-3">
        <h2 id="positions-heading" className="text-xl font-semibold">
          {TEAMS_COPY.page.positionsHeading}
        </h2>
        {team.positions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-base text-muted-foreground">{NAV_COPY.noPositions}</p>
        ) : (
          <ul className="space-y-3" data-testid="positions-list">
            {team.positions.map((position) => (
              <PositionRow key={position.id} slug={slug} groupId={groupId} position={position} />
            ))}
          </ul>
        )}
        {!team.retired && <PositionForm slug={slug} groupId={groupId} />}
      </section>

      <PeopleEditor slug={slug} groupId={groupId} teamName={team.name} positions={team.positions} people={team.people} retired={team.retired} />

      {!team.retired && (
        <section className="border-t border-border pt-6">
          <RetireTeamDialog slug={slug} groupId={groupId} teamName={team.name} />
        </section>
      )}
    </div>
  );
}
