/**
 * host.ts - host classification for custom domains (Track F). PURE: imports
 * nothing, so it is safe for `src/proxy.ts` and `next.config.ts`, and it is
 * one of the only files the proxy may import from this module (Phase 3 API
 * Contract section 1; `check:proxy-imports` enforces it).
 *
 * docs/work-log/2026-10-19-custom-domains.md: Phase 2 R1-R4, R2 (the
 * platform-host set and its boot assertion), T8, T16; DECISION-176.
 *
 * THE RULE THIS FILE EXISTS FOR: a host is a LOOKUP KEY, never an identity.
 * `requestHost()` reads the single `host` header the platform actually
 * received and nothing else - never `x-forwarded-host`, `forwarded`,
 * `x-original-host` or `nextUrl.host`. A test pins that a spoofed forwarded
 * header changes nothing (A2).
 *
 * TWO "PRODUCTION" PREDICATES, ON PURPOSE.
 *   - `isProductionDeployment()` is `VERCEL_ENV === "production"`. It governs
 *     what counts as a platform host (loopback, `*.trycloudflare.com`,
 *     `DEV_ALLOWED_ORIGINS` only OUTSIDE it) and whether an IP-literal Host is
 *     refused. It is NOT `NODE_ENV`: `next build` always sets
 *     NODE_ENV=production, and the production-build e2e lane
 *     (`next build && next start` on localhost) must still treat localhost as
 *     the platform (T8).
 *   - `platformOrigin()` keeps `givingOrigin()`'s original `NODE_ENV` rule
 *     VERBATIM (T16: `givingOrigin()` becomes a re-export of it in Batch 1c,
 *     so its existing tests must keep passing unchanged).
 *
 * FAILURE DIRECTION (R2): a host that is not in the set is treated as a
 * custom host (rewrite, database, neutral 404). A misconfigured set 404s the
 * platform; it can never serve platform routes on a church's domain.
 *
 * `VERCEL_PROJECT_PRODUCTION_URL` is never read here or anywhere (F148): once
 * church domains attach to the project, Vercel may report a short church apex
 * as "the production URL"; fed into this set it would serve /signin and
 * /admin on that church's domain. A source-scan test (host.test.ts) bans the
 * variable name outside comments.
 */

type EnvLike = Readonly<Record<string, string | undefined>>;
type HeadersLike = { get(name: string): string | null };

const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOST_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`);
const SLUG_RE = new RegExp(`^${LABEL}$`);
const MAX_HOST_LENGTH = 253;

/** `VERCEL_ENV === "production"`: the strict deployment (see the file header). */
export function isProductionDeployment(env: EnvLike = process.env): boolean {
  return env.VERCEL_ENV === "production";
}

/** True for a hostname whose last label is all digits: an IPv4 literal (or the
 * numeric forms parsers normalize to one). No TLD is numeric. */
export function isIpLiteral(host: string): boolean {
  const last = host.slice(host.lastIndexOf(".") + 1);
  return /^[0-9]+$/.test(last);
}

/**
 * Normalizes one host value: lowercase, strip a `:port`, strip ONE trailing
 * dot. Returns `null` for anything that is not ASCII hostname syntax
 * (<= 253 chars, valid labels) or - in a production deployment - an IP
 * literal. Outside production the exact loopback forms `localhost`,
 * `127.0.0.1` and `[::1]` are accepted.
 */
export function normalizeHost(
  raw: string | null | undefined,
  env: EnvLike = process.env,
): string | null {
  if (raw === null || raw === undefined) return null;
  let h = raw.trim().toLowerCase();
  if (h === "") return null;

  if (h.startsWith("[")) {
    // An IPv6 literal. The only one ever legal is the dev loopback.
    const m = /^\[([0-9a-f:.]+)\](?::[0-9]{1,5})?$/.exec(h);
    if (m && m[1] === "::1" && !isProductionDeployment(env)) return "[::1]";
    return null;
  }

  const colon = h.lastIndexOf(":");
  if (colon !== -1) {
    const port = h.slice(colon + 1);
    h = h.slice(0, colon);
    if (!/^[0-9]{1,5}$/.test(port)) return null;
  }
  if (h.endsWith(".")) h = h.slice(0, -1);
  if (h === "" || h.length > MAX_HOST_LENGTH) return null;
  if (!HOST_RE.test(h)) return null;
  if (isIpLiteral(h) && isProductionDeployment(env)) return null;
  return h;
}

/**
 * The request's `Host`, normalized, or `null`. Reads ONLY the `host` header
 * (R3): a forwarded header never reaches this function's decision.
 */
export function requestHost(
  headers: HeadersLike,
  env: EnvLike = process.env,
): string | null {
  return normalizeHost(headers.get("host"), env);
}

// ---------------------------------------------------------------------------
// The platform-host set (R2)
// ---------------------------------------------------------------------------

function hostOfUrl(raw: string | undefined): string | null {
  const value = (raw ?? "").trim();
  if (value === "") return null;
  try {
    const hostname = new URL(value).hostname;
    return hostname === "" ? null : hostname.toLowerCase();
  } catch {
    return null;
  }
}

function listOf(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

const DEV_LOOPBACK = ["localhost", "127.0.0.1", "[::1]"] as const;

function computePlatformHosts(env: EnvLike): ReadonlySet<string> {
  const set = new Set<string>();
  const appHost = hostOfUrl(env.NEXT_PUBLIC_APP_URL);
  if (appHost !== null) set.add(appHost);
  for (const entry of listOf(env.NEXT_PUBLIC_PLATFORM_HOSTS)) {
    const host = normalizeHost(entry, env);
    if (host !== null) set.add(host);
  }
  if (!isProductionDeployment(env)) {
    for (const loop of DEV_LOOPBACK) set.add(loop);
    for (const entry of listOf(env.DEV_ALLOWED_ORIGINS)) {
      const host = normalizeHost(entry, env);
      if (host !== null) set.add(host);
    }
  }
  return set;
}

let memo: { sig: string; set: ReadonlySet<string> } | null = null;

/**
 * The exact-match half of the platform-host set: the host of
 * `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_PLATFORM_HOSTS` (a build-time comma
 * list), and - outside a production deployment only - loopback and
 * `DEV_ALLOWED_ORIGINS`. The wildcard half (`*.vercel.app`, and outside
 * production `*.trycloudflare.com`) lives in `isPlatformHost()`.
 *
 * Memoized for `process.env` against a signature of the variables it reads, so
 * a test that changes one gets a fresh set.
 */
export function platformHosts(env: EnvLike = process.env): ReadonlySet<string> {
  if (env !== process.env) return computePlatformHosts(env);
  const sig = [
    env.NEXT_PUBLIC_APP_URL,
    env.NEXT_PUBLIC_PLATFORM_HOSTS,
    env.DEV_ALLOWED_ORIGINS,
    env.VERCEL_ENV,
  ].join("\u0000");
  if (memo === null || memo.sig !== sig) memo = { sig, set: computePlatformHosts(env) };
  return memo.set;
}

/** Whether a NORMALIZED host (the output of `requestHost()`) is a platform host. */
export function isPlatformHost(host: string, env: EnvLike = process.env): boolean {
  if (platformHosts(env).has(host)) return true;
  if (host.endsWith(".vercel.app")) return true;
  if (!isProductionDeployment(env) && host.endsWith(".trycloudflare.com")) return true;
  return false;
}

/**
 * The validated platform origin (T16): the single env-to-origin validator.
 * `givingOrigin()` re-exports this in Batch 1c, so the rule is
 * `givingOrigin()`'s own, verbatim: the bare origin of `NEXT_PUBLIC_APP_URL`
 * (`https://host[:port]`, no path), or `null` when none is safe. Production
 * (NODE_ENV) requires an absolute `https:` URL with no userinfo; outside it an
 * unset value falls back to `http://localhost:3000` and `http:` is accepted.
 *
 * Takes no request input: an origin is never derived from `Host` (R3).
 */
export function platformOrigin(env: EnvLike = process.env): string | null {
  const production = env.NODE_ENV === "production";
  const raw = (env.NEXT_PUBLIC_APP_URL ?? "").trim();

  if (raw === "") return production ? null : "http://localhost:3000";

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

/**
 * Which class of host a request arrived on, for the one-line cron log (T6 / A6:
 * Vercel does not say which host a scheduled invocation uses, and the
 * real-domain acceptance pass reads this line). A label only - never a branch.
 */
export function hostClass(
  headers: HeadersLike,
  env: EnvLike = process.env,
): "platform" | "custom" | "invalid" {
  const host = requestHost(headers, env);
  if (host === null) return "invalid";
  return isPlatformHost(host, env) ? "platform" : "custom";
}

// ---------------------------------------------------------------------------
// The site key (R1)
// ---------------------------------------------------------------------------

export type SiteKey =
  | { kind: "host"; host: string }
  | { kind: "slug"; slug: string }
  | { kind: "invalid" };

/**
 * Classifies the `[slug]` route segment once. No dot means a slug; a dot means
 * a host. They cannot collide: the slug CHECK is a DNS label with no dot
 * (drizzle/0014) and the hostname rules require at least one dot. A host key
 * must already be in normalized form - the proxy builds it from
 * `requestHost()`, so anything else (uppercase, a port, a percent escape) is
 * not something the proxy produced and is `invalid`.
 */
export function parseSiteKey(param: string): SiteKey {
  if (param.includes(".")) {
    const host = normalizeHost(param);
    if (host !== null && host === param && host.includes(".") && HOST_RE.test(host)) {
      return { kind: "host", host };
    }
    return { kind: "invalid" };
  }
  if (SLUG_RE.test(param)) return { kind: "slug", slug: param };
  return { kind: "invalid" };
}

/** The internal rewrite target for a custom-host request: `/site/<host><path>`. */
export function siteKeyRewritePath(host: string, pathname: string): string {
  return `/site/${host}${pathname === "/" ? "" : pathname}`;
}

// ---------------------------------------------------------------------------
// Boot assertion (R2, T8)
// ---------------------------------------------------------------------------

/**
 * Throws, naming the variable, when the platform-host configuration is unsafe
 * for a production deployment. `next.config.ts` calls it when
 * `VERCEL_ENV === "production"` (Batch 1c); it asserts unconditionally so it
 * is testable, and the caller owns the guard.
 *
 * Also refuses the test/dev-only fakes and the reserved-TLD allowance: they
 * must never be set in Vercel Production (Phase 3 Edge Cases, "Dev/test fakes
 * are unreachable in production by the boot assertion").
 */
export function assertPlatformHostConfig(env: EnvLike): void {
  const appUrl = (env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (appUrl === "") {
    throw new Error("NEXT_PUBLIC_APP_URL must be set for a production build.");
  }
  let parsed: URL;
  try {
    parsed = new URL(appUrl);
  } catch {
    throw new Error("NEXT_PUBLIC_APP_URL is not a valid absolute URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_APP_URL must be an https: URL for a production build.");
  }
  const strict: EnvLike = { ...env, VERCEL_ENV: "production" };
  for (const entry of listOf(env.NEXT_PUBLIC_PLATFORM_HOSTS)) {
    if (normalizeHost(entry, strict) === null) {
      throw new Error(
        `NEXT_PUBLIC_PLATFORM_HOSTS entry ${JSON.stringify(entry)} is not a hostname.`,
      );
    }
  }
  if (!platformHosts(strict).has(parsed.hostname.toLowerCase())) {
    throw new Error("The host of NEXT_PUBLIC_APP_URL is not in the platform-host set.");
  }
  if ((env.DOMAINS_ALLOW_RESERVED_TLDS ?? "") !== "") {
    throw new Error("DOMAINS_ALLOW_RESERVED_TLDS must not be set in production.");
  }
  if (env.DOMAINS_DNS_PROVIDER === "fake") {
    throw new Error("DOMAINS_DNS_PROVIDER=fake must not be set in production.");
  }
  if (env.DOMAINS_PROVIDER === "fake") {
    throw new Error("DOMAINS_PROVIDER=fake must not be set in production.");
  }
  if ((env.DOMAINS_FAKE_STATE_FILE ?? "") !== "") {
    throw new Error("DOMAINS_FAKE_STATE_FILE must not be set in production.");
  }
}
