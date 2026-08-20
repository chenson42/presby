import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { getFeedbackPreview, listTickets } from "@/lib/tickets";
import { isFlagEnabled } from "@/lib/flags";
import { Button } from "@/components/ui/button";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import {
  TicketsFlagOff,
  TicketsForbidden,
  TicketsLoadError,
} from "../tickets-states";
import { FileTicketForm } from "../file-ticket-form";

/**
 * `/o/<slug>/tickets/new` — the filing form. When `?fromFeedback=<id>` is
 * present, this is Flow 0's promotion step instead of Flow 1's direct
 * filing: `getFeedbackPreview()` powers the pre-fill banner, and
 * `<FileTicketForm>` submits through `promoteFeedbackAction` rather than
 * `fileTicketAction` (Phase 3's "one page component, two submit targets").
 *
 * BELT-AND-SUSPENDERS PERMISSION CHECK, on purpose: `tickets/layout.tsx`'s
 * "File a ticket" nav link renders unconditionally (it has no data to gate
 * on), so a forbidden visitor CAN reach this URL directly. `fileTicket()`/
 * `promoteFeedbackToTicket()` re-check `tickets.file` at submit time
 * regardless — that's the real gate — but showing a whole form that only
 * fails on submit is a worse experience than the honest `TicketsForbidden`
 * state every other tickets page already has. `listTickets()` is the
 * cheapest already-built call that carries the same gate; its `.tickets`
 * data is discarded here.
 */
export default async function NewTicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ fromFeedback?: string }>;
}) {
  const { slug } = await params;
  const { fromFeedback } = await searchParams;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/tickets/new`)}`,
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

  let gateResult;
  try {
    gateResult = await listTickets(
      resolved.org.personId,
      resolved.org.organizationId,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <TicketsLoadError slug={slug} />;
  }
  if (gateResult.kind === "forbidden") {
    return <TicketsForbidden name={resolved.org.name} slug={slug} />;
  }

  if (fromFeedback) {
    let previewResult;
    try {
      previewResult = await getFeedbackPreview(
        resolved.org.personId,
        resolved.org.organizationId,
        fromFeedback,
      );
    } catch (err) {
      if (err instanceof OrgAccessError) throw err;
      return <TicketsLoadError slug={slug} />;
    }

    if (previewResult.kind === "forbidden") {
      return <TicketsForbidden name={resolved.org.name} slug={slug} />;
    }

    if (previewResult.kind === "not_found") {
      return (
        <section className="max-w-xl space-y-4">
          <h1 className="text-2xl font-semibold">File a ticket</h1>
          <p className="text-sm text-muted-foreground">
            That feedback doesn&apos;t exist anymore.
          </p>
          <Button asChild className="min-h-11">
            <Link href={`/o/${slug}/tickets`}>Back to tickets</Link>
          </Button>
        </section>
      );
    }

    if (previewResult.feedback.status !== "new") {
      return (
        <section className="max-w-xl space-y-4">
          <h1 className="text-2xl font-semibold">File a ticket</h1>
          <p className="text-sm text-muted-foreground">
            That feedback has already been{" "}
            {previewResult.feedback.status === "promoted"
              ? "promoted to a ticket"
              : "dismissed"}
            .
          </p>
          <Button asChild className="min-h-11">
            <Link href={`/o/${slug}/tickets`}>Back to tickets</Link>
          </Button>
        </section>
      );
    }

    return (
      <section className="max-w-xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">File a ticket</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {resolved.org.name}
          </p>
        </div>
        <FileTicketForm
          slug={slug}
          fromFeedback={{
            feedbackId: previewResult.feedback.feedbackId,
            submitterDisplayName: previewResult.feedback.submitterDisplayName,
            body: previewResult.feedback.body,
          }}
        />
      </section>
    );
  }

  return (
    <section className="max-w-xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">File a ticket</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {resolved.org.name}
        </p>
      </div>
      <FileTicketForm slug={slug} />
    </section>
  );
}
