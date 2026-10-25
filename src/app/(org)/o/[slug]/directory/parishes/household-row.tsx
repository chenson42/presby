import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { CONNECTION_LABELS } from "@/lib/community-labels";
import type { ParishHouseholdRow } from "@/lib/parishes";

/**
 * One household on a parish surface (district page, Unassigned page): the
 * household's name, its current people each with a connection badge, and - as
 * `children` - the move/assign control for a viewer who may use it.
 *
 * A CARD, not a table row, so it reads at 360px. Server-rendered and
 * prop-driven. Names arrive ALREADY MASKED by `src/lib/parishes.ts`
 * (`Private` for a directory-hidden person the viewer may not see): this
 * component never re-derives privacy, and receives no id, contact detail,
 * birthday, photo or address to show. `break-words` throughout so a long name
 * wraps.
 */
export function HouseholdRow({
  household,
  children,
}: {
  household: ParishHouseholdRow;
  children?: ReactNode;
}) {
  return (
    <li
      className="rounded-lg border border-border bg-card p-4"
      data-testid="household-row"
      data-household-id={household.householdId}
    >
      <h3 className="text-base font-semibold break-words">{household.name}</h3>
      {household.people.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">No one current is listed.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {household.people.map((person, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="break-words">{person.name}</span>
              <Badge variant="secondary">{CONNECTION_LABELS[person.connection]}</Badge>
            </li>
          ))}
        </ul>
      )}
      {children ? <div className="mt-3">{children}</div> : null}
    </li>
  );
}
