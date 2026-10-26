import type { InvitationPreview } from "@/lib/onboarding/accept";
import { AcceptNewAccountForm } from "./accept-form";
import { InviteShell } from "./invite-shell";
import { InviteSummary } from "./invite-summary";
import { SignInToAcceptForm } from "./sign-in-to-accept-form";

/** First/last guess for a treasurer, whose invitation carries only the roster's display name. */
function splitName(display: string | null): { first: string; last: string } {
  if (!display) return { first: "", last: "" };
  const trimmed = display.trim();
  const i = trimmed.indexOf(" ");
  return i === -1
    ? { first: trimmed, last: "" }
    : { first: trimmed.slice(0, i), last: trimmed.slice(i + 1).trim() };
}

/**
 * Not signed in. Always offers BOTH "Create your account" and "Already have an
 * account? Sign in to accept" (S1): the preview reads no `users` row, so it
 * cannot tell which this visitor needs, and must not. With password sign-in off
 * (G8) the create form is replaced by a plain sentence and sign-in is the only
 * door left.
 */
export function AnonymousState({
  preview,
  token,
  localLoginEnabled,
}: {
  preview: InvitationPreview;
  token: string;
  localLoginEnabled: boolean;
}) {
  // A sign-in invitation never pre-fills a name (G5): the invitee sees nothing
  // about the person before signing in. (The preview already returns none to an
  // anonymous visitor; this keeps it true if that ever changes.)
  const guess = preview.purpose === "sign_in" ? { first: "", last: "" } : splitName(preview.personDisplayName);
  const firstName = preview.inviteeFirstName ?? guess.first;
  const lastName = preview.inviteeLastName ?? guess.last;
  return (
    <InviteShell>
      <InviteSummary preview={preview} />

      <section aria-labelledby="create-heading" className="mt-6 border-t border-border pt-6">
        <h2 id="create-heading" className="text-xl font-semibold">
          Create your account
        </h2>
        {localLoginEnabled ? (
          <AcceptNewAccountForm token={token} defaultFirstName={firstName} defaultLastName={lastName} />
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Password sign-in is turned off right now, so an account can&apos;t be created from this
            link. If you already have an account, sign in below.
          </p>
        )}
      </section>

      <section aria-labelledby="signin-heading" className="mt-6 border-t border-border pt-6">
        <h2 id="signin-heading" className="text-xl font-semibold">
          Already have an account?
        </h2>
        <p className="mt-2 mb-4 text-sm text-muted-foreground">
          Sign in with the account that uses the address above, then accept.
        </p>
        <SignInToAcceptForm token={token} />
      </section>
    </InviteShell>
  );
}
