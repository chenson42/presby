import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { getEvent } from "@/lib/events";
import { isFlagEnabled } from "@/lib/flags";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormattedDate } from "@/components/shared/formatted-date";
import { formatPattern } from "@/lib/events/recurrence";
import { OrgAccessDenied, OrgAccessEnded } from "../../../org-states";
import { EventsFlagOff, EventsForbidden, EventsLoadError } from "../events-states";
import { CancelEventDialog } from "../cancel-event-dialog";
import { ExtendSeriesForm } from "../extend-series-form";

const EVENTS_FLAG = "org_portal.events";

/**
 * `/o/<slug>/admin/events/<eventId>` — one event's own detail, its series
 * siblings (if any), and the Edit/Cancel/Extend-series affordances. docs/
 * work-log/2026-08-26-events-model.md.
 *
 * `getEvent()`'s `{ kind: "invalid_target" }` (a nonexistent id, or one from
 * a different org) is a real 404, not a load error — same discipline
 * `admin/groups/[groupId]/page.tsx` documents.
 *
 * `EXTENDSERIESFORM` RENDERS ONLY FOR A SERIES PARENT (`recurrencePattern`
 * non-null, `parentEventId` null) — a standalone event or a series CHILD
 * gets no extend affordance at all, matching Phase 3's Component Plan
 * exactly ("rendered only on a parent event's detail page").
 *
 * A CANCELLED EVENT GETS NO "Edit" LINK AND NO "Cancel event" BUTTON — Phase
 * 3's Edge Cases: a cancelled occurrence is not editable, and re-cancelling
 * is a harmless no-op the UI simply doesn't offer twice.
 */
export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ slug: string; eventId: string }>;
}) {
  const { slug, eventId } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/events/${eventId}`)}`,
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
      return (
        <OrgAccessEnded name={resolved.name} endedOn={resolved.endedOn} slug={slug} />
      );
    case "ok":
      break;
  }

  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const eventsEnabled = await isFlagEnabled(EVENTS_FLAG);
  if (!eventsEnabled) {
    return <EventsFlagOff name={resolved.org.name} />;
  }

  let result;
  try {
    result = await getEvent(resolved.org.personId, resolved.org.organizationId, eventId);
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <EventsLoadError slug={slug} />;
  }

  if (result.kind === "forbidden") {
    return <EventsForbidden name={resolved.org.name} />;
  }
  if (result.kind === "invalid_target") {
    notFound();
  }
  if (result.kind !== "ok") {
    return <EventsLoadError slug={slug} />;
  }

  const event = result.data;
  const isSeriesParent = event.isRecurringSeries;
  const isCancelled = event.cancelledAt !== null;

  return (
    <section className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{event.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          <FormattedDate value={event.startsAt} mode="datetime" />
          {event.endsAt && (
            <>
              {" – "}
              <FormattedDate value={event.endsAt} mode="datetime" />
            </>
          )}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {event.isPublic ? "Public" : "Members only"}
          {event.allowsCheckin && " · Check-in enabled"}
          {isCancelled && " · Cancelled"}
        </p>
        {event.location && (
          <p className="mt-2 text-sm text-muted-foreground">{event.location}</p>
        )}
        {event.description && (
          <p className="mt-2 text-sm text-muted-foreground">{event.description}</p>
        )}

        {!isCancelled && (
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={`/o/${slug}/admin/events/${eventId}/edit`}
              className="text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Edit event
            </Link>
            <CancelEventDialog
              slug={slug}
              eventId={eventId}
              eventTitle={event.title}
              isSeriesParent={isSeriesParent}
            />
          </div>
        )}
      </div>

      {(isSeriesParent || event.isSeriesOccurrence) && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Part of a series</h2>
          {event.recurrencePattern && (
            <p className="text-sm text-muted-foreground">
              Repeats {formatPattern(event.recurrencePattern)}
              {event.recurrenceCount ? ` — ${event.recurrenceCount} occurrences total` : ""}
            </p>
          )}
          {event.seriesOccurrences.length === 0 ? (
            <p className="text-sm text-muted-foreground">No other occurrences yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {event.seriesOccurrences.map((occurrence) => (
                  <TableRow key={occurrence.eventId}>
                    <TableCell>
                      <Link
                        href={`/o/${slug}/admin/events/${occurrence.eventId}`}
                        className="text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        <FormattedDate value={occurrence.startsAt} mode="datetime" />
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {occurrence.cancelledAt ? "Cancelled" : "Scheduled"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {isSeriesParent && !isCancelled && event.recurrencePattern && (
        <div className="max-w-md space-y-4">
          <h2 className="text-xl font-semibold">Extend this series</h2>
          <p className="text-sm text-muted-foreground">
            Adds occurrences going forward — the events already on the
            calendar are never moved or rewritten.
          </p>
          <ExtendSeriesForm
            slug={slug}
            parentEventId={eventId}
            currentPattern={event.recurrencePattern}
          />
        </div>
      )}
    </section>
  );
}
