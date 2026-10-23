import Link from "next/link";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { SessionApprovalState } from "@/lib/roll";

/**
 * Flow 7: why the Session cannot act yet, in the five states (DECISION-205),
 * `ready` rendering nothing. Counts only, never names. The `no_sign_in`
 * "inviting someone isn't available yet" sentence is the single constant
 * Increment 2b replaces with a link to the invite card.
 */
export const NO_SIGN_IN_INVITE_LINE =
  "Inviting someone to sign in isn't available here yet. Send us a support ticket and we'll help get them set up.";

function Banner({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="status"
      data-testid="session-state-banner"
      className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      <p className="font-medium">{title}</p>
      {children}
    </div>
  );
}

export function SessionStateBanner({
  slug,
  state,
}: {
  slug: string;
  state: Pick<
    SessionApprovalState,
    "kind" | "recorded" | "startingLater" | "nextStart" | "viewer"
  >;
}) {
  switch (state.kind) {
    case "ready":
      return null;
    case "no_session":
      return (
        <Banner title="No Session to approve">
          <p>
            This organization doesn&apos;t have a Session. Receiving members is a
            Session act, so member roll actions aren&apos;t offered here.
            Participants can still be recorded.
          </p>
        </Banner>
      );
    case "empty":
      return (
        <Banner title="Your Session roster is empty">
          {state.viewer.canManageOfficers ? (
            <p>
              Member proposals wait until your Session can approve them. Record
              your ruling elders, installed pastors and associate pastors under
              Officers.{" "}
              <Link
                href={`/o/${slug}/admin/officers`}
                className="font-medium underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
              >
                Open Officers
              </Link>
            </p>
          ) : (
            <p>
              Member proposals wait until your Session can approve them. Ask an
              administrator to record the members of the Session under Officers.
            </p>
          )}
        </Banner>
      );
    case "no_sign_in": {
      const seated = state.recorded + (state.recorded === 0 ? state.startingLater : 0);
      const plural = seated !== 1;
      return (
        <Banner title="No one can approve yet">
          <p>
            {seated} {plural ? "members" : "member"} of the Session{" "}
            {plural ? "are" : "is"} recorded, but none has a PresbyPortal
            account yet, so no one can approve.
            {state.recorded === 0 && state.nextStart && (
              <>
                {" "}
                The first term begins{" "}
                <FormattedDate value={state.nextStart} mode="date" />.
              </>
            )}
          </p>
          <p>{NO_SIGN_IN_INVITE_LINE}</p>
        </Banner>
      );
    }
    case "no_permission":
      return (
        <Banner title="No one can approve yet">
          <p>
            Members of the Session are recorded and have accounts, but none of
            them has permission to approve roll actions. This usually means the
            Session member role was changed. Check Roles, or send us a support
            ticket.
          </p>
        </Banner>
      );
  }
}
