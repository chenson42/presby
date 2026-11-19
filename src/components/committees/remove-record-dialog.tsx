"use client";

import { useState } from "react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { removeCommissionRecordAction } from "@/app/(org)/o/[slug]/admin/committees/commissions/[commissionId]/actions";
import { TOAST } from "@/lib/committees/copy";
import { COMMISSIONS, REMOVE_RECORD } from "@/lib/committees/ui-copy";

/**
 * "Remove this record" (C15), for a record entered by mistake: a plain confirmation
 * in an `AlertDialog`, no field. Removal is soft and one-way from this page; the body
 * says so and points at "End commission" for a commission that finished. On success
 * the page the person is on no longer exists, so it goes back to the list.
 */
export function RemoveRecordDialog({ slug, commissionId }: { slug: string; commissionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function onConfirm() {
    setPending(true);
    const result = await removeCommissionRecordAction(slug, { commissionId });
    setPending(false);
    if (result.ok) {
      toast.success(TOAST.recordRemoved);
      setOpen(false);
      router.push(`/o/${slug}/admin/committees`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11 w-full text-destructive sm:w-auto">
          {COMMISSIONS.removeRecord}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-h-[90dvh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{REMOVE_RECORD.title}</AlertDialogTitle>
          <AlertDialogDescription>{REMOVE_RECORD.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          <AlertDialogCancel className="min-h-11 w-full sm:w-auto">{REMOVE_RECORD.goBack}</AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm} className="min-h-11 w-full sm:w-auto">
            {pending ? "Removing…" : REMOVE_RECORD.confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
