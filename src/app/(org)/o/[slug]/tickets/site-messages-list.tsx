"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { SiteContactMessageEntry } from "@/lib/sites";
import { markSiteContactMessageReadAction } from "./actions";

/**
 * "Site messages" — the third section on `/o/<slug>/tickets`, ContactForm's
 * read side (DECISION-089). Same card shape as `FeedbackReviewList` (prose,
 * not tabular data), with a "mark read" control per `new` row mirroring
 * `FeedbackStatusControl`'s optimistic-update-with-revert shape.
 *
 * A CLIENT COMPONENT holding local state, not a Server Component list, so
 * "mark read" can optimistically remove the "New" badge without a full page
 * reload — the action itself still calls `revalidatePath`, so a hard
 * refresh always reflects the server's own truth regardless of this local
 * state.
 */
export function SiteMessagesList({
  messages,
  slug,
}: {
  messages: SiteContactMessageEntry[];
  slug: string;
}) {
  const [statuses, setStatuses] = useState<Record<string, "new" | "read">>(
    () => Object.fromEntries(messages.map((m) => [m.messageId, m.status])),
  );
  const [isPending, startTransition] = useTransition();

  if (messages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No site messages yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Messages visitors send through the public site&apos;s contact form
          show up here.
        </p>
      </div>
    );
  }

  function handleMarkRead(messageId: string) {
    const previous = statuses[messageId];
    setStatuses((prev) => ({ ...prev, [messageId]: "read" }));

    startTransition(async () => {
      const result = await markSiteContactMessageReadAction(slug, messageId);
      if (!result.ok) {
        setStatuses((prev) => ({ ...prev, [messageId]: previous ?? "new" }));
        toast.error(result.error);
      }
    });
  }

  return (
    <ul className="space-y-3">
      {messages.map((item) => {
        const status = statuses[item.messageId] ?? item.status;
        return (
          <li
            key={item.messageId}
            className="rounded-md border border-border p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{item.name}</p>
                <span className="text-xs text-muted-foreground">
                  {item.email}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {status === "new" && (
                  <Badge
                    variant="outline"
                    className="bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-200"
                  >
                    New
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  <FormattedDate value={item.createdAt} mode="datetime" />
                </span>
              </div>
            </div>
            <p className="mt-2 text-sm whitespace-pre-wrap">{item.body}</p>
            {status === "new" && (
              <div className="mt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11 sm:min-h-9"
                  disabled={isPending}
                  onClick={() => handleMarkRead(item.messageId)}
                >
                  Mark read
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
