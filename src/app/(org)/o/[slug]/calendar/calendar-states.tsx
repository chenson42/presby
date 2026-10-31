import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FeaturesHelpLink } from "@/components/help/features-help-link";

/**
 * The three non-data answers `/o/<slug>/calendar` (and its detail page) can
 * give. The four-way org miss (denied / ended / 404) is handled one level up by
 * `org-states.tsx`, reused as-is. Three distinct copy blocks, deliberately not
 * collapsed: "turned off", "not for your account" and "broken" are different
 * facts and a reader should be able to tell them apart.
 */

/** The org's calendar toggle is off (or the worship category is). */
export function CalendarDisabled({ name }: { name: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Calendar</h1>
      <p className="mt-3 text-base text-muted-foreground">
        The calendar isn&apos;t turned on for {name} yet.
      </p>
      <FeaturesHelpLink />
    </section>
  );
}

/** The viewer holds neither `events.view` nor `events.manage`. */
export function CalendarForbidden({ name }: { name: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Calendar</h1>
      <p className="mt-3 text-base text-muted-foreground">
        The calendar isn&apos;t available to your account at {name} yet. If you
        think it should be, ask your stated clerk or another administrator
        there.
      </p>
    </section>
  );
}

/** A genuine, non-`OrgAccessError` failure reading the calendar. */
export function CalendarLoadError({ retryHref }: { retryHref: string }) {
  return (
    <section>
      <h1 className="text-2xl font-semibold">Calendar</h1>
      <p className="mt-3 text-base text-muted-foreground">
        We couldn&apos;t load the calendar right now. Try again in a moment.
      </p>
      <Button asChild className="mt-6 min-h-11">
        <Link href={retryHref}>Try again</Link>
      </Button>
    </section>
  );
}
