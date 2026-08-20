import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Segment-local 404 for a ticket id that doesn't resolve —
 * `getTicketThread()` collapses "doesn't exist" and "belongs to another
 * org" into one `{ kind: "not_found" }` (Flow 2's enumeration discipline),
 * and this copy matches: it doesn't say which. `[slug]/not-found.tsx`'s own
 * copy is about the ORGANIZATION not resolving, which is the wrong message
 * for a ticket id inside an organization the viewer IS already in — a
 * dedicated boundary, not a reuse.
 *
 * Next's `not-found.js` convention passes no props (not even the dynamic
 * segment's own params), so this renders no slug-specific link — `/orgs` is
 * the one universally-safe destination every not-found page in this tree
 * can name without it.
 *
 * NO `loading.tsx` ON THIS SEGMENT (CLAUDE.md: a segment whose job can 404
 * must not open a Suspense boundary that flushes a 200 first).
 */
export default function TicketNotFound() {
  return (
    <section className="max-w-xl">
      <h1 className="text-2xl font-semibold">
        We couldn&apos;t find that ticket
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        It may not exist, or it may belong to a different organization than
        the one you&apos;re signed into.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href="/orgs">Back to your organizations</Link>
      </Button>
    </section>
  );
}
