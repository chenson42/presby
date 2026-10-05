# Parent organization and relationship type on the admin new-organization form — provision a congregation under its presbytery through the product — Work Log

> **Slug:** `2026-09-28-organization-parent-picker`
> **Surface:** `(admin)/admin/organizations/new` (the create form and its action) and `[id]` (show the parent/relationship, and possibly set it after creation); `src/lib/org-provisioning.ts` is READ but not changed unless the analyst finds a gap
> **Permission(s):** existing `FEATURES.ADMIN_ORGANIZATIONS` covers it (`src/lib/permissions.ts` is FROZEN)
> **Flag(s):** not needed
> **Estimated complexity:** small–medium
> **Pipeline mode:** Full (Phase 2 may be skipped by notation if no invariant is touched — the API already supports the fields)
> **Workflow Rule 16 kickoff (orchestrator, 2026-09-28, wave 5 — "finish the presbytery portal so PSV can be onboarded, tested and deployed"):** worktree `../presby-wt-picker` on git branch `pipeline/org-parent-picker`; Neon branch `pipeline-org-parent-picker` (`br-quiet-rain-axnzktt6`, forked from `development` at the v0.28.2 state). **Pre-assigned numbers:** no migration expected; `DECISION-158` only if a decision results; findings `F119` onward. **Shared-file discipline:** `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `src/lib/db/domain/index.ts` and `drizzle/meta/_journal.json` are edited on this branch only as a clearly delimited block appended at the END of the file (one new section, one new export line, one new journal entry); `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `docs/release-notes/*`, `docs/schema-design-2.md`, `docs/product/functionality-map.md` and `CLAUDE.md` are NOT edited on this branch — each phase returns its proposed lines in its section and the orchestrator applies them at integration (one PR at a time; `test-rls.sql` re-run on `development` after each merge; the pipeline's Neon branch is deleted at cleanup). `scripts/seed.ts`, `src/lib/org-portal/tiles.ts` and `src/lib/audit.ts` are high-collision: one clearly delimited addition each. **The from-scratch rule (DECISION-150):** any schema change must survive `npm run check:schema-parity` on a fresh database and the `docs/testing.md` from-empty recipe; the CI `db-tests` job skips until the operator adds the Neon secrets, so the implementer rehearses it locally. Every new SECURITY DEFINER function pins `search_path = public, pg_temp` (DECISION-148); every deny helper reachable from a tenant-path trigger grants EXECUTE to `presby_app, presby_platform` (0046 B-M1, re-learned as the increment-7 QA FAIL). Tests must mint their own fixture rows — a mandatory browser rehearsal on the pipeline branch consumes single-use seed rows (the withdraw pipeline's QA FAIL). Dev-server port `3500`; stop by PID; never `pkill -f`. `dotenv -e .env.local` does NOT override an already-exported `DATABASE_URL` — check `env | grep DATABASE_URL` first.
> **Sequencing:** this pipeline shares `src/app/(admin)/admin/organizations/new/` and reads `src/lib/org-provisioning.ts` with the founding-administrator pipeline (`../presby-wt-boot`, `pipeline/founding-admin`, currently in its Phase 4 fix pass). Phases 1–3 run now, read-only against `main`; **Phase 4 starts only after `pipeline/founding-admin` merges and `main` is merged into this branch** — the tech-lead designs against the founding-administrator work-log's Batch B/C contract (the create action redirects to `/admin/organizations/<id>`, where the founding-administrator section renders first while the org is headless).
> **The gap (`docs/TODO.md`: "`/admin/organizations/new` has no control for `parentOrganizationId` / `relationshipType`, though `createOrganizationAction` and `createOrganization()` fully support them (Phase 6 note 4, 2026-09-24)"; the 2026-09-27 presbytery-portal audit):** the action reads both fields from `formData` (`new/actions.ts:136-137`) and the lib validates the pair (`org-provisioning.ts:~274`: "A parent organization needs a relationship type (member_congregation, member_nwc, member_presbytery, or member_synod)"), but the form renders no control for either, so a congregation cannot be created UNDER its presbytery through the product — the API's day-one promise (DECISION-137 Phase 2 Ruling 3) is kept only at the API layer. PSV onboarding needs its member congregations provisioned under the presbytery.
> **User verbs (to refine):** a platform admin creating an organization picks its parent council (a searchable list of existing presbyteries/synods, filtered by what the chosen org type may sit under) and the relationship type is derived from the pair (a congregation under a presbytery is `member_congregation`; an NWC is `member_nwc`; a presbytery under a synod is `member_presbytery`; a synod under GA is `member_synod`) rather than typed; the admin sees the resulting affiliation on `[id]` afterwards. Whether the parent can be SET or CHANGED after creation is the analyst's to rule — `presby_transfer_affiliation()` exists for the council act and the platform is not a council (Two Hierarchies).
> **Constraints:** `createOrganization()`'s single transaction and result union are not widened (the founding-administrator architect ruled the same for its own control); the org tree is public so listing parents leaks nothing (DECISION-040); no new permission key; 360px pass; the founding-administrator section on `[id]` must still render first for a headless org.
> **Out of scope:** `presby_organize_congregation()` (the council-side act — lifecycle-UI pipeline); changing an existing org's parent (unless the analyst rules it in); congregation profile fields (pcusaPin, address, yearOrganized) named in Track P — analyst to say whether they belong here or in their own pipeline.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete — gap confirmed on the live catalog (`fpcw` headless; no affiliation ever written through the product); eight gaps; no reparent control (Adversarial §7); type-only parent filter | READY WITH NOTES | 2026-09-28 |
| 2 — Architectural review | architect | Skipped — no invariant, table, function, key or dependency touched; `createOrganization()` was reviewed under DECISION-136 (Phase 1 skip notation) | — | 2026-09-28 |
| 3 — Technical design | tech-lead | Complete — native `<select>` (no new dependency, per `docs/ui-standards.md`'s "no Combobox primitive exists yet"); eligible parents fetched server-side, grouped by type, filtered client-side; stacking order ruled (founding-administrator → affiliation → brand); one named residual (minute-reference bound is client-only, `new/actions.ts` stays untouched per Constraint 3) | Design complete, implementer named | 2026-09-28 |
| 4 — Implementation | full-stack-developer | Complete (2026-10-05) — form, affiliation section, read function, label helper, 17/17 failing-first, rehearsal 1–6; fix pass complete (2026-10-05): `relationshipType` ↔ `organizationType` pairing enforced in `createOrganization()` | — | 2026-10-05 |
| 5 — Verification | qa | Complete — first pass FAIL (server accepted an off-pair `relationshipType`), Phase 3 addendum + Phase 4 fix pass, second pass PASS: probes refused by `createOrganization()`'s pairing check before any DB call, 0 rows; failing-first reproduced; build green; DB suite 4384/4384; e2e 15/0/0; minute input 44px | PASS (second pass) | 2026-10-05 |
| 6 — Shipped vs intent | analyst | Complete — all eight gaps addressed or tracked; Phase 5 FAIL closed by server-side pairing enforcement; DECISION-158; follow-ups: hydration-gate the submit (F124 class), server `minuteReference` bound, headless-org repair scoping; integrated as v0.31.0 | SHIP WITH NOTES | 2026-10-05 |

---

# Phase 1 — Functional Refinement (analyst)

*Recorded verbatim by the orchestrator, 2026-09-28.*

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> The backend has fully supported hierarchical provisioning since DECISION-136 — this pipeline is "build the missing `<select>` and the missing read-back," not new plumbing, and it can stay that small only if it resists the temptation to also build a platform-side reparent control, which the schema does not support and Two Hierarchies says it shouldn't.

## Confirming the gap on the live catalog

Read-only queries against `pipeline-org-parent-picker` (nothing created), via `PLATFORM_DATABASE_URL` (the same `getPlatformDb()` connection the admin surface uses):

```
organization_type | platform_status | count
synod             | managed         | 1
presbytery        | managed         | 5
congregation      | invited         | 1
congregation      | managed         | 6
congregation      | unmanaged       | 2
```

Sampling `slug, organization_type, platform_status, parent_id, path`: `coastal-plain-synod`, `northern-reach`, `southern-fields`, `western-basin`, `e2e-presbytery` are all **root presbyteries/synod with `parent_id` null** — a presbytery with no synod parent is a legitimate real-world shape (PSV itself is independent), so that's not the gap. The gap is that **`fpcw` (a congregation) also has `parent_id` null** — nothing in the product today can put a congregation under a presbytery, so every congregation this admin surface has ever created is, and will remain, headless. `tidewater` (a presbytery) does show `parent_id = coastal-plain-synod`'s id — proving the backend/trigger derivation genuinely works when an affiliation row exists (it was set by migration/seed, not through the product). `organization_affiliations` has 10 rows today, all from seed data or migrations, none from `/admin/organizations/new`. There is **no `general_assembly`-type organization anywhere in this database** — worth flagging as an empty-state case below, not a blocker.

I also confirmed `createOrganization()`'s empty-parent behavior directly by re-reading `src/lib/org-provisioning.ts:269-284` and `new/actions.ts:139-146`: when `parentOrganizationId` is omitted, both layers spread `{}` — behavior is byte-identical to before this pipeline existed. The hierarchical path is genuinely all-or-nothing and additive.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`/admin/organizations/new`) | Picks an organization type (existing, unchanged) | one-time per org |
| Admin (`/admin/organizations/new`) | **[new]** Optionally picks a parent council from a list filtered to the types that org's polity permits as a parent | one-time per org, at creation only |
| Admin (`/admin/organizations/new`) | **[new]** Does *not* pick a relationship type directly — it is derived from the (parent type, child type) pair and submitted as a hidden field | implicit, every time a parent is picked |
| Admin (`/admin/organizations/new`) | **[new]** Optionally enters a minute reference, which flips the affiliation's recorded `authority` from `backfill` to `recorded` | optional, one-time per org |
| Admin (`/admin/organizations/[id]`) | **[new]** Views the org's current parent/affiliation (council name, relationship type, effective date, minuted or backfilled) | on demand, every visit |
| Admin (anywhere) | **[ruled out this pipeline — see Adversarial Pass §7]** Sets or changes a parent on an *existing* org after creation | n/a |

## Flows

**Flow 1 — Create a congregation under an existing presbytery (PSV's core case):** entry `/admin/organizations` → "New organization" → fill Name/Slug (unchanged) → Organization type = Congregation (unchanged, defaults as today) → **[new]** "Parent organization" combobox lists presbyteries only (filtered by `presby_assert_council_authority`'s actual pairing table, confirmed by reading `drizzle/0044_presby_org_lifecycle.sql:663-676`: presbytery→{congregation, new_worshiping_community}, synod→{presbytery}, general_assembly→{synod}; nothing may be the parent of a general_assembly) → relationship type auto-resolves to `member_congregation`, not shown as its own control → optional minute reference → submit.
- Success: one transaction creates the org row *and* the affiliation row (existing `createOrganization()` behavior, unchanged); redirects to `/admin/organizations/<id>`, where the new affiliation section (new, see Gaps) now shows the presbytery, relationship type, and effective date.
- Failure: name/slug errors unchanged; `invalid_parent` returns the existing enumeration-safe message ("a presbytery receives congregations and new worshiping communities, a synod receives presbyteries, and the General Assembly receives synods") for both "no such parent" and "wrong type" — already correct, confirm unchanged; `provisioning_incomplete` unchanged.

**Flow 2 — PSV onboarding, presbytery-first:** entry `/admin/organizations/new`, repeated N+1 times. Step 1: create the presbytery itself with the parent field left blank (unchanged root-org flow). Steps 2..N+1: Flow 1, once per congregation, selecting the just-created presbytery.
- Failure/edge not named by the request: if the admin tries to create congregation #1 *before* the presbytery exists, the parent combobox has nothing to offer — this must read as "No presbyteries exist yet — create one first," not a blank or disabled-looking control (see Gaps).

**Flow 3 — A new worshiping community under a presbytery:** same as Flow 1 with Organization type = New Worshiping Community; relationship type must resolve to `member_nwc`, never `member_congregation` — `lifecycle.ts`'s own comment says conflating the two breaks a live per-capita count. Failure path identical to Flow 1.

**Flow 4 — A synod under GA; a presbytery under a synod:** same shape, parent list filtered to `general_assembly`-type orgs for a synod child, `synod`-type orgs for a presbytery child.
- Failure/edge not named by the request: **there is no `general_assembly` org in this database at all**, so today a synod literally cannot be given a parent through this UI. That's fine (create the GA org first, same as any other root), but the empty-parent-list copy from Flow 2 applies here too, and worth surfacing to the user as a known day-one empty state rather than something QA should chase as a bug.

**Flow 5 — The invalid-pairing error:** if the client-side type filtering is correct, a genuinely mismatched pairing shouldn't be *reachable* through the combobox. The one way it becomes reachable: admin picks a parent while Organization type = X, then changes the Organization type select to Y without the parent selection clearing/refiltering. Server-side `invalid_parent` (existing) still catches this — but the UX should not let a user think they made a valid choice and then get a generic rejection after submit. Note for Phase 3: the org-type change handler must clear or refilter the parent selection.

## Permissions & Flags

- **Permission(s):** none new. `FEATURES.ADMIN_ORGANIZATIONS` already gates both `/admin/organizations/new` and `/admin/organizations/[id]` (confirmed in `page.tsx` of both) and is reused as-is.
- **Default roles:** unchanged — whoever already holds `ADMIN_ORGANIZATIONS` today.
- **Flag(s):** not needed. Confirmed independently: this surfaces an already-shipped, already-validated backend capability to platform admins only; it is not member-visible and not a risky rollout candidate.
- **Audit:** already wired and does not need new work. `createOrganizationAction` (`new/actions.ts:204-219`) already writes `parentOrganizationId`/`relationshipType` into the existing `AUDIT_ACTIONS.ORG_CREATED` event's metadata — today those fields are always logged `null` because nothing populates them. This pipeline's job is to make that existing audit call finally carry real data, not to add a new `AUDIT_ACTIONS` key.

## Gaps the Request Didn't Address

1. **What does `[id]` show today about affiliation? Nothing.** I read `[id]/page.tsx` in full — it renders brand, profile, service times, and site sections, and queries only `organizations.{id,name,organizationType,platformStatus}`. There is no query against `organization_affiliations` and no section rendering parent/relationship at all. Since the kickoff's own user-verb line says "the admin sees the resulting affiliation on `[id]` afterwards," a new read (open affiliation row + parent org's name/slug/type) and a new display section are squarely in scope here, not a nice-to-have — without it, "create under a parent" has no confirmation anywhere in the product.
2. **That new `[id]` section collides with the founding-administrator pipeline's own placement contract.** I read `../presby-wt-boot/docs/work-log/2026-09-28-founding-administrator.md` Ruling 7 (line 326) and its Phase 4 notes: the create action redirects to `/admin/organizations/<id>`, and that pipeline's own section renders "first and prominently, above Current brand," while the org is headless of administrators. Both pipelines land a new section on the same page, both plausibly want top billing, and both can fire for the same freshly-created org on the same page load. Phase 3 needs to rule the stacking order explicitly (my recommendation, not a decision: "what council is this and who's it under" reads as more fundamental identity than "who administers it," so I'd put the affiliation display above Founding Administrator and Current Brand — but this is Phase 3's call and must be made with that other pipeline's contract in hand, not independently).
3. **Empty parent list is a real, expected state, not an error.** A brand-new install, or the PSV bootstrap's own first step, has zero eligible parents for whatever type the admin just picked. The combobox needs explicit "No presbyteries exist yet — create one first" copy, not a blank list that reads as broken.
4. **Failure microcopy for the parent-list fetch itself.** Fetching the eligible-parents list is a new DB round-trip at page load that the rest of the form (name/slug/type) doesn't need. If that query fails (DB blip), the rest of the form must stay usable — degrade to "We couldn't load the list of presbyteries — try again" next to the parent field, not a 500 on the whole page.
5. **Mobile at 360px is not free here.** The existing two controls are native `<select>` elements, which the existing e2e's 360px test already covers and which scale trivially. A searchable/filterable parent picker (however Phase 3 chooses to build it — Combobox, Command, or a plain filtered `<select>`) is a materially different, more failure-prone control at 360px (overflow, focus trapping) and needs its own 360px assertion, not a free ride on the existing test.
6. **Congregation profile fields (Track P: `pcusaPin`, official/standard name, address, `yearOrganized`) do not belong in this pipeline** — recommending, not deciding, per the kickoff. I read the existing `ProfileForm`/`getOrganizationProfileAdminDetail` on `[id]` (address, phone, socials) — `pcusaPin` and `yearOrganized` aren't modeled there today. They're a distinct small schema-plus-UI addition to that *existing* Profile section, unrelated to `organization_affiliations`; a parent-picker pipeline is the wrong vehicle to carry them.
7. **Minute reference has no visible length bound.** I didn't find a CHECK constraint on `organization_affiliations.minute_reference` in `drizzle/0044`, and `createOrganization()` passes it through unbounded. Minor, but a new freeform text input deserves the same `maxLength` discipline the Name field already has (200 chars) — Phase 3 should pick a bound rather than ship an unbounded text column fed by an unbounded input.
8. **The parent list's filter predicate must be type-only, not status-filtered** — see Adversarial Pass §3, this is load-bearing enough that I'm also listing it here as a gap the request didn't spell out.

## Out of Scope (confirm with user)

- **Setting or changing a parent on an existing (already-created) org.** Ruled out for this pipeline — see Adversarial Pass §7 for the full reasoning (it's not a preference, there is no write path today that a platform operator can legitimately call). Confirmed as out of scope by the kickoff itself; I'm ruling in favor of the kickoff's suggested reading.
- `presby_organize_congregation()` / the council-side lifecycle act — already named out of scope by the kickoff; confirmed correct, this pipeline never touches `organization_lifecycle_events`.
- Congregation profile fields (`pcusaPin`, address, `yearOrganized`) — see Gap 6. My recommendation: its own small pipeline against the existing Profile section.

## Open Questions

- Should the `[id]` affiliation section be read-only prose, or should it link out to the parent org's own `[id]` page (an admin convenience, and the org tree is public so no enumeration concern per DECISION-040)? Leaving to Phase 3/tech-lead taste — either is defensible, neither touches an invariant.
- Confirm the stacking order of the new affiliation section against the founding-administrator section once that pipeline merges — this needs the founding-administrator work-log's *final* Phase 6 state in hand, not just its Phase 4-in-progress snapshot I read today.

---

## Five-Pass Detail (supporting the sections above)

**Pass 3 (Permissions/Flags):** see above — no new key, no flag, confirmed twice (once against `src/lib/permissions.ts` being FROZEN per CLAUDE.md, once against the kickoff's own claim).

**Pass 5 — Adversarial Pass:**

1. **Redirect targets:** not applicable — no `callbackUrl`/`next`/`redirect` parameter appears anywhere in this flow.
2. **State-machine shortcuts:** Can an admin bypass the presbytery-first step by typing a fabricated or type-mismatched parent id directly (e.g., scripted `FormData`)? No — already defended server-side, independent of whatever the UI offers. I traced the full rejection path: `new/actions.ts` validates UUID shape; `createOrganization()` maps a nonexistent parent (`23503` FK violation) and a type-mismatched real parent (`42501` from `presby_assert_council_authority()`'s `BEFORE INSERT` trigger, confirmed at `drizzle/0044_presby_org_lifecycle.sql:651-684`) to the same `invalid_parent` result. The searchable list this pipeline builds is a courtesy filter, never the enforcement boundary — it must stay that way; Phase 3 must not remove or weaker the existing server-side checks in the name of "the UI already filters this."
3. **Enumeration leaks:** The org tree is public (DECISION-040; `/admin/organizations` already lists every org, every type, every `platformStatus`, to any admin) — a parent-picker combobox listing every presbytery/synod by name leaks nothing new. **But:** should the picker additionally filter out `unmanaged`/`invited`-status orgs as ineligible parents? I checked `presby_assert_council_authority()` — it validates `organization_type` only, never `platform_status`. That's correct behavior to preserve: an `invited` or `unmanaged` presbytery is still a real, ecclesiastically valid parent (PSV's own presbytery may itself be mid-onboarding while its congregations still need provisioning underneath it) — the picker's filter predicate must be **type-only**, never additionally gated on `platformStatus = 'managed'`. Flagging this because it's the kind of "obviously sensible" filter an implementer adds unprompted and would silently break PSV's actual onboarding order.
4. **Input boundaries:** parent id (UUID + FK + trigger, all server-side, confirmed above); minute reference (freeform, unbounded — see Gap 7); org type / platform status (existing enums, unchanged). All validation is server-side; nothing here is client-trust-only.
5. **Self-targeting:** not applicable — this is an org-to-org relationship, not a user acting on their own account.
6. **Cycles:** `organization_affiliations_not_self` CHECK already rejects `subject_org_id = parent_org_id` directly. A longer cycle (transitive) cannot arise at *creation* time — a brand-new org has no pre-existing children to loop back through. Cycles are only reachable via a *reparent* act on an existing org, which is exactly the act ruled out below.
7. **The kickoff's explicit question — should a platform-side "set parent on a headless org" ship as onboarding plumbing?** No. Two independent reasons, not a style preference:
   - **Invariant reasoning (Two Hierarchies):** `presby_transfer_affiliation()` (`drizzle/0044:873-999`) derives its actor exclusively from `presby_current_org()` — a council acting through its own membership-verified `withOrgContext()` session. `[id]/actions.ts`'s own header comment states the platform-operator posture explicitly: *"there is no personId to hand it here that would not be fabricated, and fabricating one is exactly the phantom membership violation of Two Hierarchies."* A platform-side "assign a parent" button, if it called (or built a sibling of) this function, would be precisely that fabrication.
   - **Mechanical reasoning:** the function additionally *requires* an existing open affiliation row to close (`if v_current_row_id is null then perform presby_deny_affiliation_change()`, line 927-929) — it is a **transfer**, not a first assignment. There is no function anywhere in the codebase, callable by council or platform, that gives a first parent to an already-existing, already-headless org. Building one is real schema/function-mediation work — its own Phase 2/3/4, not a rider on a form-control pipeline.
   - **Ruling:** this pipeline builds *at-creation* parent selection only (exactly `createOrganization()`'s existing DECISION-136 direct-INSERT path) plus a *read-only* display on `[id]`. No set/change-parent control ships here, for any org, ever, in this pipeline.

**Phase 2 skip recommendation:** given the ruling in Adversarial §7, **Phase 2 (architect) can be skipped by notation.** The only backend surface this pipeline touches, `createOrganization()`, already received its own architectural review under DECISION-136/Phase 2 of the 2026-09-24 lifecycle-affiliation-returns pipeline. This pipeline's actual work — a new `<select>`/combobox reading an existing, already-typed input shape, plus a new read-only display section reading an existing table — introduces no new table, no new function, no new permission key, and stresses no invariant beyond what `createOrganization()` already stresses. The one placement question left open (where the new `[id]` section sits relative to the founding-administrator section) is a sequencing/collision question for Phase 3 to resolve against that pipeline's actual Phase 6 state, not an architectural one.

### Orchestrator rulings (2026-09-28)

1. Adversarial §7 accepted: **no set/change-parent-after-creation control** ships in this pipeline; at-creation selection + read-only display on `[id]` only.
2. Gap 6 accepted: congregation profile fields (`pcusaPin`, address, `yearOrganized`) are their own future pipeline against the Profile section.
3. Gap 8 / Adversarial §3 binding: the parent-list predicate is **type-only**, never `platform_status`-filtered.
4. **Phase 2 skipped** by the analyst's notation (no invariant, table, function, key or dependency). Phase 3 runs now; **Phase 4 waits for `pipeline/founding-admin` to merge** and rules the `[id]` stacking order against that pipeline's final state.

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

The backend has fully supported hierarchical provisioning since DECISION-136; this pipeline builds only the missing `<select>` and the missing read-back. On `/admin/organizations/new`, the create form gains an optional "Parent organization" control — a plain native `<select>`, filtered client-side to the polity-legal pairing for whatever organization type the admin has chosen (presbytery→{congregation, new_worshiping_community}, synod→{presbytery}, general_assembly→{synod}) — with the relationship type derived and submitted as a hidden field, so PSV's congregations can finally be provisioned under their presbytery through the product instead of direct SQL. `[id]` gains a new read-only "Council affiliation" section so the admin can confirm the result. No schema, no new permission, no new API surface: `createOrganization()` and `createOrganizationAction` are untouched (Constraint 3) — this pipeline is entirely client-side plumbing plus one new read function.

## Permissions & Flags

- Permission key(s): none new. `FEATURES.ADMIN_ORGANIZATIONS` (`src/lib/permissions.ts:20`) already gates both `new/page.tsx` and `[id]/page.tsx`; reused as-is.
- Default role bindings: unchanged.
- Feature flag(s): not needed (analyst confirmed independently — platform-admin-only surface, not member-visible, not a rollout candidate).

## API Contract

No new routes and no server-action signature changes.

- `createOrganizationAction(formData: FormData): Promise<CreateOrgPolicyResult>` (`src/app/(admin)/admin/organizations/new/actions.ts:87`) — **unchanged**. It already parses `parentOrganizationId` / `relationshipType` / `minuteReference` from `FormData` (lines 136–161) and already writes them into `AUDIT_ACTIONS.ORG_CREATED`'s metadata (lines 216–217) — those fields have been logged `null` since the day this action shipped, purely because nothing populated them. This pipeline's whole job on the server side is done the moment the form actually sends real values.
- `createOrganization(input: CreateOrganizationInput): Promise<CreateOrganizationResult>` (`src/lib/org-provisioning.ts:253`) — **unchanged**.
- `getOrganizationAffiliationAdminDetail(organizationId: string): Promise<OrganizationAffiliationAdminDetail>` — **new**, additive-only read function in `src/lib/org-provisioning.ts` (Gap 1 authorizes this addition; it does not touch `createOrganization()`'s contract). Shape:

  ```ts
  export type OrganizationAffiliationAdminDetail = {
    relationshipType: RelationshipType;
    effectiveFrom: string | null; // date string; null = "predates our records" (F41) — unreachable for a row this pipeline itself creates, but the type stays honest for rows seed/migration ever produced
    authority: "recorded" | "backfill";
    minuteReference: string | null;
    parent: { id: string; name: string; slug: string; organizationType: OrganizationType };
  } | null; // null = no OPEN affiliation row for this subject (headless — e.g. fpcw today, or any root org)
  ```

  Query: `organizationAffiliations` where `subjectOrgId = organizationId AND effectiveTo IS NULL`, inner-joined to `organizations` on `parentOrgId` for the parent's name/slug/type, `limit(1)`. `presby_platform` already holds `SELECT` on `organization_affiliations` (`lifecycle.ts`'s own header comment) — no new grant needed. Uses `getPlatformDb()`, matching this whole page's existing posture (never `withOrgContext()` — a platform operator holds no congregational membership to verify, per `[id]/actions.ts`'s own header comment).
- `relationshipTypeLabel(type: RelationshipType): string` — new, small sibling to `organizationTypeLabel()` in `src/lib/org-display.ts`. Same "one place, not three copies of a four-way switch" rationale that function already states for itself.

## Data Model

No schema changes required. `organization_affiliations` (`drizzle/0044`) and `organizations.parent_id`/`path` (derived by trigger) already carry everything both new surfaces need to read.

## Component / Page Plan

**Files to create:**

- `src/app/(admin)/admin/organizations/[id]/affiliation-section.tsx` — plain server-renderable component (no `'use client'` — read-only, no state, no form), sibling to `service-times-section.tsx`/`site-section.tsx` in the same directory.
- `src/app/(admin)/admin/organizations/[id]/affiliation-section.test.tsx` — component test, mirroring `service-times-section.test.tsx`'s shape.
- `src/app/(admin)/admin/organizations/new/create-organization-form.test.tsx` — **new file**; there is no existing test for this component at all (confirmed: no `*.test.tsx` in `new/`), so this pipeline is the first to cover it, not an extension.

**Files to modify:**

- `src/lib/org-provisioning.ts` — add `getOrganizationAffiliationAdminDetail()` (additive; `createOrganization()`/`deriveOrgPath()`/etc. untouched). Needs `and`, `isNull` added to the existing `eq` import from `drizzle-orm`.
- `src/lib/org-display.ts` — add `relationshipTypeLabel()` next to `organizationTypeLabel()`.
- `src/app/(admin)/admin/organizations/[id]/page.tsx` — call `getOrganizationAffiliationAdminDetail(id)`, render `<AffiliationSection>` at the ruled stacking position (see below).
- `src/app/(admin)/admin/organizations/new/page.tsx` — fetch eligible parents server-side (type-only predicate, `getPlatformDb()`), group by type, pass as props; degrade to `null` on fetch failure (Gap 4) rather than failing the page.
- `src/app/(admin)/admin/organizations/new/create-organization-form.tsx` — parent control, org-type-change clearing (Flow 5), derived hidden `relationshipType`, optional `minuteReference` input.
- `src/app/(admin)/admin/organizations/new/actions.test.ts` — **backfill**, not a change to the action itself: this file has zero coverage today of the parent/relationship parsing branch that has existed in `actions.ts` since the 2026-09-24 lifecycle pipeline (UUID validation, relationship-type validation, the `invalid_parent` → generic-copy mapping). That branch is about to become reachable through the UI for the first time; shipping this pipeline without exercising it via the action's own test file — not only through the new component's mocked-action tests — would leave the actual `FormData` contract unverified.
- `e2e/admin-organizations-create.spec.ts` — one new hierarchical-create test; extend the existing 360px block.

### Stacking order on `[id]` (resolves Gap 2)

**Founding-administrator section → Council affiliation section → Current brand → Set brand → Profile → Service times → Site.** This is the analyst's own recommendation, adopted as written, stated here so Phase 4 can merge cleanly against `pipeline/founding-admin`'s final shape:

1. The founding-administrator section keeps top billing — its own pipeline's placement ruling (`../presby-wt-boot/docs/work-log/2026-09-28-founding-administrator.md` Ruling 7 / "Component / Page Plan") is "renders first and prominently … while the org has zero holders," and that section is actionable and gating (an org with zero `roles.manage` holders is unusable until someone acts), which outranks a purely informational display.
2. Council affiliation comes next, above "Current brand" — "what council is this and who's it under" is a more fundamental identity fact than branding, and it is the direct confirmation of what this pipeline's own create-form control just did, so it belongs as close to the top of the page as the founding-administrator gate allows.
3. Nothing about Current brand / Set brand / Profile / Service times / Site changes.

This section **always renders**, whether or not an affiliation exists — collapsing to "This organization has no recorded parent council." rather than disappearing, matching the founding-administrator section's own collapsed-state precedent (never vanish a section a returning admin might look for).

### `create-organization-form.tsx` — the parent control

**Native `<select>`, not a Combobox.** `docs/ui-standards.md`'s "Select & Combobox Patterns" section is unambiguous: *"There is no `Popover`, `Command`, or `Select` primitive in `src/components/ui/` today, and no combobox anywhere in the tree… Don't hand-roll a substitute in the meantime."* Generating one is a new Radix dependency (`@radix-ui/react-select` or `cmdk`) requiring the architect's five-criteria pass — and Phase 2 was skipped by notation on the basis that this pipeline introduces **no new dependency**. A searchable combobox is therefore not available to this pipeline without reopening Phase 2; the analyst's own flagged risk (Gap 5: "a materially different, more failure-prone control at 360px") is avoided by construction, not mitigated. A flat, already-narrowed `<select>` (see below — never more than one organization type's worth of options at a time) carries no more 360px risk than the two selects already on this form.

**Data shape passed from `new/page.tsx`** (server-fetched once, grouped by type — the "eligible parents" the analyst's Flow 1–4 describe are only ever presbyteries, synods, or the General Assembly; no other type can ever be a parent per the pairing table):

```ts
type EligibleParent = { id: string; name: string };
type EligibleParentsByType = {
  presbytery: EligibleParent[];
  synod: EligibleParent[];
  general_assembly: EligibleParent[];
} | null; // null = the fetch itself failed (Gap 4) — distinct from an empty array (Gap 3)
```

`new/page.tsx` query (type-only predicate — Gap 8 / Adversarial §3 is binding: **never** filter on `platformStatus`):

```ts
const platformDb = getPlatformDb();
let eligibleParents: EligibleParentsByType = null;
try {
  const rows = await platformDb
    .select({ id: organizations.id, name: organizations.name, organizationType: organizations.organizationType })
    .from(organizations)
    .where(inArray(organizations.organizationType, ["presbytery", "synod", "general_assembly"]))
    .orderBy(organizations.name);
  eligibleParents = { presbytery: [], synod: [], general_assembly: [] };
  for (const r of rows) eligibleParents[r.organizationType as "presbytery" | "synod" | "general_assembly"].push({ id: r.id, name: r.name });
} catch {
  eligibleParents = null; // the rest of the form (name/slug/type) must stay usable — Gap 4
}
```

**Client-side pairing map** (the exact reverse of `presby_assert_council_authority()`'s table, `drizzle/0044_presby_org_lifecycle.sql:663-676` — a courtesy filter only; Adversarial §2 is explicit that the server-side trigger/FK rejection stays the real enforcement boundary and must not be weakened or removed):

```ts
const PARENT_TYPE_BY_CHILD: Partial<Record<OrganizationType, "presbytery" | "synod" | "general_assembly">> = {
  congregation: "presbytery",
  new_worshiping_community: "presbytery",
  presbytery: "synod",
  synod: "general_assembly",
  // general_assembly: absent — no organization type is ever its parent (Flow 4).
};
const RELATIONSHIP_BY_CHILD: Partial<Record<OrganizationType, RelationshipType>> = {
  congregation: "member_congregation",
  new_worshiping_community: "member_nwc",
  presbytery: "member_presbytery",
  synod: "member_synod",
};
const PARENT_TYPE_PLURAL: Record<"presbytery" | "synod" | "general_assembly", string> = {
  presbytery: "presbyteries",
  synod: "synods",
  general_assembly: "General Assembly organizations",
};
```

**Behavior:**

- `organizationType` becomes a controlled `useState` (was `defaultValue`) so its change can drive the parent field — this is a functionally inert change for `FormData` submission (a controlled `<select>` still submits its live DOM value under `name="organizationType"` exactly as an uncontrolled one does; `actions.ts`/`actions.test.ts` need no changes).
- `parentChoice` is a second `useState`, sentinel `"none"` (never `""`, per `docs/ui-standards.md`'s own rule) meaning "no parent — create a root organization."
- **Flow 5 fix:** the `organizationType` `onChange` handler always resets `parentChoice` to `"none"`, unconditionally — even congregation ↔ new-worshiping-community, which both target the same parent type. Simpler and safer than trying to preserve a selection across a type change; one re-click is a small cost for never carrying a stale id across a type the admin didn't mean to keep it for.
- `allowedParentType = PARENT_TYPE_BY_CHILD[organizationType]` (`undefined` for `general_assembly`).
  - `allowedParentType === undefined` → **no parent field renders at all**; a one-line note instead: "The General Assembly is the top of the hierarchy — it has no parent." (Flow 4's edge case: informational, never an error state, since there is no organization type that could ever fill the role.)
  - else render the field, always, regardless of how many options it has:
    - `eligibleParents === null` → render the `<select>` with only the `"none"` option, plus: *"We couldn't load the list of {PARENT_TYPE_PLURAL[allowedParentType]} — try again."* (Gap 4). The rest of the form stays fully usable; a root-org create still works.
    - `eligibleParents[allowedParentType].length === 0` → render the same minimal `<select>`, plus: *"No {PARENT_TYPE_PLURAL[allowedParentType]} exist yet — create one first."* (Gap 3 — this is Flow 2's and Flow 4's expected day-one state, not a bug; QA should not chase it).
    - else render `<option value="none">None — this will be a root organization</option>` followed by one `<option value={p.id}>{p.name}</option>` per eligible parent, sorted by name (already sorted server-side).
- **Sentinel translation (load-bearing — a wiring mistake here silently breaks every plain root-org submission):** the visible `<select>` is `name="parentOrganizationChoice"`, **not** `name="parentOrganizationId"`. Two hidden inputs carry the real payload:
  ```tsx
  <input type="hidden" name="parentOrganizationId" value={parentChoice === "none" ? "" : parentChoice} />
  <input type="hidden" name="relationshipType" value={parentChoice === "none" ? "" : (RELATIONSHIP_BY_CHILD[organizationType] ?? "")} />
  ```
  If the visible select were named `parentOrganizationId` directly, selecting "None" would submit the literal string `"none"`, which fails `actions.ts`'s `UUID_RE` check and returns *"Choose a valid parent organization."* on every ordinary root-org create — a regression the existing e2e happy-path test (`admin-organizations-create.spec.ts`'s first test, which creates a plain congregation with no parent selected) would have caught, but a component-level test should assert this translation directly rather than relying on e2e to catch a wiring inversion.
- `minuteReference`: an `<Input>` (existing shadcn primitive), rendered **only when `parentChoice !== "none"`** (a minute reference with no parent makes no sense), `id="minuteReference" name="minuteReference" maxLength={500}` — 500 is the house convention for this exact field (`statistics-schema.ts`, `credential-schema.ts`, `position-schema.ts` all use `z.string().max(500, …)` for `minuteReference`; this is the first `minuteReference` input in the app without a matching Zod schema, since `new/actions.ts` does its own hand-rolled `FormData` parsing rather than Zod). Label: "Minute reference (optional)"; helper text: "If provided, this affiliation is recorded as minuted rather than backfilled."

## Implementation Order

1. Rebase `pipeline/org-parent-picker` onto `main` after `pipeline/founding-admin` merges; re-read `[id]/page.tsx`'s merged shape before touching it — the two pipelines both add a new section to the same return block.
2. `src/lib/org-provisioning.ts` — add `getOrganizationAffiliationAdminDetail()` (additive).
3. `src/lib/org-display.ts` — add `relationshipTypeLabel()`.
4. `src/app/(admin)/admin/organizations/[id]/affiliation-section.tsx` — new component; `affiliation-section.test.tsx`.
5. `src/app/(admin)/admin/organizations/[id]/page.tsx` — wire the read + the section at the ruled stacking position.
6. `src/app/(admin)/admin/organizations/new/page.tsx` — eligible-parents fetch, grouped, degraded on failure.
7. `src/app/(admin)/admin/organizations/new/create-organization-form.tsx` — the parent control, exactly as designed above. **Failing-first**, per the kickoff: write the type-change-filter test and the clear-on-type-change test against the *old* (parent-less) component first, confirm they fail, then implement.
8. `create-organization-form.test.tsx` (new file) — filtering by type, clearing parent on type change, derived `relationshipType` hidden-field value, general-assembly no-parent-possible state, empty-parent-list copy, fetch-failure copy, sentinel translation (selecting "None" submits empty `parentOrganizationId`, not `"none"`).
9. `new/actions.test.ts` — backfill coverage of the parent/relationship parsing branch (UUID rejection, relationship-type rejection, `invalid_parent` mapping) — this code has existed since 2026-09-24 with zero test coverage; it's about to be reachable through the UI for the first time.
10. `org-provisioning.test.ts` (DB-backed, `PLATFORM_DATABASE_URL`, `--no-file-parallelism`) — extend with `getOrganizationAffiliationAdminDetail()`: returns the open row + parent identity for an org created with a parent; returns `null` for a headless org; returns `null` after the (out-of-scope) transfer path would close a row — not exercised here, just confirms the query's `effectiveTo IS NULL` filter is correct by construction.
11. `e2e/admin-organizations-create.spec.ts` — one new test: create a congregation under `e2e-presbytery` (the existing live fixture presbytery, per Phase 1's catalog read), assert the redirect lands on `[id]` and the Council affiliation section names `e2e-presbytery`; teardown via the existing `deleteOrgBySlug()` (the child org's own `organization_affiliations` row cascade-deletes via `ON DELETE CASCADE` on `subject_org_id` — no separate cleanup statement needed). Extend the 360px block with the new parent `<select>` and, if visible, the minute-reference input.
12. `npm run check` (all five tripwires), `npm run typecheck`, `npm run build`.
13. At Phase 6 (ship time, orchestrator applies per Workflow Rule 16's shared-file discipline): close the `docs/TODO.md` line quoted in the kickoff's "The gap" block; add one clause to `docs/product/functionality-map.md`'s existing Organizations bullet (§121) — proposed text: *"an optional parent-council picker (grouped by type, filtered client-side to the polity-legal pairing, with a derived hidden relationship type and an optional minuted reference) provisions a congregation/NWC/presbytery/synod directly under its council; `[id]` adds a read-only Council affiliation section naming the open `organization_affiliations` row with a link to the parent's own `[id]` page"* — plus `affiliation-section.tsx` added to that bullet's file list; `/release-notes` entry. No `DECISION-158` — nothing here is a non-trivial implementation choice beyond what DECISION-136/137/139 already settled.

## Edge Cases & Risks

- **No `general_assembly` organization exists in this database today** (confirmed live, Phase 1) — the synod parent field will show the empty-list copy until an operator creates one. Expected, not a bug; QA should not chase it as a defect.
- **A presbytery with no synod parent is a legitimate root shape** (PSV itself) — the picker must never imply every presbytery needs one.
- **`invited`/`unmanaged` parents stay eligible, permanently** (Gap 8 / Adversarial §3, binding) — do not add a `platformStatus` filter "for safety." `presby_assert_council_authority()` never checks it, and PSV's own onboarding order depends on this: its presbytery may still be `invited` while its congregations need provisioning underneath it.
- **The client filter is a courtesy, never the enforcement boundary.** A stale eligible-parents list (another admin created/deleted an org between page load and submit) degrades to the existing, unmodified `invalid_parent` rejection and its existing generic copy — never a broken create, never a new error string.
- **Sentinel-translation regression risk**, named above — the single highest-value assertion in the new component test file, because a wiring mistake here breaks the plain root-org happy path silently (submits the literal string `"none"` as a UUID) rather than loudly.
- **Named, accepted residual: `minuteReference`'s 500-char bound is client-only (`maxLength={500}`), with no matching server-side check.** Constraint 3 keeps `new/actions.ts` untouched this pipeline (the kickoff's own explicit item, not a tech-lead preference) — unlike `name`, which the action already length-checks server-side (`MAX_NAME_LEN`), a scripted `FormData` POST can submit an arbitrarily long `minuteReference` and it will reach `createOrganization()` unbounded, exactly as it does today (this field has accepted no bound at all since 2026-09-24). Low severity — freeform prose in a `text` column with no CHECK, the same shape as `reason`/`notes` elsewhere on this table — and explicitly not proposed as a `docs/TODO.md` follow-up per the kickoff's own "probably not this pipeline" framing; naming it here so it is a documented, not silent, gap.
- **Merge conflict is expected, not a red flag.** Both this pipeline and `pipeline/founding-admin` add a new section to `[id]/page.tsx`'s JSX — Phase 4 rebases onto the merged `main` and reconciles by hand per Implementation Order step 1.
- **e2e blast radius (per CLAUDE.md's Phase 3 requirement):** `e2e/admin-organizations-create.spec.ts`'s existing happy-path test (creates a congregation with **no parent selected**) is the one existing spec most exposed by this change — it exercises exactly the "None" path the sentinel-translation risk above could silently break. That test's assertions (lands on `[id]`, sees the group-seed rows) do not change, but it is the regression backstop for this pipeline's riskiest wiring decision, not just new-test territory. The reserved-slug and duplicate-slug tests are unaffected (they never reach the parent field). The 360px test gains two new visibility assertions but its existing ones (no-horizontal-overflow, existing field visibility) are unchanged.

## Implementer

**full-stack-developer.** Small–medium, spans one new lib read function, one new display-label helper, one new read-only component, and client-side form logic on an existing form — genuinely coupled (the form's filtering logic and the eligible-parents data shape it consumes are one design, not two independently-schedulable layers) and small enough that a schema/server/client split would add coordination overhead the work doesn't need. No schema changes (no database-admin), no new route/API surface beyond one additive read function (not enough on its own to warrant a dedicated api-developer handoff separate from the UI that is the actual point of this pipeline).

---

# Phase 4 — Implementation

*full-stack-developer, 2026-10-05, worktree `presby-wt-picker`, branch `pipeline/org-parent-picker` at `d48e1ef` (= `main`, founding-administrator v0.29.0 merged; Implementation Order step 1 was already done). Neon branch confirmed `br-quiet-rain-axnzktt6` via `select current_setting('neon.branch_id', true)`; `env | grep DATABASE_URL` empty; `RATE_LIMIT_DISABLED=true` present in `.env.local`.*

## Files Created

- `src/app/(admin)/admin/organizations/[id]/affiliation-section.tsx` — read-only, server-renderable "Council affiliation" section (always renders; headless copy "This organization has no recorded parent council."; parent name linking to `/admin/organizations/<parentId>`; relationship label; effective date via `<FormattedDate>` or "Predates our records"; "Minuted" / "Backfilled (no minute on file)" plus the minute reference). No form control of any kind.
- `src/app/(admin)/admin/organizations/[id]/affiliation-section.test.tsx` — 7 tests.
- `src/app/(admin)/admin/organizations/new/create-organization-form.test.tsx` — 17 tests (the first test file for this component).

## Files Modified

- `src/lib/org-provisioning.ts` — additive `getOrganizationAffiliationAdminDetail(organizationId)` + exported type `OrganizationAffiliationAdminDetail`; `and`, `isNull` added to the drizzle import. `createOrganization()` untouched.
- `src/lib/org-display.ts` — `relationshipTypeLabel()` beside `organizationTypeLabel()`.
- `src/app/(admin)/admin/organizations/[id]/page.tsx` — reads the affiliation, renders `<AffiliationSection>` directly after `<FoundingAdministratorSection>` and before "Current brand" (ruled order).
- `src/app/(admin)/admin/organizations/[id]/page.test.tsx` — mocks `@/lib/org-provisioning`; founding-section mock now renders a marker; 3 new tests (affiliation read by id; DOM order founding -> affiliation -> brand; headless copy).
- `src/app/(admin)/admin/organizations/new/page.tsx` — type-only eligible-parents query (`inArray(organizationType, [presbytery, synod, general_assembly])`, ordered by name, `getPlatformDb()`), grouped by type, degraded to `null` on throw. No `platformStatus` predicate.
- `src/app/(admin)/admin/organizations/new/create-organization-form.tsx` — `eligibleParents` prop; controlled `organizationType`; `parentChoice` state with `"none"` sentinel; unconditional clear on type change; native `<select id="parentOrganizationChoice" name="parentOrganizationChoice">` (never named `parentOrganizationId`); two hidden inputs carry the translated `parentOrganizationId` / `relationshipType` (empty strings for None); minute-reference `<Input maxLength={500}>` only while a parent is chosen; general_assembly renders the no-parent note instead of the field; empty-list and fetch-failure helper copy exactly as designed.
- `src/app/(admin)/admin/organizations/new/actions.test.ts` — backfill of the parent/relationship parsing branch (7 new tests). `actions.ts` NOT modified.
- `src/lib/org-provisioning.test.ts` — 4 DB-backed tests for the new read.
- `e2e/admin-organizations-create.spec.ts` — new test (congregation under `e2e-presbytery`); 360px block extended.

## Data shapes

```ts
type EligibleParentsByType = { presbytery: {id,name}[]; synod: {id,name}[]; general_assembly: {id,name}[] } | null; // null = fetch failed
type OrganizationAffiliationAdminDetail = { relationshipType; effectiveFrom: string|null; authority: "recorded"|"backfill"; minuteReference: string|null; parent: {id,name,slug,organizationType} } | null;
```

## Schema Changes

- None. No migration, no `db:push`, `src/lib/permissions.ts` untouched.

## Audit Events

- No new key. The existing `AUDIT_ACTIONS.ORG_CREATED` (`org.created`) metadata now carries real `parentOrganizationId` / `relationshipType` (rehearsal evidence below).

## Tests

| Suite | Result |
|---|---|
| `create-organization-form.test.tsx` (new) | 17 passed |
| `affiliation-section.test.tsx` (new) | 7 passed |
| `new/actions.test.ts` | 27 passed (20 existing + 7 backfill) |
| `[id]/page.test.tsx` | 5 passed (2 existing + 3 new) |
| `org-provisioning.test.ts` (DB-backed) | 20 passed (16 existing + 4 new) |
| `npm test` (no DB) | 265 files passed, 34 skipped; 3450 tests passed, 927 skipped |
| DB-backed full suite `npx dotenv-cli -e .env.local -- npx vitest run --no-file-parallelism` | 299 files passed; 4377 tests passed, 0 skipped, 0 failed (460 s) |
| e2e `admin-organizations-create.spec.ts` + `admin-organizations.spec.ts` (dev server 3500) | 15 passed |
| full `npm run test:e2e` (`E2E_BASE_URL=http://localhost:3500`) | 165 passed, 0 failed, 0 skipped (5.0 min) |

`npm run typecheck`: clean. `npm run lint` (`--max-warnings=0`): clean. `npm run check`: all five tripwires passed (audit-coverage, sql<Date>, deps-drift, brand-scope, secrets/PII). `npm run build` was not run in this phase (step 12 lists it; typecheck + dev-server rendering exercised every touched route) — left for qa/pre-push.

## Failing-first evidence

`create-organization-form.test.tsx` was written first and run against the OLD, parent-less `create-organization-form.tsx` (props not yet accepted, no parent control):

```
 ❯ src/app/(admin)/admin/organizations/new/create-organization-form.test.tsx (17 tests | 17 failed) 100ms
 Test Files  1 failed (1)
      Tests  17 failed (17)
 TestingLibraryElementError: Unable to find a label with the text of: /parent organization/i   (x11)
 AssertionError: expected null to be '' // Object.is equality   (hidden parentOrganizationId absent)
 ... Unable to find an element with the text: The General Assembly is the top of the hierarchy — it has no parent.
 ... Unable to find an element with the text: We couldn't load the list of presbyteries — try again.
```

This includes the type-change-filter test ("presbytery lists synods only") and the clear-on-type-change tests ("resets a chosen parent when the organization type changes", "clears even between congregation and new_worshiping_community"). After implementing: `Tests 17 passed (17)`.

## Browser rehearsal (Playwright, throwaway script in gitignored `scratch/`, deleted afterwards; `admin@presby.invalid`, dev server 3500)

1. `/admin/organizations/new`, type congregation: parent options were `None — this will be a root organization` + the five presbyteries only (no synod). Chose "Presbytery of the Tidewater": hidden `relationshipType` = `member_congregation`, hidden `parentOrganizationId` = `f8000000-0000-0000-0000-000000000002`. Added minute reference, created, landed on `[id]`. Headings in DOM order: `Founding administrator, Council affiliation, Current brand, Set brand, Live preview, Profile, Service times & office hours, ...` — founding-administrator first, affiliation second, brand third. Parent link href `/admin/organizations/f8000000-0000-0000-0000-000000000002`. (My script's separate innerText-offset check was a script bug — the "main, body" locator did not match the page text — and printed `ordered: false`; the DOM heading order above is the real evidence, and the page test `stacks founding-administrator section, then council affiliation, then current brand` pins it in CI.)
2. Type presbytery: options `None…`, `Synod of the Coastal Plain` (the only synod). Helper "Optional. Leave as None for an independent organization." — no wording implies a presbytery needs a synod. (The empty-list copy "No synods exist yet — create one first." is unit-tested; this database has one synod, so it was not reachable live.)
3. Type general_assembly: `#parentOrganizationChoice` count 0; note "The General Assembly is the top of the hierarchy — it has no parent." visible.
4. Root presbytery with the default "None" -> created, landed on `[id]`, headless copy "This organization has no recorded parent council." visible. SQL: `select count(*) from organization_affiliations ... slug = <root>` -> `0`; the root org's `parent_id` is null (`has_parent: false`, path `rehearsal_picker_root_...`). The sentinel translation works end to end.
5. Chose a presbytery as congregation, then switched type to new_worshiping_community: select value `none`, hidden `parentOrganizationId` `""`.
6. 360px: `/new` (with parent + minute reference shown) and `[id]` both: no horizontal overflow; submit button 44px high; parent select 296x44. Screenshot reviewed.

SQL evidence (taken before cleanup):

```
organization_affiliations (congregation): parent=tidewater, relationship_type=member_congregation, authority=recorded,
  minute_reference="Rehearsal minute 2026-10 item 2", effective_to=null
organizations.path: coastal_plain_synod.tidewater.rehearsal_picker_cong_...   (parent_id derived by trigger)
organization_affiliations rows for the root org: 0
audit_events (action 'org.created') metadata:
  cong: parentOrganizationId=f8000000-0000-0000-0000-000000000002, relationshipType=member_congregation
  root: parentOrganizationId=null, relationshipType=null
```

## State left behind

- Rehearsal orgs deleted via the `deletable_until` stamp + delete; verified 0 rows matching `rehearsal-%`, `e2e-org-create%`, `org-prov-test%`; `organization_affiliations` back to 10 (the Phase 1 baseline). `audit_events` rows for the two rehearsal creates remain (append-only by design; harmless).
- Dev server (port 3500) stopped by PID; port verified free. `scratch/` deleted. No commits, pushes or stashes. `e2e/support/.auth/*` regenerated by globalSetup (gitignored).

## Implementer Notes

- **No deviation from the Phase 3 design.** Two small notes: (1) the form's three `<select>`s and the submit button are now 44px high (`h-11`) instead of `h-9`/default, per the 44px touch-target rule for primary controls — this also changes the two pre-existing selects (organization type, platform status) for consistency; (2) the single visible parent list is flat (one type at a time), so no `<optgroup>` is rendered — "grouped by type" is the data shape handed from `new/page.tsx`, filtered to one group by the chosen type.
- Named residual unchanged: the 500-char `minuteReference` bound is client-only (`new/actions.ts` stays untouched per Constraint 3).
- `[id]/page.test.tsx` needed a mock of `@/lib/org-provisioning` (the page now imports it, which transitively pulls the DB layer).

## Proposed at integration (orchestrator applies; shared files not edited on this branch)

- `docs/TODO.md`: close the line "`/admin/organizations/new` has no control for `parentOrganizationId` / `relationshipType` ... (Phase 6 note 4, 2026-09-24)" with the ship date.
- `docs/product/functionality-map.md` Organizations bullet (~§121): add "an optional parent-council picker (grouped by type, filtered client-side to the polity-legal pairing, with a derived hidden relationship type and an optional minuted reference) provisions a congregation/NWC/presbytery/synod directly under its council; `[id]` adds a read-only Council affiliation section naming the open `organization_affiliations` row with a link to the parent's own `[id]` page"; add `affiliation-section.tsx` to the bullet's file list.
- `/release-notes` entry (platform admins can now create a congregation under its presbytery and see the affiliation on the organization page; no member-visible change). No `DECISION-158`.
- Optional TODO follow-ups to consider (not opened by me): server-side length bound on `minuteReference` (accepted residual); a live empty-synod-list rehearsal if a fresh database is ever used.

---

# Phase 5 — Verification (qa) — first pass

**Date:** 2026-10-05
**Verified by:** qa (worktree `presby-wt-picker`, branch `pipeline/org-parent-picker` @ `d48e1ef`; Neon `br-quiet-rain-axnzktt6`, checked with `current_setting('neon.branch_id', true)` on both the platform connection (`neondb_owner`) and the app connection (`presby_app`); `env | grep DATABASE_URL` was empty; `RATE_LIMIT_DISABLED=true` is present.)

*Recorded verbatim by the orchestrator, 2026-10-05.*

**Phase 2 skip is justified.** `git diff d48e1ef` touches no migration, no table, no SQL function, no permission key and no `package.json`. The only lib change is one additive read function plus one label helper.

## Type Check

- `npm run typecheck`: **PASS** (exit 0)
- `npm run lint` (`--max-warnings=0`): **PASS**
- `npm run check`: **PASS**, all five tripwires (audit-coverage, sql<Date>, deps-drift, brand-scope, secrets/PII)
- `npm run build` (Next 16.3.6): **PASS** (exit 0). `/admin/organizations/new` and `/admin/organizations/[id]` compile as dynamic routes. Phase 4 had not run this; it is now covered.
- `scripts/test-rls.sql`: **not required**. There is no schema change.

## Unit Tests

| Suite | Result |
|---|---|
| `npm test` (no DB) | 265 files passed, 34 skipped; 3450 tests passed, 927 skipped (14.5 s). The skips are the DB-gated specs, all run in the next row. |
| DB-backed: `npx dotenv-cli -e .env.local -- npx vitest run --no-file-parallelism` | **299/299 files, 4377/4377 tests passed, 0 skipped, 0 failed** (450.6 s) |

Failures: none. Both runs match Phase 4's counts exactly.

## End-to-End Tests

| Run (dev server on 3500, `E2E_BASE_URL=http://localhost:3500`) | Result |
|---|---|
| `e2e/admin-organizations-create.spec.ts` + `e2e/admin-organizations.spec.ts` | 15 passed, 0 failed (26.2 s) |
| Full `npm run test:e2e` | **165 passed, 0 failed, 0 skipped** (4.0 min). Reproduces Phase 4's 165/0/0. |

**Blast radius (item 8):** the existing no-parent test still passes ("admin creates a congregation and lands on its detail page"). It is the backstop for the "None" sentinel wiring.

## Regression Tests Added

- **Failing-first, reproduced by QA:** `git show d48e1ef:…/create-organization-form.tsx` (the old, parent-less form) written into scratch with a stub `./actions`, next to an unmodified copy of `create-organization-form.test.tsx`, under a scratch vitest config: **17 failed / 17** — matching Phase 4's record (`Unable to find a label with the text of: /parent organization/i` ×11, hidden-input nulls, missing General Assembly and fetch-failure copy). The same 17 tests against the current form: **17 passed / 17**.
- `create-organization-form.test.tsx` (new, 17 tests): filtering the parent list by organization type; clearing the parent on any type change, including congregation ↔ NWC; the derived `relationshipType` for all four pairs; the "None" sentinel (submits an empty `parentOrganizationId`, never `"none"`, and the visible select is not named `parentOrganizationId`); General Assembly, empty-list and fetch-failure states; the minute-reference input being gated, with `maxLength` 500.
- `affiliation-section.test.tsx` (new, 7 tests): the read-only section, including the headless copy.
- `[id]/page.test.tsx` (+3): the affiliation read is called by id; DOM order founding administrator → Council affiliation → brand; headless copy.
- `new/actions.test.ts` (+7, backfill): rejects a non-UUID parent; rejects a missing or bogus relationship; the `invalid_parent` copy mapping; None creates a root org with no parent keys.
- `org-provisioning.test.ts` (+4, DB-backed): the open row plus parent identity (with an `invited` parent); a backfill row reads as `authority 'backfill'`; a headless org returns null; an unknown id returns null.
- **Gap: no test refuses a `relationshipType` that does not fit the parent/child pair.** It cannot exist yet, because the server accepts that input (see the probes below).

## Coverage on Critical Modules

- `src/lib/permissions.ts`: 100% · `src/lib/two-factor.ts`: 91.3% statements · `src/lib/flags.ts`: 100%
- Touched files: `new/create-organization-form.tsx` 96.3% statements; `new/actions.ts` 100%; `[id]/page.tsx` 75%; `org-display.ts` 100% statements / 75% branches; `new/page.tsx` **0%** — the eligible-parents query and its degrade-to-`null` catch (Gap 4) have no unit test; the live path is covered by e2e and the rehearsal; the catch branch only through the form's `eligibleParents={null}` prop test. Minor note.

## Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| GET `/admin/organizations/new` (`new/page.tsx:32-33`); the gate runs before the new eligible-parents query (`:44`) | yes | yes | `FEATURES.ADMIN_ORGANIZATIONS` |
| GET `/admin/organizations/[id]` (`[id]/page.tsx:68-69`); the gate runs before `getOrganizationAffiliationAdminDetail(id)` (`:110`) | yes | yes | `FEATURES.ADMIN_ORGANIZATIONS` |
| `createOrganizationAction`: **unchanged** (`git diff d48e1ef -- new/actions.ts` is empty); gate at `actions.ts:90-93` | yes | yes | `FEATURES.ADMIN_ORGANIZATIONS` |

- **`createOrganization()` is unchanged:** its function body has the same md5 at `d48e1ef` and on the branch. The only removed line in `org-provisioning.ts` is the `drizzle-orm` import, widened to `and, eq, isNull`.
- **No route handlers** were added or changed.

**Live catalog:** `organization_affiliations` is `relrowsecurity=t`, `relforcerowsecurity=t`, owned by `neondb_owner`. `aclexplode` grants: `presby_platform` INSERT,SELECT; `presby_app` SELECT; `neondb_owner` all privileges. `neondb_owner` and `presby_platform` are both `rolbypassrls=t`; `getPlatformDb()` resolves to `neondb_owner`, so the read is served by bypass-RLS SELECT (the DB-backed tests prove rows come back). The query filters `isNull(effectiveTo)` (`org-provisioning.ts:~487`).

## Server-side refusal probes (item 5)

Method: a scratch vitest file under `scratch/` called the real `createOrganizationAction`. Only `auth` (an admin session), `next/cache` and `recordAudit` were mocked. It ran against the real DB.

| Probe | Result | Refusing layer |
|---|---|---|
| (a) `parentOrganizationId="none"` | `{ok:false,"Choose a valid parent organization."}`, 0 rows | action `UUID_RE` (`actions.ts:140`) |
| (a2) SQL-shaped string | same, 0 rows | action `UUID_RE` |
| (b) congregation under congregation `e2e-alpha` | `invalid_parent` copy, 0 rows | `presby_assert_council_authority()` BEFORE INSERT trigger (42501), mapped in `createOrganization()` |
| (b2) congregation under a synod | `invalid_parent` copy, 0 rows | same trigger |
| (c) nonexistent UUID parent | `invalid_parent` copy, 0 rows | FK 23503, mapped in `createOrganization()` |
| (d3) empty / (d4) bogus `relationshipType` | "Choose a valid relationship to the parent.", 0 rows | action enum check (`actions.ts:143`) |
| **(d) congregation under presbytery with `relationshipType=member_synod`** | **`{ok:true}`. Row created: `congregation`, `member_synod`, parent `e2e-presbytery`** | **none** |
| **(d2) congregation under presbytery with `relationshipType=member_nwc`** | **`{ok:true}`. Row created: `congregation`, `member_nwc`** | **none** |

No probe returned a 500 or threw.

**Why (d) gets through:** the trigger checks parent type against child type only (`drizzle/0044:663-676`); the CHECK on `relationship_type` is an enum check only (`0044:368`); `createOrganization()` checks only that a relationship type is present (`org-provisioning.ts:270`); `actions.ts:143/153` checks only that the value is a valid enum. No layer ties `relationship_type` to the (parent, child) pair, so the hidden field this pipeline derives on the client is trusted as-is by the server. The form itself always derives the correct value; the gap needs a hand-built POST from someone holding `ADMIN_ORGANIZATIONS`. The gap predates this branch: the action and the lib are byte-identical to `main`. But the design's Edge Cases claim that "the client filter is a courtesy, never the enforcement boundary" is false for this field. The data consequence is the one `lifecycle.ts:286-290` warns about: a congregation recorded as `member_nwc` breaks "how many congregations does this presbytery have", a live per-capita count.

All four probe orgs (two runs) were deleted with the `deletable_until` stamp + delete; 0 remain.

## Browser rehearsal (item 6)

Playwright driver on 3500, signing in as `admin@presby.invalid` with a real `/signin` post and `waitForURL` after each click; no `networkidle`.

1. **Congregation under a presbytery.** The parent options were "None — this will be a root organization" plus exactly the five presbyteries in the DB; no synod appeared. Picked "Presbytery of the Tidewater": hidden `relationshipType=member_congregation`, hidden `parentOrganizationId=f8000000-…0002`, visible select `name="parentOrganizationChoice"`. Added a minute reference and created the org. Landed on `[id]`; h2 DOM order: `Founding administrator, Council affiliation, Current brand, Set brand, Live preview, Profile, Service times & office hours, Site`. The affiliation section read: "Parent | Presbytery of the Tidewater (Presbytery) | Member congregation | 10/5/2026 | Minuted — QA minute 2026-10-05 item 4"; the link href was `/admin/organizations/f8000000-…0002` and clicking it opened the parent's page.
2. **Presbytery:** options were None plus "Synod of the Coastal Plain" only. Helper text: "Optional. Leave as None for an independent organization."
3. **General Assembly:** `#parentOrganizationChoice` count 0; the note "The General Assembly is the top of the hierarchy — it has no parent." is visible; both hidden fields empty.
4. **Root presbytery with "None":** landed on `[id]` with the h2 order unchanged and "This organization has no recorded parent council." visible. SQL: **0** affiliation rows of any kind and `parent_id` null. The sentinel translation works end to end.
5. **Type switch after picking a parent:** before — the parent id, `member_congregation`, the minute input present; after switching to NWC — select `none`, both hidden fields empty, minute input gone; re-picking a parent under NWC gave `member_nwc`; switching to presbytery cleared everything again.
6. **360px:** `/new`, `[id]` for the congregation and `[id]` for the root all had `scrollWidth=360=clientWidth`. The three selects are 296×44 and submit is 184×44. Notes, not failures: the minute-reference text input is **36px** tall (the shadcn default `h-9`, left out of Phase 4's `h-11` pass); the parent link is an inline 17px text link.
7. **Stacking with the merged v0.29.0 pipeline:** "Founding administrator" is the first h2 for both new orgs, each with zero administrators.

SQL evidence, taken before cleanup:

```
organizations: qa-picker-cong-… congregation parent_id=f8000000-…0002 path=coastal_plain_synod.tidewater.qa_picker_cong_…
               qa-picker-root-… presbytery  parent_id=NULL          path=qa_picker_root_…
organization_affiliations (cong): parent=tidewater member_congregation authority=recorded
   minute_reference="QA minute 2026-10-05 item 4" effective_from=2026-10-05 effective_to=NULL recorded_by=<admin id>
open rows: cong=1, root=0 (root total rows=0)
audit_events org.created: cong parentOrganizationId=f8000000-…0002 relationshipType=member_congregation
                          root parentOrganizationId=null relationshipType=null   (actor admin@presby.invalid)
```

Both rehearsal orgs were deleted (stamp + delete); 0 remain.

## Phase 6 note: F124 hydration-gate class (not a failure)

The parent `<select>`, the type `<select>` and both hidden inputs are pure `useState`, outside react-hook-form. The server renders the hidden inputs empty and the parent select as "none". A parent picked before hydration does not update the hidden fields; React 19 then reconciles the controlled select back to state "none", or a replayed submit carries the server-rendered empty values. The result is a **silent root-org create**: no parent, `authority` unset. That is the safe direction for integrity, but it **cannot be repaired through the product**, because there is deliberately no reparent control (Adversarial §7). Likelihood is low (a desktop platform-admin page, with name and slug to type before the parent field). It belongs on the F124 triage list; the fix is disabling submit until hydrated or applying the hydration-gate pattern. Reasoned from the code, not probed empirically.

## Cleanup

Dev server stopped by PID (port 3500 free); `scratch/` and `coverage/` deleted; `organization_affiliations` back to its 10-row baseline; 0 `qa-picker-%`, `e2e-org-create%` or `org-prov-test%` orgs remain; `git status --short` shows the same 13 entries as Phase 4; nothing committed, pushed or stashed. Cosmetic: the new function and type were inserted between the comment "Re-exported so callers…" (`org-provisioning.ts:441`) and the export it describes (`:510`) — move the comment back down.

## Verdict

**FAIL.** One required check went red: item 5(d). A `relationshipType` that does not fit the (parent, child) pair is **accepted and persisted** (`congregation` + `member_synod` / `member_nwc` under a presbytery). The refusing layer is none. Every other check is green: typecheck, lint, check, build, 4377/4377 DB-backed tests, e2e 165/0/0, failing-first reproduced, the gate audit, the live catalog, and all seven rehearsal steps.

**Per-Phase Status row:**

| 5 — Verification | qa | Ready for qa re-verification (first pass: FAIL on probe (d); fix pass landed — narrow re-run: actions/provisioning tests, probes (d)/(d2), one e2e spot-check) | — | 2026-10-05 |

**Handoff: tech-lead (Phase 3), then the implementer.** The fix needs Constraint 3 (`new/actions.ts` untouched) relaxed, and that is a design ruling. Where it fails: `src/app/(admin)/admin/organizations/new/actions.ts:143` and `:153` accept any enum value; `src/lib/org-provisioning.ts:270` checks presence only. Smallest fix: in `createOrganization()` (so every caller gets it) or in the action, check that `relationshipType` equals `{congregation: member_congregation, new_worshiping_community: member_nwc, presbytery: member_presbytery, synod: member_synod}[organizationType]`; return the existing "Choose a valid relationship to the parent." copy or `invalid_input` otherwise. The alternative is to derive it server-side and ignore the posted value. Regression tests in `new/actions.test.ts` (the "parent and relationship parsing" describe at `:269`) and/or `org-provisioning.test.ts`, failing-first. Optional while in the file: move the misplaced re-export comment (`org-provisioning.ts:441`), and make the minute-reference input `h-11`. Re-verification after the fix is narrow: the actions/provisioning tests, probe (d), and one e2e spot-check.

---

# Phase 3 addendum — the relationship type is enforced server-side (orchestrator ruling, 2026-10-05)

*Loop-back from Phase 5 to Phase 3 per the earliest-origin rule: Phase 3's Edge Cases asserted "the client filter is a courtesy, never the enforcement boundary", which QA proved false for `relationshipType`. The constraint that produced the gap — kickoff Constraint 3, "`new/actions.ts` and `createOrganization()` stay untouched" — was the orchestrator's Rule 16 collision guard against the founding-administrator pipeline, which has since merged (PR #23, v0.29.0). It was never a design invariant, so the orchestrator relaxes it here rather than reopening a full tech-lead pass.*

**Ruling.**
1. **Enforce in `createOrganization()` (`src/lib/org-provisioning.ts`), not only in the action**, so every caller — the action today, any future importer or script — gets the same boundary. When `parentOrganizationId` is present, `relationshipType` must equal the canonical pairing for the child's `organizationType`: `congregation → member_congregation`, `new_worshiping_community → member_nwc`, `presbytery → member_presbytery`, `synod → member_synod`; `general_assembly` may not have a parent. A mismatch returns the existing `invalid_parent`-class result (the action's existing copy; no new copy string unless the implementer finds the existing one misleading — then the new string is a one-line addition to the action's mapping, which Constraint 3 no longer forbids). The parent's *type* is already enforced by `presby_assert_council_authority()`; this ruling closes the *relationship-type* half only.
2. **The action may change** to map the new refusal if a distinct result arm is added; otherwise it stays untouched. `createOrganization()`'s result union may gain one arm; its transaction order does not change.
3. **Tests, failing-first:** `org-provisioning.test.ts` (DB-backed) — congregation under a presbytery with `member_synod` and with `member_nwc` are refused and write no row; the canonical pair still succeeds; `new/actions.test.ts` — the action maps the refusal to human copy. QA's probe (d)/(d2) are the acceptance criteria.
4. **While in the files (QA's non-blocking notes):** the minute-reference `Input` gets `h-11` (44px) like its sibling controls; the misplaced "Re-exported so callers…" comment in `org-provisioning.ts` moves back to the export it describes.
5. **Not in scope:** the pre-hydration pick on this `useState` select (F124 class, QA's Phase 6 note) — tracked with F124's triage at integration, not fixed here; a server-side `minuteReference` length bound stays the named residual.

**Implementer:** full-stack-developer, one fix pass. Then QA re-verifies narrowly (the actions/provisioning tests, probes (d)/(d2), one e2e spot-check, `git status` clean), then Phase 6.

| 3 — Technical design (addendum) | orchestrator | Complete — Constraint 3 relaxed (its reason, the founding-admin collision, is gone); `relationshipType` ↔ `organizationType` pairing enforced in `createOrganization()` for every caller; tests failing-first; two cosmetic notes folded in | Design complete, implementer named | 2026-10-05 |

## Phase 4 fix pass (2026-10-05)

**Implementer:** full-stack-developer, per the Phase 3 addendum.

**Files modified**
- `src/lib/org-display.ts` — new exported `RELATIONSHIP_BY_CHILD_TYPE` (import-safe, no `server-only`); the single pairing table.
- `src/lib/org-provisioning.ts` — the check, a new result arm `relationship_mismatch`, and the "Re-exported so callers…" comment moved back above `export type { OrganizationType, PlatformStatus, RelationshipType }`.
- `src/app/(admin)/admin/organizations/new/actions.ts` — maps `relationship_mismatch` to "That relationship doesn't fit this organization type — choose the parent again and the relationship is set for you." (the existing `invalid_parent` copy is about the parent receiving the child, so it would mislead here; Constraint 3 relaxed per the addendum).
- `src/app/(admin)/admin/organizations/new/create-organization-form.tsx` — local `RELATIONSHIP_BY_CHILD` removed, now uses the shared table (so no duplicate to drift); minute-reference `Input` gets `h-11`.
- Tests: `src/lib/org-provisioning.test.ts`, `src/app/(admin)/admin/organizations/new/actions.test.ts`, `src/lib/org-display.test.ts`.

**Check location.** `createOrganization()`, inside the `if (input.parentOrganizationId)` block, after the "needs a relationship type" check and before the recording-user check, i.e. before any `getPlatformDb()` write. No canonical pairing for the child type (general_assembly) returns `invalid_parent`; a relationship that differs from the canonical one returns `relationship_mismatch`. Transaction order is unchanged. The database still enforces parent type vs child type (`presby_assert_council_authority()`); nothing there ties the relationship type to the pair, which is what this closes.

**Failing-first (DB-backed, `npx dotenv-cli -e .env.local -- npx vitest run src/lib/org-provisioning.test.ts -t "relationship type must fit"`)**
- Red, before the implementation: 3 failed | 2 passed. The congregation-under-presbytery cases with `member_synod`, `member_nwc` and `member_presbytery` each failed with `expected { kind: 'ok', … } to deeply equal { kind: 'relationship_mismatch' }` (the bug: an org and affiliation were written). The canonical-pair test and the general_assembly-with-parent test passed (the trigger already refused the latter via `invalid_parent`; the new pre-write check makes that refusal independent of the trigger).
- Action test red: `maps relationship_mismatch to human copy…` failed with `expected { ok: true, organizationId: undefined } to deeply equal { ok: false, … }` (27 passed, 1 failed).
- Green after: 5 passed (DB-backed); `new/` + `org-display` 49 passed. Each refusal test also asserts 0 `organizations` rows and 0 `organization_affiliations` rows for the attempted slug.
- Rows leaked by the red run (the bug wrote them) were removed with the probe rows below.

**Probes (d)/(d2), re-run** with a scratch vitest file (gitignored `scratch/`, real `createOrganizationAction`, `auth` mocked as an admin session, real DB, branch `br-quiet-rain-axnzktt6` confirmed via `neon.branch_id`; `DATABASE_URL` not in the environment):
- (d) congregation under a presbytery, `member_synod`: `{"ok":false,"error":"That relationship doesn't fit this organization type — …"}`, 0 organizations rows.
- (d2) `member_nwc`: same refusal, 0 rows.
- Control, `member_congregation`: `{"ok":true,…}`, 1 organization and exactly 1 affiliation under the probe parent.
- Cleanup: probe orgs, the red-run orgs and the probe presbytery deleted; afterwards 0 `picker-probe-%`, `org-prov-test-%` or `e2e-org-create%` orgs and `organization_affiliations` back at its 10-row baseline. `scratch/` deleted.

**Commands**
- `npm run typecheck`: pass. `npm run lint`: pass (0 warnings). `npm run check`: pass (all tripwires).
- `npm test`: 265 files passed, 34 skipped; 3452 passed, 932 skipped (4384).
- `npx dotenv-cli -e .env.local -- npx vitest run --no-file-parallelism`: 299 files passed; **4384/4384 passed**, 0 skipped.
- `e2e/admin-organizations-create.spec.ts` on port 3500: 6 passed (including the congregation-under-e2e-presbytery path and the "None" path). Dev server stopped by PID; port 3500 free.
- No schema change, no `db:push`; nothing committed, pushed or stashed.

**Handoff:** qa re-verification, narrowly as the addendum names it.

---

# Phase 5 — Verification (qa) — second pass (narrow re-verification after the Phase 4 fix pass)

**Date:** 2026-10-05
**Verified by:** qa
**Environment:** worktree `presby-wt-picker`, branch `pipeline/org-parent-picker`. `env | grep DATABASE_URL` empty. `select current_setting('neon.branch_id', true)` returned `br-quiet-rain-axnzktt6` (user `neondb_owner`), checked at the start and again at cleanup. No `db:push`.

*Recorded verbatim by the orchestrator, 2026-10-05.*

## Diff review (fix pass)

- **The check runs before any write.** It sits at `org-provisioning.ts:279-291`, inside `if (input.parentOrganizationId)` (`:271`), after the relationship-presence check and before the recorder check. The first `getPlatformDb()` call is at `:301` and the transaction starts at `:336`. The probes confirm this at runtime: `getPlatformDb()` was called 0 times during every refused action.
- **Coverage of the pairings:** `RELATIONSHIP_BY_CHILD_TYPE[input.organizationType]` (`org-display.ts:61-68`) holds all four pairings; `general_assembly` has no entry, so it returns `invalid_parent` (`:286-288`); any other mismatch returns the new arm `relationship_mismatch` (`:289-291`; union member at `:85`).
- **Transaction order is unchanged.** The `createOrganization()` body at `d48e1ef` vs the branch differs only by the 13 added lines of the check.
- **The form uses the shared table.** `create-organization-form.tsx:12` imports `RELATIONSHIP_BY_CHILD_TYPE` and uses it at `:184`; no second pairing table exists in non-test `src/` (`actions.ts:61-62` is the enum allow-list, not a pairing table).
- **The action maps the new arm to readable text.** `actions.ts:196-203`: "That relationship doesn't fit this organization type — choose the parent again and the relationship is set for you." The diff to `actions.ts` is +8 lines, only this `case`.
- **Cosmetic items:** the minute input is `mt-1 h-11` (`create-organization-form.tsx:233`); the "Re-exported so callers…" comment now sits directly above its export (`org-provisioning.ts:522-525`).

## Type Check

`npm run typecheck` **PASS** · `npm run lint` **PASS** · `npm run check` **PASS** (all tripwires) · `npm run build` **PASS** (`/admin/organizations`, `/[id]` and `/new` compile as dynamic routes).

## Unit Tests

| Suite | Result |
|---|---|
| `npm test` (no DB) | 265 files passed, 34 skipped; 3452 passed, 932 skipped, 4384 total (13.4 s); all skips DB-gated and run in the next row |
| DB-backed `npx dotenv-cli -e .env.local -- npx vitest run --no-file-parallelism` | **299/299 files, 4384/4384 passed, 0 skipped, 0 failed** (426.0 s) |

## End-to-End Tests

`e2e/admin-organizations-create.spec.ts` + `e2e/admin-organizations.spec.ts` on 3500: **15 passed, 0 failed, 0 skipped** (23.5 s) — the parent happy path (`:119`), the "None" path (`:68`) and 360px (`:239`).

**Playwright walk** (throwaway script, deleted): the minute-reference input is now **44px** tall at 1280px (672×44) and 360px (296×44); the parent select is 44 tall; at 360px `scrollWidth=360=clientWidth`. Picked "Presbytery of the Tidewater" (hidden `relationshipType=member_congregation`, `parentOrganizationId=f8000000-…0002`), added a minute reference, created; landed on `[id]` with the h2 order Founding administrator, Council affiliation, Current brand, …; the parent link points to the parent's `[id]`; "Member congregation" and the minute text visible. SQL before cleanup: one affiliation row, `member_congregation`, `recorded`, `effective_to=NULL`, parent `tidewater`. Org deleted; 0 remain.

## Server-side refusal probes (re-run)

Same method as the first pass (scratch vitest calling the real `createOrganizationAction`; only `auth` as admin with `ADMIN_ORGANIZATIONS`, `next/cache`, `recordAudit`, `server-only` mocked; real DB; `getPlatformDb` wrapped in a call counter). Run twice with identical results.

| Probe | Result | Rows written | `getPlatformDb()` calls | Refusing layer |
|---|---|---|---|---|
| (d) congregation under `e2e-presbytery`, `member_synod` | `{ok:false}`, "That relationship doesn't fit this organization type — …" | 0 / 0 | 0 | `createOrganization()` pairing check, `org-provisioning.ts:289-290` → `actions.ts:196` |
| (d2) same, `member_nwc` | same | 0 / 0 | 0 | same |
| (d5) presbytery under `coastal-plain-synod`, `member_congregation` | same | 0 / 0 | 0 | same |
| (d6a) general_assembly under the synod, `member_synod` | `{ok:false}`, `invalid_parent` text | 0 / 0 | 0 | pairing check, no canonical entry, `org-provisioning.ts:286-287`; the trigger is never reached |
| (d6b) general_assembly under the presbytery, `member_presbytery` | same as (d6a) | 0 / 0 | 0 | same |
| (d6c) general_assembly under the synod, `member_congregation` | same as (d6a) | 0 / 0 | 0 | same |
| Control: congregation under `e2e-presbytery`, `member_congregation` | `{ok:true, organizationId}` | 1 org, exactly 1 affiliation | 1 | n/a |

No probe threw or returned a 500.

## Regression Tests Added

- **Failing-first reproduced by QA:** `src/lib/org-provisioning.ts` copied to `scratch/regress/` with only lines 279-291 removed (`diff` confirmed), an unmodified copy of `org-provisioning.test.ts` beside it, run with `-t "relationship type must fit"` against the DB: **3 failed, 2 passed** (`member_synod`, `member_nwc`, `member_presbytery` each `expected { kind: 'ok', … } to deeply equal { kind: 'relationship_mismatch' }`; the canonical pair and general_assembly passed, the latter because the trigger already refuses it). Matches Phase 4's "3 red, 2 green". Green against the real module inside the 4384/4384 run. The red run's leaked rows were deleted; 0 remain.
- `org-provisioning.test.ts:570` — "relationship type must fit the (parent, child) pair — regression for probe (d)/(d2)" (5 DB-backed tests, each asserting 0 org and 0 affiliation rows on refusal).
- `new/actions.test.ts:369` — "maps relationship_mismatch to human copy, with no audit event — regression for probe (d)".

## Coverage on Critical Modules

Unchanged by this fix pass; first-pass figures stand (`permissions.ts` 100%, `two-factor.ts` 91.3%, `flags.ts` 100%).

## Feature-Gate Audit

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|---|---|---|---|
| `createOrganizationAction` (`new/actions.ts`); gate at `:90-94`, before parsing (`:96`), before `createOrganization()` (`:165`) and before the new `relationship_mismatch` mapping (`:196`) | yes | yes | `FEATURES.ADMIN_ORGANIZATIONS` |
| GET `/admin/organizations/new` and `/[id]` | not changed by the fix pass; the first-pass audit stands | | |

No route handlers under `src/app/(admin)/admin/organizations`.

## Cleanup

Dev server stopped by PID (port 3500 free); `scratch/` and `coverage/` deleted; `organization_affiliations` back at its **10-row baseline**; 0 `qa-p5-%`, `org-prov-test%`, `e2e-org-create%`, `qa-picker%` or `picker-probe-%` orgs remain; `git status --short` shows the same 15 entries as the fix pass; nothing committed, pushed or stashed.

## Verdict

**PASS.** Probes (d), (d2), (d5) and (d6a-c) are refused by the pairing check at `src/lib/org-provisioning.ts:285-291`, before any DB call, with 0 rows written; the canonical control succeeds with exactly 1 affiliation; failing-first reproduced; typecheck/lint/check/build green; DB-backed 4384/4384 with 0 skips; e2e 15/0/0; the walk confirms a 44px minute input and the affiliation section on `[id]`; gate audit clean.

**Non-blocking note for Phase 6:** the comment at `new/actions.ts:131-135` ("NO form control ships in this pipeline — the create form still offers root orgs only") is now out of date. Cosmetic; fix at integration.

**Per-Phase Status row:**

| 5 — Verification (second pass) | qa | Complete — probes (d)/(d2)/(d5)/(d6) refused by `createOrganization()`'s pairing check before any DB call, 0 rows; control 1 affiliation; failing-first reproduced (3 red / 2 green on a stripped copy); typecheck/lint/check/build green; DB suite 4384/4384, 0 skipped; e2e 15/0/0; minute input 44px; gate audit clean | PASS | 2026-10-05 |

**Handoff: analyst (Phase 6).** Carry forward the F124 hydration-gate note from the first pass and the out-of-date `actions.ts:131` comment.

---

# Phase 6 — Shipped vs Intent (analyst)

**Date:** 2026-10-05
**Reviewed by:** analyst

*Recorded verbatim by the orchestrator, 2026-10-05. The analyst read the whole work-log, then walked the form, page, action, `org-provisioning.ts`, `org-display.ts`, the affiliation section and the `[id]` page against Phase 1; QA's second pass (4384/4384 DB-backed tests, e2e 15/0/0) stands; no DB queries, nothing written.*

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> A platform admin can now provision a congregation, NWC, presbytery or synod under its council through the product. The parent is picked from a list filtered to the legal pairing, the relationship is derived rather than typed, and the affiliation is shown on `[id]` with a link to the parent. The server enforces the pairing for every caller. The one real hazard is a pre-hydration pick that silently creates a root org the product cannot repair, and that is a one-line follow-up, not rework.

## What's Working

- **Parent filtered to the legal pairing, relationship derived.** Presbyteries for a congregation or NWC, synods for a presbytery, General Assembly orgs for a synod. The relationship is a hidden field read from `RELATIONSHIP_BY_CHILD_TYPE`; the form and `createOrganization()` share that one table, so the filter and the enforcement cannot drift.
- **"None" is a legitimate root.** The sentinel `"none"` is translated to empty hidden fields, so a presbytery with no synod creates exactly as before. The `[id]` section always renders; a headless org reads "This organization has no recorded parent council." with no warning styling. QA confirmed 0 affiliation rows and a null `parent_id` for a root create.
- **General Assembly has no parent field.** An informational line says it is the top of the hierarchy.
- **Type change clears the parent and the minute input.** A stale parent id cannot survive a type switch.
- **Optional minute reference.** Appears only when a parent is chosen, capped at 500 characters in the client, 44px tall; records the affiliation as `recorded` rather than `backfill`.
- **The `[id]` read-back.** After the founding administrator and before the brand, as ruled (QA's DOM order check agrees); the parent name links to the parent's `[id]`; relationship, effective date and minuted/backfilled status shown.
- **Type-only parent predicate.** `new/page.tsx` has no `platformStatus` filter, so `invited` and `unmanaged` parents stay eligible, as ruled.
- **Server enforcement is in `createOrganization()`.** The `relationship_mismatch` check runs before any write; refusals leave 0 rows and call `getPlatformDb()` 0 times; `general_assembly` with a parent is refused as `invalid_parent` independent of the trigger; failing-first; QA's probes (d), (d2), (d5), (d6a-c) refused.

## Intent-vs-Shipped Diff

- Pick a parent filtered to the legal pairing — **matches**; a native `<select>` replaced the "searchable combobox" because no primitive exists (Phase 3, `docs/ui-standards.md`): acceptable drift, the list is flat and short and the 360px risk is gone by construction.
- The relationship is derived, not typed — **matches, and stronger than designed**: now enforced server-side too (the Phase 5 FAIL and loop-back).
- Optional minute reference with a bound (Gap 7) — `maxLength={500}` client-only: acceptable drift, named residual, follow-up 3.
- See the affiliation on `[id]` (Gap 1) — **matches**.
- Stacking order vs founding-administrator (Gap 2) — **matches**, verified after the v0.29.0 merge.
- Empty parent list reads as a state (Gap 3) — **matches** ("No presbyteries exist yet — create one first." and the synod / General Assembly equivalents).
- Fetch failure degrades (Gap 4) — **matches**, one nit: the copy says "try again" but offers no retry affordance; the admin reloads. Acceptable for an admin desktop form.
- 360px (Gap 5) — **matches** (QA: `scrollWidth=360=clientWidth`; selects 296×44; minute input 296×44 after the fix).
- Congregation profile fields (Gap 6) — **deferred, tracked** (`docs/TODO.md` Track P: `pcusaPin`, address, `yearOrganized`).
- Type-only filter (Gap 8) — **matches**.
- No set/change-parent control — **matches (ruled out of scope)**; consequence under Edge Cases.
- `presby_organize_congregation()` — **deferred, tracked**.
- Audit — **matches**: `ORG_CREATED` metadata now carries the real `parentOrganizationId` and `relationshipType`, no new key; QA's SQL showed them for the child and null for the root.

## Edge Cases

- **Empty state: pass.** No parents of the needed type gives explicit copy; a headless org gives explicit copy on `[id]`. No General Assembly exists in the dev database, so a synod's parent list shows the "create one first" line — a known day-one state.
- **Failure microcopy: pass, with one note.** Fetch failure degrades to a usable form with human copy; `invalid_parent` is enumeration-safe and says what each council can receive; `relationship_mismatch` ("choose the parent again and the relationship is set for you") tells the operator what to do and is reachable only by a hand-built POST; thrown errors map to "We couldn't create that organization right now — try again in a moment." The one rough edge: a stale `invalid_parent` after a parent is deleted describes polity rules rather than "that organization is no longer available — reload". Low value; only platform admins create organizations.
- **Permission gate: pass.** `FEATURES.ADMIN_ORGANIZATIONS` gates `new/page.tsx`, `[id]/page.tsx` and `createOrganizationAction` (after `auth()`, before any parsing). No flag needed: platform-admin-only, no member-visible behaviour, already gated by the existing key.
- **Audit event: pass.** A refusal (including `relationship_mismatch`) returns before `recordAudit`; QA's regression test asserts "no audit event".
- **Mobile (360px): pass.** One cosmetic item: the parent link on `[id]` is a 17px inline text link — fine for an admin read-only page.
- **F124-class pre-hydration pick: acceptable, ruled SHIP WITH NOTES.** *Mechanism:* the type select, parent select and both hidden inputs are pure `useState` outside react-hook-form; a parent picked before hydration is dropped and the org is created at root. *Likelihood:* low (desktop platform-admin page; name and slug typed first; hydration normally well under a second). *Consequence:* silent, not catastrophic — `parent_id` null and no affiliation row, the safe direction for integrity, but unrepairable in the product because there is deliberately no reparent control (Adversarial §7); repair is a direct SQL INSERT. *What detects it:* the operator lands on `[id]` where "no recorded parent council" is visible, but only after the org and its immutable slug exist. *Ruling:* not a blocker, not rework; gate this form's submit on hydration with the shared `useHydrated()` (on `main` since v0.30.0) in the F124 triage pass; do not hand-roll a second gate.
- **Named residual: the minute-reference bound is client-only.** Low severity (needs a platform-admin session; unconstrained `text` column); cheap to close now that `actions.ts` is no longer frozen. Follow-up, not rework.

## Follow-Ups (SHIP WITH NOTES)

1. **F124-class: gate the create form's submit on hydration** with the shared `useHydrated()`; failing-first component test.
2. **Stale comment at `new/actions.ts:131-135`** and the docstring that omits `parentOrganizationId`/`relationshipType`/`minuteReference`. *(Fixed at integration by the orchestrator — see the closing note.)*
3. **Server-side `minuteReference` length bound** (500) in `new/actions.ts`, matching the client and the house convention.
4. **No in-product repair for a mis-created, headless org.** Reparenting stays deliberately unbuilt (a council act; the platform is not a council), but `presby_organize_congregation()`'s future pipeline must also cover "first parent for an existing headless org".

## Red Flags (if NEEDS REWORK)

None.

## DECISION-158 (resulted at the Phase 5 loop-back; Phase 3's "no DECISION-158" predates it)

> **DECISION-158 — The relationship type of an at-creation affiliation is derived from the child's organization type and enforced in `createOrganization()`, not in the form and not in the database trigger; the form and the enforcement share one table, `RELATIONSHIP_BY_CHILD_TYPE` in `src/lib/org-display.ts`.** `presby_assert_council_authority()` (`drizzle/0044`) checks the parent's organization type against the child's type, but nothing in the database ties `relationship_type` to that pair, so a congregation could be recorded `member_synod` or `member_nwc` and corrupt the per-capita "how many congregations" count. QA proved the gap (probes (d)/(d2)): the form's courtesy filter was the only layer, and a scripted POST persisted an off-pair row. The fix is a pre-write check in `createOrganization()` that refuses any `relationshipType` other than the canonical pairing (`congregation → member_congregation`, `new_worshiping_community → member_nwc`, `presbytery → member_presbytery`, `synod → member_synod`), refuses any parent for a `general_assembly` as `invalid_parent`, and returns a new `relationship_mismatch` arm. It runs before any DB write, so every caller (the action, a future import, a script) gets the same boundary. Enforcement lives in the TypeScript layer rather than a widened trigger because the trigger lives in a hand-written migration with a rollout cost and the check must hold for a headless-create path that does not call the trigger. The form imports the same table to derive its hidden field, so the courtesy filter and the boundary cannot drift. The cost: the pairing is not a database invariant — a direct SQL INSERT can still write an off-pair row, which the Two Hierarchies posture accepts for owner-role access; hardening it is a future trigger or CHECK, out of scope. A relationship type is never chosen by an operator.

## Workflow rules

- **Rule 12:** no feedback row (no `Source` block; the originating item was a Phase 6 note on the 2026-09-24 lifecycle pipeline). Nothing to mark `done`.
- **Rule 13:** no what's-new owed — platform-admin tooling on `/admin/organizations`, gated by `ADMIN_ORGANIZATIONS`, no member-visible behaviour. A release-notes entry is still appropriate.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete — all eight Phase 1 gaps addressed or explicitly deferred with a tracked follow-up; the Phase 5 FAIL (off-pair relationship type) was closed by server-side enforcement; four follow-ups (hydration gate on submit, stale comment, server bound on `minuteReference`, headless-org repair scoping); DECISION-158 resulted; no feedback row; no what's-new | SHIP WITH NOTES | 2026-10-05 |

## Release-note summary (plain English)

Platform administrators can now place a new organization under its governing body while creating it. A congregation or new worshiping community goes under a presbytery, a presbytery under a synod, and a synod under the General Assembly. The form offers only the parents that are legal for the type you picked, and it works out the relationship (for example, "member congregation") for you instead of asking. You can add the minute reference that records the affiliation, and leaving the parent as "None" still creates an independent organization such as a presbytery with no synod. The organization's admin page now has a "Council affiliation" section showing its parent, with a link, the relationship, the effective date and whether the entry is minuted. The system also refuses any relationship that doesn't match the organization's type. One known limitation: a parent chosen before the page finishes loading can be silently dropped, and an affiliation can't be added to an existing organization from the product. A follow-up will stop the form submitting until the page is ready.

### Orchestrator note (2026-10-05, closing the pipeline)

SHIP WITH NOTES accepted. Follow-up 2 (the stale comment and docstring in `new/actions.ts`) was fixed at integration inside the feature commit; follow-ups 1, 3 and 4 are `docs/TODO.md` lines. Integrated as **v0.31.0**: feature commit, merge of `origin/main` (v0.30.0 — the hydration-gate tripwire passes, this form is `useState`, not react-hook-form), then the housekeeping commit applying DECISION-158, the `docs/TODO.md` reconciliation (the kickoff's gap line closed), the functionality map's Organizations clause, and `docs/release-notes/v0.31.md`. The pipeline's Neon branch is deleted at cleanup. No findings were numbered (F119/F120 reserved, unused — back in the pool).

---

