import { FormattedDate } from "@/components/shared/formatted-date";
import type { InvitationActionResult } from "./actions";

/**
 * The inline result of a send, resend or revoke. Errors are `role="alert"`
 * (announced, persistent); success is `role="status"`. Never toast-only. The
 * action's own `error` string is rendered verbatim (it never mentions account
 * existence). Colour is never the only signal: the leading words carry it.
 */
export function InvitationSentNotice({
  result,
  address,
  role,
}: {
  result: InvitationActionResult;
  /** The address the send went to (for the success sentence); omitted for a revoke. */
  address?: string;
  /** "role" or "access" - what nobody holds until acceptance. */
  role: string;
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
    <div role="status" className="mt-3 rounded-md border border-border bg-muted p-3 text-sm">
      {result.delivery === "queued" ? (
        <>Invitation created{address ? ` for ${address}` : ""}. Email delivery is delayed; we&apos;ll keep trying. </>
      ) : (
        <>Invitation sent{address ? ` to ${address}` : ""}. </>
      )}
      It expires on <FormattedDate value={result.expiresAt} mode="date" />. Nobody holds this {role} until
      it is accepted.
    </div>
  );
}
