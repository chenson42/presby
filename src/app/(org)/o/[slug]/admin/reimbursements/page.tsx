import Link from "next/link";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { OrgAccessError } from "@/lib/authz";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/shared/pagination";
import { COPY } from "@/lib/reimbursement/copy";
import { gateReimbursementPage } from "@/lib/reimbursement/gate";
import { parseQueueQuery } from "@/lib/reimbursement/queue-query";
import { getCounts, getPayHolderCount, listTreasurerGroups, listTreasurerRequests } from "@/lib/reimbursement/reads";
import { ReimbursementLoadError, ReimbursementStatePage } from "../../reimbursements/reimbursement-states";
import { emptyMessage, exportHref, exportNotes, needsClampToFirstPage, queueHref, totalPages } from "./queue-model";
import { QueueFilters } from "./queue-filters";
import { QueueList } from "./queue-list";
import { QueueTabs } from "./queue-tabs";

/**
 * `/o/<slug>/admin/reimbursements` - the treasurer's queue (`reimbursement.view`).
 * docs/work-log/2026-10-25-treasury-inc1.md, Phase 3 "Component / Page Plan",
 * Copy C7, and the Batch 4 amendment (S7 filters and empty states; X5 to X7).
 *
 * Five tabs, a filter bar, the rows, the pager, `Export CSV`, and (for a
 * `reimbursement.manage` holder) the way to Settings and the Treasury team. The
 * query is parsed ONCE (`parseQueueQuery`, which drops anything invalid, X7) and
 * every link and the filter bar are built from that parsed query. A page past
 * the last returns no rows and a total of 0 (X6), so it is sent to page 1 of the
 * same filters instead of printing "page 2 of 0". The banner says plainly when no
 * one holds `pay`. A read that fails is a load error, never an empty queue (an
 * empty one would read as "nothing to pay").
 *
 * Read-only: opening this page writes nothing (EC24). No `loading.tsx`: this
 * segment's neighbours call `notFound()`, and a Suspense boundary would flush a
 * 200 first (CLAUDE.md).
 */
export default async function ReimbursementQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const raw = await searchParams;
  const path = `/o/${slug}/admin/reimbursements`;
  const gate = await gateReimbursementPage({ slug, path, anyOf: ["view"] });
  if (!gate.ok) {
    return (
      <ReimbursementStatePage
        state={gate.state}
        slug={slug}
        heading={COPY.queue.heading}
        retryHref={path}
        loadErrorMessage={COPY.queue.loadError}
      />
    );
  }
  const { identity } = gate;
  const query = parseQueueQuery(raw);

  let list: Awaited<ReturnType<typeof listTreasurerRequests>>;
  let groups: Awaited<ReturnType<typeof listTreasurerGroups>>;
  let counts: Awaited<ReturnType<typeof getCounts>>;
  let payHolders: number;
  try {
    [list, groups, counts, payHolders] = await Promise.all([
      listTreasurerRequests(identity, query),
      listTreasurerGroups(identity),
      getCounts(identity),
      getPayHolderCount(identity),
    ]);
  } catch (err) {
    if (err instanceof OrgAccessError) throw err;
    return <ReimbursementLoadError heading={COPY.queue.heading} message={COPY.queue.loadError} href={queueHref(slug, query)} />;
  }
  // `denied` after the gate passed means the database no longer sees the key: the honest "couldn't load".
  if (list.kind !== "ok" || groups.kind !== "ok" || counts.kind !== "ok") {
    return <ReimbursementLoadError heading={COPY.queue.heading} message={COPY.queue.loadError} href={queueHref(slug, query)} />;
  }

  // X6: a page past the last has no rows and a total of 0.
  if (needsClampToFirstPage(query, list.items.length)) redirect(queueHref(slug, query, { page: 1 }));

  const pages = totalPages(list.total);
  const { has } = identity;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{COPY.queue.heading}</h1>
          {has.manage && (
            <p className="mt-2 flex flex-wrap gap-x-4">
              <Link
                href={`${path}/settings`}
                className="inline-flex min-h-11 items-center text-sm underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {COPY.settings.heading}
              </Link>
              <Link
                href={`${path}/team`}
                className="inline-flex min-h-11 items-center text-sm underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {COPY.team.heading}
              </Link>
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:items-end">
          <Button asChild variant="outline" className="min-h-11">
            <a href={exportHref(slug, query)} download data-testid="export-csv">
              <Download className="size-4" aria-hidden />
              {COPY.queue.exportCsv}
            </a>
          </Button>
          {exportNotes(query).length > 0 && (
            <p className="text-sm text-muted-foreground sm:max-w-xs sm:text-right" data-testid="export-note">
              {exportNotes(query).join(" ")}
            </p>
          )}
        </div>
      </div>

      {payHolders === 0 && (
        <p role="status" className="rounded-lg border border-border bg-muted p-3 text-base" data-testid="no-pay-holder">
          {COPY.queue.noPayHolder}
        </p>
      )}

      <QueueTabs slug={slug} query={query} counts={counts.counts} />
      <QueueFilters slug={slug} query={query} groups={groups.groups} truncated={groups.truncated} rows={list.items} />

      {list.items.length === 0 ? (
        <p
          className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-base text-muted-foreground"
          data-testid="queue-empty"
        >
          {emptyMessage(query)}
        </p>
      ) : (
        <QueueList slug={slug} items={list.items} />
      )}

      <Pagination page={query.page} totalPages={pages} buildHref={(target) => queueHref(slug, query, { page: target })} />
    </div>
  );
}
