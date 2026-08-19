# P1 — Tenant Permission Catalog + Org Portal Shell — Work Log

> **Slug:** `2026-08-19-tenant-permissions-portal`
> **Surface:** `(org)` — org-scoped tree, auth-only, membership-gated
> **Permission(s):** new tenant permission catalog — first church-facing keys, TBD by Phase 1/3
> **Flag(s):** TBD by Phase 1
> **Estimated complexity:** large — foundational; unblocks P8/P9 and slice d of P0.5
> **Pipeline mode:** Full, run with agents

---

## Context carried forward from `docs/work-log/2026-08-18-backbone-and-org-sites.md`

That work-log's Phase 1 decomposed the whole numbered program and its Phase 2
explicitly refused to advance P1's shape ("P1–P7 each need their own work-log
and their own Phase 1. Do not carry this section forward as though it covered
them.") — this file is that Phase 1. What follows is prior-art input, not a
substitute for a real Phase 1.

**P1's original one-line scope** (that work-log's decomposition table): *"First
church-facing permission keys, `withOrgContext` wiring, org-scoped layout and
switcher, per-org 2FA gate (G3)."*

**Already shipped since that decomposition, so out of P1's remaining scope:**
- The org switcher UI and the avatar/identity menu — shipped
  `docs/work-log/2026-08-19-avatar-and-org-switcher.md`.
- The `(org)` route group, its layout, the four-way miss response
  (DECISION-040), the Edge 2FA gate extended to `/o/*` — shipped in P0.
- The design foundation (token contract, primitives, dark mode) and, as of
  today, per-organization brand emission on `(org)` pages — shipped, P0.5.

**Carried forward, explicitly named as P1's job by the prior pipeline, not yet
built:**
- The tenant permission catalog itself — no church-facing permission key
  exists anywhere in the codebase today; `src/lib/permissions.ts` is FROZEN
  and platform-shell-only.
- Real content inside `/o/<slug>` — today it is a landing stub only
  (`OrgPortalStub`: name, type badge, one line).
- Per-org 2FA claim refinement (G3): `twoFactorRequired` is a single session
  boolean today; a user with two orgs may be required at one and not the
  other, additive per the prior ruling (`twoFactorRequiredOrgIds`).
- `org_access_requests` / a "Request access" button on `/no-organization`'s
  second door — needs the permission catalog to answer "who at this
  congregation receives this request." Adversarial note already on record:
  a Request Access button behind a public org list is a mass-notification
  vector against every congregation — the prior Phase 1 flagged this for P1's
  own Phase 1 to re-examine, not to inherit as settled.
- `/home`'s "Your roles / Your features" platform-shell debug sections —
  named for removal or relocation to `/account`, explicitly P1's call.
- `site.edit` — a permission key referenced conditionally by the prior P0
  Phase 1/2 discussion (the `invited`-org "In setup, enterable" refinement)
  but never created; P0 deliberately did not acquire a dependency on it.

**What depends on P1 and is out of scope for P1 itself:**
- Slice d of P0.5 (the church-facing brand editor) — blocked on this
  pipeline's permission catalog specifically.
- P8 (staff/employment/terms of call) — depends on P1, does not block it.
- P9 (tenant administration surface — "what does a stated clerk do on a
  Tuesday") — depends on P1, consumes P0.5's shared chrome, has its own
  Phase 1.
- P3 (public site + renderer) — independently blocked on slices 0/a/b/c of
  P0.5 (now shipped) per the corrected blocking statement; not blocked on P1.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES — 8 gaps, G-A is load-bearing | 2026-08-19 |
| 2 — Architectural review | architect | Complete | Approved with suggestions — DECISION-060/061/062 | 2026-08-19 |
| 3 — Technical design | tech-lead | Complete | Design complete — 3 commits, implementers named; DECISION-063/064/065 | 2026-08-19 |
| 4 — Implementation | TBD by tech-lead | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> The resolver machinery (`presby_effective_permissions()`, four arms,
> `withOrgContext()`, `effectivePermissions()`) is already fully built and
> sitting unwired — P1's real job is naming the first handful of keys and
> proving one of them end-to-end, but the catalog is unusable at real-
> congregation scale until something answers "how does an ordinary member get
> `directory.view` without a person hand-writing a `role_grants` row for every
> soul on the roll," and neither the carried-forward scope nor the schema
> currently answers that.

## Scope correction from the carried-forward notes

Several items the prior pipeline named as "P1's job" turn out, on inspection of
what's actually shipped and what actually exists in the schema, to need
re-scoping:

- **The org switcher and `(org)` route shell are already built** (confirmed —
  out of P1's remaining scope, as the work-log's own carried-forward section
  already noted).
- **Per-org 2FA claim refinement (G3) is re-deferred.** The architect's own
  original deferral rationale — "per-org refinement can only ever make the
  system less strict, so that is the safe direction to defer in" and "the gate
  must move once the portal reaches tier-2/tier-3 data" — does not trigger yet,
  because P1's actual feature scope (below) never reaches tier-2/3. Re-deferring
  explicitly rather than building `twoFactorRequiredOrgIds` for a UX papercut
  with nothing behind it.
- **`org_access_requests` is descoped, per operator ruling 2026-08-19.** Not
  building a dedicated table/notification mechanism — there is no tenant-admin
  role yet to notify (P9 owns that), and notifying "everyone with any grant" is
  worse than notifying nobody. `/no-organization`'s second door routes through
  the existing support-ticket loop instead, revisited once P9 creates a real
  recipient.
- **The recommended minimum feature scope for this pipeline is `directory.view`
  only** — one real, tier-1, read-only permission key backing a real directory
  feature in `/o/<slug>`. `roll.propose`/`roll.approve`, `ledger.approve`,
  `pastoral.notes.view` stay fixture-only (no backing table/module exists for
  any of them) rather than being seeded as real — seeding a permission with
  nothing enforcing it is "the built-and-unwired trap this codebase already
  burned itself on once" (per `src/lib/db/domain/authz.ts:31-34`'s own standing
  note about the platform `ADMIN_ROLE` wildcard).

## The load-bearing gap: G-A, baseline grant provisioning

`role_grants` requires an explicit `person_id`/`group_id` row per grantee.
There is no "active membership implies X" resolver arm, and the only precedent
for an automatically-materialized group is Session/Diaconate — both
officer-scoped, not all-member-scoped. Without a mechanism here, "the
permission catalog exists" ships as real only for however many people someone
hand-inserts `role_grants` rows for, which is the current seed-fixture shape,
not a usable congregation. **This is the pipeline's central architectural
question and goes to Phase 2 as such** — likely resolution: a new derived
group (`groups.derived_from = 'active_membership'`, parallel to
`session`/`diaconate`, materialized by trigger from `memberships`) that
`directory.view` binds to at org provisioning.

## Other findings carried to Phase 2 in full

- **G-B** — who provisions the first grant for a brand-new congregation (P1's
  mechanism, or P2's onboarding trigger) is ambiguous and must be named
  explicitly so P2 doesn't discover the requirement independently.
- **G-D** — `/home`'s "Your roles / Your features" debug section: remove, don't
  relocate. `/developer` already covers platform-admin introspection.
- **G-F/G-G/G-H** — three distinct empty states (zero grants / zero visible
  members / DB failure) need honest, separate copy, not one blank list; a
  fail-closed wrapper for `hasPermission()`'s DB-blip case; 360px verification
  on the one new directory UI surface.
- **Adversarial**: the permission gate must live in server-side data-fetching
  code, never a conditional `<Link>`; `hasPermission()` false-for-no-grant and
  false-for-feature-not-enabled must be indistinguishable to the caller
  (enumeration); `is_platform_admin` must never substitute for `hasPermission()`
  anywhere in this pipeline's code, named explicitly rather than trusted to the
  `NOBYPASSRLS` connection alone; the wildcard-role-template temptation is
  flagged pre-emptively, before any tenant admin role template exists, citing
  the platform layer's own standing `ADMIN_ROLE` wildcard as the precedent not
  to repeat one layer down; `role_grants` has no cascade-on-membership-end (a
  departed member can silently retain a grant forever) — a real, standing gap,
  named for Phase 3, not new to P1.

## Handoff

**Next: architect (Phase 2).** Carry forward in full, especially G-A (likely a
schema addition, squarely the architect's call) and the wildcard-role-template
adversarial note. `org_access_requests` is settled (descoped, operator ruling
above) — do not re-litigate.

*Recorded by the orchestrator from the read-only analyst agent's report.*

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.** Nothing returns to Phase 1. Three decisions
minted (DECISION-060/061/062).

## G-A resolved: a derived group, not a resolver arm

**Ruling: build `groups.derived_from = 'active_membership'`, trigger-synced
from `memberships`, parallel to Session/Diaconate.** Routes entirely through
the resolver's existing arm 2 — `presby_effective_permissions()` does not
change. The rejected alternative (a fifth resolver arm reading `memberships`
directly) either reinvents the derived group with bespoke plumbing or bypasses
`role_grants`' uniform provenance model, and is the wildcard-shaped shortcut
Phase 1's adversarial pass pre-emptively warned against, one layer below the
role catalog instead of at it.

**Concrete schema shape**: a new nullable, unique `membership_id` column on
`group_memberships` (analogous to `officer_term_id`, but — unlike it — given a
real composite FK `(membership_id, organization_id) → memberships(id,
organization_id)`); a new trigger `presby_sync_derived_membership_group()`
firing after insert/update on `memberships`; a new hand-written migration
(`drizzle/0017`). `presby_reject_derived_group_write()` needs no change — it
already guards on `membership_source = 'derived'` regardless of which
`derived_from` kind.

**Bonus finding**: `group_memberships.officer_term_id` has no FK at all today
— exactly the gap Composite Tenant Keys exists to prevent (F2). Not P1's to
fix, flagged for a future database-admin review.

**G-B, answered**: no application code anywhere creates an organization today,
so "who provisions the group at real org creation" has the same non-answer as
the pre-existing Session/Diaconate question. P1's actual deliverable is the
migration plus extending `scripts/seed-dev.sql`'s two fixture orgs with the
third derived group and a `role_grants` row — proving arm 2 end-to-end, with
the requirement for real org provisioning written down (DECISION-060) so a
future onboarding pipeline inherits a checklist.

## Directory feature placement

`src/app/(org)/o/[slug]/directory/page.tsx` — Server Component, repeats the
established per-page auth pattern rather than trusting the layout. Query
logic in a new `src/lib/directory.ts` (not `db/domain/`, which is schema
only) — one function, permission check and privacy-filtered query inside a
single `withOrgContext()` call, not two round trips. **Privacy filtering is
SQL-level, not post-fetch**: hidden rows excluded in `WHERE`, hidden fields
nulled via `CASE WHEN` in the `SELECT` list — a hidden value must never be
materialized as a JS value a later refactor could leak. Permission-denied
state renders inline inside the branded shell (the person is a member; only
DECISION-040's states strip the org's colours). `org_portal.directory`
checked bare, first, no DECISION-026 wrapper — it's a toggle, not
auth-critical. No `AUDIT_ACTIONS` entry — a read is not a mutation.

Two product calls handed to Phase 3 explicitly, not resolved here: whether
`directory.view`'s baseline is "any active membership" or "on the roll," and
how a missing `person_privacy` row should be treated (safe-default vs.
defensive-hide).

## Carried-forward items ruled on

1. **`TENANT_ROLE_GRANTED`/`REVOKED` — deferred, not seeded.** P1 writes no
   person-targeted grant mutation; adding audit keys with nothing writing
   them repeats the built-and-unwired trap one layer down. DECISION-062.
2. **The `role_grants` arm-1 cascade gap — confirmed real, confirmed out of
   scope, confirmed not worsened.** The derived-group mechanism is immune to
   it by construction (arm 2 already syncs to `memberships.ended_on`).
   DECISION-062.
3. **`org_portal.directory` — confirmed the right mechanism.** Answers "is
   this on at all" (flag); `directory.view` answers "may this person see it"
   (permission). Neither substitutes for the other.

## Handoff

**Next: tech-lead (Phase 3).** The G-A schema shape and directory placement
are settled — don't re-litigate the resolver-arm alternative. Phase 3 owns:
the two product calls named above, the three empty-state copy blocks (zero
grants / zero visible members / DB failure), and the exact in-shell
permission-denied wording.

*Recorded by the orchestrator from the read-only architect agent's report.*

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Three commits. `drizzle/0017_presby_membership_roster.sql` adds
`group_memberships.membership_id` (with the composite FK `officer_term_id`
lacks), the `directory.view` permission row, and a sync trigger mirroring the
officer-roster trigger's exact shape — same fail-loudly-if-the-group-is-missing
behavior, same upsert-keyed-on-the-derived-column pattern.
`src/lib/directory.ts` is the one query function, permission check and
privacy-filtered read inside a single `withOrgContext()` transaction, hidden
rows excluded in `WHERE`, hidden fields nulled via `CASE WHEN` — never
fetch-then-filter. `src/app/(org)/o/[slug]/directory/page.tsx` is the page,
with four distinct states (flag-off, zero-grants, zero-visible-members,
load-error) plus a discoverability link from the portal stub, and `/home`'s
"Your roles / Your features" debug sections are deleted outright.

**The two product calls Phase 2 handed forward are resolved as two different
questions, not one** (DECISION-065): who gets the baseline `directory.view`
grant is "any current membership" (matching the codebase's one existing
definition of "current"); who appears as a row in the directory stays the
narrower, already-documented `schema-design.md` §11 formula. A missing
`person_privacy` row defaults to the columns' own declared defaults, not to
defensive full exclusion, because nothing creates that row yet and the
alternative ships an empty directory everywhere on day one (DECISION-064).

**A real finding changed the seed scope**: the sync trigger's fail-loudly
behavior (correctly mirroring F16) means the derived group must exist at
**all six** fixture organizations wherever a membership can be inserted, not
just the two Phase 2 anticipated — only the actual permission *binding*
stays scoped to Alder Creek, proving the feature once (DECISION-063).

**Two existing `scripts/test-rls.sql` assertions will break, predictably**:
both currently assert `count(*) = 0` for a resolver query during a term/
commission gap, for two fixture people who happen to hold long-standing,
always-active Alder Creek memberships — once the baseline grant exists, the
correct count becomes 1, not 0. Exact `file:line` and fixes specified so this
isn't discovered as a surprise regression at Phase 5.

## Permissions & Flags

`directory.view` (already a fixture-only row; this migration makes it real
everywhere) binds through a new constitutional role, `member`, granted to the
`active_membership` derived group — seeded only at Alder Creek. New flag
`org_portal.directory`, default off, checked bare with no fail-open wrapper
(a toggle, not an auth path). No `FEATURES`/`FEATURE_CATALOG` entry
(platform-shell only, stays FROZEN). No `AUDIT_ACTIONS` entry — a read is not
a mutation, confirmed against `check:audit`'s actual scan scope
(`src/app/**/actions.ts` only).

## Data model

`drizzle/0017_presby_membership_roster.sql`: `group_memberships.membership_id`
(unique, with a real composite FK to `memberships(id, organization_id)` —
unlike `officer_term_id`'s pre-existing gap); the `directory.view` permission
row; `presby_sync_derived_membership_group()`, mirroring the officer-roster
trigger's shape exactly, using `ended_on is null` as the sole "is this
current" predicate (no new definition invented, per DECISION-065). Fires
after insert/update on `memberships`; raises if the org has no
`active_membership` group yet — the same loud-failure discipline F16 already
established, deliberately not softened.

`scripts/seed-dev.sql`: the derived group seeded at all six fixture orgs
(DECISION-063); the `member` role, its permission binding, and the actual
`role_grants` row scoped to Alder Creek alone.

## Component / page plan

`src/lib/directory.ts` — `getDirectory(personId, organizationId):
Promise<DirectoryResult>`, one `withOrgContext()` transaction covering the
`presby_has_permission()` check and the query. Query excludes
`directory_hidden` rows in `WHERE`; nulls the five field-level flags via
`CASE WHEN` in the `SELECT` list. Throws on genuine DB failure rather than
returning a variant, so the page can tell "denied" apart from "broken."

`src/app/(org)/o/[slug]/directory/page.tsx` + co-located
`directory-states.tsx` — four distinct states, each with its own copy,
deliberately not collapsed into one generic "nothing here" message: flag off
("isn't available yet"), zero grants ("you don't have permission... ask an
administrator" — worded to not read as "your whole portal access was
revoked"), zero visible members ("no one is listed yet"), load error ("try
again in a moment"). `OrgPortalStub` gets one new conditional link, shown
only when the flag is on, gating on nothing else — the destination page is
the sole authority on the viewer's own permission, per Phase 1's "the gate
lives in server-side data-fetching, never a conditional `<Link>`" rule.

`GlobalNav` stays untouched — it's identity + org-switcher chrome by explicit
prior design, not a tenant-content nav; a real tenant nav is P9's job once
there's more than one page to link.

`/home`: the "Your roles" and "Your features" sections deleted outright
(not relocated — `/developer` already covers platform-admin introspection),
along with the now-dead `roles` variable. `featuresList` is kept — it still
drives the unrelated "Admin dashboard" quick-link.

## Implementation order

Three sequenced commits, each with its own tests: **database-admin**
(migration + trigger + the two `test-rls.sql` fixes) → **api-developer**
(seed extension + `directory.ts` + its tests) → **ux-developer** (the page,
states, stub link, `/home` cleanup). Not one full-stack commit — the schema/
trigger risk and the query-privacy risk each warrant a named owner and tests
before the UI builds on top of them.

## Acceptance criteria

Every fixture member at Alder Creek with a live membership resolves
`directory.view` via the real resolver, not a mock; hidden fields are absent
from both the rendered HTML and the RSC payload, not merely hidden by CSS;
`scripts/test-rls.sql` passes end to end as `presby_app` including the two
updated assertions; all four states verified at 360px in a real browser.

## Handoff

**Next: database-admin (Phase 4, commit 1).** The migration, trigger, and
`test-rls.sql` fix are specified exactly enough to start without further
design decisions. Commit 2 (seed extension) depends on commit 1's migration
being applied — the new `groups` rows need the new `group_type` and the
trigger to exist before any membership re-insert.

*Recorded by the orchestrator from the tech-lead agent's report.*
