# Presbytery dashboard map (Increment 4b, slice two) — Work Log

> **Slug:** `2026-11-17-presbytery-dashboard-map`
> **Surface:** (org) — `/o/<slug>/admin/insights`, presbytery branch only; coordinate entry on the oversight page; `/help` (presbytery-reports, privacy-policy)
> **Permission(s):** existing `congregation_oversight.manage` (the coordinate reader gate ruled in slice one's Phase 6 follow-up)
> **Flag(s):** existing `org_portal.insights` (no new global flag pre-live)
> **Estimated complexity:** medium
> **Pipeline mode:** Full (adds the `leaflet` dependency, DECISION-122; a CSP `img-src` host; a third-party tile call)
> **Parent:** slice one `docs/work-log/2026-11-17-presbytery-dashboard.md` (its Phase 1 Gap 1 and Phase 6 follow-up define this slice)
> **Pre-assigned:** DECISION-343+, F450+, no migration expected (0089 free if needed), dev port 3101, worktree `../presby-map`, Neon branch `br-green-brook-axgyfla5` (`pipeline/presbytery-map`), e2e person-id range: reuse slice one's fixtures only
> **Key:** `NEXT_PUBLIC_MAPTILER_KEY` set in Vercel Production + Preview and in the worktree's `.env.local` by the operator, 2026-11-17 (origin-restricted to presbyportal.org and localhost)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-11-17 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-11-17 |
| 3 — Technical design | tech-lead | Complete | Design complete; implementer: full-stack-developer | 2026-11-17 |
| 4 — Implementation | full-stack-developer | Pending | — | — |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

*Returned as text for the orchestrator to record in `docs/work-log/2026-11-17-presbytery-dashboard-map.md`, 2026-11-17. Read-only: I ran no dev server and touched no file. I checked the registry (`leaflet` `latest` is still 1.9.4, BSD-2-Clause; the `beta` tag is 2.0.0-beta.4) and the worktree's `.env.local` for the key's presence only, never its value.*

## VERDICT

**READY WITH NOTES.** The notes are rulings for Phase 2 and Phase 3 to carry; none needs the operator before design starts.
- The coordinate **entry already exists** on the oversight edit form, so this slice needs **no migration** and 0089 stays free.
- The slice does need a copy fix and a server-side validation fix on that form (Gaps 1 and 2).
- The real work is the dependency, the CSP host, a coordinate reader with valid-pair rules, and the empty and few-pin behaviour that real data will cause.

## ONE-LINE TAKE

> A presbytery staff member who holds `congregation_oversight.manage` gets a map of member congregations above the viability list, each pin text-named and coloured by viability. The map shows only when a MapTiler key is set. The list stays the complete answer, and a clerk can place a pin by typing decimal latitude and longitude on the oversight page.

## User Verbs

| Surface | Verb | Cadence |
|---|---|---|
| Authenticated presbytery staff holding `congregation_oversight.manage` | **Look at** the map on "Insights & Analytics" and read its caption ("N of M congregations are on the map") | On demand |
| Same | **Zoom, pan** (desktop: drag; phone: two fingers or the +/- buttons) and **tap or Tab to** a pin | On demand |
| Same | **Open** a pin's popup (name and viability in words) and **follow** its link to that congregation's oversight page, where the oversight flag is on | On demand |
| Same | **Read** "Not on the map" for congregations with no valid location, and **follow** it to enter one | On demand |
| Same | **Type** latitude and longitude on the oversight edit form (shipped, but its label and validation change in this slice) | One-time per congregation |
| Staff holding other report keys but not `.manage` (stated clerk) | See the Viability section "Locked". **There is no map verb and no mention of a map.** | n/a |
| Operator (not a user surface) | Set or remove `NEXT_PUBLIC_MAPTILER_KEY` and redeploy | One-time |
| Anyone else (congregation, synod, GA, the public) | Nothing changes. No map and no new route. | n/a |

The surface is the authenticated member surface only, `/o/<slug>/admin/insights`, presbytery type. There is no anonymous surface.

## Flows

**Flow 1 — Clerk reads the map (key set, at least one valid pin):**
- Entry: Insights & Analytics, below the cards and above the viability list, inside the Viability section for a `.manage` holder.
- Steps: the page renders a fixed-height placeholder, then the map loads client-side.
- The map frames the pins: one pin centres at a sensible zoom, and several use fit-bounds with a padding and a maximum zoom (Gap 4).
- Each pin has a shape and colour per viability. "Not yet assessed" is included, drawn differently, so it is never missing.
- Tapping a pin, or Tab then Enter, opens a text popup with the name and the viability word.
- If `org_portal.oversight` is on, the popup has a link "Open oversight page". If it is off, the name is plain text.
- Below the map sit the legend in words, the caption "N of M congregations are on the map", the attribution, and the "Not on the map" text list.
- Outcome: the map is an enhancement, never a replacement. The full list sits below it unchanged.
- Failure, tiles fail: tile errors are counted. Several errors and no tile loaded collapse the map to "The map could not load. The list below has the same congregations."
- A single transient error must not collapse the map.

**Flow 2 — Key set, no congregation has a location (the real first state for the presbytery's own data):**
- Outcome: no map and no empty world. One block reads "No congregation has a location yet. Add a latitude and longitude on its oversight page. Latitude comes first." It links to the oversight list only if `org_portal.oversight` is on. Otherwise it is text with no link.
- This is the page a real presbytery will see at first, so it is the onboarding.

**Flow 3 — Key unset:**
- The map section is **absent** with no placeholder. The page never mentions a map and the "no location" prompt does not appear.
- This is the CI, e2e and any environment without the variable.
- Slice one's tests already pin "nothing mentions a map".

**Flow 4 — Stated clerk (no `.manage`):** the Viability section is "Locked" as shipped, and the key never reaches the client. The map data is **not read at all** (Gap 6).

**Flow 5 — Clerk places a congregation on the map (existing form, upgraded):**
- Entry: Congregation Oversight, a congregation, edit form, "Map location" group.
- Steps: type latitude (decimal degrees, between -90 and 90), then longitude (between -180 and 180, **negative for the US**), then "Save".
- Outcome: the next load of Insights shows the pin. "Saved" tells the clerk where to see it, because a blind entry loop is the real usability cost (Gap 2).
- Failure: an inline message for a non-number or out-of-range value. The server re-checks and returns the same wording. Half-set (one blank) is refused with "Enter both latitude and longitude, or leave both blank."
- Clearing both removes the pin.

**Flow 6 — Operator turns the map on or off:**
- Turn on: set the key in Vercel and redeploy (a `NEXT_PUBLIC_*` value is inlined at build, so there is no hot switch). Production and Preview are already set.
- Rollback: remove the variable and redeploy, or turn `org_portal.insights` off for the whole page. There is no per-request kill switch. This is accepted under the "no new global flags pre-live" ruling, and the `check:deps-drift` family tripwire does not change it.

**Flow 7 — Phone at 360px:**
- The map is a fixed ~18rem block inside the page's scroll.
- One finger must scroll the page and must not be captured by the map. Two fingers pan and zoom, and the +/- buttons work (Gap 7).
- The "Not on the map" list and the viability cards stack single-column. There is no horizontal overflow.

## Permissions & Flags

- **Permission:** `congregation_oversight.manage`, the Viability card's existing key. No new key (the catalog has no `.view`). It is checked **live inside the new reader's own transaction**, as `readViability` does. The page never decides it.
- **Default roles:** founding administrator for the presbytery only (`0059`, `0071`, `0085`). The stated clerk template does not hold it, so a stated clerk sees "Locked". **Phase 6 must walk both people.**
- **Flag:** existing `org_portal.insights` only (gate order unchanged).
  - `org_portal.oversight` decides only whether a name or popup link is a link, read with the bare `isFlagEnabled` as slice one does.
  - **No new global flag.** The environment variable is the on/off.
  - A per-organization toggle is not warranted: it is a third-party call, but only for staff who already opted into the page.
- **Production state:** the TODO says `org_portal.insights` is ON in production for the two real organizations. After deploy, the key is set, so the map block (Flow 2) appears for them immediately, with no further operator action.

## Gaps the Request Didn't Address

1. **Coordinate entry already exists, but its copy is false after this ships.**
   - `edit-form.tsx` has Latitude and Longitude (`type="number"`, `step="any"`) under the legend "Map coordinates (for a future viability map)".
   - That legend and the file's comment ("nothing yet renders a map") become untrue the moment the map lands.
   - **Ruling:** change the legend to "Map location" and add hint text under each field. Latitude: "Decimal degrees between -90 and 90, for example 39.9612. This comes first." Longitude: "Decimal degrees between -180 and 180. Congregations in the United States have a negative longitude, for example -82.9988."
   - Add the registry labels "Latitude", "Longitude" and "Map location" to the help entry.
2. **The server accepts bad coordinates, and half-set pairs, that the map cannot use.**
   - `setCongregationOversight` checks only `< -90` and `> 90` (the same for longitude), so `NaN` passes both comparisons and is stored as the string "NaN" in the unconstrained `numeric` column.
   - A crafted server-action call can carry NaN. The client's `Number.isFinite` is not the gate.
   - **Ruling, no migration:**
     - The server requires finite numbers.
     - The server requires both or neither (the only message above).
     - The reader is the final authority and never trusts the column, so a legacy half-set row, an imported row or "NaN" yields "no location".
     - Do **not** add a `CHECK` constraint for this. It would force migration 0089 for a rule the reader must enforce anyway. Phase 3 may override with a reason.
   - Add the missing coverage. The existing oversight e2e and unit tests never submit coordinates, so none of this is pinned today.
   - **Ruling for Phase 3:** accept a pasted "39.9612, -82.9988" in the latitude field and split it into the two fields, client-side. A maps application copies exactly that string, and typing two decimals blind for ~40 congregations is where entries go wrong.
3. **A valid pair needs the whole rule, in one pure function.**
   - Both present, both finite, latitude in -90..90, longitude in -180..180.
   - Exactly 0 and 0 is treated as no location, and says "No location", never a pin in the Gulf of Guinea.
   - Anything else is no location and is counted in "Not on the map", never silently dropped.
   - **There is no plausibility check against a region.** Presbyteries and their partners include places outside the continental US, and a wrong guess would hide a correct pin.
   - A sign error therefore shows up visibly, with a pin in another country, which gives the clerk the feedback they need.
4. **Few or one pin must frame correctly.**
   - Fit-bounds on a single point zooms to the maximum, which is a street-level grey tile.
   - **Ruling:** one pin is centred at a fixed zoom (about 10). Several pins use fit-bounds with padding and a maximum zoom (about 12) and a minimum zoom (about 2), so a single wrong-sign pin does not leave a broken frame.
   - Zero valid pins shows no map at all (Flow 2).
   - Real PSV data will mostly have no coordinates at first, so Flow 2 and the one-pin case are the *common* paths.
5. **The click target contradicts the popup rule.**
   - Slice one's Phase 1 said a click goes straight to the oversight page, and the Phase 6 follow-up says text-only popups.
   - A pin that navigates on first tap is hostile on a phone, because the reader cannot tell which congregation it is before leaving.
   - **Ruling:**
     - A pin opens a popup with the name and the viability word.
     - The popup is built from DOM nodes with `textContent`. No HTML string, no `bindPopup(string)`, and no tooltip string that Leaflet would interpret as HTML.
     - It carries an "Open oversight page" link only when the server says the oversight flag is on.
     - The link's `href` is built from the slug and the organization id, both UUID/slug-validated server values, never from a name.
     - Pin icons are `divIcon`s made from DOM nodes, so there are no image assets (Leaflet's default marker images break under bundlers and would also need `img-src` for the app).
     - `L.marker` gives keyboard focus. `circleMarker` (SVG paths) does not, so **do not use it**.
   - Pin a test with `<img src=x onerror=...>` as a congregation name.
6. **The coordinate read must not widen what other readers see.**
   - Slice one's `readViability` deliberately never reads coordinates, and its tests say so.
   - The pins need their own reader in `src/lib/presbytery-reports/`, with its own transaction and live key check:
     - It runs on `db` with `withOrgContext`.
     - It reads the roster first, so a departed congregation never appears.
     - It is never in the CSV, in an audit row (the oversight audit metadata today carries `viabilityScore` only, and stays so), in a `<title>` or in a URL.
     - The client component receives only `{ id, name, lat, lng, label, href|null }` and nothing else (no notes, buildings or insurance). Pin that in a test.
   - Whether to fold it into the existing viability call (one transaction) or add a sibling is Phase 2's call.
7. **Touch, wheel and stacking traps.**
   - One-finger drag on a Leaflet map captures page scroll. **Ruling:** `dragging` is off on touch devices, and two-finger pinch pans and zooms. The +/- buttons and keyboard remain.
   - Also turn **off** wheel zoom (it traps desktop scroll), and enable it on focus if wanted.
   - Add an e2e at 360px that a one-finger vertical drag over the map scrolls the page.
   - Leaflet pane z-indexes run to about 1000 and sit above the app's sticky header, mobile menu and dialogs. **Ruling:** the map container gets its own stacking context (`isolate`) and a test or screenshot check opens the phone menu over the map.
   - Leaflet's CSS sets its own colours for popups and links. Popups must use theme tokens (`bg-background`, `text-foreground`) so they are legible in the current colour scheme and brand cascade.
8. **Tiles, the CSP and the key.**
   - Use raster tiles (`https://api.maptiler.com/...?key=`), so only `img-src` changes. Name exactly one host there. The existing policy has `connect-src 'self'`, and vector tiles would need it too, which is a larger change.
   - The CSP is Report-Only except on the give routes, so a wrong host fails silently in the browser. The guard is a unit pin on the header string (the host is present, there is no wildcard and no second new host) plus an intercepted-tile e2e that checks the request goes to that host.
   - **The key is origin-restricted to presbyportal.org, www and localhost.**
     - The app already sends `strict-origin-when-cross-origin`, so the origin reaches MapTiler.
     - Do **not** change that header. The invitation routes' `no-referrer` does not apply here.
     - Vercel preview URLs (`*.vercel.app`) are not on the allow-list, so previews will get 403 tiles and show the fallback. That is expected behaviour, not a defect.
   - **Ruling:** do not widen the allow-list for previews. Walk real tiles on localhost, where the key works.
   - The key is public and domain-restricted (the Turnstile site-key shape). It is not a secret, is never used in a server call, and `.env.example` needs a documented, empty `NEXT_PUBLIC_MAPTILER_KEY` line. `check:secrets` must not flag it. The grep shows `.env.example` has no line for it yet.
   - Attribution (MapTiler and OpenStreetMap contributors) must render on the map as real links with `rel="noopener noreferrer"`, per the providers' terms.
9. **Dependency choice, explicit.**
   - **Ruling: `leaflet@~1.9.4`** (tilde, not caret), with `@types/leaflet` as a dev dependency at a matching `~1.9`.
   - `latest` is still 1.9.4, and 2.x is beta, ESM-only and removes the global `L`. Adopting it is a later, separate decision.
   - The tripwire pins both package names (`leaflet` and `leaflet/dist/leaflet.css`) to the two files DECISION-342 named: the thin client loader and `map.tsx`. It also pins `react-leaflet` as banned.
   - `next/dynamic` with `ssr: false` is called from the client loader. Provide a same-height skeleton while loading so the page does not shift.
10. **Accessibility.**
    - The map region needs a name and a note that the list below carries the same information.
    - Pins are focusable and carry text names.
    - Viability is conveyed by shape and by the legend in words, not colour alone.
    - The "Not on the map" list is part of the accessible alternative.
11. **Third-party disclosure and usage.**
    - The viewer's browser contacts MapTiler directly, so MapTiler receives the IP address, browser details, the site origin and the area viewed. No congregation name, score or person data goes in a URL (Gap 5 and the adversarial pass).
    - The disclosure goes in `privacy-policy`, effective now because the key is set in production.
    - The free tier has a request quota. Over quota, tiles error and the fallback appears.
    - **A question to confirm with the operator, with a default (Open Questions 2):** that the MapTiler plan's terms allow use by a nonprofit portal.
12. **2FA mid-enrolment and audit.** Unchanged from slice one: the proxy and `assertOrgSession` redirect to `/totp` with the page's own path. The read is read-only with no export, so **no audit event**. The coordinate *write* already records `CONGREGATION_OVERSIGHT_SET`. Say both explicitly so neither reads as an omission.
13. **Test environment.** The e2e lane has no real key, so it uses a fake key and intercepted tiles. The seed has invented coordinates for the dev fixtures (`scripts/seed-dev.sql`, two congregations). Any e2e that needs coordinates must set and then clean its own rows, since shared fixtures and `e2e/support/*` are Rule 16 files.

## Adversarial pass

- **Redirects.** No `callbackUrl`, `next` or redirect parameter is read. The popup link is built server-side from a slug and an id, not from user input. **Confirmed.**
- **State-machine shortcuts.** There is no multi-step flow. The map's data is read only inside the key-checked transaction, so a keyless user typing the URL gets the locked state and no coordinates. **Confirmed, as long as Gap 6 holds.**
- **Enumeration.** The four-way org miss is unchanged and no new 403/404 is added. The map reveals only organizations on the viewer's own roster. **Confirmed.**
- **Input boundaries.** The oversight write is the only input. Gap 2 closes NaN and half-set on the server, and the reader independently rejects NaN, infinities, out-of-range values and 0/0. Overlong decimal strings parse to a number and render fine. **Gap, closed by Gap 2 and 3.**
- **Stored XSS through names.** Congregation names are tenant-entered, and Leaflet interprets some strings as HTML. Use DOM nodes and `textContent`, no popup strings, plus the `onerror` test. **Gap, ruled in Gap 5.**
- **Payload over-exposure.** Only the six fields go to the client component, tested. **Gap, ruled in Gap 6.**
- **Leaks to the provider.** No name, score, id or slug in a tile URL or `Referer`. The origin alone is sent, which is already the site-wide policy. **Confirmed by design, pin with a test on the tile URL template.**
- **Self-targeting.** Not applicable (read-only). A clerk can place or clear only pins on their own presbytery's member congregations, and `resolveMemberCongregation` already refuses another organization.
- **Third-party key.** Public, domain-restricted and never reused server-side. **Confirmed.**

## Out of Scope (confirm with user)

- Geocoding from an address (DECISION-120), and any "find the congregation on the map" search.
- Clustering, heat layers, routing, layer switching and drawing tools.
- A map on the oversight edit page (a preview there would put the dependency in a second file and break the containment). The "Saved" note points to Insights instead.
- Vector tiles, a custom MapTiler style and offline tiles.
- A coordinate import tool. The one-time PSV import is a separate piece of work, and when it comes it should accept latitude and longitude columns. The reader already tolerates empty and invalid ones.
- A map for congregation, synod or GA types.
- Widening the key's allowed origins for Vercel previews.
- A new key, a new global flag, a per-organization toggle, a migration, a CSV or an audit event.

## Help impact

- **`presbytery-reports` (edit, `verifiedIn` moves only by the Phase 6 walk).**
  - Under "Insights and analytics" and "Viability", add "The map": where it is, who sees it (Manage congregation oversight, and only when your presbytery's map is on), the legend in words, "N of M congregations are on the map", "Not on the map", the phone gesture (two fingers) and that the list has the same congregations.
  - Add a short "Putting a congregation on the map" section: open "Congregation Oversight", then the congregation, then "Map location". Latitude comes first, longitude is negative in the United States, and both fields or neither.
  - Tell the reader how to copy the numbers from a maps application. A pasted pair splits itself, if Phase 3 keeps that ruling.
  - Add an anchor, for example `viability-map`.
  - Add registry labels for the strings it quotes: "Latitude", "Longitude", "Map location", "Not on the map" and the empty-state heading.
- **`privacy-policy` (edit).**
  - Add MapTiler to "Other companies that handle information": it supplies the map pictures on a presbytery's "Insights & Analytics" page, receives your IP address, browser details and the area you are looking at while the map is showing, and is sent no names, scores or records.
  - Note that OpenStreetMap contributors' data is credited on the map.
  - Update the "Last updated" date. `verifiedIn` there moves only by the Phase 6 walk.
- **`roles-who-can-do-what`: no edit.** No role or permission bundle changes. The table already says what "Manage congregation oversight" gives, and Phase 3 should re-read the row once to confirm it names the Viability section only.
- **`turning-features-on-and-off`: no edit.** No toggle changes.
- **`presbytery-tools` (a `planned` placeholder): no edit.** It says nothing about the map.
- **`first-day-as-administrator` (read once).** It says "Insights & Analytics" "only describes an idea" for congregations. That remains true for congregations, and slice one's Phase 6 left it alone, so no edit is expected.
- No new `[help:<token>]` is needed, and no screenshot is planned. If one is wanted, `npm run help:shots` needs a fixture-only database and the map would call a real tile server, so skip it.
- Phase 6 reads both edited pages as their reader at 360px against the shipped build, with the real key on localhost.

## Open Questions

None block design. Rulings are given above; these two are named with defaults.

1. **Does the MapTiler account plan permit use by a nonprofit portal, and is the monthly request limit enough for staff use?** Recommended default: proceed, since the operator provisioned the key and the usage is a few staff per presbytery. The tile-failure fallback makes a quota or terms problem degrade to the list, not break the page. The operator confirms the plan terms on their account.
2. **Should Vercel preview URLs also render tiles?** Recommended default: no. Previews show the fallback line, and the real-tile walk happens on localhost and then once on presbyportal.org after the deploy.

Decisions I would not leave open, all given a default above: `leaflet@~1.9.4`; raster tiles on `img-src` only; no `CHECK` constraint and no migration; text-only DOM-node popups; two-finger touch panning.

## Phase 6 note for later

Phase 6 can reach **SHIP IT** if the walk covers three things.
- Real tiles on localhost with the real key, as the founding administrator at 360px (the pin popup, the one-pin and several-pin framing, the zero-pin prompt, and `isolate` against the phone menu).
- The stated clerk (locked, no map, no coordinates in the page source).
- The oversight form (the new label, the half-set refusal, "Saved" and then the pin on Insights).

A walk on presbyportal.org after the deploy is a tracked follow-up, since production tiles cannot be walked before merge.

**Handoff:** architect (Phase 2). Questions for it:
- Where the pin reader lives, and whether it shares the viability transaction.
- Confirm the exact file list for the containment tripwire.
- Confirm `leaflet@~1.9.4`.
- Confirm the single `img-src` host.
- Whether `NEXT_PUBLIC_MAPTILER_KEY` is read on the server and passed as a prop, or read in the client file.
- Whether the "Saved" note, the paste-split and the form-hint copy belong in this increment (my recommendation) or in a follow-up.

Files read, for the record: `/Users/cshenso/git/presby-platform/presby-map/docs/work-log/2026-11-17-presbytery-dashboard.md`, `/Users/cshenso/git/presby-platform/presby-map/docs/work-log/2026-11-17-presbytery-dashboard-map.md`, `/Users/cshenso/git/presby-platform/presby-map/src/lib/presbytery.ts` (the write at lines 455-590), `/Users/cshenso/git/presby-platform/presby-map/src/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/edit-form.tsx`, `/Users/cshenso/git/presby-platform/presby-map/src/lib/presbytery-reports/viability.ts`, `/Users/cshenso/git/presby-platform/presby-map/src/lib/presbytery-reports/dashboard.ts`, `/Users/cshenso/git/presby-platform/presby-map/src/components/presbytery-reports/dashboard-viability.tsx`, `/Users/cshenso/git/presby-platform/presby-map/next.config.ts`, `/Users/cshenso/git/presby-platform/presby-map/src/content/help/presbytery-reports.md` and `/Users/cshenso/git/presby-platform/presby-map/src/content/help/privacy-policy.md`.

---

# Phase 2 — Architectural Review (architect)
## Phase 2: Architectural Review (architect)

*Returned as text for the orchestrator to record in `docs/work-log/2026-11-17-presbytery-dashboard-map.md`. I changed no files. I re-checked the registry on 2026-11-17. I read the live catalog on the pipeline's Neon branch for `congregation_oversight` and printed no connection string. For the key in `.env.local` I checked only that it is present, never its value.*

## Verdict

**Approved with suggestions.** The slice keeps the shape DECISION-122 and DECISION-342 set out:
- One new runtime dependency, confined to one client file behind a thin loader.
- One coordinate reader with its own transaction and its own live key check.
- One new `img-src` host.
- Fixes to the oversight form that this slice makes necessary.

There is no migration, route, server action, definer, flag or permission key. The rulings below are the suggestions, and Phase 3 must carry them. I am proposing **DECISION-343** (text at the end). The pre-assigned numbers still hold: DECISION-343 is the next free number (the top of `docs/decisions.md` is 342), F450 and up are free, and 0089 stays unused.

## Placement

### Directory placement

Every file named, so that the tripwire and the scans can name them exactly.

**New, pure (no database):**
- **`src/lib/coordinates.ts`** has no imports. It exports one coordinate-pair rule, `mappablePair(lat: unknown, lng: unknown)`. The rule:
  - both values are `typeof number` and `Number.isFinite`;
  - latitude is within -90..90 and longitude within -180..180;
  - exactly 0/0 is not a location.

  It also exports the paste splitter for `"39.9612, -82.9988"`. It sits flat in `src/lib/` (the `ymd.ts` / `site-address.ts` precedent), not inside `presbytery-reports/`, because four consumers need it:
  - the write in `src/lib/presbytery.ts`;
  - the map reader's derive;
  - the client form schema `oversight-schema.ts`;
  - `edit-form.tsx`.

  `presbytery-reports/` already imports `@/lib/presbytery`, so a file inside it would make the two modules import each other. One function means the write and the reader cannot disagree about what counts as a location. Pin the no-imports property with a test.
- **`src/lib/presbytery-reports/map-derive.ts`** imports only types. It turns the roster plus the selected facts into `{ pins, unplaced, total }`. It reuses `derive.ts`'s score-to-label mapping (no second label table), and its `RangeError` on a bad score is the same one. A second function, `toClientPins(map, slug, oversightOn)`, builds each pin's `href` from the slug and the id. This is the only place an href is built.

**New, server-only:**
- **`src/lib/presbytery-reports/map-config.ts`** exports `MAP_TILE_ORIGIN = "https://api.maptiler.com"` and `mapTileConfig(env = process.env)`, which returns `{ tileUrl } | null`. It follows the `help-contact/configured.ts` shape:
  - the key is trimmed and must match a conservative character set (for example `^[A-Za-z0-9_-]{8,128}$`), otherwise the result is `null`;
  - the key is passed through `encodeURIComponent`;
  - the template is the origin, the style path and `?key=`.

  It is the only file that names `MAPTILER`.
- **`src/lib/presbytery-reports/viability-map.ts`** exports `readViabilityMap(tx, viewer)` and `getViabilityMap(viewer)`. In order, it:
  1. calls `holdsPermissions` for `reportByKey("viability").permission`;
  2. calls `readRoster`;
  3. selects **only** `aboutOrgId`, `viabilityScore`, `latitude` and `longitude`, for this organization and the roster ids.

  It never selects notes, buildings, insurance or dates. It exports no `export*` function and calls no audit helper, so the existing `exportFunctionNames` pin stays at four.

**New components:**
- **`src/components/presbytery-reports/dashboard-map.tsx`** is a Server Component and stays under the existing `no-use-client` scan. It renders:
  - the region's accessible name and the note that the list carries the same information;
  - the legend in words;
  - the "N of M" caption;
  - the "Not on the map" list;
  - the zero-pin prompt (Flow 2);
  - the read-error line.

  It takes the client map as a `ReactNode` slot built by the page, so `src/components/` never imports from `src/app/`.
- **`src/app/(org)/o/[slug]/admin/insights/map-loader.tsx`** is `'use client'`. It calls `next/dynamic(() => import("./map"), { ssr: false, loading })`, with a skeleton the same height as the map.
- **`src/app/(org)/o/[slug]/admin/insights/map.tsx`** is `'use client'`. It is the only importer of `leaflet` and of `leaflet/dist/leaflet.css`.
- **`src/app/(org)/o/[slug]/admin/insights/map.css`** is imported only by `map.tsx`. Every selector is rooted at `.presby-map`, so the theme-token overrides (popup wrapper and tip, link colour) win on specificity (two classes) whatever order `leaflet.css` loads in. Nothing goes into `globals.css`. The precedent is `developer.css`, which is route-local plain CSS.

**Modified:**
- `dashboard.ts`
- `insights/page.tsx`
- `dashboard-viability.tsx` (the slot)
- `copy.ts` (`MAP_COPY`; it stays import-free, so the client files may import it)
- `next.config.ts`
- `package.json` and `package-lock.json`
- `.env.example`
- `scripts/check-deps-drift.mjs`, plus a new `scripts/check-deps-drift.test.mjs`
- `boundaries.test.ts`
- `src/lib/presbytery.ts`
- `oversight-schema.ts`
- `edit-form.tsx`
- the two help pages

### Server vs Client split

The client island is exactly `map-loader.tsx` and `map.tsx`. The key decision, the read, the hrefs, the caption, the legend, the unplaced list, the empty state and the read-error state are all rendered on the server. The client draws tiles and pins, and handles the tile-failure fallback, which it can only detect in the browser.

The loader receives two props:
- `tileUrl: string`
- `pins: ClientPin[]`, where `ClientPin = { id, name, lat, lng, score, label, href | null }`.

That is the analyst's six fields plus `score` (1, 2, 3 or null). Shape and colour need a value that is not a display string, and the score is already shown in the list, so this is not new data. A unit test pins `Object.keys` of a derived pin exactly.

### Dependencies

Yes: `leaflet@~1.9.4` in `dependencies` and `@types/leaflet@~1.9.22` in `devDependencies`. Tilde on both. A caret is forbidden because it would let a range cross into 2.x. The five-criteria pass:
1. **Not already solved.** No mapping library is in `package.json`.
2. **Maintained and compatible with the stack.** `latest` is 1.9.4 (2023-05-18). It is in maintenance while 2.0.0-beta.4 is developed, and 2.x is ESM-only and drops the global `L`. Adopting 2.x is a later, separate decision.
3. **Edge runtime.** Not applicable. It loads only in the browser through `ssr: false`, and the proxy is untouched.
4. **Bundle size.** About 40 KB gzipped of JS plus about 14 KB of CSS. It sits in a lazy chunk that loads only for a key holder whose presbytery has at least one pin, so no other page pays for it.
5. **License.** `leaflet` is BSD-2-Clause with no runtime dependencies. `@types/leaflet` is MIT and pulls in `@types/geojson` (MIT, types only). `react-leaflet` 5.0.0 is still Hippocratic-2.1 and stays **rejected** (DECISION-122).

## Invariants Touched

- **The `(org)` contract.** The new reader runs through `withOrgContext()` on `db`. `getPlatformDb()` does not appear, and the existing `no-owner-connection` scans cover both new files through the directory walk.

  Live catalog on the branch: `congregation_oversight` has `relforcerowsecurity = t`, a single `tenant_isolation` policy (`organization_id = presby_current_org()`), and `SELECT` for `presby_app` on `latitude` and `longitude` through the table grant. The design premise holds on the actual database, not only in `drizzle/`.

  The columns are unconstrained `numeric`, so Postgres will store `'NaN'` (and `'Infinity'`). That confirms the analyst's Gap 2. Today both rows have both values set and none is NaN.
- **Permissions vs flags (DECISION-003).** Kept separate:
  - The map's authority is `congregation_oversight.manage`, checked live in the map reader's own transaction.
  - `org_portal.insights` still gates the page.
  - `org_portal.oversight` is read with the bare helper only to decide whether `href` is null. That is presentational.
  - The environment key is configuration, not a flag and not a permission. It never stands in for either. A viewer without the key never has the map read run at all.
- **"Credential" mechanism.** Not touched. The MapTiler key is a public, origin-restricted, build-time value (the Turnstile site-key shape). It authorizes nothing in presby.
- **Brand cascade.** `(org)` is brandable and no emitter is added.
  - Popups use theme tokens through `map.css`, so they inherit the cascade.
  - Pin colours use the **same tokens `ViabilityBadge` uses**, not brand tokens. Viability is a meaning, not chrome.
  - `check:brand-scope` is unchanged.
- **No `loading.tsx` under `admin/insights/**`.** Unchanged and still pinned. The loader's `next/dynamic` `loading` is a component-level placeholder, not a route Suspense boundary, so the gate's `notFound()` and `redirect()` keep their status codes.
- **Audit.** The map read is read-only with no export, so no event. The write keeps `CONGREGATION_OVERSIGHT_SET`, and its metadata stays `viabilityScore` only. Coordinates never go into an audit row, the CSV or a URL.
- **Proxy.** Untouched. `check:proxy-imports` is unaffected.
- **CSP.** One host is added to `img-src`, and `connect-src 'self'` is unchanged. The same string is **enforced** on the give routes, so `api.maptiler.com` becomes a permitted image origin there too. That is acceptable: images do not execute, and `check:giving-boundaries` B7 governs script, frame and form directives, not `img-src`.

## Notes

Phase 3 must honour these.

### 1. Pin reader placement and transaction sharing

**It is a sibling reader in its own transaction, not folded into `readViability`.**
- `readViability` feeds the CSV export, and its contract is "coordinates are never read". Widening it would put coordinates on the export's read path.
- A shared transaction would let a failing map query abort the list's transaction. The list is "the complete answer", and an enhancement must never take it down. This is the same reasoning as DECISION-342's one-transaction-per-card rule.

In `getPresbyteryDashboard`, add a sixth `allSettled` entry, run **only when `held.viability && tiles !== null`**. Without the key, the reader never runs and coordinates are never read for nothing. The dashboard gets a `map` result next to `cards` (not a card): `off | locked | error | ok`, with `OrgAccessError` rethrown as for the others.

**Display rules:**
- The map block renders only when **both** the viability list and the map read are `ok`. If the list has failed, no map is shown, because the fallback copy promises "the list below".
- A failed map read renders the same line as the tile failure ("The map could not load…"). It **never** renders "No congregation has a location yet". A failure must never read as an empty state, the same honesty rule as DECISION-342's roster.
- The caption, the pins and the "Not on the map" list come from one read, so they always agree with each other. The viability list is a separate read, so a congregation joining or leaving between the two transactions could make them differ by one for one page load. This is accepted. Name it in Edge Cases.

### 2. The key is read on the server and passed as a prop; the client never reads `process.env`

Flow 3 (render nothing when the key is unset) and Flow 4 (a viewer without the key gets nothing) are server decisions, so the server has to know whether the key is set anyway. A second read in the client would also inline the key into the map chunk.

- `mapTileConfig()` runs in the page.
- The loader element, and so the key inside `tileUrl`, is created only when the key is set, the map is `ok` and there is at least one pin.
- With the env-parameter pattern the value is looked up on the server, not substituted at build time. The operator's "set it in Vercel and redeploy" is the same either way.
- The `NEXT_PUBLIC_` name stays. The operator has already set it, and it correctly marks the value as public.
- `.env.example` gets a documented, empty `NEXT_PUBLIC_MAPTILER_KEY=` block next to Turnstile's. It should say: origin-restricted, leave blank for no map, and previews get the fallback.
- For e2e: the map spec needs its own server started with a **fake** key, and it intercepts `https://api.maptiler.com/**`. If it runs against a production build, the key must be present at build time. Flow 3 is covered by unit tests of `mapTileConfig` and of the page with the key absent, not by a second e2e server.

### 3. The tripwire: exact files and mechanism

Two parts. Extend existing checks; no new script.

**(a) `scripts/check-deps-drift.mjs`.** This is the existing dependency check: it already reads `package.json` and the lockfile and walks `src/`, and it runs in `npm run check` (`ci.yml:37`). It is the "check:deps-drift-style" check DECISION-122 named. Add three rules:
- **Rule 4.** `leaflet` is in `dependencies` only, with a range matching `^~1\.9\.\d+$`. `@types/leaflet` is in `devDependencies` only, with `^~1\.9\.\d+$`. The lockfile root agrees.
- **Rule 5.** `react-leaflet` and any `@react-leaflet/*` are absent from `package.json`, from the lockfile root, and from every import under `src/`.
- **Rule 6.** Every specifier `leaflet` or `leaflet/…` under `src/` appears only in exactly `src/app/(org)/o/[slug]/admin/insights/map.tsx`. This covers static, side-effect, dynamic `import()`, `require` and **type-only** imports. `leaflet-*` package names do not match, and comments are stripped. The other half: that file must import both `leaflet` and `leaflet/dist/leaflet.css`. This is the same two-way shape as treasury T5's `sharp`.

The script has no test today and calls `process.exit` at top level. Refactor it the way `check-treasury-boundaries.mjs` is structured:
- exported pure `check*` functions over `{ pkg, lock, files }`;
- an `isMain` guard;
- a new `scripts/check-deps-drift.test.mjs`, already collected by vitest's `scripts/**/*.test.mjs`.

The test needs a failing sample for every rule, old and new, plus the legal neighbours that must not fire.

**(b) `src/lib/presbytery-reports/boundaries.test.ts`.** It already owns `INSIGHTS_DIR`. Each new rule needs a failing sample.
- **`no-use-client`.** Replace "nothing is a client component" with: the `'use client'` files in `insightsFiles` are **exactly** `map-loader.tsx` and `map.tsx`. `moduleFiles` and `componentFiles` stay at zero.
- **`next/dynamic`.** It appears only in `map-loader.tsx`, and that file contains `ssr: false`. Nothing under `src/` imports `./map` or `insights/map` statically. The loader's only reference to it is the dynamic `import("./map")`.
- **Client-file bans** (both files): `process.env`, `MAPTILER`, `fetch(`, `XMLHttpRequest`, `@/lib/db`, `@/auth`, `next/headers`, any `actions` import, `.innerHTML`, `insertAdjacentHTML`, `bindTooltip`, `circleMarker`, `L.icon(` or `iconUrl`, and an `attribution:` option.
- **Popup and icon building.** `bindPopup(` and the `divIcon` `html:` option may only take a call to a named DOM-node builder, for example `bindPopup(popupNode(` and `html: pinNode(`.
- **Coordinate columns.** Among `moduleFiles`, only `viability-map.ts` names `latitude` or `longitude`. This keeps `viability.ts`, `csv.ts` and `audit.ts` clear.

### 4. Attribution and logo are React, not Leaflet HTML

- Set `attributionControl: false`. Render the attribution inside the map frame, in the loader or `map.tsx`, as React anchors with `rel="noopener noreferrer"`: "© MapTiler" linking to maptiler.com/copyright, and "© OpenStreetMap contributors" linking to openstreetmap.org/copyright. Leaflet's attribution option is applied as HTML, and this way no HTML string enters Leaflet.
- A MapTiler **Free** plan also requires the MapTiler logo, linked to maptiler.com. MapTiler's own example loads it from `https://api.maptiler.com/resources/logo.svg`, which is the same host, so the CSP needs nothing more. The operator should confirm the plan tier alongside the analyst's Open Question 1. Phase 3 rules on whether the logo shows.

### 5. The `img-src` host

The host string is exactly **`https://api.maptiler.com`**. The directive becomes:

`img-src 'self' data: https://lh3.googleusercontent.com https://api.maptiler.com`

- Tiles are raster, from MapTiler's documented 256-pixel Leaflet path (`/maps/<style>/256/{z}/{x}/{y}.png?key=`). The style id is Phase 3's call. MapTiler's current documentation shows `streets-v4`.
- `next.config.ts` cannot import a server-only file, so it keeps the literal. A unit test then asserts:
  - the `img-src` directive of the real `headers()` equals the line above exactly;
  - `connect-src` is still `'self'`;
  - `mapTileConfig({ NEXT_PUBLIC_MAPTILER_KEY: "fake" }).tileUrl` starts with `MAP_TILE_ORIGIN + "/"` and contains no `{s}`, slug, name or id.

  The existing `csp.test.ts` loader pattern serves for this.
- The intercepted-tile e2e confirms the request goes to that host.
- Leaflet's own CSS `url()` images are bundled and served from `'self'`.

### 6. Leaflet CSS placement

Put `import "leaflet/dist/leaflet.css"` in `map.tsx` only. App Router allows global CSS from a client component, and loading it with the lazy chunk keeps it off every page that never draws a map.
- Because CSS is split differently in dev and production, the Phase 4 browser check must cold-load the page on `next build && next start`. It looks for no unstyled flash (tiles stacked in a column is the tell-tale) and for the phone menu showing over an `isolate`d map.
- Do a **build smoke first**, before any UI work: add the dependency, a trivial `map.tsx`, and run `next build` (Turbopack). This repo has had Turbopack-only build breaks before.
- Run `npm audit` on the new tree and record the result in Phase 4.

### 7. The oversight form belongs in this increment

All three parts belong here. The legend and the file comment become false the day the map ships (copy truthfulness), and the map's value depends on clean data. Specifically:
- **Server, in `setCongregationOversight`.** Validate each coordinate with `typeof === "number" && Number.isFinite`. A server action receives whatever is sent, and a string or NaN gets past today's comparisons. Refuse a half-set pair. Use the **same** `mappablePair` from `src/lib/coordinates.ts`.
- **0/0 at write time.** I suggest refusing exactly 0/0 at the write as well. Otherwise the clerk sees "Saved" and then no pin. Phase 3 owns that copy.
- **Client schema.** Bring `oversight-schema.ts` into line with the same function.
- **Paste-split.** It is client-only, inside an existing `useForm` root that already has `<HydrationGate>`, so `check:hydration-gate` is unaffected. It is the first item to defer if scope tightens. It is not structural.
- **No CHECK constraint, no 0089.** Agreed with the analyst: the reader is the authority regardless.

### 8. Keep the slice-one pins

`exportFunctionNames` stays at four. `noForbiddenReads`, `read-only`, `no-redirect-target` and `strict-params` apply to the new files through the existing walks. `strict-params` bars `Number(` in the page, so numeric strings are parsed in `coordinates.ts` / `map-derive.ts`, never in the page or the client files.

### Observation, outside this scope

`presby_app` holds `DELETE` on `congregation_oversight`, and nothing in this slice uses it. This is for the monthly security review against the "all removals are soft" rule, not a gate here.

---

**Proposed DECISION-343:** *The presbytery dashboard map is a sibling coordinate reader (`src/lib/presbytery-reports/viability-map.ts`) behind `congregation_oversight.manage`, checked live in its own `withOrgContext` transaction and settled independently of the viability list. It runs only when that key is held and a tile key is configured. It is shown only when both the list and the map read succeed, and its failure reads as "could not load", never as "no location". One pure, import-free coordinate rule (`src/lib/coordinates.ts`: both values finite numbers, in range, and not exactly 0/0) governs the oversight write, the client form and the reader. The MapTiler key is read on the server only (`map-config.ts`, `mapTileConfig(env)`) and reaches the client inside a `tileUrl` prop, and only for a key holder with at least one pin. The client island is exactly `insights/map-loader.tsx` (`next/dynamic`, `ssr: false`) and `insights/map.tsx` (the sole importer of `leaflet` and `leaflet/dist/leaflet.css`), with a scoped `map.css`. Popups, pins and attribution are DOM nodes or React, never HTML strings. Dependencies: `leaflet@~1.9.4` and `@types/leaflet@~1.9.22`, tilde-pinned below 2.x; `react-leaflet` stays rejected. One CSP host is added: `img-src https://api.maptiler.com` (tiles and logo), with `connect-src` unchanged. Containment is enforced by new rules 4 to 6 in `check:deps-drift` (now with a fixture test) and by the insights rules in `presbytery-reports/boundaries.test.ts`.*

**Per-Phase Status row:**

| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-11-17 |

**Handoff:** tech-lead (Phase 3).
- Turn notes 1 to 3 into the API contract (the dashboard's `map` result, `ClientPin`, `mapTileConfig`, the write's validation) and the component plan (the slot prop).
- Carry notes 3 to 8 into Carry-forward and Edge Cases, including the one-load race between the list and the map counts, and "no audit, read-only, no export".
- Draft `MAP_COPY` and the oversight form strings. Rule on refusing 0/0 at the write and on the MapTiler logo (once the operator confirms the plan tier).
- Schedule the build smoke first.
- Re-run the live-tree feasibility check, since slice one's design deferred it.
- Implementer: probably full-stack-developer, since there is no schema work.

**Files relevant to this review:**
- `/Users/cshenso/git/presby-platform/presby-map/docs/work-log/2026-11-17-presbytery-dashboard-map.md`
- `/Users/cshenso/git/presby-platform/presby-map/src/lib/presbytery-reports/dashboard.ts`
- `/Users/cshenso/git/presby-platform/presby-map/src/lib/presbytery-reports/viability.ts`
- `/Users/cshenso/git/presby-platform/presby-map/src/lib/presbytery-reports/boundaries.test.ts`
- `/Users/cshenso/git/presby-platform/presby-map/src/lib/presbytery.ts`
- `/Users/cshenso/git/presby-platform/presby-map/src/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/oversight-schema.ts`
- `/Users/cshenso/git/presby-platform/presby-map/src/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/edit-form.tsx`
- `/Users/cshenso/git/presby-platform/presby-map/src/app/(org)/o/[slug]/admin/insights/page.tsx`
- `/Users/cshenso/git/presby-platform/presby-map/next.config.ts`
- `/Users/cshenso/git/presby-platform/presby-map/scripts/check-deps-drift.mjs`
- `/Users/cshenso/git/presby-platform/presby-map/src/lib/giving/csp.test.ts`
- `/Users/cshenso/git/presby-platform/presby-map/.env.example`

Sources:
- [MapTiler: Map attribution and how to add it](https://docs.maptiler.com/guides/map-design/attribution/add-attribution/)
- [MapTiler: Raster maps in Leaflet JS](https://docs.maptiler.com/leaflet/raster-maps-in-leaflet-js/)

---

# Phase 3 — Technical Design (tech-lead)

*Written 2026-11-17 against the live tree of `../presby-map` (branch `pipeline/presbytery-map`, based on main at `1f5fed82`, v0.59.0). Read: the Phase 1 and 2 text above, slice one's Phase 3, `docs/ui-standards.md`, and the files named in each section. DECISION-343 (new, `docs/decisions.md`) records the architect's proposal with the adjustments listed under "Rulings applied".*

## Summary

A presbytery staff member who holds `congregation_oversight.manage` sees a "Congregation map" section on Insights & Analytics, between the four cards and the viability list. Each member congregation with a usable latitude and longitude is a pin, drawn by shape (and colour) for its viability rating, focusable, with a text-only popup naming it and, where Congregation Oversight is turned on, linking to its oversight page. Congregations without a usable location are listed under "Not on the map", so none is silently dropped. The map appears only when `NEXT_PUBLIC_MAPTILER_KEY` is set (the operator has set it in Vercel Production and Preview and in this worktree); with no key the page is exactly slice one's. The viability list stays the complete answer: a failed map read, a failed tile load and a failed chunk load each degrade to one honest line and never touch the list.

The slice also fixes the oversight edit form that supplies the data. Its "for a future viability map" legend becomes false the day the map ships, and its server check lets `NaN`, strings, half-set pairs and 0/0 through. One pure, import-free rule (`src/lib/coordinates.ts`) now governs the write, the client form and the reader, so they cannot disagree about what a location is. A pasted pair ("39.9612, -82.9988") splits itself into the two boxes.

No migration (0089 stays free), no permission key, no flag, no route, no server action, no definer function. One new runtime dependency (`leaflet@~1.9.4`, DECISION-122), one new CSP `img-src` host, one new third-party call.

**Rulings applied (orchestrator, for the operator, 2026-11-17):** (1) the write refuses exactly 0/0, with copy; (2) the MapTiler logo (linked to maptiler.com) and the text attribution show regardless of plan tier; (3) the paste-split stays in this increment; (4) previews show the fallback and the key's origins are not widened; (5) raster style is **`streets-v4`**, 256-pixel PNG.

**Verified at design time (no key value was printed or stored):** with the worktree's key and `Referer: http://localhost:3101/`, `https://api.maptiler.com/maps/streets-v4/256/{z}/{x}/{y}.png?key=…` returns 200 `image/png` at z0, 1, 2, 6 and 18; `streets-v2` also returns 200 (not used); a request with a wrong Referer returns 403 (so Vercel previews degrade to the fallback, as ruled) and one with no Referer returns 403 (so the app's existing `strict-origin-when-cross-origin` policy is load-bearing and must not change); `https://api.maptiler.com/resources/logo.svg` returns 200 `image/svg+xml` (same host, no second CSP host); the key matches `^[A-Za-z0-9_-]{8,128}$`. MapTiler's current Leaflet guide shows the same `streets-v4/256` URL and `minZoom: 1`; its attribution guide requires the text attribution on every map (links to `https://maptiler.com/copyright` and `https://openstreetmap.org/copyright`) and, on a Free account, the logo linked to `https://www.maptiler.com`. A scratch `npm i leaflet@~1.9.4 @types/leaflet@~1.9.22` resolved to 1.9.4 (BSD-2-Clause) and `npm audit` found 0 vulnerabilities (Phase 4 re-runs it on the real tree).

## Permissions & Flags

- **Permission:** `congregation_oversight.manage` (the Viability card's key; no new key, no `FEATURES` change, no `FEATURE_CATALOG` change). Checked live, first, inside the new reader's own transaction (`holdsPermissions`, as `readViability` does). The page never decides it.
- **Default role bindings:** unchanged. Founding administrator for the presbytery only (`0059`, `0071`, `0085`); the stated-clerk template does not hold it, so a stated clerk sees the Viability section "Locked" and no map. Phase 5 and Phase 6 walk both people, plus `presbytery-nogrant`.
- **Flags:** existing `org_portal.insights` only gates the page (gate order unchanged). `org_portal.oversight` is read with the bare `isFlagEnabled` (as slice one does) only to decide whether a name or popup is a link, and, on the oversight edit page, whether the post-save note may promise a place to see the pin. **No new global flag.**
- **The environment key is configuration, not a flag and not a permission.** It never stands in for either. Operator on/off is set-or-remove `NEXT_PUBLIC_MAPTILER_KEY` and redeploy (accepted under the "no new platform flags pre-live" ruling; `org_portal.insights` off hides the whole page).
- **Gate order for the map:** gate (signed in, second-factor recheck, four-way org miss, `org_portal.insights`, presbytery type) → hub read (some key held) → the viability key held at the hub **and** a tile key configured → the map reader, which re-checks the viability key live in its own transaction.
- **Production state:** `org_portal.insights` is on in production for the two real organizations, and the key is set, so on deploy their founding administrators see the "no usable location yet" block (Flow 2) with no operator action.

## API Contract

No routes, no server actions, no SQL functions. Modules (all `server-only` unless stated):

**`src/lib/coordinates.ts`** (pure, **no imports**, pinned by a test; safe for the client form, the write and the reader)

```ts
export const COORDINATE_MESSAGES: {
  latitudeNumber: "Latitude must be a number.";
  latitudeRange: "Latitude must be between -90 and 90.";   // existing string, kept
  longitudeNumber: "Longitude must be a number.";
  longitudeRange: "Longitude must be between -180 and 180."; // existing string, kept
  halfSet: "Enter both latitude and longitude, or leave both blank.";
  zeroZero: "0 and 0 is a point in the ocean, not a congregation. Enter its real latitude and longitude, or leave both blank.";
};
export type CoordinateField = { kind: "blank" } | { kind: "number"; value: number } | { kind: "invalid" };
/** Strict decimal text: optional sign, digits with an optional fraction (^[+-]?(\d+(\.\d*)?|\.\d+)$ after trim). "", whitespace and null are blank; "NaN", "1e5", "Infinity", "0x1" and "39,9" are invalid. */
export function parseCoordinateField(text: string | null | undefined): CoordinateField;
/** The one rule. Both values `typeof number`, `Number.isFinite`, latitude in -90..90, longitude in -180..180, and not exactly 0 and 0 (-0 counts as 0). Anything else is null. */
export function mappablePair(lat: unknown, lng: unknown): { lat: number; lng: number } | null;
/** The write's and the form's validator. null/undefined are blank; anything else must be a finite number in range. Returns the first failure, or ok with the pair (null when both are blank). The half-set error names the BLANK field; 0/0 names latitude. */
export function validateCoordinatePair(
  lat: unknown,
  lng: unknown,
): { ok: true; value: { lat: number; lng: number } | null } | { ok: false; field: "latitude" | "longitude"; message: string };
/** "39.9612, -82.9988" -> { latitude: "39.9612", longitude: "-82.9988" }. Accepts a comma, semicolon or whitespace between two decimals, optional surrounding parentheses and an optional degree sign after each. Returns the digit strings as typed (no reformatting, no rounding). Anything else is null, so an ordinary paste is left alone. Range is not checked here (the fields' own validation reports it). */
export function splitPastedPair(text: string): { latitude: string; longitude: string } | null;
```

**`src/lib/presbytery.ts` — `setCongregationOversight`** (modified; signature unchanged). Replace the two range checks with `validateCoordinatePair(input.latitude, input.longitude)`: a failure returns `{ kind: "invalid_input", message }` **before** `withOrgContext`, so a bad value never opens a transaction. A server action receives whatever the client sends, so `typeof` and `Number.isFinite` are the gate, not the form's. `undefined` and `null` mean blank; both blank stores null in both columns (clears the pin); a valid pair stores `String(lat)` and `String(lng)` as today. `actions.ts` already maps `invalid_input` to `{ ok: false, error: result.message }` and records `CONGREGATION_OVERSIGHT_SET` with `viabilityScore` only; both are unchanged (coordinates never enter audit metadata).

**`src/lib/presbytery-reports/map-config.ts`** (server-only; the **only** `src/` file naming `MAPTILER`)

```ts
export const MAP_TILE_ORIGIN = "https://api.maptiler.com";
export const MAP_STYLE_PATH = "/maps/streets-v4/256/{z}/{x}/{y}.png";
/** Follows help-contact/configured.ts: a function of an env object, so a test passes any env. */
export function mapTileConfig(env: Readonly<Record<string, string | undefined>> = process.env): { tileUrl: string } | null;
```
The key is `env.NEXT_PUBLIC_MAPTILER_KEY?.trim()` and must match `^[A-Za-z0-9_-]{8,128}$`, else `null`. `tileUrl` = `MAP_TILE_ORIGIN + MAP_STYLE_PATH + "?key=" + encodeURIComponent(key)`. Reading the key through the passed `env` (default `process.env`, not a literal `process.env.NEXT_PUBLIC_…` member) means it is looked up at request time on the server and is never inlined into a client chunk. The client never reads the environment.

**`src/lib/presbytery-reports/map-derive.ts`** (pure; imports `./derive` for `VIABILITY_LABELS`, `VIABILITY_NOT_ASSESSED` and `RosterEntry`, so there is one score-to-label table and the same `RangeError` on a score outside 1 to 3; no `server-only`, no `Number(` outside `coordinates.ts`)

```ts
export interface MapFact { aboutOrgId: string; viabilityScore: number | null; latitude: string | null; longitude: string | null }
export interface MapPin { id: string; name: string; lat: number; lng: number; score: 1 | 2 | 3 | null; label: string }
export interface ViabilityMapData { total: number; pins: MapPin[]; unplaced: { id: string; name: string }[] }
/** Starts from the roster (a departed congregation never enters); roster order (name, id); a congregation with no oversight row, or a row whose pair `mappablePair(parseCoordinateField…)` rejects, is unplaced. */
export function deriveViabilityMap(roster: readonly RosterEntry[], facts: readonly MapFact[]): ViabilityMapData;
/** What the browser receives. EXACTLY these seven keys; `Object.keys` is pinned by a test. */
export interface ClientPin { id: string; name: string; lat: number; lng: number; score: 1 | 2 | 3 | null; label: string; href: string | null }
/** The only place an href is built: `/o/${slug}/admin/oversight/${id}` when `oversightOn`, else null. Slug is the gate-resolved value; id is a database uuid; a name is never in an href. */
export function toClientPins(data: ViabilityMapData, slug: string, oversightOn: boolean): ClientPin[];
```

**`src/lib/presbytery-reports/viability-map.ts`** (server-only)

```ts
export async function readViabilityMap(tx: OrgTx, viewer: ReportViewer): Promise<ReportRead<ViabilityMapData>>;
export function getViabilityMap(viewer: ReportViewer): Promise<ReportRead<ViabilityMapData>>; // withOrgContext(viewer.personId, viewer.organizationId, tx => readViabilityMap(tx, viewer))
```
In order: `holdsPermissions(tx, viewer, [reportByKey("viability").permission])` → `forbidden`; `readRoster`; then **one** select of exactly `aboutOrgId`, `viabilityScore`, `latitude`, `longitude` from `congregationOversight` where `organizationId = viewer.organizationId` and `aboutOrgId in roster ids` (skipped when the roster is empty). Never notes, buildings, insurance or dates. It exports no `export*` function and calls no audit helper (the `exportFunctionNames` pin stays at four). It is a sibling of `readViability`, never folded into it: `readViability` feeds the CSV, and a failing map query must not abort the list's transaction.

**`src/lib/presbytery-reports/dashboard.ts`** (modified)

```ts
export type MapResult = { kind: "off" } | { kind: "locked" } | { kind: "error" } | { kind: "ok"; data: ViabilityMapData };
export type PresbyteryDashboard = … | { kind: "ok"; roster: …; cards: DashboardCards; map: MapResult };
export async function getPresbyteryDashboard(viewer: ReportViewer, now: Date = new Date(), options: { map?: boolean } = {}): Promise<PresbyteryDashboard>;
```
A sixth `allSettled` entry runs `getViabilityMap(viewer)` **only when `held.viability && options.map === true`**; otherwise it is `{ kind: "off" }` and nothing is read. A reader `forbidden` (key revoked between the hub read and the read) is `locked`; any other rejection is `error`; an `OrgAccessError` from it is rethrown with the others. `map` sits beside `cards`, not inside it (it is not a card). The page, not this file, calls `mapTileConfig()` and passes `options.map`, so `dashboard.ts` stays a function of its arguments.

**Components and page (server → client boundary)**

```ts
// map-loader.tsx ('use client'): the only importer of ./map, by next/dynamic(() => import("./map"), { ssr: false, loading })
export function ViabilityMapLoader(props: { tileUrl: string; pins: ClientPin[] }): JSX.Element; // wraps the dynamic component in a React error boundary
// dashboard-map.tsx (Server Component, src/components/presbytery-reports/)
export function DashboardMap(props: { map: MapResult; viabilityOk: boolean; org: string; slug: string; oversightOn: boolean; retryHref: string; slot: ReactNode }): JSX.Element | null;
```
The page builds `slot` (the `<ViabilityMapLoader …/>` element) **only when** `mapTileConfig() !== null`, `dashboard.map.kind === "ok"` and the map has at least one pin, so the key reaches the browser only for a key holder whose presbytery has a pin. `DashboardView` gains a `mapSlot` prop and renders `<DashboardMap>` between the cards grid and `DashboardViabilitySection`. `src/components/` never imports from `src/app/`: the client element arrives as a prop.

**Display rules (`DashboardMap`)**

| Condition | Renders |
|---|---|
| `map.kind` is `off` or `locked`, or the viability list is not `ok` | nothing (no mention of a map; the fallback copy promises "the list below", so no list means no map section) |
| `map.kind === "error"` | heading, `MAP_COPY.readError`, retry link. **Never** the empty state |
| `ok`, zero pins | heading and the empty block (Flow 2); no loader element, no tile URL in the page |
| `ok`, at least one pin | heading, intro, the client slot, the caption, and the "Not on the map" list when `unplaced` is non-empty |

**Client island** (exactly two `'use client'` files, plus one pure helper with no directive)
- `insights/map-support.ts` (no `leaflet` import, jsdom-testable): `pinNode(pin): HTMLElement`, `popupNode(pin): HTMLElement`, `frameFor(pins)`, `shouldCollapse({ errors, loaded })`, and the constants `TILE_ERROR_LIMIT = 3`, `TILE_WAIT_MS = 10_000`, `SINGLE_PIN_ZOOM = 10`, `FIT_MAX_ZOOM = 12`, `MIN_ZOOM = 2`, `MAX_ZOOM = 18`. Built from `document.createElement` and `textContent` only. `popupNode` sets the link `href` only if it matches `^/o/[a-z0-9-]+/admin/oversight/[0-9a-f-]{36}$` (defence in depth over the server-built href). It avoids `.update(`, `.delete(`, `.get("next")` and `Number(`, because the insights directory is scanned for writes, redirect parameters and loose number parsing.
- `insights/map.tsx` (`'use client'`, the **only** importer of `leaflet`, `leaflet/dist/leaflet.css` and `./map.css`): `L.map(el, { attributionControl: false, scrollWheelZoom: false, dragging: !coarse, touchZoom: true, keyboard: true, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, zoomAnimation: !reduced, markerZoomAnimation: !reduced })`, where `coarse = matchMedia("(pointer: coarse)").matches` and `reduced = matchMedia("(prefers-reduced-motion: reduce)").matches`; `L.tileLayer(tileUrl, { minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM })` (no `crossOrigin`: nothing reads pixels, and the Referer-only request is the one verified above); one `L.marker` per pin with `L.divIcon({ html: pinNode(pin), iconSize: [44, 44], iconAnchor: [22, 22], className: "presby-pin" })` and `bindPopup(popupNode(pin))`; framing from `frameFor`; `tileerror`/`tileload` counters plus a `TILE_WAIT_MS` timer feed `shouldCollapse`; on collapse it removes the map and renders `MAP_COPY.tilesError`; the effect cleanup calls `map.remove()` and clears the timer. It renders, inside one bordered `rounded-lg` frame, the `isolate` map container (`h-72`, 18rem), then the legend (React, glyph and words per `MAP_COPY.legend`), then the attribution bar (React anchors, `rel="noopener noreferrer"`, MapTiler logo, below). The region has `role="region"` and `aria-label={MAP_COPY.regionLabel}`.
- `insights/map-loader.tsx` (`'use client'`): `next/dynamic` with `ssr: false` and a `loading` skeleton of the same height as the map (`h-72` plus a reserve for the legend and attribution rows), inside an error boundary. A chunk that fails to load, or a Leaflet exception, would otherwise reach `[slug]/error.tsx` and replace the whole page, taking the list with it; the boundary renders `MAP_COPY.tilesError` instead.
- `insights/map.css`: every selector rooted at `.presby-map` (two-class specificity beats `leaflet.css` whatever the load order). Popup wrapper and tip use `var(--background)`/`var(--foreground)`, links `var(--primary)`; the zoom buttons are 44px; pin shapes are CSS classes keyed on score and use the same tokens `ViabilityBadge` uses (`--destructive` for at risk, `--secondary` with a `--border` ring for fair, `--primary` for healthy, `--background` with a dashed `--border` ring for not yet assessed), so colour is never the only signal. Nothing goes into `globals.css`.

**Edit form** (`oversight/[aboutOrgId]/`): `oversight-schema.ts` keeps the two field-level messages ("Must be a number", "Must be between -90 and 90", and the longitude pair; the golden test pins them) but parses through `parseCoordinateField` (so `1e5` and `39,9` are now "Must be a number") and adds one object-level refinement over `validateCoordinatePair` for the two pair rules, attaching `halfSet` to the blank field and `zeroZero` to latitude. `edit-form.tsx` makes both inputs `type="text"` (a number input discards a pasted pair), `autoComplete="off"`, `spellCheck={false}`, **no `inputMode`** (the iOS decimal keypad has no minus key and a US longitude is negative), converts with `parseCoordinateField` instead of `Number(`, adds an `onPaste` handler on both boxes that calls `splitPastedPair`, and on a split calls `preventDefault()` and `form.setValue` for both fields with `shouldDirty` and `shouldValidate`. The `onSubmit` success path keeps `toast.success("Oversight record saved.")` and adds a `description` when the saved pair is a location and the new `mapOn` prop is true. `page.tsx` (`[aboutOrgId]`) computes `mapOn = (await isFlagEnabled(INSIGHTS_FLAG)) && mapTileConfig() !== null` after its existing gates and passes it down. The form is already inside `<HydrationGate>`; `check:hydration-gate` is unaffected.

## Data Model

No schema changes required. No migration (0089 stays free), no `CHECK` (the reader is the authority whatever the column holds, and the analyst and architect agree), no index, no seed change. `congregation_oversight.latitude` and `.longitude` stay unconstrained `numeric`, so `'NaN'` and `'Infinity'` remain storable by a path that skips the action; `parseCoordinateField` rejects both, which is why the reader never trusts the column. `scripts/seed-dev.sql` already carries two valid pairs (41.2033/-77.1945 and 41.3512/-77.0209) and no constraint is added that could refuse them.

## Component / Page Plan

**Create**
- `src/lib/coordinates.ts`, `src/lib/coordinates.test.ts`
- `src/lib/presbytery-reports/map-config.ts`, `map-derive.ts`, `viability-map.ts`, each with a `.test.ts`
- `src/components/presbytery-reports/dashboard-map.tsx`
- `src/app/(org)/o/[slug]/admin/insights/map-loader.tsx`, `map.tsx`, `map-support.ts`, `map.css`
- `scripts/check-deps-drift.test.mjs`
- `e2e/presbytery-map/map.spec.ts` (a 1x1 PNG buffer is inlined; no helper file)

**Modify**
- `src/lib/presbytery.ts` (the write), `src/lib/presbytery-reports/dashboard.ts` (the sixth entry; its header comment, which says "one transaction per held reader plus one for the roster", also names the map), `copy.ts` (`MAP_COPY`, `allCopyStrings`)
- `src/components/presbytery-reports/dashboard-cards.tsx` (the `mapSlot` prop and the `DashboardMap` placement)
- `src/app/(org)/o/[slug]/admin/insights/page.tsx` (calls `mapTileConfig`, passes `options.map`, builds the slot; its header comment gains the map)
- `src/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/page.tsx`, `edit-form.tsx` (its header comment at `:36-41`, which says nothing renders a map, is rewritten), `oversight-schema.ts`
- `next.config.ts` (one `img-src` host, `:62`), `.env.example` (a documented, empty `NEXT_PUBLIC_MAPTILER_KEY=` block beside Turnstile's at `:140-147`: public, origin-restricted, blank means no map, Vercel previews get the fallback)
- `package.json` and `package-lock.json` (`leaflet@~1.9.4`, dev `@types/leaflet@~1.9.22`; a `test:e2e:map` script), `scripts/check-deps-drift.mjs` (refactor plus rules 4 to 6), `playwright.config.ts` (the `PW_MAP` lane), `.github/workflows/e2e.yml` (one step, `npm run test:e2e:map`)
- `src/lib/presbytery-reports/boundaries.test.ts`; existing tests listed under Edge Cases
- `src/content/help/presbytery-reports.md`, `src/content/help/privacy-policy.md`, `src/lib/help/registry.ts`
- Not by the implementer (Rule 16 shared files, orchestrator at integration): `docs/TODO.md`, `docs/STATE.md`, `scripts/seed-dev.sql`, `scripts/test-rls.sql`, `e2e/support/*`. This design needs no change to any of them.

**Help pages to edit:** `presbytery-reports` and `privacy-policy` (the Copy rows below feed them); see Help impact.

## Implementation Order

0. **Build smoke, before anything else.** `npm i leaflet@~1.9.4 && npm i -D @types/leaflet@~1.9.22`; a trivial `map.tsx` that imports `leaflet`, `leaflet/dist/leaflet.css` and a one-line `map.css`, and calls `L.map` in an effect; a `map-loader.tsx` that `next/dynamic`s it with `ssr: false`; `next build` (Turbopack); then load the page in dev once. Also run `npm audit` and `node scripts/ci/audit-prod.mjs`, and note the lazy chunk's size. **If the build fails, stop and return to Phase 3**: nothing else is worth building on a library the bundler cannot take. (This repo has had Turbopack-only build breaks before.) Decide here whether `import L from "leaflet"` or `import * as L from "leaflet"` types and bundles cleanly (`esModuleInterop` is on).
1. `src/lib/coordinates.ts` and its test; then the write in `presbytery.ts`, `oversight-schema.ts` (and its golden test), `edit-form.tsx`, the `[aboutOrgId]` page and their tests. No server-action change.
2. `map-config.ts`, the `next.config.ts` host, `.env.example`, and the CSP and config tests.
3. `map-derive.ts`, `viability-map.ts`, the `dashboard.ts` sixth entry and tests.
4. `MAP_COPY` in `copy.ts` and its tests.
5. `map-support.ts`, `map.css`, `map.tsx`, `map-loader.tsx` and their tests.
6. `dashboard-map.tsx`, the `dashboard-cards.tsx` slot, the page, and tests.
7. `check-deps-drift.mjs` refactor with rules 4 to 6 and its fixture test; the `boundaries.test.ts` rules.
8. e2e: the `PW_MAP` lane, the new spec, and the new cases in `presbytery-oversight.spec.ts`.
9. Help pages, registry, and the help tests.
10. `npm run check` (all ten tripwires), typecheck, lint, the unit suite; then the browser walk on port 3101 with the real key: cold-load on `next build && next start` (CSS splits differently from dev; the tell-tale of a CSS miss is tiles stacked in a column), 360px and desktop, light and dark, the one-pin, several-pin and zero-pin states, a popup, the phone menu over the map, one-finger scroll past the map, the oversight form on a phone viewport. The existing `presbytery-dashboard.spec.ts` runs twice, once with the key set and once with it blank.
11. Audit events: none (see Edge Cases). Release notes at ship (`/release-notes`), and the housekeeping cluster below.

**Housekeeping at ship (orchestrator, same commit cluster):** release notes; `docs/product/functionality-map.md:29` ("The viability map is a later increment" is false after this ships); `docs/architecture.md:33` (lists the viability map under "Not yet built"; a pin map plus a third-party tile call is genuinely architectural, so Rule 15 applies: move it out of "Not yet built" and say in one sentence that a presbytery's map is the one place a browser contacts a mapping provider); the slice-two TODO line to Done, plus a new follow-up line for the production walk and the operator's plan-terms confirmation; `verifiedIn` on both help pages only after the Phase 6 walk.

## Carry-forward

| Phase 1 gap / Phase 2 ruling | Addressed here (where), or *deferred* (who accepted) |
|---|---|
| **P1 G1** Entry copy false after ship; legend, hints, registry labels | Copy › Oversight form; Component plan › `edit-form.tsx` header comment; Help impact (labels). Test: `edit-form` render test asserts the legend "Map location" and both hints; `coverage`/`check:help` for labels. |
| **P1 G2** Server accepts NaN, strings, half-set | API Contract › `validateCoordinatePair` in `setCongregationOversight`. Tests: `presbytery.test.ts` (new unit cases, no DB: `NaN`, `Infinity`, `"39.9"`, one blank, 0/0, a valid pair, both blank, each returning before `withOrgContext`), `coordinates.test.ts`. |
| **P1 G2** Reader never trusts the column; no CHECK, no 0089 | `deriveViabilityMap` over `parseCoordinateField`; Data Model. Tests: `map-derive.test.ts` (`"NaN"`, `"Infinity"`, `""`, a half-set row, `"1e5"`, out-of-range, 0/0 each land in `unplaced`). |
| **P1 G2 ruling** Paste-split kept | Orchestrator ruling 3; `splitPastedPair` and the `onPaste` handler. Tests: `coordinates.test.ts` (table: Google, Apple and parenthesised forms, degree signs, a single number, three numbers, a sentence, an empty string), an `edit-form` jsdom test (a paste event fills both boxes and shows the status line; an ordinary paste is not intercepted), and the e2e case below. |
| **P1 G3 / P2 note 7** 0/0 | Orchestrator ruling 1: refused at the write (copy below), and the reader still treats a stored 0/0 as unplaced (a legacy row). Tests: `coordinates.test.ts`, `presbytery.test.ts`, `map-derive.test.ts`. |
| **P1 G3** No regional plausibility check | None added, by design: a sign error shows as a pin in another country and the clerk sees it. Edge Cases says so. |
| **P1 G4** Framing: one pin, several pins, zero pins | `frameFor` (one pin: centre at zoom 10; several: bounds, padding 32, max zoom 12, min zoom 2); zero pins: Flow 2, no map. Tests: `map-support.test.ts` (one, two, a far-apart pair, a pair spanning the antimeridian is *unverified*: Leaflet bounds do not wrap, so a pin at 179 and one at -179 frame the whole world; accepted, min zoom 2 keeps the frame sane). |
| **P1 G5 / P2 note 3** Popups are text DOM nodes; no HTML strings; pins are `divIcon`s of DOM nodes; markers not `circleMarker`; link only when the oversight flag is on; href from slug and id | `map-support.ts`; `toClientPins`. Tests: `map-support.test.ts` (a name of `<img src=x onerror=alert(1)>` renders as text, no `img` element in the popup or the pin, `popupNode` ignores an href that is not the oversight pattern, no link when `href` is null); `boundaries.test.ts` (client-file bans: `.innerHTML`, `insertAdjacentHTML`, `bindTooltip`, `circleMarker`, `L.icon(`, `iconUrl`, `attribution:`; `bindPopup(` only with `popupNode(`; `html:` only with `pinNode(`). |
| **P1 G6 / P2 note 1** Own reader, own transaction, live key, roster first, no widening of other readers, six fields only | `viability-map.ts` (sibling, not folded in); `dashboard.ts` sixth entry. Tests: `viability-map.test.ts` (key checked before any read; forbidden → `forbidden` and the roster getter uncalled; exactly four columns selected, asserted by a source scan); `dashboard.test.ts` (reader uncalled when `options.map` is false, uncalled when the viability key is not held, started together with the others, a rejection is `error` and the cards still render, `OrgAccessError` rethrown, `forbidden` is `locked`); `boundaries.test.ts` (among `moduleFiles` only `viability-map.ts` and `map-derive.ts` name `latitude` or `longitude` (the architect named `viability-map.ts` alone; `map-derive.ts` needs the field name for its `MapFact` input); `viability.ts`, `csv.ts`, `audit.ts` never do). Pin payload: `map-derive.test.ts` (`Object.keys` of a client pin is exactly the seven). |
| **P1 G7** Touch, wheel, stacking | `dragging: !coarse`, `scrollWheelZoom: false`, `isolate`, 44px zoom buttons, popups in theme tokens. Tests: e2e one-finger scroll at 360px and phone-menu-over-map (below); `boundaries.test.ts` pins the options string `scrollWheelZoom: false`. *Unverified* until Phase 4: whether CDP `Input.synthesizeScrollGesture` drives a one-finger swipe reliably under Playwright; if not, Phase 4 records a device-emulation walk and asks for a ruling rather than dropping the case. |
| **P1 G8 / P2 note 5** CSP: one named `img-src` host, no wildcard, `connect-src` unchanged; Referrer-Policy unchanged | `next.config.ts` literal `https://api.maptiler.com`. Tests: `map-config.test.ts` (new `loadHeaders` pattern from `giving/csp.test.ts`): the real `img-src` equals `'self' data: https://lh3.googleusercontent.com https://api.maptiler.com`, `connect-src` is `'self'`, no `*`, and `mapTileConfig({ NEXT_PUBLIC_MAPTILER_KEY: "fake-key-value" }).tileUrl` starts with `MAP_TILE_ORIGIN + "/"` and contains no `{s}`, slug, name or id; the `Referrer-Policy` of the catch-all entry is `strict-origin-when-cross-origin`. The e2e intercept confirms the request host. |
| **P1 G8** Key is public, never a server call, `.env.example` documented, `check:secrets` clean | `mapTileConfig`; `.env.example`; the e2e fake value carries `// leak-ok`. `npm run check` is the proof. |
| **P1 G8** Attribution as real links with `rel` | `map.tsx` React anchors and logo (Copy). Test: `map-loader`/`map` jsdom render of the attribution bar (hrefs and `rel`). Orchestrator ruling 2: logo always shown. |
| **P1 G9 / P2 deps** `leaflet@~1.9.4`, `@types/leaflet@~1.9.22`, loader plus `map.tsx` | Implementation Order 0; `check-deps-drift` rules 4 to 6 with `scripts/check-deps-drift.test.mjs` (a failing sample for every rule, old and new, plus the legal neighbours that must not fire: `leaflet-draw` is not `leaflet`; a comment naming `leaflet` is not an import; a type-only import elsewhere fails). |
| **P1 G10** Accessibility | `role="region"` plus `aria-label`; pins are focusable role-button markers whose accessible name comes from visually hidden text (`name, rating`); shape plus legend in words; the "Not on the map" list is the text alternative. Tests: e2e Tab to a pin and Enter opens the popup (name from content: *unverified* until Phase 4); `map-support.test.ts` (the pin node contains the name and the rating as text). |
| **P1 G11** Third-party disclosure, usage, plan terms | Help › `privacy-policy` (exact text below). **Open Question 1 (does the plan permit a nonprofit portal; is the quota enough): *deferred* to the operator, who provisioned the key; recorded as a TODO follow-up. Default taken: proceed. Over quota, tiles error and the fallback appears (pinned by the tile-failure e2e).** |
| **P1 G12** No audit | Edge Cases; `boundaries.test.ts` (`noRecordAudit` and `noWrites` over the insights directory and the module, unchanged, now covering the new files by the walk). |
| **P1 G13** Test environment: fake key and intercepted tiles; own cleanup | `PW_MAP` lane with its own server and a fake key; the spec stages and restores its own rows. |
| **P1 Flow 2** Zero pins is the common first state | `DashboardMap` empty block. Test: `dashboard-views.test.tsx` (link only with the oversight flag; with it off the sentence naming the page is replaced). |
| **P1 Flow 3 / P2 note 2** Key unset: no section, no mention, no read | `options.map` false → `off`. Tests: `dashboard.test.ts`, `page.test.tsx` (key absent: no loader element, no heading, `getViabilityMap` uncalled), `dashboard-views.test.tsx` (`off` renders nothing). |
| **P1 Flow 4** Stated clerk: locked, key never reaches the client | Same gate; e2e (`org-multi`: no "Congregation map", no staged latitude string in `page.content()`, no request to `api.maptiler.com`). |
| **P1 Flow 7** Phone at 360px | e2e (overflow, cards, one-finger scroll). |
| **P1 Out of scope** Geocoding, clustering, layers, a preview on the oversight page, vector tiles, an import tool, other org types, widening origins, a CSV or audit | Honoured; see Out of Scope below. |
| **P1 Open Q2** Previews | Orchestrator ruling 4. Previews show the fallback (verified: wrong Referer is 403). |
| **P2 note 1** Sibling reader; the sixth `allSettled` entry only when held and keyed; `map` beside `cards`; shown only when both are ok; failure is "could not load", never "no location"; one-load race named | API Contract; Display rules; Edge Cases (the race). |
| **P2 note 2** Key read on the server, passed as a prop; the loader element exists only for key, `ok` and at least one pin; `.env.example` | API Contract (`mapTileConfig`, the page builds the slot); Component plan. Tests as P1 Flow 3. e2e for Flow 3 is unit-only, by the architect's ruling (no second e2e server). |
| **P2 note 3** Exact tripwire files and the boundaries rules | Fully specified in the API Contract (client island) and the rules listed under P1 G5 and G6; the two `'use client'` files in the insights directory are exactly `map-loader.tsx` and `map.tsx` (`map-support.ts` has no directive); `next/dynamic` only in `map-loader.tsx` with `ssr: false`; nothing imports `./map` statically; client files may not contain `process.env`, `MAPTILER`, `fetch(`, `XMLHttpRequest`, `@/lib/db`, `@/auth`, `next/headers` or an `actions` import. |
| **P2 note 4** Attribution and logo as React, `attributionControl: false`, logo ruling | API Contract (`map.tsx`); orchestrator ruling 2; `boundaries.test.ts` bans `attribution:`. |
| **P2 note 5** The `img-src` host and style id | `streets-v4`, 256-pixel PNG, verified live. |
| **P2 note 6** CSS only in `map.tsx`; build smoke first; `npm audit` recorded | Implementation Order 0 and 10; `map.css` roots. |
| **P2 note 7** The form belongs in this increment | Orchestrator rulings 1 and 3; API Contract. |
| **P2 note 8** Slice-one pins kept; `strict-params` | `exportFunctionNames` stays four (no `export*` in the new files); no `Number(`, `parseInt(` or `parseFloat(` anywhere in the insights directory (parsing lives in `coordinates.ts`). |
| **P2 observation** `presby_app` holds `DELETE` on `congregation_oversight` | Out of scope here; *deferred* to the monthly security review (architect; accepted by the orchestrator as a note). |
| **Architect's DECISION-343** | Written to `docs/decisions.md` with the adjustments named under "Rulings applied" and below. |

## Edge Cases & Risks

**E2E blast radius (existing specs).**
- `e2e/presbytery-dashboard.spec.ts` asserts `getByRole("heading", { name: "Member congregations" })`, `{ name: "Viability" }` and `{ name: "Vacant pulpits" }`. Playwright's `name` matches a substring, case-insensitively, so **no map heading or subheading may contain "member congregations", "viability", "vacant pulpits", "ending active members", "per capita" or "insights & analytics"**. The map heading is "Congregation map" and the other heading is "Not on the map"; `copy.test.ts` pins that none of `MAP_COPY`'s headings contains one of those phrases. Its case 4 asserts the `dashboard-viability` section has zero links with the oversight and reports flags off: the map is a **sibling** `<section data-testid="dashboard-map">`, not inside `dashboard-viability`, so the attribution and entry links cannot leak into that count. The local shared dev server loads `.env.local` and so has the real key, while CI has none; the e2e presbytery's congregations have no coordinates unless the map spec stages them, so the spec sees either the Flow 2 block (keyed) or nothing (keyless), and passes both ways. Phase 4 runs it both ways. No edit is expected.
- `e2e/presbytery-oversight.spec.ts` case 2 asserts the toast `/oversight record saved/i` and uses `#oversight-viability`, `#oversight-buildings`, `#oversight-insurance-*`. The toast title is unchanged and the description never contains that phrase; the latitude and longitude inputs change from `type="number"` to `type="text"` but keep their ids, and no existing e2e fills them. No edit is needed; new cases are added (below).
- `e2e/security-headers.spec.ts` and the custom-domain header specs assert header presence and the give-route directives, not `img-src`'s content (grep of `e2e` and `src` for `img-src` finds only `next.config.ts` and the community photo downscaler comment, which says `img-src 'self' data:` and `blob:` is absent; both stay true: `blob:` is still absent).
- Existing unit specs that change: `dashboard.test.ts` (new `map` field on every `ok` result; the `toEqual`-style assertions on the whole object need it), `dashboard-views.test.tsx` (its `view()` helper builds a dashboard without `map`; `map` becomes required, so the helper defaults it to `{ kind: "off" }`), `insights/page.test.tsx` (mocks `getPresbyteryDashboard`; add `map` to its fixtures and a `server-only` mock for `map-config`), `oversight/[aboutOrgId]/page.test.tsx` (the page now reads `isFlagEnabled("org_portal.insights")` and calls `mapTileConfig`; its `isFlagEnabled` mock is generic, add the `server-only` mock), `oversight-schema.golden.test.ts` (new cases; the four existing message pins must stay byte-identical), `boundaries.test.ts` (the "nothing in the dashboard directory is a client component" case is replaced, as its own text says it will be), `copy.test.ts`, `help-page.test.ts`, `coverage.test.ts` if label counts are pinned.

**New e2e, every flag named.** A new lane, `PW_MAP=1` (`npm run test:e2e:map`), modelled on the contact lane: the config starts its own dev server (`npx next dev -p <port of E2E_BASE_URL>`, `reuseExistingServer: false`) with `NEXT_PUBLIC_MAPTILER_KEY` set to a fake value (annotated `// leak-ok`), because setting a key on the shared server would turn the map on for every spec and a reused keyless server could never prove it. The `chromium` project ignores `e2e/presbytery-map/`; the `map` project is included only on the flag; the standard `globalSetup` signs the users in. `.github/workflows/e2e.yml` gets one step after the contact lane. `e2e/presbytery-map/map.spec.ts` sets its own flags through `e2e/support/flags.ts` (`captureFlags`/`setFlag`, restored in `afterAll`): `org_portal.insights` (true; the CI reset file seeds it false), `org_portal.oversight` (true, false in one case). It adds nothing to `scripts/ci/e2e-baseline-flags.sql`. It stages coordinates on the e2e presbytery's alpha and beta congregations (a platform-connection upsert into `congregation_oversight`, capturing and restoring each row's prior latitude, longitude and score, and deleting only a row it inserted; the oversight spec already leaves an alpha row), leaves gamma unplaced, and intercepts `https://api.maptiler.com/**` with a 1x1 PNG and the logo with an SVG. No `e2e/support/*` helper is added (the person-id range pre-assigned is not needed).
1. `presbytery-clerk` sees "Congregation map", the caption "2 of N congregations have a location." (N counted from the roster, not hard-coded), gamma under "Not on the map", and the legend; the intercepted tile requests go to `https://api.maptiler.com/maps/streets-v4/256/` and no tile URL contains the slug, an id or a congregation name; the attribution links and the logo link have the right hrefs and `rel`.
2. Tab to a pin and Enter opens a popup with the name and rating; "Open oversight page" is present with the oversight flag on and absent with it off.
3. With no staged coordinates the section says "No congregation has a usable location yet." and **no request to `api.maptiler.com` is made** (the key is not in the page).
4. Every tile answers 403: the map collapses to `MAP_COPY.tilesError` and the viability list still renders.
5. `org-multi` (statistics only) sees no "Congregation map", the staged latitude string is not in `page.content()`, and no request goes to `api.maptiler.com`.
6. At 360px (touch context): no horizontal overflow; a one-finger vertical swipe over the map scrolls the page; opening the phone menu shows it above the map (`document.elementFromPoint` inside both is the menu).
7. The loop: `presbytery-clerk` enters a pair on the oversight form, sees the toast description, opens Insights and finds the pin.

**New cases in `e2e/presbytery-oversight.spec.ts`** (shared dev lane, no key needed; flag `org_portal.oversight`, already set by the spec): latitude alone is refused inline with the half-set sentence; "0" and "0" is refused with the 0/0 sentence; a synthetic paste event of "39.9612, -82.9988" into the latitude box fills both; a valid save stores the pair (read back through the platform connection) and the case restores the row's coordinates to null.

**Other cases**
- **Read-only, no audit, no export, no CSV.** The map read writes nothing and records no audit event; DECISION-339 audits exports only. The coordinate *write* already records `CONGREGATION_OVERSIGHT_SET` (viability score only; coordinates never enter audit metadata, the CSV, a URL or a title). Pinned: `boundaries.test.ts` (`noWrites`, `noRecordAudit`, `exportFunctionNames`).
- **The one-load count race (accepted).** The viability list and the map are separate reads in separate transactions (the architect's ruling, so a failed map cannot take the list down). A congregation joining or leaving between them can make the list and the map's "N of M" differ by one for one page load; the caption, the pins and "Not on the map" come from one read, so they always agree with each other. Unverified (no test: it needs a mid-request roster change).
- **Previews show the fallback, not tiles.** The key is restricted to presbyportal.org, www and localhost; a `*.vercel.app` Referer is 403 (verified). The page shows `MAP_COPY.tilesError` there, which is expected behaviour, not a defect, and is named here so a preview walk does not file it as one. Real tiles are walked on localhost, then once on presbyportal.org after deploy (a tracked follow-up; the Phase 6 verdict is capped at SHIP WITH NOTES until then, as the TODO line already says).
- **Tile health.** `shouldCollapse` needs 3 `tileerror` events with 0 `tileload` events, or no `tileload` within 10 seconds; one transient error never collapses a working map. Pinned: `map-support.test.ts`.
- **A chunk or Leaflet failure** is caught by the loader's error boundary and renders `tilesError`, so it never reaches `[slug]/error.tsx` (which would replace the whole page). Pinned: a jsdom test with a throwing child.
- **Over the free quota** tiles error and the fallback appears (the same path). Unverified against the real quota.
- **A wrong sign** (a US longitude entered positive) draws a pin in another country. By design: no regional plausibility check, so a presbytery outside the continental US is never wrongly hidden; the form hint and the help page both say a US longitude is negative.
- **Antimeridian.** Pins at 179 and -179 frame the whole world at minimum zoom. Accepted; unverified.
- **A congregation that closed or left** keeps its oversight row and can still have a location saved (`resolveMemberCongregation` does not filter on lifecycle; `readRoster` does), but never appears on the map or in "Not on the map". This is why the post-save note says "Congregations with a location are shown on the map…" and never "this congregation is on the map". Pinned: `viability-map.test.ts` (roster first).
- **Legacy bad rows** (a half-set pair, `'NaN'`, an imported row) are unplaced, counted in "Not on the map", and the oversight form shows the stored value so the clerk can fix it. Saving a half-set row unchanged is refused with the half-set sentence. Pinned: `map-derive.test.ts`, `edit-form` test.
- **iOS keypad.** The coordinate boxes use no `inputMode`, because the iOS decimal keypad has no minus key. Unverified on a real device (Phase 4 checks a 360px emulation only; the operator's phone is the real test).
- **Layout shift.** The skeleton reserves the map's height plus a fixed reserve for the legend and attribution rows; the exact heights depend on wrapping at 360px, so a few pixels of shift below the map can occur once. Unverified; accepted.
- **Dark scheme.** The tiles are a light basemap in both schemes; the popups, legend and attribution use theme tokens. Unverified until the Phase 4 walk.
- **Reduced motion** turns Leaflet's zoom and marker animations off. Unverified beyond the option string.
- **Brand scope.** `(org)` is already brandable and no emitter is added; `check:brand-scope` is unchanged. The healthy pin uses `--primary`, so it takes the congregation-brand colour the same way the `Healthy` badge does; the shape, not the colour, is what carries the rating.
- **2FA mid-enrolment** is unchanged: the gate's recheck redirects to `/totp` with the page's own path (slice one's test).
- **Pool pressure** rises from five to six transactions per page view for a keyed viability holder only. Unverified under load; accepted.
- **Proxy and CSP.** The proxy is untouched. The give routes enforce the same string, so `api.maptiler.com` also becomes a permitted image origin there. Accepted by the architect: images do not execute, and `check:giving-boundaries` B7 governs script, frame and form directives, not `img-src`.

## Copy

Every string below is new or changed. The map's strings go in `copy.ts` as `MAP_COPY` (import-free, so the client files may import it; `allCopyStrings()` walks it and `copy.test.ts` already bans two-factor language, "don't have permission to manage" and the `check:help` future-tense phrases). The coordinate messages live in `coordinates.ts` because the write, the form and the reader share them; the form's labels and hints stay inline in `edit-form.tsx` like its other strings. Each existing string that is reused is reused by name.

**Map section (`MAP_COPY`)**

| Key | String |
|---|---|
| `title` (h2; not a substring of any existing heading) | Congregation map |
| `intro(org)` | Each pin is a member congregation of {org} that has a location. Its shape shows its viability rating. The viability list below names every congregation. |
| `regionLabel` (aria-label) | Map of congregations that have a location. The viability list below gives the same ratings as text. |
| `caption(placed, total)` | {placed} of {total} {congregation/congregations} {has/have} a location. (1 of 12 congregations has a location. 2 of 12 congregations have a location. 1 of 1 congregation has a location.) |
| `legend.heading` | Pin shapes |
| `legend.items` | At risk: diamond / Fair: square / Healthy: circle / Not yet assessed: hollow circle (the labels equal `VIABILITY_LABELS` and `VIABILITY_NOT_ASSESSED`, pinned by a test) |
| `popup.rating(label)` | Viability: {label} |
| `popup.open` | Open oversight page |
| `unplaced.heading` | Not on the map |
| `unplaced.intro` | These congregations have no usable location. |
| `unplaced.entry` (oversight flag on) | Open a congregation to enter its latitude and longitude. Latitude comes first. |
| `oversightOff(org)` (oversight flag off, used by the empty block and the unplaced list) | Locations are entered on Congregation Oversight, which isn't turned on for {org} yet. |
| `empty.title` | No congregation has a usable location yet. |
| `empty.entry` (oversight flag on) | Add a latitude and longitude on a congregation's Congregation Oversight page. Latitude comes first. |
| `empty.link` (oversight flag on) | reuse `VIABILITY_COPY.assessLink`: Open Congregation Oversight (links to `/o/<slug>/admin/oversight`) |
| `readError` (the map read failed; with the retry link, `FRAME_COPY.retry`: Try again) | We couldn't load the map. The list below has every congregation. |
| `tilesError` (tiles, chunk or script failed; no retry control) | The map could not load. The list below has every congregation. Reload the page to try again. |
| `loading` | Loading the map… |
| `attribution` | © MapTiler (links to `https://www.maptiler.com/copyright/`) / © OpenStreetMap contributors (links to `https://www.openstreetmap.org/copyright`) / the MapTiler logo, alt "MapTiler logo" (image `https://api.maptiler.com/resources/logo.svg`, links to `https://www.maptiler.com/`) |
| Zoom buttons | Leaflet's own "Zoom in" and "Zoom out" titles, unchanged |

**Oversight form and server**

| Where | String |
|---|---|
| Legend (replaces "Map coordinates (for a future viability map)") | Map location |
| Line under the legend | Optional. Enter both numbers, or leave both blank. To fill both at once, paste a pair such as 39.9612, -82.9988 into either box. |
| Latitude label, hint | Latitude / Decimal degrees between -90 and 90, for example 39.9612. Enter this first. |
| Longitude label, hint | Longitude / Decimal degrees between -180 and 180. Congregations in the United States have a negative longitude, for example -82.9988. |
| After a split (a `role="status"` line) | Filled latitude and longitude from the pasted pair. Check them before you save. |
| Client errors, kept | Must be a number / Must be between -90 and 90 / Must be between -180 and 180 |
| Client and server, new | `halfSet`: Enter both latitude and longitude, or leave both blank. `zeroZero`: 0 and 0 is a point in the ocean, not a congregation. Enter its real latitude and longitude, or leave both blank. |
| Server, new | Latitude must be a number. / Longitude must be a number. (the two range messages are the existing strings) |
| Save toast | title unchanged: Oversight record saved. New description, only when the saved pair is a location and `mapOn`: Congregations with a location are shown on the map in Insights & Analytics. |

The example pair is a published city-centre point, not a congregation or an address.

**The four checks, one line per string group**

1. *Residuals.* None of these strings touches an accepted residual in CLAUDE.md (the revoke-then-designate chain, the email-edit chain, the self-recorded Session approver, the two wildcard exceptions, the platform-admin lockout recovery). The oversight form's strings and the map's strings deny nothing a Phase 2 ruling or a residual admits; the one near-residual is the "no regional plausibility check", which the hint states rather than hides (a wrong sign shows as a wrong place). `copy.test.ts` keeps the three bans.
2. *Source of truth.* **Caption, pins and "Not on the map"**: `readViabilityMap`, one transaction: the count M is `readRoster` (parent is this presbytery, type `congregation`, lifecycle `active`); a pin exists only when `mappablePair` accepts the row's two parsed columns, so "have a location" means a usable pair, and the unplaced list says "no *usable* location" because the query reads the column, not the clerk's intent (a stored `'NaN'` or half-set row is unplaced). The caption says "have a location", not "are on the map", because the caption is rendered by the server and the map by the browser: if tiles fail the caption stays true. **Rating text** (popup, legend, pin name): `VIABILITY_LABELS` through `deriveViabilityMap`, from `congregation_oversight.viability_score`. **"The list below has every congregation"**: `readViability` over the same roster; the one-load race is named in Edge Cases, and the section is not shown when the list failed. **"Congregations with a location are shown on the map in Insights & Analytics"** (toast): true for a rostered congregation when the insights flag is on and a tile key is set, which is exactly `mapOn`; it is worded as a rule, not about this congregation, because the write does not check the roster's lifecycle filter. **Empty block with the oversight flag off**: the flag read is the bare `isFlagEnabled("org_portal.oversight")`. **Tile and read errors**: the strings name no cause, because the browser cannot tell quota from a blocked network from a 403.
3. *Audience.* The map section, "Not on the map", the popup and the empty block are seen only by a `congregation_oversight.manage` holder (the read is not run otherwise). That same key opens `/o/<slug>/admin/oversight` and edits the form, so "Open a congregation to enter its latitude and longitude" and "Open oversight page" are things the viewer can do; both are shown only with `org_portal.oversight` on, and with it off the viewer is told which page holds the entry and that it is off, with no instruction to use it. "Reload the page to try again" is for any viewer. The form's strings are seen by the same key. The toast description is seen by the same key, after a successful write.
4. *Neighbours.* Grepped the live tree for map, coordinates, latitude, longitude, location, pin, viability and insights. Made stale, each a modify target: `src/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/edit-form.tsx:174` (the legend) and `:36-41` (the comment "nothing yet renders a map"); `docs/product/functionality-map.md:29` ("The viability map is a later increment"); `docs/architecture.md:33` (viability map under "Not yet built"); `src/lib/presbytery-reports/dashboard.ts` header ("one transaction per held reader plus one for the roster"); `src/app/(org)/o/[slug]/admin/insights/page.tsx` header (names four cards and the viability list). Checked and **not** stale: `src/content/help/presbytery-reports.md:64` ("It holds no email addresses, street addresses, coordinates or people's names": the CSV still reads no coordinates, pinned by `boundaries.test.ts`); `src/lib/presbytery-reports/viability.ts:17` ("coordinates are never read": still true of `readViability`); `src/lib/db/domain/presbytery.ts:59-62`; `src/lib/presbytery-reports/copy.ts` `DASHBOARD_COPY.subtitle` and `HUB_COPY.cards.viability.description` (neither promises the page has no map); `first-day-as-administrator` (the "Insights & Analytics only describes an idea" sentence is about congregations and stays true); `docs/product/functionality-map.md` index line for presbyteries (read at ship).

## Help impact

Two pages, both edited as `published` in the same PR (ordinary case: no `pending`, no token, no `limitationUntil`). The implementer writes the prose from the screens, not from this draft; where a screen differs, the screen wins and Phase 5 reads the diff. `verifiedIn` stays `0.59.0` until the Phase 6 walk moves it.

**`presbytery-reports` (edit).** Registry entry: `anchors` gain `the-viability-map` and `putting-a-congregation-on-the-map` (confirm each against `src/lib/help/headings.ts`, which derives ids from the heading text); `summary` ends "…and a summary page with a map."; `labels` gain "Congregation map", "Not on the map", "Open oversight page", "Map location", "Latitude", "Longitude", "Save", "At risk", "Fair", "Healthy" and "The map could not load" (each is on screen; `check:help` verifies); the `needs.who` line is unchanged (still presbytery staff; the map needs the oversight permission, said in the section). A test in `help-page.test.ts` pins that both new sections exist and that the map section names the oversight permission phrase from `REPORTS`. Add after the Insights section, before "Vacant pulpits":

> ## The viability map
>
> Above the viability list, a section headed "Congregation map" shows your member congregations as pins. You need the permission to manage congregation oversight to see it. Without that permission the Viability section says "Locked" and there is no map.
>
> Each pin is a member congregation that has a location, and its shape shows its rating: a diamond for "At risk", a square for "Fair", a circle for "Healthy" and a hollow circle for "Not yet assessed". A line under the map says how many congregations have a location, for example "2 of 12 congregations have a location."
>
> Choose a pin to see the congregation's name and rating. Where "Congregation Oversight" is turned on, the pin also has an "Open oversight page" link. On a computer, drag the map to move it and use the + and - buttons to zoom. On a phone or tablet, one finger scrolls the page past the map; use two fingers to move or zoom the map, or use the + and - buttons. The viability list below the map names every congregation with the same ratings, so you can read the page without the map.
>
> Congregations with no usable location are listed under "Not on the map". If none has a location, the section says so instead of showing a map. If the map cannot load, the section says "The map could not load" and the list below still works.
>
> The map pictures come from MapTiler and are credited to MapTiler and OpenStreetMap contributors under the map. Your browser asks MapTiler for them directly while the map is showing. See the [Privacy policy](/help/privacy-policy).
>
> If you can open the Viability section, it shows no error, and there is no map section above it, the map is not switched on for PresbyPortal. [Contact the team](/help/contact) if you need it.

Add after "Viability", before "Per capita":

> ## Putting a congregation on the map
>
> A congregation appears on the map when it has a location on "Congregation Oversight". You need the permission to manage congregation oversight.
>
> 1. Open "Congregation Oversight", then choose the congregation.
> 2. Under "Map location", enter the "Latitude" first. It is a decimal number between -90 and 90, for example 39.9612.
> 3. Enter the "Longitude". It is a decimal number between -180 and 180. A congregation in the United States has a negative longitude, for example -82.9988.
> 4. Choose "Save".
>
> Enter both numbers or neither. To copy them from a maps application, copy the pair of numbers it shows, for example 39.9612, -82.9988, and paste it into either box: both boxes fill themselves, and you should check them before you save. A latitude and longitude of 0 and 0 is refused, because it is a point in the ocean. If a pin lands in the wrong place, check the signs. To take a congregation off the map, clear both boxes and choose "Save".
>
> Where the map is turned on, open "Insights & Analytics" after you save to see the pin. A congregation that has left your presbytery or closed is not on the map, even with a location.

**`privacy-policy` (edit).** "Last updated" becomes the merge date (the date stamp is a pre-existing line; set it at integration). Add one bullet under "Other companies that handle information", after Cloudflare Turnstile:

> - **MapTiler** supplies the map pictures on the "Insights & Analytics" page of a presbytery, for people who can manage congregation oversight. While the map is showing, your browser asks MapTiler for the pictures directly, so MapTiler receives your IP address, browser details, the web address of the PresbyPortal site and the part of the map you are looking at. We send it no names, scores or records. The map credits OpenStreetMap contributors for its underlying map data.

Source: the tile URL is `z/x/y` plus the key (pinned by `map-config.test.ts`); the Referer carries only the origin because of the unchanged `strict-origin-when-cross-origin`. Registry `labels` stay empty (the page quotes no UI string); `covers` stays empty.

**No edit:** `roles-who-can-do-what` (re-read once at Phase 4: no role or bundle changes; the page has no per-permission table), `turning-features-on-and-off` (no toggle changes; the map is an environment key, not a toggle), `presbytery-tools` (a `planned` placeholder that says nothing of a map), `first-day-as-administrator` (read once; congregation-only sentence stays true). No screenshot: `npm run help:shots` would call a real tile server from a fixture database; skip. No new `[help:<token>]`. Phase 6 reads both edited pages at 360px against the shipped build with the real key on localhost.

## Out of Scope

Confirmed from Phase 1 and unchanged: geocoding from an address and any "find on the map" search (DECISION-120); clustering, heat layers, routing, layer switching, drawing; a map preview on the oversight edit page (it would put Leaflet in a second file and break the containment; the toast points to Insights instead); vector tiles, a custom MapTiler style, offline tiles; a coordinate import tool (the reader already tolerates empty and invalid values, and a later import should accept latitude and longitude columns); a map for congregation, synod or GA types; widening the key's allowed origins for previews; a new key, a new global flag, a per-organization toggle, a migration, a CSV or an audit event; adopting Leaflet 2.x; a per-request kill switch (remove the variable and redeploy, or turn `org_portal.insights` off). Added by this design: a `CHECK` on the numeric columns (the reader is the authority) and `react-leaflet` (rejected on license, DECISION-122).

## Implementer

**full-stack-developer.** There is no schema work, and the dependency, the reader, the write validation, the client island and the form are small and tightly coupled across the server and client boundary, so splitting them between api-developer and ux-developer would add handoffs for no gain. Worktree `../presby-map`, Neon branch `pipeline/presbytery-map` (`br-green-brook-axgyfla5`), dev port **3101** (`E2E_BASE_URL=http://localhost:3101`; never 3000; stop a server by PID, never `pkill -f next`; never print a connection string or a `.env.local` value, including the MapTiler key). DECISION-343 is assigned and written; F450+ are free for findings; no migration number is used. The shared hand-edited files (`docs/TODO.md`, `docs/STATE.md`, `docs/decisions.md`, `scripts/seed-dev.sql`, `scripts/test-rls.sql`, `e2e/support/*`) are not edited by the implementer.

**Feasibility check against the live tree (done 2026-11-17).**
1. No SQL is added or changed, so no parameter-default ordering applies.
2. No `ALTER` or `DROP`; no `SECURITY DEFINER` function references the coordinate columns (the columns are read and written only by `src/lib/presbytery.ts` and, new, `viability-map.ts`, on the RLS connection).
3. No `CHECK` or trigger is added; the existing `scripts/seed-dev.sql` rows (two valid pairs) are unaffected.
4. No foreign key. (`congregation_oversight` already has the composite `(organization_id, about_org_id)` key; the new select filters on `organizationId` and `aboutOrgId`, the two tenant-carrying columns.) Live catalog on the branch, per the architect: `FORCE ROW LEVEL SECURITY`, one `tenant_isolation` policy, `SELECT` for `presby_app` on both columns.
5. `holdsPermissions` (`src/lib/org-portal/permission-check.ts`), `readRoster`, `reportByKey("viability").permission`, `withOrgContext`, `OrgTx`, `ReportRead` and `ReportViewer` all exist with the shapes used above. `derive.ts` is pure (no `server-only`) and exports `VIABILITY_LABELS`, `VIABILITY_NOT_ASSESSED` and `RosterEntry`. `copy.ts` is import-free and has `plural`.
6. `noLooseNumberParse` (`boundaries.test.ts`) scans **every** insights-directory file for `Number(`, `parseInt(` and `parseFloat(`, `noWrites` for `.update(`, `.delete(` and `.insert(`, and `noRedirectTargetParams` for `.get("next")`-style reads: `map.tsx` and `map-support.ts` are written to pass all three (no `Set#delete`, no `popup.update()`). `Number.isFinite` does not match `Number(`.
7. `tsconfig` has `esModuleInterop` and `moduleResolution: bundler`; `@types/leaflet@1.9.22` exists on the registry. `vitest.config.ts` collects `scripts/**/*.test.mjs`, so the new fixture test runs under `npm test`.
8. `playwright.config.ts` already has a precedent lane with its own server (`PW_HELP_CONTACT`); `.github/workflows/e2e.yml` already runs a contact-lane step. CI's `ci.yml` runs `npm run check` (which runs `check:deps-drift`) and `audit-prod.mjs`.
9. `next.config.ts:62` is a string literal the architect cannot import into; the host is added to the literal and a test reads the real `headers()`.
10. **Re-run before Phase 4 starts if another pipeline merges first:** `grep -n "img-src" next.config.ts`, the migration count, and `gateInsightsPage`/`getPresbyteryDashboard` signatures (this design edits both).

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

Strings added or changed: [file:line each, or "none"]

*Keep Phase 4 sections short: files, deviations from the design, gates with
counts, and anything the next phase must know. Leave out narration of how
the work went; git history already records it. Judgment output (analyst,
architect, qa) is still recorded verbatim.*

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

## Copy Truthfulness

*(Every run whose diff adds or changes a user-facing string; write "no strings changed" otherwise. Report a defect as `copy truthfulness: FAIL` with file:line and the viewer's role.)*

- [ ] Every added or changed string is in the design's Copy table
- [ ] The query behind each claim about a person, account, date or state was opened, and what it does not read was named
- [ ] Each instruction was traced to the role that sees it, and that role can do it (render gate and permission check)
- [ ] Older strings about the same subject were grepped for and none is made false
- [ ] Help diff covered: every labels string is on screen, every claim walked at 360px, every committed image opened

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
- Help pages read as their reader (each page named in Help impact): [pass | fail | no help impact]

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]
