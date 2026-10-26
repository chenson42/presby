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
import { revokeAllInvitationsAction } from "./actions";

/**
 * The takedown lever (Phase 1 verbs): revoke every open invitation for this
 * organization at once - an abuse response, and the kill switch the feature has
 * in place of a flag. Rendered by `page.tsx` only when at least one open
 * invitation exists; a stale count only costs a round trip, since the action
 * revokes whatever is open. Behind an `AlertDialog`; the result is inline and
 * announced, with a toast.
 */
export function RevokeAllInvitations({
  organizationId,
  organizationName,
  openCount,
}: {
  organizationId: string;
  organizationName: string;
  openCount: number;
}) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function revokeAll() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("organizationId", organizationId);
      // The action requires a scope (F198). This control is the designations
      // lever; the org-sent lever is a second control (Batch C).
      fd.set("scope", "designations");
      const outcome = await revokeAllInvitationsAction(fd);
      if (outcome.ok) {
        setMessage({ ok: true, text: "All open invitations were revoked." });
        toast.success("All open invitations revoked.");
      } else {
        setMessage({ ok: false, text: outcome.error });
        toast.error(outcome.error);
      }
    });
  }

  return (
    <section
      data-testid="revoke-all-invitations"
      className="mt-8 rounded-lg border border-border bg-card p-4 text-card-foreground"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Open invitations
      </h2>
      <p className="mt-1 text-sm">
        {openCount === 1
          ? "This organization has 1 open invitation."
          : `This organization has ${openCount} open invitations.`}{" "}
        Revoke them all at once if something looks wrong.
      </p>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" className="mt-3 min-h-11" disabled={isPending}>
            {isPending ? "Revoking…" : "Revoke all open invitations"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke every open invitation?</AlertDialogTitle>
            <AlertDialogDescription>
              Every open invitation for {organizationName} stops working immediately, whoever it was
              sent to. This cannot be undone; you can send new invitations afterwards.
            </AlertDialogDescription>
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
    </section>
  );
}
