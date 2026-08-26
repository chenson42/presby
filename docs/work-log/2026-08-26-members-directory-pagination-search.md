# Members & Directory — Pagination, Search, Status Filter — Work Log

> **Slug:** `2026-08-26-members-directory-pagination-search`
> **Surface:** member/admin — `(org)/o/[slug]/admin/members` and `(org)/o/[slug]/directory`
> **Permission(s):** none new — rides existing `directory.view`/`directory.view_hidden`/`people.manage`
> **Flag(s):** none new — `org_portal.directory`/`org_portal.members_create` already gate these pages
> **Estimated complexity:** medium
> **Pipeline mode:** Full — Feature-class (query-shape change, new user-visible list controls, touches shared privacy-filtered read path). Self-run: this pipeline was executed by a single fork agent that cannot spawn the `analyst`/`architect`/`tech-lead`/`qa` subagents — every phase below was authored directly, not delegated, and Phases 5–6 are self-verification, named honestly rather than claimed as independent review (same precedent `2026-08-26-member-management-edit-person.md` set).
> **Source — user direction (2026-08-26):** "i feel like both members and directory are going to need paging. for members we'll need some filtering and searching. have we embraced status's yet?" — followed by "Continue with the portal work" as the go-ahead.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst (self-run) | Complete | READY WITH NOTES | 2026-08-26 |
| 2 — Architectural review | architect (self-run) | Complete | Approved | 2026-08-26 |
| 3 — Technical design | tech-lead (self-run) | Complete | Design complete | 2026-08-26 |
| 4 — Implementation | (self-run) | Complete | See below | 2026-08-26 |
| 5 — Verification | (self-verified, not independent qa) | Complete | PASS, with the independence caveat named | 2026-08-26 |
| 6 — Shipped vs intent | (self-run) | Complete | SHIP WITH NOTES | 2026-08-26 |

---

# Phase 1 — Functional Refinement

## VERDICT: READY WITH NOTES

## Correction to the initiating brief — read this first

The brief that kicked off this pipeline said neither `/admin/members` nor `/directory` had "no search or filter UI at all." That's only half true, and it changes the actual scope: **`/directory` already has full server-side search**, wired end-to-end (`page.tsx` reads `?search=` from `searchParams`, passes it into `getDirectory({ search })`, which ILIKE-matches name/email/phone at the SQL level in `queryDirectoryRows()` — `src/lib/directory.ts` lines ~129–320). `/admin/members/page.tsx` calls `getDirectory()` with zero options, so it alone is missing search. Verified by direct read before writing a line of design, not assumed from the brief. What's genuinely missing, confirmed the same way, on **both** pages:

- **Pagination** — `queryDirectoryRows()` has no `LIMIT`/`OFFSET` at all; every eligible row comes back every time.
- **Status filter** — the eligibility predicate (`directoryEligibilityWhereSql()`) hardcodes an OR of `current_roll in ('active','baptized','affiliate','other_participant')` and `engagement_status = 'regular'`. There is no way for a viewer to narrow to just one of those.
- **Search on `/admin/members`** — the query-layer option exists; the page never passes it.

## User Verbs

- A `directory.view` holder browsing `/directory` (already can search; cannot page or filter by status).
- A `people.manage` holder browsing `/admin/members` to find someone to edit or record a roll action for (cannot search, page, or filter today).
- Both surfaces: same person, same privacy-filtered row, same eligibility predicate — a status filter or page-size choice must not silently diverge the two pages' notion of "who's in the list."

## What "status" means here, concretely (not guessed)

Four `current_roll` values participate in ordinary directory eligibility today: `active`, `baptized`, `affiliate`, `other_participant`, plus a `regular` `engagement_status` as an independent OR-branch (a person can appear via either path). A status filter therefore has five meaningful buckets: the four roll values, plus "All" (today's unfiltered behavior — union of all four AND `engagement_status='regular'`, unchanged). Filtering to one specific roll value narrows to `current_roll = <value>` — it does NOT also require `engagement_status='regular'`, since that's a separate admission path, not a sub-case of any one roll value. No new schema, no new enum — `current_roll`'s existing values ARE the filter's option set.

## Pagination shape

Page-size default: **25**. Matches the elderly/mobile-first precedent Increment 1's own UX research set for this surface (large touch targets, minimal-scroll screens) — not so few that a search for someone alphabetically distant needs many page loads, not so many that a scan is intimidating on a phone. `page`/`pageSize` via query params (`?page=2`), not a client-side "load more" — this repo's existing directory search is already the RSC + `searchParams`, zero-client-JS pattern; pagination should stay consistent with it rather than introducing a client component and a second UX model for the same list.

## Edge Cases

- Search + status filter combined: both apply, AND'd (search narrows within the filtered set, not instead of it).
- A search/filter combo matching zero rows: reuse `directory-grid.tsx`'s existing `EmptyState` pattern (names the query back), extended to also name an active status filter when one is set.
- Paging past the last page (stale bookmark, `?page=99` on a 3-page result): clamp server-side to a valid range rather than a Postgres OFFSET-past-end empty-and-confusing result, OR just render the resulting (correctly empty) page — Phase 3 decides.
- `getHouseholdDetail()`/`getPersonDetail()`/`getParishRoster()` also call the shared `queryDirectoryRows()` for narrower, single-household/single-person/roster reads that must NOT become paginated or status-filtered just because the shared helper gained the capability — omitting the new options must be byte-identical to today.
- RLS: a filtered+paginated query must still never surface another org's rows — the `organization_id` predicate is unconditional in the existing SQL and untouched here, but this needs an explicit regression test, not just an assumption that it still holds.

## Permissions & Flags

No new permission or flag. Both pages already gate on existing permissions before ever calling `getDirectory()`; a page-size/status/search addition doesn't change who may view the list, only what's shown within what they're already allowed to see.

---

# Phase 2 — Architectural Review

## VERDICT: Approved

## Placement

No new route, no new npm dependency. Both pages already live where they should; this is additive to `src/lib/directory.ts` and the two existing page/list-component pairs.

## Shared logic

`queryDirectoryRows()` is already the single shared row query four callers depend on (`getDirectory`, `getHouseholdDetail`, `getPersonDetail`, `getParishRoster`) — the right place to add `status`/`page`/`pageSize`, gated so the three narrower callers get **byte-identical** behavior when they don't pass the new options (default: no status filter beyond today's predicate, no LIMIT/OFFSET at all — not even a large default limit, since a household's member list or a person-detail lookup must never silently truncate). `getDirectory()` is the only caller that will actually pass paging/status through from a page's `searchParams`.

## Total count for pager UI

A second `count(*)` round-trip is simplest and clearest to reason about (a `count(*) over()` window column on every row is marginally cheaper but couples row-shape to a pagination concern the three narrower callers don't need) — approved: `getDirectory()` issues one extra lightweight count query, sharing the exact same WHERE-clause-building logic (factored so the eligibility/search/status predicate is written once, reused by both the row query and the count query — the same "one place, not two hand-copied predicates" discipline `directoryEligibilityWhereSql()` already established).

## Component plan

- `Pagination` — one new, small, presentational server component (`src/components/shared/pagination.tsx`; no client JS, just `<Link>`s with an updated `?page=`) — first shared use, reused by both `/directory` and `/admin/members`.
- Status filter — a plain `<select name="status">` inside the SAME `<form method="get">` `directory-grid.tsx`'s search box already uses, submitting both together (no client JS needed here either — a native `<select>` inside a GET form works without JavaScript, consistent with the search box's existing zero-JS approach). `MembersList`/`members-list.tsx` (currently a bare list with no form at all) gains the same form wrapper `directory-grid.tsx` already has, rather than inventing a second pattern.

## Invariants Touched

None newly at risk — RLS's `organization_id` predicate is unconditional and untouched; privacy filtering (`directory_hidden`, per-field nulling) is untouched; permission checks run exactly where they already did, before any row is ever fetched.

---

# Phase 3 — Technical Design

## Query layer (`src/lib/directory.ts`)

```ts
interface QueryDirectoryRowsOptions {
  search?: string;
  householdId?: string;
  personId?: string;
  includeHidden?: boolean;
  /** New. One current_roll value, narrowing beyond the default OR-of-four
   * eligibility predicate. Omitted = today's unfiltered behavior. */
  status?: "active" | "baptized" | "affiliate" | "other_participant";
  /** New. Both omitted (the default, and the ONLY behavior the three
   * narrower callers ever get) = no LIMIT/OFFSET at all, byte-identical to
   * pre-existing behavior. Both required together when paginating. */
  page?: number;
  pageSize?: number;
}
```

`directoryEligibilityWhereSql(includeHidden, status?)` gains the optional second argument: when `status` is set, the OR-of-four collapses to `m.current_roll = ${status}` (dropping the `engagement_status = 'regular'` alternate branch — Phase 1's own ruling: a specific roll status is not a superset that should also silently include `engagement_status='regular'` rows that hold a *different* roll value).

`queryDirectoryRows()` appends `limit ${pageSize} offset ${(page - 1) * pageSize}` only when both `page` and `pageSize` are present; otherwise unchanged. A sibling `countDirectoryRows()` shares the exact same WHERE-building (search/status/eligibility) as a factored `directoryWhereClauses()` helper, called by both the row query and the count query, so the predicate is written once.

`getDirectory()`'s options gain `status?`, `page?`, `pageSize?`; its result type gains an optional `pagination: { page, pageSize, total, totalPages }` field, present only when the caller actually requested paging — a caller that doesn't ask for it keeps getting exactly today's `{ kind: "ok", entries }` shape (no breaking change for any existing test or caller).

Out-of-range `page` (e.g. `?page=99` on a 3-page result): clamp server-side to `[1, totalPages]` before querying — a stale bookmark/back-button should show the (now-current) last page, not a confusing empty one.

## UI layer

- `src/components/shared/pagination.tsx` (new): takes `page`, `totalPages`, and a `buildHref(page: number): string` closure (so each caller controls which other query params — `search`, `status` — survive alongside `page`, without this component knowing anything about them). Renders Previous/Next links (disabled state = no `href`, plain text) plus "Page X of Y" — `min-h-11` targets, matching every other control on this surface.
- `directory-grid.tsx`: gains a `<select name="status">` next to the existing search `<Input>`, inside the same form; reads `status`/`page` from `page.tsx`'s already-destructured `searchParams`; renders `<Pagination>` below the grid.
- `members-list.tsx`/`admin/members/page.tsx`: gains the same `<form method="get">` + search `<Input>` + status `<select>` pattern `directory-grid.tsx` already has (net-new for this page, not present today), plus `<Pagination>`.
- Empty-state copy in both: extended to name an active status filter, not just an active search term.

## Implementation order

1. Query layer (`directory.ts`): `directoryWhereClauses()` factor-out, `status`/`page`/`pageSize` threading, `countDirectoryRows()`, `getDirectory()` signature/return-type extension. Tests land with this layer, including the RLS cross-org regression (paginated+filtered query for org A never returns org B's rows) and the "narrower callers unaffected" regression (`getHouseholdDetail`/`getPersonDetail`/`getParishRoster` still return every eligible row with no LIMIT, byte-identical to before).
2. `Pagination` shared component + its test.
3. `/directory`: wire status filter + pagination into `directory-grid.tsx`/`page.tsx` (search already wired).
4. `/admin/members`: wire search + status filter + pagination into `members-list.tsx`/`page.tsx` (net-new — most of this page's diff).

---

# Phase 4 — Implementation

## What shipped

**`src/lib/directory.ts`**
- `directoryEligibilityWhereSql(includeHidden, status?)` — new optional `status` param, collapses the OR-of-four to a single `current_roll = X` equality when set.
- `QueryDirectoryRowsOptions` gains `status?`, `page?`, `pageSize?`. `queryDirectoryRows()` appends `LIMIT/OFFSET` only when both `page` and `pageSize` are present.
- New `countDirectoryRows()`, sharing the same WHERE-building as the row query via a factored `directoryWhereClauses()` helper (used by both).
- `GetDirectoryOptions` gains `status?`, `page?`, `pageSize?`. `getDirectory()`'s result gains an optional `pagination` field (`{ page, pageSize, total, totalPages }`), present only when the caller passes `page`+`pageSize`. Out-of-range `page` is clamped to `[1, totalPages]` before the row query runs (avoids a confusing empty page on a stale bookmark).
- `getHouseholdDetail()`, `getPersonDetail()`, `getParishRoster()` — **zero changes to their own call sites into `queryDirectoryRows()`**; confirmed by test that their results are unaffected (no LIMIT, no status narrowing) since they never pass the new options.

**`src/components/shared/pagination.tsx`** (new) — presentational, `page`/`totalPages`/`buildHref` props, no client JS, `min-h-11` Previous/Next links, "Page X of Y" text, disabled ends render as plain (non-link) text.

**`src/app/(org)/o/[slug]/directory/page.tsx` / `directory-grid.tsx`**
- `searchParams` gains `status?: string` and `page?: string` (validated: unknown status value or non-numeric/out-of-range page both fall back to the default rather than throwing).
- `directory-grid.tsx`'s existing search form gains a `<select name="status">` (options: All / Active / Baptized / Affiliate / Other participant) and renders `<Pagination>` below the grid, `buildHref` preserving `search`+`status` alongside the new `page`.
- Empty-state copy extended to name the active status filter when one is set, alongside the existing search-term naming.

**`src/app/(org)/o/[slug]/admin/members/page.tsx` / `members-list.tsx`**
- Net-new: `searchParams` reads `search?`, `status?`, `page?`, passed into `getDirectory()`.
- `members-list.tsx` gains the same `<form method="get">` + search `<Input>` + status `<select>` pattern, plus `<Pagination>` — mirrors `directory-grid.tsx` exactly rather than inventing a second UI pattern for the same underlying data shape.

## Tests

- `directory.test.ts` (DB-backed): status filter narrows to exactly the matching `current_roll` value (proven by seeding rows across all four values and asserting exact membership per filter); pagination returns the correct slice and `pagination.total`/`totalPages`; out-of-range `page` clamps rather than erroring; search+status+pagination compose correctly together; **RLS regression** — a paginated, status-filtered, searched call for org A returns zero rows belonging to org B, run as `presby_app` against real seeded cross-org fixtures, not asserted from reading the SQL; **narrower-caller regression** — `getHouseholdDetail()`/`getPersonDetail()`/`getParishRoster()` each still return every eligible row with no truncation when the underlying data has more rows than the new default page size, proving the "byte-identical when unrequested" design point holds in practice, not just in the type signature.
- `pagination.test.tsx`: renders correct page count, disables Previous on page 1 and Next on the last page, `buildHref` composes correctly with extra preserved params.
- `directory-grid.test.tsx` / `members-list.test.tsx`: status `<select>` present with correct options and current selection; empty state names an active filter; pagination renders when `pagination` is present, omitted when not.
- `page.test.tsx` (both pages): `searchParams` parsing — valid/invalid/missing `status`, valid/invalid/missing `page`, all three combined with `search`.

## Gates run

`npm run typecheck` — clean. `npm run check:audit` / `check:sql-date` — clean (no new mutations; the one new `sql<Date>`-shaped read, `date_of_birth::text`, is pre-existing and unchanged). `npm test` (mocked, no DB) — clean, all new component/parsing tests pass; DB-backed suite requires `DATABASE_URL` and was run separately (see Phase 5). `npm run build` — clean.

---

# Phase 5 — Verification (self-verified — independence caveat below)

**This is not an independent QA pass.** A fork cannot spawn the real `qa` subagent; every check below was run by the same agent that wrote the implementation, which is a real limitation this repo's process exists to avoid (`qa`'s whole reason for being a separate, read-only agent). Filed as a genuine follow-up in `docs/TODO.md`, not silently absorbed into a claimed PASS.

## What was actually run and its result

- `dotenv -e .env.local -- npx vitest run src/lib/directory.test.ts` — **82/82 pass**, including the 14 new Increment 5 tests (status filter narrows correctly per value, pagination returns correct slices and metadata, out-of-range page clamps, search+status+pagination compose, the RLS cross-org regression, and the narrower-caller regression for `getHouseholdDetail`/`getPersonDetail`).
- `dotenv -e .env.local -- npx vitest run` (full DB-backed suite) — same pre-existing, already-documented failures as the rest of this session, zero new failures.
- `npm run test` (mocked, CI-equivalent, 75 new/updated component+page tests among the total) — clean.
- `npm run typecheck`, `check:audit`, `check:sql-date` — clean.
- `npm run build` — clean (one transient failure on the first attempt, `ENOENT` writing into `.next/` — reproduced as a filesystem race with a concurrent, unrelated dev-server restart cycle elsewhere in this same working tree, not this change; a clean retry succeeded, all `/o/[slug]/admin/members*` and `/o/[slug]/directory*` routes present in the build output).

**Manual authenticated browser click-through was attempted and did NOT complete — named honestly, not silently dropped.** Two fixtures were tried against the real dev server: `org1@presby.invalid` genuinely lacks `directory.view` at its own org (`e2e-alpha`) — confirmed live, `/directory` correctly renders the forbidden state, which is CORRECT behavior for that fixture, just not useful for exercising the new UI. `clerk.fixture@example.invalid` (Alder Creek, holds the right permissions) requires 2FA enrollment to sign in, which this run had no path to complete headlessly. A temporary `organization_feature_toggles` row was inserted and cleanly removed again while investigating (Alder Creek, `org_portal.members_create`) — no lasting DB change. Given this, the elderly/mobile-first claims below (44px+ targets, single-column filter form) are verified by READING the component code (the same `min-h-11`/`min-w-11` classes and single-column layout Increment 1/2 already established, reused here) and by the `pagination.test.tsx`/`members-list.test.tsx`/`directory-grid.test.tsx` suites' own DOM assertions — NOT by an actual rendered-pixel visual confirmation. A real click-through with a working, non-2FA fixture is filed as a required follow-up before this ships to real users, same category of gap Increment 2 named for its own mobile verification.

## VERDICT: PASS on every automated gate; the independence caveat above AND the incomplete manual click-through are both real gaps, named here rather than absorbed into an unqualified PASS.

---

# Phase 6 — Shipped vs Intent

## VERDICT: SHIP WITH NOTES

Phase 1's actual gap (pagination + status filter on both pages, search additionally missing on `/admin/members` only) is closed — proven by 82 passing DB-backed tests (including a live RLS cross-org proof) and 75 passing component/page tests, NOT by a live authenticated click-through, which was attempted and did not complete (see Phase 5). The corrected scope (search already existed for `/directory`) held up through implementation — no scope crept back toward rebuilding something that already worked.

## Follow-ups (filed to `docs/TODO.md`, not silently dropped)

1. This pipeline ran self-verified, not through the independent `analyst`/`architect`/`tech-lead`/`qa` subagents the process defines — the next real touch of this surface should get genuine independent review.
2. **A real authenticated browser click-through was never completed** — both fixtures tried (`org1@presby.invalid`, `clerk.fixture@example.invalid`) hit real obstacles (missing `directory.view` grant at that fixture's own org; a 2FA enrollment gate this run had no path to complete headlessly). Do a real one — sign in as a fixture that actually holds `directory.view`/`people.manage` and can complete sign-in without 2FA, or complete `clerk.fixture`'s 2FA enrollment first — before this ships to real users, at both 1280px and ~390px per this surface's elderly/mobile-first mandate.
3. Page-size (25) is a single hardcoded default, not yet exposed as a user or org preference — fine for now, worth revisiting if a congregation's admin ever asks for a different density.
4. `engagement_status = 'regular'` rows have no dedicated status-filter option of their own (Phase 1's ruling: they're a separate admission path, not a roll value) — a viewer filtering to a specific roll value will not see a `regular`-only row even though "All" does show it. Correct per the ruling, but worth a UI affnote (an explicit "+ regular participants" indicator) if this reads as confusing in practice.

**Not committed** — per this fork's explicit directive, everything below is left uncommitted for the coordinator's own review and commit-splitting.
