import { SubmitButton } from "@/components/shared/submit-button";
import { startSignInToAcceptAction } from "../actions";

/**
 * "Sign in to accept": a plain server-action form, no client JS of its own.
 * The action stores the token in the httpOnly hand-off cookie and redirects to
 * `/signin?callbackUrl=/invite` - the token never rides a URL (R6, F156).
 */
export function SignInToAcceptForm({
  token,
  variant = "outline",
}: {
  token: string;
  variant?: "default" | "outline";
}) {
  return (
    <form action={startSignInToAcceptAction}>
      <input type="hidden" name="token" value={token} />
      <SubmitButton variant={variant} className="min-h-11 w-full" pendingLabel="Opening sign in…">
        Sign in to accept
      </SubmitButton>
    </form>
  );
}
