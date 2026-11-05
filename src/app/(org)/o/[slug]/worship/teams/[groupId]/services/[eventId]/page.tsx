import { notFound } from "next/navigation";
import { ServiceSummary } from "@/components/worship/service-summary";
import { TeamBoard } from "@/components/worship/team-board";
import { OrgAccessError } from "@/lib/authz";
import { ACTION_COPY, MEMBER_COPY, NAV_COPY } from "@/lib/worship/copy";
import { getServiceBoard } from "@/lib/worship/reads";
import { gateWorshipPage, readOrState } from "../../../../worship-gate";
import { BackLink } from "../../../../worship-states";

/**
 * `/o/<slug>/worship/teams/<groupId>/services/<eventId>` - the scheduling board for
 * ONE team on ONE service (Copy G5): the page a team leader works from, and the page
 * the "someone declined" email opens. Authority is `worship.schedule` or a live
 * leader/chair seat on THIS team; anyone else, an event that is not a worship
 * service and a team that is not serving it all get the organization's not-found.
 * The store repeats the check on every write.
 *
 * A cancelled or already-started service shows the board read-only with its status
 * stated; nothing on it can be changed.
 */
export default async function WorshipBoardPage({
  params,
}: {
  params: Promise<{ slug: string; groupId: string; eventId: string }>;
}) {
  const { slug, groupId, eventId } = await params;
  const path = `/o/${slug}/worship/teams/${groupId}/services/${eventId}`;
  const gate = await gateWorshipPage({ slug, path, heading: MEMBER_COPY.home.heading });
  if (!gate.ok) return gate.node;
  const { identity } = gate;

  let result: Awaited<ReturnType<typeof getServiceBoard>>;
  try {
    result = await getServiceBoard(identity.viewer, { eventId, groupId });
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    result = { kind: "invalid_input", message: "" };
  }
  const read = readOrState(result, { slug, name: identity.organizationName, heading: MEMBER_COPY.home.heading, retryHref: path });
  if (!read.ok) return read.node;
  const board = read.data;
  const team = board.teams.find((t) => t.groupId === groupId);
  // Authority is the seat or a key: a viewer who merely sits on the team's roster reads the team page, not this board.
  if (!team || !team.canSchedule) notFound();
  const open = !board.cancelled && !board.started;

  return (
    <div className="max-w-3xl space-y-6">
      <BackLink href={`/o/${slug}/worship/teams/${groupId}`} label={NAV_COPY.backToTeam(team.name)} />
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold [overflow-wrap:anywhere]">{board.title}</h1>
        <ServiceSummary startsAt={board.startsAt} location={board.location} cancelled={board.cancelled} />
        {!board.cancelled && board.started && <p className="text-base font-medium">{ACTION_COPY.serviceStarted}</p>}
      </div>
      <TeamBoard slug={slug} eventId={eventId} team={team} canAct={open} />
    </div>
  );
}
