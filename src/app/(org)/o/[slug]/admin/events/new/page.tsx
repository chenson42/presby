import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { listEvents } from "@/lib/events";
import { isFlagEnabled } from "@/lib/flags";
import { OrgAccessDenied, OrgAccessEnded } from "../../../org-states";
import { EventsFlagOff, EventsForbidden, EventsLoadError } from "../events-states";
import { NewEventForm } from "../new-event-form";

const EVENTS_FLAG = "org_portal.events";

/**
 * `/o/<slug>/admin/events/new` — Flow 1/2. Repeats the `(org)` auth pattern
 * in full, per the groups/officers precedent.
 *
 * NO DEDICATED FORM-OPTIONS QUERY EXISTS — unlike `admin/groups/new/
 * page.tsx`, `NewEventForm` needs no dynamic data (no group-type catalog, no
 * people list) to render. `listEvents()` is called anyway, ITS DATA
 * DISCARDED, purely to derive the `events.manage` gate the same way
 * `admin/groups/new/page.tsx` derives `canCreate` from `getGroupFormOptions`'s
 * own result kind — reusing the one already-gated read this module exports
 * rather than inventing a second, narrower permission-only export.
 */
export default async function NewEventPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/events/new`)}`);
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
    result = await listEvents(resolved.org.personId, resolved.org.organizationId);
  } catch (err) {
    if (err instanceof OrgAccessError) {
      throw err;
    }
    return <EventsLoadError slug={slug} />;
  }

  if (result.kind === "forbidden") {
    return <EventsForbidden name={resolved.org.name} />;
  }
  if (result.kind !== "ok") {
    return <EventsLoadError slug={slug} />;
  }

  return (
    <section className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New event</h1>
        <p className="mt-1 text-sm text-muted-foreground">{resolved.org.name}</p>
      </div>
      <NewEventForm slug={slug} />
    </section>
  );
}
