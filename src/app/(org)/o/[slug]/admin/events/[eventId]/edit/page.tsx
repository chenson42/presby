import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { getEvent } from "@/lib/events";
import { isFlagEnabled } from "@/lib/flags";
import { OrgAccessDenied, OrgAccessEnded } from "../../../../org-states";
import { EventsFlagOff, EventsForbidden, EventsLoadError } from "../../events-states";
import { EditEventForm } from "../../edit-event-form";

const EVENTS_FLAG = "org_portal.events";

/**
 * `/o/<slug>/admin/events/<eventId>/edit` — Flow 2 (single occurrence).
 *
 * A CANCELLED EVENT 404s HERE, NOT JUST HIDES ITS OWN "Edit" LINK ONE LEVEL
 * UP — the load-bearing guard Phase 3's Edge Cases names ("a cancelled
 * occurrence is not editable"). `updateEvent()` independently re-checks this
 * server-side too (`invalid_target` for a cancelled row) — this page's
 * `notFound()` is the application-layer half, not the only one.
 */
export default async function EditEventPage({
  params,
}: {
  params: Promise<{ slug: string; eventId: string }>;
}) {
  const { slug, eventId } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/events/${eventId}/edit`)}`,
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

  // A cancelled event is not editable — same 404, indistinguishable from a
  // nonexistent id (Phase 3's Edge Cases, this page's own header).
  if (result.data.cancelledAt !== null) {
    notFound();
  }

  return (
    <section className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Edit event</h1>
        <p className="mt-1 text-sm text-muted-foreground">{resolved.org.name}</p>
      </div>
      <EditEventForm slug={slug} event={result.data} />
    </section>
  );
}
