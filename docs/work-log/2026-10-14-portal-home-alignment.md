# Portal Home Alignment with fpcw-directory — Work Log

> **Slug:** `2026-10-14-portal-home-alignment`
> **Surface:** `(org)` member portal home — `/o/<slug>` under `org_portal.home_v2`
> **Permission(s):** existing — `events.view` (introduced by `2026-10-14-member-calendar`) for the Church Events card; `directory.view` for find-a-person (already re-checked); groups read for the "Yours" groups pills (tech-lead confirms which key)
> **Flag(s):** existing `org_portal.home_v2`; the events card additionally requires `org_portal.calendar` (from the calendar pipeline). No new flag expected.
> **Estimated complexity:** medium
> **Pipeline mode:** Full. **Phase 4 is blocked until `2026-10-14-member-calendar` merges** — the Church Events card consumes its `events.view` read path. Phases 1–3 may run in parallel with it (judgment agents are read-only, Rule 16).
> **Pre-assigned numbers (Rule 16, orchestrator, 2026-10-14):** no migration expected; `DECISION-162`; `F136`–`F137` reserved.
> **Worktree / branch:** shares `../presby-calendar` / `pipeline/member-calendar` until the calendar merges; Phase 4 then runs on a fresh branch off `main` (orchestrator decides at that point; a second Neon branch if it needs one).

---

## Source and intent (orchestrator, 2026-10-14)

The operator asked: *"align the portal home page with the ../../fpcw-directory portal home page"*. Survey of both, 2026-10-14:

**fpcw-directory's home (`src/app/(dashboard)/page.tsx`, design doc `docs/modules/portal/home.md`)**, top to bottom, one vertical stack, large type for an older audience:
1. Welcome zone — church icon, time-of-day greeting with a sun/moon icon, "Need help getting around?" link to `/instructions`.
2. Find a Person — full-width search card; one match jumps to the person, several go to the directory search, none shows a "Browse the directory" link.
3. Main row, side by side at `sm+` (`src/components/home/main-row.tsx`): **Yours** (My Upcoming Signups, My Household with member count, My Groups as pills; each sub-block hidden when empty, whole card hidden when all are) and **Church Events** (next upcoming events, one row per recurring series, audience-filtered, a "See more events" link). The events list is trimmed client-side to the Yours card's measured height, never below 3.
4. Tools & Serving tile grid — icon + label, optional red count badge; 2 columns on phones, 3 at `sm`, 4 at `lg`; each tile's visibility copies the destination page's real gate (missing permission hides the tile, nothing is greyed).
5. Call-in procedures card (on-call rotation; presby has no equivalent).

**presby's `home_v2` home today (`src/app/(org)/o/[slug]/page.tsx`, `src/components/org-portal/`, `src/lib/org-portal/tiles.ts`):** GreetingBand (left-border card, h1 greeting), FindPersonForm, YoursZone (household only), DomainTileSections (one section per domain, `TileGrid` at `grid-cols-1 sm:grid-cols-2`, tiles filtered by category / org type / flag — **never by permission**, deliberately, DECISION-003: the destination shows its own forbidden state), FeedbackPromptCard. No events widget.

**The gap, and therefore the candidate scope** (analyst refines; operator confirms at Phase 1):
- Add the **Church Events** card (next N upcoming, one per series, `events.view`, link to the member calendar). Depends on the calendar pipeline.
- Extend **Yours** with the member's **groups** as pills (groups and `group_memberships` exist; derived Session/Diaconate groups are groups too — decide whether they show). Signups are out (no RSVP feature).
- Put Yours and Church Events **side by side** at `sm+` (the main row), stacked below.
- Tile grid density: 2 / 3 / 4 columns versus today's 1 / 2. `docs/ui-standards.md` governs; fpcw-directory's 48px targets are compatible.
- Tile **count badges** — fpcw-directory's are approval queues and recent applicants; presby has no equivalent queues yet except support tickets. Likely a hook, not a badge, in this pipeline.
- Tile visibility by permission: fpcw-directory hides, presby deliberately does not (DECISION-003 / `tiles.ts:8-18`). **Not changing** unless the analyst makes a case and the architect agrees; record the decision either way.
- Welcome-zone help link: presby has no `/instructions` page. Out unless cheap.

**Out of scope:** call-in procedures, signups, anything in `(admin)` or `(public)`, the per-org tile labels.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-14 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-10-14 |
| 3 — Technical design | tech-lead | Complete (contract confirmed by the calendar's Phase 3, relayed below) | Design complete; implementer named | 2026-10-14 |
| 4 — Implementation | full-stack-developer | Complete (Part B; Part A shipped separately as PR #28, v0.31.1) | — | 2026-10-15 |
| 5 — Verification | qa | Complete | PASS | 2026-10-15 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES (N1–N2 filed; N3 already staged) | 2026-10-15 |

## Pipeline closed (orchestrator, 2026-10-15)

Phase 6 SHIP WITH NOTES. Close-out in one `docs:` commit: this section; `docs/TODO.md` (Phase 3's six lines + N1, N2 + the Done line; the owed what's-new line records the fold into the calendar's D8 entry per Rule 13); DECISION-162 in `docs/decisions.md` (architect's text + the Phase 3 household/main-row paragraph); F136 in `docs/schema-design-2.md` reworded now both legs are fixed; the functionality-map "Portal home" and org-portal lines (stamp 0.33.0); `docs/release-notes/v0.33.md` (0.33.0) with the 0.32 → 0.33 nav link; `package.json` 0.33.0. `docs/architecture.md` unchanged (Rule 15). Next: `/pre-push`, push, PR, `/merge-pr` (operator pre-authorized merging), delete Neon branch `br-late-meadow-axpro6c7`.

---

---

# Phase 1 — Functional Refinement (analyst)

*Recorded verbatim by the orchestrator, 2026-10-14.*

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> Most of fpcw-directory's home is already in presby, and in places presby's is stronger. The real delta is two missing widgets (Church Events and My Groups), a layout wrapper that puts them side by side, and three small correctness fixes to widgets that already exist. Size it as medium-small: no migration, no new permission, no new flag, no new dependency, and nothing client-side beyond today's `FindPersonForm`.

Scope check against the program rule at `docs/STATE.md:542`: "Visual parity with fpcw yes, layout parity no — layout parity would cap presby's IA at the app it replaces." The cutover rule at `STATE.md:538` says anything FPCW members use is parity. Together they sort this pipeline cleanly:
- **In:** the events card, the groups pills, and fpcw's household rules, because FPCW members use them.
- **Out:** flattening the tile grid, hiding tiles, the call-in card and the help link, because those are layout or fpcw-specific.

**Already aligned, no work:**

| fpcw zone | presby today |
|---|---|
| Welcome | `greeting-band.tsx:44-53` is a stronger treatment, iterated by the operator under DECISION-104/105. |
| Find a Person | The single-match jump and the fall-through to `/directory?search=` are shipped and ratified (`2026-08-24-portal-home-directory.md:2108-2110`). |
| Household card | Exists (`yours-zone.tsx`), with the defects listed below. |
| Domain-sectioned tools | `domain-tile-sections.tsx:65-80`. |

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Authenticated member (`/o/<slug>`) | Read the greeting; type a name and Search (`find-person-form.tsx:46-69`) | per session |
| Authenticated member | Scan "Coming up" for the next few events; click one to open its detail; click "See the full calendar" | per session |
| Authenticated member | Read which groups they belong to (pills; read-only) | per session |
| Authenticated member | Click their household to open the household page | occasional |
| Authenticated member | Click a tool tile (unchanged) | per session |
| Anonymous / no-roles / admin | none. This pipeline touches only the `(org)` home. | n/a |

The fpcw verbs "Sign Up" and "See my signups" are dropped. presby has no RSVP feature.

## Flows

**Flow 1 — Land on home, both widgets populated.**
- Steps: `/launch` or deep link → `/o/<slug>` → greeting → Find a person → main row → tiles → feedback prompt.
- Main row: Yours on the left, Coming up on the right at `md+`; stacked on mobile.
- Failure: if the home-data read fails, the greeting falls back to "Welcome." and the household block drops (`page.tsx:149-173`). That behavior is kept. Each new widget fails independently.

**Flow 2 — Events card, three states.** Whichever state applies, the member can still reach the calendar from the nav or tile.
- **a. Hidden entirely** if `org_portal.calendar` is off, or if the viewer lacks `events.view`.
- **b. Card with an empty state** if both are satisfied and there are zero upcoming events. Copy: "Nothing is on the calendar right now." with a link "Open the calendar".
- **c. Card with failure copy** if the read throws (not `OrgAccessError`). Copy: "We can't load upcoming events right now. Try again in a moment." with the same link.
- `OrgAccessError` re-throws to `error.tsx`, as `page.tsx:169-171` already does.

**Flow 3 — Open an event from the card.**
- Row link goes to the calendar pipeline's member event-detail route.
- Footer link "See the full calendar" goes to `/o/<slug>/calendar`.
- Failure: the destination's own states. The card does not duplicate them.

**Flow 4 — My groups.**
- Static pills, alphabetical, wrapping.
- No groups: the block is omitted.
- No household block and no groups: the whole Yours card is omitted, as `yours-zone.tsx:24` does today.
- Read failure: the block is omitted. This is deliberate. A missing pill list makes no claim, whereas "no events" does.

**Flow 5 — Household.**
- Show only when two or more eligible members remain (see Gap 3).
- Household name links to the household page.
- Count uses the directory's own eligibility rule.

## Permissions & Flags

- **Permissions**
  - Events card: `events.view`, introduced by the calendar pipeline. The check must live inside the lib function the card calls, not on the page alone.
  - Groups pills: none. This is a self-read of the viewer's own `group_memberships` rows, the same trust model `home-data.ts:13-18` states for the household read. `withOrgContext()`'s membership re-check is the gate.
  - Household block: `directory.view` (the target page requires it).
  - Find a person: `directory.view` (see Gap 4).
- **Default roles:** nothing new from this pipeline. See Open Question 5 on `events.view`'s default binding.
- **Flags**
  - `org_portal.home_v2` gates the whole page and is the rollback lever for the groups and layout work. It is dark in production.
  - The events card adds `org_portal.calendar`.
  - No new flag. A flag per widget would be a lever nobody pulls on a page that is already dark. `org_portal.calendar` already gives the events card its own off switch.
- **Org-feature toggles:** `org_portal.calendar` is not in `ORG_FEATURE_CATALOG` (`org-features.ts:63,77` lists only two keys), so the third and fourth gating axes do not apply. The calendar pipeline should confirm that choice, because DECISION-097's gate order is flag, then category, then org toggle, then permission.

## Gaps the Request Didn't Address

### Rulings on the judgment calls

**R1. Tile visibility: keep "never permission-filter." Do not adopt fpcw's hiding.** The recommendation rests on four reasons.
1. The registry states the invariant itself (`tiles.ts:8-18`, `:36-39`): a second permission check makes two gates disagree about one grant, which is the DECISION-003 defect.
2. fpcw's hiding only works because it pairs it with "direct URL redirects silently to `/`" (`home.md:188-200`). presby's destinations render honest Forbidden states (`DirectoryForbidden` and similar). Hiding the tile would not hide the feature's existence, and it would add drift risk for no discretion benefit.
3. fpcw's own record shows predicate drift even with cheap session-claim predicates (`home.md:304`, "Two lockstep findings"). presby's checks are per-org database resolutions across role grants, derived groups, flags and toggles, so the drift risk is higher.
4. There is a principled asymmetry to record: a widget renders data, so it must hide without the read permission; a tile is a link, so the destination owns the denial. The widget rule falls out of fpcw's "no empty-section scaffolding" principle.

The cost is real. An ordinary member sees tiles like Members ("Add a person and record roll actions") that dead-end on click. Record that as accepted, with a revisit trigger: build a `requires` key per tile, a single batched permission read, and a test pinning each tile against its destination. Put it in a TODO line; it is its own pipeline.

**R2. Tile density: decline. Leave 1 column on phone and 2 at `sm+`.** There are three reasons.
- fpcw's 2/3/4 columns work because its tiles are icon plus label only. presby's carry descriptions (`tile-grid.tsx:127-129`), and several labels need them ("Per-Capita, SASR & Imports"). That is the plain-language rule at `ui-standards.md:666`.
- At 360px, two columns of description tiles leave about 165px each.
- Sections hold at most four tiles (people, governance), and with all flags on most hold one or two. Two columns gives a tidy 2×2, three gives a 3+1 orphan, four gives cramped one-row sections. The page's length comes from seven headed sections (DECISION-117) and the dev-seeded coming-soon tiles (`tiles.ts:325-331`), not from column count. `TileGrid` is also shared with `/o/<slug>/admin` and `/admin` (`tile-grid.tsx:30-50`).

Size: zero. Decision text goes in DECISION-162.

**R3. Count badges: no hook, no badge.** An unused prop is speculative. fpcw's badge is `bg-red-600`, a palette literal banned at `ui-standards.md:117`. The one real presby queue is pending roll approvals (`listPendingRollActions`, gated on `roll.approve`, `members/pending/page.tsx:25-27`). A badge for it needs its own count function with its own permission check, plus the flag and `org_portal.members_create` toggle axes. Add a TODO line; do not build it here.

**R4. Church Events card contract** (this depends on the calendar pipeline's read function).
- **Which function:** the card calls the calendar pipeline's list function. It writes no private SQL, so "what a member with `events.view` sees" has one definition. The `events.view` check lives in that function.
- **One row per series, not every occurrence.** A weekly series is up to 52 stored rows (`events.ts` header; `domain/events.ts:7-20`) and would fill the card.
  - Representative row: the earliest upcoming, non-cancelled occurrence, keyed `coalesce(parent_event_id, id)`.
  - Do not filter on `parent_event_id is null`. fpcw shipped that bug, and the whole series vanished once the first occurrence passed (`fpcw queries.ts:21-49`; `home.md:130`).
  - Add a regression test with a series whose parent has already passed.
- **Row count:** a fixed 4, rendered on the server. Make it one named constant and tune it in the browser.
- **Cancelled:** excluded from "upcoming." The calendar page shows cancellation state.
- **No audience filter.** fpcw's per-event audience targeting (`queries.ts:55-60`) has no presby counterpart; the events table carries no audience columns (`domain/events.ts:45-104`).
  - `is_public` is a public-site concern. The card does not filter on it, because members see all events.
  - The card's set must be a subset of the calendar's default set. Add a test.
- **Hidden entirely** when the flag is off or the permission is absent. The reasons:
  - The home page is the one page every member lands on and should hold no denial.
  - A member can do nothing about a missing grant, so a message only generates support questions.
  - A "coming soon" widget is noise for this audience.
  - This does not contradict presby's honest-Forbidden rule. That rule governs destinations a user chose to open, and a widget is not one.
- **Heading:** "Coming up", not fpcw's "Church Events". Org types include presbytery, synod and general assembly (`tiles.ts:152`).

**R5. Client-side height trim: do not carry it.** Five reasons.
- **Hydration and layout shift:** it renders `min(3, n)` rows in the server HTML, then re-renders after hydration (`fpcw main-row.tsx:31-43`). On the slow connections DECISION-159 measured (about 7 s to hydrate), members would see a card that visibly grows.
- **Hardcoded px constants:** `EVENT_ROW_HEIGHT_PX = 65` and `CARD_CHROME_HEIGHT_PX = 170` (`main-row.tsx:16-18`) contradict the rem-only rule (`ui-standards.md:123`).
- **Zoom and resize:** the measurement is one-shot, so 200% zoom, a larger root font or rotation make it wrong.
- **Reduced motion:** not an issue, since there is no animation.
- **Replacement:** make the whole main row a server component with a fixed row count and `items-start`. fpcw's own review took the same position (`home.md:139-165`, Alternative 2: accept unequal heights).
- **Placement:** use `md:grid-cols-2`, not fpcw's `sm`. At 640px each card is about 290px wide, which is too narrow for 16px event titles. When only one card renders, it takes the full width. fpcw's grid leaves a blank half, and presby's should not.

**R6. My Groups membership rules.**
- **Source:** `group_memberships` joined to `groups` for the viewer's own `person_id`, filtered to the current org.
  - Date-aware currency: `starts_on <= today` and (`ends_on is null` or `ends_on > today`).
  - The admin roster counts `ends_on is null` only (`groups.ts:314-338`; `endGroupMembership` accepts any date at or after `starts_on`, `:841-846`). Use the date-aware predicate on home and note the small divergence.
- **Exclude `active_membership` always.**
  - It is a baseline-grant mechanism (`drizzle/0017:1-12`, `org-provisioning.ts:183-190`).
  - A pill reading "Active Membership" on every member's home would be a status claim, in the spirit of DECISION-039's "cards carry no membership language."
- **Include Session and Board of Deacons** (derived from `session` and `diaconate`), and all managed groups. This is my default; see Open Question 2.
  - For an elder these are the most identity-relevant groups.
  - Reading is safe: the roster is materialized from `officer_terms`, and this changes no write path ("The Court Is Not a Group").
- **Privacy:** none beyond the viewer's own rows.
  - Membership is shown only to the person it belongs to, and the pill carries only the group name, not role, roster, or `meets_when`.
  - It reveals nothing about tier 2 or tier 3 data of anyone else.
  - A free-text group name could be sensitive to a bystander, but it is the viewer's own screen.
- **Pills are not links.** Every group read in `groups.ts` requires `groups.manage` (`:88`, `:106-123`), and `/o/<slug>/admin/groups` would forbid ordinary members.
  - Render static chips with no hover affordance (`ui-standards.md:664`).
  - Wrap long names; do not truncate or cap. With no destination, "+N more" would have nowhere to go.
  - A member-facing group detail page is a TODO.
- **Empty:** the block is omitted, and Yours is omitted when it has no content (rationale at `2026-08-24-portal-home-directory.md:171,403-406`). No empty-state card.

**R7. Read path: `withOrgContext()` everywhere, no `getPlatformDb()` anywhere.**
- Groups: the `groups` and `group_memberships` tables are tenant tables. The pill label is `groups.name`, so no `group_types` join and no platform-template read (cf. `groups.ts` header on B-M4).
- Events: the `events` table is a tenant table with `events_org_starts_idx`.
- Household: unchanged.
- `getPlatformDb()` is forbidden in this subtree.

### Pass 4 — Edge cases

1. **Independent failure.**
   - Postgres aborts a transaction after a failed statement, so independent widgets need separate `withOrgContext()` calls, each with its own try/catch. Adding groups or events to the `getPortalHomeData` transaction would drop the greeting on any widget failure (`page.tsx:162-173`).
   - Run them under `Promise.all`. The page awaits sequentially today.
   - Each new loader keeps the `OrgAccessError` re-throw.
2. **"Upcoming" vs wall-clock storage.**
   - `starts_at` is `timestamp` without time zone (`domain/events.ts:23-26,53`; `events.ts:26-32`) and there is no org time-zone column anywhere.
   - If the database `now()` is compared against it, an event at 7 PM local vanishes from "upcoming" hours early (UTC runs ahead of US local time).
   - The calendar pipeline needs the same answer for "today." The home card must consume that shared helper, not call `new Date()` or `now()`. This blocks Phase 3, not Phase 2.
   - Policy: an event stays listed until its day ends, so a late arrival still sees "this morning's" event. Confirm in Phase 3.
   - Formatting uses the calendar's wall-clock formatter: no `toLocale*`, no `.toISOString()`, and `check:sql-date` applies.
3. **Household count is wrong today.**
   - `home-data.ts:71-81` counts `ended_on is null` only. The household page and the households grid use `directoryEligibilityWhereSql` (`directory.ts:244-261`), which excludes deceased, merged, directory-hidden and off-roll people.
   - A widow's home therefore says "2 members" while the household page shows 1.
   - Fix by reusing the directory's own row query for the viewer's household. A third copy of the eligibility predicate is exactly what the earlier Phase 6 told the team not to add (`2026-08-24-portal-home-directory.md:383-392,2110`).
   - **Household of one:** adopt fpcw's suppression (`fpcw queries.ts:176-199`; `home.md:137`). "Your household contains only you" is noise.
   - **Behavior change:** this contradicts today's pinned test "uses singular 'member' for a household of one" (`yours-zone.test.tsx:23-32`), so it must be changed on purpose.
   - **Link target:** the household page requires `org_portal.directory` and `org_portal.directory_v2` (`households/[householdId]/page.tsx:81-82`). Link to it only when `directory_v2` is on; otherwise link to `/directory`.
4. **Find a person is not gated on `directory.view`.** `page.tsx:194` renders it unconditionally. Under the new "widgets hide without their read permission" rule, hide it too. The action already fails closed (`find-person-action.ts`). Low severity, because `directory.view` is a baseline grant, but it keeps the rule uniform. Fetch the viewer's `directory.view` and `events.view` once, in one transaction, not per widget.
5. **Greeting uses the server clock.**
   - `greeting-band.tsx:42` calls `new Date().getHours()`, and `greeting.ts:12-17` documents a server-clock tradeoff.
   - No `TZ` is pinned in `vercel.json`, `next.config.ts` or `package.json`, so on Vercel (expected to be UTC; verify in a preview) an Eastern congregation would see "Good evening" from about 1 PM.
   - This is pre-existing and out of scope, but it is the same org-local-time problem as the events card. Track it in a TODO. If the calendar pipeline produces an org-local "now," adopting it in the greeting is small. `GreetingBand` is shared with `/admin`, which has no org, so use an optional prop.
6. **2FA mid-enrolment:** enforced at the Edge on `/o/*` before the page runs. No new interaction.
7. **Audit:** read-only, so no audit event. `check:audit` is unaffected.
8. **Mobile at 360px:**
   - Cards stack; pills wrap; event rows are two lines (title, then date and time); row links are at least 44px (`ui-standards.md:660`).
   - Type floor is `text-base` for content and `text-sm` for metadata. No `text-xs`, and no fpcw palette classes (`bg-brand-700`, `text-gray-900`, `bg-red-600`). Tokens only (`:117`).
   - Verify at 360, 768 and 1280, and at 200% zoom.
9. **Loading:** `/o/[slug]` calls `notFound()`, so it must not gain a `loading.tsx` (`CLAUDE.md`, the `(org)` contract). A `Suspense` boundary below the gates is the only streaming option; the design call is Phase 3's.
10. **Hydration:** all new widgets are server components. There is no `useForm` and no client measurement. `FindPersonForm` uses `useState`, so `check:hydration-gate` does not cover it. The failure mode before hydration is a benign native submit.
11. **Existing tests to update:**
    - `yours-zone.test.tsx`.
    - `page.test.tsx`.
    - The `greeting-band` testid must stay: e2e depends on it (`e2e/admin-login.spec.ts:39`, `e2e/totp-callback-bypass.spec.ts:78`).

### Pass 5 — Adversarial

- **No user-controlled inputs.** The home page takes only `slug`. There are no `next`, `callbackUrl` or query parameters on the new widgets, so no open-redirect surface.
- **Redirect and link targets** are built server-side from `resolved.org.slug` and ids read under RLS.
- **Identity:** `personId` for the pills and the events read must come from `resolved.org.personId` (server-resolved), never from a parameter. RLS enforces tenancy only; the `withOrgContext()` membership check is what stops a request from setting another org's GUC.
- **Enumeration:** no new 404-vs-403 distinction. The widgets hide, and the existing four-way miss response is untouched.
- **Cross-org leakage:** a cross-org group row cannot appear. `group_memberships` has composite FKs to `memberships` and `groups`, and the policy is tenancy-scoped.
- **State-machine shortcuts:** none. Hitting the event detail URL directly goes through the destination's own `events.view` gate; the card does not substitute for it.
- **Self-targeting:** n/a, since nothing is mutated.
- **Input boundaries:** group and event titles are admin-authored free text, rendered as React text (escaped). Long names must wrap without breaking the layout; an unbroken 60-character string needs `break-words`.

## Out of Scope (confirm with user)

- Signups and "My Upcoming Signups" (no RSVP feature).
- Call-in procedures card.
- The `/instructions` help link and "Need help getting around?". presby has no such page, and the avatar menu and feedback prompt already cover help-seeking.
- fpcw's church icon and sun/moon icon in the welcome zone. The org mark is already in the chrome, and `GreetingBand` is shared with `/admin`.
- Tile count badges and the badge hook (R3).
- Tile column-count and compact-tile changes (R2).
- Hiding tiles by permission (R1).
- A member-facing group detail page.
- Showing a series' recurrence ("repeats weekly") on the event row. `recurrence_pattern` lives only on the parent row and is never parsed at read time.
- Fixing the greeting's server-clock timezone (tracked, not fixed here).
- Per-org tile labels.

## Open Questions

1. **Tile density** — default decline (R2). Confirm, or say what you want instead.
2. **Session and Board of Deacons pills** — default: show them, and exclude only `active_membership`. Say if you'd prefer managed groups only until a member-facing group page exists.
3. **Household-of-one suppression and the corrected count** — default: adopt both. This changes a currently-tested behavior.
4. **Events row count** — default 4, server-rendered, tuned in the browser. Is that right for the congregation's typical week?
5. **For the calendar pipeline (blocking handoffs):**
   - (a) Is `events.view` bound by default to the `active_membership` derived group? If not, the card is invisible to every ordinary member on day one.
   - (b) What is "now" for a wall-clock `timestamp` column with no org time zone? Home must consume the same helper.
   - (c) Name the member event-detail route and the list function the card will call.
   - (d) Confirm `is_public = false` events appear to members.
   - (e) Confirm `org_portal.calendar` stays out of the org-feature catalog.
6. **Breakpoint** — default `md:` for the side-by-side row rather than fpcw's `sm:`.

## Handoff (for the orchestrator)

**Next agent: architect (Phase 2).**

**Notes for the architect:**
- **Placement:** a groups self-read in `src/lib/org-portal/`, a consumer of the calendar's list function, and server components in `src/components/org-portal/`. No `'use client'`, no new dependency, no migration.
- **DECISION-162 content:** R1 (keep tiles unfiltered, with the widget-versus-tile asymmetry and the revisit trigger), R2 (no density change), R3 (no badge hook), R5 (no client trim).
- **Reserved F136–F137** have natural candidates: the household count predicate drift (`home-data.ts:71-81` against `directory.ts:244-261`) and the greeting's server-clock hour.
- **Sequencing:** Phase 4 stays blocked on the calendar merge, and Open Question 5 (b) must be answered before Phase 3 can finish.


## Operator rulings relayed from the calendar pipeline (orchestrator, 2026-10-14)

The operator answered the calendar pipeline's open questions on 2026-10-14; the ones that bind this pipeline:

- **No `org_portal.calendar` platform flag exists.** The member calendar (and therefore the "Coming up" card) is gated by a **per-organization toggle** plus `events.view`. Operator: *"no need to put it under a feature flag. we are not live yet. we do need to be able to turn features on/off per organization though."* Every mention of `org_portal.calendar` in this file's kickoff and Phase 1 is to be read as "the calendar's per-org toggle (architect to name it)". `org_portal.home_v2` still gates the page.
- **Time zone:** `organization_settings.time_zone` ships in the calendar pipeline's migration `0054` with a shared helper; the card's "upcoming" test and the greeting (later) consume it. OQ 5(b) is answered.
- **`events.view`** is backfilled to every org's baseline `member` role by migration `0054` and granted at provisioning. OQ 5(a) is answered: the card is visible to ordinary members on day one.
- **Cancelled events are hidden** everywhere member-facing (operator chose fpcw-directory's behaviour), consistent with R4's "excluded from upcoming".
- **`is_public = false` events appear to members** (OQ 5(d)) — the calendar analyst's G1 ruling stands; the operator did not object.
- OQ 5(c) (route and list-function names) and 5(e) are the calendar pipeline's Phase 2/3 to answer.

**Home-page open questions 1–4 and 6: the orchestrator accepted the analyst's defaults** (tile density unchanged; Session and Board of Deacons pills shown, `active_membership` excluded; household-of-one suppressed and the count corrected via the directory's eligibility query; four server-rendered rows; `md:` breakpoint). The operator was told these defaults and did not object.

---

# Phase 2 — Architectural Review (architect)

*Recorded verbatim by the orchestrator, 2026-10-14. The architect read files and ran SELECT-only catalog queries against the pipeline's Neon branch; nothing was written.*

## Verdict

**Approved with suggestions**

The shape is right: no migration, no new dependency, no new permission, no `'use client'`. Phase 3 has to honour four required items:

1. **Household count needs a directory fix first.** The directory's eligibility predicate omits `m.ended_on is null`. Pointing the home count at it would bring that gap along (new evidence, F136).
2. **Events card visibility comes from the calendar's list result.** A page-level `events.view` read would be a second gate on the same grant.
3. **No calendar flag, no Suspense.** No `org_portal.calendar` platform flag is read anywhere on the page, and no `Suspense` boundary is added.
4. **"Today" is the shared org-zone helper.** The groups currency test uses it, never `current_date` in SQL.

## Placement

- **Directory placement**
  - `src/lib/org-portal/my-groups.ts` (new): the viewer's own groups. It does not go in `src/lib/groups.ts`; see the groups ruling below.
  - `src/lib/org-portal/home-data.ts` (modified)
    - Gains one in-transaction `directory.view` read, returned as `canViewDirectory`.
    - The household count now goes through `src/lib/directory.ts`.
  - `src/lib/directory.ts` (modified): export a narrow transaction-scoped helper. The predicate itself stays private (details under "Household count" below).
  - `src/components/org-portal/` (new or modified)
    - `upcoming-events-card.tsx`
    - `home-main-row.tsx`
    - `yours-zone.tsx`, which gains the groups block.
  - `src/app/(org)/o/[slug]/page.tsx`: the loaders are wired here.
  - Nothing belongs in `src/components/shared/`. Every new piece composes org-only concepts (household, groups, events), and `shared/` is for things used on both the platform and org axes.
  - If the calendar pipeline ships a type-icon or event-row component, the card imports it from wherever the calendar puts it. It does not get a second rendering of the type palette, and it is not moved into `shared/`.
  - Group pills use `@/components/ui/badge` (a non-interactive variant), not hand-written chip classes (Component Rule 5).
- **Server vs Client split**
  - Every new component is a Server Component.
  - `FindPersonForm` stays the page's only client island, unchanged except that the page may now not render it.
  - There is no client-side measurement (R5) and no `useForm`, so `check:hydration-gate` is unaffected.
- **Dependencies:** none.
- **Migration:** none. The calendar pipeline's `0054` supplies `organization_settings.time_zone` and the `events.view` backfill.

## Invariants Touched

- **The `(org)` contract and Isolation Is a Database Property**
  - Every new read goes through `withOrgContext()` on `db`. `getPlatformDb()` stays absent.
  - Live catalog on the pipeline branch (`br-long-river-axfwmp57`):
    - `groups`, `group_memberships`, `households`, `memberships`, `events`, `organization_settings` and `organization_feature_toggles` all have `relforcerowsecurity = t`.
    - `presby_app` holds `SELECT` on each.
    - The policies on `groups`, `group_memberships`, `events` and `organization_settings` are the tenancy-only `organization_id = presby_current_org()`.
  - Consequence: the "self" in the groups self-read is paper, not database. RLS hands the viewer the whole org's roster, and only the application predicate `gm.person_id = <viewer>` narrows it. The conditions in the groups ruling exist because of this.
- **No Role Carries a Wildcard**
  - A permission-less self-read is not a role grant. It is the identity axis: a person reading their own rows, the same trust model `home-data.ts:13-18` already uses for name and household.
  - Acceptable under conditions (groups ruling).
- **The Court Is Not a Group**
  - Reading the derived `session`/`diaconate` rosters adds no write path.
  - The pill excludes `derived_from = 'active_membership'`. On the live branch the only `derived_from` values are `session`, `diaconate` and `active_membership`. Filter on `derived_from`, never on the group name.
- **Permissions vs Flags (DECISION-003)**
  - Unchanged. The widget-versus-tile asymmetry is recorded as DECISION-162 and does not amend DECISION-003 (R1 ruling).
  - The "Coming up" card asks no platform-flag question: the operator ruled no `org_portal.calendar` flag.
  - Its org-toggle and permission questions are both answered inside the calendar's list function.
- **Verify in a Browser / DECISION-159**
  - No new hydration surface.
  - Browser checks at 360, 768 and 1280 px and 200% zoom stay required at Phase 4/5. The main row's single-card full-width rule is only visible there.
- **No `loading.tsx` on a segment that 404s:** respected. See the streaming ruling.
- **Brand cascade:** `(org)` is brandable and the new cards use tokens only. Event-type colours are platform-classified tokens (calendar G11), so a brand cannot re-declare them. No `check:brand-scope` change.

## Notes

### R1: never permission-filter tiles. **Upheld.**

The analyst's four reasons stand. The decisive one is structural: `tiles.ts:8-18` makes the destination the sole authority, and presby's destinations render honest Forbidden states, so hiding a tile buys no discretion and adds a second gate that can drift.

The widget-versus-tile asymmetry is **recorded in DECISION-162, not as an amendment to DECISION-003.** DECISION-003 is about two mechanisms (permission vs flag). This rule is about where a permission check lives for a home-page element:

- A **tile** is navigation, so the destination owns the denial.
- A **widget** renders data, so its read function owns the denial, and on the home page that denial shows up as absence.

I am adding one clause the analyst did not state, and it is what keeps the asymmetry from recreating the DECISION-003 defect: **a widget's visibility is derived from its own read function's result, not from a separate page-level permission read.** The card hides when `listUpcomingMemberEvents` returns `disabled` or `forbidden`. The page does not pre-read `events.view`.

The one unavoidable page-level read is `directory.view`. Find-a-person is a form whose authority (the action) runs only on submit, so the page has to decide visibility first. That read uses the identical `presby_has_permission(..., 'directory.view')` call. If the two ever disagree, the failure is fail-closed (the action refuses) or fail-hidden, never a leak.

Scope note for the calendar pipeline: R1 forbids permission filtering. It does not forbid an org-toggle axis on the registry. "Is this feature on for this org" is the flag question at org grain, so a calendar tile gated by its per-org toggle is consistent with R1. Whether `visiblePortalTiles` gains that axis (and the `personId` it would need) is the calendar pipeline's ruling.

The accepted cost (dead-end operate tiles such as Members for an ordinary member) and its revisit trigger go to `docs/TODO.md` as the analyst wrote them.

### R2 (tile density unchanged), R3 (no badge hook), R5 (no client trim). **All confirmed.**

- **R5 detail**
  - The main row is a server component.
  - With two cards: `md:grid-cols-2 items-start`.
  - With exactly one card: render it at full width (no grid, or `md:grid-cols-1`). Never leave a blank half.
  - With none: render nothing.
  - Presence is known on the server, so this is a render-time branch with no client code.
  - The row count is one named constant, `UPCOMING_EVENTS_LIMIT = 4`.
  - Each card owns its own `h2` ("Yours", "Coming up"), so the outline stays h1 greeting, then h2 cards, then h2 domain sections.

### Independent failure domains: transaction shape. **Ruling: separate `withOrgContext()` transactions under one `Promise.all`. No savepoints, no single combined read.**

- **Why not savepoints**
  - There is no precedent in `src/` (no `tx.transaction(` or `SAVEPOINT` anywhere).
  - It would force the calendar's public read API to take a caller's `tx`, against the one-transaction-per-exported-function house shape (`groups.ts`, `events.ts`, `directory.ts`).
  - It serialises every widget onto one connection.
  - It only isolates statement errors. A connection-level failure, the realistic correlated one, takes everything down either way.
- **Why not one combined function:** that is the coupling Phase 1 Pass 4.1 correctly rejects.
- **Why N transactions is fine**
  - It is the existing idiom. Today's page already runs `assertOrgAccess` plus `getPortalHomeData` sequentially.
  - `appPool` is a default `Pool` (pg default `max` 10, queueing rather than failing when exhausted).
- **Bound:** at most three concurrent tenant transactions after the gate:
  1. `getPortalHomeData`: display name, `canViewDirectory`, household summary.
  2. `getViewerGroups`.
  3. `listUpcomingMemberEvents`: org toggle, permission, time zone and query in one transaction.
- `assertOrgAccess` stays first and sequential. It is the contract's gate, and it decides the `home_v2` branch.
- Flag reads, tiles and the feedback-prompt state join the same `Promise.all`.
- Each tenant loader is wrapped by one small local helper that:
  - re-throws `OrgAccessError`;
  - logs a fixed string with no error message or object (the `publicOrgSummary` discipline);
  - returns a failed marker.
- How each failure renders:
  - Home-data failure: greeting falls back to "Welcome.", and the household block and Find-a-person are hidden (fail closed, since `canViewDirectory` is unknown).
  - Groups failure: block omitted.
  - Events failure: card shows the Flow 2c copy.

### Groups self-read: placement and gate. **Ruling: `src/lib/org-portal/my-groups.ts`, permission-less, under four conditions.**

It cannot go in `src/lib/groups.ts`. That module has two module-wide invariants stated in its header (`groups.ts:9-24`): every export checks `groups.manage` first, and every read filters `membership_source = 'managed'`. This function breaks both on purpose. Putting it there would make the header false, and the next reader would trust the header.

Expected signature (Phase 3 may rename):

```ts
export async function getViewerGroups(
  viewerPersonId: string,   // resolved.org.personId only
  organizationId: string,
): Promise<Array<{ groupId: string; name: string }>>
```

Conditions:

1. **No target-person parameter.** The predicate is `gm.person_id = viewerPersonId`. It must never grow a second person-id argument; that is the moment it becomes an ungated roster reader.
2. **Projection is `groups.id` and `groups.name` only.** No role, roster, `description` or `meets_when`.
3. **"Today" comes from the calendar pipeline's org-zone helper.** The function reads `organization_settings.time_zone` inside its own transaction through the calendar's accessor, applies the pure helper, and binds the result as a `'YYYY-MM-DD'` parameter. Never `current_date`: the live branch's `TimeZone` is `GMT`. The currency predicate is `starts_on <= $today and (ends_on is null or ends_on > $today)`.
4. **A DB-backed test proves the self-scope.**
   - Another member's groups at the same org are not returned.
   - A group at another org is not returned (exercise it with the viewer holding memberships at both).
   - `active_membership` is excluded.
   - `session`/`diaconate` are included.
   - An ended group membership is excluded.

If a member-facing groups page arrives later, it gets its own permission (`groups.view`). This function stays self-only.

### Household count. **Ruling: confirm reuse of the directory module, plus a required predicate fix.**

- **Placement**
  - `src/lib/directory.ts` exports a transaction-scoped helper built on the existing private `countDirectoryRows(tx, organizationId, { householdId })`, for example `countHouseholdDirectoryMembers(tx, organizationId, householdId): Promise<number>`.
  - It also exports the existing `checkDirectoryView(tx, …)`, so `home-data` reads `directory.view` once and calls the count only when it is true.
  - Do not export `directoryEligibilityWhereSql` for this use.
  - Use the ordinary view (`includeHidden: false`). Home is not an elevated surface.
- **Suppression:** show the household when the count is 2 or more, link to the household page only when `org_portal.directory_v2` is on, and change the pinned `yours-zone.test.tsx:23-32` deliberately.
- **Required: fix the shared predicate before the home count adopts it.** The directory's predicate (`directory.ts:244-261`) has no `m.ended_on is null` term. Measured on the pipeline branch:
  - 2 of 44 memberships (`fernwood` and `e2e-beta`, `current_roll` null, `engagement_status = 'regular'`, `ended_on = 2026-03-31`) pass directory eligibility.
  - Meanwhile `presby_membership_is_active()`, the access gate, requires `ended_on is null`.
  - So a person whose relationship has ended still appears in the directory today. Pointed at the unfixed predicate, the home count would trade one defect for another: it would drop the deceased spouse but count the departed one.
- **The fix**
  - Add `and m.ended_on is null` to `directoryEligibilityWhereSql()` once. That fixes all six directory readers.
  - In the same commit, move `findPersonMatches()`'s hand copy (`find-person.ts:66-84`) onto the shared predicate. Otherwise the single-match jump can send a member to a person page that now 404s. This also closes the 2026-08-24 Phase 6 follow-up.
  - It ships as its own `fix(directory):` commit (`Caught-By: agent-review`, `Discovered-In: Phase-2`, this pipeline's `Work-Log:` slug), with a regression test in the directory DB suite.
- **Sequencing:** if Phase 3 judges it too wide for this pipeline, it becomes its own bug-fix pipeline that merges before this one's Phase 4. Either way, the home count does not ship on the unfixed predicate.

### Hiding Find-a-person when `directory.view` is absent; reading permissions once. **Confirmed, amended.**

`directory.view` is read once, inside `getPortalHomeData`'s transaction, and returned as `canViewDirectory`. It gates both Find-a-person and the household block.

`events.view` is **not** read at page level (R1 clause above). Phase 1 Pass 4.4's "fetch `directory.view` and `events.view` once" is amended accordingly.

### Contract with `2026-10-14-member-calendar`. **Requirement on that pipeline's Phase 3** (also copied into that work-log by the orchestrator):

> The calendar's member-read module (one module, chosen by the calendar's Phase 3) exposes, alongside its month read, an export sharing the **same private gate helper, the same private member-visibility predicate, and the same member projection**:
>
> ```ts
> export type MemberEventsResult<T> =
>   | { kind: "ok"; data: T }
>   | { kind: "disabled" }   // the org's calendar toggle is off
>   | { kind: "forbidden" }; // the calendar's read gate (events.view, or the G15 ruling) fails
>
> export interface UpcomingMemberEvent {
>   id: string;                 // the representative occurrence; the detail-link target
>   seriesKey: string;          // coalesce(parent_event_id, id)
>   title: string;
>   startsAtWallClock: string;  // 'YYYY-MM-DDTHH:mm', selected as text in SQL, never a Date
>   endsAtWallClock: string | null;
>   location: string | null;
>   eventType: { name: string; colorToken: string; iconKey: string } | null; // null renders as the fallback/neutral
> }
>
> export async function listUpcomingMemberEvents(
>   viewerPersonId: string,
>   organizationId: string,
>   opts: { limit: number; now?: Date },  // limit clamped server-side (1..12); `now` exists for tests only
> ): Promise<MemberEventsResult<UpcomingMemberEvent[]>>;
> ```
>
> Inside ONE `withOrgContext()` transaction, in this order:
> 1. The per-org toggle, composed with the category axis the way `isOrgFeatureEnabled` does, via `categoryEnabledInTx`.
> 2. The read gate.
> 3. Read `organization_settings.time_zone` and compute org-local today with the shared pure helper.
> 4. The query.
>
> Query rules:
> - Exclude cancelled rows (`cancelled_at is null`). Do not filter on `is_public`. Do not filter `parent_event_id is null`.
> - Keep, per `seriesKey`, the earliest row with `starts_at >= $todayStart::timestamp`, bound as a `'YYYY-MM-DD'` string. The "listed until its day ends" policy is for Phase 3 to confirm.
> - Order by `starts_at, id`. Limit to `opts.limit`.
>
> Tests that live with the calendar:
> - The upcoming set is a subset of the calendar's default set.
> - A series whose parent occurrence has passed still yields its next child.
> - The suite runs under `TZ=UTC`, `America/New_York` and `Pacific/Honolulu`.
>
> The calendar also names the member detail route the card links to (`/o/<slug>/calendar/<eventId>` per G3), and confirms whether the per-org toggle defaults on for existing orgs. If a missing toggle row reads as `false` (the `isOrgFeatureEnabled` convention), the relayed claim "the card is visible to ordinary members on day one" holds only if `0054` seeds the toggle on.

The home pipeline never names the toggle key or the permission literal. It switches on `kind`.

### Streaming. **Ruling: render synchronously. No `Suspense` boundary in this pipeline.**

The status-code hazard does not apply below the gates. The real reasons are these:

- **The cost being hidden is small.** The cost is a few parallel database round trips, already bounded by the `Promise.all`. On the slow connections DECISION-159 measured, the slow part is the JavaScript and the network, not these reads.
- **A skeleton breaks the page's own rule.** A skeleton for a card that then resolves to "hidden" is exactly the empty-section scaffolding R4 and the 2026-08-24 rationale forbid, and it adds layout shift to the main row.
- **Streaming would change the `OrgAccessError` status.** An `OrgAccessError` thrown inside a streamed boundary would render `error.tsx` after a 200 has already flushed.

Revisit only with a measured TTFB problem on `/o/<slug>`.

### F136 / F137

- **F136: real; record it in `docs/schema-design-2.md`.** Suggested text:
  > The directory eligibility rule exists in three disagreeing forms.
  > - `home-data.ts:71-81` counts `ended_on is null` only, so it counts deceased, merged, directory-hidden and off-roll people.
  > - `directoryEligibilityWhereSql()` omits `ended_on is null`, so it lists ended relationships whose `engagement_status` stayed `regular`. Two such fixture rows exist, and the access gate `presby_membership_is_active()` excludes them.
  > - `findPersonMatches()` carries a hand copy.
  >
  > Generalisation: a count or list of *other people* is directory data even when the scope is the viewer's own household, and it uses the one shared predicate. The access gate's definition of "current relationship" (`ended_on is null`) is part of that predicate.
  >
  > Fixed by `2026-10-14-portal-home-alignment` (or its split bug-fix pipeline).
- **F137: TODO line only; release the number.** The greeting's server-clock hour is a documented, deliberate tradeoff (`greeting.ts:10-18`) whose premise ("the server's clock is the congregation's timezone") is false on Vercel. But it is the same org-local-time finding the calendar pipeline is already recording (G5/G6, in F132–F135), and a second F-number would duplicate it.
  - Suggested TODO line: "Greeting hour: adopt the calendar's org-zone helper via an optional `timeZone` prop on `GreetingBand` (`/admin` passes none); correct `greeting.ts`'s header premise."

### Smaller items for Phase 3

- **Rewrite `home-data.ts`'s header.** It now runs a `directory.view` check (only for the household block and `canViewDirectory`; the display name stays permission-less), and "no permission check runs here, on purpose" becomes false.
- **Directory-hidden viewer with a visible spouse.** That viewer gets count 1 (suppressed) while the household page would show the spouse. Pick a behaviour and pin it in a test.
- **Make the main-row composition a pure function.** Which cards render, and whether it is one column or two, is a pure function of the loader results and gets a unit test the way `computeDestination` does.

## Handoff

**Next agent: tech-lead (Phase 3).** Phase 3 can draft now. It cannot close until the calendar's Phase 3 confirms the `listUpcomingMemberEvents` contract above, the time-zone accessor's name, and the toggle's default. Phase 4 stays blocked on the calendar merge, plus the directory predicate fix if it is split out. For the orchestrator at integration: record DECISION-162 (draft below), record F136, release F137 unused.

## DECISION-162 (architect's draft, recorded in `docs/decisions.md` at integration)

**DECISION-162 — On the `(org)` portal home, a tile is navigation and a widget is data. Tiles are never filtered by the viewer's permission (the destination owns the denial). A widget hides when its own read function denies, and that denial comes from the function's result, never from a separate page-level permission read. Tile density, badges and the main row's height stay server-side and unchanged. Each widget is its own `withOrgContext()` failure domain under one `Promise.all`, with no savepoints and no `Suspense`.**

**Status:** Resolved · **Date:** 2026-10-14 · **Feature:** `2026-10-14-portal-home-alignment` (Phase 2 architect, from the Phase 1 analyst's R1–R5)

**Tiles.** The registry stays permission-blind (`src/lib/org-portal/tiles.ts:8-18`). fpcw-directory hides tiles by permission only because its destinations redirect silently. presby's destinations render honest Forbidden states, so hiding a tile buys no discretion and adds a second gate that can disagree with the destination about one grant, which is the defect DECISION-003 exists to prevent. Accepted cost: an ordinary member sees operate tiles (such as Members) that end in a Forbidden page. Revisit trigger, as its own pipeline: a per-tile `requires` key, one batched permission read, and a test pinning each tile to its destination's gate. This ruling forbids *permission* filtering only. An org-toggle axis ("is this feature on for this org") is the flag question at organization grain and is not excluded.

**Widgets.** A widget renders data, so it hides when the viewer may not read that data: the home page carries no denial a member can do nothing about. To keep the asymmetry from recreating the two-gates defect, a widget's visibility is derived from its own read function's result (for example `forbidden` or `disabled` renders nothing), and the page does not pre-read the permission. The one exception is a widget whose authority runs only on submit (Find-a-person). Its visibility uses the identical `presby_has_permission` call the action makes, and the action remains the authority. This rule is recorded here and does not amend DECISION-003, which governs the two mechanisms, not where a check lives.

**Layout.** Tile columns stay at one on phones and two from `sm` (descriptions carry meaning, sections hold four tiles at most, and `TileGrid` is shared with both admin hubs). No count-badge hook (an unused prop is speculative, and the one real queue needs its own gated count function). No client-side height matching. The main row is a server component at `md:grid-cols-2 items-start` with a fixed four-row events card, and a lone card takes the full width.

**Failure domains.** Each widget reads in its own `withOrgContext()` transaction. At most three run concurrently after `assertOrgAccess`, each wrapped so that `OrgAccessError` re-throws and any other failure degrades only that widget. Savepoints were rejected: there is no precedent, they would force callers' transactions into other modules' public reads, they serialise everything onto one connection, and they do not isolate the correlated connection failure anyway. `Suspense` was rejected: a skeleton for a card that may resolve to nothing is the scaffolding this page forbids, and an error after the first flush loses its status code.

**Self-reads.** A widget may read the viewer's *own* rows without a permission (the `home-data.ts` trust model), provided four conditions hold. Because RLS on these tables is tenancy-only, the self-scope is an application predicate, so the conditions are what hold it:

- the person id is the server-resolved one and the function takes no other;
- the projection is the minimum needed for display;
- a database test proves another member's rows are not returned;
- the function lives outside any module whose header promises a permission gate on every export.

(2026-10-14, adopted at Phase 2; `docs/work-log/2026-10-14-portal-home-alignment.md`.)


## Relayed from the calendar pipeline's Phase 2 (orchestrator, 2026-10-14)

The calendar architect ruled (Approved with suggestions; see `docs/work-log/2026-10-14-member-calendar.md` Phase 2, R1–R12) the pieces this pipeline consumes:
- **Toggle:** `org_portal.calendar` is an `ORG_FEATURE_CATALOG` entry with `flag: null`, category `worship`, `provisionedOn: true` — migration 0054 backfills an enabled row for every org and `createOrganization()` inserts one. So the "Coming up" card IS visible to ordinary members on day one (OQ 5(e) answered: the key is in the catalog, toggle-only).
- **Time:** pure helpers in `src/lib/shared/org-time.ts` (`DEFAULT_ORG_TIME_ZONE`, `isValidTimeZone`, `wallClockNow(now, tz)` / today's day key); the in-transaction accessor is `orgTimeZoneInTx(tx, organizationId)` in `src/lib/org-settings.ts`. `getViewerGroups` reads the zone through that accessor inside its own transaction.
- **Member read module:** `src/lib/calendar.ts` (`server-only`), read gate `events.view OR events.manage` as one private helper. `listUpcomingMemberEvents` lives there; the calendar's Phase 3 confirms the contract this pipeline's architect specified.
- **Member detail route:** `/o/<slug>/calendar/[eventId]`.
- **Event-type display pieces** (icon, chip, swatch) live in `src/components/org-portal/event-types/`; the card imports from there.
- **Tiles:** `visiblePortalTiles` moves to `src/lib/org-portal/visible-tiles.ts` and takes `viewer: { personId, organizationId }`; `page.tsx` already has both. The `events` tile becomes "Manage events" (administer); a new `calendar` tile (operate, worship) appears.

---

# Phase 3 — Technical Design (tech-lead)

*Drafted 2026-10-14. **Phase 4 is blocked on the `2026-10-14-member-calendar` merge**, and (if the orchestrator accepts the split recommended in Part A) on the `fix(directory):` bug-fix pipeline's merge as well. **This section closes only when the calendar's Phase 3 confirms the contract items in B.6 (C1–C7).** Every file path and line number below is against the pre-calendar tree; the calendar's branch edits `page.tsx` and `page.test.tsx` (the `visiblePortalTiles` import and call) before this pipeline's Phase 4 starts, so the implementer rebases onto that, not onto the lines quoted here.*

## Summary

The `home_v2` portal home gains a **main row** of two server-rendered cards — **Yours** (the household, now counted by the directory's own rule and hidden when it is only the viewer, plus the viewer's own groups as read-only pills) and **Coming up** (the next four upcoming events, one per series, read through the member calendar's own list function) — side by side from `md`, a lone card full width. Find-a-person is hidden from viewers who lack `directory.view`. The page's reads become independent failure domains under one `Promise.all` after the membership gate (DECISION-162). No migration, no new permission, no new flag, no new dependency, no `'use client'`. The work has two parts that ship separately: **Part A**, a one-predicate bug fix in `src/lib/directory.ts` (ended relationships are listed in the directory today, F136), recommended as its own bug-fix pipeline merging ahead of everything else; and **Part B**, the feature, which consumes four modules the calendar pipeline is creating.

## Decisions this design makes

| # | Question | Ruling |
|---|---|---|
| D1 | `fix(directory):` inside this pipeline or split? | **Split** into a bug-fix pipeline that merges before this pipeline's Phase 4 (Part A.1). |
| D2 | Where does household-of-one suppression live? | **In `getPortalHomeData` only** (it returns `household: null` below 2). `YoursZone` renders what it is given; its singular branch is deleted, not kept as a second copy of the rule. |
| D3 | Directory-hidden viewer with a visible spouse | **Option A: the card is suppressed.** The home count is the number the household page would show; a hidden viewer is not in it, so the count is 1 and the card is absent. Pinned by a DB test. |
| D4 | Household link target | The household page **iff both `org_portal.directory` and `org_portal.directory_v2` are on** (the household page requires both, `households/[householdId]/page.tsx:81-82`); otherwise `/o/<slug>/directory`. A refinement of the architect's "directory_v2 on". |
| D5 | Find-a-person's eligibility mechanism | A new exported `findDirectoryPersonIds()` in `directory.ts` carries the SQL, so `directoryEligibilityWhereSql()` stays private as the architect required. |
| D6 | Where the pure main-row function lives | `src/lib/org-portal/main-row.ts` (no `server-only`, type-only imports), beside the loaders it composes. |
| D7 | Implementer | `full-stack-developer` for Part B; `api-developer` for Part A if split (Implementer section). |

## Permissions & Flags

- **Permission keys:** none new. `FEATURE_CATALOG` and seed bindings are untouched.
  - `directory.view` — read once, in `getPortalHomeData`'s transaction, via `checkDirectoryView(tx, …)`; returned as `canViewDirectory`; gates Find-a-person and the household block. The find-person *action* re-checks on submit and remains the authority.
  - `events.view` (and `events.manage`, the calendar's `OR`) — **never read by the page**. The Coming up card's visibility is the `kind` of `listUpcomingMemberEvents`' result (DECISION-162, R1 clause). The home pipeline never names the permission literal.
  - Groups pills — none. A permission-less self-read under the four architect conditions (B.1).
- **Flags:** `org_portal.home_v2` (existing, gates the page), `org_portal.motion` and `org_portal.feedback` (existing, unchanged), and **read newly on this page**: `org_portal.directory` and `org_portal.directory_v2` (link target only, D4). **No `org_portal.calendar` flag is read anywhere** — it does not exist; the calendar's per-org toggle is evaluated inside the list function. The test suite pins that no flag key containing `calendar` is requested by the page.
- **Org-feature toggle:** consumed only through the list function's `disabled` result.

## API Contract

No routes, no server actions. Server-side functions (all `server-only`, all `withOrgContext()` on `db`; `getPlatformDb()` appears nowhere):

```ts
// src/lib/org-portal/my-groups.ts (new)
export interface ViewerGroup { groupId: string; name: string }
export async function getViewerGroups(
  viewerPersonId: string,   // resolved.org.personId only; there is no second person parameter, ever
  organizationId: string,
): Promise<ViewerGroup[]>;

// src/lib/directory.ts (modified)
export async function checkDirectoryView(tx: OrgTx, personId: string, organizationId: string): Promise<boolean>; // existing, now exported
export async function countHouseholdDirectoryMembers(tx: OrgTx, organizationId: string, householdId: string): Promise<number>; // new
export async function findDirectoryPersonIds(tx: OrgTx, organizationId: string, query: string, limit: number): Promise<string[]>; // new (Part A)

// src/lib/org-portal/home-data.ts (modified)
export interface PortalHomeHousehold { id: string; name: string; memberCount: number } // memberCount >= 2 by construction
export interface PortalHomeData { displayName: string; canViewDirectory: boolean; household: PortalHomeHousehold | null }
export async function getPortalHomeData(personId: string, organizationId: string): Promise<PortalHomeData>; // signature unchanged

// src/lib/org-portal/main-row.ts (new, pure)
export const UPCOMING_EVENTS_LIMIT = 4;
export type Loaded<T> = { ok: true; value: T } | { ok: false };
export type UpcomingCardState =
  | { kind: "events"; events: UpcomingMemberEvent[] }
  | { kind: "empty" }
  | { kind: "failed" };
export interface MainRowInput {
  household: PortalHomeHousehold | null;
  groups: ViewerGroup[];                                   // [] when the groups read failed
  events: Loaded<MemberEventsResult<UpcomingMemberEvent[]>>;
}
export interface MainRowPlan {
  layout: "none" | "single" | "double";
  yours: { household: PortalHomeHousehold | null; groups: ViewerGroup[] } | null;
  upcoming: UpcomingCardState | null;
}
export function composeMainRow(input: MainRowInput): MainRowPlan;
```

Consumed from the calendar pipeline (contingent, B.6): `listUpcomingMemberEvents(viewerPersonId, organizationId, { limit })` returning `MemberEventsResult<UpcomingMemberEvent[]>` exactly as the architect's contract states.

## Data Model

No schema changes required. No migration. (`organization_settings.time_zone`, `events.view`, and the calendar toggle all arrive in the calendar's `0054`.) Reads touched: `group_memberships`, `groups`, `memberships`, `people`, `person_privacy`, `households`, `organization_settings` (through the calendar's accessor), `events` (through the calendar's function) — all `FORCE ROW LEVEL SECURITY` tenant tables, all read as `presby_app` after `withOrgContext()`. `check:sql-date` applies to nothing here: no `sql<Date>`; every date is bound as a `'YYYY-MM-DD'` string or selected as text.

---

## Orchestrator note on Part A (2026-10-14)

The tech-lead's recommendation is accepted: **Part A ships as its own bug-fix pipeline**, `docs/work-log/2026-10-14-directory-ended-memberships.md`, on worktree `../presby-directory-fix` / branch `fix/directory-ended-memberships` off `main`, merging before this pipeline's Phase 4. Part A below is that pipeline's design of record; its `Work-Log:` trailer is `2026-10-14-directory-ended-memberships`.

## Part A — the `fix(directory):` commit (F136)

### A.1 Decision: split into its own bug-fix pipeline

**Recommendation: split.** Open a bug-fix pipeline (suggested slug `2026-10-14-directory-ended-members`, bug-fix variant: Phase 1 brief, Phase 2 skipped with a pointer to this pipeline's Phase 2 ruling, Phase 3 = this Part A lifted verbatim, Phase 4 `api-developer`, Phase 5 qa, Phase 6 brief) on a fresh branch off `main`, merging **before** this pipeline's Phase 4 begins. Reasons, in order of weight:

1. **It is a live defect on a shipped surface, not a prerequisite detail.** `/directory` lists every `memberships` row with `ended_on` set whose `engagement_status` stayed `regular`, while the access gate (`presby_membership_is_active`) already treats that person as gone. The listing carries name, email, phone and address (each subject to the person's field-level privacy flags). `docs/STATE.md` records production with 36 of 40 flags on; **the orchestrator should confirm `org_portal.directory` is among them** — if it is, this is a privacy-adjacent defect in production today, and it should not wait on a pipeline whose Phase 4 is itself waiting on the calendar (which is still in Phase 3).
2. **It has no dependency on the calendar or on anything else in this pipeline.** It touches `src/lib/directory.ts`, `src/lib/org-portal/find-person.ts` and two test files. The calendar branch touches none of them. A separate branch off `main` has no merge risk and no wait.
3. **It ships as its own patch release** (v0.31.1) with a note a clerk can read: "people whose membership has ended no longer appear in the directory." Folded into the home release it would be a footnote to a card announcement.
4. **Escape-rate accounting stays honest.** The commit carries `Discovered-In: Phase-2` (this pipeline's architect found it) either way; as its own pipeline's commit it also counts once, against its own work-log, instead of being buried in a `feat` pipeline's.
5. **Cost of splitting is small and bounded**: three brief agent passes for ~25 changed lines, against a defect that is live. The architect pre-authorised the split ("becomes its own bug-fix pipeline that merges before this one's Phase 4").

**If the orchestrator overrules and keeps it inside:** nothing in Part A changes except the `Work-Log:` trailer; it is the **first commit** on this pipeline's Phase 4 branch, before any `feat`, and Part B's household work starts only after it. Either way **the home count does not ship on the unfixed predicate** (architect, binding).

**Trailers.** `Caught-By: agent-review`, `Discovered-In: Phase-2`, and `Work-Log:` naming the pipeline whose branch carries the commit — `2026-10-14-portal-home-alignment` if inside; the split pipeline's own slug if split (the trailer joins a commit to *its* pipeline; the split work-log's Source block cites this pipeline's Phase 2 and F136).

### A.2 The change in `src/lib/directory.ts`

`directoryEligibilityWhereSql()` (currently `:244-261`) gains one term. It has exactly one call site (`directoryFromWhereSql`, `:317`), and every directory reader — `getDirectory`, `getHouseholds`, `getHouseholdDetail`, `getPersonDetail`, `getParishRoster` (via `queryDirectoryRows`) and `countDirectoryRows` — goes through it, so one edit fixes all six:

```ts
    ${includeHidden ? sql`true` : sql`coalesce(pp.directory_hidden, false) = false`}
    and p.merged_into_id is null
    and p.date_of_death is null
    and m.ended_on is null
    and ${ status ? ... : ... }
```

`m.ended_on is null` is the access gate's own definition of a current relationship (`drizzle/0015`, `presby_membership_is_active`; `people.ts` `memberships_one_active_roll_idx` uses the same). It applies when `includeHidden` is true (a `directory.view_hidden` holder sees hidden *rows*, never ended *relationships*) and when `status` is given.

Prose to update in the same commit (so the header stops being false): the "who APPEARS as a row" paragraph at `directory.ts:28-33` gains "minus an ended relationship (`ended_on` set)"; the doc comment on `directoryEligibilityWhereSql` names the new term and cites `presby_membership_is_active`.

### A.3 `findPersonMatches()` moves onto the shared predicate

`directoryEligibilityWhereSql` stays **private** (architect). `directory.ts` gains one exported, transaction-scoped function that carries `find-person.ts`'s current search SQL verbatim except that its eligibility lines are replaced by the shared predicate:

```ts
export async function findDirectoryPersonIds(
  tx: OrgTx, organizationId: string, query: string, limit: number,
): Promise<string[]> {
  const like = `%${query}%`;
  const result = await tx.execute(sql`
    select distinct m.person_id as person_id
      from memberships m
      join people p on p.id = m.person_id
      left join person_privacy pp
             on pp.person_id = m.person_id and pp.organization_id = m.organization_id
      left join contact_methods cm
             on cm.person_id = p.id and cm.kind in ('email', 'phone')
     where m.organization_id = ${organizationId}::uuid
       and ${directoryEligibilityWhereSql(false)}
       and ( p.first_name ilike ${like} or p.last_name ilike ${like}
          or p.preferred_name ilike ${like} or cm.value ilike ${like} )
     limit ${limit}
  `);
  return ((result as unknown as { rows?: Array<{ person_id: string }> }).rows ?? []).map((r) => r.person_id);
}
```

`find-person.ts` keeps its own `directory.view` read in this commit (the swap to the exported `checkDirectoryView` is Part B, where the export is needed anyway) and replaces its inline eligibility SQL with `findDirectoryPersonIds(tx, organizationId, query, 2)`. Its header's "copied here rather than imported ... predicate drift" paragraph is rewritten to say it now shares the predicate through `findDirectoryPersonIds`. **Search semantics are not changed**: find-person still matches *any* email/phone contact row, while the directory search matches only the primary one — a pre-existing difference, noted as a TODO line, deliberately not touched in a bug-fix commit.

### A.4 Failing-first regression tests

Written first, run red against the unfixed predicate, then the fix turns them green. Both suites are DB-backed (`describe.skipIf(!hasDb)`), run `--no-file-parallelism` against the pipeline's Neon branch.

**`src/lib/directory.test.ts`** — new fixture in the main `beforeAll`: person `endedMember` (invented name, e.g. "Rowan Ashgrove-Pell"), `memberships` row at `orgA` with `engagementStatus: "regular"`, `currentRoll: null`, `endedOn: "2026-03-31"`, `householdId: householdVisible`, `householdRole: "other"` — the exact shape of the two measured fixture rows, placed in the existing visible household so the household assertions below become built-in proof. Add `endedMember` to the `allPeople` teardown list. New tests, in a new `describe("an ended relationship is not in the directory (F136)")`:

1. `getDirectory(control, orgA)` does not contain `endedMember` (also with `{ search: "Ashgrove" }`).
2. `getPersonDetail(control, orgA, endedMember)` returns `{ kind: "not-found" }`.
3. `getHouseholdDetail(control, orgA, householdVisible)`: `memberCount` is still `2` and `members` still equals `[hhPerson1, hhPerson2]` (pre-fix: 3 and a third id).
4. `getHouseholds(control, orgA)`: `householdVisible`'s `memberCount` is still `2`.
5. With an elevated caller (`includeHidden: true`, the `elevatedPerson` fixture): `getDirectory` still excludes `endedMember` (ended is not "hidden").
6. A person whose `endedOn` is `null` and is otherwise identical (control) is still listed — the term did not over-exclude.

The existing `memberCount toBe(2)` assertions at `directory.test.ts:877-940` therefore also go red before the fix; that is intended and noted in the PR.

**`src/lib/org-portal/find-person.test.ts`** — fixture `endedMember` ("Quillon Ferrowby"-style unique surname), orgA, `regular`, `currentRoll: null`, `endedOn: "2026-03-31"`, in the teardown list. New tests:

7. `findPersonMatches(seeker, orgA, "<unique surname>")` returns `{ kind: "ok", personIds: [] }` (pre-fix: one id — the single-match jump would redirect to a person page that now 404s).
8. A direct-equivalence guard so the two surfaces cannot drift again: for each fixture person in `[control, hiddenPerson, visitor, endedMember, …]`, `findPersonMatches` returns the person **iff** `getPersonDetail` returns `ok` (both run as the same seeker). One loop, named "find-person and the directory agree on who is eligible (F136)".
9. Existing cases (visitor never matches, hidden never matches, forbidden, `limit 2`) pass unchanged.

### A.5 Commit

One commit, `fix(directory): exclude ended relationships from the directory and find-a-person`; body states the predicate gap (`ended_on is null` missing, the access gate requires it), the measured fixture rows, the six readers fixed by the one term, the `findDirectoryPersonIds` consolidation, and the regression tests; trailers as in A.1. `docs/TODO.md`, `docs/schema-design-2.md` (F136) and `docs/decisions.md` are **not** edited in the commit — Rule 16; the orchestrator integrates them (drafts at the end of this section). Quality gate: `npm run typecheck`, `npm run lint`, the two DB suites, `npm run check`.

---

## Part B — the feature

### B.1 `src/lib/org-portal/my-groups.ts` — `getViewerGroups`

```ts
import "server-only";
import { sql } from "drizzle-orm";
import { withOrgContext } from "@/lib/authz";
import { orgTimeZoneInTx } from "@/lib/org-settings";          // C4 (name fixed by calendar Phase 2)
import { /* today's day key */ } from "@/lib/shared/org-time"; // C4 (export name pending)

export async function getViewerGroups(viewerPersonId: string, organizationId: string): Promise<ViewerGroup[]> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    const zone = await orgTimeZoneInTx(tx, organizationId);
    const today = /* org-local 'YYYY-MM-DD' for new Date() in `zone` */;
    const result = await tx.execute(sql`
      select g.id as group_id, g.name as name
        from groups g
       where g.organization_id = ${organizationId}::uuid
         and g.derived_from is distinct from 'active_membership'
         and exists (
           select 1
             from group_memberships gm
            where gm.group_id = g.id
              and gm.organization_id = g.organization_id
              and gm.person_id = ${viewerPersonId}::uuid
              and gm.starts_on <= ${today}::date
              and (gm.ends_on is null or gm.ends_on > ${today}::date)
         )
       order by lower(g.name), g.name, g.id
    `);
    return rows.map((r) => ({ groupId: r.group_id, name: r.name }));
  });
}
```

- **Why `exists`, not a join:** a person holding two overlapping current rows in one group (a data anomaly the schema allows — two non-consecutive derived terms) would otherwise render two identical pills with duplicate React keys. `exists` yields each group once.
- **Currency:** `starts_on <= today` and (`ends_on is null` or `ends_on > today`). A membership ended *today* is ended; one starting *today* has started. This diverges deliberately from the admin roster (`ends_on is null` only, `groups.ts:314-338`); the header comment says so.
- **Ordering:** alphabetical, case-insensitive (`lower(g.name)`), ties by exact name then id — deterministic. Rendered in this order; no re-sort in the component.
- **No cap, no `+N more`.** The query has no `limit`.
- **Includes** managed groups and the derived `session` and `diaconate` groups. **Excludes** `derived_from = 'active_membership'` — filtered on `derived_from`, **never on the name** (a managed group may legally be named "Active Membership").
- **`organization_id` appears on both sides** of the join condition and in the outer `where`, so a cross-org row cannot match even if RLS were misconfigured.
- **Header comment (required text):** why this lives outside `src/lib/groups.ts` (that module's header promises a `groups.manage` gate on every export and a `membership_source = 'managed'` filter on every read; this function breaks both on purpose); the four conditions verbatim; "RLS on these tables is tenancy-only, so `gm.person_id = viewerPersonId` is the only thing making this a self-read — it is paper, not database"; "a member-facing groups page would get its own `groups.view` permission; this function stays self-only".

**The four architect conditions, as built and as pinned:**

| # | Condition | How it is held | Pinned by |
|---|---|---|---|
| 1 | No target-person parameter | arity is exactly 2; `viewerPersonId` is the only person id | `expect(getViewerGroups.length).toBe(2)`; page test asserts the call is `("person-1","org-1")` from `resolved.org` |
| 2 | Projection is id + name only | the select list and `ViewerGroup` | DB test asserts every returned object has exactly the keys `groupId`, `name` (`Object.keys(...).sort()`) |
| 3 | "Today" from the org-zone helper | `orgTimeZoneInTx` + pure day-key helper, bound as `'YYYY-MM-DD'` text; no `current_date`, no `now()` | fake-clock zone test below |
| 4 | DB-backed self-scope proof | `my-groups.test.ts` | cases below |

**`src/lib/org-portal/my-groups.test.ts` (new, DB-backed, `describe.skipIf(!hasDb)`)** — all tests run with `vi.useFakeTimers({ toFake: ["Date"] })` and `vi.setSystemTime(new Date("2026-03-02T03:00:00Z"))` (org-local New York is still **2026-03-01 22:00**, UTC is already 03-02, which is what makes the zone observable). `afterAll` restores real timers. Fixture, house style (`find-person.test.ts` / `directory.test.ts`): orgs A and B (`deletableUntil`), the `roster`/`court` group types, each org's `active_membership` derived group created **before** any membership (drizzle/0017), A's `session` and `diaconate` derived groups created **before** any officer term (F16); people: **viewer V** (memberships at A and B — the second inserted inside one `platform.transaction` that first runs `select set_config('app.person_claim_authorized', V, true)` to satisfy F21, with `currentRoll: null` at B so `memberships_one_active_roll_idx` is not hit) and **other member O** (A only). Org A `organization_settings` row `time_zone = 'America/New_York'` (via platform SQL upsert). Group rows:

| Group (org A unless noted) | Membership | Expected for `getViewerGroups(V, A)` |
|---|---|---|
| "Altar Guild" managed | V, starts 2020-01-01, ends null | included |
| "choir" (lowercase, managed) | V, current | included, sorted between "Altar Guild" and "Session" (proves case-insensitive order) |
| "Session" derived `session` | V holds an active `ruling_elder` `officer_terms` row (trigger materialises the `group_memberships` row; do not insert it directly — `group_memberships_reject_derived`) | included |
| "Board of Deacons" derived `diaconate` | V holds an **ended** `deacon` term | excluded (ended membership) |
| "Active Membership" derived `active_membership` | V's row exists (materialised by the memberships trigger) | **excluded**; the fixture first asserts the row exists in `group_memberships`, so the case is not vacuous |
| "Book Club" managed | V, ends 2025-12-31 | excluded (ended) |
| "Future Study" managed | V, starts 2999-01-01 | excluded (not started) |
| "Ends Tomorrow Local" managed | V, ends 2026-03-02 | **included** under New York (`today` = 03-01) |
| "Starts Tomorrow Local" managed | V, starts 2026-03-02 | **excluded** under New York |
| "Ended Today Local" managed | V, ends 2026-03-01 | excluded (`ends_on > today` is false on the boundary) |
| "Garden Team" managed | O only | excluded (other member) |
| "Altar Guild" shared by O as well | O also in Altar Guild | V's result lists Altar Guild once, and nothing about O |
| "Bell Ringers" managed, **org B** | V (as a B member) | excluded from `getViewerGroups(V, A)`; `getViewerGroups(V, B)` returns exactly `["Bell Ringers"]` and no A group |
| "Dual Row" managed | V, **two** overlapping current rows | returned once (the `exists` shape) |

Further cases: (a) every returned object's keys are exactly `["groupId","name"]`; (b) arity is 2; (c) **zone**: update A's `time_zone` to `'UTC'` — "Ends Tomorrow Local" becomes excluded and "Starts Tomorrow Local" included, proving the org zone, not the server's, decides; (d) **missing settings row**: delete A's row — results equal the New York case (the calendar's default); (e) a non-member person id rejects with `OrgAccessError`; (f) a malformed id rejects (genuine DB failure propagates, not swallowed); (g) a person with no group rows returns `[]`.

### B.2 `directory.ts` additions and `home-data.ts`

**`src/lib/directory.ts`** (feature commit): `export` the existing `checkDirectoryView`; add

```ts
export async function countHouseholdDirectoryMembers(tx: OrgTx, organizationId: string, householdId: string): Promise<number> {
  return countDirectoryRows(tx, organizationId, { householdId, includeHidden: false });
}
```

with a doc comment: *"Counts the people the ordinary directory would show in this household. Performs NO permission check — the caller must have established `directory.view` in the same transaction (`checkDirectoryView`). `includeHidden` is deliberately not a parameter: home is not an elevated surface."* Tradeoff recorded in the comment: `countDirectoryRows` carries the three lateral contact joins it does not need; fine because a household is a handful of rows behind `memberships_org_household_idx` — revisit only if a count ever runs unscoped.

**`src/lib/org-portal/home-data.ts`** — still one `withOrgContext()` transaction. Body, in order:

1. The viewer's own row (`first_name`, `preferred_name`, `household_id`) — unchanged, permission-less: the display name needs no grant.
2. `const canViewDirectory = await checkDirectoryView(tx, personId, organizationId);`
3. Only if `canViewDirectory && personRow?.household_id`: read the household name (`select name from households where id = $1::uuid and organization_id = $2::uuid`), then `const memberCount = await countHouseholdDirectoryMembers(tx, organizationId, householdId)`. **`household` is non-null only if `memberCount >= 2`.** The old `left join memberships … count(hm.id) filter (where hm.ended_on is null)` query is deleted outright.
4. Return `{ displayName, canViewDirectory, household }`.

Pinned consequences: a widow whose spouse is deceased (count 1) sees no household card; a hidden viewer with a visible spouse (D3) sees none; a viewer without `directory.view` gets `canViewDirectory: false`, `household: null`, and still a display name; a viewer who is themselves ineligible (a visitor) but whose household has two eligible members sees "2 members" — it is the directory's count, and the card links to a page that shows exactly those two.

**Rewritten module header (required content):** the display name is a permission-less read of the viewer's own row (the `withOrgContext` membership check is its whole gate); `canViewDirectory` and the household block run `directory.view` through the directory module's own `checkDirectoryView` — the old "No permission check runs here, on purpose" sentence is deleted because it is no longer true; the household count is the directory's count (`countHouseholdDirectoryMembers`), never a private copy of the eligibility rule (F136); a household with fewer than two eligible members is not shown, and why (D2/D3); `memberCount >= 2` by construction.

**`find-person.ts` (feature commit, trivial):** replace its private `directory.view` SQL with the now-exported `checkDirectoryView(tx, personId, organizationId)`; behaviour identical; one fewer copy.

**Tests — `src/lib/org-portal/home-data.test.ts` (DB-backed, extended).** The fixture gains what `directory.test.ts:144-200` has and this file lacks: the `directory.view` permission upsert, a `member` role bound to it, and a `role_grants` row to the org's `active_membership` group; plus a second org **B** (own `active_membership` group, **no** binding) with one person and a two-member household. Fixture households (all invented names): **H1** (viewer `withPreferred`): `withPreferred`, `householdMemberOne` (eligible), `householdMemberTwo` (ended), one deceased member, one `directory_hidden` member, one `visitor`-engagement member with null roll; **H2**: `soloWidow` + a deceased spouse; **H3**: `hiddenViewer` (`directory_hidden`) + `visibleSpouse`. Cases (existing ones kept and updated):

| Case | Expectation |
|---|---|
| no household id | `household: null`, `canViewDirectory: true`, display name |
| preferred name wins | `"Bart"` |
| H1 count | `household` equals `{ id, name, memberCount: 2 }` — ended, deceased, hidden and off-roll members all excluded (replaces the old "counts only CURRENT members" test, whose number is unchanged but whose rule is now the directory's) |
| H2 (household of one) | `household: null` |
| H3 hidden viewer, visible spouse (D3) | `household: null`, display name still returned |
| org B viewer, no `directory.view` | `canViewDirectory: false`, `household: null`, display name returned — B's household has two eligible members and the result is still null, proving the household read is gated and not merely filtered |
| agrees with the household page | for H1, `memberCount` equals `getHouseholdDetail(...).household.memberCount` for the same viewer (F136 equivalence guard) |
| DB failure / `OrgAccessError` | unchanged: malformed id rejects; random uuid rejects `OrgAccessError` |

**`src/lib/directory.test.ts`** (feature commit): `countHouseholdDirectoryMembers` — `householdVisible` → `2` (with the Part A `endedMember` in it); `householdHiddenOnly` → `0`; orgB's household called under orgA → `0`; called with orgB's tx for orgB's household → `1`. Run inside `withOrgContext(control, orgA, …)`.

### B.3 `src/lib/org-portal/main-row.ts` — `composeMainRow` (pure)

No `server-only`, no React, type-only imports of `PortalHomeHousehold`, `ViewerGroup`, `MemberEventsResult`, `UpcomingMemberEvent`. Unit-tested the way `computeDestination` is. Rules, exhaustively:

- **yours** is non-null iff `household !== null || groups.length > 0`; it carries both as given (either may be empty/null).
- **upcoming**, from `events`:
  - `{ ok: false }` (the read threw a non-`OrgAccessError`) → `{ kind: "failed" }`
  - `{ ok: true, value: { kind: "disabled" } }` or `{ kind: "forbidden" }` → `null` (card absent)
  - `{ ok: true, value: { kind: "ok", data: [] } }` → `{ kind: "empty" }`
  - `{ ok: true, value: { kind: "ok", data: [...] } }` → `{ kind: "events", events: data }` (no re-slicing; the list function clamps)
- **layout:** the count of non-null cards: `0 → "none"`, `1 → "single"`, `2 → "double"`. Order is fixed: Yours first, Coming up second.
- Does not mutate its input (tested with a deep-frozen input). It does **not** re-apply household suppression; that rule lives only in `getPortalHomeData` (D2).

`UPCOMING_EVENTS_LIMIT = 4` is exported from this file so the page (which passes it) and any test share one definition; tuned in the browser at Phase 4, changed only here.

**`src/lib/org-portal/main-row.test.ts` (new)** — table-driven: (1) nothing/nothing/disabled → `none`; (2) household only + forbidden → `single`, `upcoming: null`; (3) groups only (household null) → `yours` present; (4) household + groups → both inside `yours`; (5) events with rows only → `single`; (6) `ok` with zero rows → `empty`, still `single`; (7) failed loader → `failed`, shown; (8) `disabled` and `forbidden` each → `upcoming: null` even when `yours` exists; (9) groups `[]` + household present (groups failed upstream) → `yours` with household; (10) groups `[]` + household null → `yours: null`; (11) everything present → `double`; (12) frozen-input purity; (13) `UPCOMING_EVENTS_LIMIT` equals 4.

### B.4 Components (all Server Components; no `'use client'`; tokens only, no palette literals, no `text-xs`, no px)

**`src/components/org-portal/home-main-row.tsx`** — `HomeMainRow({ slug, plan, householdPageEnabled })`.
- `plan.layout === "none"` → `null` (no wrapper element at all).
- Otherwise `<div className={cn("grid items-start gap-6", plan.layout === "double" && "md:grid-cols-2")}>` containing `<YoursZone …/>` then `<UpcomingEventsCard …/>`, each only if non-null in the plan. A `single` plan therefore renders a one-column grid, which is full width — never a blank half. Presence is a render-time branch on the server; nothing measures the DOM.
- Each card owns its own `<section aria-labelledby>` and `<h2>`; the row adds no heading.

**`src/components/org-portal/yours-zone.tsx`** — props `{ slug, household, groups, householdPageEnabled }`. Returns `null` when `!household && groups.length === 0` (a defensive duplicate of the plan only for the "render nothing" half; it contains no other business rule). Otherwise `<section aria-labelledby="yours-zone-heading" className="space-y-3"><h2 id="yours-zone-heading" className="text-xl font-semibold">Yours</h2><Card><CardContent className="space-y-6">…`:
- **Household block** (if `household`): `<div className="space-y-3">`, `<h3 className="text-lg font-medium break-words">{household.name}</h3>`, `<p className="text-sm text-muted-foreground">{memberCount} members</p>` (always plural: `memberCount >= 2` by construction — the old singular branch is deleted), then one link: when `householdPageEnabled`, `href=/o/<slug>/directory/households/<household.id>` with text **"View household →"**; otherwise `href=/o/<slug>/directory` with the existing text **"View directory →"**. Link classes unchanged from today's (`inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline focus-visible:…ring-offset-2…`).
- **Groups block** (if `groups.length > 0`): `<div className="space-y-3"><h3 id="yours-groups-heading" className="text-lg font-medium">My groups</h3><ul aria-labelledby="yours-groups-heading" className="flex flex-wrap gap-2">`, one `<li key={groupId} className="min-w-0 max-w-full"><Badge variant="secondary" className="max-w-full shrink whitespace-normal break-words px-3 py-1 text-left text-sm">{name}</Badge></li>`. `variant="secondary"` is the contract's neutral chip surface (`contract.ts` `--secondary`: "a chip label is content and is read at 7:1") and carries no hover style when rendered as a `span` (its hover selectors are `[a&]`). The `text-sm` override (twMerge replaces the primitive's `text-xs`) keeps the pill off the micro size the member-facing floor forbids; `whitespace-normal break-words` overrides the primitive's `whitespace-nowrap` so a long name wraps inside the pill instead of overflowing; `rounded-full` stays (judge in the browser; if a two-line pill reads badly, `rounded-xl` is the sanctioned fallback). **No links, no `title`, no truncation, no cap, no "+N more".** The generated `badge.tsx` is not edited.
- Block order: household, then groups. Either block omitted when empty.

**`src/components/org-portal/upcoming-events-card.tsx`** — props `{ slug, state: UpcomingCardState }`. Always `<section aria-labelledby="upcoming-events-heading" className="space-y-3"><h2 id=… className="text-xl font-semibold">Coming up</h2><Card><CardContent className="space-y-4">`.
- `state.kind === "events"`: `<ul className="divide-y divide-border">`, one `<li>` per event, each a single `<Link href={`/o/${slug}/calendar/${event.id}`} className="group flex min-h-11 items-start justify-between gap-3 py-3 …focus ring classes…">` (C6):
  - left column (`min-w-0`): title — `<span className="block break-words text-base font-medium text-primary group-hover:underline underline-offset-4">`; then a `flex flex-wrap items-center gap-x-3 gap-y-1` row holding the date-and-time text `text-sm text-muted-foreground` — **"Sun, Oct 18 · 10:30 AM"** (start only, no end time) from the calendar's pure wall-clock formatters applied to `startsAtWallClock` (C2) — and the type chip (C3); then, only if `location` is non-null, `<span className="block break-words text-sm text-muted-foreground">{location}</span>`.
  - right: `<ChevronRight aria-hidden className="mt-1 size-5 shrink-0 text-muted-foreground" />` — the visible affordance beyond hover (ui-standards: hover is never the only affordance).
  - Footer link below the list: **"See the full calendar →"** → `/o/<slug>/calendar`, same classes as the Yours link.
- `state.kind === "empty"`: `<p className="text-base">Nothing is on the calendar right now.</p>` and a link **"Open the calendar →"** → `/o/<slug>/calendar`.
- `state.kind === "failed"`: `<p className="text-base">We can't load upcoming events right now. Try again in a moment.</p>` and the same **"Open the calendar →"** link.
- No times via `toLocale*` or `Date` getters anywhere in the component (ESLint rule and `check:sql-date` stay green); the card only forwards text the SQL already produced. `end` is never rendered (so `endsAtWallClock` is unused by this card).

### B.5 `src/app/(org)/o/[slug]/page.tsx`

Unchanged and in order: `cachedAuth` → `/signin` redirect; `resolveOrgContext` switch (not-found / forbidden / ended); `await assertOrgAccess(personId, organizationId)`; `await isFlagEnabled("org_portal.home_v2")`; the OFF branch (`OrgPortalStub`, three sequential flag reads) **untouched** — it is the regression floor. After the ON decision, **one** `Promise.all`:

```tsx
const ids = { personId: resolved.org.personId, organizationId: resolved.org.organizationId };
const [motionEnabled, directoryEnabled, directoryV2Enabled, feedbackEnabled,
       home, groups, events, tiles, promptState] = await Promise.all([
  isFlagEnabled("org_portal.motion"),
  isFlagEnabled("org_portal.directory"),
  isFlagEnabled("org_portal.directory_v2"),
  isFlagEnabled("org_portal.feedback"),
  loadWidget("home",   ids, () => getPortalHomeData(ids.personId, ids.organizationId)),
  loadWidget("groups", ids, () => getViewerGroups(ids.personId, ids.organizationId)),
  loadWidget("events", ids, () => listUpcomingMemberEvents(ids.personId, ids.organizationId, { limit: UPCOMING_EVENTS_LIMIT })),
  visiblePortalTiles("operate", resolved.org.organizationType, ids),   // C5: argument shape per the calendar's Phase 3
  getFeedbackPromptState(session.user.id),                            // keyed by users.id, NOT personId — unchanged
]);
```

`loadWidget` is a non-exported function in `page.tsx` (the architect's "small local wrapper"):

```tsx
async function loadWidget<T>(widget: "home" | "groups" | "events", ids: {...}, read: () => Promise<T>): Promise<Loaded<T>> {
  try { return { ok: true, value: await read() }; }
  catch (err) {
    if (err instanceof OrgAccessError) throw err;                 // error.tsx owns that copy
    console.error("[org-home] widget read failed; degrading", { widget, ...ids });   // never `err`, never `err.message`
    return { ok: false };
  }
}
```

Then, synchronously: `homeData = home.ok ? home.value : null`; `canViewDirectory = homeData?.canViewDirectory === true`; `plan = composeMainRow({ household: homeData?.household ?? null, groups: groups.ok ? groups.value : [], events })`; `showFeedbackPrompt = feedbackEnabled && shouldShowFeedbackPrompt(promptState)`. Render:

```tsx
<div className="space-y-8">
  <GreetingBand displayName={homeData?.displayName ?? null} motionEnabled={motionEnabled} />   {/* data-testid="greeting-band" stays */}
  {canViewDirectory && <FindPersonForm slug={resolved.org.slug} />}
  <HomeMainRow slug={resolved.org.slug} plan={plan} householdPageEnabled={directoryEnabled && directoryV2Enabled} />
  <DomainTileSections … unchanged props … />
  {showFeedbackPrompt && <FeedbackPromptCard />}
</div>
```

**How each failure renders (architect's table, as built):**

| Failure | Greeting | Find-a-person | Yours | Coming up |
|---|---|---|---|---|
| `home` read throws | "Welcome." | **hidden** (`canViewDirectory` unknown, fail closed) | household absent; groups pills still render if the groups read worked | unaffected |
| `groups` read throws | unaffected | unaffected | groups block omitted; household still renders | unaffected |
| `events` read throws | unaffected | unaffected | unaffected | card shows the Flow 2c copy |
| `OrgAccessError` from any of the three | `error.tsx` (re-thrown through `Promise.all`) | — | — | — |
| `kind: "disabled"` / `"forbidden"` | — | — | — | card absent, no message |

**No `Suspense`, no `loading.tsx`** anywhere in `/o/[slug]` (CLAUDE.md `(org)` contract; DECISION-162). The page docblock is rewritten: the "NON-ESSENTIAL summary ... degrades to null" paragraph and the "yours zone" mentions now describe the composition above and name `loadWidget`'s three outcomes.

A cost named out loud: `Promise.all` makes the page's latency the slowest of its reads instead of their sum — strictly better than today's sequential awaits — and the failure of one `loadWidget` never cancels the others (`OrgAccessError` excepted, which is meant to abort).

### B.6 Contingent imports — for the orchestrator to reconcile with the calendar's Phase 3

Everything below is named by the architects' relays but not yet fixed by the calendar's Phase 3. **Phase 3 of this pipeline closes when each is confirmed or the name is substituted here.** Where a name is not yet fixed, this design writes the *role* and the implementer takes the exact identifier from the merged calendar code — not from a guess.

| # | Import / fact | Source (relay) | Used by | Status |
|---|---|---|---|---|
| C1 | `listUpcomingMemberEvents`, `MemberEventsResult<T>`, `UpcomingMemberEvent` exported from `@/lib/calendar` (`src/lib/calendar.ts`, `server-only`) with the architect's exact shapes (`kind: ok \| disabled \| forbidden`; `startsAtWallClock`/`endsAtWallClock` as `'YYYY-MM-DDTHH:mm'` text; `eventType: {name, colorToken, iconKey} \| null`); `limit` clamped 1..12 | home Phase 2 contract; calendar Phase 2 placement | `page.tsx`, `main-row.ts` (type-only) | **contingent — confirm** |
| C2 | Pure formatters in `src/lib/calendar/wall-clock.ts` that turn `'YYYY-MM-DDTHH:mm'` into a time ("10:30 AM") **and a date label ("Sun, Oct 18")**. Phase 2 names only the time formatter. If the calendar exports no date-label formatter, this design **requests one** (static weekday/month arrays already live in `src/lib/calendar/month.ts`); the home card must not grow a second formatter | calendar Phase 2 (`wall-clock.ts`, `month.ts`) | `upcoming-events-card.tsx` | **contingent — request a date-label export** |
| C3 | Event-type chip component under `src/components/org-portal/event-types/` that accepts `UpcomingMemberEvent["eventType"]` **including `null`** (renders the fallback/neutral) | calendar Phase 2 (R-event-types placement) | `upcoming-events-card.tsx` | **contingent — confirm prop shape and null handling** |
| C4 | `orgTimeZoneInTx(tx, organizationId)` from `@/lib/org-settings` (name fixed); a pure helper in `@/lib/shared/org-time` returning org-local today as `'YYYY-MM-DD'` for a `Date` and a zone (Phase 2 says "`wallClockNow(now, tz)` / today's day key" — export name pending) | calendar Phase 2 R2 | `my-groups.ts` | **name fixed for the accessor; pure helper name pending** |
| C5 | `visiblePortalTiles` from `@/lib/org-portal/visible-tiles` taking `viewer: { personId, organizationId }` — argument position pending (this design assumes a third parameter) | calendar Phase 2 R1 | `page.tsx`, `page.test.tsx` | **contingent — confirm signature** |
| C6 | Member detail route `/o/<slug>/calendar/<eventId>`; list route `/o/<slug>/calendar` | calendar Phase 2 relay | `upcoming-events-card.tsx` | named (relay); confirm unchanged |
| C7 | "Listed until its day ends" policy confirmed (`starts_at >= org-local start of today`, so this morning's event stays listed all day); `now` option is test-only and the page never passes it; seeded-on toggle means an ordinary member sees the card on day one | home Phase 2 contract; calendar Phase 2 R2/R-toggle | the card's behaviour | **contingent — confirm** |

If any of C1/C3/C5 differs from what is written here, only the three files named in the "Used by" column change; nothing else in this design moves.

---

## Component / Page Plan

- **Pages to create:** none. No route, no `loading.tsx`.
- **Components to create:** `src/components/org-portal/home-main-row.tsx`, `src/components/org-portal/upcoming-events-card.tsx`.
- **Pure/server modules to create:** `src/lib/org-portal/my-groups.ts`, `src/lib/org-portal/main-row.ts`.
- **Files to modify:** `src/lib/directory.ts` (Part A: predicate + `findDirectoryPersonIds`; Part B: export `checkDirectoryView`, add `countHouseholdDirectoryMembers`), `src/lib/org-portal/find-person.ts`, `src/lib/org-portal/home-data.ts`, `src/components/org-portal/yours-zone.tsx`, `src/app/(org)/o/[slug]/page.tsx`.
- **Not touched:** `src/components/ui/badge.tsx`, `tile-grid.tsx` (R2), `greeting-band.tsx` (F137 released), `tiles.ts`/`visible-tiles.ts` (the calendar's), `src/lib/groups.ts`, `src/lib/permissions.ts`, any schema or `drizzle/` file, `find-person-action.ts`, and every Rule-16 file.

## Implementation Order

1. **Part A** (split pipeline, or this pipeline's first commit): failing-first tests → predicate edit + `findDirectoryPersonIds` + `find-person.ts` → green → `fix(directory):`.
2. *(wait for the calendar and Part A to be on `main`; branch fresh)* Failing-first DB tests for `getViewerGroups`, `countHouseholdDirectoryMembers` and the extended `home-data` cases.
3. `feat(portal-home): the viewer's groups and a directory-accurate household count` — `my-groups.ts`, `directory.ts` additions (+ `checkDirectoryView` export), `home-data.ts`, `find-person.ts` swap to the exported check, `yours-zone.tsx` (groups block, link target, singular branch removed) with its tests, and the minimal `page.tsx` change that passes `groups`/`canViewDirectory`/`householdPageEnabled` so the tree stays green. Depends only on the merged calendar's `org-settings`/`org-time` (C4).
4. `feat(portal-home): the Coming up card and the main row` — `main-row.ts` (+ test), `upcoming-events-card.tsx`, `home-main-row.tsx` (+ tests), `page.tsx` final wiring (`Promise.all`, `loadWidget`, `visiblePortalTiles` viewer arg), `page.test.tsx` rewrite. Depends on C1–C3, C5–C7.
5. `test(e2e): portal home cards at three widths` — new fixture block in `e2e/support/seed-orgs.ts` + spec (below).
6. Browser verification (Phase 4 gate, before QA): 360 / 768 / 1280 px and 200% zoom, both cards / one card / no cards, a 60-character unbroken group name, a 60-character unbroken event title, a long location; keyboard tab order and focus rings; print preview not required (the home is not a print surface).
7. Audit events: **none** (read-only; `check:audit` unaffected).
8. Housekeeping at ship (orchestrator, Rules 10/14/15): `docs/TODO.md`, `docs/schema-design-2.md` F136, `docs/decisions.md` DECISION-162, release notes, functionality map, `docs/STATE.md`; `/release-notes` skill. `docs/architecture.md` is **not** updated (no new subsystem, data flow or runtime shape).

Each commit is independently green: `npm run typecheck`, `npm run lint`, `npm test`, the DB suites for touched modules (`--no-file-parallelism`, `.env.local` pointed at the pipeline's Neon branch), `npm run check`, and `npm run build` before QA.

## Tests to update and add

| File | Change |
|---|---|
| `src/lib/directory.test.ts` | Part A fixture + 6 tests (A.4); Part B: `countHouseholdDirectoryMembers` cases (B.2) |
| `src/lib/org-portal/find-person.test.ts` | Part A fixture + tests 7–8 |
| `src/lib/org-portal/my-groups.test.ts` | **new**, DB-backed (B.1) |
| `src/lib/org-portal/home-data.test.ts` | extended fixture and cases (B.2); the old "counts only CURRENT household members" test is rewritten as the H1 case |
| `src/lib/org-portal/main-row.test.ts` | **new**, pure (B.3) |
| `src/components/org-portal/yours-zone.test.tsx` | **household-of-one case changes deliberately**: the "uses singular 'member' for a household of one" test (`:23-32`) is **deleted** — its premise (a card for one person) is now unreachable and pinned instead at the data layer (`home-data.test.ts` H2/H3). Kept/updated: card with name, "3 members", and — new — "View household →" to `/o/alder-creek/directory/households/h1` when `householdPageEnabled`, "View directory →" to `/o/alder-creek/directory` when not; household null renders no household block. New: groups block renders pills in the given order with no links (`queryAllByRole("link")` excludes them), a 60-character unbroken name keeps `break-words`/`whitespace-normal` classes, no `text-xs` class on any pill, groups-only (household null) renders the card with only the groups block, household-only omits the groups heading entirely, both empty renders nothing (`container.textContent === ""`, no `<section>`). The test file header comment records why the singular case went |
| `src/components/org-portal/upcoming-events-card.test.tsx` | **new**: h2 "Coming up"; one link per event with `href` `/o/<slug>/calendar/<id>`; date/time text from the (mocked or real) formatters; location shown only when present; chip rendered per row incl. `eventType: null`; footer "See the full calendar →"; `empty` copy and "Open the calendar →"; `failed` copy; a long unbroken title keeps `break-words`; no `text-xs`; the chevron is `aria-hidden` |
| `src/components/org-portal/home-main-row.test.tsx` | **new**: `none` renders nothing (empty container); `single` renders no `md:grid-cols-2`; `double` renders `md:grid-cols-2 items-start`; Yours precedes Coming up in DOM order; each card has its own `h2` with the exact heading names; `householdPageEnabled` is forwarded |
| `src/app/(org)/o/[slug]/page.test.tsx` | rewritten mocks and new cases below |
| `e2e/portal-home-cards.spec.ts` | **new** (outline below) |

**`page.test.tsx` — mock changes:** `FindPersonForm` mock becomes `() => <div data-testid="find-person-form-stub" />` (it is `() => null` today, so presence is untestable); add mocks for `@/lib/org-portal/my-groups`, `@/lib/calendar` (C1), `@/lib/org-portal/visible-tiles` (C5; `@/lib/org-portal/tiles` keeps `DOMAIN_ORDER`/`DOMAIN_LABELS`); `getPortalHomeData` resolves `{ displayName, canViewDirectory, household }`. The `isFlagEnabled` mocks gain `org_portal.directory` / `org_portal.directory_v2`. New and changed cases:
1. Gate ordering: `assertOrgAccess` is held on a deferred promise; none of the three loaders has been called until it resolves.
2. Concurrency: with all three loaders on deferred promises, all three have been **called** before any is resolved (the `Promise.all`).
3. Loader arguments: `getViewerGroups("person-1","org-1")`; `listUpcomingMemberEvents("person-1","org-1",{ limit: 4 })`; `visiblePortalTiles("operate","congregation",{ personId:"person-1", organizationId:"org-1" })` (C5).
4. Find-a-person: present when `canViewDirectory` true; absent when false; absent when the home read throws.
5. Household link: `directory` and `directory_v2` both on → "View household →" to the household route; either off → "View directory →".
6. Groups: pills render; a non-`OrgAccessError` groups failure omits them, keeps the greeting and household, and `console.error` was called with the fixed string and an object whose JSON does not contain the thrown message; `OrgAccessError` from groups re-throws.
7. Events: `ok` with rows → "Coming up" with row links and the footer link; `ok` with `[]` → empty copy; `disabled` → no "Coming up" heading; `forbidden` → none; thrown error → failure copy and the same fixed log; `OrgAccessError` from the events loader re-throws; `OrgAccessError` from the home loader re-throws (kept from today).
8. The page requests **no flag key containing "calendar"** and never imports a permission helper (assert on `isFlagEnabled` calls).
9. Layout smoke: both cards present → the grid wrapper has `md:grid-cols-2`; neither → no grid wrapper element at all.
10. `existsSync` on `src/app/(org)/o/[slug]/loading.tsx` is `false` (pins the contract), and the page module source contains no `Suspense` import.
11. Kept: OFF branch regression floor (loaders never called), motion ON/OFF wiring, feedback-prompt three cases, tiles passthrough (`props.tiles` is the loader result), the unauthenticated redirect and not-found cases.

## e2e blast radius

**Existing specs that assert behaviour this change alters:** none. The only specs that open the `home_v2` org home assert `data-testid="greeting-band"` — `e2e/post-login-routing.spec.ts` (cases 4, 6, 7), `e2e/admin-login.spec.ts:39`, `e2e/totp-callback-bypass.spec.ts` (`:58`, `:78`, `:132`, `:152`), `e2e/totp-full-login.spec.ts` — and `GreetingBand` is not touched. None asserts "Yours", the household count, or Find-a-person; `e2e/member-home.spec.ts` exercises the platform `/home`, not the org home. `e2e/visual-parity.spec.ts` does not visit `/o/*`. **Indirect risk:** the existing e2e orgs (`e2e-alpha`, `e2e-presbytery`) are provisioned by `seed-orgs.ts` raw SQL, not `createOrganization()`, so they have no calendar toggle row and (unless the calendar pipeline's seed changes add one) read as `disabled`: the Coming up card will simply be absent for them, which no existing spec contradicts. The implementer runs the full `npm run test:e2e` before Phase 5 and treats any newly red existing spec as this pipeline's to fix.

**New spec `e2e/portal-home-cards.spec.ts` (outline).** New fixture block appended to `e2e/support/seed-orgs.ts` (idempotent, fixed UUIDs, invented names, `.invalid` addresses, platform connection as the file already documents): two orgs — `e2e-home` (calendar toggle on, `events.view` and `directory.view` bound to the org's `active_membership` group, three upcoming events and one series whose first occurrence is in the past) and `e2e-home-nocal` (toggle off, `directory.view` bound) — and four users: `home-both` (at `e2e-home`: a two-person eligible household, one managed group, plus a group with a 60-character unbroken name), `home-events-only` (at `e2e-home`: no household, no groups), `home-yours-only` (at `e2e-home-nocal`: household and group), `home-none` (at `e2e-home-nocal`: nothing). New `E2ERole` entries and `E2E_USERS` rows follow the existing pattern. Event/toggle table and column names are the calendar's (C-dependency); the implementer reads them from the merged `0054`.

| Case | Viewport | Assertions |
|---|---|---|
| both cards | 360×800 | `greeting-band` visible; "Yours" and "Coming up" headings visible; Coming up's top is below Yours' bottom and their left edges match (stacked); `document.documentElement.scrollWidth <= clientWidth` (no horizontal scroll, long group name wraps); event rows are ≥ 44 px tall; the groups pill has no `a` ancestor |
| both cards | 768×1024 | Yours and Coming up share a top (±1 px) and Coming up's left edge is right of Yours' (side by side at `md`); heading order h1, then h2 Yours, h2 Coming up, then the domain h2s |
| both cards | 1280×800 | same as 768; each card's width < 60% of `main` |
| events only (`home-events-only`) | 768 | no "Yours" heading; "Coming up" card's width ≥ 90% of `main` (full width, no blank half) |
| yours only (`home-yours-only`) | 768 | no "Coming up" heading, no calendar link on the page; Yours full width |
| none (`home-none`) | 360 and 1280 | neither heading; `greeting-band` and the tile grid still render; no empty bordered box between them |
| a passed-parent series | 1280 | the series appears once, with its next occurrence's date (guards the fpcw parent-filter bug end to end) |
| Find-a-person | 768 | visible for `home-both`; for a fixture user without `directory.view` it is absent (add one such user or reuse an existing no-grant fixture) |
| link targets | 768 | clicking an event row reaches `/o/e2e-home/calendar/<id>` (200 and an event title heading); the footer link reaches `/o/e2e-home/calendar` |

No hydration lane spec is needed (no new form, no client component); `check:hydration-gate` is unaffected. 200% zoom is a manual Phase 4 browser check.

## Edge Cases & Risks

- **Directory-hidden viewer** (D3): their household card is intentionally absent when the only other eligible member is one person. Tradeoff: they lose a shortcut, never see a wrong count; the household remains reachable from the directory.
- **Viewer not themselves eligible but household has two eligible others:** card shows "2 members" and links to a page listing those two. Intentional (the count is the directory's).
- **`directory.view` revoked mid-session:** `getPortalHomeData` is read per request; the card and Find-a-person vanish on the next load; the action still refuses on submit.
- **Groups with a free-text name** are admin-authored; rendered as React text; `break-words` for a 60-character string. Group names are the viewer's own and carry no role, roster, `description` or `meets_when`.
- **Events:** a series whose parent has passed still appears (calendar's contract, regression-tested there and in the e2e above); cancelled events never appear (operator ruling 4); an event later today whose start time has passed still shows (C7). `is_public = false` events show to members.
- **Time zone:** the groups read and the events read each compute org-local today inside their own transaction from `organization_settings.time_zone` (default when no row). The greeting still uses the server clock (F137 released; TODO line). On the pipeline machine the test run uses the fake clock; do not rely on the wall clock.
- **Pool pressure:** see Escalation E1.
- **Both card reads fail on a DB blip:** the events card shows the "can't load" copy while Yours shows nothing (household and groups both degrade to absent) — a member would see a page with a failure card and no Yours. Acceptable: the failure copy is honest where a claim ("no events") would be false, and absence makes no claim.
- **`composeMainRow` and the page can disagree** if someone adds a card in one and not the other; the page renders only `HomeMainRow`'s output for the row, so the plan is the single source of "which cards".
- **Badge primitive:** its default `text-xs` is overridden at the call site; the primitive itself is generated and untouched. A future second pill consumer should reuse this exact className — noted in the component's comment.
- **`findPersonMatches` vs directory search semantics** differ (any contact row vs primary only). Pre-existing; TODO line below.
- **Rule-16 files** are edited only by the orchestrator at integration; this pipeline's commits contain none of them (`docs/TODO.md`, `docs/decisions.md`, `docs/schema-design-2.md`, `docs/STATE.md`, `scripts/seed-dev.sql`, `scripts/test-rls.sql`, `drizzle/meta/_journal.json`, `src/lib/db/domain/index.ts`). `scripts/test-rls.sql` needs no change: no policy, grant or table moved.
- **QA gate reminders:** `npm run check:audit` (no `actions.ts` touched), `check:sql-date`, `check:brand-scope` (no brand emitter added), `check:hydration-gate` (no `useForm`), `check:secrets` (fixture names invented; no real data), no native dialogs, no `console.log` (the one `console.error` is the specified fixed-string log).

## Out of Scope (for the user to confirm)

Signups; call-in procedures; the `/instructions` help link; fpcw's church/sun/moon icons; tile count badges and the badge hook (R3); tile column or density changes (R2); hiding tiles by permission (R1); client-side height trimming (R5); a member-facing group detail page or link from pills; showing recurrence ("repeats weekly") or end times on event rows; an events "audience" filter; relative day labels ("Today", "Tomorrow"); fixing the greeting's server-clock hour (F137, released); changing find-a-person's search semantics; per-org tile labels; any `scripts/seed-dev.sql` demo data (the calendar pipeline owns event fixtures; the implementer creates throwaway rows on the pipeline's Neon branch for browser verification).

## Escalation to Phase 2

Nothing in the architect's rulings is unbuildable. Four items for the architect's awareness; **only E1 asks for a response, and it does not block Phase 4**:

- **E1 — the "at most three concurrent tenant transactions" bound is now four.** After the calendar's R1, `visiblePortalTiles` performs an org-toggle read of its own. The page therefore starts four tenant transactions (home, groups, events, tiles), and the layout's nav and footer run their own `visiblePortalTiles` reads in the same render (the calendar says `cache()` dedupes the toggle read per request, which may collapse some). Against `appPool`'s default `max` of 10 (queueing, not failing), two simultaneous home loads can briefly queue. Design stance: keep everything in the one `Promise.all` — serialising tiles after it would add a round trip to every load for a pool-headroom hazard that degrades to latency, not errors. **Requested:** acknowledge the revised bound (four, plus the layout's) and that queueing-not-failing is acceptable; if the architect prefers a number, it goes into DECISION-162's "Failure domains" paragraph at integration.
- **E2 (refinement, not a deviation) — household link target.** The architect wrote "link only when `directory_v2` is on"; the household page also requires `org_portal.directory`, so the rule is both flags (D4). Two extra flag reads in the existing `Promise.all`.
- **E3 (refinement) — `directoryEligibilityWhereSql` stays private**, as required; find-person reaches it through the narrow exported `findDirectoryPersonIds` (D5). `countHouseholdDirectoryMembers` is a second narrow export with a documented no-permission-check precondition. Exporting two helpers is the price of keeping the fragment private.
- **E4 (finding, not blocking) — the `Badge` primitive's default is `text-xs`**, which `docs/ui-standards.md` forbids on member-facing surfaces, and `tile-grid.tsx`'s "Coming soon" badge already renders it on the member home. This design overrides it at the new call site only. A TODO line is drafted; the primitive's fix is its own small pipeline (it is a generated file with a recorded-divergence rule).

## Drafts for integration (orchestrator, at integration)

### `docs/TODO.md` lines (Rule 10)

Next Up (or Backlog, orchestrator's call on priority):

- [ ] **Tile visibility by permission — revisit trigger (DECISION-162, R1).** Accepted cost: an ordinary member sees operate tiles (Members, …) that end in a Forbidden page. When that proves a real support burden, build it as its own pipeline: a per-tile `requires` key, one batched permission read, and a test pinning every tile to its destination's gate. Do not add a second permission check to `tiles.ts` before then. — `docs/work-log/2026-10-14-portal-home-alignment.md`
- [ ] **Roll-approvals count badge on the Members tile (R3).** The one real presby queue is `listPendingRollActions` (`roll.approve`). Needs its own count function with its own permission check plus the flag and `org_portal.members_create` axes; fpcw's `bg-red-600` is a banned palette literal, so it also needs the status-chip token (see the existing status-chip gap). No badge hook was built speculatively. — same
- [ ] **Greeting hour: adopt the calendar's org-zone helper** via an optional `timeZone` prop on `GreetingBand` (`/admin` passes none) and correct the premise in `src/lib/shared/greeting.ts`'s header ("the server's clock is the congregation's timezone" is false on Vercel). F137 was released unused; this is the same org-local-time finding as the calendar's F132–F135. — same
- [ ] **Member-facing group page.** The "My groups" pills are static because every group read requires `groups.manage`. A page needs its own `groups.view` permission and must stay separate from `getViewerGroups` (which is self-only by design). — same
- [ ] **`Badge` default `text-xs` on member-facing surfaces.** `docs/ui-standards.md` forbids `text-xs` for members; the generated primitive defaults to it and the tile grid's "Coming soon" badge renders at that size. Verify, then fix the primitive with a recorded divergence or add a member-size variant. — same
- [ ] **find-person and the directory search disagree on what a "match" is** (any email/phone contact row vs the primary one). A single-match jump can land on a person the fall-through search would not list. Decide one rule and share it; deliberately not changed by the F136 fix. — same

Done (when shipped): the fix pipeline's line (v0.31.1) and this pipeline's line, each dated.

### `docs/schema-design-2.md` — F136 (architect's draft, placed)

Placement: a new `###` subsection immediately after the last F-entry of the same section (after F135 once the calendar integrates; after F131 if this lands first), before `## 3. Section M`.

> ### F136 — the directory eligibility rule exists in three disagreeing forms
>
> **F136 — who counts as "in the directory" was written three times, and the three disagree.** (1) `src/lib/org-portal/home-data.ts` counted a household's members with `ended_on is null` only, so the home card counted deceased, merged, directory-hidden and off-roll people. (2) `directoryEligibilityWhereSql()` in `src/lib/directory.ts` omitted `ended_on is null`, so it listed people whose relationship had ended but whose `engagement_status` stayed `regular` — measured on the pipeline branch, 2 of 44 memberships (`fernwood` and `e2e-beta`, `current_roll` null, `ended_on = 2026-03-31`) — while the access gate `presby_membership_is_active()` already treats them as gone. (3) `findPersonMatches()` carried a hand copy of the predicate, so the single-match jump could send a member to a person page.
>
> **Generalisation:** a count or list of *other people* is directory data even when the scope is the viewer's own household, and it uses the one shared predicate. The access gate's definition of a current relationship (`ended_on is null`) is part of that predicate.
>
> **Fixed** by `fix(directory):` (the predicate gains `and m.ended_on is null`; find-person consumes it through `findDirectoryPersonIds`; failing-first regression tests in `directory.test.ts` and `find-person.test.ts`, including a find-person-versus-directory equivalence guard) and by `2026-10-14-portal-home-alignment` (the home household count now goes through `countHouseholdDirectoryMembers`). Closes the 2026-08-24 portal-home-directory Phase 6 follow-up on the hand-copied predicate.

(F137: released unused; the greeting-hour finding is the TODO line above.)

### DECISION-162 — confirmed as the architect drafted it, with one paragraph appended

The architect's text stands unamended (tile registry stays permission-blind; widget visibility derives from its own read function's result; Find-a-person's `directory.view` page read is the one exception; no density, badge or client-trim; separate transactions under one `Promise.all`; no savepoints; no `Suspense`; the four self-read conditions). Verified against the tree: the tile grid is `grid-cols-1 sm:grid-cols-2` as the Layout paragraph says. **Append, before the closing date line:**

> **Household and main row (Phase 3).** The household card is a directory view of the viewer's own household: its count is `countHouseholdDirectoryMembers`, built on the directory's own query with `includeHidden: false`, so the home page and the household page cannot disagree (F136). A household with fewer than two eligible people is not shown, and a directory-hidden viewer with one visible housemate therefore sees no card, because the count they are not in is one. The household links to its page only when both `org_portal.directory` and `org_portal.directory_v2` are on, otherwise to `/directory`. Which cards render, and whether the main row is one column or two, is a pure function of the loader results (`composeMainRow`), so a lone card takes the full width on the server with no client measurement. **Failure-domain bound (amended):** four concurrent tenant transactions after the gate (home, groups, events, and the tile registry's org-toggle read), plus the layout's; `appPool` queues rather than fails when saturated.

(The last sentence assumes the architect accepts E1; if not, drop it and use the architect's number.)

### Release-note paragraphs (for the `/release-notes` skill; written for a non-engineer)

**Fix, as its own patch (v0.31.1, if split) — "People whose membership has ended no longer appear in the directory"**

*Background:* When a person's connection to a congregation was ended — a transfer out or a removal from the roll — their entry could still appear in the congregation's member directory, and in the "Find a person" box, as long as their engagement had been recorded as "regular." The rest of the system already treated them as no longer part of the congregation, so the directory and everything else disagreed.
*Changes:* The directory, the households view, household and person pages, the parish roster, and Find a person now all leave out anyone whose membership has ended. People whose membership is current are unaffected, and hiding a person from the directory still works exactly as before.

**Feature — "The portal home shows your groups and what is coming up"**

*Background:* The portal home page showed a greeting, a search box and the tools your congregation has switched on. It did not show you what was coming up at church, and its household card could say "2 members" for a household where one person had since died.
*Changes:* The home page now has two cards side by side on a larger screen (stacked on a phone). **Yours** shows your household, counted the same way the directory counts it, and only when at least two people are in it, plus the groups you belong to. **Coming up** shows the next four events, one for each repeating event, and links to the full calendar; it appears only when your congregation has turned the calendar on and you are allowed to see it. If only one card has something to show, it takes the full width. The search box now appears only for people who are allowed to use the directory. If the events or groups cannot be loaded for a moment, only that card is affected and the rest of the page still loads.

### `docs/product/functionality-map.md` (Rule 14)

Replace the "Portal home" bullet at `:66` with:

- Portal home — `/o/<slug>`, gated `org_portal.home_v2` (seeded off; flag off → the original stub): time-aware greeting; find-a-person (server action, single-match jump; shown only to `directory.view` holders, re-checked in the action); a main row of two server-rendered cards — **Yours** (household with the directory's own member count, shown only when two or more people qualify, linking to the household page when the directory flags are on; the viewer's current groups as read-only pills, never the automatic Active Membership group) and **Coming up** (the next four upcoming events, one per repeating series, read through the member calendar's own list function; absent when the calendar is off or the viewer may not read it) — side by side from `md`, a lone card full width; flag-mirroring tool-tile grid, never permission-filtered (DECISION-162). Each widget degrades independently. `src/lib/org-portal/{home-data,my-groups,main-row}.ts`, `src/components/org-portal/{yours-zone,upcoming-events-card,home-main-row}.tsx`, `src/app/(org)/o/[slug]/page.tsx`, `docs/work-log/2026-10-14-portal-home-alignment.md`

And in the long "presby: org portal" bullet at `:18`, change `"Yours" household zone (renders only when non-empty)` to `"Yours" zone (household and groups; renders only when non-empty) and a "Coming up" events card (see Portal home below)`. The short Index entry needs no change unless the calendar pipeline's line moves.

## Implementer

**Part B: `full-stack-developer`.** The work spans a server loader, two SQL helpers, a pure composition function, three server components and the page wiring, but it is small-to-medium and the pieces share two type contracts (`PortalHomeData`/`MainRowPlan`) and one file (`page.tsx`) where the server and presentation halves meet — splitting between `api-developer` and `ux-developer` would put a handoff on exactly the seam most likely to drift, for no parallelism gain (the UI is Server Components with no client logic). Commits 3–5 in the Implementation Order are the natural sub-passes.

**Part A: `api-developer` if split** (server SQL and DB tests only, no UI); if the orchestrator keeps it inside this pipeline, `full-stack-developer` as the first commit, before any feature commit.


## Relayed from the calendar pipeline's Phase 3 (orchestrator, 2026-10-14) — closes this pipeline's Phase 3

The calendar tech-lead **confirmed the `listUpcomingMemberEvents` contract as specified**, with three clarifications, and named the shared pieces this design's contingent items C1–C7 asked for: `formatTime(wc)` and `formatShortDate(dayKey)` (`src/lib/calendar/wall-clock.ts` / `month.ts` — C2 answered), `EventTypeIcon` / `EventTypeChip` (`src/components/org-portal/event-types/` — C3: `eventType` is `{ name, colorToken, iconKey } | null`, null only when the org has no types at all), `todayInOrgZone(now, tz)` (`src/lib/shared/org-time.ts` — C4), `visiblePortalTiles(tiles, { category, orgType, viewer })` with a required `viewer` (C5; see the calendar design's "tile registry" section for the exact signature), routes `/o/<slug>/calendar` and `/o/<slug>/calendar/<eventId>` with `?from=%2Fo%2F<slug>` rendering "Back to home" (C6), "listed until its day ends" confirmed and the toggle ON for every real org (C7). The calendar's text follows verbatim:

#### (from the calendar design) Cross-pipeline contract with `2026-10-14-portal-home-alignment` — confirmed, with three clarifications

> **For the orchestrator to relay to the home pipeline.** The Phase 2 requirement is **confirmed as specified** — same names, same result type, same parameter order, same query rules, same transaction order — with these three points that the home design should read:
>
> 1. **`eventType` is resolved to the fallback row, not left null for untyped events.** `UpcomingMemberEvent.eventType` is `{ name, colorToken, iconKey }` exactly as specified, but an untyped event arrives with the org's fallback type (normally "General", neutral, `CalendarDays`) so the card and the calendar can never disagree. `null` therefore means only "this org has no event types at all" — render it neutral with `CalendarDays` and no type label. `colorToken`/`iconKey` are the closed unions `EventTypeColor`/`EventTypeIcon`, which are assignable to the `string` in the specification.
> 2. **"Listed until its day ends" is CONFIRMED.** The filter is `starts_at >= <org-local today 00:00>::timestamp`, bound as the `'YYYY-MM-DD'` string `todayInOrgZone(now, tz)` returns. A 10:30 service stays on the card until local midnight. Per series (`coalesce(parent_event_id, id)`) the earliest qualifying row wins (`distinct on`), so a series whose parent has passed yields its next child with `seriesKey` = the parent's id. `limit` is clamped to 1..12; a non-finite `limit` clamps to 1.
> 3. **The detail route is `/o/<slug>/calendar/<eventId>`, and it accepts a back link from the home page.** `safeCalendarBackHref` accepts exactly `/o/<slug>` (home) as well as `/o/<slug>/calendar…`, so the card should link to `/o/<slug>/calendar/<id>?from=%2Fo%2F<slug>` and the detail page will read "Back to home". Any other `from` falls back to "Back to calendar". The card needs no permission or toggle check of its own: it switches on `kind` (`ok` / `disabled` / `forbidden`) and renders nothing for the latter two.
>
> **Toggle default:** ON for every existing organization (migration `0054` writes the explicit rows) and every organization created by `createOrganization()`. An org created any other way has no toggle row and returns `{ kind: "disabled" }`, so the home card is hidden there — the relayed claim "visible to ordinary members on day one" holds for every real org and fails only for ad-hoc fixtures. It also needs the member to hold `events.view` (granted to the baseline `member` role by `0054`; F133 lists the orgs it cannot reach).
>
> **Shared display pieces the card can import** (all pure/server-safe): `formatTime(wc)`, `formatShortDate(dayKey)` from `src/lib/calendar/wall-clock.ts` / `month.ts`; `EventTypeIcon`, `EventTypeChip` from `src/components/org-portal/event-types/`; `todayInOrgZone` from `src/lib/shared/org-time.ts`.

```ts
export interface UpcomingMemberEvent {
  id: string;                 // the representative occurrence; the detail-link target
  seriesKey: string;          // coalesce(parent_event_id, id)
  title: string;
  startsAtWallClock: string;  // 'YYYY-MM-DDTHH:mm'
  endsAtWallClock: string | null;
  location: string | null;
  eventType: { name: string; colorToken: EventTypeColor; iconKey: EventTypeIcon } | null;
}
```
```sql
select * from (
  select distinct on (coalesce(e.parent_event_id, e.id))
         e.id, coalesce(e.parent_event_id, e.id) as series_key, e.title, e.location,
         <starts_at_wc>, <ends_at_wc>, t.name as type_name, t.color as type_color, t.icon as type_icon
    <MEMBER_FROM>
   where e.organization_id = ${organizationId}::uuid and <MEMBER_VISIBLE>
     and e.starts_at >= ${todayKey}::timestamp
   order by coalesce(e.parent_event_id, e.id), e.starts_at, e.id
) s
order by s.starts_at_wc, s.id
limit ${limit}
```

## Orchestrator note at Phase 4 start (2026-10-15)

Both prerequisites merged: PR #28 (`fix(directory):` Part A, v0.31.1 — `directoryEligibilityWhereSql()` now carries `m.ended_on is null`, `findDirectoryPersonIds()` exported) and PR #29 (the calendar, v0.32.0 — `listUpcomingMemberEvents`, `MemberEventsResult`, `UpcomingMemberEvent` in `src/lib/calendar.ts`; `formatTime` in `src/lib/calendar/wall-clock.ts`, `formatShortDate` in `src/lib/calendar/month.ts`; `todayInOrgZone` in `src/lib/shared/org-time.ts`; `orgTimeZoneInTx` in `src/lib/org-settings.ts`; `EventTypeChip`/`EventTypeIcon` in `src/components/org-portal/event-types/`; `visiblePortalTiles(tiles, { category, orgType, viewer })` in `src/lib/org-portal/visible-tiles.ts`; routes `/o/<slug>/calendar` and `/calendar/[eventId]` accepting `?from=%2Fo%2F<slug>`). Part B (the feature) now builds on `main` `f27706a`; Part A is DONE and is not re-implemented here. Rule 16: a fresh worktree `../presby-home` on `pipeline/portal-home-alignment`, Neon branch `br-late-meadow-axpro6c7` (parent `development`, which has 0054 applied and the Alder Creek demo calendar loaded).

---

# Phase 4 — Implementation

*Part B (the feature), built 2026-10-15 in worktree `../presby-home`, branch `pipeline/portal-home-alignment`, Neon branch `br-late-meadow-axpro6c7`. Part A is merged (PR #28) and was not re-implemented. Nothing committed or pushed; Rule-16 files untouched.*

## Files Created

- `src/lib/org-portal/my-groups.ts` (+ `my-groups.test.ts`, DB-backed) - `getViewerGroups(viewerPersonId, organizationId)`, the exact SQL from B.1 (`exists`, `derived_from is distinct from 'active_membership'`, date-aware currency bound as `'YYYY-MM-DD'` from `todayInOrgZone` via `orgTimeZoneInTx`), the four architect conditions in its header.
- `src/lib/org-portal/main-row.ts` (+ `main-row.test.ts`) - pure `composeMainRow`, `UPCOMING_EVENTS_LIMIT = 4`, `Loaded<T>`, `UpcomingCardState`, `MainRowPlan`.
- `src/components/org-portal/upcoming-events-card.tsx` (+ test) - "Coming up".
- `src/components/org-portal/home-main-row.tsx` (+ test) - server component; `data-testid="home-main-row"`.
- `e2e/portal-home-cards.spec.ts` and `e2e/support/home-cards-fixture.ts` - see Implementer Notes for the fixture-mechanism deviation.

## Files Modified

- `src/lib/directory.ts` - `checkDirectoryView` exported; new `countHouseholdDirectoryMembers` on `countDirectoryRows` with `includeHidden: false` (documented no-permission-check precondition).
- `src/lib/org-portal/home-data.ts` - returns `{ displayName, canViewDirectory, household }`; household read only for a `directory.view` holder, counted by the directory's own rule, `null` below two; header rewritten.
- `src/lib/org-portal/find-person.ts` - private `directory.view` SQL replaced by the exported `checkDirectoryView` (behaviour identical).
- `src/components/org-portal/yours-zone.tsx` - groups block (`Badge variant="secondary"`, `text-sm whitespace-normal break-words` override, no links), household link target by `householdPageEnabled`, singular branch deleted, card omitted when both empty.
- `src/app/(org)/o/[slug]/page.tsx` - `assertOrgAccess` first and sequential, then one `Promise.all`; local `loadWidget`; Find-a-person only when `canViewDirectory`; `HomeMainRow`; no `Suspense`, no `loading.tsx`; docblock rewritten.
- Tests updated: `page.test.tsx` (rewritten mocks, 34 cases), `yours-zone.test.tsx` (household-of-one case deleted deliberately, reason in the header), `home-data.test.ts` (extended fixture and cases), `directory.test.ts` (+6 `countHouseholdDirectoryMembers` cases).

## Endpoints / Action Signatures

None. Server functions only (all `withOrgContext()` on `db`; `getPlatformDb()` appears nowhere): `getViewerGroups(viewerPersonId, organizationId)` - no permission, self-read under the four conditions; `countHouseholdDirectoryMembers(tx, organizationId, householdId)` - no check, caller must have run `checkDirectoryView` in the same transaction; `getPortalHomeData` signature unchanged. Gates: `org_portal.home_v2` (page); `directory.view` read once via `canViewDirectory`; the events card decided purely by `listUpcomingMemberEvents`' `kind`; flags newly read on the page: `org_portal.directory`, `org_portal.directory_v2` (household link target only). No calendar flag read (pinned by a test).

## Schema Changes

None. No migration.

## Audit Events

None - read-only. `npm run check:audit` passes.

## Env / FEATURES

None.

## Verification

- Unit/jsdom: `npm test` - 302 files passed, 38 skipped; 4244 tests passed, 1182 skipped (the skips are the DB-backed files when not run with `.env.local`).
- DB-backed, serial against the pipeline's Neon branch: `home-data`, `directory`, `find-person`, `my-groups` and the rest of `src/lib/org-portal` - 7 files, 197 tests passed. `my-groups.test.ts` alone: 15 tests, under a fake clock (2026-03-02T03:00Z: New York 03-01, UTC 03-02; the zone case uses Pacific/Auckland because the `organization_settings_time_zone_valid` check rejects the bare name `UTC`).
- `npm run typecheck`, `npm run lint` (max-warnings 0), `npm run check` (all six tripwires), `npm run build`: all green.
- e2e: `E2E_BASE_URL=http://localhost:3600 npx playwright test e2e/portal-home-cards.spec.ts` - 11 passed. The full `npm run test:e2e` was NOT run (Phase 5 / QA).

## Browser observations (this worktree, dev server on :3600, now stopped)

Alder Creek, signed in with the fixture users, at 360 / 768 / 1280 px:

- `clerk.fixture` (household "The Renwick Family", 3 members, link "View household"): both cards. 360: Yours (y 478) then Coming up (y 708), both x 24, width 312, stacked. 768: side by side, both y 490, x 24 and 396, width 348 each. 1280: both y 438, x 88 and 652, width 540 each. No horizontal overflow at any width. Coming up shows 3 rows (the demo calendar has only three upcoming series today, 2026-10-15), each with date and time, a type chip, a location and a chevron; "See the full calendar" footer. The clerk's Session term ended 2026-01-11, so no Session pill - correct, not a defect.
- `elder.fixture` (current Session term, no household): Yours renders as the groups block only ("My groups" with a single "Session" pill, no household block), Coming up beside it at 768 and 1280 (events.view reaches the elder through the baseline member role), stacked at 360. The elder's earlier ended Session term does not duplicate the pill.
- Calendar toggle flipped off in SQL for Alder Creek (restored to on afterwards, verified): Coming up disappears; Yours takes the full width (768: width 720 of 768; 1280: 1104 of 1152; 360 unchanged).
- Event row links go to `/o/alder-creek/calendar/<id>?from=%2Fo%2Falder-creek`; the e2e spec clicks one and confirms "Back to home" returns to the home, and that the footer link reaches the calendar.
- The long unbroken (60-character) group name and event title wrap with no horizontal scroll at 360 (e2e assertion). Event rows measure at least 44px tall.
- 200% browser zoom was not run; a 200%-zoomed 1280 window is a 640 CSS px layout (stacked, between the 360 and 768 cases both checked). Left to QA's manual pass.

## Implementer Notes

- **Deviation (not an escalation): e2e fixture mechanism.** Phase 3 sketched new orgs and users appended to `e2e/support/seed-orgs.ts`. The tree already has the calendar pipeline's spec-owned-fixture pattern (DECISION-157), so the spec instead sets up and tears down its own rows at e2e-alpha (`e2e/support/home-cards-fixture.ts`: ids `e2ce...`, role keys `e2e_home_*`, `E2E ` names; teardown deletes by those ids, restores the shared people's household links and the calendar toggle, and verifies nothing is left). It reuses the existing fixture people (org-single: household, two groups, directory.view, events.view; org-multi: events.view only; congregation-clerk: the household's second member). `seed-orgs.ts` is untouched. The "passed-parent series", "a 60-character name and title", "four-row limit", "cancelled event hidden", "Find a person absent without directory.view" and "no cards" cases are all covered. The three calendar-pipeline-owned seed rows and the `member-calendar.spec.ts` fixture are not touched. `playwright.config.ts` runs one worker, so the two fixtures never overlap.
- **Contingent items C1-C7:** all resolved against the merged code with no change to the design. C1 `listUpcomingMemberEvents`/`MemberEventsResult`/`UpcomingMemberEvent` from `@/lib/calendar` as specified; C2 `formatShortDate` (month.ts) + `formatTime` + `dayKeyOf` (wall-clock.ts); C3 `EventTypeChip` takes name/colorToken/iconKey and the null-type case renders the neutral `EventTypeIcon` with no label (the detail page omits it entirely; the card keeps the glyph so the row's rhythm holds); C4 `todayInOrgZone(now, tz)`; C5 `visiblePortalTiles("operate", orgType, viewer)` was already in the page; C6/C7 as relayed.
- **Layout detail the design did not state:** the row grid is `grid grid-cols-1 items-start gap-6` (+ `md:grid-cols-2` only for two cards). `grid-cols-1` is `minmax(0,1fr)`, which is what keeps a 60-character unbroken string from widening the track.
- **Test choice:** the page test pins "no `Suspense`" by matching the import and the element, not the word (the docblock names Suspense to explain its absence).
- **Teardown note:** when stopping the :3600 dev server I ran `pkill -f next-server`, which is broader than intended; nothing is listening on :3000 now. If the main checkout's dev server was up, it needs restarting.
- E1 (pool bound is four tenant transactions plus the layout's) was implemented as the design stated; no architect response was needed to build it.

## Exact file list for the commit(s)

Modified: `src/lib/directory.ts`, `src/lib/directory.test.ts`, `src/lib/org-portal/find-person.ts`, `src/lib/org-portal/home-data.ts`, `src/lib/org-portal/home-data.test.ts`, `src/components/org-portal/yours-zone.tsx`, `src/components/org-portal/yours-zone.test.tsx`, `src/app/(org)/o/[slug]/page.tsx`, `src/app/(org)/o/[slug]/page.test.tsx`, `docs/work-log/2026-10-14-portal-home-alignment.md`.
New: `src/lib/org-portal/my-groups.ts`, `src/lib/org-portal/my-groups.test.ts`, `src/lib/org-portal/main-row.ts`, `src/lib/org-portal/main-row.test.ts`, `src/components/org-portal/upcoming-events-card.tsx`, `src/components/org-portal/upcoming-events-card.test.tsx`, `src/components/org-portal/home-main-row.tsx`, `src/components/org-portal/home-main-row.test.tsx`, `e2e/portal-home-cards.spec.ts`, `e2e/support/home-cards-fixture.ts`.
Suggested split per the design's Implementation Order: (1) `feat(portal-home): the viewer's groups and a directory-accurate household count` (my-groups, directory.ts, home-data, find-person, yours-zone + tests, and the page's minimal wiring - note `page.tsx` currently carries the final wiring for both commits, so one commit is simpler); (2) `feat(portal-home): the Coming up card and the main row`; (3) `test(e2e): portal home cards at three widths`.

## Handoff

**Next agent: qa (Phase 5).** In the browser, open `/o/<slug>` for a member who has both cards, one card and none, at 360 / 768 / 1280 and 200% zoom; check keyboard tab order and focus rings on the event rows and footer link, and a long group name and event title. Run the full `npm run test:e2e` (only the new spec was run here) and the DB-backed suites serially. Phase 6 housekeeping (TODO, DECISION-162, F136, release notes, functionality map) is the orchestrator's, from the drafts at the end of Phase 3.

---

# Phase 5 — Verification (qa)

*Recorded verbatim by the orchestrator, 2026-10-15.*

**Date:** 2026-10-15
**Verified by:** qa
**Worktree / branch:** `/Users/cshenso/git/presby-platform/presby-home`, `pipeline/portal-home-alignment`. While I was verifying, the orchestrator committed the work as `8e8e698` (feat) and `ff6731f` (test(e2e)). `git diff main --stat` is the same before and after the commits: 20 files, +2838/−182. The working tree is clean.
**DB:** `.env.local`. Its endpoint (`ep-gentle-cherry-…`) is different from the main checkout's (`ep-lingering-meadow-…`). I could not map the endpoint to `br-late-meadow-axpro6c7` myself (`neonctl` is scoped to a different org); that mapping rests on the orchestrator's statement.

**Not an auth-touching diff.** `git diff --name-only main` contains nothing under `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/` or `src/lib/auth/`, so the MFA-enrolled e2e requirement does not apply. The full e2e suite ran against a real dev server anyway.

## Type Check

`npm run typecheck`: **PASS** (exit 0, 8.6 s). `npm run lint` (`--max-warnings=0`): **PASS**. `npm run check`: **PASS** — all six tripwires.

## Unit Tests

**`npm test`** — Total 5426 | Passed 4244 | Failed 0 | Skipped 1182 | 15.0 s. Files: 302 passed, 38 skipped (the DB-backed `describe.skipIf(!hasDb)` files; all ran in the DB lane).

**`npm run test:db`** (full lane, `--no-file-parallelism`, pipeline branch) — Total 5426 | Passed 5426 | Failed 0 | **Skipped 0** | 666 s. Files: 340 of 340 passed.

Failures: none.

## End-to-End Tests

Dev server from this worktree on :3700; the main checkout's :3000 server (PID 15271) was not touched. My server was stopped by its PIDs afterwards; nothing is left on :3700.

- `E2E_BASE_URL=http://localhost:3700 npx playwright test e2e/portal-home-cards.spec.ts` — Total 11 | Passed 11 | Failed 0 | 24.9 s
- `E2E_BASE_URL=http://localhost:3700 npm run test:e2e` (full suite) — Total 195 | Passed 195 | Failed 0 | Skipped 0 | Flaky 0 | 4.9 min. `post-login-routing.spec.ts` tests 4 and 7 both **passed** on this branch, so the `docs/TODO.md:126` note did not apply to this run.

After the run the spec's fixture rows were gone (0 events and 0 groups with `e2ce%` ids); `org_portal.home_v2`, `org_portal.directory` and `org_portal.directory_v2` were still ON.

**Phone / zoom spot check** (headless Chromium, read-only geometry probe, signed in on `/o/alder-creek`):

| User | Width | Result |
|---|---|---|
| clerk | 360 | Both cards stacked (Yours x24 y478 w312; Coming up x24 y708 w312). Overflow 0. Three event rows, 130 px each. Household "The Renwick Family" links to `/directory/households/<id>`. Find-a-person present. |
| clerk | 640 (≈1280 at 200%) | Stacked, both w592 at x24. Overflow 0. Rows 106 px. |
| elder | 360 | Stacked. Yours is the groups block only, one "Session" pill: 14 px (`text-sm`), not inside a link, `ul` computes `flex-wrap: wrap`. Overflow 0. Rows 130 px. |
| elder | 640 | Stacked. Overflow 0. Rows 106 px. |

- **Calendar toggle OFF** (owner connection): for both users at 360, 640 and 1280, Coming up absent, row class `grid grid-cols-1 items-start gap-6` (no `md:grid-cols-2`), Yours w1104 of main's 1152 at 1280, overflow 0 everywhere.
- **Toggle restored** with its original `updated_at` (`t | 2026-10-15 15:44:10.09981+00`); at 1280 both cards side by side again (x88 and x652, w540 each, `md:grid-cols-2`).
- **Pills wrapping:** both Alder Creek users hold at most one pill; the e2e assertion at 360 covers it (a 60-character unbroken group name, no overflow, `portal-home-cards.spec.ts:73`).
- **`text-xs`:** 4 elements under `main`, all the tile grid's pre-existing "Coming soon" badges (Phase 3 E4, TODO drafted). None from this diff.

**Not run:** true browser-zoom 200% (640 px viewport stands in); interactive keyboard tab order / focus rings (the `focus-visible:ring-2 … ring-offset-2` classes are on the event rows and links, confirmed by reading); 768 px in my probe (covered by e2e `:108`, `:179`, `:193`).

## Regression Tests Added

- **`getViewerGroups` self-scope** (`src/lib/org-portal/my-groups.test.ts`, DB lane, fake clock): another member's groups excluded `:330`; another org's excluded with the viewer in both orgs `:350`; `active_membership` excluded by `derived_from` not name (a managed group named "Active Membership" still returned) `:286`; Session included and ended diaconate term excluded `:310`; ended / not-yet-started / boundary-ended (`ends_on` = org-local today) excluded `:316`; projection exactly `{groupId, name}` `:357`; arity 2 `:365`; org zone decides "today" (Pacific/Auckland vs New York) `:369`; default zone with no settings row `:390`; shared group once `:340`; duplicate rows once `:345`; `OrgAccessError` `:412`; DB error propagates `:418`.
- **Household count (F136)** (`src/lib/org-portal/home-data.test.ts`): `:350` the directory's count excludes ended, deceased, hidden and off-roll; `:362` agrees with `getHouseholdDetail`; `:370` a household of one suppressed; `:376` a directory-hidden viewer sees no household (page shows 1); `:387` an ineligible viewer still sees the directory's count; `:396` without `directory.view`, `canViewDirectory` false and household null (gated, not merely filtered).
- **`countHouseholdDirectoryMembers`** (`src/lib/directory.test.ts`, `describe("countHouseholdDirectoryMembers (portal home)")` at `@@ -1355`): ended member excluded; agrees with the household page; hidden-only household is 0; `view_hidden` holder still gets the ordinary count; cross-org is 0; own org counts.
- **`composeMainRow`** (`src/lib/org-portal/main-row.test.ts:39–148`, 13 cases): none/single/double; empty, failed, disabled, forbidden; frozen-input purity; `UPCOMING_EVENTS_LIMIT === 4`.
- **Page orchestration** (`src/app/(org)/o/[slug]/page.test.tsx`): `:410` gate held until `assertOrgAccess` resolves; `:427` all three loaders start before any resolves; `:448` loaders get only server-resolved ids, groups call has exactly 2 arguments; `:466` no flag key containing "calendar" is read; `:476–496` Find-a-person visibility incl. fail-closed; `:543`, `:606` fixed log string, `"SECRET_SQL"` never logged; `:563`, `:625` `OrgAccessError` re-thrown; `:660` no `loading.tsx`, no `Suspense`.
- **Deliberate change to a pinned test:** `src/components/org-portal/yours-zone.test.tsx:2–10` records why the singular "1 member" case was deleted (D2).

**Failing-first:** not observed by me; Phase 4 does not record it. By reading the old `home-data.ts` query (`ended_on is null` only) I confirm `home-data.test.ts:350` and `:370` would fail against it (H1 would count 5 not 2; the widow's household returned with count 2). Confirmation by reading, not execution. The F136 predicate regression itself was Part A (PR #28), verified there.

**Advisory, not blocking:** no test checks a *current* diaconate membership positively (`:310` checks Session included and an ended deacon term excluded, exactly the designed fixture); the exclusion is a single `derived_from is distinct from 'active_membership'` (`my-groups.ts:79`), so diaconate inclusion cannot differ from Session's without code that names it; the ended-deacon case has no check that a materialised row exists, so it could pass vacuously (Book Club at `:316` covers ended memberships non-vacuously). Worth a one-line follow-up.

## Coverage on Critical Modules

`src/lib/permissions.ts` 100%/100%; `src/lib/two-factor.ts` 91.3% statements (untouched; target met); `src/lib/flags.ts` 100%/100%; `src/lib/org-portal/main-row.ts` (new, pure) 100%/100%/100%. Coverage written to the scratchpad.

## Diff verification (read, not inferred)

- Every new tenant read goes through `withOrgContext()` on `db` (`my-groups.ts:71`, `home-data.ts` one transaction, `listUpcomingMemberEvents` `calendar.ts:541`). `getPlatformDb()` under `src/app/(org)/` and `src/lib/org-portal/` appears only in `*.test.ts` fixture setup (house pattern); in no production file. Live catalog (SELECT only): the seven touched tables are all `relforcerowsecurity = t`; `groups`/`group_memberships` policies are tenancy-only, so the self-scope really is the application predicate `gm.person_id = ${viewerPersonId}` (`my-groups.ts:85`). The `presby_app` session zone is `GMT`, which is why `current_date` would have been wrong.
- **`getViewerGroups`** (`my-groups.ts:67`): exactly `(viewerPersonId, organizationId)`, the page passes `resolved.org.personId`/`organizationId`; projects `g.id`, `g.name` only (`:76`); excludes on `derived_from` (`:79`); "today" is `todayInOrgZone(new Date(), await orgTimeZoneInTx(tx, organizationId))` (`:72–73`) bound as `${today}::date`; no `current_date` or `now()`.
- **`events.view` not read at page level:** the card is decided by the `kind` of `listUpcomingMemberEvents` through `composeMainRow`; the calendar applies toggle → `events.view OR events.manage` → zone inside one transaction (`calendar.ts:541–551`).
- **`directory.view`** read once via `checkDirectoryView` inside `getPortalHomeData` (`home-data.ts:95`), gating the household block (`:111`) and Find-a-person (`page.tsx:235`); fails closed if the home read fails.
- **Household count:** `countHouseholdDirectoryMembers` (`home-data.ts:114`, defined `directory.ts:485`) calls `countDirectoryRows` with `includeHidden: false` (`:492`); `household` non-null only when `memberCount >= 2` (`home-data.ts:119`); the old private count query is gone; `find-person.ts` uses the exported `checkDirectoryView`.
- **Main row:** `HomeMainRow` is a Server Component (no `'use client'` in any new file); classes `grid grid-cols-1 items-start gap-6` plus `md:grid-cols-2` only when `layout === "double"` (`home-main-row.tsx:34–35`); `none` renders `null`; `composeMainRow` pure and fully tested.
- **Failure domains:** `assertOrgAccess` first and sequential (`page.tsx:158`); one `Promise.all` (`:198`); each tenant loader its own `withOrgContext()` wrapped by `loadWidget` (`:260`), which re-throws `OrgAccessError` (`:268`) and logs a fixed string with ids only (`:269`).
- No `Suspense`; no `loading.tsx` in `src/app/(org)/o/[slug]/`. `Badge` text size overridden to `text-sm whitespace-normal break-words` (`yours-zone.tsx:86`); `badge.tsx` untouched. `data-testid="greeting-band"` still present (`greeting-band.tsx:50`).

## Feature-Gate Audit

No `route.ts` and no `"use server"` action added or changed. Tenant permissions go through `presby_has_permission`, not `FEATURES.*`.

| Route or read function | `auth()` present? | `hasFeature(...)` present? | Correct key? |
|---|---|---|---|
| GET page `/o/[slug]` (`page.tsx`) | yes: `cachedAuth()`, `/signin` redirect, `resolveOrgContext` four-way miss, `assertOrgAccess` (`:158`), `org_portal.home_v2` flag | n/a — the page reads no permission itself (pinned `page.test.tsx:466`) | n/a (tenant axis) |
| `getPortalHomeData` | inherits the session; `withOrgContext` membership re-check | tenant check `checkDirectoryView` = `presby_has_permission(…,'directory.view')` | `directory.view` — same call as the directory pages and the find-person action |
| `getViewerGroups` | `withOrgContext` membership re-check | permission-less self-read under DECISION-162's four conditions, all held and pinned | none by design |
| `listUpcomingMemberEvents` (calendar-owned) | `withOrgContext` | private gate: org toggle, then `events.view OR events.manage` | correct; the calendar's own gate |
| `countHouseholdDirectoryMembers` (new export) | n/a | no check, as documented; its only caller runs `checkDirectoryView` first in the same transaction (`home-data.ts:95→111→114`) | precondition held |
| `findPersonMatches` (changed) | n/a | `checkDirectoryView` before the search; the action re-checks on submit | `directory.view` |

## Verdict

**PASS**

All required checks green: typecheck, lint, six tripwires; 4244 unit tests; 5426 DB-lane tests with 0 skips; 11/11 new e2e and 195/195 full e2e on a real dev server, 0 skips; the feature-gate audit and every architect condition verified by reading. Not done: true browser-zoom 200% (640 px used), interactive keyboard focus check, watching any test fail before the change. Side effects, all reversed: the Alder Creek calendar toggle flipped and restored with its original `updated_at`; the e2e fixture created and removed its own rows; no repository file written.

**Handoff:** analyst (Phase 6). Points: the advisory diaconate-inclusion test gap; the pre-existing `text-xs` "Coming soon" badges (E4, TODO drafted); the Rule-10/14 housekeeping drafts at the end of Phase 3 still need recording at integration.


---

# Phase 6 — Shipped vs Intent (analyst)

*Recorded verbatim by the orchestrator, 2026-10-15. The analyst started its own dev server from this worktree on :3900, drove it with headless Chromium at 375 and 1280 px as `clerk.fixture` and `elder.fixture` on `/o/alder-creek`, stopped it by PID, and left the main checkout's :3000 server untouched. "Observed" means seen in the browser or on the database; "inferred" means read from code or tests.*

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> The portal home now carries the pieces of fpcw-directory's home that presby lacked, and each one behaved as Phase 1 described in my browser pass. The notes are one test gap QA flagged, a phone-density polish item, and one what's-new decision. None blocks shipping.

## What's Working

All of this was **observed**.

- **The original ask.** Compared with fpcw-directory's home: greeting already there and stronger; Find a person present for both clerk and elder; Yours = household plus groups, with fpcw's signups deliberately dropped; Coming up = a card showing one row per series; main row side by side from `md`; tiles unchanged (R1/R2/R3).
- **Side-by-side layout.** At 1280, clerk has Yours at x88 w540 and Coming up at x652 w540, both at y438. At 375 they stack at x24 w327, zero horizontal overflow. Heading order is h1, h2 Yours, h2 Coming up, then the domain h2s.
- **One row per series, and it is the next occurrence.** Sunday worship is a weekly series with Oct 11 (past), Oct 18, Oct 25, Nov 1, 8, 15, 22 (future); the card shows exactly one "Sunday worship", "Sun, Oct 18 · 10:30 AM". The cancelled "Fellowship supper" (Oct 20) is absent. Only three series are upcoming today, so the four-row cap was not exercised live (the e2e spec covers it; read, not re-run).
- **Round trip.** A row links to `/o/alder-creek/calendar/<id>?from=%2Fo%2Falder-creek`; the detail page showed the h1 "Sunday worship" and "Back to home" to `/o/alder-creek`, which returned to the home. The footer link `href` is `/o/alder-creek/calendar` (read; the e2e spec clicks it).
- **Household count agrees with the household page.** "The Renwick Family · 3 members" on the card; the household page says "3 members" and lists the three.
- **Groups pills.** Elder sees "My groups" with one "Session" pill (14px, not a link; household block correctly omitted). Clerk (Session term ended) sees no pills and no groups block. Neither sees "Active Membership". Alphabetical order and the exclusion rules rest on QA's DB tests.
- **Microcopy matches Phase 1 exactly.** "Coming up"; "Nothing is on the calendar right now." with "Open the calendar →"; both link labels carry an arrow Phase 3 added.
- **Empty state (observed, on a mutated demo calendar).** No org in the dev branch gave toggle on + `events.view` + zero events, so I temporarily set `cancelled_at` on Alder Creek's 8 upcoming uncancelled events: at 375 and 1280 Yours stayed at full size and Coming up showed the empty copy and link as a short card (w540 × h174 at 1280). Restored by id; the card repopulated.
- **`e2e-alpha`, as F133 predicted.** As `org1@presby.invalid` and `org1-org2@presby.invalid`: neither card renders and there is no `home-main-row` element; Find a person is absent (no `directory.view`); the tiles still render (never permission-filtered). This is the "none" layout, not the empty state.
- **Toggle-off.** With the Alder Creek `org_portal.calendar` toggle off (owner connection): "Coming up" vanished, the row lost `md:grid-cols-2`, Yours went to w1104 of 1152 at 1280; unchanged at 375. Restored with the original `updated_at` and re-checked side by side at 1280.
- **Keyboard.** Tab order at 1280: household link, the three event rows in order, "See the full calendar", then the tiles — reading order. Each shows a 2px ring with 2px offset under `:focus-visible`, confirmed in screenshots. This closes QA's "not run interactively" gap.

## Intent-vs-Shipped Diff

- Phase 1 said Church Events with an audience filter, a "Church Events" heading, a client-side height trim, `sm:`. Shipped: "Coming up", no filter (no audience columns), no trim, `md:`. **Matches R4/R5/OQ6.**
- Phase 1 said event rows are two lines. Shipped: title, date and time, a type chip, a location; at 375 the chip wraps under the date, so each row is 130px and the card is about 540px tall. **Acceptable drift** (the chip and location are the calendar's own pieces), but the one place the phone experience got heavier than described — follow-up N2.
- Household of one suppressed, count by the directory's rule: observed 3 = 3; the suppression and exclusions rest on QA's DB tests. **Matches (by tests).**
- Find a person hidden without `directory.view`: observed absent at `e2e-alpha`. **Matches.**
- Groups pills static, no cap, no links: observed non-link 14px pill (`text-xs` overridden at the call site; primitive untouched). **Matches.** The 60-character wrap is e2e-covered.
- Each widget fails independently with the designed events-failure copy: in `upcoming-events-card.tsx:111-114`, log string pinned in `page.test.tsx`. **Inferred, not observed** (no read failure forced). **Matches by code and test.**
- Greeting server-clock hour tracked, not fixed: untouched; TODO line exists. **Matches.**
- R1/R2/R3: tile grid untouched; Members and Directory tiles still show at `e2e-alpha` with no grants. **Matches.**

## Edge Cases

- Empty state: **pass** (observed). Failure microcopy: **pass by reading and tests**, not observed live. Permission gate: **pass** (observed: card and Find-a-person absent without the grants, toggle-off hides the card, tiles unfiltered; inferred from QA: `events.view` decided only by the calendar function's `kind`, `directory.view` read once; `withOrgContext()` the only read path, no `getPlatformDb()` in production files). Audit event: **not applicable**. Mobile: **pass at 375 and 1280**; 200% zoom not run (QA's 640px viewport stood in).

## Follow-Ups (SHIP WITH NOTES)

Six lines are already staged in `docs/TODO.md` from Phase 3 (tile visibility revisit, roll-approvals badge, greeting hour, member-facing group page, `Badge` `text-xs`, find-person vs directory-search semantics). Three more:

1. **N1: a positive current-diaconate case for `getViewerGroups`** (QA advisory, agreed). `my-groups.test.ts:310` checks Session included and an *ended* deacon term excluded; nothing proves a *current* diaconate membership appears, and the ended-deacon negative has no assertion that the materialised row exists, so it can pass vacuously. Risk is low (one `derived_from` filter covers both courts); the point is that Phase 1 R6 promised both derived groups.
2. **N2: Coming up card density at 360–375px.** Each row is 130px because the chip wraps under the date and the location is a third line, so a three-event card is about 540px and pushes the tool tiles a full screen down. Try the chip inline with the date at `sm:` only, or drop it below `sm`, and settle with the operator on a phone. Same pass: the card's top padding plus `py-3` on the first row gives a larger top gap than bottom; the footer link has a large gap above; the row focus ring sits flush against the text (rows have no horizontal padding).
3. **N3: the `Badge` `text-xs` line (E4) is correctly staged and not a blocker.** QA's four `text-xs` elements are the tile grid's pre-existing "Coming soon" badges; this diff adds none.

**Rule 10:** the staged Done line's "follow-ups filed above" is true once N1 and N2 are added in the same closing commit. **Rule 12:** no feedback row (inferred from the Source section). **Rule 13:** warranted, but do **not** publish a separate entry — fold one sentence into the calendar's pending D8 entry ("The next few events also appear on your home page under **Coming up**.") and publish them together after N5's production count; the `v0.33.md` paragraph is the release record, not a what's-new body. **Rule 14:** the staged "Portal home" line matches what I observed. **Rule 15:** `docs/architecture.md` unchanged, agreed.

## Side effects of my verification (all reversed)

Alder Creek events: 8 upcoming rows cancelled and restored (final: 8 uncancelled, 1 originally cancelled; no `updated_at` disturbed). Calendar toggle: flipped off and back on, original `updated_at` restored. No repository file written.

