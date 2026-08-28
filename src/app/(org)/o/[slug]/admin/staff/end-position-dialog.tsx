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
import { RequiredMark } from "@/components/shared/required-mark";
import { endStaffPositionAction } from "./actions";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface EndPositionDialogProps {
  slug: string;
  positionId: string;
  personId: string;
  position: string;
  personName: string;
  /** 'YYYY-MM-DD' — used only as the end-date input's `min`, so an obviously
   * impossible date never gets past the browser's own picker. The server
   * (`endStaffPosition`) is still the authoritative check. */
  startsOn: string;
}

/**
 * Ends an existing staff position — NEVER a delete (Phase 1/2/3, "soft-end,
 * matching officer_terms" — `endStaffPosition()` only sets `endsOn`/
 * `endReason` on the row). `AlertDialog`, never `confirm()` (CLAUDE.md
 * Workflow Rule 2), modeled directly on `admin/officers/end-term-dialog.tsx`:
 * names BOTH the person and the position in the confirmation copy, never a
 * generic "Are you sure?".
 *
 * `endReason` IS A PLAIN TEXT INPUT, NOT A FIXED-OPTION `<select>` — unlike
 * `officer_terms.end_reason`, `staff_positions.end_reason`
 * (`src/lib/db/domain/staff.ts`) documents no conventional value set
 * (officer_terms's own column comment names "completed | resigned | removed
 * | deceased"; staff's carries no equivalent convention). Inventing a
 * taxonomy Phase 3's design never specified would be UI-layer scope creep;
 * free text mirrors the column's own genuinely-open shape.
 *
 * ALSO NAMES THE ROLE_GRANTS/OFFICER_TERMS SEPARATION (Phase 1's own
 * framing, Edge Cases & Risks) — same spot `officers/page.tsx` says the
 * equivalent for officer terms.
 *
 * `endReason` IS REQUIRED (`EndStaffPositionInput.endReason: string`, not
 * optional, per `src/lib/staff.ts`'s own contract) — the confirm button
 * stays disabled until a non-blank reason is entered, rather than silently
 * substituting a placeholder value the record would carry forever.
 */
export function EndPositionDialog({
  slug,
  positionId,
  personId,
  position,
  personName,
  startsOn,
}: EndPositionDialogProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [endsOn, setEndsOn] = useState(today);
  const [endReason, setEndReason] = useState("");

  async function handleConfirm() {
    setPending(true);
    const result = await endStaffPositionAction(slug, {
      positionId,
      endsOn,
      endReason: endReason.trim(),
      personId,
      position,
    });
    setPending(false);
    if (result.ok) {
      toast.success(`${position} position ended for ${personName}.`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="min-h-11">
          End position
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            End {personName}&apos;s position as {position}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This sets an end date on the existing position — it stays on
            record, it is not deleted. Granting or removing software access,
            if any, is a separate step (Administration → Roles) — ending a
            position here does not by itself change what {personName} can do
            in the app.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor={`end-position-ends-on-${positionId}`}>
              End date
            </Label>
            <Input
              id={`end-position-ends-on-${positionId}`}
              type="date"
              min={startsOn}
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor={`end-position-reason-${positionId}`}>
              Reason
              <RequiredMark />
            </Label>
            <Input
              id={`end-position-reason-${positionId}`}
              type="text"
              placeholder="e.g. Resigned, position eliminated"
              aria-required="true"
              value={endReason}
              onChange={(e) => setEndReason(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending || endReason.trim().length === 0}
          >
            {pending ? "Ending…" : `Yes, end this position`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
