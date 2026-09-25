# Documentation Review — 2026-09-25

**Owner:** tech-lead. Monthly health-check slot, `documentation` type. First real
run since the 2026-08-19 baseline reset (`2026-08-19-documentation` in
`docs/reviews/log.md` was a clock-start, not a completed review — no
`2026-08-19-documentation.md` exists) and since the 2026-07-11 starter-era run
carried over at scaffold time.

**Scope:** `docs/STATE.md`, `CLAUDE.md`, `docs/architecture.md`,
`docs/schema-design.md`, `docs/schema-design-2.md`, `docs/testing.md`,
`docs/product/functionality-map.md`, `docs/deployment.md`, `README.md`,
`docs/work-log/_template.md`. Read-only except this file. **Everything under
`drizzle/`, `scripts/`, `src/lib/db/domain/` is explicitly in flux (round-two
hardening mid-implementation) and out of scope** — findings that would depend
on that landing are deferred to the next cycle.

**Method:** Full read of every file in scope; cross-referenced against
`docs/reviews/2026-09-25-code.md` (N-1, M-5, M-6), `docs/reviews/2026-09-25-security.md`
(B-L5, B-I3, F44), `docs/decisions.md` (DECISION-094, 126, 135–144),
`docs/work-log/2026-09-24-lifecycle-affiliation-returns.md`, and
`docs/work-log/2026-09-25-brand-visual-parity.md` (Phase 2 Ruling 5). Ran `grep`
against the live tree for every claim below rather than trusting the prior
review's characterization of a file's contents.

**Headline:** the *design* documents (`schema-design-2.md`, `database-admin.md`
via the agent-instruction review) absorbed this month's real complexity well —
the neondb_owner/grant-vs-trigger fact and the creation-guarded-as-mutation rule
are both already stated where an agent will find them. The *public-facing and
orientation* documents did not keep pace: `README.md` describes a different,
much earlier project, `docs/deployment.md` is missing the single most
time-sensitive fact in the repository, and three separate documents (`CLAUDE.md`,
`docs/schema-design.md`, `docs/decisions.md`) each carry one clearly-dated
passage nobody went back to close out. None of this is subtle corruption — every
finding below is a `grep` away from being caught, which is itself worth noting
for the retrospective.

---

## Critical

### C-1: `README.md` describes a different, older project — wrong name, wrong status, wrong Node version, wrong counts

**File:** `README.md` (whole file, 155 lines)

This is the single most consequential finding in this review because it is the
*only* file in scope an outside reader (this is a public repo) sees before
anything else, and it fails on nearly every axis the review brief names:

- **Naming (DECISION-126).** No mention of "PresbyPortal" anywhere in the file.
  Line 5: *"Not yet named — `presby` is a placeholder..."* — the naming decision
  is five weeks old and public-facing surfaces were explicitly told to use it
  "starting immediately" (DECISION-126). README is the most public-facing
  surface that exists.
- **Status claims are false.** Line 3: *"Status: pre-release... There is no
  church-facing UI yet. Not deployed anywhere."* The project has a deployed
  production database (`docs/deployment.md`), a live Vercel deployment serving
  `presbyportal.org`, and (per `docs/product/functionality-map.md`) a large
  built org portal, public-site renderer, presbytery program, and admin surface.
- **Node version directly contradicts the repo's own `engines` field.** Line 61:
  *"Node 20.9+."* `package.json:11-13` declares `"engines": {"node":
  ">=22.0.0"}` and `.nvmrc` pins 22 (commit `11ab488`, 2026-09-24). A new
  contributor following the README's own instructions installs a Node version
  the project has explicitly and recently declared unsupported.
- **Every count is stale.** "37 tenant tables" (line 47, actual: 63 per
  `docs/product/functionality-map.md:15`); "36 passing assertions" (lines 39,
  48; actual: 384 per the security review's live-catalog read); "**Not
  built:** any church-facing UI" (line 55) is the single largest factual gap in
  the file.
- **Quick start is for a schema-only snapshot.** Line 67's migration comment
  ("apply drizzle/0000–0012") and the whole "What's built" table describe the
  2026-08-17 state of the project, before P0 through P12 shipped.

**Fix.** This needs a rewrite, not a patch — the gap between the file and the
project is now measured in months of shipped work, not a few stale lines.
Minimum bar for the next pass: open with PresbyPortal naming and a one-line
"live, pre-launch" status (matching `docs/deployment.md`'s actual posture —
production exists, sign-in is deferred by decision); replace the table counts
by pointing at `docs/product/functionality-map.md` rather than hand-copying
numbers that will drift again; fix the Node version; and replace "What's
built"/"Not built" with the same digest `docs/architecture.md` §2 already
maintains in prose form, rather than maintaining a third independent list.
**Owner: tech-lead**, next docs pass or its own Polish-class work-log entry
(README-only, no schema/API surface — Polish per the Classification table).

### C-2: `docs/deployment.md` — the one document whose job is deploy readiness — never mentions the Node 22 Vercel deadline six days out

**File:** `docs/deployment.md` (0 matches for "node", confirmed by direct grep)

`docs/TODO.md:71` carries, verbatim: *"⏰ Before 2026-10-01: set the Vercel
project's Node.js version to 22.x in Project Settings."* Today is 2026-09-25 —
**this deadline is six days away.** `docs/deployment.md` was rewritten in full
2026-09-24 (its own dateline, and the file is otherwise unusually current and
well-organized — see the Observations section) but its Vercel section
(`docs/deployment.md:48-91`) and its environment-variable table
(`:94-114`) say nothing about the Node version setting, even though it is a
dashboard-only, operator-only `[YOU]` action of exactly the kind this file
exists to enumerate — it already uses that `[YOU]`/`[CLAUDE]` convention for
every other operator-gated step.

**Fix.** Add one `[YOU]` line to the Vercel section, ahead of the remediation
steps already there: *"**[YOU] Before 2026-10-01:** set this project's Node.js
version to 22.x in Vercel Project Settings — Vercel disables Node 20 there on
that date, and this repo has been on Node 22 (`.nvmrc`, `engines.node`) since
`11ab488`."* Cross-reference `docs/TODO.md`'s existing line rather than
duplicating its wording, so the two don't drift independently.

**Related, smaller gap in the same file:** `docs/deployment.md` never states
that a Vercel deploy does not run database migrations — `docs/STATE.md`'s
2026-09-24 session block says so (*"Production has NOT been migrated (deploys
do not migrate; `npm run db:migrate` against production is a deliberate,
separate step)"*), but that is the **only** place this operational fact is
written down, and it sits inside a dated session-handoff paragraph slated for
archival (see STATE.md finding below). Promote it to
`docs/deployment.md`'s environment-variables section or a new one-line
"Migrations" note, so the fact survives STATE.md's next consolidation.

### C-3: The DB-backed test invocation (`--no-file-parallelism`, `.env.local` loading, `psql "$APP_DATABASE_URL" -f scripts/test-rls.sql`) is not documented in any checked-in doc — confirmed independently of the code review

**Files:** `CLAUDE.md` Common Commands (`npm test` listed with no flags),
`docs/testing.md` (mentions `scripts/test-rls.sql` exactly once, in a fixture
biography, never as something to run)

`docs/reviews/2026-09-25-code.md` C-1 already names this as a CI gap; this
review independently confirms it is *also* a documentation gap, which is a
distinct problem with a distinct fix. Grepping every file in `docs/` for
`no-file-parallelism` returns only work-log prose (`docs/TODO.md`,
three work-logs, and the code review itself) — never a how-to. `docs/testing.md`
is the file whose entire purpose is "how to sign in and exercise what exists"
and its own header explicitly defers automated-suite instructions to
`CLAUDE.md → Common Commands`; `CLAUDE.md`'s `npm run test` entry is `Vitest
unit tests (run once)` with no mention that a DB-backed subset exists, needs
`.env.local`, or needs `--no-file-parallelism` to avoid the teardown races the
code review's own C-1 quotes ("4–7 suite-level teardown failures per run").
Nowhere does a checked-in document tell a new session how to run
`scripts/test-rls.sql` at all — not the flag it needs (`-v ON_ERROR_STOP=1`),
not which connection string (`$APP_DATABASE_URL`, not `$MIGRATE_DATABASE_URL`),
not that running it as the owner "proves nothing" (a sentence that exists in
`README.md` and `docs/architecture.md` but not in `docs/testing.md`, the file
someone actually testing by hand would open).

**Fix.** Add a short "Running the DB-backed suites" section to
`docs/testing.md` (it is the natural home — it already owns "how to exercise
what exists" and already documents `.env.local`'s `RATE_LIMIT_DISABLED`
caveat, which is the right precedent to extend):

```
npx dotenv -e .env.local -- npx vitest run --no-file-parallelism   # the ~30 DB-gated suites
psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql   # MUST be presby_app, not the owner
```

Cross-link from `CLAUDE.md`'s `npm run test` row rather than inlining the whole
explanation there, matching how that row already defers detail elsewhere.

### C-4: `docs/schema-design.md` §13 (Section J, SASR projection) has no superseded banner, unlike §14 (Section K) — a required-reading document for schema work still presents a dropped table (`sasr_reports`) as current design

**File:** `docs/schema-design.md:1199-1268`

CLAUDE.md's own read-order instruction (`CLAUDE.md:2-3`) is: *"`docs/schema-design.md`
— schema rationale... Required before proposing or designing schema."* Section
K, two pages later in the same file, carries an explicit, prominent
"SUPERSEDED 2026-08-20" banner (`:1270-1283`) pointing at the real design and
telling the reader not to build against it. Section J gets no such treatment,
despite being superseded more recently and more completely:
`docs/schema-design-2.md:1313` titles its own Section O *"revises Section J"*,
and the `sasr_reports` table Section J specifies (`:1204-1217`) does not exist
in the shipped schema — it was replaced by `statistical_returns` /
`publications` / `congregation_statistics` (DECISION-137: *"`sasr_reports` is
dropped outright"*). An agent reading `schema-design.md` top-to-bottom, exactly
as instructed, hits a fully-specified `create table sasr_reports (...)` block
with no warning it was abandoned five weeks ago, one section after seeing the
convention (a superseded banner) that would have caught it.

**Fix.** Add the same banner shape Section K already uses, at
`docs/schema-design.md:1199`, pointing at `docs/schema-design-2.md` §5 (Section
O) and DECISION-137:

```
> **Superseded 2026-09-24** (`docs/schema-design-2.md` §5, "Section O — The
> SASR: projection, returns, publication"). `sasr_reports` as specified below
> was dropped outright (DECISION-137); the live design is a form-versioned
> `statistical_returns` row, an immutable `publications` event, and a
> `congregation_statistics` projection. Kept below for historical context only.
```

---

## Notable

### N-1: `CLAUDE.md` → Post-Login Landing is stale by a whole retired route, in four places (confirmed, code review N-1's remedy specified in full)

**File:** `CLAUDE.md:555-625`

Independently re-confirmed against `docs/product/functionality-map.md`'s
current account (`/orgs` is a permanent 308 to `/home`, merged 2026-08-27,
DECISION-124/125) and `docs/decisions.md`. Four exact spots:

1. `CLAUDE.md:563` — matrix row `| everything else | | | /orgs |` should read
   `/home`.
2. `CLAUDE.md:578-582` — *"`/orgs` is the chooser and never auto-forwards..."*
   should read `/home`, and the "otherwise a platform admin with no
   congregations could never reach the Developer card" reasoning still applies
   verbatim to `/home`.
3. `CLAUDE.md:587-589` — *"`/home` survives as the platform-shell page...It is
   no longer a landing target."* This is now backwards: `/home` **is** the
   landing target (the chooser row's destination). The surrounding sentence
   about `(member)` rendering "no tenant data" also needs the code review's
   correction: `/home` now lists the user's organizations (name + type only,
   DECISION-039), so the claim survives narrowly and should say so explicitly
   rather than silently.
4. `CLAUDE.md:623` — *"Segments that always render (`/orgs`, `/no-organization`)
   keep theirs"* should read `/home`.

**Fix (proposed rewrite of the affected lines):**

```
| everything else | | | `/home` |
...
**`/home` is the chooser and never auto-forwards**, even for a one-organization
user — otherwise a platform admin with no congregations could never reach the
Developer card. Deep links to `/o/<slug>` must work without it, so the chooser
is a convenience and every org route authorizes itself. Cards carry **no
membership language** (DECISION-039): organization name and type only.
...
**`/home` is the landing target** (merged with the former `/orgs` chooser,
DECISION-124/125) and also carries what's-new and the feedback prompt.
`(member)` stays auth-only with no 2FA gate; it lists the user's own
organizations (name and type only, DECISION-039) but renders no other tenant
data.
...
Segments that always render (`/home`, `/no-organization`) keep theirs.
```

This section cites itself as `architect.md`'s authority (per the code review),
so the drift was propagating into a judgment agent's own reference material —
worth closing this cycle rather than deferring.

### N-2: `CLAUDE.md` → "The Brand Is a Cascade Override" omits DECISION-094's flagged `/signin` exception — proposed wording already drafted and ready to apply

**File:** `CLAUDE.md:513-528`

`CLAUDE.md:522-526` states *"`(org)` and `(public)/site/<slug>` are the only
brandable route groups. Everything else — `(auth)`, ... — renders in the
platform palette."* This has been narrowly false since DECISION-094
(2026-08-24): `/signin` (inside `(auth)`) renders a congregation's brand when
`ui.branded_signin` is on and the callback URL's slug resolves to a live
published site. `docs/work-log/2026-09-25-brand-visual-parity.md`'s own Phase 2
Ruling 5 (line 172) already drafted the exact fix, verified still accurate
against `src/app/(auth)/signin/page.tsx:14-58`:

```
One narrow exception, page-scoped and flagged: `/signin` renders a
congregation's brand when `ui.branded_signin` is on **and** the sanitized
`callbackUrl`'s slug resolves to a live published public site (DECISION-094).
It is a single page in `(auth)`, not a third brandable route group —
`/totp`, `/forgot-password` and `/reset-password` stay platform-chrome — and
the flag is seeded off.
```

**Fix.** Insert that paragraph immediately after `CLAUDE.md:526`'s "A branded
403 tells a prober..." sentence. This is a same-cycle, zero-research fix — the
wording was already produced by a different pipeline's Phase 2 and only needs
carrying over.

### N-3: `docs/schema-design.md` §17's cross-org-policy sentence is wrong in both directions (security review B-L5, confirmed independently)

**File:** `docs/schema-design.md:1407-1411`

*"`person_links` and `transfer_certificates` are the only genuine two-org
reads, and both have explicit policies."* `person_links` was deleted (D1's
two-sided-transfer redesign, F9 — the table it names doesn't exist in the
current schema at all). The live catalog carries **three** bespoke cross-org
policies, not two: `commission_visible_to_both`, `delegation_visible_to_both`,
and `certificate_visible_to_either_side` (all three independently justified
elsewhere — F11 added the resolver arms for commissions/delegations). This is
the canonical "and nothing else" sentence a future audit would use to ask "is
this policy sanctioned?" — currently unanswerable from the docs.

**Fix.**

```
`administrative_commissions`, `org_delegations`, and `transfer_certificates`
are the genuine two-org reads, and all three have explicit policies
(`person_links`, an earlier design, was deleted when two-sided transfers were
redesigned around `transfer_certificates` — see F9).
```

### N-4: `docs/product/functionality-map.md`'s top-line dateline and version are stale even though its body was updated the same week

**File:** `docs/product/functionality-map.md:4`

*"Version `0.19.0` · surveyed 2026-08-27."* `package.json` is at `0.24.2`
(five minor versions later), and the file's own body content was correctly
updated 2026-09-24 (the "presby: schema" and "presbytery oversight &
statistics" bullets both cite `drizzle/0043`–`0047` and the 2026-09-24
work-log). Workflow Rule 14 requires updating this file "at ship time" — the
body clearly was, but the header line that exists specifically to tell a
session how current the map is was missed in the same edit. This is a small,
mechanical gap, but it's the exact kind of drift the map's own purpose (loaded
into every session by the SessionStart hook) makes costly: a reader sees
"surveyed 2026-08-27" and may discount the (accurate) 2026-09-24 content below
it as unreviewed.

**Fix.** Bump line 4 to the current version/date whenever the body next
changes; consider deriving the version half from `package.json` at generation
time (`scripts/functionality-map.mjs` already runs at session start) so this
specific half of the staleness class becomes structurally impossible rather
than a habit to remember.

### N-5: `docs/architecture.md`'s dateline is stale (code review M-5, confirmed) — the content it introduces is not

**File:** `docs/architecture.md:5`

*"Last written: 2026-08-27."* The idea-4 paragraph (`:44`) describing the
three-axis organization model (lifecycle / affiliation / platform
participation) was added after `36a2bb8` (2026-09-24) and is accurate against
the shipped D19/D20/D21 model — this is a dateline-only fix, not a content
problem. Per CLAUDE.md's Rule 15, architecture.md updates should be rare and
deliberate; this one already happened, it just needs its own timestamp.

**Fix.** `Last written: 2026-09-24.`

### N-6: `docs/decisions.md`'s own file header still says "for the Claude Code Starter"

**File:** `docs/decisions.md:3`

*"Architectural and implementation decisions for the Claude Code Starter.
Newest first."* This is the starter's original header text, carried over at
scaffold time and never touched since — 144 decisions later, all of them
presby's own. Small, but this is the log CLAUDE.md's own Workflow Rule 4 points
every architectural/implementation decision to, and its self-description is
wrong for the entire time presby has existed as its own project.

**Fix.** `Architectural and implementation decisions for PresbyPortal (presby).
Newest first.`

### N-7: `docs/STATE.md` — 473 of 702 lines (67%) are session-handoff prose across **four** blocks, one more than the task's own framing named; propose a consolidation shape

**File:** `docs/STATE.md` (702 lines total)

Structure, measured directly:

| Block | Lines | Span |
|---|---|---|
| "RESUME HERE" 2026-09-24 (current, actionable) | ~90 | 10–99 |
| "DDL pipeline SHIPPED" narrative, same 2026-09-24 session | ~90 | 100–189 |
| Session handoff 2026-08-31 | ~105 | 190–294 |
| **Session handoff 2026-08-24** (not named in this review's brief — a fourth, older block) | ~189 | 295–483 |
| Permanent reference (What this is → Running it) | ~218 | 484–702 |

The 2026-08-24 block is the largest of the four and describes work
(`presby-site-kit` v3.3–v3.4 bumps, the Westerville site-recreation pipeline,
the org-access back-link fix) that is long since committed and superseded by
everything the 2026-08-27 through 2026-09-24 work produced — every "still
open" item in it (e.g. the `PRESBY_INGEST_URL`/`PRESBY_OIDC_AUDIENCE` GitHub
variables) is either stale or has since moved into `docs/TODO.md` under a
newer, more specific line. It should not still be read as live orientation
material.

**A correctness problem, not just a length one:** the 2026-08-31 block's
account of Vercel/Neon state (*"Reset `DATABASE_URL`/`APP_DATABASE_URL`/
`PLATFORM_DATABASE_URL` to the correct `production`-branch connection
strings"*, `:250-254`) is **actively contradicted by `docs/deployment.md`'s own
2026-09-24 opening paragraph**: *"`docs/STATE.md`'s account of resetting
`DATABASE_URL` et al. on `presby` does not match what is deployed"* and
*"the legacy `presby-portal` project is what is actually serving
`www.presbyportal.org`."* Keeping that block in the file's first-500-lines
"read this" territory risks a future session trusting the wrong one.

**Proposed consolidation shape** (mirrors the precedent `docs/reviews/log.md`
already established for exactly this problem — a dated divider, explicit
"historical, not counted" framing):

1. **Keep at the top, trimmed:** only the currently-actionable "RESUME HERE"
   facts — what's uncommitted, the exact resume steps, the ordered next-tasks
   list, and the operator-blocked items — with the Vercel/Neon narrative
   replaced by a pointer to `docs/deployment.md` (now the corrected, current
   source) rather than restating it a second time in a form that can silently
   re-diverge the way the 2026-08-31 block already did once.
2. **Keep the permanent reference section unchanged** (`What this is` through
   `Running it`, lines 484–702) — this is the stable backbone and reads well.
3. **Move the "DDL pipeline SHIPPED" narrative, the full 2026-08-31 handoff,
   and the full 2026-08-24 handoff below a clearly marked divider** (`---\n\n##
   Session archive (historical — superseded by the sections above and by
   docs/deployment.md; kept for provenance only)`), oldest last, exactly
   `docs/reviews/log.md`'s own convention for the starter's carried-over
   history.
4. **Before archiving, confirm each block's load-bearing facts have a
   permanent home elsewhere** so nothing is actually lost: the real-PII row
   (already in `docs/TODO.md:56` and the security review's B-I1 — safe to
   archive), the abandoned-Vercel-account credentials risk (already in
   `docs/deployment.md`'s own "Vercel — the account problem" section — safe to
   archive), and the "deploys do not migrate" fact (⚠️ **not** yet stated
   anywhere permanent — see C-2 above; move it to `docs/deployment.md` *before*
   archiving this block, not after).

This roughly halves the file's live-reading burden (218 permanent + ~90
current ≈ 300 lines) without deleting any provenance.

### N-8: The "external post-merge review" practice — now run twice on one pipeline, producing DECISION-140 and DECISION-141 — is not named or explained as a process anywhere

**Files:** `docs/schema-design-2.md` §2f (`:656`), §2g (`:822`);
`docs/decisions.md` DECISION-140, DECISION-141; `docs/work-log/2026-09-24-lifecycle-affiliation-returns.md`
("fourth Phase 3 loop-back", "sixth Phase 3 loop-back")

Two of this pipeline's six Phase-3 loop-backs were triggered by "an external
reviewer's read of the exported table shapes" (DECISION-140) and "a
second-round external post-merge review" (DECISION-141) — a practice distinct
from the ordinary Phase 4→3/2 loop-back CLAUDE.md's pipeline table already
describes, because it happens **after** a migration has merged to `main`, uses
an artifact (`scripts/export-table-definitions.py`, per the recent
`539d48e` commit) generated specifically for a reviewer outside the six-phase
loop, and produces its own numbered findings series (F47–F53, then F54–F58)
layered on top of the schema-design-2.md review-round numbering. This is
clearly now a recurring, load-bearing practice — not a one-off — but nowhere
in `CLAUDE.md`'s Development Pipeline section, `.claude/agents/tech-lead.md`,
or `.claude/agents/database-admin.md` is it named, scoped, or given a place in
the phase model (does it re-open Phase 4? Does QA re-run? Who initiates it and
on what cadence?). An agent encountering "sixth Phase 3 loop-back" in a
work-log with no definition of what triggered it has to reconstruct the
process from three different documents.

**Fix.** Name it explicitly, most naturally as a short paragraph under Phase 4
or Phase 5 in `CLAUDE.md` (or in `tech-lead.md`, since tech-lead is the one
who rules on the findings each round produces): what triggers it (an
operator-initiated external read against `scripts/export-table-definitions.py`'s
output, evidently), what it produces (a numbered findings series, folded into
`docs/schema-design-2.md` as a lettered subsection), and which phase it
re-opens (Phase 3, per every instance so far — worth stating as the default
rather than leaving it to be inferred). This is a process-definition gap, not
urgent, but worth closing before a third round makes the reconstruction
problem worse.

### N-9: `docs/schema-design-2.md` — seven review sections (§2a–§2g, 756 lines) now nearly equal the design itself (§3–§10, 774 lines); readability as a *design* document is degrading

**File:** `docs/schema-design-2.md` (1707 lines: §0a–§2 at 10–177, §2a–§2g at
178–933, §3–§10 at 934–1707)

The document's own §2b already anticipates this pattern (it exists specifically
to reconcile round-3 findings against the decisions), but by §2g the review
apparatus is now within 20 lines of outweighing the actual current design it
sits in front of. A reader who wants "what does the schema look like right
now" — the document's stated purpose — has to read seven nested rounds of
findings-and-rulings (F30 through F58, six distinct loop-back rounds) before
reaching Section M, the first section that states a current table shape. This
is the same shape of problem `docs/schema-design.md` already has at a smaller
scale (§17–19's review-findings tail), and it is worth naming now, before an
eighth round makes it worse, rather than waiting for the same complaint to
recur at twice the size.

**Fix (proposed, not applied — this is a substantial restructure and belongs
in its own housekeeping pass, not silently folded into this review):** move
§2a–§2g's review narrative to an appendix at the end of the document (after
§10), leaving a one-paragraph pointer in its place — *"Seven review rounds
(F30–F58) reconciled these decisions against an evolving schema and a legacy
import. Full findings and rulings: Appendix A. What follows is the current
shape."* — so §3 (renumbered §1 if the appendix move is done cleanly) becomes
the first thing a new reader sees. This mirrors the fix already proposed for
`docs/schema-design.md` (move §17–19 review history behind a clearer
"read this only if auditing a past decision" framing) and would be a good
candidate to do both in the same pass, once round-two hardening (currently
mid-flight in `schema-design-2.md` §2g's own subject matter) is committed and
the document is quiescent enough to restructure without racing a concurrent
edit.

### N-10: `CLAUDE.md`'s Project Layout list omits `src/components/org-portal/` and `src/components/shared/`, both load-bearing

**File:** `CLAUDE.md:72-115`

Code review M-6 already names `src/components/org-portal/` as undocumented.
Independently confirmed, and worth adding its sibling: `src/components/shared/`
is referenced by name repeatedly in `docs/product/functionality-map.md`
(avatar-menu, org-switcher, global-nav, feedback-prompt-card, pagination,
button-group) and was itself the subject of a 05-17/07-11 code-review
back-and-forth about whether it existed and was populated — yet
`CLAUDE.md`'s Project Layout section, which exists specifically to orient a
session to where things live, lists only `src/components/brand/` and
`src/components/ui/`.

**Fix.** Add two lines to the Project Layout block, in the same style as the
existing entries:

```
src/components/shared/ — cross-cutting, non-generated UI: avatar menu, org
                         switcher, global nav, feedback prompt, pagination,
                         button-group. Platform-palette by default; anything
                         rendered inside (org)/(public) still inherits brand
                         tokens via the cascade (see The Brand Is a Cascade
                         Override), not a per-component override.
src/components/org-portal/ — tenant-portal-specific composition (tile grid,
                         domain sections, portal footer). Distinct from
                         src/components/shared/ because these compose
                         org-portal-only concepts (PortalTile, domain
                         taxonomy) that platform-shell pages never use.
```

---

## Minor

**M-1:** `docs/testing.md` is otherwise the best-maintained document in this
review's scope — accurate against `e2e/support/users.ts`/`seed-orgs.ts`, the
rate-limit `.env.local` caveat is exactly right, and the "trust the code if
they disagree" framing for its own account table is a good pattern worth
naming as a convention (see Observations). Only gap is C-3 above.

**M-2:** `docs/work-log/_template.md` has no shape for how a large,
multi-loop-back pipeline actually records itself. The 2026-09-24 pipeline
(4,282 lines) repeatedly uses a pattern the template doesn't show at all:
dated "tech-lead amendment after Phase 5" / "sixth Phase 3 loop-back"
subsections appended under the relevant phase heading, and an orchestrator
recording a judgment agent's (analyst/architect/qa) verbatim returned text
rather than the judgment agent writing it directly (per CLAUDE.md's own
"Judgment agents cannot write" rule, added after the template's Phase
sections were drafted). Neither convention appears in `_template.md`'s Phase
2/3/5 skeletons.

**Fix (proposed additions to `_template.md`):**
- Under each Phase heading, add a one-line note: *"For a loop-back or
  amendment, add a dated subsection here (`### Loop-back N — <trigger>` or
  `### Amendment after <event>`) rather than editing the original text in
  place — the pipeline's judgment history is itself part of the record."*
- Add a one-line note above the Phase 1/2/5 skeletons: *"Analyst, architect,
  and qa are read-only — the orchestrator pastes their returned text into this
  section verbatim; the phase's Owner in the Per-Phase Status table is still
  the judgment agent, not the orchestrator."*

**M-3:** `docs/deployment.md` — otherwise the most improved document since the
last cycle (a full, accurate rewrite 2026-09-24, correctly self-describing the
error it replaces). Beyond C-2's Node/migration gaps, no other issues found;
worth naming as a model for what `README.md`'s rewrite (C-1) should look like
in tone — plain statements of current fact, dated, with `[YOU]`/`[CLAUDE]`
action ownership made explicit.

**M-4:** `docs/product/functionality-map.md` — beyond N-4's dateline, no other
staleness found this cycle; the presbytery and schema lines are current as of
2026-09-24 and the rest of the body reads consistently with
`docs/reviews/2026-09-25-code.md`'s and the security review's independent
reads of the live tree.

---

## Observations

**O-1.** `docs/reviews/log.md`'s own "reset 2026-08-19... explicit baselines,
not completed reviews" framing is a good pattern and is exactly what this
review recommends `docs/STATE.md` borrow for its own archive (N-7).

**O-2.** The pattern behind C-1, C-4, N-3, N-5, N-6 is the same one the code
review named for its own tripwires: *a document asserts a closed, canonical
list ("the only two," "not yet named," "Node 20.9+"), the underlying system
changed, and nothing that changed it circled back to the sentence making the
closed claim.* Worth naming at the retrospective as a documentation-specific
instance of the code review's own summary line — the tooling gap and the
documentation gap are the same failure mode wearing two hats.

**O-3.** `docs/architecture.md`'s idea-4 paragraph (the three-axis organization
model) is a genuinely good piece of writing for its stated audience (an
engineer seeing the project for the first time) — dense but accurate, and it
resisted the temptation to describe implementation detail. No content changes
recommended beyond the dateline (N-5).

**O-4.** `docs/schema-design-2.md` §0a ("The Book of Order is a design
authority") is worth calling out as a strong addition this cycle — it already
paid for itself once this pipeline (correcting D10's lifecycle vocabulary
against G-3.0301) and gives a future reviewer a concrete, checkable standard
("did we check the polity before naming this?") that most schema-design prose
doesn't have.

**O-5.** None of this review's findings required touching anything under
`drizzle/`, `scripts/`, or `src/lib/db/domain/` — the explicit
out-of-scope carve-out for round-two hardening held cleanly; nothing in the
in-flux area leaked into a documentation claim this cycle.

---

## Summary

Nine notable-or-worse findings, all independently reproducible with a `grep`
and none requiring domain judgment to resolve — this review found no case
where a document was *wrong about the schema or the invariants themselves*,
only cases where a document's account of a route, a table's status, a file's
own header, or the project's public identity had not been revisited since the
thing it described changed. `README.md` (C-1) and `docs/deployment.md`'s
missing Node deadline (C-2) are the two with real external consequence — the
first because this is a public repo and DECISION-126 is five weeks old, the
second because the deadline it omits is six days away as of this review.
`docs/STATE.md`'s consolidation (N-7) is the largest single edit proposed and
is deliberately **not applied** here — it touches a file every session reads
first, so the shape should be confirmed before executing it.

**Not this review's to fix:** nothing above requires code changes; C-3's
CI-side twin (making `--no-file-parallelism` and the Neon-branch DB-test job
actually run) belongs to `docs/reviews/2026-09-25-code.md`'s C-1 and its own
punch-list, not here — this review only confirms the *documentation* half of
that gap independently. N-8 (naming the external-review process) is a
CLAUDE.md/agent-file edit and could reasonably be folded into the next
agent-instruction review instead of this one; flagged here because it surfaced
during this pass.

**Proposed log line:**

```
2026-09-25 | documentation | first real presby run (2026-08-19 was a baseline reset): 4 critical (README.md describes a pre-2026-08 project — wrong name, wrong status, Node 20.9+ vs engines>=22; docs/deployment.md has zero mention of the Node-22 Vercel deadline six days out; the DB-backed test invocation is undocumented anywhere, confirming the code review's C-1 from the docs side; schema-design.md §13 lacks the superseded banner §14 carries, so a required-reading doc still presents a dropped table as current), 10 notable (CLAUDE.md Post-Login Landing stale by a retired route in 4 places, full rewrite proposed; Brand Is a Cascade Override missing DECISION-094's /signin exception, wording already drafted by a sibling pipeline; schema-design.md §17's cross-org-policy sentence wrong in both directions; functionality-map.md's dateline stale despite an updated body; architecture.md dateline stale; decisions.md's own header still says "Claude Code Starter"; STATE.md is 67% session-handoff prose across four blocks — one more than expected — with one block's Vercel/Neon account already contradicted by deployment.md itself; the "external post-merge review" practice run twice this pipeline is unnamed anywhere; schema-design-2.md's seven review sections now nearly outweigh the design itself; CLAUDE.md's Project Layout omits two load-bearing component directories), 4 minor, 5 observations; see 2026-09-25-documentation.md
```
