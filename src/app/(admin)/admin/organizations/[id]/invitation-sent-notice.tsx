import { FormattedDate } from "@/components/shared/formatted-date";
import { acceptanceSentence, type InvitationCopyPurpose } from "@/lib/onboarding/invitation-copy";
import type { InvitationActionResult } from "./actions";

/**
 * The inline result of a send, resend or revoke. Errors are `role="alert"`
 * (announced, persistent); success is `role="status"`. Never toast-only. The
 * action's own `error` string is rendered verbatim (it never mentions account
 * existence). Colour is never the only signal: the leading words carry it. A non-blocking
 * warning (person-emails Batch 3) is a "Note." paragraph inside the same status
 * region: the invitation WAS sent, so it is not an alert. The acceptance
 * sentence names who must accept (server-derived `result.inviteeDisplayName`),
 * falling back to the address and then to "the invitee"; all copy lives in
 * `@/lib/onboarding/invitation-copy` so the tests import the real text.
 */
export function InvitationSentNotice({
  result,
  address,
  purpose,
}: {
  result: InvitationActionResult;
  /** The address the send went to (for the success sentence); omitted for a revoke. */
  address?: string;
  /** Which designation this is: decides the sentence's wording ("role" or "access"). */
  purpose: InvitationCopyPurpose;
}) {
  if (!result.ok) {
    return (
      <div role="alert" className="mt-3 rounded-md border border-destructive p-3 text-sm">
        <span className="font-semibold">Not sent. </span>
        {result.error}
      </div>
    );
  }
  if (!result.expiresAt) {
    return (
      <div role="status" className="mt-3 rounded-md border border-border bg-muted p-3 text-sm">
        Done.
      </div>
    );
  }
  return (
    <div role="status" className="mt-3 break-words rounded-md border border-border bg-muted p-3 text-sm">
      {result.delivery === "queued" ? (
        <>Invitation created{address ? ` for ${address}` : ""}. Email delivery is delayed; we&apos;ll keep trying. </>
      ) : (
        <>Invitation sent{address ? ` to ${address}` : ""}. </>
      )}
      It expires on <FormattedDate value={result.expiresAt} mode="date" />.{" "}
      {acceptanceSentence({
        purpose,
        name: result.inviteeDisplayName,
        address,
      })}
      {result.warnings?.map((warning) => (
        <p key={warning.code} data-testid="invitation-warning" className="mt-2">
          <span className="font-semibold">Note. </span>
          {warning.message}
        </p>
      ))}
    </div>
  );
}
