import "server-only";
import { countDomainsNeedingAttention } from "@/lib/domains/platform-read";
import { readCard, type CardResult } from "./read-card";

/** Domains card: hostnames needing attention, by the same predicate as the destination list's "attention" filter. */
export interface DomainsCard {
  needAttention: number;
}

export function readDomainsCard(): Promise<CardResult<DomainsCard>> {
  return readCard("domains", async () => ({ needAttention: await countDomainsNeedingAttention() }));
}
