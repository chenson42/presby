import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
  async redirects() {
    return [{ source: "/orgs", destination: "/home", permanent: true }];
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      // `:path*` matches zero or more segments, so these cover /site/<slug>/give itself AND
      // /site/<slug>/give/return (and the member equivalents). Do not widen to /site/:slug/* -
      // a congregation's own pages keep the report-only policy.
      { source: "/site/:slug/give/:path*", headers: giveRouteHeaders },
      { source: "/o/:slug/giving/give/:path*", headers: giveRouteHeaders },
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
  allowedDevOrigins: [
    "*.trycloudflare.com",
    ...(process.env.DEV_ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? []),
  ],
};

export default nextConfig;
