# Retrospective — 2026-10-24

**Synthesizer:** tech-lead
**Window covered:** 2026-09-25 (last retrospective) to 2026-10-24, main at 5f333eb (v0.42.2).
**Input artifacts read:** `docs/reviews/log.md`; `docs/reviews/2026-09-25-retrospective.md`; `git log --since=2026-09-25` (238 non-merge commits, 33 merged PRs, 36 `fix:` commits, trailers parsed from every body); all 36 work-logs dated 2026-09-25 onward (Per-Phase Status rows for all; read in full or in the relevant runs: `2026-10-22-founding-admin-directory` Increment 2 Phase 3 copy, QA runs 1-3 and Phase 6; `2026-10-24-invite-accept-copy`; `2026-10-23-community-staff-anchor`; `2026-10-23-person-emails` QA; `2026-10-23-zod-4`); `docs/STATE.md`; `docs/TODO.md`; `docs/briefings.md` and `scripts/briefings-check.mjs`; `scripts/pre-push-gate.mjs`; `playwright.config.ts`; `scripts/ci/e2e-baseline-flags.sql`; the workflow-efficiency commit 8e628ae; `npm run stats:escape`, `scripts/briefings-check.mjs`, `scripts/cadence-check.mjs`.

Scope note: I counted from Per-Phase Status rows and commit bodies, not from re-reading all 56,368 lines of the 36 work-logs. Where a number rests on a grep of mentions rather than a count of incidents, it says so.

---

## `npm run stats:escape` — verbatim

```
> presby@0.42.2 stats:escape
> node scripts/stats-escape.mjs

Escape-Rate Report — 30-day window
Grandfather cutoff: 2026-05-18 (commits before this date lacked trailers by design)

Total commits (30d):        316
fix: commits (30d):          38
  With trailers:             38
  Missing trailers (bypass): 0   ← hook bypassed or pre-cutoff

Caught-By breakdown (38 tagged fix: commits):
  automated-test   6 (16%)
  agent-review     26 (68%)
  human-review     3 (8%)
  production       3 (8%)

Discovered-In breakdown:
  Phase-1          2 (5%)
  Phase-2          1 (3%)
  Phase-3          1 (3%)
  Phase-4          5 (13%)
  Phase-5          7 (18%)
  Phase-6          7 (18%)
  post-merge       10 (26%)
  production       5 (13%)
```

**Missing trailers (bypass): 0.** The tool's window starts 2026-09-24 and includes two fix commits that belong to the previous retrospective (422d894, 1a5201e). For this window (since 2026-09-25) I re-parsed the bodies: 36 `fix:` commits, 36 with both trailers, zero `--no-verify`.

### Correcting the labels: 3fdb93e and 639b8dc are post-merge, not production

Two zod commits carry `Discovered-In: production`. Reading both bodies, neither was found in the deployed environment:

- **3fdb93e** (zod 3 to 4, GHSA-mrhx-c7xc-m3w5): CI's `audit-prod` job found a published advisory against code already on `main`. That is post-merge, `Caught-By: automated-test` (the existing label is right).
- **639b8dc** (person-emails schemas converted for zod 4): found when `origin/main`, carrying the person-emails pipeline's `z.string().uuid()` rows, was merged into the zod branch and the new source-scan guard failed. A semantic conflict between two parallel pipelines, found at merge. Post-merge, `Caught-By: automated-test` (right).

The tool cannot tell these from real production finds, so I read them as post-merge below. Corrected table (my hand count, window since 2026-09-25, 36 fixes):

| | Tool as logged | Corrected |
|---|---|---|
| Discovered-In Phase 1-3 | 4 (11%) | 4 (11%) |
| Phase 4 | 4 (11%) | 4 (11%) |
| Phase 5 | 7 (19%) | 7 (19%) |
| Phase 6 | 7 (19%) | 7 (19%) |
| **Caught before merge (Phases 1-6)** | **22 (61%)** | **22 (61%)** |
| post-merge | 9 (25%) | **11 (31%)** |
| production (genuine) | 5 (14%) | **3 (8%)** |
| Caught-By agent-review | 25 (69%) | 25 (69%) |
| Caught-By automated-test | 6 (17%) | 6 (17%) |
| Caught-By human-review | 2 (6%) | 2 (6%) |
| Caught-By production | 3 (8%) | 3 (8%) |

(The tool's 30-day figures above include the two 09-24 commits; hence post-merge 10 there and 9 here.)

**Post-merge share, carried forward as the headline number:** 57% (starter, 2026-07-11) -> 95% tool / 80% hand count (2026-09-25) -> **26% tool / 31% corrected (this retrospective)**. Two cautions before anyone reads that as the process improving:

1. The 80-95% figure was dominated by one pipeline's two external-review rounds (F47-F58). The review log records no external post-merge schema review in this window, so `human-review` fell from 58% to 6% partly because the reviewer didn't run. I would not claim the drop as proven improvement until an external round happens against the post-C-1 pipeline.
2. Four of the 36 fixes (11%) are dependency advisories (5056b13, 122e3a2, 3fdb93e, 639b8dc). They are structurally post-merge: the code did not change, the world's knowledge of it did. They inflate the post-merge column without being a pipeline miss.

**What is real:** 61% of fixes are found before merge, and 22 of 22 of those were found by an agent or a test, which is the shape the pipeline is meant to produce. The part that moved against us is below.

### Three genuine production escapes, all on 2026-10-23

These are the first genuine `Discovered-In: production` fixes since launch (the previous retrospective's three were pre-launch mislabels). All three were found by the operator on one day, the first real use of an accepted invitation at the operator's first test congregation:

| Commit | What the operator found | Origin |
|---|---|---|
| 6899783 | The no-organization page promised "someone there with administrator access can add you". False since invitations shipped (v0.37.0, 2026-10-21). | Copy made stale by another pipeline; nobody swept for it |
| e4190b4 | A founding administrator who accepted by invitation appeared in none of Community's six views (a staff-anchor membership with no roll and no position). | A new kind of account state; the Community Phase 6 flagged the "Everyone" semantics but not this hole |
| 18c8b32 | The admin sidebar's back link went to the public front page. | Older gap; reached only by someone who lives in the admin shell |

The first two are the same cause: **a feature created a new kind of person (the founding administrator who arrived by invitation) and nobody walked the product as that person before the operator did.** See punch item 5.

---

## Did the previous retrospective's punch list land? (carry-over audit)

Opening a retrospective with a landed/not-landed audit is new; I recommend keeping it (item 1).

| 2026-09-25 item | Landed? | Evidence |
|---|---|---|
| 1. Phase 3 retroactive re-check, `tech-lead.md` | **No** | grep for "retroactive", "already specified", "re-audit" across `.claude/` and `CLAUDE.md`: nothing |
| 2. Clause-level DDL restatement, `database-admin.md` | **No** | no "restate" or "in English" in the file |
| 3. Regression-test-shape sentence, `qa.md` | **No** | nothing |
| 4. Rule 16 mechanics as blocking | **No, still one open TODO** | `docs/TODO.md:217` (R16-1 to R16-5) |
| 5. Structured Per-Phase Status cell, `_template.md` | **No** | the 10-23 chore edited the template for Copy and "Phase 4 stays short" only |
| 6. `Discovered-In: production` definition, CLAUDE.md | **No, and it recurred** | the two zod mislabels above |
| 7. Standalone test-coverage run | Overdue again | 15 days past cadence today |

The list was filed as one bulk TODO line (`docs/TODO.md:212`, "Apply in the next agent-instruction pass"), and that pass has not run. One unrelated workflow chore (8e628ae, 2026-10-23) did edit `tech-lead.md`, `qa.md` and the template, so the files were being edited; this list just wasn't in the queue. The 2026-07-11 retrospective reported all six of its edits landed; the difference is that those were applied in the review session. **Recommendation: the retrospective applies its own punch list before it is logged (item 1).** Every edit below is given as exact text so it can land in one `docs(agents)` commit once the operator approves.

---

## What went well

1. **A real CI gate now exists.** The previous retrospective called C-1 (DB-backed suites and `test-rls.sql` running nowhere in CI) the largest single lever. It closed on 2026-10-23 (PR #41): `db.yml` runs four shards plus `test-rls.sql` as `presby_app`, and `e2e.yml` runs split dev and production-build lanes on every PR. QA's Run Scope (rewritten in 8e628ae) now verifies the change instead of repeating CI. Evidence it is working: Community Increment 2's runs 2 and 3 and the invite-copy runs were scoped and stated what they did not re-run.
2. **QA's failing-first discipline held, and got sharper.** Negative controls this period: Increment 2's run 2 put the pre-fix sources back and counted 8 new tests red; invite-copy's overflow e2e fails with 13 offenders on the unfixed components; the treasurer-name DB test has a mutation control. QA also disclosed its own mistakes (a discarded :3000 run; connection strings echoed into its transcript, with a rotation recommendation). 17 of 36 pipelines had a first-run QA FAIL or BLOCKED and each was closed by a second pass, most the same day.
3. **zod 4 is the template for a major dependency upgrade.** 16 golden files characterized every user-visible message before the upgrade; QA replayed the commit order on zod 3 to prove the tests were red or green for the right reasons; an advisory regression test fails on zod 3 and passes on 4; a source-scan guard bans `.uuid()` and the `zod/v3` subpath. The temporary CI exception (711efaf, with an expiry) lived under 24 hours. And the guard did a second job: it caught the person-emails pipeline's `.uuid()` rows (639b8dc), a semantic conflict no merge tool would flag. Ids use `z.guid()` because shipped role ids are not RFC 9562, which is exactly the "new validation versus shipped fixtures" class the Phase 3 feasibility check names.
4. **Rule 16 mostly worked.** Five pipelines ran concurrently on 2026-10-22/23, each with its own worktree and Neon branch, with the orchestrator integrating shared files. No duplicate migration, DECISION or F numbers in this window (checked against the journal, `decisions.md` and `schema-design-2.md`; the one duplicate in `decisions.md`, 078, predates it). Pipelines merged `origin/main` up before QA, which is where all three semantic conflicts surfaced (below).
5. **Go-live discipline.** Snapshot first, explicit deploy-order runbooks ("apply 0062, deploy the code, then apply 0063"), Phase 6 "ship conditions" lists, and the manual bootstrap walk Increment 2 required (ship condition 10), which found the Officers hint contradicting the new Session note (1f2fa61). That walk is the practice that would have prevented the production escapes; it should be general (item 5).
6. **Trailers and skips are clean.** 36/36 fix commits carry both trailers; every skipped phase (invite-copy, staff-anchor, signin-seed-hint, zod Phase 1) carries explicit notation.
7. **The Phase 3a mechanism (architect reviews design departures)** accepted R21/R23/R24 departures with amendments instead of letting them ride; it is cheap and should stay.

---

## Recurring loop-back causes

### A. Copy that said something untrue: 9 of 36 fixes (25%)

Definite: ae1adbd, a49412c, 8fb090c, 1f2fa61 (Phase 6); 0e88167, 3dab58c, 4b5a1c1 (Phase 5); dbd1d8f (Phase 4); 6899783 (production). A tenth, fbcd0ab (plain-English error mapping), is borderline. Phase 6 found five of them and Phase 5 three: copy is being discovered at the two latest and most expensive gates. Phase 6 is a shipped-versus-intent verdict, not a defect net.

**Does the Phase 3 copy review need strengthening? Yes, and not in the way the 8e628ae wording assumes.** The rule landed 2026-10-23 14:57, after Community Increment 2's Phase 3 (2026-10-22), so the Increment 2 failures are not a failure of the rule. But Increment 2's Phase 3 *had* a 50-line Copy section written by the tech-lead, and it still shipped three defects. Classifying every defect since 2026-09-25 against what the rule actually tests:

| Failure class | Examples | Caught by "read against accepted residuals and Phase 2 rulings"? |
|---|---|---|
| **Residual denial / overclaim** | a49412c (treasurer copy denied the accepted revoke-then-self-invite residual); ae1adbd (overclaimed undo and the 0061 control) | Yes. This is all the rule says. |
| **Claim stronger than the data behind it** | Inc 2 run 1: `no_sign_in` said "none has a PresbyPortal account" from a count of live seats only; the same copy table already mentioned the "every seat starts later" case, so the design knew the state existed. Also dbd1d8f (an expired row said "open") | Only if "residuals" is read to include the design's own state model. Not stated. |
| **Instruction or promise to a viewer whose role can't act** | Inc 2 run 2: the bulk panel told an approver-only role to "withdraw"; run 1: `pending_action` ("wait") when nobody can approve; 4b5a1c1: "ask your church administrator to arrange" an invitation they cannot issue | **No.** The default role for the surface is the test; no one is asked to name the viewer. |
| **Neighbouring strings made stale** | 6899783 (no-organization page, stale since v0.37.0, found by the operator); run 1's `pending_action` (Increment 1); 1f2fa61 (Officers hint contradicts the new Session note) | **No.** Nothing asks the tech-lead to grep the live tree for strings about the same subject. |

Two further process gaps sit under these:
- **Copy written outside Phase 3 has no review at all.** The bulk panel sentence came from the implementer ("this isn't Phase 3 copy", QA run 2). The staff-anchor bug-fix grew a no-organization rewrite mid-pipeline in an orchestrator-authored brief, and that first rewrite *still* overpromised (4b5a1c1, QA run 1).
- **QA's copy-truthfulness check is not written down.** It found three of the period's defects and appears in no agent file or template: `qa.md` says only "Skip: per-fork copy", the template's Phase 5 has no copy row, and run 2's own verdict credits "the re-scan you asked for" (the orchestrator). A check that depends on the orchestrator remembering to ask is a check that stops running (items 2 and 3).

**n=1 after the rule:** invite-copy was the only pipeline run under the new Copy rule. Its Copy table had no defect (the Phase 1 analyst had already caught the expired-line untruth), but its Phase 3 note (tech-lead folded into the implementer, accelerated) asserted "a very long name wraps (`break-words`)" and QA run 1 proved that false twice at 360px. That is the copy rule's cousin: **an Edge Cases claim in a design that nobody verified.** The design's author was also the reader of its Copy section, which is the one place a second reader would have helped.

### B. Phase 3 silently dropped a Phase 1 or Phase 2 requirement (twice)

`2026-09-25-submission-grants`: the issuance rate limit, required by Phases 1 and 2, was absent from the Phase 3 design and found by QA's first pass. `2026-09-28-presbytery-e2e`: the filings page's three denial states, a Phase 2 ruling, were dropped at Phase 3 and found by QA ("a Phase 2 ruling dropped in Phase 3"). Same shape, two pipelines, two weeks apart. Neither was a hard defect (QA found both before merge), but the retrospective-09-25 insight applies unchanged: Phase 5 verifies against the spec, so a requirement missing from the spec is invisible to it unless QA happens to read Phases 1-2. Nothing in the design template maps Phase 1 gaps and Phase 2 rulings to design text (item 4).

### C. Test and gate hygiene found at QA that the implementer's gate should have caught

- `npm run check` failed at QA in two pipelines: person-emails run 1 (`check:secrets` on a fixture literal) and custom-domains F-1 (a work-log line). CLAUDE.md's Phase 4 gate names only `npm run check:audit`; CI runs all eight tripwires. The gate text is one tripwire short of CI (item 3).
- Fixture hygiene: withdraw-publication (browser rehearsal consumed the single seeded publication two required checks needed), online-giving §46l (wall-clock fixtures), person-emails (e2e audit-row independence), statistics-error-mapping (three leaked rows from a crashed RED run). Five pipelines; each an environment-state dependency in a test.
- A known hazard recurred: name-history's deny helpers lacked `grant execute`, reproducing the 0046 B-M1 hazard (tenant path emits `permission denied for function`, not the designed literal). `database-admin.md` has no guidance on it (item 12).
- Phone-viewport defects were found by QA, not the implementer, when the implementer's worktree had no database: invite-copy's Phase 4 notes say "No browser check was possible (no database)", and QA found the two 360px overflows. signin-seed-hint was BLOCKED on stale `node_modules`; designation-revoke needed a scratch-copy recipe because `turbopack.root` spans sibling worktrees. A worktree that cannot run the app cannot satisfy "Verify in a Browser" (item 7).

### D. Environment cost, quantified where I could

1. **Flag-state drift (e2e on a pipeline branch versus CI's fresh database).** CI's first real run (2026-10-23) failed six specs because the suite had been written against `development`, where an operator had switched flags on (`scripts/ci/e2e-baseline-flags.sql` header says so). That file now pins three flags ON. It did not end the class: the person-emails directory spec still met the flag-off page in CI (f4eb04f). The structural cause: `captureFlags()` restores what it *found*, so on a polluted pipeline branch it preserves the drift instead of correcting it, and the branch inherits `development`'s flags plus whatever earlier runs left. QA run 2 recorded two flags still ON after a teardown died. QA's passes on the pipeline branch can therefore certify a spec CI will reject. The 10-23 bring-up cost seven `ci:` commits in one day.
2. **Parallel pipelines attaching to each other's dev servers on :3000.** Playwright's dev lane uses `reuseExistingServer` locally with `baseURL` defaulting to :3000 (`playwright.config.ts`). Documented: Increment 2's QA run 1 discarded a whole e2e run (it could not rule out another QA sharing the server); the person-emails QA aborted a run when `presby-fadir`'s `community-approval` run attached to its :3000 server and wrote through it onto `pipeline-person-emails`; the staff-anchor QA lost runs to the same spec in another worktree sweeping the same fixtures. The production-build lane already forbids this (`PW_PROD_PORT` may not be 3000, `reuseExistingServer: false`, a fingerprint check). The dev lane has no equivalent. Separately, three broad `pkill -f next ...` calls (2026-10-14, 10-15, 10-21) killed servers that were not the caller's.
3. **Neon connection drops inflating QA time.** `fetch failed`/drop mentions in work-logs since 10-14: custom-domains 19, Increment 2 14, person-emails 7, invitations 4 (a count of mentions, not unique incidents). Concrete costs: Increment 2's `roll.test.ts` needed 180 s timeouts and 278 s; online-giving's DB suite took 26 and 54.6 minutes in two runs. **Two documented cases had a local cause:** Increment 2 run 1 and zod 4 both recorded the Mac's disk at 100% (ENOSPC, then `NeonDbError: fetch failed`). I measured today: the data volume is at 98% with 20 GiB free, with a merged pipeline's worktree still on disk (`presby-domains`, PR #33 merged 2026-10-20, 3.1 GB) and a leftover scratch copy (`/private/tmp/presby-fadir-e2e`, 1.5 GB). Other contributors: pipeline branch compute (8e628ae added a 1-4 CU rule to the neon skill), and two suites sharing one branch concurrently (zod). The only connection-drop retry helper, `withDbRetry()`, lives in `e2e/support/domains-ui-fixture.ts`; Playwright's own `retries` is 0 locally.
4. **Semantic merge conflicts between parallel pipelines: three, all caught at merge-up.** PR #43 versus Increment 2 (`e2e/support/community-fixture.ts`: both minted person ids as `prefix + 200 + n`, silently reusable across helpers); PR #43 versus PR #44 (`community-participants.spec.ts` heading strict-mode, once the footer site map added a second "Community" heading); person-emails versus zod (`.uuid()`). None are in Rule 16's shared-file list, which (`TODO.md:217`) is still the old five files. The conflicts live in e2e support and specs, and in a validation idiom.
5. **The commit-and-push-in-one-command block.** I read the gate (`scripts/pre-push-gate.mjs`) rather than a transcript. The hook runs *before* the Bash call executes and compares the marker's HEAD to the current HEAD. A chained `git commit ... && git push` therefore evaluates HEAD before the commit exists: with a stale marker it is refused (a wasted turn after the operator approved), which matches what was reported. But with a marker freshly stamped at the current HEAD, the same chained command **passes the gate and pushes a commit `/pre-push` never checked.** The first is an annoyance; the second is the hole Rule 5 exists to close. The right behaviour for both is the same: refuse any single command that both moves HEAD and pushes (item 9).

### E. Work-log size

The Community log (`2026-10-22-founding-admin-directory.md`) is **5,945 lines**, larger than the lifecycle log (5,228) that the last retrospective said was near the readability limit; it holds Increment 1, Increment 2, Increment 2b's Phases 1-3a, and Increment 3 scoping. Others over 3,000: online-giving 4,643; member-calendar 3,976; submission-grants 3,296. The 36 logs total 56,368 lines. The 10-23 template edit ("Phase 4 stays short") trims implementer text but does nothing for a multi-increment pipeline in one file, where every agent reads from the top. Increment 2b's design (written 2026-10-22) also sits ahead of Phase 4 while migrations 0062-0064 and five releases landed in between: it has already been renumbered once (0064 to 0065) and its readers changed (person emails). A design that waits that long needs its feasibility check re-run (item 4).

---

## The risk-tiered pipeline: ruling requested by `docs/TODO.md:154`

The operator's 2026-10-22 efficiency question asked this retrospective to decide whether low-risk Feature-class work may run an accelerated pipeline. **Recommendation: adopt it, narrowly, and state what it must not drop.** It needs a DECISION and the operator's sign-off because it changes CLAUDE.md's Classification table; I cannot self-approve it. Suggested number: the next free is **DECISION-225** (the orchestrator pre-assigns).

**Evidence.** The mechanism already exists informally: "Accelerated" appears in the work-log template, and invite-copy, staff-anchor, signin-seed-hint and zod 4 ran that way with explicit notation. Sixteen pipelines this period were low-risk by my reading (no migration, no auth/proxy/authz, no permission or flag seed change, no new route or server action, no new `SECURITY DEFINER` function): brand-visual-parity, e2e-red-on-main, org-switcher, platform-radius, lint-gate, directory-ended-memberships, portal-home-alignment, review-polish, signin-seed-hint, admin-back-link, portal-sitemap-footer, community-staff-anchor, invite-accept-copy, zod-4, dependency-advisories, statistics-error-mapping. Five of the 16 (31%) had a first-run QA FAIL, each closed by a second pass dated the same day; three of the five were claims in text or layout (platform-radius's two factual claims; staff-anchor's copy and stale locators; invite-copy's overflow and a missing DB test), the others a behaviour and a coverage gap. None was a permission, schema or auth miss, and those are the classes the tier excludes anyway.

**What the tier saves:** the separate architect spawn and a separate tech-lead spawn (one analyst brief, then a short design).
**What it must keep, with no exemption:** QA, including the Copy check (item 2) and the 360px check; the failing-first regression test; `npm run check`; the Copy section read by someone other than its author (in invite-copy the author of the design was the implementer, and the Edge Cases claim shipped unverified).

Suggested Classification-table row (for the operator's review):

```
| **Accelerated Feature** | A Feature or bug fix that adds no migration or schema change, touches none of `src/auth.ts`, `src/proxy.ts`, `src/lib/authz.ts`, the permission catalog or a flag seed, adds no route, server action, `SECURITY DEFINER` function or dependency. Anything ambiguous is a full Feature. | Analyst brief, then a short tech-lead design with Copy and Edge Cases (architect skipped with explicit notation); Phase 4; a scoped Phase 5 that still runs the copy-truthfulness check and the 360px check; Phase 6. A QA FAIL that traces to a design claim, or any discovery that the change crosses one of the excluded lines, promotes the pipeline to a full Feature at that point. |
```

---

## Overdue-briefings backlog

`scripts/briefings-check.mjs` reports **82 unread entries** and briefings **behind by 57 decisions and 57 feat/fix commits** (covers marker `decision=167 commit=2761de8`). Two corrections to the signal itself:
- The "57 decisions" is `224 - 167`. Only **49** DECISION numbers above 167 exist in `decisions.md` (168-206 and 215-224); 207-214 are reserved or unused. The hook should count distinct recorded numbers (a small edit to `highestDecision()`'s caller).
- The previous catch-up (ca76dd2, 2026-10-15) closed a 6-week gap by hand; this is the same gap reopening in 9 days. **The file has no owner**: CLAUDE.md, the agent files, the skills and the template mention it nowhere, so the SessionStart hook is the only mechanism, and it measures staleness without assigning anyone to fix it (item 14).

**Plan: eleven release-level entries, not 49 decision-level ones** (the operator already has 82 unread; reading load is the cost). Each entry in the file's existing voice, 80-150 words, severity-tagged, pointing at the DECISION range. Group by release:

| Entry (newest first) | Release | DECISIONs | Severity | What the operator needs |
|---|---|---|---|---|
| zod 4 closes the memory advisory | 0.42.2 | 223-224 | decision | no user-visible change; ids go through `z.guid()`; CI `audit-prod` exception removed |
| Several email addresses per person | 0.42.0 | 215-219 | decision | one Main, soft removal, a contact email authenticates nothing; giving stays on the donor record; `0064` before the code |
| Session approval, withdrawal, pending queue | 0.41.0 | 202-206 | decision | pastors count as Session members (DECISION-206, operator-confirmed); six "can't act yet" states; self-approval is a `paper` residual |
| Community menu section and site-map footer | 0.40.0 | 220-222 | decision | "People & Membership" is "Community"; Administration appears only with the hub on and an administer tile |
| Community replaces Members | 0.39.0-0.39.2 | 197-201 | decision / defect | visitors, participants on record; **defect:** staff-anchor invisibility (e4190b4) and the false no-organization copy, both found in production |
| See and end founding-admin and treasurer holders | 0.38.0 | 194-196 | decision | the platform-admin recovery power and its accepted revoke-then-self-invite residual (F170) |
| Invitations (and review polish) | 0.36.0-0.37.1 | 183-193 | decision | token is the sole credential; branded email for every outbound message; Google button; one-digit-per-box 2FA |
| Custom domains, web increment | 0.35.0 | 176-182 | decision | a custom host is a key, not an identity; proof before any provider call; sender registry |
| Online giving | 0.33.1-0.34.0 | 168-175 | decision | Stripe Connect direct charges, no fee; statements are frozen snapshots; the `/give` shadow caught at Phase 6 |
| Dependency advisories (three in five days) | 0.33.1, 0.38.x, 0.42.2 | none | finding | next, sharp, dompurify, zod; CI's audit job is the detector |
| Operator production clean-up 2026-10-22 | n/a | none | finding | out-of-band purge and deactivations, no audit rows, snapshots first (open TODO) |

New covers marker: `<!-- covers: decision=224 commit=5f333eb -->`. Owner for the backlog write-up: the orchestrator, in one `docs(briefings)` commit, since briefings are operator-facing narrative; I can draft the eleven entries from the work-logs and `docs/STATE.md` on request.

---

## Adjacent items for the release slot

- **`test-coverage`**: 15 days overdue today (qa owns it). C-1's closure should have moved its numbers; worth running standalone this slot, as the 2026-07-11 and 2026-09-25 reviews both asked.
- **Monthly health-check bundle** falls due 2026-10-24/25 (`code`, `documentation`, `security`, `agent-instruction`, `dependencies`: last 09-24/09-25). The punch list below is queued behind the `agent-instruction` pass; I recommend landing it now instead (item 1).
- **Housekeeping the orchestrator owns:** remove the merged `presby-domains` worktree (3.1 GB) and its Neon branch per the standing authorization; delete `/private/tmp/presby-fadir-e2e` (1.5 GB); `presby-2b` is the only live parallel worktree.
- **Credential hygiene:** Increment 2 QA run 1 printed pipeline-branch connection strings into its transcript (recommended rotating `pipeline-session-approval` role passwords; the branch should be deleted at cleanup anyway). Item 15 stops the habit.

---

## Punch list — concrete edits (exact text)

Edits to `CLAUDE.md` and agent files need the operator's approval; none were made. Ordered by value.

### 1. Land this list in-session, and audit the last one first
`.claude/agents/tech-lead.md`, Ownership, Retrospective bullet: append

> Open with a landed/not-landed audit of the previous retrospective's punch list (grep for each edit; report the result). Write each edit as exact text in the detail file; with the operator's approval the orchestrator lands them as one `docs(agents)` commit before the review is logged. A punch list parked as one TODO line is not applied (2026-09-25: 0 of 5 agent-file edits landed in 29 days, `docs/TODO.md:212`). The log entry states how many of the previous list landed.

Also apply the carried 2026-09-25 items, each already specified: (b) the retroactive re-check, in item 4 below; (c) and (d), in item 12; (a), in item 10; (e), in item 7. Remove `docs/TODO.md:212` when they land.

### 2. Strengthen the Phase 3 Copy bullet, and write QA's copy check down
`.claude/agents/tech-lead.md`, replace the Copy bullet (the text from "Then read each one..." to the end) with:

> Then check each string, and record the check as one line per string group in the design:
> 1. *Residuals.* It never denies an accepted residual or a Phase 2 ruling (0.25.2; F170).
> 2. *Source of truth.* For every claim about a person, account, date or state, name the query or field that establishes it. A claim the query does not read must be reworded to what is known, or the state split (Community Increment 2: "none has an account" over a count of live seats; fixed by a sixth state, `terms_not_started`).
> 3. *Audience.* For every instruction or promise ("withdraw it", "ask your administrator", "check Roles"), name who sees the string and confirm that role can do it. The surface's default role is the test, not the clerk (an approver-only role was told to withdraw).
> 4. *Neighbours.* Grep the live tree for existing strings about the subject the feature changes (the capability's nouns and verbs: invitation, approve, withdraw, wait, add you) and list each one the feature makes stale, with file:line, as a modify target. The no-organization page promised what v0.37.0's invitations had replaced and the operator found it in production.
>
> A string added after Phase 3, including inside a bug-fix, gets the same four checks before it is written. An implementer who needs a string that is not in this section stops for a ruling.

`.claude/agents/qa.md`: new section after "Run Scope":

> ## Copy truthfulness (every run whose diff adds or changes a user-facing string)
> Read every added or changed string (`git diff -U0 origin/main... | grep '^+'` over `.tsx`, `*-copy.ts`, email templates, release-note lines). For each: (1) it is in the design's Copy table, and one that isn't is a finding whoever wrote it; (2) open the query behind each claim about a person, account, date or state and ask what it does not read; (3) for each instruction, find the role that sees it and prove, from the control's render gate and the action's permission check, that the role can do it; (4) grep for older strings about the same subject the diff makes false. Report a defect as `copy truthfulness: FAIL` with file:line and the viewer's role. A fixed string gets an exact-text test that fails on the old text.

`docs/work-log/_template.md`, Phase 5: add a `## Copy Truthfulness` section (heading only, with those four checks as its checklist); Phase 4: add "Strings added or changed: file:line each".

### 3. Fix the Phase 4 gate to match CI
`CLAUDE.md`, Phase 4 Gate: replace "`npm run check:audit` reports zero violations" with

> `npm run check` reports zero violations (all eight tripwires, the command CI runs; two QA first runs failed on `check:secrets`)

### 4. Phase 3 carry-forward check (traceability, retroactivity, freshness)
`.claude/agents/tech-lead.md`, Technical Design list, add before "Implementer":

> - **Carry-forward** — a table with every Phase 1 gap and every Phase 2 ruling, and for each where this design addresses it or the word *deferred* with who accepted that. A requirement a judgment agent set that the design neither addresses nor defers is a Phase 3 defect (submission-grants: the issuance rate limit; presbytery-e2e: the filings denial states). A rule discovered mid-design applies retroactively: re-check every table, function and string already specified against it before advancing (Ruling B3 and F47-F58). A design whose Phase 4 starts after another pipeline has merged re-runs the feasibility check against the live tree first (Increment 2b was designed 2026-10-22; migrations 0062-0064 and five releases have landed since).
> - **Edge Cases claims** either cite the test that will pin them or say "unverified". (invite-copy: "a very long name wraps" was false at 360px.)

### 5. Phase 6 walks the product as the person the feature creates
`.claude/agents/analyst.md`, Phase 6 (after "Walk every flow you described..."):

> For any feature that changes how an account becomes connected to an organization, how a role is granted, or what a newly-created account can reach, the walk is done as the person that path creates (an accepted-invitation founding administrator, not a seeded fixture), on `development` at 360px: list each page that person lands on and what it shows. SHIP IT requires the walk. (The three 2026-10-23 production escapes were found by the operator doing exactly this walk in production; Increment 2's walk found 1f2fa61.)

### 6. e2e flag state: say it in design, reset it in QA
`.claude/agents/tech-lead.md`, Edge Cases bullet, append after the e2e blast radius sentence:

> Name every feature flag each new or changed e2e spec depends on. The spec sets the flags it needs through `e2e/support/flags.ts`; a key goes into `scripts/ci/e2e-baseline-flags.sql` only when a spec asserts against it and cannot set it. A spec that passes only on a branch whose flags an operator switched on is a defect (CI's first run, 2026-10-23: six specs; then the person-emails directory spec).

`.claude/agents/qa.md`, Run Scope, add a bullet:

> **Flag state.** A pipeline branch inherits `development`'s flags plus whatever earlier runs left, and `captureFlags()` restores what it found, so a polluted branch passes specs CI's fresh database fails. Before the e2e run, reset global flags to the CI baseline (`scripts/ci/e2e-reset-flags.sql`) and say in the verdict that you did.

Implementation (full-stack-developer, Polish class; its own work-log): `scripts/ci/e2e-reset-flags.sql` sets every `feature_flags` row to its `scripts/seed.ts` value, then applies `e2e-baseline-flags.sql`. Not written; this is the spec.

### 7. Parallel pipelines get their own port, fixture range and a working environment
`CLAUDE.md`, Workflow Rule 16, append:

> Pre-assigned at kickoff with the numbers: a dev-server port (`3100 + n`, never 3000) and, for any `e2e/support/*-fixture.ts` helper, a person-id range. Every Playwright, `next dev` or `next start` run in a pipeline sets `E2E_BASE_URL` and starts its own server; a run that attached to :3000 is discarded. Stop a server you started by PID, never `pkill -f next`. The Rule 16 shared-file list also names `e2e/support/*`.

`playwright.config.ts` (implementer: full-stack-developer): mirror the production lane's guard for the dev lane. When `git rev-parse --git-dir` differs from `--git-common-dir` (a linked worktree) and the resolved port is 3000 and `PW_ALLOW_3000` is unset, throw with the message above. Keep `reuseExistingServer` for the main checkout.

`.claude/skills/new-feature/SKILL.md`, kickoff step, add a checklist the orchestrator runs before Phase 4 (this closes 2026-09-25's item (e) for the mechanics that matter):

> Worktree ready before Phase 4: `.env.local` pointing at the pipeline's Neon branch; `node_modules` cloned from the main checkout (then `npm ci` if `package.json` differs); `npm run typecheck` clean; assigned port and fixture range recorded in the work-log header; `df -h /System/Volumes/Data` shows at least 20 GiB free. A worktree that cannot run the app cannot satisfy "Verify in a Browser" (invite-copy shipped Phase 4 unseen at 360px; signin-seed-hint BLOCKED on stale `node_modules`). At cleanup: remove the worktree, its Neon branch and any `/private/tmp/presby-*` scratch copy.

### 8. Connection-drop tax
- Move `withDbRetry()` from `e2e/support/domains-ui-fixture.ts` to `e2e/support/db.ts` and use it in every fixture's setup and teardown (five attempts, 0.5/1/2/4 s, only for `fetch failed`, `Connection terminated`, `ECONNRESET`, timeouts; a constraint error throws at once). Implementer: full-stack-developer.
- `.claude/agents/qa.md`, the "A timeout is not a failure until it repeats" bullet, append: "Check `df -h /System/Volumes/Data` before blaming Neon: ENOSPC preceded `fetch failed` twice this period."

### 9. Split commit from push, and harden the hook
`CLAUDE.md`, Workflow Rule 5, append:

> Commit and push are two separate Bash calls with `/pre-push` between them: commit, `/pre-push` (stamps HEAD), push. A chained `git commit ... && git push` is refused: the hook reads HEAD before the commit exists.

`scripts/pre-push-gate.mjs` (implementer: full-stack-developer, with a test): in `hook()`, after `commandContainsGitPush(command)`, also refuse when the same command contains a `git commit`, `merge`, `rebase`, `cherry-pick` or `am` segment, exit 2 with "BLOCKED (Workflow Rule 5): this command moves HEAD and pushes in one call. Commit first, run /pre-push, then push in a separate call." This closes the hole where a chained command passes on a marker stamped at the pre-commit HEAD.

### 10. `Discovered-In` definitions (carried item (a), widened)
`CLAUDE.md`, Commit Message Standards, after the two trailer lists:

> `Discovered-In: production` means the deployed production environment: an operator or member using the live app. It does not mean an operator watching a dev server (that is `agent-review` or `human-review` with the phase that missed it), a dependency advisory found by CI (`Caught-By: automated-test`, `Discovered-In: post-merge`), or a semantic conflict found when merging `main` into a pipeline branch (`post-merge`).

### 11. One work-log per shipped increment
`CLAUDE.md`, Per-Feature Tracking, append:

> A pipeline that ships in increments gets one work-log per shipped increment, named `YYYY-MM-DD-<slug>-incN`; the parent keeps the shared Phase 1-2 and a table linking the children. (The Community log reached 5,945 lines across Increments 1, 2, 2b and 3.) Judgment-agent text stays verbatim in the child it belongs to.

### 12. database-admin and QA test-shape rules (carried items (c), (d), plus the grant hazard)
`.claude/agents/database-admin.md`, self-verification:

> - Before naming Phase 4 complete on a new CHECK, EXCLUDE or trigger, restate its logic in English and confirm the restatement, not the SQL, matches the design (`publications_withdrawal_shape`'s inverted boolean).
> - Every helper a `SECURITY DEFINER` function or trigger calls, and every `deny` helper a tenant path reaches, is tested as `presby_app`: the test asserts the designed refusal literal, not `permission denied for function ...` (0046 B-M1; again in 0053's deny helpers, QA first pass 2026-09-26).

`.claude/agents/qa.md`, Test Style:

> A regression test that encodes the fix's own logic (a literal prefix list, a specific column set) rather than the property the fix guarantees (spec conformance, a closed threat class) guards less than it looks. Ask what a slightly different bypass in the same class would do before accepting it.

### 13. Decide the risk tier
Operator: accept, amend or decline the Classification row above and its DECISION. If accepted, also update `docs/work-log/_template.md`'s "Pipeline mode" line to name it.

### 14. Give the briefings an owner
`.claude/skills/release-notes/SKILL.md`, after Step 5 (Bump the Version):

> ## Step 6: Operator briefing
> Append one entry to `docs/briefings.md` for this release (severity-tagged, 80-150 words, the DECISION range it records, anything the operator must know that the release notes do not say), then move the `covers:` marker to the release's highest DECISION and the release commit. This step is part of the same housekeeping cluster as Rules 10, 14 and 15.

`scripts/briefings-check.mjs`: count distinct recorded DECISION numbers above the marker, not `max - marker`. Execute the eleven-entry backlog plan above once, in one commit.

### 15. Never echo environment values
`.claude/agents/qa.md` and `.claude/skills/neon-postgres/SKILL.md`: add "Verify that an env var is set with `test -n "$VAR"` or by length. Never `echo` or print a connection string, token or password, including in a verification step (Increment 2 QA run 1)."

---

## Verdict

The pipeline caught 61% of its own fixes before merge, 36 of 36 trailered, and the largest structural gap the last retrospective named (no CI for DB and e2e) is closed. What moved against us is narrower and more fixable than the previous period's: a quarter of the fixes are untrue words, found at the two latest gates because Phase 3's copy check covers one of four ways copy goes wrong and QA's copy check exists only as a habit; and the first real use of a new kind of account produced three production escapes in a day because nobody walked the product as that account first. The environment is a quiet second tax (flag drift between pipeline branches and CI, servers shared across worktrees, a full disk read as Neon drops, a push gate with a chained-command hole), each with a small mechanical fix above. Last of all, **the retrospective's own output did not execute**: zero of the previous five agent-file edits landed, because they were parked in a TODO line behind a review that hadn't run. If this list lands the same way, the next retrospective will report the same two findings. Do the edits now, in one commit, with the operator's approval.
