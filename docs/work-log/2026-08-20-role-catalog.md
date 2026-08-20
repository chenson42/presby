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
| 4 — Implementation | database-admin | Complete (Commit A + Commit B) | — | 2026-08-20 |
| 5 — Verification | qa | Complete | PASS | 2026-08-20 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-08-20 |

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

## Commit A — tenant fixture (database-admin, complete)

Commit B (platform Support Operator bundle) is not part of this commit — it
remains gated on `FEATURES.ADMIN_TICKETS` landing in `src/lib/permissions.ts`,
confirmed absent by grep at the time of this commit, per Phase 3's
Implementation Order.

### Precondition check (done first, before touching any file)

1. `git log --oneline -1 -- drizzle/0019_presby_ticket_support.sql` →
   `6d8a1e9 feat(tickets): schema and migration for the support-ticket loop`
   — committed, not merely present on disk.
2. `psql "$MIGRATE_DATABASE_URL" -c "select 1 from permissions where key = 'tickets.file';"`
   → one row returned — applied to the dev database.

Both preconditions held; proceeded.

### Files Modified

- `scripts/seed-dev.sql` — extended the existing Authorization fixture block
  with all four bindings from Phase 3's Data Model section:
  - Two new `officer_terms` rows (`e0000000-...-006` treasurer/Priya
    Balakrishnan `2025-01-13`→open, `e0000000-...-007` installed_pastor/Rowan
    Thistlewood `2015-08-01`→open), added into the existing `officer_terms`
    insert block (after `e0000000-...-005`).
  - Three new `app_roles` rows (`f0000000-...-006` `support_contact`
    custom/unprotected, `f0000000-...-007` `treasurer`
    constitutional/protected, `f0000000-...-008` `installed_pastor`
    constitutional/protected), added into the existing `app_roles` insert
    (after `stated_clerk`).
  - Four new `app_role_permissions` rows: `stated_clerk` → `roll.propose`
    (DECISION-078, no new role/grant — Tobias Renwick's existing grant
    already carries it), `support_contact` → `tickets.file`, `treasurer` →
    `ledger.approve`, `installed_pastor` → `pastoral.notes.view`.
  - Three new `role_grants` rows, all direct (arm 1), all Alder Creek: Support
    Contact → Marguerite Ashcombe (`2026-08-20`, no matching officer term by
    design — no PC(USA) office corresponds to it); Treasurer → Priya
    Balakrishnan (`2025-01-13`, matching the new officer term); Installed
    Pastor → Rowan Thistlewood (`2015-08-01`, matching the new officer term).
- `scripts/test-rls.sql` —
  - Fixed the section-2 assertion `alder: sees own officer terms` from `5` to
    `7` (the two new `officer_terms` rows land at Alder Creek; the design doc
    didn't call this out explicitly, found by re-running the suite against
    the design's own SQL and reading the failure). `support_contact` carries
    no `officer_terms` row by design, so it doesn't move this count further.
  - Added three new `\set` variables (`TREASURER_ROLE`,
    `INSTALLED_PASTOR_ROLE`, `SUPPORT_CONTACT_ROLE`) alongside the existing
    fixture-id block.
  - Added new section 15 ("Role catalog expansion"), mirroring section 2's
    and section 14's own two-part shape (an Alder Creek positive count, a
    Bramblewood zero-count, plus a known-id cross-org read that must return
    zero rows rather than a distinguishable 403 — section 14's own
    enumeration-discipline pattern): `app_roles`/`role_grants` counts scoped
    to Alder Creek (3 and 3) and to Bramblewood (0 and 0), plus a
    known-role-id cross-org read of the `treasurer` role from Bramblewood
    context (0).

### Schema Changes

None. No `schema.ts` edit, no Drizzle Kit run, no migration file. Every
insert targets an existing table with existing columns, per Phase 3's Data
Model ("No schema changes required"). Nothing to apply via `db:push` or
`db:generate` — this commit is fixture data only.

### Migration mode

N/A — no migration. The dev database already carries every table this commit
writes to (`app_roles`, `app_role_permissions`, `role_grants`,
`officer_terms`), unchanged in shape. Applied directly as SQL against the
already-migrated dev database (see Verification below).

### Verification

**ID collision check, re-confirmed before writing** (per the task's
instruction — the sibling pipeline may have touched the file since it was
last checked):

```
grep -n "f0000000-0000-0000-0000-000000000006\|f0000000-0000-0000-0000-000000000007\|f0000000-0000-0000-0000-000000000008\|e0000000-0000-0000-0000-000000000006\|e0000000-0000-0000-0000-000000000007" scripts/seed-dev.sql
```
→ no matches (exit 1) before editing. Clean.

**Apply.** `scripts/seed-dev.sql` is not fully re-runnable end-to-end against
an already-seeded database (confirmed directly: `app_roles`/`officer_terms`
queried against `$MIGRATE_DATABASE_URL` before this commit already showed the
base fixture's 5 roles / 5 officer terms present — the sibling pipeline's own
prior commit had already applied the base fixture plus its own ticket rows).
Per the task's documented workaround, extracted just the new INSERT block
(officer_terms → app_roles → app_role_permissions → role_grants, wrapped in
one `begin`/`commit`) into an isolated scratch file and applied it directly:

```
$ psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f <scratch>/role-catalog-commit-a.sql
BEGIN
INSERT 0 2
INSERT 0 3
INSERT 0 4
INSERT 0 1
INSERT 0 1
INSERT 0 1
COMMIT
```

No FK or constraint violation.

**Direct query confirmation:**

```
select id, key, name, role_kind, is_protected from app_roles
 where id in ('f0000000-...-006','f0000000-...-007','f0000000-...-008');
```
→ `support_contact` (custom, unprotected), `treasurer` (constitutional,
protected), `installed_pastor` (constitutional, protected) — all present,
correct `role_kind`/`is_protected`.

```
select id, person_id, office, starts_on, ends_on from officer_terms
 where id in ('e0000000-...-006','e0000000-...-007');
```
→ treasurer/Priya `2025-01-13`→null, installed_pastor/Rowan `2015-08-01`→null
— both present, correct dates, open-ended as designed.

```
select role_id, permission_key from app_role_permissions
 where role_id = 'f0000000-...-005';
```
→ `role_grants.manage`, `roll.propose` — `stated_clerk` now carries both.

```
select organization_id, role_id, person_id, starts_on from role_grants
 where role_id in ('f0000000-...-006','f0000000-...-007','f0000000-...-008');
```
→ all three, correct `person_id`/`starts_on`, all Alder Creek.

**`scripts/test-rls.sql` as `presby_app`:**

```
$ psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql
```
Exit code 0. 82 "pass" lines, 0 "FAIL" occurrences (`grep -c FAIL` → 0,
`grep -c pass` → 82), including the corrected section-2 officer-terms count
(now 7) and the three new section-15 assertions.

**`npm run typecheck`** — clean, no output beyond the tsc invocation.

**`npm run check`** (all four tripwires) — all four passed: audit-coverage,
`sql<Date>` guard, dependency-drift, brand-scope. Unaffected by this
SQL-only change, as expected.

### Audit Events

None. No application mutation fired — every row is a direct fixture insert,
not a call through `grantRole()`/`src/lib/role-grants.ts`. No new
`AUDIT_ACTIONS` key needed; `npm run check:audit` scans only
`src/app/**/actions.ts`, untouched by this commit.

### Implementer Notes — divergences from Phase 3 and things that surprised me

1. **The `officer_terms` count assertion in `scripts/test-rls.sql` section 2
   needed a fix Phase 3's design doc didn't call out.** The design doc names
   `scripts/test-rls.sql` additions only as "extend... with a cross-org
   assertion for at least one new role" — it doesn't mention that adding two
   `officer_terms` rows at Alder Creek breaks the pre-existing `count(*) = 5`
   assertion at line 56 (now 7). Caught by reading the file directly before
   editing, not by a test failure — trusted the actual fixture/schema over
   the design doc's silence, per the task's own instruction.
2. **`scripts/seed-dev.sql` is genuinely not re-runnable end-to-end today**,
   confirmed directly rather than assumed from the task's framing: the dev
   database already carried the base fixture (5 `app_roles`, 5
   `officer_terms`) before this commit ran, meaning some prior session
   already applied it and any second full run would collide on the
   `organizations`/`people` inserts long before reaching this pipeline's own
   new rows. Used the documented isolated-INSERT-block workaround, matching
   the sibling support-tickets pipeline's own Commit 1 approach. This is a
   standing fixture-hygiene gap (not idempotent), not something this commit
   introduces or is positioned to fix — flagged here for whoever eventually
   picks up fixture idempotency as its own piece of work, not filed as a new
   `docs/TODO.md` line since Phase 3 didn't ask for one and the sibling
   pipeline already established this as the accepted workaround rather than
   a blocking defect.
3. **Everything else matched Phase 3 exactly** — id values, dates, column
   order, role_kind/is_protected pairs, and the person assignments all copied
   directly from the design doc's own SQL with no reconstruction from prose.
   No FK violations, no naming collisions, no surprises in the data itself.

### Handoff

**New rows available to the next implementer:**
- `app_roles`: `support_contact` (`f0000000-...-006`, custom, unprotected),
  `treasurer` (`f0000000-...-007`, constitutional, protected),
  `installed_pastor` (`f0000000-...-008`, constitutional, protected) — all
  Alder Creek only, all reachable today through the existing generic
  `src/lib/role-grants.ts` / `/o/<slug>/admin/roles` UI with zero code
  changes.
- `app_role_permissions`: `stated_clerk` now additionally carries
  `roll.propose` (alongside its existing `role_grants.manage`).
- `officer_terms`: two new open-ended rows (`e0000000-...-006` treasurer,
  `e0000000-...-007` installed_pastor), both dated to match their
  corresponding `role_grants.starts_on`.
- `role_grants`: three new direct (arm 1) grants at Alder Creek, to
  Marguerite Ashcombe, Priya Balakrishnan, and Rowan Thistlewood
  respectively.
- No new relationships beyond ordinary rows on existing tables — no schema
  change for the next agent to react to.

**Local apply command for anyone re-provisioning a fresh dev database from
scratch:** `psql "$MIGRATE_DATABASE_URL" -f scripts/seed-dev.sql` (the file
as a whole, which now includes this commit's rows in their proper fixture
position) followed by `npm run db:seed`. For an already-seeded database like
the one this commit ran against, use the isolated-INSERT-block workaround
documented above (item 2) instead of re-running the whole file.

**Next: Commit B is still gated** on `FEATURES.ADMIN_TICKETS` landing in
`src/lib/permissions.ts` (support-tickets pipeline's Phase 4 commit 2,
api-developer, per DECISION-080's correction) — re-check by grep before
starting Commit B, don't trust this note's own staleness. Once that lands,
Commit B (database-admin again: `SUPPORT_OPERATOR_ROLE` constant,
`scripts/seed.ts` additions, `npm run db:seed`) can proceed independently —
no ordering requirement against this commit.

After both commits, **qa (Phase 5)** is next in the pipeline for this feature
as a whole — this response covers Commit A only; Commit B still needs its own
Phase 4 entry appended before Phase 5 can evaluate the complete pipeline. If
qa is invoked before Commit B lands, the correct verdict is `BLOCKED` naming
`FEATURES.ADMIN_TICKETS` as the unmet prerequisite, not a partial `PASS`.

## Commit B — platform Support Operator bundle (database-admin, complete)

### Precondition check (done first, before touching any file)

`grep -n "ADMIN_TICKETS" src/lib/permissions.ts` returned both the
`FEATURES.ADMIN_TICKETS` constant (line 20, `"admin.tickets"`) and its
`FEATURE_CATALOG` entry (lines 57–63, category `admin`, name "Manage support
tickets") — the sibling `2026-08-20-support-tickets` pipeline's Phase 4 commit
2 (api-developer) had landed. Precondition held; proceeded.

### Files Modified

- `src/lib/permissions.ts` — added one constant, next to `ADMIN_ROLE`/
  `MEMBER_ROLE`, exactly as Phase 3 specified:

  ```ts
  export const ADMIN_ROLE = "admin" as const;
  export const MEMBER_ROLE = "member" as const;
  export const SUPPORT_OPERATOR_ROLE = "support_operator" as const;
  ```

- `scripts/seed.ts`:
  - Imported `SUPPORT_OPERATOR_ROLE` alongside the other permission constants.
  - Added one entry to `seedRoles()`'s `defs` array, matching the file's
    actual shape exactly (Phase 3's prose guess matched — no divergence):

    ```ts
    { name: SUPPORT_OPERATOR_ROLE, displayName: "Support Operator", isSystem: true, sortOrder: 50 },
    ```

    Placed between `ADMIN_ROLE` (sortOrder 0) and `MEMBER_ROLE` (sortOrder
    100), matching Phase 3's stated intent.
  - Added `bindSupportOperatorFeatures()`, mirroring `bindAdminFeatures()`'s
    shape exactly but over the fixed two-key list, copied verbatim from
    Phase 3's design:

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

  - Called from `main()` immediately after `bindAdminFeatures()`:

    ```ts
    await bindAdminFeatures();
    await bindSupportOperatorFeatures();
    await seedLocalAdmin();
    ```

### Schema Changes

None. `roles` and `role_features` (Drizzle: `roleFeatures`) are existing
platform-shell tables; this commit only inserts rows via the existing seed
script. No `schema.ts` edit, no Drizzle Kit run, no migration file.

### Migration mode

N/A — no migration. This commit is application/seed-script code plus data,
not a schema change. Applied by running `npm run db:seed` against the dev
database (the same one Commit A's verification queries targeted, via
`$DATABASE_URL` / `$MIGRATE_DATABASE_URL`), which is idempotent
(`onConflictDoNothing()` throughout) and safe to re-run.

### Verification

**`npm run db:seed`** — completed with no error:

```
seeded roles
seeded 11 features
seeded 6 feature flags
bound all features to admin
bound tickets + feedback features to support_operator
done.
```

**Direct query — role exists:**

```sql
select id, name, display_name, is_system, sort_order from roles where name = 'support_operator';
```
→ one row: `support_operator`, `Support Operator`, `is_system = t`,
`sort_order = 50`.

**Direct query — exactly two `role_features` rows, no more, no fewer:**

```sql
select rf.feature_key
from role_features rf
join roles r on r.id = rf.role_id
where r.name = 'support_operator'
order by rf.feature_key;
```
→ `admin.feedback`, `admin.tickets` — exactly two rows.

**`npm run typecheck`** — clean, no errors.

**`npm run check`** (all four tripwires) — all four passed: audit-coverage
("Audit-coverage check passed."), `sql<Date>` guard ("sql<Date> guard
passed."), dependency-drift ("Dependency-drift check passed."), brand-scope
("Brand-scope check passed" — dormant E2 note for a file that doesn't exist
yet, pre-existing and unrelated to this commit).

**`scripts/test-rls.sql` as `presby_app`:**

```
$ psql "$APP_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/test-rls.sql
```
Exit code 0. Log starts at `BEGIN`, ends at `COMMIT`, no `ERROR` lines
anywhere (637 total lines). `grep -ic fail` → 0. `grep -ic pass` → 82 —
matching the exact baseline named in the task (82 pass, 0 fail), unchanged
from Commit A's own run, as expected since this commit touches only
`roles`/`role_features` (platform-shell tables `scripts/test-rls.sql` doesn't
assert on) and not `memberships`/`roll_actions`/any tenant table the suite
does assert on. No roll-drift investigation was needed — the run was fully
clean, not partially clean with an attributable-elsewhere failure.

### Audit Events

None. No application mutation fired through a user-facing action — every row
is inserted directly by the seed script, mirroring `bindAdminFeatures()`'s own
precedent (which also writes no audit event). `npm run check:audit` scans only
`src/app/**/actions.ts`, untouched by this commit.

### Implementer Notes — divergences from Phase 3 and things that surprised me

None. Phase 3's design code (constant, `defs` entry, `bindSupportOperatorFeatures()`,
the `main()` call site) matched the actual file structure of both
`src/lib/permissions.ts` and `scripts/seed.ts` exactly — no reconstruction or
adjustment was needed. The one thing Phase 3 flagged as uncertain (whether the
`defs` array's exact object shape matched what's actually in the file) turned
out to match verbatim, including field names (`name`, `displayName`,
`isSystem`, `sortOrder`) and the `onConflictDoNothing()` pattern.

### Handoff

**New row available to the next implementer:** the platform `roles` table now
has a `support_operator` row (`is_system = true`, `sort_order = 50`, between
`admin` and `member`), bound in `role_features` to exactly
`FEATURES.ADMIN_TICKETS` (`admin.tickets`) and `FEATURES.ADMIN_FEEDBACK`
(`admin.feedback`) — narrower than `admin`'s full-catalog bundle, broader than
`member`'s empty one. It is reachable today through the existing generic
`/admin/users` role-assignment UI with zero code changes (Phase 2's Placement
finding — no new page, route, or component).

**Local apply commands for anyone re-provisioning:**
`npm run db:push` (or `npm run db:migrate` if migration-tracked — not
applicable here, no schema changed) is not needed for this commit; the only
step is `npm run db:seed`, which is idempotent and safe to re-run.

**Both commits of this pipeline are now complete.** Next: **qa (Phase 5)**
evaluates the complete pipeline (Commit A + Commit B together).

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-20
**Verified by:** qa

## Verdict

**PASS**

Every binding — three new tenant roles, `roll.propose` onto
`stated_clerk`, the platform Support Operator bundle — verified by
direct query against the live database, not inferred from the
work-log's own claims. Confirmed no concentration regression (Tobias
Renwick still holds exactly `{property_chair, stated_clerk}`, no
third/fourth role). Confirmed the two cross-pipeline FK preconditions
genuinely held before their dependents ran, by commit timestamp order,
not narrative. `scripts/test-rls.sql` ran fully clean (82 pass, 0
fail) — the full suite, not an isolated subset.

## Type Check

`npm run typecheck`: **PASS**

## Unit Tests

Default `npm run test` (no DB env): 1519 total | 1455 passed | 64
skipped (4 DB-gated files) | 0 failed. Re-ran all four DB-gated files
against real Postgres rather than accepting the skip:
`role-grants.test.ts`/`tickets.test.ts`/`directory.test.ts` — all
pass (62 tests), independently confirming the new fixture rows didn't
disturb the generic grant/revoke/directory machinery.
`blob-store.test.ts` — found 2 of 8 stale, silently-wrong tests
(their oversized-payload assertions predated DECISION-071/073's 10MB
widening and no longer exercised a real rejection). Root-caused to the
sibling support-tickets pipeline's own diff, not this pipeline's —
**fixed directly by the orchestrator** rather than left as a flagged
gap (`9162f13`), since it was a small, mechanical, verifiable fix
affecting test-suite integrity generally. Re-verified 7/7 passing
after the fix.

## End-to-End Tests

Not run — this pipeline touches no route, action, or page (see
Feature-Gate Audit), and doesn't touch auth, so the stricter e2e gate
doesn't apply. Phase 3's "E2e blast radius" claim independently
re-confirmed: no Playwright spec asserts a literal count of Alder
Creek roles; new rows are additive.

## Regression Tests Added

None required — fixture-only work, independently re-confirmed via
`git show --stat` on both Phase 4 commits: no `src/app/`, no `.tsx`,
no route file touched. Regression-test discipline applies to code
changes; there is none here to regress.

## Coverage on Critical Modules

- `src/lib/permissions.ts`: unaffected (one new exported constant, no
  new branch logic).
- `src/lib/two-factor.ts` / `src/lib/flags.ts`: not touched.
- `src/lib/role-grants.ts`: not touched, but independently re-verified
  live — `getGrantFormOptions()` queries `app_roles` scoped only by
  `organizationId`, no `role_kind`/`is_protected` filter, so all three
  new roles surface with zero code change.

## Feature-Gate Audit

No protected routes or Server Actions were added or changed —
confirmed by `git show --stat` on `081c16b` and `28c5d84`: only
`scripts/seed-dev.sql`, `scripts/test-rls.sql`, `scripts/seed.ts`,
`src/lib/permissions.ts` (one new constant), and the work-log itself.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| n/a — no protected routes touched | n/a | n/a | n/a |

## Verdict

**PASS**

*Recorded by the orchestrator from the read-only qa agent's report.*

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

**SHIP IT**

## ONE-LINE TAKE

> Four permission-catalog gaps close exactly as Phase 1 scoped them —
> `tickets.file` lands on its own honestly-non-constitutional
> `support_contact` role held by Marguerite Ashcombe (not Tobias
> Renwick), `ledger.approve`/`pastoral.notes.view` land on real
> PC(USA) offices the schema already anticipated, `roll.propose`
> completes a clean propose/approve separation on `stated_clerk`, and
> the platform Support Operator bundle is exactly two `FEATURES.*`
> keys — every claim independently re-derived from a live database
> query, not accepted from the work-log's own account.

## What's Working

- **Zero concentration regression, verified live** — Tobias Renwick
  holds exactly `{property_chair, stated_clerk}`, nothing added;
  Marguerite Ashcombe/Priya Balakrishnan/Rowan Thistlewood each hold
  exactly the one new role designed for them.
- **The DECISION-072 correction is present, accurate, and correctly
  append-only** — a distinct dated block below the original entry,
  never edited in place.
- **Cross-pipeline FK sequencing genuinely held**, confirmed by commit
  timestamp order, not narrative: `0019` (08:48) → Commit A (08:56) →
  `FEATURES.ADMIN_TICKETS` (09:17) → Commit B (09:21).
- **Fresh-eyes read of `scripts/seed-dev.sql` turned up nothing
  surprising** — the "why Marguerite, not Tobias" and "why Rowan"
  reasoning is discoverable from the SQL comments alone, not only the
  work-log.
- **No scope creep** — no presbytery/synod variant, no
  `committee_on_ministry` concept, no new route/page/component in
  either commit.

## Intent-vs-Shipped Diff

- Phase 1 said: `tickets.file` gets its own non-constitutional role,
  granted to Marguerite Ashcombe. Shipped: `support_contact`, granted
  to Marguerite Ashcombe. **Matches**, confirmed live.
- Phase 1 said: fix `ledger.approve`/`pastoral.notes.view` with real
  offices. Shipped: `treasurer`/`installed_pastor`, matching
  `officer_terms` rows. **Matches.**
- Phase 1 said: `roll.propose` is a fourth gap, Phase 3's call. Shipped:
  DECISION-078 bound it to `stated_clerk`. **Matches** — explicitly
  deferred to Phase 3, and the reasoning is sound.
- Phase 1 said: Support Operator needs nothing beyond
  `FEATURES.ADMIN_TICKETS`. Shipped: `{admin.tickets, admin.feedback}`.
  **Acceptable drift** — a reasonable design-time judgment (a support
  operator triaging tickets also needs incoming feedback) within
  Phase 1's stated bound ("narrower than admin"), independently
  confirmed as exactly two keys.
- Phase 1 said: presbytery/synod pastoral care and
  `committee_on_ministry` are out of scope. Shipped: neither appears.
  **Matches.**
- Phase 1 said: DECISION-072 needs a correction, and a `docs/TODO.md`
  line for the lost self-lockout protection. Shipped: both landed.
  **Matches.**

## Edge Cases

- Empty state: not applicable — no UI, fixture-only.
- Failure microcopy: not applicable — the one named consequence
  (revoking the sole `support_contact` holder succeeds silently) is
  Phase 1's own documented, accepted, tracked residual risk.
- Permission gate: pass — bindings match design exactly, section-15
  isolation assertions prove cross-org isolation for all three roles.
- Audit event: not applicable — direct fixture inserts, matching
  `bindAdminFeatures()`'s own no-audit precedent for seed-time binding.
- Mobile (360px): not applicable — no UI shipped.

## Process compliance

- **Rule 10**: confirmed current — the self-lockout TODO line is
  accurate and open by design; the blob-store fix is correctly in
  Done.
- **Rule 12**: not applicable — no in-app feedback origin.
- **Rule 13 (what's-new)**: ruled explicitly — no. Fixture data and a
  platform bundle, no member-visible behavior change; both new tenant
  permissions still gate no live route.
- **Rule 14 (functionality-map)**: ruled explicitly — no update
  needed. The map documents mechanism (generic grant/revoke against
  arbitrary `app_roles` rows), which is unchanged; documenting which
  specific roles exist in the dev fixture would over-document seed
  data the map's own header disclaims tracking.

## Follow-Ups

None new. The two items already tracked (the self-lockout TODO line,
the blob-store fix in Done) are correctly closed or correctly still
open by design — neither needs a status change.

*Recorded by the orchestrator from the read-only analyst agent's
report. Pipeline closed at SHIP IT — no further phase triggered.*
