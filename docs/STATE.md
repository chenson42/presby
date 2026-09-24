# Where the project stands

**Read this first in a new session.** Then `docs/schema-design.md` for rationale
and the findings log, and the newest file in `docs/work-log/`.

Updated 2026-09-24.

---

## Session handoff — 2026-09-24 (read this FIRST — supersedes the 2026-08-31 entry below)

**Checkpointed ahead of a session refresh.** No code was written this session
beyond a one-paragraph copy fix. What happened was **planning and schema design**,
and the artifacts are all committed — but the next step was deliberately *not*
started, so it is waiting.

### THE NEXT TASK (this is where to resume)

**Table-and-constraint design for D10 / D19 / D20 / D21, as a single unit.**

Read `docs/schema-design-2.md` first — **§2b, then §2a**. Review round 3
(2026-09-24, `docs/reviews/2026-09-24-schema-design-round-3.md`) found the §3–§6
table shapes stale against the decisions and colliding with three built tables —
`organizations.status`, `organization_settings.pcusa_pin`, and above all
`congregation_statistics`' **already-built** publication mechanism (DECISION-118/120),
which D20/D21 had silently duplicated. §3–§8 were rewritten in place; §2b carries
the change table (D24–D26, F34–F37) and the migration order the pipeline should
follow. Those four decisions are coupled tightly enough that designing them
sequentially would produce four shapes that do not fit:

> permanent organization identity (D10) → historical affiliation (D19) → global
> person + tenant membership (D1) → append-only roll → live statistical projection
> → frozen submitted artifact (D21) → immutable publication event (D20) → recipient
> sees only what was published

Broad schema discovery is **complete**. This is DDL, constraints, indexes and RLS
policy — not more shape-finding. D22 (person-merge provenance) and D23 (care
grants) are independent and can run separately. **Not yet started, and not yet
routed through `/new-feature`** — it has no work-log entry, so Workflow Rule 8
applies before any Edit.

### What this session decided (all committed)

The whole session was driven by one reframing: **presby will replace
fpcw-directory for FPCW and become its system of record for members and finance,
with a presbytery go-live (PSV) first.**

- **`docs/reviews/2026-09-23-fpcw-feature-match.md`** — the replacement program.
  Eleven tracks, a dependency spine, confirmed scope, and the settled design
  decisions. Read this for the *program*; read `schema-design-2.md` for the
  *model*.
- **`docs/schema-design-2.md`** — full-domain schema round 2. Decisions **D10–D26**,
  findings **F30–F37**. Three review rounds; round 2's corrections are in §2a,
  round 3's (table shapes vs. decisions vs. built schema) in §2b.
- **`docs/deployment.md`** — rewritten. The previous draft's central claim was
  false (it described a `presby-production` Neon project that does not exist).

### Standing instructions established this session

1. **The Book of Order is a design authority, not a lookup of last resort**
   (`schema-design-2.md` §0a). Before naming a status, role, register or
   lifecycle, check whether the polity names it; if we diverge, say why. This
   immediately corrected D10 — G-3.0301(c) states the lifecycle vocabulary
   verbatim.
2. **Hard cutover: "if I deferred func then it is func that isn't used."** So the
   pre-cutover track list *is* the definition of what FPCW uses, and anything
   post-cutover is new product rather than parity.
3. **Visual parity with fpcw yes, layout parity no** — layout parity would cap
   presby's IA at the app it replaces.

### Open decisions waiting on the operator

Four, all in `docs/schema-design-2.md` §10 / the program doc:
Vanco integration depth · youth vs children's ministry · whether PSV needs Google
Groups for committees · whether PSV needs a public website (it wants one
eventually, not today).

### ⚠️ Two things that are NOT schema and should not be forgotten

1. **Live production DB credentials sit in an abandoned Vercel account.** The
   `community-collective` team is no longer reliably administrable; the **legacy
   `presby-portal` project is what actually serves `www.presbyportal.org`** and
   holds valid `presby_app` credentials. Remediate in order: new Vercel project →
   set env vars → repoint GoDaddy DNS → **then** rotate the Neon password.
   Rotating first takes the site down. See `docs/deployment.md`.
2. **Go-live is deferred by decision** (Google OAuth and Resend both), so nobody
   can sign in to production at all right now — including the operator. That is
   accepted, not an outage.

### Resolved: the two critical Next.js CVEs (v0.23.3)

`next` 16.3.0 → **16.3.6** (`eslint-config-next` to match), `sharp` → 0.35.4,
`js-yaml` → 4.3.2, `browserslist` → 4.29.1. Zero critical or high advisories
remain; the leftover moderates are dev-only (`vitest` 4.1.6 and the `drizzle-kit`
→ esbuild chain) and tracked in `docs/TODO.md`. Note for the next dependency pass:
`npm update` on `vitest` trips npm 10.8.2's `edgesOut` reify bug in this tree —
update packages one at a time.

### Reviews still overdue

All seven, unchanged: test-coverage and retrospective (14d slot), plus code,
documentation, security, agent-instruction and dependencies (30d slot), last run
2026-08-19. The operator's instruction was to run them **after planning
completes** — planning is now complete, so these are next after the DDL design, or
before it if preferred. The `security` review is the one with real leverage: it
lands before any credential-storage design.

### Housekeeping done this session

`.claude/agents/` retuned for cost (opus on architect/qa/database-admin — two of
the three are read-only, so the spend is small; everything that writes volume
stays on sonnet). Agent `effort:` declared for the first time in this repo.

---

## Session handoff — 2026-08-31 (read this before anything else below)

**Checkpointed mid-launch, ahead of a restart.** First real production
push — a lot of infrastructure state changed that lives in Neon/Vercel, not
in this repo, so it would otherwise be invisible to a fresh session.

### The real production database — correcting `docs/deployment.md`

`docs/deployment.md` (still untracked, not yet committed/corrected) was
written by an earlier session believing it had no access to "the dev
database's" Neon account, so it provisioned a brand-new, separate project
(`presby-production`, id `withered-bird-71608444`) as production. **That
belief was wrong and that project is not what's live.** The actual
production database is the **`presby` Neon project's `production` branch**
(id `polished-snow-90038485`, branch `br-wild-band-ax96gv09`) — the same
project this session's Neon MCP integration has always had access to.
`docs/deployment.md` needs a correction pass (or replacement) before it's
committed; don't trust its "Already done" section about a separate DB.

### Neon: dev/prod split done, production cleaned

- Created a `development` branch (`br-super-dawn-axfi55p6`) off
  `production`, in the `presby` project. **`.env.local` now points at
  `development`, not `production`** — local work no longer touches the live
  database directly.
- `production` had been used directly as the shared dev/test target for
  weeks, accumulating cruft. Cleaned it down to exactly two orgs:
  - `fpcw` (First Presbyterian Church of Westerville) — the real sponsor
    congregation.
  - `presbytery-of-scioto-valley` (Presbytery of Scioto Valley) — newly
    created; `fpcw` is now parented under it (real ecclesiastical
    geography — FPCW/Westerville OH is genuinely in Scioto Valley
    presbytery's bounds).
  - Removed: 48 leaked `vitest` test-fixture orgs (spanning 15+ spec
    files — see the new `docs/TODO.md` bug below) and 10 stale
    `seed-dev.sql`/e2e fixture orgs (`e2e-*`, `northern-reach`,
    `quillhaven`, `fernwood`, `marrowbone`, `alder-creek`, `bramblewood`).
  - The cascade deletes required temporarily disabling four immutability
    triggers one at a time, each with explicit sign-off:
    `group_memberships_reject_derived`, `roll_actions_freeze`,
    `groups_reject_derived_edit`, `congregation_statistics_freeze` — all
    confirmed re-enabled after. One leaked row was itself invariant-broken
    (`group_memberships.source = 'derived'` with `officer_term_id = null`,
    impossible through the normal materialization path).
  - Also had to explicitly delete `ticket_messages` rows before the org
    cascade — `ticket_messages_ticket_fk` is `NO ACTION`, not `CASCADE`,
    so it doesn't clean up on its own.
- New `docs/TODO.md` entry names the root cause: the DB-backed test suite
  writes directly into the shared branch and doesn't reliably tear down.
  Needs real per-test isolation or bulletproof teardown, not more
  hand-cleaning.

### Vercel production — was silently broken, now fixed and verified

The `presby` Vercel project (`community-collective/presby`) is linked and
`presbyportal.org`/`www.presbyportal.org` are live-aliased. Two real
production bugs found and fixed:

1. **Wrong DB credentials.** `DATABASE_URL` et al. were failing
   `password authentication failed for user 'presby_app'` in production
   runtime logs — almost every DB-backed route was 500ing, including the
   public `fpcw` site (confirmed via `vercel logs --level error`). Reset
   `DATABASE_URL`/`APP_DATABASE_URL`/`PLATFORM_DATABASE_URL` to the correct
   `production`-branch connection strings and added the previously-missing
   `MIGRATE_DATABASE_URL`. Redeployed and confirmed `/`, `/signin`, and
   `/site/fpcw` all return 200 with real content.
2. **`AUTH_URL`/`NEXT_PUBLIC_APP_URL` pointed at the apex domain**
   (`presbyportal.org`) while the site's canonical host is `www` — the apex
   308-redirects everything, including `/api/auth/*`, to `www`. That would
   have bounced the OAuth dance between hosts. Fixed both to
   `https://www.presbyportal.org`, redeployed, confirmed
   `/api/auth/providers` now reflects the `www` callback URL.

### Blocked on the user, next up

1. **Google OAuth** — `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` are not set in
   production, and there is no credentials-login fallback by design
   (`docs/deployment.md`'s own note). **Nobody can sign into production
   right now, including the operator.** Waiting on a Google Cloud Console
   OAuth client (redirect URI `https://www.presbyportal.org/api/auth/callback/google`)
   before this can be wired up and smoke-tested.
2. **Resend** — `RESEND_API_KEY` not set; email queue will back up
   (password reset/verification) once real users exist. Not launch-blocking
   for a browse-only demo.
3. **Real first content ingest for `site-fpcw`** — `organization_sites`'s
   `last_ingested_commit_sha` for `fpcw` is a scratch/test placeholder
   string, not a real git SHA. Production is also missing
   `SITES_INGEST_OIDC_AUDIENCE`/`GITHUB_SITES_ORG`, which the ingest
   endpoint needs to verify a GitHub Actions OIDC token from `site-fpcw`'s
   own repo — a real first ingest would fail auth today the same way the DB
   connection did.
4. **Church data import** — no import feature exists yet
   (`docs/TODO.md`'s "Presbytery Increment 5 — imports and reports" is an
   unscoped backlog item). Needs its own Phase 1 before any real roll data
   moves, or a carefully-invariant-respecting one-off script if that's
   preferred instead.

### Also this session

- A local demo of `/site/fpcw` was run off the `development` branch via
  `npm run dev -- -p 3001` (LAN-reachable at `192.168.1.55:3001`). Server
  has since been stopped; nothing left running.

---

## Session handoff — 2026-08-24 (read this before anything else below)

Mid-session restart. Three things happened this session, in order, and the
third is **in flight, blocked on the user, not on Claude**.

### 1. Public-site manual testing — shipped, verified live

Set up a local, browsable instance of the P3 public-site feature
(`/site/<slug>`) using a synthetic "Alder Creek Presbyterian Church" /
"Fixture Hollow" fixture staged in the **local dev database only** — no
migration, no seed script, no repo change. **Left staged on purpose**; do
not revert until the user says they're done testing.

Found and fixed three real defects in `presby-site-kit` (the external,
separately-versioned component-library repo — NOT this repo), each verified
against a real running server, not just unit tests:

- **v3.1.0–v3.1.1**: the package had never had any CSS at all. Wrote a real
  stylesheet (`src/styles.css`, plain CSS, brand-aware via
  `var(--primary)` etc., same DECISION-046 cascade-override model this repo
  already uses); fixed a CSS-Grid auto-placement bug in `Callout`.
- **v3.2.0**: every content-authored internal link (FeatureGrid cards,
  Hero/Callout CTAs, EventList entries, DonateLink) rendered as a raw
  bundle-relative path instead of being resolved through the `pageUrl`
  closure `Nav` already used — a "Worship" card 404'd against presby's own
  root instead of landing on `/site/<slug>/worship`. Also added the
  package's first `@media` breakpoints (it had none).
- **v3.3.0**: the "responsive" nav from v3.2.0 only stopped overflow, it
  didn't actually collapse — rebuilt `Nav` as the package's one client
  component with a real hamburger toggle (`aria-expanded`, closes on link
  click). Hit and fixed a real RSC boundary bug along the way (a closure
  prop can't cross into a client component — resolved nav hrefs
  server-side into plain data instead).

All three pushed and tagged in `presby-site-kit`. **presby's own
`package.json`/`package-lock.json` are pinned to v3.3.0 but this bump is
UNCOMMITTED** — `git status` shows it modified, sitting on top of the one
pre-existing unpushed local commit (`a9f91d5`, "feat(sites): import
presby-site-kit's real stylesheet", never released-noted/version-bumped).

### 2. Bug fix — implemented, tested, UNCOMMITTED

User report: from the member-login flow, landing on the access-denied /
relationship-ended pages under `/o/<slug>` had no link back to the public
site (only "Back to your organizations", to `/orgs`). Confirmed real via
code read; the "no sign-out option" half of the same report was checked
live and found to be a false alarm (the avatar menu's Sign Out already
works there — not fixed, intentionally, to stay consistent with the one
sign-out mechanism used everywhere else).

Fixed: `OrgAccessDenied` / `OrgAccessEnded`
(`src/app/(org)/o/[slug]/org-states.tsx`) gained a `slug` prop and a second
"Visit the public site" button → `/site/<slug>`. Turned out to be shared by
**seven** pages, not one (`tsc` caught all of them once the prop went
required) — `page.tsx`, `admin/roles/page.tsx`, `directory/page.tsx`,
`feedback/page.tsx`, and all three `tickets/*` pages, all updated.

Full pipeline followed (bug-fix variant): work-log at
`docs/work-log/2026-08-24-org-access-back-to-site-link.md`, two new
regression tests, typecheck/tripwires/unit suite (1695 tests) all green,
verified live via a real sign-in as the seeded `admin@presby.invalid` user
hitting a real access-denied page and clicking through to the real public
site. **Not committed — waiting on the user.**

### 3. Westerville First Presbyterian site recreation — org provisioned, real photos are the only thing left

User wants to recreate `https://westervillefirstpresbyterian.org/` on
presby "as verbatim as possible." Confirmed: authorized to use the real
content (their own church); Claude does not scrape the live site — content
came from a real WordPress `Tools → Export` XML the user supplied
(`scratch/firstpresbyterianchurchofwesterville.WordPress.2026-08-24.xml`,
19,950 lines, ACF flexible-content page builder, not the classic editor).
The `~/Downloads` sandbox-access gap noted in an earlier version of this
entry resolved itself this session (readable directly; copied into
`scratch/` anyway per the plan already written here).

**presby-site-kit bumped to v3.4.0** (pushed, tagged, presby's own
`package.json`/`package-lock.json` pinned to it) — two real gaps found
building against this real site's actual content, not fixture testing:
`featureGrid`/`valuesGrid`/`ministryList` items gained an optional
`imageUrl`/`imageAlt` (previously only `hero`/`callout`/`staffList` could
carry an image at all — a real gap, the single most common non-hero layout
on this real site), and a new `gallery` block (single-image auto-playing
carousel, a play/pause toggle + pause-on-hover/focus +
`prefers-reduced-motion` support, site-kit's second client component after
`Nav`) closes the multi-image case hero/callout never covered. 109/109
site-kit tests pass; presby's own 1695 non-DB unit tests pass unaffected by
the bump.

**New private content repo pushed**: `github.com/chenson42/site-fpcw`
(confirmed `PRIVATE`), org slug will be `fpcw` (matches the church's own
staff email domain, `@fpcw.us`). 14 pages migrated by hand from the WP
export — not auto-converted — covering Home, Who We Are, Ministries,
Committees, Mobility Assistance Program, Children & Youth, Music, Groups,
Worship, Leadership, Contact, Newsletter, Upcoming Events, and a restored
Give page (the real page was an empty WP stub; the real Vanco giving URL
was only findable in the nav menu). Every block was validated by actually
rendering it through the real `renderSiteBundle()` (not just JSON-valid) —
zero silently-dropped blocks, zero images resolving to a typo'd or
invented manifestKey (all 78 cross-checked against the WXR export's real
attachment list). Full extraction tooling and the write-up proposal live
in `scratch/` (gitignored, never committed): `extract_wp.py`,
`wp_extracted.json`, `proposal.md`, `validate-bundle.mjs`.

**Deliberately dropped or degraded, all noted in `site-fpcw`'s own
README**: Gravity Forms (newsletter signup, contact form — presby's own
`<ContactForm>` already renders below every page for free); per-department
`?subject=` query-param routing (kept in hrefs, inert until presby's
contact form reads one); Upcoming Events' live Google Calendar embed
(no static event data existed to migrate — thin page links out to the
same calendar; `eventList` is available whenever specific events are
worth hand-authoring, no live sync — that would be a real separate
feature, out of scope); one image with no accompanying text.

**A real blocker turned up provisioning this: presby had no way anywhere to
create a new `organizations` row** — every existing org came from raw SQL,
and `/admin/organizations/[id]`'s Brand/Profile/Site sections only ever
managed an *existing* org. Last session's claim that provisioning "needs
zero presby code changes" was wrong on this one point. Built it properly
through the full pipeline (not a raw-SQL workaround) —
`docs/work-log/2026-08-24-admin-org-create.md`, SHIP WITH NOTES:
`/admin/organizations/new`, `src/lib/org-provisioning.ts`
(`createOrganization()`), `src/lib/reserved-slugs.ts`, F16 derived-group
seeding (Session/Board of Deacons/Active Membership, conditional on org
type) folded into the same transaction so officer-term recording works
immediately rather than needing a manual SQL follow-up. Two real bugs
found and fixed building it: `group_types`' platform-wide template rows
need the platform DB connection, not the tenant one (same RLS discipline
as everywhere else); and the originally-designed `.onConflictDoNothing()`
seed pattern wasn't actually idempotent (`group_types` has no unique
constraint) — the same bug already existed, undetected, in
`sites.test.ts`'s own setup, now tracked in `docs/TODO.md`.

**Using the shipped feature, the real organization now exists** in the dev
database: First Presbyterian Church of Westerville, slug `fpcw`, id
`4315666c-d344-4a73-99a1-dfb7944cc29e`, type `congregation`, platform
status `managed`. All three F16 groups seeded (Session, Board of Deacons,
Active Membership). Real profile data entered — address and phone
populated from the congregation's own public listing (redacted here per
CLAUDE.md's No Real Data invariant, now that this repo is public; the dev
database itself is not public and is unaffected by this redaction) — plus
one real `organization_service_times` row (Sunday, 10:15 AM). Site linked:
`organization_sites.repo` =
`chenson42/site-fpcw`, `status` = `provisioning` (never ingested yet —
correct, no CI has run against it).

**Session complete on presby's side. Three commits landed** (`fix:` the
access-denied back-link, `chore(deps):` the site-kit v3.4.0 bump,
`feat(admin):` create organization — all with clean typecheck, `git status`
clean). **All 78 real photos are downloaded and pushed to `site-fpcw`**,
at the user's explicit direction, overriding the earlier "Claude does not
scrape" default for this one case — `git log` on `site-fpcw` now shows two
commits (content, then photos), both pushed.

**Still open, in order:**
1. Set the two GitHub repo variables `site-fpcw` needs
   (`PRESBY_INGEST_URL`, `PRESBY_OIDC_AUDIENCE`) once presby's deployed
   domain and `SITES_INGEST_OIDC_AUDIENCE` are known — this is what turns
   a push to `site-fpcw`'s `main` into a real ingest, flipping
   `organization_sites.status` from `provisioning` to `live`. Both pushes
   so far (content, then photos) triggered `.github/workflows/deploy.yml`
   and both failed for exactly this reason — expected, harmless (private
   repo, no real consequence), not a sign anything is broken.
2. `sites.public_render` **is already on** (discovered mid-session, not
   something this session flipped — worth confirming with the user whether
   that was intentional, since it's a global flag: on means every
   provisioned+`live` site is publicly reachable, not just fpcw's).
3. `docs/TODO.md`'s "site-`<slug>` content-repo visibility" open question
   (Phase 1 of `2026-08-20-public-sites.md`) is resolved in practice —
   `site-fpcw` is private — the TODO line itself still needs closing out.
4. Once the repo variables are set and a real ingest succeeds,
   `/site/fpcw` will actually render — confirmed 404 as of this session
   (correctly: `organization_sites.status` was still `provisioning`, no
   `content_bundle_key` yet).

### Orientation for a fresh session

- Dev server may or may not still be running on `:3000` — check before
  starting another (`lsof -ti:3000`).
- `git status` on this repo right now: `package.json` +
  `package-lock.json` (site-kit v3.3.0 pin) and nine files under
  `src/app/(org)/o/[slug]/` modified, plus one new work-log file —
  all from items 1–2 above, all uncommitted, all verified working.
- Nothing has been pushed to presby's own `origin/main` this session.
  `origin/main` is one commit behind local `HEAD` (`a9f91d5`), which
  itself predates this session.

---

## What this is

A multitenant platform for Presbyterian congregations, presbyteries, and synods.
Church management (rolls, officers, directory, giving, events), council
operations, per-tenant websites, and a support-ticket loop worked partly by AI.
Open source, so no real data ever enters the repo.

Seeded from `chenson42/claudecode-nextjs-starter`. Prior art lives in sibling
repos and is worth reading before designing anything: `../fpcw-directory`
(church portal, 69 tables, the kiosk app under `white-binder/`),
`../westervillelions` (fund accounting, 24 ledger tables; also
`docs/reviews/2026-08-12-pii-scrub.md`, the cautionary tale for real data in a
public repo), `../psvonline-portal` (presbytery, already org-scoped),
`../synod-portal` (public learn layer, AI spend gate).

**Named: PresbyPortal** (decided 2026-08-27, DECISION-126; domain
`presbyportal.org`). `/personalize-starter` is still deliberately un-run —
`presby` continues to thread through the database role, thirteen `presby_*` SQL
functions, and every migration filename, and `package.json` still carries the
starter's name. **This is now deliberate continuity, not an unresolved
placeholder**: renaming the DB role, the `presby_*` function prefix, and every
migration filename is a large, high-blast-radius mechanical effort (a live
Postgres role rename has session/connection implications; RLS policies and
`SECURITY DEFINER` functions reference the role by name) that deserves its own
scoped pipeline, not a piecemeal edit — tracked in `docs/TODO.md`. Public-facing
copy (the marketing home page, README, external docs) uses **PresbyPortal**
starting now; internal code identifiers do not change until that pipeline
runs.

---

## The five ideas everything rests on

1. **Global person, org-scoped membership.** `people` holds the human and their
   own data; `memberships` is the link carrying roll status. Decided on polity,
   not convenience: ministers of Word and Sacrament are members of the
   *presbytery* (G-2.0502) while ruling elders are members of the
   *congregation*, so one person's roll and service routinely sit at different
   organizations.

2. **The roll is event-sourced; everything else is a projection.**
   `roll_actions` records what the session did. The directory is a view of it,
   the annual statistical report (SASR) is a projection of it, per capita
   derives from it. The report asks for *changes over a year*, not a snapshot,
   which is why a status column cannot produce it and why every clerk hand-
   tallies it in January.

3. **The court is not a group.** Session and diaconate rosters materialize from
   `officer_terms` by trigger and reject direct writes. If staff could add
   someone, the court would be invalid and every action it minuted questionable.

4. **Access flows up by publication, never down by inheritance.** A presbytery
   gets nothing from inside a member congregation except the SASR it publishes.
   Two narrow exceptions, both time-boxed and minuted: an administrative
   commission, and a session-granted delegation.

5. **Isolation is a database property.** `presby_app` is `NOBYPASSRLS`; every
   tenant table is `FORCE ROW LEVEL SECURITY`. `users.is_platform_admin` decides
   which *pages* are reachable, never whether a query is filtered.

---

## Decisions

| # | Decision | Note |
|---|---|---|
| D1 | Global `people` + org-scoped `memberships` | Reversed twice mid-build; see idea 1 |
| D2 | Shared column contract, not one polymorphic table | Polymorphic loses FKs |
| D3 | Roll approval is a status on the action row | Meetings module deferred |
| D4 | Demographics per-person, tier 3; disability per-church opt-in | |
| D5 | Other-participants roll: staff enrol, session ratifies annually | |
| D6 | PC(USA) only | Polity vocabulary in seed data where cheap |
| D7 | Platform admin = boolean + separate DB connection | Break-glass deferred to Phase 5 |
| D8 | **No custom fields.** Tags only; everything else is a support ticket | Makes the ticket loop the sole extensibility path, so it cannot be built last |
| D9 | Most congregations will **not** be tenants | A presbytery's launch-day job is holding records about non-tenants. `organizations.platform_status`. Raises a live question: should Phase 2 partly precede Phase 1? |

Sensitivity tiers: **1** directory · **2** financial · **3** pastoral,
demographic, medical. Pastoral notes sit *above* financial; the AI worker gets no
grant on them under any elevation.

---

## Built and verified

37 domain tables. Migrations `0008`–`0015` applied to Neon (Postgres 18.4).
**59 assertions pass** in `scripts/test-rls.sql`, run **as `presby_app`** —
running it as the owner proves nothing, because `neondb_owner` has
`rolbypassrls = t`.

- Org hierarchy, people/memberships/identity, rolls, officers, groups,
  authorization, privacy, SASR scaffold
- RLS on every tenant table, plus bespoke policies for the global person tables
- `presby_effective_permissions(person, org, as_of)` — four arms (direct, group,
  commission, delegation) with provenance
- Roll read path: `presby_roll_as_of`, `_counts_as_of`, `_changes`, plus a daily
  reconcile and a drift detector
- Officer registers: `presby_officer_roster(org, office, as_of)`, `_history`
- `/developer` — generated reference (index, per-table pages, per-module ERDs).
  Descriptions live in Postgres `COMMENT ON`, so they cannot drift. **But it is
  blind to functions, triggers and RLS policies** — for presby, the half carrying
  the invariants. Filed as P11.

---

## Findings worth remembering

29 logged in `docs/schema-design.md` §17–19. The ones that would have shipped:

- **F1** `force row level security` was missing. Postgres exempts the table
  owner, so with a shared role RLS is inert *and every naive test still passes*.
- **F21 → F26** A guard written to stop identity enumeration was itself defeated
  by RLS: not `SECURITY DEFINER`, so its "does this person exist elsewhere?"
  probe read zero rows for exactly the person it protected. **Caught only by
  running it.**
- **F22** The derived-group trigger destroyed officer history — a second,
  non-consecutive term rewrote the first term's end date.
- **F28** The neon-http driver cannot carry a transaction-scoped GUC at all, so
  the isolation model dictated the driver (WebSocket pool).
- **F29** The roll cache goes stale with the *passage of time*, not only on
  writes: future-dated actions take effect on a day with no corresponding write.

Pattern: reading the schema found design problems; **running it found the
security problems**. Three UI bugs were also phone-only and invisible to
`curl` + `tsc` + `next build`.

---

## Where the work actually is

The schema was the whole project on 2026-08-17. Since then the platform grew a
front door, and the shape of the remaining work is a **program of numbered
pipelines**, decomposed by the analyst and recorded in
`docs/work-log/2026-08-18-backbone-and-org-sites.md`.

**Shipped**

- **P0 — post-login router and org context.** `/launch` computes a nine-row
  destination matrix and forwards; `/orgs` is the chooser and never
  auto-forwards; `/no-organization`; `/o/<slug>` under a new `(org)` group with
  an immutable, DNS-label-constrained slug. Named access-denied that is
  byte-identical across platform statuses. Header split into an avatar (identity)
  and an organization switcher (context), on Google's model.
- **The design system**, finally taken delivery of — `cn()`, `components.json`,
  five primitives, expanded tokens. Light mode fixed: it had **never** rendered
  for anyone.
- **P0.5 slice 0 + a1** — the brand token contract (`src/lib/brand/contract.ts`,
  zero imports, `LEGAL_PAIRS` carrying their own contrast floors) and the tooling
  (`ui:add`, `check:deps-drift`, `check:brand-scope`).

**In flight — P0.5, the design and brand foundation.** Phases 1–3 complete,
Phase 4 two commits in. Next: `0.2` (ui-standards visual rewrite) and `a2` (the
visual-parity harness, which must baseline before any further visual change).
Then the mechanics, then the 52-violation sweep, then C2 is turned on.
**Blocks P1 and P3.**

**Queued**, in dependency order: P1 tenant permissions + org portal shell · P2
backbone and onboarding · P3 site model + renderer · P4 the church's site editor
· P5 custom domains · P6 the daily cron agent · P7 data-bound blocks · P8 staff
and employment · P9 tenant administration · P10 satellite sessions on custom
domains · P11 the `/developer` restructure · P12 the component library and its
generated dictionary. Every one needs its own Phase 1; the architect was
explicit that "the architect already ruled" is not a substitute.

## What a new session must know

- **Fifty numbered decisions** now live in `docs/decisions.md`, newest first.
  034–045 are the backbone program; 046–050 are the brand foundation.
- **Verification is deferred, not skipped** (DECISION-045). The operator is the
  verifier for the foundation pipelines; Phases 5 and 6 are held for one combined
  pass. The outstanding items are listed under **Verification debt** at the top of
  `docs/TODO.md`. One of them — `drizzle/0015`, a SECURITY DEFINER probe written
  by a ux-developer mid-UI-slice — is different in kind and wants a
  database-admin's eye.
- **`docs/briefings.md` is the operator's read/unread digest.** Its staleness is
  measured, not trusted: `scripts/briefings-check.mjs` compares a `covers:` marker
  against decision numbers and `git log`, and says at session start how far behind
  it is. Move the marker when you add entries.
- **`docs/testing.md`** has the fixture accounts and the hand-testing walkthrough.
  Password for every fixture is in that file; addresses are `@presby.invalid`.
- **The status line** (`scripts/statusline.mjs`) shows running agents with
  elapsed time. Liveness is an mtime heuristic with a 90-second window — an agent
  thinking quietly looks idle.
- **Do not trust a long-running dev server for a visual check.** One was observed
  serving a stale CSS chunk and never recompiling, even after a touch. Use a
  production build on a scratch port.

## Four defects that had shipped and nothing noticed

Worth carrying because they are all the same shape — code nothing had exercised:

- **`withOrgContext()` rejected every member.** It checks membership before
  setting the org GUC, and `memberships` is FORCE RLS keyed on that GUC. F26's
  third occurrence. Latent because nothing called it until a page did.
- **Light mode had never rendered.** `@theme` nested in a media query, which
  Tailwind v4 hoists.
- **The e2e suite reported success having run 6 of 48 specs.**
- **The focus ring was invisible at 1.00:1** — `--ring` and `--primary` are the
  same colour, and the ring is drawn flush against the fill. The fix is geometric
  (a 2px offset the contract carries as data), not a different colour.

## Running it

```bash
npm run dev                  # localhost:3000
# phone on the same wifi needs DEV_ALLOWED_ORIGINS set to the LAN IP,
# or Next blocks /_next/* and the page renders but never hydrates
psql "$MIGRATE_DATABASE_URL" -f scripts/seed-dev.sql     # synthetic fixture
psql "$APP_DATABASE_URL"     -f scripts/test-rls.sql     # MUST be presby_app
npm run docs:erd             # refresh the diagrams in schema-design.md
```

Local sign-in: `dev@example.invalid` / `presby-dev-password`. Delete before any
deploy.

Four connection strings in `.env.local`, and the distinction matters:
`DATABASE_URL` (presby_app, RLS enforced — the app),
`PLATFORM_DATABASE_URL` (bypasses RLS — platform pages only),
`MIGRATE_DATABASE_URL` (owner, direct endpoint — DDL),
`APP_DATABASE_URL` (presby_app with login — tests).
