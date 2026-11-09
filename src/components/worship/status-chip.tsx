import { Check, CircleDashed, Clock, UserRound, X } from "lucide-react";
import { BOARD_COPY } from "@/lib/worship/copy";
import type { AssignmentStatus, Reason } from "@/lib/worship/vocab";

/**
 * One assignment's state as text plus an icon - never colour alone (docs/ui-
 * standards.md, "Color alone is not a signal"; prints legibly in monochrome).
 * Copy G5: "Not sent yet", "Waiting for an answer", "Confirmed", "Declined",
 * "Declined: Away", "Guest". 14px (`text-sm`), the member-facing floor.
 */
export function StatusChip({
  status,
  declineReason = null,
  isGuest = false,
}: {
  status: AssignmentStatus;
  declineReason?: Reason | null;
  isGuest?: boolean;
}) {
  const chips = BOARD_COPY.chips;
  let label: string;
  let Icon = Clock;
  if (isGuest) {
    label = chips.guest;
    Icon = UserRound;
  } else if (status === "draft") {
    label = chips.draft;
    Icon = CircleDashed;
  } else if (status === "requested") {
    label = chips.requested;
    Icon = Clock;
  } else if (status === "confirmed") {
    label = chips.confirmed;
    Icon = Check;
  } else {
    label = declineReason ? chips.declinedWithReason(declineReason) : chips.declined;
    Icon = X;
  }
  return (
    <span
      data-testid="status-chip"
      data-status={isGuest ? "guest" : status}
      // ui-ok: a status tag at 14px (the member-facing floor); <Badge> is 12px and nowrap, which this tag must not be
      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-sm font-medium text-foreground"
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span>{label}</span>
    </span>
  );
}
