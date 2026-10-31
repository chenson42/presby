"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HydrationGate } from "@/components/shared/hydration-gate";
import type { OrganizationType } from "@/lib/authz";
import { sectionLead } from "@/lib/onboarding/designation-holder-copy";
import { expiredInvitationLine, openInvitationLine } from "@/lib/onboarding/invitation-copy";
import type { HolderRow } from "@/lib/onboarding/designation-holder-types";
import type { InvitationListRow } from "@/lib/onboarding/issue";
import { inviteFoundingAdministratorAction } from "./actions";
import { DesignationHolderList } from "./designation-holder-list";
import { InvitationList } from "./invitation-list";
import { InvitationSentNotice } from "./invitation-sent-notice";
import { SendInvitationDialog } from "./send-invitation-dialog";
import { useSendInvitation } from "./use-send-invitation";

/**
 * Human-friendly labels for the administration half of the founding-
 * administrator bundle (`foundingAdministratorPlan()`'s `permissionKeys`,
 * work-log Phase 2 Ruling 3). Kept here, not imported from
 * `@/lib/onboarding/founding-administrator` — that module transitively imports
 * `@/lib/db`, whose module-scope pool construction throws without
 * `DATABASE_URL` (Batch B's own discovery, restated in its header comment);
 * a client component must not pull that module into the browser bundle.
 * `page.tsx` (a Server Component) is the one place that plan function is
 * ever called; this component receives only the plain data it needs
 * (`administrationPermissionKeys`, `officeTemplateName`) as props.
 */
const PERMISSION_LABELS: Record<string, string> = {
  "people.manage": "people",
  "roles.manage": "roles",
  "role_grants.manage": "role assignments",
  "groups.manage": "groups",
  "officers.manage": "officers",
  "org_features.manage": "feature toggles",
  "tickets.file": "support tickets",
  "staff.manage": "staff",
  "domains.manage": "website domains",
  // careers Inc 1, Copy D1: the second label names the accepted residual
  // (DECISION-265) in plain words rather than hiding it.
  "careers.manage": "job openings",
  "careers.applicants": "job applications and resumes",
  "congregation_oversight.manage": "congregation oversight",
};

function summarizePermissions(keys: string[]): string {
  const labels = keys.map((key) => PERMISSION_LABELS[key] ?? key);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

// Simple client-side shape check only — the server action's zod schema
// (`z.string().trim().toLowerCase().pipe(z.email().max(320))`) is the actual gate.
// This exists only to keep the confirm dialog from opening on obvious
// garbage, not to replace server-side validation.
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FoundingAdministratorSectionProps {
  organizationId: string;
  organizationName: string;
  organizationType: OrganizationType;
  canDesignate: boolean;
  /** People who currently hold the slot, from the same list read the rows come from (F169). */
  holderPeopleCount: number;
  /** One row per person or group holding the slot: display name only, never an email (DECISION-195). */
  holders: HolderRow[];
  administrationPermissionKeys: string[];
  officeTemplateName: string | null;
  /** This section's invitations (founding administrator only), newest first. */
  invitations: InvitationListRow[];
  /** `isLocalLoginEnabled()`, read fresh by `page.tsx` (fails open). */
  localLoginEnabled: boolean;
  /** `isTotpConfigured()`: without it a new account would be stranded at the 2FA wall (G8). */
  totpConfigured: boolean;
  /** The signed-in operator's own address, to detect a self-addressed send (R9 reversal). */
  inviterEmail: string | null;
}

/**
 * `/admin/organizations/<id>`'s founding-administrator section. The operator
 * invites ONE person by email (plus their name, so the email greets them and
 * the account is named correctly); the person accepts through `/invite`. The
 * send step never looks the address up, so this screen reads the same whether
 * or not the address already has an account.
 *
 * Three states, by what is true now:
 *   1. someone can already manage roles: the holders, listed by display name
 *      with a Revoke on each (lockout recovery, DECISION-194/195), plus any
 *      invitation history;
 *   2. an invitation is open (pending, or expired and still holding the slot):
 *      its row with Resend and Revoke replaces the form, because the server
 *      allows exactly one open designation per organization;
 *   3. otherwise the form: email, first and last name, confirm `AlertDialog`
 *      (Workflow Rule 2) naming the organization, the address and what the role
 *      grants, plus the self-address / local-login-off / do-not-contact
 *      sentences when they apply.
 *
 * `page.tsx` computes everything fresh on every render and this component
 * trusts it for one render; the server action re-checks every gate itself.
 * Not a `useForm` root (controlled state), wrapped in `<HydrationGate>` anyway
 * so nothing typed before hydration is lost (DECISION-159).
 */
export function FoundingAdministratorSection({
  organizationId,
  organizationName,
  organizationType,
  canDesignate,
  holderPeopleCount,
  holders,
  administrationPermissionKeys,
  officeTemplateName,
  invitations,
  localLoginEnabled,
  totpConfigured,
  inviterEmail,
}: FoundingAdministratorSectionProps) {
  // The last revoke's sentence, kept here (not in the row) because the row is
  // gone once the list re-reads, and the section outlives every branch below.
  const [revokeNotice, setRevokeNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  // The address of the last send, kept after the form clears so the notice can
  // name it (the form fields are emptied on success).
  const [sentAddress, setSentAddress] = useState<string | undefined>(undefined);

  const trimmedEmail = email.trim();
  const formValid =
    EMAIL_SHAPE_RE.test(trimmedEmail) && firstName.trim() !== "" && lastName.trim() !== "";
  const selfAddressed =
    inviterEmail !== null && trimmedEmail.toLowerCase() === inviterEmail.toLowerCase();

  // `organizationType` is accepted as a prop (and threaded through, per the
  // page-gate contract) but is not read directly here: the presbytery-only
  // `congregation_oversight.manage` clause is already folded into
  // `administrationPermissionKeys` by `foundingAdministratorPlan()` on the
  // server, so `permissionSummary` alone is correct for every org type
  // without a second branch in this component.
  void organizationType;
  const permissionSummary = summarizePermissions(administrationPermissionKeys);

  const flow = useSendInvitation({
    send: (acknowledge) => {
      const fd = new FormData();
      fd.set("organizationId", organizationId);
      fd.set("email", trimmedEmail);
      fd.set("firstName", firstName.trim());
      fd.set("lastName", lastName.trim());
      if (acknowledge) fd.set("acknowledge", "true");
      return inviteFoundingAdministratorAction(fd);
    },
    successToast: `Invitation to ${trimmedEmail} sent.`,
    onSent: () => {
      setSentAddress(trimmedEmail);
      setEmail("");
      setFirstName("");
      setLastName("");
    },
  });

  const openInvitation = invitations.find((i) => i.status === "pending" || i.status === "expired");
  const hasOpen = openInvitation !== undefined;
  const list = (
    <InvitationList
      organizationId={organizationId}
      invitations={invitations}
      purpose="founding_administrator"
    />
  );
  // The result of the last send, kept after the form gives way to the open row.
  const sentNotice = flow.result ? (
    <InvitationSentNotice result={flow.result} address={sentAddress} purpose="founding_administrator" />
  ) : null;
  const revokeStatus = revokeNotice ? (
    <p role="status" className="mt-3 rounded-md border border-border bg-muted p-3 text-sm">
      {revokeNotice}
    </p>
  ) : null;

  if (!canDesignate) {
    return (
      <section
        data-testid="founding-administrator-section"
        className="mt-8 rounded-lg border border-border bg-card p-4 text-card-foreground"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Founding administrator
        </h2>
        <p className="mt-1 text-sm text-foreground">
          {sectionLead("founding_administrator", holderPeopleCount)}
        </p>
        {revokeStatus}
        <DesignationHolderList
          organizationId={organizationId}
          organizationName={organizationName}
          slot="founding_administrator"
          holders={holders}
          onRevoked={setRevokeNotice}
        />
        {list}
      </section>
    );
  }

  if (hasOpen) {
    return (
      <section
        data-testid="founding-administrator-section"
        className="mt-8 rounded-lg border border-border bg-card p-4 text-card-foreground"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Founding administrator
        </h2>
        <p className="mt-1 text-sm text-foreground [overflow-wrap:anywhere]">
          {openInvitation?.status === "expired"
            ? expiredInvitationLine("founding_administrator", openInvitation.inviteeDisplayName)
            : openInvitationLine("founding_administrator", openInvitation?.inviteeDisplayName)}
        </p>
        {revokeStatus}
        {sentNotice}
        {list}
      </section>
    );
  }

  return (
    <section
      data-testid="founding-administrator-section"
      className="mt-8 rounded-lg border border-border bg-card p-4 text-card-foreground"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Founding administrator
      </h2>
      <p className="mt-1 text-sm text-foreground">
        This organization has no one yet who can manage roles. Invite one person by email to hand it over:
        they get a link to accept, and nobody holds the role until they do. This can only be done while
        nobody can manage roles (so also as a recovery if it ever loses every role-manager).
      </p>
      {revokeStatus}

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
            if (formValid && totpConfigured) flow.setConfirmOpen(true);
          }}
          className="max-w-sm"
        >
          <div>
            <Label htmlFor="foundingAdministratorEmail">Email address</Label>
            <Input
              id="foundingAdministratorEmail"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="clerk@example.org"
              autoComplete="off"
              disabled={flow.isPending}
              className="mt-1 h-11"
            />
            <p className="mt-1.5 text-sm text-muted-foreground">
              The person does not need an account yet. The link in the email lets them create one, or
              sign in to the one they have, and accept.
            </p>
          </div>
          <div className="mt-3 grid gap-3">
            <div>
              <Label htmlFor="foundingAdministratorFirstName">First name</Label>
              <Input
                id="foundingAdministratorFirstName"
                name="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                disabled={flow.isPending}
                className="mt-1 h-11"
              />
            </div>
            <div>
              <Label htmlFor="foundingAdministratorLastName">Last name</Label>
              <Input
                id="foundingAdministratorLastName"
                name="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                disabled={flow.isPending}
                className="mt-1 h-11"
              />
            </div>
          </div>

          <Button
            type="submit"
            className="mt-4 min-h-11"
            disabled={!formValid || !totpConfigured || flow.isPending}
          >
            {flow.isPending ? "Sending…" : "Send invitation"}
          </Button>
        </form>

        <SendInvitationDialog
          open={flow.confirmOpen}
          onOpenChange={flow.setConfirmOpen}
          title={`Invite ${trimmedEmail} to be ${organizationName}'s founding administrator?`}
          address={trimmedEmail}
          selfAddressed={selfAddressed}
          localLoginEnabled={localLoginEnabled}
          acknowledgement={flow.acknowledgement}
          pending={flow.isPending}
          onConfirm={flow.confirm}
        >
          Once they accept, they will be able to manage {permissionSummary}
          {officeTemplateName
            ? `, plus this organization's constitutional ${officeTemplateName} office`
            : ""}
          . After this, the organization&apos;s own administrators grant everyone through the ordinary
          Roles page.
        </SendInvitationDialog>
      </HydrationGate>
      {list}
    </section>
  );
}
