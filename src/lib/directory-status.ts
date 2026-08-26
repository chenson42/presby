/**
 * `DIRECTORY_STATUSES`/`DirectoryStatus` live in their own file, deliberately
 * NOT `src/lib/directory.ts` (which starts with `import "server-only"`) —
 * plain presentational components (`members-list.tsx`, `directory-grid.tsx`)
 * need this exact value at runtime to render a `<select>`'s options, and
 * `directory.ts`'s own `server-only` guard would otherwise force every such
 * component (and its jsdom test) to transitively pull in the whole
 * DB-access module just for a constant array. `directory.ts` re-exports
 * both from here, so callers reading through the DB module's own barrel
 * see no difference.
 */

/** The four `current_roll` values a directory-eligible membership can hold
 * (mirrors `directoryEligibilityWhereSql()`'s own OR-of-four in
 * `directory.ts`) — the exhaustive status-filter option set. Not a schema
 * enum re-export: scoped to what directory ELIGIBILITY already recognizes,
 * not every `current_roll` value the roll model can hold in principle. */
export const DIRECTORY_STATUSES = [
  "active",
  "baptized",
  "affiliate",
  "other_participant",
] as const;

export type DirectoryStatus = (typeof DIRECTORY_STATUSES)[number];
