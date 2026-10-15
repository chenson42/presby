# Member Calendar with Event Types — Work Log

> **Slug:** `2026-10-14-member-calendar`
> **Surface:** `(org)` member portal — `/o/<slug>/calendar` (member-facing, read-only) plus an event-types manager under `/o/<slug>/admin/events/types`
> **Permission(s):** new `events.view` (tier 1, read-only — the member-facing read path the events module has never had; today every read requires `events.manage`), new `event_types.manage` (no default binding, mirrors fpcw-directory). Existing `events.manage` keeps every write.
> **Flag(s):** existing `org_portal.events` gates the admin surface; new `org_portal.calendar` (seeded OFF) gates the member calendar so the read path can ship dark and flip per org.
> **Estimated complexity:** medium-to-large (one migration, two permissions, a new member page, a new admin page, a shared month-grid component)
> **Pipeline mode:** Full
> **Pre-assigned numbers (Rule 16, orchestrator, 2026-10-14):** migration `drizzle/0054_presby_calendar_event_types.sql`; `DECISION-160` and `DECISION-161`; `F132`–`F135` reserved for this pipeline's review findings.
> **Worktree / branch:** `../presby-calendar` on git branch `pipeline/member-calendar`; Neon branch `pipeline/member-calendar` (`br-long-river-axfwmp57`, parent `development`).

---

## Source and intent (orchestrator, 2026-10-14)

The operator asked, while demoing `/site/fpcw` and `/o/fpcw` locally: *"implement the calendar functionality that was recently added to fpcw-directory"*, and in the same breath to align the portal home page with fpcw-directory's (that half is its own pipeline, `docs/work-log/2026-10-14-portal-home-alignment.md`, which depends on this one's `events.view` read path and runs after it).

Scope was decided with the operator on 2026-10-14 from a two-repo survey:

**In scope — "Calendar v1 plus event types":**
- A member-visible read path for events (`events.view`), which does not exist today: every function in `src/lib/events.ts` requires `events.manage`, which no role holds by default, so a member who opens the Events tile gets a forbidden page.
- `/o/<slug>/calendar`: server-rendered month grid (desktop, `md+`) and a list view (`?view=list`; always the rendering below `md` because a 7-column grid is unreadable at 360px). Previous / next month and Today as plain links (`?month=YYYY-MM`), every state shareable as a URL. Day cells scroll internally rather than hiding entries behind "+N more". Entries link to the event's detail. No week or day view (fpcw-directory v1 made the same call).
- `event_types` table per org: name, color token (fixed palette of 8 + neutral), icon name (fixed lookup), sort order, active flag, exactly one fallback per org (partial unique index), seeded defaults at org creation. `events.event_type_id` FK `ON DELETE SET NULL`. Untyped events render as the fallback type.
- Category filter pills on the calendar (`?types=`; no param means All; selecting every type drops the param). Mobile: filter row collapses behind a "Show filters / Filters: N active" button. Colour comes from the type only; colour is never the sole signal (icon + label too, ui-standards §661).
- Event-type manager for `event_types.manage` holders: create, rename, recolor, re-icon, reorder, deactivate (never delete; the fallback type cannot be deactivated). `AUDIT_ACTIONS` keys for every mutation.
- Copy Month: server builds the month as an HTML table + plain text (`buildMonthClipboard`), a client button writes both `text/html` and `text/plain` synchronously inside the click handler (iOS Safari), toast on success. Respects the active filters; drops non-public events.
- Event create/edit forms gain an `EventTypePicker`.
- A member-facing event detail page (`/o/<slug>/calendar/[eventId]` or similar — tech-lead decides) readable with `events.view`, since the admin detail page requires `events.manage`.

**Deliberately out of scope (operator chose v1 + types, not full parity):**
- `rooms`, room bookings, `kind` enum (event / booking / meeting), `group_meeting_schedules`, the kinds segmented control and the room filter — all of fpcw-directory's Track A, which `docs/TODO.md:33` gates behind Track 0.
- The Google Calendar publish gate (`events.publish`) and the public `<fpcw-events>` web component / public events feed. `events.is_public` stays inert on the public site (Increment 4, `docs/TODO.md:391`).
- Signups / RSVPs (presby has none).
- Changes to recurrence semantics (stored-row series, 52-row cap, extend-forward-only stay as they are).

**What fpcw-directory does that the design should read before deciding** (all paths under `~/git/fpcw-directory/`): `src/app/(dashboard)/calendar/page.tsx`, `src/lib/calendar/queries.ts`, `src/lib/calendar/month-html.ts`, `src/components/calendar/calendar-filters.tsx`, `copy-month-button.tsx`, `type-icon.tsx`, `src/lib/events/type-palette.ts`, `drizzle/migrations/098_event_types.sql`, and the module docs `docs/modules/rooms/portal-calendar.md`, `docs/modules/rooms/calendar-copy-month.md`, `docs/modules/events/event-types.md`. fpcw-directory is single-tenant and keys everything off a global `event_types` table; presby's is per-org under FORCE RLS with composite tenant keys (F2), and `events.event_type_id` must be a composite FK.

**Constraints the survey surfaced:**
- `events` has six columns frozen by DECISION-113 (`id`, `organization_id`, `starts_at`, `ends_at`, `cancelled_at`, `allows_checkin`). Adding `event_type_id` does not touch them.
- `starts_at`/`ends_at` are wall-clock `timestamp` without time zone; the month-grid range computation must not convert through `Date`'s local zone (`check:sql-date`, `<FormattedDate>` only, `toLocale*` banned).
- `docs/ui-standards.md`: `text-xs` is forbidden on member pages — dense calendar cells still obey the 16px / `text-sm`-for-metadata floor; status colours are a known missing-token gap, so the type palette must be declared as tokens, not Tailwind palette literals (`check:brand-scope`).
- `org_portal.events` is seeded OFF; `home_v2`'s Events tile links to the admin list. The tile should point at the member calendar once `org_portal.calendar` is on (tech-lead decides the tile rule).
- Rule 16: `src/lib/db/domain/index.ts`, `drizzle/meta/_journal.json`, `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md` are edited only at integration by the orchestrator.

**Also riding on this branch (Polish, no pipeline):** `src/app/(public)/site/[slug]/[[...path]]/page.tsx` `PORTAL_LABEL` "Our Directory" → "Our Portal" (the nav CSS uppercases it), made 2026-10-14 for the fpcw demo at the operator's request; platform-wide constant, per-org labels remain the tracked follow-up. Commits as its own `style(site):` commit.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-14 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-10-14 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementers named | 2026-10-14 |
| 4 — Implementation | api-developer (commits 1, 4) · ux-developer (2, 6) · database-admin (3) · full-stack-developer (5) · orchestrator (0, 7) | In progress — commits 0 `651f069`, 2 `7cca13b`, 1 `c654b06`, 3 `a6daf31` on the branch; 4 `45ababe`; 5 `8d78e48`, 7 `2a2e0d6`+`83b2edd`+`c0582ad`; 6 `60a3511` — all seven commits on the branch | Complete | 2026-10-15 |
| 5 — Verification | qa | Complete | PASS (advisories A1–A3) | 2026-10-15 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES (N1 fixed before push; N2–N6 tracked) | 2026-10-15 |

---

# Phase 1 — Functional Refinement (analyst)

*Recorded verbatim by the orchestrator, 2026-10-14. Analyst's opening line: "Verdict: READY WITH NOTES. The scope holds. Five findings need a decision before Phase 4, and the first three need the operator."*

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> A baseline member opens "Calendar" from the portal and reads a month grid (or a phone-friendly list) of their congregation's events. Admins define the colour-coded event types behind it. The build is sound, but it ships a member read path that has no grantee until `events.view` reaches the baseline `member` role. It also needs a real answer for "today" and for the `is_public = false` events.

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Member (`events.view`) | Open Calendar from the tile or nav. | per session |
| Member | Move to the previous or next month, or Today (links, `?month=YYYY-MM`). | per session |
| Member | Switch between month grid and list (`?view=list`, md+ only). | occasional |
| Member | Tap a type pill to filter (`?types=`); clear with "All". | occasional |
| Member | Open an event to read when, where, what, type, and whether it is cancelled. | per session |
| Member | Press Copy month and paste into a newsletter document. | monthly (the clerk or newsletter editor) |
| Member with `events.manage` | Jump from the calendar to Edit event or Add event. | on demand |
| Admin (`events.manage`) | Pick or change an event's type on the create and edit forms. | per event |
| Admin (`event_types.manage`) | Create, rename, recolour, re-icon, reorder, and retire types. | rare |
| Anonymous or no-roles user | None. `/o/*` requires sign-in and an active membership. | n/a |

## Flows

**Flow 1 — Read the month.**
- Entry: portal tile, nav, or a bookmarked `/o/<slug>/calendar?month=2026-11&types=<id>`.
- Steps: Edge gate (sign-in, active account, 2FA on `/o/*`), `resolveOrgContext`, `org_portal.calendar` check, `events.view` check, then the month query. The grid renders at md+ and the list below md.
- Success: entries sit on their start day in time order, each with a type icon, a visible time and title, and a type name for screen readers.
- Failures:
  - Flag off: "The calendar isn't turned on for {Org} yet."
  - No permission: "The calendar isn't available to your account at {Org} yet. If you think it should be, ask your stated clerk or another administrator there."
  - Database failure: "We couldn't load the calendar right now. Try again in a moment." plus a Try again link that keeps `month`, `types` and `view`.
  - A garbage or out-of-range `?month=` falls back to the current month (see G7).
  - A relationship that has ended, or a slug with no relationship, uses the existing four-way miss pages unchanged.

**Flow 2 — Filter by type.**
- Entry: a pill in the "Event types" row.
- Steps: the pill is a plain link that sets `?types=`. Selecting every type drops the param. "All" drops it. The same filter state survives month navigation (G8).
- Below `sm`, the filter row sits behind "Show filters" / "Filters: N active".
- Success: only matching entries show. An untyped event filters as the fallback type, which is the bug fpcw fixed on 2026-09-16 (`queries.ts` typeCondition).
- Failure:
  - An unknown, foreign or malformed id is dropped silently (G7).
  - If nothing valid remains, the view is All.

**Flow 3 — Open an event.**
- Entry: an entry link, `/o/<slug>/calendar/<eventId>?from=<calendar path>`.
- Steps: check flag and `events.view`, load the event, render the member-shaped detail.
- Success:
  - The page shows title, date and time (and end time), location, description, type with icon, a "Cancelled" banner if cancelled, and "Part of a repeating series" if it is one.
  - For an `events.manage` holder with `org_portal.events` on, an "Edit this event" link goes to the admin detail.
- Failure:
  - A missing id, another org's id, or a non-UUID id all give the identical 404.
  - No `events.view` gives the forbidden state, checked before any lookup, so existence is not revealed.

**Flow 4 — Copy month.**
- Entry: the Copy month button on the calendar's action row.
- Steps:
  1. The server builds `{html, text}` from the month's already-filtered entries, and the client island receives only those two strings.
  2. The click handler synchronously writes both MIME types.
- Success: the toast reads "Calendar copied". It adds what was left out, such as "(2 members-only events left out)", and the active filter, such as "Worship only" (G9).
- Failure: "Your browser can't copy to the clipboard." or "Couldn't copy the calendar. Try again."

**Flow 5 — Manage event types** (`/o/<slug>/admin/events/types`, `event_types.manage`).
- Steps: list all types with swatch, icon, name, active switch and a "General (default)" badge. Add and edit use a closed palette and icon list. Reorder with Move up and Move down buttons. Retire a type with a switch.
- Success: the change appears on the calendar and pickers.
- Failure:
  - A duplicate name: "You already have an event type called 'Worship'."
  - Deactivating the fallback is refused and the control is disabled with a reason.
  - A forbidden or flag-off state follows `events-states.tsx`.

**Flow 6 — Type an event** (create or edit form picker).
- Default: "No type (shown as {fallback name})".
- A retired type already on the event stays selectable on that event, labelled "(retired)".
- Failure: a type id from another org returns the server message "That event type isn't available. Choose another." No 500.

## Permissions & Flags

- **Permissions** are rows in the `permissions` table, checked with `presby_has_permission` (`drizzle/0010_presby_resolver.sql:121`, the same pattern as `src/lib/events.ts:63,76-92`). They are not `FEATURES.*` keys. `src/lib/permissions.ts` is frozen and platform-only, so the rubric's "FEATURES key" question is answered by two new catalog rows:
  - `events.view`, tier 1, read-only.
  - `event_types.manage`, tier 1.
  - `events.manage` keeps every write.
- **Default roles:**
  - `events.view` must be bound to the baseline `member` role, or no ordinary member can open the Calendar tile.
    - That role is created per org at `createOrganization` with exactly one permission, `directory.view` (`src/lib/org-provisioning.ts:227-246`; the seed-dev fixture is `scripts/seed-dev.sql:458-460`).
    - There is no "all members" arm in the resolver, so a permission nobody holds is a dead tile.
    - Two edits are required: add `events.view` to `baselineRoleSeedPlan` (today a single `permissionKey`), and backfill `app_role_permissions` for every existing org's `member` role in the migration. `seed-dev.sql` is edited at integration (Rule 16).
  - `event_types.manage` has no default binding, mirroring fpcw. The feature is inert until a stated clerk grants it.
- **Flags:**
  - `org_portal.events` stays the admin-surface flag and is seeded OFF (`scripts/seed.ts:442-455`).
  - New `org_portal.calendar` is seeded OFF and gates the member calendar and its detail page.
  - The event-types manager is gated by `org_portal.events`, because it is an admin page.
  - Rollback is flipping `org_portal.calendar` off. The tile disappears and the pages render "isn't turned on yet".
  - Flags are global (`feature_flags`). The kickoff's "flip per org" is not true of a bare flag; see Open Question 2.

**Tile matrix.** Today there is one Events tile, operate category, flag `org_portal.events`, pointing at the admin list (`tiles.ts:289-301`). The registry is flag-only with a static `href` (`tiles.ts:8-18`, `visiblePortalTiles` at `:467`). One tile cannot point at two destinations by flag combination without a registry change. The user-facing outcome I want:

| events (E) | calendar (C) | Ordinary member sees | Admin (`events.manage`) sees |
|---|---|---|---|
| off | off | nothing | nothing |
| on | off | nothing (today's dead-end tile is gone) | "Manage events" on the admin hub |
| off | on | "Calendar" (empty month, no admin add path) | nothing |
| on | on | "Calendar" | "Calendar", plus "Manage events" on the admin hub and an "Add an event" / "Manage events" link on the calendar page |

The cleanest way to reach that is two tiles:
- A new `calendar` tile: category operate, flag C, domain worship, href `/o/<slug>/calendar`.
- The existing `events` tile relabelled "Manage events", moved to category administer.

This reverses part of DECISION-113 ruling 7 (events as `operate`), so the architect must rule on it. The invariant that tiles never check permissions stays intact.

## Gaps the Request Didn't Address

### Decisions the member read path forces

**G1. `is_public = false` means "members only" on the member calendar. Keep it, and fix the form copy.**
- Ruling:
  - Members see every non-cancelled and cancelled event, public or not.
  - `is_public` is only the public-site and Copy-month switch.
- Why:
  - The admin UI already tells admins this: "Members only" at `events-list.tsx:72` and `[eventId]/page.tsx:126`.
  - The Phase 1 events-model log scoped `is_public` as "must not leak a session meeting onto the public page".
  - Leaving it inert would make the calendar show nothing a clerk marked private-from-the-public, which is the opposite of what the label promises.
- Gap: the only control is the checkbox "Visible on the public calendar" (`new-event-form.tsx:193`).
  - An admin who unticks it for a Session executive meeting will believe it is hidden.
  - After this ships, it is visible to every active member.
- Required copy under the checkbox: "If unchecked, the event still shows on the member calendar for everyone in {Org}. It just stays off the public website."
- v1 has no audience tier below "all members". Record in the release note that a Session-only event cannot be expressed. Track it as a follow-up in `docs/TODO.md`.

**G2. Cancelled events are shown, marked, on the member calendar.**
- fpcw hides them (`queries.ts:179`). A member who put "Fellowship supper" on their fridge learns nothing from a vanished entry.
- In the grid and list a cancelled entry reads "Cancelled — Fellowship supper", struck through, and not by colour alone.
- Copy month and the future home card exclude cancelled events.
- Past events stay visible, because navigating back is a month view.
- Operator confirmation is welcome; see Open Question 5.

**G3. The member detail is its own route, `/o/<slug>/calendar/[eventId]`. Do not reuse the admin detail in a read-only mode.**
- `getEvent` is admin-shaped. It returns `allowsCheckin`, `recurrenceCount` and every series sibling (`events.ts:138-162,275-337`), and its page carries Edit, Cancel and Extend-series affordances (`[eventId]/page.tsx:137-152,196-209`).
- Two permission gates in one page is how a manage affordance leaks to a viewer.
- Build a new member projection that never selects admin-only columns (check-in flag, `created_by`, recurrence count, pattern string).
- Do not add a `loading.tsx` at the `/calendar` segment: it would cover `[eventId]/notFound()` and turn the 404 into a 200 (CLAUDE.md, no `loading.tsx` on a segment that 404s).
- Handle the `?from=` back link by the ui-standards rule: validate it against the prefix `/o/<slug>/calendar` and fall back to the hardcoded default. Never reflect an unvalidated value.

**G4. Series: every occurrence appears on the calendar; the one-per-series rule belongs to the home card.**
- The grid and list show each stored row. A weekly series is about 4-5 rows a month.
- The series key for the home pipeline is `coalesce(parent_event_id, id)`, taking the first upcoming non-cancelled row. Hand this to `2026-10-14-portal-home-alignment`.
- `createEvent` children (`events.ts:438-457`) and `extendSeriesPattern` children (`:634-651`) copy fields by hand and must copy `event_type_id`, or every generated child silently loses its type.
- `updateEvent` edits one occurrence (`:488-536`). Changing one occurrence's type leaves a mixed-type series. That is acceptable for v1, but say so in the edit form: "Changes this occurrence only."

### Time (the finding with user-visible cost)

**G5. There is no org time zone, so "today" is undefined. Pick one before Phase 4.**
- Evidence:
  - No time-zone column exists anywhere (grep of `src/lib` and `src/lib/db/domain` is empty; `src/lib/db/domain/events.ts:28-31` and DECISION-113 give D6/US-only as the reason).
  - The only server clock use is the greeting, deliberately "server time" (`src/lib/shared/greeting.ts:13-19`).
- What it means:
  - On Vercel the server runs UTC.
  - Eastern evenings are the next day in UTC for the last four to five hours of every day. The "today" circle lands on tomorrow, and "Today" jumps to the wrong month on the last evening of each month.
  - The home card's "upcoming" test would be worse: comparing stored wall-clock `19:00` to a UTC clock hides a 7 PM event at roughly 3 PM Eastern.
- Recommendation: add `organization_settings.time_zone` (IANA text, default `America/New_York`, not null, set by platform admin in v1, no org-admin UI).
  - Provide one pure `todayInOrgZone(now, tz)` helper.
  - Test it under `TZ=UTC`, `TZ=America/New_York` and `TZ=Pacific/Honolulu`.
  - It is a small schema addition in the same migration (0054).
- If the operator declines, the fallback is to state the limit in the work-log and highlight "today" client-side only (a small island, as `FormattedDate` does). The default month and the Today link would still be wrong on month-end evenings.
- Not acceptable: shipping with the UTC clock unnamed.

**G6. The existing wall-clock round trip is only correct when the process runs in UTC. The new month queries must not inherit that.**
- Evidence:
  - Writes: `parseWallClock` builds a Date from LOCAL parts (`events.ts:103-113`), then Drizzle serialises with `toISOString()` (`node_modules/drizzle-orm/pg-core/columns/timestamp.js:34-36`).
  - Reads: the Neon driver returns raw strings, and Drizzle re-parses a no-zone timestamp as UTC (`timestamp.js:30-32`), but `formatWallClock` reads LOCAL getters (`events.ts:120-126`).
  - On a UTC server (Vercel) the two halves cancel. On a developer laptop in New York the same data displays 4 hours off, and a prod row read there is wrong.
- Calendar rules:
  - Bind month boundaries as `'YYYY-MM-DD'` strings cast to `timestamp` in SQL, with a half-open range: `starts_at >= grid_start and starts_at < next_day_after_grid_end`. fpcw's `lte(23:59:59.999)` drops anything in the last millisecond.
  - Select the wall-clock text from SQL (`sql<string>`, which also satisfies `check:sql-date`), or read with `getUTC*`. Never use `.toISOString().slice(0,10)` for day keys.
  - Render times with a pure formatter on the digits ("7:00 PM"), server-side. `<FormattedDate>` is wrong here: its server fallback is the date only and it re-renders on the client, so a 31-cell grid would show bare dates before hydration (`formatted-date.tsx` header and `ssrFallback`).
  - Weekday and month names come from static arrays (`toLocale*` is banned).
  - Phase 5 must run the calendar tests under a non-UTC `TZ`.

### Adversarial pass

**G7. URL parameters.**
- `?month=`:
  - Accept `YYYY-MM` only, with year 2000-2100.
  - Anything else renders the current month.
  - Do not use `new Date(y, m-1, 1)` as fpcw does (`page.tsx:28-33`): `0000-01` becomes 1900.
  - Prev and next links stay inside the window.
- `?types=`:
  - Split on commas, cap at 50 entries and 2,000 characters.
  - Accept only UUID-shaped tokens (a non-UUID reaches Postgres as an invalid-input 500).
  - Intersect with the org's own type ids before querying.
  - Another org's id matches nothing (the event FK is composite and RLS filters), but it must not select "no pills" or inflate "Filters: N active".
  - If nothing valid remains, treat as All.
- `?view=`: anything except `list` means month.
- `[eventId]`: validate UUID shape before any query and return 404. Today the admin page gives a "couldn't load" state for a garbage id (`events.ts:285-289`, `[eventId]/page.tsx:91-96`). That is a minor existing defect worth a follow-up.
- A filter only narrows what `events.view` already allows. A URL parameter is not a permission.

**G8. State preserved across navigation.**
- fpcw's prev, next and Today links rebuild the URL from `month` alone (`page.tsx:107`), so every month change silently drops the member's filters.
- Presby must carry `types` and `view` through prev, next and Today (Today resets only `month`).

**G9. Copy month, content.**
- May carry:
  - A heading with month and year only ("October 2026").
  - Day numbers.
  - Per entry, a compact time, title and location.
- Must not carry:
  - Org name, address or phone. A tenant's brand and contact details are the editor's to add, and the org name only duplicates their masthead.
  - Event ids, URLs or `/o/<slug>` deep links (portal paths do not belong in a printed newsletter).
  - Descriptions, creator, type names or colours (colour is dropped by design, as fpcw does).
- Rows left out:
  - `is_public = false` events. The newsletter is outward-facing, and fpcw's DECISION-159 reasoning applies. Here there are no booking or meeting kinds, so the rule is simpler: drop every non-public event.
  - Cancelled events.
- Tell the user what was left out in the toast ("2 members-only events left out"), or an editor will think the tool lost them.
- Copy the month grid for the active filters, regardless of the `view` param.
- Every interpolated string passes through the existing `escapeHtml` (`src/lib/email/escape-html.ts:10`).
- An event starting before the grid and a multi-day event appear once, on their start day. That matches fpcw. Document it.
- Apply the public/cancelled filter on the server inside `buildMonthClipboard`, so a dropped row never reaches the browser.
- Button placement follows ui-standards: last in the action row, 44 px.

**G10. Event types: migration and data rules.**
- Seeding:
  - Backfill all existing orgs in the migration, idempotently (`insert … where not exists (select 1 from event_types where organization_id = o.id)`), and seed inside `createOrganization`'s transaction like the derived groups.
  - Do not create types lazily on read. A `GET` that writes would run under `events.view`, a read-only grant.
  - Add a manager-page affordance, "Add the standard event types", for the zero-rows case (test fixtures, odd legacy orgs).
- Default set:
  - Reuse fpcw's nine: Worship, Classes and Bible Study, Youth and Children and Committees active; the rest inactive; one fallback, neutral.
  - Do not seed congregation-flavoured active types onto presbytery, synod and GA orgs, where nobody holds `event_types.manage` to remove them.
  - Name the fallback something plain ("General"). "Church Life" is fpcw's own phrase.
- Fallback rules under RLS:
  - A partial unique index `(organization_id) where is_fallback` holds regardless of RLS, because constraints ignore policies.
  - Add a CHECK that a fallback row is active.
  - "At least one fallback" cannot be a constraint, so it is `paper` in `/developer`. The mitigations are provisioning, the backfill, and the next rule.
  - The calendar must never require the fallback row to exist. With zero rows it renders untyped events as neutral, with no filter pills, and the manager page offers the standard set.
- Other type rules:
  - Names unique per org on `lower(name)`, trimmed, 1-60 characters.
  - Colour must be one of the palette tokens and icon one of the closed list, validated server-side (a DB CHECK is optional).
  - Types are never hard-deleted.
  - The composite FK `(event_type_id, organization_id)` with `ON DELETE SET NULL` would null `organization_id` (NOT NULL) in Postgres unless written as `ON DELETE SET NULL (event_type_id)` (PG15+) or replaced with `RESTRICT`. Since nothing deletes types, RESTRICT is the honest choice. Flag to the architect.
  - Adding `event_type_id` leaves the six columns frozen by DECISION-113 untouched (`domain/events.ts:34-39`), but the same-org-only FK must be composite (F2).
  - Retiring a type leaves existing events unchanged, still showing the retired type's colour and icon. The type drops out of pickers and pills only. Manager microcopy: "Existing events keep this type. It won't be offered for new events or shown as a filter."
- Audit:
  - The kickoff says to audit every type mutation, but DECISION-113 ruling 5 and `admin/events/actions.ts:35-39` say events mutations are deliberately unaudited ("do not add one without a fresh architectural ruling").
  - Event types are content configuration of the same class. Keep the kickoff's intent, because taxonomy changes are low-volume and visible to every member, but get an explicit architect ruling rather than diverging silently.
  - Note `check:audit` only pattern-matches `db.insert/update/delete/execute` inside `actions.ts`, so it will not see mutations written as `tx.insert`.

**G11. Palette tokens.**
- ui-standards forbids Tailwind palette literals and status colours are a known token gap (`docs/ui-standards.md:117`).
- fpcw's `type-palette.ts` is all literals (`bg-teal-50 text-teal-900 border-teal-300`).
- Eight categorical colours plus neutral must be declared as platform-classified tokens in `src/lib/brand/contract.ts`, with their `LEGAL_PAIRS` at 7:1 for text and 3:1 for non-text, in both colour schemes. A brand colour must not be able to re-declare them.
- This is real Phase 2/3 work and affects the "medium-to-large" estimate.
- Type is conveyed by icon and name too. fpcw's month-grid cells carry colour only; the icon appears only in its list view (`page.tsx:314`). Presby grid cells need the icon plus a visible or screen-reader type name.
- The calendar must stay legible when printed in black and white (ui-standards, Print).

### Remaining edge cases

**G12. 2FA mid-enrolment.** `/o/*` is already gated at the Edge. A not-yet-enrolled user is pushed to `/totp` before the calendar, and the route is read-only, so no special handling is needed. QA should confirm the Edge matcher covers `/o/<slug>/calendar` and `/calendar/<id>`.

**G13. Empty states.**
- Brand-new org, no events at all (needs a cheap `exists` query to tell it apart from an empty month):
  - A manager sees: "{Org} hasn't added any events yet." with an Add an event button.
  - Anyone else sees: "When {Org} adds events, they'll appear here."
- Empty month:
  - "Nothing is scheduled for October 2026." Prev and next stay visible.
- Filters hide everything:
  - "No events match these event types." with a link, "Show all event types".
- Zero types: the calendar works and the pill row is omitted.

**G14. Mobile (360 px).**
- Below md only the list renders. The month/list toggle is a dead control there (fpcw keeps it on phones), so hide it below md.
- Entry rows, pills, prev, next and Today are at least 44 px. Dense grid cells stay at the 14 px floor, with no `text-xs` on member pages.
- The "Show filters" disclosure must be verified on a phone viewport. Past `<details>` and `<summary>` bugs on iOS are why. Without JS the pills should still be reachable.
- Pills are plain links, so they work before hydration.
- The type manager form roots need `HydrationGate` (`check:hydration-gate`).
- The picker select on the event forms is already covered by the existing roots' gate.

**G15. Admins who hold `events.manage` but not `events.view`.** A custom role like that would see Manage events and a forbidden calendar. Recommendation: the calendar's read gate is `events.view OR events.manage`. A manager can always see what they manage. This is not a wildcard.

**G16. Copy month on the last evening of a month** uses the same time zone as G5. Nothing else is needed.

## Out of Scope (confirm with user)

- Rooms, bookings, the `kind` enum, meetings, the kinds control and the room filter (Track A).
- The Google Calendar publish gate and the public `<fpcw-events>` feed.
- `is_public` on the public site (Increment 4).
- Signups and RSVPs.
- Recurrence semantics.
- Week and day views.
- All-day events. There is no all-day column, so an event at 00:00 shows "12:00 AM".
- Multi-day spanning in the grid (an event shows on its start day only).
- A Session-only or other audience tier below "all members" (G1). Track it as a follow-up.
- Per-org tile labels.
- A time-zone admin UI (G5).
- `docs/TODO.md:33` bundles `event_types` into Track A. At integration, split that line (Rule 10).

## Open Questions

1. **Time zone (G5).** Add `organization_settings.time_zone`, default `America/New_York`, in migration 0054? I recommend yes. The alternative is a client-side "today" and an acknowledged month-end-evening defect.
2. **Per-org rollout.** The kickoff says `org_portal.calendar` should "flip per org", but flags are global.
   - (a) Global flag only, with the baseline-role backfill meaning every org gets the calendar at once. An org with no events sees the empty state.
   - (b) Also add the key to `ORG_FEATURE_CATALOG` (`src/lib/org-features.ts:61`) for a per-org toggle (DECISION-097). This costs a catalog entry, a category mapping and tests.
   - I recommend (b) if more than one org is live when this flips. Otherwise (a), and correct the kickoff wording.
3. **Backfill of `events.view` to every existing org's `member` role.** This is a permission grant to all members of all orgs, made by migration. It is tier 1 and read-only like `directory.view`, so the release note should say so. Confirm that is wanted rather than leaving it to each stated clerk.
4. **Two tiles (the tile matrix above).** Confirm the "Manage events" move to administer, which reverses DECISION-113 ruling 7.
5. **Cancelled events visible** (G2). Confirm. The alternative is fpcw's behaviour of hiding them.
6. **Audit for type mutations** (G10). The architect should rule, since DECISION-113 ruling 5 currently forbids audit rows for event mutations.
7. **`events.view OR events.manage`** as the read gate (G15). Confirm.

## Handoff

Next agent: **architect** (Phase 2). The architect should rule on: G5 (time zone) and G6 (wall-clock handling in queries); G11 (palette tokens); the composite `ON DELETE SET NULL` hazard in G10; the two-tile registry change and the DECISION-113 ruling 7 reversal; whether type mutations are audited; the per-org toggle (Open Question 2).

The analyst did not read the other work-log (`2026-10-14-portal-home-alignment`) beyond its header. Its "Church Events" card consumes G4's series key and the "upcoming" clock from G5.

## Operator rulings on Phase 1 open questions (orchestrator, 2026-10-14)

Asked by the orchestrator, answered by the operator the same afternoon:

1. **Time zone (OQ 1 / G5): YES.** Add `organization_settings.time_zone` (IANA text, default `America/New_York`, not null, platform-admin-set in v1, no org-admin UI) in migration `0054`. One pure helper (`todayInOrgZone(now, tz)` or equivalent) that the calendar, the home-page events card, and later the greeting all consume. Tests under `TZ=UTC`, `America/New_York`, `Pacific/Honolulu`.
2. **Rollout (OQ 2): NO new platform flag.** Operator, verbatim: *"no need to put it under a feature flag. we are not live yet. we do need to be able to turn features on/off per organization though."* So: **drop the proposed `org_portal.calendar` flag.** The member calendar is gated by a **per-organization toggle** (the `ORG_FEATURE_CATALOG` / DECISION-097 mechanism, or whatever the architect rules is the right per-org on/off), plus the permission. The architect must rule on how a per-org toggle works for a key that has no platform flag (DECISION-097's gate order is flag → category → org toggle → permission; the first axis is absent here) and whether the toggle defaults ON or OFF for existing orgs. The kickoff's "`org_portal.calendar` (seeded OFF)" line is superseded by this ruling. `org_portal.events` (the admin surface) is unchanged.
3. **`events.view` backfill (OQ 3): YES.** Migration `0054` binds `events.view` to every existing org's baseline `member` role, idempotently, and `baselineRoleSeedPlan` in `src/lib/org-provisioning.ts` grants it at provisioning. Release note states it plainly (tier 1, read-only, same class as `directory.view`).
4. **Cancelled events (OQ 5 / G2): HIDE them.** fpcw-directory's behaviour, not the analyst's recommendation. The member calendar, the member detail (404 — identical to a missing id, so a cancelled event is not distinguishable from one that never existed), Copy Month, and the home card all exclude `cancelled_at is not null` rows. The admin list keeps showing them.

OQ 4 (two tiles / DECISION-113 ruling 7), OQ 6 (audit on type mutations), OQ 7 (`events.view OR events.manage` read gate) go to the architect as the analyst proposed.

### Requirement placed by `2026-10-14-portal-home-alignment`'s Phase 2 architect on this pipeline's Phase 3 (copied by the orchestrator, 2026-10-14)

The home pipeline's "Coming up" card consumes the calendar's member read path. Its architect specified the contract below so both Phase 3 designs agree; this pipeline's tech-lead confirms or amends it, and the amendment is relayed back.

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

---

# Phase 2 — Architectural Review (architect)

*Recorded verbatim by the orchestrator, 2026-10-14. The architect read files and ran read-only catalog queries against the pipeline's Neon branch as both connections; nothing was written.*

## Verdict

**Approved with suggestions.**

Nothing goes back to Phase 1. Every open point is settled by a ruling below, and the operator's four rulings are honoured as written. The binding items (R1–R12) are things Phase 3 must design to. The suggestions (S1–S5) are optional.

## Placement

**Directory placement**

- **`src/lib/calendar.ts`** (new, `server-only`): the member read path.
  - Month query, member-shaped detail, active types for the filter pills, and the "does this org have any events" check.
  - Every function checks one private gate first: `events.view OR events.manage` (R8).
  - It does not extend `src/lib/events.ts`. That module's contract is "`events.manage` checked first in every export", and each module here has one permission gate.
- **`src/lib/calendar/`** (new, pure, no `server-only`). Same split as `events.ts` plus `events/recurrence.ts`.
  - `month.ts`: parse `?month=`, compute the grid range, prev/next inside the 2000–2100 window, static weekday and month name arrays.
  - `filters.ts`: parse `?types=` (cap, UUID shape, intersect with the org's own ids).
  - `wall-clock.ts`: format time from the digits ("7:00 PM").
  - `clipboard.ts`: `buildMonthClipboard`. It is pure, takes the already-loaded rows, drops non-public and cancelled rows, and imports `escapeHtml` from `src/lib/email/escape-html.ts` (already pure, leave it where it is).
- **`src/lib/event-types.ts`** (new, `server-only`): manager CRUD, gated by `event_types.manage` only.
  - The picker's option list is read in `src/lib/events.ts` under `events.manage`, because it is data for the event form.
- **`src/lib/events/type-palette.ts`** (new, pure): the closed palette keys, the closed icon keys, and the static class lookup (R5).
- **`src/lib/shared/org-time.ts`** (new, pure; the same folder as `greeting.ts`): `DEFAULT_ORG_TIME_ZONE`, `isValidTimeZone`, and `wallClockNow(now, tz)` / today's day key (R2).
- **`src/lib/org-settings.ts`** (new, `server-only`, small): `orgTimeZoneInTx(tx, organizationId)`. Callers use it inside their own `withOrgContext` transaction.
- **`src/lib/org-portal/visible-tiles.ts`** (new, `server-only`): `visiblePortalTiles` moves here from `tiles.ts` (R1, F135).
- **`src/lib/db/domain/events.ts`**: `eventTypes` is declared above `events` in this file, not in a new file. It is the FK target, it belongs to the events module, and it needs no edit to the Rule-16 file `domain/index.ts`.
- **Routes**
  - `src/app/(org)/o/[slug]/calendar/page.tsx`
  - `src/app/(org)/o/[slug]/calendar/[eventId]/page.tsx`
  - `src/app/(org)/o/[slug]/admin/events/types/` (page, `actions.ts`, forms)
  - **No `loading.tsx` on any new segment** (`/calendar`, `/calendar/[eventId]`, `/admin/events/types`): each one can `notFound()`.
- **Components**
  - The grid, list, filter row and Copy Month button are only used by `/calendar`, so they sit next to it in the route folder (Component Rule 3).
  - The event-type display pieces (icon, type chip, colour swatch) are used by the calendar, the detail page, the admin list and forms, the types manager, and the home-alignment pipeline's events card. They go in `src/components/org-portal/event-types/`, which is for pieces only the org portal uses. Not `shared/`: platform-shell pages never render an event type.

**Server vs Client split**

Everything is a Server Component except:

- **Copy Month button.** It needs the clipboard API. It receives only `{html, text, leftOutCount, filterLabel}`. It renders disabled until `useHydrated()` reports true, so a click before hydration is never silently lost (F129). The HTML string is never rendered into the DOM: no preview, and `dangerouslySetInnerHTML` is banned by check:brand-scope rule E3 anyway.
- **Types-manager forms.** They render inside `<HydrationGate>`, which `check:hydration-gate` enforces.
- **`EventTypePicker`.** It sits inside the existing event forms, which are already gated.

The mobile filter disclosure is **native `<details>`/`<summary>`, server-rendered, with no client island**. The pills inside are plain links, so they work before hydration. Constraints:

- Never set a `display` utility on `<summary>`. Put the layout on an inner `<span>`, following `admin/roles/new/create-role-form.tsx:51-53`.
- `min-h-11` and `list-none` are fine because neither changes `display`.
- At md+ the filters must always show, and CSS can't force a closed `<details>` open. So render the pill row twice: inside `<details className="md:hidden">` and as a plain `hidden md:flex` row. The hidden copy is `display:none`, so assistive technology reads only one.
- Phase 5 must check the disclosure on a phone viewport.

**Dependencies:** none.

- No calendar library.
- `date-fns` is not in `package.json` and isn't needed. The month grid is integer arithmetic plus `Date` objects used only through their UTC fields (`Date.UTC`, `getUTC*`); see R3.
- Icons come from the installed `lucide-react` through a static import map, so a misspelled icon name fails `tsc`. Icon components never cross the server→client boundary; pass icon keys instead (`portal-nav.tsx` records a real 500 from this).

## Invariants Touched

- **Permissions vs Flags (DECISION-003/097).** Changed in one bounded way: a toggle-only catalog key (R1).
  - The calendar asks "is this on for this org?" through the per-org toggle, and "may this user?" through the permission.
  - A flag still never grants access, and the toggle is not a permission.
  - Tiles still never check permissions. The org toggle answers the same "is this on at all" question a flag answers, just per org.
  - What is lost, recorded rather than hidden: there is no platform-wide kill switch for the calendar. Rollback is per org (`/o/<slug>/admin/features`, one SQL `update`, or a deploy revert). The operator accepted this in ruling 2.
- **Isolation is a database property.**
  - `event_types` gets ENABLE + FORCE RLS, the standard `tenant_isolation` policy (`presby_current_org()`, both `USING` and `WITH CHECK`), and no DELETE grant.
  - `organization_settings.time_zone` sits on a table that is already FORCE RLS (checked live).
  - Phase 5 must re-read the live catalog after 0054 is applied (see Notes), not just `drizzle/`.
- **Composite tenant keys (F2).**
  - `event_types` has `unique (id, organization_id)`.
  - `events.(event_type_id, organization_id)` is a composite FK with the default NO ACTION (R4).
  - The six columns frozen by DECISION-113 are untouched.
- **Never hard-delete (extended by analogy).** Event types are retired, never deleted, enforced by withholding the grant. "At least one fallback per org" cannot be a constraint, so it is `paper` and must be marked that way in `src/lib/dev-docs.ts`.
- **Extensibility goes through support (D8).** Compatible; see R4 and DECISION-161. Not a precedent for org-owned `group_types`.
- **The brand is a cascade override (DECISION-046/047/052).**
  - The category palette is platform-classified: a brand can't re-declare it, and it renders the same in every org.
  - The token partition stays three-way.
  - `check:brand-scope` doesn't change, and no new emitter or brandable surface is added.
- **Verify in a browser / hydration (DECISION-159).**
  - The manager forms go inside `HydrationGate`.
  - Copy Month is disabled until hydration.
  - The `<details>` disclosure gets a phone-viewport check.
- **The Edge gate cannot reach the database.** Untouched. `src/proxy.ts` 2FA-gates `pathname.startsWith("/o/")` (line 78). Its matcher excludes only `_next/*`, the favicon and image extensions, so `/o/<slug>/calendar` and `/o/<slug>/calendar/<uuid>` are both covered. Nothing new is imported into the proxy.
- **DECISION-113 ruling 3 (wall-clock storage).** The ruling stands. Its stated reason ("no org-timezone column exists") is replaced: the new column is the zone in which *now* is read, never a conversion of stored event times (R2).
- **DECISION-113 ruling 5.** Extended to event types: they are not audited (R7).
- **DECISION-113 ruling 7.** Reversed for the events tile only, on a general rule (R6).
- **DECISION-115 ruling 4.** Amended: `flagKey` is no longer required when an `orgFeatureKey` is present (R1).
- **No `loading.tsx` on a redirect/404 segment.** Honoured.
- **No CLAUDE.md change is required.** If the orchestrator wants Key Invariants to say that toggle-only catalog keys exist, a one-line pointer to DECISION-160 under Permissions vs Flags is enough.

## Notes

### Live catalog read

Read on the database in the worktree's `.env.local` (the pipeline branch per the kickoff), inside read-only transactions, as both `presby_app` and the owner connection:

- PostgreSQL 18.6.
- `relforcerowsecurity = t` on `events`, `organization_settings`, `organization_feature_toggles` and `tags`.
- `presby_app` holds `SELECT/INSERT/UPDATE/DELETE` on all four.
- `neondb_owner` and `presby_platform` are `rolbypassrls`.
- Organizations: **15** (9 congregations, 5 presbyteries, 1 synod).
  - **2** `organization_settings` rows.
  - **2** org-owned `member` roles, both on congregations; no template `member` role.
- `permissions` holds only `directory.view` and `events.manage` of the relevant keys.
- Toggle rows: 2 (`members_create`, `sensitive_info`).
- Flags: `org_portal.events` on, `org_portal.features` on, `org_portal.feature_categories` off.
- `events` has **0** rows.
- `timezone(text, timestamp)` is IMMUTABLE (`provolatile = 'i'`).
- Postgres accepts the POSIX string `UTC+5` (sign inverted) where Intl rejects it.

### Binding rulings

**R1. A per-org toggle with no platform flag (DECISION-160)**

- **How the key enters the catalog.** `isOrgFeatureEnabled()` (`src/lib/org-features.ts:127-162`) reads no flag for the key itself. Its only flag read is the category-axis kill switch `org_portal.feature_categories`. Every existing call site does `isFlagEnabled(KEY)` before calling the resolver (e.g. `admin/members/page.tsx:111-120`). So a key with no flag needs no resolver change. Gate order for the calendar: category → org toggle → permission.
- **The key** is `org_portal.calendar`, category `worship`. It keeps the `org_portal.*` namespace; the toggle table's "same string as the flag" is a convention, not an FK.
- **Make the missing axis explicit.** Every `ORG_FEATURE_CATALOG` entry gains a required `flag: string | null`.
  - The two existing entries name their same-string flag; the calendar entry is `null`.
  - Call sites gate on `entry.flag === null || isFlagEnabled(entry.flag)`, then the toggle, then the permission.
  - Test: every non-null `flag` is a seeded flag key.
- **Default: ON for existing and newly provisioned orgs, stored as explicit rows, not as a code default.**
  - DECISION-097's "missing row = off" stays unconditional, so changing a code constant can never silently flip every org that has no row.
  - The catalog gains `provisionedOn: boolean`, true only for the calendar.
  - Migration 0054 inserts `(o.id, 'org_portal.calendar', true, updated_by null)` for every org with `on conflict do nothing`. `updated_by` is already nullable for exactly this case.
  - `createOrganization()` inserts a row for every `provisionedOn` entry inside its existing transaction.
  - Why ON: the operator ordered `events.view` granted to every member and said "not live". A read grant to a surface that is off would be a grant to nothing. The toggle is the off switch the operator asked for.
- **Tile registry (amends DECISION-115 ruling 4).**
  - `PortalTile` must carry at least one of `flagKey` or `orgFeatureKey`, and `tsc` must enforce that (a union type, not two optional fields).
  - `orgFeatureKey` uses a type-only import of `OrgFeatureKey`.
  - The calendar tile has `orgFeatureKey` and no `flagKey`.
  - `visiblePortalTiles` moves to `src/lib/org-portal/visible-tiles.ts` with a new required `viewer: { personId, organizationId }`. Its four callers (`page.tsx`, `admin/page.tsx`, `portal-nav.tsx`, `portal-footer.tsx`) already sit inside the resolved-ok branch, so the ids are on hand.
  - **It must not live in `tiles.ts`** (F135).
  - An error from the org-toggle read hides the tile and logs ids only. It never throws, because the nav and footer must fail exactly the way a flag read does today.
  - `cache()` dedupes the toggle read across nav, footer and page within one request.
  - `tiles.test.ts`'s "every flagKey is seeded" test becomes "every tile has a gate, and every `orgFeatureKey` is a catalog key".
- **`org_portal.events` is unchanged.** It gates the admin events surface, the event-type manager and the picker. **The types manager is not gated by the calendar toggle**: types feed the admin event forms whether or not the calendar is on.

**R2. The time zone column (DECISION-160)**

- **Placement.** `organization_settings.time_zone text not null default 'America/New_York'`, per operator ruling 1.
- **F132: most orgs have no settings row**, so the default never applies to them. All three of these are required:
  1. The reader falls back to the default. This is the contract. In SQL, the left-join-with-`coalesce` shape is fine.
  2. 0054 inserts a default settings row for every org (`on conflict do nothing`). This changes no behaviour: `presby_two_factor_required()` inner-joins `organization_settings`, and a default row has `require_two_factor = false`, the same as having no row. `/admin/2fa/page.tsx:68` already left-joins.
  3. `createOrganization()` inserts the settings row in its transaction. Fixtures created any other way still rely on step 1.
- **Validity enforced in the database.** A CHECK named `organization_settings_time_zone_valid` with two clauses:
  - `time_zone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$'`
  - `(timestamp '2000-01-01' at time zone time_zone) is not null`
  - The second clause is legal in a CHECK because `timezone(text, timestamp)` is IMMUTABLE on PG 18. An unknown zone raises an error, so the write is rejected.
  - The shape clause is not optional. Postgres accepts POSIX `UTC+5` (verified) and bare `EST`, which Intl handles differently or not at all.
- **Validity enforced in the app.** `orgTimeZoneInTx` checks the stored value with `isValidTimeZone`. If Node's ICU disagrees with Postgres's tzdata, it falls back to the default and logs the org id only.
- **Meaning.** This is the zone in which "now" is read: today's highlight, the default month, the Today link, and the home card's "upcoming" test. It is **never** used to convert a stored `starts_at`. No permission is needed to read it; org membership is the gate.
- **Intl ruling.**
  - `Intl.DateTimeFormat` is a different API from the banned `toLocale*` (the ESLint selector at `eslint.config.mjs:30` matches only `toLocale(String|DateString|TimeString)`).
  - It is permitted only with an explicit `"en-US"` locale, an explicit `timeZone` and `hourCycle: "h23"`, and only to pull numeric parts with `formatToParts`.
  - It may appear only in `src/lib/shared/org-time.ts` (plus the existing precedent `src/lib/format-date.ts`), never in a component.
  - Month and weekday names come from static arrays.
  - Tests run under `TZ=UTC`, `America/New_York` and `Pacific/Honolulu`.

**R3. Wall-clock handling (G6): confirmed, with one required fix added (DECISION-160, F134)**

- **Confirmed for the calendar:**
  - Month bounds are bound as `'YYYY-MM-DD'` text, cast `::timestamp`, half-open (`>= grid_start and < day_after_grid_end`).
  - Times are selected as text, `to_char(e.starts_at, 'YYYY-MM-DD"T"HH24:MI')`, through `sql<string>`.
  - A pure server-side formatter works on those digits.
  - `<FormattedDate>` is not used for event times.
  - Day keys are built from padded integers, never `.toISOString().slice(0,10)`.
  - Grid arithmetic uses only `Date.UTC` / `getUTC*` / `setUTC*` or plain integers, never local getters or setters.
  - The SQL `WHERE` excludes cancelled rows (operator ruling 4), and a cancelled id on the detail route gets the same 404 as a missing one.
- **Fix required in this pipeline: the writer.**
  - The problem: drizzle-orm's `timestamp.js:30-36` writes a no-zone value with `toISOString()` and reads it back by appending `"+0000"`. `parseWallClock`/`formatWallClock` (`src/lib/events.ts:103-126`) and `src/lib/events/recurrence.ts` use local getters and setters. So the stored digits equal the typed digits only when the server process runs in UTC.
  - The effect: the calendar's text reader and the admin pages' `Date` reader disagree on rows written from a non-UTC process, such as the operator's local demo and Phase 5's non-UTC test run. A weekly series written from New York also stores digits an hour off after a DST change.
  - The fix: both modules switch to `Date` objects used only through their UTC fields.
  - Data impact: this branch has 0 events rows, and production rows were written on Vercel, which runs UTC, so no stored value changes.
  - It ships as its own `fix(events):` commit with `Caught-By: agent-review` / `Discovered-In: Phase-1` and a regression test that fails before and passes after under `TZ=America/New_York`.
  - Rejected alternative: `mode: "string"` on the columns. It churns types across `events.ts` and the forms, and the recurrence math still needs a `Date` to compute with.

**R4. The `event_types` table (DECISION-161)**

Shape, all in `src/lib/db/domain/events.ts` with the DDL hand-written in `drizzle/0054_presby_calendar_event_types.sql`:

- **Columns**
  - `id uuid pk default gen_random_uuid()`
  - `organization_id uuid not null references organizations on delete cascade`
  - `name text not null`, with `CHECK (name = btrim(name) and char_length(name) between 1 and 60)`
  - `color text not null`, with a CHECK against the closed 9 keys
  - `icon text not null`, with a CHECK against the closed icon list
  - `sort_order int not null default 0`
  - `is_active bool not null default true`
  - `is_fallback bool not null default false`
  - `created_at` and `updated_at timestamptz`
  - `updated_by uuid references users`
- **Constraints and indexes**
  - `event_types_id_org_key unique (id, organization_id)`.
  - A unique index on `(organization_id, lower(name))` covering all rows. Retired names stay reserved, so reactivating one can't create a second "Worship".
  - A partial unique index on `(organization_id) where is_fallback`.
  - `CHECK (not is_fallback or is_active)`.
  - If Phase 3 reserves `neutral` for the fallback (fpcw does), that is also a CHECK, not just application code.
- **The closed lists.** The palette and icon CHECKs are closed vocabularies, following the `tickets.area` / type-pairing precedent (DECISION-076/093). Widening one later takes a migration. A test pins the TypeScript lists to the CHECK lists.
- **The FK from events.** `events.event_type_id uuid` (nullable), with `constraint events_event_type_fk foreign key (event_type_id, organization_id) references event_types (id, organization_id)`, **default NO ACTION**. Not the alternatives:
  - **Not `SET NULL`.** It would null `organization_id` (the analyst is right). The PG15+ column-list form exists on PG 18, but it describes a delete path that doesn't exist.
  - **Not `RESTRICT`.** RESTRICT checks immediately. When a test fixture organization is deleted (`deletable_until`; `e2e/admin-organizations-create.spec.ts:51`), the cascade removes `events` and `event_types` in the same statement, and an immediate check can fail depending on which cascade fires first. NO ACTION waits until the end of the statement.
  - Add an `events_org_type_idx (organization_id, event_type_id)` index.
  - Mirror the FK in Drizzle with `foreignKey({ name })`, because `check:schema-parity` compares FK shape in both directions.
- **RLS and grants.** ENABLE + FORCE RLS and the 0036-shape `tenant_isolation` policy. Grant `select, insert, update` to `presby_app` and `presby_platform`, and **no delete**. FK cascades from `organizations` run as the table owner and need no grant.
- **Seeding.**
  - A pure `eventTypeSeedPlan(organizationType)` in `org-provisioning.ts`, next to `groupSeedPlan` (the inline-plan precedent from DECISION-100).
  - Congregations and new worshiping communities get the standard set (fpcw's nine, five active including the neutral "General" fallback).
  - Presbytery, synod and GA orgs get **the fallback only**.
  - The 0054 backfill mirrors the plan per org type and is guarded by `where not exists (select 1 from event_types where organization_id = o.id)`.
  - `createOrganization()` seeds inside its transaction.
  - A DB-backed test asserts the backfill produces the plan for every org type.
  - Types are never created lazily on a read.
- **Writes from event forms.** The event write path pre-checks the type id inside the transaction and returns `invalid_input` ("That event type isn't available. Choose another."). The composite FK is the backstop.
- **Series children.** `createEvent`'s children and `extendSeriesPattern`'s children copy `event_type_id` (G4).
- **D8.** Event types are an org's own set of values for one platform-designed, tier-1 attribute. That is the same shape as `tags`, D8's single tenant-extensible attribute, which `docs/schema-design.md:553-554` already says covers "event targeting". No column, no per-org schema, closed palette and icons. DECISION-110/151 keep `group_types` global because the derived-group machinery keys on them; that reasoning doesn't apply here, and this is not a precedent against it.

**R5. Palette tokens (DECISION-161)**

- **The keys.** 9 keys: 8 categorical colours plus `neutral`. Two tokens per key:
  - `--category-<key>`: the tint surface.
  - `--category-<key>-foreground`: the "ink", used for label text, icon and swatch.
  - The family is named `category`, not `event`, because it is a platform vocabulary (`tags.color` may adopt it later).
  - No token name may contain `brand`, or check:brand-scope rule C1 would match it.
- **Classification.**
  - `TOKEN_POLICY` entries with `policy: "platform"` and a new optional marker `categorical: true`.
  - **No new policy class; the partition stays three-way.**
  - `brand-tokens.tsx`'s `REDECLARABLE_TOKENS` is derived from the policy, so the brand emitter **cannot** re-declare these tokens with no code change.
  - `PLATFORM_COLOR_TOKENS` picks them up automatically, so `light_only` orgs get the light values in dark mode, which is correct.
- **Pairs: not in `BRAND_ROLES`, `ROLE_TO_TOKEN` or `LEGAL_PAIRS`.**
  - `generate.ts` iterates `BRAND_ROLES` for every seed, `LEGAL_PAIRS` is the site-kit agent's instruction payload, and `LegalTone` types the public-site blocks. A category colour is none of those things.
  - Instead, add a new exported `CATEGORY_PAIRS` in `contract.ts`. It is token-name based, with the same `min`/`kind` shape.
  - **Ink on tint ≥ 7:1** (`body`; entry text is `text-sm` on member pages, and the AAA floor matches D1).
  - **Ink on `--background` ≥ 3:1 and on `--card` ≥ 3:1** (`non-text`; swatch and icon).
  - Both colour schemes.
  - `contract.test.ts` iterates `CATEGORY_PAIRS` and, from the marker, asserts that every categorical key has its full pair set. It goes in `contract.ts`, not in a local test list, because `contract.test.ts:125-138` says adding vocabulary is a contract change.
- **Where the CSS lives.** In `globals.css` under `:root` and `.dark`, like every platform token, with `@theme inline` mappings to `--color-category-*`. The contract test's two-way closure check covers them.
- **Class lookup.** A static map in `type-palette.ts`. Class names are never built by template interpolation, because Tailwind only finds literal class strings.
- **`check:brand-scope`.** It sees nothing here and needs nothing. The "brand can't re-declare" guarantee comes from `TOKEN_POLICY`, the emitter's derived filter and the contract tests, not from the grep.
- **Docs.** `docs/ui-standards.md` names the category family as approved tokens. They are not the status colours (the reserved `--success`, `--warning` and `--info` gap stays open).

**R6. Two tiles (DECISION-160)**

Approved. The rule: **when a feature has both a member read surface and an authoring surface, the read surface goes in the operate section and the authoring surface goes on the admin hub (administer).** On that basis, DECISION-113 ruling 7 is reversed for events only.

- The `events` tile keeps its key, is relabelled "Manage events", moves to `administer`, and keeps `domain: "worship"`.
- The new tile is `calendar`: operate, worship, with `orgFeatureKey: "org_portal.calendar"`.
- "Manage events" shows on the admin hub only when `org_portal.admin_hub` is on. The calendar page's permission-checked "Add an event" / "Manage events" link is the other way in.

**R7. Audit (DECISION-161)**

Event-type mutations are **not audited**.

- This extends DECISION-113 ruling 5: they are content configuration, not an identity, access or security change.
- There is no tenant audit reader yet (DECISION-067), so an audit row would have no tenant-side reader.
- Attribution comes from `updated_by` / `updated_at` instead.
- This supersedes the kickoff's "AUDIT_ACTIONS keys for every mutation".
- `admin/events/types/actions.ts` states this in its header. Any direct `db.`-mutation in that file carries `// audit-exempt: DECISION-161`.
- An org admin flipping the toggle is still audited (`ORG_FEATURE_TOGGLED`, unchanged). Rows written by the migration or by provisioning are not audited, like every other provisioning seed.

**R8. Read gate (DECISION-160)**

`events.view OR events.manage` is approved for the calendar, the detail page, the pills and the clipboard.

- It reveals nothing `events.manage` can't already read in the admin list.
- It is implemented as one private helper in `calendar.ts` that makes both `presby_has_permission` calls in a single statement.
- It is **not** an implication built into the resolver or the catalog; `presby_has_permission` is unchanged.

**R9. Permission catalog rows.** `events.view` (tier 1) and `event_types.manage` (tier 1, no default binding) are seeded in 0054, per the DECISION-063 precedent.

- The backfill grants `events.view` to every **org-owned** `member` role: `where r.key = 'member' and r.organization_id is not null`, `on conflict do nothing`.
- `baselineRoleSeedPlan` changes from a single `permissionKey` to a list.

**R10. Wall-clock code stays UTC-only.** After R3, no file in `src/lib/events/**`, `src/lib/calendar/**` or `src/lib/shared/org-time.ts` uses a local `Date` getter or setter. S1 makes this enforced.

**R11. Dependencies.** None. Confirmed against `package.json`.

**R12. Edge gate.** Coverage confirmed (see Invariants). No change.

### For the orchestrator at integration (Rule 16 files)

- **`scripts/seed-dev.sql`** must mirror what the migration backfill can't reach on a fresh database. CI runs migrations before any org exists. Needed:
  - toggle rows for the fixture orgs;
  - default settings rows;
  - event types for at least the fixture congregation;
  - `events.view` on Alder Creek's `member` role.
- **`scripts/test-rls.sql`** needs new sections. The implementer drafts them in the work-log:
  - `event_types` cross-org reads return zero rows;
  - a cross-org `event_type_id` is rejected by the composite FK;
  - `presby_app` DELETE on `event_types` is denied;
  - the one-fallback index holds;
  - fixture-org delete still cascades when an org has a typed event (the NO ACTION proof).
- **`docs/TODO.md`**: split line 33 (event types out of Track A), and add the follow-ups from F133 and S2–S5.

### For Phase 5: re-read the live catalog after 0054, not just `drizzle/`

- `relforcerowsecurity` on `event_types`.
- `pg_policies`.
- `aclexplode(relacl)` shows no DELETE for `presby_app` or `presby_platform`.
- `pg_constraint.confdeltype = 'a'` (no action) on `events_event_type_fk`.
- The CHECKs and the partial unique index are present.

### For deployment-engineer before 0054 reaches production (read-only)

Count production's org-owned `member` roles and `organization_settings` rows. The calendar's reach there depends on F133.

### Suggestions (non-binding)

- **S1.** An ESLint `no-restricted-syntax` rule banning local `Date` getters and setters (`getHours`, `getDate`, `getMonth`, `getFullYear`, `getDay`, `set*`) in the three wall-clock paths from R10, so the R3 fix can't quietly regress.
- **S2.** Give the `members` tile `orgFeatureKey: "org_portal.members_create"`. Today it shows when the org toggle is off and leads to the "turned off" page. TODO item, not this pipeline.
- **S3.** A pairwise OKLCH hue-distance test across the 8 categorical tints, reusing `generate.ts`'s conversion, so the palette stays distinguishable as well as legible.
- **S4.** Later: have `isOrgFeatureEnabled` read the catalog's `flag` itself, so call sites stop re-implementing the gate order.
- **S5.** Separate follow-up: the admin `[eventId]` page should 404 on a non-UUID id instead of showing "couldn't load" (G7).

## Proposed decision entries (architect-owned, pre-assigned; the orchestrator records them in `docs/decisions.md` at integration)

**DECISION-160 — The member calendar is a toggle-only org feature: an `ORG_FEATURE_CATALOG` entry with `flag: null`, ON by default for existing and new orgs as explicit rows. The tile registry gains an org-feature gate in a new `visible-tiles.ts`. The read gate is `events.view OR events.manage`. A feature's member read surface goes in the operate tiles and its authoring surface on the admin hub. `organization_settings.time_zone` is the zone in which "now" is read, never a conversion of stored times, and the events writer stores wall-clock digits regardless of the server's time zone.**

**Status:** Resolved · **Date:** 2026-10-14 · **Feature:** `2026-10-14-member-calendar` (Phase 2)

Per operator ruling 2, the calendar has no platform flag. `isOrgFeatureEnabled()` never read a per-key flag (call sites did), so a toggle-only key needs no resolver change. The missing axis is made explicit instead: every catalog entry carries a required `flag: string | null` and a `provisionedOn` boolean. `org_portal.calendar` is `flag: null`, category `worship`, `provisionedOn: true`.

The default is ON, stored as rows: migration 0054 backfills an enabled row for every org, and `createOrganization()` inserts one in its transaction. That keeps DECISION-097's "missing row = off" unconditional, so a code constant can never silently flip every org that has no row. What is given up: there is no platform-wide kill switch. Rollback is per org or a revert, which the operator accepted ("we are not live yet").

DECISION-115 ruling 4 is amended. A `PortalTile` carries `flagKey`, `orgFeatureKey`, or both (enforced by `tsc`). `visiblePortalTiles` moves to `src/lib/org-portal/visible-tiles.ts`, because importing `org-features` into `tiles.ts` closes a module-load cycle through `org-feature-categories.ts`'s top-level `DOMAIN_ORDER` read (F135). It takes the viewer's ids, and it hides a tile rather than throwing when the toggle read fails. The org toggle is not a permission, so tiles still never check permissions.

DECISION-113 ruling 7 is reversed for events only, by a general rule: a feature's member read surface goes in the operate section and its authoring surface on the admin hub. The new `calendar` tile is operate; the `events` tile becomes "Manage events", administer. The member read gate is `events.view OR events.manage`. It exposes nothing the admin list doesn't already show to `events.manage`, and it is implemented as two `presby_has_permission` calls, not as an implication in the resolver.

`organization_settings.time_zone`:

- `text not null default 'America/New_York'`.
- A CHECK on IANA shape plus Postgres recognition. `timezone(text, timestamp)` is IMMUTABLE. The shape clause is needed because Postgres accepts POSIX `UTC+5`.
- The reader falls back to the default (F132). The migration and provisioning also write a default settings row.

The column is the zone in which "now" is read and never converts a stored `starts_at`. DECISION-113 ruling 3 (wall-clock storage) stands, with its stated reason superseded.

`Intl.DateTimeFormat` with an explicit `en-US` locale, an explicit `timeZone` and `hourCycle: "h23"` is permitted for numeric `formatToParts` only, and only in `src/lib/shared/org-time.ts`. It is a different API from the banned `toLocale*`.

Finally, the events wall-clock writer and the recurrence math switch to `Date` objects used only through their UTC fields. Drizzle writes `toISOString()` and reads with `+0000` appended, so stored digits were correct only on a server running UTC (F134). This ships as a separate `fix(events):` commit with a regression test under `TZ=America/New_York`. No dependency is added.

(2026-10-14, adopted at Phase 2; `docs/work-log/2026-10-14-member-calendar.md`.)

---

**DECISION-161 — `event_types` is a per-org, tag-shaped taxonomy (D8-compatible; `group_types` stays global). `events.event_type_id` is a composite FK with NO ACTION, not SET NULL or RESTRICT. Types are never hard-deleted (no DELETE grant). Non-congregation orgs are seeded with the fallback only. The type palette is a platform-classified `categorical` token family with its own `CATEGORY_PAIRS`, outside the brand role vocabulary. Event-type mutations are not audited.**

**Status:** Resolved · **Date:** 2026-10-14 · **Feature:** `2026-10-14-member-calendar` (Phase 2)

D8 keeps custom fields out because a field nobody designed has no validation, reporting or sensitivity tier. Event types add no field. They are an org's own values for one platform-designed, tier-1 attribute, with a closed palette and a closed icon set. That is the same shape as `tags`, which `docs/schema-design.md` already names for "event targeting". This is not a precedent for org-owned `group_types`, which DECISION-110/151 keep global because the derived-group machinery keys on them.

Table shape, declared in `src/lib/db/domain/events.ts` above `events`:

- `unique (id, organization_id)`;
- a case-insensitive name index unique per org, covering retired rows too;
- a partial unique index allowing one fallback per org;
- `CHECK (not is_fallback or is_active)`;
- CHECK-constrained closed palette and icon lists;
- `updated_by` / `updated_at` for attribution;
- FORCE RLS with the standard tenant policy;
- `select, insert, update` granted, and no DELETE.

"At least one fallback" is `paper`. The calendar must render correctly with zero types.

`events.(event_type_id, organization_id)` references `event_types (id, organization_id)` with the default NO ACTION:

- `SET NULL` would null the NOT NULL `organization_id`. The PG15+ column-list form exists, but it describes a delete path that doesn't exist.
- `RESTRICT` checks immediately and can fail the `deletable_until` fixture cascade, which deletes `events` and `event_types` in the same statement.

Seeding: a pure `eventTypeSeedPlan(organizationType)` sits beside `groupSeedPlan`. Congregations and new worshiping communities get the standard set; presbytery, synod and GA orgs get the neutral "General" fallback only. The 0054 backfill mirrors the plan idempotently, and nothing creates types lazily on a read.

The palette is 8 categorical keys plus `neutral`, as `--category-<key>` and `--category-<key>-foreground`. They are `platform` policy with a `categorical: true` marker; no fourth policy class is added. The emitter's policy-derived filter makes them impossible for a brand to re-declare. They are kept out of `BRAND_ROLES`, `ROLE_TO_TOKEN` and `LEGAL_PAIRS`, because those drive the per-seed generator and the site-kit agent's tone vocabulary. A separate `CATEGORY_PAIRS` asserts, in both colour schemes, ink on tint ≥ 7:1 and ink on `--background` / `--card` ≥ 3:1. The CSS lives in `globals.css` with `@theme inline` mappings, and classes come from a static lookup map. `check:brand-scope` is unchanged; its grep is not what enforces this.

Event-type mutations extend DECISION-113 ruling 5: they are content configuration, are not audited, and supersede the kickoff's audit line. The per-org toggle flip stays audited.

(2026-10-14, adopted at Phase 2; `docs/work-log/2026-10-14-member-calendar.md`.)

## Proposed findings (F132–F135, for the orchestrator's findings record at integration)

- **F132.** `organization_settings` is not one row per org. On the pipeline branch, 13 of 15 orgs have no row, so a `NOT NULL DEFAULT` column there is missing, not defaulted, for most orgs.
  - Fix: the reader falls back to the default (that is the contract), plus a migration backfill and a provisioning insert.
  - The backfill is behaviour-neutral for 2FA (`presby_two_factor_required()` inner-joins, and a default row has `require_two_factor = false`).
- **F133.** Granting `events.view` to "every org's `member` role" reaches only orgs that have one: 2 of 15 on the branch, both congregations, and there is no template role.
  - Orgs created before DECISION-100's provisioning seed, or by fixture SQL, have neither `directory.view` nor `events.view` for ordinary members, and will see the calendar's "not available to your account" state.
  - This gap existed before this pipeline; the pipeline exposes it. Track it; don't fix it here.
- **F134.** The `events` wall-clock writer depends on the server's time zone (G6, confirmed against `drizzle-orm/pg-core/columns/timestamp.js:30-36`).
  - Rows written from a non-UTC process store shifted digits, and weekly series crossing DST drift by an hour.
  - Vercel runs UTC, which hides this; it shows up as soon as a text reader such as the calendar exists.
  - Fixed in this pipeline (R3).
- **F135.** Adding an org-toggle gate to the tile registry *inside* `tiles.ts` would close the import cycle `tiles → org-features → org-feature-categories → tiles`.
  - `org-feature-categories.ts` reads `DOMAIN_ORDER` at module top level, so the cycle crashes at import.
  - Separately, `isOrgFeatureEnabled` throws on a DB error, where the nav and footer's flag reads fail closed.
  - Resolved by `src/lib/org-portal/visible-tiles.ts` with a catch-and-hide (R1).

## Handoff

Next agent: **tech-lead** (Phase 3). The design doc must cover: R1–R12 as binding; the exact token values and measured ratios for `CATEGORY_PAIRS`; the standard type set and the icon list; whether `neutral` is reserved for the fallback; the `PortalTile` gate union type; the order of the `fix(events):` commit relative to the feature commits; the test-rls and seed-dev drafts for integration. The R2 time-helper module paths (`src/lib/shared/org-time.ts`, `src/lib/org-settings.ts`) are passed to `2026-10-14-portal-home-alignment`, which consumes them.


---

# Phase 3 — Technical Design (tech-lead)

*Written directly into this work-log by the tech-lead, 2026-10-14. R1–R12 of the Phase 2 review are binding and are designed to as written; two small placement amendments (A1, A2) and no escalation are recorded below. Every migration, seed and test-rls block in this section was **executed** before being written down (see "Verified against the live tree"); the code blocks marked "verified" were compiled, linted and/or run in a scratch copy of this worktree.*

## Summary

Build the member calendar and event types as six implementation commits (numbered 1–6 below), then an integration commit, in an order that keeps `tsc` green at every step:

1. **`fix(events):`** (F134) — the events writer and the recurrence math stop depending on the server's time zone. Lands first; independent of everything else.
2. **`feat(brand):`** — the nine-key categorical colour family (`--category-<key>` / `-foreground`), `CATEGORY_PAIRS`, and the closed palette/icon module `src/lib/events/type-palette.ts`.
3. **`feat(schema):`** — `drizzle/0054_presby_calendar_event_types.sql`: `event_types`, `events.event_type_id` (composite FK, NO ACTION), `organization_settings.time_zone`, the two permissions, and the four idempotent backfills. Drizzle mirrors, `eventTypeSeedPlan`, dev-docs invariant.
4. **`feat(calendar):` data layer** — `org-time`, `org-settings`, the catalog fields, `calendar/*`, `calendar.ts` (including the cross-pipeline `listUpcomingMemberEvents`), `event-types.ts`, the `events.ts` type plumbing, provisioning.
5. **`feat(portal):`** — the `PortalTile` gate union, `visible-tiles.ts`, the `calendar` tile, the relabelled `events` tile, and the four callers.
6. **`feat(calendar):` UI** — `/o/<slug>/calendar`, `/o/<slug>/calendar/[eventId]`, `/o/<slug>/admin/events/types`, the picker on both event forms, e2e.
7. Integration (orchestrator): the Rule-16 drafts in "Drafts for integration".

Plus the already-uncommitted **`style(site):`** "Our Portal" commit, which goes first so the working tree is clean.

Three facts shape everything else. (a) A member read path for events does not exist; `events.view` is granted to every org-owned baseline `member` role by migration, which reaches only orgs that have one (F133). (b) The calendar has **no platform flag**: its only on/off switch is the per-org toggle `org_portal.calendar`, stored ON as explicit rows (DECISION-160). (c) "Today" is read in `organization_settings.time_zone`, never in the server's zone, and stored event times are never converted (DECISION-160).

## Verified against the live tree

The feasibility check the tech-lead owns was done by running things, not by reading. Evidence, all reproducible from the files in this section:

- **The migration, in a rolled-back transaction on the pipeline's own Neon branch** (15 orgs: 9 congregations, 5 presbyteries, 1 synod). It applied cleanly, **replayed cleanly** (idempotent), and produced 81 + 5 + 1 = **87** `event_types` rows (9 per congregation, 5 of them active; 1 fallback each elsewhere), **15** settings rows, **15** calendar toggle rows, **2** `events.view` bindings (the branch's 2 `member` roles). `events_event_type_fk` reads `confdeltype = 'a'`; `presby_app`/`presby_platform` hold SELECT/INSERT/UPDATE and no DELETE; FORCE RLS and the `tenant_isolation` policy are present. Thirteen negative checks passed (neutral reserved both ways, inactive fallback, palette, icon list, untrimmed/empty/61-char name, case-insensitive duplicate, POSIX `UTC+5`, bare `EST`, unknown zone, a cross-org `event_type_id`). Rolled back; nothing persisted.
- **A from-empty rehearsal in a scratch database** (`tl_cal_dryrun`, created on the pipeline branch and dropped at the end of this session): all 54 existing migrations + `0054` applied with `psql` in order (90 tables); `scripts/seed.ts`; `scripts/seed-dev.sql` with the appended block below spliced before its final `commit;`; `install-test-helpers.sql`; then **`scripts/test-rls.sql` as `presby_app` — the whole file plus the new section 45, exit 0, 678 passes, 0 failures.** Run **unpatched**, the existing suite fails at section 19 (`alder: sees its own toggle row — expected 1, got 2`) — which is why the three assertion edits in D3 are required, not optional.
- **`npm run check:schema-parity` against that scratch database with the Drizzle mirrors below applied to a copy of the tree: 68 domain tables compared, 0 failing.** `tsc --noEmit` on the same copy: clean.
- **The brand contract with the new tokens**: `contract.test.ts`, `brand-tokens.test.tsx`, `generate.test.ts` and the rest of `src/lib/brand` + `src/components/brand`: **769 passed** with the 18 new tokens, their values in `PLATFORM_TOKENS`, the `globals.css` transcription, and the new `CATEGORY_PAIRS` / hue-distance tests.
- **The F134 regression test fails before the fix and passes after it**: with the old local-getter codec, 5 of 9 cases fail under `TZ=America/New_York` and `TZ=Pacific/Honolulu` (and pass under UTC, which is exactly why Vercel hid the bug); with the fix, 9 of 9 pass under all three. Runtime flipping of `process.env.TZ` works under this repo's Vitest (the precedent is `src/lib/format-date.test.ts`).
- **The S1 ESLint block**: flags a local getter, a local setter and a multi-argument `new Date(...)` in a probe file, passes the fixed `recurrence.ts`/`wall-clock.ts`, and leaves test files alone.
- **One side effect to disclose**: creating and dropping `tl_cal_dryrun` is the only write made outside this work-log file. It touched the pipeline Neon branch only.

## Permissions & Flags

- **`FEATURES` keys: none.** `src/lib/permissions.ts` is frozen and platform-only. Both new permissions are rows in the `permissions` catalog, checked with `presby_has_permission` (DECISION-063 precedent), exactly like `events.manage`.
  - **`events.view`** — tier 1, read-only. Seeded by `0054`; bound to **every org-owned baseline `member` role** by the same migration (`where r.key = 'member' and r.organization_id is not null`, `on conflict do nothing`, operator ruling 3); `baselineRoleSeedPlan` grants it at provisioning. Not bound to any template role (a template is cloned, not granted).
  - **`event_types.manage`** — tier 1, **no default binding anywhere** (mirrors fpcw-directory). Inert until a stated clerk grants it. `scripts/seed-dev.sql` grants it to `stated_clerk` as a test-reachability convenience only.
  - `events.manage` keeps every write. The calendar's read gate is `events.view OR events.manage` (R8), implemented as one SQL statement that calls `presby_has_permission` twice. The resolver is unchanged.
- **Flags: no new platform flag** (operator ruling 2). `org_portal.events` is unchanged and gates the admin surface — the events list, the new/edit forms, **and the event-type manager and picker**. The member calendar and its detail page are gated by the **per-org toggle `org_portal.calendar`** (category `worship`), composed as DECISION-160 rules: category axis → org toggle → permission. The types manager is **not** gated by the calendar toggle: types feed the admin forms whether or not the calendar is on.
- **Per-org toggle default: ON, as explicit rows** — `0054` inserts `(org, 'org_portal.calendar', true, null)` for every existing org, `createOrganization()` inserts one in its transaction for every catalog entry with `provisionedOn: true`. An org created any other way (a fixture, a hand-run `insert`) has no row and the calendar reads **disabled** for it. That is DECISION-097's "missing row = off", left unconditional on purpose.
- **Audit: none.** Event-type mutations are not audited (R7 / DECISION-161). Attribution is `updated_by` / `updated_at`. The org admin flipping the calendar toggle is still audited (`ORG_FEATURE_TOGGLED`, unchanged).
- **Rollback** is per org (`/o/<slug>/admin/features`, one `update`, or a deploy revert). There is no platform-wide kill switch; the operator accepted that.

## Rulings carried, amendments, and escalation

R1–R12 are designed to as written. The choices Phase 2 left to Phase 3 are decided in the sections that follow: `neutral` is **reserved for the fallback, in both directions, by CHECK** (Data Model); the palette values and measured ratios (Data Model); the `PortalTile` union and `visible-tiles.ts` signature (API Contract); the fix-commit order (Implementation Order); the "listed until its day ends" policy and the three contract clarifications (API Contract → cross-pipeline).

**Amendments (neither is a deviation from a ruling's intent; both are recorded so the decision log stays honest):**

- **A1 — `eventTypeSeedPlan` lives in a pure module, re-exported from `org-provisioning.ts`.** R4 says "in `org-provisioning.ts`, next to `groupSeedPlan`". But the types manager's "Add the standard event types" action (analyst G10) needs the same plan from `src/lib/event-types.ts`, and `org-provisioning.ts` is a `server-only` module that holds `getPlatformDb()` — importing it into the tenant read/write path drags the platform connection into a module the `(org)` actions import. So the plan is `src/lib/events/type-seed-plan.ts` (pure, no DB), and `org-provisioning.ts` imports it and **re-exports** `eventTypeSeedPlan` so the DECISION-100 adjacency (grep for the plan next to `groupSeedPlan`) still holds. R4's content is unchanged.
- **A2 — the NO ACTION cascade proof moves out of `test-rls.sql`.** The architect listed "fixture-org delete still cascades when an org has a typed event" for `test-rls.sql`. That suite runs as `presby_app`, which holds **SELECT only on `organizations`** and cannot create or delete one. The *catalog* fact (`confdeltype = 'a'`) is asserted in section 45 (e); the *behaviour* is proven on the owner connection in `src/lib/event-types.test.ts` (it deletes a `deletableUntil` fixture org that owns typed events and asserts the cascade succeeds), and every other DB-backed suite's `afterAll` now exercises it incidentally once a fixture creates a typed event.

**Escalation to Phase 2: none.** Nothing in R1–R12 is unbuildable. Two things the architect should know were *confirmed* rather than changed: (1) `ORG_FEATURE_CATALOG` adding `flag`/`provisionedOn` needs no resolver change, but I factored `isOrgFeatureEnabled`'s body into an exported `orgFeatureEnabledInTx()` so `calendar.ts` can compose the toggle inside its own single transaction, as the home contract requires — behaviour-identical, and the existing DB-backed `org-features.test.ts` suite is the proof; (2) `isOrgFeatureEnabled` is `cache()`d, so the new tile gate costs one extra short transaction per portal request, not three.

## Data Model

### The migration — `drizzle/0054_presby_calendar_event_types.sql`

Commit exactly this (**executed** on the pipeline branch in a rolled-back transaction and from-empty in a scratch database; see above). The block between the two `backfill-event-types` marker comments is re-executed by `src/lib/event-types.test.ts`, so do not reformat the markers.

```sql
-- drizzle/0054_presby_calendar_event_types.sql
--
-- Member calendar with event types (docs/work-log/2026-10-14-member-calendar.md,
-- Phase 3 / DECISION-160 / DECISION-161; findings F132, F133, F135).
--
-- Eight things, in dependency order. The whole file is idempotent: every
-- statement is `if not exists`, `on conflict do nothing`, drop-then-add, or
-- guarded by `where not exists`, so it replays cleanly (including as an
-- in-place correction while this migration is unreleased, CLAUDE.md ->
-- Project Layout -> drizzle/).
--
--   1. event_types            the per-org taxonomy (D8-compatible, tag-shaped)
--   2. events.event_type_id   composite FK, NO ACTION (DECISION-161)
--   3. organization_settings.time_zone   the zone in which "now" is read
--   4. settings-row backfill  (F132: 13 of 15 dev orgs had no row)
--   5. permission catalog     events.view, event_types.manage (DECISION-063)
--   6. events.view backfill   every org-owned `member` role (operator ruling 3)
--   7. calendar toggle rows   ON for every existing org (DECISION-160)
--   8. event_types backfill   mirrors eventTypeSeedPlan() per organization type
--
-- Hand-written per CLAUDE.md: db:generate is broken on a pre-existing
-- snapshot collision (docs/TODO.md), so every migration past 0012 is
-- hand-authored.
--
-- WHAT THIS FILE DOES NOT DO, ON PURPOSE:
--   * It writes no audit row. A migration backfill is provisioning, like every
--     other provisioning seed (DECISION-161, R7).
--   * It does not touch the six columns DECISION-113 froze on `events`.
--   * It does not convert any stored `starts_at`. `time_zone` is the zone in
--     which NOW is read, never a conversion of event times (DECISION-160).
--   * It cannot reach an org that has no `member` role (F133) or any org
--     created after this file runs; createOrganization() covers the latter.
--
-- scripts/seed-dev.sql runs AFTER migrations on a fresh database (CI), when no
-- organization exists yet, so every backfill below is a no-op there and the
-- seed file carries a mirror block. Keep the two in step.

-- ---------------------------------------------------------------------------
-- 1. event_types
-- ---------------------------------------------------------------------------
create table if not exists event_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  color text not null,
  icon text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  -- Exactly one per org (partial unique index below). The type an untyped
  -- event renders and filters as. "At least one" cannot be a constraint, so it
  -- is `paper` in /developer; the calendar must render with zero types.
  is_fallback boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id),
  -- Composite Tenant Keys (F2): the target of events_event_type_fk.
  constraint event_types_id_org_key unique (id, organization_id)
);

-- CHECKs are drop-then-add (the drizzle/0048 idiom), not inline, so an
-- in-place correction of an unreleased migration actually changes them.
alter table event_types drop constraint if exists event_types_name_shape;
alter table event_types add constraint event_types_name_shape
  check (name = btrim(name) and char_length(name) between 1 and 60);

-- The closed palette: the nine keys of CATEGORY_KEYS in
-- src/lib/brand/contract.ts. Widening it takes a migration AND a contract
-- change; src/lib/events/type-palette.test.ts pins this list to the
-- TypeScript one by reading this very line.
alter table event_types drop constraint if exists event_types_color_allowed;
alter table event_types add constraint event_types_color_allowed
  check (color in ('rose','orange','amber','lime','teal','sky','violet','fuchsia','neutral'));

-- The closed icon list: EVENT_TYPE_ICONS in src/lib/events/type-palette.ts,
-- every name verified present in the installed lucide-react (1.16.0).
alter table event_types drop constraint if exists event_types_icon_allowed;
alter table event_types add constraint event_types_icon_allowed
  check (icon in ('Church','Sparkles','Music','BookOpen','Backpack','Utensils','HeartHandshake','Gavel','CalendarDays','HandHeart','HandHelping','Users','Coffee','Baby','Mic'));

alter table event_types drop constraint if exists event_types_fallback_active;
alter table event_types add constraint event_types_fallback_active
  check (not is_fallback or is_active);

-- `neutral` is RESERVED for the fallback, in both directions: the fallback is
-- always neutral and nothing else may be, so "uncategorized" never consumes
-- one of the eight categorical colors (fpcw-directory's rule, made a CHECK).
alter table event_types drop constraint if exists event_types_neutral_is_fallback;
alter table event_types add constraint event_types_neutral_is_fallback
  check ((color = 'neutral') = is_fallback);

-- Names are unique per org case-insensitively, and the index covers RETIRED
-- rows too: a retired "Worship" keeps its name reserved, so reactivating it
-- can never produce a second "Worship".
create unique index if not exists event_types_org_lower_name_idx
  on event_types (organization_id, lower(name));

create unique index if not exists event_types_one_fallback_idx
  on event_types (organization_id) where is_fallback;

alter table event_types enable row level security;
alter table event_types force row level security;

drop policy if exists tenant_isolation on event_types;
create policy tenant_isolation on event_types
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

-- No DELETE, for either connection: a type is retired, never removed. FK
-- cascades from organizations run as the table owner and need no grant. The
-- explicit revoke makes an in-place re-apply correct a database where a
-- delete grant was ever added by hand.
grant select, insert, update on event_types to presby_app, presby_platform;
revoke delete on event_types from presby_app, presby_platform;

comment on table event_types is
  'Per-org event taxonomy (DECISION-161): an org''s own values for one platform-designed, tier-1 attribute of an event, with a closed palette (CATEGORY_KEYS) and closed icon list - the tags shape D8 already permits, not a custom field. Never hard-deleted (no DELETE grant): retire with is_active = false. Exactly one is_fallback row per org by partial unique index; "at least one" is paper (the calendar renders correctly with zero rows). neutral is reserved for the fallback by CHECK.';
comment on column event_types.is_fallback is
  'The type an untyped event renders and filters as. At most one per org (event_types_one_fallback_idx); must be active; must be neutral and nothing else may be (event_types_neutral_is_fallback).';

-- ---------------------------------------------------------------------------
-- 2. events.event_type_id
-- ---------------------------------------------------------------------------
-- Nullable: an untyped event is legal and renders as the fallback type.
-- Composite FK per Composite Tenant Keys (F2), default NO ACTION - NOT
-- `on delete set null` (which would null the NOT NULL organization_id half of
-- the key) and NOT RESTRICT (checked immediately, so it can fail the
-- deletable_until fixture cascade that removes events and event_types in one
-- statement). Nothing deletes an event_type; NO ACTION defers the check to the
-- end of the statement and the cascade passes. MATCH SIMPLE: a NULL
-- event_type_id is never checked.
alter table events add column if not exists event_type_id uuid;

alter table events drop constraint if exists events_event_type_fk;
alter table events add constraint events_event_type_fk
  foreign key (event_type_id, organization_id) references event_types (id, organization_id);

create index if not exists events_org_type_idx on events (organization_id, event_type_id);

comment on column events.event_type_id is
  'Optional event type (DECISION-161). NULL = untyped, rendered and filtered as the org''s is_fallback type. Composite FK (event_type_id, organization_id), NO ACTION.';

-- ---------------------------------------------------------------------------
-- 3. organization_settings.time_zone
-- ---------------------------------------------------------------------------
-- The zone in which "now" is read: today's highlight, the default month, the
-- Today link, and the home card's "upcoming" test. NEVER used to convert a
-- stored starts_at (those are wall-clock - DECISION-113 ruling 3).
alter table organization_settings
  add column if not exists time_zone text not null default 'America/New_York';

-- Two clauses, and the first is not optional: Postgres accepts POSIX strings
-- ('UTC+5', with the sign inverted) and bare abbreviations ('EST') that
-- Intl.DateTimeFormat reads differently or refuses. The second clause makes
-- Postgres refuse a name its own tzdata does not know (timezone(text,
-- timestamp) is IMMUTABLE on PG 18, so it is legal in a CHECK). AND does not
-- promise evaluation order, so an unknown name may surface as 22023
-- invalid_parameter_value rather than 23514 check_violation; both mean "no".
alter table organization_settings drop constraint if exists organization_settings_time_zone_valid;
alter table organization_settings add constraint organization_settings_time_zone_valid
  check (
    time_zone ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$'
    and (timestamp '2000-01-01' at time zone time_zone) is not null
  );

comment on column organization_settings.time_zone is
  'IANA zone in which "now" is read for this org (today, the default calendar month, "upcoming"). Never converts a stored event time. Default America/New_York (US-only scope, D6); set by a platform admin in v1, no org-admin UI. A missing settings row means the default (F132) - the reader falls back, the contract does not depend on the row existing.';

-- ---------------------------------------------------------------------------
-- 4. A default settings row for every organization (F132)
-- ---------------------------------------------------------------------------
-- 13 of the 15 organizations on the pipeline branch had NO row, so the column
-- default above is "missing", not "defaulted", for most orgs. The reader falls
-- back to the default regardless (that is the contract); this backfill and
-- createOrganization()'s insert make the common case a real row. Behaviour-
-- neutral for 2FA: presby_two_factor_required() inner-joins this table, and a
-- default row has require_two_factor = false, exactly what no row meant.
insert into organization_settings (organization_id)
select o.id from organizations o
on conflict (organization_id) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Permission catalog rows (DECISION-063: permissions carry no org)
-- ---------------------------------------------------------------------------
-- events.view: tier 1, read-only - the member-facing read path the events
-- module never had (every read required events.manage). event_types.manage:
-- tier 1, deliberately NO default binding (mirrors fpcw-directory; the
-- feature is inert until a stated clerk grants it; an unmanaged taxonomy is
-- how two real church calendars reached 16 and 25 categories). Neither is
-- Rule-7 audited (DECISION-113 ruling 5 extended by DECISION-161).
insert into permissions (key, module, description, sensitivity_tier)
values
  ('events.view', 'events',
   'View the member calendar and the details of upcoming events', 1),
  ('event_types.manage', 'events',
   'Create, rename, recolor, reorder and retire the event types that color-code the calendar', 1)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 6. events.view on every org-owned baseline `member` role (operator ruling 3)
-- ---------------------------------------------------------------------------
-- A permission nobody holds is a dead tile: there is no "all members" arm in
-- the resolver. `member` is the baseline role createOrganization() seeds with
-- directory.view (DECISION-100). Org-owned rows only - a template role
-- (organization_id is null) would be cloned, not granted. Tier 1, read-only,
-- the same class as directory.view. Reaches only orgs that HAVE a member role
-- (F133: 2 of 15 on the pipeline branch); the rest see the calendar's
-- "not available to your account" state until a stated clerk grants it.
insert into app_role_permissions (role_id, permission_key)
select r.id, 'events.view'
  from app_roles r
 where r.key = 'member' and r.organization_id is not null
on conflict (role_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 7. org_portal.calendar toggle rows, ON for every existing organization
-- ---------------------------------------------------------------------------
-- DECISION-160: the calendar has no platform flag; the per-org toggle is its
-- only on/off switch. Stored as explicit rows (not a code default) so
-- DECISION-097's "missing row = off" stays unconditional. updated_by is null
-- (a provisioning write, no acting user) - the column is nullable for this.
insert into organization_feature_toggles (organization_id, feature_key, enabled, updated_by)
select o.id, 'org_portal.calendar', true, null
  from organizations o
on conflict (organization_id, feature_key) do nothing;

-- ---------------------------------------------------------------------------
-- 8. event_types backfill, mirroring eventTypeSeedPlan(organizationType)
-- ---------------------------------------------------------------------------
-- Congregations and new worshiping communities get the standard set (fpcw's
-- nine: five active including the neutral "General" fallback). Presbytery,
-- synod and general_assembly get the fallback ONLY - nobody there holds
-- event_types.manage to remove congregation-flavoured active types.
-- Guarded per org by `not exists`, so it never resurrects a type an org
-- removed or undoes a rename on replay. src/lib/events/type-seed-plan.ts is
-- the TypeScript twin; src/lib/events/type-palette.test.ts pins the VALUES
-- below to it, and src/lib/event-types.test.ts RE-EXECUTES the block between
-- the markers against fixture orgs of every type.
-- BEGIN backfill-event-types
insert into event_types (organization_id, name, color, icon, sort_order, is_active, is_fallback)
select o.id, v.name, v.color, v.icon, v.sort_order, v.is_active, v.is_fallback
  from organizations o
  join (values
    ('Worship',                       'teal',    'Church',         10, true,  false),
    ('Special Services and Holidays', 'violet',  'Sparkles',       20, false, false),
    ('Music',                         'fuchsia', 'Music',          30, false, false),
    ('Classes and Bible Study',       'sky',     'BookOpen',       40, true,  false),
    ('Youth and Children',            'lime',    'Backpack',       50, true,  false),
    ('Meals and Fellowship',          'amber',   'Utensils',       60, false, false),
    ('Mission and Outreach',          'rose',    'HeartHandshake', 70, false, false),
    ('Committees',                    'orange',  'Gavel',          80, true,  false),
    ('General',                       'neutral', 'CalendarDays',   99, true,  true)
  ) as v(name, color, icon, sort_order, is_active, is_fallback)
    on (v.is_fallback
        or o.organization_type in ('congregation', 'new_worshiping_community'))
 where not exists (select 1 from event_types et where et.organization_id = o.id)
on conflict do nothing;
-- END backfill-event-types
```

**Decisions inside it, for the record:**

- **`neutral` is reserved for the fallback in both directions** by one CHECK, `event_types_neutral_is_fallback: (color = 'neutral') = is_fallback`. The fallback is always neutral; nothing else may be. Consequence the UI must honour: the fallback's colour control is read-only ("Neutral"), and "General" cannot be re-coloured.
- CHECKs are **drop-then-add** after the `create table`, not inline, so an in-place correction of this unreleased migration actually changes them (the `0048` idiom). The color and icon CHECK lines are single-line on purpose: `type-palette.test.ts` reads them.
- **No extra sort index.** `(organization_id, lower(name))` and `unique (id, organization_id)` both lead with `organization_id`; an org has tens of rows.
- `time_zone` has **no default-row requirement on the reader** (F132): the settings backfill and `createOrganization()` make the common case a real row, but `orgTimeZoneInTx` falls back regardless.
- An unknown zone name may surface as SQLSTATE `22023` (`invalid_parameter_value`) rather than `23514` because `AND` has no evaluation order — **observed on PG 18 in the dry run**. Any future writer must treat both as "refused".
- Nothing here touches the six `DECISION-113` frozen columns, converts a stored time, writes an audit row, or reaches an org without a `member` role (F133).

### Drizzle mirrors (verified: `tsc` clean, `check:schema-parity` 0 failing)

`src/lib/db/domain/events.ts` — add the imports, `sqlList`, the `eventTypes` table **above** `events`, `events.eventTypeId`, the index and the composite FK. The diff, exactly:

```diff
--- a/src/lib/db/domain/events.ts
+++ b/src/lib/db/domain/events.ts
@@ -1,3 +1,4 @@
+import { sql } from "drizzle-orm";
 import {
   pgTable,
   text,
@@ -7,12 +8,95 @@
   timestamp,
   index,
   unique,
+  uniqueIndex,
+  check,
   foreignKey,
 } from "drizzle-orm/pg-core";
 import { organizations } from "./org";
 import { users } from "../schema";
+// A zero-runtime-import palette module (it imports only the brand contract),
+// so the domain file's CHECK lists and the app's picker read ONE TypeScript
+// source. drizzle/0054 holds the third copy; type-palette.test.ts pins it.
+import { EVENT_TYPE_COLORS, EVENT_TYPE_ICONS } from "../../events/type-palette";
 
+const sqlList = (values: readonly string[]) =>
+  sql.raw(values.map((value) => `'${value}'`).join(","));
+
 /**
+ * Per-org event taxonomy (DECISION-161) - drizzle/0054_presby_calendar_event_types.sql.
+ *
+ * An org's own values for ONE platform-designed, tier-1 attribute of an event,
+ * with a closed palette and a closed icon list: the `tags` shape D8 already
+ * permits, NOT a custom field, and NOT a precedent for org-owned `group_types`
+ * (DECISION-110/151 keep those global). Declared above `events` because it is
+ * the FK target.
+ *
+ * Most of the enforcement is in the DDL and only partly expressible here;
+ * stated so a reader does not mistake absence for permission:
+ *   - ENABLE + FORCE ROW LEVEL SECURITY and the standard tenant_isolation
+ *     policy (F1).
+ *   - presby_app and presby_platform hold SELECT, INSERT, UPDATE and NO DELETE:
+ *     a type is retired (is_active = false), never removed. FK cascades from
+ *     organizations run as the owner and need no grant.
+ *   - `is_fallback`: at most one per org (partial unique index), always active,
+ *     always `neutral`, and nothing else may be `neutral`
+ *     (event_types_neutral_is_fallback). "At least one" cannot be a constraint,
+ *     so it is paper: the calendar must render correctly with zero rows.
+ */
+export const eventTypes = pgTable(
+  "event_types",
+  {
+    id: uuid("id").defaultRandom().primaryKey(),
+    organizationId: uuid("organization_id")
+      .notNull()
+      .references(() => organizations.id, { onDelete: "cascade" }),
+    name: text("name").notNull(),
+    color: text("color").notNull(),
+    icon: text("icon").notNull(),
+    sortOrder: integer("sort_order").notNull().default(0),
+    isActive: boolean("is_active").notNull().default(true),
+    isFallback: boolean("is_fallback").notNull().default(false),
+    createdAt: timestamp("created_at", { withTimezone: true })
+      .notNull()
+      .defaultNow(),
+    updatedAt: timestamp("updated_at", { withTimezone: true })
+      .notNull()
+      .defaultNow()
+      .$onUpdate(() => new Date()),
+    updatedBy: uuid("updated_by").references(() => users.id),
+  },
+  (t) => [
+    // Composite Tenant Keys (F2): the target of events_event_type_fk.
+    unique("event_types_id_org_key").on(t.id, t.organizationId),
+    // Case-insensitive, and covers RETIRED rows (a retired name stays reserved).
+    uniqueIndex("event_types_org_lower_name_idx").on(
+      t.organizationId,
+      sql`lower(${t.name})`,
+    ),
+    uniqueIndex("event_types_one_fallback_idx")
+      .on(t.organizationId)
+      .where(sql`${t.isFallback}`),
+    check(
+      "event_types_name_shape",
+      sql`${t.name} = btrim(${t.name}) and char_length(${t.name}) between 1 and 60`,
+    ),
+    check(
+      "event_types_color_allowed",
+      sql`${t.color} in (${sqlList(EVENT_TYPE_COLORS)})`,
+    ),
+    check(
+      "event_types_icon_allowed",
+      sql`${t.icon} in (${sqlList(EVENT_TYPE_ICONS)})`,
+    ),
+    check("event_types_fallback_active", sql`not ${t.isFallback} or ${t.isActive}`),
+    check(
+      "event_types_neutral_is_fallback",
+      sql`(${t.color} = 'neutral') = ${t.isFallback}`,
+    ),
+  ],
+);
+
+/**
  * Calendar events. See docs/work-log/2026-08-26-events-model.md (Phase 3) and
  * DECISION-113/115.
  *
@@ -71,6 +155,13 @@
     // constraint itself is enforced by
     // drizzle/0048_presby_security_b.sql's `events_parent_fk`.
     parentEventId: uuid("parent_event_id"),
+    // Optional type (DECISION-161). NULL = untyped: rendered and filtered as
+    // the org's is_fallback type. Composite FK below, NO ACTION - NOT set null
+    // (it would null the NOT NULL organization_id half of the key) and NOT
+    // restrict (an immediate check can fail the fixture-org cascade that
+    // removes events and event_types in one statement). Not one of the six
+    // frozen DECISION-113 columns.
+    eventTypeId: uuid("event_type_id"),
     // Convenience generation string only (e.g. "weekly", "2nd Tuesday") —
     // NEVER parsed at read time (DECISION-113 ruling 1). Set ONLY on a
     // series' first (parent) row; null on every generated child and on every
@@ -97,6 +188,13 @@
     // list, extendSeriesPattern's latest-occurrence lookup).
     index("events_org_parent_idx").on(t.organizationId, t.parentEventId),
     unique("events_id_org_key").on(t.id, t.organizationId),
+    // Serves "events of this type" and the calendar's type filter.
+    index("events_org_type_idx").on(t.organizationId, t.eventTypeId),
+    foreignKey({
+      columns: [t.eventTypeId, t.organizationId],
+      foreignColumns: [eventTypes.id, eventTypes.organizationId],
+      name: "events_event_type_fk",
+    }),
     // Composite Tenant Keys (F2 / B-M3). A child occurrence may only point at
     // a parent in ITS OWN org. No new index: events_org_parent_idx above
     // already leads with the same pair. DDL: drizzle/0048 section 7.
```

`src/lib/db/domain/org.ts` — `organizationSettings` gains `timeZone` and a table-config callback with the CHECK. The new definition in full (the existing columns are unchanged apart from re-indentation, because the options object becomes the first argument of a three-argument `pgTable`):

```ts
export const organizationSettings = pgTable(
  "organization_settings",
  {
    organizationId: uuid("organization_id")
      .primaryKey()
      .references(() => organizations.id, { onDelete: "cascade" }),
    // `pcusaPin` moved to `organizationIdentifiers` (kind = 'pcusa_pin') in
    // drizzle/0043 — D24. It could not stay here: this table IS tenant-
    // isolated, so the presbytery running an import could not read a
    // congregation's own OGA church PIN, the identifier a cross-council
    // importer needs most.
    // Includes sessionServesAsTrustees, hasDeacons, trackDisabilityPerPerson.
    settings: jsonb("settings").notNull().default({}),
    // Per-congregation 2FA policy. NOT a feature flag: a flag is an environment
    // toggle, this is tenant state (DECISION-003). A typed column rather than a
    // key in `settings` above, because it is read on the sign-in path and a
    // boolean deciding whether 2FA is enforced belongs to the database, not to
    // whatever last wrote the blob.
    //
    // Resolved at sign-in by presby_two_factor_required() and projected into the
    // session — the Edge gate reads the claim and cannot reach the database.
    // Default false, so every existing congregation keeps today's behavior.
    requireTwoFactor: boolean("require_two_factor").notNull().default(false),
    // The IANA zone in which "now" is read for this org: today's highlight, the
    // default calendar month, the Today link, the home card's "upcoming" test
    // (DECISION-160). NEVER used to convert a stored `events.starts_at` — those
    // are wall-clock (DECISION-113 ruling 3). Default America/New_York (US-only,
    // D6); set by a platform admin in v1, no org-admin UI. Most orgs have no
    // settings row at all (F132), so the READER falls back to the default; the
    // row (drizzle/0054 backfill, createOrganization()) is a convenience, not
    // the contract.
    timeZone: text("time_zone").notNull().default("America/New_York"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Two clauses (drizzle/0054): the shape clause rejects POSIX strings and
    // bare abbreviations Postgres would accept and Intl would not; the second
    // makes Postgres refuse a name its own tzdata does not know.
    check(
      "organization_settings_time_zone_valid",
      sql`${t.timeZone} ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$' and (timestamp '2000-01-01' at time zone ${t.timeZone}) is not null`,
    ),
  ],
);
```

`src/lib/db/domain/index.ts` needs **no edit** (it already `export *`s `events.ts`; `eventTypes` is declared there on purpose — Rule 16).

### Journal entry (orchestrator applies at integration)

Append to `drizzle/meta/_journal.json`'s `entries` after idx 53 (the `when` follows the file's +30000 pattern):

```json
    {
      "idx": 54,
      "version": "7",
      "when": 1787014223186,
      "tag": "0054_presby_calendar_event_types",
      "breakpoints": true
    }
```

Until then implementers apply the file to the pipeline branch with `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0054_presby_calendar_event_types.sql` (the dev database is hand-migrated; `db:migrate` would try to re-run 0010). It is idempotent, so re-applying after an in-place correction is safe.

### The standard type set

Congregations and new worshiping communities get all nine; presbytery, synod and general_assembly get **only** the fallback (nobody there holds `event_types.manage` to remove congregation-flavoured active types). Names are plain on purpose (analyst G10): "General", not fpcw's "Church Life".

| sort | Name | color | icon | active | fallback |
|---|---|---|---|---|---|
| 10 | Worship | teal | Church | yes | no |
| 20 | Special Services and Holidays | violet | Sparkles | no | no |
| 30 | Music | fuchsia | Music | no | no |
| 40 | Classes and Bible Study | sky | BookOpen | yes | no |
| 50 | Youth and Children | lime | Backpack | yes | no |
| 60 | Meals and Fellowship | amber | Utensils | no | no |
| 70 | Mission and Outreach | rose | HeartHandshake | no | no |
| 80 | Committees | orange | Gavel | yes | no |
| 99 | General | neutral | CalendarDays | yes | **yes** |

Every one of the eight categorical keys is used exactly once; five types are active including the fallback. `type-seed-plan.ts` is the TypeScript twin and `type-palette.test.ts` pins the migration's `VALUES` tuples to it.

### The closed lists

- **Palette (9):** `rose, orange, amber, lime, teal, sky, violet, fuchsia, neutral` (= `CATEGORY_KEYS`). Selectable by an admin: the first eight.
- **Icons (15)** — every name verified present in the installed lucide-react 1.16.0: `Church, Sparkles, Music, BookOpen, Backpack, Utensils, HeartHandshake, Gavel, CalendarDays, HandHeart, HandHelping, Users, Coffee, Baby, Mic`. Display labels (for the manager's pickers): Church, Sparkles, Music, Open book, Backpack, Meal, Service, Meeting, Calendar, Care, Helping hand, People, Coffee, Nursery, Microphone.

### The palette — exact values and measured contrast

Hex, not OKLCH, because `parseColor` in `contrast.ts` reads `hsl()` and `#rrggbb` only. Tints and inks were derived in OKLCH (hues 20/55/90/130/185/240/290/340, ≥34° apart) and quantised to 8-bit; every ratio below is computed on the **final hex** with the repo's own `contrastRatio`. Floors, from `CATEGORY_PAIRS`: **ink on tint ≥ 7:1** (`body` — entry text is `text-sm`), **ink on `--background` ≥ 3:1** and **ink on `--card` ≥ 3:1** (`non-text` — swatch, icon, rule). That is 9 keys × 3 pairs × 2 schemes = 54 measurements; the weakest body pair is **7.51** (rose, dark) and the weakest non-text pair is **8.48** (teal, light).

**Light** — `--background` `hsl(0 0% 100%)`, `--card` `hsl(0 0% 100%)`

| key | tint `--category-<key>` | ink `--category-<key>-foreground` | ink on tint (≥7) | ink on background (≥3) | ink on card (≥3) | ink hue |
|---|---|---|---|---|---|---|
| rose | `#ffebea` | `#852e33` | 7.52 | 8.62 | 8.62 | 20° |
| orange | `#ffece0` | `#793b00` | 7.52 | 8.61 | 8.61 | 54° |
| amber | `#faf0d2` | `#5e4900` | 7.60 | 8.65 | 8.65 | 90° |
| lime | `#e7f6da` | `#365500` | 7.57 | 8.55 | 8.55 | 130° |
| teal | `#d3f9f4` | `#00574f` | 7.52 | 8.48 | 8.48 | 184° |
| sky | `#e2f3ff` | `#00517a` | 7.53 | 8.54 | 8.54 | 240° |
| violet | `#efeeff` | `#4f3f8a` | 7.61 | 8.71 | 8.71 | 290° |
| fuchsia | `#ffe9f7` | `#793064` | 7.54 | 8.68 | 8.68 | 340° |
| neutral | `#eef0f3` | `#494c51` | 7.55 | 8.62 | 8.62 | 261° |

**Dark** — `--background` `hsl(215 71% 8%)`, `--card` `hsl(215 67% 12%)`

| key | tint | ink | ink on tint (≥7) | ink on background (≥3) | ink on card (≥3) | ink hue |
|---|---|---|---|---|---|---|
| rose | `#442323` | `#ffa7a7` | 7.51 | 10.14 | 9.31 | 20° |
| orange | `#412714` | `#faaf7c` | 7.53 | 10.27 | 9.44 | 55° |
| amber | `#382c0c` | `#dcbe69` | 7.57 | 10.38 | 9.54 | 90° |
| lime | `#253317` | `#a8ce81` | 7.55 | 10.56 | 9.70 | 130° |
| teal | `#053631` | `#5ed6c8` | 7.56 | 10.66 | 9.80 | 185° |
| sky | `#133144` | `#7ecaff` | 7.60 | 10.53 | 9.68 | 240° |
| violet | `#2d2945` | `#c0b6ff` | 7.51 | 10.17 | 9.34 | 290° |
| fuchsia | `#3e2336` | `#f3a6d9` | 7.52 | 10.07 | 9.25 | 340° |
| neutral | `#2b2e33` | `#bdc1c7` | 7.54 | 10.39 | 9.54 | 258° |

**S3 (adopted):** the minimum pairwise OKLCH hue distance among the eight categorical inks is **34.1°** (rose/orange, light) and **35.2°** (dark); the test floor is 30°. The tint alone is deliberately faint against the page (1.13–1.15:1 light, 1.34–1.41:1 dark) — a tint is never the signal. Every entry carries an icon, a name, and a 4px ink-coloured rule (≥8.4:1), and prints legibly in black and white.

### The brand contract and stylesheet (verified)

`src/lib/brand/contract.ts` — add `categorical?: true` to `TokenEntry`; `CATEGORY_KEYS`/`CategoryKey` and the two `why` constants before `TOKEN_POLICY`; the 18 `TOKEN_POLICY` entries; the 18 `PLATFORM_TOKENS` entries per scheme; `CategoryPair` and `CATEGORY_PAIRS` after `LegalTone`. **Not** added to `BRAND_ROLES`, `ROLE_TO_TOKEN` or `LEGAL_PAIRS`. The diff, exactly:

```diff
--- a/src/lib/brand/contract.ts
+++ b/src/lib/brand/contract.ts
@@ -75,12 +75,47 @@
   readonly reserved?: true;
   /** Not a colour, so it carries no palette value and no contrast pair. */
   readonly nonColour?: true;
+  /**
+   * A categorical (event-type) colour: platform-fixed like every `platform`
+   * token, but a member of the CATEGORY_KEYS family whose pairs live in
+   * CATEGORY_PAIRS, not LEGAL_PAIRS (DECISION-161). A marker, not a fourth
+   * policy class - the partition stays three-way.
+   */
+  readonly categorical?: true;
   /** The constraint slice b's generator must implement, for `bounded` only. */
   readonly bound?: string;
   /** One sentence, quotable in a review. */
   readonly why: string;
 };
 
+/**
+ * The closed categorical palette (DECISION-161): eight hues plus `neutral`,
+ * which is RESERVED for an organization's fallback event type. Each key has
+ * two tokens - `--category-<key>` (the tint surface) and
+ * `--category-<key>-foreground` (the "ink": label text, icon, swatch, rule).
+ * The family is named `category`, not `event`, because it is a platform
+ * vocabulary other things (tags) may adopt; no token name may contain
+ * "brand" (check:brand-scope rule C1).
+ */
+export const CATEGORY_KEYS = [
+  "rose",
+  "orange",
+  "amber",
+  "lime",
+  "teal",
+  "sky",
+  "violet",
+  "fuchsia",
+  "neutral",
+] as const;
+
+export type CategoryKey = (typeof CATEGORY_KEYS)[number];
+
+const CATEGORY_TINT_WHY =
+  "A categorical event-type tint: platform-fixed for every organization, so a brand colour can never recolour a category and a category never reads as a brand.";
+const CATEGORY_INK_WHY =
+  "The ink for its category tint: label text at 7:1 on the tint, and icon, swatch and rule at 3:1 on the page and card surfaces, in both schemes (CATEGORY_PAIRS).";
+
 export const TOKEN_POLICY = [
   {
     token: "--primary",
@@ -249,6 +284,24 @@
     reserved: true,
     why: "Reserved with --info, for the same reason its fill is.",
   },
+  { token: "--category-rose", policy: "platform", categorical: true, why: CATEGORY_TINT_WHY },
+  { token: "--category-rose-foreground", policy: "platform", categorical: true, why: CATEGORY_INK_WHY },
+  { token: "--category-orange", policy: "platform", categorical: true, why: CATEGORY_TINT_WHY },
+  { token: "--category-orange-foreground", policy: "platform", categorical: true, why: CATEGORY_INK_WHY },
+  { token: "--category-amber", policy: "platform", categorical: true, why: CATEGORY_TINT_WHY },
+  { token: "--category-amber-foreground", policy: "platform", categorical: true, why: CATEGORY_INK_WHY },
+  { token: "--category-lime", policy: "platform", categorical: true, why: CATEGORY_TINT_WHY },
+  { token: "--category-lime-foreground", policy: "platform", categorical: true, why: CATEGORY_INK_WHY },
+  { token: "--category-teal", policy: "platform", categorical: true, why: CATEGORY_TINT_WHY },
+  { token: "--category-teal-foreground", policy: "platform", categorical: true, why: CATEGORY_INK_WHY },
+  { token: "--category-sky", policy: "platform", categorical: true, why: CATEGORY_TINT_WHY },
+  { token: "--category-sky-foreground", policy: "platform", categorical: true, why: CATEGORY_INK_WHY },
+  { token: "--category-violet", policy: "platform", categorical: true, why: CATEGORY_TINT_WHY },
+  { token: "--category-violet-foreground", policy: "platform", categorical: true, why: CATEGORY_INK_WHY },
+  { token: "--category-fuchsia", policy: "platform", categorical: true, why: CATEGORY_TINT_WHY },
+  { token: "--category-fuchsia-foreground", policy: "platform", categorical: true, why: CATEGORY_INK_WHY },
+  { token: "--category-neutral", policy: "platform", categorical: true, why: CATEGORY_TINT_WHY },
+  { token: "--category-neutral-foreground", policy: "platform", categorical: true, why: CATEGORY_INK_WHY },
 ] as const satisfies readonly TokenEntry[];
 
 /** Every custom property the contract knows about. Derived, never restated. */
@@ -438,6 +491,36 @@
 export type LegalTone = LegalPair["bg"];
 
 /* -------------------------------------------------------------------------
+ * Category pairs (DECISION-161)
+ *
+ * Deliberately NOT in BRAND_ROLES, ROLE_TO_TOKEN or LEGAL_PAIRS: generate.ts
+ * iterates BRAND_ROLES for every seed, LEGAL_PAIRS is the site-kit agent's
+ * instruction payload, and LegalTone types the public-site blocks. A category
+ * colour is none of those things, so it gets its own token-name-based list
+ * with the same `min`/`kind` shape. contract.test.ts iterates this array and
+ * asserts, from the `categorical` marker, that every key has its full set.
+ * ---------------------------------------------------------------------- */
+
+export type CategoryPair = {
+  readonly fg: `--category-${CategoryKey}-foreground`;
+  readonly bg: `--category-${CategoryKey}` | "--background" | "--card";
+  /** The WCAG contrast floor for THIS pair. */
+  readonly min: number;
+  readonly kind: "body" | "non-text";
+};
+
+export const CATEGORY_PAIRS: readonly CategoryPair[] = CATEGORY_KEYS.flatMap(
+  (key): CategoryPair[] => [
+    // Entry text is `text-sm` on member pages, so the AAA floor applies (D1).
+    { fg: `--category-${key}-foreground`, bg: `--category-${key}`, min: 7, kind: "body" },
+    // Swatch, icon and left rule are non-text UI: 3:1 on both surfaces.
+    { fg: `--category-${key}-foreground`, bg: "--background", min: 3, kind: "non-text" },
+    { fg: `--category-${key}-foreground`, bg: "--card", min: 3, kind: "non-text" },
+  ],
+);
+
+
+/* -------------------------------------------------------------------------
  * Emission
  * ---------------------------------------------------------------------- */
 
@@ -703,6 +786,24 @@
     "--border": "hsl(215 20% 83%)",
     "--input": "hsl(217 16% 56%)",
     "--ring": "hsl(213 73% 38%)",
+    "--category-rose": "#ffebea",
+    "--category-rose-foreground": "#852e33",
+    "--category-orange": "#ffece0",
+    "--category-orange-foreground": "#793b00",
+    "--category-amber": "#faf0d2",
+    "--category-amber-foreground": "#5e4900",
+    "--category-lime": "#e7f6da",
+    "--category-lime-foreground": "#365500",
+    "--category-teal": "#d3f9f4",
+    "--category-teal-foreground": "#00574f",
+    "--category-sky": "#e2f3ff",
+    "--category-sky-foreground": "#00517a",
+    "--category-violet": "#efeeff",
+    "--category-violet-foreground": "#4f3f8a",
+    "--category-fuchsia": "#ffe9f7",
+    "--category-fuchsia-foreground": "#793064",
+    "--category-neutral": "#eef0f3",
+    "--category-neutral-foreground": "#494c51",
   },
   dark: {
     "--background": "hsl(215 71% 8%)",
@@ -726,5 +827,23 @@
     "--border": "hsl(213 59% 22%)",
     "--input": "hsl(217 16% 44%)",
     "--ring": "hsl(214 70% 68%)",
+    "--category-rose": "#442323",
+    "--category-rose-foreground": "#ffa7a7",
+    "--category-orange": "#412714",
+    "--category-orange-foreground": "#faaf7c",
+    "--category-amber": "#382c0c",
+    "--category-amber-foreground": "#dcbe69",
+    "--category-lime": "#253317",
+    "--category-lime-foreground": "#a8ce81",
+    "--category-teal": "#053631",
+    "--category-teal-foreground": "#5ed6c8",
+    "--category-sky": "#133144",
+    "--category-sky-foreground": "#7ecaff",
+    "--category-violet": "#2d2945",
+    "--category-violet-foreground": "#c0b6ff",
+    "--category-fuchsia": "#3e2336",
+    "--category-fuchsia-foreground": "#f3a6d9",
+    "--category-neutral": "#2b2e33",
+    "--category-neutral-foreground": "#bdc1c7",
   },
 } as const satisfies Record<Scheme, Record<PlatformTokenName, string>>;
```

`src/app/globals.css` — 18 declarations in `:root`, 18 in `.dark`, 18 `--color-category-*` mappings in `@theme inline`. The diff, exactly:

```diff
--- a/src/app/globals.css
+++ b/src/app/globals.css
@@ -91,6 +91,28 @@
      That is D4 made structural instead of dependent on a lucky value — see
      FOCUS_RING_OFFSET_PX in src/lib/brand/contract.ts. */
   --ring: hsl(213 73% 38%);
+
+  /* Event-type categories (DECISION-161): tint + ink per key, platform-fixed.
+     CATEGORY_PAIRS in contract.ts proves ink on tint >= 7:1 and ink on
+     --background / --card >= 3:1 in both schemes. */
+  --category-rose: #ffebea;
+  --category-rose-foreground: #852e33;
+  --category-orange: #ffece0;
+  --category-orange-foreground: #793b00;
+  --category-amber: #faf0d2;
+  --category-amber-foreground: #5e4900;
+  --category-lime: #e7f6da;
+  --category-lime-foreground: #365500;
+  --category-teal: #d3f9f4;
+  --category-teal-foreground: #00574f;
+  --category-sky: #e2f3ff;
+  --category-sky-foreground: #00517a;
+  --category-violet: #efeeff;
+  --category-violet-foreground: #4f3f8a;
+  --category-fuchsia: #ffe9f7;
+  --category-fuchsia-foreground: #793064;
+  --category-neutral: #eef0f3;
+  --category-neutral-foreground: #494c51;
 }
 
 .dark {
@@ -131,6 +153,28 @@
   --border: hsl(213 59% 22%);
   --input: hsl(217 16% 44%); /* 3.47:1 on background (D3) */
   --ring: hsl(214 70% 68%); /* = --primary; 7.54:1 on surface, offset per the light block */
+
+  /* Event-type categories (DECISION-161): tint + ink per key, platform-fixed.
+     CATEGORY_PAIRS in contract.ts proves ink on tint >= 7:1 and ink on
+     --background / --card >= 3:1 in both schemes. */
+  --category-rose: #442323;
+  --category-rose-foreground: #ffa7a7;
+  --category-orange: #412714;
+  --category-orange-foreground: #faaf7c;
+  --category-amber: #382c0c;
+  --category-amber-foreground: #dcbe69;
+  --category-lime: #253317;
+  --category-lime-foreground: #a8ce81;
+  --category-teal: #053631;
+  --category-teal-foreground: #5ed6c8;
+  --category-sky: #133144;
+  --category-sky-foreground: #7ecaff;
+  --category-violet: #2d2945;
+  --category-violet-foreground: #c0b6ff;
+  --category-fuchsia: #3e2336;
+  --category-fuchsia-foreground: #f3a6d9;
+  --category-neutral: #2b2e33;
+  --category-neutral-foreground: #bdc1c7;
 }
 
 @theme inline {
@@ -162,6 +206,25 @@
   --color-input: var(--input);
   --color-ring: var(--ring);
 
+  --color-category-rose: var(--category-rose);
+  --color-category-rose-foreground: var(--category-rose-foreground);
+  --color-category-orange: var(--category-orange);
+  --color-category-orange-foreground: var(--category-orange-foreground);
+  --color-category-amber: var(--category-amber);
+  --color-category-amber-foreground: var(--category-amber-foreground);
+  --color-category-lime: var(--category-lime);
+  --color-category-lime-foreground: var(--category-lime-foreground);
+  --color-category-teal: var(--category-teal);
+  --color-category-teal-foreground: var(--category-teal-foreground);
+  --color-category-sky: var(--category-sky);
+  --color-category-sky-foreground: var(--category-sky-foreground);
+  --color-category-violet: var(--category-violet);
+  --color-category-violet-foreground: var(--category-violet-foreground);
+  --color-category-fuchsia: var(--category-fuchsia);
+  --color-category-fuchsia-foreground: var(--category-fuchsia-foreground);
+  --color-category-neutral: var(--category-neutral);
+  --color-category-neutral-foreground: var(--category-neutral-foreground);
+
   /*
    * Tailwind v4 defaults (node_modules/tailwindcss/theme.css): --radius-sm
    * 0.125rem, --radius-md 0.25rem, --radius-lg 0.5rem, --radius-xl 0.75rem —
```

Consequences that need no code: `<BrandTokens>`'s `REDECLARABLE_TOKENS` is derived from `TOKEN_POLICY` and excludes every `platform` token, so a brand **cannot** re-declare a category; `PLATFORM_COLOR_TOKENS` picks them up, so `light_only` orgs get the light values in dark mode; `check:brand-scope` is unchanged (no token name contains "brand").

### `src/lib/events/type-palette.ts` (new, pure, client-safe — verified)

```ts
/**
 * The closed palette and icon vocabulary for event types (DECISION-161).
 *
 * PURE AND CLIENT-SAFE: the only import is the zero-runtime-import brand
 * contract, so this file can be read by a client component (the picker, the
 * manager's colour grid), by the Drizzle domain file (which builds its CHECK
 * lists from the arrays below), and by a vitest run with no database. The
 * `event_types_color_allowed` / `event_types_icon_allowed` CHECKs in
 * drizzle/0054 are a THIRD copy of these two lists; type-palette.test.ts reads
 * the migration and fails if any of the three drift.
 */
import { CATEGORY_KEYS, type CategoryKey } from "../brand/contract";

/** The nine palette keys - exactly CATEGORY_KEYS; `neutral` is the fallback's. */
export const EVENT_TYPE_COLORS = CATEGORY_KEYS;
export type EventTypeColor = CategoryKey;

/** What an admin may pick for a NEW or RE-COLOURED type. Neutral is reserved. */
export const SELECTABLE_EVENT_TYPE_COLORS = EVENT_TYPE_COLORS.filter(
  (color): color is Exclude<EventTypeColor, "neutral"> => color !== "neutral",
);

/**
 * Lucide icon names, every one verified present in the installed lucide-react
 * (1.16.0). Closed on purpose: a misspelled name fails `tsc` in the static
 * import map (event-type-icon.tsx), never at render time. Icon COMPONENTS never
 * cross the server->client boundary - pass the key.
 */
export const EVENT_TYPE_ICONS = [
  "Church",
  "Sparkles",
  "Music",
  "BookOpen",
  "Backpack",
  "Utensils",
  "HeartHandshake",
  "Gavel",
  "CalendarDays",
  "HandHeart",
  "HandHelping",
  "Users",
  "Coffee",
  "Baby",
  "Mic",
] as const;
export type EventTypeIcon = (typeof EVENT_TYPE_ICONS)[number];

export const DEFAULT_EVENT_TYPE_ICON: EventTypeIcon = "CalendarDays";

/** Plain-language labels for the manager's pickers (no jargon, ui-standards). */
export const EVENT_TYPE_COLOR_LABELS: Record<EventTypeColor, string> = {
  rose: "Rose",
  orange: "Orange",
  amber: "Amber",
  lime: "Lime",
  teal: "Teal",
  sky: "Sky blue",
  violet: "Violet",
  fuchsia: "Fuchsia",
  neutral: "Neutral",
};

export const EVENT_TYPE_ICON_LABELS: Record<EventTypeIcon, string> = {
  Church: "Church",
  Sparkles: "Sparkles",
  Music: "Music",
  BookOpen: "Open book",
  Backpack: "Backpack",
  Utensils: "Meal",
  HeartHandshake: "Service",
  Gavel: "Meeting",
  CalendarDays: "Calendar",
  HandHeart: "Care",
  HandHelping: "Helping hand",
  Users: "People",
  Coffee: "Coffee",
  Baby: "Nursery",
  Mic: "Microphone",
};

export interface TypeColorClasses {
  /** Tint surface + ink text: an entry chip or a pill. */
  readonly chip: string;
  /** Ink as text/icon colour only. */
  readonly ink: string;
  /** Ink as the left rule of an entry. */
  readonly rule: string;
  /** Ink as an all-sides border (a pill). */
  readonly border: string;
  /** Ink as a solid fill (a swatch). */
  readonly swatch: string;
}

/**
 * STATIC class lookup. Tailwind finds class names by scanning source for
 * literal strings, so these are written out in full - never built by
 * interpolating the key (`bg-category-${key}` would generate nothing).
 */
export const TYPE_COLOR_CLASSES: Record<EventTypeColor, TypeColorClasses> = {
  rose: { chip: "bg-category-rose text-category-rose-foreground", ink: "text-category-rose-foreground", rule: "border-l-category-rose-foreground", border: "border-category-rose-foreground", swatch: "bg-category-rose-foreground" },
  orange: { chip: "bg-category-orange text-category-orange-foreground", ink: "text-category-orange-foreground", rule: "border-l-category-orange-foreground", border: "border-category-orange-foreground", swatch: "bg-category-orange-foreground" },
  amber: { chip: "bg-category-amber text-category-amber-foreground", ink: "text-category-amber-foreground", rule: "border-l-category-amber-foreground", border: "border-category-amber-foreground", swatch: "bg-category-amber-foreground" },
  lime: { chip: "bg-category-lime text-category-lime-foreground", ink: "text-category-lime-foreground", rule: "border-l-category-lime-foreground", border: "border-category-lime-foreground", swatch: "bg-category-lime-foreground" },
  teal: { chip: "bg-category-teal text-category-teal-foreground", ink: "text-category-teal-foreground", rule: "border-l-category-teal-foreground", border: "border-category-teal-foreground", swatch: "bg-category-teal-foreground" },
  sky: { chip: "bg-category-sky text-category-sky-foreground", ink: "text-category-sky-foreground", rule: "border-l-category-sky-foreground", border: "border-category-sky-foreground", swatch: "bg-category-sky-foreground" },
  violet: { chip: "bg-category-violet text-category-violet-foreground", ink: "text-category-violet-foreground", rule: "border-l-category-violet-foreground", border: "border-category-violet-foreground", swatch: "bg-category-violet-foreground" },
  fuchsia: { chip: "bg-category-fuchsia text-category-fuchsia-foreground", ink: "text-category-fuchsia-foreground", rule: "border-l-category-fuchsia-foreground", border: "border-category-fuchsia-foreground", swatch: "bg-category-fuchsia-foreground" },
  neutral: { chip: "bg-category-neutral text-category-neutral-foreground", ink: "text-category-neutral-foreground", rule: "border-l-category-neutral-foreground", border: "border-category-neutral-foreground", swatch: "bg-category-neutral-foreground" },
};

export function isEventTypeColor(value: unknown): value is EventTypeColor {
  return typeof value === "string" && (EVENT_TYPE_COLORS as readonly string[]).includes(value);
}

export function isEventTypeIcon(value: unknown): value is EventTypeIcon {
  return typeof value === "string" && (EVENT_TYPE_ICONS as readonly string[]).includes(value);
}

/** Unknown or missing -> neutral, so a bad stored value degrades, never throws. */
export function typeColorClasses(token: string | null | undefined): TypeColorClasses {
  return isEventTypeColor(token) ? TYPE_COLOR_CLASSES[token] : TYPE_COLOR_CLASSES.neutral;
}
```

## API Contract

There are no `/api` routes. The surfaces are three Server-Component pages, six Server Actions, and the library functions beneath them. Every library function opens exactly one `withOrgContext()` transaction, checks its gate **first** inside it, and returns a typed result instead of throwing for an expected outcome (the `events.ts` / `groups.ts` shape).

### `src/lib/shared/org-time.ts` (new — pure, no `server-only`, the only file besides `format-date.ts` allowed to touch `Intl`)

```ts
export const DEFAULT_ORG_TIME_ZONE = "America/New_York";

/** Same shape rule as the DB CHECK (^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$) AND Intl accepts it. */
export function isValidTimeZone(value: unknown): value is string;

export interface OrgClock {
  /** 'YYYY-MM-DD' in the org's zone. */
  dayKey: string;
  year: number; month: number /* 1-12 */; day: number;
  hour: number /* 0-23 */; minute: number; second: number;
}

/** The org-local wall clock at `now`. Throws RangeError for an invalid zone — callers hold only values that passed isValidTimeZone. */
export function wallClockNow(now: Date, timeZone: string): OrgClock;

/** wallClockNow(now, timeZone).dayKey — the one helper the calendar, the home card and (later) the greeting consume. */
export function todayInOrgZone(now: Date, timeZone: string): string;
```

Implementation rules (verified under `TZ=UTC`, `America/New_York`, `Pacific/Honolulu`): `new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now)`, numeric parts only, one cached formatter per zone in a module-level `Map`. `hourCycle: "h23"` is what stops midnight formatting as `24`. Fixtures that must hold: `2026-11-01T03:30:00Z` in New York is **2026-10-31 23:30**; `2026-11-01T04:30:00Z` is **2026-11-01 00:30**; `2026-11-01T09:59:00Z` in Honolulu is **2026-10-31 23:59**; `2026-01-01T04:59:59Z` in New York is **2025-12-31 23:59**; `2026-01-01T05:00:00Z` is **2026-01-01 00:00**. `isValidTimeZone`: `"UTC+5"` false, `"EST"` false, `"Nope/Zone"` false, `""`/`null`/`42` false, `"Etc/GMT+5"` true, `"America/Argentina/Buenos_Aires"` true, `"America/New_York"` true.

### `src/lib/org-settings.ts` (new — `server-only`)

```ts
import type { OrgTx } from "@/lib/authz";
/** The org's IANA zone. Missing settings row -> DEFAULT_ORG_TIME_ZONE (F132: this fallback IS the contract).
 *  A stored value Node's ICU rejects -> the default, plus console.error with the organization id only. */
export async function orgTimeZoneInTx(tx: OrgTx, organizationId: string): Promise<string>;
```
Raw `tx.execute(sql\`select time_zone from organization_settings where organization_id = ${organizationId}::uuid\`)` so a unit test can stub `tx.execute` with `{ rows: [...] }`. No permission check — org membership (already proven by the caller's `withOrgContext`) is the gate.

### `src/lib/org-features.ts` (modified)

`ORG_FEATURE_CATALOG` entries gain two required fields; a third entry is added:

```ts
{ key: "org_portal.members_create",  /* …existing… */ category: "people" as const,
  flag: "org_portal.members_create" as const,  provisionedOn: false as const },
{ key: "org_portal.sensitive_info",  /* …existing… */ category: "people" as const,
  flag: "org_portal.sensitive_info" as const,  provisionedOn: false as const },
{ key: "org_portal.calendar",
  name: "Member calendar",
  description: "Shows the calendar of this organization's events to every member who has calendar access, with event types, colors and filters.",
  category: "worship" as const,
  flag: null,                 // toggle-only: no platform flag (DECISION-160)
  provisionedOn: true as const },
```

New exports, and `isOrgFeatureEnabled` rewritten to call them (behaviour-identical):

```ts
/** The category-axis kill switch, read ONCE, outside any transaction (isFlagEnabled has its own connection). */
export function isCategoryAxisOn(): Promise<boolean>;
/** category (when the axis is on) -> toggle row. Missing toggle row -> false (DECISION-097, unconditional). */
export async function orgFeatureEnabledInTx(
  tx: OrgTx, organizationId: string, key: string, categoryAxisOn: boolean,
): Promise<boolean>;
```

**How call sites compose a gate** (the rule R1 asks to be explicit): `entry.flag === null || await isFlagEnabled(entry.flag)`, then the toggle, then the permission. `isOrgFeatureEnabled` itself still reads only the category-axis flag, so the three existing `admin/members/**` call sites, which already do `isFlagEnabled(KEY)` first, need no change. `listFeatureToggles` needs none either: a missing row reads `enabled: false`, the backfilled rows read `true`.

### `src/lib/events/type-seed-plan.ts` (new — pure)  — amendment A1

```ts
import type { EventTypeColor, EventTypeIcon } from "./type-palette";
import type { OrganizationType } from "@/lib/authz"; // type-only

export interface EventTypeSeed {
  name: string; color: EventTypeColor; icon: EventTypeIcon;
  sortOrder: number; isActive: boolean; isFallback: boolean;
}
export const FALLBACK_EVENT_TYPE: EventTypeSeed; // { name: "General", color: "neutral", icon: "CalendarDays", sortOrder: 99, isActive: true, isFallback: true }
export const STANDARD_EVENT_TYPES: readonly EventTypeSeed[]; // the nine rows of the table above, General last
/** congregation | new_worshiping_community -> STANDARD_EVENT_TYPES; presbytery | synod | general_assembly -> [FALLBACK_EVENT_TYPE]. */
export function eventTypeSeedPlan(organizationType: OrganizationType): readonly EventTypeSeed[];
```

`src/lib/org-provisioning.ts` (modified): `import { eventTypeSeedPlan } from "@/lib/events/type-seed-plan"` and `export { eventTypeSeedPlan }`; `baselineRoleSeedPlan` changes from `permissionKey: string` to **`permissionKeys: readonly string[]`** = `["directory.view", "events.view"]` and the insert loop inserts one `app_role_permissions` row per key; and inside `createOrganization()`'s existing transaction, after the role seed: (1) `tx.insert(organizationSettings).values({ organizationId: orgRow.id })`; (2) one `organization_feature_toggles` row `{ organizationId, featureKey, enabled: true, updatedBy: null }` for every `ORG_FEATURE_CATALOG` entry with `provisionedOn`; (3) `tx.insert(eventTypes).values(eventTypeSeedPlan(input.organizationType).map(...))`. All inside the one `platformDb.transaction`, so a half-provisioned org cannot exist.

### `src/lib/calendar/*` (new — pure, no `server-only`, no local `Date` getter/setter/constructor: lint-enforced by S1)

All times are the **wall-clock text** `'YYYY-MM-DDTHH:mm'` that SQL emits with `to_char`. No file here constructs a `Date` from local parts; where a `Date` is needed (day-of-week, adding days) it is `new Date(Date.UTC(...))` read through `getUTC*`.

**`month.ts`**
```ts
export const MIN_CALENDAR_YEAR = 2000;
export const MAX_CALENDAR_YEAR = 2100;
export const MONTH_NAMES: readonly string[];          // January … December (static; toLocale* is banned)
export const WEEKDAY_NAMES: readonly string[];        // Sunday … Saturday
export const WEEKDAY_ABBREVIATIONS: readonly string[];// Sun … Sat

export interface MonthRef { year: number; month: number /* 1-12 */ }
export interface GridDay { key: string /* 'YYYY-MM-DD' */; day: number; inMonth: boolean; weekday: number /* 0=Sun */ }
export interface MonthGrid {
  weeks: GridDay[][];       // 4–6 rows of 7, Sunday-first
  firstKey: string;         // first grid day
  lastKey: string;          // last grid day (inclusive)
  dayAfterLastKey: string;  // the HALF-OPEN upper bound handed to SQL
}

/** 'YYYY-MM' with year 2000–2100 inclusive; anything else (incl. 0000-01, 2026-13, arrays, 2026-1) -> null. NEVER new Date(y, m-1, 1). */
export function parseMonthParam(raw: string | string[] | undefined): MonthRef | null; // arrays: first element
export function monthKey(ref: MonthRef): string;                 // '2026-10'
export function monthOfDayKey(dayKey: string): MonthRef;         // '2026-10-31' -> {2026,10}
export function monthLabel(ref: MonthRef): string;               // 'October 2026'
export function prevMonth(ref: MonthRef): MonthRef | null;       // null at 2000-01
export function nextMonth(ref: MonthRef): MonthRef | null;       // null at 2100-12
export function isSameMonth(a: MonthRef, b: MonthRef): boolean;
export function buildMonthGrid(ref: MonthRef): MonthGrid;
export function addDays(dayKey: string, days: number): string;   // via Date.UTC
export function isDayKey(value: string): boolean;                // /^\d{4}-\d{2}-\d{2}$/ and a real date
export function formatDayHeading(dayKey: string): string;       // 'Sunday, October 4'
export function formatShortDate(dayKey: string): string;        // 'Sun, Oct 4'  (also consumed by the home card)
export function formatLongDate(dayKey: string): string;         // 'Sunday, October 4, 2026'
```
Grid fixtures: **October 2026** → `2026-09-27` … `2026-10-31`, 5 weeks, `dayAfterLastKey` `2026-11-01`; **February 2026** → `2026-02-01` … `2026-02-28`, 4 weeks; **December 2026** → `2026-11-29` … `2027-01-02`; **January 2000** → `1999-12-26` … `2000-02-05`, **6 weeks**; **December 2100** → `2100-11-28` … `2101-01-01`.

**`wall-clock.ts`** (text -> display; not the Date codec in `src/lib/events/wall-clock.ts`)
```ts
export const WALL_CLOCK_TEXT_RE: RegExp;                 // /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
export function dayKeyOf(wallClock: string): string;     // slice(0,10); throws on a malformed string
export function minutesOfDay(wallClock: string): number;
export function formatTime(wallClock: string): string;   // '7:00 PM', '12:00 AM', '12:00 PM', '11:59 PM'
export function formatTimeCompact(wallClock: string): string; // '7p', '7:30p', '10a', '12p', '12a'  (clipboard)
/** '7:00 PM' ; same-day end -> '7:00 PM – 8:30 PM' (en dash) ; end on another day -> '7:00 PM' only (the entry sits on its start day). */
export function formatTimeRange(startsAt: string, endsAt: string | null): string;
/** Detail page: same day -> 'Sunday, October 4, 2026, 7:00 PM – 8:30 PM'; different day -> 'Sunday, October 4, 2026, 7:00 PM' + a second line 'Ends Monday, October 5, 2026, 9:00 AM' (the caller renders two lines). */
export function describeWhen(startsAt: string, endsAt: string | null): { start: string; end: string | null };
```
There is deliberately no all-day concept: an event at `00:00` renders "12:00 AM" (out of scope).

**`filters.ts`**
```ts
export type CalendarView = "month" | "list";
export const MAX_TYPES_PARAM_ENTRIES = 50;
export const MAX_TYPES_PARAM_CHARS = 2000;

export function isUuidShaped(value: string): boolean;                 // re-export of src/lib/shared/uuid.ts
export function parseViewParam(raw: string | string[] | undefined): CalendarView; // only "list" is list
/** Slice to 2,000 chars, split on commas, keep UUID-shaped tokens only (lower-cased, de-duplicated, order kept), first 50. Arrays: first element. NEVER throws. */
export function parseTypesParam(raw: string | string[] | undefined): string[];
/** Intersect with the org's ACTIVE type ids. [] means "All" and is returned when nothing valid remains OR when the valid set covers every active type. */
export function sanitizeTypeFilter(requested: readonly string[], activeTypeIds: readonly string[]): string[];
/** fpcw's pill semantics: selected = [] is All; clicking a pill from All starts a one-item list; clicking a selected pill removes it; empty OR covering every active type -> []. */
export function toggleTypeSelection(selected: readonly string[], id: string, activeTypeIds: readonly string[]): string[];
/** "Worship only" / "3 event types" / null (All). */
export function describeTypeFilter(selectedNames: readonly string[]): string | null;

export interface CalendarHrefState { month: MonthRef | null; types: readonly string[]; view: CalendarView }
/** /o/<slug>/calendar[?month=YYYY-MM][&types=a,b][&view=list]  (that parameter order; month null/types []/view "month" are omitted; no encoding needed — UUIDs are [0-9a-f-]). */
export function buildCalendarHref(slug: string, state: CalendarHrefState): string;
/** Validate a `?from=`. Accepts exactly /o/<slug>, or /o/<slug>/calendar optionally followed by ?<[A-Za-z0-9=&,_.%-]{0,300}>. Anything else (other prefix, //, backslash, fragment, non-string, longer) -> the hardcoded default. Never reflected raw. */
export function safeCalendarBackHref(slug: string, from: unknown): { href: string; label: "calendar" | "home" };
```
`src/lib/shared/uuid.ts` (new, pure): `export function isUuidShaped(value: string): boolean` = `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`. `events.ts` imports it from there.

**`clipboard.ts`**
```ts
export interface ClipboardEntry {
  dayKey: string; startsAtWallClock: string; title: string; location: string | null;
  isPublic: boolean; isCancelled?: boolean;
}
export interface MonthClipboard {
  html: string; text: string;
  /** In-month entries dropped for being non-public or cancelled. */
  leftOutCount: number;
  /** In-month entries kept. */
  includedCount: number;
}
export function buildMonthClipboard(month: MonthRef, entries: readonly ClipboardEntry[]): MonthClipboard;
/** 'Calendar copied' | 'Calendar copied (2 members-only events left out)' | '… (Worship only)' | '… (1 members-only event left out; Worship only)'. */
export function copiedMessage(leftOutCount: number, filterLabel: string | null): string;
```
Content rules (G9, all tested): the HTML is a heading (`<h2>October 2026</h2>`) and a `<table>` with inline styles and **no colour anywhere**; seven weekday header cells; adjacent-month days are bare day numbers with **no entries** (they belong to the neighbouring month's copy); per entry the compact time, title, and ` - location`; every interpolated string passes through `escapeHtml` from `src/lib/email/escape-html.ts`; the plain text is `October 2026`, a blank line, then `Sun Oct 4` / `  10a Sunday worship - Sanctuary` blocks for in-month days with entries only, separated by blank lines, ending with a single newline (an empty month is the heading plus a blank line). It carries **no** org name, address, phone, id, URL, `/o/<slug>` path, description, creator, type name or colour. Multi-day and before-grid events appear once, on their start day. Rows are dropped **here, server-side**, so a dropped row never reaches the browser.

### `src/lib/calendar.ts` (new — `server-only`) — the member read path

One private gate, one private visibility predicate, one private projection, shared by all three exports (the home pipeline's requirement). `events.view OR events.manage` is **one statement**: `select presby_has_permission(p, o, 'events.view') as can_view, presby_has_permission(p, o, 'events.manage') as can_manage`. Order inside the single `withOrgContext` transaction, always: (1) toggle via `orgFeatureEnabledInTx` (category axis flag read **before** the transaction) -> `{ kind: "disabled" }`; (2) the gate -> `{ kind: "forbidden" }`; (3) `orgTimeZoneInTx` and `todayInOrgZone`; (4) queries.

```ts
export const CALENDAR_FEATURE_KEY = "org_portal.calendar" as const;

export type MemberEventsResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "disabled" }    // the org's calendar toggle is off (or the worship category is)
  | { kind: "forbidden" };  // neither events.view nor events.manage

export interface MemberEventType { id: string; name: string; colorToken: EventTypeColor; iconKey: EventTypeIcon }

export interface CalendarEntry {
  id: string;
  title: string;
  startsAtWallClock: string;          // 'YYYY-MM-DDTHH:mm' via to_char in SQL
  endsAtWallClock: string | null;
  dayKey: string;                     // startsAtWallClock.slice(0, 10)
  location: string | null;
  isPublic: boolean;                  // read by Copy month only; never rendered
  /** Untyped events RESOLVE to the org's fallback type in SQL, so rendering and filtering cannot disagree. null only when the org has no types at all. */
  eventType: MemberEventType | null;
}

export interface MonthCalendarRequest {
  month?: MonthRef;                   // already through parseMonthParam; absent -> the org-zone current month
  requestedTypeIds: readonly string[];// already through parseTypesParam; intersected with the org's ACTIVE ids INSIDE the transaction
  now?: Date;                         // tests only
}
export interface MonthCalendarData {
  month: MonthRef;
  isCurrentMonth: boolean;
  timeZone: string;
  todayKey: string;                   // 'YYYY-MM-DD' in the org zone
  entries: CalendarEntry[];           // the whole visible grid range, type-filtered, ordered (starts_at, id)
  types: MemberEventType[];           // ACTIVE types, fallback LAST — the pills
  activeTypeIds: string[];            // sanitized filter; [] = All
  inMonthCount: number;               // entries whose dayKey is in `month`, after the filter
  unfilteredInMonthCount: number;     // same without the filter (distinguishes "filters hide everything" from "empty month")
  orgHasEvents: boolean;              // any non-cancelled event at all (only queried when unfilteredInMonthCount === 0)
  canManage: boolean;                 // events.manage — the page adds the org_portal.events flag check itself
}
export async function getMonthCalendar(
  viewerPersonId: string, organizationId: string, req: MonthCalendarRequest,
): Promise<MemberEventsResult<MonthCalendarData>>;

export interface MemberEventDetail {
  id: string; title: string; description: string | null; location: string | null;
  startsAtWallClock: string; endsAtWallClock: string | null;
  eventType: MemberEventType | null;
  isSeriesOccurrence: boolean;        // parent_event_id is not null OR recurrence_pattern is not null
}
/** ok with event: null == "no such event for you" (missing, other org, CANCELLED, or a non-UUID id) — the page answers all four with the same notFound(). The gate runs first, so existence is never revealed to someone without access. */
export async function getMemberEvent(
  viewerPersonId: string, organizationId: string, eventId: string,
): Promise<MemberEventsResult<{ event: MemberEventDetail | null; canManage: boolean }>>;

export interface UpcomingMemberEvent { /* exactly the home pipeline's shape — see below */ }
export async function listUpcomingMemberEvents(
  viewerPersonId: string, organizationId: string, opts: { limit: number; now?: Date },
): Promise<MemberEventsResult<UpcomingMemberEvent[]>>;
```
`getMemberEvent` and `listUpcomingMemberEvents` never select an admin-only column (`allows_checkin`, `created_by`, `recurrence_count`, `recurrence_pattern`, `parent_event_id` as such, `created_at`, `updated_at`): the projection is an explicit column list, and the detail test asserts the returned object's exact key set.

The shared SQL fragments (verified against the pipeline branch — see "Verified"), written once at module scope as `sql` fragments and interpolated into each query:

```sql
-- MEMBER_FROM: untyped events resolve to the fallback row, typed events to their own
from events e
left join event_types fb on fb.organization_id = e.organization_id and fb.is_fallback
left join event_types t  on t.id = coalesce(e.event_type_id, fb.id) and t.organization_id = e.organization_id
-- MEMBER_VISIBLE: operator ruling 4 — cancelled events are hidden; is_public is NOT a member filter
e.cancelled_at is null
-- text times, never a Date (check:sql-date, wall-clock invariant)
to_char(e.starts_at, 'YYYY-MM-DD"T"HH24:MI') as starts_at_wc,  to_char(e.ends_at, 'YYYY-MM-DD"T"HH24:MI') as ends_at_wc
```

Month query bounds are **half-open on bound text**: `e.starts_at >= ${grid.firstKey}::timestamp and e.starts_at < ${grid.dayAfterLastKey}::timestamp`, `order by e.starts_at, e.id`, hard `limit 1500` as a runaway guard. The type filter is `and t.id in (${sql.join(ids.map((id) => sql\`${id}::uuid\`), sql\`, \`)})` — **never** `= any(${array})`: Drizzle expands a JS array in a `sql` template into a parenthesised list, not a Postgres array. Untyped events filter as the fallback because the `t` join already resolved them. Retired-type events appear under "All" (the type is still the event's) but under no pill and under any active filter (a filter is a set of ACTIVE types — see Edge Cases).

#### Cross-pipeline contract with `2026-10-14-portal-home-alignment` — confirmed, with three clarifications

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

### `src/lib/event-types.ts` (new — `server-only`) — gated by `event_types.manage` ONLY

```ts
export type EventTypesResult<T> =
  | { kind: "ok"; data: T } | { kind: "forbidden" } | { kind: "invalid_target" }
  | { kind: "invalid_input"; message: string };

export interface EventTypeRow {
  id: string; name: string; color: EventTypeColor; icon: EventTypeIcon;
  sortOrder: number; isActive: boolean; isFallback: boolean;
  usageCount: number;   // events typed with it (cancelled included) — "Used by N events"
}
export interface EventTypeInput { name: string; color: string; icon: string }

export async function canManageEventTypes(viewerPersonId: string, organizationId: string): Promise<boolean>;
export async function listEventTypes(viewerPersonId: string, organizationId: string): Promise<EventTypesResult<EventTypeRow[]>>; // ALL rows, order by is_fallback, sort_order, lower(name), id
export async function createEventType(viewerPersonId: string, organizationId: string, actingUserId: string, input: EventTypeInput): Promise<EventTypesResult<{ id: string }>>;
export async function updateEventType(viewerPersonId: string, organizationId: string, actingUserId: string, input: EventTypeInput & { id: string }): Promise<EventTypesResult<{ id: string }>>;
export async function setEventTypeActive(viewerPersonId: string, organizationId: string, actingUserId: string, id: string, isActive: boolean): Promise<EventTypesResult<{ id: string }>>;
export async function moveEventType(viewerPersonId: string, organizationId: string, actingUserId: string, id: string, direction: "up" | "down"): Promise<EventTypesResult<{ id: string }>>;
export async function seedStandardEventTypes(viewerPersonId: string, organizationId: string, actingUserId: string): Promise<EventTypesResult<{ created: number }>>;
```
Rules, all server-side and all tested:
- **Validation before the database**: `name` trimmed, 1–60 chars; `color` must satisfy `isEventTypeColor`; `icon` must satisfy `isEventTypeIcon`. `createEventType` additionally refuses `neutral` ("Choose a color.") — neutral is the fallback's. `updateEventType` on the fallback row keeps `color = 'neutral'` (a different color is `invalid_input` "The default type keeps its neutral color."); name and icon of the fallback are editable.
- **Duplicates**: a `lower(name)` pre-check inside the transaction (excluding the row itself on update) returns `invalid_input` `You already have an event type called '<name>'.`; a `23505` from the unique index (the race) maps to the **same** message via `isUniqueViolation` from `@/lib/db/errors`, caught **outside** `withOrgContext` because a failed statement aborts its transaction.
- **Retire**: `setEventTypeActive(fallback, false)` -> `invalid_input` "The default type can't be retired."; reactivating is always allowed. Retiring touches no event.
- **Create** places the new row at `max(sort_order of non-fallback rows) + 10` (10 if none). **Move** swaps the row with its neighbour among the NON-fallback rows (listed order, retired included), then renumbers the non-fallback rows 10, 20, 30…; the fallback is never moved and is always listed last (`order by is_fallback` first). Moving past an end is a no-op `ok`.
- **`seedStandardEventTypes`** reads the org's `organization_type` from `organizations`, inserts `eventTypeSeedPlan(type)` rows with `on conflict do nothing` (no target, so it also survives the fallback's partial unique index), and returns how many rows it actually created; idempotent.
- Every mutation sets `updated_by = actingUserId`; **no audit write** (R7). The file header says so and cites DECISION-161.

### `src/lib/events.ts` (modified)

- `EVENT_COLUMNS`/`EventRow` gain `eventTypeId`; the `getEvent` projection gains `eventType: { id: string; name: string } | null` (one extra select by id). `EventListEntry` is **unchanged** (the admin list does not show types in v1).
- `CreateEventInput.eventTypeId?: string | null` and `UpdateEventInput.eventTypeId?: string | null` — on update, `undefined` leaves the type unchanged, `null` clears it.
- The pre-check, inside the transaction, **after** the length/time checks and **before** any insert:
  ```ts
  const EVENT_TYPE_UNAVAILABLE = "That event type isn't available. Choose another.";
  async function eventTypeUsable(tx, organizationId, typeId: string, currentTypeId: string | null): Promise<boolean> {
    if (!isUuidShaped(typeId)) return false;                    // a garbage id must not reach Postgres as a 22P02
    const [row] = await tx.select({ id: eventTypes.id, isActive: eventTypes.isActive }).from(eventTypes)
      .where(and(eq(eventTypes.id, typeId), eq(eventTypes.organizationId, organizationId))).limit(1);
    return !!row && (row.isActive || row.id === currentTypeId); // a retired type already on THIS event stays selectable
  }
  ```
  A failure returns `{ kind: "invalid_input", message: EVENT_TYPE_UNAVAILABLE }`; the composite FK is the backstop for a race.
- `createEvent` writes `eventTypeId` on the parent **and on every generated child**; `extendSeriesPattern` copies `parent.eventTypeId` onto its children (analyst G4 — the two hand-written field copies are exactly where a type would silently be lost). `updateEvent` edits one occurrence only, so changing one occurrence's type leaves a mixed series — acceptable for v1 and said so in the edit form.
- New: `getEventTypePickerData(viewerPersonId, organizationId, opts?: { currentTypeId?: string | null }): Promise<EventsResult<EventTypePickerData>>` under `events.manage`, where `EventTypePickerData = { options: Array<{ id; name; colorToken; iconKey; isRetired: boolean }>; fallbackName: string | null }`. `options` = active **non-fallback** types in manager order, plus the event's current type when it is retired (`isRetired: true`); the fallback is never an option (it *is* "No type"). A current type equal to the fallback maps to "No type".
- `parseWallClock`/`formatWallClock` move to `src/lib/events/wall-clock.ts` in the **fix commit** (next section); `events.ts` imports them.
- The header paragraph about "LOCAL `Date` getters/setters" is rewritten: it is the sentence that was wrong.

### The `fix(events):` commit (R3 / F134) — first on the branch

Root cause, confirmed in `node_modules/drizzle-orm/pg-core/columns/timestamp.js:30-36`: a `timestamp` (no zone) column **writes** `value.toISOString()` and **reads** by appending `"+0000"`. So a `Date` is a faithful carrier of wall-clock digits only if its **UTC** fields hold them. `parseWallClock`/`formatWallClock` (`events.ts:103-126`) and `recurrence.ts` used **local** fields, so the stored digits equalled the typed digits only when the server process ran in UTC. Vercel does; a laptop in New York does not; and a weekly series stepped across the US DST end stored one-hour-off digits even there. This branch has 0 `events` rows and production's were written on Vercel (UTC), so **no stored value changes**.

Changes, all verified (the failing-first run is in "Verified against the live tree"):

1. **New `src/lib/events/wall-clock.ts`** — `WALL_CLOCK_RE`, `parseWallClock` (`new Date(Date.UTC(y, m-1, d, h, mi, s ?? 0, 0))`), `formatWallClock` (`getUTC*`). `events.ts` deletes its private copies and imports these; its header paragraph is corrected.
2. **`src/lib/events/recurrence.ts`** — the diff below. `getNthDayOfMonth` builds every `Date` with `Date.UTC` and reads `getUTCDay/getUTCDate/getUTCMonth`; `getNextOccurrence` uses `setUTCDate/setUTCMonth/getUTCMonth/getUTCFullYear/setUTCHours`. Behaviour under a UTC process is **byte-identical** (including the documented "Jan 31 + 1 month overflows into March" quirk, which this pipeline neither introduces nor fixes).
   ```diff
--- a/src/lib/events/recurrence.ts
+++ b/src/lib/events/recurrence.ts
@@ -121,25 +121,25 @@
   if (nth === -1) {
     // Find last occurrence
     // Start from end of month and work backwards
-    const lastDay = new Date(year, month + 1, 0);
-    const lastDayOfWeek = lastDay.getDay();
+    const lastDay = new Date(Date.UTC(year, month + 1, 0));
+    const lastDayOfWeek = lastDay.getUTCDay();
     let daysBack = lastDayOfWeek - dayOfWeek;
     if (daysBack < 0) daysBack += 7;
-    return new Date(year, month, lastDay.getDate() - daysBack);
+    return new Date(Date.UTC(year, month, lastDay.getUTCDate() - daysBack));
   }
 
   // Find first occurrence of the day in the month
-  const firstOfMonth = new Date(year, month, 1);
-  const firstDayOfWeek = firstOfMonth.getDay();
+  const firstOfMonth = new Date(Date.UTC(year, month, 1));
+  const firstDayOfWeek = firstOfMonth.getUTCDay();
   let daysForward = dayOfWeek - firstDayOfWeek;
   if (daysForward < 0) daysForward += 7;
 
   // Calculate the Nth occurrence
   const day = 1 + daysForward + (nth - 1) * 7;
-  const result = new Date(year, month, day);
+  const result = new Date(Date.UTC(year, month, day));
 
   // Verify we're still in the same month
-  if (result.getMonth() !== month) {
+  if (result.getUTCMonth() !== month) {
     throw new Error(`No ${nth}th occurrence of day ${dayOfWeek} in month ${month}`);
   }
 
@@ -157,13 +157,13 @@
 
     switch (parsed.value) {
       case "weekly":
-        next.setDate(next.getDate() + 7);
+        next.setUTCDate(next.getUTCDate() + 7);
         break;
       case "biweekly":
-        next.setDate(next.getDate() + 14);
+        next.setUTCDate(next.getUTCDate() + 14);
         break;
       case "monthly":
-        next.setMonth(next.getMonth() + 1);
+        next.setUTCMonth(next.getUTCMonth() + 1);
         break;
     }
 
@@ -175,8 +175,8 @@
     const nthValue = ordinal === "last" ? -1 : parseInt(ordinal);
 
     // Start from next month
-    let targetMonth = date.getMonth() + 1;
-    let targetYear = date.getFullYear();
+    let targetMonth = date.getUTCMonth() + 1;
+    let targetYear = date.getUTCFullYear();
     if (targetMonth > 11) {
       targetMonth = 0;
       targetYear++;
@@ -186,7 +186,7 @@
     const result = getNthDayOfMonth(targetYear, targetMonth, dayIndex, nthValue);
 
     // Preserve the time from the original date
-    result.setHours(date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds());
+    result.setUTCHours(date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds());
 
     return result;
   }
   ```
3. **`src/lib/testing/time-zone.ts` (new helper)** — `useProcessTimeZone(tz, { beforeAll, afterAll })` flips `process.env.TZ`, **throws if the override did not take** (a test must never pass vacuously), and restores it; plus `TEST_TIME_ZONES = ["UTC", "America/New_York", "Pacific/Honolulu"]`. Precedent: `src/lib/format-date.test.ts`.
   ```ts
/**
 * Runs `fn` with the process time zone flipped to `timeZone`, then restores it.
 * Precedent: src/lib/format-date.test.ts flips process.env.TZ the same way.
 * Node re-reads TZ on assignment, so Date's local getters really move; the
 * guard below throws if they did not, so a test can never pass vacuously
 * because the override silently failed to take.
 */
export function useProcessTimeZone(
  timeZone: string,
  hooks: { beforeAll: (fn: () => void) => void; afterAll: (fn: () => void) => void },
): void {
  let original: string | undefined;
  hooks.beforeAll(() => {
    original = process.env.TZ;
    process.env.TZ = timeZone;
    const effective = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (effective !== timeZone) {
      throw new Error(`TZ override did not take: wanted ${timeZone}, got ${effective}`);
    }
  });
  hooks.afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });
}
export const TEST_TIME_ZONES = ["UTC", "America/New_York", "Pacific/Honolulu"] as const;
   ```
4. **`src/lib/events/wall-clock.test.ts` (new) — the failing-first regression**, run under all three zones. It asserts at the **driver boundary**, because a within-process round trip passes with the old symmetric local code: `parseWallClock("2026-10-14T19:00").toISOString()` must be `2026-10-14T19:00:00.000Z`; a write-then-read round trip through the driver's own `value + "+0000"` read returns the typed digits (including the nonexistent local time `2026-03-08T02:30` and the doubled `2026-11-01T01:30`); and `generateRecurringDates(parseWallClock("2026-10-25T19:00"), "weekly", 3)` must send `2026-10-25T19:00Z`, `2026-11-01T19:00Z`, `2026-11-08T19:00Z`.
   ```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_TIME_ZONES, useProcessTimeZone } from "../testing/time-zone";
import { formatWallClock, parseWallClock } from "./wall-clock";
import { generateRecurringDates } from "./recurrence";

/** What Drizzle sends for a `timestamp` (no zone) column. */
const sentToDriver = (d: Date) => d.toISOString();
/** What Drizzle hands back for a raw 'YYYY-MM-DD HH:MM:SS' read. */
const readFromDriver = (raw: string) => new Date(raw + "+0000");

describe.each(TEST_TIME_ZONES)("wall-clock codec under TZ=%s (F134)", (tz) => {
  useProcessTimeZone(tz, { beforeAll, afterAll });

  it("stores the typed digits: parseWallClock's driver value carries them verbatim", () => {
    expect(sentToDriver(parseWallClock("2026-10-14T19:00"))).toBe("2026-10-14T19:00:00.000Z");
    expect(sentToDriver(parseWallClock("2026-01-05T00:00:30"))).toBe("2026-01-05T00:00:30.000Z");
  });

  it("round-trips through the driver's own read", () => {
    for (const typed of ["2026-10-14T19:00", "2026-11-01T01:30", "2026-03-08T02:30", "2026-12-31T23:59"]) {
      const written = sentToDriver(parseWallClock(typed)).replace("T", " ").replace(".000Z", "");
      expect(formatWallClock(readFromDriver(written))).toBe(`${typed}:00`);
    }
  });

  it("a weekly series across the US DST end keeps the same digits (the F134 drift)", () => {
    const dates = generateRecurringDates(parseWallClock("2026-10-25T19:00"), "weekly", 3);
    expect(dates.map(sentToDriver)).toEqual([
      "2026-10-25T19:00:00.000Z",
      "2026-11-01T19:00:00.000Z",
      "2026-11-08T19:00:00.000Z",
    ]);
  });
});
   ```
5. **`src/lib/events/recurrence.test.ts` (modified)** — convert the **18** `new Date(2026, …)` constructors to `new Date(Date.UTC(2026, …))` and the **12** local getters to `getUTC*` (mechanical; without it two cases fail under `TZ=Pacific/Honolulu`, observed). Wrap the file in the same three-zone `describe.each`.
6. **`src/lib/events.test.ts` (modified, DB-backed)** — one new case under `TZ=America/New_York`: `createEvent` with `startsAt: "2026-10-14T19:00"` then a raw owner-connection `select to_char(starts_at, 'YYYY-MM-DD HH24:MI:SS')` returns `2026-10-14 19:00:00`; and a weekly series of 3 across `2026-11-01` stores `19:00:00` on all three rows. This is the end-to-end proof; it fails on the old writer.
7. **S1 (adopted) — `eslint.config.mjs`**: a block scoped to `src/lib/events.ts`, `src/lib/events/**`, `src/lib/calendar.ts`, `src/lib/calendar/**`, `src/lib/shared/org-time.ts` (tests excluded) that bans local `get/set` date methods, `getTimezoneOffset`, and the multi-argument `new Date(...)` constructor, and **repeats** the `toLocale*` selector because a later `no-restricted-syntax` config replaces the earlier one for the files it matches. The diff, exactly (verified against a probe file):
   ```diff
--- a/eslint.config.mjs
+++ b/eslint.config.mjs
@@ -34,6 +34,51 @@
       ],
     },
   },
+  // S1 (DECISION-160 / F134): the wall-clock paths use `Date` only through its
+  // UTC fields. drizzle-orm writes a no-zone timestamp with toISOString() and
+  // reads it back by appending "+0000", so a LOCAL getter, setter or
+  // multi-argument constructor silently stores the typed digits only when the
+  // server process happens to run in UTC. This block REPEATS the toLocale*
+  // selector because a later `no-restricted-syntax` config REPLACES the
+  // earlier one for the files it matches. Tests are excluded: they build
+  // local Dates on purpose, to prove the bug stays fixed.
+  {
+    files: [
+      "src/lib/events.ts",
+      "src/lib/events/**/*.ts",
+      "src/lib/calendar.ts",
+      "src/lib/calendar/**/*.ts",
+      "src/lib/shared/org-time.ts",
+    ],
+    ignores: ["**/*.test.ts"],
+    rules: {
+      "no-restricted-syntax": [
+        "error",
+        {
+          selector:
+            "CallExpression[callee.property.name=/^toLocale(String|DateString|TimeString)$/]",
+          message:
+            "Use <FormattedDate> from src/components/shared/formatted-date.tsx instead of toLocale*() to avoid SSR timezone mismatches.",
+        },
+        {
+          selector:
+            "CallExpression[callee.property.name=/^(get|set)(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)$/]",
+          message:
+            "Wall-clock code reads and writes Date only through its UTC fields (getUTC*/setUTC*) - a local getter or setter stores the typed digits only when the server runs in UTC (F134).",
+        },
+        {
+          selector: "CallExpression[callee.property.name='getTimezoneOffset']",
+          message:
+            "Wall-clock code must not depend on the process time zone (F134).",
+        },
+        {
+          selector: "NewExpression[callee.name='Date'][arguments.length>1]",
+          message:
+            "new Date(y, m, d, ...) builds a LOCAL Date. Use new Date(Date.UTC(...)) (F134).",
+        },
+      ],
+    },
+  },
   // Exempt the primitive itself — it is the one place toLocale* is intentional.
   {
     files: ["src/components/shared/formatted-date.tsx"],
   ```

Commit trailers: `Caught-By: agent-review` / `Discovered-In: Phase-1`, plus `Work-Log: 2026-10-14-member-calendar`.

### The tile registry (R1, R6, F135)

`src/lib/org-portal/tiles.ts` — `PortalTile` becomes a base interface intersected with a gate union, so `tsc` refuses a tile with neither gate:

```ts
import type { OrgFeatureKey } from "@/lib/org-features"; // TYPE-ONLY: a runtime import closes tiles -> org-features -> org-feature-categories -> tiles (F135)

interface PortalTileBase {
  key: string; label: string; description: string;
  href: (slug: string) => string;
  category: PortalTileCategory;
  orgTypeScope?: readonly OrganizationType[];
  domain: PortalDomain;
  comingSoon?: boolean;
}
export type PortalTileGate =
  | { flagKey: string; orgFeatureKey?: OrgFeatureKey }
  | { flagKey?: undefined; orgFeatureKey: OrgFeatureKey };
export type PortalTile = PortalTileBase & PortalTileGate;
```
`visiblePortalTiles` and the `isFlagEnabled` import **leave** `tiles.ts` (so it is data + types again; `tiles.ts` stays importable by `org-feature-categories.ts` and `org-features.ts` with no cycle). Two tile changes, in `PORTAL_TILES` declaration order:

```ts
  // new, immediately BEFORE the events tile — the member read surface (R6: read surface -> operate)
  {
    key: "calendar",
    label: "Calendar",
    description: "See what's coming up.",
    href: (slug) => `/o/${slug}/calendar`,
    orgFeatureKey: "org_portal.calendar",   // no flagKey: toggle-only (DECISION-160)
    category: "operate",
    domain: "worship",
  },
  // existing events tile — the authoring surface moves to the admin hub; DECISION-113 ruling 7 is reversed for events only
  {
    key: "events",
    label: "Manage events",
    description: "Create and manage calendar events, including repeating series.",
    href: (slug) => `/o/${slug}/admin/events`,
    flagKey: "org_portal.events",
    category: "administer",
    domain: "worship",
  },
```
`PORTAL_TILES` goes from 19 to **20** entries. `src/components/org-portal/tile-icons.tsx` gains `calendar: CalendarDays` and `events: CalendarCog` (both verified present in lucide-react).

**`src/lib/org-portal/visible-tiles.ts` (new — `server-only`)** — moved, not copied:

```ts
export interface TileViewer { personId: string; organizationId: string }
export async function visiblePortalTiles(
  category: PortalTileCategory,
  organizationType: OrganizationType,
  viewer: TileViewer,            // REQUIRED, like organizationType — a forgotten viewer must fail at tsc
): Promise<PortalTile[]>;
```
Filter order is category -> `orgTypeScope` -> `tile.flagKey` (if defined) -> the catalog entry's own `flag` (if non-null) -> the org toggle via `isOrgFeatureEnabled(viewer.personId, viewer.organizationId, tile.orgFeatureKey)`. A tile excluded earlier never triggers a later read. **An error from the toggle read (any error, including `OrgAccessError`) hides that tile and logs the two ids only — never the message, never throws**, so the nav and footer fail exactly the way a flag read does today (F135). Order of the result follows `PORTAL_TILES`. Tiles still never check a permission (DECISION-003): the viewer's ids are used only for the org toggle read, which `withOrgContext` membership-checks.

**The four callers** (all already inside a resolved-ok branch, so the ids are in hand):

| Caller | Change |
|---|---|
| `src/app/(org)/o/[slug]/page.tsx:175` | `visiblePortalTiles("operate", resolved.org.organizationType, { personId: resolved.org.personId, organizationId: resolved.org.organizationId })` |
| `src/app/(org)/o/[slug]/admin/page.tsx:100` | same, `"administer"` |
| `src/app/(org)/o/[slug]/portal-nav.tsx:91` | `PortalNav` gains a required `viewer: TileViewer` prop |
| `src/components/org-portal/portal-footer.tsx:93` | `PortalFooter` gains a required `viewer: TileViewer` prop |
| `src/app/(org)/o/[slug]/layout.tsx` | threads `viewer` (`resolved.org.personId`, `resolved.org.organizationId`) to `<PortalNav>` and `<PortalFooter>` from the same `resolved.kind === "ok"` branch that already supplies `orgOrganizationType` — no new query |

The imports in all five files change from `@/lib/org-portal/tiles` to `@/lib/org-portal/visible-tiles` for the function (the constants `DOMAIN_LABELS`/`DOMAIN_ORDER` stay in `tiles.ts`). The home pipeline also edits `page.tsx`; this commit touches that one call only, so it rebases cleanly.

### Pages and Server Actions

| Route | Kind | Gate order | Notes |
|---|---|---|---|
| `GET /o/<slug>/calendar?month&types&view` | Server Component | `cachedAuth()` -> `resolveOrgContext` (four-way miss) -> `assertOrgAccess` -> `getMonthCalendar` (toggle -> `events.view`/`events.manage`) | no flag; params through `parseMonthParam`/`parseTypesParam`/`parseViewParam`; **no `loading.tsx`** (the segment can render states and the detail segment calls `notFound()`) |
| `GET /o/<slug>/calendar/<eventId>?from` | Server Component | same, then `getMemberEvent` (gate **before** any lookup) | `ok`+`event: null` -> `notFound()`; `from` through `safeCalendarBackHref`; **no `loading.tsx`** |
| `GET /o/<slug>/admin/events/types` | Server Component | same auth -> `org_portal.events` flag (`EventsFlagOff`) -> `listEventTypes` (`event_types.manage`) | `forbidden` -> `EventTypesForbidden`; no `loading.tsx` |

Server Actions in `src/app/(org)/o/[slug]/admin/events/types/actions.ts` (`"use server"`; `auth()` directly, not `cachedAuth()`; each re-resolves `slug` through `resolveOrgContext` and never takes an organization id from the client — a private copy of `resolveActingIdentity`, the per-file convention). The header states DECISION-161: **no audit write, by ruling**; a direct `db.` mutation here would need `// audit-exempt: DECISION-161` on the line above (none is expected — they call `src/lib/event-types.ts`, which uses `tx`).

```ts
createEventTypeAction(slug: string, input: EventTypeInput): Promise<ActionResult<{ id: string }>>
updateEventTypeAction(slug: string, input: EventTypeInput & { id: string }): Promise<ActionResult<{ id: string }>>
setEventTypeActiveAction(slug: string, id: string, isActive: boolean): Promise<ActionResult<{ id: string }>>
moveEventTypeAction(slug: string, id: string, direction: "up" | "down"): Promise<ActionResult<{ id: string }>>
seedStandardEventTypesAction(slug: string): Promise<ActionResult<{ created: number }>>
```
Result mapping: `forbidden` -> "You don't have permission to manage event types here."; `invalid_target` -> "That event type doesn't exist."; `invalid_input` -> its message. After success each calls `revalidatePath` for `/o/<slug>/admin/events/types` and `/o/<slug>/calendar`. The existing `admin/events/actions.ts` only passes `eventTypeId` through (its types come from `src/lib/events.ts`); `mapForbiddenOrInvalid` already forwards an `invalid_input` message.

## Component / Page Plan

Everything is a Server Component except the three named client leaves. No `loading.tsx` on any new segment (`/calendar`, `/calendar/[eventId]`, `/admin/events/types`) and no new `error.tsx`: `/o/[slug]/error.tsx` already catches an unexpected throw, and every expected failure is an inline state (the "loading + error present" checklist item is satisfied by that inheritance; QA should not fail it). Anything that renders a date or time uses the pure formatters in `src/lib/calendar/` — **never** `<FormattedDate>` (its server fallback is the date only and a 31-cell grid would show bare dates before hydration), never `toLocale*`. Nothing below `md` uses `text-xs`; the floor is `text-sm`. No Tailwind palette literal anywhere: colour comes from `TYPE_COLOR_CLASSES`.

### Files created

**Shared display pieces — `src/components/org-portal/event-types/`** (used by the calendar, the detail page, the manager, the forms, and the home pipeline's card; `org-portal/`, not `shared/`, because no platform-shell page renders an event type)
- `event-type-icon.tsx` — `EventTypeIcon({ iconKey, className }: { iconKey: string | null | undefined; className?: string })`. A static `Record<EventTypeIcon, LucideIcon>` import map (a misspelling fails `tsc`); unknown/null -> `CalendarDays`; always `aria-hidden`. Takes the **key**, never a component (icon components must not cross the server->client boundary — `portal-nav.tsx` records a real 500).
- `event-type-chip.tsx` — `EventTypeChip({ name, colorToken, iconKey, className })`: an inline pill, `TYPE_COLOR_CLASSES[color].chip` + `.border`, icon + the visible name at `text-sm`.
- `event-type-swatch.tsx` — `EventTypeSwatch({ colorToken, className })`: a 16px rounded square filled with the **ink** (`.swatch`), `aria-hidden`, always beside a text label.
- `event-type-picker.tsx` — `EventTypePicker({ id, selectProps, options, fallbackName })`; `selectProps` is the `register("eventTypeId")` spread. A native `<select>` with the shared `SELECT_CLASSES` (`appearance-none`, chevron, `disabled:` styles). First option value `"none"` labelled `No type (shown as ${fallbackName})`, or `No type` when `fallbackName` is null; then `options` in order, a retired current type labelled `${name} (retired)`. Label `Event type (optional)`; hint `Colors the event on the calendar.` Renders **nothing** when `options.length === 0` (a presbytery with only the fallback).

**Calendar route — `src/app/(org)/o/[slug]/calendar/`**
- `page.tsx` (server). Flow: `cachedAuth` (signed out -> `/signin?callbackUrl=` the **rebuilt** canonical calendar href, never the raw query), `resolveOrgContext` (the existing `OrgAccessDenied`/`OrgAccessEnded`/`notFound` four-way), `assertOrgAccess`, parse the three params, `getMonthCalendar` in a try/catch (`OrgAccessError` rethrown; anything else -> `CalendarLoadError`), then switch on `kind`: `disabled` -> `CalendarDisabled`, `forbidden` -> `CalendarForbidden`, `ok` -> the page. When `data.canManage`, one `isFlagEnabled("org_portal.events")` read decides whether the manager links render.
- `calendar-states.tsx` (server): `CalendarDisabled({ name })` "The calendar isn't turned on for {name} yet."; `CalendarForbidden({ name })` "The calendar isn't available to your account at {name} yet. If you think it should be, ask your stated clerk or another administrator there."; `CalendarLoadError({ retryHref })` "We couldn't load the calendar right now. Try again in a moment." plus a **Try again** link to `retryHref` (the same month, types and view). All three render an `<h1>Calendar</h1>`.
- `month-nav.tsx` (server): `<nav aria-label="Month">` with the month heading `<h2 className="text-xl font-semibold">October 2026</h2>` and prev/next as `Link`s (`min-h-11 min-w-11`, `ChevronLeft`/`ChevronRight`, `aria-label="Previous month, September 2026"`); at the 2000-01 / 2100-12 edges the control renders as an `aria-disabled` span, not a link. Every link is built by `buildCalendarHref` and carries `types` and `view` (analyst G8); only **Today** drops `month`.
- `type-filter-pills.tsx` (server): `<nav aria-label="Filter by event type"><ul>` of plain `Link` pills — an **All** pill first, then one per active type (fallback last). Each pill is `min-h-11 inline-flex items-center gap-1.5 rounded-full border px-3 text-sm`, a type pill in its `chip` + `border` classes with `EventTypeIcon` and the name; **selected** = `aria-current="true"` + a `Check` icon + `border-2 font-semibold` (never colour alone). Hrefs come from `toggleTypeSelection` -> `buildCalendarHref`; the All pill drops `types`. Props: `{ slug, month: MonthRef, view, types: MemberEventType[], activeTypeIds: string[] }`.
- `month-grid.tsx` (server): a real `<table>` (`<caption className="sr-only">`, `<th scope="col">` with the abbreviated weekday and `<abbr title>`), `table-fixed w-full`; each `<td>` holds `<time dateTime={key} aria-current={isToday ? "date" : undefined}>` (the day number visible, the full date `sr-only`; today = a `bg-primary text-primary-foreground rounded-full` circle plus a `sr-only` "Today") and a `max-h-72 min-h-24 overflow-y-auto` div of `CalendarEntryLink`s — **no "+N more"**: a busy day scrolls inside its cell. Out-of-month cells use `bg-muted` and `text-muted-foreground` and still show their entries. Wrapper `hidden md:block` for `view=month`, `hidden` for `view=list`; `print:max-h-none print:overflow-visible` so a printed month is not clipped. `data-testid="calendar-grid"`.
- `month-list.tsx` (server): in-month days that have entries only, each `<section>` with `<h3 className="text-lg font-semibold">Sunday, October 4</h3>` (`(today)` text on today) and an `<ol>` of `CalendarEntryLink variant="list"`. Wrapper `md:hidden` for `view=month`, `block` for `view=list`. `data-testid="calendar-list"`.
- `calendar-entry.tsx` (server): `CalendarEntryLink({ slug, entry, fromHref, variant: "grid" | "list" })`. A `Link` to `/o/${slug}/calendar/${entry.id}?from=${encodeURIComponent(fromHref)}` where `fromHref` is the canonical `buildCalendarHref` of the **displayed** month/types/view. Grid: `block rounded-md border border-transparent border-l-4 px-1.5 py-1 text-sm leading-snug` + `chip` + `rule`; icon, time (`whitespace-nowrap font-medium`), title (`break-words`), an `sr-only` ", {type name}", and a `block text-sm` location line. List: `block min-h-11 rounded-md border border-transparent border-l-4 px-3 py-2 text-base`; icon, time, title, the location, and the type name as **visible** `text-sm` text. Focus ring with the 2px offset. `data-testid="calendar-entry"`.
- `copy-month-button.tsx` (**`"use client"`**): props `{ html: string; text: string; leftOutCount: number; filterLabel: string | null }`. `const hydrated = useHydrated()`; `<Button type="button" variant="outline" className="min-h-11" disabled={!hydrated}>` with a `Copy` icon and the text **Copy month** — disabled until hydration so a pre-hydration click is never silently lost (F129). The click handler is **synchronous** from the first statement to `navigator.clipboard.write` (iOS Safari requires the write to be traceable to the gesture): feature-detect `navigator.clipboard?.write` and `ClipboardItem` inside the handler -> `toast.error("Your browser can't copy to the clipboard.")`; build one `ClipboardItem` with a `text/html` and a `text/plain` Blob; `.then(() => toast.success(copiedMessage(leftOutCount, filterLabel)), () => toast.error("Couldn't copy the calendar. Try again."))`; a thrown error -> the same "Couldn't copy" toast. The HTML string is **never** rendered into the DOM (no preview; `dangerouslySetInnerHTML` is banned by `check:brand-scope` E3 anyway). `data-testid="copy-month"`.
- `[eventId]/page.tsx` (server): the member detail. `<Link>` back to `safeCalendarBackHref(slug, from)` (`ArrowLeft` + "Back to calendar" / "Back to home" — a plain link in the ui-standards Back-Navigation style); `<h1>` the title; the type as an `EventTypeChip`; `describeWhen` as one or two lines; the location (`MapPin`); the description at `text-base` with `whitespace-pre-line`; "Part of a repeating series" when `isSeriesOccurrence`; and, when `canManage` **and** `org_portal.events` is on, an **Edit this event** link to `/o/${slug}/admin/events/${id}`. It never shows `isPublic`, the check-in flag, the creator, the pattern or the count. `ok`+`null` -> `notFound()` (identical to a missing id, another org's id, a cancelled event and a non-UUID id).

**Manager — `src/app/(org)/o/[slug]/admin/events/types/`**
- `page.tsx` (server): the same auth chain as `admin/events/page.tsx`, then `org_portal.events` (`EventsFlagOff`), then `listEventTypes`; `forbidden` -> `EventTypesForbidden`; a throw -> `EventTypesLoadError` (rethrow `OrgAccessError`). Layout: constrained-width. `<h1>Event types</h1>`, description "Colors and icons used on the calendar for {org}.", a fixed `Back to events` link, the hint "Retired types stay on the events that already use them. They won't be offered for new events or shown as a filter." Then `EventTypeList`, then the add form. Zero rows -> an empty state "No event types yet" with a **Add the standard event types** button (`seedStandardEventTypesAction`) and the add form.
- `event-types-states.tsx` (server): `EventTypesForbidden({ name })` "You don't have permission to manage event types at {name}. If you think this is a mistake, ask your stated clerk or another administrator there."; `EventTypesLoadError({ slug })` "We couldn't load event types right now. Try again in a moment." + **Try again**.
- `event-type-list.tsx` (**`"use client"`**): one `Card` row per type, `<ul>`. Each row: `EventTypeSwatch` + `EventTypeIcon` + the name (`text-base font-medium`), `Badge`s **Default** (fallback) / **Retired** (inactive) as text, "Used by N events" (`text-sm text-muted-foreground`); **Edit** (opens a `Dialog` containing `EventTypeForm mode="edit"`); **Move up** / **Move down** icon buttons (`ArrowUp`/`ArrowDown`, `aria-label="Move Worship up"`, `title`, `min-h-11 min-w-11`, disabled at the ends, absent for the fallback); a `Switch` labelled **Offered** (wrapped in a `min-h-11` label like `features-list.tsx`; the fallback's is `disabled` with the visible reason "The default type can't be retired."). Each row owns its pending state; success -> `toast.success(...)` + `router.refresh()`; failure -> `toast.error(result.error)` and the optimistic switch reverts.
- `event-type-form.tsx` (**`"use client"`**, react-hook-form + zod, **wrapped in `<HydrationGate>`** — `check:hydration-gate` enforces): `EventTypeForm({ slug, mode: "create" | "edit", initial?, isFallback?, onDone? })`. Fields: **Name** (`Input`, `maxLength` 60, `RequiredMark`); **Color** — a `<fieldset><legend>Color</legend>` of eight radio labels (swatch + the text label from `EVENT_TYPE_COLOR_LABELS`, native radio visible, `min-h-11`); **Icon** — a `<fieldset><legend>Icon</legend>` of fifteen radio labels (icon + `EVENT_TYPE_ICON_LABELS` text), `grid grid-cols-2 sm:grid-cols-3`. For the fallback the Color fieldset is replaced by the read-only line "Color: Neutral (the default type is always neutral)". Submit `Add event type` / `Save changes` (disabled while pending, "Adding…"/"Saving…"); a checkbox or radio under the gate has a defined default and never `defaultChecked`. Failure: the server message in a toast; the form is not reset.
- `event-type-schema.ts` (+ `.test.ts`): `eventTypeFormSchema` — `name: z.string().trim().min(1, "Name is required").max(60, "Use 60 characters or fewer")`, `color: z.string().refine(isEventTypeColor, "Choose a color.")`, `icon: z.string().refine(isEventTypeIcon, "Choose an icon.")`.
- `actions.ts` — see above.

### Files modified

- **Admin events (`src/app/(org)/o/[slug]/admin/events/`)**: `page.tsx` — an outline **Event types** button after **New event**, rendered only when `canManageEventTypes(...)` is true (a thrown non-`OrgAccessError` -> false); `new/page.tsx` and `[eventId]/edit/page.tsx` — load `getEventTypePickerData` (edit passes the event's current type) and pass `typePicker` + `orgName` to the form; `new-event-form.tsx` / `edit-event-form.tsx` — a hidden-until-needed `EventTypePicker` after Location, the `eventTypeId` form field (default `"none"`; the edit form defaults to the event's type, or `"none"`), mapped to `null` on submit; the checkbox copy under **Visible on the public calendar** becomes a hint line "If unchecked, the event still shows on the member calendar for everyone in {orgName}. It just stays off the public website." (analyst G1 — an admin who unticks it for a Session meeting would otherwise believe it hidden); the edit form for a series occurrence adds "Changes this occurrence only." (G4); `event-schema.ts` — `eventTypeId: z.string()` in `baseFields`; `[eventId]/page.tsx` — a `Type: {name}` line in the metadata paragraph. `actions.ts` is unchanged.
- **Event library**: `src/lib/events.ts` (above), `src/lib/org-provisioning.ts` (above).
- **Tile registry & chrome**: `src/lib/org-portal/tiles.ts`, new `visible-tiles.ts`, `src/components/org-portal/tile-icons.tsx`, `portal-footer.tsx`, `src/app/(org)/o/[slug]/{page.tsx,layout.tsx,portal-nav.tsx,admin/page.tsx}`.
- **Brand/DB/docs-in-code**: `src/lib/brand/contract.ts`, `src/app/globals.css`, `src/lib/db/domain/events.ts`, `src/lib/db/domain/org.ts`, `eslint.config.mjs`, and `src/lib/dev-docs.ts` (one `INVARIANTS` entry, `enforcement: "documented"` — what `/developer` renders as **paper**):
  ```ts
  {
    title: "A congregation's event types always include one fallback — except where nobody made one",
    detail: "event_types carries a partial unique index allowing at most one is_fallback row per org, a CHECK that it is active, and a CHECK that it is neutral and nothing else is (drizzle/0054). 'At least one' cannot be a constraint, so it is paper: provisioning, the 0054 backfill and the manager's 'Add the standard event types' action create it, and the calendar must (and does) render correctly with zero types, showing untyped events as neutral with no filter pills.",
    enforcement: "documented",
  },
  ```
  Optional (Phase 4's call, not required): a `category` swatch row on `/admin/design-system` (`src/app/(admin)/admin/design-system/page.tsx`) so the palette can be signed off visually at 360px and in both schemes.

### Mobile and responsive rules (analyst G14, architect placement) — checked in a browser

- Below `md`: the list only; the Month/List switch (`hidden md:inline-flex`, a two-link button group with `aria-current`) does not render. At `md+` `?view=list` shows the list and hides the grid.
- The filter row renders **twice**: inside `<details className="group md:hidden" data-testid="calendar-filters">` and as a plain `<div className="hidden md:block">` — CSS cannot force a closed `<details>` open, and the hidden copy is `display:none`, so assistive technology reads one. The `<summary>` carries `className="cursor-pointer list-none [&::-webkit-details-marker]:hidden"` and **no `display` utility** (the iOS `<summary>` defect in CLAUDE.md → Verify in a Browser); its layout lives on an inner `<span className="flex min-h-11 items-center gap-2">` holding the label and a `ChevronDown` with `group-open:rotate-180`. The label is two spans — `group-open:hidden` "Show filters" (or "Filters: N active" when `activeTypeIds.length > 0`) and `hidden group-open:inline` "Hide filters" — so the toggle needs no JavaScript and the pills are plain links that work before hydration.
- All of prev, next, Today, the pills, the entries in the list view, and the buttons are at least 44px (`min-h-11`); grid cells keep the 14px floor. Print: the action bar, month nav and filters are `print:hidden`; entries print with their icon, text and 4px rule, not tint alone.
- The action bar follows ui-standards (text-labelled before icon-only): `Add an event` (primary) and `Manage events` (outline) for `canManage` holders with `org_portal.events` on, then `Today` (outline), then **`Copy month` last** (the analyst's placement). The prev/next chevrons are the month nav's, one row down. In the brand-new-org state the action bar omits `Add an event` because the empty-state card carries it.

### Empty states and microcopy (analyst G13, all literal)

| State | Copy | Extras |
|---|---|---|
| Org has no events at all, viewer can manage (and `org_portal.events` is on) | "{Org} hasn't added any events yet." | **Add an event** button |
| Org has no events at all, anyone else | "When {Org} adds events, they'll appear here." | — |
| Month empty (unfiltered count 0, org has events elsewhere) | "Nothing is scheduled for October 2026." | month nav stays |
| Filters hide everything (unfiltered count > 0, filtered 0) | "No events match these event types." | link **Show all event types** (drops `types`) |
| Zero or one active types | the pills row is omitted entirely | calendar still works |
| Database failure | "We couldn't load the calendar right now. Try again in a moment." | **Try again** keeps month, types, view |

The empty-state card follows ui-standards: a bordered dashed block with a sentence and, where an action exists, a real button. A garbage `?month=` renders the current month with no error (analyst G7).

## Implementation Order

Commit order and owner. Each commit must leave `npm run typecheck`, `npm run lint`, `npm run test` and `npm run check` green, and is made **only on the user's explicit say-so** (CLAUDE.md Workflow Rule 1) — the order below is the intended sequence, not authority to commit.

| # | Commit | Implementer | Contents |
|---|---|---|---|
| 0 | `style(site): label the portal link "Our Portal"` | orchestrator (already in the working tree) | `src/app/(public)/site/[slug]/[[...path]]/page.tsx` `PORTAL_LABEL`; its own commit, no `Work-Log:` trailer required (a `style:` commit) |
| 1 | `fix(events): store typed event times as typed, whatever the server's time zone` | **api-developer** | `src/lib/events/wall-clock.ts` (+test), `recurrence.ts` (+test conversion), `src/lib/testing/time-zone.ts`, `events.ts` import swap, `events.test.ts` TZ case, S1 ESLint block. Trailers `Caught-By: agent-review`, `Discovered-In: Phase-1`, `Work-Log:` |
| 2 | `feat(brand): add the categorical event-type colour family` | **ux-developer** | `contract.ts` (+`contract.test.ts` additions), `globals.css`, `src/lib/events/type-palette.ts` (+`.test.ts`, minus the migration-parity case, which lands with 3), optional design-system swatches |
| 3 | `feat(schema): event types, event_type_id, org time zone (0054)` | **database-admin** | `drizzle/0054_…sql` (applied to the pipeline branch), `domain/events.ts`, `domain/org.ts`, `type-seed-plan.ts` (+test), the migration-parity cases in `type-palette.test.ts`, `dev-docs.ts` invariant, the schema-pin test. **Not** `_journal.json`, `domain/index.ts`, `seed-dev.sql`, `test-rls.sql` (Rule 16) |
| 4 | `feat(calendar): the member read path and event-type library` | **api-developer** | `shared/org-time.ts`, `shared/uuid.ts`, `org-settings.ts`, `org-features.ts`, `org-provisioning.ts`, `calendar/*`, `calendar.ts`, `event-types.ts`, `events.ts` type plumbing, `admin/events/types/actions.ts` + its test — with every unit and DB-backed test below for those files |
| 5 | `feat(portal): a calendar tile and a per-org tile gate` | **full-stack-developer** | `tiles.ts`, `visible-tiles.ts`, `tile-icons.tsx`, the five caller files and their tests (small and coupled across lib and five UI files; splitting it would leave `tsc` red between halves) |
| 6 | `feat(calendar): the member calendar, the detail page and the event-types manager` | **ux-developer** | everything under "Files created" for the UI, the picker on both forms, `event-schema.ts`, the admin page edits, component/page tests, e2e |
| 7 | integration (orchestrator, **before Phase 5**) | orchestrator | the D1–D9 drafts below applied on this branch in one or two commits (`chore:`/`test:`/`docs:`), because QA's rehearsal needs `_journal.json`, `seed-dev.sql` and `test-rls.sql` |

Steps inside a commit follow the template's order — schema -> catalog/seed -> library/actions -> UI -> (no audit events: R7) -> release notes at Phase 6.

**Why this order is forced:** 3 imports `type-palette.ts` (2) from the domain file; 4 imports the domain (3); 5's `tiles.ts` imports the `OrgFeatureKey` type from 4's `org-features.ts`; 6 imports all of them. 1 is independent and goes early so it can ship on its own if the rest slips.

**Applying `0054` to the pipeline branch** happens in commit 3 (idempotent `psql -f`). Phase 5 must re-read the live catalog afterwards, not just `drizzle/` (see "Verification recipe for QA").

## Tests the implementer must write

Unit tests that touch time run under **all three zones** via `describe.each(TEST_TIME_ZONES)` + `useProcessTimeZone`. DB-backed suites use the existing harness (`describe.skipIf(!hasDb)`, dynamic imports in `beforeAll`, `fixtureDeletableUntil()` orgs) and run with `npm run test:db`.

**Pure (no DB)**
- `src/lib/events/wall-clock.test.ts` (fix commit — shown above); `src/lib/events/recurrence.test.ts` (converted, three zones).
- `src/lib/shared/org-time.test.ts` — the fixtures in the `org-time.ts` section, in all three zones, plus `isValidTimeZone`'s table.
- `src/lib/org-settings.test.ts` — stub `tx.execute`: no row -> default; `America/Chicago` -> itself; `Nope/Zone` -> default **and** `console.error` called with the org id and no message.
- `src/lib/calendar/month.test.ts` — the grid fixtures (Oct 2026, Feb 2026, Dec 2026, Jan 2000 = 6 weeks, Dec 2100); `parseMonthParam` rejects `0000-01`, `1999-12`, `2101-01`, `2026-13`, `2026-1`, `""`, `undefined`, an array of garbage, and accepts `2000-01`/`2100-12`; `prevMonth(2000-01)`/`nextMonth(2100-12)` are `null`; `addDays` across a month and year end; `monthOfDayKey`; every formatter. Three zones.
- `src/lib/calendar/wall-clock.test.ts` — `12:00 AM`, `12:00 PM`, `7:05 PM`, `11:59 PM`; compact `12a`, `12p`, `7:30p`; `formatTimeRange` same-day vs next-day end; `describeWhen`; malformed strings throw.
- `src/lib/calendar/filters.test.ts` — `parseTypesParam`: non-UUID dropped, case folded, duplicates removed, >50 entries capped, >2,000 chars truncated, an array uses its first element, a SQL-looking string yields `[]`; `sanitizeTypeFilter` (another org's UUID-shaped id is dropped and does **not** count toward "N active"; nothing valid -> `[]`; covering every active -> `[]`); `toggleTypeSelection` (from All starts a one-item list; removing the last returns to All; reaching every type collapses to All); `buildCalendarHref` (parameter order, omissions, `types` and `view` carried); `parseViewParam`; `safeCalendarBackHref` — accepts `/o/alder-creek`, `/o/alder-creek/calendar`, `/o/alder-creek/calendar?month=2026-10&types=…&view=list`; rejects `https://evil.example`, `//evil.example`, `/o/other/calendar`, `/o/alder-creek/calendar/../admin`, `/o/alder-creek/admin/roles`, `/o/alder-creek/calendar#x`, a backslash, a >300-char query, a non-string, `undefined`.
- `src/lib/calendar/clipboard.test.ts` — the G9 rules: heading `October 2026`, escaped HTML (`<script>` in a title and `&` in a location), non-public and cancelled dropped with the right `leftOutCount`, adjacent-month cells numbered but empty, an empty month, no org name/URL/id/description/type name/colour anywhere in either string, a multi-day event once on its start day, `copiedMessage`'s four shapes and plurals. Three zones.
- `src/lib/events/type-palette.test.ts` — the colour and icon CHECK lists in `drizzle/0054…sql` equal `EVENT_TYPE_COLORS`/`EVENT_TYPE_ICONS` (regex over the single-line constraint definitions); every colour has a full `TYPE_COLOR_CLASSES` entry whose strings are literal `…-category-<key>-…` classes; `typeColorClasses("nope")` is neutral; the migration's `VALUES` tuples equal `STANDARD_EVENT_TYPES`.
- `src/lib/events/type-seed-plan.test.ts` — exactly one fallback, neutral and active; names unique case-insensitively; no non-fallback `neutral`; the eight standard colours are distinct; per-org-type plans (congregation/NWC nine, others one).
- `src/lib/db/domain/events.schema.test.ts` — `getTableConfig(eventTypes)` declares every constraint/index name the migration creates and `getTableConfig(events)` declares `events_event_type_fk` and `events_org_type_idx` (a `check:schema-parity` complement for the parts it deliberately does not compare: checks and indexes).
- `src/lib/brand/contract.test.ts` (modified) — the additions shown in the verified diff: every `CATEGORY_PAIRS` entry in both schemes (54 assertions), the full-pair-set/closure test from the `categorical` marker, the S3 hue-distance test, and that no categorical token is `brandable`. `brand-tokens.test.tsx` and `generate.test.ts` run unchanged.
- `src/lib/org-feature-catalog.test.ts` (new; mocks `server-only`, `@/lib/authz`, `@/lib/flags`, `@/lib/audit`) — every entry has `flag: string | null` and a boolean `provisionedOn`; every non-null `flag` is a key `scripts/seed.ts` seeds (read the file and regex `key: "…"` — a real drift guard rather than a snapshot); only `org_portal.calendar` has `flag: null` and `provisionedOn: true`; every `PORTAL_TILES` `orgFeatureKey` is a catalog key.
- `src/lib/org-portal/tiles.test.ts` (modified) — 19 -> **20** tiles; key list gains `calendar`; `EXPECTED` gains `calendar: { domain: "worship", category: "operate" }` and `events` becomes `{ domain: "worship", category: "administer" }`; the operate/administer classification test moves `events` to administer; the labels `Calendar` and `Manage events`; **"every tile has a gate"** (`flagKey` or `orgFeatureKey`) replaces "every `flagKey` is seeded", and the seeded-key check applies to tiles that have a `flagKey`; the `visiblePortalTiles` blocks move to the next file.
- `src/lib/org-portal/visible-tiles.test.ts` (new; mocks `server-only`, `@/lib/flags`, `@/lib/org-features`) — every existing `visiblePortalTiles` case re-pointed at the new module with the third argument; plus: the calendar tile shows when `isOrgFeatureEnabled` is true and no flag is on; hides when false; **hides (and does not throw) when the toggle read rejects**, with only ids logged; `isOrgFeatureEnabled` is never called for a tile an earlier filter excluded; "events" appears in `administer`, not `operate`.
- Component/page tests (jsdom, existing conventions): `calendar/page.test.tsx` (signed-out redirect keeps a canonical callback; four-way miss; `disabled`/`forbidden`/load-error states; empty states by case; manager links only with `canManage` **and** the flag), `calendar/[eventId]/page.test.tsx` (`notFound()` for `event: null`; `from` validated; no admin-only field rendered; Edit link only for managers with the flag), `month-grid.test.tsx` / `month-list.test.tsx` / `calendar-entry.test.tsx` (entries on their start day, icon + visible time + sr-only type name, today marker, no `text-xs` anywhere, today circle), `type-filter-pills.test.tsx` (All/selected/aria-current/hrefs/two renders), `month-nav.test.tsx` (carries types+view, Today drops month, edge months disabled), `copy-month-button.test.tsx` (**disabled before `useHydrated()` is true**; the click handler is synchronous — assert `navigator.clipboard.write` was called in the same tick with both MIME types; the four toast outcomes), `calendar-states.test.tsx`, `event-types/*.test.tsx`, `admin/events/types/page.test.tsx`, `event-type-form.test.tsx` (inside `HydrationGate`; the fallback's colour is read-only; duplicate-name message), `event-type-list.test.tsx` (the fallback's switch disabled with its reason; move buttons at the ends), `event-type-schema.test.ts`, and updates to `new-event-form.test.tsx`, `edit-event-form.test.tsx`, `event-schema.test.ts`, `admin/events/page.test.tsx`, `new/page.test.tsx`, `[eventId]/page.test.tsx`, `[eventId]/edit/page.test.tsx`, `layout.test.tsx`, `src/app/(org)/o/[slug]/page.test.tsx`, `admin/page.test.tsx`, `portal-nav.test.tsx`, `portal-footer.test.tsx`, `domain-tile-sections.test.tsx`, `org-feature-categories.test.ts` (their `visiblePortalTiles` mock moves to `visible-tiles` and gains the third argument; their `PortalTile` helpers satisfy the new union).

**DB-backed**
- `src/lib/calendar.test.ts` — the **gate matrix** (toggle off -> `disabled` even for a manager; on + no grant -> `forbidden`; `events.view` only -> ok `canManage:false`; `events.manage` only -> ok `canManage:true`; the `org_portal.feature_categories` axis ON with `worship` off -> `disabled`); **month bounds are half-open** (an event at `<lastGridDay>T23:59` is in, one at `<dayAfterLastKey>T00:00` is out; and one second before / after the first grid day) ; cancelled excluded; **non-public included** (members see it); untyped resolves to the fallback and **filters as it**; a retired-type event appears under All and under no filter; the type filter ignores another org's UUID; only-the-fallback and zero-types orgs render; `orgHasEvents`/`unfilteredInMonthCount` for the empty-state cases; `getMemberEvent` -> `event: null` for a garbage id, another org's id and a cancelled id **after** the gate, `forbidden` before any lookup, and the returned object's **exact key set**; **`listUpcomingMemberEvents`** — the upcoming set is a **subset of the calendar's default set** (every id it returns is in `getMonthCalendar` for that id's month with no filter), **a series whose parent has passed still yields its next child** (`seriesKey` = the parent's id, one row per series), "listed until its day ends" (an event at 10:30 on `today` is returned with `now` at 23:30 org time and absent at 00:30 the next org day), `limit` clamps (0 -> 1, 99 -> 12, `NaN` -> 1), the order is `(starts_at, id)`, cancelled excluded, non-public included. **Every one of these runs under the three process zones with injected `now` values chosen so the org-local day differs from the UTC day** (`2026-11-01T03:30:00Z` = Oct 31 evening in New York). Fixtures need `organization_settings` rows with explicit `time_zone` values (`America/New_York`, `Pacific/Honolulu`) and a fixture with **no** settings row (the default).
- `src/lib/event-types.test.ts` — permissions (`event_types.manage` only; `events.manage` alone is `forbidden`); create/update/retire/move/seed rules from the API section including the duplicate message via **both** the pre-check and a forced `23505` race, the fallback rules, neutral refused on create; and **the backfill-per-org-type assertion**: create fixture orgs of all five types, execute the SQL between the `backfill-event-types` markers in `drizzle/0054…sql` against them on the owner connection, and assert each org's rows equal `eventTypeSeedPlan(type)` (nine / one), then run it again and assert zero new rows; and **A2's cascade proof**: create a `deletableUntil` org that owns typed events, delete it on the owner connection, assert no `events`/`event_types` rows remain.
- `src/lib/events.test.ts` (modified) — `eventTypeId` on create, on every generated child, on `extendSeriesPattern` children; update: unchanged when omitted, cleared by `null`, a retired type already on the event is accepted, a **different** retired type is refused; refusal (`invalid_input` "That event type isn't available. Choose another.") for another org's type, a garbage string, and an inactive type on create; `getEvent` returns `eventType`; `getEventTypePickerData` (fallback excluded, retired current included flagged); the TZ case from the fix commit.
- `src/lib/org-provisioning.test.ts` (modified) — a created org has a settings row (`time_zone` default), a calendar toggle row `enabled: true`, event types equal to the plan for its type, and a `member` role holding **both** `directory.view` and `events.view`; the test's own teardown deletes the org and so re-proves the cascade.
- `src/lib/org-features.test.ts` (modified) — `orgFeatureEnabledInTx` agrees with `isOrgFeatureEnabled` across the existing axis cases, including the calendar key with the category axis on/off.

**E2E (`e2e/`, Playwright, running server)** — DECISION-157: this spec creates only its own rows (ids `e2ca…`, role keys `e2e_calendar_*`, titles `E2E …`) and removes them in `afterAll` on the owner connection (`platformSql`; the owner may delete `event_types` where `presby_platform` may not).
- `e2e/support/calendar-fixture.ts` — idempotent setup/teardown: the calendar toggle row for `e2e-alpha`; three types (`E2E Worship` teal, `E2E Study` sky, and the `General` fallback); events relative to `current_date` (typed, untyped, a weekly series, one non-public, one cancelled); roles `e2e_calendar_viewer` (`events.view`) and `e2e_calendar_manager` (`events.manage` + `event_types.manage`) granted to `org-single` and `congregation-clerk` for the duration of the spec; `org_portal.events` captured/set/restored with `e2e/support/flags.ts`.
- `e2e/member-calendar.spec.ts`: (1) **forbidden** — `org-single` with no grant sees the "isn't available to your account" copy, not a 403 or a blank; (2) after the grant, **1280px**: the grid `<table>` is visible with seven column headers, the list is hidden, today is marked, typed entries show icon + time + title, the **cancelled event is absent**, the **non-public one is present**; (3) **360px**: the grid is hidden and the list visible, the Month/List switch absent, **no horizontal overflow** (`document.documentElement.scrollWidth <= clientWidth`), and the `<details>` filter disclosure **opens on a click of its summary** (the phone-only defect class), shows the pills, tapping a type pill navigates to `?types=<id>`, the summary then reads "Filters: 1 active", only that type's entries remain, and a hard reload preserves it; (4) prev/next keep `types` and `view`, Today returns to the current month; (5) the detail link opens `/calendar/<id>?from=…`, shows the type, hides admin-only fields, and Back returns to the same month and filter; a cancelled id, another org's id and `not-a-uuid` all return the same 404; (6) **disabled** — flip the toggle off: "The calendar isn't turned on for Wrenfield Presbyterian Church yet." and the Calendar tile is gone from `/o/e2e-alpha`; (7) **empty month**: `?month=2000-01`; (8) as the manager: the **Add an event** link appears only with the flag on, the types page creates a type, rejects a duplicate with the exact message, and shows the fallback's switch disabled; (9) **Copy month** (Chromium, `context.grantPermissions(["clipboard-read","clipboard-write"])`): the button is enabled after hydration, the clipboard's text contains the heading and **excludes** the non-public title, and the toast reads "Calendar copied (1 members-only event left out)".
- `e2e/hydration/event-types-form.spec.ts` — the DECISION-159 pattern (`holdScripts`, `domcontentloaded`, control enablement as the signal): the manager's **Name** input and **Add event type** button are `disabled` while the JavaScript is held and the `fieldset[data-slot="hydration-gate"]` is `aria-busy`; after release a created type is **persisted** (assert with `platformSql`). Runs in both lanes (`npm run test:e2e:prod`).
- **Existing e2e blast radius: none asserts what this change alters.** A case-insensitive grep of `e2e/` for the word *event* finds no spec that names the Events tile, `/admin/events`, `org_portal.events`, `events.manage`, or an `events` table (the only hits are `audit_events`). `visual-parity.spec.ts` is opt-in (`PW_VISUAL=1`), not in CI, and self-comparing: `/o/e2e-alpha` has no calendar toggle row so it gains no tile, but if `org_portal.events` is on in the dev database the **Events tile leaves the home page for the admin hub**, so a `visual:check` taken across this change flags `/o/e2e-alpha` at both viewports — expected; re-baseline with `npm run visual:baseline`. The unit-level blast radius is the list at the end of the component-test bullet.

## Edge Cases & Risks

- **Reach of the `events.view` grant (F133).** `0054` binds `events.view` to org-owned `member` roles only: 2 of 15 orgs on the pipeline branch have one (both congregations), there is no template `member` role, and an org created before DECISION-100's provisioning seed or by fixture SQL has none. Those members see "The calendar isn't available to your account … ask your stated clerk" until a clerk grants a role the permission. **Before `0054` reaches production**, deployment-engineer counts production's org-owned `member` roles and `organization_settings` rows (read-only) — the calendar's real reach there is that number.
- **A toggle row only exists where something wrote it.** Fixtures and ad-hoc orgs read `disabled`; `e2e` and `seed-dev.sql` therefore write the row explicitly. A calendar that "doesn't work" on a new fixture org is this, not a bug.
- **The month-end evening.** On the last evening of a month the server's UTC date is already next month. Every "today" in this design is `todayInOrgZone(now, org zone)`; the three-zone tests with `now` chosen so the org day differs from the UTC day are the guard. A raw `new Date()` anywhere in `src/lib/calendar*` is a defect.
- **Wall-clock text, never a `Date`.** Times leave SQL as `to_char` text, are formatted from digits, and day keys are built from padded integers, never `toISOString().slice(0,10)`. `<FormattedDate>` and `toLocale*` are not used for event times. A DST-gap time (`02:30` on a spring-forward day) is stored as typed and displayed as typed — it is a label, not an instant.
- **Zone name mismatch.** Postgres tzdata and Node ICU can disagree about a rare zone. The CHECK keeps junk out; `orgTimeZoneInTx` falls back to the default and logs the org id if ICU refuses a stored name. The unknown-name error from Postgres may be `22023` rather than `23514`.
- **Filters are a set of ACTIVE types.** A bookmarked `?types=` that names a type since retired drops that id silently (and may then collapse to All). A *retired-type event* therefore shows under All but under no pill and under no active filter; the manager's microcopy and the release note say so. If that proves wrong in use, "treat a retired type's events as their own pill group" is a follow-up, not a v1 requirement.
- **An id from another org in `?types=` or the URL.** UUID-shaped but foreign ids are dropped by the intersection with the org's own active ids (not merely hidden by RLS), do not inflate "Filters: N active", and a foreign `eventId` is the same 404 as a missing one.
- **`?from=` is an open-redirect vector** — it is validated against a strict allow-list (own home or own calendar, bounded charset and length) and otherwise replaced by the hardcoded default; it is never reflected raw.
- **Hydration.** The Copy month button is disabled until `useHydrated()` is true; the manager's forms are inside `HydrationGate`; the filter pills are plain links so they work before hydration; the `<details>` needs no JavaScript.
- **iOS `<summary>`.** No `display` utility on the `<summary>`; verified on a phone viewport in Phase 5 (and a real iOS Safari if available).
- **Tailwind only finds literal class strings.** `TYPE_COLOR_CLASSES` is written out in full; `bg-category-${key}` would silently generate nothing. `type-palette.test.ts` asserts each string contains its key.
- **Duplicate DOM.** The grid and the list are both in the DOM and CSS decides which is shown (and the filter row renders twice). `display:none` removes the hidden copy from the accessibility tree; e2e must scope selectors to the visible copy.
- **Reordering** is last-write-wins (rare, admin-only); two admins moving types at once can interleave, and the result is still a valid order.
- **`events.view` without the toggle, and the toggle without `events.view`** are both ordinary: `disabled` and `forbidden` are different pages with different copy. A holder of `events.manage` but not `events.view` sees the calendar (R8) — the read gate reveals nothing the admin list does not already show them.
- **Two hierarchies.** A platform admin who is not a member of a congregation gets the existing four-way miss, not the calendar: nothing here consults `is_platform_admin`. A presbytery's `event_types.manage` administers the presbytery's own org only.
- **Performance.** The portal now makes one extra short transaction per request for the calendar tile (deduped by `cache()` across nav, footer and page); the calendar page runs about six statements in one transaction. The month query is served by `events_org_starts_idx`; the 1,500-row `limit` is a runaway guard, not an expected bound (a stored weekly series is about 4–5 rows a month).
- **Migration-time locks.** `ALTER TABLE events ADD COLUMN` (nullable) and `organization_settings ADD COLUMN … NOT NULL DEFAULT` are metadata-only on PG 18; the FK add validates only `NULL` columns on `events` and the CHECK add scans a table of ≤ 15 production-order rows. No long lock.
- **Stale mentions found while reading** (no action in this pipeline; both are on the TODO lines below): `scripts/test-rls.sql` section 44d's comment calls a *hypothetical* future `0054` the home of the F110 `people_user_id_unique_idx` — that number is now taken; and `docs/testing.md` says "51/51 migrations", which was stale before this pipeline and is 55 after it.

## Out of Scope (explicit non-goals — user to confirm)

- Rooms, bookings, the `kind` enum, meetings, group-meeting schedules, the kinds control and the room filter (Track A); the Google Calendar publish gate and the public `<fpcw-events>` feed; `events.is_public` on the public site (Increment 4); signups and RSVPs.
- Any change to recurrence semantics (stored rows, the 52-row cap, extend-forward-only). The existing "Jan 31 + 1 month" overflow quirk stays.
- Week and day views; **all-day events** (no column — 00:00 reads "12:00 AM"); multi-day spanning in the grid (an event shows on its start day only).
- **An audience tier below "all members"** (Session-only events). `is_public = false` means "members only", and every active member sees it; the release note says so and a TODO line tracks it.
- A time-zone admin UI (platform or org); the zone is set by SQL / a platform admin for now.
- Per-org tile labels (`PORTAL_LABEL` follow-up stays); `members` tile getting `orgFeatureKey` (S2); `isOrgFeatureEnabled` reading the catalog `flag` itself (S4); the admin `[eventId]` page 404-ing on a non-UUID (S5). S1 (the ESLint ban) and S3 (the hue-distance test) are **adopted** and are in scope.
- Showing event types on the admin events *list*; auditing type mutations (R7); a tenant audit reader.
- Editing an existing series' type as a whole (a type change is per occurrence).

## Drafts for integration (Rule 16 files and docs — the orchestrator pastes these before Phase 5)

All SQL blocks below were executed (see "Verified against the live tree").

### D1 — `drizzle/meta/_journal.json`

The entry in "Journal entry" above.

### D2 — `scripts/seed-dev.sql` (append directly before the final `commit;`)

A fresh database (CI, a new developer) runs migrations on an **empty** database, so `0054`'s backfills do nothing; this block puts the fixture in the state a migrated database is in, grants the demo clerk `event_types.manage`, and adds a small, date-relative calendar at Alder Creek. Verified: applied after the full existing seed; 16 events, 50 event types, 10 calendar toggles.

```sql
-- ---------------------------------------------------------------------------
-- APPENDED BLOCK - pipeline/member-calendar (docs/work-log/
-- 2026-10-14-member-calendar.md, Phase 3 "Drafts for integration"). Workflow
-- Rule 16: one clearly delimited block at the END of this file, directly ahead
-- of the final `commit;`. If a merge conflict appears here, keep ALL blocks:
-- append-only, none depends on another.
--
-- 1. Mirror of drizzle/0054's backfills for the organizations THIS file
--    created. CI runs migrations on an EMPTY database, so 0054's backfills
--    saw no organization and did nothing; a fresh fixture must end up in the
--    same state a migrated database does. All four statements are the
--    migration's own, verbatim and idempotent (on conflict / where not exists),
--    so running this file against an already-migrated database is also safe.
-- ---------------------------------------------------------------------------
insert into organization_settings (organization_id)
select o.id from organizations o
on conflict (organization_id) do nothing;

insert into organization_feature_toggles (organization_id, feature_key, enabled, updated_by)
select o.id, 'org_portal.calendar', true, null
  from organizations o
on conflict (organization_id, feature_key) do nothing;

insert into app_role_permissions (role_id, permission_key)
select r.id, 'events.view'
  from app_roles r
 where r.key = 'member' and r.organization_id is not null
on conflict (role_id, permission_key) do nothing;

insert into event_types (organization_id, name, color, icon, sort_order, is_active, is_fallback)
select o.id, v.name, v.color, v.icon, v.sort_order, v.is_active, v.is_fallback
  from organizations o
  join (values
    ('Worship',                       'teal',    'Church',         10, true,  false),
    ('Special Services and Holidays', 'violet',  'Sparkles',       20, false, false),
    ('Music',                         'fuchsia', 'Music',          30, false, false),
    ('Classes and Bible Study',       'sky',     'BookOpen',       40, true,  false),
    ('Youth and Children',            'lime',    'Backpack',       50, true,  false),
    ('Meals and Fellowship',          'amber',   'Utensils',       60, false, false),
    ('Mission and Outreach',          'rose',    'HeartHandshake', 70, false, false),
    ('Committees',                    'orange',  'Gavel',          80, true,  false),
    ('General',                       'neutral', 'CalendarDays',   99, true,  true)
  ) as v(name, color, icon, sort_order, is_active, is_fallback)
    on (v.is_fallback
        or o.organization_type in ('congregation', 'new_worshiping_community'))
 where not exists (select 1 from event_types et where et.organization_id = o.id)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. event_types.manage: NO default binding in production (DECISION-161).
--    This grant to stated_clerk (f0000000-...-0005, Tobias Renwick /
--    clerk.fixture@example.invalid) is a TEST-REACHABILITY CONVENIENCE ONLY,
--    the same posture as events.manage's own fixture grant above - not a
--    recommended default.
-- ---------------------------------------------------------------------------
insert into app_role_permissions (role_id, permission_key) values
  ('f0000000-0000-0000-0000-000000000005', 'event_types.manage')
on conflict (role_id, permission_key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Fixture events at Alder Creek, so the calendar shows something on a
--    fresh database. Dates are RELATIVE to the day the seed runs (the first of
--    the current month plus offsets), so the current month always has
--    entries; titles name no weekday for that reason. Ids are e9100000-... -
--    deliberately NOT e9000000-..., which scripts/test-rls.sql section 27
--    inserts inside a rolled-back transaction.
--
--    Exercises: a typed weekly series that spans the previous, current and
--    next months (10 stored rows, 1 parent + 9 children); typed single
--    events; one NON-PUBLIC event (members still see it - is_public is only
--    the public-site and Copy-month switch); one CANCELLED event (members
--    never see it); one event typed with a RETIRED type (visible under "All",
--    absent under any type filter); one UNTYPED event (renders as General).
-- ---------------------------------------------------------------------------
with base as (
  select (date_trunc('month', current_date)
          + (((7 - extract(dow from date_trunc('month', current_date))::int) % 7)
             * interval '1 day')
          - interval '14 days')::timestamp as first_service
)
insert into events
  (id, organization_id, title, location, starts_at, ends_at, is_public,
   parent_event_id, recurrence_pattern, recurrence_count, event_type_id)
select format('e9100000-0000-0000-0000-%s', lpad((100 + i)::text, 12, '0'))::uuid,
       '22222222-2222-2222-2222-222222222222'::uuid,
       'Sunday worship',
       'Sanctuary',
       b.first_service + (i * interval '7 days') + interval '10 hours 30 minutes',
       b.first_service + (i * interval '7 days') + interval '11 hours 45 minutes',
       true,
       case when i = 0 then null
            else 'e9100000-0000-0000-0000-000000000100'::uuid end,
       case when i = 0 then 'weekly' end,
       case when i = 0 then 10 end,
       (select id from event_types
         where organization_id = '22222222-2222-2222-2222-222222222222' and name = 'Worship')
  from base b, generate_series(0, 9) as i;

insert into events
  (id, organization_id, title, description, location, starts_at, ends_at,
   is_public, cancelled_at, event_type_id)
select v.id::uuid, '22222222-2222-2222-2222-222222222222'::uuid,
       v.title, v.description, v.location,
       date_trunc('month', current_date)::timestamp + v.starts_offset,
       case when v.ends_offset is null then null
            else date_trunc('month', current_date)::timestamp + v.ends_offset end,
       v.is_public,
       case when v.cancelled then now() end,
       (select id from event_types
         where organization_id = '22222222-2222-2222-2222-222222222222' and name = v.type_name)
  from (values
    ('e9100000-0000-0000-0000-000000000201', 'Bible study: the Gospel of Mark',
       'Open to everyone. Bring a Bible or borrow one at the door.',
       'Library',          interval '9 days 19 hours',  interval '9 days 20 hours 30 minutes',
       true,  false, 'Classes and Bible Study'),
    ('e9100000-0000-0000-0000-000000000202', 'Youth group pizza night',
       null,
       'Fellowship Hall',  interval '11 days 18 hours', interval '11 days 20 hours',
       true,  false, 'Youth and Children'),
    ('e9100000-0000-0000-0000-000000000203', 'Session stated meeting',
       'Members-only: not shown on the public website or in Copy month.',
       'Library',          interval '13 days 19 hours', interval '13 days 21 hours',
       false, false, 'Committees'),
    ('e9100000-0000-0000-0000-000000000204', 'Fellowship supper',
       null,
       'Fellowship Hall',  interval '19 days 18 hours', null,
       true,  true,  'Meals and Fellowship'),
    ('e9100000-0000-0000-0000-000000000205', 'Soup and sandwich lunch',
       'Typed with a retired event type: visible under All, absent under any filter.',
       'Fellowship Hall',  interval '21 days 12 hours', interval '21 days 13 hours 30 minutes',
       true,  false, 'Meals and Fellowship'),
    ('e9100000-0000-0000-0000-000000000206', 'Congregational picnic',
       'Untyped on purpose: renders and filters as General.',
       'Riverside Park',   interval '24 days 12 hours', interval '24 days 15 hours',
       true,  false, null)
  ) as v(id, title, description, location, starts_offset, ends_offset,
         is_public, cancelled, type_name);
```

### D3 — `scripts/test-rls.sql`

**(a) Three existing assertions must be narrowed**, because the seed now puts rows where they counted. Without these edits the unpatched suite fails at section 19 (`expected 1, got 2`) — observed. Exact edits:

```diff
--- section 19 (organization_feature_toggles)
-  select assert_eq((select count(*) from organization_feature_toggles), 1,
-                   'alder: sees its own toggle row');
+  select assert_eq((select count(*) from organization_feature_toggles where feature_key = 'org_portal.members_create'), 1,
+                   'alder: sees its own toggle row');
@@
-  select assert_eq((select count(*) from organization_feature_toggles), 0,
-                   'bramblewood: sees no alder toggle rows');
+  select assert_eq((select count(*) from organization_feature_toggles where feature_key = 'org_portal.members_create'), 0,
+                   'bramblewood: sees no alder toggle rows');

--- section 27 (events)
-    (select count(*) from events where organization_id = :ALDER),
-    1, 'alder: sees its own newly-inserted event');
+    (select count(*) from events where id = 'e9000000-0000-0000-0000-000000000001'),
+    1, 'alder: sees its own newly-inserted event');
```
**(b)** In section 44d's header, the sentence "Per Ruling 9's own instruction … 0054 is NOT shipped by this pipeline" names a migration number that is now this pipeline's; change the text to "the next free migration number" (comment only; nothing asserts on it).

**(c)** Append this section (verified: the whole file plus this section ran as `presby_app`, 0 failures; 39 of the passes are this section's):

```sql
-- ===========================================================================
-- APPENDED SECTION - pipeline/member-calendar (docs/work-log/
-- 2026-10-14-member-calendar.md, Phase 3 "Drafts for integration").
-- Workflow Rule 16: appended at the END of this file by the orchestrator at
-- integration. If another pipeline appended a section 45 first, renumber this
-- one; nothing below depends on the number.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 45. Member calendar + event types (drizzle/0054_presby_calendar_event_types.sql,
--     DECISION-160 / DECISION-161; scripts/seed-dev.sql's appended
--     pipeline/member-calendar block supplies every fixture row read here).
--
--     Seven things:
--       (a) the two permission-catalog rows (tier 1, no org column, readable
--           with no GUC set);
--       (b) event_types tenant isolation - FORCE RLS, cross-org reads return
--           zero by blanket query AND by known id, the WITH CHECK half rejects
--           a cross-org write;
--       (c) the grant shape is HALF the model: select/insert/update, never
--           DELETE, for presby_app AND presby_platform - and a real DELETE
--           attempt is refused;
--       (d) the table's own invariants: one fallback per org, a fallback is
--           active and neutral and nothing else is neutral, the closed palette
--           and icon lists, trimmed names, case-insensitive uniqueness;
--       (e) events.event_type_id is a COMPOSITE FK (F2): a type from another
--           org is refused even though RLS would hide it, and the delete
--           action is NO ACTION (confdeltype 'a'). The cascade-with-typed-
--           events proof needs an organization DELETE, which presby_app cannot
--           issue (SELECT only on organizations), so it lives in
--           src/lib/event-types.test.ts on the owner connection;
--       (f) organization_settings.time_zone - NOT NULL default, and the
--           two-clause CHECK refuses a POSIX string, a bare abbreviation and
--           an unknown name;
--       (g) the seed mirror reached the fixture: Alder Creek's calendar toggle
--           and member-role events.view are present and invisible to
--           Bramblewood, and the fixture events have their documented shape.
--
--     No block below writes durably: every one ends in rollback.
-- ---------------------------------------------------------------------------
\set CAL_SERIES_PARENT '\'e9100000-0000-0000-0000-000000000100\''

-- (a) the catalog rows. permissions has no organization_id and no RLS.
begin;
  select assert_eq(
    (select count(*) from permissions where key = 'events.view' and sensitivity_tier = 1),
    1, 'permissions: events.view catalog row exists, tier 1');
  select assert_eq(
    (select count(*) from permissions where key = 'event_types.manage' and sensitivity_tier = 1),
    1, 'permissions: event_types.manage catalog row exists, tier 1');
rollback;

-- (b) isolation.
begin;
  select assert_eq((select count(*) from event_types), 0,
                   'unset GUC: event_types invisible');
rollback;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq((select count(*) from event_types), 9,
                   'alder: sees its own nine event types (the standard congregation set)');
  select assert_eq((select count(*) from event_types where is_active), 5,
                   'alder: five of the nine are active (Worship, Classes and Bible Study, Youth and Children, Committees, General)');
  select assert_eq(
    (select count(*) from event_types
      where is_fallback and name = 'General' and color = 'neutral' and is_active),
    1, 'alder: exactly one fallback, General, neutral and active');
  select id::text as alder_type from event_types where name = 'Worship' \gset

  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq((select count(*) from event_types), 9,
                   'bramblewood: sees its OWN nine event types, not alder''s eighteen');
  select assert_eq(
    (select count(*) from event_types where id = :'alder_type'),
    0, 'bramblewood: cross-org read of alder''s event type by known id returns zero');
rollback;

begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  do $$
  begin
    insert into event_types (organization_id, name, color, icon)
    values ('22222222-2222-2222-2222-222222222222', 'Hijacked Type', 'teal', 'Church');
    raise exception 'FAIL - bramblewood wrote an event type into alder''s organization';
  exception when insufficient_privilege then
    raise notice 'pass  event_types tenant_isolation: cross-org write rejected';
  end $$;
rollback;

-- (c) FORCE RLS, the policy, and the grant shape.
begin;
  select assert_eq(
    (select count(*) from pg_class where relname = 'event_types' and relrowsecurity and relforcerowsecurity),
    1, 'event_types: row level security is ENABLED and FORCED (F1)');
  select assert_eq(
    (select count(*) from pg_policies
      where tablename = 'event_types' and policyname = 'tenant_isolation'),
    1, 'event_types: the standard tenant_isolation policy exists');
  select assert_eq(
    (select count(*) from (values
       (has_table_privilege('presby_app', 'event_types', 'SELECT')),
       (has_table_privilege('presby_app', 'event_types', 'INSERT')),
       (has_table_privilege('presby_app', 'event_types', 'UPDATE')),
       (has_table_privilege('presby_platform', 'event_types', 'SELECT')),
       (has_table_privilege('presby_platform', 'event_types', 'INSERT')),
       (has_table_privilege('presby_platform', 'event_types', 'UPDATE'))) v(b) where b),
    6, 'event_types: presby_app and presby_platform both hold select, insert, update');
  select assert_eq(
    (select count(*) from (values
       (has_table_privilege('presby_app', 'event_types', 'DELETE')),
       (has_table_privilege('presby_platform', 'event_types', 'DELETE'))) v(b) where b),
    0, 'event_types: NEITHER connection holds DELETE - a type is retired, never removed (DECISION-161)');
rollback;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    delete from event_types where name = 'Worship';
    raise exception 'FAIL - presby_app deleted an event type';
  exception when insufficient_privilege then
    raise notice 'pass  event_types: presby_app DELETE refused';
  end $$;
rollback;

-- (d) the table's own invariants.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    insert into event_types (organization_id, name, color, icon, is_fallback)
    values ('22222222-2222-2222-2222-222222222222', 'Second Default', 'neutral', 'Church', true);
    raise exception 'FAIL - a second fallback was accepted';
  exception when unique_violation then
    raise notice 'pass  event_types: a second fallback per org is refused (event_types_one_fallback_idx)';
  end $$;
rollback;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    update event_types set is_active = false where is_fallback;
    raise exception 'FAIL - the fallback was deactivated';
  exception when check_violation then
    raise notice 'pass  event_types: the fallback cannot be retired (event_types_fallback_active)';
  end $$;
rollback;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    update event_types set color = 'neutral' where name = 'Worship';
    raise exception 'FAIL - a non-fallback type took neutral';
  exception when check_violation then
    raise notice 'pass  event_types: neutral is reserved for the fallback (event_types_neutral_is_fallback)';
  end $$;
  do $$
  begin
    update event_types set color = 'teal' where is_fallback;
    raise exception 'FAIL - the fallback left neutral';
  exception when check_violation then
    raise notice 'pass  event_types: the fallback must stay neutral';
  end $$;
  do $$
  begin
    update event_types set color = 'chartreuse' where name = 'Worship';
    raise exception 'FAIL - a color outside the closed palette was accepted';
  exception when check_violation then
    raise notice 'pass  event_types: the palette is closed (event_types_color_allowed)';
  end $$;
  do $$
  begin
    update event_types set icon = 'Rocket' where name = 'Worship';
    raise exception 'FAIL - an icon outside the closed list was accepted';
  exception when check_violation then
    raise notice 'pass  event_types: the icon list is closed (event_types_icon_allowed)';
  end $$;
  do $$
  begin
    update event_types set name = ' Worship ' where name = 'Worship';
    raise exception 'FAIL - an untrimmed name was accepted';
  exception when check_violation then
    raise notice 'pass  event_types: names must be trimmed (event_types_name_shape)';
  end $$;
  do $$
  begin
    update event_types set name = 'GENERAL' where name = 'Worship';
    raise exception 'FAIL - a case-insensitive duplicate name was accepted';
  exception when unique_violation then
    raise notice 'pass  event_types: names are unique per org case-insensitively (event_types_org_lower_name_idx)';
  end $$;
rollback;

-- (e) events.event_type_id: composite FK, NO ACTION.
begin;
  select set_config('app.current_org_id', :BRAMBLE, true);
  select id::text as bramble_type from event_types where name = 'Worship' \gset
  select set_config('rls_test.bramble_type', :'bramble_type', true);
  select set_config('app.current_org_id', :ALDER, true);
  do $$
  begin
    -- RLS hides the type from alder, but the FK check is an RI query that
    -- ignores RLS: it is the COMPOSITE key (id, organization_id) that refuses.
    insert into events (organization_id, title, starts_at, event_type_id)
    values ('22222222-2222-2222-2222-222222222222', 'Cross-org typed event', now(),
            current_setting('rls_test.bramble_type')::uuid);
    raise exception 'FAIL - an event was typed with another organization''s event type';
  exception when foreign_key_violation then
    raise notice 'pass  events_event_type_fk: a cross-org event_type_id is refused (F2)';
  end $$;
rollback;

begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) from pg_constraint
      where conname = 'events_event_type_fk' and contype = 'f' and confdeltype = 'a'),
    1, 'events_event_type_fk: ON DELETE NO ACTION (not set null, not restrict) - DECISION-161');
  insert into events (id, organization_id, title, starts_at, event_type_id)
  values ('e9100000-0000-0000-0000-0000000009aa', :ALDER, 'RLS typed event', now(),
          (select id from event_types where name = 'Worship'));
  insert into events (id, organization_id, title, starts_at)
  values ('e9100000-0000-0000-0000-0000000009ab', :ALDER, 'RLS untyped event', now());
  select assert_eq(
    (select count(*) from events where id in ('e9100000-0000-0000-0000-0000000009aa','e9100000-0000-0000-0000-0000000009ab')
       and ((id = 'e9100000-0000-0000-0000-0000000009aa' and event_type_id is not null)
         or (id = 'e9100000-0000-0000-0000-0000000009ab' and event_type_id is null))),
    2, 'events: a same-org typed event and an untyped event are both accepted');
rollback;

-- (f) organization_settings.time_zone.
begin;
  select assert_eq(
    (select count(*) from information_schema.columns
      where table_name = 'organization_settings' and column_name = 'time_zone'
        and is_nullable = 'NO' and column_default like '%America/New_York%'),
    1, 'organization_settings.time_zone: NOT NULL, default America/New_York');
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) from organization_settings where time_zone = 'America/New_York'),
    1, 'alder: its settings row exists and reads the default zone');
  do $$
  begin
    update organization_settings set time_zone = 'UTC+5';
    raise exception 'FAIL - a POSIX time zone was accepted';
  exception when check_violation then
    raise notice 'pass  organization_settings_time_zone_valid: POSIX UTC+5 refused (Postgres would accept it, Intl would not)';
  end $$;
  do $$
  begin
    update organization_settings set time_zone = 'EST';
    raise exception 'FAIL - a bare abbreviation was accepted';
  exception when check_violation then
    raise notice 'pass  organization_settings_time_zone_valid: bare EST refused';
  end $$;
  do $$
  begin
    update organization_settings set time_zone = 'Nope/Zone';
    raise exception 'FAIL - an unknown zone was accepted';
  exception when check_violation or invalid_parameter_value then
    raise notice 'pass  organization_settings_time_zone_valid: unknown zone refused (check_violation or 22023, AND has no evaluation order)';
  end $$;
  update organization_settings set time_zone = 'America/Chicago';
  select assert_eq(
    (select count(*) from organization_settings where time_zone = 'America/Chicago'),
    1, 'organization_settings: a real IANA zone is accepted');
rollback;

-- (g) the seed mirror and the fixture shape.
begin;
  select set_config('app.current_org_id', :ALDER, true);
  select assert_eq(
    (select count(*) from organization_feature_toggles
      where feature_key = 'org_portal.calendar' and enabled),
    1, 'alder: the calendar toggle is ON (DECISION-160: explicit rows, on by default)');
  select assert_eq(
    (select count(*) from app_role_permissions
      where role_id = :MEMBER_ROLE and permission_key = 'events.view'),
    1, 'alder: the baseline member role holds events.view');
  select assert_eq(
    (select count(*) from events where parent_event_id = :CAL_SERIES_PARENT),
    9, 'alder: the weekly worship series has nine children under one parent');
  select assert_eq(
    (select count(*) from events where title = 'Fellowship supper' and cancelled_at is not null),
    1, 'alder: the fixture cancelled event exists');
  select assert_eq(
    (select count(*) from events where title = 'Session stated meeting' and not is_public),
    1, 'alder: the fixture non-public event exists');
  select assert_eq(
    (select count(*) from events where event_type_id is null and title = 'Congregational picnic'),
    1, 'alder: the fixture untyped event exists');

  select set_config('app.current_org_id', :BRAMBLE, true);
  select assert_eq(
    (select count(*) from app_role_permissions
      where role_id = :MEMBER_ROLE and permission_key = 'events.view'),
    0, 'bramblewood: cannot see alder''s member-role binding');
  select assert_eq(
    (select count(*) from events where parent_event_id = :CAL_SERIES_PARENT),
    0, 'bramblewood: cannot see alder''s series');
rollback;

\echo ''
\echo '======================================================'
\echo ' Section 45 (member calendar + event types) complete.'
\echo '======================================================'

-- ===========================================================================
-- END APPENDED SECTION - pipeline/member-calendar.
-- ===========================================================================
```

### D4 — `docs/TODO.md`

Replace Track A (line 33) with the version below (`event_types` leaves it), and add the Done line and the open lines. Dated lines are 2026-10-14.

```markdown
- [ ] **Track A — groups & calendar schema.** `groups` (hierarchy w/ composite FK + cycle guard, activation, privacy, guests, Google columns, Drive link), **`group_meeting_schedules`** (retires free-text `groups.meetsWhen`; reuse `src/lib/events/recurrence.ts`), `group_guests`, `group_sync_jobs`, `group_on_call_shifts` + rotation, `rooms`, `events` sync columns. *(`event_types` was split out and shipped with the member calendar — see Done.)*
```
Done (top of the Done section):
```markdown
- [x] **Member calendar + event types** (2026-10-14, v0.32.0) — `/o/<slug>/calendar` (month grid at md+, day list always on phones, URL-shareable month/types/view), member event detail, Copy month, per-org `event_types` (closed palette + icons, one neutral fallback, never deleted) with a manager at `/admin/events/types`, new `events.view` (granted to every baseline `member` role) and `event_types.manage` permissions, per-org toggle `org_portal.calendar` (no platform flag, ON as explicit rows), `organization_settings.time_zone`, the categorical `--category-*` token family, and the `fix(events)` wall-clock writer correction (F134). Migration 0054, DECISION-160/161, F132–F135. — `docs/work-log/2026-10-14-member-calendar.md`
```
Open lines (Next Up):
```markdown
- [ ] **F133 — `events.view` reaches only orgs that have a `member` role.** 2 of 15 orgs on the pipeline branch; there is no template `member` role. Orgs created before DECISION-100's provisioning seed, or by fixture SQL, have neither `directory.view` nor `events.view` for ordinary members. Pre-existing gap the calendar exposes. **Before 0054 ships to production:** deployment-engineer counts production's org-owned `member` roles and `organization_settings` rows (read-only). — F133, `docs/work-log/2026-10-14-member-calendar.md`
- [ ] **Audience tier below "all members" for events.** `is_public = false` means "members only" and every active member sees it on the calendar; a Session-only (or committee-only) event cannot be expressed. Needs a design (group-targeted visibility, `tags` "event targeting" per `docs/schema-design.md`), not a column. — member-calendar Phase 1 G1
- [ ] **Org time-zone UI.** `organization_settings.time_zone` has no editor; a platform admin sets it by SQL. Add a platform-admin field and (later) an org-admin one; make the greeting consume `todayInOrgZone`. — DECISION-160
- [ ] **S2: give the `members` tile `orgFeatureKey: "org_portal.members_create"`** so it stops showing (and leading to a "turned off" page) when the org toggle is off. — member-calendar Phase 2 S2
- [ ] **S4: have `isOrgFeatureEnabled` read the catalog entry's `flag` itself** so call sites stop re-implementing the flag -> toggle -> permission order. — member-calendar Phase 2 S4
- [ ] **S5: the admin `[eventId]` page should 404 on a non-UUID id** instead of rendering "We couldn't load event records" (`events.ts` `getEvent` + `admin/events/[eventId]/page.tsx`). The member route already does. — member-calendar Phase 2 S5 / Phase 1 G7
- [ ] **Event types are not audited** (DECISION-161). Revisit when the tenant audit reader (DECISION-067) ships. — DECISION-161
- [ ] **Calendar v1 non-goals worth a look after real use:** all-day events, multi-day events spanning cells, week/day views, retired-type events (visible under All, under no filter), per-org tile labels. — member-calendar Out of Scope
- [ ] **`visual:baseline` after the Events tile moved to the admin hub.** A `visual:check` across v0.32.0 flags `/o/e2e-alpha` when `org_portal.events` is on; re-baseline. — member-calendar Phase 3
- [ ] **Doc drift found in passing:** `docs/testing.md` says "51/51" migrations (55 after 0054); `scripts/test-rls.sql` section 44d's comment names a hypothetical `0054`. Fold into the next documentation review. — member-calendar Phase 3
```
(S1 and S3 were adopted and shipped in this pipeline, so they have no TODO line.)

### D5 — `docs/ui-standards.md` (Colour and Tokens)

Add to the **platform** row of the token table: ``…, the categorical `--category-<key>` / `--category-<key>-foreground` pairs (nine keys), …``, and this paragraph after the `border` vs `border-input` section:

```markdown
**Category colours (event types).** A fourth family of platform tokens: `--category-<key>` (the tint) and `--category-<key>-foreground` (the ink) for nine closed keys — rose, orange, amber, lime, teal, sky, violet, fuchsia, and neutral (reserved for an organization's default event type). They are `platform` with a `categorical` marker in `TOKEN_POLICY`, so no organization's brand can re-declare them, and `CATEGORY_PAIRS` in `src/lib/brand/contract.ts` proves, in both colour schemes, ink on tint at 7:1 and ink on `--background` and `--card` at 3:1. Use them through the static map in `src/lib/events/type-palette.ts` (`bg-category-teal text-category-teal-foreground border-l-category-teal-foreground`) — never build the class name from the key, because Tailwind only finds literal strings. A category colour never carries meaning alone: pair it with an icon and a visible or screen-reader name, and a 4px ink rule so it survives a black-and-white print. They are **not** the status colours; `--success`, `--warning` and `--info` remain reserved and the status-chip gap stays open.
```

### D6 — release-note draft (`docs/release-notes/v0.32.md`, version 0.32.0; the `/release-notes` skill writes the file at Phase 6)

```markdown
### A shared calendar for every member, with color-coded event types

**Background:** Until now the only way to see an organization's events was the administrators' events screen, and nobody had permission to open it by default — a member who tapped Events reached a page telling them so. There was also no way to tell kinds of events apart at a glance.

**Changes:**
- A **Calendar** now appears in the portal. It shows one month at a time — a grid on a computer, a day-by-day list on a phone — with Previous, Next and Today, and every view has its own web address you can bookmark or share. Tapping an event opens its details: when, where, what, and what kind of event it is.
- Events can have a **type** (Worship, Classes and Bible Study, Youth and Children, Committees and more). Each type has a color, an icon and a name, so nobody has to tell colors apart to read the calendar. Filter by type with the buttons above the calendar; on a phone they fold behind a "Show filters" button.
- **Copy month** puts the month on your clipboard as a table you can paste into a newsletter or a word processor, and as plain text. It leaves out events marked "not public" and cancelled events, and tells you how many it left out.
- People who hold the new **Manage event types** permission can add, rename, recolor, reorder and retire types. Retiring a type never changes the events that already have it. Nobody holds this permission by default.
- The event forms have a new **Event type** choice, and the "Visible on the public calendar" checkbox now says plainly what it does.
- Administrators' old **Events** tile is now **Manage events**, on the Administration page.
- Also fixed: the time you type for an event is now always stored exactly as typed, whatever the server's time zone. No existing event changes.

**What to know:**
- **Every member is now given calendar access automatically.** A new permission, *View the calendar* (read-only, the same kind as viewing the directory), has been added to the baseline "Member" role of every organization that has one. An organization that has no Member role is not reached, and a stated clerk there needs to grant it.
- **An event marked "not public" is still visible to every member of the organization on this calendar.** "Not public" keeps it off the public website and out of Copy month; it does not mean "leaders only". There is no way yet to show an event to the Session alone.
- The calendar is **switched on for every organization**. An organization's administrators can switch it off under Features; there is no single switch to turn it off for everyone at once.
- "Today" follows the organization's own time zone, Eastern for every organization at first; a platform administrator can set a different one. There is no screen for it yet.
- Changes to event types are not recorded in the audit log.
- An event whose type has since been retired still shows in that type's color when no filter is on, but disappears when a type filter is on.
- An event at midnight shows as "12:00 AM", and an event that runs over several days appears only on the day it starts.
```

### D7 — `docs/product/functionality-map.md`

Index (replace the `presby: events` bullet's tail, keep its history) — append: ``**Increment 3 (v0.32.0, DECISION-160/161):** member calendar at `/o/<slug>/calendar` (month grid / day list, URL-shareable filters, member event detail, Copy month), per-org `event_types` with a manager at `/admin/events/types`, `events.view` (baseline `member` role) and `event_types.manage`, per-org toggle `org_portal.calendar` (no platform flag), `organization_settings.time_zone`. `src/lib/calendar.ts`, `src/lib/event-types.ts`.`` Full map (after the "Events administration" bullet): 

```markdown
- Member calendar — `/o/<slug>/calendar` (`events.view` or `events.manage`, per-org toggle `org_portal.calendar`, ON by default, no platform flag): one month at a time (grid at md+, day list always on phones; `?month=YYYY-MM&types=…&view=list`, every state a shareable URL), event-type filter pills (an untyped event filters as the default type; retired types are not filters), cancelled events hidden, non-public events shown to members, member-shaped event detail at `/calendar/<id>`, and **Copy month** (HTML table + plain text, synchronous clipboard write; leaves out non-public and cancelled events and says how many). "Today" and "upcoming" are read in `organization_settings.time_zone` (default America/New_York), never by converting a stored event time. `src/lib/calendar.ts` (also exports `listUpcomingMemberEvents` for the portal home), `src/lib/calendar/`, `src/app/(org)/o/[slug]/calendar/`, `docs/work-log/2026-10-14-member-calendar.md`.
- Event types — `/o/<slug>/admin/events/types` (`event_types.manage`, no default role; `org_portal.events`): per-org types with a closed 9-key palette and 15-icon list, one neutral fallback ("General", always active, never retired), names unique per org, retire not delete, reorder, "Add the standard event types"; seeded by org type (congregations get nine, presbyteries/synods/GA the default only). The event forms gain an optional Event type picker. Not audited (DECISION-161). `src/lib/event-types.ts`, `src/components/org-portal/event-types/`.
```
The portal IA bullet's tile sentence also changes: the Events tile is now "Manage events" on the admin hub and a new operate-side Calendar tile is gated by the org toggle (a tile may now carry `orgFeatureKey` instead of `flagKey`).

### D8 — what's new (`/admin/whats-new`, per Rule 13)

Member-visible behaviour ships, so publish one entry: **Title** "A calendar for everyone in {your church}" — **Body** "The portal now has a Calendar. See the month at a glance, filter by kind of event, open an event for the details, and copy the month into your newsletter. Look for **Calendar** on your home page." Publish only after the calendar is confirmed on for the target organization.

### D9 — decisions, CLAUDE.md, architecture

- **`docs/decisions.md`**: record the architect's DECISION-160 and DECISION-161 verbatim, and the implementation entries below. I was pre-assigned no number for them, so **please assign the next free numbers** (they are tech-lead-owned implementation entries; I have not claimed any).
  1. *Event-type palette and schema choices.* `neutral` is reserved for the fallback in both directions by one CHECK; the nine colour keys and fifteen icon names are a closed list duplicated in `drizzle/0054`, `type-palette.ts` and (derived) the Drizzle domain file, with the domain file importing the zero-runtime-import palette module so there is one TypeScript source; `type-palette.test.ts` reads the migration and pins all three.
  2. *The calendar read module.* Gate, visibility predicate and projection are private to `src/lib/calendar.ts` and shared by `getMonthCalendar`, `getMemberEvent` and `listUpcomingMemberEvents`; times leave SQL as `to_char` text; month bounds are half-open on bound `'YYYY-MM-DD'` text; untyped events resolve to the fallback row in SQL so rendering and filtering cannot disagree; a type filter is a set of *active* types; "upcoming" is `starts_at >= org-local today 00:00` (an event stays listed until its day ends) with one row per series; the filter `IN (…)` list is built with `sql.join`, never `= any(array)`.
  3. *Placements.* A1 (`eventTypeSeedPlan` in a pure module, re-exported from `org-provisioning.ts`) and A2 (the NO ACTION cascade proof is a DB-backed test, not a `presby_app` RLS assertion).
  4. *Wall-clock discipline made mechanical.* The events writer and recurrence math use `Date` through UTC fields only; S1's scoped ESLint block bans local getters/setters/constructors in those paths; every time-dependent unit test runs under UTC, America/New_York and Pacific/Honolulu through `useProcessTimeZone`; S3's 30° ink-hue floor is a contract test.
  5. *The tile gate.* `visiblePortalTiles` takes a required `viewer`; flag(s) then org toggle; a toggle-read failure hides the tile and logs ids only.
- **`CLAUDE.md`**: no change required (architect). If wanted, one line under *Permissions vs Flags*: "A catalog entry may be toggle-only (`flag: null`); see DECISION-160."
- **`docs/architecture.md`**: no change recommended — nothing here is a new subsystem, data flow or runtime shape (Rule 15's bar).

## Verification recipe for QA (Phase 5)

1. **Apply and re-apply** `drizzle/0054…sql` to the pipeline branch twice (idempotency), then **re-read the live catalog, not just `drizzle/`**: `relforcerowsecurity` on `event_types`; `pg_policies` for `tenant_isolation`; `aclexplode(relacl)` shows no DELETE for `presby_app` or `presby_platform`; `pg_constraint.confdeltype = 'a'` on `events_event_type_fk`; the six `event_types_*` CHECKs, `organization_settings_time_zone_valid`, and both partial/unique indexes present; `npm run check:schema-parity` shows 0 failing.
2. **From-empty rehearsal** (`docs/testing.md`, against a throwaway database, never a shared branch's own — the password-rotation warning there applies): all migrations -> `check:schema-parity` -> `db:seed` -> `seed-dev.sql` with D2 -> `install-test-helpers.sql` -> **`scripts/test-rls.sql` as `presby_app` with D3 applied**. Expect exit 0. (Reference: 678 passes with section 45 in this design's own rehearsal.)
3. **Time zones**: `npm run test` and `npm run test:db` under each of `TZ=UTC`, `TZ=America/New_York`, `TZ=Pacific/Honolulu` (the suites also flip the zone themselves; running them under each default catches a test that forgot to).
4. **Browser** (CLAUDE.md → Verify in a Browser; a 200 is not a working page): `/o/<slug>/calendar` at **360px and 1280px**, light and dark, with a brand-coloured org and a `light_only` org (category colours must stay the platform values and show the light values in dark mode); the `<details>` filters opened by tap; tab order and focus rings; 200% zoom; **print preview** in black and white; the month nav at the 2000-01 and 2100-12 edges; the Copy month paste into a word processor and a plain-text editor.
5. **Full e2e on a running dev server** and `npm run test:e2e:prod` (the new hydration spec runs in both lanes). This feature does not touch `src/auth.ts`, `(auth)`, `api/auth` or `src/lib/auth`, so the MFA-login gate does not apply; the existing MFA specs must still pass.
6. **Feature-gate audit** (read the bodies, do not infer from green tests):

| Route or action | `auth()` present? | Gate present? | Key |
|---|---|---|---|
| `GET /o/<slug>/calendar` | yes (`cachedAuth`) | toggle `org_portal.calendar` + `events.view` OR `events.manage` inside `getMonthCalendar` | n/a (permissions are catalog rows) |
| `GET /o/<slug>/calendar/<eventId>` | yes | same, in `getMemberEvent`, **before** any lookup | n/a |
| `GET /o/<slug>/admin/events/types` | yes | flag `org_portal.events` + `event_types.manage` in `listEventTypes` | `event_types.manage` |
| `createEventTypeAction` … `seedStandardEventTypesAction` (5) | yes (`auth()`) | `event_types.manage` checked first inside each `src/lib/event-types.ts` function | `event_types.manage` |
| `createEventAction`, `updateEventAction` (type id passed through) | yes | `events.manage` (unchanged) + the type pre-check | `events.manage` |
| `listUpcomingMemberEvents` (consumed by the home pipeline) | caller | toggle then gate then query, one transaction | n/a |

## Implementation decisions needing numbers

See D9 — five implementation entries, numbers requested from the orchestrator. The architect's DECISION-160/161 and F132–F135 are unchanged; **no new F-number is claimed**.

**Orchestrator assignment (2026-10-14):** the five D9 implementation entries are **DECISION-163** (palette and schema choices), **DECISION-164** (the calendar read module), **DECISION-165** (placements A1/A2), **DECISION-166** (wall-clock discipline made mechanical), **DECISION-167** (the tile gate), in D9's order. DECISION-162 belongs to `2026-10-14-portal-home-alignment`. Recorded in `docs/decisions.md` at integration (commit 7).

## Implementer

**Four implementer agents plus the orchestrator, in the order of the commit table**, because the work crosses all four of the Phase 4 selection categories (schema, server logic, client, and small-and-coupled) and splitting it any further would leave `tsc` red between commits:

- **api-developer** — commit 1 (`fix(events):`) and commit 4 (`feat(calendar):` data layer): wall-clock codec, recurrence, S1, `org-time`, `org-settings`, `org-features`, `org-provisioning`, `calendar/*`, `calendar.ts`, `event-types.ts`, `events.ts`, the types `actions.ts`.
- **ux-developer** — commit 2 (`feat(brand):` tokens and palette) and commit 6 (`feat(calendar):` UI, forms, e2e).
- **database-admin** — commit 3 (`feat(schema):`): the migration, the Drizzle mirrors, `type-seed-plan.ts`, the dev-docs invariant, the schema-pin test.
- **full-stack-developer** — commit 5 (`feat(portal):`): the tile registry, `visible-tiles.ts` and its five callers.
- **orchestrator** — commit 0 (`style(site):`) and commit 7 (integration, D1–D9) before Phase 5.

Handoff: **api-developer starts with commit 1** (`fix(events):`, independent of everything) and **ux-developer with commit 2** (`feat(brand):`) — these two touch disjoint files and may run in parallel. **database-admin's commit 3 needs commit 2 merged first** (the domain file imports `type-palette.ts`), then 4, 5, 6 in order. The home pipeline (`2026-10-14-portal-home-alignment`) is unblocked for its Phase 3 by the contract in "Cross-pipeline contract" and for Phase 4 by this pipeline's merge.

---

# Phase 4 — Implementation

## Commit 1 — `fix(events): store typed event times as typed, whatever the server's time zone` (R3 / F134) — api-developer, 2026-10-14

### Failing first

`src/lib/events/wall-clock.ts` was first created as a verbatim move of the old LOCAL-field `parseWallClock`/`formatWallClock` (so the test had something to import and the run measured the *current behaviour*), the regression test was written against it, and run. `useProcessTimeZone` flips `process.env.TZ` inside the process, so one run exercises all three zones regardless of the outer `TZ=` (runs under `TZ=UTC`, `TZ=America/New_York` and `TZ=Pacific/Honolulu` gave identical results: 5 failed | 7 passed). UTC passes; both non-UTC zones fail:

```
 FAIL  wall-clock codec under TZ=America/New_York (F134) > stores the typed digits ... regression for typed event times shifting off-UTC
AssertionError: expected '2026-10-14T23:00:00.000Z' to be '2026-10-14T19:00:00.000Z'
 FAIL  wall-clock codec under TZ=America/New_York (F134) > round-trips through the driver's own read, including a nonexistent and a doubled local time
AssertionError: expected '2026-03-08T03:30:00' to be '2026-03-08T02:30:00'
 FAIL  wall-clock codec under TZ=America/New_York (F134) > a weekly series across the US DST end keeps the same digits (the F134 drift) ...
AssertionError: expected [ '2026-10-25T23:00:00.000Z', ...(2) ] to deeply equal [ '2026-10-25T19:00:00.000Z', ... ]
 FAIL  wall-clock codec under TZ=Pacific/Honolulu (F134) > stores the typed digits ...
AssertionError: expected '2026-10-15T05:00:00.000Z' to be '2026-10-14T19:00:00.000Z'
 FAIL  wall-clock codec under TZ=Pacific/Honolulu (F134) > a weekly series across the US DST end keeps the same digits (the F134 drift) ...
AssertionError: expected [ '2026-10-26T05:00:00.000Z', ...(2) ] to deeply equal [ '2026-10-25T19:00:00.000Z', ... ]
 Tests  5 failed | 7 passed (12)
```

The DB-backed case in `events.test.ts` was also run against the old writer (old `recurrence.ts` plus the local-field `wall-clock.ts` swapped back in, restored after) and failed as designed:

```
 x a single event stores the typed 19:00, not the UTC-shifted 23:00
   AssertionError: expected [ '2026-10-14 23:00:00' ] to deeply equal [ '2026-10-14 19:00:00' ]
 x a weekly series across the US DST end stores 19:00 on every occurrence
   AssertionError: expected [ '2026-10-25 23:00:00', ...(2) ] to deeply equal [ '2026-10-25 19:00:00', ... ]
 Tests  2 failed | 28 passed (30)
```

### After the fix

| Run | Result |
|---|---|
| `src/lib/events/` unit tests under outer `TZ=UTC` / `America/New_York` / `Pacific/Honolulu` | 3 files, 109 passed in each |
| DB-backed `events.test.ts` + `recurrence.test.ts` + `wall-clock.test.ts`, `--no-file-parallelism`, outer `TZ=UTC` / `America/New_York` / `Pacific/Honolulu` | 3 files, 129 passed in each |
| `npm run typecheck` | clean |
| `npm run lint` (`--max-warnings=0`) | clean on the whole tree with the S1 block in place |
| S1 probe (scratch `src/lib/events/scratch-probe.ts`, deleted afterwards) | 4 errors: multi-arg `new Date(...)`, `getHours()`, `getTimezoneOffset()`, and `toLocaleString()` (the repeated `toLocale*` selector still fires) |
| `npm run check` (all six tripwires incl. `check:audit`, `check:sql-date`) | all passed |
| `npm test` | 269 files passed, 35 skipped; 3625 tests passed, 934 skipped, 0 failed |

## Files Created

- `src/lib/events/wall-clock.ts` - `WALL_CLOCK_RE`, `parseWallClock` (`Date.UTC`), `formatWallClock` (`getUTC*`); the one place a typed string becomes a `Date` and back. Header records the root cause.
- `src/lib/events/wall-clock.test.ts` - the failing-first F134 regression, `describe.each` over three zones, asserting at the driver boundary (`toISOString()` / `+ "+0000"`).
- `src/lib/testing/time-zone.ts` - `useProcessTimeZone(tz, { beforeAll, afterAll })` (throws if the override did not take) and `TEST_TIME_ZONES`.

## Files Modified

- `src/lib/events/recurrence.ts` - `getNthDayOfMonth`/`getNextOccurrence` use `Date.UTC`, `getUTC*`, `setUTC*` (the design's diff, applied verbatim).
- `src/lib/events/recurrence.test.ts` - 18 `new Date(2026, ...)` became `new Date(Date.UTC(2026, ...))`, 12 local getters became `getUTC*`; whole file wrapped in the three-zone `describe.each`.
- `src/lib/events.ts` - private `parseWallClock`/`formatWallClock`/`WALL_CLOCK_RE` removed, imported from `@/lib/events/wall-clock`; the header paragraph that claimed LOCAL getters were the discipline is rewritten.
- `src/lib/events.test.ts` - new `describe` under `useProcessTimeZone("America/New_York")`: a single event and a 3-occurrence weekly series across 2026-11-01 are read back raw with `to_char(starts_at, ...)` on the owner connection and must hold `19:00:00`; adds the `events` table dynamic import and `inArray`.
- `eslint.config.mjs` - S1 `no-restricted-syntax` block (the designed selectors and file scope; tests excluded; `toLocale*` selector repeated).

## Schema Changes

- none. (No stored value changes: this branch has 0 `events` rows; production's were written on Vercel, which runs UTC.)

## Audit Events

- none (event create/edit/cancel is content configuration, DECISION-113 ruling 5; this commit changes no mutation's shape).

## Implementer Notes

- No deviation from the design; no Escalation to Phase 3. Two details inside the design's intent: (a) the S1 comment cites DECISION-166 (the number the orchestrator assigned to "wall-clock discipline made mechanical") where the design text had a placeholder; (b) the duration arithmetic in `createEvent`/`extendSeriesPattern` (`new Date(date.getTime() + durationMs)`) is untouched and is now correct across DST too, because both ends are UTC-field carriers.
- `recurrence.test.ts` is wrapped as a whole, per the design, so the pure-string cases (`parsePattern` etc.) also run 3x; harmless.
- An earlier `npm test` run in this session had one failure, `(public)/site/[slug]/[[...path]]/page.test.tsx` expecting `"Our Directory"`, caused by commit 0's then-uncommitted `PORTAL_LABEL` edit; commit 0 (651f069) updated the test and the final run is green.
- `useProcessTimeZone` changes the zone for the whole worker process while its `describe` is active; vitest runs a file's tests serially so this is safe, and `afterAll` restores `TZ`.

### Commit 1 file list (for `git add` by path)

```
eslint.config.mjs
src/lib/events.ts
src/lib/events.test.ts
src/lib/events/recurrence.ts
src/lib/events/recurrence.test.ts
src/lib/events/wall-clock.ts
src/lib/events/wall-clock.test.ts
src/lib/testing/time-zone.ts
```

The work-log (`docs/work-log/2026-10-14-member-calendar.md`) is the orchestrator's to commit. Not in commit 1: `docs/work-log/2026-10-14-portal-home-alignment.md` and anything under `src/lib/events/type-palette*`, `src/lib/brand/`, `src/app/globals.css` (commits 0 and 2).

*Handoff:* api-developer's next is commit 4 (`feat(calendar):` data layer), after commit 3 (schema) lands.

## Commit 2 — `feat(brand): add the categorical event-type colour family` (ux-developer, 2026-10-14)

Implemented exactly as the Phase 3 diffs (contract.ts, globals.css, type-palette.ts) record; no deviation, no escalation to Phase 3.

**Ratios (computed by `contrastRatio` in `contract.test.ts`, 54 measurements, all pass):** weakest body pair (ink on tint, floor 7:1) is rose/dark 7.51; weakest non-text pair (floor 3:1) is teal/light 8.48 on background and card. Identical to the design's table. S3 hue-distance floor 30 degrees passes in both schemes (design: min 34.1 light, 35.2 dark; the test computes it from the final hex).

**Tests added**
- `src/lib/brand/contract.test.ts` group (d): every `CATEGORY_PAIRS` entry x both schemes; each of 9 keys has exactly its three pairs; `categorical`-marked tokens equal the CATEGORY_KEYS set and are all `platform`; family absent from `ROLE_TO_TOKEN`/`LEGAL_PAIRS`; globals.css `:root`, `.dark` and `@theme inline` mappings present; S3 pairwise OKLCH hue distance. The existing two-way closure and `transcribes PLATFORM_TOKENS` tests cover the new tokens unchanged.
- `src/components/brand/brand-tokens.test.tsx`: ordinary emission never contains `--category-`; `light_only` pins them to light values (the design's stated consequence).
- `src/lib/events/type-palette.test.ts` (10 tests; no migration-parity case, lands with commit 3): colours = CATEGORY_KEYS, neutral not selectable, 15 unique icons each exported by the installed lucide-react, labels complete, class map literal and non-interpolated, guards and neutral fallback.

**Results:** `npm run typecheck` clean; `npm run lint` clean; `npm run check` all six tripwires pass (brand-scope included); `npx vitest run src/lib/brand src/components/brand src/lib/events/type-palette.test.ts` all green; `npm test`: 3624 passed, 1 failed, and the one failure is NOT commit 2: `src/app/(public)/site/[slug]/[[...path]]/page.test.tsx` "passes getPublishedSite()'s own pages..." fails against the uncommitted commit-0 edit to `page.tsx` (`PORTAL_LABEL` "Our Portal"); the orchestrator should update that test with commit 0. No `next build` run (typecheck and tests left no doubt); browser check belongs to commit 6.

**Note on the lucide static import map:** the spec places the `Record<EventTypeIcon, LucideIcon>` map in `event-type-icon.tsx` (commit 6), so it is not in this commit; commit 2 instead pins every icon name to an actual lucide-react export in `type-palette.test.ts`.

**Commit 2 file list (`git add` by path)**
- `src/lib/brand/contract.ts`
- `src/lib/brand/contract.test.ts`
- `src/app/globals.css`
- `src/components/brand/brand-tokens.test.tsx`
- `src/lib/events/type-palette.ts`
- `src/lib/events/type-palette.test.ts`

Trailers: `Work-Log: 2026-10-14-member-calendar`. Next: database-admin, commit 3 (imports `type-palette.ts`).

## Commit 3 — `feat(schema): event types, event_type_id, org time zone (0054)` (database-admin, 2026-10-14)

Implemented as the Phase 3 "Data Model" records it. The migration file is the design's SQL block **byte-for-byte** (extracted mechanically from this work-log, not retyped); the Drizzle mirrors are the design's diff plus one stale-comment correction (Implementer Notes). No escalation to Phase 3 (see the end of this section).

### Files Created

- `drizzle/0054_presby_calendar_event_types.sql` — `event_types` (FORCE RLS, `tenant_isolation`, SELECT/INSERT/UPDATE and no DELETE for `presby_app`/`presby_platform`, five CHECKs, two unique indexes), `events.event_type_id` + composite NO ACTION FK `events_event_type_fk` + `events_org_type_idx`, `organization_settings.time_zone` + `organization_settings_time_zone_valid`, and the four idempotent backfills (settings rows, the two permission rows, `events.view` on org-owned `member` roles, `org_portal.calendar` toggle rows, `event_types` per org type).
- `src/lib/events/type-seed-plan.ts` — pure `eventTypeSeedPlan(organizationType)`, `STANDARD_EVENT_TYPES`, `FALLBACK_EVENT_TYPE`, `EventTypeSeed` (amendment A1). `OrganizationType` is a type-only import from `@/lib/authz` (erased; no `server-only` reaches the module). The arrays are frozen. Commit 4 adds the re-export in `org-provisioning.ts`.
- `src/lib/events/type-seed-plan.test.ts` — 18 tests: exactly one fallback, neutral and active; neutral iff fallback; names trimmed, 1–60 chars, unique case-insensitively; the eight non-fallback colours are the eight selectable ones, each used once; sort order strictly ascending; the exact nine-row table from "The standard type set"; frozen; per-org-type plans (congregation/NWC get nine, presbytery/synod/GA get the fallback only); every plan satisfies the constraint set.
- `src/lib/db/domain/events.schema.test.ts` — the schema pin (11 tests). It **parses `drizzle/0054` for every `add constraint` / `create index` / inline `constraint` name**, asserts the parser finds exactly the design's list (so the parse can't pass vacuously), and asserts each name is declared on the matching Drizzle table (`event_types`, `events`, `organization_settings`). Shape checks: the fallback index is a partial unique index on `organization_id`, the lower-name index is unique with no `where` (so retired names stay reserved), `event_types_id_org_key` is `(id, organization_id)`, `events_event_type_fk` is composite and NO ACTION (on the Drizzle side and in the migration text), `event_type_id` is nullable, `time_zone` is NOT NULL with default `America/New_York`. Plus one case pinning the `dev-docs.ts` invariant as `enforcement: "documented"`.

### Files Modified

- `src/lib/db/domain/events.ts` — `eventTypes` declared above `events` (imports `EVENT_TYPE_COLORS`/`EVENT_TYPE_ICONS` from `../../events/type-palette`, plus `sqlList`, `uniqueIndex`, `check`, `sql`); `events.eventTypeId`; `events_org_type_idx`; the composite FK `events_event_type_fk`. One sentence of the `events` doc comment corrected (Implementer Notes).
- `src/lib/db/domain/org.ts` — `organizationSettings` becomes a three-argument `pgTable` with `timeZone` and the `organization_settings_time_zone_valid` CHECK, as the design gives it in full.
- `src/lib/dev-docs.ts` — one `INVARIANTS` entry: "A congregation's event types always include one fallback — except where nobody made one", `enforcement: "documented"` (rendered **paper** on `/developer`), text verbatim from the design.
- `src/lib/events/type-palette.test.ts` — the migration-parity block (4 tests): `event_types_color_allowed` equals `EVENT_TYPE_COLORS` in order; `event_types_icon_allowed` equals `EVENT_TYPE_ICONS` in order; the `VALUES` tuples between the `backfill-event-types` markers equal `STANDARD_EVENT_TYPES` tuple for tuple; the backfill join keeps the "fallback OR congregation/NWC" predicate (whitespace-normalised).

### Schema Changes

- **New table `event_types`**: `id`, `organization_id` (FK `organizations` on delete cascade), `name`, `color`, `icon`, `sort_order`, `is_active`, `is_fallback`, `created_at`, `updated_at`, `updated_by` (FK `users`). `unique (id, organization_id)` = `event_types_id_org_key`. CHECKs: `event_types_name_shape`, `event_types_color_allowed` (the nine `CATEGORY_KEYS`), `event_types_icon_allowed` (the 15 icons), `event_types_fallback_active`, `event_types_neutral_is_fallback`. Unique indexes: `event_types_org_lower_name_idx (organization_id, lower(name))` and the partial `event_types_one_fallback_idx (organization_id) where is_fallback`. ENABLE + FORCE RLS; `tenant_isolation` (USING and WITH CHECK `organization_id = presby_current_org()`); `grant select, insert, update` and `revoke delete` for `presby_app`, `presby_platform`.
- **New column `events.event_type_id uuid` (nullable)**, composite FK `events_event_type_fk (event_type_id, organization_id) -> event_types (id, organization_id)`, default NO ACTION, MATCH SIMPLE; index `events_org_type_idx (organization_id, event_type_id)`. None of the six frozen DECISION-113 columns is touched.
- **New column `organization_settings.time_zone text not null default 'America/New_York'`** + CHECK `organization_settings_time_zone_valid` (IANA shape regex AND `timestamp '2000-01-01' at time zone time_zone is not null`).
- **Catalog rows**: `permissions` `events.view` (tier 1) and `event_types.manage` (tier 1).
- **Backfills** (each guarded by `on conflict do nothing` / `where not exists`): settings row per org; `events.view` on every org-owned `member` role; `org_portal.calendar` toggle row `enabled = true, updated_by = null` per org; `event_types` per org type, mirroring `eventTypeSeedPlan`.
- **Applied via:** hand-written SQL, `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0054_presby_calendar_event_types.sql` on the pipeline branch `br-long-river-axfwmp57` (owner, direct endpoint), **applied twice**. Not `db:push`/`db:generate` (`db:generate` is broken repo-wide; Drizzle Kit emits no RLS/grant/backfill). The `_journal.json` entry (`idx 54`, tag `0054_presby_calendar_event_types`) is Rule-16 and stays with the orchestrator as draft D1. It is **not** registered by this commit, so until integration the journal has no idx 54.

**Pre-state (owner read before the first apply)** matched the design's rehearsal: 15 orgs (9 congregation / 5 presbytery / 1 synod), 2 `organization_settings` rows, 2 org-owned `member` roles, no `event_types`, no `event_type_id`, 0 calendar toggles, 0 events. The scratch database `tl_cal_dryrun` is gone (`pg_database`: `postgres, template1, template0, neondb`).

**Apply 1:** exit 0. `INSERT 0 13` (settings), `INSERT 0 2` (permissions), `INSERT 0 2` (`events.view` bindings), `INSERT 0 15` (toggles), `INSERT 0 87` (event types). The only NOTICEs were the expected first-run `drop ... if exists, skipping`.

**Apply 2 (the whole file again, idempotency proof):** exit 0. Every `INSERT 0 0`, NOTICEs only of the `already exists, skipping` kind. Counts `event_types / settings / calendar toggles / permission rows / events.view bindings` were **87/15/15/2/2 before and 87/15/15/2/2 after**.

**Negative checks** (owner connection, one transaction, **rolled back**; each attempt trapped and its SQLSTATE and constraint reported). All thirteen from the design were refused by the intended constraint:

| # | Attempt | Result |
|---|---|---|
| 1 | non-fallback type coloured `neutral` | 23514 `event_types_neutral_is_fallback` |
| 2 | fallback recoloured `teal` | 23514 `event_types_neutral_is_fallback` |
| 3 | fallback set inactive | 23514 `event_types_fallback_active` |
| 4 | colour `red` | 23514 `event_types_color_allowed` |
| 5 | icon `Rocket` | 23514 `event_types_icon_allowed` |
| 6 | name `' Neg Six'` (untrimmed) | 23514 `event_types_name_shape` |
| 7 | empty name | 23514 `event_types_name_shape` |
| 8 | 61-character name | 23514 `event_types_name_shape` |
| 9 | `WORSHIP` beside `Worship` | 23505 `event_types_org_lower_name_idx` |
| 10 | `time_zone = 'UTC+5'` | 23514 `organization_settings_time_zone_valid` |
| 11 | `time_zone = 'EST'` | 23514 `organization_settings_time_zone_valid` |
| 12 | `time_zone = 'Nope/Zone'` | **22023** (`invalid_parameter_value`, as the design predicts: `AND` has no evaluation order) |
| 13 | event in org A typed with org B's fallback | 23503 `events_event_type_fk` |
| extra 14 | a second `is_fallback` row in one org | 23505 `event_types_one_fallback_idx` |
| controls 15–17 | a 60-char name; `America/Chicago`; a same-org typed event | all accepted (as they should be) |

**As `presby_app`** (`$APP_DATABASE_URL`, `rolbypassrls = f`, rolled back): with org A in context, 9 own types visible, 0 of org B's; `DELETE` → `permission denied for table event_types`; an `INSERT` into org B → `new row violates row-level security policy`; `UPDATE` of own rows touched 9, of org B's touched 0; with no org context, 0 rows visible; org A's `time_zone` reads `America/New_York`.

**Live catalog re-read after apply 2** (owner):
- `event_types`: `relrowsecurity = t`, `relforcerowsecurity = t`.
- `pg_policies`: `tenant_isolation`, cmd `ALL`, qual and with_check both `(organization_id = presby_current_org())`.
- `aclexplode(relacl)`: `presby_app` = INSERT, SELECT, UPDATE; `presby_platform` = INSERT, SELECT, UPDATE; **no DELETE for either**. `neondb_owner` holds everything by ownership (expected; F44).
- `events_event_type_fk`: `confdeltype = 'a'`, `confupdtype = 'a'`, `confmatchtype = 's'`, `FOREIGN KEY (event_type_id, organization_id) REFERENCES event_types(id, organization_id)`.
- The five `event_types_*` CHECKs and `organization_settings_time_zone_valid` are present with the definitions above; `event_types_id_org_key` UNIQUE; indexes `event_types_one_fallback_idx ... WHERE is_fallback`, `event_types_org_lower_name_idx (organization_id, lower(name))`, `events_org_type_idx (organization_id, event_type_id)`.
- Columns: `events.event_type_id uuid` nullable, no default; `organization_settings.time_zone text NOT NULL default 'America/New_York'`.
- Backfilled rows: settings **15/15** (0 orgs without a row, all `America/New_York`); `org_portal.calendar` toggles **15**, all `enabled`, all `updated_by` null; `event_types` congregation **9 orgs / 81 rows / 45 active / 9 fallbacks**, presbytery **5/5/5/5**, synod **1/1/1/1**; **0** orgs without exactly one fallback; `permissions` `events.view` and `event_types.manage`, both module `events`, tier 1; `events.view` bound to **2** roles, both `member`, both org-owned; `event_types.manage` bound to **0**.

### Tests and checks

- `npx vitest run src/lib/events/type-seed-plan.test.ts`: 18 passed.
- `npx vitest run src/lib/events/type-palette.test.ts`: 14 passed (10 from commit 2 + 4 parity). **Failing-first:** on a backed-up copy of the migration, three separate mutations each failed exactly one case and nothing else: `'neutral'` → `'magenta'` in the colour CHECK failed "event_types_color_allowed lists exactly EVENT_TYPE_COLORS"; `'Mic'` → `'Rocket'` in the icon CHECK failed the icon case; flipping Committees' `is_active` in the backfill `VALUES` failed "the backfill VALUES equal STANDARD_EVENT_TYPES". With the file restored (`cmp` identical), 14 passed.
- `npx vitest run src/lib/db/domain/events.schema.test.ts`: 11 passed. **Failing-first:** with `index("events_org_type_idx")` removed from `events.ts`, it failed "events declares every name 0054 creates on it" (`events does not declare events_org_type_idx`). With the file restored, it passed.
- `npm run check:schema-parity` (pipeline branch, after 0054): **68 domain tables compared, 6 differences, 6 allowlisted (0 unclosed drift), 0 failing.** `event_types` and the two new columns appear in none of the six; all six are pre-existing `architectural` entries.
- `npm run typecheck`: clean. `npm run lint` (`--max-warnings=0`, including commit 1's S1 block): clean. `npm run check`: all six tripwires pass.
- `npm test`: **271 files passed, 35 skipped; 3658 tests passed, 934 skipped, 0 failed.**
- `npm run test:db` (pipeline branch, after 0054): **306 files passed, 4592 tests passed, 0 failed, 0 skipped**, exit 0. Afterwards the branch still holds 15 orgs / 87 types / 15 settings / 15 toggles, so the fixtures cleaned up.
- `scripts/test-rls.sql`: **not run by this commit.** Section 45 and the three section-19 assertion edits are draft D3 (Rule 16, the orchestrator's), and section 45 relies on D2's seed rows. Per the design, the unpatched suite fails at section 19 (`alder: sees its own toggle row — expected 1, got 2`) on any database where 0054's toggle backfill has run, **which now includes this pipeline branch**. That is expected until D3 lands at integration; QA's from-empty rehearsal (recipe step 2) is the proof.

### Audit Events

- None (R7 / DECISION-161: a migration backfill is provisioning; event types are not audited).

### Implementer Notes

- **One deviation from the design's diff, documentation only:** the `events` table's existing doc comment said occurrence times are wall-clock "no org-timezone column exists per D6/US-only scope". 0054 makes that false, and R2 replaces the stated reason. I rewrote the sentence to say the times stay wall-clock (DECISION-113 ruling 3) and that `organizationSettings.timeZone` is the zone in which *now* is read, never a conversion. No code changed.
- **The schema-pin test imports the tables through `../schema`, not `./events`.** Entering the domain module cycle at `events.ts` (`events.ts` → `../schema` → `export * from "./domain"` → `authz.ts`) reaches `authz.ts` before `org.ts` has initialised `organizationType`, which throws `TypeError: organizationType is not a function` at load. Importing through `schema.ts` (the app's own entry point) loads in the canonical order. This is pre-existing (the `events.ts` → `../schema` import predates this pipeline), and the app is unaffected because it always enters through `@/lib/db/schema`. Recorded so the next test author doesn't rediscover it.
- **Placing the `dev-docs.ts` pin in `events.schema.test.ts`** needs `vi.mock("@/lib/db")` and `vi.mock("server-only")`, because `dev-docs.ts` imports the RLS connection. There is no `dev-docs.test.ts`, and creating one for a single assertion seemed worse than putting it beside the schema it describes.
- **Not done here, on purpose (owned by later commits or by integration):** `org-provisioning.ts`'s re-export and provisioning inserts (commit 4); the backfill-per-org-type re-execution and the A2 cascade proof in `src/lib/event-types.test.ts` (commit 4); `_journal.json` D1, `seed-dev.sql` D2, `test-rls.sql` D3 (Rule 16, orchestrator).
- **For the orchestrator at D1:** the pipeline branch now has 0054 applied while `_journal.json` has no idx 54. That matches how every hand-written migration is tracked here (the runner ledger stops at idx 9), so nothing breaks.

**Escalation to Phase 3: none.** The design's SQL needed no change. The stale-comment fix above is the only departure from the design text, and it is documentation that R2 already requires.

### Commit 3 file list (`git add` by path)

- `drizzle/0054_presby_calendar_event_types.sql`
- `src/lib/db/domain/events.ts`
- `src/lib/db/domain/org.ts`
- `src/lib/db/domain/events.schema.test.ts`
- `src/lib/events/type-seed-plan.ts`
- `src/lib/events/type-seed-plan.test.ts`
- `src/lib/events/type-palette.test.ts`
- `src/lib/dev-docs.ts`

Trailers: `Work-Log: 2026-10-14-member-calendar`. Next: api-developer, commit 4 (imports `eventTypes`, `organizationSettings.timeZone`, and `eventTypeSeedPlan`, which it re-exports from `org-provisioning.ts`).

## Commit 4 — `feat(calendar): the member read path and event-type library` (api-developer, 2026-10-15)

Implemented as the Phase 3 "API Contract" records it. No route handlers exist (the design has none); the surfaces are library functions and five Server Actions. **Escalation to Phase 3: none.** The departures from the design text are listed under Implementer Notes and are all additive or test-only.

### Contract delivered (what commits 5 and 6 and the home pipeline consume)

| Module | Export | Gate (inside the one `withOrgContext` transaction, checked first) |
|---|---|---|
| `src/lib/shared/org-time.ts` (pure) | `DEFAULT_ORG_TIME_ZONE`, `isValidTimeZone(value: unknown): value is string`, `OrgClock`, `wallClockNow(now: Date, timeZone: string): OrgClock`, `todayInOrgZone(now: Date, timeZone: string): string` | none (pure) |
| `src/lib/shared/uuid.ts` (pure) | `isUuidShaped(value: string): boolean` | none |
| `src/lib/org-settings.ts` | `orgTimeZoneInTx(tx: OrgTx, organizationId: string): Promise<string>` | org membership (caller's `withOrgContext`); missing row or an ICU-rejected zone -> the default |
| `src/lib/org-features.ts` | catalog entries gain `flag: string \| null` and `provisionedOn: boolean`, plus `org_portal.calendar` (`flag: null`, `provisionedOn: true`, category `worship`); `isCategoryAxisOn(): Promise<boolean>`; `orgFeatureEnabledInTx(tx, organizationId, key, categoryAxisOn): Promise<boolean>`; `isOrgFeatureEnabled` rewritten over them, behaviour-identical | n/a |
| `src/lib/org-provisioning.ts` | `baselineRoleSeedPlan` (now **exported**) returns `permissionKeys: readonly string[]` = `["directory.view", "events.view"]`; `eventTypeSeedPlan` re-exported; `createOrganization()` now also writes the settings row, one enabled toggle row per `provisionedOn` entry, and the event types, all inside its one transaction | platform-admin path, unchanged |
| `src/lib/calendar/{month,filters,wall-clock,clipboard}.ts` (pure) | exactly the design's exports, plus one extra: `formatClipboardDay(dayKey)` ('Sun Oct 4') in `month.ts` | none |
| `src/lib/calendar.ts` | `getMonthCalendar`, `getMemberEvent`, `listUpcomingMemberEvents`, `CALENDAR_FEATURE_KEY`, `MemberEventsResult<T>`, `MemberEventType`, `CalendarEntry`, `MonthCalendarRequest`, `MonthCalendarData`, `MemberEventDetail`, `UpcomingMemberEvent` | (1) calendar toggle -> `disabled`; (2) `events.view` OR `events.manage` in one statement -> `forbidden`; then zone/today, then queries |
| `src/lib/event-types.ts` | `canManageEventTypes`, `listEventTypes`, `createEventType`, `updateEventType`, `setEventTypeActive`, `moveEventType`, `seedStandardEventTypes`, `EventTypesResult<T>`, `EventTypeRow`, `EventTypeInput` | `event_types.manage` ONLY (`events.manage` alone is `forbidden`) |
| `src/lib/events.ts` | `CreateEventInput.eventTypeId?`, `UpdateEventInput.eventTypeId?` (`undefined` = unchanged, `null` = clear); `EventDetail.eventType: { id; name } \| null`; `getEventTypePickerData(viewerPersonId, organizationId, opts?: { currentTypeId?: string \| null }): Promise<EventsResult<EventTypePickerData>>`; exported `EVENT_TYPE_UNAVAILABLE`, `EventTypePickerOption`, `EventTypePickerData` | `events.manage` (picker, create, update, as before) |
| `src/app/(org)/o/[slug]/admin/events/types/actions.ts` | `createEventTypeAction(slug, input)`, `updateEventTypeAction(slug, input & { id })`, `setEventTypeActiveAction(slug, id, isActive)`, `moveEventTypeAction(slug, id, "up" \| "down")`, `seedStandardEventTypesAction(slug)`, each `Promise<ActionResult<...>>` as the design lists | `auth()` -> `resolveOrgContext` (slug re-resolved, never a client org id) -> the library gate. `revalidatePath` of `/o/<slug>/admin/events/types` and `/o/<slug>/calendar` on success |

Final signatures the home pipeline asked to see confirmed:

```ts
// src/lib/calendar.ts
export async function listUpcomingMemberEvents(
  viewerPersonId: string, organizationId: string, opts: { limit: number; now?: Date },
): Promise<MemberEventsResult<UpcomingMemberEvent[]>>;
export async function getMonthCalendar(
  viewerPersonId: string, organizationId: string, req: MonthCalendarRequest,
): Promise<MemberEventsResult<MonthCalendarData>>;
export async function getMemberEvent(
  viewerPersonId: string, organizationId: string, eventId: string,
): Promise<MemberEventsResult<{ event: MemberEventDetail | null; canManage: boolean }>>;
// src/lib/shared/org-time.ts
export function todayInOrgZone(now: Date, timeZone: string): string;
// src/lib/org-settings.ts
export async function orgTimeZoneInTx(tx: OrgTx, organizationId: string): Promise<string>;
// src/lib/calendar/wall-clock.ts
export function formatTime(wallClock: string): string;
// src/lib/calendar/month.ts
export function formatShortDate(dayKey: string): string;
```

Behaviour verified against the real database (not asserted from the design): untyped events resolve to the fallback in SQL; a retired-type event shows under All and under no active filter; `listUpcomingMemberEvents` is "listed until its day ends" (a 10:30 event is returned at 23:30 org time and gone at 00:30 the next org day), includes an event at exactly `00:00` today, yields one row per series with `seriesKey` = the parent's id when the parent has passed, orders by `(starts_at, id)`, and clamps `limit` (0, -5, `NaN`, `Infinity` -> 1; 99 -> 12); "today" follows the ORG's zone (Honolulu vs New York vs a settings-less org on the default) whatever the process zone.

### Files Created

- `src/lib/shared/org-time.ts`, `src/lib/shared/org-time.test.ts`
- `src/lib/shared/uuid.ts` (covered by `filters.test.ts`)
- `src/lib/org-settings.ts`, `src/lib/org-settings.test.ts`
- `src/lib/org-feature-catalog.test.ts`
- `src/lib/calendar/month.ts`, `month.test.ts`, `wall-clock.ts`, `wall-clock.test.ts`, `filters.ts`, `filters.test.ts`, `clipboard.ts`, `clipboard.test.ts`
- `src/lib/calendar.ts`, `src/lib/calendar.test.ts` (DB-backed)
- `src/lib/event-types.ts`, `src/lib/event-types.test.ts` (DB-backed; includes the backfill-per-org-type and A2 cascade proofs)
- `src/lib/testing/calendar-fixture.ts` (test support for the two DB-backed suites; not in the design, see notes)
- `src/app/(org)/o/[slug]/admin/events/types/actions.ts`, `actions.test.ts`

### Files Modified

- `src/lib/org-features.ts` - catalog fields, calendar entry, `isCategoryAxisOn`, `orgFeatureEnabledInTx`; the local `OrgTx` alias replaced by the one exported from `@/lib/authz`.
- `src/lib/org-features.test.ts` - `orgFeatureEnabledInTx` agrees with `isOrgFeatureEnabled` over the full axis x category x toggle matrix for a people key and the calendar key; the calendar key follows the worship category; uncatalogued key; `listFeatureToggles` lists the calendar entry; `toggleOrgFeature` accepts and audits it.
- `src/lib/org-provisioning.ts`, `src/lib/org-provisioning.test.ts` - list-shaped role plan, settings row, toggle rows, event types; the existing permission assertion now expects both permissions; new cases per org type; `@/lib/audit` mocked (see notes).
- `src/lib/events.ts` - `eventTypeId` plumbing, pre-check, `getEvent.eventType`, `getEventTypePickerData`, header paragraph on types.
- `src/lib/events.test.ts` - 23 new cases (create/children/extend/update/refusals/picker).
- `src/app/(org)/o/[slug]/admin/events/edit-event-form.test.tsx` - the `makeEvent` fixture gains `eventType: null` (one line) so `tsc` stays green with the new required `EventDetail.eventType`. The design assigns this file's other changes to commit 6.

### Schema Changes

- none (0054 was commit 3; this commit only consumes it).

### Audit Events

- none, by DECISION-161 ruling R7. `actions.ts` states it in its header and has no direct `db.` mutation (it calls `src/lib/event-types.ts`, which mutates on a `tx`), so no `// audit-exempt: DECISION-161` line was needed; `actions.test.ts` asserts the header text, that `@/lib/audit` is not imported, and that any future direct mutation must carry the exemption. `npm run check:audit` passes. An org admin flipping the calendar toggle is still audited by the unchanged `toggleOrgFeature` (`ORG_FEATURE_TOGGLED`).

### Tests and checks

| Run | Result |
|---|---|
| New pure unit files (`org-time` 67, `org-settings` 5, `org-feature-catalog` 5, `calendar/month` + `wall-clock` + `filters` 172, `calendar/clipboard` 37, event-type `actions` 47) | 333 tests, all green. The time-sensitive files (`org-time`, `month`, `wall-clock`, `clipboard`) wrap `describe.each(TEST_TIME_ZONES)` + `useProcessTimeZone`, so each of those runs under UTC, New York and Honolulu inside one process |
| The same set plus `src/lib/events/**` and `admin/events/**`, with the OUTER `TZ=` set to `UTC` / `America/New_York` / `Pacific/Honolulu` | 24 files passed in each of the three runs, **545 passed** (195 DB-backed tests skipped without `.env.local`), identical in all three |
| DB-backed, serial (`npx dotenv -e .env.local -- vitest run --no-file-parallelism <files>`): `calendar.test.ts` 142, `event-types.test.ts` 35, `events.test.ts` 53, `org-provisioning.test.ts` 31, `org-features.test.ts` 22 | 5 files, **283 passed** (`calendar.test.ts` runs every read test under all three process zones with `now` chosen so the org day differs from the UTC day) |
| `npm run test:db` (the whole suite, serial, against the pipeline branch with 0054 applied) | **316 files, 5139 tests passed, 0 failed, 0 skipped**, exit 0. Afterwards the branch still holds 15 orgs / 87 event types / 15 settings / 15 calendar toggles / 0 events / 0 stamped people, and `org_portal.feature_categories` is back to `false`, so every fixture cleaned up |
| `npm test` | 279 files passed, 37 skipped; **3991 tests passed**, 1148 skipped, 0 failed (commit 3 was 271 / 3658) |
| `npm run typecheck` | clean |
| `npm run lint` (`--max-warnings=0`, S1 block over `src/lib/calendar/**`, `calendar.ts`, `org-time.ts`) | clean |
| `npm run check` (all six tripwires) | all passed: audit-coverage (the new `actions.ts` has no direct `db.` mutation), `sql<Date>`, deps-drift, brand-scope (after the three `ui-ok` annotations), secrets/PII, hydration-gate |
| Mutation checks | `calendar.ts` upper bound `<` -> `<=` failed 4 cases; upcoming lower bound `>=` -> `>` failed the 00:00-today case; the `event-types.ts` `23505` catch disabled failed the race case with the raw index error. Each mutation was reverted (file restored from a backup, `grep` confirmed) |

Failing-first note: this commit is new surface, not a bug fix, so there is no pre-fix failing run; the mutation checks above are the evidence the DB-backed assertions can fail.

### Implementer Notes

- **No deviation that needs Phase 3.** Departures from the design text, each small:
  1. `baselineRoleSeedPlan` is now `export`ed (it was module-private) so the list shape can be unit-tested without creating an org.
  2. `org-provisioning.ts` now imports `ORG_FEATURE_CATALOG` from `org-features.ts` (the design says "for every `ORG_FEATURE_CATALOG` entry with `provisionedOn`"), which transitively imports `@/lib/audit` -> `@/auth` (not resolvable under vitest). `org-provisioning.test.ts` therefore mocks `@/lib/audit`, the same constraint `org-features.test.ts` documents. Any other test that imports `org-provisioning` without mocking it would hit the same wall; the full suite found none.
  3. `src/lib/testing/calendar-fixture.ts` is new test support. The two DB-backed suites need the same ceremony (stamped orgs, derived Active Membership group, roles, grants, users); a shared helper with dynamic imports inside its functions keeps the `hasDb` skip intact. Note for later fixtures: **a person can hold a membership in one organization only** (`presby_guard_membership_insert`), so a multi-org fixture needs one person per org.
  4. `formatClipboardDay` is an extra export of `calendar/month.ts` (the plain-text clipboard's 'Sun Oct 4').
  5. `moveEventType` on the fallback returns `invalid_input` "The default type always stays last." The design says the fallback "is never moved" but names no outcome.
  6. The picker places the event's retired current type in manager order (not appended) and flags it `isRetired: true`.
  7. `toggleTypeSelection` for an id that is not an active type returns the (normalised) current selection unchanged.
  8. `org-feature-catalog.test.ts` omits the design's last clause ("every `PORTAL_TILES` `orgFeatureKey` is a catalog key"): no tile carries `orgFeatureKey` until commit 5, which adds that assertion with the type.
  9. `check:brand-scope` C2 flags a literal `<table` anywhere outside `components/ui/`. `clipboard.ts` builds the clipboard's HTML as a string (never rendered by React), so the line carries `// ui-ok: clipboard HTML string, not an in-app table`, and so do the two test assertions.
- The 23505 race is tested deterministically rather than by hoping two requests overlap: another connection holds an UNCOMMITTED row with the contested name, `createEventType` is observed still pending after 1.5 s (so it passed the pre-check and is blocked on the unique index), the holder commits, and the call resolves to the duplicate message. Mutation-checked: with the catch disabled that test fails with the raw `23505` / `event_types_org_lower_name_idx`.
- Mutation checks on `calendar.ts`: making the month upper bound inclusive (`<=`) failed four cases (grid contents, bounds, "covers every active type", "another org's id"); making the upcoming lower bound exclusive (`>`) failed the new "an event at exactly 00:00 today" case.
- `calendar.test.ts` takes about 95 s (142 tests x three zones of round trips to the Neon branch); `event-types.test.ts` about 42 s. Both are serial-only like the rest of the DB-backed suites.
- The category-axis flag test in `calendar.test.ts` upserts `org_portal.feature_categories`, a global row, and restores its prior value (or deletes it) in `finally`; run the DB suites serially, as the repo already requires.
- `calendar.ts` contains exactly two zero-argument `new Date()` expressions (the defaults of the injectable `now`), each consumed only by `todayInOrgZone`; S1 permits zero-argument construction and rejects every local getter/setter/multi-argument form, and `npm run lint` is clean.

### Commit 4 file list (`git add` by path)

```
src/app/(org)/o/[slug]/admin/events/edit-event-form.test.tsx
src/app/(org)/o/[slug]/admin/events/types/actions.test.ts
src/app/(org)/o/[slug]/admin/events/types/actions.ts
src/lib/calendar.test.ts
src/lib/calendar.ts
src/lib/calendar/clipboard.test.ts
src/lib/calendar/clipboard.ts
src/lib/calendar/filters.test.ts
src/lib/calendar/filters.ts
src/lib/calendar/month.test.ts
src/lib/calendar/month.ts
src/lib/calendar/wall-clock.test.ts
src/lib/calendar/wall-clock.ts
src/lib/event-types.test.ts
src/lib/event-types.ts
src/lib/events.test.ts
src/lib/events.ts
src/lib/org-feature-catalog.test.ts
src/lib/org-features.test.ts
src/lib/org-features.ts
src/lib/org-provisioning.test.ts
src/lib/org-provisioning.ts
src/lib/org-settings.test.ts
src/lib/org-settings.ts
src/lib/shared/org-time.test.ts
src/lib/shared/org-time.ts
src/lib/shared/uuid.ts
src/lib/testing/calendar-fixture.ts
```

Trailers: `Work-Log: 2026-10-14-member-calendar`. Not in commit 4: the work-log itself (the orchestrator's), `drizzle/meta/_journal.json`, `domain/index.ts`, `seed-dev.sql`, `test-rls.sql` (Rule 16).

## Commit 5 — `feat(portal): a calendar tile and a per-org tile gate` (full-stack-developer, 2026-10-15)

### What changed

- `src/lib/org-portal/tiles.ts` is data and types again. `PortalTile` is `PortalTileBase & PortalTileGate`, where the gate is `{ flagKey: string; orgFeatureKey?: OrgFeatureKey } | { flagKey?: undefined; orgFeatureKey: OrgFeatureKey }`; `OrgFeatureKey` is a **type-only** import (F135). `calendar` tile added immediately before `events` (operate, worship, `orgFeatureKey: "org_portal.calendar"`, no `flagKey`); `events` relabelled "Manage events", moved to `administer`, `domain: "worship"` kept (reverses DECISION-113 ruling 7 for events only, per R6). `visiblePortalTiles` and the `isFlagEnabled` import left the file. 20 tiles.
- `src/lib/org-portal/visible-tiles.ts` (new, `server-only`): `visiblePortalTiles(category, organizationType, viewer: TileViewer)`; order is category -> `orgTypeScope` -> `tile.flagKey` -> the catalog entry's non-null `flag` -> `isOrgFeatureEnabled(viewer.personId, viewer.organizationId, key)`. Any error from the gate read hides that tile and logs the two ids only (never the message or stack); it never throws. Dedup: a per-tile `cache()`d resolver keyed on **primitives** (an object-valued `viewer` would defeat `cache()`), on top of `isOrgFeatureEnabled`'s own `cache()`, so nav, footer and page cost one toggle read per request.
- `tile-icons.tsx`: `calendar: CalendarDays`, `events: CalendarCog` (events previously fell through to the `LayoutGrid` fallback).
- The five callers: `(org)/o/[slug]/page.tsx`, `admin/page.tsx`, `portal-nav.tsx` (required `viewer` prop), `portal-footer.tsx` (required `viewer` prop), `layout.tsx` (threads `viewer` from the existing `resolved.kind === "ok"` branch; no new query). Note: the design's prose says "four callers" but its table lists five rows; the fifth is `layout.tsx`. `portal-nav.tsx` is at `src/app/(org)/o/[slug]/portal-nav.tsx`, not `src/components/org-portal/`.

### Tests

- `tiles.test.ts`: no longer mocks `@/lib/flags` at all (importing `tiles.ts` must not need the resolver chain; a runtime import creeping back in fails at load). 20 tiles; key list; `EXPECTED` and the operate/administer test updated; "every tile has a gate" and "every `flagKey` a tile declares is seeded" replace "every flagKey is seeded"; the calendar tile is toggle-only; labels and hrefs of `Calendar` / `Manage events`.
- `org-feature-catalog.test.ts`: the tile-key assertion commit 4 left out (every `PORTAL_TILES` `orgFeatureKey` is a catalog key). This is where the "every `orgFeatureKey` is a catalog key" check lives rather than in `tiles.test.ts`, because that file now deliberately imports nothing from `org-features` and this one already mocks the chain.
- `visible-tiles.test.ts` (new): every pre-existing `visiblePortalTiles` case carried over with the third argument; plus toggle on shows the calendar with no flag on, toggle off hides it, a rejecting toggle read hides it without throwing and logs ids only (asserted: ids present, the error message and table name absent), an `OrgAccessError`-shaped rejection likewise, no toggle read for a tile an earlier filter excluded, a non-null catalog `flag` is read before the toggle, `events` in administer and `calendar` in operate, declaration order.
- Caller tests re-pointed at the `visible-tiles` mock with the viewer asserted: `page.test.tsx`, `admin/page.test.tsx`, `portal-nav.test.tsx`, `portal-footer.test.tsx`, `layout.test.tsx` (both spies receive `viewer`). `visible-tiles` is mocked in every one, so there is no DB-backed `visible-tiles` test; the design did not call for one.

### Checks

- `npm run typecheck`: clean. **Gate-less tile is a type error**, proven with a scratch file (deleted): a tile with neither gate fails with "Property 'orgFeatureKey' is missing ... but required"; `orgFeatureKey: "org_portal.nope"` fails; `orgFeatureKey` alone, `flagKey` alone and both together compile; `visiblePortalTiles("operate", "congregation")` fails "Expected 3 arguments, but got 2".
- `npm run lint`: clean (`--max-warnings=0`). `npm run check`: all six tripwires pass. `npm test`: 280 files passed / 37 skipped, 4,003 tests passed / 1,148 skipped (the DB-backed suites skip without `.env.local`).
- DB-backed, serial, `.env.local` (pipeline Neon branch): `org-features.test.ts`, `org-feature-categories.test.ts`, `calendar.test.ts` — 3 files, 180 tests passed.

### Browser (dev server from this worktree on :3600, headless Chromium, signed in as `clerk.fixture@example.invalid`; server stopped afterwards)

- `/o/alder-creek`, toggle on, 375px and 1280px: Worship & Events section shows **Calendar** ("See what's coming up.", links to `/o/alder-creek/calendar") above "Worship & Service Planning (Coming soon)"; no Events tile anywhere in operate; the persistent nav's "Worship & Events" anchor is present; the nav and footer both list "Calendar"; no horizontal overflow at either width. At 375px the tiles stack one per row, the Calendar tile carries its `CalendarDays` icon, and the footer wraps cleanly.
- `/o/alder-creek/admin`, both widths: "Manage events" ("Create and manage calendar events, including repeating series.", links to `/o/alder-creek/admin/events") renders in the Worship & Events section, with Roles/Tickets/Features/Branding under Administration; no overflow.
- Toggle flipped off in SQL (`organization_feature_toggles`, `alder-creek`, `org_portal.calendar`), reloaded at both widths: the Calendar tile is gone from the home grid, the nav row and the footer; the Worship & Events section and "Worship & Service Planning" remain; the admin hub is unchanged. Toggle flipped back on afterwards (verified `t`).
- Not covered here: the `/o/alder-creek/calendar` page itself does not exist until commit 6, so the tile's href 404s on this branch by design.

### Commit 5 file list (`git add` by path)

```
src/app/(org)/o/[slug]/admin/page.test.tsx
src/app/(org)/o/[slug]/admin/page.tsx
src/app/(org)/o/[slug]/layout.test.tsx
src/app/(org)/o/[slug]/layout.tsx
src/app/(org)/o/[slug]/page.test.tsx
src/app/(org)/o/[slug]/page.tsx
src/app/(org)/o/[slug]/portal-nav.test.tsx
src/app/(org)/o/[slug]/portal-nav.tsx
src/components/org-portal/portal-footer.test.tsx
src/components/org-portal/portal-footer.tsx
src/components/org-portal/tile-icons.tsx
src/lib/org-feature-catalog.test.ts
src/lib/org-portal/tiles.test.ts
src/lib/org-portal/tiles.ts
src/lib/org-portal/visible-tiles.test.ts
src/lib/org-portal/visible-tiles.ts
```

Trailers: `Work-Log: 2026-10-14-member-calendar`. Escalation to Phase 3: none (one wording note above: "four callers" vs five rows). Not in commit 5: the work-log, and the integration edits other processes had already made in this worktree when I finished (`docs/TODO.md`, `docs/decisions.md`, `docs/ui-standards.md`, `drizzle/meta/_journal.json`, `scripts/seed-dev.sql`, `scripts/test-rls.sql`) — I did not touch those.

*Handoff:* **full-stack-developer**, commit 5 (`tiles.ts`, `visible-tiles.ts`, the tile registry and the five caller files): `OrgFeatureKey` now includes `org_portal.calendar` and `isOrgFeatureEnabled` is unchanged in signature. Then **ux-developer**, commit 6, consuming the pages' read functions above, `getEventTypePickerData`, the five actions, and the pure `calendar/*` formatters; the home pipeline consumes `listUpcomingMemberEvents`, `todayInOrgZone`, `formatTime`, `formatShortDate` exactly as signed above.

## Commit 6 - `feat(calendar): the member calendar, the detail page and the event-types manager` (ux-developer, 2026-10-15)

**Escalation to Phase 3: none.** Built as specified; the small departures are under Implementer Notes.

### Fixture data for the browser check (step 0)

Applied the D2 block (`-- APPENDED BLOCK - pipeline/member-calendar`, lines 1805-1941 of `scripts/seed-dev.sql`, wrapped in `begin; ... commit;`) to the pipeline branch with `psql "$MIGRATE_DATABASE_URL"`: **16 events** at Alder Creek (16 in total on the branch, was 0) and **9 event types** there. The block does not carry the older `events.manage` grant to `stated_clerk` (that lives earlier in the seed), so `clerk.fixture` initially held `event_types.manage` only; I applied that single idempotent row (`app_role_permissions`, role `f0000000-...-0005`, `events.manage`) by hand to reach the admin surfaces. Browser-created test types were deleted afterwards; the e2e runs leave 0 `e2ca` events, 0 `E2E ` types, 0 `e2e_calendar_` roles (verified by query).

### Files Created

- Shared pieces, `src/components/org-portal/event-types/`: `event-type-icon.tsx`, `event-type-chip.tsx`, `event-type-swatch.tsx`, `event-type-picker.tsx`.
- Calendar route, `src/app/(org)/o/[slug]/calendar/`: `page.tsx`, `calendar-states.tsx`, `calendar-filters.tsx` (the `<details>` + inline copies of the pills; not named in the plan, split out of `page.tsx`), `month-nav.tsx`, `type-filter-pills.tsx`, `month-grid.tsx`, `month-list.tsx`, `calendar-entry.tsx`, `copy-month-button.tsx` (the only client island), `[eventId]/page.tsx`, `calendar-test-data.ts` (test fixture builders only).
- Manager, `src/app/(org)/o/[slug]/admin/events/types/`: `page.tsx`, `event-types-states.tsx`, `event-type-list.tsx`, `event-type-form.tsx`, `event-type-schema.ts`, `seed-standard-types-button.tsx` (client; the empty-state action, not named in the plan).
- e2e: `e2e/support/calendar-fixture.ts`, `e2e/member-calendar.spec.ts`, `e2e/hydration/event-types-form.spec.ts`.

### Files Modified

`admin/events/`: `page.tsx` (outline **Event types** button behind `canManageEventTypes`, a failed read hides it), `new/page.tsx` and `[eventId]/edit/page.tsx` (load `getEventTypePickerData`; edit passes the current type), `new-event-form.tsx`, `edit-event-form.tsx` (picker, `eventTypeId`, the public-checkbox hint, the series-occurrence note), `event-schema.ts` (`eventTypeId: z.string()`), `[eventId]/page.tsx` (`Type:` line). Their tests were updated in step.

### Tests

- New component/page tests: every calendar-route file (`calendar-states`, `month-nav`, `type-filter-pills`, `calendar-entry`, `month-grid`, `month-list`, `calendar-filters`, `copy-month-button`, `page`, `[eventId]/page`), the four shared pieces, and the manager (`event-type-schema`, `event-type-form`, `event-type-list`, `event-types-states`, `seed-standard-types-button`, `page`). Updated: `new-event-form`, `edit-event-form`, `event-schema`, `admin/events/page`, `new/page`, `[eventId]/page`, `[eventId]/edit/page` tests.
- `npm test`: **298 files passed / 37 skipped; 4,182 tests passed / 1,148 skipped, 0 failed** (commit 5 was 280 / 4,003).
- `npm run typecheck` clean; `npm run lint` (`--max-warnings=0`) clean; `npm run check` all six tripwires pass (hydration-gate passes for `event-type-form.tsx`; brand-scope C2 needed three `// ui-ok:` annotations: the radio option card, the type chip, and the grid's `<table>`, hoisted into a tiny `GridTable` wrapper so the comment can sit on the line above `<table`).
- e2e against a dev server from this worktree on :3600 (`E2E_BASE_URL=http://localhost:3600 npx playwright test e2e/member-calendar.spec.ts e2e/hydration/event-types-form.spec.ts`): **16 passed**. The hydration spec also passes in the production lane (`PW_PROD_BUILD=1 npx playwright test e2e/hydration/event-types-form.spec.ts`, :3800): 1 passed.

### Browser (headless Chromium, dev server on :3600, signed in as `clerk.fixture@example.invalid`; server stopped afterwards)

- **`/o/alder-creek/calendar` at 1280px:** month grid (real table, seven headers), list hidden; today shown as a filled circle; entries show icon, time, title and location on the type's tint with a 4px ink rule; five pills (All, Worship, Classes and Bible Study, Youth and Children, Committees, General) with Month/List switch at the right; Today and Copy month top right; no horizontal overflow. Pill click filtered (URL `?month=...&types=<id>`), **All** cleared it. `?view=list` shows the list and hides the grid.
- **375px:** list only (grouped by day with full type names visible), Month/List switch hidden, no overflow. The `<details>` disclosure **opens and closes on a tap of its summary** (label swaps Show filters / Hide filters, pills visible when open); choosing Worship navigated to `?types=<id>`, the filter survived a hard reload, and prev / next / Today hrefs all carried `types` (Today dropped `month`).
- **Copy month (1280px):** disabled while the JavaScript chunks were held, enabled after release; click produced the toast "Calendar copied (1 members-only event left out)" and the clipboard held `October 2026` then `Sun Oct 4` / `  10:30a Sunday worship - Sanctuary` blocks with the members-only Session meeting absent.
- **Fallbacks:** `?month=0000-01` and `?types=not-a-uuid` render the current month with no error; `?month=2000-01` shows "Nothing is scheduled for January 2000."
- **Detail `/o/alder-creek/calendar/<id>`:** title, type chip, "Sunday, October 4, 2026, 10:30 AM - 11:45 AM", location, "Part of a repeating series", and (for the clerk, flag on) **Edit this event** to `/admin/events/<id>`. Cancelled event: **404**; non-UUID: **404**; `?from=%2Fo%2Falder-creek` reads "Back to home" (`/o/alder-creek`); `?from=https://evil.example` falls back to "Back to calendar" (`/o/alder-creek/calendar`).
- **`/o/alder-creek/admin/events/types`, 1280 and 375px:** list of nine types with swatch, icon, Default / Retired text badges and "Used by N events"; no overflow at either width. Added a type (name, Violet, Music), duplicate refused with "You already have an event type called 'zz browser 1280'.", edited it in a dialog (rename + recolour to Lime; dialog closed), moved it up one place, and retired it (Retired badge appears). The default type (General): switch disabled, "The default type can't be retired." shown, no move buttons.
- **Picker:** `/admin/events/new` lists "No type (shown as General)", Worship, Classes and Bible Study, Youth and Children, Committees (retired types absent); the edit page for a Worship series occurrence defaults to Worship and shows "Changes this occurrence only." and the members-visibility hint; no overflow at 375px.

### Implementer Notes (what a reviewer should click through, copy to review, tradeoffs)

- **Click through:** `/o/<slug>/calendar` at a phone width (open the filter disclosure, tap a pill, reload), tap an event, Back; `/o/<slug>/admin/events/types` (add / edit / reorder / retire); the Event type select on New event and Edit event; Copy month, then paste into a document.
- **New copy for a fork's branding pass:** every string in "Empty states and microcopy" of the plan, the three calendar state messages, the manager's header text and retired-types hint, "Add the standard event types" and its toasts ("Added N event types.", "The standard event types were already there."), "Event type added." / "Event type saved.", "<name> retired." / "<name> is offered again.", "Edit event type" / "Changes apply to every event of this type.", "The default type can't be retired.", the picker's label and hint, and the public-checkbox hint.
- **Picker load failure is a load error, not a picker-less form.** If `getEventTypePickerData` fails, `new/page.tsx` and `[eventId]/edit/page.tsx` render `EventsLoadError`. A form without the picker would submit `eventTypeId: null` and, on edit, silently clear the event's type.
- **Edit page order:** the cancelled-event 404 runs before the picker load (no wasted query, and the existing 404 test stays meaningful).
- **Switch name:** the manager's switch carries `aria-label="Offered (<type name>)"` and the visible "Offered" text is `aria-hidden`; a wrapping `<label>` with an `sr-only` suffix did not produce an accessible name in jsdom/testing-library, and the explicit label contains the visible text (WCAG 2.5.3).
- **Month nav heading in print:** the paging buttons are `print:hidden`; the month heading stays so a printed month is titled.
- **Pills hidden at zero or one active type** (`types.length > 1`); the empty-org state also hides Today and Copy month (nothing to copy), and an empty month hides Copy month.
- **Forms inside `HydrationGate`:** the manager's add form and its edit dialog form; `fieldset[data-slot="hydration-gate"]` is `aria-busy` pre-hydration (asserted by the new hydration spec).
- **Not done (optional in the plan):** the `/admin/design-system` category swatch row.

### Commit 6 file list (`git add` by path)

```
e2e/hydration/event-types-form.spec.ts
e2e/member-calendar.spec.ts
e2e/support/calendar-fixture.ts
src/app/(org)/o/[slug]/admin/events/[eventId]/edit/page.test.tsx
src/app/(org)/o/[slug]/admin/events/[eventId]/edit/page.tsx
src/app/(org)/o/[slug]/admin/events/[eventId]/page.test.tsx
src/app/(org)/o/[slug]/admin/events/[eventId]/page.tsx
src/app/(org)/o/[slug]/admin/events/edit-event-form.test.tsx
src/app/(org)/o/[slug]/admin/events/edit-event-form.tsx
src/app/(org)/o/[slug]/admin/events/event-schema.test.ts
src/app/(org)/o/[slug]/admin/events/event-schema.ts
src/app/(org)/o/[slug]/admin/events/new-event-form.test.tsx
src/app/(org)/o/[slug]/admin/events/new-event-form.tsx
src/app/(org)/o/[slug]/admin/events/new/page.test.tsx
src/app/(org)/o/[slug]/admin/events/new/page.tsx
src/app/(org)/o/[slug]/admin/events/page.test.tsx
src/app/(org)/o/[slug]/admin/events/page.tsx
src/app/(org)/o/[slug]/admin/events/types/event-type-form.test.tsx
src/app/(org)/o/[slug]/admin/events/types/event-type-form.tsx
src/app/(org)/o/[slug]/admin/events/types/event-type-list.test.tsx
src/app/(org)/o/[slug]/admin/events/types/event-type-list.tsx
src/app/(org)/o/[slug]/admin/events/types/event-type-schema.test.ts
src/app/(org)/o/[slug]/admin/events/types/event-type-schema.ts
src/app/(org)/o/[slug]/admin/events/types/event-types-states.test.tsx
src/app/(org)/o/[slug]/admin/events/types/event-types-states.tsx
src/app/(org)/o/[slug]/admin/events/types/page.test.tsx
src/app/(org)/o/[slug]/admin/events/types/page.tsx
src/app/(org)/o/[slug]/admin/events/types/seed-standard-types-button.test.tsx
src/app/(org)/o/[slug]/admin/events/types/seed-standard-types-button.tsx
src/app/(org)/o/[slug]/calendar/            (whole directory, 21 files incl. [eventId]/)
src/components/org-portal/event-types/      (whole directory, 6 files)
```

Trailers: `Work-Log: 2026-10-14-member-calendar`. Not in commit 6: this work-log and the Rule-16 files.

*Handoff:* **qa** (Phase 5) next; commit 6 is the last code commit.

### Commit 7 (integration, orchestrator) — landed BEFORE commits 5 and 6 (2026-10-15)

Rule-16 files applied from the Phase 3 drafts D1–D5 and D9 ahead of the remaining code commits, so QA's rehearsal has them: `drizzle/meta/_journal.json` idx 54; `scripts/seed-dev.sql` D2 block before the final `commit;`; `scripts/test-rls.sql` D3 (a) three narrowed assertions, (b) the 44d comment, (c) section 45 appended; `docs/TODO.md` Track A split + the open lines (the Done line lands at Phase 6 with the release note); `docs/ui-standards.md` platform-row clause + the category-colour paragraph; `docs/decisions.md` DECISION-160, 161 (architect's text verbatim) and 163–167 (the five D9 implementation rulings, composed by the orchestrator from D9's text). D6–D8 (release note, functionality map, what's-new) are Phase 6 work via `/release-notes`.

**Verification, from scratch on the pipeline's Neon branch** (the live `neondb` there carries the operator's demo membership rows forked from `development`, so section 1's seeded count of 9 Alder Creek memberships reads 10 — data, not code; the proof is the documented recipe on an empty database): `create database integ_check` → `drizzle-kit migrate` **55/55 applied from empty** → `scripts/install-test-helpers.sql` → `npm run db:seed` → `scripts/seed-dev.sql` (16 events, 50 event types, 10 calendar toggles — exactly D2's stated counts) → `scripts/test-rls.sql` as `presby_app`: **exit 0, 678 passes, "Section 45 (member calendar + event types) complete."** Scratch database dropped afterwards. One wrinkle for `docs/testing.md`: running the suite without `npm run db:seed` fails the DECISION-151 group-types assertion (3 rows vs 6) — the recipe already lists `db:seed`, so this is a reader's error, not a doc gap.

Commits: `chore(schema)` (journal + seed-dev), `test(rls)` (test-rls), `docs` (decisions, TODO, ui-standards, both work-logs).

---

# Phase 5 — Verification (qa)

*Recorded verbatim by the orchestrator, 2026-10-15.*

**Date:** 2026-10-15
**Verified by:** qa (read-only. I wrote no repo files and authored no tests. All database writes were either rolled back or made on the throwaway `qa_check` database, which has been dropped.)
**Worktree:** `/Users/cshenso/git/presby-platform/presby-calendar`, branch `pipeline/member-calendar`, ten commits `651f069..60a3511`. The tree is clean apart from the work-log status table.

## Type Check

`npm run typecheck`: **PASS** (exit 0). `npm run lint` (`--max-warnings=0`): **PASS** (exit 0). `npm run check`: **PASS**. All six tripwires pass: audit-coverage, `sql<Date>`, deps-drift, brand-scope, secrets/PII and hydration-gate.

## Unit Tests

| Lane | Files | Tests | Failed | Skipped | Duration |
|---|---|---|---|---|---|
| `npm test` (mocked, no DB env) | 298 passed, 37 skipped | 4182 passed, 1148 skipped | 0 | 37 files / 1148 tests | 14.3s |
| `npm run test:db` (full, serial, pipeline branch `neondb`) | **335 passed of 335** | **5330 passed of 5330** | 0 | **0** | 684s |

- The 37 files skipped in the mocked lane are the `describe.skipIf(!hasDb)` DB suites. All of them ran in the DB lane, which had zero skips.
- **Time-zone discipline.** I ran the pure suites (`src/lib/events/**`, `src/lib/calendar/**`, `src/lib/shared/org-time.test.ts`) once each under outer `TZ=UTC`, `TZ=America/New_York` and `TZ=Pacific/Honolulu`. Each run gave identical results: 9 files passed, 2 skipped, 407 tests passed, 195 skipped. The 2 skipped files are the DB-backed `src/lib/calendar.test.ts` (142 tests) and `src/lib/events.test.ts` (53); both ran in `test:db`. `calendar.test.ts` also loops over all three process zones internally (`describe.each(TEST_TIME_ZONES)`, `src/lib/calendar.test.ts:242`). Not run: `npm test` / `npm run test:db` as a whole under each outer TZ (recipe step 3 in full).
- **Failing-first check, reproduced independently (F134, the only `fix:` commit).** In a scratch copy outside the repo, I replaced `src/lib/events/wall-clock.ts` with main's local-field codec and `recurrence.ts` with main's version. `src/lib/events/wall-clock.test.ts` then went **5 failed / 7 passed**: both non-UTC zones failed, UTC passed. This matches the Phase 4 record. With the files restored (`cmp` identical) it went **12 passed**. The DB-backed twin (`src/lib/events.test.ts:1088–1126`) was not re-run against the old writer; its failing-first evidence is the implementer's recorded output only.

## Schema/RLS Audit (live catalog, after 0054)

Owner connection, read-only transaction, on `neondb` of the pipeline branch:

- `event_types` has `relrowsecurity = t` and `relforcerowsecurity = t`. `events`, `organization_settings` and `organization_feature_toggles` are also FORCE.
- `pg_policies`: one `tenant_isolation`, PERMISSIVE, cmd ALL. Both `qual` and `with_check` are `(organization_id = presby_current_org())`.
- `aclexplode(relacl)`: `presby_app` = INSERT, SELECT, UPDATE. `presby_platform` = INSERT, SELECT, UPDATE. **Neither has DELETE.** `neondb_owner` holds every privilege through ownership.
- `events_event_type_fk`: `confdeltype = 'a'`, `confupdtype = 'a'`, `confmatchtype = 's'`, defined as `FOREIGN KEY (event_type_id, organization_id) REFERENCES event_types(id, organization_id)`.
- **CHECKs present:** `event_types_name_shape`, `_color_allowed` (9 keys), `_icon_allowed` (15), `_fallback_active`, `_neutral_is_fallback`, and `organization_settings_time_zone_valid` (the shape regex AND `at time zone … is not null`).
- **Indexes present:** `event_types_one_fallback_idx … WHERE is_fallback`, `event_types_org_lower_name_idx (organization_id, lower(name))`, `event_types_id_org_key`, and `events_org_type_idx`.
- **Columns:** `events.event_type_id` is a nullable uuid. `organization_settings.time_zone` is `text NOT NULL DEFAULT 'America/New_York'`.
- **Data:** 15 of 15 orgs have exactly one fallback (0 otherwise). Congregations have 9 orgs / 81 types / 45 active; presbyteries 5/5/5; synod 1/1/1. There are 15 settings rows and 15 `org_portal.calendar` toggles, all enabled.
- **CHECK probe (rolled back):** `UTC+5` and `EST` are both refused by `organization_settings_time_zone_valid`. `America/Chicago` is accepted. Alder Creek's value afterwards is still `America/New_York`.
- **Probes as `presby_app`** (`rolbypassrls = f`, rolled back), with the layer that actually refuses each:

| Claim | Probe | Refusing layer |
|---|---|---|
| A cross-org read returns zero rows | Bramblewood GUC, select Alder's fallback by id → 0 (own: 9). No GUC → 0 | RLS `tenant_isolation` |
| No hard delete | `DELETE` → `permission denied for table event_types` | The grant |
| Same-org type only (F2) | Bramblewood event with Alder's type id → 23503 `events_event_type_fk` | Composite FK |
| Owner/platform path | `DELETE` as `neondb_owner` → 8 rows removed, then rolled back. `pg_trigger` on `event_types` is empty | **Nothing.** See advisory A2 |

- `npm run check:schema-parity`: 68 domain tables, 6 differences, all 6 allowlisted, **0 failing**. The result is the same on `neondb` and on the from-empty `qa_check`.
- **Isolation suite, from scratch** (not run against `neondb`, as instructed): `create database qa_check` on the branch; `drizzle-kit migrate` with the URL rewritten by sed: **55/55** rows in `drizzle.__drizzle_migrations`; `install-test-helpers.sql` exit 0; `tsx scripts/seed.ts` exit 0 (40 flags and 6 group_types written to `qa_check`, `neondb` untouched); `seed-dev.sql` (`ON_ERROR_STOP=1`) exit 0, giving 16 events, 50 types and 10 calendar toggles; `scripts/test-rls.sql` as `presby_app` on `qa_check`: **exit 0, 678 `pass` notices, 0 failures, 0 ERROR lines, and "Section 45 (member calendar + event types) complete."** Section 45 contributed 39 passes. `drop database qa_check with (force)` done; `pg_database` is back to `neondb, postgres, template0, template1`.

## End-to-End Tests

**Not an auth-touching diff.** `git diff --name-only main..HEAD` touches nothing under `src/auth.ts`, `src/app/(auth)/`, `src/app/api/auth/` or `src/lib/auth/`. The MFA-enrolled e2e requirement therefore does not apply, although the full suite below includes `totp-full-login.spec.ts` and it passed.

| Run | Total | Passed | Failed | Skipped | Duration |
|---|---|---|---|---|---|
| `E2E_BASE_URL=http://localhost:3700 npx playwright test e2e/member-calendar.spec.ts e2e/hydration/event-types-form.spec.ts` (dev server from this worktree, cwd verified) | 16 | 16 | 0 | 0 | 52.3s |
| Full chromium suite against the same :3700 server (Phase 3 recipe step 5) | 184 | 184 | 0 | 0 | 4.9m |
| `npm run test:e2e:prod` (scratch copy with a hardlinked `node_modules`, fresh `.next`, built and started on :3800) | 4 | 4 | 0 | 0 | 34.3s |

- **Production-lane negative control.** With `<HydrationGate>` removed from `event-type-form.tsx` in the scratch copy and rebuilt, `e2e/hydration/event-types-form.spec.ts:64` went **red**, at `:71` (`toHaveAttribute("aria-busy","true")`, element not found). The scratch copy was then deleted.
- **Servers.** I stopped every server I started: :3700 and :3800 are free. I did not touch :3000.
- **Fixtures.** No leftovers: 0 `e2ca%` events, 0 `E2E %` types, 0 `e2e_calendar_%` roles. `org_portal.events` was restored to `t`, and 0 calendar toggles are off.

**Phone viewport.** Headless Chromium at 375px, mobile/touch, signed in as `clerk.fixture@example.invalid`, against :3700:

- **`/o/alder-creek/calendar`:** HTTP 200, scrollWidth 375 = clientWidth. Grid hidden, list visible, Month/List switch hidden.
- **The `<details>` disclosure:** starts closed ("Show filters", pills hidden); a tap opens it ("Hide filters", pills visible, 44px pill height, still no overflow); a second tap closes it. `<summary>` computes to `display: list-item` and its class list contains no display utility.
- **`/calendar/<id>`:** 200, no overflow. **`/admin/events/types`:** 200, no overflow.
- **`text-xs`:** zero occurrences inside `<main>` on all four pages (calendar, `?view=list`, detail, types). The only `text-xs` in the DOM is the header avatar initials badge, shared chrome not changed by this diff.

Not done from the recipe's step 4: dark mode, a `light_only` org or brand-coloured org, 200% zoom, a black-and-white print preview, a real iOS Safari, and pasting Copy month into a word processor.

## Regression Tests Added

- **G1 (the members-only copy).** `new-event-form.test.tsx:221`, `edit-event-form.test.tsx:210` (hint text); `src/lib/calendar.test.ts:389` (non-public included for members), `:698` (same for upcoming); `e2e/member-calendar.spec.ts:84`.
- **G2 (as ruled: cancelled hidden).** `src/lib/calendar.test.ts:389`, `:643`, `:698`; `e2e/member-calendar.spec.ts:84`, `:137`.
- **G3 (detail projection and 404).** `src/lib/calendar.test.ts:598` (exact key set), `:643` (null after the gate for garbage/foreign/missing/cancelled), `:285` (forbidden before any lookup); `[eventId]/page.test.tsx:134`, `:201`; `e2e/member-calendar.spec.ts:137` (identical 404 body for four ids).
- **G4 (series children copy the type).** `src/lib/events.test.ts:877`, `:890`, `:909`, `:991`; `edit-event-form.test.tsx:193`.
- **G5 / G6 (zone and wall clock).** `org-time.test.ts:16`, `:43`, `:65`; `calendar.test.ts:545`, `:564` (month-end evening), `:575` (no settings row, F132), `:375` (half-open bounds), `:769`; `events/wall-clock.test.ts:23`, `:46`; `events.test.ts:1088–1126`; `org-settings.test.ts:17`, `:27`.
- **G7 (URL params).** `calendar/month.test.ts:100`, `:123`; `calendar/filters.test.ts:44–105`, `:87` (a foreign id does not count toward "N active"), `:180–234` (`safeCalendarBackHref`); `calendar.test.ts:470`; `calendar/page.test.tsx:105`, `:155`; `e2e/member-calendar.spec.ts:147`, `:154`.
- **G8 (state across navigation).** `calendar/month-nav.test.tsx:22`; `page.test.tsx:217`, `:230`; `e2e/member-calendar.spec.ts:109`, `:177`.
- **G9 (clipboard content).** `calendar/clipboard.test.ts:76`, `:91`, `:128`, `:152`, `:161`, `:170`; `calendar/copy-month-button.test.tsx:52`, `:65`, `:132`; `e2e/member-calendar.spec.ts:207`.
- **G10 (fallback and CHECK rules).** `scripts/test-rls.sql:8342`, `:8353`, `:8364`, `:8418`, `:8456`; `event-types.test.ts:350`, `:416`, `:477`, `:537` (NO ACTION cascade proof); `type-seed-plan.test.ts` (18); `type-palette.test.ts` (migration-parity); `domain/events.schema.test.ts`.
- **G13 (empty states).** `calendar/page.test.tsx:344`, `:357`, `:370`, `:382`, `:391`; `calendar.test.ts:485`, `:498`, `:506`, `:518`, `:530`; `admin/events/types/page.test.tsx:171`.
- **G14 (mobile).** `e2e/member-calendar.spec.ts:167`, `:177`; `calendar/calendar-filters.test.tsx:32`; `page.test.tsx:283`, `month-grid.test.tsx:104`, `month-list.test.tsx:71`, `calendar-entry.test.tsx:71`, `[eventId]/page.test.tsx:209`; `e2e/hydration/event-types-form.spec.ts:64`.
- **G15 (the OR gate).** `calendar.test.ts:267`, `:273`, `:279`, `:290`.

**Gaps with no test:** none of the listed G-items is uncovered. One untested edge is advisory A1 below.

## Coverage on Critical Modules

Mocked-lane numbers (`vitest --coverage`, v8). `src/lib/permissions.ts`: **100%** / 100%. `src/lib/two-factor.ts`: **91.3%** statements. `src/lib/flags.ts`: **100%** / 100%. New pure modules at 100% statements: `calendar/{clipboard,filters,month,wall-clock}.ts`, `events/{type-palette,type-seed-plan,wall-clock}.ts`, `org-settings.ts`, `org-portal/visible-tiles.ts`, `shared/org-time.ts`, `shared/uuid.ts`; `events/recurrence.ts` 97.2%; lowest branch coverage `org-time.ts` 87.5% and `clipboard.ts` 96.2%.

## Feature-Gate Audit

Verified by reading the route and action bodies. `src/proxy.ts` is unchanged, and the Edge 2FA gate on `/o/` covers both calendar segments. The diff adds no `route.ts`. Permissions here are `presby_has_permission` catalog rows, not `FEATURES.*`.

| Route or action | `auth()` present? | Gate present? | Correct key? |
|---|---|---|---|
| `GET /o/[slug]/calendar` (`calendar/page.tsx:62`) | yes (`cachedAuth`), then the four-way miss and `assertOrgAccess` (`:92`) | `getMonthCalendar`, inside one `withOrgContext`: the toggle (`calendar.ts:216`) → the view-OR-manage gate in one statement (`:227–244`) → the zone (`:303`) → the queries. `org_portal.events` is read only to show the admin links, and only when `canManage` (`page.tsx:119–126`) | `org_portal.calendar` toggle + `events.view` OR `events.manage` |
| `GET /o/[slug]/calendar/[eventId]` (`[eventId]/page.tsx:41`) | yes, plus `assertOrgAccess` (`:67`) | `getMemberEvent`: gate first (`calendar.ts:458–464`), UUID check after the gate (`:467`), cancelled excluded; `notFound()` on null (`page.tsx:85`) | same |
| `listUpcomingMemberEvents` (consumed by the home pipeline) | the caller's | toggle → gate → zone → query, one `withOrgContext` (`calendar.ts:541–551`) | same |
| `GET /o/[slug]/admin/events/types` (`types/page.tsx:31`) | yes, plus `assertOrgAccess` (`:55`) | the bare `org_portal.events` flag (`:57`), then `listEventTypes` gated on `event_types.manage` (`event-types.ts:176`) | `event_types.manage` |
| the five event-type actions (`types/actions.ts:93–188`) | yes, `auth()` in `resolveActingIdentity` (`:50`); slug re-resolved, never a client org id | `hasEventTypesManage` first inside each library function's `withOrgContext` (`event-types.ts:241`, `:309`, `:374`, `:415`, `:483`); `events.manage` alone is forbidden (`event-types.test.ts:89`); no flag check in the actions, matching the `admin/events/actions.ts` precedent | `event_types.manage` |
| `createEventAction` / `updateEventAction` (`eventTypeId` passed through) | yes | `hasEventsManage` first (`events.ts:406`, `:538`), then `eventTypeUsable` (`:236–249`); a cross-org id returns `invalid_input` (`events.test.ts:925–941`, `:1020–1032`) | `events.manage` |
| Tile gate (`visible-tiles.ts:62–85`) | n/a | flag → the catalog's non-null flag → org toggle. **No permission check.** On error it catches, hides the tile and logs ids only | n/a (DECISION-003 honoured) |

Other invariants checked: no audit rows (DECISION-161 R7; `types/actions.ts:30–39` header, no `@/lib/audit` import); `getPlatformDb()` nowhere in production code under `src/app/(org)/`; no `loading.tsx` under the three new segments; no `console.log` in production paths of the diff; no native dialogs.

## Advisories (not blocking; each should become a tracked line)

- **A1. An empty-string `eventTypeId` gives a 500 instead of `invalid_input`.** `src/lib/events.ts:425` (create) and `:570` (update) guard with `input.eventTypeId && …`, so `""` skips `eventTypeUsable`, is written as `""` (`:461`, `:493`, `:592–594`), and Postgres throws 22P02 uncaught. Reach: only an `events.manage` holder calling the Server Action by hand (the forms map "none" to `null`); the transaction aborts and nothing is written. Untested (`events.test.ts:925–941` covers `"not-a-uuid"` but not `""`). Fix: guard on `!= null`.
- **A2. The DELETE refusal is real only on the tenant connection.** `scripts/test-rls.sql:8319`'s message ("NEITHER connection holds DELETE") credits a grant on `presby_platform`, and nothing connects as that role; the platform connection is `neondb_owner` (DECISION-146), which deleted 8 event types in a rolled-back probe, and no trigger binds that path. The design accepts this (the cascade and fixture teardown rely on owner deletes; no production code deletes types). Fix the assertion wording; have DECISION-161 name the owner path as unbound by design, unlike D10's organizations trigger.
- **A3.** `isCategoryAxisOn()` (a global flag) is read before the `withOrgContext` transaction (`calendar.ts:292`, `:455`, `:539`); the per-org toggle and everything after it are inside the one transaction. Documented in the module header; not a defect.

## Verdict

**PASS**

Every required check is green: typecheck, lint, all six tripwires, the mocked and full DB lanes (0 skips), the three-zone pure runs, the live-catalog re-read, the from-scratch isolation suite (678 passes, Section 45 complete), the feature-gate audit, the dev-server e2e (16/16 targeted, 184/184 full), the production hydration lane (4/4, with a red negative control), and the 375px phone check. Not an auth-touching diff, so the MFA-enrolled requirement is not triggered. A1 and A2 are advisories for Phase 6 / `docs/TODO.md`, not blockers. Recipe step 4 items not run (manual, worth an operator look): dark mode or a `light_only` org, 200% zoom, print preview, real iOS Safari, a Copy-month paste into a word processor.


---

# Phase 6 — Shipped vs Intent (analyst)

*Recorded verbatim by the orchestrator, 2026-10-15. The analyst changed no repo files; its scratch files are in the session scratchpad.*

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> A baseline member opens Calendar from the portal and reads a month grid (or a phone list) of colour-and-icon-typed events. A clerk manages the types behind it, and every operator ruling and Phase 1 flow landed as written. The one defect worth fixing before push is that a cancelled or stale event link says "We couldn't find that organization."

## How I observed it

- **Server and browser.** Dev server from the worktree on :3900; headless Chromium at 375, 1280, 640 and 320px.
- **Users.** `clerk.fixture` (`events.manage` and `event_types.manage`); `elder.fixture` (baseline member role only); `org1@presby.invalid` at `e2e-alpha` (an org with no `member` role).
- **Today in the fixture.** Org-local "today" rendered as Thu Oct 15 2026, correctly marked in the grid.
- **Inferred, not observed:** the home "upcoming" list's exclusion of cancelled events (from QA's DB-lane tests), 2FA mid-enrolment (Edge matcher read by QA, unchanged), and the DB-failure state.

## What's Working

- **Elder's access.** The elder, with no `events.manage`, reads the calendar. The Calendar tile shows on `/o/alder-creek`, in the nav and in the footer (`events.view` through the backfilled baseline `member` role). "Add an event" and "Manage events" are absent from the elder's calendar. The detail page has no "Edit this event" for the elder; the clerk sees it, pointing at `/admin/events/<id>`. `/admin/events/types` shows the designed copy for the elder: "You don't have permission to manage event types at Alder Creek Presbyterian Church. If you think this is a mistake, ask your stated clerk or another administrator there." `/admin/events` forbids the elder too.
- **Phone layout.** At 375px only the list renders and the Month/List switch is gone. No overflow on any page. The "Show filters" disclosure is present.
- **Hostile URLs.** `?month=0000-01`, `?month=garbage&types=not-a-uuid&view=zzz` and `?month=2000-01` all render with no error; the last reads "Nothing is scheduled for January 2000." `?from=https://evil.example` falls back to "Back to calendar" at `/o/alder-creek/calendar`; a valid `from` round-trips. Filtering to Committees in Nov 2026 gives "No events match these event types." with a "Show all event types" link to `?month=2026-11`.
- **Copy Month.** Toast: "Calendar copied (1 members-only event left out)". The clipboard held both `text/plain` and `text/html`; the plain text is `October 2026` then `Sun Oct 4 / 10:30a Sunday worship - Sanctuary` blocks; the HTML has a `<table>` with no `<script>`, `href`, org name, UUID or type name, and excludes the members-only Session meeting and the cancelled supper. Inserted into a contenteditable it renders as a 6×7 month table with a heading (a stand-in for a word processor, not a real one).
- **Dark mode.** Emulated `prefers-color-scheme: dark` on the calendar and the types manager; all text and icons legible. Contrast computed from the live CSS variables for all nine keys:

  | Pair | Light | Dark |
  |---|---|---|
  | ink on tint | 7.52–7.61 | 7.51–7.60 |
  | ink on background | 8.48–8.71 | 10.07–10.66 |
  | ink on card | 8.48–8.71 | 9.25–9.80 |

- **Zoom.** 640px at deviceScaleFactor 2 (200% of 1280) and 320px: overflow 0 everywhere, every filter pill 44px tall. The only sub-44px items are the switch glyphs (their wrapping label is 44px) and the existing "Back to portal" link.
- **Microcopy.** Every specified string is present and verbatim: the public-checkbox hint; "Changes this occurrence only." on a series occurrence, absent on a one-off; "No type (shown as General)", "Event type (optional)", "Colors the event on the calendar."; "The default type can't be retired."; the duplicate-name message echoing what was typed ("You already have an event type called 'worship'.", no row created); "The calendar isn't turned on for Alder Creek Presbyterian Church yet."; "The calendar isn't available to your account at Wrenfield Presbyterian Church yet. If you think it should be, ask your stated clerk or another administrator there."

## Operator rulings, as shipped

| Ruling | What I checked | Result |
|---|---|---|
| Time zone YES | `organization_settings.time_zone` exists, default `America/New_York`, Alder Creek reads it. "Today" is correct. | Matches |
| No platform flag; per-org toggle | `grep` of `scripts/seed.ts` finds no calendar flag. `feature_flags` has 0 rows matching `calendar`. In `src/`, `org_portal.calendar` appears only as the toggle key and tile key. The toggle is on for 15 of 15 orgs. | Matches |
| `events.view` backfill YES | The Alder Creek `member` role holds `directory.view, events.view`. `baselineRoleSeedPlan` grants both. | Matches |
| Cancelled events HIDDEN | The Oct 20 "Fellowship supper" is absent from the month grid, the 375px list and the 1280px `?view=list`; its detail URL returns 404; excluded from Copy Month; the admin list still shows it. The upcoming list is inferred from the DB-lane tests. | Matches |

## Intent-vs-Shipped Diff

- **Tile matrix.** Flipped `org_portal.events` and the Alder Creek toggle as `neondb_owner`, one combination at a time, observed for the clerk and the elder:

  | events flag (E) / calendar toggle (C) | Home tile | Admin hub "Manage events" | Calendar page |
  |---|---|---|---|
  | E on / C on | Calendar | present | grid, "Add an event" and "Manage events" for the clerk only |
  | E off / C on | Calendar | absent | grid, no add or manage links for either user |
  | E off / C off | none | absent | "isn't turned on yet" |
  | E on / C off | none (the dead-end Events tile is gone) | present | "isn't turned on yet" |

  Phase 1 said the same four outcomes; shipped matches. The hub tile shows to the elder too, who gets a forbidden page on click — tiles never check permissions, by design; accepted as drift. **Restore:** `update feature_flags set enabled=true where key='org_portal.events';` and `update organization_feature_toggles set enabled=true where organization_id=(select id from organizations where slug='alder-creek') and feature_key='org_portal.calendar';`. Final state confirmed: events flag `t`, `feature_categories` `f` (as before), Alder Creek toggle `t`, 15 of 15 calendar toggles on.
- **Flows 1–6.** Match, with one exception next.
- **Flow 3 failure.** Phase 1 said a missing id, a foreign id, a non-UUID and (by ruling) a cancelled id all return "the identical 404". Shipped: the four give the same response, but the copy is wrong. **What the member sees:** "We couldn't find that organization. Check the address for a typo. Organization links look like /o/alder-creek…", with a "Back to your organizations" link. **Cause:** `calendar/[eventId]` has no segment-local `not-found.tsx`; it falls through to `/o/[slug]/not-found.tsx`, whose copy is about the organization. `directory/[personId]/not-found.tsx` and `tickets/[id]/not-found.tsx` exist because of exactly this problem. **Why it matters:** the cancelled-hidden ruling makes this path common — a cancelled event's bookmarked, emailed or open-tab link now lands here. Verdict: acceptable on the "identical" requirement, a regression in microcopy quality (N1).
- **G1, members-only.** The elder sees "Session stated meeting" (`is_public` false), and the hint text is present. Matches.
- **G11, print.** With `emulateMedia print`, grayscale and a PDF: the action bar, nav and pills are hidden; entries keep the icon and a 4px solid rule. But the sr-only type name doesn't print and every type's rule is the same dark grey, so in black and white only the small icon identifies the type and nothing maps icons to types. Two print layout flaws: a mid-word break ("Congregationa / l picnic") in narrow cells, and a day number overlapping its entry on the first row after a page break. Acceptable drift, noted as N4.
- **G9, Copy Month versus the screen.** The grid shows the Sep 27 worship in the leading cell; the copy leaves that cell empty (adjacent-month cells numbered but empty, by design). Minor; a newsletter editor may be surprised.
- **Permission gate.** The elder gets the "isn't available" copy where `events.view` is missing — observed for `org1` at `e2e-alpha`, an org with no `member` role. That org's home also shows the Calendar tile, so the click lands on the forbidden page. This is F133, already known and in the TODO draft.

## Edge Cases

- **Empty state:** pass for empty month, filter-hides-all, and org-with-no-events by test and source; the "{Org} hasn't added any events yet." card was not seen rendered live (needs an org with `events.view` and zero events; none reachable without mutating data).
- **Failure microcopy:** pass; flag-off and forbidden strings seen live, the load-error string only in code and QA's tests; the wrong-organization 404 copy is the exception (N1).
- **Permission gate:** pass. **Audit event:** not applicable (DECISION-161). **Mobile (360px):** pass (375, 320 and 640 tested).

## Follow-Ups (each a concrete `docs/TODO.md` line)

I recommend N1 is fixed before pushing. It is a one-file change.

- **N1 (fix before push).** Add `src/app/(org)/o/[slug]/calendar/[eventId]/not-found.tsx` with event-specific copy. Suggested: "We couldn't find that event. It may have been cancelled or removed." Link back to the calendar or home. Keep the "no `loading.tsx` on the segment" rule, and test that all four miss cases render the same string.
- **N2 — QA A1.** `src/lib/events.ts:425` and `:570` guard with `input.eventTypeId && …`, so an empty-string `eventTypeId` skips the pre-check and gives a 500. Guard on `!= null` and add the `""` case beside `events.test.ts:925–941`. Only a hand-crafted action call by an `events.manage` holder triggers it; low priority.
- **N3 — QA A2.** Reword the `scripts/test-rls.sql:8319` assertion message ("NEITHER connection holds DELETE"): the platform connection is `neondb_owner`, and QA's probe deleted 8 event types in a rolled-back transaction. Have DECISION-161 name the owner path as unbound by design.
- **N4 — print.** Add a printed legend (icon to type name) or print the type name visibly; fix the mid-word wrap and the day-number overlap after a page break; consider printing the adjacent-month entries, or saying in Copy Month that they are omitted.
- **N5 — F133, before 0054 reaches production.** Deployment-engineer counts production's org-owned `member` roles and `organization_settings` rows; decide whether the Calendar tile should stay visible for orgs where the baseline grant doesn't reach (the dead-end tile observed at `e2e-alpha`).
- **N6 — release note D6.** Add: "Cancelled events don't appear on the calendar at all; administrators still see them under Manage events." D6 mentions cancelled events only for Copy Month, and the operator ruled against the G2 recommendation.
- **Already in the Phase 3 TODO draft:** the audience tier below "all members"; the time-zone editor; v1 non-goals (all-day, multi-day, week/day views); retired-type events under All and under no filter; S2, S4, S5; `visual:baseline` after the tile move.
- **Not observed:** a brand-coloured or `light_only` org; a real iOS Safari; a real word-processor paste; 2FA mid-enrolment.

## Housekeeping at SHIP

- **Rule 12:** operator request, no feedback row. **Rule 13:** a what's-new entry is warranted; publish the D8 text only once N5's production count shows the baseline grant reaches the target org. **Rule 14:** apply D7; D4 TODO reconciliation plus N1–N5; D6 release note plus the N6 sentence. **Rule 15:** `docs/architecture.md` needs no change.

## Red Flags

None. Nothing needs to reopen an earlier phase.

## Disclosures

- **Cleanup incident.** To shut down the :3900 server the analyst ran a broad `pkill -f next-server`; it had not checked whether the main checkout's demo server on :3000 was running first. *(Orchestrator: it was; restarted after this section was recorded.)*
- **Writes.** Two reversible writes on this pipeline's Neon branch, both restored (the flag/toggle flips; a duplicate-name attempt that created no row). Sessions were created by signing in as fixture users. The :3900 dev server is stopped.

