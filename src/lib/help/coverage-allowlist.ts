/**
 * Catalog keys and portal tile keys no published help page covers, each with a reason
 * (P3-16). SHRINK-ONLY: coverage.test.ts pins `length` to a number it cannot exceed, so
 * adding an entry means editing that number in the same diff; a removal is free. Planned and
 * pending pages never count as coverage.
 *
 * Entries marked "Written later in this increment" are not decisions: the page that covers
 * them is drafted in Batch 5b of the user-help pipeline, and the commit that publishes
 * the page deletes the entry (and lowers the pin).
 */
export interface CoverageAllowlistEntry {
  key: string;
  reason: string;
}

const LATER_5B = "Written later in this increment (Batch 5b); deleted in the commit that publishes its page.";

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
  { key: "tile:worship", reason: "A coming-soon stub; never documented as a feature." },
  { key: "tile:insights", reason: "A coming-soon stub; never documented as a feature." },
  { key: "tile:communications", reason: "A coming-soon stub; never documented as a feature." },
  // Batch 5b pages.
  { key: "org_portal.members_create", reason: LATER_5B },
  { key: "org_portal.calendar", reason: LATER_5B },
  { key: "org_portal.public_calendar", reason: LATER_5B },
  { key: "org_portal.careers", reason: LATER_5B },
  { key: "org_portal.domains", reason: LATER_5B },
  { key: "tile:members", reason: LATER_5B },
  { key: "tile:roles", reason: LATER_5B },
  { key: "tile:officers", reason: LATER_5B },
  { key: "tile:branding", reason: LATER_5B },
  { key: "tile:calendar", reason: LATER_5B },
  { key: "tile:events", reason: LATER_5B },
  { key: "tile:careers", reason: LATER_5B },
  { key: "tile:domains", reason: LATER_5B },
];
