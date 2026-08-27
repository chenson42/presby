import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { OrdinationEntry } from "@/lib/credentials";
import { MINISTRY_LABELS, CREDENTIAL_STATUS_LABELS } from "./credential-labels";
import { ChangeStatusDialog } from "./change-status-dialog";
import { EndOrdinationDialog } from "./end-ordination-dialog";

/**
 * "Who holds a ministry credential and its current status" — a `Table`,
 * same mobile-legibility rationale `../officers/officer-roster.tsx`
 * documents for the equivalent surface (this is genuinely wide-column
 * data: person / ministry / ordained / status / minute reference /
 * actions).
 *
 * THE STATUS-VS-REMOVAL DISTINCTION IS THE WHOLE POINT OF THIS ROW (Phase
 * 3's named edge case): the Badge always shows the CURRENT `status` value
 * (never "ended"/"active" derived from `endedOn`), and the row renders TWO
 * separate action buttons — "Change status" and "End ordination" — never
 * one control that could be mistaken for the other. A `removed` badge uses
 * the destructive variant so it visually differs from every other status,
 * since it is the one state a clerk cannot casually undo by picking a
 * different option in the same picker.
 *
 * A Server Component (read-only data), same shape as `officer-roster.tsx`
 * — it embeds two client dialogs per row without itself needing
 * `'use client'`.
 */
export function OrdinationList({
  entries,
  slug,
}: {
  entries: OrdinationEntry[];
  slug: string;
}) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">No ordinations recorded yet</p>
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
          <TableHead>Ministry</TableHead>
          <TableHead className="hidden sm:table-cell">Ordained</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="hidden sm:table-cell">
            Minute reference
          </TableHead>
          <TableHead className="sr-only">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.ordinationId}>
            <TableCell className="max-w-[6rem] whitespace-normal font-medium sm:max-w-none sm:whitespace-nowrap">
              {entry.displayName}
            </TableCell>
            <TableCell className="max-w-[6rem] whitespace-normal sm:max-w-none sm:whitespace-nowrap">
              {MINISTRY_LABELS[entry.ministry]}
            </TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">
              <FormattedDate value={entry.ordainedOn} mode="date" />
            </TableCell>
            <TableCell>
              <Badge variant={entry.status === "removed" ? "destructive" : "secondary"}>
                {CREDENTIAL_STATUS_LABELS[entry.status]}
              </Badge>
            </TableCell>
            <TableCell className="hidden text-muted-foreground sm:table-cell">
              {entry.minuteReference ?? "—"}
            </TableCell>
            <TableCell>
              <div className="flex flex-col gap-2 sm:flex-row">
                <ChangeStatusDialog
                  slug={slug}
                  ordinationId={entry.ordinationId}
                  personId={entry.personId}
                  personName={entry.displayName}
                  currentStatus={entry.status}
                />
                <EndOrdinationDialog
                  slug={slug}
                  ordinationId={entry.ordinationId}
                  personId={entry.personId}
                  personName={entry.displayName}
                  currentStatus={entry.status}
                />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
