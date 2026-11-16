# Presbytery reports with CSV export — Work Log

> **Slug:** `2026-11-15-presbytery-reports`
> **Surface:** (org) — `/o/<slug>/admin/reports` and siblings, presbytery only
> **Permission(s):** existing keys only, one per report (`credentials.manage`, `statistics.manage`, `congregation_oversight.manage`, `per_capita.manage`); an export uses its page's key; no new key (Phase 1, Phase 3)
> **Flag(s):** not needed (existing `org_portal.reports`; operator rule: no new global flags pre-live)
> **Estimated complexity:** medium
> **Pipeline mode:** Full (adds routes: CSV export route handlers)
> **Worktree:** `../presby-reports`, branch `pipeline/presbytery-reports`; Neon branch `pipeline-presbytery-reports` (`br-mute-tree-axpmuezq`, endpoint `ep-rapid-thunder-axjm1eom`)
> **Dev server port:** 3102 (never 3000)
> **Pre-assigned numbers:** DECISION-337 to 339, F445 to F449, no migration (0089 released by Phase 2)

## Source

Operator, 2026-11-15: "after you are done pushing site changes then maybe organize the work to push the presby over the finish line. do what you can and then save things that might need some functional and architectural guidance as designs and share them with me", then "keep going on the stuff you can for the presby functionality taking it all the way to production to get me a good working demo."

The gap review of the operator's prototype (`../../psvonline-portal`, a presbytery portal built for the Presbytery of Scioto Valley) against PresbyPortal found the presbytery's data model largely present and its reports missing. The prototype has `(app)/reports/{membership,per-capita,viability,buildings,vacant,map}`, each with "Export CSV" (`src/lib/csv.ts`). The operator's design page ("Presbytery finish line", shared 2026-11-15) lists "Reports v1 with CSV export" as the first item that needs no ruling from the operator: vacant pulpits, membership trend, viability list, per-capita report, each exportable, on the giving export's pattern (`admin/giving/gifts/export/route.ts`). Excel export is deferred (open question F on that page); the map is the dashboard pipeline's.

Existing: `/o/<slug>/admin/reports` (statistics table and form, per-capita rate, records, payments, grants) over `src/lib/presbytery.ts` (`getCongregationStatisticsRollup`, `getCongregationFilingHistory`, `getPerCapitaOverview`, `getCongregationOversightList`); appointments on the credentials page (`src/lib/db/domain/officers.ts` `appointments`). TODO: "Presbytery Increment 5 — imports and reports" (this pipeline takes the reports half; imports stay with the executor pipeline).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Done | READY WITH NOTES | 2026-11-15 |
| 2 — Architectural review | architect | Done | Approved with suggestions | 2026-11-15 |
| 3 — Technical design | tech-lead | Done | Design complete | 2026-11-15 |
| 4 — Implementation | full-stack-developer | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES. Phase 3 takes the notes as inputs. None of them needs the operator before design starts. Two derivation rulings (vacancy and the viability scale) are made below and should be confirmed in passing at the demo.

## ONE-LINE TAKE

> Give a presbytery's staff four read-only reports (vacant pulpits, membership trend, viability, per capita). Each one is a page and a matching CSV download, built only from data the presbytery already enters. The two risks are a vacancy list that lies when appointments have not been entered, and a CSV that carries tenant-written text into a spreadsheet.

## User Verbs

Every verb belongs to one surface: the **authenticated member who is presbytery staff** at `/o/<slug>/admin/reports/...`. Nothing here touches the anonymous, access-pending or platform-admin surfaces.

| Surface | Verb | Cadence |
|---------|------|---------|
| Presbytery staff | Opens the reports hub and picks a report | Weekly to monthly |
| Presbytery staff | Reads the report as a table, or as stacked cards at 360px | On demand |
| Presbytery staff | Moves the trend window or the billing year (prev/next links, as on the existing reports page) | On demand |
| Presbytery staff | Chooses "Export CSV", then opens it in a spreadsheet | Before a stated meeting or Committee on Ministry session |
| Presbytery staff | Follows an empty-state link to where the data is entered (Credentials, statistics, Congregation Oversight, per-capita) | When the report is empty |

The staff hands-on-keyboard work that feeds the reports already exists on other pages. Here are the data paths:
- **Appointments:** recorded on Credentials.
- **Statistics:** entered per congregation and year on the existing reports page.
- **Viability:** entered on Congregation Oversight.
- **Per capita:** set as a rate, then generated, then payments recorded, on the existing reports page.

No new data entry is in scope.

## Flows

**Flow 1: Open the hub.**
- Entry: the existing "Per-Capita, SASR & Imports" tile, or `/o/<slug>/admin/reports`.
- Step: a "Reports and exports" section lists four reports. Each card shows its name, one line on what it answers, and the data it reads.
- Outcome: the viewer opens a report. A card for a report whose key the viewer lacks is shown locked with a plain reason, not hidden. Hidden cards produce "why can't I see this" support tickets.
- Failure: the whole-page gates already exist and are reused. The flag off shows `PlaceholderFlagOff`. A non-presbytery org shows `PlaceholderNotAvailable`. The four-way org miss shows the existing denied/ended/404 states.

**Flow 2: Vacant pulpits.**
- Entry: the hub card, or `/admin/reports/vacant-pulpits` (the route name is the architect's call).
- Step: the page shows one row per vacant congregation, plus a count.
- Row content: congregation, "Vacant since" (end date of the last installed or designated call on record), current pulpit supply if any (call type and start date), and time vacant.
- Rows are sorted longest-vacant first, as the prototype did.
- Outcome: "Export CSV" downloads exactly those rows. The page has no client-side filter, so what is exported is what is shown.
- Failure: a load error shows "We couldn't load this report right now. Try again in a moment." with a Try again button (the existing `ReportsSectionLoadError` pattern).

**Flow 3: Membership trend.**
- Entry: the hub card.
- Step: a grid of congregations by year for ending active members, default window the last five statistical years. This matches the existing page's default of last calendar year as the newest year. Prev/next links move it, and the span is capped at 10 years.
- A footer row shows the total of values reported and "N of M congregations reporting" per year, never a bare total that hides gaps.
- Outcome: Export CSV.
- Failure: the same load error.

**Flow 4: Viability list.**
- Entry: the hub card.
- Step: every member congregation, sorted At risk, then Fair, then Healthy, then Not yet assessed, then by name. Columns are the label and score, redevelopment notes, and last updated.
- Outcome: Export CSV.
- Failure: the same load error.

**Flow 5: Per capita.**
- Entry: the hub card, defaulting to the current billing year.
- Step: one row per congregation with billed, paid and outstanding, plus status. Totals sit at the bottom.
- Rows are the year's records plus any current member with no record, shown as "Not billed (no statistics on file for <basis year>)", so the clerk sees the gaps.
- A congregation that has left but carries a record stays on the report, marked "No longer a member". Arrears owed by a departed congregation matter more, not less.
- Outcome: Export CSV for the shown year, or "Export all years" for a long-form file.
- Failure: the same load error.

**Flow 6: Download.**
- Entry: the Export CSV link.
- Step: a `GET` runs the same gate chain as the giving export:
  1. signed in, else 307 to `/signin` with the same-origin path as the callback;
  2. the Node-side 2FA recheck, else 307 to `/totp`;
  3. org resolution, with 404 for no such org and one 403 body for the others;
  4. flag and org type;
  5. the report's permission key, else 403.
- Then it audits and responds with `text/csv; charset=utf-8`, `attachment`, `Cache-Control: no-store`, and a filename of `<report>-<slug>-<date>.csv`.
- Failure: 403 with "You don't have permission to export this report." A database failure gives 503 with "We can't prepare that file right now. Try again in a moment." Both are plain text, never a stack trace.
- An empty report still returns 200 with a header-only file. The page also hides the button when there are zero rows, so an empty file is not offered.

## Permissions & Flags

**Permission(s):** no new keys and no migration. Each report and its export share one existing key:

| Report | Key (existing) | Why |
|---|---|---|
| Vacant pulpits | `credentials.manage` | It is the only key that reads `appointments`. |
| Membership trend | `statistics.manage` | It reads the coalesced statistics. |
| Viability | `congregation_oversight.manage` | It reads `congregation_oversight`. |
| Per capita | `per_capita.manage` | Tier 2, financial. |

An export never needs a different key from its page, and each is re-checked in the route body. A single `reports.view` key like the prototype's is rejected. It would need a migration, role-template bindings and a new row in the "Who holds what" table. It would also let someone read per-capita figures without holding the per-capita key, which breaks the repo's "three permissions, never merged" rule for this area.

**Default roles:**
- The `presbytery_stated_clerk` template carries `credentials.manage`, `statistics.manage` and `per_capita.manage`.
- `congregation_oversight.manage` has no template binding (DECISION-119). A presbytery's founding administrator carries it directly.
- So a stated clerk alone will see the viability report locked. A founding administrator who also holds the Stated Clerk role sees all four.
- The Phase 6 walk must be done as a freshly designated presbytery founding administrator, not a seeded fixture. It confirms which of the four render for that person at 360px.

**Flag(s):** none new, per the operator's rule. All pages and routes sit behind the existing global `org_portal.reports`, checked with the bare `isFlagEnabled()` like the existing page. The flag is a toggle, so the DECISION-026 fail-open wrappers do not apply.

**Demo caveat:** `org_portal.reports` is seeded off, and data entry for vacant and viability sits behind `org_portal.credentials` and `org_portal.oversight`. The operator's production flag state for all three must be confirmed before the demo. That is a flip, not a code change.

## Gaps the Request Didn't Address

**Derivation rulings (decided here; Phase 3 implements, not re-litigates).**

1. **Roster.**
   - Every report lists the presbytery's **current** member congregations: `organizations.parent_id` = this presbytery, type `congregation`, **and `lifecycle_status = 'active'`**.
   - `parent_id` is the derived cache of the affiliation history. Read it; never write it, and never build a second affiliation reader.
   - The existing `listMemberCongregations` helper does not filter lifecycle and does not expose it. The new reader must, or a dissolved congregation shows as a "vacant pulpit".
   - New worshiping communities are excluded, consistent with oversight and statistics (a known gap already in TODO). The hub says so in one line.

2. **Vacant means no installed or designated pastor in force today.**
   - A congregation is vacant if it has no appointment of call type `installed_pastor` or `designated_pastor` in force today.
   - "In force" means `starts_on <= today` and (`ends_on` is null or `ends_on >= today`).
   - A future-dated start does not fill the pulpit yet. A future-dated end still fills it today.
   - Tech-lead should confirm what the credentials page treats as "current". Today it shows an end date as historical, and the two pages must not disagree about a call ending next month.
   - `stated_supply`, `interim_pastor` and `temporary_supply` are pulpit supply. They do **not** fill the pulpit; they appear in a "Current supply" column.
   - `parish_associate` never fills it and never makes it vacant.
   - This is a deliberate divergence from the prototype. The prototype counted every pastoral role, including interim and supply, as filled. The demo's vacancy count will therefore be higher than the presbytery's old number, and the operator should be told at the demo.
   - "Vacant since" is the latest `ends_on` among ended installed or designated calls. With none ever recorded it reads "No pastor on record", never a guessed date.
   - Only today is supported. No as-of date selector.
   - The report shows call types and dates, no person names, so it does not widen who sees ministers' names.

3. **Trend: affiliation windows decide "not a member" versus "no data".**
   - Each cell uses the existing coalesce: a congregation-published row wins, withdrawn rows are ignored, then presbytery-entered or imported rows.
   - A year outside a congregation's affiliation window (`fetchAffiliationWindows`) renders "—" (not a member that year). A year inside the window with no row renders "No data". These must look different.
   - The CSV is long-form: congregation, year, ending active, source (`presbytery_entered`, `published_by_congregation`, `imported`, or `no_data`). It has one row per congregation-year inside the window, so provenance survives a pivot table.
   - The page grid and the CSV come from one reader. A test pins that they agree.
   - Departed congregations' history is out of scope for the trend and is stated on the page.

**Honest empty state for vacancy (the biggest functional risk).**
- "Vacant" is derived from the absence of appointments, so a presbytery that has not entered any would see every congregation flagged vacant. That is false, and it is the first thing the demo audience would see.
- If the presbytery has **zero** appointment rows, do not render the list. Show "No pastoral appointments are recorded yet, so vacancies can't be worked out" with a link to Credentials.
- Otherwise show the list with a standing line: "Based on the appointments recorded on Credentials. A congregation with no appointment recorded appears here."
- Disable the export in the zero-appointment case.

**Which reports demo with data entered today.**
- Viability and per capita are fully demonstrable with existing forms.
- Trend is demonstrable only after statistics are entered for more than one year, and each is a per-congregation, per-year form because imports are out of scope. With one year it is a one-column grid, which is honest. The empty state must say how to enter more.
- Vacant needs ministers to be presbytery members first (the credentials forms refuse otherwise), then appointments recorded. That is heavy but real.
- For the Phase 6 walk, tech-lead should enlarge the dev fixture: congregations with an installed call, supply only, none, and an ended call; three years of statistics; two billing years. `scripts/seed-dev.sql` is a Rule 16 shared file, edited at integration.

**Empty and edge states, by report.**
- No member congregations: "No member congregations on record" (existing wording), export disabled.
- Trend with nothing in the window: "No statistics recorded for 2021 to 2025", with a link to enter them.
- Viability with no assessments: rows still list as "Not yet assessed", with a pointer to Congregation Oversight.
- Per capita with no rate or records for the year: "No per-capita bills for 2026. Set a rate and generate records on this page's Per-Capita section", with a link.

**Viability scale trap.**
- The prototype's scale is 1 = strong and 3 = at risk. This platform's scale is **1 = at risk, 3 = healthy** (the oversight form and list).
- The CSV must carry both the label and the score, with a header that states the scale (for example `viability_score_1_at_risk_3_healthy`). Anyone comparing it with an old export would otherwise read it backwards.
- Any later import from the prototype must invert it.
- Notes: the CSV includes redevelopment notes, because that is the report's content. It excludes buildings, insurance and coordinates.

**CSV injection and numeric correctness.**
- Congregation names are written by other tenants and by platform admins, not by the presbytery. A name starting with `=` or `@` is a plausible formula attack on the presbytery's spreadsheet. Every text cell goes through the shared `csvTextCell` (formula guard plus RFC 4180 quoting): names, notes, call-type labels, source labels. Nothing is concatenated by hand.
- Numbers must not go through the text guard, which would turn an overpaid `-12.00` into `'-12.00` and make it text. Use a numeric path.
- Per-capita arithmetic (outstanding = billed minus paid) is done in integer cents, not floats. The columns are `numeric` strings, and `centsToDecimal` already exists. An overpayment shows as a negative outstanding, labelled "credit" on the page.
- The prototype's client-side `downloadCsv` has no formula guard and is not the pattern to copy. Follow the server route.
- Whether to add a UTF-8 BOM so Excel renders accented names is a design call for Phase 3. My recommendation is yes for these four exports, since the prototype did and the staff use Excel. It needs its own byte-level test and must not touch the giving CSV pins.

**Audit.**
- Yes, all four exports write one audit row each, under one new `AUDIT_ACTIONS` key (for example `tenant.presbytery_report.exported`).
- Metadata is the report key, the row count and the year or window. Never names or notes.
- Per capita is tier 2 and the giving export is the precedent. The others are cheap to cover, and exports are where data leaves the system, so one rule is easier to explain than four.
- No migration is needed for the key.
- `check:audit` scans only `actions.ts` files, so a route handler's audit write is hand-audited. QA must read it, as for giving.
- Viewing a page is not audited, matching giving.

**2FA.**
- The proxy enforces 2FA on `/o/*`, but the session claim can be stale for someone just granted a key. The giving export rechecks `twoFactorRequired && !twoFactorVerified` in the route (R4).
- The presbytery keys are not "flagged keys", but per capita is financial. The export routes should reuse the same pure session check and the same `/totp` redirect. The architect decides where that pure function lives, since today it sits under `giving/`.
- Mid-enrolment, an export redirects to `/totp` with its own same-origin path as the callback, never a user-supplied one.

**Mobile (360px).**
- The existing statistics table hides columns below `sm`. These reports cannot, because the columns are the content.
- The ui-standards 200% zoom rule says primary content must not need horizontal scroll. So below `sm` each congregation renders as a stacked card: name, the one key value (outstanding, years in a labelled list, label, vacancy time), then the rest as label-and-value rows.
- From `sm` up it is a table. The trend grid is cards with newest year first on a phone.
- The Export button is full width with a 44px minimum height. The prev/next year links are tappable.
- The page and the CSV must agree on every figure.

**Query-parameter handling.**
- The existing page turns `?year=` into 1900, because `Number("")` is 0 and finite. The new pages and routes parse years strictly.
- Reject non-integers and anything outside 1900 to 2100. A bad value returns 400 on the route and falls back to the default on the page.
- The trend window caps at 10 years; from after to is a 400.
- Unknown parameters are ignored.

## Out of Scope (confirm with user)

- Excel (.xlsx) export, deferred as open question F on the operator's design page.
- The map, owned by the dashboard pipeline. Coordinates are neither shown nor exported.
- Buildings and insurance detail (the prototype's buildings report). The columns exist as free text but are not a report in v1.
- Imports, which stay with the executor pipeline.
- Any as-of-date vacancy, historical vacancy trend or historical roster reconstruction.
- Congregations that have left, in the trend. They are included only in per capita, because of arrears.
- New worshiping communities.
- A shared "reports.view" key or any new permission, or any new global flag.
- Charts and client-side search or filter. The export is the shown rows.
- A stated-meeting packet or PDF.
- A what's-new entry, per the operator's standing instruction (drafts in the work-log only).

## Help impact

- **Add `presbytery-reports`** (title along the lines of "Presbytery reports and downloads"), published and audience-scoped to presbytery staff.
  - It covers `tile:reports`, which today sits on the coverage allowlist with no page.
  - The same commit removes `tile:reports` from `COVERAGE_ALLOWLIST` and lowers `ALLOWLIST_PIN` from 15 to 14 with its shrink comment. It also drops `tile:reports` from the "still lists the deliberately undocumented keys" test.
  - Page content:
    - What each of the four reports shows, and which key it needs.
    - Where its data is entered, using the on-screen labels "Credentials", "Congregation Oversight" and "Per-Capita, SASR & Imports".
    - What "vacant" means (no installed or designated pastor on record) and that supply does not fill the pulpit.
    - How trend cells read "—" versus "No data".
    - The viability scale of 1 = at risk and 3 = healthy.
    - That the CSV is the table as shown, with no emails, addresses, people or coordinates.
    - What to do when a report is locked or the page says "isn't turned on yet": ask your administrator, or the PresbyPortal team for the platform setting.
- **Edit `presbytery-tools`** (planned): its `today` sentence mentions credentials, oversight and statistics but not reports. Add a short clause and a link to the new page, and re-confirm `confirmedOn`.
- **Read, probably no edit:** `why-cant-i-see-this` and `roles-who-can-do-what`. Neither names a presbytery key today. Tech-lead confirms in Phase 3.
- **Labels:** the hub section title, the four report names and "Export CSV" go in the new page's `labels`. Changing the existing tile label "Per-Capita, SASR & Imports" is deliberately not proposed. If Phase 3 renames it, it triggers Rule 17 and the unit tests that pin it.
- **Other docs, same cluster:** functionality-map lines (the credentials, oversight and statistics bullets, plus a new reports bullet), a release-notes entry, and the TODO "Presbytery Increment 5" line split so reports move to Done and imports stay open. `[help:presbytery-tools]` on TODO line 29 stays, since committees are still open.
- Screenshots, if any, come only from `npm run help:shots` against the fixture database.

## Adversarial Pass (flow description only, findings by flow)

- **Redirect targets.** The only redirects are to `/signin` and `/totp`, each carrying the export's own path-and-query taken from the request. No user-supplied `callbackUrl` is read. The giving route is the pattern. Design addresses it, provided the route does not accept a `next` parameter.
- **State-machine shortcuts.** Hitting an export URL directly, skipping the page, must re-run flag, org type, 2FA and key. It must not trust that the viewer reached it from the hub. Confirm each route body has its own gate.
- **Cross-tenant.** The vacancy reader must start from the roster and join appointments to it. It must not iterate appointments, because rows persist for a congregation that has since moved presbyteries. Every read goes through `withOrgContext` on the presbytery, and `getPlatformDb()` is forbidden here. A congregation of another presbytery can never appear, and test fixtures need a second presbytery to prove it.
- **Enumeration.** The route follows the giving pattern: 404 for no such org, one identical 403 body for no relationship, ended, or missing key. A missing flag or org type must not produce a different status for a probing user than a missing key does. The page keeps the existing byte-identical denied copy.
- **Input boundaries.** All year, window and `billingYear` parsing is server-side and strict (see above). The slug in the filename has already been validated as an organization by the org resolution. Free-text notes are quoted by the shared writer, including embedded CR or LF.
- **Self-targeting.** Not applicable. The reports are read-only, and nothing mutates a person, role or account.
- **Injection into the recipient.** Covered above (tenant-written names, notes, formula guard, numeric cells). Add `X-Content-Type-Options: nosniff`.

## Open Questions

None blocking. Confirm at the demo (rulings made above, easy to flip):
- Vacant excludes interim and stated supply (shown as supply). The prototype counted them as filled.
- Viability uses this platform's 1 = at risk scale, not the prototype's.

---

**Handoff:** Phase 2 goes to **architect**. It should rule on three things:
- Route placement: a static `vacant-pulpits`, `trend` or similar segment beside the existing `reports/[aboutOrgId]` dynamic segment, which must never collide with a UUID.
- Where the shared pure 2FA and session check should live so the giving and presbytery exports reuse it.
- The reader layout: one reader per report in `src/lib/`, used by both page and route, with no owner connection.

Phase 3 inputs: the derivation rulings, the audit key, the strict year parsing, the 360px card layout, the dev-fixture enlargement, the help edits, and the allowlist pin change.

Files read (all in `/Users/cshenso/git/presby-platform/presby-reports`):
- `docs/work-log/2026-11-15-presbytery-reports.md`
- `src/lib/presbytery.ts`
- `src/lib/credentials.ts`
- `src/lib/csv.ts`
- `src/app/(org)/o/[slug]/admin/giving/gifts/export/route.ts`
- `src/app/(org)/o/[slug]/admin/reports/page.tsx`
- `src/lib/org-portal/tiles.ts`
- `src/lib/help/coverage.test.ts`
- `src/lib/onboarding/founding-administrator.test.ts`

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions.** The feature shape is right, and the rulings below are binding on Phase 3. It is still a **Full Feature**: it adds route handlers, which rules out the Accelerated class. It needs **no migration**. I checked the live catalog on `br-mute-tree-axpmuezq`: `audit_events.action` is `text` with no CHECK constraint, and `presby_app` holds INSERT on it. All four permission keys exist, and no flag row is added. Release the reserved 0089.

## Placement

**Routes.** These are static kebab-case siblings of the existing `[aboutOrgId]`. Each export is a child `export/` segment, because a `page.tsx` and a `route.ts` cannot share a segment.

```
src/app/(org)/o/[slug]/admin/reports/
  page.tsx                          existing; gains the hub section (co-located reports-hub.tsx, server component)
  [aboutOrgId]/page.tsx             existing; gains an isUuid guard (F446)
  vacant-pulpits/page.tsx           vacant-pulpits/export/route.ts
  membership-trend/page.tsx         membership-trend/export/route.ts
  viability/page.tsx                viability/export/route.ts
  per-capita/page.tsx               per-capita/export/route.ts
```

- **The `reports/r/<name>` sub-tree is rejected.** It adds a segment that means nothing. The App Router already resolves a static segment before a dynamic one at the same level, and none of the four names can match a UUID.
- **Two tests pin this.**
  - Each segment name in the registry fails `isUuid`.
  - The child directories of `reports/` are exactly the registry's segments plus `[aboutOrgId]`, so a fifth report has to be registered.
- **(org) contract.**
  - Every new page and route reads only through `withOrgContext()` on `db`. `getPlatformDb()` is forbidden.
  - The auth check is made in the page or route, never in a layout.
  - There is **no `loading.tsx` anywhere under `admin/reports/**`**. Today the tree has none; keep it that way and pin it. Any of these segments can call `notFound()`, and a Suspense boundary would turn that into a 404 served at HTTP 200.
  - The pages reuse `OrgAccessDenied` and `OrgAccessEnded` for the four-way miss.

**New module: `src/lib/presbytery-reports/`.** It follows the shape of `learn/` and `worship/`.

- `contract.ts` — pure, with no imports.
  - The report registry: key, segment, permission key, title, CSV base name.
  - The flag key `org_portal.reports` and the admitted org types (`presbytery`).
  - The audit metadata type.
- `params.ts` — pure, strict parsing of `year`, `from`/`to` and `billingYear`.
  - The rules: integers only, 1900 to 2100, a 10-year cap, and `from` must not be after `to`.
  - It returns ok or invalid. On invalid, a page falls back to the default and a route answers 400.
- `gate.ts` — `server-only`, one gate with a page skin and a route skin, like `reimbursement/gate.ts`.
  - The order is: session check, then `resolveOrgContext`, `assertOrgAccess`, the bare `isFlagEnabled`, and the org type.
  - On a route, every refusal after the 404 uses **one** 403 body. That covers no relationship, an ended relationship, flag off, wrong org type, and a missing key. The org tree is public and the flag is global, so nothing is lost by collapsing them, and one body is simpler to test.
- `roster.ts` — `server-only`, a transaction-level read and the only roster read in the module.
  - It selects congregations where `parent_id` is this presbytery, `organization_type = 'congregation'`, and `lifecycle_status = 'active'`.
  - All four readers start from it. It reads the `parent_id` cache and never writes it.
- `derive.ts` — pure, unit-tested without a database.
  - It holds Phase 1's vacancy and in-force rule and "vacant since".
  - It sorts viability and classifies trend cells ("—" versus "No data").
  - It does per-capita arithmetic in integer cents and adds the "not billed" and "no longer a member" rows.
- `vacant-pulpits.ts`, `membership-trend.ts`, `viability.ts` and `per-capita.ts`. Each exports three functions:
  - `readX(tx, viewer, params)` is the transaction-level read. It checks the report's key first, inside the transaction, following `presbytery.ts`'s rule that the data function never trusts its caller.
  - `getX(viewer, params)` is the page entry: one `withOrgContext` around `readX`.
  - `exportX(viewer, params)` is the route entry: the same `withOrgContext` and the same `readX`, then `insertAuditRow` in **that** transaction. The page and the CSV therefore cannot diverge. One test per report runs both entries on the same fixture and pins that the rows match.
- `csv.ts` — pure, four builders. The headers are constants, including `viability_score_1_at_risk_3_healthy`.
- `boundaries.test.ts` — a database-free source scan, with a sample that fails each rule. The rules are listed in Notes, item 6.

**Statistics coalesce.** The coalesce rule must have one definition.

- Export a multi-year `fetchStatisticsForYears(tx, organizationId, fromYear, toYear)` from `src/lib/presbytery.ts`. It is one query, with the same `withdrawn_at is null` WHERE clause and the same "published wins" pick.
- Make the existing `fetchStatisticsForYear` delegate to it, so the existing tests pin both.
- The trend reader must not reimplement the pick, and must not loop over years calling the single-year function.

**Server and client split.** No `'use client'` is needed.

- The 360px stacked cards versus the `sm:` table is CSS only.
- Previous and next links are `next/link`, which is fine because viewing a page is not audited.
- **The Export button is a plain `<a href download>` inside `Button asChild`, never `next/link`.** This follows the giving precedent at `gifts/page.tsx:112-116`. A Link prefetch would send a GET to the route handler and write an audit row for a download nobody asked for. Pin this with a scan.

**Dependencies.** None. CSV reuses `src/lib/csv.ts`. Excel is deferred, and any library for it gets evaluated when that work starts.

## Invariants Touched

- **Isolation is a database property.** I checked the live catalog.
  - `appointments`, `congregation_oversight`, `congregation_statistics`, `per_capita_rates` and `per_capita_records` all have `relrowsecurity = t` and `relforcerowsecurity = t`. Each has one policy, `tenant_isolation`, on `organization_id = presby_current_org()`, and `presby_app` holds SELECT on each.
  - `organizations` has no RLS by design (it is the cross-tenant structural table), and `presby_app` holds SELECT.
  - `organization_affiliations_public` is a view with SELECT for `presby_app`.
  - So every read is either the presbytery's own rows or public structure.
- **Two hierarchies intersect nowhere.** No new cross-council read is introduced.
  - Congregation statistics reach the presbytery by publication: the definer writes rows the presbytery owns, and the trend reads only those. That is the "up by publication" direction.
  - `appointments.organization_id` is forced to the presbytery (D1/F2). The vacancy reader starts from the roster and joins the presbytery's own appointments. It never iterates appointments, and it never reads a congregation's tenant tables.
  - Affiliation windows go through the existing `fetchAffiliationWindows` (the public view). No second affiliation reader is built.
  - No platform predicate appears in any check.
  - The module must not name `presby_list_published_returns_to_me` (the per-congregation archival read), the base `organization_affiliations` table, `people`, or `memberships`. The vacancy report shows no person data.
- **No role carries a wildcard, and tiers stay separate.**
  - Each report is gated by its own existing key, checked again inside the reader's transaction. There is no `reports.view` umbrella key.
  - Live tiers: `per_capita.manage` is tier 2, **`statistics.manage` is also tier 2**, and `credentials.manage` and `congregation_oversight.manage` are tier 1. Phase 3's copy and help text must not call the trend "directory-level".
  - The hub reveals lock state, never data.
- **Permissions versus flags.** The existing global `org_portal.reports` flag is read with the bare `isFlagEnabled()`. It is a toggle, so DECISION-026 does not apply. Each report also needs its key. No new flag (the operator's rule).
- **The proxy does not reach the database.** The proxy is untouched. The routes sit under `/o/*`, which the proxy matcher already covers for authentication and 2FA.
- **The brand is a cascade override.** `(org)` is brandable and nothing new is introduced; `check:brand-scope` is unaffected.
- **Audit security-sensitive acts (Workflow Rule 7).** Covered by DECISION-339, below.
- **Never hard-delete, and composite keys.** Not applicable: the feature is read-only. See F448 for a grant observation.

## Notes

**1. Shared session check and in-transaction permission helper (DECISION-338).** A presbytery report should not import from `treasury`.

The evidence for moving them:
- `worship/boundaries.test.ts` W5 bars treasury imports, so worship wrote its own `holdsPermission` (`worship/authority.ts:60`).
- `presbytery.ts:163` holds a fourth, private copy.
- Treasury itself moved these bodies out of `giving/` for the same reason.

The ruling:
- Move the bodies of `assertTreasurySession` and `treasuryTotpRedirectUrl` to `src/lib/org-portal/session-check.ts`, under neutral names chosen in Phase 3. It stays pure and imports only `@/lib/auth/safe-callback`.
- Move `holdsPermissions` to `src/lib/org-portal/permission-check.ts`, which is `server-only`.
- `src/lib/treasury/session.ts` and `src/lib/treasury/keys.ts` become re-export aliases under their current names. This is the same move `giving/access-pure.ts` already made.
- **No file under `src/lib/giving/`, `src/lib/reimbursement/` or `admin/giving/**` changes.** The giving export reuses the same function body through its existing import. Its CSV byte pins and its tests are untouched.

Keeping the tripwire intact:
- Moving out of `src/lib/treasury/` would take the code out of T1's no-owner-connection zone.
- So add **exactly these two paths** to `isNoOwnerConnectionZone` in `scripts/check-treasury-boundaries.mjs`, with a case in `check-treasury-boundaries.test.mjs`.
- `check:giving-boundaries` is unaffected: B3's zone never contained these bodies, and no rule restricts who may import them.

Why not `src/lib/auth/`: changing any file there triggers the Phase 4 running-server login smoke for a pure function that is not on the login path. Importing *from* `src/lib/auth/safe-callback` does not count as touching that directory. If Phase 3 puts anything inside `src/lib/auth/`, that gate applies.

Out of scope here: moving worship's and `presbytery.ts`'s copies onto the shared helper. That gets a TODO line.

Ship the move as its own `refactor:` commit, ahead of the feature commits.

**2. The 2FA recheck runs on the report pages as well as the routes.** It goes through the gate's page skin, so a page never shows data its export would refuse. The existing `reports/page.tsx` has no such recheck; adding it to the hub's host page is cheap and consistent, and that is Phase 3's call.

**3. Audit (DECISION-339).**
- One new key: `PRESBYTERY_REPORT_EXPORTED: "tenant.presbytery_report.exported"`, with `resourceType: "presbytery_report"` and `resourceId` set to the organization id.
- The metadata is `{ organizationId, report, rowCount }` plus one of `year`, `fromYear`/`toYear`, `billingYear`, or `allYears: true`. It never holds names or notes.
- It is written with `insertAuditRow` **inside the read's transaction**, following the reimbursement precedent (DECISION-271), and **not** with `recordAudit()`. `recordAudit()` opens its own connection and swallows failures, so a tier-2 file could leave the system with no audit row.
- If the audit insert fails, the route answers 503 and sends no file.
- Giving's export still uses `recordAudit()`. That is a known divergence and gets a TODO line; it is not touched here.
- `audit.test.ts`'s catalog pin gets the new key.

**4. No new tripwire script.** `check:audit` is a heuristic over mutations in `actions.ts` files. Widening it to `route.ts` would misfire on every GET handler. The module's `boundaries.test.ts` carries this property instead, the same way `reimbursement/audit-coverage.test.ts` does:
- each `route.ts` under the four segments calls an `export*` function;
- each `export*` function calls `insertAuditRow` with that key;
- nothing in the module or its routes calls `recordAudit`.

**5. CSV.**
- Every text cell goes through `csvTextCell`, and the whole file is assembled with `joinCsvLines`. Nothing is concatenated by hand.
- **Numbers never go through the text guard.** Add `csvIntegerCell(n)` to `src/lib/csv.ts`: it accepts a safe integer or null and throws otherwise. The addition is additive and pure, and the existing pins are unaffected.
- Money is converted to integer cents in SQL (`round(x * 100)`, read as a string and parsed with a safe-integer check, because the driver returns bigint as a string) and rendered with `centsToDecimal`.
  - The per-capita columns are unconstrained `numeric`, so Phase 3 must state whether sub-cent values can occur.
  - No float arithmetic, and no import from `src/lib/giving/money.ts`.
- **BOM: yes, for these four builders only.** It is prepended in `presbytery-reports/csv.ts`. The shared `joinCsvLines` is unchanged, and the Content-Type stays `text/csv; charset=utf-8`.
  - A byte test pins `EF BB BF` at the start of each report file.
  - A test also pins that the giving and reimbursement outputs do not start with it.
  - Accepted cost: a naive parser that does not strip a BOM sees it on the first header name.
- Headers are `no-store` and `attachment`, with the filename `<report>-<slug>-<date>.csv`. `nosniff` is already set globally in `next.config.ts:89` and `:194`, so repeating it in the route is harmless and optional.
- No row cap is needed, because the files are bounded by congregations times years. If a cap is ever added, it answers 413 and never truncates.

**6. The `boundaries.test.ts` rules (minimum).**
- No `getPlatformDb`, `PLATFORM_DATABASE_URL` or `MIGRATE_DATABASE_URL` in the module or the four route segments.
- Every `page.tsx` and `route.ts` in the four segments calls the gate.
- The audit properties in item 4.
- The module names none of the forbidden reads listed under Invariants.
- No `next/link` `href` ending in `/export`.
- No `loading.tsx` under `admin/reports/**`.
- No `.join(",")` outside `csv.ts`.

**7. Trend edges Phase 3 must name in its Edge Cases.**
- `fetchAffiliationWindows` returns an envelope, not a union. For a congregation that left and rejoined, the gap years show "No data", not "—".
- A congregation with no affiliation row has no constraint, so every year shows "No data".
- Dissolution closes the affiliation and recomputes `parent_id` (`drizzle/0044`, around line 1273 onward), so the lifecycle filter is mostly defence in depth. In the window of a future-dated dissolution, the reports may drop a congregation that the existing statistics table still lists. That is acceptable, and it should be named.

**Findings (F-numbers from the pre-assigned range).**
- **F445: two tier-2 keys do not force 2FA.** `per_capita.manage` and `statistics.manage` have `sensitivity_tier = 2` but `requires_two_factor = false`, unlike `giving.view` (tier 2, `true`).
  - The route recheck is uniform, but on its own it forces nothing for these keys. A second factor is required only when the user's own column or an organization's policy requires one.
  - Not fixed here: it needs a migration, changes who must enrol, and has help impact. It needs an operator ruling and a TODO line.
  - Copy in this pipeline must not claim that exports require two-factor.
- **F446: `[aboutOrgId]` accepts any string.** Reading the code, a non-UUID reaches the uuid comparison in `resolveMemberCongregation` and raises an error, which the page renders as `ReportsSectionLoadError` at HTTP 200 instead of a 404.
  - With four static siblings, a mistyped report URL will land there.
  - Fix in this pipeline: an `isUuid` guard that calls `notFound()` before any read, using `src/lib/is-uuid.ts`, with a test.
  - Unverified at runtime; the test confirms it.
- **F447 (suggestion): the existing page parses years leniently.** `?year=` becomes 0, which is finite, and is then clamped to 1900. The hub lives on that page, so adopting `params.ts` for its two parameters is cheap.
- **F448 (route to the next security review, not this pipeline): unexpected DELETE grants.** The live grants give `presby_app` DELETE on `appointments`, `congregation_oversight`, `per_capita_rates` and `per_capita_records`. On `congregation_statistics` it holds DELETE with no INSERT or UPDATE.
  - That conflicts on its face with "all deletes are soft".
  - Confirm whether anything uses these grants. This pipeline is read-only and must not use them.
- F449 is left for Phase 3.

**Proposed decisions** (newest first, for the orchestrator to record in `docs/decisions.md`):

- **DECISION-339: an export that audits writes its row in the read's transaction.** A route-handler export of tenant data writes its `audit_events` row with `insertAuditRow` inside the same `withOrgContext` transaction as the read, and fails closed (503, no file). `recordAudit()` is not used for exports. Because `check:audit` sees only `actions.ts`, the module's source-scan test is the guard. Precedent: DECISION-271. Known divergence: the giving gifts export (TODO).
- **DECISION-338: shared (org) gate helpers move to `src/lib/org-portal/`.** The (org) surface's Node-side session and 2FA check (`session-check.ts`, pure) and the in-transaction `presby_has_permission` helper (`permission-check.ts`, `server-only`) live there. `src/lib/treasury/session.ts` and `keys.ts` remain as aliases under their old names. Both files join `check:treasury-boundaries` T1's no-owner-connection zone by explicit path. Converging `worship/authority.ts` and `presbytery.ts` onto the shared helper is a tracked follow-up.
- **DECISION-337: presbytery reports placement and module shape.**
  - Four static segments sit beside `reports/[aboutOrgId]`, each with an `export/route.ts`, and `[aboutOrgId]` 404s a non-UUID.
  - A new module, `src/lib/presbytery-reports/`, holds a pure contract, params, derive and CSV, plus one reader per report. Each reader has one transaction-level read that serves both the page and the export, with the key checked inside the transaction.
  - One roster read and one coalesce definition (`fetchStatisticsForYears`, exported from `presbytery.ts`).
  - The UTF-8 BOM is applied only in these builders.
  - No migration, no new key or flag, and no new cross-council read.

**Implementer suggestion** (tech-lead decides): **full-stack-developer**. The server and client halves are small and tightly coupled. Suggested order:
1. The DECISION-338 refactor commit.
2. The pure contract, params, derive and CSV files with their tests.
3. The roster and the four readers, plus `fetchStatisticsForYears`.
4. The gate.
5. The routes and pages.
6. The hub.
7. Help and the F446 fix.

---

**Per-Phase Status row:**

| 2 — Architectural review | architect | Done | Approved with suggestions | 2026-11-15 |

**Handoff:** Phase 3 goes to **tech-lead**. Carry these rulings into the Carry-forward table:
- placement and the two pins;
- the DECISION-338 move and the T1 zone extension;
- the reader triple and the single coalesce;
- audit in the transaction under DECISION-339, guarded by the scan;
- the numeric path, cents, and the BOM scope;
- the boundaries scan rules;
- F445 (operator ruling), F446 (fix here), F447 (suggestion), F448 (security review);
- the trend edges in item 7.

I edited nothing. The Neon queries were read-only catalog reads on `br-mute-tree-axpmuezq`.

Files read (all in `/Users/cshenso/git/presby-platform/presby-reports`):
- /Users/cshenso/git/presby-platform/presby-reports/docs/work-log/2026-11-15-presbytery-reports.md
- /Users/cshenso/git/presby-platform/presby-reports/src/app/(org)/o/[slug]/admin/giving/gifts/export/route.ts
- /Users/cshenso/git/presby-platform/presby-reports/src/app/(org)/o/[slug]/admin/reimbursements/export/route.ts
- /Users/cshenso/git/presby-platform/presby-reports/src/app/(org)/o/[slug]/admin/giving/statements/route-gate.ts
- /Users/cshenso/git/presby-platform/presby-reports/src/app/(org)/o/[slug]/admin/reports/page.tsx
- /Users/cshenso/git/presby-platform/presby-reports/src/app/(org)/o/[slug]/admin/reports/[aboutOrgId]/page.tsx
- /Users/cshenso/git/presby-platform/presby-reports/src/lib/treasury/session.ts
- /Users/cshenso/git/presby-platform/presby-reports/src/lib/treasury/keys.ts
- /Users/cshenso/git/presby-platform/presby-reports/src/lib/giving/access-pure.ts
- /Users/cshenso/git/presby-platform/presby-reports/src/lib/reimbursement/gate.ts
- /Users/cshenso/git/presby-platform/presby-reports/src/lib/reimbursement/gate-coverage.test.ts
- /Users/cshenso/git/presby-platform/presby-reports/src/lib/reimbursement/audit-coverage.test.ts
- /Users/cshenso/git/presby-platform/presby-reports/src/lib/worship/boundaries.test.ts
- /Users/cshenso/git/presby-platform/presby-reports/src/lib/presbytery.ts
- /Users/cshenso/git/presby-platform/presby-reports/src/lib/csv.ts
- /Users/cshenso/git/presby-platform/presby-reports/src/lib/audit-tx.ts
- /Users/cshenso/git/presby-platform/presby-reports/scripts/check-treasury-boundaries.mjs
- /Users/cshenso/git/presby-platform/presby-reports/scripts/check-giving-boundaries.mjs
- /Users/cshenso/git/presby-platform/presby-reports/scripts/check-audit-coverage.mjs

---

# Phase 3 — Technical Design (tech-lead)

**Date:** 2026-11-15 · **Design verdict:** complete; implementer named at the end. Phase 1's derivation rulings and Phase 2's rulings are implemented as written; where this design adds a decision (marked **P3-n**), it is listed under Decisions made here.

## Summary

Four read-only reports for a presbytery's staff (vacant pulpits, membership trend, viability, per capita), each a server-rendered page and a matching CSV download, built only from data the presbytery already enters. No migration, no new permission key, no new flag. Each report has one reader in a new module `src/lib/presbytery-reports/`; the reader's single transaction-level read serves the page and the export, so the two cannot disagree. The export audits in the read's own transaction (DECISION-339) and fails closed. The work lands as eight small commits, the first of which is the DECISION-338 refactor (the shared (org) session and permission helpers move out of `treasury`). A hub section on the existing `/admin/reports` page lists the four reports and shows which are locked. Two defects found in Phase 2 are fixed here (F446, F447). Scope is the four reports: no Excel, no map, no imports.

## Feasibility check (against the live tree, 2026-11-15)

| Check | Result |
|---|---|
| Function signatures valid | No SQL function is added. `fetchStatisticsForYears(tx, organizationId, fromYear, toYear)` is TypeScript; no defaults precede required parameters. |
| `ALTER`/`DROP` of anything depended on | None. No migration. No `SECURITY DEFINER` body is touched. |
| New CHECK or trigger vs `scripts/seed-dev.sql` | None added. The demo script (below) is applied after `seed-dev.sql` and is read against the live CHECKs and triggers listed under Dev fixture. |
| New FK | None. |
| `audit_events.action` | `text`, no CHECK (Phase 2 read the catalog); `AUDIT_ACTIONS` gains one key; `src/lib/audit.test.ts:237` and `:291` show the pinned-catalog pattern to extend. |
| Moving the session and permission bodies | `giving/access-pure.ts:16` and `giving/keys.ts:3` re-export from `treasury/session` and `treasury/keys`; `reimbursement/gate.ts:12`, `reimbursement/pickers.ts:5`, `reimbursement/requests.ts:5`, `treasury/team.ts:5` and `reimbursements/[id]/receipts/route.ts:25` import them. All keep working through the aliases, so no file under `src/lib/giving/`, `src/lib/reimbursement/` or `admin/giving/**` changes. |
| Existing `e2e` and unit specs this change alters | See Edge Cases, "Existing-spec blast radius". Two are known: `reports/[aboutOrgId]/page.test.tsx` (fixture id `"cong-1"` is not a UUID) and `reports/page.test.tsx` (new hub read). |
| Existing helpers reused | `resolveOrgContext`, `assertOrgAccess`, `withOrgContext`, `OrgAccessDenied`/`OrgAccessEnded`, `PlaceholderFlagOff`/`PlaceholderNotAvailable`, `LoadError`, `EmptyState`, `FormattedDate`, `orgTimeZoneInTx` (`src/lib/org-settings.ts`), `todayInOrgZone` (`src/lib/shared/org-time.ts:111`), `isUuid`, `insertAuditRow`, `csvTextCell`/`centsToDecimal`/`joinCsvLines`. |

## Permissions & Flags

- **Permission keys:** none new. One existing key per report, re-checked inside the reader's transaction with `holdsPermissions` (live `presby_has_permission`, never the session):

| Report | Segment | Key | Tier (live) |
|---|---|---|---|
| Vacant pulpits | `vacant-pulpits` | `credentials.manage` | 1 |
| Membership trend | `membership-trend` | `statistics.manage` | 2 |
| Viability | `viability` | `congregation_oversight.manage` | 1 |
| Per capita | `per-capita` | `per_capita.manage` | 2 |

- **Default role bindings:** unchanged. The `presbytery_stated_clerk` template carries `credentials.manage`, `statistics.manage` and `per_capita.manage`; `congregation_oversight.manage` has no template binding (DECISION-119), so a stated clerk alone sees the viability card locked. The e2e fixture user `presbytery-clerk` holds all four through `e2e_presbytery_clerk` (`e2e/support/seed-orgs.ts:530-538`); `presbytery-nogrant` holds none.
- **Flag:** none new. Every page and export checks the existing global `org_portal.reports` with the bare `isFlagEnabled()` (a toggle; DECISION-026 does not apply). It is seeded off; the operator confirms production state for `org_portal.reports`, `org_portal.credentials` and `org_portal.oversight` before the demo. A flip, not code.
- **Two-factor (F445):** the pages and routes run the shared Node-side recheck (`assertOrgSession`), which refuses only when the session already says a second factor is required and unverified. No string in this feature says an export requires two-factor, and a copy test pins that.
- **Audit:** one new key, `PRESBYTERY_REPORT_EXPORTED: "tenant.presbytery_report.exported"`.

## API Contract

All routes are `GET`, `export const dynamic = "force-dynamic"`, under `src/app/(org)/o/[slug]/admin/reports/`. The proxy is untouched (`/o/*` already gets authentication and 2FA).

### Pages (server components, no `'use client'`, no `loading.tsx`)

| Path | Query (strict, `params.ts`) | Reader |
|---|---|---|
| `/o/<slug>/admin/reports/vacant-pulpits` | none | `getVacantPulpits` |
| `/o/<slug>/admin/reports/membership-trend` | `from`, `to` (four-digit years, 1900 to 2100) | `getMembershipTrend` |
| `/o/<slug>/admin/reports/viability` | none | `getViability` |
| `/o/<slug>/admin/reports/per-capita` | `billingYear` | `getPerCapita` |

Page gate order (`gateReportPage`, one implementation): (1) `cachedAuth()` then `assertOrgSession`: signed out redirects to `/signin?callbackUrl=<own path and query>`; a required, unverified second factor redirects to `/totp?callbackUrl=<own path and query>`; (2) `resolveOrgContext`: no such org is `notFound()`; no relationship renders `OrgAccessDenied`; ended renders `OrgAccessEnded`; (3) `assertOrgAccess` (an `OrgAccessError` rethrows to `[slug]/error.tsx`); (4) bare `isFlagEnabled("org_portal.reports")`, off renders `PlaceholderFlagOff`; (5) org type `presbytery`, else `PlaceholderNotAvailable`. The page then parses its query (an invalid value falls back to the default, silently), calls its reader, and renders: `forbidden` renders `ReportsSectionForbidden`; a thrown non-`OrgAccessError` renders `LoadError` whose Try again returns to the same page and query; the key is checked inside the reader, never in the gate.

### Export routes

`GET /o/<slug>/admin/reports/<segment>/export[?...]` for each segment. No `callbackUrl` or `next` is ever read; the only redirects carry the request's own path and query.

| Order | Condition | Response |
|---|---|---|
| 1 | no session | 307 to `/signin?callbackUrl=<own path+query, encoded>` |
| 2 | second factor required and unverified | 307 to `/totp?callbackUrl=<same>` (`orgTotpRedirectUrl`) |
| 3 | no such organization | 404 `Not found` |
| 4 | no relationship, ended, `OrgAccessError`, flag off, or wrong organization type | **403, one body:** `You don't have permission to export this report.` |
| 5 | failure reading the gate (database) | 503 `We can't check your access right now. Try again in a moment.` |
| 6 | invalid year or window | 400 `That link has an invalid year. Use four-digit years from 1900 to 2100, and no more than 10 years in a trend.`; a bad `allYears` is 400 `That link is not valid.` (after the organization-level gates, so a probe of an organization learns nothing; the key is checked inside the export's transaction, so a viewer without it who sends a bad year sees this 400, which reveals nothing about data) |
| 7 | the key is missing (the reader answers `forbidden`) | **403, the same body as row 4** |
| 8 | vacant pulpits only: the presbytery has no appointment serving a current congregation | 409 `There is nothing to export yet. No pastoral appointments are recorded.` (no audit row; nothing left the system) |
| 9 | the read, the CSV build and the audit insert all succeed in one transaction | 200 |
| 10 | any other throw, including a failed audit insert | 503 `We can't prepare that file right now. Try again in a moment.` and no file |

200 headers: `Content-Type: text/csv; charset=utf-8`; `Content-Disposition: attachment; filename="<base>-<slug>-<YYYY-MM-DD>.csv"` (date is UTC, as the giving export; the slug was validated as an organization by step 3 and is a DNS label); `Cache-Control: no-store`; `X-Content-Type-Options: nosniff`. Every non-200 is `text/plain; charset=utf-8` with `Cache-Control: no-store`. The body is a UTF-8 BOM (`EF BB BF`), then the header line, then one CRLF-terminated line per row.

| Route | Query | Filename base |
|---|---|---|
| `vacant-pulpits/export` | none | `vacant-pulpits` |
| `membership-trend/export` | `from`, `to` | `membership-trend` |
| `viability/export` | none | `viability` |
| `per-capita/export` | `billingYear`, or `allYears=1` (the only accepted value; both together is 400) | `per-capita`, or `per-capita-all-years` |

An empty report other than step 7 returns a header-only file (200, audited with `rowCount: 0`). The page hides the button when there are no rows, so only a hand-typed URL gets one.

### CSV headers, exactly (constants in `csv.ts`)

```
vacant-pulpits  congregation,vacant_since,days_vacant,supply_call_type,supply_starts_on
membership-trend congregation,year,ending_active,source
viability       congregation,viability_label,viability_score_1_at_risk_3_healthy,redevelopment_notes,last_updated
per-capita      billing_year,congregation,membership,basis_year,ending_active_basis,rate_per_member,billed,paid,outstanding,payment_status,paid_on,note
```

Cell rules (every text cell through `csvTextCell`; every integer through the new `csvIntegerCell`; money through `centsToDecimal`, never the text guard, so an overpayment stays `-12.00`):

- **vacant-pulpits:** `vacant_since` ISO date or empty; `days_vacant` integer or empty (both empty when no ended call exists); `supply_call_type` is the label (`Stated Supply`, `Interim Pastor`, `Temporary Supply`, the `CALL_TYPE_LABELS` wording from `credential-labels.ts`) or empty; `supply_starts_on` ISO date or empty. Sorted as the page.
- **membership-trend:** one row per congregation and year inside that congregation's affiliation window, ordered by congregation then year ascending. `source` is `presbytery_entered`, `published_by_congregation`, `imported` or `no_data`. `ending_active` is empty for `no_data` and for a row on file with no figure. Years outside the window (the page's dash) have no row.
- **viability:** `viability_label` is `At risk`, `Fair`, `Healthy` or `Not yet assessed`; the score is the integer or empty; `redevelopment_notes` is the notes text (quoted, CR and LF safe); `last_updated` is an ISO date in the organization's time zone, or empty. Buildings, insurance and coordinates are never read.
- **per-capita:** `membership` is `Member` or `No longer a member`; `rate_per_member` is the stored rate as text after a `^\d+(\.\d+)?$` check (a value that fails throws, so it is never guessed); `billed`, `paid`, `outstanding` are cents rendered by `centsToDecimal` (outstanding = billed minus paid, so negative on an overpayment); `payment_status` is `Unpaid`, `Partly paid`, `Paid` or `Not billed`; `paid_on` ISO date or empty; `note` is empty, `Credit` (outstanding below zero) or, for a `Not billed` row, the reason. A `Not billed` row leaves `ending_active_basis`, the money cells and `paid_on` empty. There is no totals row; the page's totals are the sum of the file's rows (a test pins it).

### Module functions (the reader triple, Phase 2)

Each of `vacant-pulpits.ts`, `membership-trend.ts`, `viability.ts`, `per-capita.ts` exports:

```ts
export type ReportViewer = { userId: string; email: string | null; personId: string; organizationId: string };
export type ReportRead<T> = { kind: "ok"; data: T } | { kind: "forbidden" };

readX(tx: OrgTx, viewer: ReportViewer, params: XParams, now?: Date): Promise<ReportRead<XData>>
  // the key first (holdsPermissions, inside tx); then the roster; then the report's own queries
getX(viewer: ReportViewer, params: XParams, now?: Date): Promise<ReportRead<XData>>
  // withOrgContext(viewer.personId, viewer.organizationId, tx => readX(...))
exportX(viewer: ReportViewer, params: XParams, now?: Date):
  Promise<{ kind: "ok"; csv: string; rowCount: number; filenameBase: string } | { kind: "forbidden" } | { kind: "nothing_to_export" }>
  // ONE withOrgContext: readX, then buildXCsv(data) (pure; a throw rolls the transaction back),
  // then insertAuditRow(tx, {...}) in that same transaction, then return
```

**P3-1:** `exportX` builds the CSV text inside the transaction, before the audit insert, so a build failure leaves no audit row and a failed audit insert leaves no file; the route only sends what the transaction returned. `nothing_to_export` exists only on `exportVacantPulpits`. `getReportsHub(viewer)` in `hub.ts` is one `withOrgContext` and one `holdsPermissions` over the four keys, returning `{ held: Record<ReportKey, boolean> }` (lock state, never data).

Audit row, written by `insertAuditRow(tx, ...)`: `action: AUDIT_ACTIONS.PRESBYTERY_REPORT_EXPORTED`, `actor: { userId, email }`, `resourceType: "presbytery_report"`, `resourceId: organizationId`, `metadata: { organizationId, report, rowCount }` plus exactly one of `{ fromYear, toYear }`, `{ billingYear }`, `{ allYears: true }`, or nothing (vacant pulpits, viability). `report` is `vacant_pulpits`, `membership_trend`, `viability` or `per_capita`. No name, note or amount is ever written.

### Other modules

- `src/lib/presbytery-reports/contract.ts` (pure, no imports): `REPORTS` registry (`key`, `segment`, `title`, `permission`, `filenameBase`), `REPORTS_FLAG = "org_portal.reports"`, `REPORT_ORG_TYPES = ["presbytery"]`, the audit metadata type.
- `params.ts` (pure): `parseYear`, `parseBillingYear(raw, now)`, `parseTrendWindow(rawFrom, rawTo, now)`, `parseAllYears(raw)`, each `{ ok: true, value } | { ok: false }`. A year is exactly `/^\d{4}$/` and 1900 to 2100 (so `""`, `"2020.0"`, `"1e3"`, `"0x7e4"`, `" 2020"`, `"-5"` are invalid). Absent is the default; present-but-bad is invalid. The default billing year is `now.getUTCFullYear()` (the existing page uses the server's local year; Vercel runs UTC, so they agree). The default trend window is `to = year(now) - 1`, `from = to - 4`. Only `to` given: `from = to - 4`. Only `from` given: `to = from + 4`. `from` after `to`, a span over 10 years, or a derived year past 2100 is invalid. An array value (repeated key) is invalid. Unknown keys are ignored.
- `roster.ts` (`server-only`): the one roster read, `readRoster(tx, organizationId)`.
- `derive.ts` (pure): the rules below.
- `csv.ts` (pure): four builders and the header constants; prepends `"﻿"` to the `joinCsvLines` result. `joinCsvLines` is unchanged.
- `copy.ts` (pure): every string in the Copy section.
- `gate.ts` (`server-only`): `gateReportPage`, `gateReportRoute`.

**Shared-helper refactor (DECISION-338), its own commit.** New `src/lib/org-portal/session-check.ts` (pure; imports only `@/lib/auth/safe-callback`): `OrgSessionLike`, `OrgSessionCheck`, `assertOrgSession`, `orgTotpRedirectUrl`, the bodies moved byte for byte from `treasury/session.ts`. New `src/lib/org-portal/permission-check.ts` (`server-only`): `holdsPermissions`, the body moved byte for byte from `treasury/keys.ts`. `treasury/session.ts` becomes `export { assertOrgSession as assertTreasurySession, orgTotpRedirectUrl as treasuryTotpRedirectUrl } from "@/lib/org-portal/session-check"` plus the three type aliases (`TreasurySessionLike`, `TreasurySessionCheck`); `treasury/keys.ts` becomes `export { holdsPermissions } from "@/lib/org-portal/permission-check"` (keeping `import "server-only"`). `scripts/check-treasury-boundaries.mjs` `isNoOwnerConnectionZone` gains exactly `rel === "src/lib/org-portal/session-check.ts" || rel === "src/lib/org-portal/permission-check.ts"`, with a case in `check-treasury-boundaries.test.mjs` (the two paths true, `src/lib/org-portal/tiles.ts` false). The existing `treasury/session.test.ts` is untouched and now pins the aliases; a new `org-portal/session-check.test.ts` repeats its cases under the neutral names. Nothing in `src/lib/auth/` changes, so the running-server login smoke is not triggered.

## Data Model

No schema changes. No migration (0089 released by Phase 2). All reads run through `withOrgContext` on `db` as `presby_app`; `getPlatformDb()` appears nowhere in the module or the four route segments.

**One coalesce definition.** In `src/lib/presbytery.ts`, add and export:

```ts
export async function fetchStatisticsForYears(
  tx: OrgTx, organizationId: string, fromYear: number, toYear: number,
): Promise<Map<number, Map<string, typeof congregationStatistics.$inferSelect>>>
```

One query: `select * from congregation_statistics where organization_id = :org and year between :from and :to and withdrawn_at is null order by published_at desc`. The pick is the existing one verbatim: first row per `(year, about_org_id)`; a `published_by_congregation` row replaces a non-published one. `fetchStatisticsForYear(tx, org, year)` becomes `(await fetchStatisticsForYears(tx, org, year, year)).get(year) ?? new Map()`, so `getCongregationStatisticsRollup` and `generatePerCapitaRecords` run on the same code and their existing tests pin both. The trend reader never loops over years and never reimplements the pick.

**Roster** (`readRoster`, the first read of every reader, so a congregation of another presbytery can never enter):

```sql
select id, name from organizations
 where parent_id = :presbyteryId and organization_type = 'congregation' and lifecycle_status = 'active'
 order by name, id
```

Written with Drizzle (`organizations.parentId`, `.organizationType`, `.lifecycleStatus`). `parent_id` is the derived cache of the affiliation history and is only read. `listMemberCongregations` is not changed or reused (it has no lifecycle filter and other callers rely on its current set).

**Vacant pulpits** (`readVacantPulpits`):

1. key `credentials.manage`; roster (empty roster returns `{ rows: [], rosterCount: 0, appointmentsRecorded: false }`, and the empty-array `inArray` is never reached).
2. `select serving_org_id, call_type, starts_on, ends_on from appointments where organization_id = :presbyteryId and serving_org_id in (:rosterIds)` (Drizzle `appointments`; `date` columns arrive as `'YYYY-MM-DD'` strings). No person column is selected.
3. `today = todayInOrgZone(now, await orgTimeZoneInTx(tx, organizationId))`.
4. `appointmentsRecorded` is true when step 2 returned at least one row (**P3-2**: roster-scoped, so appointment rows kept for a congregation that has since left do not turn the list on).

**Membership trend** (`readMembershipTrend`): key `statistics.manage`; roster; `fetchAffiliationWindows(tx, organizationId)` (reads `organization_affiliations_public`); `fetchStatisticsForYears(tx, organizationId, from, to)`.

**Viability** (`readViability`): key `congregation_oversight.manage`; roster; `select about_org_id, viability_score, redevelopment_notes, to_char(updated_at at time zone :tz, 'YYYY-MM-DD') as updated_on from congregation_oversight where organization_id = :presbyteryId and about_org_id in (:rosterIds)` with `:tz` from `orgTimeZoneInTx`. Buildings, insurance and coordinates are not in the select list.

**Per capita** (`readPerCapita`): key `per_capita.manage`; roster; the year's rate row (`per_capita_rates` where `billing_year = :y`) for its `basis_year`; records:

```sql
select r.id, r.about_org_id, o.name, r.billing_year, r.basis_year, r.ending_active_basis,
       r.rate_applied::text as rate_applied,
       round(r.amount_owed * 100)::bigint::text as billed_cents,
       round(coalesce(r.paid_amount, 0) * 100)::bigint::text as paid_cents,
       r.paid_status, to_char(r.paid_at at time zone 'UTC', 'YYYY-MM-DD') as paid_on
  from per_capita_records r join organizations o on o.id = r.about_org_id
 where r.organization_id = :presbyteryId [and r.billing_year = :y]
 order by r.billing_year, o.name, r.id
```

(Drizzle `sql<string>` expressions; none is `sql<Date>`, so `check:sql-date` is satisfied.) Cents are parsed with `Number()` and a `Number.isSafeInteger` check in `derive.ts`; the driver returns bigint as a string. `paid_at` is stored as midnight UTC of the paid date, so `paid_on` uses UTC; `updated_at` is a real instant, so `last_updated` uses the organization's zone. Also `select exists(select 1 from per_capita_records where organization_id = :presbyteryId)` for "Export all years", and, only when the year has records and a rate row exists, `fetchStatisticsForYears(tx, organizationId, basisYear, basisYear)` to tell "no statistics on file" from "not generated yet" (the same rule `generatePerCapitaRecords` skips on: no row or `ending_active` null; the figures themselves are never shown).

**Sub-cent values (Phase 2 asked).** They can occur. `per_capita_rates.rate_per_member`, `per_capita_records.rate_applied`, `amount_owed` and `paid_amount` are unconstrained `numeric`; `generatePerCapitaRecords` rounds `amount_owed` with a float `toFixed(2)`, and `recordPerCapitaPayment` accepts any finite non-negative `Number` string for `paid_amount` (so `100.005` and `1e3` both pass today). The reports round each stored figure to the nearest cent in SQL (`round(x * 100)`, half away from zero), compute outstanding in integer cents from the rounded values, and show the same figures on the page and in the file. The stored values are not changed. The rate is shown as stored text. This is **F449** (below).

## Derivation rules (`derive.ts`, pure, takes `today` as a string)

- **In force on a day:** `starts_on <= day` and (`ends_on` is null or `ends_on >= day`). A future start does not fill the pulpit; a future end still does; an end on today still does. The credentials page shows an end date and offers "End appointment" only for an open appointment (`appointment-list.tsx:74-81`) without calling a dated appointment current or not, so the two pages do not contradict each other (Phase 1 asked this be confirmed).
- **Vacant:** no `installed_pastor` or `designated_pastor` appointment in force today. `parish_associate` never fills and never causes vacancy. `stated_supply`, `interim_pastor` and `temporary_supply` never fill the pulpit.
- **Vacant since:** the latest `ends_on` among installed or designated appointments with `ends_on < today`; none gives null.
- **Supply:** among supply appointments in force today, the one with the latest `starts_on` (ties by call type then id); none gives null. The report does not show a count when several overlap (**P3-3**: a presbytery that records overlapping supply sees the most recent; the Credentials page lists all).
- **Days vacant:** whole days from `vacant_since` to `today` (UTC date arithmetic on the two ISO strings). The page shows `formatVacancyLength` (whole calendar months between the two dates: under one month, "N months", "N years" or "N years, M months"); the file carries the days. Both come from the same two dates.
- **Sort:** rows with a known `vacant_since` oldest first; then rows with none; each group by name then id.
- **Trend cell, per congregation and year `y`:** if the congregation has an affiliation window and `y` is outside it (`minYear` and `maxYear` null mean open on that side), the cell is `not_member`; otherwise a coalesced row gives `value` (`endingActive` number or null, plus its provenance) and no row gives `no_data`. A congregation with no window entry is unconstrained, so every year is `value` or `no_data`. Footer per year: `total` (sum of the numbers), `reporting` (count of numbers), `members` (cells that are not `not_member`).
- **Viability sort:** score 1, 2, 3, then null; then name, then id.
- **Per capita rows:** every record of the shown year (or every year, for the long file) plus, for the single-year view only and only when the year has at least one record, each roster congregation without a record, as `not_billed` with reason `no_statistics` (rate row exists and the basis year has no figure for it) or `not_generated`. A record whose congregation is not in the roster is flagged `departed` ("No longer a member"). Money in integer cents; totals are integer sums with a safe-integer check. The reason's basis year is the rate row's, else the first record's.

## Component / Page Plan

**Pages to create** (each `page.tsx` calls `gateReportPage` first): `vacant-pulpits/page.tsx`, `membership-trend/page.tsx`, `viability/page.tsx`, `per-capita/page.tsx` under `src/app/(org)/o/[slug]/admin/reports/`. **Routes:** `<segment>/export/route.ts` ×4, each a thin handler: `gateReportRoute` → parse → `exportX` → response. **Hub:** `reports/reports-hub.tsx`, a server component, rendered as `await renderReportsHub(...)` computed before the `return` in `page.tsx` (the file's own comment explains why; `page.test.tsx` renders the tree directly).

**Components to create** in a new `src/components/presbytery-reports/` (**P3-4**: same shape as `components/worship/` and `components/learn/`; the architect's tree named only the lib module, so this directory is a Phase 3 addition the orchestrator may confirm with the architect in passing; the alternative is co-locating under `reports/`, with no behaviour difference):

- `report-frame.tsx`: back link ("Back to reports"), `<h1>`, subtitle, standing notes, the export button(s), the help link. One layout for all four.
- `export-button.tsx`: `<Button asChild variant="outline" className="min-h-11 w-full sm:w-auto"><a href={...} download><Download className="size-4" aria-hidden />Export CSV</a></Button>`. A plain anchor, never `next/link` (a prefetch would write an audit row for a download nobody asked for). Same pattern as `giving/gifts/page.tsx:112-116`.
- `year-nav.tsx`: previous and next `next/link`s, each `min-h-11 inline-flex items-center px-2`, plus the current value (used by per capita and trend).
- `gate-state.tsx`: renders `org_forbidden`, `org_ended`, `flag_off`, `not_applicable`.
- `report-states.tsx`: `ReportLoadError` (wraps `LoadError`, retry to the page's own path and query) and `ReportEmpty` (wraps `EmptyState`).
- `vacant-pulpits-view.tsx`, `membership-trend-view.tsx`, `viability-view.tsx`, `per-capita-view.tsx`: each renders **both** a card list (`<ul data-testid="report-cards" className="space-y-3 sm:hidden">`, trend uses `lg:hidden`) and a table (`<div data-testid="report-table" className="hidden sm:block">`, trend `hidden lg:block`), from the same rows. `display: none` removes the hidden copy from the accessibility tree, so a screen reader reads one. A card is a bordered `li` with the congregation name (`break-words`) as the first line, the one key value next (still owed; years newest first as a labelled list; the viability badge; time vacant), then label-and-value rows. Trend uses `lg` because up to ten year columns do not fit between 640 and 1024 px (the 200% zoom rule forbids a horizontal scroll for primary content).
- `reports-hub.tsx` (co-located, not in `components/`): a section with an `<h2>`, an intro, and a `<ul>` of four cards. An unlocked card is one `Link` (the whole card, `min-h-11`); a locked card is a `div` with the "Locked" badge and the reason, never a link. No `<table>` and no heading containing the hyphenated word "Per-Capita" (the existing page's `getByRole("heading", { name: "Per-Capita" })` is a case-insensitive substring match).

**Files to modify:**

- `src/lib/presbytery.ts`: `fetchStatisticsForYears`; `fetchStatisticsForYear` delegates.
- `src/lib/audit.ts` and `src/lib/audit.test.ts`: the new key.
- `reports/page.tsx`: the hub section; `assertOrgSession` replaces the `!session?.user` check (**P3-5**: the hub's host page now refuses the stale-claim case its exports refuse, and redirects with `orgTotpRedirectUrl`); `?year=` and `?billingYear=` parsed through `params.ts` (F447: a blank or malformed value falls back to the default instead of clamping to 1900; an out-of-range value falls back instead of clamping).
- `reports/[aboutOrgId]/page.tsx`: `if (!isUuid(aboutOrgId)) notFound();` first, before the session and any read (F446).
- `src/lib/org-portal/tiles.ts:565-566`: the tile description (below). The label "Per-Capita, SASR & Imports" is unchanged.
- `src/lib/help/registry.ts`, `slug-history.ts`, `coverage-allowlist.ts`, `coverage.test.ts`; new `src/content/help/presbytery-reports.md` (below).
- `scripts/check-treasury-boundaries.mjs` and its test (the DECISION-338 commit).
- New `scripts/presbytery-reports/seed-demo.sql` (Dev fixture) and `e2e/presbytery-report-exports.spec.ts` (Test plan).
- At integration, by the orchestrator (Rule 16 shared files and housekeeping): `docs/decisions.md` (the three entries below), `docs/TODO.md`, `docs/product/functionality-map.md`, the release notes, the `src/lib/presbytery-reports/` line in CLAUDE.md's Project Layout, `docs/STATE.md`.

## Copy

All strings live in `src/lib/presbytery-reports/copy.ts` (pure) except where noted as reused. `{org}` is the presbytery's name from `resolveOrgContext`; `{n}`, `{m}`, `{year}` are numbers read from the same reader as the rows beside them. **Check lines follow each group; "Neighbours" is last.**

### Hub (section on `/o/<slug>/admin/reports`)

| Element | String |
|---|---|
| Section heading (h2) | `Reports and exports` |
| Intro | `Read each report on screen or download it as a CSV file for a spreadsheet. To enter statistics, set the per-capita rate or record payments, use the sections below.` |
| Roster line | `The reports list the congregations that are members of {org} today. New worshiping communities are not included.` |
| Card: Vacant pulpits | title `Vacant pulpits`; `Which congregations have no installed or designated pastor today.`; `From the pastoral appointments recorded on Credentials.` |
| Card: Membership trend | title `Membership trend`; `Ending active members, by congregation and year.`; `From congregation statistics.` |
| Card: Viability | title `Viability`; `How {org} rates each congregation, from at risk to healthy.`; `From Congregation Oversight.` |
| Card: Per capita | title `Per capita`; `What each congregation was billed for a year, has paid and still owes.`; `From the rate and the bills in the Per-Capita section below.` |
| Locked card | badge `Locked`; `You need permission to {manage credentials / manage statistics / manage congregation oversight / manage per-capita billing}. An administrator can give it under Roles.` |
| Help link | `Help with presbytery reports` |
| Hub read failed (inline, rest of page unaffected) | `We couldn't check which reports you can open. Try again in a moment.` and a `Try again` button to `/o/<slug>/admin/reports` |

- *Residuals:* none of these denies an accepted residual or a Phase 2 ruling (F445: nothing mentions two-factor).
- *Source of truth:* the roster line is the roster query (`parent_id`, type `congregation`, lifecycle `active`); "locked" is `holdsPermissions` read live, not the session; each "From ..." line names the table the reader reads.
- *Audience:* the hub is seen by anyone who reaches the reports page (a member of the presbytery with the flag on). "An administrator can give it under Roles" is addressed to the lock's reader but acted on by an administrator; a founding administrator who holds the Roles tile can; others are told only that an administrator can, which is true and promises nothing of them. It does not say "ask your administrator", which would be circular for a founding administrator.
- *Neighbours:* grep of the live tree for report, export, vacant, viability, per capita, statistics: `src/lib/org-portal/tiles.ts:565-566` ("Per-capita/SASR rollup and data-import housekeeping for a presbytery.") omits the reports and is modified to `Per-capita and statistics entry, four reports with CSV export, and data-import housekeeping for a presbytery.` The existing e2e regexes `don't have permission to manage per-capita billing` and `... manage statistics` (`e2e/presbytery-reports.spec.ts`, cases 5 and 6) must match exactly one element each, so no hub string contains "don't have permission to manage"; a unit test pins that.

### Page states (reused verbatim, no new string)

`PlaceholderFlagOff` and `PlaceholderNotAvailable` with area `Per-Capita, SASR & Imports` (the area the flag controls, so the sentence is true on every sub-page), `OrgAccessDenied`, `OrgAccessEnded`, and `ReportsSectionForbidden` (`You don't have permission to manage {credentials | statistics | congregation oversight | per-capita billing} at {org}. If you think this is a mistake, ask your presbytery's administrator.`).

### Vacant pulpits

| Element | String |
|---|---|
| h1 / subtitle | `Vacant pulpits` / `Congregations of {org} with no installed or designated pastor on <date>.` (the date is the organization-zone `today` the reader used, rendered with `FormattedDate mode="date"`) |
| Count | `{n} vacant of {m} congregations` (`1 vacant of 1 congregation` is not special-cased: `{n} vacant of {m} {congregation|congregations}`) |
| Standing note 1 | `Based on the appointments recorded on Credentials. A congregation with no appointment recorded appears here.` |
| Standing note 2 | `Stated, interim and temporary supply do not count as a pastor here. They are shown under Supply.` |
| Columns / card labels | `Congregation`, `Vacant since`, `Time vacant`, `Supply` |
| Vacant since, none ended | `No earlier pastor on record` (and `Time vacant` is `—`) |
| Time vacant | `Less than a month`, `{n} months`, `{y} years`, `{y} years, {m} months` |
| Supply cell | `{Interim Pastor} since <date>` or `None recorded` |
| Zero appointments (no list, no export) | title `No pastoral appointments are recorded yet`; body `So vacancies can't be worked out. Record appointments on Credentials.`; button `Open Credentials` |
| Appointments exist, none vacant | title `No vacant pulpits`; body `Every congregation has an installed or designated pastor on record today.` |
| No congregations | `No member congregations on record` (existing wording, `oversight-list.tsx`) |
| Export | `Export CSV` |
| Help link | `How to read vacant pulpits` |
| Export 409 | `There is nothing to export yet. No pastoral appointments are recorded.` |

- *Residuals:* the rule that supply does not fill the pulpit is Phase 1's ruling and is stated, not denied. "Time vacant" claims a length only from a recorded end date.
- *Source of truth:* the vacant list and "Vacant since" come from `appointments` rows of this presbytery serving the roster (`call_type`, `starts_on`, `ends_on`) against the organization-zone `today`. `No earlier pastor on record` is the absence of an ended installed or designated appointment; it is worded "earlier" because a call that starts in the future is on record but not earlier, so "No pastor on record" would have denied it. `No vacant pulpits` claims only "installed or designated on record today", which is the rule. `None recorded` is the absence of an in-force supply appointment. Nothing here claims a pulpit is truly empty; the standing note says what the list is based on.
- *Audience:* seen only by a holder of `credentials.manage` (the reader refuses others and the page shows the forbidden copy instead). `Open Credentials` and "Record appointments on Credentials" are acted on by that same holder, who can open Credentials when `org_portal.credentials` is on (if it is off, the Credentials page says so; accepted, flag state is operator-confirmed before the demo).
- *Neighbours:* `credentials/page.tsx:196` heading `Pastoral appointments` and the tile label `Credentials` are quoted as they are; no existing string says "vacant".

### Membership trend

| Element | String |
|---|---|
| h1 / subtitle | `Membership trend` / `Ending active members for each congregation of {org}, {from} to {to}.` |
| Nav | `‹ Earlier years` · `{from} to {to}` · `Later years ›` (a link is omitted when the shifted window would pass 1900 or 2100) |
| Cells | the number; `—` (with visually hidden text `Not a member that year`); `No data`; `Not reported` |
| Footer labels | `Total reported`; `{n} of {m} reporting` (per year) |
| Note 1 | `A dash means the congregation was not a member of {org} that year. "No data" means it was a member and no statistics are on file. "Not reported" means statistics are on file without a figure for ending active members.` |
| Note 2 | `Where a congregation reported its own figure, that figure is used. Congregations that have left are not shown.` |
| Nothing in the window | title `No statistics recorded for {from} to {to}`; body `Enter statistics for a congregation and year in the Congregation Statistics section.`; button `Record statistics` (to `/o/<slug>/admin/reports?year=<to>`) |
| Export / help | `Export CSV` / `How to read the membership trend` |

- *Residuals:* Phase 1's "departed congregations' history is out of scope for the trend, stated on the page" is Note 2. The rejoined-congregation envelope (Phase 2 item 7) is not denied: the note says a dash is "not a member that year", and a gap year inside an envelope shows "No data"; that is recorded under Edge Cases rather than hidden.
- *Source of truth:* the dash is the congregation's `fetchAffiliationWindows` window (year outside `minYear`..`maxYear`); "No data" is no coalesced `congregation_statistics` row for that year; "Not reported" is a row whose `ending_active` is null; "its own figure" is the coalesce rule (a `published_by_congregation` row wins). "Not a member" is therefore a claim about the affiliation window and is worded as such; the window is by calendar year, so a congregation that joined mid-year shows a figure for that year.
- *Audience:* holders of `statistics.manage`. `Record statistics` goes to the section whose form that same holder can use.
- *Neighbours:* the existing statistics table's `Congregation reported`, `Presbytery estimate`, `Imported`, `No data on file` (`statistics-table.tsx:13-17`, `:85`) are untouched; the trend reuses none of them (the trend says `No data`, shorter, because it sits in a grid; the two are never on one screen) and the help page says both.

### Viability

| Element | String |
|---|---|
| h1 / subtitle | `Viability` / `{org}'s own assessment of each congregation. At risk is 1 and Healthy is 3.` |
| Columns / card labels | `Congregation`, `Viability`, `Redevelopment notes`, `Last updated` |
| Values | `At risk`, `Fair`, `Healthy`, `Not yet assessed` (the oversight list's wording, `oversight-list.tsx:14-18`); no notes `—`; no date `—` |
| Note, shown when any row is not assessed | `Assess a congregation on Congregation Oversight.` with a link `Open Congregation Oversight` |
| No congregations | `No member congregations on record` |
| Export / help | `Export CSV` / `How to read viability` |

- *Residuals:* none. The scale (1 at risk, 3 healthy) is Phase 1's trap, stated on the page and in the CSV header.
- *Source of truth:* the label and score are `congregation_oversight.viability_score`; "Not yet assessed" is no row or a null score; the notes are `redevelopment_notes`; the date is `updated_at` in the organization's zone. The subtitle's "own assessment" is true because the row's owner is the presbytery (`organization_id` forced to it).
- *Audience:* holders of `congregation_oversight.manage`, who can open Congregation Oversight to assess (the page is gated by the same key and flag `org_portal.oversight`).
- *Neighbours:* `oversight-list.tsx:14-18` labels reused verbatim; `Assess` and `View / edit` stay.

### Per capita

| Element | String |
|---|---|
| h1 / subtitle | `Per capita` / `What {org} billed each congregation for {year}, what has been paid and what is still owed.` |
| Nav | `‹ {year-1}` · `{year}` · `{year+1} ›` (same as the existing section) |
| Columns / card labels | `Congregation`, `Billed`, `Paid`, `Still owed`, `Status` |
| Totals row / card | `Total` |
| Money | `$2,625.00` (grouped); a negative still-owed reads `$12.00 credit` |
| Status | `Unpaid`, `Partly paid`, `Paid`, `Not billed` |
| Not billed reasons | `No statistics on file for {basisYear}`; `Not generated yet` |
| Departed | badge `No longer a member` |
| Note | `Amounts are the bills generated in the Per-Capita section of Per-Capita, SASR & Imports.` |
| No bills for the year | title `No per-capita bills for {year}`; body `Set a rate and generate the bills in the Per-Capita section of Per-Capita, SASR & Imports.`; button `Open Per-Capita, SASR & Imports` (to `/o/<slug>/admin/reports?billingYear=<year>`) |
| Exports | `Export CSV` and `Export all years` (the second shows whenever any bill exists in any year) |
| Help link | `How to read per capita` |

- *Residuals:* none denied. Sub-cent rounding (F449) is an accepted residual of this pipeline and is stated in the help page, not denied.
- *Source of truth:* every figure is a `per_capita_records` row of the shown year (cents from `amount_owed` and `paid_amount`); `Still owed` is billed minus paid in integer cents; `Partly paid` and `Paid` are the stored `paid_status`; `No longer a member` is "the record's congregation is not on the roster" (a congregation that left, or one no longer active); `No statistics on file for {basisYear}` is exactly `generatePerCapitaRecords`'s own skip rule (no coalesced row or a null `ending_active` for the basis year), using the rate row's basis year; `Not generated yet` is "has a figure, has no bill". The Phase 1 wording "Not billed (no statistics on file ...)" is split into those two states because the second is what a clerk sees after statistics arrive and before Generate is pressed, and the first sentence would be false for it (a Phase 1 note, resolved here). When the year has no bills at all the page shows the empty state, not a list of "Not generated yet" rows.
- *Audience:* holders of `per_capita.manage`, who can open the section the button points to.
- *Neighbours:* `per-capita-records-table.tsx:30` (`No records generated for this year yet`) is the existing section's empty line and stays; the new empty title says "bills" for the same thing, and the help page states they are one thing. `generate-records-button.tsx:62` (`Generate {year} records`) and `Generated n record(s)` are untouched.

### Export routes

The bodies in the API Contract table. *Residuals:* none. *Source of truth:* each is a status the route itself decides; none claims anything about a person. *Audience:* the 403 is read by whoever hits the URL, including a person who is not signed in to a presbytery, so it names no organization and promises nothing; the 409 is read only by a `credentials.manage` holder. *Neighbours:* the giving and reimbursement route bodies are different subjects.

### Help (feeds `src/content/help/presbytery-reports.md` and its registry entry)

Registry entry (new, in `registry.ts`, after `photos-of-people` order 75):

```ts
{
  slug: "presbytery-reports",
  title: "Presbytery reports and downloads",
  summary: "Four reports for a presbytery, each a page and a spreadsheet download: vacant pulpits, membership trend, viability and per capita.",
  order: 80,
  status: "published",
  audience: "administrator",
  needs: {
    who: "Presbytery staff. Each report needs its own permission, which an administrator gives under Roles.",
    appliesTo: "presbyteries",
  },
  covers: ["tile:reports"],
  anchors: ["vacant-pulpits", "membership-trend", "viability", "per-capita"],
  labels: [
    "Per-Capita, SASR & Imports", "Reports & Insights", "Reports and exports", "Vacant pulpits",
    "Membership trend", "Viability", "Per capita", "Export CSV", "Export all years", "Locked",
    "Credentials", "Pastoral appointments", "Congregation Oversight", "Roles", "Record statistics",
    "Vacant since", "Not yet assessed", "No data", "Not reported", "No longer a member",
    "Not billed", "Total reported",
  ],
  verifiedIn: "0.57.0",
}
```

`needs.who` names no permission key (H11). `verifiedIn` is the release number the orchestrator assigns at integration (0.57.0 expected); the implementer sets it only after the 360px walk below. The audience group heading for `administrator` reads "Church administrators"; presbytery staff are council administrators, and a new audience would change `types.ts` and its tests for no reader benefit (**P3-6**).

Page text (the implementer walks it against the screens at 360px and corrects any label that differs; no screenshots in this increment):

```md
A presbytery that has turned on "Per-Capita, SASR & Imports" can read four reports about its member congregations. Each report is a page on screen and a file you can download and open in a spreadsheet. The reports cover the congregations that are members of your presbytery today. New worshiping communities are not included, and neither is a congregation that has left.

## Open the reports

Choose the "Per-Capita, SASR & Imports" tile under "Reports & Insights" on "Administration". The page opens with a section headed "Reports and exports", with one card for each report. Choose a card to open the report.

Each report needs its own permission, and having one does not open another. A card you cannot open says "Locked" and what it needs. An administrator can give the permission under "Roles". See [Roles: who can do what](/help/roles-who-can-do-what).

| Report | What it shows | Where its data is entered | Permission you need |
|---|---|---|---|
| "Vacant pulpits" | Congregations with no installed or designated pastor today | Pastoral appointments, on "Credentials" | Manage credentials |
| "Membership trend" | Ending active members by congregation and year | Statistics, in the Congregation Statistics section of "Per-Capita, SASR & Imports", or reported by the congregation | Manage statistics |
| "Viability" | How the presbytery rates each congregation | "Congregation Oversight" | Manage congregation oversight |
| "Per capita" | What each congregation was billed for a year, has paid and still owes | The rate and the bills in the Per-Capita section of "Per-Capita, SASR & Imports" | Manage per-capita billing |

## Vacant pulpits

A congregation is listed when it has no installed pastor and no designated pastor recorded as serving today. Stated supply, interim pastor and temporary supply do not fill the pulpit here; the most recent one shows under "Supply". A parish associate does not fill the pulpit either, and does not make it vacant. A call that starts on a later date does not fill the pulpit until that date, and a call with an end date still fills it until that day.

"Vacant since" is the end date of the latest installed or designated call on record. If none has ended, it says "No earlier pastor on record". The report shows call types and dates, never a person's name.

The list is built from the pastoral appointments recorded on "Credentials" (under "Pastoral appointments"), so a congregation whose appointment was never recorded appears as vacant. If your presbytery has recorded none for its congregations, the page says "No pastoral appointments are recorded yet" and does not list anything.

## Membership trend

The grid shows ending active members for each congregation, five years at a time. Use "Earlier years" and "Later years" to move. Each cell is a number, or one of three words:

- A dash: the congregation was not a member of your presbytery that year.
- "No data": it was a member and no statistics are on file for that year.
- "Not reported": statistics are on file but have no figure for ending active members.

Under each year, "Total reported" adds the numbers shown and says how many congregations reported, for example "9 of 12 reporting". Where a congregation reported its own figure, that figure is used. To add a year, use "Record statistics" in the Congregation Statistics section.

## Viability

Each congregation shows the rating the presbytery recorded on "Congregation Oversight": "At risk", "Fair" or "Healthy", with the redevelopment notes and the date it was last updated. A congregation with no rating says "Not yet assessed". The scale is 1 for at risk and 3 for healthy. A file from an older system may use the opposite scale, so check before comparing the two.

## Per capita

Choose a year with the arrows. Each row shows what the congregation was billed, what it has paid and what is still owed, with a total at the bottom. A congregation that paid more than it was billed shows its still-owed amount as a credit. A congregation with no bill yet shows "Not billed" and says why: either there are no statistics on file for the year the bill is based on, or the bill has not been generated yet. A congregation that has left but still has a bill is kept and marked "No longer a member". Amounts are rounded to the nearest cent. "Export all years" downloads every bill the presbytery has recorded, for every year.

## Downloading a report

Choose "Export CSV". The file is the table as shown: one row for each congregation, or for each congregation and year in the membership trend. It holds no email addresses, street addresses, coordinates or people's names. If a text cell begins with =, +, - or @, the file adds a leading apostrophe so a spreadsheet shows it as text and does not run it as a formula. The file is UTF-8 with a byte-order mark, so Excel shows accented letters correctly. Every export is recorded in the audit trail with which report, who exported it and how many rows, and never the names or notes in it.

## If a report is locked or missing

- A card that says "Locked": you do not have the permission it needs. Ask an administrator to give it under "Roles".
- A page that says it "isn't turned on" for your presbytery: the reports are switched on by the PresbyPortal team for the whole platform, not by an administrator. [Contact the team](/help/contact) if you need them.
- A page that says it "isn't available": reports are for presbyteries only.

More on missing access is in [Why can't I see this?](/help/why-cant-i-see-this).
```

H8 check: the text contains none of the banned phrases ("planned" does not appear; "will be able to" does not appear). H6 links: `/help/roles-who-can-do-what`, `/help/why-cant-i-see-this`, `/help/contact` are published or fixed. No images. Every label above appears in the page text and in a non-test `src/` file. `needs.appliesTo` is not checked against a catalog (there is no `turnOn`, because `org_portal.reports` is a global flag and not an organization toggle).

- *Residuals:* none denied. The page says the sub-cent rounding and the "earlier" wording.
- *Source of truth:* each sentence is a restatement of a rule in "Derivation rules" or a header in the CSV contract; "Every export is recorded" is the audit row of DECISION-339; "UTF-8 with a byte-order mark" is pinned by the byte test.
- *Audience:* presbytery staff; "an administrator can give it under Roles" is addressed to a person lacking a key, and the page says an administrator, not the reader.
- *Neighbours:* `presbytery-tools` (planned) `today` at `registry.ts:1047` reads "Presbyteries can record ministerial credentials, oversight and statistics where those features are turned on. There is no committees-and-commissions module." and is modified to "Presbyteries can record ministerial credentials, oversight and statistics where those features are turned on, and read four reports from them. There is no committees-and-commissions module." Its `confirmedOn` (2026-10-26) is the operator's date and is **not** moved (only the operator can say "still planned"; the monthly documentation review does it). `why-cant-i-see-this.md` and `roles-who-can-do-what.md` were grepped: neither names a presbytery key or the reports, so neither is edited. `docs/product/functionality-map.md:29` (the oversight and statistics bullet) gets a reports clause at integration.

### Help impact

- **Add** `presbytery-reports` (above) and its `SLUG_HISTORY` entry (append `"presbytery-reports"`).
- **Edit** `presbytery-tools` `today` only.
- **Coverage:** in `coverage-allowlist.ts` delete the `tile:reports` entry and change the header comment's count from 16 to match the 14 remaining plus the comment's own sentence about worship (read it, keep it true); in `coverage.test.ts` set `ALLOWLIST_PIN` from 15 to 14 with the comment `// 15 - 1: the presbytery reports page documents tile:reports, so it leaves the list.` and delete `"tile:reports"` from the `"still lists the deliberately undocumented keys"` array.
- **No token:** the page ships `published` with no `requires` in the same PR (Rule 17's ordinary case); no `[help:...]` line is added.

## Dev fixture (the demo and the Phase 5 and 6 walk)

`scripts/seed-dev.sql` is a Rule 16 shared file and, more to the point, `scripts/test-rls.sql` carries count assertions that a fixture enlargement inside it would move (its header says every count is blind to rows it did not add). **P3-7:** the enlargement is a separate pipeline-local script, `scripts/presbytery-reports/seed-demo.sql`, applied by `psql -f` **after** `seed-dev.sql` on a dev or pipeline Neon branch, never merged into `seed-dev.sql`, never applied to production (the operator's production demo uses the real forms and, later, imports). The orchestrator may override at integration. It is one transaction, idempotent where `on conflict do nothing` allows, all names invented, `.invalid` addresses, dates relative to `current_date` so the demo stays true next month.

It adds to the Northern Reach presbytery (`11111111-...`): six congregations written as roots with affiliations inserted through the real path (as `seed-dev.sql:95-` does, so `parent_id` is derived and nothing writes it): Cedar Hollow, Dunmore Ridge, Elkhorn Crossing, Fairlawn Heights and Glenmoor Presbyterian Church (Glenmoor affiliated from 2024-03-01, so 2022 and 2023 show a dash), and Hollis Bend Presbyterian Church (affiliation closed 2025-06-30 with the inline close attribution `seed-dev.sql` uses for Quillhaven, so it is off the roster). One long invented name (more than 60 characters) for the 360px wrap check. Three invented ministers with presbytery memberships (shape copied from Rowan Thistlewood's membership row) and appointments covering: installed (Alder Creek, existing); designated (Cedar Hollow); an installed call ended two years three months ago plus an interim in force (Dunmore Ridge); stated supply only, never an installed call (Elkhorn Crossing); no appointment at all (Fairlawn Heights); an installed call ended 14 months ago and nothing since (Bramblewood); an installed call that starts in 30 days (Glenmoor, vacant today); a designated call ending in 45 days (Quillhaven, still filled). Statistics for 2023, 2024 and 2025 for most congregations; a missing 2024 row for one (a "No data" cell); a 2024 row with `ending_active` null for another ("Not reported"); Alder Creek's existing published 2025 row stays. Oversight rows at score 1 with notes, score 2, a row with a null score and notes, and Fairlawn Heights with no row. A 2025 rate (basis 2023) and 2025 bills: paid in full, partly paid, unpaid, overpaid (a credit), one for Hollis Bend (departed), and Fairlawn Heights left without statistics for 2023 ("No statistics on file for 2023") while Elkhorn Crossing has statistics and no bill ("Not generated yet"); one `paid_amount` of `100.005` for the rounding path. Ids come from a block the implementer picks after grepping `seed-dev.sql`, `test-rls.sql` and `e2e/support/` for collisions. The demo user is the existing `presbytery.clerk.fixture@example.invalid` (holds all four keys at Northern Reach). Read against the live CHECKs and triggers before running: `appointments_person_fk` (needs presbytery memberships), `congregation_statistics` about-org trigger (affiliation must cover the year) and the `published_by_congregation` guard (only `presbytery_entered` rows are written), `per_capita_records_paid_status_allowed`.

## Implementation Order

One commit each, in this order; one prefix per commit; no commit amends or force-pushes.

1. `refactor(org-portal): move the (org) session check and permission helper out of treasury` (DECISION-338): the two new files, the two alias files, the T1 zone change and its test, `org-portal/session-check.test.ts`, a `permission-check` test with a stubbed `tx`. Run `check:treasury-boundaries`, `check:giving-boundaries`, and the giving and reimbursement unit suites untouched.
2. `feat(presbytery-reports): contract, params, derive, csv and the export audit key`: `contract.ts`, `params.ts`, `derive.ts`, `csv.ts`, `copy.ts`, `csvIntegerCell` in `src/lib/csv.ts`, `PRESBYTERY_REPORT_EXPORTED` in `audit.ts` and `audit.test.ts`, and all their unit tests.
3. `feat(presbytery-reports): the roster, four readers and fetchStatisticsForYears`: `roster.ts`, four readers, `hub.ts`, the `presbytery.ts` change, and `readers.db.test.ts`.
4. `feat(presbytery-reports): the gate, four report pages and four export routes`: `gate.ts`, `src/components/presbytery-reports/*`, pages, routes, component, route and `boundaries.test.ts` tests.
5. `feat(presbytery-reports): the reports hub and the two-factor recheck on /admin/reports`: `reports-hub.tsx`, the `page.tsx` hub and `assertOrgSession` change, and the `page.test.tsx` update.
6. `fix(reports): return 404 for a malformed congregation id and parse years strictly`: F446 and F447 (`[aboutOrgId]/page.tsx`, `reports/page.tsx` year parsing, their tests). Trailers: `Caught-By: agent-review`, `Discovered-In: Phase-2`, `Work-Log: 2026-11-15-presbytery-reports`. The failing-first tests land with it.
7. `docs(help): presbytery reports and downloads`: the page, registry, slug history, allowlist and pin, `presbytery-tools` edit, the tile description.
8. `test(e2e): presbytery report exports`, then `chore(scripts): demo data for the presbytery reports` (two commits).

Not in the implementer's scope (the orchestrator at integration): release notes `docs/release-notes/v0.57.0.md` and the version bump (tech-lead via `/release-notes` after Phase 6), `docs/TODO.md`, `docs/decisions.md`, the functionality map, CLAUDE.md layout line, `docs/STATE.md`.

## Test Plan

**Pure unit (no database):**
- `contract.test.ts`: every segment fails `isUuid`; segments, keys and filename bases are unique; each permission is one of the four; the child directories of `reports/` are exactly the registry's segments plus `[aboutOrgId]` (Phase 2 pin 2).
- `params.test.ts`: a table over `""`, `"2020"`, `"2020.0"`, `"1e3"`, `"0x7e4"`, `" 2020"`, `"-5"`, `"1899"`, `"1900"`, `"2100"`, `"2101"`, an array value, absent; trend: both absent, only `to`, only `from`, `from` after `to`, span 10 valid and 11 invalid, derived year past 2100; `allYears` only `"1"`; unknown keys ignored.
- `derive.test.ts`: the vacancy matrix (each of the six call types, in force, starts today, starts tomorrow, ends today, ends tomorrow, ended yesterday), latest ended wins, none ended, supply choice and tie, sort order, `formatVacancyLength` boundaries; trend cell classes (inside window with and without a row, a null figure, outside window, no window entry, a rejoined envelope showing "No data" in the gap, window edges at 1 January), footer counts; viability sort; per capita (overpayment negative, sums, `0.005` and `100.005` rounding via the cents strings, an unsafe integer throws, departed, `not_billed` reasons, the all-years shape).
- `csv.test.ts`: each header string pinned verbatim; `EF BB BF` is the first three bytes of each of the four files (via `TextEncoder`); a test builds the giving gifts CSV and the reimbursement CSV and pins that neither starts with the BOM; names beginning `=`, `+`, `-`, `@`, TAB and CR are apostrophe-prefixed; commas, double quotes, CR and LF in a name and in notes are quoted; `-12.00` is not prefixed; CRLF terminators including the last; an empty report is header-only; a rate that fails the regex throws. `src/lib/csv.test.ts` gains `csvIntegerCell`: safe integers, negative, zero, `null`, `undefined` to empty; `1.5`, `NaN`, `Infinity`, `2**53` and a string throw; the existing pins unchanged.
- `copy.test.ts`: no string matches `/two.?factor|2FA|second factor|verification code/i` (F445); none matches the future phrases `check:help` bans; the locked reasons and hub strings contain none of `don't have permission to manage` (the e2e regexes); every help `labels` entry exists in `copy.ts` or a named existing component.
- `org-portal/session-check.test.ts` (the cases of `treasury/session.test.ts` under the neutral names), `permission-check.test.ts` (stubbed `tx`), `check-treasury-boundaries.test.mjs` (the two paths).
- `boundaries.test.ts` (database-free scan, a failing sample per rule), Phase 2's list plus: no `getPlatformDb`, `PLATFORM_DATABASE_URL` or `MIGRATE_DATABASE_URL` in the module or the four segments; every `page.tsx` and `route.ts` calls the gate; each `route.ts` calls an `export*` function; each `export*` calls `insertAuditRow` with `PRESBYTERY_REPORT_EXPORTED`; nothing calls `recordAudit`; the module names none of `presby_list_published_returns_to_me`, `organization_affiliations` (the base table; `organization_affiliations_public` is allowed), `people`, `memberships`; no `next/link` `href` ending in `/export` and the export button is an `<a ... download>`; no `loading.tsx` under `admin/reports/**`; no `.join(",")` outside `csv.ts`; no `searchParams.get("callbackUrl")` or `"next"` in a route (the redirect-target property); no `Number(` applied to a search parameter in the module's pages and routes (strict parsing goes through `params.ts`); `roster.ts` contains `lifecycle_status`/`lifecycleStatus` with `'active'`.

**Component and page (jsdom, the existing pattern):** each view's empty states, rows, hidden export when there are no rows; the per-capita credit label; the trend dash, "No data" and "Not reported" are three distinct renderings; a locked hub card is not a link and an unlocked one is; the export anchor has `download` and an `href` ending `/export`; the hub has no `<table>` and no heading containing `Per-Capita`; `reports/page.test.tsx` mocks `@/lib/presbytery-reports/hub` and gains a lock-read-failure case, a stale-2FA redirect case, and the strict-year cases; `[aboutOrgId]/page.test.tsx` changes its default id to a UUID and adds the F446 failing-first case (a non-UUID calls `notFound()` before `resolveOrgContext`).

**Route (node, mocked gate, one table-driven file for all four):** 307 signed out and for required-unverified 2FA, each with the request's own path as the callback and no `callbackUrl` read; 404; the single 403 body for no relationship, ended, flag off, wrong type and key missing (asserting the bodies are byte-identical); 400 bodies (and that a refused organization-level gate wins over a bad year); 409 (vacant pulpits only); 503 on a gate failure and on a reader throw; the four 200 headers; the BOM; the filename pattern.

**DB-backed (`presbytery-reports/readers.db.test.ts`, `skipIf` no database, run serially, the harness of `presbytery.test.ts` with its two presbyteries):** presbytery A (a person with all four keys; one holding each key alone; one holding none) and presbytery B with its own congregation, appointment, statistics, oversight and per-capita rows.
- Cross-tenant: nothing of B appears in any A report; a congregation moved from A to B (A's affiliation closed, B's opened, as `seed-dev.sql` does for Quillhaven) keeps A's appointment row, does not appear in A's vacant list, and in B's list shows no "Vacant since" from A's rows.
- Each reader returns `forbidden` to a holder of the other three keys, and to the person with none.
- Page and CSV agree: for each report, `exportX(...).csv === buildXCsv((await getX(...)).data)`, and the per-capita page totals equal the sum of the file's `billed`, `paid` and `outstanding` rows.
- Audit: `exportX` writes exactly one `tenant.presbytery_report.exported` row with the metadata above; the metadata JSON contains no congregation name and no note text; a viewer whose `userId` is not a real user (an `audit_events.actor_user_id` foreign-key failure) makes `exportX` reject and leaves no row; a refused export (`forbidden`, `nothing_to_export`) writes none.
- Trend parity: for a fixture with a published, an entered, an imported and a withdrawn row across three years, each cell of `getMembershipTrend` equals the `endingActive` that `getCongregationStatisticsRollup` returns for that year (the single-year path now runs on `fetchStatisticsForYears`, so this pins the delegation).
- Vacancy: `appointmentsRecorded` is false when the only appointment serves a congregation off the roster; ends-today and starts-today boundaries with an injected `now`.
- Per capita: a `paid_amount` of `100.005` and one of `1e3` round to the same cents on the page and in the file; the not-billed reasons; a departed congregation's record stays.
- Lifecycle filter: pinned by the source scan above and, if a non-active child can be built through the lifecycle path `lifecycle.test.ts` uses, by a DB case; otherwise **unverified at database level** and recorded so in Phase 4.

**e2e (`e2e/presbytery-report-exports.spec.ts`, own server on port 3102, `E2E_BASE_URL=http://localhost:3102`; sets `org_portal.reports` itself through `e2e/support/flags.ts` `captureFlags`/`setFlag` and restores it; depends on no other flag, so `scripts/ci/e2e-baseline-flags.sql` is unchanged; stages its rows with `platformSql` inside the e2e presbytery using the existing `presbytery-clerk` person as the appointee and removes them in `afterAll`; no new support file, so no person-id range is needed):** hub as `presbytery-clerk` shows four links; as `presbytery-nogrant` shows four locked cards; the vacant pulpits page loads and its export link downloads a file whose bytes start `EF BB BF`, whose headers match, and which wrote an audit row; a direct export as `presbytery-nogrant` is 403; unauthenticated is 307 to `/signin`; `/admin/reports/not-a-uuid` is 404; with the flag off an export is 403; at 360px the hub and the four pages have no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`), the card list is visible, the table is not, and the export control is at least 44px high. Scope assertions to cards and tables by `data-testid`, because both copies are in the DOM. Assertions are about rows the spec staged, never counts, since other specs share the e2e presbytery.

**Gates for Phase 4:** `npm run typecheck`; `npm run check` (all ten); unit; the DB suites with `--no-file-parallelism`; `npm run test:e2e` for the new spec, `presbytery-reports.spec.ts` and `filings-round-trip.spec.ts`; `npm run check:help`; a phone-viewport browser walk of the hub and the four pages on the demo data.

## Edge Cases & Risks

Each claim cites its pin or says "unverified".

- **Existing-spec blast radius.**
  - `e2e/presbytery-reports.spec.ts` (cases 1 to 9) loads `/admin/reports`, which gains the hub. It asserts `getByRole("table")` (the hub has no table; pinned by the hub component test), `getByRole("heading", { name: "Per-Capita" })` and `"Congregation Statistics"` (substring, case-insensitive; no hub heading contains either; pinned), and `getByText(/don't have permission to manage per-capita billing/i)` and `... statistics` (each must match one element; no hub string matches; pinned by `copy.test.ts`). Its flags are `org_portal.reports` and `statistics.submission_grants`, both set by the spec. Ran-before-and-after is a Phase 4 gate.
  - `e2e/filings-round-trip.spec.ts:94,211` visits `reports/<alpha.id>`, a real UUID, so the F446 guard passes it.
  - `reports/[aboutOrgId]/page.test.tsx:92-93` uses `"cong-1"`, not a UUID, so the F446 guard would 404 every case; the fixture id changes to a UUID in the fix commit.
  - `reports/page.test.tsx` mocks `@/lib/authz` without `withOrgContext`; the hub's reader must be mocked at `@/lib/presbytery-reports/hub`, and the new `assertOrgSession` is pure and needs no mock.
  - `src/lib/treasury/session.test.ts` and the giving and reimbursement suites run unchanged through the aliases (the DECISION-338 commit's gate).
  - `coverage.test.ts` and `check:help` change as stated under Help impact.
- **Trend edges (Phase 2 item 7).** A congregation that left and rejoined has an envelope window, so gap years show "No data" rather than a dash (pinned by `derive.test.ts`); a congregation with no affiliation entry is unconstrained, so every year shows "No data" (pinned); a future-dated dissolution closes the affiliation and recomputes `parent_id` (`drizzle/0044`), so the lifecycle filter is mostly defence in depth, and in that window the reports may drop a congregation the existing statistics table still lists (accepted; unverified, no fixture builds it).
- **Window is by calendar year.** `fetchAffiliationWindows` uses Jan 1 or Dec 31 of the year; a congregation that joined on 1 July shows a number or "No data" for that year, not a dash (pinned by the window-edge cases).
- **Vacancy is only as good as the appointments entered.** The zero-appointment state and the standing note are the mitigation (DB test and component test). A future-dated call is not shown anywhere on the report (accepted; the help page says a later start does not fill the pulpit). Overlapping supply shows only the most recent (P3-3).
- **Per capita sub-cent (F449).** Rounded at read to the nearest cent in SQL, outstanding computed from rounded cents, so it may differ from the true difference by one cent (pinned by the `100.005` and `1e3` DB cases and `derive.test.ts`). No float arithmetic and no import from `giving/money.ts`.
- **Per capita default year.** `?billingYear` defaults to the UTC year, as the existing section does on Vercel; the page and the section agree except in a local-time window around New Year on a non-UTC host (unverified, accepted).
- **Names and notes are tenant-written.** Congregation names are written by other tenants and by platform admins, and notes by the presbytery. Formula-leading names and CR, LF, comma and quote are covered (`csv.test.ts`). The accepted cost of the BOM is that a naive parser sees it on the first header name (Phase 2; stated in no user string, since it is an engineering residual).
- **Prefetch.** A `next/link` to an export would audit a download nobody asked for; pinned by `boundaries.test.ts` and the anchor test.
- **No `loading.tsx` under `admin/reports/**`** (a Suspense boundary would turn `notFound()` into a 404 at HTTP 200); pinned by the scan.
- **Probing.** Flag off, wrong organization type and a missing key give the same 403 body on a route (route test); the pages keep the byte-identical denied copy through `OrgAccessDenied`. A bad parameter gets 400 only after the organization-level gates (route test).
- **A failed audit insert fails the export** (503, no file); pinned by the foreign-key DB case.
- **Hub lock read fails.** The hub shows its inline error; the statistics, per-capita and grants sections still render (page test).
- **360px.** Cards below `sm` (`lg` for the trend), table above; a long congregation name wraps in the card (`break-words`). **Unverified until the 360px e2e and the phone walk on the demo data** (one invented name there is over 60 characters on purpose).
- **Founding administrator alone sees locked cards.** A founding administrator without the Stated Clerk role may see some cards locked (Phase 1's Permissions note); the Phase 6 walk is done as a freshly designated presbytery founding administrator, not a fixture, and records which of the four render.
- **Risk: `inArray` with a large roster** binds one parameter per congregation. A presbytery is tens to low hundreds of congregations; accepted.

## Carry-forward

| Phase 1 gap / Phase 2 ruling | Addressed here, or *deferred* (who accepted) |
|---|---|
| P1 roster ruling (current, active, congregations only, `parent_id` cache, a lifecycle filter, no second affiliation reader, one hub line) | `roster.ts` and the roster SQL; hub roster line; scan rule on `lifecycle_status` |
| P1 vacancy ruling (installed and designated fill; in force; supply, associate; "vacant since"; today only; no person names; credentials-page "current" check) | Derivation rules; Vacant pulpits Copy; the credentials-page comparison stated there |
| P1 trend ruling (coalesce; dash versus "No data"; long-form CSV with provenance; one reader; departed out of scope and stated) | Derivation rules; membership-trend CSV; `fetchStatisticsForYears`; Note 2; page and CSV agreement test |
| P1 honest empty state for vacancy (zero appointments: no list, no export) | Zero-appointments state; export 409; **P3-2** makes "recorded" roster-scoped |
| P1 which reports demo with data entered today; enlarge the dev fixture | Dev fixture section (**P3-7**: separate script, not merged into `seed-dev.sql`) |
| P1 empty and edge states per report | Copy tables per report |
| P1 viability scale trap (label and score, header states scale; notes yes; no buildings, insurance, coordinates) | Viability CSV header and cells; subtitle; help; the select list excludes the other columns |
| P1 CSV injection and numeric correctness (`csvTextCell`; numeric path; integer cents; `centsToDecimal`) | CSV cell rules; `csvIntegerCell`; cents SQL; tests |
| P1 BOM recommendation | Yes, four builders only (Phase 2 ruling), byte test, giving and reimbursement pinned BOM-free |
| P1 audit (all four, one key, metadata without names, viewing not audited, QA reads the route) | Audit row; `boundaries.test.ts` properties; QA reads each `export*` |
| P1 2FA recheck on routes; shared pure function; own same-origin callback | `assertOrgSession`, `orgTotpRedirectUrl` in `org-portal/session-check.ts`; API Contract rows 1 and 2 |
| P1 mobile 360px (cards below `sm`, export full width 44px, tappable nav, page and CSV agree) | Component plan; e2e 360px; agreement tests |
| P1 query-parameter handling (strict years, 400 on routes, 10-year cap, unknown ignored) | `params.ts`; route 400 rows; `params.test.ts` |
| P1 flows 1 to 6 (hub with locked cards, not hidden; failure states; download gate chain) | Hub; page gate; export route order |
| P1 permissions table (four keys; no `reports.view`) and the stated clerk caveat | Permissions & Flags |
| P1 demo caveat (`org_portal.reports`, `credentials`, `oversight` flag state) | Permissions & Flags; operator confirms before the demo (a flip, not code) |
| P1 Phase 6 walk as a freshly designated founding administrator | Edge Cases; recorded for Phase 6 |
| P1 adversarial: redirect targets; state-machine shortcuts; cross-tenant (start from roster, second presbytery fixture); enumeration (one 403, byte-identical denied copy); input boundaries; no self-targeting; `nosniff` | API Contract; each route re-runs its own gate; DB cross-tenant tests; route tests; headers |
| P1 Out of scope list (Excel, map, buildings, imports, as-of vacancy, departed in trend, NWC, new key or flag, charts, PDF, what's-new) | Confirmed as non-goals below; what's-new: drafts in the work-log only |
| P1 Help impact (add `presbytery-reports`; edit `presbytery-tools`; read the two others; labels; other docs; screenshots only from `help:shots`) | Help impact and Copy; `why-cant-i-see-this` and `roles-who-can-do-what` grepped, not edited; no screenshots |
| P1 open questions to confirm at the demo (supply not filling; viability scale) | *Deferred* to the operator at the demo (Phase 1 accepted); both are stated on the page and in the help |
| P2 placement: four static segments and an `export/` child each; `[aboutOrgId]` isUuid guard; two pins; no `reports/r/`; (org) contract; no `loading.tsx` | Component / Page Plan; `contract.test.ts` and `boundaries.test.ts` |
| P2 module `src/lib/presbytery-reports/` and its files; reader triple; one transaction-level read serves page and export | API Contract (module functions); **P3-1** |
| P2 one coalesce (`fetchStatisticsForYears`, delegation, no loop) | Data Model |
| P2 no `'use client'`; export button is a plain `<a download>` in `Button asChild`; scan | Component plan; `boundaries.test.ts` |
| P2 invariants: forbidden reads; keys re-checked in the transaction; hub reveals lock state only; tier wording (do not call the trend "directory-level") | Scan rules; `holdsPermissions`; Permissions table lists the live tiers; no string says tier or directory-level |
| P2 DECISION-338 (move, aliases, T1 zone with exactly two paths, giving and reimbursement files untouched, no `src/lib/auth/` change, own `refactor:` commit first) | Shared-helper refactor; Implementation Order 1 |
| P2 item 2: 2FA recheck on pages as well as routes; the hub's host page | Page gate; **P3-5** |
| P2 DECISION-339 (key, `insertAuditRow` in the transaction, 503 on audit failure, `audit.test.ts`) | API Contract; Implementation Order 2 |
| P2 no new tripwire script; the module's scan carries the property | `boundaries.test.ts` |
| P2 CSV: `csvIntegerCell`; cents; sub-cent question; BOM; headers; no row cap | CSV; Data Model "Sub-cent values"; no cap, none added |
| P2 `boundaries.test.ts` rules 1 to 7 | Test Plan |
| P2 trend edges item 7 | Edge Cases |
| P2 F445 (two-factor claim; no migration; copy must not claim 2FA) | Copy test; no migration. *Deferred*: the operator ruling on forcing a second factor for `per_capita.manage` and `statistics.manage` is a TODO line (see Tracked follow-ups); Phase 2 routed it to the operator |
| P2 F446 (`isUuid` guard, test confirms) | Commit 6; failing-first test |
| P2 F447 (strict parsing on the existing page) | Commit 6; adopted, not left as a suggestion |
| P2 F448 (unexpected DELETE grants) | *Deferred* to the next security review (Phase 2 routed it there); this pipeline reads only and a scan bars `delete` |
| P2 F449 left to Phase 3 | **F449** below |
| P2 out of scope: converge worship's and `presbytery.ts`'s copies onto the shared helper; giving's `recordAudit()` divergence | *Deferred*: TODO lines (Tracked follow-ups); Phase 2 accepted |
| P2 implementer suggestion and order | Taken (full-stack-developer; order refined into eight commits) |

## Decisions made here (not rulings re-litigated)

- **P3-1** `exportX` builds the CSV inside the transaction before the audit insert.
- **P3-2** `appointmentsRecorded` counts only appointments serving a current roster congregation.
- **P3-3** Overlapping supply shows the most recent only.
- **P3-4** New `src/components/presbytery-reports/` directory.
- **P3-5** The 2FA recheck also runs on `/admin/reports` (the hub's host page), via `assertOrgSession`.
- **P3-6** The help page uses the `administrator` audience group.
- **P3-7** The demo fixture is a separate script, not merged into `seed-dev.sql`.
- **P3-8** Per capita's "Not billed" is split into two truthful reasons, and the year shows the empty state when it has no bills.
- **P3-9** `presbytery-tools` `confirmedOn` is left for the operator.

**F449 (new, routed to the next presbytery pass; not fixed here).** The per-capita money columns have no scale or shape constraint, and the write paths admit more than a clerk intends: `recordPerCapitaPayment` and `setPerCapitaRate` accept any finite non-negative `Number` string, so `100.005` and `1e3` both reach an unconstrained `numeric`, and `generatePerCapitaRecords` computes `amount_owed` with a float `toFixed(2)`. The reports round at read and state it, so nothing is wrong on the screen today, but the stored value can disagree with what a clerk typed. Fix shape for a later pipeline: a shared decimal-string validator (two places) and a `numeric(12,2)` migration, with a backfill check.

## Out of Scope (confirmed non-goals)

Excel (.xlsx) export (open question F on the operator's design page); the map; buildings and insurance; imports; any as-of-date vacancy or historical roster; departed congregations in the trend (kept only in per capita, for arrears); new worshiping communities; a `reports.view` key or any new permission or global flag; charts and client-side filtering; a stated-meeting packet or PDF; screenshots in the help page; a what's-new entry (drafts only); converging worship's and `presbytery.ts`'s permission helpers; changing the giving export's audit call; forcing a second factor for the two tier-2 keys (F445); the DELETE-grant review (F448); the per-capita scale fix (F449).

## Tracked follow-ups (the orchestrator adds these to `docs/TODO.md` at integration)

- Operator ruling on F445: whether `per_capita.manage` and `statistics.manage` should require a second factor (needs a migration and a help edit).
- Converge `worship/authority.ts` and `presbytery.ts`'s private `hasPermission` onto `org-portal/permission-check.ts`.
- Move the giving gifts export from `recordAudit()` to an in-transaction `insertAuditRow` (DECISION-339's known divergence).
- F448 DELETE grants on `appointments`, `congregation_oversight`, `per_capita_rates`, `per_capita_records` and `congregation_statistics`: security review.
- F449 per-capita scale.
- Split the "Presbytery Increment 5 — imports and reports" line: reports to Done, imports open.
- The next monthly documentation review asks the operator whether `presbytery-tools` is still planned.
- Excel export for these four reports once the operator rules on open question F.

## Draft `docs/decisions.md` entries (newest first; the orchestrator records them at integration with the final status line)

---

**DECISION-339 — An export that audits writes its row in the read's transaction.**

**Status:** Resolved (architect Phase 2; tech-lead Phase 3) · **Date:** 2026-11-15 · **Feature:** `2026-11-15-presbytery-reports`

A route-handler export of tenant data writes its `audit_events` row with `insertAuditRow` inside the same `withOrgContext` transaction as the read, and fails closed: if the audit insert fails, the route answers 503 and sends no file. `recordAudit()` is not used for exports, because it opens its own connection and swallows failures, so a tier-2 file could leave the system with no row. Phase 3 refines it: the export function also builds the CSV text inside that transaction, before the audit insert, so neither a failed build nor a failed audit leaves the other half behind. `check:audit` sees only `actions.ts` files, so the module's `boundaries.test.ts` is the guard (each `route.ts` calls an `export*` function; each `export*` calls `insertAuditRow` with `PRESBYTERY_REPORT_EXPORTED`; nothing in the module calls `recordAudit`), the same way `reimbursement/audit-coverage.test.ts` is for DECISION-271. The metadata is the report key, the row count and the year or window, never a name, note or amount. Precedent: DECISION-271. Known divergence, tracked in `docs/TODO.md`: the giving gifts export still uses `recordAudit()`.

---

**DECISION-338 — Shared (org) gate helpers live in `src/lib/org-portal/`.**

**Status:** Resolved (architect Phase 2; tech-lead Phase 3) · **Date:** 2026-11-15 · **Feature:** `2026-11-15-presbytery-reports`

The (org) surface's Node-side session and second-factor check (`session-check.ts`, pure, `assertOrgSession` and `orgTotpRedirectUrl`) and the in-transaction `presby_has_permission` helper (`permission-check.ts`, `server-only`, `holdsPermissions`) live in `src/lib/org-portal/`, so a presbytery or worship surface does not import from `treasury` (worship's boundaries test bars it, which is why `worship/authority.ts` and `presbytery.ts` each grew a private copy). The bodies moved byte for byte; `src/lib/treasury/session.ts` and `keys.ts` re-export them under their old names, as `giving/access-pure.ts` already re-exports from `treasury/session.ts`, so no file under `src/lib/giving/`, `src/lib/reimbursement/` or `admin/giving/**` changes and every giving byte pin and test is untouched. The two new files join `check:treasury-boundaries` T1's no-owner-connection zone by explicit path, because leaving `src/lib/treasury/` would otherwise take them out of it. They stay out of `src/lib/auth/` so the running-server login smoke is not triggered. The move ships as its own `refactor:` commit ahead of the feature commits. Converging worship's and `presbytery.ts`'s copies is a tracked follow-up.

---

**DECISION-337 — Presbytery reports: placement and module shape.**

**Status:** Resolved (architect Phase 2; tech-lead Phase 3) · **Date:** 2026-11-15 · **Feature:** `2026-11-15-presbytery-reports`

Four static segments (`vacant-pulpits`, `membership-trend`, `viability`, `per-capita`) sit beside `admin/reports/[aboutOrgId]`, each with an `export/route.ts`; `[aboutOrgId]` 404s a non-UUID before any read (F446). A new module `src/lib/presbytery-reports/` holds a pure contract, params, derive, CSV and copy, a `server-only` gate (page skin and route skin) and roster, and one reader per report. Each reader has one transaction-level read, checked against the report's own existing key inside the transaction, that serves both the page and the export, so they cannot diverge; the export builds its CSV and writes its audit row in that same transaction (DECISION-339). The roster is one read (`parent_id` cache, type `congregation`, lifecycle `active`), and the statistics coalesce has one definition, `fetchStatisticsForYears`, exported from `presbytery.ts` (the single-year function delegates to it). Money is integer cents read with `round(x * 100)` in SQL; the UTF-8 BOM is applied only in these four builders; numbers go through `csvIntegerCell`, never the text guard. Pages render a card list below `sm` (`lg` for the trend) and a table above, from the same rows, with `src/components/presbytery-reports/` for the views. Vacancy is "no installed or designated pastor in force today", with supply shown separately and a zero-appointment presbytery shown an honest empty state. No migration, no new permission key, no new flag and no new cross-council read. Excel, the map, buildings and imports are out of scope.

---

## Implementer

**full-stack-developer.** The server and client halves are small and tightly coupled, and one person should keep the reader, route, page and CSV in step (the page-and-file agreement tests depend on it). Branch `pipeline/presbytery-reports` in `/Users/cshenso/git/presby-platform/presby-reports`; dev server on port 3102 with `E2E_BASE_URL=http://localhost:3102`; no migration; DECISION-337 to 339 and F445 to F449 are reserved for this pipeline. Read the Copy section before writing any string; a string not in it stops for a ruling.

**Handoff:** Phase 4, in the Implementation Order above. Do not edit the Rule 16 shared files (`scripts/seed-dev.sql`, `docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `docs/reviews/log.md`, `src/lib/db/domain/index.ts`, `drizzle/meta/_journal.json`, `scripts/test-rls.sql`); list any needed change in the Phase 4 notes for the orchestrator. Do not commit or push without the operator's approval.

Files read for this phase (all in `/Users/cshenso/git/presby-platform/presby-reports`): `docs/work-log/2026-11-15-presbytery-reports.md`, `docs/work-log/_template.md`, `docs/ui-standards.md` (headings, empty states, 200% zoom, linking to help), `src/lib/presbytery.ts`, `src/lib/csv.ts`, `src/lib/audit-tx.ts`, `src/lib/org-settings.ts`, `src/lib/shared/org-time.ts`, `src/lib/treasury/session.ts`, `src/lib/treasury/keys.ts`, `src/lib/reimbursement/gate.ts`, `src/lib/reimbursement/csv-export.ts`, `src/lib/reimbursement/audit-coverage.test.ts`, `src/lib/worship/boundaries.test.ts`, `src/lib/help/{types,registry,checks,coverage.test,coverage-allowlist,slug-history,links,urls}.ts`, `src/content/help/officers-and-the-session.md`, `src/lib/db/domain/{presbytery,officers,org}.ts`, `src/lib/credentials.ts`, `src/lib/org-portal/tiles.ts`, `src/components/shared/{load-error,empty-state,formatted-date}.tsx`, `src/components/org-portal/coming-soon.tsx`, `src/app/(org)/o/[slug]/admin/reports/**`, `.../admin/oversight/oversight-list.tsx`, `.../admin/credentials/{appointment-list,credential-labels,page}`, `.../admin/giving/gifts/{page,export/route}`, `e2e/presbytery-reports.spec.ts`, `e2e/support/{seed-orgs,users}.ts`, `scripts/seed-dev.sql`, `scripts/check-treasury-boundaries.mjs`, `scripts/ci/e2e-baseline-flags.sql`.

---

# Phase 4 — Implementation

(pending)

---

# Phase 5 — Verification (qa)

(pending)

---

# Phase 6 — Shipped vs Intent (analyst)

(pending)
