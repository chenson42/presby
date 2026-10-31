import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import path from "node:path";
// host.ts is PURE and imports nothing (Phase 3 API Contract section 1): it is
// one of the only src/lib/domains files this config (and src/proxy.ts) may
// import. Nothing else from src/lib/domains may be imported here.
import { assertPlatformHostConfig, isProductionDeployment, platformHosts } from "./src/lib/domains/host";
// select.ts (with registry.ts and types.ts) is PURE and imports one another by RELATIVE path
// only, because this config is loaded outside the `@/` alias (config-imports.test.ts pins it).
import { helpRedirects } from "./src/lib/help/select";

// Boot assertion (R2, T8): a production DEPLOYMENT (VERCEL_ENV, not NODE_ENV -
// `next build` always sets NODE_ENV=production, and CI and local builds use
// http://localhost:3000) must name its platform host, over https, and must not
// carry any of the dev/test-only domain fakes. A host outside the set is a
// custom host, so a misconfiguration 404s the platform; it can never serve
// platform routes on a church's domain. Throws, naming the variable.
if (isProductionDeployment()) assertPlatformHostConfig(process.env);

/**
 * A regex source matching exactly the platform-host set (R2), for the `host`
 * condition of `redirects()` / `headers()`. Built at config time from the same
 * `platformHosts()` the proxy uses, so the two cannot drift: the exact hosts
 * (the host of NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_PLATFORM_HOSTS, and outside a
 * production deployment loopback and DEV_ALLOWED_ORIGINS), `*.vercel.app`, and
 * outside production `*.trycloudflare.com`. Next matches `host` WITHOUT the
 * port, so none is needed here.
 */
function platformHostPattern(): string {
  const escape = (host: string) => host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alternatives = [...platformHosts()].map(escape);
  alternatives.push("[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.vercel\\.app");
  if (!isProductionDeployment()) {
    alternatives.push("[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.trycloudflare\\.com");
  }
  return `(?:${alternatives.join("|")})`;
}
const PLATFORM_HOST = platformHostPattern();

// The one policy string. Served REPORT-ONLY everywhere (the securityHeaders entry below) and
// ENFORCED on the online-giving routes (giveRouteHeaders, below it): the same text, so what the
// whole site reports is exactly what the money pages enforce.
//
// Why the give pages enforce (docs/work-log/2026-10-15-online-giving.md, Batch 4; R7/G30/SAQ-A):
//   - NO Stripe origin appears anywhere. A donor reaches Checkout by a top-level REDIRECT
//     (a server action returns a URL; the client re-asserts its origin and calls
//     window.location.assign), which needs no CSP allowance. Stripe.js and Stripe iframes are
//     never loaded on a presby page, and `check:giving-boundaries` B7 fails the build if a
//     `stripe.com` ever appears in default-src / script-src / script-src-elem / frame-src /
//     child-src / form-action.
//   - `form-action 'self'` is unchanged: <HydrationGate> makes a native form POST impossible,
//     and this directive would refuse a form that posted off-origin anyway.
//   - `frame-ancestors 'none'` on an ENFORCED policy forbids framing the give page, which is
//     what X-Frame-Options (SAMEORIGIN, below) approximates; the two do not conflict on a page
//     nothing should embed.
//   - DEVELOPMENT ONLY, `script-src` also gets 'unsafe-eval'. React's dev build evals to rebuild
//     component call stacks (Next's own CSP guide says the same), and an ENFORCED policy turns that
//     from report noise into a thrown EvalError. It is appended to the one shared string, so the
//     report-only and enforced headers stay identical in every mode, and `next build` (NODE_ENV
//     production) emits neither the keyword nor anything else different.
const baseContentSecurityPolicy =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://lh3.googleusercontent.com; font-src 'self'; connect-src 'self'; frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com https://player.vimeo.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
// (Both literals below name `script-src` on purpose: check:giving-boundaries B7 finds a policy
// string by its directive names, so a policy-shaped literal must carry one to be scanned.)
const contentSecurityPolicy =
  process.env.NODE_ENV === "production"
    ? baseContentSecurityPolicy
    : baseContentSecurityPolicy.replace(
        "script-src 'self' 'unsafe-inline'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      );

// HSTS is split by host (F147, DECISION-178). `includeSubDomains` on every response would pin
// HTTPS for ALL of a church's subdomains for two years on whatever apex it connects, and outlive
// the church's departure - so a platform host keeps it and every other host gets Vercel's own
// default for custom domains (no `includeSubDomains`). preload intentionally omitted on both -
// submitting to the browser preload list is effectively irreversible at the domain level; add it
// only after the domain DNS is stable and all subdomains serve HTTPS.
const hstsPlatform = {
  key: "Strict-Transport-Security",
  value: "max-age=63072000; includeSubDomains",
};
const hstsCustomHost = {
  key: "Strict-Transport-Security",
  value: "max-age=63072000",
};

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
    // Cloudflare Turnstile: remove https://challenges.cloudflare.com from script-src
    // and restore frame-src 'none' if not using NEXT_PUBLIC_TURNSTILE_SITE_KEY.
    //
    // connect-src does NOT include Cloudflare: the Turnstile iframe's outbound
    // fetches are governed by the iframe's own CSP (set by Cloudflare), not the
    // parent page's connect-src. Parent JS does not XHR to Cloudflare directly.
    value: contentSecurityPolicy,
  },
];

// An ENFORCED Content-Security-Policy for the online-giving routes only (Batch 4). The
// report-only header above still applies to them too (Next merges matching entries), so a
// violation is both blocked and reported. Everything else on the site stays report-only.
const giveRouteHeaders = [{ key: "Content-Security-Policy", value: contentSecurityPolicy }];

// The account-invitation routes (DECISION-183/185, R6): the accept URL carries a bearer credential
// in its query string, so a browser must not send it onward in a Referer header, must not cache the
// page, and a crawler must not index it. Applied AFTER the catch-all securityHeaders entry below
// (`headers()` entries merge in order and the later value for a key wins), so `no-referrer` replaces
// the site-wide `strict-origin-when-cross-origin` here and nowhere else. Scoped to PLATFORM hosts
// like the HSTS split: a church's custom host never serves /invite (the proxy 404s it first).
const inviteRouteHeaders = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cache-Control", value: "no-store" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  // Widens Turbopack's project-root inference to this repo's own PARENT
  // directory — not a hardcoded absolute path, so this is safe to commit
  // and harmless for anyone who clones presby anywhere. Needed for local
  // dev where presby-site-kit is npm-linked from a sibling repo
  // (~/git/presby-platform/presby-site-kit convention): that's a real
  // symlink pointing OUTSIDE presby's own directory, and Turbopack's
  // default root inference refuses to resolve a symlinked module living
  // outside the inferred workspace root, even though Node's own
  // require.resolve() finds it without any trouble. In CI/production,
  // presby-site-kit installs normally (no symlink) and this setting has
  // no effect either way.
  turbopack: {
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  },
  // /orgs is retired (docs/work-log/2026-08-27-platform-home-and-portal.md,
  // DECISION-124): its content is absorbed into /home behind
  // `platform.merged_home`. A permanent (308) config-level redirect, never
  // entering the React render pipeline — no Suspense boundary to accidentally
  // open on a segment whose whole job would otherwise be to redirect.
  //
  // Scoped to PLATFORM hosts (F151): `redirects()` runs before the proxy, so unscoped it would
  // answer on a church's domain. On a custom host `/orgs` falls through to the proxy's rewrite
  // and is the same neutral 404 as any other path the church's site does not have.
  async redirects() {
    return [
      {
        source: "/orgs",
        has: [{ type: "host", value: PLATFORM_HOST }],
        destination: "/home",
        permanent: true,
      },
      // The admin people section moved from its old "members" path to `/admin/community`
      // (docs/work-log/2026-10-22-founding-admin-directory.md, Batch M; DECISION-201).
      // The same permanent, platform-host-scoped shape as `/orgs` above (F151): on a custom
      // host this falls through to the proxy's neutral 404. `:path*` carries the sub-paths
      // (`new`, `pending`, `children`, `<id>/edit/...`) and Next preserves the query string.
      {
        source: "/o/:slug/admin/members/:path*",
        has: [{ type: "host", value: PLATFORM_HOST }],
        destination: "/o/:slug/admin/community/:path*",
        permanent: true,
      },
      // Retired help URLs (a page's `aliases` and the planned slugs it `replaces`, P3-7). Each
      // entry is host-scoped to the platform (F151) by helpRedirects(). None exists at first
      // release; the rule is that a published help URL never 404s once it has been live.
      ...helpRedirects(PLATFORM_HOST),
    ];
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      { source: "/(.*)", has: [{ type: "host", value: PLATFORM_HOST }], headers: [hstsPlatform] },
      { source: "/(.*)", missing: [{ type: "host", value: PLATFORM_HOST }], headers: [hstsCustomHost] },
      // Exact paths, no wildcard: /invite and /invite/accepted are the only invitation routes.
      { source: "/invite", has: [{ type: "host", value: PLATFORM_HOST }], headers: inviteRouteHeaders },
      { source: "/invite/accepted", has: [{ type: "host", value: PLATFORM_HOST }], headers: inviteRouteHeaders },
      // `:path*` matches zero or more segments, so these cover /site/<slug>/give itself AND
      // /site/<slug>/give/return (and the member equivalents). Do not widen to /site/:slug/* -
      // a congregation's own pages keep the report-only policy.
      { source: "/site/:slug/give/:path*", headers: giveRouteHeaders },
      { source: "/o/:slug/giving/give/:path*", headers: giveRouteHeaders },
      // A custom host serves the same pages at CLEAN paths: `headers()` matches the INCOMING path,
      // before the proxy's rewrite, so /give and /give/return on a church's domain would otherwise
      // get only the report-only policy (T13, F151). Host-agnostic on purpose; on a platform host
      // this path is a 404 and the header is harmless.
      { source: "/give/:path*", headers: giveRouteHeaders },
    ];
  },
  // Year-end contribution statements (docs/work-log/2026-10-15-online-giving.md, Batch 5;
  // DECISION-174). PDFKit is NOT in Next's built-in external list (only @react-pdf/renderer
  // is), and it reads its standard-14 AFM metrics with __dirname-relative fs calls, which a
  // bundled copy cannot resolve. Kept external, it is required from node_modules at runtime.
  serverExternalPackages: ["pdfkit"],
  // ...and its data files, plus the committed OFL font (src/lib/giving/statements/fonts/,
  // FONT-SOURCE.txt), are copied into every function that renders a statement. Keys are
  // picomatch route globs with `contains`, so this one covers the treasurer statements page
  // (issue / re-issue server actions) and every route beneath it (download, print run).
  // A renderer reached from any other route must add its own key here.
  outputFileTracingIncludes: {
    "/o/*/admin/giving/statements": [
      "./src/lib/giving/statements/fonts/**/*",
      "./node_modules/pdfkit/js/data/**/*",
    ],
    // The reimbursement print route (Treasury Inc 1, Batch 7; Copy C11) draws the same Noto Sans
    // from the same directory (src/lib/reimbursement/print.ts reads it from process.cwd()).
    "/o/*/reimbursements/*/print": [
      "./src/lib/giving/statements/fonts/**/*",
      "./node_modules/pdfkit/js/data/**/*",
    ],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  // Dev server only. Next blocks cross-origin requests for /_next/* assets, so
  // reaching the dev server from anything other than localhost — a phone on the
  // LAN, a Cloudflare tunnel — serves the server-rendered HTML but never the JS.
  //
  // The page then looks fine and is silently dead: no hydration means no
  // onChange, so controlled inputs never update state and every submit button
  // stays disabled forever. Worth knowing, because it presents as a broken form
  // rather than as a network error.
  //
  // Set DEV_ALLOWED_ORIGINS to a comma-separated list (e.g. your LAN IP) rather
  // than hardcoding a machine-specific address here.
  //
  // "**.invalid" (recursive: `www.church-one.invalid` is three labels, which `*.invalid` would not match) is the reserved TLD the custom-domain e2e project maps to loopback
  // (`--host-resolver-rules`, playwright.config.ts) so a real browser can load a church host and
  // hydrate against `next dev`. RFC 2606 guarantees `.invalid` never resolves on the public
  // internet, and this list has no effect outside `next dev`.
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "**.invalid",
    ...(process.env.DEV_ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
  ],
};

export default nextConfig;
