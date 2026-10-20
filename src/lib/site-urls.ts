import { parseSiteKey } from "@/lib/domains/host";

/**
 * site-urls.ts - the ONE builder of same-site URLs on the public surface
 * (DECISION-181, Phase 2 R5, Phase 3 API Contract section 4). PURE: imports
 * only the pure host classifier, reads no environment and no request.
 *
 * WHY IT EXISTS. The public site was serving at `/site/<slug>/...`, and about
 * eight places hand-built that prefix. A church's own domain serves the same
 * pages at CLEAN paths (`/about`, not `/site/<slug>/about`), so a hand-built
 * `/site/${slug}` on a custom host is a link into the platform's URL space -
 * wrong at best, and at worst a way to name a slug on a host that must never
 * show one (G5). Every such URL now comes from here, and a source-scan test
 * (`site-urls.test.ts`) bans the hand-built form anywhere else.
 *
 * TWO MODES, ONE INTERFACE.
 *   host mode  `origin = https://<canonical host>`; paths are clean:
 *              `page("/about") = "/about"`, `asset(k) = "/assets/<k>"`.
 *   slug mode  `origin = <platform origin>`; paths are today's
 *              `/site/<slug>/...`.
 * Relative paths are safe in both: they resolve against the visitor's CURRENT
 * host. Every ABSOLUTE URL (`origin`, `canonical()`, `portal()`) comes from the
 * verified database row or the validated platform origin and NEVER from the
 * request (R3, A7) - which is why the builder takes both as arguments and has
 * no way to look at a header.
 *
 * `slug` appears on a custom host in exactly one form: `portal()`, the absolute
 * link back to the church's member portal on the PLATFORM host (which is where
 * sign-in lives). It is the public platform identifier, not a secret.
 *
 * Built only by `resolveSite()` (src/lib/sites.ts) from the row the database
 * returned, or by `slugSitePath()` for platform-host contexts (the sign-in
 * page, the global nav, the org portal's "Visit the public site" links) where
 * the slug URL is the intent - and 307s to the custom host while one is
 * serving.
 */

export interface SiteUrls {
  readonly mode: "host" | "slug";
  /** The origin absolute URLs are built on: `https://<canonical host>` or the platform origin. */
  readonly origin: string;
  /** The site's home page (a path). */
  home(): string;
  /** A bundle page (`"/"`, `"/about"`) as a path. */
  page(bundlePath: string): string;
  /** A content-addressed blob served by the assets route, as a path. */
  asset(key: string): string;
  sitemap(): string;
  /** The platform-owned give page. */
  give(): string;
  /** Where Stripe sends a donor back, as a path (the origin is `donorOrigin()`'s business). */
  giveReturn(sessionId: string): string;
  /** `origin` + `page(bundlePath)`: the absolute, canonical URL of a page. */
  canonical(bundlePath: string): string;
  /** The absolute link to the church's member portal, always on the platform. */
  portal(): string;
}

export type SiteUrlsInput =
  | { mode: "host"; host: string; slug: string; platformOrigin: string }
  | { mode: "slug"; slug: string; platformOrigin: string };

function assertSlug(slug: string): void {
  if (parseSiteKey(slug).kind !== "slug") {
    throw new Error("site-urls: not a slug");
  }
}

function assertHost(host: string): void {
  if (parseSiteKey(host).kind !== "host") {
    throw new Error("site-urls: not a host");
  }
}

/** A bundle path always starts with exactly one slash and has no query. */
function cleanPath(bundlePath: string): string {
  if (bundlePath === "" || bundlePath === "/") return "/";
  return bundlePath.startsWith("/") ? bundlePath : `/${bundlePath}`;
}

/**
 * `/site/<slug>` plus a path: the platform-host URL of a site. The ONLY place a
 * slug URL is built (besides the proxy's rewrite target in `host.ts`). Used by
 * platform-host links that mean "this church's public site", and by slug mode
 * below.
 *
 * NEVER THROWS, because platform pages call it with a route param that has not
 * been validated (the `(org)` miss states render for any string a visitor
 * types): the slug is percent-encoded, so a malformed one yields a URL that
 * 404s instead of a 500. A well-formed slug (a DNS label) encodes to itself.
 */
export function slugSitePath(slug: string, bundlePath: string = "/"): string {
  const p = cleanPath(bundlePath);
  const base = `/site/${encodeURIComponent(slug)}`;
  return p === "/" ? base : `${base}${p}`;
}

export function buildSiteUrls(input: SiteUrlsInput): SiteUrls {
  assertSlug(input.slug);
  const slug = input.slug;
  const platformOrigin = input.platformOrigin.replace(/\/+$/, "");
  const portal = () => `${platformOrigin}/o/${slug}`;

  if (input.mode === "host") {
    assertHost(input.host);
    const origin = `https://${input.host}`;
    const page = (bundlePath: string) => cleanPath(bundlePath);
    return {
      mode: "host",
      origin,
      home: () => "/",
      page,
      asset: (key) => `/assets/${encodeURIComponent(key)}`,
      sitemap: () => "/sitemap.xml",
      give: () => "/give",
      giveReturn: (sessionId) => `/give/return?session_id=${encodeURIComponent(sessionId)}`,
      canonical: (bundlePath) => `${origin}${page(bundlePath)}`,
      portal,
    };
  }

  const page = (bundlePath: string) => slugSitePath(slug, bundlePath);
  return {
    mode: "slug",
    origin: platformOrigin,
    home: () => slugSitePath(slug),
    page,
    asset: (key) => `${slugSitePath(slug)}/assets/${encodeURIComponent(key)}`,
    sitemap: () => `${slugSitePath(slug)}/sitemap.xml`,
    give: () => `${slugSitePath(slug)}/give`,
    giveReturn: (sessionId) => `${slugSitePath(slug)}/give/return?session_id=${encodeURIComponent(sessionId)}`,
    canonical: (bundlePath) => `${platformOrigin}${page(bundlePath)}`,
    portal,
  };
}
