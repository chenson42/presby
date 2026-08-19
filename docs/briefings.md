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

<!-- covers: decision=050 commit=dd36e61 -->

*The marker above is what makes staleness measurable. `scripts/briefings-check.mjs`
compares it against `docs/decisions.md` and `git log`, and says at session start
if decisions or feat/fix commits have landed since. Move it when you write new
entries — that is the one piece of discipline this file needs, and it is checked.*

---

## 2026-08-19

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
