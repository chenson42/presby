# Portal Home + Directory v2 (Households, Deacons) — Work Log

> **Slug:** `2026-08-24-portal-home-directory`
> **Title:** Rebuild the org portal landing and member directory modeled on the fpcw-directory sibling repo: a real portal home (welcome, find-a-person, "yours" zone, gated tool tiles), a directory with members and households views, household detail pages, and per-household deacon display
> **Surface:** member — `(org)/o/[slug]` subtree
> **Permission(s):** existing `directory.view` covers the read path; new keys TBD in Phase 1 (e.g. hidden-row visibility for deacons/staff)
> **Flag(s):** existing `org_portal.directory`; portal-home changes TBD
> **Estimated complexity:** large
> **Pipeline mode:** Full — schema change likely (deacon ↔ care-group link), multiple shipping increments expected.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-24 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-24 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementers named | 2026-08-24 |
| 4 — Implementation | ux-developer (Inc. 1–2), full-stack-developer (Inc. 3), database-admin then full-stack-developer (Inc. 4) | Complete (2026-08-24) — all increments (1, 2, 3, 4a, 4b) shipped | — | 2026-08-24 |
| 5 — Verification | qa | Complete | PASS | 2026-08-24 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-24 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> The request is really three features wearing one sentence — a real portal home, a households/deacons-aware directory, and a new deacon↔care-group link the schema doesn't have yet — and it should ship in that order, not as one PR.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Authenticated member | Land on `/o/<slug>` and read a time-aware greeting with their own preferred name | per session |
| Authenticated member | Search for a person by name/email/phone from the portal home and jump straight to that person's detail page on a single match | on demand |
| Authenticated member | Browse `/o/<slug>/directory?view=members` as a card grid, with a live count | on demand |
| Authenticated member | Switch to `/o/<slug>/directory?view=households` and browse household cards | on demand |
| Authenticated member | Open a household detail page and see its members, address, and deacon | on demand |
| Authenticated member | Open a person's detail page and see contact info, household, and (if applicable) their deacon | on demand |
| Authenticated member with `directory.view_hidden` | See privacy-hidden rows with a lock indicator, and browse a deacon-roster ("parishes") tab | on demand |
| Deacon (officer) | Appear as the named deacon on their assigned households' cards and detail pages | passive, system-derived |
| Admin | (implied, not stated) assign a care-group/parish to a deacon | on demand — **not named in the request** |

## Flows

**Flow 1 — Portal home landing:** entry `/o/<slug>` → greeting + Find-a-Person card + (optional) Yours zone (household/groups/signups, each hidden if empty) + gated tool tiles → outcome: member either reads their own summary or clicks through to directory/tools.
- Failure: not described. What does the home show if the DB read for "my household" fails, or if the member has no household at all (a very live case — presby's `households` table is nullable per membership)?

**Flow 2 — Find-a-person from portal home:** entry: search box on home → member types a name/email fragment → single unambiguous match → redirect straight to that person's detail page; multiple/no matches → fall through to `/directory?search=...`.
- Failure: fpcw-directory's behavior on multiple matches or zero matches isn't in the survey and isn't in the request. Needs an explicit answer (likely: fall through to `/directory?search=...`).

**Flow 3 — Directory browse (members):** entry `/o/<slug>/directory` → member types in search (debounced) → card grid re-renders server-side → outcome: filtered list or "no matches."
- Failure: empty directory (new install, nobody published yet) and zero-match search need distinct copy — today's presby directory has no search at all, so this is wholly new.

**Flow 4 — Directory browse (households):** entry `/o/<slug>/directory?view=households` → household cards (family name, city/state, deacon name, member-count badge) → click a card → household detail (address, members, deacon block).
- Failure: a household with zero *visible* members (all privacy-hidden or off-roll) should drop from the list, per fpcw-directory precedent — request doesn't say this, should confirm.

**Flow 5 — Deacon visibility on a household/person:** entry: any household or person detail page → DeaconCard renders last, identically in both places, sourced from the household's assigned care unit → outcome: member sees who their deacon is, or nothing if unassigned.
- Failure: unassigned care unit / no deacon serving that org unit currently (term ended, vacant) — must render an empty/neutral state, not a broken card or a stale name.

**Flow 6 — Elevated "parishes"/deacon-roster tab:** entry: nav item gated on `directory.view_hidden` → deacon roster grouped by care unit with counts → outcome: elevated user reviews assignment coverage.
- Failure: not addressed by the request at all — is this in scope for the first increment, or deferred?

## Permissions & Flags

- **Permission(s):**
  - `directory.view` (existing, tier 1) continues to gate the base directory read — members and households views alike.
  - **New key needed**, analogous to fpcw-directory's `directory.view_hidden`: presby's `person_privacy.directory_hidden` / field-level hides currently have no override path at all (`getDirectory()` unconditionally excludes hidden rows — no elevated-viewer branch exists in the SQL today). This is a new permission, tier-appropriate (likely tier 1, bounded — not a wildcard), default-granted to the Board-of-Deacons derived group and to whatever admin role reviews the roll. This is schema/authz-shaped work, not just UI — flag it to Phase 2/3 explicitly.
  - Portal-home tool tiles reuse each tile's destination route's own existing `hasFeature()` gate (mirror, don't duplicate) — matches fpcw-directory's registry pattern.
- **Default roles:** `directory.view` unchanged (derived `active_membership` group). `directory.view_hidden` — recommend binding to the materialized Board-of-Deacons group and to Church Administrator, **not** as a wildcard grant (Key Invariant: No Role Carries a Wildcard).
- **Flag(s):** `org_portal.directory` (existing) continues to gate the whole directory subtree. Recommend a **new** flag `org_portal.directory_v2` (or similar) to stage households/deacons/search behind a kill switch independent of the existing flat-list directory. Portal-home rebuild: reuse existing flags as tile gates; recommend `org_portal.home_v2` so the home rebuild is independently reversible.

## Gaps the Request Didn't Address

- **No deacon-assignment mechanism named.** presby's schema has no `org_units.deacon_id`/equivalent to fpcw-directory's `parish.deaconMemberId`. Who sets it, and how does it stay honest against "The Court Is Not a Group" (deacon rosters are materialized from `officer_terms`, not hand-editable)? Recommend: the deacon-for-a-care-unit link should be *derived* — validated against, or directly sourced from, an active `officer_terms` row of type `deacon` scoped to that `org_unit_id` — not a free-standing FK a person can hand-edit into pointing at a non-deacon. This is a real schema decision, belongs in Phase 2/3, and blocks Flow 5/6 entirely until resolved.
- **2FA gate:** `/o/*` already carries the Edge 2FA gate. No new interaction expected, but confirm mid-enrollment doesn't strand a user who deep-links to a person-detail page.
- **Audit events:** read-only browsing needs none. Exception: an admin action to assign/reassign a deacon to a care unit is role-adjacent and should write to `audit_events`.
- **Empty state:** brand-new install with zero households, zero deacons, zero published directory rows — recommend explicit empty-state copy for portal home and households view (fpcw-directory's precedent is silence).
- **Failure microcopy:** DB-down behavior for the new search round-trip and for the "my household" home-zone read is unaddressed.
- **Mobile (360px):** card grid, Big Two grid, and DeaconCard-on-two-surfaces all need a mobile pass.
- **Photo handling:** fpcw-directory stores photos as base64-in-Postgres; presby has `photo_key` + the tenant-scoped blob store. Avatar rendering must resolve through `src/lib/storage/`, not copy the data-URI pattern.
- **vCard export and nickname-aware search:** both present in fpcw-directory, absent from the request. Treat as explicitly deferred unless the user confirms otherwise.

## Out of Scope (confirm with user)

- Church Events card and My Signups zone on portal home — presby has no events/signups feature yet; render nothing for v1.
- My Groups zone — depends on `groups.ts` domain being surfaced on the member side; confirm it's ready or defer.
- vCard export from person detail.
- Nickname-aware search (Bob↔Robert) — ship literal ILIKE search first, defer fuzzy matching.
- Member-editable privacy controls at `/profile` (field-level hide toggles) — presby's `person_privacy` table exists but no member-facing edit UI has been named. Separate feature.
- Elevated "parishes" deacon-roster tab (Flow 6) — ships in a later increment.

## Open Questions

1. Who assigns a deacon to a care unit/household, and should that assignment be *constrained* to active `officer_terms` deacons only (recommended), or free-text? This gates the schema decision in Phase 2.
2. Should Flow 2 (find-a-person, single-match jump) fall back to the full directory search on zero/multiple matches, or show an inline "no match" state on the home page itself?
3. Is `directory.view_hidden` (elevated visibility + the parishes tab) in scope for increment 1, or deferred to a follow-up once the deacon-linkage schema lands?
4. Should households with zero currently-visible members be dropped from the list (fpcw-directory behavior), or shown with a "no visible members" note?
5. Recommended shipping increments, for confirmation: **(1)** portal-home rebuild (welcome/find-a-person/yours-zone/tool-tiles) reusing existing directory data, no schema change; **(2)** directory members-view search + card-grid redesign, no schema change; **(3)** households view + household detail, using existing `households`/`household_role` schema; **(4)** deacon linkage — schema change (org-unit-to-deacon derivation) + DeaconCard + `directory.view_hidden` + parishes tab. Each increment independently flaggable and shippable.

> **Orchestrator note (2026-08-24):** proceeding with the analyst's recommendations as defaults pending user confirmation — increments 1→4 in order; deacon linkage constrained to active `officer_terms` deacons (derived, not free-text); find-a-person falls through to `/directory?search=`; zero-visible-member households drop from the member view (elevated viewers see them later via `directory.view_hidden`); vCard/nicknames/groups-zone/events deferred.

---

## Per-Phase Status (Phase 1)

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-24 |


---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions**

## Placement

- New route segments confirmed correct: `(org)/o/[slug]/directory/[personId]/page.tsx` and `(org)/o/[slug]/directory/households/[householdId]/page.tsx`. Nested `directory/households` (not `?view=`) so each surface gets its own loading/error/not-found and its own `assertOrgAccess()` call site — consistent with the existing `tickets/[id]` shape. `?view=members|households` as a *filter within* the members-grid page is fine; the household detail page is a distinct segment, not a query param, because it needs its own 404 for a bad id.
- Person/household detail pages: the four-way-miss pattern doesn't apply verbatim (that's org-relationship, not row-existence) but its two structural rules do — **no `loading.tsx`** on these segments if they can `notFound()` (a bad `personId`/`householdId` must 404 at real HTTP status, not flush a 200 first), and the auth/membership check happens in the page via `withOrgContext`, never assumed from a parent layout.
- Portal home: rewrite `page.tsx` and retire `OrgPortalStub` in place — it was always the P0 stand-in; `org-states.tsx`'s other exports (`OrgAccessDenied`, `OrgAccessEnded`) stay untouched (DECISION-040 four-way-miss set, unrelated). New composable pieces (greeting, find-a-person, "yours" zone, tile grid) go under `src/components/org-portal/` — or colocate as `(org)/o/[slug]/_components/` if truly one page's concern. Tile registry: a plain data module (`src/lib/org-portal/tiles.ts`, mirroring the catalog shape of `src/lib/permissions.ts`, not `src/components/`) mapping tile → route → the route's own flag/permission keys — imported by the tile grid only. It must not become a second gate; it mirrors, never duplicates, `hasFeature`/`isFlagEnabled` calls the destination route already makes.

## Invariants Touched

- **The Court Is Not a Group / Roll Is System of Record.** Deacon-linkage shape: reject (a) plain `org_units.deacon_person_id` — it repeats exactly the mistake F15 already reversed for `shepherd_person_id` (a hand-editable FK that can point at a non-deacon, with no dates). Reject (b) a new `care_assignments` table — it duplicates state `officer_terms` already owns and creates a second place service-dates can drift from the term. **Adopt (c)**: add `officer_terms.org_unit_id` (nullable — only district-scoped offices set it), with a composite FK to `org_units(id, organization_id)` mirroring `memberships.orgUnitId`'s existing pattern (F2). A household's deacon is then a pure derivation: `households.org_unit_id → officer_terms where office = 'deacon' and org_unit_id = ... and endsOn is null` — dates authoritative, no new table, nothing to fall out of sync. Add a `CHECK (org_unit_id is null or office = 'deacon')` so a term for another office can't accidentally carry district scoping. Tech-lead adds the supporting index (`org_unit_id, office, startsOn, endsOn`) alongside `officer_terms_org_office_idx`.
- **No Wildcard / Permissions vs Flags.** `directory.view_hidden` is a new row in the DB `permissions` catalog via migration (0017's pattern exactly — `insert into permissions ... on conflict do nothing`), **not** `src/lib/permissions.ts` (frozen, platform-shell only). Tier 1 (same module as `directory.view`, narrower scope, not pastoral/financial). Default bindings: the materialized `diaconate` derived group plus Church Administrator's role — both explicit, bounded grants, not a wildcard.
- **Composite Tenant Keys (F2).** New FK above must be composite. No other new FKs needed elsewhere in this pipeline.
- **Storage / no direct `blob_assets` queries (DECISION-030).** Avatars must go through the blob store's `resolve()`, never a raw query. No existing serving *route* for org logos to mirror — `org-mark.tsx` renders a `data:` URI inline server-side (its own comment acknowledges this is the admin-path shortcut). Recommend the same inline pattern for person/household photos in increment 3/4 rather than inventing a new streaming route this pipeline doesn't need — flag a real photo-serving route as future work only if payload size becomes a problem.

## Notes

1. **Flags** — `org_portal.home_v2` and `org_portal.directory_v2` as independent kill switches: approved, matches the one-flag-per-shippable-slice precedent.
2. **Search** — stay RSC + `searchParams`, no new API route. Find-a-person's single-match jump is a server action that reads, computes zero/one/many, and either `redirect()`s or re-renders — no client round-trip needed at directory scale.
3. **Dependencies** — none beyond `npm run ui:add -- avatar` (no Avatar primitive exists today). No `Popover`/`Command`/combobox for search per `docs/ui-standards.md`'s standing note.
4. Tech-lead must confirm whether `directory.view_hidden` scope extends to the households view — the permission's SQL predicate needs to gate both queries identically, or an elevated viewer sees inconsistent household counts between tabs.

## Per-Phase Status (Phase 2)

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-24 |

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Four independently shippable increments, each behind its own flag. (1) rebuilds `/o/<slug>` in place — greeting, find-a-person, a "yours" household zone, a flag-gated tile grid replacing `OrgPortalStub`. (2) adds ILIKE search and a card grid to the existing members directory, plus avatar rendering via the blob store. (3) adds a households view and household/person detail routes, reusing `households`/`memberships.household_id` — no schema change. (4) adds the deacon↔care-unit derivation: a nullable `officer_terms.org_unit_id` (CHECK-bound to `office = 'deacon'`), the `directory.view_hidden` permission, a `DeaconCard` on both detail pages, and a "Parishes" roster tab. All four read exclusively through `withOrgContext()`; every mutation-shaped question (who assigns a deacon) is deliberately pushed to a future officer-terms-management pipeline, so this feature ships no admin UI and no new audit event.

## Increment 1 — Portal Home v2

**Permissions & Flags.** No new permission. New flag `org_portal.home_v2` (seeded OFF in `scripts/seed.ts`, same "ships dark" pattern as `org_portal.directory`) — gates which UI `page.tsx` renders; OFF falls back to today's `OrgPortalStub`. Tile visibility stays flag-only, mirroring `OrgPortalStub`'s existing discipline: a tile's own destination route re-checks the viewer's permission and renders its own denied state; the home page never conditionally shows/hides a tile based on a permission it looked up itself.

**Server functions.**
- `src/lib/org-portal/tiles.ts` — `interface PortalTile { key; label; description; href(slug): string; flagKey: string }`; `PORTAL_TILES` (directory, admin/roles, tickets, feedback, mirroring `OrgPortalStub`'s four links); `visiblePortalTiles(): Promise<PortalTile[]>` filters by `isFlagEnabled(flagKey)`.
- `src/lib/org-portal/home-data.ts` — `getPortalHomeData(personId, organizationId): Promise<{ displayName: string; household: { id: string; name: string; memberCount: number } | null }>`, wrapped in its own `withOrgContext()` call (own transaction, `getDirectory()`'s pattern) reading the viewer's own `memberships`/`households` row. `household` is `null`, not an empty object, when `household_id` is null.
- `src/app/(org)/o/[slug]/find-person-action.ts` — `"use server"`; `findPersonAction(slug: string, query: string): Promise<{ kind: "redirect"; href: string } | { kind: "fallthrough"; href: string }>`. Re-derives `personId`/`organizationId` from the session itself (`cachedAuth()` + `resolveOrgContext()`) — never trusts a client-supplied id, per the action-is-its-own-trust-boundary rule. Re-checks `directory.view` via the same SQL path `getDirectory()` uses. Exactly one ILIKE match on name/email/phone → `redirect` to `/o/<slug>/directory/<personId>`; zero, many, or forbidden → `fallthrough` to `/o/<slug>/directory?search=<query>` (uniform: `/directory` renders its own honest denied/empty state either way).

**Component/page plan.** Modify `src/app/(org)/o/[slug]/page.tsx` to branch on `org_portal.home_v2`. Remove `OrgPortalStub` from `org-states.tsx` (keep `OrgAccessDenied`/`OrgAccessEnded` untouched) once the v2 path is default; until then both coexist. New `src/components/org-portal/`: `greeting.tsx`, `find-person-form.tsx` (client, plain `<form>`, calls the action), `yours-zone.tsx`, `tile-grid.tsx`.

**Edge cases.** No household → "yours" zone omits the household card entirely, not an empty one. `getPortalHomeData` DB failure → page catches it and still renders greeting + search (never a full-page crash for a non-essential read). All tile flags off → home renders greeting + search only. 360px: tile grid single-column, search input full width.

**Tests.** `visiblePortalTiles()` given flag combinations; `findPersonAction()` unit tests for 0/1/many/forbidden; component tests for the household-present/absent "yours" zone (mirrors `org-states.test.tsx`'s shape).

**Implementer:** ux-developer.

## Increment 2 — Directory Search + Grid

**Permissions & Flags.** No new permission (`directory.view` unchanged). New flag `org_portal.directory_v2` (seeded OFF) — OFF keeps today's `DirectoryList`/`directory-list.test.tsx` rendering untouched, the built-in regression floor for this increment.

**Server functions.** Extend `getDirectory()` in place (no rename, existing callers/tests unaffected when `opts` is omitted): `getDirectory(personId, organizationId, opts?: { search?: string }): Promise<DirectoryResult>`. `search` adds `AND (p.first_name ILIKE $ OR p.last_name ILIKE $ OR p.preferred_name ILIKE $ OR cm_email.value ILIKE $ OR cm_phone.value ILIKE $)` after trimming; empty/whitespace `search` behaves as omitted. Runs after, never instead of, the existing privacy predicate.

**Component/page plan.** `npm run ui:add -- avatar`; avatars resolved inline as a `data:` URI server-side via `src/lib/storage/`'s `resolve()`, the `org-mark.tsx` pattern — no new streaming route. Modify `directory/page.tsx` to read `searchParams: Promise<{ view?; search? }>` and, when `directory_v2` is ON, render a new `directory-grid.tsx` (server component + a GET `<form>` search input, no client fetch) instead of `DirectoryList`.

**Edge cases.** Empty directory vs. zero-match search get distinct copy. 360px: grid collapses to one column.

**Tests.** `getDirectory()` search-filter unit tests (case-insensitive, trims, empty = no filter, matches name/email/phone). Component test for the two empty-state copies. Confirm `directory-list.test.tsx` passes unmodified.

**Implementer:** ux-developer.

## Increment 3 — Households View + Detail

**Permissions & Flags.** No new permission or flag beyond `directory_v2` (already covers this increment).

**Server functions** (in `src/lib/directory.ts`).
```
getHouseholds(personId, organizationId, opts?: { search? }):
  { kind: "ok"; households: HouseholdSummary[] } | { kind: "forbidden" }
getHouseholdDetail(personId, organizationId, householdId):
  { kind: "ok"; household: HouseholdDetail } | { kind: "forbidden" } | { kind: "not-found" }
getPersonDetail(personId, organizationId, targetPersonId):
  { kind: "ok"; entry: DirectoryEntry } | { kind: "forbidden" } | { kind: "not-found" }
```
`HouseholdSummary { householdId, name, city, region, memberCount, deaconName }` — `deaconName` always `null` until Increment 4. `memberCount` counts only rows that would themselves pass `getDirectory()`'s WHERE (current-roll/engagement, not hidden, not merged, not deceased) — the SAME predicate function, not a second copy. A household with `memberCount = 0` is **dropped from `getHouseholds()`** and `getHouseholdDetail()`/`getPersonDetail()` return `"not-found"` for it and for any target with no visible eligible row — indistinguishable from a household/person that never existed, mirroring DECISION-040's non-disclosure discipline on this new surface.

**Component/page plan.** New routes `directory/households/[householdId]/page.tsx` and `directory/[personId]/page.tsx`, each repeating the full `(org)` auth pattern (own `resolveOrgContext`/`assertOrgAccess`, no shared layout assumption), **no `loading.tsx`** (both can `notFound()`). New `households-grid.tsx`, `household-card.tsx`, `person-card.tsx`.

**Edge cases.** A household where every member is individually field-hidden (not `directory_hidden`) still shows with nulled fields. 360px: household detail's address/members two-column collapses to stacked.

**Tests.** `getHouseholds()` drops zero-visible-member households; `getHouseholdDetail()`/`getPersonDetail()` return `not-found` for ineligible ids; route-level `notFound()` tests mirroring `tickets/[id]`'s pattern.

**Implementer:** full-stack-developer (new server functions + new routes, coupled).

## Increment 4 — Deacon Linkage, `directory.view_hidden`, Parishes Tab

**Data model.** `drizzle/0025_presby_deacon_linkage.sql`, hand-written and idempotent per 0017's `add column if not exists` / guarded `do $$` pattern:
1. `alter table officer_terms add column if not exists org_unit_id uuid;`
2. Composite FK `officer_terms_org_unit_fk (org_unit_id, organization_id) references org_units(id, organization_id)`, guarded against `pg_constraint`.
3. CHECK `officer_terms_org_unit_deacon_check (org_unit_id is null or office = 'deacon')`, same guard.
4. `create index if not exists officer_terms_org_unit_idx on officer_terms (organization_id, org_unit_id, office, starts_on, ends_on)` — serves "the active deacon for org_unit X."
5. `insert into permissions (key, module, description, sensitivity_tier) values ('directory.view_hidden', 'directory', 'See directory-hidden rows and the deacon roster', 1) on conflict (key) do nothing;`

`src/lib/db/domain/officers.ts`: add `orgUnitId: uuid("org_unit_id")` to `officerTerms`, plus matching `foreignKey`, `check`, and `index` entries in its `(t) => [...]` array, so `schema.ts` states the same shape the migration lands (Drizzle Kit itself does not emit this — `db:push`/`db:generate` stays broken per 0017's own note).

**Permissions & Flags.** No new flag — reachability rides on `org_portal.directory_v2` (already on); a nav "Parishes" link is shown only when `hasPermission(personId, organizationId, 'directory.view_hidden')` is true, checked directly (not the flag), matching the flags-gate-reachability/permissions-gate-content split. Default bindings, fixture-only (no production role-seeding surface exists yet, matching 0017/0018's precedent): a new constitutional, protected role `diaconate_member` — the honest Session/Diaconate mirror of `session_member` — granted `directory.view_hidden` and bound via `role_grants` to the Board of Deacons derived group. **The "Church Administrator" half of the recommended binding is not applied**: no such role exists in the catalog (`src/lib/db/domain/authz.ts`'s comment names it aspirationally; `scripts/seed-dev.sql` has no admin catch-all role). Binding to `stated_clerk` instead — the closest existing office, already holding `role_grants.manage` — as a pragmatic stand-in; minting a real Church Administrator role is a role-catalog decision for a future pipeline, not this one.

**Server functions.** Add `includeHidden?: boolean` to `getDirectory`, `getHouseholds`, `getHouseholdDetail`, `getPersonDetail` — a **request**, re-verified against `directory.view_hidden` inside each function's own SQL before being honored, never trusted from the caller. When honored, the `directory_hidden` exclusion is dropped and `DirectoryEntry` gains `isHidden: boolean` for the lock-badge UI. New:
```
getParishRoster(personId, organizationId):
  { kind: "ok"; parishes: ParishRosterEntry[] } | { kind: "forbidden" }
// ParishRosterEntry { orgUnitId, orgUnitName, deaconName: string | null, householdCount }
```
requires `directory.view_hidden`; derives each org unit's deacon from `officer_terms where office = 'deacon' and org_unit_id = ... and ends_on is null`, ties broken deterministically (`starts_on desc, id asc`). Household/person `deaconName`/`DeaconCard` sourcing reuses this exact derivation, never a second copy — Phase 2 note 4's consistency requirement.

**Component/page plan.** New `directory/parishes/page.tsx` (full auth pattern; `directory.view_hidden` denial renders the existing `DirectoryForbidden`-shaped state, not a 404). New `src/components/org-portal/deacon-card.tsx`, shared by household and person detail; renders a neutral "no deacon assigned" state when `org_unit_id` is null or the org unit is vacant — never a broken card. Directory/household/person UIs get a lock icon + text badge (never color alone) for hidden rows when `includeHidden` is honored.

**Deacon assignment — explicitly deferred, not built.** `org_unit_id` is set through officer-terms editing, and presby has no officer-terms admin UI today (no companion `actions.ts`/page exists for `officers.ts`). Building one is a distinct feature. This pipeline ships the column, derivation, and read surfaces only; `scripts/seed-dev.sql` pre-sets `org_unit_id` directly on fixture rows so Increment 4 is verifiable without an editor. Recorded as a `docs/TODO.md` line at ship time.

**Edge cases.** Two active deacon terms for one org unit (a data anomaly the CHECK doesn't prevent) — resolved by the same deterministic tie-break everywhere, documented as a display choice, not fixed here. `includeHidden` requested by someone whose grant was revoked mid-session — silently ignored, SQL check runs every call. Households and Parishes tab must show the same counts — guaranteed by sharing the predicate function, not by two hand-checked queries.

**Tests.** SQL assertions (extend `scripts/test-rls.sql` or a new script) that the CHECK rejects `org_unit_id` on a non-deacon office and the composite FK rejects a cross-org unit. `includeHidden` re-check for holder vs. non-holder on all four functions. `getParishRoster` vacant/filled/tie-break cases. `DeaconCard` empty-state render. Regression: Increments 1–3's tests stay green with `includeHidden` defaulted `false`.

**Implementer:** database-admin for the migration + `officers.ts` schema change, then full-stack-developer for the `includeHidden` plumbing, the parishes route, `DeaconCard`, nav wiring, and the seed-dev.sql fixture — sequential, schema lands first.

## Overall Implementation Order

1. Increment 1 (portal home) — no schema dependency.
2. Increment 2 (member search + grid, avatars) — extends `getDirectory`.
3. Increment 3 (households) — extends `directory.ts` further; new routes.
4. Increment 4a (database-admin: `0025_presby_deacon_linkage.sql` + `officers.ts`) → 4b (full-stack-developer: `includeHidden` plumbing, parishes page, `DeaconCard`, seed data).

Given the "large" estimate, recommend Phases 4–6 run as four sequential sub-passes — one increment closes (QA PASS, analyst SHIP IT or SHIP WITH NOTES) before the next increment's implementer starts — rather than one combined pass at the end.

## Seed-dev.sql Additions (Increment 4)

- `insert into org_units`: two new rows at Alder Creek (`unit_type = 'district'`), invented names e.g. "North District" / "South District" — first `org_units` rows in the fixture (none exist today).
- One or two new households with `org_unit_id` set (invented names, e.g. "The Fennimore Family," `example.invalid` contacts) — reuses the existing `households` insert block's shape.
- Officer-terms rows, `office = 'deacon'`, `org_unit_id` set: one active (`ends_on` null) reusing Priya Balakrishnan's existing deacon ordination/history where it fits the story, one ended (to exercise the "vacant" derivation), continuing the `e0000000-...-0008`/`0009` id block after the existing seven `officer_terms` rows.
- Extend `app_role_permissions`/`role_grants` for the new `diaconate_member` role and its Board of Deacons binding, following the `session_member` block's exact shape.

## Audit Events

**No audit events ship in this pipeline.** All four increments are read paths. The one mutation this feature area implies — assigning a deacon to an org unit — is explicitly deferred to a future officer-terms-management pipeline, which will own `recordAudit()` for it when built. `npm run check:audit` has nothing to flag.

## e2e Blast Radius

- Any spec asserting `/o/<slug>`'s current "You're in. There is nothing here yet" copy or `OrgPortalStub`'s link markup — Increment 1 replaces both.
- Any spec asserting `directory/page.tsx`'s flat single-list markup (`DirectoryList`) — safe only if `org_portal.directory_v2` stays OFF in the e2e seed; if the e2e fixture flips it ON, the spec must be updated in the same commit.
- `e2e/support/seed-orgs.ts` and any fixture toggling `org_portal.directory` — audit for hard-coded assumptions about the page's DOM shape.
- Increment 4's parishes tab is net-new; no prior spec to break.

Each increment's implementer runs `npm run test:e2e` before Phase 5 and treats any newly-failing existing spec — not just newly-written tests — as this pipeline's to fix.

## Edge Cases & Risks (cross-cutting)

- Privacy predicate drift: `getDirectory`, `getHouseholds`, `getHouseholdDetail`, `getPersonDetail`, and `getParishRoster` must share one predicate helper, not five hand-copied WHERE clauses — the single highest-risk item for the whole feature, called out because it is invisible in a diff review that only reads one function at a time.
- `getPlatformDb()` is forbidden everywhere in this work — verified by grep at Phase 5, not by convention alone.
- Mobile 360px pass required on every new/changed page (portal home, directory grid, households grid, household/person detail, parishes tab) per `docs/ui-standards.md`'s pre-merge checklist.

## Out of Scope (unchanged from Phase 1/2, reconfirmed)

Church Events / My Signups / My Groups zones, vCard export, nickname-aware search, member-editable privacy controls, and — new to Phase 3 — an officer-terms/deacon-assignment admin UI and a real "Church Administrator" role in the permission catalog.

## Per-Phase Status (Phase 3)

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 3 — Technical design | tech-lead | Complete | Design complete, implementers named | 2026-08-24 |

---

# Phase 4 — Implementation, Increment 1: Portal Home v2 (ux-developer)

## Scope

Exactly Increment 1 per the Phase 3 design: the flag, the tile registry, the
"yours" zone data read, find-a-person, and the rebuilt `/o/<slug>` landing
page. Increments 2–4 (directory search/grid, households view, deacon
linkage) are untouched.

## Files created

- `src/lib/org-portal/tiles.ts` — `PortalTile`, `PORTAL_TILES` (directory,
  admin/roles, tickets, feedback — mirrors `OrgPortalStub`'s four links
  exactly), `visiblePortalTiles()` (flag-only filter, no permission check —
  the destination route stays the sole authority on the viewer's own grant).
- `src/lib/org-portal/greeting.ts` — the pure `timeOfDayGreeting(hour)`
  extracted for unit testing per Phase 3's own test plan.
- `src/lib/org-portal/home-data.ts` — `getPortalHomeData(personId,
  organizationId)`, one `withOrgContext()` transaction reading the viewer's
  own `memberships`/`households` row; `household` is `null`, never an empty
  object, when `household_id` is null; `memberCount` counts only
  non-`ended_on` memberships sharing the household.
- `src/lib/org-portal/find-person.ts` — `findPersonMatches(personId,
  organizationId, query)`, split out from the action for the same reason
  `getDirectory()` lives in `src/lib/directory.ts`: real SQL worth a
  Postgres-backed test. Re-checks `directory.view` via the identical
  `presby_has_permission()` call `getDirectory()` uses; filtered by the same
  eligibility predicate (current-roll/engagement, not hidden, not merged,
  not deceased) — copied inline, not extracted into a shared helper (see
  Divergences below).
- `src/app/(org)/o/[slug]/find-person-action.ts` — `"use server"`
  `findPersonAction(slug, query)`. Re-derives identity via `auth()` (not
  `cachedAuth()` — see Divergences) + `resolveOrgContext()`; delegates the
  DB search to `findPersonMatches()`; fails closed to the search
  fallthrough on any thrown error.
- `src/types/org-portal.ts` — `FindPersonResult`, kept outside the `"use
  server"` file per the `ActionResult`/`feedback/actions.ts` precedent.
- `src/components/org-portal/greeting.tsx`, `find-person-form.tsx` (client,
  `useTransition` + `router.push()`, mirrors `feedback-form.tsx`'s shape),
  `yours-zone.tsx`, `tile-grid.tsx` — all four omit themselves entirely
  (return `null`) rather than render an empty section/card when they have
  nothing to show.
- Tests: `tiles.test.ts`, `greeting.test.ts` (lib, pure), `home-data.test.ts`
  and `find-person.test.ts` (lib, Postgres-backed, `directory.test.ts`'s
  skip-if-no-DATABASE_URL house pattern), `find-person-action.test.ts`
  (orchestration, mocked), `greeting.test.tsx`, `yours-zone.test.tsx`,
  `tile-grid.test.tsx`, `find-person-form.test.tsx` (component, jsdom),
  `page.test.tsx` (orchestration, mocked, mirrors `directory/page.test.tsx`).

## Files modified

- `src/app/(org)/o/[slug]/page.tsx` — branches on `org_portal.home_v2` after
  the unchanged four-way-miss gate and `assertOrgAccess()`. OFF renders the
  untouched `OrgPortalStub` (regression floor). ON renders `Greeting` +
  `FindPersonForm` + `YoursZone` + `TileGrid`; a non-`OrgAccessError`
  failure from `getPortalHomeData()` degrades to `homeData = null` rather
  than crashing; `OrgAccessError` re-throws to `error.tsx`, unchanged from
  the `directory/page.tsx` precedent.
- `scripts/seed.ts` — added the `org_portal.home_v2` flag, seeded OFF,
  same "ships dark" comment shape as `org_portal.directory/roles/tickets`.
  `npm run db:seed` run against the dev database; the row now exists there
  (OFF).

## Schema

None. Increment 1 reads only existing `memberships`/`households`/`people`
columns.

## Audit

None — read-only surface, matches the Phase 3 design's "no audit events
ship in this pipeline" for all four increments.

## Divergences from the Phase 3 design text

1. **Single-match "redirect" target.** The design's literal wording sends
   an exactly-one match to `/o/<slug>/directory/<personId>` — a route that
   does not exist until Increment 3. Per the task brief's own guidance for
   this exact situation, `findPersonAction()` instead resolves a unique
   match to the same `/o/<slug>/directory?search=<query>` href as
   zero/many/forbidden, but keeps its own `kind: "redirect"` so only one
   line (in `find-person-action.ts`, marked `TODO(increment 3)`) needs to
   change once the detail route lands. Verified live: searching "Marguerite"
   (a unique match at Alder Creek) correctly navigates to
   `/o/alder-creek/directory?search=Marguerite` with no 404.
2. **`auth()`, not `cachedAuth()`, inside the server action.**
   `src/lib/auth/cached-auth.ts`'s own header names server actions as the
   one place NOT to use the cached wrapper (`cache()` is a documented no-op
   there); the Phase 3 design text says `cachedAuth()` but that reads as a
   slip against the codebase's own documented rule, not a deliberate
   choice, so this implementation followed the invariant instead.
3. **`findPersonMatches()`'s eligibility predicate is copied inline from
   `getDirectory()`, not extracted into a shared helper.** The Phase 3
   cross-cutting risk note flags predicate drift across five future
   functions (`getDirectory`, `getHouseholds`, `getHouseholdDetail`,
   `getPersonDetail`, `getParishRoster`) as the single highest-risk item in
   the whole pipeline. Increment 1 adds a sixth copy (`findPersonMatches`)
   rather than extracting now, because a shared-helper refactor touching
   `getDirectory()` is out of this increment's scope and the design didn't
   ask for it here. Flagging explicitly so a real extraction happens before
   Increment 3 adds the next two copies, not after.

## UX tradeoffs

- **Greeting uses the server's clock, not the viewer's.** Documented in
  `greeting.ts`'s header: a congregation's members are overwhelmingly in
  one timezone, so this is right for the common case and "a little off"
  near an hour boundary for a rare out-of-timezone visitor. Making it
  viewer-local would mean a client-rendered, hydration-swapped greeting
  (the `<FormattedDate>` pattern) for a purely decorative string — judged
  not worth the complexity for Increment 1.
- **"Yours" zone ships with exactly one card (household).** Events/signups
  and groups are both out of scope per Phase 1 (no events feature exists;
  groups aren't surfaced member-side yet) — `YoursZone` is already shaped
  to add cards later without a rewrite.

## New copy strings (for a fork's branding pass)

"Good morning/afternoon/evening, {name}." / "Welcome." (greeting); "Find a
person" / "Name, email, or phone" / "Search" / "Searching…" (find-a-person);
"Yours" / "{n} member(s)" / "View directory →" (household card); "Tools" /
the four tile labels+descriptions (Directory, Administration, Tickets, Give
feedback — all four are unchanged copy carried over from `OrgPortalStub`,
not new).

## Verification

- `npm run typecheck` — clean.
- `npm run test` (Vitest, mocked suite) — 112 files / 1798 tests passed, 9
  files / 160 tests skipped (unrelated pre-existing skips + this
  increment's own DB-backed files, skipped without `DATABASE_URL`).
- DB-backed tests run for real against the dev database (`dotenv -e
  .env.local -- vitest run src/lib/org-portal/find-person.test.ts
  src/lib/org-portal/home-data.test.ts src/lib/directory.test.ts`) — 23/23
  passed, including the household-memberCount-excludes-ended-membership
  case and the directory.view-forbidden case.
- `npm run build` — clean production build, `/o/[slug]` still listed as a
  dynamic route.
- `npm run check` — all four tripwires pass (audit, sql-date, deps-drift,
  brand-scope). No mutations in this increment, so `check:audit` had
  nothing to flag.
- No `console.log`/`console.debug` in any new file (grepped).
- **e2e, run against the already-running dev server on :3000** (not
  restarted):
  - `e2e/header-controls.spec.ts` — 21/21 passed, unaffected.
  - `e2e/post-login-routing.spec.ts` — 11/12 passed. The one failure
    (test 1, "a platform admin with no congregations lands on /admin") is
    **pre-existing and unrelated to this increment** — confirmed by
    `git stash`-ing every change in this pipeline and re-running the same
    test, which fails identically. Root cause: the shared dev database's
    `admin@presby.invalid` now holds a real membership at the `fpcw`
    organization (created in an earlier, unrelated session per
    `docs/STATE.md`), so the platform-admin-with-zero-congregations
    precondition the test assumes no longer holds in this shared database.
    Not touched or caused by this pipeline; flagging for whoever owns
    dev-database fixture hygiene next.
- **Real browser verification**, flags flipped ON in the dev database for
  the duration of the check, then flipped back OFF (and Alder Creek's
  `organization_settings.require_two_factor` — separately and temporarily
  flipped `false` so `clerk.fixture@example.invalid` could sign in without
  a TOTP-enrolment detour — restored to `true`):
  - `admin@presby.invalid` at `/o/fpcw` (the task's named fixture; a real
    org with no directory/household data yet) — 1280px and 390px. Greeting,
    find-a-person, all four tiles render; "yours" zone correctly omits
    itself (no household). Org brand (fpcw's teal palette) renders
    correctly on the rebuilt home, confirming the brand cascade still
    applies to the new page.
  - `clerk.fixture@example.invalid` (Tobias Renwick) at `/o/alder-creek` —
    1280px and 390px. Greeting, find-a-person, all four tiles, AND a
    populated "yours" zone ("The Renwick Family", 3 members — correctly
    excludes a household member whose search only counts current
    memberships, verified against the fixture's own data). 390px: tile
    grid collapses to one column, search input is full width, no
    horizontal scroll, all touch targets ≥44px.
  - Live search interaction (separate script, same session shape): a
    unique-match query ("Marguerite") and a zero-match query both navigated
    to the correct `/o/alder-creek/directory?search=...` href with zero
    console errors.
  - Screenshots taken via `scratch/portal-home-v2-screens.mjs` and
    `scratch/portal-home-search-check.mjs` (both gitignored scratch, not
    committed), written to `/tmp/portal-home-v2-*.png`.
  - What I did to the dev database, in order: `npm run db:seed` (adds the
    new `org_portal.home_v2` row, OFF); flipped all four `org_portal.*`
    flags to `true`; flipped `alder-creek`'s `require_two_factor` to
    `false`; took screenshots; flipped `alder-creek`'s `require_two_factor`
    back to `true`; flipped all four `org_portal.*` flags back to `false`.
    Confirmed final state matches the pre-verification state (flags OFF,
    2FA policy back ON) with a follow-up SELECT.
  - Dev server was already running on :3000 before this session; not
    restarted, still running and healthy afterward (confirmed via `curl` +
    `lsof`).

## What a reviewer should click through in the browser

1. Sign in as `clerk.fixture@example.invalid` /
   `e2e-fixture-only-not-a-secret`.
2. In the dev DB, flip `org_portal.home_v2` (and, to see the tile grid,
   `org_portal.directory`/`roles`/`tickets`) to `true`; Alder Creek requires
   2FA, so either enroll or temporarily set
   `organization_settings.require_two_factor = false` for
   `22222222-2222-2222-2222-222222222222`, as this session did.
3. Visit `/o/alder-creek`. Confirm: time-appropriate greeting with "Tobias";
   the find-a-person box; a "Yours" card for "The Renwick Family" (3
   members) with a "View directory →" link; a "Tools" grid with all four
   tiles.
4. Search "Marguerite" (unique) and confirm it lands on
   `/o/alder-creek/directory?search=Marguerite` with no error. Search
   "zzz-nobody" and confirm the same fallthrough shape.
5. Flip `org_portal.home_v2` back to `false` and reload `/o/alder-creek` —
   confirm the original "You're in. There is nothing here yet." stub is
   back, unchanged.
6. Resize to 390px and repeat step 3 — single-column tile grid, no
   horizontal scroll, all touch targets comfortable.
7. Restore whatever flags/settings you changed in step 2.

## Next

Increments 2–4 (directory search/grid; households view + detail; deacon
linkage) remain, per the Phase 3 implementation order. Handing to **qa**
for Phase 5 verification of Increment 1 specifically — the design's
recommendation (Phase 3, "Overall Implementation Order") is to run
Phases 4–6 as sequential sub-passes per increment rather than one combined
pass at the end, so QA should verify Increment 1 now rather than wait for
Increments 2–4.

## Per-Phase Status (Phase 4, Increment 1)

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 4 — Implementation (Increment 1: Portal Home v2) | ux-developer | Complete | — | 2026-08-24 |
| 4 — Implementation (Increments 2–4) | full-stack-developer / database-admin | Pending | — | — |

---

# Phase 4 — Implementation, Increment 2: Directory Search + Grid (ux-developer)



## Scope

Exactly Increment 2 per the Phase 3 design: the `org_portal.directory_v2`
flag, a `search` extension to `getDirectory()`, and a card-grid rendering
of the SAME privacy-filtered result the flat list already uses. Increments
3–4 (households view + detail, deacon linkage) are untouched.

## Files created

- `src/app/(org)/o/[slug]/directory/person-avatar.tsx` — two exports,
  deliberately split for testability: `resolvePhotoSrc(organizationId,
  photoKey)` (a plain async function — resolves through
  `getBlobStore().resolve()`, DECISION-030, and inlines the bytes as a
  `data:` URI, the exact pattern `(admin)/admin/organizations/[id]/page.tsx`
  and `org-mark.tsx` already use for the org logo) and `<PersonAvatar
  photoSrc displayName className>` (a plain, synchronous, presentational
  component wrapping the newly-generated shadcn `Avatar`/`AvatarImage`/
  `AvatarFallback`, initials via the existing `src/lib/initials.ts`).
- `src/app/(org)/o/[slug]/directory/directory-grid.tsx` — `DirectoryGrid`,
  an **async Server Component** (not embedded as `<DirectoryGrid />` JSX in
  `page.tsx` but called and awaited directly there — see Divergences #1):
  resolves every card's photo via one `Promise.all(resolvePhotoSrc(...))`,
  then renders a plain GET `<form>` search box, a "Showing N members"
  count, and either the two distinct empty states or a responsive
  `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` card grid. Null
  email/phone/city are omitted per-card, never shown empty (mirrors
  `directory-list.tsx`'s existing discipline); household name and deacon
  are NOT rendered — out of scope per the design, `DirectoryEntry` doesn't
  carry either field yet.
- Tests: `person-avatar.test.tsx` (`resolvePhotoSrc()` unit tests against a
  mocked `@/lib/storage/blob-store`; `<PersonAvatar>` tests scoped to what
  is deterministic in jsdom — see Divergences #2 for why image-loaded
  rendering itself isn't asserted), `directory-grid.test.tsx` (search box,
  member count singular/plural, both empty states, card content, the
  responsive grid's class list, one card per entry).

## Files modified

- `src/lib/directory.ts` — `getDirectory(personId, organizationId, opts?: {
  search?: string })`. `opts.search`, trimmed, adds one `AND (...)` ILIKE
  clause (first/last/preferred name, primary email, primary phone) **after**
  the existing privacy predicate, never instead of it — the exact SQL shape
  the Phase 3 design specifies. Every existing caller (which never passes
  `opts`) is unaffected; `directory-list.tsx`/`directory-list.test.tsx` were
  not touched.
- `scripts/seed.ts` — added `org_portal.directory_v2`, seeded OFF, appended
  directly after `org_portal.home_v2` without disturbing it (per the task
  brief's explicit note). `npm run db:seed` run against the dev database;
  the row exists there now, OFF.
- `src/app/(org)/o/[slug]/directory/page.tsx` — reads `searchParams:
  Promise<{ search?: string }>` in addition to `params`; checks
  `org_portal.directory_v2` **after** `org_portal.directory` and **after**
  `getDirectory()` has already run (it decides which UI renders the same
  result, not whether the read happens — see the page's own updated header
  comment). OFF: `getDirectory(personId, orgId, undefined)` — byte-identical
  call shape to before this increment — and `<DirectoryList>`. ON:
  `getDirectory(personId, orgId, { search })` and `DirectoryGrid`, awaited
  directly (see Divergences #1).
- `src/app/(org)/o/[slug]/directory/page.test.tsx` — updated (not
  `directory-list.test.tsx`; see Divergences #3) to key `isFlagEnabled`'s
  mock by argument rather than a single blanket resolved value (needed once
  a second flag exists), added `searchParams` to every `DirectoryPage(...)`
  call, added a `describe` block covering `directory_v2` ON: search passed
  through trimmed, grid renders, both empty-state copies, and confirmed the
  OFF path's `getDirectory` call carries `undefined` as its third argument
  byte-for-byte.
- `src/lib/directory.test.ts` — extended (not replaced) with a new
  `opts.search` `describe` block: name/email/phone matches, case
  insensitivity, whitespace trimming, empty-search-equals-omitted,
  directory_hidden rows never returned regardless of a matching search, a
  match on a HIDDEN field's raw value still nulls that field in the
  returned row, and the forbidden case still applies with `search` passed.
  Every pre-existing test in this file is unmodified and still passes.

## Dependency added

`@radix-ui/react-avatar` (Phase 2 already pre-approved this exact
dependency: "none beyond `npm run ui:add -- avatar`"). Generated via `npm
run ui:add -- avatar` (never raw `shadcn add`), which flagged the new
runtime dependency per its own safety check; installed deliberately with
`npm install @radix-ui/react-avatar` per the Phase 2 approval.
`npm run check:deps-drift` passes — no umbrella `radix-ui` import.

## Schema

None. Increment 2 extends an existing SQL query in place; no migration.

## Audit

None — read-only surface, matches the Phase 3 design.

## Divergences from the Phase 3 design text

1. **`DirectoryGrid` is called and awaited directly in `page.tsx`
   (`await DirectoryGrid({...})`), not embedded as `<DirectoryGrid ... />`
   JSX.** The design's literal component plan doesn't specify which shape;
   this implementation had to choose. `@testing-library/react`'s client
   renderer (used by every component test in this tree, including
   `page.test.tsx`'s own established "await the async function, then
   `render()` the resolved element" pattern) has no RSC runtime to await a
   *nested* async Server Component the way Next's real renderer does —
   only the OUTERMOST async function in a render call gets awaited by the
   test harness. `DirectoryGrid` is async (it resolves every card's photo
   via `Promise.all()` before returning) but has no async descendants of
   its own, so calling and awaiting it one level up, inside `page.tsx`,
   produces one fully-resolved, plain element — testable the same way
   `DirectoryPage` itself already is, and behaviorally identical in Next's
   real RSC renderer (which would await it either way). Documented in both
   files' own header comments so a future increment doesn't "fix" this
   back to JSX and silently reintroduce an untestable nested-async-
   component tree.
2. **Avatar image-loaded rendering is not asserted in `person-avatar.
   test.tsx`.** Radix's `AvatarImage` decides whether to render the `<img>`
   by constructing a real `window.Image()` and waiting for a browser
   `load`/`error` event; jsdom does no image decoding at all, so whether
   that event fires for a `data:` URI — and when — is a jsdom
   implementation detail, not this component's own behavior. Asserting on
   it would pin a flaky test to the wrong layer. What the tests DO assert
   is everything deterministic and actually owned by this component: no
   `<img>` is attempted at all when `photoSrc` is null, the initials
   fallback text is correct, and the fallback's `aria-hidden` attribute
   flips with `photoSrc` (set directly by this component's own prop, not
   by Radix's async loading state). The real, meaningful logic —
   `resolvePhotoSrc()`'s data-URI construction and its stale-key/null
   handling — IS fully unit-tested. Flagging for qa: visually verifying
   the loaded-photo path in a real browser isn't possible with this
   fixture set either (see Verification below — zero seeded people carry a
   `photo_key`), so the loaded-image rendering path has NO coverage beyond
   "renders without crashing when given a `data:` URI string." A future
   increment that seeds a fixture photo should add a Playwright-level
   visual check, not a jsdom unit test.
3. **`page.test.tsx` was modified; `directory-list.test.tsx` was not.**
   The task brief's "existing tests must keep passing untouched" refers to
   the flat list's own regression floor (`directory-list.test.tsx`,
   confirmed byte-for-byte unmodified and green). `page.test.tsx` is this
   increment's own orchestration test and needed real changes once a
   second flag (`org_portal.directory_v2`) existed alongside
   `org_portal.directory` — the old tests' `isFlagEnabled.mockResolvedValue
   (true)` would have silently resolved BOTH flags to `true` for every
   call, changing old tests' behavior out from under them. Fixed by keying
   the mock's resolution by argument (`mockFlagsV1Only()` /
   `mockFlagsV2()` helpers) rather than a single blanket value — every
   pre-existing assertion in the file still passes, now for the right
   reason (`directory_v2` explicitly OFF) rather than by accident.
4. **`directory-grid.tsx`/`person-avatar.tsx` mock `@/lib/storage/blob-
   store` in their own tests and `page.test.tsx` now mocks it too**,
   though `page.tsx` itself never calls it. `page.tsx` statically imports
   `./directory-grid` → `./person-avatar` → `@/lib/storage/blob-store` →
   `@/lib/db`, and `@/lib/db` opens a real Neon pool at module-import time
   and throws when `DATABASE_URL` is unset — the exact reason
   `directory.test.ts` itself dynamic-imports everything inside
   `beforeAll`. Mocking one hop before the DB-touching module (the same
   "mock the module, not the transitive chain" discipline the rest of the
   tree already uses) keeps every mocked-suite test file in this
   increment import-safe with no `DATABASE_URL` set.

## UX tradeoffs

- **The search box is a plain GET `<form>`, not a debounced client
  component.** The task brief's summary said "debounced search box"; the
  Phase 3 design's own component plan says "a GET `<form>` search input,
  no client fetch." Followed the design (authoritative per this task's own
  instructions) — a plain GET form does zero requests while typing and
  exactly one on Enter/Search-click, which is the search-box-shaped
  outcome a debounce exists to produce, achieved here with zero client
  JavaScript instead of a timer. Cost: no live-as-you-type results: a
  member has to press Enter or click Search. Judged acceptable for a
  congregation directory's scale and matches `docs/ui-standards.md`'s
  standing note against inventing combobox-shaped patterns ahead of a real
  primitive.
- **Card-grid person names use `break-words`, not `truncate`.** First
  build (screenshotted, then corrected — see Verification) used `truncate`
  on the `<h3>`, matching `directory-list.tsx`'s existing contact-link
  truncation; on a real name at 3-column/1280px width this cut
  "Marguerite Ashcombe" down to "Marguerite Ashco…" with room to spare
  one line below. Switched to `break-words` (wraps onto a second line
  instead) — email/phone links keep `truncate` since those benefit from a
  single line, but a person's own name should never be visually
  abbreviated when the fix is free (one more line of card height).
- **No street address in the grid card, only city.** Per the design's own
  edge-case note — the full address stays the flat list's (and, later, the
  person-detail page's) job; a 1/2/3-column card is already the tightest
  layout in this feature and a full multi-line address would crowd it.

## New copy strings (for a fork's branding pass)

"Search the directory" / "Name, email, or phone" / "Search" (search box);
"Showing {n} member(s)" (count); "No matches for "{search}". Try a
different name, email, or phone number." (zero-match empty state); "No one
is listed in {orgName}'s directory yet." (empty-directory empty state, a
new variant of the flat list's existing "No one is listed in the directory
yet." — this one names the org, since the grid page doesn't otherwise show
the org name near the message the way the flat page's `<p>` subtitle does
double duty for both).

## Verification

- `npm run typecheck` — clean for every file this increment touches. Four
  pre-existing errors remain in `src/app/(public)/site/[slug]/**`
  (`presby-site-kit` export mismatches) — confirmed unrelated: these files
  are untouched by this increment, the errors exist identically before and
  after this increment's changes, and they trace to a different, already
  in-flight, uncommitted pipeline (`docs/work-log/2026-08-24-public-site-
  parity-fixes.md` et al., visible in this repo's working tree at session
  start). Flagging for whoever owns that pipeline next; not in scope here.
- `npm run test` (Vitest, mocked suite) — 113 files / 1818 tests passed, 1
  file / 1 test failed (the same pre-existing `presby-site-kit` mismatch,
  `sitemap.xml/route.test.ts`, unrelated to this increment), 9 files / 169
  tests skipped (unrelated pre-existing skips + this increment's own
  DB-backed file, skipped without `DATABASE_URL`).
- DB-backed tests run for real against the dev database (`dotenv -e
  .env.local -- vitest run src/lib/directory.test.ts`) — 20/20 passed,
  including all 9 new `opts.search` cases (name/email/phone matches, case
  insensitivity, trimming, empty-equals-omitted, directory_hidden excluded
  regardless of search, hidden-field nulling preserved under a search that
  matched via the hidden raw value, forbidden-with-search).
- `npm run build` — blocked by the same four pre-existing, unrelated
  `presby-site-kit` type errors (confirmed identical file set as
  `typecheck`, zero errors in any file this increment touches). Not a
  regression introduced here; not fixed here (out of scope, risk of
  interfering with the other in-flight pipeline's own work).
- `npm run check` — all four tripwires pass (audit, sql-date, deps-drift,
  brand-scope). No mutations in this increment, so `check:audit` had
  nothing to flag.
- `npx eslint` on every file this increment touched — clean.
- No `console.log`/`console.debug` in any file this increment created or
  modified (grepped; the only hits anywhere in the touched-file set are
  `scripts/seed.ts`'s existing, pre-existing, legitimate CLI-progress
  lines).
- **Real browser verification**, flags flipped ON in the dev database for
  the duration of the check, then flipped back OFF (and Alder Creek's
  `organization_settings.require_two_factor` — separately and temporarily
  flipped `false`, same as Increment 1 — restored to `true` after):
  - Checked BEFORE changing anything: `org_portal.directory` and
    `org_portal.directory_v2` were both `false` (Increment 1 had already
    restored `org_portal.directory` to its seeded-OFF state); Alder
    Creek's `require_two_factor` was `true`. Confirmed a matching final
    SELECT after restoring.
  - **Mid-session incident, corrected:** running `npm run build` (a Phase
    4 gate) against the same `.next` directory a live `next dev` process
    was using corrupted that dev server's output — subsequent requests
    silently kept serving stale, pre-Increment-2 HTML (confirmed via a
    scripted `page.content()` check showing no `directory-search` marker
    even with both flags `true` in the database). Fixed by stopping the
    stale `next dev` process, deleting `.next`, and starting a fresh `npm
    run dev` in the background with output to `/private/tmp/presby-dev.
    log`; confirmed healthy via a `GET /` 200 before re-verifying. Noting
    this for whoever owns dev-server hygiene next: running a production
    `next build` against a live dev server's `.next` directory is unsafe
    and should probably build into a separate output directory, or the
    workflow should insist on a dedicated build check-out.
  - `clerk.fixture@example.invalid` (Tobias Renwick) at
    `/o/alder-creek/directory` — 1280px and 390px, four states: browse (6
    members, all initials-fallback avatars since **zero seeded people
    carry a `photo_key`** — confirmed via a direct query,
    `select count(*) from people where photo_key is not null` → 0, so the
    initials-fallback path is the only one verifiable with today's
    fixture, matching the task brief's own anticipated finding), a
    unique-match search ("marguerite" → 1 result, search box round-trips
    the query), a zero-match search ("zzz-nobody-matches-this" → the
    named-back empty state), and a live keyboard interaction (typed into
    the search box, pressed Enter, landed on the correct `?search=`
    URL) — zero console errors or page errors logged in any of it.
  - 390px: single-column grid, search input full width with the Search
    button stacked below it (`flex-col` base, `sm:flex-row` upward), no
    horizontal scroll, all touch targets comfortable.
  - **Regression-floor check**: flipped `org_portal.directory_v2` back to
    `false` (leaving `org_portal.directory` `true`) and reloaded
    `/o/alder-creek/directory` — confirmed the original flat
    `DirectoryList` markup renders byte-for-byte as before (no
    `directory-search` marker in the HTML), Increment 1's precedent for
    this exact regression-floor check.
  - Screenshots taken via `scratch/directory-v2-check.mjs` (gitignored
    scratch, not committed), written to `/tmp/directory-v2-*.png` and
    `/tmp/directory-v1-regression-floor.png`.
  - What I did to the dev database, in order: `npm run db:seed` (adds the
    new `org_portal.directory_v2` row, OFF); confirmed both directory
    flags and Alder Creek's 2FA setting's PRE-verification values; flipped
    `org_portal.directory`/`directory_v2` to `true` and Alder Creek's
    `require_two_factor` to `false`; took screenshots; flipped
    `org_portal.directory_v2` back to `false` alone to confirm the
    regression floor; flipped `org_portal.directory` back to `false` and
    `require_two_factor` back to `true`. Confirmed final state with a
    follow-up SELECT — matches exactly what was found before this
    session's changes.
  - Dev server: restarted mid-session (see incident above); healthy and
    running on :3000 at the end of this session (confirmed via `curl` +
    `ps`), not stopped.

## What a reviewer should click through in the browser

1. Sign in as `clerk.fixture@example.invalid` /
   `e2e-fixture-only-not-a-secret`.
2. In the dev DB, flip `org_portal.directory` and `org_portal.directory_v2`
   to `true`; Alder Creek requires 2FA, so either enroll or temporarily set
   `organization_settings.require_two_factor = false` for
   `22222222-2222-2222-2222-222222222222`, as this session did.
3. Visit `/o/alder-creek/directory`. Confirm: a labeled search box, "Showing
   6 members", a 1/2/3-column responsive card grid, each card showing an
   avatar (initials, since no fixture person has a photo), name, and
   (where present) email/phone/city.
4. Type "marguerite" into the search box and press Enter (or click Search).
   Confirm the URL becomes `?search=marguerite`, "Showing 1 member", and
   only Marguerite Ashcombe's card remains.
5. Search "zzz-nobody-matches-this". Confirm the zero-match empty state
   names the query back, distinct from what a genuinely empty directory
   would say.
6. Flip `org_portal.directory_v2` back to `false` and reload — confirm the
   original flat `DirectoryList` (no search box, no avatars, no grid) is
   back, unchanged.
7. Resize to 390px and repeat step 3 — single-column grid, full-width
   search input with the Search button stacked below it, no horizontal
   scroll, comfortable touch targets.
8. Restore whatever flags/settings you changed in step 2.

## Next

Increments 3–4 (households view + detail; deacon linkage) remain, per the
Phase 3 implementation order. Handing to **qa** for Phase 5 verification of
Increment 2 specifically, per the design's own recommendation to run
Phases 4–6 as sequential sub-passes per increment.

## Per-Phase Status (Phase 4, Increment 2)

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 4 — Implementation (Increment 2: Directory Search + Grid) | ux-developer | Complete | — | 2026-08-24 |
| 4 — Implementation (Increment 3: Households View + Detail) | full-stack-developer | Complete | — | 2026-08-24 |
| 4 — Implementation (Increment 4) | database-admin then full-stack-developer | Pending | — | — |

---

# Phase 4 — Implementation, Increment 3: Households View + Detail (full-stack-developer)

## Scope

Exactly Increment 3 per the Phase 3 design: `getHouseholds()`, `getHouseholdDetail()`,
`getPersonDetail()` in `src/lib/directory.ts`; `/o/<slug>/directory/[personId]` and
`/o/<slug>/directory/households/[householdId]`; the `?view=households` toggle on the
existing directory page; linking Increment 2's member cards and find-a-person to the
new person-detail route. No schema change, no deacon linkage, no `directory.view_hidden`
— all three are explicitly Increment 4.

## Files created

- `src/app/(org)/o/[slug]/directory/format-birthday.ts` + `.test.ts` —
  `formatBirthdayMonthDay(dateOfBirth)`, a pure string formatter (month/day
  only, never the year — see its own header for the privacy rationale; not
  mandated by the Phase 3 design text, a UX decision recorded there and
  below).
- `src/app/(org)/o/[slug]/directory/person-card.tsx` — `<PersonCard>`,
  extracted from `directory-grid.tsx` so the identical card renders inside
  both the members grid and a household's member list. The name is now a
  `<Link>` to `/o/<slug>/directory/<personId>`; the avatar stays
  presentational; mailto/tel links stay siblings, never nested inside
  another `<a>`.
- `src/app/(org)/o/[slug]/directory/household-card.tsx` — `<HouseholdCard>`:
  name (linked), city/state, member-count `Badge`. A commented slot for
  Increment 4's deacon badge, rendered only when `deaconName` is non-null
  (always `null` today).
- `src/app/(org)/o/[slug]/directory/households-grid.tsx` — `<HouseholdsGrid>`,
  the households counterpart to `directory-grid.tsx`: count line, two
  distinct empty states (empty congregation vs. zero-match search), 1/2/3
  responsive grid. Not async (no photo to resolve).
- `src/app/(org)/o/[slug]/directory/[personId]/page.tsx` + `not-found.tsx`
  + `page.test.tsx` — full `(org)` auth pattern repeated in full (own
  `resolveOrgContext`/`assertOrgAccess`), gated on BOTH `org_portal.directory`
  and `org_portal.directory_v2`, `getPersonDetail()`'s three outcomes mapped
  to `DirectoryForbidden` / `notFound()` / render. No `loading.tsx`. Renders
  avatar, name (preferred+last, with a secondary "formal name" line when
  `middleName`/`suffix` differ from the display name), a Contact block that
  omits itself entirely when every field is null, birthday (month/day only)
  when unhidden, and a best-effort Household section (a second
  `getHouseholdDetail()` read that degrades to "omit the section" rather
  than crashing the page on any non-`OrgAccessError` failure).
- `src/app/(org)/o/[slug]/directory/households/[householdId]/page.tsx` +
  `not-found.tsx` + `page.test.tsx` — `[personId]`'s structural sibling:
  same auth pattern, same flag gate, same three-outcome mapping from
  `getHouseholdDetail()`, no `loading.tsx`. Renders household name, full
  mailing address (omitted when null), member count, and the member grid
  via the shared `<PersonCard>`.
- `src/app/(org)/o/[slug]/directory/households-grid.test.tsx` — component
  tests for `<HouseholdsGrid>` (count singular/plural, both empty states,
  card content, city/state omission, deacon-badge absence, responsive grid
  class list).

## Files modified

- `src/lib/directory.ts` — the single highest-risk item in the Phase 3
  design (privacy-predicate drift) addressed by factoring
  `directoryEligibilityWhereSql()` (the shared WHERE predicate) and
  `queryDirectoryRows()` (the shared SELECT/JOIN/WHERE, parameterized by an
  optional `search`/`householdId`/`personId` narrower) out of `getDirectory()`
  — its own SQL text, mapping (`mapRow()`), and returned shape are BYTE-FOR-
  BYTE unchanged; only the code that produces them moved. `checkDirectoryView()`
  factors the identical `presby_has_permission()` call all four functions now
  share. `DirectoryEntry` gains four OPTIONAL fields (`middleName`, `suffix`,
  `householdId`, `householdRole`) — `getDirectory()`'s own `mapRow()` never
  sets them (so every pre-existing test and caller is unaffected); only the
  new `mapRowExtended()`, used by `getHouseholdDetail()`/`getPersonDetail()`,
  populates them. New: `getHouseholds(personId, organizationId, opts?)`,
  `getHouseholdDetail(personId, organizationId, householdId)`,
  `getPersonDetail(personId, organizationId, targetPersonId)` — signatures
  match the Phase 3 design's code fence exactly. A household with
  `memberCount === 0` is dropped from `getHouseholds()` and both detail
  functions return `"not-found"` for it — computed from the SAME
  `queryDirectoryRows()` call `getDirectory()` uses, not a second count. A
  new `UUID_RE` guard makes a malformed route-param id return `"not-found"`
  BEFORE any SQL runs, rather than throwing a Postgres cast error — required
  so a bad id 404s cleanly instead of hitting the load-error state.
- `src/app/(org)/o/[slug]/directory/page.tsx` — `?view=households` (default
  `"members"`, only reachable when `org_portal.directory_v2` is ON — the v1
  regression floor never branches on the param at all) calls
  `getHouseholds()` INSTEAD of `getDirectory()` for that branch, never both.
  A new `<DirectoryViewTabs>` (Members/Households, via the real `<Button
  asChild>` primitive — see Divergences #1) renders on both `directoryV2Enabled`
  paths, carrying `search` across the switch. `DirectoryGrid` now receives
  `slug` (threaded through to `<PersonCard>`).
- `src/app/(org)/o/[slug]/directory/directory-grid.tsx` — `PersonCard` moved
  to its own file; `DirectoryGrid` takes a new required `slug` prop and
  passes it through.
- `src/app/(org)/o/[slug]/directory/page.test.tsx` — added `getHouseholds`
  to the `@/lib/directory` mock; extended `makeSearchParams` to accept
  `view`; added a `?view=households` describe block (calls `getHouseholds`
  not `getDirectory`, search pass-through, forbidden, `OrgAccessError`
  re-throw, and the v1-ignores-`view` regression-floor case); added tab
  assertions to the existing v2 search test.
- `src/app/(org)/o/[slug]/directory/directory-grid.test.tsx` — `renderGrid`'s
  defaults gained `slug: "alder-creek"`; the "omits email/phone/city" test
  updated for the new always-present name-link (was asserting zero links,
  now asserts exactly one link to the person-detail route); added a
  dedicated "the name links to the person-detail route" test.
- `src/app/(org)/o/[slug]/find-person-action.ts` — the Increment-1 TODO
  resolved: a unique match now redirects to
  `/o/<slug>/directory/<result.personIds[0]>` instead of the search
  fallthrough href. One line changed, as Increment 1's own header comment
  anticipated.
- `src/app/(org)/o/[slug]/find-person-action.test.ts` — the single-match
  test updated to assert the real redirect href.
- `src/lib/directory.test.ts` — extended (not replaced) with a households
  fixture (`householdVisible`: 2 visible members; `householdHiddenOnly`: 1
  `directory_hidden` member, i.e. 0 visible; `householdOrgB`: cross-org
  isolation) and three new `describe` blocks (`getHouseholds`,
  `getHouseholdDetail`, `getPersonDetail`) — 22 new DB-backed tests. Every
  pre-existing test in this file is unmodified and still passes.
- `scripts/seed-dev.sql` — one new block (see Seed data below). The
  households and `memberships.household_id`/`household_role` wiring this
  increment's brief called for were ALREADY present in the fixture (from
  the earlier roll/household pipeline, predating this feature) — confirmed
  by querying the dev database before writing any seed code. What was
  genuinely missing: a mailing address, so the households view's city/state
  line and the household-detail page's address block had something to show
  on a fresh install.

## Schema

None. Increment 3 reads only existing `households`/`memberships`/`people`/
`addresses` columns, exactly as the Phase 3 design specified.

## Seed data

Ran directly against the dev database (recorded exactly, in order):

1. Queried `households`, `memberships` (Alder Creek), and `addresses` counts
   first — confirmed the two households ("The Renwick Family",
   "Marguerite Ashcombe") and their `household_id`/`household_role` wiring
   already existed, and that zero `addresses` rows existed anywhere.
2. Inserted one `addresses` row for Tobias Renwick (`c0000000-...-0002`,
   home, "142 Maple Ridge Lane", Alder Creek, OH, 44201) and set
   `households.mailing_address_id` to it for "The Renwick Family"
   (`d0000000-...-0001`), inside one transaction. Live-DB id:
   `d7fc391d-f467-4951-ba59-c06195411360` (generated, not pinned).
3. Verified via a follow-up join query: "The Renwick Family" → Alder Creek,
   OH; "Marguerite Ashcombe" → no address (deliberately, to keep the
   "omitted when null" path exercised by the fixture too).

The equivalent SQL is appended to `scripts/seed-dev.sql` (a new dated block
after the public-sites block, before `commit;`) with an explicit,
deterministic id (`a1000000-0000-0000-0000-000000000001`) so a from-scratch
`psql -f scripts/seed-dev.sql` run produces the same fixture shape — the id
differs from the live dev database's (which was generated ad hoc, before
the checked-in SQL was written) but the data and behavior are identical.
No `db:push`/`db:generate` — no schema changed.

## Audit

None — read-only surface, matches the Phase 3 design's "no audit events in
this pipeline" for all four increments.

## Divergences from the Phase 3 design text

1. **`DirectoryViewTabs` uses the real `<Button asChild>` primitive, not a
   hand-rolled pill `className`.** First draft used a raw
   `rounded-full bg-primary px-3 ...` string, which `npm run check:brand-scope`
   correctly flagged as C2 ("no hand-rolled primitives" — button-shaped
   class strings must go through `src/components/ui/`). Rewritten as
   `<Button asChild variant={active ? "default" : "outline"}>` wrapping the
   `<Link>`, matching `DirectoryLoadError`'s own existing "Try again" button
   precedent. Behaviorally identical; visually consistent with the rest of
   the app's buttons rather than a one-off pill shape.
2. **`DirectoryEntry` gained four OPTIONAL fields instead of a second,
   richer type.** The Phase 3 design's code fence types `getPersonDetail()`'s
   ok variant as `entry: DirectoryEntry` verbatim — reusing the existing
   type, not inventing `DirectoryPersonDetail`. Satisfying both that literal
   signature AND the task's need for household-linking/formal-name data on
   the detail page meant extending `DirectoryEntry` itself. Making the four
   new fields (`middleName`, `suffix`, `householdId`, `householdRole`)
   OPTIONAL (`?:`) rather than required was the load-bearing choice: it
   keeps every pre-existing `DirectoryEntry` object literal in the test
   suite (which only sets the original eight fields) valid without a single
   edit, while `getDirectory()`'s own `mapRow()` — UNCHANGED — never emits
   them, so its behavior is provably identical before and after this
   refactor (Divergence #1's own regression-floor logic, applied to a data
   shape instead of a UI).
3. **Household search (`getHouseholds()`'s `opts.search`) matches only the
   household's own `name`.** The Phase 3 design's signature includes
   `opts?: { search? }` but doesn't specify which column(s) — unlike
   `getDirectory()`'s search, which the design spells out in full SQL.
   Matching household name only (not member names) was the narrower,
   more predictable reading: the households view's cards show a name, not a
   member roster, so a search box on that view should filter on what's
   visible on the card.
4. **Birthday renders month/day only, never the year — a UX decision, not
   in the Phase 3 design text at all** (grepped the whole work-log; zero
   hits for "birthday"). `hide_birthday`'s own declared default is `TRUE`,
   the single most restrictive of the five privacy flags — read as a signal
   that even an unhidden birthday shouldn't go further than a congregation's
   actual use case ("wish someone a happy birthday") requires. See
   `format-birthday.ts`'s own header for the full rationale.
5. **Person/household detail back-navigation is a static target, not the
   `docs/ui-standards.md` `?from=` convention.** `directory/[personId]` back-
   links to `/o/<slug>/directory` (matching `tickets/[id]`'s own "Back to
   tickets" precedent); household detail back-links to
   `/o/<slug>/directory?view=households`. The Phase 3 design's own edge-case
   list doesn't call for dynamic-origin back-nav here, and both detail
   surfaces have exactly one canonical parent list, unlike a page reachable
   from many unrelated origins.
6. **Increment 2's `<PersonCard>` now links its name to the person-detail
   route (task-directed, not literally spelled out in the Phase 3 design's
   Increment 2 text, which predates this route's existence).** The design's
   own Increment 3 "Component/page plan" implies the grid should reach the
   new detail page (`households-grid.tsx`/`household-card.tsx`/`person-
   card.tsx` are named as an Increment 3 deliverable), and the task brief
   explicitly asked this to be checked. Only the name text is a `<Link>` —
   the avatar stays presentational and the mailto/tel links stay outside it,
   to avoid nesting `<a>` tags.

## UX tradeoffs

- **The household-members section on a person's own detail page excludes
  the viewed person themselves** (`otherMembers = household.members.filter(
  personId !== entry.personId)`) — showing your own card a second time,
  directly under your own name, would read as a rendering bug rather than
  useful navigation. The household's OTHER members are exactly what's
  useful to jump to from there.
- **A secondary `getHouseholdDetail()` read failure degrades silently**
  (omits the Household section) rather than crashing or showing a visible
  error — the person IS the page's primary content and already loaded
  successfully; a non-essential second read failing shouldn't take the
  whole page down. Covered by its own regression test.

## New copy strings (for a fork's branding pass)

"Members" / "Households" (view toggle); "Showing {n} household(s)" (count);
"No households match "{search}". Try a different name." / "No households
are listed for {orgName} yet." (households empty states); "Contact" /
"Household" / "View household →" (person detail section headers); "Back to
directory" / "Back to households" (detail back-nav); "We couldn't find that
person" / "We couldn't find that household" (not-found pages, mirroring
`tickets/[id]/not-found.tsx`'s copy shape).

## Verification

- `npm run typecheck` — clean, zero errors anywhere in the tree.
- `npm run test` (Vitest, mocked suite) — 118 files / 1872 tests passed, 9
  files / 191 tests skipped (unrelated pre-existing skips + this
  increment's own DB-backed additions, skipped without `DATABASE_URL`). The
  directory subtree specifically: 9 files / 97 tests, all passing.
- DB-backed tests run for real against the dev database (`dotenv -e
  .env.local -- vitest run src/lib/directory.test.ts
  src/lib/org-portal/find-person.test.ts src/lib/org-portal/home-data.test.ts`)
  — 54/54 passed. `directory.test.ts` alone: 42/42 (20 pre-existing +
  22 new Increment-3 cases), including:
  - a `directory_hidden` person appears in NEITHER `getDirectory()`'s list,
    NOR any household's member list (`getHouseholdDetail`), NOR
    `getPersonDetail()` — all three checked in one test.
  - `getHouseholds()` drops a zero-visible-member household entirely.
  - `getHouseholdDetail()`/`getPersonDetail()` return `"not-found"` —
    never `"forbidden"`, never a thrown error — for: a genuinely
    nonexistent id, another organization's id (cross-org isolation, RLS +
    the `organization_id` predicate both proven), and a malformed
    (non-UUID) id.
  - a visitor with a live membership but no roll status is a grantee, not
    content, for `getPersonDetail()` too (mirrors `getDirectory()`'s own
    existing case).
  - hidden fields stay hidden through `getPersonDetail()`'s richer mapping.
- `npm run check` — all four tripwires pass. First run caught a real
  violation (`check:brand-scope` C2, hand-rolled button classes — see
  Divergence #1); fixed and re-verified clean.
- No `console.log`/`console.debug` in any file this increment created or
  modified (grepped the full diff).
- `npm run build` — clean production build, run LAST (after all browser
  verification below), against the dev server's own `.next` directory. Both
  new routes listed as dynamic (`ƒ`): `/o/[slug]/directory/[personId]` and
  `/o/[slug]/directory/households/[householdId]`. Learning the Increment-2
  incident's lesson: the dev server was stopped, `.next` deleted, and a
  fresh `next dev` started in the background (`/private/tmp/presby-dev.log`)
  AFTER the build, confirmed healthy via `curl` before finishing.
- **Real browser verification** (Playwright, `scratch/increment3-check.mjs`,
  gitignored, not committed), flags flipped ON in the dev database for the
  duration of the check, then flipped back OFF (Alder Creek's
  `organization_settings.require_two_factor` — same temporary-`false`-then-
  restore pattern Increments 1–2 used):
  - Confirmed BEFORE changing anything: `org_portal.directory`,
    `org_portal.directory_v2`, `org_portal.home_v2` all `false`; Alder
    Creek's `require_two_factor` `true` (Increment 2 had already restored
    both). Confirmed an exact matching final state after restoring.
  - `clerk.fixture@example.invalid` (Tobias Renwick) at 1280px and 390px:
    - **Households view** (`/o/alder-creek/directory?view=households`):
      the Members/Households toggle (Households active), "Showing 2
      households", two cards — "The Renwick Family" (Alder Creek, OH · 3
      members) and "Marguerite Ashcombe" (1 member, no city line — the
      "omitted when null" case, live on the same screen as the populated
      case).
    - **Household detail** (The Renwick Family): back link, full mailing
      address, "3 members" heading, three member cards (Priya Balakrishnan,
      Tobias Renwick — showing "Alder Creek" from his own address record,
      Hallie Vandermeer), each card linking to its own person-detail page.
    - **Person detail, direct URL** (Tobias Renwick): avatar, name,
      Contact block (his own address), Household section ("The Renwick
      Family", linked) with the OTHER two members' cards (Priya, Hallie —
      confirmed Tobias himself is excluded from his own household-members
      list).
    - **Person detail via a grid click**: clicked "Marguerite Ashcombe" on
      the members grid — landed on `/o/alder-creek/directory/c0000000-...-
      0001` with zero console errors; her one-member household still shows
      a Household section (name + link, no "other members" grid since she
      has none) and no Contact section (she has no seeded contact_methods —
      confirmed the "omit the whole section when every field is null" path
      works, not just the "field within a section" one).
    - **Person detail via find-a-person** (home page search box, real
      typed interaction + button click): searching "marguerite" landed on
      the SAME real person-detail route as the grid click, confirming
      `find-person-action.ts`'s Increment-3 line change works end to end,
      not just in the mocked unit test.
    - **Person detail with no household** (Rowan Thistlewood, the pastor):
      Contact and Household sections both correctly absent entirely — no
      empty headers, no blank space.
    - **not-found** (`/o/alder-creek/directory/not-a-real-id`): a genuine
      HTTP 404 (confirmed via a `response` listener, not just the URL),
      rendering the dedicated "We couldn't find that person" copy, with
      "Back to your organizations." One unrelated console warning
      ("Encountered a script tag while rendering React component") appears
      on this and every OTHER pre-existing `notFound()` page in the app
      (confirmed by reproducing it on `/o/nonexistent-org-slug-xyz` and
      `tickets/[id]`'s own not-found, neither touched by this increment) —
      a Next 16 dev-mode quirk, not a regression introduced here.
  - 390px, all of the above repeated: single-column households grid,
    single-column household-detail member list, no horizontal scroll,
    comfortable touch targets throughout.
  - What was done to the dev database, in order: confirmed pre-verification
    flag/2FA state; flipped `org_portal.directory`/`directory_v2`/`home_v2`
    to `true` and Alder Creek's `require_two_factor` to `false`; ran the
    Playwright script; flipped all three flags back to `false` and
    `require_two_factor` back to `true`; confirmed the final state matches
    the pre-verification state exactly with a follow-up `SELECT`.
  - Dev server: stopped and restarted cleanly (see the `npm run build` note
    above), healthy at the end of this session (`curl` 200 on `/`, 307 —
    the correct unauthenticated redirect — on `/o/alder-creek/directory`).

## What a reviewer should click through in the browser

1. Sign in as `clerk.fixture@example.invalid` /
   `e2e-fixture-only-not-a-secret`.
2. In the dev DB, flip `org_portal.directory` and `org_portal.directory_v2`
   to `true`; Alder Creek requires 2FA, so either enroll or temporarily set
   `organization_settings.require_two_factor = false` for
   `22222222-2222-2222-2222-222222222222`.
3. Visit `/o/alder-creek/directory`, click "Households". Confirm two cards:
   "The Renwick Family" (Alder Creek, OH · 3 members) and "Marguerite
   Ashcombe" (1 member, no city).
4. Click "The Renwick Family". Confirm the full mailing address, "3
   members", and three linked member cards.
5. Click "Tobias Renwick" from that list. Confirm his own detail page:
   avatar, name, address, and a Household section showing Priya and Hallie
   (not himself).
6. Go back to `/o/alder-creek/directory` (Members view) and click any
   name — confirm it lands on that person's detail page.
7. From `/o/alder-creek`, search "marguerite" in the find-a-person box —
   confirm it lands directly on Marguerite Ashcombe's detail page (not the
   search-results fallthrough).
8. Visit `/o/alder-creek/directory/not-a-real-id` directly — confirm a real
   404 page, not a crash or a blank screen.
9. Resize to 390px and repeat steps 3–5 — single column, no horizontal
   scroll, comfortable touch targets.
10. Restore whatever flags/settings you changed in step 2.

## Next

Increment 4 (deacon linkage — schema change, `directory.view_hidden`,
`DeaconCard`, parishes tab) remains, per the Phase 3 implementation order:
database-admin first (the migration + `officers.ts` schema change), then
full-stack-developer for the `includeHidden` plumbing, the parishes route,
`DeaconCard`, nav wiring, and the seed-dev.sql fixture. Handing to **qa**
for Phase 5 verification of Increment 3 specifically, per the design's own
recommendation to run Phases 4–6 as sequential sub-passes per increment.

## Per-Phase Status (Phase 4, Increment 3)

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 4 — Implementation (Increment 3: Households View + Detail) | full-stack-developer | Complete | — | 2026-08-24 |
| 4 — Implementation (Increment 4a: Deacon Linkage Schema) | database-admin | Complete | — | 2026-08-24 |
| 4 — Implementation (Increment 4b: `includeHidden`, Parishes Tab, DeaconCard) | full-stack-developer | Pending | — | — |

---

# Phase 4 — Implementation, Increment 4a: Deacon Linkage Schema (database-admin)

## Scope

Exactly the schema half of Increment 4 per the Phase 3 design: the
`officer_terms.org_unit_id` column (Drizzle + hand-written migration), the
`directory.view_hidden` permission-catalog row, the `diaconate_member` role and
its fixture bindings, and the `scripts/seed-dev.sql` fixture data (two
districts, one active deacon, one vacant district, one no-district household).
Did NOT touch `src/lib/directory.ts` (`includeHidden` plumbing), the parishes
route, `DeaconCard`, or nav wiring — all explicitly Increment 4b
(full-stack-developer), per the task brief and the Phase 3 implementation
order (schema lands first).

## Files created

- `drizzle/0025_presby_deacon_linkage.sql` — hand-written, idempotent (per
  CLAUDE.md: `db:generate` is broken on a pre-existing snapshot collision,
  `docs/TODO.md`; every migration past 0012 is hand-authored). Four pieces:
  1. `alter table officer_terms add column if not exists org_unit_id uuid`
     plus a `comment on column` recording the derivation rule and pointing
     at the CHECK below.
  2. Composite FK `officer_terms_org_unit_fk (org_unit_id, organization_id)
     references org_units(id, organization_id)`, guarded by `pg_constraint`
     existence (mirrors `memberships.orgUnitId`'s existing pattern, F2).
  3. CHECK `officer_terms_org_unit_deacon_check (org_unit_id is null or
     office = 'deacon')`, same guard style.
  4. `create index if not exists officer_terms_org_unit_idx on officer_terms
     (organization_id, org_unit_id, office, starts_on, ends_on)`.
  5. `insert into permissions (...) values ('directory.view_hidden', ...)
     on conflict (key) do nothing` — global catalog row, migration-seeded
     per 0017/0018's precedent (`permissions` carries no
     `organization_id`). No `app_roles`/`app_role_permissions`/
     `role_grants` row in the migration itself — those are org-scoped and
     have no production role-seeding surface yet (0018's own precedent for
     `stated_clerk`); fixture-only, in `scripts/seed-dev.sql`.
  6. RLS: **no policy change.** `officer_terms` already carries the
     standard `tenant_isolation` FORCE RLS policy
     (`drizzle/0009_presby_rls.sql`), keyed on `organization_id` alone — a
     nullable column addition needs nothing further. Confirmed live via
     `\d officer_terms` after applying (see Verification).

## Files modified

- `src/lib/db/domain/officers.ts` — `officerTerms` gains `orgUnitId: uuid
  ("org_unit_id")` (nullable, with a header comment recording the
  derivation rule and pointing at Phase 2's rejected shapes), plus in its
  `(t) => [...]` array: `officer_terms_org_unit_idx`
  (`organizationId, orgUnitId, office, startsOn, endsOn`), a composite
  `foreignKey` to `orgUnits(id, organizationId)`, and a `check()` matching
  the migration's CHECK verbatim (`sql` template, `drizzle-orm`). Imports
  `check` from `drizzle-orm/pg-core`, `sql` from `drizzle-orm`, and
  `orgUnits` from `./org` — none previously imported in this file. So
  `schema.ts` states the same shape the migration lands, per CLAUDE.md's
  "Schema Is the Source of Truth" (Drizzle Kit itself does not emit this;
  `db:push`/`db:generate` stay broken per 0017's own note, unaffected by
  this change).
- `scripts/seed-dev.sql`:
  - `permissions` insert block: added `directory.view_hidden` (duplicates
    the migration's own row, same `on conflict do nothing` pattern
    `directory.view`/`role_grants.manage` already established between
    0017/0018 and this file).
  - `app_roles` insert: added `diaconate_member`
    (`f0000000-...-0009`, Alder Creek, constitutional, protected) — the
    honest Session/Diaconate mirror of `session_member`
    (`f0000000-...-0001`), per Phase 3's exact naming.
  - `app_role_permissions` insert: `(diaconate_member,
    directory.view_hidden)` and `(stated_clerk, directory.view_hidden)` —
    the latter is the "Church Administrator" half of Phase 1's recommended
    binding; no such role exists in the catalog
    (`src/lib/db/domain/authz.ts`'s own comment names it aspirationally),
    so `stated_clerk` (already holding `role_grants.manage`) is the
    pragmatic stand-in Phase 3 named. No new `role_grants` row needed for
    Tobias Renwick — his existing `stated_clerk` grant now carries this too,
    same reasoning as `roll.propose`'s adjacent comment in this file.
  - `role_grants` insert: `diaconate_member` granted to the DERIVED Board of
    Deacons group (`b0000000-...-0002`), not to a person — the F3 shape,
    identical to `session_member`'s own grant to the derived Session group
    three blocks above it.
  - New block (districts, households, people, memberships, roll_actions,
    officer_terms) — see Seed data below.

## Schema

New column: `officer_terms.org_unit_id` (nullable `uuid`), composite FK to
`org_units(id, organization_id)`, `CHECK (org_unit_id is null or office =
'deacon')`, and a new supporting index. No table added — `org_units` and
`households.org_unit_id` already existed (households' own composite FK to
`org_units` predates this pipeline; confirmed by reading
`src/lib/db/domain/people.ts` before writing any migration, so no schema
change was needed there). New global permission-catalog row:
`directory.view_hidden` (module `directory`, tier 1).

## Migration mode

**`db:generate`** in spirit — a real, numbered, versioned migration file
(`drizzle/0025_presby_deacon_linkage.sql`) — but **hand-written**, per
CLAUDE.md's standing note that `db:generate` is broken on a pre-existing
`drizzle/meta/0008_snapshot.json` parent-collision (`docs/TODO.md`), so
every migration past 0012 is hand-authored and idempotent. Not `db:push`:
this ships. Checked `drizzle/` (`ls` showed `0024` as the latest — the
Phase 3 design's own guess of `0025` was correct, no renumbering needed)
and `docs/TODO.md`'s In Flight section (no concurrent schema pipeline
listed) before assigning `0025`, per the task brief's instruction.
`drizzle/meta/_journal.json` updated with the `0025_presby_deacon_linkage`
entry (`idx: 25`), matching how `0016`–`0024` are already registered there
despite having no corresponding snapshot file (snapshots stopped at
`0012`; the journal is kept current by hand for every migration since,
confirmed against `0023`/`0024`'s own precedent).

**Applied via:** hand-authored SQL, applied directly with
`psql "$MIGRATE_DATABASE_URL" -f drizzle/0025_presby_deacon_linkage.sql`
against the project's single shared dev database (no Neon branch — this
repo doesn't use a branch-per-slice workflow; `docs/testing.md` documents
the same direct-`psql` pattern for every migration `0010` onward). The
fixture delta (the new `scripts/seed-dev.sql` block plus the fixture-only
role/permission bindings) was applied the same way Increment 3 did it: as
a standalone set of `INSERT`s run directly against the dev database (NOT
by re-running the whole `scripts/seed-dev.sql` file, which is not
idempotent — its early blocks have no `ON CONFLICT` and would collide with
rows already seeded there), with the exact SQL also appended to
`scripts/seed-dev.sql` itself so a from-scratch
`psql -f scripts/seed-dev.sql` run produces the same fixture shape.
`npm run db:seed` was **not** needed — no `src/lib/permissions.ts`
`FEATURE_CATALOG` entry or flag changed in this increment (`directory.
view_hidden` is a tenant permission, not a platform feature/flag; `scripts/
seed.ts` never touches `permissions`/`app_roles`).

## Seed data (`scripts/seed-dev.sql`)

Ran directly against the dev database (recorded exactly, in order; full SQL
in the scratch delta file used for this session, and checked in verbatim in
`scripts/seed-dev.sql`'s own new block):

1. `directory.view_hidden` permission row (`on conflict do nothing`).
2. `diaconate_member` app_role, its two `app_role_permissions` rows
   (itself + `stated_clerk`), and its `role_grants` row to the Board of
   Deacons derived group.
3. Two `org_units` (`unit_type = 'district'`) at Alder Creek — the first
   rows in this table in the fixture: **North District**
   (`a2000000-...-0001`) and **South District** (`a2000000-...-0002`).
   (Not `g0000000-...` as first drafted — `g` is not a valid UUID hex
   digit; caught immediately by a real `psql` error on first apply attempt,
   fixed to the `a2` prefix before anything committed. See Verification.)
4. Two new people (Aldous Fennimore, Wren Thackeray — invented names,
   no real congregation/person per CLAUDE.md's No Real Data invariant) and
   two new households, one per district, `org_unit_id` set directly on
   each (**The Fennimore Family** → North District, **The Thackeray
   Family** → South District). The two PRE-EXISTING households (The
   Renwick Family, Marguerite Ashcombe) are **unchanged** — `org_unit_id`
   stays `NULL` on both, which is the "no district assigned at all" case
   the task brief asked for, obtained for free rather than by editing
   anything.
5. Matching `memberships` (household head, Alder Creek, `current_roll =
   'active'`) and `roll_actions` (`opening_balance`, matching
   `current_roll_since`) for both new people — kept internally consistent
   with the fixture's own established pattern (every membership with a
   `current_roll` gets a matching roll action) rather than introducing
   fresh, unexplained `presby_roll_cache_drift()` findings.
6. Two new `officer_terms` rows (`e0000000-...-0008`/`0009`, continuing
   after the seven pre-existing rows, exactly as the Phase 3 design named
   the id block), **both for Priya Balakrishnan** — the fixture's only
   person with an existing `deacon` ordination row, so both the active and
   the ended term reuse her history rather than inventing a second
   deacon-ordained person, per the Phase 3 design's own instruction
   ("reusing Priya Balakrishnan's existing deacon ordination/history where
   it fits the story"). Reads as F22's non-consecutive-terms pattern
   applied to the diaconate: `e...0008` (South District, `2025-02-01` to
   `2025-08-31`, `end_reason = 'completed'`) — the term that makes South
   District **vacant**; `e...0009` (North District, `2025-09-01`, open) —
   the term that makes North District **active**. Neither new range
   overlaps her pre-existing, undistricted deacon term (`e...0004`,
   `2022-01-09` to `2025-01-12`) or each other —
   `officer_terms_no_overlap` (`drizzle/0009_presby_rls.sql`) would have
   rejected any date range that did; confirmed by the insert succeeding
   cleanly (see Verification).

## Audit

None — no new mutation surface. `officer_terms.org_unit_id` is populated
here only by direct fixture `INSERT`s (matching how the rest of
`officer_terms` is fixture-seeded); the real mutation path (an
officer-terms admin UI) doesn't exist yet and is explicitly deferred, per
the Phase 3 design's own "Deacon assignment — explicitly deferred, not
built" note. `npm run check:audit` has nothing to flag.

## Verification

- Migration applied cleanly: `ALTER TABLE`, `COMMENT`, `DO` ×2, `CREATE
  INDEX`, `INSERT 0 1` — no errors.
- **`\d officer_terms`** (as the migration user, against the live dev
  database) confirms the column, the composite FK
  (`officer_terms_org_unit_fk`), the CHECK
  (`officer_terms_org_unit_deacon_check`), the new index
  (`officer_terms_org_unit_idx`), and the standard `tenant_isolation` FORCE
  RLS policy — all present, unchanged shape from before except the new
  column/FK/CHECK/index.
- **CHECK rejection, proven live**: an `INSERT` for `office =
  'clerk_of_session'` (Tobias Renwick) with `org_unit_id` set was rejected
  with `ERROR: new row for relation "officer_terms" violates check
  constraint "officer_terms_org_unit_deacon_check"`.
- **Composite FK rejection, proven live** (F2): created a real `org_units`
  row at Bramblewood, then attempted an Alder Creek `officer_terms` insert
  referencing it (`office = 'deacon'` — so the CHECK alone couldn't be
  what rejected it) — rejected with `ERROR: ... violates foreign key
  constraint "officer_terms_org_unit_fk" ... Key (org_unit_id,
  organization_id)=(..., 22222222-...) is not present in table
  "org_units"`. Cleaned up the test row afterward.
- **Derivation correctness, proven live**: a direct join query confirms
  North District resolves to Priya Balakrishnan (active, `ends_on` null)
  and South District resolves to no one (`ends_on` set, no successor) —
  the exact "vacant" case Increment 4b's `DeaconCard` needs to render.
- **`scripts/test-rls.sql`, new §18** ("Deacon linkage"): six new
  assertions — `org_units` tenant isolation (Alder sees 2, Bramblewood
  sees 0), the CHECK rejection (using Hallie Vandermeer, who holds no
  existing `officer_terms` row of any office — chosen specifically so
  `officer_terms_no_overlap` (§7) cannot also fire and make which
  constraint actually rejected the row ambiguous), the composite FK
  rejection (F2), and the North-active/South-vacant derivation counts.
  Run standalone as `presby_app` (extracted section, since §17's
  pre-existing, unrelated failure — see below — blocks the full file at
  `ON_ERROR_STOP=on`, which the file sets internally regardless of the
  command-line flag): **all six pass.**
  - §2's `officer_terms`/`memberships`/`people` count assertions updated
    for the new fixture rows (`officer_terms` 7→9, `memberships` 6→8,
    `people` 6→8), each with a comment explaining the delta.
  - **Two PRE-EXISTING, unrelated failures found while running the full
    suite, neither caused by this increment — flagging for whoever owns
    dev-database fixture hygiene next (the same class of issue Increment
    1 and Increment 2 already logged in their own Verification
    sections):**
    1. `presby_roll_cache_drift()` (§10) found one real drift row —
       organization `fpcw`, person "Admin Fixture" — entirely outside
       this pipeline's Alder Creek fixture and outside `scripts/
       seed-dev.sql` altogether (confirmed by querying both ids
       directly). Matches Increment 1's own documented finding that
       `admin@presby.invalid` "now holds a real membership at the fpcw
       organization (created in an earlier, unrelated session)." Since
       `presby_roll_cache_drift()` is `SECURITY DEFINER` and scans
       **every** org, not just the current GUC's org, this one stale row
       anywhere in the shared dev database fails §10 for everyone. Ran
       `presby_reconcile_current_roll()` (the documented, safe, daily
       remedy for exactly this — `drizzle/0012_presby_roll_read.sql`'s
       own comment) to unblock verification; it fixed exactly the one
       row found, confirming this increment introduced no new drift of
       its own.
    2. `organization_profiles`/`organization_service_times` (§17) already
       carry REAL data for Alder Creek — an address/phone and two service
       times ("Sunday Worship" etc.), evidently entered through the real
       admin editor in an earlier session, not test-suite pollution (the
       literal values don't match the test's own fixture strings). §17's
       own test assumes zero pre-existing rows before it inserts and
       rolls back its own — an assumption a real admin-UI walkthrough has
       since invalidated. **Left this data untouched** — deleting
       real-looking admin-entered content to make a test pass would be
       the wrong fix for a test-fixture staleness bug, and is out of
       scope for this increment (unrelated table, unrelated feature).
       This is why the full `scripts/test-rls.sql` run in this session
       could not be completed end-to-end at `ON_ERROR_STOP=on`; §1–§16
       and the standalone §18 extraction both confirmed passing.
- `npm run typecheck` — clean, zero errors anywhere in the tree (the
  `presby-site-kit` errors Increment 2's own Verification section flagged
  as pre-existing/unrelated are gone — resolved by whichever concurrent
  pipeline owned them; not touched here).
- `npm run test` (Vitest, mocked suite) — 118 files / 1872 tests passed, 9
  files / 191 tests skipped — byte-identical to Increment 3's own numbers
  (no test file touched in this increment).
- DB-backed tests, run for real (`dotenv -e .env.local -- vitest run
  src/lib/directory.test.ts src/lib/org-portal/find-person.test.ts
  src/lib/org-portal/home-data.test.ts`) — 54/54 passed, unaffected by
  the new Alder Creek fixture rows: this suite creates its own synthetic
  `orgA`/`orgB` (random UUIDs) rather than reading the shared Alder Creek
  fixture, confirmed by reading the file's own `beforeAll` before running
  anything.
- `npm run check` — all four tripwires pass (audit, sql-date, deps-drift,
  brand-scope). No mutations/routes in this increment, so `check:audit`
  had nothing to flag.
- `npm run docs:erd` (via `npx dotenv -e .env.local -- tsx scripts/
  generate-erd.ts` — the bare `npm run docs:erd` fails with `DATABASE_URL
  is not set`, since the script itself doesn't source `.env.local`) —
  regenerated `docs/schema-design.md`'s mermaid diagrams from the live
  schema (9 diagrams, 68 tables). The new `org_units |o--o{ officer_terms
  : "org_unit_id"` edge appears exactly where expected. The regeneration
  also picked up several genuine, pre-existing staleness fixes unrelated
  to this increment (three `||--o{` → `|o--o{` nullable-FK corrections and
  two missing edges from earlier pipelines that never ran the generator)
  — kept them, since they're accurate current-schema output from the same
  tool this task calls for, not something to hand-revert.
- No `console.log`/`console.debug` — no application code (only SQL/schema)
  touched in this increment.

## Divergences from the task brief

1. **`g0000000-...` was never usable** — `g` is not a valid UUID hex
   digit. Caught by a real `psql` error on the first apply attempt (before
   anything committed); switched to `a2000000-...` (an unused sub-prefix
   under the existing `a` block — `a0` is `group_types`, `a1` is
   `addresses`). Fixed in the same session before any downstream artifact
   (seed file, test file, this work-log) referenced the wrong prefix.
2. **The task brief's "reusing Priya Balakrishnan's existing deacon
   ordination/history" is read as covering BOTH new officer_terms rows**,
   not only the active one — see Seed data point 6 above for the
   reasoning (she is the fixture's only deacon-ordained person; inventing
   a second one for the vacant term alone would have been a needless new
   person with no other narrative purpose).

## Next

**Increment 4b** (full-stack-developer): `includeHidden?: boolean` on
`getDirectory`/`getHouseholds`/`getHouseholdDetail`/`getPersonDetail`
(re-verified against `directory.view_hidden` inside each function, never
trusted from the caller); `getParishRoster()`; the `directory/parishes/
page.tsx` route; `src/components/org-portal/deacon-card.tsx` (shared by
household and person detail, neutral "no deacon assigned" state for both
`org_unit_id is null` and a vacant district); the lock-badge UI for hidden
rows; nav wiring for the Parishes tab (gated on `directory.view_hidden`
directly, not a flag); and the seed-dev.sql fixture note in `docs/
testing.md`'s Accounts table if a new sign-in-capable fixture person is
added to exercise `diaconate_member` through a real browser session (none
was added in 4a — no fixture person holds `diaconate_member` today; only
`stated_clerk`/Tobias Renwick has `directory.view_hidden`, reachable via
the existing `clerk.fixture@example.invalid`).

**Handoff summary for the next implementer:**
- New column: `officer_terms.org_unit_id` (nullable `uuid`), Drizzle field
  `officerTerms.orgUnitId`. Composite FK to `org_units(id,
  organization_id)`. `CHECK (org_unit_id is null or office = 'deacon')`.
- New permission: `directory.view_hidden` (module `directory`, tier 1) —
  already bound, in the fixture, to `diaconate_member` (→ Board of Deacons
  derived group) and to `stated_clerk` (→ Tobias Renwick, `clerk.
  fixture@example.invalid`).
- Derivation query (the one to share, not hand-copy, per the Phase 3
  cross-cutting risk note): `officer_terms where office = 'deacon' and
  org_unit_id = <households.org_unit_id> and ends_on is null`, tie-break
  `starts_on desc, id asc` per the Phase 3 design.
- Local apply command for anyone pulling this slice fresh: `psql
  "$MIGRATE_DATABASE_URL" -f drizzle/0025_presby_deacon_linkage.sql` then
  `psql "$MIGRATE_DATABASE_URL" -f scripts/seed-dev.sql` (or, on an
  already-seeded database, only the new block at the end of that file).
  `npm run db:seed` is not needed for this slice specifically (no
  platform-side flag/feature changed), but is harmless/idempotent to run
  regardless.
- Fixture data to build against: North District (`a2000000-...-0001`,
  active deacon Priya Balakrishnan, household "The Fennimore Family")
  South District (`a2000000-...-0002`, vacant, household "The Thackeray
  Family"), and the two pre-existing households (Renwick Family,
  Marguerite Ashcombe) with `org_unit_id` still `NULL`.

Handing to **full-stack-developer** for Increment 4b.

## Per-Phase Status (Phase 4, Increment 4a)

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 4 — Implementation (Increment 4a: Deacon Linkage Schema) | database-admin | Complete | — | 2026-08-24 |
| 4 — Implementation (Increment 4b: `includeHidden`, Parishes Tab, DeaconCard) | full-stack-developer | Complete | — | 2026-08-24 |

---

# Phase 4 — Implementation, Increment 4b: `includeHidden`, Parishes Tab, DeaconCard (full-stack-developer)

## Scope

Exactly the server/UI half of Increment 4 per the Phase 3 design and 4a's own
handoff: `includeHidden` plumbing on all four `src/lib/directory.ts` readers,
the shared deacon derivation, `getParishRoster()`, the `directory/parishes`
route, `DeaconCard`, the lock-badge UI, nav wiring, and one
`directory_hidden = true` fixture person so the elevated path is exercisable
in a real browser. This is the FINAL increment of the whole pipeline — all
four increments (1, 2, 3, 4a, 4b) are now shipped.

## Files created

- `src/components/org-portal/deacon-card.tsx` + `deacon-card.test.tsx` —
  `<DeaconCard deaconName>`, shared by household and person detail, rendered
  LAST on both (Phase 1's Flow 5). `deaconName === null` covers TWO causes
  deliberately left indistinguishable — no district assigned, and a vacant
  district — both render the same neutral "No deacon is currently assigned"
  copy with a muted placeholder icon; a populated deacon renders an
  initials-fallback avatar (via the existing `<PersonAvatar>`) and the name.
  No lock indicator on this card — see its own header for why (a deacon is
  shown BY OFFICE, not gated by the deacon's own directory privacy).
- `src/app/(org)/o/[slug]/directory/directory-nav.tsx` — `<DirectoryNav>`,
  extracted from `page.tsx`'s private `DirectoryViewTabs` (Increment 3) into
  a shared component so `directory/parishes/page.tsx` renders the identical
  Members/Households/Parishes nav rather than a hand-copied one. The
  Parishes tab is shown only when the caller passes `canViewHidden={true}` —
  every caller computes that via `hasPermission(..., 'directory.view_hidden')`
  directly, never a flag, per the Phase 3 design's literal instruction.
- `src/app/(org)/o/[slug]/directory/parish-roster.tsx` — `<ParishRoster>`,
  the deacon-roster card grid: org-unit name, "Deacon: {name}" or "Deacon:
  Vacant", and a household-count badge, sourced directly off
  `getParishRoster()`'s own `ParishRosterEntry[]` — no re-derivation.
- `src/app/(org)/o/[slug]/directory/parishes/page.tsx` +
  `parishes/page.test.tsx` — `/o/<slug>/directory/parishes`. Full `(org)`
  auth pattern; reachability rides on `org_portal.directory_v2` alone (no
  new flag); the actual gate is `getParishRoster()`'s own
  `directory.view_hidden` re-check, mapped to the SAME `DirectoryForbidden`
  state every other permission denial in this tree uses (not a 404) — the
  Phase 3 design's explicit instruction for a deep link without the grant.
- `scratch/increment4b-check.mjs`, `scratch/increment4b-hidden-check.mjs` —
  gitignored Playwright verification scripts (not committed).

## Files modified

- `src/lib/directory.ts` — the biggest change in this increment:
  - `directoryEligibilityWhereSql(includeHidden: boolean)` now takes a
    parameter; when `true` it drops ONLY the `directory_hidden` term — every
    other eligibility rule (not merged, not deceased, current-roll/
    engagement) and all FIVE field-level hides (`hide_email` etc.) are
    UNCHANGED. This is the literal reading of the Phase 3 design's own text
    ("the `directory_hidden` exclusion is dropped and `DirectoryEntry`
    gains `isHidden: boolean`") — see "Divergences" below for why this,
    not the task brief's looser "hidden fields... with the lock indicator"
    phrasing, governed the implementation.
  - `queryDirectoryRows()` gains `opts.includeHidden`; the SELECT list
    gains `coalesce(pp.directory_hidden, false) as is_hidden`, mapped onto
    every `DirectoryEntry` as `isHidden` (always computed, never only for
    elevated results — safe because an ordinary caller's rows can never
    have `isHidden: true` in the first place, since such a row would have
    been excluded by the WHERE clause).
  - New `checkViewHidden()` — the `directory.view_hidden`
    `presby_has_permission()` check, the same shape as the existing
    `checkDirectoryView()`. Every one of `getDirectory()`,
    `getHouseholds()`, `getHouseholdDetail()`, `getPersonDetail()` computes
    `includeHidden = Boolean(opts?.includeHidden) &&
    (await checkViewHidden(...))` — the caller's request is a hint, this
    re-check inside the SAME transaction is the only thing that can ever
    honor it.
  - New `deriveDeaconsByOrgUnit()` — THE shared deacon derivation
    (`officer_terms` joined to `people`, `office = 'deacon' and ends_on is
    null`, `distinct on (org_unit_id) order by org_unit_id, starts_on desc,
    id asc`), batched across every org unit id a caller needs in one round
    trip. Used by `getHouseholds()`, `getHouseholdDetail()`, and
    `getParishRoster()` — never a second hand-copied query, per Phase 3's
    own cross-cutting risk note.
  - `getHouseholds()`/`getHouseholdDetail()` now populate the real
    `deaconName` (previously always `null`); both select
    `households.org_unit_id` and pass it through `deriveDeaconsByOrgUnit()`.
  - New `getParishRoster(personId, organizationId):
    GetParishRosterResult` — gated on `directory.view_hidden` ALONE (not
    `directory.view`), per the design's literal text. Lists every org unit
    in the organization; household counts are computed from the SAME
    `queryDirectoryRows({ includeHidden: true })` call `getHouseholds()`
    uses, grouped by `households.org_unit_id` — proven, not just asserted,
    to never drift from the Households tab (a dedicated test compares the
    two directly).
- `src/app/(org)/o/[slug]/directory/person-card.tsx` — renders a `Lock`-icon
  `Badge` ("Hidden from the directory") when `entry.isHidden`, ahead of the
  email/phone lines. No new prop — `entry.isHidden` alone is the source of
  truth, safe unconditionally per the field's own contract.
- `src/app/(org)/o/[slug]/directory/[personId]/page.tsx` — computes
  `canViewHidden` via `hasPermission(..., 'directory.view_hidden')`; threads
  it into BOTH `getPersonDetail()` and the secondary `getHouseholdDetail()`
  read via a conditional-arity call (4 args with `{ includeHidden: true }`
  only when `canViewHidden`, otherwise the byte-identical 3-arg call
  Increment 3 shipped — see Divergences); renders a lock badge next to the
  `<h1>` when `entry.isHidden`; renders `<DeaconCard>` LAST (after the
  Household section), sourced from `household.deaconName`, omitted entirely
  only when the person has no household at all to source a district from.
- `src/app/(org)/o/[slug]/directory/households/[householdId]/page.tsx` —
  same `canViewHidden`/conditional-arity pattern for `getHouseholdDetail()`;
  moved the `<DeaconCard>` placeholder comment to render LAST, after the
  member grid (Increment 3's placeholder had it BEFORE the members section —
  Phase 1's Flow 5 explicitly calls for "last", so this increment corrects
  the placement rather than keeping the placeholder's original spot).
- `src/app/(org)/o/[slug]/directory/page.tsx` — computes `canViewHidden`
  (only when `directoryV2Enabled` — `hasPermission` is never called on the
  v1 regression floor); threads `includeHidden: true` into `getDirectory()`/
  `getHouseholds()`'s `opts` object ONLY when `canViewHidden` (an ordinary
  caller's `opts` is the byte-identical `{ search }` shape Increment 2/3
  shipped); replaced the private `DirectoryViewTabs` function with the new
  shared `<DirectoryNav>`, passing `canViewHidden` through for the Parishes
  tab's visibility.
- `src/lib/directory.test.ts` — extended (not replaced) with a new
  Increment 4 fixture block (two districts, four deacon officer-term rows
  covering active/tie-break/ended/cross-org, three new households, a
  `diaconate` derived group at both orgA and orgB — required by
  `presby_sync_derived_group()`'s own F16 guard before any `office =
  'deacon'` row can be inserted, a real trigger requirement this increment's
  fixture had to satisfy — an elevated-viewer person with a direct
  `directory.view_hidden` grant, and a person whose grant has ENDED) and
  three new `describe` blocks (27 new DB-backed tests: `includeHidden`
  re-verification, deacon derivation, `getParishRoster`). Every pre-existing
  test in this file is unmodified and still passes (69/69 total).
- `src/app/(org)/o/[slug]/directory/page.test.tsx`,
  `[personId]/page.test.tsx`, `households/[householdId]/page.test.tsx` —
  each gained a `hasPermission` mock in its `@/lib/authz` mock block
  (defaulted to `false` in `afterEach`, so every pre-existing test in these
  three files needed ZERO changes — the new collaborator's default matches
  the old behavior exactly) plus new `describe` blocks covering the
  `includeHidden` conditional-arity call contract, the lock badge, and
  `DeaconCard` rendering.
- `src/app/(org)/o/[slug]/directory/directory-grid.test.tsx` — two new tests
  for the lock badge (present when `isHidden: true`, absent otherwise).
- `scripts/seed-dev.sql` — one new block: `person_privacy.directory_hidden =
  true` for Desmond Okonkwo (`c0000000-...-0004`, an existing
  "other_participant" person with no household — chosen specifically so
  marking him hidden has zero narrative side-effects on any other
  increment's fixture story), `on conflict (person_id) do update` for
  idempotency. Confirmed via query BEFORE writing this block that no
  increment 1–3 fixture person already carried `directory_hidden = true` —
  none did, so the elevated path was otherwise unexercisable through a real
  browser session. Applied directly to the dev database (see Verification).

## Schema

None. Increment 4b is entirely read-path/UI, consuming the
`officer_terms.org_unit_id` column and `directory.view_hidden` permission
4a already shipped. No `db:push`/`db:generate`/migration.

## Audit

None — read-only surface, matches the Phase 3 design's "no audit events
ship in this pipeline" for all four increments. `npm run check:audit` has
nothing to flag.

## The deacon-own-privacy ruling (task-directed — recorded explicitly)

**Ruling: a deacon is shown BY OFFICE, regardless of the deacon's own
`directory_hidden`/field-level privacy settings — the SAME way fpcw-directory
(Phase 1's prior-art survey) shows a parish's deacon regardless of that
deacon's own directory preferences.**

The Phase 3 design text has no separate prose sentence stating this — it is
not silent by omission so much as it never poses the question in words.
What settles it is the SHAPE of the design's own code fence:
`getParishRoster()`'s `ParishRosterEntry.deaconName` is typed as a plain
`string | null`, and the design's derivation rule ("derives each org unit's
deacon from `officer_terms` where `office = 'deacon'` and `org_unit_id =
...` and `ends_on is null`") is written entirely in terms of
`officer_terms`/`people` — never once mentioning `queryDirectoryRows()`,
`directoryEligibilityWhereSql()`, or any privacy predicate at all. Household/
person `deaconName` sourcing is explicitly required to "reuse this exact
derivation, never a second copy." A design that intended the deacon's own
privacy settings to apply would have had to route the derivation through the
privacy-filtered read — the one query in this whole feature area that
already knows how to null a hidden field — and the design conspicuously
never does that.

This reading is also the only one consistent with **"The Court Is Not a
Group"**: `officer_terms`/the materialized diaconate roster already publish
who serves as deacon regardless of that person's own directory preferences
(a Session member's name is equally public via the same mechanism). Gating
the DISTRICT ASSIGNMENT of an already-public office behind the office
holder's own, unrelated privacy toggle would be a strange, inconsistent
carve-out with no analogue anywhere else in the schema.

**Practical consequence:** if a deacon set `directory_hidden = true` on their
OWN record, they would still appear as "Deacon: {name}" on every household/
person/parish card their district touches — their own detail page, reached
by clicking their own name elsewhere in the directory, would still enforce
`directory_hidden` normally (an ordinary viewer gets `not-found`; an elevated
one sees them with the lock badge). Only the DERIVED DISPLAY of who serves as
deacon is unaffected by their personal privacy settings — their contact
information, address, and every other directory field remain governed by
their own privacy flags exactly as before. No fixture person in this
pipeline's data happens to be both `directory_hidden` and a deacon, so this
is a structural/code-reading conclusion, not something a screenshot proves —
flagging explicitly for qa/analyst to weigh whether that combination deserves
its own regression test in a follow-up.

## Multiple-deacon handling (task-directed — recorded explicitly)

**The Phase 3 design is NOT silent here** (unlike the task brief's own
hypothetical "if the design is silent, render all, ordered by starts_on, and
note the divergence" fallback) — its own edge-case list states this
verbatim: "Two active deacon terms for one org unit (a data anomaly the
CHECK doesn't prevent) — resolved by the same deterministic tie-break
everywhere, documented as a display choice, not fixed here." So this
increment implements exactly ONE winner per org unit, chosen by `starts_on
desc, id asc` (`distinct on (org_unit_id)` in `deriveDeaconsByOrgUnit()`),
never "render all." Proven live: the fixture's `orgUnitActive` carries TWO
simultaneously-active deacon terms for two different people (`deaconActive1`
starting 2020-01-01, `deaconActive2` starting 2022-06-01) —
`getHouseholds()`/`getHouseholdDetail()`/`getParishRoster()` all resolve to
`deaconActive2` alone (`directory.test.ts`'s "two active deacon terms... are
resolved by the deterministic tie-break" test), and the household/roster
outputs never contain `deaconActive1`'s name at all.

## Divergences from the Phase 3 design text

1. **Field-level privacy flags are UNCHANGED for an elevated viewer —
   `includeHidden` lifts ONLY the row-level `directory_hidden` exclusion.**
   The task brief's own summary phrase ("Elevated viewers see privacy-hidden
   rows and hidden fields WITH the lock indicator") reads as broader than
   the Phase 3 design's own literal text ("the `directory_hidden` exclusion
   is dropped and `DirectoryEntry` gains `isHidden: boolean`" — no mention
   of the five `hide_email`/`hide_phone`/`hide_address`/`hide_birthday`/
   `hide_photo` CASE WHENs being bypassed). Followed the design text as
   authoritative, per this task's own repeated instruction to do so. A
   diaconate member elevated to see a `directory_hidden` row therefore still
   sees that row's individually-hidden fields nulled, exactly as an ordinary
   viewer would if the row weren't hidden at all — a real, intentional
   narrowing of "elevated" relative to the task brief's own looser
   description, verified by a dedicated DB-backed test
   (`directory.test.ts`: "field-level hides are UNCHANGED for an elevated
   caller"). Flagging explicitly for qa/analyst: if the intended UX is
   broader (elevated viewers should see hidden fields too, with their own
   lock marker), that is a Phase 3 design correction, not a Phase 4
   implementation bug — the code faithfully implements the design as
   written.
2. **`getParishRoster()` is gated on `directory.view_hidden` ALONE, not
   `directory.view` too.** The design's own text says "requires
   `directory.view_hidden`" without mentioning `directory.view` — followed
   literally. In practice every fixture person who holds
   `directory.view_hidden` also holds `directory.view` (both `diaconate_
   member` and `stated_clerk` carry `directory.view` via other bindings),
   so this narrower reading has no observable effect on any real role
   today, but the code does not hard-require the combination.
3. **`DeaconCard` carries no lock indicator of its own, and no explicit
   design sentence rules on this.** Reasoned from the same structural
   evidence as the deacon-own-privacy ruling above: a lock badge marks a
   DIRECTORY ROW an elevated viewer is seeing that an ordinary viewer
   wouldn't — it has no meaning for a deacon shown by office to every
   viewer who can reach the card at all (nobody is "elevated" relative to
   seeing who the deacon is; that information was never hidden from anyone
   in the first place under this ruling).

## New copy strings (for a fork's branding pass)

"Deacon" / "No deacon is currently assigned" (`DeaconCard`); "Parishes"
(nav tab); "{orgName} has no districts or parishes set up yet." (parishes
empty state); "Deacon: {name}" / "Deacon: Vacant" / "{n} household(s)"
(parish roster card); "Hidden from the directory" (lock badge, person card
and person-detail heading).

## Verification

- `npm run typecheck` — clean, zero errors anywhere in the tree.
- `npm run test` (Vitest, mocked suite) — 120 files / 1907 tests passed, 9
  files / 218 tests skipped (unrelated pre-existing skips + every DB-backed
  file, skipped without `DATABASE_URL`). Zero regressions: every Increment
  1–3 test in every file this increment touched passed UNCHANGED (the
  `hasPermission` mock's `false` default reproduces the old call shapes
  exactly).
- DB-backed tests run for real against the dev database (`dotenv -e
  .env.local -- vitest run src/lib/directory.test.ts`) — **69/69 passed**
  (42 pre-existing + 27 new Increment-4 cases): `includeHidden`
  re-verification on all four readers (ordinary caller ignored, elevated
  caller honored, a request without the grant ignored even for someone who
  otherwise holds `directory.view`, a grant that has ENDED treated
  identically to never-granted, field-level hides unchanged under
  `includeHidden`), deacon derivation (active, vacant/ended-excluded,
  no-district, the deterministic tie-break for two simultaneously-active
  terms, cross-org isolation), and `getParishRoster()` (forbidden for a
  non-holder and for an ended grant, active/vacant listing, household-count
  parity with `getHouseholds()`, cross-org isolation, `OrgAccessError`
  propagation). Also re-ran `src/lib/org-portal/find-person.test.ts` and
  `home-data.test.ts` (12/12) — unaffected, confirmed by reading their own
  synthetic-org fixtures before running anything.
- `npm run check` — all four tripwires pass (audit, sql-date, deps-drift,
  brand-scope). No mutations in this increment, so `check:audit` had
  nothing to flag.
- `npx eslint` on every file this increment created or modified — clean.
- No `console.log`/`console.debug` in any file this increment created or
  modified (grepped the full diff; the only repo-wide hits are
  `scripts/seed.ts`'s pre-existing, legitimate CLI-progress lines, untouched
  here).
- `npm run build` — clean production build, run LAST after all browser
  verification below. `/o/[slug]/directory/parishes` listed as a new
  dynamic (`ƒ`) route alongside the pre-existing directory routes. Learned
  Increment 2's own incident: the dev server was stopped and `.next` deleted
  BEFORE the build, then a fresh `npm run dev` started in the background
  (`/private/tmp/presby-dev.log`) AFTER, confirmed healthy via `curl` before
  finishing.
- **Real browser verification** (Playwright, `scratch/increment4b-check.mjs`
  and `scratch/increment4b-hidden-check.mjs`, both gitignored, not
  committed), flags flipped ON in the dev database for the duration of the
  check, then flipped back OFF (Alder Creek's `organization_settings.
  require_two_factor` — same temporary-`false`-then-restore pattern every
  prior increment used):
  - Confirmed BEFORE changing anything: `org_portal.directory`/
    `directory_v2` both `false`; Alder Creek's `require_two_factor` `true`
    (Increment 4a had already restored both). Confirmed an exact matching
    final state after restoring.
  - Applied `scripts/seed-dev.sql`'s new block directly to the dev database
    (Desmond Okonkwo → `directory_hidden = true`) — confirmed via query
    before and after that no other fixture person already carried this.
  - `clerk.fixture@example.invalid` (Tobias Renwick, holds
    `directory.view_hidden` via `stated_clerk`) at 1280px and 390px:
    - **North District household** (The Fennimore Family): `<DeaconCard>`
      renders LAST, showing "Deacon / Priya Balakrishnan" with a "PB"
      initials avatar.
    - **Aldous Fennimore's own person detail** (North District household
      head): the SAME `<DeaconCard>` — "Priya Balakrishnan" — renders last,
      after the Household section, sourced from the SAME
      `household.deaconName` the household page itself shows (no drift).
    - **South District household** (The Thackeray Family, vacant — an
      ended-only deacon term with no successor): `<DeaconCard>` renders the
      neutral "No deacon is currently assigned" state — never a stale name,
      never omitted.
    - **Parishes roster** (`/o/alder-creek/directory/parishes`): both
      districts listed, "North District — Deacon: Priya Balakrishnan — 1
      household" and "South District — Deacon: Vacant — 1 household". The
      Members/Households/Parishes nav shows all three tabs, Parishes
      current.
    - **Members grid, elevated**: "Showing 8 members" (one more than an
      ordinary viewer's 7 — Desmond Okonkwo, `directory_hidden`, now
      visible), with a "Hidden from the directory" lock badge (icon + text,
      never color alone) on his card.
    - **Desmond Okonkwo's own person detail, direct URL**: reachable
      (`includeHidden` honored), heading renders, lock badge renders next
      to the name.
    - Zero console errors across every one of the above.
  - `elder.fixture@example.invalid` (Marguerite Ashcombe, holds
    `support_contact` only — NOT `directory.view_hidden`):
    - No "Parishes" tab visible on `/o/alder-creek/directory`.
    - Deep link to `/o/alder-creek/directory/parishes`: HTTP 200 (not a
      404), rendering the `DirectoryForbidden` "You don't have permission to
      view the directory" copy — the design's own chosen response, verified
      as an actual HTTP status via Playwright's response listener, not just
      the rendered text.
    - Members grid: "Desmond Okonkwo" absent entirely (7 members, matching
      the pre-Increment-4 count).
    - Direct URL to Desmond Okonkwo's person detail: a genuine HTTP 404
      ("We couldn't find that person"), byte-identical to Increment 3's own
      documented not-found shape — including the same benign, pre-existing
      "script tag" Next 16 dev-mode console warning Increment 3 already
      identified and ruled unrelated on every `notFound()` page in the app.
  - 1280px and 390px screenshots confirm: no horizontal scroll, comfortable
    touch targets, the lock badge and DeaconCard both readable and
    unclipped at 390px (screenshots at `/tmp/inc4b-*.png`, not committed).
  - What was done to the dev database, in order: confirmed pre-verification
    flag/2FA state; applied the `directory_hidden` fixture insert; flipped
    `org_portal.directory`/`directory_v2` to `true` and Alder Creek's
    `require_two_factor` to `false`; ran both Playwright scripts; flipped
    both flags back to `false` and `require_two_factor` back to `true`;
    confirmed the final state matches the pre-verification state exactly
    with a follow-up `SELECT`. The `directory_hidden` fixture row is a
    PERMANENT, intentional addition (also checked into
    `scripts/seed-dev.sql`), not reverted.
  - Dev server: stopped, `.next` deleted, production build run, fresh `npm
    run dev` started in the background — healthy at the end of this session
    (`curl` 200 on `/`, 307 on `/o/alder-creek/directory`).

## What a reviewer should click through in the browser

1. Sign in as `clerk.fixture@example.invalid` /
   `e2e-fixture-only-not-a-secret`.
2. In the dev DB, flip `org_portal.directory` and `org_portal.directory_v2`
   to `true`; Alder Creek requires 2FA, so either enroll or temporarily set
   `organization_settings.require_two_factor = false` for
   `22222222-2222-2222-2222-222222222222`.
3. Visit `/o/alder-creek/directory/households/d0000000-0000-0000-0000-000000000003`
   (The Fennimore Family, North District). Confirm a `DeaconCard` renders
   LAST, showing Priya Balakrishnan.
4. Visit `/o/alder-creek/directory/households/d0000000-0000-0000-0000-000000000004`
   (The Thackeray Family, South District, vacant). Confirm the neutral "No
   deacon is currently assigned" state.
5. Visit `/o/alder-creek/directory/parishes`. Confirm both districts, Priya
   as North's deacon, South marked Vacant, and household counts.
6. Visit `/o/alder-creek/directory`. Confirm a "Parishes" tab exists, and
   Desmond Okonkwo's card carries a "Hidden from the directory" lock badge
   ("Showing 8 members").
7. Sign out; sign in as `elder.fixture@example.invalid` (same password).
   Confirm NO "Parishes" tab on `/o/alder-creek/directory`, Desmond Okonkwo
   absent from the grid ("Showing 7 members"), and a direct visit to
   `/o/alder-creek/directory/parishes` renders "You don't have permission,"
   not a 404.
8. Resize to 390px and repeat steps 3–6 — no horizontal scroll, the lock
   badge and `DeaconCard` both legible.
9. Restore whatever flags/settings you changed in step 2. (The
   `directory_hidden` fixture on Desmond Okonkwo is meant to stay — do not
   revert it.)

## Next

All four increments of this feature are now implemented. Handing to **qa**
for Phase 5 verification of Increment 4 (4a + 4b together, since 4a shipped
no user-facing surface of its own to verify independently) — per the design's
"Overall Implementation Order," this is the final sub-pass before Phase 6.

## Per-Phase Status (Phase 4, Increment 4b)

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 4 — Implementation (Increment 4b: `includeHidden`, Parishes Tab, DeaconCard) | full-stack-developer | Complete | — | 2026-08-24 |


---

# Phase 5 — Test Verification (qa)

**Date:** 2026-08-24 · **Verified by:** qa · **Verdict: PASS**

## Type Check / Unit / Build / Tripwires

- `npm run typecheck`: PASS, zero errors.
- Mocked suite: **1907 passed / 0 failed / 218 skipped** — all 9 skipped files independently confirmed to be the house `skipIf(!hasDb)` guard; none unaccounted for.
- DB-backed: **93/93** (`directory.test.ts` alone 69/69, matching Phase 4's claim). Coverage: `directory.ts` 96.4% stmts / 100% funcs; org-portal libs 100%.
- `npm run check`: all four tripwires clean. `npm run build`: clean; all five new routes dynamic.

## End-to-End

`header-controls` + `post-login-routing`: **32/33**. The 1 failure (`post-login-routing.spec.ts:53`) independently root-caused to the documented pre-existing dev-DB pollution — `admin@presby.invalid` holds a real active `fpcw` membership (created 2026-08-24 21:46 in an earlier session), which legitimately routes `/admin`-expecting case to `/orgs`. Not this feature's regression; this pipeline never writes to fpcw.

No dedicated e2e spec exists yet for the new directory/household/parish routes — safe today only because `org_portal.home_v2`/`directory_v2` ship seeded OFF. Named gap (1) below.

## Regression Tests Verified Present

Cross-surface hidden-person exclusion (`directory.test.ts:970`), search-vs-privacy ordering (`:822`), zero-visible-household drop (`:867`), ended `view_hidden` grant treated as revoked (`:1034`), field-level hides unchanged for elevated callers (`:1066`), deacon tie-break determinism (`:1157`), parish/household count parity (`:1267`), find-person hidden-person exclusion (`find-person.test.ts:259`), flag-OFF `getDirectory` call-shape pin (`page.test.tsx:271`). QA confirmed existence + passing, not red→green observation (implementer's account in Phase 4 covers that).

## Feature-Gate Audit (read from route/action bodies)

Every page: `cachedAuth` → callbackUrl redirect → `resolveOrgContext` + `assertOrgAccess` → flag gates (`org_portal.directory` + `directory_v2`; home on `home_v2`). `findPersonAction` uses `auth()` (correctly not `cachedAuth` in a server action) and re-checks `directory.view` inside `findPersonMatches()` via `presby_has_permission()`. `directory.view_hidden` is double-checked: page-level for UI, and re-verified inside `checkViewHidden()` before `includeHidden` is honored (`directory.ts:392-411`) — the lib never trusts the caller. Parishes page's real gate is `getParishRoster()`'s own server-side check. `getPlatformDb()`: **zero hits** in the production (org)/directory/org-portal surface (only in two test fixtures, the documented exception).

## Privacy Verification (highest-risk item)

One shared predicate (`directoryEligibilityWhereSql()`/`queryDirectoryRows()`, `directory.ts:204-320`) routes `getDirectory`/`getHouseholds`/`getHouseholdDetail`/`getPersonDetail`. `getParishRoster` is the one documented deliberate exception (deacon-by-office, work-log ruling recorded with reasoning). `findPersonMatches()` is a sixth inline copy — QA diffed its WHERE clause against the shared helper and confirmed **identical today**; named drift risk (3) below. Cross-surface leak proof present for list/household/detail/search. Minor gap: no mixed-household-shaped test (structurally guaranteed, not asserted) — gap (2).

## RLS Suite

§1-16 pass; full run halts at §17 on a **pre-existing** `organization_profiles` fixture collision (real Alder Creek admin-editor rows — increment 4a's own documented finding). **§18 (deacon linkage) extracted and run standalone as `presby_app`: 6/6 pass** — tenant isolation, CHECK rejection, composite-FK cross-org rejection (F2), active/vacant derivation.

## Auth-Touching Gate

Diff confirmed not to touch `src/auth.ts`, `(auth)`, `api/auth`, `src/lib/auth` — the stricter MFA e2e mandate does not apply.

## Verdict

**PASS.** Named non-blocking gaps for Phase 6/TODO: (1) Playwright spec for the new portal/directory routes before the flags flip on; (2) mixed-household hidden-member test; (3) extract `findPersonMatches()`'s inline eligibility predicate into the shared helper.

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification | qa | Complete | PASS | 2026-08-24 |


---

# Phase 6 — Shipped vs Intent (analyst)

**Date:** 2026-08-24 · **Verdict: SHIP WITH NOTES**

## ONE-LINE TAKE

> Every flow and verb from Phase 1 works in a real browser exactly as designed — search, grid, households, DeaconCard, parishes, the permission gate, the empty/zero-match copy — and the two design-reading calls Phase 4b flagged are both correct, defensible readings that should be ratified rather than reworked; what's left is bookkeeping (TODO gaps, a what's-new entry), not code.

## Rulings on the two flagged design-reading calls

1. **Field-level hides stay applied for elevated viewers — ratified as shipped.** Phase 1's own text named only the row-level case; the "hidden fields too" reading came from a task brief's looser paraphrase, and narrower-than-request is the safer default for a privacy control. Widen only if a real diaconate user asks (already a TODO line).
2. **Deacon shown by office regardless of their own privacy prefs — agreed without reservation.** The only reading consistent with The Court Is Not a Group; the materialized diaconate roster already publishes officer identity. The untested hidden-deacon combination stays a named follow-up.

## What's Working (verified live, both viewer classes, 1280px + 390px, flags flipped and restored)

- Flow 1 portal home: greeting, Find-a-Person, "Yours" household, tool tiles; omit-not-empty confirmed.
- Flow 2 find-a-person: fallthrough to `/directory?search=` per the Phase 1 default.
- Flow 3 members grid: 8 rows with lock badge for the elevated viewer, 7 for the ordinary member (hidden person excluded); human zero-match copy exactly as Phase 1 demanded.
- Flow 4 households: zero-visible-member households drop; count parity with parishes tab confirmed.
- Flow 5 DeaconCard: identical card on both detail pages; vacant district renders "No deacon is currently assigned," never a stale name.
- Flow 6 parishes: elevated-only; ordinary member gets the human denial (not 404, no tab shown).
- `directory.view_hidden` enforced server-side; mobile 390px clean; `check:audit` clean — no unaudited mutation shipped.

## Intent-vs-Shipped Diff

No functional gap beyond the two ratified rulings; all scope-shrinking was Phase 1's own open questions answered as recorded orchestrator defaults, delivered as specified.

## Edge Cases

Empty state: pass (live) · Failure microcopy: pass (zero-match live; DB-failure path accepted on code-reading + QA) · Permission gate: pass (live denial) · Audit event: n/a, confirmed clean · Mobile 390px: pass (live).

## Follow-Ups (SHIP WITH NOTES)

Already in TODO: officer-terms admin UI deferral; field-level-hides narrower reading; hidden-deacon fixture gap. Added at close-out (QA's three named gaps): e2e spec for the new portal/directory routes before either flag flips on; mixed-household hidden-member test; extract `findPersonMatches()`'s inline eligibility predicate into the shared helper. Rule 13: publish a what's-new entry when the flags flip for a real congregation. Rule 14: functionality map updated at ship time.

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-08-24 |

**Pipeline closed.** Commits await user review per Workflow Rule 1.
