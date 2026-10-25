# Platform admin redesign, Increment 1: Platform shell — Work Log

> **Slug:** `2026-10-25-platform-admin-redesign-inc1`
> **Parent:** `2026-10-25-platform-admin-redesign` (Phase 1 U1–U13, G1–G24, Q1–Q14 and Phase 2 R1–R10, S1–S5 live there, verbatim; this child records Increment 1's Phase 3 through Phase 6)
> **Surface:** (admin) — the platform operator's console
> **Permission(s):** existing `FEATURES.ADMIN_*` keys only; no new key. `src/lib/permissions.ts` gets a copy-only change (R5)
> **Flag(s):** not needed (operator: no new platform flags pre-live; rollback is a revert of the PR)
> **Estimated complexity:** large (about 45 files, no schema)
> **Pipeline mode:** Full
> **Numbers:** DECISION-251, 252, 253, 255 (drafts below); F274, F276, F281; no migration; dev port 3530
> **Worktree:** `/Users/cshenso/git/presby-platform/presby-padmin`, branch `pipeline/platform-admin-redesign`, merged up to `main` at `77be511`. The worktree has no `node_modules` and no `.env.local` yet (Phase 4 step 0).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Shared; recorded in the parent | READY WITH NOTES | 2026-10-25 |
| 2 — Architectural review | architect | Shared; recorded in the parent | Approved with suggestions | 2026-10-25 |
| 3 — Technical design | tech-lead | Complete (this file); S1–S5 ruled; copy table and carry-forward below; two operator questions | Design complete | 2026-10-25 |
| 4 — Implementation | api-developer (Batch B), ux-developer (Batches A and C) | Batches A, B and C complete (A: 3 commits, B: 2, C: 3) | — | 2026-10-25 |
| 5 — Verification | qa | Run 1: all green; FAIL on two test gaps (boundaries allow-list misses 4 forms; org-list description untested) | FAIL | 2026-10-25 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 and Phase 2

Recorded in full in `docs/work-log/2026-10-25-platform-admin-redesign.md` (parent). Not repeated here. Increment 1 is designed against R1, R2, R4–R7 and R9; R3 and R8 are carried to Increment 2.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Increment 1 replaces the platform console's shell and its home page, and changes no data. The flat, unfiltered 13-link sidebar becomes a grouped, permission-filtered nav with an active state, a phone menu (a generated `Sheet`) and a header that mounts the same avatar menu the org portal uses, so sign-out lives in one place. The tile grid on `/admin` is retired and replaced by a dashboard of count cards built only from reads that already exist (tickets, feedback, email, giving notices, domains, sites, two-factor, locked accounts, organizations at a glance) plus the "recent operator changes" card (ruling S1: in this increment). Each card is its own async server component inside its own `Suspense`, catches its own failure, and never shows a failure as zero. A new `error.tsx` gives the console a calm failure state; **no `loading.tsx` exists anywhere under `(admin)/admin`** (R1c), pinned by a test. Four shared pieces are added (`LoadError`, `EmptyState`, `CountCard` in `shared/`, `AdminForbidden` in the new `src/components/admin-portal/`). A source-scan test holds every dashboard reader to an allow-list of platform-axis tables, so a tenant table is forbidden by default (R7b). `/admin/docs` gets its missing page-level gate (F281), the stale `ADMIN_ORGANIZATIONS` catalog copy is corrected (R5), and the layout padding becomes `p-4 sm:p-8` with a `ui-standards` note (R6). The nav and the dashboard are one design: the dashboard zones mirror the nav groups, so the operator learns one structure.

## Rulings on the Phase 2 suggestions (S1–S5) and the Phase 1 defaults this increment depends on

| # | Ruling | Reason |
|---|---|---|
| **S1** | **Accepted.** Card 12 (recent operator changes) ships in Increment 1, gated `ADMIN_AUDIT`. | It reads only `audit_events` and the public `organizations.name`, depends on nothing in G14, and is the only place DECISION-194's accepted residual (revoke, then self-addressed invite, then accept) becomes visible. Cost: one reader, one view, a closed label map and one DB test. |
| **S2** | **Ship the create form's `HydrationGate` as a standalone bug-fix, not inside Increment 1 and not waiting for Increment 3.** Needs the operator's yes (Question 1). If approved, that fix carries **F275**; Increment 3 then keeps only the permanence line and the type panel. | A live F124-class defect whose wrong outcome is permanent (a Congregation created when a Presbytery was meant, with no way to repair it), open since TODO.md:185, with Increment 3 weeks away. It does not belong in Increment 1: it touches a route this increment never touches, the one-commit-one-prefix rule would make it a separate `fix:` commit anyway, and QA's Increment 1 verification (admin shell and dashboard) would be diluted. Shape is below (Bug-fix note). It can merge before or after Increment 1; the files do not overlap. |
| **S3** | **Not an Increment 1 question.** Deferred to the Increment 3 design (0070 trigger guarding `organization_type` and `slug`). | Increment 1 contains no string that states or implies database enforcement of type or slug permanence (checked in the Copy table, group H). |
| **S4** | **Accepted.** `src/lib/admin/` and `src/lib/admin-portal/` stay separate; `two-factor-stranded.ts` goes in `src/lib/admin/` (R2). | `check:giving-boundaries` B6 pins `src/lib/admin/giving-ingest-health.ts` by path. Documentation-review item recorded in the Carry-forward table. |
| **S5** | **Not applicable to Increment 1** (no "Feature adoption" card). Recorded as a constraint for any later card: count effective state through the R3 resolver or label it "turned on (stored)"; never a bare "on". | Optional card, not built. |
| Q5 | "Feature flags" joins **Access and settings** (no one-item "Platform" group). | Operator took the analyst's default. |
| Q11 | Release notes and Design system sit in a footer **Reference** group. | Operator took the default. |
| Q7 | Card 12 shown to `ADMIN_AUDIT` holders. | Same as S1. |
| G22 | Include the running version as a muted line at the foot of the nav ("Version 0.42.3"). | Cheap; `APP_VERSION` is a build-time constant that is safe in the client bundle. |

### Bug-fix note for S2 (only if the operator approves; the orchestrator opens `docs/work-log/2026-10-25-org-create-hydration-gate.md`)

- **Root cause.** `new/create-organization-form.tsx` controls the type and parent `<select>`s and two hidden inputs with `useState`. It is not a `useForm` root, so `npm run check:hydration-gate` does not see it and `HydrationGate` was never applied. Anything picked before hydration is overwritten by the first client render, and a wrong type or a missing parent is permanent (no in-product correction exists).
- **Fix shape.** Wrap the `<form>` in `<HydrationGate>`. No other change.
- **Failing-first test.** In `create-organization-form.test.tsx`, render with `useHydrated` mocked to `false`: the gate fieldset is disabled and the submit button is not operable; with it `true`, enabled. Add the form to the production-build hydration lane (`e2e/hydration/`, `npm run test:e2e:prod`) if that lane has a generic held-chunks helper; otherwise note it as the only gap.
- **Commit.** `fix(admin): hold the create-organization form until it has hydrated`, trailers `Caught-By: agent-review`, `Discovered-In: Phase-5` (the 2026-09-28 organization-parent-picker pipeline recorded it), `Work-Log: 2026-10-25-org-create-hydration-gate`.
- **Implementer.** ux-developer or full-stack-developer; one file plus its test.

## Permissions & Flags

- **Permission keys:** none new. Every nav item and card maps to an existing key; the door is `ADMIN_DASHBOARD`.

| Surface | Key | Notes |
|---|---|---|
| Nav: Dashboard, Design system | `ADMIN_DASHBOARD` (door only) | Design system has no key of its own and stays door-level by design (F281); the nav and the `design-system/page.tsx` header comment say so. |
| Nav and cards: Organizations (+ New organization, find box), Domains, Sites, Giving health | `ADMIN_ORGANIZATIONS` | Cards: organizations at a glance, giving notices, domains, sites. |
| Nav and card: Tickets | `ADMIN_TICKETS` | |
| Nav and card: Feedback | `ADMIN_FEEDBACK` | |
| Nav and card: Email queue | `ADMIN_EMAIL_QUEUE` | |
| Nav: Users & roles; card: locked accounts | `ADMIN_USERS` | |
| Nav and card: 2FA policy / two-factor | `ADMIN_TWO_FACTOR` | |
| Nav: Feature flags | `ADMIN_FLAGS` | |
| Nav: Audit log; card: recent operator changes | `ADMIN_AUDIT` | |
| Nav: What's new | `ADMIN_WHATS_NEW` | |
| Nav and page gate: Release notes | `ADMIN_RELEASE_NOTES` | `/admin/docs` gains a page-level check (F281); the proxy already enforced it at `src/proxy.ts:42`. |

- **Default role bindings:** unchanged. `admin` sees everything; `support_operator` (door + tickets + feedback) sees Dashboard, Tickets, Feedback and Design system in the nav and exactly two cards, both in the Support zone.
- **Hiding is not authorization.** Every destination keeps its own check. A card's reader is mounted only for a holder, so a reader never runs for a non-holder (pinned, Edge E4).
- **Predicates stay separate (DECISION-044).** Nav and dashboard use only `session.user.features`. The Developer item stays in the avatar menu behind the live `isPlatformAdmin` read; no Developer link goes in the nav.
- **Flags:** none. **Every e2e spec this increment adds or changes depends on no feature flag** (checked: no reader, page or component in this increment calls `isFlagEnabled`), so nothing goes into `e2e/support/flags.ts` or `scripts/ci/e2e-baseline-flags.sql`.
- **Touched-file rule (R9).** Nothing is edited in `src/auth.ts`, `src/proxy.ts`, `src/lib/authz.ts`, `src/lib/auth/**`, `src/app/(auth)/**` or `src/app/api/auth/**`. The layout imports `cachedAuth`, `signOutAction` (through `AvatarMenu`) and `readIsPlatformAdmin` (through `nav-data`) and edits none of them. **If any Phase 4 step needs to edit one of those paths, or add a `PROTECTION_RULES` entry, stop: the MFA-enrolled running-server gate applies and this is a Phase 3 deviation.**

## API Contract

No routes, no server actions, no new mutations. Everything is an RSC read.

Reader signatures (all `import "server-only"`, all on `getPlatformDb()`, all return `CardResult<T>`; each issues **one** statement):

```ts
// src/lib/admin-portal/dashboard/read-card.ts
export type CardResult<T> = ({ kind: "ok" } & T) | { kind: "error" };
export async function readCard<T extends object>(name: string, read: () => Promise<T>): Promise<CardResult<T>>;
// catches everything; logs "[admin-dashboard] <name> failed: <ErrorName/code>" (class only, never the message); returns {kind:"error"}.

// src/lib/admin-portal/dashboard/{tickets,feedback,email,giving,domains,sites,two-factor,accounts,organizations,recent-changes}.ts
readTicketsCard():       { newCount: number; unassignedOpen: number; oldestNewSeconds: number | null }
readFeedbackCard():      { newCount: number }
readEmailCard():         { failed: number; overdue: number }
readGivingCard():        { connections: number; waiting: number; deadLetters: number; restricted: number }
readDomainsCard():       { needAttention: number }
readSitesCard():         { live: number; provisioning: number; suspended: number }
readTwoFactorCard():     { notEnrolled: number }
readAccountsCard():      { locked: number }
readOrganizationsCard(): { total: number; byType: Record<OrgTypeKey, number>; byStatus: Record<PlatformStatusKey, number>; inactive: number; defaultPalette: number }
readRecentChangesCard(): { rows: Array<{ action: ChangeAction; subject: string | null; actorEmail: string | null; at: string }> }
```

Shared extractions (so a card and its destination can never disagree):

```ts
// src/lib/admin/two-factor-stranded.ts   (outside the scanned dir on purpose, R7)
export const STRANDED_WHERE: SQL;                                  // the one predicate, moved verbatim from 2fa/page.tsx
export async function countStranded(): Promise<number>;            // card 9
export async function listStranded(limit: number): Promise<{ rows: StrandedRow[]; total: number }>; // page; total = count(*) over ()
// src/lib/admin/giving-ingest-health.ts
export function summarizeIngestHealth(rows: IngestHealthRow[]): { connections; waiting; deadLetters; restricted };   // pure
export async function readIngestHealthSummary(): Promise<ReturnType<typeof summarizeIngestHealth>>;                  // one listIngestHealth() call
// src/lib/domains/platform-read.ts
export async function countDomainsNeedingAttention(): Promise<number>;  // same attentionCondition() that listDomainsAcrossOrgs("attention") now uses
```

Query definitions (the implementer writes them; these are the definitions each reader must honor):

| Reader | Statement | Definition |
|---|---|---|
| tickets | `select count(*) filter (where status='new'), count(*) filter (where status in ('new','triaged','in_progress') and assignee_user_id is null), extract(epoch from now() - min(created_at) filter (where status='new'))::int from tickets` | "New" and "open" use `TICKET_STATUSES`. Ages are computed in SQL (`::int` seconds) because the Neon driver returns computed dates as strings (`check:sql-date`). Returns numbers only: no subject, area, submitter or body is selected. |
| feedback | `select count(*)::int from feedback where status='new'` | Index `ix_feedback_status_created`. |
| email | `select count(*) filter (where status='failed'), count(*) filter (where status='queued' and coalesce(next_attempt_at, created_at) < now() - interval '30 minutes') from email_queue where status in ('failed','queued')` | The `where status in (...)` keeps it on `ix_email_queue_status_next`; without it the table of sent rows is scanned. `failed` is all-time, matching the count strip on `/admin/email-queue`. No address is selected. |
| giving | `readIngestHealthSummary()` → `listIngestHealth()` (one call of `presby_giving_ingest_health()`) | `waiting` = sum of `parkedCount`; `deadLetters` = sum of `deadLetterCount`; `restricted` = connections with `status = 'restricted'`; `connections` = row count. No amount, donor or event body exists in that function's output. |
| domains | `countDomainsNeedingAttention()` | The exact `attention` predicate of `listDomainsAcrossOrgs` (hold, lapsed/parked/release_pending, or last check class in the attention set), non-terminal states only. |
| sites | `listSitesForAdmin()` reduced to counts by `status` | Reuses the destination's own list, so the two cannot disagree. Only the three counts leave the reader. |
| two-factor | `countStranded()` | Active users with no `user_totp` row who are required by their own flag or by an active membership's organization. Count only; no email. |
| accounts | `select count(*)::int from users where locked_until > now()` | The lockout column set at `src/auth.ts:177` and cleared at `users/actions.ts:174`. |
| organizations | one `select count(*) filter (...)` over `organizations` | Counts by `organization_type` (5) and `platform_status` (3); `lifecycle_status <> 'active'`; "default palette" = no `organization_brands` row, the same definition as `org-tree.ts` `hasBrand`. |
| recent changes | one CTE: `with recent as (select action, actor_email, created_at, <subject expressions> from audit_events where <closed list> order by created_at desc limit 10) select recent.*, o.name from recent left join organizations o on o.id::text = recent.org_ref` | Closed action list below. **`metadata` is never selected whole**: only `metadata->>'organizationId'`, `metadata->>'selfAddressed'`, `metadata->>'inviterIsInvitee'`. The revoke reason can never reach a component. The join compares as text, so a non-uuid `resource_id` (a flag key) cannot raise a cast error. |

Closed action list for card 12 (every key verified against its writer in the live tree; `totp.reset` is defined in `AUDIT_ACTIONS` but nothing writes it, so it is excluded):

| `action` | Label | Subject | Extra filter |
|---|---|---|---|
| `org.founding_administrator.revoked` | Founding administrator removed | organization name (from `resource_id`, `designation-holders.ts` writer) | none |
| `org.treasurer.revoked` | Treasurer removed | organization name | none |
| `invitation.created` | Self-addressed invitation sent | organization name (from `metadata->>'organizationId'`, `issue.ts:600`) | `metadata->>'selfAddressed' = 'true'` |
| `invitation.accepted` | Self-addressed invitation accepted | organization name (`accept.ts:236`) | `metadata->>'inviterIsInvitee' = 'true'` |
| `user.role.assigned` / `user.role.removed` | Platform role assigned / removed | none | none |
| `feature_flag.toggled` | Feature flag changed | the flag key (`resource_id`; a platform setting already shown on `/admin/flags`) | none |
| `user.2fa_force_reset` | Two-factor reset for an account | none | none |
| `user.deactivated` / `user.reactivated` | Account deactivated / reactivated | none | none |

## Data Model

No schema changes required. No migration, no new index. Two honest notes for QA and the retrospective:

- `audit_events` has `ix_audit_action_time (action, created_at)` and `ix_audit_created`; no organization index (R3). Card 12 filters a closed action list and takes the newest 10. At current volume this is fine; **unverified at production volume**. Phase 5 runs `EXPLAIN` on the development branch; if it exceeds about 50 ms the follow-up is an index, recorded in `docs/TODO.md`, not a Phase 4 change.
- The owner `Pool` defaults to `max` 10. A full-operator dashboard issues at most 10 independent statements, one per card; with the layout reading on the other pool this fits, and a second concurrent operator queues rather than fails. R7a said "aim for about 8"; the count is 10 only for a holder of every key, and a support operator issues 2. Accepted, recorded in Edge Cases (E22).

## Component / Page Plan

### Nav registry and shell

`src/lib/admin-portal/nav.ts` replaces `tiles.ts`. Pure synchronous data, same constraints as DECISION-123 (no `hasFeature`, no session, no query). Items carry `requiredFeature: FeatureKey | null` (`null` = door only) and `exact?: boolean`.

| Group (heading) | Items (label → href, key) |
|---|---|
| (no heading) | Dashboard → `/admin` (door, `exact`) |
| Organizations | Organizations → `/admin/organizations` · Domains → `/admin/organizations/domains` · Sites → `/admin/sites` · Giving health → `/admin/giving` (all `ADMIN_ORGANIZATIONS`) |
| Support | Tickets → `/admin/tickets` · Feedback → `/admin/feedback` · Email queue → `/admin/email-queue` |
| Access and settings | Users & roles → `/admin/users` · 2FA policy → `/admin/2fa` · Feature flags → `/admin/flags` · Audit log → `/admin/audit` |
| Content | What's new → `/admin/whats-new` |
| Reference (footer) | Release notes → `/admin/docs` (`ADMIN_RELEASE_NOTES`) · Design system → `/admin/design-system` (door) |

"Users & roles" keeps its current label because `e2e/admin-login.spec.ts` asserts it. A group with no visible item is omitted. The dashboard zones reuse the group names (Organizations, Support, Access and settings) so nav and page read as one structure.

`src/app/(admin)/admin/visible-nav.ts` (new, replaces `visible-tiles.ts`): `visibleAdminNav(features: string[] | undefined): AdminNavGroup[]`, the one place the session's features and the registry meet.

**Active state** (`AdminNavLinks`, client leaf, `usePathname()`): an item matches when `pathname === href` or `pathname.startsWith(href + "/")` (segment boundary); an `exact` item matches only on equality. The single match with the **longest href** wins and gets `aria-current="page"` plus the active style. So `/admin/organizations/domains` lights Domains and not Organizations; `/admin/organizations/<id>` and `/new` light Organizations; an unknown `/admin/whatever` lights nothing (Dashboard is `exact`). The leaf receives plain `{label, href, exact, group}` data and no functions or icon objects across the server/client boundary (the portal-nav precedent: a Lucide component object crossing it is a live 500).

**Components (new, `src/components/admin-portal/`):**

- `admin-nav.tsx` (server): `<nav aria-label="Platform admin">` containing the groups and the version line (`Version {APP_VERSION}`), rendered `hidden md:block` for the sidebar.
- `admin-nav-links.tsx` (client leaf): the link list and active state; takes an optional `onNavigate` so the phone menu can close on a same-page click. Targets are at least 44px (`min-h-11`) with `focus-visible:ring-2 ring-ring ring-offset-2 ring-offset-background`. `check:brand-scope` rule C2 bans a button-shaped class string outside `components/ui/` (`rounded-*` + `px-<n>` + `font-medium|semibold`); keep the link classes out of that shape or annotate with `// ui-ok: nav link, not a button` exactly as `global-nav.tsx` does.
- `admin-mobile-menu.tsx` (client): below `md`, a visible **"Menu"** button (icon plus text, `min-h-11`) opening a `Sheet` (`side="left"`) with a `SheetTitle` "Platform admin" and an sr-only `SheetDescription`. The open state lives in an inner component **keyed by `pathname`**, so a route change remounts it closed with no effect (the `portal-nav-links.tsx` precedent), plus `onNavigate` for a click on the current page's own link. Radix returns focus to the trigger on close.
- `admin-header.tsx` (server): skip link, `← PresbyPortal` (`/home`, unchanged), the "Platform admin" label (from `sm`), the Menu button (below `md`), and `<nav aria-label="Account">` holding `AvatarMenu`.
- `admin-forbidden.tsx` (server): admin-only forbidden state (see Copy).
- `src/components/ui/sheet.tsx`: generated with `npm run ui:add -- sheet` (never raw `shadcn add`). Phase 2 expects it to use the installed `@radix-ui/react-dialog` and report no unvetted package; **if `ui:add` reports a new package, stop and return to Phase 2 for an addendum.** Divergences to record in a header comment (Component Rule 5): ring offset on focus, and a 44px hit area on the close button (the generated one is a 16px icon).

**Components (new, `src/components/shared/`):**

- `load-error.tsx`: `LoadError({ title, body, retryHref?, onRetry?, headingLevel? })`. Exactly one of `retryHref` (a `Link`, server-friendly) or `onRetry` (a `Button`, for `error.tsx`). 44px, dashed border, calm register. **`OrganizationsUnavailable` is not migrated** (its strings are pinned by three pages; R2).
- `empty-state.tsx`: `EmptyState({ title, body, action? })`, the `ui-standards` dashed-border block, distinguishing "none yet" from "no matches" by the caller's strings. **Not adopted by `CommunityEmptyState` in this pipeline.**
- `count-card.tsx`: `CountCard({ title, icon, href, state })` and `CountCardSkeleton({ title })`. `state` is `{ kind: "ok"; tone: "attention" | "clear" | "neutral"; headline; lines; href? } | { kind: "error"; retryHref }`. Composes the `DestinationCard` affordance: the whole card is the link, title as `<h3>`, a chevron, focus ring on the link with an offset. No gating, no reads. Status uses existing tokens only, always icon plus text (R4): attention is `border-foreground` with `TriangleAlert` and the visible words "Needs attention"; clear is `text-muted-foreground` with `CircleCheck`; error is `border-dashed` with `CircleAlert` in `text-destructive`; neutral has no status row. In the error state the card is **not** a link (no nested links): the title, the message and a 44px "Try again" link to `/admin`. The skeleton uses `animate-pulse bg-muted` and an sr-only "Loading {title}".

### Layout and error boundary

`src/app/(admin)/admin/layout.tsx` (rewrite). Order and bodies of the two redirects are **unchanged**:

```
session = await cachedAuth()
if (!session?.user) redirect("/signin?callbackUrl=/admin")
if (session.user.twoFactorRequired && !session.user.twoFactorVerified) redirect("/totp?callbackUrl=/admin")
isPlatformAdmin = await cachedIsPlatformAdmin(session.user.id).catch(() => false)   // R1d: a blip degrades to "no Developer item", never a crash
groups = visibleAdminNav(session.user.features)
<AdminHeader .../> + grid[md:220px 1fr]: <AdminNav groups/> <main id="admin-main" tabIndex={-1} className="min-w-0 p-4 sm:p-8">{children}</main>
```

`min-w-0` on `<main>` matters: a grid item defaults to `min-width:auto`, so one wide table would widen the whole column and push the page sideways at 360px. The inline `signOut` server action is deleted; the avatar menu's `signOutAction` (lands on `/`) is the single sign-out path. If the sidebar is made sticky, it must scroll internally (`overflow-y-auto`) so a short laptop viewport cannot hide the Reference group.

`src/app/(admin)/admin/error.tsx` (new, `"use client"`): `LoadError` with `onRetry={reset}` plus a "Back to the dashboard" link. It never renders `error.message` (in production Next replaces it with a digest anyway, and a dev message can carry values) and logs nothing itself. It does not intercept `notFound()`.

**There is no `loading.tsx` at `(admin)/admin` or below** (R1c, F274). Loading feedback is the per-card `Suspense` only.

### Dashboard

`src/app/(admin)/admin/page.tsx` (rewrite), still `auth()` and `GreetingBand` with `data-testid="greeting-band"` (six e2e specs key on it; `GreetingBand` itself is not edited, so the org portal is untouched).

```
GreetingBand (motionEnabled={false})
[holder of ADMIN_ORGANIZATIONS]  action bar: "Find an organization" GET form → /admin/organizations?q=   |  "New organization" button
"Updated {FormattedDate}" (page render time)
zone "Organizations"            : Organizations at a glance · Giving notices · Domains · Sites
zone "Support"                  : Tickets · Feedback · Email queue
zone "Access and settings"      : Two-factor · Locked accounts
zone "Recent operator changes"  : one wide list card
no visible card and no org key  → EmptyState (the existing door-only strings, byte-identical)
```

- Zones are static (card order is fixed, never data-dependent), so each card streams independently. Within a zone the grid is `grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3`. A zone with no visible card is omitted, so a support operator sees only "Support".
- A card is mounted **only if** `hasFeature(features, card.requiredFeature)`; each is `<Suspense fallback={<CountCardSkeleton/>}><XCard/></Suspense>`.
- `_dashboard/registry.ts`: pure data (id, zone, requiredFeature, order). `_dashboard/present.ts`: pure presenters `result → CountCardState` (all the copy, unit-tested). `_dashboard/cards.tsx`: ten thin async wrappers `async function TicketsCard(){ return <CountCard … {...presentTickets(await readTicketsCard())} /> }`. `_dashboard/recent-changes-card.tsx`: the list card (a `Card` with a `<ul>` and a "View the audit log" link, 44px; rows are plain text, so there is no nested link). `_dashboard/find-organization.tsx`: the search form (a plain GET form, no `useForm`, so no `HydrationGate` is required and `check:hydration-gate` has nothing to flag; a pre-hydration submit still works natively).
- **Why `cards.tsx` is one file:** RTL cannot render an async server component inside `Suspense`. The page test mocks `./_dashboard/cards` with synchronous stubs, which also lets it assert that a non-holder's card component is never called (E4). The async wrappers are tested by calling them directly (`await TicketsCard()` then `render`), the way `page.test.tsx` already calls `AdminDashboard()`.
- The "New organization" button and the find box show for `ADMIN_ORGANIZATIONS` holders only. Zero organizations: the Organizations-at-a-glance card becomes "No organizations yet. Create the first one." and links to `/admin/organizations/new` (G5).

### Files

Create:

- `src/lib/admin-portal/nav.ts`, `nav.test.ts`
- `src/lib/admin-portal/dashboard/{read-card,tickets,feedback,email,giving,domains,sites,two-factor,accounts,organizations,recent-changes}.ts` and `*.test.ts` for each; `boundaries.test.ts`; `recent-changes.db.test.ts`
- `src/lib/admin/two-factor-stranded.ts`, `two-factor-stranded.db.test.ts`
- `src/components/ui/sheet.tsx`
- `src/components/shared/{load-error,empty-state,count-card}.tsx` and tests
- `src/components/admin-portal/{admin-nav,admin-nav-links,admin-mobile-menu,admin-header,admin-forbidden}.tsx` and tests
- `src/app/(admin)/admin/{visible-nav.ts,visible-nav.test.ts,error.tsx,error.test.tsx,shell-boundaries.test.ts}`
- `src/app/(admin)/admin/_dashboard/{registry.ts,present.ts,cards.tsx,recent-changes-card.tsx,find-organization.tsx}` and tests
- `src/app/(admin)/admin/docs/page.test.tsx`
- `e2e/admin-shell.spec.ts`

Modify:

- `src/app/(admin)/admin/layout.tsx` (rewrite), `layout.test.tsx` (rewrite), `page.tsx` (rewrite), `page.test.tsx` (re-pin)
- `src/app/(admin)/admin/2fa/page.tsx` (use `listStranded`; the `orgs` query and `member_count` stay inline and page-local; add the truncation note)
- `src/lib/admin/giving-ingest-health.ts` (add the summary), `src/lib/domains/platform-read.ts` (extract `attentionCondition`, add the count)
- `src/app/(admin)/admin/docs/page.tsx` (page gate), `design-system/page.tsx` (comment only: door-level by design)
- `src/lib/permissions.ts` (`name` and `description` strings of the `ADMIN_ORGANIZATIONS` entry only; leave a code comment that deployed `features` rows keep the old text because `scripts/seed.ts` uses `onConflictDoNothing`, and that nothing displays those columns)
- `src/app/(admin)/admin/organizations/page.tsx` (forbidden block and description), `organizations/new/page.tsx` (forbidden block), `organizations/[id]/page.tsx` (forbidden block only; Increment 2 rewrites the rest)
- `src/app/(member)/home/page.tsx` (the Admin card's description only; the title stays "Admin" because `e2e/member-home.spec.ts:152` pins it)
- `docs/ui-standards.md` (see Neighbours), `e2e/admin-login.spec.ts` (a stale comment)

Delete: `src/lib/admin-portal/tiles.ts`, `tiles.test.ts`; `src/app/(admin)/admin/visible-tiles.ts`, `visible-tiles.test.ts`, `tile-icons.ts`.

Keep (still used by `(org)`): `DomainTileSections`, `TileGrid`. **Feasibility, checked:** `domain-tile-sections.test.tsx` and `tile-grid.test.tsx` already use local fixtures and import nothing from `@/lib/admin-portal/tiles`, so the deletion breaks neither.

## Implementation Order

**Step 0 (all batches).** In the worktree: `npm ci`; create `.env.local` pointing at this pipeline's own Neon branch (Rule 16; never `development` or `production`); `npm run db:seed` so the e2e roles exist; dev server on port **3530**, with `E2E_BASE_URL=http://localhost:3530` for every Playwright run. Stop servers by PID, never `pkill -f next`. No schema is applied.

Batches A and B touch disjoint files and may run in parallel; Batch C needs both.

| Batch | Implementer | Content | Commit(s) |
|---|---|---|---|
| **B. Readers** | api-developer | (1) extract `two-factor-stranded.ts`, switch `2fa/page.tsx` to it, add the truncation note; extract `attentionCondition()` and add `countDomainsNeedingAttention()`; add the giving summary. Behavior-preserving, with the DB parity tests. (2) the ten readers, `read-card.ts`, the unit tests, `recent-changes.db.test.ts`, and `boundaries.test.ts`. | `refactor(admin): share the two-factor and domains attention predicates with the dashboard`; `feat(admin): platform dashboard readers held to platform-axis tables` |
| **A. Shell** | ux-developer | `ui:add sheet`; `shared/` `LoadError`, `EmptyState`, `CountCard`; `admin-portal/` nav, mobile menu, header, forbidden; `nav.ts` and `visible-nav.ts`; the layout rewrite; `error.tsx`; `p-4 sm:p-8` **and** the `ui-standards` edits in the same commit (R6); `shell-boundaries.test.ts`; the R9 layout redirect tests. | `feat(admin): grouped permission-filtered nav, header with the avatar menu, and an error boundary` |
| **C. Dashboard** | ux-developer | `_dashboard/` (registry, presenters, cards, recent-changes card, find box), the page, the page test re-pin, retire the tile grid (delete the files listed), `e2e/admin-shell.spec.ts`, the `admin-login.spec.ts` comment, browser verification at 360px. | `feat(admin): the platform dashboard replaces the tile grid`; `test(e2e): admin shell and dashboard at 360px` |
| **Fixes** | ux-developer | `/admin/docs` page gate with its failing-first test; the stale-copy corrections (permissions.ts, org list description and three forbidden blocks, `/home` card description). Two commits so each `fix:` carries its own trailers. | `fix(admin): gate /admin/docs at the page as well as the proxy` (`Caught-By: agent-review`, `Discovered-In: Phase-2`); `fix(admin): correct the stale organization copy and the ADMIN_ORGANIZATIONS catalog text` (`Caught-By: agent-review`, `Discovered-In: Phase-1`) |

Every commit carries `Work-Log: 2026-10-25-platform-admin-redesign-inc1`. Phase 4 gate: `npm run typecheck`, `npm run lint`, `npm run check` (all eight tripwires, zero violations), `npm run build`, `npm test` (the DB-backed subset serially per `docs/testing.md`), the e2e set below on :3530, and a phone-viewport browser pass. No `console.log`; no native dialogs; no secrets.

After Phase 6 SHIP IT (tech-lead): release notes for the next minor (the `/release-notes` skill, neutral wording, no security disclosure); `docs/product/functionality-map.md` line 36 rewritten (Rule 14); `CLAUDE.md` Project Layout gains `src/components/admin-portal/` and `src/lib/admin-portal/` (DECISION-253); `docs/architecture.md` not touched (Rule 15: no new subsystem). The orchestrator writes DECISION-251/252/253/255 and the F-numbers at integration and reconciles `docs/TODO.md` (close 416 and 417; add the follow-ups in the Carry-forward table). Rule 13 what's-new advisory: not required (internal admin tooling).

## Edge Cases & Risks

Each claim cites the test that pins it, or says "unverified". Test files are named by their planned path.

| # | Claim | Pinned by |
|---|---|---|
| E1 | A support operator (door + tickets + feedback) sees exactly two cards, both under "Support", and the nav Dashboard, Tickets, Feedback and Design system; no find box, no "New organization". | `page.test.tsx` (re-pins the 2-tile acceptance case); `visible-nav.test.ts` |
| E2 | A door-only viewer sees the honest empty state (existing strings) and no zones, find box or cards; the nav shows Dashboard and Design system only. Design system stays visible to them because it has no key (F281). | `page.test.tsx`; `visible-nav.test.ts` |
| E3 | A full operator sees four Organizations cards, three Support cards, two Access cards and the recent-changes card. | `page.test.tsx` (stubbed cards) |
| E4 | A card's reader never runs for a non-holder: the page mounts a card only if the viewer holds its key. | `page.test.tsx` (stub component spies are not called) |
| E5 | One card's failed read renders its own error state and never a zero or an all-clear; siblings are unaffected. | `present.test.ts` (error → error state, and "Nothing waiting." / "0" absent); each reader's test with a rejecting `execute` returns `{kind:"error"}` |
| E6 | A failed read logs the error class only, never the message. | `read-card.test.ts` (throws `new Error("secret sql")`; the console output contains the class and not the text) |
| E7 | Zero and failure are different states with different icons and words. | `count-card.test.tsx` |
| E8 | Active nav state: longest-href match wins; segment boundary respected (`/admin/organizationsX` does not light Organizations); Dashboard is exact; unknown paths light nothing. | `admin-nav-links.test.tsx` |
| E9 | The phone menu closes on a route change and on a click on the current page's own link; the Sheet has a title; the trigger is at least 44px. | `admin-mobile-menu.test.tsx` (re-render with a new mocked pathname; click) |
| E10 | The layout's two redirects are unchanged: no session → `/signin?callbackUrl=/admin`; required and unverified → `/totp?callbackUrl=/admin`; otherwise no redirect (R9). | `layout.test.tsx` (the mocked `redirect` throws a sentinel so the test stops where the app would) |
| E11 | A failing live `isPlatformAdmin` read degrades the avatar menu (no Developer item) and does not crash the shell (R1d). | `layout.test.tsx` |
| E12 | Landmarks: `nav[aria-label="Platform admin"]`, `nav[aria-label="Account"]`, a skip link whose target is `<main id="admin-main">`, one `<h1>` per page. The "← PresbyPortal" link still goes to `/home`. Sign-out exists once (in the avatar menu). | `layout.test.tsx` (keeps the existing `/home` regression) |
| E13 | No `loading.tsx` exists under `src/app/(admin)/admin/**`; no `/o/` href literal under `(admin)/admin/**` or `components/admin-portal/**`; no `BrandTokens` or `getPlatformDb` in `components/admin-portal/**`; `error.tsx` does not reference `error.message`. | `shell-boundaries.test.ts` |
| E14 | A thrown error under the console renders the calm state with a working "Try again" and never the error text. | `error.test.tsx` |
| E15 | A query that finds no row still returns HTTP 404 under the console (no `loading.tsx` to turn it into 200). | `e2e/admin-shell.spec.ts` (`/admin/organizations/<uuid that does not exist>` → status 404) |
| E16 | `/admin/docs` for a viewer without `ADMIN_RELEASE_NOTES` renders `AdminForbidden` and reads no release file; a holder sees the notes. | `docs/page.test.tsx` (failing first; `node:fs` mocked) |
| E17 | The recent-changes card never carries a revoke reason, other metadata, or an address other than the actor's. | `recent-changes.db.test.ts` (seeds a revoke row whose metadata reason is a marker string; the reader's result serialised contains no marker) and `boundaries.test.ts` (the source names `metadata` only as `metadata->>'…'` paths) |
| E18 | Tickets and feedback readers return numbers only. | `tickets.test.ts`, `feedback.test.ts` (result keys are exactly the contract) |
| E19 | Only platform-axis tables, one `presby_*` function and a short list of modules are reachable from the dashboard readers; a new tenant table is forbidden by default. | `boundaries.test.ts` (allow-list; see below) |
| E20 | The 2FA exception stays one module: under `src/app/(admin)/`, `src/lib/admin/` and `src/lib/admin-portal/`, the identifier `member_count` appears only in `2fa/page.tsx` (`lib/groups.ts` has an unrelated group-member `member_count` and is out of the scanned set); `two-factor-stranded.ts` returns accounts or a count and exports no member count. | `boundaries.test.ts` (source scan of those three trees, non-test files) |
| E21 | A card and its destination agree: `countStranded()` equals `listStranded(large).total`; `countDomainsNeedingAttention()` equals `listDomainsAcrossOrgs("attention", large).rows.length`; the sites counts equal the destination list reduced. | `two-factor-stranded.db.test.ts`, `platform-read` parity test, `sites.test.ts` |
| E22 | Each reader issues one statement; the page issues at most 10 (a holder of every key). | each reader's unit test counts calls to a faked `getPlatformDb().execute` |
| E23 | Pluralisation: "1 new ticket" / "2 new tickets", "1 domain needs attention" / "3 domains need attention". | `present.test.ts` |
| E24 | `permissions.ts` changed copy only: key strings, `FEATURES` map, array order and categories are identical. | `permissions.test.ts` (extended with a key/order/category snapshot) |
| E25 | At 360px: no horizontal overflow on `/admin` and `/admin/organizations`; the Menu button opens the nav, a link navigates and closes it, and Escape returns focus to the Menu button. | `e2e/admin-shell.spec.ts` |
| E26 | Admin's regression set still passes on :3530 with the new shell: `admin-login`, `totp-full-login`, `role-boundaries`, `session-claim-integrity`, `totp-callback-bypass`, `admin-audit`, `admin-email-queue`, `admin-organizations`, `whats-new`, `member-home`. | QA runs them (R9) |
| E27 | `EXPLAIN` of the recent-changes statement on development is acceptable at current volume. | **Unverified** until Phase 5 |
| E28 | A very long organization name or flag key wraps inside the recent-changes row instead of widening the card (`min-w-0 break-words`). | **Unverified** in a browser (the e2e fixtures have short names); Phase 5 checks it at 360px with one long name |
| E29 | The Menu button is inert before hydration. | **Unverified and accepted**: a nav toggle is not a data-writing form (DECISION-159 is about forms); the desktop nav is plain links and works without JavaScript |
| E30 | The release-notes page content (rendered markdown) fits 328px of content width. | **Unverified**; Phase 5 looks. If a markdown table overflows, it is a pre-existing `docs/page.tsx` issue, recorded for Increment 4, not fixed here |

**Boundaries test (`src/lib/admin-portal/dashboard/boundaries.test.ts`, modelled on `onboarding/boundaries.test.ts`).** It strips comments, then for every non-test file in the directory asserts: (1) imports from `@/lib/db/domain/*` and `@/lib/db/schema` name only these tables: `organizations`, `organizationBrands`, `organizationSettings` (the `require_two_factor` column only), `accountInvitations`, `auditEvents`, `emailQueue`, `tickets`, `feedback`, `users`, `organizationDomains`, the sites table, `featureFlags`, `organizationFeatureToggles`, `organizationFeatureCategories` (the Increment 2 cards share this directory, so the list is the Phase 2 list, not Increment 1's subset); (2) every `from`/`join` identifier in raw `sql` text is in the same list (snake_case spellings); (3) the only `presby_*` function named is `presby_founding_administrator_holder_count` (unused in Increment 1; permitted for Increment 2); (4) the only `@/lib/*` modules imported are `admin/giving-ingest-health`, `admin/two-factor-stranded`, `domains/platform-read`, `sites`, `onboarding/status`, `flags`, `db`, `permissions`, `admin/format-age`; (5) `metadata` appears only as `metadata->>`. Its header names the single recorded exception (the 2FA predicate, which lives outside the directory on purpose).

### e2e blast radius (existing specs whose assertions this change touches)

| Spec | What it asserts | Effect of this increment | Action |
|---|---|---|---|
| `e2e/admin-login.spec.ts` (test 1) | `/admin` shows links named `/users & roles/i`, `/feature flags/i`, `/release notes/i`, `/2fa policy/i` (`.first()`); `greeting-band` contains the admin's name | Satisfied by the sidebar at the desktop viewport; labels kept on purpose. The comment "appears twice … sidebar nav and … a card" becomes false (no tiles). | Edit the comment only |
| `e2e/admin-login.spec.ts` (subpage walk) | `/admin/docs` heading `/release notes/i`, `/admin/2fa` heading, etc. | Unchanged; `/admin/docs` now passes the new page gate for `admin` | none |
| `e2e/admin-audit.spec.ts:47`, `admin-email-queue.spec.ts:46`, `whats-new.spec.ts:118`, `admin-organizations.spec.ts:95` | nav links by name, `.first()` | Satisfied; labels "Audit log", "Email queue", "What's new", "Organizations" kept | none |
| `role-boundaries`, `session-claim-integrity`, `totp-callback-bypass`, `totp-full-login`, `member-home` | `greeting-band` and the `/admin` redirect chains | `greeting-band` kept; the layout's redirects unchanged | Run as the R9 regression set |
| `e2e/member-home.spec.ts:152` | the `/home` Admin card link is named "Admin" | Title kept; only the description changes | none |
| `e2e/header-controls.spec.ts` | avatar menu items on non-admin pages | The admin pages now also mount `AvatarMenu`; none of its assertions run on `/admin/**` | none; QA greps for `Sign out (` (none today) |
| `e2e/custom-domains/*`, `designation-revoke`, `giving-admin` | drive `/admin/organizations/[id]`, `/admin/organizations/domains`, `/admin/giving` | Only the shell around them changes (padding, nav). Selectors inside the page are untouched. | Run `giving-admin` and `custom-domains/domains-platform` as a smoke |

New spec **`e2e/admin-shell.spec.ts`** (storage state `admin`, no flags): nav groups and `aria-current` on `/admin`, `/admin/organizations` and `/admin/organizations/domains`; the dashboard renders the four zone headings and no card says "We can't load this right now" against the development data; no `a[href^="/o/"]` on `/admin`; avatar menu → "Sign out" lands on `/` with a "Sign in" link; 404 status for a non-existent organization id; and at 360×740 the Menu flow plus the no-horizontal-overflow check. There is no support-operator e2e fixture (adding one touches `e2e/support/users.ts`, a Rule 16 shared file); that subset is pinned at unit level (E1, E2). Recorded as a deliberate gap.

### Risks

- **The shell rewrite is on every admin page.** Mitigated by keeping the two redirects byte-identical and pinning them (E10), and by running the MFA-enrolled login e2e (E26).
- **Tripwire interplay.** `check:brand-scope` C2 (button-shaped class strings), E1/E3 (`<BrandTokens`, `<style`); `check:hydration-gate` (no `useForm` in new code); `check:sql-date` (counts and `::int` seconds only); `check:giving-boundaries` B6 (the new summary lives in the one allowed file and only calls `listIngestHealth`); `check:proxy-imports` (the proxy is not touched); `check:audit` (no `actions.ts` changes). The implementer runs `npm run check` before reporting.
- **Dashboard honesty depends on definitions.** Where a card's definition is narrower than its destination's list (email overdue, tickets unassigned), the copy says exactly what the number is (Copy, group D).

## 360px checks (Phase 4 and Phase 5, in a browser, not only by build)

1. Shell: the header fits one row (wordmark link, Menu button, avatar 44px each); "Platform admin" label hidden below `sm`; content width 328px; no horizontal scroll.
2. Menu: Sheet opens from the left at no more than 85vw; every link at least 44px; scrolls if the list is taller than the screen; closes on navigation; Escape returns focus to Menu.
3. Dashboard: cards single column; the find form stacks (input full width above the button); "New organization" full width; the organizations-at-a-glance sub-lines wrap, one per line; the recent-changes rows put the time on its own line and wrap the subject and actor email.
4. `error.tsx` and `AdminForbidden`: buttons stack full width at 44px.
5. `/admin/organizations` (existing page, new padding): no overflow introduced.

## Copy

All user-facing strings Increment 1 adds or changes. Wording follows G20: **"Platform admin"** names the console; **"a platform administrator"** names the person who can grant access (the existing door-only string keeps it). No "tenant", no "presby" in product text. A string added after this table, including inside a bug-fix, gets the same four checks first; an implementer who needs a string that is not here stops for a ruling.

### Group A — Shell chrome

| Where | String |
|---|---|
| Skip link | "Skip to main content" |
| Header | "← PresbyPortal" (unchanged, links to `/home`); "Platform admin" (label) |
| Phone menu | Button text "Menu"; Sheet title "Platform admin"; sr-only description "Platform admin pages"; close control sr-only "Close" |
| Nav landmark | aria-label "Platform admin" |
| Group headings | "Organizations", "Support", "Access and settings", "Content", "Reference" |
| Items | "Dashboard", "Organizations", "Domains", "Sites", "Giving health", "Tickets", "Feedback", "Email queue", "Users & roles", "2FA policy", "Feature flags", "Audit log", "What's new", "Release notes", "Design system" |
| Footer | "Version {APP_VERSION}" |
| Avatar menu | existing items, unchanged ("Account", "Platform admin", "Developer", "Sign out") |

- **Residuals:** makes no claim about any accepted residual or Phase 2 ruling.
- **Source of truth:** which items appear is `hasFeature(session.user.features, key)`. The `features` claim is the same one every destination re-checks, so the nav can lag a revoked role only as long as the destinations do. "Version" is the build-time `package.json` version of this deployment.
- **Audience:** every holder of the door key. "Design system" is visible to all of them, including a door-only viewer, because the page has no key (F281); it is a reference page, not an "admin tool", so it does not contradict the door-only empty state.
- **Neighbours:** `layout.tsx` labels "Audit Log", "Giving health", "Release notes" and "Sign out ({email})" (removed or recased); `tiles.ts` labels and descriptions (deleted with the registry); `e2e/admin-login.spec.ts` and `admin-audit.spec.ts` match "audit log" case-insensitively (still pass).

### Group B — Dashboard frame

| Where | String |
|---|---|
| Find box | label "Find an organization"; placeholder "Part of a name"; button "Search" |
| Action | "New organization" |
| Zone headings | "Organizations", "Support", "Access and settings", "Recent operator changes" |
| Timestamp | "Updated {date and time}" |
| Door-only empty state | "You don't have access to any admin tools yet." / "Contact a platform administrator to request the features you need." (byte-identical to today, now in `EmptyState`) |

- **Residuals:** none touched.
- **Source of truth:** "Updated" is the server render time of this request, not a database timestamp; cards stream in after it, within the same request. It claims nothing about when any row changed.
- **Audience:** the find box and "New organization" render only for `ADMIN_ORGANIZATIONS` holders, who are the viewers `/admin/organizations` and `/new` admit. The door-only text goes to a viewer with no key; "contact a platform administrator" is actionable because an `admin` role holder can assign roles at `/admin/users`.
- **Neighbours:** `page.tsx:71-75` (kept verbatim); `page.test.tsx` regexes `/don.t have access to any admin tools/` and `/contact a platform administrator/` (still match); the `/organizations` list page's own "Part of a name" placeholder (same wording).

### Group C — Card states (every card)

| State | String |
|---|---|
| Needs attention | status label "Needs attention" |
| Clear | "Nothing waiting." |
| Load failed | "We can't load this right now." and a link "Try again" (to `/admin`) |
| Skeleton | sr-only "Loading {card title}" |

- **Residuals:** none.
- **Source of truth:** "Nothing waiting." is shown only for a successful read whose counts are all zero; a failed read can never reach it (E5).
- **Audience:** the viewer holds the card's key; "Try again" reloads `/admin`, which every card viewer can do.
- **Neighbours:** `giving/page.tsx:60-62` has its own failure copy ("We can't load giving health right now / Nothing has changed. Reload the page in a moment."): the same condition in different words, left to Increment 4. `organizations/page.tsx:134` likewise ("We couldn't load the organization list.").

### Group D — Card text (title; headline; lines)

| Card | Attention | Clear | Link |
|---|---|---|---|
| **Organizations at a glance** (neutral, no attention state) | headline "{n} organization(s)"; lines, each shown only when non-zero: "{c} congregations, {p} presbyteries, …" by type; "{m} managed, {i} invited, {u} unmanaged"; "{x} no longer active"; "{b} still on the default palette". Zero organizations: headline "No organizations yet." and line "Create the first one." | n/a | `/admin/organizations` (zero: `/admin/organizations/new`) |
| **Giving notices** | headline = first of "{d} dead letter(s)", "{w} notice(s) waiting", "{r} connection(s) restricted"; the other non-zero ones as lines | "Nothing waiting." and, when any, "{n} connection(s)" | `/admin/giving` |
| **Domains** | "{n} domain(s) need(s) attention" | "Nothing waiting." | `/admin/organizations/domains?filter=attention` when n>0, else `/admin/organizations/domains` |
| **Sites** | headline "{s} suspended" or "{p} provisioning"; line "{p} provisioning" when suspended leads; "{l} live" | "Nothing waiting." and "{l} live" when any | `/admin/sites` |
| **Tickets** | headline "{n} new ticket(s)" with lines "Oldest new ticket has waited {age}" and "{u} open and not assigned"; if no new ticket but some unassigned: headline "{u} open ticket(s) not assigned" | "Nothing waiting." | `/admin/tickets?status=new` when n>0, else `/admin/tickets` |
| **Feedback** | headline "{n} new" | "Nothing waiting." | `/admin/feedback` |
| **Email queue** | headline "{f} failed" with line "{o} waiting to send for over 30 minutes"; if none failed but some overdue: headline "{o} waiting over 30 minutes" | "Nothing waiting." | `?status=failed` when f>0, else `?status=queued` when o>0, else `/admin/email-queue` |
| **Two-factor** | headline "{n} account(s) not enrolled" with line "Required to use two-factor, but not enrolled." | "Nothing waiting." | `/admin/2fa` |
| **Locked accounts** | headline "{n} locked" with line "Locked after too many failed sign-ins." | "Nothing waiting." | `/admin/users` |

Card titles: "Organizations at a glance", "Giving notices", "Domains", "Sites", "Tickets", "Feedback", "Email queue", "Two-factor", "Locked accounts".

- **Residuals:** the two-factor card shows a count only, never an address, and says nothing about members; it does not deny or extend the recorded `member_count`/people-and-memberships exception (Q8, F276). No card text claims to be "all accounts" or "all members".
- **Source of truth** (each claim to its query): *new ticket* = `tickets.status = 'new'`; *open* = `new`/`triaged`/`in_progress`; *not assigned* = `assignee_user_id is null`; *waited {age}* = `now() - min(created_at)` over new tickets via `formatAge`. *failed* = `email_queue.status = 'failed'`, all time, as on the page's count strip; *waiting to send for over 30 minutes* = `status = 'queued'` and `coalesce(next_attempt_at, created_at)` more than 30 minutes ago, **which the destination's "queued" filter does not isolate** (it lists every queued row, including ones not yet due), so the line states the threshold rather than a bare "queued". *dead letter* / *notice waiting* = `deadLetterCount` / `parkedCount` of `presby_giving_ingest_health()`; *restricted* = connection `status = 'restricted'` (an operator cannot tell from the card who restricted it, so the word is bare). *domain needs attention* = the shared `attentionCondition()` (counts hostnames, not organizations; the headline says "domain(s)"). *provisioning / suspended / live* = `organization_sites.status`. *not enrolled* = `STRANDED_WHERE` (active, no TOTP row, required by the account's own flag or by an active membership's organization policy); the line says "Required … but not enrolled", exactly the page's own heading, and **does not** say which of the two reasons, because the card does not read it. *Locked* = `users.locked_until > now()`; "after too many failed sign-ins" is true because the only writer of `locked_until` is the failed-login lockout in `src/auth.ts:177`. *default palette* = no `organization_brands` row, the page's own definition; it counts every organization, managed or not, to agree with the filtered list, so the card does not say "congregations". *no longer active* = `lifecycle_status <> 'active'`.
- **Audience:** each card shows only to a holder of the key whose page it links to, and the link target admits that key (`ADMIN_ORGANIZATIONS` → organizations, giving, domains, sites; `ADMIN_TICKETS`; `ADMIN_FEEDBACK`; `ADMIN_EMAIL_QUEUE`; `ADMIN_TWO_FACTOR`; `ADMIN_USERS`). No card tells a viewer to do something their role cannot: the lines are descriptions, and the only instruction is the implicit one to open the destination, which they can.
- **Neighbours:** the destinations' own strings that name the same things: `/admin/2fa` heading "Required, but not enrolled" (consistent); `/admin/giving` "Notices waiting", "Dead letters", "Connections" (consistent); `/admin/email-queue` status labels (queued/failed, consistent); `organizations/page.tsx` "Still on default palette ({n})" (consistent). Stale because of this increment: the dashboard tile descriptions in `tiles.ts` (deleted).

### Group E — Recent operator changes

| Where | String |
|---|---|
| Title | "Recent operator changes" |
| Subtitle | "Access, flag and account changes worth a second look." |
| Row | "{label} · {subject} · {actor email, or System} · {date and time}"; the subject is omitted when there is none |
| Labels | "Founding administrator removed", "Treasurer removed", "Self-addressed invitation sent", "Self-addressed invitation accepted", "Platform role assigned", "Platform role removed", "Feature flag changed", "Two-factor reset for an account", "Account deactivated", "Account reactivated" |
| Empty | "No recent changes of this kind." |
| Link | "View the audit log" |
| Unknown organization | "Unknown organization" |

- **Residuals:** DECISION-194's accepted residual (revoke, then self-addressed invitation, then accept) is *detected by audit and not prevented*. The card says "worth a second look" and nothing like "protected", "blocked" or "verified". DECISION-183 permits a self-addressed designation; the labels state the fact ("Self-addressed invitation sent") and do not call it wrong. Phase 2: audit-derived rows show action, organization, actor and time only.
- **Source of truth:** every label is one `audit_events.action` (and, for the two invitation labels, the `selfAddressed` / `inviterIsInvitee` metadata flag) from the verified writers listed in the API Contract. "Founding administrator removed" is written only when the revoke function's outcome is `revoked`, so the label is true. "Platform role" is `user_roles`, the platform roles table, not a tenant grant. "Empty" means no row of this closed list exists, not that nothing happened, hence "of this kind". The actor is `actor_email`; the same `ADMIN_AUDIT` holder already reads it on `/admin/audit`.
- **Audience:** `ADMIN_AUDIT` holders only; "View the audit log" goes to `/admin/audit`, which admits exactly them.
- **Neighbours:** `/admin/audit` heading "Audit log" and its action filter use raw action keys, not these labels (left alone); `audit.ts` comments describe the same events.

### Group F — Error boundary

| Where | String |
|---|---|
| Title | "We couldn't load this page" |
| Body | "Something went wrong on our end. Try again in a moment." |
| Buttons | "Try again", "Back to the dashboard" |

- **Residuals:** none.
- **Source of truth:** claims only that a render failed. It deliberately does not say "nothing has changed": a boundary can also catch a failed action, so that would be unverifiable (contrast `giving/page.tsx`, which can say it because it is a read-only page).
- **Audience:** any viewer inside the console; both actions are available to them.
- **Neighbours:** `(org)/o/[slug]/error.tsx` and `OrganizationsUnavailable` use the same register and are not changed.

### Group G — AdminForbidden and the docs gate

| Where | String |
|---|---|
| Heading | the page's own title ("Release notes", "Organizations", "New organization", "Organization") |
| Body | "Your account doesn't include {area}. Ask a platform administrator if you need it." with `{area}` = "release notes" or "managing organizations" |

- **Residuals:** none. It is an admin-only component (R2), so it cannot become the `(org)` miss response that DECISION-040 requires to be byte-identical across statuses.
- **Source of truth:** shown when `hasFeature(session.user.features, KEY)` is false for the page's key. It claims only that the account lacks that capability, not why.
- **Audience:** a viewer who holds the door key but not this page's key. A platform administrator can grant it (assign a role at `/admin/users`), so "ask a platform administrator" is actionable.
- **Neighbours:** the three "You don't have permission to manage organization branding." sentences (`organizations/page.tsx:88`, `new/page.tsx:38`, `[id]/page.tsx:82`) are replaced; the others ("view giving health", "manage organization domains", "view organization sites", "manage two-factor policy", "view this page") are accurate and stay until Increment 4's sweep.

### Group H — Stale-copy corrections

| Where | Old | New |
|---|---|---|
| `permissions.ts:53-55` catalog `name` | "Manage organization branding" | "Manage organizations" |
| `permissions.ts:53-55` catalog `description` | "Create organizations; set a congregation's brand colour, logo and type pairing at onboarding; neutralise an abusive tenant's brand." | "Create organizations and manage how each is set up on PresbyPortal: administrator and treasurer invitations, brand and public profile, public site, domains, and giving-notice health." |
| `organizations/page.tsx` description | "Set a congregation's brand colour, logo and type pairing — typically done once, on the onboarding call. This is also where an abusive tenant's brand is neutralised." | "Find an organization, see how it is set up, and open it to manage its administrators, brand, public site and domains." |
| `(member)/home/page.tsx:170` Admin card description | "Users, roles, flags, and the platform operations shell." | "Organizations, support, accounts and platform settings." |
| `2fa/page.tsx` (new, only when truncated) | — | "Showing the first {shown} of {total} accounts." |

- **Residuals:** the new catalog description names no brand "neutralise" capability separately (it is part of "brand") and says nothing about enforcement. No string states that organization type or slug is database-protected (S3 stays open for Increment 3).
- **Source of truth:** the description lists what `ADMIN_ORGANIZATIONS` actually gates today (Phase 1, verified against the pages): organizations, new, detail (invitations, holders, brand, profile, service times, site, domains), Sites, Giving health, Domains. The 2FA note's total is `count(*) over ()` from the same statement that returned the rows, so it cannot disagree with the list.
- **Audience:** the catalog text is read only through `/developer` (a different predicate, `isPlatformAdmin`) and `dev-docs.ts`; no operator screen displays `features.name`, and deployed `features` rows keep the old text (the seeder is `onConflictDoNothing`). The org-list description and the `/home` card are read by `ADMIN_ORGANIZATIONS` holders and `canAccessAdmin` holders respectively. The 2FA note is for `ADMIN_TWO_FACTOR` holders.
- **Neighbours:** grepped `Manage organization branding`, `brand colour`, `abusive tenant`, `operations shell`, `permission to manage organization`: remaining hits are code comments (`neutralize-dialog.tsx:25`, `actions.ts:387`, `[id]/page.tsx:57`, `sites.ts:1460`), not user-facing, and the Increment 2 rewrite of the detail page owns the comment at `[id]/page.tsx:57`. `docs/product/functionality-map.md:36` describes the retired tile grid and is rewritten at ship.

### Neighbour modify targets (the consolidated list)

| File:line | Why it is stale | Action |
|---|---|---|
| `src/lib/admin-portal/tiles.ts:82` and all tile labels/descriptions | the tile grid is retired | delete the file |
| `src/lib/permissions.ts:53-55` | under-describes the key | modify (R5) |
| `src/app/(admin)/admin/organizations/page.tsx:88`, `:155-159` | stale forbidden sentence and description | modify |
| `src/app/(admin)/admin/organizations/new/page.tsx:38` | stale forbidden sentence | modify |
| `src/app/(admin)/admin/organizations/[id]/page.tsx:82` | stale forbidden sentence | modify (block only) |
| `src/app/(member)/home/page.tsx:170` | "operations shell" under-describes the console | modify (description only) |
| `src/app/(admin)/admin/page.tsx` header comment (lines 12-60) | describes the tile grid and `demo.new_dashboard` | rewritten with the page |
| `docs/ui-standards.md:69` | "injects `p-8`" | modify to `p-4 sm:p-8` and say why |
| `docs/ui-standards.md:541-572` | says no `loading.tsx` files exist and uses `src/app/(admin)/admin/users/loading.tsx` as the worked example, which contradicts R1c | rewrite the example path to a non-admin illustration and add the admin exception (a `loading.tsx` above a `notFound()` route turns its 404 into a 200; use per-card `Suspense`) |
| `docs/ui-standards.md:706`, `:707` | "(`p-8` in admin layout)"; "`loading.tsx` + `error.tsx` present in any new route segment" | modify; the second gets "except under `(admin)/admin`" |
| `docs/product/functionality-map.md:36` | describes the tile grid | rewrite at ship (Rule 14) |
| `docs/TODO.md:416`, `:417` | name the missing Sites tile and the unfiltered sidebar; both are fixed here | close in the integration commit (Rule 10) |
| `e2e/admin-login.spec.ts` (comment before the link loop) | "appears twice on the dashboard — sidebar nav and a card" | modify comment |
| `CLAUDE.md` Project Layout | no `admin-portal` entries | add two lines at integration (DECISION-253) |

## Carry-forward

### Phase 2 rulings

| Ruling | Addressed here, or deferred |
|---|---|
| R1a persistent left nav inside the workspace | Increment 2 (the workspace). Increment 1 keeps the nav on every `/admin/**` page and highlights by longest match, so `/admin/organizations/<id>` already lights Organizations (E8). |
| R1b no data-reading `[id]` layout; `requireWorkspaceOrg`; source-scan test | Deferred to Increment 2 (no workspace routes yet); accepted by the architect (R10). Increment 1 does not add a layout under `[id]`. |
| R1c no `loading.tsx` anywhere under `(admin)/admin`; `error.tsx` | **Addressed:** `error.tsx` (Batch A); absence pinned (E13); 404 status pinned in e2e (E15). Never render `error.message` (E14). |
| R1d `error.tsx` cannot catch its own layout; wrap `readIsPlatformAdmin` | **Addressed:** `.catch(() => false)` (E11). |
| R1e section URLs, `?from=`, `?org=` validators | Deferred to Increment 2 (`back-href.ts`, `?org=` on tickets and domains). |
| R1f `revalidateWorkspace` | Deferred to Increment 2 (the split does not exist yet). |
| R2 component placement | **Addressed:** `LoadError`, `EmptyState`, `CountCard` in `shared/`; `AdminForbidden`, nav pieces, header in `admin-portal/`; no section-nav wrapper; `OrganizationsUnavailable` and `CommunityEmptyState` untouched; dashboard card components co-located in `_dashboard/`; one sign-out path. |
| R3 no migration for G12/G14; pure resolver; audit-derived label | Deferred to Increment 2 (accepted, R10). Increment 1 adds no migration. |
| R4 staged status treatment | **Addressed for Increments 1–3:** existing tokens only, always icon plus text, no palette literals in any new file. Second stage deferred to Increment 4. |
| R5 `permissions.ts` copy-only | **Addressed** (Group H, E24). |
| R6 `p-4 sm:p-8` plus `ui-standards` note | **Addressed** in the Batch A commit (E25, 360px checks). |
| R7a per-card isolation, mounted only for holders, no caching, bounded | **Addressed** (E4, E5, E22). No `unstable_cache`; React `cache()` not even needed. At most 10 statements (noted above). |
| R7b allow-list boundaries test | **Addressed** (E19). |
| R7c workspace sub-panels need their own keys | Deferred to Increment 2. |
| R7d the 2FA exception | **Addressed:** `two-factor-stranded.ts` returns a count or rows; `member_count` stays page-local (E20). Card 9 shows a count with no email. **If the operator reads card 9 as extending the exception, the fallback is to drop that one card; it is independent of the rest** (Question 2). |
| R8 `getPlatformDb` and Two Hierarchies; no `/o/` link; audit card shape | **Addressed for the dashboard:** no `/o/` literal under the console (E13); card 12 never selects `metadata` whole (E17). Designation-holder and workspace parts deferred to Increment 2. |
| R9 MFA gate not triggered; layout redirect tests; run the login e2e | **Addressed** (E10, E26; the touched-file rule above). |
| R10 increment split and numbers | **Addressed:** DECISION-251/252/253/255 and F274/F276/F281 carried here. |
| S1–S5 | Ruled above. |

### Phase 1 gaps (G)

| Gap | Addressed here, or deferred (who accepted) |
|---|---|
| G1 dashboard degraded and empty states | Addressed (E2, E5, E7). |
| G2 2FA gate unchanged | Addressed (E10, E26). |
| G3 Two Hierarchies on the platform tier | Addressed (boundaries test, E19, E20; recorded exception kept, not extended). |
| G4 audit | No new mutation in this increment; `check:audit` unaffected. Increment 3 owns creation audit. |
| G5 empty states on a new install | Addressed (zero-organization card state; per-card calm all-clear). |
| G6 stale page copy and catalog text | Addressed (Group H, R5). |
| G7 mobile 360px | Addressed for the shell and dashboard; create form and `users` are Increments 3 and 4 (analyst's sequence, accepted at Phase 1). |
| G8 create form permanence and `HydrationGate` | Deferred: S2 standalone bug-fix (needs the operator's yes), type panel and permanence line in Increment 3. |
| G9 failure copy and isolated reads | Addressed on the dashboard; the workspace is Increment 2. |
| G10 creation transactionality | Increment 3. |
| G11 `?org=` filters | Increment 2. |
| G12 effective vs stored toggle state | Increment 2 (R3). |
| G13 "who changed it" label | Increment 2 (R3). |
| G14 first-administrator definition | Increment 2 (dashboard cards 1 and 2 move there). |
| G15 dashboard performance and bounded reads | Addressed (one statement per card, no per-organization loop, E22; `EXPLAIN` E27). |
| G16 no `error.tsx`/`loading.tsx` | Addressed, with the architect's correction (F274). |
| G17 reachability mismatch | Addressed (F281): `/admin/docs` page gate; Design system documented as door-level. |
| G18 active state and landmarks | Addressed (E8, E9, E12). |
| G19 per-org 2FA in the workspace | Increment 2. |
| G20 naming | Addressed ("Platform admin" in the Copy table; `/home` card title left as "Admin" because a spec pins it, a follow-up in `docs/TODO.md`). |
| G21 shared status treatment | Addressed for Increments 1–3 (R4). |
| G22 version | Addressed (nav footer). |
| G23 docs at ship | Planned (functionality map, TODO, CLAUDE.md layout; `architecture.md` not touched per Rule 15). |
| G24 `?from=` | Increment 2. |

### Phase 1 open questions

Q1 split — as recommended. Q2 retire the grid — operator ruled yes; done here. Q3 Option B — operator ruled; Increment 3. Q4 no correction path — Increment 3 copy. Q5 merge flags into "Access and settings" — done. Q6 first-administrator definition — Increment 2. Q7 audit card — done (S1). Q8 keep the member count — operator ruled; kept, not extended (E20). Q9 no org switcher — deferred (Increment 2 breadcrumb and find box; the find box ships here). Q10 shared avatar menu — operator ruled yes; done. Q11 Reference footer — done. Q12 copy-only change — done. Q13 no flag — held. Q14 `admin-portal/` directory — done.

### UX principles (U1–U13) applied in this increment

| # | Applied how |
|---|---|
| U1 calm failure with recovery | `error.tsx` and per-card error state, 44px "Try again". |
| U2 failure is never "none" | `CardResult` is a union; presenters cannot render an error as zero (E5). |
| U3 degraded states, one forbidden state | `AdminForbidden`; nav and cards hide what is not held; destinations still answer. |
| U4 empty states | `EmptyState`; zero-organization card; recent-changes empty text; "no matches" is the org list's, untouched. |
| U5 section navigation by real links | Nav is real links. The `ButtonGroup` workspace section nav is Increment 2. |
| U6 whole-card destinations | `CountCard` is a whole-card link with title, chevron and a focus ring. |
| U7 44px targets, single column at 360px | Nav links, Menu button, cards, buttons, find form (360px checks). `users` is Increment 4. |
| U8 `HydrationGate` | No new data-writing form here; the create form is S2. |
| U9 tokens only | No palette literal in any new file; the 43 existing ones are Increment 4. |
| U10 page header and action bar | Dashboard action bar with the text-labeled button first. |
| U11 plain language | "tenant" removed from the strings this increment owns; the platform-status help text is Increment 3. |
| U12 skeletons only where a segment always renders | Per-card `Suspense`; no `loading.tsx`. |
| U13 `FormattedDate` | The "Updated" line and the recent-changes times. |

### Follow-ups to add to `docs/TODO.md` at integration (orchestrator)

- Rename the `/home` Admin card title to "Platform admin" and update `e2e/member-home.spec.ts:152` (G20).
- Documentation review: consolidate `src/lib/admin/` and `src/lib/admin-portal/` (S4; blocked by B6's path).
- If `EXPLAIN` on the recent-changes statement is slow at volume: an `audit_events` index (E27).
- A support-operator e2e fixture (needs `e2e/support/users.ts`, a Rule 16 file) if the unit-level pin proves insufficient.
- Migrate the other hand-copied forbidden and failure blocks onto `AdminForbidden`, `LoadError` (Increment 4).

## Decision drafts (the orchestrator writes `docs/decisions.md` at integration)

**DECISION-251 — The platform console is two tiers in the existing `(admin)/admin` tree; every section page gates before it parses; no `loading.tsx` exists under `(admin)/admin`.**
**Status:** Resolved (architect, Phase 2; tech-lead, Phase 3) · **Date:** 2026-10-25 · **Feature:** `2026-10-25-platform-admin-redesign` (Increment 1 carries the shell; Increment 2 the workspace; no migration)
- **Tiers.** Tier 1 is `/admin` and the cross-organization lists under one persistent platform nav. Tier 2 is the organization workspace, real section routes under `/admin/organizations/[id]/**`, under the same nav.
- **Order.** Every workspace page calls `requireWorkspaceOrg(params)` first: permission, then UUID, then one `cache()`d organization read. There is no data-reading `[id]` layout, because a layout renders concurrently with its page and cannot stop the page's reads.
- **No `loading.tsx` under `(admin)/admin`, including at `/admin` itself.** A `loading.tsx` wraps every descendant route in Suspense, so the four `notFound()` routes (`organizations/[id]`, `users/[id]`, `tickets/[id]`, `whats-new/[id]`) would answer their 404s with HTTP 200 (the (org) contract's 2026-08-18 measurement). Loading feedback is per-card `Suspense`. A source-scan test pins the absence.
- **Error boundary.** `(admin)/admin/error.tsx` renders calm copy and never `error.message`. It does not catch its own layout, so the layout wraps the live `isPlatformAdmin` read in a `catch`.
- **No proxy rule and no link into `/o/<slug>`.** Pages own per-feature checks; nothing under the console links into a tenant route, pinned by a scan.
- **Revisit if** a console route needs a streaming skeleton badly enough to justify a route group whose descendants never call `notFound()`.

**DECISION-252 — The platform tier shows only platform-axis data; dashboard readers are held to an allow-list of tables by a source-scan test; the 2FA predicate is the one recorded exception.**
**Status:** Resolved (architect, Phase 2; operator ruling Q8; tech-lead, Phase 3) · **Date:** 2026-10-25 · **Feature:** `2026-10-25-platform-admin-redesign` (Increment 1)
- **Rule.** The dashboard may show counts, ages and links for organizations, accounts, invitations, queue rows, tickets and feedback (as counts), domains, sites, flags and audit rows. It never shows a count or content derived from people, the roll, gifts, events or attendance. No names beyond the public `organizations.name`, no amounts, no ticket or feedback text.
- **Enforcement.** Readers live in `src/lib/admin-portal/dashboard/`. `boundaries.test.ts` allows only listed tables, `from`/`join` identifiers, one `presby_*` function and a short list of modules; anything unlisted is forbidden by default. The audit reader never selects `metadata` whole.
- **The exception.** "Required but not enrolled" resolves through `people` and `memberships`. It lives in `src/lib/admin/two-factor-stranded.ts`, outside the scanned directory on purpose, and returns accounts or a count. `/admin/2fa`'s per-organization `member_count` stays page-local and is never extracted. If the card is read as extending the exception, drop the card.
- **Sub-panels** in the Increment 2 workspace check their own keys inside a page gated by `ADMIN_ORGANIZATIONS`.
- **Accepted residual (`paper`).** Nothing prevents a future reader from reading a tenant table outside the directory; the scan, review and the retrospective are the controls.
- **Revisit if** the operator wants a members-per-organization figure on the platform tier (a Two Hierarchies decision, not a card).

**DECISION-253 — `src/components/admin-portal/` is the home for admin-only composition; the nav registry replaces the tile registry; the admin shell mounts `AvatarMenu`; one copy-only change to frozen `permissions.ts`.**
**Status:** Resolved (architect, Phase 2; tech-lead, Phase 3) · **Date:** 2026-10-25 · **Feature:** `2026-10-25-platform-admin-redesign` (Increment 1)
- **Placement.** Admin-only composition (`AdminNav`, `AdminNavLinks`, `AdminMobileMenu`, `AdminHeader`, `AdminForbidden`) lives in `src/components/admin-portal/`, parallel to `org-portal/`. Generic pieces (`LoadError`, `EmptyState`, `CountCard`) live in `shared/`. The forbidden state stays admin-only so it cannot become the byte-identical `(org)` miss response of DECISION-040.
- **Registry.** `src/lib/admin-portal/nav.ts` replaces `ADMIN_TILES` under DECISION-123's constraints: pure synchronous data, filtering in a co-located helper. `DomainTileSections` and `TileGrid` remain for `(org)`.
- **Shell.** The header mounts `AvatarMenu`, not `GlobalNav` (whose `OrgSwitcher` would put `/o/` links and a tenant read in admin chrome). The inline sign-out is removed; there is one sign-out path.
- **Frozen file.** The `name` and `description` of `FEATURES.ADMIN_ORGANIZATIONS` may be corrected as copy; keys, map and order are untouched, pinned by a test. Deployed `features` rows keep the old text and nothing displays it.
- **Layout.** `<main>` is `p-4 sm:p-8` with `min-w-0`, noted in `docs/ui-standards.md`.
- **Revisit if** a second consumer appears for a collapsing-nav primitive (then promote it to `shared/`).

**DECISION-255 — Status treatment is staged: existing tokens with an icon and text in Increments 1–3; the reserved semantic slice lands in Increment 4.**
**Status:** Resolved (architect, Phase 2) · **Date:** 2026-10-25 · **Feature:** `2026-10-25-platform-admin-redesign` (stage one in Increment 1)
- **Stage one.** Failure is `text-destructive` with `CircleAlert` and a label; needs attention is `text-foreground` on `border-foreground` with `TriangleAlert` and the words "Needs attention"; all-clear is `text-muted-foreground` with `CircleCheck`. No palette literal in any new file, no new token.
- **Stage two (Increment 4, short Phase 2 addendum).** Declare `--success`, `--warning`, `--info` (and foregrounds) for both schemes, drop `reserved`, add contrast proofs, add `Badge` variants with a header-commented divergence, convert the 43 existing literals.
- **Revisit if** the contrast proofs for the three families cannot be met in both schemes.

**Finding text for the orchestrator (F-numbers):** F274 — the admin console has no error boundary, and a `loading.tsx` at `(admin)/admin` would send four `notFound()` routes out as HTTP 200 (fixed: `error.tsx`, absence pinned). F276 — `/admin/2fa` and the dashboard card resolve "required" through `people` and `memberships`, and the page shows a per-organization `member_count`: the recorded exception (fixed by confinement: one module, `member_count` page-local). F281 — `/admin/docs` was proxy-gated only (`src/proxy.ts:42`) with no page check; `/admin/design-system` has no key (fixed: page gate; Design system documented as door-level).

## Feasibility check (against the live tree, 2026-10-25, worktree at `main` 77be511)

- **SQL:** no function, DDL or migration is added; the new statements are `SELECT`s over existing tables and one existing definer function (`presby_giving_ingest_health()`, owner-only, already called through `getPlatformDb()`).
- **Dependencies of anything dropped:** `ADMIN_TILES`, `visibleAdminTiles`, `ADMIN_TILE_ICONS` are referenced only by `page.tsx`, `visible-tiles.ts`, `tile-icons.ts`, `tiles.test.ts`, `visible-tiles.test.ts` (grep over `src`, `docs`, `scripts`, `e2e`, `.claude`); the two shared test files use local fixtures. No `SECURITY DEFINER` body references any of this.
- **CHECK/trigger/fixture:** none added. **FK:** none.
- **Tripwires** read against the plan: see Risks.
- **Audit writers** verified for every card-12 action (`issue.ts:600`, `accept.ts:236`, `designation-holders.ts:195,247`, `flags/actions.ts:28`, `users/actions.ts:41/66/117/147`, `users/[id]/actions.ts:106`). `totp.reset` has no writer and is excluded.
- **Destination parameters** verified: `/admin/organizations/domains?filter=attention` (`parsePlatformListFilter`), `/admin/tickets?status=new`, `/admin/email-queue?status=failed|queued` (`VALID_STATUSES`), `/admin/organizations?q=` (`parseOrgFilters`, `MAX_Q_LENGTH` 100).
- **Sheet:** `@radix-ui/react-dialog` is in `package.json:53`; `src/components/ui/dialog.tsx` exists as precedent. `ui:add` itself is not run at design time.
- **Not verifiable at design time:** `npm ci` and the Sheet generator in the worktree (no `node_modules`); `EXPLAIN` volume (E27); 360px rendering (E28, E30).

## Questions for the operator

1. **Create form `HydrationGate` (S2): ship it now as a small standalone bug-fix?** Recommended yes. It closes a live defect whose wrong result (a Congregation where a Presbytery was meant) cannot be repaired in the product, and it does not need to wait for the creation increment. Default if you do not answer: it waits for Increment 3.
2. **The "Two-factor" dashboard card.** It counts accounts that are required to use two-factor but have not enrolled, using the same people-and-memberships lookup `/admin/2fa` already uses (count only, no emails, no member counts). You ruled to keep the page's member count as a known exception; this card reuses the lookup, not the member count. Keep the card (default), or drop it so the dashboard touches no member-derived data at all?

Smaller defaults taken that you can veto at review: the nav footer shows the version; a "Skip to main content" link; the single-item "Content" group stays as Phase 1 specified; the `/home` card keeps the title "Admin" with a new description.

## Implementer

**api-developer** for Batch B (readers, extractions, DB tests, boundaries test). **ux-developer** for Batches A and C and the two fix commits (shell, shared components, dashboard, e2e, browser verification). Batch C starts after A and B merge into the branch. Judgment: this splits cleanly along the server/client line, and the dashboard presenters (Batch C) consume the reader types (Batch B), so the contract above is the handoff.

---

# Phase 4 — Implementation

## Phase 4 — Batch B (api-developer): readers, extractions, boundaries test

**Status:** complete. Commits on `pipeline/platform-admin-redesign`: `refactor(admin): share the two-factor and domains attention predicates with the dashboard` and `feat(admin): platform dashboard readers held to platform-axis tables`. Not pushed.

### Contract the next agent (ux-developer, Batch C) consumes

All readers are `import "server-only"`, run on `getPlatformDb()`, issue one statement, and return `CardResult<T>` from `src/lib/admin-portal/dashboard/read-card.ts` (`({ kind: "ok" } & T) | { kind: "error" }`). Import each from `@/lib/admin-portal/dashboard/<file>`.

| Reader (file) | `ok` fields |
|---|---|
| `readTicketsCard` (tickets.ts) | `newCount`, `unassignedOpen`, `oldestNewSeconds: number \| null` |
| `readFeedbackCard` (feedback.ts) | `newCount` |
| `readEmailCard` (email.ts) | `failed`, `overdue` |
| `readGivingCard` (giving.ts) | `connections`, `waiting`, `deadLetters`, `restricted` |
| `readDomainsCard` (domains.ts) | `needAttention` |
| `readSitesCard` (sites.ts) | `live`, `provisioning`, `suspended` |
| `readTwoFactorCard` (two-factor.ts) | `notEnrolled` |
| `readAccountsCard` (accounts.ts) | `locked` |
| `readOrganizationsCard` (organizations.ts) | `total`, `byType: Record<OrgTypeKey, number>`, `byStatus: Record<PlatformStatusKey, number>`, `inactive`, `defaultPalette`; also exports `ORG_TYPE_KEYS`, `PLATFORM_STATUS_KEYS`, `OrgTypeKey`, `PlatformStatusKey` |
| `readRecentChangesCard` (recent-changes.ts) | `rows: { action: ChangeAction; subject: string \| null; actorEmail: string \| null; at: string (ISO) }[]`, at most 10, newest first |

Additions beyond the design's signatures (all pure, for the presenters):

- `src/lib/admin-portal/dashboard/change-labels.ts`: `CHANGE_ACTIONS`, `ChangeAction`, `CHANGE_LABELS` (the ten Copy-group-E labels, one per action key), `UNKNOWN_ORGANIZATION`. The reader already substitutes "Unknown organization" for an organization that no longer resolves, so `subject` is never an id. A test pins every key to `AUDIT_ACTIONS`.
- `byStatus` keys are `managed | invited | unmanaged`. `oldestNewSeconds` is whole seconds from SQL (feed it to `formatAge` from `@/lib/admin/format-age`).
- No auth or feature check is inside a reader (callers mount a card only for a holder, E4). No caching.

Shared extractions (behavior-preserving):

- `src/lib/admin/two-factor-stranded.ts`: `STRANDED_WHERE`, `countStranded()`, `listStranded(limit)` returning `{ rows, total }` (`total` is `count(*) over ()` from the same statement). `2fa/page.tsx` now calls `listStranded(50)` and shows "Showing the first {shown} of {total} accounts." only when truncated. The `orgs` query and `member_count` stay inline and page-local. `limit` clamps to 1..1000.
- `src/lib/domains/platform-read.ts`: `attentionCondition()` (private) now backs the `attention` filter of `listDomainsAcrossOrgs`, and `countDomainsNeedingAttention()` is the card's count (same inner join to `organizations` as the list).
- `src/lib/admin/giving-ingest-health.ts`: `summarizeIngestHealth(rows)` (pure) and `readIngestHealthSummary()` (one `listIngestHealth()` call). `check:giving-boundaries` B6 still passes.

No routes, no server actions, no schema, no migration, no `FEATURES` or seed change, no audit event (read only).

### Files created

- `src/lib/admin-portal/dashboard/`: `read-card.ts`, `change-labels.ts`, `tickets.ts`, `feedback.ts`, `email.ts`, `giving.ts`, `domains.ts`, `sites.ts`, `two-factor.ts`, `accounts.ts`, `organizations.ts`, `recent-changes.ts`; tests `read-card.test.ts`, `tickets.test.ts`, `feedback.test.ts`, `email.test.ts`, `giving.test.ts`, `domains.test.ts`, `sites.test.ts`, `two-factor.test.ts`, `accounts.test.ts`, `organizations.test.ts`, `recent-changes.test.ts`, `boundaries.test.ts`; DB tests `recent-changes.db.test.ts`, `readers.db.test.ts`.
- `src/lib/admin/two-factor-stranded.ts`, `two-factor-stranded.db.test.ts`, `giving-ingest-health.test.ts`.

### Files modified

- `src/app/(admin)/admin/2fa/page.tsx` (uses `listStranded`; truncation note), `src/lib/admin/giving-ingest-health.ts`, `src/lib/domains/platform-read.ts`, `src/lib/domains/platform-read.db.test.ts` (parity test added).

### Edge cases pinned (Batch B share)

E5 (each reader's rejecting-execute test, and `read-card.test.ts`), E6 (class-only logging; a message containing SQL text is absent), E17 (`recent-changes.db.test.ts` seeds a revoke whose metadata carries a marker; the serialised result never contains it; `boundaries.test.ts` allows `metadata` only as `metadata->>'...'`), E18 (key-exact results for tickets and feedback), E19 (allow-list scan over imports, `from`/`join` identifiers incl. CTE names, `presby_*` names, `@/` modules, `/o/` literals; with synthetic-offender proofs so the scan is not vacuous), E20 (`member_count` appears only in `2fa/page.tsx` across `(admin)`, `lib/admin`, `lib/admin-portal`; `two-factor-stranded.ts` exports no member count), E21 (`countStranded() == listStranded(1).total`; `countDomainsNeedingAttention() == listDomainsAcrossOrgs("attention").rows.length`; sites counts sum to `listSitesForAdmin().length`), E22 (each reader's unit test counts one `execute` call).

### Verification

`npm run typecheck`, `npm run lint`, `npm run check` (all eight tripwires), plain `npm test` (575 files passed, 80 skipped), and the DB-backed suites (`dotenv -e .env.local -- vitest run --no-file-parallelism` over `src/lib/admin`, `src/lib/admin-portal/dashboard`, `src/lib/domains/platform-read.db.test.ts`) all pass against the `pipeline-platform-admin-redesign` Neon branch. The recent-changes DB test dates its fixture rows two days ahead and deletes them by id.

### Implementer notes

- Design deviations: none in behavior. Two small choices for the record: (1) the tickets statement restricts to the three open statuses (`where status in (...)`) so it can use `tickets_status_created_idx`; the three numbers are unchanged. (2) It uses `date_part('epoch', ...)` rather than `extract(epoch from ...)` so a source scan for `from <table>` is not fooled by the `from` inside `extract`.
- The Giving and Sites readers go through existing modules (`readIngestHealthSummary`, `listSitesForAdmin`), as designed, so the unit tests mock those modules or the `execute` the module calls rather than SQL text.
- Statement bounds: every reader is an aggregate or `limit 10`; no `statement_timeout` is set (it would be a second statement per read, contradicting E22). The Neon pool default (`max` 10) matches the design's E22 note.
- Unverified for Phase 5 (unchanged from the design): E27, `EXPLAIN` of the recent-changes statement at production volume.
- Hand-off: Batch C (ux-developer) writes `_dashboard/present.ts` against the table above. QA next after Batches A and C.

## Phase 4 — Batch A (ux-developer): the shell

**Status:** complete. Commits on `pipeline/platform-admin-redesign` (not pushed): `feat(admin): grouped permission-filtered nav, header with the avatar menu, and an error boundary`; `fix(admin): gate /admin/docs at the page as well as the proxy`; `fix(admin): correct the ADMIN_ORGANIZATIONS catalog text`.

### What shipped

- **Registry.** `src/lib/admin-portal/nav.ts` (pure data) and `(admin)/admin/visible-nav.ts` replace `ADMIN_TILES`, `visible-tiles.ts` and `tile-icons.ts` (all deleted with their tests; `domain-tile-sections.test.tsx` already used local fixtures, only its stale header comment was fixed).
- **Shell.** `AdminNav` (server sidebar, internal scroll, "Version {APP_VERSION}"), `AdminNavLinks` (client leaf, longest-href active state, `aria-current`, 44px), `AdminMobileMenu` (visible "Menu" button, left `Sheet`, closes on route change by a pathname-keyed remount plus `onNavigate`), `AdminHeader` (skip link, `/home` back link, "Platform admin" label from `sm`, shared `AvatarMenu`; sign-out exists once), and the layout rewrite. The two redirects are byte-identical and pinned; the live `isPlatformAdmin` read is wrapped in `.catch(() => false)`.
- **Shared and admin components.** `LoadError`, `EmptyState`, `CountCard`/`CountCardSkeleton` in `shared/`; `AdminForbidden` in `admin-portal/`; `(admin)/admin/error.tsx` (never renders `error.message`); no `loading.tsx` under the console (pinned by `shell-boundaries.test.ts`, together with: no `/o/` literal, no `BrandTokens`/`getPlatformDb` in `components/admin-portal/`).
- **`ui:add sheet`** reported no unvetted package and left `package.json` and the lockfile untouched. Divergences recorded in the file header: `cn` import fixed to `@/lib/utils` (the generator emitted a bare `"cn"` specifier), 44px close control with ring offset, `w-[85vw] max-w-xs` instead of `w-3/4`.
- **Docs.** `docs/ui-standards.md`: `p-4 sm:p-8` with the reason and `min-w-0`; the Loading & Error States section rewritten (worked example moved to a non-admin illustration, the `notFound()`-becomes-200 exception stated, pointer to `LoadError`/`EmptyState`/`CountCardSkeleton`); checklist lines at the end updated.
- **Fixes.** `/admin/docs` page gate with a failing-first test (fails before, passes after); `permissions.ts` copy-only change plus a key/map/order/category snapshot test.
- **Interim `/admin` page.** The page no longer imports the tile files (it could not, they are deleted). It renders `GreetingBand` (testid kept) and the door-only `EmptyState` with the byte-identical strings; Batch C replaces everything below the greeting. The tile-specific page tests were removed; Batch C re-pins E1 to E4.

### Verification

`npm run typecheck`, `npm run lint`, `npm run check` (all eight tripwires), plain `npm test` (574 files passed, 80 skipped) and `npm run build` pass. Real browser on :3530 (own dev server, started with the e2e cron and domain-fake env, stopped by PID) at 360x740 and 1280x800: no horizontal overflow on `/admin` or `/admin/organizations`; the Menu button is 94x44; all 15 menu links are 44px; the Sheet opens, Escape closes it and returns focus to the Menu button, a link click navigates and closes it; the avatar menu shows Account, Platform admin, Sign out (the e2e admin is not `is_platform_admin`, so no Developer) and sign-out lands on `/` with a "Sign in" link; `/admin/organizations/<unknown uuid>` answers HTTP 404; at desktop `/admin/organizations/domains` lights Domains only. The throwaway spec used for this was deleted, not committed (Batch C owns `e2e/admin-shell.spec.ts`).

### Implementer notes

- **For Batch C's e2e: select the phone menu with `getByRole("button", { name: "Menu", exact: true })`.** The avatar trigger's accessible name is "Account menu for {name}", which contains "menu" and makes a bare `{ name: "Menu" }` a strict-mode violation (it hit me).
- Sign-out is a `menuitem`, not a `button`, in the avatar menu; `e2e/admin-login.spec.ts:68/77` clicks the button on `/` (the public front page), not on an admin page, so no spec depended on the old admin "Sign out (email)" button (grep over `e2e/` and `src/` found none besides the layout and `(account)/layout.tsx`, which is untouched).
- Deviation, minor: `LoadError` carries `role="alert"` and takes a `children` slot (for the console's "Back to the dashboard"); the design listed neither. `CountCard` takes the destination as both a `href` prop and an optional `state.href` override, as designed.
- Not done in this batch, still on the design's Fixes list: the organizations list description, the three organization forbidden blocks (`AdminForbidden`), and the `/home` Admin card description (Group H). The stale `admin-login.spec.ts` comment is Batch C's.
- Unverified (Phase 5 owns them): E28 (long name wrapping in the recent-changes card, not built yet), E30 (release-notes markdown at 328px; the page's `grid-cols-[200px_1fr]` is unchanged and is likely to be tight at 360px, pre-existing, recorded for Increment 4).
- Hand-off: Batch C (ux-developer) next, then QA.

## Phase 4 — Batch C (ux-developer): the dashboard

**Status:** complete. Commits on `pipeline/platform-admin-redesign` (not pushed): `feat(admin): the platform dashboard replaces the tile grid`; `fix(admin): correct the stale organization and home-card copy`; `test(e2e): admin shell and dashboard at 360px`.

### What shipped

- `(admin)/admin/_dashboard/`: `registry.ts` (pure data: zones, ten cards, keys), `visible.ts` (the one place features meet the registry; empty zones omitted), `present.ts` (all card copy as pure `CardResult -> CountCardState` presenters), `cards.tsx` (nine thin async wrappers plus the `DASHBOARD_CARD_VIEWS` map the page tests replace with stubs), `recent-changes-card.tsx` (wide list card; rows are plain text, time on its own line, `break-words`), `find-organization.tsx` (plain GET form to `/admin/organizations?q=`, no `useForm`).
- `page.tsx`: `GreetingBand` (testid kept), action bar for `ADMIN_ORGANIZATIONS` holders (New organization first in DOM, full width on a phone; find form stacks), "Updated {FormattedDate}", four static zones, each card its own `Suspense` with `CountCardSkeleton`, mounted only for a key holder. Door-only viewers get the byte-identical empty state. A holder of only nav-only keys (flags, what's new) gets the greeting and no false "no access" message.
- Copy group H: organizations list description; three organization forbidden blocks now `AdminForbidden` ("managing organizations"); `/home` Admin card description. Stale comment in `e2e/admin-login.spec.ts`. The tile registry was already retired in Batch A.
- Recent-changes zone: the zone `<h2>` is the card's title; the card carries the Copy subtitle (no duplicated heading). Its error state is inline (same words and 44px "Try again" as `CountCard`).

### Tests

- Unit: `present.test.ts` (error never becomes "Nothing waiting.", plurals, every Copy-D string, E5/E7/E23), `visible.test.ts` (E1-E3), `cards.test.tsx` (wiring, failed read renders the error state, destinations, map covers the registry), `recent-changes-card.test.tsx`, `find-organization.test.tsx`, `page.test.tsx` re-pinned (E1 "support operator sees exactly the Support cards", E2, E3, E4 stub spies never called for a non-holder, no `/o/` link, mixed keys), `organizations/forbidden.test.tsx` (three pages, no database touched), `/home` description assertion.
- e2e `e2e/admin-shell.spec.ts` (7 tests, admin storage state, no flags): zones and no failed card, `a[href^="/o/"]` count 0, find box, nav headings and `aria-current` (longest href), avatar-menu sign-out, 404 status, 360px no-overflow with stacked action bar, Menu flow (44px links, Escape returns focus, navigation closes). Card failure isolation in a running server has no forcing hook in the design, so it is pinned at unit level only (gap, deliberate).
- R9 regression set on :3530 (own server via `PORT=3530`): `admin-login`, `totp-full-login` (MFA-enrolled), `role-boundaries`, `session-claim-integrity`, `totp-callback-bypass`, `admin-audit`, `admin-email-queue`, `admin-organizations`, `whats-new`, `member-home`, `giving-admin`, `admin-shell`: 89 passed, 0 failed.

### Gates

`npm run typecheck`, `npm run lint`, `npm run check` (eight tripwires), plain `npm test` (581 files passed, 80 skipped), `npm run build`, DB suites (admin, dashboard readers, platform-read: 104 passed) all pass.

### Real-browser pass (own dev server on :3530, stopped by PID), development data

Same on both widths, no horizontal overflow at 360px or 1280px: Organizations at a glance "15 organizations" (9 congregations, 5 presbyteries, 1 synod; 12 managed, 1 invited, 2 unmanaged; 13 still on the default palette); Giving notices "Needs attention, 1 dead letter, 1 notice waiting"; Domains "Nothing waiting."; Sites "Needs attention, 1 provisioning, 1 live"; Tickets "1 new ticket, oldest has waited 71 days, 1 open and not assigned"; Feedback "1 new"; Email queue "48 waiting over 30 minutes"; Two-factor "8 accounts not enrolled"; Locked accounts "Nothing waiting."; Recent operator changes: ten "Feature flag changed" rows with flag key, actor and local time, wrapping (the longest key wrapped onto two lines at 360px; E28 only partly confirmed, no long organization name in the data). Phone: cards single column, New organization full width, find input above Search, Menu button and avatar on one row. Desktop: sidebar plus three-column zones; sidebar is not sticky.

### Notes for QA / the orchestrator

- Unverified still: E27 (EXPLAIN), E28 with a long organization name, E30 (release notes at 328px).
- The dev "Updated" line and times render in the browser's zone through `FormattedDate`.
- `docs/work-log/...-inc3.md` shows an uncommitted orchestrator note; not touched or committed here.
- New copy for a fork's branding pass: none beyond the Copy table; "Updated", "Search" and "Find an organization" are the strings added in this batch.

## Files Created

## Files Modified

## Schema Changes

none

## Audit Events

none (no mutation in this increment)

## Implementer Notes

---

# Phase 5 — Verification (qa)

**Date:** 2026-10-25
**Verified by:** qa
**Worktree / HEAD:** `/Users/cshenso/git/presby-platform/presby-padmin`, `pipeline/platform-admin-redesign` at `fa742f7`. Database: the `pipeline-platform-admin-redesign` Neon branch. I checked that its host differs from the main checkout's `.env.local` by comparing hashes; no connection value was printed. `node_modules/node_modules` does not exist. Disk is at 38%.

**Scope run.** Typecheck, lint, `npm run check`, plain `npm test` and `npm run build`, all in full. The DB-backed set over every area the diff touches (`src/lib/admin-portal`, `src/lib/admin`, `src/lib/domains/platform-read.db.test.ts`, `src/app/(admin)/admin`), run with `--no-file-parallelism`. The full `--project=chromium` e2e suite, required because a layout and `src/components/` changed, on a Playwright-started server at :3530. I reset flags first (below). The diff touches no migration, `authz.ts`, `src/lib/db/` or shared fixture, so I did not run the whole DB-backed suite or `test-rls.sql`. I did not run `custom-hosts` or the prod-build lane; the PR's CI covers them. Nothing here rests on the implementer's run.

**Flag state.** Before the e2e run I ran `/Users/cshenso/git/presby-platform/presby/scripts/ci/e2e-reset-flags.sql -v pipeline_branch=1` against this worktree's `PLATFORM_DATABASE_URL` only. It committed 10 seeded flags. It is byte-identical to the worktree's copy.

## Type Check

`npm run typecheck`: PASS
`npm run lint`: PASS (`--max-warnings=0`)
`npm run check`: PASS. All eight tripwires passed: audit, sql-date, deps-drift, brand-scope, secrets, hydration-gate, giving-boundaries, proxy-imports.
`npm run build`: PASS

## Unit Tests

- **Plain `npm test`:** 661 files (581 passed, 80 skipped), 11,205 tests (8,747 passed, 2,458 skipped), 30.0s. The 80 skipped files are the DB-gated suites (`describe.skipIf(!hasDb)`); the next line covers the ones in scope.
- **DB-backed, in scope** (`dotenv -e .env.local -- vitest run --no-file-parallelism …`): 76 files, 811 tests, 811 passed, **0 skipped**, 38.9s. Verbose run of the four DB files the diff adds or changes:
  - `readers.db.test.ts`
  - `recent-changes.db.test.ts`
  - `two-factor-stranded.db.test.ts`
  - `platform-read.db.test.ts`
  - Result: 29/29.
- **Card-vs-destination parity (E21), all passing against the real schema:**
  - `countStranded() === listStranded().total`
  - `countDomainsNeedingAttention() === listDomainsAcrossOrgs("attention", 100000).rows.length`, with `truncated === false`
  - the sites counts sum to `listSitesForAdmin().length`
- **Extraction checks:**
  - `STRANDED_WHERE` is byte-for-byte the predicate removed from `2fa/page.tsx`. The old page also used `LIMIT 50`.
  - `attentionCondition()` is the predicate removed from `listDomainsAcrossOrgs`.

Failures: none.

## End-to-End Tests

Total: 420 | Passed: 420 | Failed: 0 | Skipped: 0 | Flaky: 0 | Duration: 17.1 min (chromium, :3530, Playwright-started `npm run dev`, workers 1)

R9 / E26 regression set, all green in that run:
- `admin-login` (4)
- `totp-full-login` (MFA-enrolled user: password, then a wrong code rejected, then the real code signs in)
- `role-boundaries` (5, including the mfa-admin two-hop redirect from `/admin`)
- `session-claim-integrity`
- `totp-callback-bypass` (7)
- `admin-audit`, `admin-email-queue`, `admin-organizations`, `whats-new`, `member-home`, `giving-admin`
- `admin-shell` (7)

The layout redirect unit tests (E10) pin `/signin?callbackUrl=/admin` and `/totp?callbackUrl=/admin`, and pin that neither fires otherwise. I also read the redirects against `77be511`: they are byte-identical.

**404 status (R1c / E15).** Requested on my own server with the admin session:

| Route (nil UUID) | Status |
|---|---|
| `/admin/organizations/<nil uuid>` | 404 |
| `/admin/users/<nil uuid>` | 404 |
| `/admin/tickets/<nil uuid>` | 404 |
| `/admin/whats-new/<nil uuid>` | 404 |
| `/admin/organizations/not-a-uuid` | 404 |

`find` reports no `loading.tsx` under `src/app/(admin)/admin`, and `shell-boundaries.test.ts` pins that.

**Pre-existing, not this pipeline.** `/admin/users/not-a-uuid`, `/admin/tickets/not-a-uuid` and `/admin/whats-new/not-a-uuid` return **500**. Postgres raises `22P02 invalid input syntax for type uuid` because those pages pass the raw id to the query with no `UUID_RE` check. All three page files are identical to `origin/main` (3af650a). With this diff the 500 now renders the calm `error.tsx` instead of Next's default. Recommend a TODO line for Increment 2 or 4.

**Real-browser pass** (own dev server on :3530 with Playwright's webServer env, stopped by PID):

At 360×740 on `/admin`:
- No horizontal overflow.
- Header fits one row at y=8: Menu 94×44, "← PresbyPortal" 114×44, avatar 44×44. The "Platform admin" label is hidden.
- `<main>` padding is 16px, giving a 328px content column. Cards are a single column at 328px.
- "New organization" is full width at 44px. The find input (328×44) sits above "Search" (328×44).
- No `a[href^="/o/"]` on the page. Zero cards in the failed state.

Phone menu:
- The Sheet settles at 306px (85vw) with the title "Platform admin".
- All 15 links are 44px. The nav scrolls (`overflow-y: auto`, content 971px in 683px).
- The close control is 44×44.
- Clicking Organizations navigates and closes the menu. A click on the current page's own link also closes it. Escape returns focus to Menu.
- On `/admin/organizations/domains` the active item is Domains.

Other pages at 360px:
- `/admin/organizations`: overflow 0.
- `/admin/2fa`, `/admin/organizations/domains`, `/admin/sites`, `/admin/giving`: overflow 0.
- `/admin/docs`: **overflows by 153px**. This is E30 and pre-existing: `grid-cols-[200px_1fr]` is unchanged, and the diff only adds the gate. It stays recorded for Increment 4.

At 1280px:
- No overflow, and the Menu button is hidden.
- The sidebar groups match the Copy table and end with "Version 0.42.3". `/admin/organizations/domains` lights Domains only.
- The first Tab reaches "Skip to main content", and Enter moves focus to `#admin-main`. One `<h1>`.

E28 (long name wrapping):
- Every recent-changes row has `scrollWidth == width` (278px).
- The longest flag key, `org_portal.members_roll_action_edit`, wraps inside the card.
- There is no long organization name in the data, so E28 is only partly confirmed. `break-words` and `min-w-0` are present on the row.

Not browser-checked:
- `error.tsx` at 360px, because the design has no hook to force it. `LoadError` uses `flex-col items-stretch`, and `error.test.tsx` passes.
- `AdminForbidden` at 360px, because there is no non-holder fixture. It is heading and text only.

**Environment note.** My first dev server on :3530 went into an HMR full-reload loop on every page, `/home` included (65–90 navigations in 8s). It cleared when I restarted with Playwright's webServer env, and the Playwright-run server never showed it. It is not caused by this diff. If anyone hits it, restart the server with that env.

**E27 EXPLAIN** (pipeline DB, `EXPLAIN (ANALYZE, BUFFERS)` of the reader's exact statement):
- `audit_events` has 872 rows. Execution 0.232 ms, planning 0.290 ms, 43 shared-buffer hits.
- Plan: backward index scan on `ix_audit_created`, then a filter (351 rows removed to find 11), then a hash left join to `organizations`.
- `ix_audit_action_time` is not used, because the `OR` over the metadata-narrowed invitation keys defeats it.
- At production volume, cost grows with how many audit rows are newer than the 10th match. If closed-list actions become sparse, the scan walks far.
- Acceptable now. Keep the planned `docs/TODO.md` follow-up (an index, or splitting the `OR`), with this plan attached.

## Regression Tests Added

Failing-first confirmed for all three fix commits in scratch copies. Each was taken at `<fix>^` from `git archive`, with the fix's tests overlaid, watched failing, then the fix's sources overlaid and watched passing. The worktree was not touched.

- **`92b3047` docs gate.** `src/app/(admin)/admin/docs/page.test.tsx:41` "renders AdminForbidden and reads no release file without ADMIN_RELEASE_NOTES — regression for /admin/docs relying on the proxy alone".
  - Before the fix: 1 failed, 1 passed ("Unable to find … heading 'Release notes'").
  - After the fix: 2/2.
- **`4b04620` catalog copy.** `src/lib/permissions.test.ts:71` "describes ADMIN_ORGANIZATIONS as organization management, not only branding". The key, map, order and category snapshot sits alongside it at `:42`.
  - Before the fix: 1 failed (Expected "Manage organizations", Received "Manage organization branding").
  - After the fix: 9/9.
- **`e0df3d3` stale copy.**
  - `src/app/(admin)/admin/organizations/forbidden.test.tsx:44`: list, new and detail each render `AdminForbidden` and touch no database.
  - `src/app/(member)/home/page.test.tsx:221`: the new Admin card description.
  - Before the fix: 4 failed. After the fix: 12/12.
- **Gap in this commit (see Verdict):** the organizations list description it changed has no exact-text test.

## Coverage on Critical Modules

- `src/lib/permissions.ts`: 100% statements, branches and functions
- `src/lib/two-factor.ts`: 91.3% statements, 100% branches (lines 35–39 uncovered; not touched by this diff)
- `src/lib/flags.ts`: 100% statements, branches and functions

## Feature-Gate Audit

No route handlers or server actions were added or changed; the increment is RSC reads only. These pages were read in full:

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `/admin` layout | yes (`cachedAuth`) | n/a (door is the proxy: `src/proxy.ts:43`, `ADMIN_DASHBOARD`) | redirects unchanged |
| `/admin` page (dashboard) | yes | yes, per card: each card is mounted only if `hasFeature(features, card.requiredFeature)` (`_dashboard/visible.ts`). Action bar gated `ADMIN_ORGANIZATIONS`. No page-level door check, same as before (proxy). | registry keys match the Copy-table audience; each card's key equals its destination's |
| `/admin/docs` | yes (new) | yes (new, before any `readdir`) | `FEATURES.ADMIN_RELEASE_NOTES` |
| `/admin/organizations` | yes | yes | `FEATURES.ADMIN_ORGANIZATIONS` |
| `/admin/organizations/new` | yes | yes | `FEATURES.ADMIN_ORGANIZATIONS` |
| `/admin/organizations/[id]` | yes | yes (before the UUID check and any read) | `FEATURES.ADMIN_ORGANIZATIONS` |
| `/admin/2fa` | yes | yes (before `listStranded`) | `FEATURES.ADMIN_TWO_FACTOR` |
| `/admin/design-system` | n/a | none, by design (F281, door-level; comment added) | n/a |
| `/home` (Admin card) | unchanged | unchanged (`canAccessAdmin`) | description text only |

**Per-key mounting.**
- **Unit level:** `page.test.tsx` pins it.
  - Support operator: exactly `["feedback", "tickets"]` called, one "Support" heading, no find box or New organization.
  - Door-only: the byte-identical empty state, zero cards called, zero links.
  - The nav subset is pinned in `visible-nav.test.ts`.
- **Code:** read and confirmed.
- **Browser:** no support-operator fixture exists. That is a deliberate gap in the design, because adding one touches `e2e/support/users.ts`.

The new `admin-portal` components never call `getPlatformDb` or `BrandTokens`.

## Copy Truthfulness

Groups A–H were checked string by string against `git diff -U0 77be511...HEAD`.

- [x] **Every added or changed string is in the design's Copy table.** "Search", "Updated", "Find an organization", "Back to the dashboard", "Version …", "System" and "Unknown organization" are all in groups A, B, E or F. None is off-table.
- [x] **The query behind each claim was opened, and what it does not read was named.**
  - **"Nothing waiting." is never shown on a failed read:**
    - Every presenter in `_dashboard/present.ts` returns `ERROR` first.
    - `RecentChangesCard` returns early on `kind: "error"`, so "No recent changes of this kind." cannot appear on a failure.
    - The helper modules a reader goes through (`listSitesForAdmin`, `listIngestHealth`, `countDomainsNeedingAttention`, `countStranded`) contain no `try/catch`, so a DB error reaches `readCard` and becomes `{kind:"error"}`, never `[]` or 0.
    - Pinned by `present.test.ts`, `cards.test.tsx` and `recent-changes-card.test.tsx`.
  - **"Locked after too many failed sign-ins."** The only non-null writer of `locked_until` is `src/auth.ts:177`. The other writers (`:161`, `:255`, password reset, `users/actions.ts:174`) only clear it.
  - **The ten recent-changes labels.** Each action has exactly one writer, and every writer is platform-side:
    - `designation-holders.ts`: writes the revoke action only on outcome `revoked`, with `resource_id` = organization id. Its only caller is `(admin)/…/[id]/actions.ts`.
    - `issue.ts:600`: `selfAddressed` boolean. Imported only from `(admin)`.
    - `accept.ts:236`: `inviterIsInvitee`.
    - `users/actions.ts`, `flags/actions.ts`, `users/[id]/actions.ts`: the platform-role, flag, 2FA-reset and account actions.
  - **Organization types.** The five type words match the `organization_type` enum exactly.
  - **"Unknown organization" on the dev data.** Four rows show it because they belong to e2e fixture organizations removed at teardown through the `deletable_until` exemption. That is the truthful fallback; the DB test pins name resolution for a live organization.
- [x] **Each instruction was traced to the role that sees it.**
  - "Try again" goes to `/admin`, which is reachable by any card viewer.
  - "View the audit log" is shown only to `ADMIN_AUDIT` holders, and `/admin/audit` admits them.
  - "Ask a platform administrator" / "Contact a platform administrator" is actionable: an `admin` role holder assigns roles at `/admin/users`.
  - Every card's link target admits the card's key.
- [x] **Older strings were grepped.** "Manage organization branding", "operations shell", "permission to manage organization branding", "brand colour, logo and type pairing" and "Audit Log" have no remaining user-facing hits. `docs/product/functionality-map.md:36` is rewritten at ship, as planned.

The wording is truthful. **One coverage gap:** the fixed organizations-list description has no exact-text test (finding 2 below).

## Verdict

**FAIL.** Two named gaps, both small; nothing wrong with the product behaviour itself.

1. **The boundaries test does not enforce "a new tenant table is forbidden by default" (E19, DECISION-252's "Enforcement" clause).** Owner: api-developer, Batch B. I ran a mutation check in a scratch copy of HEAD, adding a reader `zz-mutant.ts` to `src/lib/admin-portal/dashboard/` that reaches `officer_terms`, a tenant table:

   | Form | Result |
   |---|---|
   | `import { officerTerms } from "@/lib/db/domain/officers"` plus `sql\`… from officer_terms\`` | **caught** (2 tests red) |
   | `import { officerTerms } from "@/lib/db/domain"` (the barrel) plus `.from(officerTerms)` | **not caught**, 11/11 green |
   | `sql\`… from organizations o, officer_terms t …\`` (comma join) | **not caught** |
   | `sql\`… from "officer_terms"\`` (quoted identifier) | **not caught** |
   | `import * as domain from "@/lib/db/domain/officers"` plus `.from(domain.officerTerms)` | **not caught** |

   The causes are in `src/lib/admin-portal/dashboard/boundaries.test.ts`:
   - `:114` matches only `{…}` imports from `@/lib/db/schema` or `@/lib/db/domain/<file>`. It misses the barrel `@/lib/db/domain` and `import * as`.
   - `:152` (`mod === "db" && rest.startsWith("db/")`) then waves the barrel and namespace forms through the module allow-list.
   - `:129` captures only the first identifier after `from`, and only unquoted ones.

   The test checks the specific idiom the readers use today, not the property the design promises. Fix:
   - Allow `@/lib/db` exactly; anything under `@/lib/db/` must go through the table-name check.
   - Treat any namespace import from `@/lib/db/**` as an offender.
   - Scan comma-separated `from` lists and quoted identifiers, or reject them outright.
   - Add each of the four forms to "the scan is not vacuous" as a synthetic offender.

2. **The fixed organizations-list description has no exact-text test that fails on the old text.** Owner: ux-developer, the `e0df3d3` scope. The new description is at `src/app/(admin)/admin/organizations/page.tsx:150` ("Find an organization, see how it is set up, and open it to manage its administrators, brand, public site and domains."). It renders only for `ADMIN_ORGANIZATIONS` holders. `forbidden.test.tsx` exercises only the non-holder branch, so nothing fails if the old "brand colour … abusive tenant's brand is neutralised" text came back. Add a holder-branch assertion: the new string is present and `/brand colour|neutralis|abusive tenant/` is absent.
   - **Recommended, not a gate:** the new 2FA truncation note at `src/app/(admin)/admin/2fa/page.tsx:162` also has no render test. The DB test pins the `total` semantics behind it.

Everything else required is green and can stand once those two land: typecheck, lint, all eight tripwires, build, unit, DB scope, 420/420 chromium e2e including the R9 MFA login set, 404 status, 360px browser pass, failing-first on the three fix commits, and EXPLAIN. On re-verification QA re-runs the boundaries mutation set, the two touched test files and plain `npm test`, and keeps everything else from this run unless the fix touches other files.

**Not FAILs, carried forward:**
- Non-UUID `[id]` 500s on users, tickets and what's-new. Pre-existing and identical on `origin/main`; recommend a TODO line.
- E30: `/admin/docs` overflows by 153px at 360px. Pre-existing; Increment 4.
- E27: the plan noted above; keep the planned TODO.
- E28: only partly confirmed (no long organization name in the data).
- The support-operator e2e fixture gap is deliberate in the design.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete. Typecheck, lint, check (8/8), build, unit (581 files), DB scope (76 files / 811, 0 skipped), chromium e2e 420/420 (flags reset), R9 MFA set green, 404s, 360px browser pass, E27 EXPLAIN, failing-first on 3 fix commits all green. Two named gaps: the boundaries allow-list misses 4 mutation forms; the org-list description has no exact-text test. | FAIL | 2026-10-25 |

## Handoff

**Next agent: the Phase 4 implementers.**
- **api-developer:** finding 1, harden `src/lib/admin-portal/dashboard/boundaries.test.ts` at `:114`, `:129` and `:152`, with the four synthetic offenders added.
- **ux-developer:** finding 2, a holder-branch exact-text test for `src/app/(admin)/admin/organizations/page.tsx:150`.

Neither touches product code or the design, so there is no Phase 3 escalation. Then back to QA for a scoped re-run.

Evidence files:
- Logs: `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/logs/`
- Screenshots: `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/shots/` (`dash-360.png`, `menu-open-360.png`, `orgs-360.png`, `docs-360.png`, `dash-1280.png`)
- Mutation copy: `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/mut`

Worktree git status is as I found it: only the orchestrator's `docs/work-log/2026-10-25-platform-admin-redesign-inc3.md` modification. Port 3530 is free.

---

# Phase 4 — loop-back 1 (full-stack-developer, after Phase 5 FAIL)

**Date:** 2026-10-25. Test-only; no product code, design or copy changed. Commits `b7b0d7f` (finding 1) and `d1ae359` (finding 2), on `pipeline/platform-admin-redesign`.

## Finding 1 — boundaries scan (`b7b0d7f`)

`src/lib/admin-portal/dashboard/boundaries.test.ts`:
- `@/lib/db` is allowed exactly and carries only `getPlatformDb`. Anything under `@/lib/db/` must be `@/lib/db/schema`, the `@/lib/db/domain` barrel or a file under it, and name only allow-listed tables (`dbImportOffenders`). Namespace, default, re-export (`export *`), side-effect and dynamic `import()` forms are offenders, because the names behind them cannot be read. Imports are found in either quote style and across line breaks. The old `"db" && startsWith("db/")` wave-through in `moduleAllowed` is gone, so `@/lib/db/errors` and similar are now rejected too (no reader uses them).
- `sqlTables` reads a whole comma-separated `from` list (with `AS` aliases), unquotes quoted identifiers (also as escaped inside a JS string), keeps the table of a schema-qualified name, and reports an interpolated `${...}` table as `${}`. Import statements are removed before the scan so `from "@/lib/db"` is not read as a quoted table.
- The "scan is not vacuous" block gained a composite `offenders(code)` and 12 synthetic offenders: QA's four forms (barrel plus `.from(officerTerms)`, comma join, quoted identifier, namespace import) and eight more (single-quoted multi-line barrel, dynamic import, `export *`, escaped schema-qualified quoted identifier, schema-qualified table, interpolated table, comma join with `AS` and loose spacing, a table named only on a `join`). Each must be reported for the tenant table or db module itself, not by accident of another rule. A positive control confirms the real idioms (`getPlatformDb`, schema table import, `left join audit_events`) report nothing.

**Failing-first.**
- The four QA forms were added first, against the unchanged scan: 4 failed, 12 passed.
- A real mutant reader `zz-mutant.ts` in the directory (barrel import plus `.from(officerTerms)`): old test file 11/11 green; new test file 1 failed (`imports from @/lib/db/** name only allow-listed tables`). The mutant was deleted afterwards.
- The real readers pass the new scan (24/24).

## Finding 2 — holder-branch copy and the 2FA note (`d1ae359`)

- New `src/app/(admin)/admin/organizations/page.test.tsx`: renders the list for an `ADMIN_ORGANIZATIONS` holder, asserts the exact description and that `/brand colour|neutralis|abusive tenant/i` is absent. **Failing-first:** with the pre-`e0df3d3` text restored in `page.tsx` it fails ("Unable to find an element with the text: /^Find an organization,/"); `page.tsx` was restored byte-for-byte afterwards and is untouched in the commit.
- New `src/app/(admin)/admin/2fa/page.test.tsx` (recommended item): "Showing the first 2 of 7 accounts." appears when the cap hides accounts; absent when every account is listed; empty list shows "Nobody is required without being enrolled." and no cap note. This note is existing behaviour, so these pass on first write (no failing-first applies).

## Gates (run in the worktree)

`npm run typecheck` PASS · `npm run lint` PASS (`--max-warnings=0`) · `npm run check` PASS (8/8) · plain `npm test` 583 files passed / 80 skipped, 8,764 tests passed / 2,458 skipped.

## Handoff

Next: qa (scoped re-run per its Verdict: the boundaries mutation set, the three touched test files, plain `npm test`; everything else stands). No schema, env var, `FEATURES` entry or flag change.

---

# Phase 6 — Shipped vs Intent (analyst)

Pending.

## Operator rulings on Increment 1 Phase 3 (2026-10-25)

- **S2 / Question 1: yes** — the create-form `HydrationGate` ships now as a standalone bug-fix pipeline (`2026-10-25-create-org-hydration`, carries F275), not inside Increment 1.
- **Question 2: keep the Two-factor card** — count only, linking to `/admin/2fa`, recorded as part of the existing 2FA exception (DECISION-252).
- The tech-lead's other defaults (version line in nav foot, skip link, single-item Content group, `/home` Admin card title) stand.

---

# Phase 5 — run 2 (qa)

**Date:** 2026-10-25
**Verified by:** qa
**HEAD:** `b0308d6`, branch `pipeline/platform-admin-redesign`, worktree `/Users/cshenso/git/presby-platform/presby-padmin`

The loop-back closed every form I named in run 1 and finding 2 is fixed, but I am returning **FAIL** again. Three new forms I tried in the same class still get a tenant table past the boundaries scan, and all three compile. One of them needs no import and no SQL text at all.

**Scope of this run:**
- Typecheck, lint, `npm run check` and plain `npm test`, all in full.
- The three touched test files.
- A mutation set against the new boundaries scan, in a scratch copy.
- Failing-first for finding 2, in a scratch copy.

**What carries over from run 1.** `git diff --stat fa742f7..HEAD` touches only:
- `src/lib/admin-portal/dashboard/boundaries.test.ts`
- `src/app/(admin)/admin/organizations/page.test.tsx` (new)
- `src/app/(admin)/admin/2fa/page.test.tsx` (new)
- `docs/work-log/2026-10-25-platform-admin-redesign-inc1.md`

No source, config, fixture or e2e file changed. So these run 1 results stand and were not re-run: build, the DB-backed scope (76 files / 811 tests), chromium e2e 420/420 including the MFA login set, the 404 status checks, the 360px browser pass, E27 EXPLAIN, the feature-gate audit, copy truthfulness, and failing-first on the three earlier fix commits.

## Type Check

- `npm run typecheck`: PASS
- `npm run lint`: PASS (`--max-warnings=0`)
- `npm run check`: PASS, all eight tripwires (audit, sql-date, deps-drift, brand-scope, secrets, hydration-gate, giving-boundaries, proxy-imports)

## Unit Tests

- **Plain `npm test`:** 663 files (583 passed, 80 skipped), 11,222 tests (8,764 passed, 2,458 skipped). The 80 skipped files are the database-gated suites, the same set as run 1. The two extra files over run 1 are the new page tests.
- **Touched files, verbose:** 3 files, 28 tests, all passed, none skipped.
  - `boundaries.test.ts`: 24
  - `2fa/page.test.tsx`: 3
  - `organizations/page.test.tsx`: 1

Failures: none.

## End-to-End Tests

Not re-run; only test files changed. Run 1 stands: 420 passed, 0 failed, 0 skipped.

## Regression Tests Added

- **`src/app/(admin)/admin/organizations/page.test.tsx:44`**, "describes the page as finding and managing an organization, not as a brand-colour tool — regression for the stale list description". It pins the exact Group H string and fails if "brand colour", "neutralis" or "abusive tenant" appear.
  - **Failing-first confirmed** in a scratch copy at HEAD with `organizations/page.tsx` put back to its pre-fix version (`98d4c5d`): 1 failed ("Unable to find … /^Find an organization,/").
  - With the current `page.tsx` restored in the same copy: 1 passed.
- **`src/app/(admin)/admin/2fa/page.test.tsx`** (3 tests) pins "Showing the first {shown} of {total} accounts." It appears only when the list is capped, not when every account is listed, and not on the empty list. This is a new string rather than a fixed one, so I did not require a failing-first check.
- **`boundaries.test.ts`** now carries 12 synthetic-offender cases, plus a check that the idioms the real readers use are not reported.

## Mutation check of the boundaries scan (finding 1)

Each row adds one file, `zz-mutant.ts`, to `src/lib/admin-portal/dashboard/` in a scratch copy of HEAD, reaching the tenant table `officer_terms`. The unmodified copy passes 24/24.

| # | Form | Result |
|---|---|---|
| M1 | `import { officerTerms } from "@/lib/db/domain/officers"` plus raw `from officer_terms` | **caught** (2 red) |
| M2 | barrel `import { officerTerms } from "@/lib/db/domain"` plus `.from(officerTerms)` | **caught** (run 1: missed) |
| M3 | comma join `from organizations o, officer_terms t` | **caught** (run 1: missed) |
| M4 | quoted `from "officer_terms"` | **caught** (run 1: missed) |
| M5 | `import * as domain from "@/lib/db/domain/officers"` | **caught** (run 1: missed) |
| M9 (new) | `SELECT COUNT(*)\n FROM\n OFFICER_TERMS` (upper case, split across lines) | **caught** |
| M10 (new) | `export { officerTerms } from "@/lib/db/domain/officers"` | **caught** |
| M11 (new) | `where exists (select 1 from officer_terms t …)` | **caught** |
| **M6** (new) | relative import `import { officerTerms } from "../../db/domain/officers"` plus `.from(officerTerms)` | **not caught**, 24/24 green |
| **M7** (new) | `getPlatformDb().query.officerTerms.findMany({ columns: { id: true } })`: no import, no SQL | **not caught**, 24/24 green |
| **M8** (new) | `getPlatformDb().select({ n: count() }).from(sql\`officer_terms\`)` | **not caught**, 24/24 green |

**The three misses compile.** I ran `tsc --noEmit` over the scratch copy with M6, M7 and M8 in place and it reported no errors. To confirm the M7 result was not a fluke, I added `query.noSuchTable` beside it: tsc rejected that line (TS2339) and accepted `query.officerTerms`.

**Why M7 works.** `src/lib/db/schema.ts:531` contains `export * from "./domain"`. `getPlatformDb()` is `drizzle(platformPool, { schema })` (`src/lib/db/index.ts:87`). So every tenant table is on the platform connection's relational query API. The same `db.query.<table>` style is already used in the codebase (`users/[id]/page.tsx:25`), so this is a normal way to write a reader, not an exotic one.

**Why the scan misses them** (`boundaries.test.ts` as of `b7b0d7f`):
- **M6:** `dbImportOffenders` and `aliasImports` only examine `@/` paths. A relative path into `src/lib/db/` is never checked.
- **M7:** nothing scans `.query.<name>`.
- **M8:** `sqlTables` needs whitespace after `from`/`join`. A `sql` fragment passed to the query builder's `.from(` has a table name with no keyword in front of it.

## Coverage on Critical Modules

Unchanged from run 1 (no source changed): `permissions.ts` 100%, `flags.ts` 100%, `two-factor.ts` 91.3% statements.

## Feature-Gate Audit

No route, page or action changed since run 1. Run 1's table stands.

## Copy Truthfulness

No user-facing string changed since run 1; run 1's result stands.
- [x] The one gap from run 1, a fixed string with no exact-text test, is now closed by `organizations/page.test.tsx:44`, which fails on the old text.

## Verdict

**FAIL: finding 1 is narrowed but still open.** The scan now catches M1–M5 and M9–M11, but not M6–M8. So "a new tenant table is forbidden by default" (E19, and the "Enforcement" line drafted for DECISION-252) is still not true inside the scanned directory.

The narrowest change that holds the property is to stop adding patterns for each new form and instead list the only forms allowed:
- **Relative imports:** allow only `./` sibling imports inside the dashboard directory. Report any relative path that leaves it.
- **Relational query API:** report `.query.` used on the platform connection in this directory, or allow only `.query.<allow-listed table>`.
- **Query-builder tables:** the first argument of `.from(` and of any `…Join(` must be an identifier imported from an allow-listed table import. Report a `sql` fragment or any other expression there.
- **Synthetic cases:** add M6, M7 and M8 to the "reports a tenant table reached through …" list.

**If tech-lead would rather not keep extending the scan,** the alternative is a written ruling: name the forms the scan cannot see as accepted `paper` in DECISION-252, beside its existing residual for readers outside the directory, and drop the "forbidden by default" wording from the enforcement claim. That is a design ruling; QA cannot accept the risk on the pipeline's behalf.

Finding 2 is **closed**. Everything else in run 1 stands. On a run 3, QA will re-run the full mutation set (M1–M11 plus any new forms), the touched files, typecheck, lint, check and plain `npm test`. Run 1 will stand again if the diff is still test-only.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification (run 2) | qa | Complete. Typecheck, lint, check 8/8, unit 583 files / 8,764 tests, touched files 28/28; finding 2 closed (failing-first confirmed); finding 1 narrowed but open: M6 relative import, M7 `getPlatformDb().query.<table>`, M8 `.from(sql\`table\`)` pass the scan, and all three compile; loop-back diff is test files and work-log only, so run 1's e2e, DB, browser and audit results stand | FAIL | 2026-10-25 |

## Handoff

**Next agent: api-developer (Phase 4, loop-back 2).** Harden `src/lib/admin-portal/dashboard/boundaries.test.ts` against M6, M7 and M8 as above, test file only. Alternatively, the orchestrator sends the question to **tech-lead** for a DECISION-252 ruling that accepts those forms as `paper`.

Evidence:
- Run 2 logs: `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/logs2/`
- Mutation copy: `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/mut2`
- Failing-first copy for finding 2: `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/ff2`

Git status in the worktree is as I found it: only the orchestrator's change to `docs/work-log/2026-10-25-platform-admin-redesign-inc3.md`.

---

# Phase 4 — loop-back 2 (api-developer, after Phase 5 run 2 FAIL)

**Date:** 2026-10-25. Test-only; no product code, design or copy changed. Commit `b8d33c4` on `pipeline/platform-admin-redesign`.

**Orchestrator ruling:** stop adding deny patterns. `src/lib/admin-portal/dashboard/boundaries.test.ts` becomes an allow-only scan of how a reader touches the database, for every non-test file in the directory.

## What the scan allows now (and reports everything else)

| Rule | Allowed | Reported as |
|---|---|---|
| Relative imports (`moduleSpecOffenders`) | only a `./name` sibling | `relative import <spec>` (any path leaving the directory, any `..`, including dynamic `require`/`import`) |
| Bare modules (same function) | `server-only`, `drizzle-orm` | `bare module <spec>` (a driver, a pool, `drizzle-orm/neon-serverless`, ...) |
| `@/` imports | the existing module and table allow-lists | unchanged |
| Relational API (`queryApiAccess`) | none | `.query access` (dot, optional chain, literal bracket key) |
| Query-builder tables (`builderTableOffenders`) | `.from(x)`, `.xxxJoin(x, ...)`, `.join(x)` where `x` is an identifier bound directly by a named import of an allow-listed table from `@/lib/db/schema` or `@/lib/db/domain` (an `as` alias of such an import counts) | `builder table argument .from(...)`: a `sql` fragment, member expression, call, local alias, anything else. `sql.join(` is exempt (fragment list, not a table position) |
| Db handle (`dbHandleOffenders`) | `getPlatformDb` from `@/lib/db`, nothing else | `db handle drizzle(` / `neon(` / `new Pool(` / `new Client(` |
| Raw `sql` text | the existing from/join table-list check | unchanged |

The new rules are in the composite `offenders(code)` and each has its own per-file test over the real readers. The real readers use `getPlatformDb().execute(sql\`...\`)` only, so they pass all four new rules unchanged.

## Synthetic offenders and failing-first

Thirteen new cases in the "scan is not vacuous" block, each asserting the rule's label (so none is caught by accident of another rule):
- **QA's M6, M7, M8:** relative import `"../../db/domain/officers"` plus `.from(officerTerms)`; `getPlatformDb().query.officerTerms.findMany(...)` (no import, no SQL); `.from(sql\`officer_terms\`)`.
- **Ten more:** a `sql` fragment as a joined table (`.leftJoin(sql\`...\`)`); a local alias of an allowed table (`const t = pick() ?? organizations; .from(t)`); a member expression as the builder's table; bracket access `["query"]`; optional-chained `?.query`; a dynamic relative `require("../../db/...")`; `"./../read-card"` (climbs out and back in, looks like a sibling); a second connection built from `@neondatabase/serverless`; a `drizzle(` handle imported from `drizzle-orm/neon-serverless`; a bare `drizzle(` call with no import in view.
- **Positive control kept and extended:** the real idioms (`getPlatformDb`, schema table import, `left join audit_events`, `sql.join(`) plus an allowed query-builder use (`.from(organizations).leftJoin(events, ...)` with an `as`-aliased table import, a `./` sibling and `server-only`) report nothing.

**Failing-first.**
- The 13 cases were added first against the unchanged scan: **13 failed, 24 passed.**
- Then a real `zz-mutant.ts` in the directory carrying M6, M7 and M8 (`tsc --noEmit` clean, so all three compile): against the old scan, **every per-directory test was green** (only the 13 synthetic cases red). After the allow-only scan, the new per-file tests failed on it with `relative import ../../db/domain/officers`, `.query access`, and two `builder table argument` lines (`.from(officerTerms)` and `.from(sql\`officer_terms\`)`). The mutant was deleted afterwards; the real readers pass 41/41.

## Gates (run in the worktree)

`npm run typecheck` PASS · `npm run lint` PASS · `npm run check` PASS (8/8) · plain `npm test` 583 files passed / 80 skipped, 8,781 tests passed / 2,458 skipped (17 new tests over run 2).

## Residual for DECISION-252 (draft sentence, for the orchestrator to place at integration)

> The boundaries scan is a source-text scan, so a reader that reaches a tenant table by a route that never appears as text in the scanned directory is not seen: a computed property access (`db[key]`), a table value produced elsewhere, or a helper module outside the directory (including any allow-listed `@/lib/*` module) that itself reads a tenant table; this residual is `paper`, controlled by review and the retrospective, beside the existing residual for readers outside the directory.

The same sentence's short form is in the test file header.

## Handoff

Next: qa (run 3: the full mutation set M1–M11 plus the new forms, the touched file, typecheck, lint, check, plain `npm test`; run 1 and run 2 results stand if the diff stays test-only). No schema, env var, `FEATURES` entry or flag change.

---

# Phase 5 — run 3 (qa)

**Date:** 2026-10-25
**Verified by:** qa
**HEAD:** `1c1819f`, branch `pipeline/platform-admin-redesign`

The allow-only rewrite holds: every earlier form (M1–M11) is still caught, and so are the new import, query-builder and handle shapes I tried. The verdict is still **FAIL**, because I found four new SQL forms that read a tenant table and pass the scan, and they are not the residual the orchestrator ruled on.

**Scope of this run:**
- Typecheck, lint, `npm run check` and plain `npm test`, all in full.
- The one touched test file.
- The mutation set M1–M11 plus eleven new evasions, in a scratch copy of HEAD.
- A Postgres syntax check of the forms that slipped through: plain `EXPLAIN` (no ANALYZE) on the pipeline branch.

**What carries over from runs 1 and 2.** `git diff --stat b0308d6..HEAD` touches only:
- `src/lib/admin-portal/dashboard/boundaries.test.ts`
- `docs/work-log/2026-10-25-platform-admin-redesign-inc1.md`

No source, config, fixture or e2e file changed. So these earlier results stand and were not re-run: build, the DB-backed scope, chromium e2e 420/420 including the MFA login set, the 404 status checks, the 360px browser pass, E27 EXPLAIN, the feature-gate audit, copy truthfulness, all failing-first checks, and run 2's page tests.

## Type Check

- `npm run typecheck`: PASS
- `npm run lint`: PASS (`--max-warnings=0`)
- `npm run check`: PASS, 8/8 tripwires

## Unit Tests

- **Plain `npm test`:** 663 files (583 passed, 80 skipped), 11,239 tests (8,781 passed, 2,458 skipped). The 80 skipped files are the same database-gated set as before. The 17 new tests match loop-back 2's count.
- **`boundaries.test.ts` on its own:** 41/41 passed, nothing skipped.

Failures: none.

## End-to-End Tests

Not re-run (test-only diff). Run 1 stands: 420 passed, 0 failed, 0 skipped.

## Regression Tests Added

`boundaries.test.ts` gains 13 synthetic-offender cases. Each asserts the label of the rule that should report it, plus a positive control for the idioms the real readers use. Loop-back 2 reports watching them fail first against the old scan. My mutation results below agree with that.

## Mutation check (scratch copy of HEAD)

Each row puts one `zz-mutant.ts` into `src/lib/admin-portal/dashboard/` and runs `boundaries.test.ts`. The unmodified copy passes 41/41. I typechecked every form that passed the scan (`tsc --noEmit`, no errors), and ran each slipped SQL form through `EXPLAIN` on the pipeline branch: Postgres plans `Seq Scan on officer_terms` for every one.

**Earlier forms, all still caught:**

| # | Form | Result (rule that fired) |
|---|---|---|
| M1 | subpath table import plus raw `from officer_terms` | caught (import rule, raw-SQL rule) |
| M2 | barrel import plus `.from(officerTerms)` | caught (import rule, builder-table rule) |
| M3 | comma join | caught (raw SQL) |
| M4 | quoted identifier | caught (raw SQL) |
| M5 | namespace import | caught (import rule, builder-table rule) |
| M6 | `../../db/domain/officers` | caught (sibling-import rule, builder-table rule) |
| M7 | `getPlatformDb().query.officerTerms` | caught (relational-API rule) |
| M8 | `.from(sql\`officer_terms\`)` | caught (builder-table rule) |
| M9 | upper case across line breaks | caught (raw SQL) |
| M10 | named re-export | caught (import rule) |
| M11 | `exists (select … from officer_terms …)` | caught (raw SQL) |

**New evasions, run 3:**

| # | Form | Result |
|---|---|---|
| N01 | computed key built with `[…].join('')`, then `db[k][t].findMany()` | caught, **but only by accident**: the builder rule flags the array's `.join('')` |
| N01b | the same computed key built with `+`, then `(getPlatformDb() as any)[k][t].findMany()` | **passes** |
| N02 | a CTE named `officer_terms` in one statement makes the real table pass in another statement in the same file (`with officer_terms as (select 1 as id) …`, then `select count(*) from officer_terms`) | **passes** |
| N03 | template-literal table name: `sql.raw(\`select … from ${part}_terms\`)` | caught (`${}`) |
| N04 | string concatenation into `sql.raw('select count(*) from ' + table)`, where `table = 'officer_' + 'terms'` | **passes** |
| N05 | SQL comment between keyword and table: `from/**/officer_terms` | **passes** |
| N06 | parenthesised join: `from (officer_terms t cross join organizations o)` | **passes** |
| N07 | Postgres `TABLE` command: `table officer_terms` | **passes** |
| N08 | template-literal bracket: ``getPlatformDb()[`query`].officerTerms`` | caught (relational-API rule) |
| N09 | `getPlatformDb().$client.query('select … from officer_terms')` | caught (raw SQL, relational-API rule) |
| N10 | `${sql.identifier('officer_terms')}` | caught (`${}`) |

### Which misses are the documented residual, and which are new

The residual the orchestrator ruled on (draft for DECISION-252) covers "a route that never appears as text in the scanned directory: a computed property access (`db[key]`), a table value produced elsewhere, or a helper module outside the directory."

**Inside the residual:**
- **N01b** is exactly the computed property access the residual names.
- **N04** is close enough to count. The table name is built at runtime and never appears whole in the source. But it is a computed table *string* in the same file, not a property access and not a value "produced elsewhere". The sentence should say so; see the wording note under Verdict. The scan could also close it cheaply by allowing `sql.raw(` only with a string literal.
- **N01** confirms the residual is real: the scan does not handle computed access on purpose, and that case was caught only because the code happened to call `.join`.

**A new class, outside the residual: N02, N05, N06, N07.** In all four the tenant table's name appears verbatim as SQL text in the scanned directory, and the raw-SQL check sees the text but does not recognise the position:
- **N02:** the set of CTE names is collected across the whole file, so declaring a CTE with a tenant table's name in any statement excuses that table everywhere in the file (`boundaries.test.ts`, `sqlTables`, the two `ctes.add` loops).
- **N05:** `stripComments` removes `/* … */` before the scan, including inside SQL template strings. `from/**/officer_terms` becomes `fromofficer_terms`, which no longer matches `\b(from|join)\s+`. Postgres reads the original text as `from officer_terms`.
- **N06:** after `from`, a `(` is assumed to start a subquery and the scan stops. A parenthesised join list is valid SQL, and its first table is never read.
- **N07:** only `from` and `join` start a table reference in the scan. Postgres's `TABLE <name>` reads a whole table without either keyword.

The raw-SQL check is the one part of the scan that still lists the shapes it forbids instead of the shapes it allows. That is why each new shape so far has needed its own fix.

## Coverage on Critical Modules

Unchanged (no source changed): `permissions.ts` 100%, `flags.ts` 100%, `two-factor.ts` 91.3% statements.

## Feature-Gate Audit

No route, page or action changed. Run 1's table stands.

## Copy Truthfulness

No user-facing string changed. Run 1 and run 2 stand.

## Verdict

**FAIL. Finding 1 is narrowed to the raw-SQL check only.** Every form from runs 1 and 2 is closed, and so are the new import, relational-API, query-builder and handle shapes. Four valid forms (N02, N05, N06, N07) still read a tenant table through a name written verbatim in the scanned directory. They are not covered by the residual as worded, so "forbidden by default" is still not true for raw SQL.

**Suggested fix (test file only).** Make the raw-SQL rule allow-only over a closed list of names instead of parsing table positions:
- Build the set of every real table name from the `pgTable("…")` declarations in `src/lib/db/schema.ts` and `src/lib/db/domain/**`.
- In each reader file, read the unstripped text of every `sql\`…\``, `sql.raw(…)` and string literal passed to an `execute` or `query` call, and split it into identifier tokens. Unquote quoted identifiers and treat SQL comments as whitespace.
- Report any token that is a real table name but not on the allow-list, whatever its position.
- This fails closed. A column that happens to share a tenant table's name would be reported too; that cost is acceptable.
- It closes N02, N05, N06 and N07 without new position rules, and stays correct if future SQL uses shapes nobody has tried yet.
- Separately, allowing `sql.raw(` only with a string literal would close N04.
- Add N02, N04, N05, N06 and N07 as synthetic cases.

**Alternative (an operator or tech-lead ruling, not mine).** Widen the DECISION-252 residual to name these forms explicitly: "SQL whose table reference the scan does not parse (a comment between keyword and table, a parenthesised join, the `TABLE` command, a CTE name reused across statements)." This also needs the wording fix below.

**Wording note for the residual sentence in either case.** As drafted, "never appears as text in the scanned directory" does not describe N04, and it denies N02, N05, N06 and N07, whose table names do appear as text. Under the copy-truthfulness rule, a decision record must not deny a residual the evidence shows. Either fix the scan or change the sentence.

On a run 4, QA will re-run M1–M11, N01–N10 and new forms of its own, plus the touched file and the four gates. Earlier results will stand again if the diff is still test-only.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification (run 3) | qa | Complete. Typecheck, lint, check 8/8, unit 583 files / 8,781 tests, boundaries 41/41; M1–M11 all caught; of 11 new evasions, N01b and N04 pass as the computed-name residual and N02 (file-wide CTE name), N05 (`/**/` comment), N06 (parenthesised join) and N07 (`TABLE` command) pass as a new class outside the documented residual (all compile; Postgres plans each as a scan of the tenant table); loop-back diff is test file and work-log only, so runs 1 and 2 stand | FAIL | 2026-10-25 |

## Handoff

**Next agent: api-developer (Phase 4, loop-back 3).** Make the raw-SQL rule in `src/lib/admin-portal/dashboard/boundaries.test.ts` allow-only over the closed set of table names, and add N02, N04, N05, N06 and N07. Test file only.

The other route: the orchestrator takes the new forms to **tech-lead** (or the operator) for a widened DECISION-252 residual, and then the sentence must match what the scan actually misses.

Evidence:
- Run 3 logs: `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/logs3/`
- Mutation cases (M01–M11, N01–N10, N01b): `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/mut3/cases/`
- Postgres syntax check script: `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/syntax.sql`

Git status in the worktree is as I found it: only the orchestrator's change to `docs/work-log/2026-10-25-platform-admin-redesign-inc3.md`.

---

# Phase 4 — loop-back 3 (api-developer, after Phase 5 run 3 FAIL)

**Date:** 2026-10-25. Test-only; no product code, design or copy changed. Commit `c4eee98` on `pipeline/platform-admin-redesign`.

**Orchestrator ruling:** implement QA's suggested fix. The raw-SQL rule stops parsing table positions and becomes allow-only over a closed set of real table names.

## What changed in `src/lib/admin-portal/dashboard/boundaries.test.ts`

- **Closed name set (`realTableNames`).** Every `pgTable("…")` in `src/lib/db/schema.ts` and `src/lib/db/domain/**` (test files excluded), read at test time. `FORBIDDEN_TABLES` is that set minus the allow-list. The non-vacuity block asserts the set has more than 80 names, contains `officer_terms`, `people`, `memberships` and `roll_actions`, and is a superset of `ALLOWED_TABLES_SQL` (so a typo in the allow-list fails).
- **`scanSource` / `closedNameOffenders`.** A small scanner (comments, strings, templates with nested `${}`, regex literals; an unterminated quote is code, so JSX text cannot desync it) returns the UNSTRIPPED text of every string and template literal. Every identifier token in them (lower-cased; quotes, schema prefix, SQL comments, parentheses and escaping are all just separators) that is in `FORBIDDEN_TABLES` is reported as `table name <x>`, in any position. This closes N02, N05, N06, N07 with no position rule, and the CTE-name exemption no longer applies to it. The old from/join check stays in addition (it still catches names outside the pgTable set, such as `${}` and catalogue tables).
- **Scope note, wider than the ruling.** The ruling named `sql` templates, `sql.raw` and strings passed to `execute`/`query`. I scan EVERY string and template literal in a reader instead, because an alias (`import { sql as s }`) or a variable later handed to `execute` would escape a context list. The one exemption is the first argument of `readCard(`: `readCard("accounts", …)` is a card key, and `accounts` is also the NextAuth table, so it was the one false positive in the real readers. A `readCard("officer_terms", …)` key would be harmless too.
- **`rawCallOffenders`.** `.raw` is allowed only as `.raw("one string literal")` (a no-interpolation template counts). A concatenation, an interpolated template, `const r = sql.raw` and `sql["raw"]` are reported as `sql.raw argument …`. Closes N04.
- Both are in the composite `offenders(code)` and have per-file tests over the real readers, which pass unchanged.

## Synthetic cases and failing-first

Eleven new cases in the "scan is not vacuous" block, each asserting its rule's label: N02, N04, N04b (interpolated template), N04c (`sql.raw` taken as a value), N05, N06, N07, a table inside a plain string passed to `execute()`, an escaped upper-case quoted identifier, a `'officer_terms'::regclass` cast, and an aliased `sql` tag. A scanner unit check (comments and regex literals skipped, SQL comment text kept, `readCard` key exempt) is in the same block.

- **Cases first, old scan:** all eleven failed (41 passed). I also printed the old scan's output: N02, N04, N04c, N05, N06, N07 and the regclass cast reported **nothing at all**; the rest were reported only under a different label.
- **Real mutant:** `zz-mutant.ts` carrying N02 (two statements), N04, N05, N06, N07 compiles (`tsc --noEmit` clean). The previous test file (`git show HEAD:`) ran **41/41 green** against it. The new file fails two per-file tests on it: six `table name officer_terms` lines and one `sql.raw argument is not a single string literal`. Mutant deleted; real readers pass 54/54.

## Gates (run in the worktree)

`npm run typecheck` PASS · `npm run lint` PASS · `npm run check` PASS (8/8) · plain `npm test` 583 files passed / 80 skipped, 8,794 tests passed / 2,458 skipped (13 new tests over run 3).

## Residual for DECISION-252 (replaces the loop-back 2 draft; true against run 3 and this fix)

> The boundaries scan reads source text and allows only a closed set of table names in the literals of a dashboard reader, so it does not see a computed property access (`db[key]`), a table name assembled at runtime rather than written in a literal (JavaScript concatenation into a variable that reaches `execute`, or SQL-side assembly such as `format()`, `||` on string pieces or a `U&"…"` escape), or a helper module outside the directory (including any allow-listed `@/lib/*` module) that itself reads a tenant table; this residual is `paper`, controlled by review and the retrospective, beside the existing residual for readers outside the directory.

It no longer claims that a name written verbatim as SQL text is unseen: those are reported wherever they sit, and a column sharing a tenant table's name is reported too (fails closed, accepted). The same residual is in the test file header.

## Handoff

Next: qa (run 4: M1–M11, N01–N10 including N01b, and new forms of its own; the touched file; the four gates). No schema, env var, `FEATURES` entry or flag change.
