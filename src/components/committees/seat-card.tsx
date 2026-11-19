import type { ReactNode } from "react";
import type { SeatRow } from "@/lib/committees/reads";
import { SeatBadges } from "./seat-badges";
import { SeatDates } from "./seat-dates";

/** One seat as a card (below `sm`): name, role and status badges, date lines, then the actions the caller supplies. Nothing is hidden at 360px. */
export function SeatCard({ seat, today, actions }: { seat: SeatRow; today: string; actions: ReactNode }) {
  return (
    <li className="space-y-2 rounded-lg border border-border p-3">
      <p className="font-medium [overflow-wrap:anywhere]">{seat.displayName}</p>
      <SeatBadges seat={seat} />
      <div>
        <SeatDates seat={seat} today={today} />
      </div>
      {actions}
    </li>
  );
}
