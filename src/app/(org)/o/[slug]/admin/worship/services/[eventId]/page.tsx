import { gateWorshipPage, readOrState } from "@/app/(org)/o/[slug]/worship/worship-gate";
import { BackLink } from "@/app/(org)/o/[slug]/worship/worship-states";
import { ServiceSummary } from "@/components/worship/service-summary";
import { SendRequestsDialog } from "@/components/worship/send-requests-dialog";
import { TeamBoard } from "@/components/worship/team-board";
import { OrgAccessError } from "@/lib/authz";
import { ACTION_COPY, NAV_COPY, SERVICES_COPY } from "@/lib/worship/copy";
import { getServiceBoard, getServiceFormOptions } from "@/lib/worship/reads";
import { CancelServiceDialog } from "./cancel-service-dialog";
import { EditServiceDialog } from "./edit-service-dialog";
import { ServiceTeamsEditor } from "./service-teams-editor";

/**
 * `/o/<slug>/admin/worship/services/<eventId>` - one service, the full board (Copy
 * G4 and G5): the title, when and where, "Edit details", "Cancel service", the teams
 * serving (add and remove), and one board per serving team with the scheduling
 * controls for whoever may schedule that team. Readable by any worship key; the
 * service controls need `worship.plan`, the scheduling controls need `worship.schedule`
 * or a seat. An id that is not a worship service is the organization's 404.
 *
 * One "Send requests" for the whole service sits above the boards when the viewer
 * holds `worship.schedule`; a seat holder's Send is cut to the teams they lead by the
 * store.
 */
export default async function WorshipServicePage({ params }: { params: Promise<{ slug: string; eventId: string }> }) {
  const { slug, eventId } = await params;
  const path = `/o/${slug}/admin/worship/services/${eventId}`;
  const heading = SERVICES_COPY.list.heading;
  const gate = await gateWorshipPage({ slug, path, anyOf: ["manage", "plan", "schedule"], heading });
  if (!gate.ok) return gate.node;
  const { identity } = gate;
  const { has } = identity;

  let board: Awaited<ReturnType<typeof getServiceBoard>>;
  let options: Awaited<ReturnType<typeof getServiceFormOptions>> | null = null;
  try {
    board = await getServiceBoard(identity.viewer, { eventId });
    if (has.plan || has.manage) options = await getServiceFormOptions(identity.viewer);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    board = { kind: "invalid_input", message: "" };
  }
  const read = readOrState(board, { slug, name: identity.organizationName, heading, retryHref: path });
  if (!read.ok) return read.node;
  const service = read.data;

  const open = !service.cancelled && !service.started;
  const canPlan = has.plan && open;
  const serving = service.teams.map((t) => ({ groupId: t.groupId, name: t.name }));
  const allTeams = options?.kind === "ok" ? options.data.teams : [];
  const drafts = service.teams.reduce(
    (n, team) => (team.canSchedule ? n + team.positions.reduce((m, p) => m + p.assignments.filter((a) => a.status === "draft" && !a.isGuest).length, 0) : n),
    0,
  );

  return (
    <div className="max-w-3xl space-y-8">
      <BackLink href={`/o/${slug}/admin/worship/services`} label={NAV_COPY.backToServices} />
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold [overflow-wrap:anywhere]">{service.title}</h1>
        <ServiceSummary startsAt={service.startsAt} location={service.location} cancelled={service.cancelled} />
        {!service.cancelled && service.started && <p className="text-base font-medium">{ACTION_COPY.serviceStarted}</p>}
        {canPlan && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <EditServiceDialog
              slug={slug}
              service={{ eventId, title: service.title, startsAt: service.startsAt, endsAt: service.endsAt, location: service.location }}
            />
            <CancelServiceDialog slug={slug} eventId={eventId} />
          </div>
        )}
      </div>

      <section aria-labelledby="serving-heading" className="space-y-3" data-testid="teams-serving">
          <h2 id="serving-heading" className="text-xl font-semibold">
            {SERVICES_COPY.page.teamsServingHeading}
          </h2>
          {canPlan ? (
            <ServiceTeamsEditor slug={slug} eventId={eventId} serving={serving} allTeams={allTeams} />
          ) : serving.length === 0 ? (
            <p className="text-base text-muted-foreground">{NAV_COPY.noServingTeams}</p>
          ) : (
            <ul className="space-y-1 text-base">
              {serving.map((team) => (
                <li key={team.groupId} className="[overflow-wrap:anywhere]">
                  {team.name}
                </li>
              ))}
            </ul>
          )}
        </section>

      {open && has.schedule && drafts > 0 && <SendRequestsDialog slug={slug} eventId={eventId} draftCount={drafts} />}

      <div className="space-y-8">
        {service.teams.map((team) => (
          <TeamBoard key={team.groupId} slug={slug} eventId={eventId} team={team} canAct={open && team.canSchedule} showSend={!has.schedule} />
        ))}
      </div>
    </div>
  );
}
