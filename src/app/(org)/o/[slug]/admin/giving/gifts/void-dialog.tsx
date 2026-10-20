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
import { Textarea } from "@/components/ui/textarea";
import { useHydrated } from "@/components/shared/use-hydrated";
import { FormField, fieldA11y } from "@/components/giving/form-field";
import { formatCents } from "@/lib/giving/money";
import { voidGiftAction } from "./actions";

/**
 * Void an offline gift - an AlertDialog (never a native confirm) that REQUIRES a
 * reason (3-200 characters). Voiding writes an insert-only reversal row; the
 * gift is never edited or deleted, and the dialog says so. The reason is stored
 * on the reversal and shown on the gift's page; it is not copied into the audit
 * event. A plain `onClick` trigger renders disabled until hydrated (F129).
 */
export function VoidGiftDialog({
  slug,
  giftId,
  amountCents,
  donorName,
  label = "Void gift",
}: {
  slug: string;
  giftId: string;
  amountCents: number;
  donorName: string;
  label?: string;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function confirmVoid() {
    setPending(true);
    setError(undefined);
    const result = await voidGiftAction(slug, { giftId, reason });
    setPending(false);
    if (result.ok) {
      setOpen(false);
      setReason("");
      toast.success("Gift voided.");
      router.refresh();
      return;
    }
    if (result.kind === "two_factor_required" && result.redirectTo) {
      window.location.assign(result.redirectTo);
      return;
    }
    setError(result.fieldErrors?.reason ?? result.error);
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(undefined);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11" disabled={!hydrated}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Void this {formatCents(amountCents)} gift?</AlertDialogTitle>
          <AlertDialogDescription>
            From {donorName}. The gift stays on record, marked as voided with your reason, and no
            longer counts toward totals or statements. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FormField id={`void-reason-${giftId}`} label="Reason" required error={error}>
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            {...fieldA11y(`void-reason-${giftId}`, error)}
          />
        </FormField>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Keep the gift</AlertDialogCancel>
          <Button type="button" disabled={pending || reason.trim().length < 3} onClick={confirmVoid}>
            {pending ? "Voiding…" : "Void gift"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
