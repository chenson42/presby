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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useHydrated } from "@/components/shared/use-hydrated";
import { withdrawRollActionAction } from "./pending/actions";
import { DECISION_SUCCESS_COPY } from "./pending/decision-copy";

const REASON_MAX = 500;

/**
 * "Withdraw proposal": shared by the pending queue and the person's edit page
 * (Increment 2, F183). An AlertDialog (Rule 2), controlled state, no `useForm`,
 * so `check:hydration-gate` does not apply; the trigger is disabled until
 * hydration (DECISION-159), and `e2e/hydration/community-approval-controls`
 * proves it. The action button is a plain Button, not `AlertDialogAction`, so a
 * refusal leaves the dialog open with the reason in a toast. A reason is
 * required (1 to 500 characters), mirrored from the database.
 */
export function WithdrawProposalDialog({
  slug,
  rollActionId,
  personName,
  triggerClassName,
}: {
  slug: string;
  rollActionId: string;
  personName: string;
  triggerClassName?: string;
}) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState("");
  const fieldId = `withdraw-reason-${rollActionId}`;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) setReason("");
  }

  async function confirm() {
    if (!reason.trim()) {
      toast.error("Say why you're withdrawing this.");
      return;
    }
    setPending(true);
    try {
      const result = await withdrawRollActionAction(slug, {
        rollActionId,
        reason: reason.trim(),
      });
      if (result.ok) {
        toast.success(DECISION_SUCCESS_COPY.withdrawn(personName));
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error(DECISION_SUCCESS_COPY.genericFailure);
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={triggerClassName ?? "min-h-11"}
          disabled={!hydrated}
          aria-label={`Withdraw proposal for ${personName}`}
        >
          Withdraw
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Withdraw this proposal?</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            This takes {personName} out of the Session&apos;s queue. The
            proposal stays in the record, marked withdrawn, and you can propose
            again afterward.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div>
          <Label htmlFor={fieldId}>
            Reason (required, up to {REASON_MAX} characters)
          </Label>
          <Textarea
            id={fieldId}
            value={reason}
            maxLength={REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 min-h-24"
          />
          <p className="mt-1 text-right text-xs text-muted-foreground">
            {reason.length} / {REASON_MAX}
          </p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} className="min-h-11">
            Keep it
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            className="min-h-11"
            disabled={pending || reason.trim() === ""}
            onClick={confirm}
          >
            {pending ? "Withdrawing…" : "Withdraw"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
