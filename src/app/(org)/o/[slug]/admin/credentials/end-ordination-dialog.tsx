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
import type { CredentialStatusValue } from "@/lib/credentials";
import { changeOrdinationStatusAction } from "./actions";

/**
 * "End ordination" — the rare, true-removal control, deliberately SEPARATE
 * from "Change status" (Phase 3's named edge case: the two must never read
 * as one dropdown mixing action classes). `AlertDialog`, never `confirm()`
 * (Workflow Rule 2), modeled on `../officers/end-term-dialog.tsx`: names the
 * person and states the consequence plainly rather than a generic "Are you
 * sure?".
 *
 * Submits `changeOrdinationStatusAction` with `status: "removed"` — the
 * SAME server action `change-status-dialog.tsx` uses, per
 * `src/lib/credentials.ts`'s header. `endedOn`/`endedReason` are never
 * touched by either control.
 */
export function EndOrdinationDialog({
  slug,
  ordinationId,
  personId,
  personName,
  currentStatus,
}: {
  slug: string;
  ordinationId: string;
  personId: string;
  personName: string;
  currentStatus: CredentialStatusValue;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleConfirm() {
    setPending(true);
    const result = await changeOrdinationStatusAction(slug, {
      ordinationId,
      personId,
      status: "removed",
    });
    setPending(false);
    if (result.ok) {
      toast.success(`${personName}'s ordination has been ended.`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  if (currentStatus === "removed") {
    return null;
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="min-h-11">
          End ordination
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>End {personName}&apos;s ordination?</AlertDialogTitle>
          <AlertDialogDescription>
            This person will no longer show as ordained — this cannot be
            represented as retirement or leave. Use &quot;Change status&quot;
            instead for honorable retirement, on-leave, or discipline. This
            action stays on record; it is not a delete.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Ending…" : "Yes, end ordination"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
