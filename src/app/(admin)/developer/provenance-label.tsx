import { Cog, Hourglass, ListChecks, PenLine } from "lucide-react";
import {
  PROVENANCE,
  type Provenance,
  type ProvenanceKey,
} from "@/lib/developer-portal/provenance";

const ICONS: Record<Provenance["icon"], typeof Cog> = {
  Cog,
  ListChecks,
  PenLine,
  Hourglass,
};

/**
 * Where a section's content comes from, as text plus an icon (never colour
 * alone). One component so the four labels cannot drift apart; the wording
 * lives in `PROVENANCE`.
 */
export function ProvenanceLabel({ kind }: { kind: ProvenanceKey }) {
  const { label, icon } = PROVENANCE[kind];
  const Icon = ICONS[icon];
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs font-medium text-foreground">
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}
