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
import { dismissFeedbackAction } from "./actions";

/**
 * Dismiss a piece of incoming feedback without promoting it. `AlertDialog`,
 * never `confirm()` (Workflow Rule 2) — mirrors
 * `admin/roles/revoke-dialog.tsx`'s split from its own list component.
 */
export function DismissFeedbackDialog({
  slug,
  feedbackId,
  submitterDisplayName,
}: {
  slug: string;
  feedbackId: string;
  submitterDisplayName: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    const result = await dismissFeedbackAction(slug, feedbackId);
    setPending(false);
    if (result.ok) {
      toast.success("Feedback dismissed.");
      // revalidatePath() alone does not re-render an already-mounted page —
      // see grant-role-form.tsx's identical comment, confirmed live there.
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9">
          Dismiss
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Dismiss feedback from {submitterDisplayName}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This removes it from the review queue without turning it into a
            ticket. It stays on record — it is not deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Dismissing…" : "Yes, dismiss"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
