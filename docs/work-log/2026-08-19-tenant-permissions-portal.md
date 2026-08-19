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
| 2 — Architectural review | architect | Pending | — | — |
| 3 — Technical design | tech-lead | Pending | — | — |
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
