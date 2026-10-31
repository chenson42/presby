/**
 * Posting slugs - pure. A slug is the posting's public address segment
 * (`/careers/<slug>`), fixed once the posting is first published. The database
 * shape is `^[a-z0-9]+(-[a-z0-9]+)*$`, 1 to 80 characters (CHECK
 * `job_postings_slug_shape`).
 */
import { SLUG_MAX } from "./contract";

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The longest slug the title generator produces, leaving room for a `-NN` suffix under `SLUG_MAX`. */
const GENERATED_MAX = 60;
const FALLBACK = "opening";

export function isValidSlug(value: string): boolean {
  return typeof value === "string" && value.length >= 1 && value.length <= SLUG_MAX && SLUG_RE.test(value);
}

/**
 * NFKD, strip diacritics, lower-case, every run of non-alphanumerics to one
 * hyphen, trim hyphens, cut at 60 on a hyphen boundary (a single unbroken word
 * longer than 60 is cut hard), and fall back to "opening" when nothing is left
 * (an all-symbol or non-Latin title).
 */
export function slugFromTitle(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base === "") return FALLBACK;
  if (base.length <= GENERATED_MAX) return base;
  const head = base.slice(0, GENERATED_MAX);
  // Cutting exactly before a hyphen already ends on a word boundary.
  if (base[GENERATED_MAX] === "-") return head;
  const lastHyphen = head.lastIndexOf("-");
  return lastHyphen > 0 ? head.slice(0, lastHyphen) : head;
}

/** `base`, `base-2`, `base-3` ... for the collision loop. `attempt` 1 is the base itself. */
export function slugCandidate(base: string, attempt: number): string {
  return attempt <= 1 ? base : `${base}-${attempt}`;
}
