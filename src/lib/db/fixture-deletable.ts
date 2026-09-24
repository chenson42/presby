/**
 * The one place a test fixture says "this organization may be torn down."
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
 * NOT a general-purpose "make this org deletable" switch. Production
 * organizations never carry a value here; a congregation that closes is a
 * lifecycle event, never a deleted row.
 */

/** Two hours: comfortably longer than any suite, far shorter than a session. */
const FIXTURE_TEARDOWN_WINDOW_MS = 2 * 60 * 60 * 1000;

export function fixtureDeletableUntil(): Date {
  return new Date(Date.now() + FIXTURE_TEARDOWN_WINDOW_MS);
}
