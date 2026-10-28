/**
 * Every slug that has ever been published or planned. APPEND-ONLY: a slug is a URL people
 * bookmark and print (P3-7). check:help H3 fails when a slug here is neither a current slug,
 * an alias, nor a planned slug a published page `replaces`, and when a published or planned
 * slug is missing from here. A removal is a retired URL and needs an alias or `replaces`.
 */
export const SLUG_HISTORY: readonly string[] = [];
