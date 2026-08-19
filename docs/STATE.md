# Where the project stands

**Read this first in a new session.** Then `docs/schema-design.md` for rationale
and the findings log, and the newest file in `docs/work-log/`.

Updated 2026-08-19.

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

**Not named yet.** `/personalize-starter` is deliberately un-run, so `presby`
threads through the database role, thirteen `presby_*` SQL functions and every
migration filename. Leading candidate: **Presbyter** — but it is taken on `.org`,
`.church`, `.app` and `.com`, as are `kirk`, `knox`, `presbytery` and `polity`.
Free and defensible: `presbyterial.org`. Standing advice: keep the name, take
`presbyterhq.org`, and inquire on the exact match. This gets more expensive every
week it stays a placeholder.

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
