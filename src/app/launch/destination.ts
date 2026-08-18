/**
 * The post-login destination matrix, as a pure function.
 *
 * Colocated with its only consumer (`/launch/page.tsx`) rather than living in
 * `src/lib/`, matching the `(member)/feedback/actions.test.ts` precedent.
 *
 * It imports NOTHING — no `server-only`, no `@/lib/db`, no `next/navigation` —
 * because the matrix is the highest-value test target in this pipeline and
 * every subsequent pipeline will edit it. A page that inlined these rules would
 * be verifiable only through a browser.
 *
 * TWO PLATFORM PREDICATES, NOT ONE (DECISION-044(1)). `canAccessAdmin` comes
 * from session claims and is what the Edge enforces on `/admin`;
 * `isPlatformAdmin` is `users.is_platform_admin`, read live, and is the
 * developer-portal predicate. They are held by roughly the same people BY
 * ACCIDENT — nothing seeds `is_platform_admin` — and routing on either alone
 * ships a bug in opposite directions: send an `is_platform_admin` holder to
 * `/admin` and the Edge bounces them to `/access-pending`; send a
 * `canAccessAdmin` holder straight to `/admin` and the Developer card the
 * operator asked for becomes permanently unreachable.
 *
 * TWO ROWS OF THE MATRIX ARE DELIBERATELY ABSENT AND MUST STAY ABSENT:
 *
 *   - 2FA required and unverified. Enforced by the Edge on the DESTINATION, not
 *     here. `/launch` is not 2FA-gated; `/admin` and `/o/*` are. So the chain is
 *     /launch → redirect(/o/alder-creek) → proxy → /totp?callbackUrl=/o/alder-creek
 *     → verify → /o/alder-creek. One mechanism, correct callbackUrl, zero code.
 *   - `isActive === false`. Handled in `src/proxy.ts` before /launch renders.
 *
 * A database failure is likewise not a Destination: `/launch` handles it before
 * calling this function, which is what keeps the function total.
 */

export interface DestinationInput {
  /**
   * Managed + active organizations, de-duplicated by organization id — i.e.
   * exactly what `availableOrganizations()` returns. An `unmanaged` or
   * `invited` relationship is not enterable and must not appear here.
   */
  enterableOrgs: ReadonlyArray<{ slug: string }>;
  /** users.is_platform_admin, read live from the database. */
  isPlatformAdmin: boolean;
  /** Would the Edge admit this user to /admin? roles∋ADMIN_ROLE || features∋ADMIN_DASHBOARD. */
  canAccessAdmin: boolean;
  /** Already passed through sanitizeCallbackUrl(). null when absent. */
  requestedPath: string | null;
}

export type DestinationReason =
  | "requested-path"
  | "single-org"
  | "platform-admin-only"
  | "chooser"
  | "no-organization";

export interface Destination {
  path: string;
  reason: DestinationReason;
}

/**
 * `/o/alder-creek/roll?x=1` → `alder-creek`; anything else → null.
 *
 * Note `/orgs` yields null: `["orgs"][0] !== "o"`. The chooser is deliberately
 * not an org path, in the router as at the Edge.
 */
function orgSlugFromPath(path: string): string | null {
  const [pathname] = path.split(/[?#]/);
  const parts = pathname.split("/").filter(Boolean);
  return parts[0] === "o" && parts[1] ? parts[1] : null;
}

/** The pathname, with any query string or fragment removed. */
function pathnameOf(path: string): string {
  return path.split(/[?#]/)[0];
}

export function computeDestination(input: DestinationInput): Destination {
  const { enterableOrgs, isPlatformAdmin, canAccessAdmin, requestedPath } =
    input;

  // 1. An explicitly requested path wins — defensively, and it is NOT the gate.
  //
  // A signed-out deep link to /o/alder-creek never reaches here at all: the
  // proxy sends /signin?callbackUrl=/o/alder-creek and NextAuth redirects
  // straight there. This branch fires only when something routes THROUGH
  // /launch carrying a `next`. Its job is not to authorize — /o/<slug> resolves
  // membership independently — it is to avoid dumping a user with a stale
  // bookmark on an access-denied page when the chooser is the kinder answer.
  //
  // The slug check is therefore UX, not security. The open-redirect class is
  // handled entirely by sanitizeCallbackUrl(), which ran before this.
  if (requestedPath) {
    // Loop guard: /launch?next=/launch would otherwise redirect to itself
    // forever. Invisible until someone bookmarks it.
    const isLaunch = pathnameOf(requestedPath) === "/launch";
    const slug = orgSlugFromPath(requestedPath);
    const enterable =
      slug === null || enterableOrgs.some((org) => org.slug === slug);
    if (!isLaunch && enterable) {
      return { path: requestedPath, reason: "requested-path" };
    }
    // Otherwise fall through to the normal destination. Not an error.
  }

  const platform = canAccessAdmin || isPlatformAdmin;

  // 2. Exactly one organization and no platform surfaces: skip the chooser.
  if (enterableOrgs.length === 1 && !platform) {
    return { path: `/o/${enterableOrgs[0].slug}`, reason: "single-org" };
  }

  // 3. No organization and no platform surfaces: the honest end of the funnel.
  if (enterableOrgs.length === 0 && !platform) {
    return { path: "/no-organization", reason: "no-organization" };
  }

  // 4. "If you are only a super admin you would go straight into the admin
  //    page." Only when isPlatformAdmin is false — a platform admin holds a
  //    Developer card, and the chooser is the only place that card can live.
  if (enterableOrgs.length === 0 && canAccessAdmin && !isPlatformAdmin) {
    return { path: "/admin", reason: "platform-admin-only" };
  }

  // 5. Everything else chooses: ≥2 organizations, or any organizations
  //    alongside platform access, or a platform admin with none.
  return { path: "/orgs", reason: "chooser" };
}
