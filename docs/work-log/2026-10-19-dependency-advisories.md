# Dependency advisories: Next.js 16.3.8, sharp, source-map-js — Work Log

> **Slug:** `2026-10-19-dependency-advisories`
> **Surface:** mixed (framework-wide dependency)
> **Permission(s):** none
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Bug-fix variant — Phase 2 skipped (no structural change; dependency versions only, no new dependency); Phase 3 skipped (trivial: patch-level bumps, root cause documented below)

**Root cause / trigger (orchestrator, 2026-10-19):** PR #31's CI `typecheck + build` job failed at "Dependency audit (production deps, high+)" — new upstream advisories against packages `main` already ships, not a code change: `next` 16.0.0–16.3.7 (high: SSRF in Image Optimization GHSA-cjq9-62q9-8jv4; cache poisoning GHSA-4jqv-mc3x-m676 and an SSG/ISR cross-user substitution; Draft Mode leak via `use cache` GHSA-3w37-wq28-93x7; metadata-image disclosure GHSA-f87g-xv8r-7p7x; dev MCP disclosure GHSA-39w2-rjm5-chcv), `sharp` <0.35.5 (high, librsvg CVE-2026-96889, GHSA-wq5f-xc86-pv6w), `source-map-js` 1.0.0–1.2.1 (high, event-loop DoS, GHSA-68fv-2mgg-jv7q). `katex`/`mermaid` are low (dev-docs only) and need a breaking mermaid major — out of scope. CI skips unit tests and lint after the audit failure, so every PR is red until this lands. Also a pre-deploy prerequisite for the production deploy.

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-10-19 |
| 2 — Architectural review | architect | Skipped (bug-fix variant: no structural change, no new dependency) | — | 2026-10-19 |
| 3 — Technical design | tech-lead | Skipped (trivial patch bumps; root cause above) | — | 2026-10-19 |
| 4 — Implementation | deployment-engineer | Complete (handoff to QA) | — | 2026-10-19 |
| 5 — Verification | qa | Complete | PASS | 2026-10-19 |
| 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-10-19 |

---

# Phase 1 — Functional Refinement (analyst, bug-fix variant) — recorded

**VERDICT: READY WITH NOTES.** The advisories are real against this tree (`npm audit --omit=dev --audit-level=high`: 3 high, 2 low); the fix is a lockfile-level patch bump with no member-visible behaviour change.

| Package | Locked | Needs | Reached through |
|---|---|---|---|
| `next` | 16.3.6 | ≥16.3.8 | direct `^16.3.6` |
| `sharp` | 0.35.4 | ≥0.35.5 | `next` optional dep `^0.35.4` |
| `source-map-js` | 1.2.1 | ≥1.2.2 | `postcss`, `@tailwindcss/node`, `css-tree`, `magicast` (`^1.2.1`) |

**Preserve:** patch moves only (`next` + `eslint-config-next` + `@next/eslint-plugin-next` in lockstep to ≥16.3.8; `sharp` ≥0.35.5; `source-map-js` ≥1.2.2); no new `package.json` dependency; no source/config change; no `overrides` unless a plain update can't reach a fixed version; `katex`/`mermaid` untouched, never `npm audit fix --force`; `@next/swc-*` moves with `next`, lockfile otherwise quiet; `npm audit --omit=dev --audit-level=high` exits 0.
**Notes:** (1) pdfkit tracing is not on this branch (giving branch) — re-check after giving merges; (2) `npm ci`/install before verifying, then `npm ls next sharp source-map-js` shows one resolved version each; (3) the 16.3.8 fixes touch Image Optimization, metadata image routes and SSG/ISR/`use cache` caching — skim the release notes.
**Test:** typecheck, build, `npm run check`, the audit command; one real `next/image` route (`lh3.googleusercontent.com` remote pattern; `totp-enroll-form.tsx`, `attachment-display.tsx`); Edge gate `src/proxy.ts` via `post-login-routing`, `totp-callback-bypass`, `totp-full-login`, `role-boundaries` against a running server; `security-headers.spec.ts`; `npm run test:e2e:prod` and the `e2e/hydration/` dev lane; `public-sites.spec.ts` and `visual-parity.spec.ts`; a 360px pass on `/home` and a public site.

---

# Phase 2 — Architectural Review (architect)

*Skipped (bug-fix variant): no structural change, no new dependency — versions only.*

---

# Phase 3 — Technical Design (tech-lead)

*Skipped (trivial patch bumps). Root cause: see the block at the top of this file.*

---

# Phase 4 — Implementation

## Files Modified

- `package.json` — `next` `^16.3.6` → `^16.3.8`; `eslint-config-next` `^16.3.6` → `^16.3.8`; `version` 0.33.0 → **0.33.1**. `@next/eslint-plugin-next` is transitive only (via `eslint-config-next`). No `overrides`.
- `package-lock.json` — see moves below.
- `docs/release-notes/v0.33.md` — 0.33.1 Security entry + TOC row (non-engineer wording; states the two remaining low katex/mermaid advisories).
- `docs/TODO.md` — Done line added (no open Next.js advisory line existed on this branch).

## Versions before → after

| Package | Before | After |
|---|---|---|
| `next` | 16.3.6 | 16.3.8 (latest 16.3.x; 16.4.x exists but was deliberately not taken) |
| `eslint-config-next` / `@next/eslint-plugin-next` | 16.3.6 | 16.3.8 |
| `sharp` | 0.35.4 | 0.35.5 (`npm update sharp source-map-js`, no override needed) |
| `source-map-js` | 1.2.1 | 1.2.2 (one copy, deduped under postcss, @tailwindcss/node, css-tree, magicast) |

## Lockfile notable moves

Diffed old vs new `packages`: only intended packages plus: `@next/env`, `@next/swc-*` (9 platform binaries) 16.3.6 → 16.3.8; `@img/sharp-*` platform binaries 0.35.4 → 0.35.5 (follows sharp); `@img/sharp-libvips-*` 1.3.3 → 1.3.4 (sharp's own dependency). Beyond those: the lockfile root `version` field 0.29.0 → 0.33.1 (was stale; npm resync, follows package.json). Nothing else moved.

## Commands and results

- `npm ci` OK. First attempt `npm install next@^16.3.8 eslint-config-next@^16.3.8` resolved **16.4.2** (a minor jump, out of scope); reverted and installed exact `16.3.8`, then restored the `^` range style in package.json. `next` initially pulled sharp 0.35.4, so a targeted `npm update sharp source-map-js` was used; no arborist `edgesOut` error occurred.
- `npm ls next sharp source-map-js`: one version each (16.3.8 / 0.35.5 / 1.2.2); next-auth dedupes to the same next.
- `npm audit --omit=dev --audit-level=high`: exit 0; remaining: 2 low (katex, mermaid), untouched.
- `npm run typecheck` exit 0. `npm run lint` (max-warnings=0) exit 0. `npm run check` (all tripwires) exit 0.
- `npm run test -- --no-file-parallelism`: exit 0, 302 files passed / 38 skipped; 4244 tests passed / 1182 skipped (116 s).
- `npm run build`: exit 0, no warnings.
- Dev server (mine, port 3000, `RATE_LIMIT_DISABLED=true`, stopped afterwards): `post-login-routing`, `totp-callback-bypass`, `totp-full-login`, `role-boundaries`, `security-headers`, `public-sites`, `e2e/hydration/` (chromium project): **38 passed, 0 failed, 0 skipped**, exit 0, 2.1 min.
- `npm run test:e2e:prod` (builds + serves on :3800): **4 passed**, exit 0, 55 s.
- `next/image`: `/_next/image?url=/apple-icon.png&w=64&q=75` with `Accept: image/webp` returned 200, a valid 64x64 WebP (sharp 0.35.5 working). `lh3.googleusercontent.com` URL passes the remote-pattern check (fails only with "upstream response is invalid" since the fake path 404s); `example.com` rejected ("url parameter is not allowed"); a loopback `http://127.0.0.1` URL rejected 400.
- Screenshots at 360px read: `/home` renders cleanly (the round "N" is the dev overlay). Public site (`/site/fpcw`, the live site in the dev DB; `alder-creek` is only provisioning there) renders, but the document is ~381px wide at a 360px viewport and the "Need medical equipment" heading is clipped at the right edge. This is site content/CSS, not plausibly related to a Next patch bump, but I did NOT baseline it against 16.3.6; QA may want to.
- `visual-parity`: NOT run; `e2e/.visual` baselines do not exist in this worktree (gitignored, never baselined).

## Release-note skim (Next 16.3.7 / 16.3.8)

16.3.7 is a single Turbopack backport (hang on canceled task). 16.3.8 is security-only: SSRF in Image Optimization (high), metadata-image `dynamicParams` bypass, SSG/ISR cache poisoning (two), `use cache` Draft Mode leak, `use cache` root-param leak, dev MCP disclosure. Repo has no `use cache`, no dynamic metadata image routes (only static `icon.svg`/`apple-icon.png`), and one `remotePatterns` entry; no config or source change needed, and the proxy is unaffected.

## Deviations / notes

- **Flaky-looking first e2e run (resolved, not a regression):** after `next build`, the first dev server failed 32 specs with Turbopack "Can't resolve @vercel/turbopack-next/internal/font/google/font" (Montserrat in the `(org)` layout). After `rm -rf .next` and a fresh dev server the same specs pass on 16.3.8 (and an A/B on 16.3.6 also passed). Cause is a stale `.next` left by a prior `next build` in the same worktree; QA should `rm -rf .next` before starting the dev server.
- Temporary `npm install --no-save next@16.3.6` for the A/B was restored; final `npm ls next` shows 16.3.8.
- pdfkit tracing is not on this branch; re-check audit after the giving PR merges.
- e2e globalSetup re-provisions the e2e fixture users/orgs in the shared development DB (normal for the suite; no schema writes).

## Handoff to QA

1. `cd presby-deps && rm -rf .next && npm ci`; `npm ls next sharp source-map-js` (16.3.8 / 0.35.5 / 1.2.2); `npm audit --omit=dev --audit-level=high` exit 0.
2. `npm run typecheck && npm run lint && npm run check && npm run test -- --no-file-parallelism && npm run build`.
3. Fresh dev server (`RATE_LIMIT_DISABLED=true npm run dev`, free port 3000) then `npx playwright test e2e/post-login-routing.spec.ts e2e/totp-callback-bypass.spec.ts e2e/totp-full-login.spec.ts e2e/role-boundaries.spec.ts e2e/security-headers.spec.ts e2e/public-sites.spec.ts e2e/hydration --project=chromium` (expect 38 passed; MFA-enrolled login is covered by `totp-full-login`); then `npm run test:e2e:prod` (expect 4 passed).
4. `curl` the `/_next/image` checks above. Optionally baseline the 360px overflow on a public site against 16.3.6.
5. `git diff package-lock.json` should show only the packages listed above.

# Phase 5 — Verification (qa) — recorded by the orchestrator

**Date:** 2026-10-19 · **Verified by:** qa (read-only) · **Verdict: PASS.**

- **Scope:** versions-only. `package.json`: version 0.33.0 → 0.33.1, `next` and `eslint-config-next` `^16.3.6` → `^16.3.8`; no `overrides`, no new dependency. Lockfile entry-by-entry: nothing added or removed; only `next`, `@next/env`, `@next/eslint-plugin-next`, `eslint-config-next`, the 8 `@next/swc-*` (16.3.6 → 16.3.8), `sharp` + `@img/sharp-*` (0.35.4 → 0.35.5), `@img/sharp-libvips-*` (1.3.3 → 1.3.4), `source-map-js` (1.2.1 → 1.2.2), and the root entry moved. `npm ci` clean; `npm ls next sharp source-map-js` one version each.
- **Audit gate:** `npm audit --omit=dev --audit-level=high` exit 0 (2 low remain: katex, mermaid via katex); against the pre-fix lockfile exit 1 with 3 high — failing-then-passing evidence for this bug class.
- **Static/build:** typecheck, lint, `npm run check`, build (Next 16.3.8, 40/40 static pages) all exit 0.
- **Unit:** `npm run test -- --no-file-parallelism` 4244 passed, 1182 skipped, 0 failed. QA also ran the DB lane (`npm run test:db`): 5420 passed, 6 failed (`events.test.ts:932/944/973` timeouts; `org-features.test.ts:532` timeout then `:549`/`:558` assertion failures from the still-running loop) — **environmental, reproduces on `main` at 16.3.6** (neither module imports `next`; ~77 ms per round trip; `events.test.ts` alone 53/53 on both trees).
- **E2E dev lane** (QA's server on :3202, `.next` cleared): **38/38** — post-login-routing 12, totp-callback-bypass 7, totp-full-login 1 (MFA-enrolled seeded user: password → rejected wrong code → real TOTP → landing), role-boundaries 5, security-headers 2, public-sites 7, hydration 4. **`npm run test:e2e:prod`: 4/4.**
- **Image optimizer:** `/_next/image` 200 valid 64x64 WebP (sharp works); `lh3.googleusercontent.com` passes the allow-list; `example.com`, loopback, `169.254.169.254`, protocol-relative and a disallowed width are refused with 400.
- **360px `/site/fpcw`: pre-existing, not a regression** — `main` (16.3.6) dev, this branch dev and prod build give identical numbers (layout 381px; the H2 "Need medical equipment?" 341 in a 280 column) and byte-identical screenshots.
- `visual-parity` not run (no baselines exist) — a stated gap.
- **Coverage:** `permissions.ts` 100%, `two-factor.ts` 91.3%, `flags.ts` 100%. **Feature-gate audit:** no protected routes touched.
- **Notes → TODO:** the 360px heading overflow; the DB-lane latency/isolation flakiness; the release note's "tracked separately" claim for katex/mermaid needed an open TODO line (added by the orchestrator below).

**Per-Phase Status:** | 5 — Verification | qa | Complete | PASS | 2026-10-19 |


---

# Phase 6 — Shipped vs Intent (analyst, bug-fix variant) — recorded by the orchestrator

**VERDICT: SHIP WITH NOTES**

> The three high production advisories (`next`, `sharp`, `source-map-js`) are cleared by patch bumps and nothing behaviour-changing shipped, so the CI audit step would now pass. One follow-up is only half tracked.

**Intent vs shipped**
- **CI audit step passes.** Re-ran `npm audit --omit=dev --audit-level=high`: exit 0; only the 2 low advisories remain (`katex`, `mermaid` through it), as Phase 1 predicted. QA recorded the pre-fix lockfile exiting 1 with 3 high (failing-then-passing).
- **No new dependency.** `package.json`: version 0.33.0 → 0.33.1, `next` and `eslint-config-next` `^16.3.6` → `^16.3.8`; no additions, no `overrides`. QA's entry-by-entry lockfile check found only the intended packages and their platform binaries moved.
- **Nothing behaviour-changing.** The diff touches only `package.json`, the lockfile, the release note and the TODO. QA ran typecheck, lint, tripwires, build, 4244 unit tests, the 38-spec dev e2e lane (incl. the MFA-enrolled `totp-full-login`) and the 4-spec prod lane, all green. The image optimizer works and refuses disallowed URLs. The 6 DB-lane failures reproduce on `main`; the 360px overflow is identical on 16.3.6 and 16.3.8.
- **Release note (0.33.1) is honest** for a non-engineer: nothing changes in how the platform looks or behaves; the two remaining low advisories are named as developer-documentation-only, and their "tracked separately" claim now has an open TODO line.
- **`docs/TODO.md` reconciled:** a Done line for the fix; open lines for katex/mermaid, the 360px heading overflow and the DB-lane flakiness.
- **Rules 12–15:** no feedback row; no what's-new entry (security/infrastructure); functionality map and `architecture.md` unaffected.

**Edge cases:** empty state, failure microcopy, permission gate, audit event, mobile — not applicable (the 360px overflow is pre-existing and tracked).

**Follow-ups**
1. Open TODO line: re-run `npm audit --omit=dev --audit-level=high` after the giving branch (pdfkit) merges — added by the orchestrator.
2. `visual-parity` never run (no baselines exist) — a stated gap; no action for this patch bump.
3. Work-log hygiene — the empty template blocks were removed and this section recorded (orchestrator).

**Per-Phase Status:** | 6 — Shipped vs intent | analyst | Complete | SHIP WITH NOTES | 2026-10-19 |
