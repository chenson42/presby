/**
 * The invitation hand-off cookie (R6, F156, DECISION-185).
 *
 * The token must never travel through `callbackUrl`: NextAuth would copy it
 * into its own callback-url cookie, `/totp?callbackUrl=` would carry it in a
 * URL, and it would land in history and logs. Instead "Sign in to accept" is a
 * server action that stores the token in THIS httpOnly cookie and redirects to
 * `/signin?callbackUrl=/invite` with no token. `/invite` reads the cookie when
 * the query carries none (the query always wins).
 *
 * `Path=/invite` scopes it to the invitation routes only. A Server Component
 * cannot delete a cookie, so on a dead link the cookie is left to expire
 * (30 minutes); it holds a token that is already dead (D-6). It is cleared by
 * the accept actions, which can.
 *
 * Pure constants: safe from a Server Component, an action and a test.
 */
export const INVITE_TOKEN_COOKIE = "invite_token";
export const INVITE_COOKIE_PATH = "/invite";
export const INVITE_COOKIE_MAX_AGE_SECONDS = 30 * 60;

export function inviteCookieOptions(env: { NODE_ENV?: string } = process.env) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: INVITE_COOKIE_PATH,
    maxAge: INVITE_COOKIE_MAX_AGE_SECONDS,
  };
}
