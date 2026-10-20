import { platformOrigin } from "@/lib/domains/host";

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
 * Since Track F this is a RE-EXPORT of `platformOrigin()` (src/lib/domains/
 * host.ts, T16): one env-to-origin validator for the whole app, with the rule
 * unchanged and verbatim - the bare origin (`https://host[:port]`, no path, no
 * trailing slash) or `null` when none is safe. In production the value must
 * parse as an absolute `https:` URL with no userinfo; anything else is `null`
 * and the caller treats giving as unavailable (an honest state, not a guess).
 * Outside production an unset variable falls back to `http://localhost:3000`
 * so a developer is not blocked, and `http:` is accepted for local hosts only.
 *
 * What changed for a PUBLIC donor on a church's own domain is not this file:
 * `donorOrigin(slug)` (./donor-origin.ts) returns the organization's serving
 * custom host from the DATABASE, else this origin. Treasurer onboarding and the
 * statement-notice link keep calling `givingOrigin()` directly and stay on the
 * platform host.
 *
 * PURE and dependency-free (reads `process.env` only), so it is unit-tested
 * without a server and safe to import from either side.
 */
export function givingOrigin(): string | null {
  return platformOrigin();
}
