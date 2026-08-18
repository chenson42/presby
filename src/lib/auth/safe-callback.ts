/**
 * Validates that a callbackUrl is a safe same-origin relative path.
 * Rejects protocol-relative URLs (starting with "//") and any absolute URL.
 * Falls back to /launch if the value is absent or invalid.
 *
 * /launch is the single post-authentication target (DECISION-034): it computes
 * the destination from the user's organizations and redirects, so falling back
 * to it is correct for every user rather than for the platform-shell user
 * /home was written for.
 *
 * This is a PURE STRING FUNCTION and must stay one. It does not learn about
 * organization slugs and it imports nothing. The open-redirect class is handled
 * here and only here; whether a `/o/<slug>` path is one the user can actually
 * enter is a UX question answered by computeDestination(), and the security
 * answer is the independent resolve at /o/<slug> itself.
 */
export function sanitizeCallbackUrl(raw: string | undefined | null): string {
  if (!raw) return "/launch";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/launch";
}
