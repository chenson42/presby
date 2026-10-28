/**
 * Every slug that has ever been published or planned. APPEND-ONLY: a slug is a URL people
 * bookmark and print (P3-7). check:help H3 fails when a slug here is neither a current slug,
 * an alias, nor a planned slug a published page `replaces`, and when a published or planned
 * slug is missing from here. A removal is a retired URL and needs an alias or `replaces`.
 */
export const SLUG_HISTORY: readonly string[] = [
  // Batch 5a (2026-10-28): the first ten pages.
  "what-presbyportal-does",
  "how-a-congregation-gets-started",
  "signing-in",
  "using-your-code",
  "your-account",
  "home-and-switching-congregations",
  "why-cant-i-see-this",
  "using-the-directory",
  "getting-help",
  "turning-features-on-and-off",
];
