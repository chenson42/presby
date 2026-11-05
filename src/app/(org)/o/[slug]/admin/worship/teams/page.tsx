import Link from "next/link";
import { Plus } from "lucide-react";
import { gateWorshipPage, readOrState } from "@/app/(org)/o/[slug]/worship/worship-gate";
import { BackLink } from "@/app/(org)/o/[slug]/worship/worship-states";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { OrgAccessError } from "@/lib/authz";
import { NAV_COPY, TEAMS_COPY } from "@/lib/worship/copy";
import { getTeamsAdmin } from "@/lib/worship/reads";

/** `/o/<slug>/admin/worship/teams` - the teams list (Copy G3): `worship.manage`. */
export default async function WorshipTeamsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = `/o/${slug}/admin/worship/teams`;
  const gate = await gateWorshipPage({ slug, path, anyOf: ["manage"], heading: TEAMS_COPY.listHeading });
  if (!gate.ok) return gate.node;
  const { identity } = gate;

  let result: Awaited<ReturnType<typeof getTeamsAdmin>>;
  try {
    result = await getTeamsAdmin(identity.viewer);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    result = { kind: "invalid_input", message: "" };
  }
  const read = readOrState(result, { slug, name: identity.organizationName, heading: TEAMS_COPY.listHeading, retryHref: path });
  if (!read.ok) return read.node;
  const teams = read.data;
  const newHref = `/o/${slug}/admin/worship/teams/new`;

  return (
    <div className="max-w-3xl space-y-6">
      <BackLink href={`/o/${slug}/admin/worship`} label={NAV_COPY.backToPlan} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">{TEAMS_COPY.listHeading}</h1>
        <Button asChild className="min-h-11">
          <Link href={newHref}>
            <Plus className="size-4" aria-hidden />
            {TEAMS_COPY.newButton}
          </Link>
        </Button>
      </div>
      {teams.length === 0 ? (
        <EmptyState
          title={TEAMS_COPY.listEmpty}
          action={
            <Button asChild className="min-h-11">
              <Link href={newHref}>{TEAMS_COPY.newButton}</Link>
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3" data-testid="teams-list">
          {teams.map((team) => (
            <li key={team.groupId}>
              <Link
                href={`/o/${slug}/admin/worship/teams/${team.groupId}`}
                className="block min-h-11 space-y-1 rounded-lg border border-border bg-card p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span className="flex flex-wrap items-center gap-2 text-lg font-semibold [overflow-wrap:anywhere]">
                  {team.name}
                  {team.retired && (
                    <span className="rounded-full border border-border bg-muted px-2.5 py-0.5 text-sm font-normal">{TEAMS_COPY.retiredBadge}</span>
                  )}
                </span>
                <span className="block text-sm text-muted-foreground">{TEAMS_COPY.rowCounts(team.peopleCount, team.positionCount)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
