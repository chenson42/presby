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
| 4 — Implementation | api-developer (Batch B), ux-developer (Batches A and C) | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
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

Pending.

## Files Created

## Files Modified

## Schema Changes

none

## Audit Events

none (no mutation in this increment)

## Implementer Notes

---

# Phase 5 — Verification (qa)

Pending. QA must run the R9 regression set (`admin-login`, `totp-full-login`, `role-boundaries`, `session-claim-integrity`, `totp-callback-bypass`) against a real dev server on **:3530** with the MFA-enrolled seeded user; a deferred or skipped e2e is `BLOCKED`, not `PASS`. Also required: the Copy Truthfulness checklist against the Copy table above, the Feature-Gate Audit for `/admin`, `/admin/docs` and the organizations pages, E27 `EXPLAIN`, and the 360px browser checks.

---

# Phase 6 — Shipped vs Intent (analyst)

Pending.

## Operator rulings on Increment 1 Phase 3 (2026-10-25)

- **S2 / Question 1: yes** — the create-form `HydrationGate` ships now as a standalone bug-fix pipeline (`2026-10-25-create-org-hydration`, carries F275), not inside Increment 1.
- **Question 2: keep the Two-factor card** — count only, linking to `/admin/2fa`, recorded as part of the existing 2FA exception (DECISION-252).
- The tech-lead's other defaults (version line in nav foot, skip link, single-item Content group, `/home` Admin card title) stand.
