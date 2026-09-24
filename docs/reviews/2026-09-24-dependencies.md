# Dependencies Review — 2026-09-24

**Owner:** deployment-engineer
**Cadence:** 30 days (last run 2026-08-19; no detail file was found for that date under `docs/reviews/` — the most recent prior detail file present is 2026-07-11-dependencies.md, used as the format/baseline reference alongside 2026-05-17-dependencies.md)
**Method:** read-only (`npm outdated`, `npm audit`, `npm view`, `--dry-run` installs only). No `package.json` or lockfile change applied.

## Summary

`npm audit`: **7 moderate, 0 high/critical** — unchanged in count and unchanged in chain identity since 2026-07-11 (same two advisory chains). One of the two chains now has a real fix path (vitest 4.1.11+); the other (drizzle-kit → `@esbuild-kit` → esbuild) still has none. Since the 2026-09-24-context bump (`next` 16.3.0→16.3.6, `sharp`→0.35.4, `js-yaml`→4.3.2, `browserslist`→4.29.1), no further critical/high advisories are open. The `npm update`/`npm audit fix` reify failure reported from that session **reproduces**, root-caused below, with a confirmed workaround. New, time-sensitive finding not in any prior cycle: **Vercel is deprecating Node 20 in Project Settings on 2026-10-01 — seven days from this review** — and this repo's `engines` field and `.nvmrc` both pin to Node 20.

---

## Upgrade Now — security CVE or breaking issue

None. No high or critical CVEs in `npm audit`. See "Time-sensitive, non-CVE" below for the Node 20 deprecation, which is not a vulnerability but has a harder deadline than anything in the CVE list.

---

## Time-sensitive, non-CVE

### Node 20 deprecation on Vercel — 2026-10-01

Per Vercel's changelog ("Node.js 20 is being deprecated"): Node 20 will be **disabled in Project Settings on October 1, 2026**. New deployments configured for Node 20 will error; already-deployed functions keep running but the project can no longer be redeployed on that runtime. Vercel's stated fix is either bumping the `engines` field / Project Settings Node version to `24.x` (or `22.x`), or (not recommended) a `Dockerfile.vercel` container escape hatch.

This repo:
```
# package.json
"engines": { "node": ">=20.9.0" }
# .nvmrc
20
```
Both need to move. `>=20.9.0` in `engines` is a floor, not a pin, so Vercel's Project Settings Node version (set in the dashboard, not in this repo) is the actual lever — but the floor should be raised so a `npm ci` on a contributor machine matches, and `.nvmrc` should track whatever Node version Vercel is told to run.

**Recommended action:** bump `.nvmrc` to `22` (current LTS; `24.x` is what Vercel's guidance names for Functions but 22 is also supported and gives one more LTS cycle of headroom) and `engines.node` to `>=22.9.0`, and set the Vercel Project Settings Node version to match, before 2026-10-01. This is not this agent's call to make unilaterally (`.nvmrc`/`package.json` engines edits are a `chore:` change through the normal pipeline, and the actual Vercel dashboard setting is out-of-repo), but it needs an owner and a date this week, not a 30-day-cycle mention. Verified against Vercel's own changelog page (fetched this session); no dependency in the tree pins to Node 20 specifically (`next`, `resend`, `typescript` all declare `>=20`-shaped floors, satisfied by 22/24 too), so the bump itself should be a clean version-string change plus a CI re-run.

---

## Upgrade Soon — major-behind or now-unblocked, no urgency

### 1. `eslint` 9.39.4 → 10.11.0 — now unblocked
2026-05-17 and 2026-07-11 both held this on `eslint-config-next` not yet supporting ESLint 10. That is no longer true: `eslint-config-next@16.3.6` (matching the installed `next` version) declares `peerDependencies: { eslint: ">=9.0.0" }`, and `npm install eslint@10 eslint-config-next@latest --save-dev --dry-run` resolves cleanly (204 packages added/changed, 24 removed, no ERESOLVE). Recommend bumping both together in the next maintenance window and running `npm run lint` + `npm run check` on the result before merging — a flat-config major can still change specific rule defaults even when peer ranges are satisfied.

```
npm install eslint@10.11.0 eslint-config-next@16.3.6 --save-dev
npm run lint && npm run check
```

### 2. `typescript` 5.9.3 → 6.0.3 (major, stable) — still open from prior cycles
6.0.3 is the current stable major (7.0.2 also exists — see Hold, below). `npm install typescript@6 --save-dev --dry-run` resolves cleanly. Recommend the same branch-test procedure named in 2026-05-17: install, `npm run typecheck`, ship if clean.

```
npm install typescript@6.0.3 --save-dev
npm run typecheck
```

### 3. `@vitest/coverage-v8` / `@vitest/mocker` / `vitest` — CVE fix now shippable
See the audit finding below (GHSA-82fw-gwwq-j7x9). `npm audit` names 4.1.11 as the fix version and it is out and stable now (current: 4.1.6 → 4.1.11). This is dev/test-only surface (Vitest, not a production dependency), so it carries no production risk today, but it is the one audit chain with a clean, non-breaking fix available and should not wait for a major-version planning cycle.

**Reify bug — reproduced and root-caused.** `npm audit fix` and even `npm audit fix --dry-run` fail outright in this tree:
```
npm error Cannot read properties of null (reading 'edgesOut')
```
Traced via `--loglevel silly` to `@npmcli/arborist/lib/arborist/build-ideal-tree.js`'s `#loadPeerSet` (npm 10.8.2, bundled with Node 20.20.2) — a known npm/arborist defect in the recursive peer-set resolution `npm audit fix` triggers when it tries to satisfy every peer in one pass across a workspace this size (1,046 total deps per `npm audit`'s own count). It is not specific to vitest's dependency shape; it's an arborist-internal null-deref during peer-set recursion.

**Workaround confirmed:** naming the packages explicitly bypasses the code path that crashes — `npm install <pkg>@<version> --save-dev` (single or multiple named packages in one invocation) resolves and installs successfully every time it was tried, including all three vitest packages together:
```
npm install vitest@4.1.11 @vitest/coverage-v8@4.1.11 @vitest/mocker@4.1.11 --save-dev
```
`--dry-run` of that exact command completed cleanly (194 added, 1 removed, 22 changed) in this session. Do **not** run `npm audit fix` or `npm update` bare in this tree until either npm ships an arborist fix or the dependency graph shrinks — name packages explicitly instead. Worth a line in `docs/decisions.md` or a comment near the `package.json` `vitest` line so the next person doesn't lose time rediscovering this.

---

## Hold — beta, native-rewrite risk, or fix path doesn't exist yet

### 4. `next-auth` 5.0.0-beta.32 — unchanged position, one advisory closed since last cycle
Installed and current (`current: wanted: 5.0.0-beta.32`; npm's `latest` dist-tag still points at the 4.x stable line, which is expected and intentional, as in every prior cycle). `docs/decisions.md` records the beta.31→beta.32 bump as a hard prerequisite for the P10 cross-origin auth work (GHSA-x445-f3h2-j279, OAuth cookies not provider-bound) — that bump is done; the tree is on beta.32. No newer beta exists past .32 as of this review. Continue watching each cycle for a stable v5 cut; no action now.

### 5. `drizzle-kit` — esbuild CVE unchanged, no fix path yet
`drizzle-kit@0.31.10` (wanted: 0.31.11, a patch — does not touch the vulnerable dependency) still bundles `@esbuild-kit/esm-loader@^2.5.5` → `@esbuild-kit/core-utils` → `esbuild@0.18.20`, matching GHSA-67mh-4wv8-2f99 (dev-server request/response exposure, dev-only). `npm view drizzle-kit versions` shows the only versions past 0.31.x are `1.0.0-rc.*` pre-releases (rc.4/rc.5 as of this review) — still no stable 1.0 cut. `npm audit fix --force` still proposes downgrading to `drizzle-kit@0.18.1`, which remains the wrong direction. Same disposition as every prior cycle: dev-only exposure, wait for either drizzle-kit to drop `@esbuild-kit` or a stable 1.0 to ship. Re-check next cycle before considering the 1.0 RC line early.

### 6. `typescript` 7.0.2 — do not take yet
TypeScript shipped a stable 7.x this cycle (the native/Go-toolchain rewrite line) in addition to 6.x. This is a much larger behavioral and tooling change than the routine 5→6 major (different compiler binary, different plugin/LSP ecosystem maturity). Recommend landing 6.0.3 first (item 2, above) as its own change, and treating 7.x as a separate, later, explicitly-scoped upgrade — not bundled into the same bump.

### 7. `zod` 3.25.76 → 4.6.5 (major) — held, plan a scoped pass
11 files under `src/` import from `zod` directly. Zod 4 changed several APIs (`.default()`/`.optional()` interaction, error-map shape, `z.record()` signature among them) that are exactly the kind of thing that passes `tsc` in some patterns and breaks at runtime in others. Not urgent (no CVE), but it's now a full major behind with a real migration surface — worth a dedicated Phase-1/2/3 pass rather than a drive-by bump, given zod sits on validation for auth and mutation inputs. Recommend scoping as its own small feature-classed pipeline rather than folding into a routine dependency bump.

### 8. `@vitest/mocker` chain / esbuild in the vite toolchain — see item 3
Already covered by the vitest 4.1.11 bump above; the `esbuild@0.28.1` used by `vite`/`tsx` is a different, non-vulnerable esbuild line from the one drizzle-kit bundles (`0.18.20`) — `npm ls esbuild` shows three independent esbuild copies in the tree (drizzle-kit's `@esbuild-kit` chain at 0.18.20, drizzle-kit's own direct dep at 0.25.12, and vite/tsx at 0.28.1). Only the 0.18.20 one is the CVE match.

---

## Already resolved since 2026-07-11 (no action — noted for the record)

- **`@neondatabase/serverless`** — was flagged "Soon" in 2026-05-17 and 2026-07-11 (0.10.4 → 1.x major). Now at `^1.1.0` in `package.json` and not in the `npm outdated` list at all — already current. Done.
- **`next` / postcss GHSA-qx2v-qp2m-jg93** — was Hold in 2026-05-17/07-11 pending Next.js bundling postcss ≥8.5.10. Not present in this cycle's `npm audit` output; the 2026-09-24 `next` 16.3.0→16.3.6 bump (noted in the review trigger) appears to have carried a postcss bump with it. Confirmed clear.
- **`next-auth` beta.31 → beta.32** — GHSA-x445-f3h2-j279 closed; see item 4.

---

## Node Engine Check

`package.json` engines: `>=20.9.0`. `.nvmrc`: `20`. Locally installed: Node v20.20.2, npm 10.8.2.

**This floor needs to move before 2026-10-01** — see "Time-sensitive, non-CVE" above. No dependency in the tree requires Node 22+ today (checked `next`, `resend`, `typescript`, `@types/node` — all `>=20`-shaped or unrestricted), so the bump itself is not blocked by any package; it is purely a "do it and redeploy" item, but it is the most time-boxed finding in this report.

`@types/node` shows `current: 20.19.41`, `wanted: 20.19.43`, `latest: 26.6.2` — the `latest` jump to a 26.x major is `@types/node` tracking a Node major that doesn't exist in this project's engine yet; not a real action item until the engine itself moves, at which point `@types/node` should be bumped to match whichever Node major is chosen (22.x types for a 22.x engine, not the always-newest `latest`).

---

## Pinned-for-a-reason items — verified still correct

- **DECISION-048 (`radix-ui` umbrella rejected)** — checked `package.json` and did not find a bare `radix-ui` dependency; only scoped `@radix-ui/react-*` packages are present (`@radix-ui/react-dropdown-menu`, `-label`, `-slot`, `-switch`, etc.), each individually a patch/minor behind (see `npm outdated` table). `npm run check:deps-drift` is the enforcement tripwire and was not run destructively here (read-only review), but the `package.json` inspection shows no drift. Recommend the routine `npm run ui:add` path for any future primitive, not raw `shadcn add`, per policy — no violation found this cycle.
- **`--radius` platform-token pin (DECISION-048, second clause)** — untouched by any of this cycle's outdated packages; no action.

---

## Full `npm outdated` (verbatim)

```
Package                              Current         Wanted   Latest  Location                                    Depended by
@playwright/test                      1.60.0         1.63.0   1.63.0  node_modules/@playwright/test               presby
@radix-ui/react-dropdown-menu         2.1.16         2.1.24   2.1.24  node_modules/@radix-ui/react-dropdown-menu  presby
@radix-ui/react-label                  2.1.8         2.1.15   2.1.15  node_modules/@radix-ui/react-label          presby
@radix-ui/react-slot                   1.2.4          1.3.3    1.3.3  node_modules/@radix-ui/react-slot           presby
@radix-ui/react-switch                 1.2.6          1.3.7    1.3.7  node_modules/@radix-ui/react-switch         presby
@tailwindcss/postcss                   4.3.0          4.3.3    4.3.3  node_modules/@tailwindcss/postcss           presby
@tailwindcss/typography               0.5.19         0.5.20   0.5.20  node_modules/@tailwindcss/typography        presby
@testing-library/dom                  10.4.1         10.4.2   10.4.2  node_modules/@testing-library/dom           presby
@testing-library/react                16.3.2         16.3.3   16.3.3  node_modules/@testing-library/react         presby
@types/bcryptjs                        3.0.0          3.0.0    2.4.6  node_modules/@types/bcryptjs                presby
@types/node                         20.19.41       20.19.43   26.6.2  node_modules/@types/node                    presby
@types/react                         19.2.14         19.3.0   19.3.0  node_modules/@types/react                   presby
@types/react-dom                      19.2.3         19.3.0   19.3.0  node_modules/@types/react-dom               presby
@upstash/ratelimit                     2.0.8          2.2.0    2.2.0  node_modules/@upstash/ratelimit             presby
@upstash/redis                        1.38.0         1.39.0   1.39.0  node_modules/@upstash/redis                 presby
@vitest/coverage-v8                    4.1.6         4.1.11    5.0.1  node_modules/@vitest/coverage-v8            presby
drizzle-kit                          0.31.10        0.31.11  0.31.11  node_modules/drizzle-kit                    presby
drizzle-orm                           0.45.2         0.45.3   0.45.3  node_modules/drizzle-orm                    presby
eslint                                9.39.4         9.39.5  10.11.0  node_modules/eslint                         presby
lucide-react                          1.16.0         1.48.0   1.48.0  node_modules/lucide-react                   presby
mermaid                              11.16.1        11.17.2  11.17.2  node_modules/mermaid                        presby
next-auth                      5.0.0-beta.32  5.0.0-beta.32  4.24.15  node_modules/next-auth                      presby
otplib                                13.4.0         13.5.0   13.5.0  node_modules/otplib                         presby
react                                 19.2.6         19.3.0   19.3.0  node_modules/react                          presby
react-dom                             19.2.6         19.3.0   19.3.0  node_modules/react-dom                      presby
react-hook-form                       7.86.0         7.88.0   7.88.0  node_modules/react-hook-form                presby
resend                                6.12.3         6.29.0   6.29.0  node_modules/resend                         presby
sonner                                 2.0.7          2.0.8    2.0.8  node_modules/sonner                         presby
tailwind-merge                         3.6.0          3.7.0    3.7.0  node_modules/tailwind-merge                 presby
tailwindcss                            4.3.0          4.3.3    4.3.3  node_modules/tailwindcss                    presby
tsx                                   4.22.0        4.23.15  4.23.15  node_modules/tsx                            presby
typescript                             5.9.3          5.9.3    7.0.2  node_modules/typescript                     presby
vitest                                 4.1.6         4.1.11    4.1.11  node_modules/vitest                         presby
zod                                  3.25.76        3.25.76    4.6.5  node_modules/zod                            presby
```

Everything not called out above (Radix primitives, Playwright, Tailwind/postcss, testing-library, react-hook-form, resend, sonner, mermaid, lucide-react, tsx, otplib, `@upstash/*`) is a routine patch/minor with no CVE and no breaking-change note in its changelog headline — batch these in the same maintenance pass as the eslint/typescript-6/vitest bumps above rather than one-by-one.

`@types/bcryptjs` 3.0.0 showing `latest: 2.4.6` is the same DefinitelyTyped publication artifact noted in 2026-05-17 — no action, types match the installed `bcryptjs` major.

---

## npm audit (verbatim)

```
# npm audit report

@vitest/mocker  2.1.0 - 4.1.10
Severity: moderate
Vitest: Path Traversal / Arbitrary File Read via @vitest/mocker Redirect Mock - https://github.com/advisories/GHSA-82fw-gwwq-j7x9
fix available via `npm audit fix`
node_modules/vitest/node_modules/@vitest/mocker
  vitest  2.1.0-beta.1 - 4.1.10
  Depends on vulnerable versions of @vitest/coverage-v8
  Depends on vulnerable versions of @vitest/mocker
  node_modules/vitest
    @vitest/coverage-v8  2.1.0-beta.1 - 4.1.10
    Depends on vulnerable versions of vitest
    node_modules/@vitest/coverage-v8

esbuild  <=0.24.2
Severity: moderate
esbuild enables any website to send any requests to the development server and read the response - https://github.com/advisories/GHSA-67mh-4wv8-2f99
fix available via `npm audit fix --force`
Will install drizzle-kit@0.18.1, which is a breaking change
node_modules/@esbuild-kit/core-utils/node_modules/esbuild
  @esbuild-kit/core-utils  *
  Depends on vulnerable versions of esbuild
  node_modules/@esbuild-kit/core-utils
    @esbuild-kit/esm-loader  *
    Depends on vulnerable versions of @esbuild-kit/core-utils
    node_modules/@esbuild-kit/esm-loader
      drizzle-kit  0.19.0 - 1.0.0-beta.1-fd8bfcc
      Depends on vulnerable versions of @esbuild-kit/esm-loader
      node_modules/drizzle-kit

7 moderate severity vulnerabilities
```
`npm audit --json` metadata: `{ info: 0, low: 0, moderate: 7, high: 0, critical: 0, total: 7 }`, across 398 prod / 596 dev / 225 optional / 41 peer deps (1,046 total).

---

## Action Items

| Priority | Item | Notes |
|----------|------|-------|
| **Time-sensitive (7 days)** | Bump `.nvmrc` and `engines.node` off Node 20; update Vercel Project Settings Node version | Vercel disables Node 20 in Project Settings 2026-10-01. Needs an owner and a `chore:` commit through the normal pipeline this week, not deferred to the next 30-day cycle. |
| Soon | `eslint` 9 → 10 + `eslint-config-next` together | Now unblocked — peer range satisfied, dry-run clean. |
| Soon | `typescript` 5.9 → 6.0.3 | Branch-test with `npm run typecheck`; do not jump straight to 7.x. |
| Soon | `vitest` / `@vitest/coverage-v8` / `@vitest/mocker` → 4.1.11 | Closes the one audit chain with a real, non-breaking fix. Must be installed by naming packages explicitly — `npm audit fix` / `npm update` crash in this tree (see reify bug). |
| Watch | `drizzle-kit` esbuild CVE | No fix path yet; only pre-release 1.0.0-rc line exists past 0.31.x. Dev-only exposure, unchanged risk acceptance. |
| Watch | `next-auth` beta.32 | Watch for stable v5; beta.31→.32 CVE already closed. |
| Held — scope separately | `zod` 3 → 4 (major) | 11 call sites, validation-layer API changes; deserves its own scoped pipeline, not a drive-by bump. |
| Held | `typescript` 7.0.2 (native rewrite) | Do not bundle with the 6.x bump; separate, later, explicitly-scoped change. |
| Routine batch | Radix primitives, Playwright, Tailwind/postcss, testing-library, react/react-dom 19.3, react-hook-form, resend, sonner, mermaid, lucide-react, tsx, otplib, `@upstash/*` | Patch/minor, no CVEs, no breaking-change headlines — batch in the same pass as the eslint/TS6/vitest work above. |

## Process note for the retrospective

The 2026-09-24-context `npm update`/`npm audit fix` reify failure **reproduces** on demand in this tree, including on `--dry-run` (no writes needed to trigger it). Root cause: an `@npmcli/arborist` (npm 10.8.2) null-dereference in `#loadPeerSet` during `build-ideal-tree`'s recursive peer-set resolution — triggered by `npm audit fix`/`npm update`'s whole-tree resolution pass, not by any specific package's dependency shape. **Workaround: always name the target package(s) explicitly** (`npm install <pkg>@<version> [<pkg2>@<version2> ...] --save-dev`) rather than running `npm audit fix`, `npm audit fix --force`, or bare `npm update`. This is worth a short note near the `vitest` line in `package.json` or a `docs/decisions.md` entry so the next agent doesn't re-diagnose it, and worth flagging to a future `npm`/Node engine bump as a thing to re-test (the bug may be npm-version-specific, and the Node-20-deprecation bump above is a natural point to re-check whether a newer bundled npm still hits it).
