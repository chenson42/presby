"use client";

import { useState, useTransition } from "react";
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
import { REVOKE_ALL_RESULT_COPY } from "@/lib/onboarding/sign-in-copy";
import type { RevokeAllScope } from "@/lib/onboarding/sign-in-types";
import { revokeAllInvitationsAction } from "./actions";

/**
 * The shared takedown control: one button, one `AlertDialog`, one result line.
 * It posts the organization id and a REQUIRED `scope` to the existing platform
 * action (F198): `designations` for the founding-administrator and treasurer
 * invitations a platform operator sent, `org_sent` for the sign-in invitations
 * the congregation itself sent. The two levers are separate on purpose, so
 * pulling one never silently pulls the other. The words (button, title,
 * description) are the caller's; the dialog's own Keep/Yes labels are the
 * existing ones.
 */
export function RevokeAllControl({
  organizationId,
  scope,
  buttonLabel,
  dialogTitle,
  dialogDescription,
}: {
  organizationId: string;
  scope: RevokeAllScope;
  buttonLabel: string;
  dialogTitle: string;
  dialogDescription: string;
}) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function revokeAll() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("organizationId", organizationId);
      fd.set("scope", scope);
      const outcome = await revokeAllInvitationsAction(fd);
      if (outcome.ok) {
        // Per scope: the message names what was and was not revoked (QA run 1 (c)).
        setMessage({ ok: true, text: REVOKE_ALL_RESULT_COPY[scope].message });
        toast.success(REVOKE_ALL_RESULT_COPY[scope].toast);
      } else {
        setMessage({ ok: false, text: outcome.error });
        toast.error(outcome.error);
      }
    });
  }

  return (
    <>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="mt-3 min-h-11 w-full whitespace-normal sm:w-auto"
            disabled={isPending}
          >
            {buttonLabel}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>{dialogDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={revokeAll}>
              Yes, revoke all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={
            message.ok
              ? "mt-3 rounded-md border border-border bg-muted p-3 text-sm"
              : "mt-3 rounded-md border border-destructive p-3 text-sm"
          }
        >
          {message.text}
        </p>
      )}
    </>
  );
}
