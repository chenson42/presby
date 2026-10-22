# Remove the `npm run db:seed` hint from `/signin` — Work Log

> **Slug:** `2026-10-22-signin-seed-hint`
> **Surface:** (auth)
> **Permission(s):** none
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Polish — Phases 2 and 3 skipped (a four-line copy removal: no new dependency, no structural change, no schema or API change)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (carried) | READY WITH NOTES | 2026-10-21 |
| 2 — Architectural review | architect | Skipped | — | 2026-10-22 |
| 3 — Technical design | tech-lead | Skipped | — | 2026-10-22 |
| 4 — Implementation | orchestrator | Complete | — | 2026-10-22 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (carried)

Carried from `docs/work-log/2026-10-21-review-polish.md` Phase 1 gap 6 / Q11: the analyst found that `/signin` shows "First time? Run `npm run db:seed` to provision the seeded admin user." to every visitor whenever local login is on, production included, and asked the operator to rule rather than fix it silently. **Operator ruling (2026-10-22): remove it.** The other half of gap 6 (no message for OAuth failures such as `AccessDenied`) is not ruled and stays a `docs/TODO.md` line.

# Phase 2 — Skipped

Skipping Phase 2 — no new dependency, no new directory, no structural change, no invariant touched.

# Phase 3 — Skipped

Skipping Phase 3 — the change is the deletion of one `<p>` element; there is nothing to design.

# Phase 4 — Implementation (orchestrator)

- `src/app/(auth)/signin/page.tsx`: deleted the `<p>` carrying the `npm run db:seed` hint under `SignInCredentialsForm`. No test referenced the text.
- `docs/TODO.md`: the operator-decision line now carries only the OAuth-failure half; the review-polish checklist line drops the sender-name check (the operator confirmed the production sender name is PresbyPortal, 2026-10-22); a new Deployment line asks the operator to set `RESEND_WEBHOOK_SECRET` (the production endpoint answered "Webhook not configured" on 2026-10-22); a Done entry for this change.
