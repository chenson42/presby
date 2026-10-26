/**
 * The pure rules for which events are on the public website - shared by the
 * confirmation count (`getEvent`'s `seriesWebsite`) and the write
 * (`setSeriesWebsiteListing`), so the number an editor is shown is the number
 * of rows the action changes. No `server-only`, no database.
 *
 * docs/work-log/2026-10-25-public-events-calendar.md, Phase 3 "API Contract",
 * Phase 2 R5; DECISION-238, DECISION-240, DECISION-241; F251, F252.
 *
 * `startsAt` is a wall-clock `Date` (typed digits in the UTC fields, see
 * `src/lib/events/wall-clock.ts`), compared only as a `Date` value, never read
 * through a getter, so the process time zone cannot matter.
 */

export interface SeriesRow {
  id: string;
  startsAt: Date;
  isPublic: boolean;
  websiteListed: boolean;
  cancelled: boolean;
}

/**
 * The value that may be stored: the editor's wish AND the event being open to
 * everyone. A members-only event is never listed whatever was posted, and the
 * same UPDATE that makes a listed event members-only clears the listing, so the
 * table CHECK (`events_website_requires_public`) is never tripped by a routine
 * edit (F251).
 */
export function deriveListed(wanted: boolean, isPublic: boolean): boolean {
  return wanted && isPublic;
}

export interface SeriesListingPlan {
  /** The rows the write changes (and the confirm counts). */
  ids: string[];
  /** Rows at or after the anchor already in the target state. */
  unchanged: number;
  skippedCancelled: number;
  /** Only ever non-zero when listing: a members-only row cannot be listed. */
  skippedMembersOnly: number;
}

/**
 * "This and all later events in the series" for the anchor row. Later means
 * `startsAt >=` the anchor's. Cancelled rows are skipped and counted; when
 * listing, members-only rows are skipped and counted; a row already in the
 * target state is `unchanged`. An unknown anchor plans nothing.
 */
export function planSeriesListing(
  rows: readonly SeriesRow[],
  anchorId: string,
  listed: boolean,
): SeriesListingPlan {
  const plan: SeriesListingPlan = {
    ids: [],
    unchanged: 0,
    skippedCancelled: 0,
    skippedMembersOnly: 0,
  };
  const anchor = rows.find((r) => r.id === anchorId);
  if (!anchor) return plan;

  const ordered = [...rows].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id),
  );
  for (const r of ordered) {
    if (r.startsAt.getTime() < anchor.startsAt.getTime()) continue;
    if (r.cancelled) {
      plan.skippedCancelled += 1;
      continue;
    }
    if (listed && !r.isPublic) {
      plan.skippedMembersOnly += 1;
      continue;
    }
    if (r.websiteListed === listed) {
      plan.unchanged += 1;
      continue;
    }
    plan.ids.push(r.id);
  }
  return plan;
}

/**
 * What a new occurrence added to a series inherits: the `websiteListed` of the
 * LATEST non-cancelled occurrence (the parent included), or false when there is
 * none. Never the parent row alone - the parent is usually the oldest row, and
 * copying from it would re-list occurrences after a "this and all later"
 * unlisting (F252). The caller ANDs the result with the inherited `is_public`.
 */
export function inheritedListing(rows: readonly SeriesRow[]): boolean {
  let latest: SeriesRow | null = null;
  for (const r of rows) {
    if (r.cancelled) continue;
    if (
      latest === null ||
      r.startsAt.getTime() > latest.startsAt.getTime() ||
      (r.startsAt.getTime() === latest.startsAt.getTime() && r.id > latest.id)
    ) {
      latest = r;
    }
  }
  return latest?.websiteListed ?? false;
}
