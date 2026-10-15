import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cachedAuth } from "@/lib/auth/cached-auth";
import { assertOrgAccess, OrgAccessError, resolveOrgContext } from "@/lib/authz";
import { listEventTypes } from "@/lib/event-types";
import { isFlagEnabled } from "@/lib/flags";
import { Card, CardContent } from "@/components/ui/card";
import { OrgAccessDenied, OrgAccessEnded } from "../../../org-states";
import { EventsFlagOff } from "../events-states";
import { EventTypeForm } from "./event-type-form";
import { EventTypeList } from "./event-type-list";
import { EventTypesForbidden, EventTypesLoadError } from "./event-types-states";
import { SeedStandardTypesButton } from "./seed-standard-types-button";

const EVENTS_FLAG = "org_portal.events";

/**
 * `/o/<slug>/admin/events/types` - the event-types manager. Same auth chain as
 * `../page.tsx`, then the `org_portal.events` flag (BARE, before any read),
 * then `listEventTypes` under `event_types.manage` ONLY - `events.manage` alone
 * is `forbidden` here. No `loading.tsx` (the segment can `notFound()`).
 */
export default async function EventTypesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/events/types`)}`);
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

  const eventsEnabled = await isFlagEnabled(EVENTS_FLAG);
  if (!eventsEnabled) {
    return <EventsFlagOff name={resolved.org.name} />;
  }

  let result;
  try {
    result = await listEventTypes(resolved.org.personId, resolved.org.organizationId);
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <EventTypesLoadError slug={slug} />;
  }

  if (result.kind === "forbidden") {
    return <EventTypesForbidden name={resolved.org.name} />;
  }
  if (result.kind !== "ok") {
    return <EventTypesLoadError slug={slug} />;
  }

  const types = result.data;

  return (
    <section className="max-w-3xl space-y-6">
      <Link
        href={`/o/${slug}/admin/events`}
        className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
        Back to events
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">Event types</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Colors and icons used on the calendar for {resolved.org.name}.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Retired types stay on the events that already use them. They won&apos;t be
          offered for new events or shown as a filter.
        </p>
      </div>

      {types.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-base font-medium">No event types yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Start with the standard set, or add your own below.
          </p>
          <div className="mt-4">
            <SeedStandardTypesButton slug={slug} />
          </div>
        </div>
      ) : (
        <EventTypeList slug={slug} types={types} />
      )}

      <Card>
        <CardContent className="space-y-4">
          <h2 className="text-xl font-semibold">Add an event type</h2>
          <EventTypeForm slug={slug} mode="create" />
        </CardContent>
      </Card>
    </section>
  );
}
