"use client";

import { ORG_SENT_PANEL_COPY } from "@/lib/onboarding/sign-in-copy";
import { RevokeAllControl } from "./revoke-all-control";

/**
 * The designations takedown lever (Phase 1 verbs): revoke every open
 * founding-administrator and treasurer invitation for this organization at once
 * - an abuse response, and the kill switch the feature has in place of a flag.
 * Rendered by `page.tsx` only when at least one open invitation exists; a stale
 * count only costs a round trip, since the action revokes whatever is open.
 * Behind an `AlertDialog` (in `RevokeAllControl`); the result is inline and
 * announced, with a toast.
 *
 * Community Increment 2b: the button now says which invitations it means,
 * "Cancel all open designation invitations ({n})" (Copy, platform panel), because
 * a second lever, in `org-sent-invitations.tsx`, cancels the sign-in invitations
 * the congregation sent. The dialog's explanation is unchanged.
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
      <RevokeAllControl
        organizationId={organizationId}
        scope="designations"
        buttonLabel={ORG_SENT_PANEL_COPY.designationsButton(openCount)}
        dialogTitle="Revoke every open invitation?"
        dialogDescription={`Every open invitation for ${organizationName} stops working immediately, whoever it was sent to. This cannot be undone; you can send new invitations afterwards.`}
      />
    </section>
  );
}
