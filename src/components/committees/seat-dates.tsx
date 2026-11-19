import { FormattedDate } from "@/components/shared/formatted-date";
import { seatDateLinePrefix } from "@/lib/committees/copy";
import { seatDatesText } from "@/lib/committees/derive";
import type { SeatRow } from "@/lib/committees/reads";

/** A seat's date lines ("Since", "Starts", "Ends", "Started", "Ended", "Ended the day it started"), one per line. */
export function SeatDates({ seat, today }: { seat: Pick<SeatRow, "startsOn" | "endsOn">; today: string }) {
  const lines = seatDatesText(seat, today);
  return (
    <>
      {lines.map((line) => (
        <span key={line.kind} className="block text-sm text-muted-foreground">
          {line.kind === "zero_length" ? (
            "Ended the day it started"
          ) : (
            <>
              {seatDateLinePrefix(line)} <FormattedDate value={line.date} mode="date" />
            </>
          )}
        </span>
      ))}
    </>
  );
}
