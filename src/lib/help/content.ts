import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { HELP_PAGES } from "./registry";
import { applyHelpTokens } from "./tokens";
import { publishedPages } from "./select";
import type { HelpContentEntry, HelpEntry } from "./types";

/**
 * The build-time loader (R3). Reads `src/content/help/<slug>.md` with node:fs at BUILD only:
 * every route that calls it is `dynamic = "error"` with `dynamicParams = false`, so nothing here
 * runs per request and no file needs tracing into a function. The path is built from the
 * registry entry's slug, never from the request: the lookup is among published entries first,
 * so a traversal string, a pending slug, a planned slug and a typo are all simply `null`.
 */
export interface LoadedHelpPage {
  entry: HelpContentEntry;
  markdown: string;
}

export function loadHelpPageFrom(
  slug: string,
  opts: { pages: readonly HelpEntry[]; dir: string },
): LoadedHelpPage | null {
  const entry = publishedPages(opts.pages).find((p) => p.slug === slug);
  if (!entry) return null;
  const raw = readFileSync(path.join(opts.dir, `${entry.slug}.md`), "utf8");
  return { entry, markdown: applyHelpTokens(raw) };
}

export function loadHelpPage(slug: string): LoadedHelpPage | null {
  return loadHelpPageFrom(slug, { pages: HELP_PAGES, dir: path.join(process.cwd(), "src", "content", "help") });
}
