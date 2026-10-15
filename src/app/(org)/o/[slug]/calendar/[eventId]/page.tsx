import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, CalendarCog, MapPin, Repeat } from "lucide-react";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { assertOrgAccess, OrgAccessError, resolveOrgContext } from "@/lib/authz";
import { getMemberEvent } from "@/lib/calendar";
import { safeCalendarBackHref } from "@/lib/calendar/filters";
import { describeWhen } from "@/lib/calendar/wall-clock";
import { isFlagEnabled } from "@/lib/flags";
import { EventTypeChip } from "@/components/org-portal/event-types/event-type-chip";
import { Button } from "@/components/ui/button";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import { CalendarDisabled, CalendarForbidden, CalendarLoadError } from "../calendar-states";

const EVENTS_FLAG = "org_portal.events";

/**
 * `/o/<slug>/calendar/<eventId>?from` - the member's read-only view of one
 * event. The same gate order as the calendar page; `getMemberEvent` runs the
 * toggle and permission gate BEFORE any lookup, so existence is never revealed
 * to someone without access. A missing id, another organization's id, a
 * cancelled event and a non-UUID all come back as `event: null` and answer
 * with the same `notFound()`.
 *
 * `from` goes through `safeCalendarBackHref` (an open-redirect vector
 * otherwise) and is never reflected raw. Admin-only fields (public/members-only,
 * check-in, creator, recurrence pattern and count) are never rendered here.
 *
 * No `loading.tsx` on this segment: it can call `notFound()`.
 */
export default async function CalendarEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; eventId: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { slug, eventId } = await params;
  const { from } = await searchParams;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/calendar/${encodeURIComponent(eventId)}`)}`,
    );
  }

  const resolved = await resolveOrgContext(session.user.id, slug);

  switch (resolved.kind) {
    case "not-found":
      notFound();
    case "forbidden":
      return (
        <OrgAccessDenied
          name={resolved.name}
          organizationType={resolved.organizationType}
          slug={slug}
        />
      );
    case "ended":
      return <OrgAccessEnded name={resolved.name} endedOn={resolved.endedOn} slug={slug} />;
    case "ok":
      break;
  }

  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const orgName = resolved.org.name;

  let result;
  try {
    result = await getMemberEvent(resolved.org.personId, resolved.org.organizationId, eventId);
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <CalendarLoadError retryHref={`/o/${slug}/calendar`} />;
  }

  if (result.kind === "disabled") return <CalendarDisabled name={orgName} />;
  if (result.kind === "forbidden") return <CalendarForbidden name={orgName} />;

  const { event, canManage } = result.data;
  if (!event) notFound();

  let showEdit = false;
  if (canManage) {
    try {
      showEdit = await isFlagEnabled(EVENTS_FLAG);
    } catch {
      showEdit = false;
    }
  }

  const back = safeCalendarBackHref(slug, from);
  const when = describeWhen(event.startsAtWallClock, event.endsAtWallClock);

  return (
    <section className="max-w-2xl space-y-6">
      <Link
        href={back.href}
        className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
        {back.label === "home" ? "Back to home" : "Back to calendar"}
      </Link>

      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">{event.title}</h1>
        {event.eventType && (
          <EventTypeChip
            name={event.eventType.name}
            colorToken={event.eventType.colorToken}
            iconKey={event.eventType.iconKey}
          />
        )}
        <div className="text-base">
          <p className="font-medium">{when.start}</p>
          {when.end && <p className="text-muted-foreground">{when.end}</p>}
        </div>
        {event.location && (
          <p className="flex items-start gap-2 text-base">
            <MapPin className="mt-1 size-4 shrink-0" aria-hidden />
            <span className="break-words">{event.location}</span>
          </p>
        )}
        {event.isSeriesOccurrence && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Repeat className="size-4 shrink-0" aria-hidden />
            Part of a repeating series
          </p>
        )}
      </div>

      {event.description && (
        <p className="whitespace-pre-line break-words text-base">{event.description}</p>
      )}

      {showEdit && (
        <Button asChild variant="outline" className="min-h-11">
          <Link href={`/o/${slug}/admin/events/${event.id}`}>
            <CalendarCog className="size-4" aria-hidden />
            Edit this event
          </Link>
        </Button>
      )}
    </section>
  );
}
