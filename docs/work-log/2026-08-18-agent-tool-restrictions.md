# Tool-Restrict the Judgment Agents — Work Log

> **Slug:** `2026-08-18-agent-tool-restrictions`
> **Surface:** none (process layer — `.claude/agents/`, CLAUDE.md)
> **Permission(s):** none
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Polish / process class — Phase 2 skipped (no app dependency,
> no directory, no runtime change); Phase 3 is the table below

> **Agent note:** operator instruction in effect not to spawn subagents; phases
> executed inline. This pipeline is about what agents *may do* once they are
> turned on.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst (inline) | Complete | READY WITH NOTES | 2026-08-18 |
| 2 — Architectural review | architect | Skipped — process layer only | — | 2026-08-18 |
| 3 — Technical design | tech-lead (inline) | Complete | — | 2026-08-18 |
| 4 — Implementation | full-stack-developer (inline) | Complete | — | 2026-08-18 |
| 5 — Verification | qa (inline) | Complete | PASS | 2026-08-18 |
| 6 — Shipped vs intent | analyst (inline) | Complete | SHIP IT | 2026-08-18 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> Nine agent definitions declare no `tools:`, so every one inherits Edit and
> Write — including the two whose entire job is to judge someone else's work.

## The problem

`qa.md` line 10 says "You do not write feature code." `analyst.md` line 13 says
"You do not write code, design schemas, or pick component libraries." Both are
prose. Neither is enforced, because absent a `tools:` list an agent inherits the
full tool set.

The concrete risk is Phase 5. QA's output is a PASS/FAIL verdict that CLAUDE.md
treats as a gate. An agent holding Edit that meets a failing test can make the
test pass instead of reporting FAIL, and the work-log will read like a clean
run. Flagged as **E5** in `docs/reviews/2026-08-09-fable-external-review.md`:
*"'analyst does not write code' is prose while analyst has Write/Edit/Bash."*

## What the fix actually required

Restricting tools is one line per file. Making the restriction *survivable* was
not, because two things in the current design assume write access:

1. **Every agent is told to fill in its own work-log section.** analyst.md:81,
   architect.md:67, qa.md:83 all say "Fill in your phase's section". A read-only
   agent cannot. Resolved by inverting the handoff: judgment agents **return**
   their section as their final message and the orchestrator writes it in.
   Implementers and tech-lead keep writing directly — they are producing
   artifacts, not verdicts about their own work.

2. **QA was chartered to author tests** ("writes/extends Vitest + Playwright
   coverage"). Authoring tests requires exactly the tool that enables tampering.
   Operator decision, 2026-08-18: **QA becomes verification-only.** Test
   authorship moves to the implementer, which Phase 4 already half-required —
   the Bug-Fix Variant says the implementer "writes the fix and a
   failing-then-passing regression test."

## The honest limit of this change

**Bash can write files.** `echo >`, `sed -i`, and `cat > file` are all available
to an agent that holds Bash, and every restricted agent needs Bash to run `git
diff`, `npm test`, and `psql`. So this is not an airtight sandbox and should not
be described as one.

What it does buy:

- the *ergonomic* path to mutation is gone — no Edit, no Write
- a mutation now requires a deliberately odd shell command, which is conspicuous
  in a transcript and in review
- the prose rule and the tool grant finally agree with each other

Calling it "free enforcement" (as the review did) oversells it. It is a
meaningful narrowing, not a guarantee.

## Gaps the Request Didn't Address

- **Model tiering.** All nine remain `model: sonnet`. E5 also asked for that to
  be documented or varied; the adversarial phases (analyst at Phase 6, architect
  on invariants) are the obvious candidates for a stronger tier. Left open.
- **full-stack-developer's charter** (14 uses against a "~<150 lines" remit) is
  the third part of E5 and is untouched here.

## Open Questions

None.

---

# Phase 2 — Architectural Review (architect)

**Skipped.** Process layer only: no application dependency, no directory, no
runtime boundary, no schema.

---

# Phase 3 — Technical Design (tech-lead)

## The grant table

Only tool names verified present in this Claude Code build are used. `Grep` and
`Glob` are deliberately **not** listed — this build has no such tools, search
runs through `Bash`, and naming a tool that does not exist would be cargo cult.

| Agent | Tools | Why |
|---|---|---|
| **analyst** | `Read, Bash` | Phases 1 and 6 are pure judgment. Reads the code and the diff; produces text. |
| **architect** | `Read, Bash, WebFetch, WebSearch` | Same, plus dependency evaluation genuinely needs to look a package up. |
| **qa** | `Read, Bash` | Runs every suite; reads route bodies for the feature-gate audit; cannot touch a test or a source file. |
| **tech-lead** | `Read, Write, Edit, Bash, WebFetch, WebSearch` | Authors design docs, release notes, retrospectives. Not a verdict on its own code. |
| **database-admin** | `Read, Write, Edit, Bash` | Implementer. |
| **api-developer** | `Read, Write, Edit, Bash` | Implementer. |
| **ux-developer** | `Read, Write, Edit, Bash` | Implementer. |
| **full-stack-developer** | `Read, Write, Edit, Bash` | Implementer. |
| **deployment-engineer** | `Read, Write, Edit, Bash, WebFetch, WebSearch` | Fixes build/env failures; checks advisories. |

## Files to Modify

- 9 × `.claude/agents/*.md` — `tools:` line; restricted agents also get a short
  "Why you cannot write" note and a rewritten Output section
- `CLAUDE.md` — the handoff paragraph, the Phase 5 output line, and the roster
  note about who writes the work-log
- `docs/TODO.md` — E5 partially closed

## Implementer

full-stack-developer (inline).

---

# Phase 4 — Implementation

## Files Modified

**All nine `.claude/agents/*.md`** — `tools:` added per the Phase 3 table.

**The three read-only agents** additionally:
- "When You're Done" rewritten: return the section as the final message, with the
  reason stated (an agent that can edit what it judges is not a check) and the
  `Bash` caveat named rather than glossed
- `qa.md` charter — description and body now say verification-only; missing
  coverage is a **FAIL naming the gap**, not something QA quietly fixes
- `qa.md` + `architect.md` review sections — they own periodic reviews but cannot
  write `docs/reviews/`; they return the log line and detail body instead

**The four implementers** gained a "Tests Are Yours" section: they author unit
and e2e coverage, QA runs it, and a bug fix still means failing-test-first.

**`CLAUDE.md`** — roster note explaining the split, Phase 4 gate ("tests written
by the implementer"), Phase 5 output ("returned as text… verification-only"), the
Per-Feature Tracking handoff sentence, and the qa roster row.

## Also fixed while in the file

`qa.md` carried stale e2e instructions from before today's work — "requires
`npm run dev` already running; Playwright does NOT spawn the server" and "loads
`.env.local` for the seeded-user credentials (`SEED_ADMIN_EMAIL` etc.)". Both
became false this morning (DECISION-032, and the `webServer` block). An agent
briefed with false setup instructions burns its run rediscovering the truth, so
they now describe the fixture roster and the `RATE_LIMIT_DISABLED` precondition —
plus a line that a skipped spec is a finding, not a pass.

## Schema Changes

None.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-18
**Verified by:** qa (inline)

## Frontmatter

All nine files parse: `name`, `description`, `tools`, `model`, `color` present in
every one. Only tool names verified present in this build are used — `Grep` and
`Glob` are deliberately absent, since this build has no such tools.

## Consistency sweep

`grep` for write-shaped instructions (`fill in`, `write \`docs/…\``, `log in
docs/reviews`) across the three read-only agents returns **nothing** — no agent
is now told to do something its grant forbids.

## Repo checks

`typecheck` PASS · `lint` PASS · 434 unit tests PASS · `check:audit` +
`check:sql-date` PASS. (No application code changed; run as a regression guard.)

## Not verified

**No agent has actually been spawned under the new grants.** The operator
instruction against subagents is still in force, so this change is verified by
inspection, not by exercise. The first real run is the test.

## Verdict

PASS

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

SHIP IT

## ONE-LINE TAKE

> The three agents that judge other agents' work can no longer edit it, and the
> instructions they carry finally match the tools they hold.

## Intent-vs-Shipped Diff

- Phase 1 said: restrict tools, and change what depends on write access. Shipped:
  both, plus the stale e2e briefing in `qa.md` — unplanned, found in the file, and
  worth more than the frontmatter line it sat next to. Verdict: matches.
- Phase 1 said this is a narrowing and **not** a sandbox, because `Bash` can
  write. That is stated in the agent files and in CLAUDE.md rather than being
  quietly dropped once it became inconvenient.

## Follow-Ups

- E5's other two parts remain open: model tiering (all nine still `sonnet`) and
  `full-stack-developer`'s outgrown charter → `docs/TODO.md`
