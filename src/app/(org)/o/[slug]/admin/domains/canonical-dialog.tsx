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
import { useHydrated } from "@/components/shared/use-hydrated";
import { changeCanonicalAction } from "./actions";

/**
 * "Make primary": confirms before changing which live address is the primary
 * one (every other address, and the PresbyPortal address, then sends visitors to
 * it). `AlertDialog`, never `confirm()` (Workflow Rule 2). The Confirm control
 * is a plain Button, not `AlertDialogAction`, so a refusal keeps the dialog open
 * with the reason in a toast instead of closing on the person.
 */
export function CanonicalDialog({
  slug,
  domainId,
  hostname,
  triggerLabel = "Make primary",
  variant = "outline",
  fullWidthOnMobile = false,
}: {
  slug: string;
  domainId: string;
  hostname: string;
  triggerLabel?: string;
  variant?: "outline" | "default";
  /** Stretch the trigger across a phone-width row (the advisory banner), where it would otherwise sit at the end of a long line. */
  fullWidthOnMobile?: boolean;
}) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    try {
      const result = await changeCanonicalAction(slug, domainId);
      if (result.ok) {
        toast.success(`${hostname} is now your primary address.`);
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error("We couldn't change that right now. Try again in a few minutes.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant={variant}
          className={fullWidthOnMobile ? "min-h-11 w-full sm:w-auto" : "min-h-11"}
          disabled={!hydrated}
          aria-label={triggerLabel === "Make primary" ? `Make ${hostname} primary` : undefined}
        >
          {triggerLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-words">Make {hostname} your primary address?</AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            Visitors who use your other addresses, and your PresbyPortal address, will be sent to {hostname}. Search
            results and links we create will use it. You can change it back whenever you like.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button type="button" className="min-h-11" disabled={pending} onClick={confirm}>
            {pending ? "Changing…" : "Make primary"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
