import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The three non-data-bearing answers `/o/<slug>/admin/groups` (and its
 * `[groupId]`/`[groupId]/edit` sub-routes) can give (a fourth — an
 * unauthorized org, or a 404 slug — is handled one level up by
 * `org-states.tsx` / `not-found.tsx`, reused as-is rather than duplicated).
 * Modeled directly on `officers/officers-states.tsx`, per Phase 3's own
 * instruction.
 *
 * THREE DISTINCT COPY BLOCKS, DELIBERATELY NOT COLLAPSED (same rationale
 * `officers-states.tsx`'s header documents): a reader who only skims one of
 * these three should not be able to guess what the other two say.
 */

/** `org_portal.groups` is off. A product-not-here message, not a denial. */
export function GroupsFlagOff({ name }: { name: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Groups</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Committee and group administration isn&apos;t turned on for {name}{" "}
        yet.
      </p>
    </section>
  );
}

/**
 * `listGroups()`/`getGroup()`/`getGroupFormOptions()` returned
 * `{ kind: "forbidden" }` — the viewer has an active relationship with the
 * organization but holds no `groups.manage` grant. Worded deliberately
 * unlike `OrgAccessDenied`'s "you don't have access to {org}" — one
 * capability is unavailable, not their whole portal access.
 */
export function GroupsForbidden({ name }: { name: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Groups</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        You don&apos;t have permission to manage groups at {name}. If you
        think this is a mistake, ask your stated clerk or another
        administrator there.
      </p>
    </section>
  );
}

/**
 * A genuine, non-`OrgAccessError` failure reading group data. The retry is a
 * plain `<Link>` back to the groups list — this stays a Server Component, so
 * there is no client `reset()` to call, unlike `[slug]/error.tsx`.
 */
export function GroupsLoadError({ slug }: { slug: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Groups</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        We couldn&apos;t load group records right now. Try again in a moment.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={`/o/${slug}/admin/groups`}>Try again</Link>
      </Button>
    </section>
  );
}
