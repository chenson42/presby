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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormattedDate } from "@/components/shared/formatted-date";
import { useHydrated } from "@/components/shared/use-hydrated";
import { ROLL_ACTION_KIND_LABELS } from "@/lib/roll-action-kinds";
import type { PendingRollAction } from "@/lib/roll";
import { approveRollActionAction } from "./actions";
import { DECISION_SUCCESS_COPY } from "./decision-copy";
import { toastApproved } from "./decision-toasts";

/**
 * Per-row Approve: an AlertDialog with an optional minute reference. Trigger
 * disabled until hydration. A refusal (a typed `DECISION_COPY` string) leaves
 * the dialog open so the approver can read it and Deny instead.
 */
export function ApproveRollActionDialog({
  slug,
  action,
}: {
  slug: string;
  action: PendingRollAction;
}) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [minute, setMinute] = useState("");

  async function confirm() {
    setPending(true);
    try {
      const result = await approveRollActionAction(slug, {
        rollActionId: action.id,
        minuteReference: minute.trim() || undefined,
      });
      if (result.ok && result.data) {
        toastApproved(action.personDisplayName, result.data);
        setOpen(false);
        router.refresh();
      } else if (!result.ok) {
        toast.error(result.error);
      }
    } catch {
      toast.error(DECISION_SUCCESS_COPY.genericFailure);
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setMinute("");
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          className="min-h-11"
          disabled={!hydrated}
          aria-label={`Approve ${action.personDisplayName}`}
        >
          Approve
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Approve {action.personDisplayName}&apos;s roll action?
          </AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            This records {ROLL_ACTION_KIND_LABELS[action.kind].toLowerCase()} on
            the roll, effective{" "}
            <FormattedDate value={action.effectiveDate} mode="date" />.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div>
          <Label htmlFor={`minute-ref-${action.id}`}>
            Minute reference (optional)
          </Label>
          <Input
            id={`minute-ref-${action.id}`}
            value={minute}
            maxLength={200}
            autoComplete="off"
            onChange={(e) => setMinute(e.target.value)}
            className="mt-1 min-h-11"
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} className="min-h-11">
            Cancel
          </AlertDialogCancel>
          <Button
            type="button"
            className="min-h-11"
            disabled={pending}
            onClick={confirm}
          >
            {pending ? "Approving…" : "Approve"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
