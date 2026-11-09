import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { formatWhen } from "@/components/worship/service-when";
import { OrgAccessError } from "@/lib/authz";
import { MEMBER_COPY, NAV_COPY, TEAMS_COPY } from "@/lib/worship/copy";
import { getTeamPage, type TeamPagePerson } from "@/lib/worship/reads";
import { gateWorshipPage, readOrState } from "../../worship-gate";
import { BackLink } from "../../worship-states";

/**
 * `/o/<slug>/worship/teams/<groupId>` - a team's page (Copy G6): its leaders, its
 * people with the positions each can fill, and - for someone who may schedule it -
 * the upcoming services with "Schedule this team". Readable by people on the roster
 * and by holders of any worship key; everyone else, and an unknown id, gets the
 * organization's own not-found. NO contact details in Increment 1.
 */

function PersonLine({ person }: { person: TeamPagePerson }) {
  const badge = person.role === "chair" ? TEAMS_COPY.page.chairBadge : person.role === "leader" ? TEAMS_COPY.page.leaderBadge : null;
  return (
    <li className="space-y-1 rounded-lg border border-border bg-card px-4 py-3" data-testid="team-person">
      <p className="flex flex-wrap items-center gap-2 text-base font-medium [overflow-wrap:anywhere]">
        {person.displayName}
        {badge && <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-sm font-normal">{badge}</span>}
      </p>
      {person.canFill.length > 0 && (
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{MEMBER_COPY.team.canFill(person.canFill)}</p>
      )}
    </li>
  );
}

export default async function WorshipTeamPage({ params }: { params: Promise<{ slug: string; groupId: string }> }) {
  const { slug, groupId } = await params;
  const path = `/o/${slug}/worship/teams/${groupId}`;
  const gate = await gateWorshipPage({ slug, path, heading: MEMBER_COPY.home.heading });
  if (!gate.ok) return gate.node;
  const { identity } = gate;

  let result: Awaited<ReturnType<typeof getTeamPage>>;
  try {
    result = await getTeamPage(identity.viewer, { groupId });
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    result = { kind: "invalid_input", message: "" };
  }
  const read = readOrState(result, { slug, name: identity.organizationName, heading: MEMBER_COPY.home.heading, retryHref: path });
  if (!read.ok) return read.node;
  const team = read.data;
  const nobody = team.leaders.length + team.people.length === 0;

  return (
    <div className="max-w-3xl space-y-8">
      <BackLink href={`/o/${slug}/worship`} label={NAV_COPY.backToWorship} />
      <h1 className="text-2xl font-semibold [overflow-wrap:anywhere]">{team.name}</h1>
      {team.description ? <p className="text-base text-muted-foreground [overflow-wrap:anywhere]">{team.description}</p> : null}

      {nobody ? (
        <EmptyState title={MEMBER_COPY.team.empty} />
      ) : (
        <>
          {team.leaders.length > 0 && (
            <section aria-labelledby="leaders-heading" className="space-y-3">
              <h2 id="leaders-heading" className="text-xl font-semibold">
                {MEMBER_COPY.team.leaders}
              </h2>
              <ul className="space-y-2">
                {team.leaders.map((person) => (
                  <PersonLine key={person.personId} person={person} />
                ))}
              </ul>
            </section>
          )}
          {team.people.length > 0 && (
            <section aria-labelledby="people-heading" className="space-y-3">
              <h2 id="people-heading" className="text-xl font-semibold">
                {MEMBER_COPY.team.people}
              </h2>
              <ul className="space-y-2">
                {team.people.map((person) => (
                  <PersonLine key={person.personId} person={person} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {team.canSchedule && (
        <section aria-labelledby="upcoming-heading" className="space-y-3" data-testid="team-upcoming">
          <h2 id="upcoming-heading" className="text-xl font-semibold">
            {MEMBER_COPY.team.upcoming}
          </h2>
          {team.services.length === 0 ? (
            <EmptyState title={NAV_COPY.noServices} />
          ) : (
            <ul className="space-y-3">
              {team.services.map((service) => (
                <li key={service.eventId} className="space-y-2 rounded-lg border border-border bg-card p-4">
                  <p className="text-base font-medium [overflow-wrap:anywhere]">{service.title}</p>
                  <p className="text-sm text-muted-foreground">{formatWhen(service.startsAt)}</p>
                  <Button asChild className="min-h-11 w-full sm:w-auto">
                    <Link href={`/o/${slug}/worship/teams/${groupId}/services/${service.eventId}`}>{MEMBER_COPY.team.schedule}</Link>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
