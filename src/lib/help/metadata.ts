import type { Metadata } from "next";
import { HELP_COPY } from "./copy";
import type { HelpContentEntry, HelpPlannedEntry } from "./types";

/**
 * Per-page metadata (R11, C23): each page sets its own title and openGraph so a shared link
 * previews as the page, not as the site. Pages inherit the root layout's `noindex`; planned
 * pages add it explicitly and permanently, so a search result is never a how-to for
 * something that does not exist.
 */
export function pageMetadata(entry: Pick<HelpContentEntry, "title" | "summary">): Metadata {
  return {
    title: entry.title,
    description: entry.summary,
    openGraph: { title: entry.title, description: entry.summary },
  };
}

export function plannedMetadata(entry: Pick<HelpPlannedEntry, "title" | "summary">): Metadata {
  const title = HELP_COPY.plannedTabTitle(entry.title);
  return {
    title,
    description: entry.summary,
    openGraph: { title, description: entry.summary },
    robots: { index: false, follow: false },
  };
}
