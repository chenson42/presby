import { FormattedDate } from "@/components/shared/formatted-date";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FRAME_COPY, SUPPLY_CALL_TYPE_LABELS, VACANT_COPY } from "@/lib/presbytery-reports/copy";
import { formatVacancyLength, type VacantPulpitsData, type VacantRow } from "@/lib/presbytery-reports/derive";
import { ReportEmpty } from "./report-states";

function Since({ row }: { row: VacantRow }) {
  return row.vacantSince ? <FormattedDate value={row.vacantSince} mode="date" /> : <>{VACANT_COPY.noEarlierPastor}</>;
}

function timeVacant(row: VacantRow, today: string): string {
  return row.vacantSince ? formatVacancyLength(row.vacantSince, today) : "—";
}

function Supply({ row }: { row: VacantRow }) {
  if (!row.supply) return <>{VACANT_COPY.supplyNone}</>;
  return (
    <>
      {VACANT_COPY.supplySince(SUPPLY_CALL_TYPE_LABELS[row.supply.callType] ?? row.supply.callType)}{" "}
      <FormattedDate value={row.supply.startsOn} mode="date" />
    </>
  );
}

/**
 * Vacant pulpits: the honest empty states first (no member congregations; zero
 * appointments recorded, so no list at all; none vacant), then a card list
 * below `sm` and a table from `sm` up, both from the same rows. `display:none`
 * removes the hidden copy from the accessibility tree, so a screen reader reads
 * one.
 */
export function VacantPulpitsView({ data, slug }: { data: VacantPulpitsData; slug: string }) {
  if (data.rosterCount === 0) return <ReportEmpty title={FRAME_COPY.noMembers} />;
  if (!data.appointmentsRecorded) {
    return (
      <ReportEmpty
        title={VACANT_COPY.zeroAppointments.title}
        body={VACANT_COPY.zeroAppointments.body}
        action={{ href: `/o/${slug}/admin/credentials`, label: VACANT_COPY.zeroAppointments.action }}
      />
    );
  }
  if (data.rows.length === 0) {
    return <ReportEmpty title={VACANT_COPY.noneVacant.title} body={VACANT_COPY.noneVacant.body} />;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium" data-testid="vacant-count">
        {VACANT_COPY.count(data.rows.length, data.rosterCount)}
      </p>

      <ul data-testid="report-cards" className="space-y-3 sm:hidden">
        {data.rows.map((row) => (
          <li key={row.organizationId} className="rounded-lg border border-border p-4">
            <p className="break-words font-medium">{row.name}</p>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{VACANT_COPY.columns.vacantSince}</dt>
                <dd className="text-right">
                  <Since row={row} />
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{VACANT_COPY.columns.timeVacant}</dt>
                <dd className="text-right">{timeVacant(row, data.today)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{VACANT_COPY.columns.supply}</dt>
                <dd className="text-right">
                  <Supply row={row} />
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      <div data-testid="report-table" className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{VACANT_COPY.columns.congregation}</TableHead>
              <TableHead>{VACANT_COPY.columns.vacantSince}</TableHead>
              <TableHead>{VACANT_COPY.columns.timeVacant}</TableHead>
              <TableHead>{VACANT_COPY.columns.supply}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow key={row.organizationId}>
                <TableCell className="max-w-xs whitespace-normal break-words font-medium">{row.name}</TableCell>
                <TableCell>
                  <Since row={row} />
                </TableCell>
                <TableCell>{timeVacant(row, data.today)}</TableCell>
                <TableCell>
                  <Supply row={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
