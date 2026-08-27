"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
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
import type { OfficerOffice } from "@/lib/officers";
import { OFFICE_LABELS } from "./office-labels";
import { endOfficerTermAction } from "./actions";

const END_REASONS = [
  { value: "completed", label: "Completed" },
  { value: "resigned", label: "Resigned" },
  { value: "removed", label: "Removed" },
  { value: "deceased", label: "Deceased" },
] as const;

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface EndTermDialogProps {
  slug: string;
  termId: string;
  personId: string;
  office: OfficerOffice;
  personName: string;
  /** 'YYYY-MM-DD' — used only as the end-date input's `min`, so an obviously
   * impossible date never gets past the browser's own picker. The server
   * (`endOfficerTerm`) is still the authoritative check. */
  startsOn: string;
}

/**
 * Ends an existing officer term — NEVER a delete (Phase 2/3, "no delete,
 * ever — start/end only"). `AlertDialog`, never `confirm()` (Workflow Rule
 * 2), modeled directly on `admin/roles/revoke-dialog.tsx`: names BOTH the
 * person and the office in the confirmation copy, never a generic "Are you
 * sure?".
 *
 * UNLIKE `RevokeDialog`, this confirm also collects two small fields (end
 * date, end reason) — `officer_terms.ends_on`/`end_reason` are always set
 * together, so there is no sensible one-click confirm with no input.
 *
 * `endOfficerTermAction`'s server-mapped error copy (forbidden /
 * invalid_target / invalid_input, per Phase 3's API-contract table) surfaces
 * via `toast.error(result.error)` verbatim — same discipline
 * `RevokeDialog`'s own header documents for `self_lockout_blocked`.
 */
export function EndTermDialog({
  slug,
  termId,
  personId,
  office,
  personName,
  startsOn,
}: EndTermDialogProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [endsOn, setEndsOn] = useState(today);
  const [endReason, setEndReason] = useState<(typeof END_REASONS)[number]["value"]>(
    "completed",
  );

  const officeLabel = OFFICE_LABELS[office];

  async function handleConfirm() {
    setPending(true);
    const result = await endOfficerTermAction(slug, {
      termId,
      endsOn,
      endReason,
      personId,
      office,
    });
    setPending(false);
    if (result.ok) {
      toast.success(`${officeLabel} term ended for ${personName}.`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="min-h-11">
          End term
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            End {personName}&apos;s term as {officeLabel}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This sets an end date on the existing term — it stays on record,
            it is not deleted. Session/Diaconate access, if any, drops the
            day the term does.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor={`end-term-ends-on-${termId}`}>End date</Label>
            <Input
              id={`end-term-ends-on-${termId}`}
              type="date"
              min={startsOn}
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor={`end-term-reason-${termId}`}>Reason</Label>
            <div className="relative mt-1">
              <select
                id={`end-term-reason-${termId}`}
                value={endReason}
                onChange={(e) =>
                  setEndReason(
                    e.target.value as (typeof END_REASONS)[number]["value"],
                  )
                }
                className={SELECT_CLASSES}
              >
                {END_REASONS.map((reason) => (
                  <option key={reason.value} value={reason.value}>
                    {reason.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
            </div>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Ending…" : `Yes, end ${officeLabel} term`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
