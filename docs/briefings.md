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

<!-- covers: decision=122 commit=be9b6ef -->

*The marker above is what makes staleness measurable. `scripts/briefings-check.mjs`
compares it against `docs/decisions.md` and `git log`, and says at session start
if decisions or feat/fix commits have landed since. Move it when you write new
entries — that is the one piece of discipline this file needs, and it is checked.*

---

## 2026-08-27

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
