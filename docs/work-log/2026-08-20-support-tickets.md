# Support Tickets — Work Log

> **Slug:** `2026-08-20-support-tickets`
> **Surface:** mixed — member/tenant-facing (file a ticket), admin-facing (triage/work a ticket), partly AI-worked
> **Permission(s):** TBD by Phase 1
> **Flag(s):** TBD by Phase 1
> **Estimated complexity:** large — new domain, new tables, an AI-eligibility model, both tenant and platform surfaces
> **Pipeline mode:** Full, run with agents

---

## Context carried forward

**Why this pipeline exists, in the project's own words** (`docs/STATE.md`,
`docs/decisions.md` D8, `docs/schema-design.md` §11/§15):

> **No custom fields (D8).** Tags are the only tenant-extensible attribute.
> A new need is a support ticket and, if real, becomes a feature for every
> church. This makes the ticket loop load-bearing, so it cannot be built
> last.

D8 was **reversed after review** specifically because of this consequence —
custom fields are what every surveyed ChMS does, but a per-church field
nobody designed has no validation, no reporting, no enforced sensitivity
tier, and fragments the reusable-component thesis the whole schema depends
on. Choosing tags-only was only survivable by pulling ticketing forward, not
building it last (`docs/schema-design.md` §11's own honest cost: "without a
pressure-relief valve, low-stakes requests land in the ticket queue too...
survivable only if the loop is fast").

**A schema sketch already exists** (`docs/schema-design.md` §15, "Section
L — Tickets (sketch)" — sketched, not decided, because "their shape
constrains Phase 0 decisions," per §1's own framing):

```
tickets         (organization_id, submitter_person_id, category, change_class, status, assignee_kind)
ticket_messages (ticket_id, author_kind, body, created_at)
ticket_actions  (ticket_id, action, audit_event_id, applied_at)
```

**`change_class` is named as the load-bearing column**: `content | config |
theme | bug | feature`. The first three change tenant data and (per the
sketch) an AI worker may ship them continuously with no deploy; the last
two touch shared code and route to the human pipeline. "This must be a
column, not prose, so automation eligibility is a query" — Phase 1 should
treat this as the central design question, not assume it.

**Project overview** (`docs/STATE.md`) describes "a support-ticket loop
worked partly by AI" as one of the platform's core pillars, alongside
church management and council operations — this is not a minor admin
utility, it's named infrastructure.

**Prior art**: none of the four sibling repos (`fpcw-directory`,
`westervillelions`, `psvonline-portal`, `synod-portal`) are named in
CLAUDE.md's prior-art table as owning ticket-related requirements — Phase 1
should check them directly rather than assume nothing is there, but this
is likely closer to greenfield than P1/P9 were.

**Explicitly NOT yet answered by anything on record** — genuinely Phase 1's
job, not pre-decided: who can file a ticket (any tenant member? only a
`stated_clerk`-equivalent? both, with different categories?); what
"assignee_kind" actually resolves to (a human platform operator, an AI
worker, both with a handoff); what the AI worker's actual mechanism is
(does it have write access to tenant data for `content`/`config`/`theme`
tickets, and if so, through what guardrail — this touches the same
isolation invariants P1/P9 spent real effort on); how a ticket's resolution
relates to `docs/TODO.md`'s existing backlog-aggregator role (a `feature`-
class ticket becoming a tracked platform feature is explicitly the D8
consequence — does that mean writing to `docs/TODO.md`, or something else
entirely at runtime, since `docs/TODO.md` is a committed file the running
app has no access to).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY FOR DESIGN | 2026-08-20 |
| 2 — Architectural review | architect | Complete | Approved with suggestions — DECISION-069/070/071 | 2026-08-20 |
| 3 — Technical design | tech-lead | Pending | — | — |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY FOR DESIGN** (upgraded from the analyst's READY WITH NOTES — the
notes were exactly the open questions below, now resolved by the user
before Phase 2 launches)

## ONE-LINE TAKE

> A ticket-submission-and-triage loop with real precedent in this codebase
> (`/admin/feedback`'s state machine, the `org_portal.*` flag/permission
> pattern) — gated on both ends by a designated role rather than a
> baseline-member grant, resolved as an ordinary human-plus-Claude-Code
> engineering task with the ticket as the paper trail, not a new
> autonomous AI actor with its own write path.

## Prior art checked

None of the four sibling repos (`fpcw-directory`, `westervillelions`,
`psvonline-portal`, `synod-portal`) own a support-ticket system.
`synod-portal`'s "Ask the Hub" is the closest analog for "an AI surface
touching something it shouldn't be trusted with by default" — and it's
**read-only** over a curated corpus, and still needed a spend cap,
kill-switch flag, and rate limiting before shipping. Directly relevant
below: it's why the analyst treated an autonomous AI write-path as the
single riskiest part of this feature, and why the user's clarification
matters as much as it does.

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Any org member | File lightweight feedback about their congregation's experience | on demand, low friction |
| Tenant role-holder (`tickets.file`) | Review their org's incoming feedback; promote one into a formal ticket | per session |
| Tenant role-holder — `/o/<slug>/tickets/new` | File a ticket directly (subject, description, category, artifact upload) — same form the promote-from-feedback path pre-fills | on demand |
| Tenant role-holder — `/o/<slug>/tickets` | View their org's ticket list and a ticket's thread/status | on demand |
| Tenant role-holder | Reply to their own open ticket | on demand |
| Platform operator — `/admin/tickets` (new, parallel to `/admin/feedback`) | View the cross-org triage queue, filter by status/category | per session |
| Platform operator | Change status, reply, (re)classify category, assign | per ticket |
| Platform operator (+ Claude Code) | Resolve a ticket by making the underlying change through the app's own admin surfaces / engineering workflow — not a new AI-attributed write path | per ticket, as needed |

## Flows

**Flow 0 — Member feedback, promoted to a ticket:** entry — an org member
files lightweight feedback about their congregation's experience (low
friction, no `tickets.file` permission needed) → the org's designated
`tickets.file` role-holder reviews incoming feedback for their
organization → promotes one into a formal ticket, pre-filled from the
feedback body → proceeds as Flow 1. This is the low-friction on-ramp
Flow 1 alone doesn't provide: an ordinary member with a problem isn't
blocked from surfacing it just because they don't hold the filing role.
- Failure: feedback that's never promoted simply stays feedback — no
  forced conversion, no silent drop; the role-holder's queue is the only
  place "unpromoted" feedback needs to be visibly waiting.

**Flow 1 — File a ticket directly:** entry `/o/<slug>/tickets/new` (only
reachable by a holder of the new `tickets.file` permission) → subject,
description, category, optional artifact upload → submit → ticket
created, confirmation email queued via the existing durable email queue.
- Failure: invalid fields rejected inline; a DB/network failure on submit
  shows a human message, never a stack trace or silent no-op.

**Flow 2 — View and follow up:** entry `/o/<slug>/tickets` → thread view
(submitter + operator messages, current status, attached artifacts) →
optionally reply.
- Failure: a ticket ID belonging to another org, or that doesn't exist,
  returns a generic not-found — never a 403 that confirms the ID is real
  (the same enumeration discipline DECISION-040 already applies to org
  slugs).

**Flow 3 — Platform triage and resolution:** entry `/admin/tickets` →
cross-org list, filterable by status/category → open a ticket (submitter's
org, person, thread, artifacts) → change status / reply / classify /
assign → **resolve** by making the actual change through normal means (an
existing admin action, a migration, a code change) with a platform
operator holding `FEATURES.ADMIN_TICKETS` in the loop throughout — this is
where "worked in combo by a platform worker and Claude Code" lives: an
ordinary engineering task with a ticket for a paper trail, not a distinct
automated system.
- Failure: an illegal status transition is rejected server-side, current
  and attempted status both named (mirrors `feedback/actions.ts`'s
  `VALID_TRANSITIONS` exactly).

## Permissions & Flags

- **New tenant permission `tickets.file`** (module `support`, tier 1) —
  **granted via a designated role, not bootstrapped onto
  `active_membership`.** Resolved by the user directly: filing is gated
  the same way `role_grants.manage` is — a specific office-holder, not
  every member automatically. Phase 3 to decide the default fixture
  binding; `stated_clerk` is the natural first candidate since it's
  already the one designated-representative role that exists.
- **New platform permission `FEATURES.ADMIN_TICKETS`** — new `FEATURES`
  catalog key, admin-shell only, default to nobody, same posture as
  `FEATURES.ADMIN_FEEDBACK`.
- **New flag `org_portal.tickets`**, seeded off — mirrors `org_portal.
  directory` / `org_portal.roles`.

## Resolved by the user (2026-08-20), overriding/narrowing the analyst's open questions

1. **Filing is role-gated, not baseline.** The analyst recommended binding
   `tickets.file` to `active_membership` (every current member, matching
   `directory.view`'s bootstrap). The user explicitly chose the opposite:
   only a designated role can file — deliberately mirroring the
   platform-admin side's "a certain role" model on the tenant side too. An
   ordinary member with a problem goes through their congregation's
   designated role-holder, not directly.
2. **No autonomous AI-worker actor, at all.** This resolves the analyst's
   Open Question 1 and the single biggest risk they flagged. "Most would
   be worked in combo by a platform worker and Claude Code" means
   resolution is an ordinary human-supervised engineering task — a
   platform operator, with `FEATURES.ADMIN_TICKETS`, using Claude Code the
   way this entire repo already is used, to make whatever change the
   ticket calls for. There is no new AI-attributed identity, no new write
   path bypassing `withOrgContext()`, and no "ships with no deploy"
   automation to design. This substantially narrows Phase 3's scope
   relative to what the analyst flagged as needing its own future
   pipeline — `change_class`/category still matters (it's still useful to
   know at a glance whether a ticket is a copy tweak or a schema change),
   but it's advisory triage metadata now, not an automation-eligibility
   gate.
3. **Categories: confirmed in scope for v1**, resolving Open Question 3's
   overlap-with-`/admin/feedback` question in categories' favor — tickets
   get a real category field from day one, operator-correctable at
   triage (per the analyst's "not submitter-authoritative" recommendation,
   which still holds even without the automation-eligibility stakes).
4. **Artifact uploads: confirmed in scope for v1**, reopening the
   analyst's "deferred" recommendation. `src/lib/storage/` (the generic
   tenant-scoped blob adapter, DECISION-030/055/058, `store()`/`resolve()`
   only) already exists — the org logo was its first consumer; a ticket
   attachment is a natural second. Phase 3 to confirm file-type/size
   limits and whether an attachment is visible to the platform triage
   queue only or also reflected back to the submitter's own thread view
   (should be both, trivially, but naming it so it isn't assumed).
5. **A two-tier submission model, not filing-only-by-role.** Any ordinary
   member can file lightweight feedback about their congregation; the
   `tickets.file` role-holder is the one who promotes feedback into a
   formal ticket (Flow 0). This resolves the tension the role-gate
   otherwise creates (an ordinary member noticing a problem previously had
   no direct path at all under decision #1 above) without reopening
   baseline filing access. **Real open technical question for Phase 2,
   not decided here**: the existing platform `feedback` table
   (`src/lib/db/schema.ts:361`) has no `organization_id` — it's
   deliberately `userId`-only, and its own header comment states a
   privacy invariant ("FK to users only — no joins to roles, sessions, or
   any other application table"). "Congregation members file feedback"
   implies the feedback itself needs organization context to be
   promotable into a tenant-scoped ticket and to be visible to the right
   org's role-holder — Phase 2 must decide whether that's (a) the
   existing `feedback` table gaining a nullable `organization_id` (general
   platform feedback stays org-less; congregation feedback carries one),
   respecting or consciously revising its stated privacy invariant, or
   (b) a distinct, tenant-scoped feedback mechanism that doesn't touch the
   existing table at all. Not a call to make silently either way.

## Gaps the Request Didn't Address (still open for Phase 2/3)

- **Table placement is undecided and material** — a tenant-owned, RLS-
  enforced `tickets` table (`db/domain/`) read cross-tenant by platform ops
  via `getPlatformDb()`, or a platform-shell table (`schema.ts`, like
  `feedback`/`audit_events`) with `organization_id` as a plain column
  verified only at insert time. The single highest-value question for
  Phase 2 — it decides which connection each surface uses.
- **`audit_events.ticket_id`** exists only in the schema sketch
  (`docs/schema-design.md` §12), not in live `schema.ts` — add now if this
  pipeline touches `audit_events` at all, so a resolving mutation can be
  correlated back to its ticket without a later migration.
- **Routine triage (status/assignment/classification changes) is
  audit-exempt**, by direct precedent — `feedback/actions.ts` already
  marks its own status-change mutation this way. What's audited is
  whatever underlying tenant mutation resolves the ticket, under that
  mutation's own existing `AUDIT_ACTIONS` key.
- **PII/tier leakage through free text** — a ticket body is prose a
  member writes, and nothing in the schema stops tier-2/3 content being
  pasted in to illustrate a problem. Mitigation is procedural (small
  trusted `FEATURES.ADMIN_TICKETS` circle, submission microcopy), not
  something validation can close.
- **Empty states, 2FA mid-enrolment, 360px mobile** — named by the
  analyst, unchanged: real copy for both empty states, no special 2FA
  handling needed (`(org)` is already Edge-gated), and a real browser
  check owed at ship time per CLAUDE.md's "Verify in a Browser."

## Out of Scope (confirmed)

- **A distinct AI-worker actor identity or automated write path** — closed
  by the user's clarification above, not merely deferred to a future
  pipeline. Resolution runs through existing engineering workflows.
- **Internal/private operator notes** invisible to the submitter — v1
  assumes every operator reply is submitter-visible.
- **Any runtime write to `docs/TODO.md` or any committed file.** D8's "a
  real need becomes a feature for every church" is a human reading the
  ticket queue and deciding to run `/new-feature` — the running
  application has, and should have, zero write access to its own
  repository.
- **Platform admin filing a ticket on a congregation's behalf**
  (phone-support intake) — plausible, not in v1.
- SLA/priority/due-dates, canned responses, a public status page.

## Open Questions (remaining for Phase 2/3, not the user)

- Table placement (RLS-tenant vs. platform-shell) — Phase 2's call.
- Default fixture role binding for `tickets.file` (`stated_clerk`
  candidate) — Phase 3's call.
- `/admin/feedback` vs. tickets: permanent coexistence confirmed by the
  user implicitly (categories are in scope, meaning tickets is its own
  structured system, not a merge into feedback) — Phase 3 should still
  name where the line is in submitter-facing copy so members aren't
  confused about which form to use.

## Handoff

**Next: architect (Phase 2).** Carry forward: the table-placement question
as the single highest-value Phase 2 call; `tickets.file` is role-gated
(not baseline `active_membership`), but any member can file low-friction
feedback that a role-holder promotes into a ticket (Flow 0) — resolve
whether that reuses `feedback` with a nullable `organization_id` or is a
distinct tenant-scoped table, respecting or explicitly revising that
table's stated no-joins privacy invariant; no AI-actor identity or new
write path is in scope, at all — Phase 2/3 should not reintroduce it as a
"future-proofing" concern; categories and artifact uploads (via the
existing `src/lib/storage/` adapter) are both confirmed in scope for v1.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.** Phase 1 resolved every open product
question directly with the user; nothing here reopens the feature's
shape. Both questions named as the architect's to decide resolve the same
direction: FORCE-RLS tenant tables, never a platform-shell table with a
plain `organization_id`.

## Placement

**Table placement (the highest-value call): RLS-enforced tenant tables.**
`tickets`/`ticket_messages`/`ticket_actions` in a new `src/lib/db/domain/
support.ts` — FORCE RLS, composite FKs, following `role-grants.ts`'s
established query-layer module shape (`src/lib/tickets.ts`,
`withOrgContext()`, permission-check-first). **DECISION-069.** Rejected the
platform-shell alternative directly against precedent: `audit_events` is
the exact "plain `organization_id` on an RLS-less table" shape, and
DECISION-067 already ruled that unsafe-by-construction for a tenant-scoped
reader — deferred there because nothing needed it yet. This pipeline's
Flow 2 (a role-holder reading only their own org's tickets) needs it now,
so the same deferral isn't available. Tickets' two audiences (a tenant
role-holder, and the platform's `getPlatformDb()` bypass) are the ordinary
shape every tenant table already supports — not the genuine
two-tenant-simultaneous-read problem `organizations`/`person_links`/
`transfer_certificates` needed bespoke policies for.

**The `feedback` table question: a new tenant-scoped table, `feedback`
untouched.** **DECISION-070.** Same isolation reasoning applied to
`feedback` specifically — it's RLS-less by design, and Flow 0 needs a
tenant-scoped reader. Beyond isolation: platform-app feedback and
congregation-experience feedback are different products sharing a
textarea, not the same feature. The new table lives alongside `tickets`
in `support.ts`, keyed by `person_id` (never `users.id`).

**`submitter_person_id`** is a plain FK to global `people(id)` — D1 already
made `people` global, so F2's composite-key concern doesn't apply the way
it did pre-D1; the real guard is a write-time current-membership check
inside the transaction, mirroring `grantRole`'s target validation.
`ticket_messages`/`ticket_actions` FK into `tickets(id, organization_id)`
as a genuine composite, per F2 proper.

**Server vs client split:** ordinary Server Components throughout, `'use
client'` islands only for form inputs — same shape as every other `(org)`
form this session. No client-side data fetching needed.

**`(org)` layout / brand-scope:** `/o/<slug>/tickets*` needs no new
brand-scoped layout — it's already under the brandable `(org)/o/[slug]/`
tree. If Phase 3 wants a nested `tickets/layout.tsx` for shared nav, it
must **not** render `<BrandTokens>` itself (emission happens exactly once,
at `[slug]/layout.tsx` — a second emission violates `check-brand-
scope.mjs`'s two-layout tripwire). `/admin/tickets` is unbranded, same as
every other `(admin)` surface.

**Dependencies: none needed.** `src/lib/storage/blob-store.ts`'s `store()`/
`resolve()` is directly reusable for attachments — its dual-caller shape
(platform-authorized or tenant-authorized) already fits both submission
and triage without modification. **DECISION-071**: the interface carries
over as-is, but `blob_assets`' content-type/size CHECK constraints are
logo-specific policy, not adapter code — Phase 3 must make a deliberate,
enumerated call on the accepted MIME types and size cap for ticket
artifacts (almost certainly needs PDF beyond the logo path's PNG/JPEG/
WEBP), keeping the same magic-byte-sniffing discipline and the same
script-capable-format exclusion (SVG stays rejected; if PDF is added,
name whether it's rendered inline or served as an opaque download only).

## Invariants Touched

- **Isolation Is a Database Property** — the invariant that rules out the
  platform-shell alternative on both named questions; both new tables are
  FORCE RLS, the platform/tenant duality routes through the two existing
  connections, never an app-level `WHERE organization_id = X` on an
  unenforced table.
- **Composite Tenant Keys (F2)** — respected with the D1-aware correction:
  `submitter_person_id` plain FK (global `people`), `ticket_messages`/
  `ticket_actions` genuine composite FKs.
- **No Role Carries a Wildcard** — `tickets.file` is a new, narrow tier-1
  permission (module `support`), seeded via migration per DECISION-063's
  precedent; `FEATURES.ADMIN_TICKETS` is a new platform-shell key, same
  category as `ADMIN_FEEDBACK`, not church-facing.
- **Permissions vs Flags** — `org_portal.tickets` (seeded off) gates
  whether the surface exists at all; `tickets.file` gates who may use it —
  same split `org_portal.directory`/`directory.view` established.
- **The Edge Gate Cannot Reach the Database** — untouched; no `src/
  proxy.ts` changes needed.
- **No Real Data** — no schema action needed; free-text PII/tier leakage
  stays a procedural mitigation (Phase 1's own ruling), not a schema one.

## Notes for Phase 3

1. **`ticket_messages.author_kind`** needs the same discriminated shape
   `audit_events.actor_kind` uses — a submitter message is `person_id`, an
   operator message is `users.id` (a platform operator has no `people`
   row). Don't let one FK column serve both.
2. **`assignee_kind`** from the original schema sketch is now narrower
   than scoped — Phase 1 closed the AI-worker-actor question entirely, so
   this resolves to "platform operator" only. Tech-lead decides whether
   it's still worth a column or should be dropped for v1.
3. **Audit correlation needs no schema change**: `ticket_actions.
   audit_event_id` (ticket → audit, nullable, audit-exempt by default per
   Phase 1) and `recordAudit()`'s `metadata.ticketId` (audit → ticket,
   the existing F18/DECISION-067 convention) — not a new `audit_events`
   column.
4. **Congregation-feedback shape**: two legitimate options — a standalone
   table with its own promote-to-ticket action (architect's lean), or
   feedback-as-unpromoted-ticket via an `origin` column on `tickets`
   itself. Tech-lead picks one and states the choice, rather than
   defaulting silently.
5. Phase 1's already-deferred item stands: the default fixture role
   binding for `tickets.file` (`stated_clerk` candidate, per DECISION-066's
   precedent for the shape of that binding).

*Recorded by the orchestrator from the read-only architect agent's
report.*

---

# Phase 3 — Technical Design (tech-lead)

## Summary

[One paragraph: what we're building and why.]

## Permissions & Flags

- Permission key(s): `area.action`
- Default role bindings: [list]
- Feature flag(s): [key, or "not needed"]

## API Contract

- `POST /api/...` — purpose, request body, response shape
- `GET /api/...` — purpose, query params, response shape
- Or server-action signatures: `async function actionName(input): Promise<Result>`

## Data Model

[New tables / columns / indexes, or "No schema changes required."]

## Component / Page Plan

- Pages to create: [list]
- Components to create: [list]
- Files to modify: [list]

## Implementation Order

1. Schema (if any) → `npm run db:push` on a Neon branch
2. `FEATURE_CATALOG` entry + seed binding
3. Route handlers / server actions
4. UI
5. Audit events for security-sensitive paths
6. Release notes entry

## Edge Cases & Risks

- [Thing that could fail or that needs special handling]

## Implementer

[database-admin | api-developer | ux-developer | full-stack-developer]

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

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]
