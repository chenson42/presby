import type { SeatState } from "@/lib/committees/derive";
import type { SeatRow } from "@/lib/committees/reads";
import { SeatActions } from "./seat-actions";
import { SeatBadges } from "./seat-badges";
import { SeatDates } from "./seat-dates";

/** One seat as a card (below `sm`): name, role and status badges, date lines, then the actions. Nothing is hidden at 360px. */
export function SeatCard({
  slug,
  committeeId,
  committeeName,
  seat,
  state,
  today,
  carries,
  canWrite,
}: {
  slug: string;
  committeeId: string;
  committeeName: string;
  seat: SeatRow;
  state: SeatState;
  today: string;
  carries: boolean;
  canWrite: boolean;
}) {
  return (
    <li className="space-y-2 rounded-lg border border-border p-3">
      <p className="font-medium [overflow-wrap:anywhere]">{seat.displayName}</p>
      <SeatBadges seat={seat} />
      <div>
        <SeatDates seat={seat} today={today} />
      </div>
      {canWrite ? (
        <SeatActions
          slug={slug}
          committeeId={committeeId}
          committeeName={committeeName}
          seat={seat}
          state={state}
          today={today}
          carries={carries}
          idPrefix="card"
        />
      ) : null}
    </li>
  );
}
