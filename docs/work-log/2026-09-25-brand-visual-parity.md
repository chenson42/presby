# Brand visual parity — Track B (B1–B4) — Work Log

> **Slug:** `2026-09-25-brand-visual-parity`
> **Surface:** mixed — the brand token contract (`src/lib/brand/contract.ts`, architect-led), the emitter (`src/components/brand/brand-tokens.tsx`), font resolution (`src/lib/brand/fonts.ts`), `globals.css`, the two brandable route groups `(org)` and `(public)/site/<slug>`; the platform-admin brand editor at `/admin/organizations` for configuring FPCW's brand. No church-domain schema.
> **Permission(s):** existing `branding.manage` / platform `admin.organizations` cover the surfaces; no new key expected (Phase 1 to confirm).
> **Flag(s):** Phase 1 to decide whether B1/B2 ship behind a flag or are pure token-contract changes visible everywhere a brand is configured.
> **Estimated complexity:** medium
> **Pipeline mode:** Full. Parallel-pipeline rules apply (CLAUDE.md Workflow Rule 16): this pipeline must not touch `src/lib/db/domain/`, `drizzle/`, `scripts/test-rls.sql`, `scripts/seed-dev.sql`; shared docs (`docs/TODO.md`, `docs/decisions.md`, `docs/STATE.md`) are edited only by the orchestrator at integration.
> **Source:** `docs/reviews/2026-09-23-fpcw-feature-match.md` §6 (Look and feel) and §7 Track B; `docs/TODO.md` Track B line. Operator decisions already taken: **visual parity yes, layout parity no**; the operator approved "flexibility" on the token contract; the un-branded `/signin` is a designed refusal (DECISION-047), to be recorded as a known trade (B4), not changed.
> **Scope:** B1 extend the brand role vocabulary to card/popover/border/muted + `--radius` (a `contract.ts` partition change — closed and machine-readable today; a test fails when an unlisted token appears); B2 make `--font-heading`/`--font-body` load-bearing and add a Geist-class pairing to `TYPE_PAIRINGS`; B3 configure FPCW's brand (`#60a7a1`, light-only via the existing `organization_brands.light_only`) and screenshot-diff `(org)` at 360px and desktop in both schemes; B4 record the DECISION-047 consequence. **Out:** layout changes, custom domains (Track F), any schema change.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-09-25 |
| 2 — Architectural review | architect | Complete | Approved with suggestions — narrowed Track B (B1 withdrawn; B2 wiring only; B3/B4 as written); operator confirmed the narrowing 2026-09-25 | 2026-09-25 |
| 3 — Technical design | tech-lead | Complete | Design complete — narrowed to B2 (wiring only) + B3 + B4; implementer named | 2026-09-25 |
| 4 — Implementation | ux-developer | Complete | B2 wiring shipped, verified in-browser; B3/B4 handed to operator as data-entry/no-op steps | 2026-09-25 |
| 5 — Verification | qa | Complete | PASS — before/after measured on a real server; 9/9 constraints; auth gate satisfied; two pre-existing `/welcome/i` reds owned elsewhere | 2026-09-25 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES — code shipped (v0.25.0); B3 (FPCW's brand + operator parity sign-off) outstanding | 2026-09-25 |

---

# Phase 1 — Functional Refinement (analyst)

*Recorded verbatim by the orchestrator, 2026-09-25.*

## VERDICT

**READY WITH NOTES**

## ONE-LINE TAKE

> The functional shape (widen the brand contract, wire the two font custom properties, configure FPCW's real brand, screenshot-diff, document the sign-in trade) is buildable, but the stated justification for the single largest piece of it — "fpcw brands card/popover/border/muted/radius and presby's contract can't express that" — is factually wrong on direct inspection of `~/git/fpcw-directory`, and B2 depends on a migration this pipeline is contractually forbidden from touching.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Platform admin (`/admin/organizations/[id]`) | Sets FPCW's brand seed hex, type pairing, logo, `light_only` at onboarding | one-time, then rare |
| Org admin with `branding.manage` (`/o/fpcw/admin/branding`) | Edits FPCW's own brand seed/type pairing/logo going forward | occasional, self-serve |
| FPCW member/visitor, anonymous or authenticated | Sees FPCW's colors, type, and (if `ui.branded_signin` is ever turned on for FPCW) a branded `/signin` when arriving from FPCW's own public site | every page view, passive |
| Every other congregation's admin/member | Sees **no change** — their own brand, or the platform default, unaffected by a contract widening | passive, but this is the invariant B1 must not break |
| Architect (Phase 2) | Rules on the `contract.ts` partition change, the `--radius` question, and whether new roles need new `LEGAL_PAIRS` floors | one-time, this pipeline |
| An implementer running `npm run visual:baseline` / `npm run visual:check` | Captures/compares screenshots | on demand, at B1/B2 completion |
| A human (unnamed in scope) | Judges "does this look like FPCW" from screenshots | one-time sign-off, not yet assigned to a role |

## Flows

**Flow 1 — Platform admin configures FPCW's brand:** entry `/admin/organizations/[id]` (existing editor, `FEATURES.ADMIN_ORGANIZATIONS`, `src/lib/permissions.ts:52-56`) → enters seed hex `#60a7a1`, picks a type pairing, sets `light_only` (already-shipped column, `src/lib/db/domain/org.ts:307`, `drizzle/0023_presby_brand_light_only.sql`) → `generateBrandTokens()` runs, adjustments (if any) are shown → save writes `organization_brands` and a history row.
- Failure: not described in the request. Write-side failure copy is inherited from the existing editor, but B3 doesn't say what an operator sees if the seed hex forces a generator "adjustment" message (D12's disclosure contract, `generate.ts:139-148`) — shown for FPCW's onboarding, or silently accepted? Worth a line in Phase 3.

**Flow 2 — Org admin self-serve edit:** entry `/o/fpcw/admin/branding` → `branding.manage` permission-gated (`src/lib/tenant-branding.ts:146-158`, a `presby_has_permission()` round-trip distinct from the platform action's `FEATURES.ADMIN_ORGANIZATIONS` check) → same generator, same write.
- Failure: `BrandingForbidden` / `BrandingFlagOff` / `BrandingLoadError` states already exist (`branding-states.tsx`) — already built, not new work.

**Flow 3 — A visitor sees the new tokens render:** entry any `(org)/o/fpcw/*` or `(public)/site/fpcw` page → `<BrandTokens>` emits `:root:root`/`:root:root.dark` (`brand-tokens.tsx:196-221`) → the widened set of re-declared tokens paint. No failure path: if the generator produces a role that fails a contrast floor for `#60a7a1`, there is no visible-to-the-visitor failure state — it just renders under-contrast text. That is exactly what the property test exists to prevent pre-ship.

**Flow 4 — Verification: does it look like FPCW:** entry `npm run visual:baseline` / `npm run visual:check` against a `next build && next start` server (`playwright.config.ts:8-83`, `e2e/visual-parity.spec.ts:1-40`) → capture `(org)` routes at 360×800 and 1280×900, light/dark → **this harness is self-comparing, `maxDiffPixels: 0`, across two runs on one machine — it proves "nothing else moved," not "this matches FPCW."** No existing tool diffs a presby screenshot against an fpcw-directory screenshot. See Gap 6.

## Permissions & Flags

- **Permission(s):** No new key needed. `FEATURES.ADMIN_ORGANIZATIONS` (platform, `src/lib/permissions.ts:52`) and `branding.manage` (tenant, `src/lib/tenant-branding.ts:146-158`) already cover both configuration surfaces.
- **Default roles:** unchanged.
- **Flag(s):** B1/B2 are contract/generator/emitter changes with no natural per-org toggle — a widened `TOKEN_POLICY` classification is either true for every org or not compilable. "No org has set a new role's value yet" is the natural staged rollout for the new roles' effect — but this is not a flag, and Phase 3 should say so explicitly. **`ui.branded_signin` already exists, seeded OFF** (`scripts/seed.ts:375-388`) — B4 must state, not assume, that FPCW's flag stays OFF (see Gap 5).

## Gaps the Request Didn't Address

**1. The stated fpcw-parity justification for B1 is contradicted by fpcw-directory's actual source.** `docs/reviews/2026-09-23-fpcw-feature-match.md` §6 claims fpcw's brand is "a hand-written ramp off the logo — `#60a7a1`... exactly what `generate.ts` produces," and that card/popover/border/muted/`--radius` are branded there and merely inexpressible in presby's contract. Reading `~/git/fpcw-directory/src/app/globals.css:46-134` directly: `--primary`, `--card`, `--card-foreground`, `--popover`, `--muted`, `--secondary`, `--border`, `--input`, `--ring` are the **unmodified stock shadcn oklch neutral defaults** (`--primary: oklch(0.205 0 0)` — near-black, not teal) in both `:root` and `.dark`. The `#60a7a1` teal exists **only** as a separate, hand-maintained Tailwind scale (`--color-brand-50`…`--color-brand-900`, lines 12-21) consumed ad hoc via `bg-brand-400`/`text-brand-600`-style utility classes across ~50 files — a decorative-accent axis with no relationship to the semantic token system at all. **fpcw does not brand its card, popover, muted, secondary, or border tokens.** The only real difference is `--radius` (fpcw `0.625rem` vs presby `0.5rem`, `globals.css:47`), a single platform-wide constant, not a per-org one. Matching fpcw's *actual rendered UI* would leave card/popover/muted/secondary/border **platform** exactly as `contract.ts` has them today, and would treat `--radius` as (at most) a one-time platform-value bump, not a new brandable role — directly reversing DECISION-048's stated reasoning for a claim that turns out not to be true of the parity target itself. **The architect needs this correction before ruling on the contract change** — "the operator approved flexibility" is a legitimate independent reason to widen the vocabulary, but "fpcw needs it" is not.

**2. Contrast floors for newly-brandable roles are not free — they require new `LEGAL_PAIRS` entries and property-test coverage, not just a `TOKEN_POLICY` edit.** `contract.test.ts:125-138` already carries a named, hand-written, single-scheme exception: `--card`/`--popover` have no `BrandRole` today, so `muted-foreground on card` (4.70 light / 5.78 dark against fixed platform values, both below the 7:1 AAA floor `ui-standards.md:642` requires) is asserted locally rather than swept by `generate.test.ts`'s 288-seed grid. If B1 makes `--card` seed-derived, every new role needs (a) a `BrandRole` entry, (b) a `ROLE_TO_TOKEN` mapping, (c) `LEGAL_PAIRS` entries with a stated floor, (d) generator derivation logic in `generate.ts`, and (e) that pair swept across the full seed grid in both schemes. Materially larger than "add four tokens to an array."

**3. "Geist-class pairing" needs a concrete choice, and Geist itself is very likely not `next/font/google`-resolvable.** `fonts.ts:1-53` is explicit that font resolution is closed to module-scope `next/font/google` calls. Geist ships via the `geist` npm package or `next/font/local`, not Google Fonts. B2's "-class" hedge implies a Google-Fonts-available lookalike (Inter, Manrope, Plus Jakarta Sans, DM Sans), but nothing names which one; `TYPE_PAIRINGS`' convention (`contract.ts:568-584`) requires each new pairing to be validated against the real UI at 360px in both schemes (A10) and to carry a mood-word `why` (`contract.ts:587,605-627`).

**4. `--font-heading`/`--font-body` are declared brandable but have zero emission path today — "load-bearing" needs a concrete consumer named.** `contract.ts:112-125` lists both as brandable, but `BRAND_ROLES` (`contract.ts:299-315`) has no font role, so `brand-tokens.tsx`'s `declarationBlock()` (`:95-102`) never emits either property — `docs/TODO.md:218` notes `fonts.ts`'s `RESOLVED_PAIRINGS` only exposes per-pairing variables (`--font-heading-classic`, `fonts.ts:155-180`). Phase 3 must decide: (a) whether `fonts.ts` exposes `.variable` for the generic property, (b) whether `@layer base` gains `h1`–`h6 { font-family: var(--font-heading) }` / `body { font-family: var(--font-body) }`, (c) whether the emitter gains a font role so `declarationBlock()` writes `--font-heading: var(--font-heading-<pairing>)` per org.

**5. B4's premise needs to account for `ui.branded_signin` already existing.** DECISION-094 and `src/app/(auth)/signin/page.tsx:14-58` ship a narrower, flagged exception: when `ui.branded_signin` is ON and the callback URL's org slug resolves to a live published public site, `/signin` renders that org's brand. Seeded OFF. The day `site-fpcw` goes live, flipping that flag brands FPCW's sign-in. B4 should say "the flag stays OFF for FPCW" as an operator decision. **CLAUDE.md's "Brand Is a Cascade Override" section is stale here too** — it doesn't mention DECISION-094's page-level exception; flag for the documentation review.

**6. The screenshot-diff tooling (B3) is not the instrument for fpcw parity, and no one is named to judge it.** `e2e/visual-parity.spec.ts` is self-comparing (`maxDiffPixels: 0` across two presby runs); it proves B1/B2 didn't regress anything else, not fpcw parity. Parity is a human side-by-side against the local fpcw-directory instance, a subjective call on colour/type/component feel. Phase 3 should name who signs off (presumably the operator) and record the automated project's role as regression-only.

**7. B2 needs a schema change this pipeline is forbidden from making.** `organization_brands.type_pairing` (`src/lib/db/domain/org.ts:290`) is gated by CHECK `organization_brands_type_pairing_allowed`; DECISION-093 records that the fourth pairing required `drizzle/0022` to widen it. A fifth pairing needs the same migration; the work-log's own metadata forbids this pipeline touching `drizzle/`. Either a narrow database-admin-owned schema work-log lands it alongside, or the orchestrator carves out a one-line Rule 16 exception. Not silently.

**8. `BRAND_TOKEN_VERSION` and its read/write asymmetry are directly implicated by B1.** `contract.ts:33-49` documents that D8's whole point is not actually enforced: `getOrgBrandForLayout()` calls `generateBrandTokens()` unconditionally and never reads the stored `brand_token_version` (also in `docs/TODO.md`). B1 is exactly the change D8 protects against and needs a version bump; with the enforcement gap, every existing congregation's new-role tint changes the instant this ships — an accepted consequence (nothing stored to change for the new roles specifically) or a reason to fix the asymmetry in this pipeline. Phase 3 says which.

**9. `--radius` moving from platform to brandable directly reverses DECISION-048.** `globals.css:173-186` anticipates fpcw's `0.625rem` as a **platform-wide** bump ("moves all four and repaints the app"), not a per-org escape hatch. DECISION-048's reasoning ("a congregation does not choose corner radius; it is extensibility creep") is not contradicted by anything in fpcw (single-tenant, one radius value by definition). Making it brandable is a CLAUDE.md-level invariant reversal needing its own explicit architect ruling, separate from card/popover/border/muted, given Gap 1.

## Out of Scope (confirm with user)

- Layout parity with fpcw — ruled out by the operator.
- Custom domains, Google integrations, finance — Tracks F/D/E.
- Per-org font upload / arbitrary Google Fonts family — ruled out (DECISION-093 branch (b)).
- Fixing the `BRAND_TOKEN_VERSION` read/write asymmetry (Gap 8) — confirm in or out.

## Open Questions

1. Given Gap 1: does the architect/operator still want card/popover/border/muted/secondary widened, now that "fpcw does it too" is confirmed false? Is "flexibility" alone sufficient, and if so, which of the five tokens actually gets a new role?
2. Does `--radius` get descoped from "brandable" entirely, with a platform-wide bump to `0.625rem` considered instead (or not at all)?
3. Who signs off on "this matches FPCW" (Gap 6) — the operator, viewing side-by-side screenshots against the local fpcw-directory instance?
4. Which Google Font stands in for "Geist-class" (Gap 3), with its own A10 validation pass?
5. Confirm: `ui.branded_signin` stays OFF for FPCW (Gap 5) — written as an explicit operator decision in B4?
6. Who owns the `organization_brands_type_pairing_allowed` migration (Gap 7) — a narrow database-admin work-log ahead of this one, or a carved-out Rule 16 exception?

---

# Phase 2 — Architectural Review (architect)

*Recorded verbatim by the orchestrator, 2026-09-25. DECISION-142–144 recorded in `docs/decisions.md`.*

## Verdict

**Approved with suggestions** — for a **narrowed Track B**: B1 withdrawn, B2 narrowed to the wiring (no fifth pairing), B3/B4 as written.

The feature *shape* is not wrong, so this is not a Phase 1 loop-back. What is wrong is the size of B1, and Phase 1 found why. I verified its decisive finding independently and it holds; two of its supporting claims do not, and both corrections cut in the same direction — toward a smaller Track B.

**Conditional:** if the operator, having been asked, restores any part of B1, it returns to **Phase 2**, not Phase 3, for a token-by-token re-ruling with the costs priced below.

### What I verified myself

`~/git/fpcw-directory/src/app/globals.css:61-128` — `--primary: oklch(0.205 0 0)` (near-black), `--card`/`--popover`/`--muted`/`--secondary`/`--border`/`--input` all stock shadcn achromatic, both schemes. Teal lives only in `@theme`'s `--color-brand-50…900` (`:12-22`), consumed as ad-hoc utilities — 51 files, `text-brand-600` ×44, `bg-brand-100` ×19, `bg-brand-500` ×16. `--radius: 0.625rem` at `:62`. **Phase 1 Gap 1 is correct.** fpcw does not brand a single one of the tokens B1 proposes to move.

Two corrections to Phase 1, both load-bearing:

1. **Gap 2's numbers are stale.** `contract.test.ts:139-160` asserts `>= 7` and **passes** today; the 4.70/5.78 figures are the test's own pre-DECISION-051 failure table. Gap 2's structural point survives and gets stronger: that assertion reads `PLATFORM_TOKENS` only, so the moment `--card` is seed-derived the D1-on-card guarantee is unverified across every seed and the local test silently becomes vacuous.
2. **Gap 3 is false. Geist is on Google Fonts and is `next/font/google`-resolvable today.** `fonts.googleapis.com/css2?family=Geist` → 200; Next's own `font-data.json` carries `Geist`; and the parity target imports it — `~/git/fpcw-directory/src/app/layout.tsx:2` is `import { Geist, Geist_Mono } from "next/font/google"`. The "-class stand-in" question dissolves and is replaced by a better one, answered below.

### Ruling 1 — B1, token by token. Withdrawn. None move.

| Token | Ruling | What it would actually cost, and why it fails |
|---|---|---|
| `--card` / `--card-foreground` | **Stays platform** | 2 `BrandRole`s, 2 `ROLE_TO_TOKEN` rows, **≥4 new `LEGAL_PAIRS`** (`on-card`/`card` 7:1; `on-muted-surface`/`card` 7:1; `input-border`/`card` 3:1; `brand`/`card` 3:1), a `deriveScheme()` step, all swept over 294 seeds × 2 schemes. Worse, it **breaks D4's structural closure**: `FOCUS_RING_OFFSET_PX` is honoured with `ring-offset-background` (`contract.ts:476-484`), so a focus ring inside a card is painted with `--background` against a `--card` surface — safe today only because the platform fixes both. Per-org they diverge, and the fix is a call-site decision the primitive cannot make. |
| `--popover` / `--popover-foreground` | **Stays platform** | Same pair costs, plus **adjacent-surface distinguishability**: `background`, `card`, `popover` are three near-white planes whose separation is a fixed, eyeballed fact; tint all three off one seed and elevation can collapse, and no `LEGAL_PAIRS` entry measures surface-against-surface because WCAG has no floor to borrow. `contract.ts:342-390` forbids adding a pair whose floor was never decided. |
| `--muted` / `--muted-foreground` | **Stays platform** — but the one a future request *could* carry | The apparatus exists: `muted-surface`/`on-muted-surface` are live roles, two `LEGAL_PAIRS` already sweep them at 7:1 (`contract.ts:394-407`). The change is a `TOKEN_POLICY` reclassification to `bounded` plus one `deriveScheme()` step; the emitter derives its lists from `TOKEN_POLICY` (`brand-tokens.tsx:71-93`) so `light_only` stays correct. Snags: `--accent`'s bound is `nearNeutralTintWithin(--muted)` (`contract.ts:141`), a moving target; and a tinted zebra stripe is the change a congregation is least likely to notice. |
| `--secondary` | **Stays platform** | Existing `why` (`contract.ts:181-189`) untouched by anything in fpcw. |
| `--border` | **Stays platform** | Deliberately not a legal pair (`contract.ts:357-365`); a per-org border would be the first generated value with nothing to verify it against. |
| `--input` | **Stays platform** | D3. A 3:1 control-identification floor that can be lowered per congregation is not a floor. |

**The deeper point:** B1 would move presby *away* from fpcw. presby already brands **more** than fpcw does — `SURFACE_L.light = 0.995` (`generate.ts:329`) tints every branded page where fpcw is pure white. What makes fpcw *look* teal — a nine-step decorative ramp across 51 files — is untouched by B1 and has no presby analogue beyond the single-step `--brand-raw`. If the operator's real want is "the portal reads teal the way fpcw does," the honest answer is a **decorative brand ramp** (`--brand-raw-50…900`, which `check-brand-scope.mjs:133-135`'s `BRAND_UTILITY_RE` already governs inside the two brandable groups). A separate pipeline with its own Phase 1 — named, not proposed.

**Ask the operator — yes.** Framing: *"You approved flexibility on the token contract on the strength of 'fpcw does this and our contract can't express it.' Direct inspection shows it brands none of those tokens; its teal is a separate decorative utility scale, and the one genuine difference is a platform-wide corner radius. Recommendation: none of the six move. If you want a visible concession, the nearly-free one is a bounded, seed-derived `--muted` — it reuses roles and contrast tests that already exist. Everything else costs new contrast floors, a generator change and a 294-seed re-sweep, and two of them (`--border`, adjacent surfaces) have no floor to verify against at all."*

### Ruling 2 — `--radius`

**(a) Per-org: stays platform. DECISION-048 reaffirmed.** fpcw is single-tenant and has exactly one radius by construction — evidence of nothing about per-org choice. Mechanically the worst fit: `nonColour`, not derivable from a seed, no generator, no test, plus an editor control nobody asked for.

**(b) A one-time platform-wide bump to 0.625rem: not in this track.** It repaints every route group (`rounded-md` ×97, `rounded-lg` ×23, `rounded-xl` ×6, `rounded-sm` ×5; `globals.css:173-186` says "Do NOT … bump --radius to 0.625rem; that moves all four and repaints the app"), and landing it inside Track B **destroys Track B's own regression signal** — `e2e/visual-parity.spec.ts` at `maxDiffPixels: 0` would drown the font diff in corner noise. If the operator wants it: a separate Polish-class work-log **after** Track B ships, with a deliberate baseline re-capture reviewed as a screenshot set, and `globals.css:165-187`'s comment rewritten in the same commit.

### Ruling 3 — B2, fonts

**No fifth type pairing. FPCW uses `contemporary`.** Geist is available, so the question becomes "should a `create-next-app` scaffold default earn a slot in a curated set?" No. fpcw-directory's Geist is what the generator put there; FPCW's *own* identity is Montserrat/Open Sans, read off their live compiled stylesheet, and DECISION-093 already added it as `contemporary` **for this congregation**. This deletes the migration and with it Phase 1's Gap 7 and Open Question 6. For the record the routing answer is **a narrow database-admin-owned schema work-log, not a Rule 16 carve-out**: hand-written `presby_*` migrations take a `_journal.json` entry, which is orchestrator-only under Rule 16, and a parallel pipeline holds `drizzle/0043`–`0047` open in this tree right now.

**The wiring mechanism (Gap 4, `docs/TODO.md:218`). Not a font role.** `ROLE_TO_TOKEN`'s codomain is `PlatformTokenName` on purpose (`contract.ts:319-340`); `nonColour` is excluded; a font role would force the type open, void the generator's totality check and the 294-seed grid for two roles, and hand the emitter data `generateBrandTokens(seedHex)` cannot produce. The mechanism that fits DECISION-046 and touches no tripwire:

1. **`fonts.ts` exposes `.variable`** — `RESOLVED_PAIRINGS` (`fonts.ts:155-180`) stores variable *name strings* but never `next/font`'s `.variable` class, which is why `--font-heading-classic` is defined nowhere today. Add `headingVariableClassName`/`bodyVariableClassName`, `satisfies Record<TypePairingKey, …>`.
2. **Four static rules in `globals.css`**, one per pairing: `.pairing-classic { --font-heading: var(--font-heading-classic); --font-body: var(--font-body-classic); }`. Static, not emitted.
3. **`@layer base` consumers with an `inherit` fallback:** `h1,…,h6 { font-family: var(--font-heading, inherit); }`, `body { font-family: var(--font-body, inherit); }`. The fallback resolves to the platform Inter set on `<body>` (`src/app/layout.tsx:19`), so **every un-branded surface renders byte-identically**.
4. **The two brandable layouts** (`(org)/o/[slug]/layout.tsx:174`, `(public)/site/[slug]/layout.tsx:59`) apply the pairing class plus the two `.variable` classes; `(auth)/signin/page.tsx:66,95` likewise (it already hand-applies `headingClassName`).
5. **`additive: true` stays true** on both entries; the closure test's parser reads only `:root`/`.dark` (`contract.test.ts:193-236`). No test churn, no partition change.

**Two Phase 3 warnings.** (i) Do **not** name the classes `*-brand*` — `BRAND_UTILITY_RE` (`check-brand-scope.mjs:133-135`) would fire at `/signin`, which is not a C1 brandable prefix. `pairing-<key>` is safe. (ii) This is a **real visible change to every already-branded org**: headings currently render in the body face because only `bodyClassName` is applied; `classic` goes from all-Source-Sans-3 to Lora-over-Source-Sans-3. Intended (`docs/TODO.md:218`); must be in the re-captured baseline; QA told to expect it.

### Ruling 4 — `BRAND_TOKEN_VERSION`

**No bump in this track** (no derivation change). **The read/write asymmetry stays out of scope** (`contract.ts:33-49`, `docs/TODO.md:145`) — its own pipeline. **But recorded as a precondition on any future widening:** while `read-org-brand.ts:137` regenerates unconditionally and ignores the stored version, any partition widening changes every branded org's live colours on the next page load with no migration and no audit row.

### Ruling 5 — B3 / B4

- Brandable route groups stay exactly two; `EMITTERS` (`check-brand-scope.mjs:101-105`) stays at three entries.
- **`ui.branded_signin` stays OFF for FPCW**, recorded as an operator decision.
- **The visual project is regression-only; fpcw parity is a human side-by-side sign-off by the operator.** Phase 3 names the operator as signer.
- **CLAUDE.md "Brand Is a Cascade Override" gains one line** after the platform-palette paragraph: *"One narrow exception, page-scoped and flagged: `/signin` renders a congregation's brand when `ui.branded_signin` is on **and** the sanitized `callbackUrl`'s slug resolves to a live published public site (DECISION-094). It is a single page in `(auth)`, not a third brandable route group — `/totp`, `/forgot-password` and `/reset-password` stay platform-chrome — and the flag is seeded off."*

## Placement

- **Directory placement:** unchanged, no new module. `src/lib/brand/fonts.ts`, `src/app/globals.css`, `src/app/(org)/o/[slug]/layout.tsx`, `src/app/(public)/site/[slug]/layout.tsx`, `src/app/(auth)/signin/page.tsx`. **`contract.ts` is not edited.** B3 is data entry through the existing editor.
- **Server vs Client:** no `'use client'`; `next/font/google` calls stay module-scope. A client component here would be a design error — escalate.
- **Dependencies: none.**

## Invariants Touched

- **The Brand Is a Cascade Override** — respected and strengthened; no second styling system, no new emitter.
- **The closed partition / closure test** — not moved; zero test churn is the evidence.
- **DECISION-048** — reaffirmed in both directions.
- **DECISION-047 / -094** — unchanged; `check:brand-scope` needs no edit.
- **D8 / `BRAND_TOKEN_VERSION`** — untouched; asymmetry recorded as a precondition.
- **Permissions vs flags** — correctly separated; no new key.
- **`ui-standards.md` AAA floor** — untouched, because no new generated colour pair is introduced.

## Notes

Phase 3 must honour: (1) no `contract.ts` edit — editing `TOKEN_POLICY`/`BRAND_ROLES`/`ROLE_TO_TOKEN`/`LEGAL_PAIRS`/`TYPE_PAIRINGS` exceeds this ruling, return to Phase 2; (2) no font role; (3) the `@layer base` fallback is `inherit`; (4) no `*-brand*` class names; (5) re-baseline before B2's diff and state that branded headings are *expected* to change face; (6) name the operator as parity signer and answer Phase 1's Flow 1 adjustment-disclosure question; (7) no flag for B1/B2 — say so; (8) no schema change, no `drizzle/`, no `_journal.json`; (9) **implementer: `ux-developer`**.

**Handoff:** to tech-lead (Phase 3), gated on the operator's answer to Ruling 1. If they restore any part of B1 it returns to Phase 2. Phase 1 Open Questions 1, 2, 4, 6 answered by this ruling; 3 and 5 by DECISION-144; the Flow 1 disclosure question passed to Phase 3.

---

# Phase 3 — Technical Design (tech-lead)

*2026-09-25. Narrowed per Phase 2 Ruling 1 (operator-confirmed): B1 withdrawn — no
`contract.ts` edit, no token move. B2 is the wiring only — no fifth pairing, no
schema change. B3/B4 as written. A platform-wide `--radius` bump to `0.625rem`
(Phase 2 Ruling 2(b)) is explicitly a separate, later Polish-class work-log,
after Track B ships — not designed here.*

## Summary

Two of `contract.ts`'s already-declared, already-`additive`, currently-inert
brandable tokens — `--font-heading` and `--font-body` — become load-bearing.
`fonts.ts` starts exposing `next/font`'s own `.variable` class per curated
pairing (today it exposes only the variable *names* as strings, which is why
neither property is defined anywhere in the rendered document); four static
`.pairing-<key>` rules in `globals.css` alias the generic property to the
pairing-specific one; two `@layer base` rules consume the generic property
with an `inherit` fallback so an un-branded surface is byte-identical to
today. The three files that already apply a type pairing's `bodyClassName`
(the two brandable layouts, `(org)/o/[slug]` and `(public)/site/[slug]`, plus
`(auth)/signin`) add the new classes alongside it. No `contract.ts` edit, no
new `BrandRole`, no emitter change, no fifth pairing, no schema change — the
mechanism is three plain CSS classes applied at the same DOM node the
existing `bodyClassName` already occupies. Separately (B3), FPCW's real brand
(`#60a7a1`, `contemporary`, `light_only = true`) is configured through the
already-shipped `/admin/organizations/[id]` editor — pure data entry, no code
— and a human (the operator) signs off visual parity against the local
`fpcw-directory` instance; the self-comparing `visual-parity` project can only
prove nothing *else* moved. B4 records, as an explicit operator decision
rather than an oversight, that `ui.branded_signin` stays OFF for FPCW.

## Permissions & Flags

- **Permission key(s):** none new. `FEATURES.ADMIN_ORGANIZATIONS`
  (`src/lib/permissions.ts:52`) and `branding.manage`
  (`src/lib/tenant-branding.ts:146-158`) already gate the only write surface
  touched (B3, and it isn't code — it's data entry through code that already
  exists).
- **Default role bindings:** unchanged.
- **Feature flag(s):** **not needed** for B2. `--font-heading`/`--font-body`
  becoming load-bearing is a contract/generator-adjacent wiring change with no
  natural per-org toggle (Phase 1 Gap, confirmed by the architect) — an org's
  effect is already staged by whether it has a brand row and which
  `type_pairing` it picked, which is not a flag. **`ui.branded_signin`
  (already exists, seeded OFF, `scripts/seed.ts:375-388`) is explicitly left
  OFF for FPCW as an operator decision (B4)** — this pipeline does not flip
  it, and no new flag is introduced.

## API Contract

No new routes or server actions. `setOrganizationBrandAction`
(`src/app/(admin)/admin/organizations/[id]/actions.ts:198`) is unchanged —
it already accepts `typePairing` from the full, four-entry `TYPE_PAIRINGS`
set (including `contemporary`, DECISION-093) and already writes
`recordAudit({ action: AUDIT_ACTIONS.ORG_BRAND_SET, ... })` on every save
(`actions.ts:341-342`). B3 is a call to this existing action with FPCW's real
values; no signature change.

## Data Model

No schema changes required. `organization_brands.type_pairing`'s CHECK
(`organization_brands_type_pairing_allowed`,
`drizzle/0022_presby_brand_pairing_expansion.sql:13`) already allows
`'contemporary'` — verified directly against the migration, not assumed.
Phase 1 Gap 7 / Open Question 6 (a fifth-pairing migration) do not apply:
Ruling 3 refused the fifth pairing on merit, so there is nothing to widen.

## Component / Page Plan

No pages or components created. Five files modified, exactly the set Phase 2
placed this change in — no new module.

### 1. `src/lib/brand/fonts.ts`

Add two fields to `ResolvedTypePairing`, populated from `next/font`'s own
`.variable` (today only the variable *name* string is stored; the `.variable`
class that actually *defines* that CSS custom property at runtime has never
been read off the loader result — this is precisely Phase 1 Gap 4 /
`docs/TODO.md:218`). Add a third field, `pairingClassName`, so callers never
need the raw `TypePairingKey` — every consumer of `ResolvedTypePairing`
(`read-org-brand.ts`, `sites.ts`) is unchanged, because everything the three
call sites need now travels inside the same object they already destructure.

```ts
export type ResolvedTypePairing = {
  /** Apply to the element (or an ancestor) that sets the heading face. */
  readonly headingClassName: string;
  /** Apply to the element (or an ancestor) that sets the body face. */
  readonly bodyClassName: string;
  /** The CSS custom property this pairing's heading face is bound to. */
  readonly headingVariable: string;
  /** The CSS custom property this pairing's body face is bound to. */
  readonly bodyVariable: string;
  /**
   * `next/font`'s own `.variable` class. Applying it to a DOM node DEFINES
   * `headingVariable` on that node (and its descendants) with the real,
   * self-hosted font-stack value — the piece that was missing (DECISION-143).
   * `headingVariable`/`bodyVariable` above are unchanged: they still just
   * name the property.
   */
  readonly headingVariableClassName: string;
  readonly bodyVariableClassName: string;
  /**
   * The static alias class in `globals.css` (`.pairing-<key>`) that maps the
   * generic `--font-heading`/`--font-body` properties onto this pairing's
   * specific ones. String, not a lookup, because the caller already has the
   * resolved pairing and would otherwise need the raw `TypePairingKey` for
   * this alone.
   */
  readonly pairingClassName: string;
};

const RESOLVED_PAIRINGS = {
  classic: {
    headingClassName: classicHeading.className,
    bodyClassName: classicBody.className,
    headingVariable: "--font-heading-classic",
    bodyVariable: "--font-body-classic",
    headingVariableClassName: classicHeading.variable,
    bodyVariableClassName: classicBody.variable,
    pairingClassName: "pairing-classic",
  },
  modern: {
    headingClassName: modernHeading.className,
    bodyClassName: modernBody.className,
    headingVariable: "--font-heading-modern",
    bodyVariable: "--font-body-modern",
    headingVariableClassName: modernHeading.variable,
    bodyVariableClassName: modernBody.variable,
    pairingClassName: "pairing-modern",
  },
  warm: {
    headingClassName: warmHeading.className,
    bodyClassName: warmBody.className,
    headingVariable: "--font-heading-warm",
    bodyVariable: "--font-body-warm",
    headingVariableClassName: warmHeading.variable,
    bodyVariableClassName: warmBody.variable,
    pairingClassName: "pairing-warm",
  },
  contemporary: {
    headingClassName: contemporaryHeading.className,
    bodyClassName: contemporaryBody.className,
    headingVariable: "--font-heading-contemporary",
    bodyVariable: "--font-body-contemporary",
    headingVariableClassName: contemporaryHeading.variable,
    bodyVariableClassName: contemporaryBody.variable,
    pairingClassName: "pairing-contemporary",
  },
} as const satisfies Record<TypePairingKey, ResolvedTypePairing>;
```

The `as const satisfies Record<TypePairingKey, ResolvedTypePairing>` is
unchanged as a mechanism — it is what already makes a `TYPE_PAIRINGS` entry
added without a matching `RESOLVED_PAIRINGS` entry a `tsc` failure
(`fonts.test.ts`'s own header comment), and it now also enforces the two new
fields are never forgotten on a future fifth entry (moot here, since Ruling 3
refuses one, but the type doesn't know that).

### 2. `src/app/globals.css`

Two additions, both outside the `:root`/`.dark` blocks `contract.test.ts`
parses (Ruling 3: "zero test churn, no partition change").

**(a) Four static alias rules**, placed after the `@theme inline` block and
before the existing `@layer base` block:

```css
/*
 * Per-org type pairing wiring (DECISION-143). `--font-heading`/`--font-body`
 * are declared `brandable`/`additive`/`nonColour` in
 * src/lib/brand/contract.ts's TOKEN_POLICY but carry no seed-derived value —
 * a per-org brand selects one of four CURATED pairings (TYPE_PAIRINGS), never
 * an arbitrary font. `next/font/google` calls are static, module-scope
 * (src/lib/brand/fonts.ts), so the real font-stack values cannot live here as
 * literals; each pairing's `.variable` class (applied by the caller alongside
 * the matching `.pairing-<key>` class below) is what DEFINES
 * `--font-heading-<key>`/`--font-body-<key>` with the actual, self-hosted
 * font-stack. This block is pure indirection — no font data, no colour.
 *
 * NOT emitted by <BrandTokens> (DECISION-143): a font role would force
 * ROLE_TO_TOKEN's codomain open past PlatformTokenName and hand the
 * seed-based generator two properties it has no way to derive a value for.
 * These four rules are static CSS, applied by a plain `className`, exactly
 * like every other non-generated utility in this file.
 */
.pairing-classic {
  --font-heading: var(--font-heading-classic);
  --font-body: var(--font-body-classic);
}

.pairing-modern {
  --font-heading: var(--font-heading-modern);
  --font-body: var(--font-body-modern);
}

.pairing-warm {
  --font-heading: var(--font-heading-warm);
  --font-body: var(--font-body-warm);
}

.pairing-contemporary {
  --font-heading: var(--font-heading-contemporary);
  --font-body: var(--font-body-contemporary);
}
```

Confirmed against `scripts/check-brand-scope.mjs`'s `BRAND_UTILITY_RE`
(`(bg|text|border|ring|from|via|to|fill|stroke|outline|decoration|shadow|accent|caret|divide|placeholder)-brand(-[a-z0-9]+)*`):
none of `pairing-classic`/`pairing-modern`/`pairing-warm`/`pairing-contemporary`
match — the prefix list doesn't contain `pairing`, and none contains the
literal substring `-brand`. Applying them inside `(auth)/signin/page.tsx`
(not a `BRANDABLE_PREFIXES` entry) is therefore not a C1 violation regardless.

**(b) Two `@layer base` consumers**, added inside the existing `@layer base {
}` block (not a new block):

```css
  /*
   * Consumers of the generic --font-heading/--font-body properties
   * (DECISION-143). `inherit` is the fallback, not a bare unset: on any
   * un-branded surface (no ancestor carries a `.pairing-<key>` class) the
   * property is undefined, so `var(--font-heading, inherit)` resolves to
   * `inherit` — the platform default already established by ordinary CSS
   * inheritance (Inter, set on <body> by src/app/layout.tsx:19). Every
   * un-branded surface renders byte-identically to today.
   *
   * ASYMMETRY, NAMED RATHER THAN HIDDEN: the `.pairing-<key>` class (and the
   * two `.variable` classes) are applied at the SAME element `bodyClassName`
   * already occupies today — `<main>` in the two brandable layouts and
   * `(auth)/signin`, never `<html>`/`<body>` (owned by the shared root
   * layout, unreachable from any of the three call sites). `--font-heading`
   * therefore reaches every h1-h6 that is a DESCENDANT of that `<main>` —
   * i.e., every heading on the page — and the rule below is what actually
   * changes rendering. `--font-body`'s rule, below, targets the literal HTML
   * `<body>` element, which never carries the variable, so it resolves to
   * `inherit` unconditionally and paints nothing new: body copy keeps
   * getting its font from the EXISTING, UNCHANGED `bodyClassName`
   * application, not from this rule. Both properties are wired to a real
   * consumer (satisfying the TOKEN_POLICY comment that they wait for a
   * consumer to exist) even though today only one of them moves a pixel —
   * see the work-log for the reasoning.
   */
  h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-heading, inherit);
  }

  body {
    font-family: var(--font-body, inherit);
  }
```

### 3. `src/app/(org)/o/[slug]/layout.tsx`

Line 171-176's `<main>` adds three classes alongside the existing
`bodyClassName`:

```tsx
<main
  className={cn(
    "mx-auto max-w-6xl px-6 py-12",
    orgBrand?.fontPairing.bodyClassName,
    orgBrand?.fontPairing.pairingClassName,
    orgBrand?.fontPairing.headingVariableClassName,
    orgBrand?.fontPairing.bodyVariableClassName,
  )}
>
```

Optional chaining short-circuits the whole expression to `undefined` when
`orgBrand` is `null` (no membership, flag off, or no brand row) — same
existing pattern as `bodyClassName` today, verified against the current file,
not a new null-safety concern.

### 4. `src/app/(public)/site/[slug]/layout.tsx`

Line 59's `<main>`, identical shape:

```tsx
<main
  className={cn(
    "min-h-screen",
    brand?.fontPairing.bodyClassName,
    brand?.fontPairing.pairingClassName,
    brand?.fontPairing.headingVariableClassName,
    brand?.fontPairing.bodyVariableClassName,
  )}
>
```

### 5. `src/app/(auth)/signin/page.tsx`

Line 62-68's `<main>` gains the same three classes alongside its existing
`bodyClassName`; line 92-98's `<h1>` is **unchanged** — it already hand-applies
`headingClassName` (Ruling 3's parenthetical), and that direct application
continues to work exactly as it does today, independently of the new
`--font-heading` cascade (the `<h1>` is also a descendant of `<main>`, so it
would now pick up `--font-heading` even without its own `headingClassName` —
the two mechanisms agree, not conflict, because both resolve to the same
pairing's heading face):

```tsx
<main
  className={cn(
    "mx-auto max-w-sm px-6 py-24",
    siteBrand?.brand?.fontPairing.bodyClassName,
    siteBrand?.brand?.fontPairing.pairingClassName,
    siteBrand?.brand?.fontPairing.headingVariableClassName,
    siteBrand?.brand?.fontPairing.bodyVariableClassName,
  )}
>
```

`read-org-brand.ts` and `sites.ts` are **not modified** — both already return
the full `ResolvedTypePairing` object via `resolveTypePairing()`, so the three
new fields arrive at every call site for free.

## B3 — Configuring FPCW's brand (operator, no code)

1. Operator signs in as a platform admin and opens
   `/admin/organizations/[id]` for FPCW's organization record.
2. In the brand section (`brand-form.tsx`), enters seed hex `#60a7a1`, selects
   type pairing **Contemporary** (Montserrat / Open Sans — already in the
   dropdown, DECISION-093; no code change needed to make it selectable), and
   checks **Light only**.
3. **The D12 adjustment disclosure is already wired and needs no new work**
   (this answers Phase 1 Flow 1's open question directly): `brand-form.tsx`
   runs `generateBrandTokens(seedHex)` client-side on every keystroke and
   renders any non-empty `adjustments[]` **unconditionally, before the Save
   button, never behind a disclosure** (`brand-form.tsx:228-237`). If
   `#60a7a1` produces one or more `BrandAdjustment` messages, the operator
   sees them in the amber banner before saving and the work-log's Phase 4/6
   notes should quote the message(s) verbatim (no PII — these are generic
   contrast-derivation sentences). If it produces none, nothing renders and
   there is nothing to record.
4. Saves. `setOrganizationBrandAction` persists `organization_brands` and
   fires `recordAudit({ action: AUDIT_ACTIONS.ORG_BRAND_SET })` — both
   existing behavior, unexercised by anything new in this pipeline.

**Visual-regression protocol** (the automated harness is regression-only,
DECISION-144 — it proves nothing else moved, never that this matches FPCW):

1. Land this design's Phase 4 diff (the five-file change above) first.
2. `npm run build && PORT=3100 npm run start &`
3. `E2E_BASE_URL=http://localhost:3100 npm run visual:baseline` — **re-baseline
   first**: this captures the harness's new self-comparison point on the
   *already-changed* code, which includes `/o/e2e-alpha` (the one seeded
   fixture with a brand row — `type_pairing: 'classic'`,
   `e2e/support/seed-orgs.ts:370-386`) now rendering Lora headings over
   Source Sans 3 body copy.
4. Immediately, with zero further changes, run
   `E2E_BASE_URL=http://localhost:3100 npm run visual:check` against that same
   server — **then diff**: this must report **zero** diff pixels on every
   route. It is not a before/after comparison (the harness never sees
   "before" again once re-baselined) — it is a determinism check, proving the
   capture itself isn't racing font loading (`document.fonts.ready` is
   already awaited in the spec) or any other non-deterministic paint.
5. **Separately, name the expected change so QA does not read it as a
   regression**: before step 3, capture one manual screenshot of
   `/o/e2e-alpha` at 1280×900 light on the pre-Phase-4 `main` branch (headings
   in Source Sans 3, since only `bodyClassName` was ever applied) and one
   after (headings in Lora). Attach both to this work-log's Phase 4 section.
   This is the only place the "before" state survives, because step 3's
   re-baseline overwrites it in the (gitignored) harness snapshots — QA's
   Phase 5 pass and the manual 360px review below both need it to confirm the
   *only* visible change on that route is the heading typeface, not colour,
   spacing, or layout.
6. Manual pass, both color schemes, 360px and desktop, on `/o/e2e-alpha` (the
   one pairing already wired in seed data) and — once B3 lands — FPCW's real
   `/o/fpcw`: headings legible at `text-2xl`/`text-xl`/`text-lg`, no
   introduced overflow or wrap from Lora's wider letterforms, focus rings
   still show a 2px offset, no horizontal scroll at 360px. This is a
   first-time check, not a re-confirmation — `fonts.ts`'s header comment
   records each pairing's A10 validation via `/admin/design-system`'s
   isolated preview, which applies `headingClassName` directly to its own
   preview element and has never exercised a *real* `<h1>`/`<h2>` inside a
   production page picking up `--font-heading` through this cascade, because
   until this change no production heading ever rendered in the heading face
   at all.
7. **Human parity sign-off, named explicitly (Ruling 5): the operator (Chris
   Henson) judges "does this look like FPCW"** by viewing FPCW's live `/o/fpcw`
   and (once its public site is provisioned) `/site/fpcw` side by side with
   the locally-run `fpcw-directory` dev server, and records the verdict in
   this work-log's Phase 6 section. The `visual` Playwright project's PASS is
   not evidence of parity and must not be cited as such — it only proves step
   4 above.

## B4 — `ui.branded_signin` stays OFF for FPCW

**No code, no new flag, no new decision entry** — DECISION-144 (recorded
2026-09-25, this same work-log) already states this as an explicit operator
decision, not an oversight: *"`ui.branded_signin` remains OFF for FPCW as an
operator decision... fpcw visual parity is signed off by a human side-by-side,
not by the screenshot harness."* Phase 6's shipped-vs-intent write-up should
quote that sentence rather than re-litigate it. Nothing in this design flips
`ui.branded_signin`; if the operator later wants FPCW's `/signin` branded
(once `/site/fpcw` is live), that is a separate, single-line flag flip through
`/admin/flags` — not part of Track B.

**CLAUDE.md one-liner (Ruling 5), for the orchestrator to apply at Phase 6 —
not applied by this pipeline, since this pipeline's write access is scoped to
the work-log only:**

> One narrow exception, page-scoped and flagged: `/signin` renders a
> congregation's brand when `ui.branded_signin` is on **and** the sanitized
> `callbackUrl`'s slug resolves to a live published public site
> (DECISION-094). It is a single page in `(auth)`, not a third brandable route
> group — `/totp`, `/forgot-password` and `/reset-password` stay
> platform-chrome — and the flag is seeded off.

To be inserted into "The Brand Is a Cascade Override" section, after the
paragraph naming the platform-palette route groups.

## Implementation Order

1. `src/lib/brand/fonts.ts` — add `headingVariableClassName`,
   `bodyVariableClassName`, `pairingClassName` to `ResolvedTypePairing` and
   `RESOLVED_PAIRINGS`; extend `fonts.test.ts`'s existing `it.each` loop with
   assertions on the three new fields (the existing `vi.mock("next/font/google")`
   fixture already returns `{ className, variable }` per loader call —
   `fonts.test.ts:15` — so no mock changes are needed).
2. `src/app/globals.css` — add the four `.pairing-<key>` alias rules and the
   two `@layer base` consumer rules.
3. `src/app/(org)/o/[slug]/layout.tsx` — apply the three new classes on
   `<main>`.
4. `src/app/(public)/site/[slug]/layout.tsx` — same.
5. `src/app/(auth)/signin/page.tsx` — same; leave the `<h1>`'s
   `headingClassName` untouched.
6. `npm run check` (typecheck, lint, and all five tripwires including
   `check:brand-scope`) green; `npm run test` green with zero edits to
   `contract.test.ts`.
7. Visual-regression protocol (above): re-baseline, determinism diff, manual
   before/after capture attached to Phase 4.
8. Manual 360px + desktop A10 pass, both schemes, on `/o/e2e-alpha`.
9. B3: operator configures FPCW's real brand through the existing editor
   (no code).
10. B4: confirm (don't touch) `ui.branded_signin` stays OFF for FPCW.
11. Human parity sign-off by the operator (Chris Henson), recorded in Phase 6.
12. Orchestrator applies the CLAUDE.md one-liner above at Phase 6; no new
    `docs/decisions.md` entry (DECISION-144 already covers B4).

## Edge Cases & Risks

- **Org with no brand row.** `orgBrand`/`brand`/`siteBrand?.brand` is `null`;
  every new class expression short-circuits to `undefined` via the existing
  optional-chaining pattern (verified against the current file, not a new
  concern) — the page renders exactly as it does today, Inter, no pairing
  class, no regression risk.
- **`light_only` orgs.** Unaffected — font wiring is orthogonal to
  `<BrandTokens lightOnly>`'s colour-only handling; `resolveTypePairing()`
  never branches on scheme.
- **`(auth)` must not become a brandable prefix.** Confirmed:
  `BRANDABLE_PREFIXES` (`check-brand-scope.mjs:108`) stays
  `["src/app/(org)/", "src/app/(public)/"]`, unedited. The new classes don't
  match `BRAND_UTILITY_RE` (checked above), so applying them inside
  `(auth)/signin/page.tsx` trips no C1 violation regardless of the prefix
  list. No new `<BrandTokens>` usage, so `EMITTERS`/E1/E2 are untouched.
- **SSR font-variable class on `<html>` vs `<body>` — the `body{}` rule is
  inert by construction, and that is disclosed, not hidden.** The pairing and
  `.variable` classes are applied at `<main>` (same node `bodyClassName`
  already occupies) in all three call sites — none of them can reach
  `<html>`/`<body>`, which the shared root layout owns exclusively. The
  literal `body { font-family: var(--font-body, inherit) }` rule therefore
  never sees the variable and always resolves to `inherit`, on both branded
  and un-branded pages. This is understood and accepted: actual body-copy
  typography keeps coming from the pre-existing, unchanged `bodyClassName`
  application; `--font-body` is wired to a real consumer (so the
  TOKEN_POLICY comment "not in globals.css until the font resolver emits it"
  becomes true) without changing today's body-copy rendering. Flagged
  explicitly here and in the CSS comment so QA and any future reader don't
  mistake it for a bug.
- **First-time A10 exposure for headings.** Every previous per-pairing
  validation (`fonts.ts`'s header comment, `docs/work-log/2026-08-24-custom-brand-fonts.md`)
  covered `/admin/design-system`'s isolated preview and `bodyClassName` in
  production; no production `<h1>`-`<h6>` has ever rendered in a pairing's
  heading face before this change. The manual 360px/desktop pass above is a
  first-time check against real headings, not a re-confirmation.
- **`(public)/site/[slug]` isn't in `VISUAL_ROUTES` today.** The automated
  harness's only branded coverage is `/o/e2e-alpha`; public-site font wiring
  gets the manual A10 pass only, no automated regression signal. Pre-existing
  gap in the harness, out of scope to fix here — worth a `docs/TODO.md` line
  at Phase 6 if the operator agrees, not a blocker to shipping Track B.
- **FPCW's real brand data never enters the repository.** It lives in
  `organization_brands` in the live database, configured through B3's editor
  — never in `scripts/seed-dev.sql` or any other committed fixture. The "No
  Real Data" invariant is untouched.
- **`brand_token_version` mismatch on `e2e-alpha`** (stored `1`, current
  `BRAND_TOKEN_VERSION` is `2`) predates this pipeline and is unaffected by
  B2 — `read-org-brand.ts` regenerates unconditionally from the stored seed
  regardless of the stored version (the read/write asymmetry, already tracked
  in `docs/TODO.md`, DECISION-142's standing precondition). Not a blocker.
- **Existing e2e blast radius.** `e2e/visual-parity.spec.ts` is the only
  existing spec whose *assertions* this change deliberately alters (one route,
  `o-e2e-alpha-*`, both viewports, both schemes — see the protocol above); no
  other existing Playwright or Vitest spec asserts on rendered font-family,
  heading markup, or `globals.css` content. `contract.test.ts`,
  `fonts.test.ts` (extended, not rewritten), `check-brand-scope.test.mjs` (if
  present) and every RLS/auth/domain spec are unaffected by construction — no
  server logic, no schema, no session/permission surface touched.

## Out of Scope (confirmed, carried from Phase 2)

- `--card`/`--popover`/`--muted`/`--secondary`/`--border`/`--input` widening —
  withdrawn (DECISION-142).
- `--radius` becoming per-org brandable — refused (DECISION-048 reaffirmed).
- A platform-wide `--radius` bump to `0.625rem` — a separate Polish-class
  work-log, **after** Track B ships, so it doesn't swamp this track's own
  `maxDiffPixels: 0` regression signal with unrelated corner-radius noise
  (Ruling 2(b)).
- A fifth type pairing — refused on merit (Ruling 3): Geist is
  `next/font/google`-resolvable, but it is `create-next-app`'s scaffold
  default, not FPCW's identity; FPCW's real site is Montserrat/Open Sans,
  already `contemporary` (DECISION-093).
- `BRAND_TOKEN_VERSION` bump / the read/write asymmetry fix — its own
  pipeline (Ruling 4); recorded as a standing precondition on any *future*
  partition widening, not touched here since B2 makes no derivation change.
- Flipping `ui.branded_signin` for FPCW — explicit operator decision to leave
  OFF (B4, DECISION-144).
- Layout parity with fpcw-directory, custom domains, and everything the
  original work-log scoped out.

## Implementer

**ux-developer.** Every change is a plain CSS class, a component-level
`className` addition, and a `fonts.ts` field addition consumed by `satisfies`
— no server action, no schema, no route handler. B3/B4 require no
implementation at all (data entry through an already-shipped editor, and a
flag left alone).

---

# Phase 4 — Implementation

*2026-09-25, ux-developer. Implements Phase 3's design exactly as specified —
B2 wiring only. No deviation from the five-file plan.*

## Files Created

None.

## Files Modified

- `src/lib/brand/fonts.ts` — `ResolvedTypePairing` gains
  `headingVariableClassName`, `bodyVariableClassName` (next/font's own
  `.variable` class, per pairing) and `pairingClassName` (the static
  `pairing-<key>` alias class). All four `RESOLVED_PAIRINGS` entries updated;
  `as const satisfies Record<TypePairingKey, ResolvedTypePairing>` unchanged
  as the exhaustiveness mechanism.
- `src/lib/brand/fonts.test.ts` — extended the existing `it.each` loop with
  assertions on the three new fields per pairing, plus a new `it.each` that
  checks every `pairingClassName` against `BRAND_UTILITY_RE` (copied from
  `scripts/check-brand-scope.mjs`, not imported — that script has no stable
  module export surface) to guard Phase 2 Ruling 3's warning (i).
- `src/app/globals.css` — two additions, both outside the `:root`/`.dark`
  blocks `contract.test.ts` parses (zero test churn, confirmed): (a) four
  static `.pairing-<key>` alias rules after `@theme inline`, before
  `@layer base`; (b) two consumer rules inside the existing `@layer base`
  block (`h1`–`h6` and `body`, both `var(..., inherit)`), placed right after
  the existing `html, body { background; color }` rule.
- `src/app/(org)/o/[slug]/layout.tsx` — `<main>` (line ~171) gains
  `orgBrand?.fontPairing.pairingClassName`,
  `orgBrand?.fontPairing.headingVariableClassName`,
  `orgBrand?.fontPairing.bodyVariableClassName` alongside the existing
  `bodyClassName`.
- `src/app/(public)/site/[slug]/layout.tsx` — same three classes added to
  `<main>` alongside `brand?.fontPairing.bodyClassName`.
- `src/app/(auth)/signin/page.tsx` — same three classes added to `<main>`
  alongside `siteBrand?.brand?.fontPairing.bodyClassName`. The `<h1>`'s
  existing direct `headingClassName` application is untouched, as designed.
- `docs/work-log/2026-09-25-brand-visual-parity.md` — this Phase 4 section,
  Per-Phase Status row.

No changes to `src/lib/brand/contract.ts`, no new `BrandRole`, no emitter
change, no fifth pairing, no `*-brand*` class name (verified both by the new
unit test and by `npm run check:brand-scope` passing unmodified) — exactly
Phase 2's nine constraints.

## Schema Changes

None. Confirmed no edits to `drizzle/`, `scripts/`, `src/lib/db/domain/`, or
any `_journal.json` (Rule 16 parallel-pipeline boundary respected — a sibling
pipeline holds `drizzle/0043`–`0047` open in this same tree throughout this
work).

## Audit Events

None. No server action, no mutation — this pipeline is a CSS/className wiring
change. B3 (FPCW's real brand configuration, not performed by this pipeline —
see below) already fires `recordAudit({ action: AUDIT_ACTIONS.ORG_BRAND_SET })`
on every save, unmodified, unexercised by anything new here.

## Verification Performed

- `npm run typecheck` — PASS, zero errors.
- `npx eslint` on all six touched source files — PASS, zero errors (one
  pre-existing "no ESLint config for CSS" warning on `globals.css`, expected
  and unrelated).
- `npm test` (Vitest, full suite) — PASS, 3235 passed / 760 skipped (up from
  3210/750 pre-change — the 25 new `fonts.test.ts` assertions), 0 failed.
  `contract.test.ts` untouched and green, confirming zero partition churn.
- `npm run check` (all five tripwires: audit-coverage, sql-date,
  deps-drift, **brand-scope**, secrets-pii) — PASS, all five green,
  brand-scope unmodified.
- `npm run build` — PASS, clean production build, no new warnings.

### Visual-regression protocol (Phase 3's protocol, run in full)

All four steps run against `next build && PORT=3100 npm run start`, never
`next dev` (the spec's own warning about stale CSS chunks under `next dev`).

1. **Re-baseline on the changed code:**
   `E2E_BASE_URL=http://localhost:3100 npm run visual:baseline` — 80/80
   passed, all snapshots freshly written (expected — first baseline this
   session).
2. **Determinism check, same server, zero further changes:**
   `E2E_BASE_URL=http://localhost:3100 npm run visual:check` — **80/80
   passed, zero diff pixels on every route, both viewports, both schemes.**
   Re-ran this pair a second time end-to-end against a from-scratch
   (`rm -rf .next`) rebuild of the final code, to rule out any leftover build
   artifact from the process-management issue below — same result, 80/80,
   zero diff pixels.
3. **Manual before/after capture — one correction to Phase 3's protocol,
   found and fixed during implementation (see Deviation below):** Phase 3
   named `/o/e2e-alpha` as "the one seeded fixture with a brand row." That
   is incorrect — `e2e/support/seed-orgs.ts`'s own `E2E_BRANDED_ORG` comment
   (line ~113) states explicitly that the branded fixture is
   **`e2e-presbytery`**, not `e2e-alpha`, and that `e2e-alpha` is the
   *permanently unbranded* fixture load-bearing for a different spec
   (`admin-organizations.spec.ts`'s "still on default palette" test). Verified
   directly: `curl`-ing `/o/e2e-alpha` with a valid session cookie shows
   `<main class="mx-auto max-w-6xl px-6 py-12">` — no pairing class, no
   `<style>` tag at all (no `<BrandTokens>` emission, `orgBrand` is `null`).
   `curl`-ing `/o/e2e-presbytery` shows `<main class="... pairing-classic
   lora_..._variable source_sans_3_..._variable">` — the wiring firing
   exactly as designed. Redid the manual capture against `/o/e2e-presbytery`
   (maroon `#7a1f2b` seed, `classic` pairing) instead. Both viewports
   captured at light scheme; screenshots and crops in the session scratchpad
   (paths below).
4. **Manual 360px/desktop pass, both routes, light scheme:** headings legible
   at every size, no overflow or wrap introduced by Lora's wider letterforms,
   maroon brand accent (card left-border, icon chips, buttons) unaffected —
   confirming the change is font-only, not a colour or layout regression.
   Dark scheme not separately screenshotted (the automated `visual:check`
   pass above already covers dark at zero-diff, which is sufficient for a
   font-only change with no scheme-conditional logic in `resolveTypePairing`
   or the two new CSS rules).

**Screenshots (session scratchpad, not committed — gitignored `e2e/.visual/`
is the source, copied out before being overwritten by the next capture):**

- `/o/e2e-presbytery`, 1280×900, light — before:
  `o-e2e-presbytery-1280x900-light-BEFORE.png`; after:
  `o-e2e-presbytery-1280x900-light-AFTER.png`
- `/o/e2e-presbytery`, 360×800, light — before:
  `o-e2e-presbytery-360x800-light-BEFORE.png`; after:
  `o-e2e-presbytery-360x800-light-AFTER.png`
- Cropped heading close-up (3x zoom on "Good morning, Tobias."):
  `crop-presbytery-before.png` / `crop-presbytery-after.png` — before is
  Source Sans 3 Bold (sans-serif, matches body face); after is unmistakably
  Lora (serif — visible serifs on G, T, b, g; different letterform on the
  comma and period). This is the exact DECISION-143 change Phase 2's Ruling 3
  warning (ii) predicted: "`classic` goes from all-Source-Sans-3 to
  Lora-over-Source-Sans-3."
- `/o/e2e-alpha` before/after pair also captured
  (`o-e2e-alpha-*-BEFORE.png` / `-AFTER.png`) for the record, showing (as
  expected once the branded-fixture correction above is understood) **no
  visible change** — `e2e-alpha` has no brand row, so `orgBrand` is `null` on
  both sides of the diff and every new class expression short-circuits to
  `undefined`. Confirms the "org with no brand row" edge case from Phase 3.

All scratchpad paths are under this session's
`/private/tmp/claude-501/.../scratchpad/visual-parity/` directory and are not
part of the repository; QA/analyst should ask for a fresh capture rather than
relying on these session-local files surviving past this conversation.

## Deviation from Design

**One correction to Phase 3, found during implementation, no design change
needed.** Phase 3's visual-regression protocol (step 3) named `/o/e2e-alpha`
as the branded fixture to capture before/after. Direct inspection of
`e2e/support/seed-orgs.ts` shows the branded fixture is `e2e-presbytery`
(`E2E_BRANDED_ORG = E2E_ORGS.presbytery`, seed `#7a1f2b`, `classic` pairing) —
`e2e-alpha` is deliberately kept unbranded for a different spec's own fixture
needs, per that file's own header comment. This does not change any code or
any of Phase 2/3's rulings — it only changes which existing seeded route
demonstrates the change. Recommend a documentation-review note (or a Phase 3
addendum) so the next pipeline that needs "the one branded e2e fixture"
doesn't repeat the mis-citation; not fixing the design doc's prose here since
Phase 3 is tech-lead's authored section.

**Process-management finding, not a design or code defect:** while capturing
the before/after screenshots, a `PORT=3100 npm run start` background process
from an earlier step was not reliably killed by `pkill -f "next start"` —
`next start` execs into a child process named `next-server` in `ps`, which
the pattern doesn't match, so the old server kept running and silently served
a stale (or, after an intervening `rm -rf .next`, broken — 500 on the CSS
chunk) build for several subsequent capture attempts. Caught by noticing the
"before" screenshot rendered as completely unstyled raw HTML, which is not a
plausible pre-change state (the pre-change page has real Tailwind CSS, just
without the font wiring). Fixed by tracking each server's PID explicitly
(`echo $! > /tmp/....pid`) and `kill -9`-ing by PID rather than by pattern
match, plus a clean `rm -rf .next` before every build/capture pair. Left no
stray `next-server`/`next start` processes running on port 3100 at the end of
this session (verified via `lsof -i :3100`). Not a code change, but worth
flagging as an implementer-tooling lesson — a future agent capturing
before/after screenshots via `git stash` + rebuild should track server PIDs
explicitly rather than trusting a `pkill` pattern against `next start`.

## B3 — FPCW's real brand (operator, no code — not performed by this
pipeline)

Per Phase 3's design and Phase 2 Ruling 5, this is pure data entry through
the already-shipped editor. **Not performed here** — production is not this
pipeline's to touch, and the design explicitly scopes B3 as an operator
action. Exact steps for the operator:

1. Sign in as a platform admin; open `/admin/organizations/[id]` for FPCW's
   organization record.
2. In the brand section (`brand-form.tsx`): enter seed hex `#60a7a1`, select
   type pairing **Contemporary** (Montserrat / Open Sans — already selectable,
   DECISION-093, no code change needed), check **Light only**.
3. Watch for the amber adjustment-disclosure banner
   (`brand-form.tsx:228-237`, runs `generateBrandTokens()` client-side on
   every keystroke). If `#60a7a1` produces any `BrandAdjustment` message(s),
   they render before Save, unconditionally — quote them verbatim (no PII,
   generic contrast-derivation sentences) into this work-log's Phase 6 notes.
   If none render, there is nothing to record.
4. Save. `setOrganizationBrandAction` persists `organization_brands` and
   fires `recordAudit({ action: AUDIT_ACTIONS.ORG_BRAND_SET })` — both
   pre-existing, unexercised by anything new in this pipeline.
5. Once saved: view FPCW's live `/o/fpcw` and (once its public site is
   provisioned) `/site/fpcw` at 360px and desktop, both colour schemes, and
   compare against the locally-run `fpcw-directory` dev server side by side.
   This human judgment call — "does this look like FPCW" — is the operator's
   alone (Ruling 5); the automated `visual` Playwright project cannot make it
   and its PASS above must not be cited as evidence of parity, only of "this
   pipeline's change didn't move anything it didn't intend to."
6. Record the verdict in this work-log's Phase 6 section.

## B4 — `ui.branded_signin` stays OFF for FPCW (no code, confirmed not
touched)

Confirmed by inspection: this pipeline made no call to
`isFlagEnabled`/flag-admin code paths and no edit to `scripts/seed.ts` or any
flag-seeding file. `ui.branded_signin` remains at its existing seeded-OFF
state for every org, including FPCW, per DECISION-144 (already recorded,
2026-09-25, this work-log). Nothing further required of this pipeline.

---

# Phase 5 — Verification (qa)

*Recorded verbatim by the orchestrator, 2026-09-25.*

**Date:** 2026-09-25 · **Verified by:** qa

## Type Check

`npm run typecheck`: **PASS**, zero errors.

## Unit Tests

Total 3995 | Passed **3235** | Failed 0 | Skipped 760 | 12.1s (275 files: 246 passed, 29 skipped). Matches Phase 4 exactly. Brand subset in isolation (`fonts.test.ts` + `contract.test.ts`) = **68 passed**; `contract.test.ts` byte-unmodified (`git diff HEAD` empty) and green — Phase 2's "zero test churn is the evidence" holds. The 760 skips are the pre-existing `describe.skipIf(!hasDb)` suites; none cover the six changed files.

## End-to-End Tests

### `visual` project — 20 routes × 2 viewports × 2 schemes = 80 cells

Run against `next build` + `next start` on a scratch port in an **isolated tree copy** (see Finding 1).

**(a) Determinism (`visual:baseline` → `visual:check`, no changes):** 76 zero-diff / 4 failed — all four `/admin/audit`: row count and new `staff_position.*`/`totp.verify_succeeded` rows written to the shared database by concurrent pipelines between captures. Content, not styling.

**(b) Before-vs-after (`globals.css` restored to HEAD inside the isolated copy, full rebuild):** 68 byte-identical / 12 differ — **4 × `/o/e2e-presbytery`, the intended change:** diff images show red only on heading glyphs (h1, the six section h2s, every card h3); body copy, nav, footer, icons, borders, spacing, brand maroon: zero diff; no reflow, no wrap change, no overflow — exactly Phase 2 Ruling 3 warning (ii). 4 × `/admin/audit` as above. 4 × `/account/2fa` — diff confined to the fresh-per-render TOTP QR bitmap; pre-existing harness non-determinism.

**Computed `font-family` via `page.evaluate(getComputedStyle(...))`, BEFORE vs AFTER:**

| Surface | `<main>` classes (AFTER) | `--font-heading` | h1/h2 BEFORE | AFTER |
|---|---|---|---|---|
| `/o/e2e-presbytery` (branded, `classic`) | `… source_sans_3_…__className pairing-classic lora_…__variable source_sans_3_…__variable` | `"Lora","Lora Fallback"` | Source Sans 3 | **Lora** |
| `/o/e2e-alpha` (unbranded) | `mx-auto max-w-6xl px-6 py-12` | unset | Inter | Inter |
| `/home` | `mx-auto max-w-2xl px-6 py-12` | unset | Inter | Inter |
| `/admin` | `p-8` | unset | Inter | Inter |
| `/signin?callbackUrl=%2Fo%2Fe2e-presbytery` (`ui.branded_signin` OFF) | `mx-auto max-w-sm px-6 py-24` | unset | Inter | Inter |

`<body>` stays `Inter` on every surface including the branded org — Phase 3's "the `body{}` rule is inert by construction" is confirmed empirically.

### `chromium` project — auth-touching gate (`src/app/(auth)/signin/page.tsx` is in the diff)

Real dev server, isolated tree, seeded MFA-enrolled fixture. `e2e/branded-signin.spec.ts:206` — **PASSED** ("branded chrome renders for a live, brand-configured org's callback, and a real sign-in completes through it") — direct coverage of the one `(auth)` file this diff changes. `e2e/totp-full-login.spec.ts:23` — FAILED at `:61` only: the full path ran green (password → `/totp` → wrong code rejected → real code accepted → `/admin` rendered in platform Inter and blue); the single failing assertion is the `/welcome/i` heading. `e2e/branded-signin.spec.ts:323` — same assertion, same cause; the serial block then aborted cases 3 and 4 (case 4's property verified directly by the computed-style probe). Both are bug 1 of `docs/work-log/2026-09-25-e2e-red-on-main.md`, with its counterfactual proof; that pipeline landed its fix to `branded-signin.spec.ts:318-327` mid-verification. `afterAll` restoration ran clean.

## Regression Tests Added

`src/lib/brand/fonts.test.ts:62-70` — every `TYPE_PAIRINGS` entry carries non-empty variable class names and `pairingClassName === "pairing-<key>"`. `:74-89` — no `pairingClassName` matches `BRAND_UTILITY_RE`; the copied literal compared character-by-character against `scripts/check-brand-scope.mjs:133-135` — identical. Feature pipeline, so failing-first does not apply.

## Coverage on Critical Modules

`two-factor.ts` 91.3% / 100% branch (target met). `permissions.ts` and `flags.ts` emit no v8 row (reporter configuration — `vitest.config.ts` sets no `include`/`all`), both 7/7 tests pass; a reporter gap for the test-coverage review, not a coverage gap.

## Other Verification

| Check | Result |
|---|---|
| `npm run check` | **PASS** all five incl. brand-scope; `check-brand-scope.mjs` unmodified |
| eslint on the 5 TS files | PASS |
| `npm run build` | PASS |
| `contract.ts` | `git diff HEAD` empty — constraint (1) |
| `BRAND_ROLES`/`ROLE_TO_TOKEN` | unchanged, 15 roles, no font role — (2) |
| `@layer base` fallbacks | `var(--font-heading, inherit)` `globals.css:276`, `var(--font-body, inherit)` `:280` — (3) |
| class names vs `BRAND_UTILITY_RE` | no match — (4) |
| `.pairing-*` placement | `globals.css:212-230`, outside `:root` (46-94) and `.dark` (96-134) — (5) |
| `'use client'` | none — (6) · new flag: none — (7) · schema files untouched — (8) |
| `EMITTERS`/`BRANDABLE_PREFIXES` | still 3 and 2, unedited |

**A10 (360px + desktop, both schemes, branded org):** headings render Lora and stay legible; brand accent, card chrome, icon chips unchanged; long card titles wrap exactly as before; no horizontal scroll at 360; no layout shift. Dark at 360 verified from the captured snapshot.

**B3 / B4 correctly not performed.** `drizzle/0022:13` allows `'contemporary'` and `contract.ts:622-623` labels it "Contemporary", so the operator steps are executable — with two label corrections in Finding 5.

## Feature-Gate Audit

No route or action added or changed; the diff adds three `className` expressions at `signin/page.tsx:67-69` and touches nothing else there. **No protected routes touched.** Schema/RLS: n/a.

## Findings

1. **Environmental:** the first two visual runs against a production build in the *repo* tree hard-failed `/no-organization` with HTTP 500 (`client reference manifest … does not exist`) — a sibling agent's `next dev` shares `.next` and rewrites route artifacts under a running `next start`. Vanished (80/80) in an isolated copy. **Rule for parallel trees: build and serve from a copy outside the repo.**
2. The stale-`next-server` trap in Phase 4's notes is real — kill by port (`lsof -t -iTCP:<port>`), never `pkill -f "next start"`.
3. Harness non-determinism (pre-existing): `/account/2fa` regenerates its QR per render; `/admin/audit` drifts whenever any agent writes an audit row — both false positives at `maxDiffPixels: 0`, same class as `routes.ts` rule 6. TODO line.
4. **Named coverage gap, accepted:** `(public)/site/[slug]` font wiring has no live-render evidence (no persistently seeded published site; route absent from `VISUAL_ROUTES`; `public-sites.spec.ts` deliberately not run because it flips `sites.public_render` and `auth.require_2fa` globally mid-run). Structurally identical to the verified `(org)` path.
5. Documentation nits: Phase 4's B3 steps say "enter seed hex" / "check Light only" — the editor labels are **"Brand colour"** / **"Light mode only"** (`brand-form.tsx:152`, `:195`). `e2e/support/seed-orgs.ts:369` carries a stale comment naming `e2e-alpha` as the branded fixture, contradicting `E2E_BRANDED_ORG = E2E_ORGS.presbytery` twelve lines above — the likely source of Phase 3's mis-citation.

## Verdict

**PASS.** All nine Phase 2 constraints verified against the files; the central claim confirmed by direct before/after measurement on a real server. On the auth gate, explicitly: the suite ran on a real server with the MFA-enrolled fixture, the full path completed, and `branded-signin.spec.ts:206` (a real sign-in through the exact surface this diff changes) passed; the two red specs fail on the stale `/welcome/i` assertion against `/admin`, outside every brandable group, owned by `2026-09-25-e2e-red-on-main` with its counterfactual. If the orchestrator prefers the strict reading, this converts to BLOCKED on that pipeline landing — named rather than hidden.

## Per-Phase Status row

| Phase | Owner | Status | Verdict | Date |
|---|---|---|---|---|
| 5 — Verification | qa | Complete | PASS — B2 wiring verified before/after on a real server; 9/9 Phase 2 constraints held; no protected routes touched; auth gate satisfied (full MFA login exercised; two pre-existing `/welcome/i` failures owned by `2026-09-25-e2e-red-on-main`) | 2026-09-25 |

**Handoff → analyst (Phase 6).** Carry forward: DECISION-144's sentence on `ui.branded_signin` is quoted, not re-litigated; **the parity sign-off is the operator's and cannot happen until B3 is performed** (nobody has configured FPCW's real brand yet); four TODO follow-ups (Finding 3, Finding 4, Finding 5's two nits + the stale comment, the v8 reporter gap); Rule 13 — this is member-visible on branded org portals (headings change typeface), so a what's-new entry is worth considering.

---

# Phase 6 — Shipped vs Intent (analyst)

*Recorded verbatim by the orchestrator, 2026-09-25. Housekeeping disposition at the end.*

## VERDICT

**SHIP WITH NOTES**

## ONE-LINE TAKE

> The narrowed Track B does exactly and only what Phase 2/3 promised — two previously-declared, inert brand tokens are now load-bearing on the two brandable layouts and `/signin`, with zero partition churn and zero regression on 68/80 pixel-identical cells — but the track's actual named goal, "does FPCW's portal look like FPCW," is unverifiable today because B3 (configuring FPCW's real brand and the human side-by-side sign-off) has not been performed by anyone.

## What's Working

- The wiring is exactly Ruling 3's design: `fonts.ts` exposes `next/font`'s own `.variable` class alongside a new `pairingClassName`, all `satisfies`-checked against `TypePairingKey` (`fonts.ts:137-163, 172-209`).
- `globals.css:212-230` places the four `.pairing-<key>` rules outside `:root`/`.dark` (`contract.test.ts` byte-identical); `:275-281` wires `h1`–`h6`/`body` with an `inherit` fallback; the comment at `:250-274` names the `body{}` rule's inertness. Disclosure done right.
- All three call sites apply the identical three-class pattern via the pre-existing optional-chaining idiom — matches Phase 3 line-for-line.
- QA's computed-`font-family` table: `/o/e2e-presbytery` flips to Lora; `/o/e2e-alpha`, `/home`, `/admin`, `/signin` stay Inter — un-branded byte-identity measured, not asserted.
- `fonts.test.ts:74-89` guards Ruling 3's warning (i) against `BRAND_UTILITY_RE`, which matters because the classes are applied inside `(auth)/signin`.
- The Phase 4 fixture correction (`e2e-alpha` → `e2e-presbytery`) was caught by the implementer and verified by `curl` — a real save.
- All five tripwires green unmodified; build clean; nine of nine Phase 2 constraints verified against the files.

## Intent-vs-Shipped Diff

- B1's justification factually wrong → **B1 fully withdrawn** (DECISION-142, `contract.ts` diff empty): **matches**, because Phase 2 re-verified the fpcw source independently.
- A fifth "Geist-class" pairing assumed necessary → refused on merit (Geist is the scaffold default; FPCW already has `contemporary`, DECISION-093): **matches**, a better answer than asked for.
- `--font-heading`/`--font-body` inert (Gap 4) → wired via static classes and an `@layer base` consumer, no font role, no `contract.ts` edit: **matches** — the one substantive delivery, closing `docs/TODO.md`'s standing gap (moves to Done).
- Gap 7's migration → never needed (`contemporary` already CHECK-allowed): **matches**, dissolved rather than worked around.
- Ruling 3 warning (ii), a visible change to every already-branded org's headings → confirmed empirically, red confined to heading glyphs: **matches, intended, disclosed** — member-visible, so Rule 13 applies.
- Ruling 5 / B4's CLAUDE.md line → landed in `df0e779` (`CLAUDE.md:570-573`): **matches**.
- **The track's actual point — "does FPCW's portal look like FPCW."** B3 (configure `#60a7a1`, `contemporary`, light-only) was **not performed** — correctly scoped as operator data entry outside the implementation boundary. **Acceptable drift, not a regression, but the track's acceptance criterion is still open.** The code that would deliver parity is shipped and verified; parity itself is not yet a fact anyone has observed. That earns a note, not a clean pass.

## Edge Cases

- Empty state (no brand row): pass — `/o/e2e-alpha` carries no pairing class, no `<style>`; every new class expression short-circuits to `undefined`.
- `light_only` orgs: pass by construction (font wiring is orthogonal to `<BrandTokens lightOnly>`'s colour branching; `resolveTypePairing()` never reads scheme). Verified by inspection, not live — named honestly.
- Mobile 360px: pass — QA's A10 pass at 360×800 and 1280×900 light; dark at 360 from the captured snapshot.
- Failure microcopy: n/a (no mutation, no new failure path; the D12 banner is pre-existing and unexercised until B3 runs).
- Permission gate: n/a (no new permission or route). Audit event: n/a to what shipped; `ORG_BRAND_SET` fires when B3 is performed.
- `(auth)` scope leakage: pass — `BRANDABLE_PREFIXES` unedited; `pairingClassName` values don't match `BRAND_UTILITY_RE`; `check:brand-scope` green.

## Follow-Ups

1. **B3 outstanding — FPCW's real brand is not configured and no human parity sign-off has occurred.** Operator's next action: `/admin/organizations/[id]` → **Brand colour** `#60a7a1`, type pairing **Contemporary**, **Light mode only** checked; watch for the amber adjustment banner and quote it into this work-log if it appears; save; compare `/o/fpcw` (and `/site/fpcw` once published) against the local fpcw-directory dev server at 360px and desktop, both schemes; record the verdict as an addendum to this Phase 6. `docs/TODO.md`'s Track B line should be rewritten: B1 withdrawn (DECISION-142), B2 shipped (this work-log), B3 open, B4 recorded (DECISION-144).
2. `docs/TODO.md`'s "`--font-heading`/`--font-body` declared brandable but nothing consumes them" line → Done, 2026-09-25.
3. `docs/product/functionality-map.md`'s brand line ("heading-face differentiation not yet wired") is stale → update at ship (Rule 14).
4. QA Finding 4 — `(public)/site/[slug]` has no automated visual-regression coverage (absent from `VISUAL_ROUTES`; no persistently seeded published site — the harder half). TODO line.
5. QA Finding 5 — Phase 4's B3 steps use "seed hex"/"Light only" where the editor says "Brand colour"/"Light mode only"; `e2e/support/seed-orgs.ts:369`'s stale comment names `e2e-alpha` as the branded fixture — fix so the next pipeline doesn't repeat Phase 3's mis-citation.
6. QA's v8 coverage-reporter gap (`permissions.ts`/`flags.ts` emit no row) — a line for the next `test-coverage` review.
7. DECISION-142 still reads "pending the operator's confirmation" — the operator confirmed the same day; one-line correction.
8. Platform-wide `--radius` bump — already tracked as its own Polish work-log. No new action.
9. **Rule 13 — what's-new: recommend yes.** Draft: *"Heading fonts now match your color style. If your congregation has a color theme set up, page titles and section headings now render in that theme's paired heading typeface (for example, Lora headings over Source Sans 3 body text for the 'Classic' style) — previously only body text used the chosen font. No action needed. Want a different look? An admin can change the type pairing from Branding settings."*
10. **Release notes — a `feat:` entry:** *Per-congregation heading typefaces are now visible.* Background: each congregation's chosen style already paired a heading typeface with a body typeface, but only the body face was wired into the page. Changes: headings on a congregation's portal, public site and (when branded) sign-in page now render in the chosen heading typeface; unbranded pages unaffected; no new setting.

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|---|---|---|---|---|
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES — B2 matches intent exactly, verified live, zero partition churn; B4 landed (`df0e779`); B3 (FPCW's real brand + human parity sign-off) remains outstanding and is the track's actual acceptance criterion | 2026-09-25 |

**Handoff:** no further pipeline phase — Track B's code is closed. B3 is the operator's action; the parity sign-off is recorded as an addendum here, not a new work-log.

### Orchestrator housekeeping disposition (2026-09-25)

Shipped as **v0.25.0** (`feat`, MINOR per the pre-push convention). Applied in the ship commit: TODO Track B line rewritten and the font-tokens line moved to Done; TODO lines for the public-site visual gap, the seed-orgs comment and editor-label nits, the v8 reporter gap, and the owed what's-new post (production sign-in is gated off, so the `whats_new_entries` row is posted when the operator can sign in — tracked under "Owed what's-new posts"); functionality-map brand line updated. DECISION-142's "pending" wording is corrected with the round-two commit that next touches `docs/decisions.md`. No architecture change (Rule 15).
