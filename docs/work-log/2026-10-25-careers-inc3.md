# Careers, Increment 3: cutover — Work Log

> **Slug:** `2026-10-25-careers-inc3`
> **Parent:** `docs/work-log/2026-10-25-careers.md` (shared Phase 1 and Phase 2, verbatim)
> **Predecessors:** `-inc1` (postings) and `-inc2` (apply, review and retention) merged and released
> **Surface:** operations and content; little or no platform code
> **Permission(s):** none new
> **Flag(s):** none
> **Estimated complexity:** small
> **Pipeline mode:** Full, or an Accelerated Feature if it adds no migration, route, action or catalog change (decided at its kickoff, with explicit notation)
> **Numbers:** none pre-assigned; claim at kickoff if code turns out to be needed.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (parent log) | READY WITH NOTES | 2026-10-25 |
| 2 — Architectural review | architect | Complete (parent log) | Approved with suggestions | 2026-10-25 |
| 3 — Technical design | tech-lead | **Not started** — written at this increment's kickoff | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

## Scope (from the parent's Phase 2 increment ruling)

The operator runbook; the Track K import carried out for the pilot congregation; the Turnstile hostname check on the church's own domain; the Phase 6 walk for the whole feature.

## Handed over from Increments 1 and 2 (do not rediscover)

- **Runbook contents.** (1) How a hiring committee gets access: the founding administrator adopts the "Hiring Committee" template at Roles → New role (it carries `careers.manage` and `careers.applicants`; adoption works only because both keys are in the founding-administrator bundle, F111), then grants the role to the committee's group so membership drives access and rotation is automatic; a committee member sees the Home tile within the session-refresh window. (2) Turn on "Job openings" under Features. (3) Whoever maintains the website adds the `careers` live slot on the Employment page (Increment 1's post-ship steps give the exact `content/employment.json`; do it **after** the toggle is on and a posting is published). (4) The Turnstile site key's hostname list includes the church's own domain (Increment 2 Note 5). (5) Never branch production for pipeline work (applicant data). (6) The retention promise, in the words the apply form uses, and who to ask to remove an application early.
- **Pre-deploy check, production, read-only:** no live bundle has a page below `/careers/` (query in Increment 1's Integration items). Expected 0 rows.
- **Track K, postings:** the import note is in Increment 1 (owner connection, draft → publish → close, `htmlToMarkdown` run in Node, counts only in anything written down). **Applicants are not imported (Q11).** The church owes a manual deletion date for in-retention resumes still in its Drive; export a non-PII list (application id, posting id, purge date, Drive file id) so the deletion is auditable.
- **Phase 6 walk** (parent Phase 1 list, whole feature): an anonymous applicant at 360px on a platform host and a custom host; a manage-only holder; a committee member who got `careers.applicants` through a group role (the person this path creates); the founding administrator who accepted an invitation, adopted the role and turned the toggle on, at 360px, listing each page they land on; a member with no permission; an organization with the toggle off.
- **Retention-copy truthfulness check:** the apply form's retention notice and every removal dialog must stay true to the redaction design (no "permanently erased", no "no one else can see this"); the Neon point-in-time history, dead-tuple and production-branch residuals are the ones not to deny.

---

# Phase 3 — Technical Design (tech-lead)

*Not started.*
