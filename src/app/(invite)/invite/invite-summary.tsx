import { FormattedDate } from "@/components/shared/formatted-date";
import { PURPOSE_LABEL } from "@/lib/onboarding/labels";
import type { InvitationPreview } from "@/lib/onboarding/accept";

/** What each role means, in plain words (the invitee has not yet seen the product). */
function roleSummary(purpose: InvitationPreview["purpose"], organizationName: string): string {
  if (purpose === "treasurer") {
    return `As treasurer you will be able to view gifts and donors, record gifts, and manage giving settings for ${organizationName}. This role requires two-factor sign-in.`;
  }
  return `As founding administrator you will be able to manage people, roles and settings for ${organizationName}, and give access to everyone else there.`;
}

/**
 * The one-glance description every live `/invite` state starts with: who
 * invited you, to what, where it was sent (masked in SQL, so the full address
 * never reaches this code) and when it expires. The `<h1>` of the page. Pure
 * display: it consumes nothing (GET never consumes the token).
 */
export function InviteSummary({ preview }: { preview: InvitationPreview }) {
  const role = PURPOSE_LABEL[preview.purpose];
  return (
    <header>
      <h1 className="text-2xl font-semibold">You&apos;re invited</h1>
      <p className="mt-3 text-base">
        A PresbyPortal administrator invited you to be the {role} at{" "}
        <strong className="font-semibold">{preview.organizationName}</strong>.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        {roleSummary(preview.purpose, preview.organizationName)}
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        Sent to <span className="font-medium text-foreground">{preview.maskedEmail}</span>.
        This invitation expires <FormattedDate value={preview.expiresAt} mode="date" />.
      </p>
    </header>
  );
}
