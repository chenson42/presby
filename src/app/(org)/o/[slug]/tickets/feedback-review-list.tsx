import Link from "next/link";
import { Button } from "@/components/ui/button";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { FeedbackListEntry } from "@/lib/tickets";
import { DismissFeedbackDialog } from "./dismiss-feedback-dialog";

/**
 * "Incoming feedback" — Flow 0's review queue. Server-rendered rows + a
 * small `'use client'` dismiss dialog, mirroring `admin/roles/roles-list.tsx`
 * + `revoke-dialog.tsx`'s split. Cards, not a table — this is prose (a
 * member's free-text report), not tabular data, same reasoning
 * `directory/directory-list.tsx` gives for its own card choice.
 */
export function FeedbackReviewList({
  feedback,
  slug,
}: {
  feedback: FeedbackListEntry[];
  slug: string;
}) {
  if (feedback.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No incoming feedback right now</p>
        <p className="mt-1 text-sm text-muted-foreground">
          What members share about their experience here shows up in this
          queue, waiting to be promoted or dismissed.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {feedback.map((item) => (
        <li key={item.feedbackId} className="rounded-md border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">{item.submitterDisplayName}</p>
            <span className="text-xs text-muted-foreground">
              <FormattedDate value={item.createdAt} mode="datetime" />
            </span>
          </div>
          <p className="mt-2 text-sm whitespace-pre-wrap">{item.body}</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button asChild size="sm" className="min-h-11 sm:min-h-9">
              <Link href={`/o/${slug}/tickets/new?fromFeedback=${item.feedbackId}`}>
                Promote to ticket
              </Link>
            </Button>
            <DismissFeedbackDialog
              slug={slug}
              feedbackId={item.feedbackId}
              submitterDisplayName={item.submitterDisplayName}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
