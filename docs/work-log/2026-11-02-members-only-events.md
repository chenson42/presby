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
| 4 — Implementation | full-stack-developer | Built to the design with the operator's Q1 and Q2 rulings; gates green; handoff to QA | Complete | 2026-11-02 |
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

## Operator rulings (2026-11-02), recorded at Phase 4

- **Q1 = VISITORS ONLY.** A members-only (`is_public = false`) event is hidden from a viewer whose standing at this congregation is `visitor`, and from nobody else. Members, staff anchors, Inactive, Moved away, unclassified and `events.manage` holders keep seeing it. This overrides the Phase 3 recommendation ("everyone without member standing"); the design's "visitors only" Copy variants (C1, C3 to C6) apply, with the C1 wording adjusted for truth (see Departures). DECISION-316's "Scope" sentence must be read with this ruling: members, staff, Inactive, Moved away, unclassified and managers see members-only events; visitors do not.
- **Q2 = accepted.** The filter lives in the TypeScript reader with the T1 source-scan tripwire (`calendar-visibility.source.test.ts`); no database enforcement. The tradeoff stands as written in Phase 3 section 1: a future member-side reader of `events` that forgets the predicate leaks, and the scan makes that a failing test. The Accelerated classification holds (no migration; 0085 is not used and goes back to the pool).

## Phase 4 — Implementation (full-stack-developer)

### Rulings applied

- **Q1:** the gate's one statement gained `exists (select 1 from memberships m where m.organization_id = <org> and m.person_id = <person> and m.ended_on is null and presby_membership_standing(m.current_roll, m.engagement_status) <> 'visitor') as has_non_visitor_standing`; `seesMembersOnly = canManage || has_non_visitor_standing`. It keys on the 0066/0065 classifier (`presby_membership_standing`), not on raw engagement text. A person with no live membership row at this org (unreachable through `/o/<slug>`) is hidden-from, i.e. fails closed, as the design says. `presby_membership_standing` is the classifier 0065 introduced (the design's `presby_membership_is_member_standing` is not used under Q1); it is a plain `immutable` SQL function with no definer (0065 11a), so it runs inside the RLS-scoped transaction; the DB tests run as `presby_app` and prove the call works there.
- **Q2:** TypeScript filter plus T1 tripwire; no RLS, definer or `authz.ts` change.

### Files created / modified

- `src/lib/calendar.ts`: `MEMBER_VISIBLE` deleted; `memberVisible(seesMembersOnly: boolean)` (required argument, no literal accepted by the scan); `openMemberGate` third column and `seesMembersOnly` on the `open` outcome; the five interpolations; header paragraph "VISIBILITY" rewritten. `getMemberEvent` returns `{ event: null }` for a hidden event, the value it already returns for a missing, foreign, cancelled and non-UUID id, so `[eventId]/page.tsx` answers with the same `notFound()`; `not-found.tsx` is unchanged.
- `src/app/(org)/o/[slug]/admin/events/website-listing-copy.ts`: `openToEveryoneHint` (C1) and its comment block.
- `src/content/help/events-and-the-calendar.md`: C3, C4 (including the N2 phone sentence), C5, visitors-only variants. No registry change; `verifiedIn` not moved.
- Tests: `src/lib/calendar.test.ts` (new describe "members-only events and standing", T2 to T8, three process time zones), `src/lib/testing/calendar-fixture.ts` (`MemberStanding`, `addMember` standing option, `addMemberElsewhere` via the claim GUC, `enroll` standing option), `src/lib/calendar-visibility.source.test.ts` (T1, new), `src/lib/membership-standing.source.test.ts` (scan 2 gains the calendar assertion), `src/app/(org)/o/[slug]/calendar/page-copy-left-out.test.tsx` (T9, new), `.../admin/events/website-listing-copy.test.ts` (T10, new), `new-event-form.test.tsx` and `edit-event-form.test.tsx` (hint string), `e2e/visitor-access.spec.ts` (E1 to E3, both viewports).
- No migration, schema change, route, action, permission, flag, audit event, env var or `FEATURES` entry. Nothing under Rule 16 was edited.

### Gates

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean (`--max-warnings=0`) |
| `npm run check` | all ten tripwires report passed (including `check:help`: 29 entries, 24 published) |
| `npm test` | 836 files passed, 140 skipped; 13226 tests passed, 3818 skipped (the DB-backed files skip without `.env.local`) |
| DB-backed, serial, as `presby_app` (`DATABASE_URL` role verified), pipeline Neon branch: `calendar.test.ts`, `event-types.test.ts`, `public-calendar.db.test.ts` | 3 files, 239 tests passed (the new matrix runs under UTC, America/New_York, Pacific/Honolulu) |
| Source scans: `calendar-visibility.source.test.ts` (5), `membership-standing.source.test.ts` (17) | pass |
| Calendar route and admin events unit tests | 34 files, 348 tests passed |
| e2e (own server on port 3630 from a scratch copy, flags reset with `e2e-reset-flags.sql -v pipeline_branch=1`, private `PLAYWRIGHT_BROWSERS_PATH`): `visitor-access.spec.ts` | 10 passed (5 tests at desktop and 360px) |
| e2e: `member-calendar.spec.ts` + `public-calendar.spec.ts` (unchanged) | 32 passed |
| 360px and 1280px, light and dark, visitor and member (calendar list and month, home, event page): throwaway spec in the scratch copy, screenshots read | no horizontal overflow; visitor DOM never contains the members-only title; member sees both; cancelled shown to neither |

Server stopped by PID; the scratch copy (with its `.env.local`) was deleted.

### Fail-first evidence

- **Unit/DB:** with `memberVisible` changed to ignore its argument (`void seesMembersOnly; return sql\`e.cancelled_at is null\``), the new describe ran 48 cases and **30 failed** (every visitor-hidden case: month, counts, page, feed, orgHasEvents, direct-link equality T3, manager-versus-role T4, per-organization standing T5, home-card limit T6, mixed series T7, public-to-members-only flip T8; the same ten in each of the three zones); the 18 "member sees it" cases passed, as they should. The predicate was restored and the full file passes (190 tests).
- **e2e:** with the same removal in the scratch copy, E1 (members-only title in the visitor's page content) and E3 (the direct link answered 200, not 404) failed; with it restored all 10 pass.
- T1 passes on the final source and has its own deliberately offending sample proving it can fail. The six-way mutation check (delete the predicate from each call site in turn) was not run per site; the single all-sites removal above and the compile-time required argument stand in for it. Phase 5 may run the per-site check.

### Departures from the design (all small; none change behaviour the design promised)

1. **C1 wording.** The design's visitors-only variant ("only members of {orgName} see the event ... Visitors do not") would be false under Q1: an Inactive or Moved away person, and a manager, also see it. Shipped: "If unchecked, visitors to {orgName} do not see the event on the calendar. Members, staff and everyone else who can see the calendar still do. It also stays out of Copy month and cannot be shown on the website." The same truth boundary drives C5 ("a visitor does not see the event ... Members, staff, people marked "Inactive" or "Moved away", and people who can manage events still see it"). The release-note line C6 must follow it: say "visitors", not "everyone without member standing".
2. **T7 and T8 mutate rows by SQL**, not through `updateEvent`: the same row state without importing the audit-writing action into a read-path test. The flip is restored in a `finally`.
3. **T5 is verified at DB level** (the claim-GUC mechanic is reproducible in `calendar-fixture.ts`): a person who is a member at one organization and a visitor at another sees the members-only event at the first and not at the second. No "unverified" note.
4. **T4's "non-manage role" viewer** holds `events.view` plus `directory.view` through a custom role; it does not see members-only events and has `canManage` false.
5. **T9** lives in a new file, `page-copy-left-out.test.tsx`, because stubbing `CopyMonthButton` to expose `leftOutCount` would have changed every test in the existing `page.test.tsx`.
6. **E1 and the "Coming up" card** need `org_portal.home_v2`; the spec now captures, sets and restores it beside the two flags it already managed. Nothing goes into `e2e-baseline-flags.sql`.
7. **`membership-standing.source.test.ts`** asserts the calendar's `<> 'visitor'` test, not the design's member-standing call (Q1).

### Help: written from the screens

At 360px and 1280px (screens read): the previous and next month arrows show on both; "Month" and "List" show only at 1280px (zero visible at 360px). C4's sentence ("On a wider screen the links "Month" and "List" switch the view. On any screen the arrows move between months.") matches. The 404 heading is "We couldn't find that event" (screen read). `npm run check:help` passes; no label or registry change, no screenshot added.

### Not done here (orchestrator / ship housekeeping)

- `docs/product/functionality-map.md:23` is stale ("`is_public` means 'open to everyone who signs in'"); Rule 14 at ship.
- **`scripts/seed-dev.sql:1879`** comment ("members still see it - is_public is only the public-site and Copy-month switch") is stale (Rule 16, the orchestrator edits it at integration): a visitor no longer sees a members-only event.
- `docs/TODO.md` line 491 (the "members" wording pass for `events-and-the-calendar`) is closed by C3 and C4; `docs/decisions.md` DECISION-316 needs the Q1 and Q2 rulings folded in (Rule 16, orchestrator). Release note (C6) per departure 1.
- `src/lib/org-features.ts:108` and `turning-features-on-and-off.md:35` ("every member who has calendar access") are read and unchanged, as the design says.

### For QA

- Run the DB suites serially against the pipeline branch (`npx dotenv -e .env.local -- vitest run --no-file-parallelism src/lib/calendar.test.ts src/lib/event-types.test.ts src/lib/public-calendar.db.test.ts`, about 4 minutes), `npm test`, `npm run check`, `npm run typecheck`, `npm run lint`.
- e2e on your own server on port 3630 with `E2E_BASE_URL` set: `visitor-access.spec.ts`, `member-calendar.spec.ts`, `public-calendar.spec.ts`, `portal-home-cards.spec.ts` (not run by me), at 1280 and 360px.
- Mutation check per call site (delete the predicate at each of the five interpolations in turn; confirm T2/T3/T6 fail each time) and that an omitted `memberVisible()` argument fails `tsc`.
- Copy truthfulness over C1, C3 to C5 as shipped (departure 1) and the help diff; confirm the Inactive and Moved away claims against the matrix rows ("Inactive and Moved away keep seeing members-only events").
- Open question for Phase 6: the DB matrix proves Inactive and Moved away still see members-only events; the shipped copy says so in C1 and C5. The open-tab behaviour after a flip is unverified in a browser, as designed.

---

## Phase 5 — Verification (qa), run 1

**Date:** 2026-11-02
**Verified by:** qa
**Commit:** `a29709e1` on `pipeline/members-only-events`. Neon `pipeline-members-only-events`: I confirmed `neon.branch_id = br-wispy-heart-axabgzsj` live. `DATABASE_URL` connects as `presby_app` and `PLATFORM_DATABASE_URL` as `neondb_owner`, both on endpoint `ep-fragrant-dream-ax3gyblf`. I checked each by role name and length only; no value was printed.

**Scope run (Accelerated):**
- **In full:** typecheck, lint, `npm run check` (all ten tripwires), and the unit suite in CI shape.
- **DB-backed, serial, as `presby_app`:** `calendar.test.ts`, `event-types.test.ts`, `public-calendar.db.test.ts`, plus the two source scans.
- **Mutation check:** each of the five call sites, one at a time.
- **T1:** fail-first.
- **e2e on my own dev server, port 3640:** the four named specs.
- **Production lane:** `test:e2e:prod` on port 3840.
- **Browser walk:** 360px and 1280px, light and dark, as a visitor, an Inactive person and a member, plus a manager on the form.
- **Not re-run:** the whole DB-backed set and the full chromium e2e suite. The diff touches no migration, `authz.ts`, `src/lib/db/`, shared fixture, proxy, auth, layout, `e2e/support/` or shared component, so the PR's CI covers those.

**Before e2e:** I reset global flags with `scripts/ci/e2e-reset-flags.sql -v pipeline_branch=1` (COMMIT, 10 rows). All runs were in scratch copies under my session scratchpad, outside `~/git/presby-platform/`, with hardlinked `node_modules`, a private `PLAYWRIGHT_BROWSERS_PATH`, `CRON_SECRET` and the `DOMAINS_*` fakes. I stopped the dev server by PID (75637 and its parent 75462). The production lane tore down its own server. Nothing is listening on 3640 or 3840, the scratch copies (with their `.env.local`) are deleted, and the worktree is clean.

## Type Check

- `npm run typecheck`: **PASS**.
- `npm run lint`: **PASS** (`--max-warnings=0`).
- `npm run check`: **PASS**, all ten tripwires. `check:help` reports 29 entries, 24 published, 7 images.
- **Omitted argument:** `memberVisible()` at calendar.ts:420 fails `tsc` with TS2554 "Expected 1 arguments, but got 0".

## Unit Tests

**CI shape** (`vitest run`, no DB env): 836 files passed, 140 skipped; 13226 tests passed, 3818 skipped.
- The 140 skipped files are the DB-backed files, which skip without `.env.local` by design. CI runs them in the db shards.
- In the scratch copy, 3 tests in `scripts/pre-push-gate.test.mjs` and `scripts/stats-escape.test.mjs` failed because the copy has no `.git`. I re-ran both files in the worktree: 106 passed. These are environment failures, not regressions.

**DB-backed, serial, as `presby_app`:** 5 files, 261 tests passed, 0 skipped, in 217s. The new "members-only events and standing" describe runs under UTC, America/New_York and Pacific/Honolulu.

**Live catalog probe as `presby_app`:**
- `has_function_privilege('presby_membership_standing(text,text)', 'execute')` is true.
- The function is `immutable` and not a definer.
- It never returns NULL: `(null, null)` gives `unclassified`. So `<> 'visitor'` cannot silently drop a row through NULL.
- `('active', 'visitor')` gives `listed`.

**Mutation check per call site.** Each site was changed to `memberVisible(true)` alone, then I ran `calendar.test.ts` and the T1 scan. The original was restored and byte-compared after each run.

| Site | Query | Behavioural tests that fail (×3 zones) | T1 |
|---|---|---|---|
| calendar.ts:385 | month entries | 8 tests (24): T2 visitor, T2 visitorOtherRole, the count-difference test, T2 orgHasEvents, T4, T5, T7, T8 | fails |
| **calendar.ts:420** | **unfiltered in-month count (only with a type filter)** | **none: 194 of 195 pass** | fails (literal-argument check only) |
| calendar.ts:436 | orgHasEvents | T2 orgHasEvents (3) | fails |
| calendar.ts:515 | event page | 5 tests (15): T2 ×2, T3, T5, T8 | fails |
| calendar.ts:597 | "Coming up" feed | 3 tests (9): T6, T7, T8 | fails |

**T1 fail-first.** In the scratch copy I added `src/lib/qa-probe/leaky-reader.ts` (raw `from events e`) and `leaky-builder.ts` (`.from(events)`).
- "no other non-test source file reads the events table" went red, naming both files.
- With them removed, all 5 tests pass again.

## End-to-End Tests

**Dev lane:** `visitor-access`, `member-calendar`, `public-calendar` and `portal-home-cards` on :3640. Total 53, passed 53, failed 0, skipped 0, in 2.8m. That includes E1 to E3 at desktop and at 360px.

**Production lane:** `PW_PROD_PORT=3840 npm run test:e2e:prod`. Total 111, passed 111, failed 0, skipped 0, in 4.8m.

**360px and 1280px walk, light and dark.** I used a throwaway harness in the scratch copy that records facts and screenshots. It is not a test of record and was deleted with the copy. Standings were confirmed live: visitor = `visitor`, the Inactive person = `inactive`, the member = `listed`.
- **Visitor, all 4 combinations:**
  - The calendar (default and list view) and the "Coming up" card show the public event.
  - The members-only and cancelled titles are absent from the page source, RSC payload included.
  - Copy month toast reads "Calendar copied", with no members-only clause, and the clipboard has no members-only title.
  - A direct link to the members-only event returns **404** with h1 "We couldn't find that event". Status, h1, document title and the full `<main>` text are identical to a random UUID's.
- **Inactive and member, all 4 combinations each:**
  - Both see the members-only event on the calendar, in "Coming up" and on its page (200).
  - Copy month reads "Calendar copied (1 members-only event left out)".
- **Every page:** horizontal overflow is 0.
- **Month/List links:** not visible at 360px, visible at 1280px. The previous and next arrows are visible at both.
- **Screenshots I read:** visitor calendar at 360 dark, visitor Copy month at 360 light, visitor members-only and random 404s at 360 light, Inactive home at 360 light. The dev-only "1 Issue" badge appears identically on both 404s.
- **Manager:** `/admin/events/new` at 360 shows the shipped hint with the org name. The manager's calendar includes the members-only event.

## Regression Tests Added

The implementer wrote these; I ran them.
- T1, `src/lib/calendar-visibility.source.test.ts`: guards against a second unfiltered `events` reader, a literal argument, or the constant coming back. Proven able to fail.
- T2 to T8, `src/lib/calendar.test.ts` (the "members-only events and standing" describe): visitor hiding, the manager bypass, per-org standing, the home-card limit, mixed series, and the public-to-members-only flip.
  - Per-site mutation shows four of the five sites are caught.
  - Fail-first: the implementer reported the all-sites removal (30 of 48 failed). I confirmed it per site, above.
- T9, `page-copy-left-out.test.tsx`, and T10, `website-listing-copy.test.ts` plus the two form tests: copy.
- E1 to E3, `e2e/visitor-access.spec.ts`: browser-level visitor, member and direct link.

**Gap:** no test exercises `calendar.ts:420`. See Verdict.

## Coverage on Critical Modules

Not measured. The diff touches none of `permissions.ts`, `two-factor.ts` or `flags.ts`. The per-site mutation check stands in for coverage on `calendar.ts`.

## Feature-Gate Audit

**No protected routes touched.** The diff adds or changes no `route.ts`, no `"use server"` action and no page file.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| none added or changed | n/a | n/a | n/a (tenant axis) |

`events.view` still gates the calendar. `openMemberGate` (calendar.ts:246-251) still calls `presby_has_permission(.., 'events.view')` and `.., 'events.manage'` in one statement, and still returns `forbidden` when neither holds. The diff only adds a third column after that check. `seesMembersOnly` narrows what an already-admitted viewer reads and never admits anyone.

**Schema/RLS:** not a schema-touching change. The one SQL object the new code calls was probed live as `presby_app` (above).

## Copy Truthfulness

- [x] **Every changed string is in the design's Copy table**, or in the recorded Phase 4 departure 1. C1 departs from the design's visitors-only variant because that variant would be false under Q1; the shipped text is true. C3, C4 and C5 are the visitors-only variants as departure 1 describes.
- [x] **Query behind each claim** (`presby_membership_standing` over the live membership at this org, `<> 'visitor'`, OR `events.manage`).
  - "visitors ... do not see": true for standing `visitor` without `events.manage`.
  - "Members, staff and everyone else who can see the calendar still do", and C5's "Members, staff, people marked 'Inactive' or 'Moved away', and people who can manage events still see it": true. Both are proven by the T2 matrix and by my walk as an Inactive person.
  - "same 'We couldn't find that event' page as an event that does not exist": true. The 404 status and the `<main>` text are byte-equal.
  - What the query does not read: the roll's future-dated actions (residual (a), F29). No string claims immediacy.
- [x] **Instructions vs. role.**
  - C1 is read by an `events.manage` holder and instructs nothing.
  - C5's "changing a person's engagement on their record changes what they see" is read by administrators. Engagement is changed on the person's Edit page "Engagement" card (`community/[id]/edit/engagement-card.tsx`, `people.manage`). The sentence states a consequence and gives no order.
- [x] **Neighbours.**
  - Still stale, owed at integration and already listed in Phase 4: `docs/product/functionality-map.md:23`, `scripts/seed-dev.sql:1879`, and the Q1/Q2 fold-in for DECISION-316.
  - Read and not made false: `turning-features-on-and-off.md:35`, `sign-in-invitations.md:17` (a visitor "can see the calendar" is still true), `adding-people.md:51` (Engagement "decides ... what a connected sign-in can see", now truer), `public-events-calendar-slot.tsx:66`, the registry's `needs.who`, and the page heading "The calendar every member sees". The last two are pre-existing and loose.
- [x] **Help diff.**
  - Read on screen at 360px and 1280px: "Calendar", "Copy month", "Coming up", "Month"/"List" (wide only) and the arrows (both widths), so the N2 sentence matches the screens.
  - "We couldn't find that event" is on screen. "Inactive" and "Moved away" are the `ENGAGEMENT_LABELS` strings.
  - The edited sentences are served at `/help/events-and-the-calendar` (200).
  - I opened all seven committed images under `src/content/help/images/`. Each shows only the fixture congregation "Alder Creek Presbyterian Church" or invented names. No real name, address, email or tenant appears; the only brand is the product's "Sign in with Google" button. No image changed in this diff.

**Copy truthfulness: PASS**, with one note for Phase 6 (N1).

**N1:** a person on the roll whose engagement is still "Visitor" is classified `listed` and sees members-only events. This state is reachable: `adding-people.md:53` and the card's "is still marked as a visitor" nudge both describe it. That person's Edit card says "Visitor", while C5 says "a visitor does not see the event". This is consistent with the ruling's definition (standing, where the roll wins, as in the Directory), so it is not a defect. A clause such as "a person on the roll counts as a member even if still marked as a visitor" would close it; the analyst or operator can decide.

## Verdict

**FAIL: a named coverage gap, handed back to full-stack-developer (Phase 4).**

**F1. No behavioural test for `src/lib/calendar.ts:420`** (the `unfilteredInMonthCount` query inside `getMonthCalendar`).
- With that one site changed to `memberVisible(true)`, 194 of 195 tests pass. The only failure is T1's text check that bans a literal argument (`calendar-visibility.source.test.ts`, "the argument-less MEMBER_VISIBLE constant is gone"). A non-literal regression in the same class, such as `memberVisible(gate.kind === "open")` or `memberVisible(!gate.canManage)`, passes every test.
- **Why:** the query runs only when `activeTypeIds.length > 0`, and every matrix test passes `requestedTypeIds: []`. On that path `unfilteredInMonthCount` is derived from the already-filtered entries, so the T2 assertions on it (`calendar.test.ts`, "%s sees NO members-only event ..." and "the visitor's month holds exactly one fewer ...") never reach line 420. Design T2 listed `unfilteredInMonthCount` among the six outputs it pins.
- **User-visible consequence if it regresses** (`calendar/page.tsx:135-137, 266-274`): a visitor who filters by event type in a month whose only events are members-only would see "No events match these event types." with "Show all event types", instead of "Nothing is scheduled for {month}.". That tells them hidden events exist, which design §3 and §10 and the Copy section's indistinguishability ruling rule out.
- **The code at line 420 is correct by reading.** The gap is the guard, not the behaviour.
- **What closes it:** a DB-backed case in the "members-only events and standing" describe where the visitor and a member request a type filter (a non-empty `requestedTypeIds`) for a month containing members-only events. Assert the visitor's `unfilteredInMonthCount` counts only `is_public` rows, and the member's counts both. Then watch it fail with site 420 mutated before relying on it.

This FAIL does not trace to a design claim: the design specified the coverage and the test missed it. The Accelerated classification holds and no promotion is needed. Everything else in this report is green and need not be re-run after the fix. The re-check is `calendar.test.ts` serially, `calendar-visibility.source.test.ts`, typecheck, lint, and the site-420 mutation once more.

**Observations (non-blocking, not attributed to this diff):**
- In the manager's full-page 360px capture of `/admin/events/new`, the "This event repeats" row sits beside the "Create event" button. It is probably a sticky action bar in a full-page screenshot; it was not investigated.
- Equal 404 timing and the open-tab behaviour after a flip remain unmeasured, as the design states.
- The dev log's one "destination stream errored" came from the `public-calendar` editor flow (an aborted navigation), not the member read path.

**Per-Phase Status row:**

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Gates, DB suites (261), e2e (53 dev, 111 prod lane), the 360px/1280px light/dark walk, copy and feature-gate audits all green; the per-site mutation found `calendar.ts:420` (the type-filtered unfiltered count) with no behavioural test; handback | FAIL | 2026-11-02 |

**Handoff:** to **full-stack-developer** (Phase 4) to add the F1 test, watched failing with site 420 mutated, then passing. Then back to qa for the scoped re-check above. N1 goes forward to the Phase 6 analyst.

## Phase 4 loop-back (QA run 1, F1)

**Added** (`src/lib/calendar.test.ts`, inside "members-only events and standing", a nested describe "with a type filter active (the unfiltered count is its own query)"): a new fixture org `orgF` with two active types (Worship, Study), a visitor and a member. October holds one public typed event, one members-only typed event and one members-only untyped event; November holds only a members-only typed event. Three cases, each under the three process time zones:
- Visitor and member filter October by Worship. The visitor's `unfilteredInMonthCount` is 1 (public rows only); the member's is 3 (both, including the untyped row the filter drops).
- The visitor filters November, whose only event is members-only: `unfilteredInMonthCount` 0 and `orgHasEvents` true, so the page's decision (restated in the test from `calendar/page.tsx`) is "Nothing is scheduled", not "No events match these event types". Unfiltered, the same month reads identically to the visitor. The member's count is 1.
- Visitor filters October by Study (no events): "No events match" from the public count of 1, never the hidden ones.

The surname list in the fixture grew by two names for the two new viewers.

**Fail-first**, as `presby_app` against the pipeline branch:
- `calendar.ts:420` mutated to `memberVisible(true)`: 9 failed (3 new cases x 3 zones), 190 passed, and only the new cases failed. Messages: "expected 3 to be 1" and "expected 1 to be +0".
- Mutated to `memberVisible(!gate.canManage)` (the non-literal class QA named): the same 9 failed.
- Line restored (`git checkout src/lib/calendar.ts`; no diff in `calendar.ts`): `calendar.test.ts` 199 of 199 pass, serially, three zones. `calendar-visibility.source.test.ts` 5 of 5, `typecheck`, `lint` and `npm run check` clean (exit 0).

**N1 for Phase 6 (QA note, no code change):** a person on the roll still marked "Visitor" is classified `listed` and sees members-only events, while the Edit card says "Visitor" and the help copy says a visitor does not see them. It is consistent with the ruling (standing, roll wins, as in the Directory). The analyst or operator may add a clause such as "a person on the roll counts as a member even if still marked as a visitor".
