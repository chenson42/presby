# Hide members-only events from visitors — Work Log

> **Slug:** `2026-11-02-members-only-events`
> **Surface:** (org) member calendar (`/o/<slug>/calendar`, the event page, the `/o/<slug>` "Coming up" card), and any other member-side event read
> **Permission(s):** existing `events.view`; no new key
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated Feature (tech-lead, Phase 3; no migration, so 0085 is not used). Promotes to a full Feature if the operator chooses database enforcement (Q2).
> **Numbers (pre-assigned):** F418; DECISION-316; migration 0085 if needed; port 3630; Neon `pipeline-members-only-events` (`br-wispy-heart-axabgzsj`)
> **Source:** Community 3a live walk, N1 (`docs/work-log/2026-10-22-founding-admin-directory-inc3.md`, "Phase 6 addendum — live walk"). Operator ruling 2026-11-02: **"hide them from visitors"**.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Brief: the behaviour and the operator's ruling are below; the tech-lead may ask for a full Phase 1 if the scope is wider than it looks | Ruled by operator | 2026-11-02 |
| 2 — Architectural review | architect | Skipped with notation: no migration, schema, definer, route, action, dependency or structural change (see Phase 3, Classification). Reopens if the operator asks for the database to enforce it (Q2). | Skipped | 2026-11-02 |
| 3 — Technical design | tech-lead | Design complete; Accelerated Feature; implementer named; one operator question (Q1) with a recommended default | Complete | 2026-11-02 |
| 4 — Implementation | TBD | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

## Phase 1 (brief, orchestrator, from the analyst's N1 and the operator's ruling)

**What happens today.**
- An event with "Open to everyone, not only members" unticked (`is_public = false`) appears on a connected visitor's member calendar, in their `/o/<slug>` "Coming up" card, and on its event page, tagged "Members only".
- `calendar.ts` records that `is_public` is not a member filter (operator ruling 4). Visitors held `events.view` before 0066 too; 0066 made "everyone with a current record sees the calendar" explicit, through the Calendar viewer role.
- "Copy month" already leaves members-only events out ("Calendar copied (1 members-only event left out)").
- The help page `events-and-the-calendar` says an unticked event "shows only on the member calendar, for members who have calendar access", which a reader takes to exclude visitors.

**Operator ruling (2026-11-02).** Hide members-only events from **visitors**.

**Scope note from the orchestrator.** The ruling names visitors. People marked inactive or moved away (also without member standing) are not named. The tech-lead should state what the design does for them and why, and raise it rather than widen the scope silently.

**User verbs.**
- A connected **visitor** opens the calendar, the "Coming up" card or a direct event link. They never see a members-only event; a direct link answers the same way a missing event does, without saying it exists.
- A **member** (member standing) sees what they see today.
- An **administrator** creating an event sees the "Open to everyone, not only members" label and help that say who sees an unticked event.

**Help impact.** `events-and-the-calendar` (the member-calendar sentence; also the N2 phone sentence while there, already a TODO line). Possibly the event form's label copy.

**Edge cases to settle in Phase 3.**
- A recurring series.
- An event that changes from public to members-only while a visitor has its page open.
- The event's RSVP or sign-up surfaces, if any exist today.
- The public website (unchanged: it shows only website-listed events).
- The `/o/<slug>` home card count.
- A person who is both a visitor here and a member elsewhere (per-organization standing).
- A platform admin with no membership.

## Phase 3 — Technical Design (tech-lead, 2026-11-02)

### Classification and Phase 2

**Accelerated Feature. Phase 2 skipped: no new deps or structural change.** The change is one private predicate in `src/lib/calendar.ts`, three strings, one help page, tests. It adds no migration, schema change, `SECURITY DEFINER` function, route, server action or dependency, and touches none of `src/auth.ts`, `src/proxy.ts`, `src/lib/authz.ts`, the permission catalog or a flag seed. Migration 0085 is not used (release it back to the pool). It promotes to a full Feature, with the architect, only if the operator answers Q2 "enforce it in the database" or a QA FAIL traces to a design claim below.

**Correction to the Phase 1 brief.** It says a members-only event appears on the member calendar "tagged 'Members only'". It does not: `e2e/member-calendar.spec.ts:155` and `[eventId]/page.test.tsx:206` pin that the member calendar and the event page render no such tag. Only the administrator's events list and event page say "Members only" (`visibilityLabel`). Nothing is added to the member side.

### Summary

An event with "Open to everyone, not only members" unticked (`is_public = false`) is shown only to people with member standing at that congregation, and to anyone who can manage events. Everyone else with calendar access (a visitor, a person marked Inactive or Moved away) gets a calendar, a "Coming up" card and counts that contain no such event, and a direct link answers exactly as a missing event does. One change: the private visibility predicate that every member-side read of `events` already shares (`MEMBER_VISIBLE` in `src/lib/calendar.ts`) takes the viewer's standing, which the gate reads in the statement it already runs. `is_public` stops being "not a member filter" (operator ruling 4 amended; DECISION-316 draft below).

### 1. Where the filter lives: decided

**TypeScript reader, one SQL predicate, standing asked of the existing classifier. Not RLS, not a new definer.**

Every read path of `events`, enumerated against the live tree (grep of `from events`, `.from(events)`, `join events`, and the migrations):

| Path | File | Today | Filter? |
|---|---|---|---|
| Calendar month: entries, `inMonthCount`, `unfilteredInMonthCount`, `orgHasEvents` (four queries) | `src/lib/calendar.ts` `getMonthCalendar` | `MEMBER_VISIBLE` | **Yes, all four** |
| Event page (`/calendar/<id>`) | `calendar.ts` `getMemberEvent` | `MEMBER_VISIBLE` | **Yes** |
| "Coming up" card on `/o/<slug>` | `calendar.ts` `listUpcomingMemberEvents` | `MEMBER_VISIBLE` | **Yes** |
| Month list view and grid | `month-list.tsx`, `month-grid.tsx` | render `getMonthCalendar`'s entries | covered (no query) |
| Copy month | `calendar/page.tsx:141` builds the clipboard from `data.entries` | already drops `isPublic = false` | covered; the "(N members-only events left out)" toast now counts only what the viewer was given, so a visitor is never told one exists (test T9) |
| Admin events list, edit pages, create, cancel, series extend | `src/lib/events.ts` (ten `.from(events)`) | gated by `events.manage` (`hasEventsManage`) | **No, deliberately**: a manager must see what they manage |
| Event-type usage count | `src/lib/event-types.ts:184` | `event_types.manage` gate, a count of rows, no content | No (manager surface, no titles) |
| Public website calendar | `presby_public_events_calendar()` (0067), anonymous definer | `website_listed and is_public and cancelled_at is null` | already excludes members-only; untouched |
| ICS, webcal, RSS, feeds | none exist (`grep -rniE "text/calendar\|webcal\|\.ics"` over `src/app` finds nothing) | | n/a |
| Search | no org-wide search reads `events` | | n/a |
| RSVP or sign-up | none exist in application code (the one grep hit is help-registry text) | | n/a |
| Children's check-in (`allows_checkin`) | no reader under `(org)`; Increment 3 unbuilt | | n/a; the future reader inherits the rule through the scan in section 7 |

A visitor-side reader other than `calendar.ts` does not exist today. A new one would be a leak, so the design adds a tripwire (a source scan, T1), the same pattern as `membership-standing.source.test.ts`.

**Why not the database.** The project's stance is that tenancy is a database property. This is not tenancy: it is authorization inside one tenant ("RLS enforces tenancy, not authorization", CLAUDE.md Key Invariants), the same class as the Directory's `= 'listed'` predicate and the `cancelled_at` filter, both of which live in the TypeScript readers over the shared classifier. RLS on `events` for `presby_app` would need the viewer's person id in the session, and `withOrgContext()` sets only `app.current_org_id`. A second GUC means editing `src/lib/authz.ts` (the highest-blast-radius file, an excluded line for the accelerated route and for this design), changing the policy every writer and every `SECURITY DEFINER` reader of `events` (0067) runs under, and answering what a manager who is a visitor may select to edit. The cost is large and the gain is covering a second reader that does not exist. A definer would add a function that returns the same rows the readers can already query. **Tradeoff named: a future `events` reader that forgets the predicate leaks; the source scan makes that a failing test, not a review.** Revisit if a second member-side reader of `events` appears.

**Standing is cheap to reach.** One live `memberships` row exists per (person, org) (`memberships_person_org_key`), RLS already scopes it to the org, and `presby_membership_is_member_standing(current_roll, engagement_status)` (0066, `immutable`, granted to `presby_app`) is the one definition. No new SQL object.

**The predicate (shape, not a mandate on names).**

```ts
// in openMemberGate, the ONE existing statement gains a third column:
//   exists (select 1 from memberships m
//            where m.organization_id = $org::uuid and m.person_id = $person::uuid
//              and m.ended_on is null
//              and presby_membership_is_member_standing(m.current_roll, m.engagement_status)) as is_member
// GateOutcome "open" gains: seesMembersOnly = canManage || row.is_member === true   (a missing row is false)

function memberVisible(seesMembersOnly: boolean): SQL {
  return seesMembersOnly
    ? sql`e.cancelled_at is null`
    : sql`e.cancelled_at is null and e.is_public`;
}
```

`MEMBER_VISIBLE` as a constant is deleted. Every `${MEMBER_VISIBLE}` interpolation (five today, `calendar.ts:352, 387, 403, 482, 564`: month rows, filtered count, org-has-events, detail, upcoming) becomes `${memberVisible(gate.seesMembersOnly)}`. Because the argument is required, a query that forgets it does not compile. No bound-parameter boolean in SQL (an inlined branch, not `or $n`).

### 2. Who is hidden from: decided, with one question

Recommended rule: **a members-only event is visible to a viewer who has member standing (listed, or staff anchor, the 0066 definition) at this congregation, or who holds `events.manage`. It is hidden from everyone else with calendar access.**

| Viewer | Sees members-only? | Why |
|---|---|---|
| Member (listed: a roll in the four, or Regular attender) | Yes | member standing; today's behaviour |
| Staff anchor (`engagement = staff`) | Yes | member standing by 0066 (they auto-connect, hold `directory.view`); a staff person must see Session and committee events |
| **Visitor** | **No** | the operator's ruling |
| Inactive, Moved away | **No (recommended; Q1)** | not named by the operator; see below |
| Unclassified (a roll or engagement outside the closed lists) | No | fails closed, as 0065 and 0066 do everywhere; unreachable for new data (`engagement_status` is `not null` with a CHECK), kept for the legacy-row case |
| Holds `events.view` through a person grant or any group | By standing only | `events.view` answers "may read the calendar", not "is a member". A grant never widens what standing decides |
| Holds `events.manage`, any standing | **Yes** | the manager reads every event in the admin list already (R8: the gate "reveals nothing `events.manage` cannot already read"); hiding the same row from the calendar they manage would be incoherent. A visitor holding `events.manage` is reachable only by an administrator granting it (a person-arm grant needs only a live membership) |
| No live membership row at this org | No | unreachable through `/o/<slug>` (`resolveOrgContext` returns forbidden or ended without a membership); fails closed in the predicate regardless |
| Platform admin | Same as any person | a platform admin with no membership never reaches an `(org)` page (Two Hierarchies Intersect Nowhere: the platform role confers nothing). One who accepted an invitation has a membership and is judged by its standing |
| Person who is a visitor here and a member elsewhere | By this congregation's standing | the membership read is keyed on (person, `organization_id`) |

**Q1 (operator): hide from visitors only, or from everyone without member standing?** The ruling names visitors. Hiding also from people marked **Inactive** and **Moved away** goes one step past it. Recommendation: **hide from all of them**, for three reasons: (1) "members only" means members, and the Directory, the Calendar viewer split and auto-connect already treat Inactive and Moved away as outside member standing (0066, DECISION-233); (2) the one classifier answers it in one call, while "visitors only" needs a second, special-cased test (`presby_membership_standing(...) = 'visitor'`) beside it and leaves unclassified viewers fail-open; (3) an administrator who sets someone to Moved away expects them out of members-only material. The cost: an Inactive person who still signs in loses events they saw yesterday (the Calendar viewer role is precisely their access, kept deliberately in 0066). **The build uses the recommended rule unless the operator says "visitors only"**; that answer changes one SQL line (`not presby_membership_standing(...) = 'visitor'` in place of the member-standing call), the form hint, the help sentence and the release note (variants in Copy). Nothing else moves.

**Q2 (operator, optional): is TypeScript-level enforcement acceptable?** See section 1. If the operator wants the database to enforce it, the pipeline becomes a full Feature (Phase 2, a person GUC in `authz.ts`, a policy change on `events`, migration 0085) and takes several times the work for the same behaviour today. Not recommended.

**Accepted residuals (stated so no string denies them).** (a) Standing is read from the cached `memberships.current_roll` and `engagement_status`, the same inputs as the Directory; a roll action dated in the future takes effect when the daily reconcile runs (F29), so a newly rolled member sees members-only events from then. (b) An administrator with `people.manage` can change a person's engagement, so they decide who counts (`tenant.person.engagement_changed` is the audit record); this is `paper` and is not prevented. (c) The hiding is of the calendar surfaces, not a secrecy guarantee: a member who shares a title in words can tell a visitor about it.

### 3. A visitor on a direct link

`getMemberEvent` returns `{ event: null }` for a members-only event the viewer may not see, which is the value it already returns for a missing id, another organization's id, a cancelled event and a non-UUID; `[eventId]/page.tsx` answers all with `notFound()` and the segment's `not-found.tsx`. Same SQL, same code path, same page, same status (404), one query that returns zero rows in each case. The gate still runs first. `not-found.tsx` is **not edited**: its text ("It may have been cancelled or removed, or the link may belong to a different organization...") does not say the event exists and is not changed per audience, because any variation would be the tell. Timing: both paths run one indexed read; no branch differs. Equal timing is not measured (unverified; the design adds no work to either path). Pinned by T3 and E3.

### 4. Component / Page Plan

- **Modify** `src/lib/calendar.ts`: `openMemberGate` (third column, `seesMembersOnly`), `GateOutcome`, `memberVisible()`, the five interpolations; update the header's "VISIBILITY (operator ruling 4)" paragraph to say `is_public` now decides who sees a members-only event (cancelled stays hidden from everyone).
- **Modify** `src/app/(org)/o/[slug]/admin/events/website-listing-copy.ts:34-36` (`openToEveryoneHint`), see Copy C1.
- **Modify** `src/content/help/events-and-the-calendar.md` (lines 1, 5 and 31; see Copy C3 to C5). **No registry change**: no label changes, `labels` already holds "Open to everyone, not only members", "Calendar viewer" and "All Current Records".
- **Modify** `src/lib/membership-standing.source.test.ts` (scan 2 gains "`calendar.ts` asks `presby_membership_is_member_standing` by name"), **create** `src/lib/calendar-visibility.source.test.ts` (T1).
- **Modify** `src/lib/calendar.test.ts` and `src/lib/testing/calendar-fixture.ts` (viewers with each standing), `e2e/visitor-access.spec.ts` (E1 to E3).
- **No new page, route, component, permission, flag, audit event.** A read is not audited (existing rule); the manager bypass and standing reads write nothing.
- **Housekeeping at ship, not by the implementer in Rule 16 files:** `docs/product/functionality-map.md:23` says "`is_public` means 'open to everyone who signs in' (not members-only)": stale, rewrite (Rule 14). `scripts/seed-dev.sql:1879` comment ("members still see it - is_public is only the public-site and Copy-month switch") is stale: the orchestrator edits it at integration (Rule 16). `docs/TODO.md:491` (the "members" wording pass for `events-and-the-calendar`) is closed by this pipeline (Copy C3, C4). `src/lib/calendar.ts` header and `website-listing-copy.ts` comment block lines 13-15 need no change beyond the above.

### 5. Implementation Order

1. `calendar.ts`: gate column, `memberVisible()`, five call sites; typecheck (an omitted argument fails to compile).
2. Tests T1 to T10 written first against the unchanged code (T2 to T8 must FAIL for the visitor cases), then green.
3. Copy C1 and the help page; walk `/help/events-and-the-calendar` and the calendar at 360 and 1280 (Rule 17) before writing sentences about Month and List.
4. E2E E1 to E3.
5. Release-notes lines (Copy C6) via `/release-notes`; Rule 14 map edit; TODO reconciliation (close line 491; add the Q-follow-ups if any).

### 6. Permissions, flags, audit, schema

- **Permissions:** none new. `events.view` and `events.manage` as today; `events.manage` now also means "sees members-only on the calendar". No `FEATURES` key, no `FEATURE_CATALOG` or seed change.
- **Flags:** none (operator: no new platform flags). Existing `org_portal.calendar` per-org toggle and `org_portal.events` platform flag unchanged.
- **Data model:** No schema changes required. No new CHECK, trigger or FK, so the feasibility check on `scripts/seed-dev.sql`, fixtures and composite keys has nothing to read. `presby_membership_is_member_standing(text, text)` is confirmed `grant execute ... to presby_app` (0066 section 10) and `immutable` with no definer, so it runs inside the RLS-scoped transaction; T2 proves it as `presby_app`.
- **Audit:** none (reads).

### 7. Tests

DB-backed tests run as `presby_app` through `withOrgContext` on the pipeline's Neon branch (`npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/calendar.test.ts`), under the existing three process time zones. No `scripts/test-rls.sql` change: no policy, grant or function changes, and that file is Rule 16 anyway. The "DB isolation as `presby_app`" property is T2: the classifier is callable by `presby_app` inside the org transaction (it fails otherwise).

| # | Test | Pins |
|---|---|---|
| T1 | `calendar-visibility.source.test.ts` (DB-free, with a deliberately offending sample): every `from events` statement in `calendar.ts` also interpolates `memberVisible(`; no `MEMBER_VISIBLE` constant remains; no non-test file under `src/` outside `calendar.ts`, `events.ts`, `event-types.ts` contains `from events`/`.from(events)`/`join events` (the allow-list names its reason per file) | a new reader cannot bypass the rule unnoticed |
| T2 | `calendar.test.ts` viewer matrix, each viewer one person with one membership, all holding `events.view` by the Calendar viewer path: regular+active, staff, visitor, inactive, moved_away: `getMonthCalendar` entries, `inMonthCount`, `unfilteredInMonthCount`, `orgHasEvents` (an org whose only event is members-only: `false` for a visitor, `true` for a member), `getMemberEvent`, `listUpcomingMemberEvents`. Visitor, inactive, moved_away see none of the members-only rows in any of the six outputs; regular and staff see them all | sections 1 and 2 |
| T3 | A visitor's `getMemberEvent` for a members-only id deep-equals the result for a random UUID, for a cancelled id and for a garbage id (`{ kind: "ok", data: { event: null, canManage: false } }`) | section 3 |
| T4 | A visitor holding `events.manage` (person grant) sees members-only in all three exports and `canManage` is true; a visitor with a non-manage custom role granting `events.view` does not | the manager bypass; a grant does not widen |
| T5 | Standing is per organization: a person who is a member at org A and a visitor at org B (second membership by the `seed-orgs.ts` mechanic 2, `app.person_claim_authorized`) sees members-only at A and not at B. If the mechanic cannot be reproduced in `calendar-fixture.ts`, the implementer records "unverified at DB level" here and keeps the predicate's `m.organization_id` conjunct covered by T1's text scan | section 2, last row |
| T6 | The home card for a visitor with 3 public and 2 members-only upcoming events returns 3 (the limit applies after the filter); `listUpcomingMemberEvents` for a visitor is a subset of the visitor's own calendar default set | home card count |
| T7 | A series with mixed visibility (occurrence 2 members-only by `updateEvent`): the visitor's month shows the public occurrences only; the upcoming feed, one row per series, shows the next **visible** occurrence and never the hidden one | recurring series |
| T8 | Flip: `updateEvent` sets a public event to members-only; the visitor's next `getMemberEvent` and `getMonthCalendar` omit it; the member's still return it | public to members-only |
| T9 | `calendar/page.test.tsx`: for a visitor-shaped result (no `isPublic: false` entries) the Copy month toast has no "members-only" clause; for a member-shaped result it still does | Copy month leak |
| T10 | `website-listing-copy` unit test for the new hint text, and `npm run check:help` | copy |
| E1 | `e2e/visitor-access.spec.ts`, both viewports (the spec already runs 1280 and **360px**): add three events to the spec's own invite org (public, members-only, cancelled; inline SQL beside the spec's existing inline role inserts; the org's cascade delete cleans them; titles `E2E ...`). Visitor: the calendar and `/o/<slug>` "Coming up" show the public title and not the members-only one; `noHorizontalOverflow` | visitor, calendar and card |
| E2 | Same spec, member control (the spec's regular member): calendar shows both titles | member sees today's behaviour |
| E3 | Visitor opens `/o/<slug>/calendar/<members-only id>` and `/o/<slug>/calendar/<random uuid>`: equal HTTP status (404) and equal `h1` text "We couldn't find that event"; the member opens the first and sees the title | direct link |

**E2E blast radius (existing specs).** `member-calendar.spec.ts` (viewers are `regular`, member standing; its members-only assertions at `:108` and `:231-238` stay true, so it must still pass unchanged); `portal-home-cards.spec.ts` and `home-cards-fixture.ts` (every fixture event is `is_public = true`, viewers regular: unchanged); `public-calendar.spec.ts` and `public-calendar.db.test.ts` (anonymous definer, untouched); `visitor-access.spec.ts` (its first test, a visitor opening an empty calendar, is unchanged; E1 to E3 are added beside it); `calendar.test.ts:389`, `:624`, `:698` (members see members-only: viewer `pView` is regular+active, unchanged) and `calendar/page.test.tsx`, `[eventId]/page.test.tsx`, `page.test.tsx` (they mock the lib; no change). **Flags each new spec depends on:** `org_portal.events` and `org_portal.directory` (global), both set by the spec itself through `captureFlags`/`setFlag` as it does today; the per-org `org_portal.calendar` toggle the spec writes with `setOrgToggle`. Nothing goes into `scripts/ci/e2e-baseline-flags.sql`. `org_portal.feature_categories` is left at its seeded value (off), so the worship-category check cannot disable the calendar.

### 8. Copy

Strings, with the four checks recorded per group.

**C1. Event form hint** (`openToEveryoneHint(orgName)`, shown on the new and the edit form):

> If unchecked, only members and staff of {orgName} see the event on the calendar. Visitors, and people marked Inactive or Moved away, do not. It also stays out of Copy month and cannot be shown on the website.

*Variant if Q1 answers "visitors only":* "If unchecked, only members of {orgName} see the event on the calendar. Visitors do not. It also stays out of Copy month and cannot be shown on the website."

**C2. Event form label** stays "Open to everyone, not only members" (`OPEN_TO_EVERYONE_LABEL`; the help registry quotes it, so no change; it already says what it means).

**C3. Help, opening paragraph** (closes TODO line 491, part 1):

> The calendar shows your congregation's events to everyone who has a current record and a connected sign-in, and keeps some events for members. Some events can also appear on your public website. This page covers reading the calendar, adding events, repeating events, event types, and what the public calendar needs.

**C4. Help, "The calendar every member sees"** (N2 and the members-only sentence). Heading unchanged. Replace "On a phone it shows a list of days. The links "Month" and "List" switch the view, and the arrows move between months." with:

> On a phone it shows a list of days. On a wider screen the links "Month" and "List" switch the view. On any screen the arrows move between months.

(the implementer confirms at 360px and 1280px that the arrows show on both and that "Month" and "List" show only on the wide one, from the screens, before keeping this sentence.) After "Your congregation's page also has a "Coming up" card with the next events." add:

> Events that are kept for members do not show to visitors, or to people marked "Inactive" or "Moved away".

**C5. Help, "Open to everyone, or members only"**, replacing the second sentence:

> "Open to everyone, not only members" is ticked at first. If you untick it, only members and staff see the event: on the calendar, in "Coming up" and on its own page. A visitor, or a person marked "Inactive" or "Moved away", does not see it, and a link to it shows the same "We couldn't find that event" page as an event that does not exist. People who can manage events always see it. Who counts as a member follows each person's record: changing a person's engagement on their record changes what they see. The event also stays out of "Copy month" and cannot be shown on the website.

**C6. Release-note lines** (via `/release-notes`; one entry):

> Events kept for members now stay hidden from visitors. When an event's "Open to everyone, not only members" box is unticked, only members and staff see it on the calendar, in "Coming up" and on its own page. Visitors, and people marked Inactive or Moved away, no longer do, and a link to it opens the same page as an event that does not exist. People who can manage events still see every event. The public website is unchanged. Who counts follows each person's record, so changing it changes what they see.

**The four checks.**

1. *Residuals.* None of C1 to C6 denies a residual of section 2: they say who sees the event "by their record", never that nothing can reach a visitor, and never that the effect is instant (the cached roll, residual (a), is not mentioned as immediate). C5's last-but-one sentence states residual (b) in its true direction (the record decides). C6 says "The public website is unchanged", which the 0067 definer's own filters back. No string says the event "is secret" or "cannot be found".
2. *Source of truth.* "Members and staff" = `presby_membership_is_member_standing(current_roll, engagement_status)` over the viewer's live membership at this congregation (listed, or staff anchor). "Visitors, Inactive, Moved away" = the other standings, the labels engagement-copy.ts uses (`Visitor`, `Inactive`, `Moved away`; `engagement-copy.ts:42-44`). "People who can manage events always see it" = `presby_has_permission(person, org, 'events.manage')`, read in the gate. "The same page as an event that does not exist" = `getMemberEvent` returning `event: null` for both. "Everyone who has a current record and a connected sign-in" = a live membership, an `events.view` grant through the Calendar viewer role, and a linked account (already stated at line 15 of the help page). A claim the queries do not read is not made: nothing says "members" are the Directory (a staff anchor is not in the Directory but has member standing, hence "members **and staff**").
3. *Audience.* C1 is read by a person with `events.manage` on the event form; it instructs nothing. C3 to C5 are read by the help's administrator audience (`audience: "administrator"`); C5 refers to changing a person's engagement, which needs `people.manage`: the sentence says only that the record decides and does not tell the reader to do it. C6 is read by operators and administrators. The not-found page, read by every viewer, is unchanged.
4. *Neighbours* (grep of `members only|members-only|Members only|member calendar|Member calendar|open to everyone` over `src/` and `docs/product`, with file and line):
   - **Made stale, modified here:** `website-listing-copy.ts:34-36` (C1: "for members of X who have calendar access" would now be read as including visitors); `events-and-the-calendar.md:1`, `:5` (the N2 sentence), `:31` (C3 to C5).
   - **Made stale, housekeeping at ship (not the implementer's):** `docs/product/functionality-map.md:23` ("`is_public` means 'open to everyone who signs in' (not members-only)"); `scripts/seed-dev.sql:1879` (comment; Rule 16, orchestrator at integration); the header paragraph of `calendar.ts:60-64` (modified by the implementer, section 4).
   - **Read and not made stale:** `org-features.ts:106` and `turning-features-on-and-off.md:35` ("to every member who has calendar access": already loose since 0.54.0 and not made false or less true here; left to the wording pass the 0.54.0 note queued); `public-events-calendar-slot.tsx:66` ("Church members: sign in to see the member calendar, which can include events not shown here": still true, and it speaks to members); `series-website-listing.tsx:46-50` and `clipboard.ts:140-151` ("members-only" counts, which only ever count what the viewer received); `visibilityLabel` ("Members only", admin surfaces only); `not-found.tsx` (deliberately unchanged, section 3).
   - **Accepted, indistinguishability over completeness.** For a visitor, "Nothing is scheduled for {month}." and the empty "Coming up" card can be true only of what they may see. The ruling is "hide them", and a different empty-state string for a visitor would announce what is hidden. Operator-ruled, not a defect.

### 9. Help impact

`events-and-the-calendar` edited (C3, C4, C5; no registry change, no label change, `verifiedIn` **not** moved: it waits for the analyst's live walk, TODO line 311, and moves only by walking it). The page's N2 phone sentence (the "Month" and "List" links are hidden below `md`, `calendar/page.tsx:240`) is fixed here because the same paragraph is being rewritten. `turning-features-on-and-off` is read and unchanged. `npm run check:help` must pass. No screenshot is added or changed (the existing `calendar-month` capture shows a member's list view; no members-only marker exists to capture).

### 10. Edge cases and risks

- **Recurring series:** each occurrence is its own row with its own `is_public`; a series can be mixed. The visitor sees the visible occurrences; the upcoming feed's `distinct on` runs over the visible rows, so it returns the next visible occurrence, keyed by the parent's id (the key is a uuid, not event content). T7.
- **Public to members-only while a visitor has the page open:** pages are server-rendered and nothing pushes; the open page stays until reload, and the reload answers not-found. No cache layer holds an event page (dynamic, session-bound). T8 covers the read; the open-tab behaviour is unverified in a browser.
- **A visitor becomes a member (or the reverse) mid-session:** standing is read per request, so the next page load changes; no session claim carries it.
- **Counts and empty states:** `unfilteredInMonthCount` and `orgHasEvents` use the same predicate, so a visitor in an org whose only events are members-only gets the "no events at all" state, not "filters hide everything". T2.
- **Performance:** one `exists` over a unique `(person_id, organization_id)` row added to a statement the gate already runs; no new round trip. `MONTH_ROW_LIMIT` (1500) applies after the filter.
- **Fail-closed:** a missing membership row, a null from the gate, or a classifier error yields `seesMembersOnly = false` (hide). A database error already surfaces as the page's load-error state.
- **Risk, a second reader:** see section 1; T1.
- **Risk, a person newly entered on the roll sees nothing members-only until the roll cache updates** (residual (a)); same lag as the Directory.
- **Out of scope (confirm with the operator):** a "Members only" marker on the member calendar; a different visitor-facing empty-state string; hiding the **Calendar** tile or the "Coming up" card from visitors who have nothing visible (tiles are permission-blind, DECISION-162, and the D14 follow-up covers the Directory tile); any change to the public website, `website_listed` or the 0067 definer; other event fields or admin screens; per-event audience lists beyond public and members-only; widening hiding to other resources (documents, groups) that may have the same "visitors see it" shape; changing `events.view`'s binding to the Calendar viewer role.

### 11. Carry-forward

| Phase 1 gap / ruling | Addressed here, or deferred |
|---|---|
| Operator ruling 2026-11-02: "hide them from visitors" | Sections 1 to 3. Scope note on Inactive and Moved away: **raised as Q1**, recommended default built unless overruled; not widened silently |
| Edge: a recurring series | Section 10, T7 |
| Edge: public to members-only while a page is open | Section 10, T8 (open-tab behaviour unverified) |
| Edge: RSVP or sign-up surfaces | None exist; section 1 table |
| Edge: the public website | Unchanged; section 1 table, `public-calendar.db.test.ts` remains the pin |
| Edge: the home card count | Section 7 T6 |
| Edge: visitor here, member elsewhere | Section 2 table, T5 (one test may be "unverified at DB level" per its own wording) |
| Edge: platform admin with no membership | Section 2 table: unreachable, fails closed |
| Help impact: `events-and-the-calendar`, the form label copy, N2 | Sections 8 and 9; label unchanged, hint changed (C1) |
| TODO line 491 (`events-and-the-calendar` "members" wording) | Closed here (C3) |
| Phase 2 | Skipped with notation (section "Classification") |
| Brief claim "tagged Members only" on the member side | Corrected above; no such tag exists |

### 12. DECISION-316 draft (for `docs/decisions.md`; the orchestrator lands it at integration, Rule 16)

> **DECISION-316: A members-only event is visible to member standing and to event managers; the read path asks the 0066 classifier (F418).** Amends operator ruling 4 of the member calendar (DECISION-160/161), which said `is_public` is not a member filter. Context: since 0066 a visitor or inactive person with a connected sign-in holds `events.view` through the Calendar viewer role, and an event with "Open to everyone, not only members" unticked appeared on their calendar, in "Coming up" and on its page (Community 3a live walk N1; operator ruling 2026-11-02: hide them from visitors). Decision: `calendar.ts`'s private visibility predicate takes `seesMembersOnly`, which `openMemberGate` computes in its existing statement as `events.manage` OR a live membership at this congregation for which `presby_membership_is_member_standing(current_roll, engagement_status)` holds; a viewer without it is shown only `is_public` events. A direct link answers as a missing event. The filter lives in the TypeScript reader, not RLS or a definer, because this is authorization inside a tenant (RLS enforces tenancy), RLS would need a person GUC in `authz.ts` and a policy change for every writer and definer, and `calendar.ts` is the only member-side reader of `events`; a source scan (`calendar-visibility.source.test.ts`) makes a second unfiltered reader a failing test. Scope: members, staff anchors and event managers see members-only events; visitors, Inactive and Moved away people (recommended, Q1) and unclassified do not. Residuals: standing is the cached roll and engagement (same lag as the Directory); an administrator with `people.manage` decides who counts (audited as `tenant.person.engagement_changed`, `paper`); hiding is of the calendar surfaces, not a secrecy guarantee. Revisit if a second member-side reader of `events` is added (then consider a definer-mediated read) or the operator asks for database enforcement. No migration; 0085 is released.

### Implementer

**full-stack-developer** (small and coupled: one server file, three strings, one help page, tests; no schema, no component work worth a split).

**Phase 5 scope (Accelerated):** run `calendar.test.ts` (serial, DB-backed, against the pipeline Neon branch, all three process zones), the two source-scan tests, the page unit tests, `npm run check` (all ten tripwires) and `npm run check:help`; run `e2e/visitor-access.spec.ts`, `member-calendar.spec.ts`, `portal-home-cards.spec.ts` and `public-calendar.spec.ts` on a server QA starts on port 3630 with `E2E_BASE_URL` set, at 1280 and 360px; one mutation check (delete the predicate from each of the five call sites in turn and confirm T2/T3/T6 fail each time, and that omitting the argument fails `tsc`); the copy-truthfulness check over C1 to C6 and the help diff (the four checks above, including that the page's Month/List/arrows sentence matches the 360px and 1280px screens); the 360px check of the visitor and member calendar and the event page (no horizontal overflow, no members-only title anywhere in the visitor's DOM, including `title`, `aria-label` and the page source). The Phase 6 reader reads `events-and-the-calendar` as an administrator against the shipped behaviour.

### Questions for the operator

- **Q1.** Hide members-only events from visitors only, or from everyone without member standing (visitors, Inactive, Moved away)? Recommended: everyone without member standing. Built that way unless you say "visitors only".
- **Q2 (optional).** Is a TypeScript-level filter plus a failing-test tripwire acceptable, rather than database enforcement (a full Feature with a person GUC, a policy change and migration 0085)? Recommended: yes.
