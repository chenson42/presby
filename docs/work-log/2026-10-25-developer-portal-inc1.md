# Developer portal, Increment 1: Frame and hardening — Work Log

> **Slug:** `2026-10-25-developer-portal-inc1`
> **Parent:** `2026-10-25-developer-portal` (Phase 1 G1–G14, Q1–Q14, the three operator quotes and Phase 2 Rulings 1–9, A1/F287 live there, verbatim; this child records Increment 1's Phase 3 through Phase 6 and the Phase 3 conventions every later increment inherits)
> **Surface:** (admin) `/developer`
> **Permission(s):** none new. The gate is the existing `users.is_platform_admin` predicate read live (DECISION-044); Increment 2 swaps the predicate inside the one gate
> **Flag(s):** not needed (operator: no new platform flags pre-live; rollback is a revert of the PR). No new or changed page or spec reads a flag
> **Estimated complexity:** large (about 45 files, no schema, one `src/proxy.ts` line)
> **Pipeline mode:** Full
> **Numbers:** DECISION-258, 261 (drafts below); F283, F284, F285, F288 (F288 moved here from Increment 3, see Carry-forward); no migration (0071 released); dev port 3570; no e2e person rows in this increment (the `00000000-0000-4258-` range is Increment 2's)
> **Worktree:** `/Users/cshenso/git/presby-platform/presby-devportal`, branch `pipeline/developer-portal`, at `main` b903154. The worktree has no `node_modules` and no `.env.local` (Phase 4 step 0). **Auth-touching** (`src/proxy.ts`): the CLAUDE.md Phase 4 MFA e2e smoke applies, and Phase 5 `PASS` requires it against a real dev server on port 3570.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Shared; recorded in the parent | READY WITH NOTES | 2026-10-25 |
| 2 — Architectural review | architect | Shared; recorded in the parent | Approved with suggestions | 2026-10-25 |
| 3 — Technical design | tech-lead | Complete (this file); Copy four-check, Carry-forward and e2e blast radius below; no operator answer blocks Phase 4 | Design complete | 2026-10-25 |
| 4 — Implementation | ux-developer (Batches A, C), api-developer (Batch B) | In progress: Batch A (shell promotion) done and committed; Batches B (api-developer) and C (ux-developer) pending | — | 2026-10-25 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 and Phase 2

Recorded in full in `docs/work-log/2026-10-25-developer-portal.md` (parent). Not repeated here. Increment 1 is designed against Rulings 3, 4, 7 (the Increment 1 rows), 9 and the "Other things Phase 3 must honor" list; Rulings 1, 2, 5, 6 and A1/F287 are Increment 2's, Ruling 7's API-inventory and readers rows are Increment 3's, Ruling 8 is Increment 4's. The Carry-forward table below names every row.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Increment 1 turns `/developer` from an unframed, ungated-by-2FA schema list into a small portal with a frame, and changes who may read nothing. It adds: a layout that carries chrome only (a header with the shared avatar menu, a left nav that becomes a phone sheet, a skip link, a way back to `/home`); an `error.tsx`, a `not-found.tsx` and no `loading.tsx` (pinned by a scan); a home page of provenance-labelled cards; the old index moved to `/developer/data-model` with `tables/[table]`, `erd/[module]` and `schema.json` keeping their URLs; and a Documentation page of labelled, honest placeholders. Two real defects are closed. **F284:** `/developer` sat outside the 2FA gate, so a platform administrator whose account requires a second factor and has not verified it could read a map of the whole application; the proxy gains one segment-boundary line, the page gate repeats the check, and `schema.json` answers JSON itself. **F283 and F285:** the page claimed it "cannot drift from what is deployed" while 58 of 105 tables sat under "platform (from starter)" with no diagram and a hand list of invariants omitted six of CLAUDE.md's thirteen; two tests now fail CI when either list falls out of step, and the lists are repaired. One gate (`requireDeveloper`) returns `ok`, `forbidden` or `unavailable`; a database error no longer shows Next's default page and a signed-in non-entitled viewer no longer bounces silently to `/home` (**F288**). The shell is promoted out of padmin's `admin-portal/` into `src/components/shared/` with required props (DECISION-261), so the portal and `/admin` share one header and nav without a fork. The predicate stays `users.is_platform_admin` exactly as today; Increment 2 swaps it inside `guard.ts` and widens the audience.

## Feasibility check (against the live tree, 2026-10-25)

| Check | Result |
|---|---|
| Function signatures, `ALTER`/`DROP`, `SECURITY DEFINER` bodies, new CHECK/trigger vs `scripts/seed-dev.sql`, new FKs | **Not applicable.** No schema, no migration, no SQL function touched. |
| The padmin shell files this design promotes | Read from `/Users/cshenso/git/presby-platform/presby-padmin` at 6b49fd4. **Not on `main`** (PR #55 open): main lacks `src/components/admin-portal/*`, `src/components/ui/sheet.tsx`, `shared/load-error.tsx`, `shared/empty-state.tsx`, `lib/admin-portal/nav.ts`. Phase 4 step 0 re-runs this check (see Implementation Order). |
| Callers of the files being renamed | In padmin's branch: `(admin)/admin/layout.tsx`, the four `admin-*.test.tsx` files, `layout.test.tsx` (asserts `#admin-main`, unchanged), `shell-boundaries.test.ts` (scans `components/admin-portal/`). Nothing in `(org)`/`(public)` imports `admin-portal/` (grep: clean). |
| `cachedIsPlatformAdmin`, `sessionCanAccessAdmin`, `cachedAuth` | Exist (`src/lib/nav-data.ts:32`, `src/lib/platform-admin.ts:61`, `src/lib/auth/cached-auth.ts`). |
| Renaming `INVARIANTS.enforcement` `"documented"` to `"paper"` | One assertion depends on the old value: `src/lib/db/domain/events.schema.test.ts:175` (`toBe("documented")`). Listed as a modify target. `schema.json` serialises the field; nothing consumes it. |
| contact-methods scan (`src/lib/contact-methods/scan.test.ts`) | `src/lib/dev-docs.ts` names `contact_methods` in `MODULES` and carries the `contact-methods-scan-ok` marker. `MODULES`, `PLATFORM_TABLES` and `INVARIANTS` therefore **stay in `dev-docs.ts`**; no new non-test file may name the table. `dev-docs.test.ts` is a test and is exempt. |
| Unclassified tables | 105 `pgTable` exports (counted from `export const x = pgTable("name"` in `schema.ts` and `domain/*.ts`), 47 in `MODULES`, **58 unclassified** (matches G3). The test uses `getTableConfig`, so the test's number is authoritative. |
| `CLAUDE.md` Key Invariants headings | 13 `### ` headings between `## Key Invariants` and `## Post-Login Landing` (lines 459–677). |
| Lucide icons for `ProvenanceLabel` | `Cog`, `ListChecks`, `PenLine`, `Hourglass` exist in the installed `lucide-react`. |
| Existing e2e that touches `/developer` | None opens a page. `e2e/custom-domains/lockdown.spec.ts:107` lists `/developer` on a custom host (still true). Avatar-menu and `/home` specs assert the Developer item/card by name only, never its description. |
| `check:proxy-imports` | The proxy gains one path condition and no import. Unaffected. |
| `docs/schema-design.md` generated ERD block | `scripts/generate-erd.ts` filters the literal `"platform (from starter)"`; changing the module list changes the generated block. The implementer runs `npm run docs:erd` and commits the result. |

## Permissions & Flags

- **Permission key(s):** none new. No `FEATURES` entry, no `hasFeature()` call, nothing in the proxy's `PROTECTION_RULES`. (There must never be a `PROTECTION_RULES` entry for `/developer`; Ruling 1.)
- **Gate predicate (Increment 1):** `users.is_platform_admin`, read live, through `readIsPlatformAdmin` exactly as today. The two read seams are `readEntitled` (cached, for pages and the layout) and `readEntitledUncached` (route handler), both exported from `guard.ts`. Increment 2 changes those two lines and `cachedIsPlatformAdmin` in `src/lib/nav-data.ts`.
- **Default role bindings:** none.
- **Flag(s):** not needed. **Rollback:** revert the PR. Because the predicate is unchanged, no one gains or loses the portal in this increment.
- **Audit (Rule 7):** no mutation exists in this increment, so `check:audit` is unaffected and no `AUDIT_ACTIONS` key is added. Portal reads are not audited; that is the accepted residual of Q9, recorded in DECISION-259 (Increment 2).

## API Contract

No server actions and no new routes. One changed route handler, one changed Edge rule.

**`GET /developer/schema.json`** (changed). Every response carries `cache-control: no-store`.

| Condition (checked in this order) | Status | Body |
|---|---|---|
| No session | 401 | `{"error":"unauthorized"}` |
| `twoFactorRequired && !twoFactorVerified` | 403 | `{"error":"two_factor_required"}` |
| Predicate read throws | 503 | `{"error":"unavailable"}` |
| Predicate false | 403 | `{"error":"forbidden"}` |
| Schema or description read throws | 503 | `{"error":"unavailable"}` |
| Entitled | 200 | unchanged payload; `invariants[].enforcement` now `database` / `trigger` / `paper`, and each invariant gains `source` |

Note on reachability, so no one files it later: the proxy runs first. In production a signed-out or unverified browser reaches `/signin` or `/totp` by redirect and never sees the 401 or `two_factor_required` JSON; those two rows are defense in depth for a caller that bypasses the Edge, and are pinned by the handler's unit tests, not by e2e.

**`src/proxy.ts`** (changed). `isTwoFactorGated` gains `pathname === "/developer" || pathname.startsWith("/developer/")`. The segment-boundary form is deliberate: `/developerx` is not gated. The 2FA check runs before the `ADMIN_ROLE` shortcut, so an admin-role user who is required and unverified is challenged on `/developer` too. The fall-through comment's "Auth-only routes" list is updated to say `/developer` is 2FA-gated here and authorized per request by the page gate, never by the Edge.

**Gate module surface** (`src/app/(admin)/developer/guard.ts`, replaces `requirePlatformAdmin`):

```ts
export type DeveloperGate = "ok" | "forbidden" | "unavailable";
export const readEntitled: (userId: string) => Promise<boolean>;          // cached(readIsPlatformAdmin)
export const readEntitledUncached: (userId: string) => Promise<boolean>;  // readIsPlatformAdmin
export async function requireDeveloper(returnTo: string): Promise<DeveloperGate>; // redirects for signed-out / 2FA
export async function checkDeveloperApiRequest(): Promise<AccessVerdict>;         // for schema.json
```

**Pure decision** (`src/lib/developer-portal/access.ts`, no imports, unit-testable without mocks):

```ts
export type AccessVerdict = "signed_out" | "two_factor_required" | "ok" | "forbidden" | "unavailable";
export async function decideDeveloperAccess(input: {
  user: { id: string; twoFactorRequired?: boolean; twoFactorVerified?: boolean } | null | undefined;
  readEntitled: (userId: string) => Promise<boolean>;
}): Promise<AccessVerdict>;
```

Order: no user is `signed_out`; required and unverified is `two_factor_required`; then the read, inside a `try` that wraps **only** the `await readEntitled(...)` (a throw is `unavailable`, never `forbidden`); then `ok` or `forbidden`. `requireDeveloper` calls `redirect()` **outside** any try, per the `/launch` precedent (`redirect()` works by throwing).

**`returnTo` safety.** `requireDeveloper` accepts only `^/developer(/[A-Za-z0-9_~%.-]+)*$` with no segment that decodes to `.`, `..` or contains `/` or `\`; anything else becomes `/developer`. Pages pass a literal prefix plus `encodeURIComponent(param)`. `/signin` still runs `sanitizeCallbackUrl` on the way out, so this is a second lock, not the only one.

## Data Model

No schema changes required. No migration. `scripts/seed-dev.sql`, `scripts/test-rls.sql` and `drizzle/meta/_journal.json` are untouched.

## Component / Page Plan

### Route tree after this increment

```
src/app/(admin)/developer/
  layout.tsx            NEW   chrome only (header, nav, <main id="developer-main">), never the gate
  error.tsx             NEW   'use client', calm copy, never error.message
  not-found.tsx         NEW   calm 404 inside the chrome
  page.tsx              REWRITTEN  home: provenance-labelled cards
  data-model/page.tsx   NEW   the former index, moved (module lists, filter, invariants, permissions)
  docs/page.tsx         NEW   Documentation placeholder page
  tables/[table]/page.tsx   MODIFIED (gate, crumbs, 44px)
  erd/[module]/page.tsx     MODIFIED (gate, crumbs)
  schema.json/route.ts      MODIFIED (JSON statuses above)
  guard.ts              REWRITTEN
  gate-state.tsx        NEW   renders forbidden / unavailable
  provenance-label.tsx  NEW   text + icon label, one component
  table-filter.tsx      MODIFIED (empty state)
  developer.css         MODIFIED (shell fit, 44px, 12px floor, wrap)
  erd.tsx               unchanged
  shell-boundaries.test.ts  NEW
```

There is deliberately **no `loading.tsx`** at any depth (DECISION-251 applied to this tree): `tables/[table]` and `erd/[module]` call `notFound()`, and a `loading.tsx` would send their 404s out as HTTP 200.

### Layout (`layout.tsx`) — chrome only

- `metadata = { title: { template: "%s · Developer portal", default: "Developer portal" } }`. The home page sets `title: { absolute: "Developer portal" }`.
- Reads the session with `cachedAuth()`. **No session, or required-and-unverified: render `children` bare** (no header, no avatar). The proxy and the page gate redirect those viewers; chrome for them would only expose the avatar menu of a half-signed-in session. It never redirects (the gate is the page's job; Ruling 3).
- Otherwise reads `entitled = await readEntitled(session.user.id).catch(() => false)`. A throw yields no nav (error.tsx cannot catch its own layout, so the layout must not throw).
- Renders `<ConsoleHeader …/>` always; the `<ConsoleNav …/>` column and the `md:grid-cols-[220px_minmax(0,1fr)]` grid **only when `entitled`**; always `<main id="developer-main" tabIndex={-1} className="min-w-0 p-4 outline-none sm:p-8">{children}</main>`.
- `ConsoleHeader` props: `consoleLabel="Developer portal"`, `idPrefix="developer-nav"`, `mainId="developer-main"`, `groups={entitled ? DEVELOPER_NAV_GROUPS : []}`, `name`, `email`, `canAccessAdmin={sessionCanAccessAdmin(session.user)}`, `canAccessDeveloper={entitled}`.
- `canAccessAdmin` is the real claim, not the hard-coded `true` of padmin's header: a developer-only viewer must not see a "Platform admin" avatar item the Edge bounces to `/access-pending` (Ruling 4). The way back to `/admin` is the avatar menu only; no extra header link (architect's suggestion adopted).
- Reuses padmin's `<main>` reasoning: `min-w-0` (a grid item defaults to `min-width: auto`, so one wide table would push the page sideways at 360px), `p-4 sm:p-8`.

### Shell promotion (Ruling 4, DECISION-261)

`git mv` with history, then parameterise. The padmin tests move with the files and keep asserting `/admin` behavior by passing the old strings as props.

| From (`src/components/admin-portal/`) | To (`src/components/shared/`) | Props (all required unless marked) |
|---|---|---|
| `admin-nav-links.tsx` (`AdminNavLinks`, `activeNavHref`, `AdminNavLinkItem`, `AdminNavLinkGroup`) | `console-nav-links.tsx` (`ConsoleNavLinks`, `activeNavHref`, `ConsoleNavLinkItem`, `ConsoleNavLinkGroup`) | `groups`, `idPrefix` (was hard-coded `admin-nav`; heading ids stay `admin-nav-<key>` for `/admin` because it passes `idPrefix="admin-nav"`), `onNavigate?`. Item type gains optional `alsoActiveOn?: readonly string[]` (see "Active state" below) |
| `admin-nav.tsx` (`AdminNav`) | `console-nav.tsx` (`ConsoleNav`) | `groups`, `consoleLabel` (the `<nav aria-label>`), `idPrefix`. Returns `null` when `groups` is empty |
| `admin-mobile-menu.tsx` (`AdminMobileMenu`) | `console-mobile-menu.tsx` (`ConsoleMobileMenu`) | `groups`, `version`, `consoleLabel` (sheet title, `aria-label`, sr-only description "{label} pages"), `idPrefix`. **Renders nothing when `groups` is empty** (no Menu button in the forbidden state) |
| `admin-header.tsx` (`AdminHeader`) | `console-header.tsx` (`ConsoleHeader`) | `groups`, `consoleLabel` (the `sm:` label, replaces hard-coded "Platform admin"), `idPrefix`, `mainId` (skip link `href="#{mainId}"`), `name`, `email`, `canAccessAdmin` (replaces the hard-coded `canAccessAdmin`), `canAccessDeveloper` (passed to `AvatarMenu`'s `isPlatformAdmin` prop until Increment 2 renames that prop) |

- **Stays in `admin-portal/`:** `admin-forbidden.tsx`, reused by import for the developer portal (its sentence with area "the developer portal" is exactly the analyst's copy; one state, no hand-copied sentence). Its doc comment gains one line naming the second platform consumer. It must not move to `shared/` (DECISION-040: it could become the `(org)` miss response).
- **No defaults** on any new prop, so each caller states them. TypeScript structural typing lets padmin's `AdminNavGroup` (which has an extra `requiredFeature`) pass as a `ConsoleNavLinkGroup`; `shared/` imports nothing from `admin-portal/` or `lib/admin-portal/`.
- **padmin call sites updated in the same commit:** `(admin)/admin/layout.tsx` (`<ConsoleHeader consoleLabel="Platform admin" idPrefix="admin-nav" mainId="admin-main" canAccessAdmin canAccessDeveloper={isPlatformAdmin} …/>`, `<ConsoleNav consoleLabel="Platform admin" idPrefix="admin-nav" …/>`), `layout.test.tsx` imports, and `shell-boundaries.test.ts`, whose `PORTAL_DIR` scans (`BrandTokens`/`getPlatformDb` ban, no `"/o/` literal) are widened to also cover `src/components/shared/console-*.tsx` so no coverage is lost by the move.
- **Pre-approved fallback (Ruling 4):** if, when Batch A starts, a padmin Phase 4 holds these files, parameterise in place in `admin-portal/` with the same required props, do not move them, and record the promotion as a `docs/TODO.md` line (the implementer reports the text in Phase 4; the orchestrator lands it at integration, Rule 16). Everything downstream of Batch A then imports from `admin-portal/` instead of `shared/`; the prop contract is identical.
- **Active state.** `/developer/tables/…` and `/developer/erd/…` are not under `/developer/data-model`, so Data model would never light. An item matches when `pathname` equals `href` or starts with `href + "/"`, or starts with any `alsoActiveOn` entry plus `/` (an `exact` item matches only equality with `href`); the longest matching prefix wins and alone gets `aria-current="page"`, marked by weight and fill as well as the attribute. The developer registry sets `alsoActiveOn: ["/developer/tables", "/developer/erd"]` on Data model.

### Developer registries (`src/lib/developer-portal/`, pure data, no imports of db or session)

- `nav.ts`: `DEVELOPER_NAV_GROUPS` — `home` (no heading): Home `/developer` exact; `reference` ("Reference"): Data model `/developer/data-model` with `alsoActiveOn`; `guides` ("Guides"): Documentation `/developer/docs`. Unfiltered (every entitled viewer sees every item). Increment 3 adds API, Rules and Access under Reference.
- `provenance.ts`: `PROVENANCE = { generated, tested, hand, planned }`, each `{ label, meaning, icon }`; labels `Generated`, `Tested list`, `Written by hand`, `Planned`.
- `docs-registry.ts`: `DOC_ROWS`, `DOCS_REVIEWED = "2026-10-25"`, `livesTodayText(row)`. Row shape `{ key, title, kind: "tutorial" | "how-to" | "reference" | "explanation", willContain, livesToday: { files: string[] } | { text: string } }`.
- `access.ts`: the pure decision above.

### `shell-boundaries.test.ts` — the Increment 1 assertions

Source-scan pins, read off the tree (the padmin `shell-boundaries.test.ts` is the model; Increment 3 extends this file). All are allow-only or presence checks, never deny-lists of SQL shapes (DECISION-252's lesson).

1. No `loading.tsx` at any depth under `(admin)/developer`.
2. `error.tsx` and `not-found.tsx` exist; `error.tsx` never reads `.message`.
3. Every `page.tsx` calls `requireDeveloper(` with a first argument that is a string or template literal beginning `/developer`, and that call appears in the source **before** `notFound(`, `buildSchemaDocs(`, `buildErd(` and `loadDescriptions(`. (A page may `await params` first, only to build that argument; the gate then decides before the param is used for anything else.)
4. `schema.json/route.ts` calls `checkDeveloperApiRequest(` before `buildSchemaDocs(`.
5. No `getPlatformDb` anywhere under the tree or `src/lib/developer-portal/`.
6. A closed allow-list for `@/` imports in the tree's non-test source: `@/lib/dev-docs`, `@/lib/developer-portal/*`, `@/lib/platform-admin`, `@/lib/nav-data`, `@/lib/auth/cached-auth`, `@/auth`, `@/lib/version`, `@/lib/utils`, `@/components/ui/*`, `@/components/shared/console-*`, `@/components/shared/{load-error,destination-card,formatted-date}`, `@/components/admin-portal/admin-forbidden`. `@/lib/authz`, `@/lib/db` and `@/lib/db/domain/*` are therefore forbidden by omission.
7. No file under `src/app/(org)` or `src/app/(public)` imports `@/components/admin-portal/`.
8. `src/proxy.ts` names `developer` only in the 2FA condition: the `PROTECTION_RULES` array contains no `developer` (Ruling 1: there must never be a rule for `/developer`).

### `dev-docs.ts` repairs (F283, F285)

- Export `MODULES`, `PLATFORM_TABLES`, `PLATFORM_MODULE = "Platform shell"` (replaces the literal `"platform (from starter)"` in `dev-docs.ts` (`:226`, `:269`), `page.tsx` (`:46`, `:89`) and `scripts/generate-erd.ts` (`:17`)), `INVARIANTS`, `NOT_LISTED`.
- `buildSchemaDocs`: module is `MODULES[name] ?? (name in PLATFORM_TABLES ? PLATFORM_MODULE : "Unclassified")`. An unclassified table renders under "Unclassified" in production (honest, never a crash) and **fails the test in CI**.
- **Module map: the 58, classified.** Names and letters are Phase 3's; letters continue `docs/schema-design.md` (which skips I).

| Module | Tables added |
|---|---|
| A. Organizations (existing) | `organization_brands`, `organization_brand_history` |
| G. Authorization (existing) | `account_invitations` |
| M. Presbytery oversight (new) | `appointments`, `congregation_oversight`, `congregation_statistics`, `per_capita_rates`, `per_capita_records` |
| N. Staff and personnel (new) | `staff_positions` |
| O. Events (new) | `event_types`, `events` |
| P. Online giving (new) | the 15 `giving_*` tables |
| Q. Sites and domains (new) | `organization_sites`, `organization_profiles`, `organization_service_times`, `site_contact_messages`, `organization_domains`, `blob_assets` |
| R. Organization features (new) | `organization_feature_toggles`, `organization_feature_categories` |
| S. Support (new) | `tickets`, `ticket_messages`, `ticket_actions`, `congregation_feedback` |
| **Platform shell** (`PLATFORM_TABLES`, closed list with a reason per group, no diagram) | Sign-in and sessions: `users`, `accounts`, `sessions`, `verification_tokens`, `email_verification_tokens`, `password_reset_tokens`. Two-factor: `user_totp`, `user_totp_pending_enrollments`, `user_totp_recovery_codes`. Platform roles and flags: `roles`, `user_roles`, `features`, `role_features`, `feature_flags`. Operations: `audit_events`, `email_queue`, `migration_seeds`. Feedback and announcements: `feedback`, `feedback_prompt_state`, `whats_new_entries` |

  38 module additions + 20 platform shell = 58. If the implementer finds a different split in the live tree, the test's list is authoritative and the reason string is the contract.
- **Invariants.** `INVARIANTS` entries gain `source: string | null` (the exact CLAUDE.md `###` heading they elaborate, or `null` for a schema-level rule recorded in `docs/schema-design.md` and its migration), and `enforcement` becomes `"database" | "trigger" | "paper"` (CLAUDE.md's own vocabulary; `documented` is renamed). Existing 15 entries get a `source`; the wildcard entry's stale "must be removed before ship" is replaced; six new entries are added (wording in Copy C12). `NOT_LISTED: Record<string, string>` holds the two headings deliberately not listed with a reason each: `No Real Data`, `Verify in a Browser`. **A new entry's tag may rise above `paper` only if the implementer names the enforcing trigger/constraint/test at file:line in the Phase 4 notes**; every provisional `paper` below is a floor, not a claim.
- Header comment of `dev-docs.ts` (`:17-30` claims "Nothing is hand-maintained … cannot drift") is rewritten to say what is generated and what is a tested hand list.

### Documentation page rows (Ruling 9; Diátaxis `kind` adopted)

| key | title | kind | what it will contain | lives today |
|---|---|---|---|---|
| getting-started | Getting started | tutorial | Set up a local copy: clone the repository, create a database branch, seed it, run the app and the checks. | `README.md`, `docs/testing.md` |
| architecture | Architecture overview | explanation | How the platform is put together and why: tenants, the two database connections, the proxy and the portals. | `docs/architecture.md` |
| decisions | Decisions log | reference | Every numbered decision, searchable by number. | `docs/decisions.md` |
| runbooks | Runbooks and deployment | how-to | Deploying, applying migrations to production, and the pre-deploy checklists. | `docs/deployment.md` |
| security | Security and data handling | explanation | How organizations are kept apart, which data is private, and how sensitive data is handled. | the Key Invariants section of `CLAUDE.md`, and `docs/schema-design.md` |
| changelog | Changelog | reference | What changed in each release. | `docs/release-notes/` |
| status | Status | reference | Whether the scheduled jobs, the email queue and domain checks are healthy. | text: "parts of this appear on the platform administrators' dashboard (email queue and domains)." (rendered as `Planned. Not built yet. Today, {text}`) |

Excluded on purpose (Ruling 9): rate limits, SDKs, webhooks and events. A test fails if any row title or text matches `/sdk|rate limit|webhook/i` or the word `API` (the word appears only on the API page, Increment 3).

### CSS (`developer.css`), Q8 default: targets, states and shell now; the palette migration is a tracked follow-up

- `.reg`: drop `min-height: 100vh` (it now sits inside the shell's `<main>`); `.reg__inner` padding becomes `0 0 3rem` below `sm` and `1rem 0 4rem` from `sm` (the shell's `p-4 sm:p-8` supplies the gutter).
- Targets at 44px: `.reg__crumbs` becomes `display: flex; flex-wrap: wrap; align-items: center; gap: 0 .5rem`, `.reg__crumbs a` and `.reg__diagramLink` become `display: inline-flex; align-items: center; min-height: 44px`; `.reg__filter` and `.reg__filterInput` get `min-height: 44px`; below 52rem `.reg__filter` is `grid-template-columns: 1fr auto` with the label on its own row.
- Wrap: `.reg__moduleHead { flex-wrap: wrap; align-items: center }`; `.reg__rowSummary`, `.reg__rowName` and `.reg__note` get `overflow-wrap: anywhere`.
- Floor: every `font-size` below `0.75rem` in the file is raised to `0.75rem` (the `micro` role is 12px; the register had 9.6px tags). Pinned by `developer-css.test.ts`.
- Not touched (follow-up with Q8): the hex palette, `.dark .reg`, the oxblood/verdigris pair, and the mermaid theme in `erd.tsx`, which reads `prefers-color-scheme` rather than the app's `.dark` class (unverified, see Edge Cases).

### Files to create

`src/components/shared/console-{header,nav,nav-links,mobile-menu}.tsx` and their four tests (moved); `src/lib/developer-portal/{nav,provenance,docs-registry,access}.ts` and `{nav,docs-registry,access}.test.ts`; `src/lib/dev-docs.test.ts`; `src/app/(admin)/developer/{layout,error,not-found,gate-state,provenance-label}.tsx`, `data-model/page.tsx`, `docs/page.tsx`, `shell-boundaries.test.ts`, `developer-css.test.ts`, and a test next to each page, layout, `error.tsx`, `gate-state.tsx`, `guard.ts` and `schema.json/route.ts`; `e2e/developer-portal.spec.ts`; `e2e/support/developer-fixture.ts`.

### Files to modify

`src/proxy.ts`, `src/proxy.test.ts`; `src/lib/dev-docs.ts`; `scripts/generate-erd.ts`; `docs/schema-design.md` (regenerated by `npm run docs:erd`); `src/app/(admin)/developer/{page,guard,table-filter,developer.css}` and `tables/[table]/page.tsx`, `erd/[module]/page.tsx`, `schema.json/route.ts`; `src/app/(member)/home/page.tsx:178` (card description) and its test; `src/components/admin-portal/admin-forbidden.tsx` (one comment line); padmin call sites listed above; `src/lib/db/domain/events.schema.test.ts:175` (`"paper"`); `e2e/custom-domains/lockdown.spec.ts` (three paths added); `docs/testing.md:184-186`.

## Implementation Order

(No schema, no `FEATURE_CATALOG` entry, no seed binding, no audit event in this increment.)

**Step 0 — orchestrator, before Phase 4.** (1) padmin PR #55 merged to `main`; merge `main` into `pipeline/developer-portal`. (2) `npm ci` in the worktree. (3) Create the pipeline Neon branch and `.env.local` (Rule 16); dev port 3570. (4) Re-run the Feasibility check: the five padmin files exist on `main` and match what this design read; `grep -rn "admin-portal/admin-\(header\|nav\|nav-links\|mobile-menu\)" src` lists only the call sites above. (5) If a padmin Phase 4 is editing the shell files, use the Ruling 4 fallback and tell the implementer.

**Batch A — shell promotion (ux-developer).** Move and parameterise the four components, move their tests, update padmin's layout and `shell-boundaries.test.ts`, add the Menu-absent-when-empty and `alsoActiveOn` tests. **No behavior change for `/admin`.** Commit: `refactor(shell): promote the console nav and header to shared with required props`, trailer `Work-Log: 2026-10-25-developer-portal-inc1`. Gate: typecheck, lint, the moved tests, padmin's `layout.test.tsx` and `shell-boundaries.test.ts`; open `/admin` at 360px and desktop and confirm it is unchanged.

**Batch B — gate, proxy, `schema.json`, registries (api-developer).** `access.ts` + test; `guard.ts` + test; `schema.json/route.ts` + test; the `src/proxy.ts` line + rows; `dev-docs.ts` repairs, `dev-docs.test.ts`, the `events.schema.test.ts:175` edit, `scripts/generate-erd.ts` and `npm run docs:erd`. Commits (each `fix:` carries both trailers): `fix(developer): challenge a required second factor on /developer, in the proxy and in the page gate (F284, F288)` with `Caught-By: agent-review`, `Discovered-In: Phase-1`; `fix(developer): classify every table and every Key Invariant, with tests that fail on drift (F283, F285)` with the same trailers. Gate: unit suites, `npm run check` (all eight tripwires), typecheck, lint; then the **MFA e2e smoke** (list below) on port 3570.

**Batch C — portal pages, registries, e2e (ux-developer).** `nav.ts`, `provenance.ts`, `docs-registry.ts` and tests; layout, `error.tsx`, `not-found.tsx`, `gate-state.tsx`, `provenance-label.tsx`; home, `data-model/page.tsx`, `docs/page.tsx`; table and ERD page edits; `table-filter.tsx` empty state; `developer.css`; `developer-css.test.ts`; `shell-boundaries.test.ts`; the `/home` card text; `docs/testing.md`; `e2e/developer-portal.spec.ts` and `developer-fixture.ts`; the `lockdown.spec.ts` paths. Commit: `feat(developer): portal home, shell, data model section and documentation placeholder`. Gate: `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check`, the full unit suite, the new and the existing auth e2e specs on port 3570, and a walk of every new and changed page at 360px (Verify in a Browser) with the result in the Phase 4 notes.

**Step Z — release notes (tech-lead, after Phase 6 SHIP IT).** `/release-notes`: `docs/release-notes/v0.44.0.md` and the `package.json` bump, if 0.43.0 is the latest on `main` (the orchestrator numbers it at integration). Rule 14: update the `presby: developer reference` line in `docs/product/functionality-map.md:20`. Rule 10: reconcile `docs/TODO.md` (lines 72 and 216 C-3 are closed by F283/F285; add the follow-ups below).

**e2e commands.** Start your own server, never attach to :3000: `npx next dev -p 3570`; run `E2E_BASE_URL=http://localhost:3570 npx playwright test <specs>`; stop the server by PID. Specs to run: `developer-portal`, `totp-full-login`, `totp-callback-bypass`, `totp-code-entry`, `totp-recovery-code`, `session-claim-integrity`, `admin-login`, `post-login-routing`, `header-controls`, `member-home`, `role-boundaries`, `custom-domains/lockdown`.

## Edge Cases & Risks

Every claim cites the test that will pin it, or says **unverified**. "e2e" means `e2e/developer-portal.spec.ts` on port 3570.

| # | Case | Behavior | Pinned by |
|---|---|---|---|
| E1 | Signed-out deep link | `/signin?callbackUrl=<same path>`, back to the same page after sign-in | `guard.test.ts` ("signed out redirects to /signin with the literal path"); e2e "signed-out deep link" |
| E2 | Required and unverified second factor, any `/developer` path including `schema.json` | `/totp?callbackUrl=<path>`, then back to that path; the portal is never rendered in between | `proxy.test.ts` rows (below); `guard.test.ts`; e2e "required but unverified" (sign in with the callback, assert `/totp`, assert no portal heading, `goto` the path, enter a real code, land on `/developer/tables/roll_actions`) |
| E3 | Proxy boundary | `/developer`, `/developer/`, `/developer/tables/x`, `/developer/schema.json` gated; `/developerx` and `/developer-x` not; an `ADMIN_ROLE` holder who is required and unverified is still challenged; a verified user with no role passes through with no `/access-pending` | `proxy.test.ts` new `describe("proxy - /developer (F284)")`: 8 rows |
| E4 | Custom host | `/developer`, `/developer/tables/roll_actions`, `/developer/schema.json` are rewritten to `/site/<host>/…` (the neutral 404), never gated or served | `proxy.test.ts` (three paths added to the platform-paths list in "rewrites every platform route"); `lockdown.spec.ts` (paths added) |
| E5 | Signed in, not entitled | HTTP 200, the forbidden page, **no redirect to `/home`**, header with avatar menu and sign-out present, no section nav, no Menu button | `gate-state.test.tsx`; `layout.test.tsx`; e2e "non-entitled sees the forbidden page" (uses the `member` and the `admin` storage states: an `ADMIN_ROLE` holder without the column is also forbidden, preserving today's behavior) |
| E6 | Same answer for `/developer/tables/<anything>` and `/developer/tables/no_such_table` | The gate runs before `notFound()` and before any read, so a non-entitled viewer cannot tell a real table from a missing one | `tables/[table]/page.test.tsx` and `erd/[module]/page.test.tsx` ("forbidden: notFound and loadDescriptions never called"); `shell-boundaries.test.ts` (gate call precedes `notFound(` and every data call in each `page.tsx`); e2e |
| E7 | Predicate read throws | The `unavailable` state (calm, Try again to the same literal path, fails closed); never `forbidden`, never a redirect, never Next's default page; no data read | `access.test.ts` ("a throwing reader is unavailable, not forbidden"); `gate-state.test.tsx`; page tests ("unavailable: loadDescriptions not called") |
| E8 | Layout predicate read throws | Header renders, no nav, `children` still render | `layout.test.tsx` |
| E9 | Layout with no session or required-and-unverified | `children` only; no avatar menu | `layout.test.tsx` (two rows) |
| E10 | Hostile or odd `returnTo` (`../../admin`, `%2e%2e`, `//evil`, `\`, encoded slash, `/developerx`) | Falls back to `/developer`; a normal table name is preserved percent-encoded | `guard.test.ts` ("returnTo allow-list", table-driven) |
| E11 | `schema.json` statuses and headers | 401 / 403 `two_factor_required` / 503 (predicate) / 403 `forbidden` / 503 (schema read) / 200; all `no-store` | `schema.json/route.test.ts` (six rows plus a header assertion). The 401 and `two_factor_required` rows are unreachable through the Edge (see API Contract) and are unit-only |
| E12 | Unknown table or module for an entitled viewer | A real HTTP 404 (not 200), rendered inside the chrome by `not-found.tsx` | e2e ("unknown table is a 404"); `shell-boundaries.test.ts` (no `loading.tsx`) |
| E13 | No `loading.tsx` anywhere under the tree | Required for E12 | `shell-boundaries.test.ts` |
| E14 | A render error | `error.tsx`: calm copy, Try again calls `reset()`, a way back, never `error.message` | `error.test.tsx`; `shell-boundaries.test.ts` (no `.message`) |
| E15 | Module map drift | A new `pgTable` that is in neither `MODULES` nor `PLATFORM_TABLES` fails CI with a message naming the file to edit; a stale entry naming a table that no longer exists fails; a table in both fails | `dev-docs.test.ts` (three tests) |
| E16 | Invariants drift | A new `###` heading under CLAUDE.md `## Key Invariants` not in `INVARIANTS.source` or `NOT_LISTED` fails with a message telling the CLAUDE.md editor what to do; a `source` naming a heading that no longer exists fails (rename detection); `enforcement` outside `database`/`trigger`/`paper` fails; every `NOT_LISTED` has a non-empty reason | `dev-docs.test.ts` (four tests) |
| E17 | Nav cannot point at nothing | Every `DEVELOPER_NAV_GROUPS` href resolves to a `page.tsx` on disk; the admin nav contains no `/developer` link (DECISION-044) | `nav.test.ts` |
| E18 | Active state | `/developer/tables/roll_actions` and `/developer/erd/d-rolls` light Data model; `/developer` lights Home only; `/developer/docs` lights Documentation; `/developerx` lights nothing | `console-nav-links.test.tsx`; e2e (`aria-current` on the table page) |
| E19 | Docs registry cannot rot | Every `livesToday.files` path exists on disk; keys unique; no row mentions an API, SDK, rate limit or webhook; `DOCS_REVIEWED` is a valid calendar date | `docs-registry.test.ts` |
| E20 | Home needs no read | The home page makes no database call (counts are deferred to Increment 3), so it has no read-failure state beyond the gate | `page.test.tsx` (home): `loadDescriptions` and `buildSchemaDocs` are not called |
| E21 | Filter to nothing | The count reads `0 of N` and a plain "No table matches that" line appears; clearing restores everything | `table-filter.test.tsx` (jsdom) |
| E22 | 360px: no horizontal page overflow on home, data model, a wide table page (`roll_actions`), an ERD page, documentation, and the forbidden page | `document.documentElement.scrollWidth <= innerWidth`; the table of columns and the mermaid SVG scroll inside their own containers | e2e (six pages at 360px). That a long module heading wraps rather than clips is **unverified beyond the overflow assertion** until the Phase 5 walk |
| E23 | 44px targets | Crumb links, the "Diagram" link, the filter input, nav links and the Menu button are at least 44px tall | e2e (`boundingBox().height >= 44` on each; nav links measured inside the open Menu sheet); `console-mobile-menu.test.tsx` keeps the `min-h-11` class assertion |
| E24 | Phone menu | Opens a dialog titled "Developer portal" with the nav and the version; a click on the current page's link closes it; a route change closes it | `console-mobile-menu.test.tsx` (moved rows with the new label); e2e at 360px |
| E25 | Type floor | No `font-size` under 0.75rem remains in `developer.css` | `developer-css.test.ts` |
| E26 | `.reg` fits the shell | No double padding, no 100vh | **unverified by a test**; the Phase 4 360px walk and Phase 5 look |
| E27 | Dark mode on the data-model pages | `.dark .reg` values are unchanged; the mermaid theme still follows the OS `prefers-color-scheme`, not the `.dark` class | **unverified**; tracked with Q8 as a follow-up (a user who sets Dark in the app and has a light OS gets a light diagram) |
| E28 | `cache()` de-duplicates the predicate read between layout and page | One query per render | **unverified** (harmless either way; the read is one indexed select) |
| E29 | The forbidden and unavailable states render with HTTP 200 | Accepted by the architect: a platform page has no enumeration surface. QA should not file it | n/a (architect ruling, Phase 2 "Other things") |

`proxy.test.ts` rows for E3 (8): unauthenticated `/developer/tables/roll_actions` carries the deep link to `/signin`; required+unverified on `/developer` (and `/developer/`), on `/developer/tables/x` and on `/developer/schema.json` each redirect to `/totp` with the exact `callbackUrl`; an `ADMIN_ROLE` holder required+unverified on `/developer` is challenged; a verified user with no role or feature passes `/developer/tables/x` with status 200 and no `/access-pending`; a signed-in user with no 2FA requirement passes `/developer`; required+unverified on `/developerx` and `/developer-x` is **not** redirected.

### e2e blast radius

**Existing specs this change could alter:** none asserts the behavior being changed.
- `e2e/custom-domains/lockdown.spec.ts:107` (`/developer` on a custom host): still the neutral 404; three paths added.
- `e2e/header-controls.spec.ts:290-310`, `e2e/member-home.spec.ts:115`: assert the Developer avatar item by name for users without the entitlement; unchanged because the predicate is unchanged.
- `e2e/post-login-routing.spec.ts`, `e2e/totp-full-login.spec.ts`, `e2e/totp-callback-bypass.spec.ts`: the auth-touching smoke set; not altered, but they are the regression net for the `src/proxy.ts` edit and are run in full.
- Unit: `src/proxy.test.ts` (rows added), `src/lib/db/domain/events.schema.test.ts:175` (`documented` → `paper`), `src/app/(member)/home/page.test.tsx` (card description), padmin's moved shell tests and `layout.test.tsx` / `shell-boundaries.test.ts`.

**New spec:** `e2e/developer-portal.spec.ts` (about 12 tests, `test.describe.configure({ timeout: 120_000 })` because the dev server compiles each route on first touch).
- **Fixtures.** `e2e/support/developer-fixture.ts` creates **throwaway** users (`e2e-devportal-<stamp>-<tag>@example.invalid`, the invitation-fixture idiom) with `is_platform_admin` set and, for the MFA case, a real TOTP enrolment through the existing `seedTotpEnrollment` export. It deletes them in `afterAll` behind a guard (the address must start with the run's prefix and end `@example.invalid`; never a roster user) and sweeps stale ones in `beforeAll`. **Why not extend `users.ts` / `seed-users.ts`:** they are Rule 16 shared files (`e2e/support/*`), and the existing roster has no `is_platform_admin` fixture; a self-contained helper avoids editing a shared file mid-pipeline. No person rows are created, so no id from `00000000-0000-4258-` is consumed.
- **Flags.** None. No new or changed spec depends on a feature flag (no `/home` assertion in e2e, because `/home` is flag-gated by `platform.merged_home`; the card text is a unit assertion). Nothing is added to `scripts/ci/e2e-baseline-flags.sql`, and no spec calls `captureFlags`.
- **Cases.** (1) required-but-unverified user to `/totp` and back (E2); (2) `schema.json` from that user lands on `/totp`, not JSON (E2); (3) signed-out deep link to `/signin` with the callback (E1); (4) `member` and `admin` storage states see the forbidden page, 200, on `/developer` and on a missing table, header present, no nav (E5, E6), and `schema.json` answers 403 `forbidden` with `no-store` (E11); (5) an entitled non-MFA user sees home with both cards and their labels, the nav landmark, and a working skip link; (6) Data model: filter narrows to `n of N`, a row opens its table page, `aria-current` is on Data model, crumbs go back, the diagram link renders an SVG (E18); (7) unknown table is a 404 inside the chrome (E12); (8) Documentation lists seven rows each marked Planned; (9) `schema.json` returns the payload with the new vocabulary; (10) 360px: six pages without horizontal overflow, Menu button at least 44px, the open sheet's links at least 44px, and a click on Documentation navigates and closes it (E22–E24); (11) 44px targets at desktop width for crumbs and the diagram link (E23).

## Copy

Every user-facing string this increment adds or changes. **An implementer who needs a string not listed here stops for a ruling.** Each group ends with the four checks (Residuals, Source of truth, Audience, Neighbours). "Entitled" means a holder of `users.is_platform_admin` today.

### C1 — Shell chrome

Strings: header label `Developer portal` (hidden below `sm`), sheet title and both nav `aria-label`s `Developer portal`, sr-only sheet description `Developer portal pages`, `← PresbyPortal` (link to `/home`), `Menu`, skip link `Skip to main content`, nav foot `Version {APP_VERSION}`, nav items `Home`, `Data model`, `Documentation`, group headings `Reference` and `Guides`, tab titles `Developer portal` (home), `Data model · Developer portal`, `Documentation · Developer portal`, `{table} · Developer portal`, `{module} diagram · Developer portal`.

1. *Residuals.* Denies none: the chrome makes no claim about access, audit or revocation.
2. *Source of truth.* The version is the build constant `APP_VERSION` (`src/lib/version`). Every other string is static. The nav is shown only when the live read returned true; its presence claims nothing about the person beyond "entitled".
3. *Audience.* The header is seen by every signed-in viewer who opens a `/developer` URL, entitled or not; the nav and Menu only by the entitled. `← PresbyPortal` goes to `/home`, which any signed-in user may open (auth-only).
4. *Neighbours.* `grep` for `Developer portal`: no existing user-facing string. The avatar-menu item `Developer` (`src/components/shared/avatar-menu.tsx:140-141`) and the `/home` card title `Developer` (`home/page.tsx:176`) stay as they are: they name the destination, the portal names itself. `← PresbyPortal` and `Skip to main content` move with the header unchanged.

### C2 — Home

Strings: `h1` `Developer portal`; standfirst `Engineering reference for PresbyPortal. It describes how the platform is built and does not read congregation records.`; `h2` `Sections`; card **Data model** (badge `Generated`): `Every table, its columns and its links, with a diagram for each module. Built from the schema in the code and the database's own comments.`; card **Documentation** (badge `Planned`): `What documentation exists, where it lives today, and what is planned.`; legend heading `What the labels mean` with the meaning of each label in use (C10).

1. *Residuals.* Denies none. In particular it does not say "never shows data" (the Q9 residual that reads are unaudited is not contradicted) and does not claim the lists cannot drift: it says what is built from where.
2. *Source of truth.* "does not read congregation records": the portal's only database read is `dev-docs.loadDescriptions`, a `pg_catalog` query over `pg_description`/`pg_class`/`pg_attribute`/`pg_namespace` (opened and read; no tenant table is selected anywhere in the developer tree, pinned by `shell-boundaries.test.ts`'s import allow-list). "Built from the schema in the code and the database's own comments": `buildSchemaDocs` reads Drizzle table definitions and `loadDescriptions` reads `pg_description`. What these do **not** read: RLS policies, triggers, functions (stated on the Data model page, C4). The word "Generated" is true of the tables, columns, links and descriptions and not of the module grouping, which is a hand list; the Data model page says so, so the card does not claim more than it covers.
3. *Audience.* The entitled viewer. The strings contain no instruction.
4. *Neighbours.* Replaces the old page's masthead "The data model / Generated on each request … so it cannot drift from what is deployed" (`page.tsx:56-61`), made false by G3, and the `/home` card text (C3). No other string says "technical reference" except the eyebrow rewritten in C4.

### C3 — `/home` Developer card (interim)

String (replaces `Schema reference, tables, and entity diagrams.` at `src/app/(member)/home/page.tsx:178`): `Data model, diagrams and where the engineering docs live.`

1. *Residuals.* Denies none.
2. *Source of truth.* The card renders when `isPlatformAdmin` (live column) is true; the sections it names (Data model with diagrams, Documentation) exist in this increment. It deliberately does **not** say "API endpoints": that section does not exist until Increment 3, which sets the analyst's final line (`Data model, API endpoints and engineering references.`).
3. *Audience.* Entitled viewers only (the card is gated on the same live read). No instruction.
4. *Neighbours.* The old text at `home/page.tsx:178` (modified). `docs/testing.md:184-186` ("generated schema reference") and `docs/product/functionality-map.md:20,30,62` describe the portal as a schema reference: `testing.md` is modified here; the functionality map is Rule 14 at ship. `CLAUDE.md:143` ("generated schema reference") is a Phase 6 orchestrator edit (listed in the architect's doc edits).

### C4 — Data model page (the moved index)

Strings: eyebrow `Developer portal · reference`; `h1` `Data model`; standfirst `Tables, columns, keys and indexes are read from the schema in the code. Descriptions come from the database's own comments. The grouping into modules is a hand-kept list, and a test fails if a table is missing from it. Notes on tables with special isolation are written by hand. Not shown here: row-level security policies, triggers and functions; those are in the drizzle/ migrations. The reasoning and the findings log are in docs/schema-design.md.` (file names in `<code>`); counts `{n} tables`, `{n} with organization_id`, `{n} rules rely on review`, `{n} undescribed`, link `schema.json`; legend line `A filled dot marks a table with an organization_id column; a hollow dot marks one without.`; sr-only per-row text `has organization_id` / `no organization_id` (replaces the tooltip `Tenant-scoped: row-level security applies` / `Global: not tenant-isolated`); filter label `Find`, placeholder `table, column, or anything in a description` (unchanged), count `{n} tables` / `{v} of {N}`, empty line `No table matches that. Clear the search to see all {N}.`; row summary fallback `No description yet`; module headings (hand-kept names in the table above, plus `Platform shell` and `Unclassified`), `{n} tables`, `Diagram →`; section heading `The rules the system relies on` with `{n} rules` and the note `Rules marked paper are the ones to watch: nothing in the database stops a violation, so review catches it. Some also have a source-scan check, which the rule's text names. A test checks that every rule heading in CLAUDE.md has an entry here; the wording of each entry is written by hand.`; section heading `Platform permissions` with `{n} keys` and the existing note `Governs the /admin shell only, and is frozen. …` (unchanged); provenance labels on the three section heads: tables `Generated`, rules `Written by hand`, permissions `Generated`.

1. *Residuals.* This group is where residuals live, so each is stated rather than denied: `paper` rules are called out as review-only; the isolation notes are called hand-written; the module map is called hand-kept. It no longer says "so it cannot drift from what is deployed", which F283 proved false.
2. *Source of truth.* "Read from the schema in the code": `buildSchemaDocs` over the Drizzle exports. "A test fails if a table is missing": `dev-docs.test.ts` (E15), true once Batch B lands. "`{n} with organization_id`": `columns.some(c => c.name === "organization_id")` (`tenantScoped`) — the old strings said "tenant-scoped · row-level security applies"/"not tenant-isolated", which the query does not establish (it reads a column name, not a policy), so the claim is reworded to what is known. "`{n} rules rely on review`": `INVARIANTS` entries with `enforcement === "paper"`; the old label `rules unenforced` overstated, because some `paper` rules have a repo tripwire for the shapes it can see. "Not shown here: policies, triggers and functions": `dev-docs.ts` reads none (TODO.md:277). "Generated" on the tables and permissions heads: Drizzle exports and `FEATURE_CATALOG`; "Written by hand" on the rules head: `INVARIANTS` is a constant whose wording nothing checks (only the headings are checked). `{n} undescribed` counts non-platform tables with no `pg_description` row.
3. *Audience.* The entitled viewer. The one instruction ("Clear the search") is something any reader can do. The filter's `No description yet` is not an instruction.
4. *Neighbours.* Replaces `presby · technical reference`, `The data model` and the "cannot drift" standfirst (`page.tsx:56-61`), `rules unenforced` (`:72`), `Tenant-scoped: row-level security applies` / `Global: not tenant-isolated` (`:133-134`), `What the schema guarantees` and its note (`:148` and the paragraph below it), `<em>No description</em>` (`:121`; also `erd/[module]/page.tsx:78`, same change), and the tables page eyebrow (C5). The module heading `platform (from starter)` (`dev-docs.ts:226`, `page.tsx:46` and `:89`, `generate-erd.ts:17`) is renamed `Platform shell`. `docs/schema-design.md` generated headings change when `npm run docs:erd` runs (regenerated, not hand-edited). `src/app/(admin)/admin/design-system/page.tsx:84,161` and `docs/ui-standards.md:135` (the `micro` role is allowed on `/developer`) stay true.

### C5 — Table and diagram pages

Strings: table eyebrow `has organization_id` / `no organization_id` (replaces `tenant-scoped · rls enforced` / `global · not tenant-isolated`, `tables/[table]/page.tsx:55`); crumbs `Data model` and `{module}`; no-description line `No description yet. Add one with COMMENT ON TABLE {name} IS '…' in the migration.` (the existing line with `in the migration` added); counts `{n} columns`, `{n} references out`, `{n} in` (unchanged); `Isolation exception` callout label (unchanged; the text under it is the hand-written `BESPOKE_POLICIES` note). Diagram page: eyebrow `entity diagram`, standfirst unchanged (`Generated from the foreign keys actually declared in the schema. …`).

1. *Residuals.* The tenant wording no longer asserts a policy; `BESPOKE_POLICIES` text is hand-written and the Data model page says so (C4).
2. *Source of truth.* As C4 for `organization_id`. "Foreign keys actually declared in the schema" is `buildErd` over Drizzle foreign keys: true, and it does not claim to show database-only constraints.
3. *Audience.* The entitled viewer, who is a developer: `COMMENT ON TABLE … in the migration` is something the reader can do.
4. *Neighbours.* The same eyebrow/dot strings in C4; `erd/[module]/page.tsx:58-62` standfirst reviewed and left unchanged.

### C6 — Documentation page

Strings: tab title `Documentation · Developer portal`; `h1` `Documentation`; standfirst `What documentation exists, where it lives today, and what is planned for this portal. Nothing here is rendered yet; each document is a file in the repository.`; per row: title, a kind tag (`Tutorial`, `How-to`, `Reference`, `Explanation`), the `Planned` label, the row's "what it will contain" text, and `Planned. Not built yet. Today this material lives in {files}.` (files in `<code>`, joined with ` and `) or, for the Status row, `Planned. Not built yet. Today, parts of this appear on the platform administrators' dashboard (email queue and domains).`; footer `Reviewed {date}` rendered with `<FormattedDate value="2026-10-25" mode="date" />`. The seven rows' titles and "what it will contain" text are in the Documentation rows table above and are the approved strings.

1. *Residuals.* Denies none. It does not say the documents are complete or current: it says they are files and unrendered.
2. *Source of truth.* "Lives today" paths are checked to exist by `docs-registry.test.ts` (E19). The Status row's claim is a statement about the platform administrators' dashboard (padmin 0.43.0 shows an email card and a domains card, `src/lib/admin-portal/dashboard/{email,domains}.ts`); Phase 5 opens `/admin` to confirm both cards exist, because that is a claim about a page this registry does not read. `Reviewed 2026-10-25` is `DOCS_REVIEWED`, a hand-set date the monthly documentation review keeps current; the page does not claim anything is up to date, only that a person last looked then.
3. *Audience.* The entitled viewer. No instruction. The Status row does not tell the reader to open `/admin`, because a developer-only viewer (Increment 2) cannot.
4. *Neighbours.* None says "documentation" to a user today except `/admin/docs` (release notes, behind `ADMIN_RELEASE_NOTES`), which this page does not contradict or link. The changelog row's "lives today" is the repo folder, not `/admin/docs`, for the same audience reason.

### C7 — Gate states

Strings: forbidden — `h1` `Developer portal`, body `Your account doesn't include the developer portal. Ask a platform administrator if you need it.` (padmin's `AdminForbidden` with `title="Developer portal"`, `area="the developer portal"`; not edited); unavailable — title `We can't check your access right now`, body `This is on our end, not yours. Try again in a moment.`, button `Try again` (a link to the page's own literal path).

1. *Residuals.* Denies none. Forbidden does not say why or name the role (Phase 1 copy rule); unavailable does not say access was removed.
2. *Source of truth.* Forbidden renders when `readEntitled` returned `false`; unavailable renders only when that read **threw**, so "on our end, not yours" is true by construction (`access.test.ts`). A viewer's role is not read to word the page.
3. *Audience.* Forbidden is seen by any signed-in non-entitled user (a congregation member, a clerk), whose default role is not a platform administrator. The instruction "Ask a platform administrator" is something that role can do (ask). **Partial gap, ruled acceptable for this increment:** until Increment 2 there is no `/admin/users` path that grants the portal (the column is set in SQL by the operator, who is a platform administrator), so the instruction is truthful but not executable by an administrator in the UI. Increment 2 makes it executable. If the operator prefers, the string can be reworded for this increment only; that would break the "one state" rule (U3), so the design keeps it. Unavailable is seen by an entitled viewer during a database failure and contains no instruction beyond "try again", which the link does.
4. *Neighbours.* `AdminForbidden` is the single source; `grep "Your account doesn't include"` finds it and the padmin pages that use it, all unchanged. The old silent redirect to `/home` (`guard.ts:20`) is removed, so no string needed it.

### C8 — Error and not-found

Strings: `error.tsx` — title `We couldn't load this right now`, body `Something went wrong on our end. Try again in a moment.`, button `Try again` (calls `reset()`), link `Back to the developer portal` (to `/developer`); `not-found.tsx` — `h1` `We couldn't find that table or diagram`, body `It may have been renamed or removed. Go back to the data model to find it.`, link `Back to the data model` (to `/developer/data-model`).

1. *Residuals.* Denies none. As padmin's boundary: it claims only that a render failed and does not say "nothing has changed".
2. *Source of truth.* `error.tsx` renders on any thrown render error and states nothing about the person or the data. `not-found.tsx` renders when `notFound()` ran for a missing table or module; it claims only that it was not found and suggests a cause ("may").
3. *Audience.* The entitled viewer (the gate runs before any `notFound()`). The links go to pages they can open.
4. *Neighbours.* Padmin's `(admin)/admin/error.tsx` copy is the model; the body is identical so there is one phrase for "render failed" across both consoles. `grep "couldn't find"` finds the `(org)` miss page's own heading; this string is not shown to non-entitled viewers, so DECISION-040's byte-identical rule is not engaged.

### C9 — `schema.json` machine codes

Strings: `unauthorized`, `two_factor_required`, `forbidden`, `unavailable` (values of `error`).

1. *Residuals.* n/a (not prose).
2. *Source of truth.* Each code is returned by exactly one branch of `decideDeveloperAccess` / the schema-read catch (E11).
3. *Audience.* A program or a developer reading a response body; no instruction.
4. *Neighbours.* The old codes `unauthorized` and `forbidden` are kept; two are added. The comment at `schema.json/route.ts:10-17` claiming the file is "the AI support worker's map" is deleted (no consumer exists, G14/Q10); the `dev-docs.ts` header's matching "for the AI support worker" line is reworded.

### C10 — Provenance labels and their meanings

`Generated` — `Computed from the code and the database when you open the page.`; `Tested list` — `Written by hand, and a test fails when it falls out of step with the code.` (first used in Increment 3); `Written by hand` — `Written by a person; nothing checks the wording automatically.`; `Planned` — `Not built yet.` Shown as text with an icon (`Cog`, `ListChecks`, `PenLine`, `Hourglass`), never colour alone. The home legend shows only the labels present on the page.

1. *Residuals.* Consistent with them: `Written by hand` is the honest label for `INVARIANTS` and is used for it.
2. *Source of truth.* `Generated` is used only for content built by `buildSchemaDocs` or `FEATURE_CATALOG` at request time. `Tested list` is not used in Increment 1, so its claim ("a test fails …") need not yet be true of anything; Increment 3 must make it true of the API registry.
3. *Audience.* The entitled viewer; no instruction.
4. *Neighbours.* None existing.

### C11 — Release-note lines (`docs/release-notes/v0.44.0.md`, written after Phase 6)

> **Developer portal, first step.** The Developer page now has a proper home: a header with your account menu and a way back to PresbyPortal, a menu that works on a phone, and a start page with two sections. The old list of tables is now called Data model, and every existing link to a table or a diagram still works. A new Documentation page lists the guides we plan to bring into the portal and says where each one lives today; nothing there is built yet.
>
> **Fixes.** The Developer pages did not ask for your two-step sign-in code when your account requires one. They do now. 58 of the 105 tables were filed under "platform" with no diagram; every table is now filed under its real heading, and a test keeps it that way. The list of rules the system relies on was missing six of the project's principles and still carried a note that is no longer true; it now matches the project's own list, and a test keeps it matching. If the Developer page cannot check your access, for example while the database is unreachable, it now says so and offers Try again, instead of showing a technical error page or sending you somewhere else.

1. *Residuals.* Does not claim reads are recorded or that access is limited to a role; says the page "asks for your code when your account requires one", not that it is the only gate. The 58 and 105 are the F283 counts; the implementer confirms them from `dev-docs.test.ts` before the note is written.
2. *Source of truth.* Each sentence maps to a pinned test: the 2FA sentence to the proxy rows and the e2e (E2, E3); the filing sentence to E15; the rules sentence to E16 (six new entries); the unavailable sentence to E7.
3. *Audience.* The operator and any entitled developer; "your account" is correct for both. No instruction.
4. *Neighbours.* None.

### C12 — New and changed `INVARIANTS` wording

Six new entries (title / detail / provisional enforcement / `source`) and one changed. Provisional tags are floors (see Component / Page Plan).

- *Tenant tables point at each other by a composite key* — `Every tenant table declares a unique key on (id, organization_id), and foreign keys between tenant tables include organization_id. A plain reference to another tenant table would let a row in one organization point at a person in another. Row-level security filters reads; this is a write problem (F2).` — `paper` — Composite Tenant Keys.
- *There are no custom fields* — `Tags are the only attribute an organization can extend (D8). A new need is a support ticket and, if real, becomes a feature for every church.` — `paper` — Extensibility Goes Through Support.
- *Branding overrides existing tokens and adds no second styling system* — `A congregation's colours re-declare custom properties the platform already declares. Every token is classified brandable, bounded or platform in src/lib/brand/contract.ts, and a test fails on an unclassified one. npm run check:brand-scope keeps the emitter in the two brandable layouts; what that search cannot see is left to review.` — `paper` — The Brand Is a Cascade Override.
- *A custom domain is a lookup key, not an identity* — `A church's own domain is rewritten to the public site tree and never reaches sign-in, platform routes or cookies. Only a live, proven domain serves; every other state answers the same neutral 404. Absolute URLs come from the database row or the validated platform origin, never from the request. The platform-host set is asserted at build time.` — `paper` — A Custom Host Is a Key, Not an Identity.
- *The proxy never reaches the database* — `src/proxy.ts decides on host, path and session claims only. It imports a short list of pure modules, and npm run check:proxy-imports fails the check if its imports reach the database, a server-only module or another domains file.` — `paper` — The Proxy Does Not Reach the Database.
- *A permission and a flag answer different questions* — `A permission says whether this user may do this; a flag says whether the behavior is on at all. A flag never grants access and a permission never stages a rollout. A credential (hashed, single-use, expiring) is a third mechanism that authorizes only the act its own row names.` — `paper` — Permissions vs Flags.
- *Changed:* *No role carries a wildcard* — `Not even administrator roles. A Church Administrator does not read tier 2 or tier 3 by default. Known violation, bounded: the inherited ADMIN_ROLE is still a wildcard, but only for the platform admin shell, and the tenant connection cannot bypass row-level security.` — `paper` — No Role Carries a Wildcard. Replaces `NOTE: the starter's ADMIN_ROLE is still a wildcard and must be removed before ship.`
- `NOT_LISTED` reasons: `No Real Data` — `A rule about what may be committed to the repository, not a property of the running system; the portal obeys it and npm run check:secrets enforces the shapes it can.`; `Verify in a Browser` — `A working practice for people changing the code, not a property of the system.`

1. *Residuals.* The wildcard entry now states the accepted, bounded residual that CLAUDE.md records, instead of the stale "must be removed before ship". The six new entries describe `paper` honestly and name the partial tripwires; none claims a stronger guarantee than CLAUDE.md does.
2. *Source of truth.* Each entry restates the CLAUDE.md paragraph named in `source`, read at lines 459–677 on 2026-10-25; `dev-docs.test.ts` pins the heading, not the wording (which is why the section is labelled `Written by hand`). "A test fails on an unclassified [token]" is `src/lib/brand/contract.ts`'s own claim, which the implementer confirms by opening the contract test before keeping the sentence.
3. *Audience.* The entitled viewer. No instruction.
4. *Neighbours.* The 15 existing entries are unchanged in wording except the `source` field; the page note in C4 replaces `Rules marked paper are the ones to watch: the schema permits a violation …`. `docs/schema-design.md` §1 is not edited.

## Carry-forward

Every Phase 1 gap (G1–G14), every open question (Q1–Q14), every Phase 2 ruling (1–9), A1, the "Other things" list, the orchestrator rulings and the draft decisions. "Deferred" names who accepted it.

| Source | Addressed here (where), or *deferred* (who accepted) |
|---|---|
| **G1** no 2FA gate | **Here.** Proxy line + page gate + `schema.json` JSON (Permissions, API Contract; E2, E3, E11) |
| **G2** no shell | **Here.** Layout, shell promotion (Component / Page Plan; E5, E8, E9, E24) |
| **G3** module map drift (F283) | **Here.** `MODULES` additions, `PLATFORM_TABLES`, completeness test (E15); header copy corrected (C4) |
| **G4** invariants drift (F285) | **Here.** `source`, `NOT_LISTED`, vocabulary, repairs, coverage test (E16; C12) |
| **G5** role and key not in production | *Deferred* to Increment 2 (analyst increments table; Ruling 6; orchestrator accepted the split) |
| **G6** `/launch` and `/home` route a developer-only user wrongly | *Deferred* to Increment 2 (Ruling 5). Increment 1 only edits the interim `/home` card text (C3) |
| **G7** JWT staleness on revoke | *Deferred* to Increment 2 (F287, A1). Increment 1's predicate is already a live read |
| **G8** `is_platform_admin` has no grant path or audit | *Deferred*: Q3 default accepted (keep the column, no UI in this pipeline) — orchestrator ruling "Q2–Q14 proceed on the analyst defaults" |
| **G9** guard failure modes | **Here.** `forbidden` and `unavailable` states, fail closed (E5–E8). Recorded as F288, moved here from Increment 3 |
| **G10** `/admin/users` copy | *Deferred* to Increment 2 (it only makes sense once the role exists) |
| **G11** self-grant marking | *Deferred* to Increment 2 (Phase 2 "Other things": `selfTargeted`) |
| **G12** one shared forbidden state | **Here.** `AdminForbidden` reused (C7) |
| **G13** touch targets, 360px | **Here.** CSS, e2e at 360px (E22–E25); the long-heading wrap and the `.reg` fit are the two items left to the Phase 5 walk (E22, E26) |
| **G14** `schema.json` unconsumed claim | **Here.** Comment deleted (C9); Q10 default applied |
| **Q1** platform-axis role | Confirmed by the operator (orchestrator ruling). Built in Increment 2 |
| **Q2** `ADMIN_ROLE` does not auto-gain the portal | Preserved here (the predicate is unchanged; e2e E5 pins an admin-role user without the column as forbidden); implemented in Increment 2 |
| **Q3** keep `is_platform_admin` | Default accepted (orchestrator); no column change |
| **Q4** role and key names | Increment 2 (`developer`, `developer.portal`) |
| **Q5** 2FA parity with `/admin` | **Here** (proxy segment-boundary line, same challenge rule as `/admin`) |
| **Q6** member-developer lands on the chooser | Increment 2 |
| **Q7** a "doesn't include" page, not a silent redirect | **Here** (C7) |
| **Q8** targets, states, shell now; palette later | **Here** for targets/states/shell. *Deferred* with a `docs/TODO.md` follow-up (orchestrator accepted the default): the hex `.reg` palette, `.dark .reg`, the oxblood/verdigris pair and its icon, the mermaid theme following the OS instead of `.dark` |
| **Q9** reads are not audited | Accepted residual; recorded in DECISION-259 (Increment 2) |
| **Q10** drop the "AI support worker" claim | **Here** (C9) |
| **Q11** no live flag state without `ADMIN_FLAGS` | Increment 3 |
| **Q12** render docs later or link | Increment 4. Today: "where it lives" text only (C6) |
| **Q13** no Server Actions inventory | Increment 3 (one sentence on the API page) |
| **Q14** no new sections for the survey | **Here** (Ruling 9): Increment 1 adds only Documentation placeholder rows |
| **Ruling 1** key outside `FEATURES` | Increment 2 |
| **Ruling 2** live predicate `readCanAccessDeveloper` | Increment 2. The two seams it swaps are named in Permissions & Flags |
| **Ruling 3a** proxy segment-boundary line and `proxy.test.ts` rows | **Here** (API Contract; E3; the eight rows listed) |
| **Ruling 3b** page gate order and result | **Here** (`access.ts`, `guard.ts`, `GateState`) |
| **Ruling 3c** `schema.json` JSON statuses, no-store, drop the claim | **Here** (API Contract table; C9) |
| **Ruling 3d** MFA e2e gate on port 3570 incl. the unverified-to-`/totp` spec | **Here** (e2e cases 1 and 2; the existing smoke set). By ruling it also binds Increment 2 |
| **Ruling 4** promote nav and header to `shared/` with required props; Menu absent when empty; `AdminForbidden` reused; `(org)`/`(public)` never import `admin-portal/`; nav registry unfiltered; never in the admin nav; in-place fallback | **Here** (shell promotion table; the `(org)`/`(public)` scan and the nav test in `shell-boundaries.test.ts`/`nav.test.ts`; fallback written out). padmin Inc 2–4 Phase 3 must be given the promoted paths — an orchestrator action |
| **Ruling 5** `/launch` matrix | Increment 2 |
| **Ruling 6** seeding, no migration, runbook | Increment 2 (0071 released) |
| **Ruling 7** tripwires — `dev-docs.test.ts` module map and invariants; `shell-boundaries.test.ts`; none joins `npm run check` | **Here** (E13, E15–E17; vitest only). The API-inventory set-equality test, the readers scan and padmin's helper extraction are Increment 3; the "`authz.ts`/`domain/**` never name the developer constants" scan is Increment 2 (the constants do not exist yet) |
| **Ruling 8** runtime `docs/*.md` | Increment 4 |
| **Ruling 9** research fold-in: Documentation rows adopted (getting started, runbooks, changelog, security, architecture, decisions, status); rate limits/SDKs/webhooks excluded; Diátaxis tags; no "future public API" in the UI | **Here** (Documentation rows; E19). The home does not name an API anywhere. Counts, the "what changed" strip and the subsystem catalog are deferred to Increments 3 and 4 (Ruling 9) |
| **A1 / F287** admin role would be admitted by a `FEATURES` key | Increment 2 |
| Other: guard states render with HTTP 200 | **Here**, noted for QA (E29) |
| Other: audit `roleName` and `selfTargeted` | Increment 2 |
| Other: `/admin/users` copy line | Increment 2 |
| Other: Phase 6 doc edits (CLAUDE.md Project Layout line for `src/app/(admin)/developer/` to "the developer portal"; Post-Login Landing table and predicate paragraph; Permissions vs Flags paragraph; architect.md route-group line; `docs/architecture.md` sentence) | The Project Layout line and the new `src/lib/developer-portal/` and console-shell lines are Increment 1 Phase 6 edits (orchestrator). The others are Increment 2's, when the predicate changes |
| Other: worktree has no `.env.local` | Implementation Order step 0 (orchestrator) |
| Other: live-catalog read scope (development only) | Increment 2 (the runbook's verification query is the production check) |
| **Orchestrator:** person-id range `00000000-0000-4258-` | Confirmed; **not consumed** in Increment 1 (no person rows; throwaway users only) |
| **Orchestrator:** migration 0071 released | Confirmed; no migration here |
| **DECISION-258**, **DECISION-261** | Text below |
| **DECISION-259**, **DECISION-260** | Increments 2 and 3 |
| **F283, F284, F285, F288** | Text below |

## Draft text for the orchestrator (written into `docs/decisions.md` and `docs/schema-design-2.md` at integration, Rule 16)

**DECISION-258 — The developer portal is an internal engineering portal in the existing `(admin)/developer` tree, with stable URLs, provenance labels, one gate, two-layer 2FA and no `loading.tsx`.**

**Status:** Resolved (architect, Phase 2; tech-lead, Phase 3) · **Date:** 2026-10-25 · **Feature:** `2026-10-25-developer-portal-inc1` (no migration)

- **Information architecture.** Home, Data model, API, Rules, Access and Documentation, each carrying a provenance label in text and icon: `Generated`, `Tested list`, `Written by hand`, `Planned`. Increment 1 ships Home, Data model and Documentation; the rest arrive with their pages. The nav registry is pure data in `src/lib/developer-portal/nav.ts`.
- **Stable URLs.** `/developer/tables/[table]`, `/developer/erd/[module]` and `/developer/schema.json` keep their URLs; the former index moves to `/developer/data-model`, and `/developer` is the home.
- **Placeholders.** One Documentation placeholder page of labelled rows, each naming where the material lives today. No empty routes and no status route.
- **One gate, three outcomes.** `requireDeveloper` (pages) and `checkDeveloperApiRequest` (the route handler) both call the pure `decideDeveloperAccess`, which yields `ok`, `forbidden` or `unavailable` (plus signed-out and two-factor redirects). Every page and handler gates before it parses params or calls `notFound()`, so a non-entitled viewer gets one answer for every URL. A read failure is `unavailable` and fails closed; there is no silent redirect to `/home`. `forbidden` and `unavailable` render with HTTP 200 (a platform page has no enumeration surface).
- **Layout is chrome only.** It never gates; it renders the nav only when its own live read is true and always renders `children`. It renders bare children for a viewer with no session or an unverified required second factor.
- **2FA in two layers.** The proxy gates `/developer` by segment-boundary prefix (`/developer` and `/developer/…`, not `/developerx`), before the `ADMIN_ROLE` shortcut; the page gate repeats the check; `schema.json` answers JSON `401`, `403 two_factor_required`, `403 forbidden` and `503 unavailable` itself, all `no-store`.
- **No `loading.tsx` anywhere under `(admin)/developer`**, which applies DECISION-251: `tables/[table]` and `erd/[module]` call `notFound()`. `error.tsx` and `not-found.tsx` render calm copy and never `error.message`. Pinned by `shell-boundaries.test.ts`.
- **Internal for good.** `/developer` is never made public. A future public developer surface is a separate public route on a platform host, never this tree made public.
- **Revisit if** a section needs streaming badly enough to justify a route group whose descendants never call `notFound()`.

**DECISION-261 — The second-consumer trigger of DECISION-253 fires: the collapsing console nav and header move to `src/components/shared/` with required props.**

**Status:** Resolved (architect, Phase 2; tech-lead, Phase 3) · **Date:** 2026-10-25 · **Feature:** `2026-10-25-developer-portal-inc1` (no migration)

- **Promotion.** `AdminNavLinks`, `AdminNav`, `AdminMobileMenu` and `AdminHeader` become `ConsoleNavLinks`, `ConsoleNav`, `ConsoleMobileMenu` and `ConsoleHeader`. The console label, the id prefix, the main-landmark id and `canAccessAdmin` are required props with no defaults, so each caller states them; `/admin` passes the strings it used to hard-code. The Menu button does not render when `groups` is empty. A nav item may carry `alsoActiveOn` prefixes so a section whose pages live under other paths still lights.
- **`AdminForbidden`** stays in `admin-portal/` (DECISION-040: it must not become the `(org)` miss response) and is reused by import; its doc comment names the second platform consumer. A scan pins that `(org)` and `(public)` never import `admin-portal/`.
- **Nav registry.** The developer registry is pure data in `src/lib/developer-portal/nav.ts` and is unfiltered. The portal never appears in the admin left nav (DECISION-044); the way back to `/admin` is the avatar menu, gated on `canAccessAdmin`.
- **`.reg` palette.** It stays on the data-model pages with a tracked follow-up (Q8).
- **Pre-approved fallback.** If a padmin Phase 4 holds the files, parameterise in place with the same required props and record the promotion in `docs/TODO.md`.
- **Revisit if** a third console needs a different shell shape (then lift the layout composition, not just the pieces).

**F283 (medium, fixed) — the data-model page filed 58 of 105 tables under "platform (from starter)" and claimed it "cannot drift from what is deployed".** `MODULES` is a hand map; any table absent from it fell into the starter bucket, which has no diagram. All 15 `giving_*` tables, the tickets, events, domains, sites, invitations and presbytery-oversight tables were mislabelled, and a new table silently joined the wrong bucket (the 2026-09-25 code review's C-3 and the `docs/TODO.md:72` item had flagged the same drift). **Closed by** classifying every table (seven new modules, two extended, one closed `PLATFORM_TABLES` list with reasons) and `src/lib/dev-docs.test.ts`, which fails CI on an unclassified table, a stale entry or a table in both lists, in the way `contract.ts` fails an unclassified token. The header copy no longer claims the grouping cannot drift.

**F284 (medium, fixed) — `/developer` had no 2FA gate and no shell.** The proxy's 2FA gate covered `/admin` and `/o/` only, and the guard did not check either, so a platform administrator whose account requires a second factor and had not verified it could read the schema, the permission catalog and the invariants. The page also had no header, no sign-out and no way back to `/home`. **Closed by** a segment-boundary line in `src/proxy.ts` (eight rows in `proxy.test.ts`), the page gate's repeat of the check, `schema.json`'s JSON `403 two_factor_required`, a portal layout, and a running-server MFA e2e (a required-but-unverified user opening `/developer/tables/roll_actions` lands on `/totp` and returns to that path). DECISION-258.

**F285 (low, fixed) — `INVARIANTS` omitted six of CLAUDE.md's Key Invariants and carried a stale note.** Composite Tenant Keys, Extensibility Goes Through Support, The Brand Is a Cascade Override, A Custom Host Is a Key, The Proxy Does Not Reach the Database and Permissions vs Flags were absent; the wildcard entry still said `ADMIN_ROLE` "must be removed before ship" where CLAUDE.md records a known, bounded violation; the vocabulary said `documented` where CLAUDE.md says `paper`; and the page's headline counted "rules unenforced" from that list. **Closed by** a `source` field tying each entry to its CLAUDE.md heading, a closed `NOT_LISTED` with reasons, the vocabulary rename, six new entries, the repaired wildcard entry and `dev-docs.test.ts`, which fails when a Key Invariants heading is neither listed nor reasoned away. The wording of each entry is still hand-written and labelled so.

**F288 (low, fixed) — the gate's failure modes and the unconsumed `schema.json` claim.** `readIsPlatformAdmin` threw on a database error and showed Next's default error page; a signed-in non-entitled viewer was silently redirected to `/home`, which reads as revoked access or a bug; `schema.json`'s header comment said it served "the AI support worker", which nothing calls (it is session-authenticated, so an automated worker could not). **Closed by** the `ok`/`forbidden`/`unavailable` gate (the calm unavailable state fails closed), the shared `AdminForbidden` page, JSON `503 unavailable` from `schema.json`, and removal of the false comment. (The analyst slotted this in Increment 3; the orchestrator's Increment 1 scope contains both halves, so it ships here.)

## Follow-ups to add to `docs/TODO.md` at integration (Rule 10; orchestrator lands them)

- `.reg` palette migration to platform tokens, the paper/database icon, `.dark .reg` and the mermaid theme following the `.dark` class (Q8). Source: this log.
- If padmin's Phase 4 held the shell files and the in-place fallback was used: promote the parameterised components to `shared/`. Source: this log (DECISION-261).
- Close `docs/TODO.md:72` (module map) and the C-3 half of line 216 (`dev-docs.test.ts`), by F283 and F285.

## Out of Scope (confirm)

Unchanged from the parent's Phase 1 list, plus, for this increment: the `developer` role, the key, the `/launch` matrix, the avatar-menu predicate and the production seed (Increment 2); the API, Rules and Access pages and the route registry (Increment 3); rendering any `docs/*.md` (Increment 4); a status page; the `.reg` palette and dark-mode work (Q8 follow-up); any change to `users.is_platform_admin` or a UI for it (Q3); auditing portal reads (Q9).

## Operator questions

**None blocks Phase 4.** Three defaults to confirm or overrule when convenient:
1. **Forbidden wording.** "Ask a platform administrator if you need it" is true but not executable in the UI until Increment 2 ships a grant path (C7, check 3). Default: keep the shared string.
2. **Vocabulary.** The page keeps CLAUDE.md's three tags (`database`, `trigger`, `paper`), so a rule guarded by a repo tripwire for the shapes it can see (brand scope, proxy imports) shows as `paper`, with the tripwire named in its text, and the headline reads "rules rely on review". Default: keep three tags (Ruling 7 says the vocabulary matches CLAUDE.md). The alternative is a fourth tag, which needs an architect ruling.
3. **Wording of the tenant dot.** The old page said "tenant-scoped · row-level security applies"; the data behind it is only whether the table has an `organization_id` column, so it now says that (C4, C5). Default: keep the plainer wording.

For the orchestrator (not operator questions): give padmin Increments 2–4 Phase 3 the promoted component paths (Ruling 4); F288 now closes here, so Increment 3's number list loses it; step 0 prerequisites above.

## Implementer

**ux-developer** (Batch A, shell promotion; Batch C, portal pages, registries, CSS, e2e) and **api-developer** (Batch B, proxy line, gate, `schema.json`, `dev-docs` data and tests), sequential in one worktree, A then B then C. A single full-stack-developer was rejected: the work is well over 150 lines and spans the auth-touching proxy, the shell promotion and eleven new pages and tests; the Batch B/C seam is a small, fully specified interface (`requireDeveloper`, `DeveloperGate`, `AccessVerdict`). database-admin is not needed.

---

# Phase 4 — Implementation

## Batch A — shell promotion (ux-developer, 2026-10-25)

**Step 0.** `origin/main` (0.43.0, padmin PR #55) merged into the branch; work-logs and `docs/research/` committed. Feasibility re-run: the four shell files, `admin-forbidden.tsx`, `ui/sheet.tsx`, `shared/load-error.tsx`, `shared/empty-state.tsx` and `lib/admin-portal/nav.ts` exist on main. The `admin-portal/admin-(header|nav|nav-links|mobile-menu)` grep listed only the layout and the four files themselves. **Deviation from the design's read:** there were no `admin-header` or `admin-nav` tests and `layout.test.tsx` references none of the renamed components (it needed no edit). No padmin Phase 4 in flight, so the Ruling 4 fallback did not apply: promoted to `shared/`.

**Moved (git mv, history kept) and parameterised, all new props required, no defaults:**
- `admin-portal/admin-nav-links.tsx` to `shared/console-nav-links.tsx` (`ConsoleNavLinks`, `ConsoleNavLinkItem` with optional `alsoActiveOn`, `ConsoleNavLinkGroup`, `activeNavHref`; props `groups`, `idPrefix`, `onNavigate?`). Active rule: longest matching prefix among `href` and `alsoActiveOn`; an `exact` item ignores `alsoActiveOn`.
- `admin-nav.tsx` to `console-nav.tsx` (`ConsoleNav`: `groups`, `consoleLabel`, `idPrefix`; returns null when groups is empty).
- `admin-mobile-menu.tsx` to `console-mobile-menu.tsx` (`ConsoleMobileMenu`: `groups`, `version`, `consoleLabel`, `idPrefix`; renders nothing when groups is empty).
- `admin-header.tsx` to `console-header.tsx` (`ConsoleHeader`: `groups`, `consoleLabel`, `idPrefix`, `mainId`, `name`, `email`, `canAccessAdmin`, `canAccessDeveloper`).
- Tests moved: `console-nav-links.test.tsx`, `console-mobile-menu.test.tsx` (old strings passed as props), new `console-nav.test.tsx`. Added: `alsoActiveOn` (prefix, segment boundary, exact Home, aria-current, idPrefix heading ids), Menu absent when empty, sheet title/nav label/description from `consoleLabel`, ConsoleNav label and empty.
- `(admin)/admin/layout.tsx` passes `consoleLabel="Platform admin" idPrefix="admin-nav" mainId="admin-main" canAccessAdmin canAccessDeveloper={isPlatformAdmin}`.
- `(admin)/admin/shell-boundaries.test.ts`: the `/o/` scan and the BrandTokens/getPlatformDb ban now also cover `shared/console-*` (asserts 4 source files).
- `admin-forbidden.tsx`: one comment line naming the developer portal as second consumer (stays in `admin-portal/`).

**Gate.** `npm run typecheck`, `npm run lint` (max-warnings 0), `npm run check` (all eight, exit 0) clean; vitest over `shared/console-*`, `(admin)/admin` and `admin-portal`: 62 files, 738 tests pass (includes `layout.test.tsx`, `shell-boundaries.test.ts`). Dev server on 3570 (own process, killed by listening PID); `e2e/admin-shell.spec.ts` 7/7 pass (desktop nav groups and aria-current, phone Menu open/navigate/close/Escape, 360px no sideways scroll). Screenshots of `/admin` at 360px and 1280px compared by eye: unchanged; `scrollWidth` 360 and 1280; heading ids still `admin-nav-<key>`. Note for running e2e against a self-started server: it needs `RATE_LIMIT_DISABLED=true`, the DOMAINS fakes, `CRON_SECRET=giving-e2e-cron-secret`, `STRIPE_WEBHOOK_SECRET=giving-e2e-signing-secret`, and `E2E_ALLOW_SHARED_DB=true` (the pipeline Neon branch is dedicated).

**For Batches B and C.** Import from `@/components/shared/console-{header,nav}`; the shell-boundaries allow-list in Batch C already names `console-*`. No new copy strings were introduced. `ConsoleNav` and `ConsoleMobileMenu` return nothing for empty `groups`, so the layout may pass `[]` for a non-entitled viewer.

---

# Phase 5 — Verification (qa)

Pending.

---

# Phase 6 — Shipped vs Intent (analyst)

Pending.
