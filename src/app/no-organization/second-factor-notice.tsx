import Link from "next/link";
import { Button } from "@/components/ui/button";
import { secondFactorHref } from "./view";

/**
 * The two-factor notice, shared by the connect line (Copy group B) and the
 * invitation card (group C): a sentence and ONE link. Presentational: the words
 * come from the copy module (`NO_ORG_SECOND_FACTOR_COPY` / `NO_ORG_INVITATION_COPY.
 * secondFactor`), picked by the caller for the account's enrolment. The link is a
 * fixed same-origin path (`/totp` when enrolled, `/account/2fa` when not) that
 * returns here, never a value from the request.
 *
 * It does not say two-factor sign-in prevents misuse of a typed address (R42's
 * honest framing), and names neither a congregation nor a role.
 */
export function SecondFactorNotice({
  body,
  button,
  enrolled,
}: {
  body: string;
  button: string;
  enrolled: boolean;
}) {
  return (
    <div role="status" data-testid="second-factor-notice" className="space-y-3">
      <p className="text-sm">{body}</p>
      <Button asChild className="min-h-11 w-full sm:w-auto">
        <Link href={secondFactorHref(enrolled)} prefetch={false}>
          {button}
        </Link>
      </Button>
    </div>
  );
}
