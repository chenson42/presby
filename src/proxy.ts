import { NextResponse, type NextRequest } from "next/server";
import { edgeAuth } from "@/lib/auth/config";
import { isCronRequest } from "@/lib/domains/cron-passthrough";
import { isPlatformHost, requestHost, siteKeyRewritePath } from "@/lib/domains/host";
import { PROBE_ACK_HEADER, PROBE_REQUEST_HEADER, answerProbe } from "@/lib/domains/probe";
import { ADMIN_ROLE, FEATURES } from "@/lib/permissions";

const PUBLIC_PATHS = new Set([
  "/",
  "/signin",
  "/totp",
  "/access-pending",
  "/robots.txt",
  "/sitemap.xml",
  "/forgot-password",
  "/reset-password",
  // Statistical-return submission grants (D16 / DECISION-147) — a public,
  // session-less, token-authenticated write path on the `(password-reset)`
  // pattern. EXACT paths only, no prefix: a token-bearing path in a `Set`
  // entry cannot be reached by a `startsWith`-style bypass the way `/site/`
  // needs. See docs/work-log/2026-09-25-submission-grants.md Phase 2.
  "/file-statistics",
  "/file-statistics/submitted",
  // Account invitations (DECISION-183/185, docs/work-log/2026-10-21-
  // invitations.md) - the public, token-consuming `(invite)` flow. EXACT paths
  // again, for the same reason: the token rides the query string (or the
  // host-only, `Path=/` hand-off cookie - `/` because a server-action redirect
  // renders its target inside the action's own POST, addendum 2), so no prefix
  // may admit a sibling path. The proxy never reads that cookie.
  // BOTH signed-in and anonymous visitors reach /invite (Flow 4 needs the
  // session), so the page - not the proxy - reads auth() and enforces the
  // email match and the 2FA-verified session (G9). On a church's custom host
  // the first branch above returns before this set is consulted, so neither
  // path exists there.
  "/invite",
  "/invite/accepted",
]);

const PROTECTION_RULES: Array<{ pattern: RegExp; required: string }> = [
  { pattern: /^\/admin\/users/, required: FEATURES.ADMIN_USERS },
  { pattern: /^\/admin\/flags/, required: FEATURES.ADMIN_FLAGS },
  { pattern: /^\/admin\/docs/, required: FEATURES.ADMIN_RELEASE_NOTES },
  { pattern: /^\/admin/, required: FEATURES.ADMIN_DASHBOARD },
];

/**
 * `/site/<segment containing a dot>` is the INTERNAL rewrite target of a
 * custom host (`/site/church-one.example/about`). On a platform host it must
 * not be reachable at all: the site key is a lookup key, and a platform-host
 * request naming a dotted key would be a second way to ask the host resolver a
 * question the visitor's own Host header is supposed to be the only input to.
 * `%2e` / `%2E` count as a dot. The resolver independently requires
 * `Host === key` (host mode) and a platform Host (slug mode), so this is the
 * first of two locks, not the only one (Phase 2 R1, adversarial A3).
 */
const DOTTED_SITE_KEY = /^\/site\/[^/]*(?:\.|%2e)/i;

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // THE FIRST BRANCH (DECISION-176, Phase 2 R1). It runs before the /api/
  // bypass, the /site bypass and PUBLIC_PATHS, because every one of those is
  // a statement about PLATFORM routes and none of them may be true of a
  // church's domain.
  //
  // A host is a LOOKUP KEY, never an identity (R3): requestHost() reads the
  // `host` header and nothing else - never x-forwarded-host, forwarded or
  // nextUrl.host - and this branch decides on host SHAPE and platform-set
  // membership only. It never reads the database (the proxy stays a pure
  // function of host, path and session claims - DECISION-177), never calls
  // edgeAuth(), never reads a cookie, and has no other branch. Which hosts are
  // real tenants is answered later, by one SECURITY DEFINER read that
  // collapses every non-serving state to the same neutral 404.
  const host = requestHost(req.headers);
  if (host === null) return new NextResponse(null, { status: 404 });

  if (!isPlatformHost(host)) {
    // The live-ness probe (T1): a valid `nonce.mac` for EXACTLY this host gets
    // a bodiless 204 carrying the ack. Reveals only "this host routes to this
    // deployment"; reads no tenant row; sets no cookie.
    const ack = answerProbe(host, req.headers.get(PROBE_REQUEST_HEADER));
    if (ack !== null) {
      return new NextResponse(null, { status: 204, headers: { [PROBE_ACK_HEADER]: ack } });
    }
    // A6: Vercel does not say which host a scheduled invocation uses. An exact
    // cron path carrying the exact bearer passes straight through; everything
    // else on /api/* falls to the rewrite below and is the same neutral 404.
    if (isCronRequest(pathname, req.headers.get("authorization"), process.env.CRON_SECRET)) {
      return NextResponse.next();
    }
    return NextResponse.rewrite(
      new URL(siteKeyRewritePath(host, pathname) + req.nextUrl.search, req.url),
    );
  }

  // Platform host: today's logic, plus the internal site-key target is not
  // addressable from here.
  if (DOTTED_SITE_KEY.test(pathname)) return new NextResponse(null, { status: 404 });

  if (pathname.startsWith("/api/")) return NextResponse.next();
  if (pathname.startsWith("/account/verify-email/")) return NextResponse.next();
  // Public organization websites (DECISION-085) — fully anonymous by
  // construction, matching DECISION-041's contract. /site/<slug> never
  // reaches edgeAuth(), the 2FA gate, or PROTECTION_RULES below. Without
  // this bypass every anonymous visitor is redirected to /signin, which is
  // exactly backwards for a public route. See
  // docs/work-log/2026-08-20-public-sites.md Phase 3, "src/proxy.ts fix —
  // exact diff".
  if (pathname === "/site" || pathname.startsWith("/site/")) return NextResponse.next();
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const session = await edgeAuth();
  if (!session?.user) {
    const url = new URL("/signin", req.url);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }
  if (session.user.isActive === false) {
    const url = new URL("/signin", req.url);
    url.searchParams.set("error", "deactivated");
    return NextResponse.redirect(url);
  }

  // /o/* — THE ORG PORTAL. Authentication, active status, and 2FA at the Edge
  // and NOTHING ELSE.
  //
  // DO NOT add a PROTECTION_RULES entry for it. That is the obvious-looking
  // move and it is wrong twice: FEATURES.* is the PLATFORM axis and org
  // membership is the TENANT axis (see the two scopes documented at
  // src/lib/authz.ts), and the Edge cannot reach the database to check
  // membership anyway. Authorization is resolveOrgContext() + withOrgContext()
  // in the RSC layer, per DECISION-035 — the Edge not being able to pre-filter
  // /o/<slug> by membership is correct, not a limitation.
  //
  // The 2FA gate covers /o/* from the start (DECISION-037) so no tier-2 org
  // page can ever ship ahead of it. Safe because /totp walks a user with no
  // enrolment into /account/2fa rather than stranding them.
  //
  // Note "/home".startsWith("/o/") === false — the chooser-equivalent content
  // now lives at /home (DECISION-124 — /orgs is a permanent redirect to it)
  // and is deliberately outside this gate, and it must stay outside: it
  // renders no tenant data and it is the one page a user with a lost or
  // pending organization can reach.
  //
  // /developer is 2FA-gated here too (F284), by SEGMENT boundary: `/developer`
  // and `/developer/…`, never `/developerx`. The check runs before the
  // ADMIN_ROLE shortcut below, so an admin-role holder who is required and
  // unverified is challenged as well. Like /o/*, it has NO PROTECTION_RULES
  // entry: whether the viewer may read it is the page gate's live read of
  // users.is_platform_admin (DECISION-044), which the Edge cannot make.
  const isTwoFactorGated =
    pathname.startsWith("/admin") ||
    pathname.startsWith("/o/") ||
    pathname === "/developer" ||
    pathname.startsWith("/developer/");
  if (
    isTwoFactorGated &&
    session.user.twoFactorRequired &&
    !session.user.twoFactorVerified
  ) {
    const url = new URL("/totp", req.url);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  if (session.user.roles?.includes(ADMIN_ROLE)) return NextResponse.next();

  for (const rule of PROTECTION_RULES) {
    if (rule.pattern.test(pathname)) {
      const ok = session.user.features?.includes(rule.required);
      if (!ok) {
        const dest = new URL("/access-pending", req.url);
        dest.searchParams.set("from", pathname);
        return NextResponse.redirect(dest);
      }
      return NextResponse.next();
    }
  }

  // INTENTIONAL FALL-THROUGH — auth-only, no feature gate required.
  //
  // Paths that reach here are authenticated (session checked above) but do not
  // match any PROTECTION_RULES entry. This is the correct and deliberate
  // behavior for the /account/* subtree (/account, /account/2fa, etc.) — any
  // signed-in user may access their own account pages regardless of role.
  //
  // DO NOT add a catch-all PROTECTION_RULES entry that would accidentally
  // swallow /account/* routes. If you add a new route family that needs its own
  // access control, add an explicit rule to PROTECTION_RULES above.
  //
  // Auth-only routes (no feature gate): /home, /account, /account/2fa,
  // /launch, /no-organization, /o/* (the last one additionally 2FA-gated
  // above, and authorized per-organization in the RSC layer — never here),
  // and /developer (likewise 2FA-gated above, and authorized per request by
  // the page gate's live read — never by the Edge).
  // /orgs no longer reaches here — it 308s to /home before edgeAuth() ever
  // runs (next.config.ts redirects(), DECISION-124).
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
