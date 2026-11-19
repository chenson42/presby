import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OrgAccessError } from "@/lib/authz";
import { readCommittee } from "@/lib/committees/reads";
import { splitRoster } from "@/lib/committees/derive";
import { isUuid } from "@/lib/is-uuid";
import { gateCommitteesPage } from "@/lib/presbytery-reports/gate";
import { BACK_TO_COMMITTEES, LIST, PAGE } from "@/lib/committees/ui-copy";
import { FormattedDate } from "@/components/shared/formatted-date";
import { BackLink } from "@/components/committees/back-link";
import { CarriesRoleNote } from "@/components/committees/carries-role-note";
import { CommitteesForbidden, CommitteesLoadError, GuidedEmpty } from "@/components/committees/committee-states";
import { DissolveDialog } from "@/components/committees/dissolve-dialog";
import { KindBadge } from "@/components/committees/kind-badge";
import { Roster } from "@/components/committees/roster";
import { TitlesNote } from "@/components/committees/titles-note";
import { CommitteeGateStateView } from "../committee-gate-state";

/**
 * `/o/<slug>/admin/committees/<committeeId>`: one committee, its notes and its
 * roster. The id is checked as a UUID before any read (a malformed id is a 404, as
 * is a committee of another presbytery, a choir or a derived group: one answer).
 * A dissolved committee shows its roster as history and no write control.
 */
export default async function CommitteePage({ params }: { params: Promise<{ slug: string; committeeId: string }> }) {
  const { slug, committeeId } = await params;
  const base = `/o/${slug}/admin/committees`;
  const path = `${base}/${committeeId}`;

  const gate = await gateCommitteesPage({ slug, path });
  if (!gate.ok) return <CommitteeGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;
  if (!isUuid(committeeId)) notFound();

  let result;
  try {
    result = await readCommittee(identity, committeeId);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <CommitteesLoadError href={path} />;
  }
  if (result.kind === "forbidden") return <CommitteesForbidden name={identity.organizationName} />;
  if (result.kind === "not_found") notFound();
  if (result.kind !== "ok") return <CommitteesLoadError href={path} />;

  const { committee, seats, carriedRoles, today } = result.data;
  const active = committee.dissolvedOn === null;
  const roleNames = carriedRoles.map((r) => r.name);
  const split = splitRoster(seats, today);
  const noOneYet = split.serving.length === 0 && split.planned.length === 0;

  return (
    <section className="space-y-6">
      <div>
        <BackLink href={base}>{BACK_TO_COMMITTEES}</BackLink>
        <h1 className="mt-3 text-2xl font-semibold [overflow-wrap:anywhere]">{committee.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <KindBadge kind={committee.kind} />
          {committee.dissolvedOn ? (
            <Badge variant="outline">
              {PAGE.dissolvedBadge} <FormattedDate value={committee.dissolvedOn} mode="date" />
            </Badge>
          ) : null}
        </div>
        {committee.meetsWhen ? (
          <p className="mt-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">{LIST.meets(committee.meetsWhen)}</p>
        ) : null}
        {committee.purpose ? <p className="mt-2 whitespace-pre-line text-sm [overflow-wrap:anywhere]">{committee.purpose}</p> : null}
      </div>

      {active ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button asChild variant="outline" className="min-h-11">
            <Link href={`${path}/edit`}>{PAGE.edit}</Link>
          </Button>
          <Button asChild className="min-h-11">
            <Link href={`${path}/members/new`}>{PAGE.addMember}</Link>
          </Button>
          <DissolveDialog slug={slug} committeeId={committee.id} committeeName={committee.name} carriedRoleNames={roleNames} today={today} />
        </div>
      ) : (
        <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
          {PAGE.dissolvedBefore}
          <FormattedDate value={committee.dissolvedOn!} mode="date" />
          {PAGE.dissolvedAfter}
        </p>
      )}

      <div className="space-y-3">
        <CarriesRoleNote roleNames={roleNames} variant="note" />
        <TitlesNote />
      </div>

      {active && noOneYet ? (
        <GuidedEmpty title={PAGE.emptyRoster}>
          <Button asChild className="mt-3 min-h-11">
            <Link href={`${path}/members/new`}>{PAGE.addMember}</Link>
          </Button>
        </GuidedEmpty>
      ) : null}
      <Roster
        slug={slug}
        committeeId={committee.id}
        committeeName={committee.name}
        seats={seats}
        today={today}
        carries={roleNames.length > 0}
        canWrite={active}
      />
    </section>
  );
}
