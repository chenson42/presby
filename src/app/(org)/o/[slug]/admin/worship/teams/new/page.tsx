import { gateWorshipPage } from "@/app/(org)/o/[slug]/worship/worship-gate";
import { BackLink } from "@/app/(org)/o/[slug]/worship/worship-states";
import { OrgAccessError } from "@/lib/authz";
import { NAV_COPY, TEAMS_COPY } from "@/lib/worship/copy";
import { getAdoptableGroups, type AdoptableGroup } from "@/lib/worship/reads";
import { ExistingGroupForm } from "./existing-group-form";
import { TeamForm } from "./team-form";

/**
 * `/o/<slug>/admin/worship/teams/new` - a new team (Copy G3): a name, a kind and a
 * ready-made set of positions; and, only for a viewer who ALSO holds `groups.manage`,
 * "Or use a group you already have". A read that says `forbidden` (no `groups.manage`)
 * or fails simply hides the second form: the first never depends on it.
 */
export default async function NewWorshipTeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const gate = await gateWorshipPage({
    slug,
    path: `/o/${slug}/admin/worship/teams/new`,
    anyOf: ["manage"],
    heading: TEAMS_COPY.newButton,
  });
  if (!gate.ok) return gate.node;

  let adoptable: AdoptableGroup[] = [];
  try {
    const result = await getAdoptableGroups(gate.identity.viewer);
    if (result.kind === "ok") adoptable = result.data;
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
  }

  return (
    <div className="max-w-xl space-y-8">
      <BackLink href={`/o/${slug}/admin/worship/teams`} label={NAV_COPY.backToTeams} />
      <h1 className="text-2xl font-semibold">{TEAMS_COPY.newButton}</h1>
      <TeamForm slug={slug} />
      {adoptable.length > 0 && <ExistingGroupForm slug={slug} groups={adoptable} />}
    </div>
  );
}
