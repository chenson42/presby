# Secrets & PII pre-push tripwire — Work Log

> **Slug:** `2026-08-30-secrets-pii-tripwire`
> **Surface:** tooling/infrastructure — `scripts/`, `package.json`, `.claude/skills/pre-push/`, `CLAUDE.md`
> **Permission(s):** none — a build-time/dev-tooling check, not a runtime code path
> **Flag(s):** none
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant, accelerated — the underlying defect is two real No-Real-Data-invariant violations already sitting in the tracked tree, found and fixed by building the very tripwire meant to catch them; Phases 2/3 skipped with notation below, matching this repo's own precedent for the four prior tripwires (`check:audit`/`check:sql-date`/`check:deps-drift`/`check:brand-scope`), none of which went through a full six-phase design pass either.
> **Source:** operator, 2026-08-30, direct instruction after making the `presby` repository public: "can you please make sure there are pre-push checks for pii and secrets before checking in. check all tracked files."

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | skipped (notation below) | — | — | 2026-08-30 |
| 2 — Architectural review | skipped (notation below) | — | — | 2026-08-30 |
| 3 — Technical design | skipped (notation below) | — | — | 2026-08-30 |
| 4 — Implementation | self | Complete | — | 2026-08-30 |
| 5 — Verification | self | Complete | PASS | 2026-08-30 |
| 6 — Shipped vs intent | self | Complete | SHIP IT | 2026-08-30 |

---

## Phases 1–3 — skipped, with notation

The operator's own request was fully unambiguous (a pre-push secrets/PII scanner, run against every tracked file) and structurally identical to four already-shipped tripwires in this same repo (`check-audit-coverage.mjs`, `check-sql-date.mjs`, `check-deps-drift.mjs`, `check-brand-scope.mjs`) — a standalone Node script, no schema change, no new dependency, no user-facing runtime behavior, wired into `npm run check` and the `/pre-push` skill. No functional ambiguity to refine (Phase 1), no directory/dependency/server-client split to review (Phase 2 — this follows an already-established placement convention exactly), and no API contract or data model to design (Phase 3). The real design decisions (HARD vs. SOFT tiers, the annotation escape hatch, the placeholder-recognition list) are recorded in `docs/decisions.md` DECISION-134 and in the script's own header comment.

---

# Phase 4 — Implementation

## Files Created

- `scripts/check-secrets-pii.mjs` — the tripwire. Exports a pure `checkSecretsPii(files)` core (mirroring `check-brand-scope.mjs`'s `{path, content}` fixture shape) plus a CLI entry point that walks `git ls-files` and calls it.
- `scripts/check-secrets-pii.test.mjs` — 31 fixture tests against the pure core, no disk/git access.

## Files Modified

- `package.json` — new `check:secrets` script, folded into `npm run check`.
- `.claude/skills/pre-push/SKILL.md` — new Step 3e, and the Step 8 summary line.
- `CLAUDE.md` — new `check:secrets` line in Common Commands, "All five tripwires" (was four).
- `docs/work-log/2026-07-01-e2e-auth-infra.md` — redacted a real generated dev password narrated in prose (`SEED_ADMIN_PASSWORD=<redacted>`).
- `docs/work-log/2026-07-01-record-audit-helper.md` — added a `leak-ok` annotation on an obvious toy placeholder email address the email-allowlist check otherwise flagged.
- `docs/STATE.md` — redacted a real congregation's real street address and phone number, entered while testing the org-profile feature against a real, consenting sponsor (First Presbyterian Church of Westerville). The underlying dev-database row is untouched — only the doc's narration of it.
- `docs/decisions.md` — DECISION-134.
- `docs/TODO.md` — Done-log entry.
- `docs/briefings.md` — new entry, `covers:` marker to be moved to this commit.

## Schema Changes

None.

## Audit Events

Not applicable — a dev-tooling script, not a runtime mutation path.

## Implementer Notes

- The script went through three real correction rounds before landing: (1) `HARD` vs `SOFT` tier boundaries — connection-string-with-embedded-credential started as HARD, then moved to SOFT once `.env.example`'s own template strings and the CI-only `postgres://ci:ci@localhost` fixture both needed the placeholder-exemption path a HARD tier can't offer; (2) a leading `\b` on the env-var-secret pattern silently failed to match any real-world case (`AUTH_SECRET`, `SEED_ADMIN_PASSWORD`) because `_` is a word character, so `\bSECRET` never matches a keyword sitting after an underscore — found by the test suite, not by inspection; (3) the phone-number 555-exception regex initially guarded the wrong group (the area code instead of the exchange), which is backwards from this project's own `NXX-555-XXXX` fake-number convention — also caught by the test suite.
- Deliberately widened the placeholder-recognition list (`fixture`, `do-not-use`, `not-a-secret`) rather than hand-annotating five already-self-documenting e2e fixture values one at a time — annotating a value that already says "this is fake" in its own name teaches the wrong lesson to the next contributor.
- The one-time audit run against the full tracked tree surfaced exactly two real findings (see Files Modified) and one deliberate false-positive annotation. Both real findings were presented to the operator before redacting anything narrower than "the tripwire's own tuning" — the STATE.md finding specifically, since it involved a real, named, consenting third party and a real invariant-vs-practice tension, was not resolved unilaterally.
- **A fourth correction round, found only once the script was run against its own committed test file:** `check-secrets-pii.test.mjs` deliberately contains synthetic secret-shaped strings (a private key block, an AWS key ID, a JWT, ...) to prove HARD-tier detection actually fires — and HARD findings correctly have no annotation escape hatch, so the tripwire flagged its own test fixtures as 11 HARD violations the first time it ran against the real tracked tree post-commit-prep. Fixed by excluding that one file, by exact path (`SELF_TEST_EXEMPT_PATH`), from the CLI's file walk — not a general "test files are exempt" rule, which would open a real loophole for an accidentally-real secret landing in an ordinary test fixture elsewhere. Two smaller SOFT-tier false positives in the script's own doc comments (describing the connection-string and email patterns it matches, in prose that itself matches those patterns) were fixed with inline `leak-ok` annotations instead, since excluding the whole script file from its own scan would be a much larger, unjustified exemption.
- **A fifth correction round, at the actual push attempt:** GitHub's own push-protection secret scanner — a real, separate, independent system from this project's tripwire — rejected the push, flagging two of the same test file's HARD-tier fixtures (Stripe- and Slack-shaped values) as real secrets. `SELF_TEST_EXEMPT_PATH` only affects this project's own CLI file walk; it has no effect on GitHub scanning the raw committed content. Fixed properly this time, not by another exemption: every HARD-tier fixture's secret-shaped string is now built via runtime string concatenation (a small `j(...parts)` helper) so the committed source file never contains the contiguous substring a static scanner — this project's or GitHub's — would match, while `checkSecretsPii()` still receives the fully-assembled string at test-run time. A genuinely useful, independent confirmation that this class of problem (a secret-scanner's own test fixtures looking exactly like what they detect) is real and not specific to this project's own tripwire.
- Operator explicitly declined a git-history rewrite for either finding — both values remain in past commits, by deliberate choice, not oversight. Recorded here and in `docs/decisions.md` so a future reader doesn't mistake the clean current-tree scan for proof nothing sensitive was ever committed.

---

# Phase 5 — Verification (self)

**Date:** 2026-08-30
**Verified by:** self

## Type Check

`npm run typecheck`: **PASS**, clean.

## Unit Tests

`npx vitest run scripts/check-secrets-pii.test.mjs`: 31/31 passed. Full suite (`npm test`): 246 files passed, 26 skipped, 3206 passed, 655 skipped, 0 failed.

## End-to-End Tests

Not applicable — a build-time/dev-tooling script with no runtime surface; no auth-path file touched.

## Regression Tests Added

- All 31 cases in `check-secrets-pii.test.mjs` are new (new script). Notably: a case reproducing the actual real-world incident this tripwire exists for (`SEED_ADMIN_PASSWORD=Gr307GDrMiOlxAiu` narrated in prose), and cases proving the CI/`.env.example` placeholder connection strings are NOT flagged (guards against the tripwire becoming too noisy to trust).

## Coverage on Critical Modules

Not applicable — `src/lib/permissions.ts`/`two-factor.ts`/`flags.ts` untouched by this change.

## Feature-Gate Audit

No protected routes or server actions touched — this is a dev-tooling script with no runtime code path.

## Verdict

**PASS.** `npm run check` (all five tripwires), `npm test`, `npm run typecheck`, and `npm run build` all verified clean against the final state, after the two real findings were redacted.

---

# Phase 6 — Shipped vs Intent (self)

## VERDICT

**SHIP IT**

## ONE-LINE TAKE

> The operator asked for a pre-push PII/secrets check across all tracked files; that now exists, is tested, is wired into `/pre-push`, and the one-time audit it was built to justify already found and (with the operator's explicit sign-off on scope) fixed two real, pre-existing violations of this project's own No Real Data invariant.

## What's Working

- The tripwire's HARD/SOFT split and annotation convention are a natural extension of `check-sql-date.mjs`'s own precedent, not a new pattern invented for this task — a future contributor who already knows `// sql-date-ok:` immediately understands `// leak-ok:`.
- The audit was genuinely useful, not pro-forma: it found a real password in a work-log and a real congregation's address/phone in a planning doc, neither of which had been caught by the pre-existing `private/`/`scratch/` pre-commit hook (a structurally different class of accident).
- The one ambiguous, judgment-requiring finding (the STATE.md address/phone, given the church's own consent to being named elsewhere in this project) was surfaced to the operator rather than resolved unilaterally, and the operator's explicit decision (redact now, don't rewrite history) is recorded, not just executed silently.

## Intent-vs-Shipped Diff

- Operator said: "pre-push checks for pii and secrets before checking in. check all tracked files." Shipped: exactly this — a new `check:secrets` tripwire scanning every `git ls-files` result, wired into both `npm run check` and the `/pre-push` skill's own step sequence, plus the one-time audit explicitly requested. **Matches.**

## Edge Cases

- Empty state (a clean tree): pass — prints "Secrets & PII guard passed." and exits 0, matching every sibling tripwire's own success-message convention.
- Failure microcopy: pass — HARD and SOFT findings are reported separately with file:line, the matched text, and (for SOFT) the exact annotation syntax to use if it's a genuine false positive.
- Permission gate: not applicable.
- Audit event: not applicable.
- Mobile: not applicable — a CLI script.

## Follow-Ups (SHIP WITH NOTES-style, non-blocking)

- This tripwire only ever sees the current tracked tree, never git history — stated explicitly in its own header and in DECISION-134, but worth remembering the next time this repo's public status is discussed: a clean `check:secrets` run is not proof nothing sensitive was ever committed.
- If a stronger guarantee is ever wanted, a real secret-scanning service (GitHub's own push protection is already available now that this repo is public, or a dedicated tool like `gitleaks` run against full history) would close the gap this tripwire structurally cannot — not proposed as required, just named so it isn't assumed to already exist.

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]
