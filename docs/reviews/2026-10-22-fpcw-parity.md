# fpcw-directory parity review — 2026-10-22

**Type:** fpcw-feature-match (follow-up to `2026-09-23-fpcw-feature-match.md`) · **Window:** fpcw-directory 2026-09-22 → 2026-10-19 (v2.15.53 → v2.15.84, through PR #52) · **Method:** read-only review of every merge and commit in the window against presby's code, functionality map and backlog.

## Operator rulings (2026-10-22)

- **Careers: PRE-CUTOVER.** It went live at FPCW after the cutover list was fixed; the operator confirmed it must work in presby by January 1 (new Track L).
- **Event sign-ups: IN USE at FPCW.** Moved from deferred to pre-cutover; their own backlog line.
- **Google Drive:** fpcw's careers module now writes resumes to a shared drive. Recommendation: presby keeps its own blob storage and the "Drive is link-only" answer (Q7) stands for presby. Pending explicit operator confirmation.

---

I reviewed fpcw-directory from 2026-09-22 to 2026-10-19: 18 merges and 63 non-merge commits, v2.15.53 to v2.15.84, ending with PR #52. I edited nothing. Four things matter most:

- **Two new features already in use at FPCW have no line in presby's backlog.** One is the careers module. The other is parish (deacon-district) management.
- **Two import traps for Track K.** fpcw's event visibility flag means something different from presby's flag of the same name. fpcw also stores event times differently.
- **Two earlier rulings may no longer hold.** fpcw now writes to Google Drive, which contradicts the settled "Drive is link-only" answer. Event sign-ups were treated as deferred (not in use), but FPCW is actively using them.
- **Nothing covers moving FPCW's sign-in accounts to presby.**

## Classification

| Group (fpcw source) | Class | Reason |
|---|---|---|
| Copy calendar month as an HTML table (2.15.53) | (a) | presby's member calendar already has Copy month |
| Notification emails go to the work address (2.15.55) | (b) Track C (line 35) | Amendment: the work-over-personal rule must also apply to outbound emails, not only to what the directory displays |
| Meeting schedules no longer start on a meeting already underway (2.15.56) | (b) Track A (line 33), A2 | Lesson for the schedule generator: skip an occurrence that has already started |
| Meeting invites addressed to the group's Google Group, migration 104 (2.15.57) | (b) Track D (line 36), D3 | Amendment: store how each series was addressed; reconcile must never rewrite it |
| Groups visible to all members, plus a per-type `visible_to_all_members` flag, migration 103 (2.15.57) | (b) line 282 (member-facing group page) + Track A | Amendment: add the per-type visibility flag; Parish and Care Team types start restricted |
| App version and build time in page metadata (2.15.58) | (d) | Operational nicety, not parity |
| **Careers**: postings, public apply form, resumes, 1-year retention purge, manual ordering, Personnel committee access (2.15.59 to 2.15.64, 2.15.69, PR #43 2.15.75; migrations 105, 106) | **(c)** | Live in production since 2026-09-29; nothing in presby |
| Phone receipt picker no longer forces the camera (2.15.63) | (b) Track R (line 37) | Design note: never put `capture=` on receipt inputs |
| Member photo caching (2.15.63) | (d) | Photos belong to Track J (post-cutover) |
| Groups search finds subgroups (2.15.67) and finds people (PR #40, 2.15.72) | (b) Track C, C3 | Amendment: search by person, but only where the group page and the directory would both show them |
| Mailchimp sync skips unsubscribed/bounced contacts; API key scrubbed from stored errors, migration 107 (2.15.68) | (b) Track H (line 45) | Amendment below; affects the import |
| **Public events web component** for the church website (PR #38, 2.15.70) | **(c)** | presby's public event calendar is listed as "NOT built" in the functionality map, but has no TODO line |
| Synced Google Groups readable by their own members (PR #39, 2.15.71) | (b) Track D, D2 | Settings detail: members can view the group, not only people in the domain |
| Room Bookings chip includes meetings with a room (PR #41, 2.15.73) | (b) Track A, A5 | presby has no rooms yet |
| Dependabot updates, CI heap fix, migration 063 guard, iOS scaffold removal, periodic reviews (PR #42 and others) | (d) | fpcw housekeeping |
| Group-derived roles follow account link/unlink (PR #43) | (a) | presby resolves group-granted roles live, so a newly linked account gets them automatically |
| **Parish moderator management** (PR #44, 2.15.76) and **bulk move** (PR #45, 2.15.77) | **(c)** | presby has `org_units` and `households.org_unit_id` but no way to assign, move or list households; line 309 covers only a roster page |
| **Forgot-password guidance when there is no account** (PR #46, 2.15.78) | **(c)** | Folded into a new account-onboarding line below |
| Wall-clock "church time" fix (PR #47, 2.15.79) | (a) | presby already handles wall-clock times; but see the Track K trap below |
| Event creation pass-over (PR #48): a room on the event | (b) Track A5 | Amendment: book the room inside the event's own save, with a conflict check |
| Event creation pass-over (PR #48): three-way audience choice | (b) line 287 | fpcw now offers everyone / members only / selected groups or roles, which is the design line 287 asks for |
| Session and Deacons may create, edit and publish events (DECISION-187) | (a) | presby can grant roles to groups; this is cutover configuration |
| Events follow-up sweep (PR #49) | (a)/(d) | Mostly fpcw-local fixes; the template and sign-up parts depend on sign-ups (see below) |
| Sign-in callbackUrl XSS fix (PR #50) | (a) | presby's `sanitizeCallbackUrl()` already covers it |
| Sign-in "Last used" hint (PR #50); simpler sign-in page (PR #51) | (d) | presby's sign-in is its own design. Revisit the hint only if Google sign-in turns on at cutover |
| Reimbursement: Board of Deacons on the committee list, approved by its Moderators (PR #52, 2.15.84) | (b) Track R | Amendment: the approver can be a seat in a group (Chair, Elder Liaison, Moderator), and no one approves their own request |
| Side fix in PR #40: search no longer treats `%` and `_` as wildcards | **(c)**, small bug | presby has the same bug: `src/lib/directory.ts:330-334` puts raw user input inside an `ilike` pattern (24 `ilike` sites) |

## Drafted TODO lines for the (c) items

```
- [ ] **Track L (proposed) — careers: job postings and applications. PRE-CUTOVER if the operator confirms it is in use (it has been live at FPCW since 2026-09-29, after the cutover list was fixed).** Staff create, publish, close and manually order postings, pasting in rich text. A public list and posting page, and an unauthenticated apply form with a resume upload, a signed form token, a honeypot field, a minimum time-to-submit and a rate limit. Two separate permissions: manage postings (sees only the application count) and view applicants (every field, open or delete the resume). A 1-year retention purge that starts when the posting closes, plus an audit trail that stores no applicant personal data. A committee gets access through a role granted to its group, and a Home tile shows a 7-day new-applications badge. In presby this should be native public-site pages under `(public)/site/[slug]`, not a web component embedded in another site, and resumes should go to `src/lib/storage`, not Google Drive (fpcw's Drive write client contradicts the settled "Drive link-only" answer, Q7). Track K: import open postings; decide whether to import in-retention applications or leave them to expire in fpcw. — fpcw-directory `docs/modules/careers/{careers,personnel-access-and-applicant-review,posting-sort-order}.md`, `drizzle/migrations/105_careers.sql`, `106_careers_posting_sort_order.sql`, `src/lib/careers/`, `public/careers-embed.js`, `src/lib/jobs/purge-job-applications.ts`, PR #43 (2.15.59–2.15.75)
- [ ] **Public event calendar on the congregation's public site (events Increment 4). PRE-CUTOVER: FPCW's website shows a portal-fed events calendar today (2.15.70), and that website moves to presby on day one (Track F).** A month grid that switches to a list on narrow screens, fed only by events that are explicitly published to the website. Rendered as a `liveSlot` block on `/site/<slug>`, so it needs no cross-origin feed. Before building, settle what "published" means: presby's `events.is_public` already controls this, but fpcw's `is_public` means "everyone who signs in", and fpcw publishes to the website with a separate switch (see the Track K line below). — fpcw-directory `docs/modules/events/public-events-embed.md`, `src/lib/events/embed.ts`, `public/events-embed.js`, DECISION-169/170/171, PR #38
- [ ] **Track C — parish (deacon-district) management. PRE-CUTOVER: in daily use since 2.15.76.** Assign a household to an `org_units` district and move it between districts; an Unassigned view of households with no district, led by members and community non-members, with per-group counts and the rest hideable; move every household out of an archived district to one successor in a single confirmed action (capped at 100). Authority comes from holding the Moderator seat on the Board of Deacons, not from a grant to a named person, and the scope is checked before the household's current state. Every move is audited. presby has the columns (`households.org_unit_id`, `officer_terms.org_unit_id`) but no way to write them and no screen to manage districts. Extends line 309 (per-parish roster). — fpcw-directory `docs/modules/groups/{parish-moderator-management,parish-bulk-move}.md`, `src/lib/groups/{parish-authority,parish-assignment,unassigned-households}.ts`, `src/app/(dashboard)/parishes/`, DECISION-179/180/181, PRs #44, #45
- [ ] **Track K — moving members' sign-in accounts at cutover.** fpcw has dozens of portal accounts, a large share Google-only with no password, and some members with two accounts. Members also self-register: fpcw links an account by matching the email address to a living member's record. presby has invitations (v0.37) and no self-registration. Decide whether accounts are imported (users linked to people through `church360Id`), invited in bulk, or recreated by a self-claim flow. Port fpcw's no-enumeration forgot-password guidance: the screen looks the same for every address, and the email tells the owner "this address signs in with Google", "you have an account under another address", or "register with this address". — fpcw-directory `docs/modules/security/forgot-password-no-account-guidance.md`, `src/lib/auth/forgot-password.ts`, `src/lib/email/account-guidance.ts`, `src/lib/members/email-match.ts`, DECISION-182/183, PR #46
- [ ] **Track K — event import traps.** (1) Visibility does not map one-to-one: fpcw `is_public=true` means everyone who signs in, and website publication is a separate `publish_to_google_calendar` flag. presby `is_public` should come from `publish_to_google_calendar AND is_public AND NOT members_only`; copying `is_public` across would put every members-visible event on the public website. (2) fpcw stores times as UTC instants in a no-timezone `timestamp` column; presby stores wall-clock digits. Convert to the organization's time zone on import, and spot-check rows written before 2.15.79, which a browser outside Eastern time may have shifted. (3) For meeting series already synced to Google, carry the series ids and the stored addressing mode so presby adopts the existing Calendar series instead of creating a second one. — fpcw-directory `src/lib/db/schema.ts` (`events`), `src/lib/church-time.ts`, migration 104, DECISION-163/186
- [ ] **Directory search treats `%` and `_` as wildcards.** `src/lib/directory.ts:330-334` puts the typed text straight into `ilike '%…%'`, so a search for `%%` matches every row. Low severity (only `directory.view` holders can search), but fpcw fixed the same defect across eight callers. Add an escape helper and use it at every `ilike` site. — fpcw-directory `src/lib/like-pattern.ts`, DECISION-174, PR #40
```

**Amendments to existing lines (b), in short:**
- **Track H:** never re-subscribe a contact Mailchimp lists as unsubscribed or cleaned. Never store the SDK's error object (it carried the API key). Import fpcw's per-member Mailchimp status (`members.mailchimp_status`) as a suppression list.
- **Track A:** add the per-type visibility flag to `group_types`, and book a room inside the event's own save with a conflict check.
- **Track D2:** synced groups are readable by their own members.
- **Track R:** approval can come from a seat in a group (Moderator included); self-approval stays excluded.

## Surprising findings

1. **Event sign-ups look like they are in use.** The cutover model lists `event_signups` among the deferred tables. But PR #48 calls the event form "the sign-up path", PR #49 fixes cancellation emails sent to people who signed up, and DECISION-187 opened event creation to Session and Deacons in production on 2026-10-19. presby has no sign-ups, waitlists or event templates. Under the rule "deferred means unused", the operator should confirm this one.
2. **The Drive ruling (Q7) is out of date.** fpcw's careers module added a Drive client that writes and deletes files in a shared drive. Recommend that presby not follow it (resumes go to the blob store).
3. **Careers arrived after the pre-cutover list was fixed,** so under the hard-cutover rule it needs an explicit in-or-out decision.
4. **Parish data model for the import.** fpcw parishes are groups of type Parish, households point to them through `households.parish_id`, some parishes are archived, and authority comes from the Moderator seat on the Board of Deacons. presby uses `org_units`. Track K must map: Parish groups to `org_units`, each household's parish to `households.org_unit_id`, each parish's Deacon seat to `officer_terms.org_unit_id`, and decide how archived parishes come across.
5. **Role and visibility setup to reproduce at cutover:** the Personnel role granted through its group, event publishing for Session and Deacons, and the restricted Parish and Care Team types.
6. **fpcw's careers and events embeds both depend on one allowed-origin setting.** That setting disappears once the site is native to presby, which is another reason to build both as public-site pages rather than port the web components.