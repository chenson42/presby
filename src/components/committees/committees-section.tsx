import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormattedDate } from "@/components/shared/formatted-date";
import { chairLine, servingLine } from "@/lib/committees/copy";
import type { CommitteeListRow } from "@/lib/committees/reads";
import { LIST } from "@/lib/committees/ui-copy";
import { CommitteeCard, committeeHref } from "./committee-card";
import { KindBadge } from "./kind-badge";

/**
 * One headed section of the list: cards below `sm`, a table at `sm` and above
 * (both are rendered; CSS shows one, so the hidden one is out of the tab order and
 * the accessibility tree). The kind badge is the section itself for a labelled
 * committee, so the table shows it only where the section is mixed (Dissolved).
 */
export function CommitteesSection({
  heading,
  note,
  rows,
  slug,
  showKind,
}: {
  heading: string;
  note?: string;
  rows: readonly CommitteeListRow[];
  slug: string;
  showKind?: boolean;
}) {
  return (
    <section aria-labelledby={`committees-${heading.replace(/\W+/g, "-").toLowerCase()}`} className="space-y-3">
      <div>
        <h2 id={`committees-${heading.replace(/\W+/g, "-").toLowerCase()}`} className="text-lg font-semibold">
          {heading}
        </h2>
        {note ? <p className="mt-1 text-sm text-muted-foreground">{note}</p> : null}
      </div>
      <ul className="space-y-3 sm:hidden">
        {rows.map((row) => (
          <CommitteeCard key={row.id} slug={slug} row={row} />
        ))}
      </ul>
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{LIST.tableHead.name}</TableHead>
              <TableHead>{LIST.tableHead.chair}</TableHead>
              <TableHead>{LIST.tableHead.serving}</TableHead>
              <TableHead>{LIST.tableHead.meets}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="max-w-xs whitespace-normal font-medium">
                  <Link
                    href={committeeHref(slug, row.id)}
                    className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [overflow-wrap:anywhere]"
                  >
                    {row.name}
                  </Link>
                  {showKind ? (
                    <span className="ml-2 inline-block align-middle">
                      <KindBadge kind={row.kind} />
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="whitespace-normal [overflow-wrap:anywhere]">
                  {row.dissolvedOn ? (
                    <span className="text-muted-foreground">
                      {LIST.dissolvedOn} <FormattedDate value={row.dissolvedOn} mode="date" />
                    </span>
                  ) : (
                    chairLine(row.chairNames)
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{row.dissolvedOn ? "" : servingLine(row.servingCount)}</TableCell>
                <TableCell className="whitespace-normal text-muted-foreground [overflow-wrap:anywhere]">
                  {row.meetsWhen ? LIST.meets(row.meetsWhen) : ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
