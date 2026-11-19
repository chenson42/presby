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
import { endCommissionAction } from "@/app/(org)/o/[slug]/admin/committees/commissions/[commissionId]/actions";
import { TOAST } from "@/lib/committees/copy";
import { parseEndCommission } from "@/lib/committees/validate";
import { COMMISSIONS, END_COMMISSION } from "@/lib/committees/ui-copy";

type FieldName = "endedOn" | "endedMinuteReference";

/**
 * "End commission" (C15): the date it ended and, optionally, the minute that received
 * its report, in an `AlertDialog` (plain controlled inputs, no `useForm`: it opens
 * only after the page has hydrated). Every member's term ends on that date; the body
 * says the record is kept and cannot be reopened from this page. A refusal that
 * belongs to a field (a future date, a date before the appointment or before a member
 * started) shows under that field and the dialog stays open; anything else is a toast.
 */
export function EndCommissionDialog({
  slug,
  commissionId,
  appointedOn,
  today,
}: {
  slug: string;
  commissionId: string;
  appointedOn: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [endedOn, setEndedOn] = useState(today);
  const [minute, setMinute] = useState("");
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [pending, setPending] = useState(false);

  async function onConfirm() {
    const values = { endedOn, endedMinuteReference: minute };
    const parsed = parseEndCommission(values, { today }, { appointedOn });
    if (!parsed.ok) {
      setErrors(parsed.errors as Partial<Record<FieldName, string>>);
      return;
    }
    setErrors({});
    setPending(true);
    const result = await endCommissionAction(slug, { commissionId, ...values });
    setPending(false);
    if (result.ok) {
      toast.success(TOAST.commissionEnded);
      setOpen(false);
      router.refresh();
    } else if (result.kind === "invalid" && (result.field === "endedOn" || result.field === "endedMinuteReference")) {
      setErrors({ [result.field]: result.error });
    } else if (result.kind === "date_before_start") {
      setErrors({ endedOn: result.error });
    } else {
      toast.error(result.error);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setErrors({});
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto">
          {COMMISSIONS.endCommission}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-h-[90dvh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{END_COMMISSION.title}</AlertDialogTitle>
          <AlertDialogDescription>{END_COMMISSION.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <div>
          <Label htmlFor="end-commission-on">{END_COMMISSION.field}</Label>
          <Input
            id="end-commission-on"
            type="date"
            min={appointedOn}
            max={today}
            value={endedOn}
            onChange={(e) => setEndedOn(e.target.value)}
            aria-invalid={errors.endedOn ? true : undefined}
            aria-describedby={errors.endedOn ? "end-commission-on-error end-commission-on-hint" : "end-commission-on-hint"}
            className="mt-1 min-h-11"
          />
          <p id="end-commission-on-hint" className="mt-1 text-sm text-muted-foreground">
            {END_COMMISSION.helper}
          </p>
          {errors.endedOn ? (
            <p id="end-commission-on-error" role="alert" className="mt-1 text-sm text-destructive">
              {errors.endedOn}
            </p>
          ) : null}
        </div>
        <div>
          <Label htmlFor="end-commission-minute">{END_COMMISSION.minuteField}</Label>
          <Input
            id="end-commission-minute"
            type="text"
            autoComplete="off"
            value={minute}
            onChange={(e) => setMinute(e.target.value)}
            aria-invalid={errors.endedMinuteReference ? true : undefined}
            aria-describedby={errors.endedMinuteReference ? "end-commission-minute-error" : undefined}
            className="mt-1 min-h-11"
          />
          {errors.endedMinuteReference ? (
            <p id="end-commission-minute-error" role="alert" className="mt-1 text-sm text-destructive">
              {errors.endedMinuteReference}
            </p>
          ) : null}
        </div>
        <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
          <AlertDialogCancel className="min-h-11 w-full sm:w-auto">{END_COMMISSION.goBack}</AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm} className="min-h-11 w-full sm:w-auto">
            {pending ? "Ending…" : END_COMMISSION.confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
