"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CredentialStatusValue } from "@/lib/credentials";
import {
  CHANGEABLE_CREDENTIAL_STATUSES,
  CREDENTIAL_STATUS_LABELS,
} from "./credential-labels";
import { changeOrdinationStatusAction } from "./actions";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * The "Change status" control — a plain `Dialog` (not `AlertDialog`: this
 * is a routine, non-destructive record-keeping update, unlike "End
 * ordination"'s irreversible-reading confirm below it). Offers every
 * `credentialStatus` value EXCEPT `"removed"` — see `credential-labels.ts`'s
 * `CHANGEABLE_CREDENTIAL_STATUSES` for why. Never touches `endedOn`/
 * `endedReason` (Phase 3's named edge case; this file's sibling,
 * `end-ordination-dialog.tsx`, is the only other control on this row, and
 * it also never touches those fields — both call the same
 * `changeOrdinationStatusAction`, only the submitted `status` value
 * differs).
 */
export function ChangeStatusDialog({
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
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<CredentialStatusValue>(
    currentStatus === "removed" ? "active" : currentStatus,
  );
  const [minuteReference, setMinuteReference] = useState("");

  async function handleSubmit() {
    setPending(true);
    const result = await changeOrdinationStatusAction(slug, {
      ordinationId,
      personId,
      status,
      minuteReference: minuteReference || undefined,
    });
    setPending(false);
    if (result.ok) {
      toast.success(`${personName}'s ordination status updated.`);
      setOpen(false);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="min-h-11">
          Change status
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change {personName}&apos;s ordination status</DialogTitle>
          <DialogDescription>
            This records their current standing — it does not end their
            ordination. Ordination is lifelong; this changes only their
            status.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label htmlFor={`status-picker-${ordinationId}`}>Status</Label>
            <div className="relative mt-1">
              <select
                id={`status-picker-${ordinationId}`}
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as CredentialStatusValue)
                }
                className={SELECT_CLASSES}
              >
                {CHANGEABLE_CREDENTIAL_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {CREDENTIAL_STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
            </div>
          </div>
          <div>
            <Label htmlFor={`status-minute-${ordinationId}`}>
              Minute reference (optional)
            </Label>
            <Input
              id={`status-minute-${ordinationId}`}
              type="text"
              placeholder="e.g. Presbytery minutes, 12 Jan 2026"
              className="mt-1"
              value={minuteReference}
              onChange={(e) => setMinuteReference(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            className="min-h-11"
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={pending} className="min-h-11">
            {pending ? "Saving…" : "Save status"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
