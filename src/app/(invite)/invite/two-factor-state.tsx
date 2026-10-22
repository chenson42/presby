import { SubmitButton } from "@/components/shared/submit-button";
import type { InvitationPreview } from "@/lib/onboarding/accept";
import { continueToVerifyAction } from "../actions";
import { InviteShell } from "./invite-shell";
import { InviteSummary } from "./invite-summary";

/**
 * The right account, but it uses two-factor sign-in and this session has not
 * passed the challenge (G9). `/invite` is public, so the page enforces what the
 * proxy would on `/admin` or `/o/*`. "Verify" stores the token in the cookie
 * then continues to `/totp?callbackUrl=/invite`.
 */
export function TwoFactorState({ preview, token }: { preview: InvitationPreview; token: string }) {
  return (
    <InviteShell>
      <InviteSummary preview={preview} />
      <p className="mt-5 text-sm">
        Your account uses two-factor sign-in. Verify your code first, then come back here to accept.
      </p>
      <form action={continueToVerifyAction} className="mt-5">
        <input type="hidden" name="token" value={token} />
        <SubmitButton className="min-h-11 w-full" pendingLabel="Opening verification…">
          Verify and continue
        </SubmitButton>
      </form>
    </InviteShell>
  );
}
