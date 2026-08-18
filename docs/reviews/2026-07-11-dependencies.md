# Dependencies Review — 2026-07-11

**Owner:** deployment-engineer
**Cadence:** 30 days (last run 2026-05-17, `docs/reviews/2026-05-17-dependencies.md`)

## Summary

Since 2026-05-17, commit `8a34b81` (2026-07-02) already cleared 2 high (undici, vite) + 1 low via `npm audit fix`. `npm audit` today reports the same **7 moderate findings, same two chains** as last cycle — no new CVEs, nothing regressed. One item from the 05-17 "Soon" list has quietly resolved itself: `@neondatabase/serverless` is now on `1.1.0` (the major bump already happened between reviews — `npm outdated` no longer lists it). TypeScript has moved *past* the 05-17 "upgrade to 6" plan: stable 6.0 shipped and has already been superseded by **7.0.2 as `latest`**, but the ecosystem (`typescript-eslint`) caps support at `<6.1.0`, so 7 is not installable yet without breaking lint. No `npm install`, upgrade, or `package.json` edit was performed — plan only, per instructions.

---

## Urgent — security CVE or breaking issue requiring near-term action

None. No high/critical findings. Both moderate CVE chains remain mitigated by architecture (see Held below) and neither has a same-major fix path yet.

---

## Soon — safe upgrades, no blocking dependency, low risk

| Package | Installed → Wanted/Latest | Notes |
|---|---|---|
| `eslint` | 9.39.4 → 9.39.5 (patch); 10.7.0 exists | Patch bump is safe now. The eslint 10 *major* has a real path open (see below) but is bundled with other moves — sequence it, don't patch-and-forget. |
| `typescript-eslint` (transitive, via `eslint-config-next`) | 8.59.3 → 8.63.x | `typescript-eslint@latest` now declares `eslint: "^8.57.0 \|\| ^9.0.0 \|\| ^10.0.0"` — this is the dependency that was blocking eslint 10 on 05-17 and it now supports it. |
| `eslint-config-next` | 16.2.6 → 16.2.10 | Published 2026-07-01; peers relaxed to `eslint >=9.0.0` (no upper cap). Bump alongside eslint. |
| `@radix-ui/react-*` (dialog, dropdown-menu, label, slot, switch) | various → latest patch/minor | Routine, low-risk UI primitive bumps. |
| `@tailwindcss/postcss`, `tailwindcss` | 4.3.0 → 4.3.2 | Patch. |
| `react`, `react-dom` | 19.2.6 → 19.2.7 | Patch. |
| `@types/react` | 19.2.14 → 19.2.17 | Patch, matches React. |
| `@types/node` | 20.19.41 → 20.19.43 | Patch within the 20.x line that tracks the pinned Node 20 LTS (`.nvmrc`). The `26.1.1` shown as "Latest" tracks a Node major we don't run — not a gap, expected drift; do not chase it. |
| `resend`, `otplib`, `lucide-react`, `tsx`, `@playwright/test`, `@vitest/coverage-v8`, `vitest`, `@tailwindcss/typography` | minor/patch bumps | No advisories, no breaking notes in range. Standard batch bump candidates. |
| `typescript` | 5.9.3 (pinned) — **do not chase "Latest" (7.0.2)** | See Held #3 below — this replaces the 05-17 "upgrade to 6" plan with a narrower target. |

**Recommended grouping:** batch the routine patch/minor bumps (Radix, Tailwind, React types, Resend, otplib, lucide-react, tsx, Playwright, Vitest) in one PR — none carry breaking-change notes. Handle the `eslint` + `eslint-config-next` + `typescript-eslint` major together as a second, separate PR (see Recommended Upgrade Order).

---

## Held — CVE mitigated by architecture, or fix requires a major/beta we're not ready to take

### 1. `esbuild` <=0.24.2 via `drizzle-kit` — GHSA-67mh-4wv8-2f99 (moderate, dev-only)
**Status: fix now exists but is pre-release.** `drizzle-kit@0.31.10` (installed) still bundles `@esbuild-kit/esm-loader` → vulnerable `esbuild`. New finding this cycle: `drizzle-kit@1.0.0-rc.4` has **dropped `@esbuild-kit/esm-loader` entirely** and depends on `esbuild@^0.25.10` directly — clean of the CVE. However, `1.0.0` is still on the `rc` dist-tag (rc.1 → rc.4 so far, no stable cut), and it's a major version jump from `0.31.x`. Hold until `drizzle-kit@1.0.0` cuts a stable release; then this becomes a "Soon" major-version project (schema/CLI diff review + Neon branch smoke test), not a same-day patch. Impact remains dev-only — esbuild's dev server is never exposed in CI or production.

### 2. `postcss` <8.5.10 via `next` → `next-auth` — GHSA-qx2v-qp2m-jg93 (moderate, transitive)
**Status: fix is in Next.js's canary pipeline, not yet stable.** `next@16.2.10` (current `latest`) still bundles `postcss@8.4.31`. New finding this cycle: `next@16.3.0-canary.83` already bundles `postcss@8.5.10` — the fix is coming, just not cut to stable yet. Hold until a `16.3.x` (or later) stable Next release ships with the bumped postcss; then this resolves as a routine Next.js point-release, no app-code changes expected. Impact remains negligible in this architecture — PostCSS output is build-time static CSS, never injected as raw HTML at runtime.

### 3. `typescript` 5.9.3 → 6.x or 7.x (major)
**Revises the 05-17 plan.** At 05-17 the plan was "bump to TypeScript 6." Since then, TS 6.0 stable shipped *and* was superseded — `latest` is now `7.0.2` (with `7.1.0-dev` already in the `next` channel). But `typescript-eslint@8.63.x`'s peer range is `typescript: ">=4.8.4 <6.1.0"` — **TypeScript 7 is not yet lintable** with the toolchain this repo uses. Revised target: **6.0.x, not 7.x.** Branch-test with `npm install typescript@6 --save-dev && npm run typecheck && npm run lint`; if clean, ship 6.0 and re-park the 7.x question for a future cycle once `typescript-eslint` catches up.

### 4. `next-auth` 5.0.0-beta.31 (pinned; npm `latest` tag is 4.24.14)
**No change since 05-17.** Still the newest beta — no `beta.32` has shipped in the ~3 months since `beta.31` (published 2026-04-14). This is intentional (Auth.js v5 for App Router compat); npm's `latest` tag pointing to the v4 line is expected noise, not a signal to downgrade. Continue to revisit each cycle; bump to stable when Auth.js v5 GA ships.

### 5. `@types/bcryptjs` 3.0.0 — "latest" shows 2.4.6
No change since 05-17. DefinitelyTyped publication artifact; 3.0.0 is correct for the installed `bcryptjs@3.0.3`. No action.

---

## Recommended Upgrade Order

1. **Routine batch PR** (Soon list, low risk): Radix UI primitives, Tailwind patch, React/`@types/react` patch, `@types/node` patch, Resend, otplib, lucide-react, tsx, Playwright, Vitest/`@vitest/coverage-v8`, `@tailwindcss/typography`. Run full `npm run check`, `npm test`, `npm run build` after.
2. **TypeScript 6.0 branch test**: `npm install typescript@6 --save-dev`, run `npm run typecheck` + `npm run lint` + `npm run build` on a branch. If clean, merge as its own PR (isolate from the eslint major so a regression is easy to bisect).
3. **eslint 10 major** (now unblocked): bump `eslint` → 10.x, `eslint-config-next` → 16.2.10+, let `typescript-eslint` resolve to its latest 8.63.x (still `<6.1.0` TS peer, compatible with step 2's TS 6.0 target). Run `npm run lint` across the full repo and check for new rule violations before merging — major ESLint versions sometimes flip default severities.
4. **Watch, no action yet**: `drizzle-kit` 1.0.0 stable cut (unblocks the esbuild CVE fix), Next.js 16.3.x stable cut (unblocks the postcss CVE fix), `next-auth` beta.32+ or v5 GA, `typescript-eslint` support for TS 7.

---

## Node Engine Check

`package.json` engines: `>=20.9.0`. `.nvmrc` pins `20`. Installed Node runtime: `v20.20.2`. No dependency requires Node 22+. No mismatch. `@types/node`'s "latest" showing `26.1.1` is expected drift (DefinitelyTyped majors track Node majors; we intentionally stay on the 20.x types line to match the pinned runtime) — not a gap to close.

---

## Audit Detail (raw)

```
7 moderate severity vulnerabilities
- esbuild <=0.24.2 (via @esbuild-kit/esm-loader → drizzle-kit 0.19.0 - 1.0.0-beta.1-fd8bfcc)
  GHSA-67mh-4wv8-2f99 — fix requires drizzle-kit 1.0.0 (currently RC-only)
- postcss <8.5.10 (via next → next-auth)
  GHSA-qx2v-qp2m-jg93 — fix requires next 16.3.x+ (currently canary-only)
```

No high or critical findings. Matches 05-17 finding count and chains exactly; nothing new, nothing regressed.
