import { STATE } from "@/lib/oversight/copy";
import type { Provenance } from "@/lib/oversight/contract";

/** "Imported from an earlier record." on a row the owner-run import loaded. It stays after an edit (provenance is immutable). */
export function ImportedNote({ provenance }: { provenance: Provenance }) {
  if (provenance !== "imported") return null;
  return <p className="text-sm text-muted-foreground">{STATE.imported}</p>;
}
