import { BOARD_COPY } from "@/lib/worship/copy";
import type { BoardAssignment } from "@/lib/worship/reads";
import { ReachNote } from "./reach-note";
import { RecordResponseDialog } from "./record-response-dialog";
import { RemoveAssignmentDialog } from "./remove-assignment-dialog";
import { StatusChip } from "./status-chip";

/**
 * One person (or guest) in one position on the board (Copy G5): the name, the status
 * as text plus an icon, why they were or were not emailed, who recorded their answer
 * and, for someone who may schedule this team on a service that is still ahead,
 * "Record answer" and "Remove". The draft of someone who may be under 18 says up
 * front that they will not get an email; after a Send the stored reach note says it.
 *
 * Server component; the two buttons are client dialogs.
 */
export function AssignmentRow({
  slug,
  assignment,
  positionName,
  canAct,
}: {
  slug: string;
  assignment: BoardAssignment;
  positionName: string;
  /** The viewer may schedule this team and the service is neither cancelled nor started. */
  canAct: boolean;
}) {
  const sent = assignment.status !== "draft";
  const canRecord = canAct && !assignment.isGuest && sent;
  return (
    <li className="space-y-2 rounded-lg border border-border bg-card p-3" data-testid="assignment-row" data-assignment-id={assignment.assignmentId}>
      <p className="text-base font-medium [overflow-wrap:anywhere]">{assignment.name}</p>
      <StatusChip status={assignment.status} declineReason={assignment.declineReason} isGuest={assignment.isGuest} />
      {sent && !assignment.isGuest ? <ReachNote outcome={assignment.noticeOutcome} /> : null}
      {!sent && assignment.mayBeUnder18 ? (
        <p className="text-sm text-muted-foreground">{BOARD_COPY.picker.mayBeUnder18}</p>
      ) : null}
      {assignment.recordedBy ? (
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]" data-testid="recorded-by">
          {BOARD_COPY.record.recordedBy(assignment.recordedBy)}
        </p>
      ) : null}
      {canAct && (
        <div className="flex flex-col gap-2 sm:flex-row">
          {canRecord && <RecordResponseDialog slug={slug} assignmentId={assignment.assignmentId} personName={assignment.name} />}
          <RemoveAssignmentDialog
            slug={slug}
            assignmentId={assignment.assignmentId}
            personName={assignment.name}
            positionName={positionName}
            wasSent={sent}
          />
        </div>
      )}
    </li>
  );
}
