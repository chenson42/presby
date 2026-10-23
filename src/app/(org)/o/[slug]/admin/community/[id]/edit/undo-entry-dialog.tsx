"use client";

import { useState } from "react";
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
import { SUCCESS_COPY } from "../../participant-copy";
import { undoParticipantEntryAction } from "./actions";

const MAX_REASON = 500;

/**
 * "Undo last entry": records a void of the person's latest participant entry
 * (F175). A reason is REQUIRED (1 to 500 characters); it is stored in the audit
 * row, since `roll_actions` has no void-reason column. The dialog is controlled
 * (`open` / `onOpenChange` live in `ParticipantControls`) so the removal toast's
 * "Undo" button can open it. No `useForm`, so `check:hydration-gate` does not
 * apply; the trigger is disabled until hydration.
 */
export function UndoEntryDialog({
  slug,
  open,
  onOpenChange,
  rollActionId,
  entryLabel,
  showTrigger,
  onUndone,
}: {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rollActionId: string;
  /** "enrolment" or "removal": what is being undone, for the body copy. */
  entryLabel: "enrolment" | "removal";
  /** The in-page trigger; false when only the toast can open the dialog. */
  showTrigger: boolean;
  onUndone: () => void;
}) {
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState("");

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (next) setReason("");
  }

  async function confirm() {
    setPending(true);
    try {
      const result = await undoParticipantEntryAction(slug, {
        rollActionId,
        reason,
      });
      if (result.ok && result.data) {
        onOpenChange(false);
        toast.success(
          result.data.undoneKind === "other_participant_removed"
            ? SUCCESS_COPY.removalUndone
            : SUCCESS_COPY.enrolmentUndone,
        );
        if (result.data.affectsFiledPeriod) {
          toast.warning(SUCCESS_COPY.filedPeriodWarning);
        }
        onUndone();
      } else if (!result.ok) {
        toast.error(result.error);
      }
    } catch {
      toast.error("We couldn't undo that right now. Try again in a moment.");
    } finally {
      setPending(false);
    }
  }

  const trimmed = reason.trim();

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      {showTrigger && (
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full sm:w-auto"
            disabled={!hydrated}
          >
            Undo last entry
          </Button>
        </AlertDialogTrigger>
      )}
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Undo this entry?</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            This records a correction. The original {entryLabel} stays in the
            record, marked undone, and the person goes back to how they were
            before it.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div>
          <Label htmlFor="undo-entry-reason">
            Reason (required, up to {MAX_REASON} characters)
          </Label>
          <Textarea
            id="undo-entry-reason"
            value={reason}
            maxLength={MAX_REASON}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 min-h-24"
            aria-required="true"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} className="min-h-11">
            Keep it
          </AlertDialogCancel>
          <Button
            type="button"
            className="min-h-11"
            disabled={pending || trimmed === ""}
            onClick={confirm}
          >
            {pending ? "Undoing…" : "Undo entry"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
