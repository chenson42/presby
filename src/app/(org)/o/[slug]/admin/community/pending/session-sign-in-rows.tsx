import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DatedText } from "@/components/shared/dated-text";
import { SESSION_BANNER_COPY, sessionRowStateLabel } from "@/lib/onboarding/sign-in-copy";
import type { SessionSignInRow } from "@/lib/onboarding/sign-in-types";

/**
 * The Session hand-off under the `no_sign_in` banner (Community Increment 2b,
 * Copy group F): one row per Session seat without a connected sign-in, each with
 * the person's name, the state of their invitation and a link ("Invite" when
 * nothing is out and there is an address, "Open" otherwise) to the card on their
 * edit page, then, once at least one invitation is out, how many are.
 *
 * Rendered ONLY when `listSessionSignInRows` returned `ok`, which is a viewer
 * holding both `people.manage` and `officers.manage` (284e); everyone else gets
 * the no-names sentence and no link from the banner. A Server Component: the
 * rows are links, and the dates are `<FormattedDate>`s.
 *
 * The first sentence ("A member of the Session is also connected when they
 * sign in with the email address on their record...") is a statement of a rule
 * that holds only while the congregation's connect toggle is on, so it is shown
 * only then; the rows and the count are shown either way.
 */
export function SessionSignInRows({
  slug,
  rows,
  recorded,
  connectEnabled,
}: {
  slug: string;
  rows: SessionSignInRow[];
  /** The banner's own count of Session members in effect; equals the rows' set. */
  recorded: number;
  connectEnabled: boolean;
}) {
  // An invitation is "out" while it is open: sent, or sent and bounced.
  const out = rows.filter((row) => row.state === "sent" || row.state === "bounced").length;
  return (
    <div className="space-y-2" data-testid="session-sign-in-rows">
      {connectEnabled && <p>{SESSION_BANNER_COPY.handOff}</p>}
      {rows.length > 0 && (
        <ul className="divide-y divide-amber-300/60 dark:divide-amber-900">
          {rows.map((row) => (
            <li
              key={row.personId}
              data-testid="session-sign-in-row"
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1"
            >
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium">{row.name}</p>
                <p className="break-words text-xs">
                  <DatedText
                    dates={row.sentAt ? [row.sentAt] : []}
                    render={(date) => sessionRowStateLabel(row.state, () => date ?? "", row.sentAt)}
                  />
                </p>
              </div>
              <Button asChild variant="link" className="min-h-11 min-w-11 shrink-0 px-2 text-current">
                <Link href={`/o/${slug}/admin/community/${row.personId}/edit#sign-in`}>
                  {/* One child, so the space before the sr-only name is not collapsed. */}
                  <span>
                    {row.action === "invite" ? SESSION_BANNER_COPY.rowLinks.invite : SESSION_BANNER_COPY.rowLinks.open}
                    <span className="sr-only">{` ${row.name}`}</span>
                  </span>
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {out > 0 && <p>{SESSION_BANNER_COPY.invitationsOut(out, recorded)}</p>}
    </div>
  );
}
