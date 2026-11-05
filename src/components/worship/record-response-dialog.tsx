"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { recordResponseAction } from "@/app/(org)/o/[slug]/worship/actions";
import { ACTION_COPY, BOARD_COPY, MEMBER_COPY, NAV_COPY } from "@/lib/worship/copy";
import { REASONS, type Answer, type Reason } from "@/lib/worship/vocab";
import { Field, FormError, SELECT_CLASSES, SelectBox } from "./form-bits";

/**
 * "Record {name}'s answer" (Copy G5): a leader enters what someone told them -
 * the way a person with no sign-in, or a child whose parent answered, gets an
 * answer onto the schedule. Saved attributed to the recorder ("Recorded by ...").
 * Accepted or Declined, and for Declined an optional closed-list reason.
 */
export function RecordResponseDialog({
  slug,
  assignmentId,
  personName,
}: {
  slug: string;
  assignmentId: string;
  personName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<Answer>("accepted");
  const [reason, setReason] = useState<Reason | "">("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await recordResponseAction(slug, {
        assignmentId,
        answer,
        reason: answer === "declined" && reason ? reason : null,
      });
      if (result.ok) {
        toast.success(BOARD_COPY.record.toast);
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch {
      setError(ACTION_COPY.generic);
    } finally {
      setPending(false);
    }
  }

  const choices: Array<{ value: Answer; label: string }> = [
    { value: "accepted", label: BOARD_COPY.record.accepted },
    { value: "declined", label: BOARD_COPY.record.declined },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11" data-testid={`record-${assignmentId}`}>
          {BOARD_COPY.record.submit}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">{BOARD_COPY.record.title(personName)}</DialogTitle>
          <DialogDescription>{BOARD_COPY.record.helper}</DialogDescription>
        </DialogHeader>
        <HydrationGate>
          <form onSubmit={onSubmit} className="space-y-4">
            <fieldset className="space-y-1">
              <div className="flex flex-col gap-1">
                {choices.map((choice) => (
                  <label key={choice.value} className="flex min-h-11 items-center gap-3 text-base">
                    <input
                      type="radio"
                      name={`answer-${assignmentId}`}
                      className="size-5 accent-primary"
                      checked={answer === choice.value}
                      onChange={() => setAnswer(choice.value)}
                    />
                    {choice.label}
                  </label>
                ))}
              </div>
            </fieldset>
            {answer === "declined" && (
              <Field id={`record-reason-${assignmentId}`} label={BOARD_COPY.record.reasonLabel}>
                <SelectBox>
                  <select
                    id={`record-reason-${assignmentId}`}
                    className={SELECT_CLASSES}
                    value={reason}
                    onChange={(e) => setReason(e.target.value as Reason | "")}
                  >
                    <option value=""></option>
                    {REASONS.map((value) => (
                      <option key={value} value={value}>
                        {MEMBER_COPY.request.reasonOptions[value]}
                      </option>
                    ))}
                  </select>
                </SelectBox>
              </Field>
            )}
            <FormError message={error} />
            <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={pending}>
              {pending ? NAV_COPY.saving : BOARD_COPY.record.submit}
            </Button>
          </form>
        </HydrationGate>
      </DialogContent>
    </Dialog>
  );
}
