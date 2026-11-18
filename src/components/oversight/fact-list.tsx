import type { ReactNode } from "react";
import { STATE } from "@/lib/oversight/copy";

export interface Fact {
  label: string;
  /** `null` or an empty string reads "Not recorded", never a zero or a blank. */
  value: ReactNode | null;
}

/** A `dl` of label and value rows. Long text wraps (no sideways scroll at 360px) and keeps its line breaks. */
export function FactList({ facts }: { facts: Fact[] }) {
  return (
    <dl className="space-y-3">
      {facts.map((fact) => {
        const empty = fact.value === null || fact.value === "";
        return (
          <div key={fact.label} className="grid gap-1 sm:grid-cols-[minmax(9rem,13rem)_1fr] sm:gap-4">
            <dt className="text-sm text-muted-foreground">{fact.label}</dt>
            <dd className={`min-w-0 whitespace-pre-line break-words text-sm ${empty ? "text-muted-foreground" : ""}`}>
              {empty ? STATE.notRecorded : fact.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
