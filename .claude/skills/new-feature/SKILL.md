---
name: new-feature
description: Walk a new feature through the 6-phase pipeline — gather intent, kick off Phase 1, and produce a work-log entry before any code is written
argument-hint: "[feature-name]"
---

# New Feature

When the user invokes `/new-feature`, do not write implementation code. Instead, gather intent, scaffold a work-log entry, and hand off to Phase 1 of the pipeline.

The feature name may be provided as `$ARGUMENTS`.

## The Pipeline

Every feature in this starter flows through the same six phases (see `CLAUDE.md` for the full definition). At a glance:

| Phase | Owner | Output |
|-------|-------|--------|
| 1 — Functional refinement | `analyst` | User-verbs, flows, gaps the request didn't address |
| 2 — Architectural review | `architect` | Verdict on where the work lives and whether dependencies are needed |
| 3 — Technical design | `tech-lead` | Design doc with API contract, data model, implementation order |
| 4 — Implementation | `database-admin`, `api-developer`, `ux-developer`, or `full-stack-developer` | Working code, schema changes, audit events |
| 5 — Verification | `qa` | Type check, unit tests, e2e tests, PASS/FAIL verdict |
| 6 — Shipped vs intent | `analyst` | Final SHIP IT verdict comparing the build to the Phase 1 description |

A SHIP IT from Phase 6 is the only verdict that closes a feature.

## Step 1: Gather Intent

Ask the user (if not already provided):

1. **Feature name** — short, slug-friendly (e.g., "API keys", "team invites").
2. **Surface** — public, member-only, admin-only, or a mix.
3. **Value** — why this feature matters. The problem it solves or the user need it serves. *Required.*
4. **User verbs** — what does the user *do*? (See the analyst agent's Phase 1 rubric.)
5. **Permissions** — does it need a new `FEATURES` key? If so, which roles get it?
6. **Flags** — should it ship behind a feature flag for staged rollout?
7. **Complexity estimate** — small (one afternoon), medium (a day or two), or large (a week or more).

## Step 2: Create the Work-Log Entry

Today's date is the slug prefix. Create `docs/work-log/YYYY-MM-DD-<feature-slug>.md` from `docs/work-log/_template.md`. Fill in the metadata block.

```bash
cp docs/work-log/_template.md docs/work-log/2026-05-16-api-keys.md
```

Then edit the new file to set:

- **Slug**, **Title**, **Surface**, **Permission(s)**, **Flag(s)**, **Estimated complexity**.
- The **Per-Phase Status** table starts with Phase 1 as "In progress" and everything else "Pending".
- The **Phase 1 — Functional Refinement** section is the next thing to write.

## Step 3: Recommend Pipeline Mode

Based on complexity, recommend a mode:

- **Small** — accelerated pipeline. Phase 1 brief; Phase 2 may be skipped if the work is obviously within existing structure; Phase 3 may be a paragraph; Phase 4 + 5 + 6 still run.
- **Medium** — full pipeline.
- **Large** — full pipeline, and break the work into multiple work-log entries (one per phase or per shipping increment).

**A small feature is not a skip.** It's a speed optimization. Phases 4, 5, and 6 always run.

## Step 4: Hand Off to Phase 1

Tell the user: "Phase 1 starts now. I'll invoke the analyst agent to refine [feature name] before tech-lead designs it."

Then invoke the `analyst` agent with the user's intent description. The analyst writes the Phase 1 section of the work-log.

## Important

This skill **never writes implementation code**. It produces the work-log entry and hands off. The first line of actual code is written in Phase 4, after Phase 3's design exists.

## Summary

When you finish, the user should see:

- A new file at `docs/work-log/YYYY-MM-DD-<slug>.md` with the metadata block filled in.
- Phase 1 status set to "In progress".
- A clear pointer to the next step ("invoke analyst").
- Estimated path through the pipeline and which agents will be involved.
