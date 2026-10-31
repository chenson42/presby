import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FeaturesHelpLink } from "@/components/help/features-help-link";

/**
 * The non-data-bearing answers the parish management pages can give. Distinct
 * copy blocks, deliberately not collapsed (the `directory-states.tsx` rule):
 *   - off: a product-not-here message that says nothing about why;
 *   - forbidden: a permission message worded so it does NOT read as "your whole
 *     portal access was revoked" (that is `OrgAccessDenied`'s job);
 *   - load error: a broken-right-now message with a retry, never "no
 *     households" - a database failure must not read as an empty list.
 * Server Components; no client state. The retry is a plain `<Link>`.
 */

export function ParishesOff({ name }: { name: string }) {
  return (
    <section className="max-w-xl">
      <h1 className="text-2xl font-semibold">Parishes</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Parish management isn&apos;t turned on for {name} yet.
      </p>
      <FeaturesHelpLink />
    </section>
  );
}

export function ParishesForbidden({ name }: { name: string }) {
  return (
    <section className="max-w-xl">
      <h1 className="text-2xl font-semibold">Parishes</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        You don&apos;t have permission to view households by district. If you
        think this is a mistake, ask an administrator at {name}.
      </p>
    </section>
  );
}

export function ParishesLoadError({ retryHref }: { retryHref: string }) {
  return (
    <section className="max-w-xl">
      <h1 className="text-2xl font-semibold">Parishes</h1>
      <p className="mt-3 text-sm text-muted-foreground" role="alert">
        We couldn&apos;t load the households. Try again.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={retryHref}>Try again</Link>
      </Button>
    </section>
  );
}

/** C1: shown to someone who can define districts when no one holds the seat. */
export function SeatCallout({ slug }: { slug: string }) {
  return (
    <p
      className="mt-6 rounded-lg border border-border bg-muted/40 p-4 text-sm"
      data-testid="seat-callout"
    >
      No one is recorded in the Moderator seat for the Board of Deacons.{" "}
      <Link
        href={`/o/${slug}/admin/officers`}
        className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Record it in Officers
      </Link>{" "}
      so the Moderator can assign households.
    </p>
  );
}
