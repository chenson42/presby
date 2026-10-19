"use client";

import { useState } from "react";
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
import { recordDeliveryAction, reissueStatementAction } from "./actions";

/**
 * The two per-statement actions beside the Download link: "Mark as mailed"
 * (logs a `print_mailed` delivery) and, for a latest statement a later gift or
 * refund has made out of date, "Issue corrected statement" (an AlertDialog; the
 * original is kept and marked superseded, never edited or deleted). Plain
 * `onClick` controls render disabled until hydrated (F129). Rendered only for a
 * `giving.manage` holder.
 */
export function StatementRowActions({
  slug,
  statementId,
  donorName,
  year,
  showMarkMailed,
  showReissue,
  issuingEnabled,
}: {
  slug: string;
  statementId: string;
  donorName: string;
  year: number;
  showMarkMailed: boolean;
  showReissue: boolean;
  issuingEnabled: boolean;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function markMailed() {
    setPending(true);
    const result = await recordDeliveryAction(slug, statementId);
    setPending(false);
    if (result.ok) {
      toast.success("Marked as mailed.");
      router.refresh();
    } else if (result.kind === "two_factor_required" && result.redirectTo) {
      window.location.assign(result.redirectTo);
    } else {
      toast.error(result.error);
    }
  }

  async function reissue() {
    setPending(true);
    setError(undefined);
    const result = await reissueStatementAction(slug, statementId);
    setPending(false);
    if (result.ok) {
      setOpen(false);
      toast.success("Corrected statement issued.");
      router.refresh();
    } else if (result.kind === "two_factor_required" && result.redirectTo) {
      window.location.assign(result.redirectTo);
    } else {
      setError(result.error);
    }
  }

  return (
    <>
      {showMarkMailed && (
        <Button type="button" variant="outline" className="min-h-11" disabled={!hydrated || pending} onClick={markMailed}>
          Mark as mailed
        </Button>
      )}
      {showReissue && issuingEnabled && (
        <AlertDialog
          open={open}
          onOpenChange={(next) => {
            if (pending) return;
            setOpen(next);
            if (!next) setError(undefined);
          }}
        >
          <AlertDialogTrigger asChild>
            <Button type="button" className="min-h-11" disabled={!hydrated}>
              Issue corrected statement
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Issue a corrected {year} statement?</AlertDialogTitle>
              <AlertDialogDescription>
                A gift or refund for {donorName} changed after their statement was issued. The corrected
                statement lists today&apos;s gifts and is titled &ldquo;Corrected statement, replaces
                statement dated&hellip;&rdquo;. The original is kept and marked as replaced; nothing is edited
                or deleted. You&apos;ll need to send or mail the corrected one.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Not yet</AlertDialogCancel>
              <Button type="button" className="min-h-11" disabled={pending} onClick={reissue}>
                {pending ? "Issuing…" : "Issue corrected statement"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
