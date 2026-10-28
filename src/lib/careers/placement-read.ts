import "server-only";
import { parseSiteKey } from "@/lib/domains/host";
import { resolveSite } from "@/lib/sites";
import type { PlacementInput } from "./placement";

/**
 * Reads the PUBLISHED bundle's pages for the staff list's placement line (Copy
 * S5) - docs/work-log/2026-10-25-careers-inc1.md, Phase 3 "Pure helpers".
 *
 * The answer is `unknown` for every way the bundle could not be read: the site is
 * not live, nothing is published, the public-render flag is off, the host
 * resolution refused, the database blipped. The line then says it could not
 * check; it never guesses. ONE try/catch around the one `resolveSite()` call, and
 * a failure logs the slug only (never the error or its message).
 *
 * `slug` is the `(org)` route's slug param, which the page has already resolved
 * through `resolveOrgContext()`; a string that is not slug-shaped is `unknown`
 * without a read. `resolveSite` is `cache()`-wrapped and is the same read the
 * public layout uses, so it serves the platform host's slug-mode key.
 */
export async function readPlacement(slug: string): Promise<PlacementInput> {
  if (parseSiteKey(slug).kind !== "slug") return { kind: "unknown" };
  try {
    const resolved = await resolveSite(slug);
    if (resolved.kind !== "ok") return { kind: "unknown" };
    return {
      kind: "known",
      pages: resolved.site.pages.map((page) => ({ path: page.path, mdxAst: page.mdxAst })),
    };
  } catch {
    console.error("[careers] placement read failed; treating as unknown", { slug });
    return { kind: "unknown" };
  }
}
