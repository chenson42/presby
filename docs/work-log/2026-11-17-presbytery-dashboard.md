# Presbytery dashboard (Increment 4b, slice one: cards and viability list) — Work Log

> **Slug:** `2026-11-17-presbytery-dashboard`
> **Surface:** (org) — `/o/<slug>/admin/insights`, presbytery branch only
> **Permission(s):** to be settled in Phase 1 (candidates: the reports gate from 0.57.0, `congregation_oversight.view`)
> **Flag(s):** existing `org_portal.insights` (no new global flag pre-live)
> **Estimated complexity:** medium
> **Pipeline mode:** Full (adds the `leaflet` dependency, DECISION-122)
> **Pre-assigned:** DECISION-342+, F450+, no migration expected (0089 free if needed; 0088 reserved), dev port 3101, worktree `../presby-dashboard`, Neon branch `br-polished-recipe-ax432cko` (`pipeline/presbytery-dashboard`)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-11-16 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-11-16 |
| 3 — Technical design | tech-lead | Complete | Design complete; three items open for the user (Carry-forward, last row) | 2026-11-16 |
| 4 — Implementation | full-stack-developer | Complete | Gates green; ready for QA | 2026-11-16 |
| 5 — Verification | qa | Run 1 complete | FAIL (F-A; F-B to tech-lead) | 2026-11-16 |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

*Recorded verbatim from the analyst's return, 2026-11-16.*

## VERDICT

**READY WITH NOTES.** The notes are rulings that Phase 2 and Phase 3 must carry. The stat cards and the list build on shipped readers with no new key, flag or migration. The map is a different kind of work, covered in Gap 1: it adds a dependency, a CSP host and a third-party call, and it can't be shown to a customer until the operator supplies a key.

## ONE-LINE TAKE

> On the presbytery's Insights tile, a clerk gets one read-only page: four honest summary cards over the shipped report readers, each locked by that report's own permission. Below the cards is a viability list that always renders, and a pin map that appears only once a MapTiler key is set and some congregations have coordinates.

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Authenticated member of a presbytery (staff holding at least one of the four report keys) | Open Administration, then the "Insights & Analytics" tile, and **read** four cards | On demand |
| Same | **Scan** the viability list (at-risk first) and **click** a congregation to its oversight page | On demand |
| Same | **Pan, zoom and tap** a pin (only when the map renders) | On demand |
| Same | **Click** a card to the matching report (vacant pulpits, membership trend, per capita) for the full table or CSV | On demand |
| Same, with `congregation_oversight.manage` | **Type** latitude and longitude on the oversight edit form (shipped) so a congregation gets a pin | One-time per congregation |
| Operator (not a user surface) | **Set** the public tile-provider key in the deployment environment and redeploy | One-time |
| Anyone else (congregation, synod or GA member; presbytery member with no key) | Reach the page and see the unchanged stub or a locked state. There is no data verb. | n/a |

This is read-only. There is no form, no mutation and no export on this page.

The surface is the **authenticated member** surface, `/o/<slug>/admin/insights`, presbytery type only. The page is reachable by any org member who passes `assertOrgAccess`. The tile appears in the admin hub for the type, and the permission decision is made per card, not at the page door.

## Flows

**Flow 1 — Clerk reads the dashboard:**
- Entry: Administration, then the "Insights & Analytics" tile, or a bookmark to `/o/<slug>/admin/insights`.
- The gate runs in the usual order: signed in; Node-side 2FA recheck; the four-way org miss (DECISION-040); `assertOrgAccess`; the `org_portal.insights` flag; the presbytery type.
- One live `presby_has_permission` read per key decides which cards render.
- Outcome: the cards for held keys show figures with their year and denominator. Cards for missing keys render as "Locked" with the "you need to manage X" phrase from `contract.ts`.
- Failure:
  - A reader throws: that card shows a card-level load error with a retry link. The page does not blank. The readers have no cross-reader coupling, so give each its own call and settle them independently. One aborted statement must not poison the other cards' transaction.
  - Flag off: the existing `PlaceholderFlagOff` state.
  - Non-presbytery type: unchanged `ComingSoon`.
  - Holds none of the four keys: one forbidden state naming the four permissions. It is not four locked cards, which would imply a page with nothing in it.

**Flow 2 — Brand-new presbytery, no congregations on the roster:**
- Entry: same.
- Outcome: one empty state instead of four zero cards. "No member congregations yet. Congregations appear here once they are members of this presbytery." It points to the existing help page for how a congregation joins.
- Failure: none beyond the load error.

**Flow 3 — Card states (the honesty rules are in Gap 3):** each card has exactly four possible states: figure, "nothing recorded yet" (with the place to record it), locked, or load error. A zero is never rendered where "not recorded" is the truth.

**Flow 4 — Viability list, always present:**
- Entry: the same page, below the cards, for a holder of `congregation_oversight.manage`.
- Steps: it reuses `deriveViability` ordering (at risk, fair, healthy, not yet assessed). Each row has the congregation name, a viability badge carrying text and not colour alone, and a link to `/o/<slug>/admin/oversight/<aboutOrgId>`.
- Outcome: the list renders whether or not a map exists.
- Failure: load error on that section only.

**Flow 5 — Map (only if a key is configured and at least one congregation has a valid pin):**
- Entry: the list's sibling above it.
- Steps: pins are coloured and shaped by viability. Clicking or tapping a pin goes to that congregation's oversight page. The caption reads "N of M congregations are on the map."
- Outcome: the map is an enhancement to the list, never a replacement.
- Failure:
  - Tiles fail: DECISION-122's `tileerror` threshold collapses the map to a one-line "The map could not load. The list below has the same congregations."
  - Key unset: the map section is **absent** with no placeholder, and the page does not mention a map.
  - Key set but zero valid pins: one line, "No congregation has a location yet. Add latitude and longitude on its oversight page." This is the only place the coordinate prompt appears.

**Flow 6 — Operator turns the map on:** set `NEXT_PUBLIC_MAPTILER_KEY` (the name is to be settled), restricted to the platform hostname, then redeploy. It is a build-time public value, so there is no hot switch. This is the operator's step, not the clerk's.

## Permissions & Flags

- **Permission(s):** **no new key and no dashboard-wide key.** Each card is gated by the key of the report it summarises, reusing the existing readers. Each reader already checks its own key live inside its own transaction, so no caller can skip it.

  | Card | Reader | Key | Tier |
  |---|---|---|---|
  | Member congregations | `readRoster` | none; see the Gap 2 ruling | org structure |
  | Ending active members | `readMembershipTrend` | `statistics.manage` | 2 |
  | Vacant pulpits | `readVacantPulpits` | `credentials.manage` | 1 |
  | Per-capita billed and paid | `readPerCapita` | `per_capita.manage` | 2 |
  | Viability list and map | `readViability` plus a new coordinate read | `congregation_oversight.manage` | 1 |

  The lead's "oversight view" candidate **does not exist**. The catalog has only `congregation_oversight.manage`, and `congregation_oversight.view` appears nowhere in `src`, `drizzle` or `scripts`. Do not mint one. The ruling is that the map belongs to the Viability card and uses the same `.manage` key. The oversight page it links to needs that key anyway, so no one sees a pin they can't follow.
- **Default roles:**
  - The presbytery stated clerk template holds `statistics.manage`, `per_capita.manage` and `credentials.manage`, so a stated clerk sees three cards and a **locked** viability section and map.
  - `congregation_oversight.manage` is bound in the founding-administrator bundle for presbytery (`drizzle/0059`, with the same line in `0071` and `0085`), and by no other default.
  - **The first-customer demo must be walked as both people.** Walked only as the founding administrator, the dashboard looks richer than a clerk's will.
- **Flag(s):**
  - Existing `org_portal.insights` only. The page is gated by the flag, then the type, then the per-card key, using the bare `isFlagEnabled` toggle.
  - `gateReportPage` is hard-wired to `org_portal.reports`, and `boundaries.test.ts` pins that report pages call it. So the dashboard needs either a flag parameter on the gate or a sibling skin, which Phase 3 decides. The dashboard must not inherit the reports flag by accident.
  - Reports data therefore appears on a presbytery that has insights on and reports off. That is acceptable: a flag is a rollout toggle, not authorization, and the key still gates every card.
  - Links to the report pages and to oversight must render **only when the target's own flag (`org_portal.reports`, `org_portal.oversight`) is on**, as plain text otherwise. Otherwise the click lands on "isn't turned on".
  - Rollback is turning `org_portal.insights` off, and the page reverts to `PlaceholderFlagOff` with no data change.
  - The TODO go-live note says the flag is currently ON in production for the two real orgs. After this ships, a presbytery reaches real data through it, so the flag state is an operator decision at ship time.

## Gaps the Request Didn't Address

1. **The map cannot be demoed, and "no key means list only" ships a dark code path.**
   - `leaflet` is **not yet in `package.json`**. DECISION-122 approved it, but this is a Full pipeline because it adds a dependency, a named `img-src` host in `next.config.ts` and a tripwire.
   - The operator wants a working demo, but with no key set the map never appears on dev, preview or production.
   - **Ruling:** build the cards and the list as slice one with no dependency. That alone satisfies the demo.
   - The map is a separable slice two, and Phase 2 should re-confirm DECISION-122 against today's registry (BSD-2 license, `react-leaflet` still rejected).
   - If the lead keeps the map in this pipeline, the child work-log should be `inc2`. Phase 5 can only verify it with a fake key and intercepted tile requests. The Phase 6 verdict for the map is then **SHIP WITH NOTES**, carrying a tracked follow-up "walk the real tiles once the operator provisions the key."
   - The Phase 4 tripwire confining both package names to `map.tsx` gates Phase 5.
   - The CSP header is Report-Only today, so a wrong host would fail silently. The only guard is the intercepted-tile test.
2. **Which congregation count, and to whom.**
   - The roster is an org-structure read, not a keyed one, but the cards sit under each key.
   - **Ruling:** the "Member congregations" card needs at least one held key, so there is one page-level forbidden state and no keyless peek.
   - It shows the count of current member congregations, the same roster the reports use. It excludes new worshiping communities and departed congregations, and the label says so.
3. **What each card shows when data is missing (never a misleading zero).**
   - **Ending active members.**
     - Use the report's default window (five years ending last calendar year).
     - Show the **newest year in that window that has any statistics row**, with the year printed on the card, for example "2025 · 9 of 12 congregations reporting", with the total beside it.
     - If no year has data: "No statistics on file for 2021 to 2025", a link to record statistics, and no total.
     - A total with `reporting < members` always states the fraction on the card face.
     - Never show 0 when `reporting` is 0. Show a dash and the sentence.
   - **Vacant pulpits.**
     - If `appointmentsRecorded` is false, the card reads "No pastoral appointments recorded yet" and no count.
     - Otherwise show "N of M" with the same caveat sentence the report carries: a congregation whose appointment was never recorded appears as vacant. It is a pointer to Credentials, not a footnote.
     - "None vacant" is allowed only when appointments are recorded.
   - **Per capita.**
     - Use the report's own default billing year (current UTC year), and pass that year **explicitly** in the card's link. The card and the report page then agree to the cent, including near New Year, when the UTC default can flip hours before an Ohio midnight.
     - If every row is `not_billed`: "No bills generated for 2026", with the reason when there is one (no rate row, or no statistics for the basis year). It never says "$0.00".
     - Otherwise show billed, paid and outstanding, plus "N of M congregations billed".
     - The totals are the report's totals, including a departed congregation's kept bill, so the card equals the report. Say so on the report-bound caption: "includes N no longer members".
     - Outstanding negative means a credit, as in the report copy.
   - **Zero coordinates.**
     - A pin requires both values to be present, finite and in range (lat -90 to 90, lng -180 to 180), validated server-side in the new reader.
     - The edit form lets either field be blank independently, so half-set rows exist. They get no pin and are counted in "not on the map", not hidden.
     - A pair of exactly 0 and 0 is treated as missing (the Gulf of Guinea is not a congregation), with the row labelled "No location".
     - Coordinates never go in the CSV, in audit metadata or in a `<title>`, same as the shipped viability reader's rule.
4. **Which year the cards use (the explicit decision).** There is **no year selector and no query parameter** on the dashboard. A selector would add a parsing surface, and the reports already have year navigation. Each card prints its year and links to its report for any other year. This leaves no `year` parameter to validate.
5. **Coordinates are hard to enter, and the map's value depends on them.**
   - The form takes raw decimal latitude and longitude, with no lookup. DECISION-120 declined a geocoding dependency.
   - A clerk must get decimals from a maps application. The help page must say how, and must note that the longitude of a US congregation is negative.
   - A swapped latitude and longitude is undetectable in range (for example 39.9, -83.0 swapped is out of range, but 40.1, 83.0 is not), so the empty-state line carries the order "latitude first".
   - **Out of scope:** geocoding from an address.
6. **The Insights tile is `comingSoon: true` for every type.**
   - `comingSoon` is per tile, not per type. Once the presbytery page is real, the presbytery would see a "Coming soon" pill on a working page, and a congregation would see a live-looking tile over the unchanged stub.
   - Phase 3 must settle this with a per-type treatment, and drop "Coming soon" from the description per the field's own rule.
   - `tiles.test.ts` and `portal-menu` parity tests pin `comingSoon`, so expect them to change in the same commit.
7. **The map is a third-party call, which is a disclosure.**
   - The viewer's browser contacts the tile provider, and it receives the viewer's IP and the viewport bounds. Pin data (names and viability) is client-side and **never** goes in a tile URL.
   - The map component must never put a congregation name or score in a URL or in the `Referer`.
   - `privacy-policy.md` lists Turnstile as a third party. It needs a matching entry for the tile provider, and it applies **only once the key is set**. Tile-provider attribution (MapTiler and OpenStreetMap) must render on the map.
   - Accessibility: the list is the accessible alternative. Pins must be keyboard-focusable and carry a text name.
8. **Phone behaviour at 360px (the shell rule that pages must work on a phone).**
   - Cards stack single-column.
   - The viability list becomes cards below `sm`, and a table at `sm` and above, the precedent in `src/components/presbytery-reports/`.
   - The map is a fixed-height block, about 18rem, **inside** the page's scroll. A one-finger drag on a Leaflet map traps page scroll, so the touch behaviour must be decided (two-finger pan, or a clear gutter) before the lead signs the slice off. Add an "e2e at 360px: page scrolls past the map" test.
   - No horizontal overflow.
   - A table that overflows is the existing F-class defect, and it is not allowed to recur here.
9. **A reader ordering note for Phase 3.** Each reader is already callable as `getX(viewer)`, which owns its own transaction. Use that (or `Promise.allSettled`) so a failing reader does not abort the others' shared transaction.
10. **2FA gate mid-enrolment.** The proxy and `assertOrgSession` redirect an un-enrolled user who is required to enrol to `/totp`, with the page's own path as the callback. That is identical to the reports, and no new behaviour is needed.
11. **Audit.** Read-only, with no export, so **no audit event**. The reports audit only exports. Say this explicitly so it is not read as an omission.

## Out of Scope (confirm with user)

- Rulings A to G and anything that waits on them: the congregation model, committees, presbytery officers, mission giving, directory export, Excel and import. None of it is touched.
- The provenance-labelled rollup table (`statistics-table.tsx`) from the August design.
- A year or window selector on the dashboard.
- Geocoding from an address.
- A "dashboard CSV" export.
- A new key or flag.
- Dashboard content for congregation, synod or GA types (they keep `ComingSoon`).
- Changing what the four reports compute.
- Heat layers, clustering, routing and layer switching on the map.

## Help impact

- **`presbytery-reports` (edit).** Add a short "Dashboard" section: where the page is, what each card says and which key it needs. Cross-link the permission table. It is the same page family, and the "Open the reports" and Viability sections already quote the labels. The registry `labels` array gets "Insights & Analytics" and the card titles.
- **`presbytery-tools` (edit if it lists the presbytery's tiles).** It likely names the placeholders. Phase 3 reads it and either edits it or states why not.
- **`roles-who-can-do-what` (edit).** The permission bundle table needs the dashboard rows: that a stated clerk sees three cards and viability needs `congregation_oversight.manage`.
- **`turning-features-on-and-off` (check).** It must still say Insights is platform-managed and not a per-congregation toggle.
- **`privacy-policy` (edit, conditional).** Add the tile provider, effective when the key is set, with Phase 6 deciding whether it ships with slice two.
- **A new `[help:<token>]` placeholder** is not needed. The feature's own branch edits its pages as `published`.
- **Coordinate-entry instructions** (decimal degrees, latitude first, negative longitude) go on the oversight help page, and its coordinate field label is one the page may already quote. `npm run check:help` catches a label that leaves the UI but not a changed behaviour.
- **Phase 6** reads each named page as its reader at 360px against the shipped build.

## Adversarial pass

- **Redirects.** No `callbackUrl`, `next` or redirect parameter is read. The only redirects are the gate's own-path sign-in and TOTP callbacks. **Confirmed.**
- **State-machine shortcuts.** There is no multi-step flow. A user who skips the tile and types `/admin/insights` hits the same gate, and each card is also protected by its reader's live key check. **Confirmed.**
- **Enumeration.** The four-way org miss is reused. Do not add a presbytery-specific 404 or 403, since the org tree is public and the flag is global. A card locked by key reveals only the key's name, which the hub already shows. **Confirmed.**
- **Input boundaries.** There are no inputs. Coordinates and viability scores are validated server-side in the reader and in `deriveViability`, which throws on an out-of-range score. A page error on one bad row must not blank the dashboard, so one throwing row degrades the card, not the page. **Gap to carry to Phase 3.**
- **Stored XSS through names.** Congregation names are tenant-entered, and Leaflet's `bindPopup` and tooltip APIs interpret strings as HTML. The map must set text through `textContent` or a DOM node, or have no popups at all (click goes straight to the oversight link). **Gap: explicit rule for Phase 3 and a test with `<img onerror>` in a name.**
- **Payload over-exposure.** The map's client component must receive only `{id, name, lat, lng, scoreLabel}` for permitted rows, never the redevelopment notes, buildings or insurance. **Gap: pin it in a test.**
- **Self-targeting.** Not applicable, because the page has no write action.
- **Third-party key.** The tile key is a public, domain-restricted value, the Turnstile site-key shape, not a secret. It must not be reused for any server call, and `check:secrets` allows it only under the public prefix.

## Open Questions

- The lead's call: **does the map ship in this pipeline or as `inc2`?** I recommend splitting. Slice one is cards plus list and is demonstrable now. Slice two is the dependency, the CSP host and the tile test, all verifiable only with a fake key until the operator supplies one. If the map stays in, the Phase 6 verdict for it is capped at SHIP WITH NOTES.
- The public key's environment variable name, so the lead can settle it in Phase 3 and tell the operator. I suggest `NEXT_PUBLIC_MAPTILER_KEY`, as already assumed.
- What copy does the Insights tile show for a presbytery while it still shows the stub for other types? Phase 3 to draft.

**Handoff:** architect (Phase 2). The questions:
- Re-confirm the DECISION-122 dependency and the single-file tripwire, and rule on the map as its own increment.
- Settle the gate shape (parametrising `gateReportPage`'s flag versus a sibling skin) against `boundaries.test.ts`.
- Rule on where `next/dynamic(..., { ssr: false })` lives, since it can't be called from a Server Component page.
- Confirm that the new coordinate reader sits in `src/lib/presbytery-reports/` behind `congregation_oversight.manage`, with no `getPlatformDb()`.

**Orchestrator ruling on the open question (2026-11-16):** split as the analyst recommends. This pipeline ships slice one (cards plus the viability list, no new dependency). The map becomes a separate increment, started once the operator supplies the MapTiler key; it is a TODO line, not part of this work-log. With no dependency left, Phase 2 still runs (gate shape, structure), briefly.


---

# Phase 2 — Architectural Review (architect)

*Recorded verbatim from the architect's return, 2026-11-16.*

## Verdict

**Approved with suggestions.** Slice one adds no dependency, migration, route, server action, definer, flag or permission key. It composes readers that already shipped behind a gate that already shipped. The five rulings below are the suggestions, and Phase 3 must carry them. I am proposing one architectural decision, DECISION-342, covering rulings 1 and 3.

## Placement

- **Directory placement:**
  - **The gate (ruling 1).** It stays in `src/lib/presbytery-reports/gate.ts`. Move the body of `gateReportPage` into an unexported core, `gatePresbyteryPage({ slug, path, flag })`. Type `flag` as a closed literal union, `typeof REPORTS_FLAG | typeof INSIGHTS_FLAG`, with no default value. Export two named versions:
    - `gateReportPage({ slug, path })`: same signature and behaviour as today, passing `REPORTS_FLAG`.
    - `gateInsightsPage({ slug, path })`: passes `INSIGHTS_FLAG`.

    Add `INSIGHTS_FLAG = "org_portal.insights"` to `contract.ts`, beside `REPORTS_FLAG`. Remove the local constant in `insights/page.tsx`.

    I prefer two named functions to an exported flag parameter for three reasons. First, the existing `calls-gate` pin (`boundaries.test.ts:72`) keeps meaning "this page reads the reports flag" without any change. Second, the insights page can be pinned to its own name. Third, no call site can pass the wrong flag, because none passes a flag at all.

    I reject a fully separate sibling gate. It would duplicate the session, 2FA, four-way-miss and access sequence, and two copies of that sequence drift apart.

    `gateReportRoute` is untouched, because the dashboard has no route.
  - **The composition (ruling 2).** Create a new `src/lib/presbytery-reports/dashboard.ts`, marked `server-only`, exporting `getPresbyteryDashboard(viewer, now)`. Its order:
    1. Call `getReportsHub(viewer)` in one transaction. If no key is held, return a single `forbidden` result before any data read. A keyless viewer never triggers the roster read, which has no key of its own.
    2. Otherwise, run `Promise.allSettled` over the `getX(viewer, …)` getters for the held keys only. Each getter owns its own `withOrgContext` transaction.
    3. Add a roster-count getter that opens its own transaction and calls the existing `readRoster`. `roster.ts` stays the one roster read.

    Compute `now` once. Derive the per-capita billing year and the trend window from it with the existing `params.ts` helpers (`defaultTrendWindow`, the billing-year default), so each card and its report link use the same explicit year.

    A rejected settle whose reason is `OrgAccessError` must be **rethrown** to `[slug]/error.tsx`, the same rule as `runReportRead`. It must never be shown as a card-level load error. Any other rejection becomes that card's `error` state. A reader's `{ kind: "forbidden" }` (a key revoked between the hub read and the read) renders that card as locked.

    The concurrency is at most five transactions on `appPool`. That pool uses the default `max`, which is within budget alongside the layout's reads. No cap is needed.
  - **Components.** Put them in `src/components/presbytery-reports/` (for example `dashboard-cards.tsx` and `dashboard-states.tsx`), reusing `report-states.tsx` and `viability-view.tsx` where the shapes fit. This follows the module's precedent: each view there serves exactly one page. Add the dashboard strings to `copy.ts` so that `allCopyStrings()` and its test cover them.
  - **The page.** `src/app/(org)/o/[slug]/admin/insights/page.tsx` calls `gateInsightsPage` and maps each state:
    - `flag_off` renders the existing `PlaceholderFlagOff`.
    - `not_applicable` (any type other than presbytery) renders the existing `ComingSoon`, not any report copy.
    - `org_forbidden` and `org_ended` render the existing `OrgAccessDenied` and `OrgAccessEnded`.
    - `ok` renders the dashboard.

    The flag is checked before the type, as today. A congregation with insights off still sees `PlaceholderFlagOff`.

    The page also reads `org_portal.reports` and `org_portal.oversight` with the bare `isFlagEnabled`. This decides only whether each card or row renders as a link or as plain text. It is presentational and gates nothing.
  - **The tile (ruling 3).** Add one optional field to `PortalTileBase`: `liveFor?: readonly OrganizationType[]`, an allow-list. Set `liveFor: ["presbytery"]` on `insights`, alongside its existing `comingSoon: true`.

    Resolve the field in one place, `visiblePortalTiles`, which is the only function that already holds `organizationType`. It returns a copy with `comingSoon: tile.comingSoon === true && !tile.liveFor?.includes(organizationType)`. Never mutate the frozen registry.

    Every consumer already reads the resolved tile and does not change: `tile-grid.tsx`, `buildPortalMenu`, `portal-footer.tsx`, the home page and the admin hub.

    I reject two tiles that share an href and have disjoint `orgTypeScope`. That duplicates the label and breaks key uniqueness, and the `tiles.test.ts` and parity pins would have to accept a fake second key. I also reject widening `comingSoon` to `boolean | OrganizationType[]`, because that overloads a field whose doc comment defines it as a boolean.

    Add tests to `tiles.test.ts`:
    - `liveFor` is set only where `comingSoon` is true.
    - `liveFor` is a subset of `orgTypeScope` when scope is set.
    - A resolution test: insights is not coming-soon for a presbytery and is coming-soon for a congregation.

    The description "Dashboards, trends, and per-capita/membership insights." is shared by every type. Phase 3 must check that it is true for a presbytery (there is a trend card) and still reads as roadmap text beneath the pill for other types.
- **Server vs Client split:** everything in slice one is a Server Component. The card retry is a plain link to the page's own path, so it needs no client component. The existing `no-use-client` scan over `src/components/presbytery-reports/` must stay green. (Slice two's `map.tsx` sits at the route under DECISION-122, outside that scan. See note 5.)
- **Dependencies:** none.

## Invariants Touched

- **The `(org)` contract (ruling 4).** Confirmed. Every read is a getter that already exists or a new roster getter, each through `withOrgContext()` on `db`. `getPlatformDb()` does not appear. The gate keeps the page-level auth check and the four-way miss (DECISION-040), and it adds no new 403 or 404 variant. One deliberate tightening: the insights page now runs `assertOrgSession` (the Node-side 2FA recheck) for **every** org type, not only presbyteries. That matches every other gated `(org)` page. `insights/page.test.tsx` must be updated for it.
- **No `loading.tsx`.** The gate calls `notFound()` and `redirect()`, so `admin/insights/**` may never have a `loading.tsx`. Pin it (below).
- **Permissions vs flags (DECISION-003).** Kept separate. `org_portal.insights` is a rollout toggle read by the bare helper (not an auth-path flag, so DECISION-026 does not apply). Each card's authority is its report's own key, checked live inside the reader's transaction. The hub read only sequences the work and avoids empty transactions; it is not the authority. The reports flag is never read as a gate here, so a presbytery with insights on and reports off sees cards. That is correct: a flag stages a rollout and grants nothing.
- **Audit (ruling 4).** None is needed. The page is read-only, has no export, and produces no file. DECISION-339 audits exports only. The existing `exportFunctionNames` pin (exactly four `export*` names) already stops a dashboard export from appearing without this review. Phase 3 should say "no audit, read-only, no export" in its Edge Cases so nobody reads the absence as an omission.
- **No Role Carries a Wildcard and tiers.** Unchanged. Cards for tier-2 data (trend, per capita) stay under tier-2 keys. The unkeyed roster count is shown only to a holder of at least one key.
- **Brand scope.** Unchanged. `(org)` is already brandable, and no emitter is added.

## Notes

Phase 3 must honour these.

1. **`boundaries.test.ts` extension:**
   - `dashboard.ts` joins `moduleFiles` automatically through the directory walk, so the existing rules cover it: no owner connection, read-only, no forbidden reads, no `recordAudit`, no `export*` function.
   - Add a scan of `src/app/(org)/o/[slug]/admin/insights/` (non-test files) for: `no-owner-connection`, `read-only`, `no-redirect-target`, `strict-params` and `no-use-client` (slice one only; the map increment relaxes this for exactly `map.tsx` and its dynamic shim).
   - Add an `insights-calls-its-gate` rule. The page calls `gateInsightsPage(` and does **not** call `gateReportPage(`. Give it a failing sample in each direction.
   - Add a `no loading.tsx under admin/insights/**` assertion.
   - Keep the "real tree" count assertions honest. `pages` stays at 4 because the insights page sits outside `REPORTS_DIR`.
2. **`gate.test.ts`:** add cases asserting that `gateInsightsPage` calls `isFlagEnabled` with `"org_portal.insights"` and never with `"org_portal.reports"`, and the reverse for `gateReportPage`. Add one case each for `flag_off` and `not_applicable` through the insights gate.
3. **The per-card failure rule** (Phase 1, adversarial pass, "input boundaries"): a throwing reader, including `deriveViability` on an out-of-range score, degrades its own card and never the page. Because each card settles independently, this holds by construction. Phase 3 must cite the test that pins it with one rejected reader.
4. **Roster empty state:** when the roster count is 0, show one empty state instead of four zero cards. If the roster read itself fails, show a card-level error, not the empty state. "Couldn't load" must never render as "no congregations".
5. **For the record, DECISION-122 still stands for the map increment (not a gate on this slice).** I re-checked the npm registry on 2026-11-16:
   - `leaflet` latest is 1.9.4, BSD-2-Clause, with no runtime dependencies.
   - `react-leaflet` latest is 5.0.0, licensed **Hippocratic-2.1**, and stays rejected.
   - The keyed tile provider, the one named `img-src` host, single-file containment at `src/app/(org)/o/[slug]/admin/insights/map.tsx` through `next/dynamic(..., { ssr: false })`, and the tripwire pinning both package names to that file all still stand.

   One new fact for that increment: `leaflet` has published nothing on `latest` since 2023-05-18. Active work is on `2.0.0-beta.4`, modified 2026-11-12. Leaflet 2.0 is ESM-only and changes the API, removing the global `L`. When the map increment starts, it must choose one of these explicitly:
   - pin `~1.9.4`, or
   - adopt 2.x if it has reached `latest` by then.

   It must not let a caret range pull across that line. Because `next/dynamic` with `ssr: false` must be called from a client component, the containment may need a two-file shape (a thin client loader plus `map.tsx`). That increment's tripwire and the `no-use-client` exception should name both files exactly.

**Proposed DECISION-342:** *The presbytery dashboard reuses the report gate through two named versions over one private core with a closed flag union (`gateReportPage` for `org_portal.reports`, `gateInsightsPage` for `org_portal.insights`). No call site passes a flag. It composes the shipped readers in `src/lib/presbytery-reports/dashboard.ts`: a hub read first, then one transaction per held reader, settled independently, with `OrgAccessError` rethrown. A tile's coming-soon state becomes per-type through an optional `liveFor` allow-list on `PortalTileBase`, resolved only in `visiblePortalTiles`. DECISION-122 is re-confirmed against the registry (leaflet 1.9.4 BSD-2-Clause; react-leaflet 5.0.0 Hippocratic-2.1, rejected), with a note that the map increment must choose explicitly between Leaflet 1.9 and 2.x.*

**Handoff:** tech-lead (Phase 3). Turn rulings 1 to 3 into the API contract and component plan. Carry notes 1 to 4 into Carry-forward and Edge Cases. Draft the tile description check and the dashboard Copy in `copy.ts`. The implementer is probably full-stack-developer, since there is no schema work and the coupled server and UI change is small.


---

# Phase 3 — Technical Design (tech-lead)

*Written 2026-11-16. Slice one only: the presbytery branch of `/o/<slug>/admin/insights` gets four summary cards and the viability list. The map (Phase 1 Flow 5, the `leaflet` dependency, the CSP host, the tile tripwire, the `privacy-policy` entry and the coordinate-entry help) is a separate later increment, recorded as one TODO line under Carry-forward. DECISION-342 (new, `docs/decisions.md`) records the architect's rulings and what is settled below.*

## Summary

A presbytery staff member opens the "Insights & Analytics" tile and reads one read-only page: a card of member congregations, three cards that each summarise one shipped report (ending active members, vacant pulpits, per capita), and below them the viability list with a link to each congregation's oversight page. Each card is gated by that report's own key and shows one of four states: a figure, "nothing recorded yet", locked, or a load error. A viewer who holds none of the four report keys gets one forbidden state. A presbytery with no member congregations gets one empty state. The page composes readers that already exist (`getMembershipTrend`, `getVacantPulpits`, `getPerCapita`, `getViability`) plus a roster count, one transaction each, settled independently. It adds no migration, no permission key, no flag, no route, no server action, no definer function and no dependency. Congregations, synods and GA keep the unchanged "coming soon" stub; the tile stops saying "Coming soon" for a presbytery only (`liveFor`).

Where the tile is: it is `category: "operate"`, domain "Reports & Insights", so a presbytery reaches it from its home page and the menu, not from the Administration hub (the Phase 1 verb table said "Administration"; the help text below says the home page, and Phase 4 confirms it from the screen).

## Permissions & Flags

- **Permission keys:** none new. Each card uses its report's existing key, checked live inside the reader's own transaction (`presby_has_permission`); the hub read only sequences the work.

  | Card or section | Reader | Key | Held-by default |
  |---|---|---|---|
  | Member congregations | `readRoster` (via a new `getRosterCount`) | none, shown only to a holder of at least one key below | n/a |
  | Ending active members | `getMembershipTrend` | `statistics.manage` | presbytery stated-clerk template |
  | Vacant pulpits | `getVacantPulpits` | `credentials.manage` | presbytery stated-clerk template |
  | Per capita | `getPerCapita` | `per_capita.manage` | presbytery stated-clerk template |
  | Viability list | `getViability` | `congregation_oversight.manage` | founding-administrator bundle for a presbytery (`0059`, `0071`, `0085`) |

  `congregation_oversight.view` does not exist and is not minted. Default role bindings: unchanged. The first-customer demo is walked as both a clerk (three cards, viability locked) and the founding administrator (viability only, until the clerk role is also held); Phase 5 and Phase 6 do both.
- **Flags:** existing `org_portal.insights` gates the page through `gateInsightsPage`. The page also reads `org_portal.reports`, `org_portal.oversight` and `org_portal.credentials` with the bare `isFlagEnabled`, to decide only whether a card or row is a link or plain text (a flag stages a rollout and grants nothing; DECISION-003). No new flag (operator rule: none pre-live). Rollback is turning `org_portal.insights` off: the page reverts to "isn't turned on", no data change. The flag's production state at ship is an operator decision, recorded in the release note (the TODO go-live note says it is ON for the two real organizations, so after ship a presbytery reaches real data through it).
- **Tile:** `liveFor: ["presbytery"]` on `insights` (see API Contract).

## API Contract

No route, no server action, no definer function. Server functions and types:

**`src/lib/presbytery-reports/contract.ts`** (pure, no imports) adds beside `REPORTS_FLAG`:
`INSIGHTS_FLAG = "org_portal.insights"`, `OVERSIGHT_FLAG = "org_portal.oversight"`, `CREDENTIALS_FLAG = "org_portal.credentials"`. The local `INSIGHTS_FLAG` in `insights/page.tsx` is removed.

**`gate.ts`**: the body of `gateReportPage` moves into an unexported `gatePresbyteryPage({ slug, path, flag })`, `flag: typeof REPORTS_FLAG | typeof INSIGHTS_FLAG`, no default. Two exports:
- `gateReportPage({ slug, path })`: same signature, same behaviour, `REPORTS_FLAG`.
- `gateInsightsPage({ slug, path })`: `INSIGHTS_FLAG`. Same order (signed in, Node-side second-factor recheck, four-way miss, `assertOrgAccess`, flag, type) and the same `ReportPageGate` result. `gateReportRoute` is untouched. The header comment's step 4 names "the page's own flag".

**`dashboard-derive.ts`** (new, pure, no imports beyond `type` imports of `derive.ts`):
```ts
export type TrendSummary =
  | { kind: "figure"; year: number; total: number; reporting: number; members: number; from: number; to: number }
  | { kind: "no_figure"; year: number; members: number; from: number; to: number }
  | { kind: "none"; from: number; to: number };
export type VacantSummary =
  | { kind: "not_recorded" }
  | { kind: "none_vacant"; total: number }
  | { kind: "some"; vacant: number; total: number };
export type PerCapitaSummary =
  | { kind: "figure"; billingYear: number; billedCents: number; paidCents: number; outstandingCents: number;
      billedCount: number; total: number; departedBilled: number }
  | { kind: "none"; billingYear: number; rateSet: boolean };
export interface ViabilityListRow { organizationId: string; name: string; score: number | null; label: string }
export interface ViabilityList { rosterCount: number; anyNotAssessed: boolean; rows: ViabilityListRow[] }

summarizeTrend(data: MembershipTrendData): TrendSummary
summarizeVacant(data: VacantPulpitsData): VacantSummary
summarizePerCapita(data: PerCapitaData): PerCapitaSummary
toViabilityList(data: ViabilityData): ViabilityList
```
Rules, each pinned in `dashboard-derive.test.ts`:
- *Trend.* Walk `data.years` newest to oldest and take the newest year in which any cell is `value` (a statistics row exists, with or without a figure). None: `none`. Found and that year's `footer.reporting` is 0: `no_figure`. Otherwise `figure` with that year's footer `total`, `reporting`, `members`. `members` is the footer's count (cells that are not `not_member`), not the current roster.
- *Vacant.* `appointmentsRecorded` false: `not_recorded`, never a count. Else `rows.length` of `rosterCount`; zero rows is `none_vacant`, reachable only when appointments are recorded.
- *Per capita.* Billed rows are those whose `status` is not `not_billed`. None: `none`, with `rateSet = rateBasisYear !== null`. Else `figure` with the report's own `totals` (so the card equals the report, departed congregations' kept bills included), `billedCount` = billed rows with `membership === "member"`, `total` = `rosterCount`, `departedBilled` = billed rows with `membership === "departed"`.
- *Viability.* Keeps `organizationId`, `name`, `score`, `label` and `anyNotAssessed`; drops notes and the updated date. Order is `deriveViability`'s (at risk, fair, healthy, not yet assessed).

**`dashboard.ts`** (new, `import "server-only"`):
```ts
export type CardResult<T> = { kind: "ok"; data: T } | { kind: "locked" } | { kind: "error" };
export interface DashboardCards {
  membership_trend: CardResult<TrendSummary>;
  vacant_pulpits: CardResult<VacantSummary>;
  per_capita: CardResult<PerCapitaSummary>;
  viability: CardResult<ViabilityList>;
}
export type PresbyteryDashboard =
  | { kind: "forbidden" }
  | { kind: "error" }
  | { kind: "ok"; roster: { kind: "ok"; count: number } | { kind: "error" }; cards: DashboardCards };

export async function getPresbyteryDashboard(viewer: ReportViewer, now: Date = new Date()): Promise<PresbyteryDashboard>;
export function getRosterCount(viewer: ReportViewer): Promise<number>; // withOrgContext + readRoster(...).length
```
Order inside `getPresbyteryDashboard`:
1. `const { held } = await getReportsHub(viewer)`. An `OrgAccessError` is rethrown; any other throw returns `{ kind: "error" }`. If no key is held, return `{ kind: "forbidden" }` with no further read.
2. `trend = defaultTrendWindow(now)`; `billingYear` is `parseBillingYear(undefined, now)`'s value, falling back to `now.getUTCFullYear()` (the same fallback the per-capita page uses). `now` is read once by the caller and passed to `getVacantPulpits(viewer, now)` too.
3. One task per held key, plus the roster, started together under `Promise.allSettled`. Each task is `async () => { const r = await getX(viewer, ...); return r.kind === "forbidden" ? LOCKED : { kind: "ok", data: summarize(r.data) }; }`, so a throwing summarizer (for example `deriveViability`'s `RangeError` on an out-of-range score, which happens inside the reader) rejects that task only.
4. After settling: any rejection whose reason is `instanceof OrgAccessError` is rethrown (first one found). Any other rejection becomes `{ kind: "error" }` for that card (or `roster: { kind: "error" }`). A key not held is `{ kind: "locked" }` and its reader is never called.

Concurrency: at most five transactions on `appPool` (one hub, then up to five in parallel: four readers and the roster). Accepted per the architect (default `max`, within budget alongside the layout's reads); not load-tested ("unverified").

**The page** (`insights/page.tsx`, a Server Component, no `"use client"`, no `loading.tsx`):
1. `const gate = await gateInsightsPage({ slug, path: "/o/<slug>/admin/insights" })`.
2. Not ok: `org_forbidden` renders `OrgAccessDenied`; `org_ended` renders `OrgAccessEnded`; `flag_off` renders `PlaceholderFlagOff` (area "Insights & Analytics"); `not_applicable` renders the existing `ComingSoon` with the existing description, so a congregation, synod or GA organization is unchanged.
3. Ok: compute `now` once; `const [dashboard, reportsOn, oversightOn, credentialsOn] = await Promise.all([getPresbyteryDashboard(identity, now), isFlagEnabled(REPORTS_FLAG), isFlagEnabled(OVERSIGHT_FLAG), isFlagEnabled(CREDENTIALS_FLAG)])` as a plain value before the `return` (never a nested async component, the reports hub's rule). An `OrgAccessError` propagates to `[slug]/error.tsx`.
4. Render by `dashboard.kind`: `forbidden` one state; `error` one load error with a retry link to the page's own path; `ok` with `roster.kind === "ok" && count === 0` one empty state and no cards; otherwise the cards and the list.

No query parameter is read. The only redirects are the gate's own-path sign-in and `/totp` callbacks.

**`PortalTileBase`** (`src/lib/org-portal/tiles.ts`) gains `liveFor?: readonly OrganizationType[]`, documented as "valid only where `comingSoon` is true; an allow-list; resolved in `visiblePortalTiles` and nowhere else". `insights` sets `liveFor: ["presbytery"]`. `visiblePortalTiles` maps each surviving tile through `resolveComingSoon(tile, organizationType)`: when `tile.liveFor?.includes(organizationType)` it returns `{ ...tile, comingSoon: false }`; otherwise the same object (so every other tile is untouched). The frozen registry is never mutated.

## Data Model

No schema changes required. No migration (0088 stays reserved, 0089 free). No new read of an unreadable table: the roster read is `readRoster`, which already exists.

## Component / Page Plan

- **Pages to create:** none.
- **Pages to modify:** `src/app/(org)/o/[slug]/admin/insights/page.tsx` (rewritten around the gate; the old inline auth block goes; the `ComingSoon` branch survives for `not_applicable`).
- **Lib files to create:** `src/lib/presbytery-reports/dashboard.ts`, `dashboard-derive.ts`.
- **Lib files to modify:** `contract.ts` (three flag constants), `gate.ts` (split), `copy.ts` (`DASHBOARD_COPY`, `formatCount`, sampler arguments), `src/lib/org-portal/tiles.ts` (`liveFor` field and the insights tile), `src/lib/org-portal/visible-tiles.ts` (resolution), `scripts/seed.ts` (the `org_portal.insights` flag description, line 646-647, which says the presbytery branch is unbuilt).
- **Components to create** (all Server Components, in `src/components/presbytery-reports/`, inside the existing `no-use-client` scan): `dashboard-cards.tsx` (the four cards and their per-state bodies), `dashboard-viability.tsx` (the list: cards below `sm` with `data-testid="dashboard-viability-cards"` and `sm:hidden`, a table from `sm` with `data-testid="dashboard-viability-table"` and `hidden sm:block`), `dashboard-states.tsx` (page forbidden, page error, empty roster, card locked, card error, section locked, section error). Cards sit in a `grid grid-cols-1 gap-3 sm:grid-cols-2` with `min-w-0` and `break-words` on every name and figure; every link and button is `min-h-11`.
- **Components to modify:** `viability-view.tsx` exports its `ViabilityBadge` (text carries the status, not colour alone) so the list reuses it.
- **Help pages to edit:** see "Help impact" below.
- **Tests to create or modify:** listed in "Carry-forward" against the requirement each pins.

## Implementation Order

1. `contract.ts` constants; `gate.ts` split; `gate.test.ts` additions.
2. `tiles.ts` field and insights tile; `visible-tiles.ts` resolution; `tiles.test.ts` and `visible-tiles.test.ts` additions.
3. `dashboard-derive.ts` and its test.
4. `copy.ts` `DASHBOARD_COPY` and `copy.test.ts` additions.
5. `dashboard.ts` and `dashboard.test.ts`.
6. Components and `dashboard-views.test.tsx` (in `src/components/presbytery-reports/`).
7. The page and `page.test.tsx` (rewrite for the gate).
8. `boundaries.test.ts` extensions.
9. Help: `presbytery-reports.md`, `registry.ts`, `coverage-allowlist.ts`, `coverage.test.ts`, `help-page.test.ts`.
10. `scripts/seed.ts` flag description; `e2e/presbytery-dashboard.spec.ts`.
11. `npm run check`, typecheck, unit suite, then the page in a browser at 360px as the clerk, the no-grant user and `org-multi`, on port 3101 (`E2E_BASE_URL=http://localhost:3101`).
12. Housekeeping at ship: release notes (`/release-notes`), `docs/product/functionality-map.md`, TODO reconciliation (orchestrator), `verifiedIn` on the help page after the walk. No audit events (see Edge Cases).

## Carry-forward

| Phase 1 gap / Phase 2 ruling | Addressed here (where), and the test that pins it |
|---|---|
| **P1 G2** Member-congregations card needs at least one key; one forbidden state, no keyless peek | `getPresbyteryDashboard` step 1; `dashboard.test.ts` › "holding none of the four keys returns forbidden and reads nothing else" (asserts the roster getter and every reader are uncalled). |
| **P1 G2** Count excludes new worshiping communities and departed congregations, and the label says so | `DASHBOARD_COPY.cards.members.note` (Copy); the exclusion is `readRoster`'s, already pinned by `boundaries.test.ts` › "the roster filters on an active lifecycle". `copy.test.ts` › "the members note says what is excluded". |
| **P1 G3 / Flow 3** Honest zero: ending active members | `dashboard-derive.test.ts` › "trend: newest year with any statistics row, with its fraction", "trend: a row with no figure is no_figure, never a zero", "trend: no row in the window is none". `dashboard-views.test.tsx` › "trend card shows a dash and the sentence for no_figure and never a 0". |
| **P1 G3** Honest zero: vacant pulpits (`appointmentsRecorded` false shows no count; "none vacant" only when recorded) | `dashboard-derive.test.ts` › "vacant: not recorded is not_recorded", "vacant: none_vacant only when appointments are recorded"; `dashboard-views.test.tsx` › "vacant card, not recorded, shows no count". |
| **P1 G3** Honest zero: per capita (explicit year, never "$0.00", departed bill kept and captioned, credit as in the report) | `dashboard-derive.test.ts` › "per capita: no billed row is none with rateSet", "per capita: totals equal the report's and departed bills are counted apart"; `dashboard-views.test.tsx` › "per capita none never prints a dollar amount", "per capita figure prints credit for a negative still-owed". |
| **P1 G3** Zero coordinates, half-set pairs | *Deferred to the map increment*: slice one reads and shows no coordinate (the shipped viability reader never reads coordinates). Accepted by the orchestrator's split ruling (work-log, end of Phase 1). |
| **P1 G4** Years explicit; no year parameter, no selector | `dashboard.test.ts` › "derives the trend window and billing year from one now" (including `now = 2026-01-01T03:00Z`, where the UTC year is 2026 and an Ohio calendar is still 2025: the reader is called with 2026 and the summary carries 2026); `dashboard-views.test.tsx` › "card links carry explicit years: ?from=2021&to=2025 and ?billingYear=2026"; `boundaries.test.ts` › strict-params and no-redirect-target over the insights directory (no parameter is read). |
| **P1 G5, G7, Flow 5, Flow 6** Coordinate entry help, map, tile-provider disclosure, key, popups-as-HTML, pin payload | *Deferred to the map increment* (orchestrator ruling, end of Phase 1). Nothing in slice one depends on them. |
| **P1 G6 / P2 ruling 3** `liveFor` | `tiles.test.ts` › "liveFor is set only where comingSoon is true", "liveFor is a subset of orgTypeScope when scope is set", "insights is not coming soon for a presbytery and is for a congregation"; `visible-tiles.test.ts` › "a tile with liveFor naming the type resolves comingSoon to false and a copy, never mutating the registry", "every other tile is returned as the same object". |
| **P1 G8** 360px: cards below `sm`, no horizontal overflow | `dashboard-views.test.tsx` › "the viability list has a card list (sm:hidden) and a table (hidden sm:block)" and "the card grid is one column below sm"; `e2e/presbytery-dashboard.spec.ts` › "at 360px there is no horizontal overflow and the page scrolls to the viability list". A long congregation name wrapping: *unverified* beyond the `break-words` and `min-w-0` classes (fixture names are short; the unit test asserts the classes). The map's touch and scroll behaviour is deferred with the map. |
| **P1 G9 / Flow 1** Concurrency: independent settle, `getX(viewer)` each | `dashboard.test.ts` › "starts every held reader before any settles" (deferred promises), "one rejected reader degrades only its own card", "a throwing summarizer degrades only its own card". |
| **P1 G10** Mid-enrolment second-factor redirect, identical to the reports | `page.test.tsx` › "a stale second factor redirects to /totp with the page's own path" (now true for every org type). |
| **P1 G11 / P2 ruling 4** No audit | `boundaries.test.ts` › "no recordAudit in the insights directory or the module" and the unchanged `exportFunctionNames` pin (exactly four `export*` names, so a dashboard export cannot appear unreviewed). Edge Cases says it in words. |
| **P1 Flow 1** One forbidden state naming the four permissions, not four locked cards | `dashboard-views.test.tsx` › "the forbidden state names all four permission phrases and shows no card"; `copy.test.ts` › "the forbidden body names every report's permission phrase"; `page.test.tsx` › "a presbytery member with none of the four keys sees one forbidden state". |
| **P1 Flow 1** Card-level load error with retry; page does not blank | `dashboard-views.test.tsx` › "a card error renders the card message and a retry link to the page's own path while the other cards render". |
| **P1 Flow 2 / P2 note 4** Roster empty and roster error | `page.test.tsx` › "roster count 0 renders one empty state and no cards", "a failed roster read renders the members card as an error and never the empty state". |
| **P1 Flow 4** Viability list always present, at risk first, badge carries text, row links to oversight | `dashboard-derive.test.ts` › "toViabilityList keeps order and drops notes and dates"; `dashboard-views.test.tsx` › "each row is a link to /o/<slug>/admin/oversight/<id> when oversight is on" and "the badge text is the label". The list renders whether or not a map exists (there is none). |
| **P1 Permissions** Links only when the target's own flag is on, plain text otherwise | `dashboard-views.test.tsx` › "with the reports flag off no card link renders and the figure still does", "with oversight off the viability names are plain text", "with credentials off 'Open Credentials' is absent"; `page.test.tsx` › "reads org_portal.reports, org_portal.oversight and org_portal.credentials and passes the three booleans" (and never the reports flag as a gate: "a presbytery with insights on and reports off still renders cards"). |
| **P1 Permissions** The gate split: reports flag not inherited by accident | `gate.test.ts` › "gateInsightsPage checks org_portal.insights and never org_portal.reports", "gateReportPage checks org_portal.reports and never org_portal.insights", "gateInsightsPage: flag off is flag_off", "gateInsightsPage: a congregation with the flag on is not_applicable". |
| **P1 Permissions** Default roles; demo walked as both people | Not a test. Phase 5 and Phase 6 walk it as `presbytery-clerk` (all four keys), `org-multi` (`statistics.manage` only: one card, three locked) and `presbytery-nogrant` (forbidden). Named so the demo cannot be walked as the richest user only. |
| **P1 Adversarial** One throwing row degrades the card, not the page | `dashboard.test.ts` › "a throwing summarizer degrades only its own card" (a `RangeError` from the viability read). |
| **P1 Adversarial** Stored XSS through names | Slice one renders names through React text only. `boundaries.test.ts` › "no dangerouslySetInnerHTML in the insights directory or the dashboard components" (new rule, with a failing sample); `dashboard-views.test.tsx` › "a congregation named `<img onerror>` renders as text". The Leaflet-specific rule (no `bindPopup`) goes with the map. |
| **P1 Adversarial** Payload over-exposure | Not a client payload in slice one (all Server Components). The same property is pinned where it matters here: `dashboard-derive.test.ts` › "the viability list never carries notes or dates" and `dashboard-views.test.tsx` › "redevelopment notes never render on the dashboard". |
| **P1 Help impact** | See "Help impact" below. |
| **P2 ruling 1** Gate stays in `gate.ts`, private core, closed union, two named versions, `INSIGHTS_FLAG` in `contract.ts`, local constant removed, `gateReportRoute` untouched | API Contract above. `gate.test.ts` cases above; `boundaries.test.ts` › "insights-calls-its-gate" (the page calls `gateInsightsPage(` and not `gateReportPage(`, with a failing sample each way) while the existing `calls-gate` pin stays over the four report pages. |
| **P2 ruling 2** `dashboard.ts`: hub first, `forbidden` before any read, `allSettled` over held getters plus the roster getter, `OrgAccessError` rethrown, reader `forbidden` is locked | API Contract; `dashboard.test.ts` › "an OrgAccessError from the hub, the roster or any reader is rethrown and never a card error", "a reader's forbidden renders that card locked". |
| **P2 ruling 3** `liveFor` | as P1 G6 above; every consumer unchanged (`tile-grid`, `buildPortalMenu`, `portal-footer`, home, admin hub read the resolved tile). `portal-menu-parity.test.tsx` stays green unchanged. |
| **P2 ruling 4** `(org)` contract, no `getPlatformDb()`, the insights page now runs the second-factor recheck for every type, `page.test.tsx` updated | `boundaries.test.ts` › "no-owner-connection over the insights directory", "no loading.tsx under admin/insights/**"; `page.test.tsx` rewritten. |
| **P2 note 1** `boundaries.test.ts` extension | Scan of `src/app/(org)/o/[slug]/admin/insights/` (non-test files) for `no-owner-connection`, `read-only`, `no-redirect-target`, `strict-params`, `no-use-client` (slice one; the map increment relaxes this for exactly its client files), plus `insights-calls-its-gate` and a `loading.tsx` assertion. `dashboard.ts` joins `moduleFiles` through the directory walk, so no owner connection, read-only, no forbidden reads, no `recordAudit` and no `export*` function already cover it. The real-tree count `pages` stays 4 (the insights page is outside `REPORTS_DIR`); the new scan asserts `insightsFiles.length >= 1`. |
| **P2 note 2** `gate.test.ts` cases | as above. |
| **P2 note 3** Per-card failure rule cites a test with one rejected reader | `dashboard.test.ts` › "one rejected reader degrades only its own card". |
| **P2 note 4** Roster empty and error | as P1 Flow 2 above. |
| **P2 note 5** DECISION-122 re-confirmed for the map increment, Leaflet 1.9 versus 2.x choice | Recorded in DECISION-342 ruling 4 and in the TODO line below; no gate on this slice. |
| **TODO line for the deferred map increment** (for `docs/TODO.md` at integration, under Next Up or Ready to build) | `- [ ] **Presbytery dashboard map (Increment 4b, slice two): a pin map above the viability list.** Starts when the operator supplies a MapTiler key. Needs: the DECISION-122 dependency, choosing explicitly between pinning leaflet ~1.9.4 and adopting 2.x once it reaches latest (never a caret across that line; leaflet has published nothing on latest since 2023-05-18); a thin client loader plus map.tsx at src/app/(org)/o/[slug]/admin/insights/ with a tripwire naming both files and the no-use-client exception for exactly them; one named img-src host in next.config.ts (CSP is Report-Only, so only an intercepted-tile test guards it); a coordinate read in src/lib/presbytery-reports/ behind congregation_oversight.manage (lat/lng both present, finite, in range; 0,0 is missing; half-set pairs counted as not on the map); text-only pin names (no bindPopup); a client payload of {id, name, lat, lng, scoreLabel} only, pinned by a test; the touch-scroll decision and a 360px page-scrolls-past-the-map e2e; the privacy-policy entry for the tile provider effective once the key is set; coordinate-entry help (decimal degrees, latitude first, a US longitude is negative) on the oversight help page; the public key name NEXT_PUBLIC_MAPTILER_KEY told to the operator. Phase 6 verdict for it is capped at SHIP WITH NOTES until the real tiles are walked. — docs/work-log/2026-11-17-presbytery-dashboard.md Phase 1 Gap 1 and Phase 3` |
| **Open for the user to confirm** | (a) The roster empty state drops Phase 1's "points to the existing help page for how a congregation joins": no such help page exists (`how-a-congregation-gets-started` is about setting up a congregation's own account, and presbytery membership is set only from `/admin`), so a pointer there would be false. The empty state links to the contact form instead. (b) The per-capita "none" state gives the reason only as far as the card's read can know it (a rate is set or not), because "no statistics for the basis year" needs a statistics read the card does not make; the report has the same limit. (c) The trend card takes the newest year with any statistics row (Phase 1's wording), so a year whose rows carry no figure shows a dash and the sentence even when an older year has figures; the card says which year it shows and links to the trend. |

## Edge Cases & Risks

**E2E blast radius.** No existing e2e spec asserts anything about the insights page or the Insights tile (`grep insights e2e` finds nothing). The one "Coming soon" assertion, `e2e/portal-footer-sitemap.spec.ts:116`, is on the Communications tile and is unchanged. `scripts/ci/e2e-reset-flags.sql:88` seeds `org_portal.insights` false; the new spec sets it. The existing specs that touch the presbytery (`presbytery-reports.spec.ts`, `presbytery-report-exports.spec.ts`, `presbytery-oversight.spec.ts`, `presbytery-credentials.spec.ts`) call the gates of other pages and are untouched by splitting `gateReportPage`'s body out (its signature and behaviour are pinned by the existing `gate.test.ts`). Unit specs that change: `insights/page.test.tsx` (rewritten around the gate; the inline-auth cases survive as gate cases; a stale second factor now redirects, for every org type), `tiles.test.ts`, `visible-tiles.test.ts`, `coverage.test.ts` and `copy.test.ts`.

**New e2e spec `e2e/presbytery-dashboard.spec.ts`** (own dev server on port 3101, `E2E_BASE_URL=http://localhost:3101`; no new fixture helper, so no person-id range is needed: it reuses the existing members). Flags it depends on, all set through `e2e/support/flags.ts` (`captureFlags`, `setFlag`, restored in `afterAll`): `org_portal.insights` (true; the reset file seeds it false), `org_portal.reports` (true; it is in the baseline, set again here so the spec does not rely on the baseline), `org_portal.oversight` (true, then false for the plain-text case), `org_portal.credentials` (true for the link assertion). The tile test (case 6) needs `org_portal.home_v2` on; the spec sets it too through `flags.ts` rather than relying on `scripts/ci/e2e-baseline-flags.sql` (where it already is). Every key the spec depends on is therefore set by the spec, and no baseline change is needed. Cases, all asserting structure and staged rows, never shared counts (it stages one appointment in the e2e presbytery, as `presbytery-report-exports.spec.ts` does, and removes it in `afterAll`):
1. `presbytery-clerk` sees the four card headings, a "N vacant of M congregations" line and the viability list with links to oversight.
2. `org-multi` (statistics only) sees "Ending active members" and three "Locked" badges naming their permissions.
3. `presbytery-nogrant` sees the one forbidden state and no card heading.
4. With `org_portal.oversight` off the viability names are not links; with `org_portal.reports` off the card links are absent and figures remain.
5. With `org_portal.insights` off the page says it isn't turned on.
6. The Insights tile on the presbytery home has no "Coming soon" pill and on a congregation's home it has one.
7. At a 360px viewport: no horizontal overflow, the viability cards (not the table) are visible, and the page scrolls to the list.

**Other cases**, each with its pin or "unverified":
- *No audit, read-only, no export.* The page and the module write nothing and record no audit event; DECISION-339 audits exports only and the `exportFunctionNames` pin stops one appearing unreviewed. Pinned: `boundaries.test.ts` › read-only, no-recordAudit.
- *A failed hub read* is a page-level load error with a retry link, never the forbidden state. Pinned: `dashboard.test.ts` › "a failed hub read is error, never forbidden"; `page.test.tsx` › "a dashboard error renders the retry link".
- *Key revoked between the hub read and a reader*: that reader answers `forbidden` and the card renders locked. Pinned: "a reader's forbidden renders that card locked".
- *Membership ends mid-request* (`OrgAccessError` from any step): to `[slug]/error.tsx`. Pinned as above.
- *The roster getter has no key of its own.* It is reached only after the hub shows a held key, inside `withOrgContext` (membership verified). A key revoked in between leaves the count visible for that one request; the count is org structure the viewer's own organization already shows. Accepted ("unverified": no test for the race).
- *The trend window hides the current year.* The card inherits the report's default (five years ending last calendar year), so a presbytery that has only entered this year's statistics sees the "no statistics" state. The card prints the window; the same limit is already tracked against the report in `docs/TODO.md` (the Phase 6 follow-up of the reports pipeline); when that is fixed, the dashboard follows because it calls `defaultTrendWindow`.
- *Per-capita billing year near New Year.* The UTC year can lead a local calendar by hours; the card shows the year it printed and links to that year. Pinned: the `2026-01-01T03:00Z` case above.
- *`now` skew*: one `now` per request feeds the window, the billing year and the vacant "today". Pinned by the same case.
- *A viability score outside 1 to 3* makes `deriveViability` throw inside the viability reader; that card errors, the rest render. Pinned: "a throwing summarizer degrades only its own card" (the test makes the viability getter reject with a `RangeError`).
- *Pool pressure*: five parallel transactions per page view. Unverified under load; accepted by the architect.
- *Tile for a presbytery member with no key*: every tile is shown whatever the role (the help says so); this one opens the forbidden state. Not a defect, named so the walk does not file it as one.
- *Insights flag on, reports flag off*: cards render with no report links. Correct; a flag is a rollout toggle. Pinned: `page.test.tsx` as above.
- *A congregation member who has not finished second-factor enrolment* is now sent to `/totp` instead of seeing the stub (the architect's deliberate tightening; the same as every gated `(org)` page).
- *Brand scope:* unchanged; `(org)` is already brandable and no emitter is added.

## Copy

Every string below goes in `copy.ts` as `DASHBOARD_COPY` (so `allCopyStrings()` and `copy.test.ts` cover it), except the help prose and the tile line, and each string that already exists is reused by name, not retyped. The `allCopyStrings` sampler gets one more argument list, `[2025, 9, 12]`. `copy.test.ts` already bans two-factor language, the phrase "don't have permission to manage" (an e2e matcher on the old reports page) and the future-tense phrases `check:help` bans; the new strings pass all three.

**Page and shared**

| Key | String |
|---|---|
| `title` (the h1; same as the tile) | Insights & Analytics |
| `subtitle(org)` | A quick look at the member congregations of {org}. The reports have the full tables. |
| `pageError` | We couldn't load Insights & Analytics. Try again in a moment. |
| `cardError` | We couldn't load this card. Try again in a moment. |
| retry | reuse `FRAME_COPY.retry`: Try again |
| locked badge and reason | reuse `HUB_COPY.lockedBadge` (Locked) and `HUB_COPY.lockedReason(phrase)` (You need permission to {phrase}. An administrator can give it under Roles.) |
| `helpLink` | Help with Insights & Analytics |
| forbidden `body` | You don't have permission to see this page. It summarizes four reports, and each needs its own permission: manage statistics, manage credentials, manage per-capita billing and manage congregation oversight. Holding any one of them opens the page. An administrator can give a permission under Roles. |
| empty `title` / `body` / `action` | No member congregations yet / Congregations appear here once they are members of this presbytery. The PresbyPortal team records membership. / Contact the PresbyPortal team (links to `/help/contact`, `HELP_CONTACT_HREF`) |
| `rosterError` (the members card, roster read failed) | We couldn't count the member congregations. Try again in a moment. |

**Member congregations card.** Title: Member congregations. Figure: the count (`formatCount`). `note(org)`: Congregations that are members of {org} today. New worshiping communities and congregations that have left or closed are not counted. No link.

**Ending active members card.** Title: Ending active members.
- `figure`: headline `formatCount(total)`; line `{year}: {reporting} of {members} reporting` (built from `TREND_COPY.reporting`); when `reporting < members`, also: Congregations that did not report a figure are not in the total. Link (reports flag on): Open the trend for {from} to {to} (`/o/<slug>/admin/reports/membership-trend?from={from}&to={to}`).
- `no_figure`: headline the dash (`TREND_COPY.dash`); line: Statistics are on file for {year} without a figure for ending active members. Same link.
- `none`: reuse `TREND_COPY.nothing.title(from, to)` (No statistics recorded for {from} to {to}), `.body` and `.action` (Record statistics, links to `/o/<slug>/admin/reports`, shown only with the reports flag on).

**Vacant pulpits card.** Title: Vacant pulpits.
- `some`: headline `VACANT_COPY.count(vacant, total)` (3 vacant of 12 congregations); line `VACANT_COPY.note1` (Based on the appointments recorded on Credentials. A congregation with no appointment recorded appears here.). Link (reports flag on): Open vacant pulpits.
- `none_vacant`: `VACANT_COPY.noneVacant.title` and `.body` (No vacant pulpits. Every congregation has an installed or designated pastor on record today.). Same link.
- `not_recorded`: `VACANT_COPY.zeroAppointments.title`, `.body` and `.action` (No pastoral appointments are recorded yet. So vacancies can't be worked out. Record appointments on Credentials. Open Credentials, links to `/o/<slug>/admin/credentials`, shown only with the credentials flag on).

**Per capita card.** Title `Per capita, {year}`.
- `figure`: headline `formatDollars(billed)`; lines `Billed`, `Paid {formatDollars(paid)}`, `Still owed {formatDollars(outstanding)}` (a negative reads "$12.00 credit" through `formatDollars`, as in the report), `{n} of {m} congregations billed` (singular "congregation" when m is 1); when `departedBilled > 0`: Includes {k} congregation(s) that is/are no longer a member/members. Link (reports flag on): Open per capita for {year} (`/o/<slug>/admin/reports/per-capita?billingYear={year}`).
- `none`, no rate (`rateSet` false): title `PER_CAPITA_COPY.empty.title(year)` (No per-capita bills for {year}); body: No rate is set for {year}. Set one and generate the bills in the Per-Capita section of Per-Capita, SASR & Imports.
- `none`, rate set: same title; body: A rate is set for {year}. Generate the bills in the Per-Capita section of Per-Capita, SASR & Imports.
- Action for both (reports flag on): `PER_CAPITA_COPY.empty.action` (Open Per-Capita, SASR & Imports, links to `/o/<slug>/admin/reports?billingYear={year}`).

**Viability section.** Heading `VIABILITY_COPY.title` (Viability); sub `HUB_COPY.cards.viability.description(org)` (How {org} rates each congregation, from at risk to healthy.); column heads `VIABILITY_COPY.columns.congregation` and `.viability`; rows show the name (a link to `/o/<slug>/admin/oversight/<id>` with the oversight flag on, text otherwise) and the badge text (At risk, Fair, Healthy or Not yet assessed, from `VIABILITY_LABELS` and `VIABILITY_NOT_ASSESSED`). When any row is not assessed: `VIABILITY_COPY.assessNote` (Assess a congregation on Congregation Oversight.) plus `VIABILITY_COPY.assessLink` (Open Congregation Oversight, with the oversight flag on). With the reports flag on: Open the viability report (`/o/<slug>/admin/reports/viability`). Locked: the locked badge and reason. Error: We couldn't load the viability list. Try again in a moment. with a Try again link.

**Tile.** No string changes: the label and the description ("Dashboards, trends, and per-capita/membership insights.") stay. For a presbytery the description is true (a dashboard, a trend, per-capita and membership figures). For every other type it still reads as roadmap text beneath the "Coming soon" pill. It names no permission and gives no instruction (the existing `tiles.test.ts` pattern for live tiles).

**Non-presbytery states, unchanged:** `ComingSoon` with the existing description string and `PlaceholderFlagOff` ("Insights & Analytics isn't turned on for {org} yet.").

**The four checks, one line per string group**

1. *Residuals.* Nothing here denies an accepted residual or a Phase 2 ruling. The dashboard touches none of the accepted residuals in CLAUDE.md (the revoke-then-designate chain, the email-edit chain, the self-recorded Session approver, the wildcard exceptions). The forbidden string does not claim a role "can't" see data, only that this page needs one of four permissions. Pinned: `copy.test.ts` (no two-factor claim, no future-tense phrase).
2. *Source of truth.* **Members note and count:** `readRoster` (`parent_id` = this presbytery, type `congregation`, `lifecycle_status = 'active'`); the exclusions named (new worshiping communities, left or closed) are exactly its filters. **Ending active members:** `footer.total`, `reporting`, `members` from `deriveMembershipTrend` over `fetchStatisticsForYears`; "reporting" means a coalesced row with a non-null `ending_active`; a year with rows but no figure reads `no_figure`, because the query reads rows, so the card says "on file", never "none". **Vacant:** `appointmentsRecorded` (any appointment whose serving organization is on the current roster) and the in-force rule; "No pastoral appointments are recorded yet" is the report's own string and means exactly that read (an appointment serving a congregation that is not on the roster does not count), and the caveat that an unrecorded congregation appears vacant is shown whenever a count is. **Per capita:** `per_capita_records` totals in integer cents and `per_capita_rates` for "a rate is set"; "no rate is set" is a missing `per_capita_rates` row for the year; the card does not claim why no congregation was billed. "No longer a member" is the report's own `membership === "departed"`. **Viability:** `congregation_oversight.viability_score`; "Not yet assessed" is a null score. **Empty state:** "the PresbyPortal team records membership" rests on the only membership writer being `/admin/organizations/<id>` (`affiliation-section.tsx`), a platform surface; if a presbytery-side writer ships, the string must change. **Forbidden:** names the four `permissionPhrase` values from `REPORTS`, pinned equal by `copy.test.ts`.
3. *Audience.* **Locked reason and forbidden body ("An administrator can give it under Roles")**: seen by presbytery staff holding a subset of the four keys, or none. The hub already makes this promise to the same audience, and an administrator with `roles.manage` can do it. **"Record statistics", "Open Credentials", "Open Per-Capita, SASR & Imports"**: shown only on a card the viewer holds the key for (`statistics.manage`, `credentials.manage`, `per_capita.manage`), and each target page checks that same key. **"Contact the PresbyPortal team"**: shown to any presbytery member with at least one key; the contact page is public. **Retry link:** any viewer. **Viability and oversight links:** shown only to a holder of `congregation_oversight.manage`, the key the oversight page needs.
4. *Neighbours.* Grepped for insights, coming soon, dashboard, vacant, per capita and viability. Made stale and modified: `scripts/seed.ts:646-647` (the `org_portal.insights` description says the presbytery branch is unbuilt); `src/app/(org)/o/[slug]/admin/insights/page.tsx:11` and the header comment at `:14-27` (the stub's description survives only for non-presbytery types; the comment is rewritten); `src/lib/help/coverage-allowlist.ts:30` (the `tile:insights` entry, "A coming-soon stub", is no longer true for a presbytery and is removed, with the pin at `coverage.test.ts:39` lowered to 13 and the key dropped from the list at `coverage.test.ts:202`); `src/lib/org-portal/tiles.ts:602-610` (the tile gains `liveFor`). Checked and still true, no edit: `src/content/help/first-day-as-administrator.md:13` (a congregation founding administrator's tile list: "Insights & Analytics" is still an idea page for a congregation; Phase 6 re-reads it as that reader), `src/content/help/presbytery-reports.md:5` (the reports hub path is unchanged), `src/content/help/presbytery-reports.md` "If a report is locked or missing" (about the reports flag, not the insights flag; the new section carries its own), the `presbytery-tools` planned page's `today` line (still true: four reports; it lists no tile), `docs/TODO.md:29` ("four routes are inert placeholders", history, not a user string).

## Help impact

- **`presbytery-reports` (edit, published).** Add a section after "Open the reports", headed "Insights and analytics" (anchor `insights-and-analytics`; the implementer confirms the slug against `src/lib/help/headings.ts` and the registry `anchors`). Draft prose, in the page's voice:

  > On your presbytery's home page, choose "Insights & Analytics" under "Reports & Insights". The page is a summary of your member congregations. It is read-only: nothing on it can be changed, and it has no download.
  >
  > Each card comes from one report and needs that report's permission. A card you cannot open says "Locked" and what it needs. If you have none of the four permissions, the page says you don't have permission and names them. An administrator can give a permission under "Roles". See [Roles: who can do what](/help/roles-who-can-do-what).
  >
  > | Card | What it shows | Permission you need |
  > |---|---|---|
  > | "Member congregations" | How many congregations are members of your presbytery today | Any one of the four permissions in this table |
  > | "Ending active members" | The total for the newest of the five years ending last year that has statistics, and how many congregations reported | Manage statistics |
  > | "Vacant pulpits" | How many congregations have no installed or designated pastor today | Manage credentials |
  > | "Per capita" | What was billed, paid and still owed for this year | Manage per-capita billing |
  > | "Viability" | Every member congregation with the rating the presbytery recorded, at risk first | Manage congregation oversight |
  >
  > Each card says which year it shows. When nothing is recorded, the card says so in words and does not show a zero. "Ending active members" says how many congregations reported, and its total leaves out any that did not report a figure. "Vacant pulpits" has the same limit as the report: a congregation whose appointment was never recorded counts as vacant. "Per capita" shows the current year's totals, which include a congregation that has left but still has a bill.
  >
  > A card opens its report only where the reports are turned on, and a congregation's name opens its page on "Congregation Oversight" only where that is turned on. Otherwise the figure or name shows without a link. A card that says "We couldn't load this card" has a "Try again" link; the other cards are not affected.
  >
  > If the page says Insights & Analytics "isn't turned on" for your presbytery, the PresbyPortal team switches it on for the whole platform. [Contact the team](/help/contact) if you need it.

  Registry entry: `covers` gains `"tile:insights"`; `anchors` gains `"insights-and-analytics"`; `labels` gain `"Insights & Analytics"`, `"Member congregations"`, `"Ending active members"` and `"Try again"` (all on screen; `check:help` verifies); the `summary` gains "and a summary page"; `verifiedIn` is set to the release this ships in, after the page is walked at 360px as the clerk and the no-grant user, and not before. A test in `help-page.test.ts` pins that the new section names the same four permissions as `REPORTS`' phrases and that it says the page is read-only. The page deliberately says nothing of default role bindings: the founding-administrator bundle holds only the oversight key, and which role a presbytery's clerk holds is not verified on screen here.
- **`roles-who-can-do-what` (no edit).** It documents a congregation's roles and has no per-permission table; none of the four keys appears on it (grepped). The permission-to-card table lives on `presbytery-reports`, linked from there.
- **`presbytery-tools` (no edit).** A planned placeholder about committees and commissions; its `today` line ("read four reports from them") stays true and it lists no tile.
- **`turning-features-on-and-off` (checked at Phase 5):** it must still say Insights is platform-managed and not a per-congregation toggle; `org_portal.insights` is a global flag and gets no per-congregation toggle here.
- **`coverage-allowlist.ts`:** `tile:insights` leaves the allowlist because `presbytery-reports` now covers it.
- **Coordinate entry, the tile provider and `privacy-policy`:** deferred to the map increment.
- **Rule 17 pipeline:** the page is edited as `published` in the same PR (no `pending` token, no `limitationUntil`). The implementer writes the section from the screens, not from this draft; where the screen differs, the screen wins and Phase 5 reads the diff.

## Implementer

**full-stack-developer.** No schema work; the server composition, the page and the components are small and tightly coupled, so splitting them across api-developer and ux-developer adds a handoff for no gain. Worktree `../presby-dashboard`, Neon branch `pipeline/presbytery-dashboard` (`br-polished-recipe-ax432cko`), dev port **3101** (`E2E_BASE_URL=http://localhost:3101`; never 3000; stop a server by PID, never `pkill -f next`). Migration numbers: none used. `DECISION-342` is assigned and written; F450+ are free for findings. Shared hand-edited files (`docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`, `scripts/seed-dev.sql`, `scripts/test-rls.sql`, `e2e/support/*`) are not edited by the implementer except `scripts/seed.ts` (flag description, named above) and the new `e2e/presbytery-dashboard.spec.ts`; the orchestrator integrates the TODO line.

**Feasibility check against the live tree (done at design time).** (1) No SQL is added, so no signature-default ordering applies. (2) No `ALTER` or `DROP`. (3) No CHECK, trigger or fixture is added. (4) No foreign key. (5) `REPORTS_FLAG` is a `const` string, so `typeof REPORTS_FLAG | typeof INSIGHTS_FLAG` is a literal union under `tsc`. (6) `visiblePortalTiles` returns `PortalTile[]`; `{ ...tile, comingSoon: false }` keeps the intersection type. (7) `PORTAL_TILES` is typed `readonly PortalTile[]` with `] as const`, so a new optional field is accepted. (8) `copy.ts` must stay import-free (its header says so), so `formatCount` and the new strings use no import; `dashboard-derive.ts` imports only types. (9) `boundaries.test.ts` `noForbiddenReads` scans strings: none of the new copy contains "from people" or "join memberships". (10) The map increment's design is not re-checked here; it re-runs this check against the live tree when it starts (other pipelines will have merged by then).

---

**Orchestrator rulings on Phase 3's three confirm items (2026-11-16):** accepted as designed. The roster empty state links to the contact form. The per-capita "none" state names only whether a rate is set. The trend card uses the newest year with any statistics row.

## Phase 3 amendment 1 (QA run 1 loop-back)

*2026-11-16. Phase 5 run 1 returned FAIL on F-A and F-B and one advisory. This amendment supersedes the Phase 3 Copy rows it names; everything else in Phase 3 stands. Implementer: full-stack-developer, same worktree and port. No schema, key, flag, route or dependency is added.*

### 1. Ruling on F-B: each instruction sentence follows its link's flag

**Ruling.** Adopted as the coordinator leans: an instruction that names a target page is shown only when that target's flag is on, by the same boolean that shows its link. Where the sentence also carries a fact the viewer needs, the fact stays as a short neutral sentence with no instruction. Rejected: accepting a residual (the page would tell a key holder to use a section that renders only "isn't turned on", and the surrounding code already has the flag in hand) and rewording alone (a reworded instruction still points at a dead page). `org_portal.insights` is ON in production, so this is reachable. The same class of defect was found in one more place QA did not list, the viability list's "Assess a congregation on Congregation Oversight." (`dashboard-viability.tsx:76`, its link already gated on `oversightOn`); it is fixed here by the same rule.

| Where | Flag | Flag on (unchanged) | Flag off (new) |
|---|---|---|---|
| Trend card, `none` (`dashboard-cards.tsx:88`) | `reportsOn` | `TREND_COPY.nothing.title`, then `TREND_COPY.nothing.body` (Enter statistics for a congregation and year in the Congregation Statistics section.), then the "Record statistics" link | `TREND_COPY.nothing.title` only (No statistics recorded for {from} to {to}). The body is not rendered. No new string. |
| Vacant card, `not_recorded` (`:134`) | `credentialsOn` | `VACANT_COPY.zeroAppointments.body` (So vacancies can't be worked out. Record appointments on Credentials.), then the "Open Credentials" link | New `DASHBOARD_COPY.vacant.notRecordedNoLink`: **So vacancies can't be worked out.** |
| Per capita card, `none`, no rate (`:171`) | `reportsOn` | `DASHBOARD_COPY.perCapita.noRate(year)` (No rate is set for {year}. Set one and generate the bills in the Per-Capita section of Per-Capita, SASR & Imports.) | New `DASHBOARD_COPY.perCapita.noRatePlain(year)`: **No rate is set for {year}.** |
| Per capita card, `none`, rate set (`:171`) | `reportsOn` | `DASHBOARD_COPY.perCapita.rateSet(year)` (A rate is set for {year}. Generate the bills in the Per-Capita section of Per-Capita, SASR & Imports.) | New `DASHBOARD_COPY.perCapita.rateSetPlain(year)`: **A rate is set for {year}. The bills have not been generated.** |
| Viability list, any row not assessed (`dashboard-viability.tsx:76`) | `oversightOn` | `VIABILITY_COPY.assessNote` (Assess a congregation on Congregation Oversight.) and its link | Neither is rendered; the "Not yet assessed" badges still show. No new string. |

The four new strings join `DASHBOARD_COPY`, so `allCopyStrings()` covers them. The `report` pages' own strings (`VACANT_COPY.zeroAppointments`, `TREND_COPY.nothing`, `PER_CAPITA_COPY.empty`) are not changed; they sit on pages that are reachable only with the reports flag on.

**Four checks on the new strings.** (1) *Residuals:* none denies one; the neutral sentences are statements. (2) *Source of truth:* "No rate is set" is a missing `per_capita_rates` row for the year (`rateBasisYear === null`); "A rate is set ... The bills have not been generated" is a rate row and no billed row (`PerCapitaSummary.none`, which `summarizePerCapita` returns when no row is billed; `derivePerCapita` adds `not_billed` rows only when at least one record exists, so the two never coexist); "So vacancies can't be worked out" is `appointmentsRecorded === false`, the report's own claim. (3) *Audience:* the neutral sentences give no instruction, so there is nothing for any role to be unable to do; the full instructions remain visible only to a holder of that card's key and only where the target page renders. (4) *Neighbours:* grepped `Credentials`, `Per-Capita section`, `Congregation Statistics`, `Congregation Oversight` and `Record appointments` in `src/components/presbytery-reports/` and `src/lib/presbytery-reports/copy.ts`: the only dashboard-reachable instruction sentences are the five rows above. The 0.57.0 vacant-pulpits report view still shows "Open Credentials" with no flag check (`vacant-pulpits-view.tsx:39`); that is pre-existing, outside this pipeline, and recorded as a TODO line below.

**Pins** (all in `dashboard-views.test.tsx` unless named):
- "with the reports flag off the trend and per-capita instruction sentences are absent and the neutral sentence shows" (asserts `queryByText(/Congregation Statistics section/)` and `queryByText(/Per-Capita section/)` are null, the `noRatePlain` / `rateSetPlain` text is present, and no link renders).
- "with the credentials flag off the vacant card says only that vacancies cannot be worked out" (`queryByText(/Record appointments on Credentials/)` null).
- "with the oversight flag off the viability list has no assess sentence" (`queryByText(/Assess a congregation/)` null even when a row is not assessed).
- "with each flag on the full instruction and its link render" (the three existing flag-on cases, tightened to assert the sentence as well as the link).
- `copy.test.ts` › "the plain dashboard strings name no section and give no instruction" (`noRatePlain`, `rateSetPlain`, `notRecordedNoLink` match none of `/Credentials|Per-Capita section|Congregation Statistics|Oversight|Open |Set one|Record|Generate the/`).

**TODO line** (for `docs/TODO.md` at integration, Papercuts): `- [ ] **Presbytery vacant-pulpits report: "Open Credentials" shows with the credentials flag off.** vacant-pulpits-view.tsx:39 links to /admin/credentials, which renders only "isn't turned on" while org_portal.credentials is off. Gate the link and the "Record appointments on Credentials." sentence on the flag, as the dashboard now does. — docs/work-log/2026-11-17-presbytery-dashboard.md Phase 3 amendment 1`

### 2. F-A: the replacement sentence for `src/content/help/presbytery-reports.md:30`

Replace exactly "Each card says which year it shows." with:

> The "Ending active members" and "Per capita" cards name the year they show. "Member congregations", "Vacant pulpits" and "Viability" show how things stand today.

Every other sentence in that paragraph stays. Source of truth: the trend card prints `{year}: N of M reporting` (or the window in its none state), the per-capita card's heading is "Per capita, {year}", and the other three print no year and read current state (roster today, appointments in force today, the recorded rating). Audience: any presbytery staff reader; no instruction. Pin: `help-page.test.ts` › "names the year on the trend and per-capita cards only" asserts the section contains that exact sentence and does not contain "Each card says which year it shows". Phase 5 re-walks the page at 360px.

### 3. The advisory: fixed in this loop

Yes. When the roster read fails, the "Member congregations" card keeps its message (`DASHBOARD_COPY.members.error`, We couldn't count the member congregations. Try again in a moment.) and gains the same "Try again" link the other card errors have, to the page's own path: `MembersCard` takes `retryHref` and renders `CardError` with `message={DASHBOARD_COPY.members.error}`, which also gives it the `role="alert"` the other errors carry. No new string. Pin: `dashboard-views.test.tsx` › "a failed roster read renders the members card as an error with a retry link and never the empty state" (the existing roster-error case, extended to assert `getByRole("link", { name: "Try again" })` has `href` equal to the retry path).

### Re-run scope for QA

Copy truthfulness (the six strings above and the help sentence), `help-page.test.ts`, `dashboard-views.test.tsx`, `copy.test.ts`, `npm run check:help`, and the 360px walk of `/help/presbytery-reports`. Run the dashboard once with `org_portal.reports`, `org_portal.credentials` and `org_portal.oversight` off as the clerk, to read the neutral states on screen. The rest of run 1 stands.

---

# Phase 4 — Implementation

*full-stack-developer, 2026-11-16. Slice one only: no map, no leaflet, no dependency, no migration.*

## Files Created

- `src/lib/presbytery-reports/dashboard-derive.ts` (+ `.test.ts`, 15 tests) — pure summaries: `summarizeTrend`, `summarizeVacant`, `summarizePerCapita`, `toViabilityList`.
- `src/lib/presbytery-reports/dashboard.ts` (+ `.test.ts`, 13 tests) — `getPresbyteryDashboard` (hub first, `forbidden` before any read, one transaction per held reader plus the roster, `Promise.allSettled`, `OrgAccessError` rethrown) and `getRosterCount`.
- `src/components/presbytery-reports/dashboard-cards.tsx`, `dashboard-states.tsx`, `dashboard-viability.tsx` (+ `dashboard-views.test.tsx`, 29 tests) — Server Components only.
- `e2e/presbytery-dashboard.spec.ts` — 7 cases from the design.

## Files Modified

- `src/lib/presbytery-reports/contract.ts` — `INSIGHTS_FLAG`, `OVERSIGHT_FLAG`, `CREDENTIALS_FLAG`.
- `src/lib/presbytery-reports/gate.ts` — private `gatePresbyteryPage` (closed flag union, no default); `gateReportPage` unchanged in signature and behaviour; new `gateInsightsPage`. `gateReportRoute` untouched. `gate.test.ts` +7 cases.
- `src/lib/presbytery-reports/params.ts` — `defaultBillingYear(now)` (+ tests), so the page and `dashboard.ts` print the same year.
- `src/lib/presbytery-reports/copy.ts` — `DASHBOARD_COPY`, `formatCount`, sampler argument list `[2025, 9, 12]`; `copy.test.ts` +6.
- `src/lib/presbytery-reports/boundaries.test.ts` — insights directory scan (no owner connection, read-only, no recordAudit, no redirect target, strict params, no `use client`), `insights-calls-its-gate` with a failing sample each way, `no-dangerous-html`, no `loading.tsx` under `admin/insights/**`, export-name pin extended to the new files.
- `src/lib/org-portal/tiles.ts` — `liveFor` on `PortalTileBase`, `liveFor: ["presbytery"]` on `insights`; `visible-tiles.ts` — `resolveComingSoon` (the only place `liveFor` is read; returns a copy, otherwise the same object). `tiles.test.ts` +3, `visible-tiles.test.ts` +3.
- `src/app/(org)/o/[slug]/admin/insights/page.tsx` — rewritten around `gateInsightsPage`; `page.test.tsx` rewritten (19 tests, incl. the stale-second-factor redirect for every type).
- `src/components/presbytery-reports/viability-view.tsx` — `ViabilityBadge` exported (prop narrowed to `score` and `label`).
- Help: `src/content/help/presbytery-reports.md` (new "Insights and analytics" section), `src/lib/help/registry.ts` (`covers` +`tile:insights`, anchor, 4 labels, summary, `verifiedIn` 0.58.0), `coverage-allowlist.ts` (`tile:insights` removed), `coverage.test.ts` (pin 14 to 13), `src/lib/presbytery-reports/help-page.test.ts` (+1).
- `scripts/seed.ts` — the `org_portal.insights` flag description.
- Not touched, per instructions: `docs/TODO.md`, `docs/STATE.md`, `docs/reviews/log.md`, `docs/decisions.md` (the orchestrator's uncommitted edit stays uncommitted).

## Schema Changes

- None. No migration, no permission key, no flag row, no dependency, no route, no server action, no definer function.

## Audit Events

- None. Read-only, no export (DECISION-339 audits exports only). Pinned by `boundaries.test.ts` (read-only, no recordAudit, the four-name `export*` pin).

## Gates

- `npm run typecheck` pass. `npm run lint` pass (0 warnings). `npm run check` pass (all ten tripwires; `check:help`: 33 entries, 29 published).
- Vitest, `--no-file-parallelism`, with `.env.local` so the DB-backed suites ran: `src/lib/presbytery-reports`, `src/lib/org-portal`, `src/lib/help`, `src/components`, `src/app/(org)/o/[slug]/admin`: **345 files, 4,822 tests, all passed**.
- Playwright on its own dev server, port 3101 (`E2E_BASE_URL=http://localhost:3101`, started by me and stopped by PID; the test-only env of `playwright.config.ts` set on it; `E2E_ALLOW_SHARED_DB=true` because `.env.local` points at the pipeline's own Neon branch): `e2e/presbytery-dashboard.spec.ts` **7 of 7 passed**.

## Browser check

- `presbytery-clerk` at 360px and 1280px, `org-multi` at both, `presbytery-nogrant` at 360px: screenshots read, **no horizontal overflow (scrollWidth minus clientWidth = 0) in any of the six views**, cards single-column at 360px and two-up at 1280px, the viability list is cards at 360px and a table at 1280px.
- Also walked with staged figures (then removed): "1,354", "2025: 2 of 3 reporting" with the did-not-report note, "2 vacant of 3 congregations" with the caveat, "$33,850.00 / Paid $1,000.00 / Still owed $32,850.00 / 2 of 3 congregations billed", at-risk badge first. Staged rows (statistics, per-capita rate and records, oversight, one appointment) were deleted and counts re-checked at zero on the pipeline's Neon branch.
- **The Insights tile is on the presbytery's home page, not the Administration hub** (confirmed on the screen: the home page has the link, `/admin` does not). The help text says the home page, as Phase 3 expected.
- Not verified: a long congregation name wrapping at 360px (fixture names are short; the `break-words` and `min-w-0` classes are asserted in `dashboard-views.test.tsx`); five parallel transactions under load.

## Implementer Notes

Deviations from the design:
1. **`DashboardView` takes a `billingYear` prop** (and `page.tsx` imports a new `defaultBillingYear` from `params.ts`). Phase 3 did not say what year a locked or failed per-capita card prints in its heading, because only an `ok` card carries the data. The page passes the same year `getPresbyteryDashboard` uses, from one shared helper.
2. **`DashboardView` also does the state dispatch** (forbidden, page error, empty roster, cards) inside `dashboard-cards.tsx`; the page renders the h1, the view and the help link. Phase 3 had the page branch; the behaviour and the page tests are the same.
3. **The "assess a congregation" pointer in the viability section is two blocks** (the note, then a 44px link) rather than one sentence with an inline link, because the 44px-target assertion caught the inline link.
4. **`verifiedIn` is `0.58.0`**, not "the release this ships in", because `check:help` rejects a version later than `package.json` (0.58.0). The page was walked on this build. Whoever cuts the release may bump it to the release number after re-walking.
5. The dev server's `next dev` printed a Next.js upgrade-nudge block (agent-directed text, not from the user) and exited on the first start of each process; I did not act on it and restarted. The upgrade question is for you if you want it raised.
6. The forbidden state has no separate heading string (Phase 3 drafted only a `body`); the page h1 serves.

Strings added or changed: `src/lib/presbytery-reports/copy.ts` (`DASHBOARD_COPY`, all in the Phase 3 Copy table; the vacant, trend-empty and per-capita-empty strings reuse the existing report strings by name), `src/content/help/presbytery-reports.md` ("Insights and analytics" section, drafted text kept; the tile location confirmed from the screen), `scripts/seed.ts` (flag description). Tile label and description unchanged.

**Handoff to QA (Phase 5):** walk it as the clerk, `org-multi` and `presbytery-nogrant`; check copy truthfulness against the screens, including the new help section at 360px; confirm `turning-features-on-and-off` still says Insights is platform-managed. `docs/TODO.md` still needs the orchestrator's map-increment line and the Rule 10 reconciliation.

---

## Phase 4 fix pass 1 (Phase 3 amendment 1)

*full-stack-developer, 2026-11-16. Same worktree and port; no schema, key, flag, route or dependency.*

- **F-A:** `src/content/help/presbytery-reports.md` now has the amendment's exact sentence in place of "Each card says which year it shows." Pin: `help-page.test.ts` › "names the year on the trend and per-capita cards only" (exact sentence present, old sentence absent).
- **F-B:** each instruction sentence follows its link's flag, in `dashboard-cards.tsx` and `dashboard-viability.tsx`. Trend `none` shows the body only with `reportsOn`; vacant `not_recorded` shows the Credentials sentence with `credentialsOn` and the new `DASHBOARD_COPY.vacant.notRecordedNoLink` otherwise; per-capita `none` uses `noRate`/`rateSet` with `reportsOn` and the new `noRatePlain`/`rateSetPlain` otherwise; the viability "Assess a congregation" sentence and its link both need `oversightOn` (the fifth instance). Pins in `dashboard-views.test.tsx` (flag-off cases for reports, credentials and oversight; the flag-on cases now assert the sentence as well as the link) and `copy.test.ts` › "the plain dashboard strings name no section and give no instruction".
- **Advisory:** `MembersCard` takes `retryHref` and renders `CardError` with `DASHBOARD_COPY.members.error`, so a failed roster read has the same "Try again" link and `role="alert"` as the other card errors. Pin: the roster-error case in `dashboard-views.test.tsx` now asserts the link and its href.
- **Gates:** `npm run typecheck`, `npm run lint`, `npm run check` (all ten) pass. Vitest `--no-file-parallelism` with `.env.local` over `src/lib/presbytery-reports`, `src/lib/org-portal`, `src/lib/help`, `src/components` and `src/app/(org)/o/[slug]/admin`: 345 files, 4,828 tests, all passed.
- **Browser, 360px, own server on port 3101:** as `presbytery-clerk` with `org_portal.reports`, `org_portal.credentials` and `org_portal.oversight` off, no horizontal overflow; the trend card shows only "No statistics recorded for 2021 to 2025", the vacant card "No pastoral appointments are recorded yet" and "So vacancies can't be worked out.", the per-capita card "No rate is set for 2026.", the viability list shows plain names and "Not yet assessed" badges with no assess sentence, and no card has a link. Flags restored by `captureFlags` (verified by SELECT to the values they had before), server stopped by PID, 3101 free.

---

# Phase 5 — Verification (qa)

*Run 1, recorded verbatim from QA's return, 2026-11-16.*

**Date:** 2026-11-16
**Verified by:** qa
**Commit verified:** `3805b84c` on `pipeline/presbytery-dashboard` (`/Users/cshenso/git/presby-platform/presby-dashboard`)

**What I ran, and what I didn't:**
- **Run in full:** typecheck, lint, `npm run check` and the unit suite.
- **Database-backed suites:** I ran these for the changed and nearby folders only: `src/lib/presbytery-reports`, `src/lib/org-portal`, `src/lib/help`, `src/components/presbytery-reports`, `admin/insights` and `admin/reports`. I did not run the whole database-backed set, because the diff touches no migration, `authz.ts`, `src/lib/db/` or shared fixture.
- **e2e:** the new spec, plus three specs near the change: `presbytery-reports`, `presbytery-report-exports` and `portal-footer-sitemap`. I did not run the full chromium suite. The diff touches no proxy, auth, layout, `e2e/support`, Playwright config or shared component, so the PR's CI run covers the rest.
- **Not run:** `test-rls.sql` (no schema change) and the production-build lane (no form added).
- **Before the e2e run** I reset the global flags to the CI baseline with `scripts/ci/e2e-reset-flags.sql` (38 flags set to their seed values). I first confirmed that the database host differs from the main checkout's, without printing either value. I ran the reset again after my walk.
- **Dev server:** my own, port 3101, PID 70272, stopped by that PID. The first start exited after printing a Next.js upgrade notice addressed to agents; I ignored it and restarted.
- **Disk:** 550 GiB free.

## Type Check
`npm run typecheck`: PASS
`npm run lint`: PASS (0 warnings)
`npm run check`: PASS, all ten tripwires. `check:help` reports 33 registry entries, 29 published.

## Unit Tests
- **Full suite:** 893 of 1,049 test files passed and 156 were skipped; 14,454 tests passed and 4,158 were skipped; 40.1s. The skipped files are the database-backed ones, which skip without `.env.local`.
- **Database-backed run** (`dotenv -e .env.local -- vitest run --no-file-parallelism` over the folders above): 59 of 59 files, 1,052 of 1,052 tests, **0 skipped**, 80.2s. This includes `readers.db.test.ts`, which checks every reader the dashboard uses against the real columns. `dashboard.ts` adds no SQL of its own.

Failures: none.

## End-to-End Tests
- `e2e/presbytery-dashboard.spec.ts` with `E2E_BASE_URL=http://localhost:3101`: 7 of 7 passed, 19.8s, 0 skipped. Its 360px case passed.
- The three nearby specs, desktop only: 25 of 25 passed, 1.3m, 0 skipped.
- The spec's staged appointment is gone afterwards (0 rows left).

Failures: none.

## Regression Tests Added
This is a feature, so fail-before-fix does not apply. Each item the design carried has a test:

**Phase 1 gaps**
- **G2, no keyless peek:** `src/lib/presbytery-reports/dashboard.test.ts:69`
- **G3, no misleading zeros:**
  - `dashboard-derive.test.ts:33, :49, :59, :80, :90, :116, :123`
  - `dashboard-views.test.tsx:147, :176, :195, :216`
- **G4, explicit years:** `dashboard.test.ts:186, :193`; `dashboard-views.test.tsx:241`; `params.test.ts` (`defaultBillingYear`)
- **G6, the tile's per-type "Coming soon":**
  - `tiles.test.ts:481, :488, :497`
  - `visible-tiles.test.ts:593, :602, :612`
  - e2e `:155`
- **G8, 360px:** `dashboard-views.test.tsx:314, :322, :333`; e2e `:173`
- **G9, cards fail independently:** `dashboard.test.ts:114, :125, :143`
- **G10, second-factor redirect for every org type:** `gate.test.ts:161`; `page.test.tsx:124`
- **G11, no audit or export:** `boundaries.test.ts:280`, plus the export-name pin at `:299`

**Phase 1 flows and adversarial pass**
- **One forbidden state:** `dashboard-views.test.tsx:80`; `copy.test.ts:60`; `page.test.tsx:286`; e2e `:108`
- **Card error with retry:** `dashboard-views.test.tsx:110`
- **Empty roster and failed roster read:** `dashboard-views.test.tsx:96, :103`; `page.test.tsx:301, :308`
- **Viability list:** `dashboard-derive.test.ts:156`; `dashboard-views.test.tsx:283, :299`
- **Links only where the target's flag is on:**
  - `dashboard-views.test.tsx:254, :265, :274, :291`
  - `page.test.tsx:262, :271`
  - e2e `:120`
- **Gate split:** `gate.test.ts:132, :139, :145, :153`
- **Stored XSS through congregation names:** `boundaries.test.ts:289, :344`; `dashboard-views.test.tsx:340`
- **No redevelopment notes on the page:** `dashboard-derive.test.ts:171`; `dashboard-views.test.tsx:358`

**Phase 2 notes**
- **Note 1, `boundaries.test.ts`:**
  - insights directory scans `:274–286`
  - insights page must call its own gate `:335`, with a failing sample each way
  - no `loading.tsx` under insights `:293`
- **Note 2:** the `gate.test.ts` cases above.
- **Note 3, a rejected reader degrades only its card:** `dashboard.test.ts:114`
- **Note 4, roster empty vs error:** as above.
- **`OrgAccessError` is rethrown, never a card error:** `dashboard.test.ts:170`; `page.test.tsx:168`
- **A reader's own "forbidden" shows as locked:** `dashboard.test.ts:106`

**Not tested (all accepted at design):** a long congregation name wrapping at 360px (only the CSS classes are asserted), five parallel transactions under load, and the key-revocation race on the roster count.

## Coverage on Critical Modules
- `src/lib/permissions.ts`: 100%
- `src/lib/two-factor.ts`: 91.11% statements (target 90%+)
- `src/lib/flags.ts`: 100%
- New code:
  - `dashboard-derive.ts`: 100%
  - `visible-tiles.ts`: 100%
  - `dashboard.ts`: 100% statements, 91.3% branches (lines 94–95)

## Feature-Gate Audit
No `route.ts` and no server action were added or changed. I read the page's gate and how each card reads its data:

| Route or action | `auth()` present? | Permission check present? | Correct key or flag? |
|---|---|---|---|
| GET `/o/[slug]/admin/insights` (page.tsx:50 → `gateInsightsPage`) | yes: `cachedAuth` and `assertOrgSession`, then the four-way miss and `assertOrgAccess` (gate.ts:83–106) | Tenant axis, not `hasFeature`. Each card's key is checked live inside its own reader's transaction; the hub read only sequences the work (dashboard.ts:76–103). | Flag `org_portal.insights` only (gate.ts:79, :109). `org_portal.reports` is never used as a gate; the page reads it at :68 only to choose link or plain text. |

- **Per-card keys:** a key not held shows as locked and its reader is never called (dashboard.ts:89–98). On screen, `org-multi` saw one live card and three locked; `presbytery-nogrant` saw the single forbidden state.
- **A congregation:** sees `ComingSoon` with flag on (page.test.tsx:214, and my walk as `org-single`). With flag off it sees `PlaceholderFlagOff` (page.test.tsx:204; flag is checked before type).
- **`liveFor`:** read only at `visible-tiles.ts:95`. No consumer reads `comingSoon` from the raw registry.
- **No `getPlatformDb` and no `loading.tsx`** under `admin/insights`, `admin` or `[slug]`.
- **Schema/RLS audit:** not applicable (no schema change).
- **Auth-touching gate:** not triggered; the diff touches none of `src/auth.ts`, `(auth)`, `api/auth` or `src/lib/auth`.

## Copy Truthfulness
- [x] **Every added or changed string is in the design's Copy table.** That covers every `DASHBOARD_COPY` string. The other strings are reused by name. The seed description is operator-facing and was named in the design.
- [x] **Each claim traced to its query:**
  - "No rate is set for {year}" means no `per_capita_rates` row for that billing year. `basis_year` is NOT NULL in the live catalog, so a null `rateBasisYear` means exactly that.
  - The members note's exclusions are exactly `readRoster`'s filters.
  - "Not yet assessed" means a null score.
- [ ] **Each instruction is doable by the role that sees it.** Fails in flag-off states. **Finding F-B below.**
- [x] **Older strings checked.**
  - `first-day-as-administrator.md:13` is addressed to a congregation, so it is still true.
  - `why-cant-i-see-this.md:60` ("A few tiles…") is still true.
  - The `ComingSoon` description is still true for the type that sees it.
  - **`turning-features-on-and-off` never mentions Insights,** here or on main, so the premise "still says Insights is platform-managed" does not hold. It also does not list Insights as a per-congregation toggle, which is the property that matters. The new section at `presbytery-reports.md:34` now says the PresbyPortal team switches it on.
- [ ] **Help diff:**
  - All four `labels` strings are in the UI. "Try again" shows only in error states; I confirmed it through the render test at `dashboard-views.test.tsx:110`, not on screen.
  - I walked `/help/presbytery-reports` at 360px: overflow 0.
  - No images were added.
  - The trend and per-capita figure states were checked through render tests and the implementer's staged walk, not by my own on-screen walk.
  - **Finding F-A below.**

**F-A — copy truthfulness: FAIL (Phase 4 to fix)**
- **Where:** `src/content/help/presbytery-reports.md:30`, read by any presbytery staff member.
- **Claim:** "Each card says which year it shows."
- **Screen:** "Vacant pulpits" prints no year or date in its "some" or "not recorded" states (`dashboard-cards.tsx:130–160`). "Member congregations" and the Viability list print no year either; they show today's state.
- **Fix:** reword the sentence, for example: the trend and per-capita cards name their year; the others show today. Add an exact-text test in `help-page.test.ts` that fails on the old sentence.
- This sentence came from the Phase 3 draft. The implementer was told the screen wins over the draft.

**F-B — copy truthfulness, a design gap (tech-lead to rule)**
The page hides the card links when a target flag is off, but keeps the instruction sentences beside them:
- `dashboard-cards.tsx:88` (`TREND_COPY.nothing.body`, "…in the Congregation Statistics section")
- `:171` (per-capita `noRate`/`rateSet`, "…in the Per-Capita section of Per-Capita, SASR & Imports")
- `:134` ("Record appointments on Credentials")

With `org_portal.reports` off, `/admin/reports` renders only "isn't turned on" (`reports/page.tsx:111–113`). `org_portal.credentials` is seeded off and is off in the CI baseline.

Who sees it: a holder of `statistics.manage`, `per_capita.manage` or `credentials.manage`, on a presbytery where insights is on and the target flag is off. That is reachable, since insights is ON in production (`docs/TODO.md:290`). Phase 3's audience check covered keys, not flags.

The tech-lead's options: hide the sentence along with its link, reword it, or accept it as a residual that matches the shipped report. The 0.57.0 vacant report already shows "Open Credentials" without any flag check, at `vacant-pulpits-view.tsx:39`; that is pre-existing and not this pipeline's.

**Advisory, not blocking:** when the roster count fails, the "Member congregations" card says "Try again in a moment" but offers no "Try again" link (`dashboard-cards.tsx:75`). The other cards and the viability section do offer one.

**360px walk** (my own, against the server on :3101):
- `presbytery-clerk`, `org-multi` and `presbytery-nogrant` at 360px; the clerk at 1280px; the presbytery home at 360px; a congregation's stub as `org-single`; and the help page anonymously.
- Horizontal overflow was 0 in all seven views. Cards stack in one column at 360px. The viability list is cards at 360px and a table at 1280px.
- All dashboard links are at least 44px tall. The 20px "Back to portal" link is existing layout, not this diff.
- The presbytery home shows the Insights tile without "Coming soon"; the congregation stub shows "Coming soon".
- I turned on the insights, oversight and credentials flags for the walk and restored the baseline afterwards.

## Verdict
**FAIL** — copy truthfulness, F-A (`src/content/help/presbytery-reports.md:30`). F-B needs a Phase 3 ruling before the fix. Every other required check is green.

**Handoff:** **tech-lead (Phase 3)** first, for a short ruling on F-B: hide the sentence with its link, reword it, or accept the residual. Then **full-stack-developer (Phase 4)** fixes F-A, with an exact-text test that fails on the old sentence, plus whatever F-B's ruling requires. QA then re-runs only the copy check, `help-page.test.ts`, `dashboard-views.test.tsx` and the 360px help walk; the rest of this run stands.


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
