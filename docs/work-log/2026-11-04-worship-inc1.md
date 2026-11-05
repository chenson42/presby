# Worship Increment 1: teams, positions and the Sunday schedule — Work Log

> **Slug:** `2026-11-04-worship-inc1`
> **Parent:** `2026-11-04-worship` holds the shared Phase 1 (analyst), the research addendum, the operator rulings and the Phase 2 (architect). They are not repeated here. This child holds Phases 3 to 6 of Increment 1 only. Increment 1b (the emailed response link, migration 0086) gets its own child later.
> **Surface:** mixed. Member pages under `/o/<slug>/worship`, authoring pages under `/o/<slug>/admin/worship` (both inside `(org)`, brandable by inheritance), and email. No public surface, no proxy change.
> **Permission(s):** new `worship.manage`, `worship.plan`, `worship.schedule` (all tier 1, no 2FA column). Added to the founding-administrator bundle for congregations and new worshiping communities, with a backfill. A `worship_leader` role template carries the three. Scheduling is also open to a live chair or leader seat on the team's own group.
> **Flag(s):** no global flag. Per-org toggle `org_portal.worship` (provisioned off, self-service, congregations and new worshiping communities). The global `feature_flags` row of the same key is deleted.
> **Estimated complexity:** large
> **Pipeline mode:** Full
> **Pre-assigned (Rule 16):** migration 0085 (0086 reserved for 1b), DECISION-317 onward, F428 onward (F421 to F427 are Phase 2's). Needs from the orchestrator: a worktree `../presby-worship` on its own Neon branch, **one dev-server port (3100 + n)**, and an e2e person-id prefix for `e2e/support/worship-fixture.ts`.
> **Assigned (orchestrator, 2026-11-04):** worktree `../presby-worship`, branch `pipeline/worship-inc1`; Neon branch `pipeline-worship-inc1` (`br-divine-sunset-axp4a78f`, endpoint `ep-autumn-hall-axbadmif`, parent `development`); dev port 3690, production lane 3691; e2e person-id range `00000000-0000-4085-`.
> **Operator approval (2026-11-04), verbatim:** "build as designed". This accepts the three design calls: no removal or time-move notice in Increment 1 (F430, deferred to 1b); worship keys in the founding bundle for congregations and new worshiping communities only; officer-limited positions and the "next service" card (R13) not in Increment 1. It also accepts the recorded residuals F428 (retained email bodies), F429 (reminder time) and S2 (`paper`, DECISION-317).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (in parent) | READY WITH NOTES | 2026-11-04 |
| 2 — Architectural review | architect | Complete (in parent; R1 to R16, F421 to F427) | Approved with suggestions | 2026-11-04 |
| 3 — Technical design | tech-lead | Complete (this file) | Design complete; implementers named; F428 to F432 and DECISION-317 to 327 proposed | 2026-11-04 |
| 3 — amendment 1 (architect addendum C1 to C5) | tech-lead | Complete (this file, "Phase 3 amendment 1") | C1 to C5 folded in; S1 adopted; S2 recorded as a `paper` residual (DECISION-317); DECISION-326 as amended | 2026-11-04 |
| 4 — Implementation | database-admin (Batch 1), api-developer (Batches 0, 2, 3), ux-developer (Batches 4 to 6) | In progress: Batch 0 (api-developer) complete 2026-11-04; Batch 1 (database-admin) complete 2026-11-04 (0085 hand-written, applied twice to the pipeline branch; section 85 147/147 as presby_app); Batches 2 and 3 (api-developer) complete 2026-11-04 (server side done; Batches 4 to 6 are ux-developer's); F434 fix (database-admin) complete 2026-11-05 UTC (0085 in place, re-applied twice; section 85 158 pass) | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 and Phase 2

See `docs/work-log/2026-11-04-worship.md`. Phase 3 below binds R2, R3, R5, R6, R7, R9, R10, R12 and R13, leaves R11 to Increment 1b, and keeps 1b purely additive (R1).

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Increment 1 lets a congregation schedule people into positions on a Sunday service. A **service** is an `events` row plus a one-to-one `worship_services` extension, so the calendar, cancel and members-only behaviour all work. A **team** is a managed `choir` or `team` group plus a one-to-one `worship_teams` extension. Positions, qualifications, serving teams, assignments, blockouts and service types are new tables beside `groups`; `group_memberships` and `events` are not altered. Authority is `worship.manage` (teams, positions, service types), `worship.plan` (services), and `worship.schedule` **or a live chair or leader seat on that team's own group** (people), checked in one sole-writer module `src/lib/worship/store.ts` and again by database triggers. A leader places people as **drafts**, then presses **Send**: one email per person lists their positions and dates. The person signs in, accepts or declines from "My schedule" (a decline reason is a closed choice), and saves "dates I can't serve" (a reason is a closed choice). A leader can record an answer on someone's behalf, attributed. People who may be under 18 get no email of any kind; the leader sees "ask a parent or guardian". A nightly step in the existing maintenance cron emails reminders (never to decliners, cancelled services, minors, or when the toggle is off). Cancelling a service from either Manage events or the worship board runs one hook that closes open requests and emails the people involved. Two small refactors come first and ship green on their own: the event writers move out of `events.ts` into `events/insert.ts`, `events/mutate.ts` (update and cancel, both taking the event-row lock first) and `events/hooks.ts` (the cancel and update fan-out; the worship handler lives in `worship/event-hooks.ts`), and four in-transaction primitives move out of `groups.ts`. Nothing in Increment 1 stores a song, a file or a lyric.

**What Increment 1b adds, so that it is purely additive.** The assignment row already carries `response_source in ('self','on_behalf','link')`; the actor guard refuses `link` until 1b replaces that one function body with a branch that accepts it under a write marker. 1b adds two tables, three definers, new template keys (not changes to Increment 1's four), one nullable column on `worship_assignments` and a route group. `presby_worship_enabled(org)` (in 0085) is the toggle composition 1b's definers reuse.

## Permissions & Flags

| Item | Design |
|---|---|
| New keys (migration 0085, `permissions` catalog, module `worship`) | `worship.manage`: "Set up worship teams, their positions and who can fill them, and save service types". `worship.plan`: "Add, change and cancel worship services and choose which teams serve". `worship.schedule`: "Schedule people into worship positions, send requests, and record answers for them". All tier 1, `requires_two_factor = false`. `worship.view`, `worship.library`, `worship.bulletin` are created with the increments that use them (R8). |
| Who holds them | The **founding-administrator bundle** gains the three keys **for `congregation` and `new_worshiping_community` only** (the toggle's own applicability list), with a 0071-style backfill onto every org-owned `founding_administrator` role of those two types (operator re-ruling of Q9, 2026-11-04). The `worship_leader` template (custom, unprotected, `organization_type_scope` null so both types can adopt it, carries all three) is the delegation tool. No constitutional template, no stated clerk, no wildcard carries them. A presbytery or synod founder does not get them because no worship page exists there. |
| Seat authority | Scheduling only (not `manage` or `plan`): a `chair` or `leader` row, in date for the organization's local today, on a **managed** group that carries a `worship_teams` row, held by an unmerged, living person whose membership has not ended. Per team, so a leader of team A has no reach into team B. Roll membership is **not** required (a hired organist is `staff` or `regular`). Appointing a chair or leader stays under `groups.manage` (R6). |
| Answering your own request, saving your own blockout | No key. The assignee is the authority over their own row; the store derives the person from the session and takes no person parameter. |
| Reading | Any member of the organization sees the "Worship" page and their own requests. The team page is readable by people on its roster and by holders of any worship key. The board is readable by holders of any worship key (full) and by seat holders (their teams only). |
| Toggle | `org_portal.worship` joins `ORG_FEATURE_CATALOG`: `flag: null`, `provisionedOn: false`, `operatorEnabled: false`, `orgTypes: ["congregation","new_worshiping_community"]`, `category: "worship"`. The Features page lists it for an `org_features.manage` holder. Off: no page renders (an honest state, never a 404), no action runs, no request is sent, no reminder or cancel notice is queued. Nothing is deleted. |
| Flag | None added. Migration 0085 deletes the `feature_flags` row `org_portal.worship` (the 0055 precedent); `scripts/seed.ts`, `scripts/ci/e2e-reset-flags.sql` and the go-live "flip off" list lose it. |
| Gate order on every page and action | signed in, then the four-way org miss, then `assertOrgAccess`, then org-type applicability, then the toggle (with the category axis), then the key or seat or own-row check. Each store export repeats the gate inside its own `withOrgContext` transaction (a server action is a public entry point). |
| Permissions vs flags | The toggle answers "is this on"; the keys and the seat answer "may you". A key never stages a rollout. The seat is authority from a dated fact, read live (DECISION-268 pattern); no platform predicate appears in any worship check (Two Hierarchies). |

## API Contract

No new route handler. Server actions, pure modules and one cron step.

### Refactors (Batch 0, behaviour-preserving, own tests, ship green first)

| New file | Contents | Callers |
|---|---|---|
| `src/lib/events/insert.ts` | `insertEventsInTx(tx, organizationId, actor, input): Promise<EventsResult<{eventId, occurrenceIds}>>`: the body of `createEvent` after its gate (field validation, wall-clock parse, type check, the series math via `recurrence.ts`, the insert of parent and children, the website-listing audit row). Also exports `EventsResult`, `EventActor`, `CreateEventInput`, `validateFieldLengths`, the length constants. | `events.ts#createEvent` (gate, then this), `worship/store.ts` |
| `src/lib/events/mutate.ts` (**new; an extension of R3, approved with conditions C1 to C5 by the architect addendum**) | No permission check; each caller gates on its own key. **`updateEventFieldsInTx(tx, organizationId, {eventId, title, description?, location?, startsAt, endsAt?})`**: its first read is the event row `FOR NO KEY UPDATE` (C3), then the cancelled check (`invalid_target`), then validation, then an update of **only** `title`, `description` (left out of the SET when undefined), `location`, `starts_at`, `ends_at` (never `is_public`, `website_listed`, `allows_checkin`, `event_type_id`, `recurrence_*` or `parent_event_id`), then `runEventUpdatedHooks(tx, {organizationId, eventId, before, after})` with the start, end and location before and after (C4); returns `{eventId, queueIds}`. **`cancelEventInTx(tx, organizationId, eventId, actor)`**: locks the event row `FOR NO KEY UPDATE` as its first read (`invalid_target` when absent); an already-cancelled event returns `{changed:false, queueIds:[]}` and runs **no** hook; otherwise sets `cancelled_at`, runs `runEventCancelledHooks`, returns `{changed:true, queueIds}`. Imports only `insert.ts` (types) and `hooks.ts`. **Importers: exactly `src/lib/events.ts` and `src/lib/worship/store.ts` (C2 scan).** | `events.ts#cancelEvent` (now a gate plus a delegation to `cancelEventInTx`, so there is one cancel writer, C4), `worship/store.ts#cancelService` and `updateService` |
| `src/lib/events/hooks.ts` | `runEventCancelledHooks(tx, {organizationId, eventId, actor})` and **`runEventUpdatedHooks(tx, {organizationId, eventId, before, after})`** (C4), each returning `{queueIds: string[]}` combined across consumers (S1, adopted: a caller that wants send-after-commit, as sign-ups does, uses the ids; worship ignores them and relies on the cron). One line per consumer. Batch 0: both lists are empty (`{queueIds: []}`). Batch 3 adds `onServiceCancelledInTx` from **`worship/event-hooks.ts`**. Sign-ups adds its own hook-only file(s) at its integration, under the same import rule. **Consumers never import `events.ts`, `events/{mutate,hooks,insert}.ts` or `worship/store.ts` (C1)**; `hooks.ts` imports consumers; `mutate.ts` and `events.ts#updateEvent` import `hooks.ts`. | `mutate.ts`, `events.ts#updateEvent` |
| `src/lib/groups.ts` (four exports, no permission check, no `server-only` change) | `insertManagedGroupInTx`, `updateManagedGroupInTx`, `addManagedGroupMemberInTx` (role `member` only), `endManagedGroupMemberInTx`. The existing exports call them after their own `groups.manage` gate. Same validations as today (managed only, F21 current-membership shape, overlap check, `ends_on >= starts_on`). | `groups.ts` existing exports, `worship/store.ts` |

Why `mutate.ts`: R3 extracts only the insert, but a worship leader without `events.manage` must be able to edit a service's time and cancel it, or "plan a Sunday" is create-only. With it, one function owns the event-row lock, `cancelled_at` and the fan-out, so a cancel from Manage events and from the worship board are the same code and `events.ts#cancelEvent` is not a second cancel writer. The architect approved it (Phase 2 addendum, conditions C1 to C5, folded in under "Phase 3 amendment 1" below); the fallback (edit and cancel through Manage events only) is **not used**.

### Module layout `src/lib/worship/`

| File | Role |
|---|---|
| `vocab.ts` (pure) | Statuses, `ANSWERS`, the closed reason list (`away`, `work`, `family`, `other` with labels), notice outcomes, key constants, the toggle key. |
| `states.ts` (pure) | The assignment state machine: `canTransition(from, to, actorKind)`; mirrors the trigger, and `states.db.test.ts` drives every (from, to, actor) pair through the trigger and compares. |
| `plan.ts` (pure) | `overlapWindow(startsAt, endsAt)` (an event with no end is treated as two hours), `pickerWarnings(candidate, ctx)`, `mergeBlockoutRanges(existing, added)`, `sendPlan(drafts)` (group by person, order, cap), `summarizeSend`. |
| `starters.ts` (pure) | The six starter position sets (below, Copy). |
| `guest-name.ts` (pure) | `validateGuestName`: trimmed, 1 to 80 characters, no line breaks or control characters, and refused if it contains `@` or seven or more digits ("Enter just a name. Contact details aren't kept here."). |
| `access.ts` | `loadWorshipContext(viewer)`: org-type applicability, then toggle with the category axis, then the viewer's three keys, in **one** `withOrgContext`. Returns `not_applicable`, `toggle_off {canManageFeatures}` or `ok {has}`. Mirrors `reimbursement/access.ts`; it does not import it. |
| `authority.ts` | In-transaction helpers: `holdsKeys(tx, viewer, keys)`, `leadsTeam(tx, viewer, groupId)` (calls `presby_worship_leads_team`), `canScheduleTeam`. Never treasury's helper (`check:treasury-boundaries`). |
| `store.ts` | **The writer of every `worship_*` table**, with `event-hooks.ts` (the only other writer; allow-list exactly these two, C1). One `withOrgContext` transaction per export; gate first; typed `WorshipResult<T>`; audit rows in the same transaction. |
| `event-hooks.ts` (**new, C1**) | `onServiceCancelledInTx` and `onServiceUpdatedInTx` (the update handler is a no-op in Increment 1; it is the registered place a later increment reacts to a service move, F430). Called only by `events/hooks.ts`. May import `vocab`, `messages`, `notify`, `authority`, the audit and queue helpers and `import type` anything; **may not import** `@/lib/events/{mutate,hooks,insert}`, `@/lib/events`, `@/lib/events.ts` or `worship/store.ts` (`import type` allowed), directly or through any file it imports (transitive scan). Writes `worship_assignments` and the queue only through the same trigger-guarded shape as `store.ts`. |
| `reads.ts` | Every read. Reads `events` only for rows that carry a `worship_services` row (DECISION-316 entry below). |
| `notify.ts`, `messages.ts` | Email: `person:role` addressing through `getPersonEmail(tx, id, "role")`, queued with `insertQueueRowInTx` in the causing transaction; pure builders. |
| `sweep.ts` | **The only `getPlatformDb()` user**: the reminder step. |
| `copy.ts` | The user-facing strings of the Copy section, one module imported by pages, actions and tests (`copy.test.ts` also scans for the word "session"). |
| `boundaries.test.ts` | The tripwire scan (Tests, below). |

`WorshipResult<T>` = `ok {data}` | `not_applicable` | `toggle_off` | `forbidden` | `not_found` | `invalid_input {message}` | `conflict {reason, message}` with `reason` in `not_open`, `in_use`, `role_bound`, `duplicate_name`, `over_cap`, `mail_unavailable`. `WorshipViewer` = `{personId, organizationId, organizationType, userId, email}`, always from the session through `resolveOrgContext`, never from a request value.

### Store exports

| Export | Gate | What it does | Audit (same tx) |
|---|---|---|---|
| `createTeam(v, {name, kind: "team"\|"choir", description?, starter?})` | `manage` | `insertManagedGroupInTx` then `worship_teams` then the starter positions. Name 1 to 80 characters. | `WORSHIP_TEAM_CREATED {via:"new", groupId}` |
| `adoptTeam(v, {groupId})` | `manage` **and** `groups.manage` | Makes an existing managed `choir` or `team` group a team. Refused for a derived group, the `court` and `roster` types, or a group already a team. | `WORSHIP_TEAM_CREATED {via:"existing"}` |
| `updateTeam(v, {groupId, name, description?})` | `manage` | `updateManagedGroupInTx`. | none (configuration) |
| `retireTeam(v, {groupId})` | `manage` | Sets `retired_at`. Refused (`in_use`, with the number of upcoming services) while any draft, requested or confirmed assignment exists on an upcoming, uncancelled service. | none |
| `addPosition(v, {groupId, name, slots})`, `updatePosition(v, {positionId, name, slots})`, `retirePosition(v, {positionId})` | `manage` | Name `btrim`'d 1 to 60, unique among live positions of the team, case-insensitive; slots 1 to 20; at most 40 live positions per team. Retire refused (`in_use`) like a team. | none |
| `setQualifications(v, {groupId, personId, positionIds})` | `manage` | Replace-set: ends removed rows (`ended_at`), inserts new ones. The person must be on the roster now. | none |
| `addTeamMember(v, {groupId, personId})`, `endTeamMember(v, {groupId, groupMembershipId})` | `manage` | `member` rows only, through the `groups.ts` primitives. Refused (`role_bound`) when the group carries a live `role_grants` row (R6). Ending a `chair` or `leader` row is refused (`invalid_input`: those are set under Groups). | `WORSHIP_ROSTER_CHANGED {change:"added"\|"ended", groupId, personId}` |
| `createServiceType`, `updateServiceType`, `retireServiceType`, `setServiceTypeTeams` | `manage` | Name 1 to 80 unique among live; `start_time`; `duration_minutes` 15 to 480 or null; `location` up to 200; default teams are live non-retired teams. | none |
| `createService(v, {title, startsAt, endsAt?, location?, serviceTypeId?, groupIds})` | `plan` | `insertEventsInTx` with `isPublic: true, websiteListed: false, allowsCheckin: false`, the organization's active "Worship" event type if it has one (case-insensitive name match, else untyped), then `worship_services` and `worship_service_teams`. Returns a `duplicate` hint (never a refusal) when another service starts at the same minute. | none (events are unaudited unless listed, DECISION-240) |
| `generateServices(v, {serviceTypeId, firstDate, pattern, count})` | `plan` | `insertEventsInTx` with the series input (pattern `weekly`/`biweekly`/`monthly`, count 1 to 26; the events cap of 52 still applies), then one `worship_services` row per occurrence and the type's default teams. | none |
| `updateService(v, {eventId, title, startsAt, endsAt?, location?})` | `plan` | **C2:** first locks the event joined to its service row in the same transaction (`select e.id from events e join worship_services ws on (ws.event_id, ws.organization_id) = (e.id, e.organization_id) where e.id = $1 and e.organization_id = $2 for no key update of e`); **no row is `not_found`**, the same response as an unknown id, so a `worship.plan` holder reaches only worship services. Then `updateEventFieldsInTx` (a cancelled service maps to `conflict not_open`, Copy "That service was cancelled."). | none |
| `cancelService(v, {eventId})` | `plan` | The same join-under-lock (`not_found` for a plain event), then `cancelEventInTx` (which runs the hook). | by the hook |
| `setServiceTeams(v, {eventId, groupIds})` | `plan` | Adds or soft-removes serving teams (`removed_at`). Removing a team with a live assignment on this service is refused (`in_use`). | none |
| `placePerson(v, {eventId, groupId, positionId, personId})` | `schedule` or seat on `groupId` | Locks the event row `FOR NO KEY UPDATE`; inserts a **draft**. | none |
| `placeGuest(v, {eventId, groupId, positionId, guestName})` | same | Inserts a **confirmed** guest row (recorded on the leader's behalf; guests get no mail). | none |
| `removeAssignment(v, {assignmentId})` | same, on the assignment's team | Sets `withdrawn` with reason `removed`. **No message is sent.** | none |
| `recordResponse(v, {assignmentId, answer, reason?})` | same | `response_source = on_behalf`. Same answer again is a no-op (no write, no audit). | `WORSHIP_RESPONSE_RECORDED {assignmentId, eventId, answer}` |
| `sendRequests(v, {eventIds?, groupId?})` | `schedule` or seat; a seat holder's scope is cut to the teams they lead | Locks the affected event rows in `(starts_at, id)` order; takes drafts on future, uncancelled services; re-checks roster and membership per person; sets `requested`, `requested_at`, `sent_by`, `notice_outcome`; queues one email per person listing their positions and dates (to the address from `getPersonEmail(tx, id, "role")`). At most 200 assignments or 52 services per call (`over_cap`). Refuses with `mail_unavailable` when `platformOrigin()` is null. Returns counts by outcome and the queue ids; the **action** attempts the inline send after commit. | `WORSHIP_REQUESTS_SENT {sent, emailed, guardian, noAddress, doNotContact, services}` (counts only) |
| `respondToAssignment(v, {assignmentId, answer, reason?})` | own row | `response_source = self`. Locks the assignment row, then reads the event. A row that is not the viewer's, or does not exist, is `not_found` (identical). A withdrawn row, a cancelled or started service is `conflict not_open`. A change to `declined` queues one `worship.notice.declined` to the person who placed them (if they have a deliverable address; never the decliner's name), and the action attempts the inline send after commit. | none (the row is the record) |
| `addBlockout(v, {startsOn, endsOn, reason?})`, `endBlockout(v, {blockoutId})` | own | `addBlockout` merges overlapping or adjacent live ranges (ends them, inserts the union), refuses an end before the start, a range over 366 days or wholly in the past, and more than 50 live ranges. It returns the viewer's own requested or confirmed assignments inside the range as `conflicts` (the blockout is saved anyway). | none |
| `onServiceCancelledInTx(tx, {organizationId, eventId, actor})` (**lives in `worship/event-hooks.ts`, not `store.ts`, C1**) | called by `events/hooks.ts` | See "The cancel hook" below. Returns `{queueIds}`. | `WORSHIP_SERVICE_CANCELLED {withdrawn, notified}` when it did anything |

### The cancel hook

`onServiceCancelledInTx` (in `src/lib/worship/event-hooks.ts`) runs in the cancel's own transaction, after `cancelled_at` is set, and only on the transition (an already-cancelled event runs no hook). If the event has no `worship_services` row it returns at once. Otherwise: lock every assignment of the event (`FOR UPDATE`, ordered by id); set `requested` and `draft` rows to `withdrawn` with reason `service_cancelled` and no actor (the trigger accepts that exact shape only when the event is cancelled); leave `confirmed` and `declined` rows as they are ("the schedule is retained"); when the toggle is on, queue one `worship.notice.cancelled` per person who was `requested` or `confirmed` (never a draft, decliner or guest), skipping presumed minors and people with no deliverable address. A hook that cannot write its queue rows throws and the cancel rolls back (stated behaviour). The queued rows are sent by the five-minute email-queue cron; there is no inline send on this path. The hook returns the queue ids it wrote (S1); worship's callers ignore them.

### Reads (`reads.ts`)

| Export | Who | Notes |
|---|---|---|
| `getWorshipContext(v)` | any member | wraps `loadWorshipContext` |
| `getMySchedule(v)` | own | upcoming, non-withdrawn assignments grouped waiting, scheduled, declined; each with service title, wall-clock start, team, position, `cancelled`. "Cancelled" comes from the worship read, never from opening the member event page (sign-ups F414). Also the teams the viewer is on or leads. |
| `getRequest(v, {assignmentId})` | own | `not_found` unless the row is the viewer's. |
| `getMyBlockouts(v)` | own | live ranges. |
| `getTeamPage(v, {groupId})` | roster member or any worship key | names, the chair and leader badges, positions each person can fill. **No contact details** in Increment 1. Others get `not_found`. |
| `getServicesList(v, {scope})` | any worship key | upcoming (cap 100) or earlier (last 20); one aggregate query for filled, open and waiting counts. |
| `getServiceBoard(v, {eventId, groupId?})` | any key (all serving teams) or seat (led teams) | positions, assignments with status, reach note, decline reason label, "recorded by". One query per level, no N+1. |
| `getPickerCandidates(v, {eventId, groupId, positionId, showAll})` | `schedule` or seat | roster joined to qualifications, blockouts and overlapping assignments in one query; `plan.pickerWarnings` turns the flags into warnings. Excludes merged, deceased and ended-membership people. |
| `getSendPreview(v, {eventIds?, groupId?})` | `schedule` or seat | the same outcome decision `sendRequests` makes, without writing. |
| `getTeamsAdmin`, `getTeamAdmin(v, {groupId})`, `searchRosterCandidates(v, {groupId, q})`, `getServiceTypes`, `getServiceType`, `getServiceFormOptions` | `manage` or `plan` as named | `searchRosterCandidates` returns at most 20 current members whose name matches, minimum two characters. |
| `countUpcomingScheduled(tx)` | `org_features.manage` (Features page) | `select presby_worship_open_count()`. |

### Server actions

`src/app/(org)/o/[slug]/worship/actions.ts`: `respondToRequestAction`, `addBlockoutAction`, `endBlockoutAction`, and the **scheduling** actions `placePersonAction`, `placeGuestAction`, `removeAssignmentAction`, `recordResponseAction`, `sendRequestsAction` (the admin board imports these from the member tree so the board has one set of actions).
`src/app/(org)/o/[slug]/admin/worship/actions.ts`: team, position, qualification, roster, service-type and service actions.
Each action: `auth()`, resolve the organization from the slug through `resolveOrgContext`, call the store export with a session-derived viewer, map the result to `{ok:true,...} | {ok:false,error:string}` using `copy.ts`, and `revalidatePath` the affected pages. No action takes an organization id or person id from its input. `check:audit` scans only `actions.ts` bodies for literal `db.*` writes; these call the store, so it is blind to them. The audit rows are pinned by `store.audit.db.test.ts` instead (the groups precedent).

### Cron

`src/app/api/cron/maintenance/route.ts` gains an isolated step after the careers sweep: `try { worshipReminders = await runWorshipReminderSweep(); } catch { console.error("[cron/maintenance] worship reminders failed"); }`, a fixed label, counts only in the summary (`worshipRemindersQueued`). No fifth cron. The step skips itself (returns 0, claims nothing) when `platformOrigin()` is null.

### Email (R10)

Four template keys, all `person:role`, registered in `EMAIL_AUDIENCE`, none a credential key: `worship.notice.request`, `worship.notice.reminder`, `worship.notice.cancelled`, `worship.notice.declined`. `notify.ts` and `sweep.ts` pass `templateKey: worshipMessage.templateKey`; `email-audience.test.ts` gains `NAMED["worshipMessage.templateKey"]` listing the four (its scan resolves non-literal keys through that map). Links are plain GETs, built from `platformOrigin()` and a path-safe slug and uuid, with **no query string, `next` or `callbackUrl`**: `/o/<slug>/worship` (several requests, reminders, cancel) or `/o/<slug>/worship/requests/<assignmentId>` (exactly one request) or `/o/<slug>/worship/teams/<groupId>/services/<eventId>` (the decline notice). One email per person per Send. Two people who share one inbox each get their own.

### Audit actions added to `AUDIT_ACTIONS` (and mirrored in `audit.test.ts`)

`WORSHIP_TEAM_CREATED: "tenant.worship.team_created"`, `WORSHIP_ROSTER_CHANGED: "tenant.worship.roster_changed"`, `WORSHIP_RESPONSE_RECORDED: "tenant.worship.response_recorded"`, `WORSHIP_REQUESTS_SENT: "tenant.worship.requests_sent"`, `WORSHIP_SERVICE_CANCELLED: "tenant.worship.service_cancelled"`. Metadata is ids, counts and tags only: never a name, a reason, a note or a guest name. Configuration (positions, service types, qualifications, retire) is unaudited, as groups are. Self answers are not audited (the row's `response_source`, `responded_at` and `responded_by` are the record).

## Data Model

### Migration `drizzle/0085_presby_worship.sql` — contents in order

Hand-written, idempotent as a whole (the 0071 idiom: `if not exists`, `on conflict`, drop-then-add for CHECKs, `create or replace`, revoke-then-grant), proven by applying the file twice. Drizzle mirror: `src/lib/db/domain/worship.ts`; its `index.ts` export is added at integration.

1. **Permission catalog.** Insert the three keys (`on conflict (key) do update` so an in-place description fix replays).
2. **Founding bundle.** `create or replace function presby_founding_administrator_permission_keys(p_org_type text)` with the **live 0071 body** (re-read it at apply time: F362 also re-creates this function) and the worship keys appended:
   `array[<the eleven existing keys, unchanged text, so '…domains.manage', 'careers.manage', 'careers.applicants' stays one substring>] || case when p_org_type in ('congregation','new_worshiping_community') then array['worship.manage','worship.plan','worship.schedule'] else array[]::text[] end || case when p_org_type = 'presbytery' then array['congregation_oversight.manage'] else array[]::text[] end`.
   Same signature, return type, `immutable`, `security definer`, `search_path = public, pg_temp`, revoke from `public, presby_app, presby_platform`. Order is base, worship, oversight; the TypeScript `foundingAdministratorPlan()` is changed to the same order and `invitations.db.test.ts` (equality for every `organization_type` in the catalog) is the pin. Sole definer caller: `presby_apply_founding_administrator` (0059:613), which references it by name.
3. **Backfill.** `insert into app_role_permissions … select r.id, k.key from app_roles r join organizations o on o.id = r.organization_id cross join (values (…3 keys…)) k(key) where r.key = 'founding_administrator' and r.organization_id is not null and o.organization_type in ('congregation','new_worshiping_community') on conflict do nothing`, then `raise notice` with the number of roles topped up. No audit row (migrations are provisioning; the 0071 precedent). Residual as 0057 and 0071: a re-apply re-adds a key a tenant removed from a designation-minted role. The orchestrator records the notice count at apply.
4. **`worship_leader` template.** `app_roles` with `organization_id null, organization_type_scope null, key 'worship_leader', name 'Worship Leader', role_kind 'custom', is_protected false`, inserted by key under `where not exists` (no fixed id: D7), carrying the three keys.
5. **Delete the global flag.** `delete from feature_flags where key = 'org_portal.worship';`
6. **The nine tables** (below), their CHECKs, indexes, `ENABLE` and `FORCE ROW LEVEL SECURITY`, the `tenant_isolation` policy, revoke-then-grant.
7. **Functions and triggers** (below).
8. **Comments** on tables and functions.
9. **Closing assertions** (a `do $$` block that raises): exactly three `worship.%` permission rows, tier 1, no 2FA; `presby_founding_administrator_permission_keys('congregation')` and `('new_worshiping_community')` contain the three keys and `('presbytery')`, `('synod')`, `('general_assembly')` do not; the template carries exactly the three; no protected or constitutional role, no `stated_clerk`, `session_member`, `installed_pastor` or `treasurer` role carries a worship key; every in-scope org-owned `founding_administrator` role carries all three; the `feature_flags` row is gone; every new table has `relforcerowsecurity`; `presby_app` and `presby_platform` hold no `DELETE` on any of the nine.

### Tables

All tenant columns are `organization_id uuid not null references organizations(id) on delete cascade` (reachable only through the guarded fixture teardown, D10). Every FK between tenant tables is composite on `(…, organization_id)`. FKs to `events` and `groups` are **NO ACTION**, never cascade or restrict (the `events_event_type_fk` precedent): a hard delete of a service or team that carries worship rows fails, which narrows F253 for those rows without fixing it. `created_by`/`updated_by` reference `users(id)` (NO ACTION). Person references are composite to `memberships_person_org_key`.

| Table | Key and columns | Constraints and indexes |
|---|---|---|
| `worship_teams` | PK `group_id`; `created_by`, `created_at`, `retired_at` | `unique (group_id, organization_id)` (`worship_teams_group_org_key`); FK `worship_teams_group_fk (group_id, organization_id) → groups (id, organization_id)`. Index `(organization_id) where retired_at is null`. |
| `worship_positions` | `id` uuid PK; `group_id`; `name`; `slots smallint default 1`; `sort_order int`; `retired_at`; `created_by`, `created_at` | `unique (id, organization_id)`; `unique (id, group_id, organization_id)` (the three-column target); FK `worship_positions_team_fk (group_id, organization_id) → worship_teams`; CHECK `name = btrim(name) and char_length(name) between 1 and 60`; CHECK `slots between 1 and 20`; unique index `(organization_id, group_id, lower(name)) where retired_at is null`; index `(organization_id, group_id, sort_order)`. |
| `worship_position_qualifications` | `id`; `group_id`; `position_id`; `person_id`; `ended_at`; `created_by`, `created_at` | FK `(position_id, group_id, organization_id) → worship_positions (id, group_id, organization_id)`; FK `(person_id, organization_id) → memberships (person_id, organization_id)`; unique `(position_id, person_id) where ended_at is null`; index `(organization_id, person_id) where ended_at is null`. Roster presence is **not** a constraint: the picker joins `group_memberships` live, so someone who leaves the team drops out with no write. |
| `worship_service_types` | `id`; `name`; `start_time time not null`; `duration_minutes int`; `location text`; `retired_at`; `created_by`, `created_at` | `unique (id, organization_id)`; CHECKs: name `btrim` 1 to 80, duration null or 15 to 480, location null or ≤ 200; unique `(organization_id, lower(name)) where retired_at is null`. |
| `worship_service_type_teams` | PK `(service_type_id, group_id)`; `removed_at` | FK `(service_type_id, organization_id) → worship_service_types (id, organization_id)`; FK `(group_id, organization_id) → worship_teams (group_id, organization_id)`. |
| `worship_services` | PK `event_id`; `service_type_id` null; `updated_by`; `created_at`; `updated_at` | `unique (event_id, organization_id)`; FK `worship_services_event_fk (event_id, organization_id) → events (id, organization_id)` NO ACTION; FK `(service_type_id, organization_id) → worship_service_types`. **A service's identity is this row, not an event type** (R2; types are renameable per-org display). No state column (draft/published arrives with Increment 2). |
| `worship_service_teams` | PK `(event_id, group_id)`; `removed_at`; `created_at` | `unique (event_id, group_id, organization_id)` (the three-column target); FK `(event_id, organization_id) → worship_services (event_id, organization_id)`; FK `(group_id, organization_id) → worship_teams`. |
| `worship_assignments` | see below | see below |
| `worship_blockouts` | `id`; `person_id`; `starts_on date`; `ends_on date`; `reason text` null; `ended_at`; `created_at` | FK person composite; CHECK `ends_on >= starts_on`; CHECK `ends_on - starts_on <= 365`; CHECK reason null or in the closed list; **no free-text column** (R12); index `(organization_id, person_id) where ended_at is null`. |

**`worship_assignments`** columns: `id`; `event_id`; `group_id`; `position_id`; `person_id` null; `guest_name` null; `status` default `'draft'`; `assigned_by_person_id` not null; `sent_by_person_id` null; `requested_at` null; `notice_outcome` null; `responded_by_person_id` null; `response_source` null; `responded_at` null; `decline_reason` null; `withdrawn_by_person_id` null; `withdrawn_reason` null; `withdrawn_at` null; `unanswered_reminded_at` null; `reminded_at` null; `created_at`; `updated_at`.
Constraints: `unique (id, organization_id)`; FK `(event_id, group_id, organization_id) → worship_service_teams (event_id, group_id, organization_id)` and FK `(position_id, group_id, organization_id) → worship_positions (id, group_id, organization_id)` (R5's two three-column keys: a position from another team, or a team that is not serving this service, is refused by the database); FKs `(person_id|assigned_by_person_id|sent_by_person_id|responded_by_person_id|withdrawn_by_person_id, organization_id) → memberships (person_id, organization_id)`.
CHECKs: `num_nonnulls(person_id, guest_name) = 1`; guest name `btrim` 1 to 80 with no line breaks; `status in ('draft','requested','confirmed','declined','withdrawn')`; a guest row is only `confirmed` or `withdrawn`; `response_source in ('self','on_behalf','link')` and `(response_source is null) = (responded_at is null) = (responded_by_person_id is null)`; `decline_reason` null or in the closed list; `notice_outcome` null or in `('emailed','guardian','no_address','do_not_contact')`; `withdrawn_reason` null or in `('removed','service_cancelled')`; `(status = 'withdrawn') = (withdrawn_at is not null) = (withdrawn_reason is not null)`.
Indexes: unique `(event_id, position_id, person_id) where person_id is not null and status <> 'withdrawn'` (one live row per person per position per service); `(organization_id, person_id, event_id) where person_id is not null and status <> 'withdrawn'` (My schedule); `(organization_id, event_id, group_id)` (the board); `(organization_id, status) where status in ('requested','confirmed') and person_id is not null` (the sweep and the open count).

### Functions and triggers

All guards are `SECURITY INVOKER`, `search_path = public, pg_temp`, and bind **every** connection including the owner's (F44); refusals are `check_violation` with a `worship:` message prefix, delete refusals are `insufficient_privilege`. No function has a defaulted parameter.

| Function | Kind | Purpose |
|---|---|---|
| `presby_worship_org_today(uuid) → date`, `presby_worship_org_now(uuid) → timestamp` | definer, stable, EXECUTE to `presby_app` | The organization's local date and wall-clock now (`organization_settings.time_zone`, default `America/New_York` pinned to `DEFAULT_ORG_TIME_ZONE` by a test). The wall-clock `now` is compared with `events.starts_at` (DECISION-113 ruling 3). The careers helper is not reused. |
| `presby_worship_enabled(p_org uuid) → boolean` | invoker, stable, EXECUTE to `presby_app` | The toggle composed in SQL exactly as `orgFeatureEnabledInTx` composes it: org type in the allow-list, then category axis flag and `worship` category row (missing row is on), then the toggle row (missing is off). Its literals are pinned to the catalog entry by `worship-toggle.test.ts`, and `enabled.db.test.ts` compares it with `orgFeatureEnabledInTx` over the whole type × axis × category × toggle matrix. Increment 1b's definers reuse it. |
| `presby_worship_leads_team(p_org uuid, p_person uuid, p_group uuid, p_as_of date) → boolean` | invoker, stable, EXECUTE to `presby_app` | The seat (R7): managed group carrying a `worship_teams` row; a `group_memberships` row with `group_role in ('chair','leader')`, `starts_on <= p_as_of` and (`ends_on is null` or `ends_on > p_as_of`); person unmerged, `date_of_death is null`, `memberships.ended_on is null`. Callers pass `presby_worship_org_today(p_org)`. |
| `presby_worship_may_schedule(p_org uuid, p_person uuid, p_group uuid) → boolean` | invoker, stable | `presby_has_permission(p_person, p_org, 'worship.schedule')` **or** the seat. Used by the triggers. |
| `presby_worship_open_count() → integer` | definer, EXECUTE to `presby_app` | A bare count of distinct people with a `requested` or `confirmed` assignment on an upcoming, uncancelled service, for `presby_current_org()` only (zero with no context). Behind the Features warning; readable by an `org_features.manage` holder with no worship key (the `presby_reimbursement_open_count` precedent). |
| `presby_worship_claim_reminders(p_batch integer)` | definer, **owner only** (`revoke … from public, presby_app, presby_platform`), cross-org writer | The reminder claim (DECISION-325). |
| `presby_worship_guard_immutable()` | trigger, BEFORE UPDATE on the eight tables other than assignments | `TG_ARGV[0]` lists the columns that may change, `TG_ARGV[1]` the set-once columns (null to non-null only). Everything else must equal OLD. `worship_service_teams.removed_at` and `worship_service_type_teams.removed_at` are settable and clearable (re-adding a team). |
| `presby_worship_guard_delete()` | trigger, BEFORE DELETE on all nine | Allowed only when the organization row is already gone (the fixture-teardown cascade); otherwise `insufficient_privilege`. |
| `worship_teams_guard_insert` | trigger | The group must be `membership_source = 'managed'` and its type key `choir` or `team` (refuses derived groups and the `court` and `roster` types; `groups_reject_derived_edit` already stops a managed group becoming derived). |
| `worship_positions_guard_insert`, `worship_service_teams_guard_insert` | triggers | Team not retired; the service not cancelled. |
| `worship_blockouts_guard_insert` | trigger | `ends_on` not before today; at most 50 live rows per person, counted under `pg_advisory_xact_lock` on the person. |
| `worship_assignments_guard_insert`, `worship_assignments_guard_update` | triggers | The actor check and state machine below. |
| `worship_touch_updated_at` | trigger on services and assignments | Sets `updated_at`; trigger-owned, in no grant. |

**The assignment guard (R7).** The actor id comes from the application, so the trigger checks that the *named* person is allowed the act, not that the caller is that person. That is the accepted `paper` residual (sole-writer scan and session-derived actor are the mitigations).

| Transition | Actor column that must satisfy the rule | Also required |
|---|---|---|
| insert as `draft` (person) | `assigned_by_person_id`: `presby_worship_may_schedule` on the group | service not cancelled and `starts_at` after org-now; team not retired; position live and in the team; the person is on the roster **now** (a `group_memberships` row in date), unmerged, living, membership active |
| insert as `confirmed` (guest) | `assigned_by_person_id` as above | `response_source = 'on_behalf'`, `responded_by_person_id = assigned_by_person_id` |
| `draft → requested` | `sent_by_person_id`: may schedule | `notice_outcome` not null; `requested_at` stamped by the trigger |
| `draft\|requested\|confirmed\|declined → confirmed\|declined` | `self`: `responded_by_person_id = person_id`. `on_behalf`: may schedule. `link`: **refused in Increment 1** | service not cancelled and not started; `decline_reason` only with `declined`, else cleared; `responded_at` stamped |
| any non-withdrawn → `withdrawn` | `withdrawn_by_person_id` may schedule with reason `removed`; or no actor with reason `service_cancelled` **and** the event has `cancelled_at` | `withdrawn_at` stamped; terminal |
| anything → `draft`, or out of `withdrawn` | never | |
| every insert and every `draft → requested` | | the (service, team) row in `worship_service_teams` is not removed (`removed_at is null`) |
| identity columns (`event_id`, `group_id`, `position_id`, `person_id`, `guest_name`, `assigned_by_person_id`, `created_at`) | immutable | the owner may update only `unanswered_reminded_at` and `reminded_at` (the claim function) |

### RLS and grants

Each of the nine: `ENABLE` and `FORCE ROW LEVEL SECURITY`; policy `tenant_isolation` `using/with check (organization_id = presby_current_org())`; `revoke all on <table> from public, presby_app, presby_platform` then `presby_app`: `SELECT` on all columns plus **column-limited** `INSERT` and `UPDATE`; **no `DELETE` anywhere**; `presby_platform` nothing (Two Hierarchies: no platform page reads worship data). Columns granted:

| Table | INSERT | UPDATE |
|---|---|---|
| `worship_teams` | `group_id, organization_id, created_by` | `retired_at` |
| `worship_positions` | `organization_id, group_id, name, slots, sort_order, created_by` | `name, slots, sort_order, retired_at` |
| `worship_position_qualifications` | `organization_id, group_id, position_id, person_id, created_by` | `ended_at` |
| `worship_service_types` | `organization_id, name, start_time, duration_minutes, location, created_by` | `name, start_time, duration_minutes, location, retired_at` |
| `worship_service_type_teams` | `organization_id, service_type_id, group_id` | `removed_at` |
| `worship_services` | `event_id, organization_id, service_type_id, updated_by` | `updated_by` |
| `worship_service_teams` | `organization_id, event_id, group_id` | `removed_at` |
| `worship_assignments` | `organization_id, event_id, group_id, position_id, person_id, guest_name, assigned_by_person_id, status, responded_by_person_id, response_source, decline_reason` | `status, sent_by_person_id, notice_outcome, responded_by_person_id, response_source, decline_reason, withdrawn_by_person_id, withdrawn_reason` |
| `worship_blockouts` | `organization_id, person_id, starts_on, ends_on, reason` | `ended_at` |

Trigger-owned and in no grant: `requested_at`, `responded_at`, `withdrawn_at`, `unanswered_reminded_at`, `reminded_at`, `updated_at`. `scripts/test-rls.sql` (at integration) gains the FORCE flags, a cross-org refusal through **each** composite FK, the no-`DELETE` assertion by `aclexplode(relacl)` for `presby_app` and `presby_platform` (the F38/F253 lesson), and the template count 8 to 9 at line 7932.

### Feasibility check against the live tree (done 2026-11-04)

- **Signatures.** No function has a defaulted parameter; `presby_worship_leads_team` takes `p_as_of` required, so the "defaults trail" rule cannot be violated.
- **ALTER and DROP.** Nothing alters or drops a column or table. The one `create or replace` is `presby_founding_administrator_permission_keys(text)` with the signature, return type, volatility, security and `search_path` of 0071:105 (only definer caller: `presby_apply_founding_administrator`, 0059:613, which references it by name and keeps working; 0061 and 0068 only mention it in comments). The one `delete` is the `org_portal.worship` flag row. Application readers of that flag: `admin/worship/page.tsx` (replaced), `tiles.ts:495` `flagKey` (replaced), `scripts/seed.ts:773`, `scripts/ci/e2e-reset-flags.sql:94`, `tiles.test.ts:75`, `visible-tiles.test.ts:228`, `admin/worship/page.test.tsx:131,139`: all in the modify list. No `drizzle/` function body names the flag (grepped), so there is no silent definer break.
- **CHECKs and triggers against fixtures.** No existing table gains a CHECK or trigger, and all nine tables are new and empty. The only rows the migration writes into existing tables are `app_role_permissions` and one `app_roles`; `scripts/seed-dev.sql` has no `founding_administrator` role and no worship row (grepped), so nothing contradicts it. `app_role_permissions`' giving guard ignores a non-giving key.
- **FKs.** Both sides carry `organization_id` and the targets exist: `groups_id_org_key`, `events_id_org_key`, `memberships_person_org_key`; the new targets (`worship_teams_group_org_key`, the two three-column keys, `worship_services` and `worship_service_teams` keys, `worship_service_types` id key) are declared in the same file before use. `users` references are single-column by house rule.
- **Schema parity (`check:schema-parity`).** `worship.ts` mirrors columns, nullability and FK shape exactly; `worship.schema.test.ts` pins constraint names.
- **The integration hazard.** F362 (founder `events.manage`, `event_types.manage`, `branding.manage`) also re-creates `presby_founding_administrator_permission_keys`. The second pipeline to merge must re-read the live body (two `create or replace`s with different arrays silently drop the first one's keys); `invitations.db.test.ts` is what catches it. Sign-ups holds 0084 and does not touch this function.

## Component / Page Plan

All pages are Server Components, inside `(org)` (so they inherit the brand and the proxy's authentication, active-status and 2FA checks). **No `loading.tsx` under `worship/**` or `admin/worship/**`** (DECISION-251; several segments call `notFound()`). Each page repeats the `(org)` auth sequence in full. Dates render through `<FormattedDate>` (never `toLocale*`). A page links its help through `HelpLink`/`helpHref` only. Every `useForm` root renders `<HydrationGate>`. No native dialogs; confirmations use `AlertDialog`. **360px:** every list is a card list (no table), targets are at least 44px (`min-h-11`), text wraps with `[overflow-wrap:anywhere]`, and a status is never colour alone (text plus icon).

### Pages to create

| Route | Purpose | Notes |
|---|---|---|
| `worship/page.tsx` | "Worship": waiting for your answer, you're scheduled, you said you can't serve, your teams, link to dates | Gate states from `worship-states.tsx`. |
| `worship/requests/[assignmentId]/page.tsx` | One request: Accept or Decline | Unknown or not-yours: `notFound()`. Withdrawn, cancelled or started: the "no longer open" state with a link to the schedule. |
| `worship/blockouts/page.tsx` | "Dates I can't serve" | |
| `worship/teams/[groupId]/page.tsx` | Team page: leaders, people with their positions, upcoming services for those who may schedule | Not a roster member and no key: `notFound()`. |
| `worship/teams/[groupId]/services/[eventId]/page.tsx` | The scheduling board for one team on one service | Authority: `schedule` or the seat; others `notFound()`. |
| `admin/worship/page.tsx` | "Plan worship" hub (**replaces the "coming soon" stub**) | Cards only for keys the viewer holds. |
| `admin/worship/teams/page.tsx`, `teams/new/page.tsx`, `teams/[groupId]/page.tsx` | Teams list; new team (starter set, or an existing group when the viewer also holds `groups.manage`); one team: positions, people, who can fill what, retire | `manage`. |
| `admin/worship/service-types/page.tsx`, `new/page.tsx`, `[serviceTypeId]/page.tsx` | Service types | `manage`. |
| `admin/worship/services/page.tsx`, `new/page.tsx`, `generate/page.tsx`, `[eventId]/page.tsx` | Services list; add one; add several from a type; the full board (all serving teams), edit details, serving teams, cancel | `plan` (the board's scheduling controls need `schedule` or a seat). |

### Components

- **Shared by both trees** (`src/components/worship/`): `team-board.tsx` (server; one team's positions and assignments), `assignment-row.tsx`, `status-chip.tsx`, `reach-note.tsx`, `service-summary.tsx`, and client components `person-picker-dialog.tsx` (candidate list with warnings and "Show everyone on the team"), `guest-form.tsx`, `record-response-dialog.tsx`, `remove-assignment-dialog.tsx` (`AlertDialog`), `send-requests-dialog.tsx` (the preview, then Send).
- **Member tree, colocated:** `worship-states.tsx` (`WorshipOff`, `WorshipForbidden`, `WorshipNotApplicable`, `WorshipLoadError`, `RequestClosed`), `request-actions.tsx` (client; Accept, Decline with the reason select, a pending state; idempotent so a double tap is harmless), `blockout-form.tsx` (client, `useForm`), `blockout-list.tsx`.
- **Admin tree, colocated:** `team-form.tsx`, `position-form.tsx`, `roster-editor.tsx` (client; search then add; remove through `AlertDialog`), `qualifications-editor.tsx` (client), `service-type-form.tsx`, `service-form.tsx`, `generate-form.tsx`, `cancel-service-dialog.tsx`, `retire-dialog.tsx`.

### Files to modify

| File | Change |
|---|---|
| `src/lib/org-features.ts` | Add the `org_portal.worship` catalog entry (comment block in the house style). |
| `src/lib/org-portal/tiles.ts` | Replace the stub tile (`worship`, `flagKey`, `comingSoon`, href `/admin/worship`) with two toggle-gated tiles: `worship` (operate, `/o/<slug>/worship`, label "Worship") and `worship-admin` (administer, `/o/<slug>/admin/worship`, label "Plan worship"), both `orgFeatureKey: "org_portal.worship"`, `domain: "worship"`, `orgTypeScope: ["congregation","new_worshiping_community"]`, no `flagKey`, no `comingSoon`. |
| `src/components/org-portal/tile-icons.tsx` | Add `"worship-admin"` (a calendar-check glyph); `worship` keeps `Music`. |
| `src/lib/org-feature-warnings.ts` | Add the `org_portal.worship` loader and fallback (count from `presby_worship_open_count()`). |
| `src/lib/onboarding/founding-administrator.ts` | The plan appends the three keys for the two types, order base, worship, oversight; update the comment block. |
| `src/app/(admin)/admin/organizations/[id]/founding-administrator-section.tsx:44` | `PERMISSION_LABELS` gains `worship.manage: "worship teams"`, `worship.plan: "worship services"`, `worship.schedule: "worship scheduling"`. |
| `src/lib/audit.ts` | Five actions. |
| `src/lib/contact-methods/email-audience.ts` | Four `person:role` keys. |
| `src/lib/events.ts` | `createEvent` and `cancelEvent` gate, then delegate to `insertEventsInTx` and `cancelEventInTx` (one cancel writer). `updateEvent` keeps its own wider-column statement but (C3) takes `FOR NO KEY UPDATE` on the event row as its first read, before the cancelled check (its select gains start, end and location), and (C4) calls `runEventUpdatedHooks` after its UPDATE. Re-export the moved types. |
| `src/lib/groups.ts` | Four primitives; existing exports delegate. |
| `src/lib/calendar-visibility.source.test.ts` | `ALLOWED_READERS` gains (the test is exact in both directions, so a file is listed **only if it reads `events`**; the implementer greps `from events` and the test decides) `src/lib/events/mutate.ts` (C5, the architect's text: "writer: locks and reads one event row by id; returns no event content to its caller beyond the id, and passes before/after start, end and location only to the update hooks"), `src/lib/events/insert.ts` **if** it reads `events` ("writer: reads at most the series parent it is extending; returns ids only"), `src/lib/worship/event-hooks.ts` **if** it reads `events` ("reads the cancelled service's title and start, only for an event carrying a `worship_services` row, to build the cancel notice; returns queue ids only"), `src/lib/worship/reads.ts` ("reads only events carrying a `worship_services` row; authority is the viewer's own assignment, a leader seat on a serving team, or a worship key; selects title, start, end, location and `cancelled_at` only") and `src/lib/worship/store.ts` ("locks one event row and reads its id, start and `cancelled_at`; never selects content"). Any member-wide worship read in a later increment goes through `memberVisible()`. |
| `src/app/api/cron/maintenance/route.ts` | The isolated reminder step. |
| `src/app/(org)/o/[slug]/admin/groups/add-group-member-form.tsx` | One helper line under the role select (Copy G9). |
| `scripts/seed.ts`, `scripts/ci/e2e-reset-flags.sql` | Remove the `org_portal.worship` flag (`scripts/e2e-reset-flags.test.mjs` pins their parity). |
| `docs/…` and `src/content/help/…` | See "Help pages" and the Integration list. |

### Help pages to add or edit (Workflow Rule 17)

- **Add** (published in the feature's own commit, no token): `worship-serving-on-a-team` (audience everyone, covers `tile:worship`), `worship-scheduling-a-team` (everyone, for team leaders and anyone who schedules), `worship-setting-up` (administrator, covers `org_portal.worship` and `tile:worship-admin`, **`replaces: ["worship-planning"]`**). Drafted text in Copy. No new screenshots (text-only; fewer committed images to read for real data).
- **Retire:** the `worship-planning` planned placeholder (registry entry deleted in the same commit that moves its TODO line to Done; `slug-history.ts` is append-only, so `worship-planning` stays in it and the three new slugs are appended; `replaces` is what satisfies `check:help` H3).
- **Edit:** `first-day-as-administrator` (line 13 names "Worship & Service Planning" as a stub; the founder bullet list), `roles-who-can-do-what` (line 39 template list; line 49 founder list), `turning-features-on-and-off` (the table row; the card warning), `events-and-the-calendar` (services are calendar events), `why-cant-i-see-this` (worship cases); `registry.ts` labels at 396 to 398 and the entries' `verifiedIn`; `coverage-allowlist.ts:30` loses `tile:worship` and `coverage.test.ts:201` and its pinned length follow.
- **Images:** `portal-tiles` and `admin-hub` are checked for the old "Worship & Service Planning" tile (the seed had the flag on); re-capture with `npm run help:shots` against a fixture-only database only if it appears, then open every image for real data.

## Implementation Order

Each batch ends green (`npm run typecheck`, `npm run lint`, `npm run check`, the batch's tests) and is committed by the user's gesture, not the agent's.

0. **Batch 0 — refactor (api-developer).** `events/insert.ts`; `events/mutate.ts` (`updateEventFieldsInTx` and `cancelEventInTx`, lock-first, C3); `events/hooks.ts` with **both** `runEventCancelledHooks` and `runEventUpdatedHooks` (empty lists, `{queueIds: []}`, C4/S1); `events.ts#cancelEvent` delegating to `cancelEventInTx`, `#createEvent` to `insertEventsInTx`, `#updateEvent` taking the C3 lock and calling the update hooks; the four `groups.ts` primitives. New in this batch: `src/lib/events/mutate.db.test.ts` (lock-first, the excluded columns unchanged, hook invoked once on transition and not on a repeat cancel), `src/lib/events/boundaries.source.test.ts` (the C1 hook-import scan and the C2 importer scan, each with a deliberately offending sample so the scan can fail), and the DECISION-316 `ALLOWED_READERS` entry for `mutate.ts` (and `insert.ts` if it reads). Existing tests green unchanged apart from import paths; new unit tests for each primitive; `events.test.ts` and `groups.test.ts` still pin the old behaviour. No schema.
1. **Batch 1 — schema (database-admin).** `drizzle/0085_presby_worship.sql`, `src/lib/db/domain/worship.ts`, `worship.schema.test.ts`, `worship.db.test.ts`, `scripts/worship/test-rls-85.sql`, `scripts/worship/seed-dev-worship.sql` (invented names, `.invalid` addresses), the integration patches. Apply to the pipeline Neon branch **twice** (idempotence). Run `check:schema-parity`.
2. **Batch 2 — catalog, keys, pure modules, config store (api-developer).** `ORG_FEATURE_CATALOG` entry and `worship-toggle.test.ts`; tiles (data only); the TypeScript founding plan, the platform-admin labels, `designation-parity.golden.json` regenerated and the parity tests; `AUDIT_ACTIONS`; `vocab`, `states`, `plan`, `starters`, `guest-name`, `access`, `authority`, `copy`; the configuration store exports and their actions; `reads` for teams, positions and service types; seed and e2e flag cleanup (`scripts/seed.ts`, `e2e-reset-flags.sql`).
3. **Batch 3 — scheduling, mail, cron (api-developer).** The scheduling store exports (`updateService`/`cancelService` with the C2 join-under-lock), `worship/event-hooks.ts` and its one line wired into `events/hooks.ts` (cancel; the update line is a no-op handler), `notify`/`messages`, `sweep` and the cron step, the Features warning, the audience registry, the DECISION-316 entries, `boundaries.test.ts`, `states.db.test.ts`.
4. **Batch 4 — member surface (ux-developer).** Member pages, shared board components, `worship-states.tsx`, the tile in the portal, the `groups` helper line.
5. **Batch 5 — authoring surface (ux-developer).** Admin pages and forms; replace the stub page and its test.
6. **Batch 6 — help, housekeeping, e2e (ux-developer, with api-developer for fixtures).** Help pages and edits, the copy tests, the e2e fixture and specs, the hydration spec, a 360px walk in a real browser on a phone viewport, then the release-notes entry through `/release-notes` after Phase 6.

Audit events are written in Batches 2 and 3 with their store exports, not afterwards.

## Tests the implementer writes (QA runs, authors none)

| File | Pins |
|---|---|
| `src/lib/worship/states.test.ts`, `plan.test.ts`, `starters.test.ts`, `guest-name.test.ts`, `copy.test.ts` | Pure: the transition table; warnings and the two-hour window; merge of ranges; send grouping and caps; starter sets; guest-name refusals (`@`, seven digits, line break); no string in `copy.ts` or the help drafts contains the word "session" (G3). |
| `src/lib/db/domain/worship.schema.test.ts`, `worship.db.test.ts` | Constraint and index names; every composite FK refuses a cross-org row; a position from another team and a team not serving the service are refused; the guards; grants by `aclexplode`; `FORCE` on all nine; no `DELETE` for either role. |
| `src/lib/worship/states.db.test.ts` | Every (from, to, actor-kind) pair through the real trigger equals `canTransition`. |
| `src/lib/worship/store.db.test.ts`, `store.audit.db.test.ts` | The authority matrix (key, seat, neither; per team; a seat that ended yesterday; a merged or deceased leader); the id-guessing hole (another person's assignment id equals an unknown id); cancelled and started services; double answer idempotence; roster-write limits (`role_bound`, `member` only); Send (drafts only, re-check, caps, outcomes, `mail_unavailable`); every audit row and its metadata; the lock order under two concurrent Sends and under a Send racing a cancel; **C2:** a holder of `worship.plan` and not `events.manage` calls `updateService` and `cancelService` on a **plain event** (no `worship_services` row) and gets `not_found` each time, the event row is byte-unchanged (`row_to_json` before and after), and no hook side effect exists (no assignment change, no queue row, no audit row); the same calls on a real service succeed. |
| `src/lib/worship/reads.db.test.ts` | Self-read isolation (another member's, another organization's, a toggled-off organization's rows are not returned); the picker flags; no N+1 (statement count). |
| `src/lib/worship/notify.db.test.ts`, `messages.test.ts` | One email per person; `person:role` address; do-not-contact, no address, presumed minor give no row and the right `notice_outcome`; a null `platformOrigin()` writes nothing; the link is exactly `origin + path` with no `?`; the bodies carry no other person's name and no free text. |
| `src/lib/worship/sweep.db.test.ts` | Windows (72h unanswered, 48h confirmed), once only, never to declined, withdrawn, cancelled, minor, merged, ended or toggle-off; the claim and the queue rows commit together; a rolled-back transaction un-claims. |
| `src/lib/worship/enabled.db.test.ts`, `worship-toggle.test.ts` | `presby_worship_enabled` equals `orgFeatureEnabledInTx` over the whole matrix; literals pinned to the catalog entry. |
| `src/lib/worship/boundaries.test.ts` | `store.ts` and `event-hooks.ts` are the only files naming a worship table in a write (C1; exactly these two); `event-hooks.ts` imports none of `@/lib/events`, `events/{mutate,hooks,insert}` or `store.ts` except `import type`, directly or transitively; nothing else imports `event-hooks.ts` but `events/hooks.ts`; no raw write to `group_memberships` or `events` from worship; `sweep.ts` is the only `getPlatformDb()` user; no import of `event-signups/`, `reimbursement/`, `careers/` or `onboarding/` internals, nor of `@/lib/events` (the file); no `directory_hidden` literal; `.from(events)` only in `reads.ts`, `store.ts` and (if it reads) `event-hooks.ts`; `insert(worshipServices)` appears only in `createService` and `generateServices`, each after an `insertEventsInTx` call in the same function (the S2 residual's scan); every presumed-minor decision goes through `presby_photo_subject_is_minor`; no `callbackUrl`, `next=` or `redirect(` in the module. |
| `src/lib/events/*.test.ts`, `events.test.ts`, `groups.test.ts` | The primitives; `cancelEvent` runs the hook in its own transaction and a hook failure rolls the cancel back; `updateEvent` and `cancelEvent` both take the event-row lock first (C3). |
| `src/lib/events/mutate.db.test.ts` (Batch 0) | C3: a second connection holding `FOR NO KEY UPDATE` on the event makes `updateEventFieldsInTx` wait, and after that connection cancels and commits it returns `invalid_target` (the cancelled check reads after the lock); after an update, `is_public`, `website_listed`, `allows_checkin`, `event_type_id`, `recurrence_*` and `parent_event_id` are byte-unchanged and no `event.listed_on_website` audit row is written; a repeat `cancelEventInTx` runs no hook and returns `changed:false`; both hook runners are called with the expected arguments (a spy on a test-registered handler). |
| `src/lib/events/boundaries.source.test.ts` (Batch 0; the worship half is asserted in `worship/boundaries.test.ts` in Batch 3) | C1: no file reachable from `hooks.ts` through static, non-type imports imports `events.ts`, `mutate.ts`, `hooks.ts`, `insert.ts` or `worship/store.ts`; sign-ups' hook-only file(s) are held to the same rule when they exist. C2: `mutate.ts`'s importers are exactly `src/lib/events.ts` and `src/lib/worship/store.ts`. Both scans carry a sample that fails them. |
| Updated existing | See the blast radius below. |
| UI | `pages.test.tsx` per tree, `request-actions.test.tsx`, `blockout-form.test.tsx`, `person-picker-dialog.test.tsx`, the dialogs, `worship-states.test.tsx`; each form test renders `HydrationGate`. |

**E2E (new specs; all run on the worktree's own port, never :3000).** `e2e/support/worship-fixture.ts` owns a throwaway congregation (removed in `afterAll` by deleting the organization, as the reimbursement fixture does) and its person-id prefix. `e2e/worship-schedule.spec.ts` (leader flow at 360px: team, positions, service, place, Send, record an answer, remove, cancel). `e2e/worship-respond.spec.ts` (member accepts, declines with a reason, changes their mind; blockout saved, merged, conflict message; another member's request id and an unknown id are the same 404; **an MFA-enrolled member opens the email link signed out, signs in with a code, lands on the request and accepts**). `e2e/worship-toggle.spec.ts` (off states for a member and for an `org_features.manage` holder; the Features card, its warning dialog with a count; an organization of another type gets the not-applicable state). `e2e/worship-founder.spec.ts` (**the F362 lesson**: the founding administrator minted by `presby_apply_founding_administrator` for a congregation opens "Plan worship", creates a team and a service and places a person with no further grant). `e2e/hydration/worship-forms.spec.ts` (blockout, team and service forms are inert before their chunks load, both lanes).

**Global flags each spec depends on** (a spec sets what it needs through `e2e/support/flags.ts`; nothing is added to `e2e-baseline-flags.sql`, because no spec asserts against a flag it cannot set): all four set `org_portal.worship` as the **per-org toggle row** in the fixture, not a flag. `worship-toggle.spec.ts` captures, sets and restores `org_portal.features` (the Features page) and `org_portal.admin_hub`. `worship-founder.spec.ts` captures, sets and restores `org_portal.admin_hub`. The tile assertion in `worship-schedule.spec.ts` depends on `org_portal.home_v2`, which is already in the baseline. No spec depends on `org_portal.events` (the calendar's own links are not asserted).

### Blast radius: existing specs and tests this change alters

| Existing | Why | Action |
|---|---|---|
| `src/lib/org-portal/tiles.test.ts` (lines 75, ~240, ~327, ~414) | The seeded-flag snapshot, the tile key list, the classification table and the org-type sets all name the old `worship` tile and the flag | Update: drop `org_portal.worship` from `KNOWN_SEEDED_ORG_PORTAL_FLAG_KEYS`; add `worship-admin`; `worship` becomes scoped; both join `congregationAndNwc`. |
| `src/lib/org-portal/visible-tiles.test.ts:228` | "worship tile is independent — `org_portal.worship` on" | Rewrite for the toggle. |
| `src/app/(org)/o/[slug]/admin/worship/page.test.tsx` | Tests the stub and the flag | Replaced. |
| `src/lib/org-feature-catalog.test.ts` (toggle-only list near line 66; scoped list near 280) | A new toggle-only, org-type-scoped entry | Update both lists. |
| `src/components/org-portal/tile-icons.test.tsx` | Every tile needs an icon | Covered by the new entry. |
| `src/lib/help/coverage.test.ts:201`, `coverage-allowlist.ts:30` | `tile:worship` leaves the "deliberately undocumented" list | Update, lowering the pinned length. |
| `src/lib/onboarding/designation-parity.golden.json`, `designation-parity.db.test.ts`, `designation-parity-in-place.db.test.ts`, `invitations.db.test.ts:571`, `founding-administrator.test.ts` | The bundle grows for two org types | Regenerate the golden in the same batch; the equality test covers all five types. |
| `src/app/(admin)/admin/organizations/[id]/founding-administrator-section.test.tsx:260` | Label list in the confirm dialog | Extend `BASE_PROPS` and assert the three labels and the list sentence. |
| `src/lib/audit.test.ts:291` | Mirror of `AUDIT_ACTIONS` | Add five. |
| `src/lib/contact-methods/email-audience.test.ts` (`NAMED` map) | New non-literal key expression | Add `worshipMessage.templateKey`. |
| `src/lib/calendar-visibility.source.test.ts` | The set of `events` readers is exact | Add two readers (above). |
| `src/lib/events.test.ts`, `src/lib/groups.test.ts` | Delegation; `updateEvent` and `cancelEvent` now lock the event row first (the suite is DB-backed, so the assertions hold; the idempotent second cancel still returns `ok`) | Update, behaviour unchanged. |
| `src/app/(org)/o/[slug]/admin/events/actions.ts`, `edit-event-form.test.tsx`, `cancel-event-dialog.test.tsx` | They call `updateEvent`/`cancelEvent`; the signatures and result kinds are unchanged | Unaffected; named so a reader does not search again (the implementer runs them in Batch 0). |
| `scripts/e2e-reset-flags.test.mjs` | Parity with `seed.ts` | Both lose the flag. |
| `scripts/test-rls.sql:7932` (integration) | "EIGHT template roles" | Nine. |
| e2e: `portal-footer-sitemap.spec.ts`, `portal-home-cards.spec.ts`, `member-home.spec.ts`, `post-login-routing.spec.ts`, `visual-parity.spec.ts` | The seed had the old flag **on**, so CI's home page and footer showed a "Worship & Service Planning" tile that is now gone (it is off until a congregation turns Worship on). None names the flag or the label (grepped), but link counts and layout read this page | Phase 5 runs all five; any count that included the old tile is corrected in the spec, not the code. |
| e2e: `member-calendar.spec.ts`, `public-calendar.spec.ts`, `reimbursement-*.spec.ts` | Use "Worship" only as an event type or a group name in their own fixtures | Unaffected; named so a reader does not search again. |

## Carry-forward

### Phase 1 gaps

| Gap | Addressed here, or deferred (who accepted) |
|---|---|
| G1 Worship is three products | One spine built: service as event, team as group, position, assignment. A praise band and a liturgical team are two teams (Data Model, starter sets). Bulletin is Increment 3 (operator Q1, staged). |
| G2 Groups cannot do this | New tables beside `groups`; `group_memberships` untouched; a member-facing team page of our own, not a `groups.view` (Data Model, Component Plan). |
| G3 "Sessions" collides with the court | "Rehearsal" is Increment 4; Increment 1 has no such string. `copy.test.ts` fails on the word "session" in any worship string and help draft. Operator Q18. |
| G4 Who may schedule | Key or live seat, per team, checked in the store and by trigger (R7, DECISION-318). Operator Q8. |
| G5 Response without an account | Increment 1: sign-in plus a leader recording on behalf (attributed). The email link is Increment 1b, **before any pilot** (operator Q10 as amended). The request email says plainly that sign-in is needed (Copy G5). |
| G6 Conflicts and availability | Warn, never block: blocked out, double-booked, overlapping service, not marked for the position, already declined (`plan.pickerWarnings`). |
| G7 Guests | Free-text name on a position, confirmed at placement, no contact data, validator refuses contact-looking text (operator Q11). |
| G8 Minors | R9 below. |
| G9 to G12 Copyright, destroy-on-lapse, storage, audio | Increment 5. Increment 1 stores no content. Deferred by the operator staging (Q2 to Q7 still open). |
| G13 Bulletins | Increment 3. |
| G14 Messaging infrastructure | Transactional mail only, no free text, no group mail. Free-text team mail is Increment 4, gated on Track F's mail decisions (R10 operational note, below). |
| G15 Events overlap and the sign-ups pipeline | R2 to R4: no shared tables, no imports either way; shared are the event row, `events/hooks.ts` and the lock. |
| G16 Founding-administrator reach | Operator re-ruling: the three keys are in the founding bundle with a backfill; `worship-founder.spec.ts` walks it as the accepted-invitation founder, and Phase 6 repeats the walk. |
| G17 Key and transposition, G18 hymnal reference | Increment 2. |
| G19 Offline stage use | Out of scope (operator Q21). |
| G20 Placeholders to retire | Stub page, `comingSoon` tile, global flag row and seed entry, and the `worship-planning` help placeholder are all replaced here (Component Plan, Integration list). |
| Pass 4: 2FA gate | `/o/*` already enforces it in the proxy. The email link is a bare path (no `next`), so the signed-out round trip is the same as treasury's; `worship-respond.spec.ts` covers an MFA-enrolled member. |
| Pass 4: audit | Audit section above. |
| Pass 4: empty state | "Create your first team" with the starter sets; services list says how to add one (Copy G3). |
| Pass 4: failure microcopy | `WorshipLoadError`; each action maps a result to a sentence in `copy.ts`. |
| Pass 4: mobile | Component Plan; the real-device walk is Batch 6. |
| Pass 4: time | Wall-clock throughout; org zone only for "now" (`presby_worship_org_now`). |
| Adversarial: redirect targets | Links have no query string; no `redirect(` in the module (`boundaries.test.ts`). |
| Adversarial: state-machine shortcuts (a) another person's assignment id (b) cancelled or past (c) accept after decline (d) leader of A edits B (e) scheduling someone outside the organization | (a) `not_found` identical to unknown, `store.db.test.ts`; (b) trigger and store; (c) a re-answer is a normal transition, last write wins, row-locked; (d) per-team seat check, `worship.db.test.ts`; (e) composite FKs and the roster check. |
| Adversarial: enumeration | `notFound()` for unknown or not-yours ids (assignment, team, board) with the same response; the four-way org miss is inherited. |
| Adversarial: input boundaries | Server-side limits on every text field (names, guest, location); closed reason lists; no rich text in Increment 1. |
| Adversarial: self-targeting | A scheduler placing or recording for themselves is allowed and harmless. |
| Adversarial: messaging abuse (Inc 4), bulletin publication (Inc 3), copyright (Inc 5) | Deferred with their increments. |
| Adversarial: residual (copies outside the platform) | Increment 5 copy. |

### Operator rulings and open questions

| Ruling | Addressed here |
|---|---|
| Q1 one module, plan as spine | Summary. |
| Q8 key and seat | Permissions & Flags; DECISION-318. |
| Q9 re-ruled: founder gets the three keys, template stays | DECISION-319; migration steps 2 to 4; scoped to the two types the toggle serves (a design call; Question 2 below). |
| Q10 as amended (1) sign-in and on-behalf | Built. |
| Q10 as amended (1b) email link before any pilot | Own child work-log and migration 0086; Increment 1 leaves it additive (Summary). |
| Flow 3 (addendum 2): Send, not on placement; automatic reminders, never to decliners | `draft` then `requested` on Send; DECISION-324, DECISION-325. |
| Q11 guests | Built. |
| Q12 minors | R9 below; "parent access" is a later increment (addendum 9), deferred by the operator. |
| Q17 services as `events` rows, no shared tables | R2 to R4. |
| Q18 "rehearsal" never "session" | G3. |
| Addendum 12: officer-limited positions | **Deferred by this design** (a Phase 3 scope call): no `suggest_office` column in Increment 1; adding one later is additive. Flagged for the operator's confirmation, Question 3. |
| Q2 to Q7, Q13 to Q16, Q19 to Q22 | Not Increment 1; still open with the operator. |
| R12 / F425 closed-choice reasons | `away`, `work`, `family`, `other` or none, on both blockouts and declines; no free-text column exists. |
| Addendum 4 (CCLI, import, reporting), 5 (OneLicense), 6 (hosted files), 7 (bulletins), 10 (SMS), 11, 13 | Inc 2 to 6 directions; nothing built. |

### Phase 2 rulings

| Ruling | Where |
|---|---|
| R1 increments; `response_source` from day one; new template keys for 1b | Summary; Data Model; Email. |
| R2 service is an event plus a 1:1 extension; no event type as identity | `worship_services`; default "Worship" type is display only. |
| R3 `events/insert.ts`, `events/hooks.ts`, the lock, DECISION-316 entry | API Contract (plus `mutate.ts`, approved by the Phase 2 addendum); Component Plan; Tests. |
| Addendum C1 (break the import cycle: `worship/event-hooks.ts`, writer allow-list exactly `store.ts` and `event-hooks.ts`, hook-import scan, sign-ups under the same rule) | Phase 3 amendment 1 (C1); module layout; `boundaries.test.ts` row; `events/boundaries.source.test.ts`. |
| Addendum C2 (a plan holder reaches only worship services: join-under-lock, `not_found`, db test, `mutate.ts` importer scan) | `updateService`/`cancelService` rows; `store.db.test.ts` row; `events/boundaries.source.test.ts`. |
| Addendum C3 (one lock, taken first, in `updateEventFieldsInTx`; excluded columns pinned) | `mutate.ts` row; `mutate.db.test.ts`. |
| Addendum C4 (`runEventUpdatedHooks`, called by `updateEventFieldsInTx` and `updateEvent`; `cancelEvent` delegates; sign-ups TODO and DECISION-309 clause) | `hooks.ts` row; Files to modify (`events.ts`); Integration list. |
| Addendum C5 (DECISION-316 `ALLOWED_READERS`: `mutate.ts`, `insert.ts` and `event-hooks.ts` if they read) | Files to modify (`calendar-visibility.source.test.ts`); Batch 0. |
| Addendum S1 (hooks return `{queueIds}`) | **Adopted**: `hooks.ts` row. |
| Addendum S2 (BEFORE INSERT trigger on `worship_services` requiring a same-transaction event, or a `paper` residual) | **Not adopted; recorded as a `paper` residual in DECISION-317**, with a source scan (see Phase 3 amendment 1). |
| Addendum DECISION-326 as amended | DECISION-326 below, rewritten. |
| R4 sign-ups boundary | `boundaries.test.ts`; Integration list (sign-ups reconciles). |
| R5 new tables beside `groups`; two three-column keys; no change to `group_memberships` | Data Model. |
| R6 roster writes through `groups.ts` primitives; `member` rows only; no live role grant; seats under `groups.manage`; never say a leader "only schedules" | `addTeamMember`/`endTeamMember`; Copy G3 and G9 state the reimbursement coupling. |
| R7 key or live seat; `presby_worship_leads_team`; store check and trigger; `paper` residual | Data Model; DECISION-318. |
| R8 keys, template, toggle | Permissions & Flags. |
| R9 one presumed-minor predicate | Calls `presby_photo_subject_is_minor` directly (see DECISION-322): no new definition. No notice of any kind; `notice_outcome = 'guardian'`; the leader records the answer; never named publicly (no public surface here). Residual (`paper`): a child with no birth date and no `child` household role is presumed an adult. |
| R10 email `person:role`, one audience per key, queued in the causing transaction, plain GETs, reminders never to decliners, cancelled, minors or toggle-off | Email; DECISION-320. Operational note: weekly band-wide requests are church mail at volume; the orchestrator confirms the platform sender is cleared before a pilot (TODO line 38). |
| R11 the response credential | Increment 1b. |
| R12 closed choices | Above. |
| R13 the "next service" card goes on `/o/<slug>`, never `/home` | **Not built in Increment 1** (scope call; Question 3). When built it goes on `/o/<slug>`. |
| R14 to R16 | Increments 2 to 5 direction; nothing built. |
| Tripwires (no new `check:*`; `boundaries.test.ts`, the DECISION-316 scan, the audience registry test, `check:audit`, `check:hydration-gate`, `check:help`) | Tests. |
| F421 | Operator re-ruled; migration steps 2 to 3. |
| F422 | R6 row. |
| F423 | R9 row. |
| F424 | R13 row. |
| F425 | R12 row. |
| F426 | Increment 1b. |
| F427 | R3 row. |
| Phase 6 housekeeping (CLAUDE.md layout line) | Integration list. |

### Phase 3 amendment 2 (F434) carry-forward

| Item | Addressed here, or deferred (who accepted) |
|---|---|
| F434 (found in Batch 6 gap-closing, ux-developer): a just-minted founder is refused at the worship actor trigger on a US evening because the grant is stamped on the UTC day and worship asks the organization's day | Ruled in "Phase 3 amendment 2 (F434)": worship's in-effect day becomes `greatest(organization day, UTC day)` for every comparison against a `role_grants` or `group_memberships` date, in migration 0085 in place. Implementer: database-admin (SQL), then api-developer (TypeScript reads), then ux-developer (fixture). |
| Platform-wide follow-up for the grant writers | Deferred: none needed (see the ruling; no other reader uses the organization day against these rows). One TODO line records the accepted residual. Accepted by: pending operator confirmation with the rest of Out of Scope. |

## Edge Cases & Risks

Each claim names the test that pins it, or says "unverified".

| Claim | Pinned by |
|---|---|
| A leader of team A cannot place, remove, send or record for team B | `worship.db.test.ts` (trigger) and `store.db.test.ts` (store) |
| A seat that ended yesterday, or a merged, deceased or ended-membership leader, schedules nothing | `store.db.test.ts` |
| Another person's assignment id returns the same `not_found` as an unknown id | `store.db.test.ts`, `worship-respond.spec.ts` |
| Responding twice with the same answer is a no-op; a different answer is a normal transition | `store.db.test.ts` |
| A response racing a cancel ends in a consistent state (withdrawn and "no longer open", or confirmed and told of the cancel) | `store.db.test.ts` (two-connection case) |
| Two concurrent Sends never double-queue a person | `store.db.test.ts` |
| A presumed minor is placed, never emailed (request, reminder, cancel), shows "ask a parent or guardian", and the leader can record the answer | `notify.db.test.ts`, `sweep.db.test.ts`, `worship-schedule.spec.ts` |
| A Work-labelled address receives scheduling mail (accepted residual: the volunteer can mark it do not contact, or an administrator can relabel it) | `notify.db.test.ts` |
| Do-not-contact and no-address people are placed and sent without error, with the matching reach note | `notify.db.test.ts` |
| A guest name that looks like contact details is refused | `guest-name.test.ts` |
| A blockout that overlaps or touches another merges; a blockout over a confirmed date saves and says so | `store.db.test.ts` |
| Toggle off: every page shows the off state, every action returns `toggle_off`, no reminder or cancel notice is queued, nothing is deleted | `store.db.test.ts`, `sweep.db.test.ts`, `worship-toggle.spec.ts` |
| A presbytery or synod has no toggle, no tile and gets the not-applicable state | `org-feature-catalog.test.ts`, `worship-toggle.spec.ts` |
| A service cancelled from Manage events behaves exactly like one cancelled from the worship board | `events.test.ts`, `store.db.test.ts` |
| A team in use cannot be retired; a team serving a service with live assignments cannot be removed from it | `store.db.test.ts` |
| A hook failure rolls the cancel back | `events.test.ts` |
| A `worship.plan` holder who lacks `events.manage` cannot edit or cancel an event that is not a worship service: `not_found`, row unchanged, no side effect | `store.db.test.ts` (C2) |
| An edit and a cancel of the same event serialize on one lock, taken first in both writers; an edit that loses the race to a cancel returns `invalid_target`, not a stale write | `mutate.db.test.ts` (C3) |
| `updateEventFieldsInTx` never changes `is_public`, `website_listed`, `allows_checkin`, `event_type_id`, `recurrence_*` or `parent_event_id`, and writes no website-listing audit row | `mutate.db.test.ts` (C3) |
| An edit made from Manage events and an edit made from the worship board both reach the update hooks (a later sign-ups `event_changed` notice fires for both) | `mutate.db.test.ts` for the call; sign-ups' own tests when it reconciles; the update list is empty in Increment 1, so nothing is observable yet |
| The hook-import graph has no cycle (`events.ts`, `mutate.ts`, `hooks.ts`, `event-hooks.ts`) | `events/boundaries.source.test.ts`, `worship/boundaries.test.ts` (C1) |
| **S2 residual** A worship service is only ever a newly created event; nothing in the database stops a future code change from attaching a `worship_services` row to an existing event (which would let a plan holder edit and cancel it) | `paper`; held by `store.ts` being the only inserter, the `insert(worshipServices)` source scan in `boundaries.test.ts`, and the C2 join (which still requires the row) |
| The roster cannot be edited from worship when the group carries a live role grant | `store.db.test.ts` |
| Reminders are sent once, in the windows, and never to decliners | `sweep.db.test.ts` |
| A very long team, position or service name wraps at 360px without sideways scroll | `pages.test.tsx` asserts the wrap class; **unverified until the Batch 6 phone walk** |
| The board and the picker are usable at 360px with 44px targets | **unverified until the Batch 6 phone walk** |
| **F428** `email_queue` is a platform table with full `presby_app` DML, no RLS and indefinite retention, so the rendered body of a worship notice (position names, team names, dates, the organization's name; no person's name, no free text) is retained there. Credential bodies are redacted after sending; these are not. Treasury kept request content out entirely (DECISION-271); R10 chose to list positions and dates. Accepted, `paper`, tier-1 content; revisit with Track F | `messages.test.ts` asserts no name and no free text enters a body |
| **F429** Reminders ride the existing 03:00 UTC maintenance run, which is about 10 to 11 pm US Eastern. A reminder can arrive late in the evening. No fifth cron was added (R10). Moving the maintenance slot is an operator decision | unverified (operational) |
| **F430** Removing a person, or moving a service's time, sends no message in Increment 1 (a confirmed volunteer sees the change on their schedule only). Cancel does send. The remove dialog says so | `copy.test.ts` pins the dialog sentence; recommend adding both notices in Increment 1b |
| **F431** A merged person's assignments are not re-pointed to the survivor (the same as group memberships today). The picker excludes merged people and reminders skip them | `sweep.db.test.ts`, `reads.db.test.ts` |
| **F432** `worship.manage` can see the name of every current member when adding to a team, as `groups.manage` can today (`getGroupFormOptions` is the F21 shape). `paper` | `reads.db.test.ts` pins the shape: names only, current memberships only |
| Until 1b ships, a volunteer with no sign-in cannot answer from the email; the leader records it. The operator ruled "before any pilot" | n/a (1b) |
| A time change after a request was sent is not announced (F430) | n/a |
| `worship.schedule` is organization-wide: a holder sees every team's board | by design (R7) |

## Out of Scope (explicit non-goals; the operator confirms)

Songs, charts, files, bulletins, rehearsals and team messaging (Increments 2 to 5); the email response link (1b); CCLI; SMS or push; auto-scheduling, swap requests and sign-up sheets; attendance counts; adopting an **existing** calendar event as a service (a plan holder could then edit an event they otherwise could not; recommended later, gated on `events.manage` **and** `worship.plan`; until then the rule that a service is only a newly created event is a `paper` residual, DECISION-317); officer-limited positions; parent access for minors; the "next service" card; a message to a person who is removed or whose service moves; contact details on the team roster; offline use; a worship-specific audit page.

## Copy

Every user-facing string Increment 1 adds, in one place. `src/lib/worship/copy.ts` holds them; the implementer needs no string that is not here, and stops for a ruling if one is missing. Dates render through `<FormattedDate>` as "Sunday, November 16 at 9:00 AM". The word "session" appears nowhere.

### The four checks, per string group

Each group below ends with one line recording: (1) **Residuals** (it never denies an accepted residual or a Phase 2 ruling), (2) **Source of truth** (the query or field behind each claim), (3) **Audience** (who sees it and can do what it says), (4) **Neighbours** (live strings made stale, with file:line, which are modify targets).

### G1 — Tile, catalog, permissions, template

| Where | String |
|---|---|
| Member tile | Label "Worship". Description "See when you're asked to serve, answer requests, and set dates you can't serve." |
| Admin tile | Label "Plan worship". Description "For the people who plan worship. Set up teams and positions, plan services, and schedule people." |
| Features card | Name "Worship". Description "Lets your congregation set up worship teams, plan services on the calendar, and ask people to serve. Turning this off hides every worship page and stops requests and reminders. Nothing is deleted." |
| `worship.manage` | "Set up worship teams, their positions and who can fill them, and save service types" |
| `worship.plan` | "Add, change and cancel worship services and choose which teams serve" |
| `worship.schedule` | "Schedule people into worship positions, send requests, and record answers for them" |
| Template | Role name "Worship Leader" |
| Platform admin confirm dialog | labels "worship teams", "worship services", "worship scheduling" |

Checks. (1) The card says nothing is deleted (true: no delete path) and does not claim anything about email already sent. (2) Static text; "stops requests and reminders" is what the store gate and `presby_worship_enabled` do. (3) Seen by every member (tile) and by `org_features.manage` holders (card). The tile description promises only what any member can do. (4) Replaces the stub tile at `src/lib/org-portal/tiles.ts:491-499` ("Worship & Service Planning", "Service templates, liturgical roles, and scheduling."), `src/app/(org)/o/[slug]/admin/worship/page.tsx:9-12`, and the `docs/TODO.md:557` pill-wrap line about that title (now moot; the integration step closes it).

### G2 — Gate and error states (both trees)

| State | String |
|---|---|
| Off | "Worship isn't turned on for {name} yet." then, if the viewer holds `org_features.manage`, a link "Turn it on under Features"; else "Ask someone who manages {name}'s features to turn it on." |
| Not applicable | "Worship planning is for congregations and new worshiping communities." |
| No permission (admin tree) | "You don't have permission to plan worship at {name}. If you think this is a mistake, ask your stated clerk or another administrator there." |
| Load error | "We couldn't load worship right now. Try again in a moment." |
| Not found | the organization's standard not-found page (`notFound()`) |
| Closed request | Heading "This request is no longer open". Body "The service was cancelled, it has already started, or the request was taken back. Your other requests are on your schedule." Link "Go to my schedule". |
| Action: generic | "We couldn't save that. Try again." |
| Action: forbidden | "You don't have permission to do that." |
| Action: stale | "That has changed. Refresh the page and try again." |
| Service started / cancelled | "That service has already started." / "That service was cancelled." |
| No longer on team | "{name} is no longer on this team." |
| Retired team | "{team} has been retired." |
| In use | "{team} is still scheduled for {n} upcoming services. Remove those people first." (same shape for a position) |
| Role-bound roster | "This team's people receive a role, so only someone who manages groups can change who is on it." |
| Send: nothing | "There's nothing to send. Add people first." |
| Send: mail unavailable | "We couldn't send requests right now. Nothing was changed." |
| Send: over cap | "You can send up to 200 requests at once. Send fewer, then send again." |

Checks. (1) The off-state sentence follows `careers-states.tsx` and denies nothing. The "Retired team" and "In use" sentences are exactly what the triggers enforce. (2) "{n} upcoming services" is `count(distinct event_id)` of live assignments on uncancelled, not-started services of that team (the same query `retireTeam` runs). "Role-bound" is a live `role_grants` row for the group, date-aware. (3) The "ask your stated clerk or another administrator" instruction reaches a member who opened the admin page; a stated clerk and the founder hold `role_grants.manage` and can grant the keys. "Turn it on under Features" is shown only to an `org_features.manage` holder (page-level read, DECISION-162). "Someone who manages groups" names a role without telling the viewer to do what they may not. (4) No older string says anything about worship except G1's neighbours.

### G3 — Teams (admin tree)

| Where | String |
|---|---|
| Hub heading, subtitle | "Plan worship". Cards: "Services" (desc "Add Sunday services and other services, and see who is scheduled."), "Teams" ("Set up teams, their positions, and who can fill them."), "Service types" ("Save the usual time, place and teams for a kind of service.") |
| Teams list | Heading "Worship teams". Button "New team". Empty "No worship teams yet. Start with a ready-made team or make your own." Row: "{n} people, {m} positions". Badge "Retired". |
| New team form | Labels "Team name", "Kind" (options "Team", "Choir"), "Start with" (options below), button "Create team", toast "Team created." Existing-group form (only for a viewer who also holds `groups.manage`): label "Or use a group you already have", button "Use this group", toast "Team created." |
| Starter sets | "Praise band": Worship leader, Vocals (2 people), Acoustic guitar, Electric guitar, Bass, Drums, Keys. "Choir": Director, Accompanist, Soprano, Alto, Tenor, Bass. "Liturgical team": Liturgist, Scripture reader, Preacher, Children's message. "Ushers": Head usher, Usher (2 people). "Greeters": Greeter (2 people). "Sound and projection": Sound, Projection. "None, I'll add my own". |
| Team page | Sections "Positions", "People". Position form: "Position name", "How many people", button "Add position"; toast "Position added."; row actions "Rename", "Change number", "Retire". Roster: label "Add a person", placeholder "Search by name", button "Add", toast "Added to the team."; row action "Remove from team". Qualifications: "Can fill:" with one checkbox per position, button "Save", toast "Saved." Leader row badge "Leader" or "Chair". |
| Note on the team page | "Chairs and leaders are chosen under Groups. A chair or leader can schedule people for this team and, where reimbursements are in use and your treasurer has allowed requests for this group, can approve them." |
| Remove from team dialog | Title "Remove {name} from {team}?" Body "They stay on record and are no longer offered for this team. Anything they're already scheduled for stays as it is." Buttons "Remove", "Cancel". Toast "Removed from the team." |
| Retire team dialog | Title "Retire {team}?" Body "It stops appearing when you plan services. Its people and past schedules stay on record." Buttons "Retire team", "Cancel". Toast "Team retired." (position dialog: "Retire {position}?" / "It stops being offered. People already scheduled for it stay as they are." / "Retire position" / "Position retired.") |
| Validation | "Enter a name." / "Names can be up to 80 characters." / "Position names can be up to 60 characters." / "You already have a position called {name} on this team." / "Choose a number from 1 to 20." / "A team can have up to 40 positions." / "Only people with a current record at {name} can be added to a team." / "Chairs and leaders are changed under Groups." |
| Groups form helper (`add-group-member-form.tsx`) | "A chair or leader can also schedule people when this group is a worship team, and can approve this group's reimbursement requests when your treasurer allows requests for it." |

Checks. (1) R6: the note and the Groups helper state the reimbursement coupling and never say a leader "only schedules". The Retire dialog does not claim the team's mail stops (it has none). (2) Counts come from `getTeamsAdmin` (current in-date `group_memberships` rows for people, live positions); "{n} people" counts roster rows of any role. The leader badge is `group_role` in date. "Remove" is `ends_on` set (end-dated), so "stay on record" is true. (3) Seen by `worship.manage` holders. "Use a group you already have" appears only with `groups.manage`. The Groups helper is seen by `groups.manage` holders and is true for any group (conditional wording). The note names Groups without instructing an action the viewer may lack. (4) Neighbour: `src/content/help/first-day-as-administrator.md:34` ("Groups": committees, small groups, choirs and teams.) remains true; the Groups page itself still lists worship teams as ordinary groups.

### G4 — Service types and services (admin tree)

| Where | String |
|---|---|
| Service types | Heading "Service types". Empty "No service types yet. Save the usual time, place and teams for a kind of service, such as Sunday worship." Form labels "Name", "Starts at", "Lasts (minutes)", "Where", "Teams that usually serve"; button "Save service type"; toast "Service type saved."; retire dialog "Retire {name}?" / "It stops being offered when you add services. Services already added stay as they are." / "Retire service type" / toast "Service type retired." |
| Services list | Heading "Services". Tabs "Coming up", "Earlier". Buttons "Add a service", "Add several services". Row: "{filled} of {needed} positions filled", "{n} waiting for an answer", badge "Cancelled". Empty "No services yet. Add this Sunday's service to start scheduling." |
| New service | Labels "Title", "Date", "Starts at", "Ends at (optional)", "Where (optional)", "Teams that serve" ; button "Add service"; toast "Service added." Duplicate hint "There's already a service at that time: {title}." with buttons "Add it anyway", "Cancel". |
| Add several | Labels "Service type", "First date", "Repeat" (options "Weekly", "Every 2 weeks", "Monthly (same date)"), "How many"; button "Add services"; toast "{n} services added." Error "You can add up to 26 at a time." |
| Service page | Heading is the title. Buttons "Edit details", "Cancel service". Section "Teams serving" with "Add a team"/"Remove". Badge "Cancelled". |
| Cancel dialog | Title "Cancel this service?" Body "It is marked Cancelled in your services list and leaves the calendar. We email the people who were asked or scheduled, where we have an address for them, and open requests are closed. Their schedule stays on record." Buttons "Cancel service", "Keep it". Toast "Service cancelled." |
| Edit toast | "Service updated." |

Checks. (1) The cancel body does not promise that everyone is told (it says "where we have an address") and says nothing about minors beyond that. It says the schedule stays on record (true: confirmed and declined rows are retained). (2) "Leaves the calendar" is the member calendar's existing treatment of a cancelled event (`events-and-the-calendar.md` already says so); "marked Cancelled in your services list" is `events.cancelled_at` read by `getServicesList`. "{filled} of {needed}" is live assignments (draft, requested, confirmed) against the sum of `slots` of live positions of the serving, non-removed teams; "waiting for an answer" is `status = 'requested'`. (3) `plan` holders see these; the controls are hidden otherwise. (4) `src/content/help/events-and-the-calendar.md:27` (cancel on Manage events) stays true; the new services section is added beside it.

### G5 — Board, picker, Send (member and admin trees)

| Where | String |
|---|---|
| Position block | "{Position}, {filled} of {slots}". Open row "Open". Button "Add someone". "Add a guest" with label "Guest name" and the hint "Just a name. Contact details aren't kept here." |
| Status chips | "Not sent yet", "Waiting for an answer", "Confirmed", "Declined", "Declined: Away" (also Work, Family, Other), "Guest" |
| Reach notes | "Request emailed." / "No email sent: may be under 18. Ask a parent or guardian, then record their answer." / "No email sent: no email address on file." / "No email sent: marked do not contact." |
| Picker | Title "Add someone to {Position}". Rows: name; "Can fill this position" or "Not marked for this position". Warnings: "Can't serve on {date}" / "Already scheduled as {Position} that day" / "Overlaps {service title}" / "Said they can't serve this service" ; info "May be under 18. They won't get an email." Button "Add" or, with a warning, "Add anyway". Toggle "Show everyone on the team". Empty "No one on this team is marked for this position yet." with the toggle. Toast "Added. Send requests when you're ready." |
| Record answer | Title "Record {name}'s answer". Options "Accepted", "Declined". Reason label "Reason (optional)". Helper "This is saved as entered by you." Button "Record answer". Toast "Answer recorded." Row note "Recorded by {name}". |
| Remove dialog | Title "Remove {name} from {Position}?" Body (draft) "They haven't been asked yet." Body (sent) "They stay on record. They aren't sent a message about this, so let them know yourself." Buttons "Remove", "Cancel". Toast "Removed." |
| Send | Button "Send requests ({n})". Dialog title "Send {n} requests?" Body "Each person gets one email listing their positions and dates. {x} can't be emailed ({y} may be under 18, {z} have no email address, {w} are marked do not contact). For them, record their answer yourself." Buttons "Send requests", "Cancel". Result toast "Requests sent. {n} emailed, {k} not emailed." |

Checks. (1) The minor note says "may be under 18" and never "is a minor", and the help states the R9 residual (a child with no birth date and no child marking is treated as an adult and is emailed). "Request emailed" does not claim delivery or reading; help says PresbyPortal cannot tell. The Remove dialog says no message is sent (F430). (2) Reach notes are the stored `notice_outcome` snapshot taken at Send ("no email address on file" is true as of the Send; the page says "on file" in the present tense only because the stored word describes that moment; the board shows the note only on rows already sent). Status is `status` plus `decline_reason`. "Recorded by" is `responded_by_person_id` when `response_source = 'on_behalf'`. "Can't serve on {date}" is a live `worship_blockouts` range covering the service date, shown only to the scheduling authority (R12). The Send preview counts use the same outcome function as Send; the result toast reports what actually happened. (3) Seen by `schedule` holders and seat holders, who can do every action named. "Ask a parent or guardian" is addressed to a leader who can. (4) Neighbours: none (new surface).

### G6 — Member pages

| Where | String |
|---|---|
| Home | Heading "Worship". Sections "Waiting for your answer", "You're scheduled", "You said you can't serve", "Your teams" (badge "You lead"). Link "Dates I can't serve". Empty "You're not asked to serve at any upcoming services. When someone asks you, it appears here." Card: "{Position}, {Team}" and the date. Status "Service cancelled". Buttons "Accept" and "Decline" on a card that is waiting; a confirmed card shows only "Decline"; a declined card shows "I can serve after all". |
| Request page | Heading "Your request to serve". Body "{Organization} asks you to serve as {Position} with {Team} on {date}." and "Where: {location}" if set. After accepting: "You're confirmed." After declining: "You said you can't serve." Decline reason label "Reason (optional)", options "Away", "Work", "Family", "Other"; helper "People who schedule worship can see this." Toasts "You're confirmed for {Position} on {date}." / "Thanks for letting us know. You're not scheduled for that date." |
| Blockouts | Heading "Dates I can't serve". Helper "The people who schedule worship see these dates when they choose who to ask. They don't cancel anything you've already agreed to." Labels "From", "To", "Reason (optional)". Button "Save dates". List rows "{from} to {to}, Away" with "Remove". Empty "You haven't saved any dates." Toasts "Dates saved." / "Saved. We joined it with dates you'd already saved." / "Dates removed." Errors "The end date can't be before the start date." / "Choose dates that haven't passed." / "Choose dates within a year." / "You can save up to 50 sets of dates. Remove some you no longer need." Conflict "You're already confirmed to serve on {date}. This doesn't change that. Let the person who asked you know." |
| Team page | Heading is the team name. "Leaders", "People" (each with "Can fill: Vocals, Bass" when marked), "Upcoming services" (for those who may schedule) with link "Schedule this team". Empty "No one is on this team yet." |

Checks. (1) "They don't cancel anything you've already agreed to" matches the ruling (a blockout over a confirmed date is not a cancellation). The decline toast promises nothing about who is told. (2) The waiting/scheduled/declined sections are `status` of the viewer's non-withdrawn rows on future services; "Your teams" is the viewer's in-date roster rows on non-retired worship teams; "You lead" is the seat function. "People who schedule worship can see this" matches what the board shows. The request body's {Team} and {Position} come from the assignment's FKs. (3) Seen by any member; the buttons act only on the viewer's own row. The conflict sentence tells a volunteer to "let the person who asked you know" without naming a role they may not have. (4) Neighbour: `src/content/help/home-and-switching-congregations.md` lists no worship surface and needs no edit (no home card).

### G7 — Emails (all plain text plus the standard layout; no name of any person, no free text)

| Key | Subject | Heading | Body | Button | Footnote |
|---|---|---|---|---|---|
| `worship.notice.request` | "{Organization}: a request to serve" | "You're asked to serve" | "{Organization} is asking you to serve:" then one line per request, up to 12 ("Sunday, November 16 at 9:00 AM: Drums, Praise band"), then "and {n} more" | "Answer the request" (one) or "Answer your requests" (several) | "You need to sign in to answer. If you can't, let whoever asked you know." |
| `worship.notice.reminder` (still waiting) | "{Organization}: please answer your request" | "A request is waiting for your answer" | "You were asked to serve on {date}: {Position}, {Team}. Please answer so the team can plan." | "Answer the request" | same |
| `worship.notice.reminder` (confirmed) | "{Organization}: you're serving soon" | "You're serving soon" | the lines as above | "See your schedule" | "Can't make it any more? Open your schedule and choose Decline, or tell your team leader." |
| `worship.notice.cancelled` | "{Organization}: a service was cancelled" | "A service was cancelled" | "The service on {date} was cancelled, so you are not serving that day." | "See your schedule" | none |
| `worship.notice.declined` (to the person who placed them) | "{Organization}: a position needs someone else" | "Someone can't serve" | "Someone you scheduled has declined {Position} on {date}." | "Open the schedule" | "This message doesn't include their name. Open the schedule to see who." |

Checks. (1) The request footnote says plainly that sign-in is required (the accepted state until 1b) and does not suggest an email reply works. No email says it was delivered or read. F428 (bodies are retained) is not denied: nothing here claims otherwise. (2) Dates, positions and teams come from the `requested` or `confirmed` rows the email is built from; "{Organization}" is `organizations.name`. The decline notice is queued only when the transition to `declined` came from `self` and `assigned_by_person_id` has a deliverable `role` address. (3) Recipient is the assignee (or, for the decline notice, the person who placed them, who holds `schedule` or the seat and can open the board). "Tell your team leader" is a person the recipient can approach. (4) Neighbours: the invitation and reimbursement emails are unrelated; none says anything about worship.

### G8 — Features warning

Title "People are scheduled for upcoming services". Description "{n} people are asked or scheduled for upcoming services. Turning this off hides the schedule and stops requests and reminders. People who were asked can't answer until you turn it back on. Nothing is deleted." Singular "1 person is asked or scheduled for upcoming services." Fallback title "People may be scheduled for upcoming services", description "We couldn't check who is scheduled just now. Turning this off hides the schedule and stops requests and reminders. Nothing is deleted." Zero: no warning.
Checks. (1) Admits the real consequence (people cannot answer while off). (2) `presby_worship_open_count()`: distinct people with a `requested` or `confirmed` assignment on an uncancelled service whose start is after the organization's now; guests are not people here. (3) Seen by an `org_features.manage` holder, who is the one who can turn it off. (4) Sits beside `reimbursementWarning` and `offWarningCopy` in `org-feature-warnings.ts`; same shape.

### G9 — Release-note lines (non-engineer)

- "Worship: your congregation can now schedule music teams, ushers, greeters and liturgical roles from PresbyPortal. Turn on 'Worship' under Features."
- "Leaders place people in positions on a service, then press Send. Each person gets one email, signs in, and accepts or declines. People can also save dates they can't serve."
- "Founding administrators at congregations and new worshiping communities now hold the three worship permissions, including those already set up. A 'Worship Leader' role is available to hand to others."
- "Good to know: answering from the email without signing in, song lists and bulletins are not part of this release. People who may be under 18 are not emailed; their leader asks a parent or guardian and records the answer. Reminders go out once a night."
- "The 'Worship & Service Planning' placeholder tile is gone."

Checks. (1) Names what is absent and the minor and nightly-reminder limits, denying none of F428 to F432 (the queue-retention residual is not claimed away; nothing says messages are private). (2) Static. (3) Read by administrators and the operator. (4) Replaces nothing.

### Help drafts (Workflow Rule 17; `status: published`, no `requires`)

Each is written for the page's reader, quotes only strings from the Copy tables above (these go in `labels`), and avoids the banned phrases of `check:help` rule H8.

**`worship-serving-on-a-team`** — title "Serving on a worship team"; summary "Answer a request to serve, see your schedule, and save dates you can't serve."; audience everyone; order 66; `needs.who` "Anyone with a current record at a congregation that uses Worship."; `turnOn { toggleKey: "org_portal.worship", name: "Worship", defaultOn: false }`; `appliesTo: "congregations-and-nwcs"`; `covers: ["tile:worship"]`; `labels`: "Worship", "Your request to serve", "Accept", "Decline", "Reason (optional)", "Waiting for your answer", "You're scheduled", "You said you can't serve", "I can serve after all", "Dates I can't serve", "Save dates", "This request is no longer open", "Go to my schedule".

> When someone asks you to serve on a worship team, you answer in PresbyPortal. This page covers where the request arrives, how to answer it, and how to save dates you can't serve.
>
> ## Before you start
>
> Your congregation has to use Worship. An administrator turns it on under "Features", and it is off until they do. While it is off, the "Worship" tile is not on your congregation's page, and a link from an email says "Worship isn't turned on for" your congregation. See [Turning features on and off](/help/turning-features-on-and-off). You also need a sign-in connected to your record. If you can't sign in, tell whoever asked you to serve. A leader can record your answer for you.
>
> ## When you're asked
>
> You get an email from your congregation listing the dates and positions. It does not say who asked you and does not name anyone else. Choose the button, sign in if you are asked to, and the page "Your request to serve" opens. PresbyPortal cannot tell whether an email reached your inbox or was read. If you expected a request and none came, it may not have been sent yet, or the email may not have reached you. Open "Worship" to see any request waiting for you.
>
> Choose "Accept" or "Decline". If you decline, you can choose a reason: Away, Work, Family or Other. People who schedule worship can see it, and PresbyPortal does not show it to anyone else.
>
> You can change your answer until the service starts. A request you declined shows "I can serve after all" on your schedule.
>
> If the page says "This request is no longer open", the service was cancelled, it has started, or the leader took the request back. Choose "Go to my schedule".
>
> ## Your schedule
>
> Choose the "Worship" tile. The page lists "Waiting for your answer", "You're scheduled" and "You said you can't serve", each with the date, your team and your position. Under "Your teams" you can open a team to see who is on it and which positions each person can fill.
>
> Reminders are emailed once a night: one if a request is still waiting for you, and one when you are scheduled soon. They can arrive late in the evening. You get none for a request you declined, or for a service that was cancelled.
>
> ## Dates I can't serve
>
> Choose "Dates I can't serve". Pick "From" and "To", optionally a reason, and choose "Save dates". People who schedule worship see these dates when they choose who to ask. Saving dates does not cancel anything you have already agreed to: if you are already confirmed on one of the days, the page says so, and you tell the person who asked you. Dates that touch or overlap are joined into one.
>
> ## If you are under 18
>
> PresbyPortal does not email anyone whose record shows they may be under 18. A leader asks a parent or guardian and records the answer for you. A record with no birth date and no child marking is treated as an adult, so ask your church office to correct it if that is wrong.

**`worship-scheduling-a-team`** — title "Scheduling people for a worship team"; summary "Place people in positions, send requests, record answers, and see who has answered."; audience everyone; order 67; `needs.who` "A person with a role that allows scheduling worship, or the chair or leader of a worship team's group."; `turnOn` as above; `appliesTo` as above; `covers: []`; `labels`: "Add someone", "Add a guest", "Guest name", "Show everyone on the team", "Add anyway", "Not sent yet", "Waiting for an answer", "Confirmed", "Declined", "Send requests", "Record answer", "Accepted", "Remove", "Request emailed.", "No email sent: may be under 18. Ask a parent or guardian, then record their answer.", "No email sent: no email address on file.", "No email sent: marked do not contact.", "Schedule this team".

> Scheduling means choosing who serves in each position on a service, sending the requests, and following the answers. This page is for the chair or leader of a worship team and for anyone whose role allows scheduling worship.
>
> ## Who can schedule
>
> A person whose role allows scheduling worship can schedule every team. The chair or leader of a team's group can schedule that team and no other. Chairs and leaders are chosen under "Groups", and a chair or leader can also approve a group's reimbursement requests where the treasurer has allowed requests for it. See [Roles: who can do what](/help/roles-who-can-do-what).
>
> ## Open the schedule for a service
>
> Open "Worship", choose your team, then "Schedule this team" beside a service. Someone with a scheduling role can also open the service from "Plan worship". The service shows each position with how many are filled.
>
> ## Place people
>
> 1. Beside a position, choose "Add someone". The list shows people on the team who are marked for that position. Choose "Show everyone on the team" to see the rest.
> 2. A line under a name warns you if the person has saved that date as one they can't serve, is already scheduled that day, overlaps another service, or said they can't serve this service. You can still choose "Add anyway".
> 3. The person is added as "Not sent yet". Nobody is told yet.
>
> For someone who is not on record, such as a visiting preacher, choose "Add a guest" and type just a name. A guest is "Confirmed" at once and is not emailed. Contact details are not kept here.
>
> ## Send the requests
>
> When the schedule is ready, choose "Send requests". The dialog says how many people will be emailed and how many cannot be. Each person gets one email listing their positions and dates. Choose "Send requests" again to confirm. A position then reads "Waiting for an answer" until the person answers.
>
> Some people cannot be emailed. Their line says why, for example "No email sent: may be under 18. Ask a parent or guardian, then record their answer." For them, ask them yourself and then choose "Record answer", "Accepted" or "Declined". The answer is saved with your name on it.
>
> A person can only answer after signing in. If someone cannot sign in, record their answer the same way. PresbyPortal does not yet let a person answer from the email alone.
>
> ## Changes
>
> - To take someone off a position, choose "Remove". They are not sent a message, so tell them yourself if they had been asked.
> - If a service is cancelled, people who were asked or scheduled are emailed where there is an address, and open requests are closed.
> - If a service moves to another time, nobody is emailed about the change. Tell the people who had confirmed.
> - Someone who declines is shown as "Declined" and the slot reopens. The person who placed them is emailed, where there is an address, that a position needs someone else. The email does not give the name.
>
> ## Good to know
>
> The email shows "Request emailed." because PresbyPortal sent it. It cannot tell whether it was read. Scheduling email goes to a person's Work address if that is the one they have on file, and they can mark an address do not contact. A record with no birth date and no child marking is treated as an adult and is emailed.

**`worship-setting-up`** — title "Setting up worship planning"; summary "Turn on Worship, set up teams, positions and services, and give the roles that schedule people."; audience administrator; order 55; `needs.who` "A Founding Administrator, or anyone whose role allows setting up worship teams and planning services."; `turnOn` as above; `appliesTo: "congregations-and-nwcs"`; `covers: ["org_portal.worship", "tile:worship-admin"]`; **`replaces: ["worship-planning"]`**; `labels`: "Worship", "Plan worship", "Features", "Worship teams", "New team", "Create team", "Start with", "Position name", "How many people", "Add position", "Add a person", "Remove from team", "Can fill:", "Retire team", "Service types", "Save service type", "Services", "Add a service", "Add several services", "Add service", "Add services", "Cancel service", "Teams serving", "Worship Leader", "Or adopt a template", "Adopt template".

> Worship planning lets a congregation schedule its music team, ushers, greeters and liturgical roles on its Sunday services. Services are events on your calendar. This page is for the people who set it up.
>
> ## Turn it on
>
> A new congregation has Worship off. Open "Administration", choose "Features", and turn on "Worship". Turning it off hides every worship page and stops requests and reminders. Nothing is deleted, and people who were asked cannot answer until you turn it back on. When people are scheduled, the Features page tells you how many before you turn it off. See [Turning features on and off](/help/turning-features-on-and-off).
>
> A Founding Administrator can set up worship from the first day: no other role is needed. To hand the work to someone else, give the "Worship Leader" role, or adopt it from "Or adopt a template" on the Roles page. See [Roles: who can do what](/help/roles-who-can-do-what).
>
> ## Teams and positions
>
> Choose the "Plan worship" tile, then "Teams", then "New team". Name it, choose "Team" or "Choir", and under "Start with" choose a ready-made set of positions such as Praise band, Choir, Liturgical team, Ushers, Greeters or Sound and projection, or none. Choose "Create team". If you also manage groups, you can use a group you already have.
>
> On a team's page, "Add position" takes a "Position name" and "How many people". Under "People", use "Add a person" to search by name. Under "Can fill:" tick the positions each person can fill. A person who leaves the team stops being offered at once.
>
> Chairs and leaders are chosen under "Groups". A leader can schedule only their own team. If a group's people receive a role, only someone who manages groups can change who is on it.
>
> ## Services
>
> Under "Plan worship", choose "Services", then "Add a service" with a title, date and time. It appears on your members' calendar. Putting it on your public website is still done under "Manage events". For a weekly service, save a type under "Service types" ("Save service type") with the usual time, place and teams, then choose "Add several services" and pick Weekly, Every 2 weeks or Monthly. You can add up to 26 at a time.
>
> The service page lists the teams serving ("Teams serving"). To change the time or place, choose "Edit details". To cancel, choose "Cancel service". It leaves the calendar, open requests close, and people who were asked or scheduled are emailed where there is an address.
>
> ## Who sees what
>
> The people who schedule worship see who is scheduled, who has answered, and the reason a person gave for declining or for dates they can't serve (Away, Work, Family or Other). Team members see their own requests and their team's names and positions.
>
> ## What it does not do yet
>
> A person cannot answer from the email without signing in. There are no song lists, bulletins or messages to a team. Removing a person, or moving a service's time, sends no message. Reminders go out once a night.

**Edits to existing help**

- `first-day-as-administrator.md:13`: replace the last sentence with: `Two tiles open a page that only describes an idea, and nothing on them works: "Insights & Analytics" and "Communications".` In "You can use these:" add `- "Worship": set up teams and schedule people. Turn on "Worship" first. See [Setting up worship planning](/help/worship-setting-up).` Registry labels for the page drop "Worship & Service Planning" and gain "Worship".
- `roles-who-can-do-what.md:39`: append "Worship Leader" after "Treasurer" in the template list (the list is alphabetical). `:49` list: add `- plan worship and schedule teams, once "Worship" is turned on.`
- `turning-features-on-and-off.md` table (after the "Parish management" row at line 40) gains: `| Worship | Lets your congregation set up worship teams, plan services on the calendar, and ask people to serve. See [Setting up worship planning](/help/worship-setting-up). | Off | Congregations and new worshiping communities |`; the "Tile" bullet list adds "Worship".
- `events-and-the-calendar.md`: a short section "Worship services on the calendar": a service added under "Plan worship" is an event on this calendar, open to everyone, not on the website unless you list it under "Manage events"; cancelling it from either place closes open requests and emails the people involved.
- `why-cant-i-see-this.md`: a short section "A worship page says it isn't available" covering "Worship isn't turned on for {name} yet" (ask whoever manages features), "This request is no longer open" (the service was cancelled or started, or the request was taken back) and a team or request that is "not found" (you are not on that team, or the link is for someone else).

## Proposed DECISION entries (text for the orchestrator to place; newest-first in `docs/decisions.md`)

**DECISION-327 — Blockouts are end-dated ranges with a closed reason list.** Status: Proposed (tech-lead, Phase 3) · Feature `2026-11-04-worship-inc1`. A person's "dates I can't serve" are rows in `worship_blockouts` (`starts_on`, `ends_on`, optional reason from `away`, `work`, `family`, `other`). There is no free-text column (R12, F425): free text about absence invites medical and pastoral content. Adding a range ends every live range that overlaps or touches it and inserts the union, so history is kept and nothing is deleted. A range wholly in the past, over 366 days, or past the 50-live-range cap is refused. The picker shows a blockout only to people who may schedule the team. A blockout never cancels an assignment; the store returns the person's own requested or confirmed assignments in the range so the page can say so. The actor is the session's person (no person parameter) and, like the assignment actor, is enforced in the store (`paper`).

**DECISION-326 — Event writes worship needs are extracted; the cancel and update hooks are one path.** Status: Resolved (architect, Phase 2 addendum, 2026-11-04; confirmed as amended by C1 to C5) · `createEvent` and `cancelEvent` gate on `events.manage`, which a worship planner does not hold (F427). `events/insert.ts` holds the in-transaction insert and series math; `events/mutate.ts` holds the field update (never `is_public`, `website_listed`, `allows_checkin`, the type, `recurrence_*` or `parent_event_id`) and the cancel, with no permission check (each caller gates on its own key) and no column or schema change (DECISION-113 is about the shape of the columns, not about values never changing); `events/hooks.ts` holds **both** the cancel fan-out and the update fan-out (`runEventCancelledHooks`, `runEventUpdatedHooks`, each returning `{queueIds}`). `events.ts` gates and delegates; `events.ts#cancelEvent` delegates to `cancelEventInTx`, so there is one cancel writer, and `events.ts#updateEvent` keeps its own statement for the wider column set but takes the same lock and calls the update hooks. The worship handler lives in **`worship/event-hooks.ts`**, not `store.ts`: consumers import none of `events.ts`, `events/{mutate,hooks,insert}.ts` or `worship/store.ts` (type imports excepted), directly or transitively; `hooks.ts` imports consumers; the worship-table writer allow-list is exactly `store.ts` and `event-hooks.ts`. Both `updateEventFieldsInTx` and `cancelEventInTx` (and `updateEvent`) lock the event row `FOR NO KEY UPDATE` as their first read, so Send, a service edit, sign-ups and a cancel serialize on it (Send locks several in `(starts_at, id)` order). **A worship write to an event requires a `worship_services` row**, checked under that lock in `store.ts` (the join-under-lock; no row is `not_found`); `mutate.ts`'s only importers are `events.ts` and `worship/store.ts`. The worship hook runs in the cancel's transaction; if it cannot write its queue rows the cancel rolls back. Sign-ups' DECISION-309 clause "`events.ts` may import `event-signups`" becomes "`hooks.ts` imports sign-ups' hook file".

**DECISION-325 — Reminders are a claim made by an owner-only definer in the nightly maintenance step.** Status: Proposed. `presby_worship_claim_reminders(p_batch)` is a cross-org writer, `revoke`d from `presby_app`, called from `sweep.ts` on `getPlatformDb()` as an isolated step of `/api/cron/maintenance` (no fifth cron). It selects, with `FOR UPDATE SKIP LOCKED`, assignments that are due, stamps `unanswered_reminded_at` or `reminded_at`, and returns the rows with a deliverable `role` address resolved in SQL through `presby_person_email`. Due means: toggle on (`presby_worship_enabled`), service uncancelled and starting within 72 hours (status `requested`, request older than 24 hours) or 48 hours (status `confirmed`) of the organization's local now; person unmerged, living, membership active, not presumed minor (`presby_photo_subject_is_minor`); never `declined`, `withdrawn` or a guest. Each assignment is reminded at most once per kind. The queue rows are written in the same transaction as the stamps, so a failed insert un-claims. Up to 500 per run. Reminders therefore arrive with the nightly run (F429).

**DECISION-324 — The assignment is a state machine with an explicit Send; guests are confirmed at placement.** Status: Proposed. States `draft`, `requested`, `confirmed`, `declined`, `withdrawn` (terminal). A leader's placement is a draft the assignee cannot see; Send moves drafts to `requested` and queues one email per person (operator, addendum 2). A person, or a leader on their behalf (attributed, `response_source`), moves `requested`, `confirmed` and `declined` among themselves until the service starts; a re-answer is a normal transition and the last write wins under a row lock. A guest has no one to ask, so the row is born `confirmed`, recorded on the leader's behalf, and never emailed. Removing is `withdrawn`; cancelling a service withdraws drafts and open requests and keeps confirmed and declined rows. The trigger and `states.ts` are pinned together by a test. `notice_outcome` records at Send what happened (`emailed`, `guardian`, `no_address`, `do_not_contact`) so the board can say why someone was not emailed.

**DECISION-323 — Worship content direction (architect, Phase 2 R14 to R16).** Tenant-scoped song library with no shared catalog or dedup; the platform never holds SongSelect credentials or scrapes SongSelect; ChordPro is in-house, rendered as text nodes, with no copyleft dependency; hosted files go to a private object store behind the storage adapter (per-view short-lived signed reads, signed direct upload with server finalize, purge to a tombstone), provider chosen at Increment 5's Phase 2; bulletins are print HTML with no dependency. Nothing in Increment 1 implements this.

**DECISION-322 — Minors and public naming in worship.** Status: Proposed (architect R9; tech-lead specifics). One presumed-minor predicate: worship calls the shipped `presby_photo_subject_is_minor(org, person)` directly from SQL and never defines a second (a thin rename to a generic name is a follow-up for when sign-ups reconciles its TypeScript fragment, DECISION-308). A presumed minor receives no notice of any kind (request, reminder, cancel); the leader sees "ask a parent or guardian" and records the answer; a presumed minor is never named on a public surface (none exists yet; Increment 3 requires `public_listed` consent too). Residual, `paper`: a child with no birth date and no `child` household role is presumed an adult.

**DECISION-321 — The emailed response link is a DECISION-147 credential (Increment 1b).** Status: Proposed (architect R11); designed in the 1b child work-log. Names assignments, never "all of a person's requests"; stored as a hash; issued by a definer that addresses it in SQL through `presby_person_email`; answered by two definers that derive everything from the link row and compose the toggle through `presby_worship_enabled`; each named assignment answered once, until that service's org-local start; GET shows a page, POST records the answer, with the DECISION-313 lock, a rate limit and one uniform response; un-brandable `(respond)` group with exact public paths and no proxy import; bodies redacted after sending; shared `credential-token.ts`. Residual: a forwarded email can answer once. Increment 1 leaves `response_source = 'link'` valid in the vocabulary and refused by the guard.

**DECISION-320 — Worship notices.** Status: Proposed (architect R10). `person:role`, one audience per template key, queued in the causing transaction with `insertQueueRowInTx`, Send is explicit, plain GET links with no query string, never to a presumed minor, a decliner, a withdrawn assignment, a cancelled service, or when the toggle is off. Increment 1 sends four kinds (request, reminder, cancelled, declined-to-leader); 1b's credential-bearing mail uses new keys. **Residual (F428):** the rendered body (position, team, date, organization name; no person's name, no free text) is retained in `email_queue`.

**DECISION-319 — Worship keys, template and toggle.** Status: Proposed; **amends operator Q9 as re-ruled 2026-11-04**. `worship.manage`, `worship.plan`, `worship.schedule`, all tier 1, join the founding-administrator bundle for congregations and new worshiping communities (the toggle's own applicability list), with a backfill; without them nobody holds the keys and the `worship_leader` template (custom, universal scope) could never be adopted or granted (F111, F421). `org_portal.worship` becomes toggle-only, provisioned off, self-service; its global flag row is deleted (the 0055 precedent). Later keys are created with their increments. Accepted residual: the founding administrator can schedule and plan worship; all three keys are tier 1, so no tier is raised.

**DECISION-318 — Scheduling authority is `worship.schedule` or a live leader seat on that team.** Status: Proposed (architect R6, R7). Seats are appointed under `groups.manage`, which already decides a seat that now also confers reimbursement approval (DECISION-268); help and Copy say so. Checked in the store and again by the assignment trigger. `worship.manage` adds or ends only `member` rows, and only on a team group with no live role grant; worship writes rosters only through the `groups.ts` primitives. Residual, `paper`: the actor id comes from the application; mitigated by the sole-writer scan and the session-derived actor.

**DECISION-317 — Worship is a module on extension tables.** Status: Proposed (architect R2, R5). A service is an `events` row plus `worship_services`; a team is a managed group plus `worship_teams`; positions, qualifications, serving teams, assignments, blockouts and service types are new tables beside `groups`. Composite FKs including two three-column keys; NO ACTION to `events` and `groups`; FORCE RLS; no DELETE grant; `group_memberships` and `events` are not altered. `src/lib/worship/store.ts` (with `worship/event-hooks.ts` for the cancel handler, DECISION-326) writes under `withOrgContext()`. No tables shared with sign-ups. **Residual (S2, `paper`):** a worship service is only ever a newly created event (adopting an existing event is out of scope), but the database does not enforce it: a `BEFORE INSERT` trigger requiring `events.created_at = now()` was weighed and not adopted (it would refuse every fixture and seed that inserts the event and the service in separate transactions, including `seed-dev-worship.sql` run by `psql` in autocommit, for a hole reachable only by changing `store.ts`, the sole inserter, and already bounded by the C2 join-under-lock). Held by the `insert(worshipServices)` source scan in `boundaries.test.ts` and by review; revisit when adoption is designed, where the right control is a key check on `events.manage` **and** `worship.plan`, not a trigger.

## New findings (F428 onward)

| F | Finding | Ruling |
|---|---|---|
| F428 | `email_queue` retains the rendered body of worship notices (positions, teams, dates, organization name) indefinitely; credential bodies are redacted, these are not | Accepted, `paper`, tier-1 content; no person's name or free text in any body; revisit with Track F (DECISION-320) |
| F429 | Reminders ride the 03:00 UTC maintenance run, so they arrive about 10 to 11 pm US Eastern | Accepted for Increment 1; the maintenance slot is an operator decision (DECISION-325) |
| F430 | Removing a person, or moving a service's time, sends no message | Accepted for Increment 1, stated in the dialog and help; recommend both notices in 1b |
| F431 | A merged person's assignments are not re-pointed to the survivor | Same as group memberships today; reminders and pickers skip merged people |
| F432 | `worship.manage` sees the names of all current members when adding to a team, as `groups.manage` does today | Accepted, `paper` |

## Integration list (the orchestrator, Rule 16; this design edits none of these)

- `src/lib/db/domain/index.ts`: `export * from "./worship";` (patch shipped as `scripts/worship/domain-index.ts.integration.patch`).
- `drizzle/meta/_journal.json`: the 0085 entry (`scripts/worship/_journal.json.integration.patch`). 0086 stays reserved for 1b.
- `scripts/test-rls.sql`: append `scripts/worship/test-rls-85.sql`; change the template count at line 7932 from eight to nine and add `worship_leader` to the sentence (`scripts/worship/test-rls.sql.integration.patch`).
- `scripts/seed-dev.sql`: append `scripts/worship/seed-dev-worship.sql` (`seed-dev.sql.integration.patch`).
- `docs/decisions.md`: DECISION-317 to 327 above (DECISION-326 as amended by the architect's addendum; DECISION-317 with the S2 residual).
- **Sign-ups pipeline** (`../presby-signups`, `docs/work-log/2026-10-31-event-signups.md`): DECISION-309's clause "`events.ts` may import `event-signups`" becomes "`events/hooks.ts` imports sign-ups' hook file"; its R3c lock and Q7 `event_changed` notice move onto `runEventUpdatedHooks` and `runEventCancelledHooks`. The orchestrator applies this at integration; this design edits neither.
- `docs/TODO.md`: re-cut line 634 ("Worship planning and check-in", carries `[help:worship-planning]`) into one line per increment (1 Done, with the help token dropped in the same commit that deletes the placeholder; 1b "before any pilot"; 2, 3, 4, 5, 6 open; check-in belongs to the children's-ministry line); line 54 ("quick followup") closed; line 270 loses `worship` from the go-live flip list; line 141 (F362) drops "the worship-planning placeholder (restore …)" from its help list, because the placeholder is replaced here (F371 in `docs/schema-design-2.md:2131` closes with it); add follow-ups F428 to F432; add "sign-ups reconciles to `events/hooks.ts` (**cancel and update hooks**, `runEventUpdatedHooks` carries Q7's `event_changed` notice) and `events/mutate.ts` and to the single presumed-minor predicate" (widened by the Phase 2 addendum, C4; sign-ups' hook-only file(s) obey the C1 import rule); add "run `npm run help:shots` only if `portal-tiles` or `admin-hub` shows the old tile".
- `docs/STATE.md`, `docs/schema-design-2.md`: F421 to F432 in the findings log; Increment 1 status.
- `docs/briefings.md` (operator-facing decision list): the accepted gap that every founding administrator at a congregation or new worshiping community, existing and new, now holds three worship keys; the F428 residual; the nightly reminder timing.
- `docs/deployment.md`: "Worship (0085)" apply note: snapshot production; **read the live body of `presby_founding_administrator_permission_keys` first and apply in order with F362**; count the founding roles the backfill tops up (the migration prints it); note that `org_portal.worship` is currently **on** in production and the migration deletes it; confirm `org_portal.features` and `org_portal.admin_hub` are on or the toggle cannot be flipped; apply by `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0085_presby_worship.sql` through the endpoint-host swap.
- `CLAUDE.md` → Project Layout: lines for `src/lib/worship/` (the sole-writer store, reads, authority, notify, sweep, the boundaries test) and `src/components/worship/`; `src/lib/events/` gains `insert.ts`, `mutate.ts`, `hooks.ts`; `src/lib/worship/` includes `event-hooks.ts` (the cancel handler, the one writer besides `store.ts`). (`(respond)` joins the un-brandable list at 1b.)
- `docs/product/functionality-map.md`: add a worship line to the index and the full map at ship (Rule 14). `docs/architecture.md` is not triggered (Rule 15).
- `/release-notes` after Phase 6 SHIP IT (G9 lines).
- Dev server: one port, `3100 + n`, and the e2e person-id prefix, assigned at kickoff.
- **Mail before a pilot:** TODO line 38's Track F decisions (a second Resend team, bounce thresholds) should be settled before real church mail at volume (R10).

## Questions

None blocks Phase 4. Three design calls to confirm or override (default stands if not answered): (1) F430, no message when a person is removed or a service moves, recommended in 1b; (2) the worship keys are bundled for congregations and new worshiping communities only, not presbyteries and synods; (3) officer-limited positions and the "next service" card are not in Increment 1. The architect's question on `events/mutate.ts` is answered: approved with conditions C1 to C5, folded in below.

## Phase 3 amendment 1 (architect addendum C1–C5)

Dated 2026-11-04. Source: "Phase 2 addendum (architect): `src/lib/events/mutate.ts`" in `docs/work-log/2026-11-04-worship.md` (verdict: Approved with conditions; the Manage-events-only fallback is not used). The in-place edits are made in the sections named in the table; this subsection is the index and the rulings on S1 and S2. Judgment-agent text stays verbatim in the parent.

| Condition | What the design now says | Where |
|---|---|---|
| **C1** Break the cycle | The cancel handler is `worship/event-hooks.ts` (not `store.ts`). It, and any file it imports, may not import `@/lib/events`, `events.ts`, `events/{mutate,hooks,insert}.ts` or `worship/store.ts` (`import type` allowed). The worship writer allow-list in `boundaries.test.ts` is exactly `store.ts` and `event-hooks.ts`. A source scan (`src/lib/events/boundaries.source.test.ts`, Batch 0) walks the static imports reachable from `hooks.ts` and fails if any reaches `events.ts`, `mutate.ts`, `hooks.ts`, `insert.ts` or `worship/store.ts`; sign-ups' hook-only file(s) are held to the same rule when they exist. The scan is transitive (the architect's one-hop wording is the minimum; a cycle is transitive by nature). Before Batch 3 the list is empty, so the scan is satisfied vacuously and proved able to fail by its offending sample; if the transitive form trips on a shared utility in Batch 3, the implementer stops and reports rather than relaxing it. | Module layout (`event-hooks.ts` row, `store.ts` row); Tests (`boundaries.test.ts`, `boundaries.source.test.ts`); DECISION-326 |
| **C2** A plan holder reaches only worship services | `mutate.ts` stays generic with no permission check. `updateService` and `cancelService` first lock the event joined to its `worship_services` row in the same transaction (`... for no key update of e`); no row is `not_found`, identical to an unknown id. `store.db.test.ts` pins it: a plan-only holder calls each export on a plain event and gets `not_found`, the row byte-unchanged, no hook side effect. A scan pins `mutate.ts`'s importers to exactly `events.ts` and `worship/store.ts`. | Store exports (`updateService`, `cancelService`); Tests; Edge Cases |
| **C3** One lock, taken first | `updateEventFieldsInTx` takes `FOR NO KEY UPDATE` as its first read, before the cancelled check, like `cancelEventInTx`; `events.ts#updateEvent` does the same (its select gains the lock plus start, end and location). `mutate.db.test.ts` pins lock-first with a second connection and pins the six excluded columns unchanged. | `mutate.ts` row; Files to modify (`events.ts`); Tests |
| **C4** The update path fans out too | `hooks.ts` exports `runEventUpdatedHooks(tx, {organizationId, eventId, before, after})`, empty in Batch 0, called by `updateEventFieldsInTx` and `events.ts#updateEvent`. `events.ts#cancelEvent` delegates to `cancelEventInTx` (one cancel writer). Worship registers an update handler (`onServiceUpdatedInTx`, a no-op in Increment 1) so the slot exists. The sign-ups TODO line is widened to the update hook and DECISION-309's clause changes. | `hooks.ts` row; Batch 0; Integration list; DECISION-326 |
| **C5** DECISION-316 | `ALLOWED_READERS` gains `src/lib/events/mutate.ts` with the architect's rule text, and `insert.ts` and `worship/event-hooks.ts` **only if** they read `events` (the test is exact in both directions, so listing a non-reader fails it). Members-only status needs no other change. | Files to modify (`calendar-visibility.source.test.ts`); Batch 0 |

**S1 — adopted.** Both hook runners return `{queueIds: string[]}`, combined across consumers; `mutate.ts` passes them back to its caller. Worship ignores them and relies on the five-minute cron (the cancel path never sends inline); sign-ups can use them for send-after-commit without a second hook contract. Cost: one return type, no behaviour.

**S2 — recorded as a `paper` residual in DECISION-317, not adopted as a trigger.** Reasons: (1) The hole is reachable only by changing `store.ts`, the sole inserter of `worship_services`; today's only two inserters, `createService` and `generateServices`, create the event in the same function. (2) The C2 join-under-lock already closes the exposure that matters at the edit and cancel paths: a plan holder can touch an event only if it carries a `worship_services` row. (3) A `created_at = now()` trigger refuses any fixture or seed that inserts the event and the service in separate transactions (`seed-dev-worship.sql` run through `psql` in autocommit, the e2e fixture, the db-test helpers), so Batch 1 would carry a fixture contract for a hole nobody can reach today. (4) When adoption of an existing event is designed, the correct control is a key check (`events.manage` **and** `worship.plan`), which a trigger cannot express. Mitigation that costs nothing: a source scan in `boundaries.test.ts` that `insert(worshipServices)` appears only in `createService` and `generateServices`, each after an `insertEventsInTx` call in the same function. The operator confirms the residual with the rest of Out of Scope.

**Feasibility check, re-run against the live tree (2026-11-04).** `updateEvent` (`src/lib/events.ts:669`) reads the event with `.select(...).limit(1)` and no lock, and `cancelEvent` (`:1045`) does the same, so C3 adds `.for("no key update")` to two existing selects; Drizzle's `LockStrength` includes `'no key update'` (`node_modules/drizzle-orm/pg-core/query-builders/select.types.d.ts:60`). `events.test.ts` is DB-backed (real transactions), so the lock changes no mock chain; the idempotent second cancel (`events.test.ts:794`) still returns `ok` because `cancelEventInTx` returns `changed:false`. No schema, no migration, no new dependency, no new route or action. `src/lib/events/` has no existing `insert.ts`, `mutate.ts` or `hooks.ts`, and `calendar-visibility.source.test.ts:71` lists three readers today, so the DECISION-316 edit is additive. The sign-ups worktree (`../presby-signups`) has not merged; the reconciliation is an integration task, and per the rule that a design whose Phase 4 starts after another pipeline merges re-runs the check, Batch 0 re-greps `events.ts` against the merged `main` first.

**Copy.** None added or changed. A `not_found` from `updateService`/`cancelService` renders through the existing G2 "Not found" row (the organization's `notFound()`), and a cancelled service through the existing "That service was cancelled." Checks: (1) denies no residual; (2) the state comes from the join-under-lock and `cancelled_at` read under the same lock; (3) no instruction is added; (4) neighbours: no other string describes who may edit or cancel a service (grepped `Cancel service` and `cancel` in Copy and the help drafts: G4's dialog text names the effect, not the permission, and stays true).

**Help impact.** None beyond Increment 1's pages: no label, role or route changes; who can cancel a service from the worship board is already the `plan` holder in `worship-scheduling-a-team` and `worship-setting-up`.

**Implementer.** Unchanged: api-developer for Batch 0 (now larger: `mutate.ts` with both writers, both hook runners, three new test files) and Batch 3.

## Phase 3 amendment 2 (F434): the day a grant is in effect

Dated 2026-11-04 (tech-lead ruling on the ux-developer's Batch 6 finding, `f730455d`). No Copy, no help impact (a refusal that should not happen stops happening; no string changes). Judgment: this is a Phase 3 defect (the design chose "the organization's day" for the resolver call without checking the day the writers stamp), not a Phase 4 deviation.

**Finding F434.** `presby_apply_founding_administrator` (and every `role_grants` writer) stamps `starts_on` with the database's `current_date`, which is the UTC day. The worship assignment guards ask `presby_has_permission(..., 'worship.schedule', presby_worship_org_today(org))`, the organization's day. From about 7 or 8 pm US Eastern until midnight the UTC day is already tomorrow, so `starts_on > p_as_of` and the freshly minted founder holds no key at the trigger, while the page and picker (the app resolver, `src/lib/authz.ts:145`, `coalesce(..., current_date)`) say she does. The first placement fails with "You don't have permission to do that."; the same person succeeds the next morning.

**Investigation (read-only; live tree and the pipeline database).**

| Place | Which "today" | Evidence |
|---|---|---|
| `role_grants.starts_on`, `group_memberships.starts_on` column default | UTC (`now()` cast to date; Neon session zone is UTC, confirmed by `psql`: `current_date` 2026-11-05 while the organization day was 2026-11-04 at 21:35 EST) | information_schema default `now()` |
| Grant writers: `presby_apply_founding_administrator` and the invitation definers (0059, 0061, 0064, 0065), the lockout-revoke writer (`ends_on = current_date`, 0060) | UTC | `insert into role_grants` lists no `starts_on`; 0060 `ends_on = current_date` |
| `presby_effective_permissions` / `presby_has_permission` | UTC by default (`p_as_of date default current_date`, 0010:32, 0010:125) | |
| App resolver (`effectivePermissions`, `authz.ts:145`; sender-ceiling check `authz.ts:212`) | UTC | `coalesce(asOfDate, current_date)` |
| Every other guard that calls the resolver (reimbursement 0073:652, giving 0055:2196, two-factor arm 0055) | UTC (they pass no date) | |
| Careers (`presby_careers_org_today`, 0071) and reimbursement (`presby_reimbursement__local_date`, 0073) | Organization day, but only for dates THEY own (posting close, expense date); neither passes it to the resolver, neither compares a grant or membership date | grep of 0071 to 0074 |
| **Worship** guards: `presby_worship_may_schedule` (0085:663, 664) and the roster check in `presby_worship_assignments_guard_insert` (0085:979, 1059, 1060); store reads `store.ts:190, 543, 1414`; `drafts.ts:92` | **Organization day against platform-stamped rows** | the only code that does this |
| Worship's own stamps: team-roster add (`store.ts:627`, `orgToday`) | Organization day | consistent with itself |

**Verdict on scope.** The mismatch is worship-only in effect. The platform has one convention (UTC day) used by every writer and every reader except worship, which alone compares the organization day against rows the platform stamped. The same defect reaches two more cases that the finding did not name: (a) a team leader seat or roster row added through the generic Groups page (`add-group-member-form.tsx:25` defaults `startsOn` to the browser's `toISOString()` UTC day) is "not on this team now" and not a leader until the organization's midnight; (b) the reverse direction is a fail-OPEN, not just a nuisance: a revocation stamps `ends_on = current_date` (UTC), the platform treats the grant as ended at once, worship (organization day, behind UTC) still sees `ends_on > today` and keeps scheduling authority for the rest of the organization's evening. Both come from the same single comparison, so one rule fixes all three.

**Why not change the writers (the platform-wide option).** It touches released `SECURITY DEFINER` bodies in migrations 0059 to 0065, the column default, the Groups form, and the resolver's default, to fix a disagreement that exists only because one reader chose a different clock. Released migrations are fix-forward only (DECISION-298). Rejected. The fix belongs with the one reader that disagrees, in 0085, which is unreleased and corrected in place.

**Ruling.** Worship has two kinds of day and must name them:
- the **service day** (blockouts, `ends_on < today` refusals, "upcoming", reminders, the wall-clock now): the organization's day, unchanged (`presby_worship_org_today`, `presby_worship_org_now`);
- the **in-effect day** for any comparison against a `role_grants`, `group_memberships`, or resolver date: `greatest(organization day, UTC day)`.

Why `greatest`, in both directions: for `starts_on <= x`, the larger of the two days accepts a row stamped by either clock (UTC-stamped grants and Groups-page rows west of UTC; organization-day-stamped rows from `store.ts:627` east of UTC). For `ends_on > x`, the larger day makes a row ended by either clock ended (a platform revocation stamped on the UTC day is never kept alive by a lagging organization day; a worship removal stamped on the organization day is ended immediately east of UTC). In a zone west of UTC (every congregation today) it equals the day the app resolver and every other guard already use, so page, picker and trigger give one answer. It cannot grant authority a platform reader would deny except on the one east-of-UTC side where the organization is already on the next day, and there it only lets a row stamped today (either clock) count today.

**Shape (database-admin, migration 0085, in place; no new migration, no schema change).**
1. New `presby_worship_in_effect_day(p_org uuid, p_now timestamptz default now()) returns date`, `language sql stable security definer set search_path = public, pg_temp`, body `select greatest((p_now at time zone coalesce((select s.time_zone from organization_settings s where s.organization_id = p_org), 'America/New_York'))::date, (p_now at time zone 'UTC')::date)`. EXECUTE: owner and `presby_app` (the same grants and the same `revoke` line as `presby_worship_org_today`); add it to the function list at 0085:1390 and give it a `comment on function` that states the rule above and the one-line reason (platform rows are UTC-stamped). `p_now` is a test seam only; the trailing default keeps it valid SQL.
2. Replace the day passed to the resolver and to `presby_worship_leads_team` in `presby_worship_may_schedule` (lines 663 and 664) with `presby_worship_in_effect_day(p_org)`. Update the comment above `presby_worship_leads_team` (line 623, "Callers pass presby_worship_org_today") to name the new function. `presby_worship_leads_team` itself is unchanged (it takes `p_as_of`).
3. In `presby_worship_assignments_guard_insert`, the roster check (lines 1059, 1060) uses the in-effect day; if `v_today` has no other use after that (grep showed none beyond 979, 1059, 1060), replace the declaration with `v_day date := presby_worship_in_effect_day(new.organization_id)` and rename. Leave line 933 (blockout `ends_on < today`) on the service day. Re-grep every other `presby_worship_org_today` and `p_as_of` in 0085 and classify each as service day or in-effect day in a one-line comment; do not guess.
4. **api-developer** (after the SQL is applied): `store.ts:190` (`groupIsRoleBound`: a role grant's dates), `store.ts:543` and `store.ts:1414` (roster `on_roster` / `on_team`), `drafts.ts:92` (roster) switch to `presby_worship_in_effect_day(...)`. `store.ts:627` keeps `orgToday` (it stamps a worship-written row; the in-effect day is never earlier, so the row is in effect at once). Grep all 22 `org_today`/`orgToday` uses in `src/lib/worship/` and classify each; blockout, service-count (`org_now`) and reminder uses stay on the service day. The Groups-page `new Date().toISOString()` default is NOT changed (it matches the platform's UTC convention and the new rule accepts it).
5. **ux-developer** (e2e): `e2e/support/worship-fixture.ts` stops back-dating the founder's grant (lines 219 to 221 comment and update), so `worship-founder.spec.ts` exercises a grant stamped by the definer. Every other fixture grant keeps its 2020 back-date (they stand for long-held roles, not just-minted ones).

**Regression tests (fail before, pass after).**
1. `src/lib/worship/in-effect-day.db.test.ts` (new, deterministic, no wall-clock dependence): `presby_worship_in_effect_day(org, p_now)` at three fixed instants: `2026-11-05 02:35+00` with an America/New_York organization returns `2026-11-05` (the F434 instant; the service day is `2026-11-04`); `2026-11-04 22:00+00` with a Pacific/Auckland organization returns `2026-11-05` (local ahead); `2026-11-04 15:00+00` with New York returns `2026-11-04`. Fails before the fix by absence of the function. Plus a pin that its default zone literal equals `DEFAULT_ORG_TIME_ZONE` (the same pin as `presby_worship_org_today`).
2. In `store.db.test.ts` (or a new `store.f434.db.test.ts`), the end-to-end case without a seam: choose the organization's `time_zone` at run time so its calendar day differs from the UTC day (`Etc/GMT+12` when UTC is before noon, otherwise `Etc/GMT-14`; one of the two always differs), then (a) stamp a `worship.schedule` grant with `starts_on = greatest(UTC day, org day)` and place a draft as that person: succeeds; (b) stamp a leader seat and a roster row the same way: place a draft: succeeds; (c) end the grant with `ends_on = current_date` (the platform's revoke): the same placement is refused with `worship_guard_not_authorized`. Honest limit: case (a) fails before the fix only in the hours each day when the chosen zone is behind UTC (the F434 window); (c) fails before the fix in the same window; the seam test in item 1 and item 3 below carry the always-failing proof.
3. A source scan in `boundaries.test.ts`: in `drizzle/0085_presby_worship.sql` and `src/lib/worship/*.ts` (non-test), no `presby_has_permission(` argument list contains `presby_worship_org_today`, and no `role_grants` or `group_memberships` date comparison is written against `presby_worship_org_today` (the regex lists the comparison forms in use: `starts_on <=` and `ends_on >` with that function). Fails before the fix at the current sites (deterministic, any hour); the offending-sample case proves it can fail.
4. `worship-founder.spec.ts` (item 5): the un-back-dated founder places a draft. Passes at any hour after the fix; fails before it only in the evening window, so it is evidence, not the proof.
5. `scripts/worship/test-rls-85.sql`: one block that stamps a grant at `current_date`, sets the context, and calls `presby_worship_may_schedule` under an organization zone chosen as in item 2; no new fixture file.

**Edge cases and claims.** (1) "Equals the app resolver's day west of UTC": pinned by item 1 (fixed instant) and item 2(a); unverified for zones east of UTC beyond item 1's Auckland instant. (2) Deceased, merged and ended-relationship checks do not use a day and are unchanged. (3) A grant stamped in the future by an operator (`starts_on` days ahead) stays refused until its day, under either clock; pinned by an existing resolver case, unverified inside worship (add one row to item 2). (4) A trigger that reads `current_date` inside a `stable` SQL function is fine; `now()` is the transaction time, so one transaction sees one day.

**Accepted residual (propose `paper`).** Between UTC midnight and the organization's midnight (west of UTC) worship's in-effect day is the UTC day, not the organization's. A grant or seat stamped on the organization's day by some other writer would be seen as started one organization-day-evening early at most. No writer stamps ahead of the UTC day in a western zone, so nothing is accepted early in practice. Proposed one TODO line (docs/TODO.md, integration): "Day-boundary hygiene: the Groups form defaults `startsOn` to the browser's UTC day; platform-wide the grant clocks are UTC while Careers, Reimbursements and Worship keep organization-day dates of their own (F434)."

**Proposed DECISION-328 (the orchestrator confirms the number).** Worship compares membership and grant dates against `greatest(organization day, UTC day)` (`presby_worship_in_effect_day`) and its own events, blockouts and reminders against the organization day. Reason: the platform stamps and reads grants on the UTC day everywhere else; worship alone read them on the organization day and refused a just-minted founder on a US evening (and kept a just-revoked grant alive). Rejected: re-stamping grants and group rows on the organization day (released definers in 0059 to 0065, a column default and a resolver default for one reader's clock); using `current_date` alone (wrong east of UTC for rows worship stamps on the organization day).

**Implementer.** database-admin (steps 1 to 3 in 0085, and `test-rls-85.sql`, the new db test), then api-developer (step 4, the scan), then ux-developer (step 5). Phase 4 resumes in that order; QA re-runs the worship suites, the RLS suite, and `worship-founder.spec.ts` after.

## Implementer

**database-admin** (Batch 1: migration 0085, `worship.ts`, schema and DB tests, `test-rls-85.sql`, seed and integration patches), **api-developer** (Batches 0, 2 and 3: the refactors, the pure modules, the store, reads, notify, sweep, cron, catalog and bundle, audit, tests), **ux-developer** (Batches 4 to 6: member and authoring pages, components, states, help pages and edits, e2e and hydration specs, the 360px phone walk). The orchestrator runs them in that order; each batch ends green before the next starts.

---

# Phase 4 — Implementation

### Batch 0 (api-developer, 2026-11-04): event and group writer extraction

No schema, no worship code. Behaviour-preserving refactor, shipped green on its own.

**Files created**

- `src/lib/events/insert.ts`: `insertEventsInTx(tx, organizationId, actor, input)` (the body of `createEvent` after its gate); owns `EventsResult`, `EventActor`, `CreateEventInput`, `validateFieldLengths`, the three length constants, `eventTypeUsable`, `EVENT_TYPE_UNAVAILABLE`, `switchesAreBooleans`, `SWITCH_INVALID`. Reads no `events` row.
- `src/lib/events/mutate.ts`: `updateEventFieldsInTx(tx, org, {eventId, title, description?, location?, startsAt, endsAt?})` returning `{eventId, queueIds}`, and `cancelEventInTx(tx, org, eventId, actor | null)` returning `{eventId, changed, queueIds}`. Both take the event row `FOR NO KEY UPDATE` as the first read (C3); update writes only title, description (omitted when undefined), location, starts_at, ends_at; cancel runs no hook on an already-cancelled event.
- `src/lib/events/hooks.ts`: `runEventCancelledHooks`, `runEventUpdatedHooks`, both returning `{queueIds}`, both lists empty; plus the exported combinator `runHookList` (so the fan-out is unit-testable without a test-only registration API) and the argument types consumers `import type`.
- Tests: `src/lib/events/boundaries.source.test.ts` (C1 transitive hook-import walk, C2 importer scan, each with offending samples), `src/lib/events/mutate.db.test.ts` (21), `src/lib/events/hooks.test.ts` (3), `src/lib/events/insert.test.ts` (4), `src/lib/groups.primitives.db.test.ts` (18).

**Files modified**

- `src/lib/events.ts`: `createEvent` is gate then `insertEventsInTx`; `cancelEvent` is gate then `cancelEventInTx` (one cancel writer); `updateEvent` keeps its own statement but its select is now `FOR NO KEY UPDATE` and gains start/end/location, and it calls `runEventUpdatedHooks` after the UPDATE and the listing audit row. Re-exports `EventsResult`, `EventActor`, `CreateEventInput`, `EVENT_TYPE_UNAVAILABLE`, so no importer changed.
- `src/lib/groups.ts`: `insertManagedGroupInTx`, `updateManagedGroupInTx`, `addManagedGroupMemberInTx` (member role only; no `groupRole` parameter), `endManagedGroupMemberInTx`. `createGroup`, `updateGroup`, `endGroupMembership` gate then call them; `addGroupMember` gates then calls a private shared body (`addManagedGroupRosterRowInTx`) that the member-only primitive also calls, because `addGroupMember` accepts chair and leader and the exported primitive must not.
- `src/lib/calendar-visibility.source.test.ts`: `ALLOWED_READERS` gains `src/lib/events/mutate.ts` (C5, the architect's text). `insert.ts` and `hooks.ts` read no `events` row, so they are not listed (the test is exact in both directions).
- `src/app/(org)/o/[slug]/admin/events/actions.ts`: `cancelEventAction` passes `identity.actor` as the new optional fourth argument.
- `src/lib/events/recurrence.ts`: comment only (names `insert.ts` as the caller of `generateRecurringDates`).

**Deviations from the design**

1. `cancelEvent` gained an optional fourth parameter `actor: EventActor | null = null` (design: signature unchanged). The cancel hook needs an actor for its `WORSHIP_SERVICE_CANCELLED` audit row (`insertAuditRow` takes the session actor), and the previous signature carried none. Existing 3-argument callers and tests are unchanged; the one production caller (`cancelEventAction`) now passes the actor. `cancelEventInTx` takes `EventActor | null` for the same reason.
2. `mutate.ts` imports **values** from `insert.ts` (`validateFieldLengths`), not only types as the design row says. Still within the C1/C2 rules: `hooks.ts` does not import `mutate.ts` or `insert.ts` at runtime, so no cycle. `mutate.ts` also imports `OrgTx` (type) from `@/lib/authz`.
3. `mutate.ts` returns `invalid_target` for a non-UUID event id (a new guard; `updateEvent` and the old `cancelEvent` would have thrown a 22P02). `cancelEvent` therefore returns `invalid_target` for a malformed id instead of throwing. No test pinned the throw.
4. The C2 importer scan asserts a subset (`events.ts` required, anything else must be `worship/store.ts`) rather than exact equality, because `worship/store.ts` does not exist until Batch 2 and does not import `mutate.ts` until Batch 3. Batch 3 may tighten it to exact.
5. `updateEventFieldsInTx` writes `location` on every call (`undefined` becomes null) and omits `description` only when `undefined`, exactly as the design states; Batch 3's `updateService` must pass the current location if it means to keep it.
6. Hook spying is done by wrapping the real runners with `vi.mock("@/lib/events/hooks")` in `mutate.db.test.ts`, not by a test-only registration API on `hooks.ts`.

**Gates (worktree `presby-worship`, own Neon branch)**

- `npm run typecheck`: clean. `npm run lint`: clean (max-warnings 0). `npm run check`: all ten tripwires pass.
- `npm test` (unit, no DB env): 840 files passed, 142 skipped; 13371 tests passed, 3882 skipped.
- DB-backed, `--no-file-parallelism` with `.env.local`: `events.test.ts`, `groups.test.ts` (unchanged, green), `groups.primitives.db.test.ts`, `events/` directory, `calendar-visibility.source.test.ts`, and the admin `events` and `groups` page suites: 50 files, 700 tests, all passed.
- Mutation check: removing `.for("no key update")` from `mutate.ts` makes both C3 lock-first tests fail (restored).

**Next:** Batch 1 (database-admin) is running in the same worktree. Batch 3 wires `worship/event-hooks.ts` into the two lists in `hooks.ts` (one line each) and must keep the C1 scan green. Strings added or changed: none.

### Batch 1 (database-admin, 2026-11-04): migration 0085, the schema

**Migration mode: hand-written.** `drizzle/0085_presby_worship.sql`, applied with `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0085_presby_worship.sql` to the pipeline Neon branch `pipeline-worship-inc1` (`ep-autumn-hall-axbadmif`, owner, direct endpoint) only. `development` and `production` were not touched. **Idempotence proof:** I applied the committed file twice in a row (and the earlier drafts several times). Both runs exit 0; the closing assertions pass both times. A snapshot (worship keys 3, template 1, worship bindings 3, flag rows 0, triggers 26, policies 9, presby_app column privileges 147, assignments 7, teams 2) is identical before, between and after. The backfill prints `0 founding_administrator role(s) topped up`: this branch, like `development`, holds no org-owned `founding_administrator` role. **`_journal.json`:** the `{idx: 85, tag: "0085_presby_worship"}` entry ships as `scripts/worship/_journal.json.integration.patch` (Rule 16). I have not edited the journal in the worktree.

**Live body re-read first.** On this branch `presby_founding_administrator_permission_keys` was 0071's body (eleven base keys, the presbytery oversight case, no F362 keys). 0085 re-creates it with that text byte for byte plus the worship case. F362 has not merged, so whichever of the two merges second must carry the other's keys (the 0085 header says so; `invitations.db.test.ts` catches a miss).

**Files created**

- `drizzle/0085_presby_worship.sql`: the nine sections of the design, in order (catalog, bundle, backfill with `raise notice`, `worship_leader` template, flag delete, nine tables, functions and triggers, RLS and grants, comments and the closing `do` assertions).
- `src/lib/db/domain/worship.ts`: the Drizzle mirror (nine tables, every constraint and index name, the vocabularies `WORSHIP_ASSIGNMENT_STATUSES`, `WORSHIP_REASONS`, `WORSHIP_RESPONSE_SOURCES`, `WORSHIP_NOTICE_OUTCOMES`, `WORSHIP_WITHDRAWN_REASONS`, and `WORSHIP_GUARD_CODES`, the guards' CONSTRAINT codes for the store to map). Not yet exported from `index.ts` (Rule 16).
- `src/lib/db/domain/worship.schema.test.ts` (24, pure): every name 0085 creates is declared in the mirror and nothing else; every tenant FK is composite, ends in `organization_id`, targets the right key, NO ACTION; the vocabularies equal the CHECK lists; no `$onUpdate`; every CHECK is drop-then-add; no defaulted parameter; the bundle body keeps the live base array verbatim; section order.
- `src/lib/db/domain/worship.db.test.ts` (35, owner path): every guard on the owner connection (F44); the FKs a guard pre-empts on the tenant path, each with the guard disabled in a rolled-back transaction; the delete guard on all nine; the teardown cascade; a merged, deceased or ended-relationship leader and person; the 50-blockout cap under two concurrent connections; the reminder claim (windows, exclusions, once per kind, the batch clamp, the address); the bundle per organization type; the backfill re-run from the migration text; the date helpers pinned to `DEFAULT_ORG_TIME_ZONE`; `WORSHIP_GUARD_CODES` equal to what the migration raises.
- `scripts/worship/test-rls-85.sql` (147 assertions, presby_app): (a) structure, (b) catalog, bundle, template, backfill, flag, (c) exact column grants and no DELETE/TRUNCATE by `aclexplode` for presby_app and presby_platform, (d) isolation and a cross-organization refusal through **every one of the 18 composite FKs** plus R5's two three-column keys, (e) the guards and the full state machine, (f) the seat, `may_schedule`, the toggle composition, the open count, the claim's ACL. Needs only the stock seed; every block rolls back.
- `scripts/worship/seed-dev-worship.sql`: Alder Creek, two teams on new managed groups ("Sunday Band" led through the seat by Tobias Renwick, "Chancel Choir" chaired by Aldous Fennimore), twelve positions, qualifications, a "Sunday worship" type, the next two Sundays' services, one assignment in each state (requested/emailed, confirmed on behalf, draft, declined "family", requested/guardian for the child, a confirmed guest), and one blockout. The toggle stays **off**. Applied twice to the branch: exit 0, identical counts.
- Integration patches (all `git apply --check` clean against the current tree): `scripts/worship/domain-index.ts.integration.patch`, `_journal.json.integration.patch`, `test-rls.sql.integration.patch` (template count 8 to 9 at line 7932, plus the `\ir worship/test-rls-85.sql` line), `seed-dev.sql.integration.patch` (`\ir worship/seed-dev-worship.sql` after the last include).

**Files modified:** none. No shared Rule 16 file was edited.

**Schema changes**

- Keys `worship.manage`, `worship.plan`, `worship.schedule` (tier 1, no 2FA, module `worship`); the founding bundle carries them for `congregation` and `new_worshiping_community` (order base, worship, oversight) with the backfill; template `worship_leader` (custom, unprotected, universal scope, exactly the three keys); `feature_flags` row `org_portal.worship` deleted.
- Tables: `worship_teams` (PK `group_id`), `worship_positions`, `worship_position_qualifications`, `worship_service_types`, `worship_service_type_teams`, `worship_services` (PK `event_id`), `worship_service_teams`, `worship_assignments`, `worship_blockouts`. All are FORCE RLS with `tenant_isolation`. presby_app holds SELECT plus the design's exact column-limited INSERT and UPDATE lists; presby_platform holds nothing; no one holds DELETE.
- Functions: `presby_worship_org_today(uuid)`, `presby_worship_org_now(uuid)` (definers), `presby_worship_enabled(uuid)`, `presby_worship_leads_team(uuid, uuid, uuid, date)`, `presby_worship_may_schedule(uuid, uuid, uuid)` (invokers), `presby_worship_open_count()` (definer), all EXECUTE presby_app; `presby_worship_claim_reminders(integer)` owner-only, returning `(kind 'unanswered'|'confirmed', organization_id, assignment_id, event_id, person_id, address)`.
- 26 triggers: the generic set-once/immutable guard on the eight non-assignment tables, the delete guard on all nine, insert guards (teams, positions, service teams, blockouts, assignments), the service-team re-add guard, the assignment update guard, and the two `updated_at` touches.

**Restated in English and checked against the design (self-verification)**

| Mechanism | In English | Matches design |
|---|---|---|
| `worship_assignments_response_shape` | `response_source`, `responded_at` and `responded_by_person_id` are all set or all null (two equalities: SQL's `a = b = c` would compare a boolean with the third) | yes (the design's chained form, written correctly) |
| `worship_assignments_withdrawn_shape` | withdrawn exactly when `withdrawn_at` is set, and `withdrawn_at` exactly when a reason is set | yes |
| `worship_assignments_guest_status` | a guest row is only confirmed or withdrawn | yes |
| `worship_blockouts_range_length` | at most 366 days counting both ends (`ends_on - starts_on <= 365`) | yes ("over 366 days" refused) |
| assignment insert guard | a person is born draft, a guest confirmed on the placer's behalf; the placer holds the key or the seat on this team; the service is not cancelled and has not started; team and position are live; the serving row is present; the person is on the roster now, unmerged, living, relationship open | yes |
| assignment update guard | identity fixed; withdrawn terminal; exactly one of send (draft to requested, sender may schedule, outcome given), respond (to confirmed/declined; self by the assignee, on_behalf by a scheduler, link refused), withdraw (removed by a scheduler, or service_cancelled with no actor once the event is cancelled), or no change; stamps trigger-owned; reminder stamps set once | yes |
| `presby_worship_leads_team` | chair or leader row in date on `p_as_of` (start on or before, end strictly after), on a managed group with a worship_teams row, person unmerged, living, relationship open; per team | yes (R7) |
| `presby_worship_enabled` | the organization type is congregation or NWC, AND (the category axis is off OR the worship category row is not off), AND the toggle row is on | yes (`orgFeatureEnabledInTx`'s order) |

**Deviations from the design** (each is also recorded in the 0085 header)

1. `worship_position_qualifications` and `worship_blockouts` also declare `unique (id, organization_id)` (Composite Tenant Keys).
2. `worship_service_type_teams` carries `created_at` (house style).
3. `worship_assignments` has three extra CHECKs: `_sent_shape` (sent_by, requested_at and notice_outcome together; a requested row has them), `_decline_reason_shape` (a reason only on declined or withdrawn) and `_withdrawn_actor_shape` (an actor exactly when the reason is `removed`).
4. The guest-name CHECK refuses every control character, not only line breaks (the same rule as `validateGuestName`).
5. The send transition is also refused on a cancelled or started service. Re-adding a removed serving team (clearing `removed_at`) passes the same guard as an insert (team live, service not cancelled).
6. An index `worship_service_teams_team_ix (organization_id, group_id)` for "the services this team serves" (team page, the retire check).
7. Guard refusals set the CONSTRAINT field to a stable `worship_guard_<code>` (listed in `WORSHIP_GUARD_CODES`) so the store maps on a code, not on message text.
8. Uniques and FKs are inline in `create table if not exists` (the 0071 idiom); only CHECKs are drop-then-add. An in-place correction of an FK needs an explicit drop-then-add.
9. The reminder claim's return shape was not specified; it is the one above. `sweep.ts` (Batch 3) builds bodies from those ids on the owner connection.

**Finding for the orchestrator (proposed next F-number; not assigned by me): the owner-path org-context contract.** The assignment guards' actor check calls `presby_has_permission`, and its resolver (`presby_effective_permissions`, 0010) raises `insufficient_privilege` unless `app.current_org_id` equals the organization asked about. On the tenant path `withOrgContext()` always satisfies this. On the owner path, a writer that places, sends, records on behalf or removes must set `app.current_org_id` in its transaction, or the guard **fails closed**. I kept fail-closed on purpose. The seed and `worship.db.test.ts` set the context, and a test pins the fail-closed behaviour. Paths that name no actor need no context: the reminder claim, the `service_cancelled` withdrawal, a self answer, and the generic guards. **Batch 6's `e2e/support/worship-fixture.ts` must set the context** if it writes assignments on the owner connection.

**Expected red between Batch 1 and Batch 2 (not a Batch 1 defect).** With 0085 applied, 9 DB-backed tests fail until Batch 2 changes `foundingAdministratorPlan()` and regenerates `designation-parity.golden.json`, exactly as the design assigns. They are `invitations.db.test.ts` ("equals foundingAdministratorPlan() for EVERY organization_type": SQL 14 keys vs TS 11 for congregation) and 4 + 4 congregation and NWC cases in `designation-parity.db.test.ts` / `designation-parity-in-place.db.test.ts`. The presbytery cases still pass, which confirms the scoping. CI's db-tests job skips without Neon secrets, so CI is unaffected.

**Failing-first evidence** (each mechanism sabotaged on the pipeline branch, suite run, restored by whole-file re-apply, suite green again at 147/147):

| Sabotage | First failing assertion |
|---|---|
| `no force row level security` on assignments | 85a "all nine ... ENABLED and FORCED" (8, expected 9) |
| `tenant_isolation` on teams replaced with `using (true)` | 85a "each carries tenant_isolation ..." (8, expected 9) |
| `grant delete on worship_blockouts` | 85c "neither presby_app nor presby_platform holds DELETE ..." (1, expected 0) |
| `grant update (requested_at)` | 85c "column-limited ... exactly the design's 18" (17) |
| drop `worship_assignments_position_fk` | 85a "18 tenant FKs ..." (17) |
| any guard trigger disabled | 85a "the 26 worship triggers ... ENABLED" (25) |
| assignment insert guard body to pass-through | 85d person FK: got 23503 `worship_assignments_person_fk`, expected `worship_guard_not_on_roster` |
| assignment update guard body to pass-through | 85d sent_by: got `worship_assignments_sent_shape`, expected `worship_guard_not_authorized` |
| team insert guard to pass-through | 85d team on Fernwood's group: got 23505, expected `worship_guard_team_not_eligible` |
| position insert guard to pass-through | 85e "no new position on a retired team" succeeded |
| service-team add/re-add guard to pass-through | 85e "a team cannot be re-added to a cancelled service" succeeded |
| blockout guard to pass-through | 85e "a blockout wholly in the past is refused" succeeded |
| generic immutable guard to pass-through | 85e "a retired position stays retired" succeeded |
| seat without the date and person conditions | 85f "a seat is not held before it starts" (1, expected 0) |
| toggle without the type allow-list | 85f "a presbytery is never on" (1, expected 0) |
| open count not distinct | 85f "counts once" (base+2, expected base+1) |
| `grant execute` on the claim to presby_app | 85a "trigger functions and the reminder claim ... owner alone" (9, expected 10) |
| delete guard to pass-through (owner path) | `worship.db.test.ts`: 9 of 9 "the owner cannot delete a row" fail |
| claim without the minor exclusion (owner path) | `worship.db.test.ts` "claims exactly the due rows": the child's `unanswered` row appears |
| mirror CHECK renamed | `worship.schema.test.ts`: "worship_blockouts does not declare worship_blockouts_range_length" |

**Gates**

- `npm run typecheck`: clean. `eslint` on the three new TS files: clean. `npm run check`: all ten tripwires pass, run with my files staged so `check:secrets` scanned them.
- `worship.schema.test.ts` 24/24; `worship.db.test.ts` 35/35 (`--no-file-parallelism`, `.env.local`), green both before and after the dev seed; pure `src/lib/db` suites 208 passed, 152 skipped.
- `scripts/worship/test-rls-85.sql` as presby_app: 147 passes, exit 0, with and without the dev seed applied.
- **Full `scripts/test-rls.sql` as presby_app** (a scratch copy with the integration patch applied and error-stop disabled for a census): 1,943 passes. There are 2 failures, both pre-existing drift on development-derived data and unrelated to 0085: "presbytery: sees only its own members" (3, expected 2; Northern Reach has a third membership) and "exactly ONE org-owned role holds statistics.publish" (2; the 2026-10-14 `demo_everything` demo roles). Inside the same run, section 85 (147) and the patched NINE-template assertion pass.
- `check:schema-parity` through a scratch wrapper that merges `./worship` into the domain namespace: 104 tables (95 + 9), 0 failing. The stock command still reports 95 until the `index.ts` export lands at integration.

**Audit events:** none. A migration is provisioning (the 0071 precedent); Batches 2 and 3 write the five `WORSHIP_*` actions.

**Strings added or changed:** the three permission descriptions, `drizzle/0085_presby_worship.sql:109`, `:111`, `:113` (Copy G1, verbatim); the template name "Worship Leader", `:192` (Copy G1). Guard messages are internal (`worship: ...`) and never shown; the store maps the CONSTRAINT codes to `copy.ts`.

**Handoff to api-developer (Batches 2 and 3)**

- Local apply: `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0085_presby_worship.sql`, then optionally `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/worship/seed-dev-worship.sql`. `npm run db:seed` is unchanged until Batch 2 removes the flag from `scripts/seed.ts`. Until then a re-seed re-creates the inert global `org_portal.worship` row, and section 85b ("the global feature_flags row ... is gone") fails until 0085 is re-applied, since section 5 deletes it again. Remove it from `seed.ts` and `e2e-reset-flags.sql` in Batch 2 as designed.
- Import the tables from `@/lib/db/domain/worship` until the integration export exists. Enter the domain cycle through `@/lib/db/schema` first in tests (see the two new test files).
- Map guard refusals by `err.constraint` (a `WORSHIP_GUARD_CODES` value; SQLSTATE 23514). The state machine in `states.ts` must equal the update guard in section 7o; `states.db.test.ts` (Batch 3) drives the trigger.
- Trigger-owned and never set by the store: `requested_at`, `responded_at`, `withdrawn_at`, both reminder stamps, `updated_at`, `created_at`. A guest insert sets `status 'confirmed'`, `response_source 'on_behalf'`, `responded_by_person_id = assigned_by_person_id`.
- `presby_worship_enabled(org)`, `presby_worship_may_schedule(org, person, group)`, `presby_worship_leads_team(org, person, group, presby_worship_org_today(org))` and `presby_worship_open_count()` are callable on the tenant connection. `presby_worship_claim_reminders(batch)` only on `getPlatformDb()`.
- Batch 6: the e2e fixture sets `app.current_org_id` for owner-path assignment writes (finding above).

## Files Created

- `path/to/file` — purpose

## Files Modified

- `path/to/file` — what changed

## Schema Changes

- [Tables / columns added, or "none"]
- Applied via: `psql` against the pipeline Neon branch, twice

## Audit Events

- [Action key written when the security-sensitive mutation fires]

## Implementer Notes

[Tradeoffs taken, anything that diverged from the design and why.]

Strings added or changed: [file:line each, or "none"]

*Keep Phase 4 sections short: files, deviations from the design, gates with counts, and anything the next phase must know. Leave out narration of how the work went; git history already records it. Judgment output (analyst, architect, qa) is still recorded verbatim.*

### Orchestrator note (2026-11-04): F433 numbered

**F433.** The worship actor guards call `presby_has_permission`, which answers only when `app.current_org_id` equals the row's organization (0010). Inside the app every write goes through `withOrgContext()`, so this holds. Any owner-connection script that places, sends, records an answer on someone's behalf or withdraws must set the org context, or it is refused with 42501. Kept deliberately (fail closed); one test pins the refusal. The Batch 6 e2e fixture and any future importer must set the context. Record at integration in TODO.md (Rule 16) as a known constraint, not a defect.

### Batch 2 (api-developer, 2026-11-04): catalog, keys, pure modules, configuration store

No schema (0085 is Batch 1's). Commit `feat(worship): catalog, keys, pure modules and the configuration store (Batch 2)`.

**Files created** (`src/lib/worship/` unless noted)

- Pure: `vocab.ts`, `states.ts` (the assignment state machine; `canTransition`, `serviceAllows`), `plan.ts` (`overlapWindow`, `pickerWarnings`, `mergeBlockoutRanges`, `validateBlockoutRange`, `sendPlan`, `summarizeSend`), `starters.ts`, `guest-name.ts`, `copy.ts` (Copy G1 to G8 in full, every group, so Batches 4 to 6 need no string of their own), `result.ts` (`WorshipResult`, `mapDatabaseError` over `WORSHIP_GUARD_CODES`), `input.ts` (zod shapes, unknown keys stripped).
- Server: `access.ts` (`loadWorshipContext`, and `runGated`, the gate every export repeats inside its own `withOrgContext`: applicability, toggle with the category axis read OUTSIDE the transaction, then the named keys), `authority.ts` (`holdsKeys`, `holdsAllKeys`, `holdsPermission`, `leadsTeam`, `ledTeamIds`, `canScheduleTeam`; not treasury's helper), `sql-util.ts`, `action-gate.ts` (session plus slug to viewer; `toActionResult`), `store.ts` (the configuration exports: `createTeam`, `adoptTeam`, `updateTeam`, `retireTeam`, `addPosition`, `updatePosition`, `retirePosition`, `setQualifications`, `addTeamMember`, `endTeamMember`, `createServiceType`, `updateServiceType`, `retireServiceType`, `setServiceTypeTeams`), `reads.ts` (`getWorshipContext`, `getTeamsAdmin`, `getTeamAdmin`, `searchRosterCandidates`, `getAdoptableGroups`, `getServiceTypes`, `getServiceType`, `getServiceFormOptions`).
- `src/app/(org)/o/[slug]/admin/worship/actions.ts`: 15 actions (team, position, qualification, roster, roster search, service type). The service actions are Batch 3.
- Test support: `src/lib/testing/worship-world.ts` (the shared throwaway world; owner-path writes that name an actor go through `inOrg()`, F433).
- Tests: `vocab.test.ts` (13), `states.test.ts` (12), `plan.test.ts` (23), `starters.test.ts` (6), `guest-name.test.ts` (7), `copy.test.ts` (20), `result.test.ts` (8), `input.test.ts` (3), `worship-toggle.test.ts` (7, pins the migration's toggle literals to the catalog entry), `admin/worship/actions.test.ts` (97, 15 actions x refusals and mapping); DB-backed `enabled.db.test.ts` (2; `presby_worship_enabled` equals `orgFeatureEnabledInTx` over all 135 type x axis x category x toggle combinations), `store.config.db.test.ts` (43), `store.audit.db.test.ts` (8).
- `scripts/worship/dev-docs.ts.integration.patch` (see below).

**Files modified**

- `src/lib/org-features.ts`: the `org_portal.worship` catalog entry (`flag: null`, `provisionedOn: false`, `operatorEnabled: false`, `orgTypes` congregation and new_worshiping_community, category `worship`).
- `src/lib/org-portal/tiles.ts`: the stub tile replaced by `worship` (operate) and `worship-admin` (administer), toggle-only, no `flagKey`, no `comingSoon`, scoped. `src/components/org-portal/tile-icons.tsx`: `worship-admin` gets `CalendarCheck`.
- `src/lib/onboarding/founding-administrator.ts`: the three keys for the two types, order base, worship, oversight (the SQL order). `designation-parity.golden.json` regenerated with `WRITE_DESIGNATION_GOLDEN=1`; the diff is exactly the three keys on the four congregation and new-worshiping-community scenarios. `founding-administrator-section.tsx`: `PERMISSION_LABELS` gains the three labels.
- `src/lib/audit.ts`: five `WORSHIP_*` actions (mirrored in `audit.test.ts`).
- `scripts/seed.ts`, `scripts/ci/e2e-reset-flags.sql`: the global flag leaves both (the parity test `scripts/e2e-reset-flags.test.mjs` stays green).
- Existing tests updated: `org-feature-catalog.test.ts`, `org-portal/tiles.test.ts` (26 tiles, scoped, byte-for-byte Copy), `org-portal/visible-tiles.test.ts`, `founding-administrator.test.ts`, `founding-administrator-section.test.tsx`, `calendar-visibility.source.test.ts` (`store.ts` listed: it counts upcoming events behind the retire refusals).
- `src/lib/help/coverage-allowlist.ts` and `coverage.test.ts`: `org_portal.worship` and `tile:worship-admin` are TEMPORARY allowlist entries and `tile:worship` is re-reasoned; the pin goes 16 to 18. Batch 6 writes the pages, deletes all three entries and lowers the pin.

**Audit events written** (Batch 2): `tenant.worship.team_created` (`{via, groupId}`), `tenant.worship.roster_changed` (`{change, groupId, personId}`). Positions, qualifications, service types, update and retire are unaudited by design; `store.audit.db.test.ts` pins that, the exact metadata keys, no name or description in any row, and that a failed audit insert rolls the change back.

**Deviations from the design, and findings**

1. **Inserts are raw SQL.** `presby_app` holds column-limited INSERT grants (no `id`, `created_at`, `retired_at`), and Drizzle's `insert().values()` names EVERY column (omitted ones as `default`), which Postgres refuses as a privilege error before any default applies. The first run of `store.config.db.test.ts` failed 17 of 43 on exactly this. Every worship insert in `store.ts` therefore lists exactly the granted columns. UPDATE `.set()` is unaffected. **Batch 3 and every later writer must do the same** (the Drizzle mirror's header should say so; database-admin's call).
2. **Extra modules** beyond the design's list: `result.ts`, `sql-util.ts`, `input.ts`, `action-gate.ts`. The design's `gateInTx` idea became `runGated`.
3. **Copy additions and adjustments.** `SERVICES_COPY.types.duplicate` ("You already have a service type called {name}.") is NOT in the Phase 3 Copy table; a duplicate service-type name needed a sentence, so I wrote the nearest one. Plural-aware forms where the table says "{n} upcoming services", "Send {n} requests?", "{n} people, {m} positions" ("1 upcoming service", "Send 1 request?"). The guest-name control-character refusal reuses the contact-details sentence. `adoptTeam` on an ineligible group answers the generic sentence (Copy has none). Needs a ruling or a Copy line at Phase 6.
4. **Additions to the design's surface:** `getAdoptableGroups` (the "Or use a group you already have" picker needs a read; `worship.manage` and `groups.manage`), `searchRosterCandidatesAction`, `createServiceType`/`updateServiceType` accept `groupIds` so a type and its teams save in one transaction (`setServiceTypeTeams` remains).
5. **`addTeamMember` for a person already on the team (any role, in date) is an `ok` no-op** (`changed: false`, no write, no audit), not an error: Copy has no sentence for it.
6. **Dev-docs and the domain index.** `src/lib/dev-docs.test.ts` ("sees the same tables in the exports as are declared in the schema files") has been red since Batch 1 and stays red until the `domain/index.ts` export lands at integration (Rule 16). Adding the nine tables to `MODULES` before the export would make a second dev-docs test red (stale entry), so they ship as `scripts/worship/dev-docs.ts.integration.patch` ("V. Worship"; the sign-ups pipeline may want the same letter, the orchestrator reconciles). Verified: applying `domain-index.ts.integration.patch` and `dev-docs.ts.integration.patch` together makes the whole file green (15/15); both reverted.
7. The old stub page `admin/worship/page.tsx` and its test still read the (now unseeded) global flag; Batch 5 replaces both. `check:help` still passes because the stub still prints "Worship & Service Planning"; when Batch 5 deletes it, Batch 6's registry label edit must land with it.

**Gates (worktree `presby-worship`, own Neon branch)**

- `npm run typecheck`, `npm run lint` (max-warnings 0): clean. `npm run check`: all ten tripwires pass (run with the Batch 2 files staged).
- `npm test` (unit): 850 files passed, 146 skipped; 13593 tests passed, 3977 skipped, **1 failed: `dev-docs.test.ts` (item 6, expected until integration)**.
- DB-backed, `--no-file-parallelism` with `.env.local`: `src/lib/onboarding`, `src/lib/worship`, `src/lib/db/domain/worship`, `src/lib/org-features*`, `src/lib/org-portal`: 58 files, 1071 tests, all passed. **The 9 tests Batch 1 left red are green** (`invitations.db.test.ts` equality for every organization type, and `designation-parity.db.test.ts` and `designation-parity-in-place.db.test.ts` for congregation and NWC).

**Next:** Batch 3 (scheduling, mail, cron).

### Batch 3 (api-developer, 2026-11-04): scheduling, mail, cron

No schema. Commit `feat(worship): scheduling store, reads, mail and the reminder step (Batch 3)`.

**Files created** (`src/lib/worship/` unless noted)

- `event-hooks.ts` (`onServiceCancelledInTx`, the no-op `onServiceUpdatedInTx`): the second writer on the allow-list, imported only by `events/hooks.ts`. `notify.ts` (`decideReach`, `isPresumedMinor`, `queueRequestNotices`, `queueCancelledNotices`, `queueDeclinedNotice`, `sendQueued`), `messages.ts` (the four notices as pure builders and `worshipLinks`), `sweep.ts` (`sweepReminders(tx)`, `runWorshipReminderSweep()`; the only `getPlatformDb()` user), `drafts.ts` (the ONE read-only decision shared by `sendRequests` and `getSendPreview`: scope and sendable drafts), `counts.ts` (`countUpcomingScheduled`, re-exported by `reads.ts`).
- `store.ts` gains `createService`, `generateServices`, `updateService`, `cancelService`, `setServiceTeams`, `placePerson`, `placeGuest`, `removeAssignment`, `recordResponse`, `sendRequests`, `respondToAssignment`, `addBlockout`, `endBlockout`. `reads.ts` gains `getMySchedule`, `getRequest`, `getMyBlockouts`, `getTeamPage`, `getServicesList`, `getServiceBoard`, `getPickerCandidates`, `getSendPreview`.
- Actions: `src/app/(org)/o/[slug]/worship/actions.ts` (`respondToRequestAction`, `addBlockoutAction`, `endBlockoutAction`, `placePersonAction`, `placeGuestAction`, `removeAssignmentAction`, `recordResponseAction`, `sendRequestsAction`); `admin/worship/actions.ts` gains `createServiceAction`, `generateServicesAction`, `updateServiceAction`, `cancelServiceAction`, `setServiceTeamsAction`. `input.ts` gains the zod shapes.
- Tests: `messages.test.ts` (14), `boundaries.test.ts` (23; W1 to W11), `worship/actions.test.ts` (member tree) and 5 more cases in the admin `actions.test.ts`, `org-feature-warnings.worship.test.ts` (6), DB-backed `store.db.test.ts` (41), `store.send.db.test.ts` (22), `store.cancel.db.test.ts` (10), `notify.db.test.ts` (12), `reads.db.test.ts` (22), `sweep.db.test.ts` (7), `states.db.test.ts` (3; every one of the 150 (from, to, actor) triples through the real trigger), and `store.audit.db.test.ts` (16 now).

**Files modified**

- `src/lib/events/hooks.ts`: the two lists now hold worship's handlers (one line each). `hooks.test.ts` proves it. `events/boundaries.source.test.ts`: the C2 importer scan is now EXACT equality (`events.ts` and `worship/store.ts`).
- `src/lib/contact-methods/email-audience.ts` and its test: the four `person:role` keys; `NAMED["worshipMessage.templateKey"]`.
- `src/lib/org-feature-warnings.ts`: the `org_portal.worship` loader and fallback (Copy G8). `src/app/api/cron/maintenance/route.ts` and its test: the isolated reminder step after the careers sweep, `worshipRemindersQueued` in the summary, fixed label on failure.
- `src/lib/calendar-visibility.source.test.ts`: DECISION-316 readers `store.ts` (text broadened: the join-under-lock reads id, start, place and `cancelled_at`; the duplicate hint reads another service's title), `reads.ts`, `event-hooks.ts`, `sweep.ts`, `drafts.ts`, each only for events carrying a `worship_services` row.

**Audit events written** (Batch 3): `tenant.worship.response_recorded` (`{assignmentId, eventId, answer}`), `tenant.worship.requests_sent` (`{sent, emailed, guardian, noAddress, doNotContact, services}`, on the organization), `tenant.worship.service_cancelled` (`{eventId, withdrawn, notified}`, by the hook, actor null when the caller passed none). Placement, removal, a volunteer's own answer, blockouts and service changes write none; `store.audit.db.test.ts` pins both halves, that a failed audit insert rolls each change back, and that no row carries a name, a reason or a position.

**Deviations from the design, and findings**

1. **`createService` returns `{created: false, duplicate}` and writes nothing** when another service starts at the same minute; the form resends with `allowDuplicate: true` ("Add it anyway"). The design said "returns a duplicate hint (never a refusal)" without saying how the form could ask before creating; this is the smallest shape that can.
2. **Real-date validation.** `parseWallClock` checks the shape and `Date.UTC` rolls 2026-02-30 to March 2, so `createService`, `updateService` and `generateServices` refuse an impossible date or time themselves (`isRealWallClock`, `isDayKey`). A test caught `generateServices` storing a different day.
3. **`decideReach` tells do-not-contact from no-address with the main (`credential`) row.** `chooseEmail('role')` never returns a do-not-contact address, so with no usable address a main row that exists must be the do-not-contact one. No second reader of `contact_methods`.
4. **One reminder email per claimed assignment**, not per person (Copy G7 has single-line reminder forms); a volunteer with two positions the same day gets two. Grouping is a later refinement and needs a Copy line.
5. **The decline notice is not sent when the placer is the decliner**, and a presumed-minor placer gets none (the shared predicate applies to every notice). With no safe platform origin the cancel and decline notices write nothing and the change still commits (the Send refuses up front instead, `mail_unavailable`).
6. **`getSendPreview` also returns `overCap` and `mailAvailable`** so the dialog can disable Send with the right sentence before the click. `sendRequests` returns `notOnTeam` (drafts left behind because the person left the team).
7. **`respondToAssignment` treats a draft's id as `not_found`** (the assignee cannot see a draft), identical to another person's id and an unknown id; the trigger would have answered `forbidden` for a foreign id, so the TypeScript ownership check is what keeps the three answers equal (mutation-checked).
8. **Cancel with the toggle off** (reachable only from Manage events): the rows are withdrawn and audited, nothing is queued. The worship board's `cancelService` refuses with `toggle_off` before reaching the writer.
9. **Test hygiene.** A stray `queued` row with no retry time is the oldest eligible row for `onboarding/issue.db.test.ts`'s `processQueueBatch(1)`; the gate caught my audit test leaving one. Every worship DB suite now deletes the `email_queue` rows it created by address, and the branch holds none.
10. **Dev-docs and help are unchanged from Batch 2**: `dev-docs.test.ts` stays red until the `domain/index.ts` export lands at integration (both patches verified green together); the help allowlist is still +2 until Batch 6.

**Mutation checks** (each mutation made, the named test watched fail, the file restored): remove the C2 join (`store.db.test.ts` "C2"); remove the respond ownership check (the id-guessing test); skip the minor check in `decideReach` (the four-outcomes test); make the cancel hook withdraw confirmed rows (the cancel-hook test); stop cutting a seat holder's Send scope (the scope test). All five failed on the expected assertion.

**Gates (worktree `presby-worship`, own Neon branch)**

- `npm run typecheck`, `npm run lint` (max-warnings 0): clean. `npm run check`: all ten tripwires pass (run with the files staged).
- `npm test` (unit): 854 files passed, 153 skipped; 13725 tests passed, 4102 skipped, **1 failed: `dev-docs.test.ts` (item 10, expected until integration)**.
- DB-backed, `--no-file-parallelism` with `.env.local`: `src/lib/worship`, `src/lib/events`, `src/lib/groups`, `src/lib/onboarding` (designation-parity and invitations included), `src/lib/db/domain/worship`, `src/lib/org-feature*`, `src/lib/calendar*`, `src/lib/contact-methods`, and the admin events, groups, worship and features pages: 134 files, 2647 tests; the one failure (`issue.db.test.ts`, item 9) was my audit suite's stray queue row, fixed and re-run green with `store.audit.db.test.ts` (80 passed).

**Next:** Batch 4 (ux-developer, member surface). The contract a page consumes is the store and reads above plus the two actions files; every string is in `copy.ts`; the email links are built by `messages.ts#worshipLinks` (the pages those links open are Batch 4's: `/o/<slug>/worship`, `/worship/requests/<assignmentId>`, `/worship/teams/<groupId>/services/<eventId>`). Strings added or changed in this batch: none beyond `copy.ts` (Batch 2); the email bodies are `copy.ts` EMAIL_COPY as written in Copy G7.


### Batches 4, 5 and 6 (ux-developer, 2026-11-04): member surface, authoring surface, help, e2e, 360px walk

Commits: Batch 4 `d988d160`, Batch 5 `23138ce8`, Batch 6 (this entry's commit, see `git log`). No schema, no dependency, no `loading.tsx` under `worship/**` or `admin/worship/**`, every form root inside `<HydrationGate>` (plain controlled forms, no react-hook-form), no native dialogs, cards (never a table) at 360px.

**Batch 4 files** (`src/app/(org)/o/[slug]/worship/` unless noted): `worship-gate.tsx` (the `(org)` auth sequence for BOTH trees, plus `readOrState`), `worship-states.tsx` (Off, NotApplicable, Forbidden, LoadError, RequestClosed, BackLink), `page.tsx` + `schedule-card.tsx` + `request-actions.tsx` (My schedule, Accept/Decline with a closed-list reason), `requests/[assignmentId]/page.tsx`, `blockouts/{page,blockout-form,blockout-list}.tsx`, `teams/[groupId]/page.tsx`, `teams/[groupId]/services/[eventId]/page.tsx` (the board); `src/components/worship/` (`status-chip`, `reach-note`, `service-summary`, `service-when` (wall-clock text formatters, no `Date`), `form-bits`, `assignment-row`, `team-board`, `person-picker-dialog`, `guest-form`, `record-response-dialog`, `remove-assignment-dialog`, `send-requests-dialog`). Tests: 24 page-orchestration cases, request-actions 9, blockout form/list 7, states 6, dialogs 20, chip 8, groups helper 1, plus the actions test now covers the two new read actions.

**Batch 5 files** (`admin/worship/`): `page.tsx` (hub, replaces the stub), `teams/{page,new/page,new/team-form,new/existing-group-form,[groupId]/page,position-form,position-row,people-editor,retire-team-dialog}`, `service-types/{page,new/page,[serviceTypeId]/page,service-type-form,retire-service-type-dialog}`, `services/{page,new/page,generate/page,service-form,generate-form,[eventId]/page,cancel-service-dialog,edit-service-dialog,service-teams-editor}`; tests `pages.test.tsx` (24) and `forms.test.tsx` (the forms and dialogs, ~35). The stub `page.tsx` and its test (which read the unseeded global flag) are gone.

**Batch 6:** help pages `worship-serving-on-a-team`, `worship-scheduling-a-team`, `worship-setting-up` (published, no `requires`, `verifiedIn: 0.54.5`, `replaces: ["worship-planning"]`, the planned placeholder deleted, three slugs appended to `slug-history.ts`); edits to `first-day-as-administrator` (stub sentence, a "Worship" bullet, labels), `roles-who-can-do-what` (template list, founder bullet), `turning-features-on-and-off` (table row, tile sentence, label), `events-and-the-calendar` (a section), `why-cant-i-see-this` (a section). The three temporary allowlist entries are deleted and the pin is 15 (Batch 3 item 8). `docs/product/functionality-map.md` gets a Worship bullet (Rule 14; `check:help` H15 demands it) and its "NOT built" line is corrected. `src/lib/giving/csp.test.ts` and `src/lib/help/next-config-wiring.test.ts` each pinned "no help redirects"; `replaces` now yields `/help/planned/worship-planning`, so both were updated (the redirect is intended). e2e: `e2e/support/worship-fixture.ts` (own file; people `00000000-0000-4085-8000-`; every guarded write sets the org context in the same `DO` block, F433), `worship-schedule.spec.ts` (3), `worship-respond.spec.ts` (4), `worship-toggle.spec.ts` (3), `hydration/worship-forms.spec.ts` (2). All 12 pass on my own dev server (`E2E_BASE_URL=http://localhost:3690`).

**Deviations and additions the design did not name**
1. **Two read actions** added to the member `actions.ts` (`getPickerCandidatesAction`, `getSendPreviewAction`) with their zod shapes: the picker and the Send dialog are client components and `reads.ts` had no action door. They repeat the store's gate; the actions test runs both through the generic refusal matrix.
2. **`NAV_COPY` in `copy.ts`** (new): back links, "Try again", slots count, "New service type", "Edit service type", a few empty-state sentences ("No teams are serving yet.", "Save a service type first, then come back to add several services.", "Every team is already serving."), `minutes`. NOT in the Phase 3 Copy table; each needs a Phase 6 read and a fork's branding pass. Also reused: `TEAMS_COPY.page.qualificationsSaved` ("Saved.") as the toast for a position rename or number change; `TILE_COPY.admin.description` as the hub subtitle; `MEMBER_COPY.team.empty` for an empty roster.
3. **Times print through `src/components/worship/service-when.ts`**, the wall-clock formatters the calendar uses ("Sunday, November 16 at 9:00 AM"), not `<FormattedDate>`: that component calls `toLocaleString()` and would print "11/16/2026, 9:00:00 AM" for a label that has no zone. Bare dates print as "Sunday, January 3, 2027".
4. **No `min`/`max` on the numeric inputs** (slots, minutes, how many): a native range check would show the browser's sentence instead of Copy's ("Choose a number from 1 to 20.", "You can add up to 26 at a time."); the server is the validator.
5. **The Groups helper line is added under the existing "This is descriptive only - it does not grant software access."**, so the two now sit together and the first is no longer accurate for a chair or leader of a worship team (it already was not, for reimbursements). Needs a Copy ruling at Phase 6 (soften or drop the older sentence).
6. **Admin service page sends once for the whole service** (a `worship.schedule` holder) and hides the per-team Send there; the member board keeps the per-team Send. A guest placed by a leader shows "Recorded by {leader}" because the store stamps it `on_behalf`.
7. **Status chips and the tag pills carry `// ui-ok:`** (14px text with an icon; `<Badge>` is 12px and nowrap). Services "Coming up"/"Earlier" are `<Button asChild>` links with `?scope=earlier`.
8. Production lane: `PW_PROD_BUILD=1 PW_PROD_PORT=3691 ... --project=prod-build e2e/hydration/worship-forms.spec.ts` builds and starts its own server on 3691; both hydration cases pass there too.

**360px walk (Playwright at 360x740, every image opened and read).** Taken by the specs into `test-results/worship-360/` (gitignored): 01 member/leader home, 02 team page, 03 admin forbidden, 04 board empty, 05 picker, 06 picker (minor), 07 guest refused, 08 board with drafts, 09 Send dialog, 10 board after Send, 11 record answer, 12 remove dialog, 20 hub, 21 services, 22 teams, 23 team page, 24 new team, 25 created team, 26 new service, 27 created service, 28 service with an open request, 29 cancel dialog, 30 member home, 31 request, 32 decline reason, 33 empty, 34/35 blockouts, 40/41 the off states. Read in full: 01, 04, 05, 06, 09, 10, 11, 21, 23, 32, 35 (the rest were checked by the assertions in the specs: no sideways scroll, every button, link, select and input in `main` at least 44px high except the portal layout's own "Back to portal" link at 20px, which is not worship's). Findings: (a) nothing overflows; long names wrap (`[overflow-wrap:anywhere]`); (b) the candidate list, the Send dialog and the remove dialog fit with 44px buttons stacked full width; (c) the admin tree shows two back links stacked ("Back to portal" from the admin layout, then mine); left as is, a tidy-up for the orchestrator; (d) screenshot 11 caught the dialog mid-fade, and 12 was not re-read after (the assertions on both dialogs' text pass); (e) on the team page "Can fill" is the label of the button that opens the qualifications editor, terse but unambiguous beside "Can fill: Vocals"; (f) the Next dev-tools badge overlaps content in the images and is dev-only. As the people the design names: the scheduler (hub, services, teams, service page), the team leader with a seat and no key (home, team, board, Send, record, remove, refused on the other team and on the admin tree), the member (home, request, accept, decline, blockouts, empty state, another's id 404) and a minor's leader view (picker note, "No email sent: may be under 18...", record on her behalf, "Recorded by").

**Not done, stated plainly (SUPERSEDED: see "Batch 6 gap-closing" below; items 1 to 3 and 5 are done, item 4 stopped).** The two specs the design lists that I did not write: (1) the MFA-enrolled member opening the email link signed out and landing on the request after the code, and (2) `worship-founder.spec.ts` (the F362 lesson: a founding administrator minted by `presby_apply_founding_administrator`); both need fixtures beyond the time I had (the enrolled-TOTP secret on a worship person, and the definer call). The Features card warning dialog with its count is unit-tested (`org-feature-warnings.worship.test.ts`) and was not driven in a browser. `help:shots` images (`portal-tiles`, `admin-hub`) were not re-captured: they were taken before the stub tile left and may still show "Worship & Service Planning"; the operator should check them (the registry check passes because it reads text, not pixels). A global `Rule 16` item: no shared file was edited.

**Gates.** `npm run typecheck`, `npm run lint` clean; `npm run check` all ten pass; `npm test` has the one expected failure (`dev-docs.test.ts`, until the `domain/index.ts` export lands at integration).


#### Batch 6 gap-closing (ux-developer, 2026-11-04, the coordinator's six items; fourth commit)

1. **Missing specs, written and green on :3690.** `e2e/worship-respond-mfa.spec.ts`: the leader's real Send queues the request email; the link in its body is exactly `/o/<slug>/worship/requests/<id>` with no `?`; Wren (an MFA-enrolled account, the shared enrolled TOTP secret) opens it signed out, is sent to `/signin?callbackUrl=...`, signs in, answers `/totp`, lands on THE REQUEST and accepts. `e2e/worship-founder.spec.ts`: the founding administrator is minted by `presby_apply_founding_administrator` (not a hand-made role); the spec asserts the three worship keys came with the bundle, then she opens "Plan worship", creates a team from the Greeters set, adds a person and "Can fill", adds a service and places the person as a draft. Fixture additions in `worship-fixture.ts` only: `founder`, `mfa: [...]`, TOTP handling in `signedInContext`. **Findings from writing it:** (a) the founding bundle includes a two-factor-requiring key, so the founder is sent to enrol on first sign-in; real behaviour, the fixture enrols her. (b) **Real defect candidate, for tech-lead/database-admin:** `presby_apply_founding_administrator` stamps `role_grants.starts_on` with the database's `current_date` (UTC), while every worship guard asks "as of the ORGANIZATION's today" (America/New_York). In the hours when UTC is already tomorrow (evening in the US), a freshly minted founder passes the page and the picker (the key read) but is refused at the trigger on her first placement ("You don't have permission to do that."). Observed live at 21:2x EST. The fixture back-dates the grant to 2020 like every other fixture grant, with a comment. A new F-number is needed at integration; it probably affects any key a just-minted founder uses, not only worship. (The founder spec does not drive the admin-hub tile, so it sets no `org_portal.admin_hub` flag.)
2. **Features-card warning dialog driven in a browser**: a fourth test in `worship-toggle.spec.ts` (captures, sets and restores the platform flag `org_portal.features`): the card (name and description from Copy G1), the switch, the dialog "Turn off Worship?" with the Copy G8 singular sentence ("1 person is asked or scheduled for upcoming services. Turning this off hides the schedule and stops requests and reminders. People who were asked can't answer until you turn it back on. Nothing is deleted."), "Keep it on" leaves the toggle on, "Turn it off" turns it off and deletes nothing (the assignment count is unchanged). The shared Features page draws the warning's description but not its own title ("People are scheduled for upcoming services"), as for Reimbursements; the dialog title is "Turn off Worship?".
3. **Every 360px screenshot read** (37 images now, `test-results/worship-360/`, re-taken after a 450ms settle so dialogs are not mid-fade). Findings, image by image:
   - 01 leader home, no requests: empty state with its sentence, "Your teams" with "You lead". OK.
   - 02 team page: leader badge, people with "Can fill:", upcoming services with full-width "Schedule this team". OK.
   - 03 leader on the admin tree: the Copy forbidden sentence naming the church. OK. (The "Back to portal" link, 20px high, comes from `admin/layout.tsx`, not a worship file; not touched.)
   - 04 board empty: positions "X, 0 of N", dashed "Open" rows, two full-width buttons per position. OK.
   - 05 picker: title, "Show everyone on the team", name, "Can fill this position", full-width Add. OK. 06 picker with a child: "May be under 18. They won't get an email." OK.
   - 07 guest: the contact-details refusal inline in red under the hint; the hint and the error both read, a little repetitive. Left.
   - 08 drafts: "Not sent yet" chips with icons, guest chip, "Send requests (2)". OK.
   - 09 Send dialog: "Send 2 requests?" with the counts sentence; counts assignments in the title and people in the body ("1 can't be emailed"), as Copy words them.
   - 10 after Send: "Request emailed." and the guardian sentence, per row. OK.
   - 11 record answer (re-taken settled): Accepted/Declined radios at 44px, "This is saved as entered by you." OK. After recording, Posy's reach note still reads "ask a parent or guardian, then record their answer" beside "Confirmed" (it is the stored Send outcome, true as a record, stale as an instruction); a Phase 6 copy question.
   - 12 remove dialog (re-taken settled): the sent-request body says they are not told. The confirming "Remove" is the primary (blue) button, not a destructive one, as for every dialog here (the house `Button` has no destructive style in use).
   - 20 hub: three cards, subtitle from the tile description. OK. 21 services: cards with "N of M positions filled" and "N waiting". OK. 22 teams: counts. OK.
   - 23 team page: very long on a phone (one card per person and position, each with 3 buttons), usable but tall; a later increment could collapse a position's three actions into a menu.
   - 24 new team: three labelled fields. OK. 25 created team: "Team created." toast, positions, the seat note, empty-roster state. OK.
   - 26 new service: native date and time pickers, teams as 44px checkbox rows. OK.
   - 27 created service (toast overlapping the heading in the picture only); 28 the full board with "Teams serving", "Add a team" and one board per team; 29 cancel dialog with the Copy body ("Keep it" is the second button).
   - 30 member home: sections in order with Accept/Decline. 31 request page: the Copy sentence, "Where:", Accept/Decline. 32 decline with a reason: the closed list with its helper. 33 empty member home. 34 blockouts empty: the form, then the empty state sits directly under the Save button with little gap. 35 blockouts saved and refused: the inline error plus a toast, the joined range listed.
   - 40 off for a member (the whole sentence including whom to ask), 41 off for the planner (link "Turn it on under Features").
   - 42 Features page: the Worship card at the bottom of a long list, switch on. 43 the warning dialog with the count, buttons "Turn it off" and "Keep it on".
   - 50 founder hub, 51 founder team (Greeter, 2 people; "Saved." toast), 52 founder board with "Send requests (1)". OK.
   - 60 sign-in page for the emailed link (platform chrome, no worship content, as designed), 61 the code page (six boxes), 62 back on the request after the code. OK.
   - Overflow and targets are asserted in the specs: no sideways scroll, and every button, link, select and input inside `main` is at least 44px except the layout's own "Back to portal". The Next dev-tools badge in the images is dev-only.
   **Back links:** removed from every `admin/worship` page (the admin layout's "Back to portal" is the one back link, as asked); the design did not name them. Consequence: the sub-pages (a new team, a service type) have no link back to their list other than the browser's. The member pages keep theirs (the member tree has no layout back link).
4. **`npm run help:shots`: refused, so item 4 is not done.** The guard (`e2e/help-shots/guard.ts`) refused this branch: G1 3 organizations outside the fixture list, G2 1 organization profile row, G3 1 user or contact email not on `.invalid`, G5 `HELP_SHOTS_DB_OK=1` not set. The branch carries `seed-dev.sql` data, so it is not fixture-only; I stopped there as instructed. `portal-tiles` and `admin-hub` still need a re-capture on a fixture-only database; until then they may show the old tile.
5. **Groups sentence replaced** (`TEAMS_COPY.groupsRoleNote` in `copy.ts`): "Member, Chair and Leader describe a person's part in the group. They give no access to the rest of PresbyPortal." It replaces "This is descriptive only — it does not grant software access." under the role select, and the same false claim above the form on the group page ("This is descriptive only — granting software access (Administration → Roles) is done separately.") is removed (the form's two lines now carry it). The worship/reimbursement sentence stays right under it.
6. **Full `npm test`** run at the end; exact counts are in the commit report.

**Strings for Phase 6** (not in the Phase 3 Copy table; each needs a read): `NAV_COPY` (all of it: back links, "Try again", the slots count, "New service type", "Edit service type", "No teams are serving yet.", "Save a service type first, then come back to add several services.", "Every team is already serving.", "No teams yet. Make a team first, then choose it here.", "N min", "Loading...", "We couldn't load that. Try again.", "Saving...", "No one matches that search.", "Add guest"); `TEAMS_COPY.groupsRoleNote` (above); reuse of "Saved." for a position rename; the hub subtitle reusing the tile description; the stale guardian reach note after an answer is recorded (image 11).


#### Batch 6 UI fixes (ux-developer, 2026-11-04, coordinator's four items; fifth commit)

1. **Back links restored**, exactly one on each sub-page, pointing at its parent list: the three lists (Teams, Service types, Services) link to "Back to Plan worship"; new team, one team, new service type, one service type, new service, add several, one service link to their list. The hub (`admin/worship`) has none of its own. As the coordinator asked, they stack under the admin layout's "Back to portal" (seen in the re-taken 22, 24 and 29).
2. **The guardian instruction is shown only while an answer is needed**: `assignment-row.tsx` hides the stored "No email sent: may be under 18. Ask a parent or guardian, then record their answer." once the row is confirmed or declined; "Recorded by {name}" stays. Unit-tested for requested, confirmed and declined; the schedule spec asserts the note is gone after Record answer.
3. **Destructive confirms use `variant="destructive"`**: remove from a position (this is the board's withdraw), cancel service, retire team, retire position, retire service type, remove from team. Send stays primary (a unit test pins both). NOT changed, because they are not worship files: the Features page's "Turn it off" dialog (shared `org-features` UI, also used by Giving and Reimbursements) and the reimbursement "Withdraw this request" dialog; both are worth the same treatment in their own pipelines.
4. **Team page height: not changed, recorded for Phase 6.** Copy G3 names "Rename", "Change number", "Retire" and "Remove from team" as row actions and the design plans visible buttons; collapsing them into a menu or a "Change" control would need a new label (not in Copy), the `DropdownMenu` primitive wrapping an `AlertDialog`, and re-testing every dialog on a phone. Phase 6 should decide whether a team of five people and seven positions needing about three screens is acceptable, or whether a later increment adds a menu.
Re-taken and read at 360px: 12 (remove dialog, red "Remove", Posy "Confirmed" with only "Recorded by"), 29 (cancel dialog, red "Cancel service"), 24 and 22 (back link under "Back to portal"). Gates: typecheck, lint, `npm run check`, the affected unit tests (317 passed across worship components, member and admin trees), and all 15 worship e2e specs on :3690 pass. The F434 fixture change (removing the 2020 back-date) is a later task and was not touched.

#### F434 fix (database) (database-admin, 2026-11-04)

Steps 1 to 3 of "Phase 3 amendment 2 (F434)", DECISION-328 (number confirmed by the orchestrator). **Migration mode: hand-written, in place** in `drizzle/0085_presby_worship.sql` (unreleased; same file, same number; no `_journal.json` change, the `idx 85` entry already exists). No table or column change.

- **New** `presby_worship_in_effect_day(p_org uuid, p_now timestamptz default now()) returns date`: `greatest(organization day, UTC day)`, `stable security definer`, `search_path` pinned, the same zone fallback as `presby_worship_org_today`. EXECUTE owner and `presby_app` only (added to the helper loop: revoke from public, presby_app, presby_platform, then grant presby_app). Comment states the rule and the reason. `p_now` is the test seam; no caller passes it.
- **Switched to the in-effect day:** `presby_worship_may_schedule` (the resolver's `p_as_of` and the seat's), and the roster check in `presby_worship_assignments_guard_insert` (`v_today` renamed `v_day`; it had no other use). No other `role_grants` or `group_memberships` date comparison exists in 0085 (`presby_worship_leads_team` takes `p_as_of` and is unchanged; its comment now names the new function).
- **Kept on the service day, each classified in a one-line comment:** the blockout `ends_on < org_today` refusal, and the seven `presby_worship_org_now` uses (open count, reminder claim windows, the three "service has started" checks), all wall clock against `events.starts_at`. The `presby_worship_org_today` comment now says it is for worship's own dates only. `src/lib/db/domain/worship.ts`'s function list names the new helper.
- **Restatement (English):** a grant, seat or roster row counts today when it started on or before the later of the organization's date and the UTC date, and has not ended on or before that same later date. Matches the ruling.

**Tests (failing-first, run 2026-11-05 02:38 to 03:20 UTC = 21:38 EST, inside the F434 window, so Etc/GMT+12 was the chosen zone):**
- `src/lib/worship/in-effect-day.db.test.ts` (new, 15 cases). Part 1, the `p_now` seam at the three fixed instants (New York 02:35 UTC on the 5th gives the 5th; Auckland 22:00 UTC on the 4th gives the 5th; New York 15:00 UTC gives the 4th), a no-settings-row organization, and the fallback literal pinned to `DEFAULT_ORG_TIME_ZONE` by reading `pg_get_functiondef` (the literal is not observable by behaviour: greatest(New York day, UTC day) is always the UTC day). Part 2, no seam, presby_app with RLS and the triggers live: a grant, a leader seat, a roster row, and seat plus roster stamped on the in-effect day each place a draft; a grant, a seat and a roster row ended `current_date` (the platform's revoke) are refused `not_authorized` / `not_on_roster`; a grant and a seat stamped one day later are refused; the helper equals an independently computed `greatest`. **Before the fix: 13 failed, 2 passed** (the precondition and the one-day-ahead case). The five seam cases failed with 42883 (function absent); (a) and (b) failed `expected 'worship_guard_not_authorized'` / `'worship_guard_not_on_roster'` `to be 'ok'`; the three (c) cases failed `expected 'ok' to be 'worship_guard_not_authorized'` / `'..._not_on_roster'`, which is the fail-OPEN the ruling named, reproduced. **After: 15/15.** Honest limit (in the file header): part 2 discriminates only before UTC noon; after noon it runs Etc/GMT-14, where old and new rules agree.
- `scripts/worship/test-rls-85.sql`: new block **(g)** (zone chosen as above; precondition; the helper as presby_app; the F434 instant; a grant inserted with NO `starts_on` so it takes the column default exactly as the definers do, then may_schedule and a real placement through the trigger; a roster row with the default stamp, placed; `ends_on = current_date` on a grant, a seat and a roster row, refused). **(a)** counts moved: five definers (was four), seven tenant-path helpers (was six), and "no defaulted parameter" now exempts exactly the in-effect day's `p_now`, plus an assertion that it exists once with that one default. Before the fix the whole file stopped at 85a line 307 (`expected 5, got 4`); a scratch copy of (g) without the two by-name helper calls failed at `85g: a grant stamped today (UTC) schedules today, in either zone direction — expected 1, got 0`. **After: exit 0, 158 pass lines** (147 before this change plus 11).

**Proof:** 0085 applied twice in full to `pipeline-worship-inc1` (`ep-autumn-hall-axbadmif`) with `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0085_presby_worship.sql`: both exit 0, no errors, counts identical after each (worship_assignments 7, worship_teams 2, worship.* bundle keys 3, presby_worship_* functions 17). Then `psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/worship/test-rls-85.sql` (presby_app): exit 0. Vitest `--no-file-parallelism` over `src/lib/db/domain/worship.db.test.ts` and `src/lib/worship/`: 23 files, 364 tests passed. `npm run typecheck` clean; eslint clean on the new file.

**Handoff:** api-developer next (step 4: `store.ts:190, 543, 1414`, `drafts.ts:92`, and also `authority.ts:109`, `reads.ts:165-166` and `reads.ts:488`, which compare grant or seat dates on `presby_worship_org_today` and were not in the ruling's list; plus the boundaries source scan, which should now also cover those). Then ux-developer (step 5, the founder fixture). Local apply: the psql command above; no seed change.

---

# Phase 5 — Verification (qa)

**Date:** YYYY-MM-DD
**Verified by:** qa

## Type Check

`npm run typecheck`: PASS / FAIL

## Unit Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [test name — error — file:line]

## End-to-End Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [...]

## Regression Tests Added

- [test name — file:line — guards against: brief description]

## Coverage on Critical Modules

- `src/lib/permissions.ts`: X%
- `src/lib/two-factor.ts`: X%
- `src/lib/flags.ts`: X%

## Feature-Gate Audit

*(Mandatory. Verified by reading route/action bodies, not by inferring from green tests.)*

| Route or action | `auth()` present? | Gate (toggle, then key or seat or own row) present? | Correct key? |
|-----------------|-------------------|-----------------------------------------------------|--------------|
| [action name] | yes / no | yes / no | `worship.X` or seat or own row |

## Copy Truthfulness

- [ ] Every added or changed string is in the design's Copy table
- [ ] The query behind each claim about a person, account, date or state was opened, and what it does not read was named
- [ ] Each instruction was traced to the role that sees it, and that role can do it (render gate and permission check)
- [ ] Older strings about the same subject were grepped for and none is made false
- [ ] Help diff covered: every labels string is on screen, every claim walked at 360px, every committed image opened

## Verdict

[PASS | FAIL | BLOCKED — name the unmet prerequisite]

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

[SHIP IT | SHIP WITH NOTES | NEEDS REWORK]

## ONE-LINE TAKE

> [The shipped feature in one honest sentence.]

## What's Working

- [Specific.]

## Intent-vs-Shipped Diff

- Phase 1 said: [X]. Shipped: [Y]. Verdict: [matches | acceptable drift | regression]

## Edge Cases

- Empty state: [pass | fail | not applicable]
- Failure microcopy: [pass | fail]
- Permission gate: [pass | fail]
- Audit event: [pass | fail | not applicable]
- Mobile (360px): [pass | fail]
- Walked as the accepted-invitation founding administrator (F362 lesson): [pass | fail]
- Help pages read as their reader (each page named in Help impact): [pass | fail]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific.]
