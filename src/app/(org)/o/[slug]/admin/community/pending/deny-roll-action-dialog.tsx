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
import type { PendingRollAction } from "@/lib/roll";
import { denyRollActionAction } from "./actions";
import { DECISION_COPY, DECISION_SUCCESS_COPY } from "./decision-copy";

const REASON_MAX = 500;

/** Per-row Deny: a reason is required (1 to 500), and a denial is never
 * refused for the person's state, so a stale proposal can always be cleared. */
export function DenyRollActionDialog({
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
  const [reason, setReason] = useState("");

  async function confirm() {
    if (!reason.trim()) {
      toast.error(DECISION_COPY.reason_required);
      return;
    }
    setPending(true);
    try {
      const result = await denyRollActionAction(slug, {
        rollActionId: action.id,
        reason: reason.trim(),
      });
      if (result.ok) {
        toast.success(DECISION_SUCCESS_COPY.denied(action.personDisplayName));
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
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setReason("");
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={!hydrated}
          aria-label={`Deny ${action.personDisplayName}`}
        >
          Deny
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Deny {action.personDisplayName}&apos;s roll action?
          </AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            This roll action will not be recorded. A reason is required.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div>
          <Label htmlFor={`deny-reason-${action.id}`}>
            Reason (required, up to {REASON_MAX} characters)
          </Label>
          <Textarea
            id={`deny-reason-${action.id}`}
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
            Cancel
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            className="min-h-11"
            disabled={pending || reason.trim() === ""}
            onClick={confirm}
          >
            {pending ? "Denying…" : "Deny"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
