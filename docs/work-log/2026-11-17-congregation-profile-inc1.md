# Congregation profile Increment 1 — records — Work Log

> **Slug:** `2026-11-17-congregation-profile-inc1`
> **Surface:** (org) — the presbytery's per-congregation pages (`/o/<presbytery-slug>/admin/oversight/...`), presbytery type only; `/help`
> **Permission(s):** `congregation_oversight.manage` (existing, tier 1) and the new `congregation_oversight.finance` (tier 2, two-factor; in the presbytery founding-administrator bundle, DECISION-345). Never `FEATURES.*`.
> **Flag(s):** none new. Rides the existing global `org_portal.oversight`.
> **Estimated complexity:** large
> **Pipeline mode:** Full (schema change: migration 0089)
> **Release:** 0.61.0 (`package.json` bump and `docs/release-notes/v0.61.md` after Phase 6 SHIP IT, through `/release-notes`)
> **Parent:** `docs/work-log/2026-11-17-congregation-profile.md` (Phases 1 to 3: the analyst's brief and the orchestrator rulings, the architect's R1 to R10 and DECISION-344 to 348, and the one Phase 3 design for both increments). **Do not restate or summarize them here.**
> **Numbers (pre-assigned, Rule 16):** migration 0089; DECISION-344 to 352 (349 to 351 used by Phase 3); F450 to F455 used, F456+ free; dev port 3102 (3103 for the production hydration lane); e2e ids `00000000-0000-4089-8000-` (people), `-9000-` (roles), `-9001-` (organizations); Neon branch `br-spring-bonus-axifozcw` (`pipeline-congregation-profile`); worktree `../presby-profile`, branch `pipeline/congregation-profile`
> **Source:** operator decisions A to G, 2026-11-17 ("take congregation profiles all the way to the end (pushed to production)")

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete (parent) | READY WITH NOTES | 2026-11-17 |
| 2 — Architectural review | architect | Complete (parent; R1–R10) | Approved with suggestions | 2026-11-17 |
| 3 — Technical design | tech-lead | Complete (parent; this log carries the increment slice below); amendment A after QA run 1 | Design complete | 2026-11-18 |
| 4 — Implementation | database-admin (B1), api-developer (B2), ux-developer (B3), full-stack-developer (B4) | Complete (B1 to B4; next Phase 5, qa) | — | 2026-11-18 |
| 5 — Verification | qa | Complete (run 1) | FAIL | 2026-11-18 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 and Phase 2

See the parent log. Recorded there verbatim; not copied.

# Phase 3 — Technical Design (tech-lead): the Increment 1 slice

The design is in the parent's Phase 3. Sections an implementer of this increment reads: "Design rulings" (T1 to T12), "Permissions & Flags", "Feasibility check", "Data Model", "Import contract", "Module and file plan", "API Contract", "Component / Page Plan", "Implementation Order — Increment 1", "Deploy checklist", "Copy" C1 to C13, "Test plan", "Carry-forward", "Edge Cases & Risks".

**Scope.** Migration 0089 (all six tables, the permission, the founding-administrator bundle change and its backfill); `src/lib/oversight/` (`contract`, `validate`, `copy`, `derive`, `store`, `reads`); `gateOversightPage`; the reworked list and record pages; profile, assessment (moved route), buildings, appraisals, insurance and loans; the `congregation-records` help page and four help edits; the founding-administrator walk. **No photo UI and no reports.**

## Batches

| Batch | Implementer | Work | Exit gate |
|---|---|---|---|
| **B1** | database-admin | `drizzle/0089_presby_oversight_records.sql` (sections 0 to 9), `src/lib/db/domain/oversight.ts`, `oversight.schema.test.ts` (D1), `oversight.db.test.ts` (D2), `scripts/oversight/test-rls-89.sql`, the five integration patches and `seed-dev-oversight.sql`, the bundle TypeScript mirror (`founding-administrator.ts`, golden, `founding-administrator.test.ts`, `invitations.db.test.ts`), the pins listed in the Feasibility check, `scripts/oversight/test-0089-migration.sh` (D6). Applied to the pipeline Neon branch. | 0089 applied twice with identical digest; test-rls-89 and the patched test-rls pass as `presby_app`; each mechanism proven failing-first; typecheck |
| **B2** | api-developer | `contract`, `validate`, `copy` (strings from the parent's Copy section only), `derive`, `store`, `reads`; the 14 audit keys; `gateOversightPage`; the six `actions.ts` files and the moved assessment action; the `presbytery.ts` changes (F451, F454); `boundaries.test.ts` (U5), `audit-coverage.test.ts` (U6), `store.db.test.ts` (D3), `reads.db.test.ts` (D4), U1 to U4, U7, U10 | `npm run check` zero; the DB files above; failing-first for the audit-in-transaction rollback and the concurrency cases |
| **B3** | ux-developer | the list, record page, every form page and component, the moved assessment form, the states, the tile description, the `founding-administrator-section.tsx` label, page and form tests (U8, U9); **the help page and the four help edits, written from the screens at 360px**; registry, allowlist and pin (12) | typecheck, build, `check:hydration-gate`, `check:help`, a 360px walk of every page in a real browser, light and dark |
| **B4** | full-stack-developer | `e2e/support/oversight-fixture.ts` (new file only), `oversight-records`, `oversight-finance`, `oversight-founder` and `hydration/oversight-forms` specs, the edits to `presbytery-oversight.spec.ts` and `presbytery-map/map.spec.ts` (the new assessment URL; carrier and expiry fields removed), the `docs/deployment.md` "Pre-deploy runbook: 0089", then run the founding-administrator walk for real | own server on 3102 (`E2E_BASE_URL`); the new and touched specs green; prod hydration lane (3103) green |

Order: B1 merges to the pipeline branch before B2 (B2 imports the Drizzle mirror); B2 before B3; B4 starts when B3's pages exist.

## Gates (every batch)

- `npm run check` (all ten tripwires) reports zero violations; typecheck, lint and build pass; no native browser dialogs; no `console.log` in production paths; audit rows for every write (the in-transaction `insertAuditRow`, proven by D3).
- Every form root is inside `HydrationGate`; every page is walked at 360px in a real browser.
- Tests are written by the implementer; QA runs them and authors none.
- Never `git stash` in a worktree; never `pkill -f next`; every server started sets its own `E2E_BASE_URL` and is stopped by PID.
- Shared files (`domain/index.ts`, `drizzle/meta/_journal.json`, `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `src/lib/dev-docs.ts`, `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, existing `e2e/support/*`) are **not edited mid-pipeline**: write `scripts/oversight/*.integration.patch` files instead (the `scripts/worship/` precedent).

## Increment-specific notes

**Handoff.** Next agent: **database-admin** (B1). Read the parent's Phase 3 first.

- **Deploy order:** apply 0089 to an environment before the code that reads it (parent "Deploy checklist"). Record the apply-time notice count (founding-administrator roles topped up) and the deploy-day counts here: legacy carrier/expiry rows (R8) and "newly required, not enrolled" (R2).
- **Operator actions:** switch `org_portal.oversight` on in production; confirm `org_portal.reports` and `org_portal.insights`.
- **Phase 6 walks:** the founding-administrator path (R2) and every page at 360px as the people each path creates; the five help pages read as their reader.
- **Release notes:** the C13 lines, through the `/release-notes` skill after SHIP IT, with the deploy-day count deciding the "nothing had been entered" sentence. Also the functionality-map line (Rule 14) and TODO reconciliation (Rule 10).

## Phase 3 amendment A (after QA run 1)

**Date:** 2026-11-18. **Author:** tech-lead. **Trigger:** QA run 1 FAIL (Phase 5 below). Items 2 to 4 trace to this design's Copy section (C12, C10, C1); items 1 and 5 are harness defects that need no design ruling. The parent's Copy section is not rewritten: this amendment supersedes the named strings, and the implementer applies it as written. Per the Phase 3 rule, every string below carries the four copy checks, and each fix names an exact-text test that fails on the old text.

**Implementer: full-stack-developer for all five items** (one small change set that spans a migration line, a server reader, a client label, a help page and two test files; splitting it across database-admin and ux-developer, as QA suggested, would add hand-offs for under 40 changed lines).

### Rulings

| # | Item | Ruling |
|---|---|---|
| A1 | C12 navigation step (QA 2) | **Corrected.** The tile is `category: "operate"`, `domain: "governance"`, so it sits on the presbytery's portal home page under the `<h2>` "Governance & Courts" (`DOMAIN_LABELS.governance`, rendered by `domain-tile-sections.tsx:74`). It is not on the Administration hub. "Administration" leaves the page and its `labels`; "Governance & Courts" joins `labels`. (C11's line "shown on the Administration hub" was the same design error; the tile string itself is unchanged and true. No code reads that line.) |
| A2 | C10 manage-key description (QA 3) | **Replaced** by an `UPDATE` inside 0089 (0089 is unreleased; 0038 has shipped and is not edited). |
| A3 | C1 "Buildings in use" (QA 4) | **Three states, three strings.** The list reads both counts, and a congregation whose recorded buildings are all retired says "None in use". |
| A4 | Off-table strings | **All six ratified** (table below). One accessibility follow-up is filed as a TODO line for the orchestrator. |
| A5 | Help audit sentence vs F455 | **Reworded** so it neither says "every" nor denies the assessment residual. |
| A6 | Assessment back link, 20px at 360px | **Fix now (polish).** It is a one-component swap to the shared `BackLink` (`min-h-11`), no new string, and the 44px control rule is a stated gate for every oversight page; deferring leaves a known gate failure in a page we ship. |

### A1. C12: the help page's first navigation sentence and its labels

Final text, replacing `src/content/help/congregation-records.md:3`'s second sentence. The first paragraph of the page is unchanged. Line 3 becomes:

> Open your presbytery's page, choose "Congregation Oversight" under "Governance & Courts", then choose "Open" beside a congregation. The page has five sections: "Profile", "Assessment", "Buildings", "Insurance" and "Loans".

`labels` for the `congregation-records` entry (`src/lib/help/registry.ts`, about line 1008): **remove** `"Administration"`; **add** `"Governance & Courts"` directly after `"Congregation Oversight"`. Every other label is unchanged. `check:help` H10 passes only if the label is in a non-test `src/` file (it is: `tiles.ts:127`) and the page says it.

1. *Residuals:* none denied. 2. *Source of truth:* the section heading is `DOMAIN_LABELS[tile.domain]` and the tile name is `tile.label`, both from `PORTAL_TILES` (key `oversight`), which is what the portal home renders; "Open" is the list row's link text (`oversight-list.tsx:99`). QA's own 360px and 1280px walk found the tile only on the home page. 3. *Audience:* the page's reader is presbytery staff holding either key; the tile is gated by the flag and the organization type (`tiles.ts:566-570`), not by a permission, so a person without either key may see the tile and is answered by `OversightForbidden`, which the page's "Who can see what" section already explains; the instruction (open a page, choose a tile, choose "Open") needs no permission beyond the keys already named under "Who can see what". 4. *Neighbours (grepped `src/content/help`, `src/lib`, `src/app`):* `presbytery-reports.md:76` ("Open "Congregation Oversight", then choose "Open"…") names no section and stays true; `first-day-as-administrator.md:7` already names "Governance & Courts" as a home-page heading; `registry.ts:1149` (`presbytery-tools`) names no navigation. Nothing else says the tile is under Administration.

**Help impact:** `congregation-records` (the sentence and `labels`); `verifiedIn` is left as the implementer set it and Phase 6 re-reads the page. The implementer re-walks the sentence on the portal home at 360px (the tile is in the "Governance & Courts" section, and the phone menu is the other way to it) and does not move `verifiedIn`.

### A2. C10: the `congregation_oversight.manage` description

Final string (parallel in form to the finance description beside it on Create role and Edit role):

> See and record a member congregation's viability assessment, profile and buildings (the presbytery's own record)

Where it ships: a new statement in `drizzle/0089_presby_oversight_records.sql` section 1, directly after the finance `insert ... on conflict`, so the section stays the one place permission rows change:

```sql
update permissions
   set description = 'See and record a member congregation''s viability assessment, profile and buildings (the presbytery''s own record)'
 where key = 'congregation_oversight.manage'
   and description is distinct from 'See and record a member congregation''s viability assessment, profile and buildings (the presbytery''s own record)';
```

It replays (the second apply matches nothing, so the D6 identical-digest check holds) and writes nothing in an environment where the row was already corrected. Update the section's header comment to say it also corrects the manage description (0038 shipped; DECISION-298 is not needed because 0089 is unreleased and this is an in-place edit of 0089, not of 0038). `drizzle/0038_presby_presbytery_program.sql:707` is not edited.

1. *Residuals:* none denied. "See and record" is true of every key holder (the list and the record page read under it; the forms write under it), and the string does not say appraisals, insurance or loans, which are the finance key's. It also does not name photos (Increment 2). 2. *Source of truth:* the sections gated by `congregation_oversight.manage` in `readOversightAccess` and the actions: Profile, Assessment (which includes the redevelopment and property notes and the map location) and Buildings. 3. *Audience:* presbytery administrators building a role on Create role and Edit role; they hold `roles.manage` and can tick the key only if they hold it, as C10 recorded; nothing in the string is an instruction. 4. *Neighbours (grepped the live tree for "buildings/insurance", "insurance notes", "viability assessments"):* only `0038...sql:707`, now overridden by the update; `scripts/oversight/test-rls-89.sql:353-354` pins the finance description and is the place to pin this one. The `PERMISSION_LABELS` sentence (C10, second row) is the finance key's and is unchanged.

### A3. C1: "Buildings in use"

**The three states and the final strings** (cell under the unchanged column header "Buildings in use"; viewer: holders of `congregation_oversight.manage`):

| State of this congregation's buildings (removed ones are as if never recorded) | Cell |
|---|---|
| At least one in use | "1 building" / "{n} buildings" (the in-use count) |
| None in use, at least one retired | "None in use" |
| None recorded at all | "Not recorded" |

Why not a count of retired: the header says "in use", so the cell answers that question only; "None in use" is true, short at 360px, and the record page (which lists each retired building with its "Retired" badge) is one tap away. A combined "2 in use, 1 retired" is not adopted because it is a new string family and the list is a scan view.

Shape change (`src/lib/oversight/reads.ts`):

- `OversightListRow.manage` gains `buildingsRetired: number` (live, retired; the existing `buildingsInUse` stays "live, not retired").
- The one buildings query (`reads.ts` about lines 279-286) becomes a single grouped query selecting two counts, `count(*) filter (where retired_on is null)::int` and `count(*) filter (where retired_on is not null)::int`, with the existing `removed_at is null` condition. Keep the `sql<number>` annotation style the file already uses.
- `buildingsInUseLabel(inUse: number, retired: number)` in `src/lib/oversight/derive.ts`: `inUse > 0` gives the count wording; else `retired > 0` gives `STATE.noneInUse`; else `STATE.notRecorded`. `src/lib/oversight/copy.ts` `STATE` (about line 142) gains `noneInUse: "None in use"`.
- `oversight-list.tsx:81` passes both counts.

1. *Residuals:* none denied; a removed building is not counted in either figure, which matches the record page (it lists live buildings only). 2. *Source of truth:* both figures come from `oversight_buildings` with `removed_at is null`, split on `retired_on`; "None in use" is only reachable when at least one live retired row exists, so the claim is read, not inferred; "Not recorded" is reached only when no live row exists. 3. *Audience:* manage holders, who also see the record page's retired buildings. 4. *Neighbours:* `derive.test.ts:137-139`, `page.test.tsx:294, 301, 345` (fixtures gain `buildingsRetired`), `reads.db.test.ts:283` (the exact key list) and `:323, :328`, `reads.ts:225` (the type and its comment), `e2e/oversight-records.spec.ts:251` (a comment states "the list counts only the live, unretired ones"; it asserts nothing today). The help page names no list cell. C1's first table row in the parent is superseded by the table above.

### A4. Off-table strings: ratified

Each passes the four checks (no residual denied; no claim about a person or date beyond the row it labels; each is read by the person who can act; no older string says otherwise, grepped under `src/lib/oversight` and `src/components/oversight`).

| String | Where | Ruling and reason |
|---|---|---|
| "Choose a type" | the building-type select's empty option (`building-form.tsx:118`) | **Ratified.** The field is required and the refusal message is "Choose a type." (C9); the option is the same instruction before submit. Other selects say "Not recorded" because they are optional; this one must not. |
| "Choose the kind of loan" | the loan-kind select's empty option (`loan-form.tsx:96`) | **Ratified.** Matches C9's "Choose the kind of loan." |
| "Choose why" | the retire dialog's empty option (`retire-dialog.tsx:100`) | **Ratified.** Matches the label "Why is it retired?" and the refusal "Choose why this building is retired." |
| " insurance for {year}" (screen-reader suffix after "Remove") | `insurance-card.tsx:53` | **Ratified.** Reads "Remove insurance for 2024"; the year is the row's own `policy_year`. |
| " appraisal for {year}" (suffix after "Remove") | `appraisals-block.tsx:63` | **Ratified.** Reads "Remove appraisal for 2024"; the year is the row's `assessed_year`. |
| " loan" (suffix after "Remove" and after "Edit") | `loan-actions.tsx:56` and `:46` | **Ratified as true, with a follow-up.** It is true but does not tell two loans apart. Not a truthfulness defect and not in the QA FAIL set; filed for the orchestrator to add to `docs/TODO.md` at integration (a shared file, Rule 16): "oversight loans: the screen-reader suffix for Edit and Remove says only 'loan'; name the kind (and lender when recorded) so two loans on one congregation are told apart." Owner: tech-lead (design a string, then ux-developer). |

### A5. The help's audit sentence

Replaces the paragraph at `src/content/help/congregation-records.md` that begins "Every change is recorded in the audit trail" (the paragraph after the "Appraisals, insurance and loans" section). Final text:

> Changes are recorded in the audit trail with who made them, and the notes and amounts are not copied into it. A change to the "Assessment" is recorded just after it is saved, so in rare cases a saved assessment can be missing from the trail. Looking at a record is not recorded.

1. *Residuals:* this states the F455 residual (the assessment write audits after commit and `recordAudit` swallows its own failure) and the standing residual that reads are not audited; it no longer says "every". 2. *Source of truth:* the profile, building, appraisal, insurance and loan writes call `insertAuditRow` inside the same transaction as the row (store.ts; proven by D3), so for those a change and its entry stand or fall together, and "Changes are recorded" is true of them; the assessment write is `actions.ts` `recordAudit` after commit (F455); the audit metadata carries ids and the viability rating, not notes or amounts, which is what "the notes and amounts are not copied into it" says (the rating is not a note or an amount). 3. *Audience:* presbytery staff reading help; it asks nothing of them. 4. *Neighbours:* grepped the help tree for "audit trail" in the oversight context: `presbytery-reports.md`, `roles-who-can-do-what.md` and `why-cant-i-see-this.md` make no claim about the record's audit. No other string changes.

### A6. The assessment back link

Fix now. `src/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/assessment/edit/page.tsx:72-78` replaces its inline `<Link className="inline-flex items-center …"><ArrowLeft/>Back to {name}</Link>` with `<BackLink href={`/o/${slug}/admin/oversight/${aboutOrgId}`}>Back to {result.data.name}</BackLink>` from `@/components/oversight/back-link`. The visible words ("Back to {name}") are unchanged, so no copy check is needed; remove the now-unused `Link` and `ArrowLeft` imports (lint runs with `--max-warnings=0`).

### Implementation list (full-stack-developer)

Every row is written test-first: run the named test against the old code and see it red, then fix.

| # | Fix | Files | Exact-text test that fails on the old text |
|---|---|---|---|
| 1 | QA 1: add the two photo FKs to the `blob_assets` FK name pin (the `person_photos_image_fk` precedent, commit `11456fd7`) | `src/lib/storage/blob-audience.db.test.ts` (both name lists near `:399` and `:408`: add `oversight_building_photos_image_fk` and `oversight_building_photos_thumb_fk`) | The test "holds for every FK in the catalog" at `:404` is the pin; it is red on the current tree and green after. No new test. |
| 2 | QA 2 / A1: the help sentence and `labels` | `src/content/help/congregation-records.md` (line 3), `src/lib/help/registry.ts` (`labels`: drop "Administration", add "Governance & Courts") | New `src/lib/help/congregation-records-nav.test.ts`: read the tile `oversight` from `PORTAL_TILES`; assert `tile.category === "operate"`, that the help body contains the exact string `choose "${tile.label}" under "${DOMAIN_LABELS[tile.domain]}"` and does **not** contain `Open "Administration"`, and that the entry's `labels` contain `DOMAIN_LABELS[tile.domain]` and not `"Administration"`. Fails on the old line; also fails later if the tile moves. `npm run check:help` stays green. |
| 3 | QA 3 / A2: the manage description | `drizzle/0089_presby_oversight_records.sql` (the section-1 `update`, header comment); `scripts/oversight/test-rls-89.sql` section (b) (a new `assert_eq` for `congregation_oversight.manage` with the exact description, tier 1, no 2FA: extend the existing 89b manage assertion at `:355-358`). | The extended 89b assertion: with the `update` removed the description is the 0038 text and the count is 0. Apply 0089 twice and confirm the same digest (D6 runs this). Not an edit to 0038. |
| 4 | QA 4 / A3: the list label | `src/lib/oversight/reads.ts`, `derive.ts`, `copy.ts`, `oversight-list.tsx` | `derive.test.ts:137-139` rewritten: `(0, 0)` "Not recorded", `(0, 2)` "None in use", `(1, 0)` "1 building", `(2, 3)` "2 buildings"; `page.test.tsx` renders a row with `buildingsInUse: 0, buildingsRetired: 2` and expects "None in use" (old code renders "Not recorded"); `reads.db.test.ts` seeds a congregation whose only building is retired and expects `{ buildingsInUse: 0, buildingsRetired: 1 }`, and the `:283` key list gains `buildingsRetired`. If `seedBuilding` in `e2e/support/oversight-fixture.ts` already supports `retiredOn`, add one assertion to `e2e/oversight-records.spec.ts` that the list shows "None in use" for such a congregation (the comment at `:251` becomes true); otherwise the unit and DB tests are the pin. |
| 5 | QA 5: the D6 harness ordering | `scripts/oversight/test-0089-migration.sh` (step 3, `:196-199`) | `seed-dev.sql` now `\ir`s `seed-dev-oversight.sql`, which needs 0089's permission row. Apply `seed-dev.sql` to the pre-0089 state with the `\ir oversight/seed-dev-oversight.sql` line filtered out (a temp copy in `scripts/`, so any other `\ir` resolves), keep the pre-0089 fixtures that the backfill count depends on, apply 0089, then apply `seed-dev-oversight.sql`. The harness itself is the test: it must exit 0 on the integrated tree (it exits 1 at step 3 today). |
| 6 | A6: the assessment back link | `.../assessment/edit/page.tsx` | In `.../assessment/edit/page.test.tsx` assert the "Back to {name}" link carries the `min-h-11` class (red on the old string, which has none); in `e2e/oversight-records.spec.ts:352` add `["the assessment form", `${record()}/assessment/edit`]` to the `pages` list so the 44px and no-sideways-scroll checks cover it (red today at 20px). |
| 7 | A5: the audit sentence | `src/content/help/congregation-records.md` | Extend the new `congregation-records-nav.test.ts` (or `src/lib/help/content.test.ts`'s style): assert the body contains "A change to the \"Assessment\" is recorded just after it is saved" and does not contain "Every change is recorded". Red on the old text. |

Order: items 1 to 7 are independent; commit them as `fix:` commits per class (one prefix per commit): the test-only pin and the D6 harness as `test:`, the migration, reader and label as one `fix:` (`Caught-By: agent-review`, `Discovered-In: Phase-5`, `Work-Log: 2026-11-17-congregation-profile-inc1`), the help and back link as one `fix:`.

**Gates for the implementer:** `npm run check` zero, typecheck, lint, the files above including the DB-backed `reads.db.test.ts` and `blob-audience.db.test.ts` and the 0089 test-rls and D6, the help walk of the changed sentence at 360px, then hand to QA for run 2 (re-run `blob-audience.db.test.ts`, D6, `npm run check`, the help walk and the specs that touch the changed strings: `oversight-records`, `hydration/oversight-forms`).

### Carry-forward (amendment A)

| Requirement | Where addressed |
|---|---|
| QA 1 (`blob-audience.db.test.ts:404`) | Item 1 |
| QA 2 / C12 navigation | A1, item 2 |
| QA 3 / C10 description | A2, item 3 |
| QA 4 / C1 "Not recorded" | A3, item 4 |
| QA 5 (D6 ordering) | Item 5 |
| Off-table strings | A4: ratified; loan screen-reader follow-up **deferred**, by tech-lead (this ruling), to a TODO line the orchestrator adds |
| F455 help sentence | A5, item 7 (F455 itself stays deferred to the monthly security review, as the parent recorded) |
| 20px assessment back link | A6, item 6: fixed now |
| Copy checks (residuals, source, audience, neighbours) | stated for A1, A2, A3 and A5; A4 and A6 as above |
| Edge-case claims | "None in use" only when a live retired row exists: pinned by `reads.db.test.ts` and `page.test.tsx` (item 4); "a removed building counts in neither figure": unverified until the implementer adds one `reads.db.test.ts` case (a removed building beside a retired one) as part of item 4, which this amendment requires |
| e2e blast radius | `oversight-records.spec.ts` (list rows, 360px loop: only the added page), `presbytery-oversight.spec.ts` and the map spec (no string they assert changes); no flag added; flags unchanged |


---

# Phase 4 — Implementation

## B1 — Schema (database-admin, 2026-11-18)

### Files Created

- `drizzle/0089_presby_oversight_records.sql` — sections 0 to 9: guard (0072), the `congregation_oversight.finance` permission, the bundle re-created from the live 0085 body plus the finance key, the backfill (notice), the six tables, the eight indexes, the two guard functions and 12 triggers, RLS + grants, comments, and the closing assertions.
- `src/lib/db/domain/oversight.ts` — the Drizzle mirror of all six tables; the closed vocabularies, `OVERSIGHT_MONEY_MAX_CENTS` and `OVERSIGHT_GUARD_CODES` (the CONSTRAINT names the guards raise) for B2.
- `src/lib/db/domain/oversight.schema.test.ts` — D1: names parsed from 0089 against `getTableConfig` (both directions), FK shapes, vocabularies against the CHECK text, drop-then-add CHECKs, the bundle body, no DELETE/`presby_platform` grant; and, Postgres-backed, columns + nullability and constraint/index names against the live catalog.
- `src/lib/db/domain/oversight.db.test.ts` — D2 (24 tests): CHECK boundaries, partial uniques, the three-column FK, removal one-way, the building-live guard and the about-org trigger on BOTH connections; owner-only immutables and import allowances; R9 departure; the FOR SHARE race under two connections; the door with a live site; grants; teardown order; 'imported' refused on the tenant path on all five provenance tables and kept through a tenant edit; bundle = `foundingAdministratorPlan()`; the backfill re-run from the migration text.
- `scripts/oversight/test-rls-89.sql` — sections (a) to (i), standalone as `presby_app`, own world, every block rolled back, tolerates the oversight seed.
- `scripts/oversight/test-0089-migration.sh` — D6 (steps 1 to 7 in its header).
- `scripts/oversight/seed-dev-oversight.sql` — the fixture (below).
- `scripts/oversight/{domain-index.ts,_journal.json,test-rls.sql,seed-dev.sql,dev-docs.ts}.integration.patch` — the five Rule 16 patches; each passes `git apply --check` on this branch.

### Files Modified

- `src/lib/onboarding/founding-administrator.ts` — presbytery arm `[manage, finance]` (U11).
- `src/lib/onboarding/designation-parity.golden.json` — both presbytery blocks gain the finance key.
- `src/lib/onboarding/founding-administrator.test.ts` — 13 keys, order pin, and a new case: no other type carries the finance key.
- `src/lib/db/domain/invitations.db.test.ts` — presbytery designation carries the finance key; synod does not.
- `src/lib/db/domain/two-factor-default.db.test.ts` — nine flagged keys become ten.
- `src/lib/db/domain/worship.db.test.ts` — its presbytery-bundle pin now reads the last two keys (not in the Feasibility list; it pinned `.at(-1)`).
- `scripts/giving/test-rls-46.sql` — 46j nine becomes ten, plus a tier-2 line for the finance key.
- `scripts/assets/test-rls-72.sql` — 72b's FK count into `blob_assets` moves from eight to ten (the two photo FKs). Not in the Feasibility list; found by the from-empty run.
- `scripts/check-schema-parity.ts` — two `architectural` allowlist rows for the DDL-only photo blob FKs (the person-photos precedent). Not a Rule 16 file.

### Schema Changes

- New tables (all `organization_id` = the presbytery, `about_org_id` = the congregation, FORCE RLS, `tenant_isolation`, `unique (id, organization_id)`): `oversight_profiles`, `oversight_buildings` (+ `unique (id, organization_id, about_org_id)`), `oversight_building_photos`, `oversight_building_appraisals`, `oversight_insurance_years`, `oversight_loans`. Children reference buildings by the three-column key.
- New permission `congregation_oversight.finance` (module `presbytery`, tier 2, `requires_two_factor`); presbytery founding bundle carries it; backfill of existing presbytery founding roles.
- Comment-only: `congregation_oversight.insurance_carrier`/`insurance_expires_on` (superseded), `.buildings_notes`, `permissions.requires_two_factor`, `presby_two_factor_required` (restated from the live text).
- Applied via: **hand-written migration**, `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0089_presby_oversight_records.sql` on `br-spring-bonus-axifozcw` (pipeline-congregation-profile). Applied twice there, both exit 0 (apply-time notice: 0 roles topped up, this branch has no presbytery founding role). `_journal.json` entry `{ idx: 89, tag: "0089_presby_oversight_records", when: 1793825100000 }` is in the integration patch (the orchestrator's ordering against 0088). `scripts/oversight/seed-dev-oversight.sql` applied twice to the branch, exit 0, row counts unchanged.

### Audit Events

- None in B1 (a migration is provisioning; B2's `store.ts` writes the 14 keys).

### Gate evidence

- **Idempotence (D6, `scripts/oversight/test-0089-migration.sh`, from empty, a `scratch_0089` database on the pipeline branch's compute, dropped after): `D6 PASS`.** 0089 without 0072 refused by its first statement, nothing left behind; apply 1 exit 0, backfill notice **1** (a synthetic pre-0089 presbytery founding role); whole-file apply 2 exit 0, notice **0**, catalog fingerprint identical (`32275e763a83209614f762a890b75f9a`, re-run after the provenance guard below; it was `6f9f19d4...` before), seeded rows byte-identical, row counts unchanged (1/2/1/1/1/96/42); test-rls-89 171 passes; the integrated `test-rls.sql` exit 0; `drizzle-kit migrate` with the patch's idx-89 journal entry: ledger complete (79 entries), fingerprint still the same. The fingerprint names objects rather than OIDs, so it is portable: the pipeline branch, after every failing-first cycle and re-apply, reads the same `32275e76...`.
- **test-rls-89 as `presby_app`** on the pipeline branch, with and without the oversight seed: exit 0, 171 assertions (161 before the provenance guard).
- **The integrated `test-rls.sql` as `presby_app`, from empty** (migrations, `seed.ts`, `seed-dev.sql` + the oversight seed, helpers, both patches applied): exit 0, section 89 complete. Two pins moved to get there, both mechanical: the presbytery member count 2 to 3 (in the test-rls patch, the new finance holder) and 72b's FK count 8 to 10 (direct edit). The pipeline branch's own copy of the full suite fails at line 219 on a pre-existing operator membership at the Northern Reach (the live-drift case that line's comment already describes); the from-empty run is the gate.
- **Vitest (pipeline branch, serial), after the provenance guard:** D1 + D2 57/57 (D1 33, D2 24); `invitations` + `worship` + `designation-parity` + `designation-parity-in-place` + `two-factor-default` + `founding-administrator.test.ts` 173/173.
- **Failing-first** (sabotage on the pipeline branch as owner, the named test red, re-apply 0089, green; harness in the session scratchpad):

  | Mechanism | Sabotage | Red (first failure) |
  |---|---|---|
  | FORCE RLS | `no force` on loans | 89a "all six ... ENABLED and FORCED", expected 6 got 5 |
  | policy USING | `using (true)` on buildings | 89d (alone) "from the Western Basin, no oversight row ... is visible" |
  | policy WITH CHECK | `with check (true)` on buildings | 89d (alone) "an insert stamped with the Northern Reach's id is refused by RLS WITH CHECK" |
  | no DELETE | `grant delete` on loans | 89c "neither presby_app nor presby_platform holds DELETE", got 1; and 0089 section 9 alone raises "presby_app holds DELETE or TRUNCATE" |
  | column grants | `grant update (provenance)` on profiles | 89c (alone) "UPDATE lists are exactly the design's six", got 5 |
  | about-org trigger | dropped on profiles | 89a trigger count 12 to 11; 89f (alone) "the Western Basin cannot record a profile about Alder Creek" |
  | removal guard | dropped on buildings | D2 "removal is one-way" (both connections): expected 23514 `oversight_guard_removal_final`, statement succeeded |
  | immutable columns | guard's column loop emptied | D2 "every immutable column is refused": expected `oversight_guard_immutable` |
  | building-live guard | dropped on appraisals | D2 "removal is one-way" (both): expected `oversight_guard_building_removed` |
  | FOR SHARE | `for share` removed | D2 race: "the appraisal insert waited on the removal's row lock", expected false got true |
  | three-column FK | appraisal FK narrowed to two columns | D2 three-column FK (both connections) and 89e (alone) |
  | partial unique | live-name index dropped | D2 "partial uniques" (both): expected 23505 `oversight_buildings_live_name_idx` |
  | bundle | reverted to the 0085 body | D2 bundle = plan ("presbytery: expected 11 ... to equal 12") and 89b (alone) |
  | provenance guard (trigger) | dropped on loans | 89g (alone) "...nor an imported loan", statement succeeded; 89a trigger count 17 to 16; D2 "'imported' is the owner-run import's alone", expected `oversight_guard_provenance` |
  | provenance guard (body) | owner test replaced by `if true` (every caller treated as owner) | D2 same test, expected `oversight_guard_provenance`, statement succeeded |

- **CHECK and trigger logic restated (self-verification):** a building is never both primary and retired; retired date and reason come together; removal time and remover come together; a loan balance is always dated and a date always has a balance; a loan is paid off exactly when it has a paid-off date; an addition is never before what it extends (first after built, second after first and after built, each only when both are recorded); money is 0 to $1,000,000,000 inclusive. The write guard: a tenant cannot insert a removed row and its created_at is the server clock; a removed row never changes again; the listed identity columns never change, on every connection. The building-live guard: no new photo or appraisal, and no new loan link, on a removed building, serialized with the removal. The about-org trigger: a new row must be about a congregation affiliated with the presbytery today; an edit that does not move the congregation passes. Each restatement matches the design.
- `npm run typecheck` clean; `npm run check` all ten pass; eslint clean on the changed TypeScript.

### Implementer Notes

Deviations and things the next phases need:

1. **Teardown (ACCEPTED by the orchestrator, 2026-11-18, as the contract for B4).** **B4's `e2e/support/oversight-fixture.ts` tears down in this order, as the owner: delete the rows of `oversight_building_photos`, `oversight_building_appraisals`, `oversight_loans`, `oversight_buildings`, `oversight_insurance_years`, `oversight_profiles` (in that order, every row of the fixture presbyteries, committed rows of other tests included), then the congregations, then the presbyteries.** D2's teardown test pins exactly that order (it caught a leftover committed loan the first time it ran after the provenance tests were added). Background: the presbytery cascade is never reachable while records exist (D2's "teardown cascade" claim, and B4).** Every one of the six tables carries `about_org_id` as a NO ACTION FK, and an affiliation's `parent_org_id` blocks the presbytery delete until the congregation is gone, so a congregation with records about it cannot be deleted and the presbytery cannot be deleted before it. The only order that works, pinned in D2: delete the six tables' rows as the owner (children first: photos, appraisals, loans, then buildings, insurance years, profiles), then the congregations, then the presbytery. **B4's `oversight-fixture.ts` should tear down in that order.** The design's fallback (affiliation rows first, then the presbytery, whose `organization_id` cascade would then remove all six tables' rows, then the congregations) needs `presby.affiliation_trigger_active` set in the transaction, because the affiliation guard refuses a bare delete; it is plausible but untested here. Making `about_org_id` `on delete cascade` would allow it, but the design (and `congregation_oversight`) keep it plain; not changed.
2. **`policy_year` is in the insurance guard's immutable list.** The design's table listed only the identity columns for insurance years; the API contract says the year is not editable. On `presby_app` the column grant already refuses it; adding it to the guard makes it hold on the owner path too (an import correction removes and re-records). Strictly stronger; revert by deleting one word if ruled otherwise.
3. **No Western Basin row in the seed.** The Western Basin has no member congregation in `seed-dev.sql`, and adding an organization moves several test-rls invariants (one canonical name row per organization, the backfill completeness counts). Cross-presbytery checks build their own: test-rls-89 uses the Western Basin, the Southern Fields (Quillhaven departed in 1995) and the Synod (a row about the Tidewater) as they are; D2 mints throwaway councils.
4. **Seed fixture ids** (chosen here, not at integration; grepped free): person `c0890000-0000-4000-8000-000000000001` (Linnea Harrowgate), user `e0890000-...-0001` (`finance.fixture@example.invalid`, shared fixture password), role `f0890000-...-0001` ("Oversight Finance", custom, finance key only), rows `b0890000-...-0001` to `-0006`. She is a staff member of the Northern Reach with no roll, so the presbytery member count in test-rls moves 2 to 3 (in the patch). She holds a flagged key, so her first sign-in asks for two-factor enrolment. The clerk role `f...00e` is untouched (manage only).
5. **Guard refusals carry a CONSTRAINT name** (`oversight_guard_insert_removed`, `_removal_final`, `_immutable`, `_building_removed`; SQLSTATE 23514), exported as `OVERSIGHT_GUARD_CODES` for B2's `store.ts` mapping. The about-org refusal is SQLSTATE 42501 with the message "was not affiliated with this council" (0045's deny helper); a column-grant refusal is also 42501 ("permission denied"), and an RLS WITH CHECK refusal too ("row-level security"), so B2 maps by message or, better, never reaches them.
6. **`provenance = 'imported'` reserved for the owner-run import (orchestrator ruling YES, 2026-11-18; separate commit).** New `presby_oversight_guard_provenance()` (0089 section 6d), SECURITY INVOKER, owner test copied from 0078, `BEFORE INSERT OR UPDATE` on the five tables with provenance (`<table>_guard_provenance`): a non-owner connection may insert only `presbytery_entered` and may not update provenance to anything else; an edit that leaves an imported row imported passes. Refusal: 23514, CONSTRAINT `oversight_guard_provenance` (`OVERSIGHT_GUARD_CODES.provenance`). On `presby_app` an UPDATE of provenance is already refused by the column grant (42501), so the UPDATE arm is defence in depth; on the tenant path the guard fires before the provenance CHECK, so an unknown value is now refused by the guard there (the CHECK is proven on the owner path in D2). Closing assertions now expect 17 triggers and three guard functions; D6's fingerprint covers the new function. Re-applied to the pipeline branch twice (exit 0, notice 0); B1 gates re-run (above). B2's store never sets provenance, so nothing changes for it.
7. **Correction in place, one caution:** FKs and unique keys are inline in `create table if not exists`, so a corrected FK or unique would not reach a database that already ran 0089 (CHECKs are drop-then-add and would). The 0078/0085 files share this; only matters if an in-place correction touches a key.
8. The F362 hazard paragraph is in the header; no open branch carries F362 (Phase 3), so 0089 lands first.

Handoff to **api-developer (B2)**: import `@/lib/db/domain/oversight` directly (re-exported from `index.ts` only at integration). Local apply: `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0089_presby_oversight_records.sql`, then `psql "$MIGRATE_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/oversight/seed-dev-oversight.sql`. test-rls sections added: 89 (new file), 44a (one assertion, in the patch), the presbytery member count (in the patch), 46j, 72b. Orchestrator rulings on this report (2026-11-18): (1) teardown order accepted as B4's contract; (2), (3), (4) accepted; (5) provenance reserved, done (note 6); (6) noted.

Strings added or changed: none user-facing (the permission description is the design's verbatim Roles-screen label, `drizzle/0089_presby_oversight_records.sql` section 1).

## B2 — Server (api-developer, 2026-11-18)

### Files Created

- `src/lib/oversight/contract.ts` — pure, no imports: the two key names, the closed lists with their Copy labels, `LIMITS`, `CHANGED_FIELDS`, `OversightViewer`/`OversightCtx`, `Outcome`/`Refusal`/`Written`, `OversightRead`, and the action result types (`ActionData`, `OversightActionResult`).
- `src/lib/oversight/validate.ts` — pure. One `parseX(values, env)` per form (`parseProfile`, `parseBuilding`, `parseRetire`, `parseAppraisal`, `parseInsurance(values, env, "create" | "edit")`, `parseLoan`, `parsePaidOff`) over the form's string values, returning `{ ok: true, value } | { ok: false, errors, field, message }`; the zod schemas for `zodResolver` are thin wrappers over the same parsers (`profileSchema(env)`, `buildingSchema(env)`, `retireSchema(env)`, `appraisalSchema(env)`, `insuranceSchema(env, mode)`, `loanSchema(env)`, `paidOffSchema(env)`). `env = { year, today }` is injected. Helpers: `parseMoneyToCents`, `parseYear`, `parseDate`, `cleanLine`, `cleanText`, `charLength`.
- `src/lib/oversight/copy.ts` — pure: `REFUSAL`, `refusalMessage`, `GATE_COPY`, `VALIDATION`, `TOAST`, `STATE` (Locked, empty, load-error, imported, managed and list notes). C9, the toasts of C3 to C8 and the states of C1/C2 only.
- `src/lib/oversight/derive.ts` — pure: `expiryState`, `insuranceExpiryCell`, `newestInsuranceExpiry` (T8), `buildingsInUseLabel`, `buildingSummary`, `additionsLabel`, `latestAppraisal`, `loanTotals`, `formatMoney`, `formatInteger`, `centsToInputText`, `formatCondition`, `formatTriState`, `formatBuildingType`.
- `src/lib/oversight/store.ts` — the only writer of five tables; 15 write functions (below), each one `withOrgContext` transaction: key (`holdsPermissions`), congregation (`resolveMemberCongregation`), row, version, write, one `insertAuditRow(tx, ...)` in the same transaction.
- `src/lib/oversight/reads.ts` — one reader per section (below); each its own transaction and key check.
- `src/lib/oversight/action-gate.ts` — `resolveOversightActor(slug, ids)` (the one place that runs `assertOrgSession(await auth())` before `resolveOrgContext`, then `isUuid` on every id), `finish()` (store outcome to `OversightActionResult`, plus `revalidatePath`), `invalidResult`, `parseVersion`, `staleResult`, `serverEnv`.
- Actions (all `"use server"`, exporting async functions only): `[aboutOrgId]/profile/edit/actions.ts`, `[aboutOrgId]/buildings/actions.ts`, `[aboutOrgId]/buildings/[buildingId]/appraisals/actions.ts`, `[aboutOrgId]/insurance/actions.ts`, `[aboutOrgId]/loans/actions.ts`, and the moved `[aboutOrgId]/assessment/edit/actions.ts` (all under `src/app/(org)/o/[slug]/admin/oversight/`).
- `oversight/oversight-gate-state.tsx` (the four whole-page answers, sibling of `reports/report-gate-state.tsx`; the design put it in `src/components/oversight/`, B3 may move it) and an interim `[aboutOrgId]/page.tsx` (below).
- Tests: `contract.test.ts` (U4), `validate.test.ts` (U1, 42), `derive.test.ts` (U2), `copy.test.ts` (U3), `boundaries.test.ts` (U5, 28), `audit-coverage.test.ts` (U6, 11), `store.db.test.ts` (D3, 27), `reads.db.test.ts` (D4, 23), `src/lib/presbytery.superseded-fields.test.ts` (U10 source half, 6).

### Files Modified

- `src/lib/audit.ts` + `audit.test.ts` — the 14 keys (below), an APPENDED block.
- `src/lib/presbytery-reports/gate.ts` + `gate.test.ts` — `gateOversightPage` (U7, 8 tests): `PresbyteryPageFlag` grows to `REPORTS | INSIGHTS | OVERSIGHT`; same order, same result type.
- `src/lib/presbytery.ts` — F451 and F454 (below); `resolveMemberCongregation` and `listMemberCongregations` exported.
- Moved with `git mv` (T1): `[aboutOrgId]/{actions.ts, edit-form.tsx, edit-form.test.tsx, oversight-schema.ts, oversight-schema.golden.test.ts, page.tsx, page.test.tsx}` to `[aboutOrgId]/assessment/edit/`. Edits forced by the F451 type change, nothing more: the carrier and expiry fields are gone from the form, schema, golden and tests; "Buildings notes" is now "Property notes" (C4; id unchanged); the page is "Edit assessment" with "Back to {name}" (C4). The page runs `gateOversightPage`, then `isUuid`, then the read; its test has the F452 cases (stale second factor redirects before any read; a non-UUID is a 404).
- `oversight/page.tsx` (the list) now runs `gateOversightPage` and still reads the manage-only legacy list; `oversight-list.tsx` lost the carrier cell; its test gained the second-factor case.
- `presbytery.test.ts` (the legacy-row regression, the renamed message), `presbytery-reports/readers.db.test.ts` (the carrier sentinel is now planted on the legacy row directly, because it can no longer be written through `setCongregationOversight`).

### Audit Events (14, all `tenant.oversight_*`, `resourceId` the row id, written in the mutation's own transaction)

`OVERSIGHT_PROFILE_SET` `{created, changed}` · `OVERSIGHT_BUILDING_CREATED` `{buildingId, primary, previousPrimaryBuildingId}` · `_UPDATED` `{buildingId, changed, previousPrimaryBuildingId}` · `_RETIRED` `{buildingId, reason}` · `_REMOVED` `{buildingId}` · `OVERSIGHT_APPRAISAL_RECORDED` `{buildingId, appraisalId, assessedYear}` · `_REMOVED` `{buildingId, appraisalId}` · `OVERSIGHT_INSURANCE_RECORDED` `{insuranceId, policyYear}` · `_UPDATED` `{insuranceId, policyYear, changed}` · `_REMOVED` `{insuranceId, policyYear}` · `OVERSIGHT_LOAN_RECORDED` `{loanId, kind}` · `_UPDATED` `{loanId, kind, changed}` · `_PAID_OFF` `{loanId, kind}` · `_REMOVED` `{loanId, kind}`. Every row also carries `{organizationId, aboutOrgId}`. Never an amount, a policy number, a carrier, a lender, a caption, a note or an address (`changed` is field NAMES from `CHANGED_FIELDS`).

### API contract as built (for B3)

Every action: `(slug, aboutOrgId, ...)`, returns `OversightActionResult` = `{ ok: true, data?: { id, unchanged?: true, created?: boolean, reopened?: true } } | { ok: false, error, field?, kind? }`. It is a superset of `ActionResult<{ id: string }>`; `error` is always one fixed `copy.ts` string. `field` is set only for `kind: "invalid"` (put the message under that field). `kind` is one of `Refusal | "invalid" | "unauthenticated" | "two_factor_required"`. Gate order in every one: `assertOrgSession` (signed out and stale second factor both get "You must be signed in to do that."), `resolveOrgContext` ("You don't have access to that organization."), `isUuid` on every id ("That record could not be found."), the pure parse (before any transaction), then `store.ts` (key, congregation, row, version, write, audit). `organizationId` is never a parameter. All take **plain objects of strings** (`primary` is the one boolean), the same object `zodResolver` validated; the server re-parses it. `expectedVersion` is the row's `rowVersion` from the reader; a missing or non-integer one is `stale`. Success on an edit that changed nothing is `{ ok: true, data: { id, unchanged: true } }`: show "No changes to save." and write nothing. After a write the action `revalidatePath`s the list and the record page.

| Action (file) | Key | Signature after `(slug, aboutOrgId`, | Notes |
|---|---|---|---|
| `setProfileAction` (`profile/edit`) | manage | `values: ProfileValues, expectedVersion: number \| null)` | `null` = create; an existing profile or a concurrent first save is `stale`; an all-empty create writes nothing (`unchanged`, `id: ""`); `data.created` picks the toast |
| `createBuildingAction` (`buildings`) | manage | `values: BuildingValues)` | `primary` demotes the current primary in the same transaction; `duplicate_name` on a live name (case-insensitive) |
| `updateBuildingAction` | manage | `buildingId, values, expectedVersion: number)` | takes the primary mark from another building if asked; `primary` on a retired building is `save_failed` (the form should disable it) |
| `retireBuildingAction` | manage | `buildingId, values: RetireValues)` | `{ reason, retiredOn }`; clears `is_primary`; `already_retired` |
| `reinstateBuildingAction` | manage | `buildingId)` | `not_retired` |
| `removeBuildingAction` | manage | `buildingId)` | one-way; clears `is_primary` |
| `recordAppraisalAction` (`buildings/[buildingId]/appraisals`) | finance | `buildingId, values: AppraisalValues)` | `duplicate_appraisal_year` names the year the user typed |
| `removeAppraisalAction` | finance | `buildingId, appraisalId)` | |
| `recordInsuranceAction` (`insurance`) | finance | `values: InsuranceValues)` | `duplicate_policy_year` |
| `updateInsuranceAction` | finance | `recordId, values, expectedVersion)` | the policy year is not editable (ignored on edit) |
| `removeInsuranceAction` | finance | `recordId)` | the year can be recorded again |
| `recordLoanAction` (`loans`) | finance | `values: LoanValues)` | always `open` |
| `updateLoanAction` | finance | `loanId, values, expectedVersion)` | a changed balance with the same "as of" date is `invalid` on `balanceAsOf`; `status: "open"` on a paid-off loan is a reopen (`data.reopened`); `status: "paid_off"` on an open loan is `not_paid_off` |
| `markLoanPaidOffAction` | finance | `loanId, values: PaidOffValues)` | `{ paidOffOn }`; balance 0 as of that date; `already_paid_off` |
| `removeLoanAction` | finance | `loanId)` | |
| `setCongregationOversightAction` (`assessment/edit`) | manage | `input: SetOversightInput` | unchanged writer (T12, `recordAudit` after commit, F455); now second-factor recheck first; carrier and expiry gone from the input |

Reads (`@/lib/oversight/reads`, all return `{ kind: "ok", data } | { kind: "forbidden" } | { kind: "not_found" }`; an `OrgAccessError` propagates): `readOversightAccess(viewer, aboutOrgId?)` -> `{ manage, finance, congregation }`; `readOversightList(viewer, now?)` -> `{ manage, finance, today, rows }` where `rows[i].manage` (viabilityScore, assessmentUpdatedAt, city, county, buildingsInUse) exists only for a manage holder and `rows[i].finance` (insuranceExpiresOn, the newest year's) only for a finance holder; `readProfile`, `readBuildings` (`{ buildings, inUse, retired }`, primary first), `readBuilding`, `readAppraisals` (`{ appraisals, latestId }`), `readInsuranceYears(viewer, aboutOrgId, now?)` (`{ years, today }`), `readInsuranceYear`, `readLoans` (open first), `readLoan`, `readTodayInOrg(tx, organizationId, now?)`. `viewer` is `{ personId, organizationId }` (a `ReportIdentity` from the gate fits). Each reader takes `aboutOrgId` and resolves it itself. Row types are exported from `reads.ts` (`ProfileRow`, `BuildingRow`, ...). The gate for pages: `gateOversightPage({ slug, path })` from `@/lib/presbytery-reports/gate`, same `ReportPageGate` result and `runReportRead`-style handling (`OrgAccessError` rethrown).

### Gate evidence

- **`npm run check`: all ten pass** (zero violations), on the working tree and again on the committed tree. `npm run typecheck` clean; `eslint --max-warnings=0` clean on every touched path.
- **`npm run test` (no database): 911 files pass, 1 test fails: `src/lib/dev-docs.test.ts` "sees the same tables in the exports as are declared in the schema files".** Expected and not new: it fails because `domain/index.ts` does not yet re-export `./oversight` (B1's Rule 16 patch, applied at integration). Proven: with `scripts/oversight/domain-index.ts.integration.patch` and `dev-docs.ts.integration.patch` applied it passes (15/15), then reverted.
- **DB suites, serial, on the pipeline branch (`npx dotenv -e .env.local -- vitest run --no-file-parallelism`):** `oversight.schema.test.ts` + `oversight.db.test.ts` (B1's, 57) + `store.db.test.ts` (D3, 27) + `reads.db.test.ts` (D4, 23) + `presbytery.test.ts` (54, with the new legacy-row case) + `presbytery.coordinates.test.ts` + `presbytery-reports/readers.db.test.ts`: 204 tests, all pass (one failure in the first run, my legacy-row test left a row that a later `presbytery.test.ts` case counts; fixed with a `finally` delete). Teardown leaves nothing behind (0 fixture organizations on the branch).
- **Final run, on the committed tree (HEAD `3d4347d1`):** `npm run check` all ten pass; `npm run typecheck` clean; `eslint --max-warnings=0` clean; `npm run build` passes (the first build attempt printed a Next.js security-advisory notice and stopped; the retry built; the worktree's installed Next is 16.4.3, main's package.json was bumped by PR #90, so this is the stale worktree install, not B2 code; the notice's suggested `next upgrade` was not run); unit run of `src/lib/oversight`, `presbytery-reports`, `audit`, the oversight pages: 26 files, 542 passed.
- **Failing-first (sabotage on the pipeline branch, the named test red, restored, harness in the session scratchpad):**

  | Mechanism | Sabotage | Red |
  |---|---|---|
  | audit in the SAME transaction (audit failure) | `audit()` swallows a failed `insertAuditRow` (the `recordAudit` shape) | D3 "an audit insert that FAILS leaves the data unchanged": `setProfile` returned `ok` instead of `save_failed` |
  | audit in the SAME transaction (audit committed apart) | `audit()` writes through the pool, not the transaction | D3 "an audit insert that SUCCEEDED and then has the transaction fail leaves NO audit row": the audit row survived the rollback |
  | `row_version` (stale) | the compare and every `where row_version = ...` removed from the four editable writers | D3 "a stale edit writes nothing": expected `stale`, got `ok`; "two simultaneous edits of one version": `['ok','ok']` for the profile |
  | primary-mark serialization | both `lockPrimary` calls removed | D3 "two simultaneous make primary" (`['ok','refused']` in round 1) and "three simultaneous creates, each primary" |
  | F451/F454 | `presbytery.ts` from `HEAD` | the legacy-row DB test (`insurance_carrier` read back null after the first save) and 4 of 6 source scans |
  | D4 tier gating | `if (finance)` forced true in the list, `readLoans` keyed to the manage key | D4 "tier 2 readers: forbidden" and "a manage-only viewer gets no tier-2 field" |

- **Self-verification (restated):** the store checks, in order, the table's own key then the congregation then the row then the version; a refusal before the write leaves no audit row; an edit with no field difference returns before any UPDATE; the one place two writers can collide on a mark (the primary) is serialized by an advisory lock taken before any row lock, and every other collision is a unique index or a row lock plus the `where row_version` clause. Each matches the design.

### Implementer Notes (deviations and things B3 and B4 need)

1. **Interim record page.** `[aboutOrgId]/page.tsx` is a placeholder B3 replaces: it runs the real front door (`gateOversightPage`, `isUuid`, `readOversightAccess`) and `redirect`s to `assessment/edit`, so the list's link still lands somewhere that works. The list page still reads the manage-only `getCongregationOversightList`, so a finance-only holder sees `OversightForbidden` there until B3 switches it to `readOversightList`.
2. **Actions boundary scan.** U5 said "every `actions.ts` calls `assertOrgSession` before `resolveOrgContext`". With one shared helper that is true in `action-gate.ts`; `boundaries.test.ts` pins that every exported action's first statement is `const gate = await resolveOversightActor(` and that the helper runs `assertOrgSession` before `resolveOrgContext`.
3. **`previousPrimaryBuildingId`** was added to the `BUILDING_CREATED` and `BUILDING_UPDATED` metadata (an id) so a primary move is fully traceable from ONE audit row, keeping "exactly one audit row per action". The design's allowlist did not list it; U6 pins it.
4. **`setProfile` all-empty create** writes nothing (`unchanged: true`, `id: ""`); the design did not say. A profile is cleared by saving empty fields on an existing one.
5. **Tampered Yes/No select** (a value the form never offers) has no Copy string, so the validator returns the generic `save_failed` line "We couldn't save that. Nothing was changed." on that field. Needs a ruling only if the orchestrator wants a dedicated string.
6. **U3's forbidden-phrase list** says no string contains "only"; the design's own phone message ("... x only, up to 40 characters.") does. The test forbids the claim phrases ("everything is recorded", "nothing is kept", "never deleted", "only ... can see/sees") instead, and the phone string is verbatim.
7. **Server-side date backstop uses the server's UTC calendar day and year** (a parse must return before any transaction opens; the organization's zone is a database read). Every organization is behind UTC, so the server can be at most hours lenient at the day boundary; the form's own schema is injected the organization's local date (`readTodayInOrg`) and is the strict check. Stated in `action-gate.ts`.
8. **`readTodayInOrg(tx, organizationId, now?)`** (the design wrote `readTodayInOrg(tx)`; the zone read needs the organization id, and `now` is injectable). **`readOversightList`'s query count** is a FIXED 9 statements for a viewer with both keys, 7 manage-only and 6 finance-only (each counting `withOrgContext`'s own two), not the design's "4 to 6"; D4 pins that 2 and 30 congregations cost the same and that the total is at most 9.
9. **The migration's `row_version` is bumped on the demoted building** when a primary moves (its stale check is protected too). `updateLoan`'s reopen leaves the balance as recorded.
10. **D4 and D3 need the fixture-teardown order B1 recorded** (the six tables, the legacy `congregation_oversight` rows, then the congregations, then the presbyteries); both files do it, and the first D4 run failed teardown on the legacy row until it was added (50 fixture organizations were cleaned from the branch by hand).
11. **Existing e2e specs are stale until B4:** `e2e/presbytery-oversight.spec.ts` case 2 fills the removed carrier and expiry fields at the old URL and cases 6 to 9 use the old URL; `e2e/presbytery-map/map.spec.ts` case 7 likewise. B4 owns them (E2E blast radius).
12. **F451/F454 landed in the same commit as the feature.** The removed fields' consumers are the moved form and the list, so a separate `fix:` commit could not typecheck on its own; the regression tests (`presbytery.test.ts` legacy-row case, `presbytery.superseded-fields.test.ts`) were proven red against `HEAD`'s `presbytery.ts` first. The orchestrator can split it at integration if wanted.
13. **A new `console.error` line exists** in `store.ts` for `save_failed`: `[oversight] save failed (sqlstate <code>)`, the person-photos precedent (SQLSTATE only; D3 pins the exact text). Not a `console.log`.

Strings added or changed in B2: only the design's Copy section (C1 to C9, the toasts, "Edit assessment", "Back to {name}", "Property notes"); the one string choice outside it is note 5.

Handoff to **ux-developer (B3)**: import `@/lib/oversight/{contract,validate,copy,derive}` in client forms (all pure; zod schemas take the injected `{ year, today }`), `@/lib/oversight/reads` in pages, the actions above in forms. Replace `[aboutOrgId]/page.tsx` and the list page; read `readTodayInOrg` for the env a form's schema is given. Then B4.

## B3 — Client: pages, forms, help (ux-developer, 2026-11-18)

### Files Created

- Pages under `src/app/(org)/o/[slug]/admin/oversight/`: the sections page `[aboutOrgId]/page.tsx` (replaces the B2 interim redirect), `profile/edit/`, `buildings/new/`, `buildings/[buildingId]/` (detail) and `/edit/`, `buildings/[buildingId]/appraisals/new/`, `insurance/new/` and `[recordId]/edit/`, `loans/new/` and `[loanId]/edit/`; forms `profile-form.tsx`, `buildings/building-form.tsx`, `appraisals/appraisal-form.tsx`, `insurance/insurance-form.tsx`, `loans/loan-form.tsx` (five new `useForm` roots, each in `HydrationGate`, each with `useUnsavedChangesGuard`); `record-front-door.tsx` (`openRecord`: `isUuid` on every id, then the either-key `readOversightAccess`; `settle`: rethrows `OrgAccessError`, anything else is a section/page load error).
- `src/components/oversight/`: `section-frame`, `locked-section`, `locked-page`, `section-load-error`, `fact-list`, `imported-note`, `back-link`, `form-page-frame`, `section-state`; the five sections (`profile-`, `assessment-`, `buildings-`, `insurance-`, `loans-section`), `appraisals-block`, `building-card`, `insurance-card`, `loan-card`; client: `confirm-remove-dialog` (one AlertDialog for the four removals), `retire-dialog`, `paid-off-dialog`, `building-actions`, `loan-actions`; form parts `form-field`, `text-field`, `money-field`, `year-field`, `select-field`, `select-classes`, `form-result`, `loan-values`.
- Help: `src/content/help/congregation-records.md` (published) and its registry entry; `slug-history.ts` row; one sentence in `docs/product/functionality-map.md` (the check requires it).
- Tests: `oversight/record-pages.test.tsx` (U8, 18), `oversight/oversight-forms.test.tsx` (U9, 17).

### Files Modified

- `oversight/page.tsx` + `oversight-list.tsx`: `readOversightList`; columns by held key, the one note per missing key, "Open", "Expired {date}", "Not recorded" (never a zero); `page.test.tsx` rewritten to the new shape (+2 cases: manage-only, finance-only).
- `src/lib/oversight/reads.ts`: ONE added export, `readFormEnv(viewer)` -> `{ year, today }` in the organization's zone (the forms' zod schemas need the injected env; no key, no record, called only after a keyed reader or the front door has answered).
- `src/lib/org-portal/tiles.ts` (C11), `founding-administrator-section.tsx` (+ test case, C10), `help/registry.ts` (new entry; the `presbytery-tools` sentence; "Edit assessment" in `presbytery-reports` labels; "Locked" in `why-cant-i-see-this` labels), `coverage-allowlist.ts` (`tile:oversight` deleted, 13 to 12), `coverage.test.ts` (pin 12; the "still lists" key list), `presbytery-reports.md` (map steps now go through "Edit assessment"), `roles-who-can-do-what.md` (new subsection), `why-cant-i-see-this.md` (new "Locked" subsection).

### Gate evidence

- `npm run typecheck`, `eslint --max-warnings=0 src e2e`, `npm run build` clean; `npm run check` all ten pass (`check:hydration-gate` and `check:help` included: 34 entries, 30 published); vitest over `src/lib/oversight`, `src/lib/help`, `presbytery-reports`, the oversight pages, `components`, `org-portal`, the admin organizations pages: 2,273 tests, 0 failed.
- Real browser, port 3102 (stopped by PID), Chromium via Playwright, as `presbytery.clerk.fixture` (manage only) and `finance.fixture` (finance only, TOTP enrolled on the pipeline branch): 360px light and dark, 1280px light; document `scrollWidth - clientWidth` was 0 on every page walked. Flows run end to end at 360px: empty building form shows both C9 messages, duplicate name lands under Name, create returns to the record page, Retire dialog (reason error, then "Sold on {date}"), Bring back into use, Remove (AlertDialog) back to the record page; as finance: Mark paid off, Reopen this loan, record an insurance year (expiry in the past shows "Expired"), remove it. Screenshots: `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/2313dcc4-4a86-43c8-9bfc-694f433ec0be/scratchpad/profile-b3/` (`a-` and `b-` 360 light, `d-` 360 dark, `e-` 1280, `c-` dialogs). Branch state touched for the walk: `org_portal.oversight` and `.insights` flags turned on; TOTP enrolled for `e0890000-...-0001`; the seed's Bramblewood loan was paid off, reopened and restored by SQL; two throwaway buildings and one insurance year created and removed (removed rows remain).

### Deviations and things B4 and the orchestrator need

1. **GAP (needs a ruling): a finance-only holder cannot reach appraisals.** Appraisals live on the building's page, and a building is tier 1 (`readBuilding` is manage-keyed), so a viewer with only `congregation_oversight.finance` sees a Locked "Buildings" section and a Locked page at a building URL; `appraisals/new` needs both keys. The help page says so ("a person needs the first permission to open [a building's page] and the second to see its Appraisals"). `oversight-finance.spec.ts` (an "MFA finance holder: appraisal, ...") must use a holder of both keys for the appraisal step. Options if the operator wants finance-only appraisals: a finance-keyed building-name read, or an appraisals section on the record page. Not built.
2. **List stays a table at 360px** (design) rather than cards: hidden columns show from `sm`; a finance-only viewer's Insurance column stays visible at 360px because it is their only data column. Existing e2e case 1 asserts `columnheader` and `cell` roles, which a duplicated card list would have broken.
3. **Empty options of three required selects** are not in the Copy section: Building "Type" `Choose a type`, Loan "Kind of loan" `Choose the kind of loan`, Retire "Why is it retired?" `Choose why` (every optional select reads "Not recorded", per the design). Names for review in the branding pass.
4. **`verifiedIn` is `0.60.1`, not `0.61.0`**: `check:help` H13 refuses a release later than `package.json`. The orchestrator moves it to `0.61.0` with the version bump (the page's labels were walked at 360px on this branch; the Roles-screen permission sentence quoted in two pages comes from migration 0089 and is not on a screen the check scans).
5. **Insurance "Expired"** renders as a destructive `Badge` beside the date (in words, not colour alone) rather than `{date} · Expired`.
6. The record page links "How these records work" to the help page, and the help page says the PresbyPortal team switches Congregation Oversight on (the flag is off in production until the operator flips it, deploy checklist item 4).
7. Edit forms stay on the page, `router.refresh()` and `form.reset(values)` (so the unsaved-changes guard reads clean); creates return to the record page (the profile form returns only when it created the profile). A retired building's "Primary building" box is a disabled, unregistered checkbox (react-hook-form reads a disabled control as undefined).
8. B4 selectors: ids `profile-address|city|county|year-organized|phone`, `building-name|type|primary|year-built|first-addition|second-addition|square-feet|roof|plumbing|hvac|boiler|sprinklers|fire-alarm|security|notes`, `appraisal-year|amount|notes`, `insurance-year|carrier|policy-number|expires|claims|pool|notes`, `loan-kind|lender|original|balance|balance-as-of|grants|guarantee|notes`, dialogs `retire-reason|retire-date`, `paid-off-date`. A manage-only person at `/insurance/new` or `/loans/new` sees a "Locked" page (h1 is the form's title) with no form, not `OversightForbidden`.
9. **Help screenshots: none** (design). Help walked against the screens above; its quoted labels all appear on them.

Strings added outside the Copy section: deviation 3 only.

## B4 — E2E, runbook and the founding-administrator walk (full-stack-developer, 2026-11-18)

### Files Created

- `e2e/support/oversight-fixture.ts` (new file only; no existing `e2e/support` file edited, so no `*.integration.patch` was needed). Ids `00000000-0000-4089-8000-` (people), `-9000-` (roles), `-9001-` (organizations, unique per run). A throwaway presbytery with two member congregations (one managed, one unmanaged), a second presbytery with one congregation, and five people: a manage-only clerk, a finance-only holder (MFA), a both-keys holder (MFA), a founder minted through `presby_apply_founding_administrator` (MFA) and a second person with no role and no enrolment. Teardown is B1's contract (the six tables' rows, then the legacy `congregation_oversight` rows, then the congregations, then the presbyteries; the congregation and presbytery deletes go through `removeOrg`, whose cascade took the affiliation rows with it, so no `presby.affiliation_trigger_active` workaround was needed). Owner-side seeders for a row a spec does not want to type.
- `e2e/oversight-records.spec.ts` (9 cases, manage-only clerk), `e2e/oversight-finance.spec.ts` (8, finance-only holder plus a both-keys holder), `e2e/oversight-founder.spec.ts` (4, the R2 walk), `e2e/hydration/oversight-forms.spec.ts` (2). Each sets the flags it needs through `captureFlags`/`setFlag` and restores them in `afterAll` (the founder spec also sets `org_portal.roles`, which the Roles screens need and a fresh database has off); nothing went into `scripts/ci/e2e-baseline-flags.sql`.

### Files Modified

- `e2e/presbytery-oversight.spec.ts`: cases 2 and 6 to 9 use `/oversight/<id>/assessment/edit`; case 2 no longer fills the removed carrier and expiry fields; case 1's three `getByRole("cell", ...)` lookups gain `exact: true` (deviation 3).
- `e2e/presbytery-map/map.spec.ts`: case 7 uses the assessment URL. Line 477's `waitForURL('**/admin/oversight/${ALPHA.id}')` and line 267's popup `href` are unchanged and pass.
- `src/components/oversight/back-link.tsx`: the one source fix (deviation 2).
- `docs/deployment.md`: "Congregation records (0089)" with "Pre-deploy runbook: 0089, then the code" (before the Membership standing section). The read-only counts (legacy carrier/expiry/property-notes rows; the two-factor "required, but not enrolled" before and after) and every verify query were run against the pipeline branch and return what the text says (permission `2|t`; bundle ends with the two oversight keys, synod carries neither; 0 founding roles missing the key; 6 forced tables; 0 DELETE or TRUNCATE grants).

### What the specs pin

- **Records (manage-only clerk, 360px):** the five sections and the managed note (absent for the unmanaged congregation); the back link is a plain link and no `callbackUrl`/`next` is ever on an oversight URL; profile add (returns to the record), edit (stays), "No changes to save.", a bad year under its field with the typed values kept; building add with both C9 messages, a case-insensitive duplicate name, a primary that moves (exactly one primary afterwards); edit, retire (reason required, then "Sold on"), bring back, remove (an AlertDialog); a removed building, another congregation's building, another presbytery's congregation, a congregation that does not exist, and two non-UUIDs all give the same 404 body; Insurance and Loans are Locked cards and `/insurance/new` and `/loans/new` are a Locked page with no form and nothing written (0 rows); the list's manage columns, no Insurance column, one note; a 120-character name and 300-character notes on six pages at 360px with no sideways scroll and every control at least 44px; a sentinel in every free-text field reaches no audit row.
- **Finance (finance-only, plus both keys where a building is needed):** Profile, Assessment and Buildings Locked, Insurance and Loans open; a building page, the appraisal form and the profile form by URL are a Locked page; insurance (record, a duplicate year, "Expired" in words, the list reads the newest policy year's expiry, a stale edit from a second session writes nothing and keeps the typed values, remove then record the year again); loans (record with $250,000 / $180,000.50 / $15,000 shown, a changed balance needs a new "as of" date, a stale edit, mark paid off to $0, reopen, remove); appraisals (record, a duplicate year names the year, an older year is not "Current", remove); the audit rows (nine action keys present, two distinct actors) carry no carrier, lender, policy number, guarantee or amount; a 360px walk of the finance pages with long text.
- **Founder (the R2 walk):** below.
- **Hydration (dev and production lanes):** every control inside the gate is disabled with the scripts held; after release, non-default picks on the building form (type, primary, four conditions, three Yes/No selects, years, square feet, notes) and the profile form are the persisted row.

### Gate evidence

- **Dev lane, own server on 3102 (`E2E_BASE_URL`, stopped by PID), final combined run:** `oversight-records` 9, `oversight-finance` 8, `oversight-founder` 4, `hydration/oversight-forms` 2, `presbytery-oversight` 9, `presbytery-dashboard` 7 (unchanged by design): **39 passed**. `presbytery-map/map.spec.ts` (its own `PW_MAP=1` project, the config starts its own server on 3102 with the fake tile key): **10 passed**, including case 7 at the new URL.
- **Production hydration lane (`PW_PROD_BUILD=1 PW_PROD_PORT=3103`, `npm run build && next start`, `--project=prod-build`, the whole lane):** **41 passed**, including both `hydration/oversight-forms` cases; the server stopped by the runner (3103 free afterwards).
- `npm run typecheck` clean; `eslint --max-warnings=0 e2e src/components/oversight` clean; `npm run check` all ten pass (with the new files staged-intent, so `check:secrets` scanned them); vitest over `src/components/oversight` and the oversight pages: 88 passed. The fixture left nothing behind (0 `e2e-ovs*` organizations, 0 `e2e-ovs-*` users after the runs; the three flags read `org_portal.oversight` on, `org_portal.insights` on, `org_portal.roles` off, as before).
- **Failing-first for the one bug found:** the 360px case of `oversight-records.spec.ts` failed before the fix with `scrollWidth - innerWidth` = 1202 on the "Edit building" page (the back link "Back to MMMM..." could not wrap), and passes after it. The test name carries "regression for the back link that named it and could not wrap".

### The founding-administrator walk (R2), as run

`oversight-founder.spec.ts`, real definer, real screens, real TOTP code, 360px, light mode. Screenshots in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/2313dcc4-4a86-43c8-9bfc-694f433ec0be/scratchpad/profile-b4/` (re-written on every run; set `OVERSIGHT_SHOTS_DIR` to choose another folder, else they go to the test's output folder):

1. **Founder, no further grant.** `founding_administrator` holds exactly the 13 keys `presby_founding_administrator_permission_keys('presbytery')` returns, in the database, including `congregation_oversight.manage` and `.finance` (a congregation's bundle has no finance key). Her only grants at the presbytery are that role and the presbytery stated-clerk office role. The list shows all five columns and no "need permission" note (`01-founder-list-360.png`); the record page has all five sections open (`02-founder-record-360.png`); `/insurance/new` opens a form, not a Locked page.
2. **Before the grant** the second person gets the byte-for-byte refusal naming the permission, no congregation named, no section drawn (`03-second-before-grant-360.png`). The founder creates the custom role "Finance Reader" with only the finance key (the checklist shows the key under tier 2 with the Roles-screen words "appraisals, insurance and loans"; the subset check passed, `04-founder-create-role-360.png`), then grants it to the second person (`05-founder-grant-360.png`). The database shows one open grant for her: `finance_reader`.
3. **The second person is forced into enrolment.** A fresh sign-in (after the grant) lands on `/account/2fa?callbackUrl=<the record path>` with the "Enroll in two-factor authentication" page (`06-second-forced-enrolment-360.png`); a real code for the shown manual key confirms it ("Two-factor authentication enabled", `07-second-enrolled-360.png`); "Continue" returns to the record with no `/totp` hop. Her record page: Profile, Assessment and Buildings **Locked**, Insurance and Loans open with "Record a year" and "Record a loan" (`08-second-record-360.png`); the list has an Insurance column and no manage columns (`09-second-list-360.png`); `/buildings/new` is a Locked page with no form (`10-second-locked-form-360.png`); the account now has a `user_totp` row.
4. **A manage-only person** sees Profile, Assessment and Buildings open and Insurance and Loans Locked, no Insurance column (`11-clerk-record-360.png`, `12-clerk-list-360.png`).

Every screenshot above was opened and read (no real data: invented names, `.invalid` addresses, a throwaway presbytery).

### Deviations and things the next phases need

1. **Throwaway people instead of the standing `presbytery-clerk`.** The design named the existing fixture clerk for the records spec. Records are permanent (no DELETE, a plain `about_org_id` foreign key), so rows about the standing `e2e-alpha` would have to be cleaned from a shared fixture presbytery on every run and would survive a crashed run. The records spec instead mints its own clerk, a person holding only `congregation_oversight.manage` through a custom role (no tier-2 key, so no second factor), which is the same viewer.
2. **One source fix, in B3's file (`src/components/oversight/back-link.tsx`).** The back link on a form page names the building ("Back to {building}"); with a 120-character unbroken name it did not wrap and the document scrolled 1202px sideways at 360px. Found by the new 360px case; the fix is `max-w-full` on the link and `min-w-0 break-words` on a wrapping `<span>` (the icon gets `shrink-0`). `fix:` trailers apply to its commit. B3's own 360px walk did not use a name that long.
3. **Existing spec case 1 needed an edit the design said it would not.** The design lists `presbytery-oversight.spec.ts` cases 1, 3, 4, 5 as unchanged. Case 1's `getByRole("cell", { name })` lookups are substring matches, and the new "Open <name>" link (sr-only name) sits in its own cell, so each congregation now matched two cells (a strict-mode violation). The three lookups now pass `exact: true`. Nothing else changed in cases 1, 3, 4 and 5.
4. **Appraisals need both keys, as ruled.** `oversight-finance.spec.ts` uses a both-keys holder for the appraisal steps and asserts, for the finance-only holder, that Buildings is Locked and that a building page and `appraisals/new` are a Locked page.
5. **Not tested here, so Phase 6 should know:** a person already signed in when the finance key is granted carries a stale `twoFactorRequired: false` claim until their session is re-derived (`session-check.ts`'s own header says so: the claim refreshes at the next sign-in, and every page re-checks only the claim). The R2 walk therefore signs the second person in after the grant, as a real "next sign-in" does. B4 did not walk the stale-session case and recorded no defect; it is the existing, documented behaviour for every flagged key.
6. **A double submit inside the refresh window reads as a stale refusal.** On an edit form (profile, building, insurance, loan) a second click on Save between the first save's toast and `router.refresh()` finishing sends the old `row_version`, and the second attempt is refused with "This record was changed by someone else...". Nothing is lost or written twice. The specs reload before an intentional second save for that reason. A candidate polish item for the orchestrator (disable Save until the refresh lands), not changed here.
7. **The Roles screens are not 44px at 360px.** While walking step 2 the founder's Roles page shows "Revoke" buttons at 32px, the grant form's selects at 42px and the "Edit" links at 17px. They predate this pipeline and are not oversight's, so the founder spec does not assert them; worth a TODO line if the orchestrator wants it.
8. **Toast text is not proof a save landed.** A success toast from an earlier action can still be on screen when a later one is asserted; the loan edit asserts through the database (`expect.poll` on `row_version`) for that reason.
9. **Not done by B4:** dark mode (B3 walked it), the Phase 6 reads of the help pages, and `docs/TODO.md`, `docs/STATE.md`, release notes and the functionality map (orchestrator / `/release-notes`).

Strings added or changed in B4: none user-facing (the back-link change is layout only).

Handoff to **qa (Phase 5)**: run the four new specs and the two touched ones on your own server (the env in the Common Commands plus `E2E_ALLOW_SHARED_DB=true`), the map project (`PW_MAP=1`, its own server), and the production hydration lane (`PW_PROD_BUILD=1 PW_PROD_PORT=<yours>`, `E2E_BASE_URL` unset). The auth-touching gate does not apply (no change under `src/auth.ts`, `src/proxy.ts`, `(auth)` or `src/lib/auth`), but the walk above did sign in MFA-enrolled users through the real form and `/totp`.

*Keep Phase 4 sections short: files, deviations from the design, gates with
counts, and anything the next phase must know. Leave out narration of how
the work went; git history already records it. Judgment output (analyst,
architect, qa) is still recorded verbatim.*

### Fix pass after QA run 1 (full-stack-developer, 2026-11-18)

Implements the seven rows of Phase 3 amendment A exactly as ruled. Commits on `pipeline/congregation-profile` after `6323d304`: `b297ac6f` (test: name pin), `5f1f7770` (fix: migration description, list reader and label), `d67d922d` (test: D6 harness), `0839d931` (fix: help sentences and back link), `34fd55e6` (test e2e), and one more fix for the assessment form's touch targets (below). No strings outside amendment A.

| # | What changed | Red first | Green |
|---|---|---|---|
| 1 | `blob-audience.db.test.ts`: the two `oversight_building_photos_*_fk` names added to both lists (the private-pin object and the exact name list) | "holds for every FK in the catalog": the received list carried the two extra names | 22 / 22 |
| 2 | `congregation-records.md` line 3 now reads: Open your presbytery's page, choose "Congregation Oversight" under "Governance & Courts", then choose "Open"...; `labels` lose "Administration" and gain "Governance & Courts". New `src/lib/help/congregation-records-nav.test.ts` derives the tile label and heading from `PORTAL_TILES` and `DOMAIN_LABELS` | 3 of 4 red on the old text and labels | 4 / 4; `check:help` passes |
| 3 | `drizzle/0089` section 1: a replay-safe `update permissions ... where description is distinct from` for `congregation_oversight.manage` (0038 untouched); header comment updated. `test-rls-89.sql` 89b pins the exact description | 89b failed ("expected 1, got 0") against the branch before re-applying | 0089 re-applied to the pipeline branch with `psql -1` (replay-safe: it matches nothing a second time); test-rls-89 as `presby_app`: 172 passes, 0 errors |
| 4 | `reads.ts` one grouped query returns `buildingsInUse` and `buildingsRetired`; `buildingsInUseLabel(inUse, retired)`; `STATE.noneInUse`; `oversight-list.tsx` passes both. Tests: `derive.test.ts` (four cases), `page.test.tsx` (a retired-only row says "None in use", a nothing-recorded row does not), `reads.db.test.ts` (key list gains `buildingsRetired`; a retired building beside a removed one is `{0, 1}`; removed-only is `{0, 0}`; the existing mixed case is `{2, 1}`) | 5 tests red (derive, page, three DB cases) | all pass |
| 5 | `test-0089-migration.sh` step 3 applies a temp copy of `seed-dev.sql` without its `\ir oversight/...` line (removed on exit); step 5 already seeds after 0089; one new check that the manage description no longer says "insurance" | the pre-fix script, run against the same tree, exits 1 at step 3 (`seed-dev-oversight.sql:95`, FK on `app_role_permissions`) | `D6 PASS` on a scratch database, exit 0, identical fingerprint after the second apply, `test-rls.sql` integrated, runner path agrees |
| 6 | `help` audit paragraph replaced with the ruled text (in `congregation-records-nav.test.ts`: not "Every change is recorded"; contains the "Assessment" sentence and "Looking at a record is not recorded.") | red on the old text | green |
| 7 | The assessment page uses `BackLink`; unused imports removed. `page.test.tsx` asserts `min-h-11`; the assessment form is in the 360px page list of `oversight-records.spec.ts` | the unit test was red on the old inline link | green |

**Found by row 7 (not in the ruling).** Putting the assessment form in the 360px list failed the 44px check on its own controls: the viability select was 42px and both coordinate boxes 36px (the form had a local select class without `min-h-11`; the form was moved by T1 with its old classes). Fixed in the same pass: the form uses the shared oversight `SELECT_CLASSES` and `min-h-11` on both inputs. Test: `edit-form.test.tsx` "touch targets" (red with the fix reverted, green with it); the e2e case was red before the fix and green after. No visible string changed.

**Also added.** `e2e/oversight-records.spec.ts` list case: Birch's buildings cell now asserts "1 building" (it was only matching another "Not recorded" cell), then retires its building in the database and asserts "None in use".

**Verification (all on the pipeline branch, serial DB runs):**
- `npm run typecheck`, `npm run lint` (zero warnings), `npm run check` (all ten tripwires; help check: 34 entries, 30 published, 7 images).
- `blob-audience.db.test.ts`, the oversight unit and DB files, `src/lib/help`, the `db/domain` files and the founding-administrator, invitations and presbytery tests: 88 files, 1,931 tests, 0 failed (`dotenv -e .env.local -- vitest run ... --no-file-parallelism`).
- `scripts/oversight/test-rls-89.sql` as `presby_app`: 172 passes. `scripts/oversight/test-0089-migration.sh`: D6 PASS.
- e2e on my own server (port 3104, the brief's env, `E2E_ALLOW_SHARED_DB=true`, `--project=chromium`): `oversight-records` (including the new 360px assessment page and the "None in use" case), `oversight-finance`, `oversight-founder`: 21 / 21 passed in the second run. The first run had 19 passed and 1 failed (the assessment form's 44px controls above) and 1 not run. Server stopped by PID; `org_portal.oversight` was switched on by the specs and is off again (the branch's baseline).
- Looked at in a real browser at 360px with a throwaway fixture: the portal home shows "Congregation Oversight" under the "Governance & Courts" heading (the help sentence is true); the list (360px and 1280px: a congregation whose only building is retired reads "None in use", one with two reads "2 buildings"; the buildings column is hidden below `sm`, as before); the assessment form (back link and fields at 44px); the help page (no sideways scroll; the new navigation and audit sentences read as ruled). No real data; the temporary spec was deleted and is not committed.
- `verifiedIn` on the help page was not moved. `docs/TODO.md` not edited (shared file); the loan screen-reader suffix follow-up from A4 is still for the orchestrator to add.

Handoff to **qa (Phase 5, run 2)**: re-run `blob-audience.db.test.ts`, D6, `npm run check`, the help walk, and `oversight-records`, `hydration/oversight-forms`; the 0089 edit means a fresh-database full `test-rls.sql` is worth repeating.

---

# Phase 5 — Verification (qa)

**Date:** 2026-11-18
**Verified by:** qa
**Tree:** `pipeline/congregation-profile` at `a564335c` in `/Users/cshenso/git/presby-platform/presby-profile`, which I did not modify. One disclosure: I briefly copied a walk script into the gitignored `.tmp/` and deleted it in the same command.

## Type Check

`npm run typecheck`: **PASS**. `npm run lint`: **PASS** (`--max-warnings=0`). `npm run check`: **PASS**, all ten tripwires (help check: 34 entries, 30 published, 7 images). `npm run build`: **PASS** (run inside the production lane below).

## Unit Tests

- **Without a database** (`npm test -- --no-file-parallelism`): 914 files passed, 159 skipped. Tests: 14,956 passed, 4,253 skipped, **0 failed**, 317.5s.
  - Every skip is environment-gated: 176 `describe.skipIf(!hasDb)` blocks plus one `STATEMENT_SAMPLE_DIR` sample test. The DB-gated ones ran in the next item.
- **The whole DB-backed suite.** The run-scope rule requires it because the diff touches a migration and `src/lib/db/`.
  - Run like CI's job, on a fresh `scratch_qa5_db` database on the pipeline branch: migrate, schema-parity (0 failing), seed, `seed-dev.sql`, `db-baseline.sql`, test helpers, then the suite serially. The database was dropped afterwards.
  - Files: 1,072 passed, **1 failed** (1,073). Tests: 19,207 passed, **1 failed**, 1 skipped (the sample test). 6,713s.
  - This covers every file the brief named: oversight, the `db/domain/oversight*` files, presbytery and its reports reader, founding-administrator, invitations, two-factor-default, worship, dev-docs and the designation-parity files.
  - **Failure:** `src/lib/storage/blob-audience.db.test.ts:404`, "holds for every FK in the catalog".
    - The test names every foreign key into `blob_assets`, and 0089 adds `oversight_building_photos_image_fk` and `oversight_building_photos_thumb_fk` without adding them there.
    - The product side is fine. The same test's "no offenders" assertion passed, and the live catalog shows both keys pinned by the validated CHECK `oversight_building_photos_audience_private`.
    - It is a missing name pin (the person-photos precedent is `11456fd7`). The failure is deterministic and CI's DB shard will fail the PR the same way.
- **Isolation suites (all as `presby_app`, `rolbypassrls = f`):**
  - The full `scripts/test-rls.sql` on a fresh `scratch_qa5_rls` database (CI's test-rls job order): exit 0, 2,157 pass notices, 0 errors, "Section 89 complete". The date-dependent `presby_submit_granted_return` failure did not occur from empty.
  - `scripts/oversight/test-rls-89.sql` from fresh: exit 0, 171 passes.
  - `scripts/oversight/test-rls-89.sql` on the pipeline branch (with the oversight seed): exit 0, 171 passes.
- **D6 (`scripts/oversight/test-0089-migration.sh`): FAIL, harness only.**
  - It stops at step 3, `scripts/oversight/test-0089-migration.sh:199`, because `seed-dev.sql` runs before 0089 is applied.
  - Since integration, `seed-dev.sql` includes `\ir oversight/seed-dev-oversight.sql`, which inserts the finance key that only 0089 creates (FK `app_role_permissions_permission_key_permissions_key_fk`).
  - It is not a product defect: the integrated from-empty path above passes. But the committed D6 can no longer pass on this tree.

## End-to-End Tests

- **Flag state:** before e2e I reset global flags to the CI baseline (`scripts/ci/e2e-reset-flags.sql`, `pipeline_branch=1`; 38 seeded flags).
  - That turned off `org_portal.admin_hub`, `.features`, `.insights` and `.oversight`, which were on from the B3/B4 walks. The branch is left at that baseline.
  - I switched `.oversight` and `.admin_hub` on only for my own walk and put them back.
- **Dev lane** (own server on 3104 with the brief's env, stopped by PID; `E2E_BASE_URL=http://localhost:3104`, `--project=chromium`, desktop project with 360px cases inside the specs):
  - `oversight-records`, `oversight-finance`, `oversight-founder`, `presbytery-oversight`, `presbytery-dashboard`, `hydration/oversight-forms`, `totp-full-login`: **40 / 40 passed**, 3.9m, no skips.
  - Blast radius I added, because both specs render the changed `founding-administrator-section.tsx` on a presbytery: `admin-organizations`, `designation-revoke`: **33 / 33 passed**, 1.6m.
- **Map project** (`PW_MAP=1`, its own server on 3104): **10 / 10 passed**, 47.1s.
- **Production lane** (`PW_PROD_BUILD=1 PW_PROD_PORT=3105`, `npm run test:e2e:prod`, both projects): **117 / 117 passed**, 6.9m, including both `hydration/oversight-forms` cases. Port 3105 was released afterwards.
- **Auth-touching gate:** satisfied. The founder spec signs in through the real `/signin` form, answers `/totp` for MFA-enrolled users with a real code, and walks forced enrolment after the grant with a real code. `totp-full-login` passed.
- **Full chromium suite: not run.** The diff touches no proxy, auth file, layout, `playwright.config.ts` or shared component. The only `e2e/support` change is a new file imported only by the new specs. The rest rests on the PR's CI run.

Failures: none in e2e.

## Regression Tests Added

I checked failing-first myself for each one: in a scratch copy for the unit and DB tests, and on a scratch dev server on 3106 for the e2e case.

- **F451/F454:**
  - `src/lib/presbytery.test.ts:841` (DB): red against `origin/main`'s `presbytery.ts` (the legacy carrier is nulled on save), green on HEAD.
  - `src/lib/presbytery.superseded-fields.test.ts:28`: 4 red against main, green on HEAD.
- **F452 (second factor):** `src/lib/presbytery-reports/gate.test.ts:221`, `oversight/page.test.tsx:111` and `[aboutOrgId]/assessment/edit/page.test.tsx:258`. With the gate's `two_factor_required` redirect removed, 5 tests went red; restored, green.
- **F452 (UUID 404):** `oversight/record-pages.test.tsx:105` and `:210`. Red with the `isUuid` loop removed from `record-front-door.tsx`; restored, green. Also `assessment/edit/page.test.tsx:269`.
- **B4 back link:** `e2e/oversight-records.spec.ts:352`. Red against the pre-fix `back-link.tsx` from `801f448e~1` (sideways scroll 1,202px), green with the fix.
  - It asserts the property (no sideways scroll on six pages at 360px), not the fix's own class names. The fix commit carries the `fix:` trailers.
- **Naming:** the F452 tests are tagged "(F452)" rather than the "— regression for …" suffix the convention asks for.

## Coverage on Critical Modules

- `src/lib/permissions.ts`: 100%
- `src/lib/two-factor.ts`: 91.11% statements (lines 35–39 uncovered)
- `src/lib/flags.ts`: 100%

`permissions.ts` and `flags.ts` are 12 of 12 statements together; the text reporter leaves out fully covered rows. The diff touches none of the three.

## Feature-Gate Audit

These are `(org)` tenant surfaces, so there is no `FEATURES.*`. I checked sign-in plus the Node-side second-factor recheck, then the tenant key inside the transaction (`holdsPermissions` / `presby_has_permission`). I read the bodies, not just the test results.

| Route or action | Signed in + 2FA recheck | Tenant key check present | Correct key |
|---|---|---|---|
| Page: list `oversight/page.tsx` | yes (`gateOversightPage`) | yes, `readOversightList`; each column follows its own key | either key; columns manage / finance |
| Page: record `[aboutOrgId]/page.tsx` | yes | yes, `openRecord`: UUID 404 then `readOversightAccess`; each section reads under its own key | either key; sections per key |
| Page: `profile/edit` | yes | yes, `readProfile` | manage |
| Page: `assessment/edit` | yes, then `isUuid` | yes, `getCongregationOversightDetail` | manage |
| Pages: `buildings/new`, `buildings/[id]`, `buildings/[id]/edit` | yes | yes, `readBuildings` / `readBuilding`; appraisals block uses `readAppraisals` | manage; appraisals finance |
| Page: `appraisals/new` | yes | yes, both readers; a Locked page for the missing one | finance + manage |
| Pages: `insurance/new`, `insurance/[recordId]/edit`, `loans/new`, `loans/[loanId]/edit` | yes | yes, `readInsuranceYear(s)` / `readLoan(s)` | finance |
| `setProfileAction` | yes (`resolveOversightActor`: `assertOrgSession` before `resolveOrgContext`, then UUIDs) | yes, `store.gate()` in the transaction | manage |
| `create/update/retire/reinstate/removeBuildingAction` | yes | yes | manage |
| `record/removeAppraisalAction` | yes | yes | finance |
| `record/update/removeInsuranceAction` | yes | yes | finance |
| `record/update/markLoanPaidOff/removeLoanAction` | yes | yes | finance |
| `setCongregationOversightAction` (moved) | yes (now gained the recheck, F452) | yes, in `presbytery.ts` | manage |

Other checks:

- No `route.ts` and no `loading.tsx` exist under `oversight/**`.
- Every store write: key, then congregation, then row, then version, and one `insertAuditRow` in the same transaction.
- No `console.log` and no native dialogs in the diff. The one `console.error` is the documented SQLSTATE-only line.
- **Observation (not a FAIL):** no action checks the `org_portal.oversight` flag, so a key holder can write with the flag off by calling an action directly. This matches the design's API contract and the shipped assessment action; the permission is still enforced.

**Schema/RLS audit (live catalog, pipeline branch):**

- All six `oversight_*` tables are `relrowsecurity` and `relforcerowsecurity` true, owned by `neondb_owner`.
- One `tenant_isolation` policy each, with both USING and WITH CHECK `organization_id = presby_current_org()`.
- `aclexplode`: `presby_app` holds INSERT and SELECT plus column-level UPDATE only. No DELETE or TRUNCATE, and no `presby_platform` grant.
- 17 non-internal triggers.
- `congregation_oversight.finance` is tier 2 with `requires_two_factor = t`. The presbytery bundle ends `…manage, …finance`, and the congregation bundle carries neither.
- Refusals were proven by running the tests as `presby_app` (test-rls-89 a to i), not inferred.

## Copy Truthfulness

- [ ] **Every added or changed string is in the design's Copy table.** Off-table strings, none false but needing ratification:
  - The empty select options "Choose a type", "Choose the kind of loan" and "Choose why" (B3 deviation 3; no ruling recorded).
  - The screen-reader suffixes "insurance for {year}" (`insurance-card.tsx:50`), "loan" (`loan-actions.tsx:46`) and "appraisal for {year}" (`appraisals-block.tsx:63`).
  - The help's finance-only-appraisals sentence is covered by the orchestrator ruling (`docs/TODO.md:135`).
- [x] **The query behind each claim was opened.** One defect found:
  - **copy truthfulness: FAIL.** `src/lib/oversight/derive.ts:54` with `reads.ts`. The count excludes retired buildings, so "Buildings in use" says **"Not recorded"** for a congregation whose recorded buildings are all retired.
  - On the same congregation, the record page lists those buildings with a "Retired" badge.
  - Viewer: manage holders on the list. The string is C1's own (design-traced).
- [ ] **Each instruction was traced to its role.** One defect found:
  - **copy truthfulness: FAIL.** `src/content/help/congregation-records.md:3`: "Open "Administration", choose "Congregation Oversight"" is false.
  - The tile is `category: "operate"` (`src/lib/org-portal/tiles.ts:568`), so it appears on the portal home under "Governance & Courts".
  - The Administration hub (`/o/<slug>/admin`, "Organization Administration") lists only administer tiles. On screen at 360px and 1280px, with `org_portal.admin_hub` both on and off, it shows only "Per-Capita, SASR & Imports".
  - Viewer: presbytery staff holding either key. The text is C12's own (design-traced). "Administration" is also in the page's `labels`.
- [ ] **Older strings about the same subject were grepped.** One defect found:
  - **copy truthfulness: FAIL.** `drizzle/0038_presby_presbytery_program.sql:707`: the `congregation_oversight.manage` description "Record viability assessments and buildings/insurance notes for a member congregation" is now false, because insurance belongs to the finance key.
  - It is shown beside the tick on Create role and Edit role (`roles/new/create-role-form.tsx:116`, `roles/[id]/edit/edit-role-form.tsx:102`), right next to the new finance description that also says "insurance".
  - Viewer: presbytery administrators building a role. C10's neighbour list missed it.
  - 0089 is unreleased, so it can be corrected in place.
- [x] **Help diff walked.**
  - My own 360px walk, light and dark, as `presbytery-clerk` with the flag on, found these labels on screen: "Congregation Oversight", "Open", the five section headings, "Locked", "Add profile details", "Edit assessment", "Add a building", "Primary building", "Save building", "How these records work". Sideways scroll was 0 on every page.
  - The e2e specs assert the finance, retire and stale labels.
  - "Try again" is covered by unit tests only.
  - The `presbytery-reports`, `roles-who-can-do-what`, `why-cant-i-see-this` and `presbytery-tools` edits match C12.
  - The `privacy-policy` page is unchanged (correct for Increment 1).
  - There are no committed images in this diff, so no pixels to read.
- **For tech-lead to rule (not counted as failures):**
  - "Every change is recorded in the audit trail" (help) is the design's own wording but brushes the F455 residual: the assessment write audits after commit and swallows a failure.
  - The assessment page's back link is 20px tall at 360px (`assessment/edit/page.tsx`, a pre-existing class string carried over by the `git mv`; the 44px case doesn't cover that page). Polish.

## Verdict

**FAIL**

1. **Regression in the test suite:** `src/lib/storage/blob-audience.db.test.ts:404`. Add the two oversight photo foreign keys to the name pin. Owner: database-admin (B1).
2. **copy truthfulness: FAIL.** The help navigation step at `congregation-records.md:3` is false (the tile is on the portal home, not under Administration).
3. **copy truthfulness: FAIL.** The stale manage-key description at `0038…sql:707` still claims insurance, on the Roles screens.
4. **copy truthfulness: FAIL.** The list says "Not recorded" for a congregation whose buildings are all retired (`derive.ts:54`).
5. **D6 harness** cannot pass on the integrated tree (`test-0089-migration.sh:199`). Owner: database-admin.

Items 2 to 4 trace to the design's Copy section (C12, C10, C1), so they go to **Phase 3 first**: tech-lead writes the corrected strings. Then the implementers apply them, each with an exact-text test that fails on the old text:

- database-admin: the 0089 in-place description update (section 1), plus items 1 and 5.
- ux-developer: the help step and `labels`, and the list label.

Everything else passed: typecheck, lint, build, all ten tripwires, every e2e run (40, 33, 10 and 117 tests, MFA path included), the full `test-rls.sql` from empty, the live-catalog audit, the gate audit, and all four regression tests, each shown failing first.

**Run scope:**

- Ran: typecheck, lint, check, the unit suite, the whole DB-backed suite (fresh database), the full `test-rls.sql` from empty, `test-rls-89` (fresh and branch), D6, the targeted e2e plus two blast-radius specs, the map lane, and the production lane.
- Not re-run: the full chromium e2e suite (it rests on the PR's CI).

---

**Per-Phase Status row**

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete (run 1) | FAIL | 2026-11-18 |

**Handoff:** **tech-lead** (Phase 3 loop-back) for amended C1, C10 and C12 strings, covering items 2 to 4. It should also ratify the off-table strings and rule on the F455 audit sentence. Then **database-admin** (items 1, 3 and 5, with 0089 corrected in place because it is unreleased) and **ux-developer** (items 2 and 4). Then QA run 2, which re-runs `blob-audience.db.test.ts`, D6, `npm run check`, the help walk and the specs touching the changed strings.

Logs, scripts and walk screenshots are in `/private/tmp/claude-501/-Users-cshenso-git-presby-platform-presby/2313dcc4-4a86-43c8-9bfc-694f433ec0be/scratchpad/qa5/`.

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
- Help pages read as their reader (each page named in Help impact): [pass | fail | no help impact]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]
