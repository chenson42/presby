# Documentation Review — 2026-05-17

**Reviewer:** tech-lead
**Scope:** CLAUDE.md, README.md, docs/decisions.md, .env.example, docs/work-log/_template.md, docs/release-notes/v*.md, .claude/agents/*.md, .claude/skills/*/SKILL.md, deck/slides.md
**Period covered:** Initial run (no prior documentation review)
**Current version:** 0.3.1

---

## Summary

The README and agent files are largely accurate and reflect v0.3 well. The biggest drift is in `CLAUDE.md` itself, which describes v0.1's feature surface and is missing two commands that exist in `package.json`. Several minor cross-reference errors exist in historical release notes and decisions that are frozen records rather than live guidance.

**Totals:** 3 critical · 4 notable · 5 minor · 3 observations

---

## Critical — Must fix before this doc is handed to a fork

### C-1: CLAUDE.md "What This Starter Gives You" describes v0.1, not v0.3

`CLAUDE.md` lines 15–25 still enumerate only the v0.1 features (auth, TOTP, roles, flags, admin shell, audit, release notes, route protection, seed). Five v0.3 additions are entirely absent:

- Self-serve `/account` page (profile, email change with verification, password change, 2FA enrollment, delete-account skeleton)
- Forgot-password flow (`/forgot-password`, `/reset-password`)
- Toast notifications via Sonner (`<Toaster>` in root layout)
- Rate limiting (`src/lib/rate-limit.ts`, in-memory + optional Upstash Redis)
- `ActionResult<T>` type in `src/types/actions.ts`

A developer forking from `CLAUDE.md` alone will not know these features exist.

### C-2: CLAUDE.md "Common Commands" is missing two commands from `package.json`

`package.json` scripts include `db:migrate` and `check:audit`; neither appears in the Common Commands block (lines 270–286). The README correctly lists both. An agent or developer reading only `CLAUDE.md` will not know these exist.

- `npm run db:migrate` — apply committed SQL migrations (production-safe alternative to `db:push`)
- `npm run check:audit` — tripwire that every `actions.ts` mutation has an audit row

### C-3: CLAUDE.md "Project Layout" omits three v0.3 route groups

The `src/app/` tree in the Project Layout (lines 56–86) shows only `(auth)/`, `(admin)/`, `access-pending/`, and `api/`. Three live route groups introduced in v0.3 are missing:

- `(account)/account/` — self-serve account page
- `(email-verify)/account/verify-email/[token]/` — email verification landing
- `(password-reset)/` — forgot-password and reset-password pages

---

## Notable — Meaningful drift; should be fixed

### N-1: CLAUDE.md TOC link `#how-this-user-works` is a broken anchor

The section header in CLAUDE.md reads `## How Claude Should Behave in This Repo` (line 27), but the TOC (line 5) links to `#how-this-user-works`. GitHub Markdown generates anchors from the actual heading text, so the TOC link is dead.

### N-2: DECISION-001 documents `DATABASE_URL_UNPOOLED` as required, but it is not in `.env.example` and `drizzle.config.ts` uses only `DATABASE_URL`

DECISION-001 (line 84) states "The fork needs two environment variables (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`)." However:
- `drizzle.config.ts` uses only `process.env.DATABASE_URL`
- `.env.example` has no `DATABASE_URL_UNPOOLED` entry
- The README env-var table has no `DATABASE_URL_UNPOOLED` entry

The decision text is now stale — either the unpooled var was removed at some point and the decision not updated, or the decision was always aspirational and never implemented. Either way, the decision says one thing and the code does another.

### N-3: v0.1 release notes still reference `src/middleware.ts` as a live file

`docs/release-notes/v0.1.md` lines 29 and 62 list `src/middleware.ts` as a file that was added. The file does not exist in `src/` — only `src/proxy.ts` exists. CLAUDE.md (line 24) correctly notes the `middleware.ts` was replaced by `proxy.ts`. The release notes are a historical record, but if the admin docs viewer renders all release note files and users read them as documentation, this creates confusion.

### N-4: Deck slide claims "5 skills" — there are now 6

`deck/slides.md` line 376: "The starter ships with 5 skills in `.claude/skills/`:" — lists 5. The actual directory has 6: `add-permission`, `neon-postgres`, `new-feature`, `personalize-starter`, `pre-push`, `release-notes`. The `personalize-starter` skill is omitted from the deck's list entirely.

---

## Minor — Small inaccuracies; low reader impact

### m-1: CLAUDE.md mentions `FEATURES` as the static catalog; the code calls it `FEATURE_CATALOG`

Lines 19 and 25 of CLAUDE.md both reference "the static catalog" — line 19 says `FEATURES` is the static catalog, while line 25 says "seeds every feature in `FEATURE_CATALOG`." In `src/lib/permissions.ts`, `FEATURES` is the key-to-string map and `FEATURE_CATALOG` is the catalog array. The description is imprecise but not wrong enough to cause failures; a reader could be confused about which object does which job.

### m-2: CLAUDE.md "The Middleware Cannot Import" invariant title is a relic

The Key Invariants section heading reads "The Middleware Cannot Import `@/lib/db`" (line 319). The file is `proxy.ts`, not middleware. The body text correctly says `src/proxy.ts runs on the Edge runtime`, but the heading still says "Middleware." A fork reading the heading alone may look for a `middleware.ts` that doesn't exist.

### m-3: `qa.md` still has a stale parenthetical in its `description` YAML

The `qa.md` description field (line 3 of the YAML frontmatter) ends with: "Note: the starter does not ship with a test runner configured — qa describes what to do *when* tests are added and what the right defaults are for this stack." The body of `qa.md` (line 14) correctly contradicts this: "The starter ships **both** test runners pre-configured." The stale note is in the YAML `description` — the part visible to the agent-selection system. This is the specific issue the review task asked to verify; it was fixed in the body but **not in the frontmatter `description`**.

### m-4: `docs/decisions.md` DECISION-005 says "flag this for review at the next 30-day documentation review" — flag is now live

DECISION-005 (line 29) reads: "Flag this for review at the next 30-day documentation review." This is the first documentation review. The question: is the PDF blob accumulation rate acceptable? Answer (observation): at 1 committed snapshot (initial check-in of the rendered deck), it is fine. No action required on the decision itself; the flag can be considered reviewed.

### m-5: `docs/release-notes/v0.3.md` does not have a "← v0.2" back-link; v0.2 does not have a "→ v0.3" forward link

The `release-notes` skill SKILL.md (line 57) says "add a nav link at the bottom of the previous file: → [v0.3](v0.3.md)". Neither v0.2.md nor v0.3.md has these navigation links. The admin docs viewer may render them fine regardless, but the inter-file navigation pattern specified by the skill is missing.

---

## Observations — Not inaccurate but worth noting

### O-1: `.env.example` Upstash vars are commented out; README shows them as normal rows

In `.env.example` (lines 53–57), `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are commented out (prefixed with `#`). The README env table lists them as normal rows without indicating they ship commented-out. Not wrong, but a `cp .env.example .env.local` gives a local that already has `RATE_LIMIT_DISABLED` commented out too — a new developer may not notice the opt-in pattern.

### O-2: `docs/work-log/_template.md` is accurate and matches real work-logs

Template checked against `2026-05-17-account-page.md` structure. No drift found. No action needed.

### O-3: `DECISION-004` references "fertilityluna" as the sibling anchor for version pinning

This is intentional (the decision is a record of the author's policy), but any fork reading this decision will see a private repo name as the version source of truth. Not a bug, but forks should be aware this decision will need rewriting to point at their own sibling project (or to a public anchor like the Next.js release page).

---

## File Reference Map

| File | Finding(s) |
|------|-----------|
| `CLAUDE.md` | C-1, C-2, C-3, N-1, m-1, m-2 |
| `.env.example` | N-2 (indirectly), O-1 |
| `docs/decisions.md` | N-2, m-4, O-3 |
| `docs/release-notes/v0.1.md` | N-3 |
| `docs/release-notes/v0.2.md` | m-5 |
| `docs/release-notes/v0.3.md` | m-5 |
| `.claude/agents/qa.md` | m-3 |
| `deck/slides.md` | N-4 |
| `docs/work-log/_template.md` | O-2 (clean) |
| `README.md` | No findings |
