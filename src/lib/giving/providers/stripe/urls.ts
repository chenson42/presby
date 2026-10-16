import { ProviderError } from "./errors";

/**
 * Origin assertions for every URL we send a person to or accept back from
 * Stripe - docs/work-log/2026-10-15-online-giving.md, Phase 3 allowlist notes
 * and the adversarial row "Redirect targets". PURE (no `stripe`, no `server-only`):
 * the same predicate runs server-side before a URL leaves an action and again
 * client-side before `window.location.assign`.
 *
 * "Exact" means exact:
 *   - the scheme is `https:`;
 *   - the hostname is one of the allowed names, compared whole (so
 *     `checkout.stripe.com.evil.example`, `evilcheckout.stripe.com`,
 *     `checkout.stripe.com.` and `checkout-stripe.com` all fail);
 *   - there is no userinfo (`https://checkout.stripe.com@evil.example/`); // leak-ok: hostile userinfo URL test input, not an email
 *   - there is no port - not even an explicit, default `:443`, which the URL
 *     parser would otherwise erase;
 *   - the raw string holds no whitespace, control character or backslash (the
 *     URL parser silently strips tabs and newlines and treats `\` as `/`, both
 *     classic smuggling shapes).
 */

/** Stripe-hosted Checkout (a donor's redirect). */
export const CHECKOUT_HOSTS = ["checkout.stripe.com"] as const;

/**
 * Account-onboarding links. Accounts v2 serves them from `accounts.stripe.com`
 * (P3-10); `connect.stripe.com` is the v1 host and stays allowed.
 */
export const ONBOARDING_HOSTS = ["accounts.stripe.com", "connect.stripe.com"] as const;

const MAX_URL_LENGTH = 4096;
// whitespace, ASCII control characters, DEL, backslash
const FORBIDDEN_CHARS = /[\s\u0000-\u001f\u007f\\]/;

/** True when `raw` is an `https:` URL on exactly one of `hosts`, with no userinfo or port. */
export function isAllowedStripeUrl(raw: unknown, hosts: readonly string[]): boolean {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL_LENGTH) return false;
  if (FORBIDDEN_CHARS.test(raw)) return false;
  if (!raw.startsWith("https://")) return false;

  // The authority is everything between "//" and the first "/", "?" or "#".
  const authority = raw.slice("https://".length).split(/[/?#]/, 1)[0] ?? "";
  if (authority.includes("@") || authority.includes(":")) return false;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  if (url.port !== "") return false;
  return hosts.includes(url.hostname);
}

/** Returns the normalized URL, or throws `ProviderError("bad_origin")`. */
export function assertStripeUrl(raw: unknown, hosts: readonly string[]): string {
  if (!isAllowedStripeUrl(raw, hosts)) throw new ProviderError("bad_origin");
  return new URL(raw as string).href;
}

export const isCheckoutUrl = (raw: unknown): boolean => isAllowedStripeUrl(raw, CHECKOUT_HOSTS);
export const isOnboardingUrl = (raw: unknown): boolean => isAllowedStripeUrl(raw, ONBOARDING_HOSTS);
