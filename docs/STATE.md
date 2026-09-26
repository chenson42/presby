# Where the project stands

**Read this first.** Then `docs/schema-design.md` for rationale and the
findings log, and the newest file in `docs/work-log/`.

Updated 2026-09-25.

---

## RESUME HERE — updated 2026-09-26 afternoon (waves 2 and 3 complete; CI green; nothing in flight)

**Pushed to `origin/main`, in order, since the 2026-09-24 stop:** `ac61c9d` fix(audit) ·
`5421fb4` fix(auth) the callback sanitizer (v0.24.2, security review §A) ·
`debc35c` feat(brand) Track B narrowed — heading/body font tokens load-bearing
(v0.25.0, DECISION-142/143/144) · `e5195c3` fix(e2e) greeting-band hook, post-login
matrix pinned, admin fixture guard · `6d7b7c8` fix(ui) org-switcher 44px floor
(v0.25.1) · **round-two hardening `fix(schema):` (v0.25.2)** — F54–F58 /
DECISION-141 as a correction in place to `drizzle/0043`–`0047`, ten Phase 3
rulings in all, QA re-verified on the live catalog (`test-rls.sql` 412 / exit 0 as
`presby_app`; DB-backed vitest 147/147 serial). **This is the last correction on
`0043`–`0047`.** One accepted residual, tracked: F59 (`congregation_statistics`'s
INSERT half — closing instrument is a raw column-list insert in
`src/lib/presbytery.ts`, `docs/TODO.md` Next Up).

**Production has NOT been migrated** past what it had before `0043` (deploys do not
migrate; `npm run db:migrate` / `psql "$MIGRATE_DATABASE_URL" -f …` against
production is a deliberate, separate operator step). `development` carries
`0043`–`0047` at the shipped state.

**Reviews run 2026-09-25:** security (§A app half fixed in v0.24.2; §B schema
punch-list in TODO), code, documentation, agent-instruction, dependencies. The
release-slot pair (`test-coverage`, `retrospective`) was in progress when this
block was written — check `docs/reviews/log.md` for whether both entries landed.

**In flight when this block was written** (each has its own work-log; the
work-log is the source of truth): `docs/work-log/2026-09-25-platform-radius.md`
(Polish — `--radius` 0.5rem → 0.625rem, one token + comment rewrite, 67 re-captured
before/after pairs + 13 sub-threshold; Phase 5 re-verification after a text-only
FAIL). Uncommitted in the tree for it: `src/app/globals.css` and the work-log.

**Wave 2 (2026-09-25 afternoon), Rule 16 for real this time — one worktree + one Neon branch per pipeline:**
`pipeline/security-schema-b` **merged** as PR #13 (`42ec0e9`, v0.25.5, `drizzle/0048`,
DECISION-146; `development` re-migrated 0043→0048 and `test-rls.sql` 476/exit 0 there;
every DEFINER function in `public` pins `pg_temp`, catalog-wide). `pipeline/submission-grants`
(`drizzle/0049`, DECISION-147, F80 — the platform's first unauthenticated write path,
SHIP WITH NOTES) **merged** as PR #14, v0.26.0; `development` re-migrated through 0049
and `test-rls.sql` re-run there (520). Flag `statistics.submission_grants` seeded OFF —
what's-new owed at first enablement. The lifecycle pipeline's **third** external round (F60–F64)
shipped as v0.25.4 (`afc2afb`) — F59 closed, pg_temp pinned, DECISION-148.
**CI on `main` is green again as of PR #15 (`338b1bb`, v0.26.1, 2026-09-26)** — red since
2026-08-26 on eight lint errors behind a Lint-first job that skipped Build/Tripwires/Audit/
Tests; fixed on their merits (DECISION-149: lint in `/pre-push` Step 3a and LAST in `ci.yml`),
plus a second regression it had hidden: `isFlagEnabled()` never failed closed and the naive
fix would have dropped 2FA enforcement on a DB blip (DECISION-026 corrected; the sign-in
flags read inline). `main` still has **no branch protection** (operator decision, TODO).
Wave 3's other pipeline, `pipeline/ci-db-tests`, **merged** as PR #16 (`f8c5dc0`, v0.26.2,
`drizzle/0050_presby_schema_parity.sql`, DECISION-150, F81–F83; `development` re-migrated
through 0050 with `install-test-helpers.sql` and `test-rls.sql` 520 there): Batch A found and fixed that the committed migrations did not reproduce
the live schema (four columns; a from-empty database had a broken permission resolver) and
that the isolation suite's `assert_eq()` helper existed in no committed file — a database
built from empty now migrates, seeds and passes 520 assertions for the first time; Batch B
shipped the `db.yml` job + the repo's first composite action + the `e2e.yml` repair; both
jobs **skip with a `::notice::` until the operator adds `NEON_API_KEY`/`NEON_PROJECT_ID`**
(`docs/deployment.md` has the two-step instruction). No worktrees or pipeline branches are
open; three Neon branches (`pipeline-security-schema-b`, `pipeline-submission-grants`,
`pipeline-ci-db-tests`) await the operator's OK to delete.

**Next, in order (all shipped through wave 3; the remaining candidates):** the operator's
three decisions (Neon secrets → CI jobs run; branch protection; delete the three Neon
branches); then wave 4 under Rule 16 — code-review C-1/C-2/C-3, the test-coverage punch
items 7 and 10–17, increment 7 name history + D13 staging, D22/D23 design phases,
Track A/C/R, the `presby_withdraw_publication()` pipeline, the public render path's
three uncaught reads, the `group_types` reclassification — each in its own worktree +
Neon branch, integrated one PR at a time. The shared `development` branch is a proven hazard for concurrent DB-backed
suites (QA measured `organizations` moving 17 → 15 mid-run); use per-pipeline
branches.

**Operator actions outstanding:** Vercel Node 22 before 2026-10-01;
`NEON_API_KEY`/`NEON_PROJECT_ID` repository secrets (CI e2e has never run); FPCW
brand configuration (B3) and the `ui.branded_signin` parity sign-off; the real-PII
`organization_profiles` row on `development`; `org_portal.home_v2` on
`development` (two e2e reds until reset or e2e moves to an isolated branch).

---

## Where the project stands

The durable operational facts a fresh session needs, so they don't have to be
reconstructed from session-history prose (below). Detail lives in the linked
document; this is the summary.

- **Neon.** Production is the `presby` project's `production` branch
  (`polished-snow-90038485` / `br-wild-band-ax96gv09`). `development`
  (`br-super-dawn-axfi55p6`) is forked from it and is what `.env.local` points
  at for local work. **Production has not been migrated** past migration
  `0047` — `development` has. A Vercel deploy does not run migrations;
  `npm run db:migrate` (or `psql "$MIGRATE_DATABASE_URL" -f …` when the
  runner's ledger is incomplete, as it is on `development`) is a separate,
  deliberate step. Full detail: `docs/deployment.md`.
- **Vercel — an unresolved account/credentials risk.** The operator has lost
  reliable administrative access to the Vercel team that has held every
  presby deployment to date; the **legacy `presby-portal` project is what
  actually serves `www.presbyportal.org`**, and it holds valid `presby_app`
  production credentials inside that impaired-access team. Remediation order
  matters and is not yet executed: new Vercel project in a controlled team →
  set env vars there → repoint DNS → **only then** rotate the Neon
  `presby_app` password. Rotating first takes the live site down before the
  replacement is ready. Full detail, including the Node-22-by-2026-10-01
  deadline: `docs/deployment.md`.
- **Real PII sits in the shared `development` branch.** A real congregation's
  street address and phone number (`organization_profiles`, `fpcw`) are in
  the database, not the repository — `check:secrets` is silent and the No
  Real Data invariant's letter (scoped to the repo) holds, but it is real PII
  several agents and sessions can read. Needs an explicit operator call:
  scrub it, or record it as a deliberate, bounded exception. Tracked in
  `docs/TODO.md`.

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

63 domain tables (`docs/product/functionality-map.md` carries the current
count and per-area detail; the schema grows with nearly every pipeline).
`scripts/test-rls.sql` is the isolation suite and **must run as `presby_app`** —
running it as the owner proves nothing, because `neondb_owner` has
`rolbypassrls = t`.

- Org hierarchy, people/memberships/identity, rolls, officers, groups,
  authorization, privacy, statistical returns + publication
- RLS on every tenant table, plus bespoke policies for the global person tables
  and the genuine two-org reads (`administrative_commissions`, `org_delegations`,
  `transfer_certificates`)
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

Logged in `docs/schema-design.md` §17–19 and `docs/schema-design-2.md` §2a–§2g.
The ones that would have shipped:

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
- **F44** `getPlatformDb()` connects as `neondb_owner`; a grant edit alone never
  binds it, only a trigger does. Generalized across two external post-merge
  review rounds (DECISION-140, DECISION-141) from mutation surfaces to creation
  surfaces.

Pattern: reading the schema found design problems; **running it found the
security problems**. Three UI bugs were also phone-only and invisible to
`curl` + `tsc` + `next build`.

---

## Where the work actually is

The schema was the whole project on 2026-08-17. Since then the platform grew a
front door, and the shape of the remaining work is a **program of numbered
pipelines**, decomposed by the analyst and recorded in
`docs/work-log/2026-08-18-backbone-and-org-sites.md`. See the RESUME HERE block
at the top of this file for exactly where things stand as of the latest session.

**Shipped**

- **P0 — post-login router and org context.** `/launch` computes the
  destination matrix and forwards; `/home` is the chooser and never
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
- **The D10/D19/D20/D21 schema unit** (organization lifecycle, affiliation
  history, statistical returns, publication) — see `docs/product/functionality-map.md`
  for current detail and the RESUME HERE block above for what's still mid-flight
  (round-two hardening).

**In flight / queued** — see the RESUME HERE block at the top of this file and
`docs/TODO.md` for the current, authoritative list; this section is not
duplicated here because it goes stale faster than either of those.

## What a new session must know

- **The decisions log** lives in `docs/decisions.md`, newest first, numbered.
- **Verification is deferred, not skipped** (DECISION-045) for the earliest
  foundation pipelines specifically — see `docs/TODO.md`'s **Verification
  debt** section for what remains.
- **`docs/testing.md`** has the fixture accounts and the hand-testing walkthrough,
  plus how to run the DB-backed automated suites.
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

---

## Session history (archive)

Historical session handoffs, superseded by the sections above and by
`docs/deployment.md`. Kept for provenance only — do not treat anything below
as current operational fact without checking it against the live sections
above first. Newest first, mirroring `docs/reviews/log.md`'s own convention
for carried-over history.

### 2026-09-24 — the DDL pipeline shipped, planning for round two

The "NEXT TASK" below is **done**: `docs/work-log/2026-09-24-lifecycle-affiliation-returns.md`
closed SHIP WITH NOTES after a full six-phase run (three Phase 3 loop-backs, one
Phase 5 loop-back — every one caught a real defect; read the work-log's Phase 2
rulings and the QA sections before touching any of these tables). Shipped:
`drizzle/0043`–`0047`, domain modules `lifecycle.ts` / `returns.ts` /
`publication.ts` (`reporting.ts` deleted), `createOrganization()` with a parent,
`test-rls.sql` 277 → 363 assertions, v0.24.0. Applied and proven on the
`development` Neon branch; **not yet applied to `production`** — that happens
with the deploy (`npm run db:migrate` there; on `development` the runner's ledger
is incomplete, so migrations were applied with `psql "$MIGRATE_DATABASE_URL"`).

**Next pipelines, in order of leverage (as understood at the time):** (1) the seven overdue periodic reviews —
`security` first, since it now has F38/F40/F46 and the `presby_platform` blanket
grant (`drizzle/0009:44`) waiting for it; (2) increment 6, submission grants, its
own work-log and security pass (Phase 2 Ruling 11 pre-placed the route group);
(3) increment 7, name history + D13 import staging; (4) the lifecycle-UI pipeline
(`presby_record_lifecycle_event()` / `presby_organize_congregation()`, the admin
form's missing parent control); (5) the publish UI (Increment 4a). D22 and D23
remain independent. The `docs/TODO.md` FPCW-program block has every follow-up.

**Checkpointed ahead of a session refresh.** No code was written this session
beyond a one-paragraph copy fix. What happened was **planning and schema design**,
and the artifacts are all committed — but the next step was deliberately *not*
started, so it is waiting.

#### THE NEXT TASK (as framed at the time — see RESUME HERE above for current status)

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
> reads the published artifact, not the source's live state

Broad schema discovery is **complete**. This is DDL, constraints, indexes and RLS
policy — not more shape-finding. D22 (person-merge provenance) and D23 (care
grants) are independent and can run separately.

#### What this session decided (all committed)

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

#### Standing instructions established this session

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

#### Open decisions waiting on the operator (as of this session)

Four, all in `docs/schema-design-2.md` §10 / the program doc:
Vanco integration depth · youth vs children's ministry · whether PSV needs Google
Groups for committees · whether PSV needs a public website (it wants one
eventually, not today).

#### Resolved: the two critical Next.js CVEs (v0.23.3)

`next` 16.3.0 → **16.3.6** (`eslint-config-next` to match), `sharp` → 0.35.4,
`js-yaml` → 4.3.2, `browserslist` → 4.29.1. Zero critical or high advisories
remain; the leftover moderates are dev-only (`vitest` 4.1.6 and the `drizzle-kit`
→ esbuild chain) and tracked in `docs/TODO.md`. Note for the next dependency pass:
`npm update` on `vitest` trips npm 10.8.2's `edgesOut` reify bug in this tree —
update packages one at a time.

#### Housekeeping done this session

`.claude/agents/` retuned for cost (opus on architect/qa/database-admin — two of
the three are read-only, so the spend is small; everything that writes volume
stays on sonnet). Agent `effort:` declared for the first time in this repo.

---

### 2026-08-31 — production push, Vercel/Neon split

**Checkpointed mid-launch, ahead of a restart.** First real production
push — a lot of infrastructure state changed that lives in Neon/Vercel, not
in this repo, so it would otherwise be invisible to a fresh session.

> **Note (2026-09-25):** the "Wrong DB credentials" fix described below —
> resetting `DATABASE_URL`/`APP_DATABASE_URL`/`PLATFORM_DATABASE_URL` on the
> `presby` Vercel project — did not stick or did not apply to what's actually
> serving traffic. `docs/deployment.md`'s 2026-09-24 rewrite found the `presby`
> Vercel project has **zero** environment variables, and that the **legacy
> `presby-portal` project** is what actually serves `www.presbyportal.org`.
> Treat `docs/deployment.md` as current; this block is kept for provenance only.

#### The real production database — correcting `docs/deployment.md`

`docs/deployment.md` (still untracked, not yet committed/corrected) was
written by an earlier session believing it had no access to "the dev
database's" Neon account, so it provisioned a brand-new, separate project
(`presby-production`, id `withered-bird-71608444`) as production. **That
belief was wrong and that project is not what's live.** The actual
production database is the **`presby` Neon project's `production` branch**
(id `polished-snow-90038485`, branch `br-wild-band-ax96gv09`) — the same
project this session's Neon MCP integration has always had access to.

#### Neon: dev/prod split done, production cleaned

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

#### Vercel production — believed fixed at the time (see the 2026-09-25 note above)

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

#### Blocked on the user, next up (as of this session)

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

#### Also this session

- A local demo of `/site/fpcw` was run off the `development` branch via
  `npm run dev -- -p 3001` (LAN-reachable at `192.168.1.55:3001`). Server
  has since been stopped; nothing left running.

---

### 2026-08-24 — public-site testing, org-access bug fix, Westerville site recreation

Mid-session restart. Three things happened this session, in order, and the
third is **in flight, blocked on the user, not on Claude**.

#### 1. Public-site manual testing — shipped, verified live

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

All three pushed and tagged in `presby-site-kit`. presby's own
`package.json`/`package-lock.json` were pinned to v3.3.0 at the time, later
bumped to v3.4.0 (below) and further since.

#### 2. Bug fix — org-access-denied pages had no link back to the public site

User report: from the member-login flow, landing on the access-denied /
relationship-ended pages under `/o/<slug>` had no link back to the public
site (only "Back to your organizations"). Confirmed real via code read; the
"no sign-out option" half of the same report was checked live and found to
be a false alarm.

Fixed: `OrgAccessDenied` / `OrgAccessEnded`
(`src/app/(org)/o/[slug]/org-states.tsx`) gained a `slug` prop and a second
"Visit the public site" button → `/site/<slug>`. Shared by seven pages, all
updated. Full pipeline followed (bug-fix variant), two new regression tests,
verified live via a real sign-in. Landed in a later commit.

#### 3. Westerville First Presbyterian site recreation — org provisioned, real photos migrated

User wanted to recreate `https://westervillefirstpresbyterian.org/` on
presby "as verbatim as possible." Confirmed: authorized to use the real
content (their own church); Claude does not scrape the live site — content
came from a real WordPress `Tools → Export` XML the user supplied.

**presby-site-kit bumped to v3.4.0** — two real gaps found building against
this real site's actual content: `featureGrid`/`valuesGrid`/`ministryList`
items gained an optional `imageUrl`/`imageAlt`, and a new `gallery` block
(single-image auto-playing carousel with `prefers-reduced-motion` support,
site-kit's second client component after `Nav`).

**New private content repo pushed**: `github.com/chenson42/site-fpcw`
(confirmed `PRIVATE`), org slug `fpcw`. 14 pages migrated by hand from the WP
export, every block validated by actually rendering it through
`renderSiteBundle()`.

**Deliberately dropped or degraded, noted in `site-fpcw`'s own README**:
Gravity Forms (presby's own `<ContactForm>` covers this); per-department
`?subject=` query-param routing (inert until presby's contact form reads
one); Upcoming Events' live Google Calendar embed (thin page links out
instead); one image with no accompanying text.

**A real blocker turned up provisioning this: presby had no way anywhere to
create a new `organizations` row.** Built it properly through the full
pipeline — `docs/work-log/2026-08-24-admin-org-create.md`:
`/admin/organizations/new`, `src/lib/org-provisioning.ts`
(`createOrganization()`), `src/lib/reserved-slugs.ts`, F16 derived-group
seeding folded into the same transaction. Two real bugs found and fixed
building it, both tracked forward at the time.

**Using the shipped feature, the real organization now exists** in the dev
database at the time: First Presbyterian Church of Westerville, slug `fpcw`,
type `congregation`, platform status `managed`, with real profile data
entered (redacted from this file per the No Real Data invariant, now that
this repo is public — the dev database itself is not public and is
unaffected by this redaction).

**Still open at the end of this session** (see the sessions above for later
resolution status): the two GitHub repo variables `site-fpcw` needs for a
real ingest; confirming `sites.public_render` being on was intentional; the
`site-<slug>` content-repo visibility TODO line; the first real ingest
turning `/site/fpcw` from 404 to live.
