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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHydrated } from "@/components/shared/use-hydrated";
import type { PendingRollAction } from "@/lib/roll";
import { approveRollActionsAction, type ApproveRollActionsData } from "./actions";
import { DECISION_SUCCESS_COPY } from "./decision-copy";
import { toastBulk } from "./decision-toasts";

/**
 * Bulk approve (R18): the trigger is the sticky "Approve N selected" button.
 * At most 50 per submit, one transaction per row on the server, so the result
 * is "N approved, M need attention" and the dialog stays open on a partial
 * result to list each name with its own reason. A fully approved run closes
 * the dialog. `onDone` clears the selection once the dialog is dismissed.
 */
export function BulkApproveDialog({
  slug,
  selected,
  onDone,
}: {
  slug: string;
  selected: PendingRollAction[];
  onDone: () => void;
}) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [minute, setMinute] = useState("");
  const [result, setResult] = useState<{
    data: ApproveRollActionsData;
    names: Record<string, string>;
  } | null>(null);

  const count = selected.length;

  function handleOpenChange(next: boolean) {
    if (!next && pending) return;
    setOpen(next);
    if (next) {
      setMinute("");
      setResult(null);
    } else if (result) {
      onDone();
    }
  }

  async function confirm() {
    const names = Object.fromEntries(
      selected.map((a) => [a.id, a.personDisplayName]),
    );
    setPending(true);
    try {
      const res = await approveRollActionsAction(slug, {
        rollActionIds: selected.map((a) => a.id),
        minuteReference: minute.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.data) {
        toastBulk(res.data);
        router.refresh();
        if (res.data.failed.length === 0) {
          setOpen(false);
          onDone();
        } else {
          setResult({ data: res.data, names });
        }
      }
    } catch {
      toast.error(DECISION_SUCCESS_COPY.genericFailure);
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          className="min-h-11 w-full sm:w-auto"
          disabled={!hydrated || count === 0}
        >
          Approve {count} selected
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        {result ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {result.data.approved} approved, {result.data.failed.length}{" "}
                need attention
              </AlertDialogTitle>
              <AlertDialogDescription>
                These were not approved. Open each one to approve, deny or
                withdraw it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="space-y-2 text-sm" data-testid="bulk-attention">
              {result.data.failed.map((f) => (
                <li key={f.rollActionId} className="break-words">
                  <span className="font-medium">
                    {result.names[f.rollActionId] ?? "This roll action"}
                  </span>
                  : {f.error}
                </li>
              ))}
            </ul>
            <AlertDialogFooter>
              <AlertDialogCancel className="min-h-11">Close</AlertDialogCancel>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Approve {count} roll {count === 1 ? "action" : "actions"}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Each one is approved and recorded separately. If one
                can&apos;t be approved, the others still are.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div>
              <Label htmlFor="bulk-minute-ref">
                Minute reference (optional, applies to all)
              </Label>
              <Input
                id="bulk-minute-ref"
                value={minute}
                maxLength={200}
                autoComplete="off"
                onChange={(e) => setMinute(e.target.value)}
                className="mt-1 min-h-11"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending} className="min-h-11">
                Cancel
              </AlertDialogCancel>
              <Button
                type="button"
                className="min-h-11"
                disabled={pending || count === 0}
                onClick={confirm}
              >
                {pending ? "Approving…" : `Approve ${count}`}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
