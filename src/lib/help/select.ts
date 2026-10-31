import { HELP_PAGES } from "./registry";
import {
  HELP_AUDIENCES,
  HELP_AUDIENCE_LABELS,
  type HelpAudience,
  type HelpContentEntry,
  type HelpEntry,
  type HelpPlannedEntry,
} from "./types";

/**
 * Pure selectors over the registry. Every function takes the page list as an optional
 * last argument (default: the real registry) so tests and check:help feed fixtures.
 * Relative imports only (next.config.ts loads this file).
 */

const byOrder = (a: HelpEntry, b: HelpEntry) => a.order - b.order;

export function publishedPages(pages: readonly HelpEntry[] = HELP_PAGES): HelpContentEntry[] {
  return pages.filter((p): p is HelpContentEntry => p.status === "published");
}

export function pendingPages(pages: readonly HelpEntry[] = HELP_PAGES): HelpContentEntry[] {
  return pages.filter((p): p is HelpContentEntry => p.status === "pending");
}

export function plannedPages(pages: readonly HelpEntry[] = HELP_PAGES): HelpPlannedEntry[] {
  return pages.filter((p): p is HelpPlannedEntry => p.status === "planned");
}

export interface IndexGroup {
  audience: HelpAudience;
  label: string;
  pages: HelpContentEntry[];
}

/** Published pages grouped by audience, in group order then `order`; empty groups omitted. */
export function indexGroups(pages: readonly HelpEntry[] = HELP_PAGES): IndexGroup[] {
  const published = publishedPages(pages);
  return HELP_AUDIENCES.map((audience) => ({
    audience,
    label: HELP_AUDIENCE_LABELS[audience],
    pages: published.filter((p) => p.audience === audience).sort(byOrder),
  })).filter((g) => g.pages.length > 0);
}

/** Previous and next published page within the page's audience group; never crosses a group. */
export function neighbours(
  slug: string,
  pages: readonly HelpEntry[] = HELP_PAGES,
): { previous: HelpContentEntry | null; next: HelpContentEntry | null } {
  const page = publishedPages(pages).find((p) => p.slug === slug);
  if (!page) return { previous: null, next: null };
  const group = publishedPages(pages)
    .filter((p) => p.audience === page.audience)
    .sort(byOrder);
  const i = group.findIndex((p) => p.slug === slug);
  return { previous: group[i - 1] ?? null, next: group[i + 1] ?? null };
}

export interface HelpRedirect {
  source: string;
  destination: string;
  permanent: true;
  has: [{ type: "host"; value: string }];
}

/**
 * Permanent redirects for retired URLs (P3-7): a published page's `aliases` and the
 * planned slugs it `replaces`. Every entry carries a host condition so a custom church
 * domain never serves one (F151). Pending pages are not live and redirect nothing.
 * `hostPattern` is the platform host (next.config.ts passes its own).
 */
export function helpRedirects(hostPattern: string, pages: readonly HelpEntry[] = HELP_PAGES): HelpRedirect[] {
  const out: HelpRedirect[] = [];
  const has: HelpRedirect["has"] = [{ type: "host", value: hostPattern }];
  for (const p of publishedPages(pages)) {
    for (const alias of p.aliases ?? []) {
      out.push({ source: `/help/${alias}`, destination: `/help/${p.slug}`, permanent: true, has });
    }
    for (const planned of p.replaces ?? []) {
      out.push({ source: `/help/planned/${planned}`, destination: `/help/${p.slug}`, permanent: true, has });
    }
  }
  return out;
}
