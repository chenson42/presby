"use client";

import { useState } from "react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { withdrawFilingAction } from "./actions";

/**
 * Same bound as `src/lib/filings.ts`'s own `MINUTE_REFERENCE_MAX` —
 * duplicated BY VALUE, not by import: `filings.ts` is `import "server-only"`-
 * marked (it opens the Neon pool transitively via `withOrgContext`), and
 * importing ANYTHING from it — even a plain numeric constant — poisons this
 * `'use client'` module's entire bundle (Next.js's own enforcement: "'server-
 * only' cannot be imported from a Client Component module," discovered live
 * during Batch C's browser rehearsal, see the work-log's Implementer Notes).
 * `filings.ts`'s own header already documents this exact per-module-
 * duplication convention for a single shared constant.
 */
const MINUTE_REFERENCE_MAX = 500;

interface WithdrawDialogProps {
  slug: string;
  publicationId: string;
  reportYear: number;
}

/**
 * Withdraws a published statistical return — DECISION-152. `AlertDialog`,
 * never `confirm()` (Workflow Rule 2), modeled directly on
 * `../officers/end-term-dialog.tsx`'s "AlertDialog with a required text
 * field, not a one-click confirm" shape: this act, like ending a term, is
 * permanent and always carries a minute reference, so there is no sensible
 * one-click confirm with no input.
 *
 * `withdrawFilingAction`'s server-mapped error copy (forbidden /
 * invalid_target / already_withdrawn / superseded / zod's own message, per
 * the API contract Batch B handed off) surfaces via `toast.error(result.error)`
 * verbatim — the same discipline `EndTermDialog`/`RevokeDialog` already use.
 *
 * The ONLY `'use client'` file in this route (Phase 2 ruling 1e).
 */
export function WithdrawDialog({ slug, publicationId, reportYear }: WithdrawDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [minuteReference, setMinuteReference] = useState("");

  const trimmed = minuteReference.trim();
  const isValid = trimmed.length > 0 && trimmed.length <= MINUTE_REFERENCE_MAX;

  async function handleConfirm() {
    if (!isValid) return;
    setPending(true);
    const result = await withdrawFilingAction(slug, {
      publicationId,
      minuteReference: trimmed,
    });
    setPending(false);
    if (result.ok) {
      toast.success(`${reportYear} filing withdrawn.`);
      setOpen(false);
      setMinuteReference("");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setMinuteReference("");
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="min-h-11">
          Withdraw
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Withdraw the {reportYear} filing?</AlertDialogTitle>
          <AlertDialogDescription>
            This withdrawal is permanent — it can be neither reversed, re-dated
            nor re-minuted. Your presbytery will see this filing marked
            withdrawn, with the date and the minute reference you enter below.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2 py-2">
          <Label htmlFor={`withdraw-minute-reference-${publicationId}`}>
            Minute reference
          </Label>
          <Input
            id={`withdraw-minute-reference-${publicationId}`}
            value={minuteReference}
            onChange={(e) => setMinuteReference(e.target.value)}
            maxLength={MINUTE_REFERENCE_MAX}
            placeholder="e.g. Session minutes, 2026-09-14, item 4"
            autoComplete="off"
          />
          <p className="text-sm text-muted-foreground">
            Required — cite the council action authorizing this withdrawal.
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending || !isValid}
          >
            {pending ? "Withdrawing…" : "Yes, withdraw this filing"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
