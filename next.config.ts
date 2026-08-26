import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
    value:
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://lh3.googleusercontent.com; font-src 'self'; connect-src 'self'; frame-src https://challenges.cloudflare.com https://www.youtube-nocookie.com https://player.vimeo.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  },
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
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
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
