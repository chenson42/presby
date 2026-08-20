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
| 3 — Technical design | tech-lead | Complete | Design complete, twice revised same-day pre-Phase-4 (ticket email notifications + area/priority fields; then tickets.file's role binding decoupled to the sibling role-catalog pipeline) — DECISION-072 through 077 | 2026-08-20 |
| 4 — Implementation | database-admin → api-developer → ux-developer | Pending | — | — |
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

Two new tenant systems, deliberately kept apart: a role-gated **support
ticket** loop (`tickets`/`ticket_messages`/`ticket_actions`, `src/lib/
tickets.ts`, `/o/<slug>/tickets*`) for the designated `tickets.file`
role-holder to file, thread, and follow up on requests that reach the
platform team; and a baseline-member **congregation feedback** on-ramp
(`congregation_feedback`, `/o/<slug>/feedback`) that any current member can
use with no gate beyond an active relationship, which the role-holder
reviews and optionally promotes into a formal ticket (Flow 0). A new
platform surface, `/admin/tickets`, mirrors `/admin/feedback`'s shape
almost exactly for cross-org triage, but reads through `getPlatformDb()`
rather than the plain `db` connection — `tickets` is FORCE RLS
(DECISION-069) where `feedback` is not, and that is the one place this
design diverges from the reference pattern rather than copying it literally.
Attachments ride the existing `src/lib/storage/blob-store.ts` adapter
unchanged at the interface, widened at the shared CHECK constraint
(DECISION-071/073). No autonomous AI-worker actor exists anywhere in this
design — resolution is an ordinary engineering task a platform operator
performs through the app's existing admin surfaces, with the ticket as the
paper trail (Phase 1's binding resolution).

**Revised 2026-08-20, post-Phase-3, before Phase 4 starts** — two concrete
requirements from the user, additive to the shape above, not a re-litigation
of it: every ticket lifecycle event (filed, replied-to, resolved/declined,
promoted from feedback) now enqueues an email to the right audience through
the existing durable queue (`src/lib/email/`), via a new shared
`src/lib/tickets-notifications.ts`; and `tickets` gains two submitter-set,
operator-correctable fields — `area` (a controlled vocabulary, same shape as
`change_class`) and `priority` (`low|normal|high|urgent`, default `normal`)
— so a ticket is well-formed enough for an AI-assisted first triage pass to
work from structured fields rather than free text alone. See
DECISION-076/077.

## Permissions & Flags

- **`tickets.file`** — new tenant permission, module `support`, tier 1.
  Migration-seeded catalog row (DECISION-063 precedent — global, non-tenant,
  no org needed first), **owned end-to-end by this pipeline**: the
  `permissions` insert in `0019_presby_ticket_support.sql`, and every piece
  of application code that checks it (`hasTicketsFile`, the filing/thread/
  review-queue UI, the tenant `actions.ts` functions). **Which role binds
  to it is explicitly NOT this pipeline's call.** DECISION-072 originally
  piggybacked `tickets.file` onto the existing `stated_clerk` role; that
  was corrected (append-only, see DECISION-072's correction note) by the
  sibling `2026-08-20-role-catalog` pipeline, whose own Phase 1 resolved
  that `tickets.file` should bind to a new, deliberately non-constitutional
  custom role instead (working name "Support Contact," direct-granted to
  Marguerite Ashcombe) — the exact role key/name is that pipeline's own
  Phase 3 call, still in flight. **This pipeline's Phase 4 does not write
  an `app_roles`/`app_role_permissions`/`role_grants` fixture row for
  `tickets.file`** — that write belongs entirely to `2026-08-20-role-
  catalog`'s own Phase 4, once its Phase 3 finalizes the role. This needs
  no coordination to ship correctly: `hasTicketsFile` is just
  `presby_has_permission(..., 'tickets.file')`, which correctly returns
  `false` for everyone at every org until *some* role, anywhere, is bound
  to it — the permission catalog row and the application code that checks
  it are both fully functional and testable with zero holders. Same split
  DECISION-063 already established for `directory.view`: the catalog row
  is migration work, the per-org role binding is a separate, later
  concern.
- **`FEATURES.ADMIN_TICKETS`** (`"admin.tickets"`) — new platform `FEATURES`
  catalog key, `src/lib/permissions.ts`, category `"admin"`, default to
  nobody (same posture as `FEATURES.ADMIN_FEEDBACK`).
- **`org_portal.tickets`** — new flag, seeded OFF in `scripts/seed.ts`,
  same `org_portal.directory`/`org_portal.roles` pattern (checked bare, no
  DECISION-026 wrapper — a toggle, not an auth path). **Gates the entire
  surface as one unit**: the tickets list/filing/thread pages under
  `/o/<slug>/tickets*` AND the baseline-member feedback page at
  `/o/<slug>/feedback` share this one flag — there is no product reason to
  ship the on-ramp without the destination or vice versa, and a second flag
  would only invite the two drifting out of sync.

## API Contract

### `src/lib/tickets.ts` — tenant-scoped, mirrors `role-grants.ts`'s shape exactly

One `withOrgContext()` transaction per exported function, permission-gate
(`hasTicketsFile`, a private helper identical in shape to `role-grants.ts`'s
`hasRoleGrantsManage` — a single `presby_has_permission(..., 'tickets.file')`
call) first in every function that requires it. Thrown exceptions
(`OrgAccessError` from `withOrgContext` itself) for genuine failure; typed
result variants for every expected/denied outcome. **`submitFeedback` is the
one exported function with NO permission gate** — any current member passes;
`withOrgContext`'s own membership re-check is the only gate, which is the
correct shape for a baseline capability (same reasoning `active_membership`'s
derived-group grant already established for `directory.view`).

```ts
export type ChangeClass = "content" | "config" | "theme" | "bug" | "feature";
export type TicketArea =
  | "directory" | "roll" | "roles" | "giving" | "events" | "website"
  | "account" | "other";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketStatus =
  | "new" | "triaged" | "in_progress" | "resolved" | "declined";
export type FeedbackStatus = "new" | "promoted" | "dismissed";

// --- Filing -----------------------------------------------------------
export interface FileTicketInput {
  subject: string;            // 1-200 chars, trimmed
  changeClass: ChangeClass;
  area: TicketArea;            // required — same submitter-sets/operator-
  priority: TicketPriority;    // corrects shape as changeClass (DECISION-076)
  body: string;                // 1-5000 chars, trimmed; becomes ticket_messages row 1
  attachmentKey?: string;      // an already store()'d blob_assets.id at this org
}
export type FileTicketResult =
  | { kind: "ok"; ticketId: string }
  | { kind: "forbidden" }
  | { kind: "invalid_input"; errors: string[] }
  | { kind: "invalid_attachment" };
export async function fileTicket(
  submitterPersonId: string, organizationId: string, input: FileTicketInput,
): Promise<FileTicketResult>;

// --- Reading ------------------------------------------------------------
export interface TicketListEntry {
  ticketId: string; subject: string; changeClass: ChangeClass;
  area: TicketArea; priority: TicketPriority;
  status: TicketStatus; submitterDisplayName: string;
  createdAt: string; lastActivityAt: string; messageCount: number;
}
export type ListTicketsResult =
  | { kind: "ok"; tickets: TicketListEntry[] } | { kind: "forbidden" };
export async function listTickets(
  viewerPersonId: string, organizationId: string,
  filter?: { status?: TicketStatus; area?: TicketArea; priority?: TicketPriority },
  // Sort: urgent > high > normal > low, then lastActivityAt desc within a
  // priority band — a CASE expression in ORDER BY, no dedicated priority
  // index needed at this volume (see Data Model).
): Promise<ListTicketsResult>;

export interface TicketThreadMessage {
  messageId: string; authorKind: "submitter" | "operator";
  authorDisplayName: string; body: string;
  attachment: { key: string; contentType: string } | null; createdAt: string;
}
export interface TicketThread {
  ticketId: string; subject: string; changeClass: ChangeClass;
  area: TicketArea; priority: TicketPriority;
  status: TicketStatus; submitterDisplayName: string; createdAt: string;
  messages: TicketThreadMessage[];
  // Deliberately NO ticket_actions/assignee data — the tenant thread shows
  // conversation only; triage churn (assignment, reclassification history)
  // stays operator-internal. Not asked for by Phase 1, and the analogous
  // "who reassigned what" noise has no submitter-facing value. area/
  // priority ARE shown — they're the ticket's own classification, not
  // triage churn, same visibility class as changeClass/status already had.
}
export type TicketThreadResult =
  | { kind: "ok"; thread: TicketThread }
  | { kind: "forbidden" }
  | { kind: "not_found" };  // BOTH "doesn't exist" and "belongs to another
                              // org" — see Edge Cases, enumeration discipline
export async function getTicketThread(
  viewerPersonId: string, organizationId: string, ticketId: string,
): Promise<TicketThreadResult>;

// --- Replying -------------------------------------------------------------
export type ReplyResult =
  | { kind: "ok"; messageId: string; ticketSubject: string;
      assigneeUserId: string | null }  // NEW — for notifySubmitterReply's
      // "who to email" decision in the calling action; assigneeUserId is a
      // backend-only value passed to the notify call, never rendered in the
      // tenant thread UI (see the TicketThread note just above).
  | { kind: "forbidden" }
  | { kind: "not_found" } | { kind: "invalid_input"; error: string }
  | { kind: "invalid_attachment" };
export async function replyToTicket(
  authorPersonId: string, organizationId: string, ticketId: string,
  input: { body: string; attachmentKey?: string },
): Promise<ReplyResult>;

// --- Feedback (Flow 0) ------------------------------------------------
export type SubmitFeedbackResult =
  | { kind: "ok"; feedbackId: string } | { kind: "invalid_input"; error: string };
export async function submitFeedback(  // NO forbidden kind — see header above
  submitterPersonId: string, organizationId: string, body: string,
): Promise<SubmitFeedbackResult>;

export interface FeedbackListEntry {
  feedbackId: string; submitterDisplayName: string; body: string; createdAt: string;
}
export type ListFeedbackResult =
  | { kind: "ok"; feedback: FeedbackListEntry[] } | { kind: "forbidden" };
export async function listPendingFeedback(  // status = 'new' ONLY — the
  viewerPersonId: string, organizationId: string,  // review queue, not a
): Promise<ListFeedbackResult>;                     // full feedback history

export type FeedbackPreviewResult =
  | { kind: "ok"; feedback: { feedbackId: string; submitterDisplayName: string;
      body: string; status: FeedbackStatus } }
  | { kind: "forbidden" } | { kind: "not_found" };
export async function getFeedbackPreview(   // powers /tickets/new?fromFeedback=<id>'s
  viewerPersonId: string, organizationId: string, feedbackId: string,  // pre-fill;
): Promise<FeedbackPreviewResult>;            // returns the row regardless of status,
                                               // page renders "already handled" copy

export type PromoteFeedbackResult =
  | { kind: "ok"; ticketId: string; submitterEmail: string | null;
      submitterName: string }  // NEW — the ORIGINAL feedback submitter's
      // email/name, resolved inside this same transaction (people JOIN
      // users), for notifySubmitterOfPromotion() and
      // notifyOperatorsOfNewTicket() in the calling action. Nullable
      // defensively (a person with no linked users row), though in
      // practice always present — reaching /o/<slug>/feedback requires
      // signing in, which requires the link.
  | { kind: "forbidden" }
  | { kind: "not_found" } | { kind: "already_handled" }
  | { kind: "invalid_input"; errors: string[] };
export async function promoteFeedbackToTicket(
  actingPersonId: string, organizationId: string, feedbackId: string,
  input: { subject: string; changeClass: ChangeClass; area: TicketArea;
           priority: TicketPriority },
  // body comes from the feedback row itself, not a new param — pre-filled,
  // per Flow 0. submitterPersonId on the resulting ticket is the ORIGINAL
  // feedback submitter (feedback.person_id), never actingPersonId — see
  // Edge Cases for why this deliberately skips a current-membership re-check.
): Promise<PromoteFeedbackResult>;

export type DismissFeedbackResult =
  | { kind: "ok" } | { kind: "forbidden" } | { kind: "not_found" }
  | { kind: "already_handled" };
export async function dismissFeedback(
  actingPersonId: string, organizationId: string, feedbackId: string,
): Promise<DismissFeedbackResult>;
```

### `src/lib/tickets-notifications.ts` — new, shared by both `(org)` and `(admin)` action files

DECISION-077. `tickets.ts` itself stays DB-only, no email import — the same
split `feedback/actions.ts` already draws between the query/mutation layer
and the side-effect layer, just factored into a shared module because,
unlike the one-off `enqueueEmail()` call `fileTicketAction` already had,
these five events are needed from **two different route trees**
((org)/tickets, (org)/feedback, and (admin)/tickets) and the "who holds
`FEATURES.ADMIN_TICKETS`" lookup would otherwise be duplicated. Uses the
plain `db` export, never `getPlatformDb()` — `users`/`userRoles`/`roles`/
`roleFeatures` carry no RLS at all (they are not in `0009`'s `tenant_tables`
array), so there is no F26-shaped connection question here, unlike the
admin `tickets`/`ticket_messages` reads next door.

```ts
import "server-only";

export interface TicketOperator {
  userId: string; email: string; name: string | null;
}

// The join getAssignableOperators() would otherwise have duplicated —
// users JOIN userRoles JOIN roles JOIN roleFeatures WHERE
// roleFeatures.featureKey = FEATURES.ADMIN_TICKETS. admin/tickets/
// actions.ts's assignment dropdown calls this directly rather than
// keeping its own separately-named copy.
export async function getTicketOperatorPool(): Promise<TicketOperator[]>;
export async function resolveOperatorByUserId(
  userId: string,
): Promise<TicketOperator | null>;

// Each function below: escapeHtml() every interpolated string (XSS
// invariant, matches feedback/actions.ts's own comment), builds a small
// HTML body, calls enqueueEmail() with a templateKey unique per event
// ('ticket_new' | 'ticket_operator_reply' | 'ticket_submitter_reply' |
// 'ticket_resolved' | 'ticket_feedback_promoted'), wrapped in try/catch
// logged via console.error — NEVER throws. A notification failure must
// never take down the mutation it reports on, same contract
// recordAudit() already holds for audit writes.

export async function notifyOperatorsOfNewTicket(params: {
  ticketId: string; slug: string; organizationName: string;
  subject: string; changeClass: string; area: string; priority: string;
  submitterName: string;
}): Promise<void>;
// to: every getTicketOperatorPool() row. Called from BOTH
// fileTicketAction AND promoteFeedbackAction — a promoted ticket needs
// operator attention exactly as much as a directly-filed one; the
// original requirement only named the filing path explicitly, but the
// reasoning ("so the platform team knows to work it") applies identically
// to both entry points, so both call it.

export async function notifySubmitterOfOperatorReply(params: {
  ticketId: string; slug: string; submitterEmail: string;
  submitterName: string; operatorName: string; subject: string; excerpt: string;
}): Promise<void>;

export async function notifyOperatorsOfSubmitterReply(params: {
  ticketId: string; subject: string; submitterName: string; excerpt: string;
  assignee: TicketOperator | null;  // non-null -> that operator only;
                                      // null -> falls back to the pool
}): Promise<void>;

export async function notifySubmitterOfResolution(params: {
  ticketId: string; slug: string; submitterEmail: string;
  submitterName: string; subject: string; status: "resolved" | "declined";
}): Promise<void>;
// Fires ONLY for these two terminal statuses — see Edge Cases for why
// triaged/in_progress are silent.

export async function notifySubmitterOfPromotion(params: {
  ticketId: string; slug: string; submitterEmail: string;
  submitterName: string; subject: string;
}): Promise<void>;
```

No rate-limiting or digestion is added on top of these — see Edge Cases for
why the event list itself is already the anti-spam design.

### `src/app/(org)/o/[slug]/tickets/actions.ts` — Server Actions, tenant side

Same split as `admin/roles/actions.ts`: `auth()` directly (not
`cachedAuth()`), re-resolve `organizationId` from the URL slug via
`resolveOrgContext()` every call (never client-supplied), pass both
`session.user.id` (→ `granted_by`-style `users.id` fields, unused here since
nothing in this module writes one) and `resolved.org.personId` in.

```ts
async function fileTicketAction(
  slug: string, formData: FormData,
): Promise<ActionResult<{ ticketId: string }>>;
// FormData: subject, changeClass, area, priority, body, attachment? (File).
// Validates size/type and calls getBlobStore().store() BEFORE calling
// fileTicket() — E-c1/E-c2 ordering from the brand-logo path, see Edge
// Cases. On ok: enqueueEmail() confirmation to the submitter (Flow 1,
// unchanged — session.user.email/name and resolved.org.name are already in
// hand, no extra lookup), NEW: notifyOperatorsOfNewTicket({ ticketId, slug,
// organizationName: resolved.org.name, subject, changeClass, area,
// priority, submitterName: session.user.name }), recordAudit(
// AUDIT_ACTIONS.TICKET_CREATED, { resourceType: "ticket", resourceId:
// ticketId, metadata: { organizationId, changeClass, area, priority,
// subject } }), revalidatePath(`/o/${slug}/tickets`).

async function replyToTicketAction(
  slug: string, ticketId: string, formData: FormData,
): Promise<ActionResult<{ messageId: string }>>;
// On ok: replyToTicket()'s result carries assigneeUserId. NEW: if present,
// resolveOperatorByUserId(assigneeUserId) then
// notifyOperatorsOfSubmitterReply({ ..., assignee }); if absent, the same
// call with assignee: null (falls back to the pool internally). No audit
// — see Audit Events.

async function promoteFeedbackAction(
  slug: string, feedbackId: string,
  input: { subject: string; changeClass: ChangeClass; area: TicketArea;
           priority: TicketPriority },
): Promise<ActionResult<{ ticketId: string }>>;
// On ok: promoteFeedbackToTicket()'s result carries submitterEmail/
// submitterName (the ORIGINAL feedback author, not the promoting
// role-holder). NEW: notifySubmitterOfPromotion({ ..., submitterEmail,
// submitterName, subject }) if submitterEmail is non-null (console.warn
// and skip otherwise — same "no admins found" precedent
// feedback/actions.ts already sets), AND notifyOperatorsOfNewTicket({...})
// — a promoted ticket needs the pool's attention exactly as much as a
// directly-filed one (see the notify-module note above for why both fire).
// recordAudit(AUDIT_ACTIONS.TICKET_FEEDBACK_PROMOTED, { resourceType:
// "ticket", resourceId: ticketId, metadata: { organizationId, feedbackId,
// changeClass, area, priority, subject } }).

async function dismissFeedbackAction(
  slug: string, feedbackId: string,
): Promise<ActionResult>;
// audit-exempt: routine triage disposition; see feedback/actions.ts's
// identical precedent.
```

### `src/app/(org)/o/[slug]/feedback/actions.ts` — the baseline on-ramp

```ts
async function submitCongregationFeedbackAction(
  slug: string, body: string,
): Promise<ActionResult<{ feedbackId: string }>>;
// Rate-limited: checkRateLimit(`congregation-feedback:${personId}`, {max:5,
// windowSeconds:3600}) — same 5/hour shape as (member)/feedback/actions.ts's
// submitFeedback, applied here because THIS surface (unlike ticket filing)
// is reachable by every current member, the same open-exposure profile
// platform feedback already has. audit-exempt: personal-data submission,
// rate-limited, matches platform feedback's own precedent exactly.
```

### `src/app/(admin)/admin/tickets/actions.ts` — platform triage

**USES `getPlatformDb()`, NOT the plain `db` export
`admin/feedback/actions.ts` uses.** This is the one place a literal copy of
the reference pattern is wrong: `feedback` is a platform-shell table with no
RLS at all, so `db` (RLS-enforced, `presby_app`) and `getPlatformDb()`
(bypasses RLS, `presby_platform`) read it identically. `tickets` is FORCE
RLS (DECISION-069) — reading it through `db` with no org GUC set returns
**zero rows for every organization**, silently, the exact F26 failure shape
this codebase has hit twice already (`0015_presby_membership_probe.sql`,
`withOrgContext`'s own header). `getPlatformDb()` is the only correct
connection here.

```ts
async function updateTicketStatusAction(
  ticketId: string, newStatus: TicketStatus,
): Promise<ActionResult>;
// VALID_TRANSITIONS state machine, same shape as feedback/actions.ts's
// updateFeedbackStatus: new -> triaged|declined; triaged -> in_progress|
// declined; in_progress -> resolved|declined; resolved/declined terminal.
// The validating SELECT (already needed to read current status) also joins
// people+users on submitter_person_id to grab submitterEmail/
// submitterName/subject in the same query. Inserts a ticket_actions row
// (action: 'status_changed', fromValue/toValue: the two status strings).
// audit-exempt: routine triage — the ticket_actions row IS this surface's
// own record (Phase 1's own precedent, named explicitly). NEW: if
// newStatus is 'resolved' or 'declined', notifySubmitterOfResolution({
// ..., submitterEmail, submitterName, subject, status: newStatus }) — see
// Edge Cases for why 'triaged'/'in_progress' stay silent.

async function assignTicketAction(
  ticketId: string, assigneeUserId: string | null,
): Promise<ActionResult>;
// Inserts a ticket_actions row (action: 'assigned', toValue: the
// assignee's email, snapshotted at write time — see Data Model for why
// ticket_actions stores labels, not FKs). audit-exempt.

async function reclassifyTicketAction(
  ticketId: string, changeClass: ChangeClass,
): Promise<ActionResult>;
// Inserts a ticket_actions row (action: 'reclassified'). audit-exempt.

async function setTicketAreaAction(
  ticketId: string, area: TicketArea,
): Promise<ActionResult>;
// NEW — sibling to reclassifyTicketAction, identical shape and reasoning:
// area is operator-correctable, never submitter-authoritative, same as
// changeClass (DECISION-076). Inserts a ticket_actions row (action:
// 'area_changed'). audit-exempt.

async function setTicketPriorityAction(
  ticketId: string, priority: TicketPriority,
): Promise<ActionResult>;
// NEW — sibling to reclassifyTicketAction/setTicketAreaAction. Inserts a
// ticket_actions row (action: 'priority_changed'). audit-exempt. Kept as
// its own action rather than folded into reclassifyTicketAction — three
// single-field mutations, each with a 1:1 UI control and ticket_actions
// row, is less surprising than one action silently doing double or triple
// duty depending on which fields are present in its input.

async function replyToTicketAsOperatorAction(
  ticketId: string, body: string, attachmentKey?: string,
): Promise<ActionResult<{ messageId: string }>>;
// Inserts ticket_messages (authorKind: 'operator', authorUserId:
// session.user.id). No ticket_actions row — a reply is conversation, not a
// state transition (tenant-side replyToTicket() writes none either). The
// ticket-existence SELECT already needed here also joins people+users on
// submitter_person_id for submitterEmail/submitterName/subject. NEW: on
// ok, notifySubmitterOfOperatorReply({ ..., submitterEmail, submitterName,
// operatorName: session.user.name, subject, excerpt: body.slice(0, 200) }).
```

`getAssignableOperators()` — the assignment dropdown's data source — is now
just `getTicketOperatorPool()`, imported directly from
`src/lib/tickets-notifications.ts` (DECISION-077). The separate name from
the original design is dropped: it was the same "who holds
`FEATURES.ADMIN_TICKETS`" join either way, and the notify module needed the
identical query for `notifyOperatorsOfNewTicket()`/the submitter-reply
fallback — one function, two consumers, rather than the same SQL
maintained under two names in two files.

### Route handlers — attachment bytes

```
GET /o/<slug>/tickets/[id]/attachments/[key]   — tenant-scoped
GET /admin/tickets/[id]/attachments/[key]      — platform-scoped
```

Both: resolve `organizationId` (tenant: via `resolveOrgContext` +
`assertOrgAccess` + `hasTicketsFile`; platform: via `FEATURES.ADMIN_TICKETS`),
then **verify `key` is actually referenced by a `ticket_messages` row on
THIS `ticketId`** (a join, not a bare `blobStore.resolve({organizationId,
key})`) before serving bytes — defense in depth against a role-holder
fetching an unrelated blob at their org by guessing a UUID under a ticket
URL that has nothing to do with it. Sets `Content-Disposition: inline` for
`image/*`, `Content-Disposition: attachment; filename="attachment.pdf"` for
`application/pdf` — see Edge Cases / DECISION-073 for why PDF is never
rendered inline regardless of who uploaded it.

## Data Model

New migration `drizzle/0019_presby_ticket_support.sql` (hand-written, per
every migration since `0012` — `db:generate` stays broken on the pre-existing
snapshot collision, `docs/TODO.md`). Four new tenant tables in a new
`src/lib/db/domain/support.ts`, all **FORCE RLS**, added to their own
`support_tables` array (mirrors `0016_presby_brand_storage.sql`'s
`brand_tables` loop — these tables postdate `0009`'s original loop, so they
need their own `enable`/`force`/policy/grant block, not a hand-edit of
`0009`). Plus a widened `blob_assets` CHECK pair.

### `permissions` (migration-seeded row, DECISION-063 precedent)

```sql
insert into permissions (key, module, description, sensitivity_tier)
values ('tickets.file', 'support',
        'File and manage support tickets for this organization', 1)
on conflict (key) do nothing;
```

### `tickets`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk default random | |
| `organization_id` | uuid not null → `organizations(id)` on delete cascade | |
| `submitter_person_id` | uuid not null → `people(id)` | **Plain FK** (D1/DECISION-069 — `people` is global). For `fileTicket()` this is always the caller, already membership-verified by `withOrgContext`'s gate; for `promoteFeedbackToTicket()` it is the ORIGINAL feedback submitter, deliberately with no current-membership re-check — see Edge Cases. |
| `subject` | text not null | 1–200 chars, app-validated (no DB length CHECK — matches `feedback.body`'s own convention). |
| `change_class` | text not null | CHECK in `('content','config','theme','bug','feature')`. **Column name kept as `change_class`, not renamed to `category`** — continuity with `docs/schema-design.md` §15's already-committed sketch and its own "must be a column, not prose" framing; the UI label reads "Category" (Phase 1's own user-facing word). Submitter sets it at filing; operator-correctable at triage (Phase 1 resolution #3), never submitter-authoritative for anything downstream — there is no automation-eligibility gate reading it (resolution #2 closed that entirely). |
| `area` | text not null | **New (DECISION-076).** CHECK in `('directory','roll','roles','giving','events','website','account','other')`. Controlled vocabulary, not free text — a short flat CHECK list, same shape as `change_class`, deliberately not a free-text field: the whole point of the "AI can work the initial pass" requirement is a value an automated first pass can branch on directly, and free text is just more prose to parse, the opposite of what was asked for. The list mixes live org-portal surfaces (`directory`, `roll`, `roles`) with pillars named in the project overview but not yet built (`giving`, `events`, `website`) — a ticket can legitimately be about something that doesn't exist yet — plus `account` (self-serve/2FA) and `other` as the escape valve, so a bad-fit report isn't forced into a wrong bucket (same escape-valve reasoning tags-only D8 already relies on elsewhere). Submitter sets it at filing; operator-correctable at triage via `setTicketAreaAction`, same "never submitter-authoritative" posture as `change_class`. |
| `priority` | text not null default `'normal'` | **New (DECISION-076).** CHECK in `('low','normal','high','urgent')`. Submitter sets it at filing (required in `FileTicketInput`, matching `change_class`'s own required-ness); operator-correctable at triage via `setTicketPriorityAction` — mirrors `change_class`'s submitter-suggests/operator-confirms pattern exactly, per the most-consistent-choice reasoning. The DB default (`'normal'`) is a safety net for any future write path that doesn't set it explicitly, not a signal that the TS-level input is optional — it isn't. |
| `status` | text not null default `'new'` | CHECK in `('new','triaged','in_progress','resolved','declined')`. One state added versus `feedback`'s four-state machine (`in_progress`) — a ticket's lifecycle is longer-lived than a feedback row's, and Flow 3 explicitly describes an operator "resolving" a ticket by doing real work elsewhere, which needs a state between "acknowledged" and "done." |
| `created_at` | timestamptz not null default now() | |

**No `description` column.** The filing body is `ticket_messages` row 1
(`authorKind = 'submitter'`), not a duplicate copy on `tickets` — a ticket
is its subject plus a thread, github-issue-shaped, avoiding the two-places-
for-one-fact problem. **No `assignee_kind` column** (Phase 2 Note 2,
resolved): the only assignee kind that exists post-Phase-1 is "platform
operator," so a discriminator column for a fixed constant is the same
wildcard-shaped indirection D8's custom-fields reversal warned against one
layer down — `assignee_user_id uuid → users(id)` (nullable, platform-only
writer) is the whole of it. If a second assignee kind is ever real, that is
a real schema change earning its own review, not a speculative column now.
**No `description`/`origin` enum either** — traceability to a promoted
feedback row is `congregation_feedback.promoted_to_ticket_id`, one direction
is enough (see below).

Indexes/constraints:
```sql
unique (id, organization_id)                              -- composite-FK target, F2
index (organization_id, status, created_at)                -- tenant list + filter
index (status, created_at)                                 -- /admin/tickets cross-org queue
```
List sort ("most recently active") is a query-time
`GREATEST(tickets.created_at, MAX(ticket_messages.created_at))` aggregate,
not a denormalized `last_activity_at` column — no trigger, no staleness
risk, and ticket volume per congregation is small enough that the aggregate
is cheap. The list/queue's priority ordering (urgent > high > normal > low)
is likewise a query-time `CASE priority WHEN 'urgent' THEN 0 ... END` in
`ORDER BY`, not a dedicated index — at congregation/platform scale for this
product, sequential-scanning the `(organization_id, status, created_at)`
index's matched rows and sorting in memory is not worth a fifth index to
avoid; add one if `/admin/tickets` ever needs it under real volume, not
speculatively now.

### `ticket_messages`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk default random | |
| `organization_id` | uuid not null | |
| `ticket_id` | uuid not null | composite FK → `tickets(id, organization_id)` |
| `author_kind` | text not null | CHECK in `('submitter','operator')` |
| `author_person_id` | uuid, nullable | → `people(id)`, plain FK. Set iff `author_kind = 'submitter'`. |
| `author_user_id` | uuid, nullable | → `users(id)`. Set iff `author_kind = 'operator'`. |
| `body` | text not null | 1–5000 chars, app-validated |
| `attachment_asset_key` | uuid, nullable | composite FK → `blob_assets(id, organization_id)` |
| `created_at` | timestamptz not null default now() | |

```sql
check (num_nonnulls(author_person_id, author_user_id) = 1)
check (
  (author_kind = 'submitter' and author_person_id is not null and author_user_id is null)
  or
  (author_kind = 'operator'  and author_user_id  is not null and author_person_id is null)
)
index (organization_id, ticket_id, created_at)   -- thread read
```
The compound CHECK (not just `num_nonnulls`) is deliberate — `num_nonnulls`
alone would accept `author_kind = 'submitter'` paired with a populated
`author_user_id`, a mislabeled row that's structurally valid but a lie.
Same discriminated-identity shape Phase 2 Note 1 named
(`audit_events.actor_kind`'s pattern), extended with the label/column
consistency check that pattern's simplest form omits.

### `ticket_actions`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk default random | |
| `organization_id` | uuid not null | |
| `ticket_id` | uuid not null | composite FK → `tickets(id, organization_id)` |
| `action` | text not null | CHECK in `('created','promoted_from_feedback','status_changed','reclassified','area_changed','priority_changed','assigned')`. **`area_changed`/`priority_changed` are new (DECISION-076)** — one action kind per single-field operator mutation, matching `reclassified`'s existing shape rather than overloading it, so `setTicketAreaAction`/`setTicketPriorityAction` each write an unambiguous row. |
| `from_value` | text, nullable | plain label, not an FK — see below |
| `to_value` | text, nullable | plain label, not an FK |
| `actor_user_id` | uuid, nullable | → `users(id)`. Always a platform operator — Flow 3 is the only place status/reclassify/area/priority/assign happen; `fileTicket`/`promoteFeedbackToTicket` write their own `'created'`/`'promoted_from_feedback'` row with `actor_user_id` null (the actor there is a tenant person, not a platform user — the ticket's own `submitter_person_id`/the promoting role-holder is already recorded elsewhere; this table doesn't need a second discriminated actor-identity shape for two rows out of seven action kinds). |
| `audit_event_id` | uuid, nullable | → `audit_events(id)`, **plain FK to the global platform table** (same shape as `role_grants.granted_by → users(id)` — no composite needed, `audit_events` carries no `organization_id` column to compose against). **Ships always-null in this pipeline** — see the note below. |
| `applied_at` | timestamptz not null default now() | |

```sql
index (organization_id, ticket_id, applied_at)
```

`from_value`/`to_value` are **plain text labels the calling action already
has in hand** (e.g. the assignee's email, looked up once by
`assignTicketAction`), not a second set of nullable FK columns per action
kind — this table is a generic timeline, not a referentially-precise ledger;
precision belongs to `ticket_messages`/`tickets` themselves, which already
carry real FKs.

**`audit_event_id` always ships null in this pipeline, and that is worth
naming explicitly rather than leaving as an unexplained always-empty
column**: `recordAudit()`'s signature returns `Promise<void>`, not the
inserted row's id, so there is nothing for `fileTicketAction`/
`promoteFeedbackAction` to backfill this column WITH after calling it. The
column exists as schema headroom for a future pipeline that changes
`recordAudit()` to return its id (out of scope here — that is a change to a
shared, load-bearing platform module, not a ticket-support concern). The
working correlation direction that DOES ship is `audit_events.metadata.
ticketId` (audit → ticket), matching Phase 2 Note 3's framing and
DECISION-067's `metadata.ticketId` convention exactly. See DECISION-075.

### `congregation_feedback` (DECISION-070's standalone table)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk default random | |
| `organization_id` | uuid not null → `organizations(id)` on delete cascade | |
| `person_id` | uuid not null → `people(id)` | plain FK; always the caller, membership-verified by `withOrgContext`'s own gate |
| `body` | text not null | 1–2000 chars, app-validated — matches platform `feedback.body`'s own cap |
| `status` | text not null default `'new'` | CHECK in `('new','promoted','dismissed')` |
| `promoted_to_ticket_id` | uuid, nullable | composite FK → `tickets(id, organization_id)`, set atomically with `status = 'promoted'` |
| `created_at` | timestamptz not null default now() | |

```sql
index (organization_id, status, created_at)   -- the review queue
```

### RLS, grants (all inside `0019`, own `do $$` block per table-name array)

```sql
support_tables := array['tickets','ticket_messages','ticket_actions','congregation_feedback'];
-- for each: enable + FORCE row level security, tenant_isolation policy
-- (organization_id = presby_current_org()), same loop shape as 0016.

grant select, insert, update, delete
  on tickets, ticket_messages, ticket_actions, congregation_feedback
  to presby_platform;
-- new-table grant, 0016's own reasoning restated: 0009's "all tables"
-- grant only covered tables that existed at 0009's execution time.

grant select, insert on tickets, ticket_messages, ticket_actions to presby_app;
-- tenant side only ever INSERTS tickets/messages/actions (fileTicket,
-- replyToTicket, promoteFeedbackToTicket's own 'promoted_from_feedback'
-- action row) — never UPDATEs one. Status/assign/reclassify are
-- getPlatformDb()-only mutations (Flow 3).

grant select, insert, update on congregation_feedback to presby_app;
-- UPDATE needed here specifically: promoteFeedbackToTicket/dismissFeedback
-- both flip congregation_feedback.status from the tenant connection.
```

### `blob_assets` — widened CHECK constraints (DECISION-071/073)

```sql
alter table blob_assets drop constraint blob_assets_content_type_allowed;
alter table blob_assets add constraint blob_assets_content_type_allowed
  check (content_type in ('image/png','image/jpeg','image/webp','application/pdf'));

alter table blob_assets drop constraint blob_assets_byte_size_bounds;
alter table blob_assets add constraint blob_assets_byte_size_bounds
  check (byte_size > 0 and byte_size <= 10485760);  -- 10MB
```
And in `src/lib/storage/blob-store.ts`: widen the shared `ALLOWED_CONTENT_TYPES`
tuple to add `"image/pdf"` — wait, **`"application/pdf"`** — and
`MAX_BYTE_SIZE` to `10_485_760`. See DECISION-073 for the full reasoning
(one shared outer bound at the DB/adapter layer; each caller keeps its own
narrower magic-byte sniff and size message as the real per-feature gate —
the org-brand logo action's `sniffImageContentType()`/`MAX_LOGO_BYTES`
(2MB, images only) are **untouched**, so widening the shared constant does
not change what the logo path actually accepts in practice). The ticket
attachment action gets its own `sniffTicketAttachmentContentType()`
(PNG/JPEG/WEBP magic bytes, reusing/extending the existing sniffer, plus a
`%PDF-` magic-byte check), called before `store()`, same E-c1/E-c2 ordering.

## Component / Page Plan

**Pages to create**
- `src/app/(org)/o/[slug]/tickets/layout.tsx` — chrome only: back-link to
  `/o/<slug>`, a small static nav (All tickets / File a ticket). **No auth
  of its own** (same as `admin/layout.tsx` one level over — the page gates,
  not the layout). **Does NOT render `<BrandTokens>`** (Phase 2's explicit
  constraint — it sits beneath `[slug]/layout.tsx`, which already emits).
  No extra padding wrapper.
- `src/app/(org)/o/[slug]/tickets/page.tsx` — the list. **Two sections on
  one page**, same shape `admin/roles/page.tsx` already established ("Who
  holds what" + "Grant a role"): **"Open tickets"** (`listTickets()`) and
  **"Incoming feedback"** (`listPendingFeedback()`, each row linking to
  `/tickets/new?fromFeedback=<id>` for Promote, a same-page button/dialog
  for Dismiss). This is the concrete answer to "where does a role-holder
  review incoming feedback" — a section on the existing list page, not a
  fourth route, matching the one-page-does-more precedent already in this
  codebase rather than fragmenting triage across screens.
- `src/app/(org)/o/[slug]/tickets/new/page.tsx` — the filing form. Reads
  `searchParams: Promise<{ fromFeedback?: string }>`; when present, calls
  `getFeedbackPreview()` and pre-fills `body` with the feedback's own text,
  shows a "Promoting feedback from {name}" banner, and submits through
  `promoteFeedbackAction` instead of `fileTicketAction` — **one page
  component, two submit targets**, which is what "pre-filled from the
  feedback body → proceeds as Flow 1" actually means in UI terms.
- `src/app/(org)/o/[slug]/tickets/[id]/page.tsx` — thread + reply +
  attachment display. `getTicketThread()`'s `not_found` → Next's
  `notFound()`.
- `src/app/(org)/o/[slug]/tickets/[id]/not-found.tsx` — **new, segment-
  local** — "This ticket doesn't exist, or you don't have access to it."
  copy. `[slug]/not-found.tsx` (the org-slug 404) has the wrong copy for
  this case ("no such organization" vs "no such ticket inside an
  organization you're already in") — a dedicated boundary is needed, not a
  reuse. **No `loading.tsx` on this segment** (CLAUDE.md: a segment whose
  job can 404 must not open a Suspense boundary that flushes a 200 first).
- `src/app/(org)/o/[slug]/tickets/[id]/attachments/[key]/route.ts` — GET,
  tenant-scoped attachment bytes (see API Contract).
- `src/app/(org)/o/[slug]/feedback/page.tsx` — the baseline-member on-ramp.
  Auth: `resolveOrgContext` + `assertOrgAccess` only (no `tickets.file`
  check) + `org_portal.tickets` flag. One textarea, `submitFeedback()`.
- `src/app/(admin)/admin/tickets/page.tsx` — cross-org queue, mirrors
  `admin/feedback/page.tsx` almost exactly: `FEATURES.ADMIN_TICKETS` gate,
  `getPlatformDb()` select joining `tickets` + `organizations` (name) +
  `people` (submitter) + `users` (assignee email), `?status=&area=&priority=`
  filters (area/priority filtering is **new**, DECISION-076 — the whole
  point of a controlled vocabulary is that it's filterable the same way
  `status` already is), sorted by the priority `CASE` expression then
  `created_at`.
- `src/app/(admin)/admin/tickets/[id]/page.tsx` — detail: thread, the
  `ticket_actions` timeline (operator-only view — see API Contract), status/
  assign/classify/area/priority controls, reply form.
- `src/app/(admin)/admin/tickets/[id]/attachments/[key]/route.ts` — GET,
  platform-scoped attachment bytes.

**Components to create**
- `tickets/tickets-states.tsx` — `TicketsFlagOff`, `TicketsForbidden`,
  `TicketsLoadError` (mirrors `roles-states.tsx`/`directory-states.tsx`).
- `tickets/ticket-list.tsx`, `tickets/feedback-review-list.tsx` (server-
  rendered rows + a small `'use client'` dismiss button/dialog, mirrors
  `RolesList`+`RevokeDialog`'s split). `ticket-list.tsx` renders a
  colour-coded priority `Badge` per row (same `Badge` pattern
  `admin/feedback/page.tsx`'s `STATUS_BADGE`/`CATEGORY_BADGE` maps already
  use — exact colours are ux-developer's call), sorted urgent-first.
- `tickets/file-ticket-form.tsx` — `'use client'`, subject/changeClass
  select/**area select/priority select (new)**/body/attachment file input,
  handles the `fromFeedback` pre-fill banner and dual submit target.
  Priority select defaults to "Normal" pre-selected, not blank — matching
  the DB default and avoiding a submitter having to think about priority
  on the common case.
- `tickets/[id]/reply-form.tsx` — `'use client'`.
- `tickets/[id]/attachment-display.tsx` — renders `image/*` inline
  (`<img>` against the route handler URL, `max-w-full`), `application/pdf`
  as a plain download link — never an `<iframe>`/`<embed>` PDF viewer.
- `feedback/feedback-form.tsx` — `'use client'`, one textarea, distinct
  component from `(member)/feedback`'s (different table, different action,
  different destination — see Edge Cases for why this is NOT a reuse of the
  existing member-feedback UI).
- `admin/tickets/status-control.tsx`, `assign-control.tsx`,
  `classify-control.tsx`, **`area-control.tsx` (new)**,
  **`priority-control.tsx` (new)**, `admin-reply-form.tsx` — five small,
  independent optimistic-update-and-revert controls, mirrors
  `feedback-status-control.tsx`'s shape. Kept separate rather than one
  combined "classification" control, one-to-one with the five equally
  separate Server Actions (status/assign/reclassify/area/priority) they
  each call.

**Files to modify**
- `src/lib/permissions.ts` — add `FEATURES.ADMIN_TICKETS` + `FEATURE_CATALOG`
  entry.
- `src/lib/audit.ts` — add `TICKET_CREATED: "tenant.ticket.created"`,
  `TICKET_FEEDBACK_PROMOTED: "tenant.ticket.feedback_promoted"` to
  `AUDIT_ACTIONS`. **No new keys for area/priority** — both are
  operator-correctable triage fields, audit-exempt by the same reasoning as
  `change_class`/status/assignment (see Audit Events).
- `src/lib/tickets-notifications.ts` — **new file** (see API Contract):
  `getTicketOperatorPool()`, `resolveOperatorByUserId()`, and the five
  `notify*` functions. No existing file needs to change to accommodate it
  — `src/lib/email/`'s `enqueueEmail()` API is used as-is, unmodified.
- `src/lib/storage/blob-store.ts` — widen `ALLOWED_CONTENT_TYPES`/
  `MAX_BYTE_SIZE`; add the ticket-attachment sniff function (new file or
  inline — implementer's call, e.g. `src/lib/storage/sniff.ts` if shared
  with the org-brand sniffer's helpers).
- `src/app/(org)/o/[slug]/page.tsx` + `org-states.tsx` — thread a
  `ticketsEnabled` flag through `OrgPortalStub`, add "Tickets" and "Give
  feedback" cards (flag-gated at the card level, permission-gated on the
  destination page — same split `directoryEnabled`/`rolesEnabled` already
  use).
- `src/app/(admin)/admin/layout.tsx` — add `{ href: "/admin/tickets", label:
  "Tickets" }` to `nav`.
- `scripts/seed.ts` — add `org_portal.tickets` flag definition (seeded
  `enabled: false`).
- `scripts/seed-dev.sql` — **no `app_roles`/`app_role_permissions`/
  `role_grants` row for `tickets.file`** — that binding is
  `2026-08-20-role-catalog`'s own Phase 4 to write, once its Phase 3 names
  the role (see Permissions & Flags). This pipeline's `seed-dev.sql` change
  is limited to one or two synthetic sample rows (a ticket, a pending
  feedback row) at Alder Creek, inserted as **plain SQL, not through
  `fileTicket()`/`submitFeedback()`** — a raw `insert` bypasses
  `hasTicketsFile`'s runtime gate entirely (that check only fires inside
  the query-layer module's functions, never on a seed script's direct
  write), so the sample rows need no `tickets.file` holder to exist at
  insert time. `submitter_person_id` on both rows is an ordinary existing
  fixture member (not Marguerite Ashcombe specifically — the sample data
  represents a member's/role-holder's report, not a demonstration of who
  holds the role). See Implementation Order for the resulting, deliberate
  interim state this produces and why it's correct rather than a gap to
  route around.

## Implementation Order

1. **database-admin** — `drizzle/0019_presby_ticket_support.sql` (permission
   catalog row, four tables + FORCE RLS + grants, `blob_assets` CHECK
   widening), `src/lib/db/domain/support.ts` (table definitions),
   `scripts/seed-dev.sql` (sample fixture rows only — **no role binding
   here, see Permissions & Flags/Files to modify**), `npm run db:push` on a
   dev branch, `scripts/test-rls.sql` additions proving tenant isolation on
   all four new tables (a cross-org read of another org's ticket must
   return zero rows). **No Phase 4 ordering dependency on
   `2026-08-20-role-catalog`'s own Phase 4** — chose this over the
   alternative (sequencing one pipeline's Phase 4 after the other's)
   because the sample rows are raw SQL inserts, which never pass through
   `hasTicketsFile`'s runtime check, so they need no role-holder to exist
   at insert time. The one real, worth-naming consequence: until
   `2026-08-20-role-catalog`'s Phase 4 lands and binds some role to
   `tickets.file`, `/o/alder-creek/tickets` renders `TicketsForbidden` for
   every fixture person, including whoever eventually becomes the sample
   rows' submitter — the sample data sits in the database, correctly
   isolated and correctly invisible, exactly demonstrating the
   Permissions & Flags claim that the permission and the UI are fully
   functional with zero holders. Once the sibling pipeline's Phase 4 seeds
   a holder, the same rows become reviewable with no further seed-dev.sql
   change from this pipeline. QA should expect and confirm this sequence,
   not read it as a defect.
2. **api-developer** — `src/lib/tickets.ts` + `tickets.test.ts` (Postgres-
   backed, `role-grants.test.ts`'s harness shape — real fixtures across at
   least two orgs to prove cross-org `not_found`/enumeration discipline;
   include an area/priority round-trip and the resolved/declined-only email
   trigger as explicit test cases), `src/lib/storage/blob-store.ts`
   widening + the ticket sniff function, `src/lib/tickets-notifications.ts`
   (new — the five `notify*` functions + the operator-pool lookup), both
   `actions.ts` files (tenant `tickets/` and `feedback/`), the
   `(admin)/admin/tickets/actions.ts` file (now five triage actions:
   status/assign/reclassify/area/priority, plus the operator reply),
   both attachment route handlers, `src/lib/permissions.ts`/
   `src/lib/audit.ts` edits.
3. **ux-developer** — all pages/components listed above, `scripts/seed.ts`'s
   flag entry, `[slug]/page.tsx` + `org-states.tsx` card wiring,
   `(admin)/admin/layout.tsx` nav entry. Real-browser check at 360px for the
   filing form, the thread view (long reply text, inline image scaling,
   PDF link overflow), and the feedback textarea — CLAUDE.md's "Verify in a
   Browser" invariant, given this project's specific history of phone-only
   defects `next build` did not catch.
4. **tech-lead** (Phase 6/ship) — `docs/TODO.md` reconciliation, `docs/
   product/functionality-map.md` entry, `/release-notes` entry, `docs/
   decisions.md` DECISION-072 through 077 (072–075 drafted at Phase 3;
   076/077 drafted in the Phase 3 revision below, both before Phase 4
   starts).

## Edge Cases & Risks

- **Enumeration discipline (Flow 2), confirmed delivered, not just
  restated**: `getTicketThread()` runs inside `withOrgContext(viewerPersonId,
  organizationId, ...)` and queries `WHERE id = ticketId AND organization_id
  = organizationId`. A ticket belonging to another org fails this WHERE
  clause AND would be filtered by FORCE RLS even if the WHERE clause were
  ever dropped by a future edit — two independent reasons the query returns
  zero rows, both collapsing to the single `{kind:"not_found"}` result the
  page renders via `notFound()`. A genuinely nonexistent id takes the exact
  same path. No 403-shaped branch exists to leak "the id is real."
- **A member's feedback that's never promoted**: stays `status = 'new'`
  indefinitely, visible in `listPendingFeedback()` forever. **No forced
  expiry** — a silent timeout that moves a member's reported problem to
  `dismissed` without a human decision would be worse than an indefinitely
  full queue; the queue staying visibly non-empty is itself the correct
  pressure (mirrors `docs/schema-design.md` §11's own "a pressure-relief
  valve... survivable only if the loop is fast" framing — the fix for a
  slow loop is a faster loop, not an auto-dismiss).
- **A ticket/feedback row's `submitter_person_id`/`person_id` referencing
  someone whose membership has since ended**: no functional problem.
  `people`'s RLS policy (`0009_presby_rls.sql`) is `exists (select 1 from
  memberships where person_id = people.id and organization_id =
  current_org())` — **no `ended_on is null` filter** — so the person stays
  nameable to the org as long as ANY membership row (ended or not) exists,
  identical to `listGrants()`'s Finding 4. `promoteFeedbackToTicket()`
  therefore deliberately does **not** re-verify the original feedback
  submitter's current membership before promoting — the report is a
  historical fact regardless of whether its author is still a member, and
  refusing to promote it would lose real information for no isolation
  benefit (`submitter_person_id` is a plain FK to global `people`, not a
  composite-to-`memberships` target the way a `role_grants` grantee is).
- **A ticket filed against an org whose sole `tickets.file` holder has
  since left — no protection, and that is correct, not a gap this pipeline
  owns.** The original design here relied on `tickets.file` being bound to
  `stated_clerk` (which also carries `role_grants.manage`) for an emergent
  self-lockout protection; that binding was superseded (see DECISION-072's
  correction and Permissions & Flags above) in favor of a dedicated,
  non-constitutional role that carries `tickets.file` alone. `revokeRole()`
  only ever checks the hardcoded `role_grants.manage` key
  (`src/lib/role-grants.ts`), so a role holding solely `tickets.file` was
  never a candidate for that protection regardless of which role it lived
  on — this was never this pipeline's mechanism to build or preserve. The
  `2026-08-20-role-catalog` pipeline owns this finding (its Phase 1
  confirms the gap is deliberate, not an oversight, and notes
  `property_chair` already carries the identical exposure today) and the
  tracked `docs/TODO.md` consequence — no new content needed here beyond
  this pointer.
- **Attachment upload failure — atomic, not partial**: `getBlobStore().
  store()` runs and is validated (type sniff, size) **before** the ticket-
  creation transaction opens, exactly the org-brand logo path's E-c1/E-c2
  ordering — a failed upload creates nothing (no ticket, no message). If
  `store()` succeeds but the subsequent insert transaction fails for an
  unrelated reason, the blob row is orphaned — accepted as harmless dead
  data, same as the logo path already accepts (content-hash dedup means a
  retry with the same file doesn't double-store).
- **Attachments: inline vs opaque, and why they differ by format, not by
  who uploaded them** — see DECISION-073. Images render inline; PDF is
  always an opaque download, categorically, regardless of the uploader's
  trust level, mirroring G7's SVG exclusion reasoning for "a format able to
  carry executable content."
- **`(member)/feedback` vs `/o/<slug>/feedback` — not the same form,
  deliberately not reused.** Different table (`feedback` vs
  `congregation_feedback`), different destination action, different
  audience predicate (`(member)/feedback` has no org concept at all —
  DECISION-070's whole point). Reusing the component would mean branching
  its internals on which table to write to, which is the "two products
  sharing a textarea" shape DECISION-070 already rejected at the schema
  layer; rejecting it again at the component layer keeps the two genuinely
  separate rather than coupled through a shared client component that
  happens to look similar today.
- **360px mobile**: the filing form's category/area/priority `<Select>`s and
  attachment input must stack full-width (three selects plus a file input
  is a real vertical-space concern on a small screen, not just one); the
  thread view's message bodies need `whitespace-pre-wrap` + word-wrap (long
  unbroken URLs/tokens in a member's free text); inline attachment images
  need `max-w-full h-auto`; the PDF download link's filename must not force
  horizontal scroll; the priority badge on the list must not push a long
  subject line off-screen. Named for ux-developer's real-browser pass, not
  assumed from a passing `next build`.
- **Why no email rate-limiting or digestion (revision, requirement 1)**: the
  event list itself is the anti-spam design, not an omission needing a
  follow-up mechanism. Every trigger maps to genuinely new information a
  recipient doesn't already have (a ticket exists, a reply arrived, a
  terminal outcome was reached, feedback became a ticket) — there is no
  trigger on routine internal churn (`triaged`/`in_progress` status
  changes, reclassify/area/priority/assign) to begin with, so there is
  nothing to digest. `tickets.file` filing/replying is role-gated to a
  small, accountable circle (unlike `congregation-feedback` submission,
  which stays rate-limited per its own bullet above, matching platform
  `feedback`'s precedent) — a fast back-and-forth thread between one
  submitter and one operator is ordinary human reply cadence, not the
  automated-loop shape rate limiting exists to blunt. Revisit only if real
  usage shows otherwise; not built speculatively now.
- **Why `resolved`/`declined` email but not `triaged`/`in_progress`
  (revision, requirement 1)**: the two terminal states are the ones a
  submitter is actually waiting to hear about — a status change TO either
  one is the answer to "what happened with my ticket." `triaged` and
  `in_progress` are process narration (the operator has looked at it / is
  working it) with no decision for the submitter to act on or be relieved
  by; emailing on every internal hop would train recipients to skim past
  ticket emails by the time a genuinely terminal one arrives, which is a
  worse outcome than sending fewer, more meaningful emails. If a future
  need for progress visibility emerges, that is a `docs/TODO.md` follow-up
  with its own product case, not a default this pipeline should assume.
- **Submitter email lookups always resolve for the events built here, and
  why the nullable type is still honest**: every email/name a `notify*`
  call needs is either already in hand from the acting session
  (`session.user.email`/`.name` — filing, replying, operator actions) or
  comes from a `people JOIN users` read inside the SAME transaction as the
  mutation it reports on (promotion's original feedback submitter; the
  admin-side status/reply actions' ticket submitter). Every person reaching
  these flows authenticated to do so, so `people.user_id` is always set in
  practice — but the TS types (`PromoteFeedbackResult.submitterEmail:
  string | null`, and the admin-side joins) stay nullable and the `notify*`
  calls stay defensive (skip + `console.warn`, never throw) rather than
  asserting non-null on a fact that is true today by construction but not
  enforced by any constraint — the same caution `admin/feedback/actions.ts`
  already takes for its own "no admins found" case.

## Implementer

Split across three named implementers per the Implementation Order above:
**database-admin** (schema/migration/seed), **api-developer** (query-layer
module, actions, route handlers, permission/audit catalog edits),
**ux-developer** (pages, components, nav wiring, browser verification).

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
