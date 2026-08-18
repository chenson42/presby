# Agent & Instruction + Documentation Review — 2026-07-11

**Owner:** tech-lead (run in the main session at the user's request: "review the workflow, agents, reviews, claude.md for efficiency")
**Scope:** CLAUDE.md, all 9 `.claude/agents/` files, `.claude/skills/` (pipeline-relevant), `docs/work-log/_template.md`, `docs/reviews/log.md`, review cadences.
**Work-log:** `docs/work-log/2026-07-11-instruction-layer-slim.md`

## Findings

### 1. Duplication (~35–40% of the instruction layer)

- The 25-line "standard handoff template" was pasted verbatim into all 9 agent files (~225 lines) **and conflicted** with `docs/work-log/_template.md`'s structured per-phase sections — two competing formats for the same artifact.
- Permissions-vs-flags explained in full in 6 places (CLAUDE.md ×3, architect, api-developer, full-stack-developer).
- The auth-gate code snippet duplicated across all 3 implementer agents; full-stack-developer.md was ~90% restatement of the other two implementers + CLAUDE.md rules.
- Directory tree maintained in both CLAUDE.md and architect.md; pre-deploy checklist in both `/pre-push` and deployment-engineer.md; env-var table in deployment-engineer.md vs `.env.example`.
- CLAUDE.md carried a ~70-line feature catalog duplicating README's "What you get out of the box."
- Agent frontmatter descriptions each carried two `<example>` blocks (~150 lines injected into every session's context as the agent roster).

### 2. Drift in the stale copies

- architect.md's tree was missing the `(member)`, `(account)`, `(password-reset)`, `(email-verify)` route groups and listed a nonexistent `src/components/admin/`.
- qa.md's e2e list said sign-in lands on `/` — stale since the post-login-landing-=-`/home` invariant.
- analyst.md referenced `/signin/totp`; the route is `/totp`.
- api-developer.md showed raw `db.insert(auditEvents)` — superseded by `recordAudit()` (`src/lib/audit.ts`, shipped 2026-07-01).
- `_template.md` Phase 5 verdict lacked `BLOCKED` and had no Feature-Gate Audit section, both of which qa.md mandates.
- `docs/reviews/log.md` had two 2026-07-01 entries filed below 2026-05-16, breaking newest-first ordering.
- deployment-engineer.md's env table and `.env.example` had drifted apart in both directions (see Follow-ups).

### 3. Review cadences aspirational

7-day reviews ran once in 8 weeks; 30-day reviews ran in batch sessions anyway. Consolidated into two slots — see DECISION-029.

## Changes Applied

1. **CLAUDE.md** 451 → ~330 lines: feature catalog → README pointer + compact capability map; permissions-vs-flags single-sourced to Key Invariants (Workflow Rule 6 now points there); ASCII pipeline diagram replaced by one sentence; Periodic Reviews restructured to two slots; server/client code examples compressed to prose; `src/lib/audit.ts` added to the layout tree. All 13 Workflow Rules preserved with their numbering; all phase gates preserved verbatim in meaning.
2. **All 9 agent files rewritten:** descriptions cut to 1–2 sentences (no examples); handoff template replaced by a pointer to `_template.md`; stale references fixed (items in Finding 2); full-stack-developer cut to a thin composition of the other two implementers; architect points at CLAUDE.md's tree and gained the current route-group rules (incl. `api/webhooks` per DECISION-028); deployment-engineer points at `/pre-push` as the canonical checklist and `.env.example` as the canonical env inventory; qa/tech-lead cadences updated to the new slots.
3. **`_template.md`:** Phase 5 verdict now `PASS | FAIL | BLOCKED` + Feature-Gate Audit table + auth-touching note.
4. **`docs/reviews/log.md`:** ordering fixed; header rewritten around the two slots.
5. **Sync skills:** "Known Untested Paths" essays condensed (content preserved in one short paragraph each).
6. **DECISION-029** logged (slot consolidation + single handoff format).

No behavioral rule was dropped — only single-sourced, compressed, or corrected.

## Follow-ups (tracked in docs/TODO.md)

- `.env.example` ↔ deployment-engineer drift: `DATABASE_URL_UNPOOLED`, `AUTH_TRUST_HOST`, `UPSTASH_REDIS_REST_URL/TOKEN`, `TRUST_PROXY_HEADERS`, `RATE_LIMIT_DISABLED` were documented in the old agent table but are absent from `.env.example`; conversely `CRON_SECRET`, Turnstile keys, and the extra seed users are in `.env.example` only. Reconcile `.env.example` as the canonical inventory (verify against actual `process.env` usage first).
- The deck (`deck/slides.md`) references the review cadence — check whether the two-slot consolidation needs a slide update at the next deck edit.
