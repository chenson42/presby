# Identity Pass — the Repo Stops Calling Itself the Starter — Work Log

> **Slug:** `2026-08-18-identity-pass`
> **Surface:** mixed (README + landing page + global nav + admin shell + emails + authenticator label)
> **Permission(s):** none — no gate added or changed
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Polish / renaming class — Phase 2 skipped (no new dependency,
> no directory added, no server/client boundary moved, no schema change);
> Phase 3 folded into Phase 1 (the design is the file list)

> **Agent note:** this session runs under an operator instruction not to spawn
> subagents. Every phase below was executed inline by the main session rather
> than by its named agent.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst (inline) | Complete | READY FOR DESIGN | 2026-08-18 |
| 2 — Architectural review | architect | Skipped — renaming only; no dep, directory, or boundary change | — | 2026-08-18 |
| 3 — Technical design | tech-lead (inline) | Complete (file list below) | — | 2026-08-18 |
| 4 — Implementation | ux-developer + full-stack-developer (inline) | Complete | — | 2026-08-18 |
| 5 — Verification | qa (inline) | Complete | PASS | 2026-08-18 |
| 6 — Shipped vs intent | analyst (inline) | Complete | SHIP IT | 2026-08-18 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY FOR DESIGN

## ONE-LINE TAKE

> The repo went public-adjacent (private on GitHub, open source intended) while
> its README, its landing page, its navigation, its outbound email sender, and
> the label in every user's authenticator app all still say "Claude Code
> Starter" — so the first thing anyone sees is a different project.

## Why now

`chenson42/presby` was created 2026-08-18. The repo is private today and open
source soon. Everything a visitor or a member reads first is still the starter's
copy, and some of it is not documentation — it is application text signed into
emails and burned into TOTP enrolments.

## What is actually wrong, by audience

| Audience | Where they hit it | What it says today |
|---|---|---|
| GitHub visitor | `README.md` line 1 | "# Claude Code Starter", then 197 lines describing a fork-and-go starter, a Quick start that clones `chenson42/claudecode-nextjs-starter`, and forking advice |
| GitHub visitor | `package.json` | `name: claudecode-nextjs-starter`, starter description, no `repository` field |
| Anyone signed out | `src/app/page.tsx` | H1 "Claude Code Starter" + "A fork-and-go Next.js + Neon + NextAuth starter… teaching artifact" |
| Any signed-in member | `src/components/shared/global-nav.tsx` | brand link "Claude Code Starter" on every page |
| Any admin | `src/app/(admin)/admin/layout.tsx` | back link "← Claude Code Starter" |
| Anyone receiving mail | `src/lib/email/send.ts` | default From name "Claude Code Starter" |
| Anyone enrolling in 2FA | `src/lib/two-factor.ts` | TOTP issuer "Claude Code Starter" — the label in Google Authenticator, permanently, per enrolment |

The TOTP issuer is the one with a tail: it is baked into the `otpauth://` URL at
enrolment time, so **already-enrolled users keep seeing the old label until they
re-enrol.** The secret keeps working; only the display name is stale. No
migration is warranted for the current enrolments (a dev admin and seed users).

## Scope boundary — what this pass deliberately does NOT touch

Renaming everything that matches `/starter/i` would destroy true statements.

- **`.claude/skills/upstream-sync`, `downstream-sync`, `personalize-starter`** —
  these are *about* the relationship to `chenson42/claudecode-nextjs-starter`.
  The canonical URL in them is load-bearing; rewriting it breaks the skills.
- **Historical records** — `docs/release-notes/*`, `docs/decisions.md`,
  `docs/reviews/*`, `docs/work-log/2026-0[1-8]-*`, `docs/starter-contributions/`.
  These record what happened when it happened. Editing them is falsifying a log.
- **Provenance comments in code** — `src/lib/authz.ts` ("Inherited from the
  starter"), the `platform (from starter)` module label on `/developer`,
  `src/types/actions.ts`. These are accurate statements about where the code came
  from, and they are useful precisely because they mark the seam between the
  inherited shell and presby's own domain.

## The name question, unchanged

This pass does **not** name the project. `presby` remains the placeholder, and
`/personalize-starter` stays un-run, because the skill wants a real name,
brand color, and strategic docs in one shot. When the name lands (candidates:
Kirk, Cairn — `docs/STATE.md`), it is a find-replace over a repo that says
`presby` consistently, which is a much easier target than one that says three
different things.

## Gaps the Request Didn't Address

- **`package.json` `private: true` stays.** It prevents an accidental `npm
  publish`; it has nothing to do with GitHub repo visibility. Correct for an
  application.
- **Open-source repo furniture is still missing** — no `SECURITY.md`, no
  `CONTRIBUTING.md`, no `CODE_OF_CONDUCT.md`. Out of scope here (this pass is
  about identity, not governance); tracked in `docs/TODO.md` for the
  public-readiness batch.

## Open Questions

None blocking.

---

# Phase 2 — Architectural Review (architect)

**Skipped.** Renaming and copy only: no new dependency, no directory added, no
`'use client'` boundary moved, no schema change, no API surface change. Recorded
per CLAUDE.md ("Skipping a phase requires explicit notation in the work-log").

---

# Phase 3 — Technical Design (tech-lead)

## Data Model

No schema changes required.

## Files to Modify

**Repo identity**
1. `README.md` — rewrite for presby
2. `package.json` — `name`, `description`, add `repository`

**Application text (user-visible)**
3. `src/app/page.tsx` — landing H1 + blurb
4. `src/components/shared/global-nav.tsx` — brand link
5. `src/app/(admin)/admin/layout.tsx` — back link
6. `src/lib/email/send.ts` — default From display name
7. `src/lib/two-factor.ts` — TOTP issuer default (+ `src/lib/two-factor.test.ts`,
   which asserts the URL-encoded issuer)

**Process layer**
8. `.claude/agents/*.md` (9 files) — the "You are X for the Claude Code Starter"
   identity line. These shape how each agent reasons about the project it serves,
   so leaving them is not cosmetic.
9. `eslint.config.mjs` — header comment
10. `docs/ui-standards.md` — scope line
11. `docs/reviews/log.md` — the "N/A in the canonical starter" fork-sync line,
    matching the correction already made in CLAUDE.md

## Edge Cases & Risks

- `two-factor.test.ts` asserts `Claude%20Code%20Starter` in the otpauth URL — it
  must move with the source or the suite goes red.
- No e2e spec asserts any of these strings (verified by grep across `e2e/`), so
  the Playwright suite is unaffected.

## Implementer

ux-developer (app text) + full-stack-developer (README, package, process layer) —
executed inline.

---

# Phase 4 — Implementation

## Files Modified

**Repo identity**
- `README.md` — rewritten. The starter README sold a fork-and-go template; this one describes presby, leads with the no-real-data invariant, explains the four polity constraints that shape the schema, states plainly that there is no church-facing UI, and documents the four connection strings.
- `package.json` — `name` → `presby`, presby description, `repository` added, `license: MIT` added (the LICENSE file existed but the manifest never declared it). `private: true` kept — it blocks accidental `npm publish` and has nothing to do with GitHub visibility.

**Application text (user-visible)**
- `src/app/page.tsx` — landing H1 and blurb; added a pre-release line so a visitor is not misled about what they are looking at
- `src/components/shared/global-nav.tsx` — brand link on every authenticated page
- `src/app/(admin)/admin/layout.tsx` — admin back link
- `src/lib/email/send.ts` — default From display name
- `src/lib/two-factor.ts` — TOTP issuer default, with a comment recording that the issuer is baked in at enrolment time and does not re-label existing enrolments
- `src/lib/two-factor.test.ts` — the assertion moved with it, and was strengthened: it now checks both places the otpauth URL carries the issuer (`otpauth://totp/presby:` prefix and `issuer=presby`) rather than a bare substring match

**Environment**
- `.env.example` — added `PLATFORM_DATABASE_URL`, `MIGRATE_DATABASE_URL`, `APP_DATABASE_URL` (all three were **missing** even though `src/lib/db/index.ts` calls `required("PLATFORM_DATABASE_URL")` — the app could not start from a fresh copy of this file), added `DEV_ALLOWED_ORIGINS`, and updated the Resend From default. The four database entries now carry the isolation rationale inline.

**Process layer**
- `.claude/agents/*.md` (9 files) — the "You are X for the Claude Code Starter" identity line
- `eslint.config.mjs`, `docs/ui-standards.md`, `docs/reviews/log.md` — headers and scope lines

## Schema Changes

None.

## Audit Events

None — no mutation touched.

## Implementer Notes

The `.env.example` gap was found while writing the README env table: documenting
the four connection strings against a file that listed one made the omission
obvious. That file is the only setup instruction a new clone gets, and it was
missing two required variables.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-18
**Verified by:** qa (inline)

## Type Check

`npm run typecheck`: PASS · `npm run lint`: PASS (`--max-warnings=0`)

## Unit Tests

Total: 424 | Passed: 424 | Failed: 0

## Production Build

PASS — 26 routes generated.

## Running-Server Smoke

Dev server started against `.env.local`; landing page served and inspected:

- `<h1>` renders `presby`, blurb and pre-release line present
- `<title>` is `presby`
- `/signin` returns 200
- Zero occurrences of the old identity string in the served HTML

## End-to-End Tests

**6 passed, 42 skipped of 48.** This is a limitation, not a pass.

`globalSetup` skipped all three seeded users — `SEED_ADMIN_EMAIL`,
`SEED_MEMBER_EMAIL`, and `SEED_MFA_ADMIN_EMAIL` are unset in this machine's
`.env.local` — so every authenticated spec skipped. **The global nav and the
admin shell back link were therefore not exercised by a browser**; only the
unauthenticated surfaces were.

Judgment: acceptable for this diff. Both unverified changes are static text in
server components with no logic, no props, and no conditional rendering, and the
served-HTML check confirmed the old string appears nowhere in the build. This
would not be acceptable for a behavioral change.

Worth surfacing separately: a local `npm run test:e2e` silently skips 87% of
itself when the seed vars are unset, and still exits green. Prior release notes
citing "48/48" came from a differently-configured session. Logged to
`docs/TODO.md`.

## Regression Tests Added

None. The `two-factor.test.ts` assertion was strengthened rather than added:
`toContain("Claude%20Code%20Starter")` → an anchored check of both issuer
positions in the otpauth URL.

## Feature-Gate Audit

No protected routes touched. No route handler, server action, or permission
check was modified.

## Verdict

PASS

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

SHIP IT

## ONE-LINE TAKE

> The repo now introduces itself as presby everywhere a human meets it — README,
> landing page, navigation, admin shell, outbound email, and the label in the
> authenticator app — without falsifying any of the places where "the starter"
> is a true statement about where the code came from.

## Intent-vs-Shipped Diff

- Phase 1 said: fix the seven audience-facing surfaces, leave skills, history,
  and provenance comments alone. Shipped: exactly that, plus `.env.example`,
  which Phase 1 had not identified as an identity surface and which turned out
  to have a functional defect (two required variables missing). Verdict:
  acceptable drift — the addition is in scope for "a new clone can start", and
  it is recorded above.

## Edge Cases

- Empty state: not applicable
- Failure microcopy: not applicable
- Permission gate: not applicable — no gate touched
- Audit event: not applicable
- Mobile (360px): not applicable — no layout or CSS changed; text-length changes
  only, within existing containers

## Follow-Ups

- Local e2e skips 42 of 48 specs when the seed vars are unset, and exits green
  anyway → `docs/TODO.md`
- The deck (`deck/slides.md`) is a Claude Code training deck whose footer points
  at the canonical starter repo. It was deliberately left alone: its subject
  really is the starter workflow. Whether that deck belongs in this repo at all
  is an open question for the operator → `docs/TODO.md`
