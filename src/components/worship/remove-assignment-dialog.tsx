"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { removeAssignmentAction } from "@/app/(org)/o/[slug]/worship/actions";
import { ACTION_COPY, BOARD_COPY } from "@/lib/worship/copy";

/**
 * "Remove {name} from {Position}?" (Copy G5) - an AlertDialog, never a native
 * confirm. The body depends on whether the person was ever asked: a draft says they
 * haven't been; a sent request says they are NOT told (F430), so the leader must.
 */
export function RemoveAssignmentDialog({
  slug,
  assignmentId,
  personName,
  positionName,
  wasSent,
}: {
  slug: string;
  assignmentId: string;
  personName: string;
  positionName: string;
  wasSent: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function remove() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const result = await removeAssignmentAction(slug, { assignmentId });
      if (result.ok) {
        toast.success(BOARD_COPY.removeDialog.toast);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
        setOpen(false);
        router.refresh();
      }
    } catch {
      toast.error(ACTION_COPY.generic);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(true)} data-testid={`remove-${assignmentId}`}>
        {BOARD_COPY.removeDialog.confirm}
        <span className="sr-only"> {personName}</span>
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="[overflow-wrap:anywhere]">{BOARD_COPY.removeDialog.title(personName, positionName)}</AlertDialogTitle>
            <AlertDialogDescription>
              {wasSent ? BOARD_COPY.removeDialog.bodySent : BOARD_COPY.removeDialog.bodyDraft}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={pending}>
              {BOARD_COPY.removeDialog.cancel}
            </AlertDialogCancel>
            <Button type="button" className="min-h-11" disabled={pending} onClick={remove} data-testid="remove-confirm">
              {BOARD_COPY.removeDialog.confirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
