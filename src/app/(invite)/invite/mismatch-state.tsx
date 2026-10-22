import { SubmitButton } from "@/components/shared/submit-button";
import type { InvitationPreview } from "@/lib/onboarding/accept";
import { switchAccountAction } from "../actions";
import { InviteShell } from "./invite-shell";
import { InviteSummary } from "./invite-summary";

/**
 * Signed in as an account that does not own the invited address. The address
 * is shown masked only (it came masked from SQL). "Sign out" stores the token
 * in the hand-off cookie first, so the visitor lands back here, signed out.
 */
export function MismatchState({ preview, token }: { preview: InvitationPreview; token: string }) {
  return (
    <InviteShell>
      <InviteSummary preview={preview} />
      <div role="alert" className="mt-5 rounded-md border border-destructive p-3 text-sm">
        You&apos;re signed in as another account. This invitation was sent to{" "}
        <span className="font-medium">{preview.maskedEmail}</span>. Sign out to accept it.
      </div>
      <form action={switchAccountAction} className="mt-5">
        <input type="hidden" name="token" value={token} />
        <SubmitButton className="min-h-11 w-full" pendingLabel="Signing out…">
          Sign out to accept
        </SubmitButton>
      </form>
    </InviteShell>
  );
}
