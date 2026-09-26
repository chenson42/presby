# `isFlagEnabled()` no longer fails closed — a build with an unreachable database crashes — Work Log

> **Slug:** `2026-09-26-flags-fail-closed`
> **Surface:** `src/lib/flags.ts` (platform helper) and whatever static-rendered page calls it at build time
> **Permission(s):** none
> **Flag(s):** not needed (this IS the flag helper)
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant
> **Workflow Rule 16 kickoff (orchestrator, 2026-09-26):** shares worktree `../presby-wt-lint` and git branch `pipeline/lint-gate` with `2026-09-26-lint-gate` (both exist to make CI green again; one PR), as its own work-log and its own `fix(flags):` commit. No Neon branch — `.env.local` is `development`, read-only. No migration; `DECISION-149`/`150` are taken; none expected. Shared aggregator files are not edited on the branch.
> **The bug (found by the lint pipeline's Phase 4, 2026-09-26):** `npm run build` crashes when `DATABASE_URL` is unreachable — exactly CI's placeholder env (`postgres://ci:ci@localhost:5432/ci`) — because `src/lib/flags.ts`'s `isFlagEnabled()` no longer catches the query error. CLAUDE.md's Permissions vs Flags invariant states the contract: `isFlagEnabled()` returns `false` on a missing row **or a DB error** (fail closed for a toggle; the auth-critical flags go through named fail-open wrappers in `src/lib/auth/`). The implementer confirmed by `git stash` that the crash predates the lint pipeline and, via `gh run view` on the last green CI run (`2bbb8a5`, 2026-08-22), that Build used to succeed with the identical fake `DATABASE_URL` — a regression introduced after 2026-08-22 and hidden for four weeks by the Lint step blocking Build in CI.
> **The fix:** restore the catch in `isFlagEnabled()` (and audit the sibling helpers in the same file for the same contract), with a failing-then-passing regression test that a thrown query resolves to `false` and never throws; confirm the auth-critical wrappers in `src/lib/auth/` still fail OPEN as DECISION-026 requires (they must not inherit a silent `false`); confirm `npm run build` with CI's placeholder `DATABASE_URL` succeeds. `git log -S "catch" -- src/lib/flags.ts` / `git log --since=2026-08-22 -- src/lib/flags.ts` locates the commit that dropped it — name it and why.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete — bug reproduced at build and unit level; the naive fix would silently disable 2FA enforcement during a DB blip via `computeEffectiveTwoFactor()` | READY WITH NOTES | 2026-09-26 |
| 2 — Architectural review | architect | Complete — contract ruled doc-authoritative; `computeEffectiveTwoFactor()` correction required in the same change; `force-dynamic` ruled in (layout + two route handlers); the catch must log the key only | Approved with suggestions | 2026-09-26 |
| 3 — Technical design | tech-lead | Complete — brief bug-fix design, both fixes as one `fix(flags):` change, `force-dynamic` file list corrected per Ruling 3, e2e gate scoped | Design complete, implementer named | 2026-09-26 |
| 4 — Implementation | api-developer | Complete | — | 2026-09-26 |
| 5 — Verification | qa | Complete — both regressions reproduced failing-first in isolation (incl. the Ruling-2 hazard); CI-placeholder build green against a control that reproduces the crash; auth e2e 16/16 on a real server with the MFA fixture, zero skips; five non-blocking findings | PASS | 2026-09-26 |
| 6 — Shipped vs intent | analyst | Complete — shipped as v0.26.1 | see section | 2026-09-26 |

---

# Phase 1 — Functional Refinement (analyst)

*Bug-fix variant, brief; recorded verbatim by the orchestrator, 2026-09-26.*

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> The bug is real and the proposed fix direction is correct, but applied as scoped in the kickoff block it would silently ship a second, more dangerous regression in the `auth.require_2fa` path — and the work-log's causal story ("a commit dropped the catch") is wrong and should be corrected before it lands in a commit body.

## Bug Confirmation

**(a) Unit-level repro — confirmed, and already latent in the codebase.** `src/lib/flags.ts`'s `isFlagEnabled()` has no try/catch around `db.query.featureFlags.findFirst()`, so a rejected query rejects the returned promise. I didn't need to write a new failing test to prove this — `src/lib/flags.test.ts:83-95` **already contains one**, and it currently passes:

```
it("propagates a DB error thrown by findFirst", async () => {
  findFirst.mockRejectedValue(new Error("DB connection refused"));
  await expect(isFlagEnabled("error-flag")).rejects.toThrow("DB connection refused");
});
```

Ran it (`npx vitest run src/lib/flags.test.ts`): 7/7 pass. This test **encodes the bug as the intended contract**. Restoring the catch will make this specific assertion fail — Phase 4 must invert it (assert `resolves.toBe(false)`), not leave it in place alongside a new, contradictory test.

**(b) Build-time caller — reproduced directly, not inferred.** I copied the worktree (rsync, excluding `.git`/`.next`/`node_modules`; symlinked `node_modules`) to a scratch location outside `presby-wt-lint` and ran `npm run build` with CI's exact env (`DATABASE_URL=postgres://ci:ci@localhost:5432/ci`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_TOTP_ENCRYPTION_KEY` — copied verbatim from `.github/workflows/ci.yml:29-34`). It crashed exactly as reported:

```
Error occurred prerendering page "/site/-/sitemap.xml".
Error: Failed query: select ... from "feature_flags" ... where "key" = $1
  at async (src/lib/flags.ts:20:15)
  at async (src/lib/sites.ts:348:9)
  at async a (src/app/(public)/site/[slug]/sitemap.xml/route.ts:26:18)
```

`src/app/(public)/site/[slug]/sitemap.xml/route.ts` is a Route Handler under a dynamic `[slug]` segment with no `generateStaticParams` and no `export const dynamic`. Next.js speculatively pre-renders it once at build time with a placeholder param (`"-"`) to decide whether it *can* be static, before falling back to dynamic. That trial invocation runs the real code path — `getPublishedSite()` → `isFlagEnabled("sites.public_render")` — against the real (unreachable) `DATABASE_URL`. Because nothing catches the rejection, Next treats it as a hard build error and aborts (`exiting the build`), not as the ordinary "this route needs to be dynamic" bailout signal.

The same pattern exists, unexercised only because Next stopped at the first failure, in `src/app/(public)/site/[slug]/[[...path]]/page.tsx` and `src/app/(public)/site/[slug]/assets/[key]/route.ts` — both call `getPublishedSite()`/`isFlagEnabled()` the same way, under the same dynamic segment, with no `dynamic` export either. Fixing the one shared helper (`flags.ts`) fixes all three; no per-route patch is needed for the crash itself.

**Should the build be calling the database at all here?** The page's own docstring (`sites.ts:336-343`) says every non-`ok` outcome — including a DB blip — must collapse to `{ kind: "not_found" }`, "never a 500." That's a *runtime* design decision already made and is correct; the build-time trial with a placeholder slug is just Next.js's own mechanism finding the same gap earlier than a real user would have. So: **the missing catch is the real bug**, not "a page that shouldn't touch the DB." Restoring it fixes production too (today, in production, a real DB blip during a `/site/*` request would 500, not 404, contradicting the page's own documented contract) — the build crash is a symptom, not the whole disease. Separately, worth a Phase 3 suggestion: `export const dynamic = "force-dynamic"` on these three `(public)/site/[slug]/*` surfaces would stop Next's speculative placeholder-param trial from touching the DB at build at all — cheap defense-in-depth against the *next* unrelated bug in this call chain, not a substitute for the catch.

**(c) Other exported helpers in `flags.ts` — none.** `isFlagEnabled` is the file's only export. Nothing else to audit.

**(d) Auth-critical wrappers fail OPEN and are unaffected — true for one, FALSE for the other. This is the finding that matters most:**

- `isLocalLoginEnabled()` (`src/lib/auth/local-login.ts:31-41`) — unaffected. It runs its own inline query + its own `try/catch`, never calling the shared `isFlagEnabled` at all. Restoring the catch in `flags.ts` changes nothing here.
- `computeEffectiveTwoFactor()` (`src/lib/auth/local-login.ts:86-103`) — **affected, and not safely.** Line 98 calls the bare `isFlagEnabled(REQUIRE_2FA_FLAG)` directly — which is itself already a quiet violation of CLAUDE.md's "Auth-critical flags... go through named fail-open wrappers... **never through the bare helper**" — and only behaves correctly *today* by accident: `isFlagEnabled` currently throws, and `computeEffectiveTwoFactor`'s own `catch` block converts that throw into the documented fail-safe (`return required` — i.e., during a DB blip, keep 2FA enforced if it was already required). Once `isFlagEnabled`'s catch is restored, it will no longer throw — it will resolve to `false`. `computeEffectiveTwoFactor`'s `try` will then **succeed** with `false`, its `catch` block will never fire, and the function will return `false` — taking the "master switch disabled" branch instead of the "DB error, preserve requirement" branch. **Net effect: a real production DB blip during sign-in would silently disable 2FA enforcement for a user who already required it**, exactly the outcome DECISION-026 exists to prevent, shipped as a side effect of a fix framed as purely defensive.
  - This is invisible to the existing test suite: `src/lib/auth/local-login.test.ts:33-35` mocks `@/lib/flags` at the module boundary (`vi.mock("@/lib/flags", () => ({ isFlagEnabled: vi.fn() }))`), so the test at line 131 (`"rawRequired = true, isFlagEnabled throws → rawRequired"`) will keep passing forever regardless of what the *real* `isFlagEnabled` implementation does — it tests `computeEffectiveTwoFactor`'s reaction to a hypothetical throw, not whether the real composed system ever produces one. This is a seam-mocking gap, not a bug in the test's own logic.
  - **Recommended fix scope for Phase 3:** give `computeEffectiveTwoFactor`'s `auth.require_2fa` read its own inline query + catch (matching the pattern `organizationRequiresTwoFactor` right above it already uses), so it stops depending on `isFlagEnabled`'s internal error handling entirely — bringing it into actual compliance with "never through the bare helper," not just apparent compliance. This should ship in the *same* change as the `flags.ts` fix, not as a follow-up, since the `flags.ts` fix is what triggers the regression.

## Permissions & Flags

- **Permission(s):** none.
- **Flag(s):** N/A — `flags.ts` is the mechanism, not a gated feature. Contract per CLAUDE.md → Permissions vs Flags: `isFlagEnabled()` must return `false` on a missing row **or a DB error**. Currently violated (throws on DB error).

## Gaps the Request Didn't Address

- **The kickoff's causal narrative is wrong and should not go into the fix commit's body as written.** `git log -S "catch" -- src/lib/flags.ts` returns nothing, and `git log --follow -- src/lib/flags.ts` shows exactly one commit ever: `54f3935` ("feat(schema): implement Phase 0/1 domain schema and developer page", 2026-08-17). The file was written *without* a catch on day one — there is no commit that "dropped" it. What actually changed after the 2026-08-22 green build is that a **new caller** was added: `src/app/(public)/site/[slug]/sitemap.xml/route.ts` was created in commit `7129fdf` ("fix(sites): public-site parity batch — SEO surfaces, embed CSP, page fixes"), dated **2026-08-25** — squarely inside the window the CI comment itself names ("2026-08-26 to 2026-09-25... Lint sat third"). So: the defect is five weeks older than the kickoff block implies; what's four weeks old is a *new code path reaching* a pre-existing gap, not the gap itself. `Discovered-In: post-merge` is right; the commit body should name `7129fdf` (the exposing commit) rather than imply a since-reverted catch.
- **No log line on the swallowed-error path.** Once fixed, a real production DB outage will make `isFlagEnabled()` — and therefore every flag it gates — silently resolve `false` platform-wide, with zero signal to an operator. This matches the existing sibling pattern (`isLocalLoginEnabled` also logs nothing), so it's not a new problem this fix introduces, but it's worth a follow-up: a flag silently going dark install-wide during an incident is exactly the kind of thing that should page someone, not just degrade quietly.
- **Acceptance criterion sufficiency.** `npm run build` under CI's placeholder `DATABASE_URL` is a **necessary but not sufficient** gate. It proves the crash is gone; it does not prove `isFlagEnabled` resolves specifically to `false` (versus, say, `undefined` or some other falsy-adjacent value that happens not to throw), and it does not exercise the `computeEffectiveTwoFactor` composition at all — that route isn't reachable from any build-time trial. Both the corrected `flags.test.ts` assertion and a new unmocked-seam test on `computeEffectiveTwoFactor` are required alongside the build check, not instead of it.

## Regression Test Shape (for Phase 4)

1. `src/lib/flags.test.ts` — **invert**, don't append to, the existing "propagates a DB error" test: mock `findFirst` to reject, assert `await isFlagEnabled(...)` **resolves to `false`** and does not throw.
2. `src/lib/auth/local-login.test.ts` — add a case for `computeEffectiveTwoFactor` that mocks `@/lib/db` (not `@/lib/flags`) to reject on the `auth.require_2fa` read, and asserts the function still returns `true` when `rawRequired` was `true`. This is the test that would have caught the regression above; the current suite cannot, because it mocks past the real implementation.
3. `npm run build` with CI's placeholder env, run as acceptance evidence (I've already produced a clean repro externally; QA should re-run it against the fixed branch, not just trust the description).

## Out of Scope (confirm with user)

- Auditing every other `isFlagEnabled` call site across the app for the same accidental-safety-via-throw pattern `computeEffectiveTwoFactor` has. I checked the full auth-wrapper surface (`src/lib/auth/*.ts`) and found only this one instance; a codebase-wide grep of every non-auth call site is bigger than this bug-fix warrants and better suited to the next `security` health-check review.
- Adding `export const dynamic = "force-dynamic"` to the three `(public)/site/[slug]/*` surfaces — named above as a good defense-in-depth suggestion, not required for this fix, and touches routing behavior the architect should weigh in on rather than have decided in a bug-fix Phase 1.

## Open Questions

- Should Phase 3 fix `computeEffectiveTwoFactor` in the same commit as `flags.ts` (my recommendation — the regression only exists because of the `flags.ts` change, so splitting them risks landing the vulnerable window as its own commit), or does tech-lead want it as an immediately-following, separately-reviewable commit in the same PR?

---

## Handoff

**Do not skip Phase 2 for this one.** The bug-fix variant table allows skipping the architect when a fix "doesn't touch invariants" — this one does: it sits directly on DECISION-026 (Permissions vs Flags, fail-open contract) and, as scoped, risks silently inverting that invariant's guarantee for `auth.require_2fa`. Route to **architect** next, specifically to rule on whether `computeEffectiveTwoFactor`'s bare-helper call must be corrected in this same change (my recommendation) or is acceptable as a tracked follow-up — then to **tech-lead** for the brief design covering both fixes, naming **api-developer** (no client/UI surface) as implementer.



### Orchestrator notes (2026-09-26)

- The kickoff's "a commit dropped the catch" narrative is superseded: `flags.ts` never had a catch (`54f3935`, 2026-08-17); the exposing commit is `7129fdf` (2026-08-25, the sitemap route). The fix commit body cites that.
- Phase 2 runs (DECISION-026 is in play); the `computeEffectiveTwoFactor()` correction ships in the same change as the `flags.ts` catch, per the analyst's recommendation, unless the architect rules otherwise.

---


# Phase 2 — Architectural Review (architect)

*Recorded verbatim by the orchestrator, 2026-09-26.*

## Verdict

**Approved with suggestions** — the shape the orchestrator note settled on (catch in `flags.ts` + `computeEffectiveTwoFactor()` correction, one change) is correct and is ratified. Four rulings below are **required** for Phase 3 to honor; the rest are suggestions. Nothing here sends the work back to Phase 1.

## Placement

- **Directory placement:** no new files, no new module, no route-group change. `src/lib/flags.ts` (the catch), `src/lib/flags.test.ts` (invert), `src/lib/auth/local-login.ts` (inline `auth.require_2fa` read), `src/lib/auth/local-login.test.ts` (re-seat the mock), and — per Ruling 3 — three route-segment-config exports under `src/app/(public)/site/[slug]/`. All correctly placed; `src/lib/auth/` is exactly where DECISION-026 says an auth flag read lives.
- **Server vs Client split:** no `'use client'` anywhere in this change. `export const dynamic` is route-segment config in server files, not React work.
- **Dependencies:** none new, and none warranted — in particular, do not reach for a logging library for Ruling 4. `console.error` is the tree's existing instrument.
- **Schema / RLS / grants:** untouched. Review step 5 (live Neon catalog read) is N/A for this pipeline.

## Ruling 1 — The contract: the documentation is authoritative; the code and the test are the defect

**The doc always said fail-closed and the code never matched.** Not "CLAUDE.md later contradicted a deliberate starter contract":

- `src/lib/flags.ts` has had no `try/catch` since it was first written. `git show 54f3935:src/lib/flags.ts` is byte-identical to today's file, and upstream `/Users/cshenso/git/claudecode/src/lib/flags.ts` (starter, last touched `b733089`, born `090a88d`) is the same code with the same gap.
- **`docs/decisions.md:1332` — DECISION-026 itself, dated 2026-07-01, inherited in the seed commit — already states the fail-closed semantics** as the *premise* of the wrapper pattern: "it returns `false` on a missing row **or DB error**." I verified this text is present at `54f3935`, i.e. it predates presby. `CLAUDE.md:514` restates it. The design intent is a year old and unambiguous.
- `src/lib/flags.test.ts:86-94` ("propagates a DB error thrown by findFirst") arrived in the *same commit as the untested-for-intent implementation* and describes what the code does, not what anyone decided. That is a characterization test, not a contract.

**The call-site census settles the alternative shape.** ~95 `isFlagEnabled()` call sites across `src/`; **zero** wrap it in a `catch`. One of them documents its reliance on the stated behaviour in a comment — `src/app/(auth)/signin/page.tsx:54-57`: *"`isFlagEnabled()`'s 'false on missing row or DB error' default is already the safe direction."* A design where every caller catches is not the design this codebase follows, was never going to be, and would be ~95 opportunities to forget. **The shared helper is the one place the catch belongs.**

Required: the catch goes **inside** the `cache()`-wrapped function body (so the failure is deduped per render pass like the success is), and `flags.test.ts:86` is **inverted in place** — renamed, asserting `resolves.toBe(false)` strictly (`toBe`, not `toBeFalsy`; the analyst's point that the build check cannot distinguish `false` from `undefined`), not left standing next to a contradicting new case.

Suggestion, not required: the gap is still live upstream. `docs/starter-contributions/` candidate at the next `/downstream-sync`.

## Ruling 2 — `computeEffectiveTwoFactor()` must stop reading through the bare helper, in the same change. Required.

Ratified, and on a stronger footing than the CLAUDE.md sentence alone. Note first that **CLAUDE.md and DECISION-026 currently conflict** on this flag: `CLAUDE.md:516-518` says both auth flags go through "named fail-open wrappers… never through the bare helper," while `docs/decisions.md:1359` says `auth.require_2fa` is explicitly *not* auth-critical and `:1372` says the bare helper "is correct" for it. Both are partly right, and the resolution is mechanical rather than doctrinal:

**Once the shared helper collapses a DB error into `false`, `false` is ambiguous — and `computeEffectiveTwoFactor()` is the only caller in the tree whose documented behaviour depends on telling those two apart.** Its own docstring (`src/lib/auth/local-login.ts:80-83`) promises three outcomes, "flag OFF → false" and "DB error → the resolved requirement" among them. After Ruling 1 the `catch` at `:99` is dead code and the two outcomes merge into the wrong one. That is not a wrapper-doctrine point; it is an information-loss point, and it is why this cannot be a follow-up.

Required shape: an inline read + `catch` in `src/lib/auth/local-login.ts`, mirroring `organizationRequiresTwoFactor()` directly above it, and **remove the `@/lib/flags` import from the file entirely** — that makes "no auth-critical flag reads through the bare helper" grep-verifiable rather than a reading exercise. The encoding is Phase 3's call; the required property is that the error path is distinguishable from the off path *at the point of decision*. A module-private tri-state (`"on" | "off" | "unknown"`) is the honest shape; a plain `boolean` with `catch { return true }` also works but only because the caller has already established `required === true`, and that subtlety must be in the comment if tech-lead takes it.

**Rejected alternative:** exporting a tri-state variant from `flags.ts` for callers that need to distinguish. That creates a second mechanism in the one file whose whole job is to have one shape, and invites non-auth callers into it. DECISION-026's convention — a *named* helper in `src/lib/auth/`, with its own catch and its own rationale comment in its own body — is right and already has a working sibling in the same file.

**The test mock: yes, replace it. Required.** After this change `local-login.ts` does not import `@/lib/flags` at all, so `vi.mock("@/lib/flags", …)` at `src/lib/auth/local-login.test.ts:33-35` becomes a mock of a dependency the module no longer has — the five `computeEffectiveTwoFactor` cases at `:104-151` would either break or pass vacuously, which is the worse outcome. Drive `@/lib/db`'s `findFirst` (rejects / `enabled: true` / `enabled: false` / missing row) alongside the existing `execute` mock for the org arm. The case at `:131` becomes the real regression test the analyst asked for: `findFirst` rejects, `rawRequired = true`, expect `true`.

## Ruling 3 — `export const dynamic = "force-dynamic"` on the public-site surfaces: **IN**, with a correction to the file list

Ruled in, as defense in depth, in this pipeline. Three reasons:

1. **The catch alone leaves the build passing by coincidence.** `getPublishedSite()` makes the flag read its *first* DB touch (`src/lib/sites.ts:348`), so a false return short-circuits before `db.execute(sql'select * from presby_published_site(…)')` at `:352` and the blob resolve at `:358` — **neither of which is caught**. The build survives only because the first of three uncaught-ish reads happens to be the one we just fixed. Reorder or memoize that flag read and the placeholder-param trial reaches an uncaught query and CI breaks again. `force-dynamic` removes the *trial*, which is the actual class of defect.
2. **It costs nothing today.** No `revalidate`, no `generateStaticParams`, and the only other `dynamic` export in the whole app is `src/app/api/webhooks/resend/route.ts:36`. These routes read a flag plus a per-request DB function; they were never going to prerender.
3. **No interaction with P2's static home page.** Segment config is per-route, and `src/app/page.tsx` already calls `auth()` (cookies) — it is request-dynamic regardless of anything here. **No interaction with DECISION-047 either:** `<BrandTokens>` stays in the same two layouts and `scripts/check-brand-scope.mjs` greps for the emitter, not the rendering mode.

**Correction to the analyst's file list — this matters, or the fix half-lands.** Route handlers do not inherit a layout's segment config; only the page tree does. So:

- `src/app/(public)/site/[slug]/layout.tsx` — covers itself and `[[...path]]/page.tsx` (the layout is a *fourth* caller of `getPublishedSite()`, at `:55`, which Phase 1's "three surfaces" missed).
- `src/app/(public)/site/[slug]/sitemap.xml/route.ts` — its own export.
- `src/app/(public)/site/[slug]/assets/[key]/route.ts` — its own export.

Putting it on `page.tsx` too is harmless and arguably clearer; putting it *only* there is wrong. One-line comment at each export naming the placeholder-param prerender trial, so the next reader doesn't optimize it away.

## Ruling 4 — The catch logs. Required.

`isLocalLoginEnabled()`'s silence is not a precedent to copy; it is a second gap in the same file. One `console.error` in the new catch, and one in the `auth.require_2fa` catch.

Constraints, all required:

- **The flag key and a stable prefix only. Never the error object.** Neon/Drizzle's message embeds the failed SQL (`Failed query: select … where "key" = $1` — visible in the analyst's own repro at work-log line 57) and, depending on the driver path, bound parameters. A flag key is harmless; the habit is not, and this repo is public with a `check:secrets` posture that exists for exactly this reflex. Shape: `console.error("[flags] isFlagEnabled read failed; treating as disabled", { key })`. `err.name` or a driver `code` is acceptable; `err.message` is not.
- **Volume is bounded and acceptable.** Inside `cache()`, one line per key per render pass in RSC; the heaviest page in the tree reads ~15 flags, and every one of them is immediately followed by the page's own DB reads failing anyway.
- **State the divergence in the comment.** This one fails *closed* platform-wide and goes dark silently; that is what makes the log load-bearing.

Suggestion (not required, same file, one line): give `isLocalLoginEnabled()`'s catch the same log. A flag that fails *open* during an outage is by construction invisible — nothing looks broken — which is the stronger argument for a log, not a weaker one.

## Invariants Touched

- **DECISION-026 — preserved for both flags, and finally made true for one.** `isLocalLoginEnabled()` keeps its `catch → true` untouched. `auth.require_2fa` gains the inline read that makes its documented DB-error branch reachable. Requires a correction note on the decision (text below) — **the decision's own premise sentence is the thing that was never true of the code.**
- **Permissions vs Flags (DECISION-003) — untouched.** No permission logic moves; the change is entirely inside the flag mechanism. No flag starts granting access; no permission starts staging a rollout.
- **The Edge gate cannot reach the database — untouched, and must stay so.** `src/proxy.ts` imports `@/lib/auth/config` and `@/lib/permissions` and nothing else (verified). Nothing in this change may introduce `@/lib/flags` or `@/lib/auth/local-login` into that graph; the new helper stays in `local-login.ts`, whose header already carries the Node-only design constraint.
- **DECISION-147 (uniform SASR failure) — preserved and slightly strengthened.** `submitStatisticsGrant()` (`src/lib/statistics-grants.ts:548`) already routes flag-off to the uniform `{ kind: "invalid" }` with a deliberate decoy lookup; with the catch, a DB blip now takes that same uniform branch instead of throwing a distinguishable 500.
- **No new dependency, no new top-level module, no route-group change.** Nothing that would need a new architectural decision beyond the correction note.

## Notes (Phase 3 must honor)

1. **The auth e2e gate fires on this "two-line bug fix." This is the largest under-scoping risk in the pipeline.** The change edits `src/lib/auth/local-login.ts`, which is imported by `src/auth.ts:32` and `src/app/(auth)/signin/actions.ts:9`. CLAUDE.md's Phase 4 gate requires a running-server e2e smoke covering the full login path **including an MFA-enrolled user** before Phase 5 begins, and Phase 5 says a deferred e2e is `BLOCKED`, never `PASS`. Budget it in the design; do not let the fix's apparent size argue it away.
2. **Answering the analyst's Open Question: one commit, both files.** Splitting leaves a commit in history in which a DB blip silently disables 2FA enforcement — small window, real exposure, and a bisect that lands there is misleading. One `fix(flags):` commit (one prefix — the `force-dynamic` exports are part of the same defense, not a separate feature), body naming `7129fdf` as the exposing commit rather than the superseded "a commit dropped the catch" story.
3. **Narrow `sites.ts:336-344`'s docstring in this pipeline.** It claims every non-`ok` outcome "collapses to `{ kind: "not_found" }`, never a 500." After this fix that is true of the flag read and still **false** of `db.execute` at `:352` and the blob resolve at `:358`. Either narrow the sentence or wrap those reads — I recommend narrowing here and tracking the wrap in `docs/TODO.md` at integration, because wrapping is a behaviour change on the public render path and deserves its own scoping. Corollary for Phase 6: **do not claim "production `/site/*` now 404s instead of 500s on any DB blip."** Only the flag-read blip is covered.
4. **Scope boundary, with one name handed forward.** Do not sweep the other ~95 call sites. I did the direction check so the next security review doesn't start from "grep everything": every flag in the tree is gate-shaped (`false` = less exposed) **except `org_features.category_axis`** (`src/lib/org-features.ts:140` and `:211`), where `false` *skips* the category AND-gate and is therefore the more permissive direction. No live exposure — the surrounding `withOrgContext` transaction fails in the same outage, and the permission check still applies — but it is the one instance worth naming in the next `security` health-check.
5. **Workflow Rule 16.** No `docs/TODO.md`, `docs/decisions.md`, or `docs/STATE.md` edits on `pipeline/lint-gate`. The correction text below goes back to the orchestrator for integration.

## Proposed correction note — appended to DECISION-026 (no new number)

Repo convention is an in-place `**Correction (date, role, work-log):**` paragraph on the affected entry, and DECISION-026's "Standard `isFlagEnabled()` semantics (unchanged)" section is precisely the text that needs to become true. If the orchestrator prefers a standalone entry instead, the next free number is **DECISION-151** (149/150 are pre-assigned to the concurrent pipelines).

> **Correction (2026-09-26, architect Phase 2, `docs/work-log/2026-09-26-flags-fail-closed.md`):** this decision's premise sentence — that `isFlagEnabled()` "returns `false` on a missing row **or DB error**" — was never true of the code. `src/lib/flags.ts` has had no `try/catch` since it was written (starter `090a88d`, presby `54f3935`), and `src/lib/flags.test.ts`'s "propagates a DB error thrown by findFirst" case canonized the gap as if it were a contract. **The documentation is authoritative and the code is the defect:** the catch is restored in the shared helper — ~95 call sites, none of which catch, one of which (`src/app/(auth)/signin/page.tsx:54`) documents its reliance on the stated behaviour — and the characterization test is inverted rather than supplemented. Read the "Standard `isFlagEnabled()` semantics (unchanged)" section above as "missing row **or DB error** → `false`," and the catch now logs the key (never the error object, whose message embeds the failed query text). Two consequences. **(1)** `auth.require_2fa` can no longer read through the bare helper. This decision's classification is still right that the flag is not *fail-open* — a blip must not impose a challenge on someone who never enrolled — but once a DB error is indistinguishable from `false`, `computeEffectiveTwoFactor()`'s documented "DB error → the resolved requirement" branch becomes unreachable and a blip would silently *drop* enforcement for a user who already required it. The read moves to an inline query + `catch` in `src/lib/auth/local-login.ts`, beside `organizationRequiresTwoFactor()`, and the file stops importing `@/lib/flags` so the rule is grep-verifiable. The classification rule is amended accordingly: **an auth flag needs its own read and its own catch whenever its DB-error outcome differs from its `false` outcome** — which covers both flags, for different reasons (`auth.local_login`: error → `true`; `auth.require_2fa`: error → the already-resolved requirement). **(2)** The same gap is still present upstream in `chenson42/claudecode-nextjs-starter` (`src/lib/flags.ts`, unchanged since `090a88d`); a `docs/starter-contributions/` candidate at the next `/downstream-sync`.

## Proposed CLAUDE.md sentence (replaces the "never through the bare helper" sentence at `CLAUDE.md:516-518`)

`CLAUDE.md:514`'s contract sentence is already correct and becomes true when the code lands — leave it alone. The following sentence calls both wrappers "fail-open," which teaches the wrong direction for `auth.require_2fa`:

> Auth-critical flags (`auth.local_login`, `auth.require_2fa`) go through named helpers in `src/lib/auth/` that do their own read and their own `catch`, never through the bare helper — `auth.local_login` fails **open** (a DB blip must not lock everyone out of sign-in), `auth.require_2fa` fails to **the already-resolved requirement** (a DB blip must not silently drop enforcement, and must not impose a challenge on someone who never enrolled). Neither behaviour is expressible once the shared helper has collapsed a DB error into `false` (DECISION-026).

## Implementer

**api-developer** — confirmed. No client or UI surface; the `force-dynamic` exports are route-segment config in server files.

---

## Handoff

Next agent: **tech-lead (Phase 3)** — brief bug-fix design covering both fixes as one change, the `force-dynamic` placement corrected per Ruling 3 (layout + two route handlers, not three leaves), the log shape from Ruling 4, and an explicit line in the plan for the **auth e2e smoke with an MFA-enrolled user**, which QA will otherwise have to raise as `BLOCKED`. Naming **api-developer** as implementer.



---

# Phase 3 — Technical Design (tech-lead)

*Bug-fix variant, brief. One `fix(flags):` change closes the build crash and, in
the same commit, the DECISION-026 regression Phase 1/2 found waiting behind it
— per the analyst's recommendation and the architect's Ruling 2/Note 2, these
do not split.*

## Summary

`isFlagEnabled()` (`src/lib/flags.ts:19-24`) has never caught a query
rejection — not a regression, a defect present since the file was written
(starter `090a88d`, presby `54f3935`, 2026-08-17) and canonized by a
characterization test (`src/lib/flags.test.ts:86-94`) that asserted the throw
as if it were the contract. It stayed unreachable at build time until commit
`7129fdf` (2026-08-25) added `src/app/(public)/site/[slug]/sitemap.xml/route.ts`,
a Route Handler under a dynamic `[slug]` segment with no `generateStaticParams`
or `dynamic` export; Next's placeholder-param build-time prerender trial runs
`getPublishedSite()` → `isFlagEnabled("sites.public_render")` against a real
(in CI, unreachable) `DATABASE_URL`, and a bare rejection aborts the build. The
gap sat undiscovered for four weeks because the sibling pipeline's Lint-first
CI ordering blocked the Build job from ever running against it. CLAUDE.md and
DECISION-026 both already state the intended contract — missing row **or** DB
error → `false` — so the fix restores code to a doc that was always right
(Ruling 1); the commit body corrects the kickoff's superseded "a commit dropped
the catch" narrative and names `7129fdf` as the exposing commit instead.

Fixing the shared helper alone is not safe: `computeEffectiveTwoFactor()`
(`src/lib/auth/local-login.ts:86-103`) only reaches its documented "DB error →
the resolved requirement" branch today because `isFlagEnabled()` throws; once
it resolves `false` instead, a real production DB blip during sign-in would
silently *drop* 2FA enforcement for an already-required user — the exact
outcome DECISION-026 exists to prevent. Both fixes ship as one commit.

## Root Cause

- `src/lib/flags.ts`'s `isFlagEnabled()` has no `try/catch` around
  `db.query.featureFlags.findFirst()`. Never has — `git show
  54f3935:src/lib/flags.ts` is byte-identical to `HEAD`, and upstream
  `claudecode-nextjs-starter` (`090a88d`) carries the identical gap today.
- `docs/decisions.md` (DECISION-026, dated 2026-07-01, inherited at seed) and
  `CLAUDE.md`'s Permissions vs Flags section both already state "missing row
  or a DB error → `false`" as the premise the auth wrappers sit on top of. The
  code never matched the doc — that is the defect this fix corrects, not a doc
  catching up to intentional code.
- `src/lib/flags.test.ts:86-94` ("propagates a DB error thrown by findFirst")
  was written against the actual (wrong) behavior in the same commit and reads
  as a contract it never was.
- The gap became build-reachable via `7129fdf` (2026-08-25), which added the
  sitemap route — not via any change to `flags.ts` itself.
- The Lint-first CI ordering hid a would-have-failed Build for four weeks;
  that ordering is the sibling `2026-09-26-lint-gate` pipeline's fix, not this
  one's.

## Permissions & Flags

- Permission(s): none — no route or action gains or loses a `hasFeature()`
  check in this change.
- Flag(s): `isFlagEnabled()` is itself the mechanism under repair, not a new
  gated feature. Corrected contract (CLAUDE.md → Permissions vs Flags,
  DECISION-026): "returns `false` on a missing row **or** a DB error." No flag
  key changes; no new flag introduced.

## API Contract

Not applicable — no new route or server action. One call-site behavior
change: `isFlagEnabled(key: string): Promise<boolean>` no longer rejects; it
resolves `false` on any `findFirst` error, same as it already does for a
missing or disabled row. `computeEffectiveTwoFactor(rawRequired: boolean,
userId?: string): Promise<boolean>` keeps its existing signature — only its
internal `auth.require_2fa` read changes shape, from a delegated
`isFlagEnabled()` call to an inline query + local catch.

## Data Model

No schema changes required.

## Component / Page Plan

- Pages to create: none.
- Components to create: none.
- Files to modify:
  - `src/lib/flags.ts`
  - `src/lib/flags.test.ts`
  - `src/lib/auth/local-login.ts`
  - `src/lib/auth/local-login.test.ts`
  - `src/lib/sites.ts` (docstring only, `:336-344`)
  - `src/app/(public)/site/[slug]/layout.tsx`
  - `src/app/(public)/site/[slug]/sitemap.xml/route.ts`
  - `src/app/(public)/site/[slug]/assets/[key]/route.ts`

## Implementation Order

1. `src/lib/flags.ts` — move `db.query.featureFlags.findFirst()` inside a
   `try`; `catch` returns `false` and logs
   `console.error("[flags] isFlagEnabled read failed; treating as disabled", { key })`
   — the flag key and a stable prefix only, **never** `err` or `err.message`
   (Neon/Drizzle embeds the failed SQL text in the error message; this repo's
   `check:secrets` posture exists for exactly this reflex). The `try/catch`
   stays **inside** the `cache()`-wrapped body so a failure dedupes per render
   pass identically to a success. One-line comment above the catch noting this
   fails *closed* platform-wide and goes dark silently — that is what makes
   the log load-bearing (Ruling 4).
2. `src/lib/flags.test.ts:86-94` — invert in place, do not add a case beside
   it: rename the test, mock `findFirst` to reject, assert
   `await expect(isFlagEnabled("error-flag")).resolves.toBe(false)` — `toBe`,
   not `toBeFalsy` (distinguishes `false` from `undefined`/other
   falsy-adjacent values a looser assertion would let through unnoticed).
3. `src/lib/auth/local-login.ts`:
   - Remove `import { isFlagEnabled } from "@/lib/flags";` entirely — this is
     what makes "no auth-critical flag read goes through the bare helper"
     grep-verifiable rather than a reading exercise (Ruling 2).
   - `computeEffectiveTwoFactor()`'s `auth.require_2fa` read becomes an inline
     `db.query.featureFlags.findFirst({ where: eq(featureFlags.key, REQUIRE_2FA_FLAG) })`
     in its own `try/catch`, placed immediately beside
     `organizationRequiresTwoFactor()` — same file, same pattern: direct
     query, local catch, no delegation to a shared helper.
   - **Ruling: boolean-with-comment, not a tri-state.**
     `organizationRequiresTwoFactor()` immediately above is already this shape
     (plain `boolean`, `catch { return false; }`, a comment explaining why the
     caller's context makes the collapse safe), and DECISION-026's
     rejected-alternative language (no second mechanism in `flags.ts` for
     callers needing three states) argues for consistency over introducing a
     `"on" | "off" | "unknown"` union that would be the only tri-state value
     in the auth module. Ruling 2's required property — the error path
     distinguishable from the off path *at the point of decision* — is met
     because the `catch` sits inline in `computeEffectiveTwoFactor()` itself,
     not behind a boolean return that erased the distinction one level down:
     `try` returns `row?.enabled ?? false` (on / off / missing-row all
     collapse to a real flag reading); `catch { return required; }` returns
     the already-resolved requirement, not a flag value. Comment directly
     above the block, verbatim intent: *"row missing or found → the flag's
     boolean; DB error → `required` (the already-resolved value, not a flag
     read) — collapsing these into one boolean is safe here only because the
     caller's two outcomes are produced by two different code paths (try vs
     catch), not by two different values of one path."*
   - Update the docstring above `computeEffectiveTwoFactor()` (`:70-85`): the
     three-outcome table stays accurate, only the "delegates to
     `isFlagEnabled`" mechanism sentence changes to describe the inline read.
4. `src/lib/auth/local-login.test.ts`:
   - Remove `vi.mock("@/lib/flags", ...)` (`:33-35`) and the `isFlagEnabled`
     import (`:39`) — the module under test no longer has this dependency.
   - The existing `@/lib/db` mock's `findFirst` (already mocked for
     `isLocalLoginEnabled`, `:19-30`) now also serves
     `computeEffectiveTwoFactor`'s new inline read — set it per-case, not
     assumed global, since the two helpers can be exercised independently.
   - The five `computeEffectiveTwoFactor` cases (`:104-151`) are re-driven off
     `findFirst` (rejects / `{ enabled: true }` / `{ enabled: false }` /
     `undefined`) instead of `mockIsFlagEnabled`. The case at `:131`
     ("isFlagEnabled throws → rawRequired") becomes the load-bearing
     regression test: `findFirst` rejects, `rawRequired = true`, expect
     `true` — the test the analyst's Phase 1 identified as impossible to
     write against the old seam-mocked version, and the one that would have
     caught this defect.
   - The six per-congregation-arm cases (`:162-215`) get the same
     `findFirst`-driven treatment wherever they reference `mockIsFlagEnabled`;
     `mockExecute` (the `organizationRequiresTwoFactor` mock) is untouched.
5. Route-segment config — one export + one-line comment each, naming the
   placeholder-param prerender trial so a later reader doesn't optimize it
   away (Ruling 3's corrected file list — route handlers do not inherit a
   layout's segment config, so all three need their own export):
   - `src/app/(public)/site/[slug]/layout.tsx` — covers itself and
     `[[...path]]/page.tsx` (the fourth, Phase-1-missed caller of
     `getPublishedSite()`, at `:53`).
   - `src/app/(public)/site/[slug]/sitemap.xml/route.ts`
   - `src/app/(public)/site/[slug]/assets/[key]/route.ts` — calls
     `resolvePublishedOrganization()`, not `getPublishedSite()` directly, but
     shares the same flag-read-then-DB-call shape and the same missing static
     params; included per Ruling 3's explicit list.

   `export const dynamic = "force-dynamic"; // stops Next's build-time placeholder-param prerender trial (params.slug = "-") from reaching a live flag/DB read here at all — docs/work-log/2026-09-26-flags-fail-closed.md Phase 2 Ruling 3`
6. `src/lib/sites.ts:336-344` — narrow the `getPublishedSite()` docstring.
   Today it claims every non-`ok` outcome "collapses to `{ kind: "not_found" }`,
   never a 500." After this fix that is true of the flag read at `:348`; it
   remains **false** of `db.execute` at `:352` and the blob resolve at `:358`
   — neither is touched by this pipeline. Reword to name the flag read
   specifically as the covered case; do not claim broader coverage than what
   ships. The `db.execute`/blob-resolve wrap is a TODO at integration (see
   Integration Notes), not built here — it is a behavior change on the public
   render path (DB blip: 500 → 404) that deserves its own scoping per the
   architect's Note 3.
7. No `FEATURE_CATALOG` entry, no seed binding, no audit event — nothing here
   is permission- or feature-gated, and no security-sensitive mutation is
   introduced (a read-path fix, not a write).
8. One commit: `fix(flags): restore fail-closed on DB error and stop
   computeEffectiveTwoFactor() reading the bare helper` (final wording at
   commit time), body naming `7129fdf` as the exposing commit,
   `Caught-By: agent-review` (the implementer ran the CI-placeholder-env
   build as a non-mandatory check; CI itself never reached Build),
   `Discovered-In: post-merge`, `Work-Log: 2026-09-26-flags-fail-closed`.

## Phase 4 Exit Gate — Acceptance Criteria

- `npm run typecheck` and the two touched unit suites
  (`src/lib/flags.test.ts`, `src/lib/auth/local-login.test.ts`) green.
- `npm run build` succeeds using CI's placeholder `DATABASE_URL`
  (`postgres://ci:ci@localhost:5432/ci`, plus `AUTH_SECRET`/`AUTH_URL`/
  `AUTH_TOTP_ENCRYPTION_KEY` from `.github/workflows/ci.yml:29-34`), run from a
  copy of the tree **outside this repo** (rsync excluding
  `.git`/`.next`/`node_modules`, symlinked `node_modules` — the analyst's
  Phase 1 repro method) so the worktree's own `.next` and real `.env.local`
  are never disturbed. Necessary, not sufficient — see Edge Cases below.
- **The auth e2e gate fires.** `src/lib/auth/local-login.ts` is imported by
  `src/auth.ts:32` and `src/app/(auth)/signin/actions.ts:9`, so CLAUDE.md's
  Phase 4 gate (any change touching `src/lib/auth/` needs a running-server
  smoke of the full login path, including an MFA-enrolled user, before Phase 5)
  applies regardless of how small this diff looks. Implementer runs
  `e2e/totp-full-login.spec.ts`, `e2e/totp-callback-bypass.spec.ts`, and
  `e2e/admin-login.spec.ts` against a dev server on port **3400**, using this
  worktree's own `.env.local` (`development` Neon branch — acceptable, the
  e2e globalSetup has written fixture users to `development` all week).
  Results go in the Phase 4 section for QA to **re-run**, not merely cite — a
  deferred or skipped e2e check is `BLOCKED` at Phase 5, never `PASS`.
- No `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, or `CLAUDE.md`
  edits land on this branch (Workflow Rule 16) — those are the orchestrator's,
  at merge; see Integration Notes below.

## Edge Cases & Risks

- **A passing build is not sufficient evidence the fix is complete**
  (Ruling 3, reason 1): `getPublishedSite()`'s flag read is the *first* DB
  touch, so the build already survives on the flag-catch alone even without
  `force-dynamic` — a coincidence of read order, not proof `:352`/`:358` are
  safe. `force-dynamic` removes the build-time trial entirely; do not treat
  the build passing as license to skip it.
- **The `catch { return required; }` shape in `computeEffectiveTwoFactor()`
  reads like a bug on a future pass.** The required comment (Implementation
  Order step 3) must survive review — without it, a future edit
  "simplifying" the catch to mirror `organizationRequiresTwoFactor()`'s
  `catch { return false; }` verbatim would silently reintroduce the
  fail-open-in-the-wrong-direction defect Ruling 2 closes.
- **Mock reuse in `local-login.test.ts`**: `findFirst` now serves two call
  sites (`isLocalLoginEnabled` and `computeEffectiveTwoFactor`). No current
  test exercises both in one case, so this needs no special handling today —
  flagged so Phase 4 doesn't assume one mock value covers both if a future
  test adds a combined case.
- **`isLocalLoginEnabled()`'s new log line changes no return value**, only
  adds a `console.error` on its existing `catch`. Confirm no test asserts
  `console.error` was *not* called — spot-checked `local-login.test.ts`
  already; none do.
- **e2e blast radius — existing specs whose behavior this change could alter,
  not just new coverage to add:**
  - `e2e/totp-full-login.spec.ts` — walks credentials → `/totp` → verified
    session for `mfa-enrolled`; exercises `computeEffectiveTwoFactor()` end to
    end on the on/off branches, which this fix does not change. Must still
    pass unchanged.
  - `e2e/totp-callback-bypass.spec.ts` — exercises the 2FA-gate-at-the-Edge
    path driven by the same JWT callback.
  - `e2e/admin-login.spec.ts` — the un-enrolled `mfa-admin` fixture's
    redirect-to-enrol path; `rawRequired` true, flag read now inline.
  - `e2e/post-login-routing.spec.ts` and `e2e/role-boundaries.spec.ts` — both
    documented (in `totp-full-login.spec.ts`'s own header comment) as using
    `mfa-admin`'s un-enrolled path; same `computeEffectiveTwoFactor()` call
    graph, in the blast radius by import graph though no behavior change is
    expected.
  - No `flags.test.ts` assertion besides the one being inverted at `:86-94`
    is expected to change.
  - No public-site e2e spec exists to name today (`grep -rl "site/\[slug\]"
    e2e/` returns nothing) — the `force-dynamic` change has no e2e coverage;
    that surface's own pipeline (`2026-08-20-public-sites.md`) owns it, and
    this pipeline should not be treated as needing to backfill it.

## Out of Scope (confirm with user)

- Sweeping the ~95 other `isFlagEnabled()` call sites for the same
  accidental-safety-via-throw pattern (architect's Note 4) — deferred to the
  next `security` health-check, starting from `org_features.category_axis`
  (`src/lib/org-features.ts:140`, `:211`), the one direction-reversed
  instance already named.
- Wrapping `db.execute` (`sites.ts:352`) and the blob resolve (`sites.ts:358`)
  in their own catches — a behavior change on the public render path (DB
  blip: 500 → 404) that deserves its own scoping and pipeline (architect's
  Note 3). Tracked in `docs/TODO.md` at integration, not built here.
- The Lint-first CI ordering that hid this bug for four weeks — owned by the
  sibling `2026-09-26-lint-gate` pipeline sharing this worktree/branch.
- Adding a log line to every other silent `catch` in the auth module beyond
  `isLocalLoginEnabled()` and the new `auth.require_2fa` read — scoped to
  exactly the two the architect named in Ruling 4.

## Integration Notes (orchestrator, at merge — Workflow Rule 16; nothing here lands on this branch)

- **DECISION-026 correction note** — adopt the architect's Phase 2 text
  verbatim, appended in place on the existing entry in `docs/decisions.md`.
- **CLAUDE.md sentence replacement** — adopt the architect's Phase 2 text
  verbatim, replacing the "never through the bare helper" sentence (currently
  `CLAUDE.md:516-518`).
- **`docs/TODO.md` additions:**
  - Wrap `src/lib/sites.ts:352` (`db.execute`) and `:358` (blob resolve) in
    the same fail-closed-to-`not_found` discipline the function's own
    docstring claims for the whole function today but, after this fix, is
    only true of the flag read.
  - Next `security` health-check: audit `org_features.category_axis`
    (`src/lib/org-features.ts:140`, `:211`) — the one `isFlagEnabled()` call
    site in the tree where `false` is the *more* permissive direction.
  - `docs/starter-contributions/` candidate for the next `/downstream-sync`:
    `src/lib/flags.ts`'s missing catch is unchanged upstream
    (`claudecode-nextjs-starter`, `090a88d`).

## Implementer

**api-developer.** No client or UI surface touched; every file is a server
module, a test file, or route-segment config.

---

# Phase 4 — Implementation

**Date:** 2026-09-26
**Implementer:** api-developer

## Files Created

- none

## Files Modified

- `src/lib/flags.ts` — `isFlagEnabled()`'s `db.query.featureFlags.findFirst()`
  call moved inside a `try`, still within the `cache()`-wrapped body per
  Ruling 1. `catch` returns `false` and logs
  `console.error("[flags] isFlagEnabled read failed; treating as disabled", { key })`
  — the flag key and a stable prefix only, never the error object (its
  message embeds the failed SQL text). Comment above the catch states the
  divergence (fails closed, platform-wide, silently) per Ruling 4.
- `src/lib/flags.test.ts` — the "propagates a DB error thrown by findFirst"
  test at the old `:86-94` is renamed and inverted in place (not appended
  beside): `await expect(isFlagEnabled(...)).resolves.toBe(false)` (`toBe`,
  not `toBeFalsy`). Added one new test asserting the log line's serialized
  args contain neither `err`/`err.message` text nor the word "select" —
  guards Ruling 4's "never log the error object" constraint directly, not
  just by convention.
- `src/lib/auth/local-login.ts` — `import { isFlagEnabled } from "@/lib/flags"`
  removed entirely (Ruling 2, grep-verifiable). `computeEffectiveTwoFactor()`'s
  `auth.require_2fa` read is now an inline
  `db.query.featureFlags.findFirst({ where: eq(featureFlags.key, REQUIRE_2FA_FLAG) })`
  in its own `try/catch`, placed immediately after
  `organizationRequiresTwoFactor()`, matching that function's pattern
  (direct query, local catch, no delegation). Boolean-with-comment shape per
  tech-lead's ruling, not a tri-state: `try` returns `row?.enabled ?? false`;
  `catch` returns `required` (the already-resolved value, not a flag read),
  logging `console.error("[local-login] auth.require_2fa read failed; preserving resolved requirement", { key, errorName })`
  — `err.name`, never `err.message`. The required comment (verbatim intent
  from Phase 3) sits directly above the block warning against "simplifying"
  the catch to `catch { return false; }`, which would silently reintroduce
  the regression. Docstring above `computeEffectiveTwoFactor()` updated to
  describe the inline read instead of delegation to `isFlagEnabled()`.
- `src/lib/auth/local-login.test.ts` — `vi.mock("@/lib/flags", ...)` and the
  `isFlagEnabled` import removed; the module under test no longer has this
  dependency. All `computeEffectiveTwoFactor` cases (both describe blocks,
  11 cases total) re-driven off the existing `@/lib/db` `findFirst` mock via
  a new `requireTwoFactorFlagRow(enabled)` helper, alongside the pre-existing
  `mockExecute`/`orgRequires()` helper for the org arm. The case at the old
  `:131` — `findFirst` rejects, `rawRequired = true` — is now named
  "…(regression for isFlagEnabled fail-closed change)" and is the real
  composed regression test: it exercises the actual `@/lib/db` failure path
  through both `flags.ts` and `local-login.ts` rather than a mocked
  `@/lib/flags` seam.
- `src/lib/sites.ts:336-344` — `getPublishedSite()`'s docstring narrowed.
  Previously claimed every non-`ok` outcome collapses to `not_found`, "never
  a 500." Now states that is true of the flag read (`isFlagEnabled`, fail-closed
  on a DB error per DECISION-026 as of this work-log) and explicitly
  **not yet** true of `db.execute` (`:352`) or the blob resolve (`:358`),
  which still throw uncaught on a DB blip — tracked in `docs/TODO.md` at
  integration per Phase 3 Integration Notes, not built here.
- `src/app/(public)/site/[slug]/layout.tsx` — added
  `export const dynamic = "force-dynamic";` with the one-line comment naming
  the placeholder-param prerender trial and this work-log, per Ruling 3
  (covers itself and the nested `page.tsx`, since route handlers don't
  inherit a layout's segment config).
- `src/app/(public)/site/[slug]/sitemap.xml/route.ts` — same
  `export const dynamic = "force-dynamic";` + comment, its own export.
- `src/app/(public)/site/[slug]/assets/[key]/route.ts` — same
  `export const dynamic = "force-dynamic";` + comment, its own export.

## Schema Changes

- none.

## Audit Events

- none — read-path fix, no security-sensitive mutation introduced.

## Failing-First Evidence

Verified with `git stash push -- <file>` / `git stash pop` in place, so each
inversion was watched failing against the pre-fix code before being watched
passing against the fixed code — not just written and immediately run green.

1. **`src/lib/flags.test.ts`** — stashed `src/lib/flags.ts` (restoring the
   original no-catch implementation), ran the suite: both new/inverted cases
   failed —
   `resolves to false ... — fail-closed contract` failed with
   `AssertionError: promise rejected "Error: DB connection refused" instead
   of resolving`, and the log-line test failed by letting the real
   `"Failed query: ..."` error propagate uncaught. Popped the stash
   (restoring the fix): `8 passed (8)`.
2. **`src/lib/auth/local-login.test.ts`, the composed `:131` regression case**
   — with `flags.ts` already fixed but `src/lib/auth/local-login.ts` stashed
   back to its pre-fix delegation to the (now-fixed) shared `isFlagEnabled()`,
   ran the suite: exactly the predicted regression reproduced —
   `rawRequired = true, auth.require_2fa read throws → rawRequired` failed
   with `expected false to be true`, because the old `computeEffectiveTwoFactor`
   no longer threw (the fixed `isFlagEnabled()` swallowed the DB error and
   resolved `false`), so its own `try` succeeded with `false` and its `catch`
   never fired — the exact mechanism Ruling 2 predicted, reproduced
   empirically rather than only argued. The stderr line
   `[flags] isFlagEnabled read failed; treating as disabled { key: 'auth.require_2fa' }`
   confirms the fixed `flags.ts` catch fired and is what fed the wrong branch.
   Popped the stash (restoring the fix): `16 passed (16)`.

This is the concrete demonstration that the two fixes must ship together —
`flags.ts` alone reintroduces the DECISION-026 regression Phase 1/2 predicted,
observed directly rather than only reasoned about.

## Unit Test Results (full suite, this worktree)

- `npm run typecheck` — clean, zero errors.
- `npm test` (`vitest run`) — `255 test files passed | 32 skipped (287)`,
  `3314 tests passed | 833 skipped (4147)`. No regressions outside the two
  touched suites.
- `npm run lint` — clean, `--max-warnings=0` satisfied.
- `npm run check` (all five tripwires: `check:audit`, `check:sql-date`,
  `check:deps-drift`, `check:brand-scope`, `check:secrets`) — all five pass.

## Auth E2E Gate (Phase 4 gate, mandatory)

`src/lib/auth/local-login.ts` is imported by `src/auth.ts:32` and
`src/app/(auth)/signin/actions.ts:9`, so the gate fires per CLAUDE.md
regardless of diff size.

- Started `npm run dev` (`next dev`, Turbopack) on port **3400** using this
  worktree's own `.env.local` (`development` Neon branch). Confirmed listener
  via `lsof -iTCP:3400 -sTCP:LISTEN` before running tests.
- `E2E_BASE_URL=http://localhost:3400 npx playwright test
  e2e/totp-full-login.spec.ts e2e/totp-callback-bypass.spec.ts
  e2e/admin-login.spec.ts` — globalSetup provisioned 8 fixture users
  including `admin-2fa-enrolled@presby.invalid` (the `mfa-enrolled`
  storageState) and 4 organizations.
- **Result: 12/12 passed, 28.4s.** Full breakdown:
  - `admin-login.spec.ts` — 4/4 passed (seeded admin reaches dashboard;
    landing-page sign-out swap; every admin subpage opens without a runtime
    error; 2FA policy page renders correctly).
  - `totp-callback-bypass.spec.ts` — 7/7 passed (the `/admin` and `/o/*`
    callback-bypass regressions, the no-callbackUrl control path, the
    non-2FA direct-landing path, and three hostile-callbackUrl forms —
    backslash, embedded-tab, dot-segment).
  - `totp-full-login.spec.ts` — 1/1 passed: **email+password → `/totp` → a
    wrong code rejected → the real code signs in**, exercising
    `computeEffectiveTwoFactor()` end-to-end against the fixed code on the
    `mfa-enrolled` fixture, exactly the "before/after loop-back" comparison
    Phase 3's Edge Cases section called out (this spec's behavior is
    unchanged by design; unchanged is the correct outcome).
- Stopped the dev server by PID (`lsof` → `kill <pid>`, both the `next dev`
  parent and the Turbopack child listener), confirmed port 3400 free via a
  second `lsof` call returning nothing. No `pkill -f` used.

## Acceptance: Production Build with CI's Placeholder Env

- Followed the Phase 3 gate: rsync'd the worktree (excluding
  `.git`/`.next`/`node_modules`) to a location **outside** this repo/worktree,
  ran `npm run build` with `DATABASE_URL=postgres://ci:ci@localhost:5432/ci`,
  `AUTH_SECRET=ci-secret-do-not-use-in-prod`, `AUTH_URL=http://localhost:3000`,
  `AUTH_TOTP_ENCRYPTION_KEY=AAAA...AAA=` (verbatim from
  `.github/workflows/ci.yml:31-34` in this worktree).
- **Deviation, noted for QA and the orchestrator:** the first attempt placed
  the scratch copy under `/private/tmp/.../scratchpad` with a **symlinked**
  `node_modules`, exactly as the Phase 1 analyst's repro did. That symlink
  crossed Turbopack's inferred project root (this repo's own
  `next.config.ts` sets `turbopack.root` to the repo's parent directory, a
  deliberate, committed setting for the `presby-site-kit` npm-link case —
  see the config's own comment) and Turbopack refused it outright:
  `TurbopackInternalError: Symlink [...]/node_modules is invalid, it points
  out of the filesystem root`. Moving the scratch copy to a sibling directory
  of this worktree (`~/git/presby-platform/scratch-build-flags-check`, still
  outside the repo/worktree and still git-untracked — `~/git/presby-platform`
  itself is not a git repository) kept the symlink target inside the inferred
  root, but surfaced a second, unrelated Turbopack quirk:
  `next/font/google queries have exactly one entry` /
  `Can't resolve '@vercel/turbopack-next/internal/font/google/font'` on
  `src/lib/brand/fonts.ts`'s Open Sans import — reproducible with network
  connectivity confirmed fine (`curl` to `fonts.googleapis.com` returned
  `200`), so not a connectivity issue. Replacing the symlink with a real
  (hardlinked, same-filesystem, ~16s) copy of `node_modules`
  (`cp -al .../node_modules scratch/node_modules`) made the font error
  disappear entirely — this is a Turbopack-plus-symlinked-`node_modules`
  interaction, not a defect in this fix, and not present in real CI (which
  runs `npm ci`, never a symlink). **Recommendation for the sibling
  `2026-09-26-lint-gate` pipeline and any future placeholder-env build
  check:** use a hardlinked/copied `node_modules`, not a symlink, when the
  scratch copy sits inside the inferred Turbopack root; a symlink outside it
  fails outright, and (this pipeline's finding) a symlink inside it can also
  produce a spurious, unrelated font-resolution error that a real `npm ci`
  in CI will not hit.
- With the corrected setup: `npm run build` completed with **exit code 0**.
  Output shows a clean Turbopack compile (`✓ Compiled successfully in
  687ms`), typecheck pass, static generation `(40/40)`, and the full route
  manifest including `ƒ /site/[slug]/[[...path]]`, `ƒ /site/[slug]/assets/[key]`,
  and **`ƒ /site/-/sitemap.xml`** (the exact route whose build-time
  placeholder-param trial crashed the build before this fix) all rendering
  as dynamic, not statically prerendered — confirming both the `flags.ts`
  catch and the three `force-dynamic` exports are doing their jobs. Zero
  occurrences of the word "Error" in the full build log. Ran the build a
  second time from scratch (`rm -rf .next` first) to confirm the result
  wasn't an artifact of partial caching; identical clean result both times.
- Scratch copy removed after verification
  (`rm -rf ~/git/presby-platform/scratch-build-flags-check`); this worktree's
  own `.next` and `.env.local` were never touched by the acceptance build.

## Implementer Notes

- No design deviations beyond the build-check-method finding above (symlink
  vs hardlink for `node_modules` in the external scratch copy) — every file
  in Phase 3's "Component / Page Plan" list was touched and no file outside
  it was touched (verified via `git status --short` filtered against the
  sibling `2026-09-26-lint-gate` pipeline's already-in-flight changes in this
  shared worktree; none of those pre-existing modifications were altered).
- `computeEffectiveTwoFactor()`'s new inline catch logs `err.name` (not
  `err.message`), matching Ruling 4's "err.name or a driver code is
  acceptable" allowance — the driver's `code` property is not reliably
  present on every rejection path exercised in tests, so `err.name` is the
  more robust of the two acceptable choices here.
- Confirmed no test in either touched suite asserts `console.error` was
  *not* called (Phase 3's flagged risk) — both new log-line-emitting paths
  are covered by the new assertions instead, and no existing test broke.
- Did not touch `isLocalLoginEnabled()`'s catch — Ruling 4's log-line
  requirement was scoped to the two catches architect named (the new
  `flags.ts` catch and the new `auth.require_2fa` catch); the suggestion to
  also log `isLocalLoginEnabled()`'s fail-open catch was explicitly marked
  "not required" and left for a follow-up, per Phase 3's Out of Scope list.
- No `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, or `CLAUDE.md`
  edits made on this branch, per Workflow Rule 16 and Phase 3's Integration
  Notes — those land at merge, at the orchestrator's hand, using the
  architect's and tech-lead's verbatim text already recorded in Phase 2/3
  above.

## Handoff

Next agent: **qa (Phase 5)**. Re-run, don't just cite: `npm run typecheck`,
`npm test`, `npm run lint`, `npm run check`, the three-spec auth e2e gate on
port 3400 against this worktree's `.env.local`, and the CI-placeholder-env
production build from an external copy — use a **hardlinked**, not
symlinked, `node_modules` in that copy (see the Acceptance section's
deviation note above; a symlink either fails outright or surfaces an
unrelated Turbopack font-resolution error depending on where the copy sits
relative to this repo's committed `turbopack.root` setting in
`next.config.ts`). A read-only QA agent is concurrently verifying the
sibling `2026-09-26-lint-gate` work in this same worktree; this pipeline
touched only the 8 files listed above.

---

# Phase 5 — Verification (qa)

*Recorded verbatim by the orchestrator, 2026-09-26.*

**Date:** 2026-09-26
**Verified by:** qa (read-only; no file in the worktree was modified — `src/lib/flags.ts` and `src/lib/auth/local-login.ts` hash-checked identical before and after, `git status --short` unchanged from session start)

## Type Check

`npm run typecheck`: **PASS** — `tsc --noEmit`, zero errors, exit 0.

## Unit Tests

**Default invocation** (`npm test`) — Total: 4149 | Passed: 3316 | Failed: 0 | Skipped: 833 | Duration: 12.8s (255 files passed, 32 skipped of 287).

A skipped spec is not a passing spec, so I did **not** accept the 32 skipped files. They are the documented DB-backed subset (`docs/testing.md:149-158`), and I ran them the documented way:

**DB-backed invocation** (`npx dotenv -e .env.local -- npx vitest run --no-file-parallelism`) — Total: 4149 | Passed: 4146 | Failed: 3 | **Skipped: 0** | Duration: 385.8s.

Failures — all three in one file, all unrelated to this diff:

- `src/lib/rate-limit.test.ts:279` — `expected +0 to be 10000` (plus two siblings in the same suite).
- **Root cause isolated, not assumed:** `.env.local:25` sets `RATE_LIMIT_DISABLED=true` (required by the e2e `globalSetup`), and `src/lib/rate-limit.ts:190` short-circuits on it, so the in-memory store never fills. Proven by differential run: with `.env.local` loaded → `3 failed | 12 passed`; same command with `env -u RATE_LIMIT_DISABLED` → `15 passed`. `rate-limit.ts` is not in this pipeline's diff. **Not a regression; a pre-existing coupling between `.env.local` and the documented DB-backed invocation.** Named as a finding below.

**Targeted suites** (`src/lib/flags.test.ts`, `src/lib/auth/local-login.test.ts`): 24/24 passed, 0 skipped.

### Failing-first, independently reproduced (not cited)

I did not stash in the shared worktree — a full-stack-developer is concurrently editing branding files there. Instead I built an isolated copy (`src/` + `package.json`/`vitest.config.ts`/`tsconfig.json`, symlinked `node_modules`) and swapped in `git show HEAD:<file>` versions. Restores were verified byte-exact by SHA-256.

1. **`flags.ts` pre-fix (no catch), test file as shipped** → `2 failed | 6 passed (8)`:
   - `resolves to false (never rejects) when findFirst throws — fail-closed contract, DECISION-026` → `AssertionError: promise rejected "Error: DB connection refused" instead of resolving`
   - `logs the flag key on a DB error, never the error object` → failed (error propagated uncaught)
2. **Ruling-2 hazard, reproduced exactly as Phase 1/2 predicted** — `flags.ts` **fixed**, `local-login.ts` reverted to the pre-fix bare-helper delegation (`git show HEAD:…` line 98 = `return await isFlagEnabled(REQUIRE_2FA_FLAG);`):
   ```
   FAIL  src/lib/auth/local-login.test.ts:149
   AssertionError: expected false to be true // Object.is equality
   stderr: [flags] isFlagEnabled read failed; treating as disabled { key: 'auth.require_2fa' }
   ```
   `1 failed | 15 passed`. The stderr line is the proof of mechanism: the fixed shared helper swallowed the DB error, `computeEffectiveTwoFactor`'s `try` succeeded with `false`, its `catch` never fired, and 2FA enforcement was silently dropped for an already-required user. Restoring the shipped `local-login.ts` (SHA `2440b341…` on both sides) → `16 passed (16)`. **The two fixes genuinely cannot ship apart.**

## End-to-End Tests

Real dev server, `npx dotenv -e .env.local -- npx next dev -p 3400` (worktree `.env.local`, `development` Neon branch), readiness confirmed via `lsof -iTCP:3400 -sTCP:LISTEN` before the run and stopped afterwards by PID (parent `next dev` 33968 + listener 33969; no `pkill -f`; port confirmed free).

`E2E_BASE_URL=http://localhost:3400 npx playwright test e2e/totp-full-login.spec.ts e2e/totp-callback-bypass.spec.ts e2e/admin-login.spec.ts e2e/branded-signin.spec.ts`

**Total: 16 | Passed: 16 | Failed: 0 | Skipped: 0 | Duration: 26.3s.** Failures: none.

`globalSetup` provisioned 8 fixture users including **`admin-2fa-enrolled@presby.invalid`** (the `mfa-enrolled` storageState) and 4 organizations. The stricter auth gate is satisfied on its own terms, not by proxy:

- `totp-full-login.spec.ts:23` — **email+password → `/totp` → wrong code rejected → real TOTP code signs in**, on the MFA-enrolled fixture. The full login path, on a running server.
- `branded-signin.spec.ts:285` — a second full TOTP-verified login on the MFA-enrolled fixture, through the branded `/signin` page.
- `totp-callback-bypass.spec.ts` — 7/7, including three hostile-`callbackUrl` forms.
- `admin-login.spec.ts` — 4/4.

### Runtime probe of the fix's actual production claim

Unit tests can't show what a live server does with a dead database, so I ran one: dev server on 3400 with `DATABASE_URL=postgres://ci:ci@localhost:5432/ci`.

- `GET /site/e2e-presbytery/sitemap.xml` → **HTTP 404** (`Not found`), with `[flags] isFlagEnabled read failed; treating as disabled { key: 'sites.public_render' }` in the log — **key only, no SQL, no error object.** This is the fail-closed contract observed end-to-end, not inferred.
- `GET /site/e2e-presbytery` → **HTTP 500** — see Finding 1. Not a regression (pre-fix it 500'd earlier, at the flag read), but it bounds what Phase 6 may claim.

**The `computeEffectiveTwoFactor()` DB-error branch has no live probe, and I want that stated rather than implied.** An unreachable database also breaks the credential lookup that precedes it, so there is no way to arrive at that function with `required === true` on a server whose DB is down. Its coverage is the composed unit test at `local-login.test.ts:132`, which drives the **real `@/lib/db` seam** through the real `local-login.ts` (the `@/lib/flags` mock is gone), plus the empirical hazard reproduction above. That is the strongest evidence obtainable here, and it is materially stronger than what the pre-fix suite could produce.

## Production Build Under CI's Placeholder Env

Copy of the tree at `~/git/presby-platform/scratch-qa-flags-build` (outside the repo and worktree), `node_modules` **hardlinked** (`cp -al`) per the implementer's deviation note — I also removed `.env.local` from the copy so the placeholder env is the only source, matching CI, which has no `.env.local`. Env verbatim from `.github/workflows/ci.yml:29-34`.

- `npm run build` → **exit 0.** Zero occurrences of `Error`, `feature_flags`, or `Failed query` in the log.
- Route manifest confirms all three surfaces are dynamic, including the route that crashed: `ƒ /site/[slug]/[[...path]]`, `ƒ /site/[slug]/assets/[key]`, **`ƒ /site/-/sitemap.xml`**. No DB connection opened at build.
- **Control run — the part that makes exit 0 mean something.** I reverted `flags.ts` to `HEAD` and `sed`-deleted the three `force-dynamic` exports in the same scratch copy, `rm -rf .next`, rebuilt: **exit 1**, reproducing the original crash verbatim —
  ```
  Error occurred prerendering page "/site/-/sitemap.xml".
  Error: Failed query: select "key","description","enabled","rollout_percent","updated_at" from "feature_flags" … where "key" = $1 limit $2
      at async (src/lib/flags.ts:20:15)
      at async a (src/app/(public)/site/[slug]/sitemap.xml/route.ts:27:18)
  Export encountered an error on /(public)/site/[slug]/sitemap.xml/route: /site/-/sitemap.xml, exiting the build.
  ```
  My harness therefore demonstrably reaches the defect; the green build is not a false negative. (That control error text also vindicates Ruling 4 concretely: the driver message embeds the full SQL.)
- Scratch copy deleted after verification.

## Lint & Tripwires

- `npm run lint` — **exit 0**, `--max-warnings=0` satisfied.
- `npm run check` — all five green: `check:audit`, `check:sql-date`, `check:deps-drift`, **`check:brand-scope`**, `check:secrets`.

## Code Reading (verified by reading, not inferred from green tests)

- **`src/lib/flags.ts:19-38`** — the `try`/`catch` is **inside** the `cache()`-wrapped body (Ruling 1). The catch is written `catch {` with **no error binding at all**, so leaking `err.message` is structurally impossible, not merely untested. Log is `console.error("[flags] isFlagEnabled read failed; treating as disabled", { key })`. Divergence comment present (`:26-31`).
- **`src/lib/flags.test.ts:86-94`** — inverted **in place** (not appended beside), `await expect(isFlagEnabled("error-flag")).resolves.toBe(false)` — strict `toBe`, confirmed. `:96-119` asserts the serialized `console.error` args match neither `/select|Failed query/i` nor the error text, driven by a Drizzle-shaped `Failed query: select * from "feature_flags" where "key" = $1` rejection. Both assertions confirmed failing pre-fix.
- **`src/lib/auth/local-login.ts:112-123`** — inline `db.query.featureFlags.findFirst` in its own `try`/`catch`; `try` returns `row?.enabled ?? false`, `catch` returns `required` and logs `err.name` only (`:120`). The "do NOT simplify this to `catch { return false; }`" comment is present at `:104-111`. Docstring `:85-90` describes the inline read.
- **`@/lib/flags` no longer imported anywhere in `src/lib/auth/`** — `grep -rn "lib/flags" src/lib/auth/` returns only two prose mentions inside `local-login.test.ts` comments; zero imports in any source file. Grep-verifiable, as Ruling 2 required.
- **`isLocalLoginEnabled()` still fails OPEN** — `:38-41` `catch { return true; }`, covered by `local-login.test.ts:84` (`DB error (findFirst throws) → true`). See Finding 3 on the log line.
- **Three `force-dynamic` exports present with the required comment** — `layout.tsx:6`, `sitemap.xml/route.ts:5`, `assets/[key]/route.ts:5`. **No `generateStaticParams` and no `export const revalidate` anywhere under `src/app/(public)/site/[slug]/`** — no conflict.
- **`src/lib/sites.ts:336-347`** — docstring narrowed correctly: names the flag read as covered, states `db.execute` and the blob resolve are **not yet** covered. Both reads confirmed still uncaught (now at `:356` and `:362`). That is the tracked residual, not a defect.
- **Edge invariant intact** — `src/proxy.ts` still imports only `next/server`, `@/lib/auth/config`, `@/lib/permissions`.
- **Diff scope** — `git diff --stat` over exactly Phase 3's eight files accounts for 122 insertions / 43 deletions; nothing outside the plan, and none of the concurrent branding pipeline's files were evaluated or touched.

## Regression Tests Added

- `resolves to false (never rejects) when findFirst throws — fail-closed contract, DECISION-026` — `src/lib/flags.test.ts:86` — guards: `isFlagEnabled()` rejecting instead of resolving `false` on a DB error (the build crash). **Watched failing pre-fix, passing post-fix, by me.**
- `logs the flag key on a DB error, never the error object` — `src/lib/flags.test.ts:96` — guards: the driver's SQL-bearing error message reaching the log in a public repo. **Watched failing pre-fix by me.**
- `rawRequired = true, auth.require_2fa read throws → rawRequired (regression for isFlagEnabled fail-closed change)` — `src/lib/auth/local-login.test.ts:132` — guards: a DB blip silently dropping 2FA enforcement for an already-required user (DECISION-026). **Watched failing under the exact hazard configuration by me** (`expected false to be true` at `:149`).

## Coverage on Critical Modules

| Module | Statements | Branches | Target | Result |
|---|---|---|---|---|
| `src/lib/permissions.ts` | **100%** | 100% | 100% | met |
| `src/lib/two-factor.ts` | **91.30%** | 100% | 90%+ | met |
| `src/lib/flags.ts` | **100%** | 100% | 100% | met |
| `src/lib/auth/local-login.ts` | **100%** | 91.66% | — | uncovered: `:120` only |

`local-login.ts:120`'s uncovered branch is the `: undefined` arm of `err instanceof Error ? err.name : undefined` — a non-`Error` rejection. Cosmetic.

## Feature-Gate Audit

Three route/layout files were touched. Each addition is a single `export const dynamic = "force-dynamic"` line plus a comment — **no handler body, no auth check, and no gate was added, removed, or altered.** All three are on the **anonymous public render path** and are public by design; `hasFeature()` is correctly absent, and `auth()` is correctly absent. Gating on this path is the `sites.public_render` flag plus `presby_published_site()`'s published/active check, with every non-live reason collapsing to an identical 404 (enumeration-safe, DECISION-040 posture). Verified by reading each file's body, not by inferring from green tests.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `GET /site/[slug]/sitemap.xml` (`sitemap.xml/route.ts:22`) | no — **public by design** | no — **public by design** | n/a (flag-gated: `sites.public_render` via `getPublishedSite()`) |
| `GET /site/[slug]/assets/[key]` (`assets/[key]/route.ts:26`) | no — **public by design** | no — **public by design** | n/a (flag-gated via `resolvePublishedOrganization()`) |
| `/site/[slug]` layout (`layout.tsx`) | no — **public by design**, documented "fully anonymous by construction"; no `getPlatformDb()` | no — **public by design** | n/a (flag-gated via `getPublishedSite()`) |

No `src/app/api/**/route.ts` and no `"use server"` action was added or changed by this pipeline. **No protected routes touched.**

## Schema / RLS Audit

**N/A** — no migration, no `src/lib/db/domain/` change, no grant, policy, or trigger change. Ratified by the architect's Phase 2 ("Schema / RLS / grants: untouched. Review step 5 is N/A"). Confirmed against the diff: `src/lib/db/` is absent from all eight files.

## Findings (none blocking)

1. **The public-site DB-blip residual is wider than the two reads currently tracked — discovered by live probe, not inference.** With an unreachable DB, `GET /site/<slug>` returns **HTTP 500** from a *third* uncaught read the docstring and the planned integration TODO do not name:
   ```
   Error: Failed query: select "name", "organization_type" from "organizations" where "organizations"."slug" = $1
       at async publicOrgSummary (src/lib/authz.ts:521:17)
       at async PublicSitePage (src/app/(public)/site/[slug]/[[...path]]/page.tsx:224:21)
   ```
   This sits *outside* `getPublishedSite()`, so the narrowed docstring is not wrong — but a follow-up that wraps only `sites.ts:356` and `:362` and then declares `/site/*` blip-safe would be wrong. **The integration TODO should name all three reads**, and should cite `sites.ts:356`/`:362` rather than the pre-change `:352`/`:358` in Phase 3/4's text (the docstring grew; the docstring itself wisely omits line numbers). This empirically confirms the architect's Note 3 corollary — Phase 6 must not claim `/site/*` now 404s instead of 500s on any DB blip.
2. **`npx dotenv -e .env.local -- npx vitest run --no-file-parallelism` — the invocation `docs/testing.md:157` documents — is not green**, because `.env.local:25`'s `RATE_LIMIT_DISABLED=true` (needed by e2e `globalSetup`) makes 3 cases in `src/lib/rate-limit.test.ts` fail. Pre-existing, unrelated to this diff, isolated by differential run. The suite should `vi.stubEnv("RATE_LIMIT_DISABLED", "")` in its non-escape-hatch describes so the documented command is actually usable. TODO candidate.
3. **`isLocalLoginEnabled()` does not log on its fail-open catch** (`local-login.ts:38-41`). Flagging because it was raised to me as an expectation: **this is design-conformant, not a miss** — Ruling 4 marked it "Suggestion (not required)", Phase 3 put it in Out of Scope, and the Implementer Notes record the decision. It still deserves the follow-up line Ruling 4 argued for (a flag failing *open* during an outage is invisible by construction). TODO candidate, not a loop-back.
4. **No test guards the `[local-login]` log line against leaking `err.message`**, the symmetric partner to `flags.test.ts:96`. I verified by reading that it emits `err.name` only. Low risk (a future edit to `err` would be caught in review, not by CI); worth one assertion next time this file is touched.
5. **Regression-name style nit:** `local-login.test.ts:132` uses `(regression for …)` in parentheses rather than the house `— regression for …` suffix. Cosmetic; the name reads correctly aloud.

## Verdict

**PASS**

The auth-touching stricter gate is met on its own terms: the e2e suite ran against a real dev server on port 3400 with the MFA-enrolled seeded fixture, the full login path (password → TOTP rejection → TOTP success) was exercised twice on two different surfaces, and 16/16 specs passed with **zero skips**. Nothing was deferred. The build acceptance is backed by a control run that reproduces the original crash, so exit 0 is a positive result rather than an untested harness. Both regression tests were watched failing before the fix and passing after, by me, in an isolated copy — including the Ruling-2 hazard, which reproduced exactly as Phase 1 predicted and confirms the two fixes cannot be split. All coverage targets met. Feature-gate audit clean (three public-by-design routes, no gate changed). Five findings recorded, none blocking; Finding 1 is new information for the integration TODO and for Phase 6's claim scope.

---

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete — all suites re-run not cited; failing-first independently reproduced for both regressions; CI-placeholder build verified against a control that reproduces the crash; auth e2e 16/16 on a real server with the MFA-enrolled fixture, zero skips; 5 non-blocking findings | PASS | 2026-09-26 |

## Handoff

Next agent: **analyst (Phase 6)** — shipped-vs-intent against Phase 1.

Three things Phase 6 should carry:

1. **Do not claim the public render path is DB-blip-safe.** Only the flag read is. I have live evidence that `/site/<slug>` still returns 500 through `src/lib/authz.ts:521` (`publicOrgSummary`, called from `page.tsx:224`) — a third uncaught read beyond the two in the tracked residual. The sitemap route does correctly return 404.
2. **Finding 1's line-number correction and the third read belong in the orchestrator's integration TODO** (`sites.ts:356` and `:362`, not `:352`/`:358`, plus `authz.ts:521`).
3. Findings 2–4 are TODO candidates at integration, not loop-backs: the `rate-limit.test.ts` / `RATE_LIMIT_DISABLED` coupling that breaks the documented DB-backed test invocation; the `isLocalLoginEnabled()` log line Ruling 4 suggested and Phase 3 scoped out; and the missing `err.message`-leak guard on the `[local-login]` log.



---

# Phase 6 — Shipped vs Intent (analyst)

*Bug-fix variant; recorded verbatim by the orchestrator, 2026-09-26.*

*Bug-fix variant. Worked read-only inside `/Users/cshenso/git/presby-platform/presby-wt-lint`, branch `pipeline/lint-gate`. Both this pipeline's commit (`6f06f41`) and the sibling lint-gate commit (`df7bd42`) are already committed to the shared branch; the shared-file integration (`docs/decisions.md`, `CLAUDE.md`, `docs/TODO.md`, release notes) is still a draft script (`lint-integrate.py`) and has not run yet. I verified every claim below by reading the committed code and running read-only `git` commands — not by trusting the work-log's prose.*

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> The fix does exactly what Phase 1–3 required — `isFlagEnabled()` fails closed and logs only the key, both sign-in-path flags read the database themselves so neither DECISION-026 direction is compromised, and no build opens a database for the public site — verified in the actual committed diff, not just cited from the work-log; the one thing Phase 6 must say loudly is that the public `/site/<slug>` render path is *still* not DB-blip-safe, and — a detail worth stating precisely — the fixed flag read's own fail-closed branch now walks straight into the next unguarded read (`publicOrgSummary`), so the residual isn't three independent leftover reads, it's a chain the fix newly exercises.

## What's Working

- **The core fix is exactly as designed, verified by reading the shipped code, not the prose describing it.** `src/lib/flags.ts:19-38`: the `try` is inside the `cache()`-wrapped body, `catch {` has **no error binding at all** — leaking `err.message` is structurally impossible, stronger than Ruling 4 required. `console.error("[flags] isFlagEnabled read failed; treating as disabled", { key })` — key only.
- **`computeEffectiveTwoFactor()` no longer depends on the bare helper's throw.** `src/lib/auth/local-login.ts:94-123`: inline `findFirst` read, its own `try/catch`; `try` returns `row?.enabled ?? false`, `catch` returns `required` (the already-resolved value) and logs `err.name` only, never `err.message`. The required "do NOT simplify this to `catch { return false }`" comment is present verbatim. `grep -rn "lib/flags" src/lib/auth/` returns zero source-file imports — Ruling 2's "grep-verifiable" property actually holds.
- **The regression that mattered most was reproduced empirically, twice, independently.** The implementer's own stash-based repro and QA's independently-built isolated copy both hit `expected false to be true` at exactly the predicted line when `flags.ts` is fixed but `local-login.ts` isn't — the Ruling-2 hazard is not a theoretical concern, it's a demonstrated one, and the shipped code closes it.
- **`force-dynamic` landed on the corrected file list, not the original three-leaf list.** `layout.tsx:6`, `sitemap.xml/route.ts:5`, `assets/[key]/route.ts:5` all carry the export and the required naming comment. QA's build control run (revert `flags.ts` + strip the three exports → exit 1, reproducing the original crash verbatim) is real evidence the green build means something, not a coincidence of read order.
- **The auth e2e gate was honored on its own terms**, not deferred: 16/16 on a real dev server with the MFA-enrolled fixture, full password → TOTP-reject → TOTP-success path exercised twice on two surfaces. This satisfies CLAUDE.md's stricter Phase 4/5 requirement for any change touching `src/lib/auth/`.
- **The release-note draft respects the claim boundary Phase 2/3 set.** I read `lint-integrate.py`'s `entry` string directly: it says a feature-flag read that fails "now resolves to 'off'", that "the two sign-in flags read the database themselves," and that public-site pages "never open a database connection **at build**." It does not say — and correctly does not say — that `/site/*` is now DB-blip-safe at runtime. That is the exact line the architect's Note 3 and QA's Finding 1 required Phase 6 to hold, and the draft holds it.
- **Rule 12 is correctly n/a** — no `feedback` reference anywhere in the work-log (I grepped for it). **Rule 13 what's-new is correctly n/a** — this is an internal reliability fix with no new member-visible behavior; nothing here belongs on `/whats-new`.

## Intent-vs-Shipped Diff

- Phase 1 said: *restore the catch, or ship a silent 2FA-enforcement regression via `computeEffectiveTwoFactor()`.* Shipped: both landed in one commit (`6f06f41`), verified independently failing-first by QA. **Matches.**
- Phase 1/2 said: *the commit body must correct the kickoff's "a commit dropped the catch" narrative and name `7129fdf` as the exposing commit.* Shipped: `git show -s --format='%B' 6f06f41` names `7129fdf` and the correct causal chain ("isFlagEnabled() never had the catch DECISION-026 promised... 7129fdf's sitemap route exposed it on 2026-08-25... hidden for four weeks behind the Lint-first CI job"). **Matches**, and reads better than the design doc's own draft text.
- Phase 3 said: `Discovered-In: post-merge`. Shipped: `Discovered-In: Phase-4`. **Acceptable drift, not a defect** — the work-log's own kickoff block literally says "found by the lint pipeline's Phase 4," so `Phase-4` is at least as defensible as `post-merge`; both values are on the allowed list and neither misrepresents how the bug surfaced. Not worth reopening a commit for. Noted so it isn't silently unremarked.
- Phase 2 Ruling 3 said: *catch the build crash by defense-in-depth (`force-dynamic`), because the catch alone leaves the build green "by coincidence" — the flag read happens to be the first DB touch.* Shipped: confirmed by direct read of `src/lib/sites.ts:349-366` — `db.execute` at `:356` and the blob resolve at `:362` are still bare, uncaught. **Matches the design's own stated limitation exactly** — this was never promised as fixed.
- Phase 5 Finding 1 said: *a third uncaught read, `publicOrgSummary` at `src/lib/authz.ts:521`, means `/site/<slug>` still 500s.* I traced the call graph myself: `publicOrgSummary()` (`src/lib/authz.ts:516-527`, no try/catch, a bare `db.select`) is called from `page.tsx:224` **only inside the `result.kind === "not_found"` branch** — i.e., exactly the branch the now-fixed, fail-closed flag read routes into during a DB blip. **This is a sharper finding than "three separate residual gaps":** the fix correctly makes the flag read fail closed to `not_found`, and that branch's very next statement is an unguarded second database read against the same unreachable database. QA's live probe (`GET /site/e2e-presbytery` → 500) is the direct, reproducible consequence of that chain, not an unrelated pre-existing gap. Phase 6 should say this precisely rather than let it read as "three unrelated leftover TODOs."

## Edge Cases

- **Empty state:** not applicable — no new UI surface, no list, no first-run screen.
- **Failure microcopy:** pass for the flag read and for `isLocalLoginEnabled()` (fails open, sign-in still works during a blip); pass for `computeEffectiveTwoFactor()` (an already-required user stays challenged during a blip, verified by the composed regression test, not just argued); **fail, tracked** for `/site/<slug>` itself — a real visitor hitting a DB blip gets a framework error page (HTTP 500), not the "not found" the page's own docstring promises for every non-`ok` outcome. This was explicitly out of scope for this fix (Phase 2 Note 3, Phase 3 Out of Scope), correctly narrowed in the `sites.ts` docstring rather than left overclaiming, and correctly not claimed as fixed in the release note. Still a real user-facing gap that needs its own scoped pipeline.
- **Permission gate:** not applicable — this is a read-path reliability fix; no `hasFeature()`/`FEATURES.*` check was added, removed, or altered. QA's feature-gate audit (all three touched files are public-by-design, `auth()` and `hasFeature()` correctly absent) checks out on direct read.
- **Audit event:** not applicable — no security-sensitive mutation; this is a read path, correctly documented as such in Phase 4.
- **Mobile (360px):** not applicable — no UI surface changed.

## Follow-Ups (SHIP WITH NOTES)

Read the orchestrator's consolidated draft line (`lint-integrate.py:62`, the `docs/TODO.md` "Flags follow-ups (2026-09-26-flags-fail-closed)" bullet). **I bless it with one amendment and one addition:**

- **Bless as-is:** the three uncaught reads (`sites.ts:356`, `sites.ts:362`, `authz.ts:521`) with correct, verified line numbers; the `RATE_LIMIT_DISABLED` / documented DB-backed test-invocation coupling; the `isLocalLoginEnabled()` missing log line and the missing `err.message`-leak guard on the `[local-login]` log; the `org_features.category_axis` direction flag for the next security health-check; the starter-contribution candidate; the sequential-CI-job note. All independently verified against the code — nothing in that bullet is aspirational.
- **Amendment requested:** reword the `authz.ts:521` clause to state the causal chain, not just list it as a third parallel item — e.g. "…and `src/lib/authz.ts:521` (`publicOrgSummary`, called only from the `not_found` branch that the now-fixed flag read itself routes a DB blip into — QA probed a live server…)". This changes nothing about scope or priority, only makes clear to whoever picks up the follow-up that fixing the flag read didn't just leave two unrelated gaps standing, it created a new path into a third one.
- **New, small addition:** `docs/decisions.md`'s DECISION-026 entry has **two** stale claims about `auth.require_2fa`, not one. The architect's correction paragraph (accurate, verified against `fw` and against the shipped code) explicitly re-reads the "Standard `isFlagEnabled()` semantics (unchanged)" section — but the entry's separate **"What is NOT changed"** bullet ("`auth.require_2fa` uses standard `isFlagEnabled()` — its fail-closed-on-missing behavior is correct") is now flatly false and is not addressed by the correction text at all (verified by reading both the correction paragraph and the DECISION-026 entry directly, `docs/decisions.md:1367-1370`). Recommend the integration script either strike that bullet or append a one-clause pointer to the correction, in the same edit — cheap to do now, confusing to leave for a future reader who stops at "What is NOT changed" and never reaches the correction paragraph below it.
- **Not a follow-up, an observation only:** the `Discovered-In: Phase-4` vs. designed `post-merge` trailer choice on `6f06f41` — defensible as shipped, not worth amending a committed message over.

None of the above blocks shipping; all are already headed into `docs/TODO.md` at the same integration point per Workflow Rule 10, which is exactly the mechanism this verdict exists to invoke.

---

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete — verified against the committed diff (`6f06f41`) directly, not the work-log's description of it; core fix and both DECISION-026 directions confirmed correct by code read; residual public-render-path gap confirmed as a causal chain (fixed flag read → unguarded `publicOrgSummary`), not three independent items; release note and DECISION-026 correction text blessed with one amendment + one addition | SHIP WITH NOTES | 2026-09-26 |

## Handoff

Next: **orchestrator**, to run `lint-integrate.py` with the one amendment (TODO bullet's `authz.ts:521` clause reworded to name the causal chain) and the one addition (touch DECISION-026's "What is NOT changed" bullet, not just its "Standard semantics" section, in the same edit). Rule 12 not applicable (no feedback row). Rule 13 not applicable (no what's-new entry warranted). No further loop-back — Phase 4/5 evidence and my own independent code reads agree; this closes at SHIP WITH NOTES, not SHIP IT, solely because the public-render-path DB-blip gap is real, user-facing, and not yet scheduled as its own pipeline — it is tracked, not fixed.



### Orchestrator closure (2026-09-26)

Shipped as v0.26.1 (`fix(flags):`) in the same PR as the lint gate. DECISION-026 corrected in place; CLAUDE.md's auth-flag sentence replaced; TODO lines for `sites.ts:352/:358`, `org_features.category_axis`, and the starter-contribution candidate.
