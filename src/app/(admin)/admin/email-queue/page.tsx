import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { emailQueue } from "@/lib/db/schema";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { FormattedDate } from "@/components/shared/formatted-date";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RetryButton } from "./retry-button";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_STATUSES = new Set(["all", "queued", "processing", "sent", "failed"]);
const LIMIT = 50;

// Status colors are pre-existing palette literals retained at the call site
// (docs/TODO.md — semantic status tokens don't exist yet); the shape below is
// migrated onto <Badge variant="outline">.
const STATUS_BADGE: Record<string, string> = {
  queued:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-200",
  processing: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200",
  sent: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-200",
  failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

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
              <Badge
                key={s}
                variant="outline"
                className={STATUS_BADGE[s] ?? "bg-muted text-muted-foreground"}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)} {n}
              </Badge>
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
          <Button
            key={s}
            asChild
            variant={currentStatus === s ? "default" : "ghost"}
            size="sm"
          >
            <Link href={filterLink(s)}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
              {s !== "all" && countsByStatus[s] != null
                ? ` (${countsByStatus[s]})`
                : ""}
            </Link>
          </Button>
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Recipient</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Template</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Queued at</TableHead>
              <TableHead>Sent at</TableHead>
              <TableHead>Delivery</TableHead>
              <TableHead>Failure reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
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
                <TableRow key={row.id} className="align-top">
                  {/* Status badge */}
                  <TableCell>
                    <Badge variant="outline" className={statusClass}>
                      {row.status}
                    </Badge>
                  </TableCell>

                  {/* Recipient */}
                  <TableCell className="text-xs">{row.toEmail}</TableCell>

                  {/* Subject — may be long; constrain width */}
                  <TableCell className="max-w-[200px]">
                    <span className="block truncate text-xs" title={row.subject}>
                      {row.subject}
                    </span>
                  </TableCell>

                  {/* Template key */}
                  <TableCell className="text-xs font-mono">
                    {row.templateKey}
                  </TableCell>

                  {/* Attempts */}
                  <TableCell className="text-xs">
                    {row.attemptCount} / {row.maxAttempts}
                  </TableCell>

                  {/* Queued at (createdAt) */}
                  <TableCell className="text-xs text-muted-foreground">
                    <FormattedDate value={row.createdAt} mode="datetime" />
                  </TableCell>

                  {/* Sent at */}
                  <TableCell className="text-xs text-muted-foreground">
                    {row.sentAt ? (
                      <FormattedDate value={row.sentAt} mode="datetime" />
                    ) : (
                      "—"
                    )}
                  </TableCell>

                  {/* Delivery event badges */}
                  <TableCell>
                    {deliveryBadges.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {deliveryBadges.map((badge) => (
                          <Badge key={badge} variant="secondary">
                            {badge}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  {/* Failure reason + retry button */}
                  <TableCell>
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
                      {row.status === "failed" && <RetryButton id={row.id} />}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
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
