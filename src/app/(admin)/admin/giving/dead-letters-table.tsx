"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormattedDate } from "@/components/shared/formatted-date";
import { useHydrated } from "@/components/shared/use-hydrated";
import type { DeadLetterRow } from "@/lib/admin/giving-ingest-health";
import { requeueDeadLetterAction } from "./actions";

/**
 * Dead-lettered payment notices, with the operator's Requeue control -
 * docs/work-log/2026-10-15-online-giving.md, Batch 3b. A dead letter is an
 * event presby gave up on (eight failed attempts, or a body Stripe no longer
 * has). Requeue moves it back to the queue with its attempts reset; the next
 * cron run retries it. It is the operator's act, so it asks first in an
 * `AlertDialog` (never a native confirm) and is audited server-side.
 *
 * Counts, ids, a type, a time and a short error CODE only: nothing a donor
 * wrote and nothing about money.
 */
export function DeadLettersTable({
  rows,
  names,
}: {
  rows: DeadLetterRow[];
  names: Record<string, string>;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [target, setTarget] = useState<DeadLetterRow | null>(null);
  const [pending, setPending] = useState(false);

  async function requeue() {
    if (!target) return;
    setPending(true);
    const result = await requeueDeadLetterAction(target.eventId);
    setPending(false);
    setTarget(null);
    if (result.ok) {
      toast.success("Event requeued. It will be retried on the next run.");
    } else {
      toast.error(result.error);
    }
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-10 text-center" data-testid="dead-letters-empty">
        <p className="text-sm font-medium">No dead letters</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Every payment notice has been applied or is still being retried. Anything presby gives up on appears here.
        </p>
      </div>
    );
  }

  return (
    <>
      <Table data-testid="dead-letters-table">
        <caption className="sr-only">Payment notices presby gave up on</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Organization</TableHead>
            <TableHead>Event type</TableHead>
            <TableHead>Stripe event</TableHead>
            <TableHead>Received</TableHead>
            <TableHead className="text-right">Attempts</TableHead>
            <TableHead>Why it failed</TableHead>
            <TableHead>
              <span className="sr-only">Action</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.eventId} data-testid="dead-letter-row">
              <TableCell className="font-medium">
                <Link href={`/admin/organizations/${row.organizationId}`} className="underline">
                  {names[row.organizationId] ?? "Unknown organization"}
                </Link>
              </TableCell>
              <TableCell>{row.eventType}</TableCell>
              <TableCell className="font-mono text-sm">{row.externalEventId}</TableCell>
              <TableCell>{row.receivedAt ? <FormattedDate value={row.receivedAt} mode="datetime" /> : "–"}</TableCell>
              <TableCell className="text-right tabular-nums">{row.attempts}</TableCell>
              <TableCell>{row.lastErrorClass ?? "unknown"}</TableCell>
              <TableCell className="text-right">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-11"
                  disabled={!hydrated || pending}
                  onClick={() => setTarget(row)}
                  aria-label={`Requeue ${row.externalEventId}`}
                >
                  Requeue
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <AlertDialog open={target !== null} onOpenChange={(open) => !open && !pending && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Requeue this event?</AlertDialogTitle>
            <AlertDialogDescription>
              {target ? (
                <>
                  <span className="font-mono">{target.externalEventId}</span> ({target.eventType}) goes back to the queue
                  with its attempts reset and is retried on the next run. If it fails the same way again it returns here
                  after eight attempts. This is recorded in the audit log.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                void requeue();
              }}
            >
              {pending ? "Requeuing…" : "Requeue event"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
