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
import { endCommitteeSeatAction } from "@/app/(org)/o/[slug]/admin/committees/[committeeId]/actions";
import { endCommissionMemberAction } from "@/app/(org)/o/[slug]/admin/committees/commissions/[commissionId]/actions";
import { END_TERM_CARRIES, TOAST } from "@/lib/committees/copy";
import { parseEndSeat } from "@/lib/committees/validate";
import { COMMISSION_MEMBER, END } from "@/lib/committees/ui-copy";

export type EndMode = "end" | "change" | "cancel";

/**
 * The end control on a roster row: "End term" (a serving seat without a planned
 * end), "Change end date" (one with a planned end) or "Cancel planned term" (a seat
 * that has not started; no date field, the term is ended at its own start). An
 * `AlertDialog`, never `confirm()`, holding a plain controlled date input (no
 * `useForm`: it opens only after the page has hydrated). The pure `parseEndSeat` is
 * the same check the action runs; a refusal keeps the dialog open and shows under
 * the field.
 */
export function EndTermDialog({
  slug,
  committeeId,
  commissionId,
  membershipId,
  personName,
  mode,
  startsOn,
  currentEndsOn,
  today,
  carries,
  idPrefix,
}: {
  slug: string;
  /** The committee's id. Ignored (pass any value) when `commissionId` is set. */
  committeeId: string;
  /** Set on a commission's roster: the same dialog ends a MEMBER TERM of that record (C15), worded for a commission. */
  commissionId?: string;
  membershipId: string;
  personName: string;
  mode: EndMode;
  startsOn: string;
  currentEndsOn: string | null;
  today: string;
  /** The committee carries a role: the body says ending the term ends that access. */
  carries: boolean;
  /** Keeps ids unique when the roster is rendered twice (cards and table). */
  idPrefix: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [endsOn, setEndsOn] = useState(currentEndsOn ?? today);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const triggerLabel = mode === "end" ? "End term" : mode === "change" ? "Change end date" : "Cancel planned term";
  const commission = commissionId !== undefined;
  const title = mode === "end" ? (commission ? COMMISSION_MEMBER.endTitle(personName) : END.titleEnd(personName)) : mode === "change" ? END.titleChange(personName) : END.titleCancel(personName);
  const confirm = mode === "end" ? END.confirmEnd : mode === "change" ? END.confirmChange : END.confirmCancel;
  const fieldId = `${idPrefix}-end-${membershipId}`;

  async function onConfirm() {
    const values = { endsOn: mode === "cancel" ? "" : endsOn };
    if (mode !== "cancel") {
      const parsed = parseEndSeat(values, { today }, { startsOn });
      if (!parsed.ok) {
        setError(parsed.message);
        return;
      }
    }
    setError(null);
    setPending(true);
    const result = commission
      ? await endCommissionMemberAction(slug, { commissionId, memberId: membershipId, endsOn: values.endsOn })
      : await endCommitteeSeatAction(slug, { committeeId, membershipId, endsOn: values.endsOn });
    setPending(false);
    if (result.ok) {
      toast.success(mode === "end" ? TOAST.termEnded : mode === "change" ? TOAST.endDateSaved : TOAST.plannedCancelled);
      setOpen(false);
      router.refresh();
    } else if (result.kind === "invalid" && result.field) {
      setError(result.error);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="min-h-11">
          {triggerLabel}{" "}
          <span className="sr-only">for {personName}</span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-h-[90dvh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="[overflow-wrap:anywhere]">{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>{commission ? COMMISSION_MEMBER.endBody : END.body}</p>
              {carries ? <p>{END_TERM_CARRIES}</p> : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {mode === "cancel" ? null : (
          <div>
            <Label htmlFor={fieldId}>{END.field}</Label>
            <Input
              id={fieldId}
              type="date"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${fieldId}-error ${fieldId}-hint` : `${fieldId}-hint`}
              className="mt-1 min-h-11"
            />
            <p id={`${fieldId}-hint`} className="mt-1 text-sm text-muted-foreground">
              {commission ? COMMISSION_MEMBER.endHelper : END.helper}
            </p>
            {error ? (
              <p id={`${fieldId}-error`} role="alert" className="mt-1 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        )}
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          <AlertDialogCancel className="min-h-11 w-full sm:w-auto">{END.goBack}</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={onConfirm}
            className="min-h-11 w-full sm:w-auto"
          >
            {pending ? "Saving…" : confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
