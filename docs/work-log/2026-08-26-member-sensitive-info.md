# Member Edit: Tiered Sensitive Information — Work Log

> **Slug:** `2026-08-26-member-sensitive-info`
> **Surface:** (org) — `/o/<slug>/admin/members/[id]/edit`
> **Permission(s):** NEW tier-2/3 permission key(s), scoped per table/domain — not yet named
> **Flag(s):** recommend a NEW dedicated flag (e.g. `org_portal.sensitive_info`), not reusing `org_portal.members_create`
> **Estimated complexity:** medium-large
> **Pipeline mode:** Full — Split out of `2026-08-26-member-roll-and-sensitive-info` on Phase 1's own recommendation. **Operator confirmed 2026-08-26: fixed existing fields (reading 1), not per-tenant custom fields.** Unblocked for Phase 2.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (inherited) | READY WITH NOTES | 2026-08-26 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-26 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-08-26 |
| 4 — Implementation | full-stack-developer | Complete | Design implemented; typecheck/tests/tripwires clean; migration + fixture applied to real dev DB | 2026-08-26 |
| 5 — Verification | qa | Complete | PASS | 2026-08-26 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-26 |

---

# Phase 1 — Functional Refinement (analyst)

**Inherited from `docs/work-log/2026-08-26-member-roll-and-sensitive-info.md`'s combined Phase 1 pass — see that file for the full shared analysis. This section extracts only what applies to this half.**

## VERDICT

READY WITH NOTES — but genuinely blocked pending one operator answer (see Open Questions #1, the D8 fork).

## ONE-LINE TAKE

> "Track more sensitive info" is standing up a UI and a new tier-3 permission surface for four tables (`person_notes`, `person_demographics`, `person_medical`, `person_disabilities`) that have existed in the schema since the original domain design and have had zero read/write path anywhere in the app — this is new permission-model work, not a form addition, and it must not be confused with per-tenant custom fields.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Authenticated member holding a new tier-2/tier-3 permission — `/o/<slug>/admin/members/[id]/edit` (or a linked sub-screen) | Enters/updates pastoral notes, demographics, medical/allergy info, or disability records for a person | On demand |
| Authenticated member **without** that permission — same screen | Does not see the sensitive-info section at all (not greyed out — absent) | Every visit |

## Flows

**Flow 1 — View/enter sensitive info:** `/o/<slug>/admin/members/[id]/edit` → if the actor holds the (currently nonexistent) sensitive-info permission, an additional section renders → actor reads/adds/edits pastoral notes / demographics / medical / disability fields → Save → writes to `person_notes` / `person_demographics` / `person_medical` / `person_disabilities` → outcome: values persist and are visible only to holders of the matching permission on next load.
- Failure: not addressed by the request — what does a *denied* save (permission revoked between page load and submit) look like versus a validation failure? Also unaddressed: one save action for all four tables, or four independent ones?

## Permissions & Flags

- **Permission(s):** **new.** Presby's permission catalog (`sensitivity_tier` column, resolved via `presby_has_permission()`) already has the tiering *mechanism* — it just has no tier-3 keys registered for these four tables yet. Should not be one blanket `people.view_sensitive` key; should be scoped at least by domain (pastoral notes vs. demographics vs. medical), matching how `person_notes.visibility` already distinguishes `staff | pastoral | clergy_only` in-column.
- **Default roles:** explicitly **not** the generic admin role by default for pastoral/medical (tier 3 sits above financial per the invariant). Needs a real answer from the operator/tech-lead.
- **Flag(s):** recommend a dedicated flag (e.g. `org_portal.sensitive_info`) separate from `org_portal.members_create` — the risk profile (leaking pastoral/medical data to the wrong role) shouldn't share a kill switch with "can this office add a member."

## Gaps the Request Didn't Address

- **The D8 fork — the central blocking question.** "Enter and track more church related personal information" reads two ways:
  1. Expose UI for the fixed, already-designed tier-2/3 tables (`person_notes`, `person_demographics`, `person_medical`, `person_disabilities`) the schema has modeled since the original domain design but no screen has ever touched. In scope, bounded, doesn't touch D8.
  2. Let a congregation define its own arbitrary fields ("more information" as a per-tenant custom-field request) — the exact anti-pattern D8 exists to block: *"No custom fields... Tags are the only tenant-extensible attribute. A new need is a support ticket and, if real, becomes a feature for every church."*
  Analyst's working assumption is reading (1). **This assumption needs the operator's explicit confirmation before Phase 2 starts.**
- **Granularity vs. the cited prior art.** `fpcw-directory`'s `src/lib/members/visibility.ts` (per-field, viewer-permission-driven) is presby's already-implemented analog for tier-1 data (`person_privacy`, wired into `src/lib/directory.ts`). Tier-3 has no existing gating implementation to copy — fpcw-directory never had this tier. Phase 3 is extending a pattern for tier 1, but inventing one for tier 3.
- **Audit story.** Writes to the four sensitive tables are not named anywhere in Rule 7's audit list, and tier-3 data is the most sensitive category in the system. Should a sensitive-data write itself fire `recordAudit()`? Needs an explicit architect/tech-lead call.
- **Empty state, failure microcopy, mobile, input boundaries (unbounded free-text columns)** — not addressed by the request, all need Phase 3 definition.

## Adversarial Pass

- **Enumeration:** a person with an empty `person_medical` row and a viewer denied the medical permission must render identically — extend `getPersonForEdit`'s existing typed `forbidden`/`not_found` distinction, not a new response shape that could leak "this table has a row."

## Out of Scope (confirm with user)

- Building a genuinely new per-field visibility engine matching fpcw's `getVisibleFields()` pattern for tier-3 data — recommend table-level (or domain-level) permission gates for v1, not a bespoke per-field predicate system, unless finer granularity is specifically needed.

## Open Questions

1. **BLOCKING — the D8 fork:** is "more church related personal information" asking for UI on the four already-modeled fixed tables (working assumption), or something closer to per-tenant custom fields? If the latter, this needs to go back to the user as a support-ticket-style conversation per D8, not a design.
2. Which roles get sensitive-info visibility by default, split by table (pastoral notes / demographics / medical / disabilities)?
3. Should a tier-3 data write itself fire `recordAudit()`?

**Handoff:** holds at Phase 1 until the operator answers Open Question #1. Do not invoke architect until then.

---

# Phase 2 — Architectural Review (architect)

## Verdict

Approved with suggestions

## Placement

- **Directory placement:** a linked sub-screen, `src/app/(org)/o/[slug]/admin/members/[id]/edit/sensitive/` (page + co-located `actions.ts`), not a section inline on `edit/page.tsx`. Reasons: (1) the four domains carry four independent permission keys — an inline section would force the main edit page to run up to four extra `presby_has_permission()` checks and fetches on every load, most of which most viewers will fail; (2) it lets the sub-route apply the same enumeration-safe `forbidden`/`not_found` collapse `getPersonForEdit` already uses, independently of the tier-1 edit fetch; (3) it matches the `members/pending/` precedent of a sibling segment carrying its own gated surface. The edit page shows a link into this sub-screen only when the viewer holds at least one of the four permissions — absent, not disabled, per Phase 1's requirement.
- **Server vs Client split:** the sub-screen page is a Server Component (reads via a new `getSensitiveInfoForEdit()`, same shape as `getPersonForEdit`). The form itself is a Client Component (`'use client'`) for controlled inputs and save-state, mirroring `edit-person-form.tsx`'s existing split.
- **Dependencies:** none — existing shadcn primitives and form-action conventions cover this.

## Invariants Touched

- **No Role Carries a Wildcard.** Four new tenant permission keys, all `sensitivity_tier = 3`, named by domain (matching `module.action` convention): `pastoral_notes.manage` (gates `person_notes` — the strictest grant in the system per that table's own header), `demographics.manage` (gates `person_demographics`), `medical.manage` (gates `person_medical`), `disabilities.manage` (gates `person_disabilities`). Four keys is the right granularity floor — not finer (no per-field permission engine; affirms Phase 1's rejection of a bespoke `getVisibleFields()`-style predicate for tier 3) and not coarser (rejects one blanket `people.view_sensitive` key). `pastoral_notes.manage` grants table-level access only — it does NOT itself enforce the in-column `visibility` (`staff | pastoral | clergy_only`) distinction, which Phase 3 must apply as a further read-time filter (same shape as `directory.ts`'s hide_email/hide_phone CASE-WHEN nulling), not a second permission key.
- **Default role bindings — DECISION-078's test applied per key, not as a bundle.** A single new role holding all four would itself be a tier-3 wildcard — rejected outright.
  - `pastoral_notes.manage`: plausible constitutional fit against a pastoral office — Phase 3 confirms via DECISION-078's test before binding, not assumed here.
  - `demographics.manage`: SASR compilation is documented as the Clerk of Session's duty — a candidate for `stated_clerk`, but Phase 3 must run the actual test, not bind by convenience.
  - `medical.manage` / `disabilities.manage`: no office has an obvious constitutional claim. **No existing role starts with either** — mint a new role (brand_admin-shaped: protected/constitutional role kind, person-vs-group grant arm left to Phase 3).
  - No key binds to the generic admin role by default, full stop.
- **Audit.** All four tables' writes are security-sensitive tier-3 mutations and must fire `recordAudit()` — no exemption. Distinct per-table keys, `tenant.*` prefix: `TENANT_PERSON_NOTE_ADDED` (`tenant.person_note.added`), `TENANT_PERSON_DEMOGRAPHICS_UPDATED` (`tenant.person_demographics.updated`), `TENANT_PERSON_MEDICAL_UPDATED` (`tenant.person_medical.updated`), `TENANT_PERSON_DISABILITY_SET` (`tenant.person_disability.set`). Exact CRUD shape (append-only notes vs. upsert-singleton demographics/medical vs. set-of-categories disabilities) is Phase 3's to pin down; the audit obligation is fixed regardless of shape.
- **D8 — not implicated, holding the operator's confirmed line.** This design targets four fixed, already-typed columns on four already-modeled tables — UI and permissions on existing schema, not tenant-defined fields. What WOULD implicate D8 (bright line for Phase 3/4): any admin-configurable field name/type/label for these tables; any JSON/`extra_fields`-shaped column absorbing arbitrary per-tenant data; or adding a genuinely new column because one congregation asked, outside the support-ticket path. If any of that surfaces in Phase 3, it returns to Phase 1.
- **Enumeration/denial.** `getSensitiveInfoForEdit()` returns the same `{ kind: "ok" | "forbidden" | "not_found" }` union `getPersonForEdit`/`getPersonDetail` already use — an empty `person_medical` row for an authorized viewer and a denied viewer must produce byte-identical shape/timing.

## Notes

- Phase 3 must decide, per permission key independently, whether an existing office passes the DECISION-078 test before binding — no default binding "because it's convenient," no bundled tier-3 role.
- Phase 3 must specify write semantics (insert-only vs. upsert vs. set-replace) per table before `actions.ts` is designed.
- The `person_notes.visibility` column (`staff | pastoral | clergy_only`) is a second, finer-grained filter beneath `pastoral_notes.manage` — Phase 3 must specify how it further restricts what a holder sees, not just whether they can reach the table.

**Verdict: Approved with suggestions.** Handoff: tech-lead (Phase 3).

---

# Phase 2 — Architectural Review (architect)

## Verdict

[Approved | Approved with suggestions | Needs revision]

## Placement

- Directory placement: [src/...]
- Server vs Client split: [where 'use client' is needed and why]
- Dependencies: [new dep needed (yes/no), evaluation against criteria]

## Invariants Touched

- [Invariant, how this change respects it (or how it changes it — requires CLAUDE.md update)]

## Notes

[Anything Phase 3 must honor.]

---

# Phase 3 — Technical Design (tech-lead)

## Summary

We're building one new sub-route, `/o/<slug>/admin/members/[id]/edit/sensitive`, that surfaces four tier-3 tables the schema has carried since the original domain design but no screen has ever touched: pastoral care notes (`person_notes`), SASR demographics (`person_demographics`), children's-safety medical info (`person_medical`), and per-person disability records (`person_disabilities`). Each table gets its own permission key and each key is bound — or deliberately not bound — to an existing constitutional office only where DECISION-078's test actually passes; where it doesn't, a new narrowly-scoped role is minted rather than defaulting to the generic admin or bundling everything onto `stated_clerk`. No schema changes: this is UI, permissions, and write paths on top of tables that already exist.

## Permissions & Flags

- **Permission keys** (four, `sensitivity_tier = 3`, per architect's Phase 2 naming — not relitigated here):
  - `pastoral_notes.manage` — gates `person_notes`.
  - `demographics.manage` — gates `person_demographics`.
  - `medical.manage` — gates `person_medical`.
  - `disabilities.manage` — gates `person_disabilities`.
- **Default role bindings** (DECISION-078's test run per key, see `docs/decisions.md` DECISION-108 for the full reasoning):
  - `pastoral_notes.manage` → **`installed_pastor`** (existing role, `f0000000-…-0008`). Passes DECISION-078: pastoral care and clergy confidentiality (`person_notes.visibility = 'clergy_only'`) is literally the pastoral relationship this office already names, per DECISION-079's own reasoning for the same table. **This retires the orphaned `pastoral.notes.view` permission** (seeded only in `scripts/seed-dev.sql`, bound to `installed_pastor` under DECISION-079/080, never wired to any read/write path) — one key per table, not two overlapping ones for the same data.
  - `demographics.manage` → **`stated_clerk`** (existing role, `f0000000-…-0005`). Passes DECISION-078: `docs/schema-design.md` (§ demographics, disability) ties SASR demographic/disability compilation directly to "clerks," and DECISION-078 already established "register-keeping is squarely the Clerk of Session's own constitutional duty" as the passing precedent for this exact office — demographics compilation is a direct extension of the SASR duty `roll.propose`/`officers.manage` already sit on. No new `role_grants` row: Tobias Renwick's existing `stated_clerk` grant carries it for free, same "no new grant row" pattern as every prior addition to that office.
  - `medical.manage` **and** `disabilities.manage` → **new role, `member_care_admin`** ("Member Care Administrator"). Neither table has a constitutional analog: `person_medical` is children's-check-in safety data (allergies, medications, pickup authorization) with no PC(USA) office correlate, and `person_disabilities` is explicitly the schema's "sharpest edge" — staff-observed, non-consensual, per-person data distinct from the *aggregate* SASR disability line `stated_clerk` already touches. Bundling these two (not four) onto one role is not a wildcard: both are staff-observed, non-consensual, safety/accommodation data with no polity vote behind either, a single coherent purpose ("whoever holds accountability for vulnerable-person safety and accommodation records"), not "every capability." `role_kind = 'constitutional'`, `is_protected = true` (mirrors `brand_admin`'s DECISION-101 shape — a baseline role every org should have available, not a staff-invented committee role), person-arm grant, direct-granted (mirrors `brand_admin`/`support_contact`: an ordinary single-accountable-office action, nothing for a group grant to represent). Fixture-bound to Aldous Fennimore (`c0000000-…-0007`), an active household head holding no other role today — avoids stacking a fifth capability onto Tobias Renwick, Marguerite Ashcombe, Priya Balakrishnan, or Rowan Thistlewood, all already-loaded office-holders.
  - No key binds to the generic admin role. No role holds more than two of the four keys, and the two that share a role (`member_care_admin`) are the two with no constitutional analog at all.
- **Feature flag:** new, dedicated `org_portal.sensitive_info` (Phase 1's recommendation, confirmed) — seeded `enabled: false` in `scripts/seed.ts`, same shape as `org_portal.members_create`. NOT reused from `org_portal.members_create`: that flag's kill switch covers person/roll creation, a materially different risk profile than leaking pastoral/medical/demographic data to the wrong role. Gate order per DECISION-097's three-axis pattern: `isFlagEnabled("org_portal.sensitive_info")` → `isOrgFeatureEnabled(..., "org_portal.sensitive_info")` (per-org toggle, same key) → the relevant `presby_has_permission()` check(s) inside the read/write functions themselves. The flag/toggle gate the *sub-route's existence*; which of the four sections render is decided entirely by permission, never by the flag.

## API Contract

Read (Server Component only, `src/lib/person-sensitive.ts`, new sibling module to `people.ts`/`roll.ts` — same one-file-per-domain-transaction shape, not folded into `people.ts` since this is a fully separate four-table domain with its own four permissions):

```ts
export type GetSensitiveInfoGrants = {
  pastoralNotes: boolean;
  demographics: boolean;
  medical: boolean;
  disabilities: boolean;
};

/** Cheap, permission-only read. Used by the main edit page to decide whether
 * to render the link into /edit/sensitive at all (absent, not disabled). */
export async function getSensitiveInfoGrants(
  viewerPersonId: string,
  organizationId: string,
): Promise<GetSensitiveInfoGrants>;

export interface SensitiveInfoForEdit {
  personId: string;
  grants: GetSensitiveInfoGrants;
  /** Present iff grants.pastoralNotes. clergy_only rows omitted entirely for
   * a non-clergy viewer (see Edge Cases — visibility filter). */
  notes?: Array<{
    id: string;
    noteType: string;
    visibility: "staff" | "pastoral" | "clergy_only";
    body: string;
    occurredOn: string | null;
    authorUserId: string;
    createdAt: string;
  }>;
  /** Present iff grants.demographics. null = no row yet (never nulled by
   * permission — absence here always means "not entered", not "hidden"). */
  demographics?: { gender: string | null; racialEthnic: string[] | null; source: string } | null;
  /** Present iff grants.medical. */
  medical?: { allergies: string | null; medicalNotes: string | null; medications: string | null; authorizedPickup: string | null } | null;
  /** Present iff grants.disabilities. Empty array = no categories recorded. */
  disabilities?: string[];
  /** organizationSettings.settings.trackDisabilityPerPerson — the
   * disabilities section renders only when this is true AND
   * grants.disabilities is true (both, not either). */
  disabilityTrackingEnabled: boolean;
}

export type GetSensitiveInfoForEditResult =
  | { kind: "ok"; data: SensitiveInfoForEdit }
  | { kind: "forbidden" }   // viewer holds NONE of the four permissions
  | { kind: "not_found" };  // same collapse as getPersonForEdit

export async function getSensitiveInfoForEdit(
  viewerPersonId: string,
  organizationId: string,
  personId: string,
): Promise<GetSensitiveInfoForEditResult>;
```

Server actions (`.../edit/sensitive/actions.ts`, same `"use server"` / `auth()` / `resolveOrgContext()` re-run plumbing as `edit/actions.ts`):

```ts
// person_notes — INSERT ONLY, no update/delete in v1.
export async function addPersonNoteAction(
  slug: string,
  personId: string,
  input: { noteType: string; visibility: "staff" | "pastoral" | "clergy_only"; body: string; occurredOn?: string },
): Promise<ActionResult<{ noteId: string }>>;

// person_demographics — UPSERT (singleton row per person).
export async function setPersonDemographicsAction(
  slug: string,
  personId: string,
  input: { gender: string | null; racialEthnic: string[] | null; source: "self" | "staff" },
): Promise<ActionResult<{ personId: string }>>;

// person_medical — UPSERT (singleton row per person).
export async function setPersonMedicalAction(
  slug: string,
  personId: string,
  input: { allergies: string | null; medicalNotes: string | null; medications: string | null; authorizedPickup: string | null },
): Promise<ActionResult<{ personId: string }>>;

// person_disabilities — SET-REPLACE (delete-then-insert the whole category
// set for this person, one transaction). Rejects if
// organizationSettings.settings.trackDisabilityPerPerson is false (defense
// in depth — the UI already hides the section in that case).
export async function setPersonDisabilitiesAction(
  slug: string,
  personId: string,
  input: { categories: string[] },
): Promise<ActionResult<{ personId: string }>>;
```

Every action re-runs `resolveOrgContext()`, never trusts `organizationId` from the client, and delegates its own `presby_has_permission()` check to the matching `person-sensitive.ts` function — same discipline as `updatePersonAction`/`updatePerson()`.

## Data Model

No schema changes required for `person_notes`, `person_demographics`, `person_medical`, or `person_disabilities` — all four already exist, fully typed, unmodified. New objects, all catalog/authorization rows, none touching the four data tables:

- **Migration** (`drizzle/00XX_presby_sensitive_info_permissions.sql`, hand-authored per the post-0012 convention): inserts the four permission-catalog rows (`pastoral_notes.manage`, `demographics.manage`, `medical.manage`, `disabilities.manage`, all `sensitivity_tier = 3`) into the global `permissions` table, `on conflict (key) do nothing` — same shape as `drizzle/0029_presby_officers_permission.sql`. Same migration retires the orphaned fixture-only key: `delete from app_role_permissions where permission_key = 'pastoral.notes.view'; delete from permissions where key = 'pastoral.notes.view';` — both idempotent no-ops if the row is already gone.
- **`scripts/seed-dev.sql`** (fixture-only, no production role-seeding surface exists yet — same posture as every prior role/permission addition): new `app_roles` row (`member_care_admin`, constitutional, protected); `app_role_permissions` rows binding `installed_pastor` → `pastoral_notes.manage`, `stated_clerk` → `demographics.manage`, `member_care_admin` → `medical.manage` and `disabilities.manage`; one new `role_grants` row (`member_care_admin` → Aldous Fennimore, person-arm, direct). No new `role_grants` rows for `installed_pastor`/`stated_clerk` — their existing grants carry the new permissions for free.
- **`scripts/seed.ts`**: new flag entry, `org_portal.sensitive_info`, `enabled: false`.

## Component / Page Plan

- **Pages to create:**
  - `src/app/(org)/o/[slug]/admin/members/[id]/edit/sensitive/page.tsx` — Server Component. Auth → `resolveOrgContext` → flag/toggle (both `org_portal.sensitive_info`) → `getSensitiveInfoForEdit()` → render only the sections `grants` allows.
- **Components to create:**
  - `.../edit/sensitive/sensitive-info-form.tsx` — Client Component (`'use client'`), one form per granted section (notes list + add-note form; demographics fields; medical fields; disabilities checklist), each section's own submit button — mirrors `EditPersonForm`'s controlled-input/`useState(submitting)` shape, not one giant cross-section submit.
  - Reuses `MembersFlagOff`/`MembersForbidden`/`MembersLoadError` from the existing `members-states.tsx` (already parameterized by `heading`) for the flag-off/forbidden/load-error states — no new state components needed.
- **New lib module:** `src/lib/person-sensitive.ts` (read + write functions above).
- **Files to modify:**
  - `.../edit/page.tsx` — add a conditional link to `./edit/[id]/sensitive` shown only when `getSensitiveInfoGrants()` returns at least one `true` (absent otherwise, per Phase 1's explicit requirement — not disabled/greyed).
  - `src/lib/audit.ts` — four new `AUDIT_ACTIONS` keys (below).
  - `scripts/seed.ts`, `scripts/seed-dev.sql` — as in Data Model.

## Implementation Order

1. Migration (`drizzle/00XX_presby_sensitive_info_permissions.sql`) → `npm run db:migrate` — permission-catalog rows + retirement of `pastoral.notes.view`.
2. `scripts/seed.ts` flag entry + `scripts/seed-dev.sql` role/binding fixture updates.
3. `src/lib/person-sensitive.ts` (read + all four write functions) + `src/lib/audit.ts` (four new keys).
4. Route: `sensitive/page.tsx`, `sensitive/actions.ts`, `sensitive/sensitive-info-form.tsx`; modify `edit/page.tsx` for the conditional link.
5. Audit events wired into all four write paths (no exemption — architect's Phase 2 ruling, all four are tier-3 mutations).
6. Release notes entry + `docs/product/functionality-map.md` line (Rule 14) at Phase 6 ship time — internal admin/staff tooling, not member-visible, so no `whats_new_entries` row is required (Rule 13).

## Edge Cases & Risks

- **Enumeration parity.** An authorized viewer looking at a person with zero rows in any of the four tables and a viewer denied all four permissions must render structurally identical `forbidden`/`not_found` shapes to `getPersonForEdit`'s existing collapse — verified in the implementer's tests, not just asserted here.
- **`person_notes.visibility` filter beneath `pastoral_notes.manage`.** The permission is table-level; the column is a second, finer read-time filter — mirroring `directory.ts`'s `hide_email`/`hide_phone` CASE-WHEN shape, but on the opposite axis (the row's own tag gates the *reader*, not a person's own opt-out). `staff` and `pastoral` visibility rows are visible to any `pastoral_notes.manage` holder; `clergy_only` rows are additionally gated on `exists (select 1 from ordinations o where o.person_id = :viewer and o.organization_id = :org and o.ministry = 'minister_of_word_and_sacrament' and o.ended_on is null)` — rows failing that check are **omitted from the result set**, not nulled-in-place (a list of notes, unlike a single record's fields, has no natural placeholder for "a note exists here you can't read," and showing one would leak existence). Because this pipeline binds `pastoral_notes.manage` only to `installed_pastor` (always ordained clergy by construction), the filter is a no-op today — it exists so a future non-clergy holder of the same permission doesn't see `clergy_only` content. Named risk: a non-clergy `pastoral_notes.manage` holder (if one is ever bound) could write a `clergy_only` note and then be unable to read it back — accepted as a rare, self-inflicted v1 edge case, not blocked.
- **`trackDisabilityPerPerson` gate.** The disabilities section must check `organizationSettings.settings.trackDisabilityPerPerson` in addition to `disabilities.manage` — off by default, and the schema's own comment on `person_disabilities` requires it. UI hides the section entirely when off (absent, not disabled); `setPersonDisabilitiesAction` re-checks server-side regardless of what the client sends.
- **Unbounded free-text columns** (`person_notes.body`, `person_medical.medicalNotes`, etc.) — no `CHECK`-level length limit exists in the schema; the form applies a reasonable client+server max length (mirrors `edit-person-schema.ts`'s existing `zod` string bounds) as a UX/DoS guard, not a schema change.
- **Existing e2e blast radius.** No existing e2e spec asserts behavior this change alters — `/admin/members/[id]/edit` itself is unchanged (the new surface is a separate route reached by an added link), and no existing spec exercises `person_notes`/`person_demographics`/`person_medical`/`person_disabilities` (Phase 1 confirmed zero prior read/write path). The one spec worth checking before Phase 5: any `edit-person-form`/`edit/page` e2e that asserts the full set of links/buttons rendered on that page (a new conditional link could break a "no unexpected additional links" style assertion) — implementer to grep for it explicitly.

## Implementer

**full-stack-developer** — the work spans one new small lib module, four short server actions, one new page, and one client form; splitting server/client here adds coordination overhead without a matching benefit, the same reasoning that puts "small and coupled" features on this implementer per the Phase 4 selection table.

---

# Phase 4 — Implementation

**Date:** 2026-08-26
**Implementer:** full-stack-developer

## Files Created

- `drizzle/0031_presby_sensitive_info_permissions.sql` — the four permission-catalog rows (`pastoral_notes.manage`, `demographics.manage`, `medical.manage`, `disabilities.manage`, all `sensitivity_tier = 3`), `on conflict (key) do nothing`, plus retirement of the orphaned `pastoral.notes.view` (`delete from app_role_permissions`/`permissions`, both idempotent).
- `src/lib/person-sensitive.ts` — the new domain module: `getSensitiveInfoGrants()`, `getSensitiveInfoForEdit()` (enumeration-safe `{kind: "ok"|"forbidden"|"not_found"}`), `addPersonNote()` (insert-only), `setPersonDemographics()` / `setPersonMedical()` (upsert), `setPersonDisabilities()` (delete-then-insert set-replace, gated on `organizationSettings.settings.trackDisabilityPerPerson`). The `clergy_only` filter under `pastoral_notes.manage` reads `ordinations` directly (active `minister_of_word_and_sacrament`) and OMITS failing rows from the result set.
- `src/lib/person-sensitive.test.ts` — real-Postgres integration tests (16 cases): grants resolution, enumeration parity (forbidden vs. authorized-empty produce the documented shapes, never a third), the clergy_only omission proof (clergy sees it, non-clergy holder of the same permission does not), and per-table write semantics (insert-only accumulation, upsert-not-duplicate, set-replace).
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/sensitive/page.tsx` — Server Component: auth → `resolveOrgContext` → flag/toggle (`org_portal.sensitive_info`) → `getSensitiveInfoForEdit()` → render granted sections only.
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/sensitive/actions.ts` — four Server Actions (`addPersonNoteAction`, `setPersonDemographicsAction`, `setPersonMedicalAction`, `setPersonDisabilitiesAction`), same `auth()`/re-run-`resolveOrgContext()` discipline as `edit/actions.ts`.
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/sensitive/actions.test.ts`, `page.test.tsx`, `sensitive-info-form.test.tsx` — mocked-boundary orchestration/render tests (31 cases total) covering gate composition, the forbidden/not_found/ok collapse, per-section absence-not-disabled, and each of the four independent sub-forms' submit/prefill/error paths.
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/sensitive/sensitive-info-form.tsx` — Client Component, one form per granted section (notes list + add-note form; demographics; medical; disabilities checklist), each with its own submit button and `useState(submitting)`.

## Files Modified

- `src/app/(org)/o/[slug]/admin/members/[id]/edit/page.tsx` — added a conditional link into `./edit/sensitive`, shown only when `org_portal.sensitive_info`'s flag+toggle are both on AND `getSensitiveInfoGrants()` returns at least one `true` (absent otherwise, never disabled — Phase 1's requirement). The flag/toggle check is a protective addition beyond Phase 3's literal wording (permission alone); noted below.
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/page.test.tsx` — added `mockToggles()` (keyed by feature key, mirroring the existing `mockFlags()`) and a new describe block covering all four link-visibility combinations. All 11 pre-existing tests in this file passed unmodified.
- `src/lib/audit.ts` — four new `AUDIT_ACTIONS` keys (below).
- `src/lib/audit.test.ts` — extended `EXPECTED_ENTRIES` with the four new keys (this is the existing drift-regression test; it fails the build if a key is added without updating this map — it did, and caught it).
- `src/lib/org-features.ts` — added `org_portal.sensitive_info` to `ORG_FEATURE_CATALOG` (name + description), so the existing per-org feature-toggle admin page can turn it on and `toggleOrgFeature()`'s `invalid_key` guard accepts it.
- `scripts/seed.ts` — new flag entry `org_portal.sensitive_info`, seeded `enabled: false`.
- `scripts/seed-dev.sql` — removed the `pastoral.notes.view` permission-catalog insert and its `installed_pastor` binding (superseded); added the four new permission-catalog rows (duplicating the migration's insert, same "on conflict do nothing" pattern as every prior addition in this file); added `member_care_admin` to `app_roles` (constitutional, protected); bound `pastoral_notes.manage` → `installed_pastor` (no new grant row — Rowan Thistlewood's existing grant carries it), `demographics.manage` → `stated_clerk` (no new grant row — Tobias Renwick's existing grant carries it), `medical.manage` + `disabilities.manage` → `member_care_admin`; added one new `role_grants` row, `member_care_admin` → Aldous Fennimore (person-arm, direct); added `trackDisabilityPerPerson: true` to Alder Creek's `organization_settings.settings` so the disabilities section has a real fixture to exercise end-to-end (Bramblewood stays "tracking off" for the negative case).

## Schema Changes

None — `person_notes`, `person_demographics`, `person_medical`, `person_disabilities` already existed, fully typed, unmodified (Phase 3's own ruling). The only DB-visible change is catalog/authorization rows (`permissions`, `app_roles`, `app_role_permissions`, `role_grants`) plus one `organization_settings.settings` fixture update, all via the hand-written migration + `scripts/seed-dev.sql`, same posture as every migration since 0012 (`db:generate`'s snapshot collision, tracked in `docs/TODO.md`).

**Applied via:** `psql "$MIGRATE_DATABASE_URL" -f drizzle/0031_presby_sensitive_info_permissions.sql` (idempotent — `on conflict do nothing` + idempotent deletes), run for real against the shared dev database this session. Confirmed: `pastoral.notes.view` and its `app_role_permissions` binding are gone; the four new keys exist at `sensitivity_tier = 3`.

The `scripts/seed-dev.sql` fixture additions could **not** be verified by re-running the whole file — this dev database already carries a fully-seeded fixture from prior pipelines' Phase 4 sessions (confirmed: `role_admin`/`roles.manage` from a concurrent sibling pipeline, DECISION-106, already present), so a full re-run would hit duplicate-key errors on the very first `organizations` insert and roll back (the file is one `begin;`/`commit;` transaction — safe, but untestable this way). Instead, I extracted and ran exactly this pipeline's *new* fixture statements (the `app_roles`/`app_role_permissions`/`role_grants` inserts and the `organization_settings` update) directly against the live dev DB, then proved the bindings resolve correctly with `set_config('app.current_org_id', ...)` + `presby_has_permission()`:

```
aldous_medical | aldous_disabilities | rowan_pastoral | tobias_demographics | aldous_pastoral_should_be_false
t              | t                   | t              | t                   | f
```

`npm run db:seed` was also run for real; `org_portal.sensitive_info` confirmed present in `feature_flags`, `enabled: false`.

**`scripts/test-rls.sql`:** Phase 3 did not specify a new isolation section, and this pipeline adds no schema/RLS-policy change — `person_notes`/`person_demographics`/`person_medical`/`person_disabilities` have carried `FORCE ROW LEVEL SECURITY` since `drizzle/0009_presby_rls.sql`, generically, since the original domain design. Cross-org isolation for the new permission keys is instead proven by `person-sensitive.test.ts`'s own real-Postgres tests (`getSensitiveInfoForEdit`'s `not_found` case from a different org's context; `setPersonDisabilities`'s `tracking_disabled` case at a differently-configured org) — no separate `test-rls.sql` run was skipped, there was simply nothing in Phase 3's design calling for a new section there.

## Audit Events

- `TENANT_PERSON_NOTE_ADDED` (`tenant.person_note.added`) — every `addPersonNote()` call that reaches `{kind: "ok"}`. Metadata: `{ organizationId, personId, visibility }`.
- `TENANT_PERSON_DEMOGRAPHICS_UPDATED` (`tenant.person_demographics.updated`) — every `setPersonDemographics()` upsert. Metadata: `{ organizationId }`.
- `TENANT_PERSON_MEDICAL_UPDATED` (`tenant.person_medical.updated`) — every `setPersonMedical()` upsert. Metadata: `{ organizationId }`.
- `TENANT_PERSON_DISABILITY_SET` (`tenant.person_disability.set`) — every `setPersonDisabilities()` set-replace, including replacing with an empty set. Metadata: `{ organizationId, categories }`.

No exemption on any of the four (architect's Phase 2 ruling) — all four fire from `src/lib/person-sensitive.ts`, not from the co-located `actions.ts` (same divergence `org-features.ts`'s `toggleOrgFeature()` already documents: the lib function does the check+write+audit, the Server Action does auth/re-resolve/error-mapping/revalidate only). `npm run check:audit` doesn't need to see these — its heuristic scans `actions.ts` under `src/app/` for bare `db.insert/update/delete`, and this route's `actions.ts` files contain none (they delegate entirely to the lib module), same pattern as `org-features.ts`'s.

## Implementer Notes

- **Endpoint/action signatures and their gates**, for QA's browser walkthrough:
  - `getSensitiveInfoGrants(viewerPersonId, organizationId)` → `{pastoralNotes, demographics, medical, disabilities}` (all booleans). No flag check inside — callers gate the flag/toggle themselves.
  - `getSensitiveInfoForEdit(viewerPersonId, organizationId, personId)` → `{kind: "ok", data} | {kind: "forbidden"} | {kind: "not_found"}`. Gated on holding at least one of the four permissions.
  - `addPersonNoteAction(slug, personId, {noteType, visibility, body, occurredOn?})` → gated on `pastoral_notes.manage`.
  - `setPersonDemographicsAction(slug, personId, {gender, racialEthnic, source})` → gated on `demographics.manage`.
  - `setPersonMedicalAction(slug, personId, {allergies, medicalNotes, medications, authorizedPickup})` → gated on `medical.manage`.
  - `setPersonDisabilitiesAction(slug, personId, {categories})` → gated on `disabilities.manage` AND `organizationSettings.settings.trackDisabilityPerPerson`.
  - Route existence gated on flag `org_portal.sensitive_info` (seeded OFF) → org toggle of the same key (added to `ORG_FEATURE_CATALOG`, so `/o/<slug>/admin/features` can turn it on per-org).
- **Real ID collision caught and fixed before it shipped:** Phase 3 didn't pin an `app_roles.id` for `member_care_admin`. My first pass used `f0000000-0000-0000-0000-00000000000b`, mirroring the "next hex letter after brand_admin (`...000a`)" convention — but a concurrent sibling pipeline (`2026-08-26-role-permissions-admin`, DECISION-106) had already claimed that exact ID for its own new role, `role_admin`, later in the same `scripts/seed-dev.sql` file. Caught by reading the full file before editing (not by a failed test — a fresh-DB run would have hit a primary-key violation on the second `app_roles` insert). Re-assigned `member_care_admin` to `...000c`. Documented here so a future reader of `git blame` on that ID isn't confused by the appearance of churn.
- **Link-visibility gate exceeds Phase 3's literal wording, deliberately.** Phase 3's Component Plan says the link on `edit/page.tsx` renders when `getSensitiveInfoGrants()` returns at least one `true` — permission alone. I additionally gated the link's rendering (and whether `getSensitiveInfoGrants()` is even called) on `org_portal.sensitive_info`'s flag+toggle both being on, mirroring how `edit/page.tsx` already gates `RecordRollActionForm`'s rendering on its own sibling flag. Rationale: without this, a permission holder would see a link into a sub-route whose own flag is off, landing them on that page's own flag-off state — a working but slightly confusing UX gap Phase 3 didn't call out either way. The sub-route re-checks both anyway (defense in depth), so this is strictly additive, not a substitute for the sub-route's own gate.
- **Write semantics implemented exactly as DECISION-108 specified:** `person_notes` insert-only (verified: two `addPersonNote()` calls produce two list entries, most-recent-first); `person_demographics`/`person_medical` upsert via `onConflictDoUpdate` on the `personId` primary key (verified: a second call updates the same row, confirmed by a direct row-count query, not just re-reading through the same function); `person_disabilities` delete-then-insert in one transaction (verified: replacing `["hearing","mobility"]` with `["sight"]` leaves exactly one row).
- **`person_notes.visibility` filter is a no-op in the shipped fixture**, as Phase 3's own Edge Cases section anticipated (`pastoral_notes.manage` binds only to `installed_pastor`, always ordained) — the filter exists and is tested (clergy vs. non-clergy holder of the same permission, `person-sensitive.test.ts`), but nothing in the fixture can currently produce a non-clergy `pastoral_notes.manage` holder writing a note they can't read back.
- **No new npm dependency, no shadcn primitive added** — the form uses raw `<select>`/`<input type="checkbox">` styled with the same Tailwind utility string `edit-person-form.tsx`/`add-officer-term-form.tsx` already use (`SELECT_CLASSES`), not `react-hook-form`/`zod` — these four sub-forms have no cross-field validation, so the lighter `useState`-per-field shape (matching Phase 3's "one form per section" instruction) avoids machinery the design didn't ask for. Client+server max-length guards (`maxLength` on `Textarea`/`Input`, matching Phase 3's Edge Cases note) stand in for a `zod` schema file.
- **Still needed at ship time (explicitly not done here):** version bump and `docs/release-notes/` entry (Rule 5/`/pre-push`'s job), `docs/TODO.md` reconciliation (Rule 10), and `docs/product/functionality-map.md` (Rule 14) — all Phase 6 housekeeping, per the pipeline's own division of labor.

**Addendum, 2026-08-26 (Phase 4 loop-back from QA FAIL):** `src/lib/person-sensitive.test.ts`'s `afterAll` created an "Active Membership" derived group as fixture setup, and its plain `platform.delete(organizations)` cascade tripped `presby_reject_derived_group_write()` — correctly tightened against derived-group deletes by the concurrent groups-admin pipeline (`drizzle/0033_presby_groups_administration.sql`). Not a defect in this feature's own code. Fixed by applying the identical convention `roll.test.ts`'s `afterAll` already uses for the analogous `roll_actions_freeze` trigger: `alter table group_memberships disable trigger group_memberships_reject_derived` before the delete, re-enabled in a `finally`. Added the `sql` import from `drizzle-orm`. Verified: `npx dotenv -e .env.local -- npx vitest run src/lib/person-sensitive.test.ts` → 1 file / 16 tests passed, including teardown (previously the suite's individual assertions passed but `afterAll` threw). `npm run typecheck` and `npm run check` (all four tripwires) both clean. Scope limited to this file only, per instruction — `people-update.test.ts` and any other pipeline's tests with the same issue are out of scope here.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-26
**Verified by:** qa

## Type Check

`npm run typecheck`: PASS (clean, no output)

## Unit Tests

`npm test` (no `.env.local`, matches CI): Test Files 182 passed | 19 skipped (201) — Tests 2486 passed | 419 skipped (2905). The 19 skipped files are the repo's pre-existing real-Postgres integration suites (`hasDb` skip-guard).

Scoped, real-database run of this pipeline's own integration suite (`dotenv -e .env.local -- vitest run src/lib/person-sensitive.test.ts`): **1 file passed, 16/16 tests passed, clean exit — including teardown.**

**FAIL → PASS history:** the first Phase 5 pass (2026-08-26) found the same 16 assertions passing but the file's `afterAll` teardown throwing (`group_memberships: <id> is a derived-group membership row... cannot be deleted directly`) — traced to a concurrent sibling pipeline's migration (`drizzle/0033_presby_groups_administration.sql`, `docs/work-log/2026-08-26-groups-admin.md`, DECISION-110) correctly tightening `presby_reject_derived_group_write()` against a cascade delete this teardown depended on. Confirmed repo-wide (reproduced against unrelated, pre-existing `src/lib/people-update.test.ts`), not a defect in this pipeline's own code, but a required check going red is never self-resolved or waved through. Returned to the implementer, who wrapped the teardown's delete with the same trigger-disable/re-enable pattern `src/lib/roll.test.ts` already established. QA re-verified independently: read `person-sensitive.test.ts:308-331` and confirmed it matches `roll.test.ts:307-320`'s convention precisely — disable before the delete, delete wrapped in `try`, re-enable in `finally` (so the trigger re-enables even if the delete itself throws for an unrelated reason) — a genuinely safe pattern, not a bare disable-delete-enable sequence.

Mocked-boundary orchestration tests (no DB needed): `actions.test.ts`, `page.test.tsx`, `sensitive-info-form.test.tsx`, `edit/page.test.tsx` — 4 files, 46 tests, all passed cleanly in the standard `npm test` run.

## End-to-End Tests

Not run — Phase 3 correctly scoped this out of blast radius for existing e2e specs (no prior spec touches these four tables or this route), and no auth-touching-diff gate applies.

## Regression Tests Added

New feature coverage (`src/lib/person-sensitive.test.ts`, 16 cases) exercises: grants resolution, enumeration-safety collapse (forbidden vs. not_found vs. authorized-empty), the `clergy_only` omission proof, and per-table write semantics — all read directly and confirmed correct against real Postgres.

## Coverage on Critical Modules

`src/lib/permissions.ts`/`two-factor.ts`/`flags.ts`: unchanged by this pipeline. `src/lib/person-sensitive.ts` (635 lines, 17 exports): numeric coverage unavailable (the `--coverage` run aborts before the summary flushes because of the teardown failure above), but all 16 assertions executed and passed against the real code path, including both branches of the enumeration collapse, the clergy filter's true/false branches, and every write function's `forbidden`/`not_found`/`ok`/`tracking_disabled` branches.

## Feature-Gate Audit

| Route or action | `auth()`/session present? | Permission check present? | Correct key? |
|-----------------|---------------------------|----------------------------|--------------|
| `GET /o/[slug]/admin/members/[id]/edit/sensitive` (`page.tsx`) | yes — `cachedAuth()` + `resolveOrgContext()` + `assertOrgAccess()` | yes — flag → org toggle → `getSensitiveInfoForEdit()`'s internal `presby_has_permission()` check against all four keys | yes — each of the four keys gates only its own section |
| `addPersonNoteAction` | yes | yes — `pastoral_notes.manage` | yes |
| `setPersonDemographicsAction` | yes | yes — `demographics.manage` | yes |
| `setPersonMedicalAction` | yes | yes — `medical.manage` | yes |
| `setPersonDisabilitiesAction` | yes | yes — `disabilities.manage` **and** `trackDisabilityPerPerson` org setting (defense in depth) | yes |
| `edit/page.tsx` (modified) — conditional link visibility | n/a (existing page's auth unchanged) | yes — flag+toggle+grants, absent-not-disabled | yes |

## Item-by-Item Verification

1. **Permission keys + role bindings (DECISION-108):** confirmed. `pastoral.notes.view` genuinely retired (removed, not left as a dead duplicate) — confirmed against the live dev DB.
2. **Enumeration safety — confirmed safe, stronger than asked.** `getSensitiveInfoForEdit()`'s permission check runs *before* any person lookup — a fully-denied viewer gets `{kind:"forbidden"}` for a real vs. nonexistent person with identical shape and zero extra queries either way; it structurally cannot leak existence.
3. **`clergy_only` filtering:** confirmed — rows filtered out (never nulled-in-place) unless the viewer is themselves ordained clergy. Tested both directions.
4. **Write semantics:** confirmed exactly per DECISION-108 — `person_notes` insert-only, `person_demographics`/`person_medical` upsert (`onConflictDoUpdate`), `person_disabilities` delete-then-insert in one transaction.
5. **Audit coverage:** all four keys fire from every `ok` branch, confirmed by direct read (not just `check:audit`, which has a known blind spot for actions that delegate to a lib function).
6. **Flag:** `org_portal.sensitive_info` confirmed new and dedicated, seeded off.
7. **Migration/journal:** `drizzle/meta/_journal.json` has the matching `0031` entry.
8. **Role-ID collision — none found.** `brand_admin` (`...000a`), `role_admin` (`...000b`, sibling pipeline), `member_care_admin` (`...000c`) all distinct across `scripts/seed-dev.sql`.
9. **Teardown fix (re-verification pass):** `person-sensitive.test.ts:308-331`'s `afterAll` verified byte-for-byte against `roll.test.ts:307-320`'s convention — disable-before, delete-in-try, enable-in-finally. Re-ran live against the real dev DB: 16/16 passed, clean exit, no orphaned-fixture risk remaining for this file.

## Verdict

**PASS** — all required checks green. Full suite (`npm test`, `npm run typecheck`, `npm run check`) clean; the pipeline's own real-Postgres integration suite passes end-to-end including teardown; the trigger-disable fix independently confirmed to mirror `roll.test.ts`'s safe try/finally convention with no gap. Permission model, enumeration safety, clergy-only filter, write semantics, audit coverage, flag design, migration, and role bindings remain verified correct.

**Handoff:** analyst (Phase 6 — Shipped vs Intent).

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

SHIP WITH NOTES

## ONE-LINE TAKE

> The hardest part of this pipeline — a tier-3 permission model with no constitutional precedent, D8 compliance, enumeration safety, and clean audit coverage — was built correctly and verified against real Postgres; what's missing is the Phase 6 housekeeping explicitly deferred (release notes, functionality map, TODO reconciliation) and one input-validation claim that doesn't match the shipped code.

## What's Working

- D8 compliance is real, not just asserted: `sensitive-info-form.tsx` uses hardcoded const arrays for every field's options — no admin-facing way to add a field name/type/label anywhere in the shipped UI or server actions.
- Permission bindings match DECISION-108 exactly; no role holds more than two of the four keys, and the two that share a role (`member_care_admin`) are the two with no constitutional analog.
- The orphaned `pastoral.notes.view` permission is genuinely gone — grepped `src/`, `scripts/`, `drizzle/`, only historical comments remain.
- Enumeration safety is stronger than Phase 1 asked for: the permission check runs before any person lookup, so a denied viewer gets an identical result for a real vs. nonexistent person with zero extra queries either way.
- Audit coverage is complete and correctly placed (in the lib module, not the delegating Server Actions).

## Intent-vs-Shipped Diff

- Phase 1 said: absent-not-disabled section visibility per permission. Shipped: matches exactly. **Matches.**
- Phase 1 said: should a tier-3 write fire `recordAudit()`? Architect/tech-lead answered yes, no exemption. Shipped: all four write paths fire distinct audit keys. **Matches.**
- Phase 3's Edge Cases said the form applies a reasonable client+server max length. **Shipped: this is false** — grepped `src/lib/person-sensitive.ts` and `sensitive/actions.ts`, no server-side length check exists anywhere; only the client-side `maxLength` HTML attribute. A request bypassing the browser form can write an arbitrarily long string to any of the four tables' free-text columns, which also have no DB-level `CHECK`. **Regression from stated intent** — low severity (no privilege escalation, an unenforced data-integrity/DoS guard), but real.
- CLAUDE.md's "Verify in a Browser" invariant: mobile at 360px. **Not addressed anywhere in Phase 4 or Phase 5** — no implementer note, no QA record of a manual/e2e mobile pass for this form. CSS suggests reasonable intent but that's inference from reading code, not verification.
- Rule 14 (functionality map): **not done** — zero mentions of this pipeline's surface in `docs/product/functionality-map.md` outside the schema-table-count line.
- Rule 5/10 (release notes, TODO): **neither done** — no entry in `docs/release-notes/v0.16.md`, no Done line in `docs/TODO.md`. Both explicitly deferred by the implementer to "ship time," but nobody has done them yet.

## Edge Cases

- Empty state: pass — designed empty copy for zero-row people, correct pre-filled-null forms for singleton/set data.
- Failure microcopy: pass — reused shared states, human toast copy.
- Permission gate: pass — verified in code and by QA's real-Postgres suite.
- Audit event: pass — all four keys fire from the `ok` branch, confirmed by direct read.
- Mobile (360px): not verified — see diff above. Not blocking (nothing looks obviously broken from reading it), but not exercised either.
- Input boundaries (server-side length enforcement): fail — client-only, no DB `CHECK`, no server-side guard. See diff above.

## Follow-Ups (if SHIP WITH NOTES)

- Add the missing `docs/release-notes/v0.16.md` entry: value statement, permission table (four keys), the `org_portal.sensitive_info` flag (seeded off), and the D8/no-custom-fields framing.
- Update `docs/product/functionality-map.md`'s org-portal bullet to name the new sub-route, the four tier-3 permission keys, the `pastoral.notes.view` retirement, and the new `member_care_admin` role.
- Reconcile `docs/TODO.md` (Rule 10) — add a Done line for this pipeline.
- Add real server-side length enforcement to all four write functions in `src/lib/person-sensitive.ts` (or a zod schema in `sensitive/actions.ts`) — Phase 3 asked for client+server; only client shipped.
- Run an actual 360px browser check of the four sub-forms before `org_portal.sensitive_info` is ever flipped on for a real congregation.
- Rule 13 (what's-new advisory): not required — same call as `role-permissions-admin`, an admin-only surface, not member-visible behavior. Worth an internal (non-`whats_new`) heads-up to the office-holders who gained this capability, given the data sensitivity — outside this pipeline's formal gate, a suggestion for the operator.

## Red Flags (if NEEDS REWORK)

- Not applicable — verdict is SHIP WITH NOTES, not NEEDS REWORK.

---

# Phase 4 Addendum — Server-Side Length Enforcement (api-developer, 2026-08-26)

**Trigger:** Phase 6's SHIP WITH NOTES follow-up — Phase 3's Edge Cases section called for "client+server max length" on the free-text/long-text columns; only the client-side `maxLength` HTML attribute shipped. A request bypassing the browser form (disabled JS, a crafted direct Server Action call) could write an arbitrarily long string to `person_notes.body`, `person_demographics.gender`, or any of `person_medical`'s four text columns — none of which carry a DB `CHECK`.

**Fix, in `src/lib/person-sensitive.ts`:** read `sensitive-info-form.tsx`'s own client-side constants (`BODY_MAX_LENGTH = 4000`, `FIELD_MAX_LENGTH = 2000`) and mirrored them exactly, server-side, as `BODY_MAX_LENGTH`/`FIELD_MAX_LENGTH` module constants — no new numbers invented. Checked inline, before `withOrgContext()` (before any query runs), matching the established convention already in this codebase: `src/lib/roll.ts`'s `recordRollAction()` re-validates `input.kind` against `EDIT_TIME_ROLL_ACTION_KINDS` the same way, before its own permission check. Did not introduce a new zod-schema file (`record-roll-action-schema.ts`/`edit-person-schema.ts` are client-only, consumed by `react-hook-form`, never re-parsed server-side in this tree — the server-side re-check convention here is inline, typed-result, not a shared schema).

- `addPersonNote()` — `AddPersonNoteResult` gained `{kind: "invalid_input"; field: "body"}`; rejects `body.length > 4000`.
- `setPersonDemographics()` — `SetPersonDemographicsResult` gained `{kind: "invalid_input"; field: "gender"}`; rejects `gender.length > 2000` (when `gender` is non-null).
- `setPersonMedical()` — `SetPersonMedicalResult` gained `{kind: "invalid_input"; field: "allergies"|"medicalNotes"|"medications"|"authorizedPickup"}`; rejects any of the four fields over 4000 chars (first offender named, via a small `firstOverlongMedicalField()` helper).
- `setPersonDisabilities()` — **unchanged, deliberately.** `person_disabilities.category` has no free-text client input to close a gap against — the client only ever sends one of four fixed checkbox values (`hearing`/`mobility`/`sight`/`other`), so there is no `maxLength` attribute on the client side to mirror. Adding an arbitrary new limit here would violate the instruction to match existing client numbers, not invent new ones; noted as an open, separate, lower-priority hardening item (a `text` column with no CHECK, reachable only via a crafted direct call, not via any UI path) rather than silently expanded scope.
- Added `sensitiveInfoFieldLabel()` (exported) — a small field→human-label lookup (`body` → "Note", `medicalNotes` → "Medical notes", etc.) so `sensitive/actions.ts` can build a friendly toast message without duplicating the label table.

**`src/app/(org)/o/[slug]/admin/members/[id]/edit/sensitive/actions.ts`:** added a `case "invalid_input"` arm (mapping to a new `invalidInputResult(field)` helper) to the three affected actions' switch statements (`addPersonNoteAction`, `setPersonDemographicsAction`, `setPersonMedicalAction`) — required for correctness, not just completeness: without it, a widened result union with no matching `case` falls through the switch without hitting any `return`, and the action would have proceeded to report `{ok: true}` for a rejected write.

**Tests added:**
- `src/lib/person-sensitive.test.ts` (real Postgres) — 6 new cases: `addPersonNote` ok at exactly 4000 chars / `invalid_input` at 4001 with a before/after read-back proving no note was written; `setPersonDemographics` ok at exactly 2000 chars / `invalid_input` at 2001 with the same before/after proof; `setPersonMedical` ok at exactly 4000 chars on all four fields / `invalid_input` when one field (`medicalNotes`) is 4001, with a before/after proof that the whole upsert was skipped, not partially applied. Suffixed "regression for missing server-side length enforcement" per the bug-fix test-naming convention.
- `src/app/(org)/o/[slug]/admin/members/[id]/edit/sensitive/actions.test.ts` (mocked boundary) — 3 new cases, one per action, asserting `invalid_input` maps to `ok: false` with a message matching `/too long/i` and (for `addPersonNoteAction`) that `revalidatePath` is not called. The module's `vi.mock("@/lib/person-sensitive", ...)` gained a real (non-mocked-away) `sensitiveInfoFieldLabel` implementation, matching the actual lookup, so these tests exercise the real label-mapping path rather than stubbing it out.

**Verification:**
- `npm run typecheck` — clean.
- `npx dotenv -e .env.local -- npx vitest run src/lib/person-sensitive.test.ts` — 1 file, 22/22 tests passed (16 pre-existing + 6 new), including the pre-existing trigger-disable/re-enable `afterAll` teardown pattern, untouched.
- `npm test` — 182 files / 2489 passed, 19 skipped (real-DB-only) files unaffected.
- `npm run check` — all four tripwires (`check:audit`, `check:sql-date`, `check:deps-drift`, `check:brand-scope`) clean.

**Handoff:** qa (re-verify this addendum only — no UI change, no new permission/flag, no schema change) or straight to the operator for the remaining Next Up item (`docs/TODO.md`'s 360px live-browser check), at the operator's discretion. No agent named for the 360px check since it requires a real browser session, not a Phase 4/5 handoff.
