# Report-only CSP + HSTS preload removal — Work Log

> **Slug:** `2026-07-01-security-headers`
> **Surface:** next.config.ts only
> **Permission(s):** none
> **Flag(s):** not needed
> **Estimated complexity:** small
> **Pipeline mode:** Full (small — phases expected brief)

---

## Per-Phase Status

| Phase | Owner | Status | Verdict | Date |
|-------|-------|--------|---------|------|
| 1 — Functional refinement | analyst | Complete | READY WITH NOTES | 2026-07-01 |
| 2 — Architectural review | architect | Complete | Approved with suggestions | 2026-07-01 |
| 3 — Technical design | tech-lead | Complete | Design complete | 2026-07-01 |
| 4 — Implementation | full-stack-developer | Complete | — | 2026-07-01 |
| 5 — Verification | qa | Complete | PASS | 2026-07-01 |
| 6 — Shipped vs intent | analyst | Complete | SHIP IT | 2026-07-01 |

---

## Intent (harvest Tier 2 #11, 2026-07-01)

Two changes to the starter's security headers in `next.config.ts`, from
fertilityluna (`/Users/cshenso/git/fertilityluna/next.config.ts:3-40`):

1. **Add `Content-Security-Policy-Report-Only`** (+ `frame-ancestors`,
   `base-uri`, `form-action`) — surfaces violations without breaking
   anything, giving forks a tightening path toward an enforced CSP. The
   starter currently ships HSTS/nosniff/frame-options/referrer/permissions
   but no CSP at all.
2. **Drop `preload` from HSTS** — fertilityluna deliberately omits it
   ("until DNS is stable"); preload is a fresh-fork footgun (hard to undo,
   applies domain-wide). Document why in a comment.

Analyst attention: the CSP directives must actually match what the starter
serves (Next.js inline scripts/styles need `'unsafe-inline'`/nonces —
report-only makes this safe to start loose; enumerate what the app loads:
Google OAuth redirects, no external scripts?); whether `allowedDevOrigins`
for Cloudflare tunnels (fertilityluna adds `*.trycloudflare.com`) should
ride along given the user's documented tunnel-based dev flow; verification
strategy (curl the headers on a running dev server; e2e header assertion?).

---

## Phase 1 — Functional Refinement — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

Two infrastructure-only changes to `next.config.ts`: add a
`Content-Security-Policy-Report-Only` header (report-only so no breakage,
but violations surface in devtools and any connected reporting endpoint) and
drop `preload` from the HSTS value. No user-visible flows change, no new
permissions, no new flags. This is a server-response posture change
preparatory to a future enforced CSP.

**Verdict: READY WITH NOTES**

One-line take: safe to ship as-is, but three notes must travel to tech-lead
(frame-ancestors conflict, dev HMR noise, absent report-uri).

### What I did

**Pass 1 — User Verbs**

No user surface changes. There are no verbs: the user never clicks,
types, or reads anything differently. This change is entirely about the
HTTP response headers the server sends.

**Pass 2 — Flow Audit**

Not applicable. No user flow changes.

**Pass 3 — Permissions and Flags**

No new permissions needed. No feature flag needed (report-only CSP has no
rollback risk — if the header is wrong it generates noise in devtools, not
breakage). HSTS preload removal is a pure header value change.

**Pass 4 — Edge Cases**

Enumerated what the starter actually loads (scripts, styles, images, fonts,
connect targets), grounded the directive set, and named the dev/prod
difference for HMR. See Outputs section.

**Pass 5 — Adversarial Pass**

`Content-Security-Policy-Report-Only` cannot be exploited by a user. The
`report-uri` directive (not included here) could theoretically be a vector
if it pointed to a user-controlled host, but no report-uri is proposed.
No adversarial findings.

### Outputs

**What the starter actually loads (resource inventory)**

- Scripts: Next.js runtime inline scripts only (hydration payloads injected
  by the framework as `<script>` tags). No external script CDN. No
  Cloudflare Turnstile. No Stripe. Requires `'unsafe-inline'` in
  `script-src` — nonces are achievable but require per-request middleware
  generation, which is out of scope for a static `next.config.ts` header.
  `'unsafe-inline'` is the correct starter baseline.

- Styles: Tailwind CSS compiled at build time, injected as an inline
  `<style>` block by the framework. No Google Fonts CDN (globals.css
  imports `tailwindcss`, no `@import` for external fonts). Requires
  `'unsafe-inline'` in `style-src`.

- Images: `next.config.ts` has `lh3.googleusercontent.com` in
  `remotePatterns` for the Next.js Image optimizer. The current codebase has
  no component that renders `user.image` at all — the Image optimizer
  proxies Google avatars through `/_next/image?url=...` (same-origin in the
  browser). Include `https://lh3.googleusercontent.com` in `img-src`
  anyway: a fork will add avatar rendering within weeks of cloning, and the
  domain is already declared intent in `remotePatterns`. If omitted, the
  first fork that adds an avatar gets a violation. TOTP enrollment generates
  a QR code via `QRCode.toDataURL()` — a `data:image/png;base64,...` URI —
  so `data:` must be in `img-src`.

- Fonts: self-hosted only. `font-src 'self'` is sufficient.

- Connect targets (browser-side fetch/XHR/WebSocket): All API calls are
  same-origin (`/api/auth/...`, NextAuth callbacks). The Google OAuth flow
  is a server-side redirect sequence — the browser submits to a Next.js
  server action (same-origin) and the server redirects to
  `accounts.google.com`; this is navigation, not a `connect-src` request.
  Neon database and Resend email API are server-side only, never reachable
  from the browser. `connect-src 'self'` is correct.

  Dev caveat: the Next.js HMR WebSocket (`/_next/webpack-hmr`) runs on
  the dev server and generates `connect-src` violations in report-only
  mode. This is noise, not a problem. In prod there is no HMR WebSocket.
  The implementer should expect violation noise in devtools during dev and
  ignore it.

- Frames: no iframes, no embedded widgets. `frame-src 'none'` is appropriate.

**Recommended directive set**

```
default-src 'self'
script-src 'self' 'unsafe-inline'
style-src 'self' 'unsafe-inline'
img-src 'self' data: https://lh3.googleusercontent.com
font-src 'self'
connect-src 'self'
frame-src 'none'
frame-ancestors 'none'
base-uri 'self'
form-action 'self'
```

Differences from fertilityluna's set:
- Remove Cloudflare Turnstile and Stripe script domains from `script-src`
  (starter has neither).
- Narrow `img-src` from `https:` (everything) to
  `https://lh3.googleusercontent.com` (the one external image source in the
  starter's `remotePatterns`).
- Remove `https://fonts.gstatic.com` from `font-src` (no Google Fonts).
- Remove Cloudflare/Stripe `frame-src` entries; add `frame-src 'none'`
  explicitly (no embeds in the starter).

**HSTS value after dropping preload**

`max-age=63072000; includeSubDomains`

Comment to include in code: "preload intentionally omitted — submitting to
the browser preload list is effectively irreversible at the domain level;
add it only after the domain DNS is stable and all subdomains serve HTTPS."
(Mirrors fertilityluna's comment, made starter-generic.)

**allowedDevOrigins**

Include `allowedDevOrigins: ["*.trycloudflare.com"]`. This is a `nextConfig`
property (not a CSP directive) that tells the Next.js dev server to accept
cross-origin asset requests from Cloudflare tunnel hostnames. Without it,
when the app is accessed via a `*.trycloudflare.com` tunnel the dev server
rejects CORS preflight for `/_next/static` assets, client components
don't hydrate, and sign-in is silently broken. The user's documented dev
flow (CLAUDE.md, user memory) uses Cloudflare tunnels.

**Verification strategy**

Primary (durable): Add a Playwright e2e header assertion to the existing
suite. `test.request.get('/')` returns response headers; assert that
`content-security-policy-report-only` is present and non-empty, and that
`strict-transport-security` does not contain the word `preload`. This
lives in the repo and catches any future regression.

Secondary (implementation-time spot check): `curl -sI http://localhost:3000
| grep -iE 'content-security-policy|strict-transport'`. Confirms headers
are set before the e2e suite runs.

Dev vs prod difference: report-only CSP header is emitted in both dev and
prod (it is a static `next.config.ts` header). HMR violation noise appears
only in dev devtools; prod has none. HSTS is only meaningful in prod (HTTPS
only); on the HTTP dev server it is ignored by the browser.

### Open questions / handoff notes

- **frame-ancestors vs X-Frame-Options conflict**: The starter currently
  sends `X-Frame-Options: SAMEORIGIN`. Adding `frame-ancestors 'none'` in
  the CSP is more restrictive. In report-only mode this is harmless (CSP
  doesn't enforce). But when the policy is eventually enforced, `CSP
  frame-ancestors` supersedes `X-Frame-Options` in all modern browsers —
  the two will contradict each other. Tech-lead should either (a) leave the
  conflict as a TODO comment in the enforced-CSP follow-up, or (b) drop
  `X-Frame-Options: SAMEORIGIN` at enforcement time in favor of
  `frame-ancestors 'none'`. For report-only, no action needed now.

- **No report-uri endpoint**: report-only CSP without a `report-uri` or
  `report-to` directive surfaces violations only in the browser's devtools
  console — no aggregation. This is acceptable for a starter (adding an
  endpoint requires a backend route and Tier 2 #11 is already scoped to
  headers only). Forks that want aggregation should add `report-uri
  /api/csp-report` and a corresponding route handler. Tech-lead should add
  a comment in the code pointing forks toward this next step.

- **Dev HMR noise**: The implementer should expect `connect-src` violation
  reports in devtools when running `npm run dev` (the HMR WebSocket fires
  against `ws://localhost:3000/_next/webpack-hmr`). This is noise in
  report-only mode. If a future enforced CSP is added, `connect-src` will
  need `ws://localhost:3000` in the dev build (or a dev/prod config split).

---

## Phase 2 — Architectural Review — 2026-07-01

**Owner:** architect
**Status:** complete

### Summary

Approved with suggestions. The analyst's directive set is grounded in what the starter actually loads (spot-checked: no external font CDN in globals.css; QR codes use `QRCode.toDataURL()` confirming `data:` belongs in `img-src`; `lh3.googleusercontent.com` matches the existing `remotePatterns`). The report-only posture is the correct starter choice — static `next.config.ts` headers cannot generate nonces, so enforced `'unsafe-inline'` would be security theater. HSTS `preload` removal is approved as written. `allowedDevOrigins` for `*.trycloudflare.com` is approved as a dev-only property with zero production impact. `next.config.ts` is the only production-code touch; no new dependencies. DECISION-024 logged.

### What I did

1. Read the Phase 1 output, the Phase 1 directive set, and the current `next.config.ts`.
2. Spot-checked the resource inventory: `globals.css` (`@import "tailwindcss"` only — no Google Fonts CDN); TOTP QR code path (`QRCode.toDataURL()` in two locations — confirms `data:` needed in `img-src`); `next.config.ts` `remotePatterns` (only `lh3.googleusercontent.com` — matches `img-src`).
3. Ruled on each of the five items in scope.
4. Verified no new dependencies, no runtime code, single-file change.
5. Confirmed highest existing decision was DECISION-023; logged DECISION-024.
6. Updated TODO.md in-flight line.

### Rulings

**1. Directive set — Approved.**
Spot-checks confirm the analyst's resource inventory. `script-src 'self' 'unsafe-inline'` is correct for Next.js inline hydration scripts. `style-src 'self' 'unsafe-inline'` is correct for Tailwind's compiled inline style block. `img-src 'self' data: https://lh3.googleusercontent.com` is correct — `data:` is required by `QRCode.toDataURL()` (confirmed in source), and `lh3.googleusercontent.com` matches the existing `remotePatterns`. `font-src 'self'` is correct (no CDN fonts). `connect-src 'self'` is correct (all browser-side fetches are same-origin; Neon and Resend are server-side only). `frame-src 'none'` is correct (no iframes). `frame-ancestors 'none'`, `base-uri 'self'`, and `form-action 'self'` are standard and appropriate.

**2. Report-only posture — Approved.**
`Content-Security-Policy-Report-Only` is the correct header key for the starter. See DECISION-024 for the full rationale. Tech-lead must include a code comment documenting the four-step fork-tightening path (observe → narrow → add nonces → switch header key). The analyst's note about `frame-ancestors 'none'` conflicting with the existing `X-Frame-Options: SAMEORIGIN` when enforcement eventually happens is a real concern — tech-lead must add a TODO comment at the `X-Frame-Options` entry noting that when a fork moves to enforced CSP, `X-Frame-Options` should be dropped in favor of `frame-ancestors`.

**3. HSTS value — Approved.**
`max-age=63072000; includeSubDomains` (63072000 s = 730 days). The analyst's comment text is approved verbatim: "preload intentionally omitted — submitting to the browser preload list is effectively irreversible at the domain level; add it only after the domain DNS is stable and all subdomains serve HTTPS."

**4. allowedDevOrigins — Include it.**
`allowedDevOrigins: ["*.trycloudflare.com"]` is approved for inclusion. This is a Next.js dev-server-only property — Next.js ignores it in production builds. It has zero production impact. The user's documented dev flow (CLAUDE.md, user memory) relies on Cloudflare tunnels; without this entry, the dev server rejects CORS preflight for `/_next/static` assets and client components silently fail to hydrate over the tunnel. The starter is a teaching artifact that explicitly documents the tunnel dev flow, so including this with a comment is the right call. Required comment: "Dev server only — allows cross-origin asset requests from Cloudflare tunnels used in local dev (`cloudflared tunnel --url localhost:3000`). Remove if your fork does not use Cloudflare tunnels."

**5. Invariants — All clear.**
`next.config.ts` is the only production-code touch. No new npm dependencies. No runtime code added — all changes are static string values in the headers config object and a `nextConfig` property. The Phase 5 e2e header assertion is QA scope (not implementation scope), does not violate the single-file constraint for the implementation phase.

### Outputs

- `docs/decisions.md` — DECISION-024 logged (report-only CSP posture; directive set; `allowedDevOrigins` inclusion)
- `docs/work-log/2026-07-01-security-headers.md` — this section
- `docs/TODO.md` — in-flight line updated

### Open questions / handoff notes

- Tech-lead must add the fork-tightening path comment at the CSP header entry in `next.config.ts` (four steps: observe → narrow → nonces → enforce). See DECISION-024.
- Tech-lead must add a TODO comment at the `X-Frame-Options: SAMEORIGIN` entry noting the future conflict with `frame-ancestors 'none'` when enforcement happens — do not remove `X-Frame-Options` now (it still protects browsers that don't process the report-only CSP), but flag it.
- Tech-lead must add the tunnel comment at `allowedDevOrigins` (text specified in Ruling 4 above).
- Tech-lead must add the analyst's `report-uri` follow-up as a comment: forks that want violation aggregation should add `report-uri /api/csp-report` to the directive value and a corresponding route handler.
- Phase 5 (QA) should add a Playwright header assertion: assert `content-security-policy-report-only` is present and non-empty; assert `strict-transport-security` does not contain `preload`. This is the analyst's recommended durable verification strategy.

---

## Phase 3 — Technical Design — 2026-07-01

**Owner:** tech-lead
**Status:** complete

### Summary

Two files change. `next.config.ts` gets four surgical edits: (1) a HSTS value with `preload` removed and an approved comment; (2) a TODO comment at `X-Frame-Options` flagging the future enforcement conflict; (3) a new `Content-Security-Policy-Report-Only` entry with the approved directive string and all required comments; (4) `allowedDevOrigins` on `nextConfig` with the tunnel comment. A new `e2e/security-headers.spec.ts` provides the durable Playwright verification. No other files change. Not auth-touching — standard Phase 4 gate applies.

### What I did

1. Read Phase 1 and Phase 2 outputs, the current `next.config.ts`, existing e2e spec filenames, and `docs/TODO.md`.
2. Determined exact placement for every comment and value in `next.config.ts`.
3. Decided on a new dedicated spec file (`e2e/security-headers.spec.ts`) rather than adding to an existing behavioral spec.
4. Named the implementer, sequencing note, and Phase 4 gate.

### Outputs

- `docs/work-log/2026-07-01-security-headers.md` — this section (status row updated to Complete)
- `docs/TODO.md` — in-flight line updated to "Phase 3 complete, advancing to full-stack-developer"
- No `docs/decisions.md` entry needed (DECISION-024 covers all implementation decisions; no new ones)

---

### Exact `next.config.ts` diff

The implementer produces this file verbatim (full rewrite shown for clarity; the diff is small):

```typescript
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // TODO: When moving to an enforced CSP, drop this header in favor of `frame-ancestors` in the
  // CSP directive. `frame-ancestors` supersedes X-Frame-Options in modern browsers; the current
  // report-only CSP creates no conflict, but an enforced `frame-ancestors 'none'` and this header
  // contradict each other. Drop X-Frame-Options at enforcement time.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  {
    key: "Strict-Transport-Security",
    // preload intentionally omitted — submitting to the browser preload list is effectively
    // irreversible at the domain level; add it only after the domain DNS is stable and all
    // subdomains serve HTTPS.
    value: "max-age=63072000; includeSubDomains",
  },
  {
    key: "Content-Security-Policy-Report-Only",
    // Fork-tightening path (four steps):
    // 1. Deploy report-only. Observe violations in devtools or a report-uri aggregation endpoint.
    //    To collect violations server-side, add `report-uri /api/csp-report` to the value below
    //    and create a matching route handler at src/app/api/csp-report/route.ts.
    // 2. Narrow directives based on observed violations. For any new external script or font, add
    //    the domain explicitly rather than keeping 'unsafe-inline'.
    // 3. Add nonce generation in src/proxy.ts (or middleware.ts) and pass the nonce to <Script>
    //    components. Remove 'unsafe-inline' from script-src.
    // 4. Rename this header key from Content-Security-Policy-Report-Only to
    //    Content-Security-Policy.
    //
    // Dev note: the Next.js HMR WebSocket (ws://localhost:<port>/_next/webpack-hmr) generates
    // connect-src violation noise in devtools during `npm run dev`. This is expected; ignore it.
    // A future enforced CSP will need `ws://localhost:<port>` in connect-src for dev builds.
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://lh3.googleusercontent.com; font-src 'self'; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  // Dev server only — allows cross-origin asset requests from Cloudflare tunnels used in local
  // dev (`cloudflared tunnel --url localhost:3000`). Remove if your fork does not use Cloudflare
  // tunnels.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
```

---

### New spec file: `e2e/security-headers.spec.ts`

```typescript
import { test, expect } from "@playwright/test";

// Header assertions run against the dev server (npm run dev).
// HSTS is ignored by browsers on HTTP but Next.js still emits the header — the assertion
// checks header presence and value string, not browser enforcement.
// CSP-Report-Only connect-src violation noise (HMR WebSocket) is expected in dev devtools
// and does not affect these assertions.

test.describe("Security headers", () => {
  test("Content-Security-Policy-Report-Only is present and non-empty", async ({
    request,
  }) => {
    const response = await request.get("/");
    const csp = response.headers()["content-security-policy-report-only"];
    expect(csp).toBeTruthy();
    expect(csp.length).toBeGreaterThan(0);
  });

  test("Strict-Transport-Security does not include preload", async ({
    request,
  }) => {
    const response = await request.get("/");
    const hsts = response.headers()["strict-transport-security"];
    expect(hsts).toBeTruthy();
    expect(hsts).not.toContain("preload");
  });
});
```

---

### Spec-file decision

New dedicated file `e2e/security-headers.spec.ts` — not an addition to an existing spec. Rationale: all existing specs are login-flow or behavioral feature tests (`admin-login`, `role-boundaries`, `forgot-password`, etc.). HTTP header assertions are infrastructure-level, not user-flow. A dedicated spec isolates failures clearly and can be updated or disabled without touching behavioral coverage.

---

### Test plan

**Implementation-time spot check (curl):**

```bash
# Start dev server first; confirm it's on 3000 (or 3100 if 3000 is occupied by feedback QA)
curl -sI http://localhost:3000 | grep -iE 'content-security-policy|strict-transport'
```

Expected output:
```
content-security-policy-report-only: default-src 'self'; script-src ...
strict-transport-security: max-age=63072000; includeSubDomains
```

Confirm: `preload` is absent from the HSTS line. Confirm: the CSP-RO line is present.

**Durable e2e (Playwright):**

```bash
npm run test:e2e -- e2e/security-headers.spec.ts
```

Both assertions must pass against the dev server. Dev vs prod caveat: HSTS has no effect on HTTP (dev), but the header value is still sent — the assertion checks the string, which is stable in both environments. The CSP-RO header is emitted identically in dev and prod.

**Phase 4 gate (not auth-touching):**

- `npm run typecheck` — passes
- `npm run build` — passes
- `npm run check:audit` — zero violations (no mutations in this change)
- `npm run test:e2e -- e2e/security-headers.spec.ts` — both assertions pass

No full-login-path e2e required (not auth-touching).

---

### Sequencing note

Check dev-server ports before starting. The feedback feature is in Phase 5 (QA), which may have a dev server on port 3000. Use `lsof -ti:3000` to check; if occupied, start the dev server on port 3100 (`npm run dev -- --port 3100`) and adjust the curl spot check accordingly. Playwright uses the `baseURL` from `playwright.config.ts` — verify it matches the port in use before running e2e.

### Open questions / handoff notes

- Use the **full-stack-developer** agent for Phase 4. Two files, no API surface, no React components, no schema. Splitting is unnecessary.
- The exact diff above is the complete implementation. No design ambiguity remains.
- After Phase 4 complete, hand to **qa** for Phase 5. QA runs `npm run test:e2e -- e2e/security-headers.spec.ts` plus typecheck and build. Phase 4 gate is standard (not auth-touching); QA issues PASS without requiring a full-login e2e.
- After QA PASS, hand to **analyst** for Phase 6.

---

## Phase 4 — Implementation (full-stack) — 2026-07-01

**Owner:** full-stack-developer
**Status:** complete

### Summary

Applied four surgical edits to `next.config.ts` exactly as specified in Phase 3 and created the new `e2e/security-headers.spec.ts`. Typecheck, lint, audit check, and production build all pass clean. Dev server curl spot-check confirmed both headers emitted correctly. Both Playwright assertions pass in 330 ms.

### What I did

- Rewrote `next.config.ts` with the Phase 3 verbatim diff: HSTS `preload` removed with approved comment; X-Frame-Options TODO comment added; CSP-Report-Only entry with ten directives and all four comments (fork-tightening path, report-uri note, HMR noise note, dev note); `allowedDevOrigins` with tunnel comment.
- Created `e2e/security-headers.spec.ts` with two assertions (CSP-RO present/non-empty; HSTS lacks `preload`) and the dev/prod caveat comment from Phase 3.
- Ran `npm run typecheck` — clean (no output = pass).
- Ran `npm run lint` — clean (exit 0).
- Ran `npm run check:audit` — "Audit-coverage check passed."
- Ran `npm run build` — clean, 19 pages generated.
- Started dev server on port 3000 (port was free); ran curl spot-check:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains
Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://lh3.googleusercontent.com; font-src 'self'; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

- Ran `npx playwright test e2e/security-headers.spec.ts` — 2 passed (330 ms).

### Outputs

- `next.config.ts` — rewritten with four edits (HSTS preload removal, X-Frame-Options TODO, CSP-RO entry, allowedDevOrigins)
- `e2e/security-headers.spec.ts` — new file, two assertions
- `docs/work-log/2026-07-01-security-headers.md` — this section; Phase 4 row updated to Complete / 2026-07-01
- `docs/TODO.md` — Phase 4 in-flight line updated

### Open questions / handoff notes

- No open questions. Implementation matches the Phase 3 spec exactly.
- Hand to **qa** for Phase 5. Gate is standard (not auth-touching). QA should run `npx playwright test e2e/security-headers.spec.ts` plus `npm run typecheck` and `npm run build`. Both already pass; Phase 5 is a re-verification, not discovery.
- After QA PASS, hand to **analyst** for Phase 6.

---

## Phase 5 — Verification — 2026-07-01

**Owner:** qa
**Status:** complete

### Summary

PASS. All shared checks and per-pipeline checks passed. The `next.config.ts` implementation matches the Phase 3 spec exactly: ten CSP-RO directives, HSTS without `preload`, all required comments (fork-tightening path, report-uri note, HMR noise note, X-Frame-Options TODO, `allowedDevOrigins` tunnel comment), and `allowedDevOrigins` confirmed dev-only. The new `e2e/security-headers.spec.ts` passes in the live e2e suite. Curl evidence confirms both headers are emitted correctly by the dev server.

### What I did

- Ran `npm run typecheck` — PASS (no output = clean).
- Ran `npm run lint` — PASS (exit 0, 0 warnings).
- Ran `npm run test` — PASS (310/310, 490 ms).
- Ran `npm run check:audit` — PASS ("Audit-coverage check passed").
- Ran `npm run build` — PASS (21 routes generated, production build clean).
- Killed stale port-3000 processes, started `npm run dev` in background, confirmed HTTP 200.
- Ran `curl -sI http://localhost:3000 | grep -iE 'content-security|strict-transport'` — both headers present (see curl evidence below).
- Ran `npx playwright test` against the live dev server — 30/30, including tests 27 and 28 (security-headers.spec.ts).
- Killed dev server.
- Verified `next.config.ts` against DECISION-024 directive set: 10 directives exact, order and values match the approved set.
- Verified HSTS value is `max-age=63072000; includeSubDomains` — `preload` is absent.
- Verified all required comments are present: preload rationale, X-Frame-Options TODO, fork-tightening path (4 steps), report-uri follow-up note, HMR noise dev note, `allowedDevOrigins` tunnel comment.
- Confirmed `allowedDevOrigins: ["*.trycloudflare.com"]` is on the `nextConfig` object, not in the `securityHeaders` array — Next.js dev-server-only property, no production effect.
- Confirmed no `console.log`, native dialogs, or `toLocale*` introduced in the pipeline's files.
- Ran feature-gate audit: no new protected routes or server actions in this pipeline.

### Outputs

- `docs/work-log/2026-07-01-security-headers.md` — Phase 5 section appended; Per-Phase Status row updated to Complete / PASS / 2026-07-01
- `docs/TODO.md` — In Flight line updated to Phase 5 complete, advancing to Phase 6

### Curl evidence

```
Strict-Transport-Security: max-age=63072000; includeSubDomains
Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://lh3.googleusercontent.com; font-src 'self'; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

`preload` is absent from the HSTS line. CSP-RO is present. Ten directives confirmed.

### Shared verification counts

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (0 warnings) |
| `npm run test` | PASS — 310/310 (490 ms) |
| `npm run check:audit` | PASS |
| `npm run build` | PASS — 21 routes |
| `npx playwright test` (30 tests) | PASS — 30/30 (26.8 s) |

### Feature-Gate Audit

No protected routes touched. `next.config.ts` and `e2e/security-headers.spec.ts` are the only files this pipeline changes. No `auth()` check or `hasFeature()` check is required.

### Regression tests added

None required beyond the new spec. The existing `e2e/security-headers.spec.ts` (tests 27–28) now permanently guards: (1) CSP-RO header is present and non-empty; (2) HSTS does not contain `preload`. These tests live in the repo and catch any future regression in `next.config.ts`.

### Open questions / handoff notes

- Next agent: **analyst** (Phase 6). QA verdict is PASS; pipeline may advance.
- No open questions. Implementation matches DECISION-024 and the Phase 3 spec exactly.

---

## Phase 6 — Shipped vs Intent — 2026-07-01

**Owner:** analyst
**Status:** complete

### Summary

SHIP IT. The shipped `next.config.ts` is a byte-for-byte match to the Phase 3 spec and the Phase 1 directive set. All ten CSP-RO directives are present and correctly grounded in the starter's resource inventory. HSTS drops `preload` with the approved comment. All six required comment obligations ship in the file. `allowedDevOrigins` is on the `nextConfig` object (not in `securityHeaders`) — dev-server-only, zero production impact. `e2e/security-headers.spec.ts` provides permanent regression coverage on both header values. No follow-ups required.

### What I did

Verified the shipped `next.config.ts` and `e2e/security-headers.spec.ts` against the Phase 1 directive inventory, Phase 2 rulings, and Phase 3 verbatim spec.

**Directive set** (Phase 1 said X; shipped Y):
Ten directives: `default-src 'self'`, `script-src 'self' 'unsafe-inline'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: https://lh3.googleusercontent.com`, `font-src 'self'`, `connect-src 'self'`, `frame-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`. Matches Phase 1 spec exactly.

**HSTS value:** `max-age=63072000; includeSubDomains` — `preload` absent. Matches.

**allowedDevOrigins:** `["*.trycloudflare.com"]` on `nextConfig` (not in `securityHeaders` array). Dev-server-only property confirmed. Matches.

**Comment obligations — all six present:**
1. HSTS preload rationale (`next.config.ts` lines 17-19) — matches approved text verbatim.
2. X-Frame-Options enforcement-time TODO (lines 5-8) — matches Phase 2 ruling text verbatim.
3. Four-step fork-tightening path (lines 24-34) — all four steps present.
4. report-uri follow-up note — embedded in step 1 of the fork-tightening comment (lines 25-27). Present.
5. HMR noise dev note (lines 35-37) — present.
6. `allowedDevOrigins` tunnel comment (lines 52-54) — matches Phase 2 ruling 4 approved text verbatim.

**e2e spec:** `e2e/security-headers.spec.ts` — two tests matching Phase 3 spec: (1) `content-security-policy-report-only` is truthy and non-empty; (2) `strict-transport-security` does not contain `preload`. Both passed in QA's 30/30 run.

### Outputs

- `docs/work-log/2026-07-01-security-headers.md` — Phase 6 section appended; Per-Phase Status row 6 updated to Complete / SHIP IT / 2026-07-01
- `docs/TODO.md` — In Flight line moved to Done

### Intent-vs-shipped diff

| Item | Phase 1 / Phase 3 said | Shipped | Verdict |
|---|---|---|---|
| CSP-RO directive set | 10 directives (exact values specified) | 10 directives, values match | matches |
| HSTS value | `max-age=63072000; includeSubDomains` | `max-age=63072000; includeSubDomains` | matches |
| HSTS `preload` absent | absent | absent | matches |
| `allowedDevOrigins` on `nextConfig` | `["*.trycloudflare.com"]` | `["*.trycloudflare.com"]` | matches |
| HSTS preload rationale comment | approved text | present verbatim | matches |
| X-Frame-Options TODO comment | approved text | present verbatim | matches |
| Four-step fork-tightening path | 4 numbered steps + embedded report-uri note | 4 steps + report-uri note present | matches |
| HMR noise dev note | present | present | matches |
| `allowedDevOrigins` tunnel comment | approved text | present verbatim | matches |
| `e2e/security-headers.spec.ts` | two assertions | two assertions, passing 30/30 | matches |

### Edge cases

| Check | Result |
|---|---|
| Empty state | not applicable — infrastructure change, no user-visible surface |
| Failure microcopy | not applicable — HTTP headers, no UI |
| Permission gate | not applicable — no permissions involved |
| Audit event | not applicable — no security-sensitive mutation |
| Mobile | not applicable — HTTP response header change, no layout |

### Open questions / handoff notes

None. Pipeline closed.
