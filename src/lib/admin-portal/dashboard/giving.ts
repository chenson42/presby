import "server-only";
import { readIngestHealthSummary, type IngestHealthSummary } from "@/lib/admin/giving-ingest-health";
import { readCard, type CardResult } from "./read-card";

/**
 * Giving notices card: one call of `presby_giving_ingest_health()`, reduced to
 * four numbers by the summary that lives in the one file allowed to name the
 * function (check:giving-boundaries B6). No amount, donor or event body exists in
 * that function's output.
 */
export type GivingCard = IngestHealthSummary;

export function readGivingCard(): Promise<CardResult<GivingCard>> {
  return readCard("giving", () => readIngestHealthSummary());
}
