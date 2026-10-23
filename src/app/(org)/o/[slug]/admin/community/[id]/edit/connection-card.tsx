import { FormattedDate } from "@/components/shared/formatted-date";
import { CONNECTION_LABELS } from "@/lib/community-labels";
import type { CommunityStatus } from "@/lib/community";
import {
  ROLL_ACTION_KIND_LABELS,
  type RollActionKind,
} from "@/lib/roll-action-kinds";

/**
 * The person's CONNECTION to this organization in words (DECISION-200): how
 * they are connected now, the latest entry recorded without approval, any
 * entries waiting for the Session, and, for a participant, the note that the
 * way to become a member is a proposal, not a removal. A server component: it
 * only renders what `getCommunityStatus()` and the pending list returned.
 * Controls (Remove, Undo) are the client `ParticipantControls` the page places
 * beneath it.
 */
export function ConnectionCard({
  status,
  pendingActions,
}: {
  status: CommunityStatus;
  pendingActions: Array<{ id: string; kind: RollActionKind; effectiveDate: string }>;
}) {
  return (
    <div className="space-y-3" data-testid="connection-card">
      <h2 className="text-lg font-semibold">Connection</h2>
      <p className="text-base">
        <span className="font-medium">{CONNECTION_LABELS[status.connection]}</span>
        {status.connection === "participant" && status.currentRollSince && (
          <span className="text-muted-foreground">
            {" "}
            since <FormattedDate value={status.currentRollSince} mode="date" />
          </span>
        )}
        {(status.connection === "former_participant" ||
          status.connection === "ended") &&
          status.endedOn && (
            <span className="text-muted-foreground">
              {" "}
              on <FormattedDate value={status.endedOn} mode="date" />
            </span>
          )}
      </p>

      {status.latestAction?.onRecordKind && (
        <p className="text-sm text-muted-foreground">
          Latest entry: {ROLL_ACTION_KIND_LABELS[status.latestAction.kind]}, effective{" "}
          <FormattedDate value={status.latestAction.effectiveDate} mode="date" />
          . Recorded without approval.
        </p>
      )}

      {pendingActions.map((action) => (
        <p
          key={action.id}
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        >
          Waiting for the Session to approve: {ROLL_ACTION_KIND_LABELS[action.kind]}{" "}
          effective <FormattedDate value={action.effectiveDate} mode="date" />.
        </p>
      ))}

      {status.connection === "participant" && (
        <p className="text-sm text-muted-foreground">
          To receive this person as a member, record a profession of faith or
          another gain below. No removal is needed.
        </p>
      )}
    </div>
  );
}
