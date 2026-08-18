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

  const isAdminRoute = pathname.startsWith("/admin");
  if (
    isAdminRoute &&
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
  // Auth-only routes (no feature gate): /home, /account, /account/2fa
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
