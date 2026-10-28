# User help, Increment 1: help infrastructure and `/help` — Work Log

> **Slug:** `2026-10-26-user-help-inc1`
> **Parent:** `docs/work-log/2026-10-26-user-help.md` (the shared Phase 1, Addendum A, the operator rulings and Phase 2 live there, verbatim; this file does not repeat them)
> **Surface:** public (platform hosts only; a custom church domain answers the neutral 404, like every platform route). Touches `src/proxy.ts` and two `(auth)` pages, so it is **auth-touching** (Phase 4 gate below).
> **Permission(s):** none: public reading. No `FEATURES.*` key, no session read on any help route.
> **Flag(s):** not needed (operator: no new platform flags pre-live). Publication is a build-time registry status, not a flag (DECISION-294).
> **Estimated complexity:** large (a route group, a renderer, a tripwire, a capture project, about 25 pages of prose)
> **Pipeline mode:** Full (adds a public route and changes the proxy)
> **Numbers (pre-assigned, Rule 16):** DECISION-293 to 295 and F345 to F349 were used by Phase 2; this document's new items are written **DECISION-new-n** and **F-new-n** and numbered by the orchestrator (F350 onward). No migration. Dev port **3660**, production lane **3661**. Neon branch `pipeline-user-help` for the dev server; screenshots use a separate, from-scratch branch (see Batch 4).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (parent log, with Addendum A and the operator rulings) | READY WITH NOTES | 2026-10-26 |
| 2 — Architectural review | architect | Complete (parent log: R1–R14, C1–C10 for Increment 2, DECISION-293/294/295, F345–F349) | Approved with suggestions | 2026-10-26 |
| 3 — Technical design | tech-lead | Complete for Increment 1. Placeholder list and four operator questions await the operator | Design complete; implementers named per batch | 2026-10-26 |
| 4 — Implementation | orchestrator (Batch 0), api-developer (1), ux-developer (2, 5), full-stack-developer (3, 4, 5c) | **Complete**: Batches 0, 1 (`d6e7bd7`), 2 (`be636c3`), 5a (`a0825c7`), 3 (`01a4821`), 5b (`1913918`), the help 404 follow-up (`7f4363e`), 4 (`097b43e`) and 5c (`d7e5d39`, plus the `fix(auth)` placeholder `366a1d3`). The auth-touching smoke (MFA-enrolled user, :3660) ran green at Batch 3 and again at Batch 5c; the production lane (:3661) ran green at Batches 3 and 4 | Ready for Phase 5 | 2026-10-28 |
| 5 — Verification | qa | Complete; chromium 542, custom-hosts 132, prod 100 with MFA user on own servers; 36 mutations red; findings 1–5 non-blocking | PASS | 2026-10-28 |
| 6 — Shipped vs intent | analyst | Complete; four pre-merge gates (preview 404 check, O3 Google, integration re-walk, why-cant-i-see-this table); integration checklist written | SHIP WITH NOTES | 2026-10-28 |

**Phases 1 and 2 are not repeated here.** They bind this design exactly as the parent records them: Phase 1 Gaps 1 to 11 and the adversarial pass, Addendum A (the website section, `/docs`, placeholders), the operator rulings of 2026-10-26 (contact form, the home line, real pages for in-flight features, placeholders only for bigger backlog tracks, the production-truth answer), and the architect's R1 to R14 and C1 to C10. The Carry-forward table below shows where each is handled.

---

# Phase 3 — Technical Design (tech-lead)

*Written 2026-10-26 in `/Users/cshenso/git/presby-platform/presby-help` (branch `pipeline/user-help`, HEAD `49a811c`, main at 0.47.0), read-only against the live tree and against the Phase 3 and Phase 6 records of the five in-flight pipelines named below. No code and no shared file was edited. No real congregation, hostname, address or person is named in this document; the one external address used, the project's public repository, is already on the marketing home page.*

## Summary

Build the public help site at `presbyportal.org/help` and the machinery that keeps it true. A new un-brandable route group `(documentation)` serves static, session-free pages rendered from markdown bodies in `src/content/help/` and a typed registry in `src/lib/help/`; one shared renderer (`markdown-document.tsx`) has no raw HTML and no `prose` classes; the proxy lets `/help` and `/docs` through by a segment-boundary prefix (R1). A page is `published`, `pending` (written against an in-flight pipeline's design, invisible until its feature is in production) or `planned` (a labelled placeholder for a bigger backlog track), and the status is checked against a `[help:<token>]` on exactly one `docs/TODO.md` line, so a page cannot go live ahead of its feature and cannot lag it (DECISION-294). A ninth tripwire, `check:help`, and a vitest coverage file hold registry, content, links, images, labels, phrases and import boundaries to rule. A capture project generates screenshots from a fixture-only database behind a fail-closed guard. Workflow Rule 17 makes the help a duty of every feature that changes what a person can see. Increment 1 ships 16 published pages and 7 pending pages (written against the five in-flight pipelines), the index, up to 8 labelled placeholders (awaiting the operator), the "Help" links in the home bar, the avatar menu, `/signin`, `/totp`, `/access-pending` and six toggle-off states, and the true home line "PresbyPortal is in early release."

## Phase 3 rulings and feasibility findings (read first)

The feasibility check against the live tree changed the design in the places below. Each is a ruling on top of R1 to R14; none contradicts one. **F-new-n** are new findings for the orchestrator to number.

| # | Finding or ruling | Consequence |
|---|---|---|
| **P3-1 / F-new-1** | R7 says `check:help` "can import `ORG_FEATURE_CATALOG` through `tsx`". It cannot. `src/lib/org-features.ts` begins `import "server-only"` (it throws under plain Node) and imports `@/lib/authz`, `@/lib/audit` and `@/lib/flags` (the database); `src/lib/org-portal/tiles.ts` also begins `import "server-only"`. R8's remedy, extracting a pure `org-feature-catalog.ts`, would move a 200-line table that three unmerged branches edit (`pipeline/signin-invites`, `pipeline/treasury`, `pipeline/person-photos` all change `org-features.ts` against this base), so the extraction would conflict at each of their integrations. | The catalog and tile coverage rules and the `needs.turnOn` name rule live in a **vitest file**, `src/lib/help/coverage.test.ts`, that imports the catalog and `PORTAL_TILES` with the same mocks `src/lib/org-feature-catalog.test.ts` already uses (`vi.mock("server-only")` and the three module mocks). `npm run test` and CI run it on every PR. Everything else is in `scripts/check-help.ts` (tsx, no environment, no database). The extraction stays R8's option for Increment 3, when a page renders a constant by import. |
| **P3-2 / F-new-2** | R4 says tables render "through the `ui/` primitive inside a focusable scroll wrapper". `src/components/ui/table.tsx` renders its own `overflow-x-auto` container `div` and spreads props onto the inner `<table>`, so a wrapper outside it would not scroll and the container itself cannot be given `tabIndex`. | `Table` gains an optional `containerProps?: React.ComponentProps<"div">` merged onto the container (existing callers pass nothing and are unchanged), with a header-comment divergence note as `docs/ui-standards.md` requires, and a case in `table.test.tsx`. The renderer passes `tabIndex={0}`, `role="region"` and an `aria-label` (Copy C1) plus the focus-ring classes. |
| **P3-3** | `scripts/check-proxy-imports.mjs` exports `stripComments` and `importSpecifiers`, but `resolveSpecifier`, `normalize` and the forbidden-path rules are private, and `forbiddenPath()` is hard-coded to the proxy's rules. R8 allows "reuse the exported walker, or lift it". | Lift the three primitives to a new `scripts/lib/import-graph.mjs` together with a generic `checkImportBoundary(files, { entries, ban })`. `check-proxy-imports.mjs` imports the primitives and re-exports `stripComments` and `importSpecifiers`, with **no behaviour change**; its existing test file is the guard and must stay green and unedited. The help boundary rule (H19) calls `checkImportBoundary`. |
| **P3-4** | Content rules need to see headings, links, images and raw HTML. `unified`, `mdast-util-*` and `unist-util-visit` are transitive; promoting one to a direct import is refused (Phase 2). | A small hand-written line scanner, `src/lib/help/markdown-scan.ts` (pure), reads fenced code, ATX headings, inline links and images. To keep it exact, content is restricted to the subset the scanner models: **inline links only** (no reference-style `][`, no `<https://…>` autolinks, no bare URLs, which GFM would otherwise autolink), **ATX headings only**, no raw HTML (a `<` followed by a letter or `!--` outside code fails). The renderer renders the same subset; a parity test feeds every fixture to both. |
| **P3-5** | One sentence must change in many pages when Increment 2 ships the contact form. | Markdown may contain exactly one template token, `{{contact}}`, replaced by `HELP_CONTACT_LINE` (`src/lib/help/contact.ts`) before rendering and before every content check. Any other `{{` fails. Until Increment 2: "Ask the person who invited you." (operator ruling, analyst Q3 default). Increment 2 changes one constant. |
| **P3-6** | R6 leaves "a behaviour change to a published page" to the fixing pipeline and to the human rule. That is the failure the retrospectives keep finding. | Add a cheap mechanical backstop: a published entry may carry `limitationUntil: <token>` when its prose states a limit that an in-flight feature removes. `check:help` fails when that token's line is **Done** ("feature shipped: remove the limitation sentence and the marker"). It never fires while the line is open, so it costs nothing until the feature ships, and then it names exactly the pages to edit. Used on `adding-people`, `officers-and-the-session` and `why-cant-i-see-this` (2b) and `using-the-directory` (photos). |
| **P3-7** | The planned-to-published handover and slug permanence (Phase 1 Gap 9, Addendum A). | A planned entry's slug **is** its token (`[help:<slug>]` on one open line). A published entry may declare `replaces: ["<planned slug>"]`; `/help/planned/<old>` then redirects to it. `src/lib/help/slug-history.ts` is an append-only list of every slug ever published or planned; `check:help` fails when a historical slug is neither current nor an alias or `replaces` target (H3). Redirects come from one pure function, `helpRedirects()`, spread into `next.config.ts`, each carrying `has: [{ type: "host", value: PLATFORM_HOST }]` (F151). Zero redirects exist at first release; the function and its test ship now so the rule has teeth on day one. |
| **P3-8** | Layout chrome (architect: wordmark, "Sign in", "Open PresbyPortal", no session read). | Keep exactly that. The chrome cannot tell the reader's state, so a signed-in reader also sees "Sign in" (it opens the sign-in form, harmless, pinned by a test) and "Open PresbyPortal" (`/launch`) is the one that works for both. The header row wraps at 360px (`flex-wrap`) rather than hiding a link. Operator question O4. |
| **P3-9 / F-new-3** | `/no-organization` and `/invite` are the two pages where a help link helps most, and both are the wrong files to touch now: `pipeline/signin-invites` rewrites all of `src/app/no-organization/` (page, view, cards, forms) and edits `(invite)`; and `/invite`'s target page, `accepting-your-invitation`, is `pending`, so `helpHref("accepting-your-invitation")` is a compile error until it publishes (R12). | **Not in Increment 1.** Each link ships in the commit that publishes its target page (`accepting-your-invitation` adds the `/invite` link; `sign-in-invitations` adds the `/no-organization` link), listed under "Integration" so the orchestrator does not forget them. This resolves the Phase 1 "in-app links" list by deferral, not omission. |
| **P3-10** | Phase 1 Gap 9: "except the toggle-off states". Twenty-odd pages say "isn't turned on". | Add the link only where the sentence is about a **per-org toggle an administrator can flip or ask for**: the calendar, Community (`members-states.tsx`), job openings, Giving (`giving-admin-states.tsx`), Parish management and Website domain states. Six files, one added line each (Copy C3). The rest are platform-flag states (all on in production) and stay as they are. |
| **P3-11** | The operator's rulings give the in-flight features real pages; R6 says a behaviour change to a published page belongs to the fixing pipeline. F343 changes an existing rule, not a page. | Split so R6 holds: `using-your-code` is **rule-neutral** (how to enter a code, recovery code, lost phone; "whether you are asked for a code depends on your account, your role and your congregation", true before and after F343) and **published**; `who-is-asked-for-a-code` is a **new** page, `pending` on F343. F166 gets two new pending pages (`accepting-your-invitation`, `setting-up-two-factor`); 2b, treasury and photos one or two each. |
| **P3-12** | Phase 1 Q5 default (taken): no treasurer or giving pages until the operator confirms a live Stripe test and the statements gate. Treasury reimbursements are the operator's explicit exception ("document stuff that is in progress right now"). | Giving and Manage giving go on the shrink-only coverage allowlist with that reason. The two reimbursement pages stay `pending`. |
| **P3-13** | Phase 1 offered "a registry `published: false` per page" as the rollback. R6's statuses make a `pending` page require a token on an open line, so a kill switch would fight rule (b). | **There is no per-page switch.** A page found false in production is corrected or reverted the same day (it is documentation; the fix is a markdown edit and a deploy). The global rollback is reverting the in-app links commit (the pages stay reachable by URL, unlisted) or reverting the whole increment. Stated here because Phase 1 asked for it in the design. |
| **P3-14** | Screenshot freshness (Phase 1 Gap 3, R5, R10). | Two files: `screenshots-data.ts` (pure, hand-edited: id, alt, route, fixture user, viewport, `capturedIn`) and `screenshots.ts` (the static PNG imports, binding id to image). The capture spec reads the data file, writes the PNGs, and **fails if any entry's `capturedIn` is not the current `package.json` version**, so the stamp can only move by actually re-running capture. `check:help` reads PNG headers (pure) for width, height and size. |
| **P3-15** | `labels[]` are only worth something if they are the strings the page quotes. | A label must occur in a non-test `src/` file (R7) **and** in the page's own markdown or registry strings (otherwise a stale label silently satisfies the check). |
| **P3-16** | R7 "shrink-only allowlist". | `src/lib/help/coverage-allowlist.ts` lists each undocumented catalog key or tile key with a reason string; `coverage.test.ts` pins `ALLOWLIST.length` to a committed number it cannot exceed, so adding an entry means editing the test in the same diff, and a removal is free. Planned and pending pages never count as coverage, and an `overview` page counts only for its own tile (`tile:features`), never for a toggle key. |

**Feasibility checks that returned clean** (nothing to change): there is no SQL, no `ALTER` or `DROP`, no CHECK, trigger or FK in this increment, so the four SQL checks are not applicable. `src/proxy.ts` gains one inline predicate and **no import**, so `check:proxy-imports` is unaffected. `tsx` ^4.21.0 is a devDependency and honours the `@/` paths in `tsconfig.json`. `src/components/ui/table.tsx` exists; `react-markdown` ^10.1.0 and `remark-gfm` ^4.0.1 are direct dependencies; no new package. `scripts/check-brand-scope.mjs`'s brandable prefixes are `src/app/(org)/` and `src/app/(public)/`, so `src/app/(documentation)/` is un-brandable with no script change. The existing `(admin)/admin/docs/page.tsx` already reads files with `process.cwd()`; the help loader reads at **build** only (R3).

**Kickoff checklist for Phase 4 (re-run against main, because five pipelines are about to merge):** K1 `git diff` of `src/proxy.ts`, `src/components/shared/avatar-menu.tsx`, `src/app/page.tsx`, `next.config.ts`, `playwright.config.ts`, `src/app/(auth)/signin/page.tsx`, `src/app/(auth)/totp/page.tsx`, `src/app/access-pending/page.tsx` against the base this design read (a change to any is a re-read, not a surprise); K2 `docs/TODO.md` state of the five tokens (see "Integration"); K3 `ls drizzle` unchanged by this pipeline (no migration); K4 `npm ci`; K5 `npm run typecheck` clean; K6 `df -h /System/Volumes/Data` at least 20 GiB.

## Permissions & Flags

- **Permission key(s):** none. Every route under `(documentation)` is public, static and session-free. No `FEATURES.*` entry; `src/lib/permissions.ts` is untouched.
- **Default role bindings:** none.
- **Feature flag(s):** not needed. A help page never reads a flag, a toggle or a session, so its content cannot vary by viewer. Accepted residual (`paper`, from R6): a feature merged behind a global flag that is off in production must not have its page published until the operator turns the flag on; and an operator flag flip changes what a page describes with no pipeline. Both are in Rule 17's trigger list and the monthly re-walk.
- **Rollback:** see P3-13 (revert; no per-page switch).
- **Two-factor edge:** `/help` is reachable signed out and mid-enrolment because the bypass sits before `edgeAuth()` and before the 2FA gate; pinned by a unit test and an e2e (below).

## API Contract

**No route handlers and no server actions.** The new routes are pages:

| Method and path | Purpose | Response |
|---|---|---|
| `GET /help` | The index, grouped by audience, with a link to the planned page | 200, static (`○`) |
| `GET /help/<slug>` | A published page | 200, static (`●`); every other slug, including `pending`, `planned`, retired and typo'd, is the **same** 404 |
| `GET /help/planned` | The placeholders | 200, static |
| `GET /help/planned/<slug>` | One placeholder | 200, static; unknown slug 404 |
| `/help/contact` | **Reserved** for Increment 2; the registry refuses the slugs `contact` and `planned` | not built here |
| `/docs`, `/docs/<x>` | Bypassed by the proxy now (R1, one decision for both prefixes); no route until Increment 3 | the platform 404 |

Pure signatures the implementers build to (all under `src/lib/help/`, none imports a module R8 bans):

```ts
// types.ts
export const HELP_AUDIENCES = ["prospective", "everyone", "administrator", "treasurer"] as const;
export type HelpAudience = (typeof HELP_AUDIENCES)[number];
export type HelpToken = string;                       // ^[a-z0-9]+(-[a-z0-9]+)*$, the [help:<token>] on one TODO line
export type HelpVersion = `${number}.${number}.${number}`;

export interface HelpNeeds {
  who: string;                                        // the role in the UI's own words, never a permission key
  turnOn?: { toggleKey: string; name: string; defaultOn: boolean };   // name must equal the catalog name; defaultOn = provisionedOn
  appliesTo?: "all" | "congregations" | "congregations-and-nwcs" | "presbyteries";  // must equal catalog orgTypes
  operatorEnabled?: boolean;                          // must equal the catalog's operatorEnabled
}
interface HelpBase {
  slug: string;                                       // permanent; kebab-case; not "planned" or "contact"
  title: string;                                      // the page's only <h1>; a content file may not contain "# "
  summary: string;                                    // one sentence, shown under the h1 and in the index
  order: number;                                      // unique within its audience group
  aliases?: readonly string[];                        // old slugs; each becomes a 308 on platform hosts
}
export interface HelpContentEntry extends HelpBase {
  status: "published" | "pending";
  audience: HelpAudience;
  needs?: HelpNeeds;
  covers: readonly string[];                          // "org_portal.<toggle>", "tile:<key>", "flag:<key>", or "route:/<path>"
  labels: readonly string[];                          // exact UI strings the page quotes (no interpolation)
  anchors?: readonly string[];                        // heading slugs other code links to (declared, checked)
  verifiedIn: HelpVersion | null;                     // null only while pending; a claim that someone re-walked the page
  requires?: HelpToken;                               // pending: required; published: optional (token line must be Done)
  limitationUntil?: HelpToken;                        // P3-6
  replaces?: readonly string[];                       // planned slugs this page retires (P3-7)
  overview?: true;                                    // counts as coverage only for its own tile, never for a toggle key (P3-16)
}
export interface HelpPlannedEntry extends HelpBase {  // slug === its [help:<slug>] token
  status: "planned";
  forWhom: string;
  today: string;                                      // the "Today:" line
  confirmedOn: string;                                // ISO date the operator last said "still planned"
}
export type HelpEntry = HelpContentEntry | HelpPlannedEntry;

// registry.ts: `export const HELP_PAGES = [ ... ] as const satisfies readonly HelpEntry[];` (no fs, no @/ runtime import)
export type PublishedSlug = Extract<(typeof HELP_PAGES)[number], { status: "published" }>["slug"];
export type PlannedSlug   = Extract<(typeof HELP_PAGES)[number], { status: "planned" }>["slug"];
export type AnchorOf<S extends PublishedSlug> =
  Extract<(typeof HELP_PAGES)[number], { slug: S }> extends { anchors: readonly (infer A)[] } ? A : never;

// urls.ts  (type-only import of the registry; the runtime is two string concatenations)
export const HELP_INDEX_HREF = "/help" as const;
export function helpHref<S extends PublishedSlug>(slug: S, anchor?: AnchorOf<S>): string;  // "/help/<slug>[#anchor]"
export function plannedHref(slug: PlannedSlug): string;                                    // "/help/planned/<slug>"

// select.ts (pure)
publishedPages(): readonly HelpContentEntry[]; pendingPages(); plannedPages();
indexGroups(): { audience: HelpAudience; label: string; pages: HelpContentEntry[] }[];   // empty groups omitted
neighbours(slug): { previous: HelpContentEntry | null; next: HelpContentEntry | null };   // within the audience group, published only
helpRedirects(): { source: string; destination: string; permanent: true; has: [{ type: "host"; value: string }] }[];  // takes the host pattern as an argument

// content.ts (server-only; node:fs; used by static pages only)
loadHelpPage(slug: string): { entry: HelpContentEntry; markdown: string } | null;  // null unless published; applies {{contact}}; the path is built from the entry's slug, never from the request
```

## Data Model

No schema changes required. No migration, no table, no RLS or grant change, no `db:push`. (Increment 2, the contact form, owns the first table; its numbers are assigned at its kickoff.)

## Component / Page Plan

Placement is the architect's, unchanged. No Rule 16 shared file (`docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `e2e/support/*`, and the rest of the list) appears in Create or Modify; the orchestrator edits them at integration.

**Create**

- `src/app/(documentation)/layout.tsx`: chrome only (Copy C1). No `auth()`, no `headers()`, no `cookies()`, no `searchParams`. `<main id="help-main" tabIndex={-1}>` is the skip-link target. Header actions are `Button asChild` links (the primitive, never hand-rolled button classes: `check:brand-scope` C2).
- `src/app/(documentation)/help/page.tsx` (index), `help/[slug]/page.tsx`, `help/planned/page.tsx`, `help/planned/[slug]/page.tsx`, `help/not-found.tsx`. Each content route exports `dynamic = "error"`, `dynamicParams = false`, `generateStaticParams()` and `generateMetadata()` (title, description and **per-page `openGraph` title and description**, so a shared link previews as the page; planned pages add `robots: { index: false, follow: false }`). **No `loading.tsx`, no `error.tsx`** anywhere under `(documentation)`.
- `src/app/(documentation)/shell-boundaries.test.ts`: the `(admin)/admin/shell-boundaries.test.ts` pattern: no `loading.tsx` under the group; every content `page.tsx` declares `dynamic = "error"`, `dynamicParams = false` and `generateStaticParams`; no file under the group imports a module R8 bans.
- `src/components/shared/markdown-document.tsx`: the shared renderer (contract below).
- `src/components/help/`: `needs-block.tsx`, `planned-placeholder.tsx` (the **only** file where future-tense wording is allowed, and `check:help` does not scan it), `page-nav.tsx` (breadcrumb, previous and next), `on-this-page.tsx` (a native `<details>`; **no `display` on its `<summary>`**, the iOS bug), `help-link.tsx` (the in-app link, Copy C3), `index-groups.tsx`, plus `*.test.tsx` for each.
- `src/lib/help/`: `types.ts`, `registry.ts`, `select.ts`, `urls.ts`, `contact.ts`, `tokens.ts` (`{{contact}}`), `slug.ts` (heading slug, hand-written, per-document de-duplication), `headings.ts` (`extractHeadings`, shared by the renderer and the on-this-page list so their ids cannot disagree), `markdown-scan.ts`, `checks.ts` (the pure rules), `todo-grammar.ts`, `slug-history.ts`, `coverage-allowlist.ts`, `example-names.ts`, `copy.ts` (the chrome strings of Copy C1), `links.ts` (`resolveLink` and the external allowlist), `shots-guard.ts` (the pure guard decision), `screenshots-data.ts`, `screenshots.ts` (static PNG imports), `content.ts` (server-only), and a `*.test.ts` beside each.
- `src/lib/help/coverage.test.ts`: the vitest half of the tripwire (P3-1).
- `src/content/help/<slug>.md` for each published and pending entry; `src/content/help/images/<id>.png`.
- `scripts/check-help.ts` (thin tsx runner), `scripts/lib/import-graph.mjs` and `scripts/lib/import-graph.test.mjs` (P3-3).
- `e2e/help.spec.ts`, `e2e/help-gates.spec.ts` (and the custom-host additions); `e2e/help-shots/capture.spec.ts` and `e2e/help-shots/guard.ts` (the thin owner-connection reader; the decision is `src/lib/help/shots-guard.ts`, which vitest can run, because vitest does not include `e2e/`). Keep every new e2e helper inside `e2e/help-shots/`: `e2e/support/*` is a Rule 16 shared file.

**Modify**

- `src/proxy.ts`: one inline predicate and one early return (below). `src/proxy.test.ts`.
- `src/components/ui/table.tsx` and `table.test.tsx` (P3-2).
- `src/components/shared/avatar-menu.tsx` and `avatar-menu.test.tsx`; `e2e/header-controls.spec.ts` (blast radius).
- `src/app/page.tsx` and `src/app/page.test.tsx` (the Help link; the early-release line).
- `src/app/(auth)/signin/page.tsx`, `src/app/(auth)/totp/page.tsx`, `src/app/access-pending/page.tsx` (one `HelpLink` each) and a unit test for each link.
- The six toggle-off state files (P3-10): `src/app/(org)/o/[slug]/calendar/calendar-states.tsx`, `.../admin/community/members-states.tsx`, `.../admin/careers/careers-states.tsx`, `.../admin/giving/giving-admin-states.tsx`, `.../directory/parishes/parishes-states.tsx`, `.../admin/domains/domains-states.tsx`, each with its existing `*.test.tsx` extended (grep for exact-text assertions first).
- `next.config.ts`: spread `helpRedirects()` into `redirects()`. The config is loaded outside the `@/` alias, so `types.ts`, `registry.ts` and `select.ts` import one another by **relative path only** (a test reads the three files and fails on an `@/` runtime import).
- `playwright.config.ts`: the `help-shots` project (below). `package.json`: scripts `check:help`, `help:shots`, and `check` gains `&& npm run check:help` (the ninth).
- `scripts/check-proxy-imports.mjs` (imports the lifted primitives; behaviour unchanged), `scripts/check-brand-scope.mjs` (header comment lists `(documentation)` as un-brandable; no logic change).
- `e2e/custom-domains/lockdown.spec.ts` (platform paths, below).
- `docs/product/functionality-map.md`: a new Index bullet and full-map bullet for the help site, and `/help/<slug>` appended to each bullet a published page covers (rule H15). `docs/ui-standards.md`: a short "Linking to help" paragraph (use `helpHref`, a `HelpLink`, 44px target).

**Orchestrator, at integration (S and agent files):** `docs/TODO.md` token lines (Batch 0 and "Integration"), `docs/decisions.md`, `CLAUDE.md`, `docs/work-log/_template.md`, `.claude/skills/release-notes/SKILL.md`, `.claude/skills/pre-push/SKILL.md`, `.claude/agents/{analyst,qa,tech-lead,architect}.md`. The exact text is under "Workflow Rule 17 and the edits".


## Build-time loader and the static lock (R3)

- `content.ts` reads `src/content/help/<slug>.md` with `node:fs` **at build only**; `process.cwd()` is the project root on Vercel and locally. The slug comes from the registry entry, never from the request (`loadHelpPage` looks the slug up among published entries first, so a path-traversal string is simply "not found"). No `outputFileTracingIncludes` entry is needed because no runtime read exists.
- Every content route declares `dynamic = "error"`, `dynamicParams = false` and `generateStaticParams()` from `publishedPages()` (or `plannedPages()`). Any accidental `auth()`, `headers()`, `cookies()` or `searchParams` fails `next build`. The route table in `next build` must show the help routes as static (`○`/`●`); QA reads it.
- An unknown, pending, planned-under-`/help/<x>`, retired or typo'd slug is declined by `dynamicParams = false` and answered by the `help/[...unmatched]` catch-all (`force-dynamic`, calls `notFound()`; architect ruling after Batch 3), which renders `help/not-found.tsx` at HTTP **404** with no per-URL cache entry. The response and its timing are the same for every cause (Phase 1 enumeration finding).
- Revisit if `cacheComponents` is ever enabled (move the lock to `ensureStatic`) or if a page under these prefixes ever needs a session (DECISION-293).

## Renderer contract (`src/components/shared/markdown-document.tsx`, R4)

A Server Component. No I/O, no `fs`, no registry import. It exists in `shared/` because `/docs` and the developer portal's Increment 4 reuse it.

```ts
interface MarkdownDocumentProps {
  markdown: string;
  resolveLink: (href: string) => { kind: "internal" | "external"; href: string } | null;  // null renders the text, no anchor
  resolveImage: (src: string) => { src: string; width: number; height: number } | null;   // null renders nothing
  headingBase: 1 | 2;   // the lowest level rendered: markdown "#" clamps to this; "##".."######" render h2..h6
}
```

| Rule | Behaviour | Pinned by |
|---|---|---|
| No raw HTML, no `rehypePlugins` prop | `rehype-raw` cannot be passed in (the prop does not exist; a `// @ts-expect-error` test says so). Raw HTML in a document renders as text. | `markdown-document.test.tsx` |
| URL safety | react-markdown's default URL transform stays; `resolveLink` is the second gate. `javascript:` and `data:` links render as plain text. | same |
| Type scale | `p` `text-base leading-7`; `h2` `text-xl font-semibold`; `h3` `text-lg font-semibold`; `h4`–`h6` `text-base font-semibold`; code `text-sm` on `bg-muted`; blockquote a bordered note. **No `prose` classes** (the typography plugin would set 14px body), no `text-xs`, no palette literal. | test asserts none of `prose`, `text-xs`, `text-\[`, a palette class appears in the output |
| Headings | `id` from `slug.ts` with per-document de-duplication (`-2`), the same function `extractHeadings` uses. One `<h1>` per page, supplied by the page from the registry title; a `#` in content is clamped to h2 as defence in depth (and `check:help` rejects it, rule H4). | `slug.test.ts`, a parity test of renderer ids against `extractHeadings` |
| Tables | `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell` from `ui/table.tsx`, with `containerProps` (P3-2): focusable (`tabIndex 0`), `role="region"`, `aria-label` (Copy C1). A literal `<table` outside `ui/` is banned by C2. | test; 360px browser check |
| Lists and steps | `ol` for steps, `ul` for lists; `li` spacing; no custom bullets. | test |
| Links | internal: `next/link`; external: `<a target="_blank" rel="noreferrer noopener">` plus a visually hidden cue (Copy C1) and an icon (`lucide-react`, `aria-hidden`). Long words and URLs wrap (`break-words`). | test |
| Images | `<img>` (never `next/image`: the Image SSRF advisory is open) with `width`, `height`, `alt` from the markdown, `loading="lazy"`, `decoding="async"`, `className="h-auto max-w-full rounded-md border border-border"`. | test |
| Help's resolvers | `resolveLink` admits `/help`, `/help/<published slug>[#declared anchor]`, `/help/planned`, `/help/planned/<slug>`, `/launch`, `/signin`, and `https:` URLs on `EXTERNAL_LINK_ALLOWLIST` (`src/lib/help/links.ts`; initially the project's public repository and its public architecture overview, both already on the marketing home). `resolveImage` accepts only `shot:<id>` and looks the id up in `screenshots.ts`; a remote or tracking-pixel source renders nothing and fails `check:help`. | `links.test.ts` |
| Print | The page chrome hides its buttons and the on-this-page list in print (`print:hidden`); nothing relies on colour alone. | unverified in a print preview until the Phase 5 walk |

## The proxy change and its tests (R1)

In `src/proxy.ts`, **after** the `/site` bypass and **before** `PUBLIC_PATHS.has(pathname)` and `edgeAuth()`, on the platform-host side of the first branch (a custom host has already been rewritten):

```ts
// Public documentation (DECISION-293): /help and /docs, by SEGMENT boundary, never a bare startsWith
// ("/helpdesk" must not pass). Every page under these prefixes is static and session-free by
// construction (dynamic = "error"), and no token rides these paths, unlike /invite.
const isDocumentationPath = (p: string) =>
  p === "/help" || p.startsWith("/help/") || p === "/docs" || p.startsWith("/docs/");
...
if (isDocumentationPath(pathname)) return NextResponse.next();
```

No import is added (`npm run check:proxy-imports` is unchanged and runs). Tests in `src/proxy.test.ts`, new `describe("proxy — /help and /docs (DECISION-293)")`:

1. `/help`, `/help/signing-in`, `/help/planned`, `/help/planned/x`, `/docs`, `/docs/x` admit an anonymous visitor with **no `edgeAuth()` call** (`auth` not called, status 200, no `location`).
2. `/helpx`, `/helpdesk`, `/docsx`, `/HELP`, `/help%2Fx` do **not** pass: each redirects to `/signin` with `callbackUrl` equal to the path.
3. A signed-in user with `twoFactorRequired: true` and `twoFactorVerified: false` reaches `/help/signing-in` (200, no `/totp` redirect) while `/o/alder-creek` still redirects to `/totp` (the gate is intact).
4. A custom host's `/help` and `/help/signing-in` are rewritten to `/site/<host>/help…` and never reach the bypass (extends the existing "custom host is rewritten" describe).
5. The existing "does not bypass `/siteX`" and `/invite` exact-path tests are untouched and must pass.

## `check:help`, the ninth tripwire (R7)

**Shape.** `npm run check:help` is `tsx scripts/check-help.ts`. The runner reads the registry (a TS import), the content directory, `docs/TODO.md`, `package.json`, `docs/product/functionality-map.md`, the images directory and the non-test `src/` tree, builds a plain `files` array, and calls the pure rules in `src/lib/help/checks.ts`. It needs no environment and no database, prints `[H<n>] <file>: <message>` per violation, and exits 1. Every rule has a failing and a passing fixture in `checks.test.ts` (a fixture is an in-memory `files` array; no test reads the real tree). The vitest half, `coverage.test.ts`, is P3-1.

| Id | Rule | Source of truth |
|---|---|---|
| H1 | Registry shape: slugs unique, kebab-case, at most 60 characters; `planned` and `contact` refused; aliases and `replaces` unique and never equal to a live slug; `order` unique within an audience; a published entry has `verifiedIn`; a pending entry has `requires`; a planned entry has `forWhom`, `today` and an ISO `confirmedOn`. | `registry.ts` |
| H2 | File parity: each published or pending entry has `src/content/help/<slug>.md`; each `.md` has an entry; a planned slug has no file. | directory listing |
| H3 | Slug permanence: every published and planned slug is in `slug-history.ts`; every historical slug is a current slug, an alias, or a `replaces` target. | `slug-history.ts` |
| H4 | Headings: no level-1; no skipped level; no empty heading; every declared `anchors` entry equals the generated slug of a heading in that page. | `markdown-scan.ts` |
| H5 | Subset: no raw HTML, no reference-style link, no `<https…>` autolink, no bare URL, no `{{` other than `{{contact}}`, no HTML entity left over. | scanner |
| H6 | Links: every inline destination is one `resolveLink` admits; a `#anchor` on a help link is declared on its target and exists; link text is never "here", "click here", "this link", "link" or "read more". | `links.ts` |
| H7 | Images: only `![alt](shot:<id>)`; the alt is non-empty and at most 125 characters; the id is in `screenshots-data.ts`. | scanner |
| H8 | Banned phrases in published markdown and published registry strings: `coming soon`, `will be able to`, `planned`, `in a future release`, `in the future`, `next release`, `later this year`, `stay tuned`. The placeholder component and planned entries are exempt. | fixed list |
| H9 | No Real Data (content): hostnames and project-identifier shapes (`*.neon.tech`, `vercel.app`, `ep-…-…-…`, `br-…`, `snap-…`, `site-<slug>` repository names); any `https:` host off the allowlist; a named-congregation heuristic (a capitalised phrase ending in "Church", "Presbytery" or "Synod" that is not in `example-names.ts`). The heuristic is soft: the message tells the author to add a fictional name to the allowlist. `check:secrets` already covers emails, phone numbers and keys in every tracked file. | `example-names.ts` |
| H10 | Labels (published only, P3-15): each `labels` string occurs in a non-test `src/` file outside `src/content/**`, `src/lib/help/**` and `src/components/help/**` (whitespace collapsed, `&apos;` and `&rsquo;` normalised), **and** in the page's own text. | `src/` text |
| H11 | `needs` (published only): `who` is non-empty and contains no permission key (`\b[a-z_]+\.[a-z_]+\b` pattern with a known key prefix). The toggle-name and default equalities are in `coverage.test.ts`. | registry |
| H12 | Publication (R6, DECISION-294), see the grammar below: (a) a published page with `requires` needs its token line Done; (b) a pending page needs `requires` and an **open** token line, and if the line is Done the message is "feature shipped: publish its page"; (c) a planned slug's line must be open; a Done or declined line says "replace or remove the placeholder"; (d) a token missing or appearing more than once fails; (e) several pending pages may share a token, a planned token belongs to one entry; (f) `limitationUntil` needs an open line (P3-6). | `docs/TODO.md` |
| H13 | `verifiedIn` is a version at most `package.json`'s. | `package.json` |
| H14 | `covers` entries match `org_portal.<key>`, `tile:<key>`, `flag:<key>` or `route:/<path>`. (Existence in the catalog is `coverage.test.ts`.) | registry |
| H15 | The functionality map contains `/help/<slug>` for every published slug. | the map |
| H16 | No string or template literal that begins with `/help` (double-quoted, single-quoted or backtick) in a non-test `src/` file outside `src/lib/help/`, `src/proxy.ts` and `src/app/(documentation)/` (R12: use `helpHref`). `next.config.ts` and `e2e/` are not scanned. | `src/` text |
| H17 | Images on disk: every file in `src/content/help/images/` has a data entry and every data entry has a file (no orphan either way); the PNG header width and height equal the entry's; the file is at most 400 KB; `capturedIn` is a version at most `package.json`'s; every entry is referenced by some published or pending page. | PNG header bytes |
| H18 | `screenshots.ts` contains exactly one static `import … from "@/content/help/images/<file>"` per data entry. | scanner |
| H19 | Import boundary (R8): from every non-test file under `src/app/(documentation)/help/**`, `src/app/(documentation)/docs/**` (except `help/contact/**`, Increment 2, C1), `src/lib/help/**`, `src/components/help/**` and `src/components/shared/markdown-document.tsx`, the import graph (type-only imports not followed) never reaches `src/lib/db/**`, `@/auth`, `next-auth`, `next/headers`, `@/lib/flags`, `@/lib/authz` or `src/lib/sites*.ts`. `checkImportBoundary` from the lifted helper (P3-3). | `scripts/lib/import-graph.mjs` |

**`coverage.test.ts` (vitest, P3-1).** With the catalog and tiles imported under the existing mocks: (1) every `ORG_FEATURE_CATALOG` key and every `PORTAL_TILES` key is in the `covers` of some **published** page (an `overview` page counts only for its own tile, P3-16), as `org_portal.<key>` or `tile:<key>`, or is in `coverage-allowlist.ts` with a reason; (2) every `covers` entry on a published page names a real catalog key, tile key or `route:` path; (3) each published `needs.turnOn` has `name` equal to the catalog entry's `name`, `defaultOn` equal to its `provisionedOn`, and `appliesTo` and `operatorEnabled` equal to its `orgTypes` and `operatorEnabled`; (4) the allowlist length is pinned (P3-16) and no entry is both allowlisted and covered; (5) `HELP_PAGES` pending entries' `covers` are **not** checked (their catalog keys are not on main yet).

**Shrink-only allowlist, as committed in Batch 1.** Each entry carries its reason string. Expected contents, from this tree's catalog and tiles: `org_portal.giving`, `tile:giving`, `tile:giving-admin` (treasurer pages deferred, Phase 1 Q5); `org_portal.mail_domain` (church email domains are not built; Track F Increment 2); `org_portal.sensitive_info`, `org_portal.parishes`, `tile:groups`, `tile:staff` (shipped, no page yet; the first follow-up documentation pass writes them and shrinks this list); `tile:credentials`, `tile:oversight`, `tile:reports`, `tile:filings`, `tile:committees` (presbytery surfaces and a flag that is off in production: Phase 1 Q6); `tile:worship`, `tile:insights`, `tile:communications` (coming-soon stubs, never documented). The tickets tile is covered by `getting-help`; the calendar, Community, Directory, Roles, Officers, Features, Branding, Events and Job-openings tiles by the pages in the list below. Phase 4 computes the exact list from the live files, records it in its section, and the count it records becomes the pinned number.

### The TODO token grammar (F349), pinned by fixtures

`docs/TODO.md` is read as lines. A token is the exact text `[help:<token>]`. Let `D` be the line index of the heading line exactly `## Done`.

- **Done** = a line that starts `- [x]` and lies after `D`.
- **Open** = a line that starts `- [ ]`, lies before `D`, and does not contain the word `declined` (case-insensitive).
- **Declined** = a line that starts `- [ ]`, lies before `D`, and contains `declined`.
- Anything else carrying a token (a `- [x]` before `D`, a `- [ ]` after `D`, a token on a non-list line) is **ambiguous** and fails with the line number.
- A token must occur **exactly once in the whole file**; zero or two fails (H12 d).

| # | Fixture | Expected |
|---|---|---|
| 1 | `- [ ] … [help:x]` above `## Done` | open |
| 2 | `- [x] … [help:x]` below `## Done` | done |
| 3 | `- [x] … [help:x]` in "In Flight" above `## Done` | ambiguous (names the line) |
| 4 | `- [ ] … [help:x]` below `## Done` | ambiguous |
| 5 | `- [ ] … declined … [help:x]` above `## Done` | declined (fails pending, planned, requires) |
| 6 | token absent | missing |
| 7 | token on two lines | duplicate |
| 8 | token twice on one line | duplicate |
| 9 | `## Done` heading absent | the whole check fails ("cannot classify") |
| 10 | token on a prose paragraph line | ambiguous |
| 11a | published entry with `requires`, token line open | fail (a) |
| 11b | pending entry, token line done | fail (b), message "feature shipped: publish its page" |
| 11c | planned entry, token line done or declined | fail (c) |
| 11d | `limitationUntil` entry, token line done | fail (f) |
| 12 | a near-miss `[help: x]` or `[Help:x]` | not a token (does not satisfy the entry; the entry reports missing) |

**What the tripwires cannot see.** A behaviour change inside an existing feature that no label, toggle, tile or token reveals. That part is Workflow Rule 17 and the Phase 6 walk (the Phase 1 statement, kept).


## The screenshot capture project and its fail-closed guard (R5, R10, P3-14)

**Images in Increment 1:** seven, all of published pages, all from a fixture congregation, light scheme only, plain `<img>` with the PNG's own width and height (static import through `screenshots.ts`, never `public/`, which would answer `/help/<file>.png` on every host including a church's own domain).

| Id | Page that uses it | Capture (route, user, viewport) |
|---|---|---|
| `signin-form` | `signing-in` | `/signin`, signed out, 360 |
| `totp-boxes` | `using-your-code` | `/totp`, an MFA-enrolled fixture user after the password step, 360 (element: the six boxes and the Verify and recovery controls) |
| `portal-tiles` | `first-day-as-administrator` | `/o/<fixture>`, the founding-administrator fixture, 360 (element: the tile grid, **not** the time-aware greeting) |
| `admin-hub` | `first-day-as-administrator` | `/o/<fixture>/admin`, same user, 1280 |
| `features-list` | `turning-features-on-and-off` | `/o/<fixture>/admin/features`, same user, 360 |
| `community-list` | `adding-people` | `/o/<fixture>/admin/community`, same user, 360 |
| `calendar-month` | `events-and-the-calendar` | `/o/<fixture>/calendar`, same user, 360 (list view) |

- **Project.** `playwright.config.ts` gains `isHelpShotsRun = process.env.PW_HELP_SHOTS === "1"` (an environment variable, not argv, for the reason the `visual` project's comment gives), throws if it is combined with `PW_VISUAL` or `PW_PROD_BUILD`, and appends a `help-shots` project (`testMatch: /help-shots\/capture\.spec\.ts$/`) only when it is true. The `chromium` project's `testIgnore` gains `/help-shots\//`, so a bare `playwright test` never runs it. `package.json`: `"help:shots": "PW_HELP_SHOTS=1 playwright test --project=help-shots"`, run as `E2E_BASE_URL=http://localhost:3660 npm run help:shots` on the pipeline's own server (the dev-port guard refuses `:3000` from a worktree). Never part of CI.
- **Guard.** `test.beforeAll` runs `assertFixtureOnlyDatabase()` (`e2e/help-shots/guard.ts`, a thin owner-connection reader) before any navigation; the decision is a pure function, `src/lib/help/shots-guard.ts`, unit-tested with fixtures. It refuses (throws, naming the rule and **counts only, never a value**) when: **(G1)** any `organizations.slug` is outside `fixture-slugs` (the slugs `scripts/seed-dev.sql` and `e2e/support/seed-orgs.ts` insert; a unit test reads both files as text and fails when a slug they insert is missing from the list); **(G2)** any `organization_profiles` row belongs to an organization outside it, or carries an email not ending `.invalid`, a phone not containing `555`, or a website host not ending `.invalid`; **(G3)** any `users.email` or active `contact_methods` email does not end `.invalid`; **(G4)** the `DATABASE_URL` host the dev server will use differs from the host of the owner connection the spec reads (the guard must be reading the database the screenshots come from); **(G5)** `HELP_SHOTS_DB_OK=1` is not set (the operator or orchestrator attests the branch is fixture-only; the guard checks, it does not decide); **(G6)** any query throws. Branch lineage is not trusted (R10): the `development` branch holds one real organization profile row, so a branch descended from it fails G1 unless it was reset.
- **Database.** The orchestrator creates a Neon branch `pipeline-user-help-shots` and builds it from scratch with the `docs/testing.md` recipe (migrations from empty, `db:seed`, `scripts/seed-dev.sql`), then sets the capture environment in the worktree's `.env.local`. The `pipeline-user-help` branch is for the dev server of the other batches and is never used for capture. Flags during capture are set through `e2e/support/flags.ts` (`captureFlags`, restored) to the **production posture** recorded in the operator rulings: every `org_portal.*` flag on except `org_portal.filings` and `org_portal.statistical_publication`, `sites.public_render`, `sites.public_staff_directory`, `sites.public_committee_directory`, `ui.brand_theming`, `ui.branded_signin`, `platform.merged_home`, `auth.require_2fa` and `auth.local_login` on; the fixture congregation's per-org toggles set to the first live congregation's (calendar, careers, domains, giving, members create, parishes, public calendar, sensitive info on). This is a spec-level dependency, so **nothing is added to `scripts/ci/e2e-baseline-flags.sql`** (the spec sets what it needs).
- **Determinism and safety.** Fixture users only (`E2E_USERS`); the avatar menu is never in a shot; `colorScheme: "light"`, `reducedMotion: "reduce"`, `deviceScaleFactor: 2`; `nextjs-portal` and toasts hidden by an injected style; element screenshots only, and the spec asserts the element's text does not match `/Good (morning|afternoon|evening)/` and contains no `@` (so no email and no time-dependent greeting can be baked in). The spec writes `src/content/help/images/<id>.png` and then **fails if any data entry's `capturedIn` is not the current `package.json` version**, listing the ids to bump (P3-14).
- **Human review.** Every committed image is opened and read in Phase 5 for a real name, email, address, brand mark or tenant (`check:secrets` scans text, not pixels). It is a named line in QA's verdict.

## In-app links (R12, P3-9, P3-10)

All through `helpHref()` and the `HelpLink` component (`inline-flex min-h-11 items-center`, the standard link style, focus ring with a 2px offset, same tab). A test asserts every link resolves to a published slug or a declared anchor.

| Where | Link | Target | Viewer |
|---|---|---|---|
| Marketing home top bar (`src/app/page.tsx`) | Help | `/help` | anyone |
| Avatar menu (`avatar-menu.tsx`), after "Account" and "Give feedback", before the platform block | Help | `/help` | any signed-in person |
| `/signin`, under the form (always visible) | Help with signing in | `signing-in` | anyone |
| `/totp`, under the form | Help with two-factor sign-in | `using-your-code` | a signed-in person with an enrolment |
| `/access-pending`, above "Back to home" | Why can't I see this? | `why-cant-i-see-this#access-pending` | a signed-in account with no role |
| Six toggle-off states | How features are turned on | `turning-features-on-and-off` | any member who reaches the page |
| `/no-organization` | *deferred (P3-9)* | `why-cant-i-see-this#not-connected-to-a-congregation` and later `sign-in-invitations` | the commit that publishes `sign-in-invitations` adds it |
| `/invite` | *deferred (P3-9)* | `accepting-your-invitation` | the commit that publishes it adds it, with `rel="noreferrer"` (belt and braces; `/invite` already sends `Referrer-Policy: no-referrer`) |
| Email templates | *deferred (Phase 1 Gap 9)*: an email lives forever and its URLs are a promise | none | not in Increment 1 |

Because `/signin` and `/totp` are `(auth)` pages and the proxy changes, the MFA gate below applies. The avatar menu is shared by the org layout, `/home` and the console header (`console-header.tsx`), so "Help" also appears in the platform console's menu; that is accepted (platform staff are also people who sign in).

## The home page change (R13, operator ruling Q7)

`src/app/page.tsx`: add a "Help" link to the top bar and replace "Pre-release. Nothing here is a live congregation." with "PresbyPortal is in early release." At 360px the signed-in bar is the worst case (wordmark, Help, Continue, Sign out): the header row is `flex-wrap` with `gap-x-3 gap-y-2`, so the actions drop to a second line rather than overflow; ux-developer measures signed-out and signed-in at 360 and 375 and records both. `src/app/page.test.tsx`: the test "keeps the honest pre-release note" (`:157-165`) becomes "says PresbyPortal is in early release" with the exact new text and a `queryByText(/pre-release/i)` null assertion, and gains: signed out and signed in each show a "Help" link whose `href` is `/help`; the existing Sign in, Continue and Sign out assertions are unchanged. The file header comment item 5 is updated.

## Existing tests and specs this change alters (the e2e and unit blast radius)

Found by grep against this tree; each is a **modify** in Batch 3, not a surprise for Phase 5.

| File | Assertion | Change |
|---|---|---|
| `src/app/page.test.tsx:157-165` | pins "Pre-release. Nothing here is a live congregation." | new text; new Help-link cases |
| `src/components/shared/avatar-menu.test.tsx:134-144, 181-187, 199-201, 227-234` | exact menu-item lists (`["Account", "Sign out"]` and the platform and feedback variants) | each list gains "Help" in its position (after Account and Give feedback, before the platform items) |
| `e2e/header-controls.spec.ts:317-322` ("sees only Account and Sign out") | `expect(labels).toEqual(["Account", "Sign out"])` | `["Account", "Help", "Sign out"]` and the test is renamed |
| `src/components/shared/global-nav.test.tsx` | asserts named menu items, not whole lists | none expected; run |
| `e2e/member-home.spec.ts:76-115` | named menu items | none expected; run |
| `src/proxy.test.ts` | no existing assertion about `/help` | additions only |
| `e2e/custom-domains/lockdown.spec.ts` `PLATFORM_PATHS` | the platform-route matrix | add `/help`, `/help/signing-in`, `/help/planned`, `/help/contact`, `/docs`, `/docs/x` (Architect: both lanes; the file already runs in `chromium`-excluded `custom-hosts` and in `prod-custom-hosts`) |
| The six `*-states` tests | text assertions on the toggle-off sentence | add a link case; grep for exact-container matches first (unverified) |
| `src/components/ui/table.test.tsx` | the primitive's output | one added case (`containerProps`), existing cases unchanged |
| `scripts/check-proxy-imports.test.mjs` | the proxy walker | unchanged and must pass after the lift (P3-3) |
| `npm run check` count | "eight tripwires" in CLAUDE.md prose | nine (orchestrator, integration) |

**Flags every new or changed spec depends on:** the new help specs depend on **none** (the routes are flagless, and the specs read no flag). `header-controls.spec.ts` keeps the flags it already sets for itself. `help-shots/capture.spec.ts` sets its own production-posture flags through `captureFlags()`. `scripts/ci/e2e-baseline-flags.sql` gains nothing.

## New e2e specs and the auth-touching gate (CLAUDE.md Phase 4 gate)

The diff edits `src/proxy.ts`, `src/app/(auth)/signin/page.tsx` and `src/app/(auth)/totp/page.tsx`, so a **running-server e2e smoke that covers the full login path, including an MFA-enrolled seeded user, is required before Phase 5 can begin**, and QA without it is **BLOCKED, not PASS**. The implementer runs it on its own server (`next dev -p 3660` from the worktree with `.env.local` on `pipeline-user-help`, stopped by PID; never `:3000`; `RATE_LIMIT_DISABLED=true`), and QA repeats the scope below.

1. **Auth path, unchanged behaviour, pinned:** `totp-full-login.spec.ts` (password, TOTP, landing, with the `mfa-enrolled` user), `totp-recovery-code.spec.ts`, `totp-code-entry.spec.ts`, `totp-callback-bypass.spec.ts`, `session-claim-integrity.spec.ts`, `branded-signin.spec.ts`, `post-login-routing.spec.ts`, `developer-2fa-gate.spec.ts`, `admin-login.spec.ts`, `member-home.spec.ts`, `header-controls.spec.ts` (changed), `invitation-new-account.spec.ts` (a new account enrolling through the real `/account/2fa`).
2. **New `e2e/help.spec.ts`** (no flag, signed out, desktop and 360): `/help` renders with no redirect, one `<h1>`, the skip link, `meta name="robots"` noindex; each published page responds 200, has exactly one `<h1>`, the on-this-page list works with JavaScript held (it is a `<details>`), and at 360px has no horizontal overflow (`scrollWidth <= clientWidth` on the document) and every tap target in the page chrome is at least 44px tall; an **unknown** slug, a slug read from the registry's **pending** entries (when any exist), `/help/planned/no-such` and a deeper path (`/help/no-such-page/deeper`) each return **status 404**, render **the help 404** (the heading "We couldn't find that page" and the "Go to the help index" link, through the `help/[...unmatched]` catch-all, architect ruling after Batch 3) with the same body, and **no redirect to `/signin`**; `e2e/help-404.spec.ts` (both lanes) adds `no-store`, no `s-maxage` and no `x-nextjs-cache` on two requests each; `/help/planned` shows the fixed label text on each entry and each planned page has a robots noindex meta tag; `/help?next=//evil.example` and `/help?callbackUrl=…` render the index and reflect nothing (no open redirect, Phase 1 adversarial).
3. **New `e2e/help-gates.spec.ts`** (the proxy gate at the browser level): a signed-in `mfa-enrolled` user whose session is not 2FA-verified reaches `/help/signing-in` (200, no `/totp` hop) while `/o/<slug>` still sends them to `/totp`; `/helpx` redirects an anonymous visitor to `/signin`; the Help link in the avatar menu opens `/help`; `/signin` and `/totp` show their help links and the links work.
4. **Custom-host lockdown** (both lanes, `custom-hosts` and `prod-custom-hosts`): the six added paths are the neutral 404 with no `Set-Cookie` and no `location`.
5. **Production-build lane** (`npm run test:e2e:prod`, port 3661): the hydration specs and `prod-custom-hosts` pass; `next build` must list the help routes as static, which QA reads from the build output. There is **no hydration spec for help**: no form and no `useForm` exist under `(documentation)`, and `check:hydration-gate` is unaffected.
6. Before the e2e run QA resets global flags to the CI baseline (`scripts/ci/e2e-reset-flags.sql`) and says so.


## Page list, status and tokens

**Status key.** *published*: ships in Increment 1. *pending*: written in Increment 1 against an in-flight pipeline's Phase 3 design and Phase 6 record, never rendered until its token's TODO line is Done on `main` (R6), and published by the integration commit that moves that line. *planned*: a labelled placeholder (list below, awaiting the operator). `verifiedIn` is the release the author re-walked the page against; `null` while pending. Titles and summaries are final Copy (they are strings): the index shows both.

| # | Slug | Audience (order) | Status, token | Title | Summary |
|---|---|---|---|---|---|
| 1 | `what-presbyportal-does` | prospective (10) | published | What PresbyPortal does today | What a congregation can do with PresbyPortal now, and where the things it does not do are listed. |
| 2 | `how-a-congregation-gets-started` | prospective (20) | published; `limitationUntil: signin-invites` | How a congregation gets started | There is no sign-up form. Here is how a congregation and its first administrator are set up. |
| 3 | `signing-in` | everyone (10) | published | Signing in | Sign in with Google or with your email and password, and what to do when that does not work. |
| 4 | `accepting-your-invitation` | everyone (12) | **pending**, `recovery-codes` | Accepting your invitation | Open the link in your email, create your account or sign in, and set up two-factor sign-in. |
| 5 | `using-your-code` | everyone (20) | published | Using your code to sign in | Enter the code from your authenticator app, use a recovery code, and what to do if you lose your phone. |
| 6 | `setting-up-two-factor` | everyone (22) | **pending**, `recovery-codes` | Setting up two-factor sign-in | Link your authenticator app, save your recovery codes, and make new ones. |
| 7 | `who-is-asked-for-a-code` | everyone (25) | **pending**, `two-factor-by-role` | Who is asked for a code | Which accounts must use two-factor sign-in, and why. |
| 8 | `your-account` | everyone (30) | published | Your account | Change your name, your email address or your password. |
| 9 | `home-and-switching-congregations` | everyone (40) | published | Your home page and switching congregations | Where you land after signing in, and how to move between congregations. |
| 10 | `why-cant-i-see-this` | everyone (50) | published; `limitationUntil: signin-invites` | Why can't I see this? | Pages, buttons and congregations that are missing, and who can fix each one. |
| 11 | `using-the-directory` | everyone (60) | published; `limitationUntil: person-photos` | Using the directory | Search the directory, read a household, and who to ask to change an entry. |
| 12 | `reimbursements` | everyone (65) | **pending**, `reimbursements` | Asking to be reimbursed | Ask your congregation to pay you back, and follow the request to the end. |
| 13 | `getting-help` | everyone (70) | published | Getting help | How to ask a question, report a problem or send feedback. |
| 14 | `first-day-as-administrator` | administrator (10) | published | Your first day as an administrator | Where you land, what you can do yourself, and a sensible order for setting up. |
| 15 | `turning-features-on-and-off` | administrator (20), `overview` | published | Turning features on and off | What the Features page does, which features start on, and which ones we turn on for you. |
| 16 | `adding-people` | administrator (30) | published; `limitationUntil: signin-invites` | Adding people and recording members | Add a visitor, a participant or a member, and follow a member through approval. |
| 17 | `sign-in-invitations` | administrator (35) | **pending**, `signin-invites` | Inviting people to sign in | Invite a person you have recorded, and how a person connects their sign-in to their record. |
| 18 | `officers-and-the-session` | administrator (40) | published; `limitationUntil: signin-invites` | Officers and the Session | Record officer terms, and why the Session must be recorded before anyone can approve members. |
| 19 | `roles-who-can-do-what` | administrator (50) | published | Roles: who can do what | Give and take away roles, and what a founding administrator can and cannot do. |
| 20 | `events-and-the-calendar` | administrator (60) | published | Events and the calendar | Add events, series and types, and show chosen events on your public website. |
| 21 | `your-congregations-website` | administrator (70) | published | Your congregation's website | What you change in PresbyPortal, what whoever maintains your website changes, and job openings. |
| 22 | `photos-of-people` | administrator (75) | **pending**, `person-photos` | Photos of people | Add photos to a person's record and choose where each one shows. |
| 23 | `reimbursements-for-treasurers` | treasurer (10) | **pending**, `reimbursements` | Reimbursements for approvers and treasurers | Approve, send back, and record payment of a reimbursement. |

Not written in Increment 1, by decision: treasurer and giving pages (P3-12); presbytery and synod pages (Q6); `sensitive info`, `groups`, `staff`, `parishes` (the shrink-only allowlist, with a follow-up pass owed); a search box, translations, video, a print stylesheet, email-template links.

### Per-page outline and the shipped facts it rests on

The implementer drafts the prose (Batch 5) from this outline, the cited sources and the **walk** (below), in plain language at about grade 8, present tense, no future tense, no permission keys in reader text, labels exactly as the screen spells them, steps as `ol`. **No page is written from the code alone**: each is checked on a running server as the person it addresses. Every administrator page begins with the Needs block (Copy C1). Sources are paths in this tree unless marked *(pipeline)*.

**Published, prospective**

1. `what-presbyportal-does`. *Outline:* What PresbyPortal is; What a congregation can do today (one line each, each linking to its page: people and the roll, the directory, officers and the Session, groups and committees, roles, events and the calendar, the public website and public calendar, job openings); Who it is for (written for congregations; presbytery and synod tools exist and are not described here); What it does not do (one sentence and a link to `/help/planned`; **no list** that would drift from the placeholders). *Facts:* `docs/product/functionality-map.md` ("presby: NOT built"), `src/app/page.tsx`. Does not list giving, reimbursements or photos (unverified in production or not shipped). *covers:* none. Read by the analyst as a prospective congregation.
2. `how-a-congregation-gets-started`. *Outline:* There is no sign-up form; The PresbyPortal team creates the congregation and invites its first administrator by email; What the invitation is (a link that works once, to the address it was sent to; create an account or sign in; set up two-factor sign-in when asked); Then the administrator turns on features and records people (links); If you want to ask about PresbyPortal for your congregation (O2). *Facts:* `docs/product/functionality-map.md` (founding administrator DECISION-155; invitations v0.37.0, `/invite`; `/no-organization`), `src/app/no-organization/page.tsx`. The sentence "signing in does not connect you to a congregation by itself; only an invitation does" is current behaviour that 2b changes, so it carries `limitationUntil: signin-invites`. Never names a congregation or counts congregations.
**Published, everyone**

3. `signing-in`. *Outline:* The two ways in; Signing in with email and password; Signing in with Google (**walk-dependent, O3**); If you forgot your password; If your account is locked (five wrong tries lock it for 15 minutes; the message never says which of email or password was wrong); If your account has been deactivated; After you sign in. *Facts:* `src/app/(auth)/signin/`, `src/lib/auth/lockout.ts`, `(password-reset)/`, DECISION-246 (a provider email the provider has not verified is refused). *labels:* "Sign in with Google", "Sign in with email", "Forgot password?", "Wrong email or password.", "This account has been deactivated. Contact an administrator." *Image:* `signin-form`.
5. `using-your-code`. *Outline:* When you see this page; Entering your code (six boxes, the sixth digit checks it, Verify is the fallback); Using a recovery code ("Use a recovery code instead"; each works once); A trusted device (what it does; for how long: read from `totp/actions.ts`); If you lose your phone and your codes (there is no way to reset it yourself today; `{{contact}}`); Whether you are asked at all depends on your account, your role and your congregation (rule-neutral, P3-11). *Facts:* `src/app/(auth)/totp/`, `docs/ui-standards.md` one-time-code input, `docs/product/functionality-map.md` TOTP verify. *labels:* "Two-factor authentication", "Verify", "Recovery code", "Use a recovery code instead", "Use my authenticator app instead", "That code didn't match. Try again, or use a recovery code." *Image:* `totp-boxes`. Does not describe enrolment or regenerating codes (pending pages, F166).
8. `your-account`. *Outline:* Account settings and its sections (Profile, Email address, Password, Two-factor authentication, Send feedback); Changing your email address (a message to the new address must be confirmed); Changing your password (only where the account has one); where two-factor lives (named, **not linked** until `setting-up-two-factor` publishes; R12). *Facts:* `src/app/(account)/account/page.tsx` and its forms. Does not describe the delete control. *labels:* "Account settings", "Profile", "Email address", "Password", "Two-factor authentication".
9. `home-and-switching-congregations`. *Outline:* After you sign in (one congregation goes straight there; more than one, or platform staff, land on Home); Your home page ("Welcome, {name}.", "Your organizations", the what's-new card, the feedback prompt); A congregation that is still being set up; Switching congregations (the switcher in the header); Signing out. *Facts:* `src/app/launch/destination.ts` (the matrix), `(member)/home/page.tsx`, `src/components/shared/org-switcher.tsx`; the sign-out landing is stated **only if the walk shows it**. *covers:* `route:/home`, `route:/launch`.
10. `why-cant-i-see-this`. *Outline (each H2 is a symptom, in the reader's words):* **Not connected to a congregation** (the `/no-organization` states: being set up, not on PresbyPortal yet, access ended, never connected; who to ask); **Access pending** (an account with no role; ask an administrator); **A page or button is missing** (a table: cause, how you tell, who fixes it: the feature is off for your congregation, an administrator turns it on in Features; your role does not include it, an administrator grants a role; it does not apply to your kind of congregation; it is one we turn on for you); **A congregation says you do not have access** (the one message you see whether or not that congregation uses PresbyPortal, so it tells you nothing about which). *Facts:* `src/app/no-organization/page.tsx`, `src/app/access-pending/page.tsx`, DECISION-040, `ORG_FEATURE_CATALOG` (names and org-type limits), `src/lib/org-portal/tiles.ts`. *anchors:* `not-connected-to-a-congregation`, `access-pending`. *covers:* `route:/no-organization`, `route:/access-pending`. The "only an invitation connects you" sentence carries `limitationUntil: signin-invites`.
11. `using-the-directory`. *Outline:* Finding a person (search matches a name and only the details a card shows; a hidden email or phone never matches); Households; A person's page; What you do not see and why (privacy settings hide fields; only people with a current connection are listed; visitors never appear); Changing an entry (not yourself: ask a church administrator or the church office, who edit it in Community). *Facts:* `src/lib/directory.ts`, `(org)/o/[slug]/directory/`, functionality map Directory (v2, email v0.42.0). Directory cards show initials only today: `limitationUntil: person-photos`. *covers:* `tile:directory`. *labels:* "Directory", "Households".
13. `getting-help`. *Outline:* Ask the person who invited you (`{{contact}}`); Send feedback (the "Give feedback" item in the account menu, inside a congregation; the feedback card on Home; a person who files tickets can turn feedback into one); File a ticket (the Tickets tile: who can; what to put in it; attachments up to 10 MB, PNG, JPEG, WEBP or PDF); What to expect (we read every ticket; **no reply time is promised**). *Facts:* `src/lib/tickets.ts`, `(org)/o/[slug]/{tickets,feedback}/`, `src/components/shared/feedback-prompt-card.tsx`. *covers:* `tile:tickets`, `route:/feedback`. Increment 2 replaces `{{contact}}` with the form.

**Published, administrators.** *Needs block on each (Copy C1); the walk below precedes the prose.*

14. `first-day-as-administrator`. *Outline:* Where you land; The Administration area; What you can do yourself (a table built **only from the walk**: Community, Roles, Features, Officers, Groups, Staff, Job openings, Tickets, and for `Branding` and `Manage events` whatever the walk shows; the ones that need us say `{{contact}}`); Turn on what you need (the calendar starts on; the rest start off); A sensible order. *Facts:* `drizzle/0071_presby_careers.sql` (`presby_founding_administrator_permission_keys`: `people`, `roles`, `role_grants`, `groups`, `officers`, `org_features.manage`, `tickets.file`, `staff`, `domains`, `careers.manage`, `careers.applicants`), `docs/product/functionality-map.md` Organization Administration hub (`org_portal.admin_hub`), the production posture (operator rulings). *Images:* `portal-tiles`, `admin-hub`. *covers:* `route:/o/{slug}`, `route:/o/{slug}/admin`.
15. `turning-features-on-and-off` (`overview`). *Outline:* The Features page; Features that start on and off (a table: name exactly as the page spells it, what it does in one line, whether it starts on, which kinds of organization it applies to); Features we turn on for you; Choosing which ministry areas apply (the category picker); What turning one off does (it hides pages and keeps the data). *Facts:* `ORG_FEATURE_CATALOG` (names, defaults, `orgTypes`, `operatorEnabled`), `src/lib/org-features.ts`, `org-feature-categories.ts`, `(org)/o/[slug]/admin/features/`. Every toggle name in the table is in `labels` and pinned to the catalog by `coverage.test.ts`. *Image:* `features-list`. Mentions "Email from your domain" only if the walk shows administrators see it, and then only as "we turn this on for you".
16. `adding-people`. *Outline:* The Community page and its views (Everyone, Members, Participants, Visitors, Staff, Former); Adding a person (the Connection step: Visitor, Participant, Member; the "already here" step); Recording a participant, removing one, undoing; Recording a member (waits for the Session); Pending approvals (what approvers do: approve, deny with a reason, bulk approve up to 50; what proposers do: withdraw; "Recently decided"); What the banner on Pending approvals means (the six states and the next step for each); Email addresses on a person. *Facts:* functionality map Community (v0.39.0, v0.41.0, v0.42.0), the shipped strings in `src/app/(org)/o/[slug]/admin/community/**`, `src/lib/session-approval-state.ts`. "A member of the Session needs a PresbyPortal account to approve" is a current limit: `limitationUntil: signin-invites`. *covers:* `org_portal.members_create`, `tile:members`. *Image:* `community-list`.
18. `officers-and-the-session`. *Outline:* Recording an officer term (office, person, dates; a deacon's district); Ending one (terms end, never delete); The roster and a person's history; The Session roster is built from terms; Pastors on the Session (an installed pastor, co-pastor or associate pastor counts; a pastor-office holder cannot be on the roll); Why Pending approvals says no one can approve yet; Recording yourself (allowed, and marked as self-recorded). *Facts:* `src/lib/officers.ts`, `officer-offices.ts`, DECISION-199, 202, 205, 206. `limitationUntil: signin-invites`. *covers:* `tile:officers`.
19. `roles-who-can-do-what`. *Outline:* What a role is; Giving a role and taking it away; Creating and editing a role (tier-grouped checklist; stock templates; deactivating); What you can give (only what you hold; you cannot lock yourself out); What a founding administrator can and cannot do (from the walk and the bundle); Roles that come from a seat (the Session). *Facts:* `src/lib/role-grants.ts`, `role-definitions.ts`, `authz.ts` (`assertPermissionSubset`), DECISION-066, 106, 109, 155, 199, 202. *covers:* `tile:roles`.
20. `events-and-the-calendar`. *Outline:* The calendar every member sees; Adding an event; A repeating series (weekly or monthly by weekday, up to 52 occurrences; edits extend forward, never rewrite); Event types; "Open to everyone, not only members" versus "Show on our website's public calendar"; Turning on the public calendar and why you may still see nothing (whoever maintains your website must place the calendar on a page). *Facts:* functionality map Member calendar, Events administration, Event types, Public events calendar (v0.32.0, v0.44.0), `org-features.ts` (calendar on by default; public calendar off, self-service). Who holds `events.manage` is from the walk. *covers:* `org_portal.calendar`, `org_portal.public_calendar`, `tile:calendar`, `tile:events`. *Image:* `calendar-month`.
21. `your-congregations-website`. *Outline:* What you change in PresbyPortal (colours, logo and type under Branding; job openings; the public calendar; "show on the website" for staff, officers and committee members); What whoever maintains your website changes (page text, images, menus, and placing the calendar and job-opening blocks on a page; **it is not edited in the portal**); Job openings (turn on, write, publish, close; the public list and posting pages); A web address of your own (not self-service: `{{contact}}`). *Facts:* `docs/product/functionality-map.md` Public websites (P3), Careers (v0.47.0), Tenant branding, `src/lib/sites-ingest-auth.ts` (only operator-provisioned repositories publish; not stated in user terms), the operator rulings (no custom-domain row is live). Describes giving pages and photos **not at all**. *covers:* `tile:branding`, `org_portal.careers`, `tile:careers`, `org_portal.domains`, `tile:domains`.

**Pending (written now, rendered at publish).** Each is drafted by Batch 5c from the named record and re-checked line by line against the feature's *final* strings at the publishing commit (the `labels` check bites then, R6). Facts below are from the pipeline records read for this design.

4. `accepting-your-invitation` (`recovery-codes`; F166 Phase 6 SHIP IT). *Outline:* The email; The link (works once, expires, shows only a masked address); New account (first name, last name, password) or existing account (sign in, then Accept); If the link is no good (one identical page, never why); Setting up two-factor sign-in (links to #6); Where you land. *Facts (pipeline):* `docs/work-log/2026-10-21-invitations.md` v0.37.0; F166's enrolment fix. Adds the `/invite` in-app link at publish (P3-9).
6. `setting-up-two-factor` (`recovery-codes`). *Outline:* Linking your authenticator app (QR, the six boxes); Your ten recovery codes (shown once; keep them; reloading or leaving does not show them again); Continue; If you lose them (make a new set after confirming it's you with your app or a recovery code). *Facts (pipeline):* `presby-f166` Copy C1 to C12; DECISION-292. Removes any caveat the published pages carry (there is none by design: `using-your-code` does not describe enrolment).
7. `who-is-asked-for-a-code` (`two-factor-by-role`). *Outline:* The rule in one paragraph; Your own account setting; Your role (giving, creating roles, giving roles, website addresses); Your congregation's policy; New accounts are not asked just for existing; Setting it up on your own does not start asking you at sign-in. *Facts (pipeline):* `presby-2fa` Phase 3 (DECISION-291, migration 0080, release note S8). The deploy-day numbers in its note are not copied.
12. `reimbursements`. *Outline:* Who can ask (members, regular attenders, staff); Making a request (purpose, amounts, receipts kept private); Sending it; Approval (a chair or leader of the group it is charged to; sent back, not approved); Payment; Withdrawing. *Facts (pipeline):* `presby-treasury` Phase 3 (Copy C2 to C6, P3 permissions), Phase 6 SHIP WITH NOTES. Toggle "Reimbursements", off by default, congregations and new worshiping communities. It does not move money.
17. `sign-in-invitations`. *Outline:* Inviting a person (the "Sign in to PresbyPortal" card on their page, the address it goes to, send, send again after five minutes, cancel); What the person sees (accept as a new account, or accept in place from "You're not connected"); Signing in with the address on file connects some people automatically (not visitors, shared addresses, or people at more than one congregation); Elders and others who hold a role or seat connect after confirming two-factor sign-in and "Check again"; Session members and approval. *Facts (pipeline):* `presby-2b` Phase 6 and the 0.48.0 release note. Adds the `/no-organization` in-app link and removes the three `limitationUntil` sentences at publish.
22. `photos-of-people`. *Outline:* Turning it on ("Photos of people"); Adding photos (up to ten, adults only); The directory photo and the website photo; Who is never shown (hidden photo, under 18, merged record); Removing a photo; Turning it off. *Facts (pipeline):* `presby-photos` Phase 3 (Copy C1 to C8). Removes the `limitationUntil: person-photos` sentence from #11.
23. `reimbursements-for-treasurers`. *Outline:* The treasurer view; Approving, sending back; Recording a payment, reversing one, waiving a receipt; The team; Closing. *Facts (pipeline):* `presby-treasury` Phase 3 (Copy C7 to C9). Audience group "Treasurers" appears on the index only when it has a published page.

### The role walk and the production-truth walk (precondition for Batch 5b)

Phase 6's rule applies to documentation as to code: the administrator pages are written from the screens of the person each path creates, **not** from a fixture and not from `development`. Before Batch 5b writes prose, the Batch 5b implementer, on its own dev server at 360px with the production flag posture set through `captureFlags()` (the list above):

1. creates a congregation through `/admin/organizations/new`, designates a founding administrator by email, accepts as a **new account** through the real `/invite` link (enrolling two-factor on the way, as it works today), and lands as that person;
2. records, for each administrator page, exactly which tiles and links that person sees with **only** the per-org toggles the page's Needs block says to turn on, and whether `Branding` and `Manage events` appear and who can grant them (the Addendum A caveat: the founding-administrator bundle does not contain `branding.manage` or `events.manage`; the role-subset check may stop the administrator granting them);
3. records the same for a plain member of that congregation (what the second table of `why-cant-i-see-this` rests on);
4. records the result in the work-log's Phase 4 section as "page, fact, how verified"; a claim with no line there is not written.

Batch 5a's pages 9 and 10 are walked earlier, with the existing `org-single`, `org-unmanaged` and `org-ended` fixture users and a member who lacks a tile, because `/access-pending` links to page 10 in Batch 3; if the Batch 5b walk contradicts a sentence in page 10, Batch 5b edits it. The analyst's Phase 6 repeats the walk for every published page.


## The placeholder list: **awaiting operator approval**

Operator ruling (2026-10-26): placeholders are for "bigger features that are in our backlog" that are **not** in a pipeline today; features in a pipeline get real pages (above). The list is proposed from `docs/TODO.md`. **Phase 4 (Batch 5c) writes none of these until the operator approves, strikes or edits each line.** Each is a `planned` registry entry (no markdown file), rendered by `planned-placeholder.tsx` with the fixed label "Planned. Not available yet. There is no date." It states the feature's name, who it is for and a "Today:" line, and nothing else: no screens, no buttons, no steps, no dates, no priority order (the page lists them in the order below, which is by area, not by priority). Each slug **is** its `[help:<slug>]` token, placed on exactly one open `- [ ]` line (the orchestrator appends the token to the line named here at Batch 0). When the feature ships, its line moves to Done, `check:help` fails until the placeholder is removed and the real page written (H12 c), and the real page's `replaces` redirects the planned URL (P3-7).

| # | Slug (= token) | Name (shown) | Who it is for | "Today:" line (final Copy once approved) | TODO line the token goes on | Why it qualifies |
|---|---|---|---|---|---|---|
| 1 | `ledger` | Accounting books | Congregations and their treasurers | PresbyPortal does not keep a general ledger, budgets or bank reconciliation. Keep your books where you keep them now. | "Track E — finance (POST-CUTOVER, new product)" | The largest named gap; the functionality map's "NOT built" lists it; "Ledger (fund accounting)" is also open under Not designed yet |
| 2 | `worship-planning` | Worship and service planning | Congregations | There is no worship planning tool. You can put services on the calendar as events. | "Worship planning and check-in — not designed" | "NOT built" lists worship; the portal has a coming-soon stub for it that must never be documented as a feature |
| 3 | `children-check-in` | Children's check-in and check-out | Congregations with a children's program | There is no check-in or check-out. Keep using the process you use now. | "Children's ministry Increment C — check-in/check-out" | Unblocked and queued behind its own Phase 1; "NOT built" lists check-in |
| 4 | `communications` | Email lists and communications | Congregations and presbyteries | PresbyPortal sends the emails its own features need, such as invitations and password resets. It does not send newsletters or group email. | "Track H — mailchimp sync" | The communications tile is a coming-soon stub; this is the user-visible face of Tracks H and D |
| 5 | `event-sign-ups` | Event sign-ups | Congregations | Events do not take sign-ups. Collect them the way you do now. | "Track A — event sign-ups. PRE-CUTOVER" | Operator-ruled pre-cutover in use at the first customer; needs its own Phase 1 |
| 6 | `meeting-minutes` | Meeting minutes and dockets | Sessions and other governing bodies | PresbyPortal does not keep minutes or dockets. A roll action can carry a minute reference you type in. | "Session (and other governing-body) meeting minutes/dockets — no module exists" | Named in `docs/schema-design.md` D3 as real, deliberately deferred work |
| 7 | `directory-export` | Directory printing and export | Congregations | There is no directory export (PDF or contact file) and no print layout. | "Directory export/output capabilities are missing entirely" | A real, repeatedly asked-for gap with a recorded permission design |
| 8 | `presbytery-tools` | Presbytery committees and commissions | Presbyteries | Presbyteries can record ministerial credentials, oversight and statistics where those features are turned on. There is no committees-and-commissions module. | "POSSIBLE FIRST GO-LIVE: Track P — presbytery" | **Optional (O1):** the operator named "presbytery and synod surfaces", but Phase 1 Q6 said help is written for congregations |

`confirmedOn` for every entry is the date the operator approves it. The monthly documentation review re-asks "still planned?" and moves `confirmedOn` (Rule 17).

**Considered and not proposed** (so the operator can overrule): *a general importer* (the operator named "importer", but the TODO's Track K line records "no general importer, by decision"; a placeholder would contradict a recorded decision; the Track K cutover import is tenant-specific, and Addendum A forbids a placeholder that describes one tenant's work); *online job applications* (queued as Track L Increment 2 with numbers already assigned, so a feature with a pipeline; the website page says nothing about applications, so it cannot go stale); *Google Workspace sync* (Track D, folded into row 4's wording only as "group email"); *youth ministry* (Track G, a children's-ministry reconciliation first); *the white-binder kiosk* (Track I, last before go-live); *worship insights and talents* (Track J, post-cutover and not asked for); *a public API* (ruled not planned; the "no public API" statement lives in the `/docs` increment).

**Shape rules the check enforces for these entries** (H1, H12): a planned entry has no file; its `today` and `forWhom` strings are in the Copy table below once approved and are checked for the four Copy properties; planned entries never count as coverage (P3-16); their pages carry `robots: { index: false, follow: false }` permanently, so no search result is ever a how-to for something that does not exist; they appear only under `/help/planned`, never inline in numbered steps, and the marketing home does not link to them.


## Copy

Every user-facing string Increment 1 adds or changes, except the page prose (see C6). **An implementer who needs a string that is not here, and is not covered by C6, stops for a ruling.** Strings in `src/lib/help/copy.ts` (pure) unless a row says otherwise; `{x}` is filled from the source named in the check.

### C1. Chrome: layout, index, page, Needs block, not-found, placeholders

| String | Where |
|---|---|
| "Skip to main content" | skip link (the console shell's own wording) |
| "PresbyPortal" (aria-label, links `/`) | header wordmark |
| "Help" / "Sign in" / "Open PresbyPortal" | header links (to `/help`, `/signin`, `/launch`) |
| **Index.** h1 "Help"; "Plain-language guides for the people who use PresbyPortal. They are written for congregations."; "If a screen looks different from what you read here, tell the person who invited you." | `help/page.tsx` |
| Group headings: "Thinking about PresbyPortal", "Everyone who signs in", "Church administrators", "Treasurers" (a group with no published page is omitted) | index |
| Link "Planned and not available yet" with the line "Things PresbyPortal does not do yet." | index, last |
| **Page.** Breadcrumb (aria-label "Breadcrumb") "Help"; "On this page" (the `<details>` summary, shown when a page has three or more h2 or h3); "Last checked against release {version}."; "Previous: {title}"; "Next: {title}"; "Back to the help index"; "Open PresbyPortal" | page chrome |
| aria-label "Table. Scroll sideways to see all of it." | focusable table region |
| " (opens in a new tab)" (visually hidden) | external-link cue |
| **Not found.** h1 "We couldn't find that page"; "The link may be old or mistyped."; link "Go to the help index" | `help/not-found.tsx` |
| **Planned.** h1 "Planned and not available yet"; "These are things PresbyPortal does not do yet. Being listed here is not a promise and has no date."; label "Planned. Not available yet. There is no date."; "Who it is for: {forWhom}"; "Today: {today}"; tab title "{name} (planned, not available yet)"; link "All planned items"; empty state "Nothing is listed here right now." | `planned-placeholder.tsx`, `planned/page.tsx` |
| **Needs block.** Heading "What you need". Rows: **Who** `{who}`; **Turn on** `In Features, turn on "{name}". It is on by default.` or `It is off by default.`; **Applies to** `Any organization on PresbyPortal.` / `Congregations.` / `Congregations and new worshiping communities.` / `Presbyteries.`; **Switched on for you** (replaces "Turn on" when `operatorEnabled`) `The PresbyPortal team turns on "{name}" for you. {contact}` | `needs-block.tsx` |
| `{contact}` = "Ask the person who invited you." | `HELP_CONTACT_LINE`, the one place Increment 2 changes |

1. *Residuals.* Nothing here denies a Phase 2 ruling or an accepted residual: "Last checked against release" states a claim, not that the page is current; the placeholder label says "not a promise"; no string says content is indexed or searchable.
2. *Source of truth.* `{version}` is the entry's `verifiedIn`, a human claim bounded above by `package.json` (H13) and moved only by a walk; `{name}`, the default, "Applies to" and "Switched on for you" equal the catalog entry (`coverage.test.ts`); `{who}` is prose verified by the walk and has no permission key (H11); `{forWhom}` and `{today}` are the approved placeholder rows. "There is no sign-up form" is established by the absence of any such route and DECISION-155.
3. *Audience.* The chrome is read by anyone, signed in or not. "Sign in" and "Open PresbyPortal" are doable by anyone (`/launch` signs a signed-out reader in and returns them). "In Features, turn on…" is read by the page's administrator audience; the Who row names who that is, and a reader without the permission sees no Features tile and is told who to ask on `why-cant-i-see-this`. "tell the person who invited you" is doable by anyone with an account; a prospective reader has no inviter, which is why `how-a-congregation-gets-started` carries O2's line instead.
4. *Neighbours.* Grep of `src` for help, documentation, "pre-release", "ask an administrator", "contact", "support" in non-test files: the toggle-off states (`calendar-states.tsx:18`, `members-states.tsx:31`, `careers-states.tsx:26`, `giving-admin-states.tsx:55-58`, `parishes-states.tsx:20`, `domains-states.tsx:18-19`) get a link in C3 and their sentences stay true; `no-organization/page.tsx:176-183` ("Is your church not on PresbyPortal? … Read about PresbyPortal" to `/`) stays true and is **not** modified (2b rewrites the file; P3-9); `access-pending/page.tsx:31-32` stays true. No existing string promises a help site.

### C2. The home page

"Help" (top-bar link) and "PresbyPortal is in early release." (replaces `src/app/page.tsx:332`, "Pre-release. Nothing here is a live congregation.").

1. *Residuals.* "early release" does not claim launch, general availability or that indexing is on (the root layout stays `noindex`). It does not deny that the project is open source or that two congregations are live (the line it replaces became false when congregations went live).
2. *Source.* The operator's ruling of 2026-10-26 (Phase 1 Q7); no claim about a person, account, date or count.
3. *Audience.* Anyone; no instruction.
4. *Neighbours.* **Modify:** `src/app/page.tsx:332`; `src/app/page.test.tsx:20` (header item 5) and `:157-165`. Left, still true, and listed so the documentation review sees them: `src/app/layout.tsx:41` and `src/app/robots.ts:7` (comments about the noindex posture); `package.json` `description` ("Pre-release."; not shown to users); **`README.md:14-20` ("Status: pre-release … sign-in is currently gated off there … it serves public pages only") is already false against production (the operator signs in) and this feature did not make it so; recorded as F-new-6 for the documentation review.**

### C3. In-app link texts (table in "In-app links")

"Help" (home bar and avatar menu); "Help with signing in" (`/signin`); "Help with two-factor sign-in" (`/totp`); "Why can't I see this?" (`/access-pending`); "How features are turned on" (the six toggle-off states).

1. *Residuals.* None denied.
2. *Source.* Each text names the page it opens; the targets are published slugs (type-checked, R12), so no link names a page that is not live.
3. *Audience.* The viewers in the table; none needs a role; the toggle-off link is read by every member who reaches that sentence, and its target page tells a non-administrator who to ask.
4. *Neighbours.* Left true: `signin-credentials-form.tsx:98-101` "Forgot password?"; `totp-challenge-form.tsx:40`; the six toggle-off sentences; `access-pending/page.tsx:31-32`. `avatar-menu.test.tsx` and `e2e/header-controls.spec.ts:317-322` assert exact menu lists and are modify targets (blast radius above).

### C4. Titles and summaries (the table under "Page list")

Final for the 16 published pages; provisional for the 7 pending ones (re-read at publish against the feature's final strings).

1. *Residuals.* `how-a-congregation-gets-started` says "There is no sign-up form", which stays true after the contact form (a contact form is not a sign-up). `getting-help` promises no reply time. No summary denies a recorded residual.
2. *Source.* Each summary describes its own page; "no sign-up form" as in C1; "Pages, buttons and congregations that are missing" is what the page's four sections are; "what a founding administrator can and cannot do" is the walk's result and the bundle.
3. *Audience.* Each summary is shown in its audience's group; none gives an instruction a different audience would be unable to follow.
4. *Neighbours.* The summaries repeat nothing the UI says; `src/app/page.tsx` capability blurbs (Membership & records, Council operations, Events & support, Public websites) are consistent with `what-presbyportal-does` and not modified.

### C5. Placeholder rows (the eight in "The placeholder list"), once approved

1. *Residuals.* None denies an accepted residual or a ruling; each says what is **not** there and nothing about when.
2. *Source.* Ledger, worship, check-in, newsletters, sign-ups, minutes and export: `docs/product/functionality-map.md` "presby: NOT built" and the absence of any table or route for them (events carry the frozen six-column contract with no sign-up table; `roll_actions.minute_reference` is free text and the forms say "Minute reference (optional)"; the email registry `src/lib/contact-methods/email-audience.ts` lists no newsletter or group template). **"No print layout" (row 7) is read against `@media print` and `print:` in `(org)/o/[slug]/directory/` before approval; if one exists the line becomes "There is no directory export."** "You can put services on the calendar as events" is true of any event (row 2).
3. *Audience.* Public readers; the only instructions are "Keep your books where you keep them now", "Collect them the way you do now", "Keep using the process you use now", which anyone can follow.
4. *Neighbours.* The portal's coming-soon stubs (`src/components/org-portal/coming-soon.tsx:39`) say "isn't turned on for {orgName} yet" and are unchanged; none of those tiles is documented as a feature (allowlist reason).

### C6. Page prose and the copy-truthfulness duty for the help diff

The prose of the 23 pages is **not** written in this design (operator instruction); it is drafted in Batch 5 inside each page's outline, sources and walk. The four checks apply to it as to any string, and QA runs them on the help diff (`git diff -U0 origin/main... -- src/content/help src/lib/help`): (1) the page contains no promise that denies a residual; (2) every claim about a person, account, date or state traces to a line in the Phase 4 "page, fact, how verified" record or to a source cited in the outline; (3) every instruction names who can do it and that role can; (4) the neighbour grep for that page's subject is in the record, with the strings it finds. **An implementer who finds a claim the record cannot support deletes the claim; they do not reword it to sound safer.**


## Workflow Rule 17 and the edits the orchestrator applies at integration

Agents cannot edit `CLAUDE.md`, the skills, the agent files or the template without the operator's approval (Rule 16 and the standing instruction); the text below is exact, so it can be pasted. Rule 17's wording is operator question O5.

### 1. `CLAUDE.md`: Workflow Rule 17 (new, after Rule 16, before "### External post-merge schema review")

```markdown
17. **Keep the help current.** The public help at `/help` (`src/content/help/<slug>.md` and its entry in `src/lib/help/registry.ts`) is part of the product. A change that a person who is not a platform operator can see updates its help page, or the work-log states "no help impact" and why, in the same housekeeping cluster as Rules 10, 13 and 14 (release notes, functionality map, TODO). "Can see" means any of: a page or route a non-operator can reach; a label, button or instruction string that a help page quotes (its entry's `labels`); who can do something (a role, a permission bundle, an organization-type scope, a toggle's default); a new per-congregation toggle or portal tile; a step in sign-in, two-factor or invitations; an email a person receives; a global platform flag whose production state changes what a page describes; a bug fix whose old behaviour a page described or worked around. It does not trigger on `/admin`, `/developer`, infrastructure, refactors, or a schema change with no screen change. The pipeline carries it: Phase 1 (analyst) names the pages in a "Help impact" line; Phase 3 lists the edits and drafts the strings in its Copy section; the Phase 4 implementer edits the page from the screens, not from the code; Phase 5's copy-truthfulness check covers the help diff; Phase 6 reads each named page as its reader against the shipped feature, and a page that contradicts the build is NEEDS REWORK. `npm run check:help` (the ninth tripwire, with `src/lib/help/coverage.test.ts`) catches what code can see: a registry entry without a file, a banned future-tense phrase, a label that left the UI, a toggle or tile no page covers, a link that does not resolve, an image without alt text or not in the manifest, a `[help:<token>]` out of step with its page. It cannot see a behaviour change inside a feature that moves no label; that part is this rule. **A feature in flight** gets a `pending` page tied to a `[help:<token>]` on exactly one open `docs/TODO.md` line. When you move that line to Done you keep the token and, in the same commit, set the page `published`, remove any `limitationUntil` sentence and marker that named it, and set `verifiedIn` to the release you re-walked the page against; the check fails until all three are done. **A backlog placeholder** (`planned`) is deleted, and its real page written with `replaces`, in the commit that moves its line to Done. `verifiedIn` is a claim that someone walked the page: move it by walking it, never in bulk. The monthly documentation review re-walks every published page's `labels` and re-confirms every placeholder ("still planned?") with the operator. Screenshots come only from `npm run help:shots` against a fixture-only database (the capture refuses any other), and every committed image is opened and read for real data before it merges. A global flag the operator flips outside a pipeline can falsify a page with no commit to catch it (accepted, `paper`); the flip is an event for this rule.
```

### 2. `CLAUDE.md`: layout, brand list, tripwire count, commands

- **Project Layout**, after the `src/app/(admin)/developer/` entry, add:
  ```
  src/app/(documentation)/ — public help at /help (and /docs later): static, session-free, platform
                           palette, un-brandable, no loading.tsx ever. The proxy lets /help and /docs
                           through by a segment-boundary prefix and adds no import. See Workflow Rule 17
  src/content/help/      — the help pages' markdown and their screenshots (images/). Public by design:
                           nothing private is ever written here. /docs content will sit beside it
  src/lib/help/          — the help registry (typed, pure), the build-time loader, the scanner and checks
                           `npm run check:help` runs, and helpHref(), the only place an in-app help link
                           is built (a source scan bans a hand-built "/help…" literal)
  src/components/help/   — help-only composition: the Needs block, the planned placeholder (the one file
                           where future-tense wording is allowed), page navigation
  ```
- **The Brand Is a Cascade Override**, the platform-palette sentence: change `` `(invite)`, `(email-verify)`, `(password-reset)`, `access-pending`, `/launch`, `` to `` `(invite)`, `(documentation)`, `(email-verify)`, `(password-reset)`, `access-pending`, `/launch`, ``.
- **Phase 4 gate** (line beginning "**Gate:** Tests for the change are written"): "all eight tripwires" becomes "all nine tripwires".
- **Common Commands**: replace `npm run check        # All eight tripwires in sequence` with the three lines
  ```
  npm run check:help   # Tripwire: the help registry, content, links, images, labels, banned phrases and
                       # [help:<token>] lines in docs/TODO.md agree (Workflow Rule 17, DECISION-294); no database
  npm run help:shots   # Regenerates the help screenshots from a FIXTURE-ONLY database and refuses any other;
                       # needs its own server on its own port (E2E_BASE_URL); never part of CI
  npm run check        # All nine tripwires in sequence
  ```

### 3. `.claude/skills/release-notes/SKILL.md`

- **Step 4**, add after the "Functionality map (Workflow Rule 14)" bullet:
  ```markdown
  - **Help (Workflow Rule 17)** — if the release changes anything a non-operator can see, name the help page the release added or edited in the entry (`**Help:** /help/<slug>`), or write `**Help:** no impact` and the reason. Run `npm run check:help`. If the release ships a feature whose TODO line carries a `[help:<token>]`, confirm its page is `published`, its `verifiedIn` is this release, and the `limitationUntil` sentences that named it are gone.
  ```
- **Feature template** and **Enhancement template**: add `**Help:** [/help/<slug>, or "no impact" and why]` as the last line of each.

### 4. `.claude/agents/analyst.md`

- **Pass 4**, add a bullet at the end of the list:
  ```markdown
  - **Help impact.** Which `/help` pages does this change add, edit or retire (Workflow Rule 17), and which `[help:<slug>]` placeholder does it make obsolete? Name each page by slug, or write "no help impact" and why. A change to sign-in, two-factor, invitations, a toggle's default, a role bundle or any label a help page quotes always has help impact.
  ```
- **Phase 6**, after the paragraph beginning "For any feature that changes how an account becomes connected", add:
  ```markdown
  Read each help page the work-log's "Help impact" line names, as its target reader, against the shipped feature on a dev server at 360px: every label, step and "What you need" claim must match the build, and every `limitationUntil` sentence the feature removes must be gone. A page that contradicts what shipped is NEEDS REWORK; a feature with a user-visible change and neither a help edit nor a "no help impact" note is SHIP WITH NOTES at minimum; the page's `verifiedIn` is yours to move only by this walk.
  ```

### 5. `.claude/agents/qa.md`

- **Run Scope**, "Always, in full" bullet: after "typecheck, lint, `npm run check`, the unit suite" add "(`npm run check` includes `check:help`; the unit suite includes `src/lib/help/coverage.test.ts`)".
- **Copy truthfulness**, append a paragraph:
  ```markdown
  **Help diff (Workflow Rule 17).** When the diff touches `src/content/help/`, `src/lib/help/registry.ts` or a label a help page quotes, the four checks cover it too (`git diff -U0 origin/main... -- src/content/help src/lib/help`): every `labels` string is on screen (open the page on a dev server, not the code), every claim traces to the Phase 4 "page, fact, how verified" record, each instruction is doable by the role the page's Needs block names, and the neighbour grep for the page's subject is in the record. Open every committed image under `src/content/help/images/` and read it for a real name, address, email, brand or tenant (`check:secrets` scans text, not pixels), and record that you did. A help page that is not walked is not verified.
  ```

### 6. `.claude/agents/tech-lead.md` and `.claude/agents/architect.md`

- **tech-lead.md**, Section 1 (design) bullet list, after the **Copy** bullet: `- **Help impact** — the /help pages the change adds, edits or retires (slug, and the Copy rows that feed them), or "no help impact" and why (Workflow Rule 17).` In **Ownership → Documentation review**, append: "Re-walk every published help page's `labels` and re-stamp `verifiedIn` only for pages actually walked; re-confirm each placeholder's `confirmedOn` with the operator ('still planned?')."
- **architect.md**, route-group list, add: `` - `(documentation)` — public help (`/help`) and, later, public developer docs (`/docs`): static (`dynamic = "error"`), session-free, platform palette, no `loading.tsx` ever, never imports the database, `@/auth`, `next/headers`, flags or authz (`npm run check:help` walks the graph). Content is markdown under `src/content/`; the proxy bypass is a segment-boundary prefix with no new import. ``

### 7. `docs/work-log/_template.md`

- **Phase 1**, after "## Out of Scope (confirm with user)" and its bullet, add:
  ```markdown
  ## Help impact

  - [The /help pages this change adds, edits or retires (slug each), or the [help:<slug>] placeholder it makes obsolete; or "no help impact" and why. Workflow Rule 17.]
  ```
- **Phase 3**, in "## Component / Page Plan", add the bullet `- Help pages to add or edit: [slug and the Copy rows that feed them], or "no help impact"`.
- **Phase 5**, in "## Copy Truthfulness", add the box `- [ ] Help diff covered: every labels string is on screen, every claim walked at 360px, every committed image opened`.
- **Phase 6**, in "## Edge Cases", add `- Help pages read as their reader (each page named in Help impact): [pass | fail | no help impact]`.

### 8. `.claude/skills/pre-push/SKILL.md`, Step 7 (advisory)

```markdown
- **Help (Workflow Rule 17)?** If the outgoing diff touches a page, label or flow a non-operator can see, something under `src/content/help/` or `src/lib/help/registry.ts` should have changed too, or the work-log says "no help impact":
  ```bash
  git diff main...HEAD --name-only | grep -q -E "src/content/help/|src/lib/help/registry.ts" || echo "WARN: no help change on this branch — confirm 'no help impact' is recorded"
  ```
  Advisory only; `npm run check:help` (inside `npm run check`) is the hard gate for the mechanical part.
```

**Not in Increment 1:** the "Docs impact" sentence for `/docs` (Addendum A) joins Rule 17 when Increment 3 ships; `docs/architecture.md` is untouched (Rule 15: a static help tree is not a new subsystem; revisit at Increment 3).


## Implementation Order, batches and implementers

There is no schema, so the template's order collapses to: library and tripwire, then the route group and renderer, then the first real pages (so `helpHref` has published slugs to type against), then proxy and in-app links, then the administrator pages, then screenshots, then the pending pages and the placeholders. **Serial in this one worktree** (Rule 16), each batch committed by explicit path (never `git add -A`), none pushed. Every batch gate: `npm run typecheck`, `npm run lint`, the unit suite, `npm run check` (the nine tripwires from Batch 1 on), and from Batch 2 `npm run build` with the help routes confirmed static. Phase 4 sections stay short (files, deviations, gates with counts).

| Batch | Scope | Implementer | Commit |
|---|---|---|---|
| **0** | Orchestrator, before any code: `npm ci`; kickoff checklist K1 to K6; the TODO token lines and token appends in the worktree (the five dedicated in-flight lines and, **after O1**, the placeholder tokens); the dev-server Neon branch; reads the state of the five pipelines (see "Integration") | orchestrator | `docs(todo): help tokens` |
| **1** | `src/lib/help/` (types, empty registry, select, urls, contact, tokens, slug, headings, markdown-scan, checks, todo-grammar, slug-history, coverage-allowlist, example-names, links, shots-guard) with a failing-first test for every H rule and the TODO grammar table; `scripts/lib/import-graph.mjs` and the lift (P3-3); `scripts/check-help.ts`; `package.json` (`check:help`, the ninth in `check`); `coverage.test.ts`; `check-brand-scope.mjs` header comment | api-developer | `feat(help): the registry, the content checks and the check:help tripwire` |
| **2** | `(documentation)` route group, layout, the five routes, `not-found.tsx`; `markdown-document.tsx`; `src/components/help/*`; the `Table` `containerProps` divergence; `content.ts`; `screenshots.ts` and `screenshots-data.ts` (empty); `shell-boundaries.test.ts`; `docs/ui-standards.md` paragraph; `helpRedirects()` in `next.config.ts`; component tests; 360px browser check, light and dark | ux-developer | `feat(help): the static help route group and the shared markdown renderer` |
| **5a** | The first real pages and their registry entries, text only: `what-presbyportal-does`, `how-a-congregation-gets-started`, `signing-in`, `using-your-code`, `your-account`, `home-and-switching-congregations`, `why-cant-i-see-this`, `using-the-directory`, `turning-features-on-and-off`, `getting-help`; the functionality-map bullets; each page walked and recorded ("page, fact, how verified"); `slug-history.ts` appended | full-stack-developer | `docs(help): the first ten help pages` |
| **3** | The proxy predicate and its tests; the in-app links (home, avatar menu, `/signin`, `/totp`, `/access-pending`, six toggle-off states); the home line; the existing unit and e2e edits (blast radius); `help.spec.ts`, `help-gates.spec.ts`, the lockdown additions; **the auth-touching smoke on :3660 and the prod lane on :3661**; both pass before Phase 5 | full-stack-developer | `feat(help): public /help through the proxy, and the in-app links` |
| **5b** | **The role walk first**, then the administrator pages: `first-day-as-administrator`, `adding-people`, `officers-and-the-session`, `roles-who-can-do-what`, `events-and-the-calendar`, `your-congregations-website`; map bullets; the walk record | full-stack-developer | `docs(help): the administrator pages` |
| **4** | `playwright.config.ts` `help-shots` project, `e2e/help-shots/`, `shots-guard` wiring, `help:shots`; the orchestrator provides the from-scratch Neon branch and `HELP_SHOTS_DB_OK`; the seven images and `screenshots.ts`/`screenshots-data.ts` entries; `![…](shot:<id>)` added to the five pages that use them; guard fixtures | full-stack-developer | `feat(help): the fixture-only screenshot capture and seven images` |
| **5c** | The seven pending pages (written, `status: "pending"`, not rendered) from the pipeline records; the placeholder entries **after O1**; the final strings are re-checked at each publish | full-stack-developer | `docs(help): pending pages for the five in-flight features and the approved placeholders` |

Implementer order within Phase 4 is therefore: api-developer (1), ux-developer (2), full-stack-developer (5a, 3, 5b, 4, 5c). The Phase 4 gate for auth-touching work (the MFA smoke on the implementer's own server) is Batch 3's exit; the full e2e and the image read are QA's.

## Edge Cases & Risks

Each claim names the test that pins it or says *unverified*.

1. **A label that left the UI.** H10 fails on a published page (`checks.test.ts` H10 fixtures). A label renamed inside a pending feature fails at its publishing commit, by design (R6).
2. **A pending slug is a different 404 from an unknown slug.** It is not: both are declined by `dynamicParams = false` and answered by the one catch-all (`help.spec.ts` compares status and body for an unknown slug and for a registry-derived pending slug; a unit test pins that `generateStaticParams` excludes pending). Timing is not measured (*unverified*).
3. **`/helpx`, `/helpdesk`, `/docsx`, `/HELP`, `/help%2Fx` are not bypassed** (`proxy.test.ts` case 2).
4. **A required, unverified, mid-enrolment reader reaches `/help`** and still meets `/totp` on `/o/*` (`proxy.test.ts` case 3; `help-gates.spec.ts`).
5. **A custom host never serves platform help**: the six paths are the neutral 404 with no cookie and no `location` (`lockdown.spec.ts`, both lanes). A church that authors its own `/help` page gets its own page (existing mechanism, *unverified* for `/help` specifically).
6. **A session read slipping into a help route fails the build** (`dynamic = "error"`; `shell-boundaries.test.ts` asserts the export; `next build` is the proof, read by QA).
7. **`loading.tsx` under `(documentation)`** fails `shell-boundaries.test.ts`.
8. **`javascript:` and `data:` links and raw HTML** render as text (`markdown-document.test.tsx`; H5, H6). `dangerouslySetInnerHTML` is banned under the group, `src/components/help/` and the renderer by the same scan.
9. **360px.** The header wraps, tables scroll in a focusable region, long words and URLs wrap (`break-words`); `help.spec.ts` asserts no horizontal document overflow on every published page at 360, and a renderer unit test feeds a 200-character unbroken token. The signed-in marketing bar at 360 and 375 is measured by hand and recorded (*unverified* in jsdom).
10. **Dark mode and 200% zoom**: tokens only, so contrast follows the platform; checked in the Phase 5 walk (*unverified* until then).
11. **Print**: chrome buttons and the on-this-page list are `print:hidden`; the page body prints in monochrome (*unverified* in a print preview until the walk).
12. **Alias redirects answer only on platform hosts.** `helpRedirects()` entries all carry `has: [{ type: "host", value: <pattern> }]` (a unit test over a fixture registry). None exists at first release.
13. **A planned slug that disappears** (feature shipped, placeholder deleted) without `replaces` fails H3 (fixture).
14. **A pipeline merges before help does.** Its TODO line is already Done with no token; at help's integration the orchestrator adds the token to that Done line and publishes the page; if the page was left `pending`, H12(b) fails with "feature shipped: publish its page", which is the forcing function (fixture 11b). If a `limitationUntil` page names it, H12(f) names the page to edit.
15. **A pipeline merges after help does.** Its integration commit moves the tokened line to Done and must, in the same commit, publish the page, remove the limitation sentences and set `verifiedIn` (Rule 17); CI is red until it does.
16. **Two TODO lines carrying one token, a typo'd token, or a token on a Done line that is still `pending`** each fail H12 (fixtures 6, 7, 8, 11b, 12).
17. **Anchors drift.** A declared anchor that no heading produces fails H4; an in-app link cannot name an undeclared anchor (a `// @ts-expect-error` case in `urls.test.ts`).
18. **Increment 2 changes one constant** (`HELP_CONTACT_LINE`); a test replaces it in a fixture and shows every `{{contact}}` resolves (`tokens.test.ts`).
19. **A feature merged behind a global flag that is off in production.** Accepted `paper` residual (DECISION-294): the pipeline must not publish the page until the operator turns the flag on; Rule 17 names the flip as an event.
20. **A screenshot of real data.** The guard (G1 to G6) refuses a non-fixture database before any navigation (`shots-guard.test.ts` fixtures, one per rule); a human reads every image in Phase 5 (*unverified* until then, and the only protection against a baked-in real brand or name inside a fixture-looking page).
21. **A new `Table` prop changes an existing caller.** It cannot: the new prop is optional and `table.test.tsx`'s existing cases stand.
22. **A zero-planned or zero-published state.** The planned page renders its empty state and the index omits empty groups (`select.test.ts`, `index-groups.test.tsx`).
23. **Link previews.** Each page sets its own `openGraph` title and description (unit test on `generateMetadata`); the page itself stays `noindex` (`help.spec.ts` reads the robots meta tag).
24. **Build-time `fs` reads in a worktree whose `turbopack.root` spans siblings** (the recorded Turbopack flake): *unverified* until Batch 2's first build; the fallback is the hardlinked scratch copy documented in `docs/testing.md`.
25. **`/docs` is bypassed with no route behind it** until Increment 3: anonymous `/docs/x` is the platform 404, not a sign-in redirect (`help-gates.spec.ts`; accepted, R1).

## Out of Scope (explicit non-goals; the operator confirms)

A search box (revisit near 30 pages); versioned doc sets, translations, video, PDF and a print stylesheet beyond hiding chrome; email-template links and contextual links beyond C3; a help editor or help in the database; presbytery and synod pages, treasurer and giving pages (Phase 1 Q5, Q6); indexing, `Allow: /help`, a sitemap and canonical URLs (R11: the pages inherit `noindex`; the per-page `generateMetadata` is the single place to flip it later); the contact form and its inbox (Increment 2, C1 to C10); `/docs` and the "Docs impact" sentence (Increment 3); extracting `ORG_FEATURE_CATALOG` and the ingest limits (Increment 3, R8); the `/no-organization` and `/invite` links (P3-9); a per-page kill switch (P3-13); fixing `README.md`'s stale status paragraph (F-new-6); `docs/architecture.md` (Rule 15).

## Carry-forward

| Phase 1, Addendum A, ruling or Phase 2 item | Addressed here (where), or *deferred* (who accepted) |
|---|---|
| Gap 1: Needs block, "Why can't I see this?", never "if your church has turned on" | Copy C1 (Needs block, pinned to the catalog by `coverage.test.ts`, H11); page 10; page 15 |
| Gap 2: in-flight features; the F166 hold; production is not `development` | Superseded by the operator ruling: real pages, `pending` until in production (R6, page list, P3-6, P3-11); the F166 hold dissolves into the two pending pages; production posture used for the walk and capture; "never document a coming-soon stub" is the allowlist reason |
| Gap 3: screenshots (source, real-PII row, freshness, role, delivery) | Capture section: G1 to G6, fixture users, stamp, seven images, human read, static imports, no `next/image` |
| Gap 4: content format and location | R2, the registry type, the loader; P3-4 (scanner, subset); no `rehype-raw` (renderer contract) |
| Gap 5: search and navigation at 360px | No search (Phase 1 default, operator default taken; *deferred* until about 30 pages); index groups, breadcrumb, previous and next, `<details>`, 44px targets, scroll region (C1, renderer, `help.spec.ts`); the marketing bar measured |
| Gap 6: SEO | Inherited `noindex`, planned pages explicit, per-page OpenGraph; canonical, `Allow: /help` and a sitemap *deferred* (architect R11, operator default Q4) |
| Gap 7: accessibility | Renderer type scale, one `<h1>`, nested headings (H4), alt text (H7), skip link, landmarks, focusable tables, `ol` steps, tokens only, link-text rule (H6); plain language is a Phase 4 duty checked in Phase 6 |
| Gap 8: versioning, custom host | `verifiedIn` and "Last checked against release", H13; no per-release copies; custom-host lockdown additions |
| Gap 9: in-app links and URL stability | C3 and the table; email links *deferred* (Phase 1 recommendation, taken by the operator's default); `/no-organization` and `/invite` *deferred to their publishing commits* (P3-9); `slug-history.ts` and aliases (P3-7); `rel="noreferrer noopener"` on external links |
| Gap 10: the keep-current rule, tripwires, who writes it | Rule 17 and the eight edits; H1 to H19 and `coverage.test.ts`; the limitation marker as a backstop (P3-6); the style guide is the outline rules plus C6 |
| Gap 11: the marketing line | C2 and the home change |
| Adversarial pass (promises, tenant leaks, real data, stale pages, open redirect, enumeration, contact address, external links) | H10, H8, the walk; H9 and "no counts, no names"; capture guard and image read; R6 and P3-6; `help.spec.ts` (`?next=`, `?callbackUrl=` reflect nothing); one 404; no address published (operator ruling), O2; `noreferrer` |
| Addendum A Part 1 (website section) | Page 21 and its walk; "ask us" for the domain; giving not described |
| Addendum A Part 2 (`/docs`) | *Deferred to Increment 3* (architect split, DECISION-295); the bypass for `/docs` is decided now (R1) |
| Addendum A Part 3 (placeholders) | The list (awaiting O1), H12(c), `planned` pages, per-page `noindex`, `confirmedOn`; the TODO token grammar |
| Operator: contact form | *Deferred to Increment 2* (architect, operator ruling); `{{contact}}` and `HELP_CONTACT_LINE` prepare it; `contact` slug reserved |
| Operator: home line | C2 |
| Operator: real pages for in-flight features | Seven pending pages, five tokens |
| Operator: placeholders only for bigger backlog tracks | The list, with the exclusions named |
| Operator: production truth | The walk and capture posture; the flag list in the capture section |
| R1 | The proxy section (inline predicate, no import, five tests) |
| R2 | The registry type; `check:help` H4 forbids a level-1 heading |
| R3 | The static lock section; `shell-boundaries.test.ts`; QA reads `●`/`○`. "Every content route" means the four pages that render content; the `help/[...unmatched]` 404 catch-all renders none and is `force-dynamic` (architect ruling after Batch 3; its own source-scan pin) |
| R4 | The renderer contract table |
| R5 | Images paragraph; static imports; no `public/`; H17, H18 |
| R6 | H12 and the grammar table; P3-6; P3-7 |
| R7 | `check:help` shape; P3-1 moves the catalog and tile rules to vitest |
| R8 | H19 via the lifted walker (P3-3); the catalog extraction *deferred to Increment 3* (architect's own "if a Needs block renders toggle names by import": none does in Increment 1) |
| R9 | No `loading.tsx`, no `error.tsx`; `shell-boundaries.test.ts`. `help/not-found.tsx` is reached through the `help/[...unmatched]` catch-all, not through the `[slug]` page's own `notFound()` (that call fires only at build, so it is now a guard); no root `not-found.tsx` or `global-not-found` exists (pinned) so a custom host's neutral 404 does not change |
| R10 | The guard and G1 to G6 |
| R11 | Inherited `noindex`; planned `noindex`; no `robots.ts` or sitemap change |
| R12 | `helpHref` typed to published slugs; H16; the deferrals; `rel` on external links |
| R13 | The home change, test update, 360px measurement |
| R14 | Batch 0 and "Integration" (shared files by the orchestrator); the placeholder list approved before Batch 5c |
| C1 to C10 (contact form) | *Deferred to Increment 2*: recorded by the architect for its addendum; nothing in this increment writes, stores or mails an anonymous submission |
| F345 (five live slots) | *Deferred to Increment 3* (documentation by import) |
| F346 (`tickets` cannot hold an inquiry) | *Deferred to Increment 2* (resolved by the increment split) |
| F347 (server-only catalog and ingest limits) | P3-1 (found again for the tripwire; resolved by the vitest half); extraction *deferred to Increment 3* |
| F348 (exact `PUBLIC_PATHS` would redirect typos) | R1 prefix, proxy test 2 |
| F349 (TODO checkbox grammar) | The token grammar and its 12 fixtures |
| DECISION-293, 294, 295 | Implemented here (293, 294); 295 belongs to Increment 3 |
| CLAUDE.md edits (Rule 17, layout, brand list, tripwire count, commands) | Section "Workflow Rule 17 and the edits", for the orchestrator with the operator's approval (O5) |

## Operator questions

Defaults are used if no answer comes; none blocks Batches 0 to 3.

- **O1. The placeholder list.** Approve, strike or edit each of the eight rows (their "Today:" lines are the Copy). *Default:* approve rows 1 to 7, and decide row 8 separately (Phase 1 Q6 said help is written for congregations). The operator's own example "importer" is **not** proposed because the TODO records "no general importer, by decision"; say if you want it anyway. Batch 5c waits for this.
- **O2. A way for a prospective congregation to reach us before the contact form.** The "How a congregation gets started" page would otherwise be a dead end. *Default:* the page links the project's public repository (already linked from the home page) and says it is the only public way to reach us today; no address is published, as ruled. *Alternative:* hold that one page `pending` until Increment 2.
- **O3. Is Google sign-in configured in production?** The sign-in page shows a Google button either way. *Default:* the `signing-in` page does not describe Google until the operator says it works (the Phase 4 walk cannot tell). `signing-in` and `how-a-congregation-gets-started` are written without it.
- **O4. "Sign in" in the help header for a signed-in reader.** The static chrome cannot tell the two states apart (P3-8), so a signed-in reader also sees "Sign in", which opens the sign-in form. *Default:* accept; "Open PresbyPortal" is the button that works for both.
- **O5. Approve the `CLAUDE.md` edits and Rule 17's wording** (eight edits listed above, including "eight" becoming "nine" tripwires). Agents cannot land these; the orchestrator does with approval.
- **O6. Publication timing of the five in-flight pages.** *Default:* each page publishes in the integration commit of its own feature (mechanical, by the token), including 2b's, even though real invitations are on hold until F166, because a help page sends nothing.
- **O7. The six "How features are turned on" links on toggle-off states (P3-10).** *Default:* yes; they are one added line each and the target page tells a non-administrator who to ask.

## Integration: what the orchestrator does (Rule 16)

1. **TODO lines (Batch 0), exact.** Add under `## In Flight`, as open lines: `- [ ] **Community Increment 2b: sign-in invitations and connect at sign-in (in flight, branch pipeline/signin-invites, release 0.48.0 prepared).** Its help page sign-in-invitations is pending; when this line moves to Done, publish the page in the same commit. [help:signin-invites]`; `- [ ] **F166 recovery codes and F344 regenerate bypass (in flight, branch pipeline/recovery-codes).** Pages accepting-your-invitation and setting-up-two-factor are pending. [help:recovery-codes]`; `- [ ] **F343 two-factor by role (in flight, branch pipeline/2fa-default).** Page who-is-asked-for-a-code is pending. [help:two-factor-by-role]`; `- [ ] **Treasury Increment 1: reimbursements (in flight, branch pipeline/treasury).** Pages reimbursements and reimbursements-for-treasurers are pending. [help:reimbursements]`; `- [ ] **Person photos Increment 1 (in flight, branch pipeline/person-photos).** Page photos-of-people is pending. [help:person-photos]`. **After O1**, append ` [help:<slug>]` to the end of the existing open line whose lead text is named in the placeholder table. Each token appears once in the file.
2. **Per pipeline, at help's integration, read `main`.** If the pipeline has merged: put its token on its Done entry, flip its pending pages to `published` after the analyst's re-walk, set `verifiedIn`, delete the `limitationUntil` markers and sentences that named it, add its in-app link (`/invite` for `accepting-your-invitation`, `/no-organization` for `sign-in-invitations`), and update any published page its Rule 17 "Help impact" line names (F343 edits nothing published: P3-11). If it has not merged: leave its pages `pending`. `npm run check:help` is the checklist; it lists exactly what is out of step.
3. **Shared files.** `docs/decisions.md` (DECISION-new-1 and DECISION-new-2 below, with 293 to 295), `docs/STATE.md`, `docs/reviews/log.md`, `CLAUDE.md` and the agent, skill and template files (the eight edits), the F-numbers (F-new-1 to F-new-6 to F350 onward).
4. **Housekeeping cluster (Rules 10, 13, 14, 15).** TODO moves; a what's-new entry is optional and the operator's call (the help site is public, not member behaviour); the functionality-map Index and full-map bullets (the implementer edited the `/help/<slug>` references; the orchestrator confirms the Index line); `docs/architecture.md` unchanged; release notes through `/release-notes` (a minor release; the number is the orchestrator's); `docs/briefings.md` entry.
5. **After merge.** No schema changed, so `scripts/test-rls.sql` is not re-run. Re-run `npm run check`, `npm run test`, the e2e auth smoke and `npm run test:e2e:prod` on the merged tree.

## Decisions (final text; the orchestrator records them, newest first)

- **DECISION-new-1 — The help tripwire is split, and its content subset is closed.** `scripts/check-help.ts` (tsx, no environment) holds registry, file, history, heading, link, image, phrase, label, TODO-token, map, literal-href and import-boundary rules; `src/lib/help/coverage.test.ts` (vitest) holds the catalog and tile coverage and the toggle-name rules, because `org-features.ts` and `tiles.ts` import `server-only` and the database and extracting the catalog would collide with three unmerged branches. Content is restricted to a subset the hand-written scanner models (inline links, ATX headings, no raw HTML, no bare URLs, one template token `{{contact}}`). A published page may carry `limitationUntil: <token>` so a feature's merge names the pages it falsifies. Planned slugs equal their tokens; `slug-history.ts` is append-only. *Revisit if* a page renders a constant by import (then extract the catalog), or the subset blocks an author.
- **DECISION-new-2 — Screenshots come only from a fixture-only database behind a fail-closed guard.** Guard rules G1 to G6 (slug allowlist, profile rows, `.invalid` identities, same host as the server, an attestation variable, any error refuses); the manifest is a pure data file plus a static-import binding; `capturedIn` can only move by re-running capture; every committed image is read by a human. *Revisit if* images exceed about fifteen, or capture moves into CI.

**Findings for the orchestrator to number (F350 onward).** **F-new-1** `ORG_FEATURE_CATALOG` and `PORTAL_TILES` cannot be imported by `tsx` (R7's premise); resolved by P3-1. **F-new-2** `ui/table.tsx`'s scroll container cannot be made focusable from outside; resolved by P3-2. **F-new-3** `/no-organization` and `/invite` links collide with 2b's rewrite and with `helpHref`'s published-only type; resolved by P3-9. **F-new-4** `scripts/check-proxy-imports.mjs`'s walker is private and its ban list hard-coded; resolved by the lift (P3-3). **F-new-5** a pipeline that merges before help leaves a Done TODO line with no token; resolved by the integration playbook and H12(b). **F-new-6** `README.md:14-20` says sign-in is gated off and the site serves public pages only, which contradicts production; a documentation-review follow-up, not edited here.

## Implementer

Named per batch above: **orchestrator** (Batch 0), **api-developer** (Batch 1), **ux-developer** (Batch 2), **full-stack-developer** (Batches 5a, 3, 5b, 4, 5c). The page prose is Phase 4 work that follows the outlines, the walk and Copy C6; the operator should read the Copy section, the placeholder list and O1 to O7 at design review.

---

# Phase 4 — Implementation

*Pending. Batches 0 to 5c as above. Each batch records files, deviations, gates with counts, and the "page, fact, how verified" lines for the prose batches.*

## Phase 4 — Batch 1 (api-developer)

*2026-10-28, worktree `presby-help`, commit `d6e7bd7`, not pushed. A previous Batch 1 run was stopped mid-way and left untracked partial work; it was read in full, kept where correct and complete per the spec, and fixed where not (below).*

**Files.** `src/lib/help/`: `types`, `registry` (empty), `select`, `urls`, `contact`, `tokens`, `slug`, `headings`, `markdown-scan`, `checks` (H1 to H18), `todo-grammar`, `slug-history` (empty), `coverage-allowlist`, `example-names`, `links`, `shots-guard`, `screenshots-data` (empty), `coverage.test.ts`, `config-imports.test.ts`, and a `*.test.ts` beside each module. `scripts/lib/import-graph.mjs` (the lift, P3-3), `scripts/lib/help-boundary.mjs` (H19), `scripts/check-help.ts`, a test file for each of the two lib modules. Modified: `scripts/check-proxy-imports.mjs` (imports the primitives, re-exports `stripComments` and `importSpecifiers`; its test file is untouched and green), `scripts/check-brand-scope.mjs` (header comment only), `package.json` (`check:help`, the ninth entry of `check`).

**Red before green.**
- The two new `scripts/lib` suites were run before their modules existed: `FAIL scripts/lib/help-boundary.test.mjs ... Cannot find module './help-boundary.mjs'` and the same for `./import-graph.mjs` (2 suites failed, 0 tests ran). Then green.
- The earlier run's red output for `src/lib/help/*` was not preserved, so I did not take those tests on trust: each rule was **mutated** and the suite re-run. With `H1`..`H18` individually replaced by `() => []` in `HELP_RULES`, `checks.test.ts` fails 11, 3, 3, 5, 8, 4, 3, 9, 5, 3, 2, 10, 2, 2, 2, 2, 6, 2 tests respectively (127 tests; every rule has at least two). For the TODO grammar, seven targeted mutations of `todo-grammar.ts` each fail exactly the fixture rows they should (rows 3, 4, 5, 7 and 8, 9, 10, 12, and 1 and 2 together with ten H12 tests). All mutations were reverted; the files match what is committed.

**Deviations and findings (none weakens a rule).**
1. **The shrink-only allowlist holds 32 entries, not the 16 the design expected.** With an empty registry no published page covers anything, so coverage rule (1) cannot pass unless the keys the Batch 5a and 5b pages will cover are allowlisted too. 16 are the deliberate ones from P3-16; 16 are marked "Written later in this increment (Batch 5a/5b); deleted in the commit that publishes its page" (`tile:directory`, `tile:tickets`, `tile:features`; the calendar, public calendar, careers, domains, members-create toggles and the members, roles, officers, branding, calendar, events, careers, domains tiles). `ALLOWLIST_PIN = 32` in `coverage.test.ts`. **Each Batch 5a/5b commit must delete its entries and lower the pin; the pin must reach 16 by the end of 5b.**
2. `screenshots-data.ts` (empty) lands here, not in Batch 2, because H7, H17 and H18 read it. `help-boundary.mjs` and `config-imports.test.ts` are additions to the list: the first holds H19 (`checkImportBoundary` plus the ban list) so the tsx runner and a vitest file share it; the second is the "reads `types.ts`, `registry.ts`, `select.ts` and fails on an `@/` runtime import" test the Component Plan asks for.
3. `helpRedirects(hostPattern, pages?)` takes the platform host as its first argument (as the contract says); Batch 2 passes `next.config.ts`'s own pattern.
4. `checkImportBoundary` judges an unresolvable specifier against the ban before reporting P4, so a banned module missing from the file list cannot degrade into a mere hole. The proxy walker itself is not rewritten onto it (only its primitives are lifted), to keep "no behaviour change" literal.
5. Fixes to the earlier run's work: one wrong expectation in `import-graph.test.mjs` (a 3-line input asserted 2 lines); `shots-guard.ts` named the contact table in a comment and `src/lib/contact-methods/scan.test.ts` (which pins its exemptions to exactly three files) failed, so the comment now says "contact-method email" (Batch 4: `src/lib/help/shots-guard.ts` must never name that table; `e2e/help-shots/guard.ts` is outside the scan); ten `check:secrets` soft findings in two test files, fixed with `example.org`/`example.com` and a built URL, no annotation; a `never` type error in the runner for an empty `as const` registry.
6. H19's entries follow the design list exactly, so `(documentation)/layout.tsx` is not an entry; `shell-boundaries.test.ts` (Batch 2) covers the whole group, as the Component Plan says.
7. Not exercised until content exists: with an empty registry H2 to H18 are vacuous on the real tree (their fixtures are not). The real-tree run does exercise H12's global token reading against the live `docs/TODO.md` (the ten Batch 0 tokens parse, each once) and H19 over 1,698 source files; a planted `src/lib/help/contact.ts -> select-helper -> src/lib/db` chain was reported as P1 in a scratch run.

**Gates (in the worktree, `.env.local` not read).**
- `npm run typecheck`: clean. `npm run lint`: clean (`--max-warnings=0`).
- Help suites: 16 files, 299 tests pass (`src/lib/help` 13 files / 247 tests; `scripts/lib` 2 files; `scripts/check-proxy-imports.test.mjs`).
- Unit suite `npm run test`: 681 files passed, 97 skipped (the DB-backed set, no database env), 10,424 tests passed, 2,862 skipped, 0 failed.
- `npm run check`: nine tripwires green on the real repo. `check:help`: "0 registry entries, 0 published, 0 content files, 0 images".

**Contract for Batch 2 (ux-developer).** Import `helpHref`, `plannedHref`, `HELP_INDEX_HREF` from `@/lib/help/urls`; `publishedPages`, `pendingPages`, `plannedPages`, `indexGroups`, `neighbours`, `helpRedirects` from `select`; `applyHelpTokens` from `tokens`; `extractHeadings` from `headings`; `createSlugger` from `slug` (the renderer's heading ids must use it); `resolveLink`, `linkContext`, `EXTERNAL_LINK_ALLOWLIST` from `links`; `HELP_SHOTS` from `screenshots-data`. All are pure and import nothing H19 bans; `content.ts` (Batch 2) may import `server-only` and `node:fs`, which H19 allows. `copy.ts` (Copy C1) is Batch 2's.

## Phase 4 — Batch 2 (ux-developer)

*2026-10-28, worktree `presby-help`, commit `be636c3`, not pushed. No `.env.local` value was printed.*

**Files.** `src/app/(documentation)/`: `layout.tsx`, `help/page.tsx`, `help/[slug]/page.tsx`, `help/planned/page.tsx`, `help/planned/[slug]/page.tsx`, `help/not-found.tsx`, `shell-boundaries.test.ts`, `layout.test.tsx`, `help/help-routes.test.tsx`. `src/components/shared/markdown-document.tsx` (+ test). `src/components/help/`: `needs-block`, `planned-placeholder`, `page-nav`, `on-this-page`, `help-link`, `index-groups`, and `help-components.test.tsx`. `src/lib/help/`: `content.ts`, `copy.ts` (Copy C1 and the C3-free chrome strings), `screenshots.ts` (empty import map plus `resolveShot`), `metadata.ts` (per-page title and openGraph, planned noindex), and tests for content, screenshots, metadata and the `next.config.ts` wiring; `urls.ts` gained `entryHref`, `plannedEntryHref` and `PLANNED_INDEX_HREF`. Modified: `src/components/ui/table.tsx` (`containerProps`, header comment "DIVERGENCE 2") and its test, `next.config.ts` (`...helpRedirects(PLATFORM_HOST)`), `docs/ui-standards.md` (new "Linking to Help" section and contents entry), `src/lib/reserved-slugs.ts` and its test.

**Red before green.** The `Table` `containerProps` case was run against the original `table.tsx` first (`× merges containerProps ...`, 1 failed, 3 passed), then green. The rest of the batch's tests were written after the code, so they were **mutation-checked** instead: `urlTransform` reverted to the default for `src` (1 test fails), heading clamp removed (1), unresolved link rendered as an anchor (3), `rel` loses `noopener` (1), a `flex` class on the `<summary>` (1), `operatorEnabled` ignored in the Needs block (1), the published-first lookup in `loadHelpPageFrom` removed (1). All reverted.

**Static proof (`npm run build`, final run after the last change).** The help routes in the route table:
```
├ ○ /help
├ ○ /help/[slug]
├ ○ /help/planned
├ ○ /help/planned/[slug]
```
All four are `○` (static) with the registry empty (`generateStaticParams` returns `[]`, `dynamicParams = false`, `dynamic = "error"`). Build exit 0.

**360px browser check** (own dev server `:3660`, stopped by PID; 360x780, light and dark, signed in as the `member` fixture because the proxy sends an anonymous `/help` to `/signin` until Batch 3: curl showed 307 to `/signin?callbackUrl=%2Fhelp` as expected). `/help`: 200, one `<h1>`, document overflow 0, every header link and the planned link 44px tall, the header row wraps (wordmark, then Help / Sign in, then Open PresbyPortal), AAA-looking contrast in both schemes. `/help/no-such-page`: **HTTP 404**, one `<h1>` "We couldn't find that page", overflow 0. `/help/planned` (empty state): 200, overflow 0. The dev overlay shows "1 Issue" on a page: it is the next-themes "script tag while rendering a React component" console message that every page has, not from this batch. Screenshots: `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/help-b2/` (`index-`, `unknown-404-`, `planned-` x `light`/`dark` `-360.png`). Not exercised in a browser (no page content exists yet): the Needs block, on-this-page `<details>` on iOS, tables, images and previous/next; they are covered by jsdom tests and get their first real 360px look in Batch 5a.

**Deviations and findings.**
1. **`reserved-slugs.test.ts` failed on the new route** (`help` is now a live top-level segment, F157's drift test). Fixed in `src/lib/reserved-slugs.ts`: `help` is reserved, and `docs` too, ahead of its route like `invite` (the proxy bypass makes it a top-level path now). A test pins both. This is a **finding for the orchestrator**: any organization already holding the slug `help` or `docs` would collide; the isolation is by slug path, and none exists in the fixtures (the suite passes), but the production list is unchecked here.
2. **`urlTransform`.** react-markdown's default transform drops a `shot:<id>` image source (not an allowed scheme). `src` alone passes through the transform; every other URL (all links) keeps the default, and `resolveImage` is then the only gate for an image, rendering nothing for a source it does not admit (pinned by tests for remote, unknown and `javascript:` sources). The renderer-contract row "default URL transform stays" holds for links.
3. **`urls.ts` additions.** `helpHref` is typed to published slugs, which is `never` with an empty registry and could not be called from a registry-driven list (index, previous and next, planned list). `entryHref(entry)`, `plannedEntryHref(entry)` and `PLANNED_INDEX_HREF` are untyped siblings in the same file for lists whose slug comes from the registry itself (documented in the file); H16 is unaffected.
4. **`page-nav.tsx` exports two components** (`HelpBreadcrumb`, `PageNav`) because the plan lists the breadcrumb under that file; this is the one place the one-component-per-file rule is bent.
5. **Empty index.** With no published page the index shows the h1, the intro, the note and the planned link only; no new string was needed (an "empty state" sentence is not in Copy C1 and the registry is never empty at ship). I did not invent one.
6. **Tables.** `ui/table.tsx` cells are `whitespace-nowrap`; the renderer overrides to `whitespace-normal` with `min-w-32` so prose wraps in a cell and the scroll region only engages for wide tables, and sets `text-base` (the primitive is `text-sm`) so body text keeps the page's size.
7. **Heading ids** are matched to headings by source line (`scanMarkdown` and `extractHeadings` come from the same scan, so they align one to one), not by a render-order counter; a heading the scanner cannot see (inside a blockquote or list) gets no id.
8. The header's "Open PresbyPortal" link has `prefetch={false}` (`/launch` does session work). The 404 tab title is the root default "PresbyPortal".

**Gates (worktree).**
- `npm run typecheck`: clean. `npm run lint`: clean (`--max-warnings=0`).
- `npm run test`: 690 files passed, 97 skipped; 10,498 tests passed, 2,862 skipped, 0 failed (Batch 1 was 681 / 10,424: +9 files, +74 tests).
- `npm run check`: nine tripwires green (`check:help`: 0 registry entries, 0 published, 0 content files, 0 images; `check:brand-scope` and `check:proxy-imports` unchanged).
- `npm run build`: exit 0; help routes static (above).

**For Batch 3 and later.** In-app links use `helpHref` + `HelpLink`. The proxy bypass is still missing, so every manual check of `/help` needs a signed-in session until Batch 3. Batch 4 fills `screenshots.ts`'s `IMAGES` with one `import … from "@/content/help/images/<id>.png"` per manifest entry (H18). `HELP_COPY` and `copy.ts`'s helpers are where Increment 2 and the fork-branding pass look for chrome strings.

## Phase 4 — Batch 5a (full-stack-developer)

*2026-10-28, worktree `presby-help`, commit `a0825c7`, not pushed. No `.env.local` value was printed. Walked on `next dev -p 3660` (stopped by PID before the build), 360x780, fixture identities only (`.invalid` / `example.invalid`).*

**Files.** New: `src/content/help/{what-presbyportal-does,how-a-congregation-gets-started,signing-in,using-your-code,your-account,home-and-switching-congregations,why-cant-i-see-this,using-the-directory,getting-help,turning-features-on-and-off}.md`. Modified: `src/lib/help/registry.ts` (ten `published` entries), `slug-history.ts` (ten slugs), `coverage-allowlist.ts` (`tile:directory`, `tile:tickets`, `tile:features` deleted, `LATER_5A` removed), `coverage.test.ts` (`ALLOWLIST_PIN` 32 to 29; the pin reaches 16 when 5b deletes its 13), `content.test.ts` (the "empty registry" case now loads a real page), `docs/product/functionality-map.md` (a Help Index bullet, a "Help (public documentation)" section, and `Help: /help/<slug>` on the ten bullets the pages cover).

**Markers.** `limitationUntil`: `how-a-congregation-gets-started` and `why-cant-i-see-this` carry `signin-invites`; `using-the-directory` carries `person-photos`. `verifiedIn` is `0.47.0` on all ten, because H13 bounds it by this worktree's `package.json` (main is 0.48.0; the orchestrator re-stamps at integration, after re-walking). `turning-features-on-and-off` is `overview: true` and covers `tile:features`; `getting-help` covers `tile:tickets` and `route:/o/{slug}/feedback` (the design's `route:/feedback` is not a route: `(member)/feedback` holds only actions).

**Gates (worktree).** `npm run typecheck` clean; `npm run lint` clean; `npm run test` after the one fix above: 690 files passed, 97 skipped, 10,499 tests passed, 0 failed (re-run in full after the fix) (the first run failed once, `content.test.ts`, a test that assumed an empty registry); all nine `npm run check` tripwires green, `check:help` "10 registry entries, 10 published, 10 content files, 0 images"; `npm run build` exit 0 with `○ /help`, `● /help/[slug]` (10 paths), `○ /help/planned`, `○ /help/planned/[slug]`. 360px look at the index and all ten pages, light and dark, as the `member` fixture (the proxy still sends an anonymous `/help` to `/signin` until Batch 3): every page HTTP 200, one `<h1>`, document overflow 0, tables inside a focusable scroll region (`why-cant-i-see-this`, `turning-features-on-and-off`), the Needs block present on the administrator page only. Screenshots: `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/help-5a/` (`page-<slug>-light-360.png` and `-dark-360.png`, plus `page-index-*`; the walk screens `signin-360.png`, `totp-*`, `acct-360.png`, `f-*.png` and others sit beside them). They show fixture screens only; none is committed.

**The walk's environment.** The Neon branch `pipeline-user-help` (a copy of `development`) had most `org_portal.*` flags off. I set the global flags to the production posture of the operator ruling (all `org_portal.*` on except `filings` and `statistical_publication`; `sites.public_render`, `sites.public_staff_directory`, `sites.public_committee_directory`, `ui.brand_theming`, `ui.branded_signin`, `platform.merged_home`, `auth.require_2fa`, `auth.local_login` on; `statistics.submission_grants` off). The before-state is in the scratchpad as `flags-before.txt`. The role walk used a congregation made through the real `/admin/organizations/new` form (name "Hollowbrook Presbyterian Church", an invented name, slug `hollowbrook-walk`) and a founding administrator who accepted an invitation as a **new account** through the real `/invite` page (token seeded with a known value, as `e2e/support/invitation-fixture.ts` does) and enrolled two-factor. That is the person `turning-features-on-and-off` and `getting-help` address; it is also the start of Batch 5b's walk. Plain-member screens were walked as `org1@presby.invalid` (no role at `e2e-alpha`), as an Alder Creek fixture (`moderator.fixture@example.invalid`, a member holding the Moderator seat), and the Alder Creek stated clerk and brand-administrator fixtures. Walk users I created or whose password I set on the branch: `walk.*@example.invalid`, the five `router.*@example.invalid`, the three Alder Creek fixtures, `presbytery-clerk@presby.invalid`. Setting a throwaway password on a fixture row changes only my branch. Dev "sent" email is logged, not delivered (`RESEND_API_KEY` is unset), including the rows queued to the operator's own address when a ticket or feedback was filed (platform admins are notified); nothing left the machine.

### Page, fact, how verified

Legend: **W** walked on :3660 as the role named; **W+C** walked and the rule read in code; **C** code only (not walkable here), named so QA and Phase 6 can re-check; **D** a document (map, catalog) plus the screen.

**1. what-presbyportal-does** (read as a prospective congregation; no screen to walk, every line checked against a screen)

| Fact | How verified |
|---|---|
| Each congregation's records are seen only by people with access to it | W: a founding administrator at one congregation opens another and gets "You don't have access to Alder Creek Presbyterian Church" |
| People are seen as members, participants, visitors, staff or former members | W: Community views Everyone, Members, Participants, Visitors, Staff, Former (founder, Community on) |
| A new member waits for the Session to approve | W: Pending approvals text "Member proposals wait until your Session can approve them" and "Only members of the Session can approve" |
| Directory: people connected to the congregation search it, read a household, contact details except private ones | W: Alder Creek member walk, search, households, person page, `hide_email` set and cleared |
| Officers; Session and deacons' rosters built from terms | W: Officers page ("Current roster"), Groups page "Generated automatically from officer terms and the membership roll" |
| Roles: an administrator gives and takes away | W: Roles page "Who holds what", "Grant a role", "Revoke" |
| Groups, Staff | W: Groups page ("New group", automatic rosters), Staff page ("Add a staff position") |
| Members can read the calendar | W: Alder Creek member opens `/calendar`, October list |
| Job openings written for the website | W: Job openings page ("New job opening") once the feature is on. **Not walked: that an opening appears on a live website** (no site on the branch), so the line says "writes and manages job openings for the congregation's website", the tile's own words |
| Colour, type pairing and logo | W: Branding page as the brand-administrator fixture |
| Tickets and feedback | W: see page 13 |
| Presbyteries and synods have their own pages | W: presbytery fixture sees Credentials and Congregation Oversight tiles |
| Link target `/help/planned` | The page exists; it shows its empty state until 5c writes the placeholders |
| **Not stated, on purpose** | Public websites (not walkable here; Batch 5b's `your-congregations-website` owns it), giving, reimbursements, photos, counts of congregations, "add events" (the founding administrator and the stated clerk fixture both get "You don't have permission to manage events") |

**2. how-a-congregation-gets-started**

| Fact | How verified |
|---|---|
| No sign-up form | W: no route; `ls src/app` shows no sign-up or register segment; DECISION-155 |
| A PresbyPortal administrator adds the congregation | W: `/admin/organizations/new` as the platform-admin fixture, "Create organization" |
| The first administrator is invited by email and called the founding administrator | W: `/invite` text "A PresbyPortal administrator invited you to be the founding administrator at ..." |
| The link works once, only for its address; shows part of it | W: first acceptance consumed it; a second visit shows "This link isn't active"; the page shows `i***@example.invalid`; a made-up token shows the same page |
| The page is headed "You're invited"; create an account (first name, last name, 8+ characters) or sign in and accept | W: `/invite` signed out |
| "This link isn't active" and no reason given | W: dead token and spent token give the same page |
| May be asked to set up two-factor sign-in | W: the new account signed in and was sent to `/account/2fa` enrolment. The sentence is rule-neutral (P3-11) on purpose |
| No contact form; the repository link; GitHub issues are public | D: the marketing home says the same ("open an issue at github.com/chenson42/presby"); the allowlisted URL. No address is published |
| `limitationUntil: signin-invites` | The page carries the marker and **no** "only an invitation connects you" sentence: that sentence is true on this tree and false on 0.48.0, so I did not write it. The marker still forces a re-walk when the line goes Done |

**3. signing-in**

| Fact | How verified |
|---|---|
| Google button first, then "or", then the email form; labels "Sign in with Google", "Sign in with email", "Forgot password?" | W: `/signin` signed out |
| "Wrong email or password." for a wrong password, an unknown address, a locked account with the right password, and a deactivated account with the right password | W: all four on a disposable account |
| Five wrong tries lock it for 15 minutes | W: five attempts then `locked_until` about 15 minutes ahead; DB read |
| Resetting the password unlocks | W: locked the account, reset through the emailed link, `failed_login_attempts` 0 and `locked_until` null |
| Reset: "Send reset link", "Check your email" (same page for an unknown address), 60 minutes, once-only link, "Set new password", "Password updated. Sign in with your new password.", lands on `/signin` | W: the full flow including reading the link from the queued email; the reused link says "Invalid or expired reset link." |
| An account made through Google has no password; no reset mail for it | C: `requestPasswordReset` silent no-op when `password` is null; the Account page shows the Password section only when one exists |
| Google section (see "Open items") | C: `src/auth.ts` (`allowDangerousEmailAccountLinking`, the `signIn` gate refusing an unverified claim or a deactivated account) and `GET /api/auth/error?error=AccessDenied` (HTTP 403, Auth.js page "Access Denied", "You do not have permission to sign in.", a "Sign in" button). The "Access Denied" string is Auth.js's, not in `src/`, so it is quoted in prose and is **not** in `labels[]` |
| **The design's deactivated label is not stated** | W: "This account has been deactivated. Contact an administrator." exists only at `/signin?error=deactivated`; a deactivated signed-in session is signed out with no message (`jwt` returns an empty token), and a deactivated password sign-in shows "Wrong email or password.". So the page says the latter. See finding F-new-a |

**5. using-your-code** (MFA-enrolled founder, `callbackUrl=/launch`)

| Fact | How verified |
|---|---|
| Page headed "Two-factor authentication", group "6-digit code from your authenticator app", six boxes, the sixth digit submits, "Verify" is the fallback | W: typed a wrong code (submitted without a click); DECISION-257 |
| A wrong code: "That code didn't match. Try again, or use a recovery code." | W |
| "Use a recovery code instead" shows "Recovery code" and "Use my authenticator app instead" | W |
| A recovery code works typed lowercase with a space; each works once; a wrong or spent one gives the same message and returns to the six boxes | W: inserted a known code for the throwaway founder, used it, reused it |
| Landing after the code is the congregation | W: `/o/hollowbrook-walk` |
| Codes change every 30 seconds | C: `otplib` default step; the e2e helper waits for the next step |
| No button resets two-factor sign-in | W: the account page offers only "Manage / regenerate codes"; see finding F-new-b |
| **Not stated** | A "trusted device": the outline asked for it, and there is none (grep of `src`), so the section is deleted; the map's "+ trusted-device cookie" is corrected |

**8. your-account** (new account, founder and a disposable user)

| Fact | How verified |
|---|---|
| Menu "Account"; Home "Account settings" under "Quick links" | W |
| Sections "Profile", "Email address", "Password", "Two-factor authentication"; fields and buttons quoted | W: `/account` text |
| "Name updated." | W |
| "Check your new inbox for a verification link."; "Pending change" with "Cancel"; link lasts 24 hours; the mail says "This link expires in 24 hours." | W: token row `expires_at` minus now 23:59:57; queued mail text |
| Email changes only after the link; "Current email" then shows the new address | W: after the link the page showed the new address; before it, the old one |
| **After the link the landing page says "Something went wrong"** while the change is made | W: dev log "revalidatePath can't be called during render" at `verify-email/[token]/page.tsx`; `main` has the same call after `case "ok"`. Written as a short note with the workaround. See finding F-new-c |
| "That email is already in use." | W |
| "Password updated.", "Current password is incorrect.", "Passwords do not match." | W. "Password must be at least 8 characters." not shown: the input's native `minLength` stops the submit first, so the page says "at least 8 characters" from the card text only |
| Password section only on accounts with a password | C: `hasPassword`; the founder card shows it |
| Two-factor card "Active" / "Not set up"; links "Manage / regenerate codes" / "Set up two-factor authentication" | W: enrolled and unenrolled users |
| Not stated: the delete control, anything about the congregation's own record of your address | by design / unverifiable |

**9. home-and-switching-congregations**

| Fact | How verified |
|---|---|
| One congregation goes straight there; more than one lands on Home; none sees the explaining page | W: `org1`, `org1-org2`, `router.none` |
| A deep link before sign-in returns to that page | W: `/o/e2e-alpha/calendar` signed out, then sign in |
| Home: "Welcome, name.", "Your organizations" (name and "Congregation"/"Presbytery"), "Still being set up", "Quick links" with "Account settings", "What's new" with "See all", "How are we doing?" | W: several fixtures; `router.invited` for "Still being set up" (opened by URL) |
| Home never opens an organization for you | W: `org1-org2` stays on `/home` |
| "Home" link top left of Account settings | W |
| Switcher: a button with two arrows, menu "Switch organization", other organizations, "Go to your home page"; one organization is plain text | W: `org1-org2` (menu) and `org1` (plain) |
| Sign out inside a congregation goes to its public website, "Page not found" if none; from Home or Account settings to `/` | W: `/site/<slug>`, `/`, `/`. The branch has no published site, so the 404 was the observed case |
| The address of a congregation you do not belong to shows "You don't have access" | W |

**10. why-cant-i-see-this**

| Fact | How verified |
|---|---|
| Four headings of `/no-organization`: "You're not connected to a congregation yet", "Your organization is being set up" / "Your organizations are being set up", "Your congregation isn't on PresbyPortal yet", "Your access has ended" and what each names | W: `router.none`, `router.invited`, `router.unmanaged`, `router.ended`. **Cross-read against `main` (0.48.0)**: 2b rewrote this page; the four headings and the standing lines are byte-identical there, the default-state body and the "Ask your church administrator" door are not, so those lines are not quoted |
| Ask your church administrator or the person who invited you; open the link in the invitation email; the account menu shows the address you use | W: account menu opened; the sentence holds on both versions |
| "Access pending" text; reached by opening the team's own staff pages with a non-team account; Back to home | W: `/admin` and `/admin/organizations/new` as `org1` redirect to `/access-pending?from=...` |
| Tiles are shown whatever the viewer's role; a tile is absent when its feature is off or for another kind of organization; a page can say "isn't turned on" or "You don't have permission to ..." | W: a no-role member and a Moderator member see the same tiles; Calendar and Job openings tiles disappear and appear with the switch; Giving is absent at a presbytery and present at a congregation; Community stays and says "Member management isn't turned on"; Features, Roles, Officers, Staff, Groups, Branding, Events, Job openings, Website domain and Tickets say "You don't have permission to ..." for a plain member. **Corrects the design's assumption that a missing permission hides the tile** |
| Those messages name "your stated clerk or another administrator" | W: Features, Roles, Officers and the others. Directory and Tickets word it differently; the page quotes only the shared opening |
| "Website domain" cannot be found in Features; the team turns it on | W: Features lists seven cards without it; the page says "ask PresbyPortal support to turn it on" |
| A few tiles open a page that only describes an idea | W: Worship & Service Planning, Insights & Analytics, Communications; the page's own word is not used (H8 bans it) |
| "You don't have access to <name>" is one message for a managed congregation, an unmanaged one and an invited one | W: three organizations, identical text; an unknown slug is a different 404 |
| An ended relationship says so with the date | W: `org2-ended` at `/o/e2e-beta` |

**11. using-the-directory** (Alder Creek member)

| Fact | How verified |
|---|---|
| Views "Members" and "Households"; "Search the directory"; "Search"; "Status" with All, Active, Baptized, Affiliate, Other participant | W |
| Search matches a name, email or phone; "Showing N members of N"; a no-match message | W: eleven listed; "renwick" 2, an email 1, "zzzz" 0 |
| A hidden email never matches, the person is still found by name | W: set `hide_email`, searched the address (0), searched the name (1), cleared it |
| Hidden-from-directory people and visitors are not listed | W: 13 memberships, 11 listed; the two missing are the hidden one and the visitor, both absent from search |
| People whose connection ended are not listed | C: `directoryEligibilityWhereSql` (`ended_on`) |
| Each of email, phone, address, birthday, photo can be hidden | C: the five `person_privacy` columns; only email was toggled in the walk |
| Status is the roll status | W: Active 9, Baptized 1 match `current_roll` |
| Household cards, member counts, "Deacon: name"; a person page with contact, household, "View household" | W |
| Initials, no photo | W: `limitationUntil: person-photos` |
| Who to ask; edited in "Community" | W: founder, Community on, Edit person page ("Edit person") |
| "You don't have permission to view the directory." | W: a no-role member |

**13. getting-help** (founder; plain member; Alder Creek)

| Fact | How verified |
|---|---|
| Home card "How are we doing?", "Share feedback", "Not today", "Stop asking"; Account "Send feedback"; categories Suggestion, Bug report, General feedback; 2000 characters | W |
| "Thanks — we read every one." and the team is told | W: toast; a `feedback` row; `feedback_notification` mails queued to the platform administrators |
| "Not today" hides the card for the day; "Stop asking" after confirming; "Re-enable prompt" in Account settings | W: card gone after a reload; dialog "Stop daily prompts?" with "Yes, stop asking"; Account shows "The daily home page prompt is paused." |
| Account menu "Give feedback" inside a congregation goes to a role-holder at the congregation; "Promote to ticket", "Dismiss" | W: submitted, then saw it under "Incoming feedback" on the Tickets page with both buttons; page text "A designated role-holder reviews everything shared here." |
| Tickets are for people whose role allows it, the founding administrator can; others see "Restricted" and the feedback pointer | W: founder files; a plain member sees the restricted page |
| File a ticket: fields, options, attachment types and 10MB, "File ticket", "Ticket filed.", status "New", reply with "Send reply", confirmation email | W: filed one; ticket page; queued `ticket_filed_confirmation`. Attachment limits read from the form and its label, not exercised |
| The team is told of every new ticket; no reply time | W: `ticket_new` mails queued to every platform administrator. No reply time is promised and none is stated |
| Not stated: any AI involvement, who the operators are, the Tickets "Site messages" box | by design |

**15. turning-features-on-and-off** (founding administrator of the walk congregation)

| Fact | How verified |
|---|---|
| Path: menu (three-line button on a phone), "Administration", "Organization Administration", "Features" | W at 360: "Open menu" lists Home, Community, ..., Administration |
| "Features", "Ministry areas" with six switches, all on at first, the sentence about turning one off | W |
| Seven cards, names, defaults (Off except Member calendar On), what each does | W + D: the Features page text against `ORG_FEATURE_CATALOG` (`provisionedOn`, descriptions); `applies to` from `orgTypes` (Giving: congregation and new worshiping community; Parish management: congregation; Giving tile absent at a presbytery) |
| A card when a ministry area is off: "Turn on <area> above to enable this."; switches disabled | W: Worship & Events off; code disables the switch |
| "Last changed" with date and address; message "<name> turned on." | W: "Tiered sensitive information turned on." |
| Community keeps its tile and says "Member management isn't turned on" until its feature is on; Calendar and Job openings tiles come and go | W |
| "Website domain" is not in Features; the page says to ask support | W |
| Turning off hides pages, turning on brings them back; Parish management's card says nothing assigned is removed | W: Community and Member calendar off and on; Parish card text |
| "You don't have permission to manage features" | W: no-role member |
| Needs block `who` | W: the founder and the Alder Creek stated clerk both reach Features; the Roles screen describes the permission as "Turn optional portal features on or off for this organization". The Needs block names no key |
| **Not stated** | "Connect people when they sign in" (a 2b card that exists on 0.48.0, provisioned on); "Email from your domain" (administrators never see it); giving behaviour. The page says "Your Features page may list more" |

**Neighbour greps for the record (C6 check 4).** Strings found and left true: `no-organization/page.tsx` ("Signing in doesn't connect you to a congregation by itself. Only an invitation link does ..." true here, changed by 2b); the six toggle-off sentences (Batch 3 links them); `access-pending` (true); the home page's "Help" and early-release line are Batch 3's.

### Open items, findings and deviations

**Open item for the orchestrator before `signing-in` publishes (operator ruling O3).** The Google section documents Google sign-in as working. It is the one claim I could not walk (no Google client on the branch, none configured in production). The orchestrator must confirm with the operator that Google sign-in works; Phase 6 must re-walk it. What it asserts: the button signs you in and returns you; an existing account with the same address is the one you enter; Google must confirm the address and the account must be active or the page headed "Access Denied" appears; a Google-made account has no password. All of it from `src/auth.ts` and the Auth.js error page, none from a real Google round trip.

**Findings (for numbering, F350 onward after the design's six).**
- **F-new-a.** The deactivated sign-in message the design quotes is effectively unreachable: a deactivated person sees "Wrong email or password." and a deactivated signed-in session is signed out silently. Not a help defect (the page states the truth); a product question for the operator.
- **F-new-b.** `/account/2fa` and its "Regenerate recovery codes" are reachable by a password-only, unverified session (observed: enrolled founder, before the code). That is F344, in flight; `using-your-code` states only that there is no reset button, which stays true after the fix.
- **F-new-c (defect, on `main` too).** Following an email-change link changes the address and then renders "Something went wrong" because `revalidatePath` runs during render in `(email-verify)/account/verify-email/[token]/page.tsx`; the success toast and redirect never happen. `your-account` carries a one-sentence workaround. There is no TODO token for it: either fix it (drop the call, redirect only) and delete the sentence, or add a TODO line. Recommend the fix.
- **F-new-d.** `docs/product/functionality-map.md` said TOTP verify has a "trusted-device cookie". There is none in `src/`. Corrected in the map; the design's "A trusted device" section is deleted from `using-your-code`.
- **F-new-e.** The `development` branch holds a person row named like the operator inside the Alder Creek fixture (a directory entry). No screenshot of that page was kept in the repo and none is quoted; the capture branch for Batch 4 must be rebuilt from scratch as designed.

**Deviations from the outline (each is a deletion or a narrowing, none a reword).** `what-presbyportal-does` carries no website and no per-feature links (5b adds the links; `helpHref` cannot yet name an unpublished slug); `how-a-congregation-gets-started` and `why-cant-i-see-this` carry the `signin-invites` marker but no sentence that 2b falsifies, because production is 0.48.0; `why-cant-i-see-this` replaces the design's "absent, not disabled" table with the walked three-case table (tile absent, page says off, page says no permission); `using-your-code` has no trusted-device section; `signing-in` states the deactivated case by the message people actually see; `getting-help` separates the two feedback routes, which the outline merged.

**Integration notes.** (1) When this branch meets 0.48.0, `coverage.test.ts` will see the new catalog key `org_portal.sign_in_connect` ("Connect people when they sign in"); it needs an allowlist entry or the `sign-in-invitations` page's `covers`. (2) `verifiedIn` stays `0.47.0` until someone re-walks against 0.48.0; the `/no-organization` and `/invite` lines were cross-read against `main`'s source, not walked. (3) `README`-style stale text and the marketing home line are untouched (Batch 3). (4) Fixture residue on the branch only: the walk congregation, the walk users, the flag changes above, an invitation row and queued mail. Nothing touches `development` or production.

**Next.** Batch 3 (full-stack-developer): the proxy bypass, the in-app links, the home line, the auth-touching smoke on :3660 and :3661. Until it lands `/help` needs a signed-in session.

## Phase 4 — Batch 3 (full-stack-developer)

*2026-10-28, worktree `presby-help`, commit `01a4821`, not pushed. No `.env.local` value or connection string was printed. Dev server `:3660` and production server `:3661` were each started from a full `rm -rf .next` and stopped by PID. Scratch output, screenshots and logs: `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/help-b3/`.*

**Files.**
- *Proxy:* `src/proxy.ts` (one inline `isDocumentationPath` predicate and one `if` before `PUBLIC_PATHS`; no new import) and `src/proxy.test.ts`.
- *In-app links:* `src/app/page.tsx`; `src/components/shared/avatar-menu.tsx`; `src/app/(auth)/signin/page.tsx`; `src/app/(auth)/totp/page.tsx`; `src/app/access-pending/page.tsx`. New `src/components/help/features-help-link.tsx`: one component carrying "How features are turned on" and its target, used by the six toggle-off states (`calendar-states`, `members-states` (`MembersFlagOff`), `careers-states` (`CareersFeatureOff`), `giving-admin-states` (`GivingToggleOff`), `parishes-states` (`ParishesOff`), `domains-states` (`DomainsFeatureOff`)), one added line each.
- *Home line:* "PresbyPortal is in early release." replaces "Pre-release. Nothing here is a live congregation."
- *Tests altered (blast radius):* `src/app/page.test.tsx`; `src/components/shared/avatar-menu.test.tsx` (four exact lists gain "Help"); `e2e/header-controls.spec.ts` (renamed "sees only Account, Help and Sign out"); `careers-states.test.tsx`, `careers/page.test.tsx`, `domains-states.test.tsx` and `giving/page.test.tsx`, each of which asserted `queryByRole("link")` null and now asserts the help link is the only link and the Features link is still absent (this was the "grep for exact-container matches first (unverified)" row of the design: four hits, none in the calendar, community or parishes tests).
- *New tests:* `src/app/access-pending/page.test.tsx`, `src/app/(auth)/totp/page.test.tsx`, `src/app/(auth)/signin/page.test.tsx`, `src/components/help/in-app-links.test.tsx` (the six states). E2E: `e2e/help.spec.ts`, `e2e/help-gates.spec.ts`; `e2e/custom-domains/lockdown.spec.ts` gains `/help`, `/help/signing-in`, `/help/planned`, `/help/contact`, `/docs`, `/docs/x` in `PLATFORM_PATHS` (the spec runs in `custom-hosts` and, via its filename, `prod-custom-hosts`); `src/proxy.test.ts` also adds the same five paths to the existing custom-host rewrite matrix.
- *Not touched, by design:* `/no-organization` and `/invite` (P3-9: each link ships in the commit that publishes its target), email templates, `package.json`, the registry, content, CLAUDE.md, agent files, skills.

**Red before green (failing-first).** `src/proxy.test.ts` with the new `describe("proxy — /help and /docs (DECISION-293)")` and no predicate: 2 failed, 53 passed (`/help: expected 307 to be 200`; the signed-in unverified-2FA case `expected 307 to be 200`; the look-alike case passed, as it should, because without a bypass everything redirects). With a bare `pathname.startsWith("/help") || pathname.startsWith("/docs")` in the predicate's place: 1 failed, 54 passed (`/helpx: expected 200 to be 307`). With the segment-boundary predicate: 55 passed. The mutation was reverted with `git checkout src/proxy.ts` before the real predicate was written. The `page.test.tsx`, `avatar-menu.test.tsx`, `careers`, `domains` and `giving` edits were red against the unedited code after the change (3 avatar-menu, 3 states, 1 giving) before the test edits.

**Deviation and finding (for the architect and tech-lead; blocks nothing, but the design's e2e item 2 cannot hold as written).**
- **F-new-g (Batch 2 route defect, found by `help.spec.ts`).** The design (R3; Phase 1 Flow 1; e2e item 2) says an unknown, pending or retired slug renders `help/not-found.tsx`: the help chrome and "Go to the help index", 404, the same body. It does not. With `dynamicParams = false` and a **non-empty** `generateStaticParams`, Next answers a slug outside the list with the **framework's default 404** ("404 | This page could not be found.", no help chrome, no link), in dev and in a production build (measured on `:3661`: `/help/no-such-page` is 404 with the default body; `/help/planned/no-such` shows the help 404 today only because the planned list is empty, so `generateStaticParams` returns `[]`; Batch 2's 360px check passed for the same reason: the registry was empty). It will flip to the default body when the first planned page lands (Batch 5c). The status is correct (404, never a sign-in redirect, never a 200), so nothing is leaked and nothing is unreachable; the cost is a stranded reader on an old link.
  - *Option A:* `dynamicParams = true` on the two `[slug]` pages (`dynamic = "error"` kept). Measured on `:3661`: the unknown slug then renders the help 404 with the chrome and a link, but Next caches one 404 per distinct URL (`s-maxage=31536000`, `x-nextjs-cache: MISS` then `HIT`), which is the unbounded-cache-write shape `dynamicParams = false` exists to prevent; `shell-boundaries.test.ts:82` and `help-routes.test.tsx:67` pin `false`. I tried it, measured it and **reverted it**; no committed file changed.
  - *Option B:* accept the framework 404 and say so in the design; or add a root `src/app/not-found.tsx` (a global change, outside this feature).
  - What I did instead: `e2e/help.spec.ts` asserts what is true (404 at the request's own URL, no `/signin` redirect, noindex, and identical bodies for unknown, pending and planned-under-`/help/<x>`), and carries the design's assertion as a `test.fixme` ("an unknown slug renders the help 404") with the finding in a comment, so QA sees it as skipped, not silent. The architect should rule before Phase 5; if Option A, the two `dynamicParams` constants and the two pinning tests change and the fixme comes off.
- **Branch data, not code.** On the first full chromium run `branded-signin.spec.ts` case 1 failed ("Wrong email or password"): `elder.fixture@example.invalid` had been given a throwaway password during the Batch 5a walk (its `updated_at` was that session, and two failed attempts were mine). I reset that one row to the repository's own seeded fixture hash (`scripts/seed-dev.sql:727`) and zeroed `failed_login_attempts`; the spec then passed (5 of 5). `clerk.fixture` and `moderator.fixture` also carry 5a throwaway passwords and were left as found; any spec needing them with the shared fixture password would fail on this branch for the same reason.
- `npm run build` without `rm -rf .next` after a dev run fails with `Can't resolve '@vercel/turbopack-next/internal/font/google/font'` (a stale dev `.next`); `rm -rf .next` first, as the batch notes say.

**Gates (worktree).**
- `npm run typecheck`: clean. `npm run lint`: clean (`--max-warnings=0`).
- `npm run test`: 694 files passed, 97 skipped; 10,517 tests passed, 2,862 skipped, 0 failed (Batch 5a: 690 / 10,499; +4 files, +18 tests).
- `npm run check`: nine tripwires green (`check:proxy-imports` unchanged and passing; `check:help`: 10 entries, 10 published, 10 content files, 0 images).
- `npm run build`: exit 0, from a clean `.next`. Route table: `○ /help`, `● /help/[slug]` (10 paths), `○ /help/planned`, `○ /help/planned/[slug]` (static); `ƒ /signin`, `ƒ /totp`, `ƒ /access-pending` as before.

**The auth-touching smoke (CLAUDE.md Phase 4 gate).** Own server `next dev -p 3660` from a full `rm -rf .next`, with `RATE_LIMIT_DISABLED=true`, `CRON_SECRET`, `STRIPE_WEBHOOK_SECRET`, the `DOMAINS_*` fakes and `AUTH_URL`/`E2E_BASE_URL` set to `:3660` (csrf endpoint confirmed answering before the run). **Before it, global flags were reset to the CI baseline** with `scripts/ci/e2e-reset-flags.sql -v pipeline_branch=1` against this branch's `PLATFORM_DATABASE_URL`; the post-5a flag state was saved first (`flags-after-5a.txt`) and **restored afterwards** (diff empty), so Batch 5b's production-posture walk branch is as 5a left it. QA resets to baseline again before its own run.
- `chromium` project, 14 files: `help.spec.ts`, `help-gates.spec.ts`, `totp-full-login` (the MFA-enrolled user: password, `/totp`, wrong code rejected, real code signs in), `totp-callback-bypass`, `session-claim-integrity`, `member-home`, `header-controls`, `totp-recovery-code`, `totp-code-entry`, `branded-signin`, `post-login-routing`, `developer-2fa-gate`, `admin-login`, `invitation-new-account`: **107 passed, 1 skipped (the `test.fixme` above), 1 failed then fixed (`branded-signin`, branch data above; re-run 5 of 5 passed), 4 not run behind that failure (the same file, re-run)**. `help.spec.ts` + `help-gates.spec.ts` alone: 24 passed, 1 skipped.
- `custom-hosts` project: `e2e/custom-domains/lockdown.spec.ts` **30 passed** (the six new paths are the neutral 404, byte-identical to the reference, no `Set-Cookie`, no `location`, on both a serving host and an unclaimed host).
- **Production lane** `PW_PROD_BUILD=1 PW_PROD_PORT=3661 npm run test:e2e:prod` (its own `next build && next start`, port confirmed free beforehand, stopped after): **97 passed** (`prod-build` hydration specs and `prod-custom-hosts`, which includes the lockdown additions). The design puts `help.spec.ts` in the dev lane only, so it did not run there; I read the production build's help responses by `curl` on `:3661` instead (the 404 measurement above).
- **360px, signed out, anonymous** (`/help`, `/help/signing-in`, light and dark): HTTP 200, no redirect, one `<h1>`, document overflow 0, every header link 44px, the header wraps (wordmark, then Help and Sign in, then Open PresbyPortal). **Home `/` at 360px, signed in** (the design's worst case: wordmark, Help, Sign out, Continue): overflow 0, light and dark; the actions drop to a second line, Help is 44px, Sign out and Continue keep their existing 36px buttons. **Signed out**: wordmark, Help and Sign in on one row, overflow 0. `/signin` and `/access-pending` at 360px: overflow 0, the help link 44px. Screenshots: `help-index-signedout-{light,dark}-360.png`, `help-page-signedout-{light,dark}-360.png`, `home-signedout-{light,dark}-360.png`, `home-signedin-{light,dark}-360.png`, `signin-360.png`, `access-pending-360.png`.

**Not exercised.** The six toggle-off states in a browser (jsdom and the existing page tests only; the target page `turning-features-on-and-off` was walked at 360px in Batch 5a); `/totp`'s link at 360px (a real MFA-enrolled session reaches it in `help-gates.spec.ts`, but I did not take a 360px screenshot of it); the avatar-menu Help item in the console header (shared component, seen only through `/home`).

**Residuals and notes for QA.** (1) `help.spec.ts` imports `../src/lib/help/select` for the page list, so a new page adds its checks automatically; pending and planned entries are exercised only once they exist. (2) The "On this page" check runs with `javaScriptEnabled: false` and clicks the native `<summary>`; it passed on every page that has one. (3) `/docs` and `/docs/x` have no route yet: the proxy admits the prefix, so an anonymous visitor gets the framework 404 at the same URL, which `help.spec.ts` asserts so a later `/docs` tree has to change that test on purpose. (4) The home bar's Help link is a text link (44px); the existing Sign in, Sign out and Continue buttons are 36px as before and were not changed.

**Next.** The architect rules on F-new-g (Option A or B). Then Batch 5b (full-stack-developer): the role walk, then the administrator pages.


## Phase 4 — Batch 5b (full-stack-developer)

*2026-10-28, worktree `presby-help`, content commit `1913918`, not pushed. No `.env.local` value or connection string was printed. Dev server `:3660` started from a clean `.next` with `RATE_LIMIT_DISABLED=true`, stopped by PID (73595 and its child 73597) before the build. Global flags were at the production posture 5a left (diffed equal to `flags-after-5a.txt` before and after; this batch changed none). Scratch, walk output and screenshots: `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/help-5b/` (`w/` walk screens, `shots/` page screenshots).*

**Files.** New: `src/content/help/{first-day-as-administrator,adding-people,officers-and-the-session,roles-who-can-do-what,events-and-the-calendar,your-congregations-website}.md`. Modified: `src/lib/help/registry.ts` (six `published` entries), `slug-history.ts` (six slugs), `coverage-allowlist.ts` (the 13 "Batch 5b" entries and the `LATER_5B` constant deleted), `coverage.test.ts` (`ALLOWLIST_PIN` 29 to **16**, as the design's arithmetic said: 29 minus 13), `docs/product/functionality-map.md` (`Help:` on twelve bullets, the Help index and the Help section's administrator line; "First sixteen pages").

**Markers.** `limitationUntil: signin-invites` on `adding-people` and `officers-and-the-session` (each carries the one sentence "A member of the Session needs a PresbyPortal account to approve. Today the PresbyPortal team sets that up: send a support ticket."; the banner constant `NO_SIGN_IN_INVITE_LINE` says the same and 2b replaces it). The design also named `how-a-congregation-gets-started`, `why-cant-i-see-this` and `using-the-directory` (5a). `verifiedIn` is `0.47.0` on all six (H13 bounds it by this worktree's `package.json`; the orchestrator re-stamps at integration, after a re-walk against 0.48.0, which 2b changes on exactly these two pages).

**Covers and the allowlist.** `first-day-as-administrator`: `route:/o/{slug}`, `route:/o/{slug}/admin`. `adding-people`: `org_portal.members_create`, `tile:members`. `officers-and-the-session`: `tile:officers`. `roles-who-can-do-what`: `tile:roles`. `events-and-the-calendar`: `org_portal.calendar`, `org_portal.public_calendar`, `tile:calendar`, `tile:events`. `your-congregations-website`: `tile:branding`, `org_portal.careers`, `tile:careers`, `org_portal.domains`, `tile:domains`. That is the 13 deleted entries. The 16 left are the deliberate ones of P3-16 (giving x3, mail_domain, sensitive_info, parishes, groups, staff, the five presbytery tiles, the three coming-soon stubs). `tile:groups` and `tile:staff` are mentioned in a table but not covered by a page, so they stay.

**Needs blocks.** `adding-people` (`turnOn` "Community: add people and record roll actions", off by default) and `events-and-the-calendar` (`turnOn` "Member calendar", on by default) are pinned to the catalog by `coverage.test.ts`; the other four carry `who` only (no single toggle applies). No `who` contains a permission key (H11).

### The role walk (precondition; it decided what the pages say)

**Person walked.** A congregation made through the real `/admin/organizations/new` form (invented name, slug `fernhollow-walk`, fixture identities only), a founding administrator designated by an invitation row with a known token (as `e2e/support/invitation-fixture.ts` does), who accepted as a **new account** through the real `/invite` page, signed in, enrolled two-factor through `/account/2fa`, and landed. Walked at 360px as that person with only the per-org defaults (Member calendar on, everything else off), then with the toggles the pages tell a reader to turn on (turned on by that person, through the real Features switches).

**Answers to the Addendum A question.** The founding administrator holds **neither** `branding.manage` nor `events.manage`, and **cannot give either**: "Manage events" and "Branding" tiles are shown on the Administration page, and both pages say "You don't have permission to manage events/branding at <name>. If you think this is a mistake, ask your stated clerk or another administrator there." (event types likewise). Creating a role with either permission is refused ("You can't create a role with permissions you don't hold yourself: events.manage."), as is adding either to the Founding Administrator role ("You can't add permissions you don't hold yourself: events.manage."). The checkboxes are not disabled in the form; the refusal is on save. The role templates (Committee Chair, Giving Recorder, Hiring Committee, Personnel Administrator, Stated Clerk, Treasurer) include no events or branding role. So a first congregation cannot add events or set its colours without the team (a product gap, F-new-i below). Once the team gives the founder a role that carries them (I did this by a database insert, the way the team would, to see those screens), the founder can pass it on: granting that role to another person succeeded.

**What the founding administrator can do (walked):** Features (turned three switches on: "Community: add people and record roll actions", "Public events calendar", "Job openings"); Community (add visitor, participant, member; remove and undo; Pending approvals, approve, see deny and withdraw dialogs); Officers (record, end, self-record); Roles (grant, revoke, create, adopt a template, edit, deactivate); Groups (create a committee, add a member); Staff (record a position); Directory and Calendar (read); Job openings (draft, publish, close, reopen); Tickets tile present (filing walked in 5a). The founder also holds the **Stated Clerk** role from the start (Roles page: two roles held by the person). **Cannot:** events, event types, branding; "Website domain" is not on the Features page and its page says to ask PresbyPortal support.

**Plain member.** The `why-cant-i-see-this` table rests on 5a's member walk (no-role member and Moderator member, tiles shown whatever the role, pages that say "You don't have permission to ..."). This batch re-confirmed the same behaviour as the founder for the two role-gated pages (events, branding): the tile is shown, the page denies. I did not re-walk a plain member of the new congregation separately; no sentence in page 10 contradicts this batch's walk.

**Also walked:** a public website for the walk congregation, provisioned as `e2e/support/public-calendar-fixture.ts` does (a bundle row and a `live` site row; a fixture bundle, no real site), to see the public side: first with no calendar block on any page, then with the calendar and openings blocks placed.

### Page, fact, how verified

Legend as 5a: **W** walked on :3660 as the role named; **C** read in code or the map (not walkable here), listed so QA and Phase 6 can re-check.

**14. first-day-as-administrator** (founding administrator)

| Fact | How verified |
|---|---|
| A one-congregation person lands on the congregation's page | W (founder, after sign in); rule from `destination.ts` and 5a page 9 |
| The page opens with a greeting, "Find a person", "Coming up", and tiles under Community, Worship & Events, Governance & Courts (and Reports & Insights, Communications) | W (360px portal text) |
| Every tile is shown whatever the role; a tile you cannot use opens a page that says you don't have permission | W: Manage events, Branding, Features pages as founder with and without the role |
| Three tiles describe an idea and nothing works ("Worship & Service Planning", "Insights & Analytics", "Communications") | W (5a, and the portal text here); their own label is not quoted (H8) |
| The Administration page is headed "Organization Administration" and, in a new congregation, lists Manage events, Roles, Tickets, Features, Branding | W (before any toggle) |
| Menu is a three-line button on a phone | W (5a) |
| What can be used on day one, and what cannot (table became two lists after a 360px look) | W: each page opened or acted on; Directory (shows the recorded member, search and Households views) and Calendar read |
| The founder also holds the Stated Clerk role | W: Roles page |
| The calendar is on from the start; Community and Job openings start off | W: Features page |
| "Job openings turned on." confirmation | W: toast |
| A sensible order; at least one Session member needs an account; you can record yourself | W: Pending banner states and self-recorded elder (see page 18) |
| `Website domain` not on Features; the team turns it on | W (5a and here): page text "ask PresbyPortal support to turn it on" |

**16. adding-people**

| Fact | How verified |
|---|---|
| Until the toggle is on the page says "Member management isn't turned on" | W |
| Community page: links "Pending approvals", "Add person"; views Everyone, Members, Participants, Visitors, Staff, Former; "Search people" | W |
| Visitors are listed under Visitors only, never in the directory | W: visitor appears under Visitors, not under Everyone; wizard text "not listed in the Directory" |
| Staff view: "No position yet" marker; Former lists a removed participant with the date | W: a staff anchor with no position; a participant removed, then Former showed "Removed 10/20/2026" |
| Add person steps and fields (Find a matching record, Name & birth date, Contact & address, Household, Connection, Review & submit); "Step 1 of 6" (7 with a match) | W: all six steps, and the match path |
| "C. Wainwright is already in this community", "Open their record", "No, this is someone new" | W: second search for a recorded visitor; the page prints initials and last name |
| Email rows: Main address, Add another email address, labels Personal/Work/Other, "Don't send mail to this address" | W: step 3 and the edit page |
| Three connections, their descriptions, and messages "Visitor added." / "Participant added." / (member: a message that the person appears as a member once the Session approves, not quoted) | W: all three recorded |
| Remove as participant (end date, effect), Undo last entry (reason, original kept) | W: dialogs read and removal performed |
| Record a roll action options and the sentence "Enrolling someone as a participant takes effect now. Every other action is proposed and waits for the Session to approve it." | W: person edit page |
| Pending approvals: Approve (minute reference), Deny (reason, 500), Withdraw (reason, proposal stays), "Recently decided", "You proposed this", "Self-approved" | W: dialogs read; one approval performed by the self-recorded founder |
| "Select all on this page" and a cap of 50 | W for the checkbox; **C** for 50 (`BULK_APPROVE_MAX`, `src/lib/roll-action-kinds.ts`) |
| Banner states: empty, term not begun, no account, no permission; no banner when someone can approve | W for empty ("Your Session roster is empty"), term not begun (a future-dated elder), no account (an elder with no sign-in), and ready (no banner); **C** for the no-permission variant (`session-state-banner.tsx`) |
| A member of the Session needs an account; the team sets that up by ticket (the limitation) | W: banner text; marker `signin-invites` |
| "No Session to approve" (organizations without a Session) | Not stated: a congregation does not see it; removed from the page |

**18. officers-and-the-session**

| Fact | How verified |
|---|---|
| Officers page, "Current roster", "End term", "No officers recorded yet" | W |
| Offices listed; start date required; Elected on, Installed on, Class year, Minute reference optional; "Officer term recorded." | W |
| Recording does not change what a person can do except the Session and the Moderator of the Board of Deacons seat; other access under Roles | W: page text |
| A deacon's form says districts are off when Parish management is off | W: "Districts aren't turned on yet" |
| Pastors: recorded without a roll membership; add from Staff first; a person on the roll is refused ("... a pastor can't also be recorded on the roll here.") | W: both the notice and the refusal |
| End term: end date, reason (Completed, Resigned, Removed, Deceased), "it stays on record, it is not deleted" | W: dialog read and a term ended; the roster then shows none |
| A person's officer history lists every term with dates and reason | W: `/admin/officers/<person>` |
| The Session roster is built from terms; Groups page "Automatic rosters" lists Session and Board of Deacons | W |
| A later-dated term seats the person on the start date | W: the banner "The term begins 1/1/2027" |
| Recording yourself is allowed; roster "Self-recorded"; approvals "Self-approved" | W |
| Limitation sentence (account needed, team sets it up) | W: banner text; marker `signin-invites` |

**19. roles-who-can-do-what**

| Fact | How verified |
|---|---|
| Page parts "Who holds what", "Grant a role", "Role catalog"; the five roles and who holds them at first | W: the table above is the page's own rows |
| Grant a role (person or group, role, person), "Role granted."; the seat role is refused ("held through the ... seat, so it can't be granted here") | W |
| Revoke dialog (grant ends, stays on record); the lockout guard on revoking | W: dialog read; revoking the founder's only role-giving role was refused with the quoted sentence |
| Create role (key rule, name, grouped permission list, "Role created."), adopt template ("Role adopted from template."), Edit, Save changes, Deactivate role (dialog; "Deactivated" in the catalog), Constitutional roles have no Edit | W: created, adopted, edited, deactivated one |
| Lockout guard on editing ("Removing this would leave nobody able to create or edit roles...") | W |
| "You can only give what you hold" refusals and wording | W: both messages, for a new role and for an edit |
| What a founding administrator can and cannot do | W: see the walk summary above |
| When the team gives you a role that allows them, you can give it on | W: granted the team role to another person as the founder |

**20. events-and-the-calendar**

| Fact | How verified |
|---|---|
| Calendar page: Month/List, arrows, "Show filters", "Copy month", event detail; a cancelled event leaves it | W (as founder, 360px); cancelled event absent from `/calendar` and the public calendar |
| "Copy month" leaves out events not open to everyone | **C**/W: the event form says "It also stays out of Copy month"; the cancelled-event omission and the omitted count are **not stated** (code only) |
| "Coming up" card on the congregation's page | W for the empty state ("Nothing is on the calendar right now."); the card with events in it was not re-checked, and the page says only "the next events" |
| Reading comes with the Member role; adding needs a role a founder lacks | W: Roles page ("Member", 2 permissions); event pages deny the founder |
| "Add an event" and "Manage events" appear on the Calendar page only for a holder | W: absent before the role was given, present after |
| Event form fields, "Event created.", "Edit event", "Cancel event" (dialog says it stays on record), "Cancelled" in the list | W (as a role-holder) |
| "Open to everyone, not only members" ticked at first; unticked = member calendar only, out of Copy month, cannot be on the website | W: form text |
| Repeats: simple interval (Weekly, Every 2 weeks, Monthly (same date)) or a specific day (Which: 1st to last, Day), occurrences 1 to 52 ("Enter a number of occurrences from 1 to 52."), each date its own event, "Part of a series", "Extend this series" | W: created an 8-date weekly series; tried 53. **Design said "weekly or monthly by weekday"; the screen differs, the page follows the screen** |
| Event types: a set at the start, some "Retired" and with an "Offered" switch; "General" default ("The default type can't be retired."); "Add an event type" (name, colour, icon); arrows reorder | W: the page at 360px |
| The event-type permission description is quoted | **C** (the string lives in the seeded permission catalog, not in `src/`, so it is not in `labels[]`) |
| Public calendar needs three things; the event page says it appears once the public calendar is on and the website has a calendar page | W: with toggle on and events marked, a site with no calendar block shows no calendar on `/events`; with the block placed, the calendar shows the marked events month by month with Previous, Today, Next, a cancelled event absent |
| Series website listing ("Put this and later events on the website"; dialog says how many; "Take this and later events off the website") | W for the put-on action and its dialog; the take-off button was seen, not pressed |
| Warning text about the public, search engines and archives | W: form text |

**21. your-congregations-website**

| Fact | How verified |
|---|---|
| Colour, type pairing (Classic, Modern, Warm, Contemporary), logo (PNG, JPEG, WEBP, up to 2 MB), "Light mode only", "Save brand", "Brand saved." | W as a role-holder |
| The colour is used in the portal and on the public website | W: after saving, the computed primary colour was the new one on both `/o/<slug>` and `/site/<slug>`. Type pairing and logo on the site are **not stated** |
| A founder lacks Branding | W |
| Job openings: toggle, tile under Community, form fields, "Save draft", Publish ("Yes, publish", "Published."), "View on your website", Close and Reopen dialogs, closing date meaning, web address rule, paste-from-Word note | W: drafted, published, closed, reopened |
| "People are asked to contact the church to apply" | W: the Features card text; no application form exists in the page |
| The list page's address ends in /careers and the line under the heading says where openings appear; "ask whoever maintains your website" | W for the sentence with a placed block and the list address, and the unknown case; the "no other page shows them" wording is **C** (`placement-line.tsx`) |
| The list of openings appears on its own page whether or not a block is placed | W: `/careers` on the platform address listed the opening with no block placed |
| Public Listing switch on Officers, Staff and a group; the confirmation text; the person appears on the website only where the list is placed | W: all three dialogs; a listed staff member appeared on a page that carries the list block and "No one has been listed here yet." before |
| The Public listing column is not shown on a phone | W: hidden at 360, shown at 1280, on Officers and Staff |
| Page text, images and menus are not edited in PresbyPortal; support ticket | Operator ruling; no screen edits them |
| A web address of your own: ask us; the Website domain page text | W (5a and here) |
| Giving pages, application forms, photos | Not described |

**Neighbour greps for the record (C6 check 4).** `You don't have permission to manage events|branding` found on the two pages quoted (true); toggle-off sentences (true); `NO_SIGN_IN_INVITE_LINE` quoted in prose only (true now, replaced by 2b); the map's "weekly / monthly-by-weekday patterns" on the Events administration bullet is **not** what the form offers (Weekly, Every 2 weeks, Monthly (same date), or the nth weekday): the map bullet is stale, not edited here.

### Findings and deviations

**For numbering (F350 onward, after the design's six and 5a's a to e; I use letters).**
- **F-new-h.** The "Public listing" and "Display order" columns on Officers and Staff are `hidden sm:table-cell`: on a phone an administrator cannot see or change who is named on the website. The Staff and group roster show the same. The page says "use a wider screen". Product question: show them on a phone.
- **F-new-i.** A first congregation cannot add events or change its colours without the PresbyPortal team: the founding-administrator bundle has neither key, the role form refuses them, and no role template carries them (`events.manage` has no default binding by DECISION-115). The Features card, the portal tile and the Administration page all offer "Manage events" and "Branding" to that person. The help pages say so plainly and point to the team ({{contact}}). Product question: give the founding administrator the two keys, or add a template. If that ships, edit `roles-who-can-do-what`, `events-and-the-calendar`, `first-day-as-administrator`, `your-congregations-website` (there is no `limitationUntil` for it).
- **F-new-j.** The Event types page seeds a new congregation with nine types and four already "Retired" (Special Services and Holidays, Music, Meals and Fellowship, Mission and Outreach). Not stated as a list; the page says "a set ... some are switched off at first".
- **F-new-k.** The Roles page's "Granted by" column shows the platform administrator's address to the congregation's administrator for the two roles the team gave. Not stated in help; a privacy question for the operator.
- **F-new-l.** The map's Events administration bullet describes recurrence patterns the form does not offer (above).
- **F-new-m (observation).** A visitor can be recorded as a Ruling Elder, and counts as a Session seat in the banner state ("1 member of the Session is recorded, but none has a PresbyPortal account yet"). Not stated in help.

**Deviations from the outline (each a narrowing or a replacement by what the screen shows, none a reword to sound safer).**
1. `first-day-as-administrator` states `Branding` and `Manage events` as "cannot yet", from the walk, not as available (the outline left it to the walk).
2. The first-day, three-connections, banner and website tables became bulleted lists after the first 360px look: three-column tables scroll sideways inside their region at 360px (measured 384 inside 326) and the answer column was off screen. Two-column tables (the roles page) fit.
3. `officers-and-the-session`: the outline's "Why Pending approvals says no one can approve yet" is one paragraph with a link to the banner list on `adding-people`; the "ordination is lifelong" and "class_year" notes are not stated.
4. `roles-who-can-do-what`: the outline's "Roles that come from a seat" is the table's group rows plus the refusal for the Moderator seat; I did not describe giving "Session member" by hand (it succeeds, and gives approval rights regardless of the Session, which I do not recommend and did not teach).
5. The outline's Needs `turnOn` for `events-and-the-calendar` could name only one toggle; it names "Member calendar" and the public calendar switch is in the page body.
6. `your-congregations-website` says nothing about committee members' public listing beyond "each group's roster" (the dialog was walked on a group roster) and nothing about giving or photos.
7. Dynamic strings (counts, names, dates, "Step 1 of 6") are quoted in prose where helpful but are not in `labels[]` (H10 needs them literal in `src/`); labels were chosen by running each quoted string against `src/`, and ultra-generic ones ("Edit", "Search", "Close") were left out as vacuous.

**Quoted but not label-checked:** the two permission descriptions ("Create, edit, and cancel calendar events, including repeating series"; "Create, rename, recolor, reorder and retire the event types that color-code the calendar") come from the seeded permission catalog, not `src/`; "Enter a number of occurrences from 1 to 52." is assembled from a constant. They were read on screen in this walk.

**Walk residue on the branch only.** The Fernhollow walk congregation, its users (`founder.fh@example.invalid`), four people, events, a published job opening, a fixture site bundle and row, one custom role (`calendar_and_brand_team`) granted to the founder by database insert (the way the team would) and never revoked, extra custom roles made in the walk, a saved brand colour. Nothing touches `development` or production. The global flags are unchanged.

**Gates (worktree).**
- `npm run typecheck`: clean. `npm run lint`: clean (`--max-warnings=0`).
- `npm run test`: 694 files passed, 97 skipped; 10,517 tests passed, 2,862 skipped, 0 failed (Batch 3 was 694 / 10,517: no test added; `coverage.test.ts` now pins 16 and passes).
- `npm run check`: nine tripwires green; `check:help`: "16 registry entries, 16 published, 16 content files, 0 images".
- `npm run build`: exit 0 from a clean `.next`; `○ /help`, `● /help/[slug]` with 16 paths (three listed plus "+13 more"), `○ /help/planned`, `○ /help/planned/[slug]`.
- 360px, light and dark, anonymous (the proxy now bypasses `/help`): the index and each of the six new pages, HTTP 200, one `<h1>`, document overflow 0, every header link 44px, "On this page" present. Three-column tables scroll inside their focusable region; none remains on the six pages except the two-column roles table. Screenshots: `shots/<slug>-{light,dark}-360.png`. Read in full: first-day (light), adding-people (dark), events (dark), roles (light).
- Not exercised: the "On this page" `<details>` on iOS (jsdom and Batch 3's `help.spec.ts` cover it); a print preview; the Fernhollow pages as a plain member of the new congregation; the no-permission banner and bulk approve in a browser.

**For Phase 5/6.** Re-walk as a founding administrator: the two role-gated pages (events, branding) after any change to the founding-administrator bundle; the banner states after 2b merges; every `limitationUntil` sentence (`adding-people`, `officers-and-the-session`) goes when `signin-invites` is Done. `verifiedIn` is `0.47.0` on all sixteen and must be re-stamped by a walk on 0.48.0.

**Next.** Batch 4 (full-stack-developer): the screenshot capture project and the seven images, then Batch 5c.


## Phase 4 — help 404 follow-up and Batch 4 (full-stack-developer)

*2026-10-28, worktree `presby-help`. Commits: `7f4363e` (`fix(help)`, the 404 catch-all) and `097b43e` (`feat(help)`, the capture and seven images); this record is its own docs commit. Not pushed. No `.env.local` value or connection string was printed or edited. Dev server `:3660` and production server `:3661` were started from a clean `.next` and stopped by PID; both ports are free. Scratch: `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/help-b4/`.*

### Part 1: the help 404 catch-all (Option C exactly as ruled)

**Files.** New `src/app/(documentation)/help/[...unmatched]/page.tsx` (the file text is the ruling's, verbatim); comment change in `help/[slug]/page.tsx`. Tests: `shell-boundaries.test.ts` (catch-all added to the expected list and excluded by name from the `dynamic = "error"` and `dynamicParams = false` counts, which stay 4 and 2; a new test that the catch-all is `force-dynamic`, imports only `next/navigation`, contains no `generateStaticParams`, `generateMetadata`, `dynamicParams` or `params`; a new test that no root `not-found.tsx` or `global-not-found.tsx` exists), `help-routes.test.tsx` (the catch-all is `force-dynamic` and throws `NEXT_HTTP_ERROR_FALLBACK;404`; line 67's `dynamicParams === false` kept), `e2e/help.spec.ts` (fixme and FINDING comment removed; the "indistinguishable" test gains `/help/planned/no-such` and `/help/no-such-page/deeper`, and asserts the shared body contains "We couldn't find that page" and "Go to the help index"; the `/help/planned/<unknown>` test lost its "status and URL only" restriction), new `e2e/help-404.spec.ts` (three paths, two requests each: 404, the heading, the link, `cache-control` contains `no-store` and not `s-maxage`, no `x-nextjs-cache`), `playwright.config.ts` (`prod-build` `testMatch` is `/(hydration\/.*|help-404)\.spec\.ts$/`), `e2e/custom-domains/lockdown.spec.ts` (`/help/no-such-page/deeper` in `PLATFORM_PATHS`).

**Design doc updated (as the orchestrator's note asked).** E2E item 2 now reads: unknown, pending, `/help/planned/no-such` and `/help/no-such-page/deeper` each render the help 404 through the catch-all with the same body, plus `help-404.spec.ts`. The R3 Carry-forward row says "every content route" means the four content pages and the catch-all is `force-dynamic`; the R9 row says `help/not-found.tsx` is reached through the catch-all and that no root `not-found.tsx` or `global-not-found` exists. Two sentences elsewhere that stated the old mechanism (the static-lock section's 404 bullet, Edge Case 2) were reworded to match.

**Red first.** With `e2e/help-404.spec.ts` and the `help.spec.ts` edits written and no catch-all, on `:3660`: 4 failed, 24 passed. The failures were the heading assertion (`Expected "We couldn't find that page"`, received the framework's `404`) on `/help/no-such-page` and `/help/no-such-page/deeper`, the "indistinguishable" test, and the former fixme. `/help/planned/no-such` passed, as the Batch 3 finding predicted, because the planned list is empty today. The unit tests were red too (`help-routes` failed to import the missing file; two `shell-boundaries` cases). After the catch-all: `help.spec.ts` + `help-404.spec.ts` 28 passed on dev; `lockdown.spec.ts` 30 passed (`custom-hosts`).

**Production lane, from a clean `.next`, flags at the CI baseline first** (`scripts/ci/e2e-reset-flags.sql -v pipeline_branch=1`): `PW_PROD_BUILD=1 PW_PROD_PORT=3661 npm run test:e2e:prod` **100 passed** (Batch 3's 97 plus the three `help-404` cases, which ran in `prod-build`; `lockdown` and the rest in `prod-custom-hosts`). The first attempt failed in the web server's `next build` with the known `Can't resolve '@vercel/turbopack-next/internal/font/google/font'` after a clean `.next`; an identical standalone `npm run build` and the second lane run were green, so it is a transient font-fetch failure, recorded not chased. The production-posture flags were restored from `help-b3/flags-after-5a.txt` (`restore-flags.sh`, diff empty, "FLAGS-RESTORED-IDENTICAL"), at the end of Part 1 and again at the end of Part 2.

**Extra check the ruling did not ask for (production build, a temporary planned entry).** The planned list is empty, so the tests above cannot show what happens once Batch 5c adds a planned page. I added a throwaway planned entry to the registry (reverted; `git status` clean), built, and read `next start` on `:3661`: `/help/no-such-page`, `/help/planned/no-such`, `/help/no-such-page/deeper` and `/help/scratch-plan` (a planned slug at the wrong path) were all 404 with `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` and the help 404 content; `/help/planned/scratch-plan` was 200 with `s-maxage=31536000` (a prerendered page, as intended). So the catch-all does catch a miss when `planned/[slug]`'s `generateStaticParams` is non-empty.

**Finding F-new-n (observation for the architect; blocks nothing).** The 404 body is client-rendered. With JavaScript held, `curl` of `/help/no-such-page` (and, on this build, `/site/<unknown>`, which is existing behaviour) returns the status 404 and the `noindex` meta tags but an HTML shell with `id="__next_error__"` and no `<h1>`: the help 404 content is in the RSC stream (`E{"digest":"NEXT_HTTP_ERROR_FALLBACK;404"}`) and appears after hydration, which is what every browser test sees. A reader with JavaScript off sees a blank page where, before the catch-all, they saw the framework's server-rendered "404". It is the same behaviour `notFound()` already has elsewhere in this app, so I left it. The Vercel preview check remains the open merge gate.

### Part 2: Batch 4, the fixture-only capture

**Files.** `playwright.config.ts` (`isHelpShotsRun` from `PW_HELP_SHOTS=1`, throws with `PW_VISUAL` or `PW_PROD_BUILD`, a `help-shots` project only when true, the `chromium` `testIgnore` gains `/help-shots\//`, and `globalSetup` is `e2e/help-shots/global-setup.ts` for that run); `package.json` (`"help:shots": "PW_HELP_SHOTS=1 playwright test --project=help-shots"`); new `e2e/help-shots/{guard,global-setup,fixture,capture.spec}.ts`; `src/lib/help/shots-guard.ts` (pure additions: `dbIdentity`, `urlHost`, `buildShotsSnapshot`, `describeShotsRefusal`) and `shots-guard.test.ts` (+17 cases: 31 in all); `screenshots-data.ts` (seven entries), `screenshots.ts` (seven static imports), `screenshots.test.ts` (the real manifest resolves every id); seven PNGs under `src/content/help/images/`; `![…](shot:<id>)` plus a sentence in six pages (`signing-in`, `using-your-code`, `first-day-as-administrator` (two), `turning-features-on-and-off`, `adding-people`, `events-and-the-calendar`; the design's table names six pages although the task said five).

**Deviations from the design, each a tightening or a forced fix.**
1. *The guard runs in `globalSetup` before the standard setup, and again in `beforeAll`.* The standard setup writes the e2e roster into whatever database the environment names, so a `beforeAll` guard would refuse after it had already written into a real database.
2. *G4 compares `host/database`, not the host.* A scratch database and its parent share a host; the pooler suffix is dropped because the app URL (direct) and owner URL (pooled) legitimately differ in it (the first run of the guard on a clean database refused on exactly that).
3. *G2 reads what the table has.* `organization_profiles` has a phone and five URL columns and no email or website column. The pure decision is unchanged; `buildShotsSnapshot` maps the URL columns to `websiteHost` (the first host not on `.invalid`) and `email` to null, and an unparseable value fails closed.
4. *The element text rule allows `.invalid` addresses.* The design said "contains no `@`"; the seeded people carry `.invalid` addresses. The spec fails on any email-shaped string that is not `.invalid`, in the element's text **and in its field values**, hides every placeholder, and the community image is cropped above the first seeded address anyway.
5. *The founding administrator is made, not found.* No seeded user is one. The spec links the seeded person (an invented name) at Alder Creek to the `mfa-enrolled` fixture (a founder's role requires two-factor, and that fixture has a real TOTP secret), end-dates the two seeded role managers (the helper refuses a congregation that already has one), then calls `presby_apply_founding_administrator`, the helper acceptance calls, so the bundle is the real one. Idempotent on a re-run. Alder Creek stands in for a "new" congregation: it has history, so the images show a congregation with several features on; each page says so in a sentence.
6. *Tall elements are cropped to a CSS-pixel height*, not photographed whole (the Features list alone was 3,800 CSS px): `portal-tiles` 1372, `features-list` 1160, `community-list` 725, `calendar-month` 1110. The crop stops between cards.

**Findings.**
- **F-new-o (caught by reading the pixels, the reason the read is a gate).** The first sign-in capture showed a pre-filled-looking address in the email box: it is the starter's own input placeholder (`admin@claudecode.info`, `src/app/(auth)/signin/signin-credentials-form.tsx`), which `innerText` does not see. It is hidden in every capture (`::placeholder` transparent) and field values are now scanned. The placeholder itself is pre-existing, in source, and visible to every visitor of `/signin`; for the operator to decide whether it should be an `.invalid` example.
- **F-new-p.** The `admin-hub` image is 2,208 px wide (the design's 1280 viewport) and is shown at 328 px on a phone, so its text is small there. The page says "on a wide screen". An option for the architect: a second, 360px capture, or a narrower element.
- Alder Creek's seeded people include one address (`renwick.balakrishnan@example.invalid`) shown on two different people in the Community list; the crop avoids it.

**The refusal, proven (the pipeline branch is a copy of `development`).** `HELP_SHOTS_DB_OK=1 E2E_BASE_URL=http://localhost:3660 npm run help:shots` against `.env.local`, before anything else ran (log: `help-b4/refusal-attested.log`):
```
Error: [help-shots] REFUSING TO CAPTURE: this database is not provably fixture-only.
  G1: 3 organization(s) outside the fixture list.
  G2: 1 organization profile row(s) outside the fixture rules.
  G3: 1 user or contact email(s) not on the .invalid domain.
```
Without the attestation it adds `G5`. Counts only; no value. Nothing was written to that database (the refusal precedes the standard setup).

**The from-scratch database.** `createdb`-style (`create database help_shots` as owner on the `pipeline-user-help` branch, through `.env.local`'s owner URL); `npm run db:migrate`, `check:schema-parity` (0 failing), `db:seed`, `psql -v ON_ERROR_STOP=1 -f scripts/seed-dev.sql`, all pointed at it by exporting the five URLs with only the database name changed (a 0600 file in the scratchpad; `.env.local` untouched, and `dotenv -e` does not override an exported variable: Playwright printed "injected env (0)"). Ten organizations, all in `FIXTURE_SLUGS`, no profile row, 11 users. It was dropped and rebuilt once more before the final capture (so the committed images come from a database built from nothing with the final code) and dropped at the end; `pg_database` now lists `neondb`, `postgres`, `template0`, `template1`. The dev server on `:3660` used it through the same environment; the audit and role-grant rows landed there and none on `pipeline-user-help` (`founding_administrator` grants at Alder Creek: scratch yes, pipeline 0).

**The capture.** `HELP_SHOTS_DB_OK=1 E2E_BASE_URL=http://localhost:3660 npm run help:shots` with the scratch URLs exported: 3 passed (a recipe per manifest id; the capture; sizes and `capturedIn`). The stamp check was shown to fail with `capturedIn: "0.46.0"` ("set capturedIn to 0.47.0 for these ids") and the size check names the right numbers on a first run. Global flags on the scratch database were captured and restored by the spec (verified by SELECT).

**Every image opened and read (the final set, from the from-scratch database).** Viewport, then what it shows, then names.

| Image | Viewport and size | Shows | Real name, address, email or congregation? |
|---|---|---|---|
| `signin-form.png` | 360, 720x1312, 45 KB | The "Sign in" heading, the Google button, "or", empty Email and Password boxes, "Sign in with email", "Forgot password?", "Help with signing in" | None (the starter placeholder is hidden; the boxes are empty) |
| `totp-boxes.png` | 360, 624x380, 23 KB | The label, six empty boxes, Verify, "Use a recovery code instead" | None |
| `portal-tiles.png` | 360, 624x2744, 134 KB | "Community" with the Community, Directory, Groups, Staff and Job openings tiles, then "Worship & Events" and the Calendar tile | None; no greeting, household or header |
| `admin-hub.png` | 1280, 2208x2652, 219 KB | "Organization Administration" and the cards Manage events, Manage giving, Website domain, Roles, Tickets, Features, Branding | The invented "Alder Creek Presbyterian Church" in the subtitle |
| `features-list.png` | 360, 624x2320, 167 KB | "Features", the six ministry-area switches, the first feature card with "Last changed 10/28/2026" and a time, no address | "Alder Creek Presbyterian Church" (invented) |
| `community-list.png` | 360, 624x1450, 97 KB | "Community", Pending approvals (1 waiting), Add person, the view tabs, a search box, "Showing 10 people of 10", two person cards (Marguerite Ashcombe, Corwin Ashgrove) | Invented names only; no emails (cropped above the first) |
| `calendar-month.png` | 360, 624x2220, 186 KB | "Calendar", Today and Copy month, "October 2026", five days of events (worship, a Bible study, a youth pizza night, a Session stated meeting) | "Alder Creek Presbyterian Church"; invented events |

None shows a real person, congregation, address or email, a brand mark of a tenant, the avatar menu, a page header or footer, a toast or the Next dev indicator. Every image is within 400 KB (`check:help` H17 passes with 7 images). On the six pages at 360px each image loads, is scaled to the column (328 px) and there is no horizontal overflow; `help.spec.ts`, `help-404.spec.ts` and `help-gates.spec.ts` pass on dev (36).

**Gates (worktree), each part.** `npm run typecheck` clean; `npm run lint` clean; `npm run test` Part 1 **10,521** passed (+4), Part 2 **10,534** passed (+13), 694 files, 97 skipped, 0 failed; `npm run check` nine green (`check:help`: "16 registry entries, 16 published, 16 content files, 7 images"; `check:secrets` first failed on connection-string-shaped literals and a `gmail` address in my guard tests, fixed by building the strings from parts, not by annotation); `npm run build` exit 0 from a clean `.next`, route table `○ /help`, `ƒ /help/[...unmatched]`, `● /help/[slug]` (16 paths), `○ /help/planned`, `○ /help/planned/[slug]`.

**Housekeeping.** `e2e/support/.auth/` (gitignored cached sessions, 12-hour freshness) was deleted after the capture, because the cached sessions were issued against the scratch database's user ids and would have been reused by the next e2e run on `pipeline-user-help`. The Part 1 `restore-flags` check left the branch's flags identical to `flags-after-5a.txt`.

**Not done or not exercised.** The Vercel preview check of the catch-all (merge gate, orchestrator); a no-JavaScript reading of the 404 (see F-new-n); the `help:shots` project on the production lane (it is a dev-server tool by design); the dark scheme (light only, by design); `/help/<slug>` image rendering on iOS.

**For Phase 5/6.** Re-read all seven images (the human line in QA's verdict). Each image's page sentence ("The congregation in this picture has already turned on its features...") is a claim: re-check it against the fixture the images came from. If the first live congregation's toggles change, or the founding-administrator bundle changes (F-new-i), the images and the Features and hub sentences need a re-capture. Re-capture is `HELP_SHOTS_DB_OK=1 E2E_BASE_URL=http://localhost:<port> npm run help:shots` against a from-scratch database only, then bump `capturedIn` and the sizes it names.

**Next.** Batch 5c (full-stack-developer): the pending pages and the approved placeholders. The first planned placeholder makes `planned/[slug]`'s `generateStaticParams` non-empty, which is the case the temporary-entry check above covered.


## Phase 4 — Batch 5c (full-stack-developer)

*2026-10-28, worktree `presby-help`, commits `d7e5d39` (`docs(help)`, the pages and placeholders) and `366a1d3` (`fix(auth)`, the sign-in placeholder). Not pushed. No `.env.local` value or connection string was printed. Dev server `:3660` was started from a clean `.next` and stopped by PID (31735 and its npm parent); the port is free. Scratch, scripts and screenshots: `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/help-5c/`.*

**Phase 4 is complete.** What is left is Phase 5 (QA) and, at integration, the orchestrator's publish step for the pending pages (below).

### Files

- **New, pending (seven):** `src/content/help/{accepting-your-invitation,setting-up-two-factor,sign-in-invitations,who-is-asked-for-a-code,reimbursements,reimbursements-for-treasurers,photos-of-people}.md`.
- **New registry entries:** seven `pending` (each with its `requires` token, `verifiedIn: null`, `covers`, `labels`, and a `needs` block where the design called for one) and five `planned` (`worship-planning`, `children-check-in`, `communications`, `event-sign-ups`, `presbytery-tools`; `confirmedOn: 2026-10-26`, the operator's O1 date; the "Today:" and "Who it is for" lines are the design's table, verbatim). `src/lib/help/slug-history.ts` gains the five planned slugs (pending slugs are appended by the commit that publishes them, which is what `check:help` H3 requires).
- **Struck placeholders** (`ledger`, `meeting-minutes`, `directory-export`) are not present anywhere.
- **Changed titles and summaries:** `accepting-your-invitation`'s summary now ends "...set up two-factor sign-in if you are asked." (the design's text was written before F343, and on 0.48.1 plus F343 whether you are asked depends on your role; C4 says pending summaries are provisional). The other six are the design's, unchanged. The five planned entries' `summary` (used only as the page's meta description) is "{Name} is not available yet. There is no date."
- **`fix(auth)`:** `src/app/(auth)/signin/signin-credentials-form.tsx` (placeholder `you@example.org`) and a new `signin-credentials-form.test.tsx`. No existing test pinned the old placeholder (grep of `src`, `e2e`, `scripts`); the only other mention is `scripts/check-secrets-pii.test.mjs`, which uses the starter's domain as a fixture for the allowlist and is unrelated. `e2e/help-shots/capture.spec.ts` still hides placeholders; the hide is now defensive and its comment stays true enough, so the file is untouched (the `signin-form.png` image shows empty boxes either way and needs no re-capture).
- **`src/lib/help/config-imports.test.ts` (one-line regex fix, found by this batch, F-new-q below).**

### Where each pending page's facts came from (page, fact, how verified)

Legend: **M** read in the merged code on main (`../presby`, HEAD `5059611`, 0.48.1), file named; **P** read in the pipeline's own tree and Phase 6 record; **L** a label, matched by script (below). **No pending page was walked on a running server**: none of the five features is in this branch, and 2b and F166 are in main only. The orchestrator's re-walk at integration, and Phase 6's, are the verification; Phase 5 should not read these pages as walked.

**accepting-your-invitation (`recovery-codes`)**

| Fact | Source |
|---|---|
| The email: heading "You're invited to PresbyPortal", button "Accept the invitation", names the congregation, says when the link stops; "Nothing happens unless you accept"; a designation email says a PresbyPortal administrator invited you | M `src/lib/onboarding/invitation-email.ts` |
| The link page "You're invited", masked address, expiry date, "Create your account" (First name, Last name, Password, Confirm password, the 8-character rule, "Create account"), "Already have an account?" with "Sign in to accept" | M `src/app/(invite)/invite/{invite-summary,anonymous-state,accept-form,sign-in-to-accept-form}.tsx` |
| "Your account is ready" and no automatic sign-in | M `invite/accepted/page.tsx` |
| Signed in: "Accepting as ... at ..." with "If that isn't you, don't accept", "Accept invitation"; the mismatch page "You're signed in as another account" and "Sign out to accept"; the two-factor page "Verify and continue" | M `confirm-state.tsx`, `mismatch-state.tsx`, `two-factor-state.tsx`, `accept-signed-in-form.tsx` |
| Accepting lands in the congregation (`/launch?next=/o/<slug>`) | M `(invite)/actions.ts:261`, `no-organization/actions.ts:154` |
| The same dead-link page for every cause, its sentence and "Go to sign in" | M `dead-link-state.tsx`, `src/lib/onboarding/labels.ts:135` |
| The in-place card "You're invited to {congregation}" / "You have {n} invitations", "Accept the invitation" | M `src/lib/onboarding/no-organization-copy.ts` |
| Two-factor is asked "depending on your account, your role and your congregation" (rule-neutral, true before and after F343) | M `accepted/page.tsx` ("If your role needs two-factor sign-in"); P F343 Phase 6 |

**setting-up-two-factor (`recovery-codes`)**

| Fact | Source |
|---|---|
| The enrolment page, its steps, the key, the 10-minute QR, the six boxes and "Confirm enrollment" | M `src/app/(account)/account/2fa/totp-enroll-form.tsx`; `PENDING_TTL_MINUTES = 10` in `src/lib/totp-pending.ts` |
| After the code: "Two-factor authentication enabled", the "shown only once" sentence, "Recovery codes — save these now", ten codes, "Continue", the optional "once more" line | M `enrolment-handoff.tsx`, `recovery-codes-panel.tsx`, `continue-button.tsx`; `RECOVERY_CODE_COUNT = 10` in `src/lib/two-factor.ts` |
| The returning view "You enrolled on", "{n} unused codes remaining (of {total} total)", the Account card ("Not set up", "Active", "Set up two-factor authentication", "Manage / regenerate codes") | M `2fa/page.tsx`, `src/app/(account)/account/2fa-status.tsx` |
| Regenerating: "Regenerate recovery codes", the footnote that a reload loses the codes, "New recovery codes — save these now", old codes stop | M `regenerate-codes-form.tsx` |
| Regenerating needs a verified session: "To make new recovery codes, first confirm it's you ..." and "Confirm it's you" | M `confirm-its-you.tsx`, `2fa/page.tsx` (`session.user.twoFactorVerified`) |
| The four refusal sentences | M `2fa/actions.ts`, `totp-enroll-form.tsx`; P `docs/work-log/2026-10-26-recovery-codes.md` Copy C8 to C11 |
| What the page does not say: "you will not be asked again" (the record forbids it); that the codes can be copied by a button (none exists; the record lists it as a follow-up) | P Phase 3 Copy checks, Phase 6 follow-ups |

**sign-in-invitations (`signin-invites`)**

| Fact | Source |
|---|---|
| The card "Sign in to PresbyPortal" on the Community edit page, every state's sentence, buttons, dialogs, toasts and refusals | M `src/lib/onboarding/sign-in-copy.ts`, `src/app/(org)/o/[slug]/admin/community/[id]/edit/sign-in-card.tsx` |
| Link works once; seven days; five-minute send-again wait; several sends then a stop | M `SIGN_IN_INVITATION_LIMITS` in `src/lib/onboarding/sign-in-types.ts` (`expiryDays 7`, `resendCooldownMinutes 5`, `maxResendsPerChain 5`) |
| The list markers and who sees them | M `community/sign-in-marker.tsx` (and `getSignInMarkers`, `people.manage` viewers) |
| What the invitee sees | M the `/invite` and `/no-organization` files above; P 2b Phase 6 walk ("no name pre-fill") |
| Connect at sign-in: the conditions (one candidate, not a visitor, one live membership, toggle on, no open invitation, exactly one record carries the address) and "role or seat needs two-factor, then Check again" | M `drizzle/0065_presby_sign_in_and_connect.sql` `presby_connect_signed_in_account` (checks 1 to 11); `NO_ORG_SECOND_FACTOR_COPY` |
| "Connect people when they sign in": on by default, what turning it off does | M `src/lib/org-features.ts:131` |
| The Session banner states and the hand-off rows | M `SESSION_BANNER_COPY`, `sessionRowStateLabel`; P 2b Phase 6 |

**who-is-asked-for-a-code (`two-factor-by-role`)**

| Fact | Source |
|---|---|
| The three reasons (own setting, role, congregation policy), the strictest wins, decided at sign-in before a congregation is chosen | P `../presby-2fa` Copy S1 paragraph 1; Phase 3 Summary |
| New accounts are not asked just for existing; existing accounts keep their setting | P Phase 6 One-line take and Intent-vs-shipped |
| Own setting is changed only by the PresbyPortal team; a platform administrator is asked from the moment the role is given | P Phase 6 "What's Working"; Copy S1 paragraph 2; `src/app/(admin)/admin/users/[id]/two-factor-card.tsx` |
| The roles: giving (view, record, manage), creating roles, giving roles, website addresses; the first administrator and a treasurer hold them; roles for people or events do not require it | P Phase 3 "Permissions & Flags" and Phase 6 release-note paragraph; `0059:534` bundle in Phase 1 |
| Given a role while signed in: asked next sign-in | P residual 3 in the Phase 6 release note |
| A congregation's policy is set by the PresbyPortal team | P `src/app/(admin)/admin/2fa/{page,actions}.tsx` is the only writer of `organization_settings.require_two_factor` outside provisioning (grep of the tree). **Check at publish** that no congregation-side screen has been added since |
| Setting up on your own does not start asking at sign-in | P Phase 6 and the 0.49.0 release note ("Things to know") |
| The master switch | P Phase 3 ("`auth.require_2fa` stays the master switch for every source") |
| Not copied: the deploy-day count in the 2fa release note | by design |

**reimbursements and reimbursements-for-treasurers (`reimbursements`)**

| Fact | Source |
|---|---|
| Every quoted label, status word, message, banner, button, dialog line, email heading, tab, filter, payment-form field, refusal, settings and team string | P `../presby-treasury/src/lib/reimbursement/{copy,notices,limits}.ts` (the Copy file is the single source) |
| The toggle "Reimbursements", off by default, congregations and new worshiping communities | P `src/lib/org-features.ts` `org_portal.reimbursement` |
| Tiles "Reimbursements" and "Reimbursement requests" and their descriptions | P `src/lib/org-portal/tiles.ts` |
| Who can ask ("members, regular attenders and staff"), the Treasurer view button for key holders, Category only when the congregation has categories, "Pay someone else back" only for people allowed to enter for others | P `copy.ts` `page.cannotFile`; `reimbursements/page.tsx`; `request-form.tsx`; Phase 6 "What's Working" |
| Chair or leader approves; nobody approves their own; the approver cannot pay; the sole payer exception and its stamp; treasurer approval needs a second payer | P Phase 6 Intent-vs-Shipped, Phase 3 Copy C8 |
| Photos re-saved without location data, PDFs kept as uploaded, no virus scan; receipts private to the request; nothing deleted | P Phase 6 release-note paragraph and "What's Working" |
| 4 MB, 5 files, 20 drafts, 20,000 export rows | P `limits.ts` |
| Not stated, on purpose: that Session and Board of Deacons requests go to the treasurer "for now" (the release note's own words). It is a limit a pending Deacons-seat feature removes, but that TODO line carries no `[help:]` token, so no `limitationUntil` can mark the sentence. A requester sees the same "Waiting for the treasurer to approve it." banner as for any group with no chair or leader, which the page explains | by design; see "For the orchestrator" |

**photos-of-people (`person-photos`)**

| Fact | Source |
|---|---|
| Every label, dialog, status line, refusal and the off-warning | P `../presby-photos/src/lib/person-photos/copy.ts` (the file's own claim registry) |
| Toggle "Photos of people", off by default, all organization types | P `src/lib/org-features.ts` `org_portal.person_photos` (`orgTypes: null`) |
| The path Community, "Edit person", "Photos"; the link needs Community on | P the edit page; Phase 6 Help impact |
| Ten photos, per congregation, first photo becomes the directory photo, never the website photo; website needs the permission tick; website falls back to a cleared directory photo; listed and published; "appears to be under 18" (never "adults only"); hidden; merged; removing keeps the file; a day of browser cache | P Phase 6 "Help impact" and Intent-vs-Shipped |
| Not claimed: that iPhone camera photos work (the refusal sentence is quoted as text; no sentence says they work) | P Phase 6 "Not to claim yet" |

### Checks run on the pending pages

- **`npm run check:help`** passes with **28 registry entries: 16 published, 7 pending, 5 planned; 23 content files; 7 images.** H2 (file parity), H4 (headings), H5 (subset), H6 (links, pending included), H9 (no real name, host or project id) and H12 (every pending page's token is on exactly one open TODO line; every planned token the same) all run on the new pages.
- **Labels.** `check:help` H10 reads only published pages, so `labels[]` on a pending page does not fail on this branch, whatever the branch contains. I still filled them, so the publish step is a status flip: a scratch script (`help-5c/labels.ts`, not committed) applies H10's own normalisation and checks that **every one of the 189 pending labels occurs in a non-test `src/` file of the tree of the pipeline it describes** (main for the first three pages, `presby-treasury`, `presby-photos`) **and in the page's own text**: 0 misses. A second scratch script (`quotes.ts`) lists every other double-quoted string in each pending page that is not found verbatim in that tree: the only hits are interpolated templates ("10 unused codes remaining (of 10 total)", "Sent back to you. Reason:", "0 of 10 photos", the 2b banner "are recorded, but none has connected...", "Not connected yet. No email on file", which the code joins at run time).
- **Banned and future phrasing.** Grep of the seven pages for will, would and "going to": two hits, both verbatim quotes of UI titles ("Photos of people will be hidden", the Features warning, which the photos record lists as a required label). Nothing else. No page names a congregation; example addresses are `.invalid` (`i***@example.invalid`).
- **Published pages against main.** Because 2b and F166 are on main, I ran the same label and quote scans for the sixteen **published** pages against `../presby`: **one** label is gone: `adding-people` "none has a PresbyPortal account yet" (2b replaced that banner). No other published label or quoted string is missing. See "For the orchestrator".

### The placeholders in the browser (`:3660`, 360x780, light and dark)

- `/help/planned` and each of `/help/planned/{worship-planning,children-check-in,communications,event-sign-ups,presbytery-tools}`: HTTP 200, one `<h1>` (the page's own name; the list page's is "Planned and not available yet"), the fixed label "Planned. Not available yet. There is no date." on each entry, "Who it is for: ..." and "Today: ..." lines, document overflow 0, every link in `main` at least 44px, readable in both schemes. Screenshots (light and dark, full page) are in `help-5c/shots/` (`_help_planned*.png`). I read the list page (light) and one entry (dark).
- **noindex.** Each of the six pages carries `<meta name="robots" content="noindex, nofollow">` (the planned pages set it themselves; the index and every page also inherit the root's `noindex`).
- **The planned index** shows the five in registry order and no struck item. The `/help` index lists no pending and no planned entry inline, only its "Planned and not available yet" link (the index is unchanged).
- **Unknown or misplaced slugs still get the help 404 through the catch-all** (a planned list that is no longer empty is exactly the case the Batch 4 temporary-entry check covered, now with real entries): `/help/planned/no-such`, `/help/planned/signing-in` (a published slug under the planned path), `/help/who-is-asked-for-a-code` (a **pending** slug), and `/help/planned/worship-planning/deeper` each return **404** with the heading "We couldn't find that page" (same markup, light and dark, overflow 0). `help-404.spec.ts` and the `help.spec.ts` "indistinguishable" tests, which now derive the pending slugs from the registry for the first time, passed.
- `/signin` at 360 light and dark: the email box shows `you@example.org`, document overflow 0.
- Not exercised in a browser: the pending pages themselves (they do not render by design).

### Gates

- `npm run typecheck`: clean. `npm run lint`: clean (`--max-warnings=0`).
- `npm run test`: **695 files passed, 97 skipped; 10,536 tests passed, 2,862 skipped, 0 failed** (Batch 4: 694 / 10,534; +1 file and +2 tests, both in `signin-credentials-form.test.tsx`). The first run failed once, `config-imports.test.ts` (F-new-q, fixed; below).
- `npm run check`: **all nine tripwires green** (`check:secrets` was re-run with the seven new files staged, because it scans tracked files only). `check:help`: "28 registry entries, 16 published, 23 content files, 7 images".
- `npm run build`: exit 0 from a clean `.next`; `○ /help`, `ƒ /help/[...unmatched]`, `● /help/[slug]` (16 paths), `○ /help/planned`, `● /help/planned/[slug]` with the **five placeholder paths** (static), unchanged otherwise.
- **The auth-touching re-run (the sign-in page is an `(auth)` page), on my own `:3660` server.** Global flags were saved first (`flags-before.txt`, identical to Batch 3's `flags-after-5a.txt`), **reset to the CI baseline** with `scripts/ci/e2e-reset-flags.sql -v pipeline_branch=1`, then **restored afterwards** (`restore-flags.sh`; `diff` against the saved snapshot is empty). Server: full `rm -rf .next`, `RATE_LIMIT_DISABLED=true`, the `CRON_SECRET`, `STRIPE_WEBHOOK_SECRET` and `DOMAINS_*` fakes, `AUTH_URL` on `:3660`. `chromium` project, eight files: `totp-full-login` (the MFA-enrolled user: password, `/totp`, a wrong code rejected, the real code signs in), `help-gates`, `help`, `help-404`, `totp-callback-bypass`, `branded-signin`, `admin-login`, `member-home`: **61 passed, 0 failed, 0 skipped.** The production lane and the lockdown project were not re-run: nothing in this batch touches the proxy, a route or the build graph beyond five static planned pages (the build above shows them), and both ran green in Batch 4 after the last route change.
- Red before green for the `fix(auth)`: the new test failed against the old file (`expected 'admin@claudecode.info' to be 'you@example.org'`) before the one-line change.

### Findings

- **F-new-q (test defect, fixed in `d7e5d39`).** `src/lib/help/config-imports.test.ts` read `export const HELP_PAGES = [ ... ]` as a re-export whenever a string in the array ended with the word "from" followed by a quote (the label "Submitted from" on the Reimbursements queue), and failed "registry.ts imports `",`". The pattern now excludes `=` between `export` and `from`, so a variable declaration is never a re-export. A real `import ... from "@/..."`, `export * from` and `export { x } from` are still caught (checked with sample text). Any future published label that ends in "from" would have hit the same wall.
- **F-new-r (copy, for the operator).** The approved placeholder "Worship and service planning" says "You can put services on the calendar as events." That is true for a person holding the events role, but Batch 5b found that a first congregation's founding administrator cannot add events without the PresbyPortal team (F-new-i). The line is the design's approved text and is kept verbatim; it should be re-read when F-new-i is decided.
- **F-new-s (observation).** `check:help` H10 never reads a pending page's labels, so a label that drifts in a pipeline's final strings is caught only at the publishing commit. That is by design (R6); the scripts above are how this batch kept the labels honest today, and the same two scripts (labels against the merged tree) are a fast check at publish.

### For the orchestrator, at integration (the pending pages are not live until you do these)

1. **Order of merge.** Publish the two `recovery-codes` pages and the `signin-invites` page together (both features are on main). `who-is-asked-for-a-code` links to `setting-up-two-factor` and `accepting-your-invitation`, and `reimbursements-for-treasurers` links to `accepting-your-invitation`, so those two cannot publish before `recovery-codes` does (H6 refuses a published page that links to a pending one). `reimbursements` and `reimbursements-for-treasurers` share one token and publish together. No `recovery-codes` or `signin-invites` page links to `who-is-asked-for-a-code`, and no treasurer page links to it, on purpose, so no page waits on F343.
2. **Per page, the publish commit does:** set `status: "published"`, set `verifiedIn` to the release you re-walked (the page text is **not** walked yet), append the slug to `slug-history.ts`, move the `[help:<token>]` onto the feature's Done line, add the slug to the functionality map (H15), confirm each `covers` key against the merged catalog (`org_portal.sign_in_connect`, `org_portal.reimbursement`, `tile:reimbursements`, `tile:reimbursements-admin`, `org_portal.person_photos`, `route:/invite`, `route:/account/2fa`; the route ones are checked against the real route list by `coverage.test.ts`), and re-run the label script against the merged tree.
3. **2b (`signin-invites`) side effects on published pages:** `adding-people` quotes the banner label "none has a PresbyPortal account yet", which main no longer has, so H10 fails there on the merged tree. `adding-people` and `officers-and-the-session` carry the one limitation sentence and `limitationUntil: signin-invites`; `how-a-congregation-gets-started` and `why-cant-i-see-this` carry the same marker. All four are edited in the publish commit: the Session banner states in `adding-people` now read from `SESSION_BANNER_COPY` (quoted above) and the hand-off to `sign-in-invitations`; the "Only an invitation connects you" sentence the 5a notes left out stays out. Also add the `/no-organization` in-app link (P3-9) in that commit, and the `org_portal.sign_in_connect` coverage (this page's `covers`; otherwise the allowlist). `your-account` names two-factor without a link: add one to `setting-up-two-factor` when it publishes.
4. **`recovery-codes` side effects:** `using-your-code` and `your-account` can link `setting-up-two-factor`; add the `/invite` in-app link (P3-9) with `rel="noreferrer"` in the publish commit; `getting-help`'s "Ask the person who invited you" is unaffected.
5. **`two-factor-by-role`:** `using-your-code` is rule-neutral and needs no edit. After this page publishes, add a link from `setting-up-two-factor` and `accepting-your-invitation` to it (they cannot carry it now: it would make `recovery-codes` wait on F343). Confirm at publish that the PresbyPortal team is still the only writer of a congregation's policy (see the table).
6. **`person-photos`:** remove the `limitationUntil: person-photos` sentence from `using-the-directory` (and add that a card shows a photo when one is chosen and initials otherwise); `your-congregations-website` gets the sentence that a photo appears only when a website photo or a cleared directory photo exists and the person has not hidden it. Both are in the photos record's "Help impact".
7. **`reimbursements`:** if you want the Deacons-seat limit marked, add a `[help:...]` token to that open TODO line and a `limitationUntil` to `reimbursements`; today the page says nothing about Session and Deacons requests.
8. **Placeholders.** Each token is on exactly one open TODO line (`worship-planning` line 565, `children-check-in` line 422, `communications` line 45, `event-sign-ups` line 50, `presbytery-tools` line 29 in this tree). When one of those features ships, H12(c) fails until the placeholder is deleted and the real page carries `replaces`.
9. **Walk the pending pages** as their readers on a dev server at 360px before `verifiedIn` moves; Phase 6 does the same for the published ones.

### What QA should cover (Phase 4 is complete)

1. Everything in the **Phase 5** paragraph of this log, with the nine tripwires, `coverage.test.ts` (pin 16), the build route table, every published page at 360px in light and dark and the seven committed images read for real data (unchanged since Batch 4).
2. **Batch 5c specifically.** (a) `npm run check:help` reports 16 published, 7 pending, 5 planned. (b) The seven pending pages are **not reachable**: each of `/help/<pending slug>` is the help 404 (404, the heading, no redirect to `/signin`), none appears in `/help`, none in the build's route table, none in `generateStaticParams`. (c) `/help/planned` and each `/help/planned/<slug>`: the fixed label text, "Who it is for", "Today:", 360px light and dark, `noindex` meta tag, no struck item (no `ledger`, `meeting-minutes` or `directory-export` anywhere in `src/` or the registry), and an unknown `/help/planned/<x>` still the help 404. (d) The copy-truthfulness check on `git diff -U0 d56dcd7..HEAD -- src/content/help src/lib/help`: each pending page's quoted strings against the record named in the tables above (the scripts are in the scratchpad; a record-based re-check is the QA step, since the features cannot be walked here), and the **forbidden-future-tense** read. (e) The `fix(auth)` commit: `signin-credentials-form.test.tsx` fails against the old file and passes against the new one (verify by `git stash`-free means, e.g. check the file at `366a1d3^`), and the full-login path on a real server with an MFA-enrolled user (`totp-full-login`, `help-gates`) is green, which this batch ran and QA repeats after resetting global flags to the CI baseline. (f) `config-imports.test.ts` still fails for a real `@/` import (mutation: add `import { x } from "@/lib/foo";` to `registry.ts`).
3. **Known unverified, for Phase 6:** the pending pages' prose against the shipped screens (none walked); the Google section of `signing-in` (O3, unchanged); `F-new-r`; the 2b banner and Session sentences once 2b merges.


---

# Phase 5 — Verification (qa)

**Date:** 2026-10-28
**Verified by:** qa (read-only). I ran this in worktree `/Users/cshenso/git/presby-platform/presby-help`, branch `pipeline/user-help`, HEAD `dc18a7e`. The diff was measured from the merge-base `26fd2d8` (main at 0.47.0).

**Verdict: PASS.** Every required check is green, including the stricter auth-touching gate. The findings below don't block the verdict.

**Scope I ran.** This diff touches `src/proxy.ts`, a layout, `playwright.config.ts`, `src/components/shared/` and two `(auth)` pages, so these suites ran in full:
- typecheck, lint, the unit suite and all nine `npm run check` tripwires
- the full `chromium` and `custom-hosts` projects on my own dev server at :3660, started from a clean `.next`
- the whole production lane on :3661

**What I did not re-run:**
- The DB-backed vitest set. The diff has no migration, no change under `src/lib/db/`, `src/lib/authz.ts` or a shared fixture, and no DB-backed test file.
- `scripts/test-rls.sql`, because the diff changes no schema.

**Flags.** Before the e2e runs I saved the global flags to `qa-help-p5/flags-start-clean.txt`; that snapshot is byte-identical to the orchestrator's `help-5c/flags-before.txt`. I then reset them to the CI baseline with `scripts/ci/e2e-reset-flags.sql -v pipeline_branch=1`. After the e2e runs I restored them, and `diff` against `help-5c/flags-before.txt` is empty. The browser walk then ran at the production posture.

**Housekeeping.**
- No `.env.local` value was printed; variables were checked with `test -n`.
- I edited no repo file and used no `git stash`. All mutations ran in a scratch `git archive` copy at `qa-help-p5/mut`.
- Both servers I started were stopped by PID. Ports 3660 and 3661 are free, and `git status` is clean.
- Disk: 556 GiB free.

## Type Check

`npm run typecheck`: **PASS**. `npm run lint` (`--max-warnings=0`): **PASS**.

`npm run check`: **all nine tripwires PASS**. `check:help` reports "28 registry entries, 16 published, 23 content files, 7 images", which is 16 published, 7 pending and 5 planned.

`next build` from a clean `.next`: exit 0. The help routes in the route table:
- `○ /help` (static)
- `ƒ /help/[...unmatched]` (dynamic)
- `● /help/[slug]`: 16 paths
- `○ /help/planned` (static)
- `● /help/planned/[slug]`: 5 paths

`/signin`, `/totp` and `/access-pending` stay `ƒ`. The build output has 17 HTML files under `.next/server/app/help/`: the 16 published pages plus `planned.html`.

## Unit Tests

| Run | Files | Tests | Failed |
|---|---|---|---|
| Full suite (30.9 s) | 695 passed, 97 skipped (the DB-backed set) | 10,536 passed, 2,862 skipped | 0 |
| The 38 test files the diff adds or changes, verbose | 38 | 533 passed | 0, nothing skipped |

`coverage.test.ts` passes. Its allowlist pin is 16.

## End-to-End Tests

| Lane | Server | Total | Passed | Failed | Skipped | Duration |
|---|---|---|---|---|---|---|
| Dev, `--project=chromium` (full) | own `next dev` on :3660, clean `.next`, `RATE_LIMIT_DISABLED=true`, CI-baseline flags | 542 | 542 | 0 | 0 | 19.0 m |
| Dev, `--project=custom-hosts` | same server | 132 | 132 | 0 | 0 | 4.3 m |
| Production lane (`PW_PROD_BUILD=1 PW_PROD_PORT=3661`) | its own `next build && next start` | 100 | 100 | 0 | 0 | 3.0 m |

**MFA login path (the auth-touching gate).** The chromium run used the seeded MFA-enrolled user `admin-2fa-enrolled@presby.invalid`. It went through password, then `/totp` (a wrong code rejected, the real code accepted), then landing. That path is covered by:
- `totp-full-login`, `totp-recovery-code`, `totp-code-entry` and `totp-callback-bypass`
- `session-claim-integrity`, `branded-signin`, `post-login-routing` and `developer-2fa-gate`
- `admin-login`, `member-home`, `header-controls` and `invitation-new-account`
- `help-gates`: an enrolled user who has not yet entered a code reaches `/help` while `/o/<slug>` still goes to `/totp`

**Production lane** covered the hydration specs, `help-404` (all three paths: 404, `no-store`, no `s-maxage`, no `x-nextjs-cache`) and `prod-custom-hosts`, which includes the lockdown additions.

**Custom-host lockdown**, from the specs plus my own `curl` with `Host: qa-unclaimed.invalid`:
- `/help`, `/help/signing-in`, `/help/planned`, `/help/planned/worship-planning`, a pending slug, `/help/no-such-page/deeper`, `/docs` and `/docs/x` each return a 404 with no `Set-Cookie` and no `location`.
- None of those bodies contains help chrome or "PresbyPortal".

**Proxy probes on a platform host:**
- `/help/../admin` and `/help/%2e%2e/admin` are normalised and redirected to `/signin?callbackUrl=%2Fadmin`.
- `/help/..%2fadmin` gives the help 404.
- `/HELP`, `/helpdesk` and `/help%2Fsigning-in` redirect to `/signin`.
- No probe reached a protected page through the bypass.

## Regression Tests Added

Failing-first is confirmed for each test below:

- **`fix(auth)` 366a1d3:** `shows a fictional example address in the email box — regression for the starter's address placeholder` (`src/app/(auth)/signin/signin-credentials-form.test.tsx`).
  - I put the form file from `366a1d3^` into the scratch copy: 1 failed (`expected 'admin@claudecode.info' to be 'you@example.org'`).
  - At `366a1d3`: 2 passed. HEAD's form file is identical to `366a1d3`'s.
  - The commit carries `Caught-By`, `Discovered-In` and `Work-Log` trailers.
  - The test pins the exact text, which is the right form for a fixed string.
- **`fix(help)` 7f4363e (the catch-all):** with `help/[...unmatched]` deleted in the scratch copy, `shell-boundaries.test.ts` fails 2 cases and `help-routes.test.tsx` fails to load. The e2e red-first result rests on the implementer's Batch 4 run.
- **Proxy predicate**, three mutations of `src/proxy.ts`, each run against `proxy.test.ts`:

  | Mutation | Result |
  |---|---|
  | Bare `p.startsWith("/help") \|\| p.startsWith("/docs")` | 1 failed (the look-alike case) |
  | `/docs` dropped from the predicate | 1 failed |
  | The bypass moved after `edgeAuth()` | 2 failed (the anonymous case and the mid-2FA case) |

- **`config-imports.test.ts`:**
  - Adding `import { x } from "@/lib/foo";` to `registry.ts` gives 1 failure ("registry.ts imports "@/lib/foo"").
  - Adding `export * from "@/lib/foo"` to `select.ts` gives 1 failure.
- **`check:help` on the real tree**, 15 content mutations; 14 go red with the right rule:

  | Rule | Mutation | Result |
  |---|---|---|
  | H8 | "coming soon" in a published page | red |
  | H10 | renamed the unique label "Use a recovery code instead" in `totp-challenge-form.tsx` | red |
  | H12 | moved `[help:recovery-codes]` to Done | red: "feature shipped: publish its page" for both pages |
  | H16 | a `"/help/signing-in"` literal in `avatar-menu.tsx` | red |
  | H19 | `import "@/lib/flags"` in `needs-block.tsx` | red |
  | H19 | `import "next/headers"` in `markdown-document.tsx` | red |
  | H4 | a level-1 heading | red |
  | H6 | a published page linking a pending page | red |
  | H2 | a deleted `.md` file | red |
  | H7 | an unknown shot id | red |
  | H9 + H5 | an invented congregation name plus a `vercel.app` URL | red |
  | H3 | a slug removed from `slug-history.ts` | red |
  | H13 | `verifiedIn` set to 0.49.0 | red |
  | H5 | raw HTML plus a reference link | red |
  | H15 | `/help/your-account` removed from the functionality map | red |

  The fifteenth mutation, renaming "Forgot password?" on the sign-in form, stayed green. See finding 4.
- **The rule code itself**, 7 mutations, each run against `checks.test.ts` + `todo-grammar.test.ts`; every one goes red:

  | Mutation | Tests failed |
  |---|---|
  | H8 scans pending pages instead of published | 9 |
  | H16 matches double quotes only | 1 |
  | The TODO grammar ignores "declined" | 2 |
  | H10 drops the own-text condition | 1 |
  | H17 drops the 400 KB limit | 1 |
  | H6 always allows pending links | 1 |
  | H17 drops the unreferenced-image rule | 1 |

## Coverage on Critical Modules

- `src/lib/permissions.ts`: 100% statements and branches
- `src/lib/two-factor.ts`: 91.3% statements (target 90%+; not changed by this diff)
- `src/lib/flags.ts`: 100% statements and branches
- `src/lib/help/**`: 96.2% statements overall. `checks.ts` 98.7%, `shots-guard.ts` 100%, `markdown-scan.ts` 91.7%. `copy.ts` is 27% under unit tests alone; its strings are exercised by the component tests.

## Feature-Gate Audit

No protected routes were touched. The diff adds or changes no `route.ts`, no `actions.ts` and no `"use server"` action. The new pages are static, public and session-free by design: they are `(documentation)` pages and the `help/[...unmatched]` catch-all. The proxy gate on `/admin`, `/developer` and `/o/*` is unchanged: the bypass returns before `edgeAuth()` only for `/help`, `/help/…`, `/docs` and `/docs/…`, and I confirmed that with the proxy mutations and the path probes above.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| none added or changed | n/a | n/a | n/a |

## Schema/RLS Audit

Not applicable: no migration, schema, grant or RLS change.

## Browser walk

I walked the help pages on a production build (`next start` on :3661) with flags at the production posture. Screenshots are in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/qa-help-p5/walk/` and `.../qa-help-p5/walk2/`.

**Every published page, the index, `/help/planned` and the 5 planned pages**, at 360×780, signed out, light and dark (46 renders):
- Each returns HTTP 200 with exactly one `<h1>` and no horizontal overflow.
- Every link, button and summary outside the prose is at least 44px tall.
- Every page carries `noindex, nofollow`, and every planned page sets it itself.
- The 3 tables each sit in a `role="region"` with `tabindex="0"` and the aria-label "Table. Scroll sideways to see all of it.".
- All 16 published pages have the "On this page" `<details>`. Its `<summary>` keeps `display: list-item` and opens on click.
- All 7 images have alt text, load, and are scaled to 328px.
- The one external link carries `rel="noreferrer noopener"`.
- No `{{` token appears in any rendered page.
- I read 4 screenshots myself: `why-cant-i-see-this` dark, the worship-planning placeholder light, the signed-in home dark and the TOTP page.

**Planned pages:**
- Each shows the label "Planned. Not available yet. There is no date." and "Who it is for:" / "Today:" lines.
- The struck slugs `ledger`, `meeting-minutes` and `directory-export` appear nowhere in `src/`, `docs/TODO.md`, `docs/product`, `e2e/` or `scripts/`, neither as a slug nor as a token.

**Pending pages:**
- All 7 return the help 404.
- None appears in the `/help` index HTML, in `prerender-manifest.json` or in the route table.

**In-app links**, at 360px in light and dark:

| Where | Link | Height | Overflow | Opens |
|---|---|---|---|---|
| Home, signed out | "Help" | 44px | 0 | |
| Home, signed in as `org-multi` | "Help" | 44px | 0 | |
| `/signin` | "Help with signing in" | 44px | 0 | |
| `/totp` (real mid-challenge session) | "Help with two-factor sign-in" | 44px | 0 | `/help/using-your-code`, and `/o/e2e-alpha` still goes to `/totp` |
| `/access-pending` | "Why can't I see this?" | 44px | 0 | `/help/why-cant-i-see-this#access-pending` with the section in view |
| Avatar menu (items "Account", "Help", "Sign out") | "Help" | 44px | | `/help` |
| Toggle-off states for a no-role member at `e2e-alpha`: community, careers, giving | "How features are turned on" | 44px | 0 | `/help/turning-features-on-and-off` |

The home line reads "PresbyPortal is in early release."

**Enumeration (production build):**
- Compared 10 single-segment URLs: an unknown slug, a typo, all 7 pending slugs and a planned slug at the wrong path (`/help/worship-planning`).
- All return 404 with `private, no-cache, no-store, max-age=0, must-revalidate` and no `x-nextjs-cache`.
- With the requested segment normalised out, every body is byte-identical (sha `e01ae2cd84c2`). The only per-URL difference is that the RSC payload echoes the request's own segments.
- Two-segment misses are identical to each other in the same way: `/help/planned/no-such`, `/help/planned/signing-in` and `/help/planned/worship-planning-x`.
- Timing over 25 requests each is indistinguishable: medians 4.1 to 5.3 ms for unknown and pending slugs.

## Images

I opened and read all seven committed images myself.

| Image | What it shows |
|---|---|
| `signin-form` | empty boxes; no placeholder address |
| `totp-boxes` | empty boxes |
| `portal-tiles` | tiles only; no greeting or header |
| `admin-hub` | the "Alder Creek Presbyterian Church" fixture |
| `features-list` | the fixture, plus a "Last changed" timestamp with no address |
| `community-list` | Marguerite Ashcombe and Corwin Ashgrove, no email |
| `calendar-month` | fixture events |

- **Names.** "Alder Creek Presbyterian Church" is in `scripts/seed-dev.sql`. Ashcombe is in `seed-dev.sql`, and Ashgrove is in the repository's parishes and invitations seed fixtures.
- **Nothing real.** No image shows a real person, congregation, address, email, tenant brand mark, avatar menu or dev indicator. No address appears at all, so none is off `.invalid`.
- **Metadata.** Every PNG holds only `IHDR`, `IDAT` and `IEND` chunks; there is no embedded text metadata.
- **Captions.** The two image sentences ("…already turned on several features, so its page also lists 'Manage giving' and 'Website domain'"; "…already turned on its features") match what the images show.

## Copy Truthfulness

- [x] **Every added or changed string is in the design's Copy table.** Exceptions are findings 1 and 2. The C1 chrome in `src/lib/help/copy.ts`, the C2 home line, the C3 link texts and the 5 approved planned rows (verbatim; the struck rows are absent) all match.
- [x] **Each claim was traced to the code or record behind it, and what it does not read is named.**
  - **Published pages:** I read all 16 in full and spot-checked their claims against code on this branch:
    - lockout: 5 tries, 900 s
    - reset link: 60 minutes, single use
    - recovery codes: `ABCD-EFGH`, case-insensitive, the dash is optional (`normalizeRecoveryCode`)
    - Google sign-ins also reach the 2FA gate: the `jwt` callback doesn't depend on the provider
    - the Features table against `ORG_FEATURE_CATALOG`: names, `provisionedOn`, `orgTypes`, `operatorEnabled`
    - the founding administrator also holds Stated Clerk (`presby_apply_founding_administrator`, 0059), which carries `roll.propose` (0061)
    - **live read on this branch:** the walk congregation's `founding_administrator` and `congregation_stated_clerk` roles hold no `events.manage`, `branding.manage` or `event_types.manage`. That confirms the "cannot yet" claims on 4 pages.
    - quoted strings exist in non-test source, interpolated forms included
  - **Pending pages:** I re-ran my own quoted-string scan against each source tree: `../presby` (5059611, 0.48.1) for three pages, `../presby-2fa`, `../presby-treasury` and `../presby-photos`. Of 261 quoted strings, the only ones not found verbatim are the interpolated templates the implementer already listed. I also checked `who-is-asked-for-a-code` against `../presby-2fa`'s `0080` migration and `platform-role-two-factor.ts`: the six flagged keys, the new-account default, existing accounts keeping their setting, and the platform-role switch-on. The pending pages are checked against those records only; none was walked on a running server.
- [x] **Each instruction was traced to the role that sees it, and that role can do it.**
  - The toggle-off link is visible to a no-role member, and its target tells them who to ask.
  - The "In Features, turn on…" Needs blocks are pinned to the catalog by `coverage.test.ts`.
  - The founder instructions match the bundle.
  - No Needs block `who` string contains a permission key.
- [x] **Older strings about the same subject were grepped for, and none is made false by this diff.** The neighbour greps in the 5a, 5b and 5c records stand.
  - No future tense outside quoted UI. The only "will" is a verbatim UI string on the pending photos page, and "won't" describes a state.
  - No permission keys in reader text.
  - No real congregation name in any help content or registry string.
  - Nothing varies by whether a congregation is a tenant: the pages are static and read no session, flag or tenant.
- [x] **Help diff covered:** every `labels` string is enforced on screen by H10. I walked every published page at 360px and opened every committed image.

**Findings (none blocks the verdict):**
1. **`you@example.org` is not in any Copy table.** It is the new sign-in placeholder from commit 366a1d3. It makes no claim, so it is truthful, but it was added without a recorded ruling. The orchestrator should record the ruling. Two sibling forms use `you@example.com` (`forgot-password/page.tsx:92`, `account/email-form.tsx:77`); that inconsistency is cosmetic.
2. **Two aria-labels are not in Copy C1:** "Help site" (`headerNavLabel`) and "More help pages" (`pageNavLabel`) in `src/lib/help/copy.ts`. Both are accurate.
3. **Three-column tables at 360px.** On `why-cant-i-see-this` and `turning-features-on-and-off`, the last column ("Who can fix it", "Applies to") is off-screen at 360px until the reader scrolls. They meet R4 (a focusable scroll region), but Batch 5b turned its own three-column tables into lists for exactly this reason. Worth aligning in a later pass.
4. **H10 can be satisfied by a label anywhere in `src/`.** Renaming the sign-in form's "Forgot password?" link stays green, because `forgot-password/page.tsx:73` uses the same string as its `<h1>`. That is how R7 defines the check; Rule 17's human walk is the backstop for screen-specific drift.
5. **F-new-r is still open.** The planned line "You can put services on the calendar as events." is the operator-approved text, but a new congregation's founding administrator cannot add events (confirmed above). It's for the operator to decide.

**Known unverified, carried to Phase 6:**
- the Google section of `signing-in` (O3)
- the pending pages against their shipped screens
- every published page needs a re-walk against 0.48.x before `verifiedIn` moves

**Merge gate (not part of this verdict):** the Vercel preview check of `/help/no-such-page` and `/help/planned/no-such` belongs to the orchestrator before `/merge-pr`.

## Verdict

**PASS.** On this auth-touching diff, the full chromium e2e ran on my own dev server at :3660 with the seeded MFA-enrolled user through password, TOTP and landing, and every spec passed with none skipped. The production lane on :3661 and the custom-hosts project also passed. All nine tripwires, typecheck, lint and the unit suite are green, and the failing-first checks hold.

### Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete. Full chromium (542), custom-hosts (132) and production lane (100) green on own :3660/:3661; nine tripwires; build route table; 36 mutations red as expected (14 of 15 `check:help` content mutations, 7 rule-code, 3 proxy, 2 config-imports, 1 fix(auth) restored from `366a1d3^`, 9 catch-all unit cases); 46-render 360px walk; 7 images read; enumeration identical; flags reset to CI baseline and restored | PASS | 2026-10-28 |

### Handoff

Next is **analyst (Phase 6)**. Re-walk every published page as its reader at 360px. Check the O3 Google section with the operator. Carry findings 1 to 5 above and the Vercel preview merge gate.

Files referenced:
- `/Users/cshenso/git/presby-platform/presby-help/docs/work-log/2026-10-26-user-help-inc1.md`
- `/Users/cshenso/git/presby-platform/presby-help/src/proxy.ts`
- `/Users/cshenso/git/presby-platform/presby-help/src/lib/help/copy.ts`
- `/Users/cshenso/git/presby-platform/presby-help/src/app/(auth)/signin/signin-credentials-form.tsx`
- `/Users/cshenso/git/presby-platform/presby-help/src/content/help/why-cant-i-see-this.md`
- `/Users/cshenso/git/presby-platform/presby-help/src/content/help/turning-features-on-and-off.md`
- Logs and screenshots: `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/qa-help-p5/` (`e2e-chromium.log`, `e2e-hosts.log`, `e2e-prod.log`, `build.log`, `content-mut2.log`, `rule-mut.log`, `walk.json`, `walk2.json`, `walk/`, `walk2/`, `flags-start-clean.txt`, `flags-end.txt`)

---

# Phase 6: Shipped vs Intent (analyst): user help, Increment 1

Pipeline `2026-10-26-user-help`, child `2026-10-26-user-help-inc1`. Worktree `/Users/cshenso/git/presby-platform/presby-help`, branch `pipeline/user-help`, HEAD `312805d`. I edited no file, printed no `.env.local` value and started no server.

**How I read it.** I read the parent and child logs in full, all 23 content files, the registry, the allowlist, and the diff against `26fd2d8`. I read QA's walk screenshots (the index, first-day and how-a-congregation-gets-started pages at 360px). I also read the relevant `main` sources: `sign-in-copy.ts`, `no-organization-copy.ts`, `org-features.ts`, `proxy.ts`, `auth.ts` and the email-verify page.

To see what integration breaks, I ran a dry merge of `HEAD` and `main` into the scratch tree `…/scratchpad/p6-merged`. That tree has no `.git`, so the `scripts/pre-push-gate` and `scripts/stats-escape` test failures there are artefacts. The dry merge gave these results:
- `docs/product/functionality-map.md` conflicts. `docs/TODO.md` and `package.json` auto-merge.
- `check:help` fails once: H10, `adding-people` label "none has a PresbyPortal account yet".
- `coverage.test.ts` fails once: `org_portal.sign_in_connect` is uncovered.
- Nothing else in `src/lib`, `src/components`, `src/app` or `scripts` fails.

**What I did not do.** I did not walk the pages on a live dev server. For the published pages I rely on the implementers' "page, fact, how verified" records and QA's 46-render 360px walk. I therefore do not move any `verifiedIn`. Section "Integration checklist" makes the re-walk of the merged tree an explicit precondition.

---

## VERDICT

**SHIP WITH NOTES.**

Increment 1 delivers what the operator asked for, with the standing instructions drafted rather than yet in force. Four items are gates on the integration, not follow-ups:
- the Vercel preview check of the help 404;
- the Google sign-in confirmation (O3);
- the integration re-walk, as the person each path creates;
- the one-table fix to `why-cant-i-see-this` (QA finding 3, below).

Everything else becomes a tracked follow-up.

## ONE-LINE TAKE

> A public, static, signed-out-readable help site with 16 live pages, 7 inert pages waiting on their features, 5 labelled placeholders and a tripwire that already catches the two things 2b's merge will break. It is honest about its own gaps, and it will be only as current as Rule 17 is applied, and that rule is drafted but not yet in `CLAUDE.md`.

## What's Working

- **The prospective congregation** reads an honest first page. It says no sign-up form exists and the team sets a congregation up. It admits there is no contact form and points to the public repository with a warning not to post private details. Nothing names a congregation or counts tenants, and the placeholders say "no date".
- **The member** gets plain-language pages on exactly the support questions: signing in, locked account, password reset, using or losing a code, changing email, and why a tile or congregation is missing.
  - The best page is `why-cant-i-see-this`. It corrects the design's assumption: a tile is shown whatever the role, and the page then says "you don't have permission".
  - The deactivated-account text states what people actually see ("Wrong email or password.") rather than the design's unreachable string.
- **The founding administrator** gets `first-day-as-administrator`, built from a real walk as an accepted-invitation founder. It says plainly what the founder cannot do yet. The Addendum A question is answered by walking, not by memo: the founder holds neither `branding.manage` nor `events.manage` and cannot grant them.
- **Failure paths.** The help 404 is a real 404 that links to the index. Pending, planned-at-wrong-path, unknown and deeper paths give one identical body. Timing was measured, the response is `no-store`, and a custom host gets the neutral 404 byte for byte. QA proved this on a production build.
- **Mobile.** Every page and the index pass at 360px in light and dark. Tap targets are 44px, tables sit in focusable regions, and `<details>` keeps `display: list-item`. The home bar signed in was measured at 360. I read three of QA's screenshots and they match the claim.
- **Images.** All seven were read by QA and show only invented names. The guard refused the real database, with counts only, before anything was written.
- **Doing it by the book.** QA ran 36 mutations. The unit, chromium, custom-hosts and prod lanes all passed with an MFA-enrolled user on the auth-touching gate.

## Intent-vs-Shipped Diff

| Phase 1 / operator said | Shipped | Verdict |
|---|---|---|
| Public `/help`, platform palette, platform hosts only, no session read | Static `(documentation)` group; proxy prefix bypass with no new import; custom host gets the neutral 404; `dynamic = "error"` holds | matches |
| Organized by task and audience; "Needs" block; "Why can't I see this?" | Index by audience; Needs block pinned to the catalog; the symptom table exists | matches |
| Only shipped behaviour documented | The operator revised this: in-progress features get real pages, backlog tracks get placeholders. Seven pending pages are written and not rendered. Five approved placeholders ship. The three struck ones appear nowhere | matches the revised intent |
| Contact channel (Q3): a contact form, no published address | Increment 2 by the architect's split. Interim: "Ask the person who invited you" and the repo's issues page | acceptable drift, with a cost. See finding F374 |
| Home line replaced; Help links in bar, menu, `/signin`, `/totp`, `/access-pending`, toggle-off states | All present and 44px. `/invite` and `/no-organization` are deferred to the publishing commit by design | matches |
| Screenshots from fixtures only, human read | Seven images; fail-closed guard G1–G6; QA read all seven | matches |
| Standing instructions for keeping it up to date | Rule 17 text, agent/skill/template edits and nine tripwires are drafted. `check:help` plus `coverage.test.ts` is real and in CI. `CLAUDE.md`, the agent files and the skills are not edited, by Rule 16, and apply at integration. Not yet in force | partly delivered. See "Rule 17 machinery" |
| Website section; custom domain only as "ask us"; no giving | Delivered from a role walk. Page says the site's pages are edited by whoever maintains it, not in the portal | matches |
| Founding-administrator role walk (Addendum A) | Done. It found a real product gap (F362) | matches, and valuable |
| `/docs` public developer docs | Increment 3. The proxy bypass for `/docs` is live with no route behind it, a framework 404, pinned by test | deferred as planned |
| Lost phone and codes: say plainly there is no self-serve path and name the channel (Phase 1 Flow 3) | The page says there is no reset button, then "Ask the person who invited you." Most inviters cannot reset it | gap. See F374 |

## Reader walks

**Prospective congregation** (`what-presbyportal-does`, `how-a-congregation-gets-started`). The reader understands what exists and that setup is by invitation. The first page does not mention the website, the public calendar or giving. That is honest, not wrong. The contact path is a public GitHub issue. This is an acceptable interim that the page labels correctly, but it is a thin front door.

**Member.** Strong. Two gaps:
- A person who loses both phone and codes reads "no button resets it. Ask the person who invited you." The inviter is usually a church administrator who cannot reset it either. Only the platform team can. The page must say so.
- A member who changes their email may see "Something went wrong" after a successful change. The page documents the bug as a workaround (F357).

**Founding administrator.** The first-day page is accurate and kind about the two dead tiles. Reading it as the person, two of the five Administration cards say "ask the person who invited you". That is true, and it is the weakest part of the first day. The page's step 2 says a Session member needs an account but, until 2b's page publishes, has no way to say how.

## Rule 17 machinery: does it deliver the "standing instructions"?

**What is real.**
- `check:help` (H1–H19) plus `coverage.test.ts` runs in CI as the ninth tripwire.
- Verified by QA mutation: banned phrases, a renamed unique label, a pending token moved to Done, literal `/help` hrefs, import boundary, headings, links, images, slug history, `verifiedIn` bound, and the map naming every published slug.
- A new toggle or tile with no covering page fails the unit suite. That is the genuine forcing function for "a new feature gets a page".

**Gaps in how the standing instructions work.**
1. **Rule 17 contradicts Rule 16 on the ordinary case (F373).**
   - Rule 17 says a feature in flight gets a `pending` page tied to a `[help:<token>]` on an open TODO line.
   - But `docs/TODO.md` is a Rule 16 shared file, edited only at integration. A feature branch cannot add its token mid-pipeline, so H12 would fail on its own CI.
   - The practical rule is: the feature's own branch adds its page as `published` with no `requires`, and the new-toggle coverage test forces it. `pending` plus a token is only for a page written before its feature's branch merges, by a different pipeline.
   - The draft does not say this. Add the sentence below.
2. **The pending-to-published coupling rests on the orchestrator.**
   - The five token lines are dedicated In Flight lines the help pipeline wrote, not the features' own TODO lines. Treasury and photos can merge, add their own Done line, and leave the dedicated line open. Their pages then silently stay pending, and `check:help` passes.
   - Mitigation: every integration runs `grep -n "\[help:" docs/TODO.md` and reads each open line against what has merged (added to the checklist and to Rule 17).
3. **`/pre-push` does not run `check:help`.** It runs four tripwires individually (audit, sql-date, secrets, hydration-gate). Only CI runs `npm run check`, so a red `check:help` is found after the push. The drafted Step 7 bullet is advisory. Add a hard Step 3g (F377).
4. **Nothing ages the `verifiedIn` stamp (F376).** H13 only bounds it above. Pages will read "Last checked against release 0.47.0" while the app is 0.49.x. That is honest, but nothing tells anyone the stamp is old. Add an advisory when a stamp is more than two minors behind `package.json`.
5. **The Features table in `turning-features-on-and-off` is not tied to the catalog (F375).** `coverage.test.ts` checks that keys are covered, not that the table lists them. The dry merge shows the page is already stale: "This table lists the features a new congregation sees" is false the moment "Connect people when they sign in" (on by default) exists. Add a test that every non-operator-enabled catalog name appears in that page.
6. **H10 is satisfied by a label anywhere in `src/` (QA finding 4).** Accepted as R7 defines it. The human walk is the backstop.
7. **Known defects with a help workaround have no token.** The email-change error, the phone Public-listing column and the founder-keys gap all have help sentences that will outlive their fixes. `limitationUntil` exists for exactly this, so use it (see TODO lines).
8. **The monthly re-walk of 23 pages is a real load.** It is acceptable at this size.

**Net.** The machinery is sound for what code can see and honest that it cannot see behaviour changes inside a feature. It becomes "standing instructions" only when the CLAUDE.md, agent, skill and template edits land, and with the Rule 17 amendment below. Until then, treasury and photos Phase 6 must be handed their help impact by hand, as F343 did.

**Rule 17 amendment (add after the "A feature in flight" sentence).**

> The ordinary case needs no token: the feature's own branch adds or edits its page as `published`, with no `requires`, in the same PR, and a new toggle or tile with no covering page fails the unit suite until it does. Use `pending` plus a `[help:<token>]` only for a page written before its feature's branch merges. The token goes on a dedicated In Flight line the orchestrator adds at integration (TODO.md is a Rule 16 shared file), and the feature's own integration commit moves that line to Done and publishes the page, so at every integration run `grep -n "\[help:" docs/TODO.md` and read each open line against what has merged. A known defect that a page works around gets its own TODO line carrying a token and a `limitationUntil` on the page, so the fix names the page.

## Edge Cases

- Empty state: pass. The planned page has an empty state and the index omits empty groups. The Features page empty states are not touched.
- Failure microcopy: pass. The help 404 is human. Residual: with JavaScript off, the 404 body is a blank shell (F367). That matches how `notFound()` behaves elsewhere in the app, so I accept it.
- Permission gate: pass. There is no gate by design. The bypass is a segment-boundary predicate, `/helpx`, `/helpdesk`, `/HELP` and `/help%2Fx` redirect, and `/help/../admin` normalises to `/signin`. The unverified-2FA reader reaches `/help` but still meets `/totp` on `/o/*`.
- Audit event: not applicable. There are no mutations.
- Mobile (360px): pass with one note. `why-cant-i-see-this` and `turning-features-on-and-off` keep three-column tables, and the last column ("Who can fix it" and "Applies to") is off-screen until the reader scrolls. On the page whose job is "who fixes it", that hides the answer. Required fix below.
- Adversarial: `?next=` and `?callbackUrl=` reflect nothing. External links carry `noreferrer noopener`. Raw HTML and `javascript:` render as text. No real congregation name appears in content. No tenant count appears.

---

## Rulings on QA findings 1–5

| # | Ruling |
|---|---|
| 1. `you@example.org` placeholder not in a Copy table | Accepted. Record it as a one-line Copy ruling. `example.org` is already used by two sibling admin forms and `example.com` by two others, so no inconsistency is introduced. The fix removed a real-looking starter address from every visitor's sign-in page. No follow-up. |
| 2. Two aria-labels ("Help site", "More help pages") not in C1 | Accepted. Both are accurate. Add them to the Copy record. No code change. |
| 3. Three-column tables at 360px | **Required before merge for `why-cant-i-see-this`.** Convert its table to four short entries (what you see, what it means, who can fix it), as Batch 5b did for the same reason. Re-check at 360. For `turning-features-on-and-off` (the "Applies to" column), it is a follow-up (F380). |
| 4. H10 satisfied by a label elsewhere in `src/` | Accepted as designed. Follow-up (low, F381): let a label optionally name its file for the few most screen-specific ones. |
| 5. F-new-r, "You can put services on the calendar as events." | Do not ship it as written. It is false for a first congregation's administrator, who cannot add events (F362). Minimal truthful edit: "Someone who holds the events role can put services on the calendar as events." It edits operator-approved copy, so it needs the operator's nod. If F362 is approved and ships, restore the original. |

## Rulings on the 5a/5b/5c product findings that need the operator

- **F-new-i (founding administrator lacks `events.manage` and `branding.manage`): recommend yes, give the founder both, plus `event_types.manage`.**
  - On the first day, two of the five Administration cards are dead ends. This is the largest gap between "what the portal offers" and "what the first user can do".
  - The founding-administrator bundle is a bootstrap role (DECISION-155), not a constitutional office, so DECISIONS 101 and 115's constitutional-duty test does not govern it. The operator already extended that bundle once (`careers.*`, DECISION-265). All three keys are tier 1, so "No Role Carries a Wildcard" is not engaged.
  - It is a full Feature: a migration to `presby_founding_administrator_permission_keys` plus a backfill for the two live congregations' existing founding-administrator roles, with an audit row, and a new DECISION.
  - Help impact is large: `first-day-as-administrator`, `roles-who-can-do-what`, `events-and-the-calendar`, `your-congregations-website`, the F-new-r line and the `admin-hub` image captions.
  - Register it now with a token and a `limitationUntil` on those four pages, so the fix forces the edits.
- **F-new-k (Granted-by shows the platform administrator's email): fix.** A congregation's administrator should not read the operator's account address, and it will end up in a screenshot. Render "PresbyPortal team" for any grantor who is a platform actor with no membership in the viewing organization. Bug-fix variant. The help pages say nothing about this column, so there is no help edit.
- **F-new-m (a visitor can be recorded as a Ruling Elder): fix, as a Phase 1 for a bug-fix pipeline.**
  - A Session seat should require a current roll member (and a deacon likewise). The pastor exemption stays, since a pastor's membership is the presbytery's.
  - Today a visitor counts as a Session seat in the banner. With 2b, that visitor can be invited and then holds the approval role without being a member.
  - It is not an escalation beyond the founder's own power (DECISION-205 already permits self-approval), so it is integrity, not an emergency. Whether a non-member may hold other offices (trustee, treasurer) is the operator's call at that Phase 1.
- **F-new-j (nine event types, four seeded Retired): no action.** The help says "some are switched off at first" and is true. Revisit only if the operator thinks the default set is wrong.
- **F-new-h (Public listing and Display order columns hidden on a phone): fix as a small UX change.** An administrator on a phone cannot see or change who is named on the website. Give it a token and a `limitationUntil` on `your-congregations-website`, so the "use a wider screen" sentence leaves with the fix.
- **F-new-l (map's recurrence text is stale): fix at integration (Rule 14).** The form offers a simple interval (Weekly, Every 2 weeks, Monthly (same date)) or a specific day of the month ("the 1st to 4th or last [weekday]"). The map says "weekly / monthly-by-weekday". No TODO needed.
- **F-new-r:** see QA finding 5.
- **Email-change "Something went wrong" bug on main (F-new-c, F357): fix it, on its own small bug-fix pipeline, before or alongside the help merge.** I read `(email-verify)/account/verify-email/[token]/page.tsx` on main. `revalidatePath("/account")` runs during render right before the redirect. That is unsupported in Next 16 and throws after the address is changed, so the person sees an error after a success. Dropping the call is the likely fix, with a failing-first regression test. Put a token and `limitationUntil` on `your-account` so the workaround sentence is deleted with the fix. If the fix does not land first, publish with the sentence.
- **Deactivated-account message (F-new-a, F356): keep the neutral behaviour, no product change.** Password sign-in returning "Wrong email or password." for a deactivated account matches how the lockout and unknown-address cases behave, and the help states it truthfully. The dead `?error=deactivated` text is reachable only when a session user exists with `isActive === false`, and the jwt callback signs that user out first. A silent sign-out for someone already signed in is a UX wrinkle: low priority, either delete the dead branch or give the signed-out person a message. No help change.

## The open items

- **O3, Google sign-in: hold or confirm. The `signing-in` page may not publish its Google section on an unconfirmed claim.**
  - The operator said (verbatim) the client "hasn't been configured yet, but document it still. I'll turn it on and test soon", and the orchestrator's condition is that the claim is confirmed before the page publishes.
  - Google appears in four places: `signing-in.md` (the intro, the "Signing in with Google" section, the one-line "no password" note and the screenshot caption), `using-your-code.md` line 7, `your-account.md` line 33, and the `signin-form` image, which depicts the button that every visitor already sees.
  - The checklist step is binary. Ask the operator whether Google sign-in is configured and tested in production.
    - **Yes:** publish as is, and re-walk the round trip (button, return, same-address account, "Access Denied" on an unverified or deactivated address, no password for a Google-made account).
    - **No:** publish `signing-in` with the Google section and the other Google sentences removed, keep the picture's caption factual ("the sign-in page"), and file the restore as a TODO line.
  - Either way the button is on the live page today. If the client is unset, that is itself a product finding to hand to the operator.
- **`verifiedIn` re-walk against 0.48.x:** the integration walk is a precondition, not a note. The screens that changed between `26fd2d8` and `main` decide which pages need it:

  | Screens that changed | Pages to re-walk |
  |---|---|
  | `no-organization` | `why-cant-i-see-this`, `home-and-switching-congregations` |
  | `account/2fa`, `verify-email` | `your-account`, `using-your-code` |
  | `admin/community` (person edit card, Pending approvals) | `adding-people` |
  | `admin/officers` (session note, roster) | `officers-and-the-session` |
  | `(invite)` | `how-a-congregation-gets-started` |
  | the Features page (new card) | `turning-features-on-and-off`, `first-day-as-administrator` |

  The rest (`signing-in`, `getting-help`, `using-the-directory`, `events-and-the-calendar`, `your-congregations-website`, `roles-who-can-do-what`, `what-presbyportal-does`) keep `0.47.0` unless the walker finds a change. Do not restamp in bulk. The walk is done at 360px on `development` as an accepted-invitation founding administrator, not a seeded user.
- **Vercel preview check of `/help/no-such-page`:** a merge gate before `/merge-pr`, not a note.
  - On the PR's preview, `curl -sI` and read the body of `/help/no-such-page` and `/help/planned/no-such`, each twice.
  - Expect 404, the help heading, `no-store`, and no `x-vercel-cache: HIT` on the second request.
  - If the preview serves the framework 404, use Option B as ruled:
    1. Delete `src/app/(documentation)/help/[...unmatched]/page.tsx`.
    2. Revert the catch-all cases in `shell-boundaries.test.ts` and `help-routes.test.tsx`.
    3. Change `e2e/help-404.spec.ts` and the "indistinguishable" assertions in `e2e/help.spec.ts` to the framework body.
    4. Reword DECISION-293's 404 sentence to "the framework 404, accepted".
  - Never fall back to `dynamicParams = true`.

---

## Integration checklist (exact, in order)

Preconditions: two-factor by role (0.49.0) is on `main`. Treasury and photos are not, so their pages stay pending. If treasury has merged first, publish its two pages as well (step 7).

**0. Gates before touching anything.**
1. Ask the operator the O3 question. Hold the `signing-in` Google edits until answered.
2. Get the operator's nod on the F-new-r one-line edit.
3. Preview check as above; record the result in the work-log.
4. `git merge-tree` showed one conflict, `functionality-map.md`. Resolve it by taking `main`'s file and re-applying the branch's edits (step 9).
5. One-time, read-only production check that no organization already holds the slug `help` or `docs` (the Batch 2 note: `reserved-slugs.ts` now reserves both).

**1. Merge `main` into `pipeline/user-help`.** Expect `check:help` to report only H10 on `adding-people`, and `coverage.test.ts` to report only `org_portal.sign_in_connect`. Anything else is new. Stop and read it.

**2. Shared files commit (orchestrator).** `chore(integration): user-help shared files`.
- `docs/decisions.md`: DECISION-293 with the architect's 404 sentence and "Revisit if" additions, DECISION-294, and DECISION-295 (recorded now because the `/docs` bypass is live, though the content ships in Increment 3). The two design decisions (DECISION-new-1, DECISION-new-2) take the next two free numbers after any other pipeline's pre-assigned block. Do not guess; read the head of `docs/decisions.md`.
- `CLAUDE.md`: Rule 17 plus the amendment above; the Project Layout block; `(documentation)` in the platform-palette list; "eight" becomes "nine" in the Phase 4 gate (line 272) and Common Commands (line 473), plus the three `check:help`, `help:shots`, `check` command lines.
- `.claude/agents/{analyst,qa,tech-lead,architect}.md`, `.claude/skills/release-notes/SKILL.md` (Step 4 and the Feature and Enhancement templates), `docs/work-log/_template.md` (four edits), and `.claude/skills/pre-push/SKILL.md`. For the last, add the drafted Step 7 bullet and a new hard **Step 3g: `npm run check:help`**. The anchors all exist.
- `docs/STATE.md`, `docs/reviews/log.md`, `docs/briefings.md`.

**3. Edits to published pages (text only; re-walk each at 360px).**
- `adding-people`: replace the label "none has a PresbyPortal account yet" with the verbatim substring "none has connected a sign-in yet". Replace line 59's "Today the PresbyPortal team sets that up: send a support ticket" with "A member of the Session approves only after their sign-in is connected to their record. See [Inviting people to sign in](/help/sign-in-invitations)." Rewrite the "no account" banner bullet to match, and add the invite hand-off. Delete `limitationUntil`.
- `officers-and-the-session`: the same sentence at line 40, and delete `limitationUntil`.
- `how-a-congregation-gets-started`: delete the `limitationUntil` marker, and optionally one sentence that the administrator can invite the people they record.
- `why-cant-i-see-this`: delete the marker. In "What to do", mention "Check again", the invitation card ("You're invited to…") and a link to `sign-in-invitations`. **Convert the three-column table to short entries (QA finding 3).**
- `turning-features-on-and-off`: add the "Connect people when they sign in" row (On, any organization). The table intro says the table lists what a new congregation sees, so it is wrong until this is done.
- `first-day-as-administrator`: step 2 and step 3 link to `sign-in-invitations` so a Session member can be invited.
- `your-account`: link the "Two-factor authentication" section to `setting-up-two-factor`. Keep the email-change sentence until the fix ships.
- `using-your-code` and `setting-up-two-factor`: replace the lost-phone line with the plain truth (F374): "PresbyPortal has no button that resets two-factor sign-in for you. Only the PresbyPortal team can reset it. Ask a church administrator to send the team a support ticket for you. See [Getting help](/help/getting-help)." Also link `setting-up-two-factor` from `using-your-code`.
- `using-the-directory`: unchanged. `person-photos` is not on `main`, so its marker stays.
- The F-new-r placeholder line per QA finding 5.
- If O3 comes back "no": strip the Google sentences listed above.

**4. Publish the pending pages whose features are on `main`, in the publish commit.** `docs(help): publish accepting-your-invitation, setting-up-two-factor, sign-in-invitations and who-is-asked-for-a-code`. Per page: set `status: "published"`, set `verifiedIn` only after the walk (the walked release, not bulk), append the slug to `slug-history.ts`, and add `/help/<slug>` to the map (H15).
- `recovery-codes` (the F166 token): `accepting-your-invitation` and `setting-up-two-factor` publish together, and `signin-invites` is already Done on `main`.
- `signin-invites`: publish `sign-in-invitations`. Before it goes out, re-read it against the 2b "do not write" list. One edit is required: change "This option adds no role. It only connects." to "This option adds no role. The person gets whatever access their record already carries." (do-not-write item 6). The operator's hold on real invitations is a hold on sending and on the what's-new entry, not on documentation. Per O6 the page publishes. Add nothing about the hold, and do not publish the what's-new entry.
- `two-factor-by-role` (F343, if merged first): publish `who-is-asked-for-a-code`, link it from `setting-up-two-factor` and `accepting-your-invitation` (5c note 5), and confirm the platform team is still the only writer of a congregation's policy. Optionally add one sentence and link to `roles-who-can-do-what` for the roles that require a code. F343 listed two platform-admin pages in its own help-impact note. Those are out of scope for `/help` (platform operators are not an audience).

**5. TODO flips (in the same commit as step 4).** Move the dedicated In Flight lines for `signin-invites`, `recovery-codes` and `two-factor-by-role` to `## Done` as `- [x]` with the date, keeping each token. Do the same for `reimbursements` only if treasury has merged. Leave `person-photos`, the five placeholders and any unmerged line open. `npm run check:help` is the checklist: H12(b) names a page that should have gone live, and H12(f) names the four `limitationUntil` pages.

**6. The in-app links (code, the same commit as the page they point to).**
- `/invite`: "Help with this page" via `helpHref("accepting-your-invitation")` with `rel="noreferrer"`, visible in every state including the dead-link state.
- `/no-organization`: "Why can't I see this?" via `helpHref("why-cant-i-see-this", "not-connected-to-a-congregation")`.
- Both are strings outside the design's Copy table, so record them as Copy rows, and add a unit test for each link. Both pages are 2b's rewritten files, so rerun `invitation-new-account`, `invitation-existing-account`, `no-organization-connect` and `community-sign-in-invite` after the links go in.
- `your-account` also gains its `setting-up-two-factor` link (step 3).

**7. Coverage for `org_portal.sign_in_connect`.** Do not allowlist it. `sign-in-invitations` already lists it in `covers` and publishes in step 4. Only if that page is held, add an allowlist entry and raise `ALLOWLIST_PIN` from 16 to 17. A new toggle that the tripwire says "no page covers" is the signal working. If treasury has merged, its two toggles and tiles (`org_portal.reimbursement`, `tile:reimbursements`, `tile:reimbursements-admin`) follow the same path.

**8. Screenshots.** No new images. The Features-page and admin-hub captions say "this congregation has already turned on its features". After F362 ships or the Features page gains the Connect card, re-capture from a from-scratch database (`HELP_SHOTS_DB_OK=1 … npm run help:shots`, then bump `capturedIn` and sizes).

**9. Functionality map.** See below.

**10. Housekeeping, then QA scoped run and the preview check.** Release notes through `/release-notes` (a minor; I expect 0.50.0 if 0.49.0 lands first, the orchestrator's number), TODO per Rule 10, Rule 12 does not apply (the origin is the operator's request, not a feedback row), and Rule 13 is not required, so I draft no what's-new entry. Run `npm run check`, the unit suite, the chromium MFA smoke and the prod lane on the merged tree. QA's scope for the integration diff is the copy-truthfulness check on the changed pages and the `/invite` and `/no-organization` links, plus the walk below.

**The walk the integration owes (Phase 6 rule, run by whoever integrates, recorded in the work-log).** As an accepted-invitation founding administrator on `development` at 360px, list each page and what it shows, with the help link or page for each:
1. The `/invite` link page: Help link present, "Create your account".
2. "Your account is ready", then `/signin`, then `/account/2fa` enrolment, then the ten codes, then Continue (`setting-up-two-factor`).
3. Landing on `/o/<slug>` (`first-day-as-administrator`): Administration shows the five cards, and Manage events and Branding deny.
4. Community, recording an elder, the Pending approvals banner, then inviting the elder (`sign-in-invitations`, the card on the person's edit page).
5. As that elder, `/no-organization` with "Check again" and the second-factor notice.

---

## TODO-ready lines (Rule 10)

Add to `docs/TODO.md`. Tokens only where a page carries a `limitationUntil`.

```
- [ ] **User help Increment 2: the `/help/contact` form (operator ruling 2026-10-26; numbers assigned at kickoff).** An anonymous drop-box table and an `/admin` inbox, written to the architect's C1–C10 (never a ticket, never mail to the typed address, honeypot then Turnstile then rate limits, content-free operator notification). Raises priority: about 14 help sentences now end "Ask the person who invited you", which is a dead end for a lost phone and for a person with no inviter, and the how-a-congregation-gets-started page sends prospects to public GitHub issues. Changing `HELP_CONTACT_LINE` (`src/lib/help/contact.ts`) and the one GitHub sentence is the whole help edit. — `docs/work-log/2026-10-26-user-help.md` Phase 2
- [ ] **User help Increment 3: public developer docs at `/docs` (DECISION-295, F345).** The proxy already bypasses `/docs` with no route behind it. Needs its own Phase 1 addendum (privacy review, site-kit truth source), the pure-sibling extractions of the catalog, ingest limits and live-slot names (R8, F345, F347), and the shared renderer. Also move `/admin/docs` off `rehype-raw`. Revisit `docs/architecture.md` then (Rule 15). — Phase 2
- [ ] **Google sign-in: configure and test in production (operator), then confirm the `signing-in` Google section.** The sign-in page shows the button either way. If the section was stripped at integration, restore it from the user-help commit and re-walk the round trip (same-address account, "Access Denied" on an unverified or deactivated address, no password for a Google-made account). — User help Phase 6 (O3)
- [ ] **Fix the email-change landing: `revalidatePath` runs during render in `(email-verify)/account/verify-email/[token]/page.tsx`, so a successful change shows "Something went wrong" (F357).** Drop the call; failing-first regression test. Delete the workaround sentence in `your-account` in the same commit. [help:email-change-error]
- [ ] **Decide whether the founding administrator holds `events.manage`, `event_types.manage` and `branding.manage` (F362; recommended yes).** Today the first user finds two of five Administration cards deny them and cannot grant them. Full Feature: migration to `presby_founding_administrator_permission_keys` plus a backfill for existing founders, an audit row, a DECISION amending 101 and 115 for the bootstrap bundle (the DECISION-265 precedent). Help edits: `first-day-as-administrator`, `roles-who-can-do-what`, `events-and-the-calendar`, `your-congregations-website`, the worship-planning placeholder, and the admin-hub image caption. [help:founder-events-branding]
- [ ] **Show the Public listing and Display order controls on a phone (F361).** The columns are `hidden sm:table-cell` on Officers and Staff, so an administrator on a phone cannot change who is named on the website. Remove the "use a wider screen" sentence from `your-congregations-website` with the fix. [help:phone-public-listing]
- [ ] **The Roles page "Granted by" column shows the platform administrator's email to a congregation's administrator (F364).** Render "PresbyPortal team" for a grantor who is a platform actor with no membership in the viewing organization. — User help Batch 5b walk
- [ ] **A visitor can be recorded as a Ruling Elder and counts as a Session seat (F366).** Phase 1 for a bug-fix pipeline: require a current roll member for the Session-seating offices and deacon (pastors exempt); operator decides the other offices. The banner counts the visitor, and with 2b they can be invited and then approve. — Batch 5b walk
- [ ] **Dead copy and silent sign-out for a deactivated account (F356).** `/signin?error=deactivated` is reachable only when a session user has `isActive === false`, which the jwt callback signs out first. Delete the branch or give the signed-out person a message. Help stays correct either way. — Batch 5a walk
- [ ] **Help documentation pass 2.** Written pages for giving and the treasurer (the operator's Q5 deferral predates the live giving congregation: ask whether to revisit), sensitive information, groups, staff and parish management. Each deletes its `coverage-allowlist.ts` entry and lowers `ALLOWLIST_PIN` from 16. — User help Phase 6
- [ ] **Help machinery follow-ups (Rule 17).** (a) A hard `/pre-push` Step 3g running `npm run check:help` and the Rule 17 amendment (F373, F377); (b) a `coverage.test.ts` rule that every non-operator-enabled catalog name appears in `turning-features-on-and-off` (F375); (c) an advisory in `check:help` when a `verifiedIn` is more than two minors behind `package.json` (F376); (d) let a `labels` entry name its file for screen-specific strings (F381); (e) convert the "Applies to" column of `turning-features-on-and-off` for 360px (F380); (f) a second 360px capture for `admin-hub` (F369); (g) link the `/help` index sentence "tell the person who invited you" to `getting-help` (feedback route). — User help Phase 5 and 6
- [ ] **Flip help indexing at launch (R11, Q4).** Remove the inherited `noindex` for `/help` pages, add `Allow: /help` and a platform sitemap listing only published help pages. Planned pages keep per-page `noindex`. — Phase 2
- [ ] **`README.md:14-20` says sign-in is gated off and the site serves public pages only, which contradicts production (F355).** — User help Phase 3 (documentation review)
- [ ] **Development holds a directory row named like the operator inside the Alder Creek fixture (F359).** No image or committed file uses it, and the capture database is built from scratch. Scrub it on `development`, alongside the real organization profile row already tracked. — Batch 5a walk
```

Done line (Rule 10): `- [x] 2026-10-28 — **User help Increment 1 (`2026-10-26-user-help-inc1`, DECISION-293/294/295, F345-F381; no migration) — SHIP WITH NOTES.** Public help site at `/help` ...`, written once the preview check, O3 and the integration walk have passed.

**F-number assignments** (next free was F350; the orchestrator confirms against the other pipelines' blocks):

| F | Finding | Status |
|---|---|---|
| F345 | five live slots, not four | open, Increment 3 |
| F346 | `tickets` cannot hold an inquiry | closed by the increment split |
| F347 | server-only catalog and ingest limits | closed for Increment 1 by P3-1; extraction in Increment 3 |
| F348 | exact `PUBLIC_PATHS` would 307 a typo to sign-in | closed by R1 |
| F349 | TODO checkbox grammar | closed by R6 |
| F350–F355 | design F-new-1 to F-new-6 (catalog not tsx-importable; Table container not focusable; `/no-organization` and `/invite` link collision; private proxy walker; merge-before-help Done line; README) | 350–354 closed, 355 open |
| F356 | F-new-a deactivated message | open, low |
| F357 | F-new-c email-change error | open |
| F358 | F-new-d map's trusted-device cookie (`b` is F344) | closed |
| F359 | F-new-e real-named row on `development` | open |
| F360 | F-new-g help 404 | closed (Option C; preview gate open) |
| F361 | F-new-h phone Public listing | open |
| F362 | F-new-i founder keys | open, operator |
| F363 | F-new-j retired default event types | no action |
| F364 | F-new-k Granted-by email | open |
| F365 | F-new-l map recurrence text | closed at integration |
| F366 | F-new-m visitor as elder | open |
| F367 | F-new-n 404 body client-rendered | accepted |
| F368 | F-new-o starter placeholder address | closed (`366a1d3`) |
| F369 | F-new-p `admin-hub` width | open, low |
| F370 | F-new-q `config-imports` regex | closed |
| F371 | F-new-r placeholder line | open, operator nod |
| F372 | F-new-s H10 never reads pending labels | by design |
| F373 | Rule 17 vs Rule 16; dedicated token lines | amendment above |
| F374 | lost-phone dead end; `{{contact}}` can't help | integration edit |
| F375 | Features table not tied to the catalog | follow-up |
| F376 | `verifiedIn` has no staleness signal | follow-up |
| F377 | `/pre-push` does not run `check:help` | integration edit |
| F378 | sign-in-invitations "It only connects" | integration edit |
| F379 | giving is live, help is silent | operator, Q5 revisit |
| F380 | QA 3: 3-column tables | `why-cant-i-see-this` at integration, the other a follow-up |
| F381 | QA 4: H10 label scope | follow-up |

## Functionality map changes

Batch 5a/5b covered the Help bullet, the "Help (public documentation)" section and `Help:` tags on the bullets the 16 pages cover, and corrected the trusted-device cookie. What is still owed at integration:
1. Resolve the conflict by taking `main`'s file and re-applying those edits.
2. The section header and the Help bullet say "First sixteen pages". Update the count and list after step 4 (add the pages published at integration).
3. Add `/help/planned` and the five planned placeholders, the un-brandable `(documentation)` group, the proxy bypass, and that a custom host answers the neutral 404.
4. Add `Help:` tags: `/help/sign-in-invitations` on the Community and Account-invitations bullets, `/help/accepting-your-invitation` on the `/invite` bullet, `/help/setting-up-two-factor` on the Account (2FA) bullet and `/account/2fa`.
5. Header-controls bullet: the avatar menu's "Help" item. Landing-page bullet: the Help link and the "PresbyPortal is in early release." line. `/signin`, `/totp`, `/access-pending` and the six toggle-off states carry the in-app help link.
6. Events administration bullet (F365): replace "weekly / monthly-by-weekday patterns" with "weekly, every two weeks, monthly on the same date, or the nth weekday of the month".
7. Bump the surveyed stamp to the release.

## `docs/architecture.md`

No change (Rule 15). It does not enumerate public routes or content, and a static, session-free help tree plus a build-time publication gate is a new surface but not a new subsystem or data flow. The architect reached the same conclusion. Revisit at Increment 3, where a public developer surface may merit one sentence.

## Release-note paragraph (non-engineer)

> **Help is now on the website.** PresbyPortal has a help site at presbyportal.org/help, and anyone can read it without signing in. It has plain-language guides for people who sign in, covering signing in, using your code, your account, why a page or button might be missing, and getting help. For church administrators it covers your first day, turning features on and off, adding people, officers and the Session, roles, events and the calendar, your congregation's website, and inviting people to sign in. There is also a short list of things PresbyPortal does not do yet, which is not a promise and has no date. You'll find a Help link on the home page, in the account menu, and on the sign-in, two-factor and no-access pages. Each guide says which release it was last checked against. The guides describe what the app does today, including where it does not yet do what you might expect: a new congregation's first administrator cannot yet add events or set the congregation's colours without asking the PresbyPortal team, and the guides say so. There is no contact form yet, so for now they point you to the person who invited you. The help pages are not yet listed by search engines.
>
> **Help:** `/help` (new).

It does not claim every page is current, does not deny the founder's missing keys, and does not promise search listing.

## Follow-Ups

Each is in the TODO lines above. The four items that must close before merge are not follow-ups: the preview check, O3, the integration walk, and the `why-cant-i-see-this` table.

## Red Flags

None (not NEEDS REWORK). Nothing shipped contradicts the build on the pages as they stand on `pipeline/user-help` against 0.47.0. The two things that will become false on merge are named, tested and in the checklist: the `adding-people` label and the Features table row.

### Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete for Increment 1. Verdict carries four pre-merge gates (Vercel preview check, O3 Google confirmation, integration re-walk as the accepted-invitation founding administrator at 360px, `why-cant-i-see-this` table fix). Rule 17 amendment, integration checklist, F-number assignments, TODO lines, map changes and release-note paragraph provided; no what's-new draft; `docs/architecture.md` unchanged | SHIP WITH NOTES | 2026-10-28 |

### Handoff

Next: the **orchestrator**, who applies the integration checklist after two-factor by role (0.49.0) merges. Ask the operator the O3 question and the F-new-r wording first, and the F362 and F366 product questions in parallel (neither blocks the merge). Then run the preview check. Hand treasury and photos their help impact by hand until Rule 17 is in `CLAUDE.md`. After the integration walk and the scoped QA run on the merged tree, no further analyst phase is needed for Increment 1. Each of Increments 2 and 3 starts with its own Phase 1 addendum.

Files:
- `/Users/cshenso/git/presby-platform/presby-help/docs/work-log/2026-10-26-user-help.md`
- `/Users/cshenso/git/presby-platform/presby-help/docs/work-log/2026-10-26-user-help-inc1.md`
- `/Users/cshenso/git/presby-platform/presby-help/src/lib/help/registry.ts`
- `/Users/cshenso/git/presby-platform/presby-help/src/lib/help/coverage-allowlist.ts`
- `/Users/cshenso/git/presby-platform/presby-help/src/content/help/` (all 23 files)
- `/Users/cshenso/git/presby-platform/presby/src/lib/onboarding/sign-in-copy.ts`
- `/Users/cshenso/git/presby-platform/presby/src/lib/onboarding/no-organization-copy.ts`
- `/Users/cshenso/git/presby-platform/presby/src/app/(email-verify)/account/verify-email/[token]/page.tsx`
- `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/p6-merged` (the scratch dry merge)
- `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/qa-help-p5/walk/` (QA screenshots I read)


## Operator rulings on Phase 6 (2026-10-28)

- **O3 Google sign-in:** operator is configuring Google OAuth in production now (instructions given 2026-10-28). The `signing-in` Google section publishes only after the operator confirms a successful Google sign-in; otherwise strip it at integration per the Phase 6 checklist.
- **F362 founder keys:** approved — give the founding administrator `events.manage`, `event_types.manage` and `branding.manage` by default, with a backfill for existing founders. Its own Feature pipeline; four help pages carry `limitationUntil` on its token.
- **F366 visitor recorded as Ruling Elder:** approved — fix so Session-seating offices and deacon require a current roll member (pastors exempt); bug-fix pipeline, operator rules on the other offices during it.
- **F371 worship-planning placeholder:** approved change to "Someone who holds the events role can put services on the calendar as events." (restore the original once F362 ships).


## Phase 4 — privacy policy page (operator request 2026-10-28)

**Why.** The operator is publishing PresbyPortal's Google sign-in app, which needs a privacy-policy URL on presbyportal.org. Rulings: the policy names the operator only as "PresbyPortal" ("we"); questions and data requests go to the operator's personal address, which must not be committed (public repository).

**Classification.** Feature (new page, new token, new env var), no schema, no route beyond the existing static `/help/[slug]`, no auth file touched.

### Design and the compliant place for `process.env`

- Page `privacy-policy`, `published`, audience `everyone`, order 80, empty `labels` and `covers` (a policy, not a how-to; the registry type allows both), `verifiedIn: "0.47.0"` (this branch's package version; H13 caps it there).
- New token `{{privacyContact}}` beside `{{contact}}` (`tokens.ts`). `applyHelpTokens(markdown, contact, privacyContact)` now replaces in one pass with a function replacer (no re-expansion, no `$&` handling).
- `src/lib/help/env.ts` (new, pure, no imports): `readPrivacyContactEmail(env = process.env)`. Unset or blank is `null`; one plain address is returned trimmed; **set but malformed throws**, so a bad value fails the build instead of publishing a wrong contact. The regex excludes every character that could close a markdown link, so inserting the value as a link destination is safe.
- **`process.env` question (R8/H19).** H19 bans importing db, auth, flags, authz, headers and sites modules; it does not ban `process.env`. The read still lives in exactly one place: `loadHelpPage()` in `content.ts` (the build-time loader, already `server-only`) calls `readPrivacyContactEmail()`. `loadHelpPageFrom()` takes the address as an option, so the loader's tests are deterministic. Every help route is `dynamic = "error"`, so the value is baked into static HTML at build and never read per request. Not `NEXT_PUBLIC_`.
- `contact.ts`: `privacyContactText(email)`. Set: `Email us at [addr](mailto:addr).` Unset: `HELP_PRIVACY_CONTACT_FALLBACK`, "Open an issue on the [PresbyPortal repository](https://github.com/chenson42/presby). Issues there are public, so leave personal details out." **The operator's suggested fallback ("Use the contact details on the PresbyPortal website") was not used: the home page carries no contact details.** Its only channel is the public repository (`src/app/page.tsx`, "Get involved"), so the fallback names that and says issues are public.
- **mailto gate.** `resolveLink` admits `mailto:` only when it equals `mailto:<the configured address>` (`linkContext(pages, privacyContact)`), as a new link kind `"email"`. Any other `mailto:` renders as plain text, so a stray address in a content file is never a link. `MarkdownDocument` renders `"email"` as a plain same-tab anchor (no new-window cue, no external icon).
- H5's message now reads "only {{contact}} and {{privacyContact}} are template tokens"; `unknownTemplateTokens` knows both. `check:help` runs with the variable unset, so it checks the fallback text (an allowlisted https link).
- `.env.example` gains `HELP_PRIVACY_CONTACT_EMAIL=` (empty, commented); `docs/deployment.md` env table gains the row; `docs/product/functionality-map.md` and `slug-history.ts` updated (H3, H15).

### Tests (written with the change)

`env.test.ts` (unset/blank/valid/malformed, message never echoes the value); `tokens.test.ts` (set and unset, escape, no re-expansion, near-miss token); `content.test.ts` (loader set and unset with an `example.invalid` address, the real page with `vi.stubEnv` set / unset / malformed, and the committed markdown holds the token once and contains no `@` or `mailto:`); `links.test.ts` (only the configured mailto; query, case, list and no-address refused); `markdown-document.test.tsx` (email kind is a plain anchor; other mailto is text); `checks.test.ts` (H5 accepts the new token, flags a near miss).

### Gates

`npm run typecheck`, `npm run lint`, `npm run test` (696 files passed, 97 skipped as before; 10560 tests passed), `npm run check` (all nine passed, `check:secrets` rerun with the new files staged), `npm run build` (the page is prerendered: `.next/server/app/help/privacy-policy.html`). Browser, production build on :3660 (listener stopped by PID afterwards), 360px, light and dark: variable unset shows the fallback with one external link; built with `HELP_PRIVACY_CONTACT_EMAIL=privacy@example.invalid` shows a same-tab mailto link to exactly that address and the built HTML contains that one address; horizontal overflow 0px in all four. Screenshots: `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/help-privacy/` (`unset-*` and `set-*`, `light`/`dark`, `top`/`contact`/`full`).

### Claims and the code that backs each

| Claim in the policy | Backing |
|---|---|
| Account data: name, email, hashed password | `src/lib/db/schema.ts` `users` (name, email, password); `src/auth.ts` `bcrypt.compare` |
| Authenticator secret stored encrypted; recovery codes stored as hashes | `schema.ts` `userTotp.secretCiphertext` (comment: AES-256-GCM), `userTotpRecoveryCodes.codeHash` |
| Last sign-in and failed-attempt count, lock after repeated failures | `users.lastLoginAt`, `failedLoginAttempts`, `lockedUntil`; `auth.ts` authorize and jwt callbacks; `USER_ACCOUNT_LOCKED` audit |
| Account roles | `roles`, `user_roles`; `ensureDefaultRole` in `auth.ts` |
| Google sends name, email, picture address, account ID; we refuse an unverified address | `node_modules/@auth/core/lib/utils/providers.js` `defaultProfile` (id, name, email, image); `auth.ts` `evaluateSignIn` with `email_verified` (DECISION-246) |
| We ask only for basic profile | `@auth/core` default scope `"openid profile email"` (`providers.js:48`, `authorization-url.js:90`); `auth.ts` sets no scope or `access_type` |
| We keep name, email, picture address, Google account ID and the returned tokens | `users.image`; `accounts` table (`providerAccountId`, `access_token`, `id_token`, `refresh_token`, `scope`); adapter `linkAccount` stores the whole account object |
| **Correction to the operator's brief:** Google sign-in stores more than name, email and the verified claim | the two rows above; the policy says so rather than "only" |
| The verified flag is checked, not stored | `profile` fn returns no `emailVerified`; `signIn` callback reads the claim |
| We do not show the Google picture | `grep` of `src` finds `.image` read only in `auth.ts`; avatars are initials |
| Congregations may keep: people, households, contact details, birth dates | `src/lib/db/domain/people.ts` (`dateOfBirth`), contact methods (`src/lib/contact-methods/`) |
| Roll and roll actions; officers and groups; privacy settings | domain `roll.ts`, `officers.ts`, `groups.ts`, `privacy.ts`; functionality map |
| Events, giving records, children's ministry roster with guardians, job openings, public website content | functionality map (events, online giving v0.34.0, children's ministry Increment A, careers v0.47.0, public sites); `src/lib/db/domain/events.ts`, `giving.ts`, `careers.ts`, `sites.ts` |
| Not named: photos, reimbursements, job applications | in flight or not shipped; the policy ends the list with "other records the organization chooses to keep" |
| Messages through a congregation's website contact form go to that congregation | `src/app/(public)/site/[slug]/actions.ts` `submitContactMessageAction` ("that org's inbox") |
| Audit records with IP address and browser type | `audit_events.ip`, `userAgent`; `src/lib/audit.ts` `recordAudit` (lines ~641 to 660) |
| Request counts by IP, and by email on sign-in forms, for a short time | `src/lib/rate-limit.ts` (in-memory and Upstash, windows of 60 s to 1 h); keys `signin:${ip}:${email}`, `site_contact:${slug}:${ip}`, `invite_accept:${ip}` |
| Email copy kept; statuses sent, failed, delivered, bounced, spam; opened/clicked if reported | `schema.ts` `emailQueue` (toEmail, subject, htmlBody, status, deliveredAt, bouncedAt, complainedAt, openedAt, clickedAt); `src/app/api/webhooks/resend/route.ts` |
| Invitations, password resets, email-change emails | `emailQueue.templateKey` comment; invitations (v0.37.0) |
| Feedback and tickets; feedback inside a congregation goes first to that congregation | `schema.ts` `feedback`; `src/content/help/getting-help.md` (verified in this increment) |
| Cookies: only sign-in cookies plus short-lived single-step ones | `session: { strategy: "jwt" }` (`src/lib/auth/config.ts`); `cookies()` uses: `FRESH_RECOVERY_CODES_COOKIE` (5-minute TTL, `account/2fa/actions.ts`), the invitation handoff cookie (`(invite)/actions.ts`) |
| No advertising or analytics cookies; no analytics or tracking tools on our pages | `package.json` has no analytics, ads or tag-manager dependency; `src/app/layout.tsx` loads no third-party script; light/dark choice is the only `localStorage` use and no toggle exists (`theme-provider.tsx`) |
| We do not sell or rent personal information | no code path or integration that does; stated as policy |
| Vercel hosts | `docs/deployment.md`, `vercel.json` |
| Neon, database in the United States | `docs/deployment.md` (project `presby`, aws-us-east-2) |
| Resend sends our emails | `src/lib/email/`, `RESEND_API_KEY` |
| Stripe takes online gifts, hosted page, no card number stored | functionality map "online giving" ("no card data on any presby page"); `give-form.tsx` `CHECKOUT_ORIGIN = https://checkout.stripe.com` |
| Cloudflare Turnstile where turned on; receives IP | `src/lib/turnstile.ts` (no-op without `TURNSTILE_SECRET_KEY`, sends `remoteip`); widget on sign-in, forgot-password and the public give form (`src/components/shared/turnstile.tsx`, `give-form.tsx`) |
| Upstash request counts where used | `rate-limit.ts` `useUpstash` (only when both env vars set) |
| Google only if chosen | `auth.ts` providers; `/signin` |
| Providers keep ordinary technical logs | general property of the host and database services; stated without detail |
| Congregation records are permanent; people are never deleted, only corrected, merged or ended | CLAUDE.md "Never Hard-Delete a Person"; `drizzle/0009_presby_rls.sql:376` (`revoke delete on people`); roll actions append-only |
| A deactivated account is kept and blocked | `users.isActive`; jwt callback returns `{}` for an inactive user; `(admin)/admin/users/actions.ts` `deactivateUser`; `USER_DEACTIVATED` |
| Audit records and email log are not deleted on a schedule | no delete in any cron for `audit_events` or `email_queue` (`src/app/api/cron/maintenance/route.ts`); `deployment`/DECISION text says indefinite retention for `email_queue` |
| Reset and email-change links expire and are cleared daily | maintenance cron `0 3 * * *` (`vercel.json`) deletes expired `password_reset_tokens`, `email_verification_tokens`, pending TOTP enrolments |
| "Delete account" records the request but deletes nothing; ask us instead | `(account)/account/actions.ts` `requestAccountDeletion` (stub: writes `USER_DELETION_REQUESTED`, returns ok); `delete-button.tsx` toast "not yet implemented. Contact support" |
| Users can change name, email, password themselves | `src/content/help/your-account.md`; `/account` |
| Congregation records about you belong to the congregation | operator ruling (controller/processor split) |
| Security: two-factor, hashed passwords, encrypted connections, per-congregation isolation | `users.twoFactorRequired` default true, TOTP; bcrypt; HTTPS and HSTS (CLAUDE.md custom-host section); `FORCE ROW LEVEL SECURITY` (CLAUDE.md Isolation). No absolute promise made |
| Accounts are for adults; children's records are the congregation's | no age gate in code, so the policy says "do not knowingly"; children's ministry roster (functionality map). No photos named (not shipped) |

### Notes for the operator and the orchestrator

1. **Set `HELP_PRIVACY_CONTACT_EMAIL` in the Vercel Production scope, then redeploy.** The address is baked in at build. Until then production shows the repository fallback, which is true but not what Google's reviewers want.
2. The policy deliberately does not add Google's "Limited Use" compliance sentence. Basic sign-in scopes (`openid profile email`) do not trigger it; if Google's review asks, it is one added sentence and a policy decision for the operator.
3. Real gap the page is honest about: account deletion is a stub. The page says to ask us and that a deactivated account is kept. If the operator wants true erasure of the account row, that is a feature (DECISION-015 requires a blocklist alongside it).
4. `verifiedIn` is `0.47.0` because this branch's package version is 0.47.0; the claims were read against this branch and the 0.48.1 changes on main (recovery-codes display) do not alter any of them. Integration may bump it when the page is re-walked.
5. The "Everyone who signs in" index group now lists the policy last (order 80). Its previous-page link is Getting help.
6. Docs/TODO.md and the release-notes entry are left to integration (Workflow Rule 16 shared files).


## Integration — merged tree and release 0.50.0

*2026-10-28, integration agent, worktree `presby-help`, branch `pipeline/user-help`. Not pushed. No `.env.local` value or connection string was printed (presence and length only). Servers on :3660 and :3661 were my own, started from a clean `.next` and stopped by PID. Scratch: `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/int-help/`.*

### Commits

| Commit | What |
|---|---|
| `4d8fcb4` | Merge `origin/main` (0.49.0). One conflict, `docs/product/functionality-map.md`: took `main`'s file and re-applied the branch's edits by script (the Help index bullet, the Help section, `Help:` tags). Three lines both sides had changed (TOTP verify, `/no-organization`, Community) were merged by hand: `main`'s new text plus the branch's trusted-device correction and `Help:` tags. After the merge `check:help` reported only H10 on `adding-people` and `coverage.test.ts` only `org_portal.sign_in_connect`, exactly as Phase 6 predicted. `docs/TODO.md`, `package.json` and `docs/deployment.md` auto-merged. No dependency change. |
| `55b5f33` | `chore(integration)`: shared files. DECISION-293 (with the architect's 404 sentence and both *Revisit if* additions, taken verbatim from the architect's ruling after Batch 3), 294, 295, and the design decisions as **DECISION-296** (split tripwire, closed content subset) and **DECISION-297** (fixture-only screenshots); the head of `docs/decisions.md` was 292, and no other worktree holds 296 or 297. `CLAUDE.md`: Rule 17 with the analyst's amendment inserted after the "A feature in flight" sentence, the four Project Layout lines, `(documentation)` in the platform-palette list, "nine" tripwires in the Phase 4 gate and Common Commands, the `check:help` / `help:shots` / `check` command lines. The four agent files, the release-notes skill (Step 4 bullet, Feature and Enhancement `**Help:**` lines), the pre-push skill (a hard **Step 3g `npm run check:help`**, the Step 7 advisory bullet and a summary line), the template's four edits. F345–F381 recorded in `docs/schema-design-2.md` section **2al** (F350 was free on `main`: `main` holds F340–F344 only, so no renumbering). `docs/STATE.md` gains the 2al line, the merge gates and next-free numbers (DECISION-298, F382, migration 0082). `docs/reviews/log.md` not applicable (no review ran). |
| `f5b171e` | `chore(release)`: 0.50.0. New `docs/release-notes/v0.50.md` from Phase 6's paragraph verbatim, plus one line for the four pages published here and one for the privacy policy, `**Help:** /help (new)`; `v0.49.md` links forward; `package.json` and the lockfile. **Order deviation:** the release commit comes before the publish commit, because H13 refuses a `verifiedIn` later than `package.json`, and the walk's stamps are 0.50.0. |
| `8506595` | `feat(help)`: `limitationUntil` accepts a list. `your-congregations-website` needs two markers (F361 and F362), which the single-token type could not hold. H1 checks each token and refuses an empty list; H12 reads each. Test first: the new 11e case failed on the array before the change. |
| `3e618a2` | `docs(help)`: publish `accepting-your-invitation`, `setting-up-two-factor`, `sign-in-invitations`, `who-is-asked-for-a-code` (verifiedIn 0.50.0, slug-history, map lines); the three dedicated In Flight lines (`signin-invites`, `recovery-codes`, `two-factor-by-role`) move to Done (2026-10-28) as one Done line carrying all three tokens; the four `limitationUntil: signin-invites` markers removed with their sentences; all the step-3 page edits; the functionality-map changes; re-stamps. **Deviation:** the checklist's step 3 (edits) and step 4 (publish) are one commit, because the step-3 edits link the pages step 4 publishes and H6 refuses a link to a pending page, so a separate step-3 commit would be red. |
| `1516fe3` | `feat(help)`: the `/invite` and `/no-organization` help links, with unit tests. **Deviation:** a separate commit from the publish commit, because it is code and a commit takes one prefix (CLAUDE.md, Mixed-commit rule). |
| `a201b0d` | `docs(todo)`: the sixteen Phase 6 TODO lines under Next Up (including F362 `[help:founder-events-branding]`, F366, `[help:email-change-error]`, `[help:phone-public-listing]`, and the two operator steps: the Vercel preview check and `HELP_PRIVACY_CONTACT_EMAIL`) and the limitation markers: `founder-events-branding` on `first-day-as-administrator`, `roles-who-can-do-what`, `events-and-the-calendar`; both tokens on `your-congregations-website`; `email-change-error` on `your-account`. |
| `9ec14a9` | `docs(briefings)`: the 0.50.0 entry (DECISION-293 to 297). The `covers:` marker is on `1516fe3`, the last feat commit, not on the release commit, because `briefings-check.mjs` counts feat commits after the marker and two landed after the release commit. |
| (this record) | `docs(work-log)`. |

**Google strip commit (O3), not on this branch:** `d7889c3` on `scratch/user-help-google-strip` (parent `9ec14a9`). It removes the Google intro sentence, the "Signing in with Google" section and the no-password note from `signing-in`, the Google clause from `using-your-code` and `your-account`, the "Sign in with Google" label and the Google words in the summary, and makes the `signin-form` caption "The sign-in page on a phone." in both the page and the manifest. The privacy policy keeps its Google section, which is what Google's app review reads. `check:help` passed and the 325 help and documentation unit tests passed in that tree. Apply with `git cherry-pick d7889c3` if the operator has not confirmed a production Google sign-in; it applies on top of this record.

### Schema applied to the pipeline branch

`pipeline-user-help` lacked 0065 and 0080 (probed: no `presby_users_guard_email_proof`, column default still true). Applied as the owner with `-1`: `drizzle/0065_presby_sign_in_and_connect.sql`, then `drizzle/0080_presby_two_factor_default.sql`; both exit 0. Verified: `users.two_factor_required` default false; six keys flagged `requires_two_factor` (`domains.manage`, `giving.manage`, `giving.record`, `giving.view`, `role_grants.manage`, `roles.manage`). Seeds: `scripts/seed-dev.sql` is not re-runnable on a seeded branch (it stopped at the first fixture insert, a duplicate organization id, inside its transaction, so nothing changed); its only non-comment change on `main` is the `\ir` of `scripts/sign-in-invitations/seed-dev-sign-in.sql`, which I ran on its own (idempotent, exit 0). `npm run db:seed` exit 0. 0071 and 0072 were already on the branch (it was cut after careers). The flags were byte-identical to `help-5c/flags-before.txt` after all of this.

### Copy rows (the two in-app links, recorded per the checklist)

| Where | Text | Target | Viewer | Four checks |
|---|---|---|---|---|
| `/invite`, under the card, every state (anonymous, signed in, mismatch, two-factor, dead link, unavailable, `/invite/accepted`) | Help with this page | `accepting-your-invitation` (`rel="noreferrer"`) | anyone holding the link | Residuals: none denied. Source: the target is published in the same release. Audience: no role needed; the page is public. Neighbours: no other `/invite` string mentions help. |
| `/no-organization`, at the end of the bordered section, every view | Why can't I see this? | `why-cant-i-see-this#not-connected-to-a-congregation` | a signed-in account with no enterable organization | Residuals: none denied. Source: the anchor is declared and the heading exists. Audience: no role needed. Neighbours: the page's own "Ask the office" and "Is your church not on PresbyPortal?" sections stay true. |

QA Phase 5 findings 1 and 2 (the `you@example.org` placeholder; the "Help site" and "More help pages" aria-labels) are accepted as Copy rulings per Phase 6, no code change.

### The integration walk (Phase 6 rule), as the person each path creates

Dev server on :3660, merged tree, flags at production posture, 360x780.

**Person.** A congregation created through the real `/admin/organizations/new` form (Wrenmoor Presbyterian Church, slug `wrenmoor-int`, invented), a founding-administrator invitation row with a known token (as `e2e/support/invitation-fixture.ts` seeds it), accepted as a **new account** through the real `/invite` page (`founder.wm@example.invalid`).

1. **`/invite` link page.** Heading "You're invited"; "A PresbyPortal administrator invited you to be the founding administrator at Wrenmoor Presbyterian Church."; the masked address `f***@example.invalid` and the expiry date; "Create your account" with First name and Last name prefilled, the password rule, the show/hide button, "Create account"; "Already have an account?" with "Sign in to accept"; under the card **"Help with this page"** → `/help/accepting-your-invitation`, `rel="noreferrer"`, 44px. Horizontal overflow 0. Page: `accepting-your-invitation`.
2. **"Your account is ready"**, "Sign in with the email address the invitation was sent to and the password you just chose. If your role needs two-factor sign-in, you will be walked through setting it up the first time.", "Sign in", and the help link again. Then `/signin` → **`/account/2fa?callbackUrl=/launch`** (the founder is required by role, F343): "Enroll in two-factor authentication", QR, "Can't scan? Enter manually", six boxes; the sixth digit submitted. "Two-factor authentication enabled", "Your authenticator app is now linked…", "Recovery codes — save these now" with ten codes, "Continue". Continue → **`/o/wrenmoor-int`** with no second `/totp` (DECISION-292). Pages: `setting-up-two-factor`, `who-is-asked-for-a-code` (a first administrator is asked).
3. **Landing `/o/wrenmoor-int`** (`first-day-as-administrator`): "Good afternoon, Rosalind.", "Find a person", "Coming up", tiles under Community, Worship & Events (with "Worship & Service Planning · Coming soon"), Governance & Courts, Reports & Insights, Communications. **Administration** is headed "Organization Administration" and lists exactly **Manage events, Roles, Tickets, Features, Branding**. "Manage events" → "You don't have permission to manage events at Wrenmoor Presbyterian Church. If you think this is a mistake, ask your stated clerk or another administrator there."; "Branding" → the same for branding. (F362 stands; the page says so and now carries the marker.)
4. **Features** (`turning-features-on-and-off`): the card **"Connect people when they sign in"** is present with the catalog's description and its switch **on**; "Community: add people and record roll actions" was off and turned on ("…turned on." toast). **Community** (`adding-people`): empty state "No one yet"; added Ambrose Kettleby and Beatrix Holloway as participants through the six-step wizard, each with an email ("Participant added. They're counted from the date you chose."); the list then shows the views Everyone, Members, Participants, Visitors, **Staff**, Former, each person with "Participant" and the **"Not connected yet"** marker. **Officers** (`officers-and-the-session`): recorded both as Ruling Elder ("Officer term recorded."); the roster note reads "…They can approve only once they have connected a sign-in, either by signing in with the email address on their record or by accepting an invitation." and each row carries "Not connected yet". **Pending approvals**: banner "No one can approve yet", "2 members of the Session are recorded, but none has connected a sign-in yet, so no one can approve.", the hand-off line, and one row per seat, "Not invited yet" with **"Invite"** (linking the record's `#sign-in` card). **Inviting** (`sign-in-invitations`): Ambrose's card "Sign in to PresbyPortal", "Invite Ambrose Kettleby to sign in. We'll email … with a link that works once…", plus the seat sentence "…connects them once they have confirmed two-factor sign-in."; "Send invitation" opens "Send an invitation to Ambrose Kettleby?" with the address, the expiry and the "whoever opens the link becomes…" warning; confirmed: toast "Invitation sent to … It expires Nov 4, 2026."; the card then reads "Invitation sent to … on 10/28/2026. It expires 11/4/2026.", "Sent", "You can send it again in 5 minutes.", "Send again", "Cancel invitation" and "While this invitation is open, signing in does not connect Ambrose Kettleby by itself." Pending approvals then shows Ambrose "Invitation sent 10/28/2026" with "Open", and "Invitations sent to 1 of the 2 members of the Session. Waiting for them to accept."
5. **As the elders** (`why-cant-i-see-this`, `sign-in-invitations`). Each signed in with an account on the address on their record (created on the owner path, as the e2e fixtures create accounts). **Ambrose** (open invitation) lands on `/no-organization` headed **"You're invited to Wrenmoor Presbyterian Church"** with the sign-in card, the expiry and **"Accept the invitation"**; **Beatrix** (no invitation) lands on **"You're not connected to a congregation yet"**, "Ask the office that keeps your records", **"Check again"**; after Check again the page adds **"One more step: set up two-factor sign-in to finish connecting. Then come back here and select Check again."** with "Set up two-factor sign-in". Both pages end with **"Why can't I see this?"** → `/help/why-cant-i-see-this#not-connected-to-a-congregation`, 44px.
6. **The founder signs in again** (`using-your-code`): `/totp` "Two-factor authentication", the six boxes, "Use a recovery code instead", **"Help with two-factor sign-in"** → `/help/using-your-code`; the code took the founder to `/launch` and on. **`/account`** (`your-account`): Profile, Email address ("Current email"), Password, Two-factor authentication "Active" with "Manage / regenerate codes". **`/account/2fa`**: "You enrolled on 10/28/2026", "10 unused codes remaining (of 10 total).", "Regenerate recovery codes" (no "Confirm it's you" in a verified session).
7. **Every changed or newly published help page** at 360px, light and dark: the four published pages, `why-cant-i-see-this`, `adding-people`, `officers-and-the-session`, `how-a-congregation-gets-started`, `first-day-as-administrator`, `your-account`, `using-your-code`, `turning-features-on-and-off`, `privacy-policy`, `home-and-switching-congregations`, `/help` and `/help/planned/worship-planning`: each 200, one `<h1>`, horizontal overflow 0 in both schemes. `why-cant-i-see-this` read at 360: the four short entries each show what it means and who can fix it without scrolling sideways (QA finding 3 closed). The worship-planning placeholder reads "Today: There is no worship planning tool. Someone who holds the events role can put services on the calendar as events."
8. **Privacy policy.** With `HELP_PRIVACY_CONTACT_EMAIL` unset (length 0 in `.env.local`), "Questions and requests" shows the fallback, "Open an issue on the PresbyPortal repository … Issues there are public, so leave personal details out.", on the dev server and baked into `.next/server/app/help/privacy-policy.html` by the build. **One claim had gone stale at the merge** and was corrected in `3e618a2`: the cookies paragraph said a short-lived cookie shows your recovery codes once; 0.48.1 removed that cookie (codes are in client memory; `account/2fa/actions.test.ts` pins its absence), and the only cookie the app's own code sets, beside the sign-in cookies, is the invitation hand-off (`(invite)/actions.ts`). It now reads "…and a short-lived one for a single step: accepting an invitation."

**Re-stamped to 0.50.0 (walked above):** `why-cant-i-see-this`, `adding-people`, `officers-and-the-session`, `how-a-congregation-gets-started`, `first-day-as-administrator`, `your-account` (the account page and its two-factor section; the email-change landing was not exercised, and its workaround sentence stays with its marker), `using-your-code`, `turning-features-on-and-off`, `privacy-policy`, and the four published pages. **Kept at 0.47.0 (not re-walked):** `what-presbyportal-does`, `signing-in` (O3 open), `home-and-switching-congregations` (rendered, but `/home` was not walked: the founder has one congregation and lands on it), `using-the-directory`, `getting-help`, `roles-who-can-do-what`, `events-and-the-calendar`, `your-congregations-website`.

**Walk residue on `pipeline-user-help`:** the Wrenmoor organization, its founder, two participants seated as elders, one open sign-in invitation, and the two elder accounts (all `.invalid`). Removed with the Neon branch at cleanup.

### Gates on the merged tree

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass (`--max-warnings=0`) |
| `npm run check` | all **nine** tripwires pass; `check:help`: 29 registry entries, 21 published, 24 content files, 7 images |
| `npm run build` from a clean `.next` | pass on the second attempt; the first failed with the known transient `Can't resolve '@vercel/turbopack-next/internal/font/google/font'` (Batch 4 saw the same), and the retry from a clean `.next` was green. `/help` ○, `/help/planned` ○, 21 `/help/[slug]` and 5 `/help/planned/[slug]` ● (SSG), `/help/[...unmatched]` ƒ; the privacy fallback is baked into `privacy-policy.html` |
| `npm run test` | **731 files passed, 114 skipped; 11,205 tests passed, 3,194 skipped, 0 failed** |
| Chromium, full (own `next dev` :3660, clean `.next`, flags reset to the CI baseline with `scripts/ci/e2e-reset-flags.sql -v pipeline_branch=1`) | **609 passed**, 0 failed, 29.5 m. Includes the MFA login path (`totp-full-login`, `totp-code-entry`, `totp-recovery-code`, `session-claim-integrity`, `post-login-routing`, `help-gates`) and the four 2b specs re-run after the links went in: `invitation-new-account`, `invitation-existing-account`, `no-organization-connect`, `community-sign-in-invite` |
| Custom-hosts (same server) | **132 passed**, 4.1 m |
| Production lane (`PW_PROD_BUILD=1 PW_PROD_PORT=3661 npm run test:e2e:prod`, its own build from a clean `.next`) | **105 passed**, 3.4 m (hydration, `help-404`, `prod-custom-hosts`) |
| Flags | restored to production posture afterwards; `diff` against `help-5c/flags-before.txt` empty |
| DB-backed suites, `test-rls.sql` | not owed (no migration in this increment) |

Both servers were stopped by PID; :3660 and :3661 are free.

### For the orchestrator and the operator

1. **Vercel preview check of the help 404** (merge gate, now a `docs/TODO.md` line): not run here; it needs the PR's preview.
2. **Google sign-in (O3):** if the operator has not confirmed a successful production Google sign-in, `git cherry-pick d7889c3` (branch `scratch/user-help-google-strip`) before pushing; the TODO line to restore it is already open. Delete the scratch branch either way.
3. **After deploy:** set `HELP_PRIVACY_CONTACT_EMAIL` in Vercel Production and redeploy (TODO line).
4. **Treasury and photos:** their pending pages stay pending, and their `[help:reimbursements]` and `[help:person-photos]` lines stay open. With Rule 17 now in `CLAUDE.md`, their integrations publish those pages in the commit that moves the line to Done.
5. **Phase 6's "Done line" for Increment 1** is not written: Phase 6 conditions it on the preview check and O3, which are still open. Add it with the merge.
6. The `development` branch still lacks the walk's re-check (`docs/TODO.md` has F343's 360px re-walk); nothing here touched `development` or production.

## Orchestrator note: the Vercel preview gate (2026-10-28)

The PR's Vercel preview never builds: git-triggered previews are cancelled by the project's Ignored Build Step, and a CLI preview (`vercel deploy`) fails at `next build` because the Preview environment has no `DATABASE_URL` (by design; previews never get a database). So the DECISION-293 preview check cannot run before merge. Ruling: merge on green CI and run the same check on production immediately after deploy (`/help/no-such-page` and `/help/planned/no-such`, twice each: 404, the help heading, `no-store`, no cache HIT). The failure mode is benign (the framework 404, still a 404, no cache entry per URL is the property that matters and is verified on `next start` by `help-404.spec.ts`); if production serves the framework 404, apply Option B as a follow-up per the architect's ruling. The same constraint applies to the treasury and photos `sharp` checks: they move to "one real upload on production with the toggle off for every congregation but a test one".
