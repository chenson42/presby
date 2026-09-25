/**
 * The one place a test fixture says "this row may be torn down."
 *
 * USED FOR BOTH `organizations.deletableUntil` AND, since
 * `drizzle/0048_presby_security_b.sql` section 8 (N-6),
 * `people.deletableUntil`. One helper, deliberately — the two guards are the
 * same mechanism with the same predicate and the same two-hour window, and a
 * second copy would drift.
 *
 * `drizzle/0044_presby_org_lifecycle.sql` adds `presby_guard_organizations_
 * delete()`: an organization is permanent, the `people` rule's twin, and a
 * DELETE is refused unless `organizations.deletable_until` is non-null and in
 * the future. The guard fires on BOTH connections — `BYPASSRLS` exempts a
 * role from RLS policies, never from triggers — and the owner path
 * (`getPlatformDb()`) is the one that matters, since the 2026-08-31 58-org
 * cascade went through it.
 *
 * WHY STAMPED AT INSERT, NOT AT TEARDOWN (Ruling 7.3 of the Phase 2 review in
 * `docs/work-log/2026-09-24-lifecycle-affiliation-returns.md`): 15+ DB-backed
 * test files already wrap `platform.delete(organizations)` in
 * disable/enable-trigger pairs, and that pattern has regressed twice
 * (`docs/TODO.md`). Forcing a 16th disable block into every one of them would
 * regress it a third time. A fixture helper stamps this on the way in, once,
 * and every existing teardown keeps working untouched.
 *
 * NOT a general-purpose "make this row deletable" switch. Production
 * organizations never carry a value here; a congregation that closes is a
 * lifecycle event, never a deleted row. Production PEOPLE never carry one
 * either; a person who leaves is a roll action, and a duplicate is a merge
 * (`merged_into_id`), never a delete.
 *
 * The one place this is legitimately called at TEARDOWN rather than at insert
 * is a row PRODUCTION code created (`createPerson()` and its callers), where
 * no fixture insert exists to stamp. Both such sites say so inline:
 * `src/lib/people.test.ts` and
 * `src/app/(org)/o/[slug]/admin/staff/actions.test.ts`.
 */

/** Two hours: comfortably longer than any suite, far shorter than a session. */
export const FIXTURE_TEARDOWN_WINDOW_MS = 2 * 60 * 60 * 1000;

export function fixtureDeletableUntil(): Date {
  return new Date(Date.now() + FIXTURE_TEARDOWN_WINDOW_MS);
}

/**
 * How long a stamped row is allowed to stay alive before it counts as LEAKED
 * rather than in-flight.
 *
 * Twenty minutes. The longest measured full DB-backed serial run
 * (`--no-file-parallelism`, all 29 files) is about six minutes, so no fixture
 * belonging to a live suite can be this old, and there is no false-positive
 * window worth worrying about. The honest limitation in the other direction:
 * a leak is invisible to a re-run started within twenty minutes of the run
 * that caused it. That is the price of not threading a run id through
 * `fixtureDeletableUntil()`'s bare `Date` return and all 30-odd call sites,
 * and it is acceptable because the failure this guards against takes TWO
 * HOURS to become irreversible.
 */
export const STALE_FIXTURE_STAMP_GRACE_MS = 20 * 60 * 1000;

/**
 * Rows whose `deletable_until` is at or before this instant were stamped more
 * than `STALE_FIXTURE_STAMP_GRACE_MS` ago and have outlived whatever suite
 * created them.
 *
 * WHY THIS EXISTS AT ALL: once a stamped row's window closes it can no longer
 * be deleted on ANY connection — `presby_app` holds no DELETE grant on
 * `people`, and the owner path hits `presby_guard_people_delete()`
 * (`drizzle/0048_presby_security_b.sql` section 8). A forgotten fixture row
 * was clutter before N-6; after it, it is permanent. The window is the only
 * chance to clean one up, so something has to notice inside two hours.
 * `src/lib/db/fixture-deletable.test.ts` is what notices.
 */
export function staleFixtureStampCutoff(now: Date = new Date()): Date {
  return new Date(
    now.getTime() + FIXTURE_TEARDOWN_WINDOW_MS - STALE_FIXTURE_STAMP_GRACE_MS,
  );
}
