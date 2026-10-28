import type { HelpEntry } from "./types";

/**
 * Every help page, in no particular order (select.ts orders them). Increment 1's pages
 * land in Batches 5a to 5c; the registry starts empty and every rule is vacuously true.
 *
 * Relative imports only (see types.ts); no fs, no `@/` runtime import. Page bodies are
 * src/content/help/<slug>.md, read at build by content.ts.
 */
export const HELP_PAGES = [] as const satisfies readonly HelpEntry[];

type Pages = (typeof HELP_PAGES)[number];

export type PublishedSlug = Extract<Pages, { status: "published" }>["slug"];
export type PlannedSlug = Extract<Pages, { status: "planned" }>["slug"];
/** The anchors a published slug declares; `never` when it declares none. */
export type AnchorOf<S extends PublishedSlug> =
  Extract<Pages, { slug: S }> extends { anchors: readonly (infer A)[] } ? A : never;
