# Functionality Map (harvest from huddleup.health) — Work Log

> **Slug:** `2026-07-12-functionality-map`
> **Surface:** none (docs + SessionStart hook + instruction wiring)
> **Permission(s):** n/a
> **Flag(s):** n/a
> **Estimated complexity:** small
> **Pipeline mode:** Accelerated / process harvest — Phases 2 & 3 skipped (ports a proven pattern verbatim from huddleup.health; no new deps, no schema change, no app-API surface change; one read-only hook script)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | main session (inline) | Complete | READY FOR DESIGN | 2026-07-12 |
| 2 — Architectural review | architect | Skipped — proven sibling pattern, no structural change | — | 2026-07-12 |
| 3 — Technical design | tech-lead | Skipped — design is the huddleup implementation, ported | — | 2026-07-12 |
| 4 — Implementation | main session | Complete | — | 2026-07-12 |
| 5 — Verification | main session (inline) | Complete | PASS | 2026-07-12 |
| 6 — Shipped vs intent | user | Pending | — | — |

---

# Phase 1 — Functional Refinement (inline)

**User request:** harvest the "functional map in context" workflow improvement from `../huddleup.health`.

**What the pattern is (source: huddleup.health, operator directive 2026-07-12 there):**
- `docs/product/functionality-map.md` — a living, one-line-per-capability inventory of everything built (surface + primary file as jump-off point), with a short `## Index` block at the top and the full map below. Version-stamped.
- `scripts/functionality-map.mjs` — SessionStart hook that prints ONLY the short Index block, so every session starts knowing what exists without re-reconning the codebase. Always exits 0; silently skips if the map is missing.
- CLAUDE.md wiring: the full map is a required read before proposing/scoping any feature; a Workflow Rule requires updating the map at ship time in the same housekeeping cluster as release notes / TODO reconciliation; the documentation review is the backstop, not the update mechanism.
- `/release-notes` skill is the natural ship-time update point.

**Why it fits the starter:** sessions repeatedly re-recon the codebase to learn what exists; CLAUDE.md's Capability Map is a summary, not a file-level jump-off map. The hook prints a compact index (~25 lines) — cheap context for high recon savings. `docs/product/` already exists as a convention (personalize-starter creates vision/business-plan/branding there).

**Port scope:** hook script (path convention identical), starter-specific map content surveyed from the actual repo, settings.json hook registration, CLAUDE.md Rule 14 + required-read pointer + layout-tree lines, `/release-notes` Step 4 addition, personalize-starter note (map survives fork personalization — it describes inherited features).

**Out of scope:** huddleup's `scripts/cadence-check.mjs` (automated review-cadence math at session start) — noted as a separate follow-up candidate in `docs/TODO.md`.

---

# Phase 4 — Implementation

## Files Created

- `docs/product/functionality-map.md` — starter map, surveyed from the live repo (routes, actions, lib modules, flags, permissions keys all verified against source, not guessed); version-stamped `0.6.0 · 2026-07-12`.
- `scripts/functionality-map.mjs` — SessionStart hook printing the short Index only; always exits 0; silently skips when the map is absent. One improvement over the huddleup original: strips a trailing horizontal rule from the printed block.

## Files Modified

- `.claude/settings.json` — hook registered after `feedback-check.mjs`.
- `CLAUDE.md` — Capability Map now names the map as the file-level jump-off + required read before scope work; **Workflow Rule 14** added (update at ship time, release-notes skill is the natural place, documentation review is the backstop); layout tree lines for `docs/product/functionality-map.md` and the hook.
- `.claude/skills/release-notes/SKILL.md` — Step 4 gains the Rule 14 map-update bullet (incl. version/surveyed stamp bump).
- `.claude/skills/personalize-starter/SKILL.md` — map survives fork personalization (describes inherited features); only the header name changes.
- `docs/TODO.md` — Done line; follow-up filed for the second harvest candidate spotted (`scripts/cadence-check.mjs`).

## Schema Changes

None.

## Audit Events

n/a (hook is read-only and prints no member-supplied content — it reads only the checked-in map doc).

---

# Phase 5 — Verification (inline)

`node scripts/functionality-map.mjs` prints the 9-bullet Index and exits 0; with the map temporarily absent it exits 0 silently (guard verified by code path — identical to the huddleup original proven in production there). Map content spot-verified against `find src/app` route inventory, `src/lib` listing, `FEATURES` keys, and seeded flag keys gathered before writing. **PASS.**

# Phase 6 — Shipped vs Intent

Pending user review at commit time.
