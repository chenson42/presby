# ESLint Date-Rendering Blind Spots — Work Log

> **Slug:** `2026-05-18-eslint-date-blind-spots`
> **Surface:** decision / lint rules
> **Permission(s):** none
> **Flag(s):** none
> **Estimated complexity:** small
> **Pipeline mode:** Decision-first; implementation depends on the call

## Context

Surfaced as follow-up #3 from `docs/work-log/2026-05-18-timezone-safe-dates.md` (Phase 6 adversarial pass). The `no-restricted-syntax` rule added in v0.3.4 bans:

- `Date.prototype.toLocaleString()`
- `Date.prototype.toLocaleDateString()`
- `Date.prototype.toLocaleTimeString()`

It does **not** catch these equivalent footguns a future Phase 4 implementer could reach for instead:

1. **`new Intl.DateTimeFormat(...).format(date)`** — same TZ-leak class, just via the explicit Intl API.
2. **`Date.prototype.toString()` / `toDateString()` / `toTimeString()`** — locale-and-TZ-sensitive on the server.
3. **Manual template-literal assembly** — `\`${d.getFullYear()}-${d.getMonth()+1}-…\`` runs in whichever environment evaluates it.

All three require deliberate workarounds, not accidents — so this is a low-priority paper-cut, not a regression risk. Analyst's Phase 6 verdict was SHIP WITH NOTES, not NEEDS REWORK.

## Goal

1. Decide whether to extend the ESLint rule to cover any/all of the three bypass vectors, or whether to accept the limitation and document it.
2. If extending: write the additional `no-restricted-syntax` patterns and add them to `eslint.config.mjs`.
3. If accepting: write a `docs/decisions.md` entry (e.g., DECISION-008) naming the gap, the reasoning, and the fallback ("`<FormattedDate>` is the only sanctioned path; anything else gets caught in code review").

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Pending — likely skipped (no user-facing change) | — | — |
| 2 — Architectural review | architect | Pending — likely skipped (extends an existing rule or writes a decision) | — | — |
| 3 — Technical design | tech-lead | Pending — primary decision lives here | — | — |
| 4 — Implementation | tech-lead | Pending — either ESLint patch or decision entry | — | — |
| 5 — Verification | qa | Pending — confirm rule fires on contrived test cases if extended | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

## References

- Parent work-log: `docs/work-log/2026-05-18-timezone-safe-dates.md` (Phase 6 adversarial pass, follow-up #3)
- DECISION-007 in `docs/decisions.md` — establishes the primitive + initial ESLint rule
- Release notes: `docs/release-notes/v0.3.md` — 0.3.4 known follow-ups list
