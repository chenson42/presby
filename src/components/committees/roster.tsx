import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { splitRoster, type SeatState } from "@/lib/committees/derive";
import type { SeatRow } from "@/lib/committees/reads";
import { PAGE } from "@/lib/committees/ui-copy";
import { SeatActions } from "./seat-actions";
import { SeatBadges } from "./seat-badges";
import { SeatCard } from "./seat-card";
import { SeatDates } from "./seat-dates";

interface RosterProps {
  slug: string;
  committeeId: string;
  committeeName: string;
  seats: readonly SeatRow[];
  today: string;
  carries: boolean;
  /** False for a dissolved committee: the roster is history and shows no write control. */
  canWrite: boolean;
}

function RosterSection({
  heading,
  seats,
  state,
  ...rest
}: Omit<RosterProps, "seats"> & { heading: string; seats: readonly SeatRow[]; state: SeatState }) {
  const { slug, committeeId, committeeName, today, carries, canWrite } = rest;
  const showActions = canWrite && state !== "past";
  const id = `roster-${state}`;
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-lg font-semibold">
        {heading}
      </h2>
      <ul className="space-y-3 sm:hidden">
        {seats.map((seat) => (
          <SeatCard
            key={seat.membershipId}
            slug={slug}
            committeeId={committeeId}
            committeeName={committeeName}
            seat={seat}
            state={state}
            today={today}
            carries={carries}
            canWrite={canWrite}
          />
        ))}
      </ul>
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{PAGE.tableHead.name}</TableHead>
              <TableHead>{PAGE.tableHead.role}</TableHead>
              <TableHead>{PAGE.tableHead.dates}</TableHead>
              {showActions ? <TableHead>{PAGE.tableHead.actions}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {seats.map((seat) => (
              <TableRow key={seat.membershipId}>
                <TableCell className="max-w-xs whitespace-normal font-medium [overflow-wrap:anywhere]">{seat.displayName}</TableCell>
                <TableCell className="whitespace-normal">
                  <SeatBadges seat={seat} />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <SeatDates seat={seat} today={today} />
                </TableCell>
                {showActions ? (
                  <TableCell className="whitespace-normal">
                    <SeatActions
                      slug={slug}
                      committeeId={committeeId}
                      committeeName={committeeName}
                      seat={seat}
                      state={state}
                      today={today}
                      carries={carries}
                      idPrefix="table"
                    />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

/**
 * The roster in three sections, Serving now, Starting later and Past members (the
 * last omitted when empty): a card per seat below `sm` and a table at `sm` and
 * above. Role, dates and status badges are never the first things hidden. Both
 * layouts are rendered and CSS shows one, so the hidden one is out of the tab order.
 */
export function Roster(props: RosterProps) {
  const split = splitRoster(props.seats, props.today);
  return (
    <div className="space-y-8">
      {split.serving.length > 0 ? (
        <RosterSection {...props} heading={PAGE.headings.serving} seats={split.serving} state="serving" />
      ) : null}
      {split.planned.length > 0 ? (
        <RosterSection {...props} heading={PAGE.headings.planned} seats={split.planned} state="planned" />
      ) : null}
      {split.past.length > 0 ? (
        <RosterSection {...props} heading={PAGE.headings.past} seats={split.past} state="past" />
      ) : null}
    </div>
  );
}
