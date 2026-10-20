import type { Metadata } from "next";
import { NEUTRAL_404_METADATA } from "./neutral-metadata";

/**
 * The neutral 404 for the public site tree (Phase 2 suggestion 3, Phase 3
 * API Contract section 4). Every non-serving state - an unknown host, a
 * pending or lapsed or paused or released domain, a toggle that is off, a site
 * that is suspended, a flag that is off, a path the church's site does not have,
 * and every platform route (`/api/*`, `/signin`, `/admin`, ...) requested on a
 * church's domain - lands here, and lands on the SAME markup (DECISION-040:
 * which hosts are tenants must not leak, through the body or the title).
 *
 * WHAT IT DELIBERATELY IS NOT. It names no product, no organization and no
 * state: without this file the root metadata ("PresbyPortal") titles every
 * custom-host 404 with the platform's name, which tells a prober that an
 * unclaimed domain pointed at us is a PresbyPortal host. It has no link home
 * (there is no "home" a stranger on someone else's domain should be sent to)
 * and no client code. The favicon is the one platform mark still visible (F151,
 * an accepted residual: per-site favicons are a tracked follow-up).
 *
 * It renders inside this segment's layout, which emits `<BrandTokens>` only for
 * a site that resolved - so an unresolved host gets the plain page and a
 * serving host gets its own colours around the same words.
 */
export const metadata: Metadata = NEUTRAL_404_METADATA;

export default function PublicSiteNotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-2 px-4 text-center">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">The page you were looking for does not exist.</p>
    </div>
  );
}
