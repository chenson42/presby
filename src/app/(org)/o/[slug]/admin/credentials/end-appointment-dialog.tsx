"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
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
import { endAppointmentAction } from "./actions";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface EndAppointmentDialogProps {
  slug: string;
  appointmentId: string;
  personId: string;
  servingOrgId: string;
  personName: string;
  servingOrgName: string;
  /** 'YYYY-MM-DD' — used only as the end-date input's `min`. The server
   * (`endAppointment`) is still the authoritative check. */
  startsOn: string;
}

/**
 * Ends an existing appointment — NEVER a delete, same discipline
 * `../officers/end-term-dialog.tsx` documents for officer terms.
 * `AlertDialog`, never `confirm()` (Workflow Rule 2). Names both the
 * person and the serving congregation in the confirmation copy.
 */
export function EndAppointmentDialog({
  slug,
  appointmentId,
  personId,
  servingOrgId,
  personName,
  servingOrgName,
  startsOn,
}: EndAppointmentDialogProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [endsOn, setEndsOn] = useState(today);
  const [endReason, setEndReason] = useState("");

  async function handleConfirm() {
    setPending(true);
    const result = await endAppointmentAction(slug, {
      appointmentId,
      endsOn,
      endReason,
      personId,
      servingOrgId,
    });
    setPending(false);
    if (result.ok) {
      toast.success(`Appointment ended for ${personName} at ${servingOrgName}.`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="min-h-11">
          End appointment
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            End {personName}&apos;s appointment at {servingOrgName}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This sets an end date on the existing appointment — it stays on
            record, it is not deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor={`end-appointment-ends-on-${appointmentId}`}>
              End date
            </Label>
            <Input
              id={`end-appointment-ends-on-${appointmentId}`}
              type="date"
              min={startsOn}
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor={`end-appointment-reason-${appointmentId}`}>
              Reason
            </Label>
            <Input
              id={`end-appointment-reason-${appointmentId}`}
              type="text"
              placeholder="e.g. Accepted a call elsewhere"
              value={endReason}
              onChange={(e) => setEndReason(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending || endReason.trim().length === 0}
          >
            {pending ? "Ending…" : "Yes, end appointment"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
