import { AlertTriangle, CheckCircle2, CircleDashed, HelpCircle, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { RecordStatus } from "@/lib/domains/checklist";

/**
 * A DNS record's status as a chip: an icon, the words, never colour alone
 * (docs/ui-standards.md; G11). Platform-fixed tokens only, so the meaning is
 * identical on a congregation's branded portal and on the platform admin.
 */

const CHIP: Record<RecordStatus, { label: string; icon: ReactNode; variant: "secondary" | "outline" | "destructive" }> = {
  correct: { label: "Correct", icon: <CheckCircle2 aria-hidden />, variant: "secondary" },
  missing: { label: "Missing", icon: <CircleDashed aria-hidden />, variant: "outline" },
  wrong_value: { label: "Wrong value", icon: <XCircle aria-hidden />, variant: "destructive" },
  conflicting: { label: "Conflicting", icon: <AlertTriangle aria-hidden />, variant: "destructive" },
  unknown: { label: "Couldn't check", icon: <HelpCircle aria-hidden />, variant: "outline" },
};

export const RECORD_STATUS_LABELS: Record<RecordStatus, string> = {
  correct: CHIP.correct.label,
  missing: CHIP.missing.label,
  wrong_value: CHIP.wrong_value.label,
  conflicting: CHIP.conflicting.label,
  unknown: CHIP.unknown.label,
};

export function DomainStatusChip({ status }: { status: RecordStatus }) {
  const chip = CHIP[status];
  return (
    <Badge variant={chip.variant} data-status={status} className="min-h-7 px-2.5 text-sm">
      {chip.icon}
      {chip.label}
    </Badge>
  );
}

/** A host's lifecycle phase as a chip (the card header). */
export function DomainPhaseChip({
  tone,
  children,
}: {
  tone: "good" | "wait" | "bad";
  children: ReactNode;
}) {
  const icon =
    tone === "good" ? <CheckCircle2 aria-hidden /> : tone === "bad" ? <AlertTriangle aria-hidden /> : <CircleDashed aria-hidden />;
  return (
    <Badge variant={tone === "bad" ? "destructive" : tone === "good" ? "secondary" : "outline"} className="min-h-7 px-2.5 text-sm">
      {icon}
      {children}
    </Badge>
  );
}
