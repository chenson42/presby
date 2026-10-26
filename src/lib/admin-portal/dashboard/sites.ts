import "server-only";
import { listSitesForAdmin } from "@/lib/sites";
import { readCard, type CardResult } from "./read-card";

/**
 * Sites card: the destination's own list (`listSitesForAdmin`, one statement)
 * reduced to counts by status, so the card and /admin/sites cannot disagree
 * (E21). Only the three counts leave the reader: no repo, slug or name.
 */
export interface SitesCard {
  live: number;
  provisioning: number;
  suspended: number;
}

export function readSitesCard(): Promise<CardResult<SitesCard>> {
  return readCard("sites", async () => {
    const sites = await listSitesForAdmin();
    return {
      live: sites.filter((s) => s.status === "live").length,
      provisioning: sites.filter((s) => s.status === "provisioning").length,
      suspended: sites.filter((s) => s.status === "suspended").length,
    };
  });
}
