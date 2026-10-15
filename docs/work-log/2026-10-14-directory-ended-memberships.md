# Directory lists ended memberships — Work Log (bug fix)

> **Slug:** `2026-10-14-directory-ended-memberships`
> **Surface:** `(org)` member portal — `/o/<slug>/directory`, the households grid and page, the person page, and the home-page Find-a-person jump
> **Permission(s):** existing `directory.view`; no change
> **Flag(s):** existing `org_portal.directory` / `org_portal.directory_v2`; no change
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant (CLAUDE.md § Bug-Fix Variant). Phase 2 skipped — the fix touches one shared SQL predicate and its one hand copy; no invariant, dependency or structure changes. Documented here per "no silent skips".
> **Worktree / branch:** `../presby-directory-fix` on git branch `fix/directory-ended-memberships` (off `main`); Neon branch `fix/directory-ended-memberships` (`br-odd-sunset-ax28h7fc`, parent `development`).
> **Numbers:** finding **F136** (pre-assigned to `2026-10-14-portal-home-alignment`, whose Phase 2 architect found this; recorded in `docs/schema-design-2.md` at integration). No DECISION. Release: patch `v0.31.1`.

---

## Source and intent (orchestrator, 2026-10-14)

Found by the Phase 2 architect of `docs/work-log/2026-10-14-portal-home-alignment.md` (read it there — "Household count" ruling and F136), measured live on the pipeline branch: `directoryEligibilityWhereSql()` in `src/lib/directory.ts` (~244-261) has no `m.ended_on is null` term, so a person whose relationship with the congregation has **ended** but whose `engagement_status` stayed `regular` still appears in the directory, the households grid, the person page and the home-page Find-a-person jump. 2 of 44 memberships on the branch (`fernwood`, `e2e-beta`; `ended_on = 2026-03-31`) pass the predicate while the access gate `presby_membership_is_active()` excludes them. `findPersonMatches()` (`src/lib/org-portal/find-person.ts` ~66-84) carries a hand copy of the predicate.

**The fix, as designed by the home pipeline's Phase 3 tech-lead ("Part A — the `fix(directory):` commit", `docs/work-log/2026-10-14-portal-home-alignment.md`, the design of record for this pipeline — the tech-lead here confirms it rather than re-deriving it):** add `and m.ended_on is null` to `directoryEligibilityWhereSql()` once (fixes all six directory readers); move `findPersonMatches()` onto the shared predicate through a new exported `findDirectoryPersonIds()` so the predicate stays private; six failing-first tests in the directory DB suite and two in `find-person.test.ts` including a find-person-versus-directory equivalence check. The home pipeline's household count (Part B) will not ship on the unfixed predicate, which is why this merges first.

**Why its own pipeline:** it is a live bug on `main` (production has `org_portal.directory` on — tech-lead to confirm from `docs/STATE.md`), it has no dependency on the calendar work, and it patches independently.

**Commit:** one `fix(directory): …` commit with trailers `Caught-By: agent-review`, `Discovered-In: Phase-2` (the discovering pipeline's phase), `Work-Log: 2026-10-14-directory-ended-memberships`, and in the body: found by the portal-home-alignment architect's live catalog read.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement (brief) | analyst | Complete | READY WITH NOTES | 2026-10-14 |
| 2 — Architectural review | architect | Skipped — predicate fix, no invariant/dependency/structure change | — | 2026-10-14 |
| 3 — Technical design (brief) | tech-lead | Complete | Part A confirmed, amended | 2026-10-14 |
| 4 — Implementation | api-developer | Complete | gates green; failing-first proven | 2026-10-14 |
| 5 — Verification | qa | Complete | PASS | 2026-10-14 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-10-14 |

---

# Phase 1 — Functional Refinement (analyst, bug-fix brief)

*Recorded verbatim by the orchestrator, 2026-10-14.*

## VERDICT

**READY WITH NOTES.** The bug is real and live in production. The one-term fix is right for all six readers. One surface (the admin members list) inherits the change, and I recommend accepting that.

## ONE-LINE TAKE

> A member whose relationship with the congregation has ended, but whose `engagement_status` stayed `regular`, still appears in the directory and in Find-a-person. The access gate has already refused that same person entry. Adding `m.ended_on is null` to the shared predicate fixes it.

## Bug confirmed

Read-only probe on the owner connection of the shared `development` branch:

- **Counts:** 44 memberships in total. 2 have `ended_on` set, and both have `engagement_status = 'regular'`. Both pass the eligibility OR-clause, so `ended_passing = 2`. This matches the architect's measurement.
- **The rows:** `e2e-beta` and `fernwood`, both with `current_roll` null and `ended_on = 2026-03-31`.
- **The predicate:** `directoryEligibilityWhereSql()` at `src/lib/directory.ts:244-261` checks hidden, merged, deceased and "current_roll in four values OR engagement_status = 'regular'". It has no `ended_on` term.
- **The access gate:** `presby_membership_is_active()` is defined in `drizzle/0015_presby_membership_probe.sql:51-68`, **not** `0010`. It tests `ended_on is null`. The function's comment says `ended_on is null` is "the definition of current here". The directory therefore lists people the access gate has already treated as gone.
- **The hand copy:** `findPersonMatches()` at `src/lib/org-portal/find-person.ts:63-79` repeats the same predicate, minus `ended_on`. The same bug is in both places.
- **Production:** `org_portal.directory` and `org_portal.directory_v2` are not among the four flags `docs/STATE.md` (2026-10-07) lists as OFF in production, so they are ON there. `development` also has both ON. A member who left the congregation can still be listed, or reached by the Find-a-person jump, until this ships.
- **Blast radius:** both measured ended rows have `household_id` null, so the household surfaces are only latent today. The directory list, person page and find-person are live.
- **Existing coverage:** `directory.test.ts` and `find-person.test.ts` contain no `endedOn` fixture at all. No test pins the current behaviour.

## Intended behaviour preserved (the fix must not change)

- **Hidden members.** `directory_hidden` is still excluded unless `includeHidden`. `includeHidden` drops only that term, so the parish roster (`directory.view_hidden`) still shows hidden members but not ended ones.
- **Exclusions.** Merged and deceased people stay excluded.
- **Eligibility.** The roll or engagement OR-clause is unchanged. A `staff` engagement row, with null `current_roll`, is still outside the directory (DECISION-129).
- **Status filter.** `status` still means `m.current_roll = <status>`. `ended_on is null` is an additional AND and applies in both the status and no-status branches.
- **Deacons.** `deriveDeaconsByOrgUnit` is deliberately outside the predicate (a deacon is shown by office). It stays untouched. Do not add `ended_on` there: `officer_terms.ends_on` is its own concept.
- **Permissions and access.** `directory.view` and `directory.view_hidden` checks are unchanged. No DB, schema or RLS change.
- **Not-found behaviour.** An ended person or household returns `not-found`, indistinguishable from one that never existed. This keeps the non-disclosure discipline the 2026-08-24 design set.

## Does `ended_on is null` belong in all six readers?

Yes, with no exception. All five directory readers flow through `queryDirectoryRows()` and `directoryEligibilityWhereSql()`. `findPersonMatches()` is the hand copy and will be consolidated onto the same predicate.

| Reader | Verdict |
|---|---|
| directory list | Include the term. |
| households grid | Include the term. |
| household page | Include the term (see below). |
| person page | Include the term. |
| parish roster | Include the term. It uses `includeHidden: true`, which does not touch the new term. |
| find-person | Include the term (via the consolidation). |

- **A departed spouse on a household page.** I looked for a reader where an ended member should still appear and found none. Showing a departed spouse as a household member would list someone whose person page would 404 under the same fix. The person page uses the same predicate, and the access gate has already removed them. The household page and the person page must agree, and the F136 equivalence guard enforces that. Showing a departed spouse would be a new feature (a "former members" display), not this bug.
- **Future-dated `ended_on`.** The gate tests only `ended_on is null`, not a date comparison. The fix should match that exactly. The comment on the gate says the two definitions "must stay identical". Do not introduce a `<= current_date` variant.

## Pagination and existing tests

- **`countDirectoryRows` and pagination.** Both `queryDirectoryRows` and `countDirectoryRows` build on `directoryFromWhereSql`, which calls the one predicate. Adding the term moves the rows and the count together, so there is no "Page 1 of 3" mismatch risk.
- **Pinned totals.** The pagination test pins `total: 6, totalPages: 3` (`src/lib/directory.test.ts:1609-1615`) and `total` 1 at about line 1648. Neither fixture sets `endedOn`, so no existing assertion changes.
- **Added fixture.** The design adds an `endedMember` in `householdVisible`. The tech-lead must check that this fixture does not enter orgA's counted population. If it does, the pinned `6` moves and a failing test would be a fixture bug, not a regression. The design's own `householdVisible` expectations should be re-derived from the final fixture.

## Surfaces that inherit the change

- **Admin members list (`/o/<slug>/admin/members`) inherits the change.** `admin/members/page.tsx` calls `getDirectory()` directly, with the status filter. Its four options are the `DIRECTORY_STATUSES` (active, baptized, affiliate, other_participant), not "ended" or "former". It therefore never showed ended members by design. It was already the directory's eligibility view, not a full roll, since it also excludes visitors, deceased and merged people. I recommend accepting the inheritance and not forking a second predicate.
- **Admin household pickers.** `admin/members/new` and `admin/members/[id]/edit` call `getHouseholds()` to populate a household picker. After the fix, a household whose only members have ended drops out of the picker. That is correct, but `edit` of a person who has ended is still reachable by direct URL through `getPersonForEdit` (a separate reader). No change is needed.
- **Roll-style readers.** The Phase 6 for this fix should not claim the whole portal is consistent. `children.ts` (guardian search at about line 163, child roster at about line 276) and `role-grants.ts` have their own member queries with no `ended_on` term. They are gated on `children.roster`, not `directory.view`. They are outside this fix.

## Gaps

1. **Admin loses visibility of ended people.** After the fix an admin has no UI list of ended memberships (there was none before either, because the ended members showed up only by accident). If "former members" is wanted, it is a feature, not this bug. Add a `docs/TODO.md` line at ship (Rule 10).
2. **Children readers have the same blind spot.** The `children.ts` guardian search and child roster match ended members' people rows. Record as a follow-up, not a blocker.
3. **Fixture 1 versus fixture 2.** The 2 measured rows are from the shared dev branch and have `household_id` null. The tests must put the `endedMember` in a household (as the design does) to prove the three household readers, not only the list.
4. **No e2e coverage.** The `directory.view` e2e gap in `docs/TODO.md` is separate. Phase 5 should rely on the DB suites for this fix.
5. **Single-source predicate.** Closing the "no third copy" follow-up (2026-08-24 Phase 6 note) means `findPersonMatches` must be moved onto the shared predicate, not just given an `ended_on` line. A third hand copy would reopen the drift risk, so a one-line patch in `find-person.ts` would not satisfy it.

## Adversarial pass (brief)

- **Enumeration.** The ended person returns the same `not-found` as a never-existed id. Fine.
- **Self-targeting.** An ended member is already blocked at `withOrgContext` before any directory query runs, so this fix only matters for other viewers seeing the ended member.
- **Input boundaries.** No new input. `findDirectoryPersonIds` takes a `query` string. The existing `%${query}%` is passed as a parameter, not concatenated. The LIKE wildcards `%` and `_` in user input are not escaped today. That is a pre-existing nuisance, not new, and should not be fixed in this commit.
- **Redirect targets.** The find-person jump builds an href from an id the server returned. Not affected.

## Open Questions

None blocking. For the tech-lead to confirm: (a) the `endedMember` fixture does not change orgA's pinned `total: 6` count, and (b) the production flag state above (derived from STATE.md's "36 of 40 ON" list) is accurate, since `STATE.md` does not name the directory flags explicitly.

## Handoff

**Next agent: tech-lead (Phase 3, brief).** Phase 2 is skipped per the work-log. The tech-lead should confirm Part A of the portal-home-alignment design as written, check the pagination fixture count, and note gaps 1 and 2 as TODO lines for the Phase 6 follow-up list. Then hand to api-developer for Phase 4.


---

# Phase 2 — Architectural Review (architect)

**Skipped** (bug-fix variant): the change is one `and` term in a shared SQL predicate plus moving a hand copy onto it. No new dependency, no schema change, no new directory, no invariant touched. The discovering architect already ruled the shape ("fix the shared predicate once; do not export it; `findPersonMatches` moves onto it").

---

# Phase 3 — Technical Design (tech-lead, brief)

*Brief, bug-fix variant. Authored 2026-10-14. Design of record: **"Part A — the `fix(directory):` commit (F136)", A.1–A.5**, in `../presby-calendar/docs/work-log/2026-10-14-portal-home-alignment.md` (Phase 3 tech-lead section), and that pipeline's Phase 2 architect ruling "Household count". This section confirms it rather than re-deriving it; amendments are listed explicitly below, and everything not listed stands as written there.*

## Root cause

`directoryEligibilityWhereSql()` (`src/lib/directory.ts:244-261`, one call site at `directoryFromWhereSql`, `:317`) has no `m.ended_on is null` term, so a person whose relationship has ended but whose `engagement_status` stayed `regular` passes the "current_roll in (four) OR engagement_status = 'regular'" arm and is listed by all six readers, while the access gate `presby_membership_is_active()` (`drizzle/0015_presby_membership_probe.sql:51-68`) defines "current" as `ended_on is null` and has already refused that person entry. `findPersonMatches()` (`src/lib/org-portal/find-person.ts:66-84`) carries a hand copy of the same predicate with the same omission, so the Find-a-person single-match jump can redirect to a person page the fix makes 404.

## Analyst's two confirmations

**(a) The `endedMember` fixture does not move the pinned pagination totals. Confirmed.** `total: 6, totalPages: 3` (`src/lib/directory.test.ts:1609-1615`), the `total` 1 (`~:1648`) and the "clamps to page 3" assertion (`~:1627`) all live in the Increment 5 `describe` (opens `~:1355`), which builds its **own** two organizations (`makeOrg("A")` / `makeOrg("B")`, slugs `directory-inc5-*`) and its own people. `endedMember` goes into the **main** `beforeAll` (orgA = `directory-test-a-*`, household `householdVisible`), a different organization, so it cannot enter the Increment 5 population; and post-fix it is excluded wherever it appears. The main block pins no totals. The only existing main-block assertions the fixture touches are `memberCount toBe(2)` at `~:887` (`getHouseholds`, Winterbourne) and `~:936` (`getHouseholdDetail`), and the `[hhPerson1, hhPerson2].sort()` equality at `~:940`: these go red pre-fix by design (a third member) and green post-fix. The main-block search tests (`"ophel"`, `"MARCHBANKS"`, `"control@example"`, `"0199"`) cannot match the new person (no contact rows; surname unique in the file). **No fixture-induced change to any pinned number.**

**(b) Production flag state. Confirmed by inference, not by a live read.** `docs/STATE.md` (2026-10-07 entry, `:10-20`) records production at 36 of 40 flags ON, with exactly four OFF: `org_portal.filings`, `statistics.submission_grants`, `org_portal.feature_categories`, `org_portal.statistical_publication`. `org_portal.directory`, `org_portal.directory_v2` and `org_portal.home_v2` (the Find-a-person host) are not among the four, and `scripts/seed.ts` is idempotent and "never flips an existing flag" (`docs/deployment.md`), so they are ON in production, which holds two real organizations. The bug is therefore **live there**. I did not query production (this pipeline's `.env.local` points at its own Neon branch, and a production read is the operator's gesture); to confirm, run `select key, enabled from feature_flags where key in ('org_portal.directory','org_portal.directory_v2','org_portal.home_v2')` against `br-wild-band-ax96gv09`. This is why the fix is a patch release cut ahead of the home work and not folded into it.

## Design — Part A confirmed (A.2, A.3, A.4, A.5 stand), with these amendments

1. **A.2 — predicate.** Exactly as written: one line, `and m.ended_on is null`, after `p.date_of_death is null` in `directoryEligibilityWhereSql()`. It applies when `includeHidden` is true and in both the `status` and no-`status` branches. **No date comparison** (a future-dated `ended_on` counts as ended, matching the gate, which tests only `is null`). Do not touch `deriveDeaconsByOrgUnit` (office-based, outside the predicate), `children.ts`, `role-grants.ts`, or LIKE-wildcard escaping (pre-existing, out of scope). Update the two prose spots: the "who APPEARS as a row" paragraph (`directory.ts:~28-33`) and the doc comment above `directoryEligibilityWhereSql` (which says `includeHidden` drops only the hidden term and "every other eligibility rule ... is UNCHANGED"; name the new term there and cite `presby_membership_is_active`).
2. **A.3 — export shape.** Exactly the signature in A.3: `export async function findDirectoryPersonIds(tx: OrgTx, organizationId: string, query: string, limit: number): Promise<string[]>`, placed in `directory.ts` beside `queryDirectoryRows`. `OrgTx` is already the module-private type at `directory.ts:202`; no new type export. `directoryEligibilityWhereSql` stays private; the finder calls it with `includeHidden = false` and **no** `status`. The SQL is A.3's verbatim; the `like` string stays `%${query}%` as a bound parameter. In `find-person.ts` keep the `directory.view` `presby_has_permission` read inline (the `checkDirectoryView` export belongs to Part B), keep the `sql` import for that read, import `findDirectoryPersonIds` from `@/lib/directory`, call it with limit `2`, and return `{ kind: "ok", personIds }`. Rewrite the module-header paragraph (`find-person.ts:~14-24`, "copied here rather than imported ...") to say the predicate is now shared through `findDirectoryPersonIds`, and why it is not exported directly. Both test files already mock `server-only`, and `find-person-action.test.ts` mocks `findPersonMatches` wholesale, so no mock changes are expected.
3. **A.4 — tests (names and paths fixed here).** Both suites are DB-backed (`describe.skipIf(!hasDb)`).
   - `src/lib/directory.test.ts`, **main** `beforeAll` (not the Increment 5 block): add `let endedMember: string;`, create the person ("Rowan", "Ashgrove-Pell") with the file's `person()` helper, insert the membership directly with `platform.insert(memberships)` `{ organizationId: orgA, personId: endedMember, householdId: householdVisible, householdRole: "other", engagementStatus: "regular", currentRoll: null, endedOn: "2026-03-31" }` (the local `membership()` helper cannot set household or end date), and add `endedMember` to the `afterAll` `allPeople` list (`~:659`). `household_role` is free text documented `head | spouse | child | other` and `memberships_one_active_roll_idx` is partial on `current_roll = 'active' and ended_on is null`, so the row is legal. New `describe("an ended relationship is not in the directory (F136)", ...)` with six tests:
     1. `getDirectory omits an ended member, with and without a search` (search `"Ashgrove"`)
     2. `getPersonDetail returns not-found for an ended member`
     3. `getHouseholdDetail does not count or list an ended member` (memberCount 2; members equal `[hhPerson1, hhPerson2].sort()`)
     4. `getHouseholds does not count an ended member` (Winterbourne memberCount 2)
     5. `includeHidden does not resurrect an ended member` (`elevatedPerson`, `getDirectory` with `includeHidden: true`; also `getParishRoster` if it exposes member ids, otherwise `getDirectory` alone)
     6. `an otherwise identical member with no end date is still listed` (control; guards over-exclusion)
   - `src/lib/org-portal/find-person.test.ts`: fixture `endedMember` ("Quillon", "Ferrowby"; orgA, `regular`, `currentRoll: null`, `endedOn: "2026-03-31"`), added to the teardown list. New tests:
     7. `does not match a member whose relationship has ended (F136)` (`{ kind: "ok", personIds: [] }`)
     8. `find-person and the directory agree on who is eligible (F136)`: `getPersonDetail` is imported from `../directory` in `beforeAll`. For each of `unique`, `byEmail` (searched by its email), `hidden`, `visitor`, `endedMember`, run `findPersonMatches` with that person's unique search term and `getPersonDetail(seeker, orgA, id)`, and assert the person is in `personIds` **iff** `getPersonDetail(...).kind === "ok"`. To make the guard non-vacuous and red pre-fix, also assert explicitly that `unique` and `byEmail` are matched and `ok`, and that `endedMember` is absent from `personIds` **and** `getPersonDetail` is `not-found`. (Pre-fix both surfaces wrongly agree the ended person is eligible, so the iff alone would pass; the explicit absence assertion is what turns it red. Post-fix the iff is the drift guard.)
   - **Fail before, pass after (what Phase 5 re-runs):** tests 1, 2, 3, 4, 5, 7 and 8 fail against the unfixed code, as do the existing `memberCount toBe(2)` assertions (`~:887`, `~:936`) and the `[hhPerson1, hhPerson2]` equality (`~:940`), intentionally. Test 6 and the existing visitor / hidden / forbidden / `limit 2` find-person cases pass both before and after.
   - **Order of work (api-developer):** fixtures and tests first; run both suites red; paste the failing output into Phase 4; then the `directory.ts` and `find-person.ts` edits; then green.
4. **A.5 — commit.** One commit (message below). Per Rule 16 and A.5, it contains **no** `docs/TODO.md`, `docs/schema-design-2.md`, `docs/decisions.md`, `docs/STATE.md`, release-notes, functionality-map or `package.json` change; the orchestrator lands those in the close-out `docs:` commit (precedent `34af07a docs: close the org-parent-picker pipeline ... release 0.31.0`). The fix commit is `src/lib/directory.ts`, `src/lib/directory.test.ts`, `src/lib/org-portal/find-person.ts`, `src/lib/org-portal/find-person.test.ts`, plus this work-log.
5. **Blast radius.** `admin/members/page.tsx` (via `getDirectory`) and the two household pickers (`getHouseholds`) inherit the fix; accepted per the analyst, no second predicate. Mocked page and action tests (`directory/page.test.tsx`, `find-person-action.test.ts`) mock the data layer and are unaffected. **Existing e2e specs that assert behavior this change alters: none.** A grep of `e2e/` finds no spec that renders the directory list, a person page, a household page or the Find-a-person box; `e2e/support/seed-orgs.ts`'s `ended_on` use serves the post-login-routing ended-membership cases and does not touch these surfaces. No `scripts/test-rls.sql` or `seed-dev.sql` change: no policy, grant, table or function moves.
6. **Out of scope.** A "former members" display; the `children.ts` / `role-grants.ts` blind spots (TODO below); the find-person versus directory-search contact-row difference (already a TODO line from the home pipeline); LIKE-wildcard escaping.

**Implementer: `api-developer`** (server logic and its DB tests; no client, schema or RLS change).

## Commit

```
fix(directory): exclude ended relationships from the directory and find-a-person

directoryEligibilityWhereSql() had no `m.ended_on is null` term, so a person
whose relationship with the congregation had ended but whose
engagement_status stayed 'regular' was listed by the directory, the
households grid and page, the person page and the parish roster, while the
access gate presby_membership_is_active() (drizzle/0015) already treats
that person as gone. Measured on a pipeline branch: 2 of 44 memberships
(ended_on = 2026-03-31, current_roll null, engagement_status 'regular')
passed the predicate. One added term fixes all six readers, since every one
goes through the single predicate.

findPersonMatches() carried a hand copy of the predicate with the same gap,
so the single-match jump could redirect to a person page that now 404s. It
now consumes the shared predicate through a new findDirectoryPersonIds()
export; the predicate itself stays private. Search semantics are unchanged.
This closes the 2026-08-24 portal-home-directory follow-up on the
hand-copied predicate.

Failing-first regression tests in directory.test.ts (an ended member in the
visible household: list, person, household detail and count, households
grid, includeHidden) and find-person.test.ts (the ended member never
matches; find-person and the directory agree on eligibility).

Found by the portal-home-alignment pipeline's Phase 2 architect during a
live catalog read of its pipeline branch (F136).

Caught-By: agent-review
Discovered-In: Phase-2
Work-Log: 2026-10-14-directory-ended-memberships

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```

## Housekeeping in the close-out cluster (Rules 10, 14; drafted here, the orchestrator writes the shared files at integration)

**`docs/TODO.md`**

Next Up (or Backlog, orchestrator's call):

- [ ] **No admin view of ended memberships.** The directory now excludes people whose relationship has ended (v0.31.1); there is no list anywhere of former members (there was none before either; they appeared only by accident). If wanted, "former members" is a feature with its own permission and privacy ruling, not a directory-predicate change. — `docs/work-log/2026-10-14-directory-ended-memberships.md` (analyst gap 1)
- [ ] **Children readers have the same ended-member blind spot.** `src/lib/children.ts` (guardian search `~:163`, child roster `~:276`) and `src/lib/role-grants.ts` have their own member queries with no `ended_on is null` term. Gated on `children.roster` / `role_grants.manage`, not `directory.view`, so outside F136. Decide per reader whether an ended person belongs (a guardian record for a child may legitimately outlive the guardian's membership). — same (analyst gap 2)

Done (dated at ship):

- [x] YYYY-MM-DD — **Directory and Find-a-person no longer list people whose membership has ended** (v0.31.1, `fix(directory):`, F136, `docs/work-log/2026-10-14-directory-ended-memberships.md`). One `m.ended_on is null` term in `directoryEligibilityWhereSql()` fixes all six readers; `findPersonMatches()` moved onto the shared predicate through `findDirectoryPersonIds()`. **Closes the 2026-08-24 portal-home-directory Phase 6 follow-up "extract `findPersonMatches()`'s inline eligibility predicate into the shared helper" (QA gap 3, recorded at `docs/work-log/2026-08-24-portal-home-directory.md:~2068` and `:~2110`; no standing `docs/TODO.md` line was found for it, so this Done line is the whole record) — there is no third copy of the rule.**

**`package.json`**: `"version": "0.31.0"` -> `"0.31.1"`, in the close-out `docs:` commit (the 0.30.0 / 0.31.0 precedent), not the fix commit. `package-lock.json` is not kept in lockstep (it reads 0.29.0); leave it.

**Release note** (`docs/release-notes/v0.31.md`, via `/release-notes`): add this row above the 0.31.0 row in the table of contents, and this entry above the 0.31.0 entry.

```
| [0.31.1](#0.31.1) | YYYY-MM-DD | Fix | People whose membership has ended no longer appear in the directory or in Find a person |
```

```
<a name="0.31.1"></a>
## 0.31.1 — YYYY-MM-DD

### People whose membership has ended no longer appear in the directory or in Find a person

**Background:** When a person's relationship with a congregation has ended, the portal already stops letting them in to it. But the member directory kept listing anyone whose record still said they were a regular participant, even after their membership had been ended. So a former member could still be shown, with whatever contact details they had chosen to share, to the people who were still members, and the "Find a person" box on the portal home could take someone straight to their page.

**Changes:**
- The directory, the households view, household pages, individual member pages and the parish roster no longer show anyone whose membership has ended. A household that includes a former member now lists, and counts, only its current members.
- The "Find a person" box on the portal home no longer finds former members, so it can no longer jump to a page that would not open.
- Nothing else about the directory changes: people who chose to be hidden stay hidden, people who have died or been merged into another record stay out, and visitors and staff are still not listed as members. The member-management screens for administrators use the same list, so they also stop offering former members.
- No record is removed. A former member's history stays on file; they are simply not shown as a current member. There is not yet a screen that lists former members; that is tracked as future work.
```

**Functionality map** (`docs/product/functionality-map.md`, Rule 14): the Directory bullet (`:67`) gains one clause and the Index is unchanged. After "privacy-filtered read (`person_privacy` field-level hides applied in SQL)", insert: ", listing only *current* relationships (`ended_on is null`, the access gate's own definition, F136)". The portal-home bullet (`:66`) needs no change.

**`docs/schema-design-2.md` F136**: the home work-log architect's draft, adopted with the "Fixed" paragraph reworded because the household-count leg ships in the other pipeline. Place it as a new `###` subsection immediately after the last F-entry of its section, before `## 3. Section M` (F136 is pre-assigned; F137 was released unused). Text, verbatim:

> ### F136 — the directory eligibility rule exists in three disagreeing forms
>
> **F136 — who counts as "in the directory" was written three times, and the three disagree.** (1) `src/lib/org-portal/home-data.ts` counted a household's members with `ended_on is null` only, so the home card counted deceased, merged, directory-hidden and off-roll people. (2) `directoryEligibilityWhereSql()` in `src/lib/directory.ts` omitted `ended_on is null`, so it listed people whose relationship had ended but whose `engagement_status` stayed `regular` — measured on the pipeline branch, 2 of 44 memberships (`fernwood` and `e2e-beta`, `current_roll` null, `ended_on = 2026-03-31`) — while the access gate `presby_membership_is_active()` already treats them as gone. (3) `findPersonMatches()` carried a hand copy of the predicate, so the single-match jump could send a member to a person page.
>
> **Generalisation:** a count or list of *other people* is directory data even when the scope is the viewer's own household, and it uses the one shared predicate. The access gate's definition of a current relationship (`ended_on is null`) is part of that predicate.
>
> **Fixed** by `fix(directory):` (v0.31.1, `2026-10-14-directory-ended-memberships`: the predicate gains `and m.ended_on is null`, closing leg (2); find-person consumes it through `findDirectoryPersonIds`, closing leg (3); failing-first regression tests in `directory.test.ts` and `find-person.test.ts`, including a find-person-versus-directory equivalence guard) and by `2026-10-14-portal-home-alignment` (the home household count now goes through `countHouseholdDirectoryMembers`, closing leg (1)). Closes the 2026-08-24 portal-home-directory Phase 6 follow-up on the hand-copied predicate. **Residual, accepted:** `children.ts` and `role-grants.ts` keep their own member queries without the ended term (not directory readers; `docs/TODO.md`), and find-person still matches any email or phone contact row where the directory search matches only the primary one.

(Orchestrator: if this pipeline integrates before the home pipeline, leg (1) is still open when F136 is recorded; word the last sentence accordingly or integrate F136 after both.)

## Phase 4 instructions (api-developer)

- Work only in `/Users/cshenso/git/presby-platform/presby-directory-fix` on `fix/directory-ended-memberships`. Its `.env.local` points at this pipeline's own Neon branch (`fix/directory-ended-memberships`, parent `development`); confirm that before running any DB suite, and never point a suite at production.
- Follow the "Order of work" above. Paste the failing-first output (test names and assertion lines) into the Phase 4 section of this work-log before making the source edits.
- Run the DB-backed suites serially (`docs/testing.md` -> "Running the DB-backed suites"; `fileParallelism` is not the global default):
  `npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/directory.test.ts src/lib/org-portal/find-person.test.ts`
  (the raw form of `npm run test:db`, scoped to the two files). Then the mocked neighbours with plain `npx vitest run`: `src/lib/org-portal/find-person-action.test.ts` and the tests under `src/app/(org)/o/[slug]/directory` and `src/app/(org)/o/[slug]/admin/members`.
- Gate before reporting complete: `npm run typecheck`, `npm run lint`, `npm run check` (all six tripwires), both DB suites green, the mocked neighbours green, no `console.log`. `scripts/test-rls.sql` need not re-run (no policy, grant or function moves).
- Do **not** edit Rule-16 shared files, release notes, the functionality map, `package.json` or `docs/TODO.md`. Do **not** commit; hand the diff back for the user's review. When the user approves, the one commit is the message above.
- Report in Phase 4: the failing-first output, the green output, and the line numbers of the assertions that went red pre-fix.

## Phase 5 instructions (qa, read-only)

1. **Fail before:** against the pipeline's Neon branch, run the two DB suites with `--no-file-parallelism` on a copy of the tree that has the new tests but not the source fix (a scratch worktree at the parent commit with only the two test files applied, or the source diff reverse-applied to a scratch copy; do not edit the tree under judgment). Record that tests 1, 2, 3, 4, 5, 7, 8 and the existing `memberCount` assertions fail, and that test 6 and the existing find-person cases pass.
2. **Pass after:** on the real tree run the same two suites (all green), then `npm run test`, `npm run typecheck`, `npm run lint`, `npm run check`.
3. **Inspection:** `directoryEligibilityWhereSql` is still not exported; `find-person.ts` contains no eligibility SQL of its own (grep for `date_of_death`, `merged_into_id`, `directory_hidden` returns nothing); `deriveDeaconsByOrgUnit` is untouched; no change outside the four source/test files and the work-log; no Rule-16 file touched.
4. **Non-vacuous guard:** test 8 asserts a non-empty eligible side and the absence of `endedMember` on both surfaces.
5. **e2e:** not required (no auth surface touched; no e2e spec asserts these surfaces); say so explicitly rather than skipping silently. Verdict PASS or FAIL with `file:line` per failing test; BLOCKED only if the Neon branch is unreachable.

---

# Phase 4 — Implementation

*api-developer, 2026-10-14. Worktree `/Users/cshenso/git/presby-platform/presby-directory-fix`, branch `fix/directory-ended-memberships`; `.env.local` points at this pipeline's own Neon endpoint (`ep-morning-band-ax5fazzf`). Nothing committed or pushed.*

## Files Created
None (source). The work-log is untracked in this worktree.

## Files Modified
- `src/lib/directory.ts` — `and m.ended_on is null` added to `directoryEligibilityWhereSql()` (no date comparison, applies in both the `status` and no-`status` branches and under `includeHidden`); new exported `findDirectoryPersonIds(tx, organizationId, query, limit): Promise<string[]>` beside `queryDirectoryRows`, composing `directoryEligibilityWhereSql(false)` (predicate stays private); the module-header "who APPEARS as a row" paragraph and the predicate's doc comment name the ended-relationship term and cite `presby_membership_is_active` (drizzle/0015).
- `src/lib/org-portal/find-person.ts` — inline eligibility SQL removed; `findPersonMatches()` keeps its own `directory.view` `presby_has_permission` read and now calls `findDirectoryPersonIds(tx, organizationId, query, 2)`; module header rewritten (shares the predicate through the finder, why it is not exported directly); unused `MatchRow` removed.
- `src/lib/directory.test.ts` — main `beforeAll` fixtures `endedMember` ("Rowan Ashgrove-Pell", `householdVisible`, role `other`, `regular`, `currentRoll: null`, `endedOn: 2026-03-31`) and `currentSameShape` ("Wren Ashgrove-Vale", identical shape, no end date, no household; the over-exclusion control), both in the `afterAll` list; new `describe("an ended relationship is not in the directory (F136)")` with the six designed tests.
- `src/lib/org-portal/find-person.test.ts` — `endedMember` ("Quillon Ferrowby") fixture and teardown; tests 7 and 8 (the equivalence guard imports `getPersonDetail` from `../directory`).
- `docs/work-log/2026-10-14-directory-ended-memberships.md` — this section and the status row.

## Schema Changes
None. No migration, policy, grant or function moved; `scripts/test-rls.sql` not re-run.

## Audit Events
None. Read-only change; no mutation added.

## Failing-first proof
Tests and fixtures written first; both DB suites run serially against this worktree's Neon branch before any source edit:
`npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/directory.test.ts src/lib/org-portal/find-person.test.ts`

```
 Test Files  2 failed (2)
      Tests  9 failed | 88 passed (97)

 FAIL directory.test.ts > getHouseholds (Increment 3) > lists a household with visible members, with the correct memberCount
   AssertionError: expected 3 to be 2     (directory.test.ts:921, existing assertion)
 FAIL directory.test.ts > getHouseholdDetail (Increment 3) > returns the household's name and its visible members
   AssertionError: expected 3 to be 2     (directory.test.ts:970, existing assertion)
 FAIL directory.test.ts > an ended relationship ... (F136) > getDirectory omits an ended member, with and without a search
   AssertionError: expected [ ...(17) ] to not include '<endedMember>'   (:1299)
 FAIL ... > getPersonDetail returns not-found for an ended member
   AssertionError: expected { kind: 'ok', entry: { ...(14) } } to deeply equal { kind: 'not-found' }   (:1307)
 FAIL ... > getHouseholdDetail does not count or list an ended member
   AssertionError: expected 3 to be 2     (:1313)
 FAIL ... > getHouseholds does not count an ended member
   AssertionError: expected 3 to be 2     (:1325)
 FAIL ... > includeHidden does not resurrect an ended member
   AssertionError: expected [ ...(19) ] to not include '<endedMember>'   (:1340)
 FAIL find-person.test.ts > does not match a member whose relationship has ended (F136)
   expected { kind: 'ok', personIds: [ '<endedMember>' ] } to deeply equal { kind: 'ok', personIds: [] }   (:307)
 FAIL find-person.test.ts > find-person and the directory agree on who is eligible (F136)
   AssertionError: expected [ Array(1) ] to not include '<endedMember>'   (:335)
```

Test 6 (`an otherwise identical member with no end date is still listed`) and every pre-existing find-person case (visitor, hidden, forbidden, limit 2) were green in this red run, as designed. The existing `[hhPerson1, hhPerson2]` equality (`:~974`) is not independently reported: the `memberCount` assertion above it in the same test fails first.

Test 6 note: the design's wording "an otherwise identical member" is implemented as a second fixture (`currentSameShape`, same engagement/roll shape, `endedOn` null) asserted with `toContain` under search `"Ashgrove"`. My first version asserted the search returned exactly that one person; that went red pre-fix (the ended person also matched), which would have broken the design's "test 6 passes before and after", so the exclusivity check lives in test 1 and test 6 asserts only that the control is listed.

## Green after the fix
Same command, same suites:

```
 Test Files  2 passed (2)
      Tests  97 passed (97)
```

Gates:
- `npm run typecheck` — clean.
- `npm run lint` — clean (`--max-warnings=0`).
- `npm run check` — all six tripwires passed (audit coverage, sql-date, deps-drift, brand-scope, secrets & PII, hydration-gate).
- `npm test` (mocked suite; includes `find-person-action.test.ts`, `directory/page.test.tsx`, the admin members tests) — `Test Files 267 passed | 35 skipped (302)`, `Tests 3483 passed | 940 skipped (4423)`.
- No `console.log` added (grep of the diff). No Rule-16 shared file, `package.json`, release note or functionality map touched.

## Implementer Notes
- Design built as written; no escalation. `directoryEligibilityWhereSql` is still not exported; `find-person.ts` contains no eligibility SQL (its `sql` import remains for the `directory.view` read). `deriveDeaconsByOrgUnit` untouched.
- `getParishRoster` exposes only household counts (no member ids), so test 5 asserts `getDirectory` ids plus the `getHouseholds` (`includeHidden: true`) `memberCount` for `householdVisible`, as the design allowed.
- Prettier is not part of the gate (the base `directory.test.ts` already fails `prettier --check`); I did not reformat.
- Test-file line numbers above are post-fixture-insertion; the design's `~887`/`~936` shifted by the 34 added fixture lines.

## git status --short (end of Phase 4)
```
 M src/lib/directory.test.ts
 M src/lib/directory.ts
 M src/lib/org-portal/find-person.test.ts
 M src/lib/org-portal/find-person.ts
?? docs/work-log/2026-10-14-directory-ended-memberships.md
```

**Next agent: qa (Phase 5)** — verification-only; see the Phase 5 instructions in the Phase 3 section.

---

# Phase 5 — Verification (qa)

*Recorded verbatim by the orchestrator, 2026-10-14.*

**Verdict: PASS.** I ran the fail-before / pass-after proof myself: 9 tests red on the unfixed code, all 97 green with the fix. Every gate is green, and the full DB lane ran with nothing skipped.

**Date:** 2026-10-14
**Verified by:** qa

**Environment.** Worktree `/Users/cshenso/git/presby-platform/presby-directory-fix`, branch `fix/directory-ended-memberships`. Every `*DATABASE_URL` in `.env.local` resolves to `ep-morning-band-ax5fazzf`, this pipeline's own Neon branch, and none is overridden by the shell. No suite touched production or `development`.

## Fail-before / pass-after (bug-fix variant, run by qa)

**Method.** I did not stash. Phase 3's Phase 5 instructions say not to edit the tree under judgment, so I used a scratch copy instead: saved the source diff (`git diff -- src/lib/directory.ts src/lib/org-portal/find-person.ts`, sha1 `a22d1e14…`) to the session scratchpad; copied the worktree there with `rsync` (excluding `node_modules`, `.git`, `.next`) and symlinked `node_modules`; reverse-applied the source diff with `patch -R -p1`; `cmp` confirmed the copy's two source files are byte-identical to `HEAD` (unfixed) and its two test files byte-identical to the tree under judgment; deleted the copy afterwards (it held a copy of `.env.local`). The tree under judgment was never modified. `git status --short` afterwards shows exactly the Phase 4 state: four `M` files plus the untracked work-log. `git stash list` is empty.

**Fail before.** `npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/directory.test.ts src/lib/org-portal/find-person.test.ts` on the unfixed copy: `Tests 9 failed | 88 passed (97)`, 0 skipped.

| # | Test | Red at | Error |
|---|---|---|---|
| existing | `getHouseholds (Increment 3) > lists a household with visible members, with the correct memberCount` | `src/lib/directory.test.ts:921` | expected 3 to be 2 |
| existing | `getHouseholdDetail (Increment 3) > returns the household's name and its visible members` | `src/lib/directory.test.ts:970` | expected 3 to be 2 |
| 1 | `getDirectory omits an ended member, with and without a search` | `src/lib/directory.test.ts:1299` | not.toContain endedMember |
| 2 | `getPersonDetail returns not-found for an ended member` | `src/lib/directory.test.ts:1307` | got `{kind:'ok'}` |
| 3 | `getHouseholdDetail does not count or list an ended member` | `src/lib/directory.test.ts:1313` | expected 3 to be 2 |
| 4 | `getHouseholds does not count an ended member` | `src/lib/directory.test.ts:1325` | expected 3 to be 2 |
| 5 | `includeHidden does not resurrect an ended member` | `src/lib/directory.test.ts:1340` | not.toContain endedMember |
| 7 | `does not match a member whose relationship has ended (F136)` | `src/lib/org-portal/find-person.test.ts:307` | got `personIds: [endedMember]` |
| 8 | `find-person and the directory agree on who is eligible (F136)` | `src/lib/org-portal/find-person.test.ts:335` | not.toContain endedMember |

A second run with the verbose reporter confirmed these were green on the unfixed code, as designed: test 6, `an otherwise identical member with no end date is still listed` (the control), and all seven existing find-person cases.

**Pass after.** The same command on the real tree: `Test Files 2 passed (2) | Tests 97 passed (97)`, 0 skipped. This matches Phase 4's pasted output exactly.

## Type Check

`npm run typecheck`: **PASS**. `npm run lint`: **PASS** (`--max-warnings=0`). `npm run check`: **PASS** — all six tripwires.

## Unit Tests

- **Mocked lane, `npm test`.** Files: 267 passed, 35 skipped (302). Tests: 3483 passed, 940 skipped (4423). The 35 skipped files are the `describe.skipIf(!hasDb)` DB suites.
- **DB lane, `npm run test:db`** (`--no-file-parallelism`, pipeline Neon branch). Files: 302 of 302 passed. Tests: 4423 of 4423 passed. **0 skipped, 0 failed.** Covers `src/lib/people.test.ts`, the one other suite importing the directory module.
- **Failures:** none.

## End-to-End Tests

**Not run, and none exists for these surfaces.** Not an auth-touching diff (`git diff HEAD -- src/app` is empty). No spec renders the directory list, a person page, a household page or Find-a-person; DB-suite-covered by design (analyst gap 4). The standing `directory.view` e2e gap remains the separate `docs/TODO.md` item.

## Regression Tests Added

Inside `describe("an ended relationship is not in the directory (F136)")`:
- `getDirectory omits an ended member, with and without a search` — `src/lib/directory.test.ts:1293`.
- `getPersonDetail returns not-found for an ended member` — `:1305`.
- `getHouseholdDetail does not count or list an ended member` — `:1310`.
- `getHouseholds does not count an ended member` — `:1319`.
- `includeHidden does not resurrect an ended member` — `:1328`.
- `an otherwise identical member with no end date is still listed` — `:1349` (the control).
- `does not match a member whose relationship has ended (F136)` — `src/lib/org-portal/find-person.test.ts:305`.
- `find-person and the directory agree on who is eligible (F136)` — `:310`. Non-vacuous: asserts `unique`/`byEmail` matched and `ok`, and `endedMember` absent and `not-found`; red before the fix at `:335`.
- The existing `memberCount` assertions (`directory.test.ts:921`, `:970`) went red before and green after, as designed.

## Coverage on Critical Modules

`permissions.ts`, `two-factor.ts`, `flags.ts`: untouched, not re-measured. Branch coverage of the changed predicate: `includeHidden = true` arm tested (test 5); `includeHidden = false` / no-`status` arm tested (1–4, 6, 7, 8); the `status` arm verified **by reading only** — see advisory 1.

## Inspection

- The new term `and m.ended_on is null` sits at `src/lib/directory.ts:260`, no date comparison, unconditional (after the `includeHidden` ternary, before the `status` ternary).
- `directoryEligibilityWhereSql` still not exported (`:252`). `findDirectoryPersonIds` (`:362`) has its only import at `find-person.ts:4`, composes `directoryEligibilityWhereSql(false)`, `like` stays a bound parameter, SQL byte-equivalent to the removed copy except the eligibility fragment.
- `findPersonMatches()` still runs its own `presby_has_permission(…, 'directory.view')` inside `withOrgContext` before the finder (`find-person.ts:43-62`). No hand copy left (grep for `date_of_death`, `merged_into_id`, `directory_hidden` in `find-person.ts` returns nothing).
- No `getPlatformDb()`, no `console.log`. `deriveDeaconsByOrgUnit` untouched. Admin members list calls `getDirectory` unchanged and typechecks. Diff scope: exactly the four source/test files plus the untracked work-log.

## Feature-Gate Audit

No route handler or `"use server"` action edited. Entry points whose query path changed, gates confirmed by reading:

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct key? |
|---|---|---|---|
| action `findPersonAction` (`src/app/(org)/o/[slug]/find-person-action.ts`) | yes (`:48`), then `resolveOrgContext` (`:53`) | n/a (tenant axis) | `directory.view` via `presby_has_permission` inside `findPersonMatches` (unchanged) |
| `/o/[slug]/directory`, `/directory/[personId]`, `/directory/households/[householdId]`, `/directory/parishes` | yes, page-level, unchanged | n/a | `directory.view` / `directory.view_hidden` (`directory.ts:520-523`, `:550-553`) |
| `/o/[slug]/admin/members` | yes, `cachedAuth()` + `resolveOrgContext` + `assertOrgAccess` | n/a | flag + org toggle, then `getDirectory`'s `directory.view`, unchanged |
| `/o/[slug]/admin/members/new`, `/[id]/edit` household pickers | yes, unchanged | n/a | `directory.view` inside `getHouseholds`, unchanged |

**No gate added, removed or changed.**

## Verdict

**PASS.**

Advisories, none blocking:
1. No test runs the `status` branch with an ended row (legal: `memberships_one_active_roll_idx` is partial on `ended_on is null`).
2. No test pins "future-dated `ended_on` counts as ended"; the no-date-comparison rule is enforced only by the doc comment at `directory.ts:242-246`.
3. `findDirectoryPersonIds` is a new exported reader with no permission check of its own; its only caller checks `directory.view` first, and a future caller must too.
4. Naming style: the new test names rely on the `describe`/`(F136)` markers rather than a `— regression for …` suffix. Cosmetic.

## Handoff

**Next agent: analyst (Phase 6, bug-fix brief).** Confirm that a person with an ended relationship no longer appears on any of the six readers; the claim covers directory readers only (`children.ts`, `role-grants.ts` untouched, analyst gap 2). Carry the two Phase 3 TODO lines and the advisories above into the close-out.


---

# Phase 6 — Shipped vs Intent (analyst)

*Recorded verbatim by the orchestrator, 2026-10-14.*

**Reviewed:** 2026-10-14. HEAD `03d6459` on `fix/directory-ended-memberships`, worktree `/Users/cshenso/git/presby-platform/presby-directory-fix`. I wrote nothing. The probe script ran from the session scratchpad, was copied into the worktree for the run, and was deleted. `git status` shows only the untracked work-log.

## VERDICT

**SHIP WITH NOTES.** The bug no longer manifests on any of the six readers, and none of the intended behaviour I listed in Phase 1 changed. The notes are follow-ups to record at close-out, not defects in this fix.

## ONE-LINE TAKE

> A person whose relationship with the congregation has ended no longer appears in the directory, households grid, household page, person page, parish roster or Find-a-person. The jump can no longer send a member to a page that 404s.

## What I ran

- **DB suites.** `npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/directory.test.ts src/lib/org-portal/find-person.test.ts` against this pipeline's own Neon branch (`ep-morning-band-ax5fazzf`). Result: 2 files passed, **97 of 97 tests passed**, 0 skipped. This matches the Phase 4 and Phase 5 output.
- **User-level probe.** Read-only SQL on the owner connection (`MIGRATE_DATABASE_URL`) of the same branch. The first attempt used the app connection (`DATABASE_URL`, RLS-enforced) and returned no rows, as expected. On the owner connection:

| org | engagement | `current_roll` | `ended_on` | old eligibility arm | `ended_on is null` (new term) | `presby_membership_is_active` |
|---|---|---|---|---|---|---|
| `e2e-beta` | regular | null | 2026-03-31 | true | **false** | false |
| `fernwood` | regular | null | 2026-03-31 | true | **false** | false |

  Before the fix, both rows passed the predicate's eligibility arm while the access gate already refused them. The new term now excludes both, so the predicate agrees with the gate. I did not render the pages; I relied on the suites plus this predicate-level proof.

## What's Working

**Does a person with an ended relationship still appear on any of the six readers? No.**
- The term `and m.ended_on is null` sits once in `directoryEligibilityWhereSql()` (`src/lib/directory.ts:260`). It is unconditional, so it applies under `includeHidden` and in both the `status` and no-`status` branches.
- All five directory readers go through that predicate: the list, the households grid, the household page, the person page and the parish roster.
- Tests cover every reader except the status branch (advisory 1): list and search (test 1, `directory.test.ts:1299`); person page (test 2, `not-found`, `:1307`); household page (test 3, `:1313`); households grid (test 4, `:1325`, and the existing `memberCount` assertions `:921`, `:970`); parish roster path (test 5, `:1340` — `getParishRoster` exposes only household counts, so it asserts `getDirectory` ids and `getHouseholds` counts with `includeHidden: true`).
- The `endedMember` is in a household, so the household readers are proven, not only the list. That closes Phase 1 gap 3.
- Test 6 is the control. A `currentSameShape` member with the same shape and no end date is still listed, so the fix does not over-exclude.

**Does the Find-a-person jump still reach them? No, and that is correct.**
- `findPersonMatches()` now calls `findDirectoryPersonIds()`, which composes `directoryEligibilityWhereSql(false)`. `find-person.ts` holds no eligibility SQL of its own.
- Test 7 gets `personIds: []` for the ended member. Test 8 is the find-person versus directory equivalence guard, non-vacuous, red pre-fix at `find-person.test.ts:335`.
- Phase 1 gap 5 (a single predicate, no third hand copy) is closed. The predicate stays unexported.

**Did any intended behaviour change? No.** Hidden members (`directory_hidden` term untouched; `includeHidden` still drops only that term); deceased and merged exclusions untouched; status filter untouched (`ended_on is null` is a separate unconditional AND before the `status` ternary); `deriveDeaconsByOrgUnit` not in the diff; eligibility OR-clause unchanged (`staff` rows stay out); not-found non-disclosure byte-identical; no permission or gate changed (`findPersonMatches` still reads `directory.view` first); future-dated `ended_on` counts as ended with no date comparison, matching the gate; diff scope is exactly the four source and test files.

## Intent-vs-Shipped Diff

| Phase 1 point | Shipped |
|---|---|
| One term fixes all six readers | Yes. |
| Match the gate, no date comparison | Yes. |
| Consolidate `findPersonMatches` onto the shared predicate (gap 5) | Yes, via `findDirectoryPersonIds`. |
| Fixture must sit in a household (gap 3) | Yes. |
| Pinned pagination totals unaffected | Yes. |
| Admin members list and household pickers inherit the change | Accepted, as recommended. No second predicate was forked. |
| No e2e coverage (gap 4) | Confirmed. The DB suites carry it. |
| Gaps 1 and 2 | Deferred, not addressed in code, as designed. TODO lines below. |

## Edge Cases

- **Production flag state is unconfirmed.** Inferred from `docs/STATE.md` that `org_portal.directory`, `org_portal.directory_v2` and `org_portal.home_v2` are ON in production; not queried. A live read is the operator's gesture.
- **Commit trailer.** The committed trailer reads `Co-Authored-By: Claude Fable 5.1`; the work-log draft said `Claude Sonnet 5.5`. *(Orchestrator: the committed form is the correct one for this session's attribution rule; the draft was wrong. No action.)*
- **Release-note wording.** Accurate: former members' details "could still be shown"; Find-a-person "could take someone straight to their page"; "No record is removed"; no screen lists former members yet (gap 1); the admin members screens "also stop offering former members" (the accepted inheritance). No residual is denied.
- **Latent household surfaces.** The two measured ended rows have `household_id` null; the household fix is proven by the test fixture, not by live data. Accepted.

## Follow-Ups (SHIP WITH NOTES — TODO lines for the close-out, Rule 10)

1. No admin view of ended memberships (analyst gap 1).
2. Children and role-grant readers share the ended-member blind spot (analyst gap 2).
3. Test debt: no test runs the directory status filter against an ended row (QA advisory 1).
4. Test debt: no test pins "a future-dated `ended_on` counts as ended" (QA advisory 2).
5. Guard: `findDirectoryPersonIds()` is an exported reader with no permission check of its own (QA advisory 3).
6. Operator verification: confirm production flag state for the F136 fix against `br-wild-band-ax96gv09`; after v0.31.1 deploys, the same read confirms the fix is live.

Advisory 4 (test-name suffix style) is cosmetic and needs no TODO line. At close-out also: the Done line; the functionality-map Directory clause (Rule 14); `package.json` 0.31.0 → 0.31.1; the `v0.31.md` release note; F136 in `docs/schema-design-2.md`; no feedback-row update (Rule 12 — no originating row); what's-new optional, the release note suffices (Rule 13); `docs/architecture.md` untouched (Rule 15).

## Handoff

**Next agent: orchestrator.** Record this section; land the close-out `docs:` commit; push only after the user's approval and `/pre-push`; run the production flag query after deploy; notify the portal-home-alignment pipeline that Part B is unblocked.

