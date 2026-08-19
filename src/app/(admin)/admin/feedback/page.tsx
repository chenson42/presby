import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { feedback, users } from "@/lib/db/schema";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { FormattedDate } from "@/components/shared/formatted-date";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FeedbackStatusControl } from "./feedback-status-control";

// XSS INVARIANT: All member-supplied content (body, contextPath, memberName)
// is rendered as plain JSX text nodes. No dangerouslySetInnerHTML, no markdown.
// This is a hard constraint — never render feedback content as HTML.

const CATEGORY_BADGE: Record<
  string,
  { label: string; className: string }
> = {
  suggestion: {
    label: "Suggestion",
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200",
  },
  bug: {
    label: "Bug",
    className:
      "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-200",
  },
  other: {
    label: "Other",
    className: "bg-muted text-muted-foreground",
  },
};

const STATUS_BADGE: Record<string, string> = {
  new: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-200",
  triaged: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200",
  done: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-200",
  declined:
    "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  triaged: "Triaged",
  done: "Delivered",
  declined: "Declined",
};

function excerpt(body: string, max = 120): string {
  return body.length > max ? body.slice(0, max) + "…" : body;
}

export default async function AdminFeedbackPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin?callbackUrl=/admin/feedback");

  // Independent feature check — the admin layout gate covers session but not
  // per-page features. Every admin subpage checks independently (Phase 2 Ruling 5).
  if (!hasFeature(session.user.features, FEATURES.ADMIN_FEEDBACK)) {
    return (
      <p className="text-sm text-muted-foreground">
        You don&apos;t have permission to view this page.
      </p>
    );
  }

  const rows = await db
    .select({
      id: feedback.id,
      category: feedback.category,
      body: feedback.body,
      contextPath: feedback.contextPath,
      appVersion: feedback.appVersion,
      status: feedback.status,
      createdAt: feedback.createdAt,
      // PII CONSTRAINT: query display name only; NOT email.
      // Email is in the admin notification email (trusted inbox) but NOT here.
      memberName: users.name,
    })
    .from(feedback)
    .leftJoin(users, eq(feedback.userId, users.id))
    .orderBy(desc(feedback.createdAt));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Member feedback</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} submission{rows.length !== 1 ? "s" : ""} — newest
          first. Triage by changing status.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-16 text-center">
          <p className="text-sm font-medium">No feedback yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Submissions from members appear here once the feedback form is
            used.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Submitted</TableHead>
              <TableHead>Member</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const badge = row.category ? CATEGORY_BADGE[row.category] : null;
              const statusClass =
                STATUS_BADGE[row.status] ?? "bg-muted text-muted-foreground";

              return (
                <TableRow key={row.id} className="align-top">
                  <TableCell className="text-xs text-muted-foreground">
                    <FormattedDate value={row.createdAt} mode="datetime" />
                  </TableCell>

                  <TableCell className="text-xs">
                    {/* Plain text — XSS-safe */}
                    {row.memberName ?? "Unknown member"}
                  </TableCell>

                  <TableCell>
                    {badge ? (
                      <Badge variant="outline" className={badge.className}>
                        {badge.label}
                      </Badge>
                    ) : null}
                  </TableCell>

                  <TableCell className="max-w-sm whitespace-normal">
                    {/* Excerpt — plain text node (XSS-safe) */}
                    <p className="text-sm">{excerpt(row.body)}</p>

                    {row.body.length > 120 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                          Show full message
                        </summary>
                        {/* Plain text — no dangerouslySetInnerHTML, no markdown */}
                        <p className="mt-2 text-sm whitespace-pre-wrap">
                          {row.body}
                        </p>
                      </details>
                    )}

                    {/* Bug context — shown only when category === 'bug' */}
                    {row.category === "bug" &&
                      (row.contextPath || row.appVersion) && (
                        <div className="mt-1 rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                          {row.contextPath && <div>Page: {row.contextPath}</div>}
                          {row.appVersion && <div>Version: {row.appVersion}</div>}
                        </div>
                      )}
                  </TableCell>

                  <TableCell>
                    {/* Initial status badge for terminal/reference */}
                    <div className="flex flex-col gap-1.5">
                      <Badge variant="outline" className={statusClass}>
                        {STATUS_LABELS[row.status] ?? row.status}
                      </Badge>
                      {/* Status control island — handles optimistic update + revert */}
                      <FeedbackStatusControl
                        feedbackId={row.id}
                        currentStatus={row.status}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
