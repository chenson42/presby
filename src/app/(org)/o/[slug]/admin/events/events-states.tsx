import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The three non-data-bearing answers `/o/<slug>/admin/events` (and its
 * `[eventId]`/`[eventId]/edit`/`new` sub-routes) can give (a fourth — an
 * unauthorized org, or a 404 slug — is handled one level up by
 * `org-states.tsx` / `not-found.tsx`, reused as-is rather than duplicated).
 * Modeled directly on `groups/groups-states.tsx`, per Phase 3's own
 * instruction.
 *
 * THREE DISTINCT COPY BLOCKS, DELIBERATELY NOT COLLAPSED (same rationale
 * `groups-states.tsx`'s header documents): a reader who only skims one of
 * these three should not be able to guess what the other two say.
 */

/** `org_portal.events` is off. A product-not-here message, not a denial. */
export function EventsFlagOff({ name }: { name: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Events</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Calendar-event administration isn&apos;t turned on for {name} yet.
      </p>
    </section>
  );
}

/**
 * `listEvents()`/`getEvent()` returned `{ kind: "forbidden" }` — the viewer
 * has an active relationship with the organization but holds no
 * `events.manage` grant. Worded deliberately unlike `OrgAccessDenied`'s "you
 * don't have access to {org}" — one capability is unavailable, not their
 * whole portal access.
 */
export function EventsForbidden({ name }: { name: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Events</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        You don&apos;t have permission to manage events at {name}. If you
        think this is a mistake, ask your stated clerk or another
        administrator there.
      </p>
    </section>
  );
}

/**
 * A genuine, non-`OrgAccessError` failure reading event data. The retry is a
 * plain `<Link>` back to the events list — this stays a Server Component, so
 * there is no client `reset()` to call, unlike `[slug]/error.tsx`.
 */
export function EventsLoadError({ slug }: { slug: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Events</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        We couldn&apos;t load event records right now. Try again in a moment.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={`/o/${slug}/admin/events`}>Try again</Link>
      </Button>
    </section>
  );
}
