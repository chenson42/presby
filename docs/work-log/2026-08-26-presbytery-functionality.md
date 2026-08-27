# Presbytery Functionality (psvonline-portal parity) — Work Log

> **Slug:** `2026-08-26-presbytery-functionality`
> **Surface:** TBD Phase 1 — (org) portal surfaces for a presbytery-type organization; presby's org model already carries the congregation → presbytery → synod hierarchy
> **Permission(s):** TBD Phase 1/3
> **Flag(s):** TBD Phase 3
> **Estimated complexity:** large
> **Pipeline mode:** Full — via `/new-feature`. Operator's words: "Next is presbytery functionality."

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES — five increments proposed | 2026-08-26 |
| 2 — Architectural review | architect | Complete | Approved with suggestions (Increment 2) | 2026-08-26 |
| 3 — Technical design | tech-lead | Complete (Increment 2) | Design complete; implementer named | 2026-08-26 |
| 4 — Implementation | Increment 0: full-stack-developer; Increment 2: database-admin (schema) → full-stack-developer (server+UI) | Increment 0 Complete; Increment 2 Complete (schema + server/UI commits both landed) | Increment 0: verified + 4 copy fixes shipped; Increment 2 schema: migration 0037 applied + test-rls §28 (17/17) passing; Increment 2 server/UI: `src/lib/credentials.ts` + admin tree shipped, 36 DB-backed + 87 unit/component tests passing, live-browser walk (desktop + 390px) verified | 2026-08-27 |
| 5 — Verification | qa | Complete (after one loop-back) | PASS — initial FAIL on a missing `organization_type_scope = 'presbytery'` regression test (Phase 3 named it explicitly); implementer added it (43/43, zero production changes), qa re-verified green | 2026-08-27 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES — housekeeping follow-ups tracked (release notes, functionality map, TODO reconciliation for Increments 1/3/4/5); no functional gap | 2026-08-27 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> "Presbytery functionality" is not one feature but five, of wildly different depth — one is mostly done already (the generic org portal), two are schema-plus-UI (credentials/appointments, congregation-oversight data), and one (per-capita/statistics) cannot be scoped until Phase 2 rules on how the "publication" mechanism this invariant depends on actually gets exercised by a human, because right now it's a table with no submit button.

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Presbytery staff (`/o/<presbytery-slug>`) | Browses the presbytery's own directory, groups (committees), officers | on demand — **already shipped, generic** |
| Presbytery staff | Records a minister's ordination / credential status change | per polity action (rare) |
| Presbytery staff | Records who serves in a pastoral/staff role at a member congregation (call, vacancy) | per call change |
| Presbytery staff | Enters/updates a member congregation's viability score, building/insurance data | annually or ad hoc |
| Stated Clerk | Sets the per-capita rate for a year; reviews which congregations have paid | annually / ongoing |
| Presbytery staff | Views rollup reports (vacant pulpits, membership trend, viability, per-capita) across member congregations | on demand |
| Congregation staff (if managed tenant) | Submits/publishes their own statistics upward (SASR cadence) | annually |
| Platform admin | Seeds presbytery-scoped constitutional roles/templates | one-time, prerequisite |

## Flows

**Flow 0 — Presbytery uses the existing generic portal (verification, not new build):** `/o/<presbytery-slug>` → directory/groups/officers already render generically. Never hand-walked for a presbytery-type org specifically — the seeded presbytery fixture exists but no record of anyone clicking through as that org.

**Flow 1 — Record a minister's ordination/credential status:** new `/o/<presbytery-slug>/admin/credentials` → clerk selects a person → ministry type, ordained-on, minute reference, status changes (honorably retired, on leave) → `ordinations` row + audit. Undefined: the transferring-in TE with no `people` row at this org yet.

**Flow 2 — Record who serves as pastor at a member congregation:** **no data model exists for this today** — `officer_terms` covers session/diaconate offices only, not pastoral calls. Blocks the vacant-pulpit report and much of the dashboard. Phase 2 must decide: a new appointments table (psvonline's shape) vs. expressing calls through `role_grants` + new `app_roles`.

**Flow 3 — Enter congregation-oversight data (viability, buildings, insurance, services):** presbytery staff edits per-congregation records. Where the hierarchy invariant bites hardest — permitted shape depends on the managed/unmanaged fork (see Gaps) and needs an explicit Phase 2 ruling.

**Flow 4 — Per-capita rate + collection tracking:** rate per year → "owed" computed from the roll (`presby_roll_as_of()`) for managed congregations; for unmanaged (the majority per D9) there is no roll — the presbytery must be able to enter a manual figure. A third, undiscussed case.

**Flow 5 — Rollup reports:** pure consumer of Flows 2-4's data models; can't be scoped ahead of them.

**Flow 6 — Bulk CSV import:** psvonline's import_runs/import_errors pattern — flagged lowest-priority, highest-risk; recommend deferral (see Out of Scope).

## Permissions & Flags

- **Existing, reused:** `directory.view`, `groups.manage`, `officers.manage` work for a presbytery org unchanged (Flow 0).
- **New candidates:** `credentials.manage` (Flow 1), `congregation_oversight.manage`/`view` (Flow 3), `per_capita.manage`/`view` (Flow 4), `presbytery_reports.view` (Flow 5). Tier: mostly 1; per-capita/viability arguably tier 2 (financial-adjacent) — Phase 2/3 rules, not assumed.
- **Default bindings:** `stated_clerk` and a new `executive_presbyter` are the obvious candidates — **but no presbytery-scoped constitutional-role template exists today** (`stated_clerk` is fixture-seeded for congregations only). A prerequisite, not a detail: every increment needs someone with a role to act.
- **Flags:** one `org_portal.*` flag per increment, seeded off, matching convention.

## Gaps the Request Didn't Address

- **No appointments/call model** — the deepest schema gap (Flow 2).
- **No presbytery-level constitutional roles seeded** — prerequisite.
- **The managed vs. unmanaged fork is unaddressed.** For unmanaged congregations (majority, D9), presbytery-entered oversight data is uncontroversial stewardship. For a *managed* congregation (a real tenant), the presbytery writing viability/insurance/statistics about it looks like the downward reach Invariant 2 prevents — unless scoped as "the presbytery's own opinion of congregation X" (org_id = presbytery, target = congregation, never touching the congregation's tenant tables). `schema-design.md` §17 ("publication moves the data to the reader's org") is the precedent; `sasr_reports` already has this shape for statistics. Needs an explicit Phase 2 ruling, not an implementer's guess.
- **No publication mechanism actually exists yet, only its scaffold** — `sasr_reports` has a status column but nothing writes those rows. Per-capita, membership-trend, and vacant-pulpit reporting all depend on this existing first.
- **Audit events:** credential changes, per-capita rate changes, oversight writes — Phase 3 decides which are Rule-7 security-sensitive vs. ordinary CRUD. Recording a minister's removal from ordered ministry deserves a trail regardless of the strict Rule-7 list.
- **Empty state:** a new presbytery with zero congregations recorded — and the adjacent product question: can presbytery staff provision their own member-congregation orgs, or does that stay platform-admin-only?
- **Mobile:** psvonline's report tables are desktop-dense; a 360px per-capita table needs a real treatment, not a shrink.

## Adversarial Pass

- **A second org id in the URL:** `/o/<presbytery-slug>/admin/congregation-oversight/<congregation-org-id>` for a congregation that is NOT this presbytery's member must be blocked server-side by org ownership — `resolveOrgContext()` alone doesn't cover the second id. New surface, explicit review needed.
- **Commission self-granting:** when `administrative_commissions` (no UI today) gets one, that creation form is the highest-value adversarial target in this program — a commission is *the* sanctioned downward-access bypass. Flagged now so Phase 3 doesn't treat it as routine CRUD.
- **Enumeration:** a presbytery's congregation list showing `platform_status` is legitimate (presbytery-internal, not a public prober) — but Phase 3 should say so explicitly rather than silently copying the byte-identical-copy pattern where it doesn't apply.
- **Input boundaries:** rates, scores, dates — standard server-side validation, no new gap class.

## Out of Scope (confirm with user)

- The AI assistant (psvonline's `src/lib/ai/`) — would need its own tier-aware permission story if ever revisited.
- Bulk CSV import — defer past this program's first release (high-risk, low-value-first).
- A tenant-facing audit reader — already deferred platform-wide, not presbytery-specific.
- Presbytery self-serve creation of member-congregation orgs — real product question, flagged not assumed.

## Open Questions

1. **Most important:** for a *managed* congregation, what may a presbytery see/write with zero publication — name/type only? Everything else via (a) upward publication (SASR-shaped), (b) an active commission/delegation, or (c) presbytery-owned-and-scoped assessments that were never the congregation's data (viability). Precedent leans (c) for oversight and (a) for statistics — needs the architect's formal ruling; increments 2-4 are shaped entirely differently by the answer.
2. Appointments: new table vs. `role_grants` + new `app_roles`? Reuse is elegant but conflates "grants permissions" with "holds a call" — architect ruling.
3. Who seeds presbytery-shaped constitutional roles — a one-off migration ahead of this program, or does this program use the just-shipped role-definition admin?
4. Can a presbytery admin provision new unmanaged member-congregation orgs, or platform-admin-only?
5. Naming collision: psvonline's `committee_type='commission'` (internal standing body, e.g. PJC) vs. presby's `administrative_commissions` (cross-org jurisdiction) — different concepts, same word; the UI must not conflate them.

## Proposed Increments

0. **Verify + polish the generic portal for a presbytery org** — hand-walk the fixture, fix congregation-flavored copy. Small, QA-shaped.
1. **Committees & commissions** — mostly covered by the just-shipped groups feature; small additions only.
2. **Ministry credentials & pastoral appointments** — ordinations UI (table exists, no UI) + the appointments model (Open Question 2). Deepest schema decision; resolve Open Questions 2-3 before Phase 3.
3. **Congregation oversight data** — depends entirely on Open Question 1's ruling.
4. **Per-capita + statistics/SASR rollup** — deepest of all; blocked on a real publication mechanism (the SASR submit flow, a separate congregation-facing feature). Own Phase 1 once that exists.
5. **Imports & reports** — reports last as a read-layer; CSV import deferred.

**Operator decision (2026-08-26):** start with **Increment 0 (verify/polish the generic portal for a presbytery org) + Increment 2 (minister credentials & pastoral appointments)**. Increments 3-5 wait.

**Handoff:** Increment 0 → a live verification/polish pass; Increment 2 → architect (Phase 2), taking Open Questions 2-3 (appointments model; role seeding) as the primary rulings, with Q1's managed-congregation ruling deferred to Increment 3's own Phase 2.

---

# Phase 2 — Architectural Review (architect)

**Scope:** Increment 2 only (ministry credentials & pastoral appointments), per the operator's decision. Rulings recorded in full as DECISION-112.

## Verdict

Approved with suggestions

## Placement

- **Schema:** both new/changed tables stay in `src/lib/db/domain/officers.ts` — the third "who serves in what capacity" shape in that file (ordination event, session/diaconate term, now pastoral-call term). No new domain module.
- **Admin surfaces:** `src/app/(org)/o/[slug]/admin/credentials/` — server components, `resolveOrgContext()`/`withOrgContext()` only, matching the `(org)` contract. One tree can hold both the ordinations-status UI and the appointments UI; splitting into two segments is a Phase 3 call.
- **Server vs client:** list/detail server-rendered; only the status-change and appointment forms are client islands. Mutations via co-located `actions.ts`.
- **Dependencies:** none.

## Invariants Touched

- **Two Hierarchies Intersect Nowhere / publication:** the appointments row is FORCED to live at the presbytery — the F2-safe composite person FK (`personId, organizationId → memberships`) can only resolve there since a minister's membership is at the presbytery (D1), exactly like `ordinations`. `servingOrgId` references `organizations` directly (plain FK — legal per §17's structural-table exception). The congregation-side downward read is deferred to Increment 3/4's publication mechanism, not solved with a bespoke cross-org RLS policy (§17 reserves those for two named cases). D9 makes the deferral cheap: most member congregations are unmanaged with no other side to read from.
- **The Court Is Not a Group:** confirmed the shape must NOT be `role_grants` + new `app_roles` — a pastoral call is an ecclesiastical office, not a software permission (the `clerk_of_session`-stays-a-data-value precedent). Extending `officer_terms` also fails (derived-roster trigger semantics don't apply).
- **Ordination Is Lifelong; Service Is Termed:** `ordinations` as-is cannot express honorably-retired/on-leave — `endedOn`/`endedReason` model true removal only. New nullable `status` column (psvonline's credential-status enum as prior art), default active, distinct from removal.

## Rulings (full text in DECISION-112)

1. **Q2 — appointments model: (a), new table, owned by the presbytery.** Columns: `organizationId` (presbytery, composite-FK-forced), `personId`, `servingOrgId`, role/callType enums (borrow psvonline's), `startedOn`/`endedOn` (mutable span like officerTerms, not append-only), `minuteReference`, `recordedBy`/`recordedAt`. Increment 2 ships presbytery-side write/record only.
2. **Q3 — presbytery-scoped roles: seed via a hand-written migration using the already-shipped template machinery — nearly free.** `organizationTypeScope` is fully wired (`listTemplateRoles`/`adoptTemplate` filter by org type); `drizzle/0032`'s `committee_chair` insert is the exact precedent. No new UI, no new backend. Naming-collision note for Phase 3: `(organization_id, key)` unique doesn't deduplicate two NULL-org template rows sharing a key — verify the type-filter, don't assume.
3. **`credentials.manage`:** tier 1; binds to the new presbytery-scoped Stated Clerk template per DECISION-078's test (register-keeping is the clerk's constitutional duty, G-3.0304) — NOT `executive_presbyter` (program leadership, not register-keeping). One permission may gate both UIs; if Phase 3 splits into two keys, both bind to the same office by the same test.

## Notes

- **Audit:** `ORDINATION_STATUS_CHANGED` (`tenant.ordination.status_changed`), `APPOINTMENT_RECORDED`/`APPOINTMENT_ENDED` (`tenant.appointment.*`) — polity actions with real weight, `tenant.*` actor-axis convention.
- **Flag:** `org_portal.credentials`, seeded off, mirroring `org_portal.officers`'s block.
- **Adversarial:** the form writing `appointments.servingOrgId` must validate the target org is actually a member of this presbytery (parent-path check) — the "second org id" risk Phase 1 flagged for Increment 3 applies here too.
- Q1 (managed-congregation ruling) stays out of scope per the operator's decision — Increment 2 doesn't depend on it.

**Handoff:** tech-lead (Phase 3), Increment 2 only. Carry forward: the `appointments` design, `ordinations.status`, the template migration + which office(s) to seed, the binding, audit keys, and the explicit non-scope of the downward read.

---

# Phase 3 — Technical Design (tech-lead)

**Scope:** Increment 2 only (ministry credentials & pastoral appointments), per DECISION-112. Q1 (managed-congregation downward read) is explicitly out of scope — carried below only as a named non-goal.

## Summary

A presbytery clerk gets one admin tree, `/o/[slug]/admin/credentials`, to do two related jobs: record a minister's ordination-status changes (active/honorably-retired/on-leave/etc., via a new nullable `ordinations.status` column) and record who serves as pastor at a member congregation (a new presbytery-owned `appointments` table — a call, not a permission). Both write paths sit behind one new tier-1 permission, `credentials.manage`, bound at seed time to a brand-new presbytery-scoped Stated Clerk role template — the first `organization_type_scope = 'presbytery'` template row this codebase has ever shipped, using the already-wired `listTemplateRoles`/`adoptTemplate` machinery so no new admin UI is needed to grant it. The congregation-side read of a presbytery-recorded appointment is explicitly not built here (DECISION-112) — this increment is presbytery-side write/record only.

## Permissions & Flags

- **One key, not a split:** `credentials.manage` (module `officers`, tier 1) gates BOTH the ordination-status UI and the appointments UI. Justification: Phase 2 left the split open but named the DECISION-078 test as controlling either way — both actions are the same constitutional duty (register-keeping, G-3.0304) performed by the same office on the same page; a congregation never has a reason to grant "may record a call" without "may record ordination status" or vice versa. Splitting into `ordinations.manage` + `appointments.manage` would be two individually-justified permissions binding to the identical role for the identical reason — the same one-key-at-a-time accretion pattern this codebase's own decisions (DECISION-101, DECISION-106) treat as a smell when the two capabilities never diverge in practice. Revisit if a future increment needs a holder of one without the other (e.g., a read-only credentials-viewer role).
- **Default role binding:** a new presbytery-scoped template role, `presbytery_stated_clerk` (constitutional, protected, `organization_id IS NULL`, `organization_type_scope = 'presbytery'`) — deliberately a DIFFERENT key from the congregation-scoped `stated_clerk` (org-scoped, fixture-only, Alder Creek's Tobias Renwick) to avoid ever reading as the same role across two different courts with two different permission sets; `(organization_id, key)` non-uniqueness across NULL rows means they *could* share a literal key without a DB conflict, but a distinct key removes any doubt for the next reader of `app_roles`. Carries `credentials.manage` only in this increment (a presbytery adopting the template via the existing "adopt template" UI gets exactly this one permission; nothing else is bundled in).
- **Flag:** `org_portal.credentials`, seeded off, `type: "flag"`, mirroring `org_portal.officers`'s "ships dark until the page lands" precedent.
- **Not needed:** no new `FEATURES.*` platform-admin key — this is entirely tenant-side (permission + flag), no platform-admin surface.

## API Contract

All four exports live in a new `src/lib/credentials.ts` (see Component/Page Plan for the module-boundary justification), same shape as `src/lib/officers.ts`: one `withOrgContext()` transaction per export, `credentials.manage` checked first via a private `hasCredentialsManage()` helper, thrown exceptions reserved for genuine failure, every expected/denied outcome a typed result variant. Two co-located `actions.ts` server actions per write path, mirroring `admin/officers/actions.ts`'s `resolveActingIdentity()`-then-audit shape verbatim.

```ts
// --- Ordination status ---------------------------------------------------

export type CredentialsResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "forbidden" }
  | { kind: "invalid_target" }
  | { kind: "invalid_input"; message: string };

/** Every ordination row recorded at this org (presbytery), current + historical. */
async function listOrdinations(
  viewerPersonId: string,
  organizationId: string,
): Promise<CredentialsResult<OrdinationEntry[]>>;

export interface RecordOrdinationInput {
  personId: string;
  ministry: "ruling_elder" | "deacon" | "minister_of_word_and_sacrament";
  ordainedOn: string; // 'YYYY-MM-DD'
  minuteReference?: string;
}

/** New `ordinations` row, `status: 'active'`. Person must hold a CURRENT
 *  membership at this org (F21 shape) — see Edge Cases for the
 *  transferring-in-TE case this blocks. */
async function recordOrdination(
  viewerPersonId: string,
  organizationId: string,
  input: RecordOrdinationInput,
): Promise<CredentialsResult<{ ordinationId: string }>>;

export interface ChangeOrdinationStatusInput {
  ordinationId: string;
  status: "active" | "honorably_retired" | "on_leave" | "exempt_from_active_service" | "disciplined" | "removed" | "deceased";
  minuteReference?: string;
}

/** Updates `ordinations.status` on the EXISTING row — never `endedOn`/
 *  `endedReason` (those model true removal from ordered ministry; see
 *  DECISION-112 / Edge Cases). `status = 'removed'` and `endedOn` are
 *  deliberately independent — see Edge Cases for when each is used. */
async function changeOrdinationStatus(
  viewerPersonId: string,
  organizationId: string,
  input: ChangeOrdinationStatusInput,
): Promise<CredentialsResult<{ ordinationId: string }>>;

// --- Appointments ----------------------------------------------------------

export interface AppointmentEntry {
  appointmentId: string;
  personId: string;
  displayName: string;
  servingOrgId: string;
  servingOrgName: string;
  callType: "installed_pastor" | "designated_pastor" | "stated_supply" | "interim_pastor" | "temporary_supply" | "parish_associate";
  startsOn: string;
  endsOn: string | null;
  minuteReference: string | null;
}

/** Every appointment recorded at this org (presbytery), current + historical,
 *  joined against `organizations` for the serving-org display name. */
async function listAppointments(
  viewerPersonId: string,
  organizationId: string,
): Promise<CredentialsResult<AppointmentEntry[]>>;

export interface RecordAppointmentInput {
  personId: string;
  servingOrgId: string;
  callType: AppointmentEntry["callType"];
  startsOn: string; // 'YYYY-MM-DD'
  minuteReference?: string;
}

/** ORDER: gate → person is a CURRENT member of THIS org (F21) →
 *  `servingOrgId` parent-path check: `organizations.parentId = organizationId`
 *  AND `organizationType IN ('congregation','new_worshiping_community')`
 *  (Phase 1's "second org id" adversarial note — a plain client-supplied id
 *  is never trusted without this) → insert. No overlap constraint at the DB
 *  layer this increment (see Edge Cases) — app-level check-before-insert:
 *  refuse a second OPEN (`endsOn IS NULL`) appointment for the same person at
 *  the same `servingOrgId`, returned as `invalid_input`. */
async function recordAppointment(
  viewerPersonId: string,
  organizationId: string,
  actingUserId: string,
  input: RecordAppointmentInput,
): Promise<CredentialsResult<{ appointmentId: string }> | { kind: "invalid_target" }>;

export interface EndAppointmentInput {
  appointmentId: string;
  endsOn: string; // 'YYYY-MM-DD'
  endReason: string;
}

/** Sets `endsOn`/`endReason` on the existing row — never a delete, same
 *  discipline as `endOfficerTerm()`. */
async function endAppointment(
  viewerPersonId: string,
  organizationId: string,
  input: EndAppointmentInput,
): Promise<CredentialsResult<{ appointmentId: string }>>;

// --- Form options ------------------------------------------------------------

/** People: current memberships at this org (F21 shape, same as
 *  `getOfficerFormOptions`). servingOrgs: `organizations` rows where
 *  `parentId = organizationId` and type is congregation/NWC — the presbytery's
 *  own member list, not a bare `select * from organizations`. */
async function getCredentialsFormOptions(
  viewerPersonId: string,
  organizationId: string,
): Promise<CredentialsResult<{
  people: Array<{ personId: string; displayName: string }>;
  servingOrgs: Array<{ organizationId: string; name: string }>;
}>>;
```

Server actions (`src/app/(org)/o/[slug]/admin/credentials/actions.ts`): `recordOrdinationAction(slug, input)`, `changeOrdinationStatusAction(slug, input)`, `recordAppointmentAction(slug, input)`, `endAppointmentAction(slug, input)` — each resolves identity via the same `resolveActingIdentity()` shape, maps result kinds to copy, writes the matching audit event, `revalidatePath`.

## Data Model

**1. `ordinations.status` column** (`src/lib/db/domain/officers.ts`):

```ts
export const credentialStatus = pgEnum("credential_status", [
  "active",
  "honorably_retired",
  "on_leave",
  "exempt_from_active_service",
  "disciplined",
  "removed",
  "deceased",
]);
// on ordinations:
status: credentialStatus("status").notNull().default("active"),
```
Enum values adapted verbatim from `~/git/psvonline-portal/src/lib/db/schema.ts:98-106`'s `credentialStatusEnum` — proven prior art, no reason to diverge. Distinct from `endedOn`/`endedReason` (unchanged) per DECISION-112: those model true removal from ordered ministry; `status` models everything short of that.

**2. New `appointments` table** (`src/lib/db/domain/officers.ts`, the third "who serves in what capacity" shape in the file):

```ts
export const appointmentCallType = pgEnum("appointment_call_type", [
  "installed_pastor",
  "designated_pastor",
  "stated_supply",
  "interim_pastor",
  "temporary_supply",
  "parish_associate",
]);

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id") // the PRESBYTERY, forced (D1/F2)
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personId: uuid("person_id").notNull(),
    servingOrgId: uuid("serving_org_id") // plain FK — organizations is the
      .notNull()                          // one cross-tenant-readable
      .references(() => organizations.id), // structural table (§17)
    callType: appointmentCallType("call_type").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on"),
    endReason: text("end_reason"),
    minuteReference: text("minute_reference"),
    recordedBy: uuid("recorded_by").references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("appointments_org_person_idx").on(t.organizationId, t.personId),
    index("appointments_serving_org_idx").on(t.servingOrgId, t.startsOn, t.endsOn),
    unique("appointments_id_org_key").on(t.id, t.organizationId),
    foreignKey({
      columns: [t.personId, t.organizationId],
      foreignColumns: [memberships.personId, memberships.organizationId],
      name: "appointments_person_fk",
    }),
  ],
);
```
FORCE ROW LEVEL SECURITY + standard `tenant_isolation` policy (`organization_id = presby_current_org()`), same as every other tenant table in this file — no bespoke policy needed since the table is owned entirely by the presbytery and the congregation-side read is deferred. No DB-level overlap exclusion constraint (unlike `officer_terms_no_overlap`): a pastoral call carries none of the officer-terms quorum/minute-validity stakes that justified the GIST exclusion there, so an app-level check-before-insert (see API Contract) is proportionate — same reasoning DECISION-110 used for `group_memberships`.

**3. Permission-catalog row:** `credentials.manage` (module `officers`, tier 1).

**4. Presbytery-scoped template role + binding**, inserted directly (global catalog data, needs no organization to exist first — same idempotent-by-fixed-id shape as `drizzle/0032`'s `committee_chair` insert):

```sql
insert into app_roles (id, organization_id, organization_type_scope, key, name, role_kind, is_protected)
values ('00000000-0000-0000-0000-000000000002', null, 'presbytery',
        'presbytery_stated_clerk', 'Stated Clerk', 'constitutional', true)
on conflict (id) do nothing;

insert into app_role_permissions (role_id, permission_key)
values ('00000000-0000-0000-0000-000000000002', 'credentials.manage')
on conflict (role_id, permission_key) do nothing;
```

**Migration filename — VOLATILE, pencil only:** next plausible free number is **`0035_presby_ministry_credentials.sql`**. `ls drizzle/` at design time shows only through `0034`, but per the task brief, a children's-ministry pipeline may also be penciling `0035` and the events pipeline is claiming a number concurrently — this number is **not reserved**. database-admin MUST re-run `ls drizzle/` immediately before writing the file and follow `0032`'s own precedent (renumber and note the collision in the migration's header comment, exactly as `0032`'s header documents its own 0031→0032 renumbering) if `0035` is taken by the time Phase 4 starts.

## Component / Page Plan

**One tree, two segments** (Phase 2 left this open): `/o/[slug]/admin/credentials/` holds both the ordinations list/form and the appointments list/form as two sections on one page (mirroring the officers tree's single-page "roster + add term" shape) rather than two separate route segments — the two jobs share one permission, one form-options query (people + serving orgs), and one clerk's mental model ("manage this minister's standing"), so a second segment would only add navigation, not clarity. Revisit if either section grows enough to need its own detail sub-route (`officers` did, for `/officers/[personId]`) — not warranted at this increment's scope.

- **Pages to create:**
  - `src/app/(org)/o/[slug]/admin/credentials/page.tsx` — server component, `resolveOrgContext()` + flag + `credentials.manage` gate (mirrors `admin/officers/page.tsx`), renders both sections.
- **Components to create:**
  - `ordination-list.tsx` — current + historical ordinations, status badge.
  - `record-ordination-form.tsx` — client island, RHF+zod (already-approved deps, matching `officer-term-schema.ts`'s pattern) — new-ordination + change-status as two forms (or one form with a mode toggle; ux-developer's call at Phase 4, not load-bearing here).
  - `appointment-list.tsx` — current + historical appointments, grouped by serving org.
  - `record-appointment-form.tsx` / `end-appointment-dialog.tsx` — client islands, mirroring `add-officer-term-form.tsx` / `end-term-dialog.tsx` exactly (shadcn `Dialog`, no native confirm).
  - `credentials-states.tsx` — empty/error states, mirroring `officers-states.tsx`.
- **Files to modify:**
  - `src/lib/db/domain/officers.ts` — `credentialStatus` enum, `ordinations.status` column, `appointmentCallType` enum, `appointments` table.
  - `src/lib/audit.ts` — three new `AUDIT_ACTIONS` keys.
  - `scripts/seed.ts` — `org_portal.credentials` flag entry.
  - `src/lib/org-portal/tiles.ts` — new "Credentials" tile, `category: "operate"` (routine polity work, DECISION-105's own test), flag-gated.
  - `scripts/test-rls.sql` — new numbered section (27) for `appointments` FORCE RLS + isolation, following the `officer_terms` section (22)'s shape.
  - `scripts/seed-dev.sql` — a presbytery-side fixture role/grant so the feature is hand-walkable in dev (see Implementation Order note 2; NOT a live-DB-only insert this time, since Increment 2 is new schema and needs a committed fixture like every other permission-catalog feature in this session's history).

## Implementation Order

1. **Schema** (database-admin): `ordinations.status`, new `appointments` table + FORCE RLS + policy, `credentials.manage` permission row, `presbytery_stated_clerk` template row + binding — one migration, `db:push` on a dev branch first, then the hand-written SQL file (`0035_presby_ministry_credentials.sql` or renumbered per collision) applied the same direct-`psql` way Increment 0 confirmed is this project's actual practice. `scripts/test-rls.sql` section 27.
2. **`FEATURE_CATALOG`/flag + seed binding**: `org_portal.credentials` flag row in `scripts/seed.ts`; `scripts/seed-dev.sql` gets a presbytery fixture: extend `northern-reach`'s existing role-grant fixture (Increment 0's `dev_admin` at northern-reach is live-DB-only per its own note — this needs a COMMITTED seed-dev.sql grant of `presbytery_stated_clerk` via `adoptTemplate`'s equivalent seed-time insert, to a fixture person, so the feature is hand-walkable in CI/fresh-DB dev, not just the one operator's live DB).
3. **Server module + actions** (api-developer or full-stack — see Implementer): `src/lib/credentials.ts`, `actions.ts`.
4. **UI** (ux-developer or full-stack): the five components + page + tile.
5. **Audit events**: `ORDINATION_RECORDED` (new — not named in Phase 2's notes but needed: the FIRST ordinations write in this codebase, `officers.ts` never wrote to `ordinations` at all), `ORDINATION_STATUS_CHANGED`, `APPOINTMENT_RECORDED`, `APPOINTMENT_ENDED` — all `tenant.*` axis:
   - `ORDINATION_RECORDED: "tenant.ordination.recorded"`
   - `ORDINATION_STATUS_CHANGED: "tenant.ordination.status_changed"`
   - `APPOINTMENT_RECORDED: "tenant.appointment.recorded"`
   - `APPOINTMENT_ENDED: "tenant.appointment.ended"`
6. **Release notes entry** at Phase 6.

## Edge Cases & Risks

- **The transferring-in TE with no `people` row at this presbytery yet (Phase 1's flagged undefined case) — RULED: block with guidance, do not build a side-door create-person flow here.** `recordOrdination()`/`recordAppointment()` both require a CURRENT `memberships` row at this organization (F21 shape, matching every other write path in this codebase — `startOfficerTerm`, `grantRole`). If the person-select dropdown (`getCredentialsFormOptions`) doesn't list a transferring minister, that IS the correct signal: the clerk's actual next step is the existing member-creation path (`/o/[slug]/admin/members`, `people.manage`) to establish membership at the presbytery FIRST (mirrors how a real Presbyterian clerk works: membership transfer is itself a `roll_actions`/`presby_claim_person()` event, G-2.0402, and has to happen before a credential can attach to anyone). Building a "create person inline" affordance inside the credentials form would duplicate `people.manage`'s validation and bypass the roll entirely — the same shape of mistake `startOfficerTerm`'s own F21 discipline already refuses. The empty-dropdown state must say so explicitly, not just render empty: **"No one available to record. A minister must hold membership at this presbytery first — add them via Members."** with a link, not a dead end.
- **`status` vs. `endedOn` must read as clearly separate actions in the UI, not two paths to the same button** — Phase 2's own risk. `record-ordination-form.tsx`'s change-status control offers only the `credentialStatus` enum values (never "removed from ordained ministry" as a status option masquerading for `endedOn`); ending an ordination (the rare true-removal case) needs its OWN explicit control, separately labeled, with its own confirm copy naming the consequence ("this person will no longer show as ordained — this cannot be represented as retirement"). Concretely: two buttons on the ordination row, "Change status" (opens the status picker) and "End ordination" (opens a confirm dialog, mirrors `end-term-dialog.tsx`), never one dropdown mixing both action classes.
- **Overlap risk without a DB exclusion constraint:** `recordAppointment()`'s app-level check (refuse a second open appointment for the same person at the same `servingOrgId`) is a TOCTOU gap under concurrent writes — acceptable here (same risk profile DECISION-110 accepted for `group_memberships`, and pastoral appointments are a low-frequency, single-clerk-at-a-time write path in practice), but flagged for `docs/TODO.md` if this ever becomes a multi-admin-per-presbytery workflow.
- **`servingOrgId` parent-path validation must reject a non-member org, not just a wrong-org id** — the adversarial case is a congregation belonging to a DIFFERENT presbytery, not just a nonexistent id. The check is `organizations.parentId = organizationId` (this presbytery) AND `organizationType IN ('congregation', 'new_worshiping_community')` — both conditions, not either.
- **`getCredentialsFormOptions`'s `servingOrgs` list surfaces `platformStatus` (managed/unmanaged/invited) to the clerk** — legitimate per Phase 1's Adversarial Pass note ("a presbytery's congregation list showing `platform_status` is legitimate, presbytery-internal, not a public prober") — stated explicitly here so Phase 4/5 don't treat it as a leak.
- **Non-scope, restated for the implementer:** the congregation-side read of an appointment recorded about it (e.g., a vacant-pulpit indicator on the congregation's own admin) is NOT built this increment (DECISION-112). No cross-org RLS policy, no publication row. A congregation querying its own tenant tables today will not see who the presbytery has on file as its pastor — expected, not a bug, until Increment 3/4's publication mechanism exists.
- **test-rls.sql section 27** must assert: (a) `appointments` is FORCE RLS and isolated per-org like every other tenant table (no bypass by the table owner); (b) a presbytery's own `appointments` rows are readable/writable only under that presbytery's org context; (c) the `appointments_person_fk` composite FK actually rejects a `personId` with no matching `memberships` row at the stated `organizationId` (F2 proof, mirroring `officer_terms_person_fk`'s existing test).
- **360px:** both list views (ordinations, appointments) are narrow tables (person, ministry/call-type, status/dates) — same horizontal-scroll-not-reflow treatment Increment 0 already flagged as the existing, accepted pattern across Roles/Groups; not a new gap to solve here, but the two new forms (record-ordination, record-appointment) must be verified in a 390px browser per CLAUDE.md's Verify in a Browser invariant — dropdowns and date pickers are the actual risk class, not the tables.
- **e2e blast radius (existing specs this change could break):** none of the existing officers/roles/groups/directory e2e specs assert against `ordinations` or a new `appointments` table, and no existing UI reads `ordinations.status` (it doesn't exist yet) — so the `ordinations.status default 'active'` backfill is additive and no existing query needs to change. The one existing surface that DOES read `ordinations` today is `presby_officer_history()`/`getOfficerHistory()` in `src/lib/officers.ts` — confirmed NOT touched (that function reads `officer_terms`, not `ordinations`, despite the similar name) — so no loop-back risk there. `officers.test.ts`, `role-definitions.test.ts` (the `listTemplateRoles`/`adoptTemplate` type-filter), and `role-grants.test.ts` are the tests most likely to need a NEW presbytery-type-scope fixture case added (not broken, but exercised for the first time) — qa should confirm `role-definitions.test.ts` gets a `organization_type_scope = 'presbytery'` test case, since today's suite only proves the `NULL`-scope (`committee_chair`) path.

## Implementer

**Split: database-admin (schema) then full-stack-developer (server module + UI + actions + audit + flag/tile).** Not a three-way api/ux split — the session's own precedent for a feature this size (`groups-and-officers`, `role-permissions-admin`) is schema-first-then-one-implementer for tenant CRUD trees with one permission gate and no genuinely separable server/client complexity; a three-way split would hand off a ~4-file server module and a ~5-component UI across two agents for no coordination benefit, since both halves are driven by the same `CredentialsResult` variant shapes designed above. database-admin's Phase 4 commit is schema + `test-rls.sql` §27 only; full-stack-developer's commit is everything else (Implementation Order steps 2–6).

---

# Phase 4 — Implementation

## Increment 0 — Verify + Polish the Generic Portal for a Presbytery Org (full-stack-developer, 2026-08-26)

### Dev-DB Setup (Increment 0 prerequisite, not part of the walk itself)

The seeded presbytery fixture is `Presbytery of the Northern Reach` (slug
`northern-reach`, id `11111111-1111-1111-1111-111111111111`, `seed-dev.sql`).
Confirmed via `psql` against `MIGRATE_DATABASE_URL` that the live dev DB has
**no** other presbytery org and that `fpcw` has no parent (`parent_id` null) —
`northern-reach` is the only walkable presbytery.

To hand-walk it as `admin@presby.invalid` (session already at `/tmp/state.json`,
person `089501ee-b841-4fc5-b11f-941785a5f3a3`, previously only a member at
`fpcw`), replicated fpcw's exact `dev_admin` shape at the presbytery, **in the
live dev DB only, not `seed-dev.sql`** (matches the session's established
precedent):

1. `memberships` row: person `089501ee...` at `organization_id
   = 11111111-1111-1111-1111-111111111111`, `engagement_status = 'active'`,
   `current_roll = NULL` (mirrors fpcw's own dev-admin row — a portal account,
   not a roll member; this is why the directory's "1 member of 1" excludes
   Admin Fixture and is correct, not a bug).
   - The insert first tripped `presby_guard_membership_insert()` ("person
     already exists elsewhere; link through `presby_claim_person()`") because
     this person already holds a real membership at fpcw. Authorized via
     `select set_config('app.person_claim_authorized', '<person-id>', true)`
     inside the same transaction — the identical mechanism `seed-dev.sql` uses
     for D1's pastor (dual membership at presbytery + congregation).
2. `app_roles` row: `dev_admin` custom role, `organization_id = northern-reach`.
3. `app_role_permissions`: the same 14 keys fpcw's `dev_admin` holds
   (`branding.manage`, `groups.manage`, `officers.manage`, `roll.propose`,
   `roll.approve`, `org_features.manage`, `people.manage`,
   `directory.view_hidden`, `role_grants.manage`, `roles.manage`,
   `pastoral_notes.manage`, `demographics.manage`, `medical.manage`,
   `disabilities.manage`), **plus** `tickets.file` and `directory.view` (fpcw's
   row omits both; added here because the walk explicitly covers tickets and
   the base directory-read path).
4. `role_grants` row linking person → role at `northern-reach`,
   `grant_reason` naming this as dev-seed state for the Increment 0 walk.

All four inserts are **left in place** per the task's instruction (mirrors the
fpcw precedent; nothing here would confuse later testing — it is additive,
scoped to one dev-only fixture person, and Increment 2/3 will need presbytery-
scoped role/permission testing anyway). Nothing was added to `seed-dev.sql`.

### The Walk

Walked every surface listed in the task at 1280px and 390px via a throwaway
Playwright script (`storageState: /tmp/state.json`) against the running dev
server: home, directory (+ Rowan Thistlewood's person detail, + the Parishes
tab), admin hub, groups (list + the one non-derived group's detail), officers,
members, roles (+ the create-role form and its permission checklist), features,
branding, tickets, feedback.

### Findings — Fixed Here (Polish-class copy)

1. **`src/lib/org-portal/tiles.ts`** — the Directory tool-tile description read
   "Browse the congregation directory." Fixed to "Browse the directory." (the
   word "congregation" added nothing at any org type; every tile already reads
   generically otherwise).
2. **`src/lib/org-portal/tiles.ts`** — the Give-feedback tile description read
   "Share feedback about your congregation's portal." Fixed to "...your
   organization's portal."
3. **`src/lib/org-features.ts`** — both `ORG_FEATURE_CATALOG` entry
   descriptions ("Add & approve members", "Tiered sensitive information") said
   "Lets this congregation...". Fixed to "Lets this organization..." in both.
4. **`permissions.description` for `directory.view`** (DB-seeded catalog row,
   not a `schema.ts`/domain-file value) read "Browse the congregation
   directory" and surfaces verbatim in the Roles admin "create role" and
   "edit role" permission checklists for every org type. New hand-written
   migration `drizzle/0034_presby_directory_permission_copy.sql` (idempotent
   `UPDATE ... WHERE description = <old value>`) changes it to "Browse the
   directory". Journal entry (`drizzle/meta/_journal.json`) appended as idx 34.
   **Applied directly via `psql $MIGRATE_DATABASE_URL -f
   drizzle/0034_....sql`, not `npm run db:migrate`** — `db:migrate` was run
   first and hung/no-opped; `drizzle.__drizzle_migrations` shows only 10 rows
   recorded even though permissions from migrations 0018–0033 are all present
   in the live DB, confirming this project's hand-written migrations 0011+ are
   applied by direct `psql`, not the tracked runner, as a matter of established
   practice (pre-existing condition, not something this pass changed — also
   visible in the journal's own idx gap at 26–28). Noted in case a later
   `db:migrate` run against a fresh environment needs this file re-applied by
   the same direct-`psql` method.

No test files needed updates for any of the four fixes: every test that
references these exact strings (`portal-nav.test.tsx`, `tile-grid.test.tsx`,
`portal-footer.test.tsx`, `features-list.test.tsx`, `page.test.tsx`,
`role-grants.test.ts`, `role-definitions.test.ts`, `directory.test.ts`,
`find-person.test.ts`) constructs its own independent mock fixture object or
type-only import rather than asserting against the real `PORTAL_TILES` /
`ORG_FEATURE_CATALOG` / live-DB value, so none broke and none needed editing.
Confirmed by `npm test` (full suite, 2561 passed / 428 skipped, 0 failed).

### Findings — Structural (feed later increments, NOT fixed here)

1. **Officers surface is entirely session/diaconate-shaped, honestly so.** The
   "Add an officer term" office dropdown offers only Ruling Elder, Deacon,
   Clerk of Session, Moderator, Treasurer, Trustee — every one a congregation
   office. A presbytery is itself a court (it doesn't have a session or a
   diaconate to record) and needs different offices entirely (Stated Clerk,
   Moderator-of-Presbytery, Committee-on-Ministry chair, commissioner terms).
   The tile/page copy ("Record officer terms and view the session/diaconate
   roster.") was deliberately **left unchanged** — it accurately describes
   what the surface actually does today; softening the copy to sound generic
   while the office list stays congregation-only would be dishonest in the
   opposite direction. This is Increment 2's territory (Open Question 3: who
   seeds presbytery-shaped roles/offices).
2. **No Session/Diaconate derived court groups exist at the presbytery — and
   that's correct, not a bug.** `northern-reach` has zero `officer_terms`
   rows, so no court groups materialize. The one derived group that DOES exist
   ("Active Membership", `group_type = roster`) is driven by the membership
   roll, not by officer terms, and its generic "Automatic rosters — Generated
   automatically from officer terms and the membership roll" copy already
   degrades honestly to showing only what's actually there. No fix needed;
   confirms the groups feature's design already handles a court-less org type
   correctly. Feeds Increment 2 anyway, since a presbytery needs its OWN
   court-equivalent (commissioners/officers) surfaced somehow.
3. **No presbytery-scoped constitutional role templates exist.** The
   create-role page's "Or adopt a template" section offers exactly one
   template ("Committee Chair", generic) — nothing for Stated Clerk, Moderator,
   or Executive Presbyter. Confirms Phase 1 Gap "No presbytery-level
   constitutional roles seeded — prerequisite" (Open Question 3) by direct
   observation, not just inference.
4. **Members admin's empty state ("Member management isn't turned on for
   Presbytery of the Northern Reach yet.") is a legitimate untouched per-org
   toggle**, not a bug — `org_portal.members_create` defaults off per-org and
   nobody has turned it on for this fixture. Left off deliberately rather than
   toggled on, since flipping it wasn't necessary to observe the correct empty
   state and toggling dev-only feature state felt out of scope for a
   verification pass.
5. **Naming collision confirmed, not touched:** the seeded committee-type
   group is literally named "Commission on Alder Creek" (`group_type =
   committee`), sitting one page away from the (still UI-less)
   `administrative_commissions` table. This is exactly Phase 1's Open Question
   5 (psvonline's `committee_type='commission'` vs. presby's
   `administrative_commissions` — different concepts, same word). Fixture
   naming only; no code renders these as confusable today because
   `administrative_commissions` has no UI yet, but flagged for whoever builds
   that UI.
6. **Dense tables on mobile (Roles' "Who holds what"/"Role catalog", Groups'
   list) horizontally scroll rather than reflow at 390px.** Pre-existing,
   general-purpose responsive pattern used across the whole admin surface, not
   presbytery-specific and not a regression — noted for completeness, not
   fixed (out of this pass's scope; would need its own Polish pass across all
   org types if pursued).

### Files Created

- `drizzle/0034_presby_directory_permission_copy.sql` — updates the
  `directory.view` permission's seeded `description` from "Browse the
  congregation directory" to "Browse the directory".

### Files Modified

- `src/lib/org-portal/tiles.ts` — Directory and Give-feedback tile
  descriptions de-congregationalized (see Findings above).
- `src/lib/org-features.ts` — both `ORG_FEATURE_CATALOG` entry descriptions
  de-congregationalized.
- `drizzle/meta/_journal.json` — appended idx 34 for the new migration.

## Schema Changes

- No table/column changes. One data-only migration
  (`0034_presby_directory_permission_copy.sql`) updating a seeded catalog row's
  `description` text. Applied via direct `psql -f` against
  `MIGRATE_DATABASE_URL` (see note above on why `npm run db:migrate` was not
  the effective path in this environment).

## Audit Events

- None — copy-only changes, no security-sensitive mutation.

## Test Results

- `npm run typecheck`: PASS (clean).
- `npm test`: PASS — 187 test files passed, 19 skipped; 2561 tests passed, 428
  skipped; 0 failed.
- `npm run check` (audit-coverage, sql-date, deps-drift, brand-scope): all four
  PASS.

## Implementer Notes

This was a verification+polish pass, not new API surface — no server actions
or routes were added, so there was nothing new to unit-test beyond the four
copy-string changes, and no existing test asserted the old strings via a live
import (all were independent mock fixtures), so no test file edits were
needed. The dev-DB setup (membership + role + grant at `northern-reach` for
`admin@presby.invalid`) is intentionally left in place, matching the session's
own precedent at fpcw — a future increment (2/3) will want this exact kind of
fixture anyway to test presbytery-scoped permission work.

---

## Increment 2 — Ministry Credentials & Pastoral Appointments, Schema Commit (database-admin, 2026-08-26)

### Migration Number

Phase 3 penciled `0035_presby_ministry_credentials.sql`. A fresh `ls drizzle/`
at the start of this commit found BOTH 0035 and 0036 already claimed on
disk — `0035_presby_children_ministry_permission.sql` (children's ministry's
own database-admin commit) and `0036_presby_events.sql` (the events
pipeline's), neither reflected in Phase 3's own read. This commit claims
**`0037_presby_ministry_credentials.sql`**, the next actually-free number,
authored as 0037 from the start (mirroring `0036`'s own precedent for the
identical situation one collision earlier) rather than renumbered after the
fact. `drizzle/meta/_journal.json` gets a matching idx-37 entry.

### Schema Changes

- **`src/lib/db/domain/officers.ts`**:
  - `credentialStatus` pgEnum (`active | honorably_retired | on_leave |
    exempt_from_active_service | disciplined | removed | deceased`), values
    adapted verbatim from psvonline-portal's `credentialStatusEnum`.
  - `ordinations.status` — new column, `credentialStatus`, `notNull().default("active")`.
    Distinct from `endedOn`/`endedReason` (unchanged): those model TRUE
    removal from ordered ministry; `status` models everything short of that
    (DECISION-112).
  - `appointmentCallType` pgEnum (`installed_pastor | designated_pastor |
    stated_supply | interim_pastor | temporary_supply | parish_associate`).
  - New `appointments` table — the third "who serves in what capacity" shape
    in this file. `organizationId` (the PRESBYTERY, forced — composite person
    FK `(personId, organizationId) -> memberships`, F2), `servingOrgId`
    (plain FK to `organizations`, legal per schema-design.md section 17),
    `callType`, `startsOn`/`endsOn`/`endReason`, `minuteReference`,
    `recordedBy`/`recordedAt`. Indexes on `(organizationId, personId)` and
    `(servingOrgId, startsOn, endsOn)`. `unique(id, organizationId)`. No DB
    overlap-exclusion constraint (DECISION-110's precedent for
    `group_memberships` — app-level check-before-insert, next commit's job).

- **`drizzle/0037_presby_ministry_credentials.sql`** (hand-written, idempotent):
  1. `credential_status` + `appointment_call_type` enum types — the FIRST
     hand-written migration this session to introduce a new enum type
     (every prior hand-written table addition used plain `text`); guarded
     with the standard `DO $$ ... EXCEPTION WHEN duplicate_object THEN
     null; END $$;` idiom (Postgres has no `CREATE TYPE IF NOT EXISTS`).
  2. `ordinations.status` column (`ADD COLUMN IF NOT EXISTS`).
  3. `appointments` table (`CREATE TABLE IF NOT EXISTS`) + two indexes +
     FORCE ROW LEVEL SECURITY + the standard `tenant_isolation` policy
     (`organization_id = presby_current_org()`) + `grant select, insert,
     update, delete` to `presby_app, presby_platform` — matching every
     tenant table added since the 0009 loop was frozen.
  4. `credentials.manage` permission-catalog row (module `officers`, tier
     1) — one key gates both the ordination-status UI and the appointments
     UI (DECISION-116 ruling 1).
  5. `presbytery_stated_clerk` TEMPLATE role row (`id
     00000000-0000-0000-0000-000000000002`, `organization_id NULL`,
     `organization_type_scope 'presbytery'`) + its `app_role_permissions`
     binding to `credentials.manage` — the first
     `organization_type_scope = 'presbytery'` template shipped, seeded via
     the already-wired `listTemplateRoles`/`adoptTemplate` machinery
     (DECISION-109), so no new admin UI is needed to grant it. Deliberately
     a DIFFERENT key from the congregation-scoped `stated_clerk`
     (DECISION-116 ruling 2).

- **`scripts/seed-dev.sql`** (append-only, landed directly ahead of the
  file's trailing `commit;` — flagged with a CONCURRENCY NOTE in the file
  itself, since a concurrent events-model pipeline may also be appending at
  that same seam):
  - A NEW fixture person, **Idris Calloway** (`c0000000-...-00000000a`) — not
    a reuse of Rowan Thistlewood (the only other person with a membership at
    the presbytery), mirroring the `children_ministry_admin` block's own
    preference for a person holding zero roles today. Membership at
    northern-reach + a matching `opening_balance` roll_action (same
    `presby_roll_cache_drift()` discipline every membership row added to this
    file follows).
  - The ORG-SCOPED adopted copy of `presbytery_stated_clerk` at northern
    reach (`f0000000-...-00000000e`) + its `credentials.manage` binding +
    a `role_grants` row to Idris Calloway — the seed-time equivalent of
    clicking "adopt template," so the feature is hand-walkable on a fresh
    DB, not just live-DB state.
  - One real `appointments` fixture row: Rowan Thistlewood (already serving
    Alder Creek per the D1 fixture's own second-membership row), recorded by
    the presbytery, `call_type = installed_pastor`, `starts_on` matching his
    existing `installed_pastor` role-grant date for internal consistency.

- **`scripts/test-rls.sql`** — new **section 28** (events claimed 27; a fresh
  `ls`-equivalent read of the file confirmed 27 was the last section before
  writing). New `\set` constants: `CREDENTIALS_CLERK`,
  `PRESBYTERY_STATED_CLERK_TEMPLATE_ROLE`, `PRESBYTERY_STATED_CLERK_ROLE`,
  `APPOINTMENT`. Five things proved:
  (a) `credentials.manage` catalog row; (b) the global template row
  (visible from both a presbytery AND a congregation context — the widened
  `app_roles` SELECT policy is type-scope-agnostic) + its binding + the
  org-scoped adopted copy resolving the permission for its holder at the
  presbytery and nothing at a congregation; (c) `ordinations.status`
  defaults `active` for pre-existing rows, and the enum genuinely rejects an
  out-of-set value; (d) `appointments` FORCE RLS isolation proved against a
  **second real presbytery minted ad hoc inside a rolled-back transaction**
  (the fixture only ships one presbytery, and Phase 1's literal ask was
  "presbytery A's appointment invisible to presbytery B," not merely a second
  congregation) — blanket count, known-id read, AND a query by the known
  `servingOrgId` (Alder Creek) all return zero from presbytery B, proving
  isolation keys off `organization_id` alone, never `servingOrgId`; the write
  side (cross-presbytery insert) is rejected too; Alder Creek itself (the
  congregation named as `servingOrgId`) also has no read of the appointment,
  restating the non-goal as a proof; (e) `appointments_person_fk` composite
  FK (F2) rejects a person with no membership at the stated organization.
  **All 17 assertions pass**, run standalone against `APP_DATABASE_URL`.

### The Broken Pre-Existing Fixture-Count Assertion

Section 2's `'presbytery: sees only its own member'` assertion (now
`'...own members'`, plural) needed a genuine, mechanical update independent
of any live-DB drift: this commit's own Idris Calloway addition legitimately
bumps the presbytery's people/memberships/roll_actions counts from 1 to 2 on
any FRESH database seeded from `scripts/seed-dev.sql` alone — the same kind
of incremental bump this file's own section-3 comment already documents for
earlier increments. **That part I fixed.**

Running the full suite against the actual shared/live dev database still
halts at that exact assertion — `expected 2, got 3` — because of the
UNTRACKED third membership row (`admin@presby.invalid` at northern-reach)
today's earlier presbytery-portal walk added live-DB-only, per the task's own
note ("that's expected, don't reconcile it"; Increment 0's own Phase 4 entry
confirms it was deliberately never carried into `seed-dev.sql`). Hardcoding
`3` to match that one session's live drift would be wrong on the next fresh
seed, so **I left the +1 for the drift unreconciled** and documented both
numbers (2 vs. 3, and why) directly in the assertion's own comment.

Continuing past that point (with a local, uncommitted patch, for my own
verification only) surfaced ONE further pre-existing, unrelated failure:
`presby_roll_cache_drift()` (section 10, line ~386) reports one drifted
membership row belonging to `organization_id 4315666c-...` /
`person_id f1000000-...-000011` — neither northern-reach, Idris Calloway, nor
Rowan Thistlewood. Confirmed via direct query against `MIGRATE_DATABASE_URL`
that this drift predates and is wholly unrelated to this commit — some other
work-log's own live-DB state, never reached in any prior run because the
suite always halted earlier. Flagged for whoever next runs the full suite
end-to-end; not fixed here (out of this commit's scope, and not the
assertion the task named). A further attempt to run the WHOLE suite twice
against the same live DB (to probe past that second failure) hit a THIRD,
purely environmental issue — a duplicate-key error on `organization_profiles`
from a section that intentionally `commit;`s real rows — confirming this
suite is not designed to be re-run twice against the same already-seeded
database; not a defect, just a limit of ad hoc local verification beyond
this commit's own new section.

### Migration Mode

**`db:generate`** was not used — `db:generate` is broken on a pre-existing
snapshot collision (`docs/TODO.md`), so every migration past 0012 in this
codebase is hand-authored. Applied the new migration directly via `psql -f`
against `MIGRATE_DATABASE_URL` (this project's established practice for
hand-written migrations, per `drizzle/0034`'s own note), then applied the
`scripts/seed-dev.sql` fixture addition the same way (extracted just the new
block, since the file's plain `INSERT`s aren't safely re-runnable in full
against an already-seeded DB).

### Test Results

- `scripts/test-rls.sql` section 28: 17/17 assertions pass, run standalone
  against `APP_DATABASE_URL`.
- `npm run typecheck`: PASS (clean).
- `npm run check:sql-date`: PASS (clean).
- `npx vitest run src/lib/db`: 26/26 pass (existing schema-adjacent unit
  tests unaffected).

### Files Created

- `drizzle/0037_presby_ministry_credentials.sql`

### Files Modified

- `src/lib/db/domain/officers.ts` — `credentialStatus`/`appointmentCallType`
  enums, `ordinations.status` column, new `appointments` table.
- `drizzle/meta/_journal.json` — appended idx 37.
- `scripts/seed-dev.sql` — Idris Calloway (person + identifier + membership +
  roll_action), the org-scoped adopted `presbytery_stated_clerk` role +
  binding + grant, one real `appointments` fixture row.
- `scripts/test-rls.sql` — new `\set` constants; new section 28; section 2's
  fixture-count assertions updated for the legitimate Idris Calloway bump
  (drift caveat documented in place, not reconciled).

### Handoff to Next Implementer (full-stack-developer)

New surface available: `appointments` table (import from
`@/lib/db/domain/officers` — re-exported through the domain `index.ts`, no
new export wiring needed), `ordinations.status` column +
`credentialStatus`/`appointmentCallType` enums, `credentials.manage`
permission key, and `presbytery_stated_clerk` template role (global +
northern-reach's adopted copy, bound to Idris Calloway in the dev fixture).
Remaining Implementation Order steps (2–6): `org_portal.credentials` flag in
`scripts/seed.ts`; `src/lib/credentials.ts` + `actions.ts` per the Phase 3 API
Contract; the five UI components + page + tile; the four `AUDIT_ACTIONS` keys
(`ORDINATION_RECORDED`, `ORDINATION_STATUS_CHANGED`, `APPOINTMENT_RECORDED`,
`APPOINTMENT_ENDED`); release notes at Phase 6.

Local apply: `npm run db:push` was NOT used (this schema shipped as a
versioned migration, applied directly). To reproduce locally: `psql
"$MIGRATE_DATABASE_URL" -f drizzle/0037_presby_ministry_credentials.sql`,
then re-run `scripts/seed-dev.sql` on any FRESH database (the live shared dev
DB already has the new fixture rows applied directly, matching this session's
established practice for incremental seed-dev.sql additions to an
already-seeded environment).

---

## Increment 2 — Ministry Credentials & Pastoral Appointments, Server + UI Commit (full-stack-developer, 2026-08-27)

Scope: Implementation Order steps 2–6 (Phase 3) — the `org_portal.credentials`
flag, `src/lib/credentials.ts` + co-located `actions.ts`, the five admin
components + page + tile, the four `AUDIT_ACTIONS` keys, tests for all of the
above. Schema (migration 0037, `test-rls.sql` §28) was database-admin's prior
commit and is unchanged here.

### API Surface — `src/lib/credentials.ts`

Same shape as `src/lib/officers.ts` per Phase 3's instruction: one
`withOrgContext()` transaction per export, `credentials.manage` checked first
via a private `hasCredentialsManage()` gate, typed `CredentialsResult<T>`
variants for every expected/denied outcome, thrown exceptions reserved for
malformed enum/date input. Seven exports, matching the API Contract exactly:
`listOrdinations`, `recordOrdination`, `changeOrdinationStatus`,
`listAppointments`, `recordAppointment`, `endAppointment`,
`getCredentialsFormOptions`. No `organizationId`/`actingUserId` ever
originates from client input — both are re-resolved from the URL slug inside
`actions.ts`'s `resolveActingIdentity()`, verbatim the same helper
`admin/officers/actions.ts` defines.

**`recordAppointment`'s parent-path check (Phase 2's adversarial requirement)**
is exactly as designed: `servingOrgId` must resolve to an `organizations` row
with `parentId = organizationId` (THIS presbytery) AND
`organizationType IN ('congregation', 'new_worshiping_community')` — both
conditions, not either. A nonexistent id and a real congregation belonging to
a *different* presbytery both return `invalid_target`, proven as two distinct
test cases (`src/lib/credentials.test.ts`), not conflated into one.

**Both `recordOrdination` and `recordAppointment` require a CURRENT
`memberships` row at this org (F21 shape)** before writing — the
transferring-in-minister case is blocked with the empty-dropdown signal
Phase 3 specified, never a side-door create-person flow.

**Resolving an ambiguity between Phase 3's API Contract and its Edge Cases**
(documented in full in `credentials.ts`'s own header, repeated here because
it is load-bearing for QA's read of the audit trail): the API Contract lists
exactly one ordination-status write path, `changeOrdinationStatus()`,
accepting the full seven-value `credentialStatus` enum including `"removed"`.
The Edge Cases section separately calls for TWO distinct UI controls —
"Change status" and "End ordination" — so the two never read as one dropdown
mixing action classes. Both call the SAME `changeOrdinationStatus()`/
`changeOrdinationStatusAction()`: the "Change status" picker offers every
status except `"removed"` (`credential-labels.ts`'s
`CHANGEABLE_CREDENTIAL_STATUSES`); "End ordination" is a separate confirm
dialog that always submits `status: "removed"`. One backend function, one
audit key (`ORDINATION_STATUS_CHANGED`), two UI entry points with different
weight/copy — never two backend functions for a change that only ever
touches the `status` column. `endedOn`/`endedReason` are never written by
this module, in either path.

**No DB-level overlap-exclusion constraint on `appointments`** (per the
schema commit) — `recordAppointment()` runs an app-level check-before-insert
refusing a second OPEN appointment for the same person at the same
`servingOrgId`, returned as `invalid_input` naming both the person and the
congregation. Proven TOCTOU-accepted per DECISION-110's precedent, same as
`credentials.ts`'s own header documents.

**`getCredentialsFormOptions`'s `servingOrgs` entries carry `platformStatus`**
(managed/unmanaged/invited) — this extends beyond the literal type sketched
in Phase 3's API Contract snippet, which omitted the field, but Phase 3's own
Edge Cases section explicitly anticipates and licenses it ("stated explicitly
here so Phase 4/5 don't treat it as a leak"). Implemented as designed;
flagging the divergence from the literal contract snippet so QA doesn't
flag it as scope creep.

### Server Actions — `src/app/(org)/o/[slug]/admin/credentials/actions.ts`

Four actions: `recordOrdinationAction`, `changeOrdinationStatusAction`,
`recordAppointmentAction`, `endAppointmentAction` — each resolves identity via
`resolveActingIdentity()`, maps every `CredentialsResult` denial to the copy
named in Phase 3's contract, writes the matching audit event on the `ok`
branch only, and calls `revalidatePath("/o/<slug>/admin/credentials")`.
`changeOrdinationStatusAction` is the one action shared by two UI entry
points (see above) — its audit metadata always includes the submitted
`status`, so an audit reader can tell a routine status change from an
End-ordination event by the metadata value alone (`status: "removed"`),
without a distinct action key.

### UI — `src/app/(org)/o/[slug]/admin/credentials/`

One tree, two sections on one page, per Phase 3's Component/Page Plan:

- `page.tsx` — server component; repeats the `(org)` auth pattern in full
  (auth → `resolveOrgContext` → `assertOrgAccess` → flag check → three reads
  → render), mirroring `admin/officers/page.tsx` exactly. Flag check runs
  before any `credentials.ts` read.
- `credential-labels.ts` — the UI-safe, type-only-import duplicate of
  `credentials.ts`'s vocabulary constants (mirrors `office-labels.ts`'s
  documented reason: `credentials.ts` is `server-only`). Also defines
  `CHANGEABLE_CREDENTIAL_STATUSES` (all seven statuses minus `"removed"`) —
  the mechanism enforcing the status-vs-removal UI separation.
- `credential-schema.ts` — client-side zod validation for both forms,
  mirroring `officer-term-schema.ts`/`event-schema.ts`'s pattern; server-side
  is still the authoritative gate.
- `credentials-states.tsx` — the three non-data-bearing states (flag-off,
  forbidden, load-error), mirroring `officers-states.tsx` verbatim.
- `ordination-list.tsx` / `appointment-list.tsx` — server-component tables,
  same mobile-legibility treatment as `officer-roster.tsx` (dense columns
  drop below `sm:`, horizontal scroll at 360px — the accepted, pre-existing
  pattern, not a new gap).
- `record-ordination-form.tsx` / `record-appointment-form.tsx` — client
  islands, RHF+zod, unsaved-changes guard, `RequiredMark`, select chevrons —
  full session convention set. Both render the exact "no one available to
  record... add them via Members" empty-state copy Phase 3 named verbatim
  when the person list is empty; `record-appointment-form.tsx` also handles
  a presbytery with zero member congregations as a separate named empty
  state.
- `change-status-dialog.tsx` (plain `Dialog`, non-destructive) and
  `end-ordination-dialog.tsx` (`AlertDialog`, destructive-reading, disabled
  once already `"removed"`) — THE TWO SEPARATE CONTROLS Phase 3's edge case
  requires, verified both in the component test and live in the browser.
- `end-appointment-dialog.tsx` — mirrors `end-term-dialog.tsx`: `AlertDialog`,
  names both the person and the serving congregation, never a delete.

### Audit — `src/lib/audit.ts`

Four keys added (one beyond DECISION-112's own three-key list — see note
below), each documented with its metadata shape:

- `ORDINATION_RECORDED: "tenant.ordination.recorded"` — a Phase 3 addition:
  the FIRST application write path to `ordinations` this codebase has ever
  had, so it gets its own audited event (same tier as
  `OFFICER_TERM_STARTED`), rather than shipping the first-ever write to a
  constitutional register unaudited.
- `ORDINATION_STATUS_CHANGED: "tenant.ordination.status_changed"` — fires on
  every `changeOrdinationStatus()` call, including `status: "removed"`
  submissions from the End-ordination control (see above).
- `APPOINTMENT_RECORDED: "tenant.appointment.recorded"`
- `APPOINTMENT_ENDED: "tenant.appointment.ended"`

`audit.test.ts`'s frozen-string snapshot updated with all four (67 total
entries now, test passing).

### Flag + Tile

- `scripts/seed.ts` — `org_portal.credentials` flag entry added, seeded
  `enabled: false`, mirroring `org_portal.officers`'s block verbatim,
  appended alongside (not overwriting) the events pipeline's own
  `org_portal.events` entry that landed concurrently.
- `src/lib/org-portal/tiles.ts` — the "Credentials" tile, `category:
  "operate"` per Phase 3's Component/Page Plan (explicit, not a guess needed
  here), `flagKey: "org_portal.credentials"`. `tiles.test.ts`'s snapshot
  tests (known-seeded-flag-keys set, tile-key list, category assertions,
  independent-flag test) all updated.

### Tests

- `src/lib/credentials.test.ts` — DB-backed integration suite, same harness
  as `officers.test.ts` (dynamic imports in `beforeAll`, `hasDb` skip-guard,
  self-contained fixture, F16 derived-roster-group boilerplate, the
  trigger-disable teardown convention `children.test.ts`/`officers.test.ts`
  document for `group_memberships_reject_derived`). Two presbyteries
  (`presbyteryA` general-purpose, `presbyteryB` proving the parent-path
  case), two member-congregation types (`congregation` +
  `new_worshiping_community`) under `presbyteryA`, and one congregation
  under the WRONG presbytery (`congregationOutsideB`). Covers: the
  permission gate on all seven exports; F21 shape (lapsed member, cross-org
  member) for both write paths; the parent-path rejection (wrong-presbytery
  congregation AND nonexistent id, as two distinct cases); the
  open-appointment collision guard (blocks, then succeeds once the prior
  appointment is ended); `changeOrdinationStatus` never touching
  `endedOn`/`endedReason`, including the `status: "removed"` case;
  `endAppointment`'s no-delete/date-ordering validation;
  `getCredentialsFormOptions`'s people/servingOrgs scoping including
  `platformStatus`; thrown-exception propagation for malformed
  dates/enums and a fully-unrelated viewer. **36/36 passing**, run standalone
  against a real Postgres connection (`npx dotenv -e .env.local -- npx
  vitest run src/lib/credentials.test.ts`).
- `src/app/(org)/o/[slug]/admin/credentials/actions.test.ts` — mocked
  orchestration tests at the `@/lib/credentials` boundary, mirroring
  `admin/officers/actions.test.ts`: identity resolution never trusts client
  input, every `CredentialsResult` kind maps to the correct `ActionResult`,
  audit fires only on `ok`, and — the one assertion this file adds beyond
  the officers precedent — `changeOrdinationStatusAction` fires the
  identical `ORDINATION_STATUS_CHANGED` key for both a routine status change
  and a `status: "removed"` submission, proving the two UI entry points
  really do share one action.
- `src/app/(org)/o/[slug]/admin/credentials/page.test.tsx` — mirrors
  `admin/officers/page.test.tsx`'s ordering/error-handling contract
  (flag-before-permission, `OrgAccessError` re-thrown vs. swallowed, the
  four-way miss response), extended for three reads instead of two.
- `src/app/(org)/o/[slug]/admin/credentials/ordination-list.test.tsx` — the
  test pinning Phase 3's named edge case directly: a current/retired
  ordination always shows both "Change status" AND "End ordination" as
  separate controls; a `"removed"` ordination shows the destructive badge
  and withholds "End ordination" (already ended) while keeping "Change
  status" available; the status picker's own option list never contains
  "Removed from Ordered Ministry".
- `src/app/(org)/o/[slug]/admin/credentials/credentials-states.test.tsx` —
  the three-states convention test, mirroring `officers-states.test.tsx`.
- `src/app/(org)/o/[slug]/admin/credentials/credential-schema.test.ts` —
  client-side zod validation (required fields, length limit, enum
  rejection) for both schemas.

### Test Results

- `npm run typecheck`: PASS (clean).
- `npx dotenv -e .env.local -- npx vitest run src/lib/credentials.test.ts`:
  **36/36 PASS** (DB-backed).
- `npx vitest run "src/app/(org)/o/[slug]/admin/credentials/" src/lib/audit.test.ts src/lib/org-portal/tiles.test.ts`:
  **87/87 PASS**.
- `npm test` (full suite): **209 files / 2766 tests passed, 0 failed** (22
  files / 515 tests skipped — DB-backed suites, expected with no
  `DATABASE_URL` in this run).
- `npm run check` (audit-coverage, sql-date, deps-drift, brand-scope): all
  four PASS.
- `npm run build`: PASS — `/o/[slug]/admin/credentials` registered as a
  dynamic route.

### Live Verification (real dev server, real browser, `/tmp/state.json`)

**Dev-DB setup** (both changes are additive to the already-running dev
server's live DB, matching Increment 0's own precedent for this kind of
setup):
1. Granted `credentials.manage` to the existing `dev_admin` custom role at
   `northern-reach` (`app_role_permissions` insert,
   `role_id = a1a1a1a1-0000-0000-0000-000000000001`) — this is the SAME
   `dev_admin` role Increment 0 created for `admin@presby.invalid` at this
   org, now carrying one more permission.
2. Inserted the `org_portal.credentials` feature-flag row directly
   (`enabled = true`) — `scripts/seed.ts`'s new entry hadn't been applied to
   the live dev DB yet (seed.ts only runs at `npm run db:seed` time, not on
   every dev-server boot), so a direct insert was necessary to unblock the
   walk, mirroring Increment 0's own note about direct dev-DB inserts for
   flags/grants ahead of the next full reseed.

**The walk** (Playwright, `storageState: /tmp/state.json`,
`admin@presby.invalid` at `northern-reach`), at 1280px and 390px:
- Recorded an ordination for Idris Calloway (Minister of Word and Sacrament,
  1 May 2016) — toast, form reset, list updated on refresh.
- Changed that ordination's status to Honorably Retired via "Change status"
  — badge updated, `endedOn` never touched (confirmed via the row's own
  dashes in both the "Ordained"/removal-adjacent columns, matching the DB
  test's own assertion).
- Recorded a pastoral appointment for Idris Calloway at Alder Creek
  Presbyterian Church (Installed Pastor, 1 Jan 2026) — the serving-org
  dropdown showed all five of northern-reach's member congregations, each
  labeled with its `platformStatus` in parentheses (e.g. "Alder Creek
  Presbyterian Church (managed)", "Quillhaven Presbyterian Church
  (unmanaged)", "Marrowbone Presbyterian Church (invited)") — confirming the
  Phase 3 Edge Cases surfacing decision renders correctly, not just
  typechecks.
- Ended that appointment via "End appointment" (reason required, confirm
  dialog names both the person and the congregation) — the row now shows an
  end date with no action button, exactly the no-delete/historical-row
  treatment `AppointmentList`'s design specifies.
- At 390px: both tables horizontally scroll (the same accepted,
  pre-existing pattern Increment 0 flagged for Roles/Groups — not a new gap
  this increment needed to solve); both forms' dropdowns (with visible
  chevrons), date pickers, and buttons are fully usable with no horizontal
  overflow and no `min-h-11` violations. No console errors, no `pageerror`
  events, during the entire walk.

**Post-verification cleanup**: the three duplicate ordination rows and one
appointment row the walk script itself created for Idris Calloway (walk
artifacts, not seed fixture — confirmed against `scripts/seed-dev.sql`'s own
Idris Calloway block, which adds no ordination and only Rowan Thistlewood's
appointment) were deleted directly from the live dev DB after the walk, so
the shared dev database is left clean for the next agent. The
`credentials.manage` grant on `dev_admin` and the `org_portal.credentials`
flag (`enabled = true`) were deliberately LEFT IN PLACE, matching Increment
0's own precedent and this task's explicit instruction — the next phase
(QA) needs both live to verify.

### Files Created

- `src/lib/credentials.ts`
- `src/lib/credentials.test.ts`
- `src/app/(org)/o/[slug]/admin/credentials/page.tsx`
- `src/app/(org)/o/[slug]/admin/credentials/page.test.tsx`
- `src/app/(org)/o/[slug]/admin/credentials/actions.ts`
- `src/app/(org)/o/[slug]/admin/credentials/actions.test.ts`
- `src/app/(org)/o/[slug]/admin/credentials/credential-labels.ts`
- `src/app/(org)/o/[slug]/admin/credentials/credential-schema.ts`
- `src/app/(org)/o/[slug]/admin/credentials/credential-schema.test.ts`
- `src/app/(org)/o/[slug]/admin/credentials/credentials-states.tsx`
- `src/app/(org)/o/[slug]/admin/credentials/credentials-states.test.tsx`
- `src/app/(org)/o/[slug]/admin/credentials/ordination-list.tsx`
- `src/app/(org)/o/[slug]/admin/credentials/ordination-list.test.tsx`
- `src/app/(org)/o/[slug]/admin/credentials/appointment-list.tsx`
- `src/app/(org)/o/[slug]/admin/credentials/record-ordination-form.tsx`
- `src/app/(org)/o/[slug]/admin/credentials/record-appointment-form.tsx`
- `src/app/(org)/o/[slug]/admin/credentials/change-status-dialog.tsx`
- `src/app/(org)/o/[slug]/admin/credentials/end-ordination-dialog.tsx`
- `src/app/(org)/o/[slug]/admin/credentials/end-appointment-dialog.tsx`

### Files Modified

- `src/lib/audit.ts` — four new `AUDIT_ACTIONS` keys.
- `src/lib/audit.test.ts` — frozen-string snapshot updated (four new
  entries).
- `scripts/seed.ts` — `org_portal.credentials` flag entry.
- `src/lib/org-portal/tiles.ts` — the "Credentials" tile.
- `src/lib/org-portal/tiles.test.ts` — snapshot/independence tests updated
  for the new tile.

### Schema Changes

None — this commit is server module + UI + audit + flag/tile only. Schema
(migration 0037, `test-rls.sql` §28) shipped in database-admin's prior
commit and is unchanged here.

### Handoff

Next: qa (Phase 5) for both Increment 0 (the walk-through) and Increment 2
in full. What to test in the browser: `/o/northern-reach/admin/credentials`
as `admin@presby.invalid` (`/tmp/state.json`) — record/change-status/end for
ordinations, record/end for appointments, the transferring-in-minister empty
state (temporarily revoke the membership fixture or use a fresh person with
no presbytery membership to see it — not exercised live this commit since
every fixture person already holds a presbytery membership), the
parent-path rejection (not reachable from the UI itself, since the
serving-org dropdown only ever lists this presbytery's own congregations —
covered instead by `credentials.test.ts`'s direct-call adversarial tests),
and 390px. Feature-gate audit for QA: `credentials.manage` gates the server
module (`src/lib/credentials.ts`), `org_portal.credentials` gates the page
(`page.tsx`) — both present and correctly ordered (flag before permission).

---

## Phase 4 — loop-back (missing scope test) (full-stack-developer, 2026-08-27)

**Closes:** Phase 5's named FAIL — Phase 3's Edge Cases section required a
regression test proving the `organization_type_scope` filter shared by
`listTemplateRoles()` (`role-definitions.ts:432-438`) and `adoptTemplate()`
(`role-definitions.ts:791-796`) actually excludes a presbytery-scoped
template from a congregation's view/adoption and includes it for a
presbytery's — no test file anywhere exercised the non-null-scope path.

**Added:** one new nested `describe("listTemplateRoles —
organization_type_scope filtering")` block in
`src/lib/role-definitions.test.ts:600-761` (self-contained fixtures: its own
`beforeAll`/`afterAll` seed a presbytery org, a presbytery-context caller
holding `roles.manage`, and a self-seeded presbytery-scoped template row —
not the live migration-0037 `presbytery_stated_clerk` row, matching this
file's existing convention of not depending on migration-seeded fixed-id
rows). Three tests:

- `role-definitions.test.ts:718` — a congregation-context caller
  (`adminPerson`/`orgA`) does NOT see the presbytery-scoped template in
  `listTemplateRoles()`'s result, but DOES see the NULL-scope template
  (`templateRoleId`, this file's own stand-in for `committee_chair`).
- `role-definitions.test.ts:729` — a presbytery-context caller
  (`presbyteryAdminPerson`/`orgPresbytery`) DOES see the presbytery-scoped
  template, alongside the NULL-scope one.
- `role-definitions.test.ts:741` — `adoptTemplate()` rejects adopting the
  presbytery-scoped template from a congregation context
  (`kind: "template_not_found"`), and a direct follow-up query confirms no
  `app_roles` row was written at `orgA` for the attempted key — nothing
  written on rejection.

**Production code:** unchanged. QA's own direct-SQL verification that the
filter is currently correct held — all three new tests pass against the
existing, un-modified `role-definitions.ts`; no fix was needed.

**Test results:**
- `npm run typecheck`: PASS (clean).
- `npx dotenv -e .env.local -- npx vitest run src/lib/role-definitions.test.ts`
  (DB-backed, standalone): **43/43 PASS** (40 pre-existing + 3 new).
- `npm test` (full suite, plain — DB-backed suites skip, no `DATABASE_URL`):
  **209 files / 2766 tests passed, 0 failed** (22 files / 518 tests skipped —
  up from 515, exactly the 3 new tests added to an already-skipped file).

**Handoff:** re-submit to qa (Phase 5) — per QA's own loop-back note, only
the new test needs re-verification; everything else in Increment 2 already
passed.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-27
**Verified by:** qa

## Type Check

`npm run typecheck`: **PASS** (clean, no errors)

## Unit Tests

Total: 209 files / 2766 tests passed, 0 failed, 22 files / 515 tests skipped (expected — DB-backed suites, no `DATABASE_URL` exported for the plain `npm test` run) | Duration: 9.6s

Separately, DB-backed suites run standalone against real Postgres (`.env.local`):
- `npx dotenv -e .env.local -- npx vitest run src/lib/credentials.test.ts` → **36/36 PASS**
- `npx vitest run "src/app/(org)/o/[slug]/admin/credentials/" src/lib/audit.test.ts src/lib/org-portal/tiles.test.ts` → **87/87 PASS**

Both figures match the implementer's report exactly, independently reproduced.

## End-to-End Tests

Not required for this feature (not auth-touching). Cheap live-render smoke check instead (dev server already running): loaded `/o/northern-reach/admin/credentials` with the persisted `admin@presby.invalid` session state — HTTP 200, `<h1>Credentials`, both "Ordinations" and "Pastoral appointments" sections rendered, zero console/page errors. Confirms the `credentials.manage` grant and `org_portal.credentials` flag left in place on the live dev DB function end-to-end.

`npm run build`: **PASS** — `/o/[slug]/admin/credentials` registered as a dynamic route.

## Regression Tests Added

(Authored by full-stack-developer, verified here — not written by qa)

- `src/lib/credentials.test.ts:341` — `recordOrdination: forbidden, AND NOTHING IS WRITTEN` — permission gate, no side effect on denial.
- `src/lib/credentials.test.ts:369` — `recordAppointment: forbidden, AND NOTHING IS WRITTEN` — same, for the appointments path.
- `src/lib/credentials.test.ts:561` — servingOrgId belonging to a different presbytery → `invalid_target` (Phase 1's "second org id" adversarial finding) — verified via independent re-derivation: the equivalent SQL filter run directly against the dev DB confirms a congregation belonging to a different presbytery and a nonexistent id both produce zero rows / rejection, matching the two distinct test cases at lines 561 and 576 (enumeration-safe: both collapse to the identical `invalid_target` kind).
- `src/lib/credentials.test.ts:668` — open-appointment collision guard: a second open appointment for the same person/servingOrgId → `invalid_input`, nothing inserted (lines 695-706 assert the list still shows exactly one row); a new one succeeds once the prior is ended (line 716).
- `src/lib/credentials.test.ts:491` / `:522` — `changeOrdinationStatus` never touches `endedOn`/`endedReason`, including the `status: "removed"` End-ordination submission — guards the status-vs-endedOn design distinction directly.
- `src/app/(org)/o/[slug]/admin/credentials/ordination-list.test.tsx` — pins the two-separate-controls UI requirement ("Change status" and "End ordination" both present on an active/retired row; "End ordination" withheld once already removed; the status picker never offers "removed").

New-feature test-first coverage against a design spec — the correct shape for a Feature class; no red-then-green regression-discipline concern applies.

**Named gap — missing coverage (FAIL basis):** Phase 3's own Edge Cases section explicitly flagged that `role-definitions.test.ts` needs a new `organization_type_scope = 'presbytery'` fixture case, since the existing suite only proves the `NULL`-scope (`committee_chair`) path. Confirmed by direct grep: **no test file anywhere in the repo** exercises the template-scope filter with the new `presbytery_stated_clerk` template — the first-ever non-null `organization_type_scope` template row this codebase has shipped, and the mechanism that determines whether a *congregation* incorrectly sees/can-adopt a presbytery-only template. Verified by direct SQL against the live dev DB (mirroring `listTemplateRoles()`'s exact WHERE clause) that the underlying filter is **currently correct** — Alder Creek (congregation) sees only `committee_chair`; Northern Reach (presbytery) sees both — so this is a coverage gap on correct code, not a live bug. Per the qa mandate, missing coverage on a code path a named design note called out is a FAIL naming the gap.

## Coverage on Critical Modules

`permissions.ts`/`two-factor.ts`/`flags.ts` untouched by this feature — not applicable. `src/lib/credentials.ts` itself: 36 DB-backed tests cover every one of its 7 exports across gate/ok/forbidden/invalid_target/invalid_input/thrown-exception branches (verified by direct read of the `describe` blocks, not inferred).

## Feature-Gate Audit

| Route or action | `auth()`/session present? | `credentials.manage` gate present? | Correctly delegated (not duplicated)? |
|---|---|---|---|
| `src/lib/credentials.ts` — `listOrdinations` | via `withOrgContext` | yes, `hasCredentialsManage()` first line inside the tx | n/a (source of truth) |
| `src/lib/credentials.ts` — `recordOrdination` | via `withOrgContext` | yes | n/a |
| `src/lib/credentials.ts` — `changeOrdinationStatus` | via `withOrgContext` | yes | n/a |
| `src/lib/credentials.ts` — `listAppointments` | via `withOrgContext` | yes | n/a |
| `src/lib/credentials.ts` — `recordAppointment` | via `withOrgContext` | yes | n/a |
| `src/lib/credentials.ts` — `endAppointment` | via `withOrgContext` | yes | n/a |
| `src/lib/credentials.ts` — `getCredentialsFormOptions` | via `withOrgContext` | yes | n/a |
| `page.tsx` (`/o/[slug]/admin/credentials`) | yes, `cachedAuth()` + `resolveOrgContext`/`assertOrgAccess` | delegated — calls into gated `credentials.ts` reads; `org_portal.credentials` flag checked separately, **before** any `credentials.ts` call (lines 86-104) | yes — flag and permission never substitute for each other (DECISION-003) |
| `actions.ts` — all four actions | yes, `auth()` directly via `resolveActingIdentity()` | delegated — each action calls the matching `credentials.ts` function, which re-checks `credentials.manage` | yes |

No `getPlatformDb()` anywhere under `src/app/(org)/` (the only two grep hits are comments naming the prohibition). `npm run check:audit` clean. No `console.log` in the credentials tree. No native dialogs.

## Design-Conformance Spot Checks (Phase 3 vs. shipped)

- **`recordAppointment`'s servingOrgId validation** (`src/lib/credentials.ts:513-529`): both conditions enforced — `organizations.parentId = organizationId` AND `organizationType IN (congregation, new_worshiping_community)` — matches design exactly; two distinct rejection tests at `credentials.test.ts:561-589`.
- **status vs. endedOn**: `changeOrdinationStatus()` (`credentials.ts:332-380`) only ever writes `ordinations.status`/`minuteReference`; `endedOn`/`endedReason` never referenced in the module outside types/comments. Two UI controls funnel into the one function, as DECISION-116/the module header documents.
- **Transferring-in-TE blocking**: both `recordOrdination` and `recordAppointment` require a current (`endedOn IS NULL`) `memberships` row at the org before writing (`credentials.ts:285-298`, `:498-511`), `invalid_target` on miss — matches the DECISION-116 ruling (block with guidance, no inline create).
- **The documented divergence** (one shared `changeOrdinationStatus` + two UI entry points + the 4th audit key `ORDINATION_RECORDED`): recorded in both `credentials.ts`'s header and this work-log's Phase 4 section; does not contradict DECISION-112/116 — DECISION-116 ruling 1 mandates one permission gating both jobs, and the shared-function design extends the same reasoning one level deeper. No finding.

## Section 28 / test-rls.sql — Run Honestly

Full `scripts/test-rls.sql` as `presby_app` halts at the pre-existing, documented drift in section 2 (`expected 2, got 3` — the untracked `admin@presby.invalid` membership at northern-reach from Increment 0's live-DB-only walk fixture, exactly as the schema commit describes and declines to reconcile). Not a regression from this increment. Section 28 extracted and run standalone against the same live DB: **all 17 assertions pass** — permission-catalog row; global template row + binding visible from both contexts; the adopted org-scoped copy resolving at the presbytery and nothing at Alder Creek; `ordinations.status` default + enum rejection; `appointments` FORCE RLS isolation proven against a second ad hoc presbytery, keyed off `organization_id` alone; the congregation-side non-read; FORCE RLS flag; grant shape; the `appointments_person_fk` composite-FK F2 rejection. The full suite cannot currently run end-to-end on this shared dev DB past section 2 for reasons unrelated to this feature (also: pre-existing `presby_roll_cache_drift()` and `organization_profiles` duplicate-key issues, already flagged in Phase 4's schema section).

## Verdict

**FAIL**

Everything this increment itself shipped is correct and well-tested: typecheck, build, all four tripwires, the full unit suite, 36 DB-backed `credentials.ts` tests, 87 UI/audit/tile tests, and section 28's 17/17 RLS assertions all pass; the feature-gate audit is clean; the design-conformance spot checks all match Phase 3 exactly; Increment 0's four copy fixes are confirmed live with no regression.

The FAIL is narrow and named: **Phase 3's own Edge Cases section explicitly required a regression test proving the presbytery-scoped `organization_type_scope` filter — the first non-null-scope template this codebase has ever shipped — excludes `presbytery_stated_clerk` from a congregation's template list and includes it for a presbytery's. That test does not exist anywhere in the repo.** The underlying filter is currently correct (verified by direct SQL), so there is no live bug — but an untested code path a named design note called out is exactly the gap this phase exists to catch.

**Handoff:** returns to **full-stack-developer** (Phase 4) to add the missing test — a `describe("listTemplateRoles — organization_type_scope filtering")` (or similar) block in `src/lib/role-definitions.test.ts`, asserting: (1) a congregation-context caller with `roles.manage` does **not** see `presbytery_stated_clerk` in `listTemplateRoles()`; (2) a presbytery-context caller **does**, alongside `committee_chair`; ideally also proving `adoptTemplate()` rejects adopting a presbytery-scoped template from a congregation context, since it carries the identical filter (`role-definitions.ts:793-796`) and is equally unexercised for this row. Once green, re-submit to qa — only the new test needs re-verification.

---

## Phase 5 — Re-Verification (qa)

**Date:** 2026-08-27
**Scope:** narrow re-check of the single named FAIL basis — the missing `organization_type_scope = 'presbytery'` regression coverage. Everything else from the prior pass stands as previously verified and was not re-run (per that pass's own scoping instruction).

- **New coverage read, not inferred** (`src/lib/role-definitions.test.ts:600-761`): self-contained `describe` block with its own `beforeAll`/`afterAll` (real presbytery org, presbytery-context `roles.manage` holder, independently-seeded presbytery-scoped template row — not the migration-0037 fixture, matching file convention). All three assertions real and non-tautological: `:718` congregation-context absence AND NULL-scope presence (both directions); `:729` presbytery-context sees both (filter isn't "always exclude"); `:741` `adoptTemplate()` → `{ kind: "template_not_found" }` plus an independent follow-up `select` proving no `appRoles` row was written — a genuine negative DB proof, not an echo of the implementation's return value.
- **Zero production-code changes:** `git diff --stat -- src/lib/role-definitions.ts` empty; the test file's diff is exactly the `and` import + the new block (181 insertions).
- **Runs, independently reproduced:** standalone vs real Postgres **43/43 PASS**; `npm run typecheck` clean; plain `npm test` **209 files / 2766 passed, 0 failed** (518 skipped = prior 515 baseline +3, exactly the new tests — no other suite's counts silently shifted).

### Verdict

**PASS** — the sole FAIL basis is closed; production code unchanged (the filter was already correct, as the prior pass's direct-SQL check found); everything re-run is green.

**Handoff:** analyst (Phase 6) — Shipped vs. Intent for Increment 0 + Increment 2 in full.

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> A presbytery clerk can now record ordinations and pastoral appointments through one honest, well-separated admin page exactly as Phase 1/3 described — the code and its live behavior are solid; what's incomplete is the housekeeping the pipeline owes the rest of the docs tree (release notes, functionality map, TODO tracking of the four deferred increments), which is real but doesn't call the feature itself back.

## What's Working

- **The status-vs-removal distinction is genuinely comprehensible to a non-technical clerk**, not just correctly coded. Live at 390px against the real dev server (`admin@presby.invalid`, `/o/northern-reach/admin/credentials`), the "Change status" dialog reads: *"This records their current standing — it does not end their ordination. Ordination is lifelong; this changes only their status."* The "End ordination" confirm reads: *"This person will no longer show as ordained — this cannot be represented as retirement or leave. Use 'Change status' instead for honorable retirement, on-leave, or discipline."* Exactly Phase 3's Edge Cases requirement, written for a clerk, not a developer.
- **Audit trail is real, not just typechecked.** Queried `audit_events` directly against the live dev DB: four distinct rows from the implementer's own walk — `tenant.ordination.recorded`, `tenant.ordination.status_changed` (`metadata.status: "honorably_retired"`), `tenant.appointment.recorded`, `tenant.appointment.ended` — each metadata payload names the person, org, and the specific fact changed. A future audit reader can tell a routine status change from an End-ordination event by metadata alone.
- **The serving-org dropdown surfaces `platformStatus` exactly as designed** — confirmed live: managed/invited/unmanaged congregations all render correctly, matching Phase 3's explicit licensing of this field.
- **Mobile tables are genuinely scrollable, not silently clipped.** At 390px both list tables' wrapping `<div>` is `overflow-x-auto` with `scrollWidth > clientWidth` (confirmed via DOM inspection, not inference); both forms render with no horizontal overflow and no console/page errors.
- **Increment 0's four copy fixes and its honest non-fixes both hold up.** Congregation-assuming language de-congregationalized where wrong (directory/feedback/features copy), deliberately left alone where the surface itself is still congregation-shaped (the officers office list) — correctly feeding Increment 2 rather than papering over a real gap with softer copy.

## Intent-vs-Shipped Diff

- Phase 1 proposed five increments; operator chose 0+2. **Shipped:** exactly 0 and 2, nothing more, nothing less. **Verdict: matches.** Nothing from 1/3/4/5 silently absorbed or dropped — DECISION-112 explicitly carries Q1 (managed-congregation downward read) forward as still-open, with no bespoke cross-org RLS policy sneaking a partial answer in.
- Phase 1 Flow 1's undefined transferring-in-TE case: DECISION-112/116 ruled blocked-with-guidance, not an inline create — confirmed in source (`record-ordination-form.tsx:73`, `record-appointment-form.tsx:87`): *"No one available to record. A minister must hold membership at this [org] first — add them via Members."* with a link. **Verdict: matches** — a defensible resolution of a Phase-1-flagged gap. Not exercised live (every fixture person already holds a presbytery membership); present in source and covered by QA's DB-backed suite.
- Phase 1 Flow 2 (no data model for "who serves as pastor"): shipped exactly Phase 2's ruling — presbytery-owned `appointments` table, congregation-side read deferred, no bespoke RLS. **Verdict: matches.**
- Phase 1's Adversarial Pass "second org id in the URL" risk: `recordAppointment`'s parent-path check (parentId AND organizationType), proven as two distinct test cases both collapsing to the same enumeration-safe `invalid_target`; QA independently re-derived the SQL. **Verdict: matches.**
- **The documented divergence** (one `changeOrdinationStatus()`, two UI entry points, a fourth audit key `ORDINATION_RECORDED` beyond DECISION-112's three-key list): **acceptable resolution, not scope drift.** Two backend functions for a change that only ever writes one column would be artificial duplication contradicting DECISION-116's own one-key reasoning; the fourth key is justified (first-ever write to `ordinations`) and disclosed in both the module header and this work-log. QA reached the same conclusion independently.
- Increments 1 (committees/commissions), 3 (congregation oversight, blocked on Q1), 4 (per-capita/SASR, blocked on a real publication mechanism), 5 (imports/reports) — correctly deferred and recorded in this work-log and DECISION-112, but not yet in `docs/TODO.md`. Housekeeping gap, not functional — see Follow-Ups.

## Edge Cases

- Empty state: **pass** (person-picker guidance confirmed in code and by QA's suite; not exercised in a live click-through since no fixture has zero eligible people — low risk, noted below).
- Failure microcopy: **pass** — plain, consequence-naming dialog language, no raw enums or stack traces.
- Permission gate: **pass** — flag-then-permission ordering confirmed live; denied → nothing written (`credentials.test.ts:341`/`:369`).
- Audit event: **pass** — four real rows independently queried from the live dev DB with correct, specific metadata.
- Mobile (390px): **pass** — scrollable tables (DOM-verified), usable forms, zero errors.

## Follow-Ups (SHIP WITH NOTES)

1. **`docs/release-notes/v0.18.md`** — ToC promises "presbytery credentials & pastoral appointments, and verified presbytery portal support"; body has neither section. Add `### Feature: Presbytery credentials & pastoral appointments` (+ a short portal-verification note) before announcing.
2. **`docs/product/functionality-map.md`** — no line for this feature anywhere (Index or full map). Needs an entry naming `appointments`, `ordinations.status`, `credentials.manage`, the `presbytery_stated_clerk` template (first non-null `organization_type_scope`), `/o/<slug>/admin/credentials`, and `org_portal.credentials` (seeded off). Rule 14 same-commit obligation.
3. **`docs/TODO.md`** — no Done line for Increment 0+2, and no tracking lines for the four deferred increments (1, 3, 4, 5). Add the Done line plus four Next-Up lines referencing this work-log's Phase 1.
4. **What's-new (Rule 13): correctly deferred.** `org_portal.credentials` seeded off — no member-visible behavior yet. A short entry belongs at flag-flip time; track that with the flag, not now.
5. **Rule 12 (feedback row): not applicable** — no Source block, no feedback UUID (confirmed by grep).
6. **Minor, low-risk:** the transferring-in-TE empty-person-list and zero-member-congregation empty states are real in source and test-covered but weren't exercised in a live click-through. Quick live confirmation next time the form is touched; not a blocker.

## Red Flags

None — the gaps above are documentation-aggregator hygiene, not functional regressions or unaddressed design gaps.

**Handoff:** follow-ups 1–3 land with the feature's commit (Rules 10/14); no further pipeline phase for the shipped scope. Increments 1/3/4/5 each start their own Phase 1 when picked up.
