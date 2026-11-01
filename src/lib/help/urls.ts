import type { AnchorOf, PlannedSlug, PublishedSlug } from "./registry";

/**
 * The only place an in-app help link is built (R12, DECISION-293). Typed against the
 * registry, so a typo, a pending slug or an undeclared anchor is a compile error; a
 * source scan (check:help H16) bans a hand-built "/help…" literal elsewhere.
 * Type-only import of the registry: the runtime is two string concatenations.
 */
export const HELP_INDEX_HREF = "/help" as const;

/**
 * The contact form (Increment 2): a route, not a registry page, so it is not typed against the
 * registry. `links.ts` FIXED_INTERNAL admits exactly this path, and RESERVED in checks.ts keeps a
 * page from taking the slug.
 */
export const HELP_CONTACT_HREF = "/help/contact" as const;

export function helpHref<S extends PublishedSlug>(slug: S, anchor?: AnchorOf<S>): string {
  return anchor ? `${HELP_INDEX_HREF}/${slug}#${anchor}` : `${HELP_INDEX_HREF}/${slug}`;
}

export function plannedHref(slug: PlannedSlug): string {
  return `${HELP_INDEX_HREF}/planned/${slug}`;
}

/**
 * For lists driven by the registry itself (the index, previous and next, the planned list):
 * the slug comes from a registry entry, so the typed overloads above add nothing and could not
 * be satisfied from a `string`. Never call these with a slug typed by hand; use `helpHref`.
 */
export function entryHref(entry: { slug: string }): string {
  return `${HELP_INDEX_HREF}/${entry.slug}`;
}

export function plannedEntryHref(entry: { slug: string }): string {
  return `${HELP_INDEX_HREF}/planned/${entry.slug}`;
}

export const PLANNED_INDEX_HREF = `${HELP_INDEX_HREF}/planned` as const;
