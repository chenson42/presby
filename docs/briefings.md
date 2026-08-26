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

<!-- covers: decision=097 commit=078e7fb -->

*The marker above is what makes staleness measurable. `scripts/briefings-check.mjs`
compares it against `docs/decisions.md` and `git log`, and says at session start
if decisions or feat/fix commits have landed since. Move it when you write new
entries — that is the one piece of discipline this file needs, and it is checked.*

---

## 2026-08-26

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
