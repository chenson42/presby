"use client";

import { useState, useTransition } from "react";
import {
  Ban,
  CircleCheck,
  Clock,
  TimerOff,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { InvitationCopyPurpose } from "@/lib/onboarding/invitation-copy";
import type { InvitationListRow } from "@/lib/onboarding/issue";
import {
  BLOCKED_REASON_OPERATOR_COPY,
  DELIVERY_STATE_LABEL,
  INVITATION_STATUS_LABEL,
} from "@/lib/onboarding/labels";
import type { InvitationStatus } from "@/lib/onboarding/status";
import type { AccountInvitationBlockedReason } from "@/lib/db/domain/invitations";
import {
  resendInvitationAction,
  revokeInvitationAction,
  type InvitationActionResult,
} from "./actions";
import { InvitationSentNotice } from "./invitation-sent-notice";

const STATUS_ICON: Record<InvitationStatus, LucideIcon> = {
  pending: Clock,
  accepted: CircleCheck,
  expired: TimerOff,
  revoked: Ban,
  blocked: TriangleAlert,
};

/**
 * One section's invitations: a row per invitation (superseded rows never
 * arrive, `listInvitationsForOrg` drops them). One status vocabulary for
 * everyone - pending, accepted, expired, revoked, couldn't be completed - each
 * with an icon AND a word, never colour alone. An open row (pending, or expired
 * and still holding the slot) offers Resend and Revoke; Revoke is behind an
 * `AlertDialog` (Workflow Rule 2). Resend is one click: it replaces the link,
 * and the 5-minute cooldown and the cap are the server's to enforce, shown
 * verbatim in the inline notice. The address is the full address (a platform
 * operator's view while it has not been redacted).
 */
export function InvitationList({
  organizationId,
  invitations,
  purpose,
}: {
  organizationId: string;
  invitations: InvitationListRow[];
  purpose: InvitationCopyPurpose;
}) {
  const [notice, setNotice] = useState<{ result: InvitationActionResult; address?: string } | null>(
    null,
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (invitations.length === 0) return null;

  function run(
    invitation: InvitationListRow,
    action: (fd: FormData) => Promise<InvitationActionResult>,
    successToast: string,
  ) {
    setBusyId(invitation.id);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("organizationId", organizationId);
      fd.set("invitationId", invitation.id);
      const outcome = await action(fd);
      setNotice({ result: outcome, address: invitation.email ?? undefined });
      if (outcome.ok) toast.success(successToast);
      else toast.error(outcome.error);
      setBusyId(null);
    });
  }

  return (
    <div className="mt-4">
      <h3 className="text-lg font-semibold">Invitations</h3>
      <ul className="mt-2 space-y-3">
        {invitations.map((invitation) => {
          const Icon = STATUS_ICON[invitation.status];
          const open = invitation.status === "pending" || invitation.status === "expired";
          // Server-derived: the founding administrator's typed name, or the
          // treasurer's roster first name only.
          const name = invitation.inviteeDisplayName;
          const rowBusy = isPending && busyId === invitation.id;
          return (
            <li
              key={invitation.id}
              data-testid="invitation-row"
              className="rounded-md border border-border bg-card p-3 text-card-foreground"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-all text-base font-medium">
                  {invitation.email ?? "Address removed"}
                </span>
                <Badge variant="outline">
                  <Icon aria-hidden="true" />
                  {INVITATION_STATUS_LABEL[invitation.status]}
                </Badge>
                {invitation.selfDesignated && <Badge variant="secondary">Self-designated</Badge>}
              </div>
              <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {name && (
                  // min-w-0 on the grid item and on the flex child: both default to
                  // min-width:auto, so a long unbroken name would otherwise size the row
                  // to its own min-content and run off a 360 px screen.
                  <div className="flex min-w-0 gap-1">
                    <dt className="text-muted-foreground">For</dt>
                    <dd className="min-w-0 [overflow-wrap:anywhere]">{name}</dd>
                  </div>
                )}
                <div className="flex gap-1">
                  <dt className="text-muted-foreground">Sent</dt>
                  <dd>
                    <FormattedDate value={invitation.createdAt} mode="date" />
                  </dd>
                </div>
                {invitation.status === "accepted" && invitation.acceptedAt ? (
                  <div className="flex gap-1">
                    <dt className="text-muted-foreground">Accepted</dt>
                    <dd>
                      <FormattedDate value={invitation.acceptedAt} mode="date" />
                    </dd>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <dt className="text-muted-foreground">
                      {invitation.status === "expired" ? "Expired" : "Expires"}
                    </dt>
                    <dd>
                      <FormattedDate value={invitation.expiresAt} mode="date" />
                    </dd>
                  </div>
                )}
                {open && (
                  <div className="flex gap-1">
                    <dt className="text-muted-foreground">Email</dt>
                    <dd>{DELIVERY_STATE_LABEL[invitation.delivery]}</dd>
                  </div>
                )}
                {invitation.resendCount > 0 && (
                  <div className="flex gap-1">
                    <dt className="text-muted-foreground">Resent</dt>
                    <dd>{invitation.resendCount === 1 ? "once" : `${invitation.resendCount} times`}</dd>
                  </div>
                )}
              </dl>
              {invitation.status === "expired" && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Expired. Resend it, or revoke it to send a different one.
                </p>
              )}
              {invitation.status === "blocked" && invitation.blockedReason && (
                <p className="mt-2 text-sm">
                  {BLOCKED_REASON_OPERATOR_COPY[invitation.blockedReason as AccountInvitationBlockedReason] ??
                    "The invitation could not be completed. Nothing was changed."}
                </p>
              )}
              {open && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={isPending}
                    onClick={() =>
                      run(invitation, resendInvitationAction, "Invitation resent. The old link no longer works.")
                    }
                  >
                    {rowBusy ? "Working…" : "Resend"}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="outline" className="min-h-11" disabled={isPending}>
                        Revoke
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Revoke this invitation?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The link sent to {invitation.email ?? "this address"} stops working
                          immediately and cannot be restored. You can send a new invitation afterwards.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Keep it</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => run(invitation, revokeInvitationAction, "Invitation revoked.")}
                        >
                          Yes, revoke
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {notice && (
        <InvitationSentNotice result={notice.result} address={notice.address} purpose={purpose} />
      )}
    </div>
  );
}
