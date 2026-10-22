"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormattedDate } from "@/components/shared/formatted-date";
import type { PendingRollAction } from "@/lib/roll";
import { approveRollActionAction, denyRollActionAction } from "./actions";

const ROLL_ACTION_LABELS: Record<string, string> = {
  profession_of_faith: "Profession of faith",
  other_participant_enrolled: "Enrolled as a participant",
};

function rollActionLabel(kind: string): string {
  return ROLL_ACTION_LABELS[kind] ?? kind;
}

/**
 * The clerk's session-agenda worklist. Rows where `proposedByIsViewer` is
 * true carry a "You proposed this" badge — Phase 2's resolution to the
 * self-approval question: permitted by design, surfaced (not blocked), per
 * `src/lib/roll.ts`'s own header.
 */
export function PendingWorklist({
  slug,
  actions,
}: {
  slug: string;
  actions: PendingRollAction[];
}) {
  if (actions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <p className="text-sm font-medium">Nothing waiting for your approval</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Roll actions proposed by admins will show up here.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {actions.map((action) => (
        <li key={action.id}>
          <PendingRow slug={slug} action={action} />
        </li>
      ))}
    </ul>
  );
}

function PendingRow({
  slug,
  action,
}: {
  slug: string;
  action: PendingRollAction;
}) {
  const router = useRouter();
  const [approveOpen, setApproveOpen] = useState(false);
  const [denyOpen, setDenyOpen] = useState(false);
  const [minuteReference, setMinuteReference] = useState("");
  const [denyReason, setDenyReason] = useState("");
  const [pending, setPending] = useState(false);

  async function handleApprove() {
    setPending(true);
    const result = await approveRollActionAction(slug, {
      rollActionId: action.id,
      minuteReference: minuteReference.trim() || undefined,
    });
    setPending(false);
    if (result.ok) {
      toast.success(`${action.personDisplayName}'s roll action approved.`);
      setApproveOpen(false);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  async function handleDeny() {
    if (!denyReason.trim()) {
      toast.error("A reason is required to deny a roll action.");
      return;
    }
    setPending(true);
    const result = await denyRollActionAction(slug, {
      rollActionId: action.id,
      reason: denyReason.trim(),
    });
    setPending(false);
    if (result.ok) {
      toast.success(`${action.personDisplayName}'s roll action denied.`);
      setDenyOpen(false);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Card className="py-4">
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-medium">{action.personDisplayName}</h3>
          {action.proposedByIsViewer && (
            <Badge variant="outline" className="font-normal">
              You proposed this
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {rollActionLabel(action.kind)} — effective{" "}
          <FormattedDate value={action.effectiveDate} mode="date" />
        </p>

        <div className="flex flex-wrap gap-3">
          <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
            <DialogTrigger asChild>
              <Button type="button" className="min-h-11">
                Approve
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  Approve {action.personDisplayName}&apos;s roll action?
                </DialogTitle>
                <DialogDescription>
                  This records {rollActionLabel(action.kind).toLowerCase()} on
                  the roll, effective{" "}
                  <FormattedDate value={action.effectiveDate} mode="date" />.
                </DialogDescription>
              </DialogHeader>
              <div>
                <Label htmlFor={`minute-ref-${action.id}`}>
                  Minute reference (optional)
                </Label>
                <Input
                  id={`minute-ref-${action.id}`}
                  value={minuteReference}
                  onChange={(e) => setMinuteReference(e.target.value)}
                  className="mt-1"
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setApproveOpen(false)}
                  className="min-h-11"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleApprove}
                  disabled={pending}
                  className="min-h-11"
                >
                  {pending ? "Approving…" : "Approve"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={denyOpen} onOpenChange={setDenyOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" className="min-h-11">
                Deny
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  Deny {action.personDisplayName}&apos;s roll action?
                </DialogTitle>
                <DialogDescription>
                  This roll action will not be recorded. A reason is required.
                </DialogDescription>
              </DialogHeader>
              <div>
                <Label htmlFor={`deny-reason-${action.id}`}>Reason</Label>
                <Textarea
                  id={`deny-reason-${action.id}`}
                  value={denyReason}
                  onChange={(e) => setDenyReason(e.target.value)}
                  required
                  className="mt-1"
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDenyOpen(false)}
                  className="min-h-11"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDeny}
                  disabled={pending}
                  className="min-h-11"
                >
                  {pending ? "Denying…" : "Deny"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  );
}
