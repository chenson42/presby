import type { AnchorOf, PlannedSlug, PublishedSlug } from "./registry";

/**
 * The only place an in-app help link is built (R12, DECISION-293). Typed against the
 * registry, so a typo, a pending slug or an undeclared anchor is a compile error; a
 * source scan (check:help H16) bans a hand-built "/help…" literal elsewhere.
 * Type-only import of the registry: the runtime is two string concatenations.
 */
export const HELP_INDEX_HREF = "/help" as const;

export function helpHref<S extends PublishedSlug>(slug: S, anchor?: AnchorOf<S>): string {
  return anchor ? `${HELP_INDEX_HREF}/${slug}#${anchor}` : `${HELP_INDEX_HREF}/${slug}`;
}

export function plannedHref(slug: PlannedSlug): string {
  return `${HELP_INDEX_HREF}/planned/${slug}`;
}
