import { Badge } from "@/components/ui/badge";
import { STATE } from "@/lib/oversight/copy";

/**
 * A section (or a block on a building) the viewer's keys do not cover: a visible
 * "Locked" card naming the permission and who can give it, never hidden (a hidden
 * section is a "why can't I see this" ticket). The wording is the design's C2.
 */
export function LockedSection({ need }: { need: "manage" | "finance" }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-border bg-muted/30 p-4 sm:flex-row sm:items-start">
      <Badge variant="outline">{STATE.lockedBadge}</Badge>
      <p className="text-sm text-muted-foreground">{need === "manage" ? STATE.lockedManage : STATE.lockedFinance}</p>
    </div>
  );
}
