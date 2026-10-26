/**
 * The uuid-shape gate in front of every public asset read (F289,
 * DECISION-277). Pure and free of `server-only`, so the route, the adapter and
 * the tests share one definition.
 *
 * A blob key is the row's own uuid (blob-store.ts). The public asset route
 * validates its `[key]` here BEFORE any read, so a junk key never reaches
 * Postgres (a cast error would be a free log-noise lever for a prober) and a
 * case variant of a uuid collapses onto the one canonical lowercase form, so
 * there is no second answer path for the same key.
 *
 * Any hex version/variant digit is accepted (fixtures use
 * `e2e93001-0000-4000-8000-...`); ASCII hex only. `$` without the `m` flag does
 * not match before a trailing newline in JavaScript, so `"<uuid>\n"` is
 * rejected (pinned by blob-key.test.ts).
 */
const BLOB_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The canonical (lowercase) key, or `null` if `raw` is not a hyphenated 36-character uuid. */
export function parseBlobKey(raw: string): string | null {
  return BLOB_KEY.test(raw) ? raw.toLowerCase() : null;
}
