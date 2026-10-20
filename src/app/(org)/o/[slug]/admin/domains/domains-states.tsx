import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The non-data-bearing answers `/o/<slug>/admin/domains` can give (the
 * four-way miss for an unknown or unauthorized organization is handled one
 * level up by `org-states.tsx` / `not-found.tsx`, reused as-is). The
 * `branding-states.tsx` pattern: each is honest about WHICH of the three it is,
 * and none names another organization.
 */

/** `org_portal.domains` is off for this organization: an operator turns it on. A not-here message, not a denial. */
export function DomainsFeatureOff({ name }: { name: string }) {
  return (
    <section data-testid="domains-feature-off">
      <h1 className="text-2xl font-semibold">Website domain</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Connecting your own web address isn&apos;t turned on for {name} yet. If you&apos;d like it, ask PresbyPortal
        support to turn it on.
      </p>
    </section>
  );
}

/** The viewer is in the organization but does not hold `domains.manage`. */
export function DomainsForbidden({ name }: { name: string }) {
  return (
    <section data-testid="domains-forbidden">
      <h1 className="text-2xl font-semibold">Website domain</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        You don&apos;t have permission to manage the website domain at {name}. If you think this is a mistake, ask your
        stated clerk or another administrator there.
      </p>
    </section>
  );
}

/** A genuine failure reading the domains (a database blip). */
export function DomainsUnavailable({ slug }: { slug: string }) {
  return (
    <section data-testid="domains-unavailable">
      <h1 className="text-2xl font-semibold">Website domain</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        We couldn&apos;t load your domain settings right now. Nothing has changed. Try again in a moment.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={`/o/${slug}/admin/domains`}>Try again</Link>
      </Button>
    </section>
  );
}
