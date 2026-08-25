import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Segment-local 404 for a `householdId` that doesn't resolve — mirrors
 * `directory/[personId]/not-found.tsx`'s own precedent exactly.
 * `getHouseholdDetail()` collapses "doesn't exist", "belongs to another
 * org", and "zero currently-visible members" into the SAME
 * `{ kind: "not-found" }`, so this copy doesn't say which.
 *
 * NO `loading.tsx` ON THIS SEGMENT (CLAUDE.md: a segment whose job can 404
 * must not open a Suspense boundary that flushes a 200 first).
 */
export default function HouseholdNotFound() {
  return (
    <section className="max-w-xl">
      <h1 className="text-2xl font-semibold">
        We couldn&apos;t find that household
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        It may not exist, may belong to a different organization than the one
        you&apos;re signed into, or may have no currently visible members.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href="/orgs">Back to your organizations</Link>
      </Button>
    </section>
  );
}
