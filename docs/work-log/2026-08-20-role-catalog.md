# Role Catalog Expansion — Work Log

> **Slug:** `2026-08-20-role-catalog`
> **Surface:** mixed — tenant role seeding (`scripts/seed-dev.sql`, no new UI expected), platform role seeding (`scripts/seed.ts`)
> **Permission(s):** none new expected — this pipeline is about which EXISTING permissions get a role to carry them, not new permission keys
> **Flag(s):** not needed
> **Estimated complexity:** medium — no new schema/mechanism, but real polity/product judgment across several roles
> **Pipeline mode:** Full, run with agents

---

## Context carried forward

**Why this pipeline exists.** While designing the support-ticket pipeline
(`docs/work-log/2026-08-20-support-tickets.md`), `tickets.file` was
piggybacked onto the existing `stated_clerk` role (DECISION-072) purely
for expediency — it's the only designated tenant office that exists in the
fixture. The user flagged the resulting pattern directly: every new tenant
capability landing on `stated_clerk` risks it becoming a wildcard admin
role one layer down, even though each individual grant was independently
justified. Asked to think about what other roles are actually needed, at
both the platform and organization level, before continuing to default
everything onto one office.

**Two concrete gaps, confirmed by reading the fixture directly, not
inferred**: `docs/db/domain/authz.ts`'s permission catalog has carried
`ledger.approve` (module `ledger`, tier 2) and `pastoral.notes.view`
(module `pastoral`, tier 3) since P1 (`scripts/seed-dev.sql` lines
226-227) — **nobody, at any fixture organization, holds either
permission.** No role is bound to them; no `role_grants` row grants them.
A congregation today has no one who can approve a disbursement or read a
pastoral note, in the fixture that's supposed to exercise the schema.

**Immediate, priority sub-question — unblocks tickets Phase 4**: the user
also decided `tickets.file` should move off `stated_clerk` onto its own
role, rather than staying piggybacked. This pipeline's Phase 1 should
resolve that specific question first (what the new role is called, what
it holds, how it's granted) so the tickets pipeline can proceed without
inventing a role in isolation that this pipeline might then reach a
different answer for. **A load-bearing fact for that sub-question**: the
self-lockout guard `revokeRole()` enforces (`src/lib/role-grants.ts`) is
hardcoded to `role_grants.manage` specifically — `ROLE_GRANTS_MANAGE` is
the one permission key it checks for before blocking a revoke. `tickets.
file` was never subject to that risk; splitting it off `stated_clerk`
does not need new self-lockout machinery, because a `role_grants.manage`
holder (`stated_clerk` or whoever holds it) can always re-grant `tickets.
file` to someone through the already-shipped `/o/<slug>/admin/roles` UI.
This significantly simplifies that half of the question — don't let
Phase 1 or Phase 2 invent lockout protection this permission never
needed.

**What already exists, to build on, not duplicate:**
- `src/lib/role-grants.ts` + `/o/<slug>/admin/roles` (P9) — the entire
  grant/revoke/view mechanism is generic over any `app_roles` row; a new
  tenant role needs zero new application code, only a new `app_roles` row,
  its `app_role_permissions` bindings, and a fixture `role_grants` row.
- The platform side's `roles`/`userRoles`/`roleFeatures` tables
  (`src/lib/db/schema.ts`) already bundle `FEATURES.*` keys into named
  roles, assignable at `/admin/users` — a "Support Operator" bundle is
  seed data, not new mechanism, same as the tenant side.
- DECISION-066 (`stated_clerk`'s own minting) is the direct precedent for
  how a new constitutional role gets justified against PC(USA) polity
  (G-3.0104) rather than invented from nothing — any new tenant role this
  pipeline proposes should hold itself to the same bar: a real office,
  not a software convenience with a churchy-sounding name.

**Explicitly not a request to change the tickets pipeline's shape** — its
Phase 1/2/3 (three phases, six decisions) stand. Only the role binding
`tickets.file` attaches to changes, via a correction appended to
DECISION-072 once this pipeline's relevant piece resolves — decisions are
append-only, never edited in place.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-20 |
| 2 — Architectural review | architect | Complete | Approved with suggestions — DECISION-078/079 | 2026-08-20 |
| 3 — Technical design | tech-lead | Complete | Design complete — DECISION-080 | 2026-08-20 |
| 4 — Implementation | database-admin | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> Three of the six permissions in the catalog have zero holders anywhere
> in the fixture — this fixes `ledger.approve` and `pastoral.notes.view`
> with real PC(USA) offices already anticipated in the schema (Treasurer,
> the installed pastor), gives `tickets.file` its own honestly-non-
> constitutional role instead of a third grant piled onto `stated_clerk`,
> and confirms the platform Support Operator bundle needs nothing beyond
> `FEATURES.ADMIN_TICKETS` — while surfacing a fourth zero-holder
> permission (`roll.propose`) nobody had named yet.

## RESOLUTION — unblocks support-tickets Phase 4

**`tickets.file` binds to a new, deliberately non-polity-branded, custom
role — not a new constitutional office, not a repurposed `property_chair`.**
There is no PC(USA) office for "point of contact with outside software
support" — inventing one would repeat the exact "churchy name for a
software convenience" DECISION-066's own bar exists to rule out.
`property_chair`'s *shape* is the right template though: `role_kind:
'custom'`, `is_protected: false`, direct-granted to one named person, no
group binding — already a proven pattern in the fixture, not a new one.

Recommended for Phase 3 to ratify: a new `app_roles` row at Alder Creek
(name candidate "Support Contact," Phase 3's call), `role_kind: 'custom'`,
`is_protected: false`, holding exactly `tickets.file`. Granted to
**Marguerite Ashcombe** (`c0000000-...001`), deliberately *not* Tobias
Renwick — he already holds `property_chair` and `stated_clerk`; a third
grant to the same person would visually recreate the "one person, every
capability" pattern this pipeline exists to interrupt, even though each
individual grant is independently justified.

**Self-lockout: confirmed unneeded, and the cost of splitting off
`stated_clerk` named explicitly.** `revokeRole()`'s guard checks one
hardcoded permission key (`role_grants.manage`) — a role holding only
`tickets.file` never triggers it, confirmed by reading the source. But
DECISION-072 named piggybacking on `stated_clerk` as buying an *emergent*
protection (a congregation could never organically reach zero `tickets.
file` holders, because it could never reach zero `role_grants.manage`
holders) — splitting the role off deliberately gives that up.
`property_chair` already lives with the identical exposure today and
nobody's treated it as blocking, so this is acceptable, but it needs a
correction appended to DECISION-072 (append-only) and a `docs/TODO.md`
line, not a silent trade.

## User Verbs

This pipeline ships no new UI and no new user-visible verb — `/o/<slug>/
admin/roles` and `/admin/users` already grant/revoke any role generically.
What changes is which roles a congregation admin can select, not a new
screen.

| Surface | Verb | Cadence |
|---|---|---|
| Existing `role_grants.manage` holder at `/o/<slug>/admin/roles` | Grant the new Treasurer / pastoral / Support Contact role to a named person | rare, one-time per office change |
| Platform admin at `/admin/users` | Assign the new platform "Support Operator" role bundle | rare |

**Named explicitly because it's easy to miss**: `ledger.approve` and
`pastoral.notes.view` gate nothing live in the running app today — no
route or action anywhere checks either permission. Seeding a holder makes
the fixture polity-honest and unblocks a future feature's own Phase 1; it
produces no new user-observable behavior by itself.

## Flows

**Flow 1 — Grant a new role, via the existing UI, unchanged:**
`grantRole()`'s existing DECISION-068 subset check applies as-is — a
`stated_clerk` holder (only `role_grants.manage`) cannot grant the
Treasurer role unless they also separately hold `ledger.approve`. Correct,
already enforced — means Phase 4's fixture rows go in via the seed script
directly, the same way `stated_clerk`'s own grant was seeded rather than
clicked through the UI.

**Flow 2 — Revoke the sole `tickets.file` holder — no failure path, by
design, and that is the finding.** `revokeRole()` finds the role doesn't
carry `role_grants.manage`, skips the holder-count check, succeeds
unconditionally. Revoking the sole holder silently leaves the org with
nobody who can file a ticket — no warning UI exists, no DB guard applies.
This is DECISION-072's named consequence, newly *live* the moment this
pipeline ships, not a new mechanism.

## Permissions & Flags

- **No new `permissions.key` or `FEATURES.*` values** — all four
  permissions this pipeline binds already exist in the catalog.
- **New fixture-only `app_roles` rows** (`scripts/seed-dev.sql`, per
  DECISION-063's standing non-answer — no code provisions a real org
  yet): Treasurer (constitutional, protected, `ledger.approve`); a
  pastoral role, name TBD Phase 3 (constitutional, protected, `pastoral.
  notes.view`); Support Contact (custom, not protected, `tickets.file`).
  All Alder Creek only.
- **All three direct-granted (arm 1)** — confirmed by reading the
  derived-group sync trigger: only `office = 'ruling_elder'`/`'deacon'`
  project into a materialized roster; nothing analogous exists for
  Treasurer/pastor/Support Contact, so direct grant is the only mechanism
  that reaches them today, not a stylistic choice.
- **Flags:** none needed — fixture data only, no new gated surface.

## Gaps the Request Didn't Address

- **`roll.propose` (tier 1) also has zero holders** — confirmed by reading
  the fixture's `app_role_permissions` block directly; only `roll.approve`
  is bound anywhere. The natural proposer is the Clerk of Session —
  `stated_clerk`'s own office — but binding it there reopens the
  concentration concern this pipeline exists to interrupt, this time on
  genuine polity grounds rather than expediency. Flagged for Phase 3 to
  weigh explicitly, not silently resolved either direction.
- **No `officer_terms` row exists for Treasurer or the pastoral role at
  any fixture org.** Nothing FK-requires one (unlike `session_member`'s
  group projection), but omitting it would leave the fixture polity-
  inconsistent — a "Treasurer" with software access and no record of
  holding the office, the opposite of `stated_clerk`'s own precedent
  (which dated its grant to match the `clerk_of_session` term's start
  date). Recommend Phase 4 add both `officer_terms` rows, not skip them.
- **Presbytery/synod pastoral care has no clean answer, and none is
  invented here.** `pastoral.notes.view`/`person_notes` model individual
  member care, a congregation-level concept by its own schema shape; no
  `committee_on_ministry` table or presbytery-level care concept exists
  anywhere in the schema. Recommend deferring explicitly rather than
  forcing a congregation-shaped concept onto a body it doesn't fit.
- **The two new tier-2/3 permissions still gate nothing live** — restated
  from User Verbs because it's the kind of gap easy to read past.
- **`docs/TODO.md` doesn't yet carry the "`tickets.file` loses its
  emergent lockout protection" line** DECISION-072 itself anticipated —
  should land in the commit that splits the role off (Rule 10), as a
  newly-live consequence, not a deferred one.

## Out of Scope (confirmed)

- Redesigning `role_grants`/`app_roles`/the resolver — nothing here needs
  a schema or mechanism change.
- New UI at `/o/<slug>/admin/roles` or `/admin/users` — both already
  handle any role generically.
- Presbytery/synod-specific pastoral-care role variants — no analogous
  schema concept was found to require distinguishing them.
- A `committee_on_ministry`/care-of-ministers concept at the presbytery
  level — real, plausible, genuinely absent from the schema, but a new
  domain concept, not a role-catalog binding. Named, not solved.

## Open Questions (for Phase 3, not the user)

- Exact role `key`/`name` strings for Treasurer and the pastoral role
  (`installed_pastor` vs `pastor` vs `moderator` — the last is
  polity-imprecise per the reasoning above, likely avoid it).
- Whether `roll.propose` gets resolved now (onto `stated_clerk`, accepting
  further concentration) or explicitly deferred with its own TODO line.
- Whether Treasurer should be `organizationTypeScope`-templated now or
  stay Alder-Creek-only per DECISION-063's existing non-answer (recommend
  the latter — no code provisions a real org yet).
- The DECISION-072 correction's exact wording — Phase 6 of *this* pipeline
  should draft it, since it's the pipeline that triggers the consequence.

## Handoff

**Next: architect (Phase 2).** The tickets-blocking resolution above is
the load-bearing output — the sibling tickets pipeline is waiting on it
and can proceed once architect confirms nothing here touches an
invariant. The broader catalog work is schema-free (fixture inserts plus
two new `officer_terms` rows) — architect should confirm this stays
fixture-only per DECISION-063's standing scope. Flag for Phase 3: pick
exact role names, decide `roll.propose`, draft the DECISION-072
correction.

*Recorded by the orchestrator from the read-only analyst agent's report.*

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.** Every Phase 1 claim was checked directly
against source (the schema, the derived-group trigger, the fixture, the
platform seed script) rather than accepted on summary, and held up. One
real gap Phase 1 didn't name (a cross-pipeline FK sequencing dependency)
plus two open calls ruled on directly rather than relayed as options.

## Placement

**No new directories, no schema change, fixture-only** — confirmed for
all four bindings. Treasurer/pastoral role/Support Contact are new rows
in `scripts/seed-dev.sql`'s existing `app_roles`/`app_role_permissions`/
`role_grants` blocks. The platform Support Operator bundle is new rows in
`scripts/seed.ts`, mirroring the existing `bindAdminFeatures()` shape
directly (read, not guessed): loop a feature-key list, insert
`roleFeatures` rows, `onConflictDoNothing()`. A new `SUPPORT_OPERATOR_ROLE`
constant belongs in `src/lib/permissions.ts` next to `ADMIN_ROLE`/
`MEMBER_ROLE`. No server/client split, no dependencies — no UI, no route,
no server action anywhere in this pipeline.

## Invariants Touched

- **No Role Carries a Wildcard** — Support Operator confirmed to stay at
  exactly two `FEATURES.*` keys, not three. Checked the concrete
  precedent directly: `/admin/2fa/page.tsx` joins `organizations` for
  display with no second feature gate, and `organizations` already
  carries a public grant (DECISION-040/049 — the org tree is public) —
  `/admin/tickets`'s planned `organizations` join rides on
  `FEATURES.ADMIN_TICKETS` alone, the same way `/admin/feedback`'s
  `users` join needs no `FEATURES.ADMIN_USERS`.
- **The Court Is Not a Group** — confirmed by reading
  `presby_sync_derived_group()` directly: any `officer_terms.office`
  value outside `'ruling_elder'`/`'deacon'` is a safe no-op, not an error
  or a silent mis-projection. No CHECK constraint on `officer_terms.office`
  exists, and no application code pattern-matches it against a closed
  set — two new office labels (Treasurer, pastoral role) need zero code
  change.
- **Two Hierarchies Intersect Nowhere** — not implicated; all four
  bindings are ordinary in-org direct grants at one congregation.
- **Composite Tenant Keys, Permissions vs Flags** — not applicable / clean;
  no new tables, no flags proposed.

## Notes

1. **A real sequencing dependency, not a Phase 1 error.** `roll.propose`/
   `roll.approve`/`directory.view`/`ledger.approve`/`pastoral.notes.view`
   are all already in the catalog — confirmed. `tickets.file` is
   different in kind: designed (the exact migration SQL is written out in
   the sibling work-log) but **not yet committed** — `drizzle/
   0019_presby_ticket_support.sql` doesn't exist as a file yet at review
   time. `app_role_permissions.permission_key` is a hard FK to
   `permissions.key`; role-catalog's own Phase 4 insert for Support
   Contact will FK-violate on any database where `0019` hasn't actually
   been applied. The dependency is one-directional and needs to be named
   explicitly in Phase 3's Implementation Order: role-catalog's Phase 4
   must run **after support-tickets' Phase 4 database-admin step has
   applied `0019`**, not merely after that pipeline's design is complete.
   Same shape on the platform side — `roleFeatures.featureKey` FKs to
   `features.key`, so the Support Operator bundle's `ADMIN_TICKETS` row
   needs `src/lib/permissions.ts`'s new `FEATURES.ADMIN_TICKETS` entry to
   exist first.
2. **`roll.propose` — ruled, not deferred.** Binds to `stated_clerk` now.
   **DECISION-078**: register-keeping is the Clerk's actual constitutional
   duty (`docs/schema-design.md` §8), completing a clean propose/approve
   separation of duties against `roll.approve`'s existing binding to the
   collective `session_member` group — categorically different from
   `tickets.file`'s original expedient binding. The standing test for
   anything proposed against `stated_clerk` going forward: constitutional
   duty of the office, or just the only empowered role that happens to
   exist in the fixture.
3. **Pastoral role naming — a constraint, not a name.** "Moderator" isn't
   just imprecise, it's the wrong axis: Moderator of Session can be held
   by a presbytery-appointed outsider during a pastoral vacancy, with no
   ongoing pastoral relationship to the congregation. Binding tier-3
   `pastoral.notes.view` (the schema's own "strictest grant in the
   system") to a presiding function rather than the pastoral relationship
   itself would let a non-clergy or externally-appointed holder into it.
   **DECISION-079**: Phase 3's office key must name the relationship
   (installed/temporary-supply pastor), never the meeting-chair function.
4. Phase 1's Gaps/Out-of-Scope sections all hold up under direct
   verification — the presbytery/synod deferral, the missing
   `officer_terms` rows (recommend Phase 4 add both, dated to match
   `stated_clerk`'s own precedent), and the `docs/TODO.md` line for
   `tickets.file`'s lost self-lockout protection (already added — see
   `2026-08-20-support-tickets`'s Phase 3 revision and DECISION-072's
   correction, both already committed as of this review).

*Recorded by the orchestrator from the read-only architect agent's
report.*

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Four permission-catalog gaps close with fixture data alone, no schema and no
application code: `tickets.file` gets its own custom `support_contact` role
(direct-granted to Marguerite Ashcombe, Alder Creek), `ledger.approve` gets a
new constitutional `treasurer` role (granted to Priya Balakrishnan), tier-3
`pastoral.notes.view` gets a new constitutional `installed_pastor` role
(granted to Rowan Thistlewood — literally the fixture's own pastor), and
`roll.propose` binds onto the existing `stated_clerk` role per DECISION-078
(no new role, one new `app_role_permissions` row). Every binding is a row in
`scripts/seed-dev.sql`'s existing Authorization fixture block, following
`stated_clerk`'s own precedent (DECISION-066) exactly: constitutional roles
get a matching `officer_terms` row dated to the grant. A fifth piece, the
platform "Support Operator" bundle (`FEATURES.ADMIN_TICKETS` +
`FEATURES.ADMIN_FEEDBACK`), is `scripts/seed.ts` data plus one new
`SUPPORT_OPERATOR_ROLE` constant. **The whole design is gated on two
one-directional FK dependencies onto the sibling `2026-08-20-support-tickets`
pipeline** (Phase 2 Note 1): the tenant fixture rows need `tickets.file` to
already exist in `permissions` (from `drizzle/0019_presby_ticket_support.sql`,
committed and applied), and the platform bundle needs `FEATURES.ADMIN_TICKETS`
to already exist in `src/lib/permissions.ts`. Both are named as concrete,
checkable preconditions in Implementation Order below, not footnotes.

**Correction to this pipeline's own briefing, found while verifying rather
than assuming**: the briefing named the `FEATURES.ADMIN_TICKETS` dependency as
"the sibling tickets pipeline's own Phase 4 commit 3 (ux-developer) work."
Reading that pipeline's own Phase 3 Implementation Order directly
(`docs/work-log/2026-08-20-support-tickets.md`, step 2) shows
`src/lib/permissions.ts`/`src/lib/audit.ts` edits are listed under **commit 2
(api-developer)**, not commit 3 (ux-developer, pages/components/nav only).
The dependency is real; the commit number naming it was wrong. Corrected here
rather than carried forward silently — the architect's own Phase 2 standard
for this pipeline ("checked directly against source... rather than accepted
on summary") applies with equal force to a claim made about a sibling
pipeline as to one made about this one.

**As of this writing (2026-08-20), neither sibling dependency is satisfied
yet.** `drizzle/0019_presby_ticket_support.sql` exists on disk and
`scripts/seed-dev.sql` already carries its Phase 4 commit 1 sample-ticket
rows, but both are **untracked/uncommitted** (`git status`: `??
drizzle/0019_presby_ticket_support.sql`, `M scripts/seed-dev.sql`), and that
sibling work-log's own Per-Phase Status table still reads Phase 4 "Pending."
`FEATURES.ADMIN_TICKETS` does not exist anywhere in `src/lib/permissions.ts`
today (grepped directly). This pipeline's database-admin work cannot begin
for real until those land — see Implementation Order and Edge Cases.

## Permissions & Flags

- **No new permission keys.** All four permissions this pipeline binds
  (`tickets.file`, `ledger.approve`, `pastoral.notes.view`, `roll.propose`)
  already exist in the catalog — `tickets.file` via the sibling pipeline's
  `0019` migration, the other three via `scripts/seed-dev.sql`'s existing
  block (lines 222–232).
- **Default role bindings** (all Alder Creek, `22222222-2222-2222-2222-222222222222`,
  all direct/arm-1 grants — no derived-group mechanism exists for any of
  these offices, confirmed by architect's Phase 2 read of
  `presby_sync_derived_group()`):
  - `tickets.file` → new role `support_contact` → Marguerite Ashcombe
  - `ledger.approve` → new role `treasurer` → Priya Balakrishnan
  - `pastoral.notes.view` → new role `installed_pastor` → Rowan Thistlewood
  - `roll.propose` → existing role `stated_clerk` → Tobias Renwick (already
    holds it; no new `role_grants` row, DECISION-078)
- **Flags:** none needed — fixture data only, no new gated surface. (The
  platform Support Operator bundle reuses `FEATURES.ADMIN_TICKETS` /
  `FEATURES.ADMIN_FEEDBACK`, both permissions, not flags.)

## API Contract

None. No route, no server action, no query-layer function. `src/lib/
role-grants.ts` and `/o/<slug>/admin/roles` (tenant side) and `/admin/users`
(platform side) already grant/revoke/view any role or bundle generically —
that is the entire point of this pipeline being fixture-only (Phase 2's
Placement finding, unchanged).

## Data Model

**No schema changes required.** Every insert below targets an existing
table (`app_roles`, `app_role_permissions`, `role_grants`, `officer_terms`,
`roles`, `roleFeatures`) with its existing columns. New `id` values follow
the existing fixture's letter-prefixed counter convention exactly
(`f0000000-...-00NN` for `app_roles`, `e0000000-...-00NN` for
`officer_terms`) so a reader scanning `scripts/seed-dev.sql` sees one
continuous numbering scheme, not a second one bolted on.

### 1. `support_contact` role — `tickets.file` → Marguerite Ashcombe

Confirms Phase 1's working name. `property_chair`'s shape exactly: custom,
unprotected, no `officer_terms` row (no PC(USA) office corresponds to it —
Phase 1's own reasoning for why this is deliberately *not* a constitutional
role). `starts_on` is the date this pipeline's grant lands, not an office
date — there is no term to match.

```sql
insert into app_roles (id, organization_id, key, name, role_kind, is_protected) values
  ('f0000000-0000-0000-0000-000000000006','22222222-2222-2222-2222-222222222222',
   'support_contact','Support Contact','custom',false);

insert into app_role_permissions (role_id, permission_key) values
  ('f0000000-0000-0000-0000-000000000006','tickets.file');

insert into role_grants (organization_id, role_id, person_id, starts_on) values
  ('22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-000000000006',
   'c0000000-0000-0000-0000-000000000001', -- Marguerite Ashcombe
   '2026-08-20');
```

### 2. `treasurer` role — `ledger.approve` → Priya Balakrishnan

Constitutional and protected, `stated_clerk`'s own shape (Phase 1's
reasoning: Treasurer is a real, common PC(USA)/congregational office, not a
software convenience — G-3.0205 assumes a Treasurer at every congregation).
`officer_terms.office = 'treasurer'` is not a new vocabulary item —
`src/lib/db/domain/officers.ts:84` already lists `treasurer` in its own
office-column comment, and the same comment (line 96) already names
Treasurer as one of the schema's anticipated **open-ended** offices (no
`class_year`, no `ends_on`), alongside Clerk of Session — so this binding is
completing something the schema already anticipated, not inventing it.

**Who holds it, and why not someone already seeded**: Tobias Renwick already
holds `property_chair` and `stated_clerk` — a third grant to him recreates
exactly the concentration this pipeline exists to interrupt. Marguerite
Ashcombe is now `support_contact` (above). Of the remaining Alder Creek
fixture people, **Priya Balakrishnan** is the right fit: an existing,
already-seeded member (spouse in the Renwick household, ordained deacon
2019), whose one officer term (deacon, `e0000000-...-000004`) ended
2025-01-12 with no successor term recorded — she is a real, currently
unencumbered ordained officer at this congregation, not a new fixture person
invented for this pipeline. Desmond Okonkwo is not a member (`
other_participant` roll status) and Hallie Vandermeer is a minor — neither
is a plausible Treasurer. `starts_on` picks up the day after Priya's
diaconate term ended, matching the pattern (not the letter) of
`stated_clerk`'s own precedent — the software grant begins when the office
does, and continuous service from one term into the next unelected office is
an ordinary, plausible congregational transition.

```sql
insert into app_roles (id, organization_id, key, name, role_kind, is_protected) values
  ('f0000000-0000-0000-0000-000000000007','22222222-2222-2222-2222-222222222222',
   'treasurer','Treasurer','constitutional',true);

insert into app_role_permissions (role_id, permission_key) values
  ('f0000000-0000-0000-0000-000000000007','ledger.approve');

insert into officer_terms (id, organization_id, person_id, office, class_year, starts_on, ends_on, end_reason, recorded_by) values
  ('e0000000-0000-0000-0000-000000000006','22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-000000000003', -- Priya Balakrishnan
   'treasurer', null, '2025-01-13', null, null, null);

insert into role_grants (organization_id, role_id, person_id, starts_on) values
  ('22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-000000000007',
   'c0000000-0000-0000-0000-000000000003',
   '2025-01-13');
```

### 3. `installed_pastor` role — `pastoral.notes.view` → Rowan Thistlewood

Constitutional and protected. **Key honors DECISION-079**: names the
pastoral relationship, never the presiding function — `installed_pastor`,
not `moderator`. `docs/schema-design.md` §8's own line ("installed pastors
from `officer_terms` where the ministry is teaching elder") already uses
this exact phrase, so the office key is lifted from the schema's own
vocabulary rather than invented fresh.

**Who holds it**: Rowan Thistlewood is not a "pick among several plausible
candidates" the way Treasurer was — he is *the* pastor the fixture already
built D1 around (`ordained minister_of_word_and_sacrament, 1998-06-21`,
membership at the presbytery, a service-only membership with no roll at
Alder Creek). No stacking concern applies; he holds no other role today.
`starts_on` matches his presbytery membership's `current_roll_since`
(2015-08-01) — the fixture's only recorded date plausibly marking when his
service at Alder Creek began, matching `stated_clerk`'s "software grant
begins when the office did" precedent as closely as the existing data allows.

```sql
insert into app_roles (id, organization_id, key, name, role_kind, is_protected) values
  ('f0000000-0000-0000-0000-000000000008','22222222-2222-2222-2222-222222222222',
   'installed_pastor','Installed Pastor','constitutional',true);

insert into app_role_permissions (role_id, permission_key) values
  ('f0000000-0000-0000-0000-000000000008','pastoral.notes.view');

insert into officer_terms (id, organization_id, person_id, office, class_year, starts_on, ends_on, end_reason, recorded_by) values
  ('e0000000-0000-0000-0000-000000000007','22222222-2222-2222-2222-222222222222',
   'c0000000-0000-0000-0000-000000000006', -- Rowan Thistlewood
   'installed_pastor', null, '2015-08-01', null, null, null);

insert into role_grants (organization_id, role_id, person_id, starts_on) values
  ('22222222-2222-2222-2222-222222222222','f0000000-0000-0000-0000-000000000008',
   'c0000000-0000-0000-0000-000000000006',
   '2015-08-01');
```

Both `officer_terms` FKs resolve against the composite `(person_id,
organization_id)` target on `memberships` — Priya's and Rowan's Alder Creek
membership rows already exist in the fixture, so no membership insert is
needed alongside either.

### 4. `roll.propose` → `stated_clerk` (DECISION-078 — ruled, not a new call)

One row, no new role, no new `role_grants` row — Tobias Renwick's existing
grant (line 291-293 of the current fixture) already carries the permission
once this lands.

```sql
insert into app_role_permissions (role_id, permission_key) values
  ('f0000000-0000-0000-0000-000000000005','roll.propose'); -- stated_clerk
```

### 5. Platform "Support Operator" bundle

`src/lib/permissions.ts` — one new constant next to `ADMIN_ROLE`/`MEMBER_ROLE`:

```ts
export const ADMIN_ROLE = "admin" as const;
export const MEMBER_ROLE = "member" as const;
export const SUPPORT_OPERATOR_ROLE = "support_operator" as const; // new
```

`scripts/seed.ts` — `seedRoles()`'s `defs` array gains one entry, sort order
placed between admin (0) and member (100) — a bundle with narrower reach than
admin but broader than the baseline role:

```ts
{ name: SUPPORT_OPERATOR_ROLE, displayName: "Support Operator", isSystem: true, sortOrder: 50 },
```

A new function, mirroring `bindAdminFeatures()`'s exact shape (loop, insert,
`onConflictDoNothing()`) but over a **fixed two-key list**, not
`Object.values(FEATURES)` — the whole point, per Phase 2's confirmation, is
that this bundle stays narrower than admin, not that it re-derives "every
feature" generically:

```ts
async function bindSupportOperatorFeatures() {
  const role = await db.query.roles.findFirst({
    where: eq(schema.roles.name, SUPPORT_OPERATOR_ROLE),
  });
  if (!role) return;
  for (const key of [FEATURES.ADMIN_TICKETS, FEATURES.ADMIN_FEEDBACK]) {
    await db
      .insert(schema.roleFeatures)
      .values({ roleId: role.id, featureKey: key })
      .onConflictDoNothing();
  }
  console.log("bound tickets + feedback features to support_operator");
}
```

Called from `main()` immediately after `bindAdminFeatures()`. **This
function cannot run to completion until `FEATURES.ADMIN_TICKETS` exists** —
`roleFeatures.featureKey` FKs to `features.key`, and `features` is only
populated from `FEATURE_CATALOG` by `seedFeatures()`, which reads the same
`src/lib/permissions.ts` this constant doesn't yet carry an entry for. See
Implementation Order.

## Component / Page Plan

None. No pages, no components — `/o/<slug>/admin/roles` and `/admin/users`
already render any role/bundle generically (Phase 2's Placement finding).

## Implementation Order

All of this pipeline's work is **database-admin**, split into two commits
gated on two different, independent preconditions from the sibling
`2026-08-20-support-tickets` pipeline. Do not combine them into one commit —
they become unblockable on different schedules.

**Commit A — tenant fixture (bindings 1–4 above), gated on `0019` landing.**
Preconditions, checked in order, before editing `scripts/seed-dev.sql`:
1. `drizzle/0019_presby_ticket_support.sql` is **committed** (not merely
   present on disk — `git status` must not show it as `??`).
2. It has been **applied** to whichever database this fixture will be run
   against (`npm run db:push` on a dev branch, or `npm run db:migrate` in a
   migration-tracked environment) — confirm with a direct query, not an
   assumption: `select 1 from permissions where key = 'tickets.file';` must
   return a row.
3. Once both hold, extend `scripts/seed-dev.sql`'s existing Authorization
   fixture block (the `app_roles`/`app_role_permissions`/`role_grants`
   inserts starting at line 234, and the `officer_terms` block starting at
   line 169) with the SQL above. One commit: all three new roles, both new
   `officer_terms` rows, and the `roll.propose` binding together — they are
   one coherent fixture edit to one file's one logical section, not four
   independent changes.
4. Re-run the fixture against a freshly migrated dev database
   (`psql "$MIGRATE_DATABASE_URL" -f scripts/seed-dev.sql`, per
   `docs/testing.md`) and confirm no FK or constraint violation.
5. Extend `scripts/test-rls.sql` with a cross-org assertion for at least one
   new role (mirrors the sibling pipeline's own instruction for its four new
   tables) — e.g. a Bramblewood-scoped query for `treasurer`/
   `installed_pastor`/`support_contact` returns zero rows, proving these new
   Alder-Creek-only roles don't leak.

**Commit B — platform Support Operator bundle, gated on `FEATURES.
ADMIN_TICKETS` landing.** Precondition: `src/lib/permissions.ts` carries a
`FEATURES.ADMIN_TICKETS` entry and a matching `FEATURE_CATALOG` row —
confirm by grep, not by trusting the sibling work-log's Per-Phase Status
table (this pipeline's own Phase 3 briefing was wrong about which commit
does this; verify directly). Then:
1. Add `SUPPORT_OPERATOR_ROLE` to `src/lib/permissions.ts`.
2. Add the `seedRoles()` entry and `bindSupportOperatorFeatures()` to
   `scripts/seed.ts`, call it from `main()`.
3. Run `npm run db:seed` against the target database and confirm the
   `support_operator` role and both `role_features` rows exist.

**No ordering requirement between Commit A and Commit B relative to each
other** — they touch disjoint tables (tenant fixture vs. platform shell) and
neither reads the other's output. Each is independently gated only on its
own sibling-pipeline precondition.

## Edge Cases & Risks

- **Running Commit A before `0019` has landed.** The FK on
  `app_role_permissions.permission_key → permissions.key` makes this fail
  loudly and immediately — Postgres raises a foreign-key-violation on the
  `('f0000000-...-006','tickets.file')` insert, naming the missing key. This
  is a real, if blunt, detection mechanism: an implementer who skips the
  precondition check still cannot silently corrupt state, they just get a
  transaction rollback (the whole fixture runs inside one `begin`/`commit`
  block) with a clear error. The explicit pre-check in Implementation Order
  exists so that failure is anticipated rather than debugged from a cold
  start, not because the database won't catch it unaided.
- **Running Commit B before `FEATURES.ADMIN_TICKETS` exists.** Same shape,
  different table: `roleFeatures.featureKey → features.key` FK-violates on
  the `ADMIN_TICKETS` insert specifically. Unlike Commit A, `scripts/
  seed.ts`'s `main()` runs each seed function as its own unguarded
  `await` with no shared transaction — `bindSupportOperatorFeatures()`'s
  loop over `[ADMIN_TICKETS, ADMIN_FEEDBACK]` will insert whichever key it
  reaches first successfully (order as written: `ADMIN_TICKETS` first, so it
  fails before `ADMIN_FEEDBACK` is attempted) and then throw, crashing
  `main()` via the top-level `.catch()`. This is safe to retry: every prior
  seed function in `main()` uses `onConflictDoNothing()`, so re-running
  `npm run db:seed` once the sibling's commit lands simply completes the
  interrupted work with no cleanup step required.
- **A congregation with zero `treasurer`/`installed_pastor` holders through
  ordinary attrition.** No self-lockout guard exists for either role, the
  same shape already named for `support_contact`/`tickets.file`
  (`revokeRole()` only checks `role_grants.manage`) — but this is inherent
  to every non-`stated_clerk` role in the catalog, not a new gap this
  pipeline introduces. Not tracked as a new `docs/TODO.md` line; the
  existing line already generalizes ("`property_chair` already lives with
  the identical exposure today").
- **`pastoral.notes.view` still gates nothing live.** No route or action
  anywhere checks it — same restated caveat Phase 1 named for both tier-2/3
  permissions. Binding a holder makes the fixture polity-honest; it produces
  no new user-observable behavior.
- **Presbytery/synod pastoral care remains genuinely unaddressed.**
  `installed_pastor` is congregation-scoped by construction (an
  `officer_terms` row at Alder Creek specifically) — nothing here
  presumes or forecloses a future presbytery-level care-of-ministers
  concept, per Phase 1's Out of Scope.

**E2e blast radius**: none of this pipeline's inserts change any existing
`role_grants`/`app_role_permissions` row already asserted against by
`scripts/test-rls.sql` or the Playwright suite — every new row is additive
(three new roles, one new permission binding on an already-tested role). The
one existing suite this could plausibly touch is `scripts/test-rls.sql`'s
count-based assertions (e.g. "alder: sees own memberships" style checks) —
confirmed by inspection these count `memberships`/`roll_actions` rows, not
`app_roles`/`role_grants` rows, so they are unaffected. No existing
Playwright spec exercises `/o/<slug>/admin/roles`'s role list against a
literal expected count of Alder Creek roles (checked: the P9 e2e coverage
asserts on `stated_clerk`/`property_chair`/`session_member` by name, not by
total count) — new rows appearing in that list is additive, not breaking.

## Implementer

**database-admin**, two commits as specified in Implementation Order.

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
