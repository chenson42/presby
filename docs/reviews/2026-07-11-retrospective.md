# Retrospective — 2026-07-11

**Synthesizer:** tech-lead
**Window covered:** 2026-05-18 → 2026-07-11 (post-v0.3.1 through v0.6.0 and the 2026-07-11 instruction-layer rewrite)
**Input artifacts read:** `2026-05-17-retrospective.md`, `docs/reviews/log.md`, `docs/TODO.md` (Done section), all 25 work-logs dated 2026-07-01/07-02, `2026-07-11-instruction-layer-slim.md`, `2026-07-11-agent-instruction.md`, `npm run stats:escape` output.

---

## Follow-up check: did the 6 edits from 2026-05-17 land?

All six landed, and all six survived the 2026-07-11 instruction-layer rewrite without regression:

| # | Edit | Status | Evidence |
|---|------|--------|----------|
| 1 | `check:audit` in Phase 4 gate | **LANDED** | `CLAUDE.md:172` — Phase 4 gate lists it alongside typecheck/build |
| 2 | Release-notes skill reviews CLAUDE.md | **LANDED** | `.claude/skills/release-notes/SKILL.md:83-91`, "Step 4: Update CLAUDE.md" |
| 3 | Adversarial pass in analyst Phase 1 | **LANDED** | `.claude/agents/analyst.md:48`, "Pass 5 — Adversarial Pass," citing the v0.3 open-redirect incident by name |
| 4 | Remove qa.md stale "no test runner" caveat | **LANDED** | Current description is a clean 2-sentence summary; no caveat remains |
| 5 | Fix api-developer.md schema-ownership claim | **LANDED** | Description now reads "schema/DDL belongs to database-admin" |
| 6 | Real `isFlagEnabled` call site | **LANDED** | `src/app/(admin)/admin/page.tsx:13` — `demo.new_dashboard` gates a real UI element |

This is a clean track record: every proposed edit from the first retrospective was acted on, none silently dropped.

---

## Escape-Rate Stats (`npm run stats:escape`, verbatim)

```
> claudecode-nextjs-starter@0.6.0 stats:escape
> node scripts/stats-escape.mjs

Escape-Rate Report — 30-day window
Grandfather cutoff: 2026-05-18 (commits before this date lacked trailers by design)

Total commits (30d):        34
fix: commits (30d):          7
  With trailers:             7
  Missing trailers (bypass): 0   ← hook bypassed or pre-cutoff

Caught-By breakdown (7 tagged fix: commits):
  automated-test   0 (0%)
  agent-review     7 (100%)
  human-review     0 (0%)
  production       0 (0%)

Discovered-In breakdown:
  Phase-1          2 (29%)
  Phase-4          1 (14%)
  post-merge       4 (57%)
```

**Missing trailers (bypass): 0.** Hook discipline is perfect over the 30-day window — every `fix:` commit carries both required trailers. No `--no-verify` bypasses.

**Caught-By is 100% `agent-review`, 0% `automated-test`.** Every one of the 7 tagged fixes required an agent to decide to look somewhere non-mandatory — none were CI-mechanical catches. This is a double-edged signal: on one hand, the pipeline's judgment layer is earning its keep (see the BUG-1 through BUG-4 sweep below). On the other, it means the automated test suite has not yet caught a regression on its own in 30 days — either because test coverage genuinely closed the gaps the 2026-05-17 retrospective flagged (`two-factor.ts`, `proxy.ts` both now at 100% per the 2026-07-01 test-coverage log entries), or because the bug classes being found are structurally the kind static tests don't reach (module-resolution defects, cross-file behavioral drift) — the BUG-1–4 pattern below supports the latter.

**Discovered-In skews post-merge (57%).** This is the most important number in this report. Four of seven tagged fixes were found *after* a merge to main, not during the pipeline that shipped the original feature. All four (BUG-1 verify-email transaction, BUG-2 2FA cookie mutation, BUG-3 OAuth first-signin, BUG-4 NextAuth trustHost) were caught in a dedicated 2026-07-01 sweep — i.e., the team noticed the post-merge pattern and ran an explicit audit pass to find them, rather than them surfacing from routine use. That sweep behavior is good process, but the underlying rate (4 of 7 fixes needed a retrospective sweep to find) means Phase 5/Phase 6 are not yet the primary detection layer for this bug class.

---

## Pipeline Efficacy Synthesis (2026-07-01 → 2026-07-02 wave, 25 work-logs)

### Loop-backs: 1 formal, 1 informal

| Work-log | From → To | Root cause | Caught by |
|----------|-----------|-------------|-----------|
| `2026-07-01-feedback-dev-loop.md` | Phase 5 (QA) → Phase 4 (implementer) | `scripts/feedback-check.mjs:44` — falsy check (`!process.env[key]`) overwrote an explicitly empty `DATABASE_URL=''`, breaking the "silent when no DB" contract for the SessionStart hook | QA, one-line fix, re-verified, PASS |
| `2026-07-02-totp-enrollment-redirect.md` (informal) | Phase 4, in-place | The two-hop redirect broke 2 e2e specs, one of which (`member-home.spec.ts` test 6) the Phase 3 design had not anticipated; fixed in-place by the implementer and flagged at Phase 6 as a Phase 3 spec oversight | e2e gate at Phase 4 |

One formal loop-back across 25+ pipelines is an excellent rate, and notably it fired on the single most security-sensitive script in the codebase this period (the feedback-hook that must never leak body content into LLM context) — exactly where you want the gate to be strict. The zero-loop-back result from 2026-05-17 was flagged in that retrospective as "atypically clean" and likely to degrade; it degraded to a ~4% loop-back rate, which is still very low and both instances validate that the gates catch real defects rather than rubber-stamping.

Two loop-backs were also *prevented* upstream, which is the cheaper place to catch them: the email-queue Phase 1 adversarial pass killed an unsafe `SKIP LOCKED` claiming pattern before design (→ DECISION-018), and the e2e-auth-infra Phase 3 ran a live probe that disproved an assumption inherited from the npvitals fork (302-vs-2xx sign-in response) before any code was written. The adversarial pass added in response to the 2026-05-17 retrospective (Edit 3) is demonstrably earning its slot.

### Phase skips: 11 total across 7 pipelines, 100% notated, zero silent skips

Every skip (5 bug-fix Phase 2 skips; `pending-email-expiry-filter` also skipped Phase 3; the two Polish-class pipelines `mobile-360-pass` and `instruction-layer-slim` skipped Phases 1–3 / 2–3 respectively) carries an explicit rationale in the Per-Phase Status table itself (not just buried in prose) — e.g. "N/A — no new deps, schema, or structure," "CSS-only, class attrs only." Workflow Rule 8 compliance held at 100% across the entire window, consistent with the prior period.

### Phase 6 verdicts: 24 SHIP IT, 1 SHIP WITH NOTES, 0 NEEDS REWORK

The lone SHIP WITH NOTES was `2026-07-01-feedback-dev-loop.md` (FU-1: e2e test-data rows persist in the dev DB feedback table, permanently firing the SessionStart banner). This is the system working exactly as designed — the follow-up was filed in `docs/TODO.md`, picked up as its own pipeline (`2026-07-02-e2e-feedback-cleanup.md`), and shipped clean (SHIP IT) the next day. Zero SHIP WITH NOTES items are still open.

### Agent utilization — the Theme 2 gap from 2026-05-17 is resolved

The prior retrospective's Theme 2 finding — `database-admin` and `api-developer` never invoked as sole Phase 4 implementers across the first 6 features — no longer holds. Tally across the 25-pipeline wave (counting split 4a/4b/4c pipelines toward each agent used):

| Agent | Times used as Phase 4 implementer |
|-------|-----------------------------------|
| full-stack-developer | 14 (solo + split-partner roles) |
| api-developer | 11 (solo + split-partner roles) |
| database-admin | 4 (always paired, as schema-split 4a: email-queue, feedback-dev-loop, email-observability, whats-new) |
| ux-developer | 3 (2 solo + 1 split) |
| main session (off-roster) | 1 (instruction-layer-slim — doc-only; acceptable, but note the pattern) |

Both previously-idle agents are now core rotation. The pattern that emerged: any feature touching `schema.ts` gets an explicit 4a (database-admin) / 4b (api-developer or full-stack-developer) split, sequenced to avoid concurrent `db:generate` migration-number collisions — `whats-new`'s work-log explicitly calls out sequencing with the concurrent `email-observability` pipeline ("database-admin for email-observability must commit migration 0006 BEFORE whats-new generates 0007"). This is a real coordination cost of running multiple schema-touching pipelines in the same window, and it was handled correctly by naming the sequencing constraint in the work-log rather than by accident.

### The e2e auth gate: earned its cost, did not pass trivially

The gate ran mandatorily on ~6 auth-touching pipelines (`account-lockout`, `auth-mode-flags`, `nextauth-trusthost`, `oauth-first-signin-accessdenied`, `totp-enrollment-redirect`, `turnstile-captcha`) plus voluntary belt-and-suspenders runs on `access-denied-audit` and `flag-caching` — roughly 8 runs total, with **one genuine defect catch**: on `totp-enrollment-redirect`, the Phase 4 e2e run surfaced spec breakage (`member-home.spec.ts` test 6) the Phase 3 design had not anticipated. That pipeline is also the strongest systemic case for the gate: it fixed the exact lockout defect (unenrolled 2FA-required admin in an infinite redirect loop between `/totp` and the proxy's 2FA gate) that the 2026-05-17 security review (M2) flagged as *surviving all six phases undetected* in the prior window — and this time the gate ran 48/48 against a live dev server with the MFA-enrolled seeded admin present throughout, with QA explicitly confirming the two-hop redirect chain and the "Continue" CTA.

The other runs passed cleanly but non-trivially: `account-lockout`'s lockout × 2FA interaction was covered *only* by the gate; `turnstile-captcha`'s "keyless no-op stays green" contract was the primary regression risk by design; and `oauth-first-signin-accessdenied` correctly honored a BLOCKED-on-coordination wait rather than deferring the e2e. One genuine catch per ~8 runs, on a bug class (runtime/framework constraints) that nothing else in the pipeline reaches, is a favorable cost/benefit — the mandatory rule (BLOCKED, not PASS, on deferred e2e) was the correct call.

### Bug-fix sweep (BUG-1 through BUG-4, 2026-07-01)

Four bugs were found and fixed in a single dedicated sweep, not through the standard feature pipeline:

| Bug | Root cause | Discovered-In |
|-----|-----------|----------------|
| BUG-1 | `db.transaction()` used against neon-http (unsupported) in verify-email | post-merge |
| BUG-2 | 2FA fresh-recovery-codes cookie deleted inside RSC render (illegal in Next 16) | post-merge |
| BUG-3 | First-time Google OAuth sign-in got `AccessDenied` | post-merge |
| BUG-4 | NextAuth `trustHost` unset — hard-blocked OAuth off-Vercel | post-merge |

All four are the same shape: a framework/runtime constraint (neon-http's transaction support, Next 16's RSC cookie-mutation rule, NextAuth's host-trust model) that unit tests cannot exercise because they require the actual runtime environment. This is consistent with the Caught-By stats above (0% `automated-test`) and is the strongest signal in this retrospective: **the e2e/running-server gate is compensating for a real, structural blind spot in the unit-test layer**, not a redundant check.

A taxonomy gap surfaced while tallying: all four sweep bugs were discovered via the **sibling-harvest review** (cross-repo comparison against the 7 fork repos), a pathway that doesn't map cleanly onto the `Caught-By` enum — they were tagged `agent-review` in their commit trailers, which is technically right but loses the information that a *cross-repo* review, not an in-repo one, found them. If the harvest becomes a recurring practice, the enum (or a documented mapping rule) should say where those go.

---

## Punch List — Deltas on Top of the 2026-07-11 Instruction-Layer Rewrite

The instruction layer was rewritten today (commit `ecc5d2d`) specifically to fix duplication and drift. The items below are **new findings from this retrospective's data**, not restatements of that rewrite's own findings.

1. **`docs/work-log/2026-07-11-instruction-layer-slim.md` Phase 6 is still marked "Pending diff review" even though the commit is merged to main and `docs/TODO.md` already lists it Done.** The work-log is the pipeline's source of truth per CLAUDE.md; a stale "Pending" row will confuse the next session's cadence check into thinking Phase 6 sign-off never happened. Close the loop: update the Per-Phase Status table's Phase 6 row to Complete / (verdict) and append a short Phase 6 section, even retroactively.

2. **The Caught-By distribution is 100% `agent-review`, 0% `automated-test`, over 30 days — worth naming as a trend, not just a stat.** Every tagged fix required an agent to actively look somewhere non-mandatory. This isn't a defect, but if it holds for another 30-day window it's worth asking in the next retrospective whether specific recurring failure classes (framework/runtime constraints not exercisable by Vitest) should get a *named* automated check rather than relying on agent judgment every time — e.g., a static grep-based tripwire for `db.transaction(` against files that also import the neon-http driver, mirroring how `check:sql-date` was created after a similar class of bug.

3. **Schema-split (4a/4b) sequencing is currently coordinated by hand-written notes in individual work-logs (e.g. whats-new's explicit "wait for 0006 before generating 0007").** This worked this period but is a manual coordination step with no structural backstop — nothing stops two concurrent `database-admin` invocations from generating colliding migration numbers if the sequencing note is missed. Consider a one-line addition to the `database-admin` agent file: check `drizzle/` for the latest migration number immediately before running `db:generate`, and flag to the user if another schema pipeline is in flight per `docs/TODO.md`'s In Flight section.

4. **Post-merge discovery rate (57% of tagged fixes) is the single largest number in this report and isn't yet a named metric anywhere.** `npm run stats:escape` reports it in the raw breakdown but nothing currently sets a target or trend-tracks it release over release. Consider having the tech-lead explicitly carry the post-merge percentage forward retrospective-to-retrospective (a one-line addition to this report's stats section, no code change) so a rising trend is visible before it becomes a pattern worth a dedicated sweep.

5. **The `feedback-dev-loop` loop-back (Phase 5 → Phase 4, `scripts/feedback-check.mjs:44`) is exactly the kind of one-character defect a unit test would catch cheaply, and QA's own work-log recommended adding one** ("Consider adding a unit test for the `loadEnv()` function directly... to prevent this class of regression") but no follow-up item for it was ever filed in `docs/TODO.md`. This is a small gap in Workflow Rule 10 discipline — a QA-recommended regression test was proposed and then dropped rather than tracked. Add it to `docs/TODO.md` Backlog now.

6. **No dedicated `test-coverage` review has been logged since 2026-07-01** (two entries that day: Phase 5 sweep at 62.29%/77.4% stmts, both from feature pipelines rather than a standalone cadence-driven review). Per the two-slot model (DECISION-029), `test-coverage` is in the 14-day release slot alongside `retrospective` — today's retrospective is on schedule, but the next release-slot review should explicitly re-run a standalone `test-coverage` sweep rather than relying on incidental Phase 5 numbers from whatever features happen to ship.

7. **The `Caught-By` enum has no home for cross-repo (sibling-harvest) discoveries.** Four of the five bug-fix pipelines this period originated from the sibling-harvest review and were tagged `agent-review` — technically correct, but the trailer loses the cross-repo provenance that made those catches possible. Either add a documented mapping rule to CLAUDE.md's Commit Message Standards ("harvest-discovered bugs → `agent-review`, note the harvest in the body") or extend the enum if the harvest becomes a standing practice.

8. **Phase 3 designs under-specify e2e blast radius.** The one informal loop-back this period (`totp-enrollment-redirect`: an existing e2e spec broke that the design hadn't listed) suggests a cheap addition to the tech-lead's Phase 3 checklist: enumerate which *existing* e2e specs assert behavior the change will alter, not just which new tests are needed. One-line addition to `.claude/agents/tech-lead.md`.

---

## Verdict

The pipeline is healthy and improved on every axis the prior retrospective flagged: all 6 proposed edits landed and held through a same-day instruction-layer rewrite, the previously-idle `database-admin`/`api-developer` agents are now core rotation, the auth e2e gate caught the exact defect class (2FA enrollment loop) that survived all six phases last period, and hook/trailer discipline is perfect (0 bypasses). The one open risk worth tracking forward is structural, not procedural: 57% of this period's tagged fixes were found post-merge via a dedicated sweep rather than by the standard phase gates, and 100% of Caught-By classifications required agent judgment rather than an automated test — both point at the same underlying blind spot (runtime/framework constraints Vitest cannot exercise), which the e2e gate is currently the only defense against.
