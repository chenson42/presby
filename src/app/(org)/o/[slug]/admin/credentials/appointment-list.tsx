import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { AppointmentEntry } from "@/lib/credentials";
import { CALL_TYPE_LABELS } from "./credential-labels";
import { EndAppointmentDialog } from "./end-appointment-dialog";

/**
 * "Who serves as pastor at a member congregation" — a `Table`, same
 * mobile-legibility rationale `ordination-list.tsx`/`../officers/
 * officer-roster.tsx` document (person / serving at / call type / since /
 * ends / actions is genuinely wide-column data).
 *
 * A current (open-ended) appointment shows an "End appointment" action;
 * a historical one (`endsOn` set) shows only its end date, no action — the
 * same "no-delete, start/end only" discipline `officer-roster.tsx`'s
 * `EndTermDialog` documents, applied here to `appointments`.
 *
 * A Server Component (read-only data) — embeds a client dialog per open
 * row without itself needing `'use client'`.
 */
export function AppointmentList({
  entries,
  slug,
}: {
  entries: AppointmentEntry[];
  slug: string;
}) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No appointments recorded yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Use the form below to record the first one.
        </p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Person</TableHead>
          <TableHead>Serving at</TableHead>
          <TableHead className="hidden sm:table-cell">Call type</TableHead>
          <TableHead>Since</TableHead>
          <TableHead>Ends</TableHead>
          <TableHead className="sr-only">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.appointmentId}>
            <TableCell className="max-w-[6rem] whitespace-normal font-medium sm:max-w-none sm:whitespace-nowrap">
              {entry.displayName}
            </TableCell>
            <TableCell className="max-w-[6rem] whitespace-normal sm:max-w-none sm:whitespace-nowrap">
              {entry.servingOrgName}
            </TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">
              {CALL_TYPE_LABELS[entry.callType]}
            </TableCell>
            <TableCell>
              <FormattedDate value={entry.startsOn} mode="date" />
            </TableCell>
            <TableCell className="text-muted-foreground">
              {entry.endsOn ? (
                <FormattedDate value={entry.endsOn} mode="date" />
              ) : (
                "—"
              )}
            </TableCell>
            <TableCell>
              {entry.endsOn === null && (
                <EndAppointmentDialog
                  slug={slug}
                  appointmentId={entry.appointmentId}
                  personId={entry.personId}
                  servingOrgId={entry.servingOrgId}
                  personName={entry.displayName}
                  servingOrgName={entry.servingOrgName}
                  startsOn={entry.startsOn}
                />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
