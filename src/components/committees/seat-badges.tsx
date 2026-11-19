import { Badge } from "@/components/ui/badge";
import { STATUS_BADGE } from "@/lib/committees/copy";
import type { SeatRow } from "@/lib/committees/reads";
import { RoleBadge } from "./role-badge";

/** The role badge plus the two status badges a person's own records can add. Role is never hidden. */
export function SeatBadges({ seat }: { seat: Pick<SeatRow, "role" | "connected" | "deceased"> }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <RoleBadge role={seat.role} />
      {seat.connected ? null : <Badge variant="outline">{STATUS_BADGE.noLongerConnected}</Badge>}
      {seat.deceased ? <Badge variant="outline">{STATUS_BADGE.deceased}</Badge> : null}
    </span>
  );
}
