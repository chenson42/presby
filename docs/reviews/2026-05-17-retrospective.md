# Retrospective — 2026-05-17

**Synthesizer:** tech-lead (solo — first run; no prior agent briefs to collect)
**Window covered:** v0.1 → v0.3.1 (all five work-log entries: 2 on 2026-05-16, 4 on 2026-05-17)
**Input artifacts read:** all 6 work-log files, 6 review files (code, documentation, security, agent-instruction, dependencies, test-coverage), decisions.md

---

## Pipeline Metrics

### Features / bugs shipped in window

| Slug | Mode | Days in pipeline | Loop-backs | Phases skipped |
|------|------|-----------------|------------|----------------|
| `admin-signin-access-pending` | Bug-fix | 1 | 0 | Phase 1 (trivial), Phase 3 (root cause clear) |
| `per-user-2fa-bypass` | Full | 1 | 0 | None |
| `account-page` | Full | 1 | 0 | None |
| `forgot-password` | Full | 1 | 0 | None |
| `rate-limiting` | Full | 1 | 0 | None |
| `toast-infrastructure` | Full | 1 | 0 | None |

**Total features/bugs:** 6
**Loop-backs:** 0 — no feature bounced from Phase 5 back to Phase 4 or earlier.
**Phase skips:** 2, both in the bug-fix variant, both documented with rationale. No silent skips.

### Agent utilization

| Agent | Times used as Phase 4 implementer | Other phases |
|-------|----------------------------------|--------------|
| full-stack-developer | 6 of 6 | — |
| database-admin | 0 | — |
| api-developer | 0 | — |
| ux-developer | 0 | — |
| analyst | 6 (Phase 1 + Phase 6) | — |
| architect | 5 (Phase 2; 1 skipped) | — |
| tech-lead | 6 (Phase 3; 1 skipped) | owns this doc |
| qa | 5 (Phase 5; 1 self-verified) | — |

`database-admin` and `api-developer` have never been invoked as a sole implementer. Both the agent-instruction review and this retrospective flag this — see Observations below.

---

## What Worked

**1. Bug-fix variant was correctly scoped.**
The `admin-signin-access-pending` bug skipped Phases 1 and 3 with explicit notation. The root cause was diagnosed from logs before any phase was written. No ceremony was added; the work-log documented the skips and advanced cleanly.

**2. Analyst Phase 1 gaps were accurate and predictive.**
On `per-user-2fa-bypass`, the analyst surfaced six gaps (JWT staleness, self-disable block, badge persistence risk, no-toast status message, `twoFactorVerified` badge order, mobile table squeeze). Every one of those gaps appears in the Phase 4 implementer notes or Phase 6 sign-off — they were real, not speculative. QA found nothing the analyst had not already flagged.

**3. Architect sizing judgment held.**
The architect reassessed the `per-user-2fa-bypass` scope from "small" to "medium" and recommended a single PR rather than splitting. The bundling produced no QA pain — all 16 tests passed and the build was clean. The two cases where the architect recommended splits in other projects (referenced in the retrospective brief) did not occur in this window; scope was not bundled over architectural objection here.

**4. Zero loop-backs across all six features.**
This is atypically clean. The likely explanation: the window contains a single author operating across all phases, which eliminates the handoff loss that normally causes Phase 5 regressions. This baseline will degrade as the team scales; the test-coverage gaps are the primary risk when that happens.

**5. Audit catalog (`AUDIT_ACTIONS`) introduced exactly when the code-review finding (C-1) would have predicted it was needed.**
The Phase 3 design identified the four TOTP verify strings in `src/app/(auth)/totp/actions.ts` were not migrated (only the six strings present in the admin action files were catalogued). The code review confirmed this two days later as finding C-1. The catalog was introduced at the right time; the scope was slightly undercut.

---

## Friction Points

**1. No toast infrastructure when `TwoFactorCard` shipped.**
The `per-user-2fa-bypass` Phase 4 implementer used `useState` inline status messages because no toast library was installed. Three days later, `toast-infrastructure` installed Sonner and migrated away from those inline messages. This represents a two-feature rework cycle on the same component. A "check for missing prerequisites" step in Phase 1 or Phase 3 would have caught the gap — either by deferring the bypass feature until toast shipped, or by bundling toast as part of the same feature.

**2. `isFlagEnabled` was shipped but never called (code-review C-2).**
The flags infrastructure exists in full — table, admin UI, toggle, seed data — but no page in the app imports `isFlagEnabled`. The `demo.new_dashboard` flag toggles nothing. A starter that teaches the flags pattern needs at least one real call site. This is a teaching artifact gap, not a runtime defect.

**3. Test coverage launched at effectively 5%.**
One module (`permissions.ts`) has 100% coverage; eight critical modules have 0%. The two highest-risk gaps (`two-factor.ts` encrypt/decrypt at 0%, `proxy.ts` auth gate at 0%) are also the most expensive to write. The punch-list is 7 items deep and no item has been actioned yet. Coverage debt is accumulating faster than it is being paid.

**4. CLAUDE.md drifted behind the codebase by v0.3.**
The documentation review found three critical CLAUDE.md gaps: "What This Starter Gives You" still describes v0.1, "Common Commands" missing two scripts, and "Project Layout" missing three route groups. These would mislead a fork starting from `CLAUDE.md` today. The root cause is that CLAUDE.md has no "update this file when you ship" step in the release pipeline. The `/release-notes` skill updates `docs/release-notes/vX.Y.md` but not `CLAUDE.md`.

**5. 2FA enrollment redirect loop (security M2) was not caught in any phase.**
The proxy redirects unenrolled `twoFactorRequired=true` users to `/admin/2fa`, which is itself gated by the proxy's 2FA check — producing an infinite redirect loop. This is a genuine lockout defect that went through Phase 1 analyst review, Phase 5 QA, and Phase 6 sign-off on related features without being caught. The security reviewer found it. The gap is that no phase exercised the "new admin user, not yet enrolled" state machine.

---

## Cross-Cutting Themes

### Theme 1: Audit catalog is now established but incompletely populated

Appears in: **code review (C-1)**, **security review (I2)**, **per-user-2fa-bypass Phase 4**.

The `AUDIT_ACTIONS` catalog was introduced and six strings were migrated. Four additional strings in `src/app/(auth)/totp/actions.ts` (`totp.verify_failed`, `totp.verify_succeeded`, `totp.recovery_failed`, `totp.recovery_succeeded`) were missed. Two separate reviews flagged this independently — code (C-1) and security (I2). This is signal that the migration step in the `AUDIT_ACTIONS` design needed a broader grep scope than "the four files currently open."

**Recommendation:** Add a `check:audit` step to the Phase 4 gate checklist that explicitly runs `grep -r "audit_events" src/ --include="*.ts"` and verifies every insert uses a catalog key. (The `check:audit` npm script already exists per documentation review C-2 — it just is not called by agents in Phase 4.)

### Theme 2: `database-admin` and `api-developer` agents are unused

Appears in: **agent-instruction review (O1, O2)**, **this retrospective (agent utilization table)**.

All six features went to `full-stack-developer`. The features have been small and tightly coupled, so this is appropriate behavior — the tech-lead correctly judged that splitting would add overhead. However, the agent roster in CLAUDE.md presents `database-admin` and `api-developer` as viable solo implementers. If they are never invoked over 60+ days, one of two things is true: (a) the work is consistently small and coupled, meaning the roster description should acknowledge this expected pattern, or (b) the routing heuristics need sharpening.

**Recommendation:** Clarify in the Implementation Order table in CLAUDE.md that `full-stack-developer` is appropriate when the work spans ≤3 files across the server/client boundary and no standalone DDL is required — currently the table implies schema-only or route-handler-only work gets a specialist, but the threshold is vague.

### Theme 3: CLAUDE.md is not automatically updated when features ship

Appears in: **documentation review (C-1, C-2, C-3)**, **this retrospective (friction point 4)**.

Three critical gaps in CLAUDE.md all stem from the same root cause: no step in the development pipeline (Phase 4, `/release-notes`, `/pre-push`) requires the agent to update `CLAUDE.md`. Release notes track what shipped; CLAUDE.md tracks what the starter is. They serve different audiences and both need updating.

**Recommendation:** Add a CLAUDE.md update step to the `/release-notes` skill or to the Phase 6 analyst checklist. At minimum, "What This Starter Gives You" and "Project Layout" should be reviewed after every feature ships.

### Theme 4: Security gate (Phase 1 + Phase 5) does not exercise error-state paths

Appears in: **security review (H1 open redirect, M2 enrollment loop)**, **this retrospective (friction point 5)**.

Both the open-redirect finding (H1) and the 2FA enrollment loop (M2) require exercising unusual state: a form submit with a malicious `callbackUrl`, or a user account that is `twoFactorRequired=true` but has never enrolled. Standard happy-path review in Phase 1 and Phase 5 does not reach these states. The analyst's Phase 1 four-pass review covers user verbs, flow audit, permissions/flags, and gaps — but does not include a "what if the user manipulates inputs" pass.

**Recommendation:** Add a fifth pass to the analyst's Phase 1 template: "Failure-mode / adversarial pass — what can a user submit that should be rejected? What state combinations produce unexpected behavior?" This does not require a security-specialist agent; the analyst already has the context to enumerate these.

---

## Concrete Edits Proposed

These are recommendations only — not made in this file.

### Edit 1 — Add `check:audit` to Phase 4 gate in CLAUDE.md

**File:** `CLAUDE.md`, Phase 4 gate criteria.
**Change:** Add "Run `npm run check:audit`; zero violations" to the gate checklist alongside "Typecheck passes" and "Build passes."
**Rationale:** The audit-catalog incompleteness (Theme 1) would have been caught by the existing script had it been part of the phase gate. The script already exists.

### Edit 2 — Add "What This Starter Gives You" + "Project Layout" to the `/release-notes` skill checklist

**File:** `.claude/skills/release-notes/SKILL.md`.
**Change:** Add a step: "Review `CLAUDE.md` → 'What This Starter Gives You' and 'Project Layout'; update if any shipped feature adds a new user-visible capability or route group."
**Rationale:** Theme 3. CLAUDE.md drifted three versions behind; the release skill is the right integration point to prevent this.

### Edit 3 — Add a fifth "adversarial pass" to the analyst Phase 1 template

**File:** `CLAUDE.md` (Phase 1 description) and/or `.claude/agents/analyst.md`.
**Change:** After the existing four passes (user verbs, flow audit, permissions/flags, gaps), add: "Pass 5 — Adversarial: enumerate inputs the user controls; flag any that reach a redirect, a sensitive action, or a state toggle without server-side validation."
**Rationale:** Theme 4. Both the open-redirect (H1) and the enrollment loop (M2) would have surfaced in a structured adversarial pass.

### Edit 4 — Fix `qa.md` description field (stale "no test runner" caveat)

**File:** `.claude/agents/qa.md`, YAML frontmatter `description` field.
**Change:** Remove the sentence "Note: the starter does not ship with a test runner configured — qa describes what to do when tests are added and what the right defaults are for this stack." Both Vitest and Playwright are pre-configured.
**Rationale:** The agent-instruction review (N1) and documentation review (m-3) both flagged this. The description is what Claude reads to route work; a stale caveat will suppress QA agent invocations.

### Edit 5 — Fix `api-developer.md` description field (claims schema-change ownership)

**File:** `.claude/agents/api-developer.md`, YAML frontmatter `description` field.
**Change:** Remove "schema changes" from the listed responsibilities. Replace with "database queries and DB-layer integration — schema DDL stays with database-admin."
**Rationale:** Agent-instruction review N2. The blurred boundary causes incorrect agent routing when a feature involves schema work.

### Edit 6 — Add a real `isFlagEnabled` call site to the starter

**File:** Any appropriate admin or landing page — e.g., `src/app/page.tsx` or `src/app/(admin)/admin/page.tsx`.
**Change:** Import `isFlagEnabled` and gate a UI element (e.g., a "new dashboard preview" banner) behind `demo.new_dashboard`. The exact UI is not critical — the point is that a fork reading the code sees a complete example of the pattern.
**Rationale:** Code review C-2. A starter that teaches feature flags needs at least one real usage.

---

## Open Gaps Carrying Forward

The following items were flagged in prior reviews and remain open. They are not new findings here — they are tracked to prevent loss across sessions.

| Gap | Source | Priority |
|-----|--------|----------|
| `two-factor.ts` at 0% test coverage | test-coverage punch-list #1 | HIGH |
| `proxy.ts` at 0% test coverage | test-coverage punch-list #2 | HIGH |
| `src/app/(auth)/totp/actions.ts` — 4 audit strings not in `AUDIT_ACTIONS` | code C-1 / security I2 | HIGH |
| Open redirect via `callbackUrl` in TOTP verify action | security H1 | HIGH |
| 2FA enrollment redirect loop (admin 2FA page in proxy gate) | security M2 | MEDIUM |
| Email verification token stored in plaintext | security M1 | MEDIUM |
| `changePassword` has no rate limit | code N-6 / security L1 | MEDIUM |
| `isFlagEnabled` never called | code C-2 | MEDIUM |
| CLAUDE.md missing v0.3 feature surface, commands, route groups | documentation C-1/C-2/C-3 | HIGH (pre-fork) |
| `users/page.tsx` has no page-level permission check | code N-5 | MEDIUM |
| Duplicate recovery-code helpers across two actions files | code N-1 | LOW |
| Admin 2FA page generates new TOTP secret on every render | code N-3 | LOW |

---

## Verdict

The first cycle is clean from a process standpoint — zero loop-backs, all phases documented, no silent skips. The pipeline is sound. The risks are concentrated in two areas: (1) test coverage debt on the highest-value modules, and (2) a small set of security findings that survived all six phases undetected. Both are addressable with concrete edits to the pipeline rather than structural changes.
