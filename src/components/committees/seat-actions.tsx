import Link from "next/link";
import { Button } from "@/components/ui/button";
import { setCommitteeSeatPublicListedAction } from "@/app/(org)/o/[slug]/admin/committees/[committeeId]/actions";
import { PAGE } from "@/lib/committees/ui-copy";
import type { SeatState } from "@/lib/committees/derive";
import type { SeatRow } from "@/lib/committees/reads";
import { EndTermDialog } from "./end-term-dialog";
import { PublicListingToggle } from "./public-listing-toggle";

/**
 * What can be done to one seat: "Change role" (a link to the role page), the end
 * control (chosen by the seat's state) and, on "Serving now" only, the public
 * listing switch. A past seat has none; a dissolved committee never reaches here.
 */
export function SeatActions({
  slug,
  committeeId,
  committeeName,
  seat,
  state,
  today,
  carries,
  idPrefix,
}: {
  slug: string;
  committeeId: string;
  committeeName: string;
  seat: SeatRow;
  state: SeatState;
  today: string;
  carries: boolean;
  idPrefix: string;
}) {
  if (state === "past") return null;
  const mode = state === "planned" ? "cancel" : seat.endsOn ? "change" : "end";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild variant="outline" size="sm" className="min-h-11">
        <Link href={`/o/${slug}/admin/committees/${committeeId}/members/${seat.membershipId}/role`}>
          {PAGE.changeRole}{" "}
          <span className="sr-only">for {seat.displayName}</span>
        </Link>
      </Button>
      <EndTermDialog
        slug={slug}
        committeeId={committeeId}
        membershipId={seat.membershipId}
        personName={seat.displayName}
        mode={mode}
        startsOn={seat.startsOn}
        currentEndsOn={seat.endsOn}
        today={today}
        carries={carries}
        idPrefix={idPrefix}
      />
      {state === "serving" ? (
        <PublicListingToggle
          action={setCommitteeSeatPublicListedAction}
          slug={slug}
          committeeId={committeeId}
          membershipId={seat.membershipId}
          committeeName={committeeName}
          personName={seat.displayName}
          publicListed={seat.publicListed}
        />
      ) : null}
    </div>
  );
}
