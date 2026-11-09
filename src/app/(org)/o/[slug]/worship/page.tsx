import Link from "next/link";
import { CalendarOff, Users } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { OrgAccessError } from "@/lib/authz";
import { MEMBER_COPY } from "@/lib/worship/copy";
import { getMySchedule, type ScheduleItem } from "@/lib/worship/reads";
import { gateWorshipPage, readOrState } from "./worship-gate";
import { ScheduleCard } from "./schedule-card";

/**
 * `/o/<slug>/worship` - the member's page (Copy G6): requests waiting for their
 * answer, what they are scheduled for, what they said they can't serve, their
 * teams, and the way to "Dates I can't serve". Any member of a congregation or new
 * worshiping community whose Worship toggle is on sees it; WHAT they can do is
 * their own rows, and the store derives the person from the session.
 *
 * Read-only: opening this page writes nothing. No `loading.tsx` (the segment can
 * 404 and a Suspense boundary would flush a 200 first).
 */
export default async function WorshipHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const gate = await gateWorshipPage({
    slug,
    path: `/o/${slug}/worship`,
    heading: MEMBER_COPY.home.heading,
  });
  if (!gate.ok) return gate.node;
  const { identity } = gate;

  let result: Awaited<ReturnType<typeof getMySchedule>>;
  try {
    result = await getMySchedule(identity.viewer);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    result = { kind: "invalid_input", message: "" };
  }
  const read = readOrState(result, {
    slug,
    name: identity.organizationName,
    heading: MEMBER_COPY.home.heading,
    retryHref: `/o/${slug}/worship`,
  });
  if (!read.ok) return read.node;
  const { waiting, scheduled, declined, teams } = read.data;
  const nothing = waiting.length + scheduled.length + declined.length === 0;

  const sections: Array<{ id: string; heading: string; items: ScheduleItem[] }> = [
    { id: "waiting", heading: MEMBER_COPY.home.waiting, items: waiting },
    { id: "scheduled", heading: MEMBER_COPY.home.scheduled, items: scheduled },
    { id: "declined", heading: MEMBER_COPY.home.declined, items: declined },
  ];

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{MEMBER_COPY.home.heading}</h1>
        <Link
          href={`/o/${slug}/worship/blockouts`}
          className="mt-2 inline-flex min-h-11 items-center gap-2 text-base underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <CalendarOff className="size-4" aria-hidden />
          {MEMBER_COPY.home.blockoutsLink}
        </Link>
      </div>

      {nothing ? (
        <EmptyState title={MEMBER_COPY.home.empty} />
      ) : (
        sections
          .filter((section) => section.items.length > 0)
          .map((section) => (
            <section key={section.id} aria-labelledby={`${section.id}-heading`} className="space-y-3" data-testid={`section-${section.id}`}>
              <h2 id={`${section.id}-heading`} className="text-xl font-semibold">
                {section.heading}
              </h2>
              <ul className="space-y-3">
                {section.items.map((item) => (
                  <ScheduleCard key={item.assignmentId} slug={slug} item={item} />
                ))}
              </ul>
            </section>
          ))
      )}

      {teams.length > 0 && (
        <section aria-labelledby="teams-heading" className="space-y-3" data-testid="section-teams">
          <h2 id="teams-heading" className="text-xl font-semibold">
            {MEMBER_COPY.home.teams}
          </h2>
          <ul className="space-y-2">
            {teams.map((team) => (
              <li key={team.groupId}>
                <Link
                  href={`/o/${slug}/worship/teams/${team.groupId}`}
                  // ui-ok: a full-width link row (icon, wrapping name, "You lead" tag) is a list row, not a button; <Button> cannot wrap its text at 360px
                  className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3 text-base font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <span className="flex items-center gap-2 [overflow-wrap:anywhere]">
                    <Users className="size-4 shrink-0" aria-hidden />
                    {team.name}
                  </span>
                  {team.youLead && (
                    <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-sm">{MEMBER_COPY.home.youLead}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
