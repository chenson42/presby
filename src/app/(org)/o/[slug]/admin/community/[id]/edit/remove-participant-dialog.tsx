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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHydrated } from "@/components/shared/use-hydrated";
import { SUCCESS_COPY } from "../../participant-copy";
import { removeParticipantAction } from "./actions";

/** Browser-local today as 'YYYY-MM-DD' (the date input's default and `max`;
 * the server bounds by the database's own date regardless). Only evaluated
 * when the dialog is opened, never during SSR. */
function localToday(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * "Remove as participant": an AlertDialog (Rule 2), controlled state, no
 * `useForm`, so `check:hydration-gate` does not apply; the trigger is disabled
 * until hydration (the `domains/remove-dialog.tsx` precedent), which is what
 * stops a pre-hydration click. The removal takes effect on record, ends the
 * person's connection and is undoable (DECISION-198), and the dialog says so.
 * The action button is a plain Button, not `AlertDialogAction`, so a refusal
 * leaves the dialog open with the reason in a toast.
 */
export function RemoveParticipantDialog({
  slug,
  personId,
  personName,
  orgName,
  onRemoved,
}: {
  slug: string;
  personId: string;
  personName: string;
  orgName: string;
  /** Called with the new roll action id so the Undo toast can target it. */
  onRemoved: (rollActionId: string) => void;
}) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [date, setDate] = useState("");
  const [minute, setMinute] = useState("");

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setDate(localToday());
      setMinute("");
    }
  }

  async function confirm() {
    setPending(true);
    try {
      const result = await removeParticipantAction(slug, {
        personId,
        effectiveDate: date,
        minuteReference: minute || undefined,
      });
      if (result.ok && result.data) {
        setOpen(false);
        onRemoved(result.data.rollActionId);
        if (result.data.affectsFiledPeriod) {
          toast.warning(SUCCESS_COPY.filedPeriodWarning);
        }
      } else if (!result.ok) {
        toast.error(result.error);
      }
    } catch {
      toast.error("We couldn't remove them right now. Try again in a moment.");
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
          className="min-h-11 w-full sm:w-auto"
          disabled={!hydrated}
        >
          Remove as participant
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove as participant?</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            This ends {personName}&apos;s connection to {orgName} from the date
            you choose. They leave the Directory and lose access if they have an
            account. You can undo it afterward.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="remove-participant-date">Effective date</Label>
            <Input
              id="remove-participant-date"
              type="date"
              value={date}
              max={localToday()}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 min-h-11"
            />
          </div>
          <div>
            <Label htmlFor="remove-participant-minute">
              Minute reference (optional)
            </Label>
            <Input
              id="remove-participant-minute"
              value={minute}
              maxLength={200}
              autoComplete="off"
              onChange={(e) => setMinute(e.target.value)}
              className="mt-1 min-h-11"
            />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} className="min-h-11">
            Keep
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            className="min-h-11"
            disabled={pending || date === ""}
            onClick={confirm}
          >
            {pending ? "Removing…" : "Remove"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
