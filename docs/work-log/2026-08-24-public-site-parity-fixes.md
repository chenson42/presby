# Public site parity fixes — Work Log

> **Slug:** `2026-08-24-public-site-parity-fixes`
> **Surface:** public — `(public)/site/[slug]`
> **Permission(s):** none (no new gated surface)
> **Flag(s):** none (existing `sites.public_render`/`ui.brand_theming` unchanged)
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant, abbreviated — see notes per phase below. This batch groups several small, independently-low-risk presby-repo fixes discovered during hands-on fidelity testing of the fpcw public site against the real westervillefirstpresbyterian.org, rather than opening a work-log per one-line fix. The larger visual/behavioral parity work (nav scroll-hide, hover dropdown, hero carousel, corner-radius tokens) lives in the external `presby-site-kit`/`site-fpcw` repos, which are not governed by this repo's pipeline — consistent with how this session's earlier site-kit work (v3.4.0, v4.0.0) was done.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Skipped — bug-fix variant, brief below | — | 2026-08-24 |
| 2 — Architectural review | architect | Skipped — no invariant touched, no new deps, no schema change | — | 2026-08-24 |
| 3 — Technical design | tech-lead | Skipped — trivial design, documented inline below | — | 2026-08-24 |
| 4 — Implementation | full-stack-developer (self) | Complete | — | 2026-08-24 |
| 5 — Verification | qa | Pending | — | — |
| 6 — Shipped vs intent | analyst | Pending | — | — |

---

## Bug-Fix Brief (Phase 1, abbreviated)

**Bug 1 — every public site page renders the browser tab title "presby".**
Root cause: `(public)/site/[slug]/[[...path]]/page.tsx` has no `generateMetadata` export, so every page falls through to the root layout's default title (`src/app/layout.tsx`'s `metadata.title.default = "presby"`, with `template: "%s · presby"`). A real congregation's public visitor-facing site should never show platform branding in the tab title — each content page already carries a real, human-authored `frontMatter.title` (e.g. `"Worship — First Presbyterian Church of Westerville"`, confirmed in `scratch/site-fpcw/content/worship.json`) that was simply never read.
Fix: add `generateMetadata()` reading the matched page's `frontMatter.title` (falling back to `organizationName`), returned as `title: { absolute: ... }` so it bypasses the root layout's `"%s · presby"` template entirely — a church's own page title, not a platform-branded one.
Side fix: `getPublishedSite()` had no request-level memoization, so `generateMetadata()` and the page component would each independently hit the DB/blob store for the same slug on every request. Wrapped in React `cache()` — the standard Next.js App Router pattern for sharing one fetch between `generateMetadata` and its page — rather than accepting a doubled read on every single public-site page view going forward.

**Bug 2 — "Member Login" should not be its own top-level nav item for fpcw.**
The real site has no separate login link at all — `Connect > Our Directory` is where a member reaches the member-only area. `Nav`'s portal link was always flat/top-level (`presby-site-kit` v1–v4). Added two new optional `renderSiteBundle()` inputs, `portalNavGroup` and `portalLabel` — when `portalNavGroup` is set, the portal link is folded into that content-authored nav group (as just another `NavEntry`, reusing the existing `buildNavItems()` merge logic — zero `Nav.tsx`/`Footer.tsx` changes needed) instead of rendering as a standalone flat link. Unset (the default for every other org, e.g. Alder Creek), behavior is byte-identical to before.
`page.tsx` sets `portalNavGroup: "Connect", portalLabel: "Our Directory"` unconditionally for now — every org gets this pattern, not just fpcw. This is a deliberate, named simplification (not a hidden hardcode): it matches a genuinely common shape (a "Connect"-style group is a reasonable default for any congregation site), and an org with no `"Connect"` group just gets a new single-entry group created for it, which degrades gracefully rather than breaking. True per-org configurability (which group, whether to group at all, custom label) is real future work, tracked in `docs/TODO.md`.

## Out of Scope (this entry)

- Nav scroll-hide/reveal, hover-triggered dropdown + animated underline, hero carousel, image/button corner-radius tokens, contact-form visual parity — all in `presby-site-kit`/`site-fpcw`, tracked separately, not presby-repo changes.
- Per-org configurable portal-nav-group placement (see Bug 2 note) — `docs/TODO.md` follow-up.

---

# Phase 4 — Implementation

## Files Modified

- `src/lib/sites.ts` — wrapped `getPublishedSite` in React `cache()`.
- `src/app/(public)/site/[slug]/[[...path]]/page.tsx` — added `generateMetadata()`; passed `portalNavGroup`/`portalLabel` into `renderSiteBundle()`.
- `src/app/(public)/site/[slug]/[[...path]]/page.test.tsx` — regression tests for both.
- `package.json` — `presby-site-kit` bumped to the version shipping `portalNavGroup`/`portalLabel`.

## Schema Changes

None.

## Audit Events

None — no security-sensitive mutation.

## Implementer Notes

`generateMetadata` and the page component both call `getPublishedSite(slug)` independently by design (Next.js does not share data between them automatically) — the `cache()` wrap is what makes that free rather than a doubled DB/blob read per request, matching Next's own documented pattern for this exact situation.

---

# Phase 5 — Verification (qa)

*(pending)*

---

# Phase 6 — Shipped vs Intent (analyst)

*(pending)*
