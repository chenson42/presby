import Link from "next/link";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { SessionApprovalState } from "@/lib/roll";
import { SESSION_BANNER_COPY } from "@/lib/onboarding/sign-in-copy";
import type { SessionSignInRow } from "@/lib/onboarding/sign-in-types";
import { SessionSignInRows } from "./session-sign-in-rows";

/**
 * What the `no_sign_in` banner says after its count (Community Increment 2b,
 * Copy group F, replacing Increment 2's "inviting isn't available yet" line):
 * `rows` for a viewer who holds both `people.manage` and `officers.manage` (names,
 * states and links to each person's card), `other` for everyone else (one
 * sentence, no names and no link, because the invite needs `people.manage` and a
 * read-mode viewer must never be pointed at a page they cannot open, 284e).
 * Absent means `other`: the safe default.
 */
export type SessionHandOff =
  | { kind: "rows"; rows: SessionSignInRow[]; connectEnabled: boolean }
  | { kind: "other" };

/**
 * Flow 7: why the Session cannot act yet, in the six states (DECISION-205),
 * `ready` rendering nothing. Counts only, never names, except the hand-off rows
 * a viewer with both keys is shown under `no_sign_in`. The hand-off appears only
 * in `no_sign_in`, never in `terms_not_started` (284b): a seat that has not
 * started is not waiting on a sign-in.
 */

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
  handOff = { kind: "other" },
}: {
  slug: string;
  handOff?: SessionHandOff;
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
    case "terms_not_started": {
      // Counts seats recorded but not yet in effect; says nothing about
      // accounts (the query never looked at them) and offers no action.
      const n = state.startingLater;
      const one = n === 1;
      const members = one ? "1 member of the Session is" : `${n} members of the Session are`;
      const their = one ? "their term hasn't" : "their terms haven't";
      return (
        <Banner title="No one can approve yet">
          {state.nextStart ? (
            <p>
              {members} recorded, but {their} begun. The{" "}
              {one ? "term begins" : "first term begins"}{" "}
              <FormattedDate value={state.nextStart} mode="date" />, and no
              member of the Session can approve before then.
            </p>
          ) : (
            <p>
              {members} recorded, but {their} begun, so no member of the
              Session can approve yet.
            </p>
          )}
          <p>{SESSION_BANNER_COPY.termsNotStarted}</p>
        </Banner>
      );
    }
    case "no_sign_in":
      return (
        <Banner title="No one can approve yet">
          <p>{SESSION_BANNER_COPY.noSignIn(state.recorded)}</p>
          {handOff.kind === "rows" ? (
            <SessionSignInRows
              slug={slug}
              rows={handOff.rows}
              recorded={state.recorded}
              connectEnabled={handOff.connectEnabled}
            />
          ) : (
            <p>{SESSION_BANNER_COPY.otherViewers}</p>
          )}
        </Banner>
      );
    case "no_permission":
      return (
        <Banner title="No one can approve yet">
          <p>{SESSION_BANNER_COPY.noPermission}</p>
        </Banner>
      );
  }
}
