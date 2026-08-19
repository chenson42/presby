import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The three non-data-bearing answers `/o/<slug>/directory` can give (a fourth
 * — an unauthorized org, or a 404 slug — is handled one level up by
 * `org-states.tsx` / `not-found.tsx`, reused as-is rather than duplicated).
 *
 * The fourth STATE this feature has — zero visible members — is not here: it
 * renders inline inside `directory-list.tsx`, because it needs no data of its
 * own and splitting it out would just be an extra prop-drill of `entries`.
 *
 * FOUR DISTINCT COPY BLOCKS, DELIBERATELY NOT COLLAPSED (Phase 3):
 *   - flag off: a product-not-here message, no permission or error framing.
 *   - forbidden: a permission message, worded so it does NOT read as "your
 *     whole portal access was revoked" — that is `OrgAccessDenied`'s job,
 *     one level up, and the two must not sound alike.
 *   - load error: a broken-right-now message with a retry, not a "you can't"
 *     message.
 * A reader who only skims one of these three should not be able to guess
 * what the other two say.
 */

/** `org_portal.directory` is off. A product-not-here message, not a denial. */
export function DirectoryFlagOff({ name }: { name: string }) {
  return (
    <section className="max-w-xl">
      <h1 className="text-2xl font-semibold">Directory</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        The directory isn&apos;t available for {name} yet.
      </p>
    </section>
  );
}

/**
 * `getDirectory()` returned `{ kind: "forbidden" }` — the viewer has an
 * active relationship with the organization (they got past `assertOrgAccess`
 * to reach this page at all) but holds no `directory.view` grant. Worded
 * deliberately unlike `OrgAccessDenied`'s "you don't have access to {org}" —
 * a member reading this should understand ONE feature is unavailable to
 * them, not that their whole portal access was revoked.
 */
export function DirectoryForbidden({ name }: { name: string }) {
  return (
    <section className="max-w-xl">
      <h1 className="text-2xl font-semibold">Directory</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        You don&apos;t have permission to view the directory. If you think
        this is a mistake, ask an administrator at {name}.
      </p>
    </section>
  );
}

/**
 * A genuine, non-`OrgAccessError` failure reading the directory (a DB blip,
 * most likely). The retry is a plain `<Link>` to the same path — this stays
 * a Server Component, so there is no client `reset()` to call, unlike
 * `[slug]/error.tsx`.
 */
export function DirectoryLoadError({ slug }: { slug: string }) {
  return (
    <section className="max-w-xl">
      <h1 className="text-2xl font-semibold">Directory</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        We couldn&apos;t load the directory right now. Try again in a
        moment.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={`/o/${slug}/directory`}>Try again</Link>
      </Button>
    </section>
  );
}
