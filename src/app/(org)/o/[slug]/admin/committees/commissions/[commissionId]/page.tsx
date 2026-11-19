import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OrgAccessError } from "@/lib/authz";
import { commissionAboutLine, commissionNoAccess } from "@/lib/committees/copy";
import { readCommission, type CommissionMemberRow, type SeatRow } from "@/lib/committees/reads";
import { isUuid } from "@/lib/is-uuid";
import { gateCommitteesPage } from "@/lib/presbytery-reports/gate";
import { BACK_TO_COMMITTEES, COMMISSIONS } from "@/lib/committees/ui-copy";
import { FormattedDate } from "@/components/shared/formatted-date";
import { BackLink } from "@/components/committees/back-link";
import { CommitteesForbidden, CommitteesLoadError } from "@/components/committees/committee-states";
import { EndCommissionDialog } from "@/components/committees/end-commission-dialog";
import { EndTermDialog } from "@/components/committees/end-term-dialog";
import { RemoveRecordDialog } from "@/components/committees/remove-record-dialog";
import { RosterView } from "@/components/committees/roster";
import { TitlesNote } from "@/components/committees/titles-note";
import { CommitteeGateStateView } from "../../committee-gate-state";

/** A commission member as the roster's row shape: the member id stands in for the seat id, and nothing here is ever listed publicly. */
const asSeat = (m: CommissionMemberRow): SeatRow => ({
  membershipId: m.memberId,
  personId: m.personId,
  displayName: m.displayName,
  role: m.role,
  startsOn: m.startsOn,
  endsOn: m.endsOn,
  publicListed: false,
  connected: m.connected,
  deceased: m.deceased,
});

/**
 * `/o/<slug>/admin/committees/commissions/<commissionId>`: one commission record, its
 * charge and its members. The id is checked as a UUID before any read (a malformed id
 * is a 404, as is a removed record, another presbytery's, a committee's or a
 * congregation's id: one answer). It carries the no-access sentence: a record grants
 * its members nothing. An ended record shows its history and no write control except
 * "Edit commission" and "Remove this record" (a correction of the note itself).
 */
export default async function CommissionPage({ params }: { params: Promise<{ slug: string; commissionId: string }> }) {
  const { slug, commissionId } = await params;
  const base = `/o/${slug}/admin/committees`;
  const path = `${base}/commissions/${commissionId}`;

  const gate = await gateCommitteesPage({ slug, path });
  if (!gate.ok) return <CommitteeGateStateView state={gate.state} slug={slug} />;
  const { identity } = gate;
  if (!isUuid(commissionId)) notFound();

  let result;
  try {
    result = await readCommission(identity, commissionId);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <CommitteesLoadError href={path} />;
  }
  if (result.kind === "forbidden") return <CommitteesForbidden name={identity.organizationName} />;
  if (result.kind === "not_found") notFound();
  if (result.kind !== "ok") return <CommitteesLoadError href={path} />;

  const { commission, members, today } = result.data;
  const active = commission.endedOn === null;
  const seats = members.map(asSeat);

  return (
    <section className="space-y-6">
      <div>
        <BackLink href={base}>{BACK_TO_COMMITTEES}</BackLink>
        <h1 className="mt-3 text-2xl font-semibold [overflow-wrap:anywhere]">{commission.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {active ? (
            <Badge variant="secondary">{COMMISSIONS.active}</Badge>
          ) : (
            <Badge variant="outline">
              {COMMISSIONS.ended} <FormattedDate value={commission.endedOn!} mode="date" />
            </Badge>
          )}
        </div>
        <dl className="mt-3 space-y-1 text-sm">
          <div>
            <dt className="sr-only">{COMMISSIONS.tableHead.congregation}</dt>
            <dd className="[overflow-wrap:anywhere]">{commissionAboutLine(commission.congregationName, commission.congregationIsMember)}</dd>
          </div>
          <div>
            <dt className="sr-only">{COMMISSIONS.tableHead.appointed}</dt>
            <dd className="text-muted-foreground">
              {COMMISSIONS.appointedPrefix} <FormattedDate value={commission.appointedOn} mode="date" />
              {" · "}
              <span className="[overflow-wrap:anywhere]">
                {commission.minuteReference ? COMMISSIONS.minute(commission.minuteReference) : COMMISSIONS.noMinute}
              </span>
            </dd>
          </div>
          {active ? null : (
            <div>
              <dt className="sr-only">{COMMISSIONS.ended}</dt>
              <dd className="text-muted-foreground">
                {COMMISSIONS.ended} <FormattedDate value={commission.endedOn!} mode="date" />
                {commission.endedMinuteReference ? (
                  <>
                    {" · "}
                    <span className="[overflow-wrap:anywhere]">{COMMISSIONS.reportedIn(commission.endedMinuteReference)}</span>
                  </>
                ) : null}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {commission.charge ? (
        <div>
          <h2 className="text-lg font-semibold">{COMMISSIONS.charge}</h2>
          <p className="mt-1 whitespace-pre-line text-sm [overflow-wrap:anywhere]">{commission.charge}</p>
        </div>
      ) : null}

      <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm [overflow-wrap:anywhere]">
        {commissionNoAccess(commission.congregationName)}
      </p>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button asChild variant="outline" className="min-h-11">
          <Link href={`${path}/edit`}>{COMMISSIONS.edit}</Link>
        </Button>
        {active ? (
          <>
            <Button asChild className="min-h-11">
              <Link href={`${path}/members/new`}>{COMMISSIONS.addMember}</Link>
            </Button>
            <EndCommissionDialog slug={slug} commissionId={commission.id} appointedOn={commission.appointedOn} today={today} />
          </>
        ) : null}
        <RemoveRecordDialog slug={slug} commissionId={commission.id} />
      </div>

      <TitlesNote />

      <RosterView
        seats={seats}
        today={today}
        canWrite={active}
        renderActions={(seat, state, idPrefix) =>
          state === "past" ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <EndTermDialog
                slug={slug}
                committeeId=""
                commissionId={commission.id}
                membershipId={seat.membershipId}
                personName={seat.displayName}
                mode={state === "planned" ? "cancel" : seat.endsOn ? "change" : "end"}
                startsOn={seat.startsOn}
                currentEndsOn={seat.endsOn}
                today={today}
                carries={false}
                idPrefix={idPrefix}
              />
            </div>
          )
        }
      />
    </section>
  );
}
