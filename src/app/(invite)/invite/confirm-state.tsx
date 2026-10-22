import type { InvitationPreview } from "@/lib/onboarding/accept";
import { AcceptSignedInForm } from "./accept-signed-in-form";
import { InviteShell } from "./invite-shell";
import { InviteSummary } from "./invite-summary";

/**
 * Signed in as the invited address, 2FA satisfied: name who they will be and
 * ask for one confirming click ("Accepting as <person> at <org>", G3). A shared
 * household address is common, so the person is named before anything is linked.
 */
export function ConfirmState({ preview, token }: { preview: InvitationPreview; token: string }) {
  const person =
    preview.personDisplayName ??
    [preview.inviteeFirstName, preview.inviteeLastName].filter(Boolean).join(" ");
  return (
    <InviteShell>
      <InviteSummary preview={preview} />
      <p className="mt-5 text-base">
        {person ? (
          <>
            Accepting as <strong className="font-semibold">{person}</strong> at{" "}
            <strong className="font-semibold">{preview.organizationName}</strong>.
          </>
        ) : (
          <>
            Accepting at <strong className="font-semibold">{preview.organizationName}</strong>.
          </>
        )}{" "}
        <span className="text-sm text-muted-foreground">
          If that isn&apos;t you, don&apos;t accept: contact the person who invited you.
        </span>
      </p>
      <AcceptSignedInForm token={token} />
    </InviteShell>
  );
}
