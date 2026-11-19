# Presbytery committees Increment 2 — administrative commission records — Work Log

> **Slug:** `2026-11-19-presbytery-committees-inc2`
> **Surface:** (org) — the presbytery's Committees & Commissions pages (`/o/<presbytery-slug>/admin/committees/commissions/...`), presbytery type only; `/help`
> **Permission(s):** existing `groups.manage` (tier 1), settled Q2. No new key. A commission record gives its members **no access** to anything; nothing in this increment writes `administrative_commissions`, `org_delegations`, `role_grants` or a `role_id`.
> **Flag(s):** none new. Rides the existing global `org_portal.committees`.
> **Estimated complexity:** medium
> **Pipeline mode:** Full (**no schema change in this increment**; 0090 shipped in Increment 1 and holds the commission tables)
> **Release:** 0.64.0 (`package.json` bump and `docs/release-notes/v0.64.md` after Phase 6 SHIP IT, through `/release-notes`)
> **Parent:** `docs/work-log/2026-11-19-presbytery-committees.md` (Phases 1 to 3: the analyst's brief and the orchestrator rulings Q1 to Q7, the architect's R1 to R6 and DECISION-352 to 356, and the one Phase 3 design for both increments). **Do not restate or summarize them here.**
> **Numbers (pre-assigned, Rule 16):** migration 0090 (applied in Increment 1; **this increment adds no schema, and if the design later needs one it asks the orchestrator for a new number and never edits 0090**); DECISION-352 to 356 (architect), 357 to 359 used by Phase 3, 360 next; F456 to F458 (architect), F459 and F460 used by Phase 3, F461 next; dev port 3101 (`PW_PROD_PORT=3801` for the production hydration lane); e2e ids `00000000-0000-4090-8000-` (people), `-9000-` (roles), `-9001-` (organizations); Neon branch `br-calm-rice-ax2zn9jw`; worktree `../presby-committees`, branch `pipeline/presbytery-committees` (a fresh branch from `main` after 0.63.0 is released)
> **Source:** operator decisions A–G, 2026-11-17 ("administrative commissions are needed at go-live"); operator 2026-11-19: "start committees and take it to production"

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (parent) | READY WITH NOTES | 2026-11-19 |
| 2 — Architectural review | architect | Complete (parent; R1–R6) | Approved with suggestions | 2026-11-19 |
| 3 — Technical design | tech-lead | Complete (parent; this log carries the increment slice below) | Design complete | 2026-11-19 |
| 4 — Implementation | api-developer (B5), ux-developer (B6), full-stack-developer (B7) | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 and Phase 2

See the parent log. Recorded there verbatim; not copied.

# Phase 3 — Technical Design (tech-lead): the Increment 2 slice

The design is in the parent's Phase 3. Sections an implementer of this increment reads: "Design rulings" (T6 to T8, T12), "Commission member role vocabulary", "Data Model" section 3 (the tables already exist), "Module and file plan" (the **II** marks), "API Contract" (Increment 2 actions and the six audit keys), "Component / Page Plan", "Implementation Order — Increment 2", "Copy" C15 and C16, "Test plan" (the **II** rows), "Carry-forward" (Gaps 2 to 5), "Edge Cases & Risks" (the commission items).

**Scope.** The commission record: the Administrative commissions section on the list, the record form (title, charge, optional congregation, appointed on, minute reference), the commission page with its member roster (add and end a member, the six titles), "End commission" (every member ended on the date), "Remove this record" (the cut-able control), the neutral congregation refusal, the six `commission_record.*` audit keys, the help rewrite of the "Administrative commissions" section and the roles and privacy edits, the tile description. **No schema change.** Cut order if time forces it (parent): "Remove this record" first. Never cut the record itself.

**Preconditions to confirm before B5 starts:** 0.63.0 is released and 0090 is applied in production; `main` is checked for new migrations, new `group_role` values and changes to `groups.ts`, `store.ts` seams or `role-grants.ts` (parent "Feasibility check": a design whose Phase 4 starts after another pipeline has merged re-runs it against the live tree first).

## Batches

| Batch | Implementer | Work | Exit gate |
|---|---|---|---|
| **B5** | api-developer | commission additions to `contract`, `validate`, `copy` (**C15 strings only**), `derive`; `store.ts` and `reads.ts` commission functions; the six audit keys and `audit.test.ts`; the `actions.ts` files under `commissions/`; `boundaries.test.ts` and `audit-coverage.test.ts` extensions; `store.db.test.ts` and `reads.db.test.ts` commission cases, including the congregation resolver (another presbytery's, a non-congregation and a nonexistent id give **byte-identical** answers; a closing congregation is accepted) | `npm run check` zero; failing-first for the audit rollback, the live-guard race (add versus end) and the interval overlap |
| **B6** | ux-developer | the commissions section, record form, commission page, member form, end-commission and remove dialogs, the tile description, **the help rewrite (C15) and the roles and privacy edits (C13)**, a 360px walk of every state, light and dark | typecheck, build, `check:hydration-gate`, `check:help`, a 360px walk |
| **B7** | full-stack-developer | fixture additions (`committees-fixture.ts` is this pipeline's own file), `committees-commissions.spec.ts`, `hydration/commissions-forms.spec.ts`, the regression of the Increment 1 specs, the founding-administrator walk for the commissions half | own server on 3101; specs green; production hydration lane green |

Order: B5 before B6 (B6 imports `reads`, `copy`, `contract`); B7 starts when B6's pages exist.

## Gates (every batch)

Same as Increment 1 (parent "Implementation Order", this child's sibling): `npm run check` zero; typecheck, lint and build; no native dialogs; no `console.log`; audit rows in the mutation's own transaction; `HydrationGate` on every form root; a 360px walk; implementer-written tests; no `git stash`, no `pkill -f next`; shared files only by integration patch; **nothing writes `administrative_commissions`, `org_delegations`, `role_grants` or a `role_id`**; a string not in Copy stops for a ruling.

## Increment-specific notes

**Handoff.** Next agent: **api-developer** (B5), after Increment 1 ships and its release is recorded.

- **Deploy:** code only, no migration. The commission tables already exist in production from 0090.
- **The no-access sentence ships with its boundary test** (parent Gap 2): C15's "This record gives no one access to {congregation}'s PresbyPortal, and {congregation} does not see it." is true only while nothing writes a role and the policy is organization-only; `boundaries.test.ts` and `test-rls-90.sql` (d), (i), (j) pin both.
- **Phase 6 walks:** the commissions section and page at 360px as the person the invitation path creates; a commission about a congregation and about none; end and remove; the congregation's own administrator cannot reach the record; the help page's rewritten section and the two edited pages read as their reader.
- **Release notes:** the C16 lines through `/release-notes` after SHIP IT; the functionality-map line (Rule 14); TODO line 507 moves to Done (Rule 10); a TODO line proposing the later `groups.manage` description update (T12).
- **Operator question (non-blocking, default taken):** commission members use the same six titles as committees, with the presiding member called "Chair"; "Moderator" would be one forward migration (parent T6).

---

# Phase 4 — Implementation

Pending.

---

# Phase 5 — Verification (qa)

Pending.

---

# Phase 6 — Shipped vs Intent (analyst)

Pending.
