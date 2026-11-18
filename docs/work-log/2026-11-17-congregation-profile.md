# Congregation profile: buildings, insurance and loans — Work Log

> **Slug:** `2026-11-17-congregation-profile`
> **Surface:** (org) — the presbytery's per-congregation pages (oversight tree), presbytery branch; `/help`
> **Permission(s):** to be settled in Phase 1/3 (candidate: existing `congregation_oversight.manage`, or new keys)
> **Flag(s):** per-org toggle only if needed (no new global flag pre-live)
> **Estimated complexity:** large
> **Pipeline mode:** Full (schema change: new tables, migration 0089)
> **Source:** operator decisions A–G, 2026-11-17 (A: each congregation is its own organization; the presbytery edits address, county and year organized directly for a congregation that has not joined; buildings v1 = building basics (sq ft, year built, roof, appraisal), building photos, insurance per year, loans). Operator: "take congregation profiles all the way to the end (pushed to production)".
> **Prior art:** `~/git/psvonline-portal` — `src/app/(app)/congregations/[id]/` (building-dialog, insurance-dialog, congregation-detail), `src/app/api/congregations/[id]/buildings|insurance`, `src/app/(app)/reports/buildings/`, `scripts/import-spreadsheet.ts`
> **Pre-assigned:** DECISION-344+, F450+, migration 0089 (0088 stays reserved for Learn 1b), dev port 3102, worktree `../presby-profile`, Neon branch `br-spring-bonus-axifozcw` (`pipeline-congregation-profile`), e2e person-id range: to be assigned by tech-lead if a fixture is needed

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-11-17 |
| 2 — Architectural review | architect | Complete (R1–R10; DECISION-344–348 proposed; F450–F453) | Approved with suggestions | 2026-11-17 |
| 3 — Technical design | tech-lead | Complete (one design for both increments; T1–T12; DECISION-349–351 proposed, 352 held; F454–F455; migration 0089; Inc 1 batches B1–B4, Inc 2 batches B5–B9; two child logs created) | Design complete | 2026-11-17 |
| 4 — Implementation | Inc 1: database-admin (B1), api-developer (B2), ux-developer (B3), full-stack-developer (B4); Inc 2: api-developer (B5, B7), ux-developer (B6, B8), full-stack-developer (B9) | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

## Children

Per CLAUDE.md "Per-Feature Tracking" (the Community log reached 5,945 lines). This parent keeps Phases 1 to 3 (the shared analyst and architect text verbatim, and the one design for both increments). Each child carries its own Phases 4 to 6 and a short Phase 3 pointer with its batch plan and gates.

| Increment | Work-log | Release | Scope |
|---|---|---|---|
| 1 — records | `docs/work-log/2026-11-17-congregation-profile-inc1.md` | 0.61.0 | Migration 0089 (all six tables, the key, the bundle); the module (`contract`, `validate`, `copy`, `derive`, `store`, `reads`); `gateOversightPage`; list and record pages; profile, assessment, buildings, appraisals, insurance, loans; the `congregation-records` help page and four help edits; the founding-administrator walk |
| 2 — photos and reports | `docs/work-log/2026-11-17-congregation-profile-inc2.md` | 0.62.0 | The `storage/image/` extraction (refactor commit), building photos, the Buildings and Insurance-and-loans reports with CSV, two help edits and the privacy line |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES.** Nothing blocks design. The notes are rulings Phase 2 and 3 must carry (Gaps 1–5 and 8) and one operator confirmation with a default I have chosen (Open Question 1). Nothing here waits on the operator.

## ONE-LINE TAKE

> On a congregation's page under Congregation Oversight, presbytery staff keep the presbytery's own record of that congregation: a profile (address, city, county, year organized), its buildings with basics, condition and photos, a dated appraisal per building, insurance by year, and loans. Everything about money sits behind a new tier-2 key. The congregation itself never sees any of it in v1.

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Authenticated member, presbytery staff holding `congregation_oversight.manage` | **Open** a congregation from the oversight list; **type** address, city, county, year organized, phone | One-time per congregation, then rare |
| Same | **Add, edit and retire** a building (name, type, year built, up to two addition years, square feet, roof/plumbing/HVAC/boiler condition, sprinklers/fire alarm/security Yes/No/Not recorded, notes) | One-time, then annual |
| Same | **Choose** a photo from the phone's library or camera, **add a caption**, **view larger**, **remove** (Increment 2) | Per site visit |
| Authenticated member holding the new tier-2 finance key | **Record** a building's appraisal (amount, year); **record** a year's insurance (carrier, policy number, expiry, recent claims, pool interest); **record** a loan and later **update** its balance or **mark** it paid off | Annual, plus per loan event |
| Same people | **Open** the two reports and **download** the CSV (Increment 2) | On demand |
| Presbytery staff with `oversight.manage` but not the finance key | **See** Buildings and Profile, and a "Locked" state naming the finance permission where money would be | On demand |
| Operator (not a feature) | **Import** the prototype's spreadsheet once, in a Claude Code session | One-time |
| Anonymous visitor, no-role user, platform admin | **No verb.** Nothing here is public, nothing renders at `/admin`, and no public-site footer or JSON-LD reads it. | n/a |
| Congregation members and administrators, managed or not | **No verb in v1** (Gap 2) | n/a |

All of it is the authenticated-member surface at `/o/<presbytery-slug>/admin/oversight/<aboutOrgId>/...`, presbytery type only.

## Flows

**Flow 1 — Open a congregation's record:**
- Entry: Administration → "Congregation Oversight" → list → a congregation. The pre-existing four-way org-miss, 2FA recheck, `org_portal.oversight` flag and presbytery-type checks run first. After them, a live per-key permission read decides which sections render.
- The page shows, in order:
  - Profile
  - Viability and map location (existing)
  - Buildings (cards: name, type, year built, square feet, photo count)
  - Insurance
  - Loans
- A section the viewer's keys don't cover shows "Locked", naming the permission, in the dashboard's existing pattern. A zero is never shown where "not recorded" is the truth.
- Failure:
  - A section's reader throws: that section shows a load error with a "Try again" link, and the rest of the page stays up.
  - A non-UUID or non-member `aboutOrgId`: a real 404.
  - Flag off: the existing `PlaceholderFlagOff`.
  - Non-presbytery type: `PlaceholderNotAvailable`.

**Flow 2 — Edit the profile:**
- Entry: the Profile section → Edit.
- Fields: address (multi-line, `normalizeAddress` rules from DECISION-340), city, county, year organized, phone. No field is required.
- Save writes one audited row. A managed congregation shows the Gap 1 note.
- Failure: a field message from the server, for example "Year organized must be between 1600 and this year", or a toast "We couldn't save that. Nothing was changed." for a database error.

**Flow 3 — Add a building:**
- Entry: Buildings → "Add a building". This is a full page, not a dialog (360px).
- Steps:
  - Enter name and type.
  - Enter the optional facts.
  - Save.
- Outcome: the card appears. The first building offers "Primary building", and at most one is primary per congregation.
- Failure:
  - A duplicate live name gets "A building with that name is already recorded."
  - A year in the future or before 1600 is refused.
  - Square feet must be a whole number of at least 1.
- Retire: "Retire this building" takes a reason (sold, demolished, closed or other) and a date, then removes it from the active list. Its history stays.
- Remove: "Remove (entered by mistake)" sets `removed_at`. Nothing is hard-deleted.

**Flow 4 — Photos (Increment 2):**
- Entry: a building → Photos → "Add a photo". The picker offers the camera roll and camera.
- Steps:
  - The browser downscales the photo, because the server-action body limit is under 1 MiB.
  - The server sniffs the type, checks pixels, strips metadata and re-encodes.
  - The server stores it with `audience: "private"`.
- Outcome: the thumbnail grid shows two columns at 360px. Tap a tile to see it larger, add or edit its caption, or remove it. The first photo is the cover. Removal asks through an AlertDialog.
- Failure, each in its own words:
  - "That file type isn't supported. Use a JPEG, PNG or WebP."
  - "That photo is too large to read."
  - "This building already has 10 photos."
  - "We couldn't save the photo."
  - HEIC gets the existing iPhone hint.

**Flow 5 — Appraisal (finance key):**
- Entry: Buildings → a building → "Record an appraisal".
- Fields: amount in whole dollars (stored as cents) and the year assessed.
- Outcome: the latest by year shows as current, and earlier ones stay listed.
- Failure: a negative or non-numeric amount is refused, and amounts above a stated maximum are refused.

**Flow 6 — Insurance by year (finance key):**
- Entry: Insurance → "Record a year".
- Fields: policy year, carrier, policy number, policy expiry date, recent claims (Yes/No/Not recorded), interested in the pool (Yes/No/Not recorded), notes.
- Rules:
  - One live record per congregation and year; a second gets "Insurance for that year is already recorded. Edit it instead."
  - Years list newest first.
  - Expiry shows as plain text, with "Expired" where the date is past. State is never carried by colour alone.
- Failure: as above.

**Flow 7 — Loans (finance key):**
- Entry: Loans → "Record a loan".
- Fields: kind (presbytery program loan, guaranteed outside loan, other), lender, original amount, current balance with "as of" date, grants amount, guarantee note (text), notes.
- Update the balance by editing, which stamps the as-of date.
- "Mark paid off" sets status and date.
- An empty list says "No loans are recorded for this congregation." It never says "No loans." Not recorded is not the same as none.
- Failure: a balance as-of date in the future is refused.

**Flow 8 — Reports and CSV (Increment 2):**
- Entry: the "Per-Capita, SASR & Imports" hub gains two cards beside the existing four.
  - **Buildings** (tier 1, `oversight.manage`): congregation, city, county, building count, year built, square feet, roof, HVAC and safety systems. No money.
  - **Insurance and loans** (finance key): carrier, expiry, claims, pool interest, original loan, balance, guarantee, current appraisal.
- Cards render below `sm`, and a table above. "Export CSV" follows DECISION-337..339: the export builds its CSV and writes its audit row in the same transaction as the read.
- Exclusions: neither export carries street addresses, policy numbers or free-text notes.
- Failure: the usual card load error with "Try again". A holder of neither key gets the forbidden state.

**Flow 9 — A congregation joins the platform:**
- Nothing is frozen and nothing moves (Gap 1). The presbytery's rows stay the presbytery's.
- The Profile section for a managed congregation gains one line: "This congregation keeps its own profile on PresbyPortal. What you enter here is the presbytery's own copy and does not change theirs."
- The congregation sees nothing of the presbytery's records.

**Flow 10 — The operator's import (constraint, not a feature):**
- It runs once in a session, as the owner connection with the org GUC set.
- Every table must tolerate nullable everything except identity, and must take the operator's own user id for `updated_by`.
- A `provenance` of `entered` or `imported` on the profile columns, buildings, insurance years and loans lets staff and a later audit see what came from the spreadsheet (the `congregation_statistics` precedent).
- The congregations must already exist as organization rows under the presbytery before the import. That is the import's dependency, not this pipeline's.

## Permissions & Flags

**Permission matrix.** There is no view-only key. `congregation_oversight.view` does not exist, and the dashboard's Phase 1 ruled against minting one. Read and write share a key, as in every other presbytery area.

| Record | Tier | Key (view and edit) |
|---|---|---|
| Profile: address, city, county, year organized, phone | 1 | `congregation_oversight.manage` (existing) |
| Building basics, condition, safety systems, notes, photos | 1 | `congregation_oversight.manage` |
| Buildings report and CSV | 1 | `congregation_oversight.manage` |
| Appraisal | 2 | **new** `congregation_finance.manage` (name is the Phase 3 call) |
| Insurance by year | 2 | the new key |
| Loans | 2 | the new key |
| Insurance-and-loans report and CSV | 2 | the new key |

- **Why tier 2:**
  - The schema's own definition makes financial tier 2.
  - Today's insurance carrier and expiry sit at tier 1 on the oversight row. Moving them behind tier 2 is a deliberate tightening and is stated as one.
  - `statistics.manage` and `per_capita.manage` are tier 2 for the same reason.
- **Default roles: bind it to none (my recommendation, Open Question 1).**
  - It would fail DECISION-078's test, since no constitutional duty binds it.
  - Adding a tier-2 key to the founding-administrator bundle breaks "no role carries a wildcard". That would need an operator ruling, a CLAUDE.md known-violation entry (the `careers.applicants` precedent), a redefinition of `presby_founding_administrator_permission_keys`, and the TypeScript mirror and parity test.
  - A founding administrator holds `role_grants.manage`, so they can give themselves the key in two steps under Roles. The help page walks it.
  - Only fixtures get a direct grant, in `seed-dev.sql`.
- **2FA:** I recommend `requires_two_factor = true`, matching the three giving keys, the other tier-2 keys that set it. This is a Phase 2/3 ruling. It forces enrolment on whoever holds the key, and I state that plainly.
- **Flags:** none new, per the operator.
  - The surface rides the existing `org_portal.oversight` flag and presbytery-type gate.
  - The two reports ride `org_portal.reports`, with bare `isFlagEnabled` used only to decide link versus plain text.
  - No per-org toggle is needed. Nothing here carries the privacy stakes that justify the person-photos toggle, because building photos are private and never public.
  - The schema is additive. Rollback is revert and redeploy. `org_portal.oversight` off is the coarse switch, and it also hides the shipped oversight page.

## Gaps the Request Didn't Address

1. **Who owns address, county and year organized once the congregation is a tenant (proposal; the operator asked me to settle this).**
   - The presbytery's profile is the presbytery's own row, written under the presbytery's organization id from day one. It is not the congregation's `organization_profiles` row.
   - That row is congregation-editable, public-site content, and unreadable and unwritable by the presbytery by isolation.
   - So nothing "transfers" at sign-up, there is no moment where the presbytery writes into the congregation's records, and D9's stewardship-lapse trust failure cannot occur.
   - The presbytery's copy therefore **stays editable** after joining, labelled as the presbytery's copy (Flow 9).
   - Reasons:
     - County and year organized have no congregation-side home at all.
     - A frozen address strands corrections, and the presbytery mails congregations regardless of platform use.
     - Two copies can diverge. That is accepted and said aloud.
   - There is no automatic sync in either direction. The only upward path is publication, so a congregation-initiated "publish my profile to my presbytery" is a later pipeline.
   - **The alternative** is to freeze address and phone once `platform_status = managed`. It costs one in-transaction status check in the write path and a read-only render, with no schema change. Open Question 2 asks for confirmation.
   - Year organized may later derive from an `organized` lifecycle event. That event requires a minute reference, so it cannot serve imported rows today.
2. **A tenant congregation cannot see or edit its own buildings, insurance or loans in v1.**
   - These tables are the presbytery's own record (organization id is the presbytery), consistent with DECISION-119/120's "never the congregation's own record".
   - A congregation's own property record is a different, congregation-owned table with publish-upward, so it is a later pipeline.
   - Cost: a managed congregation sees none of what its presbytery holds, including loans that concern it. `scripts/test-rls.sql` must pin zero rows to a congregation session.
3. **A finance-only holder has no front door.**
   - Today the list and detail pages require `oversight.manage` at the door.
   - Recommendation: the congregation record page and list open for a holder of either key, and each section is gated by its own key.
   - The list shows names (public org tree), city and county. It shows building counts only with the tier-1 key, and the soonest policy expiry only with the finance key.
4. **The shipped oversight row's three fields are superseded.**
   - `buildings_notes`, `insurance_carrier` and `insurance_expires_on` exist today. The list column "Buildings & insurance" and the edit form read them.
   - Recommendation:
     - The form drops carrier and expiry, replaced by the insurance-year records.
     - `buildings_notes` becomes "Property notes".
     - The columns stay dormant (no drops).
     - The list column becomes derived: building count at tier 1, plus policy expiry with the finance key. The carrier must not render for a user without the key.
   - Phase 3 decides whether existing production values need a one-time conversion. Count the rows first.
   - `readers.db.test.ts` pins that the viability reader reads no building or insurance data, and that must survive.
5. **Appraisal's home.**
   - The prototype keeps it in two places: per building, and again on the per-year insurance row. The spreadsheet carries one value per congregation, on its insurance sheet.
   - Because appraisal is tier 2 and a building is tier 1, a column on the building would force field-level key gating and a write path that must not null an appraisal a non-finance editor can't see.
   - Recommendation:
     - A dated per-building appraisal record (building, year assessed, amount in cents, notes). Latest by year is current, and the key splits cleanly.
     - The import maps the spreadsheet's value to the primary building at the sheet's year.
   - Fallback if Phase 3 finds it heavy: columns on the building with read and write gated by the finance key, and a test that a non-finance edit preserves them.
6. **Loans and money shape.**
   - The prototype hangs original loan, program balance, mortgage grants and a free-text "loan guarantee" off the insurance year row. They are not an insurance fact.
   - Recommendation: a congregation-level loans list as in Flow 7.
   - Money is integer cents, per DECISION-337.
   - There is one balance plus an as-of date. A balance history is not built, and audit records that it changed.
   - A loan may link to a building optionally. It need not in v1.
   - The guarantee stays free text, because the source values are messy.
   - I don't know what the guarantee column holds in practice. The operator will, so Open Question 3 asks.
7. **Insurance per year is one policy per year.**
   - The prototype and spreadsheet do the same, so it fits the import.
   - Several policies (property, liability) or a premium are not modelled. That is a stated limitation, not an oversight.
   - A congregation-year unique index applies among live rows only.
8. **Photos run against DECISION-312.**
   - Blob audience is `private`, org id is the presbytery, and bytes live in Postgres `bytea` in `blob_assets`, so storage grows.
   - `sharp` has a closed list of two importers (`image-sanitize.ts`, `person-photos/image.ts`). Building photos must call one of those. A third importer would be a new DECISION.
   - `processPhoto` crops thumbnails top-biased and square for faces. A building thumbnail needs a centred cover crop added inside an existing importer.
   - The architect must rule on:
     - which importer to extend
     - the per-building cap (I suggest 10, mirroring people)
     - the master byte ceiling (I suggest at or below the person master's 400 KB)
     - serving: inline `data:` thumbnails as person photos do, or an authenticated route as receipts do
   - The client downscale island is the only new `'use client'` photo code. T3 bans `capture` on file inputs.
   - Orphaned blobs on a failed final transaction are the existing accepted residual.
   - Fixtures and help screenshots must use generated images. A real building is real data.
9. **Closed or departed congregations.** The reports' roster rule (current members) and `resolveMemberCongregation` mean a dissolved or dismissed congregation's property and outstanding loans become unreachable in the UI while staying in the table. I recommend the same rule in v1 plus a tracked TODO line for a "former members" view. This is a silent-loss risk worth naming now.
10. **Concurrent edits.** Last write wins today (oversight upsert). For money fields I recommend a "this record changed since you opened it" check on `updated_at`. Phase 3 may defer it but must say so.
11. **Everything the prototype columns need, in one place.** The shapes must hold these with no loss. Where one has no obvious home, it is named here:
    - Congregation: street address, city, state, ZIP, county, phone, email, website, year organized, notes. Address plus a separate city, entered and not parsed (DECISION-340 bars parsing the address). Email, website and PIN already have homes elsewhere (contacts and `organization_identifiers`).
    - Building: all the fields in Flow 3, including two addition years and the three Yes/No/Not-recorded safety fields.
    - Insurance year, loan and appraisal: as in Flows 5–7.
    - At most one primary building per congregation.
    - Live building names are unique per congregation.
    - Year and money columns are nullable, because the spreadsheet is messy.
12. **Cross-congregation child rows.** A building, photo, appraisal or insurance row must not point at a different congregation's building. The composite-tenant-key invariant applies, and so does a consistency check that the child's `about_org` equals the building's. `buildingId` in a URL must resolve under the `aboutOrgId` segment, or 404.

## Out of Scope (confirm with user)

- A congregation viewing or editing its own property record, and publishing a profile upward (Gap 2).
- A view-only permission, and any separate export permission. Exports use the report's key, and a later "export permission" pipeline may split them.
- A buildings audit log page for the presbytery (the writes are audited here, and a later pipeline reads them).
- Several policies per year, premiums, loan schedules and balance history.
- Auto-geocoding an address.
- Importer UI. The import is the operator's one-time session.
- Committees and commissions (including a property committee), presbytery offices, mission giving and worship times.
- A "former members" view.
- Photos of the congregation itself, as opposed to its buildings.
- Wiring any of this into the public site.

**Dependencies to note.** A property committee would simply receive keys through Roles once committees exist. The later export permission splits "view" from "download". The presbytery audit log reads the audit rows written here.

## Adversarial Pass

- **Redirects:** there is no `callbackUrl` or `next` parameter. All back-links are static paths built from the validated slug. Confirmed by design, and a test should pin that none is added.
- **State-machine shortcuts:**
  - Hitting a deep URL (`.../buildings/<id>`, `/photos`, the report or export route) directly must pass every gate in the same order. Neither the flag, the type, nor the key may be skipped.
  - Locked sections must be denied inside each reader's transaction, not merely hidden.
  - The Phase 1 for the dashboard noted this and it applies here.
- **Cross-tenant and IDOR:**
  - A building, photo, appraisal, insurance or loan id from another congregation, or another presbytery, must 404 identically to a nonexistent one. No 403 that proves existence (DECISION-040).
  - Non-UUID ids 404 before any read (the F446 precedent).
  - A congregation or congregation-admin session must read zero rows, pinned in the RLS suite.
  - The platform admin gets no presbytery data through any page.
- **Photos:** SVG, HEIC, PDFs, polyglots, APNG, animated WebP, decompression bombs and EXIF GPS must all die in the existing sanitizer path. Authorization runs before decoding, as person photos do, so nobody spends `sharp`'s CPU without the key.
- **Enumeration:** "building not found" for a congregation outside this presbytery must read the same as one that exists with no buildings. Copy must not vary.
- **Input boundaries (server-side, not only the form's):**
  - Empty form, overlong strings and invalid dates.
  - Money that is negative, not a number, or above the maximum.
  - Years outside 1600 to the current year (an addition year before the build year is refused).
  - Square feet below 1 or absurdly large.
  - Unicode and control characters in names, addresses and notes. Address uses `normalizeAddress`.
- **CSV:** free text in carrier, lender or guarantee goes through the existing text guard so a leading `=`, `+`, `-` or `@` cannot become a formula. Integers go through `csvIntegerCell`, as DECISION-337 requires.
- **Self-targeting:** a presbytery staff member who is also a member of one of its congregations acts in separate org contexts. There is no admin-only action against one's own account in this feature.
- **The finance key and 2FA:** a holder mid-enrolment is already redirected to `/totp` by the proxy on `/o/*`. The key's `requires_two_factor` forces enrolment at the next sign-in, which is stated in the Roles help.
- **Audit:**
  - Every write is audited in the same transaction (the person-photos pattern), so a failed audit insert undoes the change.
  - Every export is audited in its read's transaction.
  - New action keys cover profile set, building create/update/retire/remove, photo add/remove/cover, appraisal recorded/removed, insurance recorded/updated/removed, loan recorded/updated/paid-off/removed, and the two report exports.
  - Metadata carries ids and changed field names. It never carries amounts, policy numbers or captions, because `audit_events` is platform-readable.
  - The `check:audit` tripwire applies to the new `actions.ts` files.

## Edge Cases the Request Didn't Mention

- **Empty states:**
  - A new presbytery with no congregations keeps the existing empty state.
  - A congregation with no record says "Nothing recorded yet" per section, each with its Add button for those who hold the key.
  - "No loans are recorded", never "No loans."
  - The Locked state for a user without the finance key.
- **Failure microcopy:** the database or network down gives a section-level "We couldn't load this. Try again." with a link, and the rest of the page stays. A failed save keeps the form's contents.
- **360px:**
  - Full-page forms, never long dialogs.
  - Card lists below `sm` and tables above (the reports pattern).
  - Money and year inputs are text with `inputMode`, not `type=number` (a number input drops pasted text).
  - A two-column photo grid, with 44px tap targets.
  - `HydrationGate` on every `useForm` root (`check:hydration-gate`).
  - No native dialogs (AlertDialog for destructive confirms).
  - The Phase 6 walk includes uploading a phone photo.
- **Expired and expiring:** an insurance record past its expiry says "Expired" in words.
- **2FA gate:** the proxy covers `/o/*`, so a mid-enrolment user is already pushed to `/totp`.
- **Roll and history:** this feature touches no roll data.

## Increments

The operator wants all of it in production now. I recommend two back-to-back increments, each its own work-log (`…-congregation-profile-inc1`, `-inc2`) under this parent, which keeps the shared Phase 1–2.

- **Increment 1 — records (0.61.0).**
  - One migration, 0089, containing every table including the photo table, so Increment 2 needs no schema.
  - The new permission key, audit actions, profile columns, buildings, appraisals, insurance years and loans.
  - The oversight list and detail rework, and the help page.
  - All Phase 6 walks.
- **Increment 2 — photos and reports (0.62.0).**
  - Photo upload, view and remove, with the client island and the `sharp` reuse rule.
  - The Buildings report and the Insurance-and-loans report, with CSV and audit.
  - A second help edit.
  - If time forces a cut, cut the reports before photos, because the operator named photos explicitly.

I did not choose a table layout, columns or a directory. Those are for the architect and tech-lead.

## Help impact

Per Workflow Rule 17, every item below needs a Phase 3 Copy row.

- **Add** a new published page, `congregation-records` ("Congregation records: profile, buildings, insurance and loans").
  - It covers `tile:oversight`, and the covering-page rule then removes that entry from `coverage-allowlist.ts`.
  - The pinned allowlist count in `coverage.test.ts` decrements in the same diff.
  - It documents the key, the Locked states, the profile-ownership rule (Flow 9), the photo steps, and what the congregation does and does not see.
  - It also walks the founding administrator giving themselves the finance key under Roles.
- **Edit** `presbytery-reports` for Increment 2: two new cards, their rows in the permission table, and a CSV note on what the exports omit. Its `labels` list gains the new strings, and `verifiedIn` moves only by the Phase 6 walk.
- **Edit** `roles-who-can-do-what` for the new key.
- **Edit** `privacy-policy`: building photos are stored privately for the presbytery's staff and never published.
- **Edit** `presbytery-tools` (planned): its `today` sentence lists what a presbytery can record. It will need "buildings, insurance and loans" added, or it becomes false.
- **Check** `why-cant-i-see-this` for any "Locked" wording.
- No `limitationUntil` sentence is known to be removed by this change.
- No `[help:<token>]` placeholder is made obsolete, because the existing token is tied to the roadmap line `presbytery-tools`.
- Screenshots come only from `npm run help:shots` against a fixture-only database, using generated images, and each is opened and checked for real data.

## Open Questions

1. **The finance key and default roles.** I recommend binding it to nothing, with the presbytery founding administrator granting it through Roles. Binding it to the founding-administrator bundle would be quicker for the demo, but it breaks "no role carries a wildcard", needs an operator ruling, and widens the migration and the Phase 6 walk. Does the operator want the bundle?
2. **After a congregation joins,** keep the presbytery's address and phone editable (my proposal) or freeze them (the alternative in Gap 1)? The default is editable.
3. **What does the prototype's "loan guarantee" column hold,** a yes/no, a percentage or a note? And what do the program loan and "mortgage grants" figures mean to the clerk? A real example from the spreadsheet, as shape only and no names, settles the loan fields before Phase 3.
4. **Who at the presbytery should hold the finance key** in practice (clerk, treasurer, property committee)? This only affects the help page's worked example.

---

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-11-17 |

## Handoff

Next agent: **architect** (Phase 2). Please rule on:

- the new permission key and its 2FA flag
- the tier-2 split, versus gating a single table
- how appraisal is housed
- the placement of the property module and its boundaries test (no `getPlatformDb`, a sole writer)
- the reports registry extension
- the single migration 0089 that includes the photo table
- DECISION-312's closed `sharp` list for building photos (which importer, and thumbnail style)
- blob size and serving
- the "former members" gap
- whether the Phase 6 walk needs the founding-administrator path if no bundle change is made

Pre-assigned numbers stay: DECISION-344+, F450+, migration 0089, port 3102.

Files read, all in the worktree `/Users/cshenso/git/presby-platform/presby-profile`:

- `docs/work-log/2026-11-17-congregation-profile.md`
- `src/lib/db/domain/presbytery.ts`
- `src/lib/db/domain/sites.ts`
- `src/lib/db/domain/org.ts`
- `src/lib/presbytery.ts`
- the oversight pages under `src/app/(org)/o/[slug]/admin/oversight/`
- `src/lib/presbytery-reports/contract.ts`
- `src/lib/person-photos/`
- `src/lib/storage/`
- `src/lib/help/registry.ts`
- `src/lib/help/coverage-allowlist.ts`
- `src/content/help/presbytery-reports.md`

Prior art, read for shapes only and with no real names carried over: `/Users/cshenso/git/psvonline-portal/src/lib/db/schema.ts`, `scripts/import-spreadsheet.ts`, `src/app/api/congregations/[id]/`, and the congregation and buildings-report pages.

---

## Orchestrator rulings on the Phase 1 open questions (2026-11-17)

The operator asked for this pipeline to run through to production without further questions ("take congregation profiles all the way to the end"), so the analyst's defaults are taken. Each one can be reversed later by a small change.

1. **Finance key and default roles:** bound to no role. The presbytery founding administrator grants it through Roles. No change to the founding-administrator bundle, and no new known violation.
2. **After a congregation joins:** the presbytery's copy stays editable and is labelled as the presbytery's copy (Flow 9).
3. **Loan guarantee:** free text. The program-loan and grants figures are optional integer-cent amounts with labels taken from the prototype. Phase 3 reads `scripts/import-spreadsheet.ts` for column shapes only.
4. **Who holds the finance key:** the help page's example names a role generically ("your treasurer or stated clerk") and does not prescribe one.

Increments: taken as recommended. Increment 1 is the records (0.61.0) and Increment 2 is photos and reports (0.62.0), shipped back to back. Each gets its own child work-log under this parent once Phase 3 is done.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.** The feature's shape is sound and nothing returns to Phase 1. One ruling (R2, DECISION-345) replaces the *mechanism* of orchestrator ruling 1. That ruling's premise is false in this codebase (F450). R2 keeps both of the ruling's stated aims: the bundle change follows an existing precedent, and the violation it adds is recorded openly in CLAUDE.md rather than hidden. Because it departs from the ruling's letter, the orchestrator must confirm R2 before Phase 3 writes the Roles help copy. Everything else below is settled.

Worktree root for every path below: `/Users/cshenso/git/presby-platform/presby-profile`.

## Placement

- **Directory placement:**
  - **Drizzle declaration:** `src/lib/db/domain/oversight.ts`, a new module file. Its line in `src/lib/db/domain/index.ts` is added by the orchestrator at integration (Rule 16).
  - **DDL:** `drizzle/0089_presby_oversight_records.sql`, one file holding all six tables, the permission row and the bundle change (R5).
  - **`src/lib/oversight/`, the new module (R4):**
    - `contract.ts`: pure, no imports. Key names, closed enumerations, limits.
    - `validate.ts`: pure. Per-form parsing. The address uses `normalizeAddress` from the pure `src/lib/site-address.ts`.
    - `copy.ts`: pure.
    - `store.ts`: `server-only`. The only writer of the five record tables.
    - `photo-store.ts`: `server-only`, Increment 2. The only writer of `oversight_building_photos`.
    - `reads.ts`: `server-only`. One reader per section.
    - `report-rows.ts`: `server-only`. Functions that take a transaction and serve the two report readers.
    - `boundaries.test.ts`.
  - **Routes** under `src/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/`:
    - `page.tsx`: the record page, reworked into sections.
    - `profile/edit/`
    - `buildings/new/`
    - `buildings/[buildingId]/`
    - `buildings/[buildingId]/edit/`
    - `buildings/[buildingId]/appraisals/new/`
    - `buildings/[buildingId]/photos/` (Increment 2)
    - `insurance/new/`
    - `insurance/[recordId]/edit/`
    - `loans/new/`
    - `loans/[loanId]/edit/`

    Each segment that mutates has a co-located `actions.ts` marked `"use server"`. Phase 3 may rename segments, but not add a `route.ts` or a `loading.tsx` anywhere under `oversight/**`.
  - **Reports:** `src/app/(org)/o/[slug]/admin/reports/buildings/` and `.../insurance-and-loans/`, each with `page.tsx` and `export/route.ts`. Readers are `src/lib/presbytery-reports/buildings.ts` and `insurance-loans.ts`. Views go in `src/components/presbytery-reports/` (R7).
  - **Photo pipeline extraction (Increment 2, R6):** moves to `src/lib/storage/image/` as `photo.ts`, `limits.ts` and `downscale.ts`.
  - **Shared view pieces** for the record page, if any, go in `src/components/oversight/`.
- **Server vs Client split:**
  - Pages, sections, cards, the photo grid and the larger photo view are all Server Components.
  - `'use client'` is only for:
    - each `useForm` root, each with `HydrationGate` (`check:hydration-gate`);
    - the AlertDialog confirms for retire and remove;
    - the Increment 2 upload island, which imports the moved `downscale.ts`.
  - No `blob:` URLs, because of the CSP (the DECISION-289 precedent).
  - Money and year inputs are text inputs with `inputMode`, never `type=number`.
  - Nothing in `src/lib/oversight/` is a client module except the pure files a form imports (`contract.ts`, `validate.ts`, `copy.ts`).
- **Dependencies:** none new.
  - `sharp` is already a direct dependency (DECISION-287).
  - Validation and CSV use existing in-repo code (`site-address.ts`, the reports' `csv.ts` text guard and `csvIntegerCell`).
  - No geocoder, no upload library, no date library.

## Invariants Touched

- **Isolation Is a Database Property.**
  - All six tables are `FORCE ROW LEVEL SECURITY` with the standard `tenant_isolation` policy, and `organization_id` is the presbytery.
  - The key is checked inside each reader's and writer's own `withOrgContext` transaction with `holdsPermissions` from `src/lib/org-portal/permission-check.ts`. Do not write a third private `hasPermission` copy (DECISION-338's convergence follow-up).
  - RLS stays tenancy-only. No permission predicate goes in a policy.
  - The test-rls suite must also pin that a congregation-context session (managed congregation, its administrator) reads zero rows from all six tables.
- **Composite Tenant Keys.**
  - Every table declares `unique (id, organization_id)`.
  - `oversight_buildings` also declares `unique (id, organization_id, about_org_id)`.
  - Photos, appraisals and the optional building link on loans reference that triple. This makes "a child's congregation equals its building's congregation" a database property, not a trigger and not application code (Gap 12).
  - `about_org_id` is a plain FK to `organizations` under the section-17 structural exception, as on `congregation_oversight`.
- **Never Hard-Delete / all deletes are soft.**
  - `presby_app` gets no DELETE on any of the six tables, and `presby_platform` gets nothing.
  - Removal is a `removed_at`/`removed_by` pair with a CHECK. A BEFORE UPDATE guard, binding every connection, refuses any change to a removed row, so removal is one-way.
  - A building's Retire is a status (`retired_on`, a closed `retired_reason`), not a removal, and Phase 3 may make it reversible.
- **Permissions vs Flags.**
  - No new flag.
  - The surface rides `org_portal.oversight`, and the reports ride `org_portal.reports`, both read with bare `isFlagEnabled`.
  - The new key is a tenant permission in the `permissions` table, checked through `presby_has_permission`. It is **never** mapped into `FEATURES.*`. `src/lib/permissions.ts` is frozen and platform-only, and the analyst's "FEATURE mapping" has no counterpart for tenant keys.
- **No Role Carries a Wildcard (changed: requires a CLAUDE.md update).** R2 puts a tier-2 key in the presbytery founding-administrator bundle. That is a third known violation (`paper`) alongside `ADMIN_ROLE` and `careers.applicants`. Draft text is in R2.
- **Two Hierarchies Intersect Nowhere.**
  - Nothing reads across councils.
  - The congregation sees nothing.
  - Publishing upward is a later pipeline.
  - The key is *not* barred from the commission and delegation arms. A synod's administrative commission over a presbytery is constitutional, and DECISION-175's guard exists for per-member giving privacy, which this is not.
  - No platform path confers the key: it arrives only through the sanctioned designation function. This is why an operator data-fix bootstrap was rejected (R2).
- **Extensibility Goes Through Support.** Building type, condition, yes/no/not recorded, retire reason, loan kind and provenance are closed CHECK lists. There are no tenant-defined values.
- **The Brand Is a Cascade Override.** No new route group, and `check:brand-scope` is unchanged.
- **The Proxy Does Not Reach the Database / A Custom Host Is a Key.** Untouched: no public path, no proxy edit.
- **No Real Data.**
  - Fixtures and help screenshots use generated images and invented names.
  - Any committed import helper is generic and reads its input from outside the repository, or lives under gitignored `scratch/`. No spreadsheet row, name or sample value is committed.
- **Verify in a Browser.** Phase 6 includes a real phone-photo upload on a deployed environment (Increment 2) and the 360px walk of every form.
- **`docs/architecture.md`:** line 25 already describes "the presbytery's own judgment about a member congregation's viability and property". No change is needed. Phase 6 may decide otherwise under Rule 15.

## Notes

### Rulings on the Phase 1 handoff list

**R1. Table-granular tiering (Gap 5 and the tier split). DECISION-344.**
- Each table is read and written under exactly one key. A tier-2 fact never shares a row with a tier-1 fact.
- Tier 1 (`congregation_oversight.manage`):
  - `oversight_profiles`
  - `oversight_buildings`
  - `oversight_building_photos`
- Tier 2 (the new key):
  - `oversight_building_appraisals`
  - `oversight_insurance_years`
  - `oversight_loans`
- **Appraisal housing:** the analyst's dated per-building appraisal table is accepted. The column fallback is rejected. A column-level tier gate on a tier-1 table would make every tier-1 writer responsible for not nulling a field it cannot see, which is the F451 hazard below.
- **Profile** is its own table, not new columns on `congregation_oversight`:
  - that table's writer is a full-row upsert;
  - it carries `presby_app` DELETE;
  - the profile has its own audit action and provenance.
- One live row per `(organization_id, about_org_id)`.

**R2. The finance key. DECISION-345. Replaces the mechanism of orchestrator ruling 1; F450.**
- **Settled attributes:**
  - name `congregation_oversight.finance`, module `presbytery`, `sensitivity_tier = 2`, `requires_two_factor = true`;
  - description: "See and record a member congregation's appraisals, insurance and loans (the presbytery's own record)".
- **Why that name:** `congregation_finance.manage` would sit in the Roles catalog shown to congregations and read as their own giving or treasury. A non-verb suffix has precedent in `careers.applicants`.
- **Reports registry phrase:** "manage congregation property finances".
- **F450:** a key bound to no role is held by no one and can never be granted in-product.
  - `assertPermissionSubset()` (`src/lib/authz.ts:197`) runs on `createRole`, `adoptTemplate`, `setRolePermissions` (the added keys) and `grantRole` (`src/lib/role-grants.ts:521`).
  - So the founding administrator cannot "give themselves the key in two steps under Roles", and the help walk would be false.
  - The repo already hit this twice: F150 (`domains.manage`) and F292 (careers), commented in `src/lib/onboarding/founding-administrator.ts`. F362 (`docs/TODO.md:161`) is the same defect.
- **Ruling (option A):**
  - Add the key to the **presbytery arm** of `presby_founding_administrator_permission_keys`, after `congregation_oversight.manage`.
  - Backfill every org-owned `founding_administrator` role at a presbytery (the 0057/0071 idiom, with an apply-time notice count).
  - Update the TypeScript mirror `foundingAdministratorPlan()`, `designation-parity.golden.json` and the `invitations.db.test.ts` parity pin.
  - Keep the 0085 base-key text byte-for-byte (test-rls 71b greps it).
  - The founding administrator then delegates the key, for example to the treasurer or stated clerk, through a custom role. The subset check passes because they now hold it.
- **CLAUDE.md, Key Invariants → No Role Carries a Wildcard, third known violation (draft):**

  > *Third known violation:* the presbytery founding-administrator bundle carries `congregation_oversight.finance`, a tier-2 key (DECISION-345; the F150/F292 reason: under `assertPermissionSubset()` a key nobody at an organization holds can never be granted). The founding administrator of a presbytery can read the presbytery's appraisal, insurance and loan records for its congregations. Every write is audited; reads are not. `paper`.
- **Rejected alternatives:**
  - **B, the `presbytery_stated_clerk` template plus a backfill of org-owned clerk roles.** It delivers the same holder through a less visible door, and it contradicts DECISION-119's own finding that buildings and insurance fail DECISION-078's test for the clerk.
  - **C, no binding plus an operator SQL grant at deploy.** That is a platform-position grant of tenant authority with no sanctioned path, against Two Hierarchies, and every future presbytery would need another one.
- **2FA consequence:** a presbytery founding administrator already holds the flagged `roles.manage` (0080), so the backfill strands nobody.
  - Run the read-only "newly required, not enrolled" count on deploy day (the 0080 R8 precedent) and record only the number.
  - Restate the `presby_two_factor_required` and `permissions.requires_two_factor` comments, which enumerate the flagged keys.
- **Rule 16:** F362 also redefines this function. Whichever migration lands second must carry both bodies. The orchestrator owns the ordering.
- **Phase 6 walk** (answers the analyst's last handoff item): yes, the founding-administrator path is required.
  1. A fixture presbytery founder, designated through the real function, sees the finance sections.
  2. They create a custom role carrying the key and grant it to a second person.
  3. That person is forced into 2FA enrolment, then sees the finance sections and the Locked tier-1 sections.
  4. A holder of `oversight.manage` only sees Locked finance sections.

**R3. Who can open the record (Gap 3), the gate, and two defects in the shipped pages. Part of DECISION-347; F452.**
- The shipped oversight pages:
  - skip the Node-side second-factor recheck (`assertOrgSession`), which matters once a key with `requires_two_factor` is on the page;
  - send a non-UUID `aboutOrgId` into Postgres, so it renders a load error instead of a 404 (the F446 precedent).
- **The gate:** add a third named export, `gateOversightPage`, over `gatePresbyteryPage` in `src/lib/presbytery-reports/gate.ts`.
  - The closed flag union grows to `REPORTS_FLAG | INSIGHTS_FLAG | OVERSIGHT_FLAG` (the DECISION-342 pattern).
  - Every oversight page, old and new, calls it.
  - Moving the gate to `src/lib/org-portal/` is deferred until a fourth consumer appears.
- **Actions:** every `actions.ts` calls `assertOrgSession` before `resolveOrgContext`.
- **404s:** every id segment is parsed as a UUID and 404s before any read. A building, appraisal, insurance, loan or photo id resolves only under `(organization_id, about_org_id)`, and a miss reads identically to a nonexistent id.
- **Front door:**
  - The list and the record page open for a holder of **either** key. Holding neither gives `OversightForbidden`.
  - Each section reads under its own key in its own transaction (DECISION-342's one transaction per card), so a failing section shows its own load error and the rest of the page stays up.
  - The list shows building count only with the tier-1 key and the soonest expiry only with the finance key. The carrier never renders without the finance key.
- **Roster for the record surface:** keep `resolveMemberCongregation` (`parent_id` plus type `congregation`). Export it from `src/lib/presbytery.ts` rather than writing a third copy.

**R4. The module and its boundaries test. DECISION-344.**
- `src/lib/presbytery.ts` (1,378 lines, a complexity hotspot) gets no new tables and keeps only the legacy `congregation_oversight` row.
- The six table names (SQL and Drizzle identifiers) may appear only in:
  - `src/lib/oversight/store.ts`
  - `photo-store.ts`
  - `reads.ts`
  - `report-rows.ts`
  - `src/lib/db/domain/oversight.ts`
  - `src/lib/dev-docs.ts` (the classification, which is required; `npm run docs:erd` regenerates the diagrams)
- **Writers:** `store.ts` writes five tables and `photo-store.ts` writes one. In Increment 1, nothing writes the photo table.
- **Audit:** every write audits in its own transaction with `insertAuditRow` (the person-photos and reports pattern). Metadata is ids and changed field names only, never amounts, policy numbers, captions or notes.
- **`boundaries.test.ts` pins:**
  - no owner connection (`getPlatformDb`, `PLATFORM_DATABASE_URL`, `MIGRATE_DATABASE_URL`) in the module or under `oversight/**` (the `check:treasury-boundaries` T1 org-tree rule covers the routes too);
  - the table-name and writer lists above;
  - no `recordAudit` in the module;
  - no `route.ts` and no `loading.tsx` under `oversight/**`;
  - every page calls `gateOversightPage`;
  - every action calls `assertOrgSession`;
  - no `callbackUrl` or `next` is read;
  - no `sharp` import;
  - `getBlobStore().store(` appears only in `photo-store.ts`, with the literal `audience: "private"`.
- `src/lib/storage/audience-callsites.test.ts` gains a FORWARD row for `photo-store.ts` in Increment 1 and an ACTIVE row in Increment 2.
- **`check:audit` blind spot:** follow the person-photos precedent (DB tests stand in) and say so in Phase 3.

**R5. Migration 0089. DECISION-344.**
- **Guard:** refuse to run without `blob_assets_id_org_audience_key` (0072), as 0078 does. Independent of 0088 (Learn 1b). Journal ordering is the orchestrator's at integration.
- **Tables:**
  - `oversight_profiles`
  - `oversight_buildings`
  - `oversight_building_photos`
  - `oversight_building_appraisals`
  - `oversight_insurance_years`
  - `oversight_loans`
- **Columns on each table:**
  - `organization_id` (the presbytery, `on delete cascade`);
  - `about_org_id`, except where the composite FK supplies it, though children carry it too for reporting;
  - `provenance in ('presbytery_entered','imported')`, on all but photos (`congregation_statistics` vocabulary);
  - `created_at`/`created_by`, `updated_at`/`updated_by` referencing `users`;
  - the removal pair, on all but profiles.
- **Money:** `bigint` integer cents with `CHECK (x is null or x between 0 and <max>)`. Phase 3 sets the maximum.
- **Years:** `CHECK between 1600 and 2100`. The "not after this year" bound and "an addition year is not before the build year" are application rules, with the second also a row CHECK.
- **Every money and year column is nullable** (Flow 10).
- **Photos:**
  - `asset_audience = 'private'` CHECK;
  - `(image_asset_key, organization_id, asset_audience)` and the thumbnail equivalent both FK to `blob_assets (id, organization_id, audience)`;
  - distinct-assets and dimension CHECKs.
- **Partial unique indexes (live means `removed_at is null`):**
  - `oversight_buildings`: the live name `(organization_id, about_org_id, lower(name))`, and at most one live primary per congregation;
  - `oversight_insurance_years`: the live `(organization_id, about_org_id, policy_year)`;
  - `oversight_building_photos`: the live image per building, and one live cover per building;
  - `oversight_profiles`: plain `unique (organization_id, about_org_id)`.
- **Triggers:**
  - the about-org check `presby_check_about_org_affiliated('about_org_id', '')` on profiles, buildings, insurance years and loans. The empty second argument means as of the current date, which is the present-tense question 0045's header assigns to oversight;
  - no about-org trigger on children, because the composite FK pins them to a building that was already checked;
  - one shared removal-is-final guard on all five tables that have the removal pair.
- **RLS and grants:**
  - `enable` plus `force`, and `tenant_isolation` with USING and WITH CHECK;
  - `presby_app`: SELECT, INSERT, UPDATE. On photos, UPDATE is column-limited to caption, cover and the removal pair (the person-photos precedent);
  - no DELETE; nothing for `presby_platform`.
- **Also in 0089:**
  - the permission row (`on conflict do update`, the 0074/0085 idiom);
  - the bundle redefinition and backfill (R2);
  - comment-only restatements on `congregation_oversight.insurance_carrier`/`insurance_expires_on` marking them superseded (R8).
- **Process:** idempotent, applied twice as proof. Unreleased until production, so it may be corrected in place until then.
- **`scripts/test-rls.sql`, or `scripts/oversight/test-rls-89.sql` (the worship precedent):**
  - FORCE on all six, read from `pg_class`;
  - no DELETE for `presby_app` and nothing for `presby_platform`, read with `aclexplode`;
  - a cross-presbytery read returns zero rows and a cross-presbytery write is rejected;
  - a congregation context reads zero rows;
  - a child pointing at another congregation's building is rejected by the FK;
  - an insert about a never-affiliated organization is rejected;
  - removal is one-way;
  - each partial unique index holds;
  - `presby_public_site_asset()` returns nothing for a building-photo key.
- **`scripts/seed-dev.sql`:**
  - fixture rows for the two Northern Reach congregations, plus a Western Basin row for the cross-presbytery checks;
  - a fixture grant of the finance key;
  - generated solid-colour image bytes for the photo rows.
- Both test-rls and seed-dev are Rule 16 shared files.

**R6. Building photos and DECISION-312. DECISION-346.**
- DECISION-312's revisit clause says a third consumer of `sharp` triggers extraction into `src/lib/storage/image/`. This Phase 2 is that extraction's Phase 2.
- **Increment 2 opens with a `refactor:` commit:**
  - `src/lib/person-photos/image.ts` moves to `src/lib/storage/image/photo.ts`;
  - the image constants and `ImageRefusal` move to `src/lib/storage/image/limits.ts`;
  - the client `downscale.ts` moves from the person-photos route directory to `src/lib/storage/image/downscale.ts`;
  - `image.test.ts` and `downscale.test.ts` move with them unchanged;
  - `PHOTO_CAP_PER_PERSON` stays in `src/lib/person-photos/limits.ts`;
  - `processPhoto` gains a **required** `{ thumbnail: "top" | "centre" }`. Person photos pass `"top"`, so their output does not change by a byte.
- **The closed list stays at two files:** `src/lib/storage/image/photo.ts` and `src/lib/storage/image-sanitize.ts`.
  - Update `SHARP_FILES` in `scripts/check-treasury-boundaries.mjs`, `image-sanitize.test.ts` and `person-photos/scan.test.ts` in the same commit.
  - CLAUDE.md's `person-photos/` layout line changes, and it gains a `storage/image/` line.
- **Building photos use the same caps and refusal order as person photos:**
  - checked before decoding: 1,000,000-byte upload limit, sniff, APNG check, header check, 16 MP and 6,000 px;
  - then always re-encoded, with no metadata kept;
  - master: long edge 1,200 px, at most 400,000 bytes;
  - thumbnail: a 160 px square WebP with a **centred** cover crop.
- **Limits:** 10 live photos per building. The cap is counted after locking the building row (`for update`), so two concurrent uploads cannot pass it.
- **Upload:**
  - a Server Action at the 1 MB default with a mandatory client downscale (DECISION-288);
  - authorization, flag, type, building resolution and the cap all run before any decode;
  - `audience: "private"`, with `organization_id` the presbytery.
- **Serving:** inline `data:` URIs.
  - Thumbnails in the grid; covers on the record page, one per building.
  - The master is shown one at a time via `?view=<photoId>`, honoured only for a live photo of this building.
  - No authenticated route (DECISION-040, the DECISION-287/289 precedent). Revisit if a page passes about 500 KB of thumbnails.
- **Accepted residuals, carried forward:**
  - an orphaned blob when the final transaction fails;
  - `bytea` growth, worst case about 4 MB per building at the cap.

**R7. Reports registry. DECISION-348.**
- `REPORT_KEYS` gains two entries in `src/lib/presbytery-reports/contract.ts`:
  - `buildings`: segment `buildings`, permission `congregation_oversight.manage`, phrase "manage congregation oversight";
  - `insurance_and_loans`: segment `insurance-and-loans`, permission `congregation_oversight.finance`.
- **Readers** follow DECISION-337/339:
  - one transaction serves the page and the export;
  - the key is checked inside it;
  - rows come from `src/lib/oversight/report-rows.ts`, so table names stay in the module;
  - the CSV is built and `auditReportExport` writes in that same transaction.
- **Test updates:** the metadata carries no year fields (the viability precedent). In `boundaries.test.ts`, "no export function beyond the four" becomes six, and the "child directories equal registry segments" test stays true.
- **Roster:** the reports use `roster.ts`, active lifecycle only. State that in the copy.
- **CSV:**
  - omits street address, policy number and every free-text note;
  - carrier, lender and guarantee go through the text guard;
  - cents go through `csvIntegerCell`.
- **Hub:** `hub.ts` gains the two cards.
- **No dashboard card** in this pipeline.

**R8. The superseded oversight-row fields (Gap 4). DECISION-347; F451.**
- **F451:** `setCongregationOversight` (`src/lib/presbytery.ts:554-571`) writes every column as `input.x ?? null` on upsert. The first save after the form stops sending carrier and expiry would silently null production values.
- **Ruling:**
  - remove `insuranceCarrier` and `insuranceExpiresOn` from `SetOversightInput`, from the `values` object, and from `OversightRow` and both tier-1 readers;
  - add a test that the tier-1 readers select neither column;
  - `buildings_notes` stays written, relabelled "Property notes";
  - the columns stay dormant: no drop, comment-only restatement in 0089;
  - the shipped `readers.db.test.ts` pin (the viability reader reads no building or insurance data) survives.
- **Legacy values:**
  - Phase 3 has the orchestrator count non-null carrier and expiry values in production, read-only, recording only the number.
  - If the count is not zero, the operator's import session converts them into `oversight_insurance_years` as `imported`. Never in 0089, which must not depend on data.
  - Until then they are visible to nobody, and the copy must not claim otherwise.

**R9. Former members (Gap 9). F453; a `docs/TODO.md` line at integration.**
- The record surface keeps the `parent_id` roster with no lifecycle filter. A closed congregation still under the presbytery stays reachable, loans included.
- A congregation that **departed** (its `parent_id` moved) becomes unreachable in the UI. Its rows stay intact and readable under RLS.
- At the database level, the about-org trigger refuses new top-level rows for a departed congregation and allows edits that don't move `about_org_id`.
- Accepted for v1. A "former members" view is the tracked follow-up.

**R10. Smaller items for Phase 3.**
- Optimistic `updated_at` check on insurance and loan edits: recommended. Deferring it must name last-write-wins as a residual.
- No commission or delegation guard on the key (see Invariants).
- The `presby_app` DELETE grant on `congregation_oversight` stays with the monthly security review (DECISION-343), untouched here.

### Proposed decisions (for the orchestrator to record)

**DECISION-344 — Congregation records are the presbytery's own `oversight_*` tables: one table, one key, children pinned to their building's congregation by composite key, soft removal only, one module with named writers.**
**Status:** Proposed (architect Phase 2) · **Date:** 2026-11-17 · **Feature:** `2026-11-17-congregation-profile`

- **Tables.** Profile, buildings, building photos, appraisals, insurance years and loans are six tables in migration 0089.
  - `organization_id` is the presbytery. They are never the congregation's own record (DECISION-119/120).
  - They are tiered by table, never by column:
    - tier 1, `congregation_oversight.manage`: profile, buildings, photos;
    - tier 2, `congregation_oversight.finance`: appraisals, insurance years, loans.
  - The profile is its own table, not columns on `congregation_oversight`, whose writer is a full-row upsert.
- **Keys.** Every table declares `unique (id, organization_id)`. Buildings also declare `unique (id, organization_id, about_org_id)`, which photos, appraisals and a loan's optional building reference. A child cannot name another congregation's building.
- **About-org trigger.** Top-level tables carry the 0045 trigger as of the current date.
- **Grants and removal.**
  - `presby_app` holds SELECT, INSERT and UPDATE (column-limited on photos), never DELETE. `presby_platform` holds nothing.
  - Removal is a one-way `removed_at`/`removed_by` pair guarded on every connection.
- **Values.**
  - Money is `bigint` integer cents with range CHECKs.
  - Every fact column is nullable for the one-time import.
  - `provenance` is `presbytery_entered` or `imported`.
- **Module.** `src/lib/oversight/` owns the tables.
  - `store.ts` is the only writer of five tables and `photo-store.ts` of the sixth.
  - Reads are `reads.ts` and `report-rows.ts`.
  - Audit is in-transaction via `insertAuditRow`.
  - `boundaries.test.ts` pins the name list, the writers, the absence of an owner connection, the absence of a route handler and a `loading.tsx` under the oversight tree, and the private blob audience.
  - `src/lib/presbytery.ts` names none of the new tables.
- **Revisit if** a congregation-owned property record arrives (that is a separate, congregation-owned table with publication upward), or a second policy per year is needed.

**DECISION-345 — `congregation_oversight.finance` (tier 2, two-factor) reaches a presbytery through its founding-administrator bundle. Supersedes the mechanism of orchestrator ruling 1 (F450).**
**Status:** Proposed (architect Phase 2; the orchestrator to confirm) · **Date:** 2026-11-17 · **Feature:** `2026-11-17-congregation-profile`

- **The defect.** `assertPermissionSubset()` runs on role creation, template adoption, role edits and grants, so a key no one at an organization holds can never be granted there (F450; the F150/F292 precedent, and the open F362).
- **The key.** Module `presbytery`, tier 2, `requires_two_factor = true`. It covers appraisals, insurance years and loans and their report and export.
- **How it reaches a presbytery.** It joins the presbytery arm of `presby_founding_administrator_permission_keys`.
  - Existing presbytery `founding_administrator` roles are backfilled, with an apply-time count.
  - The TypeScript mirror, the parity golden and the parity test move with it.
  - The founding administrator delegates it through a custom role.
- **Rejected.**
  - The `presbytery_stated_clerk` template: DECISION-119 found that buildings and insurance fail DECISION-078's test for the clerk.
  - An operator SQL grant: platform-position authority with no sanctioned path, against Two Hierarchies.
- **Commission and delegation.** Not barred from those arms; DECISION-175's reason is per-member giving privacy.
- **Known violation.** CLAUDE.md records it under No Role Carries a Wildcard (`paper`; writes audited, reads not).
- **Coordination.** F362 redefines the same function. The second migration to land carries both bodies.

**DECISION-346 — Building photos use the person-photo refusal order through an extracted `src/lib/storage/image/` (DECISION-312's revisit clause); the `sharp` list stays at two files.**
**Status:** Proposed (architect Phase 2) · **Date:** 2026-11-17 · **Feature:** `2026-11-17-congregation-profile` (Increment 2)

- **The extraction.** A `refactor:` commit moves `person-photos/image.ts` to `storage/image/photo.ts`, the image limits and `ImageRefusal` to `storage/image/limits.ts`, and the client `downscale.ts` to `storage/image/downscale.ts`.
  - `processPhoto` takes a required thumbnail gravity: `top` for people, `centre` for buildings.
  - Person-photo output is unchanged byte for byte, and the moved tests pass unchanged.
- **The closed list.** `SHARP_FILES` becomes `src/lib/storage/image/photo.ts` and `src/lib/storage/image-sanitize.ts`, updated in all three places that assert it.
- **Building photos.**
  - Identical caps: 1,000,000-byte upload, 16 MP, 6,000 px, master 1,200 px and 400,000 bytes, 160 px WebP thumbnail.
  - 10 live per building, counted under a row lock.
  - Private audience, with `organization_id` the presbytery.
  - A Server Action at 1 MB with a mandatory client downscale, and every check before decoding.
  - Served as inline `data:` URIs: thumbnails, plus one master via `?view=`. No route.
- **Residuals.** Orphaned blobs on a failed final transaction, and `bytea` growth.
- **Revisit if** a consumer needs a different refusal order. That would be a third importer, and its own Phase 2.

**DECISION-347 — Oversight pages pass the presbytery gate; either key opens the record; each section reads under its own key; the superseded row fields go dormant and stop being written.**
**Status:** Proposed (architect Phase 2) · **Date:** 2026-11-17 · **Feature:** `2026-11-17-congregation-profile`

- **The gate.**
  - `gateOversightPage` is a third named export over `gatePresbyteryPage`, with the flag union `REPORTS_FLAG | INSIGHTS_FLAG | OVERSIGHT_FLAG`.
  - Every oversight page calls it, which adds the Node-side second-factor recheck the shipped pages lacked (F452).
  - Every oversight action calls `assertOrgSession` and checks keys with `holdsPermissions`.
  - Every id segment 404s on a non-UUID before any read, and every child id resolves only under its congregation and presbytery.
- **Access.**
  - A holder of either key opens the list and the record; neither key gives the forbidden state.
  - Each section is a separate reader with its own key check and transaction; a locked section is denied in that transaction, not just hidden.
- **The superseded fields.**
  - `insurance_carrier` and `insurance_expires_on` on `congregation_oversight` are no longer read or written by any reader or writer. Writing them as `?? null` would have erased production values (F451).
  - The columns stay, and any legacy values convert only in the operator's import session.
  - `buildings_notes` continues as "Property notes".

**DECISION-348 — Two presbytery reports join the registry: Buildings (`congregation_oversight.manage`) and Insurance and loans (`congregation_oversight.finance`).**
**Status:** Proposed (architect Phase 2) · **Date:** 2026-11-17 · **Feature:** `2026-11-17-congregation-profile` (Increment 2)

- **Shape.** Registry entries, segments `buildings` and `insurance-and-loans`, and readers in `src/lib/presbytery-reports/`, following DECISION-337/339 unchanged:
  - one transaction serves the page and the export;
  - the key is checked live inside it;
  - the CSV and the audit row are produced in that transaction.
- **Rows** come from `src/lib/oversight/report-rows.ts`.
- **Roster.** Active-lifecycle members only (`roster.ts`).
- **Exports** omit street addresses, policy numbers and free-text notes. Text goes through the formula guard and cents through `csvIntegerCell`.
- **No dashboard card.**

### Findings (pre-assigned F-numbers)

- **F450:** a key bound to no role is ungrantable under `assertPermissionSubset()`. Orchestrator ruling 1 as written would ship a finance half nobody can reach, and a false help walk. Resolved by DECISION-345.
- **F451:** `setCongregationOversight`'s full-row upsert would null `insurance_carrier`/`insurance_expires_on` on the first save after the form drops them. Resolved by DECISION-347.
- **F452:** the shipped oversight list and detail pages skip the Node-side second-factor recheck, and a non-UUID `aboutOrgId` renders a load error instead of a 404. Resolved by DECISION-347.
- **F453:** a departed congregation's records, including outstanding loans, become unreachable in the UI while staying in the tables. Accepted for v1 and tracked.

### Integration-time documentation (Rule 16 and the orchestrator)

- **CLAUDE.md:**
  - the third known violation (R2);
  - Project Layout lines for `src/lib/oversight/` and `src/lib/storage/image/`;
  - the `person-photos/` line changes once `image.ts` moves (Increment 2).
- **Shared files:** `src/lib/db/domain/index.ts`, `drizzle/meta/_journal.json`, `scripts/test-rls.sql`, `scripts/seed-dev.sql`, `docs/decisions.md`, `docs/TODO.md` (F453's line).

---

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete (R1–R10; DECISION-344–348 proposed; F450–F453; one migration 0089; R2 needs the orchestrator to confirm it replaces ruling 1's mechanism) | Approved with suggestions | 2026-11-17 |

## Handoff

Next agent: **tech-lead** (Phase 3). This can start once the orchestrator confirms DECISION-345, or rules option B instead; the Roles help copy and the bundle section of 0089 depend on it.

Phase 3 must carry R1–R10 into its Carry-forward table, including:
- the production count of legacy carrier and expiry values (R8);
- the deploy-day count of people newly required to use 2FA (R2);
- the F362 function-body coordination (R2);
- the optimistic-concurrency decision (R10).

Increment 1 holds R1–R5, R8 and R9. Increment 2 opens with R6's refactor commit, then photos, then R7.

Key files read:
- /Users/cshenso/git/presby-platform/presby-profile/docs/work-log/2026-11-17-congregation-profile.md
- /Users/cshenso/git/presby-platform/presby-profile/src/lib/authz.ts (`assertPermissionSubset`, line 197)
- /Users/cshenso/git/presby-platform/presby-profile/src/lib/role-grants.ts (line 521)
- /Users/cshenso/git/presby-platform/presby-profile/src/lib/role-definitions.ts
- /Users/cshenso/git/presby-platform/presby-profile/src/lib/onboarding/founding-administrator.ts
- /Users/cshenso/git/presby-platform/presby-profile/src/lib/presbytery.ts (lines 554-571)
- /Users/cshenso/git/presby-platform/presby-profile/src/app/(org)/o/[slug]/admin/oversight/page.tsx
- /Users/cshenso/git/presby-platform/presby-profile/src/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/page.tsx
- /Users/cshenso/git/presby-platform/presby-profile/src/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/actions.ts
- /Users/cshenso/git/presby-platform/presby-profile/src/lib/presbytery-reports/contract.ts
- /Users/cshenso/git/presby-platform/presby-profile/src/lib/presbytery-reports/gate.ts
- /Users/cshenso/git/presby-platform/presby-profile/src/lib/person-photos/image.ts
- /Users/cshenso/git/presby-platform/presby-profile/src/lib/person-photos/limits.ts
- /Users/cshenso/git/presby-platform/presby-profile/src/lib/person-photos/scan.test.ts
- /Users/cshenso/git/presby-platform/presby-profile/src/lib/storage/audience-callsites.test.ts
- /Users/cshenso/git/presby-platform/presby-profile/scripts/check-treasury-boundaries.mjs
- /Users/cshenso/git/presby-platform/presby-profile/drizzle/0038_presby_presbytery_program.sql
- /Users/cshenso/git/presby-platform/presby-profile/drizzle/0045_presby_about_org_affiliation.sql
- /Users/cshenso/git/presby-platform/presby-profile/drizzle/0055_presby_giving.sql
- /Users/cshenso/git/presby-platform/presby-profile/drizzle/0059_presby_account_invitations.sql
- /Users/cshenso/git/presby-platform/presby-profile/drizzle/0078_presby_person_photos.sql
- /Users/cshenso/git/presby-platform/presby-profile/drizzle/0080_presby_two_factor_default.sql
- /Users/cshenso/git/presby-platform/presby-profile/drizzle/0085_presby_worship.sql
- /Users/cshenso/git/presby-platform/presby-profile/docs/decisions.md (DECISION-119, 270, 285 to 289, 312, 337 to 343)
- /Users/cshenso/git/presby-platform/presby-profile/docs/TODO.md (line 161, F362)

---

## Orchestrator ruling on R2 / DECISION-345 (2026-11-17)

**Confirmed: option A.** F450 is correct. A key that nobody at an organization holds cannot be granted under `assertPermissionSubset()`, so orchestrator ruling 1 ("bound to no role") would ship a finance half that nobody can reach, together with a false help walk. `congregation_oversight.finance` therefore joins the presbytery arm of the founding-administrator bundle, with a backfill. CLAUDE.md records it as the third known violation, using the architect's draft text. This follows the F150 (`domains.manage`) and F292 (careers) precedent. The operator is told plainly in the completion report and can reverse it before the release merges (option B, the stated-clerk template, is the documented alternative). Ruling 1 is superseded in mechanism only: its aim that the founding administrator decides who else holds the key still holds.

---

# Phase 3 — Technical Design (tech-lead)

*Written 2026-11-17 in `/Users/cshenso/git/presby-platform/presby-profile` (branch `pipeline/congregation-profile`, main at `dfb4e0c2`, 0.60.0). The design lives once, here. The two increments' implementation records live in the child logs (see "Children"). Every claim about the live tree below was read from it on 2026-11-17; the feasibility results are in "Feasibility check".*

## Summary

On a presbytery's Congregation Oversight record for each member congregation, staff keep the presbytery's own copy of five things: a **profile** (address, city, county, year organized, phone), the **assessment** that already exists (viability, redevelopment notes, property notes, map location), **buildings** (basics, condition, safety systems, notes, and later photos), and, behind a new tier-2 key `congregation_oversight.finance`, **appraisals** (dated, per building), **insurance by year** and **loans**. Everything is the presbytery's own record under the presbytery's organization id, so the congregation sees none of it. One hand-written migration, **0089**, creates all six tables, the permission, the founding-administrator bundle change and its backfill. Increment 1 (0.61.0) ships the records, the reworked list and record pages, the help page and the role/help edits. Increment 2 (0.62.0) ships building photos (with the `sharp` extraction the architect required) and two reports with CSV. All new code lives in `src/lib/oversight/` and `src/app/(org)/o/[slug]/admin/oversight/`, reads and writes through `withOrgContext` on the RLS-enforced connection, audits every write in its own transaction, and adds no flag, no dependency and no route handler under the oversight tree.

## Design rulings made in this phase

Each refines an architect ruling or settles something Phases 1 and 2 left to Phase 3. DECISION numbers are proposed for the orchestrator to record (pre-assigned 344 to 352; 349 to 351 used here, 352 held).

| # | Ruling | Why | Reversal cost |
|---|---|---|---|
| T1 | **Assessment gets its own route.** The existing form (viability, redevelopment notes, property notes, map location) moves from `oversight/[aboutOrgId]/` to `oversight/[aboutOrgId]/assessment/edit/` (`git mv`, element ids unchanged). The record page at `[aboutOrgId]` becomes the sections page. | Five sections cannot share one page with a 14-field form at 360px; every other section has a full-page form already (Phase 1). | Low. Costs the e2e URL edits listed in "E2E blast radius". |
| T2 | **Closed lists, tri-state booleans.** Conditions are `good`/`fair`/`poor` (nullable = not recorded). Yes/No/Not recorded is a nullable `boolean` (null = not recorded), not a three-value text. The prototype's free-text condition ("2018 remodel") has no column: the operator's import session copies any such text into the building's `notes` (Import contract, below). | R5 asks closed lists; a nullable boolean is the closed tri-state with no third string to drift. | Medium (a column type change before release is an in-place edit). |
| T3 | **Identity columns are NOT NULL; every other fact is nullable.** Appraisal: `assessed_year` and `amount_cents` (an appraisal with neither is no record). Insurance: `policy_year`. Loan: `kind` and `status`. This narrows R5's "every money and year column is nullable" by exactly those four. | The import has the year for each value (the prototype keys insurance by year, and the appraisal rides on that row). | Low. |
| T4 | **Appraisals are never edited.** Record and remove only. A wrong amount is removed and re-recorded. | Keeps one audited fact per row and the key split clean; the duplicate-year message says how. | Low (an update action and key). |
| T5 | **Optimistic concurrency by `row_version`.** An integer column on the four editable tables (profile, buildings, insurance years, loans), checked in the UPDATE's WHERE. Not `updated_at` (JavaScript Dates carry milliseconds, Postgres microseconds, so a round trip cannot be compared). Settles R10 as "build it", for all four, not only the money tables. | Last-write-wins on a tier-2 amount is the worst case; one helper covers all four. | Low. |
| T6 | **Retire and loan paid-off are reversible edits, not new states.** "Bring back into use" clears `retired_on`/`retired_reason` (audited as `building.updated`, changed `retired`). A paid-off loan has "Reopen" (status back to open, date cleared, balance left at its recorded $0 until edited; audited as `loan.updated`, changed `status`). Removal stays one-way. | A mis-click on Retire or Mark paid off is likely; Remove is for mistaken entry. | Low. |
| T7 | **The list and the record front door open for either key; what a section shows follows its own key.** In the list, a column a viewer's keys do not cover is *hidden* with one explanatory note above the table (a table cell reading "Locked" repeated per row is noise). On the record page a section a viewer's keys do not cover renders as a visible **Locked** card, never hidden (the reports hub pattern). City and county are profile data, so tier 1: a finance-only holder sees names, the insurance column and nothing else on the list. | Phase 1 Gap 3 said the list shows city and county to either key; the tier matrix says profile is tier 1. The matrix wins (R1: a tier-2 holder is not a tier-1 reader). | Low. |
| T8 | **The list's insurance column is the newest policy year's expiry** (highest `policy_year` among live rows), not "soonest of all years". | One true source per cell; "soonest" over history would show an old policy's date. | Low. |
| T9 | **No loan-to-building link in the UI.** The column `oversight_loans.building_id` exists (composite FK, nullable, so Increment 3 or an import can use it) but v1 shows no control. | Phase 1: "need not in v1". | Low. |
| T10 | **Photos reads are their own file, `photo-reads.ts`**, not part of `reads.ts`, so exactly one file holds the blob read (`resolveMany:private`) and one holds the writes (`photo-store.ts`). A small, justified addition to R4's file list. | `audience-callsites.test.ts` pins a row per file; mixing the blob read into `reads.ts` would make that file's row cover a table reader. | Low. |
| T11 | **No committed importer.** The operator's one-time import is a Claude Code session that reads the spreadsheet from outside the repository and writes SQL on the owner connection under the contract below. | R-No Real Data; Phase 1 Flow 10 and Out of Scope. | n/a |
| T12 | **Legacy write stays on `recordAudit`.** `setCongregationOversightAction` (assessment) keeps its after-the-write audit (it is untouched behaviour with two e2e specs pinning its row); it gains `assertOrgSession` (F452) and drops carrier and expiry (F451). Filed as **F455** and deferred. | Moving it in-transaction rewrites a shipped writer for no user-visible gain. | n/a |

**Proposed decisions (orchestrator records).**

- **DECISION-349 — Congregation-record shapes.** Closed lists and tri-state booleans (T2); identity columns not null (T3); appraisals immutable (T4); `row_version` optimistic check on the four editable tables (T5); money is `bigint` cents capped at $1,000,000,000 (100,000,000,000 cents); every row carries `provenance` (`presbytery_entered` or `imported`), immutable after insert; photos' `is_cover` and caption are the only photo columns that change, plus the removal pair.
- **DECISION-350 — Oversight surface structure.** The record page is a sections page; the assessment form has its own route (T1); the list and record open for either key and each section reads under its own key in its own transaction (T7); sections are computed before the page's return with `Promise.all`, never as nested async components; no `loading.tsx` and no `route.ts` under the tree.
- **DECISION-351 — Import contract and deploy order.** No importer is committed (T11). Migration 0089 is applied to an environment *before* the code that reads it. The import contract below is the operator's session's whole interface.

**New findings.**

- **F454.** `getCongregationOversightList` and `getCongregationOversightDetail` (`src/lib/presbytery.ts:382`, `:434`) call `tx.select()` with no column list, so they read *every* column of `congregation_oversight`, including the superseded `insurance_carrier` and `insurance_expires_on`, under the tier-1 key. R8 (F451) removes the carrier and expiry from the *type and writer*, but the readers would still select them. Fix: explicit column lists in both readers, plus a source test that `insuranceCarrier` and `insuranceExpiresOn` appear nowhere in `src/lib/presbytery.ts` (U10).
- **F455.** The assessment write audits through `recordAudit` after the transaction commits (`oversight/[aboutOrgId]/actions.ts:65`), and `recordAudit` swallows its own failure, so a committed change can lack its audit row. Pre-existing; deferred to the monthly security review (DECISION-343's follow-up), see Carry-forward.

## Permissions & Flags

**New permission** (tenant `permissions` row, never `FEATURES.*`; `src/lib/permissions.ts` is untouched):

| Key | Module | Tier | 2FA | Description (verbatim; it is the Roles-screen label) |
|---|---|---|---|---|
| `congregation_oversight.finance` | `presbytery` | 2 | `requires_two_factor = true` | See and record a member congregation's appraisals, insurance and loans (the presbytery's own record) |

**Binding (R2, option A, confirmed by the orchestrator).** The presbytery arm of `presby_founding_administrator_permission_keys` becomes `['congregation_oversight.manage', 'congregation_oversight.finance']`; the 0085 base array text and the worship arm are byte-for-byte unchanged (test-rls 71b and 85 grep them). Backfill every org-owned `founding_administrator` role at a presbytery, with an apply-time notice count. TypeScript mirror: `foundingAdministratorPlan()` in `src/lib/onboarding/founding-administrator.ts` (order is base, worship, oversight, so the presbytery list is `[...base, 'congregation_oversight.manage', 'congregation_oversight.finance']`), `designation-parity.golden.json` (two blocks), `invitations.db.test.ts` and `founding-administrator.test.ts`. No other role is bound.

**Who may do what** (R1, DECISION-344; there is no view-only key):

| Record | Tier | Key (read and write) |
|---|---|---|
| Profile, assessment, buildings, photos, Buildings report | 1 | `congregation_oversight.manage` |
| Appraisals, insurance years, loans, Insurance-and-loans report | 2 | `congregation_oversight.finance` |

The record page and the list open for a holder of either key. Neither key: `OversightForbidden` (copy unchanged). The key is read live with `holdsPermissions` (`src/lib/org-portal/permission-check.ts`) inside each reader's and writer's own `withOrgContext` transaction. No permission predicate goes in an RLS policy.

**Flags: none new.** The surface rides the existing global `org_portal.oversight`; the Increment 2 reports ride `org_portal.reports`. Both are toggles, read with bare `isFlagEnabled` (DECISION-026's wrappers apply only to auth flags). **Each new or changed e2e spec sets the flag it needs through `e2e/support/flags.ts`** (`captureFlags` then `setFlag`, restored in `afterAll`): oversight specs set `org_portal.oversight`; report specs set `org_portal.reports` (also in the CI baseline already). **Nothing is added to `scripts/ci/e2e-baseline-flags.sql`.** *Production state:* `org_portal.oversight` is off in production today (coverage-allowlist reason). The operator asked for all of it in production, so flipping it on is a deploy step, and a global flag flip is a Rule 17 event (the help page says where Congregation Oversight "isn't turned on" it is the PresbyPortal team's switch). See "Deploy checklist".

**2FA consequence (R2), stated plainly.** Anyone who holds the finance key at any active membership is required to use two-factor at sign-in (`presby_two_factor_required`, arm B, reads `permissions.requires_two_factor` live). The backfill strands nobody: a presbytery founding administrator already holds the flagged `roles.manage`. A person given the key through a custom role is asked to enrol at their next sign-in, and the Roles help says so. The deploy-day count is a checklist item.

## Feasibility check (against the live tree, 2026-11-17)

- **Function signatures.** One `create or replace` of `presby_founding_administrator_permission_keys(p_org_type text)`, same signature, `immutable`, `security definer`, `set search_path = public, pg_temp` as 0085 `:132`. Its only SQL caller is `presby_apply_founding_administrator` by name (0059 `:613`, 0085 `:1592-1603`); returns `text[]`, no default parameters. Two new trigger functions take only `TG_ARGV`. Valid.
- **ALTER/DROP.** None. No existing column or table is altered or dropped. Comment-only restatements on `congregation_oversight.insurance_carrier`/`insurance_expires_on`, `permissions.requires_two_factor` and `presby_two_factor_required`. No `SECURITY DEFINER` body references anything 0089 changes (grepped `drizzle/` for the three comment targets: only 0080's comments).
- **New CHECKs and triggers against fixtures.** All six tables are new and empty, so `scripts/seed-dev.sql` and `e2e/support/seed-orgs.ts` cannot violate a CHECK. The about-org trigger (0045 `presby_check_about_org_affiliated('about_org_id', '')`) needs the about-org to be affiliated *today*: the seed's Alder Creek and Bramblewood (open `member_congregation` affiliations, seed-dev's "Council affiliations" block; Quillhaven's open row since 1995 as well) and the e2e alpha/beta/gamma fixtures (open affiliations, `seed-orgs.ts` `:313`) all are. A row about Quillhaven (unmanaged) is legal for the same reason.
- **New FKs and the tenant column.** Every table carries `organization_id` (the presbytery) as the tenant column on both sides. The three-column FK `(building_id, organization_id, about_org_id)` targets `unique (id, organization_id, about_org_id)` on `oversight_buildings`, declared in the same file. The photo FKs target `blob_assets_id_org_audience_key (id, organization_id, audience)` (0072); the 0089 guard refuses to run without it, as 0078 does. `about_org_id` is a plain FK to `organizations` (section-17 structural exception, as on `congregation_oversight`).
- **F362 coordination (checked).** F362 (`docs/TODO.md`, "Give the founding administrator `events.manage`, `event_types.manage` and `branding.manage`") also redefines this function. **No open branch carries it**: `git log main..` on `pipeline/event-signups`, `pipeline/founding-admin-directory` and `pipeline/next-16-4-6` shows no migration and no change to the function or `src/lib/onboarding/`; `pipeline/event-signups` only *waits* on F362 (its Phase 1 names it as a dependency). So 0089 lands first. **Obligations:** (a) 0089's header carries the same INTEGRATION HAZARD paragraph 0085 has (whichever of F362 and 0089 merges second must re-read the live body and carry the other's keys; `invitations.db.test.ts`'s equality with `foundingAdministratorPlan()` for every organization type is the catch); (b) at integration the orchestrator appends one sentence to the F362 TODO line: "carries `congregation_oversight.finance` in the presbytery arm (0089)". Journal order is the orchestrator's.
- **Pins this change moves** (all found by grep, all in the implementer's batch): `src/lib/db/domain/two-factor-default.db.test.ts:12,83` (nine flagged keys becomes ten, add `congregation_oversight.finance`, module `presbytery`, tier 2); `scripts/giving/test-rls-46.sql:948` and its three following assertions (nine becomes ten; add a tier-2 line); `scripts/test-rls.sql:8165` (add the finance key to the "congregation's founding administrator does not get it" assertion); `founding-administrator.test.ts:194,225`; `invitations.db.test.ts:849-853`; `designation-parity.golden.json:174,422`; the two `Six keys set it` comments (0080's text is stale already: restate from the live `pg_description`, not from 0080).
- **Rule 16 shared files, none edited mid-pipeline.** `domain/index.ts`, `drizzle/meta/_journal.json`, `scripts/test-rls.sql`, `scripts/seed-dev.sql` and `src/lib/dev-docs.ts` (worship's precedent patches it) are changed by **integration patches** under `scripts/oversight/` (`domain-index.ts.integration.patch`, `_journal.json.integration.patch`, `test-rls.sql.integration.patch`, `seed-dev.sql.integration.patch`, `dev-docs.ts.integration.patch`), exactly as `scripts/worship/` does. Code imports `@/lib/db/domain/oversight` directly until then. `e2e/support/*` gets **new files only**.
- **Dependencies:** none new. `zod`, `react-hook-form`, `sharp` (Increment 2), `src/lib/site-address.ts`, `src/lib/csv.ts` already exist.

## Data Model

One migration: **`drizzle/0089_presby_oversight_records.sql`**, hand-written (db:generate is broken, per every migration since 0012), idempotent, applied twice as proof, unreleased until applied to production (so correctable in place). Drizzle mirror: `src/lib/db/domain/oversight.ts`. Apply (owner, direct endpoint, `-1` mandatory because the file has no transaction of its own): `psql "$MIGRATE_DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f drizzle/0089_presby_oversight_records.sql`.

**File sections.** 0 guard (refuse without `blob_assets_id_org_audience_key`); 1 the permission row (`on conflict (key) do update`); 2 the bundle function; 3 the backfill (notice with count; re-apply reports 0); 4 the six tables; 5 indexes; 6 the two trigger functions and the triggers; 7 RLS and grants; 8 comments; 9 closing assertions (a `do` block that raises). The header carries the F362 hazard paragraph and the "WHAT THIS FILE DOES NOT DO" list (no audit row, no toggle row, no existing table altered, no DELETE guard trigger because `presby_app` holds no DELETE and a guard would block the fixture teardown cascade, the 0078 reasoning).

**Backfill (section 3).** One `insert into app_role_permissions (role_id, permission_key) select r.id, 'congregation_oversight.finance' from app_roles r join organizations o on o.id = r.organization_id where r.key = 'founding_administrator' and r.organization_id is not null and o.organization_type = 'presbytery' on conflict (role_id, permission_key) do nothing returning role_id`, counted into `raise notice 'oversight 0089: % founding_administrator role(s) at a presbytery topped up with the finance key'`. Residual, as 0057/0071/0085: a re-apply re-adds the key to a designation-minted role a tenant later edited it off.

### Columns common to the five record tables

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | |
| `organization_id` | `uuid not null references organizations(id) on delete cascade` | **the presbytery**; reachable only through the guarded fixture teardown (D10) |
| `about_org_id` | `uuid not null references organizations(id)` | the congregation; plain FK (section 17); present on every table (children too, for reporting and the three-column FK) |
| `provenance` | `text not null default 'presbytery_entered'` | `check (provenance in ('presbytery_entered','imported'))`; immutable after insert; not on photos |
| `created_at` / `created_by` | `timestamptz not null default now()` / `uuid not null references users(id)` | the import passes the operator's own user id |
| `updated_at` / `updated_by` | same shape | not on appraisals or photos (never updated except removal) |
| `row_version` | `integer not null default 1` | profiles, buildings, insurance years, loans only (T5) |
| `removed_at` / `removed_by` | `timestamptz` / `uuid references users(id)` | all but profiles; `check ((removed_at is null) = (removed_by is null))` |

Every table: `unique (id, organization_id)` (named `<table>_id_org_key`). Every text column has a `char_length(x) <= N` CHECK matching the limit in `contract.ts`.

### The six tables

1. **`oversight_profiles`** (tier 1). One row per `(organization_id, about_org_id)`: `unique (organization_id, about_org_id)` named `oversight_profiles_org_about_key`. Columns: `street_address text` (≤ 500, LF-separated by `normalizeAddress`, never parsed), `city text` (≤ 100), `county text` (≤ 100), `year_organized smallint` (`check null or between 1600 and 2100`), `phone text` (≤ 40). No removal pair: a profile is cleared by saving empty fields.

2. **`oversight_buildings`** (tier 1). Also `unique (id, organization_id, about_org_id)` (`oversight_buildings_id_org_about_key`, the child FK target). Columns: `name text not null` (1 to 120), `building_type text not null` (`check in ('sanctuary','education_building','fellowship_hall','manse','parsonage','office','vacant_land','annex','gymnasium','other')`), `year_built`, `first_addition_year`, `second_addition_year` (all `smallint`, each `check null or between 1600 and 2100`), `check (first_addition_year is null or year_built is null or first_addition_year >= year_built)`, `check (second_addition_year is null or first_addition_year is null or second_addition_year >= first_addition_year)`, `check (second_addition_year is null or year_built is null or second_addition_year >= year_built)`; `square_feet integer` (`check null or between 1 and 5000000`); `roof_condition`, `plumbing_condition`, `hvac_condition`, `boiler_condition` (`text`, each `check null or in ('good','fair','poor')`); `has_sprinklers`, `has_fire_alarm`, `has_security_system` (`boolean`, null is not recorded); `is_primary boolean not null default false`; `notes text` (≤ 4000); `retired_on date`, `retired_reason text` (`check null or in ('sold','demolished','closed','other')`), `check ((retired_on is null) = (retired_reason is null))`, `check (not (is_primary and retired_on is not null))`. (A second addition without a first is refused by the application, not the database, so an import is never blocked by a messy row.)

3. **`oversight_building_photos`** (tier 1; written from Increment 2, table ships now). Columns: `building_id uuid not null`, `image_asset_key uuid not null`, `thumb_asset_key uuid not null`, `asset_audience text not null default 'private'`, `width integer not null`, `height integer not null`, `caption text` (≤ 200), `is_cover boolean not null default false`. Constraints: `check (asset_audience = 'private')`, `check (image_asset_key <> thumb_asset_key)`, `check (width between 1 and 2000 and height between 1 and 2000)`; FKs, all composite and NO ACTION: `(building_id, organization_id, about_org_id)` to `oversight_buildings (id, organization_id, about_org_id)`; `(image_asset_key, organization_id, asset_audience)` and `(thumb_asset_key, organization_id, asset_audience)` to `blob_assets (id, organization_id, audience)`.

4. **`oversight_building_appraisals`** (tier 2). `building_id uuid not null` (same triple FK); `assessed_year smallint not null` (`between 1600 and 2100`); `amount_cents bigint not null` (`between 0 and 100000000000`); `notes text` (≤ 1000). No `updated_*` (T4).

5. **`oversight_insurance_years`** (tier 2). `policy_year smallint not null` (`between 1900 and 2100`); `carrier text` (≤ 200); `policy_number text` (≤ 100); `policy_expires_on date`; `recent_claims boolean`; `pool_interest boolean`; `notes text` (≤ 2000).

6. **`oversight_loans`** (tier 2). `building_id uuid` (nullable; the same triple FK, which is not enforced while `building_id` is null: `MATCH SIMPLE`); `kind text not null` (`check in ('presbytery_program','guaranteed_outside','other')`); `lender text` (≤ 200); `original_amount_cents`, `current_balance_cents`, `grants_amount_cents` (each `bigint`, `check null or between 0 and 100000000000`); `balance_as_of date`, `check ((current_balance_cents is null) = (balance_as_of is null))`; `guarantee_note text` (≤ 1000); `notes text` (≤ 2000); `status text not null default 'open'` (`check in ('open','paid_off')`); `paid_off_on date`, `check ((status = 'paid_off') = (paid_off_on is not null))`.

### Indexes ("live" means `removed_at is null`)

| Index | Definition | Purpose |
|---|---|---|
| `oversight_buildings_live_name_idx` | **unique** `(organization_id, about_org_id, lower(name)) where removed_at is null` | duplicate live name; also the list's building count |
| `oversight_buildings_one_primary_idx` | **unique** `(organization_id, about_org_id) where is_primary and removed_at is null` | at most one primary |
| `oversight_building_photos_live_image_idx` | **unique** `(organization_id, building_id, image_asset_key) where removed_at is null` | byte-identical re-upload is "already there" |
| `oversight_building_photos_one_cover_idx` | **unique** `(organization_id, building_id) where is_cover and removed_at is null` | one cover |
| `oversight_building_photos_building_idx` | `(organization_id, building_id) where removed_at is null` | the grid |
| `oversight_building_appraisals_live_year_idx` | **unique** `(organization_id, building_id, assessed_year) where removed_at is null` | one appraisal per building-year |
| `oversight_insurance_years_live_year_idx` | **unique** `(organization_id, about_org_id, policy_year) where removed_at is null` | one live record per congregation-year; newest-year read |
| `oversight_loans_about_idx` | `(organization_id, about_org_id) where removed_at is null` | the section and the report |

### Functions and triggers

- **About-org check (reused, 0045).** `create trigger oversight_<table>_about_org before insert or update on <table> for each row execute function presby_check_about_org_affiliated('about_org_id', '')` on **profiles, buildings, insurance years and loans**. Not on photos or appraisals (the composite FK pins them to a building the trigger already checked, Gap 12). As of the current date, the present-tense question 0045's header assigns to oversight. An insert about a never-affiliated or departed congregation is refused; an update that does not move `about_org_id` passes (R9: a departed congregation's rows stay editable at the database, unreachable in the UI).
- **`presby_oversight_guard_write()`**, plpgsql, **SECURITY INVOKER**, `set search_path = public, pg_temp`, binds every connection including the owner (F44). `revoke all ... from public, presby_app, presby_platform` (a trigger function needs no EXECUTE at fire time). Takes `TG_ARGV[0]`, a comma list of immutable columns. INSERT, non-owner: refuses `removed_at`/`removed_by` set (`check_violation`: "a new row starts unremoved; remove it with a later update") and stamps `created_at := clock_timestamp()`. UPDATE: refuses any change to a row whose `old.removed_at` is not null ("removal is one-way"); refuses any change to a listed immutable column (read through `to_jsonb(new)` / `to_jsonb(old)`, the 0045 idiom). Owner test copied from 0078 `:205`. Attached as `<table>_guard_write` (before insert or update) to the five tables that have the removal pair, with this immutable-column argument:

  | Table | `TG_ARGV[0]` (immutable columns) |
  |---|---|
  | buildings, insurance years | `id,organization_id,about_org_id,provenance,created_at,created_by` |
  | loans | the same (`building_id` stays changeable on a loan, T9) |
  | appraisals | the same plus `building_id,assessed_year,amount_cents,notes` (never updated except removal) |
  | photos | `id,organization_id,about_org_id,building_id,image_asset_key,thumb_asset_key,asset_audience,width,height,created_at,created_by` (no `provenance` column) |

  Profiles have no removal pair and no guard trigger; the column-limited grant is their immutability for `presby_app`.
- **`presby_oversight_building_live_guard()`**, plpgsql, invoker, same hardening. Before insert, or update of `building_id`, on **photos, appraisals and loans**: when `new.building_id` is not null, `select removed_at from oversight_buildings where id = new.building_id and organization_id = new.organization_id for share`; a removed building raises `check_violation` ("the building is removed"). `FOR SHARE` conflicts with the removal UPDATE, so a photo upload and a building removal serialize at the database (the 0078 designation-guard precedent). A missing building is left to the composite FK to report.

### RLS and grants

`enable` then `force row level security` on all six; one policy `tenant_isolation` (`using` and `with check` `organization_id = presby_current_org()`), drop-then-create. `revoke all on <six> from presby_app, presby_platform`. Then `grant select, insert` to `presby_app` on all six, and **`grant update (...)`, column-limited, no DELETE, nothing for `presby_platform`**:

| Table | `presby_app` UPDATE columns |
|---|---|
| profiles | `street_address, city, county, year_organized, phone, row_version, updated_at, updated_by` |
| buildings | `name, building_type, year_built, first_addition_year, second_addition_year, square_feet, roof_condition, plumbing_condition, hvac_condition, boiler_condition, has_sprinklers, has_fire_alarm, has_security_system, is_primary, notes, retired_on, retired_reason, row_version, updated_at, updated_by, removed_at, removed_by` |
| photos | `caption, is_cover, removed_at, removed_by` |
| appraisals | `removed_at, removed_by` |
| insurance years | `carrier, policy_number, policy_expires_on, recent_claims, pool_interest, notes, row_version, updated_at, updated_by, removed_at, removed_by` |
| loans | `building_id, kind, lender, original_amount_cents, current_balance_cents, balance_as_of, grants_amount_cents, guarantee_note, notes, status, paid_off_on, row_version, updated_at, updated_by, removed_at, removed_by` |

### Comments (section 8)

Table comments state "the presbytery's own record, never the congregation's (DECISION-119/120/344)" and the tier. Comment-only restatements: `congregation_oversight.insurance_carrier` and `.insurance_expires_on` ("SUPERSEDED by oversight_insurance_years (0089, DECISION-347): no longer read or written; legacy values convert only in the operator's import session"); `congregation_oversight.buildings_notes` ("shown as Property notes"); `permissions.requires_two_factor` and `presby_two_factor_required` (add the finance key; **start from the live `pg_description` text**, 0080's "Six keys" is stale since 0074).

### Closing assertions (section 9)

A `do` block raising if: any of the six lacks `relrowsecurity` or `relforcerowsecurity`; `presby_app` holds DELETE or TRUNCATE on any (by `aclexplode`); the permission row is not tier 2 with the flag; the presbytery bundle lacks the finance key or the congregation bundle has it; either guard function is missing or a table lacks its trigger.

### Seed and test files (integration patches, Rule 16)

- `scripts/oversight/test-rls-89.sql` (the worship precedent: its own world built in `pg_temp.t89_world()`, every block ends in rollback; standalone as `presby_app`, one `\ir` line appended to `test-rls.sql` at integration). Sections: (a) structure (FORCE on six from `pg_class`; the one policy; guards invoker with search_path pinned and owner-only EXECUTE; triggers enabled); (b) catalog and bundle (the key, tier, flag; presbytery bundle has it, congregation bundle does not; backfill; **the 0085 and 71b byte greps still match**); (c) grants (`aclexplode`: no DELETE or TRUNCATE for `presby_app`, nothing for `presby_platform`; exact UPDATE column lists); (d) isolation (cross-presbytery read zero, write rejected; a **managed congregation's session and its administrator read zero rows from all six**; platform role reads none); (e) composite keys (a photo, appraisal and loan link naming another congregation's building is rejected by the FK); (f) about-org (never-affiliated rejected; departed congregation rejected on insert, edit allowed); (g) removal one-way, immutables, and the unique indexes (a removed name or year is reusable; a second live name, primary, cover, insurance year, appraisal year is refused); (h) `presby_public_site_asset()` returns nothing for a building-photo key; (i) CHECK boundaries (years 1599/1600/2100/2101, money 0/max/max+1, loan pair rules).
- `scripts/oversight/seed-dev-oversight.sql`: invented fixtures only: two buildings, a profile and an insurance year for Alder Creek, a loan for Bramblewood, one row about a Western Basin congregation (for cross-presbytery checks), and a **new** adopted role plus fixture person and account holding the finance key (not the existing clerk role f...00e: giving it the flagged key would force TOTP on the dev clerk walk, the seed's own DECISION-291 caveat). Ids chosen at integration. No photo rows (Increment 2 adds generated solid-colour image bytes).

## Import contract (the operator's one-time session; not built, not committed)

Per DECISION-351. The session reads the spreadsheet from outside the repository and writes on the owner connection with the organization GUC set (`select set_config('app.current_org_id', <presbytery id>, true)` in the same statement block, the `worship-fixture` F433 idiom). Rules:

- Congregations must already exist as organizations under the presbytery, affiliated today (the about-org trigger refuses otherwise). That is the import's dependency, not this pipeline's.
- Every row: `organization_id` = the presbytery, `about_org_id` = the congregation, `provenance = 'imported'`, `created_by`/`updated_by` = the operator's own user id.
- One profile per congregation. Buildings keyed by live `lower(name)` (the unique index makes a re-run fail loudly rather than duplicate). Insurance keyed by `(about_org_id, policy_year)`; the sheet's year is the policy year.
- The sheet's single appraisal value becomes one `oversight_building_appraisals` row on the primary building at the sheet's year (T3: both are required).
- The sheet's program-loan balance, original loan and "mortgage grants" become **one** `oversight_loans` row of kind `presbytery_program` with `current_balance_cents`, `original_amount_cents`, `grants_amount_cents` and a `balance_as_of` date (the sheet's date; the pair CHECK requires one); the sheet's guarantee text goes to `guarantee_note` verbatim.
- Free-text conditions ("2018 remodel", "Poor") map to `good`/`fair`/`poor` where they plainly mean one; anything else is appended to the building's `notes` as "Roof: …" and the condition left null (T2). Yes/No columns map to `true`/`false`; blank to null.
- Legacy `congregation_oversight.insurance_carrier`/`insurance_expires_on` values: production has **0** (read-only count, 2026-11-17: the table has 0 rows). The orchestrator re-counts on deploy day; if not 0, the session converts them into `oversight_insurance_years` as `imported`. 0089 never converts data.
- No spreadsheet row, name, number or sample value is ever committed, logged to a tracked file or pasted into a work-log.

## Module and file plan

Worktree root `/Users/cshenso/git/presby-platform/presby-profile`. **I = Increment 1, II = Increment 2.**

### `src/lib/oversight/` (R4)

| File | Server? | Contents |
|---|---|---|
| `contract.ts` (I) | pure, no imports | the two key names; the closed lists with their labels (`BUILDING_TYPES`, `CONDITIONS`, `RETIRE_REASONS`, `LOAN_KINDS`, `LOAN_STATUSES`, `PROVENANCES`); `LIMITS` (every max length, year bounds, `SQUARE_FEET_MAX`, `MONEY_MAX_CENTS`, `PHOTO_CAP = 10` (II)); the closed `CHANGED_FIELDS` names an audit row may carry; `OversightViewer`, `OversightCtx`, `Outcome` and `Refusal` types. A client form may import it. |
| `validate.ts` (I) | pure | one zod schema and one `parse*` per form, taking the form's **string** values (the same object `zodResolver` validated; the action re-parses it): `profileSchema`, `buildingSchema`, `retireSchema`, `appraisalSchema`, `insuranceSchema`, `loanSchema`, `paidOffSchema`. Helpers: `parseMoneyToCents`, `parseYear`, `cleanLine`, `parseDate`. `today` and the current year are **injected**, never read from the clock inside a rule (so a boundary test needs no fake timers). Address uses `normalizeAddress` from `src/lib/site-address.ts`. |
| `copy.ts` (I, II) | pure | every user-visible string the module produces (Copy section is its source): refusal messages, labels, locked and empty states, toast text, the validator's messages. One file so the copy-truthfulness check has one place to read. |
| `derive.ts` (I) | pure | `expiryState(expiresOn, today)`, `buildingSummary`, `latestAppraisal`, `loanTotals` (sums only recorded figures and counts the unrecorded ones), `formatMoney(cents)`, `formatCondition`, `formatTriState`. |
| `store.ts` (I) | `server-only` | **the only writer of five tables** (profiles, buildings, appraisals, insurance years, loans). Every function: `withOrgContext(ctx.actorPersonId, ctx.organizationId, tx => ...)`; `holdsPermissions` for the table's own key first; resolves `aboutOrgId` with `resolveMemberCongregation`; writes; `insertAuditRow` in the same `tx`. |
| `reads.ts` (I) | `server-only` | one reader per section and form-default, each its own `withOrgContext` transaction and its own key check. No blob access. |
| `photo-store.ts` (II) | `server-only` | **the only writer of `oversight_building_photos`** and the only `getBlobStore().store(` caller (two calls, both literal `audience: "private"`). |
| `photo-reads.ts` (II, T10) | `server-only` | the photo grid and the one `?view=` master, with the one `getBlobStore().resolveMany({... audience: "private" })`. |
| `report-rows.ts` (II) | `server-only` | transaction-taking functions the two report readers call, so table names stay in the module. |
| `boundaries.test.ts` (I) | test | R4's list (U5). |
| `audit-coverage.test.ts` (I) | test | U6. |

### Modified outside the module

| File | Change (I unless marked) |
|---|---|
| `src/lib/presbytery.ts` | **F451/F454:** remove `insuranceCarrier` and `insuranceExpiresOn` from `OversightRow`, `SetOversightInput`, the validation (`:498-507`, `:528-536`), the `values` object (`:558-559`) and both readers (`:405-406`, `:454-455`); replace `tx.select()` (`:382`, `:434`) with explicit column lists; rename the `buildingsNotes` message to "Property notes must be 4000 characters or fewer."; `export` `resolveMemberCongregation` (`:189`) and `listMemberCongregations` (`:217`). Names none of the six new tables. |
| `src/lib/presbytery-reports/gate.ts` | add `gateOversightPage` over `gatePresbyteryPage`; `PresbyteryPageFlag` becomes `REPORTS_FLAG \| INSIGHTS_FLAG \| OVERSIGHT_FLAG` (`OVERSIGHT_FLAG` already exists in `contract.ts:25`). Update the header comment and `gate.test.ts`. |
| `src/lib/audit.ts` (+ `audit.test.ts`) | append the Increment 1 keys (below) in an APPENDED block, the established pattern. II: photo keys. |
| `src/lib/db/domain/oversight.ts` (I, new) | the Drizzle mirror of all six tables. Its `export *` line and `dev-docs.ts` classification (`"M. Presbytery oversight"` for all six) ship as integration patches. |
| `src/lib/onboarding/founding-administrator.ts` + golden + tests | the TypeScript mirror of the bundle (Permissions section). |
| `src/lib/org-portal/tiles.ts:565` | description: "The presbytery's own record of each member congregation: viability, profile, buildings, insurance and loans." (Copy C11) |
| `src/lib/help/registry.ts`, `coverage-allowlist.ts`, `coverage.test.ts` | the new page; remove the `tile:oversight` entry; `ALLOWLIST_PIN` 13 to 12 and the file's "13 entries" comment; the `presbytery-tools` `today` sentence; label lists of the edited pages. |
| `src/app/(admin)/admin/organizations/[id]/founding-administrator-section.tsx:51` | `PERMISSION_LABELS["congregation_oversight.finance"] = "congregation appraisals, insurance and loans"` (platform-admin dialog; names the residual in plain words as `careers.applicants` does). |
| `src/lib/storage/audience-callsites.test.ts` | FORWARD rows for `photo-store.ts` (`["store:private", "store:private"]`) and `photo-reads.ts` (`["resolveMany:private"]`) in I; both move to ACTIVE in II. |
| `docs/deployment.md` | a "Pre-deploy runbook: 0089" section (Deploy checklist below). |

### Routes under `src/app/(org)/o/[slug]/admin/oversight/` (no `route.ts`, no `loading.tsx` anywhere beneath it)

| Path | Page (I unless marked) | Co-located `actions.ts` |
|---|---|---|
| `page.tsx` (list) | reworked | none |
| `[aboutOrgId]/page.tsx` | the sections page | none |
| `[aboutOrgId]/assessment/edit/` | the moved form (`edit-form.tsx`, `oversight-schema.ts`, golden test, tests) | moved `actions.ts` (`setCongregationOversightAction`) |
| `[aboutOrgId]/profile/edit/` | `page.tsx`, `profile-form.tsx` | `setProfileAction` |
| `[aboutOrgId]/buildings/new/` | `page.tsx` (the form is `buildings/building-form.tsx`, shared) | `buildings/actions.ts` (below) |
| `[aboutOrgId]/buildings/[buildingId]/` | detail: facts, appraisals, retire/remove controls; II: photos block | none |
| `[aboutOrgId]/buildings/[buildingId]/edit/` | `page.tsx` | `buildings/actions.ts` |
| `[aboutOrgId]/buildings/[buildingId]/appraisals/new/` | `page.tsx`, `appraisal-form.tsx` | `appraisals/actions.ts` |
| `[aboutOrgId]/buildings/[buildingId]/photos/` | **II** page, grid, `?view=<photoId>` | **II** `photos/actions.ts` |
| `[aboutOrgId]/insurance/new/`, `[recordId]/edit/` | `page.tsx`, `insurance-form.tsx` | `insurance/actions.ts` |
| `[aboutOrgId]/loans/new/`, `[loanId]/edit/` | `page.tsx`, `loan-form.tsx` | `loans/actions.ts` |

Every id segment (`aboutOrgId`, `buildingId`, `recordId`, `loanId`, `view`) is parsed with `isUuid` (`src/lib/is-uuid.ts`) and 404s before any read.

### Components

`src/components/oversight/` (new; server unless marked): `section-frame.tsx` (heading, action slot, locked/empty/error states), `locked-section.tsx`, `fact-list.tsx` (a `dl`), `building-card.tsx`, `insurance-card.tsx`, `loan-card.tsx`, `oversight-gate-state.tsx` (the four whole-page answers with area "Congregation Oversight", the sibling of `reports/report-gate-state.tsx`), `section-load-error.tsx`; **client**: `retire-dialog.tsx` and `paid-off-dialog.tsx` (plain controlled inputs in a Dialog, no `useForm`), `confirm-remove-dialog.tsx` (AlertDialog, one component for all four removals), `money-field.tsx`/`year-field.tsx` (text inputs with `inputMode`, never `type="number"`). **Forms** (client, `react-hook-form` + `zodResolver`, each root inside `<HydrationGate>`, each with `useUnsavedChangesGuard`): `profile-form`, `building-form`, `appraisal-form`, `insurance-form`, `loan-form`, and the moved assessment `edit-form`; six `useForm` roots for `check:hydration-gate`. II: `src/components/oversight/photo-grid.tsx`, `photo-upload-island.tsx` (the one new `'use client'` photo file), `src/components/presbytery-reports/buildings-view.tsx`, `insurance-loans-view.tsx`.

## API Contract

All mutations are Server Actions in `actions.ts` files marked `"use server"`. They take **plain objects of strings** (the form's values), never `FormData`, except the photo upload. Common body, in this order: `assertOrgSession(await auth())` (F452; refuses an unauthenticated or un-verified-2FA session with the REUSED copy), `resolveOrgContext(userId, slug)` (not `ok` is "You don't have access to that organization."), then a UUID check on every id (a malformed id is "That record could not be found."), then the pure parse (an invalid result returns before any transaction opens), then the `store.ts` call, then `revalidatePath` of the record page. `organizationId` is never a parameter: it comes from the resolution. Every action returns `ActionResult<{ id: string }>` (`src/types/actions.ts`); a refusal is `{ ok: false, error }` with **one fixed string per refusal kind**, never raw database text; a thrown database error is caught in `store.ts` and returned as `save_failed`. `check:audit` sees no `db.` call in an `actions.ts` (the writes live in `store.ts`), so `audit-coverage.test.ts` and the DB tests stand in for the tripwire (the person-photos precedent; R4's "check:audit blind spot").

Common inputs: `slug: string`, `aboutOrgId: string`. Edit actions also take `expectedVersion: number` (T5). **Refusal kinds** (the `copy.ts` table is the strings): `forbidden`, `not_found`, `invalid` (carries `field` and message), `duplicate_name`, `duplicate_policy_year`, `duplicate_appraisal_year`, `stale`, `already_retired`, `not_retired`, `already_paid_off`, `not_paid_off`, `building_removed`, `save_failed`.

| Action | Key | Inputs (string values) | Store behaviour | Audit action and metadata |
|---|---|---|---|---|
| `setProfileAction` | manage | `streetAddress, city, county, yearOrganized, phone`, `expectedVersion: number \| null` | upsert on `(org, about)`; `null` version means "create"; a concurrent create loses to the unique and returns `stale` | `OVERSIGHT_PROFILE_SET` `{ organizationId, aboutOrgId, created: boolean, changed: string[] }` |
| `createBuildingAction` | manage | `name, buildingType, primary: boolean, yearBuilt, firstAdditionYear, secondAdditionYear, squareFeet, roofCondition, plumbingCondition, hvacCondition, boilerCondition, hasSprinklers, hasFireAlarm, hasSecuritySystem, notes` | inserts; if `primary`, clears the current primary in the same transaction (one `UPDATE`, then the insert, so the partial unique never sees two) | `OVERSIGHT_BUILDING_CREATED` `{ organizationId, aboutOrgId, buildingId, primary }` |
| `updateBuildingAction` | manage | the same plus `buildingId`, `expectedVersion` | row-locks the building (`for update`), compares `row_version`, diffs; **no change writes nothing and audits nothing** and returns `{ ok: true, data: { id, unchanged: true } }` | `OVERSIGHT_BUILDING_UPDATED` `{ …, buildingId, changed }` (includes `"retired"` for a bring-back) |
| `retireBuildingAction` | manage | `buildingId, reason, retiredOn` | sets `retired_on`, `retired_reason`, `is_primary = false`; `already_retired` if set | `OVERSIGHT_BUILDING_RETIRED` `{ …, buildingId, reason }` |
| `reinstateBuildingAction` | manage | `buildingId` | clears the pair; `not_retired` if clear | `OVERSIGHT_BUILDING_UPDATED` `{ …, changed: ["retired"] }` |
| `removeBuildingAction` | manage | `buildingId` | sets `removed_at`/`removed_by` and `is_primary = false`, one UPDATE | `OVERSIGHT_BUILDING_REMOVED` `{ …, buildingId }` |
| `recordAppraisalAction` | finance | `buildingId, assessedYear, amount, notes` | inserts; `duplicate_appraisal_year` on the unique | `OVERSIGHT_APPRAISAL_RECORDED` `{ …, buildingId, appraisalId, assessedYear }` |
| `removeAppraisalAction` | finance | `buildingId, appraisalId` | removal pair | `OVERSIGHT_APPRAISAL_REMOVED` `{ …, buildingId, appraisalId }` |
| `recordInsuranceAction` | finance | `policyYear, carrier, policyNumber, policyExpiresOn, recentClaims, poolInterest, notes` | inserts; `duplicate_policy_year` | `OVERSIGHT_INSURANCE_RECORDED` `{ …, insuranceId, policyYear }` |
| `updateInsuranceAction` | finance | `recordId` + the same minus `policyYear` + `expectedVersion` | as building update (the policy year is not editable: remove and re-record) | `OVERSIGHT_INSURANCE_UPDATED` `{ …, insuranceId, policyYear, changed }` |
| `removeInsuranceAction` | finance | `recordId` | removal pair | `OVERSIGHT_INSURANCE_REMOVED` `{ …, insuranceId, policyYear }` |
| `recordLoanAction` | finance | `kind, lender, originalAmount, currentBalance, balanceAsOf, grantsAmount, guaranteeNote, notes` | inserts as `open` | `OVERSIGHT_LOAN_RECORDED` `{ …, loanId, kind }` |
| `updateLoanAction` | finance | the same plus `loanId, expectedVersion, status` (open, or reopen) | server rule: if the balance changed, `balanceAsOf` must differ from the stored one (else `invalid` on `balanceAsOf`); `status` back to `open` clears `paid_off_on` | `OVERSIGHT_LOAN_UPDATED` `{ …, loanId, kind, changed }` |
| `markLoanPaidOffAction` | finance | `loanId, paidOffOn` | one UPDATE: `status = 'paid_off'`, `paid_off_on`, `current_balance_cents = 0`, `balance_as_of = paid_off_on`; `already_paid_off` | `OVERSIGHT_LOAN_PAID_OFF` `{ …, loanId, kind }` |
| `removeLoanAction` | finance | `loanId` | removal pair | `OVERSIGHT_LOAN_REMOVED` `{ …, loanId, kind }` |
| `setCongregationOversightAction` | manage (existing) | existing `SetOversightInput` minus carrier and expiry | unchanged writer (T12); now `assertOrgSession` first | existing `CONGREGATION_OVERSIGHT_SET` |

**Audit keys, Increment 1 (14).** Appended to `AUDIT_ACTIONS` in `src/lib/audit.ts`, all `tenant.*`, `resourceType` the table's singular noun, `resourceId` the row id, written by `insertAuditRow` (`src/lib/audit-tx.ts`) **inside the mutation's own transaction** so a failed audit insert undoes the change: `OVERSIGHT_PROFILE_SET` `tenant.oversight_profile.set`; `OVERSIGHT_BUILDING_CREATED/UPDATED/RETIRED/REMOVED` `tenant.oversight_building.created|updated|retired|removed`; `OVERSIGHT_APPRAISAL_RECORDED/REMOVED` `tenant.oversight_appraisal.recorded|removed`; `OVERSIGHT_INSURANCE_RECORDED/UPDATED/REMOVED` `tenant.oversight_insurance.recorded|updated|removed`; `OVERSIGHT_LOAN_RECORDED/UPDATED/PAID_OFF/REMOVED` `tenant.oversight_loan.recorded|updated|paid_off|removed`. **Increment 2 adds four:** `OVERSIGHT_PHOTO_ADDED/REMOVED/COVER_SET/CAPTION_SET` `tenant.oversight_photo.*` with `{ organizationId, aboutOrgId, buildingId, photoId }` (added also `cover: boolean`; cover-set also `previousCoverPhotoId: string | null`). The two exports reuse `PRESBYTERY_REPORT_EXPORTED` with `report: "buildings" | "insurance_and_loans"`.

**Audit metadata is ids, closed enumerations, booleans, years and field names only: never an amount, a policy number, a carrier or lender, a caption, a note or an address, because `audit_events` is platform-readable.** `changed` is a subset of `CHANGED_FIELDS` in `contract.ts` (typed, so a value cannot be passed). `audit-coverage.test.ts` (U6) pins: every `store.ts`/`photo-store.ts` write function calls `insertAuditRow` exactly once in its transaction; the metadata key set per action equals the allowlist above; and a run with sentinel values in every free-text and money field finds none of them in any audit row.

**Reads** (`reads.ts`; each returns `{ kind: "ok", data } | { kind: "forbidden" } | { kind: "not_found" }`, never throws for a missing key; an `OrgAccessError` is rethrown to `[slug]/error.tsx`; any other throw is caught by the page as a section load error):

| Reader | Key | Returns |
|---|---|---|
| `readOversightAccess(viewer, aboutOrgId?)` | either | `{ manage, finance }` booleans, plus (when `aboutOrgId` is given) the congregation `{ id, name, platformStatus }` via `resolveMemberCongregation`; neither key is `forbidden` *before* the congregation is resolved (no existence leak); a key and a bad id is `not_found` |
| `readOversightList(viewer)` | either | roster (`listMemberCongregations`, **no lifecycle filter**, R9) plus, **only for held keys**, viability and updated-at (legacy row), city and county (profile), buildings-in-use count, newest insurance expiry. A fixed number of queries (4 to 6) regardless of the roster size (D4 pins it); a tier-2 field is not *present* in the object for a manage-only viewer |
| *(no new reader)* | manage | the Assessment section and the assessment edit page both call the existing `getCongregationOversightDetail` in `presbytery.ts` (explicit columns after F454); its `forbidden` renders the Locked card, and `invalid_target` cannot occur because `readOversightAccess` has already resolved the congregation |
| `readProfile` | manage | the profile or `null` plus `rowVersion` |
| `readBuildings` / `readBuilding(buildingId)` | manage | live buildings (retired included, removed not), counts; one building under `(org, about)` or `not_found` |
| `readAppraisals(buildingId)` | finance | live appraisals, newest year first, with the latest flagged |
| `readInsuranceYears` / `readInsuranceYear(recordId)` | finance | live years newest first; one or `not_found` |
| `readLoans` / `readLoan(loanId)` | finance | live loans (open first); one or `not_found` |
| `readTodayInOrg(tx)` | n/a | the organization's local date, for "Expired" and the future-date rules (`orgTimeZoneInTx`, as the viability reader does) |

**The record surface's roster is `parent_id` plus type `congregation` with no lifecycle filter (R9, F453)**: a closed congregation still under the presbytery stays reachable, loans included; a congregation that *departed* (its `parent_id` moved) is unreachable in the UI and its rows stay intact. The Increment 2 reports use `roster.ts` (active lifecycle only) and say so.

## Component / Page Plan

**The record page** (`[aboutOrgId]/page.tsx`). Order of work: `gateOversightPage` (signed in, `assertOrgSession`, the four-way org miss, `assertOrgAccess`, `org_portal.oversight`, presbytery type) to `isUuid(aboutOrgId)` (else `notFound()`) to `readOversightAccess` (forbidden gives `OversightForbidden`, `not_found` gives `notFound()`) to the section values computed **before the return with `Promise.all`** (never nested async components; the reports page's reason) to render. Sections in this order, each a `section-frame`: Profile, Assessment, Buildings, Insurance, Loans. A section whose key the viewer lacks renders the **Locked** card (named permission, "An administrator can give it under Roles."); a section whose reader throws renders its own load error with a "Try again" link and the rest stays up; no section reads a zero where "not recorded" is the truth. The congregation's name is the `h1`; for a `managed` congregation the Flow 9 note sits under the subtitle. Back link "Back to oversight" (static path from the validated slug; **no `callbackUrl` or `next` is read anywhere in the tree**, pinned by U5).

**The list** (`page.tsx`): `gateOversightPage`, `readOversightList`, `OversightList` reworked (columns by held key, the hidden-column note, "Open" link, the unchanged empty and forbidden states). 360px: the table keeps its first column, Viability and the action; the other columns are `hidden sm:table-cell` as today.

**Forms** are full pages (never long dialogs). Shared form rules (U9): `HydrationGate` on every root; `useUnsavedChangesGuard`; money and year inputs are text with `inputMode="decimal"` or `"numeric"` (a number input drops pasted text); dates are native `type="date"`; selects use the existing `SELECT_CLASSES`; every control is `min-h-11`; the submit is `min-h-11` and disabled while submitting; a failed save keeps the form's contents and shows the refusal in a toast; a field error is shown under its field with the field's own message; no native dialogs (AlertDialog for destructive confirms). On success: create forms `router.push` to the record page (a path built from the validated props); edit forms stay and `router.refresh()` (the assessment form's existing behaviour, which the e2e specs rely on).

**Date display.** Date-only values (`YYYY-MM-DD`) render through the existing date helpers (`src/lib/format-date.ts`, `FormattedDate`), never `new Date("YYYY-MM-DD")` (the timezone-safe-dates spec's lesson).

**Help pages.** Added: `congregation-records` (I). Edited: `presbytery-reports` (I: the map steps; II: the two reports), `roles-who-can-do-what` (I), `why-cant-i-see-this` (I), `privacy-policy` (II), `presbytery-tools` registry sentence (I). Screenshots: **none** in either increment (a screenshot needs a `help:shots` capture addition and a generated image; the page is text-only and the choice is recorded here so Phase 6 does not look for one).

## Implementation Order

### Increment 1 (0.61.0) — branch `pipeline/congregation-profile`, port 3102

| Batch | Implementer | Work | Exit gate |
|---|---|---|---|
| **B1** | database-admin | `drizzle/0089_presby_oversight_records.sql` (sections 0 to 9), `src/lib/db/domain/oversight.ts`, `oversight.schema.test.ts`, `oversight.db.test.ts`, `scripts/oversight/test-rls-89.sql`, the integration patches and seed file, the bundle TypeScript mirror (`founding-administrator.ts`, golden, `founding-administrator.test.ts`, `invitations.db.test.ts`), the pins in the Feasibility list, and `scripts/oversight/test-0089-migration.sh` (applies twice and compares a digest, the `test-0078-migration.sh` template). Applied to the pipeline Neon branch. | 0089 applied twice with identical digest; test-rls-89 and the patched test-rls all pass as `presby_app`; each mechanism proven failing-first; typecheck |
| **B2** | api-developer | `contract`, `validate`, `copy` (strings from the Copy section only), `derive`, `store`, `reads`; the audit keys; `gateOversightPage`; the six `actions.ts` files plus the moved assessment action; the `presbytery.ts` changes (F451/F454); `boundaries.test.ts`, `audit-coverage.test.ts`, `store.db.test.ts`, `reads.db.test.ts`, unit tests U1 to U4, U7, U10 | `npm run check` zero; DB suite for the new files; failing-first for the audit-in-transaction rollback and the concurrency cases |
| **B3** | ux-developer | the list, the record page, every form page and component, the moved assessment form, the states, the tile description, `founding-administrator-section.tsx` label, page and form tests (U8, U9), **the help page and the four help edits written from the screens at 360px**, registry, allowlist and pin | typecheck, build, `check:hydration-gate`, `check:help`, a 360px walk of every page in a real browser (light and dark) |
| **B4** | full-stack-developer | `e2e/support/oversight-fixture.ts` (new), the three new specs, the hydration spec, the edits to the existing specs (E2E blast radius), `docs/deployment.md` runbook, then the founding-administrator walk run for real (Phase 6 input) | `E2E_BASE_URL=http://localhost:3102`, own server, the new and touched specs green; the prod hydration lane green |

B1 must merge to the pipeline branch before B2 (B2 imports the Drizzle mirror); B2 before B3 (B3 imports `reads`, `copy`, `contract`). B4 starts when B3's pages exist.

### Increment 2 (0.62.0) — same branch after 0.61.0 is released, port 3102 (3103 for the production hydration lane)

| Batch | Implementer | Work | Exit gate |
|---|---|---|---|
| **B5** | api-developer | **Opens with a `refactor:` commit** (R6): `person-photos/image.ts` to `storage/image/photo.ts`, image limits and `ImageRefusal` to `storage/image/limits.ts`, `src/app/(org)/o/[slug]/admin/community/[id]/edit/photos/downscale.ts` to `storage/image/downscale.ts` (its test moves unchanged; the person-photo upload island's import is repointed); `processPhoto` gains a **required** `{ thumbnail: "top" \| "centre" }`, person photos pass `"top"` (output unchanged byte for byte: the existing `image.test.ts` is the proof, run before and after); `SHARP_FILES` updated in `scripts/check-treasury-boundaries.mjs`, `image-sanitize.test.ts` and `person-photos/scan.test.ts`; CLAUDE.md layout lines (orchestrator at integration). Then `photo-store.ts`, `photo-reads.ts`, the photo copy, the four audit keys, `photos/actions.ts`, tests | person-photo suites green and byte-identical; the sanitizer's refusal order unit-tested for the new caller; `audience-callsites.test.ts` rows ACTIVE |
| **B6** | ux-developer | photos page, grid, `?view=` master, upload island (imports the moved `downscale.ts`), the photos block on the building detail, the cover on the record page's building cards | 360px with a real phone-photo upload on a deployed environment (Phase 6) |
| **B7** | api-developer | `REPORT_KEYS`/`REPORTS` gain the two entries (`contract.ts`, R7); `src/lib/presbytery-reports/buildings.ts`, `insurance-loans.ts`, `report-rows.ts`, CSV builders and headers, `audit.ts` metadata typing, `hub.ts` (automatic from `REPORTS`), the two `export/route.ts` files, tests (`contract.test.ts`, `boundaries.test.ts` "six", `readers.db.test.ts`, `csv.test.ts`) | `npm run check` zero |
| **B8** | ux-developer | the two report pages and views, `HUB_COPY` cards, two help edits plus the privacy line, registry labels | 360px walk of both reports and a CSV opened |
| **B9** | full-stack-developer | specs (photos, reports, CSV), seed patch additions with generated image bytes, regression of the touched specs | specs green; prod hydration lane for the upload island |

**Cut order if time forces it** (Phase 1): reports before photos.

## Deploy checklist (both increments; the orchestrator and operator run it; recorded in the child logs)

1. **0089 to production before the 0.61.0 code deploys** (new code against the old schema fails on missing tables; the old code against the new schema is harmless: the old assessment form still writes its two dormant columns). Migration connection per the existing `prod-migration-connection` practice; record the apply-time notice counts (roles topped up). Runbook text goes in `docs/deployment.md`.
2. **Before applying:** read-only count of `congregation_oversight` rows with a non-null `insurance_carrier`, `insurance_expires_on` or `buildings_notes` (2026-11-17: 0 rows, so 0). If not 0, the import session converts them (Import contract); do not claim "nothing was recorded" in the release note.
3. **2FA:** the read-only "newly required, not enrolled" count (the 0080 precedent; the shared helper `src/lib/admin/two-factor-stranded.ts` or `/admin/2fa`) before and after 0089, record only the numbers. Expected: no change (a founding administrator already holds `roles.manage`).
4. **Operator:** switch `org_portal.oversight` on in production (it is off today) and confirm `org_portal.reports` and `org_portal.insights`. Then check the three pages `/help/congregation-records`, `/help/presbytery-reports` and `/help/roles-who-can-do-what` read true against that state (Rule 17: a global flag flip is an event).
5. **Operator, in the Phase 6 walk:** the real phone-photo upload (Increment 2) with a non-identifying picture (never committed), and the founding-administrator path.

## Copy

Every user-visible string the feature adds or changes. **An implementer who needs a string that is not here stops for a ruling.** `{year}` is the injected current year; `{name}` is the building's or congregation's name as typed (React text, never HTML). Strings marked **(II)** ship in Increment 2.

**Accepted residuals no string may deny** (the Phase 2 record): the founding administrator of a presbytery holds the finance key and reads are not audited, only writes (DECISION-345, `paper`); a congregation that *departed* the presbytery becomes unreachable on these pages while its rows stay (F453); the superseded carrier and expiry columns stay in the table, visible to nobody (R8); the assessment write audits after commit (F455); an orphaned blob after a failed final transaction and `bytea` growth **(II)**; the presbytery's copy and the congregation's own profile can diverge (Phase 1 Gap 1); an imported row stays marked imported after an edit. Nothing below says "everything is recorded", "nothing is kept", or "only X can see".

### C1. The list (`/o/<slug>/admin/oversight`) — viewers: presbytery staff holding either key

| String | Where |
|---|---|
| "The presbytery's own record of each member congregation: viability, profile, buildings, insurance and loans. It is never the congregation's own data." | intro under the h1 (replaces the viability-buildings-insurance sentence) |
| Column headers: "Congregation", "Viability", "City and county", "Buildings in use", "Insurance expires", "Assessment updated", and an sr-only "Actions" | table head (`Buildings & insurance` and `Updated` are replaced) |
| "{n} building" / "{n} buildings", or "Not recorded" | Buildings in use cell |
| "{date}", or "Expired {date}", or "Not recorded" | Insurance expires cell |
| "Not recorded" | an empty city-and-county cell |
| "Open" with sr-only " {name}" | the row link (replaces "View / edit" and "Assess") |
| "Viability, city and county, and buildings need permission to manage congregation oversight. An administrator can give it under Roles." | note above the table, when the viewer lacks `manage` (those columns are hidden) |
| "Insurance needs permission to manage congregation property finances. An administrator can give it under Roles." | note, when the viewer lacks `finance` (that column is hidden) |
| Unchanged: h1 "Congregation Oversight"; "No member congregations on record"; `OversightForbidden` ("You don't have permission to manage congregation oversight records at {name}. If you think this is a mistake, ask your presbytery's administrator."); `OversightLoadError` ("We couldn't load oversight records right now. Try again in a moment." and "Try again"). | existing |

1. *Residuals:* none denied. 2. *Source of truth:* the building count is `count(*) where removed_at is null and retired_on is null` from `oversight_buildings` (so "in use"); the expiry is `policy_expires_on` of the **highest live `policy_year`** (T8), "Expired" when it is before the organization's local date (`readTodayInOrg`); "Assessment updated" is `congregation_oversight.updated_at`; a cell reads "Not recorded" when no row or a null, never 0. 3. *Audience:* every viewer holds one of the two keys; "An administrator can give it" is true for them (a presbytery's founding administrator holds `role_grants.manage`); the forbidden state is the existing one. 4. *Neighbours:* modify `oversight-list.tsx:56-61, :89-96, :100` (columns, cell, link), `oversight/page.tsx:115-118` (intro), `oversight/page.test.tsx` (header and link assertions). `oversight-states.tsx:19-37` stays true and is **unchanged** (e2e 3 and the page test assert its text).

### C2. The record page (`.../oversight/<aboutOrgId>`) — viewers: either key

| String | Where |
|---|---|
| h1 `{congregation name}`; subtitle `{presbytery}'s own oversight record for this congregation.` (unchanged); link "Back to oversight" (unchanged) | header |
| "This congregation is on PresbyPortal and can keep its own profile there. What you enter here is the presbytery's own copy: it does not change theirs, and theirs does not change it." | under the subtitle, only when `platform_status = 'managed'` (Phase 1 Flow 9, reworded to what is known) |
| "How these records work" | a quiet link to `/help/congregation-records` |
| Section headings: "Profile", "Assessment", "Buildings", "Insurance", "Loans" | `h2`s |
| Locked card: badge "Locked"; "You need permission to manage congregation oversight. An administrator can give it under Roles." (Profile, Assessment, Buildings) or "You need permission to manage congregation property finances. An administrator can give it under Roles." (Insurance, Loans, and the Appraisals block on a building) | per section |
| "We couldn't load this section. Try again in a moment." and a "Try again" link to the current page | per section |
| Empty states: "Nothing is recorded in the profile yet." / "No buildings are recorded for this congregation." / "No insurance is recorded for this congregation." / "No loans are recorded for this congregation." | per section |
| "Imported from an earlier record." | small text on a profile, building, insurance or loan row whose `provenance = 'imported'` |

1. *Residuals:* the managed note says "does not change theirs, and theirs does not change it" and does not claim they agree (Gap 1's accepted divergence); "Imported from an earlier record" is shown even after a later edit (stated in help). 2. *Source of truth:* `platform_status` comes from `resolveMemberCongregation`; the note says "is on PresbyPortal and can keep its own profile" (true of every managed congregation) and **not** "has a profile", which no query here reads; provenance is the row's column. 3. *Audience:* the Locked reason names a permission and an administrator; a viewer lacking one key holds the other, so they are presbytery staff and "ask an administrator" is actionable; a viewer holding both never sees Locked. 4. *Neighbours:* modify `[aboutOrgId]/page.tsx:126` (kept verbatim, listed so the diff is checked) and the page's whole body; `oversight-states.tsx` unchanged.

### C3. Profile section and form (`profile/edit`) — manage

Section rows (label, then value or "Not recorded"): "Address", "City", "County", "Year organized", "Phone". Buttons: "Add profile details" (no profile yet) or "Edit profile". Form page h1 "Edit profile"; link "Back to {name}". Field labels: "Address", "City", "County", "Year organized", "Phone". Address hint: "Type it as you would write it on an envelope: one line for each line of the address, including the city, state and ZIP." Submit "Save" (while saving "Saving…"); link "Cancel". Toasts: "Profile saved." and "No changes to save."

1. *Residuals:* none. 2. *Source:* values from `oversight_profiles`; the hint describes input, claims nothing about a person. 3. *Audience:* manage holders, who can edit. 4. *Neighbours:* none (no existing profile string). The help step in `presbytery-reports.md:76-80` is C4's neighbour.

### C4. Assessment section and form (`assessment/edit`) — manage

Section rows: "Viability" (badge "At risk" / "Fair" / "Healthy" / "Not yet assessed", unchanged), "Redevelopment notes", "Property notes", "Map location" (`39.9612, -82.9988` or "Not set"). Button "Edit assessment". The moved form keeps every string and element id it has today, with three changes: **"Buildings notes" becomes "Property notes"** (id `oversight-buildings` unchanged), the **Insurance carrier and Insurance expires fields are removed**, and the page h1 is "Edit assessment" with a "Back to {name}" link. Toast unchanged: "Oversight record saved." The max-length message becomes "Property notes must be 4000 characters or fewer."; the carrier and expiry messages are deleted.

1. *Residuals:* the form no longer shows the carrier or expiry; nothing claims they are gone (R8: they are dormant). 2. *Source:* `congregation_oversight` explicit columns (F454). 3. *Audience:* manage holders. 4. *Neighbours (modify):* `edit-form.tsx` (labels `:` carrier/expiry blocks), `oversight-schema.ts` (carrier, expiry), `oversight-schema.golden.test.ts`, `edit-form.test.tsx`, `presbytery.ts:498-536`, `presbytery.test.ts` and `readers.db.test.ts:347` (inputs that pass carrier or expiry), `e2e/presbytery-oversight.spec.ts` case 2, and **`src/content/help/presbytery-reports.md:76-80`**: its steps "Open "Congregation Oversight", then choose the congregation. Under "Map location", enter the "Latitude" first…" are false after T1. New wording: "1. Open "Congregation Oversight", then choose the congregation. 2. In the "Assessment" section, choose "Edit assessment". 3. Under "Map location", enter the "Latitude" first. …" with later steps renumbered and `"Edit assessment"` added to the page's `labels`.

### C5. Buildings — manage

Card: name, a type badge, "Primary" and "Retired" badges, a line "Built {year}" and "{n} square feet" (each only if recorded), link "Open". Types: "Sanctuary", "Education building", "Fellowship hall", "Manse", "Parsonage", "Office", "Vacant land", "Annex", "Gymnasium", "Other". Section button "Add a building". Detail page rows: "Type", "Year built", "Additions" ("First addition {year}; second addition {year}", or "Not recorded"), "Square feet", "Roof", "Plumbing", "Heating and cooling (HVAC)", "Boiler" (values "Good", "Fair", "Poor", "Not recorded"), "Sprinklers", "Fire alarm", "Security system" (values "Yes", "No", "Not recorded"), "Notes". A retired building shows "Sold on {date}", "Demolished on {date}", "Closed on {date}" or "Retired on {date}". Buttons: "Edit building", "Retire this building", "Bring back into use", "Remove (entered by mistake)".

Form page h1 "Add a building" / "Edit building". Labels: "Name", "Type", "Primary building" (checkbox; hint "Only one building can be the primary. Choosing this one moves the mark from the current primary building, if there is one."), "Year built", "First addition", "Second addition", "Square feet", "Roof condition", "Plumbing condition", "Heating and cooling (HVAC) condition", "Boiler condition", "Sprinklers", "Fire alarm", "Security system", "Notes"; every select's empty option "Not recorded". Submit "Save building". Toasts: "Building added.", "Building saved.", "No changes to save.", "Building retired.", "Building brought back into use.", "Building removed."

Retire dialog: title "Retire {name}?"; body "A retired building leaves the active list. Its history stays, and you can bring it back into use."; fields "Why is it retired?" (options "Sold", "Demolished", "Closed", "Other"), "Date"; buttons "Retire building", "Cancel". Remove AlertDialog: title "Remove this building?"; body "Use this only for a building entered by mistake. It will no longer be listed, and neither will its appraisals or photos. This can't be undone here."; buttons "Remove building", "Cancel".

1. *Residuals:* "can't be undone here" admits that nothing in the product restores a removal (the row stays in the table); "its history stays" is true for retire (the rows and audit remain) and says nothing about removal. 2. *Source:* "neither will its appraisals or photos" is true because every reader filters on a live building and `presby_oversight_building_live_guard` refuses new children (D2 pins both); the "Primary" badge is `is_primary` among live rows; "Retired" is `retired_on`. 3. *Audience:* manage holders; "bring it back" and "remove" are actions that role has. 4. *Neighbours:* none today (no building strings exist); `oversight-list.tsx:56` "Buildings & insurance" is C1's.

### C6. Appraisals (on the building) — finance

Block heading "Appraisals". Each row: "{year}" and "${amount}" (US dollars, no cents when whole), a "Current" tag on the newest year, and "Remove". Empty: "No appraisal is recorded for this building." Locked: C2's finance wording. Button "Record an appraisal". Form h1 "Record an appraisal"; labels "Year assessed", "Appraised amount (dollars)" (hint "Dollars, for example 1250000 or 1250000.50."), "Notes"; submit "Save appraisal". Toasts "Appraisal recorded.", "Appraisal removed." Remove AlertDialog: title "Remove this appraisal?", body "Use this for an appraisal entered by mistake. To correct an amount, remove the appraisal and record it again.", buttons "Remove appraisal", "Cancel".

1. *Residuals:* none. 2. *Source:* "Current" = the highest live `assessed_year` of this building (`latestAppraisal`); an amount of exactly $0 is shown as "$0" (it can only exist if recorded; the form requires more than $0). 3. *Audience:* finance holders; the instruction is theirs to follow. 4. *Neighbours:* none.

### C7. Insurance — finance

Cards by policy year, newest first: title "{year}"; rows "Carrier", "Policy number", "Policy expires" (value "{date}" or "{date} · Expired" or "Not recorded"), "Recent claims", "Interested in the insurance pool" (both "Yes" / "No" / "Not recorded"), "Notes". Button "Record a year"; card actions "Edit", "Remove". Form h1 "Record insurance for a year" / "Edit insurance for {year}". Labels "Policy year" (read-only on edit), "Carrier", "Policy number", "Policy expires", "Recent claims", "Interested in the insurance pool", "Notes"; submit "Save insurance". Toasts "Insurance saved.", "Insurance removed." Remove AlertDialog: title "Remove this year's insurance?", body "Use this for a record entered by mistake. You can then record that year again.", buttons "Remove insurance record", "Cancel".

1. *Residuals:* none. 2. *Source:* "Expired" = `policy_expires_on < today` in the organization's time zone, in words (never colour alone); "You can then record that year again" is true because the live-year unique index ignores removed rows (D2). 3. *Audience:* finance holders. 4. *Neighbours:* the old carrier/expiry form fields (C4) are removed; no other string.

### C8. Loans — finance

Cards (open first, then paid off): the kind ("Presbytery program loan", "Guaranteed outside loan", "Other loan"), "Lender", "Original amount", "Current balance" with "as of {date}", "Grants", "Guarantee", "Notes"; status "Open" or "Paid off {date}". Empty: "No loans are recorded for this congregation." (never "No loans."). Buttons "Record a loan"; card actions "Edit", "Mark paid off" (open loans), "Reopen this loan" (paid off), "Remove". Form h1 "Record a loan" / "Edit loan". Labels "Kind of loan", "Lender", "Original amount (dollars)", "Current balance (dollars)", "Balance as of", "Grants (dollars)", "Guarantee" (hint "Describe the guarantee, if there is one."), "Notes"; submit "Save loan". Toasts "Loan saved.", "Loan marked paid off.", "Loan reopened.", "Loan removed.", "No changes to save." Paid-off Dialog: title "Mark this loan paid off?", body "This sets the balance to $0 as of the date you choose.", field "Date paid off", buttons "Mark paid off", "Cancel". Remove AlertDialog: title "Remove this loan?", body "Use this for a loan entered by mistake. It will no longer be listed. This can't be undone here.", buttons "Remove loan", "Cancel".

1. *Residuals:* "can't be undone here" as C5. 2. *Source:* "sets the balance to $0 as of the date" is exactly what `markLoanPaidOffAction` writes (U/D3 pin both columns); "Original amount" and "Grants" show "Not recorded" when null, never $0; "Guarantee" is free text, not a claim. 3. *Audience:* finance holders. 4. *Neighbours:* none.

### C9. Validation and refusal messages (shared, `copy.ts`) — whoever submits a form

| Condition | Message (field) |
|---|---|
| Address over 6 lines / over 500 characters | "Address can have up to 6 lines." / "Address is too long (up to 500 characters)." (the existing `normalizeAddress` strings, reused verbatim) |
| City or county over 100 | "City must be 100 characters or fewer." / "County must be 100 characters or fewer." |
| Phone | "Phone can have digits, spaces and + ( ) - . x only, up to 40 characters." |
| Year organized not a year / out of range | "Year organized must be a four-digit year." / "Year organized must be between 1600 and {year}." |
| Building name empty / over 120 | "Enter a name for the building." / "Name must be 120 characters or fewer." |
| Building type empty | "Choose a type." |
| Year built, first addition, second addition out of range | "Year built must be between 1600 and {year}." / "First addition must be between 1600 and {year}." / "Second addition must be between 1600 and {year}." (a non-number: "… must be a four-digit year.") |
| Addition order | "The first addition can't be before the year built." / "The second addition can't be before the first." / "Enter the first addition before the second." |
| Square feet | "Square feet must be a whole number of at least 1." / "Square feet can't be more than 5,000,000." |
| Condition not in list | "Choose a condition from the list." |
| Notes over limit | "Notes must be {n} characters or fewer." (4000 building, 2000 insurance and loan, 1000 appraisal); the guarantee: "Guarantee must be 1000 characters or fewer." |
| Duplicate live building name | "A building with that name is already recorded." |
| Retire | "Choose why this building is retired." / "Enter the date." / "The date can't be in the future." |
| Appraisal | "Enter the year assessed." / "Year assessed must be between 1600 and {year}." / "Enter the appraised amount in dollars." / "Amount must be more than $0." / "An appraisal for {assessedYear} is already recorded for this building. Remove it first to record a corrected amount." |
| Money (any field) | "Enter the amount in dollars, for example 1250000 or 1250000.50." / "Amount can't be more than $1,000,000,000." |
| Insurance | "Enter the policy year." / "Policy year must be between 1900 and {year+1}." / "Carrier must be 200 characters or fewer." / "Policy number must be 100 characters or fewer." / "Enter a valid date." / "Insurance for that year is already recorded. Edit it instead." |
| Loan | "Choose the kind of loan." / "Lender must be 200 characters or fewer." / "Enter the date the balance is as of." / "Enter the balance this date applies to, or clear the date." / "The date can't be in the future." / "Update the \"as of\" date for the new balance." |
| Paid off | "Enter the date." / "The date can't be in the future." |
| `stale` | "This record was changed by someone else after you opened it. Reload the page to see their change, then make yours again." |
| `forbidden` | "You don't have permission to do that here." (the existing generic) |
| `not_found` | "That record could not be found." (one string for an id that does not exist, belongs to another congregation or another presbytery, or is removed) |
| `building_removed` | "That building was removed." |
| `already_retired` / `not_retired` / `already_paid_off` / `not_paid_off` | "That building is already retired." / "That building isn't retired." / "That loan is already paid off." / "That loan isn't paid off." |
| `save_failed` | "We couldn't save that. Nothing was changed." |
| Signed out / no access | "You must be signed in to do that." / "You don't have access to that organization." (existing) |

1. *Residuals:* none denied. 2. *Source:* each message is returned only by the check it names (`validate.ts` unit table, U3, lists every message the validator can return and fails on one missing from this table); `not_found` is one string so a prober cannot tell absent from foreign (DECISION-040); the "{assessedYear}" is the year the user typed. 3. *Audience:* the submitter holds the key (or lost it mid-session, in which case `forbidden`). "Remove it first" and "Edit it instead" are actions the same key allows. 4. *Neighbours:* the old messages `presbytery.ts:504` ("Insurance expiration must be a valid date."), `:524` ("Buildings notes must be 4000…"), `:534` ("Insurance carrier must be 255…") are deleted or renamed (C4).

### C10. Roles screen and the platform admin's designation dialog

| String | Where | Audience |
|---|---|---|
| "See and record a member congregation's appraisals, insurance and loans (the presbytery's own record)" | `permissions.description`, shown beside the tick on Create role and Edit role under the financial group | presbytery administrators editing roles |
| "congregation appraisals, insurance and loans" | `PERMISSION_LABELS`, the platform administrator's "will be able to" sentence when designating a presbytery's founding administrator | platform administrators |

1. *Residuals:* the platform dialog lists the key in plain words, as `careers.applicants` does; it does not hide that a founding administrator gets it. 2. *Source:* the bundle function and `foundingAdministratorPlan()` (parity-tested). 3. *Audience:* administrators who hold `roles.manage` can tick it only if they hold it (`assertPermissionSubset`): a founding administrator does, by the bundle. 4. *Neighbours:* `founding-administrator-section.tsx:51` (add), `:145` comment (the oversight clause now covers two keys).

### C11. The portal tile

`tiles.ts:565` description: "The presbytery's own record of each member congregation: viability, profile, buildings, insurance and loans." (was "A presbytery's downward read into its member congregations."). 1. none. 2. the pages it names exist. 3. shown on the Administration hub to anyone who can see the tile; the tile promises a page, and the page answers a viewer with neither key with `OversightForbidden`. 4. grep found no test pinning the old sentence (`downward read` appears only in `tiles.ts`).

### C12. Help (Workflow Rule 17)

**New page `congregation-records`** (published, audience `administrator`, `covers: ["tile:oversight"]`, `needs: { who, appliesTo: "presbyteries" }`, order after `presbytery-reports`):

- `title`: "Congregation records: profile, buildings, insurance and loans"
- `summary`: "A presbytery's own record of each member congregation: a profile, an assessment, buildings, and, with a second permission, appraisals, insurance and loans."
- `needs.who`: "Presbytery staff. Profile, assessment and buildings need permission to manage congregation oversight. Appraisals, insurance and loans need permission to manage congregation property finances. A presbytery's Founding Administrator has both."
- `anchors`: `who-can-see-what`, `profile`, `assessment`, `buildings`, `appraisals-insurance-and-loans`, `if-something-looks-wrong`
- `verifiedIn`: set to the release it ships in (`0.61.0`) by the implementer **only after walking every label at 360px**; Phase 6 re-reads it.
- `labels` (each is on screen, each is quoted in the body): "Congregation Oversight", "Administration", "Open", "Profile", "Assessment", "Buildings", "Insurance", "Loans", "Locked", "Add profile details", "Edit profile", "Edit assessment", "Add a building", "Primary building", "Retire this building", "Bring back into use", "Remove (entered by mistake)", "Appraisals", "Record an appraisal", "Record a year", "Record a loan", "Mark paid off", "Reopen this loan", "Save", "Try again", "This record was changed by someone else after you opened it."

**Body** (written in the design so Phase 4 does not invent it; headings become the anchors):

> Where "Congregation Oversight" is turned on, a presbytery keeps its own record of each member congregation. This page is for the presbytery's staff. The record is the presbytery's own copy: the congregation does not see it, and nothing here changes what the congregation has recorded for itself.
>
> Open "Administration", choose "Congregation Oversight", then choose "Open" beside a congregation. The page has five sections: "Profile", "Assessment", "Buildings", "Insurance" and "Loans".
>
> ## Who can see what
>
> Two permissions decide it, and having one does not give you the other.
>
> | Section | What you can do | Permission you need |
> |---|---|---|
> | "Profile", "Assessment" and "Buildings" | See and change them | Manage congregation oversight |
> | "Insurance", "Loans", and the "Appraisals" on each building | See and change them | Manage congregation property finances |
>
> A section you cannot open says "Locked" and names the permission. On the list, a column you cannot see is left out, and a note above the table says which permission it needs. A presbytery's Founding Administrator has both permissions from the first day. To give the second one to someone else, such as your treasurer or stated clerk, create a role under "Roles" that includes the permission described as "See and record a member congregation's appraisals, insurance and loans (the presbytery's own record)", and give it to them. See [Roles: who can do what](/help/roles-who-can-do-what). Anyone who holds it is asked to set up two-factor sign-in the next time they sign in, if they have not already. See [Setting up two-factor sign-in](/help/setting-up-two-factor).
>
> ## Profile
>
> The profile holds the address, city, county, year organized and phone. Choose "Add profile details" (or "Edit profile"), fill in what you know, and choose "Save". Nothing is required. Type the address as you would write it on an envelope. A congregation that is on PresbyPortal can keep its own profile there; the profile here is the presbytery's own copy, so changing it does not change theirs, and theirs does not change it.
>
> ## Assessment
>
> The assessment is the presbytery's rating of the congregation (at risk, fair or healthy), its redevelopment notes, its property notes and its map location. Choose "Edit assessment". For the map location, see [Presbytery reports and downloads](/help/presbytery-reports#putting-a-congregation-on-the-map).
>
> ## Buildings
>
> Choose "Add a building". A building has a name and a type, and everything else is optional: the year built and up to two addition years, the square feet, the condition of the roof, plumbing, heating and cooling and boiler, whether it has sprinklers, a fire alarm and a security system, and notes. Only one building can be the "Primary building". A building's page has the same facts. Choose "Retire this building" for one that was sold, demolished or closed: it leaves the active list, its history stays, and "Bring back into use" undoes it. "Remove (entered by mistake)" is for a building that should never have been recorded. A removed building, and its appraisals, are no longer listed, and the page offers no way to undo it.
>
> ## Appraisals, insurance and loans
>
> These need the finance permission. On a building, choose "Record an appraisal" with the year assessed and the amount in dollars; the newest year is marked "Current". To correct an appraisal, remove it and record it again. Under "Insurance", choose "Record a year" for the policy year, carrier, policy number, expiry date, recent claims and interest in the insurance pool. There is one record for each year. A policy whose expiry date has passed says "Expired" in words. Under "Loans", choose "Record a loan": the kind (a presbytery program loan, a guaranteed outside loan or another kind), the lender, the original amount, the current balance and the date it is as of, any grants, and a note about the guarantee. "Mark paid off" sets the balance to $0 as of the date you choose, and "Reopen this loan" undoes it. A section with nothing in it says so and never shows a zero for something that was not recorded.
>
> Every change is recorded in the audit trail with who made it, and the notes and amounts are not copied into it. Looking at a record is not recorded.
>
> ## If something looks wrong
>
> - A page that says Congregation Oversight "isn't turned on": the PresbyPortal team switches it on for the whole platform. [Contact the team](/help/contact) if you need it.
> - A section that says "Locked": you do not have the permission it names. Ask an administrator to give it under "Roles".
> - "This record was changed by someone else after you opened it": another person saved first. Reload the page, then make your change again.
> - A section that fails to load has a "Try again" link, and the rest of the page still works.
> - A congregation that has left your presbytery is no longer listed. Its records are kept, but this page cannot open them. A congregation that has closed but is still a member is still listed.
> - A record marked "Imported from an earlier record" was loaded from your presbytery's earlier spreadsheet. It stays marked after you edit it.

*Photos, the two reports and the privacy sentence are Increment 2 edits (C14, C15); this page gains a "Photos" subsection then.* Banned phrases (H8) checked: none ("planned", "in the future" and the others are absent).

**Edits to existing pages (Increment 1):**

| Page | Edit |
|---|---|
| `presbytery-reports` | the map steps (C4 neighbour); `labels` gains "Edit assessment". Its other claims stay true (it describes four reports; the dashboard stays four, R7). |
| `roles-who-can-do-what` | a new subsection under "What a Founding Administrator can and cannot do": "### A presbytery's Founding Administrator" with: "A presbytery's Founding Administrator can also see and record each member congregation's appraisals, insurance and loans, where "Congregation Oversight" is turned on. To let someone else do that, create a role that includes the permission described as "See and record a member congregation's appraisals, insurance and loans (the presbytery's own record)", and give it to them. They are asked to set up two-factor sign-in at their next sign-in, if they have not already. See [Congregation records](/help/congregation-records)." Its `labels` and `verifiedIn` move only by a walk. |
| `why-cant-i-see-this` | a new `###` under "A page or button is missing": "A section on a congregation's record says "Locked"": "- What it means: the section needs a permission you do not hold. It names the permission. - Who can fix it: an administrator can give you a role that includes it in "Roles"." Adds "Locked" to `labels`. |
| `presbytery-tools` (planned placeholder, `registry.ts:1103`) | `today`: "Presbyteries can record ministerial credentials, oversight and statistics where those features are turned on, and read four reports from them. Oversight includes each congregation's profile, buildings, insurance and loans. There is no committees-and-commissions module." (Increment 2 changes "four reports" to "six reports", C15: that count is false after it ships.) |
| `coverage-allowlist.ts` | delete the `tile:oversight` entry; `ALLOWLIST_PIN` 13 to 12; the comment's "13 entries" to "12 entries", adding "the congregation records page covers `tile:oversight`". |

1. *Residuals:* the page says reads are not recorded (the finance-key residual), says removal cannot be undone, says departed congregations' records can't be opened, and says imported rows stay marked. 2. *Source:* "Founding Administrator has both permissions from the first day" is the bundle function (parity-tested); "a column you cannot see is left out" is `readOversightList`'s shape; "the newest year is marked Current" is `latestAppraisal`; "A congregation that has closed but is still a member is still listed" is the no-lifecycle-filter roster (R9; `reads.db.test.ts` pins both halves); "The page offers no way to undo it" is true of removal (no restore action exists). 3. *Audience:* the readers are presbytery staff; "Contact the team" and "ask an administrator" are things they can do; the Roles instruction is for an administrator who holds the key, which the page says they do if they are the Founding Administrator. 4. *Neighbours (grepped 2026-11-17 for oversight, insurance, buildings, loan):* `presbytery-reports.md:76-80` (modified above), `:13`, `:28`, `:32`, `:70`, `:74` (true, unchanged), `privacy-policy.md:70` (MapTiler, true, unchanged in I), `registry.ts:1103` (modified), `coverage-allowlist.ts:28` the `tile:oversight` line (deleted).

### C13. Release-note lines, Increment 1 (written for non-engineers; the `/release-notes` skill places them)

- "Presbyteries can now keep a profile for each member congregation (address, city, county, year organized and phone), a record of its buildings, and notes on its condition, on the Congregation Oversight page."
- "A second, separate permission, "manage congregation property finances", covers each building's appraisals, a congregation's insurance by year, and its loans. A presbytery's Founding Administrator has it from the first day and can give it to a treasurer or stated clerk under Roles. Anyone who holds it is asked to set up two-factor sign-in."
- "All of this is the presbytery's own record. The congregation does not see it."
- "The insurance carrier and expiry boxes on the assessment form are gone; insurance is now recorded by year. [Only if the deploy-day count is 0:] Nothing had been entered in them in production."
- "A congregation that has left a presbytery can no longer be opened from this page."
- "Every change is recorded in the audit trail. Looking at a record is not."

1. none denied (the third and last lines state residuals). 2. The "Nothing had been entered" sentence is conditional on the **deploy-day count**, not on the 2026-11-17 read. 3. Read by administrators and the operator. 4. Neighbour: `docs/release-notes/v0.60.md` makes no oversight claim that this contradicts (the map note says congregations with a location show on the map: still true).

(Increment 2's strings are C14 to C16 in the Increment 2 section below.)

### C14. Photos (Increment 2) — manage

On a building's page a "Photos" block shows the cover and a link "All photos ({n})" (or "Add a photo" when none). The photos page: h1 "Photos of {name}"; "Back to {name}"; button "Add a photo"; a two-column grid at 360px, each tile a button with accessible name "View larger: {caption or 'photo'}". The larger view (`?view=<photoId>`): the picture, the caption, "Edit caption", "Make this the cover" (hidden on the cover), "Remove photo", "Back to all photos". Caption field label "Caption (optional)", max 200, "Caption must be 200 characters or fewer." Toasts "Photo added.", "Caption saved.", "Cover changed.", "Photo removed." Remove AlertDialog: title "Remove this photo?", body "It will no longer be listed here. The picture file itself stays in storage and can't be erased from here.", buttons "Remove photo", "Cancel". Refusals (the person-photo strings, building-worded): `unsupported_type` "That file isn't a JPEG, PNG or WebP picture. If it's an iPhone photo, pick it from your photo library or convert it to JPEG first."; `animated` "Animated pictures aren't supported. Choose a still picture."; `too_many_pixels` "That picture is too large to process. Try a smaller one."; `too_large` "That picture is too big to upload. Try a smaller one."; `unreadable` "We couldn't read that picture. Try a different file."; `empty` "That file is empty."; `duplicate` "That picture is already in this building's photos."; `cap_reached` "This building already has 10 photos. Remove one to add another."; `already_removed` "That photo was already removed."; `save_failed` "We couldn't save that photo. Nothing was changed. Try again."; the client rejection "That picture couldn't be uploaded. Check your connection, or try a smaller picture." (all reused from `person-photos/copy.ts` where generic).

1. *Residuals:* the remove dialog states the `bytea` residual in words ("stays in storage and can't be erased from here"); an orphaned blob after a failed save is not mentioned because the user cannot act on it, but nothing denies it. 2. *Source:* "10" is `PHOTO_CAP` read after the row lock; "iPhone photo" hint is the HEIC refusal (the sniffer's `unsupported_type`). 3. *Audience:* manage holders, who can add and remove. 4. *Neighbours:* `person-photos/copy.ts` strings are person-worded and stay untouched; `privacy-policy.md` gains a sentence (C15).

### C15. Reports, CSV and privacy (Increment 2)

| String | Where |
|---|---|
| Hub cards: "Buildings" ("Every building recorded for your member congregations, with its year, size, condition and safety systems." source "From Congregation Oversight."), "Insurance and loans" ("Each congregation's newest insurance, its open loans and its appraised value." source "From Congregation Oversight.") | `HUB_COPY.cards` |
| Locked reasons: the existing `lockedReason(phrase)` with "manage congregation oversight" and "manage congregation property finances" | hub and each report |
| Report titles "Buildings" and "Insurance and loans"; page subtitle `The congregations that are members of {org} today.`; roster note "A congregation that is no longer active isn't listed here." (new) | report pages |
| Buildings columns: "Congregation", "City", "County", "Building", "Type", "Year built", "Square feet", "Roof", "Plumbing", "Heating and cooling (HVAC)", "Boiler", "Sprinklers", "Fire alarm", "Security system", "Primary"; a congregation with no building shows "None recorded" | `BUILDINGS_COPY` |
| Insurance-and-loans columns: "Congregation", "Carrier", "Policy year", "Policy expires", "Recent claims", "Interested in the insurance pool", "Open loans", "Original amount", "Current balance", "Grants", "Guarantee", "Appraised value"; beside a total that leaves unrecorded figures out: "{n} not recorded" | `INSURANCE_LOANS_COPY` |
| CSV headers (snake case, as the four existing): buildings `congregation,city,county,building,building_type,year_built,first_addition_year,second_addition_year,square_feet,roof_condition,plumbing_condition,hvac_condition,boiler_condition,sprinklers,fire_alarm,security_system,primary`; insurance-and-loans `congregation,carrier,policy_year,policy_expires_on,recent_claims,pool_interest,open_loans,original_amount,balance,balance_unrecorded_loans,grants,guarantee,appraised_value,buildings_without_appraisal`. Amounts are decimal dollars (`centsToDecimal`), years and counts go through `csvIntegerCell`, every text cell through `csvTextCell`. **Never in either file:** street address, policy number, any free-text note. | `csv.ts` |
| "Export CSV" (existing) | both pages |
| Help `presbytery-reports`: the lead sentence "four reports" becomes "six reports"; two table rows (Buildings: "Congregation Oversight", Manage congregation oversight; Insurance and loans: "Congregation Oversight", Manage congregation property finances); a "## Buildings" and a "## Insurance and loans" section; the "Downloading a report" paragraph's omission list gains "policy numbers and notes"; `labels` gain the new card, column and report titles | `presbytery-reports.md`, `registry.ts` |
| Help `congregation-records`: a "## Photos" subsection: "Open a building, then "All photos" or "Add a photo". Choose a picture from your phone's photo library or camera. It is shrunk on your phone before it is sent, then re-saved here without its location or camera details. A building keeps up to 10 photos; the first is the cover, and "Make this the cover" changes it. Photos are stored privately for the presbytery's staff and are never published, on the website or anywhere else." | help |
| `privacy-policy.md`: one bullet under what we keep: "**Building photos** a presbytery's staff add to a congregation's record are stored privately, are never published, and are removed from view, not erased, when staff remove them." | help |
| `presbytery-tools` `today`: "…and read six reports from them." | registry |

1. *Residuals:* the photo help and privacy sentence say "removed from view, not erased" (the `bytea` residual); CSV help says what is omitted and that downloads are recorded. 2. *Source:* "Appraised value" is the sum of each live, non-retired building's newest appraisal and "buildings_without_appraisal" counts the rest (`report-rows.ts`); "{n} not recorded" counts open loans with a null balance; "stored privately … never published" is `asset_audience = 'private'` pinned by CHECK and FK, and `presby_public_site_asset()` returning nothing for the key (test-rls-89 h); "re-saved without its location" is `processPhoto`'s always-re-encode, which keeps no metadata. 3. *Audience:* report cards and pages are for the key holders, the privacy page is for everyone; "staff" is accurate for both. 4. *Neighbours (modify):* `presbytery-reports.md:1` ("four reports"), `:7-17` (table), `:93-97`; `registry.ts` `presbytery-reports` `summary` ("Four reports for a presbytery…") and `needs.who`; `copy.ts:20-21` (`HUB_COPY.intro` says "Read each report on screen or download it as a CSV file", still true) ; `presbytery-reports/help-page.test.ts` (it pins the table to the contract: update with it); the **dashboard's "four" statements stay** (`copy.ts:228`, `presbytery-reports.md:20-30`: the dashboard has four cards and no new card, R7).

### C16. Release-note lines, Increment 2

- "Staff can add photos to a building on a congregation's record: choose one from your phone's photo library or camera, add a caption, and mark one as the cover. Photos are private to the presbytery's staff and are never published."
- "Two new reports join the four on the reports page: Buildings, and Insurance and loans, each with a spreadsheet download. The files leave out street addresses, policy numbers and notes. Downloads are recorded."
- "Removing a photo hides it; the picture file itself is kept."

## Test plan

DB-backed tests run serially against the pipeline Neon branch (`npx dotenv -e .env.local -- vitest run --no-file-parallelism <file>`, docs/testing.md). **Every mechanism is proven failing-first** (the implementer shows the test red against a deliberately broken guard, then green), the standing practice for guards.

**Unit (no database).**

| ID | File | Pins |
|---|---|---|
| U1 | `src/lib/oversight/validate.test.ts` | every schema's boundaries: years 1599, 1600, current, current+1 (policy year), 2100; money `0`, `0.01`, `1250000`, `1,250,000`, `$5`, max, max+1, `1e5`, `-1`, `12.345`, empty; square feet 0, 1, 5,000,000, 5,000,001, `12.5`; address 6 and 7 lines (and the control-character and LF handling of `normalizeAddress`); phone characters; control characters in names; addition-year ordering; the loan pair rules; future dates against an **injected** `today`; `{year}` interpolation |
| U2 | `derive.test.ts` | `expiryState` (today is not expired, yesterday is), `latestAppraisal` (newest year wins), `loanTotals` (sums recorded, counts unrecorded, never a false zero), `formatMoney`, tri-state and condition labels |
| U3 | `copy.test.ts` | every message `validate.ts` and `store.ts` can return exists in `copy.ts`; no string contains "everything is recorded", "nothing is kept", "only", "never deleted"; the Locked and empty strings are byte-identical across sections where this design says so |
| U4 | `contract.test.ts` | the closed lists, limits and `CHANGED_FIELDS` equal the CHECK lists and `char_length` bounds **parsed out of `drizzle/0089_presby_oversight_records.sql`** (a list changed in one place fails) |
| U5 | `boundaries.test.ts` | R4: no owner connection (`getPlatformDb`, `PLATFORM_DATABASE_URL`, `MIGRATE_DATABASE_URL`) in the module or under `oversight/**`; the six table names (SQL and Drizzle identifiers) appear only in `store.ts`, `photo-store.ts`, `photo-reads.ts`, `reads.ts`, `report-rows.ts`, `db/domain/oversight.ts` and `dev-docs.ts`; `store.ts` is the only writer of five tables and `photo-store.ts` of the sixth (no `.insert(`/`.update(` of a table elsewhere); no `recordAudit` in the module; no `route.ts` and no `loading.tsx` under `oversight/**`; every `page.tsx` calls `gateOversightPage`; every `actions.ts` calls `assertOrgSession` before `resolveOrgContext`; no `callbackUrl` or `next` read; no `sharp` import; `getBlobStore().store(` only in `photo-store.ts` with the literal `audience: "private"`; no `type="number"` input in `src/components/oversight/` or the forms; each rule has a failing sample |
| U6 | `audit-coverage.test.ts` | each store write function calls `insertAuditRow` once; metadata keys equal the allowlist; sentinel values in every free-text and money field appear in no audit row |
| U7 | `presbytery-reports/gate.test.ts` additions | `gateOversightPage` runs signed-in, `assertOrgSession`, four-way miss, `assertOrgAccess`, `org_portal.oversight`, type, in that order; flag off and wrong type give their own states |
| U8 | page tests (list, record, every form page) | gate before any read; non-UUID segment 404s before any reader is called; `forbidden` gives `OversightForbidden`; Locked per section from a mocked key set; one section's rejection leaves the others rendered; an `OrgAccessError` is rethrown |
| U9 | form tests | each root inside `HydrationGate`; the messages of C9 on the right field; a failed save keeps the values; money and year inputs are `type="text"` with `inputMode`; the `{year}` hint; the managed note |
| U10 | `presbytery.test.ts` | **F451/F454:** neither `insuranceCarrier` nor `insuranceExpiresOn` appears in `src/lib/presbytery.ts` (source scan); a legacy row inserted with a carrier and expiry survives a `setCongregationOversight` save with its two columns unchanged (DB test in the same file) |
| U11 | `founding-administrator.test.ts`, golden | presbytery list is `[...base, manage, finance]` (13), congregation and synod unchanged, worship order preserved |
| U12 | help | `npm run check:help` and `coverage.test.ts` (pin 12), `help-page.test.ts` |

**DB (serial).**

| ID | File | Pins |
|---|---|---|
| D1 | `src/lib/db/domain/oversight.schema.test.ts` | the Drizzle mirror equals the migration's columns, nullability and constraint names (`getTableConfig` against `information_schema`), the worship precedent |
| D2 | `src/lib/db/domain/oversight.db.test.ts` | on **both** connections (`presby_app` and the owner, F44): every CHECK boundary; every partial unique (a removed name or year is reusable, a second live one is refused); the triple FK rejects a photo, appraisal or loan naming another congregation's building; the about-org trigger refuses a never-affiliated and a departed congregation on insert and allows an edit that does not move `about_org_id`; removal is one-way and immutables hold; `presby_oversight_building_live_guard` refuses a new child of a removed building and **serializes** with a concurrent removal; a photo with a public-site blob is refused by the FK; `presby_app` has no DELETE or TRUNCATE (by `aclexplode`); the **fixture teardown cascade** deletes a presbytery and everything under it; the bundle function equals `foundingAdministratorPlan()` for every organization type |
| D3 | `src/lib/oversight/store.db.test.ts` | every store function: a missing key writes nothing and audits nothing; success writes exactly one audit row **in the same transaction** (an injected audit failure leaves the data unchanged); `stale` on a version mismatch writes nothing; an unchanged edit writes and audits nothing; a congregation of another presbytery and another congregation's building both give `not_found`; the about-org refusal maps to `not_found`; **concurrency:** two simultaneous creates of one name end with one row and one `duplicate_name`; two simultaneous "make primary" on different buildings end with exactly one primary; two simultaneous insurance records for one year end with one; paid-off writes balance 0 and the date together |
| D4 | `src/lib/oversight/reads.db.test.ts` | each reader returns `forbidden` for a person without its key (and no data), in its own transaction; `readOversightList` returns **no tier-2 field** for a manage-only viewer and no tier-1 field for a finance-only viewer; the roster includes a closed congregation still under the presbytery and excludes one that departed; **query count is fixed** (a counting wrapper: the same number of statements for 2 and for 30 congregations); `readTodayInOrg` uses the organization's time zone |
| D5 | `two-factor-default.db.test.ts`, `invitations.db.test.ts`, `designation-parity*.db.test.ts` | ten flagged keys; the presbytery founding role holds the finance key after designation and after the backfill; a congregation's does not |
| D6 | `scripts/oversight/test-0089-migration.sh` | 0089 applied twice leaves identical function bodies, constraint definitions and counts; the second apply's backfill notice reports 0 |
| R | `scripts/oversight/test-rls-89.sql` | sections (a) to (i) in the Data Model section; the patched `test-rls.sql` exit 0 from empty |

**E2E (Playwright).** Own server per run: `E2E_BASE_URL=http://localhost:3102` (3103 for the production hydration lane), started by the runner and stopped by PID (never `pkill -f next`); a run attached to :3000 is discarded (Rule 16). New fixture `e2e/support/oversight-fixture.ts` (NEW file, modelled on `worship-fixture.ts`: a throwaway presbytery and two congregations with open affiliations, a second throwaway presbytery with one congregation for the cross-presbytery cases, a throwaway founding administrator minted through `presby_apply_founding_administrator`, and MFA-enrolled throwaway users via `createThrowawayUser`/`seedTotpEnrollment`). **Ids** `00000000-0000-4089-8000-` (people), `00000000-0000-4089-9000-` (roles), `00000000-0000-4089-9001-` (organizations, unique per run so append-only audit rows never mix runs); grepped `e2e/` and `scripts/`: `4065`, `4068`, `4083`, `4085`, `4087` are taken, `4089` is free. Teardown deletes the six tables' rows as the owner first (the about-org FK has no cascade), then the organizations. **Verify the cascade in B1's first hour**; the fallback is deleting the affiliation rows first.

| Spec | Flags it sets (via `flags.ts`) | Covers |
|---|---|---|
| `oversight-records.spec.ts` (new, Increment 1) | `org_portal.oversight` | the existing `presbytery-clerk` (manage only, no 2FA): profile add and edit; building add, edit, duplicate name refused, primary move, retire, bring back, remove; **Locked** Insurance and Loans and a direct hit on `/insurance/new` and `/loans/new` (forbidden state, nothing written); 404 for a non-UUID, another presbytery's congregation, another congregation's building and a removed building, byte-identical bodies; audit rows exist and carry no value (sentinel text); a 120-character building name at **360px with no sideways scroll** (`scrollWidth <= clientWidth`); every control `min-h-11`; the back link and no `callbackUrl` |
| `oversight-finance.spec.ts` (new, Increment 1) | `org_portal.oversight` | an MFA finance holder: appraisal, insurance year, loan (record, edit, stale refusal from a second context, mark paid off, reopen, remove); list shows the insurance column and **no** viability or city; `Expired` in words; amounts shown; 360px walk |
| `oversight-founder.spec.ts` (new, Increment 1; **the R2 walk**, the F362 lesson) | `org_portal.oversight` | (1) a presbytery founder minted through the real definer sees the finance sections with no further grant; (2) creates a custom role carrying the key (the subset check passes) and grants it to a second person; (3) that person is sent to enrol two-factor, then sees Insurance and Loans and **Locked** Profile, Assessment and Buildings; (4) a manage-only person sees Locked finance sections; the bundle key list read from the database |
| `hydration/oversight-forms.spec.ts` (new, Increment 1) | none | held JS chunks: the building form's inputs are not operable before hydration (prod lane `PW_PROD_BUILD=1`, port 3103) |
| `oversight-photos.spec.ts`, `oversight-reports.spec.ts` (new, Increment 2) | `org_portal.oversight`, `org_portal.reports` | upload (generated image) end to end at 360px, cap, remove, cover, no photo bytes in the audit row; both reports, CSV content (no street address, policy number or note; a leading `=` is guarded), export audit row, locked cards |

### E2E blast radius: existing specs this change alters

- **`e2e/presbytery-oversight.spec.ts`** (flag `org_portal.oversight`, set by the spec): case 2 fills `#oversight-insurance-carrier` and `#oversight-insurance-expires` (deleted fields) and goes to the old URL; cases 6, 7, 8 and 9 go to `/oversight/<id>` and use `#oversight-viability`, `#oversight-latitude`, `#oversight-longitude` (**the URL becomes `/oversight/<id>/assessment/edit`**, element ids unchanged). Cases 1, 3, 4 and 5 are unchanged by design: case 1 asserts the `Congregation` column header and the names; case 3 the unchanged `OversightForbidden` text; cases 4 and 5 the placeholders.
- **`e2e/presbytery-map/map.spec.ts`** case 7 (the loop) goes to `/oversight/${GAMMA.id}` and fills the latitude: the **new assessment URL**. Line `:477` (`waitForURL('**/admin/oversight/${ALPHA.id}')`) still holds: the record page is the same URL, now a sections page. The map specs set `org_portal.insights` and `org_portal.oversight` themselves.
- **`e2e/presbytery-dashboard.spec.ts`** asserts only the oversight link `href`s: unchanged.
- **Unit and DB tests changed in place:** `oversight/page.test.tsx`, `[aboutOrgId]/page.test.tsx`, `edit-form.test.tsx`, `oversight-schema.golden.test.ts` (carrier and expiry fields removed), `presbytery.test.ts` (messages, the carrier and expiry cases), `readers.db.test.ts:347`, the six pins in the Feasibility list, `src/lib/help/coverage.test.ts`, `presbytery-reports/help-page.test.ts` (Increment 2).

## Carry-forward

**Phase 2 rulings R1 to R10, F450 to F453, orchestrator rulings.**

| Phase 1 gap / Phase 2 ruling | Addressed here (where), or *deferred* (who accepted) |
|---|---|
| R1 table-granular tiering; appraisal housing | Data Model (six tables, one key each); T4 (appraisals immutable); column fallback rejected and not used |
| R2 / DECISION-345 / F450 finance key in the founding bundle | Permissions & Flags; Data Model sections 1 to 3; the TypeScript mirror and parity pins; Deploy checklist 3; **CLAUDE.md third known violation and the Project Layout lines are the orchestrator's integration edit** (architect's text, unchanged) |
| R2 F362 coordination | Feasibility check (no branch carries it; 0089 first; header paragraph; TODO sentence at integration) |
| R2 Phase 6 founding-administrator walk | Test plan, `oversight-founder.spec.ts`, and the Phase 6 handoff below |
| R2 2FA deploy-day count; restate the 2FA comments | Deploy checklist 3; Data Model section 8 (start from the live `pg_description`) |
| R3 / DECISION-347 / F452 gate, `assertOrgSession`, UUID 404s, either-key front door, `resolveMemberCongregation` export | Module plan (`gateOversightPage`), API Contract common body, Page Plan, T7; **`setCongregationOversightAction` gains `assertOrgSession`** |
| R4 / DECISION-344 module, writers, boundaries test, `audience-callsites` rows, `check:audit` blind spot | Module plan; U5, U6; FORWARD rows in I and ACTIVE in II; the blind spot is stated in the API Contract and U6/D3 stand in; **T10 adds `photo-reads.ts`** (small, justified) |
| R5 migration 0089 (guard, columns, money, years, indexes, triggers, grants, comments, idempotence, test-rls, seed) | Data Model in full; **T3 narrows "every money and year nullable" by four identity columns**; the "not after this year" bound is an application rule (C9) |
| R6 / DECISION-346 photo extraction | Increment 2, Batch B5 (refactor commit first; required thumbnail argument; `SHARP_FILES` in three places; CLAUDE.md lines at integration) |
| R7 / DECISION-348 reports | Increment 2, Batches B7 and B8; C15; roster active-only stated in the copy; no dashboard card |
| R8 / DECISION-347 / F451 superseded fields | Module plan (`presbytery.ts`), **F454 (the read side)**, U10, Data Model section 8, Deploy checklist 2 (production count 0, 2026-11-17, re-counted on deploy day) |
| R9 / F453 former members | `readOversightList` roster; D4 pins both halves; the about-org trigger behaviour in D2; **a `docs/TODO.md` line for the "former members" view is added at integration (orchestrator)**; help states the limit |
| R10 optimistic check | T5 (built, `row_version`, all four editable tables); D3 |
| R10 no commission or delegation guard on the key | Accepted as ruled; nothing built |
| R10 `presby_app` DELETE on `congregation_oversight` | Untouched; stays with the monthly security review (DECISION-343) |
| Orchestrator rulings 1 to 4 | 1 superseded in mechanism by the confirmed R2 option A (the founding administrator still decides who else holds it); 2 Flow 9 note (C2); 3 loan fields (loan table, import contract; the program-loan and grants figures are optional integer cents, the guarantee is free text); 4 the help names "your treasurer or stated clerk" generically (C12) |
| Phase 1 Gap 1 ownership after joining | The presbytery's copy stays editable, labelled (C2); no sync |
| Gap 2 congregation sees nothing | Tables are the presbytery's; test-rls-89 (d) and D4; help states it |
| Gap 3 finance-only front door | T7 (with the city and county correction); either-key gate |
| Gap 4 superseded fields; list column derived | T8, C1, R8 row above |
| Gap 5 appraisal housing | R1 row above |
| Gap 6 loans and money shape | `oversight_loans`; integer cents; one balance plus as-of; the building link exists and has no UI (T9) |
| Gap 7 one policy per year | The live-year unique index; stated limitation in the help ("There is one record for each year") |
| Gap 8 photos vs DECISION-312 | Increment 2 (R6) |
| Gap 9 closed or departed congregations | R9 row above |
| Gap 10 concurrent edits | R10 / T5 |
| Gap 11 prototype columns held with no loss | Data Model plus the Import contract; free-text conditions go to `notes` (T2) |
| Gap 12 cross-congregation child rows | The triple FK; the building-live guard; `buildingId` resolved under `(org, about)` or 404; D2, D3, test-rls-89 (e) |
| Phase 1 adversarial pass: redirects, state-machine shortcuts, IDOR, enumeration, input boundaries, CSV, self-targeting, 2FA, audit | `callbackUrl` absent (U5); every deep URL runs the same gate (U8); Locked sections denied inside the reader's transaction (D4); one `not_found` string (C9); U1; CSV in Increment 2 (`csvTextCell`, `csvIntegerCell`); no self-targeting action exists; `oversight-founder.spec.ts`; U6 |
| Phase 1 edge cases (empty, failure microcopy, 360px, expired in words, roll untouched) | C2 to C8; U9; E2/E3 360px walks; this feature touches no roll data |
| Phase 1 Out of Scope list | Repeated verbatim under "Out of Scope" below |
| Phase 1 Help impact list | C12 (new page, four edits); C15 (Increment 2 edits); no screenshots; `limitationUntil` none |
| F453 accepted for v1 | Accepted by the architect (Phase 2); carried as a help sentence and a TODO line |
| **New:** F454, F455 | Filed above. F454 fixed in Increment 1. **F455 deferred** to the monthly security review by the tech-lead; the operator is told in the completion report |

## Edge Cases & Risks

Each claim cites the test that will pin it, or says *unverified*.

- **Two clerks create the same building name or make different buildings primary at once.** The database refuses the second (live-name and one-primary partial uniques); the store maps it to `duplicate_name` / moves the mark inside one transaction. Pinned by D2 and D3's concurrency cases.
- **A stale edit.** The second save returns `stale`, writes nothing, and the form keeps its values. D3, U9, `oversight-finance.spec.ts`.
- **An id from another congregation, another presbytery, a removed building, or a non-UUID.** All 404 with the same body; no 403 proves existence. D3, U8, `oversight-records.spec.ts`.
- **A viewer holds neither key.** `OversightForbidden`, and no congregation is resolved first (no existence leak). U8, existing e2e case 3.
- **A manage-only viewer opens `/insurance/new` by URL.** The page's reader returns `forbidden` inside its transaction and the page renders the finance Locked/forbidden state; the action refuses with `forbidden` and writes nothing. D4, D3, `oversight-records.spec.ts`.
- **A finance-only viewer.** The list object holds no city, county, viability or building count. D4.
- **The audit insert fails.** The change rolls back with it. D3 (injected failure).
- **A building is removed while a photo upload or appraisal is in flight.** The `FOR SHARE` guard serializes them; the later one is refused. D2 (concurrent test).
- **Removing a primary building.** The same UPDATE clears `is_primary`, so the partial unique never holds a dead primary. D3.
- **A retired building cannot be primary.** CHECK `oversight_buildings_primary_not_retired`. D2.
- **Departed congregation.** Unreachable in the UI, rows intact, edits at the database allowed, new top-level rows refused. D4, D2, test-rls-89 (f).
- **Production's legacy carrier and expiry values.** Read-only count 0 on 2026-11-17; **re-counted on deploy day**; if not 0, the import session converts them. The first assessment save after the deploy does not null them even if present. U10.
- **Imported rows after an edit.** Still `imported` (provenance is immutable). D2 pins the immutability; the help says so.
- **"Expired" uses the organization's local date.** U2 (injected `today`), D4 (`readTodayInOrg`).
- **Money.** Cents are `bigint`; the maximum is 100,000,000,000; a `number` holds that exactly. U1, D2.
- **A very long name or notes text wraps at 360px without sideways scroll.** Pinned by `oversight-records.spec.ts` (120-character name) once written; **unverified** until B4 runs it. Dark-mode badge contrast is **unverified** until the Phase 6 walk.
- **Browser back after "Remove".** The removed building's page 404s on reload. `oversight-records.spec.ts`.
- **Retire date before the year built, or an insurance expiry before its policy year.** Not validated (a legitimate odd record is not blocked); *unverified* that no real case needs it, accepted.
- **The list's per-congregation numbers use four to six queries.** D4's counting wrapper.
- **Photo cap under two simultaneous uploads (II).** Counted after `for update` on the building row; D3-photo concurrency case. A byte-identical re-upload is "already there". Worst-case storage is about 4 MB per building at the cap (accepted, DECISION-346).
- **An orphaned blob when the final photo transaction fails (II).** Accepted residual (DECISION-312's family); not user-visible.
- **CSV (II).** A leading `=`, `+`, `-`, `@` is guarded; integers are numbers; neither file holds a street address, policy number or note. `csv.test.ts`, `oversight-reports.spec.ts`.
- **A platform administrator.** Reads none of this through any page: the tables are `presby_app`-only and no platform page names them. test-rls-89 (c), (d), U5.
- **The deploy order.** New code against an unmigrated database fails on missing tables; the runbook puts 0089 first. Pre-deploy runbook text; unverified until the deploy.
- **A deploy-day finding.** If the "newly required, not enrolled" count moves, stop and tell the operator (the bundle backfill was designed to move it by 0).

## Out of Scope (explicit non-goals; the operator confirms)

- A congregation viewing or editing its own property record, and publishing a profile upward.
- A view-only permission and any separate export permission.
- A presbytery audit-log page (the writes are audited; a later pipeline reads them).
- Several policies per year, premiums, loan schedules and balance history.
- Auto-geocoding an address; an importer UI or a committed importer (T11); a congregation-to-building link control on loans (T9).
- Committees, commissions, presbytery offices, mission giving and worship times.
- A "former members" view (F453).
- Photos of the congregation itself; any wiring into the public site, the footer or JSON-LD.
- Editing an appraisal in place (T4); editing a policy year in place.
- Moving the assessment write's audit into its transaction (F455).
- A what's-new entry (the operator's standing rule: drafts stay in work-logs).

## Help impact

Per C12 and C15: **adds** `congregation-records` (Increment 1); **edits** `presbytery-reports` (I and II), `roles-who-can-do-what` (I), `why-cant-i-see-this` (I), `privacy-policy` (II), the `presbytery-tools` placeholder sentence (I, again in II); **removes** the `tile:oversight` allowlist entry and lowers the pin to 12. No `[help:<token>]` line is needed: the page ships `published` in the same PR with no `requires`. No `limitationUntil` is removed. No screenshots. Phase 6 reads each of the five page names against the shipped build; a page that contradicts it is NEEDS REWORK (Rule 17). **Release notes and the functionality map** (Rules 13, 14) are written after Phase 6 SHIP IT through the `/release-notes` skill, with `package.json` 0.61.0 then 0.62.0.

## Phase 6 handoff (what the analyst must walk)

1. The founding-administrator path (R2): a fixture presbytery founder designated through the real function; the custom role; the second person's forced enrolment; the Locked sections for a manage-only person.
2. Every page at 360px as the people each path creates, not as seeded fixtures; list each page walked.
3. Increment 2: a real phone-photo upload on a deployed environment with a non-identifying picture.
4. The five help pages read as their reader against the shipped build.

## Implementer

**Increment 1:** database-admin (B1), api-developer (B2), ux-developer (B3), full-stack-developer (B4). **Increment 2:** api-developer (B5, B7), ux-developer (B6, B8), full-stack-developer (B9). The orchestrator applies the integration patches and the CLAUDE.md edits.

**Operator rulings needed:** none to proceed. Two things are the operator's to see in the completion report, both reversible by a small change before release: (1) the founding administrator of every presbytery receives the finance key (the confirmed R2 option A, with its CLAUDE.md known-violation entry); (2) the production flag `org_portal.oversight` has to be switched on for any of this to be reachable. One non-blocking term question for the presbytery's clerks: whether "Interested in the insurance pool" is the right label for the prototype's pool-interest column (Phase 1 Open Question 3 covered the loan columns, not this one); the default is the label as written.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 3 — Technical design | tech-lead | Complete (one design for both increments; T1–T12; DECISION-349–351 proposed, 352 held; F454–F455; migration 0089; Inc 1 batches B1–B4, Inc 2 batches B5–B9; two child logs created) | Design complete | 2026-11-17 |

## Handoff

Next agent: **database-admin** (Increment 1, Batch B1, in `docs/work-log/2026-11-17-congregation-profile-inc1.md`), after the orchestrator records DECISION-349 to 351 and numbers F454 and F455 in `docs/decisions.md` and `docs/TODO.md` (Rule 16 shared files).

The implementer reads, in this order: this Phase 3 in full (Data Model, Module and file plan, API Contract, **Copy**), then its child log's batch table. A string not in Copy stops for a ruling. Pre-assigned numbers: migration 0089, DECISION-344 to 352 (349 to 351 used here), F450 to F455 used, dev port 3102 (3103 for the production hydration lane), e2e ids `00000000-0000-4089-…`.

Orchestrator, at integration (Rule 16 and the architect's list): the five `scripts/oversight/*.integration.patch` files; the CLAUDE.md third known violation (architect's text) and the Project Layout lines for `src/lib/oversight/` and (Increment 2) `src/lib/storage/image/`; one sentence on the F362 TODO line; a TODO line for F453's "former members" view and one for F455; the two release notes; `docs/product/functionality-map.md`.

Files read for this phase, all in `/Users/cshenso/git/presby-platform/presby-profile`: this log; `src/lib/presbytery.ts`; `src/lib/db/domain/presbytery.ts`; the oversight pages, list, states, form, schema and action under `src/app/(org)/o/[slug]/admin/oversight/`; the reports hub, page and viability page; `src/lib/presbytery-reports/{contract,gate,viability,audit,hub,roster,csv,copy,boundaries.test}.ts`; `src/lib/org-portal/{permission-check,session-check,tiles}.ts`; `src/lib/audit-tx.ts`, `src/lib/audit.ts`; `src/lib/onboarding/founding-administrator.ts`; `src/lib/help/{registry,coverage-allowlist,coverage.test,checks}.ts`; `src/content/help/{presbytery-reports,roles-who-can-do-what,why-cant-i-see-this,privacy-policy,worship-setting-up}.md`; `src/lib/person-photos/{image,limits,copy}.ts`; `src/lib/storage/{audience-callsites.test,blob-store}.ts`; `drizzle/{0045,0078,0080,0085}`; `scripts/{seed-dev,test-rls,check-audit-coverage,ci/e2e-baseline-flags}`, `scripts/worship/*`, `scripts/giving/test-rls-46.sql`; `e2e/presbytery-oversight.spec.ts`, `e2e/presbytery-map/map.spec.ts`, `e2e/support/{users,seed-orgs,flags,worship-fixture,enrolment-fixture}.ts`; `docs/TODO.md` (F362); the prior-art `psvonline-portal` schema and import script for column shapes only (no value carried over).

---

# Phases 4 to 6

Recorded in the child logs, one per shipped increment (see "Children" at the top): `docs/work-log/2026-11-17-congregation-profile-inc1.md` and `docs/work-log/2026-11-17-congregation-profile-inc2.md`. The analyst's Phase 6 verdict for each increment is recorded in its own child; the parent closes when both have shipped.
