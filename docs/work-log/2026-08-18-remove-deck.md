# Remove the Training Deck — Work Log

> **Slug:** `2026-08-18-remove-deck`
> **Surface:** none (repo content + tooling)
> **Permission(s):** none
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Polish / removal class — Phase 2 skipped (removal only; no
> dependency added, no directory added, no boundary moved); Phase 3 is the file
> list below

> **Agent note:** operator instruction in effect not to spawn subagents; phases
> executed inline.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst (inline) | Complete | READY FOR DESIGN | 2026-08-18 |
| 2 — Architectural review | architect | Skipped — removal only | — | 2026-08-18 |
| 3 — Technical design | tech-lead (inline) | Complete | — | 2026-08-18 |
| 4 — Implementation | full-stack-developer (inline) | Complete | — | 2026-08-18 |
| 5 — Verification | qa (inline) | Complete | PASS | 2026-08-18 |
| 6 — Shipped vs intent | analyst (inline) | Complete | SHIP IT | 2026-08-18 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY FOR DESIGN

## ONE-LINE TAKE

> `deck/` is a Claude Code training deck that arrived with the starter; presby
> is a church platform and does not carry a deck about a different subject.

## Why

Operator decision, 2026-08-18, answering the open question raised during the
identity pass: *does `deck/` belong in presby?* Answer: no.

The deck's own frontmatter says what it is — header "Working with Claude Code",
footer `github.com/chenson42/claudecode-nextjs-starter`. It teaches the starter's
workflow. It was never about congregations, rolls, or polity. Keeping it meant
carrying a rule in CLAUDE.md, a housekeeping check in `/pre-push`, four npm
scripts, and 9.9 MB of committed binaries for an artifact this project does not
present.

## What removal touches beyond the directory

The deck is not just files; it has process attached:

- CLAUDE.md carries a behavior rule ("Re-render the deck whenever `deck/slides.md`
  changes") and four commands
- `/pre-push` has a deck-staleness housekeeping check
- `package.json` has four `deck:*` scripts (they shell out via `npx --yes`, so
  there is no dependency to remove)
- `docs/decisions.md` DECISION-005 decided the rendered PDF is committed
- The functionality map lists the deck under dev-loop tooling

Leaving any of these behind produces a rule referencing a directory that no
longer exists — which is exactly the drift the documentation review keeps
finding.

## Out of Scope

- **Git history keeps the deck blobs.** Removing the files does not shrink the
  repository's history, and no history rewrite is proposed: the repo is already
  pushed, the content is not sensitive, and rewriting shared history to reclaim
  ~10 MB is a bad trade.
- **`/personalize-starter` and `/upstream-sync` mention the deck.** Both are
  starter-relationship skills; `personalize-starter` already handles the "no
  deck" case by deleting the directory, which is now a no-op. Left alone, for
  the same reason the identity pass left them alone.

## Open Questions

None.

---

# Phase 2 — Architectural Review (architect)

**Skipped.** Removal only. No dependency, directory, boundary, or schema change.

---

# Phase 3 — Technical Design (tech-lead)

## Files to Delete

- `deck/` — `slides.md`, `slides.pdf`, `slides.pptx` (untracked), `README.md`

## Files to Modify

- `package.json` — drop `deck`, `deck:pptx`, `deck:pdf`, `deck:html`
- `CLAUDE.md` — drop the re-render behavior rule and the four command lines
- `.claude/skills/pre-push/SKILL.md` — drop the deck-staleness check from Step 7
- `.gitignore` — drop the `deck/slides.pptx` entry
- `docs/decisions.md` — mark DECISION-005 **Superseded**, and add DECISION-031
  recording the removal (decision numbers never change; the old entry stays
  readable)
- `docs/product/functionality-map.md` — drop "Marp deck" from dev-loop tooling
- `docs/TODO.md` — close the open question, drop the stale cadence-slide item

## Edge Cases & Risks

- Nothing imports the deck; no build step reads it. Zero runtime risk.
- The `docs/release-notes/*` entries that mention the deck are history and stay.

## Implementer

full-stack-developer (inline).

---

# Phase 4 — Implementation

## Files Deleted

- `deck/README.md`, `deck/slides.md`, `deck/slides.pdf` (tracked); `deck/slides.pptx` was gitignored

## Files Modified

- `package.json` — four scripts removed
- `CLAUDE.md` — behavior rule + four commands removed
- `.claude/skills/pre-push/SKILL.md` — housekeeping check removed
- `.gitignore` — pptx entry removed
- `docs/decisions.md` — DECISION-005 marked Superseded by DECISION-031; DECISION-031 added
- `docs/product/functionality-map.md` — dev-loop tooling line
- `docs/TODO.md` — both deck lines removed, Done entry added

## Schema Changes

None.

## Implementer Notes

No dependency removal was needed: the scripts invoked Marp through
`npx --yes @marp-team/marp-cli`, so nothing was ever installed in the project.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-18
**Verified by:** qa (inline)

## Type Check / Lint / Build

`npm run typecheck`: PASS · `npm run lint`: PASS · `npm run build`: PASS

## Unit Tests

424 passed, 0 failed — unchanged, as expected for a change nothing imports.

## Dangling-Reference Sweep

`grep -rniE "deck|marp"` across all live files (excluding history: release
notes, past reviews, past work-logs, and the starter-relationship skills)
returns no reference to a path that no longer exists.

## Verdict

PASS

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

SHIP IT

## ONE-LINE TAKE

> The deck is gone, and so is every rule, script, and check that existed only to
> serve it.

## Intent-vs-Shipped Diff

- Phase 1 said: remove the directory and everything attached to it. Shipped:
  that, plus DECISION-031 so the reversal of DECISION-005 is recorded rather
  than silently contradicted. Verdict: matches.

## Edge Cases

- Empty state / microcopy / permission gate / audit / mobile: not applicable —
  no user-facing surface touched.

## Follow-Ups

None.
