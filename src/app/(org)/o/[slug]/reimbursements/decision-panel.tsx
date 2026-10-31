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
import { approveRequestAction } from "./actions";
import { failureNeedsReload } from "./decision-feedback";
import { SendBackDialog } from "./send-back-dialog";

/**
 * Approve and Send back - the two things an eligible approver can do, rendered
 * only when the request's `viewer.canDecide` says so. docs/work-log/
 * 2026-10-25-treasury-inc1.md, Phase 3 Copy C6.
 *
 * The render gate is a courtesy; the DEFINER re-derives the seat live on every
 * click, so a seat that ended while the page was open is refused (EC11). Both
 * actions carry the REVISION this page displayed (EC5): if the request was edited
 * and resent meanwhile, the answer is "This request changed after you opened it.
 * Review it again.", the dialog closes and the page re-reads.
 *
 * Approve is an `AlertDialog` (never a native confirm) that states the amount,
 * payee and group - the one place the amount is spelled out for the approver,
 * which email never carries. Send back is its own dialog (a radio and a
 * required reason) in `send-back-dialog.tsx`. The buttons are 44 px tall and
 * stack on a phone so neither can be pushed off-screen.
 */

export interface DecisionPanelProps {
  slug: string;
  requestId: string;
  /** The revision the page displayed. */
  revision: number;
  /** Already formatted, e.g. "$45.00". */
  amount: string;
  payee: string;
  group: string;
}

export function DecisionPanel({ slug, requestId, revision, amount, payee, group }: DecisionPanelProps) {
  const router = useRouter();
  const [approveOpen, setApproveOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function approve() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const result = await approveRequestAction(slug, { requestId, expectedRevision: revision });
      if (result.ok) {
        toast.success(result.data.message);
        setApproveOpen(false);
        router.refresh();
        return;
      }
      if (result.kind === "two_factor_required" && result.redirectTo) {
        router.push(result.redirectTo);
        return;
      }
      toast.error(result.error);
      if (failureNeedsReload(result)) {
        setApproveOpen(false);
        router.refresh();
      }
    } catch {
      toast.error(COPY.form.saveFailed);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row" data-testid="decision-panel">
      <Button type="button" className="min-h-11" onClick={() => setApproveOpen(true)} data-testid="approve-open">
        {COPY.decision.approveButton}
      </Button>
      <SendBackDialog slug={slug} requestId={requestId} revision={revision} />

      <AlertDialog open={approveOpen} onOpenChange={(open) => !pending && setApproveOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{COPY.decision.approveTitle}</AlertDialogTitle>
            <AlertDialogDescription className="[overflow-wrap:anywhere]">
              {COPY.decision.approveBody(amount, payee, group)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11" disabled={pending}>
              {COPY.decision.cancel}
            </AlertDialogCancel>
            <Button type="button" className="min-h-11" disabled={pending} onClick={approve} data-testid="approve-confirm">
              {COPY.decision.approveConfirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
