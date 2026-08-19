// SOC 2 / HIPAA fork note: viewing the audit log is not itself audited in the
// starter.  Environments requiring audit-of-audit-viewer access should add
// ADMIN_AUDIT_VIEWED to AUDIT_ACTIONS and call
//   recordAudit({ action: AUDIT_ACTIONS.ADMIN_AUDIT_VIEWED, ... })
// at the top of this page's data-loading block.  This is a one-function call;
// the schema already supports it.

import { redirect } from "next/navigation";
import { and, desc, eq, ilike, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { auditEvents } from "@/lib/db/schema";
import { AUDIT_ACTIONS } from "@/lib/audit";
import {
  validateAuditAction,
  clampPage,
  truncateActor,
} from "@/lib/audit-page-helpers";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { FormattedDate } from "@/components/shared/formatted-date";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ---------------------------------------------------------------------------
// Action select grouping — built dynamically from AUDIT_ACTIONS at render time.
// Groups match the action-value prefix (e.g. "user.*", "totp.*").
// ---------------------------------------------------------------------------

const ACTION_GROUPS: { label: string; prefix: string }[] = [
  { label: "Access", prefix: "access." },
  { label: "Email", prefix: "email." },
  { label: "Feature flags", prefix: "feature_flag." },
  { label: "Rate limiting", prefix: "rate_limit." },
  { label: "TOTP", prefix: "totp." },
  { label: "User", prefix: "user." },
];

const LIMIT = 50;

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; actor?: string; page?: string }>;
}) {
  // ---------------------------------------------------------------------------
  // Auth + feature gate (mirrors feedback page pattern)
  // ---------------------------------------------------------------------------

  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/admin/audit");

  if (!hasFeature(session.user.features, FEATURES.ADMIN_AUDIT)) {
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have permission to view this page.
      </p>
    );
  }

  // ---------------------------------------------------------------------------
  // Input guards — applied before any query construction
  //
  // 1. action   validated against the AUDIT_ACTIONS catalog (invalid → no-filter)
  // 2. page     clamped to a positive integer
  // 3. actor    truncated to 256 chars (leading-wildcard ilike; see note below)
  // ---------------------------------------------------------------------------

  const sp = await searchParams;
  const validAction = validateAuditAction(sp.action);
  const validActor = truncateActor(sp.actor);
  const page = clampPage(sp.page);
  const offset = (page - 1) * LIMIT;

  const hasFilters = !!(validAction || validActor);

  // ---------------------------------------------------------------------------
  // WHERE clause
  //
  // Fork-scaling note: the actorEmail ilike filter uses a sequential scan with
  // a leading wildcard — no B-tree index can accelerate it.  At starter scale
  // (<50 k rows) this is acceptable.  For high-volume audit tables, add a GIN
  // index:
  //   CREATE INDEX ON audit_events USING gin(actor_email gin_trgm_ops);
  // (requires the pg_trgm extension — see 2026-07-02-audit-log-viewer Phase 2
  // for details and the migration numbering note).
  // ---------------------------------------------------------------------------

  const conditions: SQL<unknown>[] = [];
  if (validAction) conditions.push(eq(auditEvents.action, validAction));
  if (validActor)
    conditions.push(ilike(auditEvents.actorEmail, `%${validActor}%`));

  const whereClause =
    conditions.length > 0 ? and(...conditions) : undefined;

  // ---------------------------------------------------------------------------
  // Parallel queries: paged rows + total count
  //
  // Both use the same WHERE clause so the count is always consistent with the
  // visible rows.  COUNT(*) on a filtered scan has no covering index when
  // actorEmail ilike is active — acceptable at starter scale (see note above).
  // ---------------------------------------------------------------------------

  const [rows, countResult] = await Promise.all([
    db
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        actorEmail: auditEvents.actorEmail,
        resourceType: auditEvents.resourceType,
        resourceId: auditEvents.resourceId,
        ip: auditEvents.ip,
        userAgent: auditEvents.userAgent,
        metadata: auditEvents.metadata,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .where(whereClause)
      .orderBy(desc(auditEvents.createdAt))
      .limit(LIMIT)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditEvents)
      .where(whereClause),
  ]);

  const totalCount = countResult[0]?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / LIMIT));

  // ---------------------------------------------------------------------------
  // Pagination URL builder — preserves active filters in every page link
  // ---------------------------------------------------------------------------

  function buildPageUrl(p: number): string {
    const params = new URLSearchParams();
    if (validAction) params.set("action", validAction);
    if (validActor) params.set("actor", validActor);
    params.set("page", String(p));
    return `/admin/audit?${params.toString()}`;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length > 0
            ? `Showing ${offset + 1}–${offset + rows.length} of ${totalCount}${hasFilters ? " matching" : ""} event${totalCount !== 1 ? "s" : ""}.`
            : totalCount > 0
              ? `No events on this page.`
              : hasFilters
                ? null
                : "No events recorded yet."}
        </p>
      </div>

      {/* Filter form — GET form; no JS required */}
      <form className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="action-select">Action</Label>
          <select
            id="action-select"
            name="action"
            defaultValue={validAction ?? ""}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All actions</option>
            {ACTION_GROUPS.map(({ label, prefix }) => {
              const options = Object.values(AUDIT_ACTIONS)
                .filter((v) => v.startsWith(prefix))
                .sort();
              if (options.length === 0) return null;
              return (
                <optgroup key={prefix} label={label}>
                  {options.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="actor-input">Actor email</Label>
          <Input
            id="actor-input"
            type="text"
            name="actor"
            placeholder="Search by email…"
            defaultValue={validActor ?? ""}
            maxLength={256}
            className="w-56"
          />
        </div>

        <Button type="submit" size="sm">
          Apply filters
        </Button>

        {hasFilters && (
          <a
            href="/admin/audit"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Clear filters
          </a>
        )}
      </form>

      {/* Empty states */}
      {rows.length === 0 && !hasFilters && (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm font-medium">No audit events yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Security-sensitive actions (sign-ins, role changes, 2FA) will
            appear here.
          </p>
        </div>
      )}

      {rows.length === 0 && hasFilters && (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm font-medium">No events match these filters</p>
          <a
            href="/admin/audit"
            className="mt-2 block text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Clear filters
          </a>
        </div>
      )}

      {/* Events table */}
      {rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Resource</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>User-agent</TableHead>
              <TableHead>Metadata</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const meta = row.metadata as Record<string, unknown> | null;
              const hasMetadata = meta != null && Object.keys(meta).length > 0;

              // Resource cell: "type/id", "type", "id", or "—"
              const resource =
                row.resourceType && row.resourceId
                  ? `${row.resourceType}/${row.resourceId}`
                  : (row.resourceType ?? row.resourceId ?? null);

              return (
                <TableRow key={row.id} className="align-top">
                  {/* Date */}
                  <TableCell className="text-xs text-muted-foreground">
                    <FormattedDate value={row.createdAt} mode="datetime" />
                  </TableCell>

                  {/* Action */}
                  <TableCell className="font-mono text-xs">
                    {row.action}
                  </TableCell>

                  {/* Actor email — null for system events */}
                  <TableCell className="text-xs">
                    {row.actorEmail ?? "—"}
                  </TableCell>

                  {/* Resource type / id — either or both may be null */}
                  <TableCell className="text-xs">{resource ?? "—"}</TableCell>

                  {/* IP — null for seed/cron writes */}
                  <TableCell className="text-xs">{row.ip ?? "—"}</TableCell>

                  {/* User-agent — truncated in cell; full value on hover */}
                  <TableCell>
                    {row.userAgent ? (
                      <span
                        className="block max-w-[200px] truncate text-xs"
                        title={row.userAgent}
                      >
                        {row.userAgent}
                      </span>
                    ) : (
                      <span className="text-xs">—</span>
                    )}
                  </TableCell>

                  {/* Metadata — suppressed when empty ({}) */}
                  <TableCell>
                    {hasMetadata ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                          View metadata
                        </summary>
                        <pre className="mt-1 overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
                          {JSON.stringify(meta, null, 2)}
                        </pre>
                      </details>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-4 text-sm">
          {page > 1 ? (
            <a
              href={buildPageUrl(page - 1)}
              className="text-muted-foreground underline-offset-4 hover:underline"
            >
              ← Previous
            </a>
          ) : (
            <span className="text-muted-foreground/40">← Previous</span>
          )}

          <span className="text-muted-foreground">
            Page {page} of {totalPages}
          </span>

          {offset + rows.length < totalCount ? (
            <a
              href={buildPageUrl(page + 1)}
              className="text-muted-foreground underline-offset-4 hover:underline"
            >
              Next →
            </a>
          ) : (
            <span className="text-muted-foreground/40">Next →</span>
          )}
        </div>
      )}
    </div>
  );
}
