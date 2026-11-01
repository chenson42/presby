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
import { HELP_CONTACT_INBOX_COPY as COPY } from "@/lib/help-contact/copy";
import { clearContactMessageDetails } from "./actions";

/**
 * "Clear details": an `AlertDialog`, never `confirm()` (Workflow Rule 2). The
 * clear is irreversible (the database guard refuses an un-clear), so the dialog
 * says so in the words Phase 3 drafted and the confirm button is the
 * destructive variant. The caller renders this only when the message is not
 * `new` and not already cleared.
 */
export function ClearDetailsDialog({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    try {
      const result = await clearContactMessageDetails(id);
      if (result.ok) {
        toast.success(COPY.clearToast);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error(COPY.clearFailure);
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto">
          {COPY.clearButton}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{COPY.dialogTitle}</AlertDialogTitle>
          <AlertDialogDescription>{COPY.dialogBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11">{COPY.dialogCancel}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void confirm()}
            disabled={pending}
            className="min-h-11"
          >
            {COPY.dialogConfirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
