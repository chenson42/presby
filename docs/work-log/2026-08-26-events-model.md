# Events Model — Work Log

> **Slug:** `2026-08-26-events-model`
> **Surface:** TBD Phase 1 — schema-first; the domain barrel (`src/lib/db/domain/index.ts`) explicitly deferred events "pending their own requirements pass" — this is that pass
> **Permission(s):** TBD Phase 1/3
> **Flag(s):** TBD Phase 3
> **Estimated complexity:** large
> **Pipeline mode:** Full — spun out of `2026-08-26-childrens-ministry` (whose check-in increment is blocked on this) per the operator's "all in parallel" decision.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-26 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-26 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-08-26 |
| 4 — Implementation | database-admin (commit 1, schema); full-stack-developer (commit 2, module/UI) | Complete | — | 2026-08-27 |
| 5 — Verification | qa | Complete | PASS | 2026-08-27 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-27 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> presby has zero events infrastructure today (only a coarse, non-dated `organization_service_times` weekly-pattern table for the public-site header) and at least four real consumers waiting on one; fpcw-directory already proved a working shape — discrete rows with a parent-child recurrence convenience, not full RRULE, not a template/instance split except where worship later needed one — and Phase 1's job is to frame, not silently pick, the three tradeoffs Phase 2 must rule on.

## Prior Art vs Presby — What Actually Transfers

| Source | Concept | Shape | Transfers to v1? |
|---|---|---|---|
| fpcw-directory | `events` | Flat table: title/description/location, eventDate/endDate, isPublic/membersOnly/showInKiosk, `isDropOff` (enables check-in), RSVP config columns, `parentEventId` self-FK + `recurrencePattern` text + count, `cancelledAt` soft-delete, Google Calendar mirror | Core shape: yes. RSVP columns: no (v1). Google Calendar: no. |
| fpcw-directory | `src/lib/events/recurrence.ts` | Pure functions: SimplePattern (weekly/biweekly/monthly or day-of-week ordinal) → N discrete dates, one row per date | Yes — the "repeat-creation convenience" answer to recurrence. |
| fpcw-directory | `youthCheckins` | FKs to `events.id` directly | Confirms check-in needs a **discrete row**, not a pattern. |
| fpcw-directory | worship templates/instances/junction | A second, heavier pattern-first model built later specifically for worship | Explicitly out of scope for v1 — don't preclude, don't build. |
| psvonline | `congregation_services` | Weekly schedule, no dates | Confirms `organization_service_times` is not an events table and shouldn't become one. |
| presby | `organization_service_times` | kind/dayOfWeek/startTime/endTime/label, feeds `presby_published_site()` → site-kit ServiceTimes | Coexists — answers "what time is Sunday service, forever," not "what's on the calendar." |
| presby-site-kit | `EventList` block | Already built, fed only by content-authored JSON today | The public-calendar consumer is half-built: rendering exists, live data feed doesn't. |

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Org staff/admin | Creates a single dated event (title, date/time, location, public/members-only) | on demand |
| Org staff/admin | Creates a recurring series via "repeat weekly ×N," generating discrete rows | occasional |
| Org staff/admin | Cancels one occurrence without touching the rest | on demand |
| Org staff/admin | Marks an event check-in-enabled (the `isDropOff` equivalent) — **the exact interface children's-ministry blocks on** | on demand |
| Anonymous visitor | Views upcoming public events on `/site/<slug>` | per visit (increment 4) |
| Check-in staff | Checks a child into a specific occurrence | **owned by the sibling pipeline; this one only supplies the row to key to** |

## Flows

**Flow 1 — Create a discrete event:** `/o/<slug>/admin/events` new → title/date/time/location/visibility → save. Failure: end-before-start, missing fields — server-side validation.

**Flow 2 — Create a recurring series:** repeats-weekly toggle + end date/count → N discrete rows sharing `parent_event_id`, each independently editable after. Failure: pattern-edit-after-generation rule undefined — Gap #1.

**Flow 3 — Mark check-in-enabled:** checkbox → `events.id` becomes a valid check-in target. The contract Phase 3 must nail jointly with children's-ministry.

**Flow 4 — Public calendar:** upcoming, non-cancelled, public events on `/site/<slug>`. Failure: empty state (Gap 9); fail-soft on fetch failure (Gap 10).

**Flow 5 — Cancel one occurrence:** `cancelledAt` set, row stays (never hard-deleted once anything can FK to it).

## Permissions & Flags

- **Permission:** new `events.manage` (org-scoped, likely tier 1 pending architect confirmation). Public visibility is a data attribute (`is_public`), not a permission.
- **Default roles:** TBD Phase 3, no wildcard.
- **Flags:** none for the schema increment; increment 4 (public rendering) behind a new `sites.public_events` flag mirroring `sites.public_render`, seeded off.

## Gaps the Request Didn't Address

1. **Recurrence retro-edit rule** — recommend fpcw's precedent: editing the pattern extends/regenerates the horizon, never retroactively rewrites materialized rows.
2. **Relationship to `organization_service_times`** — recommend coexist; Phase 2 rules explicitly.
3. **The check-in interface contract is underspecified** — the load-bearing gap; a sibling pipeline is paused on it.
4. **Timezone** — wall-clock local time (matching service times, defensible under D6's US-only scope) vs. `timestamptz`; matters at DST boundaries.
5. **Soft-cancel, never hard-delete** once anything FKs to an event — `cancelled_at`, analogous in spirit to `merged_into_id`.
6. **Composite tenant keys** — non-negotiable from row one.
7. **FORCE ROW LEVEL SECURITY** — same.
8. **Audit** — event create/cancel likely isn't Rule-7 security-sensitive; architect confirms rather than assumes.
9. **Empty states** for the public calendar and admin list.
10. **Fail-soft public rendering** — the events block should omit itself on a failed fetch, matching `presby_published_site()`'s collapse discipline, not take down the page.
11. **Mobile at 360px** for both surfaces.
12. Groups' `meets_when` — confirmed out of scope, not precluded.

## Out of Scope (confirm with user)

- RSVP/signup + volunteer roles (fpcw's eventSignups/eventRoles) — future increment.
- Google Calendar sync — not requested.
- The check-in UI/kiosk — the sibling pipeline's.
- Worship role scheduling — future; schema shouldn't preclude.
- Full RRULE — recommend never, unless a real consumer asks.

## Adversarial Pass

- **Public-visibility leak (highest-stakes):** the public projection must filter `is_public` server-side inside `presby_published_site()`'s existing collapse discipline — a session meeting must never leak through the public page.
- **Enumeration:** admin event URLs rely on ordinary RLS + the (org) contract — confirm explicitly in Phase 3/4.
- **Input boundaries:** server-side length limits from the start (this gap shipped client-only once already).
- **State-machine shortcut:** `events.manage` checked server-side on create/cancel, not just hidden nav.

## Open Questions

1. **(Most important) The exact check-in contract:** minimum `events.id`, occurrence date/time, tenant scope, and an `isDropOff`-equivalent boolean (`allows_checkin`?). Both pipelines must agree before children's-ministry Increment C re-runs its Phase 1.
2. Coexist with or subsume `organization_service_times`? Recommend coexist.
3. One `events` table or events + instances? Recommend one flat table with `parent_event_id`; template/instance split reserved for worship-if-ever.
4. Timezone: wall-clock vs timestamptz?
5. Public rendering: live data alongside (not instead of) content-authored events, so existing pages don't break — recommend alongside.

## Proposed Increments

1. **Schema (this pipeline):** `events` — org-scoped composite keys, FORCE RLS from day one, minimal columns: title/description/location, start/end, `is_public`, `cancelled_at`, `parent_event_id` + `recurrence_pattern`, the check-in boolean (name fixed jointly with children's-ministry), created_by, timestamps.
2. **Admin UI:** create/edit/cancel single + recurring under `/o/<slug>/admin/events`, gated on `events.manage`.
3. **Children's-ministry unblock:** their Increment C re-runs Phase 1 against the concrete `events.id`.
4. **Public rendering:** `presby_published_site()` optionally emits upcoming public events behind `sites.public_events`, feeding the site-kit's existing `EventList` block alongside content-authored mode.
5. **(Future, separate):** RSVP/signup, worship scheduling, group meetings.

**Handoff:** architect (Phase 2) — rule on the three framed tradeoffs (recurrence shape, one-table-vs-two, service-times relationship) before tech-lead designs Increment 1.

---

# Phase 2 — Architectural Review (architect)

## Verdict

Approved with suggestions — rulings recorded in full as DECISION-113.

## Placement

- New domain schema file `src/lib/db/domain/events.ts` (pgTable definitions only, per the schema/logic split); added to the barrel, whose events-deferral comment gets amended to record that this pipeline is that pass.
- New query/mutation module `src/lib/events.ts` (list/create/cancel + pattern-generation helpers; increment 4's `presby_published_site()` widening also lands there) — same shape as `src/lib/sites.ts`.
- Admin tree `src/app/(org)/o/[slug]/admin/events/` + co-located `actions.ts`, matching the members/officers/groups siblings exactly.
- Server vs client: list/detail are Server Components via `withOrgContext()`; the create/edit form and recurrence toggle are client islands using existing primitives.
- Dependencies: **none** — fpcw's recurrence logic is ~200 lines of vanilla Date math, ports directly; no rrule/date library warranted.

## Invariants Touched

- **Composite Tenant Keys:** `unique(id, organization_id)`; check-in's future FK must be the composite pair. `parent_event_id` is a self-FK whose same-org property is enforced at the app/guard layer (not expressible as a composite self-FK without circularity — same class as `groups`' own derived-check).
- **FORCE RLS:** from row one, standard tenant policy. Non-negotiable.
- **Permissions vs Flags:** `events.manage` (tier 1 permission) gates mutations; `sites.public_events` (flag) gates only whether increment 4's public projection renders. Increment 1 introduces no flag.
- **The `(org)` contract:** `withOrgContext()` only; page-level auth; no `loading.tsx` exception needed (pages render, not redirect).

## Rulings (full text in DECISION-113)

1. **Recurrence — confirmed:** one flat table, discrete row per occurrence, `parent_event_id` + stored `recurrence_pattern`/`recurrence_count` (convenience generation, never parsed at read time). Retro-edit semantics: pattern edits extend/regenerate the horizon only; a materialized row never moves under an existing reference — an admin edits one occurrence directly, or the series-going-forward via the parent.
2. **`organization_service_times` — coexist, bright line:** it answers "what time is it, every week, forever" (site header); `events` answers "what's on the calendar." Neither writes the other; the Sunday service is deliberately not auto-materialized. Any future "next Sunday as a calendar item" is a new explicit decision, not an implicit merge.
3. **Timezone — wall-clock (`timestamp` without tz):** no org-timezone column exists (D6, US-only); materialized discrete rows mean "7:00 PM" stays "7:00 PM" through DST with zero machinery. `cancelled_at` is the one legitimate `timestamptz` (an instant, not a schedule fact).
4. **Check-in contract — FROZEN, six columns:** `id`, `organization_id`, `starts_at`, `ends_at` (nullable), `cancelled_at` (check-in must reject cancelled occurrences), `allows_checkin boolean not null default false` (adopted over fpcw's `is_drop_off` — generic beyond children's ministry). Children's-ministry Increment C depends on exactly these and no others, non-renegotiable without a joint re-review.
5. **Tier + audit:** `events.manage` tier 1; create/cancel NOT Rule-7 security-sensitive (content configuration, matching the service-times/profile precedent).
6. **Public projection:** `presby_published_site()` widens in place (never a second function), behind `sites.public_events`; **`is_public`/`cancelled_at`/future filters live inside the SQL function's own WHERE clause, never app-side** — the load-bearing ruling against the members-only-meeting leak.
7. **Placement/category:** confirmed; portal tile `operate` (DECISION-105's routine-work test).
8. **Dependencies:** none.

## Notes

- Increment 1's schema also carries `title`/`description`/`location` (text, app-level length limits from the start), `is_public boolean not null default true`, `created_by`, timestamps — not architecturally interesting, listed so tech-lead needn't re-derive.
- Phase 3 must specify the public-events query's exact WHERE + index (leading with `organization_id`) and the default role binding for `events.manage` (no wildcard).
- The `parent_event_id` same-org guard needs an explicit app-level check.

**Handoff:** tech-lead (Phase 3) — Increment 1 (`events` schema + permission + admin CRUD contract) against the rulings above, the check-in column set treated as frozen.

---

# Phase 3 — Technical Design (tech-lead)

**Scope of this pass: Increment 1 (schema) + Increment 2 (admin CRUD at
`/o/[slug]/admin/events`) only.** Increment 3 (children's-ministry unblock)
re-runs that pipeline's own Phase 1 against the frozen six-column contract;
Increment 4 (public rendering via `presby_published_site()` + `sites.
public_events`) is a separate future pass. Nothing below builds toward those.

## Summary

`events` becomes presby's first real calendar table: a flat, org-scoped,
composite-keyed table holding one row per discrete occurrence (never a
template/instance split), matching fpcw-directory's proven shape and
DECISION-113's rulings exactly. A new `events.manage` permission (tier 1, no
default role binding) gates a full CRUD admin surface at `/o/[slug]/admin/
events` — create a single event, create a repeating series (N discrete rows
sharing `parent_event_id`, generated with fpcw's ported recurrence math),
edit one occurrence, extend a series' pattern going forward, and cancel an
occurrence (`cancelled_at`, never a delete). This closes the schema-first gap
`src/lib/db/domain/index.ts` has carried since Phase 0 and unblocks the
children's-ministry check-in pipeline, which depends on exactly the six
frozen columns (`id`, `organization_id`, `starts_at`, `ends_at`,
`cancelled_at`, `allows_checkin`) and no others.

## Permissions & Flags

- **Permission key:** `events.manage` (module `events`, tier 1). Public
  visibility is the `is_public` data attribute, never a permission — matches
  Phase 1's framing.
- **Default role binding: none.** Applying DECISION-078's constitutional-duty
  test directly: no PC(USA) office is *the* constitutional keeper of the
  congregation's calendar — this is a staffing/operational convenience (an
  office administrator's or committee chair's task), the identical shape
  DECISION-110 found for `groups.manage` ("no PC(USA) office is the keeper of
  committee rosters"). `events.manage` follows that precedent exactly rather
  than being folded onto `stated_clerk`, which DECISION-101/106/110 have
  already flagged as accumulating permissions one individually-justified
  addition at a time — the drift those decisions exist to stop. Fixture-only
  grant in `scripts/seed-dev.sql` (to `stated_clerk`, as `groups.manage`'s own
  fixture comment already does) for test reachability, explicitly commented
  as a convenience, not a recommended production default. No production
  role-seeding surface exists yet for tenant-scoped permissions (same
  standing gap `directory.view_hidden`/`org_features.manage`/`groups.manage`
  already carry — not this pipeline's to close).
- **Feature flag: none for the core feature**, per DECISION-113 — no
  `sites.public_events`-style gate is needed until Increment 4. **One new
  flag is still required by an orthogonal, pre-existing convention**: every
  `PORTAL_TILES` entry in `src/lib/org-portal/tiles.ts` carries a mandatory
  `flagKey` (the interface has no optional variant) as the tile-visibility
  rollout lever — the same mechanism `org_portal.groups`/`org_portal.officers`
  already use for their own flag-less core features. A new global
  `org_portal.events` flag (seeded off, checked bare — a routing/rollout
  toggle, not an auth path) gates only whether the "Events" tile renders on
  the portal hub; it grants nothing and is orthogonal to `events.manage`,
  same composition rule DECISION-097 already established for the third
  gating axis. This is not a violation of DECISION-113's "no flag this
  increment" — that ruling was about a feature-existence gate, not the
  standing tile-registry convention every other admin surface already opts
  into.

## API Contract

New module `src/lib/events.ts`, same shape as `src/lib/groups.ts`/`src/lib/
officers.ts`: one `withOrgContext()` transaction per export, a private
`hasEventsManage(tx, personId, organizationId)` gate checked first in every
export, typed `EventsResult<T>` result union instead of thrown exceptions for
every expected/denied outcome (mirroring `GroupsResult`/`OfficersResult`).

```ts
export type EventsResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "invalid_target" }
  | { kind: "invalid_input"; message: string };

export interface EventListEntry {
  eventId: string;
  title: string;
  startsAt: string;   // ISO, wall-clock (no tz)
  endsAt: string | null;
  isPublic: boolean;
  allowsCheckin: boolean;
  cancelledAt: string | null;
  isRecurringSeries: boolean; // recurrencePattern is non-null on this row
  isSeriesOccurrence: boolean; // parentEventId is non-null
}

export interface EventDetail extends EventListEntry {
  description: string | null;
  location: string | null;
  parentEventId: string | null;
  recurrencePattern: string | null; // only ever set on the series' first row
  recurrenceCount: number | null;
  /** Other rows sharing this event's own id-or-parent series, if any. */
  seriesOccurrences: Array<{
    eventId: string;
    startsAt: string;
    cancelledAt: string | null;
  }>;
}

// listEvents — admin list, all occurrences (including cancelled and past),
// ordered by startsAt ascending. Cancelled rows are included and visually
// marked, never filtered out — this is the admin surface, not the public one
// (DECISION-113's public-visibility ruling governs Increment 4's separate
// query, not this one).
export async function listEvents(
  viewerPersonId: string,
  organizationId: string,
): Promise<EventsResult<EventListEntry[]>>;

// getEvent — one occurrence's full detail, plus its series siblings (if it
// is a parent or a child) for the "part of a series" UI affordance.
export async function getEvent(
  viewerPersonId: string,
  organizationId: string,
  eventId: string,
): Promise<EventsResult<EventDetail>>;

export interface CreateEventInput {
  title: string;
  description?: string;
  location?: string;
  /** 'YYYY-MM-DDTHH:mm', wall-clock. */
  startsAt: string;
  endsAt?: string;
  isPublic: boolean;
  allowsCheckin: boolean;
  /** Present only when creating a repeating series. */
  recurrence?: { pattern: string; count: number };
}

// createEvent — inserts one row. When `input.recurrence` is present, inserts
// the first occurrence, then generates `count - 1` further discrete rows via
// the ported recurrence math (see Data Model note below), each carrying
// `parentEventId` = the first row's own id and `organizationId` copied from
// the SAME just-inserted parent inside the SAME transaction — the same-org
// property is structurally guaranteed by construction on create, never a
// separate check. `recurrencePattern`/`recurrenceCount` are stored ONLY on
// the first (parent) row, never on the generated children — matching fpcw's
// own `isParentEvent`/`isChildEvent` shape. `count` is bounds-checked
// (1–52 inclusive — see Edge Cases) before any insert.
export async function createEvent(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: CreateEventInput,
): Promise<EventsResult<{ eventId: string; occurrenceIds: string[] }>>;

export interface UpdateEventInput {
  eventId: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: string;
  endsAt?: string;
  isPublic: boolean;
  allowsCheckin: boolean;
}

// updateEvent — edits ONE occurrence's own fields (whether standalone, a
// parent, or a child row). NEVER touches recurrencePattern/recurrenceCount
// and NEVER affects sibling rows — that is updateSeriesPattern's job.
// invalid_target if cancelled_at is already set (a cancelled occurrence is
// not editable — Edge Cases).
export async function updateEvent(
  viewerPersonId: string,
  organizationId: string,
  input: UpdateEventInput,
): Promise<EventsResult<{ eventId: string }>>;

export interface ExtendSeriesInput {
  /** Must be the SERIES PARENT's own id (recurrencePattern non-null,
   *  parentEventId null) — invalid_target otherwise, closing the same-org/
   *  same-series guard the architect named as needing an explicit app-level
   *  check. */
  parentEventId: string;
  /** Replaces the parent's stored pattern going forward; the already-
   *  materialized rows are never re-read against it. */
  pattern: string;
  /** How many ADDITIONAL occurrences to generate beyond the series' current
   *  last occurrence — never a replacement count (see Edge Cases: this is
   *  the concrete shape of DECISION-113's "extend/regenerate the horizon,
   *  never rewrite a materialized row"). */
  additionalCount: number;
}

// extendSeriesPattern — DECISION-113's "pattern edits extend/regenerate the
// horizon only" made concrete: loads the parent row scoped to (id,
// organizationId, recurrencePattern is not null, parentEventId is null) —
// invalid_target otherwise (the explicit same-org/same-series guard the
// architect flagged as needing an app-level check, since parentEventId
// carries no DB FK — see Data Model). Finds the series' current LATEST
// occurrence (max(startsAt) across parentEventId = this parent's id, or the
// parent's own startsAt if it has no children yet), then generates
// `additionalCount` further discrete rows forward from that date using
// `pattern` (bounds-checked against the same 52-occurrence cap, counted
// against the SERIES TOTAL, not just this call — Edge Cases). Updates the
// parent's own `recurrencePattern`/`recurrenceCount` to the new values.
// Every existing row — parent or child — is left completely untouched.
export async function extendSeriesPattern(
  viewerPersonId: string,
  organizationId: string,
  input: ExtendSeriesInput,
): Promise<EventsResult<{ occurrenceIds: string[] }>>;

// cancelEvent — sets cancelled_at = now() on ONE occurrence. Never a delete,
// never cascades to siblings (cancelling a series parent does not cancel its
// children — an explicit v1 non-goal, named in Edge Cases). invalid_target
// if already cancelled (idempotent no-op, not an error, mirroring
// `endGroupMembership`'s "already ended" posture — but here returning `ok`
// again rather than invalid_input, since re-cancelling an already-cancelled
// row is not a user mistake worth surfacing as one).
export async function cancelEvent(
  viewerPersonId: string,
  organizationId: string,
  eventId: string,
): Promise<EventsResult<{ eventId: string }>>;
```

**Same-org parent guard, stated once:** `parentEventId` carries no database
foreign key at all (see Data Model), so every write path that consumes it
re-validates ownership inside the SAME `withOrgContext()` transaction before
using it — `createEvent`'s generated children copy `organizationId` from the
just-inserted parent (guaranteed by construction, not a separate check), and
`extendSeriesPattern` re-loads the parent scoped to `(id, organizationId)`
before generating anything (`invalid_target` otherwise). No other export
accepts a caller-supplied `parentEventId`.

**Recurrence math ported directly from `~/git/fpcw-directory/src/lib/events/
recurrence.ts`** — `parsePattern`, `getNextOccurrence`, `generateRecurringDates`,
`PATTERN_LABELS`/`SIMPLE_PATTERNS`/`ORDINALS`/`DAYS_OF_WEEK` port verbatim (pure
`Date` math, no dependency) into a new `src/lib/events/recurrence.ts` (mirrors
the source file's own module boundary — kept out of `src/lib/events.ts` itself
so the pure-function pattern math stays independently unit-testable, same
split `officers.ts`/`db/domain/officers.ts` already model for logic vs. schema).
`generateRecurringDates(startDate, pattern, count)` is the function
`createEvent`/`extendSeriesPattern` both call. `isRecurringEvent`/
`isParentEvent`/`isChildEvent` port too — they back `EventListEntry`'s
`isRecurringSeries`/`isSeriesOccurrence` derivation.

`src/app/(org)/o/[slug]/admin/events/actions.ts` mirrors `admin/groups/
actions.ts` exactly: `resolveActingIdentity(slug)` re-resolves org membership
from the session on every call (never trusts client-supplied `organizationId`),
`createEventAction`/`updateEventAction`/`extendSeriesPatternAction`/
`cancelEventAction` each call the matching `src/lib/events.ts` export, map
`EventsResult` kinds to user copy, and `revalidatePath()` the list + detail
routes. **No audit event on any of these four** — DECISION-113 ruling 5,
matching the `replaceOrganizationServiceTimes`/`setOrganizationProfile`
precedent (content configuration, not an identity/access/security-control
mutation).

## Data Model

New file `src/lib/db/domain/events.ts`, same house shape as `officers.ts`/
`groups.ts` (composite unique key, `foreignKey()` blocks, `check()` where
needed):

```ts
export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    location: text("location"),
    // Wall-clock local time, no tz (DECISION-113 ruling 3) — matches
    // organizationServiceTimes' existing time-of-day columns in spirit.
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at"),
    isPublic: boolean("is_public").notNull().default(true),
    // The FROZEN check-in contract column (DECISION-113 ruling 4). Adopted
    // name over fpcw's `is_drop_off` — generic beyond children's ministry.
    // Children's-ministry Increment C's FK must be the composite
    // (event_id, organization_id) against events_id_org_key below.
    allowsCheckin: boolean("allows_checkin").notNull().default(false),
    // The one legitimate timestamptz column (an instant, not a schedule
    // fact) — DECISION-113 ruling 3's own carve-out.
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    // Self-referential, standard Drizzle explicit-return-type idiom to break
    // TS circularity (`(): AnyPgColumn => events.id`). Deliberately NOT a
    // composite (id, organizationId) self-FK — architect's Phase 2 ruling
    // that a self-referencing composite FK is not expressible here without
    // circularity, the same class as groups' own derived-check. The same-org
    // property is enforced entirely at the application layer (see API
    // Contract's "Same-org parent guard") — an accepted, narrow deviation
    // from Composite Tenant Keys, same class as
    // groupMemberships.officerTermId (DECISION-060), flagged here rather
    // than silently accepted.
    parentEventId: uuid("parent_event_id").references(
      (): AnyPgColumn => events.id,
    ),
    // Convenience generation string only (e.g. "weekly", "2nd Tuesday") —
    // NEVER parsed at read time (DECISION-113 ruling 1). Set ONLY on a
    // series' first (parent) row; null on every generated child and on every
    // standalone event.
    recurrencePattern: text("recurrence_pattern"),
    // The count last used to generate this series — read back by
    // extendSeriesPattern to compute the series-total bounds check (Edge
    // Cases). Null on a standalone event or a generated child.
    recurrenceCount: integer("recurrence_count"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Leading with organizationId per every tenant table's own convention
    // and Phase 2's explicit note. Serves the admin list's own ordering.
    index("events_org_starts_idx").on(t.organizationId, t.startsAt),
    // Serves "load every occurrence in this series" (getEvent's sibling
    // list, extendSeriesPattern's latest-occurrence lookup).
    index("events_org_parent_idx").on(t.organizationId, t.parentEventId),
    unique("events_id_org_key").on(t.id, t.organizationId),
  ],
);
```

**FORCE RLS**, standard tenant policy, following `drizzle/0026_presby_org_
feature_toggles.sql`'s exact hand-written single-table shape (`0009`'s
loop-generated array is frozen to its original table list — every table added
since gets its own migration block, same as `0026`/`0020`):

```sql
alter table events enable row level security;
alter table events force  row level security;
drop policy if exists tenant_isolation on events;
create policy tenant_isolation on events
  using (organization_id = presby_current_org())
  with check (organization_id = presby_current_org());

grant select, insert, update, delete on events to presby_app, presby_platform;
```

**Permission-catalog seed row** (global, no `organization_id` per
DECISION-063 — seeded in the migration itself, parallel to `drizzle/
0029_presby_officers_permission.sql`/`0033_presby_groups_administration.sql`):

```sql
insert into permissions (key, module, description, sensitivity_tier)
values ('events.manage', 'events',
        'Create, edit, and cancel calendar events, including repeating series',
        1)
on conflict (key) do nothing;
```

**Migration filename: `drizzle/0035_presby_events.sql`.** `0034_presby_
directory_permission_copy.sql` is the current highest, both applied and in
`drizzle/meta/_journal.json`; `0035` is the next free number as of this
read. **Collision risk flagged for the orchestrator:** `git status` shows
three other in-flight, uncommitted work-logs from today
(`2026-08-26-childrens-ministry.md`, `2026-08-26-presbytery-functionality.md`,
plus this one) whose Phase 2s (DECISION-111, DECISION-112) are already
resolved — meaning their own database-admin implementers may be claiming a
migration number concurrently, right now, in a different session. Neither of
those two work-logs names a migration filename as of this read, so `0035` is
not yet claimed elsewhere by direct evidence — but the orchestrator must
verify `ls drizzle/` immediately before this design's implementer actually
writes the file, not trust this number as reserved. Whichever pipeline lands
its migration file first should keep `0035`; the other renumbers before
running `db:push`/committing.

## Component / Page Plan

**Pages to create** (mirrors `admin/groups/` exactly):
- `src/app/(org)/o/[slug]/admin/events/page.tsx` — Server Component list via
  `listEvents()`; `events.manage` gate checked (redirect/404 style, same as
  `admin/groups/page.tsx`) before rendering; empty state when zero events.
- `src/app/(org)/o/[slug]/admin/events/new/page.tsx` — renders
  `NewEventForm`.
- `src/app/(org)/o/[slug]/admin/events/[eventId]/page.tsx` — detail via
  `getEvent()`: fields, series-siblings list (if any), Edit/Cancel/Extend
  Series affordances.
- `src/app/(org)/o/[slug]/admin/events/[eventId]/edit/page.tsx` — renders
  `EditEventForm`; 404s (`invalid_target`) if the event is cancelled.

**Components to create:**
- `events-list.tsx` — presentational list (title, date/time, visibility
  badge, cancelled badge), mirrors `groups-list.tsx`.
- `events-states.tsx` — empty/forbidden/error states, mirrors
  `groups-states.tsx`.
- `event-schema.ts` — zod: `createEventSchema` (title/description/location/
  startsAt/endsAt/isPublic/allowsCheckin + optional `recurrence`),
  `editEventSchema` (same minus recurrence), `extendSeriesSchema`
  (pattern + additionalCount) — same single-file-per-surface shape as
  `group-schema.ts`.
- `new-event-form.tsx` — client island (RHF + zod, matching `docs/ui-
  standards.md`'s >4-field threshold): fields + a "repeats" toggle that
  reveals pattern/count inputs.
- `edit-event-form.tsx` — client island, single-occurrence fields only, no
  recurrence controls (disabled/hidden entirely — recurrence editing is
  `extend-series-form.tsx`'s job).
- `extend-series-form.tsx` — client island, rendered only on a parent event's
  detail page (`recurrencePattern` non-null, `parentEventId` null): pattern +
  additional-count inputs.
- `cancel-event-dialog.tsx` — shadcn `AlertDialog` confirm (no native
  `confirm()`), same as `end-group-membership-dialog.tsx`'s shape.

**Files to modify:**
- `src/lib/db/domain/index.ts` — add `export * from "./events";`; amend the
  header comment (currently: "Ledger, giving, events, worship, and check-in
  are deliberately absent pending their own requirements pass") to remove
  `events` from that list and note this pipeline is the requirements pass
  that closed it — ledger/giving/worship/check-in remain deferred.
- `src/lib/org-portal/tiles.ts` — add an `events` tile: `category: "operate"`
  (DECISION-113 ruling 7, DECISION-105's routine-work test), `flagKey:
  "org_portal.events"`, `href: (slug) => \`/o/${slug}/admin/events\``.
- `scripts/seed.ts` — add the `org_portal.events` flag block, seeded off,
  same "ships dark until the page lands" comment shape as every sibling
  `org_portal.*` entry.
- `scripts/seed-dev.sql` — fixture grant of `events.manage` to `stated_clerk`,
  commented as a test-reachability convenience only (matching
  `groups.manage`'s own fixture comment), not a production default.

## Implementation Order

1. Schema: `src/lib/db/domain/events.ts`, barrel export, `drizzle/
   0035_presby_events.sql` (table + FORCE RLS + grants + `events.manage`
   permission-catalog row) → `npm run db:push` on a dev branch, then
   `scripts/test-rls.sql` extended with an events isolation case.
2. `org_portal.events` flag seeded off in `scripts/seed.ts`; `scripts/
   seed-dev.sql` fixture grant to `stated_clerk`.
3. `src/lib/events/recurrence.ts` (ported pure functions, unit-tested
   standalone) → `src/lib/events.ts` (list/get/create/update/
   extendSeriesPattern/cancel).
4. `src/app/(org)/o/[slug]/admin/events/actions.ts` (server actions, error
   mapping, `revalidatePath`).
5. UI: pages, list/detail/form components, `tiles.ts` entry.
6. No audit events — confirmed not required (DECISION-113 ruling 5).
7. Release notes entry (member-visible: a congregation can now put dated
   events on a calendar — Rule 13 applies) + `docs/product/
   functionality-map.md` update (Rule 14) + `docs/TODO.md` reconciliation
   (Rule 10) at Phase 6.

## Edge Cases & Risks

- **Recurrence generation bound — a genuinely new call this pass, logged to
  `docs/decisions.md`:** max 52 occurrences per series, enforced as a
  SERIES-TOTAL cap (not per-call) — `createEvent`'s `recurrence.count` and
  `extendSeriesPattern`'s `existingCount + additionalCount` are both checked
  against it, `invalid_input` naming the limit otherwise. Chosen as "about a
  year of weekly events," the single most common real pattern (choir
  rehearsal, a Sunday-adjacent recurring meeting), cheap enough to over-shoot
  slightly without real cost, and small enough that a fat-fingered "repeat
  ×5000" can never happen.
- **End-before-start:** `endsAt`, when supplied, must be `>= startsAt` —
  checked server-side before insert/update, `invalid_input` naming the rule
  (same posture as `startOfficerTerm`'s deacon/org_unit check).
- **Editing a parent's pattern vs. a single occurrence — the load-bearing
  distinction Phase 1 flagged as Gap 1:** `updateEvent` never touches
  `recurrencePattern`/`recurrenceCount`, and `extendSeriesPattern` never
  touches any existing row's own fields — two disjoint write paths, not one
  function branching on event shape. A materialized occurrence a check-in
  might already reference can never move under it (DECISION-113's own
  language, now enforced structurally by the API split, not by convention).
- **Cancelled-row visibility, admin vs. (future) public:** the admin list
  and detail INCLUDE cancelled rows, visibly marked — an admin needs to see
  what they cancelled. This increment builds no public projection at all;
  Increment 4's `presby_published_site()` widening is the one place
  `cancelled_at`/`is_public` filtering actually matters for a leak, per
  DECISION-113 ruling 6, and is explicitly out of scope here.
- **Cancelling a series parent does not cascade-cancel its children** — an
  explicit v1 non-goal (confirm with user at Phase 6 if this reads as
  surprising in practice; the alternative requires a batch-cancel UI this
  increment doesn't build). A cancelled parent's still-open children remain
  independently cancellable one at a time.
- **A cancelled occurrence is not editable** through `updateEvent`
  (`invalid_target`) — un-cancelling is not a v1 operation; the only path
  back is creating a new event.
- **Server-side length limits from day one** (Phase 1's Adversarial Pass,
  named as a gap that shipped client-only once already): `title` ≤ 200
  chars, `description` ≤ 2000, `location` ≤ 200 — enforced in `src/lib/
  events.ts`, not just `event-schema.ts`'s zod shapes.
- **Enumeration:** admin event URLs (`/admin/events/[eventId]`) rely on
  ordinary `(org)` + RLS scoping — `getEvent` returns `invalid_target` for
  an id from another org or a nonexistent one, indistinguishable, same
  posture `getGroup`/`getOfficerHistory` already take.
- **360px:** the new/edit forms' recurrence toggle and the series-siblings
  list on the detail page both need to stack cleanly at 360px — verified in
  a real mobile-viewport browser per CLAUDE.md → Verify in a Browser, not
  inferred from `next build`.
- **e2e blast radius (existing specs this change could break):** none
  identified — `events` is a wholly new table and route tree with no
  existing consumer. The one adjacent surface to re-check at Phase 5:
  `src/lib/org-portal/tiles.ts`'s own `tiles.test.ts`, which pins a hard-coded
  snapshot of every `flagKey` against `scripts/seed.ts` — adding
  `org_portal.events` to both files together is required or that test fails,
  not a new gap it introduces.

## Implementer

**Split: database-admin (Increment 1 — schema, migration, permission-catalog
row, RLS regression test) then full-stack-developer (Increment 2 — `src/
lib/events/recurrence.ts` + `src/lib/events.ts` + the admin route tree),
same two-commit shape `groups-admin`'s Phase 4 already used** (commit 1
database-admin, commit 2 full-stack-developer) rather than the
api-developer/ux-developer three-way split: Increment 2 is small enough and
tightly coupled enough (the recurrence math, the result-union API, and the
five-page admin tree all reference each other directly, same as `groups.ts`
↔ `admin/groups/`) that splitting server and client into separate commits
would add handoff overhead without a corresponding quality gain — the
session's own precedent for this exact shape of work (groups, officers) used
the same split and it held up through QA both times.

---

# Phase 4 — Implementation

## Phase 4 commit 1 (database-admin) — schema

**Date:** 2026-08-27

### Migration renumbering

Phase 3 penciled `drizzle/0035_presby_events.sql`. A fresh `ls drizzle/`
immediately before writing found `0035_presby_children_ministry_permission.sql`
already on disk (that pipeline's own concurrent Phase 4 commit). Re-checked
after that and confirmed `0036` is the actual next free number. Claimed and
authored as **`drizzle/0036_presby_events.sql`** from the start (not written
as 0035 and renamed), with the header documenting the renumbering per
`0032_presby_role_definitions.sql`'s own precedent for this exact
CLAUDE.md-named collision case. Journal entry `idx: 36, tag:
"0036_presby_events"` appended to `drizzle/meta/_journal.json` by hand.

### Files Created

- `src/lib/db/domain/events.ts` — the `events` pgTable: DECISION-113's frozen
  six columns (`id`, `organizationId`, `startsAt` timestamp-no-tz, `endsAt`
  nullable no-tz, `cancelledAt` timestamptz nullable, `allowsCheckin` boolean
  not-null default false) plus `title`/`description`/`location`/`isPublic`/
  `createdBy`/`parentEventId`/`recurrencePattern`/`recurrenceCount`/
  timestamps; `unique(id, organizationId)`; indexes leading with
  `organizationId` (`events_org_starts_idx`, `events_org_parent_idx`) per
  Phase 3's index spec. `parentEventId` is a plain (non-composite)
  self-referential FK per DECISION-115 ruling 3 — same-org enforcement is the
  application layer's job (full-stack-developer's commit), flagged in the
  column comment, not silently accepted.
- `drizzle/0036_presby_events.sql` — hand-written migration: `CREATE TABLE IF
  NOT EXISTS events`, its two indexes, `ENABLE`/`FORCE ROW LEVEL SECURITY`,
  the standard `tenant_isolation` policy (template: `drizzle/
  0026_presby_org_feature_toggles.sql`), grants to `presby_app`/
  `presby_platform`, and the `events.manage` permission-catalog row (tier 1,
  module `events`, `on conflict (key) do nothing`) following `0029`/`0033`'s
  pattern.

### Files Modified

- `src/lib/db/domain/index.ts` — added `export * from "./events";` and
  amended the header comment to remove `events` from the "deliberately
  absent" list, per Phase 2's placement ruling and Phase 3's Files-to-Modify
  note.
- `scripts/test-rls.sql` — new **section 27** (the file's last section was
  26 as of a fresh check before editing): proves the `events.manage`
  permission row exists, an unset GUC hides all `events` rows, an event
  inserted at Alder Creek is invisible at Bramblewood via both a blanket
  SELECT and a known-id read, Bramblewood cannot plant a row into Alder
  Creek's `organization_id` (the `WITH CHECK` half), `FORCE ROW LEVEL
  SECURITY` is set, and the `presby_app` grant is the full
  select/insert/update/delete set. No fixture rows needed — every insert runs
  inside its own rolled-back transaction, same discipline as section 19.
- `drizzle/meta/_journal.json` — appended the `idx: 36` entry by hand
  (`db:generate` is broken on a pre-existing snapshot collision per
  CLAUDE.md, so every migration past 0012 is hand-authored and the journal is
  hand-maintained to match).

### Schema Changes

- New table `events` (see above). No changes to any existing table.
- **Applied via hand-written SQL through `psql "$MIGRATE_DATABASE_URL" -f
  drizzle/0036_presby_events.sql`** against the live dev database (not
  `db:push`) — consistent with CLAUDE.md's note that `db:generate` has been
  broken since a pre-0012 snapshot collision and every migration since is
  hand-authored, idempotent SQL applied directly. `npm run db:push` was not
  run afterward: it is interactive/prompt-driven against a shared dev branch
  currently carrying other pipelines' own concurrent, uncommitted schema
  work, and running it risked surfacing unrelated drift or a destructive
  prompt outside this commit's scope. `npm run typecheck` passing (clean)
  confirms `src/lib/db/domain/events.ts`'s Drizzle types compile correctly
  against the schema as authored.
- Regression proof: `scripts/test-rls.sql` section 27 run standalone against
  `APP_DATABASE_URL` (as `presby_app`, never the owner) — all 9 assertions
  passed live. The full suite run end-to-end currently halts earlier, at the
  pre-existing section 3 assertion `presbytery: sees only its own member`
  (expected 1, got 2) — a fixture-count drift from a concurrent sibling
  pipeline's own seed data landing in the same shared dev database
  (unrelated to `events`; not this commit's scope to fix). Flagged for the
  orchestrator/QA rather than silently worked around.

### Audit Events

- None. `events.manage` mutations are NOT Rule-7 audited per DECISION-113
  ruling 5 (content configuration, matching the
  `replaceOrganizationServiceTimes`/`setOrganizationProfile` precedent) — no
  audit surface exists in this commit's scope regardless (`audit.ts` is
  commit 2's, untouched here).

### Implementer Notes

- No role binding and no fixture grant added in this commit — Phase 3's Data
  Model section places the `stated_clerk` fixture grant in
  `scripts/seed-dev.sql`, which is explicitly full-stack-developer's (commit
  2) file to touch, not this one's. `events.manage` therefore exists in the
  permission catalog but is granted to nobody until commit 2 lands.
- Touched no application code: `src/lib/events.ts`, the admin UI tree,
  `scripts/seed.ts`, `src/lib/org-portal/tiles.ts`, and `audit.ts` are all
  untouched, per this commit's explicit scope boundary.
- `db:push` was not exercised as an apply mechanism (see Schema Changes); if
  a later reviewer wants a Drizzle-Kit-native confirmation of the schema
  diff, run it against a disposable Neon branch, not this shared dev branch,
  given the concurrent-pipeline drift noted above.

**Handoff:** full-stack-developer (Phase 4 commit 2) — `src/lib/events/
recurrence.ts`, `src/lib/events.ts`, `src/app/(org)/o/[slug]/admin/events/`,
`org-portal/tiles.ts`'s `events` entry + `org_portal.events` flag in
`scripts/seed.ts`, and the `scripts/seed-dev.sql` `stated_clerk` fixture
grant, per Phase 3's design. New table available: `events` (import from
`src/lib/db/domain` barrel). Local apply: the migration is already live on
the shared dev database above; a fresh clone/branch should run `npm run
db:push` (or replay `drizzle/0036_presby_events.sql` directly) plus `npm run
db:seed` once the `org_portal.events` flag block lands.

## Phase 4 commit 2 (full-stack-developer) — recurrence math, domain module, admin UI

**Date:** 2026-08-27

### Files Created

- `src/lib/events/recurrence.ts` — fpcw-directory's recurrence math ported
  near-verbatim (`parsePattern`/`getNextOccurrence`/`generateRecurringDates`/
  `formatPattern`/`buildDayOfWeekPattern`/`isRecurringEvent`/`isParentEvent`/
  `isChildEvent`, `PATTERN_LABELS`/`SIMPLE_PATTERNS`/`ORDINALS`/
  `DAYS_OF_WEEK`), plus a new `MAX_SERIES_TOTAL = 52` constant and
  `seriesTotalWithinCap(totalCount)` pure helper (DECISION-115) that
  `src/lib/events.ts` calls from both `createEvent` and
  `extendSeriesPattern`. No `server-only` guard — deliberately safe to import
  from client forms (`new-event-form.tsx`/`extend-series-form.tsx` both do,
  for the pattern-builder `<select>`s).
- `src/lib/events/recurrence.test.ts` — 29 unit tests: pattern parsing,
  simple/day-of-week `getNextOccurrence` (including the documented JS
  `Date.setMonth()` month-end rollover and December→January year wrap),
  `generateRecurringDates` boundary behavior including a full 52-occurrence
  run, and the 52-cap at both a creation-shaped count and an
  extension-shaped `existingCount + additionalCount`.
- `src/lib/events.ts` — the domain module per Phase 3's API contract:
  `listEvents`/`getEvent`/`createEvent`/`updateEvent`/
  `extendSeriesPattern`/`cancelEvent`, each `withOrgContext()`-scoped with
  `hasEventsManage` (via `presby_has_permission`) checked first. Wall-clock
  `startsAt`/`endsAt` are read/written through `parseWallClock`/
  `formatWallClock` helpers using LOCAL `Date` getters/setters throughout —
  never `.toISOString()`, which would apply a UTC conversion the value has
  no zone to justify (DECISION-113 ruling 3); `cancelledAt` is the one
  legitimate `timestamptz` and does use `.toISOString()`. Server-side length
  limits (title ≤200, description ≤2000, location ≤200) and the
  end-before-start check are enforced independently of the UI's zod shapes.
  `createEvent` never accepts a caller-supplied `parentEventId` (children
  copy `organizationId` from the just-inserted parent by construction);
  `extendSeriesPattern` re-loads its `parentEventId` scoped to `(id,
  organizationId, recurrencePattern is not null, parentEventId is null)`
  before generating anything.
- `src/lib/events.test.ts` — 28 Postgres-backed integration tests (real dev
  DB, `hasDb` skip-guard, dynamic imports in `beforeAll`, the mandatory
  trigger-disable teardown wrap — every fixture `memberships` insert fires
  `presby_sync_derived_membership_group()`, materializing a derived "Active
  Membership" `group_memberships` row that must be disabled before the
  teardown `delete(organizations)`, same discipline
  `groups.test.ts`/`children.test.ts`/`officers.test.ts` already document).
  Covers: the permission gate (forbidden + nothing written), single-event
  creation, series creation (parent/child field split, the 52-cap at
  creation, an invalid-pattern rejection), cross-org `invalid_target` for
  `getEvent`/`extendSeriesPattern` (using a SECOND holder granted
  `events.manage` at org B, so the assertion exercises a genuine cross-org
  miss rather than an unrelated `OrgAccessError`), `updateEvent`'s
  cancelled-row guard and its independence from
  `recurrencePattern`/`recurrenceCount`, `extendSeriesPattern`'s
  parent-vs-child/parent-vs-standalone guards and the 52-cap counted against
  the SERIES TOTAL (existing 50 + additional 3 rejected, nothing written),
  and `cancelEvent`'s idempotent no-cascade-to-children behavior.
- `src/app/(org)/o/[slug]/admin/events/actions.ts` — `createEventAction`/
  `updateEventAction`/`extendSeriesPatternAction`/`cancelEventAction`,
  mirroring `admin/groups/actions.ts`'s `resolveActingIdentity()` shape. **No
  `recordAudit()` call in this file** — DECISION-113 ruling 5.
- `src/app/(org)/o/[slug]/admin/events/{events-states,events-list,
  event-schema}.tsx|ts` (+ `.test`) — `EventsFlagOff`/`EventsForbidden`/
  `EventsLoadError`; the admin list table (cancelled rows visibly marked via
  `Badge`, never filtered out); the zod shapes (`createEventSchema`'s
  `superRefine` handles end-before-start and the repeat-toggle's
  pattern/count requirements; `editEventSchema` carries no recurrence
  fields; `extendSeriesSchema` deliberately does NOT itself enforce the
  52-cap, since the existing count is server-only — proven in
  `events.test.ts`, not client-side).
- `new-event-form.tsx`/`edit-event-form.tsx`/`extend-series-form.tsx`/
  `cancel-event-dialog.tsx` (+ `.test`) — RHF + zod client islands.
  `new-event-form.tsx` and `edit-event-form.tsx` both wire
  `useUnsavedChangesGuard`/`UnsavedChangesDialog` (the session's own
  established convention — `new-event-form.tsx` has no in-form Back/Cancel
  link, relying on the guard's document-level click interception, same
  shape `add-officer-term-form.tsx` uses; `edit-event-form.tsx` has an
  explicit Cancel button wired to `guardedNavigate`, same shape
  `edit-person-form.tsx` uses, and never resets on a failed save).
  `ExtendSeriesForm` renders only on a series parent's detail page and
  pre-fills the CURRENT pattern's own ordinal/day (a real bug caught by its
  own test — see Divergences below). `CancelEventDialog` is an `AlertDialog`
  naming the event, never `confirm()`.
- Pages: `page.tsx` (list + "New event"), `new/page.tsx`, `[eventId]/
  page.tsx` (detail + series-siblings table + conditional Edit/Cancel/Extend
  affordances), `[eventId]/edit/page.tsx` (404s on a cancelled event, not
  just hiding its own Edit link) — each with a `.test.tsx` mirroring
  `admin/groups/`'s exact orchestration-test style (flag-before-permission
  ordering, `OrgAccessError` re-thrown not swallowed, the four-way miss
  response, result-kind branches).

### Files Modified

- `src/lib/org-portal/tiles.ts` — added the `events` tile: `category:
  "operate"` (DECISION-113 ruling 7), `flagKey: "org_portal.events"`, `href:
  (slug) => /o/${slug}/admin/events`.
- `src/lib/org-portal/tiles.test.ts` — added `org_portal.events` to the
  seed-key snapshot, the mirrored-tile-list assertion, the
  operate/administer classification assertion, and a new
  flag-independence test.
- `scripts/seed.ts` — added the `org_portal.events` flag block (seeded
  off), same "ships dark until the page lands" comment shape as every
  sibling `org_portal.*` entry.
- `scripts/seed-dev.sql` — appended (before the trailing `commit;`, in the
  same seam the children's-ministry and presbytery-functionality pipelines'
  own concurrent Phase 4 commits landed at today) a fixture grant of
  `events.manage` to `stated_clerk` (`f0000000-…-0005`), commented as a
  test-reachability convenience only, matching `groups.manage`'s own
  fixture comment — explicitly NOT a recommended production default
  (DECISION-115 ruling 1). A concurrency note mirrors the sibling
  pipelines' own: if a merge conflict appears at this exact seam, keep all
  blocks — each is independently append-only.

### Endpoints / Action Signatures (auth + flag gates)

All four actions in `admin/events/actions.ts` re-resolve `organizationId`
server-side via `resolveActingIdentity(slug)` (never trust client input),
gate on `events.manage` inside `src/lib/events.ts` (never in the action
itself), and are reachable only when `org_portal.events` is on (checked
bare in every page, no `organization_feature_toggles` row):

- `createEventAction(slug, CreateEventInput): ActionResult<{ eventId }>`
- `updateEventAction(slug, UpdateEventInput): ActionResult<{ eventId }>`
- `extendSeriesPatternAction(slug, ExtendSeriesInput):
  ActionResult<{ occurrenceIds }>`
- `cancelEventAction(slug, eventId): ActionResult<{ eventId }>`

No new env var. No schema change in this commit (commit 1's `events` table
is used as-is).

### Divergences from Phase 3

- **A real bug caught by its own test, fixed before this handoff:**
  `ExtendSeriesForm`'s initial draft defaulted `ordinal`/`dayOfWeek` to a
  hardcoded `"1st"`/`"Monday"` regardless of the series' actual current
  pattern — a day-of-week series (e.g. "2nd Tuesday") would silently show
  the wrong pre-selection. Fixed by parsing `currentPattern` through the
  same `parsePattern()` the server uses (with the same explicit `as` cast
  `recurrence.ts`'s own `getNextOccurrence` already documents, since
  `parsePattern`'s return type isn't a TS-discriminable union). Caught by
  `extend-series-form.test.tsx`'s "collapses a day-of-week choice" case
  before this was ever run in a browser.
- **No `getEventFormOptions` export** — Phase 3's Component Plan didn't
  name one, and none is needed: unlike groups (a group-type catalog, a
  people list), the new/edit forms need no dynamic server data beyond the
  permission gate itself. `new/page.tsx` calls `listEvents()` purely to
  derive that gate (discarding its data), the same "derive `canCreate` from
  an already-gated read" reasoning `admin/groups/new/page.tsx` uses for
  `getGroupFormOptions`.
- **`check:brand-scope`'s C2 rule** flagged two hand-rolled
  `rounded-full`+padding `<span>` badges in `events-list.tsx` as
  button-shaped primitives outside `src/components/ui/`; replaced with the
  existing generated `<Badge>` component (`variant="secondary"`/
  `"destructive"`) rather than annotating `// ui-ok:` — a real primitive
  existed for this, so using it was the correct fix, not a suppression.

### Audit Events

None. Per DECISION-113 ruling 5 — confirmed, not merely inherited: no
`recordAudit()` call anywhere in `admin/events/actions.ts`, and
`check:audit`'s tripwire passes (it does not even fire on this file, since
the mutations live in `src/lib/events.ts`, not a direct `db.insert/update/
delete` in the actions file itself).

### Implementer Notes

- Live-verified against the shared dev database (see Live Verification
  below) — both the `dev_admin` role's `events.manage` grant and the
  `org_portal.events` flag were flipped live, matching the
  children's-ministry pipeline's exact precedent (not via
  `scripts/seed-dev.sql`, which is local-fixture-only).
- `npm run typecheck` / `npm run lint` / `npm run build` / `npm run check`
  (all four tripwires) all clean.
- `npm test` (mocked suite): 204 files / 2717 passed, 0 failed, 479 skipped
  (skip count includes every DB-backed suite, `events.test.ts` among them,
  since `DATABASE_URL` is unset in that run).
- DB-backed suite: `npx dotenv -e .env.local -- vitest run
  src/lib/events.test.ts src/lib/events/recurrence.test.ts` — 57/57 passed
  against the real dev Postgres (28 events.ts + 29 recurrence.ts).

## Live Verification (real dev server + real dev database)

Session: `/tmp/state.json` (fpcw org, `dev_admin` role holder) — same
precedent the children's-ministry/presbytery-functionality pipelines used
today. Two grants made directly against the shared dev database (not via
`scripts/seed-dev.sql`, which is local-fixture-only):

1. `insert into app_role_permissions (role_id, permission_key) values
   ('ef8c79c2-9c93-43ec-87c7-a446df8d017b', 'events.manage')` — the
   `dev_admin` role scoped to fpcw.
2. `insert into feature_flags (key, description, enabled) values
   ('org_portal.events', …, true) on conflict (key) do update set enabled =
   true`.

Both left in place after verification (not reverted), same posture as the
existing grants already on that role.

Verified via Playwright driving a real Chromium session against
`localhost:3000` (a server already running on that port from a concurrent
session) at desktop (1280×900) and mobile (390×844):

- `/o/fpcw/admin/events` — list renders, "New event" button present.
- Created a single, non-repeating event ("Verify Single Event") — redirects
  to its own detail page, correct title/time/visibility.
- Created a weekly series of 4 ("Verify Weekly Series") — parent detail
  page shows "Part of a series" (3 siblings) and "Extend this series";
  clicked into a child occurrence, edited its title, confirmed the edit
  persisted and the parent's own `recurrencePattern`/`recurrenceCount` were
  untouched.
- Cancelled the single event via `CancelEventDialog` — confirmed (after a
  fresh navigation, not just the immediate post-toast render, which lags
  behind `router.refresh()`'s async re-fetch, the same class of timing gap
  `add-officer-term-form.tsx`'s own comment already documents) that the
  Edit/Cancel affordances disappear and the event reads "Cancelled."
  `cancelEvent`'s no-cascade guarantee was independently confirmed: the
  series' still-open children stayed "Scheduled" throughout.
- Final list view: cancelled row marked with a red "Cancelled" badge,
  series rows marked "Series," visibility column present at desktop and
  correctly hidden (not broken) at 390px.
- No console or page errors during the entire walkthrough.
- Mobile (390px): list and the "New event" form (including the expanded
  repeat-pattern block) both stack cleanly with no horizontal overflow or
  clipped controls.
- Test data created during verification (`events.title LIKE 'Verify %'`,
  5 rows) deleted afterward via the owner connection — pure verification
  noise, not a permission/flag grant this precedent leaves in place.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-27
**Verified by:** qa

## Type Check / Unit Tests / Build / Tripwires

`npm run typecheck` PASS. `npm test`: 2717 passed, 0 failed, 479 skipped (documented DB-suite deferral, not silent — QA ran those suites separately). DB-backed events/recurrence suites reproduced live: **57/57** (28 integration + 29 recurrence unit). `npm run build` PASS, all four events routes present. `npm run check`: all four tripwires clean.

## Frozen Contract (DECISION-113)

All six columns confirmed byte-for-byte in BOTH `src/lib/db/domain/events.ts` and `drizzle/0036_presby_events.sql`: `id`, `organization_id`, `starts_at` (timestamp, no tz), `ends_at` (nullable, no tz), `cancelled_at` (timestamptz, nullable), `allows_checkin` (boolean not null default false) — plus `unique(id, organization_id)` (`events_id_org_key`), the composite pair the children's-ministry FK must reference.

## Isolation

`scripts/test-rls.sql` section 27 re-extracted and re-run standalone as `presby_app`: all 8 assertions pass live (catalog row, unset-GUC invisibility, own-org read, cross-org blanket + known-id invisibility, cross-org INSERT rejected via WITH CHECK, `relforcerowsecurity`, full grant set). (Commit 1 reported "9/9" vs QA's reproduced 8 distinct passes — a count discrepancy, not a failure.) FORCE RLS + the standard tenant policy confirmed in the migration text.

## Recurrence & Cap

`seriesTotalWithinCap()` is one pure check applied identically at `createEvent` and `extendSeriesPattern`; the extension path persists the new cumulative `recurrenceCount` on the parent, which the next call reads back — repeated small extensions provably cannot walk past the 52 cap (concrete 50+3-rejected test). Pattern-edit-extends-never-rewrites holds structurally: `updateEvent` and `extendSeriesPattern` write disjoint column sets on disjoint row scopes; no code path UPDATEs an existing child's `starts_at` from a pattern change. Month-boundary/Nth-weekday/"last"-ordinal/year-wrap cases covered by the 29 recurrence tests.

## Same-Org Parent Guard

Present both ways: `createEvent` never accepts a caller-supplied `parentEventId` (children copy the parent's `organizationId` inside the same transaction); `extendSeriesPattern` re-loads its parent scoped to `(id, organizationId, pattern-not-null, parent-null)`, `invalid_target` otherwise. Verified by direct read.

## Audit

No events keys in `AUDIT_ACTIONS`, no `recordAudit()` anywhere in the events tree — matches DECISION-113 ruling 5. `check:audit` passes.

## Cancel Semantics

`listEvents` retains cancelled rows; the list renders a destructive "Cancelled" badge, never hides. No public-facing query exists this increment (Increment 4 out of scope), so no leak surface yet.

## Regression Tests Added

- `extend-series-form.test.tsx:66` — locks the ExtendSeriesForm pattern-parsing fix (the hardcoded-ordinal bug caught mid-Phase-4). Caveat, honestly noted: the fail-before state is asserted by the implementer's account — no commit history exists yet to bisect — but the code/test content is internally consistent with the claim.
- `recurrence.test.ts` — the cap at both call shapes; `events.test.ts` — cross-org `invalid_target` with a second permission-holder at another org (a genuine cross-org miss, not incidental), cancelled-row update guard, idempotent no-cascade cancel.

## Feature-Gate Audit

Every page and action gates on `events.manage` via the module's own `hasEventsManage` (gate-then-read, delegated never duplicated); `org_portal.events` is checked bare and separately, never substituting for the permission (DECISION-003). The tenant mechanism is `presby_has_permission()` via `withOrgContext()` — the same pattern as groups/officers, not a weaker substitute.

## Verdict

**PASS**

**Handoff:** analyst (Phase 6).

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> Increments 1–2 deliver exactly what Phase 1/2/3 promised — a flat, composite-keyed, FORCE-RLS'd `events` table with the frozen six-column check-in contract intact byte-for-byte, and an admin CRUD surface a church-staff volunteer can actually use without training — but the pipeline's own housekeeping (release notes, functionality map, TODO) fell behind the code and needs closing before this counts as delivered.

## What's Working

- **Create-single vs create-series is genuinely discoverable.** `new-event-form.tsx`'s "This event repeats" checkbox reveals the pattern/count block inline (`src/app/(org)/o/[slug]/admin/events/new-event-form.tsx:203-305`) — a staffer doesn't need to know the word "recurrence" to find it, and it follows the same conditional-reveal pattern `add-officer-term-form.tsx` already established, so it's consistent with the rest of the admin shell.
- **Cancel-vs-edit is unambiguous.** The detail page hides both Edit and Cancel once `cancelledAt` is set (`[eventId]/page.tsx:137-152`) — there is no state where a staffer can attempt to edit a cancelled event and get a confusing error; the affordance itself disappears.
- **"Extend series" reads honestly to a non-technical user.** The literal on-page copy — "Adds occurrences going forward — the events already on the calendar are never moved or rewritten" (`[eventId]/page.tsx:199-202`) — states the exact guarantee DECISION-113 rules on, in plain English, not schema language. This is the single highest-risk UX spot (a staffer could reasonably expect "extend" to also fix a mistake in past occurrences) and it's pre-empted directly.
- **The frozen six-column check-in contract shipped unmolested.** QA independently confirmed byte-for-byte match against DECISION-113. This is the part of the pipeline that actually unblocks a second team, and it held.
- **The `is_public` checkbox is the right shape for Increment 4's arrival.** Nothing in the admin UI or schema needs rework when the public-calendar consumer lands: `is_public` already exists as a data attribute (not a permission, per Phase 1's own framing), and DECISION-113 ruling 6 already commits `presby_published_site()` to filtering it inside the SQL function's own WHERE clause — the admin form doesn't need to change shape, only a new consumer needs to start reading a column that's already there.

## Intent-vs-Shipped Diff

- Phase 1 said: give presby an events model serving four consumers without building three of them, and unblock children's-ministry check-in via a frozen contract. **Shipped:** exactly that — schema + admin CRUD only, Increment 3 (children's-ministry re-run) and Increment 4 (public rendering) untouched by this pipeline, contract frozen and verified. **Verdict: matches.**
- Phase 1 flagged the recurrence retro-edit rule as Gap #1 ("underspecified"). **Shipped:** resolved structurally, not just by convention — `updateEvent` and `extendSeriesPattern` are disjoint write paths on disjoint column/row scopes, so a materialized occurrence literally cannot move under a pattern edit. **Verdict: matches, and more rigorously than Phase 1 asked for.**
- Phase 1 named the recurrence-generation bound as an open risk with no number attached. **Shipped:** a 52-occurrence series-total cap, closed by a new decision (DECISION-115) rather than silently assumed. **Verdict: matches — this is exactly what Phase 1 asked Phase 2/3 to rule on.**
- Phase 1's Adversarial Pass demanded server-side length limits "from the start... this gap shipped client-only once already." **Shipped:** length limits enforced in `src/lib/events.ts` independent of the zod shapes, confirmed by QA. **Verdict: matches.**
- One minor honest observation, not a gap: the new-event form's "Visible on the public calendar" checkbox currently has zero visible effect anywhere in the product, since Increment 4 (the only consumer of `is_public`) doesn't exist yet. This isn't a defect — the field is inert-but-correctly-shaped ahead of its consumer, the same posture `sites.public_render` took before any site was provisioned — but a staffer checking it today gets no calendar to point to. Worth a one-line note in the Increment 4 kickoff, not a blocker now.

## Edge Cases

- Empty state: **pass** — `events-states.tsx` supplies flag-off/forbidden/error states; QA and live verification both confirmed the zero-event list state (not explicitly walked in my own pass, but covered by Phase 4's own `.test.tsx` and QA's feature-gate audit).
- Failure microcopy: **pass** — `EventsLoadError`/`invalid_target`→404 pattern matches the `groups`/`officers` precedent; no stack traces exposed; enumeration posture (cross-org `invalid_target` indistinguishable from nonexistent) verified by QA's integration tests.
- Permission gate: **pass** — `events.manage` checked server-side inside `src/lib/events.ts` before any read/write, `org_portal.events` flag checked separately and never substituting for it (DECISION-003 composition confirmed by QA).
- Audit event: **not applicable** — DECISION-113 ruling 5 explicitly rules event create/cancel is content configuration, not Rule-7 security-sensitive; QA confirmed no `recordAudit()` calls and `check:audit` passes. The reasoning (matching `organization_service_times`/`setOrganizationProfile` precedent) is sound.
- Mobile (360px): **pass** — live Playwright verification at 390px confirmed the list, "New event" form (including the expanded repeat block), and visibility column stack cleanly with no clipped controls.

## Follow-Ups (SHIP WITH NOTES)

1. **Release notes are incomplete relative to their own table of contents.** `docs/release-notes/v0.18.md`'s ToC row promises "an events calendar" but the body has no `### Feature: Events calendar` section. Needs a section covering: the new admin events surface, `events.manage` permission, `org_portal.events` flag (seeded off — the surface isn't live for any congregation yet), and the new routes under `/o/<slug>/admin/events`. (The presbytery-credentials and portal-support sections are also missing from this file, but that's the other pipeline's Phase 6 to close.)
2. **`docs/product/functionality-map.md` line 22 is now factually wrong.** It still lists "events" under "presby: NOT built". Remove `events` from that line and add a proper bullet — "presby: events calendar (admin)" — noting Increments 3/4 (children's-ministry check-in, public rendering) remain unbuilt, per Rule 14.
3. **`docs/TODO.md` line 46 needs updating, and there is no Done line for this pipeline at all.** Line 46 still reads "BLOCKED on the events model... Phase 4 in flight" — needs to say Increments 1–2 shipped 2026-08-27 and children's-ministry Increment C can now re-run its Phase 1 against the frozen six-column contract. Separately, per Rule 10, add a `[x]` Done line for `2026-08-26-events-model.md` to the Done section.
4. **What's-new: correctly deferred, confirmed.** `org_portal.events` is seeded off and no `whats_new_entries` row exists — consistent with Rule 13. No action until the flag flips on for a real congregation.
5. **Rule 12 (feedback row): not applicable.** This pipeline originated from an operator split of the children's-ministry pipeline, not an in-app feedback row.
6. **Increments 3–5 are properly tracked, no gap found.** TODO.md's children's-ministry Increment C line (corrected per #3) and the work-log's own Phase 3 scope note both name Increment 4 as a separate future pass and Increment 5 (RSVP/worship/groups) as out of scope. Nothing is silently dropped.

**Handoff:** none — Increments 1–2 close here. The orchestrator applies follow-ups 1–3 at commit time (Rules 10 and 14). Children's-ministry Increment C is the next pipeline to move — re-run its Phase 1 against the now-shipped frozen `events` contract.
