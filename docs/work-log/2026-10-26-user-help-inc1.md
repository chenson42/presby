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
| 4 — Implementation | orchestrator (Batch 0), api-developer (1), ux-developer (2, 5), full-stack-developer (3, 4) | In progress: Batches 0 and 1 done (`d6e7bd7`); Batches 2 to 5c pending | — | 2026-10-28 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

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
- An unknown, pending, planned-under-`/help/<x>`, retired or typo'd slug is `notFound()` through `dynamicParams = false` and renders `help/not-found.tsx` at HTTP **404**. The response and its timing are the same for every cause (Phase 1 enumeration finding).
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
2. **New `e2e/help.spec.ts`** (no flag, signed out, desktop and 360): `/help` renders with no redirect, one `<h1>`, the skip link, `meta name="robots"` noindex; each published page responds 200, has exactly one `<h1>`, the on-this-page list works with JavaScript held (it is a `<details>`), and at 360px has no horizontal overflow (`scrollWidth <= clientWidth` on the document) and every tap target in the page chrome is at least 44px tall; an **unknown** slug, a slug read from the registry's **pending** entries (when any exist) and `/help/planned/no-such` each return **status 404**, render the same body, and link to the index (and **no redirect to `/signin`**); `/help/planned` shows the fixed label text on each entry and each planned page has a robots noindex meta tag; `/help?next=//evil.example` and `/help?callbackUrl=…` render the index and reflect nothing (no open redirect, Phase 1 adversarial).
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
2. **A pending slug is a different 404 from an unknown slug.** It is not: both come from `dynamicParams = false` (`help.spec.ts` compares status and body for an unknown slug and for a registry-derived pending slug; a unit test pins that `generateStaticParams` excludes pending). Timing is not measured (*unverified*).
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
| R3 | The static lock section; `shell-boundaries.test.ts`; QA reads `●`/`○` |
| R4 | The renderer contract table |
| R5 | Images paragraph; static imports; no `public/`; H17, H18 |
| R6 | H12 and the grammar table; P3-6; P3-7 |
| R7 | `check:help` shape; P3-1 moves the catalog and tile rules to vitest |
| R8 | H19 via the lifted walker (P3-3); the catalog extraction *deferred to Increment 3* (architect's own "if a Needs block renders toggle names by import": none does in Increment 1) |
| R9 | No `loading.tsx`, no `error.tsx`; `shell-boundaries.test.ts` |
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

---

# Phase 5 — Verification (qa)

*Pending. Gate: the auth-touching e2e (MFA-enrolled user, real dev server on :3660, production lane on :3661) must have run, or the verdict is BLOCKED. Also: `npm run check` (nine), `coverage.test.ts`, `next build` route table, every published page at 360px in light and dark, every committed image read, the copy-truthfulness check on the help diff.*

---

# Phase 6 — Shipped vs Intent (analyst)

*Pending. The walk repeats for every published page, as its reader, on a dev server at 360px; Help impact is checked against Rule 17.*

---

## Operator rulings on Phase 3 (2026-10-26)

- **O1 placeholders:** approved `worship-planning`, `children-check-in`, `communications`, `event-sign-ups` and `presbytery-tools`. **Struck:** `ledger`, `meeting-minutes`, `directory-export` (operator did not select "Money & records"). No importer placeholder.
- **O3 Google sign-in:** operator verbatim: "it hasn't been configured yet, but document it still. i'll turn it on and test soon." The `signing-in` page documents Google sign-in. Before that page publishes, the orchestrator confirms with the operator that Google sign-in works in production; until confirmed, the Google section is the one known-unverified claim and Phase 6 must check it.
- **O5 Rule 17 and the CLAUDE.md / agent-file / template edits:** approved as drafted; the orchestrator applies them at integration.
- **O2, O4, O6, O7:** defaults taken (link to the public repository until the contact form ships; static header shows "Sign in" to everyone; each in-flight feature's page publishes in its own integration commit, 2b included; add the six "How features are turned on" links).
