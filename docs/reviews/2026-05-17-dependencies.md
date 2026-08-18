# Dependencies Review — 2026-05-17

**Owner:** deployment-engineer
**Cadence:** 30 days
**Run:** first time

## Summary

7 npm audit findings, all moderate severity, all transitive (no direct production dep is itself the CVE source). Two CVE chains — one in drizzle-kit (dev-only), one in next/postcss (technically prod, but the vulnerable postcss code path is the CSS stringify pipeline, not a runtime server feature). No high/critical findings. Two deps are a full major version behind with non-trivial migration cost. NextAuth is still on beta; TypeScript 6 warrants a planned upgrade soon.

---

## Upgrade Now — security CVE or breaking issue

None. No high or critical CVEs. Both moderate CVE chains are documented below under Hold with mitigations.

---

## Upgrade Soon — major-behind, no urgency

### 1. `@neondatabase/serverless` 0.10.4 → 1.1.0 (major)
The 1.x line dropped the old `neonConfig.fetchEndpoint` API and changed how HTTP pooling is configured. The app currently uses the default connection pattern so migration is likely low-risk, but it requires a read of the 1.x migration guide before bumping. No CVE. Recommend upgrading in the next planned maintenance window with a Neon branch smoke-test.

### 2. `eslint` 9.39.4 → 10.4.0 (major)
ESLint 10 requires `eslint-config-next` to release a compatible version. As of this review, `eslint-config-next` is at 16.2.6 and has not dropped an ESLint-10-compatible release yet. Track this — the upgrade will be a two-dep bump (eslint + eslint-config-next) and should happen together.

### 3. `typescript` 5.9.3 → 6.0.3 (major)
TypeScript 6 removes some legacy emit options and narrows some inference behaviors. The codebase is strict-mode clean; risk is low but non-zero. Node 20 is fully supported. Plan a test run: `npm install typescript@6 --save-dev && npm run typecheck` on a branch. If clean, ship it.

---

## Hold — beta, risky bump, or "latest" is actually older

### 4. `next-auth` 5.0.0-beta.31 (pinned beta; npm "latest" tag is 4.24.14)
NextAuth 5 is still in public beta. npm's `latest` tag still points to the v4 stable line, which is why `npm outdated` shows it as "behind." This is intentional — the starter deliberately uses Auth.js v5 (the rename) for Next.js App Router compatibility. Auth.js v5 stable has not shipped as of this review. **Known risk for forkers:** any production app built on this starter carries beta-channel auth. Mitigations: the API surface has been stable for several months; the starter pins to a specific beta; regression test coverage for auth flows is the primary guard. Revisit each 30-day cycle. When v5 stable ships, bump and run full auth E2E.

### 5. `drizzle-kit` audit — esbuild GHSA-67mh-4wv8-2f99 (moderate, dev-only)
drizzle-kit@0.31.10 bundles `@esbuild-kit/esm-loader` which depends on esbuild <=0.24.2. The vulnerability allows a website to send requests to the esbuild dev server and read responses. **Impact:** dev-only tooling; esbuild's dev server is never exposed in CI or production. `npm audit fix --force` would downgrade drizzle-kit to 0.18.1 (a major breaking change) — do not use it. The fix is to wait for drizzle-kit to drop the `@esbuild-kit` dependency (it is in their backlog). Track the drizzle-kit changelog. Acceptable risk at this severity given the dev-only exposure.

### 6. `next` / `postcss` — GHSA-qx2v-qp2m-jg93 (moderate, transitive)
Next.js 16.2.6 bundles postcss 8.4.31 (internally). The CVE requires >=8.5.10. The vulnerable code is in PostCSS's CSS stringify output — an XSS vector if PostCSS output is served directly as HTML. In this starter, PostCSS is a build-time CSS processor; its output is static CSS files, never injected as raw HTML at runtime. **Impact:** negligible in this architecture. `npm audit fix --force` would roll Next.js back to 9.3.3, which is absurd. The fix must come from Next.js shipping with postcss >=8.5.10; monitor Next.js releases. next-auth is flagged as a downstream dependent of next — this is the same chain, not a separate finding.

### 7. `@types/bcryptjs` 3.0.0 — "latest" shows 2.4.6
The `npm outdated` output shows current: 3.0.0, latest: 2.4.6. This is a DefinitelyTyped publication artifact — the 3.x types were published to match bcryptjs 3.x, but the npm `latest` tag on `@types/bcryptjs` still points to the 2.x line. The types are correct for the bcryptjs 3.0.3 we ship. No action.

---

## All Current (v0.3 additions spot-check)

| Package | Installed | License | Node engine | Status |
|---------|-----------|---------|-------------|--------|
| `sonner` | 2.0.7 | MIT | any | Current |
| `@upstash/ratelimit` | 2.0.8 | MIT | any | Current |
| `@upstash/redis` | 1.38.0 | MIT | any | Current |
| `@tailwindcss/typography` | 0.5.19 | MIT | any | Current |

All four v0.3 additions are at sensible-recent versions with MIT licenses. No engine mismatches.

---

## Node Engine Check

`package.json` engines: `>=20.9.0`. `.nvmrc` pins to Node 20.

Packages with explicit engine requirements:
- `next`: `>=20.9.0` — matches
- `resend`: `>=20` — matches
- `typescript`: `>=14.17` — matches
- All others: no restriction or `>=0.x`

No dep requires Node 22+. The `>=20.9.0` engine floor is safe for current LTS (20.x and 22.x both satisfy it). No mismatch.

---

## Bundle-Size Eyeball

No unexpected large deps for their purpose. The Upstash client pair (`@upstash/ratelimit` + `@upstash/redis`) are both edge-compatible and lightweight. `react-markdown` + `remark-gfm` are used only in the admin docs page (not on public routes), so bundle impact is isolated to the admin chunk. `lucide-react` supports tree-shaking; individual icon imports keep it from inflating the public bundle.

---

## Action Items

| Priority | Item | Who |
|----------|------|-----|
| Soon | `@neondatabase/serverless` 0.x → 1.x: read migration guide, test on Neon branch | deployment-engineer |
| Soon | `typescript` 5 → 6: branch test, ship if clean | deployment-engineer |
| Soon | `eslint` 10 upgrade: wait for `eslint-config-next` compatibility, then bump both together | deployment-engineer |
| Watch | `next-auth` beta: review each 30-day cycle; bump to stable when v5 ships | deployment-engineer |
| Watch | `drizzle-kit` esbuild CVE: monitor drizzle-kit releases for `@esbuild-kit` removal | deployment-engineer |
| Watch | `next` / postcss CVE: monitor Next.js releases for postcss >=8.5.10 bundled | deployment-engineer |
