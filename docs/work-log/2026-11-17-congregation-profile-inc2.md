# Congregation profile Increment 2 — photos and reports — Work Log

> **Slug:** `2026-11-17-congregation-profile-inc2`
> **Surface:** (org) — the presbytery's per-congregation pages (`/o/<presbytery-slug>/admin/oversight/...`), presbytery type only; `/help`
> **Permission(s):** `congregation_oversight.manage` (existing, tier 1) and the new `congregation_oversight.finance` (tier 2, two-factor; in the presbytery founding-administrator bundle, DECISION-345). Never `FEATURES.*`.
> **Flag(s):** none new. Rides the existing global `org_portal.oversight`; the reports ride `org_portal.reports`.
> **Estimated complexity:** large
> **Pipeline mode:** Full (no schema change in this increment; 0089 shipped in Increment 1)
> **Release:** 0.62.0 (`package.json` bump and `docs/release-notes/v0.62.md` after Phase 6 SHIP IT, through `/release-notes`)
> **Parent:** `docs/work-log/2026-11-17-congregation-profile.md` (Phases 1 to 3: the analyst's brief and the orchestrator rulings, the architect's R1 to R10 and DECISION-344 to 348, and the one Phase 3 design for both increments). **Do not restate or summarize them here.**
> **Numbers (pre-assigned, Rule 16):** migration 0089 (applied in Increment 1; this increment adds no schema); DECISION-344 to 352 (349 to 351 used by Phase 3); F450 to F455 used, F456+ free; dev port 3102 (3103 for the production hydration lane); e2e ids `00000000-0000-4089-8000-` (people), `-9000-` (roles), `-9001-` (organizations); Neon branch `br-spring-bonus-axifozcw` (`pipeline-congregation-profile`); worktree `../presby-profile`, branch `pipeline/congregation-profile`
> **Source:** operator decisions A to G, 2026-11-17 ("take congregation profiles all the way to the end (pushed to production)")

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (parent) | READY WITH NOTES | 2026-11-17 |
| 2 — Architectural review | architect | Complete (parent; R1–R10) | Approved with suggestions | 2026-11-17 |
| 3 — Technical design | tech-lead | Complete (parent; this log carries the increment slice below) | Design complete | 2026-11-17 |
| 4 — Implementation | api-developer (B5, B7), ux-developer (B6, B8), full-stack-developer (B9) | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 and Phase 2

See the parent log. Recorded there verbatim; not copied.

# Phase 3 — Technical Design (tech-lead): the Increment 2 slice

The design is in the parent's Phase 3. Sections an implementer of this increment reads: "Design rulings" (T10), "Module and file plan", "API Contract" (photo audit keys), "Implementation Order — Increment 2", "Copy" C14 to C16, "Test plan" (E2E rows for photos and reports), "Carry-forward" (R6, R7), "Edge Cases & Risks" (photo and CSV items).

**Scope.** The `storage/image/` extraction (a `refactor:` commit first, DECISION-346), building photos (upload, view, cover, caption, remove) and the Buildings and Insurance-and-loans reports with CSV and export audit (DECISION-348); two help edits and the privacy sentence. **No schema change:** the photo table shipped in 0089. Cut order if time forces it: reports before photos.

## Batches

| Batch | Implementer | Work | Exit gate |
|---|---|---|---|
| **B5** | api-developer | **Opens with a `refactor:` commit** (R6): `person-photos/image.ts` to `storage/image/photo.ts`; the image limits and `ImageRefusal` to `storage/image/limits.ts`; `src/app/(org)/o/[slug]/admin/community/[id]/edit/photos/downscale.ts` to `storage/image/downscale.ts` (test moves unchanged; the person-photo island's import is repointed); `processPhoto` gains a **required** `{ thumbnail: "top" \| "centre" }`, person photos pass `"top"` (output unchanged byte for byte: run `image.test.ts` before and after); `SHARP_FILES` updated in `scripts/check-treasury-boundaries.mjs`, `image-sanitize.test.ts` and `person-photos/scan.test.ts`. Then `photo-store.ts`, `photo-reads.ts`, the photo copy, the four audit keys, `photos/actions.ts`, tests (upload order: authorization, flag, type, building resolution and cap all before any decode; cap recounted under `for update`) | person-photo suites green and byte-identical; refusal order unit-tested for the new caller; `audience-callsites.test.ts` rows moved FORWARD to ACTIVE |
| **B6** | ux-developer | photos page, grid (two columns at 360px, 44px targets), `?view=<photoId>` master, the upload island (imports the moved `downscale.ts`; no `capture` attribute, no `blob:` URL), the photos block on the building detail, the cover on the record page's building cards | 360px walk; `check:treasury-boundaries` clean |
| **B7** | api-developer | `REPORT_KEYS`/`REPORTS` gain `buildings` and `insurance_and_loans` (`contract.ts`); `src/lib/presbytery-reports/buildings.ts`, `insurance-loans.ts`, `src/lib/oversight/report-rows.ts`, the two CSV builders and headers, the two `export/route.ts` files, tests (`contract.test.ts`, `boundaries.test.ts` "six", `readers.db.test.ts`, `csv.test.ts`) | `npm run check` zero |
| **B8** | ux-developer | the two report pages and views, `HUB_COPY` cards, two help edits plus the privacy sentence and the `presbytery-tools` count, registry labels | 360px walk of both reports; a CSV opened |
| **B9** | full-stack-developer | `oversight-photos.spec.ts`, `oversight-reports.spec.ts` (generated image only), the seed patch additions (generated solid-colour image bytes), regression of the touched specs, the prod hydration lane for the upload island | specs green on 3102/3103 |

## Gates (every batch)

- Same gates as Increment 1 (see its log): `npm run check` zero, typecheck/lint/build, `HydrationGate`, 360px in a real browser, implementer-written tests, no stash, no `pkill -f next`, shared files via integration patches.
- **No real data:** fixtures and screenshots use generated images only; a real building is real data. The Phase 6 phone-photo upload uses a non-identifying picture that is never committed.
- Residuals the copy must not deny: orphaned blob after a failed final transaction; `bytea` growth (about 4 MB per building at the cap); "removed from view, not erased".

## Increment-specific notes

**Handoff.** Next agent: **api-developer** (B5), after Increment 1's Phase 6 verdict.

- Starts after 0.61.0 is released (back to back, same branch).
- **Phase 6 walk:** a real phone-photo upload on a deployed environment at 360px; both reports and a CSV opened; the help pages read as their reader.
- **Release notes:** the C16 lines; functionality map and TODO reconciliation.

---

# Phase 4 — Implementation

## Files Created

- `path/to/file` — purpose

## Files Modified

- `path/to/file` — what changed

## Schema Changes

- [Tables / columns added, or "none"]
- Applied via: `npm run db:push` / `npm run db:generate`

## Audit Events

- [Action key written when the security-sensitive mutation fires]

## Implementer Notes

[Tradeoffs taken, anything that diverged from the design and why.]

Strings added or changed: [file:line each, or "none"]

*Keep Phase 4 sections short: files, deviations from the design, gates with
counts, and anything the next phase must know. Leave out narration of how
the work went; git history already records it. Judgment output (analyst,
architect, qa) is still recorded verbatim.*

---

# Phase 5 — Verification (qa)

**Date:** YYYY-MM-DD
**Verified by:** qa

## Type Check

`npm run typecheck`: PASS / FAIL

## Unit Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [test name — error — file:line]

## End-to-End Tests

Total: N | Passed: N | Failed: N | Duration: Xs
Failures: [...]

## Regression Tests Added

- [test name — file:line — guards against: brief description]

## Coverage on Critical Modules

- `src/lib/permissions.ts`: X%
- `src/lib/two-factor.ts`: X%
- `src/lib/flags.ts`: X%

## Feature-Gate Audit

*(Mandatory — see qa agent. Verified by reading route/action bodies, not by inferring from green tests. Write "no protected routes touched" if none.)*

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| [method + path, or action name] | yes / no | yes / no | `FEATURES.X` or n/a |

## Copy Truthfulness

*(Every run whose diff adds or changes a user-facing string; write "no strings changed" otherwise. Report a defect as `copy truthfulness: FAIL` with file:line and the viewer's role.)*

- [ ] Every added or changed string is in the design's Copy table
- [ ] The query behind each claim about a person, account, date or state was opened, and what it does not read was named
- [ ] Each instruction was traced to the role that sees it, and that role can do it (render gate and permission check)
- [ ] Older strings about the same subject were grepped for and none is made false
- [ ] Help diff covered: every labels string is on screen, every claim walked at 360px, every committed image opened

## Verdict

[PASS | FAIL | BLOCKED — name the unmet prerequisite]

*(Auth-touching diffs: PASS requires e2e against a real dev server with an MFA-enrolled seeded user; deferred e2e = BLOCKED.)*

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

[SHIP IT | SHIP WITH NOTES | NEEDS REWORK]

## ONE-LINE TAKE

> [The shipped feature in one honest sentence.]

## What's Working

- [Specific. The flow that works well and why.]

## Intent-vs-Shipped Diff

- Phase 1 said: [X]. Shipped: [Y]. Verdict: [matches | acceptable drift | regression]

## Edge Cases

- Empty state: [pass | fail | not applicable]
- Failure microcopy: [pass | fail]
- Permission gate: [pass | fail]
- Audit event: [pass | fail | not applicable]
- Mobile (360px): [pass | fail]
- Help pages read as their reader (each page named in Help impact): [pass | fail | no help impact]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]
