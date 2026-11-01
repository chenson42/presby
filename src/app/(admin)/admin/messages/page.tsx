import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { FormattedDate } from "@/components/shared/formatted-date";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadError } from "@/components/shared/load-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HELP_CONTACT_FORM_COPY, HELP_CONTACT_INBOX_COPY as COPY } from "@/lib/help-contact/copy";
import { listMessages, parseCursor, type MessageStatusFilter } from "@/lib/help-contact/inbox";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { STATUS_BADGE_CLASS } from "./status-badge";

// XSS INVARIANT: every field of a message is a stranger's text. It renders as a
// plain JSX text node, never markdown, never HTML, never auto-linked, and this
// page has no dangerouslySetInnerHTML (C8, FC8).

const FILTERS: readonly MessageStatusFilter[] = ["new", "handled", "spam", "all"];

function hrefFor(status: MessageStatusFilter, before?: string): string {
  const params = new URLSearchParams({ status });
  if (before) params.set("before", before);
  return `/admin/messages?${params.toString()}`;
}

/**
 * `/admin/messages`: the contact-form inbox. A card per message, not a table:
 * the operator is likely to triage on a phone, and a wide table cannot be read
 * at 360px. The page re-checks `FEATURES.ADMIN_TICKETS` itself (the console
 * layout covers the session, never a page's own key), and reads only through
 * `inbox.ts`, the one file here that holds the platform connection.
 *
 * No `loading.tsx` anywhere under `(admin)/admin` (DECISION-251): a failed read
 * is the `LoadError` state, not a skeleton.
 */
export default async function AdminMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; before?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/admin/messages");

  if (!hasFeature(session.user.features, FEATURES.ADMIN_TICKETS)) {
    return <p className="text-sm text-muted-foreground">{COPY.noPermission}</p>;
  }

  const sp = await searchParams;
  const status: MessageStatusFilter = (FILTERS as readonly string[]).includes(sp.status ?? "")
    ? (sp.status as MessageStatusFilter)
    : "new";
  const before = parseCursor(sp.before);

  let page: Awaited<ReturnType<typeof listMessages>> | null = null;
  try {
    page = await listMessages({ status, before });
  } catch (err) {
    console.error(`[admin-messages] list failed: ${err instanceof Error ? err.name : typeof err}`);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{COPY.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{COPY.intro}</p>
      </div>

      <nav aria-label={COPY.filterLabel} className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f}
            asChild
            variant={f === status ? "default" : "outline"}
            className="min-h-11 px-4"
          >
            <Link href={hrefFor(f)} aria-current={f === status ? "page" : undefined}>
              {COPY.filters[f]}
            </Link>
          </Button>
        ))}
      </nav>

      {page === null ? (
        <LoadError
          title={COPY.loadErrorTitle}
          body={COPY.loadErrorBody}
          retryHref={hrefFor(status, before ?? undefined)}
        />
      ) : page.rows.length === 0 ? (
        <EmptyState title={COPY.empty[status]} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {page.rows.length === 1
              ? COPY.countOne(page.rows.length)
              : COPY.countMany(page.rows.length)}
          </p>
          <ul className="space-y-3">
            {page.rows.map((row) => (
              <li key={row.id} className="space-y-2 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  <FormattedDate value={row.createdAt} mode="datetime" />
                  <span>{HELP_CONTACT_FORM_COPY.topics[row.topic]}</span>
                  <Badge variant="outline" className={STATUS_BADGE_CLASS[row.status]}>
                    {COPY.badges[row.status]}
                  </Badge>
                  {row.cleared ? (
                    <Badge variant="outline" className="bg-muted text-muted-foreground">
                      {COPY.badges.cleared}
                    </Badge>
                  ) : null}
                </div>
                <p className="font-medium whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                  {row.name ?? COPY.noName}
                </p>
                {row.excerpt !== null ? (
                  <p className="text-sm break-words [overflow-wrap:anywhere]">{row.excerpt}</p>
                ) : null}
                <Link
                  href={`/admin/messages/${row.id}`}
                  className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {COPY.readLink}
                </Link>
              </li>
            ))}
          </ul>
          {page.hasMore ? (
            <Button asChild variant="outline" className="min-h-11 px-4">
              <Link href={hrefFor(status, page.rows[page.rows.length - 1]!.cursor)}>{COPY.olderLink}</Link>
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
