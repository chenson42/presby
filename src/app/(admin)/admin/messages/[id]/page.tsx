import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/auth";
import { FormattedDate } from "@/components/shared/formatted-date";
import { LoadError } from "@/components/shared/load-error";
import { Badge } from "@/components/ui/badge";
import { HELP_CONTACT_FORM_COPY, HELP_CONTACT_INBOX_COPY as COPY } from "@/lib/help-contact/copy";
import { isMessageId, readMessage, type InboxDetail } from "@/lib/help-contact/inbox";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { ClearDetailsDialog } from "../clear-details-dialog";
import { MessageTriage } from "../message-triage";
import { STATUS_BADGE_CLASS } from "../status-badge";

// XSS INVARIANT: every field below is a stranger's text. Each one renders as a
// plain JSX text node inside an isolated `whitespace-pre-wrap break-words`
// container: never markdown, never HTML, never auto-linked, and this file has no
// dangerouslySetInnerHTML (C8, FC8). Plain text still permits spoofing by
// look-alike characters; bidi overrides and zero-width characters were stripped
// on save, and the email carries its "Not verified" caption.

/** One field: label, then the text in an isolated container. `null` is "Not given", or "Cleared" once the details were cleared. */
function Field({
  label,
  value,
  cleared,
  caption,
}: {
  label: string;
  value: string | null;
  cleared: boolean;
  caption?: string;
}) {
  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1">
        <div className="rounded-md border border-border bg-background px-3 py-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
          {value !== null && value !== "" ? value : cleared ? COPY.clearedField : COPY.notGiven}
        </div>
        {caption && value ? (
          <p className="mt-1 text-sm text-muted-foreground">{caption}</p>
        ) : null}
      </dd>
    </div>
  );
}

/**
 * `/admin/messages/<id>`: one message, as plain text, with the status control and
 * "Clear details". `notFound()` for a non-UUID or a missing row (so no
 * `loading.tsx` may exist above it: DECISION-251).
 */
export default async function AdminMessageDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/admin/messages");
  if (!hasFeature(session.user.features, FEATURES.ADMIN_TICKETS)) {
    return <p className="text-sm text-muted-foreground">{COPY.noPermission}</p>;
  }

  if (!isMessageId(id)) notFound();

  let message: InboxDetail | null = null;
  let failed = false;
  try {
    message = await readMessage(id);
  } catch (err) {
    failed = true;
    console.error(`[admin-messages] read failed: ${err instanceof Error ? err.name : typeof err}`);
  }
  if (!failed && message === null) notFound();

  const back = (
    <Link
      href="/admin/messages"
      className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <ArrowLeft className="mr-1 h-4 w-4" aria-hidden />
      {COPY.backLink}
    </Link>
  );

  if (failed || message === null) {
    return (
      <div className="max-w-2xl space-y-6">
        {back}
        <LoadError
          headingLevel={1}
          title={COPY.loadErrorTitle}
          body={COPY.loadErrorBody}
          retryHref={`/admin/messages/${id}`}
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        {back}
        <h1 className="mt-1 text-2xl font-semibold">{COPY.readLink}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={STATUS_BADGE_CLASS[message.status]}>
            {COPY.badges[message.status]}
          </Badge>
          {message.cleared ? (
            <Badge variant="outline" className="bg-muted text-muted-foreground">
              {COPY.badges.cleared}
            </Badge>
          ) : null}
        </div>
      </div>

      <dl className="space-y-4">
        <div>
          <dt className="text-sm font-medium text-muted-foreground">{COPY.labels.sent}</dt>
          <dd className="mt-1">
            <FormattedDate value={message.createdAt} mode="datetime" />
          </dd>
        </div>
        <Field
          label={COPY.labels.topic}
          value={HELP_CONTACT_FORM_COPY.topics[message.topic]}
          cleared={false}
        />
        <Field label={COPY.labels.name} value={message.name} cleared={message.cleared} />
        <Field
          label={COPY.labels.email}
          value={message.email}
          cleared={message.cleared}
          caption={COPY.emailCaption}
        />
        <Field label={COPY.labels.congregation} value={message.congregation} cleared={message.cleared} />
        <Field label={COPY.labels.message} value={message.message} cleared={message.cleared} />
      </dl>

      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">{COPY.guidance}</p>

      <div className="space-y-1 text-sm text-muted-foreground">
        {message.statusChangedAt ? (
          <p>
            {COPY.stampLead(COPY.badges[message.status], message.statusChangedByName)}
            <FormattedDate value={message.statusChangedAt} mode="datetime" />
            {COPY.stampTail}
          </p>
        ) : null}
        {message.clearedAt ? (
          <p>
            {COPY.clearedLead(message.clearedByName)}
            <FormattedDate value={message.clearedAt} mode="datetime" />
            {COPY.stampTail}
          </p>
        ) : null}
      </div>

      <div className="space-y-3">
        <MessageTriage id={message.id} status={message.status} cleared={message.cleared} />
        {message.cleared ? null : message.status === "new" ? (
          <p className="text-sm text-muted-foreground">{COPY.clearHintNew}</p>
        ) : (
          <ClearDetailsDialog id={message.id} />
        )}
      </div>
    </div>
  );
}
