import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Segment-local 404 for a `personId` that doesn't resolve —
 * `getPersonDetail()` collapses "doesn't exist", "belongs to another org",
 * and "currently ineligible/privacy-hidden" into the SAME
 * `{ kind: "not-found" }` (DECISION-040's non-disclosure discipline,
 * extended to this surface per the Phase 3 design), and this copy matches:
 * it doesn't say which. `[slug]/not-found.tsx`'s own copy is about the
 * ORGANIZATION not resolving, which is the wrong message for a person id
 * inside an organization the viewer IS already in — a dedicated boundary,
 * not a reuse (mirrors `tickets/[id]/not-found.tsx`'s own precedent).
 *
 * Next's `not-found.js` convention passes no props, so this renders no
 * slug-specific link — `/orgs` is the one universally-safe destination.
 *
 * NO `loading.tsx` ON THIS SEGMENT (CLAUDE.md: a segment whose job can 404
 * must not open a Suspense boundary that flushes a 200 first).
 */
export default function PersonNotFound() {
  return (
    <section className="max-w-xl">
      <h1 className="text-2xl font-semibold">
        We couldn&apos;t find that person
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        They may not exist, may belong to a different organization than the
        one you&apos;re signed into, or may not currently appear in the
        directory.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href="/orgs">Back to your organizations</Link>
      </Button>
    </section>
  );
}
