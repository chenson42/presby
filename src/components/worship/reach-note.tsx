import { BOARD_COPY } from "@/lib/worship/copy";
import type { NoticeOutcome } from "@/lib/worship/vocab";

/**
 * The stored `notice_outcome` as a sentence (Copy G5): why a person was or was not
 * emailed at Send. Shown only on a row that has been sent.
 */
export function ReachNote({ outcome }: { outcome: NoticeOutcome | null }) {
  if (!outcome) return null;
  const copy = BOARD_COPY.reach;
  const text =
    outcome === "emailed"
      ? copy.emailed
      : outcome === "guardian"
        ? copy.guardian
        : outcome === "no_address"
          ? copy.noAddress
          : copy.doNotContact;
  return (
    <p data-testid="reach-note" data-outcome={outcome} className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
      {text}
    </p>
  );
}
