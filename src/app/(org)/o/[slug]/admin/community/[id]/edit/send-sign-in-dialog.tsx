"use client";

import { useId, useState } from "react";
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
import { DatedText } from "@/components/shared/dated-text";
import { useHydrated } from "@/components/shared/use-hydrated";
import { formatDateUTC } from "@/lib/format-date";
import { SIGN_IN_DIALOG_COPY, signInRefusalMessage } from "@/lib/onboarding/sign-in-copy";
import { SIGN_IN_INVITATION_LIMITS, type SignInAckReason } from "@/lib/onboarding/sign-in-types";
import { resendSignInInvitationAction, sendSignInInvitationAction } from "./actions";

const DAY_MS = 86_400_000;

/**
 * "Send invitation", "Send again" and "Send a new one": one AlertDialog (Rule 2),
 * controlled state, no `useForm`, so `check:hydration-gate` does not apply; the
 * trigger is disabled until hydration (the `remove-participant-dialog.tsx`
 * precedent), proved by `e2e/hydration/community-sign-in-controls.spec.ts`.
 *
 * The send names the address the sender SAW; the database chooses where the
 * email goes and refuses a stale confirmation (`address_changed`), so a posted
 * value can only be refused, never used. The acknowledgement (F177 Option 3) is
 * shown up front for a visitor and again whenever the server asks: the
 * `do_not_contact` paragraph only when the server asks. The checkbox must be
 * ticked to send once any acknowledgement paragraph is showing; what is recorded
 * is what the DEFINER returned, never this flag.
 *
 * `needs_acknowledgement` is not an error: the action answers `error: ""` with
 * `needsAcknowledgement`, and the dialog re-opens its paragraphs instead of
 * showing a sentence. The confirm button is a plain `Button`, not
 * `AlertDialogAction`, so a refusal leaves the dialog open with its reason.
 * The label does not change while the action runs (the button is disabled and
 * `aria-busy`): no wording outside the Copy.
 */
export function SendSignInDialog({
  mode,
  slug,
  personId,
  personName,
  address,
  isVisitor,
  triggerLabel,
  disabled = false,
  triggerVariant = "default",
}: {
  mode: "send" | "resend";
  slug: string;
  personId: string;
  personName: string;
  /** The address on file now: what the sender confirms. */
  address: string;
  isVisitor: boolean;
  triggerLabel: string;
  disabled?: boolean;
  triggerVariant?: "default" | "outline";
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const checkboxId = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [asked, setAsked] = useState<SignInAckReason[]>([]);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expires, setExpires] = useState<Date | null>(null);

  const copy = SIGN_IN_DIALOG_COPY;
  const showVisitor = (mode === "send" && isVisitor) || asked.includes("visitor");
  const showDoNotContact = asked.includes("do_not_contact");
  const needsAck = showVisitor || showDoNotContact;

  function handleOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (next) {
      setAsked([]);
      setChecked(false);
      setError(null);
      setExpires(new Date(Date.now() + SIGN_IN_INVITATION_LIMITS.expiryDays * DAY_MS));
    }
  }

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      const run = mode === "send" ? sendSignInInvitationAction : resendSignInInvitationAction;
      const result = await run(slug, { personId, confirmedAddress: address, acknowledged: needsAck && checked });
      if (result.ok) {
        setOpen(false);
        if (mode === "send") {
          if (result.data.delivery === "queued") toast.success(copy.send.toastQueued);
          else toast.success(copy.send.toastSent(result.data.address, formatDateUTC(new Date(result.data.expiresAt))));
        } else {
          toast.success(copy.sendAgain.toastSent(result.data.address));
        }
        router.refresh();
        return;
      }
      if (result.needsAcknowledgement) {
        setAsked(result.needsAcknowledgement);
        setChecked(false);
        return;
      }
      setError(result.error);
      // The record may have changed under us (a new address, an invitation
      // already out): re-read it so the card and the next attempt are current.
      router.refresh();
    } catch {
      setError(signInRefusalMessage("db_error"));
    } finally {
      setPending(false);
    }
  }

  const title = mode === "send" ? copy.send.title(personName) : copy.sendAgain.title;
  const cancel = mode === "send" ? copy.send.cancel : copy.sendAgain.cancel;
  const confirmLabel = mode === "send" ? copy.send.confirm : copy.sendAgain.confirm;

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant={triggerVariant}
          className="min-h-11 w-full sm:w-auto"
          disabled={!hydrated || disabled}
        >
          {triggerLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">{title}</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            {mode === "send" ? (
              expires ? (
                <DatedText dates={[expires]} render={(date) => copy.send.body(personName, address, date)} />
              ) : null
            ) : (
              copy.sendAgain.body(address)
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {needsAck && (
          <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {showVisitor && <p>{copy.send.visitorAcknowledgement(personName)}</p>}
            {showDoNotContact && <p>{copy.send.doNotContactAcknowledgement(personName)}</p>}
            <div className="flex items-start gap-3">
              <input
                id={checkboxId}
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                disabled={!hydrated || pending}
                className="mt-1 size-5 shrink-0 rounded border-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
              <label htmlFor={checkboxId} className="flex min-h-11 flex-1 items-center">
                {copy.send.checkbox}
              </label>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-destructive p-3 text-sm">
            {error}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} className="min-h-11">
            {cancel}
          </AlertDialogCancel>
          <Button
            type="button"
            className="min-h-11"
            disabled={pending || (needsAck && !checked)}
            aria-busy={pending || undefined}
            onClick={confirm}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
