# Operator briefings

Things Claude found or decided that you should know, newest first. **Tick the
box when you have read it** — `- [ ]` → `- [x]`. Same convention as
`docs/TODO.md`, and the SessionStart hook prints the unread count.

This exists because scrollback dies with the session and with context
compaction, and because "what did Claude tell me about X" is otherwise
unanswerable a week later. It is committed, so the entries and their read state
are version-controlled.

**Severity:** `defect` = something is or was broken · `decision` = a choice was
made that constrains later work · `finding` = a fact worth knowing that is not
either of those.

<!-- covers: decision=224 commit=451d186 -->

*The marker above is what makes staleness measurable. `scripts/briefings-check.mjs`
compares it against `docs/decisions.md` and `git log`, and says at session start
if decisions above the marker that no entry names (write `DECISION-NNN`, or a
range like `DECISION-NNN to DECISION-MMM`, in the entry) or feat/fix commits
since the marker commit have landed. Name each decision in an entry and move the
marker when you write new entries — that is the one piece of discipline this file needs, and it
is checked.*

---

## 2026-10-26

- [ ] **`defect` · First-time two-factor setup could show a key that was not the one saved, so a correct authenticator code was refused about 1 time in 20; fixed (0.46.2; DECISION-290).** The browser asks for the setup page twice at once on the redirect from `/totp`; each request made its own secret and the last write won, so the page could show the loser (F342). One database statement now writes a secret only if there is none or it has expired, and the page always shows what the database holds. Reloading and a second tab show the same key. **Accepted residuals:** the helper reads the database clock while the final check reads the app clock (sub-second against a 10-minute window); a delete of the row by an admin reset between the two statements is covered only by a scripted test; and the error shown if three attempts all lose has not been looked at in a browser. **Not fixed, still open:** F166 (the recovery codes vanish after the sixth digit on first setup; HIGH before the first non-operator invitee, and the next thing a new invitee hits), the missing rate limit on setup, and two tabs finishing at once can interleave recovery codes. **You must:** nothing to apply (no migration).

- [ ] **`decision` · A congregation's public website now serves only the images it published; every other stored file answers "not found" (0.46.1; DECISION-277).** Before this, any file stored for a congregation (a ticket screenshot, a contribution statement, the website's content file, a person's photo) could be fetched from the public website by anyone who held its exact random address while the site was live (F289). Production held no ticket attachments, statements or person photos on 2026-10-26, so only the content file could have been fetched. The fix is a new `audience` on every stored file (private unless a caller says otherwise, and it cannot be changed afterwards) and one database function that is the only door. A person who hid their photo in the directory now has it withheld on every congregation's public list. **Accepted residuals:** an image removed from a website stays fetchable by its exact link until a follow-up (takedown by reference); copies already in browsers, search engines or archives cannot be recalled; and a listed person's photo is fetchable by its exact link while the staff or committee switch is off, which you deferred on 2026-10-26 ("nah. we can test that in the future"). **You must apply migration 0072 to production BEFORE merging**: the new code calls a function that does not exist until it runs, and every public image would answer "not found" in between. The runbook is `docs/deployment.md`, "Public asset audience (0072)"; it was rehearsed on a copy of production on 2026-10-26 (81 files marked public, none left dangling). Between the apply and the merge, do not push to a site repository, upload a logo or attach a file to a ticket, and keep `GIVING_STATEMENTS_ENABLED` unset until the checks pass.

- [ ] **`decision` · The Developer pages now ask for your two-step code, have a header, home and menu, and list every table under its real heading; who can open them has NOT changed (0.46.0; DECISION-258 and DECISION-261).** This is Increment 1 of 4. Only a platform administrator flagged by hand in the database can enter, and there is no screen or audit for that flag. **Not delivered yet, in your own words:** "someone with the role of developer, could be part of any organization" is Increment 2, and the API page is Increment 3, which you ruled on 2026-10-26 is an internal inventory that says PresbyPortal has no public API (kept in step with the code by a test; a public API is not planned). **A gap fixed:** until now a platform administrator whose account requires two-step sign-in could read the schema, the permission catalog and the rules without entering a code (F284); the proxy and the page now both challenge it, and `/developer/schema.json` answers with a JSON error. **Accepted:** reading the Developer pages is not recorded in the audit log; the rules list is still written by hand (a test checks only that every Key Invariants heading is listed or excused, and two, No Real Data and Verify in a Browser, are excused and the page says so); the data-model pages keep their old colours until a tracked follow-up. **You must:** nothing to apply (no migration). The CI end-to-end job limit was raised from 50 to 75 minutes after it timed out on the parish PR.

## 2026-10-25

- [ ] **`decision` · Congregations can now set up deacon districts and put each household in one; it is off everywhere until a congregation turns it on (0.45.0; DECISION-242 to DECISION-245).** The Board of Deacons Moderator is a dated seat recorded under Officers, and that seat alone, or the people-management permission, can move households; no named person, commission or delegation can be given it. **A gap you accepted:** until Community 3a's migration 0066 lands, code with direct database write access could add a name to the seat's roster, or relabel the group, without a term (the Session roster is the same; no screen does it). **You must:** snapshot production, read the pre-ship counts and apply 0068 before merging; the runbook is in the work-log. **The Parishes tab count now includes every household in a district**, so numbers may rise. No what's-new post until the first congregation turns it on. Open: first-day discoverability, 44px targets and the empty-state wording (N1 to N3 in `docs/TODO.md`).

- [ ] **`decision` · The two-factor code is now sent the moment the sixth digit lands, on sign-in and on the account setup screen (0.44.1; DECISION-257).** Typing, pasting or autofilling six digits checks the code with no button press; a wrong code empties the boxes and refocuses the first, and Verify stays as the fallback. A paste that drops a digit waits for the button. **What it costs:** a mistyped last digit is sent at once and spends one of the ten tries a minute, so expect more failed-attempt rows in the audit log. **One known hole:** a two-digit keyboard suggestion or drag into an already-filled box can still send a code with a wrong digit (same cost, tracked). **Owed to you:** publish the one-line what's-new post once live, and check on a real iPhone and Android phone and a screen reader; neither was possible in automated tests.

- [ ] **`decision` · Your congregation's public website can show an events calendar, and nothing appears until each piece is chosen (0.44.0; DECISION-238 to DECISION-241).** An event shows only if its new per-event box is ticked, it is open to everyone, it is not cancelled, and the congregation's "Public events calendar" toggle is on. Everything starts off, and the site's maintainer must also place the calendar on a page. A database check and a read-time filter both back the members-only rule. **You must:** apply migration 0067 to production before merging (the new code reads its column), and run a real-iPhone check before turning it on anywhere. **Accepted:** anyone on the internet can read a shown event's text and archives may keep copies; there is no "add to my calendar" yet; a page carries about 0.75 MB of uncompressed HTML. **Still open (in TODO):** the FPCW site integration, the custom-host check at cutover, and the event import before DNS moves.

- [ ] **`decision` · The platform admin area now opens on a dashboard of what needs attention, behind a grouped menu with a phone version; the organization workspace you asked for is still to come (0.43.0; DECISION-251, DECISION-252, DECISION-253, DECISION-255).** Increment 1 of 4 is read-only. **What to know:** the dashboard's rule that it shows no congregation-member data is held by a test that catches a careless reader, not a deliberately evasive one, and the two-factor card is the one place that reads through people and memberships, by your ruling (DECISION-252). The admin area deliberately has no loading screens, because one would make a missing page report success (DECISION-251). Status uses icons and words for now; proper status colours come in Increment 4 (DECISION-255). The Design system page is visible to anyone who can open the admin area. **Still open:** the organization workspace and the "waiting for a first administrator" and invitation cards (Increment 2); three admin detail pages show the "couldn't load this page" screen instead of a 404 for a malformed address (tracked).

- [ ] **`defect` · The new-organization form could silently drop a type or parent picked before the page finished loading; it now waits (0.42.5; F275).** On `/admin/organizations/new`, a choice made in the first moment after the page appeared could be reset by the page's own startup, creating a root or wrong-type organization that the product cannot repair (the type is permanent and there is no reparent control). The whole form now stays greyed out until it is ready. Nothing already created is affected, but if you created an organization very quickly after opening the page, open it from the organizations list and check its type and parent. **Still open:** the type and slug are permanent only by convention (nothing in the database stops a direct rewrite); that is the platform admin redesign's Increment 3.

- [ ] **`decision` · Sign-in now refuses an outside-provider email the provider has not confirmed, before Google is switched on anywhere (0.42.4; DECISION-246).** The platform used to trust the address an outside provider reported without checking the provider's own "email confirmed" flag, so an unconfirmed claim of someone's address could have signed in as them (an enrolled person would still have met the authenticator code), and a claim of an unused address could have created an account that, for an address on the initial-administrator list, received administrator rights. Nothing was exposed: Google is configured in no environment and production has no outside-provider accounts. **Still owed:** no real Google sign-in has ever run against this, so confirm on `development` when you first configure Google that the flag arrives as expected; a refused person sees only the generic "Access Denied" page, with the server log as the only explanation (existing TODO). **Rule to remember:** the check passes any provider that confirms an address, so a second provider needs its own review first.

- [ ] **`decision` · A security update to how sign-in sessions are handled shipped with no visible change (0.42.3; DECISION-230).** The platform now accepts that the second sign-in step is complete only from its own verification screens (the authenticator code and the recovery code); other requests to change a session's state are refused, and the session-update path reads nothing from the request. Signing in, authenticator codes and recovery codes work as before, and nobody is asked for a code again. **You ruled on 2026-10-25 that existing sessions are not rotated:** the two active production accounts are both yours, so no member is affected. The change covers new activity and cannot show whether an older session already holds a claim it did not earn, so such a session stays as it is until it expires (about 30 days). **Accepted limit:** a verified session outlives an administrator's reset of someone's authenticator, or a sign-out elsewhere, until it expires; a per-session server record would fix that and is tracked in `docs/TODO.md`. **Still owed:** a production sign-in check with an MFA-enrolled account (the change relies on request context reaching the session callback, proven on a production-mode build but not yet on Vercel), and a neutral heads-up to the owners of repositories seeded from the same starter. A smaller finding came with it (F237, low): a recovery code can be used twice if two submissions race, and an authenticator code can be reused within its time window; both need a session that already passed the password step and a valid code, and the fix is its own pipeline.

- [ ] **`decision` · Low-risk work now has a faster lane, and the workflow has new guardrails (DECISION-229, DECISION-231).** On 2026-10-24 you ruled "Adopt it": a change that adds no migration, route, server action or dependency, and touches none of sign-in, the proxy, the authorization core, the permission catalog or a flag seed, now skips the architecture review and the full design document, keeping a short design with its wording and edge cases. **What it never skips:** QA, the check that every sentence a person reads is true, the 360px phone check, a regression test that fails first, and `npm run check`; a QA failure that traces to a design claim, or any discovery that the change crosses one of those lines, promotes it to the full process. The same day's retrospective edits to the agent instructions, CLAUDE.md and skills landed. The workflow-efficiency pipeline (DECISION-231; QA passed on its second run) adds: the push gate now refuses a single command that commits and pushes (a `/pre-push` stamp made before the commit used to satisfy such a command), so commit and push are two separate calls; Playwright refuses port 3000 from a worktree; fixtures share one database-retry helper that retries connection drops only; QA has a guarded script that resets global feature flags to their seeded values before the browser run (per-congregation toggles and rollout percentages are not reset); the briefings count now measures decisions this file does not name; `stats:escape` takes `--since`; `npm run worktrees:report` shows free disk and each worktree's state and suggests removing a worktree only when its branch is merged and its tree is clean; and the dev server stops rewriting `AGENTS.md`. **The limit to know:** the push gate catches an agent's mistakes, not a determined adversary; aliases, variables, a push that sits inside a `$()` next to a commit, and prefixes such as `nice -n` or `env -u` can still slip past it, and each is a tracked item.

## 2026-10-24

- [ ] **`finding` · A security update to the library that checks form input shipped with no visible change (0.42.2; DECISION-223, DECISION-224).** CI's dependency audit flagged a published high-severity weakness in zod: a request both unusually large and shaped one particular way could make the server use far more memory than it should. The only place that accepted a list of that kind was a platform-administrator screen, so exposure was narrow. The upgrade to zod 4 closes it and removes the exception CI had been carrying. Forms and their messages are meant to be unchanged; the caveat is that a request not made through the app's own pages may see slightly different wording. Two rules came out of it: ids are checked with a looser "looks like an id" rule because some fixed ids in shipped migrations are not strictly standard UUIDs, and the old compatibility mode was refused because it would have kept the unfixed code where the audit cannot see it. While merging, a guard test flagged the stricter id checks and a golden test failed on email rows with non-standard ids, before anything deployed. 0.42.1 the same day changed the invitation confirmation to say whose acceptance makes the role official.

- [ ] **`finding` · Three rounds of security advisories against software the platform ships landed in five days, and CI's dependency audit is what caught each (0.33.1 on 10-19, 0.38.0 on 10-22, 0.42.2 on 10-24).** First Next.js (image handling and caching) with the image library `sharp` and `source-map-js`; then Next.js again (the 0.38.0 round alone carried three critical advisories, one a remote-code-execution flaw in the image optimizer when SVG files are used) with DOMPurify; then zod (above). All were patch-level or contained upgrades and none changed what a person sees; all three rounds were in production dependencies. Two low advisories remain in documentation-diagram tooling (katex through mermaid); they are not part of the congregation-facing platform and need a breaking upgrade. **What to take from it:** a red dependency-audit job on every pull request means a fresh advisory, not a flaky build, and it is also a pre-deploy prerequisite.

## 2026-10-23

- [ ] **`decision` · A person can now have several email addresses with one main, and the platform has one place that decides which address a message uses (0.42.0; DECISION-215 to DECISION-219).** Up to ten per person, labelled Personal, Work or Other, one marked main; removing an address ends it and keeps a record, and if the main goes the oldest remaining becomes main. **The rule worth remembering:** a contact email authenticates nothing. Sign-in, password reset and account emails still use the account's own address; households can share an address, and an invitation to a shared address won't go through; separately, an invitation to an address already on file for a person on the congregation's roster who signs in is refused unless the invitee accepts while signed in to that person's own account; giving statements still use the address on the donor's giving record. A person in two congregations has one set of addresses, so someone who can manage people at one can change an address the other also uses (audited with the congregation that made the change): an accepted limit (DECISION-218). Directory search now matches only what a card shows. **Deploy order:** database change `0064` first, then the code, snapshot first; between the two, saving contact details can fail.

- [ ] **`decision` · A congregation's Session can now approve new members, and a mistaken entry can be withdrawn (0.41.0; DECISION-202 to DECISION-206).** Every congregation gets a "Session member" role that goes to the people recorded on its Session under Officers: ruling elders and, on your ruling ("Yes, include them"), installed pastors, co-pastors and associate pastors (DECISION-206). Approving needs a PresbyPortal account, and recording an elder does not create one; inviting elders was still to come at release, and the Pending approvals page says plainly when nobody can approve yet. **The thing to know:** a new congregation's founding administrator can record themselves as an elder or pastor and then approve entries. That is allowed on purpose, because otherwise a new congregation is stuck; it is stamped "self-recorded" and "self-approved" on the record and not blocked, and it is a named open residual. Approve, deny and withdraw are the only ways to decide an entry, up to 50 can be approved at once with one minute reference (each recorded separately), and decided entries can no longer be changed or deleted by the application; the database refuses it. **Deploy order:** `0062`, then the code, then `0063`, snapshot first.

- [ ] **`decision` · The portal footer is now a site map built from the same list as the menu, and "People & Membership" is now "Community" (0.40.0; DECISION-220 to DECISION-222).** Menu and footer cannot disagree any more because both come from one structure; each menu section is a footer column with its tools beneath it, two across on a phone. The section is called Community in the menu, the home page, the footer and the Features page. The Administration link follows one rule: it appears, in both places, only when the congregation has at least one administration tool switched on (the menu used to show it whenever the administration area was on, even if empty), and what a person can open is still decided on the page behind it. On the portal home page the Community menu item scrolls to the section while the Community card opens the Community page; that is expected. No schema change.

- [ ] **`decision` · "Members" administration became Community, with visitors, participants recorded on the spot, and member proposals (0.39.0 to 0.39.2; DECISION-197 to DECISION-201).** A new congregation's first administrator used to land on a forbidden Members page; Community shows the page whenever someone can manage people and names any missing permission. Visitors and participants take effect immediately; a member is only proposed, and at 0.39.0 nobody could approve one (0.41.0, above, fixed that). Old Members links redirect permanently. **Two defects you found in production on 2026-10-23, both fixed in 0.39.2:** a person who joined by accepting a founding-administrator or treasurer invitation appeared in none of Community's six lists (they now appear under Staff, "No position yet" if they have none), and the "not connected yet" page told people that someone at their church could add them by email, which is false: an address on a record never connects an account, only accepting an invitation does. A test now fails if any kind of live membership lands in no view. **Deploy order:** code first, then `0061`.

## 2026-10-22

- [ ] **`decision` · A platform operator can now see who holds a congregation's founding-administrator and treasurer roles, and end their access when recovery needs it (0.38.0; DECISION-194 to DECISION-196).** Until now a leftover test account could hold a role with no way to tell, which blocked a real congregation from getting its first administrator. The page shows names only, with the date and how each was granted; ending access needs a reason of 10 to 500 characters and a confirmation that warns if nobody would be left to manage roles or giving, and it is written to the audit log with the reason. It is for recovery only: it never ends a role held through the Session or Diaconate, never touches membership or officer terms, and emails nobody yet. **A limit you ruled to accept ("No block, audit only", 2026-10-22):** an operator can end a role and then invite themselves into it. The audit log records the chain (revoked, then a self-addressed invitation, then acceptance) but nothing prevents it; it is written into CLAUDE.md as an accepted residual.

- [ ] **`finding` · On 2026-10-22 the production database was cleaned up out of band, at your instruction, and no audit rows were written.** Done in SQL by the orchestrator, each step after a Neon snapshot: the 68 test accounts on the reserved `.invalid` domain were deactivated and stripped of platform roles, two-step sign-in and platform-admin; the August synthetic data was purged (395 fixture people with their memberships, roll entries and households, two districts, 183 queued test emails), so your first test congregation has a clean roster; only your two real accounts remain active. **One slip, fixed:** the purge deleted that congregation's baseline member grant because its reason began `dev-seed:`; it was restored, and the lesson is recorded (never classify a grant by its reason prefix). **Still waiting on you:** whether to backfill audit rows for these changes, and an OK to delete the Neon branch `purge-rehearsal-2026-10-22`.

- [ ] **`decision` · A platform operator can invite a congregation's first administrator or treasurer by email, and every email the platform sends is now one branded layout (0.36.0 to 0.37.1; DECISION-183 to DECISION-193).** The invitation link is the only credential: it works once, for 7 days, never appears in a web address or the audit log, and opening it changes nothing until the person presses Accept; resending kills the old link. Limits are 3 invitations a day to one address, 10 per organization and 20 per operator. Once an invitation email is delivered, failed or cancelled, the stored copy is replaced with a note so the link is not kept. The operator may invite themselves; it is audited and shown as "Self-designated". Also in 0.36.0: Google's official sign-in button, a six-box two-step code entry, and a searchable organizations tree. **Known at release, and still open as of this entry (F166, tracked as high in `docs/TODO.md`; the 0.42.3 session update did not change it):** first-time two-step setup shows recovery codes for about a second and then asks for one extra code. It needs its own bug-fix pipeline before anyone other than you is invited. **Deploy order:** `0059` by hand before the release.

## 2026-10-20

- [ ] **`decision` · A congregation can now prove it owns a domain name and have its public site served there, but at release nothing was connected to a real domain (0.35.0; DECISION-176 to DECISION-182).** The rule to remember: a church's own domain is a lookup key into the one public-site tree, never an identity. A host the platform does not own is routed to that church's public site and nothing else: no sign-in, no admin, no member portal, no cookies; any name that is unproven, paused, lapsed or released shows the same plain "page not found" as a name nobody ever claimed. Proof comes first: the verification record must be seen before the hosting provider is ever contacted; an unproven claim expires after 7 days, a congregation can hold up to three web domains, and a lapsed domain stays dark for 30 days before it is released. Outbound mail now goes through a closed sender registry (DECISION-182). **At release this was unverified against the real hosting provider, Cloudflare or real DNS, the hosting connection was deliberately not configured in production, and church email on a church's own domain was not part of it.**

## 2026-10-19

- [ ] **`decision` · Online giving, a treasurer's gift desk and year-end statements are built, but were never run against a real Stripe account (0.34.0, in production from 0.35.0; DECISION-168 to DECISION-175).** Each congregation connects its own Stripe account and gifts go straight to it: Stripe Connect with direct charges and no application fee for the platform, donors sent to Stripe's own page so card details never touch ours. A gift is corrected only by a new refund, return or dispute line, never an edit; an issued statement is a frozen snapshot plus its PDF, and a correction is a new version. Giving is off for every congregation until the platform operator switches it on, one at a time, and the first treasurer is named by the operator. **Before real money:** a test-mode walkthrough with a real Stripe test account; Stripe keys must be set (without them nothing takes money); statements stay off in production until an accountant reviews the wording; and there is no privacy notice page yet. **Caught at the final review:** the platform's own `/give` page would have silently replaced a congregation's existing `/give` page after deploy; it was fixed so the old page keeps working until giving is switched on.
```

## 2026-10-15

- [ ] **`decision` · Every member now has a shared calendar, with color-coded event types, and it is switched on for every congregation and presbytery at once.** Until now the only events screen was the administrators' one, and a member who tapped Events was told they had no access. Four things you ruled on directly, worth remembering: the calendar is **not** behind a platform-wide switch (you said we are not live yet and do not need one), but each organization's administrators can turn it off under Features — that per-organization on/off is the pattern for new features from here on; cancelled events are **hidden** from the calendar entirely (administrators still see them under Manage events); every organization that has a baseline "Member" role had *View the calendar* added to it automatically; and "today" follows a new per-organization time zone setting, Eastern for everyone to start, which only a platform administrator can change and which has no screen yet. **Two things to know that are easy to misread:** an event marked "not public" is still visible to every member — it only keeps the event off the public website and out of the copy-month text, it does not mean "leaders only," and there is no way yet to show an event to the Session alone. And changes to event types are deliberately not written to the audit log; the per-organization on/off switch still is. **Caught before shipping:** a link to a cancelled event used to say the *organization* could not be found, which would have sent a member to the wrong conclusion; and the event save path stored a typed time differently depending on which time zone the server happened to run in — fixed so a time is stored exactly as typed, and a rule now stops that class of mistake from coming back. **One thing still owed before this reaches production:** the automatic calendar permission only reaches organizations that have a Member role, so a read-only count of production's roles is due before the migration is applied there, and the what's-new note for members is being held until that count confirms it reaches the intended congregation.

- [ ] **`decision` · The portal home page now shows what is coming up at church and the groups you belong to, next to your household — aligned with the directory app you compared it against.** Two cards sit side by side on a computer and stack on a phone: *Yours* (your household, and your groups) and *Coming up* (the next four events, one per repeating event). The household count now uses the exact same rule as the directory, so the home page can no longer say "2 members" for a household where one person has died or left. **A decision was made that cuts against the reference app, and it is written down with a trigger to revisit:** the tool tiles are *not* hidden by what you personally are allowed to open — they are shown by what the congregation has switched on — so an ordinary member can still see a tile such as Members and land on a polite "you don't have access" page. The reference app hides those tiles, but only because its pages redirect silently; here the destination page is the single honest authority, and a second gate that could disagree with it is the kind of bug the project exists to avoid. The cards, by contrast, do hide themselves when you may not read what they show, so the home page never carries a denial you can do nothing about. **Caught before shipping:** the first version of "find a person" and the household count could still surface someone whose membership had ended — see the next entry, which became its own fix.

## 2026-10-14

- [ ] **`defect` · Former members were still being shown in the directory, on household pages, in the parish roster, and found by the "Find a person" box, even after their membership had been ended.** Ending someone's relationship with a congregation already stopped them from signing in to it, but the directory kept listing anyone whose record still said "regular participant," with whatever contact details they had left behind — and "Find a person" could jump to a page that then would not open. Fixed everywhere in one go, including the administrators' member-management screens, which use the same list. No record is removed: a former member's history stays on file, they are simply not shown as current. **Found by the review of a different feature** (the portal home work above), which is exactly the cross-check the pipeline is for. There is not yet a screen that lists former members; that is tracked as future work.

## 2026-10-05

- [ ] **`decision` · A platform operator can now hand a brand-new congregation or presbytery to its first real administrator.** Every permission on the platform is granted by someone who already holds it at that organization, so a freshly created organization had nobody inside it who could do anything — every presbytery feature built this year was reachable only by a platform operator. On an organization's admin page you type the email of someone who has already signed up, confirm a screen that spells out exactly what they will be able to do, and they receive a deliberately bounded set: people, roles, groups, officers, staff, feature switches and support tickets for their own organization, plus the organization's own clerk office. **The handoff is one-time by construction:** the control disappears the moment anyone at the organization can manage roles, and reappears only if that count ever drops back to zero — which doubles as the recovery path if an organization locks itself out. **Limits stated plainly:** the person must already have an account (inviting someone who has not signed up is a later release), and a congregation's founding administrator still cannot enrol a member on the roll, because no role yet carries roll proposals and approvals. The act is written to the audit log.

- [ ] **`defect` · A form could silently lose or rewrite what you entered if you were faster than the page.** On a slow connection a form appears a few seconds before the code that runs it has arrived. In that gap, the congregation you had picked in the presbytery's annual-statistics form could be switched back to a different congregation the moment the page finished loading — and the statistics were then saved against the wrong congregation. That is a real data-integrity bug, found while testing on a phone, not by any automated check. **The fix is platform-wide:** every form now stays visibly greyed out until the page is fully ready and then enables itself, so nothing can be entered before it can be kept. On a normal connection the grey moment is a fraction of a second; on a poor phone signal a form may look disabled for several seconds — that is the page finishing loading, not an error. A new automated test deliberately holds back the page's code to prove the form stays disabled, and a project check now refuses any new form that is not protected the same way.

- [ ] **`decision` · When an operator creates a new organization, they can now place it under its presbytery or synod on the spot.** Previously every organization created through the product arrived with no parent council and the relationship had to be written in by hand afterwards. The list only ever offers the right kind of parent for the type being created (a presbytery for a congregation, a synod for a presbytery, the General Assembly for a synod), choosing no parent remains a normal and legitimate choice, and an organization's page now shows its council affiliation with a link to the parent. The kind of relationship is worked out from the child's type in one place, so the form and the server can never disagree about it.

## 2026-09-28

- [ ] **`defect` · A presbytery clerk who picked a report year from before a congregation joined the presbytery got a raw database error and a Save button stuck on "Saving…".** The database was correctly refusing the entry; the page just had no words for it. The year field now knows each congregation's affiliation window and says so beneath the field, an out-of-window year is explained before anything is sent, and if the database still refuses the page shows a plain sentence naming the congregation and the year. The anonymous one-time filing link got matching generic wording that reveals nothing to a visitor who is not signed in.

- [ ] **`finding` · The automated browser tests now actually cover the presbytery portal — oversight, statistics and per-capita entry, ministry credentials, and a congregation publishing and then withdrawing a report while the presbytery watches each state.** Before this they touched three member-portal pages and nothing a presbytery uses, so they could prove nothing about the presbytery product. A rule was set that these tests create and clean up their own data and never touch the shared development fixtures, so running them cannot damage anything. Three stale tests were repaired; one flaky test could not be reproduced and is on a watch list. **Still waiting on you:** the CI job that runs these, and the database-backed job from 09-26 below, both report themselves as skipped until two credentials are added to the repository's settings.

## 2026-09-26

- [ ] **`defect` · The project's automated checks had been failing on every single change since late August, and nobody was required to look, so nobody did.** A set of code-style errors stopped the job before any substantive check ran, which meant the build, security, database and test checks had all been silently reported as "skipped" for four weeks. Fixing that surfaced two real bugs hiding behind it: the helper that reads feature switches was failing *open* on a database hiccup (two of the eight style errors turned out to be genuine component bugs, and one was a date rendered in the server's time zone), and the public congregation-website pages were opening a database connection during the build. All fixed; the style check is now part of the pre-push checklist and runs *last* in CI so it can never again hide a more important failure. A follow-up the same day made every database read on the public-website path fail the same safe way — a visitor sees the ordinary not-found page, never a technical error, if the database is briefly unreachable. One known gap is tracked: the public contact form's own save step is not yet protected that way.

- [ ] **`finding` · Until this week, no database had ever been built from the committed migration files alone — and when one finally was, it did not match the live database.** Four columns differed and a fresh database's permission lookup failed on first sign-in. A corrective migration brings the files and the live databases into agreement, a parity check keeps them there, and the documented from-scratch setup now works for the first time. A new CI job builds a throwaway database from empty on every change, loads the fixtures, and runs about four thousand database-backed tests plus the 520-assertion isolation suite. **Three migrations were also found missing from the migration runner's own index** and restored. The job waits on the two credentials mentioned above.

- [ ] **`decision` · The list of group kinds (committee, choir, session, and so on) is now a shared platform catalog a congregation can read but never change.** It had been stored in a table shaped for per-congregation data even though it only ever held one platform-wide list — and that shape meant a congregation's own database connection could, in principle, insert a group kind of its own (this was reproduced, then rolled back). The reclassification refuses to run if any congregation-specific rows exist, so nothing is silently dropped, and a test now proves a congregation cannot insert, change or delete a kind. Nothing changes on any screen.

- [ ] **`decision` · The database can now remember every name a congregation has gone by, and can hold an unmatched spreadsheet row for review instead of dropping it.** A presbytery's historical records use whatever name a congregation was called that year, including handwritten variants, so matching by today's name alone is unreliable. Each organization can now carry dated former names and looser variants, optionally tied to a city so a 1965 name can be told apart from a same-named church founded later elsewhere; a lookup across that history suggests which congregation an old record probably means, ranked by a plain confidence band, without ever exposing whether that congregation has a platform account. A row that cannot be matched is kept permanently with the original data and the reason, rather than skipped. **Nothing is reachable from any screen yet** — no upload page, no review screen, no way to record a name change. Storage and matching logic only.

- [ ] **`decision` · A congregation's stated clerk can now withdraw an annual statistical report that was filed with the presbytery in error, citing the session minute that authorized it.** The original filing is never deleted; it stays on record, clearly marked withdrawn with the date and minute. The presbytery sees a withdrawn report excluded from that congregation's current-year totals and can review the full filing history. Only the congregation that published a report can withdraw it — a presbytery cannot withdraw a report addressed to it. **Ships behind a switch that is off by default**, and a new congregation "Stated Clerk" role template carries the publish-and-withdraw permission. A what's-new note to members is owed when the switch is first turned on.

## 2026-09-25

- [ ] **`decision` · A presbytery can now email a congregation that has no account a one-time link to file its annual statistical report.** Many congregations will never have an account, and until now the presbytery clerk had to type their figures in by hand. The clerk issues a link for a congregation and year, addressed to a named person; the recipient opens it, fills in the form, states their name and office, and submits once. Links expire, can be revoked, and only one can be outstanding per congregation and year; an expired, used or revoked link shows the same plain notice with no details. **A deliberate design stance:** the link is treated as a *credential*, not a convenience — issuing and filing are both rate-limited, and a filed report is written by the exact same database routine a congregation's own publish uses, so the two paths cannot drift apart. Ships switched off until a presbytery is ready.

- [ ] **`defect` · The monthly security review found two real problems, both fixed the same day.** A crafted sign-in link could send a user to an outside website immediately after they completed two-factor authentication, because the link-safety check reasoned about the text of the link rather than where a browser would actually go — it now parses the destination the way a browser does and validates the result. And recording a change to someone's disability category or guardian relationship was writing the *values* into the platform's audit log, which lives outside the congregation's own privacy boundary; the log now records only that a change happened and how many categories were involved.

- [ ] **`defect` · A set of database-level gaps that no screen exposed, but that a database connection could reach, is closed.** One congregation's connection could read and change another congregation's role-to-permission bindings; a maintenance helper could list every congregation's memberships; a person record could still be hard-deleted on some connections (now impossible on any — merging is the only path); five cross-table references did not carry the congregation as part of the key, so a record in one congregation could have pointed at a record in another; and a test fixture had produced over fifteen hundred duplicate group-kind rows, now removed and prevented. Every table is now checked for enforced row isolation by one catalog-wide assertion instead of a hand-kept list. **Two limits are documented rather than closed**, and worth knowing: the owner-level database connection the platform shell uses can still write role bindings directly (only a database trigger, never a grant, binds that connection — a standing fact every future design now reasons from), and a separate sign-in-only database connection was considered and deferred with its reasoning recorded.

- [ ] **`decision` · Your "make it look like the directory app" request was narrowed after the comparison showed the premise was mostly false — and what remained shipped.** Each congregation's chosen style already paired a heading typeface with a body typeface, but only the body face was ever wired in, so half of every style pairing was invisible; headings on a congregation's portal, public site and branded sign-in page now use the heading face. The wider "let congregations brand cards, menus and borders too" idea was **withdrawn** when it turned out the reference app brands none of those — its teal is a decorative accent, not a theme — so there was nothing to match. Two small things rode along: the organization switcher button was below the 44-pixel tap-target minimum on phones and now meets it, and corners are very slightly rounder across the whole platform (the long-deferred one-line change, done on its own so any surprise would be easy to spot). **Two decisions are yours and are recorded:** FPCW's sign-in page stays un-branded, and visual parity is signed off by your own side-by-side look at 360 pixels and desktop, not by a screenshot tool — that side-by-side (set the brand colour, Contemporary pairing, light-only on the admin page, then compare) is still open on your list.

- [ ] **`finding` · Two more rounds of the outside reviewer's read of the lifecycle and reporting foundation closed, and produced one rule the project now treats as permanent.** Round two found that a merger could be recorded with no predecessor bodies and that a "submitted" return could be fabricated without a clerk ever submitting it; round three found the privileged database helpers could be misdirected by a session's temporary tables, and that the presbytery's typed copy of a return could be forged. All closed in place (the migrations were not yet applied anywhere real, so correcting them in place was allowed). **The permanent rule:** the connection the platform shell uses owns every table outright, so a permission grant or revoke never binds it — only a database trigger does. Every real fix in these rounds was therefore a trigger, and that is now the first question asked about any new rule.

## 2026-09-24

- [ ] **`decision` · The database can now hold a permanent, minuted history of every congregation, presbytery and synod — organized, received, merged, divided, dismissed, dissolved — and organizations are never deleted.** The Presbytery of Scioto Valley has about 85 congregations today and roughly 172 across 41 years of records; without this, every trend report would silently show only the survivors. Which presbytery a congregation belongs to is now a dated history rather than a single current pointer, so a 1990 report is attributed to the presbytery that actually received it, and only a council with standing over both presbyteries can move a congregation between them. A submitted annual statistical report is frozen when submitted, kept apart from the live figures the roll implies and apart again from imported historical reports, which are preserved exactly as reported and never "corrected." Publishing to the presbytery is its own permanent event, and the presbytery reads exactly what was published, never the congregation's live records. **Nothing changed on any screen yet**; this is the foundation. **Two proposed rules were deliberately not added** because they conflicted with real history: one would have required every affiliation to state an exact start date (some predate any record of when they began), and one would have required every submitted report to name an attesting person (the platform cannot yet identify one). **Also fixed along the way:** the check that stops two operators creating the same web address at the same time had never worked, and the application's own database role had more write access to the organizations table than intended.

## 2026-08-30

- [ ] **`defect` · Now that this project's code is public, an automatic check was added that scans every file in the repository for anything that looks like a password, an API key, or a real person's or church's private contact information — and it's required to pass before any future change can be pushed.** Running it once against everything already in the repository turned up two real things worth knowing about, both now fixed: a random-looking password that had been typed into an old planning document while describing what a local test setting contained (nobody used it for anything real, but leaving a real generated password sitting in a public repository forever is bad practice regardless), and a real, actual street address and phone number for First Presbyterian Church of Westerville that had been entered into a project planning document while testing a feature — this is the same information already public on the church's own website, but it still goes against this project's own rule that no real address ever appears in this specific repository (a separate, private repository is where a real church's actual public-website content is supposed to live). Both have been blanked out going forward. **One thing you decided directly, worth remembering:** the history of every past change to this project still technically contains both of those values, because "erasing" something from a shared project's history is its own disruptive, hard-to-undo operation — you were asked, and chose to leave the history alone rather than rewrite it.

## 2026-08-28

- [ ] **`decision` · The public "who serves here" page from earlier today can now show a curated leadership page and separate committee pages, not just one flat list of everyone.** A website builder can now ask for exactly the people they want — by department, by office, or a hand-picked leadership group shown in whatever order you set — instead of only ever getting an alphabetical list of the whole staff. Committee membership can now be listed publicly too, the same one-person-at-a-time, off-by-default way staff and officer listings already work, with its own separate on/off switch so you can turn on committee listings independently of the staff directory. **Tried on fpcw's real site and found a real gap, not a code problem**: the mechanism works end-to-end (verified live with test data), but fpcw doesn't actually have its real staff or committee roster entered into the admin tools yet, so there's nothing real to show on the live site until that data entry happens — the existing hand-written committees page was deliberately left alone rather than replaced with an empty section. **A genuine architectural correction happened mid-build**: the first design for "let one webpage section show a different filtered list each time it's used" turned out to have a real flaw (two different filtered sections on the same page could get confused with each other) — caught and redesigned before anything shipped, not discovered after the fact.

- [ ] **`decision` · A public "who serves here" page is now possible on a
  congregation's or presbytery's public website, pulling directly from the
  same staff and officer records the admin tools already keep — no more
  manually retyping names onto a webpage and forgetting to update it.** An
  admin has to affirmatively mark each specific staff position or officer
  term "public" one at a time — nothing is shown by default, and a
  confirmation message explains plainly that turning this on makes that
  person's name, role, and eventual photo visible to anyone on the internet,
  including search engines, and that turning it back off stops future
  display but can't un-ring a bell already rung elsewhere on the internet.
  Only name, role, and department are ever shown — never a phone number or
  email address, enforced in two separate, independent places so a single
  mistake can't leak contact information. **A real gap was found and fixed
  the same day it was found**: the code powering this page had no
  fallback for a brief database hiccup, which would have taken down the
  *entire* public website for that congregation instead of just quietly
  hiding the one directory section — closed before it ever went live. Photo
  display is designed in but not yet built (tracked separately). Ships
  fully turned off until you're ready to turn it on for a real
  congregation.

- [ ] **`decision` · Following up on your own live comparison against
  `../fpcw-directory`, three specific visual gaps in the Directory and the
  main navigation were closed the same day.** Every person's photo circle
  now gets its own consistent color instead of one identical gray circle
  for everyone; the Members/Households/Parishes tabs now sit in a rounded
  tray with the active one raised, instead of looking like plain buttons;
  and the main navigation now shows a small icon next to each section with
  the current section highlighted as a filled pill, instead of a plain
  underline. **A real bug was caught only by looking at it in an actual
  browser, not by any automated check**: an early version of the navigation
  change crashed every single page with a working navigation bar entirely,
  a mistake invisible to the code's own type-checking and build process —
  found and fixed before you ever saw it. Separately, four capabilities your
  reference app has that this one doesn't yet (printing/exporting the
  directory, saving a contact card, photo management, and map links to an
  address) were written down as a backlog item — with a flag that printing
  or exporting the whole directory needs to be limited to specific trusted
  people once built, not available to everyone who can merely view the
  directory, since exporting is a much bigger privacy exposure than
  viewing one card at a time.

## 2026-08-27

- [ ] **`defect` · The tool tiles on the portal home page (Members, Directory,
  Staff, and the rest) had started to blend into the "coming soon" stubs
  sitting right beside them — a screenshot you sent in flagged this
  directly.** Two real, confirmed causes, not a vague "make it feel
  cleaner": the colored icon badge on every real tool was a faint,
  10%-strength tint that nearly disappeared against a congregation's own
  branded page background — weaker, in fact, than the plain corner avatar
  icon, which is backwards for the single most-repeated element on the page.
  And every not-yet-built tool (giving, worship planning, committees, and a
  few others) rendered as a full, equal-looking card, with "coming soon."
  buried in a sentence of description text — visually indistinguishable from
  a real, working feature. Fixed both: real tools now get a solid, fully
  colored badge; not-yet-built ones get a muted gray badge and a small
  "Coming soon" tag next to the name instead. **A separate, real bug was
  caught while making this fix, unrelated to the visual issue**: two tiles
  (Oversight and Reports) were still labeled "coming soon" even though both
  had already shipped as real, working pages earlier the same day — stale
  leftover copy, now corrected. This was one visible pass at your "doesn't
  feel as clean as the original directory app" feedback; it addressed two
  concrete contributors but not a full redesign, in case the feeling
  persists once you look again.

- [ ] **`decision` · Congregations and presbyteries can now record actual
  paid or volunteer staff — office managers, custodians, bookkeepers,
  musicians — completely separate from the constitutional roll of members
  and from ordained officers.** This was a deliberately different shape from
  everything built so far: hiring or letting go of a staff member never
  touches someone's membership status or roll history, even when the same
  person is both a member and an employee. A new "Personnel Administrator"
  permission was created for this, since no existing office (clerk,
  treasurer, pastor, trustee) was actually the right constitutional fit —
  each was checked individually and none qualified. **A real, meaningful bug
  was caught and fixed before this ever reached you**: the shared
  person-creation code this feature reuses was about to mark a staff-only
  hire (someone with no membership at all) with the same internal status
  used for regular members — which would have made them wrongly show up in
  the public member directory and the membership roster. Caught in review,
  fixed before shipping. A second real gap, also caught before shipping: the
  save button for adding a new staff member wasn't actually checking that
  the person doing the saving held the new Personnel permission at all —
  meaning anyone who could reach the page could have added staff regardless
  of their role. Fixed, with a test that specifically tries the bad action
  and confirms it's now refused.

- [ ] **`decision` · Congregations and presbyteries can now turn entire
  categories of the portal on or off at once (for example, hiding every
  giving/finance-related tool as a group) instead of only being able to
  flip one individual feature at a time.** This sits as a second, coarser
  layer on top of the existing individual toggles — an admin can turn a
  whole category off, or turn it back on and then fine-tune individual tools
  within it. Everything defaults to fully on, so nothing changes for a
  congregation that never touches this new control. **A real bug was caught
  by an independent review before this shipped**: a chunk of screen-drawing
  code had been accidentally written inside the same block of code
  responsible for error-handling, which could have produced a broken page in
  an edge case; restructured and fixed before release. This entire feature
  and the staff/personnel one above were designed and built side by side —
  both teams briefly, and independently, reached for the same internal
  migration step number, caught and corrected before either was affected.

- [ ] **`decision` · The operator-supplied brand kit (navy, blue, and gold,
  with a real logo) is now the platform's actual default look, replacing the
  placeholder color scheme that had been standing in since the earliest
  foundation work.** This only replaces the platform's own shell and the
  public marketing home page — a congregation that has already set its own
  colors is completely unaffected, exactly as designed. Two small,
  deliberate departures from the kit as delivered: the "danger/delete"
  red was nudged very slightly (a change no eye would notice) because the
  kit's exact shade sat just barely inside a safety margin one of this
  project's own automated color-safety checks enforces, for one specific,
  unusual congregation-brand-color combination out of hundreds tested; and a
  dark-mode version of the palette was designed from scratch, since the kit
  itself only specified one (light) scheme. Also fixed while doing this:
  every leftover plain-text "presby" placeholder around the app (page
  titles, the admin section's own back button, browser tab icon) now shows
  the real name and logo instead.

- [ ] **`decision` · The project now has a real public name: PresbyPortal**
  (`presbyportal.org`)**, ending the "placeholder" period the foundation
  work had been tracking since the very beginning.** Public-facing pages —
  the marketing home page, the README, external docs — use the real name
  starting immediately. Internal, behind-the-scenes technical names (the
  database's internal role name, function-naming prefixes, old migration
  filenames) are **deliberately left as "presby" for now, on purpose, not
  as an oversight** — those are load-bearing internal names a live database
  actively depends on, and safely renaming them is its own carefully
  sequenced future project, not a quick find-and-replace. Tracked as its own
  future backlog item.

- [ ] **`decision` · Signing in now takes you to one combined "home" page
  instead of a separate organization-picker screen, and the platform admin
  hub now only shows each admin the tools their own permissions actually
  unlock (instead of a fixed list with some tiles denying access when
  clicked).** The old organization-picker address still works — it quietly
  forwards to the new combined page — so nothing that used to link there
  breaks. The marketing home page (the one a signed-out visitor sees) was
  also redesigned in the same batch of work. **A real, pre-existing bug was
  found and fixed as part of this**: the support-ticket/feedback-handling
  role could not actually reach the admin section at all, despite being
  intended to handle tickets and feedback there — a gap in how that role was
  originally set up, invisible until this work went looking for it. This
  whole change ships behind its own on/off switch, specifically so the new
  merged home page's content (not the sign-in redirect itself) can be
  switched off quickly if a problem turns up after release, without needing
  a new deployment.

- [ ] **`decision` · The next phase of work for presbyteries — not just a
  login screen, but real functionality — is fully designed, though nothing
  has shipped from it yet.** The central problem: a presbytery obviously
  needs to see its member congregations' basic statistics (membership counts,
  gains and losses, giving), but this platform's own privacy rule says one
  organization's records are never directly reachable by another — even a
  presbytery reaching into its own member congregations. The answer: a
  congregation's own clerk will annually "publish" a summary snapshot
  upward — a deliberate, one-way, aggregates-only handoff (no names, no
  individual member records) through a narrow purpose-built mechanism, not a
  new "presbyteries can read into congregations" back door — and once a
  year's snapshot is published it's frozen; any correction has to be a new,
  superseding publication, never a silent edit to the old one. For
  congregations too small or not yet fully set up to publish for themselves,
  the presbytery can enter or import estimated numbers on their behalf,
  clearly labeled as an estimate so it's never confused with a real
  self-report. Per-capita billing (what a congregation owes per member) was
  researched against actual denominational practice rather than guessed at:
  presbyteries genuinely bill off a membership count from two years earlier,
  because the current year's statistics aren't compiled until partway
  through the following year — that two-year lag is now the built-in
  default, adjustable if a presbytery's own practice differs. The planned map
  showing where every member congregation sits was going to use a more
  polished third-party mapping library, until its license terms turned out to
  be incompatible with this project's rules — caught before anything was
  installed, so the plan now uses a smaller, permissively licensed library
  directly instead. The actual screens (presbytery notes on each
  congregation, statistics entry, and the rollup dashboard) are designed and
  queued to be built next.

- [ ] **`decision` · The portal's home page and navigation were reorganized
  around named categories — People & Membership, Worship & Events, Giving &
  Finance, Governance & Courts, Reports & Insights, Communications,
  Administration — because the old flat list of tools was starting to run
  out of room as more features shipped.** Every part of the product that's
  planned but not yet built (giving, worship planning, insights,
  communications, and, for presbyteries, committees/oversight/reports) now
  has its own honest "coming soon" page, so the shape of where this is all
  headed is visible today instead of hidden until it's ready.
  **Worth your attention:** those coming-soon pages are deliberately switched
  on in the development environment right now, specifically so the roadmap
  stays visible while more of it gets built — they need to be switched off
  again before any real organization sees this. Separately, "Give feedback"
  moved out of the main tool list and into the account menu, plus a
  dismissible reminder card at the bottom of the portal home — the same
  reminder card the platform's own home page already uses.

- [ ] **`decision` · Buttons got a bolder, more modern look, chosen from two
  live mockups you reviewed directly.** On a congregation with its own
  colors, a button's fill now automatically deepens until white text is
  genuinely legible on it (checked against the real accessibility contrast
  requirement, not eyeballed), buttons gained a subtle shadow that lifts
  slightly on hover, and a disabled button now reads clearly as "turned off"
  — a flat gray — instead of a washed-out, ghostly version of its normal
  color. **Because this lives in the shared color math, not a per-congregation
  setting, every branded congregation's buttons repainted automatically the
  moment this went out — nobody has to re-save their branding for it to take
  effect.** A real asymmetry was found and put to you rather than silently
  shipped: dark mode computes its own, separate color pairing (it searches in
  the opposite lightness direction from light mode), which can legitimately
  mean dark text on a lighter version of the same brand color — you reviewed
  a live dark-mode screenshot and accepted that result as correct rather than
  it being an overlooked bug. Separately, since this audience skews older,
  every text box, dropdown, and button across the whole app now renders
  larger (16-point) and buttons render in a bolder weight — which also closed
  the last visible difference between the home page's search box and every
  other search box in the app.

- [ ] **`finding` · Building the button-color change surfaced a pre-existing
  gap worth knowing about, unrelated to anything broken today.** The code
  that renders a congregation's brand colors regenerates them fresh from
  that congregation's saved color on every single page view — it never
  checks a version marker that's supposed to track which color "recipe"
  produced them. Practically: today's button-color change, and any future
  change to the color math, silently changes the appearance of every
  already-branded congregation the instant it goes live, with no version
  bump, no history record, and no re-save required. Whether that's the
  permanently intended design, or whether a congregation's colors should
  instead stay pinned until they explicitly re-save, is still an open
  decision — tracked, not resolved, by this finding.

- [ ] **`defect` · A separate, real bug surfaced the same day: in
  Chrome-family browsers (including Arc), a search box the browser had
  auto-filled for you rendered with the browser's own gray-blue tint,
  visibly different from an identical, empty field right beside it.** This
  had nothing to do with the form-field fix described below — Chrome's
  autofill paints its own color directly on top of the page, in a way
  ordinary page styling cannot override. Fixed by having the page
  counter-paint an autofilled field with the app's own background color, so
  an autofilled field now looks the same as an empty one. Confirmed directly
  with you, on the exact browser where you'd seen it.

- [ ] **`finding` · While double-checking this batch of work, seven small
  code-quality warnings already present on the main line of development
  before any of it started were noticed and left alone, rather than folded
  into an unrelated fix.** Two are a repeated pattern flagged on two
  already-existing files; five are on the brand-new children's-roster
  screens, from a stylistic rule about how a certain kind of code is written.
  None of these currently block anything from being pushed live; they're
  tracked for their own cleanup pass instead of being silently absorbed into
  this batch's commits.

- [ ] **`defect` · Very shortly after the new presbytery credentials feature
  shipped, every ordinary congregation's portal was found to be showing a
  "Credentials" tile that led nowhere useful.** Clicking it produced a
  permission-denied message telling the member to "ask your stated clerk" —
  which is actively bad advice, because no congregation-level role can ever
  unlock this tool; it's presbytery-only by design. Root cause: the part of
  the system deciding which tiles a congregation sees knew whether a feature
  was turned on at all, but had no notion of "is this type of organization
  even supposed to see this" — so a presbytery-only feature bled onto every
  congregation regardless of type. Fixed the same day: the tile now only
  appears for presbyteries, and a congregation that navigates straight to the
  web address anyway now sees an honest "this is a presbytery-level tool,
  not something your kind of organization uses" message, instead of the
  misleading "ask your clerk" one. Caught by you using the live product, not
  by an automated test — a reminder that this class of "who should even see
  this" gap doesn't reliably show up in test suites.

- [ ] **`defect` · Form fields had been rendering white on some screens and
  gray on others — most noticeably, boxes on white card-style panels looked
  different from the search boxes sitting right next to them.** Root cause:
  the reusable, auto-generated building blocks behind every text box had
  quietly kept an inherited default that lets the color of whatever's behind
  a field show through, instead of following this project's own documented
  "every field gets the same background" rule — and a couple of screens had
  been individually patched around the problem in the past, which only
  deepened the inconsistency everywhere else. Fixed by making the shared
  building blocks follow the documented rule themselves, and removing the
  old patches. **Also found, and deliberately not fixed in this same pass:**
  in dark mode specifically, a text field and the dropdown sitting beside it
  still don't match — a separate, pre-existing gap, tracked on its own for a
  later pass.

- [ ] **`decision` · The first feature built specifically for presbyteries,
  rather than congregations, shipped: a presbytery's stated clerk can now
  record a minister's ordination, track their current standing over time,
  and record which congregation a minister is serving as pastor.** The
  design carefully separates two things that sound similar but aren't:
  ordination is permanent once it happens — a minister doesn't stop being
  ordained just because they retire or take a leave of absence — while a
  minister's current standing (active, retired, on leave) and their specific
  pastoral assignment can both change, and the screens make that distinction
  explicit instead of conflating "end this assignment" with "end this
  ordination." A minister has to already be a recognized member of the
  presbytery before either record can be created; rather than allow a
  shortcut, the system points staff to the existing member-creation process
  first, so a credential can never quietly attach to someone who was never
  actually processed onto the roll. Separately, this work double-checked
  that the ordinary portal — directory, members, groups, officers, feedback,
  branding — already works correctly for a presbytery and not just a
  congregation; a handful of screens whose wording had assumed "your
  congregation" were reworded to fit both kinds of organization.

- [ ] **`decision` · A real events/calendar feature shipped for staff use —
  one-time events or recurring series (weekly, or monthly-by-weekday, capped
  at 52 occurrences so nobody can accidentally generate a runaway series),
  with every actual date stored as its own real record so cancelling one
  Sunday's meeting never disturbs the rest of the series.** Events cancel
  rather than delete, so the history stays intact rather than disappearing.
  As with a couple of other recent features, no single congregation office
  was assumed to be the automatic owner of "who's allowed to manage the
  calendar" — each congregation decides for itself who gets that permission.
  **A commitment between two different pieces of work-in-progress, worth
  knowing about:** six specific pieces of information on every event (its
  identity, its organization, start and end time, whether it's cancelled,
  and whether check-in is allowed) are now formally frozen and promised to
  the not-yet-built children's-ministry check-in feature — meaning nobody
  can casually change or remove those six fields later without a joint
  review with whoever eventually builds check-in on top of them.

- [ ] **`decision` · Congregations can now keep a roster of every child in
  the congregation — computed automatically from birthdate, so nobody has to
  remember to manually flag someone as "a kid" — and record who each child's
  parents, guardians, and emergency contacts are.** Linking to a person's
  existing directory record is preferred over typing a name in free text, so
  their phone number and email come along automatically. A new "Children's
  Ministry Administrator" role holds this, deliberately kept separate from
  the role that can see a child's medical and allergy information, so a
  Sunday-school volunteer can be trusted with the roster without
  automatically being trusted with health details too. **Worth your
  attention:** anyone holding this new role sees a child's actual, real
  birthdate on the roster — even for a family that has otherwise asked the
  congregation not to show their birthday anywhere public — because the
  entire point of the roster is computing age, which is impossible to do
  from a hidden birthdate. This was a deliberate, narrow decision made in the
  open, not an oversight, and the description shown to whoever is being
  granted the role says so plainly.

## 2026-08-26

- [ ] **`decision` · Congregations can now create and manage their own
  committees, small groups, choirs, and teams** — genuinely useful,
  member-managed groups, distinct from the Session and the Board of Deacons,
  which the system still builds and maintains for you automatically from
  officer records and does not let anyone edit by hand.

- [ ] **`defect` · Building that groups feature turned up two real,
  narrow holes in the automatic protection around the Session and Board of
  Deacons rosters, which had existed since those rosters were first
  automated and were only now discovered and closed.** The safety rule
  meant to stop someone from deleting an already-approved Session or
  Deacon-board membership record only checked for an *edit* that tried to
  quietly reclassify the record — an outright delete could have slipped
  through the same door unblocked. Separately, there was no rule at all
  stopping someone from directly renaming the Session itself or changing
  when it meets, bypassing the formal officer-terms process that's supposed
  to be the only legitimate way that ever happens. Both closed at the
  database level — the layer that's supposed to make this kind of bypass
  structurally impossible, not just discouraged — with tests specifically
  written to attempt the bad action and confirm it's now refused.

- [ ] **`decision` · Congregation staff can now record certain kinds of roll
  actions — like a transfer received or a reaffirmation of faith — directly
  from a member's own edit screen, instead of needing a separate flow for
  it** — but deliberately not every kind. Anything that could end someone's
  membership, or that touches their offices or roles, stays off this
  quick-edit screen and still has to go through the more deliberate,
  fuller process. Separately, the platform now recognizes genuinely
  different tiers of sensitive information about a member — pastoral care
  notes, the demographic and disability details used for annual
  denominational reporting, and medical/safety information — and each got
  its own dedicated permission and its own gatekeeper role, so a
  congregation can hand out narrower access instead of one all-or-nothing
  button. A new "Member Care Administrator" role was created specifically to
  hold the medical/safety keys, kept apart from the pastor's own confidential
  notes. **A small housekeeping note:** while building this, an older
  permission — meant, since an earlier pass, to let an installed pastor see
  confidential notes — turned out to have never actually been connected to
  anything; it's being retired in favor of the new one rather than running
  two overlapping permissions side by side.

- [ ] **`decision` · Congregations can now define their own custom
  administrative roles — deciding exactly which permissions each one carries
  — instead of only using the roles the system ships with.** A new,
  dedicated "Role Administrator" office was created specifically to hold
  this power, deliberately not handed to the Clerk of Session role, which
  was already accumulating more and more capabilities one addition at a
  time. Deactivating a role now correctly ends everyone's access granted
  through it in the same step, so a revoked role can't leave people quietly
  holding on to abandoned permissions.

- [ ] **`defect` · Building the custom-roles feature caught a real
  self-escalation gap before it ever reached a real congregation.** Someone
  holding the power to define what a role contains could have edited a role
  they already held to quietly add a more powerful permission to it, and
  because that's editing an existing role rather than creating a brand-new
  grant, none of the existing safeguards against "don't hand out more power
  than you have yourself" would have noticed. Closed by reusing the exact
  same check that already governs the separate "grant a role to someone
  else" action, so both paths are held to the identical standard. Found in
  review before anything shipped, with a new test that recreates the
  exploit and confirms it's now blocked.

- [ ] **`decision` · The "make the portal look and feel like fpcw-directory"
  redesign, which an earlier note in this log said was still just at the
  planning stage, has now actually shipped:** card hover effects, real
  shadows and depth on buttons and tiles, and — going further than a pure
  visual port — congregations can now set their own logo, colors, and fonts
  themselves rather than needing a platform staffer to do it for them. The
  main portal tools were also reorganized between the everyday home screen
  and the "administer this org" section. **A correction disclosed rather
  than quietly folded in:** you caught, and had fixed the same day before
  anything shipped, two things that had been gotten wrong on the first pass
  — routine day-to-day tasks like adding a member or recording an officer's
  term had been mis-filed under "org setup" instead of "ordinary ministry
  work" (moved back), and an early full-color tile design that had been
  built to read as "bolder and more modern" instead read as flat and
  unpleasant to look at — replaced with a subtler card-and-shadow look that
  better matched what was actually being asked for.

- [ ] **`decision` · Editing a member's details, and paging/searching/filtering
  long member lists, both shipped today — but built solo, without the usual
  second set of eyes.** You can now open an existing person's record and
  update their name, contact info, address, and household (their membership
  status and any life-event history stay off that screen entirely — those
  still only change through the formal roll process, on purpose). Both the
  members list and the public-facing directory also gained real paging,
  search, and a filter by membership status, so a congregation with hundreds
  of members doesn't load them all onto one screen at once. Both pieces of
  work were designed, built, and checked by a single AI working session that
  couldn't split the work across this project's usual separate
  reviewer roles — disclosed honestly in both cases rather than presented as
  a full independent check. A real hands-on test in a phone-sized browser
  window is still owed before either goes in front of real members.

- [ ] **`finding` · The portal's header and mobile menu got two small but
  real fixes, at your direct request.** The header now shows only a
  congregation's logo (no redundant text name next to it), and clicking that
  logo takes you to the congregation's *public* website rather than back
  into the portal. The mobile menu — which used to just wrap its links onto
  a second line of plain text — now behaves like an actual menu: a
  tap-to-open button that closes itself once you've picked something.

- [ ] **`finding` · A "make the portal look and feel like fpcw-directory"
  redesign is underway, but only at the planning stage — nothing has
  shipped from it yet.** What's a straightforward visual port (card
  hover effects, icons) is now scoped apart from what has to be designed
  from scratch for the first time (dropdown navigation menus, a page
  footer).

- [ ] **`finding` · Two of this session's own working folders moved, to fix
  a mix-up between different projects.** The two companion projects used to
  build the Westerville First Presbyterian church website (its content, and
  the shared design-template library behind it) were nested inside this
  project's own folder in a way that occasionally confused this project's
  own safety tooling — twice, a push meant for one of those side projects
  got mistakenly evaluated as if it were a push to this project itself.
  Moved out to sit alongside this project instead of inside it, which also
  surfaced and fixed a related, unrelated build glitch.

## 2026-08-25

- [ ] **`decision` · Congregations can now add a brand-new person to their
  roll, not just view people already on it — the very first "write" the
  roll has ever had.** A guided, step-by-step form (built with older and
  less tech-savvy users specifically in mind — one thing per screen, big
  buttons, nothing lost if you go back a step) checks for a possible
  duplicate first, then collects the person's details, and records the
  action for a designated reviewer to approve. A newly added person shows
  up in the directory the moment they're placed in a household, not only
  after the paperwork is formally approved — a stronger guarantee than
  originally planned. Congregations can also now turn specific features on
  or off for themselves individually, not just via a platform-wide switch —
  a new mechanism future features can build on.

- [ ] **`defect` · Building that "add a person" feature caught two real
  gaps in the database's own safety rules, before either could touch a real
  congregation.** The database's row-level protection had never actually
  been given permission to let a brand-new person's record be created in
  the first place — confirmed broken, not just untested, and fixed
  carefully so a congregation still can't attach details to someone else's
  already-existing member record, only to a genuinely unclaimed one.
  Separately, a safety trigger meant to stop an already-approved roll entry
  from ever being deleted was also, by a small coding slip, blocking the
  deletion of a still-pending (not yet approved) one — which should be
  allowed. Both caught and fixed before shipping.

- [ ] **`decision` · Inside a congregation's portal, the header now shows
  that congregation's own identity instead of the platform's** — its logo
  and name where "presby" used to sit — plus a menu that's present on
  every portal page, not just the home screen. A brief visual regression
  (a long congregation name no longer got visibly truncated at phone
  width, because the smaller logo freed up space in the header) was caught
  by the test suite and fixed the same day; the fix was judged the better
  outcome — an untruncated name that fits is better than one clipped for
  no reason — not a workaround.

- [ ] **`decision` · A congregation can now be set to "light mode only,"**
  for congregations — like Westerville First Presbyterian — whose real
  branding was never designed with a dark background in mind. Forcing dark
  mode on a brand that was never built for it would look genuinely wrong,
  not just different.

- [ ] **`decision` · The sign-in page can now show a visiting congregation's
  own logo, colors, and fonts** when someone arrives from that
  congregation's public website looking to sign in — but only for
  congregations that already have a public website live, so the feature
  can never be used to probe which organizations are or aren't real
  tenants. A real defect was caught before shipping: the Google sign-in
  button briefly picked up the congregation's brand color instead of
  staying Google's own required blue — fixed and verified.

- [ ] **`defect` · A serious, since-fixed bug let a member skip two-factor
  verification entirely, under one specific condition that happens
  routinely today.** Anyone signing in via a link that pointed *directly*
  at a protected page — which is exactly what happens every time a
  session expires while someone is browsing a congregation's portal —
  could land on that protected page without ever being asked for their
  two-factor code. The cause was a technical quirk in how the sign-in
  page hands off to the next page, which meant the usual security
  checkpoint never got the chance to run. Found by the team's own testing,
  not by an outside party, and fixed the same day. A related, narrower
  version of the same quirk — affecting some feature-specific
  restrictions rather than two-factor login itself — is tracked as a known
  follow-up, not yet fixed.

- [ ] **`decision` · Platform staff can now create a brand-new congregation
  from scratch** through the admin screen — surprisingly, nothing in the
  platform could do this before today; every congregation that existed had
  been added by hand directly in the database. Building it also caught two
  real bugs in how a brand-new congregation's default internal groups (its
  Session, its Board of Deacons, etc.) get set up. The very first real,
  non-fixture congregation — First Presbyterian Church of Westerville — was
  created using this new tool as part of bringing their real website
  onto the platform. **Worth your attention:** a platform-wide switch
  controlling whether *any* congregation's public website is reachable
  from the open internet was found already turned on partway through this
  work, and it is not yet confirmed whether that was intentional.

- [ ] **`decision` · A fourth font-pairing option ("Contemporary" —
  Montserrat and Open Sans) was added to the branding system**,
  specifically because Westerville First Presbyterian's real site uses
  that exact pairing and none of the three existing options fit it. Every
  congregation gets the wider choice now, not just this one.

- [ ] **`defect` · A member bounced to an "access denied" or "your
  membership here has ended" page had no way back to the congregation's
  public website** — only a link to their list of organizations, which
  isn't useful if they arrived from that congregation's own site directly.
  Fixed. A second complaint in the same report (no way to sign out from
  that page) turned out to already work fine — a discoverability issue,
  not a missing feature.

- [ ] **`finding` · A handful of small polish fixes landed on the public
  congregation-website pages**: the browser tab was showing "presby"
  instead of each page's own real title, and a "Member Login" link was
  appearing as its own separate top-level menu item instead of folded into
  a congregation's existing navigation — the way the real Westerville site
  actually does it.

## 2026-08-21

- [ ] **`decision` · A congregation's public website can now show its
  street address, phone number, service times, and office hours** —
  entered by platform staff for now (a congregation's own admin doing this
  themselves is a named, deliberately deferred follow-up, not forgotten).
  Built as real structured data rather than a free-text blob, so each piece
  can be checked for sense (an end time has to be after its start time, a
  day has to be a real day of the week) and shown or hidden independently.

- [ ] **`finding` · While verifying that feature, an automated tool the
  team runs printed an odd, unsolicited "tip" in its console output that
  read like an attempt to get an AI agent to visit an external site and
  authenticate.** Neither reviewing agent acted on it or investigated
  further — it was disclosed for your awareness rather than treated as
  part of the actual verification. Worth knowing that this kind of thing
  can show up in ordinary tool output.

- [ ] **`defect` · A ticket's subject line could stretch a whole
  admin or member table sideways** if it was long enough — the column was
  told to have a maximum width, but the text inside it never actually
  respected that limit. Fixed on both the staff-facing and
  congregation-facing ticket lists (the same bug existed, unreported, on
  the second one).

## 2026-08-20

- [ ] **`decision` · A full support-ticket system shipped: members and
  congregations can now report a problem or request, and a designated
  person reviews and works it — deliberately with no AI given its own
  write access to anything.** Filing, replying, categorizing, and
  resolving all go through a real, accountable reviewer; a simpler "just
  leave feedback" option feeds into the same queue when appropriate. Email
  notifications fire at every real status change (a new ticket, a reply, a
  resolution) but not on routine internal housekeeping. Turned off for
  now — no congregation is live enough yet to need it.

- [ ] **`decision` · Filled in the platform's role catalog with three new
  offices that had never actually been given to anyone: Treasurer, an
  installed Pastor, and a new "Support Contact" role for filing tickets** —
  previously, every new capability had been landing on one existing office
  (the Stated Clerk) purely because it was the only one that existed,
  which risked quietly turning that one office into a catch-all
  super-admin. Correction made in the same pass: ticket-filing, which had
  been bound to the Stated Clerk out of pure expediency, was moved off to
  its own dedicated role instead.

- [ ] **`decision` · Congregations can now have a real public website,
  hosted by presby, built from managed content rather than a drag-and-drop
  page builder** — a congregation's own content lives in its own private
  repository, is automatically checked and published every time it's
  updated, and renders through one shared, versioned template so every
  congregation's site benefits from the same fixes and improvements at
  once. A visitor gets an anonymous contact form; a designated
  congregation reviewer sees what comes in. Shipped with its safety
  properties genuinely tested — a suspended or de-provisioned site can't
  be told apart from one that never existed, and an outside party can't
  forge the automated publish step — and two real test-coverage gaps were
  caught and closed before the team signed off. Turned off for now; real
  open questions remain about exactly who can see the underlying private
  content repositories and whether the hosting provider's own size limits
  will hold up once real content is flowing.

## 2026-08-19

- [ ] **`decision` · Congregations can now designate someone to manage who
  has access to what — not live for anyone yet, on purpose.** A
  congregation's Stated Clerk (a real, elected office, not a new
  invention) can grant or revoke administrative roles for other members —
  the same read-only "who's a member" grant `directory.view` uses, applied
  to a write, with careful checks so nobody can grant themselves more power
  than they already have and nobody can accidentally lock everyone out. The
  page is built and independently tested twice over (once by an automated
  verification pass, once by a fresh read against the original
  requirements), but the switch that turns it on for real congregations is
  deliberately left off — there's no benefit to exposing an administration
  surface before a real congregation exists to use it safely.

- [ ] **`finding` · Two architectural decisions from earlier today turned
  out to be based on a stale reading of the database — corrected, not
  removed.** Both described a specific gap (a departed member could
  theoretically keep an administrative permission forever) as real and
  unaddressed. It turns out a safeguard already existed in the database
  from before either decision was made — nobody had checked. Both
  decisions now carry a dated correction explaining what was actually
  true, rather than being silently rewritten.

- [ ] **`defect` · A just-written feature would have let any ordinary
  member grant themselves or anyone else administrative-adjacent roles,
  caught before it ever shipped.** The tenant role-administration code
  (grant/revoke access at a congregation) was built with a check that,
  looked at closely, only stopped someone from handing out a role more
  powerful than their own — it never checked whether they were allowed to
  hand out roles *at all*. The practical effect: any regular member could
  have granted certain lower-tier roles to anyone, with zero administrative
  standing, because the one permission meant to gate this whole feature was
  never actually being checked in the write path. Found in my own review
  before commit, not by a later test failure — fixed the same session, with
  a new test that specifically re-creates the exploit and confirms it's
  now blocked.

- [ ] **`decision` · Per-congregation branding shipped end to end.** An
  operator sets a colour, logo, and one of three type pairings at
  `/admin/organizations`; every page under a congregation's own `/o/<slug>`
  now renders in that palette, while every platform-shell page (auth, admin,
  the DECISION-040 access-denied page) stays platform-default by
  construction — a branded 403 would tell a prober the slug is a real
  tenant. The colour ramp is generated in OKLCH from one seed colour with no
  new dependency, and it's asserted against real contrast floors (588
  seed/scheme combinations tested), not just picked to look right. Public,
  anonymous rendering of a congregation's own site (`(public)/site/<slug>`)
  is deliberately not part of this — that's its own later pipeline (P3).

- [ ] **`defect` · Two real bugs the branding work caught in itself, not in
  something older.** First: the read function that hands a congregation's
  brand to its own pages was built taking only an organization id and
  re-deriving *which person* was asking from the session — but the
  permission check needs a different id than the session carries, and the
  mismatch failed silently, rendering the platform-default look for every
  real member with no error anywhere. Second: the same property-testing that
  proved the colour generator correct also caught it producing an
  under-contrast input-field border in some light palettes and a
  washed-out, indistinguishable grey in some dark ones. All three fixed
  before shipping, with the property test now covering the specific cases
  that found them.

- [ ] **`decision` · A congregation's own members can now see a real
  directory of who else belongs there** — the first actual church content
  the platform shows anyone, gated by a genuine permission check (not just
  "you're logged in") and filtered field-by-field in the database query
  itself, never in the page component, so a privacy setting can't be
  bypassed by a change to what the page happens to render. Getting any
  member this far required solving a real bootstrapping problem first: there
  was no mechanism to say "every member of this congregation automatically
  has at least directory access" without inventing something that could
  later be abused for more sensitive data — solved with a narrow, purpose-
  built group rather than a shortcut in the permission engine itself.

- [ ] **`finding` · Three real bugs the permissions work caught in itself.**
  A safety trigger that keeps the elder/deacon rosters in sync turned out to
  also fire — correctly, but unexpectedly — on an unrelated update inside
  the isolation test suite's own test, breaking it. A historical
  membership fixture dated 1996 silently failed a "what did the roll look
  like on this date in the past" check, because the new mechanism stamped
  its own start date from a database default (today) rather than the
  membership's real, decades-old start. And separately, unrelated to any of
  this: the architectural decision log had three decision numbers each
  minted twice by two different recording passes — caught and fixed before
  it could cause a real collision.

- [ ] **`decision` · Tenant administration — letting a congregation manage
  its own permissions — is underway, and the hardest question in it is
  answered.** Who gets to grant access to others, before anyone else has
  been granted anything? Extending it to every elder simultaneously was
  rejected as disproportionate power with no individual accountability;
  instead it's bound to a new role modeled directly on the Presbyterian
  Stated Clerk — a real, elected office whose job already is exactly this
  kind of individual record-keeping authority. Fixture-seeded to exactly one
  person at one congregation for now, on purpose, to prove the mechanism
  once rather than everywhere at once.

- [ ] **`defect` · The table that would record who granted or revoked
  access has no isolation protection at all** — not merely missing a
  congregation-id column, but entirely absent from the list of tables the
  database's row-level security even applies to. Nothing writes to it in a
  way that leaks anything today, but a congregation-facing "who did this"
  screen cannot safely be built on top of it as-is. Deferred rather than
  built unsafely; the underlying write still happens on every action, so the
  history exists in the database even though no screen can show it to a
  congregation yet.

- [ ] **`finding` · The command that's supposed to apply database migrations
  doesn't actually work in this environment, and hasn't for a while.**
  Confirmed it fails identically on unmodified `main`, so it's not something
  recent work broke. Every migration past the ninth has, in practice, been
  applied by hand directly against the database rather than through the
  tool meant to do that — which has worked, but means there's no tooling
  proof that a fresh environment could stand this database up from
  scratch by running the documented command. Worth a real look, not just
  another line item, since it sits under every other schema change made
  so far and every one still to come.

- [ ] **`finding` · The next-auth security bump this file already told you
  about is done.** The version that closed the three known advisories
  shipped. The custom-domain session work it was blocking (noted below,
  still unread) can now proceed whenever that's prioritized.

- [ ] **`defect` · The brand contract failed its own defaults on first run.**
  Three shipped defects, none previously visible, all found by measuring the
  platform palette against the floor the contract was about to declare: the focus
  ring at **1.00:1** against 3:1 (`--ring` and `--primary` are the same colour and
  the ring is drawn flush against the fill — the fix is a 2px offset carried as
  contract data, not a different colour); `muted-foreground` at 4.70:1 against a
  7:1 floor across 201 references; `--input` at 1.24:1 against 3:1. Fixed in
  `f0ebd7c`.
  **And a correction to something I told you.** I reported dark
  `destructive-foreground` at 3.61:1 as a shipped AA failure. It was not —
  that token has zero consumers, because `button` and `badge` hard-code
  `text-white` and dark fills render through an alpha, so what actually paints is
  7.56:1. You ruled to move the text rather than the hue, which fixed the token
  pair without regressing the destructive dropdown item to 3.04:1.

- [ ] **`defect` · The focus ring has been invisible since P0 shipped.**
  `--ring` and `--primary` are the same colour in both schemes, so the ring
  drawn on the default button is **1.00:1** against a 3:1 floor. A keyboard user
  cannot see where they are. Found by measuring the palette against the
  accessibility floor the brand contract was about to declare — the contract
  caught its own defaults. Being fixed in P0.5 commit `0.1`, along with
  `muted-foreground` at 4.72:1 against a 7:1 floor (244 sites) and dark
  `destructive-foreground` at 3.61:1, which fails plain AA.

- [ ] **`finding` · Presbyter is taken on every TLD worth having.**
  `.org` (registered 2020), `.church`, `.app`, `.com`. So are `kirk`, `knox`,
  `presbytery` and `polity`. Free and defensible: `presbyterial.org`. My advice
  is to keep the name, take `presbyterhq.org`, and send an acquisition inquiry
  on the exact match. The placeholder threads through the database role,
  thirteen `presby_*` SQL functions and every migration filename, so this gets
  more expensive weekly.

- [x] `decision` · **Verification deferred on the foundation pipelines**
  (DECISION-045). You are the verifier for P0, P0.5 and P1; Phases 5 and 6 are
  deferred to one combined pass. Mechanical gates still run. Debt is tracked
  under **Verification debt** in `docs/TODO.md`.

- [ ] **`finding` · One deferred item is different in kind.**
  `drizzle/0015_presby_membership_probe.sql` — the SECURITY DEFINER probe that
  fixed the tenant gate — was written by a **ux-developer** mid-UI-slice. It
  changes the isolation model and is the third occurrence of the F26 pattern.
  Deferring "did we build the right screen" is not the same risk as deferring
  "is the tenant gate correct." Wants a database-admin read.

- [x] `defect` · **The tenant gate had never worked.** `withOrgContext()`
  rejected every legitimate member: it checks membership before setting the org
  GUC, and `memberships` is FORCE RLS keyed on that GUC. Latent since the
  resolver landed because nothing called it. Fixed with a narrow SECURITY
  DEFINER probe rather than by inverting the ordering CLAUDE.md names as an
  invariant.

- [x] `defect` · **Light mode had never rendered for anyone.** `@theme` nested
  inside a `prefers-color-scheme` media query, which Tailwind v4 hoists — so the
  dark values applied unconditionally. Proven by byte-identical screenshots in
  both schemes. Fixed, with a regression spec.

- [x] `decision` · **Custom domains will carry real sessions** (S9,
  DECISION-038) — but the platform origin stays the sole identity provider and a
  church host gets a `__Host-`-prefixed, org-scoped cookie minted from a
  single-use, audience-bound handoff. A session on a third-party-controlled
  hostname carries no platform authority. Blocked on the `next-auth` beta.32
  bump, because the open advisory on beta.31 is *cookies not bound to their
  issuer* and this builds a cookie handoff.

- [ ] **`finding` · Seven periodic reviews are overdue**, `test-coverage` by 34
  days and the retrospective by 24. The retrospective would now have real
  material: four escaped defects, an agent pipeline that paid for itself
  repeatedly, and a token cost worth examining honestly.

## 2026-08-18

- [x] `defect` · **The e2e suite reported success having run 6 of 48 specs.**
  Missing `SEED_*` variables made every authenticated spec skip itself, and
  Playwright exits 0 on skips. Fixed by having the suite own its fixtures
  (DECISION-032); 84 specs now run with no configuration.

- [x] `defect` · **A date rendered as the previous day** west of the deployment,
  on the one screen whose job is to state when access ended. Fixed in SQL, then
  fixed again a layer up where `<FormattedDate>` reconstructed the same bug.

- [x] `finding` · **The `radix-ui` umbrella returns on every `shadcn add`** —
  twice now, ~1,400 lockfile lines each time. Settled by DECISION-048: not
  adopted, a `ui:add` wrapper normalises generation, and a tripwire turns
  "remember to check the lockfile" into a build failure.

- [x] `finding` · **`/developer` is blind to half the schema.** Tables and
  columns derive live, but Drizzle knows nothing about functions, triggers or
  RLS policies — which for presby is the half carrying the invariants. Filed as
  **P11** with the restructure.

- [x] `finding` · **Staff is not modeled at all**, and organizations have **no
  address** — so two congregations both named "First Presbyterian Church" are
  indistinguishable, which is the common case rather than the edge case. Filed
  as **P8** and noted in the branding Phase 1.
