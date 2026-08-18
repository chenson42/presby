# Phase 0/1 Domain Schema and Developer Page — Work Log

> **Slug:** `2026-08-17-phase-0-1-schema`
> **Surface:** mixed — schema plus `(admin)/developer`
> **Permission(s):** `system.developer` planned; gated on `users.is_platform_admin` until the presby role model replaces the starter's
> **Flag(s):** not needed
> **Estimated complexity:** large
> **Pipeline mode:** Accelerated — this is foundational schema work driven by a design document (`docs/schema-design.md`) that already carries the analyst and architect reasoning inline. Phases 1-3 are recorded there rather than duplicated here.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | design doc §1-2 | Complete | READY WITH NOTES | 2026-08-17 |
| 2 — Architectural review | design doc §3 | Complete | Approved | 2026-08-17 |
| 3 — Technical design | design doc §4-16 | Complete | Complete | 2026-08-17 |
| 4 — Implementation | full-stack | Complete | — | 2026-08-17 |
| 5 — Verification | qa | **Partial** | See gaps | 2026-08-17 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

## What shipped

**33 tables** implementing `docs/schema-design.md` sections A-J, in
`src/lib/db/domain/`:

| Module | Tables |
|---|---|
| A. Organizations | `organizations`, `organization_settings`, `org_units` |
| B. People | `people`, `households`, `addresses`, `contact_methods`, `person_relationships`, `person_links` |
| C. Person extensions | `tags`, `person_tags`, `person_milestones`, `person_notes`, `follow_ups`, `talent_types`, `person_talents`, `background_checks`, `person_medical` |
| D. Rolls | `roll_actions`, `transfer_certificates` |
| E. Officers | `ordinations`, `officer_terms` |
| F. Groups | `group_types`, `groups`, `group_memberships` |
| G. Authorization | `permissions`, `app_roles`, `app_role_permissions`, `role_grants`, `administrative_commissions`, `org_delegations` |
| H. Privacy | `person_privacy`, `consents`, `person_demographics`, `person_disabilities` |
| J. Reporting | `sasr_reports` |

**Migrations:** `0008_presby_domain.sql` (generated), `0009_presby_rls.sql`
(hand-written — Drizzle Kit does not emit policies, roles, or triggers).

**Developer page:** `/developer` and `/developer/schema.json`, both generated
from the Drizzle schema at request time via `src/lib/dev-docs.ts`. Structure
only, never data.

## Review findings applied

Twenty findings across two review rounds are logged in `docs/schema-design.md`
§17-18. The five that would have shipped defects:

- **F1** `force row level security` was missing. Postgres exempts the table
  owner from every policy, so with a shared role RLS would have been inert and
  every isolation test would still have passed.
- **F2** No composite foreign keys, letting a row in org B reference a person in
  org A. RLS filters reads, not bad writes.
- **F3** Derived group rosters as a view would have been invisible to the
  permission resolver, so a role granted to the Session group resolved to nobody.
- **F9** Two-sided transfers were impossible; neither congregation can write
  into the other. Now a claimable certificate.
- **F19** Death terminated nothing — a deceased elder kept session membership
  and every permission indefinitely.

## Decision reversed mid-implementation

**D8, custom fields.** Designed, implemented, then removed at the user's
direction. A per-church field nobody designed has no validation, no reporting,
and no enforced sensitivity tier, and it fragments the schema that the
reusable-component thesis depends on. Tags remain as the only tenant-extensible
attribute; everything else routes through a support ticket and, if the need is
real, becomes a first-class feature for every church.

This dissolved F17 (unenforced custom-field sensitivity tier) as a side effect.

**Consequence for phasing:** the ticket loop is now the *sole* extensibility
path, so it cannot remain last in the plan. Low-stakes requests that custom
fields would have absorbed now land in the queue.

---

# Phase 5 — Verification (qa)

## Passing

- `npx tsc --noEmit` — clean
- `npx eslint --max-warnings=0` — clean
- `npx next build` — passes; `/developer` and `/developer/schema.json` present
- `drizzle-kit generate` — schema compiles to SQL, 33 tables

## Gaps — not yet verified

**No migration has been applied to any database.** `0009_presby_rls.sql` is
entirely unexercised: the roles, policies, grants, and four triggers have never
run. Everything below depends on that.

1. **RLS isolation tests do not exist.** The whole point of F1 is that a broken
   policy still passes a naive test. Tests must connect as `presby_app`, not as
   the owner, and must assert that an unset GUC returns zero rows.
2. **Trigger behaviour unverified** — roll-action freeze, derived-group write
   rejection, officer-term projection, and term-end propagation (F19).
3. **`people.current_roll` trigger is not written.** The column exists and the
   design specifies it, but nothing maintains it yet.
4. **`rollAsOf()` and `effectivePermissions()` are not written.** These are the
   projection-pass queries; F6 and F11 were found by reasoning about them, not
   by running them.
5. **`ltree` on `organizations.path`** is declared as `text`; the migration to
   `ltree` plus the ancestry trigger is not written.
6. **Seeding derived groups at org creation** (F16) has no implementation —
   the trigger will raise until it exists.
7. **Starter reconciliation.** `roles`/`user_roles`/`features` still coexist
   with `app_roles`/`role_grants`/`permissions`. Two authorization systems is
   exactly the mess that becomes permanent; this needs closing before Phase 1
   ships.
8. **`ADMIN_ROLE` is still a wildcard** in `src/lib/permissions.ts`, violating
   invariant 6.

## Open findings carried forward

- **F13** photos: resolved to object storage (`people.photo_key`), no storage
  adapter written yet.
- **F15** `org_units.shepherd_person_id` dropped to break a circular composite
  FK; shepherd should derive from a group.
- **F20** household-grouped transfers: `issuing_household_id` added, claim flow
  not written.

---

# Phase 6 — Shipped vs Intent

Pending. Blocked on **D1** — org-scoped `people` plus `person_links` versus a
global `people` table. Every table above inherits that choice, and it is the
most expensive reversal in the design.
