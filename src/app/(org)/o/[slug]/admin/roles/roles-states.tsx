import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The three non-data-bearing answers `/o/<slug>/admin/roles` can give (a
 * fourth — an unauthorized org, or a 404 slug — is handled one level up by
 * `org-states.tsx` / `not-found.tsx`, reused as-is rather than duplicated).
 * Modeled directly on `directory/directory-states.tsx`, same three-block
 * structure and copy register.
 *
 * THREE DISTINCT COPY BLOCKS, DELIBERATELY NOT COLLAPSED (Phase 3):
 *   - flag off: a product-not-here message, no permission or error framing.
 *   - forbidden: a permission message, worded so it does NOT read as "your
 *     whole portal access was revoked" — that is `OrgAccessDenied`'s job,
 *     one level up, and the two must not sound alike.
 *   - load error: a broken-right-now message with a retry, not a "you can't"
 *     message.
 * A reader who only skims one of these three should not be able to guess
 * what the other two say.
 */

/** `org_portal.roles` is off. A product-not-here message, not a denial. */
export function RolesFlagOff({ name }: { name: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Roles</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Role administration isn&apos;t turned on for {name} yet.
      </p>
    </section>
  );
}

/**
 * `listGrants()`/`getGrantFormOptions()` returned `{ kind: "forbidden" }` —
 * the viewer has an active relationship with the organization (they got past
 * `assertOrgAccess` to reach this page at all) but holds no
 * `role_grants.manage` grant. Worded deliberately unlike `OrgAccessDenied`'s
 * "you don't have access to {org}" — a member reading this should understand
 * ONE capability is unavailable to them, not that their whole portal access
 * was revoked.
 */
export function RolesForbidden({ name }: { name: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Roles</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        You don&apos;t have permission to grant or revoke roles at {name}. If
        you think this is a mistake, ask your stated clerk or another
        administrator there.
      </p>
    </section>
  );
}

/**
 * A genuine, non-`OrgAccessError` failure reading role grants (a DB blip,
 * most likely). The retry is a plain `<Link>` to the same path — this stays
 * a Server Component, so there is no client `reset()` to call, unlike
 * `[slug]/error.tsx`.
 */
export function RolesLoadError({ slug }: { slug: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Roles</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        We couldn&apos;t load role assignments right now. Try again in a
        moment.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={`/o/${slug}/admin/roles`}>Try again</Link>
      </Button>
    </section>
  );
}
