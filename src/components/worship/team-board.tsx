import { BOARD_COPY, NAV_COPY } from "@/lib/worship/copy";
import type { BoardTeam } from "@/lib/worship/reads";
import { AssignmentRow } from "./assignment-row";
import { GuestForm } from "./guest-form";
import { PersonPickerDialog } from "./person-picker-dialog";
import { SendRequestsDialog } from "./send-requests-dialog";

/**
 * One team's positions and who fills them on one service (Copy G5) - shared by the
 * member board (`/o/<slug>/worship/teams/<id>/services/<id>`) and the admin service
 * page (one section per serving team). A position reads "{Position}, {filled} of
 * {slots}" with its people as cards (never a table: 360px), an "Open" card per
 * unfilled slot, and "Add someone" / "Add a guest" for a viewer who may schedule
 * the team on a service that is still ahead. The Send button appears with the
 * number of people not yet asked.
 *
 * `canAct` is the page's whole decision (the team's `canSchedule` AND the service
 * is neither cancelled nor started); the store repeats it on every write.
 */
export function TeamBoard({
  slug,
  eventId,
  team,
  canAct,
  headingLevel = 2,
  showSend = true,
}: {
  slug: string;
  eventId: string;
  team: BoardTeam;
  canAct: boolean;
  headingLevel?: 2 | 3;
  /** False when the page offers one Send for the whole service. */
  showSend?: boolean;
}) {
  const drafts = team.positions.reduce((n, p) => n + p.assignments.filter((a) => a.status === "draft" && !a.isGuest).length, 0);
  const Heading = `h${headingLevel}` as "h2" | "h3";
  const SubHeading = `h${headingLevel + 1}` as "h3" | "h4";
  return (
    <section className="space-y-4" aria-labelledby={`team-${team.groupId}`} data-testid="team-board" data-group-id={team.groupId}>
      <Heading id={`team-${team.groupId}`} className="text-xl font-semibold [overflow-wrap:anywhere]">
        {team.name}
      </Heading>
      {canAct && showSend && drafts > 0 && <SendRequestsDialog slug={slug} eventId={eventId} groupId={team.groupId} draftCount={drafts} />}
      {team.positions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-base text-muted-foreground">
          {NAV_COPY.noPositions}
        </p>
      ) : (
        <ul className="space-y-4">
          {team.positions.map((position) => {
            const open = Math.max(0, position.slots - position.filled);
            return (
              <li key={position.positionId} className="space-y-3" data-testid="position-block">
                <SubHeading className="text-lg font-semibold [overflow-wrap:anywhere]">
                  {BOARD_COPY.positionBlock(position.name, position.filled, position.slots)}
                </SubHeading>
                <ul className="space-y-2">
                  {position.assignments.map((assignment) => (
                    <AssignmentRow key={assignment.assignmentId} slug={slug} assignment={assignment} positionName={position.name} canAct={canAct} />
                  ))}
                  {Array.from({ length: open }).map((_, i) => (
                    <li key={`open-${i}`} className="rounded-lg border border-dashed border-border px-3 py-3 text-base text-muted-foreground" data-testid="open-row">
                      {BOARD_COPY.openRow}
                    </li>
                  ))}
                </ul>
                {canAct && (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <PersonPickerDialog
                      slug={slug}
                      eventId={eventId}
                      groupId={team.groupId}
                      positionId={position.positionId}
                      positionName={position.name}
                    />
                    <GuestForm
                      slug={slug}
                      eventId={eventId}
                      groupId={team.groupId}
                      positionId={position.positionId}
                      positionName={position.name}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
