# Careers, Increment 2: apply, review and retention together — Work Log

> **Slug:** `2026-10-25-careers-inc2`
> **Parent:** `docs/work-log/2026-10-25-careers.md` (shared Phase 1 and Phase 2, verbatim)
> **Predecessor:** `docs/work-log/2026-10-25-careers-inc1.md` (must be merged and released before this increment's Phase 4 starts)
> **Surface:** mixed — anonymous apply route on the public site, `(org)` reviewer screens, Home tile badge, daily cron
> **Permission(s):** `careers.applicants` (tier 3) becomes live; `careers.manage` unchanged
> **Flag(s):** none (per-org toggle `org_portal.careers` from Increment 1; whether applying needs its own switch is this increment's Phase 3 to decide)
> **Estimated complexity:** large
> **Pipeline mode:** Full
> **Numbers:** migration **0075** (orchestrator note: 0072–0074 belong to treasury); DECISION-262 and DECISION-263; F-numbers and dev port assigned at this increment's kickoff (Rule 16).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (parent log) | READY WITH NOTES | 2026-10-25 |
| 2 — Architectural review | architect | Complete (parent log) | Approved with suggestions | 2026-10-25 |
| 3 — Technical design | tech-lead | **Not started** — designed at this increment's kickoff, against the live tree then | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

## Scope (from the parent's Phase 2 increment ruling)

Retention ships in the **same deploy** as the first code that can create an applicant row, so there is never a window in which an application can be submitted and nothing can remove it. One migration (0075), re-run of the feasibility check against whatever has merged since 2026-10-25, and Phase 5 must show the sweep redacting a seeded overdue application, and the file row gone, on the merged branch.

Contents: `job_applications` and `job_application_files` (definer-only, `presby_app` holds no table privilege), every applicant definer including the one submit definer, the sweep re-created (`create or replace`, same return type) with `application_redacted` rows; the anonymous apply route handler at `careers/[posting]/apply/route.ts` (4 MiB cap, 4,450,000-byte request cap, `Content-Length` pre-check, route handler not a Server Action, outside `check:audit`); the form token (HMAC derived from `AUTH_SECRET`, window 3 seconds to 2 hours, hidden field, never a cookie), honeypot, rate limits, Turnstile if configured (confirm the verify path on a custom host or add the host to the runbook, Note 5); the file checks without decompression (PDF and .docx only); the reviewer UI, the authenticated attachment-only `no-store` download that writes an audit row, early removal; the staff notification (`careers_application_received` → `person:role`, fixed PII-free body) and **no** applicant email; the Home tile badge (a presentational `annotations` prop on `TileGrid`, computed only inside the `careers.applicants` branch); `HydrationGate` plus `method="post"` on the apply form and its `e2e/hydration/` spec; the `SiteUrls.careersApply()` method; ship-time documentation (Never-Hard-Delete applicant exception in CLAUDE.md, `docs/architecture.md` per Rule 15, the DECISION-262/263 entries).

## Handed over from Increment 1 (do not rediscover)

- **Strings this increment makes stale** (Increment 1's Copy check, "Neighbours"): the toggle description F2 ("People are asked to contact the church to apply"); the Home tile description T1; the card link P4 "View this position" (becomes "View and apply"); the whole "How to apply" block P5 (`applyAvailable` replaces it with the form); the close and reopen dialogs in S8 (they need the retention sentences: applications kept one year after the close, never beyond two years after submission, reopen resets the close-based clock only). The `careers.applicants` permission description R1 was written for this increment.
- **The sweep:** `presby_careers_sweep(p_limit integer default 200)` returns `(kind, organization_id, posting_id, application_id)`; re-create it with `create or replace` and add rows of `kind = 'application_redacted'`. `src/lib/careers/sweep.ts` writes the audit rows in the same owner transaction.
- **Key facts in the schema this increment builds on:** `job_postings_id_org_key unique (id, organization_id)` is the composite-FK target; `first_published_at`, `closed_at` (cleared on reopen) and the posting `version` exist; "open" is derived at read time and the submit definer must compute it itself (published, and closing date not passed in the organization's zone via `presby_careers_org_today`).
- **Abuse and PII rules** from Phase 1 Pass 5 and Phase 2 Notes 1–3 and 6 all apply unchanged; the Neon-branch warning (never branch production for pipeline work) applies from the first applicant row onward.
- **Findings carried:** F290 and F294 are resolved by construction in this increment's design (own table, no confirmation email); F295 is the derived retention ceiling `least(closed_at + 1y, submitted_at + 2y)`.

---

# Phase 3 — Technical Design (tech-lead)

*Not started.*
