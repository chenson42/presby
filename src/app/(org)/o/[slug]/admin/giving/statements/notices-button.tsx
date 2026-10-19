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
import { sendStatementNoticesAction } from "./actions";

/**
 * "Email a notice" for a year's statements - an AlertDialog confirm, then a loop
 * over `sendStatementNoticesAction` (50 a call) until no cursor is left. The
 * email is a NOTICE only: it says a statement is ready and links to the member's
 * Giving page; it has no amounts, no gift detail and no attachment (R12 - the
 * statement's contents never enter the email queue). Only donors linked to a
 * member with an email are candidates. Plain `onClick` trigger: disabled until
 * hydrated (F129).
 */
export function SendNoticesButton({ slug, year, candidates }: { slug: string; year: number; candidates: number }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [sent, setSent] = useState(0);
  const running = useRef(false);

  async function run() {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError(undefined);
    let cursor: string | null = null;
    let total = 0;
    let failed = 0;
    try {
      for (;;) {
        const result = await sendStatementNoticesAction(slug, { year, cursor });
        if (!result.ok) {
          if (result.kind === "two_factor_required" && result.redirectTo) {
            window.location.assign(result.redirectTo);
            return;
          }
          setError(result.error);
          return;
        }
        total += result.data!.sent;
        failed += result.data!.failed;
        setSent(total);
        cursor = result.data!.nextCursor;
        if (!cursor) break;
      }
      if (failed > 0) toast.warning(`${total} notices sent. ${failed} could not be sent; try again.`);
      else toast.success(total === 1 ? "1 notice sent." : `${total} notices sent.`);
      setOpen(false);
      router.refresh();
    } catch {
      setError("We lost the connection part way through. Notices already sent are recorded; try again to send the rest.");
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) setError(undefined);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11" disabled={!hydrated}>
          Email a notice ({candidates})
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Email {candidates === 1 ? "1 notice" : `${candidates} notices`}?</AlertDialogTitle>
          <AlertDialogDescription>
            Each donor who is a linked member gets a short email saying their {year} statement is ready, with a
            link to their Giving page. The email shows no amounts and no gifts. The statement itself is never
            emailed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {pending && (
          <p className="text-sm" aria-live="polite" data-testid="notice-progress">
            {sent} sent&hellip;
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Not yet</AlertDialogCancel>
          <Button type="button" className="min-h-11" disabled={pending} onClick={run}>
            {pending ? "Sending…" : "Send notices"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
