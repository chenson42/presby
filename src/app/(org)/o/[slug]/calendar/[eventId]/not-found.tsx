import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Segment-local 404 for an `eventId` that doesn't resolve. `getMemberEvent()`
 * collapses "doesn't exist", "belongs to another organization", "not a UUID"
 * and "cancelled" (operator ruling, 2026-10-14: cancelled events are hidden
 * member-side) into the SAME `null`, and this copy matches: it doesn't say
 * which. Without this file the segment fell through to `[slug]/not-found.tsx`,
 * whose copy is about the ORGANIZATION not resolving — the wrong message for
 * an event link inside an organization the viewer IS already in, and a common
 * path now that a cancelled event's bookmarked or emailed link lands here
 * (Phase 6 N1, `docs/work-log/2026-10-14-member-calendar.md`). Mirrors
 * `directory/[personId]/not-found.tsx` and `tickets/[id]/not-found.tsx`.
 *
 * Next's `not-found.js` convention passes no props, so there is no slug to
 * build a calendar link from — `/home` is the one universally-safe
 * destination (DECISION-124/125; `/orgs` is a permanent redirect to it).
 *
 * NO `loading.tsx` ON THIS SEGMENT (CLAUDE.md: a segment whose job can 404
 * must not open a Suspense boundary that flushes a 200 first).
 */
export default function EventNotFound() {
  return (
    <section className="max-w-xl">
      <h1 className="text-2xl font-semibold">
        We couldn&apos;t find that event
      </h1>
      <p className="mt-3 text-base text-muted-foreground">
        It may have been cancelled or removed, or the link may belong to a
        different organization than the one you&apos;re signed into. Open the
        calendar from your organization&apos;s home page to see what&apos;s
        coming up.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href="/home">Back to your organizations</Link>
      </Button>
    </section>
  );
}
