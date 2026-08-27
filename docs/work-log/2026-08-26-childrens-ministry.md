# Children's Ministry (fpcw-directory parity) — Work Log

> **Slug:** `2026-08-26-childrens-ministry`
> **Surface:** TBD Phase 1 — likely mixed: (org) admin surfaces, possibly a member/guardian-facing registration flow, possibly a future kiosk (fpcw-directory has one; scope TBD)
> **Permission(s):** TBD Phase 1/3 — children's data is tier-3-adjacent (medical, guardians, consent); `medical.manage`/`member_care_admin` from the sensitive-info pipeline may be relevant prior art
> **Flag(s):** TBD Phase 3
> **Estimated complexity:** large
> **Pipeline mode:** Full — via `/new-feature`. Operator's words: "Let's continue on with parity. Children's functionality."

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES (A/B); NOT YET (C/D — events dependency) | 2026-08-26 |
| 2 — Architectural review | architect | Complete | Approved with suggestions (Increment A) | 2026-08-26 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-08-26 |
| 4 — Implementation | full-stack-developer | Complete | Implemented per Phase 3 design | 2026-08-27 |
| 5 — Verification | qa | Complete | PASS | 2026-08-27 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-27 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES — but only for Increments A and B below. Increment C (check-in) is **NOT YET**: it depends on an events model presby does not have, and that dependency is load-bearing enough that it gets its own Phase 1 once the events model exists, rather than being scoped speculatively now. Increment D (kiosk) is out of scope for any near-term work-log.

## ONE-LINE TAKE

> presby already has most of the tier-3 groundwork this needs — `people.dateOfBirth`/`grade`, `person_relationships` (guardian/parent/emergency_contact types), `person_medical` (with a working `medical.manage`/`member_care_admin` permission shipped today), and a `consents` table that already documents `minor_directory`/`minor_photo` types — with **zero UI wired to any of it**; the actual gap is check-in, which fpcw keys to `events.id` and presby has no events table at all.

## Prior Art vs Presby — What Actually Transfers

| fpcw-directory concept | Presby equivalent | Status |
|---|---|---|
| `youthRegistrations` (per-child name/DOB/grade/school) | `people` (already has `dateOfBirth`, `grade`, `school`) | Table exists, no child-specific admin flow |
| `youthFamilies` (guardian1/guardian2 denormalized columns) | `person_relationships` (`parent`\|`guardian`\|`emergency_contact`, `related_person_id` or free-text `related_name`) | Table exists, **zero UI** (already flagged in `docs/TODO.md`) |
| medical/allergy/medication fields | `person_medical` (allergies, medications, medicalNotes, authorizedPickup) | Table exists, UI shipped today behind `medical.manage`/`member_care_admin` |
| `photoConsent` enum + `liabilityWaiverAccepted` | `consents` (`consent_type` free text; schema comment lists `minor_directory`\|`minor_photo`; no `liability_waiver` value yet) | Table exists, **zero UI** |
| `youthSettings` singleton (program year, waiver text, consent language) | **Nothing** — fpcw is single-tenant; presby needs this org-scoped, not a singleton port | Greenfield, real design delta |
| `youthRegistrationHistory` | Nothing analogous for people-level edits (`roll_actions` is constitutional, not administrative) | Greenfield — likely a lighter append-only log |
| `youthCheckins` (keyed to `events.id`) | **No events table exists** — `src/lib/db/domain/index.ts` says so explicitly ("deliberately absent pending their own requirements pass") | **Blocking dependency** |
| `kioskDevices`, exit-PIN, offline idempotency, White Binder app | Nothing | Multi-quarter follow-on |
| `findPotentialDuplicates()` (name+DOB match) | `presby_match_person()` (security-definer, ranked) already exists and is better | Reuse presby's |

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Authenticated member (parent/guardian) | Links themself to their child's existing person record, or requests staff create one | one-time / rare |
| Guardian | Grants/updates photo consent and liability waiver for a linked child | annually (program-year renewal) |
| Guardian | Enters/updates allergy, medication, emergency-contact info for a linked child | as needed |
| Church staff | Views the children's roster (name, DOB/age, grade) | per session |
| Church staff | Approves a guardian-child link before it grants tier-3 visibility | per new registration |
| Church staff | Checks a child in/out of a program instance | per program meeting — **blocked on events model** |

## Flows

**Flow 1 — Guardian links to an existing child record (Increment A):** guardian selects a household member under 18 (or requests staff add one) → staff or automated household-match approves → `person_relationships` row created, guardian gains scoped visibility into that child's `person_medical`/consent data.
- Failure: no path described for "guardian claims a child who isn't theirs" — see Adversarial Pass, the single biggest gap.

**Flow 2 — Guardian completes consent + medical intake (Increment B):** photo consent, liability waiver, allergies/medications/emergency contact → `consents` rows + `person_medical` upsert, program-year timestamp.
- Failure: waiver unchecked while an org-level require-waiver setting is on — presby has no per-org setting to block against yet.

**Flow 3 — Staff views children's roster (A/B):** `/o/<slug>/admin/children` (or similar) → filtered list of people under an age cutoff with consent/medical status at a glance → drill into tier-3 detail only with `medical.manage`.

**Flow 4 — Check-in/check-out (Increment C — blocked):** cannot be flowed with confidence; no `events` table, no decision on the future events model's shape. Own Phase 1 once that model exists.

## Permissions & Flags

- **Existing, reusable:** `medical.manage` (shipped today, bound to `member_care_admin`).
- **New, likely:** a tier-2 `children.roster`-style permission for the name/DOB/grade-only roster, separate from `medical.manage` — a Sunday-school coordinator needing the roster shouldn't automatically get allergy data. Architect/tech-lead ruling needed.
- **New, likely:** a `consent.manage` permission if photo/waiver consent is judged tier 2 rather than tier 3 — the classification isn't obvious and needs a DECISION-078-style per-key test.
- **Flags:** guardian self-service is new member-facing behavior touching minors' data — recommend a flag (e.g. `org_portal.family_registration`), off by default. Staff-only entry could ship first.

## Gaps the Request Didn't Address

1. **The events dependency is load-bearing** — check-in is the headline feature and presby has nothing to key it to.
2. **Guardian-child linking is a self-granting hole, structurally identical to F21** — nothing described verifies a guardian link before it grants tier-3 visibility into a child's medical record. Needs an approval gate or verified-identifier match, same discipline F21 forced onto memberships.
3. **Multi-tenancy for program settings** — fpcw's global `youthSettings` singleton must become org-scoped (waiver text, consent language, program year all vary by congregation).
4. **Consent tiering undecided** — tier 2 (operational) or tier 3 (bundled with medical)? Changes who can manage it.
5. **Off-system guardians** — free-text `related_name` has no phone number; the emergency-contact use case needs one.
6. **Registration history/audit** — is `recordAudit()` sufficient, or does staff need a full diff history like fpcw's `youthRegistrationHistory`?
7. **Empty state** for a congregation with zero children entered.
8. **Mobile at 360px** — a nursery-hallway phone is a real use case.
9. **Server-side input limits on free text** — the sensitive-info pipeline shipped this gap once (client-only); don't repeat it.
10. **Background checks** (`background_checks` table exists, zero UI) — in scope or a separate volunteer-screening track?

## Out of Scope (confirm with user)

- The Android kiosk app (`white-binder/`), device pairing, exit-PIN — multi-quarter.
- Any events/program-instance model — its own Feature pipeline.
- Background-check volunteer screening — separate track unless the operator says otherwise.

## Adversarial Pass

- **Self-targeting (biggest finding):** a member must not be able to insert a guardian row against an arbitrary child and thereby read their `person_medical`/`consents` — F21's hole replayed on a new axis.
- **Redirect targets:** any registration "continue" link validates same-origin.
- **State-machine shortcuts:** can a guardian edit a submitted registration post-submission without staff re-review? Undecided.
- **Input boundaries:** server-side length enforcement from the start.

## Proposed Increments

1. **Increment A — Children as `people` + guardian linking (foundation).** No new tables for the child record itself; the admin add-a-child flow, the guardian-link flow with an approval/verification gate (closing the F21-shaped hole), and a roster view gated on a new tier-2 permission. This is `docs/TODO.md`'s already-flagged `person_relationships` UI gap, now scoped as real work.
2. **Increment B — Consent + medical intake workflow.** Builds on existing `consents`/`person_medical`; org-scoped settings table (not a singleton); consent-tier ruling; guardian self-service behind a flag or staff-entry-only v1.
3. **Increment C — Check-in/check-out.** **Blocked** until an events/program-instance model exists; re-run Phase 1 then.
4. **Increment D — Kiosk.** Far future, depends on C.

## Open Questions (for the operator)

1. **Most important:** proceed with Increments A/B now (accepting check-in stays blocked on the not-yet-built events model), or scope the events model first with children's ministry as a downstream consumer?
2. Guardian self-service in v1, or staff-entry-only to start?
3. Background-check volunteer screening — part of this ask or separate?

**Operator decisions (2026-08-26):** (1) ordering — **all in parallel**: Increments A/B proceed now AND the events model gets its own concurrent pipeline (check-in follows once events exist); (2) guardian self-service — **staff-entry only for v1** (self-service becomes a later increment; the F21-shaped guardian-verification surface is deferred with it); (3) background checks — **separate track**, not part of this ask.

**Handoff:** architect (Phase 2), scoped to Increment A (staff-entry only). The events model runs as its own sibling pipeline (`2026-08-26-events-model`).

---

# Phase 2 — Architectural Review (architect)

**Scope:** Increment A only — children as `people` rows + guardian linking via `person_relationships` + roster view, staff-entry only per the operator's decision. Rulings recorded in full as DECISION-111.

## Verdict

Approved with suggestions

## Placement

- **Directory:** no new top-level tree. Children are `people`/`memberships` rows, so the roster and child-entry surfaces extend the existing `src/app/(org)/o/[slug]/admin/members/` tree — reuse the wizard and `[id]/edit/` rather than forking a parallel edit flow. A dedicated children roster is a **filtered view** (age-cutoff query), not a parallel data path. Guardian-link management is a new co-located section following the `edit/sensitive/` precedent (own page/actions, permission-gated).
- **Server/client split:** Server Components by default; the guardian-link form and roster filter controls are the only client islands.
- **Dependencies:** none.

## Invariants Touched

- **Permissions vs Flags:** `children.roster` is a permission; `org_portal.children_ministry` is a flag; never merged.
- **RLS enforces tenancy, not authorization:** `person_relationships` is a global table (no `organization_id`), RLS keyed on `person_id` (the child) via the same bespoke person-axis policies as `addresses`/`contact_methods` — correctly narrow at the DB layer, but no application-level permission check has ever existed on it and zero application code touches it. Increment A adds explicit `hasPermission()` gating on both read and write; RLS alone is not the authorization boundary.
- **No Role Carries a Wildcard:** the roster permission must NOT default-bind to `member_care_admin` — that would silently hand medical data visibility to anyone who can see a roster, defeating Phase 1's own stated requirement.

## Rulings (full text in DECISION-111)

1. **Data model:** children are first-class `people` rows; nothing missing on `people` for Increment A; no stored is-child flag.
2. **`person_relationships` isolation:** global, `person_id`-keyed; gate reads AND writes behind the roster permission (no reason to split guardian-visibility from roster-visibility in a staff-only v1). Noted, not fixed in A: the INSERT policy has no check on `related_person_id` — a thin existence-oracle, not F21-shaped.
3. **Roster permission:** `children.roster` (tier 2) → new constitutional, protected role `children_ministry_admin` — DECISION-078 test applied, no office fits; kept separate from `member_care_admin` by construction.
4. **Off-system guardians:** no schema change this increment — default the UI to linking existing `people` rows (they carry `contactMethods`); free-text `relatedName` fallback; the phone gap defers until check-in needs it.
5. **Placement:** confirmed as above.
6. **Flag:** `org_portal.children_ministry`, seeded off.
7. **Audit:** new keys for guardian-link create/update (e.g. `TENANT_PERSON_RELATIONSHIP_ADDED`/`_UPDATED`); child-entry inherits `createPerson`'s existing coverage; no audit for reads.

## Notes for Phase 3

- Guardian-link write path as its own module (or a `person-sensitive.ts` sibling) with the established `hasPermission()` → visibility check → mutate shape — not bare Drizzle calls from an action file.
- Server-side length limits on `person_relationships.notes`/`relatedName` from the start.
- Fixture binding for `children_ministry_admin` (person-arm likely, per `brand_admin`/`role_admin` precedent) — don't pile onto an already-overloaded fixture person.

**Handoff:** tech-lead (Phase 3), scoped to Increment A.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Increment A gives church staff two things, both scoped to DECISION-111's rulings: a **children's roster** — a read-only, age-cutoff-filtered view of the existing `admin/members/` tree, no new table, no parallel data path — and **guardian linking**, the first application-level read/write surface `person_relationships` has ever had (the table has carried zero app-level gating since its original design; RLS alone was never the authorization boundary CLAUDE.md says it must not be). Both capabilities sit behind one new tier-2 permission, `children.roster`, bound to a new dedicated role so a Sunday-school coordinator can see the roster without also getting `medical.manage`'s allergy data — the exact separation Phase 1 asked for and DECISION-111 designed around. No schema change beyond a permission-catalog row; children stay ordinary `people`/`memberships` rows, and child-entry reuses the existing member-creation wizard (`dateOfBirth` is already an optional field there) rather than forking a new form.

## Permissions & Flags

- **Permission key:** `children.roster` (module `children`, tier 2, module `db.permissions` catalog row — global, code-seeded, not tenant-writable, same as every other tenant permission).
- **Default role binding:** new constitutional, protected role `children_ministry_admin` (mirrors `member_care_admin`'s/`brand_admin`'s shape) — carries `children.roster` alone, nothing else. Fixture-bound to **Wren Thackeray** (`c0000000-0000-0000-0000-000000000008`) — an active household head holding zero roles today (confirmed by grep against `scripts/seed-dev.sql`), avoiding a repeat grant onto Tobias Renwick/Marguerite Ashcombe/Priya Balakrishnan/Rowan Thistlewood/Aldous Fennimore/Marisol Windham, all already carrying at least one role.
- **Same permission gates both reads and writes** on `person_relationships` for this increment — DECISION-111 ruling 2 explicitly declines to split roster-visibility from guardian-link-visibility in a staff-only v1.
- **Flag:** `org_portal.children_ministry`, seeded off, **checked bare** (no `organization_feature_toggles` row) — this increment is a brand-new admin surface reachable only via a fixed permission, the same shape as `org_portal.officers`/`org_portal.groups` (a toggle, not an auth path, no per-org opt-in needed beyond the flag itself), not `org_portal.members_create`'s toggle-composing shape (which exists because it shares a page with `people.manage` more broadly). Never substitutes for `children.roster`: flag-on + no grant renders the existing `MembersForbidden` state, per DECISION-003.

## API Contract

New module **`src/lib/children.ts`** (not a `person-sensitive.ts` sibling by file location, but the identical shape: `withOrgContext()`-per-export, permission-check-first, typed result unions, enumeration-safe `not_found` collapse, server-side length limits). Named `children.ts`, not `person-relationships.ts`, because this module does **not** cover every use of `person_relationships` — only the children's-ministry guardian-linking use case, gated entirely behind `children.roster`. A future emergency-contact-for-adults feature would need its own permission and would NOT extend this file (see DECISION-114).

```ts
// Roster read
export interface ChildRosterEntry {
  personId: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  dateOfBirth: string;       // never null — see Edge Cases
  ageYears: number;
  householdId: string | null;
  householdName: string | null;
  guardianCount: number;      // 0 renders a "no guardian on file" flag
}
export type GetChildrenRosterResult =
  | { kind: "ok"; children: ChildRosterEntry[] }
  | { kind: "forbidden" };
export async function getChildrenRoster(
  personId: string, organizationId: string,
): Promise<GetChildrenRosterResult>;

// Guardian-link read (for the edit/guardians sub-page)
export interface GuardianLink {
  id: string;
  relatedPersonId: string | null;
  relatedName: string | null;   // present iff relatedPersonId is null
  relationship: GuardianRelationship;
  isEmergencyContact: boolean;
  notes: string | null;
}
export type GetGuardianLinksResult =
  | { kind: "ok"; personId: string; links: GuardianLink[] }
  | { kind: "forbidden" }
  | { kind: "not_found" };
export async function getGuardianLinksForEdit(
  actingPersonId: string, organizationId: string, childPersonId: string,
): Promise<GetGuardianLinksResult>;

// Mutations
export type GuardianRelationship =
  | "parent" | "guardian" | "grandparent" | "caregiver";
export interface AddGuardianLinkInput {
  relatedPersonId?: string;   // XOR relatedName — validated server-side
  relatedName?: string;
  relationship: GuardianRelationship;
  isEmergencyContact: boolean;
  notes?: string;
}
export type AddGuardianLinkResult =
  | { kind: "ok"; linkId: string }
  | { kind: "forbidden" } | { kind: "not_found" }
  | { kind: "invalid_input"; field: "relatedName" | "relatedPersonId" | "notes" | "relationship" };
export async function addGuardianLink(
  actingPersonId: string, organizationId: string, childPersonId: string,
  input: AddGuardianLinkInput,
): Promise<AddGuardianLinkResult>;

export async function updateGuardianLink(
  actingPersonId: string, organizationId: string, childPersonId: string,
  linkId: string, input: AddGuardianLinkInput,
): Promise<AddGuardianLinkResult | { kind: "not_found" }>; // link not_found is distinct from child not_found only in message, never in shape/timing

export type RemoveGuardianLinkResult =
  | { kind: "ok" } | { kind: "forbidden" } | { kind: "not_found" };
export async function removeGuardianLink(
  actingPersonId: string, organizationId: string, childPersonId: string,
  linkId: string,
): Promise<RemoveGuardianLinkResult>;
```

Server actions (`src/app/(org)/o/[slug]/admin/members/[id]/edit/guardians/actions.ts`), same `(slug, personId, input)` shape and `auth()`/`resolveOrgContext()`/`ActionResult<T>` plumbing as `edit/sensitive/actions.ts`:

- `addGuardianLinkAction(slug, personId, input): Promise<ActionResult<{ linkId: string }>>`
- `updateGuardianLinkAction(slug, personId, linkId, input): Promise<ActionResult<{ linkId: string }>>`
- `removeGuardianLinkAction(slug, personId, linkId): Promise<ActionResult<void>>`

## Data Model

No table changes. One permission-catalog migration, hand-written per the established post-0012 convention (`db:generate` broken on a pre-existing snapshot collision):

- **`drizzle/0035_presby_children_ministry_permission.sql`** (working number, re-verified against `ls drizzle/` at design time — `0034_presby_directory_permission_copy.sql` landed from a concurrent pipeline between this design's research and its write-up. **Re-run `ls drizzle/` immediately before creating this file regardless**; concurrent pipelines have collided on the next-free number repeatedly today and there is no reason to expect this is the last collision):
  ```sql
  insert into permissions (key, module, description, sensitivity_tier)
  values ('children.roster', 'children',
          'View the children''s roster and manage guardian links for a child', 2)
  on conflict (key) do nothing;
  ```
- **`scripts/seed-dev.sql` fixture additions** (not this migration, same split as every other tenant-permission pipeline this session — DECISION-063):
  - `app_roles` row: `children_ministry_admin`, id `f0000000-0000-0000-0000-00000000000d`, `role_kind = 'constitutional'`, `is_protected = true`.
  - `app_role_permissions`: `(f...000d, 'children.roster')` — the only permission this role carries.
  - `role_grants`: direct-granted to Wren Thackeray (`c0000000-0000-0000-0000-000000000008`), `starts_on` the date this pipeline's grant lands (no `officer_terms` row behind it, same shape as `brand_admin`/`support_contact`/`member_care_admin`).
  - One `person_relationships` fixture row exercising the guardian link end to end: Hallie Vandermeer (`c0000000-0000-0000-0000-000000000005`, born 2011-03-08, already a fixture child in the Renwick household) ↔ Tobias Renwick (`c0000000-0000-0000-0000-000000000002`, her household's head), `relationship = 'parent'`, `is_emergency_contact = true`. This is the first-ever fixture row in `person_relationships` (the table has shipped with zero rows since 0008) and gives the roster a "1 guardian on file" case for free; every other org's fixture children roster (none — Bramblewood/Quillhaven have no under-18 fixture people) exercises the empty state.

## Component / Page Plan

- **Pages to create:**
  - `src/app/(org)/o/[slug]/admin/members/children/page.tsx` — the roster. Same auth → `resolveOrgContext` → flag → read shape as every other page in this tree; gates on `org_portal.children_ministry` (bare) then calls `getChildrenRoster()`, which does its own `children.roster` check.
  - `src/app/(org)/o/[slug]/admin/members/[id]/edit/guardians/page.tsx` — the guardian-link sub-page, literally mirroring `edit/sensitive/page.tsx`'s structure (own route, own flag-off/forbidden/not-found states, single permission instead of four).
- **Components to create:**
  - `children-roster-list.tsx` — new component (not a reuse of `members-list.tsx`): different columns (name, age, household, guardian count, "no guardian on file" badge), no search/status-filter/pagination in v1 (a congregation's children's roster is small; Increment A ships the simplest useful thing, revisit if a congregation's roster grows past a page).
  - `src/app/(org)/o/[slug]/admin/members/[id]/edit/guardians/guardian-link-form.tsx` — add/edit/remove one guardian row at a time, client island (the only one in this plan), mirroring `sensitive-info-form.tsx`'s controlled-input + `maxLength` + server-action-call shape. Relationship `<select>` is restricted to the four-value UI subset (`parent`/`guardian`/`grandparent`/`caregiver`) even though the column itself is unconstrained free text at the DB layer — narrower than the full documented value set (`spouse`/`child`/`sibling`/`emergency_contact`/`pastor`), because those five don't describe "who may pick this child up" (the `isEmergencyContact` checkbox already covers the emergency-contact case independently, and `spouse`/`child`/`sibling`/`pastor` belong to a future, out-of-scope adult-relationships feature, not this one).
- **Files to modify:**
  - `src/app/(org)/o/[slug]/admin/members/page.tsx` — add a "Children's roster" link, rendered only when the flag is on AND the viewer holds `children.roster` (cheap `hasPermission()` check, same pattern as the existing `canCreate` check on this page).
  - `src/app/(org)/o/[slug]/admin/members/[id]/edit/page.tsx` — add a co-located card linking into `./edit/guardians`, rendered only when `org_portal.children_ministry` is on AND `hasPermission(..., "children.roster")` is true — same "absent, never disabled" discipline the sensitive-info link already established, and the identical defense-in-depth reasoning (the sub-route re-checks its own flag+permission regardless).
  - `scripts/seed.ts` — new flag block for `org_portal.children_ministry`, `enabled: false`, comment following the `org_portal.officers`/`org_portal.groups` template exactly.
  - `docs/decisions.md` — DECISION-114 (module scope/name + the DOB-visibility ruling below).

## Implementation Order

1. Permission-catalog migration (`0035_presby_children_ministry_permission.sql`, number re-verified at commit time) + `scripts/seed-dev.sql` fixture rows (role, binding, grant, the one guardian-link row) — folded into the implementer's single commit, same precedent as DECISION-108's Phase 4 commit 1 (no standalone `database-admin` pass; see Implementer below).
2. `scripts/seed.ts` flag entry.
3. `src/lib/children.ts` — roster read, guardian-link read/add/update/remove.
4. Server actions (`edit/guardians/actions.ts`).
5. UI: roster page + list, guardians sub-page + form, the two co-located links on `admin/members/page.tsx` and `edit/page.tsx`.
6. Audit events (`TENANT_PERSON_RELATIONSHIP_ADDED`/`_UPDATED`/`_REMOVED`) wired into every mutation.
7. Release notes entry.

## Edge Cases & Risks

- **Age-cutoff definition.** A child is `people.dateOfBirth is not null and dateOfBirth > (current_date - interval '18 years')` — strictly under 18, computed at read time, never stored. **A person with no `dateOfBirth` is never included in the roster**, even if household role or `grade` strongly suggest a child — DECISION-111 ruled out a stored is-child flag, and there is no honest way to apply an age cutoff to a null date. This is a real, named gap for a congregation importing legacy records with no birthdate on file: those children are invisible to the roster (though still ordinary, editable `people` rows) until staff add a DOB through the existing edit form. Not fixed in Increment A; flagged in `docs/TODO.md` as a data-quality follow-up, not a design defect. `birthYearOnly` (Jan-1-of-year approximation) is read as-is with no special handling — a child born in December whose year-only DOB reads as January 1 could show a few months younger than actual; immaterial at a 12-month cutoff granularity and not worth a second code path in v1.
- **Roster's interaction with directory privacy.** The roster deliberately does **not** route through `directoryEligibilityWhereSql()`/`hide_birthday` the way `getDirectory()` does — two separate rulings, stated explicitly rather than left implicit:
  1. `person_privacy.directory_hidden` is **not** applied — a family that opted a child out of the public congregational directory should still appear on the internal children's-ministry safety roster. This mirrors `deriveDeaconsByOrgUnit()`'s existing precedent (an officer is shown "by office" regardless of directory privacy); a child is shown "by roster" regardless of directory privacy, for the same reason (safety/staffing accountability outranks an opt-out that was never about children's ministry).
  2. `person_privacy.hide_birthday` (default `true`) is **not** applied either — `children.roster` is the one permission in the catalog whose entire purpose requires an unmasked DOB (there is no way to compute or display "age 7" from a nulled birthday). Holding `children.roster` is itself the authorization to see DOB for a person who qualifies as a child under this org; this is a deliberate, narrow bypass of the directory's field-level privacy CASE-WHEN, analogous to how `person_medical`/`person_notes` already sit entirely outside `person_privacy`'s reach. Logged as DECISION-114 since it is a genuinely new privacy-interaction ruling, not a mechanical application of DECISION-111.
- **Relationship enum subset.** The UI's four-value dropdown (`parent`/`guardian`/`grandparent`/`caregiver`) is enforced server-side as an allow-list in `addGuardianLink`/`updateGuardianLink` (`invalid_input; field: "relationship"` for anything else) — the column itself carries no DB-level CHECK constraint (confirmed by reading `drizzle/0008_presby_domain.sql` directly: `relationship text not null`, no constraint), so this allow-list is the only thing preventing junk values from a bypassed client.
- **The missing DB-level CHECK, closed at the app layer.** `docs/schema-design.md`'s original design specified `check (related_person_id is not null or related_name is not null)` on `person_relationships`; the actual `drizzle/0008` migration never applied it. `addGuardianLink` enforces the XOR itself (`invalid_input; field: "relatedPersonId"` or `"relatedName"` if both or neither are present) before any INSERT — a real, previously-latent gap this pipeline is the first to touch and therefore the first to close, at the layer it can reach (the DB gap itself is out of scope; flagged in `docs/TODO.md`).
- **The existence-oracle DECISION-111 named but declined to fix.** When `relatedPersonId` is provided (linking to an existing `people` row as guardian), `addGuardianLink`/`updateGuardianLink` verify that person **also** holds an active membership at this organization (the same `personVisibleInOrg()` check `person-sensitive.ts` already runs on the child) before allowing the write. This is a real narrowing beyond what DECISION-111 required (it called the INSERT policy's missing `related_person_id` check "a thin existence-oracle, not F21-shaped" and left it unfixed at the DB layer) — cheap to add now that app-level gating exists on this table for the first time, so it is added rather than deferred a second time.
- **Server-side validation.** `notes` and `relatedName` get the same `BODY_MAX_LENGTH`/`FIELD_MAX_LENGTH`-style server-side length checks `person-sensitive.ts` established after Phase 6 caught the client-only gap on that pipeline — checked before `withOrgContext`, same "reject before any query runs" discipline.
- **e2e blast radius (existing specs this change could break).** `members-list.test.tsx`/`page.test.tsx` for `admin/members` gain a new conditional link but assert on existing content by text, not by exact DOM child count — low risk, but the new "Children's roster" link's conditional-render logic should be covered by a new assertion, not just trusted. `edit/page.test.tsx` similarly gains a new conditional card; the existing sensitive-info-link assertions must keep passing unchanged (the two cards are independent conditions, and a shared `hasPermission()`-call ordering bug could plausibly cross-contaminate render output if the two checks are merged carelessly into one `Promise.all` — implementer should keep them as independent awaited calls, mirroring `edit/page.tsx`'s existing `sensitiveInfoFlagOn`/`rollActionEditFlagOn` independence). No existing e2e spec asserts on `person_relationships` (zero fixture rows existed before this pipeline), so the one new fixture row is additive risk only to specs that snapshot Hallie Vandermeer's or Tobias Renwick's full profile — `grep -rn "Hallie\|Vandermeer\|Renwick" src/**/*.test.ts*` should be run by the implementer before considering Phase 4 done, to confirm no existing assertion counts guardian rows or exact-matches a profile page that will now render a new "1 guardian on file" affordance.
- **Empty state.** Zero children at an org (Bramblewood, Quillhaven) renders an explicit "No children recorded yet" state on the roster, not a blank list — same discipline every other list in this tree already follows.
- **Mobile at 360px.** The roster list and the guardian-link form are new surfaces; both must be verified in a browser at a phone viewport per CLAUDE.md's own invariant, not just `next build` passing.

## Out of Scope (confirmed with user via Phase 1/2)

- Guardian self-service, consent/medical intake (Increment B), check-in (Increment C, blocked on the events model), kiosk (Increment D), background checks — all as recorded in Phase 1/2.
- The DB-level `person_relationships` CHECK constraint and the RLS `related_person_id` gap — named above, not fixed here, tracked in `docs/TODO.md`.

## Implementer

**One `full-stack-developer` pass**, not a `database-admin` + `full-stack-developer` split. The schema piece is a single permission-catalog INSERT with no table/trigger/index change — the same shape DECISION-108's sensitive-info pipeline and DECISION-103's branding pipeline both folded into their full-stack commit rather than splitting out, and CLAUDE.md's own Implementer table's "small/coupled" test is a closer fit here than `2026-08-26-groups-admin`'s split (which needed a genuine trigger-widening migration with independent SQL-layer regression tests — no such thing exists in this design). One implementer, one commit, one work-log Phase 4 section.

---

# Phase 4 — Implementation

**Implementer:** full-stack-developer · **Date:** 2026-08-27

## Migration Number Claimed

Phase 3 penciled `0035`. Re-ran `ls drizzle/` immediately before creating the
file, per instruction — `0034_presby_directory_permission_copy.sql` (a
concurrent pipeline) was the latest on disk, so `0035` was in fact still
free. Claimed as `0035_presby_children_ministry_permission.sql`; journal
entry (`idx: 35`) added to `drizzle/meta/_journal.json` in the same commit.

## Files Created

- `drizzle/0035_presby_children_ministry_permission.sql` — permission-catalog
  row for `children.roster` (module `children`, tier 2), `on conflict (key)
  do nothing`, hand-written per the post-0012 convention.
- `src/lib/children.ts` — the module: `getChildrenRoster`,
  `getGuardianLinksForEdit`, `addGuardianLink`, `updateGuardianLink`,
  `removeGuardianLink`, `searchLinkablePeople`. Same shape as
  `person-sensitive.ts` (permission-check-first, typed result unions,
  enumeration-safe `not_found` collapse). `searchLinkablePeople` is one
  addition beyond Phase 3's literal API contract — a lightweight, org-scoped,
  `children.roster`-gated typeahead backing the guardian-link form's "link an
  existing person" default mode, which Phase 3's Component Plan required but
  didn't spell out a mechanism for; kept inside this module (not a new file)
  since it shares the same gate and touches no new table.
- `src/lib/children.test.ts` — 23 Postgres-backed tests: permission gate,
  enumeration safety, age-cutoff logic (under-18-with-DOB included; adult and
  no-DOB people excluded), guardian-count computation, household-name join,
  XOR validation (both/neither of `relatedPersonId`/`relatedName`),
  relationship allow-list, server-side length limits, the existence-oracle
  narrowing (linking to a person with no membership at the acting org),
  not_found for cross-org and unknown-link-id cases, and cross-org isolation
  via `withOrgContext`. Same harness as `person-sensitive.test.ts`, including
  its `group_memberships_reject_derived` trigger-disable teardown wrap (this
  fixture creates an "Active Membership" derived group). Run for real:
  `npx dotenv -e .env.local -- vitest run src/lib/children.test.ts` — 23/23
  pass against the real dev database.
- `src/app/(org)/o/[slug]/admin/members/children/page.tsx` — the roster page.
  Auth → flag (bare, no org toggle) → `getChildrenRoster()`. Empty state, load
  error, forbidden, and flag-off states follow the shared `members-states.tsx`
  components.
- `src/app/(org)/o/[slug]/admin/members/children/children-roster-list.tsx` —
  the roster list component: name, age, household, guardian count / "no
  guardian on file" badge; links each row to `edit/guardians`.
- `src/app/(org)/o/[slug]/admin/members/children/page.test.tsx` and
  `children-roster-list.test.tsx` — gate composition, empty state, and badge
  logic.
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/guardians/page.tsx` — the
  guardian-link sub-page, mirroring `edit/sensitive/page.tsx`'s structure
  (own route, own flag-off/forbidden/not-found states, single permission).
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/guardians/actions.ts` —
  `addGuardianLinkAction`, `updateGuardianLinkAction`,
  `removeGuardianLinkAction`, and `searchLinkablePeopleAction` (backing the
  typeahead; returns an empty-list `ok:true` on any denial rather than a
  forbidden-shaped error, since a search box has no honest "you can't search"
  state distinct from "no matches" once the page itself has already gated).
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/guardians/guardian-link-form.tsx`
  — the client island: existing-links list (edit/remove inline), and the
  add-guardian form with its two modes (link an existing person via search —
  default; enter a name only — fallback).
- `guardians/page.test.tsx`, `guardians/actions.test.ts`,
  `guardians/guardian-link-form.test.tsx` — orchestration, action, and
  component tests respectively.

## Files Modified

- `drizzle/meta/_journal.json` — journal entry for migration `0035`.
- `scripts/seed-dev.sql` — permission-catalog insert for `children.roster`;
  new `app_roles` row `children_ministry_admin`
  (`f0000000-0000-0000-0000-00000000000d`, constitutional, protected);
  `app_role_permissions` binding it to `children.roster` alone;
  `role_grants` direct-granting it to Wren Thackeray
  (`c0000000-0000-0000-0000-000000000008`), an active household head holding
  zero roles before this pipeline; and the first-ever `person_relationships`
  fixture row (Hallie Vandermeer ↔ Tobias Renwick, `parent`,
  `is_emergency_contact = true`), giving the roster a real "1 guardian on
  file" case and leaving every other fixture org's roster (Bramblewood,
  Quillhaven have no under-18 fixture people) exercising the empty state.
- `scripts/seed.ts` — new flag block, `org_portal.children_ministry`, checked
  bare (no org toggle), seeded `enabled: false`.
- `src/lib/audit.ts` — three new keys:
  `TENANT_PERSON_RELATIONSHIP_ADDED`/`_UPDATED`/`_REMOVED`.
- `src/lib/audit.test.ts` — added the three new keys to the pinned
  `EXPECTED_ENTRIES` snapshot (regression for audit-string drift).
- `src/app/(org)/o/[slug]/admin/members/page.tsx` — "Children's roster" link,
  rendered only when `org_portal.children_ministry` is on AND the viewer
  holds `children.roster` (independent awaited `hasPermission()` call
  alongside the existing `people.manage` check).
- `src/app/(org)/o/[slug]/admin/members/page.test.tsx` — three new tests for
  the link's gate composition (flag off / permission denied / both granted).
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/page.tsx` — co-located
  "Guardians" card, rendered only when `org_portal.children_ministry` is on
  AND `hasPermission(..., "children.roster")` is true — an independent
  awaited call, not folded into the sensitive-info link's own `Promise`
  chain (Phase 3 Edge Cases note on cross-contamination risk).
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/page.test.tsx` — added
  `hasPermission` mock, extended `mockFlags`, and three new tests for the
  guardians-card gate; the pre-existing card-count-is-3 test is unaffected
  (its `mockFlags` call doesn't set `childrenMinistry`, which defaults false).
- `docs/TODO.md` — removed the now-resolved "`person_relationships` editing
  remains unbuilt" line (moved to Done); added three Next Up follow-ups for
  the named, accepted gaps (no-DOB children invisible to the roster; the
  still-missing DB-level CHECK constraint on `person_relationships`; the
  still-unfixed RLS existence-oracle on `related_person_id`, narrowed but not
  closed at the DB layer).

## Schema Changes

- One permission-catalog row (`children.roster`) via
  `drizzle/0035_presby_children_ministry_permission.sql`. No table, column,
  trigger, or index change — children stay ordinary `people`/`memberships`
  rows; guardian linking reuses the existing global `person_relationships`
  table.
- Applied via `npm run db:push` is not needed for a data-only migration like
  this — the dev DB already carried a `children.roster` permissions row
  (confirmed live) and the fixture bindings are seed-only (`scripts/
  seed-dev.sql`, not run against the shared dev DB — that DB has its own
  independent fixture data, see Live Verification below).

## Audit Events

- `TENANT_PERSON_RELATIONSHIP_ADDED` (`tenant.person_relationship.added`) —
  `addGuardianLink`. Metadata: `{ organizationId, childPersonId, relationship }`.
- `TENANT_PERSON_RELATIONSHIP_UPDATED` (`tenant.person_relationship.updated`)
  — `updateGuardianLink`. Same metadata shape.
- `TENANT_PERSON_RELATIONSHIP_REMOVED` (`tenant.person_relationship.removed`)
  — `removeGuardianLink`. Metadata: `{ organizationId, childPersonId }`.
- No audit on reads (`getChildrenRoster`, `getGuardianLinksForEdit`,
  `searchLinkablePeople`), same posture as every other read in this tree.

## Mechanical Gates

- `npm run typecheck` — clean.
- `npm test` — 192 files / 2609 passed, 0 failed, 451 skipped (mocked suite).
- DB-backed suite: `npx dotenv -e .env.local -- vitest run
  src/lib/children.test.ts` — 23/23 passed against the real dev Postgres.
- `npm run build` — clean; both new routes
  (`/o/[slug]/admin/members/children`, `.../[id]/edit/guardians`) appear in
  the route manifest.
- `npm run check` (audit-coverage, sql-date, deps-drift, brand-scope) — all
  four tripwires pass.

## Live Verification (real dev server + real dev database)

Session: `/tmp/state.json` (fpcw org, `dev_admin` role holder). Two grants
made directly against the shared dev database, the same way earlier
permissions were granted today (not via `scripts/seed-dev.sql`, which is
local-fixture-only and never touches the shared dev DB):

1. `insert into app_role_permissions (role_id, permission_key) values
   ('ef8c79c2-9c93-43ec-87c7-a446df8d017b', 'children.roster')` — the
   `dev_admin` role scoped to fpcw.
2. `insert into feature_flags (key, description, enabled) values
   ('org_portal.children_ministry', …, true) on conflict (key) do update
   set enabled = true` — every other `org_portal.*` flag in this dev DB is
   already flipped true for the same reason (seeded off in `scripts/
   seed.ts`, turned on live for verification); left on, matching that
   convention.

Both left in place after verification (not reverted) — same posture as the
existing `medical.manage`/`disabilities.manage`/etc. grants already on that
role, per the instruction to grant "the same way earlier permissions were
granted today."

Verified via Playwright driving a real Chromium session against
`localhost:3000` at desktop (1280×900) and mobile (390×844):

- `/o/fpcw/admin/members` — "Children's roster" button renders next to "Add
  person."
- `/o/fpcw/admin/members/children` — real fpcw fixture data: Lena Kowalczyk
  (7), Ike Okafor (10), Zuri Okafor (14), Piper Whitfield (17), all correctly
  under the 18-year cutoff and all showing "No guardian on file" (this dev DB
  has zero `person_relationships` rows) — confirms the empty-guardian badge
  and the age-cutoff SQL against real data, not just fixtures.
- `/o/fpcw/admin/members/[id]/edit/guardians` (Zuri Okafor) — empty state
  ("No guardians on file"), add-guardian form defaults to "Link an existing
  person," relationship dropdown, emergency-contact checkbox, notes field.
- **End-to-end write path exercised live**: searched "Amara" → selected Amara
  Okafor → checked emergency contact → submitted → "Guardian added" toast →
  roster immediately re-read as "1 guardian on file" for Zuri Okafor →
  re-opened the guardians page and confirmed the row rendered ("Amara Okafor
  / Parent · Emergency contact," Edit/Remove buttons) → clicked Remove →
  "Guardian removed" toast → confirmed via a direct DB query that
  `person_relationships` for Zuri Okafor is back to zero rows (dev DB left
  as found).
- `/o/fpcw/admin/members/[id]/edit` — the new "Guardians" card renders
  alongside the existing "Pastoral notes, demographics, medical & disability
  information" card, independently gated.
- Mobile (390px): all four surfaces re-verified — single-column layout,
  stacked radio group, full-width inputs, 44px+ tap targets on Edit/Remove/
  Add guardian, no horizontal overflow.

## Implementer Notes

- **`searchLinkablePeople`/`searchLinkablePeopleAction`** are the one
  addition beyond Phase 3's literal API contract (see Files Created above) —
  needed to make "the UI defaults to linking existing people rows" (DECISION-
  111 ruling 4) actually operable; gated on `children.roster` rather than
  `directory.view` so a `children_ministry_admin` holder who lacks
  `directory.view` can still search.
- **Guardian-link edit UI** covers relationship/emergency-contact/notes
  inline (not re-choosing which person/name the link points at) — editing
  *who* a link points at was judged out of scope for a v1 whose whole point
  is "link once, correct the details later"; re-pointing a link is
  functionally equivalent to remove-then-add, which the UI already supports.
- **`getGuardianLinksForEdit`** resolves the linked person's display name
  server-side (`relatedPersonName`) — not in Phase 3's literal `GuardianLink`
  interface, but required for the edit form to render anything meaningful for
  an existing-person link without a second round trip.
- Confirmed via `grep -rn "Hallie\|Vandermeer\|Renwick" src/**/*.test.ts*`
  (per Phase 3's own instruction) that no existing test snapshot-asserts a
  guardian count or exact-matches a full profile render for either fixture
  person — every hit is either a display-name string in an independently
  mocked fixture (unaffected by the new `person_relationships` row) or this
  pipeline's own new tests.
- No table/trigger/index change, so no `database-admin` split — one
  implementer, one commit, matching Phase 3's own Implementer ruling.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-27
**Verified by:** qa

## Type Check

`npm run typecheck`: PASS (clean)

## Unit Tests

Total: 3060 (192 files) | Passed: 2609 | Failed: 0 | Skipped: 451 (pre-existing `hasDb`-gated pattern). Reproduced the implementer's numbers exactly. DB-backed `children.test.ts`: **23/23** against real Postgres, reproduced. Teardown wrap (`children.test.ts:233-253`) follows the try/finally trigger-disable convention correctly.

## End-to-End Tests

Not applicable — not auth-touching (confirmed via git status). Live verification performed via real dev server + real Postgres instead; the claims (real fpcw children with computed ages, full add/read/remove cycle confirmed to zero rows, 390px) are specific and internally consistent.

## Regression Tests Added

- XOR validation on `relatedPersonId`/`relatedName` (`children.test.ts:337-365`) — regression for the DB CHECK constraint 0008 never applied.
- Server-side length limits rejected before any query (`:368-388`) — regression for the sensitive-info pipeline's client-only gap repeating. Note: these assert the audit mock wasn't called + the typed shape; the "no DB write" property is confirmed by reading the source (`validateGuardianLinkInput()` returns before `withOrgContext` is entered), not by a row-count assertion. Noted, not a FAIL.
- Existence-oracle narrowing (`:410-417`) — closes DECISION-111's named-but-declined gap.
- `audit.test.ts` snapshot pins the three new keys.

## Coverage on Critical Modules

`permissions.ts`/`two-factor.ts`/`flags.ts` untouched. `src/lib/children.ts` covered by 23 integration tests spanning every export and both success/denial branches.

## Feature-Gate Audit

All exports of `src/lib/children.ts` gate on `children.roster` first inside `withOrgContext` (gate-then-read), including `searchLinkablePeople` — which also scopes strictly to `m.organization_id = organizationId`, excludes merged/deceased rows, caps at 8 results; the DB-backed test proves an org-B person is excluded from an org-A search. Actions re-resolve org/person server-side and delegate (never duplicate) the permission check; `searchLinkablePeopleAction`'s denial collapses to an empty list by design (no distinguishable denied state on an already-gated page). Both new pages: bare flag check + the lib's own gate (defense in depth). Both new UI affordances (members-page link, edit-page card): independent `hasPermission` checks, absent-never-disabled, not merged with sensitive-info's promise chain.

## Additional Verification

- `npm run build` clean, both new routes in the manifest. `npm run check`: all four tripwires pass.
- DECISION-114's DOB ruling implemented exactly, deliberate-and-documented in-code (`children.ts:223-251`), scoped to this one query.
- Age cutoff computed in the SQL itself (`date_of_birth > current_date - interval '18 years'`), no stored flag, no-DOB rows silently excluded — confirmed in query text + test.
- Fixture sanity: no `app_roles.id` collisions across all 13 fixture roles; Wren Thackeray carries exactly one grant — not overloaded.

## Verdict

**PASS**

`searchLinkablePeople` — the highest-risk addition — is correctly gated and org-scoped with no enumeration leak. Every mutation fires its audit key on the ok branch only. All numbers reproduced independently.

**Handoff:** analyst (Phase 6).

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

SHIP WITH NOTES

## ONE-LINE TAKE

> The roster and staff guardian-linking foundation Phase 1 asked for is genuinely delivered — usable, honestly-scoped, and correctly gated — but housekeeping (release notes, functionality-map, tracking for Increments B/C) was unfinished at review time, and the `children.roster` permission description should disclose its DOB-unmasking scope.

## What's Working

- The roster's empty state does double duty as an honest disclosure of the no-DOB exclusion ("Children appear here once a date of birth is on file and they are under 18"), not just filler.
- The guardians sub-page mirrors `edit/sensitive/` exactly; add/edit/remove verified live at 390px with a full cycle against real fixture data.
- `children.roster` cleanly separated from `member_care_admin` — a Sunday-school coordinator gets the roster, not allergy data, exactly as Phase 1 demanded.
- Audit coverage on all three mutations, none on reads — consistent with the tree.

## Intent-vs-Shipped Diff

- Phase 1's staff-entry scope: shipped exactly, nothing more or less. **Matches.**
- The F21-shaped adversarial finding → shipped as an existence-oracle narrowing (related person must hold active org membership), correctly not oversold as a full fix. **Matches, documented honestly.**
- Phase 3's release-notes item → **not shipped** (no v0.17 entry, no v0.18 draft existed at review). **Gap** — closed by the orchestrator at commit time.

## Edge Cases

- Empty state / failure microcopy / permission gate / audit / mobile 390px: all **pass** (details in the QA section).
- **Real non-blocking gap:** the no-DOB disclosure only shows on an empty roster — a populated roster with children missing DOBs shows no hint anyone is invisible. Follow-up: a persistent "N children may be missing" notice.
- **DECISION-114 judgment:** the DOB bypass is proportionate and precedented; the issue is disclosure at grant time — `children.roster`'s catalog description didn't mention it unmasks a birthdate `hide_birthday` was set to conceal. Follow-up: one-line description addition (closed by the orchestrator at commit time).

## Follow-Ups (SHIP WITH NOTES)

1. Release-notes entry (v0.18) — orchestrator, commit time.
2. `docs/product/functionality-map.md` line — orchestrator, commit time.
3. Increment B (consent/medical intake) tracked as Next Up; Increment C noted as blocked on `2026-08-26-events-model` — orchestrator, commit time.
4. `children.roster` description discloses the DOB unmasking — orchestrator, commit time.
5. Minor UX: persistent missing-DOB notice on a populated roster; a zero-results message in the guardian search — tracked as follow-ups.

Rule 12: N/A (no feedback origin). Rule 13: correctly deferred (flag seeded off).

## Per-Phase Status update

| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-27 |
