import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { parseSiteKey } from "@/lib/domains/host";

/**
 * The host-level redirects of the public surface (DECISION-178, Phase 2 R6,
 * Phase 3 API Contract section 4): the slug URL handing off to a serving
 * custom host, and a non-canonical alias handing off to its canonical host.
 *
 * ALWAYS A 307, NEVER A 301/308, and never configured at the hosting layer. A
 * permanent redirect is cached by browsers and CDNs, so after a church's
 * domain lapsed it would keep sending visitors to a host that now 404s, and if
 * the church later swapped www and apex it would loop. A 307 costs one extra
 * round trip and can be undone the moment the state changes.
 *
 * The target is built from exactly three things, none of them the request:
 * `https://`, a host the DATABASE returned (re-validated here as a hostname,
 * so even a corrupt row cannot smuggle a path or a second host), and the path
 * and query of THIS request, with every path segment re-encoded. The path
 * starts with `/` and cannot contain `//`, so the result can never name a
 * different host (no open redirect).
 *
 * WHICH responses may redirect is the CALLER's decision, per R6: HTML pages and
 * the sitemap/robots yes; assets (content-addressed and cacheable),
 * `give/return` (Stripe's `success_url` was fixed when the session was created)
 * and Server Action POSTs never.
 */

/** Re-encodes a decoded bundle path (`/about/our staff`) for a URL. `/` stays `/`. */
export function encodeBundlePath(path: string): string {
  const segments = path.split("/").filter((s) => s !== "");
  return segments.length === 0 ? "/" : `/${segments.map(encodeURIComponent).join("/")}`;
}

/** `?a=1&b=2` from a Next `searchParams` object (arrays repeat the key), or `""`. */
export function toSearchString(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): string {
  if (!searchParams) return "";
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) out.append(key, v);
  }
  const text = out.toString();
  return text === "" ? "" : `?${text}`;
}

/**
 * The absolute redirect URL, or null if `host` is not a valid hostname (which
 * the caller treats as "no redirect": fail soft, serve in place).
 */
export function hostRedirectUrl(host: string, bundlePath: string, search: string = ""): string | null {
  if (parseSiteKey(host).kind !== "host") return null;
  return `https://${host}${encodeBundlePath(bundlePath)}${search}`;
}

/**
 * For a page: when `redirectHost` is set, 307 to it, keeping the path and
 * query. Calls `redirect()`, which throws, so a `void` return means "serve in
 * place". Next issues a 307 for a redirect thrown during a GET render.
 */
export function redirectIfNeeded(
  resolved: { redirectHost: string | null },
  target: { path: string; search?: string },
): void {
  if (resolved.redirectHost === null) return;
  const url = hostRedirectUrl(resolved.redirectHost, target.path, target.search ?? "");
  if (url !== null) redirect(url);
}

/** For a route handler: the 307 response (with `no-store`), or null to serve in place. */
export function redirectResponse(
  resolved: { redirectHost: string | null },
  target: { path: string; search?: string },
): NextResponse | null {
  if (resolved.redirectHost === null) return null;
  const url = hostRedirectUrl(resolved.redirectHost, target.path, target.search ?? "");
  if (url === null) return null;
  return new NextResponse(null, {
    status: 307,
    headers: { Location: url, "Cache-Control": "no-store" },
  });
}
