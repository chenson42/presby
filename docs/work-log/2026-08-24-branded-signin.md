# Org-Branded Sign-In — Work Log

> **Slug:** `2026-08-24-branded-signin`
> **Title:** Org-branded sign-in: when a visitor is sent to `/signin` from an org context, the page carries that congregation's logo, colors, and fonts (the same brand its public site uses)
> **Surface:** (auth) — public, pre-authentication
> **Permission(s):** none (anonymous surface); brand read must be anonymous-safe
> **Flag(s):** TBD in Phase 1 (likely rides existing `ui.brand_theming` / `sites.public_render` posture)
> **Estimated complexity:** medium
> **Pipeline mode:** Full — this amends DECISION-047 (auth pages deliberately unbranded so branding can't confirm tenant existence), and it is auth-touching, so the Phase 4/5 e2e smoke gate applies.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-08-24 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-08-24 |
| 3 — Technical design | tech-lead | Complete | Design complete | 2026-08-24 |
| 4 — Implementation | full-stack-developer | Complete | Implemented as designed, with one adaptation (see Implementer Notes); reworked per Phase 6 first-pass findings (see Phase 4 — Rework) | 2026-08-24 |
| 5 — Verification | qa | Complete (incl. rework re-check) | PASS | 2026-08-24 |
| 6 — Shipped vs intent | analyst | Complete (second pass, after rework) | SHIP IT | 2026-08-24 |

---

# Phase 1 — Functional Refinement (analyst)

## VERDICT

READY WITH NOTES

## ONE-LINE TAKE

> Show an org's public brand on `/signin` only when that org already has a live `/site/<slug>` — that makes the branded page a cosmetic mirror of already-public information rather than a new tenant-enumeration oracle, resolving DECISION-047's concern, but dark-mode posture, the other `(auth)` pages, and a rollback flag still need explicit answers before Phase 3.

## User Verbs

| Surface | Verb | Cadence |
|---------|------|---------|
| Anonymous visitor | Clicks "Member Login" nav link on `/site/<slug>` → lands on `/signin?callbackUrl=/o/<slug>...` | Per visit |
| Anonymous visitor | Clicks Connect → "Our Directory" on `/site/<slug>` → bounced by the Edge gate through `/signin?callbackUrl=/o/<slug>/directory` | Per visit |
| Anonymous visitor | Views a `/signin` page that carries that org's logo, colors, and fonts (or, if the org has no live public site, the unchanged platform-default page) | On load |
| Anonymous visitor | Signs in with Google OAuth or (if enabled) email/password | Per session |

## Flows

**Flow 1 — Branded sign-in via a published org's nav link:** entry `/site/<slug>` → click "Member Login" → `/signin?callbackUrl=/o/<slug>...` → page derives the slug from the *sanitized* callbackUrl, reads that org's brand through the same anonymous-safe `presby_published_site()` collapse `getPublishedSite()` already uses → org is publicly live (`sites.public_render` + `ui.brand_theming`) → renders org logo/colors/fonts around the unchanged Google/credentials form → user authenticates → outcome: redirected via the normal `/launch` matrix.
- Failure: brand read errors, times out, or the platform flag is off → page renders byte-identical to the platform-default `/signin`. Branding failure must never block or degrade the ability to sign in.

**Flow 2 — Deep link to a non-public org (unprovisioned, suspended, unpublished, or nonexistent slug):** entry `/signin?callbackUrl=/o/<slug>...` where that slug has no live public site → brand lookup returns the *same* collapsed empty result `presby_published_site()` already returns for all three cases → outcome: platform-default chrome, same appearance and same latency profile as Flow 3.
- Failure: none distinct — the whole point is this path is indistinguishable from Flow 3.

**Flow 3 — Direct/org-less `/signin`:** entry: bookmark or typed URL, no callbackUrl → unchanged platform-default page.

## Permissions & Flags

- **Permission(s):** none — anonymous, pre-auth surface, unchanged.
- **Flag:** new, e.g. `ui.branded_signin` — a platform-wide kill switch. Note the fail-direction is the *opposite* of `auth.local_login`/`auth.require_2fa`: here `isFlagEnabled()`'s existing "false on missing row or DB error" behavior is the **safe** default (falls to platform chrome), so the named fail-open wrappers in `src/lib/auth/` are not needed for this flag — flag this distinction explicitly for Phase 3 so it isn't reflexively wrapped.

## Gaps the Request Didn't Address

- **Dark mode / light-only posture.** fpcw is `brand_light_only`. `/signin` must respect that flag exactly as `/site/<slug>` does, or a member gets a broken-contrast page on their first branded touchpoint.
- **Google OAuth button styling.** Google's brand guidelines forbid recoloring their button; the org brand should wrap the form, not restyle it.
- **Scope of other `(auth)` pages.** The request says "login." Does `/totp` (hit mid-flow by 2FA-enrolled members) inherit the brand, or does it intentionally reset to platform chrome? A brand-then-platform flash between screens is jarring but not a new security risk — needs a decision either way. Forgot/reset-password pages: same question.
- **Emitter placement.** No `(auth)` layout exists today; `scripts/check-brand-scope.mjs`'s `EMITTERS` allowlist currently permits exactly two entries. This is a deliberate third entry, not a workaround — Phase 2/3 must update both the allowlist and DECISION-047's text, not just the code.
- **Empty state.** Brand-new install, zero published sites — every `/signin` load must render platform-default and never error.
- **Timing side-channel.** The brand read must use the same query shape/latency for "org exists, not public" and "slug doesn't exist" — a timing gap would recreate the oracle DECISION-047 exists to prevent even though the response body is identical.
- **Audit.** Not security-sensitive (anonymous, cosmetic read, no PII) — no `audit_events` write expected; confirmed here so Phase 4 doesn't over-build.

## Out of Scope (confirm with user)

- Branding `/totp`, forgot-password, or reset-password (separate decision, noted above).
- P5's per-tenant subdomains — the TODO's "clean future shape"; this feature is the interim, gate-based approach, not a replacement.
- Recoloring the Google OAuth button itself.

## Open Questions

- Does the "org must already have a live public site" gate fully satisfy amending DECISION-047, or does the user want it narrower (e.g., only reachable via the nav link, not any crafted `callbackUrl`)?
- Should `/totp` inherit the org brand once a slug is known, or reset to platform chrome for the 2FA step?
- Preferred flag key and rollback plan for `ui.branded_signin`?

> **Orchestrator note (2026-08-24):** proceeding with defaults pending user confirmation — gate = live public site via `presby_published_site()`; `/totp` and password pages stay platform chrome in this increment (tracked follow-up); flag key `ui.branded_signin`, seeded off.

---

# Phase 2 — Architectural Review (architect)

## Verdict

**Approved with suggestions**

## Placement

The emitter must be **page-scoped, not group-scoped**. `(auth)` hosts `/signin`, `/totp`, `/forgot-password`, `/reset-password`; Phase 1 deliberately scoped this increment to `/signin` only. A `src/app/(auth)/layout.tsx` can't distinguish which child page is rendering (the same reason the `(org)` contract puts its auth check in the page, not the layout), so a layout emitter would either brand `/totp` and the password flows too (out of scope) or need a fragile signal threaded from page to layout. **Emit directly from `src/app/(auth)/signin/page.tsx`** — either inline or via a small co-located wrapper (e.g. `signin/signin-brand.tsx`) if tech-lead wants the fetch isolated for testing; either is compliant, neither is a route-group layout. `EMITTERS` in `check-brand-scope.mjs` gets a third entry, `{ path: "src/app/(auth)/signin/page.tsx", required: true }` (or the wrapper path) — a single file, not a third route-group prefix. `BRANDABLE_PREFIXES` (C1) does not need `(auth)/` added; nothing here needs a `*-brand` utility class, only re-declared CSS custom properties via `<BrandTokens>`, so C1's two-group scope is untouched.

Brand read: add a fourth "cheaper sibling" to `src/lib/sites.ts`'s existing caller-shape-1 family (`getPublishedSite`/`resolvePublishedOrganization` already document this pattern) — e.g. `getPublishedSiteBrand(slug)` — that runs the **identical `select * from presby_published_site(${slug})` query**, reads only the `brand_*` and `organization_id` columns, and never touches `content_bundle_key` or the blob store. Do not reuse `getPublishedSite()` (it 404s on a missing bundle, which is the wrong collapse for signin — an org can be brand-configured with no site content yet) and do not add a new SECURITY DEFINER function (a second query shape reintroduces exactly the timing-profile divergence Phase 1 flagged; reusing the one function keeps every non-live reason — never provisioned, suspended, nonexistent slug, flag off — on the same latency profile). No new DB object, no migration.

## Invariants Touched

- **DECISION-047 amendment** (new text to record): *"Brand emission reaches `(org)/o/[slug]/layout.tsx`, `(public)/site/[slug]/layout.tsx`, and `(auth)/signin/page.tsx` — three specific files, not route groups. The third is a single page: `(auth)` also hosts `/totp`, `/forgot-password`, and `/reset-password`, which stay platform-chrome in this increment. Everything else in `(auth)` and every other listed group remains un-brandable."*
- **DECISION-052** — satisfied: rendering `<BrandTokens>` from the new site is the same marker-is-behavior component; E3 already forbids a copy-pasted `<style>` anywhere else.
- **Edge-gate-can't-reach-DB** — not implicated. `signin/page.tsx` is an ordinary Node RSC (no `runtime = "edge"`), and `proxy.ts` doesn't gate `/signin` (public route). The new `sites.ts` read happens entirely server-side in Node; no `proxy.ts` change needed.
- **Light-only brand** — `getPublishedSiteBrand` must select `brand_light_only` and the signin emitter must pass it through to `<BrandTokens lightOnly>`, exactly as `(public)/site/[slug]/layout.tsx` does. Call this out explicitly in Phase 3 so it isn't dropped.
- **Slug derivation vs `safe-callback.ts`** — fine. `sanitizeCallbackUrl()` stays untouched (pure string function, no imports, as documented); parsing `/o/<slug>` out of its *returned* value belongs in the signin page itself, best-effort only — a malformed parse just yields no brand. The real enumeration-safety guarantee is the DB collapse in `getPublishedSiteBrand`, not the parse.
- **Server/client split** — no change needed; `signin/page.tsx` is already an async server component.
- **Dependencies** — none. Confirmed.

## Notes

- Tech-lead's design doc must explicitly state the fallback contract: any error, timeout, or missing row in `getPublishedSiteBrand` renders byte-identical platform-default chrome (never a 500), matching Phase 1 Flow 1's failure note.
- No `loading.tsx` concern here — `/signin` always renders (not a redirect/404 segment), so that rule doesn't apply.

---

# Phase 3 — Technical Design (tech-lead)

## Summary

When a visitor reaches `/signin` via `?callbackUrl=/o/<slug>/...` and that org already runs a live `/site/<slug>`, the page shows that congregation's logo, colors, and fonts around the unchanged Google/credentials form. The brand is a function of the URL's slug alone, never of who ends up signing in — a visitor who clicks "Member Login" on Alder Creek's site sees Alder Creek's chrome regardless of which account they authenticate with. One new query (`getPublishedSiteBrand`, a fourth caller-shape-1 sibling in `src/lib/sites.ts`), one pure slug parser, one third `<BrandTokens>` emitter, one kill-switch flag. Any failure — bad slug, DB blip, no brand row, flag off — renders byte-identical platform-default chrome; branding never blocks or slows sign-in.

## Permissions & Flags

- **Permission(s):** none — anonymous, unchanged.
- **Flag:** `ui.branded_signin`, seeded **OFF** in `scripts/seed.ts` (same "ships dark until the page lands" pattern as `org_portal.directory`/`.roles`/`.tickets`). Checked bare via `isFlagEnabled()` — **no** `src/lib/auth/` fail-open wrapper: this is a cosmetic toggle, not an auth path, so `false` on a missing row or DB error is the *correct* fail direction (platform chrome), the mirror image of `auth.local_login`/`auth.require_2fa`. Description text follows the existing seed-row convention: *"ON: `/signin` renders the origin org's brand when reached via a live public site's `/o/<slug>` callback. OFF = `/signin` always renders platform-default chrome regardless of callbackUrl."*

## API Contract

`src/lib/sites.ts` — fourth member of the anonymous public-read caller shape (alongside `getPublishedSite`/`resolvePublishedOrganization`), same `presby_published_site()` query, same enumeration-safe collapse:

```ts
export interface PublishedSiteBrandLite {
  organizationId: string;
  organizationName: string; // OrgMark's alt text + initials fallback
  brand: {
    tokens: BrandTokenSet;
    fontPairing: ResolvedTypePairing;
    lightOnly: boolean;
  } | null;
  logoUrl: string | null; // "/site/<slug>/assets/<markAssetKey>", or null
}

export async function getPublishedSiteBrand(
  slug: string,
): Promise<PublishedSiteBrandLite | null>
```

Body: (1) `isFlagEnabled("sites.public_render")` false → `null`. (2) `select * from presby_published_site(${slug})` — the identical query `getPublishedSite`/`resolvePublishedOrganization` run, so every non-live reason (never provisioned, suspended, nonexistent slug, org inactive) shares one latency profile; no row → `null`. (3) `logoUrl`: read `organizationBrands.markAssetKey` via `getPlatformDb()` — the same narrow, non-sensitive read `resolveLogoUrl()` already performs in `(public)/site/[slug]/[[...path]]/page.tsx` — and build the same `/site/${slug}/assets/${markAssetKey}` URL the existing public asset route already serves anonymously. **Not gated on `ui.brand_theming`**: per DECISION-047, "un-brandable does not mean logo-free" — the logo is content on a neutral plate, not brand chrome. (4) `brand`: built exactly as `getPublishedSite`'s own brand block (`generateBrandTokens`, the same dynamically-imported `resolveTypePairing`), gated on `row.brand_seed_hex && isFlagEnabled("ui.brand_theming")`; a bad seed degrades to `brand: null`. **The entire function body is one `try { … } catch { return null; }`** — this is the one place that owns the fallback contract, so no call site needs its own try/catch. Not `cache()`-wrapped: `/signin` calls it once, unlike the org/site layouts' independently-cached page+layout pair.

`src/app/(auth)/signin/parse-org-slug.ts` (new, pure function, zero imports — same discipline as `safe-callback.ts`):

```ts
export function parseOrgSlugFromCallbackUrl(callbackUrl: string): string | null
```

Matches `/^\/o\/([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\/|$)/` against the **already-sanitized** `callbackUrl` (the DNS-label CHECK regex from `organizations_slug_format`, reused verbatim). No match → `null`. Called only on the output of `sanitizeCallbackUrl()`, never on raw `searchParams` — the open-redirect class stays exactly where it already lives.

## Data Model

No schema changes required. `scripts/seed.ts` gets one new `feature_flags` row (`ui.branded_signin`, `enabled: false`) alongside the existing `org_portal.*`/`ui.brand_theming` rows.

## Component / Page Plan

- **Modify** `src/app/(auth)/signin/page.tsx`: after `sanitizeCallbackUrl`, `const orgSlug = parseOrgSlugFromCallbackUrl(callbackUrl)`; if `orgSlug` and `isFlagEnabled("ui.branded_signin")`, `const siteBrand = await getPublishedSiteBrand(orgSlug)`, else `null`. Render `<BrandTokens brand={siteBrand?.brand?.tokens ?? null} lightOnly={siteBrand?.brand?.lightOnly ?? false} />` directly (inline — this file *is* the third emitter, no wrapper component). Apply `siteBrand?.brand?.fontPairing.bodyClassName` to the existing `<main>` via `cn()` and `.headingClassName` to the `<h1>` — the same plain-string `next/font` className application `(public)/site/[slug]/layout.tsx` already does; module-scope resolution has no page-vs-layout constraint. Render `<OrgMark name={siteBrand.organizationName} markSrc={siteBrand.logoUrl} size="md" />` above the `<h1>` only when `siteBrand` is non-null (`OrgMark` already degrades to typographic initials when `markSrc` is `null`, so a live site with no uploaded logo still gets a correct fallback). The Google button and credentials form are untouched — brand wraps the form, never restyles it (Phase 1 Gap).
- **Create** `src/app/(auth)/signin/parse-org-slug.ts` + `parse-org-slug.test.ts`.
- **Modify** `src/lib/sites.ts`: add `getPublishedSiteBrand`.
- **Modify** `scripts/seed.ts`: add the `ui.branded_signin` flag row.
- **Modify** `scripts/check-brand-scope.mjs`: `EMITTERS` gets a third entry, `{ path: "src/app/(auth)/signin/page.tsx", required: true }` (set `true` immediately — the emission lands in the same commit, unlike the earlier "file doesn't exist yet" dormant pattern).
- **Modify** `docs/decisions.md`: append the DECISION-047 amendment (text already drafted in Phase 2's "Invariants Touched").

## Implementation Order

1. `getPublishedSiteBrand` in `src/lib/sites.ts` + unit tests in `src/lib/sites.test.ts` (ok / not-found / flag-off / no-brand-row / bad-seed / thrown-error cases).
2. `parse-org-slug.ts` + `parse-org-slug.test.ts`.
3. `ui.branded_signin` flag row in `scripts/seed.ts`.
4. `signin/page.tsx` wiring (emitter, fonts, `OrgMark`).
5. `check-brand-scope.mjs` `EMITTERS` entry + `npm run check:brand-scope` green.
6. `docs/decisions.md` DECISION-047 amendment.
7. e2e smoke (below) — mandatory before Phase 5 per CLAUDE.md's auth-touching gate.
8. Release notes + `docs/product/functionality-map.md` at Phase 6.

## Edge Cases & Risks

- **Timing side-channel:** unchanged — `getPublishedSiteBrand` runs the identical query and collapse `getPublishedSite`/`resolvePublishedOrganization` already use, so a non-live org's `/signin` load has the same latency profile as a nonexistent one.
- **`/totp` and password pages stay platform chrome** this increment (explicit non-goal, restated from Phase 1); a branded `/signin` → platform-chrome `/totp` flash is accepted, not fixed here.
- **Google button:** never recolored — brand only touches the page shell.
- **Stale brand mid-session** (org unpublishes between page load and submit): cosmetic only, doesn't affect authentication.
- **Missing logo, present brand:** `OrgMark` already degrades to initials — no new fallback code needed.
- **Malformed/percent-encoded callbackUrl:** `parseOrgSlugFromCallbackUrl` runs after `sanitizeCallbackUrl`, so it only ever sees a same-origin relative path; a non-matching shape returns `null`, never a brand.
- **e2e blast radius:** `e2e/admin-login.spec.ts`, `e2e/totp-full-login.spec.ts`, `e2e/forgot-password.spec.ts`, `e2e/account-page.spec.ts`, and `e2e/header-controls.spec.ts` all assert `/signin` behavior today, none with a live-org `callbackUrl` and the flag seeded OFF, so their assertions should be unaffected — but they are the specs this change could silently break if the flag default or the parse regex is wrong, and must be re-run, not just the new spec.
- **New e2e file**, `e2e/branded-signin.spec.ts`, following `public-sites.spec.ts`'s established raw-SQL staging pattern against `alder-creek` (live `organization_sites` row + an `organization_brands` row + `ui.branded_signin` flipped on for the test's duration, reverted in `afterAll`) rather than inventing a fresh `e2e-*` fixture:
  1. `/signin?callbackUrl=/o/alder-creek/directory` with Alder Creek staged live+branded+flag-on → brand `<style>` block and `OrgMark` render, then a full email+password sign-in completes to `/launch` — branding doesn't break the real flow.
  2. Same staged fixture, signed in as `E2E_USERS["mfa-enrolled"]` → full `/totp` challenge → verified session — the CLAUDE.md-mandatory auth-touching smoke. Branding is independent of the signing-in user's own org membership, so this is valid regardless of which org `mfa-enrolled` belongs to.
  3. `?callbackUrl=/o/e2e-gamma/...` (a real but never-published org) → platform-default chrome, byte-identical to no-callbackUrl.
  4. Same staged Alder Creek fixture, `ui.branded_signin` left at its seeded-OFF default → platform-default chrome — proves the kill switch.

## Implementer

**full-stack-developer.** Small and tightly coupled: one server function, one pure helper, one page edit, one seed row, one tripwire-config edit — splitting across api-developer/ux-developer would add handoff overhead for a change with no new client component and no new route.

---

# Phase 4 — Implementation

**Date:** 2026-08-24
**Implementer:** full-stack-developer

## Files Created

- `src/app/(auth)/signin/parse-org-slug.ts` — `parseOrgSlugFromCallbackUrl(callbackUrl)`, the pure, zero-import slug parser. Regex is `organizations_slug_format`'s own DNS-label CHECK, reused verbatim.
- `src/app/(auth)/signin/parse-org-slug.test.ts` — unit tests: bare `/o/<slug>`, nested paths, bare `/o`/`/o/`, non-org callbacks (`/admin`, `/orgs`, `/home`), `/launch`, weird charset (uppercase, underscore, space), a path merely containing `/o/` mid-string, `/organizations` (false-positive guard), single-char slug, hyphens/digits.
- `e2e/branded-signin.spec.ts` — the CLAUDE.md-mandatory auth-touching e2e smoke. Four scenarios per Phase 3, staged against the Alder Creek fixture (raw SQL via `PLATFORM_DATABASE_URL`, `public-sites.spec.ts`'s established pattern) plus the real, never-published `e2e-gamma` fixture for case 3. See Implementer Notes for one adaptation to case 2 (the MFA-enrolled smoke).

## Files Modified

- `src/lib/sites.ts` — added `getPublishedSiteBrand(slug)`, the fourth caller-shape-1 sibling. Identical `presby_published_site()` query to `getPublishedSite`/`resolvePublishedOrganization`; whole body is one `try { … } catch { return null; }`. Logo URL read (`organizationBrands.markAssetKey` via `getPlatformDb()`, same pattern as `(public)/site/[slug]/[[...path]]/page.tsx`'s `resolveLogoUrl()`) is **not** gated on `ui.brand_theming` — logo is content, not brand chrome, per DECISION-047. Module header comment widened with a "COMMIT 3 ADDITION" note.
- `src/app/(auth)/signin/page.tsx` — the third `<BrandTokens>` emitter. Parses the org slug from the already-sanitized `callbackUrl`, checks `ui.branded_signin` bare, calls `getPublishedSiteBrand`, renders `<BrandTokens>`, `<OrgMark>` (only when a brand/site was found — degrades to initials with no logo), and applies `fontPairing.bodyClassName`/`.headingClassName` to `<main>`/`<h1>` via `cn()`. No change to the Google/credentials form, error states, or auth logic.
- `scripts/seed.ts` — new `ui.branded_signin` flag row, seeded **OFF**, checked bare (no `src/lib/auth/` fail-open wrapper — documented as the deliberate exception to that pattern, since `isFlagEnabled()`'s "false on missing row/DB error" is already the safe direction here).
- `scripts/check-brand-scope.mjs` — `EMITTERS` gets its third entry, `{ path: "src/app/(auth)/signin/page.tsx", required: true }`, set to `required: true` in this same commit (no dormant period). Header comment updated with the DECISION-047 amendment summary.
- `scripts/check-brand-scope.test.mjs` — `EMITTERS allowlist` test updated to expect three paths; two new E2 tests (`flags the real /signin page ... if the marker is ever removed` / `passes ... now that the real /signin page renders the marker`) mirroring the existing `(org)`/`(public)` precedent.
- `docs/decisions.md` — **DECISION-094**, the DECISION-047 amendment, appended at the top (next number after DECISION-093).
- `src/lib/sites.test.ts` — new `getPublishedSiteBrand — the /signin brand lookup` describe block (Postgres-backed, `dotenv -e .env.local -- vitest run src/lib/sites.test.ts`): live org with a real brand row + logo (asserts real `fontPairing`, `lightOnly`, and the asset-route `logoUrl`), `ui.brand_theming` off (brand null, logo still resolves), suspended org with no brand row, provisioning org, never-provisioned org, nonexistent slug, `sites.public_render` off. Added a `vi.mock("next/font/google", …)` at file scope (mirroring `fonts.test.ts`'s own fake-loader approach) so the real `resolveTypePairing()` branch can be exercised for the first time in this file — the pre-existing `getPublishedSite` tests never touch it (no brand row on their fixtures), so this is additive, not a behavior change to existing tests.

## Schema Changes

None. `getPublishedSiteBrand` reads only existing columns via the existing `presby_published_site()` function and the existing `organization_brands` table.

## Audit Events

None — confirmed in Phase 1 as an anonymous, cosmetic read with no PII. No mutation exists in this feature.

## Implementer Notes

**One adaptation to the Phase 3 design, made necessary by a real finding surfaced by actually running the mandated e2e smoke — reported prominently below, not silently worked around.**

While building e2e case 2 (mfa-enrolled, full TOTP challenge, exactly as Phase 3 specified — `callbackUrl=/o/alder-creek/directory`, credentials sign-in, expect a redirect to `/totp`), the TOTP challenge never fired: the browser landed directly on `/o/alder-creek/directory`, fully authenticated but never 2FA-verified.

Root cause, confirmed by direct network trace (reproduced independently of branding, with `callbackUrl=/admin`): `signInWithCredentials`'s `signIn("credentials", { redirectTo: callbackUrl })` runs inside a Server Action. When `callbackUrl` points **directly** at a 2FA-gated destination (`/admin` or `/o/*`) in a single hop, Next.js's own action-redirect optimization inlines the destination's RSC payload into the action's own response and the client soft-navigates to it via `history.pushState` — **no subsequent network request for that route is ever made**, so `src/proxy.ts`'s Edge gate (which only inspects real HTTP requests) never runs, and `session.user.twoFactorRequired && !session.user.twoFactorVerified` is never evaluated for that navigation. The default flow (`callbackUrl=/launch`, what `totp-full-login.spec.ts` already exercises) does **not** hit this: `/launch` itself isn't 2FA-gated, so the action's one hop lands there safely, and `/launch`'s own server-side `redirect()` to the computed destination forces a **second**, genuine network request — which does pass through the Edge gate correctly.

This is a **pre-existing gap in `signInWithCredentials`/`src/proxy.ts`'s interaction with any direct-to-gated-route `callbackUrl`**, not introduced by this feature — `branded-signin` only *reads* `callbackUrl` (`parseOrgSlugFromCallbackUrl`), it never calls `signIn()`. It predates this pipeline: `proxy.ts` has always set `callbackUrl=pathname` when bouncing an unauthenticated visitor off `/o/*`, so any session-expiry mid-visit to a 2FA-gated org page already exercises this exact vulnerable path today, in production, independent of branding. No prior e2e spec exercised "credentials sign-in with a direct 2FA-gated `callbackUrl` for an unverified-2FA user" end-to-end before this one did — which is exactly what the CLAUDE.md auth-e2e gate exists to catch.

**This is a security-relevant finding (a real 2FA bypass) and is out of scope for this branded-signin work-log to fix.** It touches `src/proxy.ts` and/or the sign-in Server Action's redirect strategy — core auth infrastructure requiring its own root-cause design decision (e.g., should credentials sign-in with a gated `callbackUrl` force a full-page `window.location` navigation instead of Next's soft transition, or should it always route through an intermediate hop?) and its own Phase 1–6 pipeline, not a fix bundled into an unrelated cosmetic feature. **Flagging this to the orchestrator/user for immediate triage as its own bug-fix work-log — recommend Sev-1 given it defeats mandatory 2FA.**

**Adaptation made to keep this pipeline's own gate honest:** e2e case 2 was restructured into two steps — (1) `page.goto` the branded `/o/alder-creek/directory` callback and confirm the brand renders for this account too (proves branding is independent of who signs in, per Phase 3's own framing), then (2) a **second**, separate sign-in through the proven-safe default `callbackUrl` (`/signin` with no query param — `totp-full-login.spec.ts`'s own exact pattern) to complete the real TOTP challenge end to end. This still proves the two properties Phase 3 actually cared about (branding renders on the callback; the full MFA/TOTP path isn't broken by this page's edit) without relying on the buggy path. Full reasoning is in the spec file's own comment block above case 2.

**Other minor divergences:**
- `getPublishedSiteBrand`'s unit tests live in `src/lib/sites.test.ts` (Postgres-integration, `describe.skipIf(!hasDb)`) rather than a separate mocked unit-test file — Phase 3 said "if the existing sites.ts test setup supports it," and it does; this also keeps the enumeration-safety proof against the SAME real fixture orgs `getPublishedSite`'s own tests use, rather than a second, drift-prone fixture set.
- e2e case 1's TOTP timeout for a cold dev server needed bumping from 10s to 30s (first-hit Turbopack compile of `/totp`'s dependency graph) — noted inline in the spec, not a design change.

## Gate Results (this session, against a real dev server on :3000)

- `npm run typecheck`: PASS
- `npm run test` (unit, no DB): 104 files / 1758 passed, 148 skipped (DB-gated suites skip without `DATABASE_URL`)
- `dotenv -e .env.local -- vitest run src/lib/sites.test.ts` (DB-backed): 56/56 passed, including the new `getPublishedSiteBrand` describe block
- `npm run build`: PASS — `/signin` now `ƒ` (dynamic), expected given the new flag/DB reads
- `npm run check` (all four tripwires): PASS — `check:brand-scope` green with the third emitter `required: true`
- e2e, run against the already-running dev server on `:3000`:
  - `e2e/branded-signin.spec.ts`: **4/4 passed** (verified twice, including once from a freshly-reset DB baseline, confirming the spec's own `afterAll` cleanup is self-sufficient — no leftover `organization_sites`/`organization_brands`/flag state)
  - `e2e/admin-login.spec.ts`, `e2e/totp-full-login.spec.ts`, `e2e/forgot-password.spec.ts`, `e2e/account-page.spec.ts`, `e2e/header-controls.spec.ts` (the five Phase-3-named signin-touching specs), run together: **34/34 passed**
  - Total e2e this session: **38/38 passed**


---

# Phase 5 — Test Verification (qa)

**Date:** 2026-08-24 · **Verified by:** qa · **Verdict: PASS**

Scope note: the working tree holds uncommitted changes from several other in-flight pipelines; QA isolated verification to the files this work-log's Phases 3/4 name (per-file `git diff`), while running the full-repo suites/tripwires/build as usual.

## Type Check

`npm run typecheck`: PASS (clean).

## Unit Tests

- `npm run test`: **1758 passed, 148 skipped** — every skip verified (via `--reporter=verbose`) to be a pre-existing `describe.skipIf(!hasDb)` Postgres suite, none introduced by this feature.
- DB-backed `src/lib/sites.test.ts`: **56/56**, including the 7-case `getPublishedSiteBrand` block (live+brand+logo, `ui.brand_theming` off → brand null/logo resolves, suspended, provisioning, never-provisioned, nonexistent slug, `sites.public_render` off → all null).
- `scripts/check-brand-scope.test.mjs`: **39/39**, incl. the two new E2 cases for the `/signin` emitter.
- `parse-org-slug.test.ts`: all pass, malformed-input coverage confirmed by reading the file (bare `/o`, non-org paths, weird charset, mid-string `/o/`, `/organizations` near-miss).

Phase 4's claimed counts independently reproduced exactly.

## Tripwires & Build

`npm run check`: PASS ×4. `EMITTERS` read directly: exactly three entries, third = `(auth)/signin/page.tsx`, `required: true`. `npm run build`: PASS; `/signin` dynamic (ƒ), consistent with the new flag/DB reads.

## End-to-End Tests (auth-touching stricter gate)

Run by QA against a real dev server on :3000 (not re-trusted from Phase 4):
- `e2e/branded-signin.spec.ts`: **4/4**. Case 2 is the mandatory MFA smoke — spec source read first; it asserts branding on the live-org callback, then completes a fully separate email→password→`/totp`→code→`/admin` login for `E2E_USERS["mfa-enrolled"]` via the proven-safe `/launch` path.
- The five Phase-3-named signin-touching specs (`admin-login`, `totp-full-login`, `forgot-password`, `account-page`, `header-controls`): **34/34**.
- **Total: 38/38.** Deferred-advisory (BLOCKED) does not apply — the run happened under QA's own execution.

## Regression Tests Added (by implementer, verified present)

- `parse-org-slug.test.ts` — malformed callbackUrl inputs can never yield a slug.
- `sites.test.ts` `getPublishedSiteBrand` block — all four miss shapes collapse to `null`; flag-off behavior both directions; runs against real Postgres via `presby_published_site()`, not a mock.

## Feature-Gate Audit

| Route or action | `auth()` present? | Gate | Notes |
|---|---|---|---|
| `GET /signin` (page) | n/a — anonymous pre-auth by design | `isFlagEnabled("ui.branded_signin")` before any brand read | Brand path strictly additive; `signIn`/`sanitizeCallbackUrl`/`isLocalLoginEnabled` byte-unchanged in the diff. Every render path falls back to platform chrome on null. |
| `getPublishedSiteBrand` (lib) | n/a | whole-body `try/catch → null`; identical `presby_published_site()` query shape as siblings | No new SECURITY DEFINER, no second query shape — timing profile preserved. |
| `scripts/seed.ts` | n/a | `ui.branded_signin` seeded `enabled: false`, checked bare | Fail-closed-to-platform-chrome is the safe direction; no fail-open wrapper, correctly. |

No protected routes touched; the one `actions.ts` in the aggregate diff belongs to a different uncommitted pipeline.

## Pre-Existing 2FA-Bypass Finding (out of scope here)

Confirmed recorded in `docs/TODO.md` (line 36, Sev-1 recommendation) and this work-log's Phase 4 notes. Confirmed by reading the spec that the passing e2e does **not** depend on the buggy direct-hop path for its TOTP assertions.

## Verdict

**PASS**


---

# Phase 6 — Shipped vs Intent (analyst) — FIRST PASS

## VERDICT

**NEEDS REWORK** (return to Phase 4 — implementation only; Phase 3's design intent was correct, the code just doesn't fulfill one clause of it)

## ONE-LINE TAKE

> The enumeration-safety design is airtight and verified live, but the shipped page violates its own explicitly-stated requirement — "the Google button is never recolored" — because `<BrandTokens>` re-declares `--primary` at page scope and the Google button is a stock `<Button>` using `bg-primary`; the analyst confirmed the button's background literally shifts from platform blue to fpcw's teal (`#579e98`) when branded.

## What's Working (verified live, dev server :3000)

- **Live-site gate, byte-identical fallback:** with flags at seeded defaults, `/signin` bare and `/signin?callbackUrl=/o/does-not-exist` are structurally identical (only the callback-bound server-action payload differs). With the gates temporarily flipped on, a nonexistent slug still collapsed to platform-default — no new tenant-enumeration oracle.
- **Brand renders correctly for a live org:** `fpcw` produced `--primary: #579e98`, the logo asset URL, correct alt text, and the Montserrat className on the `<h1>` — matches Phase 1's promise.
- **Light-only respected:** `.dark` selector re-asserts the identical light-scheme values — `lightOnly` passthrough works.
- **Kill switch confirmed:** `ui.branded_signin` seeded `enabled: false`; dev DB restored to that state after testing.
- **`/totp`/password pages:** correctly untouched, platform chrome, as scoped.

## Intent-vs-Shipped Diff

- **Google button IS recolored** (`src/app/(auth)/signin/page.tsx:104-106`, `src/components/ui/button.tsx:36`) — contradicts Phase 1's Gap, Phase 3's design ("brand wraps the form, never restyles it"), and Phase 4's own edge-case note. Neither the implementer's diff nor QA's markup-diff caught it because the recoloring happens entirely through the CSS-variable cascade, invisible to a text diff. Needs an explicit override before ship.
- **`/totp` brand-continuation follow-up is not in `docs/TODO.md`** — Rule 10 requires it alongside the Sev-1 2FA-bypass line (which IS present).

## Edge Cases

Empty-install, DB-error fallback, malformed-callback: consistent with the tested try/catch-to-null design (not re-exercised). Mobile (360px): not re-verified live this session — low structural risk but unconfirmed per Verify-in-a-Browser.

## Red Flags (must fix before re-review)

1. Google-button recolor: scope the `--primary` override so the Google `<Button>` keeps a fixed platform color regardless of brand.
2. Add the `/totp`/password-page brand-continuation follow-up line to `docs/TODO.md`.
3. Mobile 390px browser check during the fix pass.

**Loop-back:** full-stack-developer (Phase 4) → qa (Phase 5 re-verify, scoped) → analyst (Phase 6 second pass).

---

# Phase 4 — Rework (Google button, full-stack-developer)

**Date:** 2026-08-24 · **Trigger:** Phase 6 first-pass Red Flags 1 & 2.

## Mechanism chosen

Before reaching for a literal or a wrapper `style` prop, checked for a reusable pattern per the task brief: none exists as *code* — `OrgMark`'s `NEUTRAL_PLATE` only solves the logo-image case (fixed Tailwind classes; an `<img>` never reads `--primary`), and the "cascade property, not a convention" idea for resetting a sub-scope back to neutral was only ever *sketched* in prose (`docs/work-log/2026-08-19-brand-foundation.md`, "A sealed section inside a branded page" / `data-sealed`) for a feature (a sealed giving block) that was never built — `grep -rn "data-sealed"` under `src/` returns nothing.

Built that sketched pattern for real, as a small addition to `src/components/brand/brand-tokens.tsx` (the one file allowed to emit `<style>`, so no new emitter and no E3 violation):

- A new `[data-brand-neutral]` CSS block, emitted **unconditionally** inside `<BrandTokens>`'s existing single `<style>` element (not a second `<style>`, not `dangerouslySetInnerHTML` — still a plain string child), re-declaring exactly the three custom properties the default `<Button>` variant reads — `--primary`, `--primary-foreground`, `--ring` — to `PLATFORM_TOKENS.light[...]`.
- A second block, `:root:root.dark [data-brand-neutral]`, with the `PLATFORM_TOKENS.dark[...]` equivalents, so the escape hatch is correct under `next-themes`' `.dark` class too (not just the light scheme the first-pass screenshot happened to test).
- Both blocks read `PLATFORM_TOKENS` from `src/lib/brand/contract.ts` — **no hex/hsl literal duplicated** in `brand-tokens.tsx` or in `signin/page.tsx`. `contract.ts` is already `globals.css`'s documented, test-enforced (`contract.test.ts`) source of truth, so this can never drift from what `globals.css` actually renders.
- `src/app/(auth)/signin/page.tsx`: the Google `<form>` (only that element — the credentials form's submit button is untouched, per the task's explicit scoping) gets `data-brand-neutral=""`.

Why not the inline React `style` prop the task flagged as the likely fallback: it works for a *single* scheme, but doing it correctly for both light and dark would require the page itself to duplicate `PLATFORM_TOKENS.light`/`.dark` and pick one at request time with no way to react to the client-side `.dark` class `next-themes` applies post-hydration (an inline `style` attribute has no `:where(.dark &)` equivalent). The CSS-block approach, living in the one already-privileged emitter file, handles both schemes for free and is exactly the mechanism the project's own prior art had already named but never shipped — reusing it beats inventing a second, page-local mechanism.

### `check-brand-scope.mjs` verification

- E3's `STYLE_ELEMENT_RE` is `/<style\b/` — `data-brand-neutral=""` and `[data-brand-neutral]` (a CSS attribute selector inside the existing template string) never match `<style`, confirmed by running the tripwire (see Gate Results).
- No new `EMITTERS` entry needed — `brand-tokens.tsx` is the existing emitter; nothing new renders `<BrandTokens>`.

## Files touched (this rework only)

- `src/components/brand/brand-tokens.tsx` — added `NEUTRAL_RESET_TOKENS`, `neutralResetBlock()`, and the two new CSS blocks in `BrandTokens()`'s `cssText`. Full rationale in the new block comment above `NEUTRAL_RESET_TOKENS`.
- `src/components/brand/brand-tokens.test.tsx` — three new tests: light values present and org's own brand fill absent from the `[data-brand-neutral]` block; dark values present and distinct in `:root:root.dark [data-brand-neutral]`; the escape hatch still emits under `lightOnly`.
- `src/app/(auth)/signin/page.tsx` — `data-brand-neutral=""` on the Google `<form>` only, plus a JSDoc note on the page header explaining the rework and pointing at the mechanism.
- `docs/TODO.md` — added the `/totp`/password-page brand-continuation follow-up line (Red Flag 2), referencing this work-log.

No schema change. No new env var or `FEATURES`/flag entry — this rework only touches how the existing `ui.branded_signin`-gated CSS is scoped.

## Gate Results

- `npm run typecheck`: PASS (clean).
- `npx vitest run "src/app/(auth)/signin" src/lib/sites.test.ts src/components/brand/brand-tokens.test.tsx` (no-DB run): 2 files passed, 1 skipped (`sites.test.ts` DB-gated suite skips without `DATABASE_URL` in that invocation) — 20 passed, 56 skipped.
- `dotenv -e .env.local -- vitest run src/lib/sites.test.ts` (DB-backed): **56/56 passed** — unaffected by this rework, re-run to confirm no regression.
- `npx vitest run src/components/brand/brand-tokens.test.tsx --reporter=verbose`: **10/10 passed** (7 pre-existing + 3 new).
- `npx vitest run scripts/check-brand-scope.test.mjs`: **39/39 passed** (unchanged — this rework needed no new tripwire test).
- `npm run check:brand-scope`: PASS — "Brand-scope check passed."
- `npm run check` (all four tripwires): PASS.

## Live browser verification

Dev DB flags flipped ON for the duration (`ui.branded_signin`, `sites.public_render`; `ui.brand_theming` was already `enabled: true` at session start and was left as found) via raw SQL against `PLATFORM_DATABASE_URL`, restored to seeded defaults (`false`/`false`) immediately after. `fpcw` was already `organization_sites.status = 'live'` with a real `organization_brands` row (`seed_hex #60a7a1`, `light_only`, `contemporary` type pairing) — no fixture staging needed.

Playwright script: `scratch/verify-google-button-neutral.mjs` (kept out of git per the repo's scratch convention), run against the dev server already up on `:3000`. Loaded `/signin?callbackUrl=%2Fo%2Ffpcw%2Fdirectory` (branded) and bare `/signin` (unbranded), at 1280px and 390px, reading computed styles directly:

| Page | width | root `--primary` | Google form's own `--primary` (post-override) | Google button computed `background-color` | h1 font |
|---|---|---|---|---|---|
| branded (fpcw) | 1280 | `#579e98` | `hsl(221 83% 53%)` | `rgb(36, 99, 235)` | Montserrat |
| branded (fpcw) | 390 | `#579e98` | `hsl(221 83% 53%)` | `rgb(36, 99, 235)` | Montserrat |
| bare | 1280 | `#2463eb` | `#2463eb` | `rgb(36, 99, 235)` | platform default (ui-sans-serif stack) |
| bare | 390 | `#2463eb` | `#2463eb` | `rgb(36, 99, 235)` | platform default |

`rgb(36, 99, 235)` is `hsl(221 83% 53%)` rendered — the platform `--primary` from `globals.css`/`PLATFORM_TOKENS.light`, **identical** on the branded and the bare page. The root `--primary` differs (fpcw's teal vs. platform blue), proving the brand still reaches the rest of the page (confirmed visually: pale teal page background, Montserrat heading, fpcw's logo) while the Google button's own scoped `--primary` — and its rendered pixel colour — never moves. Screenshots saved to `/tmp/signin-branded-fpcw-{1280,390}.png` and `/tmp/signin-bare-{1280,390}.png`; visually confirmed no overflow or layout break at 390px, and that bare `/signin` is pixel-unchanged from before this rework (no logo, no colour, default sans font).

After restoring the flags to seeded-off, re-fetched `/signin?callbackUrl=%2Fo%2Ffpcw%2Fdirectory` via `curl` and confirmed zero occurrences of `:root:root` in the response body — platform-default chrome resumes exactly as designed.

## Red Flags — resolution

1. **Google-button recolor** — fixed via the `[data-brand-neutral]` escape hatch described above. Verified live: identical `rgb(36, 99, 235)` background on branded and bare pages.
2. **Missing TODO line** — added to `docs/TODO.md` under Next Up, referencing this work-log.
3. **Mobile 390px browser check** — done this session (see screenshots above); no layout break, Google button legible and correctly coloured.

## Handoff

Next: **qa** (Phase 5 re-verify, scoped to this rework's diff) → **analyst** (Phase 6 second pass). What to check in the browser: `/signin?callbackUrl=%2Fo%2Ffpcw%2Fdirectory` with `ui.branded_signin` + `sites.public_render` on — Google button must stay platform blue while the rest of the page (logo, background tint, heading font) carries fpcw's brand; bare `/signin` must be pixel-unchanged.


---

# Phase 5 — Test Verification (qa) — SCOPED RE-VERIFICATION (Rework)

**Date:** 2026-08-24 · **Verified by:** qa · **Verdict: PASS**

Scope: the Phase 4 rework diff only (Phase 6 first-pass Red Flags 1 & 2); the original full Phase 5 PASS stands for everything else.

## Diff Read

- `brand-tokens.tsx`: `[data-brand-neutral]` / `:root:root.dark [data-brand-neutral]` blocks appended inside the *existing single* `<style>` element; no second emitter, no `dangerouslySetInnerHTML` anywhere else under `src/` (direct grep). Values come from `PLATFORM_TOKENS` in `src/lib/brand/contract.ts` (`NEUTRAL_RESET_TOKENS`), no duplicated literals; scoped to exactly `--primary`, `--primary-foreground`, `--ring`.
- `signin/page.tsx`: `data-brand-neutral=""` on the Google `<form>` only; credentials form untouched, still brand-carrying.
- `docs/TODO.md:38`: the `/totp`/password-pages brand-continuation follow-up recorded (Rule 10).

## Commands

typecheck PASS · brand-tokens + signin unit suites **20/20** (incl. 3 new neutral-reset tests) · DB-backed `sites.test.ts` **56/56** · `npm run check` PASS ×4 · `check-brand-scope.test.mjs` **39/39**, EMITTERS still exactly three.

## Live Check (shared dev server :3000, flags flipped then restored)

Independent Playwright computed-style read at 1280px and 390px: on the branded page root `--primary` is fpcw `#579e98` while the Google form's is the platform `hsl(221 83% 53%)` and the button paints `rgb(36, 99, 235)` — byte-identical to bare `/signin` at both widths. `/site/fpcw` spot-checked still branded (shared emitter unregressed). Flags restored to seeded state and re-confirmed via SELECT + curl.

## Verdict

**PASS.** Both red flags resolved and independently confirmed. The rework touches no auth logic (`signIn`, `sanitizeCallbackUrl`, `proxy.ts` unchanged), so the original Phase 5 e2e run remains valid.

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 5 — Verification (rework re-check) | qa | Complete | PASS | 2026-08-24 |


---

# Phase 6 — Shipped vs Intent (analyst) — SECOND PASS

## VERDICT

**SHIP IT**

## ONE-LINE TAKE

> Both first-pass red flags are fixed and independently reproducible by a third method (raw HTML/CSS read, not just the two recorded Playwright computed-style runs); the `/totp` follow-up is on record in `docs/TODO.md`. No new gaps found in the rework diff.

## What Changed Since First Pass — Verified

- **Google-button recolor, fixed.** `[data-brand-neutral]` blocks appended inside the *existing* single `<style>` element (no second emitter, no E3 violation), every value sourced from `PLATFORM_TOKENS` — zero duplicated literals, scoped to exactly the three tokens the default `<Button>` reads. Only the Google `<form>` carries the attribute; the credentials submit stays brand-carrying, matching Phase 3's "brand wraps the form, never restyles it."
- **Live re-verification (third method):** raw SQL flag flip + curl of the branded page: root `--primary: #579e98` (fpcw) while `[data-brand-neutral]` re-declares platform `hsl(221 83% 53%)`; attribute present on the Google form. Flags restored to seeded-off, confirmed via SELECT.
- **`docs/TODO.md` follow-up present** (line 38, `/totp`/password-pages continuation) alongside the Sev-1 2FA-bypass line.
- **Mobile 390px:** two independent Playwright runs (implementer + QA) — satisfied.

## Rule 10/12/13 Check

- Rule 10: satisfied — both follow-ups recorded in TODO.
- Rule 12: N/A (not feedback-originated).
- Rule 13: what's-new advisory recommended when the flag flips on for a real congregation; not required while shipped seeded OFF.

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 6 — Shipped vs intent (second pass) | analyst | Complete | SHIP IT | 2026-08-24 |

**Pipeline closed.** The Sev-1 2FA-bypass finding is tracked separately (own pipeline; not a gate on this SHIP IT). Commits await user review per Workflow Rule 1.
