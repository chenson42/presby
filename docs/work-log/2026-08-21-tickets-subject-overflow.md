# Ticket subject column overflow — Work Log

> **Slug:** `2026-08-21-tickets-subject-overflow`
> **Surface:** `(admin)` and `(org)` — both ticket list tables
> **Permission(s):** none — no permission surface touched
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant, accelerated (root cause already isolated before this file was created)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | orchestrator (brief, bug-fix variant) | Complete | Bug confirmed real | 2026-08-21 |
| 2 — Architectural review | — | Skipped | No invariant touched — pure CSS/markup fix, no new deps, no schema, no API surface | 2026-08-21 |
| 3 — Technical design | orchestrator (root cause, brief) | Complete | See below | 2026-08-21 |
| 4 — Implementation | orchestrator (direct) | Complete | 2 files fixed + 2 regression tests | 2026-08-21 |
| 5 — Verification | orchestrator (self-verified: test fails before fix, passes after) | Complete | PASS | 2026-08-21 |
| 6 — Shipped vs intent | orchestrator (brief) | Complete | Confirmed no longer manifests | 2026-08-21 |

---

## Phase 1 — the bug

User report: "on the admin screen the tickets screen's list of tickets
subject overflows." Confirmed by reading the code (not yet reproduced in a
browser — the fix is small enough and the root cause visible enough in the
markup that a screenshot wasn't needed to diagnose it, though the dev server
was already running to spot-check the fix visually after).

## Phase 3 — root cause

`src/components/ui/table.tsx`'s generated `TableCell` bakes `whitespace-nowrap`
into its base className (line 86 as of this commit). `src/app/(admin)/admin/tickets/page.tsx`'s
subject cell adds `max-w-xs` to the `TableCell` but the actual text lives in
a `<Link>` child with no `truncate`/`overflow-hidden` of its own — `max-w-xs`
alone doesn't clip `whitespace-nowrap` content, it just lets the column (and,
depending on browser table layout, the whole table) blow out wide instead of
respecting the intended max width. A long ticket subject pushes the row wide
rather than clipping.

**Not an isolated instance.** The identical pattern exists in
`src/app/(org)/o/[slug]/tickets/ticket-list.tsx`'s own subject cell — same
`max-w-xs` on the `TableCell`, same un-truncated `<Link>` child, same bug,
just not the one the user happened to be looking at. Both are fixed together
rather than only the one reported, since they're the same defect.

**The correct pattern already exists elsewhere in this codebase** —
`admin/email-queue/page.tsx` and `admin/audit/page.tsx` both wrap long cell
content in `<span className="block truncate ..." title={fullValue}>`. The
fix here applies that same convention directly to the `<Link>` (rather than
wrapping it in an extra span, since the link itself is the thing that needs
`display:block` for `truncate` to take effect) — `block truncate` classes
plus a `title` attribute carrying the untruncated subject, so the full text
is still available on hover/for screen readers via the accessible name.

## Phase 4 — implementation

### Files Modified

- `src/app/(admin)/admin/tickets/page.tsx` — subject `<Link>` gets
  `block truncate` added to its className and a `title={row.subject}`.
- `src/app/(org)/o/[slug]/tickets/ticket-list.tsx` — same fix, same reasoning,
  `title={ticket.subject}`.

### Regression Tests Added

- `src/app/(admin)/admin/tickets/page.test.tsx` — asserts the subject link
  carries `truncate` in its className and a `title` attribute equal to the
  full (untruncated) subject.
- `src/app/(org)/o/[slug]/tickets/ticket-list.test.tsx` — same assertion
  against `<TicketList>`.

Both were confirmed to fail against the pre-fix markup (no `truncate`
class, no `title` attribute) and pass after.

## Phase 5 — verification

- `npm run typecheck` — clean.
- `npx vitest run src/app/(admin)/admin/tickets/page.test.tsx "src/app/(org)/o/[slug]/tickets/ticket-list.test.tsx"` — both new assertions fail on the pre-fix code, pass on the post-fix code (verified both states directly, not assumed).
- Full `npx vitest run` — no regressions.
- Spot-checked visually against the running dev server with a long synthetic
  subject string — column now truncates with an ellipsis instead of
  stretching the table.

## Phase 6 — shipped vs intent

Confirmed: the reported overflow no longer manifests on `/admin/tickets`,
and the same defect is also closed on `/o/<slug>/tickets` before it was
ever reported there. No follow-ups.
