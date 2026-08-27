# Product IA scaffold: organized functionality groups, menu items, placeholder flags and pages — Work Log

> **Slug:** `2026-08-27-product-ia-scaffold`
> **Surface:** (org) portal (nav, tiles, placeholder pages); possibly admin hub grouping
> **Permission(s):** TBD by Phase 1/3 — placeholders likely need none (flag-gated only) until each feature builds
> **Flag(s):** new placeholder org_portal.* flags, seeded off — the deliverable includes the flag taxonomy
> **Estimated complexity:** medium (scaffold itself small; the IA decisions are the work)
> **Pipeline mode:** Full
> **Source:** operator request, 2026-08-27 — "lets look at all the functionality that we want to build and organize it and add menu items and placeholder functional flags and pages. this is in an attempt to logically group functionality for the final product."

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES — 7 open questions, operator input needed on 1-4 before Phase 2 | 2026-08-27 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-27 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementers named | 2026-08-27 |
| 4 — Implementation | full-stack-developer (commit 1: registry/flags/stubs) → ux-developer (commit 2: sections/nav/feedback relocation) | Complete — both commits landed; 2902 tests green; taxonomy revision (operator, post-Phase-3) queued as next increment | Committed at operator direction ahead of Phases 5-6 (operator override, 2026-08-27); QA + Phase 6 + taxonomy v2 follow next batch | 2026-08-27 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> This is an information-architecture exercise, not a feature build — the deliverable is a settled taxonomy plus inert scaffolding (nav entries, `org_portal.*` flags seeded off, "coming soon" stubs), and the taxonomy choice is a product decision only the operator can make; three concrete open questions (scope, aspiration level, grouping scheme) should be answered before Phase 2/3 lock in a structure that everything after this rides on.

## The Functionality Universe

Status: **built** / **partial** / **planned** (named in TODO/STATE, zero code) / **aspirational** (sibling repo, no presby decision).

**Congregation-primary, built or partial:** Directory (built); Members admin (built); Roll (read path built, write UI mostly unsurfaced); Officers (built — currently also renders at presbytery with no ruling, open TODO); Groups (built, all types); Sensitive info (built); Children's ministry (A built; B consent/medical intake and C check-in planned); Events (1-2 built; 3 check-in, 4 public calendar, 5 unspecified planned); Roles & permissions admin (built, all types); Branding (built, all types); Tickets/feedback (built, all types); Public website (built, flag off, no real site live); Admin hub (built, flag off).

**Presbytery-primary, partial:** Ministerial credentials (0+2 built, type-scoped); Committees & commissions (planned, Increment 1); Congregation oversight (planned, blocked on Q1 cross-org RLS ruling); Per-capita/SASR rollup (planned, blocked on a publication mechanism — none exists); Imports & reports (planned).

**Not built, named in presby's own docs:** Giving/fund accounting (24-table model in ../westervillelions/docs/features/the-ledger-accounting.md — entities, bank accounts, funds, categories, transactions, budgets, approvals, compliance calendar, impact dashboard); Worship/service planning (../fpcw-directory: service templates, liturgical role scheduling, external participants, holiday tagging, attendance, insights); Public event calendar (Events Inc 4); Check-in/kiosk (Events Inc 3 + Children's C; fpcw's white-binder Android kiosk is a hardware companion, likely out of scope); Tenant-facing audit reader (DECISION-067 deferral); Cross-org commission/delegation UI; Platform-level role/permission catalog editing.

**Aspirational (sibling repos, no presby decision):** Youth registration (public parent-facing form — presby's A/B covers adjacent ground staff-entered); Reimbursement/expense requests; Insights/analytics dashboards (fpcw Insights + psvonline Reports: viability map, per-capita, membership trend, exports); Resource/equipment lending (MAP — fpcw's own local need; **D8 flags this as exactly what a support ticket should validate first**); Communications/Mailchimp sync (also D8-adjacent); Presbytery AI assistant + data import (Church360/PC(USA) stats CSV); Public "Learn" layer (synod-portal — public, content-authored, structurally not a tile; genuinely unclear if it belongs in presby's vision).

**Different axis, not in this exercise:** platform admin shell (/admin/*, FEATURES.*-gated, not org-scoped); /developer restructure (P11), component dictionary (P12); staff & employment (P8), custom domains (P5), satellite sessions (P10), data-bound blocks (P7) — named in STATE.md as queued pipelines, too undefined to place today.

## Proposed Grouping

- **Scheme A — by ministry domain** (People & Membership · Officers & Courts · Worship & Events · Giving & Finance · Communications · Reports & Insights · Presbytery Governance · Organization Administration). Matches how a congregation thinks; scales. Weakness: doesn't encode who sees it daily vs at setup.
- **Scheme B — by frequency** (keep operate/administer flat). Cheapest, zero new invariants. Weakness: one undifferentiated "operate" pile is the scaling problem itself.
- **Scheme C — by org type.** Weakness: most areas are genuinely shared; orgTypeScope already handles exceptions.

**Recommendation: A nested inside B.** Keep `category` as the routing dimension (which page renders the tile); add an orthogonal `domain` field as pure presentation metadata (which labeled section it renders under). Fourth orthogonal field on PortalTile, never a second gate — the same layering pattern used twice already (`category` on `flagKey`, `orgTypeScope` on `category`). Credentials example: `domain: governance, category: operate, orgTypeScope: ["presbytery"]`.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Member, /o/<slug> home | Domain-grouped tile grid; real tile → real feature; placeholder tile (flag on) → "coming soon" stub | Per visit |
| Member | Placeholder area absent entirely when flag off (default, real orgs) | No verb possible, by design |
| Org admin, /admin hub | Same for administer-category placeholders | Per visit |
| Platform operator, /admin/flags | Toggles org_portal.* placeholder flags (existing UI, no new surface) | Dev/demo only |

## Flows

**Flow 1 — placeholder click (flag on):** filter passes → stub with honest "coming soon" copy naming what's planned, a link back, and (recommended) a link into /o/<slug>/feedback ("want this sooner? tell us"). **Failure not addressed by the request:** direct navigation to a placeholder URL while its flag is off — every built flag-gated route has an explicit flag-off behavior; the placeholder convention needs one (Open Q6).
**Flow 2 — operator roadmap preview:** /admin/flags toggle → visit portal → sees exactly what a congregation would at flag-flip.
**Flow 3 (implicit, load-bearing) — real feature replaces placeholder:** the flag key is REUSED, never renamed (home_v2/directory_v2 precedent: one durable key across iterations); Phase 3 must not invent a second key leaving debris.

## Permissions & Flags

- **Permissions: none.** Stubs expose no data, mutate nothing; still behind the (org) contract (resolveOrgContext) so non-members can't view by URL-guessing.
- **Flags:** new `org_portal.<domain-or-area>` keys, seeded off, one per AREA (not per increment). No `_placeholder`/`_stub` suffix — the key carries the area from stub through shipped feature. Areas whose future Phase 1 will name their own flag (presbytery Increments 1/3/4/5) should get names that future work would actually use — operator/Phase 3 call, not invented unilaterally.

## Gaps the Request Didn't Address

1. **Nav-row real estate** — the persistent row already carries Home + every operate tile + Administration and wraps at 360px; the full universe forces a grouped-menu/dropdown/"More" decision that flag-and-stub alone doesn't resolve. Needs its own Phase 2 ruling, not silent deferral.
2. **Admin hub flat grid scaling** — a deliberate ~9-tile choice (DECISION-105), not validated at 20+.
3. **Org-type variance in labels** — "People & Membership" reads congregation-only, but ministers' membership is presbytery-scoped by polity (D1); labels must not assume one audience.
4. **D8** — the grouping must never read as per-tenant custom modules: every org of a type sees the same groups (modulo flags), never a tenant-specific menu.
5. **Mobile** — domain-grouped nav at 360px is a materially different layout; "Verify in a Browser" applies with force (three phone-only defects in project history).
6. **Flag-off placeholder routes** — reachable or not? Needs a ruling before an implementer assumes one.

## Out of Scope (confirm with user)

Building any actual feature in the universe; restructuring the platform /admin shell (unless the operator says otherwise — Open Q2); resolving the officers-at-presbytery TODO as a side effect; the synod-portal Learn layer (different surface shape — flagged, not assumed in or out).

## Open Questions

1. **Which grouping scheme + domain boundaries?** (Recommend A-in-B; but domain names and membership — does Worship include Events? is Communications real or folded into Administration? does Reports stand alone? — are product calls.)
2. **Scope: (org) portal only, or also the platform /admin shell?**
3. **How aspirational?** Do MAP/Reimbursement/Mailchimp/Insights/Learn-layer belong on presby's map, or are they out (another fork's territory, or D8-gated behind real ticket demand)? Roughly doubles the universe.
4. **Placeholders: operator/dev-preview only, or near-term "coming soon" for real congregation staff?** Changes stub polish and tone.
5. **Nav/hub scaling: solved in this pass or deferred with a tracked follow-up?**
6. **Direct-hit behavior for flag-off placeholder URLs?**
7. **One taxonomy for all org types, or does synod/GA warrant a structurally different (content-first) portal shape?**

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-27 |

## Operator Answers (2026-08-27, recorded by the orchestrator)

1. **Grouping:** Domains within operate/administer (the recommended A-in-B layering — `domain` as presentation metadata on the existing `category` routing axis).
2. **Scope:** Org portal only; the platform /admin shell stays as-is.
3. **Aspiration:** Named roadmap + strong sibling areas — giving, worship, check-in, public calendar, presbytery increments, insights/reports, communications; EXCLUDES fpcw-local oddities (MAP/equipment lending) and the synod Learn layer pending real demand (D8 posture).
4. **Placeholder visibility:** **Seed the placeholder flags ON for now** — the operator wants to see the full map in dev; they will be turned off before go-live. (Deviation from the analyst's dev-only recommendation, legitimate in the current no-real-congregations dev posture. Carries a mandatory go-live task: flip every placeholder flag's seed to off before any real congregation onboards — track in docs/TODO.md in the implementation commit.)

Open Questions 5 (nav/hub scaling) and 6 (flag-off direct-hit behavior) go to the architect; Question 7 (synod/GA portal shape) is deferred — the taxonomy stays one-shape-all-types for this pass, with orgTypeScope handling per-type visibility.

**Handoff:** architect (Phase 2) after the operator answers Open Questions 1-4 (minimum). The architect rules on the `domain` field placement and whether nav/hub scaling is solved here or explicitly deferred.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions**

## Placement

- `src/lib/org-portal/tiles.ts` — `domain` as a fourth field on `PortalTile`, colocated with `PortalDomain`/`DOMAIN_LABELS`/`DOMAIN_ORDER` constants (no new file).
- New placeholder routes: `src/app/(org)/o/[slug]/admin/<area>/page.tsx` for ALL placeholders regardless of category (members/officers/groups/events/credentials already route operate tiles through /admin/*; category stays a nav/home-routing question, never a URL-shape decider).
- New shared components: `src/components/org-portal/coming-soon.tsx` and `domain-tile-sections.tsx` (buckets tiles by domain, one `<section>`+`<h2>` per group, delegates cards to the existing `TileGrid`; reused by home AND the admin hub).
- `scripts/seed.ts` — new `org_portal.<area>` flags seeded ON under one loud, grep-able comment block; `docs/TODO.md` — the go-live flip-off task, same commit (Rule 10).
- All new code is Server Components; `portal-nav-links.tsx` stays the sole client leaf (one same-file tweak: `matchesEntry` strips `#anchor` suffixes).
- **No new npm dependency** — grouped-dropdown nav explicitly ruled out this pass (would demand its own vetted primitive + architecture pass).

## Key rulings

1. **`domain` is REQUIRED, closed-union, presentation-only** — never a gate (DECISION-003 reaffirmed). Optional-with-default would silently recreate the unmapped-key fallback bug class; required means `tsc` fails when a new tile omits it (the same discipline the `organizationType` required-parameter fix just validated).
2. **Nav-row scaling:** one nav entry per domain that has ≥1 flag-visible operate tile for this org type (→ `/o/<slug>#domain-<key>` anchors into the home page's domain sections) + Home + Administration ≈ 7-9 entries regardless of future tile count. Generalizes the existing "Administration" aggregate-link pattern rather than inventing a second mechanism. **Named tradeoff requiring product sign-off: shipped high-frequency tools (Members, Directory, Officers, Groups, Events, Feedback) go from one click to two.**
3. **Admin hub:** domain section headers, applied uniformly (no "big enough" threshold).
4. **Placeholders:** one shared `ComingSoon` + one `page.tsx` per route (full DECISION-040 auth boilerplate before any flag check — a Phase 4 gate, not a suggestion). Flag-off ≠ coming-soon: two different truths, two states. **Direct-hit flag-off: reachable, 200, honest "isn't turned on yet" copy (EventsFlagOff convention); `notFound()` stays reserved for DECISION-040's org-existence axis.**
5. **Flags seeded ON: no invariant concern** (inert stubs, zero data/mutation; DECISION-003 holds regardless of default). Sufficient ONLY with the loud seed.ts comment block making the go-live flip mechanical — a Phase 4 gate item.
6. **Taxonomy** (with Gap 3 correction — "Governance (presbytery-scoped)" renamed **"Governance & Courts"**, no parenthetical, since Officers is congregation-scoped and orgTypeScope does the real per-type scoping):
   - **People & Membership:** Directory, Members/roll, Children's ministry (A built; B/C placeholder), Sensitive info
   - **Worship & Events:** Events (built), Worship/service planning (placeholder), Check-in/kiosk (placeholder — here not People, per DECISION-113's frozen contract against events), public-calendar management placeholder (the public-facing calendar itself is a (public)/site concern, out of scope)
   - **Giving & Finance:** Giving/fund-accounting (one placeholder area, not N tiles — westervillelions' 24-table shape is a future schema decision)
   - **Governance & Courts:** Officers (built), Committees & Commissions (planned), Credentials (built, presbytery-scoped), Congregation oversight (planned). Officers-at-presbytery TODO adjacent-not-resolved.
   - **Reports & Insights:** Per-capita/SASR (planned), Imports & reports (planned), Insights dashboards (placeholder)
   - **Communications:** one placeholder tile, honest roadmap copy
   - **Administration:** Roles, Features, Branding, Tickets (unchanged)
7. **Brand scope:** new components in src/components/org-portal/ must use semantic tokens only (`check:brand-scope` C1 — the directory is not brand-utility-permitted).

## Suggestions (resolve in Phase 3)

1. "Governance & Courts" rename (done in ruling 6). 2. seed.ts loud comment block = explicit Phase 4 gate. 3. `matchesEntry` hash-stripping named up front. 4. **Product sign-off on the nav one-more-click tradeoff.** 5. Consider one parameterized flag-off/coming-soon component family instead of ~7-10 near-duplicate `*FlagOff` files.

## Implementers

- **Commit 1 — full-stack-developer:** tiles.ts domain field + constants + registry entries; seed.ts flags (ON, loud block); TODO flip-off task; placeholder page.tsx routes; ComingSoon (+flag-off) component(s).
- **Commit 2 — ux-developer:** domain-tile-sections.tsx; portal-nav.tsx domain-entry computation; home + admin hub switched to domain sections; portal-nav-links.tsx hash tweak.

DECISION-117 (domain taxonomy + nav shape) gets logged by tech-lead at Phase 3, where the concrete design choice lives.

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-27 |

**Handoff:** tech-lead (Phase 3) — route-to-tile mapping, ComingSoon prop contract, anchor-id convention, and the operator's nav-tradeoff sign-off before implementation.

**Operator taxonomy revision (2026-08-27, post-Phase-3, applies as an increment after commit 2 lands — the rendering machinery is taxonomy-agnostic, so this is a data-only change to tiles.ts):**
1. **Officers moves to People & Membership** (with Directory, Members, Groups, Children's, Sensitive info) — "members, directory and officers and groups feel related." Consequence: Governance & Courts becomes purely presbytery material (Credentials, Committees & Commissions, Oversight) and disappears entirely from congregation portals via the existing empty-domain omission.
2. **Events and Communications merge into one "Events & Communications" domain** (Events, public-calendar management, check-in roadmap, Communications) — "events and communications are kinda related." Worship becomes its own section (service planning).
3. **DOMAIN_ORDER:** People & Membership → Worship → Events & Communications → Giving & Finance → Reports & Insights → Governance & Courts → Administration (most-used first; Worship kept adjacent to Events & Communications).

**Operator direction (2026-08-27, mid-Phase-3):** "Give feedback" leaves the top-level tile/nav registry entirely. Its two entry points become: (a) an item in the user's profile/avatar menu, and (b) the starter kit's dismissible feedback prompt (the /home daily prompt with snooze/opt-out) rendered at the bottom of the org portal home. The `org_portal.feedback` flag and the /o/<slug>/feedback route itself survive — only the surfacing changes. Relayed to the tech-lead mid-design for incorporation into Phase 3.

**Operator sign-off (2026-08-27):** nav tradeoff ACCEPTED — domain entries (one per domain with ≥1 visible operate tile, ~7-9 total), shipped tools move to two clicks via their domain's home section.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

This pipeline is scaffolding, not a feature: it settles a durable 7-domain
taxonomy for the whole presby functionality universe, adds a required
`domain` field to `PortalTile` so every present and future tile declares
which labeled section it renders under, adds 7 new placeholder tiles/routes
for the operator's named roadmap areas, and generalizes both the persistent
nav row and the admin hub to a fixed-size, domain-grouped shape that scales
to the full universe without adding a nav entry per tile forever. It also
folds in a mid-design operator correction: "Give feedback" is removed from
the tile/nav/footer registry entirely and re-surfaces as (a) an avatar-menu
item and (b) the platform's existing dismissible daily feedback prompt,
reused verbatim on the org portal home. Nothing here builds a real feature —
every new route is an honest "coming soon" stub, and the whole placeholder
set ships seeded ON (dev-only posture, DECISION-117) with a mandatory
go-live flip-off task tracked in `docs/TODO.md`.

## Permissions & Flags

- **Permissions: none**, reaffirming Phase 1's own ruling. Every new route is
  an inert stub — no data read, no mutation — gated only by the `(org)`
  contract's membership check (`resolveOrgContext`/`assertOrgAccess`) and its
  own flag. `domain` itself is presentation metadata, never a gate, same rule
  `category`/`orgTypeScope` already follow (DECISION-003; architect ruling 1).
- **7 new flags**, `org_portal.<area>` convention, one per area (not per
  increment), no `_placeholder` suffix — reused unchanged when the real
  feature ships (the `home_v2`/`directory_v2` precedent Phase 1 named):
  `org_portal.giving`, `org_portal.worship`, `org_portal.committees`,
  `org_portal.oversight`, `org_portal.reports`, `org_portal.insights`,
  `org_portal.communications`.
- **Seeded ON**, all 7, per the operator's Phase 1 Answer 4 — a deliberate,
  documented deviation from this codebase's usual "ships dark until the page
  lands" default, legitimate only because no real congregation is onboarded
  yet. Carries a mandatory go-live task (below, and in `docs/TODO.md`).
- `org_portal.feedback` **is unchanged** — same key, same semantics (gates
  feedback-related promotional surfaces in the portal chrome) — see the
  Feedback Relocation section. It no longer gates a `PortalTile`; it now
  gates the avatar-menu item and the home-page prompt card directly.

## API Contract

No new API routes. Everything here is Server Components reading
`isFlagEnabled()` and one Server Action reuse (the existing
`submitFeedback`/`snoozeFeedbackPrompt`/`setFeedbackOptOut` trio, unmodified,
now called from a second render location — see Feedback Relocation). No new
server-action signatures.

## Data Model

No schema changes required. `PortalTile.domain` is an in-memory TypeScript
field on a `readonly` array literal (`src/lib/org-portal/tiles.ts`), not a
database column — there is no `portal_tiles` table.

## 1. The full `PORTAL_TILES` delta

### Taxonomy (DOMAIN_ORDER, closed union, required)

```ts
export type PortalDomain =
  | "people"          // People & Membership
  | "worship"         // Worship & Events
  | "giving"          // Giving & Finance
  | "governance"      // Governance & Courts
  | "reports"         // Reports & Insights
  | "communications"  // Communications
  | "administration"; // Administration

export const DOMAIN_LABELS: Record<PortalDomain, string> = {
  people: "People & Membership",
  worship: "Worship & Events",
  giving: "Giving & Finance",
  governance: "Governance & Courts",
  reports: "Reports & Insights",
  communications: "Communications",
  administration: "Administration",
};

export const DOMAIN_ORDER: readonly PortalDomain[] = [
  "people", "worship", "giving", "governance", "reports",
  "communications", "administration",
];
```

`domain` is added to the `PortalTile` interface as a **required** field
(`domain: PortalDomain`, no `?`), the same discipline the `organizationType`
required-parameter bug fix just validated (architect ruling 1): a future
tile that omits it fails at `tsc`, not silently at render time with an
unmapped-key fallback.

**Rule (new, resolves a real nav collision this design pass caught):** the
`"administration"` domain value exists **only** to bucket
Roles/Features/Branding/Tickets on the admin hub's own
`domain-tile-sections.tsx` grouping. It is **excluded from the persistent
nav row's domain-anchor computation** (§4) — the nav's existing hardcoded
"Administration" entry (unchanged, points at `/o/<slug>/admin`) already owns
that concept, and a second, anchor-based "Administration" entry pointing at
`/o/<slug>#domain-administration` would collide on the identical label with
a different destination. No current tile actually forces this collision
(every `"administration"`-domain tile is `category: "administer"`, so it
never reaches the nav's operate-only computation anyway), but the exclusion
is written as an explicit rule in `portal-nav.tsx`, not an accident of
today's data — a future operate-category tile must not be assigned
`domain: "administration"` without revisiting this.

### Existing tiles — domain assignment (10 tiles; `feedback` removed, see
Feedback Relocation)

| key | label | domain | category | orgTypeScope |
|---|---|---|---|---|
| members | Members | people | operate | — |
| directory | Directory | people | operate | — |
| groups | Groups | people | operate | — |
| officers | Officers | governance | operate | — |
| credentials | Credentials | governance | operate | `["presbytery"]` |
| events | Events | worship | operate | — |
| roles | Roles | administration | administer | — |
| features | Features | administration | administer | — |
| branding | Branding | administration | administer | — |
| tickets | Tickets | administration | administer | — |

Architect ruling 6 named domains for members/directory/officers/credentials/
events/roles/features/branding/tickets explicitly; it did not enumerate
`groups`. **Tech-lead call:** `groups` → People & Membership — committees,
small groups, choirs, and teams are day-to-day people-organizing, not
constitutional office (Governance & Courts is reserved for
officer/credential/committee-of-the-court structures). Named here as a gap
the architect's table left open, not silently resolved.

### New placeholder tiles (7)

| key | label | domain | category | orgTypeScope | flagKey | href |
|---|---|---|---|---|---|---|
| giving | Giving & Finance | giving | operate | — | `org_portal.giving` | `/o/<slug>/admin/giving` |
| worship | Worship & Service Planning | worship | operate | — | `org_portal.worship` | `/o/<slug>/admin/worship` |
| committees | Committees & Commissions | governance | operate | `["presbytery"]` | `org_portal.committees` | `/o/<slug>/admin/committees` |
| oversight | Congregation Oversight | governance | operate | `["presbytery"]` | `org_portal.oversight` | `/o/<slug>/admin/oversight` |
| reports | Per-Capita, SASR & Imports | reports | **administer** | `["presbytery"]` | `org_portal.reports` | `/o/<slug>/admin/reports` |
| insights | Insights & Analytics | reports | operate | — | `org_portal.insights` | `/o/<slug>/admin/insights` |
| communications | Communications | communications | operate | — | `org_portal.communications` | `/o/<slug>/admin/communications` |

**Collapse/fold decisions (explicit, per the task's instruction to keep the
total sane):**

- **Check-in/kiosk and public-calendar management do NOT get their own
  tiles/routes.** Phase 1's own functionality universe already frames these
  as *increments 3 and 4 of the built Events feature*
  ("Events (1-2 built; 3 check-in, 4 public calendar, 5 unspecified
  planned)") — they are more capability inside the tool a congregation
  already has, not a separate area. A standalone placeholder route for each
  would misleadingly suggest a wholly separate product. They stay
  roadmap-only prose (in this design doc and `docs/TODO.md`'s existing
  Children's-Ministry-Increment-C entry, which already names the check-in
  contract), not new tiles.
- **Per-capita/SASR rollup and imports & reports collapse into one tile**
  (`reports`) rather than two — both are presbytery back-office/compliance
  work (stated-clerk register-keeping and data-import housekeeping,
  respectively), both already carry a `docs/TODO.md` BLOCKED note (Q1's
  cross-org RLS ruling isn't it — that's `oversight`; per-capita is blocked
  on a real publication mechanism, imports has no blocker named but no
  requirements gathering either), and neither is differentiated enough today
  to justify two separate roadmap stubs a presbytery admin would have to
  choose between.
- **Insights & Analytics stays its own tile**, separate from `reports`,
  because it is universal (any org type wants dashboards/trends) while
  `reports` is presbytery-only compliance filing — different audiences,
  different `orgTypeScope`, must not share a tile.

**Total: 17 tiles (10 existing + 7 new), 7 new routes.**

## 2. Flag names + `scripts/seed.ts` block

Convention confirmed: `org_portal.<area>`, no suffix, reused when real. Exact
block to append inside `seedFlags()`'s `defaults` array (after the existing
`org_portal.*` entries):

```ts
    // ============================================================
    // PRODUCT-IA SCAFFOLD PLACEHOLDER FLAGS — SEEDED ON, TEMPORARILY.
    // docs/work-log/2026-08-27-product-ia-scaffold.md (DECISION-117).
    // Every flag below gates an inert "coming soon" stub — zero data reads,
    // zero mutations (see coming-soon.tsx). Seeded ON *only* because presby
    // has no real congregation on it yet and the operator wants the full
    // roadmap visible in dev (Phase 1 Operator Answer 4, a deliberate,
    // documented deviation from this codebase's usual "ships dark until the
    // page lands" default).
    //
    // *** GO-LIVE GATE: BEFORE THE FIRST REAL CONGREGATION OR PRESBYTERY IS
    // ONBOARDED, FLIP EVERY FLAG IN THIS BLOCK TO `enabled: false`. ***
    // Tracked in docs/TODO.md ("Go-live: flip placeholder flags off," same
    // commit). Do NOT remove a flag key when its real feature ships — flip
    // it deliberately at that point and delete its entry from this block
    // (the "one durable key across iterations" rule org_portal.home_v2/
    // directory_v2 already established).
    // ============================================================
    {
      key: "org_portal.giving",
      description:
        "Giving & fund-accounting placeholder area in (org). OFF = /o/<slug>/admin/giving renders 'isn't turned on yet'. ON with no feature built = 'coming soon' stub, not a working ledger.",
      enabled: true, // GO-LIVE: false
    },
    {
      key: "org_portal.worship",
      description:
        "Worship & service-planning placeholder area in (org). OFF = 'isn't turned on yet'. ON with no feature built = 'coming soon' stub.",
      enabled: true, // GO-LIVE: false
    },
    {
      key: "org_portal.committees",
      description:
        "Presbytery committees & commissions placeholder area in (org). Presbytery-scoped tile (orgTypeScope). OFF = 'isn't turned on yet'. ON with no feature built = 'coming soon' stub.",
      enabled: true, // GO-LIVE: false
    },
    {
      key: "org_portal.oversight",
      description:
        "Presbytery congregation-oversight placeholder area in (org). Presbytery-scoped tile (orgTypeScope), BLOCKED on Q1's cross-org RLS ruling before real work can start (docs/TODO.md). OFF = 'isn't turned on yet'. ON with no feature built = 'coming soon' stub.",
      enabled: true, // GO-LIVE: false
    },
    {
      key: "org_portal.reports",
      description:
        "Presbytery per-capita/SASR + data-imports placeholder area in (org). Presbytery-scoped tile (orgTypeScope), BLOCKED on a real publication mechanism before real work can start (docs/TODO.md). OFF = 'isn't turned on yet'. ON with no feature built = 'coming soon' stub.",
      enabled: true, // GO-LIVE: false
    },
    {
      key: "org_portal.insights",
      description:
        "Insights & analytics dashboards placeholder area in (org). OFF = 'isn't turned on yet'. ON with no feature built = 'coming soon' stub.",
      enabled: true, // GO-LIVE: false
    },
    {
      key: "org_portal.communications",
      description:
        "Communications placeholder area in (org). OFF = 'isn't turned on yet'. ON with no feature built = 'coming soon' stub.",
      enabled: true, // GO-LIVE: false
    },
```

`org_portal.feedback`'s existing seed row is untouched — it survives with
its current key, description, and enabled value (whatever `scripts/seed.ts`
already sets it to today), only its consumer changes (§6).

## 3. `ComingSoon` component family — YES, consolidated

Architect suggestion 5 (avoid ~7-10 near-duplicate `*FlagOff` files) is
adopted. One file, `src/components/org-portal/coming-soon.tsx`, three
parameterized exports (modeled on `events-states.tsx`'s "three distinct copy
blocks, one file" precedent):

```ts
/** Flag OFF — reachable, 200, honest "isn't turned on yet." EventsFlagOff's
 *  convention, parameterized instead of duplicated per area. */
export function PlaceholderFlagOff({
  area,
  orgName,
}: { area: string; orgName: string }): JSX.Element;

/** Flag ON, org-type mismatch (presbytery-only tiles hit directly by a
 *  congregation/synod/GA slug) — mirrors CredentialsNotAvailable. */
export function PlaceholderNotAvailable({
  area,
  orgName,
}: { area: string; orgName: string }): JSX.Element;

/** Flag ON, org-type OK (or no orgTypeScope) — the actual "coming soon"
 *  state. Names what's planned, honest tone, no fake date; links back and
 *  into feedback. */
export function ComingSoon({
  area,
  description,
  slug,
}: { area: string; description: string; slug: string }): JSX.Element;
// renders: <h1>{area}</h1><p>{description}</p>
// <Link href={`/o/${slug}/feedback`}>Want this sooner? Tell us.</Link>
```

Two states, per ruling 4 ("flag-off ≠ coming-soon"), not collapsed into one
— only the *per-area duplication* is collapsed, from 7 areas × 2 states
(14 near-identical components) down to 2 parameterized components (3 exports
counting the org-type variant) used by all 7 routes.

Each of the 7 `page.tsx` files follows the exact `EventsPage`/
`CredentialsPage` shape: full DECISION-040 boilerplate (not-found →
`notFound()`; forbidden → `OrgAccessDenied`; ended → `OrgAccessEnded`; ok →
`assertOrgAccess()`) **before** the flag check (architect ruling 4, a Phase 4
gate). Universal tiles (giving/worship/insights/communications) check the
flag only; presbytery-only tiles (committees/oversight/reports) check the
flag, then the org-type list (`CREDENTIALS_ORG_TYPES`-style precedent),
in that order — flag first, same as `credentials/page.tsx`.

## 4. Anchor-id convention + nav domain-entry computation

**Convention:** `domain-<key>` — e.g. `domain-people`, `domain-worship`. Both
consumers key off the same `PortalDomain` string, no separate string
literals to keep in sync:

- `domain-tile-sections.tsx` renders `<section id={`domain-${domain}`}>`.
- `portal-nav.tsx` computes each anchor entry's `href` as
  `` `/o/${slug}#domain-${domain}` ``.

**`portal-nav.tsx` domain-entry computation**, replacing the current flat
`tiles.map(...)`:

```ts
const tiles = await visiblePortalTiles("operate", organizationType);
const domainsPresent = DOMAIN_ORDER.filter(
  (d) => d !== "administration" && tiles.some((t) => t.domain === d),
);
const domainEntries: PortalNavEntry[] = domainsPresent.map((d) => ({
  label: DOMAIN_LABELS[d],
  href: `/o/${slug}#domain-${d}`,
  exact: true, // see §5 — anchor entries must never prefix-match subpages
}));

const entries: PortalNavEntry[] = [
  { label: "Home", href: `/o/${slug}`, exact: true },
  ...domainEntries,
  ...(adminHubEnabled
    ? [{ label: "Administration", href: `/o/${slug}/admin`, exact: false }]
    : []),
];
```

A domain appears **iff** it has ≥1 flag-visible **operate** tile for this
org's type — the same `visiblePortalTiles()` call the row already makes,
filtered client-side (in the server component) by `domain`, no second query.
Nav entry count: Home + up to 6 domain anchors (`administration` excluded)
+ Administration = **8 entries** for a congregation or presbytery today
(verified below), regardless of how many tiles a domain accumulates in the
future — the entire point of ruling 2, operator-accepted.

## 5. `matchesEntry` hash-stripping tweak (`portal-nav-links.tsx`)

**The bug this fixes, found in this design pass:** `usePathname()` never
includes a `#fragment` — Next's router doesn't expose it. Two failure modes
if `entry.href` (e.g. `/o/alpha#domain-people`) were compared as-is:

1. **False negative always:** `pathname === entry.href` can never be true
   (pathname has no `#`), so an anchor entry could never show "active."
2. **False positive everywhere, worse:** if `exact` were left `false` for an
   anchor entry, `pathname.startsWith(entry.href)` is comparing against a
   string that *includes* the fragment — but if the fragment is stripped
   without also forcing `exact: true`, the stripped href (`/o/alpha`) is a
   prefix of *every* subpage (`/o/alpha/admin/officers`, `/o/alpha/directory`,
   …), so the entry would show "active" on every single page in the org.

**The fix, two parts:**

1. `portal-nav.tsx` sets `exact: true` on every domain-anchor entry (§4,
   already shown) — not just Home.
2. `portal-nav-links.tsx`'s `matchesEntry` strips the fragment before any
   comparison, and the "most-specific-match-wins" `activeHref` reduce uses
   the stripped length, not the raw href length (an anchor's raw length is
   inflated by its fragment and must not win a specificity tie-break it
   didn't earn):

```ts
const targetOf = (href: string) => href.split("#")[0];

const matchesEntry = (entry: PortalNavEntry) => {
  const target = targetOf(entry.href);
  return entry.exact
    ? pathname === target
    : pathname === target || pathname?.startsWith(`${target}/`);
};

const activeHref = entries.reduce<string | null>((best, entry) => {
  if (!matchesEntry(entry)) return best;
  const target = targetOf(entry.href);
  if (best === null || target.length > best.length) return target;
  return best;
}, null);
const isEntryActive = (entry: PortalNavEntry) => targetOf(entry.href) === activeHref;
```

`<Link href={entry.href}>` (the raw, un-stripped href) is unchanged — the
fragment must survive into the actual navigation for the browser to scroll;
only the *matching* logic strips it. **Net effect:** on `/o/<slug>` itself,
Home (`exact: true`, listed first) wins every tie against every anchor entry
(all of which resolve to the identical stripped target `/o/<slug>`) — no
domain anchor ever shows as independently "active." This is an accepted,
named limitation, not a bug: `usePathname()` cannot see scroll position, and
adding client-side scroll-spy JS to solve it is out of scope (no new
dependency, not asked for).

## 6. Feedback Relocation (avatar menu + home-bottom prompt card)

Mid-design operator correction, folded in as its own section per the
coordinator's instruction. **Two genuinely different products stay
genuinely different** (DECISION-070 already ruled this at the schema layer
— `feedback`/`feedbackPromptState` are platform tables, per-user, no org
concept; `congregation_feedback` is a distinct org-scoped table reviewed by
that org's own admins). This relocation does not merge them; it changes
*where each is surfaced*, not what each *is*.

**(a) Avatar-menu item → the existing org-scoped route.**
`src/components/shared/avatar-menu.tsx` gains one new optional prop,
`feedbackHref?: string`, threaded exactly like `signOutRedirectTo` (omitted
by every caller except the one that has an org in scope):

```ts
export interface AvatarMenuProps {
  // ...existing fields...
  /** Set only by (org)/o/[slug]/layout.tsx, only when org_portal.feedback is
   *  ON for an active relationship. Renders one extra item, "Give feedback",
   *  linking to /o/<slug>/feedback. Omitted → no item, unchanged behavior
   *  for every platform-shell caller. */
  feedbackHref?: string;
}
```

Rendered as a `DropdownMenuItem` directly after "Account" (an "about me at
this org" item, grouped with identity, not with the platform-admin block)
and before the `showPlatform` separator. `src/components/shared/
global-nav.tsx` gains the same optional `feedbackHref?: string` prop, pure
passthrough to `<AvatarMenu>` (no logic — identical shape to how it already
threads `signOutRedirectTo`). `(org)/o/[slug]/layout.tsx` computes it inside
the existing `resolved.kind === "ok"` branch, alongside the `chromeV2Enabled`/
`chromeV3Enabled` reads already in that `Promise.all`:

```ts
const feedbackEnabled = await isFlagEnabled("org_portal.feedback");
// ...
const feedbackHref = feedbackEnabled ? `/o/${slug}/feedback` : undefined;
// ...
<GlobalNav ... feedbackHref={feedbackHref} />
```

**(b) Dismissible daily prompt → reused verbatim on `/o/<slug>`.** The
existing `FeedbackPromptCard` (currently `src/app/(member)/home/
feedback-prompt-card.tsx`) is **moved, unmodified, to
`src/components/shared/feedback-prompt-card.tsx`** — it is now consumed by
two route trees, which is exactly what `src/components/shared/` is for
(CLAUDE.md's own Project Layout). Its snooze/opt-out state
(`feedbackPromptState`, keyed by `userId`) is deliberately platform-wide, not
per-org — a user who snoozes today doesn't see it again at any org they
visit today either, which is correct: it's the same nudge, not two.

The suppression check currently inlined in `(member)/home/page.tsx`
(`shouldShowFeedbackPrompt`) is extracted to a new shared module,
`src/lib/feedback-prompt.ts`:

```ts
export function shouldShowFeedbackPrompt(state: {
  optedOut: boolean;
  lastSnoozedDate: string | null;
  lastSubmittedDate: string | null;
} | null): boolean; // pure, unit-tested directly

export async function getFeedbackPromptState(userId: string): Promise<{
  optedOut: boolean;
  lastSnoozedDate: string | null;
  lastSubmittedDate: string | null;
} | null>; // the existing db.query.feedbackPromptState.findFirst(...) read
```

`(member)/home/page.tsx` is updated to call the shared helper instead of its
own inline copy (identical behavior, now DRY). `/o/<slug>/page.tsx` calls
the same two functions and additionally requires `org_portal.feedback`:

```ts
const [feedbackEnabled, promptState] = await Promise.all([
  isFlagEnabled("org_portal.feedback"),
  getFeedbackPromptState(resolved.org.personId /* NOTE: use the signed-in
    user's own users.id, not personId — feedbackPromptState is keyed by
    users.id platform-wide, the same id the layout/(member) page already
    use, not the org-scoped person id */),
]);
const showFeedbackPrompt = feedbackEnabled && shouldShowFeedbackPrompt(promptState);
```

Rendered as the **last** child on `/o/<slug>` (after `DomainTileSections`),
mirroring `/home`'s own bottom placement. Flag OFF or daily-suppressed →
renders nothing (no placeholder state needed — a passive nudge widget that
disappears is not a "coming soon" stub, it's just absent, matching `/home`'s
own existing behavior when `shouldShowFeedbackPrompt` is false).

**No Feedback tile, nav entry, or footer entry remains anywhere** — this is
automatic, not a code change: `feedback` is deleted from `PORTAL_TILES`
(§1), so `visiblePortalTiles("operate", ...)` (the single source every nav,
home, and `portal-footer.tsx` call already shares) simply never returns it
again. `portal-footer.tsx` needs zero edits.

`tiles.ts`'s own header doc-comment carries a paragraph explaining
`feedback`'s prior borrowed-flagKey history — that paragraph is now stale
and is struck as part of the same commit that deletes the tile.

**Pre-existing inconsistency found, not fixed here (named for the record):**
`/o/<slug>/feedback/page.tsx`'s own header comment says it "shares
`org_portal.tickets`... no separate flag," and its code indeed still gates on
`isFlagEnabled("org_portal.tickets")`, not `org_portal.feedback` — even
though `tiles.ts`'s (now-deleted) comment claimed the split to a dedicated
`org_portal.feedback` flag already happened. This means the avatar-menu
item's visibility (`org_portal.feedback`) and the destination page's own
actual gate (`org_portal.tickets`) can disagree today — e.g. `feedback` ON /
`tickets` OFF shows the menu item but lands on "isn't turned on yet." Not
this pipeline's bug to fix (the operator's instruction was "survives
unchanged"); flagged in `docs/TODO.md` as a follow-up.

## 7. Component / Page Plan

**Files to create (commit 1, full-stack-developer):**
- `src/components/org-portal/coming-soon.tsx` — `ComingSoon`,
  `PlaceholderFlagOff`, `PlaceholderNotAvailable`
- `src/app/(org)/o/[slug]/admin/giving/page.tsx`
- `src/app/(org)/o/[slug]/admin/worship/page.tsx`
- `src/app/(org)/o/[slug]/admin/committees/page.tsx`
- `src/app/(org)/o/[slug]/admin/oversight/page.tsx`
- `src/app/(org)/o/[slug]/admin/reports/page.tsx`
- `src/app/(org)/o/[slug]/admin/insights/page.tsx`
- `src/app/(org)/o/[slug]/admin/communications/page.tsx`
- one `page.test.tsx` per route above

**Files to modify (commit 1):**
- `src/lib/org-portal/tiles.ts` — `PortalDomain`/`DOMAIN_LABELS`/
  `DOMAIN_ORDER`; required `domain` field; delete the `feedback` tile entry
  and its header-comment paragraph; assign `domain` to the 10 remaining
  existing tiles; append the 7 new tile entries.
- `src/lib/org-portal/tiles.test.ts` — domain-value assertions, updated
  pinned flag-key snapshot (7 new keys added, `org_portal.feedback` removed
  since no tile references it), presbytery-only `orgTypeScope` assertions
  for `committees`/`oversight`/`reports`.
- `scripts/seed.ts` — the loud comment block (§2).
- `docs/TODO.md` — the go-live line (§8) and the pre-existing-inconsistency
  line (§6), same commit (Rule 10).

**Files to create (commit 2, ux-developer):**
- `src/components/org-portal/domain-tile-sections.tsx`
- `src/components/org-portal/domain-tile-sections.test.tsx`
- `src/components/shared/feedback-prompt-card.tsx` (moved from
  `src/app/(member)/home/feedback-prompt-card.tsx`, unmodified)
- `src/lib/feedback-prompt.ts` + `src/lib/feedback-prompt.test.ts`

**Files to modify (commit 2):**
- `src/components/org-portal/tile-grid.tsx` — remove the internal
  `<section>`/`<h2>Tools</h2>` wrapper (the caller now owns the heading);
  keep the `tiles.length === 0 → null` guard; add icon-map entries for the 7
  new tile keys (fallback to `LayoutGrid` exists, non-blocking); remove the
  now-dead `feedback: MessageSquare` entry.
- `src/components/org-portal/tile-grid.test.tsx` — update heading
  assertions to match the stripped-down contract.
- `src/app/(org)/o/[slug]/portal-nav.tsx` — domain-entry computation (§4).
- `src/app/(org)/o/[slug]/portal-nav-links.tsx` — hash-stripping tweak (§5).
- `src/app/(org)/o/[slug]/page.tsx` — swap `TileGrid` for
  `DomainTileSections`; add the feedback-prompt-card rendering (§6b).
- `src/app/(org)/o/[slug]/admin/page.tsx` — swap `TileGrid` for
  `DomainTileSections` in the non-empty branch (keep the existing
  `tiles.length === 0` "Nothing is turned on here yet" short-circuit as-is).
- `src/app/(org)/o/[slug]/layout.tsx` — compute `feedbackHref`, thread to
  `<GlobalNav>` (§6a).
- `src/components/shared/global-nav.tsx` — `feedbackHref` passthrough prop.
- `src/components/shared/avatar-menu.tsx` — `feedbackHref` prop + item.
- `src/app/(member)/home/page.tsx` — import path update (component moved)
  and switch to the shared `shouldShowFeedbackPrompt`/`getFeedbackPromptState`
  helpers.
- `src/app/(org)/o/[slug]/page.test.tsx`, `admin/page.test.tsx`,
  `portal-nav.test.tsx`, `portal-nav-links.test.tsx`,
  `src/components/shared/global-nav.test.tsx`,
  `src/components/shared/avatar-menu.test.tsx`,
  `src/app/(org)/o/[slug]/layout.test.tsx` — updated per §9.

## 8. `docs/TODO.md` — go-live line (verbatim, ready to paste)

```
- [ ] **Go-live gate: flip every `org_portal.*` product-IA placeholder flag to `enabled: false` before any real congregation or presbytery is onboarded.** Seeded ON deliberately for dev/demo visibility (Phase 1 Operator Answer 4) — giving, worship, committees, oversight, reports, insights, communications. The loud comment block in `scripts/seed.ts` names each one; flip the whole block, not one flag at a time, so none is missed. — `docs/work-log/2026-08-27-product-ia-scaffold.md` Phase 3
- [ ] **`/o/<slug>/feedback`'s own flag gate (`org_portal.tickets`) disagrees with the avatar-menu item's visibility flag (`org_portal.feedback`).** Found during the product-IA scaffold's feedback relocation (Phase 3) — the two can be independently toggled, producing a menu item that leads to an "isn't turned on yet" page. Not fixed here (operator directed the route to survive unchanged); needs a decision on which flag is authoritative. — `docs/work-log/2026-08-27-product-ia-scaffold.md` Phase 3
```

## 9. Test Expectations

**Commit 1 (full-stack-developer):**
- `tiles.test.ts`: every `PORTAL_TILES` entry has a `domain` that is one of
  the 7 `DOMAIN_ORDER` values (loop assertion, mirrors the existing
  `category` one-of-two-values test); `PORTAL_TILES.length === 17`;
  `feedback` key is absent; a table-driven assertion pins every tile's
  `{key, domain, category, orgTypeScope}` (extends the existing hard-coded
  flagKey-snapshot pattern with the 7 new keys, `org_portal.feedback`
  removed); `committees`/`oversight`/`reports` are excluded from
  `visiblePortalTiles(..., "congregation")` and included for `"presbytery"`;
  `DOMAIN_ORDER` has exactly 7 unique entries matching `DOMAIN_LABELS`' keys.
- 7 new `page.test.tsx` files (one per route), each asserting: unauthenticated
  → redirect to `/signin?callbackUrl=...`; not-found → `notFound()` called;
  forbidden → `OrgAccessDenied`; ended → `OrgAccessEnded`; ok + flag off →
  `PlaceholderFlagOff` with correct `area`/`orgName`; ok + flag on (+
  matching org type where scoped) → `ComingSoon` with correct `area`/
  `description`/`slug`; (presbytery-only routes only) ok + flag on + wrong
  org type → `PlaceholderNotAvailable`.
- `coming-soon.test.tsx`: each of the 3 exports renders its given props
  correctly; `ComingSoon`'s feedback link resolves to `/o/<slug>/feedback`;
  no native dialogs, no data fetching (pure presentational).
- Implementer manually runs `npm run db:seed` against a dev/branch DB and
  confirms all 7 new flag rows land `enabled: true` — noted in Implementer
  Notes, not a new automated seed-idempotency test (that gap is a pre-existing,
  separately tracked `docs/TODO.md` item, out of this pipeline's scope).

**Commit 2 (ux-developer):**
- `domain-tile-sections.test.tsx`: given a mixed-domain tile list, renders
  one `<section id="domain-<key>">` per non-empty bucket in `DOMAIN_ORDER`
  order with the correct `DOMAIN_LABELS` heading text; a domain with zero
  matching tiles produces no section/heading at all (not an empty one);
  an empty or all-filtered-out tile list renders `null`.
- `tile-grid.test.tsx`: no internal heading/section wrapper; renders the
  bare card grid; `tiles.length === 0 → null` still holds.
- `portal-nav.test.tsx`: one entry per domain with ≥1 visible operate tile
  for a given org type, in `DOMAIN_ORDER` order (skipping `administration`
  even if a test tile is deliberately misconfigured with that domain +
  `category: "operate"`, proving the exclusion rule); a domain absent for a
  given org type (construct a presbytery-only-tile-only domain scenario
  against `"congregation"`) produces no entry; Home/Administration entries'
  existing behavior unchanged.
- `portal-nav-links.test.tsx`: an anchor entry (`href` containing `#`) does
  NOT read as active when `pathname` is an unrelated subpage sharing the
  pre-hash prefix (the regression this tweak fixes); Home wins the tie when
  `pathname === /o/<slug>` exactly; the rendered `<Link href>` still carries
  the full fragment unstripped.
- `page.test.tsx` (home) / `admin/page.test.tsx`: swapped `TileGrid` mock
  assertions for `DomainTileSections`; existing empty-state copy preserved
  ("Nothing is turned on here yet" on the hub; greeting+search-only on home
  when every tile flag is off); new feedback-prompt-card assertions (renders
  when `org_portal.feedback` ON and not daily-suppressed; absent otherwise).
- `avatar-menu.test.tsx`: "Give feedback" item renders with the given
  `feedbackHref` when provided, positioned after "Account"; absent entirely
  when `feedbackHref` is omitted (every existing platform-shell caller
  unaffected — no existing e2e assertion of an exact/exhaustive menu-item
  list breaks, confirmed by reading `member-home.spec.ts`/
  `header-controls.spec.ts`, both of which assert specific named items only).
- `global-nav.test.tsx`: `feedbackHref` passthrough to `AvatarMenu`.
- `layout.test.tsx`: `feedbackHref` computed only inside `resolved.kind ===
  "ok"` with `org_portal.feedback` ON; `undefined` on every other branch
  (forbidden/ended/not-found/no-session), matching the existing `orgMark`/
  `showPortalNav` discipline in the same file.
- `feedback-prompt.test.ts` (new): `shouldShowFeedbackPrompt()`'s existing
  four branches (no row, opted out, snoozed today, submitted today, else
  true) ported verbatim from wherever they're covered today (or written
  fresh if uncovered — confirmed no `(member)/home/page.test.tsx` exists
  today, so this is net-new coverage, not a port).

**e2e blast radius (confirmed by reading, not assumed):** no existing
Playwright spec asserts the persistent nav's link set, labels, or the
`TileGrid`'s "Tools" heading text (grepped `e2e/*.spec.ts` for `Feedback`,
`Give feedback`, `Administration`, `Tools`, nav-role-link patterns — only
`role-boundaries.spec.ts`'s unrelated `/admin/feedback` platform-admin gate
and `branded-signin.spec.ts`'s unrelated "Directory" heading hit). Both
`member-home.spec.ts` and `header-controls.spec.ts` open the avatar menu but
assert specific named items only (`"Platform admin"`, `"Account"`,
`"Developer"`), never an exhaustive count — the new "Give feedback" item
does not break them. **No existing e2e spec is expected to break.** New
Playwright coverage is not required for this pipeline (Phase 4's e2e
mandate is scoped to auth-touching changes; this touches neither
`src/auth.ts` nor any `(auth)`/`api/auth` path) but a live-browser 360px
check of the new hamburger-menu entry count and the domain-anchor scroll
behavior is recommended before flags go live for a real org (tracked as a
Phase 6 follow-up if not done by then).

## 10. Edge Cases & Risks

- **Org type with zero visible tiles in a domain** (e.g. a congregation and
  `governance` if `officers`/`credentials`/`committees`/`oversight` were ever
  all off) → the domain is absent from **both** the nav (no anchor entry)
  and the page (`DomainTileSections` filters the empty bucket) — one shared
  filter (`visiblePortalTiles()` + domain grouping), not two independently
  maintained rules.
- **All tile flags off** → `DomainTileSections` returns `null` on both
  `/o/<slug>` (greeting + find-person + yours-zone only, matching the
  pre-existing "all flags off" edge case) and the admin hub (existing
  `tiles.length === 0` short-circuit, unchanged copy). Nav can degrade to
  just "Home" (+ "Administration" if that flag alone is on) — never fully
  empty, matching existing precedent.
- **Footer stays flat, explicit ruling.** `portal-footer.tsx` is a compact
  recap, not a navigational hierarchy — its own header comment already says
  "no active-state styling — this is a footer, not the persistent nav row."
  Domain headers in a footer would be visual overkill for a list this short.
  No code change to `portal-footer.tsx` (beyond the automatic loss of the
  `feedback` entry, §6).
- **Mobile 360px.** `PortalNavLinks` already collapses to a hamburger below
  `sm`; 8 stacked entries there is materially the same load as the ~8-9
  individual operate tiles the nav could already render pre-this-pipeline —
  no new scaling risk, and nav entry count is now permanently capped
  regardless of future tile growth (the point of ruling 2).
  `DomainTileSections`' sections are plain stacked blocks; `TileGrid`'s own
  grid classes (1-col at 360px, `sm:` 2-col) are unchanged.
- **Scroll-margin-top / sticky header.** Confirmed by reading
  `layout.tsx`/`global-nav.tsx`/`portal-nav.tsx`: **no element in this tree
  is `position: sticky` today.** No `scroll-mt-*` compensation is needed. If
  either nav is ever made sticky, add `scroll-mt-<header-height>` to each
  domain `<section>` at that time — named here so it isn't independently
  rediscovered, not built speculatively against a header that doesn't exist.
- **What's-new entry.** All 7 new flags ship seeded ON in a no-real-tenant
  posture; Rule 13's "member-visible behavior" test technically applies once
  a flag is flipped for a real org, which is Phase 6/ship-time territory, not
  a Phase 3 call — flagged for the analyst.
- **`domain` vs `category` orthogonality is the whole design's load-bearing
  property** — demonstrated concretely by `reports` (domain: Reports &
  Insights, category: administer) sitting thematically with `insights`
  (domain: Reports & Insights, category: operate) on the admin hub and home
  page respectively, never the same page. A future contributor conflating
  the two axes (e.g. assuming domain implies category) is the single
  highest-risk misunderstanding this design invites — worth a code-review
  callout, not just a comment.

## Out of Scope (confirmed carried from Phase 1/2)

Building any real feature behind a placeholder flag; restructuring the
platform `/admin` shell; resolving the officers-at-presbytery TODO; the
synod-portal Learn layer; a client-side scroll-spy for anchor active-state;
fixing the pre-existing `/o/<slug>/feedback` flag-gate inconsistency (§6,
named, deferred); adding e2e coverage beyond what already exists (not
auth-touching, not mandated).

## Implementation Order

1. **Commit 1 — full-stack-developer:** `tiles.ts` (domain field, taxonomy
   constants, delete `feedback`, assign/append tiles) → `scripts/seed.ts`
   flag block → `docs/TODO.md` (go-live line + inconsistency line, same
   commit) → 7 placeholder `page.tsx` routes → `coming-soon.tsx` → tests for
   all of the above.
2. **Commit 2 — ux-developer:** `domain-tile-sections.tsx` → `tile-grid.tsx`
   heading removal + icon additions → `portal-nav.tsx` domain-entry
   computation → `portal-nav-links.tsx` hash-strip tweak → home/admin-hub
   `page.tsx` swapped to `DomainTileSections` → feedback relocation
   (avatar-menu/global-nav/layout threading, `feedback-prompt-card.tsx`
   move, `feedback-prompt.ts` extraction, org-home rendering) → tests for
   all of the above.

No audit events (no mutations anywhere in this pipeline). No release-notes
entry is required at Phase 3 — Rule 13's what's-new consideration is Phase 6's
call, noted above for the analyst.

## Implementer

**full-stack-developer** (commit 1), then **ux-developer** (commit 2) —
matches the architect's Phase 2 implementer table exactly; the mid-design
feedback-relocation work is folded into commit 2 since it is fundamentally
UI-chrome placement (avatar-menu item, prompt-card relocation) with only a
trivial, tightly-coupled server-side sliver (one extracted pure function +
an existing query moved verbatim).

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 3 — Technical design | tech-lead | Complete | Design complete, implementers named | 2026-08-27 |

**Handoff:** full-stack-developer for commit 1 (`tiles.ts` domain field +
taxonomy + 7 new tiles, `scripts/seed.ts` flag block, `docs/TODO.md` lines,
7 placeholder routes, `coming-soon.tsx`, tests). On commit 1's completion,
hand to ux-developer for commit 2 (`domain-tile-sections.tsx`, `tile-grid.tsx`
adjustments, `portal-nav.tsx`/`portal-nav-links.tsx`, home/admin-hub page
swaps, the feedback relocation, tests). Both commits land before Phase 5.

---

# Phase 4 — Implementation

## Commit 1 (full-stack-developer) — tiles.ts domain field, 7 placeholder tiles/routes, seed flags, TODO lines

**Date:** 2026-08-27
**Implementer:** full-stack-developer

### Files Created

- `src/components/org-portal/coming-soon.tsx` — the consolidated `ComingSoon`/`PlaceholderFlagOff`/`PlaceholderNotAvailable` component family (Phase 3 §3), one file, three exports, no per-area duplication.
- `src/components/org-portal/coming-soon.test.tsx` — 6 tests: prop→copy contract for all three exports, feedback-link destination, back-to-org-home link, no native dialog/button.
- `src/app/(org)/o/[slug]/admin/giving/page.tsx` + `page.test.tsx` — universal placeholder route (`org_portal.giving`, no `orgTypeScope`).
- `src/app/(org)/o/[slug]/admin/worship/page.tsx` + `page.test.tsx` — universal placeholder route (`org_portal.worship`, no `orgTypeScope`).
- `src/app/(org)/o/[slug]/admin/insights/page.tsx` + `page.test.tsx` — universal placeholder route (`org_portal.insights`, no `orgTypeScope`), deliberately kept independent of `reports`.
- `src/app/(org)/o/[slug]/admin/communications/page.tsx` + `page.test.tsx` — universal placeholder route (`org_portal.communications`, no `orgTypeScope`).
- `src/app/(org)/o/[slug]/admin/committees/page.tsx` + `page.test.tsx` — presbytery-only placeholder route (`org_portal.committees`, flag then org-type, mirrors `admin/credentials/page.tsx`'s ordering).
- `src/app/(org)/o/[slug]/admin/oversight/page.tsx` + `page.test.tsx` — presbytery-only placeholder route (`org_portal.oversight`).
- `src/app/(org)/o/[slug]/admin/reports/page.tsx` + `page.test.tsx` — presbytery-only placeholder route (`org_portal.reports`, `category: "administer"`).

### Files Modified

- `src/lib/org-portal/tiles.ts` — added `PortalDomain` (closed 7-value union), `DOMAIN_LABELS`, `DOMAIN_ORDER`; added the required `domain: PortalDomain` field to the `PortalTile` interface (with the `"administration"`-nav-exclusion rule documented on the type, per DECISION-117); assigned `domain` to all 10 existing tiles (`groups` → `people`, the tech-lead call Phase 3 named as filling the architect's table gap); deleted the `feedback` tile entry and its now-stale header-comment paragraph (mid-design operator correction, §6); appended the 7 new placeholder tiles (`giving`, `worship`, `committees`, `oversight`, `reports`, `insights`, `communications`) in Phase 3 §1's exact order, matching Phase 3's `{domain, category, orgTypeScope, flagKey, href}` table verbatim, including `reports`' deliberate `category: "administer"` (vs. `insights`' `"operate"`) — the load-bearing domain/category-orthogonality example named in Phase 3's Edge Cases.
- `src/lib/org-portal/tiles.test.ts` — rewrote the flag-key snapshot (7 new keys added, `org_portal.feedback` removed since no tile references it any more); added a domain-is-one-of-seven assertion; added `PORTAL_TILES.length === 17`; added a "no 'feedback' key" assertion; updated the full-registry key-mirror assertion to the 17-tile universe; added a table-driven `{domain, category, orgTypeScope}` pin covering all 17 tiles against Phase 3 §1's table (catches an accidental re-domain/re-category/re-scope at a glance, and asserts every `EXPECTED` key is also a real tile so a stale expectation can't survive a future rename); added a `DOMAIN_ORDER`/`DOMAIN_LABELS` shape assertion; added per-flag independence tests for all 7 new tiles; added presbytery-only-tile visibility tests for `committees`/`oversight`/`reports` (congregation excluded even with every flag on, presbytery included).
- `scripts/seed.ts` — appended the 7 new `org_portal.*` flag rows inside `seedFlags()`'s `defaults` array, immediately after the existing `org_portal.credentials` entry, under the exact loud comment block Phase 3 §2 specified verbatim (GO-LIVE GATE warning, each row's `enabled: true, // GO-LIVE: false` inline marker).
- `docs/TODO.md` — added both verbatim lines from Phase 3 §8 (the go-live flip-off gate, and the pre-existing `/o/<slug>/feedback` flag-gate inconsistency finding) to the "Next Up" section.
- `src/components/org-portal/tile-grid.test.tsx`, `src/components/org-portal/portal-footer.test.tsx` — **mechanical fallout, not a design change:** both files build hand-typed `PortalTile` object literals for their fixtures; making `domain` required (the whole point of DECISION-117's discipline) surfaced 5 `tsc` errors here. Added `domain: "people"` (directory/groups/future-tile fixtures) and `domain: "administration"` (branding fixture) to each — the same value the real registry now assigns those keys. No behavioral change to either test file, and `tile-grid.tsx`/`portal-footer.tsx` themselves (the implementation files, explicitly out of my commit-1 scope) were NOT touched.

### Schema Changes

None. `PortalTile.domain` is an in-memory TypeScript field on a `readonly` array literal, not a database column (Phase 3's own Data Model section) — no `db:push`/`db:generate` involved.

### Audit Events

None — no mutations anywhere in this commit (every new route is a read-only, data-free stub; every new flag is inert).

### Live Dev-DB Seeding

Ran `npm run db:seed` against the dev database configured in `.env.local`. Output: `seeded 33 feature flags` (up from the pre-existing count). Confirmed directly with a one-off query (using the same `neonConfig.webSocketConstructor = ws` setup `src/lib/db/index.ts` uses, since the bare `@neondatabase/serverless` `Pool` fails over plain `fetch`) that all 7 new rows exist and are `enabled = true`:

```
org_portal.giving          true
org_portal.worship         true
org_portal.committees      true
org_portal.oversight       true
org_portal.reports         true
org_portal.insights        true
org_portal.communications  true
```

`seedFlags()`'s `.onConflictDoNothing()` insert is idempotent for this purpose — re-running `db:seed` will not touch any pre-existing row's `enabled` value, it only inserts genuinely new keys, confirmed by reading the function before relying on it here.

### Test Results

- `npm run typecheck` — clean (0 errors). One round of fallout fixed (see Files Modified note on `tile-grid.test.tsx`/`portal-footer.test.tsx` above) before reaching this state.
- `npm test` (plain `vitest run`) — **220 test files passed, 22 skipped (242 total); 2866 tests passed, 518 skipped (3384 total).** Includes: 41 tests in `tiles.test.ts` (up from the prior file's count), 6 in `coming-soon.test.tsx`, and 7/8/8/7/7/8/8 = 55 total across the 7 new `page.test.tsx` files (giving 7, worship 7, insights 7, communications 7, committees 8, oversight 8, reports 8 — the presbytery-only trio each carry one extra "flag off wins over org type" assertion the universal four don't need).
- `npm run check` (all four tripwires: `check:audit`, `check:sql-date`, `check:deps-drift`, `check:brand-scope`) — all four pass, zero violations. No mutations exist in this commit, so `check:audit` had nothing to flag; no new npm dependency, so `check:deps-drift` is untouched; the two new components (`coming-soon.tsx`) use only semantic tokens (`text-muted-foreground`, `text-primary`, focus-ring utilities already used elsewhere in this tree), so `check:brand-scope` passes cleanly.

### Implementer Notes

- **No deviation from Phase 3's design** on the tile registry, taxonomy, flag block, or `docs/TODO.md` lines — all landed verbatim as specified.
- **One unplanned mechanical fix** (documented above under Files Modified): making `domain` required broke `tsc` in two commit-2-owned test files (`tile-grid.test.tsx`, `portal-footer.test.tsx`) that construct `PortalTile` literals by hand. Fixed by adding the field to each fixture with the same value the real registry assigns that key — required to keep `npm run typecheck` green per the Phase 4 gate, and explicitly NOT a change to either file's corresponding implementation (`tile-grid.tsx`/`portal-footer.tsx` are untouched, still commit-2's to modify for the heading-removal/icon-map work Phase 3 assigns them).
- **Scope boundary respected**: `portal-nav.tsx`, `portal-nav-links.tsx`, `portal-footer.tsx`, `(org)/o/[slug]/page.tsx`, `admin/page.tsx`, `avatar-menu.tsx`, and `(org)/o/[slug]/layout.tsx` were not touched — all six remain ux-developer's commit-2 work. `tile-grid.tsx` itself (as opposed to its test file) was also not touched.
- The 7 new placeholder `page.tsx` files each repeat the full DECISION-040 boilerplate (unauthenticated → redirect; not-found → `notFound()`; forbidden → `OrgAccessDenied`; ended → `OrgAccessEnded`; ok → `assertOrgAccess()`) **before** any flag check, with no exceptions, matching the Phase 4 gate's explicit requirement and the `admin/credentials/page.tsx`/`admin/events/page.tsx` precedent this design instructed mirroring.
- No native dialogs, no `console.log`, no new npm dependency, no `getPlatformDb()` usage anywhere in this commit's new/modified files.

---

## Commit 2 (ux-developer) — domain-sectioned home/hub, nav domain-anchor computation, feedback relocation

**Date:** 2026-08-27
**Implementer:** ux-developer

### Files Created

- `src/components/org-portal/domain-tile-sections.tsx` — buckets a `PortalTile[]` by `domain` in `DOMAIN_ORDER` order, rendering one `<section id="domain-<key>">` + `<h2>{DOMAIN_LABELS[domain]}</h2>` per non-empty bucket, delegating card rendering to the (now heading-less) `TileGrid`. Returns `null` for an empty input or an all-filtered-out bucket set. No `scroll-mt-*` added — confirmed (Phase 3 Edge Cases) nothing in this tree is `position: sticky` today; the rule for adding it later is documented in the component's own header, not built speculatively.
- `src/components/org-portal/domain-tile-sections.test.tsx` — 6 tests: bucketing/ordering, section id convention, card delegation, empty-domain omission (not an empty section), empty-input → null.
- `src/lib/feedback-prompt.ts` — `shouldShowFeedbackPrompt()` (pure, ported verbatim from `(member)/home/page.tsx`'s prior inline copy) and `getFeedbackPromptState(userId)` (the same `db.query.feedbackPromptState.findFirst(...)` read, extracted so both `/home` and `/o/<slug>` share one suppression rule).
- `src/lib/feedback-prompt.test.ts` — net-new coverage (no `(member)/home/page.test.tsx` existed to port from, confirmed by reading): the four `shouldShowFeedbackPrompt` branches (no row, opted out, snoozed today, submitted today, aged-out-else-true) plus `getFeedbackPromptState`'s column selection and null-not-undefined contract.
- `src/components/shared/feedback-prompt-card.tsx` — `FeedbackPromptCard`, moved unmodified from `src/app/(member)/home/feedback-prompt-card.tsx` (deleted from its old location in this commit). Same dialog, same snooze/opt-out actions, same copy — only the file's location and its header comment (now noting the two-route-tree reuse) changed.

### Files Modified

- `src/components/org-portal/tile-grid.tsx` — removed the internal `<section aria-labelledby>`/`<h2>Tools</h2>` wrapper (the caller, `DomainTileSections`, now owns that chrome); kept the `tiles.length === 0 → null` guard unchanged; added icon-map entries for all 7 new placeholder tile keys (`HandCoins`/`Music`/`Gavel`/`ShieldCheck`/`FileBarChart`/`BarChart3`/`Megaphone` — all already available from `lucide-react`, no new dependency); removed the now-dead `feedback: MessageSquare` entry and its import.
- `src/components/org-portal/tile-grid.test.tsx` — removed reliance on the old heading/section wrapper; added a test asserting the bare grid (no `<h2>`, no `<section>`) is what renders now.
- `src/app/(org)/o/[slug]/portal-nav.tsx` — replaced the one-entry-per-visible-tile computation with the domain-anchor computation (Phase 3 §4): `DOMAIN_ORDER.filter(domain => domain !== "administration" && tiles.some(t => t.domain === domain))`, mapped to `{ label: DOMAIN_LABELS[domain], href: `/o/<slug>#domain-<domain>`, exact: true }`. Home prepended and Administration appended exactly as before — neither hardcoded entry changed shape.
- `src/app/(org)/o/[slug]/portal-nav.test.tsx` — rewritten: entry-construction tests now assert domain-bucketed anchor entries (one per domain with ≥1 visible tile, in `DOMAIN_ORDER` order, `exact: true`, correct `#domain-<key>` href), the `administration`-domain exclusion (proven with a deliberately misconfigured operate-category/administration-domain tile, not merely benefiting from today's data shape), multi-tile-same-domain collapsing to one entry, and a domain absent for a given org type producing no entry. `visiblePortalTiles` is still mocked; `DOMAIN_LABELS`/`DOMAIN_ORDER` are mocked with the same literal values `tiles.ts` declares (real `tiles.ts` cannot be imported here — it pulls in `server-only`/`@/lib/flags`/`@/lib/db`, which cannot load in this jsdom test).
- `src/app/(org)/o/[slug]/portal-nav-links.tsx` — `matchesEntry` now strips `entry.href`'s `#fragment` before comparing against `pathname` (`targetOf = href => href.split("#")[0]`); `<Link href={entry.href}>` stays unstripped so the fragment survives into real navigation. **Implementation correction to Phase 3 §5's transcribed algorithm (see Implementer Notes below):** the specificity tie-break now tracks the winning *entry* (object identity), not just its stripped target *string* — the string-only version in the design doc would mark every entry sharing the winning stripped target as simultaneously "active" (all domain anchors + Home resolve to the identical `/o/<slug>` target), which contradicts the design's own "Home wins the tie" guarantee. `PortalNavEntry`'s own `exact` doc comment updated to explain why every anchor entry must be `exact: true`.
- `src/app/(org)/o/[slug]/portal-nav-links.test.tsx` — added: an anchor entry does not falsely read active on an unrelated subpage sharing the pre-hash prefix (the regression this fixes); Home wins the tie on `/o/<slug>` exactly (no domain anchor also lights up); no anchor is ever active anywhere else either; the rendered `<Link href>` keeps its full, unstripped fragment.
- `src/app/(org)/o/[slug]/page.tsx` — swapped `TileGrid` for `DomainTileSections` (unchanged `tiles` input); added the feedback-prompt-card render as the last child, gated on `isFlagEnabled("org_portal.feedback") && shouldShowFeedbackPrompt(await getFeedbackPromptState(session.user.id))` — `session.user.id`, not `resolved.org.personId`, per Phase 3's explicit note (`feedbackPromptState` is a platform-wide `users.id` space, not the org-scoped `people.id` space).
- `src/app/(org)/o/[slug]/page.test.tsx` — added mocks for `DomainTileSections` (spy) and `@/components/shared/feedback-prompt-card`/`@/lib/feedback-prompt`; added tests asserting `DomainTileSections` receives the resolved slug and `visiblePortalTiles()` result unchanged, and the three feedback-prompt-card branches (flag ON + should-show → renders; flag OFF → never renders even if should-show is true; flag ON + should-show false → doesn't render).
- `src/app/(org)/o/[slug]/admin/page.tsx` — swapped `TileGrid` for `DomainTileSections` in the non-empty branch; the `tiles.length === 0` "Nothing is turned on here yet" short-circuit is untouched.
- `src/app/(org)/o/[slug]/admin/page.test.tsx` — added `domain` to the `ADMINISTER_TILES` fixture (required for `DomainTileSections` to bucket them at all — a fixture with no domain silently renders nothing, unlike the old flat `TileGrid`); added `DOMAIN_LABELS`/`DOMAIN_ORDER` to the file's `@/lib/org-portal/tiles` mock (mocking a module replaces *all* its exports, not just the one named); added a test asserting domain section headings render on the hub.
- `src/app/(org)/o/[slug]/layout.tsx` — added `feedbackEnabled = isFlagEnabled("org_portal.feedback")` to the existing `Promise.all` alongside `chromeV2Enabled`/`chromeV3Enabled`; computed `feedbackHref = feedbackEnabled ? `/o/<slug>/feedback` : undefined` only inside the `resolved.kind === "ok"` branch (matching `orgBrand`/`orgMark`/`showPortalNav`'s own DECISION-040 discipline); threaded to `<GlobalNav feedbackHref={feedbackHref}>`.
- `src/app/(org)/o/[slug]/layout.test.tsx` — added a `feedbackHref` describe block: ON + active relationship → the org's `/feedback` path; OFF → `undefined`; every non-"ok" resolution (forbidden/ended/not-found) → `undefined` even with the flag ON; no session → `GlobalNav` never even renders.
- `src/components/shared/global-nav.tsx` — added the optional `feedbackHref?: string` prop, pure passthrough to `<AvatarMenu feedbackHref={feedbackHref}>`, identical shape to the existing `signOutRedirectTo` passthrough.
- `src/components/shared/global-nav.test.tsx` — added two tests: `feedbackHref` reaches `AvatarMenu` and renders "Give feedback"; omitted → no item.
- `src/components/shared/avatar-menu.tsx` — added the optional `feedbackHref?: string` prop; renders one `DropdownMenuItem` ("Give feedback" → `feedbackHref`) directly after "Account" and before the platform-items separator, omitted entirely when the prop is absent.
- `src/components/shared/avatar-menu.test.tsx` — added a describe block: renders positioned right after Account with the given href; omitted when not given; still renders correctly alongside both platform items.
- `src/app/(member)/home/page.tsx` — removed the inline `shouldShowFeedbackPrompt` function and the direct `db.query.feedbackPromptState.findFirst(...)` call; now imports and calls the shared `getFeedbackPromptState`/`shouldShowFeedbackPrompt` from `@/lib/feedback-prompt`; import path for `FeedbackPromptCard` updated to `@/components/shared/feedback-prompt-card`. No behavioral change — same suppression rule, same render condition.

### Schema Changes

None.

### Audit Events

None — no mutations anywhere in this commit (nav/section/prompt-card rendering, feedback-prompt suppression reads, and prop threading are all read-only).

### Test Results

- `npm run typecheck` — clean (0 errors).
- `npm test` (plain `vitest run`) — **222 test files passed, 22 skipped (244 total); 2902 tests passed, 518 skipped (3420 total).** Net new vs. commit 1's baseline (220 files / 2866 tests): 2 new test files (`domain-tile-sections.test.tsx`, `feedback-prompt.test.ts`) and 36 net new tests across new and modified files (`domain-tile-sections.test.tsx` 6, `feedback-prompt.test.ts` 7, `portal-nav.test.tsx` rewritten to 11, `portal-nav-links.test.tsx` +4, `tile-grid.test.tsx` +1, `admin/page.test.tsx` +1, `page.test.tsx` (home) +5, `layout.test.tsx` +5, `avatar-menu.test.tsx` +3, `global-nav.test.tsx` +2).
- `npm run check` (all four tripwires) — all four pass, zero violations. No mutations in this commit, so `check:audit` had nothing to flag; no new npm dependency (all 7 new icons come from the already-installed `lucide-react`), so `check:deps-drift` is untouched; no new component touches a brand-utility class outside the two permitted route groups, so `check:brand-scope` passes cleanly.
- `npm run lint` — 7 pre-existing errors / 152 pre-existing warnings, unchanged from `main` before this commit (confirmed by running lint against a `git stash` of this commit's diff): the `react-hooks/set-state-in-effect` error on `portal-nav-links.tsx`'s existing mobile-menu-close effect and the `<a>`-vs-`<Link>` warnings in unrelated admin form tests both predate this work and are out of this commit's scope (the button/input/textarea modernization pipeline's concurrent, uncommitted changes to `src/components/ui/*` — explicitly out of scope per this task's constraints).

### Browser Verification (dev server, flags ON, `/tmp/state.json` session)

- **`/o/fpcw` at 1280px** — domain-sectioned home: People & Membership (Members, Directory, Groups), Worship & Events (Events + "Worship & Service Planning — coming soon"), Giving & Finance ("coming soon"), Governance & Courts (Officers), Reports & Insights ("Insights & Analytics — coming soon"), Communications ("coming soon"). Nav row: Home, People & Membership, Worship & Events, Giving & Finance, Governance & Courts, Reports & Insights, Communications, Administration — 8 entries, matching the design's prediction. Footer nav recap lists every real tile (no "Give feedback"). Feedback prompt card ("How are we doing?") renders as the last element on the page, above the footer. Screenshot: `ia2-home.png`.
- **Nav anchor scroll** — clicking "Governance & Courts" navigated to `/o/fpcw#domain-governance` and scrolled the "Governance & Courts" heading to the very top of the viewport (no sticky header, confirmed no offset needed). Screenshot: `ia2-anchor-scroll.png`.
- **Avatar menu** — opened via the trigger; item order is `Account, Give feedback, Platform admin, Sign out` — no Feedback tile, no Feedback nav entry, no Feedback footer entry anywhere on the page. Screenshot: `ia2-avatar-menu.png`.
- **`/o/northern-reach` (presbytery)** — Governance & Courts section additionally shows Credentials, "Committees & Commissions — coming soon", and "Congregation Oversight — coming soon" (all `orgTypeScope: ["presbytery"]`), absent from the congregation's own Governance & Courts section above — orgTypeScope-based per-domain variance confirmed working through the new bucketing. Nav entry count unchanged at 8. Screenshot: `ia2-presbytery.png`.
- **`/o/fpcw/admin`** — hub renders one "Administration" domain header over Roles/Tickets/Features/Branding (the only administer-category tiles visible for a congregation — `reports`, the other administer-category placeholder, is presbytery-scoped and correctly absent here). Screenshot: `ia2-hub.png`.
- **360px** — the hamburger toggle opens an 8-entry overlay menu (Home, People & Membership, Worship & Events, Giving & Finance, Governance & Courts, Reports & Insights, Communications, Administration), each a comfortable tap target, no overflow or wrapping. Below the toggle, domain sections stack single-column exactly as at 1280px, just narrower cards. Feedback prompt card and footer both render correctly at this width. Screenshots: `ia2-home-360-menu.png` (menu open), `ia2-home-360.png` (full page).

### Implementer Notes

- **One implementation correction to Phase 3 §5's transcribed `matchesEntry`/tie-break algorithm**, found by the regression test the design doc itself specifies ("Home wins the tie… no domain anchor ever shows as independently active"): the design's literal code compares stripped **target strings** for the final `isEntryActive` check, but on `/o/<slug>` itself every domain anchor and Home share the identical stripped target — so a string-equality check marks *all* of them "active" simultaneously, not just Home, contradicting the design's own prose guarantee (and failing the test the design doc's own §9 asks for). Fixed by tracking the winning **entry itself** (object identity) through the tie-break loop instead of just its stripped target string — first-matched entry keeps the win on a length tie, which is what "Home wins" actually requires. Behavior for the pre-existing Groups-vs-Administration prefix-collision case (the reason this algorithm exists at all) is unchanged; both are exercised by the retained/added tests. Not a design-doc rewrite — a corrected transcription of its stated intent, noted here for the record per this task's "note any Phase 3 deviation" instruction.
- **Feedback relocation landed exactly per Phase 3 §6** — `feedback-prompt-card.tsx` moved verbatim (no logic changes), `feedback-prompt.ts` extracted with the identical four-branch suppression rule, `/o/<slug>/feedback`'s own (pre-existing, independently tracked) `org_portal.tickets` gate inconsistency was left untouched as instructed.
- **No copy strings are new user-facing text requiring a fork's branding review beyond what commit 1 already introduced** — this commit only reorganizes existing tile copy into sections and adds the (pre-existing, unmodified) feedback-prompt card's copy to a second surface; the one new string is "Give feedback" (avatar-menu item label).
- **UX tradeoff, operator-accepted in Phase 2/3**: shipped high-frequency tools (Members, Directory, Officers, Groups, Events) move from one click (flat nav entry) to two (nav → domain anchor → scroll to card, or nav → domain section → click card) — visible directly in the browser verification above, not just in the design doc's prose.
- Scope boundaries respected: `src/components/ui/*`, `find-person-form.tsx`, and `src/lib/brand/*` were not touched. No native dialogs, no `console.log`, no new npm dependency, no `getPlatformDb()` usage anywhere in this commit's files. `portal-nav-links.tsx` remains the sole `'use client'` leaf in this tree.

### Handoff

Both commit 1 (full-stack-developer) and commit 2 (ux-developer) are landed; Phase 4 is complete pending QA's Phase 5 run. Handing to **qa** for Phase 5 — full suite + feature-gate audit. The auth-touching-diff e2e mandate does not apply (no `src/auth.ts`/`(auth)`/`api/auth`/`src/lib/auth/` files touched by either commit). (The work-log's top-level Per-Phase Status table is left for the orchestrator to update.)

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

## Follow-Ups (if SHIP WITH NOTES)

- [Concrete, actionable. Each gets its own work-log entry.]

## Red Flags (if NEEDS REWORK)

- [Specific. What has to change before this ships.]
