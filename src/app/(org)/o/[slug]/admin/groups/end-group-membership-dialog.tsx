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
import { endGroupMembershipAction } from "./actions";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface EndGroupMembershipDialogProps {
  slug: string;
  groupMembershipId: string;
  groupId: string;
  personId: string;
  personName: string;
  groupName: string;
  /** 'YYYY-MM-DD' — used only as the end-date input's `min`, so an obviously
   * impossible date never gets past the browser's own picker. The server
   * (`endGroupMembership`) is still the authoritative check. */
  startsOn: string;
}

/**
 * Ends a group membership — NEVER a delete (DECISION-110 ruling 5,
 * `groups.ts`'s own no-delete discipline). `AlertDialog`, never `confirm()`
 * (Workflow Rule 2), modeled directly on `officers/end-term-dialog.tsx`:
 * names BOTH the person and the group in the confirmation copy, never a
 * generic "Are you sure?".
 */
export function EndGroupMembershipDialog({
  slug,
  groupMembershipId,
  groupId,
  personId,
  personName,
  groupName,
  startsOn,
}: EndGroupMembershipDialogProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [endsOn, setEndsOn] = useState(today);

  async function handleConfirm() {
    setPending(true);
    const result = await endGroupMembershipAction(slug, {
      groupMembershipId,
      endsOn,
      personId,
      groupId,
      groupName,
    });
    setPending(false);
    if (result.ok) {
      toast.success(`${personName} is no longer active in ${groupName}.`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="min-h-11">
          End membership
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            End {personName}&apos;s membership in {groupName}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This sets an end date on the existing membership — it stays on
            record, it is not deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="py-2">
          <Label htmlFor={`end-group-membership-ends-on-${groupMembershipId}`}>
            End date
          </Label>
          <Input
            id={`end-group-membership-ends-on-${groupMembershipId}`}
            type="date"
            min={startsOn}
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
            className="mt-1"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending}
          >
            {pending ? "Ending…" : "Yes, end membership"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
