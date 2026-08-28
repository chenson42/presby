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
import { setOfficerTermPublicListedAction } from "./actions";

interface PublicListingToggleProps {
  slug: string;
  termId: string;
  officeLabel: string;
  personName: string;
  publicListed: boolean;
}

/**
 * The public staff-directory opt-in/opt-out control on a single
 * `admin/officers` roster row — the `officer_terms` twin of
 * `admin/staff/public-listing-toggle.tsx`. See that file's header for the
 * full rationale (controlled `AlertDialog`, both directions confirmed, the
 * `Switch`'s visible state never flips ahead of the mutation actually
 * succeeding, the `min-h-11 min-w-11` touch-target wrap). Duplicated rather
 * than shared — `admin/staff` and `admin/officers` already keep their own
 * separate `end-position-dialog.tsx`/`end-term-dialog.tsx` for the
 * structurally-similar "end this row" action, and this follows the same
 * per-domain-file convention rather than introducing a new shared component
 * this design doc never asked for.
 */
export function PublicListingToggle({
  slug,
  termId,
  officeLabel,
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
    const result = await setOfficerTermPublicListedAction(slug, {
      termId,
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
                ? `List ${personName} publicly as ${officeLabel}?`
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
