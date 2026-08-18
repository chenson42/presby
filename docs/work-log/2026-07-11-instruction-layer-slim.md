# Instruction-Layer Slim — Work Log

> **Slug:** `2026-07-11-instruction-layer-slim`
> **Surface:** none (docs + `.claude/` instruction layer only)
> **Permission(s):** n/a
> **Flag(s):** n/a
> **Estimated complexity:** small
> **Pipeline mode:** Polish / visual / refactor — Phases 2 & 3 skipped (no new deps, no schema change, no API surface change; doc/instruction rewrite only)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (inline) | READY FOR DESIGN | 2026-07-11 |
| 2 — Architectural review | architect | Skipped — no structural change | — | 2026-07-11 |
| 3 — Technical design | tech-lead | Skipped — findings doc is the design | — | 2026-07-11 |
| 4 — Implementation | main session | Complete | — | 2026-07-11 |
| 5 — Verification | main session (inline) | Complete | PASS (doc-only) | 2026-07-11 |
| 6 — Shipped vs intent | user | Complete | SHIP IT | 2026-07-11 |

---

# Phase 1 — Functional Refinement (inline)

User request: review CLAUDE.md, agents, skills, and the review cadence for efficiency; then rewrite. Findings from the review session (this doubles as the agent-instruction + documentation periodic reviews; detail file: `docs/reviews/2026-07-11-agent-instruction.md`):

1. **Duplication (~35–40%)** — 25-line handoff template pasted into all 9 agent files and conflicting with `docs/work-log/_template.md`; permissions-vs-flags explained in 6 places; auth-gate snippet in 3 implementer agents; directory tree in CLAUDE.md and architect.md; env-var table in deployment-engineer vs `.env.example`; pre-push checklist duplicated in deployment-engineer.
2. **Drift in stale copies** — architect.md tree missing 4 route groups; qa.md says post-login lands on `/` (now `/home`); analyst.md references `/signin/totp` (route is `/totp`); reviews/log.md entries out of newest-first order; `_template.md` Phase 5 verdict missing BLOCKED and the feature-gate audit section.
3. **Review cadences aspirational** — 7-day reviews ran once in 8 weeks; 30-day reviews run in batch sessions anyway. Consolidate to two slots: release slot (14 d: test-coverage + retrospective) and monthly health-check (30 d: code + documentation + security + agent-instruction + dependencies). Fork-only syncs unchanged.
4. **Always-on context cost** — agent frontmatter `description` fields carry two `<example>` blocks each (~150 lines injected every session); CLAUDE.md carries a ~70-line feature catalog that is README material.

## Scope of the rewrite

- CLAUDE.md 451 → ~300–350 lines (catalog compressed, invariants single-sourced, pipeline tightened, review slots consolidated). Workflow Rule numbering preserved (rules are referenced by number elsewhere).
- All 9 agent files: descriptions to 1–2 sentences (no examples); handoff template replaced by a pointer to `docs/work-log/_template.md`; stale content fixed; duplicated snippets replaced by pointers.
- `docs/work-log/_template.md`: Phase 5 gets BLOCKED verdict + Feature-Gate Audit section.
- `docs/reviews/log.md`: ordering fixed, cadence header updated, two review entries appended.
- upstream-sync / downstream-sync skills: "Known Untested Paths" essays condensed.
- No behavioral rule is dropped — only single-sourced or compressed.

---

# Phase 4 — Implementation

## Files Modified

- `CLAUDE.md` — 451 → ~330 lines; feature catalog → README pointer + capability map; permissions-vs-flags single-sourced to Key Invariants; ASCII diagram → one sentence; Periodic Reviews → two-slot model; all 13 Workflow Rules and all 6 phase gates preserved (Rules 6/7 now point/reference rather than restate).
- `.claude/agents/*.md` (all 9) — descriptions to 1–2 sentences (no `<example>` blocks); handoff template → pointer to `docs/work-log/_template.md`; stale fixes: architect tree → CLAUDE.md pointer + current route groups (incl. `api/webhooks`, DECISION-028), qa `/` → `/home` landing, analyst `/signin/totp` → `/totp`, api-developer raw `db.insert(auditEvents)` → `recordAudit()`; full-stack-developer cut to a thin composition of the two implementers; deployment-engineer → `/pre-push` as canonical checklist, `.env.example` as canonical env inventory; qa + tech-lead cadences updated to slots.
- `docs/work-log/_template.md` — Phase 5 verdict `PASS | FAIL | BLOCKED`; Feature-Gate Audit table added; auth-touching note added.
- `docs/reviews/log.md` — newest-first ordering fixed; header rewritten around the two slots; 2 entries appended (agent-instruction, documentation).
- `docs/reviews/2026-07-11-agent-instruction.md` — review detail file (new).
- `docs/decisions.md` — DECISION-029 (slot consolidation + single handoff format).
- `.claude/skills/upstream-sync/SKILL.md`, `.claude/skills/downstream-sync/SKILL.md` — "Known Untested Paths" condensed to one paragraph each, content preserved.
- `docs/TODO.md` — Done line + 2 follow-ups (`.env.example` reconciliation, deck cadence-slide check).

## Schema Changes

None (doc/instruction layer only).

## Audit Events

n/a.

---

# Phase 5 — Verification (inline)

Doc-only change: no typecheck/build/tests apply. Verification performed by rule-preservation check — all 13 Workflow Rules retained with original numbering; all 6 phase gate definitions retained in meaning; the qa auth-touching stricter gate and feature-gate audit retained verbatim in intent (and now also present in the template); grep sweep for dangling references to removed/renamed content (see Phase 4 handoff). **PASS.**

# Phase 6 — Shipped vs Intent

**SHIP IT** — the user reviewed the findings and diff and approved commit + push (`ecc5d2d`, pushed to main 2026-07-11 after a green `/pre-push`). Shipped matches intent: instruction layer slimmed ~40% with all 13 Workflow Rules, all 6 phase gates, and every invariant preserved; drift fixed; review cadences consolidated per DECISION-029. Follow-ups (`.env.example` reconciliation, deck cadence-slide check) were filed in `docs/TODO.md` in the same commit. Not member-visible — no what's-new entry (Rule 13 n/a).
