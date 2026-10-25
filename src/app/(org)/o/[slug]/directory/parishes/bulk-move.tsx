"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useHydrated } from "@/components/shared/use-hydrated";
import { BULK_MOVE_MAX } from "@/lib/parishes-pure";
import { bulkMoveAction } from "./[orgUnitId]/actions";
import {
  BULK_TOO_MANY_COPY,
  bulkConfirmBodyCopy,
  bulkConfirmTailCopy,
  bulkSuccessCopy,
  householdsLabel,
} from "./parish-copy";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

type Target = { orgUnitId: string; name: string; deaconName: string | null };

/**
 * "Move all N households to..." for an ARCHIVED district (copy C5;
 * DECISION-245): two steps, a `Dialog` to pick the destination and an
 * `AlertDialog` to confirm. No native dialog (Workflow Rule 2).
 *
 * The request carries NO household ids: it names the source, the target and the
 * count the viewer saw (`expectedCount`). The server re-derives the set, so a
 * household moved by someone else in the meantime is counted as `skipped`, not
 * moved twice, and a set that GREW (a restore and a re-archive) is refused
 * outright. Over `BULK_MOVE_MAX` there is no picker at all - a message says
 * they can't be moved all at once (single moves are unlimited) - because the
 * server refuses rather than truncates. There is no bulk
 * Undo; the confirmation says so. The trigger is disabled until the page has
 * hydrated (DECISION-159). The picker is a controlled select INSIDE a dialog
 * that mounts after hydration, so it carries no pre-hydration divergence, and it
 * commits nothing: the destination is only a choice until Confirm.
 */
export function BulkMove({
  slug,
  source,
  count,
  targets,
}: {
  slug: string;
  source: { orgUnitId: string; name: string };
  count: number;
  targets: Target[];
}) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [step, setStep] = useState<"closed" | "pick" | "confirm">("closed");
  const [targetId, setTargetId] = useState("");
  const [pending, setPending] = useState(false);

  if (count > BULK_MOVE_MAX) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="bulk-over-cap">
        {BULK_TOO_MANY_COPY}
      </p>
    );
  }
  if (count < 1) return null;

  const target = targets.find((t) => t.orgUnitId === targetId) ?? null;

  async function confirm() {
    if (!target) return;
    setPending(true);
    try {
      const result = await bulkMoveAction(slug, {
        sourceOrgUnitId: source.orgUnitId,
        targetOrgUnitId: target.orgUnitId,
        expectedCount: count,
      });
      if (result.ok && result.data) {
        toast.success(bulkSuccessCopy(result.data.moved, result.data.skipped, result.data.toName));
      } else if (!result.ok) {
        toast.error(result.error);
      }
      setStep("closed");
      router.refresh();
    } catch {
      toast.error("Could not move the households. Nothing was changed.");
      setStep("closed");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        className="min-h-11 w-full sm:w-auto"
        disabled={!hydrated || targets.length === 0}
        onClick={() => {
          setTargetId("");
          setStep("pick");
        }}
      >
        Move all {householdsLabel(count)} to…
      </Button>

      <Dialog open={step === "pick"} onOpenChange={(open) => setStep(open ? "pick" : "closed")}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Move {householdsLabel(count)}</DialogTitle>
            <DialogDescription className="break-words">
              Choose where {source.name}&apos;s households should go.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="bulk-move-target">Move to</Label>
            <div className="relative mt-1">
              <select
                id="bulk-move-target"
                value={targetId}
                onChange={(event) => setTargetId(event.target.value)}
                className={SELECT_CLASSES}
              >
                <option value="">Choose a district…</option>
                {targets.map((t) => (
                  <option key={t.orgUnitId} value={t.orgUnitId}>
                    {t.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => setStep("closed")}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="min-h-11"
              disabled={!target}
              onClick={() => setStep("confirm")}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={step === "confirm"}
        onOpenChange={(open) => {
          if (!open && !pending) setStep("closed");
        }}
      >
        <AlertDialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">
              Move {householdsLabel(count)} to {target?.name ?? ""}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm break-words">
                <p>
                  {target
                    ? bulkConfirmBodyCopy({
                        count,
                        source: source.name,
                        destination: target.name,
                        destinationDeacon: target.deaconName,
                      })
                    : null}
                </p>
                <p>{bulkConfirmTailCopy(source.name)}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending} className="min-h-11">
              Cancel
            </AlertDialogCancel>
            <Button
              type="button"
              className="min-h-11"
              disabled={pending || !target}
              onClick={confirm}
            >
              {pending ? "Moving…" : `Move ${householdsLabel(count)}`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
