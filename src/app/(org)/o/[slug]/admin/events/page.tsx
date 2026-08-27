import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { listEvents } from "@/lib/events";
import { isFlagEnabled } from "@/lib/flags";
import { Button } from "@/components/ui/button";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import { EventsFlagOff, EventsForbidden, EventsLoadError } from "./events-states";
import { EventsList } from "./events-list";

const EVENTS_FLAG = "org_portal.events";

/**
 * `/o/<slug>/admin/events` — the event list + "New event" entry point.
 * docs/work-log/2026-08-26-events-model.md, Phase 3 design, Phase 4 commit 2.
 * Repeats the `(org)` auth pattern in full, same as every other page under
 * `(org)` — see `admin/groups/page.tsx`'s header for the fuller rationale on
 * why the auth check lives in the page rather than the layout.
 *
 * THE FLAG CHECK RUNS BEFORE `listEvents()` IS EVER CALLED, same ordering
 * `admin/groups/page.tsx`/`admin/officers/page.tsx` use. `org_portal.events`
 * is checked BARE — no `organization_feature_toggles` row, same posture as
 * `org_portal.groups`/`officers`.
 *
 * `listEvents()` THROWS on genuine failure rather than returning a result
 * variant for it (mirrors `groups.ts`'s contract) — `OrgAccessError` is
 * RE-THROWN, not swallowed; anything else renders the load-error state.
 *
 * `canCreate` IS IMPLIED BY `listEvents()`'s OWN "ok" RESULT — `listEvents()`
 * already required `events.manage` to succeed at all, so a `forbidden`
 * result short-circuits the whole page before this point (same reasoning
 * `admin/groups/page.tsx` uses for `NewGroupForm`'s own entry point).
 */
export default async function EventsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/admin/events`)}`);
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
    <section className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Events</h1>
          <p className="mt-1 text-sm text-muted-foreground">{resolved.org.name}</p>
        </div>
        <Button asChild className="min-h-11">
          <Link href={`/o/${slug}/admin/events/new`}>New event</Link>
        </Button>
      </div>

      <EventsList slug={slug} entries={result.data} />
    </section>
  );
}
