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
import { COPY } from "@/lib/reimbursement/copy";
import { withdrawRequestAction } from "./actions";

/**
 * "Withdraw this request?" - the requester (or the person being paid, when they
 * have an account) closes their own request. docs/work-log/2026-10-25-treasury-
 * inc1.md, Copy C6 and the Batch 2a amendment T3: there is NO reason field in
 * Increment 1, so this posts `{ requestId }` only and the action's optional
 * `reason` is never sent. Success toasts `Request withdrawn.` (a status claim;
 * nothing is deleted) and re-reads the page, which then shows the withdrawn
 * banner. A request that was already paid says so in Copy's words and is not
 * withdrawn; any other refusal is the neutral "This request isn't available."
 *
 * An `AlertDialog`, never a native confirm. Offered only when the request's
 * `viewer.canWithdraw` says so; the definer decides again.
 */
export function WithdrawDialog({ slug, requestId }: { slug: string; requestId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function withdraw() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const result = await withdrawRequestAction(slug, { requestId });
      if (result.ok) {
        toast.success(COPY.decision.withdrawn);
        setOpen(false);
        router.refresh();
        return;
      }
      if (result.kind === "two_factor_required" && result.redirectTo) {
        router.push(result.redirectTo);
        return;
      }
      toast.error(result.error);
      setOpen(false);
      router.refresh();
    } catch {
      toast.error(COPY.form.saveFailed);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(true)} data-testid="withdraw-open">
        {COPY.detail.buttons.withdraw}
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{COPY.decision.withdrawTitle}</AlertDialogTitle>
            <AlertDialogDescription>{COPY.decision.withdrawBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={pending}>
              {COPY.decision.withdrawKeep}
            </AlertDialogCancel>
            <Button type="button" className="min-h-11" disabled={pending} onClick={withdraw} data-testid="withdraw-confirm">
              {COPY.decision.withdrawConfirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
