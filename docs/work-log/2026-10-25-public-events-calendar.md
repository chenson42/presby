# Public events calendar on the public site (events Increment 4) — Work Log

> **Slug:** `2026-10-25-public-events-calendar`
> **Surface:** (public)/site/[slug] + (org) event editing
> **Permission(s):** TBD in Phase 1/3
> **Flag(s):** none expected (operator: per-org toggles, not new platform flags, pre-live)
> **Estimated complexity:** medium
> **Pipeline mode:** Full
> **Numbers (pre-assigned 2026-10-25, Rule 16):** migration 0067; DECISION-238–241; F250–F257; dev port 3500

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete; G1–G14, Q1–Q10; 'published' = new explicit default-off switch | READY WITH NOTES | 2026-10-25 |
| 2 — Architectural review | architect | Complete; R1–R7, DECISION-238/239/240 proposed, F250–F253 | Approved with suggestions | 2026-10-25 |
| 3 — Technical design | tech-lead | Complete; names, 0067 + definer, reader, slot/island, series action, Copy, T1–T20; F254–F256, DECISION-241 drafted; G9 deferred (operator to confirm) | Design complete, implementers named | 2026-10-25 |
| 4 — Implementation | database-admin (Batch 1: 0067, definer, RLS suite), then full-stack-developer (Batches 2–4) | Batch 1 complete (0067 applied and re-applied, section 67 58/58 as presby_app, DB suite 13/13, from-empty green); Batches 2–4 complete (lib, catalog, audit, editor surface, public slot and island, unit/DB/e2e/hydration specs; all gates green); port 3500 | — | 2026-10-25 |
| 5 — Verification | qa | Run 1: all suites green; FAIL-1 360px overflow on event detail; FAIL-2 false audit row when websiteListed omitted; copy + payload notes to tech-lead | FAIL | 2026-10-25 |
| 5 — Verification (run 2) | qa | Complete; FAIL-1/FAIL-2 closed with mutation-proven regressions; chromium 432/432; 360px clean | PASS | 2026-10-25 |
| 4 — Implementation (loop-back 1) | full-stack-developer | Complete; FAIL-1 (360px buttons) and FAIL-2 (boolean narrowing, false audit row) fixed failing-first; amendment 1 strings, N3 gate, size ceiling (321,865 B measured, 410,000 ceiling), N4 placeholder filled; all gates green; awaiting QA re-run | Ready for QA re-run | 2026-10-25 |
| 3 — Technical design (amendment 1) | tech-lead | Complete; QA run 1 rulings: put/take toasts and E8 reworded to "marked" (state the row knows), P2 reworded (no "yet"), payload claim corrected and accepted with a size-ceiling test, N3 gated, N7 TODO text; Phase 4 additions for the implementer; QA re-run scope named | Amendment complete | 2026-10-25 |
| 6 — Shipped vs intent | analyst | Complete; iOS + FPCW integration step + custom-host check open; apply 0067 before merge | SHIP WITH NOTES | 2026-10-25 |

---

# Phase 1 — Functional Refinement (analyst)

Work-log: `/Users/cshenso/git/presby-platform/presby-cal/docs/work-log/2026-10-25-public-events-calendar.md`. Everything below goes in under "Phase 1". I read the code, the work-logs and the fpcw prior art. I did not touch any file.

## VERDICT

**READY WITH NOTES.** Nothing blocks Phase 2. Every open question below has a safe default, so the architect can start now. The notes are G1–G14 and Q1–Q10. G1 is the central one and needs an operator answer before Phase 3 locks the schema.

## ONE-LINE TAKE

> An anonymous visitor to a congregation's public site (platform host or the church's own domain) sees a month calendar, or a list on a phone, of exactly the events an editor explicitly chose to put on the website. That choice is a new, deliberate act, not a side effect of `is_public`, which defaults to true.

## What "published" means (the question to settle first)

**Finding.** Presby's `events.is_public` is not an editorial decision. It defaults to true in the table (`src/lib/db/domain/events.ts`, `drizzle/0036`). The new-event form pre-ticks it (`new-event-form.tsx:38`). Series children copy it from the parent (`events.ts:709`).

**What admins were told.** The checkbox is labelled "Visible on the public calendar", and the hint says "It just stays off the public website" (`new-event-form.tsx:211-215`, `edit-event-form.tsx:182-186`). That promise has never been backed by anything, because the public site has no events yet.

**Why reusing `is_public` is unsafe.** fpcw measured this exact trap in its DECISION-169 (`public-events-embed.md` §2). Reading "public" as `is_public` alone would have put 42 of 51 future events on the open internet with no human deciding to. Presby has the same default. The first congregation to turn the calendar on would publish everything its clerks ever saved with the checkbox left alone. That includes Session and committee meetings, since no audience tier exists below "all members".

**Recommended definition.** An event is on the public website only when all of these hold:
- an editor ticked a separate, default-OFF "show on the website" switch for that event;
- the event is not members-only (`is_public` stays the veto, enforced in the database and re-checked at read time);
- the event is not cancelled;
- the congregation's public-calendar toggle is on;
- the congregation's site is live.

Existing rows backfill to "not on the website", so turning the feature on exposes nothing until someone publishes an event. This keeps the Track K mapping honest: fpcw's `publish_to_google_calendar AND is_public AND NOT members_only` maps to the new switch, and fpcw's `is_public` maps to presby's `is_public`.

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Anonymous visitor (platform host `/site/<slug>/…`, custom host `/…`) | Reads the month grid. On a narrow screen, reads the list. | per visit |
| Anonymous visitor | Moves to the previous or next month. Taps an event to read its description, location and end time in place. | per visit |
| Anonymous visitor | Taps "Member sign-in" and lands on the platform sign-in. | occasional |
| Authenticated member | Is unaffected. The portal calendar at `/o/<slug>/calendar` is unchanged. | n/a |
| Admin with `events.manage` | Ticks or unticks "Show on the website" when creating or editing an event. | per event |
| Admin with `events.manage` | Applies publish or unpublish to a whole repeating series ("this and all later"). | per series |
| Admin with `org_features.manage` | Turns the congregation's public-calendar toggle on or off at `/o/<slug>/admin/features`. | one-time, plus rollback |
| Site content author (private site repo, outside the platform) | Places a `{"type":"liveSlot","props":{"slot":"<name>"}}` block on a page, for example the events page. | one-time per site |
| Platform admin | Verifies the toggle and the slot placement at cutover. | one-time |

No verb needs a surface that was missing from the request. The request said "the website" without naming the editor's surface, so I named it above (the event form).

## Flows

**Flow 1 — Visitor reads the calendar**
- Entry: a link to the site's events page, either `/site/<slug>/<events page>` or `<church domain>/<events page>`.
- Step 1: the page renders the content author's blocks. At the `liveSlot` marker the calendar renders on the server for the current month in the congregation's own time zone, with today marked.
- Step 2: the visitor pages months, switches grid and list, and opens an event for its details.
- Outcome: the visitor reads dates, times, titles, locations and descriptions. A legend names each event type, so colour is never the only signal.
- Failures: see the Copy table. A read failure shows a plain "can't load" line, never "no events". The toggle being off is not an error, and the visitor never sees a stack trace.

**Flow 2 — Editor publishes one event**
- Entry: `/o/<slug>/admin/events/new` or `…/[eventId]/edit`.
- Step 1: the editor ticks "Show on the website". The form states, at the checkbox, what becomes public: title, description, location and the event type's name.
- Step 2: save. The change appears on the public page on the next page load, so unpublishing is equally prompt (see G11).
- Outcome: the event list shows an "On the website" badge.
- Failure: an unticked "open to everyone" box clears or disables the website switch. A save error uses the existing form messages. A person who has lost `events.manage` mid-edit gets the existing forbidden state.

**Flow 3 — Editor publishes or unpublishes a repeating series**
- Entry: editing any occurrence of a series.
- Step 1: a scope choice, "Only this event" or "This and all later events in the series", offered for the website switch only.
- Step 2: a confirm that states the count ("This will put 31 events on the public website").
- Outcome: the rows change in one action and one audit row records it.
- Failure: a partial failure rolls the whole action back. Cancelled occurrences are skipped and the count says so.

**Flow 4 — Admin turns the feature on**
- Entry: `/o/<slug>/admin/features` (`org_features.manage`).
- Step 1: the admin flips "Public events calendar". The toggle's description says the calendar only shows events someone has chosen to put on the website, and that the website page needs the calendar block placed by whoever edits the site.
- Outcome: the next page view of any page carrying the marker shows the calendar.
- Failure: if the toggle is on and no published page carries the marker, nothing changes for visitors. See G9 for how the admin finds out.

**Flow 5 — Visitor at a congregation without the toggle**
- The marker (if the author placed one) renders the "not available" notice (Q6 default). Nothing about which events exist is disclosed.

**Flow 6 — Member follows the sign-in prompt**
- Entry: the "Church members" line and button under the calendar.
- Step 1: the button goes to the platform host, `<platform>/o/<slug>/calendar` via `SiteUrls`. The proxy sends an unauthenticated visitor to `/signin` with the right `callbackUrl`.
- Outcome: the member lands on the portal calendar.
- Failure: if the congregation's member calendar toggle is off, the prompt must not render (G7).

## Permissions & Flags

- **Permission(s):** reuse `events.manage` for the website switch (Q2). No new key. The public read needs no permission, because it is anonymous.
- **Default roles:** unchanged. `events.manage` has no default binding, and a clerk-style role is granted it by the congregation.
- **Per-org toggle:** one new `ORG_FEATURE_CATALOG` entry, toggle-only (`flag: null`), provisioned off, a missing row meaning off. It sits in the `org_portal.*` family beside `org_portal.calendar` and `org_portal.domains`. The key name and category are the tech-lead's call. It must not be `operatorEnabled` unless the operator says so (Q3). The toggle must be checked inside the anonymous read, because an anonymous request has no `personId` and cannot call `isOrgFeatureEnabled`.
- **Platform flag:** none. Operator rule honoured. The existing `sites.public_render` flag already gates the whole public site, so the calendar inherits it.
- **Rollback, fastest first:** (1) the org toggle off, immediate for that congregation; (2) unpublish individual events or a series; (3) `sites.public_render` off for all public sites (blunt). The schema change is additive (default off), so no rollback of data is needed.
- **Permissions vs Flags:** a published event is not a permission and not a flag. It is data about one event. The org toggle is the third mechanism (DECISION-097). All three are asked: site live, then org toggle, then the per-event fact.
- **Audit:** publishing to the open internet is a disclosure change. Precedent is `public_listed` on staff, officer and committee rows, which is audited and records who and when (DECISION-131). Do the same here: audit publish and unpublish, with one row for a series action that carries the count. Event create/edit/cancel stay unaudited (DECISION-113 ruling 5). The toggle flip should already audit through the existing toggle path; Phase 3 should confirm.

## Gaps the Request Didn't Address

### Pass 4 — edge cases

**G1. "Published" is undefined and the default is dangerous.** See "What 'published' means" above. This needs an operator ruling (Q1). Without it the first congregation to enable the feature publishes its whole calendar.

**G2. Existing copy lies once this ships.** The checkbox "Visible on the public calendar" and its hint, the "Public" badge (`events-list.tsx:72`, `[eventId]/page.tsx:126`), and the member-calendar release note all describe a thing that did not exist. After the change, an event badged "Public" that is not on the website would mislead. Phase 3's Copy table must replace all five strings. Suggested copy is in the Copy table below. `Copy month` (the newsletter) keeps filtering on `is_public`; leave it, and say so in the form hint.

**G3. A repeating series needs a series-level switch.** Edits and cancellations apply to one occurrence only (`updateEvent`, `cancelEvent`; the form says "Changes this occurrence only"). A weekly worship series is about 52 rows. Without a scope choice, an editor has to open 52 forms to unpublish a series. Series extension copies the flag from the parent row (`events.ts:709`). The design must state which row's value new occurrences inherit. Suggested: the series parent's current value, as today.

**G4. Time zones.**
- Stored times are wall-clock digits, so display needs no conversion. A published 10:00 AM shows as 10:00 AM to every visitor, wherever they are.
- "Today", the default month, and the current-month list start must come from the congregation's configured zone, as the member calendar does (`todayInOrgZone`), computed on the server and passed to the client. A browser clock would cause a hydration mismatch and a wrong "today" for out-of-zone visitors.
- Labelling the zone is risky. `organization_settings.time_zone` defaults to America/New_York for every org. A congregation that never set it would be told "Eastern Time" falsely. Default: no zone label in v1 (Q7).
- Track K import: fpcw stores UTC instants in a no-timezone column. Import must convert to wall-clock digits in the org's zone and spot-check pre-2.15.79 rows (already on the Track K line).

**G5. Members-only and private leakage.** The public projection must be an allow-list of named fields only: title, start, end, location, description, type name and colour. Never an id (there is no public per-event page), never `allows_checkin`, `created_by`, series fields, the parent id, or `is_public` itself. A new `events` column added later must not appear by default (fpcw DECISION-167 reasoning). Three independent conditions keep a private event off: the explicit switch, `is_public`, and a read-time re-check.

**G6. Free text goes out verbatim, and the form must say so.** Title, description (up to 2000 characters), location (up to 200) and the event type's name are all public. fpcw accepted the same risk and found real examples of descriptions carrying a name, phone and equipment. The type name is a congregation-chosen label. Someone could name a type "Pastoral care". Accept this as a named residual, state it in the form copy, and render everything as plain text: no HTML, no Markdown, no auto-links. Also state that web archives and search engines keep copies, so unpublishing does not recall what was already crawled.

**G7. The member sign-in prompt can lie.** "Sign in to see additional church events" is only true if `org_portal.calendar` is on for the org and the visitor's role has `events.view` (the baseline `member` role has it by migration `0054`, but a non-member account may not). The prompt renders only when the member-calendar toggle is on. Its wording says "Church members", as fpcw settled, so it does not promise access to everyone who signs in.

**G8. Empty and edge states differ and need different words.** The cases are: (a) a month with no events; (b) a congregation with nothing published in the window; (c) the feature unavailable (toggle off, or the read failed). The existing public-staff slot returns an empty list on any database error (`getPublicStaffRoster`'s `catch { return [] }`), which reads as "nobody is listed". For a calendar that would be a false public statement ("no events") during a database blip. The read must return a distinct failed result and the slot must render the "can't load" line (`unavailable`, as the giving slot does). A failed read must still not take the whole page down (the 2026-09-26 render-blip rule).

**G9. Admin cannot tell whether the calendar is actually visible.** The slot is placed by whoever edits the site repo, not by the congregation's admin. A mistyped slot name renders nothing silently (`renderLiveSlotBlock` skips an unknown slot). The toggle's description and the events admin page should say whether a published page carries the marker, for example "The calendar appears on: /upcoming-events" or "No page on your website shows the calendar yet". The bundle's blocks are already in `resolveSite`'s result, so no new data source is needed. This is a cheap truth-in-UI item.

**G10. Month navigation versus the live-slot redline.** DECISION-132 forbids a slot closure from reading the request (`searchParams`, headers, cookies). The member calendar navigates with `?month=`, which a slot cannot do. Options:
- (a) pre-render a bounded window and switch months in a client island with no network call (default; Q5);
- (b) a platform-owned route like `/give`, with `?month=` passed through the render path (needs an explicit amendment to the redline);
- (c) a same-origin JSON endpoint. Custom hosts 404 every `/api/*` path, so this is a non-starter without proxy surgery.

Option (a) adds no endpoint, needs no rate limit, works unchanged on a custom domain, and is crawlable server HTML. Its costs are no deep link to a month, no remembered month on Back, and a payload that must be bounded in both rows and description length. The architect decides.

**G11. Freshness and caching.** The site layout is `force-dynamic`, so HTML is not cached by the platform. For this feature that is a correctness property: an event someone wrongly published and then unpublished must disappear on the next load. QA should confirm no CDN or `Cache-Control` header changes that for this page. Cost is one extra database call per page view of a page that carries the marker, with no new endpoint to abuse.

**G12. Cancelled events.** The member calendar shows cancelled events, struck through. fpcw's public embed hides them. For the public site the default is to hide (Q4). A cancelled event vanishing with no word is a known cost.

**G13. Mobile at 360px, accessibility, brand.**
- Use list layout under about 640px, chosen by CSS (container or viewport query), so there is no flash of the grid on a phone and no dependency on JavaScript for the first paint.
- Targets are at least 44px and text is not smaller than the platform's floor.
- Type colours are the platform-fixed `--category-*` tokens (policy `platform`, `contract.ts`). They must not shift with a congregation's brand, and the legend names each type.
- Because the slot sits inside the site's own layout, the architect decides whether to reuse the member calendar's grid and list components or build public ones. They live under `(org)` and use portal Tailwind.
- Multi-day or overnight events show on the start day only, with "Ends …" in the details. An end time that is not after the start is shown as no end (imported bad data, as in fpcw). There is no all-day concept in presby.

**G14. Track K line 54 needs amending.** It currently says presby's `is_public` should come from `publish_to_google_calendar AND is_public AND NOT members_only`. Under the Q1 default, that AND feeds the new website switch, and `is_public` comes from fpcw's `is_public AND NOT members_only`. Import must also keep only fpcw `kind = 'event'` rows, since presby has no rooms, bookings or meeting kinds. Update the TODO line in the same commit as this pipeline.

### Pass 5 — adversarial pass

| Question | Finding |
|---|---|
| Redirect targets | The only outbound link is the sign-in button. It is built from `SiteUrls` on the platform origin, with no visitor-controlled `callbackUrl`. **Addressed by design.** State this as a test. |
| State-machine shortcuts | A published event reached by any path other than "site live AND org toggle on AND switch on AND `is_public` AND not cancelled" must be unreachable. The toggle and the site-live check go inside the anonymous read, which is the same SECURITY DEFINER pattern as `presby_public_staff_roster`. A database CHECK ties the switch to `is_public`. The projection re-checks `is_public` at read time, independent of the switch. **Phase 3 must pin each with a test.** |
| Enumeration | The slot is reached only through a live site, so "toggle on, no events" versus "toggle off" differs only for a page anyone can already view. That discloses a setting the congregation chose to show. The read takes the DB-returned slug, never the raw host or segment. No event id is ever exposed, so there is no per-event URL to probe. **Addressed by design.** |
| Input boundaries | The marker's `filter` is untrusted author JSON. v1 reads at most a default-view hint (`month` or `list`), narrowed by exact value. Anything else is ignored and never throws. Server-side validation of the switch and the series scope lives in the action, not the form. |
| Hidden control honoured server-side | If the website switch is ever hidden or disabled in the form (for example when the event is members-only), the action must not trust the posted value. It must derive the stored value, clearing the switch when `is_public` is false. A round trip of the edit form must not silently flip the switch for an event the editor never touched. |
| Self-targeting and role-splitting | There is no admin-only action against one's own account here. But if publishing needed its own permission (Q2 alternative), an `events.manage` holder without it could still edit the title and description of an already-published event, changing public text. A separate permission therefore needs a rule for editing published events. The single-permission default avoids the hole. |
| XSS and content injection | React-escaped plain text only. No `dangerouslySetInnerHTML`, no Markdown, no linkification, no title or description inside an attribute that is parsed as markup. |
| Cross-tenant | Composite tenant keys mean the read joins events to the org found by the DB-returned slug. A test should show org A's published events never appear for org B's slug. |
| 2FA mid-enrolment | The event form is under `/o/*`, so the proxy already pushes an un-enrolled `twoFactorRequired` user to `/totp`. The public surface has no session. **No change needed.** |
| Audit | Publish and unpublish are audited, as above. The anonymous read writes nothing. |

## Copy for key states (proposed; Phase 3 owns the final table)

| State | Visitor or editor sees |
|---|---|
| Month with no events | "Nothing is on the calendar for {Month Year}. Use the arrows to look at other months." |
| Nothing published in the whole window | "No events have been posted yet. Please check back soon." Add "Call the office at {phone}" only if the profile has a phone. |
| Feature off, or read failed | "Our events calendar isn't available right now. Please check back soon." Same words for both (Q6), so the page never claims "no events" when it does not know. |
| List view, current month, earlier days | "Show earlier this month" / "Hide earlier this month". If nothing remains: "No more events are scheduled this month." |
| Window edge | Arrows are disabled at the ends with "That's as far ahead as we've planned." No error. |
| Member prompt (only if member calendar is on) | Note: "Church members: sign in to see additional church events." Button: "Member sign-in". |
| Cancelled | Not shown (Q4 default). |
| Event form, new checkbox | Label: "Show on our website's public calendar". Hint: "Anyone on the internet can read this event's title, description, location and type. Search engines and web archives may keep a copy." |
| Event form, existing checkbox | Label: "Open to everyone, not only members". Hint: "If unchecked, the event shows on the member calendar for everyone in {orgName}, stays out of the newsletter copy, and cannot go on the website." |
| Series scope | "Only this event" / "This and all later events in the series". Confirm: "This will put {n} events on the public website." (or "take {n} events off"). |
| Admin list badges | "On the website" / "Members only". No badge for in-between, or "Open to everyone" if the operator prefers. |
| Admin toggle description | "Shows your published events on your public website. Only events someone has chosen to put on the website appear. Your website editor also needs to add the calendar to a page." |
| Admin status line (G9) | "The calendar appears on: {path}" or "No page on your website shows the calendar yet." |

No string may say events "stay off" the website unless the switch is off, or say members "see everything". Copy must not claim a visitor can see "all events".

## Out of Scope (confirm with user)

- A public per-event page or any per-event URL. Details open in place.
- An iCal or "subscribe" feed. This is a parity loss: the old Google Calendar embed let visitors add the calendar to their own. Track it (Q9).
- Type filters, search, or a venue or room filter on the public calendar.
- Sign-ups, RSVPs and capacity on the public side (Track A).
- A Google Calendar push. Presby has none, and the Track K item to adopt existing Google series ids is unrelated to this feature.
- All-day events, and spanning a multi-day event across day cells.
- Series-level cancel and edit. Only the publish switch gets a series scope (Q8).
- An audience tier below "all members" (already tracked).
- Editing the private site content repo to place the block. That is a cutover checklist item for the operator and the site author, not platform code. It will replace the current hero-plus-external-calendar-link events page.
- A zone label (Q7).

## Open Questions (each with the safe default I am designing against)

- **Q1. What does "published" mean?** A separate, explicit, default-off "show on the website" fact per event. `is_public` stays as the veto. The database ties the two. Existing events backfill to "not on the website". *Default: this.* Alternative: reuse `is_public` and show the admin a count ("N upcoming events will appear") when the toggle is turned on. I do not recommend it.
- **Q2. Who may publish?** `events.manage`, with no new permission. Anyone who can edit an event can already change its public text. *Default: this.*
- **Q3. Who turns the toggle on?** The congregation's `org_features.manage` holder, provisioned off, not operator-only. The per-event switch bounds the risk. *Default: self-service.* Operator-only is a one-field change (`operatorEnabled`) if wanted for cutover.
- **Q4. Cancelled events on the public calendar?** Hide. *Default: hide.* Alternative: show struck through, as the member calendar does.
- **Q5. Window and navigation?** Previous month through 12 months ahead, switching months without a network call, with hard caps on rows and description length. *Default: pre-rendered bounded window.* The architect confirms this against DECISION-132 (G10).
- **Q6. What does a congregation without the toggle show at a placed marker?** The "isn't available" notice, same words as a read failure. *Default: notice.* Alternative: render nothing, as the giving slot does for `absent`. That risks a cutover where the marker is live and the page is silently blank.
- **Q7. Show a time-zone label?** No, not in v1. *Default: omit.* Revisit when the org time zone is an explicit setting.
- **Q8. Series scope?** In scope for the publish switch only. *Default: in scope.* If deferred, the release note must say a series is published one occurrence at a time.
- **Q9. iCal or "add to my calendar"?** Deferred and tracked. *Default: out.*
- **Q10. Member sign-in prompt?** Include it, conditional on the member-calendar toggle (G7). *Default: include.*

## Handoff

Next: **architect (Phase 2)**. Please rule on:
- the shape of the switch and its database-level tie to `is_public`;
- where the anonymous read and its SECURITY DEFINER function live, and how the org-toggle and site-live checks sit inside it;
- G10 (how months navigate, and whether DECISION-132's redline needs an amendment);
- reuse versus build of the grid and list components, which live under `(org)`;
- the series-scope write path.

Reserved numbers go to Phase 2 and 3 rulings and findings (DECISION-238–241, F250–F257, migration 0067). A Phase 6 walk will need: an anonymous visitor on both a platform host and a custom host at 360px; an admin who turns the toggle on and publishes one event and one series; and a congregation with the toggle off.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-25 |

Files read, all absolute:
- `/Users/cshenso/git/presby-platform/presby-cal/docs/work-log/2026-10-25-public-events-calendar.md`
- `/Users/cshenso/git/presby-platform/presby-cal/docs/work-log/_template.md`
- `/Users/cshenso/git/presby-platform/presby-cal/docs/work-log/2026-10-14-member-calendar.md`
- `/Users/cshenso/git/presby-platform/presby-cal/docs/TODO.md` (lines 51 and 54)
- `/Users/cshenso/git/presby-platform/presby-cal/src/lib/db/domain/events.ts`
- `/Users/cshenso/git/presby-platform/presby-cal/src/lib/events.ts`
- `/Users/cshenso/git/presby-platform/presby-cal/src/lib/calendar.ts`
- `/Users/cshenso/git/presby-platform/presby-cal/src/lib/org-features.ts`
- `/Users/cshenso/git/presby-platform/presby-cal/src/lib/sites.ts`
- `/Users/cshenso/git/presby-platform/presby-cal/src/app/(public)/site/[slug]/render-site-page.tsx`
- `/Users/cshenso/git/presby-platform/presby-cal/src/app/(public)/site/[slug]/public-giving-slot.tsx`
- `/Users/cshenso/git/presby-platform/presby-cal/src/app/(public)/site/[slug]/staff-directory.tsx`
- `/Users/cshenso/git/presby-platform/presby-cal/src/app/(public)/site/[slug]/layout.tsx`
- `/Users/cshenso/git/presby-platform/presby-cal/drizzle/0041_presby_public_staff_directory.sql`
- `/Users/cshenso/git/fpcw-directory/docs/modules/events/public-events-embed.md`
- `/Users/cshenso/git/presby-platform/presby-site-kit/src/blocks.tsx`

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.** The feature's shape is right, so nothing goes back to Phase 1. The rulings below are binding on Phase 3. The suggestions are labelled as suggestions. G1/Q1 still needs the operator's answer, but every ruling here assumes the analyst's default (a separate switch, off by default). If the operator chooses the `is_public` alternative instead, return to Phase 2.

**Live catalog, read 2026-10-25** (the `development` endpoint from the main worktree's `.env.local`, read-only; `presby-cal` has no `.env.local` and no Neon branch yet):
- `events` and `event_types` have `relrowsecurity = t` and `relforcerowsecurity = t`. Each has one `tenant_isolation` ALL policy on `presby_current_org()`. `events` has no user triggers.
- `presby_app` holds SELECT, INSERT, UPDATE **and DELETE** on `events` (see F253).
- All five existing public definer functions (`presby_public_staff_roster`, `presby_public_committee_roster`, `presby_public_giving_config`, `presby_published_site`, `presby_published_site_by_host`) have the same ACL: `{neondb_owner=X, presby_app=X}`, no PUBLIC execute, and `search_path=public, pg_temp`. The new function must match this exactly.
- **15 of 16 dev events have `is_public = true`.** This confirms G1 against the actual database. Treating `is_public` as "published" would put nearly the whole calendar on the internet.
- `feature_flags`: `sites.public_render` is on and `org_portal.feature_categories` is off. `feature_flags` has no RLS.

## Placement

- **Directory placement:**
  - `drizzle/0067_presby_public_events_calendar.sql` is hand-written. It holds the column(s), the CHECK, an optional partial index, the definer function with its revoke/grant, and comments. The matching columns go in `src/lib/db/domain/events.ts`. **No backfill statement:** `ADD COLUMN ... NOT NULL DEFAULT false` sets every existing row to "not on the website" in a metadata-only step.
  - **The anonymous reader goes in a new `src/lib/public-calendar.ts`** (`import "server-only"`, one function, one `try/catch`, plus a pure exported `mapPublicCalendarRow()` for unit tests). This follows `src/lib/giving/public-config.ts`. It must **not** go in `src/lib/calendar/`, whose header says that directory is pure (no `server-only`, no database) and whose eslint S1 rule bans local-clock date calls. It also must not be added to `src/lib/sites.ts`, which is already 1,885 lines.
  - **The slot and its view go in `src/app/(public)/site/[slug]/`**, either as flat files (`events-calendar-slot.tsx`, `events-calendar-switcher.tsx`) or in an underscore-prefixed private folder (`_events-calendar/`). **Never use a plain, routable folder name.** The sibling `[[...path]]` catch-all serves content-author paths, and a folder named `events-calendar/` could collide with a page at that path.
  - **Do not import any `src/app/(org)/**` file from `(public)`.** Reuse the pure layer: `src/lib/calendar/month.ts` (grid and month arithmetic), `src/lib/calendar/wall-clock.ts` (`formatTime`/`formatTimeRange`) and `src/lib/events/type-palette.ts` (`typeColorClasses`). `groupEntriesByDay` currently lives in `(org)/.../calendar/month-grid.tsx`. If the public view needs it, move it into `src/lib/calendar/month.ts` (it is pure) and update the `(org)` import.
  - `EventTypeIcon` lives in `src/components/org-portal/`, which by the layout's own definition holds `(org)`-only pieces. If the public legend uses icons, move it to `src/components/events/` (the same pattern as `src/components/giving/`). Otherwise leave icons out of the public view; the legend names each type either way.
  - Editor side: the switch goes in the existing `admin/events/new-event-form.tsx` and `edit-event-form.tsx`, plus a new series-scope action in the existing `admin/events/actions.ts`, launched from `admin/events/[eventId]/page.tsx`.
  - The member sign-in URL comes from a new closed method on `SiteUrls` (for example `portalCalendar()`, returning `${platformOrigin}/o/${slug}/calendar`). Never hand-build it.
- **Server vs Client split:**
  - **Server:** the slot (an async Server Component), every month panel (grid and list), the legend, the empty and unavailable states, and the member prompt. All event text reaches the page as server-rendered HTML.
  - **One `'use client'` island**, the month switcher. It holds only the active-month index. It receives the pre-rendered panels as `ReactNode` children plus month labels, and gets **no event data as props**. The initial index (the org's "today" month) is computed on the server and passed in. The client never calls `new Date()`, which would cause hydration mismatches and a wrong "today" for visitors outside the org's zone. Arrows render disabled until hydrated (`useHydrated` from `src/components/shared/`).
  - **Event details open in place** with native `<details>`/`<summary>` (no JS, works before hydration, crawlable) or an existing `src/components/ui/` primitive (`dialog`). There is no popover primitive in `ui/` today. Adding one means `npm run ui:add` and a Phase 2 note, not a hand-rolled one. If `<details>` is used, CLAUDE.md's iOS caveat applies: no `display` override on `<summary>`. Verify on a phone.
  - Grid versus list is chosen with Tailwind container or viewport utilities. **No `<style>` element** (`check:brand-scope` E3) and **no literal `<table>`** (C2). Use the CSS-grid shape the member grid already uses, or `ui/table`.
  - Editor forms already use `useForm`, so `HydrationGate` is in place. The series confirm uses `AlertDialog`, never `confirm()`.
- **Dependencies:** none. Month arithmetic, wall-clock formatting, the palette and primitives all exist already. No `presby-site-kit` release is needed: `liveSlots` is already an open resolver record (v4.0.0, DECISION-132), and the public calendar is built from live data only, like the giving form, so it belongs in presby, not site-kit.

## Invariants Touched

- **Isolation Is a Database Property / F26.** The anonymous read has no org GUC, and `events`, `event_types`, `organization_feature_toggles`, `organization_feature_categories`, `organization_sites` and `organization_settings` are all FORCE RLS. So the read **must** be a `SECURITY DEFINER` function: `stable`, `set search_path = public, pg_temp`, EXECUTE revoked from PUBLIC and granted to `presby_app` only (not `presby_platform`). After applying, check `proacl` on the pipeline branch, not just the DDL text (F38/F152 drift class). The reader uses `db`. **`getPlatformDb()` is not used anywhere in this feature.**
- **Permissions vs Flags.** Three separate mechanisms, none mapped to another:
  - the per-org toggle (new `ORG_FEATURE_CATALOG` entry, `flag: null`, provisioned off, no rows backfilled, `createOrganization()` writes none);
  - the per-event fact (data, not a permission or a flag);
  - the existing `events.manage` permission for writes.
  The public read takes no permission. No platform flag is added (operator rule). `sites.public_render` is inherited, because the slot only renders once `resolveSite()` returns `ok`.
- **A Custom Host Is a Key, Not an Identity.** The resolver closure in `render-site-page.tsx` closes over the **DB-returned `slug`** and `urls` only. It must not use `key`, `request`, `headers()`, `cookies()` or `searchParams` (DECISION-132, affirmed below). The island makes no network call, so the custom-host `/api/*` 404 does not matter. The only outbound link is absolute, to the platform host, via `SiteUrls`, with no visitor-controlled `callbackUrl`. No session or cookie is read.
- **The Brand Is a Cascade Override.** `(public)/site/[slug]` is brandable. The calendar uses `bg-primary`-family utilities and inherits the cascade. Type colours stay on the platform-policy `--category-*` tokens through `typeColorClasses`, so a congregation's brand never shifts them. No `<BrandTokens>`, no `*-brand` utility, no `<style>`. `check:brand-scope` is unchanged and must stay at zero.
- **DECISION-154 (the 2026-09-26 render-blip rule).** Fail-closed means "the same shape as the confirmed-absent case". For this slot, absent means toggle off or site not serving, which renders the "isn't available" notice. So G8 and DECISION-154 agree: a DB error returns `{ state: "unavailable" }`, the same as toggle off. **An empty event list is reachable only through a successful read.** The reader's whole body is one `try/catch` that logs `[public-calendar] readPublicCalendar read failed; treating as unavailable` with the slug only, never the error or its message.
- **Verify in a Browser.** 360px on a phone for both a platform host and a custom host. Check that the list shows below the breakpoint before hydration, and that `<details>` opens on iOS.
- **Audit (Workflow Rule 7).** Narrowly amends DECISION-113 ruling 5; see DECISION-240.
- **Never hard-delete.** Not touched by this feature, but see F253.
- **No CLAUDE.md change required.** No new route group, brandable surface, proxy import, or top-level `src/lib` module directory. `src/components/events/` appears only if the icon moves, and it follows the unlisted `src/components/giving/` precedent.

## Rulings

**R1. The switch's shape and its database tie to `is_public` (G1, Q1).**
- A new column `events.<name> boolean not null default false`. Phase 3 names it; **I suggest `website_listed`**, matching `public_listed` on staff, officer and committee rows.
- **CHECK `events_website_requires_public` = `not <col> or is_public`.** This is the database-level veto.
- The definer's WHERE clause **also** filters on `e.is_public` independently, so a dropped CHECK still cannot publish a members-only row. That makes three independent conditions: switch, CHECK, read-time filter.
- The column is outside DECISION-113 ruling 4's six frozen check-in columns, so no joint re-review is needed.
- *Suggestion:* add `<col>_by uuid references users` / `<col>_at timestamptz`, rewritten on every change in either direction (the DECISION-131 precedent). The audit row is the authoritative record either way.
- *Suggestion:* a partial index `(organization_id, starts_at) where <col> and cancelled_at is null`.

**R2. The anonymous read and the checks inside it (G5, G7, G8, G11).** One definer function, `presby_public_events_calendar(p_slug text)`. Phase 3 names the details, within these rules:
- **Always exactly one row** (the giving-config shape), so "unavailable" and "available with zero events" cannot be confused: `state text` (`'available' | 'unavailable'`), `org_today text` ('YYYY-MM-DD'), `window_start text`, `window_end text`, `truncated boolean`, `member_calendar_on boolean`, `contact_phone text`, `events jsonb`.
- **`events` is built with `jsonb_build_object` and named keys only**: title, starts_at, ends_at (wall-clock text), location, description, type_name, type_color. A future `events` column cannot appear by default. **No event id, `allows_checkin`, `created_by`, series fields, or `is_public`.** The TS type is a separate `PublicCalendarEvent` with no `id` field (the structural precedent from DECISION-133's `PersonCard`). React keys use the index.
- **Gates inside the function, in this order:**
  1. the org exists by `slug` and is `active`;
  2. `organization_sites.status = 'live'`;
  3. **the toggle composed exactly as `orgFeatureEnabledInTx` composes it:** the `orgTypes` allow-list if the catalog entry has one; then the category axis (when the `org_portal.feature_categories` row in `feature_flags` is enabled, the entry's category row must not be disabled; a missing row means on, per 0040); then the toggle row, where a missing row means off.
  Any failure returns `unavailable`, and every reason looks identical.
- **The category axis is not optional here, unlike domains (R6 of that pipeline).** The features page tells an admin "Turn on {category} above to enable this" when the category is off (`features-list.tsx:125-141`). A public read that ignored the category would make that sentence false while the calendar is publicly visible. The flag is read inside the definer so a DB blip fails the whole read closed. Passing it as a parameter from `isFlagEnabled()` would turn an error into `false`, meaning "axis off", meaning the calendar serves.
- `member_calendar_on` composes `org_portal.calendar` the same way (G7).
- **Per-event predicate:** `<col> and is_public and cancelled_at is null`, events joined to the org found by slug. The type join uses the composite key, and an untyped event shows as the org's `is_fallback` type, as in the member calendar.
- **The window and the row cap belong to the function, not the caller.** "Today" is `now()` in `coalesce(organization_settings.time_zone, <default>)`. A test pins the SQL default literal to `DEFAULT_ORG_TIME_ZONE`, the way `type-palette.test.ts` pins 0054.
- The TS mapper narrows every field the way `mapPublicConfigRow` does. A malformed row maps to `unavailable`. Return dates as text (`check:sql-date`).
- Wrap the reader in React `cache()` so two markers on one page share one read. **No `unstable_cache` or `"use cache"`:** freshness after an unpublish depends on the `force-dynamic` layout (G11).
- `scripts/test-rls.sql` gets assertions, run as `presby_app`:
  - an unpublished, members-only or cancelled row never appears;
  - toggle off, site not live, or category off returns `unavailable`;
  - org A's published rows never appear for org B's slug;
  - the CHECK rejects `<col> = true and is_public = false`;
  - PUBLIC has no EXECUTE.

**R3. Month navigation (G10, Q5). DECISION-132's redline is affirmed without amendment.** Use option (a): a pre-rendered, bounded window with client-side switching and no network call.
- **(b) is rejected.** `?month=` would be a request-derived input to an anonymous read on every page carrying the marker, effectively a queryable date-range API, and it would have to be threaded through the catch-all for all content.
- **(c) is rejected.** A custom host 404s every `/api/*` path.
- **Window:** previous month through 12 months ahead (Q5 default; Phase 3 fixes the exact count), plus a hard row cap enforced in SQL. **On truncation the window shrinks to the last complete month**, and the switcher's last month is that month. Phase 3's window-edge copy must not claim "as far ahead as we've planned" when the window, not the plan, is the limit.
- The description is plain text: React-escaped, `whitespace-pre-line` at most, no linkify or Markdown. The column's 2000-character limit is the length cap.
- *Suggestion:* the island may reflect the active month in `location.hash` (`#2026-11`) on the client only, to support a deep link and Back. A fragment never reaches the server, so the redline holds. It must apply after hydration and must not change the server-rendered default.

**R4. Reuse versus build (G13).** Build new public components and reuse the pure layer (see Placement). The `(org)` components assume a per-event `Link` and id (`CalendarEntryLink` to `/o/<slug>/calendar/[eventId]`), `?month=`/filter hrefs (`buildCalendarHref`) and portal styling. Making them dual-purpose would push a public/member branch into every one of them and couple two surfaces with different trust tiers (the DECISION-133 reasoning).

**R5. The series-scope write path (G3, Q8).**
- A dedicated lib mutation in `src/lib/events.ts`, for example `setEventWebsiteListing(viewer, org, { eventId, listed, scope: "one" | "this_and_later" })`. It does one thing (DECISION-133). It checks `hasEventsManage` inside the same `withOrgContext` transaction. The action body re-resolves the slug through `resolveActingIdentity` (session and `resolveOrgContext`), and `organizationId` never comes from form data.
- The series is the root (`parent_event_id is null`) plus the rows whose `parent_event_id` is that root. "Later" means `starts_at >=` the chosen row's. Cancelled rows are skipped. When publishing, `is_public = false` rows are skipped and counted. The function **returns the actual counts** (changed, skipped-cancelled, skipped-members-only).
- **The confirm count and the write share one predicate function.** The confirm count comes from a server read; the toast after the write reports the returned counts.
- The single-event create and edit forms keep the checkbox as a **required boolean input** (not optional and not "undefined means unchanged", per DECISION-133's FormData ambiguity).
- **`updateEvent` derives the stored value:** `<col> := input.<col> and input.isPublic`. It never trusts a posted `true` for a members-only event, and a disabled checkbox (which posts nothing) reads as `false` (F251).
- **`extendSeriesPattern`** sets new occurrences' value from the **latest existing occurrence** it already reads, ANDed with the inherited `is_public`. It never takes it from the parent row (F252). The extend form states how many new occurrences will go on the website when that number is nonzero.

**R6. Audit (Flow 3, Pass 5).** Covered in DECISION-240 below: the audit row is tied to the column changing, whichever write path changes it.

**R7. G9 (status line showing where the calendar appears).** Structurally approved; it is Phase 3's call whether to build it now. If it is built:
- the slot name is **one exported constant** used by both `render-site-page.tsx` and a pure walker over `getPublishedSite(slug).pages[].mdxAst` (flat `ContentBlock[]`, DECISION-132);
- the `(org)` admin page calls `getPublishedSite` (the anonymous `db` definer, already `cache()`d), never `getPlatformDb()`;
- the copy says it reflects the published site.
If it is deferred, the toggle description's "Your website editor also needs to add the calendar to a page" is truthful without it. Track the deferral in `docs/TODO.md`.

## Proposed decisions

- **DECISION-238.** The public events calendar's publication is a new per-event column, off by default, tied to `is_public` by a table CHECK and re-filtered on `is_public` at read time. The anonymous read is one `SECURITY DEFINER` function that always returns one row. Inside it, it checks: org active, site live, and the toggle composed exactly as `orgFeatureEnabledInTx` composes it, **including the category axis read from `feature_flags` inside the function**. It returns a `jsonb_build_object` allow-list with no ids. The window and row cap are fixed inside the function, and every non-serving reason and every read failure collapses to `unavailable` (DECISION-154). The reader lives in `src/lib/public-calendar.ts`, not the pure `src/lib/calendar/`.
- **DECISION-239.** DECISION-132's live-slot redline is affirmed without amendment for a navigable slot. Month navigation is a pre-rendered bounded window switched by a client island that receives only server-rendered panels and an index. Request-derived parameters (`?month=`) and a JSON endpoint are rejected. A client-only `location.hash` mirror is permitted because it never reaches the server. Public calendar components are built in `(public)/site/[slug]` (flat or `_`-private folder). They reuse only the pure `src/lib/calendar`/`src/lib/events` layer and never import `(org)` route files.
- **DECISION-240.** Narrow amendment to DECISION-113 ruling 5. Event create, edit, extend and cancel remain unaudited **except** when the website column changes. Any write path that flips it in either direction writes **one** in-transaction audit row via `insertAuditRow` (`src/lib/audit-tx.ts`, so the change and the audit commit together). That covers `createEvent` (including a series), `updateEvent` (including the derived clear when `is_public` goes false), `extendSeriesPattern` (new occurrences inherited as listed), and the series-scope mutation. The row carries the new `AUDIT_ACTIONS` keys (listed/unlisted), the scope, the root event id, and the changed and skipped counts. The org toggle flip is already audited by `toggleOrgFeature()`. Cancelling an event is not audited; it narrows exposure and the read filters it out.
- DECISION-241 is left for tech-lead's Phase 3.

## Findings

- **F250.** `presby_public_giving_config` (0055) checks the `org_portal.giving` toggle row but not the category axis. Yet `/o/<slug>/admin/features` tells an admin "Turn on Giving above to enable this" when that category is off, while the public give page keeps serving. It is latent today because `org_portal.feature_categories` is off on dev. Out of scope here; add a TODO line and a bug-fix pipeline. DECISION-238 keeps the new function from repeating it.
- **F251.** `updateEvent` writes `isPublic` straight from input. Once the CHECK exists, unticking "open to everyone" on a listed event raises a constraint error on a routine edit, unless the same UPDATE derives `<col> := <col> and isPublic` (R5). Pin it with a test.
- **F252.** `extendSeriesPattern` copies `isPublic` from the series **parent** (`events.ts:709`). Copying the website column the same way would re-list occurrences after a "this and all later" unlisting, since the parent row is usually in the past and still listed. New occurrences inherit from the latest occurrence (R5).
- **F253.** The live catalog shows `presby_app` (and `presby_platform`) holding DELETE on `events`. That contradicts the operator's all-deletes-are-soft rule. A hard delete would remove a listed event with no unlisting audit row. No code path deletes events today, so this is `paper`. Out of scope; TODO line.
- F254–F257 are left for Phase 3 onwards.

## Notes for Phase 3

1. Name the column, the definer function, the toggle key (suggested `org_portal.public_calendar`, category `worship` beside `org_portal.calendar`; `orgTypes` should be `null` unless there is a reason, since presbyteries have sites and events), the slot name constant (suggested `eventsCalendar`) and the audit keys. **The toggle key string appears in SQL and in `ORG_FEATURE_CATALOG`. A test pins them equal**, and the same applies to the `orgTypes` and category used in the SQL composition.
2. The marker's `filter` honours at most `view: "month" | "list"`, narrowed by exact value. Anything else is ignored and never throws.
3. Copy: the window edge (R3) must not claim more than the window shows. Replace all five "public calendar" strings the analyst listed (G2). The form hint must state the free-text residual, including that crawlers and archives keep copies.
4. Phase 4 creates the pipeline's Neon branch and `.env.local` in `presby-cal` (Rule 16, port 3500). 0067 is unreleased until applied to a shipped environment, so an in-place correction is allowed. After applying, re-read `proacl`, `pg_constraint` and `relforcerowsecurity` on that branch.
5. Tests Phase 4 must write (QA verifies, does not author):
   - the definer suite in `scripts/test-rls.sql` (R2);
   - mapper narrowing, and a failure mapping to `unavailable`, never an empty list;
   - the slot never receives an id (a type-level and a render assertion);
   - closure discipline in `render-site-page.tsx` (`slug`/`urls` only);
   - F251 and F252 regressions;
   - an audit row exactly when the column changes, on all four write paths;
   - series counts match the rows written;
   - an `e2e/hydration/` case showing the list renders and arrows are inert before hydration;
   - 360px on both host modes.
6. Housekeeping at integration: amend the Track K line (G14); add TODO lines for F250, F253 and Q9 (iCal), and for G9 if deferred.
7. Rollback stays as Phase 1 listed it: toggle, then per-event or series unlisting, then `sites.public_render`. The schema change only adds things, so no data rollback is needed.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete; R1–R7, DECISION-238/239/240 proposed, F250–F253 | Approved with suggestions | 2026-10-25 |

## Handoff

Next: **tech-lead (Phase 3)**. Design against R1–R7 and DECISION-238/239/240, and record DECISION-241 for the implementation calls. Confirm with the operator before locking the column: Q1 (I assumed the separate off-by-default switch) and Q3 (self-service versus `operatorEnabled`). A different Q1 answer returns to Phase 2. Suggested implementer: **full-stack-developer**, or database-admin for 0067 followed by full-stack-developer, since the migration, reader, slot, island, forms and series action are tightly coupled.

Files read (all in `/Users/cshenso/git/presby-platform/presby-cal/`):
- `docs/work-log/2026-10-25-public-events-calendar.md`
- `docs/decisions.md` (DECISION-131, -132, -133, -154)
- `src/app/(public)/site/[slug]/render-site-page.tsx`, `layout.tsx`, `public-giving-slot.tsx`, `staff-directory.tsx`
- `src/lib/giving/public-config.ts`, `src/lib/sites.ts`, `src/lib/org-features.ts`, `src/lib/events.ts`, `src/lib/db/domain/events.ts`, `src/lib/audit-tx.ts`, `src/lib/site-urls.ts`, `src/lib/shared/org-time.ts`, `src/lib/calendar/month.ts`
- `src/app/(org)/o/[slug]/calendar/*.tsx`, `src/app/(org)/o/[slug]/admin/events/actions.ts`, `src/app/(org)/o/[slug]/admin/features/features-list.tsx`
- `drizzle/0055_presby_giving.sql`, `drizzle/0057_presby_org_domains.sql`, `drizzle/0040_presby_org_feature_categories.sql`
- `scripts/check-brand-scope.mjs`
- The live `development` catalog: `pg_class`, `pg_policies`, `aclexplode(relacl)`, `pg_trigger`, `pg_proc.proacl`/`proconfig`, and the live body of `presby_public_staff_roster`

---

# Phase 3 — Technical Design (tech-lead)

Design date 2026-10-25. Designed against the live tree at `ce661d7` (main, v0.42.2) in `/Users/cshenso/git/presby-platform/presby-cal`. Binding inputs: Phase 1 (G1–G14, Q1–Q10), Phase 2 (R1–R7, DECISION-238/239/240, F250–F253, Notes 1–7), and the operator rulings at the end of this file (Q1 = a new per-event switch with `is_public` as the veto; Q3 = self-service toggle; everything else on the analyst's defaults).

## Summary

A congregation's public website (platform host `/site/<slug>/…` and the church's own domain) can show an events calendar: a month grid on a computer, a list on a phone, rendered on the server as a `liveSlot` block (`eventsCalendar`) wherever the site's author places it. An event is on the website only when an editor ticked a new, default-off `events.website_listed` box for it, the event is not members-only (`is_public` is the veto, enforced by a table CHECK **and** re-filtered at read time), it is not cancelled, the congregation's new self-service toggle `org_portal.public_calendar` is on (composed with the worship category axis exactly as `orgFeatureEnabledInTx` composes it), and the congregation's site is live. The anonymous read is one `SECURITY DEFINER` function that always returns one row, builds a named-keys-only JSON projection with no ids, fixes its own 14-month window and 400-row cap, and collapses every non-serving reason and every read failure to `unavailable`. Months switch in one small client island over pre-rendered server panels, with no network call, so the redline in DECISION-132 holds unamended. The editor side gets the new checkbox on the create and edit forms, a "Website listing" section on the event page that publishes or unpublishes a series from one event onward with a counted confirmation, and one audit row whenever the column changes, on every path that can change it.

## Names (the Phase 3 choices Notes 1 asked for)

| Thing | Name |
|---|---|
| Migration | `drizzle/0067_presby_public_events_calendar.sql` (hand-written; journal entry added at integration) |
| Column / TS field | `events.website_listed` / `events.websiteListed`, `boolean not null default false` |
| CHECK | `events_website_requires_public` = `not website_listed or is_public` |
| Definer | `presby_public_events_calendar(p_slug text)` |
| Definer output | `state, org_today, first_month, last_month, truncated, member_calendar_on, contact_phone, events_json` (shape below) |
| Org toggle key | `org_portal.public_calendar` (const `PUBLIC_CALENDAR_FEATURE_KEY`), category `worship`, `flag: null`, `provisionedOn: false`, `orgTypes: null`, `operatorEnabled: false`; display name "Public events calendar" |
| Slot name | `PUBLIC_CALENDAR_SLOT = "eventsCalendar"` |
| Audit keys | `EVENT_LISTED_ON_WEBSITE: "event.listed_on_website"`, `EVENT_UNLISTED_FROM_WEBSITE: "event.unlisted_from_website"` |
| Pure contract file | `src/lib/calendar/public-contract.ts` (constants, types, filter parser; no `server-only`, no database) |
| Server reader | `src/lib/public-calendar.ts` (`readPublicCalendar`, `mapPublicCalendarRow`) |
| Pure listing rules | `src/lib/events/website-listing.ts` |
| Lib mutation / action | `setSeriesWebsiteListing(...)` in `src/lib/events.ts` / `setSeriesWebsiteListingAction(slug, input)` in `admin/events/actions.ts` |
| New `SiteUrls` method | `portalCalendar()` |
| Window constants | `PUBLIC_CALENDAR_MONTHS_BEFORE = 1`, `PUBLIC_CALENDAR_MONTHS_AFTER = 12`, `PUBLIC_CALENDAR_ROW_CAP = 400` (mirrored in the SQL, pinned by a test) |
| Fixture dir | `scripts/public-calendar/` |

## Permissions & Flags

- **Permission keys:** none new. `events.manage` (existing, no default role binding, DECISION-115) gates marking an event, the series action, and everything on the editor surface. `org_features.manage` (existing, DECISION-097) gates the toggle. The public read takes no permission: it is anonymous.
- **Default role bindings:** unchanged. A clerk-style role is granted `events.manage` by the congregation, as today.
- **Org toggle:** one new `ORG_FEATURE_CATALOG` entry, `org_portal.public_calendar`, toggle-only, provisioned off, a missing row means off, no backfill, `createOrganization()` writes nothing for it (so `org-provisioning` needs no change). Self-service per operator ruling Q3. The existing toggle path already audits the flip (`ORG_FEATURE_TOGGLED`, `toggleOrgFeature()`); confirmed by reading `org-features.ts`. No `OffWarning` registry entry (a rollback should be one click) and no confirmation on turning it on; see F255.
- **Platform flag:** none new (operator rule, "No new platform flags pre-live"). `sites.public_render` is inherited because the slot only renders after `resolveSite()` returns `ok`. `org_portal.events` gates the editor pages only; it does not gate the public read, so turning it off stops new publishing but does not unpublish what is already marked (the org toggle is the kill switch). `org_portal.feature_categories` is read **inside** the definer (Phase 2 R2).
- **Permissions vs Flags check:** a published event is data about one event, not a permission and not a flag. Three separate questions are asked in order: site live, org toggle (with category axis), then the per-event fact.
- **Audit:** one row whenever `website_listed` changes, on every write path (DECISION-240); cancel stays unaudited.

## API Contract

No new route handlers. No new `/api` path. Everything is a SQL function, a server-only reader, a lib mutation and a server action.

### SQL: `presby_public_events_calendar(p_slug text)`

`returns table (state text, org_today text, first_month text, last_month text, truncated boolean, member_calendar_on boolean, contact_phone text, events_json jsonb)`, `language plpgsql stable security definer set search_path = public, pg_temp`, EXECUTE revoked from `public, presby_app, presby_platform` then granted to `presby_app` only. **Always exactly one row.**

- `state = 'unavailable'`: every other column is null. Returned for: unknown slug, org not `active`, site not `live`, toggle off or missing, category off (axis on), window too small after truncation. All byte-identical.
- `state = 'available'`: `org_today` is `YYYY-MM-DD` in the org's zone; `first_month`/`last_month` are `YYYY-MM`; `truncated` says the row cap shrank the window; `member_calendar_on` is `org_portal.calendar` composed the same way; `contact_phone` is `organization_profiles.phone`; `events_json` is a JSON array ordered by `(starts_at, id)`.
- Each event object has **exactly these keys**: `title`, `starts_at`, `ends_at`, `location`, `description`, `type_name`, `type_color` (times as `YYYY-MM-DDTHH:MI` text, `check:sql-date`; title and location clipped to 200 and description to 2000 characters as defence in depth, F256). No id, no `allows_checkin`, no `created_by`, no series fields, no `is_public`, no `website_listed`.

Reference body (Phase 4 may restructure; the tests, not this text, are the contract). The toggle composition is the part that must not drift:

```sql
drop function if exists presby_public_events_calendar(text);
create function presby_public_events_calendar(p_slug text)
returns table (state text, org_today text, first_month text, last_month text, truncated boolean,
               member_calendar_on boolean, contact_phone text, events_json jsonb)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  c_cap  constant integer := 400;                   -- PUBLIC_CALENDAR_ROW_CAP
  c_zone constant text    := 'America/New_York';    -- DEFAULT_ORG_TIME_ZONE (pinned by test)
  v_org record; v_zone text; v_today date; v_first date; v_after date; v_last date; v_cut date;
  v_axis_on boolean; v_cat_ok boolean; v_public_on boolean; v_member_on boolean; v_events jsonb;
begin
  select o.id, o.status into v_org from organizations o where o.slug = p_slug;
  if not found or v_org.status <> 'active'
     or not exists (select 1 from organization_sites s where s.organization_id = v_org.id and s.status = 'live') then
    return query select 'unavailable'::text, null::text, null::text, null::text, null::boolean,
                        null::boolean, null::text, null::jsonb;
    return;
  end if;

  -- The toggle, composed exactly as orgFeatureEnabledInTx composes it (org-features.ts):
  --   orgTypes allow-list (null for both keys: none here; a test pins orgTypes === null),
  --   then the category axis (flag row missing = axis off; category row missing = on),
  --   then the toggle row (missing = off).
  v_axis_on := coalesce((select f.enabled from feature_flags f where f.key = 'org_portal.feature_categories'), false);
  v_cat_ok  := (not v_axis_on) or coalesce((select c.enabled from organization_feature_categories c
                 where c.organization_id = v_org.id and c.category = 'worship'), true);
  v_public_on := v_cat_ok and coalesce((select t.enabled from organization_feature_toggles t
                 where t.organization_id = v_org.id and t.feature_key = 'org_portal.public_calendar'), false);
  if not v_public_on then  -- return the unavailable row (as above)
    return query select 'unavailable'::text, null::text, null::text, null::text, null::boolean,
                        null::boolean, null::text, null::jsonb;
    return;
  end if;
  v_member_on := v_cat_ok and coalesce((select t.enabled from organization_feature_toggles t
                 where t.organization_id = v_org.id and t.feature_key = 'org_portal.calendar'), false);

  v_zone  := coalesce((select st.time_zone from organization_settings st where st.organization_id = v_org.id), c_zone);
  v_today := (now() at time zone v_zone)::date;
  v_first := (date_trunc('month', v_today::timestamp) - interval '1 month')::date;     -- 1 month before
  v_after := (date_trunc('month', v_today::timestamp) + interval '13 months')::date;   -- through +12 months

  with picked as (
    select e.id, e.starts_at, e.ends_at, e.title, e.location, e.description,
           t.name as type_name, t.color as type_color
      from events e
      left join event_types fb on fb.organization_id = e.organization_id and fb.is_fallback
      left join event_types t  on t.id = coalesce(e.event_type_id, fb.id) and t.organization_id = e.organization_id
     where e.organization_id = v_org.id
       and e.website_listed and e.is_public and e.cancelled_at is null     -- three independent conditions
       and e.starts_at >= v_first::timestamp and e.starts_at < v_after::timestamp
     order by e.starts_at, e.id
     limit c_cap + 1
  ), numbered as (
    select p.*, row_number() over (order by p.starts_at, p.id) as rn from picked p
  ), cut as (
    select min(date_trunc('month', n.starts_at))::date as m from numbered n where n.rn > c_cap
  )
  select (select m from cut),
         coalesce(jsonb_agg(jsonb_build_object(
             'title', left(n.title, 200),
             'starts_at', to_char(n.starts_at, 'YYYY-MM-DD"T"HH24:MI'),
             'ends_at', to_char(n.ends_at, 'YYYY-MM-DD"T"HH24:MI'),
             'location', left(n.location, 200),
             'description', left(n.description, 2000),
             'type_name', n.type_name, 'type_color', n.type_color) order by n.rn)
           filter (where n.rn <= c_cap and n.starts_at < coalesce((select m from cut)::timestamp, 'infinity'::timestamp)),
           '[]'::jsonb)
    into v_cut, v_events from numbered n;

  if v_cut is not null then                       -- truncated: the window shrinks to the last COMPLETE month
    v_last := (v_cut::timestamp - interval '1 month')::date;
    if v_last < v_first then                      -- not even one complete month fits: fail closed
      return query select 'unavailable'::text, null::text, null::text, null::text, null::boolean,
                          null::boolean, null::text, null::jsonb;
      return;
    end if;
  else
    v_last := (v_after::timestamp - interval '1 month')::date;
  end if;

  return query select 'available'::text, to_char(v_today, 'YYYY-MM-DD'), to_char(v_first, 'YYYY-MM'),
         to_char(v_last, 'YYYY-MM'), v_cut is not null, v_member_on,
         (select p.phone from organization_profiles p where p.organization_id = v_org.id), v_events;
end $$;
```

### TypeScript reader (server-only)

```ts
// src/lib/calendar/public-contract.ts  (pure)
export interface PublicCalendarEvent {           // deliberately no `id`
  title: string;
  startsAt: string;                              // 'YYYY-MM-DDTHH:mm' wall clock
  endsAt: string | null;                         // null when absent or not after startsAt
  dayKey: string;                                // startsAt.slice(0, 10)
  location: string | null;
  description: string | null;
  typeName: string | null;
  typeColor: EventTypeColor;                     // unknown/absent -> "neutral"
}
export type PublicCalendar =
  | { state: "unavailable" }
  | { state: "available"; orgToday: string; firstMonth: MonthRef; lastMonth: MonthRef;
      truncated: boolean; memberCalendarOn: boolean; contactPhone: string | null;
      events: PublicCalendarEvent[] };
export function parseCalendarFilter(raw: Record<string, unknown>): { view: "month" | "list" };

// src/lib/public-calendar.ts  (import "server-only")
export function mapPublicCalendarRow(row: Record<string, unknown> | undefined): PublicCalendar;
export const readPublicCalendar: (slug: string) => Promise<PublicCalendar>;   // React cache()
```

`readPublicCalendar` rules: a slug that fails `parseSiteKey(slug).kind === "slug"` returns `unavailable` without touching the database; the body is **one** `try/catch` around one `db.execute` of ``select * from presby_public_events_calendar(${slug}::text)`` on the anonymous `db` (never `getPlatformDb()`); the catch logs `[public-calendar] readPublicCalendar read failed; treating as unavailable` with `{ slug }` only (never the error or its message) and returns `unavailable`. No `unstable_cache`, no `"use cache"`: freshness after an unpublish rests on the `force-dynamic` site layout (G11). `mapPublicCalendarRow` narrows every field (`events_json` must be an array, because the driver parses jsonb; a string is refused), maps a malformed row to `unavailable` (never to an empty list), and applies three tolerances only: an `ends_at` not after `starts_at` becomes `null` (imported bad data, G13), an unknown `type_color` becomes `neutral`, and an empty-string `location`/`description` becomes `null`. An event outside `[firstMonth, lastMonth]`, more than 400 events, or a span over 14 months also maps to `unavailable`.

`parseCalendarFilter` honours only `view`, by exact value (`"month"` or `"list"`); anything else, including a non-string, is ignored and the default is `"month"`. It never throws (Note 2).

### Lib and action signatures (`src/lib/events.ts`, `admin/events/actions.ts`)

```ts
export interface EventActor { userId: string; email: string | null }   // email feeds the audit row

// CHANGED: third parameter was `actingUserId: string`
createEvent(viewerPersonId, organizationId, actor: EventActor, input: CreateEventInput)
// CHANGED: `actor` inserted before `input`
updateEvent(viewerPersonId, organizationId, actor: EventActor, input: UpdateEventInput)
// CHANGED: `actor` inserted before `input`
extendSeriesPattern(viewerPersonId, organizationId, actor: EventActor, input: ExtendSeriesInput)

// CreateEventInput and UpdateEventInput each gain a REQUIRED `websiteListed: boolean` (DECISION-133: no
// "undefined means unchanged" FormData ambiguity).

// NEW
setSeriesWebsiteListing(viewerPersonId, organizationId, actor: EventActor,
  input: { eventId: string; listed: boolean }): Promise<EventsResult<SeriesListingOutcome>>
export interface SeriesListingOutcome { changed: number; unchanged: number; skippedCancelled: number; skippedMembersOnly: number }

// NEW action
setSeriesWebsiteListingAction(slug: string, input: { eventId: string; listed: boolean }): Promise<ActionResult<SeriesListingOutcome>>
```

- `EventListEntry` gains `websiteListed: boolean`. `EventDetail` gains `websiteListed: boolean` and `seriesWebsite: SeriesWebsiteSummary | null` (null for a standalone event):

```ts
interface SeriesWebsiteSummary {
  fromStartsAt: string;                                            // the anchor's start, for the dialog copy
  put:  { changes: number; skippedCancelled: number; skippedMembersOnly: number };   // "this and later" -> listed
  take: { changes: number };                                       // "this and later" -> unlisted
  inheritsOnExtend: boolean;                                       // what extendSeriesPattern would copy (parent page)
}
```

- **Derivation, in the lib, never trusted from the form (F251):** `listed := input.websiteListed && input.isPublic` in `createEvent` (parent and every generated child) and in `updateEvent`. `updateEvent` reads the existing `website_listed` and writes the derived value in the **same** UPDATE that writes `is_public`, so the CHECK is never tripped by a routine edit.
- **`extendSeriesPattern` (F252):** loads every row of the series (parent plus children, at most 52) once. New occurrences copy `is_public` from the parent as today, and get `website_listed := inheritedListing(rows) && parent.isPublic`, where `inheritedListing` is the `website_listed` of the **latest non-cancelled occurrence** (parent included), or `false` if there is none. Never from the parent row alone.
- **`setSeriesWebsiteListing`:** one `withOrgContext` transaction; `hasEventsManage` first; loads the anchor scoped to `(id, organizationId)` (`invalid_target` otherwise, indistinguishable for a foreign id); loads the series rows `FOR UPDATE` (root = `anchor.parentEventId ?? anchor.id`; rows are `id = root or parent_event_id = root`, same org); `planSeriesListing(rows, anchorId, listed)` (pure, below) picks the ids; one `UPDATE … WHERE organization_id = $org AND id = ANY($ids)`; one audit row when `changed > 0`. A non-boolean `listed` or a non-UUID `eventId` is `invalid_input`/`invalid_target`. The CHECK is the backstop: a concurrent edit that made a row members-only after the lock is impossible (rows are locked); if it ever fires, the whole transaction rolls back, never a partial change.
- **Pure rules (`src/lib/events/website-listing.ts`, shared by the confirm count and the write):** `deriveListed(wanted, isPublic)`, `planSeriesListing(rows, anchorId, listed)` returning `{ ids, unchanged, skippedCancelled, skippedMembersOnly }`, and `inheritedListing(rows)`. "Later" is `startsAt >= anchor.startsAt`, compared as `Date` values (no getters, so ESLint S1 is satisfied). Cancelled rows are skipped and counted. When listing, `is_public = false` rows are skipped and counted. Rows already in the target state are `unchanged`. `getEvent` builds `seriesWebsite` from the rows it already loads, calling the same `planSeriesListing`.

### Audit (DECISION-240)

One in-transaction `insertAuditRow` (`src/lib/audit-tx.ts`) per write that changes the column, so the change and its audit row commit or roll back together:

| Path | Fires when | Action | Metadata |
|---|---|---|---|
| `createEvent` | derived `listed` is true | `EVENT_LISTED_ON_WEBSITE` | `{ organizationId, via: "create", changed: <occurrences>, rootEventId }` |
| `updateEvent` | derived value differs from the stored one | listed or unlisted | `{ organizationId, via: "update", changed: 1, clearedBecauseMembersOnly?: true }` |
| `extendSeriesPattern` | inherited `listed` is true and rows were made | `EVENT_LISTED_ON_WEBSITE` | `{ organizationId, via: "extend", changed: <new rows>, rootEventId }` |
| `setSeriesWebsiteListing` | `changed > 0` | listed or unlisted | `{ organizationId, via: "series", scope: "this_and_later", changed, skippedCancelled, skippedMembersOnly, rootEventId, anchorEventId }` |

`resourceType: "event"`, `resourceId`: the event (or series root) id. A no-op (nothing changed) writes no row. `cancelEvent` writes none and leaves the column alone (F254).

### `SiteUrls.portalCalendar()`

Added to the interface and both builders: `${platformOrigin}/o/${slug}/calendar` (absolute, platform host, like `portal()`); no visitor-controlled input. The source-scan test that bans hand-built `/site/${…}` is unaffected.

### Slot wiring (`render-site-page.tsx`)

```tsx
liveSlots: {
  …,
  // Closes over the DB-returned `slug` and `urls` ONLY (DECISION-132): never `key`, request, headers, cookies, searchParams.
  [PUBLIC_CALENDAR_SLOT]: (filter) => <PublicEventsCalendarSlot slug={slug} urls={urls} filter={filter} />,
}
```

## Data Model

One migration, `0067`, additive:

1. `alter table events add column if not exists website_listed boolean not null default false;` Metadata-only on this Postgres; every existing row is "not on the website" with no backfill statement.
2. `alter table events drop constraint if exists events_website_requires_public; alter table events add constraint events_website_requires_public check (not website_listed or is_public);` All existing rows are `false`, so it validates trivially.
3. `comment on column events.website_listed` (states: set only by an editor with `events.manage`; never inferred from `is_public`; the definer re-filters `is_public` regardless) and `comment on constraint`.
4. The definer above, with `revoke all … from public, presby_app, presby_platform; grant execute … to presby_app;` and a `comment on function`.
5. **No new table, no new RLS, no new grant** (a column is covered by the existing table grants and the existing `tenant_isolation` FORCE policy), no `_by`/`_at` columns and no partial index (declined, DECISION-241).

`src/lib/db/domain/events.ts`: add `websiteListed: boolean("website_listed").notNull().default(false)` and the matching `check("events_website_requires_public", …)` (`not website_listed or is_public`), plus a comment on `isPublic` ("members-only veto, NOT website publication"). `check:schema-parity` compares presence and nullability, both match. The column is outside DECISION-113 ruling 4's six frozen columns.

**Feasibility check against the live tree (done 2026-10-25):**
- The function has no defaults, so parameter ordering is valid SQL.
- No `ALTER`/`DROP` against an existing column. No `SECURITY DEFINER` body in `drizzle/*.sql` references `events` (grepped `from/join/into/update events` across all migrations: only 0036 and 0054).
- The new CHECK against fixtures: `scripts/seed-dev.sql:1884,1902` and `scripts/test-rls.sql:1894,1920,8485-8503` and `e2e/support/calendar-fixture.ts:124` and `home-cards-fixture.ts:226` all name their columns, so the new column defaults to `false` and the CHECK passes.
- No new FK.
- `scripts/test-rls.sql`'s definer sweeps are name-restricted lists (the sweeps at lines 3245–7509 were read), so a new function does not move any exact count; Phase 4 re-confirms by running the suite.
- `presby_app` cannot write `organization_sites` (grant is `presby_platform` only, `drizzle/0020:206`), so the RLS suite cannot flip a site's status. The fixture file therefore comes from the owner (see Component / Page Plan).
- **Phase 4 start re-runs this check** (other pipelines will have merged): migration numbers 0065/0066 taken and 0067 still free; `ORG_FEATURE_CATALOG` and `org-feature-catalog.test.ts` (the toggle-only list is asserted by equality); `AUDIT_ACTIONS` and `audit.test.ts` (`EXPECTED_ENTRIES` is a frozen list); `SiteUrls` interface; `render-site-page.tsx` `liveSlots`; `presby-site-kit` version (v4.0.0 now).

## Component / Page Plan

**Create (public tree, flat files; none is a routable name):**
- `src/app/(public)/site/[slug]/public-events-calendar-slot.tsx`: async Server Component. Reads, branches on state, builds the model, renders the island with server-built panels, then the member prompt.
- `src/app/(public)/site/[slug]/events-calendar-model.ts`: pure. Month list between `firstMonth` and `lastMonth`, `groupByDay`, per-month legend, spacer count, current-month index (clamped), "earlier days" detection.
- `src/app/(public)/site/[slug]/events-calendar-panel.tsx`: Server Component for one month (see layout below).
- `src/app/(public)/site/[slug]/events-calendar-switcher.tsx`: the one `'use client'` island.
- `src/lib/calendar/public-contract.ts` (pure) and `src/lib/public-calendar.ts` (server-only), per Names.
- `src/lib/events/website-listing.ts` (pure).
- `drizzle/0067_presby_public_events_calendar.sql`.
- `scripts/public-calendar/test-rls-67.sql`, `scripts/public-calendar/seed-dev-public-calendar.sql` (owner fixture), `scripts/public-calendar/test-rls.sql.integration.patch` (one `\ir public-calendar/test-rls-67.sql`), following `scripts/person-emails/` and `scripts/session-approval/`. **Rule 16: `scripts/test-rls.sql`, `scripts/seed-dev.sql` and `drizzle/meta/_journal.json` are not edited mid-pipeline**; the orchestrator applies the patch and the journal entry at integration. The fixture gives Bramblewood and Fernwood a `live` site, the `org_portal.public_calendar` toggle on for both, and listed / unlisted / members-only / cancelled / out-of-window events for each; Alder Creek keeps its `provisioning` site with the toggle on and listed events (the "site not live" case).
- `src/app/(org)/o/[slug]/admin/events/series-website-listing.tsx`: client component, the "Website listing" section (two buttons, two `AlertDialog`s).
- Tests listed under Implementation Order, plus `e2e/public-calendar.spec.ts`, `e2e/hydration/public-events-calendar.spec.ts`, `e2e/support/public-calendar-fixture.ts` (events, types, toggle and bundle rows only; **no people**, so no person-id range is needed. If Phase 4 finds it needs people it stops and asks the orchestrator for a range under Rule 16).

**Modify:**
- `src/lib/db/domain/events.ts` (column, CHECK, comment).
- `src/lib/events.ts`: `EVENT_COLUMNS`, `EventListEntry`/`EventDetail`, `getEvent` (`seriesWebsite`), `createEvent`, `updateEvent`, `extendSeriesPattern`, new `setSeriesWebsiteListing`, the file header paragraph "NO AUDIT EVENTS ON ANY MUTATION HERE" (now false: rewrite it to name DECISION-240).
- `admin/events/actions.ts`: pass `actor` (extend `resolveActingIdentity` to return `email: session.user.email ?? null`), add the new action, rewrite the header paragraph "NO AUDIT WRITE ON ANY OF THESE FOUR ACTIONS" (stale after this change).
- `admin/events/event-schema.ts`: `websiteListed: z.boolean()` in `baseFields`.
- `admin/events/new-event-form.tsx`, `edit-event-form.tsx`: the checkboxes and hints (Copy E1–E4, E9). `defaultValues` gains `websiteListed: false` (new) or `event.websiteListed` (edit). A `useWatch` on `isPublic`: when unticked, `setValue("websiteListed", false)` and the website checkbox is `disabled`; the posted value is still re-derived server-side.
- `admin/events/events-list.tsx`, `[eventId]/page.tsx` (Copy E5–E7; mount `SeriesWebsiteListing` for a non-cancelled series event), `extend-series-form.tsx` (Copy E8; new prop `inheritsOnExtend`).
- `src/lib/org-features.ts` (catalog entry), `src/lib/audit.ts` (two keys), `src/lib/site-urls.ts` (`portalCalendar`), `src/lib/calendar/month.ts` (add generic `groupByDay`) and `(org)/o/[slug]/calendar/month-grid.tsx` (`groupEntriesByDay` delegates to it; importers untouched, as Phase 2 asked), `render-site-page.tsx` (the resolver; import the slot-name constant from the pure contract).
- Comments made stale: `src/lib/calendar.ts:61-62` ("it means "members only" vs. public-site visibility").

**Layout of the public calendar (the part most likely to be built wrong):**
- One DOM per month, not a grid plus a duplicate list. The island's wrapper sets `data-view="month|list"` and `data-earlier="hide|show"` and carries the Tailwind named group `group/cal`. Panels style off those attributes with `group-data-[view=…]/cal:` variants (Tailwind 4.3 supports them; `alert-dialog.tsx` already uses the form). All class names are written as full static literals (Tailwind scans source), no `<style>` element (`check:brand-scope`), no literal `<table>`.
- Below `md` (768px, matching the member calendar), or when `data-view="list"`: a vertical list of day sections that have events. At `md` and up in `month` view: a CSS grid, seven columns, weekday header row (`aria-hidden`), spacers for the leading weekday offset, every day of the month as a cell, empty days visible. Each day is `<section aria-label="Sunday, November 1, 2026">` with a heading (`h3`) whose full text shows in list view and which collapses to the day number in grid view (the full text stays for assistive technology). Today carries `aria-current="date"` and "(today)" in list view.
- Each event is a native `<details>`/`<summary>` (no JS, works before hydration, crawlable). The summary shows the time range and the title; **no `display` override on `<summary>`** (CLAUDE.md iOS caveat); layout lives on a `<span>` inside it; `min-height` of 44px. In list view the body flows inline. In grid view the body is an absolutely positioned card under the chip (cells in the last two weekday columns anchor right). If Phase 4 finds the card unworkable on a real browser, the permitted simpler fallback is the body expanding inside the cell; no ruling needed, note it in Implementer Notes. Body content: `Ends …` only when the end is on a later day (`describeWhen`), `Where:` location, `Event type:` name, then the description as plain text (`whitespace-pre-line`, React-escaped, no Markdown, no auto-links, no `dangerouslySetInnerHTML`). Titles use `[overflow-wrap:anywhere]` so an unbroken string cannot widen the page.
- Type colour comes from `typeColorClasses(typeColor)` (platform `--category-*` tokens, unaffected by a congregation's brand). The legend (per month, types present that month, sorted by name, swatch plus name) names every colour, so colour is never the only signal. No icons in v1, so `EventTypeIcon` stays where it is.
- "Show earlier this month" applies only to the current month panel: days before `org_today` in that month carry a marker; with `data-earlier="hide"` they are hidden in list layouts (below `md`, or `data-view="list"`) and always visible in the desktop grid. The toggle button and the "No more events are scheduled this month." line appear only when that panel has earlier days with events; the server passes a boolean to the island, not event data.
- The island holds `index`, `view`, `earlier` and nothing else. It receives `months: { key: string; label: string; panel: ReactNode }[]`, `initialIndex`, `currentIndex | null`, `initialView`, `hasEarlierInCurrent`. It never calls `new Date()`. Previous/Next/Today are `Button`s (≥44px), `disabled` until `useHydrated()` is true and at the window edges. The month heading is an `h2` in an `aria-live="polite"` region. Hidden panels use the `hidden` attribute. **No `location.hash` mirror** (declined; DECISION-241).

## Implementation Order

Two implementers, in order. database-admin owns the one piece where a mistake is a security defect and a review of the grants is the point; everything after it is tightly coupled UI, lib and tests.

**Batch 1 — database-admin (schema, definer, RLS suite).**
1. Create the Neon branch and `.env.local` in `presby-cal` (Rule 16, port 3500, `E2E_BASE_URL=http://localhost:3500` for every Playwright/`next dev`/`next start` run). Re-run the feasibility list above.
2. Write `drizzle/0067_…sql` and the `events.ts` domain changes. Apply with `psql` as the owner (the journal entry is the orchestrator's at integration).
3. Re-read on the branch, not from the DDL text: `pg_proc.proacl` and `proconfig` for the function (no PUBLIC execute; `presby_app` yes; `presby_platform` no; `search_path=public, pg_temp`), `pg_constraint` for the CHECK, `relforcerowsecurity` for `events` (F38/F152 drift class).
4. Write `scripts/public-calendar/` (RLS suite as `presby_app`, owner fixture, integration patch). `npm run check:schema-parity`, `npm run docs:erd`.

**Batch 2 — full-stack-developer (lib, catalog, audit).**
5. `ORG_FEATURE_CATALOG` entry; `AUDIT_ACTIONS` keys; `SiteUrls.portalCalendar()`; `public-contract.ts`; `website-listing.ts` and `groupByDay`; `public-calendar.ts` (reader and mapper).
6. `events.ts` write paths (derive, inherit, audit in-transaction), `setSeriesWebsiteListing`, `getEvent`'s `seriesWebsite`; actions. F251 and F252 regressions are written **first** and seen to fail.

**Batch 3 — full-stack-developer (editor surface).**
7. Schema, both forms, list, detail line, `SeriesWebsiteListing`, extend-form line; every string from Copy E1–E9 and F1–F2 only.

**Batch 4 — full-stack-developer (public surface and gates).**
8. Model, panel, island, slot; `render-site-page.tsx` wiring. Browser checks (below). e2e and hydration specs.
9. Gates: typecheck, `npm run check` (all eight), `npm run lint`, `npm test`, `npm run test:db` for the DB-backed files, `scripts/public-calendar/test-rls-67.sql` as `presby_app`, the new e2e specs with `E2E_BASE_URL` set.

**Phase 6 housekeeping (tech-lead, not the implementer):** release notes via `/release-notes` (version assigned at integration; the lines in Copy R are the starting text), the Rule 14 functionality-map edit (`docs/product/functionality-map.md` lines 23 and 79 both say `is_public` is "inert until Increment 4" / "reads `is_public`", which this change makes false), the Rule 10 TODO reconciliation below, and a Rule 13 what's-new advisory (editor-visible). `docs/architecture.md` is **not** touched (Rule 15): a fifth live slot on an existing mechanism is not an architectural change.

### Tests the implementer writes (QA runs them; Phase 2 Note 5 and more)

| ID | Test | File |
|---|---|---|
| T1 | Definer suite as `presby_app`: unlisted, members-only and cancelled rows never appear; toggle off, toggle row missing, site not live (Alder, `provisioning`), unknown slug and inactive org all return the identical `unavailable` row; org A's listed rows never appear for org B's slug (both directions); exactly one row always; the CHECK refuses `website_listed and not is_public` on insert and on update; PUBLIC has no EXECUTE, `presby_platform` has none, `presby_app` has; `search_path` pinned; event JSON keys equal the allow-list exactly and contain no `id`; window edges (a row at `first_month` day 1 is in, a row on the first day after the window is out); title/location/description clipped; `member_calendar_on` follows `org_portal.calendar` | `scripts/public-calendar/test-rls-67.sql` |
| T2 | Read-time veto independent of the CHECK: as the owner, inside a transaction, drop the CHECK, insert a listed members-only row, call the definer, assert absent, roll back | `src/lib/public-calendar.db.test.ts` |
| T3 | **Differential toggle test:** for both keys (`org_portal.public_calendar`, `org_portal.calendar`), every combination of axis flag (on/off/missing row) × category row (on/off/missing) × toggle row (on/off/missing), the definer's availability equals `orgFeatureEnabledInTx` (fixture org with `deletable_until`; the global axis flag is captured and restored in `finally`; run serially, as `npm run test:db` already does) | `src/lib/public-calendar.db.test.ts` |
| T4 | Truncation: 405 listed events in the window give `truncated`, ≤400 events, `last_month` = the month before the cut month, and no event in or after the cut month; a cut inside the first month gives `unavailable`; org zone: `Pacific/Kiritimati` and `Pacific/Pago_Pago` give `org_today` equal to the zone's date; the live driver returns `events_json` as an array | `src/lib/public-calendar.db.test.ts` |
| T5 | Pins: the migration text contains the literals `org_portal.public_calendar`, `org_portal.calendar`, `'worship'`, `org_portal.feature_categories`, `c_cap … 400`, `interval '1 month'`, `interval '13 months'` and the `DEFAULT_ORG_TIME_ZONE` literal, each equal to the TS constant or catalog value; both catalog entries have `category === "worship"` and `orgTypes === null` (an allow-list added later fails here and forces the SQL to follow); `isCategoryAxisOn` reads the same flag key as the SQL | `src/lib/public-calendar.test.ts` |
| T6 | Mapper narrowing field by field; malformed row, string `events_json`, bad month, over-cap, out-of-span events map to `unavailable`, never to an empty list; `ends_at` not after `starts_at` becomes null; unknown colour becomes neutral; the mapped object's keys equal the allow-list and `PublicCalendarEvent` has no `id` (`expectTypeOf`); reader: a thrown error returns `unavailable`, logs the slug only (assert the error text is absent from the log), non-slug input never reaches the database | `src/lib/public-calendar.test.ts` |
| T7 | `parseCalendarFilter`: exact values only, garbage and non-strings ignored, never throws | `src/lib/calendar/public-contract.test.ts` |
| T8 | Slot render per state: unavailable, nothing posted (with and without phone), empty month, events; hostile strings (`<script>`, `<b>x</b>`, a URL) render as text, not elements or links; no uuid-shaped string anywhere in the output; member prompt only when `memberCalendarOn`, its `href` equals `urls.portalCalendar()` exactly and has no `callbackUrl`; the filter `view` default | `public-events-calendar-slot.test.tsx` |
| T9 | Closure discipline: call `renderSitePage` with a mocked `renderSiteBundle`, invoke `liveSlots.eventsCalendar`, and with a custom-host key whose DB slug differs, assert the slot received the DB slug and `urls` only | `[[...path]]/page.test.tsx` (extend the existing closure test) |
| T10 | Model: month enumeration across the window, day grouping, legend uniqueness and sort, spacer count for a month starting on each weekday, 28/29/30/31-day months (Feb 2028), current-month clamp when truncation drops it, earlier-days detection | `events-calendar-model.test.ts` |
| T11 | Island: `renderToString` shows the first panel visible, others `hidden`, both arrows `disabled` (pre-hydration); after hydration the arrows work, Today returns, edge buttons disable, the edge note shows only on the last month, the view toggle flips `data-view`, no network call (fetch spy) and never constructs a `Date` (spy on `globalThis.Date`) | `events-calendar-switcher.test.tsx` |
| T12 | `website-listing.ts` pure rules: derive, plan (later-only, cancelled and members-only skipped and counted, unchanged), inherit (latest non-cancelled, none gives false) | `src/lib/events/website-listing.test.ts` |
| T13 | **F251 regression:** unticking "Open to everyone" on a listed event saves without a constraint error and clears the listing; a posted `websiteListed: true` with `isPublic: false` stores false. **F252 regression:** unlist "this and later" on a series whose parent is still listed, then extend; the new rows are not listed. Both written first and seen to fail | `src/lib/events.test.ts` |
| T14 | Audit exactly when the column changes, on all four paths (row present with the right action and metadata; absent on a no-op edit, on a cancel, on a forbidden call); the audit row rolls back with the change | `src/lib/events.test.ts` |
| T15 | Series counts: the confirm summary from `getEvent` equals the rows `setSeriesWebsiteListing` writes, for put and take, with cancelled and members-only rows mixed in; a foreign-org event id is `invalid_target`; no `events.manage` is `forbidden` and writes nothing | `src/lib/events.test.ts` |
| T16 | Catalog: the toggle-only list now has five entries and the pinned shape of the new entry; `EXPECTED_ENTRIES` gains the two audit keys | `org-feature-catalog.test.ts`, `audit.test.ts` |
| T17 | `SiteUrls.portalCalendar()` in slug and host modes | `site-urls.test.ts` |
| T18 | Forms and list: checkbox default unticked; ticking submits `websiteListed: true`; unticking "Open to everyone" disables and clears the website box; hints match Copy; list badge and detail line; `SeriesWebsiteListing` shows buttons by counts, dialog counts and pluralisation, passes `{ eventId, listed }`, toasts from the **returned** counts; extend line | the existing `*.test.tsx` beside each file, `event-schema.golden.test.ts` (`base` gains `websiteListed`) |
| T19 | e2e, platform host and custom host, at 360px and 1280px: toggle off shows the unavailable notice; toggle on and nothing marked shows "No events have been posted…"; a marked event, a members-only one and a cancelled one: only the first appears; month switching works after hydration; details open; no horizontal scroll (`scrollWidth <= 360`) including a 200-character unbroken title; arrows ≥44px; unpublish then reload removes it and the response `Cache-Control` has `no-store` or `no-cache`; editor flow (tick, save, appears; untick, gone); series panel dialog count equals rows changed; category axis on with `worship` off gives the notice | `e2e/public-calendar.spec.ts` |
| T20 | Hydration, both lanes (`npm run test:e2e` and `npm run test:e2e:prod`): JS chunks held, the list is in the HTML and both arrows are `disabled`; released, the arrows enable | `e2e/hydration/public-events-calendar.spec.ts` |

**Browser checks, not automatable (QA and the Phase 6 walk):** `<details>` opens and the summary taps on a real iPhone (CLAUDE.md iOS caveat); the desktop grid card at 1280px; both host modes at 360px on a phone viewport.

## Edge Cases & Risks

Each claim names its pin or says *unverified*.

- **Default exposure (G1).** Existing rows and new rows start unlisted. Pinned: T1 (unlisted absent), T13 (default false). The dev catalog had 15 of 16 events `is_public = true`; that is why the separate switch exists.
- **Members-only can never be listed.** Three independent conditions: the form clears and disables the box (T18), the lib derives (T13), the CHECK refuses (T1), and the definer re-filters (T2).
- **Routine edit trips the CHECK (F251).** T13.
- **Extend re-lists after an unlist (F252).** T13.
- **Cancelled.** Hidden by the read (T1). The stored flag stays true on a cancelled row; no code path clears `cancelled_at`, so it cannot reappear. Accepted residual F254, *paper*.
- **A failed read looks like "no events".** It cannot: a failure maps to `unavailable`, and an empty list needs a successful read. T6 (thrown error → `unavailable`), T3/T1 (identical unavailable row).
- **Time and "today" (G4).** Times are wall-clock text, no conversion. "Today" and the window come from SQL in the org's zone, never a browser or server clock. T4 (zone), T10, and the island never calls `new Date()` (T11 asserts no `Date` use by spying `Date.now`). An org that never set a zone gets America/New_York silently; no zone label is shown (Q7), so nothing false is printed. Pinned: T5 (default literal).
- **Out-of-window events and the 400-row cap.** Hidden, and the edge note says what the window shows, not what is planned. T4, T11.
- **Free text goes out verbatim (G6).** Residual accepted by the operator; stated in the form hint (E2), the series dialog and the release note. Plain text only: T8. Search engines and archives keep copies: stated in E2 and the dialogs.
- **Payload.** Worst case 400 events × (2,000 + 400 + type) characters ≈ 1 MB of HTML, reachable only by an authorised editor filling descriptions to the limit; typical use is a few tens of kilobytes. Accepted. *Unverified* beyond T4's row count (no size assertion).
- **Freshness (G11).** The site layout is `force-dynamic`; an unpublished event must vanish on the next load. T19 (reload after unlist; `Cache-Control`).
- **Closure discipline and custom hosts.** T9; e2e on `church-one.invalid` style host (T19). The island makes no request, so the custom-host `/api/*` 404 is irrelevant.
- **Enumeration.** `unavailable` is the same row for toggle-off, site-not-live, unknown slug and inactive org (T1). It discloses only a setting on a page anyone can already view. No event id exists to probe.
- **Redirect target.** The only outbound link is `portalCalendar()` on the platform origin, no visitor input. T8.
- **Audit completeness (DECISION-240).** T14 covers the four writers. A *future* writer that sets the column directly would escape it: the only code writers are these four, and the TypeScript field is written nowhere else (a grep in Phase 5 is cheap). *Paper* beyond that.
- **Series scope.** Counts equal rows written (T15). A concurrent edit between the confirm and the write changes the count; the toast reports the actual counts, not the confirm's. Rows are `FOR UPDATE` locked in the write transaction; the lock is *unverified* by test (no concurrency harness); a CHECK failure would roll the whole action back.
- **Turning the toggle on reveals earlier marks.** Editors may mark events while the toggle is off (the E2 hint says it appears "once … turned on"); flipping on shows all of them at once with no confirmation. Accepted residual F255, tracked in TODO.
- **Long names at 360px.** `[overflow-wrap:anywhere]` plus a 200-character unbroken title fixture. T19 (this is the claim that was false in invite-copy; it is pinned here by measurement, not asserted).
- **Phone-only defects.** `<details>` on iOS and the absolute card at desktop widths: browser checks above, *unverified in CI*.
- **DB blip on a page that carries the marker.** One extra definer call per view of such a page, no new endpoint, so no new rate limit is needed (Phase 1 Pass 5: nothing to abuse beyond what every public page already costs). A blip renders the notice and the rest of the page stands (the 2026-09-26 render-blip rule). T6.
- **Deployment.** `add column … default false` is metadata-only; the CHECK scans a small table once. Additive: rollback is the toggle, then unlisting, then `sites.public_render`; no data rollback.
- **Org types.** `orgTypes: null`, so a presbytery or synod with a live site can use it. T5 pins the null.

### e2e blast radius

- **Existing specs that exercise code this change touches (re-run in Phase 5; none asserts a string this change alters, grepped):** `e2e/member-calendar.spec.ts` (lines 294–300 open the new and edit event forms; sets `org_portal.events` itself), `e2e/public-sites.spec.ts` and `e2e/visual-parity.spec.ts` (`render-site-page.tsx` changes, no marker), `e2e/custom-domains/*` (same render path), `e2e/portal-home-cards.spec.ts` and `e2e/support/home-cards-fixture.ts:226` (insert events with named columns).
- **Existing unit tests this change breaks and the implementer must update:** `new-event-form.test.tsx:217-222`, `edit-event-form.test.tsx:208` (the old hint), `events-list.test.tsx:85-91` ("Public" becomes "Open to everyone"), `event-schema.golden.test.ts` (`base` and the tamper cases gain `websiteListed`), `[eventId]/page.test.tsx`, `events.test.ts` (every `createEvent`/`updateEvent`/`extendSeriesPattern` call gains `actor`), `admin/events/actions` tests, `org-feature-catalog.test.ts` (the toggle-only list equality, line ~57), `audit.test.ts` (`EXPECTED_ENTRIES`), `site-urls.test.ts`, `[[...path]]/page.test.tsx`.
- **Flags each new spec depends on, set by the spec through `e2e/support/flags.ts` (capture, set, restore; none goes into `e2e-baseline-flags.sql`):**
  - `public-calendar.spec.ts`: `sites.public_render` (on; it is in the baseline already, but the spec sets and restores it rather than relying on that), `org_portal.events` (on, for the editor cases), `org_portal.feature_categories` (on for the category case, restored). Per-org state (toggle row, category row, site status) is fixture rows the spec writes and removes, confirmed by SELECT.
  - `hydration/public-events-calendar.spec.ts`: `sites.public_render` (on).
  - **No key is added to `scripts/ci/e2e-baseline-flags.sql`.**

## Out of Scope (confirm with the user)

- A per-event page or URL; details open in place.
- iCal or "add to my calendar" (Q9, tracked).
- Type filters, search, venue filter on the public calendar.
- Sign-ups, RSVPs, capacity (Track A).
- A series-wide edit or cancel; only the website listing has a series action (Q8).
- A zone label (Q7); all-day events; multi-day events spanning day cells.
- An audience tier below "all members".
- The status line showing where the calendar appears (G9): deferred, below.
- A `location.hash` deep link to a month (Phase 2's optional suggestion; declined, DECISION-241).
- `website_listed_by` / `_at` columns and a partial index (Phase 2 suggestions; declined, DECISION-241).
- An "N events will go live" confirmation when the toggle is turned on (F255).
- Placing the block on the real church's events page: a cutover step for the site author in the private repo, not platform code.
- No `presby-site-kit` release.

## Copy

All user-facing strings. An implementer who needs a string not in this section stops for a ruling. Strings for the public calendar are in `{braces}` where data fills them. Non-engineer wording throughout.

### P — Public calendar (anonymous visitor; the slot)

| ID | String |
|---|---|
| P1 | "Our events calendar isn't available right now. Please check back soon." (toggle off, category off, site problem, or the read failed: one string, so the page never claims "no events" when it does not know) |
| P2 | "No events have been posted on this calendar yet. Please check back soon." and, only when the profile has a phone: "You can also call us at {phone}." |
| P3 | "Nothing is on the calendar for {Month Year}. Use the arrows to look at other months." |
| P4 | Region label "Events calendar". Buttons "Previous", "Next" (accessible names "Previous month, {Month Year}" and "Next month, {Month Year}"), "Today". Layout group label "Calendar layout" with buttons "Month" and "List" (desktop widths only). Weekday headers Sun…Sat. List-view day heading "{Sunday, November 1}" plus " (today)" on today. Legend heading "Event types". |
| P5 | "Show earlier this month" / "Hide earlier this month"; "No more events are scheduled this month." |
| P6 | (last month of the window) "This calendar shows events through {Month Year}." |
| P7 | "Church members: sign in to see the member calendar, which can include events not shown here." Button: "Member sign-in". |
| P8 | Event body labels "Where:" and "Event type:"; "Ends {Monday, November 2, 2026}, {9:00 AM}" only for a later-day end. |

### E — Event editor (`events.manage` holder, `/o/<slug>/admin/events/…`)

| ID | Where | String |
|---|---|---|
| E1 | New and edit form, new checkbox label | "Show on our website's public calendar" |
| E2 | Hint under E1 | "Anyone on the internet can read this event's title, description, location and event type. Search engines and web archives may keep copies, so taking the event off later does not remove copies already made. Leave out private details. It appears once your congregation's public events calendar is turned on." |
| E3 | Hint under E1 while "Open to everyone" is unchecked (box disabled) | "Only events open to everyone can be shown on the website." |
| E4 | Existing checkbox | Label "Open to everyone, not only members". Hint: "If unchecked, the event shows only on the member calendar, for members of {orgName} who have calendar access. It also stays out of Copy month and cannot be shown on the website." |
| E5 | List | Column values "Open to everyone" / "Members only" (header "Visibility" stays). Badge beside the title when listed and not cancelled: "For website". |
| E6 | Detail line | "{Open to everyone \| Members only}" then " · Marked for the website" when listed and not cancelled, then the existing " · Check-in enabled" / " · Cancelled". When marked, a muted line: "It appears on your public website once your congregation's public events calendar is turned on and your website has a calendar page." |
| E7 | Series section (any non-cancelled series event; each button only when it would change something) | Heading "Website listing". Intro: "Change this event and all the events after it in this series at once. To change only this event, use Edit event." Buttons "Put this and later events on the website" (when `put.changes > 0`), "Take this and later events off the website" (when `take.changes > 0`). If neither: "No later events in this series can be changed." Put dialog: title "Put {n} {event\|events} on the website?"; body "From {Sunday, October 4, 2026} on, {n} {event is\|events are} marked to appear on your public website's calendar. Anyone on the internet can read their titles, descriptions, locations and event types." plus, only for counts above zero, " {c} cancelled {event\|events} and {m} members-only {event\|events} are left out." (each clause only when its count is above zero); confirm "Yes, put {n} on the website", cancel "Keep as it is". Take dialog: title "Take {n} {event\|events} off the website?"; body "From {date} on, {n} {event\|events} will no longer appear on your public website. Search engines and web archives may already hold copies."; confirm "Yes, take {n} off the website", cancel "Keep as it is". Toasts (from the **returned** counts): "{changed} {event\|events} put on the website." with " {s} left out." appended when skipped is above zero; "{changed} {event\|events} taken off the website."; "Nothing needed to change." when changed is zero. Failure: the existing action errors, else "We couldn't save that change. Try again." |
| E8 | Extend-series form, only when `inheritsOnExtend` | "{n} new {event\|events} will be put on the website, like the latest one in this series." (before a valid number is typed: "New events will be put on the website, like the latest one in this series.") |
| E9 | Edit form, under E1, for a series occurrence | "This changes this event only. To change this event and the ones after it, use Website listing on the event's page." |

### F — Features page (`org_features.manage` holder)

| ID | String |
|---|---|
| F1 | Toggle name: "Public events calendar" |
| F2 | Description: "Shows the events your team has marked for the website on your public website. Only marked events appear. Whoever maintains your website must also place the calendar on a page." (Turning it on and off reuses the existing toasts "{name} turned on." / "{name} turned off.") |

### R — Release-note lines (starting text for Phase 6; written for non-engineers)

- A congregation's public website can now show an events calendar: a month grid on a computer and a list on a phone. It appears only on the page where whoever maintains the website has placed it.
- Nothing is public until someone chooses it. Every event, old or new, starts with the new box "Show on our website's public calendar" unchecked, and an administrator must also turn on the "Public events calendar" feature, which starts off.
- Events marked "Members only" can never be shown on the website, and cancelled events are not shown.
- Anyone on the internet can read a shown event's title, description, location and event type. Search engines and web archives may keep copies, so taking an event off the website does not remove copies already made. Please leave private details out of these fields.
- For a repeating event, a new "Website listing" section puts this event and all later ones on the website, or takes them off, in one step. Other edits to a repeating event still apply to one event at a time.
- The box that used to read "Visible on the public calendar" now reads "Open to everyone, not only members". Before this release it did not control anything on the website.
- Not included yet: subscribing to the calendar from a phone or Google Calendar, and a separate page for each event.

### The four checks, one line per string group

- **P (public).** *Residuals:* P1 uses one string for every non-serving cause, as DECISION-154 requires; nothing in P denies that free text is public or archived (the residual lives on the editor side, and P says nothing about privacy). P7 says "can include events not shown here" and never "all events". *Source of truth:* P1 asserts only unavailability (toggle composition, site status or a failed read, all collapsing in the definer or the reader's catch); P2 and P3 assert "no events on this calendar", established by a **successful** read whose `events_json` is empty for the window or the month, and the words say "this calendar", not "any"; P6 is `last_month`, which the function computes after truncation; P7 is `member_calendar_on` from the definer, and the wording hedges access ("church members", "can include"), because the read cannot know a visitor's permission; the phone is `organization_profiles.phone`. *Audience:* every P string is read by an anonymous visitor; "check back", "use the arrows", "call us", "sign in" are all things a visitor can do, and "Member sign-in" goes to a page that sends them to the platform sign-in. *Neighbours:* grepped `src` for "public calendar", "public website", "events" and "calendar" copy; the only public-tree strings about events are these, and the `eventList` block belongs to `presby-site-kit` content, not this tree, so none is made stale.
- **E (editor).** *Residuals:* E2, E7's dialogs and R state the crawl/archive residual and the free-text residual explicitly, so nothing denies them; the Phase 2 ruling that `is_public` is the veto is stated in E3 and E4. *Source of truth:* E5/E6 "For website" / "Marked for the website" are `events.website_listed` and `cancelled_at` on the row, and the words say marked, not live, because the row cannot know whether the toggle is on or the page exists (hence E6's conditional sentence, not an assertion); E7's counts come from `planSeriesListing`, the same function the write uses; E8's "like the latest one" is `inheritedListing`. The analyst's proposed badge "On the website" is **rejected** for exactly this reason. *Audience:* every E string is read by an `events.manage` holder (the page requires it). E2's "once your congregation's public events calendar is turned on" is a statement, not an instruction, because that holder may not hold `org_features.manage`; the only instructions are "Leave out private details" and "use Edit event / Website listing", both within `events.manage`. *Neighbours:* the stale strings the feature makes false, all modified here: `new-event-form.tsx:204-216`, `edit-event-form.tsx:179-187` (label and "It just stays off the public website"), `events-list.tsx:70-72` ("Public"), `[eventId]/page.tsx:125-129` ("Public"). Left alone because still true: the "Members only" values, `scripts/seed-dev.sql:~1914` ("not shown on the public website or in Copy month"), `docs/release-notes/v0.32.md:48`. Historical, not edited: `v0.18.md:81`, `v0.32.md:27`.
- **F (toggle).** *Residuals:* F2 does not claim the calendar shows every event ("Only marked events appear"). *Source of truth:* F2 is generic; it asserts nothing about this congregation's current state. *Audience:* read by an `org_features.manage` holder, who can do the one instruction ("whoever maintains your website must also place the calendar"), which is a request they make, not an action in the tool. *Neighbours:* the member-calendar toggle's description ("Shows the calendar of this organization's events to every member who has calendar access") stays true; the category-off line "Turn on {category} above to enable this" is the existing generic string, which the definer now honours (Phase 2 R2).
- **R (release notes).** *Residuals:* line 4 states the crawl/archive residual; line 2 states the default; nothing says "private" or "secure" about a shown event. *Source of truth:* each line is a property of the shipped code, pinned by T1/T13/T18. *Audience:* congregation administrators and clerks; each action named is theirs. *Neighbours:* the v0.18 and v0.32 notes said the checkbox would drive the website; line 6 corrects that.

## Carry-forward

| Phase 1 gap / Phase 2 ruling | Addressed here (where), or *deferred* (who accepted) |
|---|---|
| G1 "published" undefined | Operator Q1: new default-off switch, `is_public` veto. Data Model, API Contract (`derive`), T1/T2/T13 |
| G2 existing copy lies | Copy E1–E6; neighbours listed with file:line |
| G3 series-level switch; inheritance | `setSeriesWebsiteListing`, Series section E7; extend inherits from the latest non-cancelled occurrence (F252, T13) |
| G4 time zones | SQL `org_today` and window; no zone label (Q7); T4, T5 |
| G5 allow-list projection, no ids | Definer key list; `PublicCalendarEvent` has no `id`; T1, T6, T8 |
| G6 free text verbatim | E2, dialogs, R; plain-text rendering T8 |
| G7 sign-in prompt can lie | `member_calendar_on` + hedged P7; T3 |
| G8 empty vs failed vs off | `unavailable` state, P1–P3; T6 |
| G9 admin cannot tell where the calendar appears | *Deferred* (tech-lead, within Phase 2 R7's explicit latitude; **operator to confirm**). Reason: the walker must re-implement `presby-site-kit`'s defensive normalization of `PublishedSite.pages[].mdxAst` (typed `unknown`), and `getPublishedSite` collapses four causes into one miss, so the line could not truthfully say *why* nothing shows. F2 already tells the administrator the page needs the block, Q6 shows a notice (not a blank) if the toggle is off at a placed marker, and the cutover checklist covers placement. TODO line below. |
| G10 month navigation vs redline | R3, DECISION-239: pre-rendered window and island; no `?month=`, no JSON endpoint |
| G11 freshness | `force-dynamic` layout, no `cache` wrapper beyond React `cache()`; T19 |
| G12 cancelled | Hidden (Q4); F254 residual |
| G13 mobile, a11y, brand | Layout section; 44px targets; platform colour tokens; legend; T19, T20 |
| G14 Track K line 54 | Housekeeping at integration; exact replacement text below |
| Pass 5: redirect, state shortcuts, enumeration, input boundaries, hidden controls, XSS, cross-tenant, audit | Edge Cases; T1, T2, T8, T9, T13, T14 |
| Q1 | Operator: new switch (this design) |
| Q2 reuse `events.manage` | Permissions & Flags |
| Q3 self-service | Operator: `operatorEnabled: false` |
| Q4 hide cancelled | Definer predicate |
| Q5 window and navigation | 14 months, island, hard cap; R3 |
| Q6 notice, not blank, at a placed marker with the toggle off | P1 |
| Q7 no zone label | Copy |
| Q8 series scope | `setSeriesWebsiteListing` for "this and later"; single-event change through the edit form (a deliberate simplification of Phase 1 Flow 3's scope choice inside one form: two surfaces, same capability, no dual-mode FormData; operator may overrule) |
| Q9 iCal | *Deferred* (operator, Q9 on analyst default 2026-10-25). TODO line below |
| Q10 member prompt | Included, conditional; wording changed from "additional church events" to P7 because the read cannot establish that extra events exist |
| R1 switch, CHECK, definer re-filter | Data Model; the `_by/_at` columns and partial index declined, DECISION-241 |
| R2 one definer, one row, allow-list, gates in order, category axis inside, window and cap inside, mapper, `cache()`, RLS suite | API Contract; T1–T6 (the differential test T3 is the extra guard that the SQL composition cannot drift from `orgFeatureEnabledInTx`) |
| R3 months | Layout; hash mirror declined, DECISION-241 |
| R4 build new public components, reuse the pure layer | Component plan; `groupByDay` moved into `month.ts`; no `EventTypeIcon` move (no icons) |
| R5 series write path, derive, extend source | API Contract; T13–T15 |
| R6 audit | Audit table; T14 |
| R7 G9 | Deferred, above. The slot-name constant is still one exported constant (used by `render-site-page.tsx` and T9), so a later walker reuses it |
| DECISION-238 / 239 / 240 | Followed as proposed; DECISION-241 records the implementation calls |
| F250 giving config skips the category axis | *Deferred* (architect, Phase 2: out of scope; separate bug-fix pipeline). TODO line below |
| F251, F252 | Addressed: T13 |
| F253 `presby_app` holds DELETE on `events` | *Deferred* (architect, Phase 2: out of scope, *paper*). TODO line below |
| Note 1 names; pins | Names table; T5 |
| Note 2 filter | `parseCalendarFilter`, T7 |
| Note 3 copy | Copy section; the window-edge line says "shows events through", never "planned" |
| Note 4 Neon branch, re-read `proacl`/`pg_constraint`/`relforcerowsecurity` | Implementation Order 1–3 |
| Note 5 tests | T1–T20 |
| Note 6 housekeeping | Integration items below |
| Note 7 rollback | Toggle, then unlist, then `sites.public_render`; additive schema |
| Operator rulings 2026-10-25 | Q1, Q3 applied; Q2, Q4–Q10 on defaults as shown |

## Findings (this phase)

- **F254** (*paper*, accepted). Cancelling an event leaves `website_listed` true. The read filters `cancelled_at is null`, and no code path clears `cancelled_at`, so nothing can reappear. If an "uncancel" is ever added it must re-decide the flag. Pinned: T1 (cancelled absent).
- **F255** (accepted, tracked). Marking is allowed while the org toggle is off, and turning the toggle on shows every marked event at once with no confirmation. Mitigated by the E2 hint and F2; closing it needs a count read by an `org_features.manage` holder (a definer bare count, as `presby_giving_active_schedule_count` does) and an "on" dialog, which the OffWarning mechanism does not support today.
- **F256** (*paper*, accepted). Title, description and location length limits (200/2000/200) are enforced only in `src/lib/events.ts`; the table has no length CHECK. The definer clips to the same limits so a direct writer cannot inflate the public payload. T1 (clip).
- F257 is unused and available.

## DECISION-241 (draft for `docs/decisions.md`; the orchestrator writes it at integration)

**DECISION-241 — Public events calendar: the implementation shape.**

**Status:** Resolved (tech-lead, Phase 3) · **Date:** 2026-10-25 · **Feature:** `2026-10-25-public-events-calendar` (events Increment 4)

- **Names.** The column is `events.website_listed` (matching `public_listed` elsewhere, DECISION-131), the CHECK `events_website_requires_public`, the definer `presby_public_events_calendar(p_slug)`, the toggle `org_portal.public_calendar` (worship category, `orgTypes: null`, self-service), the slot `eventsCalendar`, the audit keys `event.listed_on_website` and `event.unlisted_from_website`.
- **The window and cap live in the function and are mirrored by named constants.** Previous month through 12 months ahead (14 months), 400 rows; on truncation the window shrinks to the last complete month, and a truncation that leaves none returns `unavailable`. A test pins the SQL literals to the TypeScript constants and to the catalog, so the SQL composition of the toggle, category axis and default zone cannot drift from `orgFeatureEnabledInTx` and `DEFAULT_ORG_TIME_ZONE`. A differential DB test compares the two over the whole axis × category × toggle matrix.
- **One DOM per month.** The panels are server-rendered once and laid out by CSS (a seven-column grid from `md`, a day list below, or the list everywhere by the visitor's choice); event details are native `<details>`. The client island holds only the active month index, the layout and the "earlier days" state, and receives panels, not event data. A `location.hash` mirror (Phase 2's optional suggestion) is declined: a deep link to a month is not needed to replace the old embed and adds a client-only effect to test; revisit if a church asks to link to a month.
- **Pure rules shared by the count and the write.** `deriveListed`, `planSeriesListing` and `inheritedListing` live in `src/lib/events/website-listing.ts`. A series is published or unpublished "this and all later" through `setSeriesWebsiteListing`, which locks the series rows; changing one event goes through the edit form. This replaces Phase 1 Flow 3's scope choice inside one form with two surfaces of equal capability, avoiding a dual-mode form value (DECISION-133). New occurrences inherit from the latest non-cancelled occurrence AND the parent's `is_public`.
- **Audit in the same transaction.** `insertAuditRow` (not `recordAudit`) on all four writers, one row per column-changing write, none for a no-op or a cancel. The lib functions take an `EventActor { userId, email }` so the row carries who did it.
- **Declined Phase 2 suggestions, with reasons.** `website_listed_by/_at`: the audit row is authoritative and nothing reads the columns; adding them later is additive. A partial index: the window is a bounded range scan on `events_org_starts_idx` and the table is small per organization; revisit if an `EXPLAIN` on a several-thousand-row organization says otherwise.
- **No off-warning and no on-confirmation for the toggle.** Rollback should be one click; the on-direction exposure is bounded by the per-event mark (F255 tracks the residual).
- **G9 (where-the-calendar-appears status line) is deferred**, with the reasons in the work-log's Carry-forward.
- **Revisit if** a church needs a month deep link, the payload for a busy organization is measured large, or a fifth writer of `website_listed` appears (it must audit).

## Integration items for the orchestrator (Rule 10, 14, 16)

Shared files not edited by the pipeline: `drizzle/meta/_journal.json` (entry for 0067), `scripts/test-rls.sql` (apply `scripts/public-calendar/test-rls.sql.integration.patch`), `docs/decisions.md` (DECISION-238, 239, 240 from the Phase 2 text, and DECISION-241 above), `docs/STATE.md`, `docs/TODO.md`, `docs/schema-design-2.md` if findings are folded there (F250–F256).

**`docs/TODO.md` lines to add** (checkbox style as the file uses):

```text
- [ ] **Bug-fix: `presby_public_giving_config` ignores the category axis (F250).** 0055's definer checks the `org_portal.giving` toggle row but not `org_portal.feature_categories` / the `giving` category, so the Features page can say "Turn on Giving above to enable this" while the public give page keeps serving. Latent while the axis flag is off. Compose the axis inside the function as `presby_public_events_calendar` does (DECISION-238) and add a differential test against `orgFeatureEnabledInTx`. — public-events-calendar Phase 2 F250
- [ ] **`presby_app` and `presby_platform` hold DELETE on `events` (F253, paper).** Contradicts the all-deletes-are-soft rule; a hard delete would remove a website-listed event with no unlisting audit row. No code path deletes events today. Revoke DELETE and add a grant-shape assertion to `test-rls.sql`, or write down why check-in needs it. — public-events-calendar Phase 2 F253
- [ ] **iCal / "add to my calendar" for the public events calendar (Q9).** The old Google Calendar embed let visitors subscribe; the new calendar does not. Needs its own design: a same-origin feed is blocked on custom hosts (every `/api/*` path 404s there), so it would be a site-rooted path with its own proxy allowance. — public-events-calendar Phase 1 Q9, Out of Scope
- [ ] **Public calendar: "where does the calendar appear" status line for administrators (G9, deferred).** Walk `getPublishedSite(slug).pages[].mdxAst` for the `eventsCalendar` liveSlot marker and say which page shows it, or that none does. Needs a defensive block walker equivalent to site-kit's `extractBlocks` and an honest wording for the four causes `getPublishedSite` collapses into one miss. Reuse `PUBLIC_CALENDAR_SLOT`. — public-events-calendar Phase 1 G9, Phase 2 R7, Phase 3
- [ ] **Public calendar: "N events will go live" confirmation when the toggle is turned on (F255).** Events can be marked while the toggle is off; turning it on shows them all at once. Needs a bare-count definer for `org_features.manage` holders and an on-direction dialog (the OffWarning registry is off-only). — public-events-calendar Phase 3 F255
```

**`docs/TODO.md` edits:** move line 51 (the public event calendar) to Done with the ship date and the SHIP verdict; **amend line 54 (Track K, G14)**, item (1), to read:

```text
(1) Visibility does not map one-to-one: fpcw `is_public=true` means everyone who signs in, and website publication is a separate `publish_to_google_calendar` flag. presby's `is_public` should come from fpcw `is_public AND NOT members_only` (so `is_public` keeps meaning "not members-only"), and presby's `website_listed` (migration 0067) from `publish_to_google_calendar AND is_public AND NOT members_only`; the CHECK `events_website_requires_public` refuses the reverse. Import only fpcw `kind = 'event'` rows: presby has no rooms, bookings or meeting kinds. Copying `is_public` across would put every members-visible event on the public website.
```

Line 597's note ("`is_public` present but inert until Increment 4") is history and is left.

**`docs/product/functionality-map.md` (Rule 14):** edit the events bullet at line 23 (Increment 4: public calendar via the `eventsCalendar` liveSlot, `events.website_listed`, `org_portal.public_calendar`, `presby_public_events_calendar`, migration 0067, DECISION-238–241) and the admin bullet at line 79 (the checkbox now reads "Open to everyone"; new website checkbox and series "Website listing"; remove "reads `is_public`").

**Starting conditions for Phase 4:** the pipeline waits behind the higher-priority pipelines; when it starts, create the worktree's Neon branch and `.env.local`, use port 3500, and re-run the feasibility list in Data Model first (the design was written against `ce661d7`; migrations after 0064 and several releases may have landed).

## Implementer

**database-admin** for Batch 1 (migration 0067, domain TypeScript, `scripts/public-calendar/` RLS suite and fixture, the `proacl`/`pg_constraint`/`relforcerowsecurity` re-read), then **full-stack-developer** for Batches 2–4 (lib, catalog, audit, editor surface, public slot and island, unit/DB/e2e/hydration tests, browser checks at 360px on both host modes). Reason for the split: the definer is the one artifact where a mistake is a disclosure, and its review is a distinct skill; everything after it is coupled TypeScript that one agent should hold end to end.

---

# Phase 4 — Implementation

## Phase 4 — Batch 1 (database-admin, 2026-10-25)

Commits on `pipeline/public-events-calendar`: `6c830ff` (feat, schema), `920ccac` (test, suite/fixture/DB tests). Neon branch `pipeline-public-events-calendar` only.

**Migration mode: hand-written.** `drizzle/0067_presby_public_events_calendar.sql`, applied as the owner with `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0067_presby_public_events_calendar.sql`. Idempotence proof: whole file applied, then re-applied whole; both exit 0; `events` 16 rows / 15 `is_public` / 0 `website_listed` before and after. Journal: **staged, not edited** (Rule 16): `scripts/public-calendar/_journal.json.integration.patch` adds `{ idx: 67, tag: "0067_presby_public_events_calendar", when: 1787705573186 }` (0064's `when` + 3 days, leaving room for 0065/0066). The orchestrator applies it at integration and renumbers if needed. **From-empty acceptance:** in a scratch `CREATE DATABASE` on the pipeline branch, with all three patches applied: `db:migrate` 65 rows (main's 64 journal entries + 0067; the newest ledger `created_at` is 0067's `when`), `check:schema-parity` 0 failing, `db:seed`, `seed-dev.sql`, `ci/db-baseline.sql`, test helpers, then the full patched `scripts/test-rls.sql` as `presby_app`: **exit 0, 1307 passes (58 in section 67), zero failures**. Re-applying 0067 and the fixture on top: still 1307. Scratch database dropped.

**Catalog re-read on the branch (F38/F152), not from the DDL:** `proacl = {neondb_owner=X/neondb_owner,presby_app=X/neondb_owner}` (identical to the other public definers); `has_function_privilege` public f / presby_platform f / presby_app t; `prosecdef` t, `provolatile` s, `proconfig {"search_path=public, pg_temp"}`, owner `neondb_owner`; `events_website_requires_public` `convalidated` t, `CHECK (((NOT website_listed) OR is_public))`; `events` `relrowsecurity`/`relforcerowsecurity` t/t, one `tenant_isolation` ALL policy; table grants unchanged.

### Files

- Created: `drizzle/0067_presby_public_events_calendar.sql`; `scripts/public-calendar/test-rls-67.sql`, `seed-dev-public-calendar.sql`, `test-rls.sql.integration.patch`, `seed-dev.sql.integration.patch`, `_journal.json.integration.patch` (all three patches `git apply --check` clean against main); `src/lib/public-calendar.db.test.ts`.
- Modified: `src/lib/db/domain/events.ts` (`websiteListed`, the CHECK, a comment on `isPublic`: "members-only veto, NOT website publication"). `npm run docs:erd` regenerated with no diff.

### Deviations from the design

1. **Fixture: Fernwood only, not Bramblewood.** Feasibility re-run: `scripts/giving/test-rls-46.sql` 46l (line 1098) asserts `presby_public_giving_config('bramblewood')` is byte-identical to `absent`, and a live site turns it into `unavailable`. Fernwood has no site-state assertion in `scripts/` or `e2e/`. Alder Creek stays `provisioning`. The second live org for both cross-tenant directions is in the Vitest file. A live site with no bundle still resolves `not_found` (`src/lib/sites.ts:414`), so `/site/fernwood` 404s as before. To browse the calendar in dev, Batch 4 needs a bundle that carries the marker.
2. **Fixture events are relative-dated and asserted only absent.** Six demo events at Fernwood, dated from the day the seed runs, so dev has something to show. The suite's positive and edge cases insert their own rows inside rolled-back transactions, so date drift cannot move an assertion. No Alder events are added, because sections 27 and 45 count them.
3. **Definer restructured, semantics unchanged.** The design allowed this ("the tests, not this text, are the contract"). One CTE with the listing predicate once, `row_number()`, and a `left join cut` replaces the reference body's aggregate `FILTER` with a scalar subquery. T5's pinned literals are kept verbatim: `c_cap  constant integer := 400;`, `'America/New_York'`, `interval '1 month'`, `interval '13 months'`, `'org_portal.public_calendar'`, `'org_portal.calendar'`, `'worship'`, `'org_portal.feature_categories'`.
4. **T1 is split between psql and Vitest.** `presby_app` cannot write `organization_sites` or `organizations`, and `organization_profiles.updated_by` needs a `users` row. So four cases moved to `src/lib/public-calendar.db.test.ts`: inactive org, a suspended site, both cross-tenant directions, and `contact_phone`. `neondb_owner` is a member of `presby_app` without the SET option, so `set local role presby_app` is refused. The file uses two connections instead: owner fixtures, then the definer on `db` with no GUC. T2 alone calls the definer inside the owner transaction that dropped the CHECK.
5. **T3 and T5 are left to Batch 2.** T3, the differential against `orgFeatureEnabledInTx`, cannot pass until `org_portal.public_calendar` is in `ORG_FEATURE_CATALOG`. T5 needs the TS constants. Batch 2 adds T3 to `public-calendar.db.test.ts`.

### For Batch 2 (full-stack-developer)

- **Invalid time zone.** If `organization_settings.time_zone` holds an invalid zone, the definer raises at `now() at time zone`. The reader's single `catch` then maps it to `unavailable`. That fails closed, and T6's thrown-error case covers it.
- **`events_json` shape.** The driver returns `events_json` as an array (pinned in the DB suite). Each element has exactly the seven keys. Absent fields are JSON `null`, and the key is still present.
- **Apply locally:** `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0067_presby_public_events_calendar.sql`, then `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/public-calendar/seed-dev-public-calendar.sql`. Both are already applied on this pipeline branch.

### Tests (failing-first)

- **`scripts/public-calendar/test-rls-67.sql` (new section 67; T1):** 58 assertions as `presby_app`, exit 0. Each mechanism was broken on the branch and the suite went red at the named line, then 0067 was re-applied:

  | Mechanism broken | First failing assertion |
  |---|---|
  | CHECK dropped | `:82` 67a CHECK. Run alone, 67b fails with "FAIL 67b - presby_app inserted a listed members-only event" |
  | `grant execute … to public` | `:109` 67a PUBLIC |
  | Category axis ignored | `:217` 67c axis |
  | Cancelled filter removed | `:292` 67d never-appear |
  | `website_listed` filter removed | `:292` 67d never-appear |
  | An `id` key emitted | `:303` 67d allow-list |
  | Clipping removed | `:351` 67e |
  | Provisioning sites served | `:192` 67c gate 2 |
  | Missing toggle row treated as on | `:204` 67c |
  | Missing member-calendar row treated as on | `:386` 67g |
  | Window +14 months | `:276` 67d window |

- **`src/lib/public-calendar.db.test.ts` (T2, T4, rest of T1):** 13/13. Each mutation turned exactly one test red. Removing the `is_public` re-filter broke T2. Removing the active-org gate broke gate 1. Setting the cap to 401 broke the first-month cut. Reading "today" in the default zone broke Kiritimati. That last run showed a time-of-day gap: Kiritimati and Pago Pago each share New York's date for part of the day. A 25-hours-apart assertion was added and confirmed red under the same mutation.
- **Full `scripts/test-rls.sql` on the dev-lineage branch,** as a non-stopping copy with section 67 appended (the person-emails precedent): 1298 passes. The failures are only the known drift: line 217 (untracked membership), line 516 (2FA definer, previously 505) and line 7927 (statistics.publish, previously 7916). 46i and 46j now pass. None touches events, sites or Fernwood.

### Gates

| Gate | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run check` | exit 0, all eight tripwires |
| `npm run check:schema-parity` | 85 tables, 0 failing |
| Plain `npm test` | 542 files passed, 78 skipped; 8322 tests passed |
| Events-adjacent DB suites (`event-types`, `events`, `calendar`, `org-provisioning`, `public-calendar.db`; `--no-file-parallelism`) | 5 files, 277 tests passed |

No audit events (schema only). No strings added or changed.

**Next:** full-stack-developer, Batch 2: catalog entry, audit keys, `SiteUrls.portalCalendar()`, contract/reader/mapper, T3/T5, then the `events.ts` write paths. Batch 2 should begin with the F251/F252 regressions, written first and seen to fail.

## Phase 4 — Batches 2–4 (full-stack-developer, 2026-10-25)

Commits on `pipeline/public-events-calendar`: `6888ca8` (feat, lib + catalog + audit + editor surface), `65116ea` (feat, public slot, island, wiring), `a5d9444` (test, e2e + hydration specs + fixture + optional dev bundle), `703628d` (test, give fall-through mock). No schema change (Batch 1 owns 0067). Neon branch `pipeline-public-events-calendar`; dev server on :3500 started by me and stopped by PID at the end.

### Files created

- Lib / pure: `src/lib/calendar/public-contract.ts` (+ test), `src/lib/public-calendar.ts` (+ `public-calendar.test.ts`: T5 pins, T6 mapper and reader), `src/lib/events/website-listing.ts` (+ test, T12).
- Editor: `admin/events/website-listing-copy.ts` (every editor string, one place), `series-website-listing.tsx` (+ test).
- Public: `(public)/site/[slug]/public-events-calendar-slot.tsx`, `events-calendar-model.ts`, `events-calendar-panel.tsx`, `events-calendar-switcher.tsx`, each with a test (T8, T10, T11).
- e2e: `e2e/support/public-calendar-fixture.ts`, `e2e/public-calendar.spec.ts`, `e2e/custom-domains/public-calendar.spec.ts`, `e2e/hydration/public-events-calendar.spec.ts`.
- `scripts/public-calendar/seed-dev-bundle.sql`: OPTIONAL, run by hand, NOT included by the seed-dev patch. It gives Fernwood's live site a bundle carrying the `eventsCalendar` slot so `/site/fernwood` can be browsed in dev (Batch 1's "needs a dev bundle" note).

### Files modified

`src/lib/events.ts` (derive, inherit, in-transaction audit on four paths, `setSeriesWebsiteListing`, `getEvent`'s `seriesWebsite`, header paragraph rewritten), `admin/events/actions.ts` (actor, new action, stale audit paragraph rewritten), `event-schema.ts`, both forms, `events-list.tsx`, `[eventId]/page.tsx`, `extend-series-form.tsx`, `src/lib/org-features.ts` (catalog entry), `src/lib/audit.ts` (two keys), `src/lib/site-urls.ts` (`portalCalendar()`), `src/lib/calendar/month.ts` (`groupByDay`; `(org)` `groupEntriesByDay` delegates), `src/lib/calendar.ts` (stale comment), `render-site-page.tsx` (the `eventsCalendar` resolver), `src/lib/public-calendar.db.test.ts` (T3). Existing tests updated for the new signatures and strings: `events.test.ts`, `audit.test.ts`, `org-feature-catalog.test.ts`, `site-urls.test.ts`, `month.test.ts`, the events-admin component and schema tests, `[eventId]/page.test.tsx`, `[[...path]]/page.test.tsx` (T9 and a host-mode case), `give/fall-through.test.tsx` (mocks the new reader).

### Schema / audit / env

No schema change. New `AUDIT_ACTIONS`: `event.listed_on_website`, `event.unlisted_from_website`, written with `insertAuditRow(tx, ...)` in the same transaction as the change on `createEvent`, `updateEvent`, `extendSeriesPattern` and `setSeriesWebsiteListing`; none for a no-op, a cancel or a forbidden call. No new env var. No `FEATURES` entry. No new platform flag. One `ORG_FEATURE_CATALOG` entry: `org_portal.public_calendar` (toggle-only, provisioned off, self-service, `worship`, `orgTypes: null`).

### Actions, gates

| Signature | Auth / gate |
|---|---|
| `setSeriesWebsiteListingAction(slug, { eventId, listed })` | `auth()` then `resolveOrgContext`; `events.manage` inside the lib transaction; org id never from the form |
| `createEventAction`, `updateEventAction`, `extendSeriesPatternAction` | unchanged gates; now pass `EventActor { userId, email }` |
| `readPublicCalendar(slug)` / `presby_public_events_calendar` | anonymous; site live and the toggle composed inside the definer |

### Deviations from the design (small, each named)

1. **Series dialog grammar.** E7's left-out sentence is "are left out"; for exactly one left-out event it reads "is left out" (otherwise "1 cancelled event are left out"). Same string family, no new wording.
2. **`seriesWebsite` is null for a series of fewer than two rows** (a parent with `recurrenceCount` 1 and no children), so no "Website listing" section is offered where the edit form already covers it. `setSeriesWebsiteListing` itself still works on a standalone event (a series of one); the UI does not offer it.
3. **`updateEvent`'s UPDATE is also scoped by `organization_id`** (it was by id only); behaviour unchanged for a legitimate call.
4. **The sign-in button needs `text-primary-foreground!`.** The site stylesheet (`presby-site-kit/styles.css`) sets `.presby-site a { color: var(--primary) }`, which outranks a utility class and painted the button label the colour of its own background (found in the browser, not by a test). Any future link-styled-as-button inside a live slot has the same trap.
5. **The desktop detail card worked as designed** (absolute, under the chip, right-anchored in the last two weekday columns); the permitted in-cell fallback was not needed.
6. **e2e fixture world.** The throwaway `e2e-pubcal-<stamp>` congregation carries no people. The editor flow reuses the existing e2e-alpha clerk through `calendar-fixture.ts` and gives e2e-alpha a temporary live site (refused if a site row already exists, removed and confirmed in teardown). No person-id range was needed; no `e2e/support/*` file that already existed was edited.
7. **T11's "never constructs a Date" is a source scan, not a runtime spy.** React's scheduler and the test renderer construct Dates, so a spy cannot tell them from the island's reads (the spy fired 3 times with no island code involved). The scan bans `Date`, `performance`, `fetch`, `XMLHttpRequest`, `location` and `window` in the island's source, and a separate test asserts no `fetch` during any interaction.

### Tests (failing-first where specified)

- **F251 and F252 were written first and seen red for the right reasons**: F251 failed with Postgres `23514` on `events_website_requires_public` (the routine edit tripping the CHECK); F252 failed with `[true, true, true]` against `[false, false, false]` (extend re-listing after a "this and later" unlisting). Then fixed and green.
- **T3 mutation check**: making a missing category row read as OFF in the definer turned the differential test red at `axis=on category=missing public=on member=on: public_calendar: expected false to be true`; the file was re-applied afterwards. 81 combinations, both keys.
- **T20 negative control**: removing `!hydrated ||` from the Next button turned both hydration cases red (`toBeDisabled`); restored.
- T5 (pins), T6 (mapper, reader, log shape), T7, T8, T9, T10, T11, T12, T13 to T15, T16, T17, T18 as in the design table; T19 and T20 in the three e2e files.

### Gates

| Gate | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run check` | all eight tripwires pass |
| plain `npm test` | 549 files passed, 78 skipped; 8448 tests passed |
| DB-backed (`--no-file-parallelism`): events, public-calendar.db, calendar, event-types, org-provisioning, org-features, org-feature-categories, org-feature-warnings.db, sites, sites-render-fail-closed | 10 files, 434 tests passed |
| `scripts/public-calendar/test-rls-67.sql` as `presby_app` | exit 0, no FAIL |
| `npm run build` | passes |
| e2e on :3500, chromium: `public-calendar`, `hydration/public-events-calendar`, `member-calendar`, `public-sites`, `portal-home-cards` | 51 passed |
| e2e on :3500, custom-hosts project: all `custom-domains/` | 111 passed (8 are the new spec) |
| prod lane (`PW_PROD_BUILD=1 PW_PROD_PORT=3501`, `prod-build` project) hydration spec | 2 passed |

Fixture cleanup confirmed by SELECT: no `e2e-pubcal-*` organization, no `pubcal` site row, no `E2E Editor flow` event left; `sites.public_render`, `org_portal.events` and `org_portal.feature_categories` back at their captured values.

### Browser checks (real Chromium)

- **360px, platform host and a custom-host simulation** (`pubcal-church.invalid`): list layout, `scrollWidth` 360 including the 200-character unbroken title, arrows and summaries at least 44px, `<details>` opens by tap, the new-event form and the members-only state of its two boxes fit. Screenshots read for the Fernwood page and the editor form.
- **1280px**: seven-column grid, today ringed, an event's card opens over the neighbouring cells, List button flips the layout.
- **Not done**: a real iPhone (`<details>` and the 360px look on iOS Safari), and the e2e-visible "payload" size in production. Dev HTML for a Fernwood page is about 840 KB because Next streams every month panel twice (HTML and flight data); the production figure was not measured. The design accepts a payload of this order; QA may want a production number.

### Strings added or changed

Editor: `admin/events/website-listing-copy.ts` (E1 to E6, E8, E9), `series-website-listing.tsx` (E7), both forms and the list/detail page use them. Public: `public-events-calendar-slot.tsx` (P1, P2, P7), `events-calendar-panel.tsx` (P3, P4 legend and weekday headers, P5 "No more events...", P8 "Where:" / "Event type:"), `events-calendar-switcher.tsx` (P4 buttons, P5 toggle, P6 via the model). Features page: `org-features.ts` entry (F1, F2). Every string is in the design's Copy table; deviation 1 is the only wording variant.

### For QA and the next phase

- **Next agent: qa (Phase 5).** Run the specs above against your own server with `E2E_BASE_URL`; the custom-host spec needs the `DOMAINS_*` test env on the server (`playwright.config.ts` documents it; I started mine with `RATE_LIMIT_DISABLED=true STRIPE_WEBHOOK_SECRET=giving-e2e-signing-secret DOMAINS_ALLOW_RESERVED_TLDS=1 DOMAINS_PROVIDER=fake DOMAINS_DNS_PROVIDER=fake DOMAINS_FAKE_STATE_FILE=<repo>/.tmp/domains-fake-state.json CRON_SECRET=giving-e2e-cron-secret`).
- **Browser-only checks left for QA / Phase 6:** iOS `<details>`; both host modes at 360px on a real phone.
- **Copy-truthfulness anchors:** "Marked for the website" and "For website" say what the row says (`website_listed` and not cancelled), not that it is live; the E2 hint and F2 are the only places that name the toggle and the page placement; the public sentences make no claim about "all events".
- **Integration items (orchestrator, Rule 16)** are unchanged from the design list plus: nothing new in shared files. The optional `seed-dev-bundle.sql` is deliberately not in the seed-dev patch.

## Files, schema, audit (filled in at loop-back 1; QA N4)

- **Created:** `drizzle/0067_presby_public_events_calendar.sql`; `src/lib/public-calendar.ts` (+ tests), `src/lib/calendar/public-contract.ts`, `src/lib/events/website-listing.ts`; `series-website-listing.tsx` and `website-listing-copy.ts` under `admin/events/`; the public slot, panel, switcher and model under `src/app/(public)/site/[slug]/`; `e2e/public-calendar.spec.ts`, `e2e/custom-domains/public-calendar.spec.ts`, `e2e/hydration/public-events-calendar.spec.ts`, `e2e/support/public-calendar-fixture.ts`; `scripts/public-calendar/*` (RLS section 67, seeds, integration patches).
- **Modified:** `src/lib/events.ts` and `src/lib/db/domain/events.ts` (the `website_listed` column, derivation, the series writer), `src/lib/audit.ts`, `src/lib/org-features.ts`, `src/lib/site-urls.ts`, `src/lib/calendar.ts`, `src/lib/calendar/month.ts`, `render-site-page.tsx`, the event forms, list, detail page and actions under `admin/events/`. The full list is `git diff --name-status main...HEAD`.
- **Schema:** migration 0067 (the `events.website_listed` column, its CHECK, `presby_public_events_calendar()`), hand-written and applied with `psql` to the pipeline branch (Batch 1).
- **Audit events:** `event.listed_on_website` and `event.unlisted_from_website`, written in the same transaction as the change by the four writers (DECISION-240).
- **Strings added or changed:** see "Strings added or changed" above, and Phase 3 amendment 1 for the three rewordings (E7 toasts, E8, P2).

---

# Phase 5: Verification (qa)

**Date:** 2026-10-25
**Verified by:** qa
**Branch / HEAD:** `pipeline/public-events-calendar` at `8a56f06`. The merge-base with main is `ce661d7`, and `origin/main` is 31 commits ahead. No file overlaps this diff, but see Notes N6.
**Database:** the Neon branch `pipeline-public-events-calendar` only.

**Scope I ran:**
- **Full:** typecheck, lint, `npm run check`, plain `npm test`, `npm run build`.
- **Full DB-backed Vitest set** (`npm run test:db`). The diff adds migration 0067, so the whole set was required.
- **RLS:**
  - section 67 run standalone as `presby_app`;
  - the full `scripts/test-rls.sql` with the staged integration patch applied, in a scratch copy;
  - main's suite run on the same database, as the drift baseline.
- **e2e:**
  - the full `--project=chromium` suite (the diff adds a file under `e2e/support/`);
  - the full `custom-hosts` project;
  - the production lane (`npm run test:e2e:prod`, which runs the `prod-build` and `prod-custom-hosts` projects) on :3501;
  - every calendar spec re-run with each test forced to 360px.
- **Other checks:** a scratch Playwright walk of the editor at 360px, my own adversarial probes against the database and the HTML, payload measured on `next start`, and failing-first checked by mutation.

**Flag state:** before any e2e run I reset the global flags to the CI baseline. The command was `psql "$PLATFORM_DATABASE_URL" -v ON_ERROR_STOP=1 -v pipeline_branch=1 -f /Users/cshenso/git/presby-platform/presby/scripts/ci/e2e-reset-flags.sql`, using main's copy, against this branch's database only.
- It set 39 seeded flags back to their seed values.
- The branch had been polluted: 28 flags were on, including `org_portal.events` and `sites.public_staff_directory`.
- The flag state from before the reset is saved at `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/qa/flags-before.txt`. Anyone browsing dev on this branch will now see baseline flags.

**Environment incident:** my first chromium run on :3500 is discarded (2 failures, then aborted).
- **Cause:** `next.config.ts` sets `turbopack.root` to the parent directory (`presby-platform/`). Another pipeline (`presby-padmin`) was writing test results and `tsbuildinfo` there at the same moment, so my dev server went into a Fast Refresh full-reload loop and `/signin` never hydrated.
- **Not this branch's defect.** It is a Rule 16 hazard for parallel pipelines and is worth a TODO line.
- **What I did:** I re-ran from a byte-identical isolated copy of HEAD (`git archive HEAD`, same `.env.local` and the same server env) on :3500. All results below come from that server. I stopped it by PID and deleted the copy afterwards.

## Type Check

`npm run typecheck`: **PASS** (exit 0).
- `npm run lint`: PASS (`--max-warnings=0`).
- `npm run check`: PASS, all eight tripwires.
- `npm run build`: PASS. `node_modules/node_modules` was absent before the build.

## Unit Tests

| Run | Files | Tests | Duration | Notes |
|---|---|---|---|---|
| Plain `npm test` | 549 passed, 78 skipped | 8448 passed, 2475 skipped | 25.8s | The skips are the DB-backed files (`describe.skipIf(!hasDb)`), as designed. |
| `npm run test:db` (all files, `--no-file-parallelism`) | 627 passed | 10922 passed, 1 skipped | 36m | The one skip is `it.skipIf(!process.env.STATEMENT_SAMPLE_DIR)`. It is a pre-existing manual generator, unrelated to this change. |

Failures: none.

**RLS suite (as `presby_app`):**
- I confirmed the connection role is `presby_app` and that `rolbypassrls = f`.
- `scripts/public-calendar/test-rls-67.sql` standalone: exit 0, 58 passes, 0 FAIL.
- The full `scripts/test-rls.sql` with `test-rls.sql.integration.patch` applied (scratch copy, non-stopping): 1298 passes. Section 67 passed 58 of 58 with 0 errors.
  - There were 3 failures, at `test-rls.sql:217` (presbytery members, expected 2, got 3), `:516` (2FA definer) and `:7927` (statistics.publish, expected 1, got 2).
  - **These are pre-existing, not regressions.** `origin/main`'s `test-rls.sql`, run against this same database, fails at the same three lines (1240 passes; 1240 + 58 = 1298). They are data drift on the branch, and Phase 4 reported the same three.

## End-to-End Tests

| Run | Total | Passed | Failed | Skipped | Duration |
|---|---|---|---|---|---|
| `--project=chromium`, dev server :3500 | 430 | 430 | 0 | 0 | 17.9m |
| `--project=custom-hosts`, :3500 | 111 | 111 | 0 | 0 | 4.1m |
| Production lane (`PW_PROD_PORT=3501 npm run test:e2e:prod`) | 78 | 78 | 0 | 0 | 2.8m |
| Calendar specs forced to 360px (scratch config, worktree specs unchanged) | 24 | 24 | 0 | 0 | 48s |

- **Pipeline specs:** all green on every lane. That covers `public-calendar.spec.ts` (16), `custom-domains/public-calendar.spec.ts` (8), and `hydration/public-events-calendar.spec.ts` (2 on dev, 2 on the production build).
- **Blast-radius specs**, all green inside the full run: `member-calendar`, `public-sites`, `portal-home-cards`, and the `custom-domains/*` specs.

**Real-browser 360px check** (Chromium mobile emulation; I read the screenshots):
- **Public page, platform host:** a list layout and `scrollWidth` 360, including the 200-character unbroken title. `<details>` opens in place, and the controls are at least 44px.
- **Public page, custom-host simulation** (`*.invalid`): the same.
- **Editor, new-event form** (`scrollWidth` 360): the website box and its hint are correct. In the members-only state the box is disabled and unticked, with "Only events open to everyone can be shown on the website."
- **Series dialogs:** they fit the screen.
- **Event detail page:** fails. See FAIL-1.
- **Not verified:** a real iPhone (`<details>` on iOS Safari). That stays with the Phase 6 walk.

Failures: see FAIL-1 below. No spec failed, because no spec measures the detail page at 360px.

## Regression Tests Added

Failing-first was verified by mutation in a scratch copy of HEAD; the worktree was untouched. I put the pre-fix behaviour back in and watched each test go red, then green on the unmutated code.

- **`saves without a constraint error and clears the listing in the same statement - regression for F251`** (`src/lib/events.test.ts:1255`)
  - Guards against: the CHECK being tripped by a routine "Open to everyone" untick.
  - Mutation: drop `websiteListed: listed` from `updateEvent`'s SET (the pre-fix shape).
  - Result: red with Postgres `23514 events_website_requires_public`.
- **`new occurrences inherit from the LATEST occurrence, not the parent row - regression for F252`** (`src/lib/events.test.ts:1279`)
  - Guards against: extend re-listing a series after a "this and later" unlisting.
  - Mutation: inherit from `parent.websiteListed && parent.isPublic`.
  - Result: red, `expected [ true, true, true ] to deeply equal [ false, false, false ]`.
- **Implementer-side checks:** the implementer's own mutation checks on T1, T2, T3 and T20 are recorded in Phase 4. I re-ran those suites green and did not repeat the mutations.

## Coverage on Critical Modules

- `src/lib/permissions.ts`: 100% (untouched by the diff).
- `src/lib/two-factor.ts`: 91.3% statements (untouched).
- `src/lib/flags.ts`: 100% (untouched).
- New modules:
  - `src/lib/public-calendar.ts`: 100% statements, 98.6% branches.
  - `src/lib/events/website-listing.ts`: 100% statements, 88.5% branches.
  - `src/lib/calendar/public-contract.ts`: 100%.
  - `events-calendar-model.ts`: 100% statements, 93.9% branches.

## Feature-Gate Audit

Verified by reading the action and lib bodies, not from green tests. Tenant authorization here is `presby_has_permission(..., 'events.manage')` (`hasEventsManage`), not `hasFeature(FEATURES.*)`. `permissions.ts` is platform-only and frozen, and none of these routes are platform-shell routes.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct key? |
|---|---|---|---|
| `setSeriesWebsiteListingAction` (new) | yes, via `resolveActingIdentity`, then `resolveOrgContext` | n/a (tenant) | `events.manage` checked first inside the `withOrgContext` transaction (`events.ts:941`). The organization id never comes from input. A non-UUID id is `invalid_target`; a non-boolean `listed` is `invalid_input`. |
| `createEventAction`, `updateEventAction`, `extendSeriesPatternAction` (changed: pass `EventActor`) | yes | n/a | `events.manage` in the lib (`events.ts:506`, `661`, `785`). The gates are unchanged. |
| `admin/events/[eventId]/page.tsx` (mounts the Website listing section) | yes | n/a | `getEvent` requires `events.manage` (`events.ts:364`). |
| `presby_public_events_calendar` / `readPublicCalendar` (anonymous by design) | n/a | n/a | Site live, then the toggle, then the category axis, all inside the definer. Probed below. |

Pre-existing and unchanged: these actions do not re-check the `org_portal.events` platform flag server-side. The pages do.

## Schema/RLS Audit (live catalog, pipeline branch)

- **`proacl`** = `{neondb_owner=X/neondb_owner,presby_app=X/neondb_owner}`. `aclexplode` shows no PUBLIC grantee. `has_function_privilege` gives `presby_app` t and `presby_platform` f. Also `prosecdef` t, `provolatile` s, `proconfig {"search_path=public, pg_temp"}`, owner `neondb_owner`.
- **The CHECK:** `events_website_requires_public` has `convalidated` t, `CHECK (((NOT website_listed) OR is_public))`. The column is `boolean not null default false`.
- **RLS:** `relrowsecurity` and `relforcerowsecurity` are t/t on `events`, `event_types`, `organization_feature_toggles` and `organization_sites`. `events` has one `tenant_isolation` ALL policy and no user triggers. Table grants are unchanged (F253's DELETE for `presby_app`/`presby_platform` is still present; tracked).
- **Which layer refuses what:**
  - **Members-only listing:** the **CHECK constraint** refuses it, on both connections. As `presby_app` it is 67b. As the owner (`neondb_owner`, the `getPlatformDb()` role) I ran a probe insert of `website_listed=true, is_public=false` in a rolled-back transaction, and it was refused with `check_violation` (23514). So the CHECK, not a grant, an RLS policy or a trigger, is what holds on the owner path.
  - **The definer re-filter:** T2 drops the CHECK and confirms the read still excludes the row.
  - **Tenancy:** as `presby_app` with no GUC, `select count(*) from events` returns 0. The definer reads through, and its event objects carry exactly the keys `{description,ends_at,location,starts_at,title,type_color,type_name}`.

## Adversarial checks (mine, against :3500 and the database)

- **Never shown.** I fetched Fernwood's raw HTML with curl, which includes the RSC flight data. The listed, in-window titles are present. Absent are the members-only "Session stated meeting", the cancelled "Bake sale" (which is listed), the unlisted "Building committee", and the far-future (out-of-window) "Anniversary service". There are no uuid-shaped strings at all: no event id, no org id. None of `website_listed`, `is_public`, `allows_checkin`, `created_by` or `parent_event_id` appears.
- **"Isn't available" states.**
  - Toggle off: the P1 notice, and no events.
  - Category axis on with worship off: the P1 notice, and no events.
  - Site suspended: a 404 for the whole site, with no events in it.
  - Each state was restored afterwards and confirmed by SELECT.
  - From the definer as `presby_app`: `alder-creek` (toggle on, site `provisioning`), an unknown slug and `bramblewood` all return `unavailable`, with every other column null.
- **Cross-org.** Only Fernwood has listed events on this branch. Both cross-tenant directions with two live sites pass in `public-calendar.db.test.ts`.
- **Closure discipline.** I read `render-site-page.tsx`. The resolver closes over the DB-returned `slug` and `urls` only. T9 and the host-mode case pass.
- **Freshness.** `Cache-Control` is `no-store` on dev. On `next start` it is `private, no-cache, no-store, max-age=0, must-revalidate`. The reload-after-unmark spec passes.
- **Writers of `website_listed`.** I grepped for them. There are exactly four code writers (`createEvent`, `updateEvent`, `extendSeriesPattern`, `setSeriesWebsiteListing`), plus fixtures.

## Payload (measured on `next start`, Fernwood, against the design's Edge Cases)

| Case | HTML | gzip | brotli | DOM elements | Load / hydrated at 360px, 4× CPU throttle |
|---|---|---|---|---|---|
| Calendar off (baseline) | 19 KB | 4.8 KB | — | — | — |
| 2 listed events (typical) | 774 KB | 28.6 KB | — | 2,049 | 0.86s / 0.98s |
| 400 max-length events inserted (382 served, truncated) | 4.13 MB | 61 KB | 26 KB | 7,997 | 0.89s / 1.06s |

The 400 probe events were inserted, measured and deleted; the count is back to 6, confirmed by SELECT.

**Judgment: a note, not a FAIL.**
- The stated caps hold: 400 rows, with title, location and description clipped (T1/T4). No byte cap is stated anywhere.
- But the design's Payload line (work-log line 776) is wrong in both directions. It says "worst case ≈ 1 MB of HTML … typical use is a few tens of kilobytes".
  - Two events already cost about 755 KB of HTML, because all 14 month panels with roughly 425 day cells are rendered and every panel is shipped twice (HTML and flight data).
  - The worst case is 4.1 MB, about four times the accepted figure.
- On the wire it is small, and the timing is fine. Tech-lead should correct the claim, or rule on the panel duplication.

## Copy Truthfulness

- [x] **Every added or changed string is in the design's Copy table.** P1–P8, E1–E9, F1–F2. The only variant is the "is/are left out" grammar (Phase 4 deviation 1), which is acceptable.
- [x] **The query behind each claim was opened.**
  - E4's "stays out of Copy month" holds: `clipboard.ts:69` filters `isPublic && !isCancelled`.
  - E4's "members of {orgName} who have calendar access" holds: `events.view` or `events.manage`.
  - P7 is gated on `member_calendar_on`, which is composed with the category axis (T3 differential).
  - E5 and E6 say "marked", which matches what the row knows.
- [x] **Each instruction was traced to its role.** E7 and E9 tell an `events.manage` holder to "use Edit event / Website listing"; the page requires `events.manage`. In F2 the `org_features.manage` holder is asked to request placement, which is not an in-tool action.
- [x] **Older strings were grepped.** The old "Visible on the public calendar" and "It just stays off the public website" strings, and the "Public" labels, are all gone from `src/`. Release notes v0.18 and v0.32 are history.

**copy truthfulness: two low-severity findings, both design-originated, routed to tech-lead for a Copy-table ruling. They are not the reason for the FAIL.**

1. **The put toast claims a state the row cannot know.** `series-website-listing.tsx:28-31`, viewer: `events.manage` holder. The text is "{n} events put on the website." It reads only `website_listed`, not the org toggle, the site status or where the calendar is placed. That is the same reason the design rejected the analyst's "On the website" badge. When the toggle is off, the toast is false. Suggested wording: "{n} events marked for the website."
2. **The "no events" state says "yet".** `public-events-calendar-slot.tsx:81`, viewer: anonymous visitor. The text is "No events have been posted on this calendar yet." The read only covers the 14-month window. A congregation whose only listed events are more than a month old, or more than 12 months ahead, is told nothing has been posted "yet".

## Findings that make this a FAIL

**FAIL-1: the event detail page scrolls sideways at 360px (new UI from this diff).** Viewer: an `events.manage` holder on a phone.
- **Where:**
  - `src/app/(org)/o/[slug]/admin/events/series-website-listing.tsx:137`, the "Take this and later events off the website" button. Its right edge is at 374px, so the page `scrollWidth` is 374.
  - `series-website-listing.tsx:110`, the "Put this and later events on the website" button. Right edge 361px.
- **Cause:** the `Button` primitive is `whitespace-nowrap` (`src/components/ui/button.tsx:90`) and the labels are longer than 360px minus the page padding.
- **How it was measured:** element scan (`getBoundingClientRect().right > 360`) and a full-page screenshot.
- **Why the tests missed it:** T19 and the 360px specs measure only the public page. No editor spec checks `scrollWidth` at 360px.
- **Hand-back:** fix the layout (let the label wrap, or make the button full-width), and add a 360px `scrollWidth <= 360` assertion on the event detail page with the Website listing section showing.

**FAIL-2: an update that leaves out `websiteListed` writes a false audit row, and can trip the CHECK.** Proven on this branch's database with a scratch-only probe; the worktree was not edited.
- **Where:**
  - `src/lib/events.ts:708`: `deriveListed(input.websiteListed, input.isPublic)` returns `undefined` when the field is missing.
  - Drizzle then leaves the column out of the SET, so it is unchanged.
  - `events.ts:728`: `undefined !== existing.websiteListed` is true, so an audit row is written anyway.
- **Probe A**, on a listed, open-to-everyone event, posted without `websiteListed`: the result is `ok`. The event is **still listed** (`{listed:true,isPublic:true}`), but the audit trail now reads `["event.listed_on_website","event.unlisted_from_website"]`.
  - The authoritative record (DECISION-240/241, which declined the `_by`/`_at` columns because "the audit row is authoritative") says the event was taken off the internet while it is still public.
  - A non-boolean value such as the string `"false"` produces the same mismatch: `action: listed ? …` picks by truthiness.
- **Probe B**, the same omission while unticking "Open to everyone": the call throws an uncaught `23514 events_website_requires_public`. That is the F251 class again, reached through the action contract instead of the form.
- **Who can trigger it:** any `events.manage` holder who crafts the server-action payload, or any future caller.
- **Why it matters:** Phase 1 Pass 5 says "server-side validation of the switch … lives in the action, not the form". `setSeriesWebsiteListing` narrows `listed` (`events.ts:945`), but `createEvent`/`updateEvent` do not narrow `websiteListed` or `isPublic`. T14 pins audit rows only for well-typed inputs. Per the regression-discipline rule, this is the "slightly different bypass in the same class".
- **Hand-back:**
  - Narrow `typeof === "boolean"` for `websiteListed` and `isPublic` in both lib functions (`invalid_input`).
  - Add a regression test: an omitted or string `websiteListed` returns `invalid_input`, leaves the column unchanged, and writes no audit row. It must fail before the fix.

## Notes (not blocking; for the record and for Phase 6)

- **N1. Payload:** see the section above. Tech-lead should correct work-log line 776.
- **N2. iOS:** `<details>` on real iOS Safari is still unverified. That is for the Phase 6 walk.
- **N3. Series buttons before hydration:** they are not disabled before hydration, so a tap then does nothing. The e2e spec retries the click for this reason. It is not a `useForm` root, so no HydrationGate rule is broken. It is a small UX gap.
- **N4. Work-log leftovers:** the Phase 4 section still carries the template placeholders (the "Files Created … `path/to/file`" block, work-log lines 1118–1144).
- **N5. `next dev` rewrote `AGENTS.md`** on this branch. Main fixed this after the merge-base (`scripts/agents-md.test.mjs`). I restored the file with `git checkout -- AGENTS.md` after stopping the server; `git status` is clean. It resolves when main is merged in.
- **N6. Integration:** this branch is 31 commits behind `origin/main`, which changed `e2e/support/*`, `playwright.config.ts` and auth. The PR's CI run on the merge is the authority for the combined tree.
- **N7. Shared Turbopack root:** a `turbopack.root` on the parent directory breaks dev servers whenever parallel pipelines run (see "Environment incident" above). It is worth a TODO line under Rule 16.

## Verdict

**FAIL.** Every suite is green: unit, the DB-backed set, RLS section 67, chromium, custom-hosts, the production lane and the forced 360px runs. The fixes that were promised failing-first are real. The two findings are:
- **FAIL-1:** the 360px horizontal overflow on the event detail page, from the new Website listing section.
- **FAIL-2:** an update that omits `websiteListed`, or sends a non-boolean, writes a false website-listing audit row and can trip the CHECK.

Both are Phase 4 fixes and need no design change. The two copy findings and the payload estimate (N1) go to tech-lead for a ruling, in parallel.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete. All suites green: unit 8448; DB 10922 (627 files); RLS section 67 58/58 as presby_app, the full patched suite 1298 with 3 pre-existing drift failures matching main; chromium 430/430; custom-hosts 111/111; production lane 78/78; forced 360px 24/24. Flags reset to the CI baseline. FAIL-1 (360px overflow on the detail page) and FAIL-2 (false audit row when `websiteListed` is omitted). Copy and payload notes go to tech-lead. | FAIL | 2026-10-25 |

## Handoff

**Next:** full-stack-developer (Phase 4), for FAIL-1 and FAIL-2:
- **FAIL-1:** `series-website-listing.tsx:110` and `:137`, plus a 360px `scrollWidth` assertion on the event detail page.
- **FAIL-2:** `events.ts:550`, `:708` and `:728`, with boolean narrowing in `createEvent`/`updateEvent` and a regression test that fails before the fix.

In parallel, tech-lead (Phase 3) should rule on:
- the put-toast wording (`series-website-listing.tsx:28-31`);
- the P2 "yet" wording (`public-events-calendar-slot.tsx:81`);
- the Payload edge-case claim in the work-log (line 776).

After the fixes, QA re-runs `events.test.ts`, the editor spec at 360px, and the copy checks. The rest of this run stands.

Files referenced:
- /Users/cshenso/git/presby-platform/presby-cal/src/app/(org)/o/[slug]/admin/events/series-website-listing.tsx
- /Users/cshenso/git/presby-platform/presby-cal/src/lib/events.ts
- /Users/cshenso/git/presby-platform/presby-cal/src/app/(public)/site/[slug]/public-events-calendar-slot.tsx
- /Users/cshenso/git/presby-platform/presby-cal/docs/work-log/2026-10-25-public-events-calendar.md
- /private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/qa/flags-before.txt
- /private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/qa/logs/editor-360/3-detail-parent.png
- /private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/qa/logs/probe-omit.out

---

# Phase 6 — Shipped vs Intent (analyst)

**Pipeline:** `2026-10-25-public-events-calendar` · HEAD `1360f76` (plus the uncommitted QA run 2 text) · Date 2026-10-25

### VERDICT

**SHIP WITH NOTES.** The code delivers what Phase 1 promised, and merging it exposes nothing. No toggle row exists in any organization, no event has the new box ticked, and no site carries the marker. It is not SHIP IT for three reasons:
- iOS `<details>` has never run on a real device.
- The operator's own definition of done, the public-site integration step, comes after this verdict and cannot run today (see below).
- The custom-host check has only been simulated with `*.invalid` hosts.

None of these needs a code change. The iOS check gates turning the toggle on for a congregation, not merging.

### ONE-LINE TAKE

> An anonymous visitor to a congregation's public site sees a month grid, or a list on a phone, of exactly the events an editor deliberately ticked "Show on our website's public calendar". Members-only, unticked and cancelled events cannot reach the page, and everything starts off.

### What I verified myself, and what I did not

**Verified myself:**
- Read the whole work-log: Phase 1 (G1–G14, Q1–Q10), operator rulings, Phases 2 and 3, amendment 1, Phase 4 batches and loop-back, and QA runs 1 and 2.
- Read `drizzle/0067_presby_public_events_calendar.sql` in full, and the slot and panel source.
- Re-ran 6 unit files with no database (71 tests, all green): mapper, contract, listing rules, slot, size ceiling and island.
- Grepped the writers of `website_listed`. There are exactly four code paths, all audited.
- Grepped the old strings ("Visible on the public calendar", "put on the website", "No events have been posted"). They survive only in a negative test assertion and one test title that names the act.
- Looked at QA's 360px screenshots:
  - the public page on the platform host;
  - the custom-host simulation;
  - the new-event form and the event detail page.
- Read `site-fpcw` (README, `content/upcoming-events.json`, `deploy.yml`) and site-kit's `ingest.yml`, `renderLiveSlotBlock` and `build-bundle.mjs`.
- Ran `gh variable list` and `gh run list` on `site-fpcw` and `site-pasturechurch`, and `vercel env ls production` (names only).
- Built a bundle in the scratchpad from a copy of `site-fpcw` with my proposed edit. It builds: 14 pages, and `/upcoming-events` carries the `eventsCalendar` marker.

**Not verified myself:**
- I did not drive a browser.
- I did not read any database or production state.
- I did not re-run e2e or the DB-backed suites.
- Everything about the visitor and editor walks below comes from QA's runs and screenshots, which I read.

### The anonymous-visitor walk, from QA evidence and the code

- **Calendar on, events marked:**
  - At 360px the page shows a list: month heading, Previous, Today and Next (at least 44px), an "Event types" legend, and day sections.
  - Tapping an event opens its details in place (Where, Event type, description).
  - `scrollWidth` is 360, including with a 200-character unbroken title.
  - The same holds on the simulated custom host.
  - At 1280px it is a seven-column grid with today ringed and a card over neighbouring cells.
- **Toggle off, category off, site not live, or read failed:** one sentence, "Our events calendar isn't available right now. Please check back soon." A suspended site is a 404 for the whole site.
- **Toggle on, nothing in the window:** "No events are on this calendar right now. Please check back soon." The phone line appears only if the profile has a phone.
- **Member prompt:** it appears only when the member-calendar toggle is on. The button is an absolute platform-host URL with no `callbackUrl`.
- **Freshness:** `Cache-Control` is `no-store` on dev and `private, no-cache, no-store, max-age=0, must-revalidate` on `next start`. The unmark-then-reload spec passes.

### The editor walk (`events.manage`), from QA evidence

- **New-event form at 360px:** the box "Show on our website's public calendar" is unticked by default. Its hint says anyone on the internet can read title, description, location and type, and that search engines and archives may keep copies.
- **Open-to-everyone unticked:** the website box is disabled and unticked, with "Only events open to everyone can be shown on the website."
- **Event detail:** it reads "Open to everyone · Marked for the website" with the conditional sentence about the toggle and the page. The Website listing buttons are full width and wrap, so `scrollWidth` is 360 (it was 374 in run 1).
- **Dialogs and toasts:** the dialogs fit. The toast reads "4 events no longer marked for the website."
- **Extend line:** "New events will be marked for the website, like the latest one in this series."

### Can a members-only, unlisted or cancelled event reach the public page?

No. Four independent layers hold, and I checked each myself or through QA's live probes:
- **Per-event predicate:** the definer requires `website_listed and is_public and cancelled_at is null` (I read the SQL).
- **CHECK `events_website_requires_public`:** it refuses the combination on the app role and on the owner role. QA probed both.
- **Read-time `is_public` re-filter:** it holds even with the CHECK dropped (test T2).
- **Fail-closed gates:** the toggle, site-live and category-axis checks sit inside the definer. Every non-serving cause returns one byte-identical row, and a read failure maps to the same notice, never to "no events".

QA's raw HTML and flight-data curl found no members-only, unlisted, cancelled or out-of-window title, and no uuid-shaped string. The projection is an allow-list of seven named keys with no id.

Residuals, all accepted:
- F254: a cancelled event keeps the flag true, but the read filters it. *paper*
- F256: the table has no length CHECK, so the definer clips instead. *paper*
- A published event's free text is public and may be archived. The form and release note say so.

### iOS `<details>` and how the integration step closes it

By code review, the summary has no `display` override. Layout lives on an inner `<span>`, and the native marker is hidden with `list-none` plus `[&::-webkit-details-marker]:hidden`. That is the right shape, but it is unverified.

Close it as part of the integration step, on a real iPhone in Safari, before the toggle is announced to anyone. Open `https://www.presbyportal.org/site/fpcw/upcoming-events` with a test event in the current month, and check:
1. Tapping an event row opens its details in place, and a second tap closes it.
2. The chevron rotates.
3. No native disclosure triangle shows.
4. Previous, Next and Today work after load, and Today lands on the current month.
5. Rotating the phone to landscape keeps the layout intact.
6. Nothing scrolls sideways.
7. The "Member sign-in" label is readable (the label-colour trap found in the browser).

Record the device and iOS version in a work-log addendum. A failure is fixed forward, and the immediate rollback is the toggle off.

### Intent-vs-Shipped Diff

- **G1/Q1, "published" undefined.** Phase 1 said a separate, default-off switch with `is_public` as the veto. Shipped: `events.website_listed`, the CHECK and the read-time filter. Verdict: matches.
- **G2, copy that lies.** Phase 1 said replace the five strings. Shipped: replaced, and the old strings are gone (my grep). Verdict: matches.
- **G3/Q8, series switch.** Phase 1 said a scope choice inside one form. Shipped: a separate "Website listing" section with counted confirmations on the event page, plus extend-inherits-from-latest. Verdict: acceptable drift. It was disclosed in Phase 3 and gives the same capability on two surfaces. The F251 and F252 regressions are proven red-then-green.
- **Badge wording.** Phase 1 proposed "On the website". Shipped: "For website" and "Marked for the website", and the toasts say "marked". Verdict: acceptable drift, and an improvement, because the row cannot know the toggle or the page.
- **G4/Q7, time zones.** Phase 1 said server-side "today" in the org zone and no zone label. Shipped: the definer computes it and no label shows. Verdict: matches.
- **G5/G6, allow-list and plain text.** Phase 1 said named keys, no ids, and plain-text rendering. Shipped: seven keys, `PublicCalendarEvent` has no id, hostile strings render as text, and the hint states the residual. Verdict: matches.
- **G7, member prompt.** Phase 1 said show it only when the member calendar is on. Shipped: gated on `member_calendar_on` with hedged wording. Verdict: matches.
- **G8, empty versus failed.** Phase 1 said distinct states. Shipped: failure and "off" are the same notice, and an empty list needs a successful read. Verdict: matches.
- **G9, "where does the calendar appear" line.** Phase 1 asked for it. Shipped: deferred by operator ruling, with a TODO line. Verdict: acceptable drift. Placing the marker is a manual step, so a mistyped slot name renders nothing silently. The integration step's visual check covers it for FPCW.
- **G10/Q5, month navigation.** Phase 1 said a bounded window switched in a client island. Shipped: 14 months, 400-row cap, no `?month=`, no endpoint, redline unamended. Verdict: matches. The costs are no deep link and a heavy payload (see Follow-Ups).
- **G11, freshness.** Phase 1 said the next load reflects an unpublish. Shipped: `no-store`, and QA confirmed it. Verdict: matches.
- **G12, cancelled events.** Phase 1 said hide them. Shipped: hidden. Verdict: matches.
- **G13, mobile.** Phase 1 said a list under 640px, at least 44px targets, platform-fixed colours. Shipped: a list below `md` (768px, matching the member calendar), 44px targets, a legend. Verdict: matches, with the breakpoint at 768px.
- **G14, Track K line.** Phase 1 said amend the line in the same commit. Shipped: the exact replacement text is drafted, but `docs/TODO.md` is a shared file and has not been edited. Verdict: owed at integration (below).
- **Q9, iCal.** Phase 1 said defer it. Shipped: deferred, with a TODO line. Verdict: parity loss accepted.
- **Audit (DECISION-240).** Phase 1 said audit publish and unpublish. Shipped: in-transaction `insertAuditRow` on all four writers, none for a no-op or a cancel. Verdict: matches.
- **Q1/Q3 (operator rulings).** Shipped as ruled: a new switch, and a self-service toggle with `operatorEnabled: false`. Verdict: matches.

### Edge Cases

- **Empty state:** pass.
- **Failure microcopy:** pass. It is human, one string, and never "no events" when the read failed.
- **Permission gate:** pass.
  - `events.manage` is checked first in the lib transaction on all writers.
  - The organization id never comes from the form.
  - The anonymous read takes no permission.
  - The toggle needs `org_features.manage`.
- **Audit event:** pass. Four writers, one row each when the column changes.
- **Mobile (360px):** pass on the platform host and the simulated custom host, and on the editor surfaces. iOS is not verified.
- **2FA mid-enrolment:** not applicable. The editor is under `/o/*`, which the proxy already gates, and the public surface has no session.
- **Redirect and enumeration:** pass. The one outbound link is built from `SiteUrls` with no visitor input, and the unavailable row is identical for every cause.
- **Founding-administrator walk (Phase 6 rule):** not applicable. This change grants no role, changes no connection to an organization, and changes nothing a new account can reach.
- **Practical dependency (existing, unchanged):** `events.manage` has no default role binding. A freshly founded congregation's administrator cannot publish an event until a role carrying it is granted.

### Public-site integration step, specified

**Current facts**
- **Production tenants:** `fpcw` and `presbytery-of-scioto-valley` (`docs/deployment.md:36`).
- **FPCW's site has never been ingested.** Every `Deploy site content` run on `site-fpcw` failed (the five newest are 2026-08-26 to 08-28, the last on 08-28).
- **No repository variables on `site-fpcw`.** `PRESBY_INGEST_URL` and `PRESBY_OIDC_AUDIENCE` are unset there. `site-pasturechurch` has both, set 2026-10-20. The failed logs have expired, so "failed because of the missing variables" is an inference.
- **Production env:** `SITES_INGEST_OIDC_AUDIENCE` and `GITHUB_SITES_ORG` exist in Production (created about 6 days ago). `docs/TODO.md:100`, `docs/deployment.md:227` and `docs/deployment.md:826` still say they are unset and are stale.
- **First customer:** pasturechurch.org is the go-live customer. FPCW is a pre-cutover tenant, a hard January 1 cutover with `fpcw-directory` still its system of record for events until then.
- **Custom host for FPCW:** none is live. `DOMAINS_PROVIDER` is unset in production, so the real-provider acceptance pass has not run.

**The edit (safe to do now, publishes nothing)**

In `/Users/cshenso/git/presby-platform/site-fpcw/content/upcoming-events.json`, keep `frontMatter` and the `hero`. Replace the `prose` block (the Google Calendar link) with:

```json
{ "type": "liveSlot", "props": { "slot": "eventsCalendar" } }
```

- The slot name is case-sensitive, and a typo renders nothing silently.
- `filter` is optional. `{"view":"list"}` would force the list layout, and `view: "month"` is the default.
- The page is `/upcoming-events`, so it appears at `/site/fpcw/upcoming-events` on the platform host. The `navLabel` "Events" is unchanged.
- Commit it on a branch, not `main`. A push to `main` runs `deploy.yml`, which is a publish once the variables exist and a red run until then. Before publishing, run `node ../presby-site-kit/scripts/build-bundle.mjs <repo> <out>` and confirm 14 pages and that the page carries the marker.

**What must be true in production first**
1. Migration 0067 is applied to production (see Deploy order) and the release is deployed.
2. `sites.public_render` is on. The ingest route returns 503 otherwise, and the site does not render.
3. Both `site-fpcw` repository variables are set. `PRESBY_OIDC_AUDIENCE` must equal the Production `SITES_INGEST_OIDC_AUDIENCE` exactly. `site-pasturechurch` carries `presbyportal-sites-ingest`, which is probably the same value, but compare it; I cannot read the encrypted env value.
4. `organization_sites.repo` for `fpcw` equals `chenson42/site-fpcw`. Otherwise the ingest answers 404.
5. `org_portal.events` is on in production, or the event editor is unreachable.
6. A person in `fpcw` holds `events.manage` and `org_features.manage`. This needs a role grant through the normal admin UI by the founding administrator. Do not use SQL, which would skip the audit. A platform admin's role confers nothing here (DECISION-183).
7. The operator's explicit go for FPCW's first real ingest. Publishing the bundle puts the whole migrated 14-page site, 78 images and the real staff contact details already public on the church's current site, live at `presbyportal.org/site/fpcw`, replacing whatever placeholder bundle is there. It is crawlable before the church's own domain exists. The calendar edit alone is not the decision; the first ingest is.

**Order of the publish-and-verify steps**
1. Toggle `org_portal.public_calendar` on for `fpcw` at `/o/fpcw/admin/features`. This is the only toggle, for this congregation only.
2. List a clearly labelled test event with the box ticked, inside the 14-month window, for example "Calendar test (please ignore)".
3. Then publish the bundle (merge the branch to `main`, or re-run the workflow). The reverse order shows visitors the "isn't available" notice for a moment in place of the old link.
4. Check `https://www.presbyportal.org/site/fpcw/upcoming-events` at 360px: the list, an event opens, Previous/Next/Today work, no sideways scroll. Then check 1280px. Do the real-iPhone check above.
5. Confirm the negatives with test rows: a members-only event, an unticked event and a cancelled event do not appear.
6. Remove the test event: untick it (audited, and it leaves the page), then cancel it. There is no hard delete, so the row remains, inert.

**Can it run now?**
- The edit and local bundle build can run now.
- The publish, toggle, test event and iOS check must wait for 0067 to be applied, the release deployed and the variables set, then for the operator's go on the first ingest.
- The custom-host check cannot run for FPCW until Track F's real-domain acceptance pass and attachment (cutover). Today it is covered only by the simulated-host e2e on `*.invalid`. Add it to the cutover checklist.
- The cutover also has a content dependency. After the switch, FPCW's Events page shows "No events are on this calendar right now" until the Track K event import has run with the G14 mapping (`publish_to_google_calendar AND is_public AND NOT members_only` feeds `website_listed`). The import must land before DNS moves.

### Deploy order

**Apply 0067 to production BEFORE merging.** Every merge to `main` auto-deploys production.
1. Take a Neon snapshot of production.
2. Run `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f drizzle/0067_presby_public_events_calendar.sql` as the owner.
3. Re-read `proacl` (owner and `presby_app` only), the CHECK, `prosecdef`, and `relforcerowsecurity` on `events`, and diff against `development`.
4. Then merge, deploy, and smoke the events admin page and an anonymous public-site page.

The migration is additive, a default-false column plus one definer function. Old code against the new schema is unaffected (it never names the column, and nothing can set it). New code against the old schema breaks, because `EVENT_COLUMNS` selects `website_listed`, so the events admin pages would error until the migration lands. Code rollback is safe.

Also apply it to the shared `development` branch, with the `scripts/public-calendar/seed-dev-public-calendar.sql` fixture. Run the full `scripts/test-rls.sql` as `presby_app` on merged `development` after the integration patch. Section 67 adds 58 passes, and the three known drift failures at lines 217, 516 and 7927 are pre-existing.

### Follow-Ups (SHIP WITH NOTES)

For the orchestrator, per Rule 10, in the same commit:

**Edits**
- Move line 51 (the public event calendar) to Done, 2026-10-25, with this verdict.
- Amend line 54 (Track K event import traps, item 1, G14) with the replacement text drafted in Phase 3. `is_public` comes from `is_public AND NOT members_only`, `website_listed` from `publish_to_google_calendar AND is_public AND NOT members_only`, and only `kind = 'event'` rows are imported.
- Correct line 100 (and the matching text in `docs/deployment.md`). The Production ingest env vars now exist. What is missing is `site-fpcw`'s repository variables, and the run history shows every ingest attempt failed.

**New lines**
- **F250:** `presby_public_giving_config` ignores the category axis (bug-fix pipeline). Phase 3 drafted the text.
- **F253:** `presby_app` and `presby_platform` hold DELETE on `events`. *paper*
- **Q9:** iCal or "add to my calendar".
- **G9:** the "where does the calendar appear" status line, reusing `PUBLIC_CALENDAR_SLOT`.
- **F255:** an "N events go live" confirmation when the toggle is turned on.
- **N7:** `turbopack.root` spans the shared parent directory and breaks parallel dev servers.
- **Payload lightening:** about 0.75 MB of uncompressed HTML for 2 events (about 29 KB gzip), and 4.1 MB at the 400-event maximum. The cheap fix is to render an event-less day as one `aria-hidden` cell. Revisit trigger: more than 1.5 s at 4x throttle at the maximum, or a church complaint.
- **R2-N1:** `e2e/public-calendar.spec.ts:414` should wait for the child page's own heading or URL change, then drop the retry and fix its comment. The retry hides a test race, not a defect.
- **Public-site integration, FPCW** (an operator-facing line carrying the preconditions above).
- **Real-iPhone `<details>` check** (owner: operator, part of the integration step).
- **FPCW custom-host check at cutover**, and the **event import before DNS moves** (day-one empty calendar).
- **Owed what's-new post**, under "Owed what's-new posts", deferred until FPCW's toggle is on.

**Housekeeping at integration:**
- DECISION-238, 239, 240 and 241 written to `docs/decisions.md`.
- F250–F256 folded into `docs/schema-design-2.md` §2aa.
- The 0067 journal entry and the RLS patch applied. The journal `when` must stay in idx order relative to 0065 and 0066, and `db:migrate` can silently skip an entry with an earlier `when`.
- `docs/STATE.md` updated.

### Release note (minor)

It is a Feature, so it is a minor release. I would not fix the number now: `presby-padmin` already carries 0.43.0 on its branch. It is **0.43.0 if this merges first, 0.44.0 if padmin's does**. Assign it at integration, as a new `v0.4x.md` file linked back to the previous minor.

Draft entry:

> **Feature: your congregation's website can show an events calendar.**
>
> **Value:** Visitors to your public website can see your upcoming events as a month calendar on a computer and a simple list on a phone, kept up to date from the events your team already enters.
>
> #### What's New
> - **Nothing is public until someone chooses it.** Every event, old or new, starts with the new box "Show on our website's public calendar" unchecked. An administrator must also turn on the "Public events calendar" feature, which starts off.
> - **It appears where your website's maintainer puts it.** Whoever maintains your website adds the calendar to a page, for example the events page.
> - **Members-only and cancelled events are never shown.**
> - **What visitors can read.** Anyone on the internet can read a shown event's title, description, location and event type. Search engines and web archives may keep copies, so taking an event off the website does not remove copies already made. Please leave private details out of these fields.
> - **Repeating events.** A new "Website listing" section puts an event and all later ones on the website, or marks them off, in one step. Other edits to a repeating event still apply to one event at a time.
> - **A box has changed.** "Visible on the public calendar" now reads "Open to everyone, not only members". Before this release it did not control anything on the website.
> - **Not included yet:** subscribing from a phone or Google Calendar, and a separate page for each event.

### What's-new advisory (Rule 13)

Yes, but deferred, following the "Owed what's-new posts" precedent. An entry on `/home` reaches every member, and only `events.manage` and `org_features.manage` holders can use this, and only where the toggle is on. Publish it when the first congregation's toggle goes on, addressed to church administrators. Draft:

> **Show your events on your website**
>
> Your church's website can now show an events calendar. To use it, an administrator turns on "Public events calendar" under Features. Your website editor then places the calendar on a page. Finally, tick "Show on our website's public calendar" on each event you want visitors to see. Nothing appears until you do all three. Events marked "Members only" never appear. Remember that anyone on the internet can read what you put in a shown event.

### Docs

- **`docs/product/functionality-map.md` (Rule 14):** edit the events bullet at line 23 and the admin bullet at line 79. Both currently say `is_public` is "inert until Increment 4" or that Increment 4 "reads `is_public`", which this change makes false. Describe the `eventsCalendar` liveSlot, `events.website_listed`, `org_portal.public_calendar`, `presby_public_events_calendar`, migration 0067, DECISION-238–241, the relabelled checkbox and the series "Website listing". The short Index entry needs the same shift if it names the public calendar.
- **`docs/architecture.md` (Rule 15):** no change. A fifth live slot on an existing mechanism is not architectural.

### Red Flags

None. No NEEDS REWORK conditions.

### Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete. Code matches Phase 1 with disclosed drift (series listing as its own section, "marked" wording). Nothing members-only, unlisted or cancelled reaches the page. Open: iOS real-device check, the FPCW public-site integration step (blocked on 0067 in production, the release deployed, `site-fpcw`'s repository variables unset, and the operator's go on the first ingest), and the custom-host check at cutover. Deploy: apply 0067 before merging. | SHIP WITH NOTES | 2026-10-25 |

### Handoff

**Next: the orchestrator, then tech-lead.**
- The orchestrator does the integration items: the journal entry, the RLS patch, decisions, TODO lines and edits, STATE, merging `main` again, the PR, and the 0067 apply and snapshot before merge.
- Tech-lead does the Phase 6 housekeeping: the release-notes entry, the functionality map, and the owed what's-new line.
- The integration step then runs with the operator, who owns the repository variables, the first-ingest go, the role grants and the real-iPhone check. When it closes, append an addendum to this work-log with the screenshots, device and version, and the cleanup confirmation.
- Workflow Rule 12 does not apply, because this did not originate from in-app feedback.

### Files read and referenced

- `/Users/cshenso/git/presby-platform/presby-cal/docs/work-log/2026-10-25-public-events-calendar.md`
- `/Users/cshenso/git/presby-platform/presby-cal/drizzle/0067_presby_public_events_calendar.sql`
- `/Users/cshenso/git/presby-platform/presby-cal/src/app/(public)/site/[slug]/public-events-calendar-slot.tsx`
- `/Users/cshenso/git/presby-platform/presby-cal/src/app/(public)/site/[slug]/events-calendar-panel.tsx`
- `/Users/cshenso/git/presby-platform/presby-cal/src/app/(public)/site/[slug]/render-site-page.tsx`
- `/Users/cshenso/git/presby-platform/presby-cal/src/lib/events.ts`
- `/Users/cshenso/git/presby-platform/site-fpcw/content/upcoming-events.json`
- `/Users/cshenso/git/presby-platform/site-fpcw/README.md`
- `/Users/cshenso/git/presby-platform/site-fpcw/.github/workflows/deploy.yml`
- `/Users/cshenso/git/presby-platform/presby-site-kit/.github/workflows/ingest.yml`
- `/Users/cshenso/git/presby-platform/presby/docs/deployment.md`
- `/Users/cshenso/git/presby-platform/presby/docs/TODO.md`
- `/Users/cshenso/git/presby-platform/presby/docs/product/functionality-map.md`
- `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/p6/content/upcoming-events.json` (my scratch edit)
- `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/p6/bundle.json` (my scratch bundle)

---

# Phase 3 amendment 1 — QA run 1 rulings (tech-lead)

Date 2026-10-25. Scope: the two copy findings, the Payload claim (work-log line 776, Edge Cases), N3 and N7 from the "Phase 5: Verification (qa)" section above. FAIL-1 and FAIL-2 are Phase 4 defects needing no design change and are not re-ruled here. This amendment is append-only: Phase 3's Copy table and Edge Cases stay as written; where a string or claim below differs, **this amendment governs** and the implementer applies the strings below, not the original rows.

## Ruling 1 — The series toasts (and one neighbour the same finding makes false)

**Finding upheld.** "{n} events put on the website." asserts a state the row cannot establish: `website_listed` says "marked", not "shown" (the toggle, the site status and the page placement are all outside the row). The design rejected "On the website" as a badge for exactly this reason (Phase 3 Copy, E check "Source of truth"), and the toast made the same claim.

**The take toast needs the same repair.** I looked at whether "taken off the website" could stay on the argument that absence is guaranteed (after unmarking, nothing shows, whatever the toggle). Absence is guaranteed, but "taken off" still *asserts that the event was on*, and with the toggle off it never was. One vocabulary is better than a principled asymmetry: the checkbox is "Show on our website's public calendar", the badge is "For website", the detail line is "Marked for the website", so the toasts use "marked" in both directions.

**Neighbour found by the grep (check 4).** E8 on the extend form ("… will be put on the website, like the latest one in this series") promises the same unknown state. Reworded below. `website-listing-copy.ts:60,62` and `extend-series-form.test.tsx:113-136` change.

**Left alone, by decision (they say what the *act* is, not what the outcome is):** the E7 buttons "Put this and later events on the website" / "Take this and later events off the website", the dialog titles "Put {n} {event|events} on the website?" / "Take {n} … off the website?", the confirm buttons "Yes, put {n} on the website" / "Yes, take {n} off the website", and the take dialog body "will no longer appear on your public website" (true whatever the toggle). A question or a button names the thing being requested; only a statement after the fact has to be true. The put dialog body already says "are marked to appear on your public website's calendar", which is the honest form.

**Strings (exact; replace E7 toasts and E8):**

| ID | Where | String |
|---|---|---|
| E7-toast-put | `putToast()` in `series-website-listing.tsx` | "{changed} {event\|events} marked for the website." with " {s} left out." appended when `skippedCancelled + skippedMembersOnly` is above zero. Examples: "1 event marked for the website." / "3 events marked for the website. 2 left out." |
| E7-toast-take | `takeToast()` | "{changed} {event\|events} no longer marked for the website." Examples: "1 event no longer marked for the website." / "3 events no longer marked for the website." |
| E7-toast-zero | both | "Nothing needed to change." (unchanged) |
| E8 | `website-listing-copy.ts`, extend form | "{n} new {event\|events} will be marked for the website, like the latest one in this series." Before a valid number is typed: "New events will be marked for the website, like the latest one in this series." Singular: "1 new event will be marked for the website, like the latest one in this series." |

**The four checks.**
- *Residuals.* Nothing here denies the crawl/archive or free-text residual (those live in E2 and the dialogs, untouched). "Marked" does not claim privacy or finality.
- *Source of truth.* The toast numbers are the **returned** `SeriesListingOutcome` (`changed`, `skippedCancelled`, `skippedMembersOnly`); "marked" / "no longer marked" is `events.website_listed` as the action just wrote it, which is exactly what the write established. E8's "will be marked" is `inheritedListing()` (the latest non-cancelled occurrence), which the write also uses.
- *Audience.* Read by an `events.manage` holder (the page requires it). No instruction in these strings.
- *Neighbours.* Grepped `src`, `e2e`, `scripts`, `docs/release-notes`, `docs/product` for "put on the website", "taken off the website", "marked for the website", "no longer marked". Stale and to modify: `series-website-listing.tsx:31` and `:36` (toasts), `website-listing-copy.ts:60,62` (E8), `series-website-listing.test.tsx:126` ("3 events put on the website. 2 left out." becomes "3 events marked for the website. 2 left out.") and `:168` ("1 event taken off the website." becomes "1 event no longer marked for the website."), `extend-series-form.test.tsx:110-136` (the `/put on the website/i` negative assertion at :110 becomes `/marked for the website/i`; the three positive strings follow E8), `e2e/public-calendar.spec.ts:423` ("3 events taken off the website." becomes "3 events no longer marked for the website."). Release-note line 5 ("puts this event and all later ones on the website, or takes them off") describes the act, not a state, and stands. Not stale: `org-features.ts:135` (already says "marked").

## Ruling 2 — P2 (nothing in the window)

**Finding upheld.** The definer's window is the previous month through 12 months ahead, so an empty `events_json` proves only that the window is empty. "Have been posted … yet" asserts a history (nothing was ever posted, and something is expected) that the read does not establish: a congregation whose only marked events are older than last month would be told nothing has been posted.

**Exact string (replaces P2):** "No events are on this calendar right now. Please check back soon." and, only when the profile has a phone: "You can also call us at {phone}."

- *Residuals.* Says nothing about privacy, copies or members-only events. "On this calendar" is scoped to what this calendar shows, and does not deny that members-only events exist (P7 already says the member calendar "can include events not shown here").
- *Source of truth.* A **successful** read (state `available`) whose `events_json` is empty for the 14-month window; "right now" ties it to the moment of the read, not to history; "on this calendar" is the window. It is still reachable only on success: a failure maps to `unavailable` (P1). The phone is `organization_profiles.phone`, as before.
- *Audience.* An anonymous visitor; "check back soon" and "call us" are things a visitor can do.
- *Neighbours.* Stale and to modify: `public-events-calendar-slot.tsx:81`, `public-events-calendar-slot.test.tsx:64` (the `EMPTY` constant), `e2e/public-calendar.spec.ts:53` (the `EMPTY` constant; the e2e case "toggle on and nothing marked shows …", T19). The custom-host spec has no copy of the string (grepped). P3 ("Nothing is on the calendar for {Month Year}") is month-scoped and stays true.

## Ruling 3 — The Payload claim: correct it, accept it, pin it

**The original claim (line 776) is wrong in both directions and is withdrawn.** "Worst case ≈ 1 MB of HTML … typical use is a few tens of kilobytes" was an estimate of event text only. I did not count the structure: the page renders all 14 month panels, about 425 day cells, and every panel is sent twice (once as HTML, once as RSC flight data, because the panels are passed through the client island as `ReactNode` props). QA's measurement: 2 events cost 774 KB of HTML (28.6 KB gzip, 2,049 DOM elements) against a 19 KB page without the calendar; the 400-event maximum costs 4.13 MB (61 KB gzip, 26 KB brotli, 7,997 elements). Almost all of the typical figure is empty day cells (about 0.9 KB each, doubled), not events.

**Corrected claim (this replaces line 776):** the calendar adds about 0.75 MB of uncompressed HTML (about 29 KB gzip) to a page with a handful of events, and at most about 4.1 MB (about 61 KB gzip, 26 KB brotli) at the 400-event cap with every title, location and description filled to its limit; the latter is reachable only by an authorised editor deliberately filling 400 descriptions to 2,000 characters. Measured on `next start` at 360px with 4x CPU throttle, the page was loaded in 0.86 s (typical) and 0.89 s (maximum), hydrated at 0.98 s and 1.06 s. *Measured by QA run 1; pinned by the ceiling test in Phase 4 addition A for the typical case only; the maximum case is not asserted.*

**Decision: accept, do not require a reduction now.** Weighing it:
- *Operator's 360px/mobile priority.* The measure that matters on a phone is wire size and time to a usable page. Both are small and the throttled timing is inside a second at the maximum; the heavy figures are parse-side (DOM element count) and still did not move the timing between 2 events and 400. There is no measured user harm to buy back.
- *DECISION-239 and the redline.* The two reductions that remove the doubling both touch the island contract. Panels as server HTML outside the client boundary, with the island toggling `hidden` and `data-*` on them through the DOM, replaces a tested React state model (T11) with imperative DOM writes, and the island's "no `Date`, no request" guarantee has to be re-proved. Fewer pre-rendered months changes the product (the 14-month window is mirrored in SQL, TypeScript and a pin test, T5, in an unreleased migration). Neither is a patch to make inside a QA loop-back on a run whose suites are otherwise green.
- *The cheap, low-risk reduction exists and is recorded for later* (estimated, *unverified*, to remove most of the typical payload): render a day with no events as one `aria-hidden` grid cell holding the day number, instead of a `<section>` with a heading, two spans and an `aria-label` (empty days are already `hidden` in the list layouts, and an empty day's heading is noise to a screen reader in the grid). It lives in one component (`events-calendar-panel.tsx`, `Day`) and its tests, and touches the two `public-calendar-day` counts in `e2e/public-calendar.spec.ts:235,283`. Trigger to do it: a measured load above 1.5 s at 4x throttle on the maximum case, a church complaint, or the page being embedded in a heavier host page. It goes into TODO (text below), not into this pipeline.

**Why Phase 4 addition A (a ceiling test) is required even though the reduction is not:** the corrected claim should cite a test or say unverified. A typical-case HTML ceiling is cheap, deterministic, and fails if someone doubles the per-day cost (a new wrapper, a longer class string), which is the likely way this regresses.

## Ruling 4 — N3 (series buttons inert before hydration): require a gate

The island's own rule, written in Phase 3 and implemented, is that a control that does nothing is never presented as live (`disabled` until `useHydrated()`). The two Website listing trigger buttons are the same case: before hydration a tap opens no dialog and the page gives no sign. The DECISION-159 form gate does not apply (no `useForm` root, nothing is overwritten, so no data is at risk), so this is a small consistency fix, not a safety one. It is two attributes in a file the implementer is already editing for FAIL-1, and it lets the e2e spec drop its click-retry. **Required:** `disabled={!hydrated || pending}` on the "Put" and "Take" trigger buttons, using the same `useHydrated` hook as the calendar island. No new string. (No hydration spec is required; a unit assertion that the trigger renders `disabled` under `renderToString` suffices.)

## Ruling 5 — N7: TODO line text (for the orchestrator; Rule 16 shared file, not edited here)

```text
- [ ] **Parallel pipelines break each other's dev servers: `turbopack.root` spans the shared parent directory.** `next.config.ts` sets `turbopack.root` to the repo's PARENT (`presby-platform/`) so a symlinked `presby-site-kit` resolves. In a worktree layout that parent also holds every sibling worktree, so one pipeline's test results, `tsbuildinfo` and builds trigger another's Fast Refresh: a full-reload loop in which `/signin` never hydrates and e2e fails with no defect in the branch (public-events-calendar QA run 1, 2026-10-25, against presby-padmin; QA had to re-run from a `git archive` copy of HEAD). Same root as the line above about the intermittent `next build` flake in a worktree. Options: set the root only when the sibling symlink exists (`fs.existsSync` on `node_modules/presby-site-kit` being a symlink), or point it at a per-worktree directory containing both the repo and the kit; and until fixed, document in `docs/testing.md` that a parallel QA run uses a copy outside `~/git/presby-platform/`. Candidate for deployment-engineer. — public-events-calendar Phase 5 N7
```

(Also appended for the orchestrator, from Ruling 3, as a TODO line:)

```text
- [ ] **Public calendar: lighten the page weight (revisit trigger in the work-log).** Typical page adds about 0.75 MB of uncompressed HTML (29 KB gzip) for 2 events, almost all of it empty day cells rendered into 14 pre-rendered panels and sent twice (HTML + flight). Cheap fix: render an event-less day as one `aria-hidden` grid cell with the day number (`events-calendar-panel.tsx`, `Day`; adjust the two `public-calendar-day` counts in `e2e/public-calendar.spec.ts`). Larger fix if needed: panels as sibling server HTML with the island toggling `hidden` by DOM, or a narrower pre-rendered window. Do it if the 400-event maximum measures above 1.5 s at 4x throttle on 360px, or on a church complaint. — public-events-calendar Phase 3 amendment 1
```

## Phase 4 additions for the implementer (full-stack-developer; on top of FAIL-1 and FAIL-2)

1. **Strings.** Apply Ruling 1 (E7 toasts, E8) and Ruling 2 (P2) exactly as written above, and update every test and spec string listed in each ruling's Neighbours line. An implementer who needs any other string stops for a ruling.
2. **N3 gate.** `disabled={!hydrated || pending}` on both trigger buttons in `series-website-listing.tsx` (Ruling 4), with a unit assertion (`renderToString` shows them `disabled`); remove the click-retry from the e2e spec if it exists only for this reason.
3. **Addition A — typical-case size ceiling.** One unit test in `public-events-calendar-slot.test.tsx` (or a sibling file): render the slot's HTML (`renderToString`, no flight) for a 2-event window across the full 14 months and assert its length is under a fixed ceiling. Set the ceiling to the measured HTML-only length rounded up by 25% to the next 10 KB; record the measured figure and the ceiling in Implementer Notes. The test name states what it guards ("per-day markup cost; see Phase 3 amendment 1, Ruling 3"). Do not assert the 400-event maximum.
4. **FAIL-1 and FAIL-2** as already handed back (360px overflow on the detail page with an editor-surface `scrollWidth <= 360` assertion; narrowing `websiteListed` and `isPublic` to booleans in `createEvent`/`updateEvent`, with a regression test written first). The labels of the two buttons are Copy E7 and do not change; the fix is layout (wrap or full width).
5. **Documentation.** Replace the stale Payload sentence in Implementer Notes if it repeats the original claim; the Phase 4 section still carries the template placeholder block (QA N4, lines ~1118-1144): fill or remove it.

Not required of the implementer: any change to the definer, the migration, the window, the cap, the island's props, or the panel structure.

## QA re-run scope

- **Re-run:** `src/lib/events.test.ts` and the new FAIL-2 regression (fails before the fix, passes after); `series-website-listing.test.tsx`, `extend-series-form.test.tsx`, `public-events-calendar-slot.test.tsx` and the new ceiling test; the editor surface at 360px (event detail page with the Website listing section showing: `scrollWidth <= 360`, and the new assertion exists in a spec); `e2e/public-calendar.spec.ts` on chromium and at forced 360px, and `e2e/custom-domains/public-calendar.spec.ts` (shared fixtures); `e2e/hydration/public-events-calendar.spec.ts` on both lanes only if the island file changed (it should not); typecheck, lint and `npm run check`.
- **Copy check, re-done on the new strings:** open the source of each claim (Ruling 1 and 2's Source-of-truth lines), confirm the toasts report the returned counts, and re-grep `src`, `e2e`, `scripts`, `docs/release-notes` and `docs/product` for the old strings ("put on the website", "taken off the website", "No events have been posted", "yet") to confirm none survived outside the history files named.
- **Not re-run:** the DB-backed set, RLS section 67, the full chromium, custom-hosts and production lanes (no migration, definer, window or panel change); the payload measurement (Ruling 3 stands on QA run 1's figures). Per the 2026-10-25 environment incident, run the e2e on a server that is not sharing a `turbopack.root` with another active pipeline (isolated copy, as in run 1) until N7 is fixed.
- **Verdict on re-run:** FAIL-1 and FAIL-2 closed and the strings above verified makes this a PASS; the iOS `<details>` check (N2) stays with the Phase 6 walk.

## Carry-forward (this amendment)

| Item | Disposition |
|---|---|
| Copy finding 1 (put toast) | Addressed: Ruling 1; take toast and E8 reworded with it |
| Copy finding 2 (P2 "yet") | Addressed: Ruling 2 |
| N1 payload claim | Addressed: Ruling 3, claim corrected, accepted, ceiling test required; lighter markup *deferred* (tech-lead, on the measured evidence; operator to confirm), TODO line above |
| N3 | Addressed: Ruling 4, gate required |
| N7 | TODO text above (orchestrator writes it) |
| N2, N4, N5, N6 | N2 Phase 6 walk; N4 Phase 4 addition 5; N5 and N6 are integration items (merge main; `AGENTS.md` fixed on main) |

---

# Phase 4 — loop-back 1 (full-stack-developer, 2026-10-25)

Source: "Phase 5: Verification (qa)" FAIL-1 and FAIL-2, plus "Phase 3 amendment 1" (Rulings 1 to 4, Phase 4 additions 1 to 5). `main` was merged first (`3db60f2`, no conflicts; this also takes main's `AGENTS.md` fix). Commits, in order:

| SHA | Subject | Closes |
|---|---|---|
| `626d88f` | `fix(events): refuse a non-boolean website switch in createEvent and updateEvent` | FAIL-2 |
| `cb9281a` | `fix(events): stop the Website listing buttons overflowing a 360px screen` | FAIL-1 |
| `8eecf3a` | `fix(events): say only what the row knows in the series toasts, the extend line and the empty calendar` | Rulings 1, 2 and 4 (copy, N3) |
| `46f958a` | `test(events): pin the public calendar's typical-case HTML size` | Ruling 3, addition A |
| (this commit) | `docs(work-log): …` | addition 5 (QA N4) |

## FAIL-2 (events.ts)

`createEvent` and `updateEvent` now require `typeof isPublic === "boolean"` and `typeof websiteListed === "boolean"` and return `invalid_input` otherwise, as the first check after the permission check (before any read or write). The audit row in `updateEvent` is therefore compared only against a value that was actually written. The message ("Choose whether this event is open to everyone and whether it appears on the website.") is unreachable from the forms, which always send booleans; it follows the wording of the series action's own `invalid_input`.

Failing-first (recorded before the fix): 12 of the 85 tests in `src/lib/events.test.ts` failed, all in the new block "regression for a payload that omits or mistypes the website switch (Phase 5 FAIL-2)": `updateEvent` with `websiteListed` omitted, a string, a number and null (each expected `invalid_input`, column unchanged, no extra audit row); the untick-"open to everyone"-with-the-field-omitted case (threw the uncaught `23514`); `isPublic` omitted and a string; `createEvent` with the same four `websiteListed` values and a string `isPublic` (the null case failed with `23502` not-null). After the fix all 85 pass; the "an update that does not change the listing writes no audit row" case passes before and after, as a control.

## FAIL-1 (series-website-listing.tsx)

The two trigger buttons take `h-auto min-h-11 w-full whitespace-normal py-2 text-center sm:w-auto` on the instance (the generated `Button` is untouched): full width with a wrapping label on a phone, natural width from `sm`. New e2e, "the event detail page does not scroll sideways at 360px with the Website listing section showing - regression for Phase 5 FAIL-1" (`e2e/public-calendar.spec.ts`): a 4-occurrence marked series, the third occurrence unmarked by SQL so that both buttons show on the second occurrence's page; asserts `scrollWidth <= 360`, each button's right edge <= 360 and height >= 44. It failed on `scrollWidth` against the unfixed component and passes with the fix.

## Amendment 1 (strings, N3, ceiling)

- **Strings, exact as ruled:** `putToast` "{n} event(s) marked for the website." (+ " {s} left out."), `takeToast` "{n} event(s) no longer marked for the website.", E8 `extendWebsiteLine` "… will be marked for the website, like the latest one in this series." (three forms), P2 "No events are on this calendar right now. Please check back soon." Stale strings updated at: `series-website-listing.test.tsx` (put and take toast expectations), `extend-series-form.test.tsx` (the negative regex and four positive strings), `public-events-calendar-slot.test.tsx` (`EMPTY`), `e2e/public-calendar.spec.ts` (`EMPTY`, the "3 events no longer marked for the website." toast). A final grep of `src`, `e2e`, `scripts`, `docs/release-notes` and `docs/product` for the old strings finds only the unchanged E7 button, dialog and form-hint wordings (the act, left alone by Ruling 1) and a test title ("cannot be put on the website from the form", about the act).
- **N3:** `disabled={!hydrated || pending}` on both trigger buttons, via `useHydrated`. Unit test: `renderToString` shows both buttons `disabled` (red when `!hydrated ||` is removed; restored), and mounted in jsdom they are enabled.
- **The click-retry in the series e2e was kept, deliberately, with its comment corrected.** The amendment says to drop it if it existed only for the hydration reason. It does not: with the gate in place and the test waiting for `toBeEnabled()`, a click straight after the client-side navigation to the occurrence page still did not open the dialog (reproduced; a 2.5 s pause also fixed it), so the page re-renders once more under the click, gate or no gate. The spec now waits for the button to be enabled, then retries. Worth a look in Phase 6 or the retro as a possible dev-mode double-request (the dev log shows the occurrence page requested twice), not chased here.
- **Addition A:** `public-events-calendar-size.test.tsx`. A 2-event, 14-month window renders **321,865 bytes** of HTML (`renderToString`, no flight data); ceiling = x1.25 = 402,331, rounded up to the next 10 KB = **410,000**. Mutation check: lengthening the class string of every day (+30%, 420,271 bytes) turns it red; restored. (QA's 774 KB figure includes the flight copy, which `renderToString` does not produce; the two are consistent with a roughly doubled payload.)
- **N4:** the template placeholder block is replaced by "Files, schema, audit" above. The Payload sentence in Batches 2 to 4's browser checks says only that the dev figure was about 840 KB and "the design accepts a payload of this order"; it does not repeat the withdrawn claim, so it stands. Phase 3 line 777 is history and is superseded by amendment 1, Ruling 3.

## Gates

| Gate | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 (`--max-warnings=0`) |
| `npm run check` | all eight tripwires pass |
| plain `npm test` | 562 files passed, 78 skipped; 8753 tests passed |
| `npm run build` | passes; `node_modules/node_modules` absent afterwards |
| DB-backed: `events.test.ts`, `public-calendar.db.test.ts` (`--no-file-parallelism`) | 2 files, 99 tests passed |
| e2e on :3500 (own `next dev` from this worktree; stopped by PID; no reload loop this time), `chromium` + `custom-hosts`: `public-calendar` (incl. the new 360px case), `custom-domains/public-calendar`, `hydration/public-events-calendar`, `member-calendar` | all passed (member-calendar in the first run: 39 passed, the one failure there was the series-panel click race described above, since fixed) |

Not re-run (no migration, definer, window, panel structure or island change): the full DB set, RLS section 67, the full chromium, custom-hosts and production lanes.

## For QA re-run

Re-run the scope listed in "QA re-run scope" in amendment 1. The new tests: `events.test.ts` (the FAIL-2 block), `series-website-listing.test.tsx` ("before hydration"), `public-events-calendar-size.test.tsx`, and the FAIL-1 case in `e2e/public-calendar.spec.ts`. Use an isolated server if another pipeline is active (N7). The new `fix(events)` commits all carry `Caught-By: agent-review` / `Discovered-In: Phase-5`.

---

# Phase 5: Verification, run 2 (qa)

**Date:** 2026-10-25
**Verified by:** qa
**HEAD:** `1360f76` on `pipeline/public-events-calendar`. This includes `3db60f2`, which merged main at `3af650a`.

**Main has moved since that merge.** `origin/main` is now 8 commits ahead (PR #54, the create-organization hydration gate, admin only). None of those files overlap this pipeline. The PR's CI run on the merge result is the authority for the combined tree.

**Auth gate does not apply.** `git diff origin/main...HEAD` touches no auth, proxy or layout file, and no shared component. The `src/auth.ts` changes in `8a56f06..HEAD` come from main, not from this pipeline. So the stricter auth gate is not triggered.

**Scope run**, following amendment 1's "QA re-run scope" plus the coordinator's request:
- **Gates:** typecheck, lint, `npm run check` and plain `npm test`.
- **DB-backed:** `src/lib/events.test.ts` in full.
- **Failing-first by mutation:** FAIL-2 (unit, in a scratch copy), FAIL-1 (its e2e, in the isolated copy) and the size ceiling.
- **Full `--project=chromium` e2e**, which includes `public-calendar`, `hydration/public-events-calendar` and `member-calendar`.
- **`custom-domains/public-calendar.spec.ts`** on the custom-hosts project.
- **Every calendar spec forced to 360px**, plus my 360px editor walk with screenshots.
- **A click-timing investigation** of the series retry.
- **The copy re-grep.**

**Not re-run:**
- The full DB-backed set, RLS section 67, the custom-hosts project apart from the calendar spec, and the production lane. Nothing they cover changed: no migration, definer, window or panel change, and the island, panel and model files are unchanged since `8a56f06` (`git diff` is empty).
- The payload measurement. Ruling 3 stands on run 1's figures.

All of that rests on QA run 1 and the implementer's loop-back gates.

**Isolation (N7):**
- The e2e ran against my own `next dev` on :3500.
- That server was started from a byte-identical `git archive HEAD` copy, kept in a directory with no sibling projects, with the same `.env.local` and the same `DOMAINS_*`, `RATE_LIMIT_DISABLED` and `CRON_SECRET` environment as run 1. A probe of `/signin` showed no reload loop.
- I stopped the server by PID and deleted the copy.

**Flag state:**
- Before e2e I reset the global flags with `psql "$PLATFORM_DATABASE_URL" -v ON_ERROR_STOP=1 -v pipeline_branch=1 -f scripts/ci/e2e-reset-flags.sql`, using the branch's copy, which is main's, against this branch's database only.
- 39 seeded flags were set. The state was already at the baseline (no diff).
- The flags were still at the baseline at the end.

## Type Check

- `npm run typecheck`: **PASS**.
- `npm run lint`: PASS.
- `npm run check`: PASS, all 8 tripwires.
- `node_modules/node_modules` is absent.

## Unit Tests

- **Plain `npm test`:** 562 files passed and 78 skipped (the DB-backed files, by design); 8753 tests passed, 0 failed.
- **Affected files, run by themselves:** `series-website-listing.test.tsx`, `extend-series-form.test.tsx`, `public-events-calendar-slot.test.tsx` and `public-events-calendar-size.test.tsx`. 4 files, 43 of 43 passed, including:
  - "before hydration: renders both trigger buttons disabled in the server HTML";
  - "enables them once mounted";
  - the size ceiling.
- **`src/lib/events.test.ts`, DB-backed:** 85 of 85 passed.

## End-to-End Tests

| Run | Total | Passed | Failed | Skipped | Duration |
|---|---|---|---|---|---|
| `--project=chromium`, isolated :3500 | 432 | 432 | 0 | 0 | 18.5m |
| `custom-hosts` (`custom-domains/public-calendar.spec.ts`) | 8 | 8 | 0 | 0 | 17s |
| Calendar specs forced to 360px (platform and custom host) | 25 | 25 | 0 | 0 | 59s |

**Real-browser look at 360px** (QA scratch editor walk, Chromium mobile emulation, screenshots read):

| Screen | `scrollWidth` |
|---|---|
| New-event form | 360 |
| Event detail page with Website listing | 360 (was 374 in run 1) |
| Take dialog | 360 |
| Put dialog | 360 |
| Events list | 360 |

- **Detail page:** an element scan found nothing past 360px. Each trigger button is full width with a wrapped two-line label, at least 44px tall, and reads cleanly.
- **Dialogs:** they fit the screen. The toast reads "4 events no longer marked for the website."
- **Extend line:** reads "New events will be marked for the website, like the latest one in this series."
- **iOS Safari is still not verified.** That stays with the Phase 6 walk.

## Regression Tests Added

Failing-first was verified by mutation in scratch copies; the worktree was not touched.

- **FAIL-2 block:** `src/lib/events.test.ts:1278`, "regression for a payload that omits or mistypes the website switch (Phase 5 FAIL-2)". It guards both writers against an omitted, string, number or `null` `websiteListed`, and against an omitted or string `isPublic`.
  - **Mutation:** `switchesAreBooleans` forced to `return true` (the pre-fix behaviour).
  - **Result:** **12 failed** (all 12 FAIL-2 cases). Restored: **85 of 85 pass**.
  - **What it asserts:** the property, not just the fix: `invalid_input`, the column unchanged, and no extra audit row. It also covers the "omitted while unticking Open to everyone" case, which threw `23514` before the fix.
- **FAIL-1:** `e2e/public-calendar.spec.ts:442`, "the event detail page does not scroll sideways at 360px with the Website listing section showing - regression for Phase 5 FAIL-1".
  - **Mutation:** `TRIGGER_CLASS` set back to `"min-h-11"` in the isolated copy.
  - **Result:** red, "Expected: <= 360, Received: 374". Restored: green.
- **Size ceiling:** `src/app/(public)/site/[slug]/public-events-calendar-size.test.tsx`.
  - **Mutation:** about 300 bytes of attribute padding added to every day `<section>`.
  - **Result:** red, "expected 457333 to be less than 410000". Restored: green.

## Coverage on Critical Modules

- `src/lib/permissions.ts`: 100% (unchanged; run 1).
- `src/lib/two-factor.ts`: 91.3% (unchanged; run 1).
- `src/lib/flags.ts`: 100% (unchanged; run 1).
- Not re-measured: the loop-back changed only `events.ts` (DB-backed), one client component and copy.

## Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct key? |
|---|---|---|---|
| `createEventAction` / `updateEventAction` (lib changed by FAIL-2) | yes (`resolveActingIdentity`) | n/a (tenant) | `events.manage` is checked first (`events.ts:517`, `676`). The new boolean check runs after the permission check and before any read or write, so a forbidden caller still gets `forbidden`. |
| `setSeriesWebsiteListingAction` | yes | n/a | Unchanged since run 1. |

No other protected routes were touched.

## Copy Truthfulness

- [x] **Every changed string matches amendment 1, Rulings 1 and 2, word for word.**
  - `series-website-listing.tsx:38` "{n} event(s) marked for the website." (+ " {s} left out.")
  - `:43` "… no longer marked for the website."
  - `website-listing-copy.ts:60,62` E8, "… will be marked for the website, like the latest one in this series."
  - `public-events-calendar-slot.tsx:81` "No events are on this calendar right now. Please check back soon."
- [x] **The source behind each claim was opened.**
  - The toasts are built from the action's **returned** `SeriesListingOutcome` (`series-website-listing.tsx:87`, `putToast(result.data!)` / `takeToast(result.data!)`). "Marked" is exactly what the write established.
  - E8 comes from `inheritedListing` ANDed with the parent's `isPublic`, the same rule the extend write uses.
  - P2 is reachable only through a successful read with an empty 14-month window. "Right now" claims nothing about history.
- [x] **Roles.**
  - Toasts and E8 are read by an `events.manage` holder (the page requires it). They contain no instruction.
  - P2 is read by an anonymous visitor. "Check back" and "call us" are things a visitor can do.
- [x] **Re-grep for the old strings** ("put on the website", "taken off the website", "No events have been posted", "posted on this calendar", and "yet" in the calendar trees) over `src`, `e2e`, `scripts`, `docs/release-notes` and `docs/product`. Only one survivor remains: the test title at `e2e/public-calendar.spec.ts:473`, "cannot be put on the website from the form". It names the act, as Ruling 1 allows. The E7 button and dialog wordings that remain are the act strings Ruling 1 deliberately left alone. Nothing stale is left.

**copy truthfulness: PASS**

## The kept click-retry: does it hide a real defect?

**No. It hides a test race, not a product defect.** The work-log's explanation is wrong, though: "the page re-renders once more under the click".

**What actually happens:**
- After `children.first().click()`, the spec waits with `page.waitForURL(/\/admin\/events\/[0-9a-f-]{36}$/)` (`e2e/public-calendar.spec.ts:414`).
- That pattern **already matches the parent event's URL**, so the wait returns before the client-side navigation commits.
- The parent page also shows "Website listing" and an enabled "Take this and later events off the website" button.
- So the first click lands on the **parent's** button. Its dialog ("Take 4 …") opens, and then disappears when the child page replaces it.
- The retry then clicks the child's button ("Take 3 …").

**Evidence:** a QA scratch harness that creates the series exactly as the spec does, with a single click and no retry.

| Harness variant | Where the click landed | Dialog shown | Dialog stays open |
|---|---|---|---|
| The spec's wait (5 trials) | the parent URL, 5/5 | "Take 4 events off the website?" | no, it closes on its own, 5/5 |
| Waiting for the URL to change from the parent (5 trials, including 0ms delay) | the child | "Take 3 events off the website?" | yes, 5/5 |

- A single tap on the **child's** enabled button opened the dialog and kept it open in **every** trial: 5/5 after creation, 6/6 after a client-side navigation from a freshly loaded parent at delays of 0–1000ms, and 3/3 after a full page load.
- **What a real user sees:** someone who taps the old page's button during a navigation that is still pending gets that page's dialog, and it vanishes when the new page lands. Nothing is written unless they confirm, and a confirm acts on the event that was on screen. That is ordinary client-side navigation behaviour, not a lost tap.
- The same wait pattern at `:458` (the FAIL-1 test) is harmless. Both pages carry both buttons in that fixture, so the 360px assertion is valid on either.

## Verdict

**PASS.**
- FAIL-1 is closed: 374 → 360, with a regression test proven to fail before the fix.
- FAIL-2 is closed: 12 regressions proven to fail before the fix, now 85 of 85 green.
- The amendment's strings, the N3 gate and the size ceiling are verified.
- Every suite in scope is green, including the full chromium run on the merged-main tree (432 of 432).

**Non-blocking notes:**
- **R2-N1 (cleanup for the implementer at the next touch; not a defect).** At `e2e/public-calendar.spec.ts:414`, wait for the URL to differ from the parent's, or for the child's own heading, instead of the generic event-URL pattern. Then drop the retry and correct the comment above it. As written, the retry would also hide a genuinely lost tap on the child page. My harness shows there is none today.
- **R2-N2.** The work-log's suggestion that this is a "possible dev-mode double-request" is not the cause. The double RSC request to the parent route is the create action's revalidation, and it is unrelated.
- **Carried forward from run 1:** iOS `<details>` stays with the Phase 6 walk (N2). The N7 and payload TODO lines are for the orchestrator (amendment 1, Ruling 5).

**Clean-up:**
- The worktree's `git status` is clean.
- Ports 3500 and 3501 are free.
- No `E2E Editor flow*` events, `e2e-pubcal*` organizations or `*pubcal*` site rows are left behind.
- Flags are at the baseline.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification (run 2) | qa | Complete. FAIL-1 and FAIL-2 closed; failing-first proven by mutation, including the size ceiling. Chromium 432/432 (isolated server, merged main); custom-host calendar 8/8; forced 360px 25/25; editor at 360px `scrollWidth` 360. Unit 8753; events.test.ts 85/85. Copy checks pass. The click-retry hides a test race (`spec:414` waits on a URL pattern the parent page already matches), not a user defect. Flags reset to the CI baseline. | PASS | 2026-10-25 |

## Handoff

**Next: analyst (Phase 6).** Carry into the walk:
- iOS `<details>` (N2);
- the 360px walk on both host modes;
- R2-N1 as an optional spec cleanup for the implementer.

The orchestrator still holds the integration items: the RLS patch, the journal entry, decisions, TODO lines including N7 and the payload line, and a main re-merge before the PR.

Files referenced:
- /Users/cshenso/git/presby-platform/presby-cal/e2e/public-calendar.spec.ts
- /Users/cshenso/git/presby-platform/presby-cal/src/lib/events.ts
- /Users/cshenso/git/presby-platform/presby-cal/src/app/(org)/o/[slug]/admin/events/series-website-listing.tsx
- /Users/cshenso/git/presby-platform/presby-cal/src/app/(public)/site/[slug]/public-events-calendar-size.test.tsx
- /private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/qa/run2/logs/click-ac-dev2.txt
- /private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/b5a17cb2-025b-40b4-8c4b-1774b6b74a3b/scratchpad/qa/run2/logs/editor-360/3-detail-parent.png
