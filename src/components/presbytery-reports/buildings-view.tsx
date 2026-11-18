import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBuildingType, formatCondition, formatInteger, formatTriState } from "@/lib/oversight/derive";
import { BUILDINGS_COPY, FRAME_COPY } from "@/lib/presbytery-reports/copy";
import type { BuildingsData, BuildingsRow } from "@/lib/presbytery-reports/oversight-derive";
import { ReportEmpty } from "./report-states";

const C = BUILDINGS_COPY.columns;

/** "None in use" when every recorded building is retired, "Not recorded" when none ever was (the oversight list's wording). */
export function noBuildingText(row: Pick<BuildingsRow, "buildingsRetired">): string {
  return row.buildingsRetired > 0 ? BUILDINGS_COPY.noneInUse : BUILDINGS_COPY.notRecorded;
}

const place = (row: BuildingsRow) => [row.city, row.county].filter((v): v is string => v !== null && v !== "").join(", ");

/** The detail facts of one building, in column order, as label/value pairs (a missing figure reads "Not recorded"). */
function facts(row: BuildingsRow): Array<[string, string]> {
  const b = row.building;
  if (!b) return [];
  return [
    [C.type, formatBuildingType(b.buildingType)],
    [C.yearBuilt, b.yearBuilt === null ? BUILDINGS_COPY.notRecorded : String(b.yearBuilt)],
    [C.squareFeet, b.squareFeet === null ? BUILDINGS_COPY.notRecorded : formatInteger(b.squareFeet)],
    [C.roof, formatCondition(b.roofCondition)],
    [C.plumbing, formatCondition(b.plumbingCondition)],
    [C.hvac, formatCondition(b.hvacCondition)],
    [C.boiler, formatCondition(b.boilerCondition)],
    [C.sprinklers, formatTriState(b.hasSprinklers)],
    [C.fireAlarm, formatTriState(b.hasFireAlarm)],
    [C.security, formatTriState(b.hasSecuritySystem)],
  ];
}

const rowKey = (row: BuildingsRow) => `${row.organizationId}:${row.building?.id ?? "none"}`;

export function BuildingsView({ data }: { data: BuildingsData }) {
  if (data.rosterCount === 0) return <ReportEmpty title={FRAME_COPY.noMembers} />;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {BUILDINGS_COPY.count(data.buildingCount, data.rosterCount - data.withoutBuildings)}
      </p>

      <ul data-testid="report-cards" className="space-y-3 sm:hidden">
        {data.rows.map((row) => (
          <li key={rowKey(row)} className="rounded-lg border border-border p-4">
            <p className="break-words font-medium">{row.name}</p>
            {place(row) ? <p className="break-words text-sm text-muted-foreground">{place(row)}</p> : null}
            {row.building ? (
              <>
                <p className="mt-2 flex flex-wrap items-center gap-2 break-words text-sm font-medium">
                  <span>{row.building.name}</span>
                  {row.building.isPrimary ? <Badge variant="secondary">{BUILDINGS_COPY.primaryBadge}</Badge> : null}
                </p>
                <dl className="mt-2 space-y-1 text-sm">
                  {facts(row).map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-3">
                      <dt className="min-w-0 text-muted-foreground">{label}</dt>
                      <dd className="max-w-[60%] shrink-0 text-right">{value}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <p className="mt-2 text-sm">{noBuildingText(row)}</p>
            )}
          </li>
        ))}
      </ul>

      <div data-testid="report-table" className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{C.congregation}</TableHead>
              <TableHead>{C.city}</TableHead>
              <TableHead>{C.county}</TableHead>
              <TableHead>{C.building}</TableHead>
              <TableHead>{C.type}</TableHead>
              <TableHead>{C.yearBuilt}</TableHead>
              <TableHead>{C.squareFeet}</TableHead>
              <TableHead>{C.roof}</TableHead>
              <TableHead>{C.plumbing}</TableHead>
              <TableHead>{C.hvac}</TableHead>
              <TableHead>{C.boiler}</TableHead>
              <TableHead>{C.sprinklers}</TableHead>
              <TableHead>{C.fireAlarm}</TableHead>
              <TableHead>{C.security}</TableHead>
              <TableHead>{C.primary}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => {
              const b = row.building;
              return (
                <TableRow key={rowKey(row)}>
                  <TableCell className="max-w-xs whitespace-normal break-words font-medium">{row.name}</TableCell>
                  <TableCell>{row.city ?? BUILDINGS_COPY.blank}</TableCell>
                  <TableCell>{row.county ?? BUILDINGS_COPY.blank}</TableCell>
                  {b ? (
                    <>
                      <TableCell className="max-w-xs whitespace-normal break-words">{b.name}</TableCell>
                      {facts(row).map(([label, value]) => (
                        <TableCell key={label}>{value}</TableCell>
                      ))}
                      <TableCell>{b.isPrimary ? "Yes" : "No"}</TableCell>
                    </>
                  ) : (
                    <TableCell colSpan={12}>{noBuildingText(row)}</TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
