/**
 * The invitation hand-off cookie (R6 as amended by Phase 2 addendum 2, F156,
 * DECISION-185).
 *
 * The token must never travel through `callbackUrl`: NextAuth would copy it
 * into its own callback-url cookie, `/totp?callbackUrl=` would carry it in a
 * URL, and it would land in history and logs. Instead "Sign in to accept" is a
 * server action that stores the token in THIS httpOnly cookie and redirects to
 * `/signin?callbackUrl=/invite` with no token. `/invite` reads the cookie when
 * the query carries none (the query always wins).
 *
 * WHY `Path=/` (addendum 2). A server-action `redirect()` does not make the
 * browser send a new request: Next renders the redirect target inside the
 * action's OWN POST, and that POST carries only the cookies scoped to the
 * action's path. The sign-in action (`/signin`) and the verify action (`/totp`)
 * both end in `redirect("/invite")`, the chain can pass through
 * `/account/2fa`, and the only path those share with `/invite` is `/`. A
 * narrower path would have to list every auth page the chain might cross and
 * would break silently the next time that chain changes. So the cookie is
 * HOST-ONLY (no `domain` attribute, ever), `Path=/`, httpOnly, `SameSite=Lax`,
 * 30 minutes, and `Secure` in production.
 *
 * WHY `__Host-` IN PRODUCTION. The prefix makes the browser itself enforce
 * "Secure, Path=/, no Domain", so no sibling subdomain (P5's slug labels) can
 * plant its own invitation token in this cookie. Outside production the name is
 * plain `invite_token` (the browser refuses `__Host-` without `Secure`, and dev
 * is http) - the NextAuth secure-prefix pattern.
 *
 * Because every platform request now carries it for up to 30 minutes, the only
 * code allowed to NAME the cookie is `invite-cookie.ts`, `(invite)/actions.ts`
 * and `(invite)/invite/page.tsx` (`boundaries.test.ts` scans for it). The proxy
 * never reads it and never reaches the database (DECISION-177). A Server
 * Component cannot delete a cookie, so on a dead link it is left to expire (D-6,
 * inert: it holds a token that is already dead); the accept actions clear it.
 *
 * Pure constants: safe from a Server Component, an action and a test.
 */

/** Where every redirect back to the invitation page goes. NOT the cookie's path. */
export const INVITE_PAGE_PATH = "/invite";

export const INVITE_COOKIE_MAX_AGE_SECONDS = 30 * 60;

/** `__Host-invite_token` in production, `invite_token` everywhere else. */
export function inviteTokenCookieName(env: { NODE_ENV?: string } = process.env): string {
  return env.NODE_ENV === "production" ? "__Host-invite_token" : "invite_token";
}

export function inviteCookieOptions(env: { NODE_ENV?: string } = process.env) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    // "/" and NO `domain`: see the header. A `domain` here would break the __Host- prefix's guarantee.
    path: "/",
    maxAge: INVITE_COOKIE_MAX_AGE_SECONDS,
  };
}
