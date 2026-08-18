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

**37 tables** implementing `docs/schema-design.md` sections A-J, in
`src/lib/db/domain/` (column counts in parentheses; 26 are tenant-scoped):

| Module | Tables |
|---|---|
| A. Organizations | `organizations` (9), `organization_settings` (4), `org_units` (5) |
| B. People | `people` (24), `person_identifiers` (9), `memberships` (18), `households` (9), `addresses` (14), `contact_methods` (8), `person_relationships` (7) |
| C. Person extensions | `tags` (5), `person_tags` (4), `person_milestones` (12), `person_notes` (9), `follow_ups` (10), `talent_types` (4), `person_talents` (5), `background_checks` (10), `person_medical` (7) |
| D. Rolls | `roll_actions` (15), `transfer_certificates` (13) |
| E. Officers | `ordinations` (10), `officer_terms` (13) |
| F. Groups | `group_types` (4), `groups` (10), `group_memberships` (9) |
| G. Authorization | `permissions` (4), `app_roles` (8), `app_role_permissions` (2), `role_grants` (10), `administrative_commissions` (9), `org_delegations` (8) |
| H. Privacy | `person_privacy` (10), `consents` (11), `person_demographics` (6), `person_disabilities` (4) |
| J. Reporting | `sasr_reports` (12) |

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
- **F21** The `people` visibility policy self-granted: any church could insert a
  membership for an arbitrary `person_id` and read that person's identity,
  address, and phone. Now guarded on the act of linking.
- **F22** The derived-group trigger destroyed officer history — a second,
  non-consecutive session term rewrote the first term's end date.

## Decisions reversed mid-implementation

**D1, person scope.** Org-scoped `people` + `person_links` → **global `people` +
org-scoped `memberships`**, then a second pass moving the person's own data
(addresses, contact methods, relationships) to direct `person_id` links with no
`organization_id` at all. Decided on polity: ministers of Word and Sacrament are
members of the presbytery (G-2.0502) while ruling elders are members of the
congregation, so one human's roll and service routinely sit at different orgs.

F2's guarantee survived — composite keys now target
`memberships (person_id, organization_id)` — but only for rows *about* a person.
`person_links` is deleted. Two constraints became expressible only because
`people` went global: one active-roll membership per person, and globally unique
verified identifiers.

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

## Recorded, not built

**D9 — partial adoption.** A presbytery will join with most of its congregations *not* on the
platform, so its launch-day job is managing data about non-tenants. `organizations.platform_status`
(`managed` / `unmanaged` / `invited`) is the only part implemented. Deferred: the stewardship model
and its lapse-on-adoption rule, presbytery-side entry for unmanaged orgs, and the tokenized request
flow. Full note in `docs/schema-design.md` §17.

Two things to carry forward from it:
- **The request flow is the adoption funnel**, not a throwaway form. Worth building well.
- **Null is not zero.** An unmanaged org has no roll, so report generation must render "not derived"
  rather than 0, or a presbytery-entered SASR becomes a fabricated decline in GA statistics.
- It raises a live sequencing question: Phase 2 may need to partly precede Phase 1. Not decided.

## Open findings carried forward

- **F13** photos: resolved to object storage (`people.photo_key`), no storage
  adapter written yet.
- **F15** `org_units.shepherd_person_id` dropped to break a circular composite
  FK; shepherd should derive from a group.
- **F20** household-grouped transfers: `issuing_household_id` added, claim flow
  not written.

---

# Phase 6 — Shipped vs Intent

Pending. **D1 is resolved** (global `people`), so the structural blocker is gone.
Sign-off now waits on Phase 5's real gap: nothing has run against a database, so
every policy, trigger, and projection added since is unexercised.
