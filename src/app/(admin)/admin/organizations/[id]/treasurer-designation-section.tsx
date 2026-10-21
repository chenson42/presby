"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HydrationGate } from "@/components/shared/hydration-gate";
import type { InvitationListRow } from "@/lib/onboarding/issue";
import { inviteTreasurerAction } from "./actions";
import { InvitationList } from "./invitation-list";
import { InvitationSentNotice } from "./invitation-sent-notice";
import { SendInvitationDialog } from "./send-invitation-dialog";
import { useSendInvitation } from "./use-send-invitation";

// Client-side shape check only: the action's zod schema is the real gate. It
// only keeps the confirm dialog from opening on obvious garbage.
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface TreasurerDesignationSectionProps {
  organizationId: string;
  organizationName: string;
  /** Read fresh on every render by `page.tsx` (never cached). */
  canDesignate: boolean;
  /** Number of people who currently hold `giving.manage`. A count, NEVER names:
   * who handles a congregation's money is not the platform operator's to read
   * off a list (the same discipline the founding-administrator section keeps). */
  currentHolderCount: number;
  /** This section's invitations (treasurer only), newest first. */
  invitations: InvitationListRow[];
  /** `isLocalLoginEnabled()`, read fresh by `page.tsx` (fails open). */
  localLoginEnabled: boolean;
  /** `isTotpConfigured()`: a treasurer is forced through 2FA enrolment (G8). */
  totpConfigured: boolean;
  /** The signed-in operator's own address, to detect a self-addressed send. */
  inviterEmail: string | null;
}

/**
 * `/admin/organizations/<id>`'s treasurer-designation section — the platform
 * operator names a congregation's FIRST holder of `giving.manage`
 * (docs/work-log/2026-10-15-online-giving.md, Phase 2 R2 / Phase 3
 * "Designation"; DECISION-155's shape, beside `founding-administrator-section`).
 *
 * `page.tsx` renders this ONLY for an applicable organization type
 * (congregation or new worshiping community) — a presbytery sees no section at
 * all. For an applicable org it shows the email control while the holder count
 * is zero and nothing is pending; an open invitation (pending, or expired and
 * still holding the slot) replaces the form with its row, Resend and Revoke
 * (the server allows one open designation per organization); once anyone holds
 * `giving.manage` it collapses to a read-only count with no form. The invitee
 * is found by the address on file for a member here, never by account. This
 * component trusts its props for one render only; the server action re-checks
 * the gate itself and answers `has_holders` if the prop went stale — never a
 * client-side-only guard.
 *
 * Not a `useForm` root (plain controlled state + an AlertDialog confirm, the
 * founding-administrator section's structure), but wrapped in
 * `<HydrationGate>` all the same so nothing typed before hydration is lost.
 * The act grants access to money, so the confirm is an `AlertDialog`
 * (Workflow Rule 2), never a native dialog.
 */
export function TreasurerDesignationSection({
  organizationId,
  organizationName,
  canDesignate,
  currentHolderCount,
  invitations,
  localLoginEnabled,
  totpConfigured,
  inviterEmail,
}: TreasurerDesignationSectionProps) {
  const [email, setEmail] = useState("");
  const trimmedEmail = email.trim();
  const emailLooksValid = EMAIL_SHAPE_RE.test(trimmedEmail);
  const selfAddressed =
    inviterEmail !== null && trimmedEmail.toLowerCase() === inviterEmail.toLowerCase();

  const flow = useSendInvitation({
    send: (acknowledge) => {
      const fd = new FormData();
      fd.set("organizationId", organizationId);
      fd.set("email", trimmedEmail);
      if (acknowledge) fd.set("acknowledge", "true");
      return inviteTreasurerAction(fd);
    },
    successToast: `Invitation to ${trimmedEmail} sent.`,
    onSent: () => setEmail(""),
  });

  const hasOpen = invitations.some((i) => i.status === "pending" || i.status === "expired");
  const list = (
    <InvitationList organizationId={organizationId} invitations={invitations} role="access" />
  );
  const sentNotice = flow.result ? (
    <InvitationSentNotice result={flow.result} role="access" />
  ) : null;

  if (!canDesignate) {
    return (
      <section
        data-testid="treasurer-designation-section"
        className="mt-8 rounded-lg border border-border bg-card p-4 text-card-foreground"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Treasurer
        </h2>
        <p className="mt-1 text-sm text-foreground">
          This organization already has{" "}
          {currentHolderCount === 1 ? "one person" : `${currentHolderCount} people`} who can manage
          giving — a treasurer has already been designated. They add and remove everyone else from the
          organization&apos;s own Giving team page.
        </p>
        {list}
      </section>
    );
  }

  if (hasOpen) {
    return (
      <section
        data-testid="treasurer-designation-section"
        className="mt-8 rounded-lg border border-border bg-card p-4 text-card-foreground"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Treasurer
        </h2>
        <p className="mt-1 text-sm text-foreground">
          An invitation is open. Nobody holds this access until it is accepted. Resend it if the email
          went astray, or revoke it to invite someone else.
        </p>
        {sentNotice}
        {list}
      </section>
    );
  }

  return (
    <section
      data-testid="treasurer-designation-section"
      className="mt-8 rounded-lg border border-border bg-card p-4 text-card-foreground"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Treasurer
      </h2>
      <p className="mt-1 text-sm text-foreground">
        No one here can manage giving yet. Invite the congregation&apos;s first treasurer by email: they
        get a link to accept, and nobody holds the access until they do. This can only be done while
        nobody holds that access (it also works as a recovery if the last treasurer is ever removed).
      </p>

      {!totpConfigured && (
        <p role="alert" className="mt-3 rounded-md border border-destructive p-3 text-sm">
          Two-factor sign-in isn&apos;t set up on this deployment, so an invitation can&apos;t be sent yet.
          Ask an engineer to configure it.
        </p>
      )}
      {sentNotice}

      <HydrationGate className="mt-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (emailLooksValid && totpConfigured) flow.setConfirmOpen(true);
          }}
          className="max-w-sm"
        >
          <Label htmlFor="treasurerEmail">Treasurer&apos;s email address</Label>
          <Input
            id="treasurerEmail"
            name="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="treasurer@example.org"
            autoComplete="off"
            disabled={flow.isPending}
            className="mt-1 h-11"
          />
          <p className="mt-1.5 text-sm text-muted-foreground">
            The address must be the one on file for a member of this organization. An invitation never
            adds anyone to the organization; if they are not enrolled yet, the organization&apos;s
            administrator enrols them first. They do not need an account yet.
          </p>
          <Button
            type="submit"
            className="mt-4 min-h-11"
            disabled={!emailLooksValid || !totpConfigured || flow.isPending}
          >
            {flow.isPending ? "Sending…" : "Send invitation"}
          </Button>
        </form>

        <SendInvitationDialog
          open={flow.confirmOpen}
          onOpenChange={flow.setConfirmOpen}
          title={`Invite ${trimmedEmail} to be ${organizationName}'s treasurer?`}
          address={trimmedEmail}
          selfAddressed={selfAddressed}
          localLoginEnabled={localLoginEnabled}
          acknowledgement={flow.acknowledgement}
          pending={flow.isPending}
          onConfirm={flow.confirm}
        >
          Once they accept, they will be able to view every gift and donor, record gifts, and manage the
          organization&apos;s giving settings, funds and giving team. Holding this access requires
          two-factor sign-in. After this, the treasurer — not the platform — adds and removes everyone
          else.
        </SendInvitationDialog>
      </HydrationGate>
      {list}
    </section>
  );
}
