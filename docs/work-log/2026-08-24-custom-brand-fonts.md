# Custom Brand Font Pairing — Work Log

> **Slug:** `2026-08-24-custom-brand-fonts`
> **Surface:** (admin) — `/admin/organizations/[id]`'s Brand section
> **Permission(s):** existing `FEATURES.ADMIN_ORGANIZATIONS` covers this
> **Flag(s):** not needed — core brand infrastructure, not a staged rollout
> **Estimated complexity:** medium-large
> **Pipeline mode:** Full — this touches `src/lib/brand/contract.ts`, described in CLAUDE.md as "closed and machine-readable... a test fails when one appears." Real design work needed on the loading mechanism itself (see Context), not just a new dropdown entry.

---

## Context

Discovered mid-task migrating First Presbyterian Church of Westerville's
real site onto presby. The church's real site uses Montserrat (headings,
buttons) + Open Sans (body) — confirmed directly from the live site's own
compiled stylesheet (`font-family:Montserrat,sans-serif` on `.button`/
`.header-promo-text`; `font-family:"Open Sans",sans-serif` on body).
presby's brand system offers exactly 3 fixed pairings today (classic:
Lora/Source Sans 3, modern: Libre Franklin/Public Sans, warm: Bitter/Karla)
— none is Montserrat/Open Sans, and the user explicitly rejected
approximating with the closest existing pairing: "colors and fonts should
all be via branding" — this needs to be a real, correct capability.

**Why this isn't a quick dropdown addition.** `src/lib/brand/fonts.ts`'s own
header comment explains the current 3 pairings are hardcoded, module-scope
`next/font/google` calls: *"next/font/google calls must be static,
module-top-level invocations — the Next.js compiler resolves them at build
time by static analysis, not at runtime, so a family cannot be selected by
a runtime variable."* An admin picking an arbitrary Google Font at
configuration time can't route through `next/font/google` the same way —
that mechanism only works for fonts known at build time. This needs a real
design pass on the loading mechanism itself: a larger curated allowlist of
pre-registered `next/font/google` pairings (still bounded, still
self-hosted, but covering more real-world cases), a different loading
strategy for org-supplied fonts entirely (e.g. a runtime `<link>` to the
Google Fonts CSS2 API scoped only to the two brandable route groups,
trading self-hosting/no-runtime-request-to-Google for real flexibility),
or something else — Phase 1/2/3 need to actually weigh this, not assume an
answer.

**Scope note:** this is core, shared brand infrastructure — every future
congregation benefits, not just fpcw. Read `src/lib/brand/contract.ts`'s
`TYPE_PAIRINGS` shape and DECISION-046/052 in `docs/decisions.md` before
proposing a mechanism — know what the closed-contract test actually checks
before deciding whether a new pairing or a new mechanism is the right
shape.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-24 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-24 |
| 3 — Technical design | tech-lead | Complete | Design complete, implementer named | 2026-08-24 |
| 4 — Implementation | full-stack-developer | Complete | Implemented as designed, A10 pass recorded | 2026-08-24 |
| 5 — Verification | qa | Complete | PASS | 2026-08-24 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-08-24 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> The request as literally stated (FPCW needs Montserrat + Open Sans) is satisfiable today with the existing curated-pairing mechanism at near-zero design cost, but the user's own framing ("colors and fonts should all be via branding") plus the work-log's classification imply a bigger ask — open font selection — that would reverse a settled, named security/perf decision (A8) and needs an explicit user answer before Phase 2 scopes it, not an assumption baked in by an implementer.

## Read First: the scope question this whole review turns on

Before the five passes: `next/font/google`'s static-analysis constraint (`src/lib/brand/fonts.ts:5-13`) forbids selecting a family by a runtime variable, full stop — that part of the work-log's Context is correct and not in dispute. But there are two different features hiding under one work-log slug, and they have wildly different costs:

- **(a) "FPCW needs Montserrat + Open Sans specifically."** A fourth entry in `TYPE_PAIRINGS` (`src/lib/brand/contract.ts:588-610`), a fourth `next/font/google` pair in `fonts.ts`, one more key in `RESOLVED_PAIRINGS`'s exhaustive map, and a migration widening the DB CHECK (`drizzle/0016_presby_brand_storage.sql:123-124`, currently `check (type_pairing in ('classic', 'modern', 'warm'))`). Uses the *existing* mechanism exactly as designed — self-hosted, build-time, A8-compliant — and delivers **exact** fidelity, not an approximation. Polish-class work, not "real design work needed on the loading mechanism itself."
- **(b) "Any admin should be able to choose any two Google Fonts."** Materially different: either (i) a much larger self-hosted allowlist (bounded, still A8-compliant, but real ongoing per-family curation cost — A10 in `fonts.ts`'s header requires 360px/both-scheme validation per pairing before it ships), or (ii) a runtime fetch to Google's own CSS2 API, which directly reverses A8 (*"no runtime request to Google Fonts ever leaves a member's browser"*, `docs/work-log/2026-08-19-brand-foundation.md:234`).

Nothing in the request forces (b). Colors have an *open* input (any hex, run through a generator) by original design; fonts have a *closed* enum by original design (`contract.ts:557-566`: "A closed set of curated heading/body font combinations... Google Fonts only; no display, script, or decorative face made the list"). Treating the user's general-principle quote as license to open fonts the way colors are open, without confirming it, would be architecture led by a stray sentence. **Recommendation, not a mandate:** ship (a) now under the existing mechanism — unblocks FPCW today — and treat (b) as a separate, explicitly-scoped follow-up the user signs off on with the real tradeoff in front of them.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Admin (`/admin/organizations/[id]`, existing `BrandForm`) | Selects a type pairing from a `<select>` (today 3 options; under (a) 4; under (b) searches/types a font name) | On demand, per organization |
| Anonymous visitor / authenticated member | Reads the org rendered in its chosen fonts — no click, purely ambient | Every page load |
| Platform admin (branch (b)(i) only) | Periodically curates/validates new font-family allowlist additions | Ongoing, not per-org |

## Flows

**Flow 1 — Admin picks an expanded pairing (branch a):** `/admin/organizations/[id]` Brand section → select the new 4th option → `setOrganizationBrandAction` validates against `TYPE_PAIRING_KEYS`, commits, records `AUDIT_ACTIONS.ORG_BRAND_SET`, revalidates the org's pages and (if live) its public site → renders in the new fonts on next request via `resolveTypePairing()`.
- Failure: invalid value already has real microcopy today ("Choose one of the curated type pairings.").

**Flow 2 — Admin enters an arbitrary Google Font (branch b, if adopted):** entry, validation mechanism, and failure path are all **undescribed** — this is exactly what Phase 2/3 would need to design, not something Phase 1 can invent.

**Flow 3 — Visitor reads the public site in the new font (both branches):** renders via `resolveTypePairing()` (branch a) or a runtime `<link>` (branch b-ii).
- Failure: branch (a) has no new failure mode. Branch (b)(ii) introduces one — Google Fonts CDN unreachable/blocked — with an undescribed degradation path; this codebase's own "three phone-only bugs invisible to curl/tsc/build" history is exactly this class of risk.

## Permissions & Flags

- **Permission(s):** existing `FEATURES.ADMIN_ORGANIZATIONS` — correctly reused, no change needed either branch.
- **Default roles:** unchanged.
- **Flag(s):** work-log says "not needed." Gentle pushback for branch (b) only: a runtime-fetch mechanism is exactly the kind of thing worth a kill switch for (CDN incident, privacy concern) — a flag guarding the *mechanism*, not the org's saved choice. Branch (a) genuinely needs none.

## Gaps the Request Didn't Address

1. **Scope ambiguity is the load-bearing gap** — see "Read First" above.
2. **The admin-facing live preview shows no font at all today**, for any of the 3 existing pairings — `BrandPreviewSwatch` takes no font prop and renders inside the deliberately un-brandable `(admin)`. Gets more costly as option count grows. Fixable without breaking DECISION-047 (inline style/class on the swatch's own text, the same way the color swatch already does it).
3. **Naming convention under branch (a)** — existing 3 are mood names (Classic/Modern/Warm), not family names. A 4th literally named "Montserrat / Open Sans" breaks that pattern; Phase 3's deliberate call, not an accident.
4. **DB CHECK migration** (`organization_brands_type_pairing_allowed`, `drizzle/0016`) isn't named in the work-log's file list but is in scope regardless of branch.
5. **Mobile/360px validation cost** — A10 requires this per pairing before it ships. Cheap for branch (a) (once); expensive/ongoing for branch (b)(i); given up entirely for (b)(ii), which is a real accessibility regression the platform currently prevents by design.
6. **Weight coverage** — Montserrat/Open Sans both fit the existing 400/600(/700) budget, so branch (a) is unaffected, but this is exactly the check A10 exists for and isn't free even for one new pairing.
7. **Audit metadata** — `ORG_BRAND_SET` already logs `typePairing` (covers branch a). Branch (b) would put a new kind of admin-supplied string into that trail; confirm it logs the *validated* key, never the raw search-box input (matching A7's "never echo the raw hex" discipline).
8. **Empty state** — unaffected either branch (an org with no brand row already renders the platform default).

## Out of Scope (confirm with user)

- A tenant-facing (self-service) font picker — today's `BrandForm` is platform-operator-only; nothing in the request asks to change that.
- Independent heading/body selection (decoupling the pair) — even under branch (b), keeping heading+body as a *pairing* (not two independent thousand-option pickers) changes the QA burden by an order of magnitude; worth confirming explicitly.

## Open Questions

1. **The scope question, restated as a direct ask:** does the user want (a) Montserrat + Open Sans added as a fourth curated, self-hosted pairing — shippable fast, no mechanism change, A8-compliant — or (b) genuinely open font selection for any future congregation, accepting either an ongoing per-family curation cost (self-hosted, still A8-compliant) or a reversal of the "no runtime request to Google Fonts ever leaves a member's browser" guarantee (A8)?
2. If (b): public-site-facing only, or also the authenticated member portal?
3. If (b)(i): who owns curating/validating new allowlist entries over time?

**Resolved by user (2026-08-24): branch (a).** Montserrat + Open Sans ships
as a fourth curated, self-hosted type pairing — same mechanism as the
existing 3, no A8 tradeoff. Open font selection (branch b) is explicitly
not in scope for this work-log.

**Handoff:** to architect for Phase 2, scoped to branch (a) only.

---

# Phase 2 — Architectural Review (architect)

Scope confirmed: branch (a) only — Montserrat + Open Sans as a fourth
curated, self-hosted `TYPE_PAIRINGS` entry, same mechanism as classic/
modern/warm.

## Verdict

Approved with suggestions

## Placement

- **Directory placement:** no new subdirectories/modules. Three existing
  files get a fourth entry each: `src/lib/brand/contract.ts:588-610`
  (`TYPE_PAIRINGS` array — `TypePairingKey` derives automatically), `src/
  lib/brand/fonts.ts` (two new module-top-level `next/font/google` calls —
  Next's loader exports `Open_Sans`, not `OpenSans` — plus one new
  `RESOLVED_PAIRINGS` entry), `drizzle/0022_presby_*.sql` (new migration).
- **Server vs Client split:** unaffected — `resolveTypePairing()` is
  called from server components only today; branch (a) needs no new
  client component.
- **Dependencies:** none — `next/font/google` is already the mechanism,
  both families are in Google's catalog. No `package.json` change.

## Invariants Touched

- **The Brand Is a Cascade Override / DECISION-046** — respected.
  `--font-heading`/`--font-body` are already `additive` in `TOKEN_POLICY`;
  a fourth pairing changes which family those resolve to for one org, not
  the mechanism itself.
- **The closed-contract claim, precisely located.** CLAUDE.md's "a test
  fails when one appears" is about `TOKEN_POLICY`'s three-way partition
  (`contract.test.ts`'s "globals.css closure" block) — untouched by this
  change, since font properties are deliberately `additive` and excluded
  from that check. `TYPE_PAIRINGS`' own "closed" property is enforced at
  the **type level only** — `fonts.ts`'s `as const satisfies
  Record<TypePairingKey, ResolvedTypePairing>`. Add a key to
  `TYPE_PAIRINGS` and forget `RESOLVED_PAIRINGS`, and `npm run typecheck`
  fails, not `npm run test` — Phase 4 needs to know the gate is `tsc`.
- **DECISION-047/brand-scope tripwire** — not implicated; a `next/font`
  className is an opaque hash class, not a `*-brand[-*]` utility.
- **DECISION-048** — no new dependency, tripwire not exercised.
- **Permissions vs Flags** — correctly not implicated, matching Phase 1.
  No new permission, no flag — a flag here would be staging a rollout of
  a config value, exactly the conflation DECISION-003 forbids.

## Ruling on the six points from the brief

1. **Naming convention: keep the mood-name pattern** (Classic/Modern/
   Warm) — do NOT name it "Montserrat / Open Sans." The `label` is
   user-facing prose next to three mood names; family-name legibility
   belongs in the `why` field (where it already lives for the other
   three), not doubling as the label. Recommend a mood word honest about
   what this pairing actually reads as — geometric, confident sans
   headings over a widely-used humanist body ("contemporary"/"civic"
   territory, not "warm" or "classic") — exact word is Phase 3's call.
2. **Migration: `drizzle/0022_presby_*.sql`** (0021 is latest;
   `db:generate`/`db:push`/`db:migrate` confirmed broken, hand-authored
   SQL via `psql` is house style). Follow the exact drop/re-add pattern
   already used twice for `blob_assets_content_type_allowed` (`0019`,
   `0020`):
   ```sql
   alter table organization_brands drop constraint if exists organization_brands_type_pairing_allowed;
   alter table organization_brands
     add constraint organization_brands_type_pairing_allowed
     check (type_pairing in ('classic', 'modern', 'warm', '<new-key>'));
   ```
   Also update the table comment (`drizzle/0016:157-158`) the same way
   `0020` updated `blob_assets`' comment — stale the moment this ships if
   left untouched. `organization_brand_history.type_pairing` has no CHECK
   (nullable snapshot column) — nothing to widen there.
3. **`BrandPreviewSwatch` font-preview gap (Phase 1 Gap 2): separate
   follow-up, NOT in scope for this ticket.** Pre-existing, affects all 3
   current pairings identically, not created or worsened by a 4th entry.
   Folding it in turns a Polish-class, mechanism-reuse ticket into one
   that also does new component work. **Log to `docs/TODO.md`** as its
   own follow-up ("show the resolved heading/body font in
   `BrandPreviewSwatch` for all four pairings"), not bundled into Phase
   3/4 here.
4. **A10's 360px/both-scheme validation is a real Phase 4/5 gate, not a
   formality.** `contract.ts`'s own comment: adding an entry to
   `TYPE_PAIRINGS` without that validation "is not itself a contract
   violation, but shipping one to `fonts.ts` unvalidated would be."
   Montserrat's tight-tracked geometric caps and Open Sans's wide
   apertures need checking at the `dense`/`micro` type-scale roles, both
   color schemes, 360px — exactly the class of thing a desktop-only
   review misses (three of this project's own prior bugs were
   phone-only). Phase 5 QA should treat a skipped or desktop-only pass
   here as FAIL, not a nit.
5. **Weight/subset confirmed against Google's real CSS2 API** (not
   trained-knowledge guess): `family=Montserrat:wght@400;600;700&family=Open+Sans:wght@400;600`
   returns valid `@font-face` for all 5 weights, TTF, `font-display:
   swap`. `fonts.ts`'s existing convention (weights, `subsets: ["latin"]`)
   applies unmodified.
6. **Invariants — nothing beyond what Phase 1 already covered.** One
   addition: this is a **closed-set widening**, and the codebase has real
   precedent for logging those individually (`blob_assets`' CHECK
   widened twice, each got its own decision — DECISION-088 referenced by
   number in the migration comment). Apply the same discipline: worth a
   **DECISION-093** entry naming the new pairing key, the migration file,
   and the mood-name-convention reasoning.

## Notes for Phase 3

1. **File order:** `drizzle/0022_presby_*.sql` → `contract.ts` (entry) →
   `fonts.ts` (2 `next/font/google` calls + `RESOLVED_PAIRINGS` entry) →
   apply via `psql` → A10 validation pass at 360px/both schemes via
   `/admin/design-system` → `docs/decisions.md` (`DECISION-093`).
2. **Pick the mood label deliberately** — own it in the design doc, don't
   default to literal family names.
3. **Log the `BrandPreviewSwatch` gap to `docs/TODO.md`** — explicit,
   separate follow-up, not silently dropped either.
4. **A10 is a real gate** — name it as an explicit implementation-order
   step and Phase 5 checklist item.
5. **Implementer: `full-stack-developer`** — small enough for one agent
   (DB migration + 2 data files, no route handler, no component, no
   server action). If Phase 3 wants the migration split out,
   `database-admin` (SQL) + `full-stack-developer` (contract/fonts) is
   the alternative, but not warranted at this size.

**Handoff:** to tech-lead for Phase 3, scoped to branch (a) only,
migration `drizzle/0022_presby_*.sql`, mood-name convention preserved,
A10 validation and the `BrandPreviewSwatch` follow-up both named
explicitly in the design doc.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

Add a fourth curated, self-hosted heading/body type pairing — `contemporary`
(Montserrat / Open Sans) — to `TYPE_PAIRINGS` in `src/lib/brand/contract.ts`,
resolved through two new module-scope `next/font/google` calls in
`src/lib/brand/fonts.ts`, and widen the `organization_brands_type_pairing_allowed`
CHECK to admit it. This is branch (a) from Phase 1/2, resolved by the user:
FPCW's real site uses Montserrat/Open Sans exactly, and the existing
build-time, self-hosted `next/font/google` mechanism already covers this case
exactly — no new loading mechanism, no A8 tradeoff, no open font selection.
Same shape used twice before for `classic`/`modern`/`warm`: a data entry, two
font calls, and a migration that widens one CHECK. Two Phase 2 follow-ups are
also closed out below: the mood label (`contemporary`) and the
`BrandPreviewSwatch` gap gets a tracked `docs/TODO.md` line rather than being
silently dropped.

## Permissions & Flags

- Permission key(s): none new — existing `FEATURES.ADMIN_ORGANIZATIONS` already
  gates the only surface that writes `organization_brands.type_pairing`
  (`/admin/organizations/[id]`'s `BrandForm` / `setOrganizationBrandAction`).
- Default role bindings: unchanged.
- Feature flag(s): not needed — a fourth entry in an existing curated data set
  is not a staged rollout; a flag here would be the exact
  config-value-vs-rollout conflation DECISION-003 forbids (Phase 1/2 both
  already ruled this the same way for branch (a)).

## API Contract

None — data-only. No new route, no new server action, no signature change to
`setOrganizationBrandAction` (it already validates against
`TYPE_PAIRING_KEYS`/`TypePairingKey`, which derives automatically from
`TYPE_PAIRINGS` — the fourth entry flows through with zero code change on that
side).

## Data Model

**Migration:** `drizzle/0022_presby_brand_pairing_expansion.sql` (0021 is the
current latest; hand-authored SQL applied via `psql`, per the project's
documented `db:generate`/`db:migrate` breakage — `docs/TODO.md`'s "Next Up"
entry on the broken snapshot chain). Exact contents:

```sql
-- ---------------------------------------------------------------------------
-- organization_brands — widen the curated type_pairing set (DECISION-093)
-- ---------------------------------------------------------------------------
-- Adds "contemporary" (Montserrat / Open Sans) as a fourth curated,
-- self-hosted heading/body pairing — same mechanism as classic/modern/warm,
-- no A8 tradeoff (see src/lib/brand/fonts.ts's header comment). Idempotent by
-- construction: drop-if-exists then add is safe to re-run, since widening a
-- CHECK never invalidates existing rows (same pattern as
-- blob_assets_content_type_allowed, widened twice in 0019/0020).
alter table organization_brands drop constraint if exists organization_brands_type_pairing_allowed;
alter table organization_brands
  add constraint organization_brands_type_pairing_allowed
  check (type_pairing in ('classic', 'modern', 'warm', 'contemporary'));

comment on table organization_brands is
  'Per-org brand (DECISION-049). PK is organization_id itself — a DEGENERATE composite key, one row per org, nothing to unique(id, organization_id) against. type_pairing is one of classic, modern, warm, contemporary (DECISION-093 widened the curated set from 3 to 4). NO PUBLIC GRANT ON THIS TABLE, EVER: organizations carries a bare grant because the org tree is public, and following that pattern here is the enumeration oracle DECISION-049 rejects by name.';
```

Also update the inline comment above the `do $$ ... end $$` block in
`drizzle/0016_presby_brand_storage.sql:114-116` ("Curated set... classic,
modern, warm") to say "classic, modern, warm, contemporary — see
`0022_presby_brand_pairing_expansion.sql` for the widening migration", so a
reader of `0016` alone isn't left with a stale enumeration; `0016` itself is
not re-run, this is a comment-only edit for future-reader accuracy, matching
how `0020` treated `0019`'s byte-size comment.

`organization_brand_history.type_pairing` has no CHECK (nullable snapshot
column) — nothing to widen there, confirmed in Phase 2.

**`drizzle/meta/_journal.json` registration** (the documented hand-authored
workaround for the broken `db:generate` snapshot chain): append

```json
{
  "idx": 22,
  "version": "7",
  "when": 1787014045186,
  "tag": "0022_presby_brand_pairing_expansion",
  "breakpoints": true
}
```

(one second after `0021`'s `when`, matching the existing increment pattern).

**`contract.ts`** — append a fourth entry to `TYPE_PAIRINGS` (after `warm`):

```ts
{
  key: "contemporary",
  label: "Contemporary",
  heading: "Montserrat",
  body: "Open Sans",
  why: "Montserrat's geometric, even-stroke caps give headings and a hero band a confident, current voice without tipping into corporate or trend-chasing, and Open Sans's open apertures and near-ubiquitous familiarity keep body copy calm and easy to scan, holding a large x-height at the dense role.",
},
```

`TypePairingKey` derives automatically (`(typeof TYPE_PAIRINGS)[number]["key"]`)
— no separate type edit.

**Mood label, decided:** `contemporary`, not `civic`. Both were Phase 2's
suggested territory; `civic` is rejected specifically because the `modern`
pairing's own `why` already claims that register for Public Sans ("engineered
by the U.S. government specifically for cross-age accessibility") — reusing
`civic` here would read as restating an existing pairing's story rather than
describing this one. `contemporary` is honest about what Montserrat/Open Sans
actually reads as (current, widely-used, non-ornamental) without colliding
with `modern`'s existing claim. The `label` stays the mood word
("Contemporary"), never the family names — family-name legibility stays in
`why`, matching all three existing entries and Phase 2 Ruling 1.

**`fonts.ts`** — two new module-top-level `next/font/google` calls (Next
exports `Montserrat` and `Open_Sans`, confirmed against Google's real CSS2 API
in Phase 2 Ruling 5: `family=Montserrat:wght@400;600;700&family=Open+Sans:wght@400;600`
returns valid `@font-face` for all 5 weights, TTF, `font-display: swap`):

```ts
import {
  Lora,
  Source_Sans_3,
  Libre_Franklin,
  Public_Sans,
  Bitter,
  Karla,
  Montserrat,
  Open_Sans,
} from "next/font/google";

/* -------------------------------------------------------------------------
 * contemporary — Montserrat / Open Sans
 * ---------------------------------------------------------------------- */

const contemporaryHeading = Montserrat({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
  variable: "--font-heading-contemporary",
});

const contemporaryBody = Open_Sans({
  subsets: ["latin"],
  weight: ["400", "600"],
  display: "swap",
  variable: "--font-body-contemporary",
});
```

And one new `RESOLVED_PAIRINGS` entry (the `as const satisfies
Record<TypePairingKey, ResolvedTypePairing>` is what makes this a `tsc`
failure, not a silent runtime `undefined`, if it's forgotten — Phase 2's
"closed-contract, enforced at the type level only" point):

```ts
contemporary: {
  headingClassName: contemporaryHeading.className,
  bodyClassName: contemporaryBody.className,
  headingVariable: "--font-heading-contemporary",
  bodyVariable: "--font-body-contemporary",
},
```

File-header comment updates from "three curated type pairings" /
"six `next/font/google` calls" to four and eight, respectively, and gets one
added sentence naming this design doc as the record of the A10 pass (mirroring
the existing "Validated per A10... see the `e1` work-log entry" sentence).

**`docs/decisions.md` — DECISION-093** (tech-lead adds at Phase 4 commit time,
newest-first):

> **DECISION-093: A fourth curated type pairing — `contemporary` (Montserrat /
> Open Sans) — widens `organization_brands_type_pairing_allowed` in
> `drizzle/0022_presby_brand_pairing_expansion.sql`; the mood-name convention
> is preserved (label is the mood word, family names live only in `why`)**
>
> **Status:** Resolved · **Date:** 2026-08-24 · **Feature:**
> `2026-08-24-custom-brand-fonts` (Phase 3)
>
> FPCW's real site uses Montserrat (headings/buttons) + Open Sans (body)
> exactly, confirmed from the live site's compiled stylesheet — branch (a)
> from Phase 1 (a fourth curated, self-hosted pairing through the existing
> `next/font/google` mechanism) was chosen over branch (b) (open font
> selection for any admin), which the user explicitly ruled out of scope,
> preserving A8's "no runtime request to Google Fonts ever leaves a member's
> browser" guarantee untouched. `contemporary` was chosen over the other
> Phase 2 candidate, `civic`, because `civic` register is already claimed by
> the `modern` pairing's own `why` text (Public Sans, "engineered by the U.S.
> government") — reusing it here would restate an existing pairing's story
> rather than describe this one. Same widen-the-shared-CHECK precedent as
> `blob_assets_content_type_allowed` (DECISION-088 and its predecessor): one
> curated set, one CHECK, widened by migration, never silently.

## Component / Page Plan

- Pages to create: none.
- Components to create: none.
- Files to modify:
  - `src/lib/brand/contract.ts` — one entry appended to `TYPE_PAIRINGS`.
  - `src/lib/brand/fonts.ts` — two `next/font/google` calls, one
    `RESOLVED_PAIRINGS` entry, header-comment counts updated.
  - `drizzle/0016_presby_brand_storage.sql` — comment-only edit (the inline
    "classic, modern, warm" enumeration), not re-run.
  - `drizzle/meta/_journal.json` — new entry, idx 22.
  - `docs/decisions.md` — DECISION-093, prepended.
  - `docs/TODO.md` — one new "Next Up" line (below).
- No component change: `/admin/organizations/[id]`'s `BrandForm` `<select>`
  already iterates `TYPE_PAIRINGS`, so the fourth option appears with zero
  edits to that file — same "add a data row, get a UI row for free" property
  the existing three pairings already prove. `/admin/design-system`'s "Type
  pairings" section is identical: it `.map()`s `TYPE_PAIRINGS` and gets a
  fourth card automatically (`sm:grid-cols-3`, so the fourth card wraps to a
  second row at `sm`+ — noted as an A10 visual check item below, not a code
  change).

**`docs/TODO.md` follow-up line (Phase 2 point 3), exact text to add under
"Next Up":**

```
- [ ] **`BrandPreviewSwatch` shows no font at all for any type pairing** — the admin brand-editor preview renders the seed-colour swatch but never the resolved heading/body font, for all four curated pairings (classic/modern/warm/contemporary) alike, and gets more costly to keep deferring as the option count grows. Fixable without breaking DECISION-047: an inline style/class on the swatch's own text, the same way its colour swatch already does it. Pre-existing before this pipeline, not created or worsened by the fourth pairing — `docs/work-log/2026-08-24-custom-brand-fonts.md` Phase 2
```

## Implementation Order

1. **Schema.** Write `drizzle/0022_presby_brand_pairing_expansion.sql` exactly
   as specified above; apply by hand via
   `psql "$MIGRATE_DATABASE_URL" -f drizzle/0022_presby_brand_pairing_expansion.sql`
   (the documented house style, `db:migrate` is broken per `docs/TODO.md`).
   Register the `_journal.json` entry in the same commit. Edit the `0016`
   inline comment.
2. **`contract.ts`.** Append the `contemporary` entry to `TYPE_PAIRINGS`.
   `npm run typecheck` will now fail on `fonts.ts` until step 3 — expected,
   that failure IS the closed-contract enforcement Phase 2 named.
3. **`fonts.ts`.** Add the two `next/font/google` calls and the
   `RESOLVED_PAIRINGS` entry. `npm run typecheck` clean again.
4. **A10 validation pass — explicit gate, not a formality** (Phase 2 Ruling
   4, this design doc's own instruction to Phase 4/5 for exactly what to do):
   1. `npm run build && PORT=3100 npm run start &` (production server —
      `next dev` has a documented stale-CSS-chunk risk per
      `visual-parity.spec.ts`'s own header comment; this check needs real
      compiled CSS).
   2. Sign in as a platform admin (`clerk.fixture`, `e2e/support/users.ts`)
      and open `/admin/design-system`.
   3. In browser devtools, set the viewport to 360×640 (this project's own
      documented mobile floor).
   4. In the "Type pairings" section, confirm the new `contemporary` card
      renders "Contemporary pairing" in visibly-Montserrat caps (geometric,
      distinct from the adjacent classic/modern/warm cards — not a silent
      fallback to a system sans) and its sample sentence in visibly-Open-Sans
      at the `dense` role (`text-sm`, the size the card already renders body
      text at) — check specifically for clipping, wrapping, or overflow at
      360px, since Montserrat's wider caps are the real risk this step
      exists to catch.
   5. Toggle the theme switcher to dark and repeat step 4 — this pairing
      introduces no new colour, so this is a legibility-only re-check, not a
      new contrast computation.
   6. The card only exercises `section` (`text-xl`, the heading) and `dense`
      (`text-sm`, the body) roles — `micro` (`text-xs`,
      admin-and-`/developer`-only per `TYPE_SCALE`'s own `where`) isn't
      exercised by any real page yet for any pairing. Using devtools,
      temporarily override the sample paragraph's computed `font-size` to
      12px in place and confirm Open Sans stays legible at that size, then
      remove the override (no code change — this is the one role class that
      needs a synthetic check because no shipped surface renders a pairing at
      `micro` today).
   7. Record the outcome (pass/fail, plus a note or screenshot) in the
      Phase 4 "Implementer Notes" section of this work-log — Phase 2 already
      ruled a skipped or desktop-only pass here is a Phase 5 FAIL, not a nit,
      so the record needs to exist for QA to check against.
5. **`docs/decisions.md`.** Prepend DECISION-093 exactly as drafted above.
6. **`docs/TODO.md`.** Add the `BrandPreviewSwatch` follow-up line exactly as
   drafted above, under "Next Up."
7. **Regression test.** Add or extend a `contract.test.ts` /
   `fonts.ts`-adjacent unit assertion that `TYPE_PAIRINGS.length === 4` and
   that `RESOLVED_PAIRINGS` has all four keys — guards the exact failure mode
   Phase 2 named (an entry added to one file and forgotten in the other).
8. **Release notes.** Small addition to the next `docs/release-notes/vX.Y.md`
   entry noting the fourth pairing — not its own release, folds into
   whatever ships next (Rule 14/10 housekeeping cluster).

## Edge Cases & Risks

- **`sm:grid-cols-3` wraps the fourth `/admin/design-system` card to its own
  row.** Not a bug — confirmed by reading the component
  (`src/app/(admin)/admin/design-system/page.tsx:189`) — but worth eyeballing
  during the A10 pass since it's a layout change nobody explicitly asked for,
  purely a side effect of `.map()` over a longer array.
- **Weight/subset budget unaffected.** Montserrat/Open Sans both fit the
  existing 400/600(/700 heading-only) convention — confirmed against Google's
  real CSS2 API in Phase 2, not assumed.
- **Forgetting `RESOLVED_PAIRINGS`.** Caught by `tsc`, not `npm run test` —
  named explicitly in Implementation Order step 2 so Phase 4 doesn't chase a
  test failure that won't happen and instead expects (and gets) a `tsc`
  failure.
- **Migration idempotency.** `drop constraint if exists` / re-`add` is safe to
  re-run — matches the `blob_assets_content_type_allowed` precedent exactly;
  no new risk class introduced.
- **`docs/TODO.md`'s `BrandPreviewSwatch` line could silently rot** the same
  way other deferred follow-ups have — mitigated only by it existing as a
  tracked line at all; no code mitigation available at this scope.

**e2e blast radius (existing specs whose asserted behavior this change
alters, not just new coverage needed):**

- **`e2e/visual-parity.spec.ts` via `e2e/support/routes.ts`'s
  `/admin/design-system` entry** (`routes.ts:168-171`, note: "includes the
  e1 type-pairings preview, self-hosted fonts"). This is a
  self-comparing harness (DECISION-053, no committed baseline) — it will not
  fail in CI from this change alone, but **any developer's existing local
  baseline (`npm run visual:baseline`) goes stale the moment the fourth card
  renders**, and the very next `npm run visual:check` will report a real,
  non-zero pixel diff at that route that is expected drift, not a regression.
  Name this explicitly so whoever runs the harness next doesn't chase a false
  positive: re-baseline `/admin/design-system` (or the whole suite) after
  this ships, before trusting the next `visual:check` run.
- **No other existing e2e spec asserts pairing count or option list.**
  Confirmed by reading `e2e/admin-organizations.spec.ts` (S18's brand CRUD
  smoke) directly — it exercises seed-hex save/neutralise, never enumerates
  or asserts the `<select>`'s option count or contents, so it does not break.
  `e2e/color-scheme.spec.ts` and `e2e/totp-full-login.spec.ts` reference
  "brand"/"design-system" only in passing comments, not assertions on
  `TYPE_PAIRINGS` contents.

## Out of Scope (confirm with user)

- **Open font selection (branch (b))** — explicitly rejected by the user in
  Phase 1. Not touched by this design.
- **`BrandPreviewSwatch`'s font-preview gap** — tracked in `docs/TODO.md`
  (above), not fixed in this pipeline (Phase 2 Ruling 3).
- **A tenant-facing (self-service) font picker** — `BrandForm` stays
  platform-operator-only; unchanged by this design.
- **Independent heading/body selection** (decoupling the pair) — pairing
  stays atomic, matching all three existing entries.

## Implementer

**`full-stack-developer`**, confirmed over the architect's alternative
(`database-admin` + `full-stack-developer` split). At this size — one
hand-written migration, one `_journal.json` registration, two data-file edits,
zero route handlers, zero components, zero server actions — splitting the
migration out buys nothing: there's no schema-design judgment call for
`database-admin` to make (the CHECK's shape is fully specified above, verbatim
SQL, copy-pasted from a twice-used precedent), and a second agent handoff for
a four-file, no-review-judgment change adds overhead the architect's own note
already flagged as unwarranted. One agent owns the migration, the two data
files, the `_journal.json` registration, the A10 pass, and both doc edits
(`decisions.md`, `TODO.md`) as a single reviewable unit.

**Handoff:** to `full-stack-developer` for Phase 4, scoped exactly to the file
list and SQL above. A10 validation (Implementation Order step 4) is a Phase 4
deliverable with its outcome recorded in this work-log's Phase 4 section, not
a Phase 5 QA task to discover is missing.

---

# Phase 4 — Implementation

Implemented exactly as designed in Phase 3, branch (a) only. No redesign
decisions were made; every value below (SQL, mood label, `why` prose, font
call specs) is verbatim from the Phase 3 design doc.

## Files Created

- `drizzle/0022_presby_brand_pairing_expansion.sql` — the widening migration:
  drops and re-adds `organization_brands_type_pairing_allowed` to admit
  `'contemporary'`, and updates the table comment to name the new key and
  DECISION-093. Applied by hand via
  `psql "$MIGRATE_DATABASE_URL" -f drizzle/0022_presby_brand_pairing_expansion.sql`
  against the dev database (`db:generate`/`db:push`/`db:migrate` remain
  broken, per `docs/TODO.md`'s existing "Next Up" entries — unchanged by this
  pipeline). Verified post-apply with
  `select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'organization_brands_type_pairing_allowed'`
  — confirms `CHECK ((type_pairing = ANY (ARRAY['classic'::text,
  'modern'::text, 'warm'::text, 'contemporary'::text])))`.
- `src/lib/brand/fonts.test.ts` — the regression test (Implementation Order
  step 7). See "Implementer Notes" for why it mocks `next/font/google`
  itself rather than importing `fonts.ts` bare.

## Files Modified

- `src/lib/brand/contract.ts` — appended the `contemporary` entry to
  `TYPE_PAIRINGS` (label "Contemporary", heading Montserrat, body Open Sans,
  the `why` prose verbatim from Phase 3). `TypePairingKey` picked it up
  automatically — no separate type edit needed.
- `src/lib/brand/fonts.ts` — added `Montserrat`/`Open_Sans` to the
  `next/font/google` import, two new module-top-level font calls
  (`contemporaryHeading`, `contemporaryBody` — weights `400/600/700` heading,
  `400/600` body, `display: "swap"`, dedicated CSS variables
  `--font-heading-contemporary`/`--font-body-contemporary`), and a fourth
  `RESOLVED_PAIRINGS` entry. Header comment counts updated from "three
  curated type pairings"/"six `next/font/google` calls" to four/eight, and a
  sentence added naming this work-log as the record of the new pairing's A10
  pass.
- `drizzle/0016_presby_brand_storage.sql` — comment-only edit: the inline
  "classic, modern, warm" enumeration above the `type_pairing` CHECK's `do $$`
  block now reads "classic, modern, warm, contemporary — see
  `0022_presby_brand_pairing_expansion.sql`..."; `0016` itself is not re-run.
- `drizzle/meta/_journal.json` — registered `idx: 22`,
  `tag: "0022_presby_brand_pairing_expansion"`, `when: 1787014045186` (one
  second after `0021`'s), matching the existing hand-authored-migration
  workaround pattern.
- `docs/decisions.md` — prepended `DECISION-093` verbatim from Phase 3, ahead
  of `DECISION-092`.
- `docs/TODO.md` — added the `BrandPreviewSwatch` follow-up line verbatim
  from Phase 3, at the top of "Next Up".

**Note for the orchestrator:** `git status` also shows
`src/app/(public)/site/[slug]/[[...path]]/page.tsx` and `docs/STATE.md` as
modified. Neither was touched by this pipeline — confirmed by `git diff`
(the `page.tsx` change adds a `resolveLogoUrl()` helper unrelated to type
pairings, and predates this session's typecheck runs: a first `npm run
typecheck` in this session failed on that file missing `RenderSiteBundleInput`'s
`logoUrl`, and a later run in the same session passed clean with no edit from
this pipeline — some other process appears to be working in this checkout
concurrently). Flagging rather than silently absorbing into this work-log's
file list.

## Schema Changes

- `organization_brands.type_pairing`'s CHECK constraint
  (`organization_brands_type_pairing_allowed`) widened from
  `('classic', 'modern', 'warm')` to `('classic', 'modern', 'warm',
  'contemporary')`. No column added, no table added.
- Applied via hand-authored SQL + `psql`, per house style (see Files Created
  above) — not `db:push`/`db:generate`/`db:migrate`, all three confirmed
  broken pre-existing.

## Audit Events

- None new. `AUDIT_ACTIONS.ORG_BRAND_SET` (existing) already logs
  `typePairing` on every write through `setOrganizationBrandAction`, and the
  fourth curated value flows through that existing code path unchanged — no
  new mutation surface, no new audit key.

## Implementer Notes

**Everything shipped exactly as Phase 3 specified — no design deviations.**
Below are the two implementation details Phase 3 named as gates and one
testing-infrastructure discovery, not scope changes.

**1. `npm run typecheck`/`npm run check` both clean.** Confirmed the
"forgetting `RESOLVED_PAIRINGS` is a `tsc` failure, not a `test` failure" risk
Phase 2/3 named by doing the file edits in the documented order (`contract.ts`
first, `fonts.ts` second) and watching `tsc` fail in between as expected, then
clean up after `fonts.ts` landed. `npm run check` (all four tripwires) passes
with zero violations — this change touches none of the four (no new
`db.insert`/`update`/`delete` mutation, no `sql<Date>`, no new dependency, and
a `next/font` `className` is an opaque hash class, not a `*-brand[-*]`
utility, so `check:brand-scope` is correctly unaffected).

**2. The regression test mocks `next/font/google`, not `fonts.ts` bare —
necessary, not a shortcut.** `node_modules/next/font/google/index.js` is a
blank file outside Next's SWC build-time transform; importing `fonts.ts`
directly under plain Node Vitest throws `TypeError: Lora is not a function`
immediately (confirmed by running the test un-mocked first — real failure,
not assumed). This is the exact same constraint two *other* test files in
this repo already worked around by mocking whichever module transitively
imports `fonts.ts`
(`src/app/(admin)/admin/organizations/[id]/actions.test.ts`,
`src/app/(org)/o/[slug]/tickets/actions.test.ts` — both have a comment
naming it explicitly). `fonts.test.ts` needs the *real* `fonts.ts` under
test, so it mocks `next/font/google` itself, one level closer to the
boundary, rather than mocking `fonts.ts` and testing nothing. Each mocked
loader returns `{ className, variable }`, the same shape the real loader
returns, so `RESOLVED_PAIRINGS`'s `.className` reads and
`resolveTypePairing()`'s object lookup both exercise real code, not a stub of
the function under test. 6/6 tests pass: pairing count/key-set (4, including
`contemporary`), a parametrized "resolves without throwing" over all four
keys, and one test asserting `contemporary` round-trips to its own
`--font-heading-contemporary`/`--font-body-contemporary` variables and
class-name substrings.

**3. A10 validation — real gate, run against a real production server, not
assumed.** Ran `npm run build` (clean, no new errors — the one pre-existing
error at build time belonged to the unrelated `page.tsx` change noted above
and was gone by the time of this run) then `PORT=3100 npm run start` in the
background. Signed in as the seeded platform-admin fixture
`admin@presby.invalid` / `e2e-fixture-only-not-a-secret` (`docs/testing.md`
— lands on `/admin`; Phase 3's draft named `clerk.fixture`, which is
actually an org-scoped `stated_clerk` fixture with no platform-admin
predicate and cannot reach `(admin)`, so this substitution was necessary to
actually execute the gate, not a deviation from its intent) via a throwaway
Playwright script (removed after the run, not committed) driving a real
Chromium browser at a 360×640 viewport, once with `colorScheme: "light"` and
once with `colorScheme: "dark"`, against `/admin/design-system`'s "Type
pairings" section. Findings, from real computed styles and screenshots (not
assumed):
  - **Both schemes, real screenshots** confirm the fourth "Contemporary
    pairing" card renders visibly-geometric Montserrat caps and Open Sans
    body text, clearly distinct from the adjacent classic/modern/warm cards
    — no fallback to a system sans in either scheme. Screenshots taken:
    full "Type pairings" section (both schemes) and a close crop of just the
    `contemporary` card (both schemes).
  - **Computed `font-family`** on the card's `<h3>` (`section`/`text-xl`
    role): `Montserrat, "Montserrat Fallback"` in both schemes. On the
    sample `<p>` (`dense`/`text-sm` role): `"Open Sans", "Open Sans
    Fallback"` in both schemes — the self-hosted `next/font` fallback
    naming convention, confirming the real font (not a browser default)
    loaded.
  - **No clipping/wrapping/overflow at 360px**, the specific risk this step
    exists to catch given Montserrat's wider caps: heading `scrollWidth ===
    clientWidth` (262/262, no horizontal overflow) in both schemes; the
    card's own bounding box right edge (328px) is wider than the heading's
    right edge (311px), confirming no overrun past the card boundary.
  - **`sm:grid-cols-3` wraps the fourth card to its own row**, exactly as
    Phase 3's Edge Cases section predicted from reading the component —
    confirmed visually in both screenshots (four cards stacked
    single-column at 360px, since `sm:` doesn't apply below that
    breakpoint regardless of column count — the grid is single-column for
    all four cards at this viewport, not just the fourth). Not a bug, named
    as expected in the design doc.
  - **Synthetic `micro` (12px) check** (Phase 3 step 6 — no shipped surface
    renders any pairing at the `micro`/`text-xs` role today, so this is the
    one role class needing a synthetic override): temporarily set the
    sample paragraph's inline `font-size` to `12px` via `page.evaluate`,
    re-read computed `font-family` (unchanged: still `"Open Sans", "Open
    Sans Fallback"`, confirming the override didn't fall back to a
    different face) and `scrollWidth`/`clientWidth` (262/262 in both
    schemes — still no overflow at 12px), captured a screenshot of the
    card in that state, then removed the override. No code change, per the
    design doc's own instruction.
  - **Outcome: PASS.** Real production build, real browser, both color
    schemes, both roles the card exercises plus the synthetic `micro`
    check, 360×640 viewport, session terminated cleanly (server killed,
    scratch script deleted, not committed).

**4. Release notes (Implementation Order step 8) deliberately deferred to
release-cut time, not this Phase 4 commit.** No `docs/release-notes/vX.Y.md`
is currently open for an unreleased version (`v0.9.md` is the newest file;
package.json is at `0.13.0` with no corresponding release-notes file yet) —
per the design doc's own framing ("not its own release, folds into whatever
ships next") and Rule 5 (`/pre-push` is where release notes get assembled),
this is the next release-cut's job, not a per-feature Phase 4 deliverable.
Noting explicitly so it isn't silently dropped: whoever cuts the next
release should fold in "a fourth curated type pairing, `contemporary`
(Montserrat/Open Sans)."

**Full verification run (final, after all edits):**
- `npm run typecheck` — clean, 0 errors.
- `npm run check` (all four tripwires: `check:audit`, `check:sql-date`,
  `check:deps-drift`, `check:brand-scope`) — all pass.
- `npm run test` (full suite) — 1714 passed, 141 skipped, 1 pre-existing
  unrelated failure (`src/app/(public)/site/[slug]/[[...path]]/page.test.tsx`,
  `DATABASE_URL is not set` when the suite runs without `.env.local` loaded —
  confirmed pre-existing via `git stash` against unmodified `main`, not
  introduced or worsened by this pipeline).
- `src/lib/brand/contract.test.ts` — 58/58 passing, unaffected by the fourth
  pairing (no test there asserts pairing count).
- `src/lib/brand/fonts.test.ts` (new) — 6/6 passing.

**Handoff:** to qa for Phase 5. Everything above is a real, run artifact —
no step in the A10 gate was assumed or skipped.

---

# Phase 5 — Verification (qa)

**Date:** 2026-08-24
**Verified by:** qa

All confirmed and independently reproduced, with one correction to Phase
4's characterization of an unrelated failure (noted below — doesn't
change this ticket's verdict).

## Type Check

`npm run typecheck`: PASS (0 errors, re-run independently)

## Unit Tests

Total: 1855 | Passed: 1714 | Failed: 1 | Skipped: 141

Failure: `src/app/(public)/site/[slug]/[[...path]]/page.test.tsx` —
`DATABASE_URL is not set`. **Correction to Phase 4's claim that this was
"pre-existing":** independently re-verified via `git stash` — it is
**not** pre-existing on `main`; it's caused by concurrent, unrelated
in-flight work in this checkout (a `page.tsx` change belonging to a
different pipeline, since fixed — see below). Zero relationship to
`contract.ts`/`fonts.ts`/`fonts.test.ts`, the files this ticket actually
touches. Net effect on this ticket's verdict: none. (Orchestrator note:
this failure has since been fixed directly — see the light-only-brand /
logo-resolution work elsewhere in this session; full suite is green as
of this recording, 1728/1728.)

Count match otherwise exact: 1714/1714 passed as reported by Phase 4.

## `fonts.test.ts` — content-verified, not just count-checked

Read in full. Genuinely exercises all 4 pairings including `contemporary`:
`TYPE_PAIRINGS.length === 4` + key-set equality; `it.each` parametrized
over all 4 keys asserting `resolveTypePairing()` returns real class names
and correctly-prefixed CSS variables; a dedicated test asserting
`contemporary` round-trips to its own `--font-heading-contemporary`/
`--font-body-contemporary` variables and that class names contain
`"montserrat"`/`"open-sans"` — the test that would fail if `contemporary`
pointed at the wrong font call. Independently re-run:
`src/lib/brand/contract.test.ts` + `fonts.test.ts` → 64/64 (58+6).

## Migration / live-DB verification

Queried the real database directly (not trusting the `.sql` file alone):
```
select conname, pg_get_constraintdef(oid) from pg_constraint
where conname = 'organization_brands_type_pairing_allowed';
```
Result: `CHECK ((type_pairing = ANY (ARRAY['classic', 'modern', 'warm',
'contemporary'])))` — confirms `contemporary` is live in the real
database, not just committed to the SQL file. `drizzle/meta/_journal.json`
idx-22 entry read directly and matches.

## `contract.ts`/`fonts.ts` diff verification

Read the real diff directly — no `Partial<...>`, no `any` cast, no
`@ts-expect-error` smuggled in. `RESOLVED_PAIRINGS` still closes with
`as const satisfies Record<TypePairingKey, ResolvedTypePairing>`
unmodified; `typecheck` passing independently confirms this holds for
real, not by construction of a weaker type.

## `docs/decisions.md` / `docs/TODO.md`

`DECISION-093` present, correctly numbered, matches the Phase 3 draft.
`docs/TODO.md` carries the `BrandPreviewSwatch` follow-up verbatim.

## Regression Tests Added

- `has exactly four curated pairings` — `fonts.test.ts:41-46` — guards a
  pairing being added to `contract.ts` and silently dropped from
  `RESOLVED_PAIRINGS`.
- `resolves %s to a font pairing without throwing` (parametrized ×4) —
  `fonts.test.ts:48-58` — guards each key, including `contemporary`,
  actually resolving to a real class name and CSS variable.
- `round-trips the new contemporary pairing to its own Montserrat/Open
  Sans CSS variables` — `fonts.test.ts:60-66` — guards `contemporary`
  pointing at the right font call, not a copy-paste of `warm`'s.

Data-layer coverage, not failing-then-passing (no bug — new-capability
Feature work, bug-fix discipline doesn't apply).

## Coverage on Critical Modules

Not applicable — this diff touches none of `permissions.ts`,
`two-factor.ts`, `flags.ts`. `contract.ts`/`fonts.ts` have new coverage
(64/64) but are outside the three named critical-coverage targets.

## Feature-Gate Audit

No new route or server action — confirmed by reading, not inferred.

| Route or action | `auth()` present? | `hasFeature(...)` present? | Correct `FEATURES.*` key? |
|-----------------|-------------------|----------------------------|----------------------------|
| `setOrganizationBrandAction` (existing, unmodified) | yes | yes | `FEATURES.ADMIN_ORGANIZATIONS` — correct |

`typePairing` validated via `isTypePairingKey()` (derives from
`TYPE_PAIRING_KEYS`/`TYPE_PAIRINGS`) — `contemporary` is automatically
valid with zero code change, read directly. Checked the specific gap
named in the task: `brand-form.tsx`'s `<select>` is
`{TYPE_PAIRINGS.map(...)}` — dynamically generated, not hardcoded to 3
options (same pattern in `/admin/design-system`). No gap — the fourth
option surfaces with zero component edits.

## Verdict

**PASS**

All required checks green and independently reproduced: typecheck clean,
all four tripwires clean, 1714/1714 of this diff's relevant tests
passing (the one suite failure traced conclusively to unrelated
concurrent work outside this diff's file list, since fixed separately),
`fonts.test.ts` genuinely exercises all 4 pairings, the live database
constraint confirmed by direct query, no type-weakening smuggle,
`DECISION-093` and the TODO line both present, feature-gate audit
confirms no new or under-gated surface.

**Handoff:** to analyst for Phase 6.

---

# Phase 6 — Shipped vs Intent (analyst)

## VERDICT

SHIP IT

## ONE-LINE TAKE

> The fourth curated pairing shipped exactly as Phase 3 designed it — data-only, mood-named, A10-validated at 360px in both schemes with a real regression test — and the only thing not yet true is the one thing this ticket never promised: FPCW's own organization row still reads `type_pairing = 'modern'`, so "shipped" here means the capability exists platform-wide, not that FPCW's real site is rendering in its own real fonts yet.

## What's Working

- **`contract.ts`'s `contemporary` entry reads as a fifth sibling, not a bolt-on.** All four `why` strings follow the same two-clause shape — heading-face claim plus explicit guardrail, body-face claim closing on "at the dense role." `contemporary`'s "Montserrat's geometric, even-stroke caps... without tipping into corporate or trend-chasing" mirrors `modern`'s register and length. `label` stays the mood word; family names live only in `why` — avoided in the actual shipped prose, not just the design doc.
- **The migration and DECISION-093 are real, not aspirational.** `drizzle/0022_presby_brand_pairing_expansion.sql` matches Phase 3's draft byte-for-byte; the live-DB constraint was independently re-queried: `CHECK ((type_pairing = ANY (ARRAY['classic', 'modern', 'warm', 'contemporary'])))` — confirmed live, not just in the SQL file. DECISION-093 present, correctly numbered, matches its stated reasoning.
- **Both deliberately-deferred follow-ups are still correctly open.** `BrandPreviewSwatch` line verbatim in `docs/TODO.md`. A repo-wide grep for "branch (b)"/"open font selection" turns up exactly one hit — DECISION-093's own sentence naming it rejected — confirming nothing implements it.
- **A10 was a real gate.** Computed-style reads (`Montserrat, "Montserrat Fallback"` — the self-hosted `next/font` fallback-naming convention, proving a real download happened), `scrollWidth === clientWidth` at 360px in both schemes, a synthetic 12px `micro`-role check.
- **`fonts.test.ts` earns its regression-test claim** — a dedicated round-trip test guards `contemporary` against pointing at the wrong font call (the actual failure mode this class of change is prone to).

## Intent-vs-Shipped Diff

- Phase 1 said: ship branch (a) only, mood-named. Shipped: exactly that. **Matches.**
- Phase 2 said: keep the mood-name convention, pick deliberately in Phase 3. Shipped: `contemporary`, with the `civic` rejection reasoning in DECISION-093. **Matches.**
- Phase 2/3 said: log the `BrandPreviewSwatch` gap separately, don't fold in or drop. Shipped: verbatim, correctly scoped. **Matches.**
- Phase 3 said: A10 is a real gate. Shipped: run against a real production build and browser with computed-style evidence. **Matches.**
- Phase 3 said: DECISION-093 prepended. Shipped: present, correctly numbered. **Matches.**
- Context said: this unblocks FPCW's real site using its real fonts. Shipped: the generic capability exists platform-wide; FPCW's own `organization_brands.type_pairing` is still `'modern'` (confirmed by direct query). **Acceptable drift, worth naming explicitly** — same shape as the org-creation ticket's own Phase 6 note about its real-org-row gap. Phase 1's resolved scope was narrowly "add the pairing," never "and set FPCW to it" — not a broken promise, but the ticket's own motivating reason isn't realized yet.

## Edge Cases

- Empty state: not applicable.
- Failure microcopy: pass — existing "Choose one of the curated type pairings." covers the fourth value with zero code change.
- Permission gate: pass — no new gate needed, confirmed unmodified.
- Audit event: pass — existing `ORG_BRAND_SET` logs `typePairing`, fourth value flows through the same path.
- Mobile (360px): pass — real production build, real Chromium, both color schemes, computed values recorded.

## Follow-Ups (if SHIP WITH NOTES)

Not a code follow-up — orchestrator action: **FPCW's real organization row (`slug = 'fpcw'`) is still on `type_pairing = 'modern'`.** The tool is done and correct; applying it to FPCW (switching the org's brand to `contemporary` via `/admin/organizations/[id]`'s existing `BrandForm`) is a separate, trivial admin action to take next — same pattern as the org-creation ticket's own real-org-row follow-up.

No `whats_new_entries` post warranted (Rule 13) — widens an admin-only enum, no member-visible change until an admin opts in. No feedback row to mark done (Rule 12) — originated from mid-task discovery, not in-app feedback. `docs/product/functionality-map.md`'s brand-theming line checked and needs no edit (names the mechanism generically, not a pairing count).
