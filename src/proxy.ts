import { NextResponse, type NextRequest } from "next/server";
import { edgeAuth } from "@/lib/auth/config";
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
]);

const PROTECTION_RULES: Array<{ pattern: RegExp; required: string }> = [
  { pattern: /^\/admin\/users/, required: FEATURES.ADMIN_USERS },
  { pattern: /^\/admin\/flags/, required: FEATURES.ADMIN_FLAGS },
  { pattern: /^\/admin\/docs/, required: FEATURES.ADMIN_RELEASE_NOTES },
  { pattern: /^\/admin/, required: FEATURES.ADMIN_DASHBOARD },
];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

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
  // Note "/orgs".startsWith("/o/") === false — the chooser is deliberately
  // outside this gate, and it must stay outside: it renders no tenant data and
  // it is the one page a user with a lost or pending organization can reach.
  const isTwoFactorGated =
    pathname.startsWith("/admin") || pathname.startsWith("/o/");
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
  // /launch, /orgs, /no-organization, /o/* (the last one additionally 2FA-gated
  // above, and authorized per-organization in the RSC layer — never here).
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
