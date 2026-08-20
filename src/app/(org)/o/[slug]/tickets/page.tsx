import { notFound, redirect } from "next/navigation";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { listPendingFeedback, listTickets } from "@/lib/tickets";
import { listSiteContactMessages } from "@/lib/sites";
import { isFlagEnabled } from "@/lib/flags";
import { OrgAccessDenied, OrgAccessEnded } from "../org-states";
import { TicketsFlagOff, TicketsForbidden, TicketsLoadError } from "./tickets-states";
import { TicketList } from "./ticket-list";
import { FeedbackReviewList } from "./feedback-review-list";
import { SiteMessagesList } from "./site-messages-list";

/**
 * `/o/<slug>/tickets` — the ticket list AND the feedback review queue on one
 * page. Two sections, same shape `admin/roles/page.tsx` already established
 * ("Who holds what" + "Grant a role") — Phase 3's own answer to "where does
 * a role-holder review incoming feedback": a section here, not a fourth
 * route.
 *
 * REPEATS THE `(org)` AUTH PATTERN IN FULL, on purpose — see
 * `admin/roles/page.tsx`'s header for the fuller rationale.
 *
 * THE FLAG CHECK RUNS BEFORE `listTickets()`/`listPendingFeedback()` ARE
 * EVER CALLED — same reasoning as `org_portal.roles`.
 *
 * `listTickets()`/`listPendingFeedback()` THROW `OrgAccessError` on a
 * relationship that vanished mid-request (re-thrown, not swallowed —
 * `[slug]/error.tsx` has the right copy one level up) and return a typed
 * `{ kind: "forbidden" }` for "no `tickets.file` grant" — two different
 * failure shapes, handled differently, same contract `src/lib/tickets.ts`'s
 * header documents.
 */
export default async function TicketsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/tickets`)}`);
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
        />
      );
    case "ended":
      return (
        <OrgAccessEnded name={resolved.name} endedOn={resolved.endedOn} />
      );
    case "ok":
      break;
  }

  await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);

  const ticketsEnabled = await isFlagEnabled("org_portal.tickets");
  if (!ticketsEnabled) {
    return <TicketsFlagOff name={resolved.org.name} />;
  }

  let ticketsResult;
  try {
    ticketsResult = await listTickets(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <TicketsLoadError slug={slug} />;
  }

  if (ticketsResult.kind === "forbidden") {
    return <TicketsForbidden name={resolved.org.name} slug={slug} />;
  }

  let feedbackResult;
  try {
    feedbackResult = await listPendingFeedback(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <TicketsLoadError slug={slug} />;
  }

  if (feedbackResult.kind === "forbidden") {
    // Unreachable in practice — listTickets() already confirmed the same
    // tickets.file gate above. Handled anyway rather than assumed, since
    // the two are separate calls (mirrors roles/page.tsx's identical note).
    return <TicketsForbidden name={resolved.org.name} slug={slug} />;
  }

  // ContactForm's read side (DECISION-089) — same tickets.file gate as the
  // two calls above, imported from @/lib/sites rather than @/lib/tickets.
  // No try/catch: listSiteContactMessages() uses withOrgContext() exactly
  // like listTickets()/listPendingFeedback() and can throw the identical
  // OrgAccessError for the identical rare mid-request-revoked-membership
  // race; re-thrown for [slug]/error.tsx one level up, same as those two.
  let siteMessagesResult;
  try {
    siteMessagesResult = await listSiteContactMessages(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <TicketsLoadError slug={slug} />;
  }

  if (siteMessagesResult.kind === "forbidden") {
    // Unreachable in practice — the same reasoning as feedbackResult above.
    return <TicketsForbidden name={resolved.org.name} slug={slug} />;
  }

  return (
    <section className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Tickets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolved.org.name}
        </p>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Open tickets</h2>
        <TicketList tickets={ticketsResult.tickets} slug={slug} />
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Incoming feedback</h2>
        <p className="text-sm text-muted-foreground">
          Shared by any current member — promote what needs to become a
          ticket, or dismiss it.
        </p>
        <FeedbackReviewList feedback={feedbackResult.feedback} slug={slug} />
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Site messages</h2>
        <p className="text-sm text-muted-foreground">
          Sent through {resolved.org.name}&apos;s public website contact
          form, if it has one.
        </p>
        <SiteMessagesList messages={siteMessagesResult.messages} slug={slug} />
      </div>
    </section>
  );
}
