import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OversightRow } from "@/lib/presbytery";
import { FactList } from "./fact-list";
import { LockedSection } from "./locked-section";
import { SectionFrame } from "./section-frame";
import { SectionLoadError } from "./section-load-error";
import type { SectionState } from "./section-state";

const VIABILITY_LABELS: Record<number, string> = { 1: "At risk", 2: "Fair", 3: "Healthy" };

/** The same badge the list uses: at risk is the one state a clerk should never mistake for routine. */
export function ViabilityBadge({ score }: { score: number | null }) {
  if (score === null) return <Badge variant="outline">Not yet assessed</Badge>;
  return (
    <Badge variant={score === 1 ? "destructive" : score === 2 ? "secondary" : "default"}>{VIABILITY_LABELS[score] ?? score}</Badge>
  );
}

/** The Assessment section (C4): viability, redevelopment notes, property notes and the map location, from the existing `congregation_oversight` row. */
export function AssessmentSection({
  slug,
  aboutOrgId,
  state,
}: {
  slug: string;
  aboutOrgId: string;
  state: SectionState<OversightRow>;
}) {
  const recordHref = `/o/${slug}/admin/oversight/${aboutOrgId}`;
  const row = state.kind === "ok" ? state.data : null;
  const action = row ? (
    <Button asChild variant="outline" className="min-h-11">
      <Link href={`${recordHref}/assessment/edit`}>Edit assessment</Link>
    </Button>
  ) : undefined;
  return (
    <SectionFrame id="assessment" title="Assessment" action={action}>
      {state.kind === "locked" ? <LockedSection need="manage" /> : null}
      {state.kind === "error" ? <SectionLoadError href={recordHref} /> : null}
      {row ? (
        <FactList
          facts={[
            { label: "Viability", value: <ViabilityBadge score={row.viabilityScore} /> },
            { label: "Redevelopment notes", value: row.redevelopmentNotes },
            { label: "Property notes", value: row.buildingsNotes },
            {
              label: "Map location",
              value: row.latitude !== null && row.longitude !== null ? `${row.latitude}, ${row.longitude}` : "Not set",
            },
          ]}
        />
      ) : null}
    </SectionFrame>
  );
}
