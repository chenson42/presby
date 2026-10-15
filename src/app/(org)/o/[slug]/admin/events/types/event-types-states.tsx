import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * The non-data answers `/o/<slug>/admin/events/types` can give, modelled on
 * `../events-states.tsx`. (The flag-off answer reuses `EventsFlagOff` from
 * there as-is.)
 */

/** The viewer lacks `event_types.manage` (a separate permission from `events.manage`). */
export function EventTypesForbidden({ name }: { name: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Event types</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        You don&apos;t have permission to manage event types at {name}. If you
        think this is a mistake, ask your stated clerk or another
        administrator there.
      </p>
    </section>
  );
}

export function EventTypesLoadError({ slug }: { slug: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Event types</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        We couldn&apos;t load event types right now. Try again in a moment.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={`/o/${slug}/admin/events/types`}>Try again</Link>
      </Button>
    </section>
  );
}
