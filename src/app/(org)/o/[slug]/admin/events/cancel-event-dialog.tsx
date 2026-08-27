"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cancelEventAction } from "./actions";

/**
 * Cancels ONE occurrence — NEVER a delete (DECISION-113, `events.ts`'s own
 * no-delete discipline: `cancelled_at`, the row stays on record).
 * `AlertDialog`, never `confirm()` (Workflow Rule 2), same shape
 * `end-group-membership-dialog.tsx` establishes: names the event in the
 * confirmation copy, never a generic "Are you sure?".
 *
 * CANCELLING A SERIES PARENT DOES NOT CASCADE-CANCEL ITS CHILDREN — an
 * explicit v1 non-goal (Phase 3's Edge Cases) — this dialog's copy says so
 * when `isSeriesParent` is true, so an admin cancelling a recurring
 * meeting's first row isn't surprised the rest of the series is still live.
 */
export function CancelEventDialog({
  slug,
  eventId,
  eventTitle,
  isSeriesParent,
}: {
  slug: string;
  eventId: string;
  eventTitle: string;
  isSeriesParent: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    const result = await cancelEventAction(slug, eventId);
    setPending(false);
    if (result.ok) {
      toast.success(`${eventTitle} was cancelled.`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="min-h-11">
          Cancel event
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel {eventTitle}?</AlertDialogTitle>
          <AlertDialogDescription>
            This marks the event as cancelled — it stays on record, it is not
            deleted.
            {isSeriesParent &&
              " Other occurrences in this series are NOT cancelled and stay on the calendar."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>Keep event</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleConfirm} disabled={pending}>
            {pending ? "Cancelling…" : "Yes, cancel event"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
