import { FormattedDate } from "@/components/shared/formatted-date";
import { PURPOSE_LABEL } from "@/lib/onboarding/labels";
import { SIGN_IN_INVITE_COPY } from "@/lib/onboarding/sign-in-copy";
import type { InvitationPreview } from "@/lib/onboarding/accept";

/**
 * What each role means, in plain words (the invitee has not yet seen the
 * product). Exhaustive on purpose (F196's TypeScript half): a purpose added
 * later is a type error here, and cannot fall into another purpose's text.
 */
function roleSummary(purpose: InvitationPreview["purpose"], organizationName: string): string {
  switch (purpose) {
    case "treasurer":
      return `As treasurer you will be able to view gifts and donors, record gifts, and manage giving settings for ${organizationName}. This role requires two-factor sign-in.`;
    case "founding_administrator":
      return `As founding administrator you will be able to manage people, roles and settings for ${organizationName}, and give access to everyone else there.`;
    case "sign_in":
      // Not used: a sign_in invitation has no role, and its lead sentence below
      // is the whole summary. Present so the switch stays total.
      return "";
    default: {
      const _exhaustive: never = purpose;
      throw new Error(`Unhandled invitation purpose: ${String(_exhaustive)}`);
    }
  }
}

/**
 * The one-glance description every live `/invite` state starts with: who
 * invited you, to what, where it was sent (masked in SQL, so the full address
 * never reaches this code) and when it expires. The `<h1>` of the page. Pure
 * display: it consumes nothing (GET never consumes the token).
 */
export function InviteSummary({ preview }: { preview: InvitationPreview }) {
  // A congregation's sign-in invitation carries no role and is sent by a person
  // at the congregation, not the platform: it reads its own one-paragraph
  // summary and never pre-fills a name (the preview returns none).
  const isSignIn = preview.purpose === "sign_in";
  const role = PURPOSE_LABEL[preview.purpose];
  return (
    <header>
      <h1 className="text-2xl font-semibold">You&apos;re invited</h1>
      {isSignIn ? (
        <p className="mt-3 text-base">{SIGN_IN_INVITE_COPY.summary(preview.organizationName)}</p>
      ) : (
        <>
          <p className="mt-3 text-base">
            A PresbyPortal administrator invited you to be the {role} at{" "}
            <strong className="font-semibold">{preview.organizationName}</strong>.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {roleSummary(preview.purpose, preview.organizationName)}
          </p>
        </>
      )}
      <p className="mt-3 text-sm text-muted-foreground">
        Sent to <span className="font-medium text-foreground">{preview.maskedEmail}</span>.
        This invitation expires <FormattedDate value={preview.expiresAt} mode="date" />.
      </p>
    </header>
  );
}
