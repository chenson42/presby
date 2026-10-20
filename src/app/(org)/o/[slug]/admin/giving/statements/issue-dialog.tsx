"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shared/use-hydrated";
import { issueFailureText } from "@/lib/giving/statements/copy";
import type { IssueFailureReason } from "@/lib/giving/statements/pure";
import { issueStatementBatchAction } from "./actions";

type Failure = { donorId: string; donorName: string; reason: IssueFailureReason };
type Phase = "confirm" | "running" | "done" | "error";

/**
 * Issue a year's statements - an AlertDialog (never a native confirm) that, once
 * confirmed, LOOPS over `issueStatementBatchAction` (25 donors a call, each in
 * its own transaction on the server) until the server says there is no cursor
 * left, showing real progress. docs/work-log/2026-10-15-online-giving.md,
 * Batch 5b.
 *
 * Why a client loop and not one long request: a congregation can have a few
 * hundred donors, a render and a database commit apiece; one request would
 * outlive a serverless time limit and show the treasurer nothing. A failure for
 * one donor never stops the run (it is listed at the end, by name and reason);
 * a failure of the call itself stops it with a message, and pressing Issue again
 * resumes - donors who already have a statement are not candidates.
 *
 * The dialog cannot be dismissed mid-run (the cancel button and the overlay are
 * inert), because closing it would not stop the loop and would hide its result.
 * The plain `onClick` trigger renders disabled until hydrated (F129).
 */
export function IssueStatementsDialog({
  slug,
  year,
  toIssue,
  alreadyIssued,
}: {
  slug: string;
  year: number;
  toIssue: number;
  alreadyIssued: number;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("confirm");
  const [issued, setIssued] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [error, setError] = useState<string | undefined>();
  const running = useRef(false);

  async function run() {
    if (running.current) return;
    running.current = true;
    setPhase("running");
    setError(undefined);
    let cursor: string | null = null;
    let totalIssued = issued;
    let totalSkipped = skipped;
    let allFailures = failures;
    try {
      for (;;) {
        const result = await issueStatementBatchAction(slug, { year, cursor });
        if (!result.ok) {
          if (result.kind === "two_factor_required" && result.redirectTo) {
            window.location.assign(result.redirectTo);
            return;
          }
          setError(result.error);
          setPhase("error");
          return;
        }
        totalIssued += result.data!.issued;
        totalSkipped += result.data!.skipped;
        allFailures = [...allFailures, ...result.data!.failed];
        setIssued(totalIssued);
        setSkipped(totalSkipped);
        setFailures(allFailures);
        cursor = result.data!.nextCursor;
        if (!cursor) break;
      }
      setPhase("done");
      toast.success(totalIssued === 1 ? "1 statement issued." : `${totalIssued} statements issued.`);
    } catch {
      setError("We lost the connection part way through. Nothing already issued is lost; press Issue again to continue.");
      setPhase("error");
    } finally {
      running.current = false;
      router.refresh();
    }
  }

  function close() {
    setOpen(false);
    setPhase("confirm");
    setIssued(0);
    setSkipped(0);
    setFailures([]);
    setError(undefined);
    router.refresh();
  }

  const done = issued + skipped + failures.length;
  const percent = toIssue > 0 ? Math.min(100, Math.round((done / toIssue) * 100)) : 0;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (phase === "running") return;
        if (next) setOpen(true);
        else close();
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" className="min-h-11" disabled={!hydrated}>
          Issue {toIssue === 1 ? "1 statement" : `${toIssue} statements`}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {phase === "done" ? "Statements issued" : `Issue ${year} statements?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {phase === "confirm" &&
              `This creates a statement for each of the ${toIssue} donors who don't have one yet${alreadyIssued > 0 ? ` (${alreadyIssued} already have one)` : ""}. An issued statement is frozen: it can't be edited, and if a gift changes later you issue a corrected version instead.`}
            {phase === "running" && "Issuing statements. Please keep this page open until it finishes."}
            {phase === "done" && "Every donor has been handled. Anything that needs your attention is listed below."}
            {phase === "error" && "The run stopped. Statements already issued are kept."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {phase !== "confirm" && (
          <div className="space-y-3" aria-live="polite">
            <div
              role="progressbar"
              aria-label="Statements issued"
              aria-valuemin={0}
              aria-valuemax={toIssue}
              aria-valuenow={Math.min(done, toIssue)}
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-sm" data-testid="issue-progress">
              {issued} issued
              {skipped > 0 ? `, ${skipped} skipped` : ""}
              {failures.length > 0 ? `, ${failures.length} need attention` : ""} of {toIssue}
            </p>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {failures.length > 0 && (
              <ul className="max-h-40 space-y-2 overflow-y-auto text-sm" data-testid="issue-failures">
                {failures.map((f) => (
                  <li key={f.donorId} className="rounded-md border border-border p-2">
                    <span className="font-medium">{f.donorName}</span>
                    <span className="block text-muted-foreground">{issueFailureText(f.reason)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <AlertDialogFooter>
          {phase === "confirm" && (
            <>
              <AlertDialogCancel>Not yet</AlertDialogCancel>
              <Button type="button" className="min-h-11" onClick={run}>
                Issue statements
              </Button>
            </>
          )}
          {phase === "running" && (
            <Button type="button" className="min-h-11" disabled>
              Issuing&hellip;
            </Button>
          )}
          {phase === "error" && (
            <>
              <AlertDialogCancel>Close</AlertDialogCancel>
              <Button type="button" className="min-h-11" onClick={run}>
                Issue again
              </Button>
            </>
          )}
          {phase === "done" && (
            <Button type="button" className="min-h-11" onClick={close}>
              Done
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
