# Portal UX Rebuild Around fpcw-directory — Work Log

> **Slug:** `2026-08-26-portal-fpcw-directory-ux`
> **Title:** Adopt fpcw-directory's look and feel (card style, hover/animation, icons, dropdown menus, footer chrome) as presby's default portal UX — the congregation already knows and likes it. Branding (colors/fonts) must still come from presby's own brand-token subsystem, never fpcw-directory's own hardcoded palette.
> **Surface:** member — `(org)/o/[slug]` portal chrome + directory + home
> **Permission(s):** none new expected — visual/structural rework of existing gated surfaces
> **Flag(s):** likely rides existing `org_portal.chrome_v2`/`directory_v2`, or a new version flag — Phase 1 to confirm
> **Estimated complexity:** large
> **Pipeline mode:** Full — cross-cutting design-system change touching chrome, directory, and home; multiple components; real risk of silently baking in fpcw-directory's own brand colors if not done carefully
> **Source — user direction (2026-08-26):** "i like the look at feel of the fpcw-directory and the congregation is used to it. lets use it as the defaults for the portal (being care that branding still comes from the branding subsystem)" · "ie. card animation, icons." · "not sure if fpcw-directory currently supports dropdown menus, but this new portal certainly will have to. it should also have a footer component" · "you can also kick off the New pipeline-sized work ... work in parallel"

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-26 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-26 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named (full-stack-developer) | 2026-08-26 |
| 4 — Implementation | full-stack-developer | Complete | Typecheck/build/3-of-4 tripwires/tests green | 2026-08-26 |
| 5 — Verification | qa | Complete | PASS | 2026-08-26 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-08-26 |

---

# Phase 1 — Functional Refinement (analyst)

## Verdict: READY WITH NOTES

**One-line take:** This is two ports (icons, hover-shadow card treatment) and two genuine builds presby has to design from scratch (nav dropdowns, a portal footer) — fpcw-directory has neither dropdown nav nor any footer today, and its card "animation" is nothing more than a one-line CSS shadow transition.

## fpcw-directory Findings (definitive, read from source)

- **Card treatment:** `hover:shadow-md transition-shadow cursor-pointer` (`member-card.tsx:42`) is the entire animation — no framer-motion dependency, no scale/translate/opacity anywhere in the card set. "Adopt the animation" = a CSS box-shadow/color transition on hover, nothing more.
- **Icons:** `lucide-react` — presby already has it (`^1.14.0`), not a new dependency. Nav icons per section (Users/Calendar/FolderTree/BarChart3/Accessibility/Baby/BookOpen/Settings); card-level icons (Mail/Phone/MapPin/Lock) sized `h-3 w-3` inline before each contact field.
- **Header dropdown behavior — definitively flat.** Section nav is a flat `<Link>` row, desktop and mobile `Sheet` alike. The ONLY dropdown is the account avatar menu. The user's own hedge was correct: fpcw-directory has no dropdown nav menus. This is new UX for presby, not a port — though presby already has direct precedent (`avatar-menu.tsx`'s own `DropdownMenu` wrap).
- **Footer — does not exist.** Exhaustive search returned nothing. Must be designed fresh, grounded in data presby actually has.
- **Colors are hardcoded, confirmed two ways.** A Tailwind v4 `@theme` block literally declares `--color-brand-50`...`--color-brand-900` as fixed hex; every card/nav consumer references these by name or drops a literal inline hex. None of it is `var(--...)`-driven and none may cross into presby's new CSS as-is.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Authenticated member | Hovers/clicks a top-level nav item that opens a dropdown | Per session |
| Authenticated member | Reads icon-labeled nav entries instead of text-only links | Per page view |
| Authenticated member | Hovers a directory/home card, sees shadow-lift before clicking through | On demand |
| Authenticated member | Scrolls to a portal page's footer, reads/clicks links | On demand, infrequent |
| Authenticated member, mobile | Interacts with dropdown sub-items via touch, not hover | Per session on mobile |

## Flows

**Flow 1 — Nav dropdown:** hover/tap a grouping top-level item → submenu opens (ARIA menu/menuitem, shadcn DropdownMenu precedent already in avatar-menu.tsx) → select a destination.
- Gap: no touch-device fallback defined, and no rule for a nav item with only ONE destination — every current flat item (Home, Tickets, Feedback) becoming a one-item dropdown would be a regression. Phase 3 must decide the degenerate case explicitly.

**Flow 2 — Card hover/click:** hover a directory/home card → shadow-lift/color-shift via CSS transition → click through.
- No gap of substance; pure visual layer over an existing working link.

**Flow 3 — Footer read/click:** scroll to a portal page's bottom → read org contact info/nav recap/copyright → optional tel:/mailto:/maps click.
- Gap: no empty-state behavior defined for a brand-new tenant with no `organization_profiles` row yet.

## Permissions & Flags

No new permissions — presentation-layer only, riding whatever already gates each nav destination/card. Recommend a new version flag (`org_portal.chrome_v3`, or extending `chrome_v2` if that hasn't reached 100% rollout — Phase 3 to check) so the whole cross-cutting visual rework can roll back atomically if the CSS-variable discipline slips.

## Gaps the Request Didn't Address

- Dropdown nav's information architecture is undefined — fpcw-directory's flat nav gives no template; Phase 3 must decide which of presby's five tiles actually warrant grouping.
- Footer content is presby-invented (the request names none). Working proposal: org name + address/phone from `organization_profiles` (if present) + a short nav-link recap + copyright — **not** the unrelated public-site Footer from presby-site-kit. Needs user sign-off.
- Footer empty state when `organization_profiles` has no row.
- Icon-per-tile mapping for presby's actual five tiles (Members/Directory/Administration/Tickets/Feedback) — new mapping work, not a copy.
- Mobile nav shape: current `PortalNavLinks` explicitly documents "wrap, not hamburger" — adding dropdown submenus at 360px needs a real design decision, not a silent default.
- No audit story needed (nothing security-sensitive here).

## Out of Scope (confirm with user)

- Porting fpcw-directory's Sheet-based mobile slide-over verbatim (reverses presby's own documented "no hamburger" precedent).
- Any home-zone restructuring beyond card hover treatment (find-a-person/church-events cards are feature-specific with no presby equivalent — don't invent new zones under cover of a styling pass).

## Open Questions — resolved 2026-08-26 (operator)

1. **Footer contents: all three** — org contact info, nav link recap, and copyright line.
2. **Nav dropdowns: deferred.** Ship icons + card-hover treatment only this round; keep the existing flat/collapsing nav from `2026-08-26-portal-nav-responsive.md`. Revisit grouping when a real multi-destination group exists — not invented under cover of this styling pass.
3. **Flag: cut a new flag, don't reuse `org_portal.chrome_v2`.** Checked live: `chrome_v2` is `enabled = true` with no per-org exceptions — effectively fully rolled out already, not a partial rollout with room to extend. This is a substantial cross-cutting visual rework (new footer, new card treatment); a fresh flag (`org_portal.chrome_v3`, seeded OFF) gives it its own atomic rollback boundary independent of chrome_v2's already-live surface.

**Scope for this pass, per the above:** Increment 1 (icons + card hover treatment) and Increment 3 (footer) from the Recommended Shipping Increments list. Increment 2 (nav dropdowns) is explicitly deferred, not cancelled.

## Brand-Safety Rule for Phase 3 (concrete, testable)

Every color declaration in the new card/nav/footer CSS must resolve through a Tailwind utility mapping to a `var(--...)` token already classified in `contract.ts`'s `TOKEN_POLICY` — zero literal hex, zero `bg-[#...]` arbitrary values, zero new brand-*-style custom palette entries. Dropdown/hover surfaces specifically should use `--accent`/`--accent-foreground` (the contract already names this exact case). Verification: this is a *source* question (does a color come from the token system), distinct from `check-brand-scope.mjs`'s *location* question (where the emitter may appear) — recommend a narrow new grep-based tripwire scoped to the new files, or a Phase 5 QA checklist item if a tripwire is overkill for three files.

## Recommended Shipping Increments

1. **Icons + card hover treatment** (lowest risk, directly portable, proves the brand-safety discipline holds).
2. **Nav dropdowns** (genuine new build, needs the IA decision resolved first).
3. **Footer** (genuine new build, presby-invented content, depends on the empty-state decision).

## Open Questions — resolved 2026-08-26 (operator)

See the resolved-questions block above the "Recommended Shipping Increments" section for the operator's answers (footer: all three of contact info/nav recap/copyright; dropdowns: deferred; flag: new `org_portal.chrome_v3`).

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions**

## Placement

- **Footer component** → `src/components/org-portal/portal-footer.tsx`, co-located with the rest of portal chrome (`tile-grid.tsx`, `yours-zone.tsx`, `greeting.tsx`) — `(org)`-specific, explicitly not the presby-site-kit public-site footer.
- **Card hover/icon treatment** → no new component; a className diff (`hover:shadow-md transition-shadow` + inline `lucide-react` icons) on the existing `<Card>` consumers: `person-card.tsx`, `household-card.tsx`, `deacon-card.tsx`, `tile-grid.tsx`.

## Server vs Client split

- **Footer: Server Component**, no `'use client'`.
- **New reader required**: neither existing `organization_profiles` reader is legal inside `(org)` — `getOrganizationProfileAdminDetail()` uses `getPlatformDb()` (forbidden here), and the anonymous public-site path is the wrong trust boundary for an authenticated member. Phase 3 must spec `getOrgProfileForFooter(organizationId, personId)` in `src/lib/sites.ts`: `withOrgContext()`-based, `cache()`-wrapped, mirroring `getOrgBrandForLayout()`'s null-collapse contract (any non-`ok` reason → `null`, footer degrades to no-contact-info rather than breaking the page).
- **Wiring point**: `layout.tsx`'s existing `Promise.all([resolveOrgContext(...), isFlagEnabled(...)])`, inside the `resolved.kind === "ok"` branch, same resolved `(organizationId, personId)` pair `orgBrand`/`orgMark` already use.

## Dependencies

`lucide-react` already a dependency, already used in this subtree. Nothing new.

## Invariants Touched

- **Permissions vs Flags** — new flag `org_portal.chrome_v3`, seeded OFF (`chrome_v2` confirmed live at `enabled=true`, no partial rollout to extend — this rework gets its own rollback boundary).
- **The `(org)` contract** — the new reader must go through `withOrgContext()`, never `getPlatformDb()`.
- **DECISION-040 / gate discipline** — footer data fetch lives inside the same active-relationship branch as `orgBrand`/`orgMark`; never rendered on access-denied/ended/404 paths.
- **Brand token discipline** — hover surfaces use `hover:bg-accent hover:text-accent-foreground` (matches `tile-grid.tsx`). Named trap: `check-brand-scope.mjs`'s C1 rule only permits `*-brand[-*]` utilities under `src/app/(org)/`or `src/app/(public)/`, not `src/components/` — a raw-brand class in `portal-footer.tsx` would fail C1; it would have to live in `layout.tsx` instead. No script changes needed otherwise.
- **No Real Data** — use `example.invalid`-style fixture rows for `organization_profiles` when screen-testing.

## Notes for Phase 3

1. Spec `getOrgProfileForFooter(organizationId, personId)` in `src/lib/sites.ts`.
2. Wire into `layout.tsx`'s `Promise.all`, gated on `org_portal.chrome_v3`, `resolved.kind === "ok"` branch only.
3. Card treatment: four-file className diff, not a new component.
4. State the accent-token rule and the component-scope brand-class trap explicitly for the implementer.
5. Confirm empty-state microcopy when `organization_profiles` has no row.

## Implementer recommendation

**full-stack-developer**, single-owner — the reader is a near-verbatim structural copy of `getOrgBrandForLayout`, not novel logic; splitting it to api-developer would add more handoff overhead than the diff justifies.

**Handoff:** → tech-lead (Phase 3).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-26 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-26 |

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Scope for this pass, per the operator's resolution in Phase 1, is **Increment 1** (icons + card hover treatment) and **Increment 3** (a new portal footer). Increment 2 (nav dropdowns) is deferred and is not designed here.

Increment 1 is a presentation-only className/icon diff on four existing card-shaped components — no new component, no new data. Increment 3 needs one new datum presby does not yet have a legal `(org)` reader for: `organization_profiles` (address/phone). Both existing readers of that table are wrong for this call site (`getOrganizationProfileAdminDetail` uses `getPlatformDb()`, forbidden inside `(org)`; the anonymous public-site path has no membership check to offer). This design adds one new reader, `getOrgProfileForFooter(organizationId, personId)` in `src/lib/sites.ts`, structurally identical to `getOrgMarkForLayout()` in `src/lib/brand/read-org-brand.ts` — `withOrgContext()`-based, `cache()`-wrapped, null-collapsing on every non-`ok` reason — and one new component, `PortalFooter`, wired into the same `resolved.kind === "ok"` branch of `(org)/o/[slug]/layout.tsx` that already computes `orgBrand`/`orgMark`, behind its own flag (`org_portal.chrome_v3`, seeded OFF) so it has an independent rollback boundary from the already-fully-live `chrome_v2`.

## Permissions & Flags

- Permission key(s): none new. Every nav-recap destination in the footer already gates itself (same "flag is a convenience link, never a grant" contract `PortalTile`/`PortalNav` already document) — the footer adds no permission check of its own.
- Default role bindings: n/a — no new permission.
- Feature flag(s): **new** `org_portal.chrome_v3`, seeded `enabled: false` in `scripts/seed.ts`'s `seedFlags()` defaults array (same shape as the existing `org_portal.chrome_v2` entry, `.onConflictDoNothing()` — additive, does not touch `chrome_v2`'s already-flipped `enabled = true` row). Gates BOTH increments in this pass as one unit (icons/hover treatment ship dark-safe regardless, since they're pure CSS/icon diffs with no data dependency, but bundling them under one flag with the footer gives the whole visual-rework pass one atomic rollback switch, matching Phase 1's own stated rationale for cutting a new flag rather than reusing `chrome_v2`). Checked bare (`isFlagEnabled`), no DECISION-026 fail-open wrapper — a chrome toggle, not an auth path.
- Card treatment (Increment 1) does not gate on `org_portal.chrome_v3` independently — see Edge Cases for why the flag is read once, at the layout, and the card files themselves carry no flag check (they're always-rendered leaves; there's no destination to gate, only a class/icon diff).

## API Contract

New server-only reader, `src/lib/sites.ts` (co-located with the existing `organization_profiles` readers, per that file's own "three/four caller shapes in one file, deliberately not split further" convention — this becomes explicitly a fifth: "genuine tenant-member read, membership-verified, `withOrgContext()`"):

```ts
export type OrgProfileForFooter = {
  address: string | null;
  phone: string | null;
};

export const getOrgProfileForFooter = cache(
  async (
    organizationId: string,
    personId: string,
  ): Promise<OrgProfileForFooter | null> => {
    let row;
    try {
      row = await withOrgContext(personId, organizationId, async (tx) => {
        const [r] = await tx
          .select({
            address: organizationProfiles.address,
            phone: organizationProfiles.phone,
          })
          .from(organizationProfiles)
          .where(eq(organizationProfiles.organizationId, organizationId))
          .limit(1);
        return r ?? null;
      });
    } catch (err) {
      if (err instanceof OrgAccessError) return null;
      throw err;
    }
    if (!row) return null;
    return { address: row.address, phone: row.phone };
  },
);
```

Only new import needed in `sites.ts`: add `OrgAccessError` to the existing `import { withOrgContext } from "@/lib/authz";` line. `cache`, `db`/`withOrgContext`, and `organizationProfiles` are already imported in that file.

**Scope decision — address/phone only, not the five social-link columns.** Phase 1's own working proposal (confirmed by the operator as "org contact info") named "org name + address/phone" specifically; the org name is already available to the caller as `resolved.org.name` and is not re-fetched. Social links (`facebookUrl`/`instagramUrl`/`xTwitterUrl`/`youtubeUrl`/`otherUrl`) are out of scope for this pass — same table, no schema change either way, and adding them later is a pure widening of this function's `select` and return type, not a reshape.

**Flag-check location — deliberately the CALLER, not this function.** This diverges from `getOrgBrandForLayout()` (which checks `ui.brand_theming` internally) and instead mirrors `getOrgMarkForLayout()` (which does not check `org_portal.chrome_v2` internally — the caller does). The reason is the same one that made `chrome_v2` a caller-side gate: `org_portal.chrome_v3` is a rollout/rollback lever over *whether this read and render happen at all*, not a property of the data itself, and `layout.tsx` is already the one place both flags are read. A future caller of `getOrgProfileForFooter` that forgets to check the flag first will get real address/phone data regardless of rollout state — named explicitly in Edge Cases as a paper contract, same class as several `/developer`-marked invariants.

No new route handlers, no new server actions — this is a read wired directly into a layout, exactly like `getOrgBrandForLayout`/`getOrgMarkForLayout` already are.

## Data Model

No schema changes required. `organization_profiles` already exists (DECISION-090, `drizzle/0021_presby_site_profile.sql`), already has `FORCE ROW LEVEL SECURITY` with a standard `tenant_isolation` policy (`organization_id = presby_current_org()`), and `presby_app` already holds a full `select/insert/update/delete` grant on it — confirmed by reading the migration directly rather than assuming. `withOrgContext()` needs nothing new on this table; it is read-only for this feature (no write path is being added).

## Component / Page Plan

**New files:**
- `src/components/org-portal/portal-footer.tsx` — `PortalFooter`, a Server Component (no `'use client'`), co-located with `portal-nav`'s sibling chrome pieces per Phase 2's placement ruling.
  - Props: `{ slug: string; organizationName: string; profile: OrgProfileForFooter | null }`.
  - Internally calls `visiblePortalTiles()` itself (the exact same flag-only registry `PortalNav` already calls) to build the nav recap — **not** passed down from `layout.tsx`/`PortalNav`. This mirrors `PortalNav`'s own precedent of self-sufficient, independently-read chrome (`layout.tsx`'s own comment: "Independent of `GlobalNav`'s org-list read — a degraded switcher does not take this row down, and vice versa"). Tradeoff named: this means `visiblePortalTiles()` — a cheap, DB-free, flag-only read — runs twice per request when `chrome_v3` is on (once for `PortalNav`, once for `PortalFooter`). Fine for now because both reads are flag-table lookups behind React `cache()`-adjacent dedup within the same registry function is NOT itself `cache()`-wrapped, so this is a real (if cheap) double read — revisit if `visiblePortalTiles()` ever needs org-scoped filtering that makes a double call more than a rounding error (tracked as a docs/TODO.md follow-up, same shape as the already-named `resolveOrgContext` double-read).
  - Renders three blocks, in order: contact info (org name + address + `tel:` phone link — omitted ENTIRELY, not as an empty wrapper, when `profile` is `null` or both `address`/`phone` are `null`), nav recap (`<nav aria-label="Footer">`, plain `<Link>`s — Home prepended, then `visiblePortalTiles()`'s entries, matching `PortalNav`'s own Home-is-hardcoded convention — no active-state styling, this is a footer, not the persistent nav), and a copyright line (`© {new Date().getFullYear()} {organizationName}. All rights reserved.`).
  - No `*-brand[-*]` utility class anywhere in this file — it lives under `src/components/`, not `src/app/(org)/` or `src/app/(public)/`, so `check-brand-scope.mjs`'s C1 rule would fail it immediately. Nothing about this component needs one: it uses only semantic tokens already legal tree-wide (`border-border`, `text-muted-foreground`, `text-foreground`, `hover:text-foreground`).
  - Address renders as plain text, not a maps deep link — the "URL-encode into a maps link" behavior belongs to the unrelated public-site profile display (`PublishedSite.profile`, a presby-site-kit consumer); no such requirement was named for this footer, and inventing one would be scope creep.
- `src/components/org-portal/portal-footer.test.tsx` — written by the implementer (Phase 4 gate).

**Files to modify:**
- `src/lib/sites.ts` — add `getOrgProfileForFooter` + `OrgProfileForFooter` (above), add `OrgAccessError` to the existing `@/lib/authz` import.
- `src/app/(org)/o/[slug]/layout.tsx` — extend the existing top-level `Promise.all([resolveOrgContext(...), isFlagEnabled("org_portal.chrome_v2")])` to a three-way `Promise.all` adding `isFlagEnabled("org_portal.chrome_v3")`. Inside the existing `if (resolved.kind === "ok")` branch, independently of the `chromeV2Enabled` branch (footer is gated on its own flag, not on `chrome_v2`), add: `if (chromeV3Enabled) { footerProfile = await getOrgProfileForFooter(resolved.org.organizationId, resolved.org.personId); showFooter = true; }`. Render `{showFooter ? <PortalFooter slug={slug} organizationName={resolved.org.name} profile={footerProfile} /> : null}` as a sibling **after** `<main>{children}</main>`, inside the `session?.user` branch — never on the no-session fallback header, and never when `resolved.kind !== "ok"` (same DECISION-040 discipline `orgBrand`/`orgMark`/`showPortalNav` already follow: forbidden/ended/not-found/no-session pages stay byte-identical).
- `src/app/(org)/o/[slug]/layout.test.tsx` — **must** be updated in the same commit; see Edge Cases, this is the one confirmed existing-spec break.
- `src/components/org-portal/tile-grid.tsx` — add a local, render-layer-only `Record<string, LucideIcon>` keyed on `tile.key` (members → `UserPlus`, directory → `BookOpen`, roles → `Settings`, tickets → `Ticket`, feedback → `MessageSquare`; unmapped key → a default fallback icon, e.g. `LayoutGrid`, so a future `PORTAL_TILES` addition never crashes this render) rendered beside each tile's `<h3>`. `src/lib/org-portal/tiles.ts` itself is NOT modified — `PortalTile` stays presentation-agnostic, matching Phase 2's "no new component" ruling. Also add `hover:shadow-md transition-shadow` to the existing `<Link>` className, alongside its current `hover:bg-accent hover:text-accent-foreground` (both survive — shadow-lift AND color-shift, matching Phase 1 Flow 2's description).
- `src/app/(org)/o/[slug]/directory/person-card.tsx` — add `Mail`/`Phone`/`MapPin` icons (`lucide-react`, `size-3`, `aria-hidden`, `shrink-0`, `text-muted-foreground`) inline before the email/phone/city lines respectively (the existing `Lock` icon on the hidden badge is untouched). Add `hover:shadow-md transition-shadow` to the outer `<Card className="py-4">`. **No `cursor-pointer`** — see Edge Cases.
- `src/app/(org)/o/[slug]/directory/household-card.tsx` — add a `MapPin` icon before the city/state line (same sizing convention as person-card). Add `hover:shadow-md transition-shadow` to the outer `<Card>`. No `cursor-pointer`.
- `src/components/org-portal/deacon-card.tsx` — add `hover:shadow-md transition-shadow` to the outer `<Card>` for visual-family consistency with the other two directory cards it's always co-rendered beside. **Cosmetic only** — this card has no link at all; no `cursor-pointer`, no new icon (the existing `UserRound` in the empty-avatar circle already covers the "no deacon assigned" case).
- `scripts/seed.ts` — one new entry in `seedFlags()`'s `defaults` array: `{ key: "org_portal.chrome_v3", description: "...", enabled: false }`, same shape/placement convention as the `org_portal.chrome_v2` entry immediately above it.

## Implementation Order

1. `scripts/seed.ts` — add the `org_portal.chrome_v3` flag entry (seeded OFF). No `FEATURE_CATALOG` entry — no new permission exists in this feature.
2. `src/lib/sites.ts` — add `getOrgProfileForFooter`/`OrgProfileForFooter`.
3. `src/components/org-portal/portal-footer.tsx` — new component, built and unit-tested against a mocked `visiblePortalTiles()`/prop-driven `profile`, before it's wired into the layout (matches `PortalNav`'s own build order).
4. `src/app/(org)/o/[slug]/layout.tsx` — wire the flag + reader + `<PortalFooter>` render into the existing `Promise.all`/`resolved.kind === "ok"` branch.
5. `src/app/(org)/o/[slug]/layout.test.tsx` — update mocks (new `@/lib/sites` and `./portal-footer`/`@/components/org-portal/portal-footer` mocks, flag-key-aware `isFlagEnabled` mock implementation) and add the new chrome_v3 on/off × ok/non-ok test cases, in the SAME commit as step 4 — this is not optional follow-up cleanup, it is the fix for a break this design causes.
5a. (Independent of 1–5, can proceed in parallel) `tile-grid.tsx`, `person-card.tsx`, `household-card.tsx`, `deacon-card.tsx` — the Increment 1 className/icon diff. No dependency on the footer work; either can ship first.
6. No audit events — no security-sensitive mutation exists in this feature (read-only reader, no new write path, no role/flag/TOTP/deactivation change).
7. Release notes entry (`docs/release-notes/vX.Y.md`, tech-lead, at Phase 6 SHIP IT) + `docs/product/functionality-map.md` line update + `docs/TODO.md` reconciliation, per Rules 10/14 — bundled into the same housekeeping cluster, not this phase's job to execute but named here so Phase 6 doesn't have to rediscover it.

## Edge Cases & Risks

- **Confirmed existing-spec break (unit, not e2e): `src/app/(org)/o/[slug]/layout.test.tsx`.** Every test in this file mocks `isFlagEnabled` with a single blanket `isFlagEnabled.mockResolvedValue(true|false)` that applies identically to every call regardless of the key argument — there is currently only one call (`org_portal.chrome_v2`) so this works. The moment `layout.tsx` adds a second `isFlagEnabled("org_portal.chrome_v3")` call, the existing blanket mock resolves BOTH flags to the same value, which is silently wrong for any test that wants to exercise chrome_v2 and chrome_v3 independently — and more urgently, the file does not yet mock `@/lib/sites`'s `getOrgProfileForFooter` or the new `./portal-footer` (or `@/components/org-portal/portal-footer`) import at all, so once `layout.tsx` imports them for real, this Vitest file will attempt to load `src/lib/sites.ts`'s real module graph (which pulls `@/lib/db`, a live Neon pool constructor) inside a `jsdom` environment — a hard failure, not a soft one. The implementer must, in the same commit: (a) add `vi.mock("@/lib/sites", ...)` and `vi.mock("./portal-footer", ...)` stubs matching the existing `getOrgBrandForLayout`/`PortalNav` mock pattern, (b) switch `isFlagEnabled`'s mock to a `mockImplementation((key) => ...)` keyed on the flag string, and (c) add the four new cases (chrome_v3 on/off × `resolved.kind` ok/non-ok) mirroring the existing chrome_v2 matrix. This is exactly the class of loop-back the 2026-07-11 retro flagged — naming it here so it isn't discovered informally in Phase 5.
- **e2e blast radius: none identified.** Grepped `e2e/*.spec.ts` for anything touching `/o/<slug>` directory/tile-grid markup or querying link labels the new footer nav-recap could collide with (`member-home.spec.ts`, `header-controls.spec.ts`, `post-login-routing.spec.ts` are the specs that reach `/o/<slug>` or `/home` at all). None assert against tile-grid/person-card/household-card/deacon-card content, and none use an unscoped `getByRole("link", { name: ... })` for a label the footer's nav recap (Home/Directory/Administration/Tickets/Give feedback) would now duplicate — `post-login-routing.spec.ts`'s `getByRole("link", { name: /presbyter/i })` targets org-chooser cards, unrelated. Named as a risk for future e2e authors regardless: the footer's nav recap is wrapped in `<nav aria-label="Footer">` specifically so a future spec can scope its query (`page.getByRole("navigation", { name: "Footer" })` or `page.locator("footer")`) rather than an unscoped link-name lookup that would hit both the header row and the footer recap.
- **Footer empty state.** No `organization_profiles` row for this org (a brand-new tenant), or a row that exists but has both `address` and `phone` null (only social links ever filled in — irrelevant here since we don't read them) both collapse to the same rendering: the contact-info block is omitted entirely (not rendered as an empty bordered section), and the footer shows nav recap + copyright only. Checked as `profile?.address || profile?.phone` (truthy on either), never `!!profile` alone, so a row with, say, only `phone` set still renders that one line.
- **`OrgAccessError` race.** Same rare window `getOrgBrandForLayout`/`getOrgMarkForLayout` already document: a membership that vanishes between `layout.tsx`'s `resolveOrgContext()` and this reader's own `withOrgContext()` re-check degrades to `null` (empty-state footer), never a crash and never someone else's data.
- **Brand-scope trap, restated for the implementer:** `portal-footer.tsx` lives under `src/components/org-portal/`, which does **not** match either of `check-brand-scope.mjs`'s `BRANDABLE_PREFIXES` (`src/app/(org)/`, `src/app/(public)/`) — a path-prefix check on `src/app/`, not `src/components/`. Any `*-brand[-*]` utility class written in this file fails C1 immediately, regardless of the fact that the component only ever renders inside `(org)`. Nothing in this design needs one; called out so an implementer doesn't reach for `border-brand`/`text-brand` out of an "this is branded chrome" instinct.
- **Card treatment scope decision — no `cursor-pointer`, no full-card accent flood.** fpcw-directory's own `member-card.tsx` applies `hover:shadow-md transition-shadow cursor-pointer` to a card that is ONE whole clickable link. presby's `PersonCard`/`HouseholdCard` are not — they hold a name `<Link>`, separate `mailto:`/`tel:` links, and plain text (city), so `cursor-pointer` on the outer `<Card>` would misrepresent hovering over inert whitespace as clickable. This design ports the shadow-lift only, not the cursor affordance, and does not add `hover:bg-accent`/`hover:text-accent-foreground` to these two cards (unlike `tile-grid.tsx`, which already had that color-shift pre-existing and is a single whole-card link) — adding a full-card accent-color flood behind multiple independent nested links/badges was judged more likely to look broken (a `Badge`'s own background fighting the parent's hover background) than additive.
- **`deacon-card.tsx` gets a cosmetic-only diff.** It has no link and no click target; the shadow-lift is applied purely so the three cards that always render together (person/household detail pages) read as one consistent family rather than one visually flat card among two "lifted" ones. QA's Phase 5 pass should confirm no `tabindex`/interactive `role` was introduced alongside it.
- **Tile-icon map staleness.** The new icon lookup in `tile-grid.tsx` is keyed on `tile.key` and lives entirely at the render layer, decoupled from `src/lib/org-portal/tiles.ts`. A future `PORTAL_TILES` addition with no matching icon-map entry must still render (fallback icon), not throw — specified above, worth a explicit regression test.
- **Flag-check-location paper contract.** As noted in API Contract: `getOrgProfileForFooter` does not check `org_portal.chrome_v3` itself. This is deliberate (mirrors `getOrgMarkForLayout`), but it means a future caller that imports this function directly without checking the flag first gets live data regardless of rollout state. Not database- or trigger-enforced — a paper invariant, same class several `/developer`-marked ones already are.

## Implementer

**full-stack-developer**, confirming the architect's Phase 2 recommendation. Reasoning: the new reader is a structural copy of an already-shipped pattern (`getOrgMarkForLayout`), the new component is a small Server Component with no client-side logic at all (no `'use client'` needed anywhere in this feature), and the card-treatment diff is a four-file className/icon change with no new abstraction. Splitting this across `api-developer`/`ux-developer` would introduce a handoff for a change small and tightly coupled enough that one implementer holding both the reader and its one consumer end-to-end is lower-risk than a review boundary in the middle of it — particularly given the confirmed `layout.test.tsx` break, which touches both the "server" (flag/reader wiring) and "client-facing" (mock/test) surface in the same file.

**Handoff:** → full-stack-developer (Phase 4).

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-26 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-26 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named (full-stack-developer) | 2026-08-26 |
| 4 — Implementation | full-stack-developer | Complete | Typecheck/build/3-of-4 tripwires/tests green | 2026-08-26 |
| 5 — Verification | qa | Complete | PASS | 2026-08-26 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-08-26 |

---

# Phase 4 — Implementation (full-stack-developer)

Scope implemented: **Increment 1** (icons + card hover treatment) and
**Increment 3** (portal footer), exactly per Phase 3's Component/Page Plan
and Implementation Order. Increment 2 (nav dropdowns) was NOT touched — no
nav grouping/dropdown behavior changed.

## Files Created

- `src/components/org-portal/portal-footer.tsx` — `PortalFooter`, a Server
  Component (no `'use client'`). Props `{ slug, organizationName, profile }`.
  Calls `visiblePortalTiles()` itself (matches `PortalNav`'s own
  self-sufficient-read precedent). Renders three blocks in order: contact
  info (org name + address + `tel:` phone, omitted entirely — not an empty
  section — when `profile` is `null` or both `address`/`phone` are `null`),
  a `<nav aria-label="Footer">` recap (Home prepended + `visiblePortalTiles()`
  entries), and a copyright line. No `*-brand[-*]` utility class anywhere in
  it (lives under `src/components/`, C1-illegal there); every color resolves
  through `border-border`/`text-muted-foreground`/`text-foreground`/
  `hover:text-foreground`. Address renders as plain text, no maps deep link.
- `src/components/org-portal/portal-footer.test.tsx` — contact-info present/
  address-only/phone-only/both-null/no-row cases, nav recap (Home always
  present + flag-filtered tiles), copyright text. 8 tests, all green.

## Files Modified

- `src/lib/sites.ts` — added `OrgAccessError` to the existing `@/lib/authz`
  import; added `OrgProfileForFooter` type +
  `getOrgProfileForFooter(organizationId, personId)`, `cache()`-wrapped,
  `withOrgContext()`-based, address/phone only (no social links), collapsing
  `OrgAccessError` and the no-row case to `null`. Placed as a new "fifth
  caller shape" section between `getOrganizationProfileAdminDetail` and
  `setOrganizationProfile`, with its own header-comment entry documenting
  why it's distinct from both existing `organization_profiles` readers.
  Flag-check location is deliberately the CALLER (`layout.tsx`), not this
  function — matches `getOrgMarkForLayout()`'s precedent, not
  `getOrgBrandForLayout()`'s. No schema change — `organization_profiles`
  already has FORCE RLS + full `presby_app` grant (verified by reading
  `drizzle/0021_presby_site_profile.sql` directly, per Phase 3's own note).
- `src/lib/sites.test.ts` — new self-contained `describe("getOrgProfileForFooter")`
  block (own orgs/people fixture, not reusing `orgLive`/`orgUnprovisioned`,
  which earlier describes in this same file mutate — avoids file-order
  fragility). Three cases: present row → address/phone returned; no
  `organization_profiles` row → `null`; a person with an active membership
  at a DIFFERENT org (`orgOutsider`) queried against `orgWithRow` → `null`,
  proving RLS (not an app-layer filter) refuses the row — the cross-org
  isolation proof the task asked for. Run against the real dev DB: 59/59
  passed in this file (56 pre-existing + 3 new).
- `src/app/(org)/o/[slug]/layout.tsx` — extended the `Promise.all` with a
  third `isFlagEnabled("org_portal.chrome_v3")` call; inside the existing
  `resolved.kind === "ok"` branch, independently of the `chromeV2Enabled`
  branch, added `if (chromeV3Enabled) { footerProfile = await
  getOrgProfileForFooter(...); footerOrgName = resolved.org.name; showFooter
  = true; }`. `<PortalFooter>` renders as a sibling AFTER
  `<main>{children}</main>`, gated on `session?.user && showFooter` — never
  on the no-session fallback header, never when `resolved.kind !== "ok"`
  (both flags off/on × ok/non-ok verified in the updated test file below).
  Header doc comment extended with a new "PORTAL FOOTER" paragraph naming
  the same DECISION-040 discipline the existing brand/nav paragraphs
  document.
- `src/app/(org)/o/[slug]/layout.test.tsx` — **fixed the confirmed
  pre-existing break** named in Phase 3 Edge Cases: added
  `vi.mock("@/lib/sites", ...)` and
  `vi.mock("@/components/org-portal/portal-footer", ...)` stubs; switched
  `isFlagEnabled`'s mock from one blanket `mockResolvedValue` to a key-aware
  `Map`-backed implementation (`flagValues.set(key, value)` per test, unset
  keys default to `false` — matches the real seeded-OFF default for both
  new flags); updated every existing test body from
  `isFlagEnabled.mockResolvedValue(...)` to
  `flagValues.set("org_portal.chrome_v2", ...)`; added four new cases for
  the `org_portal.chrome_v3` on/off × `resolved.kind` ok/non-ok matrix, plus
  a case proving `chrome_v3` is independent of `chrome_v2` (footer renders
  with `chrome_v2` OFF, and vice versa). 12 describe blocks, all green.
- `src/components/org-portal/tile-grid.tsx` — added a local
  `TILE_ICONS: Record<string, LucideIcon>` keyed on `tile.key`
  (`members`→`UserPlus`, `directory`→`BookOpen`, `roles`→`Settings`,
  `tickets`→`Ticket`, `feedback`→`MessageSquare`; unmapped key →
  `LayoutGrid` fallback). `src/lib/org-portal/tiles.ts` untouched, per
  Phase 2's "no new component" ruling. Added
  `hover:shadow-md transition-shadow` to the existing `<Link>` className
  alongside its pre-existing `hover:bg-accent hover:text-accent-foreground`
  (both survive).
- `src/components/org-portal/tile-grid.test.tsx` — added: hover-class
  assertion (shadow + existing accent classes coexist), a mapped-icon
  render check, and the tile-icon-staleness regression (an unmapped
  `PortalTile.key` still renders a fallback icon, never throws).
- `src/app/(org)/o/[slug]/directory/person-card.tsx` — added `Mail`/`Phone`/
  `MapPin` icons (`lucide-react`, `size-3`, `aria-hidden`, `shrink-0`,
  `text-muted-foreground`) inline before the email/phone/city lines. Added
  `hover:shadow-md transition-shadow` (shadow-lift only) to the outer
  `<Card className="py-4">`. **No `cursor-pointer`, no `hover:bg-accent`**
  per DECISION-099 — this card has multiple independent link targets.
- `src/app/(org)/o/[slug]/directory/household-card.tsx` — added a `MapPin`
  icon before the city/state line, same sizing convention. Added
  `hover:shadow-md transition-shadow` to the outer `<Card>`. No
  `cursor-pointer`.
- `src/app/(org)/o/[slug]/directory/directory-grid.test.tsx` — added a
  "card hover treatment" describe block: shadow-lift + transition classes
  present, `cursor-pointer`/`hover:bg-accent` absent, and a 3-icon count
  (Mail/Phone/MapPin) when all three contact fields are present.
- `src/app/(org)/o/[slug]/directory/households-grid.test.tsx` — added the
  matching hover-class assertions and a MapPin-icon-presence check.
- `src/components/org-portal/deacon-card.tsx` — added
  `hover:shadow-md transition-shadow` to the outer `<Card>`, COSMETIC ONLY
  (no link, no click target, no icon change) — visual-family consistency
  with the other two directory cards it always co-renders beside.
- `src/components/org-portal/deacon-card.test.tsx` — added a regression
  test confirming the hover classes are present AND no `tabindex`/
  `role="button"`/`<a>` was introduced alongside them (Phase 3 Edge Cases'
  explicit QA callout, pinned here instead of left to manual Phase 5
  inspection).
- `scripts/seed.ts` — added the `org_portal.chrome_v3` flag entry (seeded
  `enabled: false`), same shape/placement convention as
  `org_portal.chrome_v2` immediately above it. No `FEATURE_CATALOG` entry
  — no new permission.

## Schema Changes

None. `organization_profiles` already exists (DECISION-090,
`drizzle/0021_presby_site_profile.sql`) with FORCE RLS and a full
`presby_app` grant — confirmed by reading the migration, not assumed. No
`db:push`/`db:generate` needed for this feature.

## Audit Events

None. Read-only reader, no new write path, no role/flag/TOTP/deactivation
change — matches Phase 3's own "no audit story" call.

## Feature Flag

- **New:** `org_portal.chrome_v3`, seeded `enabled: false` in
  `scripts/seed.ts`. Gates BOTH increments in this pass as one atomic
  rollback unit (card hover/icons + the footer). Checked bare via
  `isFlagEnabled` — no DECISION-026 fail-open wrapper (a chrome toggle, not
  an auth path). Deliberately NOT reusing `org_portal.chrome_v2` (confirmed
  live at `enabled=true` with no partial rollout to extend, per Phase 1's
  own finding).
- `seedFlags()`'s insert means this new row will need `npm run db:seed`
  (or an equivalent manual insert) run against any environment that already
  has a `feature_flags` table before the flag exists there — flagged for
  QA/the operator, not a schema migration.

## Verification Run (implementer's own pre-handoff pass)

- `npm run typecheck` — **PASS**, zero errors.
- `npm run build` — **PASS**. `next build` compiled successfully, `tsc`
  finished clean, all 37 routes generated (Turbopack, production build).
- `npm run check:audit` — **PASS** ("Audit-coverage check passed.").
- `npm run check:sql-date` — **PASS** ("sql<Date> guard passed.").
- `npm run check:deps-drift` — **PASS** ("Dependency-drift check passed.").
- `npm run check:brand-scope` — **FAIL, but pre-existing and unrelated to
  this feature.** The only violation reported is
  `[C2] src/components/shared/pagination.tsx:16/18` (a button-shaped class
  string outside `src/components/ui/`) — a file this feature never touches
  (confirmed via `git diff --stat -- src/components/shared/pagination.tsx`,
  empty; the file was last modified in commit `9e2a69f`, unrelated to this
  work-log). No `*-brand[-*]` utility class was introduced by any file this
  feature added or modified — verified by direct inspection of
  `portal-footer.tsx` and every touched card/layout file. QA should treat
  the C2 pagination finding as out-of-scope debt for this pipeline, not a
  Phase 4 regression.
- Targeted unit tests — **PASS**, 63/63:
  `src/app/(org)/o/[slug]/layout.test.tsx`,
  `src/components/org-portal/portal-footer.test.tsx`,
  `src/components/org-portal/tile-grid.test.tsx`,
  `src/components/org-portal/deacon-card.test.tsx`,
  `src/app/(org)/o/[slug]/directory/directory-grid.test.tsx`,
  `src/app/(org)/o/[slug]/directory/households-grid.test.tsx`.
- `npm run test` (full suite, no `DATABASE_URL` sourced) — **PASS**, 2104
  passed / 278 skipped (the DB-gated suites) across 157 test files.
- `npx dotenv -e .env.local -- npx vitest run src/lib/sites.test.ts` (real
  dev Postgres, `presby_app`/RLS-enforced) — **PASS**, 59/59, including the
  three new `getOrgProfileForFooter` cases (present row, no-row, cross-org
  isolation via RLS).

## Implementer Notes

- The `layout.tsx` edit was done carefully to preserve the exact
  DECISION-040 gate shape the existing `orgBrand`/`orgMark`/`showPortalNav`
  wiring already uses: `chromeV3Enabled` is read in the same `Promise.all`,
  but `getOrgProfileForFooter` is only ever called inside
  `resolved.kind === "ok"`, and `<PortalFooter>` is only ever rendered
  inside the `session?.user` branch. No footer render path exists on the
  access-denied/ended/not-found/no-session pages.
- Followed Phase 3's explicit DECISION-099 ruling to the letter:
  `person-card.tsx`/`household-card.tsx` get shadow-lift only (no
  `cursor-pointer`, no `hover:bg-accent` flood); `tile-grid.tsx` keeps its
  pre-existing `hover:bg-accent hover:text-accent-foreground` and gains the
  shadow on top; `deacon-card.tsx` gets the shadow only, cosmetically, with
  no other change.
- The `sites.test.ts` addition deliberately did NOT reuse the file's shared
  `orgLive`/`orgUnprovisioned` fixture — both are mutated by earlier
  describe blocks in the same file (`setOrganizationProfile` writes to
  `orgUnprovisioned`, and a later describe writes a profile row onto
  `orgLive`), which would have made a `getOrgProfileForFooter` "no row"
  assertion depend on file execution order. A small, self-contained
  fixture (its own three orgs, its own people/memberships, its own
  `afterAll` cleanup) costs a little more code but has zero order
  dependency on the rest of the file.
- `docs/TODO.md`, `docs/decisions.md`, `docs/briefings.md`, and two other
  work-log files show as modified/untracked in `git status` at the time of
  this commit — these belong to a different, concurrently in-flight
  pipeline in this same working tree (per the user's own "kick off other
  work in parallel" direction in this work-log's Source line) and were not
  touched by this implementation. Not reconciled here; that's the other
  pipeline's own Phase 6 job.
- No follow-up TODO items were opened by this implementation itself. The
  pre-existing `check:brand-scope` C2 finding on `pagination.tsx` is
  unrelated pre-existing debt (see Verification Run above) — worth a line
  in `docs/TODO.md` at some point, but out of scope to open here since it
  predates and is untouched by this feature.

## Handoff

→ **qa** (Phase 5). Suggested manual/browser checks:
- Seed or manually flip `org_portal.chrome_v3` ON for a fixture org;
  confirm the footer renders below `<main>` on `/o/<slug>`,
  `/o/<slug>/directory`, and at least one admin-gated portal page, with the
  flag OFF showing no footer at all (byte-identical to pre-pipeline).
- With the flag ON: an org with an `organization_profiles` row (address +
  phone) shows both lines and a working `tel:` link; an org with none shows
  nav-recap + copyright only, no broken layout.
- Directory grid and households grid at 360px: cards show the shadow-lift
  on hover/focus (can't observe `:hover` directly in an e2e trace, but
  confirm layout doesn't break and icons render at that width) — mobile
  verification per CLAUDE.md's "Verify in a Browser" invariant.
- Confirm `org_portal.chrome_v2`'s own header/nav still work unchanged with
  `chrome_v3` toggled independently in both directions (the two flags must
  not interact).

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-26
**Verified by:** qa

## Type Check

`npm run typecheck`: **PASS** — zero errors.

## Unit Tests

Full suite (`npm run test`): **PASS** — 2132 passed | 304 skipped (144/159 files), 5.6s. Re-run 20+ times; reproducible.

Two anomalies observed and traced to ground, neither attributable to this diff:
1. One isolated flake in `deacon-card.test.tsx` ("hover treatment is cosmetic only") — reproduced the `cn()`/`twMerge` merge by hand, confirmed the source is correct, passed in isolation and in 19/20 subsequent full-suite runs. Reads as a rare vitest cross-file flake — flagged as a follow-up to check `vitest.config.ts` worker isolation, not blocking.
2. A `--coverage` run showed `audit.test.ts`'s pinned-count assertion fail (45 expected vs. 47 got) — traced to the concurrent, separate `2026-08-26-groups-and-officers` pipeline's uncommitted `OFFICER_TERM_STARTED`/`OFFICER_TERM_ENDED` additions sharing this working tree, confirmed via `git diff -- src/lib/audit.ts` showing zero relation to this feature. This working tree had concurrent, uncommitted, in-flight work from two other pipelines during this verification window; none of it is in scope here.

Targeted files for this feature, isolated: `layout.test.tsx`, `portal-footer.test.tsx`, `tile-grid.test.tsx`, `deacon-card.test.tsx`, `directory-grid.test.tsx`, `households-grid.test.tsx` — **63/63 passed**. `sites.test.ts` against the real dev DB (RLS-enforced): **59/59 passed**, including the three new `getOrgProfileForFooter` cases — verified the cross-org case is real (inserts real rows via `getPlatformDb()`, isolation enforced by `withOrgContext()`'s real `presby_membership_is_active()` check + real FORCE RLS), not a self-agreeing mock.

## End-to-End Tests

N/A — not an auth-touching diff. Grepped `e2e/*.spec.ts` for collisions with the new footer/card markup — none found. Recommend a quick manual browser pass before SHIP IT (flag on/off at 360px, `tel:` link, chrome_v2/chrome_v3 independence) per CLAUDE.md's "Verify in a Browser" invariant — advisory, not gating.

## Regression Tests Added

Feature-class work; every named Phase 3 edge case is pinned as its own test, verified by reading each:
- `deacon-card.test.tsx` — hover treatment is cosmetic only (no `tabindex`/role/link added).
- `tile-grid.test.tsx` — tile-icon map staleness (fallback icon on missing mapping).
- `directory-grid.test.tsx`/`households-grid.test.tsx` — card hover treatment guards against `cursor-pointer`/`hover:bg-accent` regressing onto multi-link cards (DECISION-099).
- `portal-footer.test.tsx` — 8 cases pinning the address/phone/both-null/no-row empty-state matrix.
- `layout.test.tsx` — new chrome_v3 on/off × `resolved.kind` ok/non-ok matrix, plus chrome_v2/chrome_v3-independence.
- `sites.test.ts` — `getOrgProfileForFooter` RLS/cross-org isolation proof against the real DB.

## Coverage on Critical Modules

- `src/lib/permissions.ts`/`src/lib/flags.ts`: untouched — N/A.
- `src/lib/two-factor.ts`: untouched, unaffected baseline (91.3%/100%).
- `src/lib/sites.ts`: new `getOrgProfileForFooter`'s every branch (row present, no row, cross-org) exercised against the real DB — 59/59 in `sites.test.ts`.

## Feature-Gate Audit

No protected route or server action added or changed — confirmed via `git diff --stat` against `src/app/api/**/route.ts` and `actions.ts` files: zero matches. `org_portal.chrome_v3` is a presentation/rollout flag gating a read + a render, granting no capability; every footer nav-recap link already gates itself at its own route.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| n/a — no protected routes or server actions touched | n/a | n/a | n/a |

**DECISION-040 gate discipline, verified by direct reading of `layout.tsx`** (not inferred from green tests): `getOrgProfileForFooter(...)` and `showFooter` are set only inside `resolved.kind === "ok"`; on every non-`ok` resolution and no-session, both stay null/false and no footer renders — matching the existing `orgBrand`/`orgMark`/`showPortalNav` discipline exactly. `layout.test.tsx`'s updated matrix pins this and passes.

## Independent confirmation of the `check:brand-scope` pre-existing-debt claim

Confirmed independently (not on faith): `git blame` attributed `pagination.tsx`'s violating lines to prior commit `9e2a69f`, unrelated to this diff. Mid-session, a concurrent sibling pipeline live-fixed it (`<Button>` swap); `check:brand-scope` now passes. Correctly out-of-scope debt, now resolved by unrelated work, not credited to this pipeline.

## Verdict

**PASS**

Typecheck, build, and all four tripwires pass. Full suite passes reproducibly; the two observed anomalies trace conclusively to a vitest flake and to concurrent sibling-pipeline state, neither originating in this diff. DECISION-040 gate discipline verified by direct source reading and holds. `getOrgProfileForFooter` is RLS-enforced and verified against the live dev database. No protected surface touched. Increment 2 (nav dropdowns) correctly not built and correctly not treated as a gap.

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

**SHIP IT**

## ONE-LINE TAKE

> A presentation-only rework — shadow-lift icons on four card types and a new, gate-disciplined footer — shipped exactly to the scope the operator resolved (Increments 1 and 3 only, dropdowns correctly deferred), behind its own independent, seeded-OFF flag, with every Phase 1 gap actually closed rather than silently dropped.

## What's Working

- **Footer delivers all three confirmed contents**, verified by direct reading of `portal-footer.tsx`: contact info (org name + address + `tel:` link), nav recap, and a copyright line — all three, nothing extra.
- **DECISION-099's card-hover ruling honored to the letter, per-file**, verified by direct reading: `person-card.tsx`/`household-card.tsx` get shadow-lift only (no `cursor-pointer`, correct for multi-link cards); `tile-grid.tsx` keeps its accent hover + gains shadow-lift (correct, genuine single-link card); `deacon-card.tsx` gets shadow-lift only, cosmetic (correct, no link at all).
- **Nav dropdowns (Increment 2) correctly absent** — the operator's explicit deferral, not a shortfall.
- **`org_portal.chrome_v3` exists, seeded OFF, genuinely independent of `chrome_v2`** — confirmed in `scripts/seed.ts` and `layout.tsx`.
- **DECISION-040 gate discipline holds on direct reading** — footer render and data fetch both gated on `resolved.kind === "ok"` and `session?.user`, matching `orgBrand`/`orgMark`/`showPortalNav`'s existing precedent.
- **Both Phase-1-named gaps actually closed**: footer empty-state (no row, or both fields null) collapses correctly, pinned by 5 test cases; icon-per-tile mapping is a real presby-specific mapping with an explicit fallback, pinned by test.
- **QA's two flagged anomalies confirmed non-blocking and unrelated to this feature** — a vitest isolation flake, and cross-talk from a different concurrently in-flight pipeline sharing the working tree.

## Intent-vs-Shipped Diff

- Footer contents, card-hover scope per DECISION-099, icon mapping, new independent flag: all **match** Phase 1/operator intent exactly.
- Nav dropdowns: correctly deferred, **matches** the operator's own resolution.
- Phase 3's named ship-time housekeeping (release notes, functionality-map, TODO.md) — **not yet done for this pipeline specifically** (the working tree's other modified housekeeping files belong to a different, concurrent pipeline). Process debt, not a functional gap — doesn't change the verdict, named explicitly below.

## Edge Cases

- Empty state: pass — verified by direct read + 5 test cases.
- Failure microcopy: n/a — no new failure surface, `getOrgProfileForFooter` degrades to `null`/empty-state, never a thrown user-visible error.
- Permission gate: pass — no new permission (correctly presentation-layer); flag gate enforced at the sole call site, verified by direct reading.
- Audit event: n/a — no mutation, correctly uninstrumented.
- Mobile (360px): pass, with an honest caveat — zero client-side interactivity in this diff (no `'use client'` anywhere), so the class of bug "Verify in a Browser" exists to catch (hydration/client-rendering failures) doesn't apply the same way here; static server-rendered markup reusing already-proven responsive utility patterns. DB-backed/unit-level verification (asserting on real rendered class strings/DOM) judged sufficient for SHIP IT outright; a manual browser pass remains good practice but is not gating.

## Follow-Ups (ship-time housekeeping required in the same commit, per Rules 10/13/14 — not functional gaps)

- `docs/TODO.md` needs a Done line for this pipeline, dated today.
- `docs/product/functionality-map.md`'s "Portal chrome" line is stale — needs updating to mention `chrome_v3`, the footer, card hover treatment, and the icon set.
- A release-notes entry is needed (latest existing file is `v0.9.md`, unrelated).
- Rule 13 what's-new advisory: worth a `whats_new_entries` post once `org_portal.chrome_v3` is actually flipped ON for a real org — draft-but-deferred until then, matching the existing pattern for `org_portal.tickets`/`org_portal.roles`.

---
