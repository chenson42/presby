"use client";

import type { ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * The confirm step for sending an invitation. An `AlertDialog` (Workflow Rule
 * 2: this act originates access). It names the organization, the address and
 * what the role grants (`children`), then adds the sentences that only apply
 * sometimes:
 *   - a self-addressed send (R9 reversal): the operator will accept it
 *     themselves, and that is recorded as a self-designation;
 *   - password sign-in being off (G8): a new account cannot be created from the
 *     link until it is back on;
 *   - the do-not-contact warning (G19), which replaces the body entirely and
 *     turns the button into "Send anyway".
 * Rendered by a parent that owns the trigger and the open state.
 */
export function SendInvitationDialog({
  open,
  onOpenChange,
  title,
  address,
  selfAddressed,
  localLoginEnabled,
  acknowledgement,
  pending,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  address: string;
  selfAddressed: boolean;
  localLoginEnabled: boolean;
  acknowledgement: string | null;
  pending: boolean;
  onConfirm: () => void;
  children: ReactNode;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{acknowledgement ? "Send anyway?" : title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {acknowledgement ? (
                <p>{acknowledgement}</p>
              ) : (
                <>
                  <p>{children}</p>
                  <p>
                    The invitation goes to <strong className="font-semibold">{address}</strong>, works
                    once, and nobody holds this role until it is accepted.
                  </p>
                  {selfAddressed && (
                    <p data-testid="self-address-sentence">
                      This is your own address. You will accept the invitation yourself, and it will be
                      recorded as a self-designation.
                    </p>
                  )}
                  {!localLoginEnabled && (
                    <p data-testid="local-login-off-sentence">
                      Password sign-in is turned off right now, so someone without an account cannot
                      create one from the link until it is turned back on.
                    </p>
                  )}
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              // Keep the dialog open until the action returns: an
              // acknowledgement result swaps its body instead of closing it.
              event.preventDefault();
              onConfirm();
            }}
            disabled={pending}
          >
            {pending ? "Sending…" : acknowledgement ? "Send anyway" : "Yes, send invitation"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
