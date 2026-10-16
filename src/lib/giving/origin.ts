/**
 * The canonical public origin that every redirect URL we hand to a provider is
 * built from - docs/work-log/2026-10-15-online-giving.md, Phase 3 "Checkout-
 * intent lifecycle" step 6 and the adversarial row "Redirect targets".
 *
 * `success_url`, `cancel_url`, an onboarding `return_url` and `refresh_url`
 * come from HERE (the `NEXT_PUBLIC_APP_URL` environment variable) and never
 * from the request's `Host` / `X-Forwarded-Host` header or a form field: a
 * spoofed `Host` must not be able to point a donor's post-payment redirect, or
 * a treasurer's post-onboarding redirect, at somebody else's site.
 *
 * Returns the bare origin (`https://host[:port]`, no path, no trailing slash)
 * or `null` when no safe origin is configured. In production the value must
 * parse as an absolute `https:` URL with no userinfo; anything else is `null`
 * and the caller treats giving as unavailable (an honest state, not a guess).
 * Outside production an unset variable falls back to `http://localhost:3000`
 * so a developer is not blocked, and `http:` is accepted for local hosts only.
 *
 * PURE and dependency-free (reads `process.env` only), so it is unit-tested
 * without a server and safe to import from either side.
 */

const DEV_FALLBACK = "http://localhost:3000";

export function givingOrigin(): string | null {
  const production = process.env.NODE_ENV === "production";
  const raw = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();

  if (raw === "") return production ? null : DEV_FALLBACK;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "") return null;
  if (url.hostname === "") return null;

  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && !production) return url.origin;
  return null;
}
