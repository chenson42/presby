/**
 * The officer-office vocabulary: the ONE home of `OFFICER_OFFICES`,
 * `OFFICE_LABELS`, `SESSION_OFFICES`, `PASTOR_OFFICES` and `isSessionOffice()`
 * (docs/work-log/2026-10-22-founding-admin-directory.md, Increment 2 Phase 3
 * "Pure shared modules"; DECISION-206).
 *
 * Pure: no `server-only`, no database. `src/lib/officers.ts` (server) and
 * `admin/officers/office-labels.ts` (imported by client components, which may
 * not import a `server-only` module at runtime) both re-export from here, which
 * removes the documented duplicate: a new office is added in exactly one place.
 *
 * PINNED TO THE DATABASE by source-scan tests (`officer-offices.test.ts`):
 *   - `OFFICER_OFFICES` equals the `officer_terms_office_allowed` CHECK in
 *     `drizzle/0062_presby_session_approval.sql` and `listOfficerRoster()`'s
 *     `all_offices` values list;
 *   - `SESSION_OFFICES` equals the `-> 'session'` arms of
 *     `presby_sync_derived_group()`'s CASE in the same migration.
 * The array order is presentational; the pastor offices follow `ruling_elder`.
 */

export const OFFICER_OFFICES = [
  "ruling_elder",
  "installed_pastor",
  "co_pastor",
  "associate_pastor",
  "deacon",
  "clerk_of_session",
  "moderator",
  "treasurer",
  "trustee",
] as const;

export type OfficerOffice = (typeof OFFICER_OFFICES)[number];

export const OFFICE_LABELS: Record<OfficerOffice, string> = {
  ruling_elder: "Ruling Elder",
  installed_pastor: "Installed Pastor",
  co_pastor: "Co-Pastor",
  associate_pastor: "Associate Pastor",
  deacon: "Deacon",
  clerk_of_session: "Clerk of Session",
  moderator: "Moderator",
  treasurer: "Treasurer",
  trustee: "Trustee",
};

/**
 * The offices whose term seats the holder in the derived Session group
 * (G-3.0201: ruling elders in active service together with all installed
 * pastors and associate pastors; a co-pastor is an installed pastor).
 * `moderator` is deliberately absent: a moderator who is not a pastor has no
 * vote. Any role a congregation has bound to its Session group reaches these
 * people, so recording one of these terms is equivalent to a grant of whatever
 * the Session role carries (DECISION-205).
 */
export const SESSION_OFFICES = [
  "ruling_elder",
  "installed_pastor",
  "co_pastor",
  "associate_pastor",
] as const satisfies readonly OfficerOffice[];

export type SessionOffice = (typeof SESSION_OFFICES)[number];

/**
 * The pastor offices: congregation-only, recorded with `officers.manage`, held
 * by a person whose membership is with the presbytery (DECISION-206), so the
 * database refuses an OPEN term for a person on this congregation's roll.
 */
export const PASTOR_OFFICES = [
  "installed_pastor",
  "co_pastor",
  "associate_pastor",
] as const satisfies readonly SessionOffice[];

export type PastorOffice = (typeof PASTOR_OFFICES)[number];

export function isSessionOffice(value: unknown): value is SessionOffice {
  return (
    typeof value === "string" &&
    (SESSION_OFFICES as readonly string[]).includes(value)
  );
}

export function isPastorOffice(value: unknown): value is PastorOffice {
  return (
    typeof value === "string" &&
    (PASTOR_OFFICES as readonly string[]).includes(value)
  );
}
