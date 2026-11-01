/**
 * Whether the contact form may run at all (CA6, DECISION-303). PURE: a function
 * of an environment object, so the page can call it at build and the action at
 * runtime and the two agree by construction, and a test can pass any env.
 *
 * `verifyTurnstile` is a no-op when no secret is set (the starter default), and
 * that must not become THIS form's posture. So:
 *   - the Turnstile pair is required in every environment (development and e2e
 *     use Cloudflare's published test keys);
 *   - in a production deployment (`VERCEL_ENV === "production"`) both Upstash
 *     variables are required, the limiter must not be switched off, and neither
 *     Turnstile key may be one of Cloudflare's published dummy values. A dummy
 *     secret in Production would make the check meaningless (the always-pass
 *     key) or break the form (the others); refusing it turns "test keys never in
 *     Production" from a hope into the unavailable state.
 *
 * On Vercel a change to a variable reaches only the NEXT deployment, so this is
 * the durable switch; the immediate one is revoking EXECUTE on the definer
 * (docs/work-log/2026-10-31-help-contact.md, Runbook 4).
 */
import { isProductionDeployment } from "@/lib/domains/host";

type EnvLike = Readonly<Record<string, string | undefined>>;

/** Cloudflare's published Turnstile dummy SECRET keys. Public documentation values, not secrets. */
export const CLOUDFLARE_DUMMY_SECRET_KEYS: readonly string[] = [
  "1x0000000000000000000000000000000AA", // leak-ok: Cloudflare's published always-pass test secret
  "2x0000000000000000000000000000000AA", // leak-ok: Cloudflare's published always-fail test secret
  "3x0000000000000000000000000000000AA", // leak-ok: Cloudflare's published token-already-spent test secret
];

/** Cloudflare's published Turnstile dummy SITE keys. Public documentation values, not secrets. */
export const CLOUDFLARE_DUMMY_SITE_KEYS: readonly string[] = [
  "1x00000000000000000000AA", // leak-ok: Cloudflare's published always-pass test site key
  "2x00000000000000000000AB", // leak-ok: Cloudflare's published always-block test site key
  "1x00000000000000000000BB", // leak-ok: Cloudflare's published invisible always-pass test site key
  "2x00000000000000000000BB", // leak-ok: Cloudflare's published invisible always-block test site key
  "3x00000000000000000000FF", // leak-ok: Cloudflare's published forced-challenge test site key
];

const present = (value: string | undefined): value is string => (value ?? "").trim() !== "";

export function isHelpContactConfigured(env: EnvLike): boolean {
  const secret = env.TURNSTILE_SECRET_KEY;
  const siteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!present(secret) || !present(siteKey)) return false;

  if (!isProductionDeployment(env)) return true;

  if (!present(env.UPSTASH_REDIS_REST_URL) || !present(env.UPSTASH_REDIS_REST_TOKEN)) return false;
  if (env.RATE_LIMIT_DISABLED === "true") return false;
  if (CLOUDFLARE_DUMMY_SECRET_KEYS.includes(secret.trim())) return false;
  if (CLOUDFLARE_DUMMY_SITE_KEYS.includes(siteKey.trim())) return false;
  return true;
}
