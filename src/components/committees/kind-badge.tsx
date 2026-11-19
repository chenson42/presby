import { Badge } from "@/components/ui/badge";
import { COMMITTEE_KINDS, type CommitteeKind } from "@/lib/committees/contract";
import { PAGE } from "@/lib/committees/ui-copy";

/** A committee's label ("Required", "Standing", "Ad hoc"), or "Not yet labelled" when it has none. */
export function KindBadge({ kind }: { kind: CommitteeKind | null }) {
  if (kind === null) return <Badge variant="outline">{PAGE.notLabelled}</Badge>;
  const label = COMMITTEE_KINDS.find((k) => k.value === kind)?.label ?? kind;
  return <Badge variant="secondary">{label}</Badge>;
}
