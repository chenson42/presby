import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cachedAuth } from "@/lib/auth/cached-auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
} from "@/lib/authz";
import { getTicketThread } from "@/lib/tickets";
import { isFlagEnabled } from "@/lib/flags";
import { Badge } from "@/components/ui/badge";
import { FormattedDate } from "@/components/shared/formatted-date";
import { OrgAccessDenied, OrgAccessEnded } from "../../org-states";
import {
  TicketsFlagOff,
  TicketsForbidden,
  TicketsLoadError,
} from "../tickets-states";
import {
  CHANGE_CLASS_LABELS,
  PRIORITY_BADGE_VARIANT,
  STATUS_BADGE_VARIANT,
  TICKET_AREA_LABELS,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
} from "@/lib/tickets-labels";
import { AttachmentDisplay } from "./attachment-display";
import { ReplyForm } from "./reply-form";

/**
 * `/o/<slug>/tickets/<id>` — thread, reply, attachment display.
 * `getTicketThread()`'s `{ kind: "not_found" }` → `notFound()`, rendered by
 * this segment's own `not-found.tsx` (no `loading.tsx` here — see that
 * file's header).
 */
export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;

  const session = await cachedAuth();
  if (!session?.user) {
    redirect(
      `/signin?callbackUrl=${encodeURIComponent(`/o/${slug}/tickets/${id}`)}`,
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

  const ticketsEnabled = await isFlagEnabled("org_portal.tickets");
  if (!ticketsEnabled) {
    return <TicketsFlagOff name={resolved.org.name} />;
  }

  let threadResult;
  try {
    threadResult = await getTicketThread(
      resolved.org.personId,
      resolved.org.organizationId,
      id,
    );
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <TicketsLoadError slug={slug} />;
  }

  if (threadResult.kind === "forbidden") {
    return <TicketsForbidden name={resolved.org.name} slug={slug} />;
  }
  if (threadResult.kind === "not_found") {
    notFound();
  }

  const { thread } = threadResult;

  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <Link
          href={`/o/${slug}/tickets`}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to tickets
        </Link>
        <h1 className="mt-3 text-2xl font-semibold">{thread.subject}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge variant={STATUS_BADGE_VARIANT[thread.status]}>
            {TICKET_STATUS_LABELS[thread.status]}
          </Badge>
          <Badge variant={PRIORITY_BADGE_VARIANT[thread.priority]}>
            {TICKET_PRIORITY_LABELS[thread.priority]}
          </Badge>
          <Badge variant="outline">{TICKET_AREA_LABELS[thread.area]}</Badge>
          <Badge variant="outline">
            {CHANGE_CLASS_LABELS[thread.changeClass]}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Filed by {thread.submitterDisplayName} on{" "}
          <FormattedDate value={thread.createdAt} mode="datetime" />
        </p>
      </div>

      <div className="space-y-4">
        {thread.messages.map((message) => (
          <div
            key={message.messageId}
            className={
              message.authorKind === "operator"
                ? "rounded-md border border-primary/30 bg-muted/40 p-3"
                : "rounded-md border border-border p-3"
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {message.authorDisplayName}{" "}
                <Badge variant="outline" className="ml-1 font-normal">
                  {message.authorKind === "operator"
                    ? "Platform team"
                    : "Submitter"}
                </Badge>
              </span>
              <span className="text-xs text-muted-foreground">
                <FormattedDate value={message.createdAt} mode="datetime" />
              </span>
            </div>
            <p className="mt-2 text-sm whitespace-pre-wrap">{message.body}</p>
            {message.attachment && (
              <AttachmentDisplay
                slug={slug}
                ticketId={thread.ticketId}
                attachment={message.attachment}
              />
            )}
          </div>
        ))}
      </div>

      <ReplyForm slug={slug} ticketId={thread.ticketId} />
    </section>
  );
}
