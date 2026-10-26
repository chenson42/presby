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
import { useHydrated } from "@/components/shared/use-hydrated";
import { SIGN_IN_DIALOG_COPY, signInRefusalMessage } from "@/lib/onboarding/sign-in-copy";
import { revokeSignInInvitationAction } from "./actions";

/**
 * "Cancel invitation": an AlertDialog (Rule 2) with a destructive confirm. The
 * link stops working at once; the person can't sign in through it until a new
 * one is sent. Controlled state, no `useForm`; the trigger is disabled until
 * hydration (DECISION-159). A refusal stays in the dialog with its reason and
 * the page is re-read, so the card shows what is true now.
 */
export function CancelSignInDialog({
  slug,
  personId,
  personName,
  triggerLabel,
}: {
  slug: string;
  personId: string;
  personName: string;
  triggerLabel: string;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = SIGN_IN_DIALOG_COPY.cancel;

  function handleOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (next) setError(null);
  }

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const result = await revokeSignInInvitationAction(slug, { personId });
      if (result.ok) {
        setOpen(false);
        toast.success(copy.toast);
      } else {
        setError(result.error);
      }
      router.refresh();
    } catch {
      setError(signInRefusalMessage("db_error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" disabled={!hydrated}>
          {triggerLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription className="break-words">{copy.body(personName)}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="rounded-md border border-destructive p-3 text-sm">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} className="min-h-11">
            {copy.keep}
          </AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            className="min-h-11"
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={confirm}
          >
            {copy.confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
