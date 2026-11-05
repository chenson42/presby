/**
 * Catalog keys and portal tile keys no published help page covers, each with a reason
 * (P3-16). SHRINK-ONLY: coverage.test.ts pins `length` to a number it cannot exceed, so
 * adding an entry means editing that number in the same diff; a removal is free. Planned and
 * pending pages never count as coverage.
 *
 * The 16 entries that remain are decisions, each with its reason (Batch 5b deleted the 13 placeholders
 * that its pages cover). Worship Increment 1 (docs/work-log/2026-11-04-worship-inc1.md) adds THREE
 * temporary entries (`org_portal.worship`, `tile:worship-admin`, and the re-reasoned `tile:worship`):
 * its three help pages are Batch 6's, in the same pipeline, and Batch 6 deletes all three entries and
 * lowers the pin in coverage.test.ts.
 */
export interface CoverageAllowlistEntry {
  key: string;
  reason: string;
}

export const COVERAGE_ALLOWLIST: readonly CoverageAllowlistEntry[] = [
  // Deliberately undocumented (Phase 1 Q5, Q6, P3-12): the follow-up documentation pass shrinks these.
  { key: "org_portal.giving", reason: "Treasurer and giving pages are deferred until a live Stripe test and the statements gate are confirmed (Phase 1 Q5, P3-12)." },
  { key: "tile:giving", reason: "Giving: deferred with the treasurer pages (Phase 1 Q5, P3-12)." },
  { key: "tile:giving-admin", reason: "Manage giving: deferred with the treasurer pages (Phase 1 Q5, P3-12)." },
  { key: "org_portal.mail_domain", reason: "Church email domains are not built; Track F Increment 2. The Features page shows it only as a toggle the team turns on." },
  { key: "org_portal.sensitive_info", reason: "Shipped, no help page yet; the first follow-up documentation pass writes it and shrinks this list." },
  { key: "org_portal.parishes", reason: "Shipped, no help page yet; the first follow-up documentation pass writes it and shrinks this list." },
  { key: "tile:groups", reason: "Shipped, no help page yet; the first follow-up documentation pass writes it and shrinks this list." },
  { key: "tile:staff", reason: "Shipped, no help page yet; the first follow-up documentation pass writes it and shrinks this list." },
  { key: "tile:credentials", reason: "A presbytery surface; help is written for congregations (Phase 1 Q6)." },
  { key: "tile:oversight", reason: "A presbytery surface behind a flag that is off in production (Phase 1 Q6)." },
  { key: "tile:reports", reason: "A presbytery surface behind a flag that is off in production (Phase 1 Q6)." },
  { key: "tile:filings", reason: "A presbytery surface behind a flag that is off in production (Phase 1 Q6)." },
  { key: "tile:committees", reason: "A presbytery surface behind a flag that is off in production (Phase 1 Q6)." },
  { key: "tile:worship", reason: "Worship Increment 1: the help pages worship-serving-on-a-team and worship-scheduling-a-team are written in Batch 6 of this pipeline, which deletes this entry." },
  { key: "tile:worship-admin", reason: "Worship Increment 1: the help page worship-setting-up is written in Batch 6 of this pipeline, which deletes this entry." },
  { key: "org_portal.worship", reason: "Worship Increment 1: the help page worship-setting-up is written in Batch 6 of this pipeline, which deletes this entry." },
  { key: "tile:insights", reason: "A coming-soon stub; never documented as a feature." },
  { key: "tile:communications", reason: "A coming-soon stub; never documented as a feature." },
];
