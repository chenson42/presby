# Worship service planning and volunteer scheduling: what other systems do

Research for PresbyPortal worship module, Phase 1 follow-up (`docs/work-log/2026-11-04-worship.md`).
Researched 2026-11-04. Scope: service planning and team or volunteer scheduling. Song files, CCLI and bulletins are covered only where they touch scheduling.

**Evidence labels used on every claim**

- **[V] verified.** I read it on the vendor's own site, help center, pricing data or source code.
- **[R] reported.** Third-party material: a church's how-to page, a review aggregator, a search-engine summary of a vendor page I could not open, or a vendor's marketing listing on another site.
- **[U] unverified.** My inference or background knowledge. Treat these as hypotheses.

**Access limits, stated up front**

- Reddit (r/churchtech, r/worshipleaders) is blocked to my fetch tool, so this report contains **no Reddit opinion**.
- Capterra, G2 and the CRCNA Network forum returned 403. Review sentiment below comes only from search-result excerpts, so it is thin and labeled [R].
- The Elvanto and Breeze Zendesk pages returned 403 in the browser fetch. I read them through Zendesk's public help-center JSON API, which gives the same article text, so they count as [V].
- The ChurchSuite help center (HelpScout) and its blog both returned 403 or a JavaScript wall. ChurchSuite is [R] throughout.
- The Pushpay/CCB, MinistryPlatform and Churchteams help centers did not surface usable articles. These products are thinly covered.
- Rock RMS is open source, so its claims come from the source code on GitHub (`SparkDevNetwork/Rock`). That is the strongest evidence in this report.

---

## 1. Comparison table

Legend: ✔ has it · ✖ documented as absent · ? not found or not verified. The bracketed letter is the evidence level.

| Product | Scheduling model | How a volunteer responds | Login needed to respond? | Blockouts / availability | Conflict handling | Auto-schedule | Leader schedules own team? | Minors / household | Channels | Ties to calendar or attendance | Price model |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Planning Center Services** | Service Type → Plan (dated) → Times (service and rehearsal) → Teams → Positions → plan person (C/U/D) [V] | Email Accept/Decline; app; Church Center; SMS-gateway short links [V] | Accept "automatically sent" from email. Decline goes to the Services site. Login on that step is not documented [V]/[U]. Church Center is passwordless, a 6-digit code by email or text [V] | Personal, recurring, household, reason shown to leader. **Warns, does not block** [V]. Blockout-request emails [V] | Overlap across service types, including linked orgs, excluded by the auto-scheduler. Warning on manual scheduling [V] | ✔ last-served, preferences, blockouts, team limits per week/day/month, background check on "secure teams", undo [V]. Auto-reschedule on decline [V] | ✔ the "Scheduler" level can schedule only teams they lead [V] | Household: a parent views, responds and blocks out for a child, and gets copies of the child's emails. Under-13s cannot log in to Church Center [V] | Email, push, chat, SMS gateway (being dropped by carriers) [V] | Plans are their own product. Not calendar events [V]/[U] | Billed per person who can log in: 5 free, 20 for $15, 50 for $32, 150 for $69, 400 for $115, 1000 for $179, unlimited for $239, with storage tiers [V] |
| **Elvanto / Tithely ChMS** | Service → Departments → Sub-departments → Positions [V] | Member area, app, email links [V]/[R] | Decline needs a member login and a **required** reason [V]. Email-link login is not confirmed [?] | Unavailability ranges (web and app). Per-department frequency preferences [V] | Conflict warnings, plus "non-conflicts" setup [V] | ✔ least-recently scheduled, location and service type, conflicts, unavailability. **Does not notify** the volunteer automatically [V] | "Reports To" per department or position gets confirm/decline alerts [V]. Permission scoping not checked [?] | Family unavailability [R] | Email, SMS, push. Follow-up to unconfirmed. Volunteers can opt out [V] | Notifies only on a **published** service. Calendar subscription [V] | Flat $72/month since 2023 [R] |
| **Breeze (Tithely)** | Volunteer roles on **calendar events**. Recurring schedules. Sign-up sheets [V] | "RSVP to Request" link in the schedule or reminder email. Same link later lets them **change** the response [V] | Not stated. Behavior (re-open the original email link to change) implies a person-bound link [V]/[U]. Sign-up sheet links are "unique… tied to their profile" [V] | Blockout calendar. Requestable by email. Shown at assign time [V] | ? | ? | Role "Leader" gets declines, picks a suggested replacement, and is the reminder sender [V] | ? | Email, SMS for reminders. Up to 3 reminders, 1 to 21 days out, "only to non-RSVPed" option [V] | ✔ volunteers sit on calendar events [V] | Worship Team Tools add-on $29/month [V]. Base ChMS price not checked |
| **Rock RMS** (open source) | Group (serving team) × Location × Schedule × date = occurrence. One `Attendance` row per person per occurrence. **Same table as check-in** [V] | Email or SMS "Confirm or Decline" → confirmation page. Schedule Toolbox (web, mobile) [V] | **No login.** The link carries an encrypted person GUID + action `ScheduleConfirm`. It is not single-use and has no expiry in code. Attendance IDs are plain params, checked to belong to that person [V] | Personal exclusions, optionally per group, with a "whole family" toggle. Group-type blackouts (holidays) [V] | Capacity min/desired/max is advisory in the UI and **not enforced server-side** [V] | ✔ from member preferences (schedule, location) [V] | Group-level security. A coordinator gets accept/decline/self-schedule notices [V] | Family blackouts [V]. Age rules via group requirements [V]/[?] | Email or SMS by preference. Daily job (default 4 pm) sends confirmations and reminders in offset windows [V] | ✔ the scheduled position and attendance are one row [V] | Free software. Self-host or hosted partners [V] |
| **ChurchSuite** (UK) | Rotas with dates. Accept/decline is a per-module switch [R] | Personal "Rota Page" link in every rota email, or My ChurchSuite [R] | The personal Rota Page appears to work without a full login [R]/[U] | Adding unavailability hides the earlier response and disables the buttons [R] | ? | ? | Overseers get decline notices [R] | ? | Email. Re-send only to non-responders or unsent [R] | ? | ? |
| **MB People / MB Service Planning** (Ministry Brands) | Schedules with dates, times, teams and positions. "Copy from previous" [V] | Email "Respond to Requests": accept all, decline all, or per item. Tentative state. SMS with separate accept and decline URLs [V] | **"No log-in is needed"** [V] | "Prefer this day" and unavailable dates in My Schedule [V] | ? | ? | Leaders can "Mark as… Confirmed" on behalf [V] | ? | Email, SMS [V] | ? | ? |
| **One Church Software** | Serving requests per assignment [V] | Link per assignment, by email or text. Accept, Decline (optional comment), Find Replacement, Swap [V] | **"A login is not needed to respond"**. Login only to view the plan [V] | ? | ? | ? | ? | ? | Email, SMS [V] | ? | ? |
| **Realm (ACS)** | Teams → roles → published schedules. Repeat assignments [V] | Connect app and web [V]/[R] | ? | Preferences, last-served, unavailable. Shown when picking [V] | "Unavailable" with reason on pick [V] | Recommends up to 5 people, not auto-fill [V] | ✔ leaders "with additional permissions" create and publish schedules [V] | ? | Text notifications [R] | ? | ? |
| **MinistryPlatform (ACS)** | Teams as Groups. Schedules in Volunteer Connect [R] | Accept/decline [R] | ? | ? | ? | ? | Leaders manage schedules [R] | ? | ? | ? | ? |
| **Pushpay ChMS (CCB)** | Positions, rotations, My Church App [R] | App [R] | ? | ? | ? | ? | ? | ? | Push [R] | ? | ? |
| **Fellowship One** | Bundles **WorshipPlanning.com** free with the ChMS (Deluxe: 5 planners) [V] | See WorshipPlanning.com | | | | | | | | | |
| **WorshipPlanning.com** | Teams, sub-teams, individuals. Drag-and-drop [V] | Text, email or Facebook, then accept or decline [V] | ? | Block out dates [V] | "Alert you of schedule conflicts" [V] | Finds the "most qualified and available", no auto-fill [V] | Leaders auto-notified of responses [V] | ? | Email, text, Facebook reminders [V] | ? | ? |
| **WorshipTools Planning** | Services → roles. People tab. Scheduling matrix [V] | Email invitation to accept or decline. Dashboard [V] | ? | "Unavailable Dates" (linked, not read) [V] | ? | ? | Alerts go only to the scheduler who placed the person [R] | ? | Email, push. **No SMS** [R] | ? | Free [V] |
| **Ministry Scheduler Pro (Rotunda)** | Publish months of schedule at once. Catholic liturgical ministries: lectors, EMHCs, servers [V] | App and web: view, request a sub, update availability [R] | ? | ✔ [R] | ? | ✔ "fair, balanced schedules… automatically" [V] | ? | "Family scheduling" [V] | Text, email, push [V]/[R] | ? | about $50 to $65/month [R] |
| **SignUpGenius** (baseline) | Volunteer-picked slots [V] | Click the link, pick a slot [V] | **No account** for participants [V] | n/a | n/a | n/a | n/a | n/a | Email and text reminders [V] | n/a | Free with ads. Paid removes ads [V] |
| **Sundays and Seasons (ELCA)**, LabOra, RitePlanning, Lutheran Service Builder | **Content planners, not schedulers.** Lectionary, liturgy, hymns, then download into Word or PowerPoint for the bulletin [V]/[R] | No volunteer scheduling found [V]/[R] | | | | | | | | | S&S $269 to $799/year by attendance [V] |

---

## 2. Per-product notes

### 2.1 Planning Center Services (the reference)

**Object model [V].**
- A Service Type has Plans (dated).
- A Plan has Times. Service times and **rehearsal times** are both first-class. Teams are assigned to times, and "assigning teams to times also lets you see any conflicts."
- Items make up the order of service.
- Teams have Positions, and plan people sit in those positions.
- The API object `PlanPerson` has `status` C/U/D (Confirmed, Unconfirmed, Declined), `decline_reason`, `notification_prepared_at`, `notification_sent_at`, `notification_read_at`, `prepare_notification`, `can_accept_partial`, `scheduled_by`, and `responds_to`. `responds_to` is the leader who receives the reply. [R: read from a third-party client library generated from the API (2018-11-01 version), not the official docs.]

**The "prepared" (draft) state [V].** Scheduling someone does not notify them by default. Notifications are "Prepared" per team. Until the email is sent:
- an unconfirmed scheduled viewer cannot see the plan or find it on My Schedule;
- conflict warnings are suppressed for those dates.

The leader sends from the plan's Teams tab: per person, per team, the whole plan, or many plans from the Matrix. The leader can edit the message first. Automatic reminders (below) clear the prepared state.

**Responding [V].**
- In the email, Accept sends the response "automatically" to the scheduler.
- Decline "takes you to the Services website, where you can add a decline reason." The volunteer can also pick a replacement if the team allows it.
- Several requests in one email lead to "Respond To Requests" in Services, with a response per position or time.
- After confirming, a person can decline from My Schedule, which notifies the leader. **They cannot re-accept themselves.** Declined positions vanish from their schedule, and the leader must re-add them.
- The help pages never say whether Accept-from-email needs a login. A reviewer praised "ease for them sending accept/deny instantly" [R]. That suggests the accept link is person-bound. [U]

**Login model [V].**
- Church Center (the member app) is **passwordless**: a 6-digit code by email, or by text in the US and Canada.
- "Users under 13 years of age cannot log in to Church Center."
- Staff Services login uses a password.

**SMS [V].** Texts go through a free "email-to-text SMS gateway" that "carriers such as Verizon and AT&T have stopped supporting." Planning Center now recommends in-app notifications. Scheduling texts carry short accept and decline links. The pricing page separately lists a paid texting product at $0.02 per text [V].

**Blockouts [V].**
- Volunteers set them from web My Schedule, mobile, profile or Church Center.
- They can repeat (weekly, monthly by weekday or date). Editing a repeat as one, future or all works on the web only.
- They can apply to household members and to linked accounts at other churches.
- They apply to all teams. Per-team availability is a "scheduling preference" instead.
- **The leader sees the reason**, and scheduling into a blockout **warns, does not block**.
- "Blockout request" emails ask a team to enter dates before scheduling. A "Last Set Blockouts" column shows who has responded.

**Auto-schedule [V].**
- **Removes** from consideration anyone with a blockout, anyone at an overlapping time in any service type (including linked orgs), anyone who already declined this plan, anyone over a team limit (every N weeks, per day, per month), and anyone without a background check on secure teams.
- **Ranks** first by scheduling preference (for example "schedule me when [spouse] is scheduled"), then by longest since last served (anywhere, this team, or this position), with a random tie-break.
- Undo is available until you leave the page.
- Teams can **auto-reschedule declines**: either auto-request the next person, or email a signup-sheet link to same-position members. [V, 2024 blog]

**Reminders [V].** Automatic reminders go out up to 7 days before. They go to confirmed and unconfirmed people, never declined. They are configurable per time and per team. Same-day reminders are condensed. They include team plan notes.

**Permissions [V].**
- Levels: Scheduled Viewer, then Viewer, Scheduler, Editor, Administrator, Organization Administrator.
- **Scheduler = may schedule, auto-schedule, email and edit only the teams they lead.** Editor and above can do so for any team.
- Levels can be set per folder or per service type. Song, media and file access are separate.
- A Scheduled Viewer sees only plans they are on.
- Chats can be started by Schedulers for teams they lead.

**Household [V].**
- A parent's My Schedule shows children's requests, and the parent can respond, block out and sign up for them.
- An adult must grant permission before another adult manages their schedule.
- "Copy me on [child]'s emails" is available.

**Other features on the product page [V].** Signup sheets, household preferences ("serve alongside family or avoid serving together"), "Email My Leader", Matrix view, templates, Services LIVE, media player with parts and loops, Music Stand (a paid add-on), CCLI auto-reporting, chat.

**API [R].** There is a public JSON:API. Planning Center staff said there is **no supported API call to send the scheduling email** with Accept/Decline (GitHub issues #1475 and #1500). Only the automated reminders carry the buttons.

**Pricing [V], from the pricing page's embedded data.** "Pricing is based on the number of people who can log in. All plans include unlimited teams, service types, and plans."

| Team members | 5 | 20 | 50 | 150 | 400 | 1000 | Unlimited |
|---|---|---|---|---|---|---|---|
| Per month | $0 | $15 | $32 | $69 | $115 | $179 | $239 |
| Storage | 100 MB | 2 GB | 4 GB | 10 GB | 30 GB | 60 GB | 200 GB |

Music Stand is an add-on.

**User opinion [R].**
- "tough learning curve"
- navigation "cumbersome at times"
- price increases noted, which the vendor acknowledged
- "may offer more than you need" for small churches
- strong on Sunday scheduling

The sample is thin (aggregator excerpts only).

### 2.2 Elvanto / Tithely ChMS [V unless marked]

- **Structure.** Departments contain sub-departments, which contain positions (example: Creative Ministries → Band → Guitar, Keys, Bass, Drums). Self-assign can be turned off at each level.
- **Scheduling.** Drag a person onto a position inside a service. The list shows warnings for conflicts and for unavailability or preferences. "Call times" cover pre-service meetings.
- **Notifications.**
  - Automatic email or SMS (plus a push) when scheduled or unscheduled on a **published** service.
  - "Follow up unconfirmed volunteers" after a set period.
  - Reminders N days before to those who have not confirmed or declined.
  - Volunteers can turn these off ("Receive scheduling emails"). The docs warn that spam filters may block over-frequent sends.
- **"Reports To".** Per department, sub-department, position or person. The named person gets notified on confirm and decline. This can be set to declines only.
- **Decline.** "Log into the Elvanto as a Member… A decline reason is required."
- **Swap and replace.** The volunteer offers the slot to eligible people. The first acceptor wins, and others are told it is filled. Reports-To people are deliberately **not** told the reason ("to protect volunteer privacy").
- **Swap rule at one church [R].** Swaps are blocked within 2 days of the service.
- **Auto-schedule.** Least recently scheduled, filtered by location and service type, conflicts and unavailability. It **does not send notifications**; the admin must click "Contact Volunteers."
- **Preferences.** Volunteers set per-month and per-day maximums and per-department frequency. Leaders "can still use their discretion and ignore your preferences."
- **Tokens elsewhere in the product.** Elvanto's directory opt-in emails use tokens that "only work once and expire within 2 weeks". Respondents "do not need to login." I did **not** find that the roster emails use the same tokens.
- **Sign-in.** Volunteers can sign in with Google or Facebook.
- **Pricing [R].** Flat $72/month (Tithely FAQ, 2023).

### 2.3 Breeze [V]

- **Volunteers live on calendar events.** The path is Events → event → Volunteers, with Assign mode, Invite mode (signup sheets) and Grid view.
- **RSVP.** Schedules and reminders can include an RSVP option. A decline emails the role's Leader with **suggested replacements to click**, and the replacement gets "A volunteer vacancy has come up…".
- **Changing a response.** Volunteers change it by clicking "RSVP to Requests" **in the original email again**, which leads to "This RSVP request has already been responded to / Change Responses". So the link is long-lived and person-bound. [V behavior; token design U]
- **Signup sheets.** "Cannot be shared via a direct link… each volunteer receives a unique link tied to their profile."
- **Reminders.** Up to 3 per role, 1 to 21 days out. Optional SMS. Option to send "only to volunteers who have not RSVPed". They are sent **from the role's leader**, who also receives the replies.
- **Blockouts.** Collected by request email, by mail merge, by admin entry, or from a link at the bottom of reminders. Self-service in My Profile needs the "My Profile" and "View my Volunteer Schedule" permissions.
- **Worship Team Tools** (song library, SongSelect, worship app): $29/month à la carte, or included with All-Access.

### 2.4 Rock RMS (open source) [V from source code]

**Data model.**
- A scheduled position is an `Attendance` row on an `AttendanceOccurrence` (group, location, schedule, date) with `RequestedToAttend`, `ScheduledToAttend`, an RSVP state, a decline reason, and confirmation-sent and reminder-sent flags.
- The design doc's stated reason: "who was scheduled and who showed up can be compared without a join."
- Clearing a schedule **does not delete the row** (`ScheduledPersonClear`). This matches PresbyPortal's all-deletes-soft rule.

**Inputs are separate from the schedule.**
- Availability templates ("every Sunday 9am") on the group member.
- Preference rows (schedule or location) used by Auto Schedule.
- **Two-tier exclusions**: group-type blackouts (holidays) and person blackouts, with a "whole family" parent row.

**Confirmation logic.** "Ask" or "AutoAccept" per group type. Changing it mid-flight can leave someone with only a Decline button. The vendor docs warn about this.

**The response link.**
- The emailed URL is `ScheduleConfirmation?attendanceIds=…&Person={{ Person | PersonActionIdentifier:'ScheduleConfirm' }}`.
- `PersonActionIdentifier` is an encrypted string of `personGuid>action`. `GetByPersonActionIdentifier` decrypts it and checks the action name. There is **no expiry, no use count, and no tie to specific attendance rows.**
- The confirmation block does check that each attendance ID belongs to the decoded person before confirming or declining.
- A logged-in user viewing someone else's link sees "You are setting and viewing the confirmations for {name}."
- Older templates linked straight to `&isConfirmed=true` (a one-click accept by GET). Current templates include a **"One Button"** variant, "Required: Confirm or Decline", that lands on a page instead. Why the variant was added is not documented in what I read. [U: email-scanner prefetch is a likely reason. See 3.3]

**Sending.** A daily job (default 4 pm) sends confirmations and reminders whose occurrence falls in the configured offset windows. It never sends after the start time. A per-member reminder offset of −1 means no reminder. Email or SMS follows the member's preference.

**Capacity** (min, desired, max) is advisory in the UI and not enforced server-side. The project's own doc says so.

**Coordinator notifications** trigger on any combination of Accept, Decline and Self-Schedule.

### 2.5 ChurchSuite (UK) [R]

- Accept/decline is switched on per module, on by default for new rotas.
- Every rota email contains a link to the person's **personal Rota Page**, where they can accept or decline. My ChurchSuite (logged in) also works.
- Members start "pending (unsent)" until the rota is sent.
- Re-sends can target only non-responders.
- Adding unavailability **hides** the earlier response and disables the buttons. Removing it restores the response.
- Swaps work "on a trust basis" with **no recipient approval**.
- One church says a leader can set status manually for people who have trouble responding.

### 2.6 Ministry Brands (MB People / MB Service Planning) and One Church [V]

- **MB People.**
  - Statuses: Accepted, Declined, Pending (Notified), "Not Notified (No email address!)", Not Notified, Unfilled.
  - "Send Invites" per team, time or date.
  - The email's "Respond to Requests" link handles accept all, decline all, or per item. **"No log-in is needed."**
  - Leaders can "Mark as… Confirmed."
  - "Copy volunteers from previous" fills a date.
  - "Contact" emails everyone scheduled for a position, team, time or date, filtered by status.
- **MB Service Planning.** Accept, **Tentative** or Decline from the email. SMS carries separate accept and decline URLs. The volunteer can "prefer this day" and mark unavailable days.
- **One Church.** "A login is not needed to respond to serving requests". Login is needed only to see the service plan. Options are Accept, Decline (optional comment), Find Replacement, and Swap.

### 2.7 Realm (ACS) [V]

- Only administrators and holders of **Manage Schedules** assign people.
- The picker recommends up to 5 people by preferences and last-served date, and shows "Unavailable" with a reason (pending role approval, served recently, marked unavailable).
- An admin can accept on a volunteer's behalf, choosing all dates or one.
- Declines show struck through with the reason.
- Assignments can **repeat**.
- Team leaders "with additional permissions" create and publish schedules in the Connect app.

### 2.8 MinistryPlatform, Pushpay ChMS (CCB), Fellowship One, Churchteams

- **MinistryPlatform [R].** Teams are Groups. Schedules live in Volunteer Connect. People accept or decline.
- **Pushpay [R].** Roles, rotations, push notifications and self-service replacements in the My Church App.
- **Fellowship One [V].** Bundles WorshipPlanning.com at no charge (Deluxe plan, 5 planners). Scheduled people "receive a message and can choose to 'accept' or 'decline'."
- **Churchteams [R].** Per a blog summary, invites go by email and text with a link to the volunteer's page to accept or decline. Login is not stated.

### 2.9 Dedicated schedulers

- **WorshipPlanning.com [V].**
  - Drag-and-drop teams, sub-teams and individuals.
  - Accept or decline by text, email or **Facebook**.
  - Leaders are auto-notified, with auto-prompts for pending requests.
  - Conflict alerts and blockout dates.
  - "Find the most qualified and available person" (a finder, not auto-fill).
- **WorshipTools Planning (free) [V].**
  - Add people per role. **Nothing is sent until "Send Invites"**, and a per-person "Send now" is also available.
  - Green, red and grey status icons.
  - [R] Accept and decline alerts go only to the scheduler who placed the person. No SMS. No open signup invites (2025 support post).
- **Ministry Scheduler Pro (Rotunda) [V/R].**
  - The de facto Catholic parish tool for **lectors, EMHCs, altar servers, greeters** (a parish bulletin lists exactly these) [R].
  - The engine produces "fair, balanced schedules… automatically" [V], typically published for months at a time.
  - "Online subs" [V] and family scheduling [V].
  - Free volunteer app: view schedule and open positions, sub requests, push, availability [R].
  - Price about $50 to $65/month [R].
  - The model is "publish the schedule, then manage exceptions by sub request", **not** per-assignment accept/decline [R/U].
- **SignUpGenius (baseline) [V].** Participants need **no account** ("click the link, pick a spot"). Automatic confirmations and reminders, text reminders, waitlists. Free with ads, paid tiers without.
- **"Worship Planning by CCLI/Faithlife".** I found **no such scheduling product**. CCLI sells SongSelect and "Rehearse", which the Phase 1 log already covers. Faithlife's Proclaim is presentation software, and I did not research it. [U]

### 2.10 Presbyterian and mainline-specific

- **No mainline-specific volunteer scheduler surfaced.** The liturgical planners are **content tools**:
  - **Sundays and Seasons (ELCA/Augsburg)** [V]: build a plan from date and base liturgy, then download into Word or PowerPoint. $269 to $799/year by average attendance, plus $49 modules. No role assignment found. "Collaborate with others" means multiple users.
  - **RitePlanning (Episcopal, Church Publishing)** [R]: unlimited users, bulletin templates, no volunteer scheduling found.
  - **LabOra** [R/U]: called "the gold standard" for RCL congregations, with a hymnal and liturgy library, use tracking and bulletin layout. Its maker and current status are unverified. The labora.pcusa.org URL suggests a PC(USA) tie, but that is not confirmed.
  - **Lutheran Service Builder / Christian Worship Service Builder** [R].
  - **United Methodist / Abingdon Worship Planning Calendars** [R]: printed or digital calendars with fields for **acolytes and lay readers**.
- **PC(USA) polity on non-music roles [R, from a 2026 PC(USA) article citing the Directory for Worship].** Ruling elders:
  - read Scripture ("especially fitting", W-3.0303);
  - lead intercessory prayer (W-3.0308);
  - offer the prayer of dedication (W-3.0411);
  - **distribute the bread and cup** (W-3.0414);
  - give the charge (W-3.0502);
  - present baptismal candidates (W-3.0404);
  - administer the Supper where the presbytery has authorized and trained them (W-3.0410).

  The order of worship is the pastor's responsibility with the session's concurrence, and music is chosen in consultation with musicians. That description comes from secondary sources, and the section numbers vary by edition [R].

  **Implication [U]:** Communion-server and lay-reader positions in a Presbyterian church are often drawn from **ordained officers**. That eligibility is data PresbyPortal already holds (`officer_terms`), and no general-purpose scheduler models it.

---

## 3. Patterns: table stakes vs differentiators

### 3.1 Table stakes (in essentially every scheduler reviewed)

1. **Team → position → dated slot → person with a three-state response**: pending/unconfirmed, accepted, declined, sometimes plus tentative.
   - Planning Center C/U/D; Rock RSVP; MB statuses; WorshipTools icons. [V]
2. **Draft, then send.** Placing someone does not notify them until the leader sends.
   - Planning Center "Prepared"; WorshipTools "Send Invites"; MB "Not Notified"; Elvanto "published service"; ChurchSuite "unsent"; Rock's job window. [V/R]
   - This was not explicit in the Phase 1 flows.
3. **Decline notifies the leader, often with a reason.** The reason is required in Elvanto [V], optional in Planning Center, One Church and Rock [V].
4. **The leader records a response on someone's behalf.**
   - Realm admin accept [V]; MB "Mark as… Confirmed" [V]; ChurchSuite (one church's practice) [R].
5. **Blockout or unavailability dates that warn, not block, with a reason visible to the leader.**
   - Planning Center, Elvanto, Breeze, Rock, WorshipPlanning [V]. Planning Center explicitly says warn.
6. **Automatic reminders N days before, to non-declined people,** often with an "only non-responders" option.
   - Planning Center, Breeze, Elvanto, Rock [V].
7. **Conflict warnings** for the same person at overlapping times across teams.
   - Planning Center, Elvanto, WorshipPlanning [V].
8. **A volunteer-facing "My schedule"** on web or app, plus responses from email.
9. **Email response without a full login.** Rock (code), MB People ("no log-in is needed"), One Church ("a login is not needed"), Breeze (re-usable RSVP link), ChurchSuite (personal Rota Page, [R]), SignUpGenius (no account). Planning Center sends Accept from the email, while Decline goes to the website.
   - **Of the systems whose response mechanism I could confirm, only Elvanto documents a login-required path, and that is for decline.**

### 3.2 Common but not universal (strong expectations for a "real" product)

- **SMS** with accept and decline links: Elvanto, Rock, Breeze reminders, MB, One Church, WorshipPlanning [V].
  - Planning Center's free SMS gateway is dying because carriers dropped it [V]. The industry is moving to paid SMS or push.
- **Swap and replace** flows: Elvanto, One Church, Planning Center (replacement on decline), MSP subs, Breeze leader-suggested replacement [V/R].
- **Auto-schedule**: Planning Center, Elvanto, Rock, MSP [V].
  - The inputs are always the same: last served, frequency limits, blockouts, conflicts, preferences, and household pairing.
- **Household or family**: Planning Center (respond and block out for children, copies of children's emails), Rock (family blackouts), MSP (family scheduling) [V].
- **Rehearsal times on the plan**, included in reminders (Planning Center [V]); "call times" (Elvanto [V]).
- **Signup sheets** for open slots: Planning Center, Breeze, Rock Toolbox [V].
- **Leader-only scheduling scope**: Planning Center Scheduler level [V]; Realm leaders with permission [V].

### 3.3 Differentiators, and openings for PresbyPortal

- **Scheduling bundled with the roll.** Planning Center bills by people who can log in, from $0 for 5 to $239/month for unlimited [V]. A small congregation with 40 volunteers who need logins pays $32/month for Services alone. PresbyPortal's bundling is a real pricing differentiator. [U]
- **Eligibility from ecclesiastical data.** Planning Center gates "secure teams" by background check [V], and Rock gates by group requirements [V]. **None** derive eligibility from officer status. "Communion server: active or ordained ruling elder or deacon" from `officer_terms` is a PresbyPortal-only capability. [U]
- **Services as calendar and attendance rows.**
  - Breeze (volunteers on calendar events) and Rock (scheduled position and attendance on one row, its stated design reason) [V] validate Q17.
  - Planning Center keeps plans in their own product [V/U].
- **Correctly secured no-login response.** Rock's token is the weakest pattern seen: non-expiring, not single-use, scoped to an action and not to the assignments, though the assignment ownership check is right [V].
  - Mail-security scanners (Outlook Safe Links, Proofpoint, Gmail preview) **prefetch GET links and consume or trigger one-click actions** [R: Supabase discussion #41618, Ackify release notes, Stytch docs, Buttondown docs].
  - A GET that confirms (Rock's old `isConfirmed=true`) is exposed to this. A landing page plus POST is not.
  - PresbyPortal can do this properly with its existing DECISION-147/183 credential mechanism.
- **Privacy defaults.** Elvanto deliberately withholds swap reasons from leaders [V]. Planning Center shows blockout reasons to leaders [V]. A PresbyPortal default of "reason optional, visible to the scheduling leader only" fits its tiered-privacy invariants. [U]

---

## 4. Recommendations for PresbyPortal

### 4.1 Increment 1 shape (adjustments to the Phase 1 plan, each with evidence)

1. **Add an explicit "not yet sent" assignment state, plus a per-team or per-plan "Send requests" action.** Do not email on every placement.
   - Evidence: Planning Center Prepared notifications, WorshipTools "Send Invites", MB "Not Notified", Elvanto "published service only" [V].
   - Rationale: a leader rearranging a draft must not spray emails. The Phase 1 Flow 3 says "the request is sent" on pick, which would be the odd one out.
2. **States: not sent → requested → confirmed / declined, plus "recorded by leader".** A soft "cleared" that never deletes the row.
   - Rock's `ScheduledPersonClear` keeps the row [V] and matches the all-deletes-soft rule.
   - Skip "tentative" in Increment 1 (only MB has it [V]).
3. **Decline reason optional; shown to the scheduling leader only.**
   - Optional in Planning Center, One Church and Rock. Required only in Elvanto [V].
   - Elvanto deliberately keeps swap reasons from Reports-To for privacy [V].
4. **A confirmed person can still withdraw (a decline after accept), which notifies the leader.** Re-accepting after a decline goes through the leader. That mirrors Planning Center [V] and avoids an accept-after-decline race.
5. **Blockouts:**
   - date ranges plus a simple weekly or monthly repeat;
   - **warn, don't block**;
   - an optional reason visible to leaders;
   - apply across all teams.
   - Evidence: Planning Center warns, has repeat patterns, and blockouts span all teams [V]. Rock has an optional per-group scope [V].
   - Add a **congregation-level blackout** (for example "no 8 am service in August") later. That is Rock's group-type exclusions [V].
6. **Reminders:**
   - one automatic reminder N days before (configurable 1 to 7) to requested and confirmed people, never declined;
   - plus a "nudge non-responders" action;
   - never send after the start time;
   - condense same-day sends.
   - Evidence: Planning Center (7 days, condensed, not to declined), Breeze (only to non-RSVPed), Rock (never after start) [V].
7. **Conflict warning across teams** for the same person and overlapping event times. This one is cheap once services are `events` rows (Q17).
8. **"Email my leader" / "Contact scheduled people" are Increment 4**, because they are free text. Planning Center's "Email My Leader" and MB "Contact" [V] show the demand. Phase 1 already gates free text on Track F.
9. **Starter team templates must include liturgical teams**, since the music products treat them as just another team [V]:
   - *Liturgical*: Liturgist / lay reader, Scripture reader, Prayers of the People.
   - *Communion*: Servers.
   - *Ushers*, *Greeters*, *Acolytes*, *Sound/AV*.
   - Optionally mark **Communion servers** "eligible: ruling elders / deacons" from `officer_terms`. That is a differentiator (3.3), and it uses data the platform already holds. It may be a later increment, but **model "position eligibility" as a concept now** so it is not bolted on later. [U]
10. **Mobile:** use a card list for "My schedule" and the leader's per-service view. The Planning Center and Elvanto matrices are desktop surfaces [V], and Phase 1 already calls for a 360 px card list.

### 4.2 Open questions

**Q8: Who may schedule (church-wide key or team leader)?** *Evidence supports "both."*
- Planning Center:
  - Scheduler level = "only schedule, auto-schedule, email, or set up teams for which you are a team leader."
  - Editor and above = any team.
  - Permission levels are settable per service type [V].
- Realm: leaders "with additional permissions" create and publish schedules [V].
- Breeze routes declines and reminders through the role's Leader [V].
- Recommendation:
  - The group's chair or leader seat schedules **their own team** (a live seat check).
  - `worship.schedule` or `worship.manage` covers any team.
  - Decline and confirmation notices go to whoever scheduled the person, **and** to the team leader. That is Planning Center `responds_to` [R] and Rock's coordinator plus scheduler [V].

**Q10: Responding to a request.** *Evidence argues for moving the one-click link forward.*
- The norm is response from email without a full login:
  - Rock, by code [V];
  - MB People, "no log-in is needed" [V];
  - One Church, "a login is not needed" [V];
  - Breeze, a re-openable RSVP link [V];
  - ChurchSuite, a personal Rota Page [R];
  - SignUpGenius, no account [V].
- Planning Center accepts from email and pushes declines to the site [V], and its member login is passwordless [V].
- Sign-in-only would be the strictest model in the set. Phase 1's own G5 says many choir members won't sign in.
- Recommendation:
  - Keep Increment 1 as sign-in plus leader-records-on-behalf **only if** the token pipeline cannot fit.
  - Treat the email link as a **pre-pilot requirement (Increment 1b)**, not an indefinite follow-up.
- Design it better than Rock:
  - a hashed, per-request or per-notification-batch token (DECISION-147/183 mechanism) that authorizes **only** responding to the assignments it names;
  - **GET renders a page; POST commits.** This defeats scanner prefetch [R sources in 3.3]. Rock's newer "One Button" landing-page template points the same way [V];
  - **re-usable until the service starts**, so a person can change their mind (Breeze allows this [V]), then expired;
  - never creates a session, never reveals other people's data, and does not need 2FA, because it grants nothing beyond its row;
  - audit as "responded via emailed link."
- This also removes the Phase 1 edge case about deep links surviving the `/totp` detour for the common path.

**Q11: Guests.** *Evidence is mixed; the Phase 1 recommendation stands.*
- No vendor I read documents a free-text guest slot.
- Realm and Planning Center add the person as a profile. Realm can pull from "All of Realm / Potential Volunteers" and add to the roster [V], and Planning Center Schedulers can create profiles [V].
- FPCW kept external-participant records.
- A free-text guest name (display and bulletin only, no contact data) is a deliberate privacy-first divergence. It is fine for a visiting preacher or a hired organist, who are not notified anyway.
- State in the help copy that guests get no emails.

**Q12: Minors.** *Evidence suggests going further than "reach via guardian."*
- Planning Center [V]:
  - a household parent sees and **responds** to a child's requests, sets the child's blockouts, and can be **copied on the child's emails**;
  - under-13s cannot log in at all.
- Rock: one action blocks out a whole family [V].
- MSP: "family scheduling" [V].
- Recommendation:
  - Minors can be rostered and scheduled.
  - Requests and reminders for a minor go to the **guardian(s)** on the household or children model, not the minor.
  - The guardian can respond and set blockouts for the minor, through the same email-link token addressed to the guardian (Q10).
  - Never named publicly.
  - The leader sees a "via guardian" badge.
  - This is a modest step from Phase 1's flag, and it matches the market leader.

**Q14: SMS or push.** *Evidence: SMS is common, but the cheap route is dead.*
- Elvanto, Rock, Breeze, MB, One Church and WorshipPlanning all offer SMS [V].
- Planning Center's free carrier email-to-SMS gateway is being dropped by Verizon and AT&T, so it now recommends in-app push [V]. Its paid texting is $0.02 per text [V].
- WorshipTools, a free tool, ships with no SMS [R].
- Recommendation:
  - Email only in Increment 1 (agree).
  - Record SMS as a known gap against competitors, not as "not needed."
  - If SMS comes later, it is a paid provider with per-message cost and consent handling (the regulatory specifics are unverified here).
  - Never use carrier gateways.
  - Push is out of scope while there is no native app.

**Q17: Services and rehearsals as `events` rows.** *Evidence supports yes.*
- Breeze attaches volunteers to calendar events [V].
- Rock puts the scheduled position on the same attendance-occurrence row used for check-in, explicitly so "who was scheduled" and "who showed up" compare without a join [V]. That validates keeping `allowsCheckin` and the future attendance count on the event.
- Planning Center treats rehearsal as a time on the plan, and teams are assigned per time, which drives reminders and conflicts [V]. In PresbyPortal a rehearsal can be a linked event, and the team-to-event link drives the same things.

**Q19: Planning Center import.** *Evidence: feasible, and defer it.*
- The Services API exposes plans, teams, positions and plan-people with status [R].
- There is no API to send their scheduling emails [R], which an import does not need.
- None of the mainline content planners (Sundays and Seasons, RitePlanning, LabOra) hold scheduling data to import [V/R].
- Recommendation: defer until a pilot congregation confirms it uses Planning Center (agree with Phase 1). A **CSV roster import** (people to teams and positions) is the more broadly useful first import. Many small churches schedule in spreadsheets or SignUpGenius. [U]

### 4.3 Explicitly later, with the evidence for each

- **Auto-schedule.** Every serious scheduler has it, and the inputs are uniform: last served (team or position), frequency caps, blockouts, conflicts, household pairing, and a random tie-break [V Planning Center, Elvanto, Rock].
  - Design Increment 1's tables so "last served in this position" and per-person frequency caps are derivable.
  - Note that Elvanto's auto-schedule **does not notify** [V]. That is consistent with draft-then-send.
- **Swap and replace.**
  - Elvanto (first acceptor wins, others told it is filled) [V];
  - ChurchSuite (trust-based, no recipient approval) [R];
  - Planning Center (pick a replacement on decline) [V];
  - Planning Center auto-reschedule on decline [V].
- **Signup sheets** for open positions. Breeze's are per-person links, not a shareable URL [V].

---

## 5. Sources

### Planning Center
- Respond to scheduling emails: https://help.planningcenter.com/en/142893-respond-to-scheduling-emails.html [V]
- Send scheduling emails (Prepared notifications): https://help.planningcenter.com/en/142892-send-scheduling-emails.html [V]
- Text notifications / SMS gateway: https://help.planningcenter.com/en/142891-set-up-and-respond-to-text-notifications.html [V]
- Auto-schedule your team: https://help.planningcenter.com/en/142881-auto-schedule-your-team.html [V]
- Manage blockout dates: https://help.planningcenter.com/en/142872-manage-blockout-dates.html [V]
- Blockout requests: https://help.planningcenter.com/en/142885-send-blockout-requests-for-predictable-scheduling.html [V]
- Permissions in Services: https://help.planningcenter.com/en/136863-permissions-in-services.html [V]
- Household schedule: https://help.planningcenter.com/en/142879-manage-your-household-s-schedule.html [V]
- Log in to Church Center (passwordless, under 13): https://help.planningcenter.com/en/141275-log-in-to-church-center.html [V]
- Reminder emails: https://help.planningcenter.com/en/142894-set-up-reminder-emails.html [R, search summary]
- Rehearsal times: https://help.planningcenter.com/en/142841-get-ready-for-rehearsal.html and https://help.planningcenter.com/en/139401-add-and-assign-times.html [R, search summary]
- Auto-reschedule declines (2024): https://www.planningcenter.com/blog/2024/09/auto-reschedule-declined-volunteer-requests-in-services [V]
- Product page: https://www.planningcenter.com/services [V]
- Pricing (embedded package data, read via curl): https://www.planningcenter.com/pricing [V]
- Pricing help: https://help.planningcenter.com/en/136790-planning-center-pricing.html [V]
- API: GitHub issue #1500 (no send-email endpoint): https://github.com/planningcenter/developers/issues/1500 [V, the issue page; staff quote is from the bot summary of #1475, so R]
- PlanPerson attributes, third-party client: https://pub.dev/documentation/planningcenter_api/latest/planningcenter_api/PcoServicesPlanPerson-class.html [R]
- Reviews (Capterra pages 2 and 5, TrustRadius, G2): https://capterra.com/p/76708/Planning-Center/reviews/?page=5 [R, search excerpts only; pages returned 403]

### Elvanto / Tithely (read through the Zendesk help-center API)
- Swap, replace or decline: https://help.elvanto.com/hc/en-us/articles/7659757415191 [V]
- Who gets notified about swaps: https://help.elvanto.com/hc/en-us/articles/23995232590871 [V]
- Email and SMS notifications: https://help.elvanto.com/hc/en-us/articles/7604214211351 [V]
- Communicating schedules / Reports To: https://help.elvanto.com/hc/en-us/articles/7702312133399 [V]
- Schedule onto a single service: https://help.elvanto.com/hc/en-us/articles/7604005299863 [V]
- Service settings: https://help.elvanto.com/hc/en-us/articles/7500684639511 [V]
- Scheduling preferences: https://help.elvanto.com/hc/en-us/articles/7627032523415 [V]
- Availability: https://help.elvanto.com/hc/en-us/articles/7659762692887 [V]
- Auto-scheduling: https://help.elvanto.com/hc/en-us/articles/7604148914839 [V]
- Directory opt-in tokens: https://help.elvanto.com/hc/en-us/articles/7626895174295 [V]
- Feature pages: https://elvanto.com/features/worship/ and http://www.elvanto.com/features/all/community-volunteer-log-in/ [V]
- Tithely pricing FAQ: https://help.tithe.ly/hc/en-us/articles/13343662940439 [R, search summary]

### Breeze (read through the Zendesk API)
- Declined RSVP: https://support.breezechms.com/hc/en-us/articles/360036414453 [V]
- Change RSVP: https://support.breezechms.com/hc/en-us/articles/360035729793 [V]
- Reminders: https://support.breezechms.com/hc/en-us/articles/360034343693 [V]
- Blockout dates: https://support.breezechms.com/hc/en-us/articles/360034132413 [V]
- Member blockouts: https://support.breezechms.com/hc/en-us/articles/360040589134 [V]
- Invite mode / signup sheets: https://support.breezechms.com/hc/en-us/articles/360022586233 [V]
- Worship Team Tools $29: https://support.breezechms.com/hc/en-us/articles/27944424796823 [V]
- Sample notifications: https://support.breezechms.com/hc/en-us/articles/360036181633 [V]

### Rock RMS (source code)
- Group scheduling design doc: https://github.com/SparkDevNetwork/Rock/blob/develop/docs/group/group-scheduling.md [V]
- Confirmation block: https://github.com/SparkDevNetwork/Rock/blob/develop/RockWeb/Blocks/GroupScheduling/GroupScheduleConfirmation.ascx.cs [V]
- `GetByPersonActionIdentifier`: https://github.com/SparkDevNetwork/Rock/blob/develop/Rock/Model/CRM/Person/PersonService.cs [V]
- Lava filter: https://github.com/SparkDevNetwork/Rock/blob/develop/Rock/Lava/Filters/LavaFilters.Person.cs [V]
- Confirmation email templates (migrations): `Rock.Migrations/.../202211081600377_GroupSchedulingAcceptAll.cs`, `202508051740308_Rollup_20250805.cs` [V]
- Docs: https://chiptraining.rockrms.com/ask-chip-training/core-docs/article/3396 and https://chiptraining.rockrms.com/ask-chip-training/core-docs/article/3402 [V]

### ChurchSuite (all R; the vendor pages were blocked)
- https://support.churchsuite.com/article/581-rota-accept-decline
- https://support.churchsuite.com/article/673-my-churchsuite-my-rotas
- https://www.churchsuite.com/blog/2021-04-21-rota-accept-decline

### Ministry Brands and One Church
- MB People schedules: https://mbpeople.zendesk.com/hc/en-us/articles/37039092422427 [V]
- MB Service Planning for volunteers: https://mbserviceplanning.zendesk.com/hc/en-us/articles/36914395043355 [V]
- One Church serving requests: https://support.onechurchsoftware.com/en/articles/7120088-how-do-i-send-serving-requests [V]

### Realm, MinistryPlatform, Pushpay, Fellowship One, Churchteams
- Realm assign volunteers: https://help.acst.com/en/realm/how-to/volunteer-management/schedules/assign-volunteers-to-a-schedule [V]
- Realm leaders: https://help.acst.com/realm/how-to/volunteer-management/schedules/volunteer-leaders-managing-schedules [V]
- Realm volunteer brief: https://www.acstechnologies.com/realm/wp-content/uploads/sites/3/2021/05/Volunteer-Management-Brief.pdf [R]
- MinistryPlatform (SoftwareOne listing): https://platform.softwareone.com/product/volunteer-management/PCP-4312-2654 [R]
- Pushpay volunteers: https://pushpay.com/blog/which-apps-help-churches-manage-volunteers-and-events-effectively/ [R]
- Fellowship One + WorshipPlanning: https://www.fellowshipone.com/blog/free-worship-planning-with-your-church-management-software/ [V]
- Churchteams blog: https://blog.churchteams.com/new-release-volunteer-scheduling [R; 404 on fetch, search summary only]

### Dedicated schedulers
- WorshipPlanning.com people scheduling: https://app.worshipplanning.com/login/moreinfo-peoplescheduling.cfm [V]
- WorshipTools scheduling: https://www.worshiptools.com/en-us/docs/88-scheduling-services [V]
- WorshipTools notification and SMS claims: https://www.worshiptools.com/en-za/docs/74-notif-settings [R, search summary]
- Ministry Scheduler Pro: https://www.ministryschedulerpro.com/ [V]
- MSP app: https://apps.apple.com/us/app/id867780665 [R]
- MSP parish example: https://www.stmargaretstl.org/news/parish/parish-articles/2024/12/bulletin-article-december-29-2024/ [R]
- MSP pricing: https://www.capterra.com/p/16504/Ministry-Scheduler-Pro/ [R]
- SignUpGenius features: https://www.signupgenius.com/features [V]

### Liturgical and Presbyterian
- Sundays and Seasons: https://sundaysandseasons.com/ [V]
- Reformed Worship "Get Organized" (LabOra, ServiceBuilder, Tempo): https://reformedworship.org/resource/get-organized [R]
- RitePlanning: https://www.episcopalnewsservice.org/pressreleases/church-publishing-incorporated-launches-riteplanning/ [R]
- PC(USA), "Ruling elders and worship" (2026): https://pcusa.org/news-storytelling/news/2026/2/17/ruling-elders-and-worship [V article; Directory citations R]
- PC(USA) worship planning FAQ: https://pma.pcusa.org/ministries/worship/faq-planning [R, search summary]

### Email-scanner prefetch (for the Q10 design)
- Supabase discussion #41618: https://github.com/orgs/supabase/discussions/41618 [R]
- Stytch magic links: https://stytch.com/docs/consumer-auth/authentication/magic-links/overview.md [R]
- Buttondown canary links: https://docs.buttondown.com/canary-links [R]
