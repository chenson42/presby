import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Shared non-data-bearing states for the whole `/o/<slug>/admin/members*`
 * tree (list, `/new`, `/pending`) — one file because all three pages gate on
 * the SAME two axes (`org_portal.members_create` flag AND the matching
 * `organization_feature_toggles` row) and share the SAME "product not here"
 * vs "you specifically can't" vs "broken right now" three-way split
 * `admin/roles/roles-states.tsx` established. Parameterized by `backHref`
 * (Load error) and an optional `heading` so each page's `<h1>` still reads
 * correctly.
 */

/** Either the global flag or the org toggle is off — collapsed into ONE
 * copy block deliberately: from a viewer's seat, "not enabled at all" and
 * "not enabled for this congregation" are the same fact ("not available"),
 * and distinguishing them would leak platform-rollout state to a tenant
 * admin who has no reason to know it. */
export function MembersFlagOff({
  name,
  heading = "Add a person",
}: {
  name: string;
  heading?: string;
}) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">{heading}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Member management isn&apos;t turned on for {name} yet.
      </p>
    </section>
  );
}

/** The viewer has an active relationship with the organization but holds
 * none of the required permissions (`people.manage`, `roll.propose`, or
 * `roll.approve`, depending on the page). */
export function MembersForbidden({
  name,
  heading = "Add a person",
}: {
  name: string;
  heading?: string;
}) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">{heading}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        You don&apos;t have permission to do that at {name}. If you think
        this is a mistake, ask your stated clerk or another administrator
        there.
      </p>
    </section>
  );
}

/** A genuine, non-`OrgAccessError` failure. */
export function MembersLoadError({
  backHref,
  heading = "Add a person",
}: {
  backHref: string;
  heading?: string;
}) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">{heading}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        We couldn&apos;t load this right now. Try again in a moment.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={backHref}>Try again</Link>
      </Button>
    </section>
  );
}
