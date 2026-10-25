import { Button } from "@/components/ui/button";
import { parseCalendarFilter } from "@/lib/calendar/public-contract";
import { readPublicCalendar } from "@/lib/public-calendar";
import type { SiteUrls } from "@/lib/site-urls";
import { buildCalendarModel } from "./events-calendar-model";
import { EventsCalendarPanel } from "./events-calendar-panel";
import { EventsCalendarSwitcher } from "./events-calendar-switcher";

/**
 * The `eventsCalendar` live slot (docs/work-log/2026-10-25-public-events-
 * calendar.md, Phase 3; DECISION-238/239/241): a content author places
 * `{"type": "liveSlot", "props": {"slot": "eventsCalendar"}}` on any page and a
 * month calendar (a list on a phone) of the events an editor chose to put on the
 * website renders right there.
 *
 * Same live-slot discipline as the staff directory and the giving form: a plain
 * async Server Component, and the closure in `render-site-page.tsx` closes over
 * the DATABASE-RETURNED `slug` and `urls` ONLY - never the site key, a request,
 * a header or a cookie (DECISION-132). The marker's `filter` is untrusted
 * author JSON; `parseCalendarFilter` honours exactly `view: "month" | "list"`.
 *
 * STATES. `unavailable` (the toggle is off, the category is off, the site is not
 * serving, or the read FAILED - one string for all of them, so the page never
 * claims "no events" when it does not know, DECISION-154) -> P1. `available`
 * with no events in the window -> P2 (a SUCCESSFUL read; the phone appears only
 * if the profile has one). Otherwise the island, with one pre-rendered panel per
 * month. Only when the congregation's member calendar is on does a "Member
 * sign-in" prompt follow, and its link is `urls.portalCalendar()` exactly: an
 * absolute platform-host URL with no visitor-controlled `callbackUrl` (the proxy
 * sends the unauthenticated visitor to /signin with the right one).
 *
 * The slot holds no event id (there is none to hold) and renders every string as
 * React-escaped text. The host page owns the `h1`, so headings here start at
 * `h2`.
 */

const SECTION = "mx-auto max-w-5xl px-4 py-8";

export async function PublicEventsCalendarSlot({
  slug,
  urls,
  filter,
}: {
  /** The organization's slug AS THE DATABASE RETURNED IT. */
  slug: string;
  urls: SiteUrls;
  filter: Record<string, unknown>;
}) {
  const calendar = await readPublicCalendar(slug);

  if (calendar.state === "unavailable") {
    return (
      <section aria-label="Events calendar" className={SECTION}>
        <p data-testid="public-calendar-unavailable" className="text-base">
          Our events calendar isn&apos;t available right now. Please check back soon.
        </p>
      </section>
    );
  }

  const { view } = parseCalendarFilter(filter);

  const memberPrompt = calendar.memberCalendarOn ? (
    <div className="mt-8 flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-base">
        Church members: sign in to see the member calendar, which can include events not shown
        here.
      </p>
      {/* `text-primary-foreground!`: the site stylesheet colours every `.presby-site a` with --primary,
          which would paint this label the colour of its own button. */}
      <Button asChild className="min-h-11 shrink-0 text-primary-foreground!">
        <a href={urls.portalCalendar()}>Member sign-in</a>
      </Button>
    </div>
  ) : null;

  if (calendar.events.length === 0) {
    return (
      <section aria-label="Events calendar" className={SECTION}>
        <p data-testid="public-calendar-empty" className="text-base">
          No events are on this calendar right now. Please check back soon.
          {calendar.contactPhone ? ` You can also call us at ${calendar.contactPhone}.` : ""}
        </p>
        {memberPrompt}
      </section>
    );
  }

  const model = buildCalendarModel(calendar);

  return (
    <section aria-label="Events calendar" className={SECTION}>
      <EventsCalendarSwitcher
        months={model.months.map((month) => ({
          key: month.key,
          label: month.label,
          panel: <EventsCalendarPanel month={month} />,
        }))}
        initialIndex={model.initialIndex}
        currentIndex={model.currentIndex}
        initialView={view}
        hasEarlierInCurrent={model.hasEarlierInCurrent}
        edgeNote={model.edgeNote}
      />
      {memberPrompt}
    </section>
  );
}
