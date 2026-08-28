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
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { setStaffPositionPublicListedAction } from "./actions";

interface PublicListingToggleProps {
  slug: string;
  positionId: string;
  position: string;
  personName: string;
  publicListed: boolean;
}

/**
 * The public staff-directory opt-in/opt-out control on a single
 * `admin/staff` roster row (docs/work-log/2026-08-27-public-staff-
 * directory.md, Phase 3/4). A shadcn `Switch`, never a native checkbox
 * (CLAUDE.md's UI conventions), wrapped in a shadcn `AlertDialog` — never
 * `confirm()` (Workflow Rule 2) — for BOTH directions, not just turning the
 * bit on: Phase 1's Edge Cases require the "off does not retract" disclosure
 * to actually reach the admin, and the only way to guarantee that is to show
 * it every time the bit changes, not just once.
 *
 * The dialog is CONTROLLED by `pendingValue` (not an `AlertDialogTrigger`)
 * so the `Switch`'s own visible `checked` state never flips until the
 * mutation actually succeeds — clicking the switch stages the requested
 * direction and opens the dialog; cancelling or a server-side denial leaves
 * `checked` exactly where it was, same "never contradict the row you're
 * looking at until it changes for real" discipline `features-list.tsx`'s own
 * header documents for the identical control at a smaller trust threshold
 * (no confirmation there because a feature toggle isn't published to the
 * public internet).
 *
 * `Switch` alone is ~18x32px, under the 44px touch-target floor —
 * `features-list.tsx`'s own header names this; the same `min-h-11 min-w-11`
 * label wrap is reused here rather than re-deriving it.
 */
export function PublicListingToggle({
  slug,
  positionId,
  position,
  personName,
  publicListed,
}: PublicListingToggleProps) {
  const router = useRouter();
  const [checked, setChecked] = useState(publicListed);
  const [pendingValue, setPendingValue] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);

  const open = pendingValue !== null;

  function requestChange(next: boolean) {
    setPendingValue(next);
  }

  async function confirm() {
    if (pendingValue === null) return;
    const next = pendingValue;
    setPending(true);
    const result = await setStaffPositionPublicListedAction(slug, {
      positionId,
      publicListed: next,
    });
    setPending(false);
    setPendingValue(null);

    if (result.ok) {
      const confirmed = result.data?.publicListed ?? next;
      setChecked(confirmed);
      toast.success(
        confirmed
          ? `${personName} is now listed publicly.`
          : `${personName} is no longer listed publicly.`,
      );
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {checked && <Badge variant="secondary">Public</Badge>}
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setPendingValue(null);
        }}
      >
        <label className="inline-flex min-h-11 min-w-11 items-center justify-center">
          <span className="sr-only">
            List {personName} publicly on the public website, currently{" "}
            {checked ? "on" : "off"}
          </span>
          <Switch
            checked={checked}
            disabled={pending}
            onCheckedChange={requestChange}
          />
        </label>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingValue
                ? `List ${personName} publicly as ${position}?`
                : `Stop listing ${personName} publicly?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingValue
                ? `This makes ${personName}'s name, role, and photo (if one is on file) visible to anyone visiting the public website — including search engines and archival crawlers.`
                : `This stops serving ${personName}'s listing going forward. It does not retract anything already cached or indexed elsewhere (search engines, web archives) — turning this off is not a full retraction.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirm} disabled={pending}>
              {pending
                ? "Saving…"
                : pendingValue
                  ? "Yes, list publicly"
                  : "Yes, stop listing"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
