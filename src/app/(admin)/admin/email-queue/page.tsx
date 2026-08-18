import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { emailQueue } from "@/lib/db/schema";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { FormattedDate } from "@/components/shared/formatted-date";
import { RetryButton } from "./retry-button";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_STATUSES = new Set(["all", "queued", "processing", "sent", "failed"]);
const LIMIT = 50;

const STATUS_BADGE: Record<string, string> = {
  queued:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-200",
  processing: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200",
  sent: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-200",
  failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

const DELIVERY_BADGE =
  "inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AdminEmailQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  // Auth + feature gate (mirrors audit / feedback page pattern).
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/admin/email-queue");

  if (!hasFeature(session.user.features, FEATURES.ADMIN_EMAIL_QUEUE)) {
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have permission to view this page.
      </p>
    );
  }

  const sp = await searchParams;
  const currentStatus =
    sp.status && VALID_STATUSES.has(sp.status) ? sp.status : "all";

  // ---------------------------------------------------------------------------
  // Parallel queries: count strip + table rows
  // ---------------------------------------------------------------------------

  const [countRows, rows] = await Promise.all([
    // Count summary: one row per status that has at least one record.
    db
      .select({
        status: emailQueue.status,
        count: sql<number>`count(*)::int`,
      })
      .from(emailQueue)
      .groupBy(emailQueue.status),

    // Table rows: filtered + newest-first, capped at LIMIT.
    db
      .select({
        id: emailQueue.id,
        toEmail: emailQueue.toEmail,
        subject: emailQueue.subject,
        templateKey: emailQueue.templateKey,
        status: emailQueue.status,
        attemptCount: emailQueue.attemptCount,
        maxAttempts: emailQueue.maxAttempts,
        nextAttemptAt: emailQueue.nextAttemptAt,
        lastAttemptAt: emailQueue.lastAttemptAt,
        sentAt: emailQueue.sentAt,
        providerMessageId: emailQueue.providerMessageId,
        failureReason: emailQueue.failureReason,
        deliveredAt: emailQueue.deliveredAt,
        openedAt: emailQueue.openedAt,
        clickedAt: emailQueue.clickedAt,
        bouncedAt: emailQueue.bouncedAt,
        complainedAt: emailQueue.complainedAt,
        createdAt: emailQueue.createdAt,
      })
      .from(emailQueue)
      .where(
        currentStatus !== "all" ? eq(emailQueue.status, currentStatus) : undefined,
      )
      .orderBy(desc(emailQueue.createdAt))
      .limit(LIMIT),
  ]);

  // Build a count lookup keyed by status name.
  const countsByStatus = countRows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = r.count;
    return acc;
  }, {});
  const totalCount = Object.values(countsByStatus).reduce((a, b) => a + b, 0);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function filterLink(status: string) {
    return status === "all" ? "/admin/email-queue" : `/admin/email-queue?status=${status}`;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold">Email queue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {totalCount === 0
            ? "No emails in the queue yet. Emails sent by the app appear here automatically."
            : `Showing up to ${LIMIT} rows${currentStatus !== "all" ? ` with status "${currentStatus}"` : ""} — newest first.`}
        </p>
      </div>

      {/* Count summary strip */}
      {totalCount > 0 && (
        <div className="flex flex-wrap gap-2">
          {(["queued", "processing", "sent", "failed"] as const).map((s) => {
            const n = countsByStatus[s] ?? 0;
            if (n === 0) return null;
            return (
              <span
                key={s}
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[s] ?? "bg-muted text-muted-foreground"}`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)} {n}
              </span>
            );
          })}
        </div>
      )}

      {/* Processing rows note */}
      {(countsByStatus["processing"] ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground">
          Processing rows are mid-flight — they return to queued automatically
          if stuck for more than 10 minutes. Retry-now is not available for
          them.
        </p>
      )}

      {/* Status filter tabs */}
      <div className="flex flex-wrap gap-2 border-b border-border pb-3">
        {["all", "queued", "processing", "sent", "failed"].map((s) => (
          <Link
            key={s}
            href={filterLink(s)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              currentStatus === s
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
            {s !== "all" && countsByStatus[s] != null
              ? ` (${countsByStatus[s]})`
              : ""}
          </Link>
        ))}
      </div>

      {/* Empty states */}
      {rows.length === 0 && currentStatus === "all" && totalCount === 0 && (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm font-medium">No emails in the queue yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Emails sent by the app appear here automatically.
          </p>
        </div>
      )}

      {rows.length === 0 && currentStatus !== "all" && (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm font-medium">No emails match this filter.</p>
          <Link
            href="/admin/email-queue"
            className="mt-2 block text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Clear filter
          </Link>
        </div>
      )}

      {/* Queue table */}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-4 font-medium whitespace-nowrap">
                  Status
                </th>
                <th className="pb-2 pr-4 font-medium whitespace-nowrap">
                  Recipient
                </th>
                <th className="pb-2 pr-4 font-medium">Subject</th>
                <th className="pb-2 pr-4 font-medium whitespace-nowrap">
                  Template
                </th>
                <th className="pb-2 pr-4 font-medium whitespace-nowrap">
                  Attempts
                </th>
                <th className="pb-2 pr-4 font-medium whitespace-nowrap">
                  Queued at
                </th>
                <th className="pb-2 pr-4 font-medium whitespace-nowrap">
                  Sent at
                </th>
                <th className="pb-2 pr-4 font-medium whitespace-nowrap">
                  Delivery
                </th>
                <th className="pb-2 font-medium">Failure reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => {
                const statusClass =
                  STATUS_BADGE[row.status] ?? "bg-muted text-muted-foreground";

                const deliveryBadges: string[] = [];
                if (row.deliveredAt) deliveryBadges.push("delivered");
                if (row.openedAt) deliveryBadges.push("opened");
                if (row.clickedAt) deliveryBadges.push("clicked");
                if (row.bouncedAt) deliveryBadges.push("bounced");
                if (row.complainedAt) deliveryBadges.push("complained");

                return (
                  <tr key={row.id} className="align-top">
                    {/* Status badge */}
                    <td className="py-3 pr-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}
                      >
                        {row.status}
                      </span>
                    </td>

                    {/* Recipient */}
                    <td className="py-3 pr-4 text-xs whitespace-nowrap">
                      {row.toEmail}
                    </td>

                    {/* Subject — may be long; constrain width */}
                    <td className="py-3 pr-4 max-w-[200px]">
                      <span
                        className="block truncate text-xs"
                        title={row.subject}
                      >
                        {row.subject}
                      </span>
                    </td>

                    {/* Template key */}
                    <td className="py-3 pr-4 text-xs font-mono whitespace-nowrap">
                      {row.templateKey}
                    </td>

                    {/* Attempts */}
                    <td className="py-3 pr-4 text-xs whitespace-nowrap">
                      {row.attemptCount} / {row.maxAttempts}
                    </td>

                    {/* Queued at (createdAt) */}
                    <td className="py-3 pr-4 text-xs text-muted-foreground whitespace-nowrap">
                      <FormattedDate value={row.createdAt} mode="datetime" />
                    </td>

                    {/* Sent at */}
                    <td className="py-3 pr-4 text-xs text-muted-foreground whitespace-nowrap">
                      {row.sentAt ? (
                        <FormattedDate value={row.sentAt} mode="datetime" />
                      ) : (
                        "—"
                      )}
                    </td>

                    {/* Delivery event badges */}
                    <td className="py-3 pr-4">
                      {deliveryBadges.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {deliveryBadges.map((badge) => (
                            <span key={badge} className={DELIVERY_BADGE}>
                              {badge}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Failure reason + retry button */}
                    <td className="py-3">
                      <div className="flex flex-col gap-1.5">
                        {row.failureReason ? (
                          <span
                            className="block max-w-[200px] truncate text-xs text-muted-foreground"
                            title={row.failureReason}
                          >
                            {row.failureReason}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        {row.status === "failed" && (
                          <RetryButton id={row.id} />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length === LIMIT && (
        <p className="text-xs text-muted-foreground">
          Showing the {LIMIT} most recent rows. Use the status filter to narrow
          results.
        </p>
      )}
    </div>
  );
}
