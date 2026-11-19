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
import type { CommitteesActionResult } from "@/lib/committees/contract";
import { TOAST } from "@/lib/committees/copy";
import { PAGE } from "@/lib/committees/ui-copy";
import { listingConsentCopy } from "@/lib/person-photos/copy";

type ListedAction = (
  slug: string,
  values: { committeeId: string; membershipId: string; publicListed: boolean },
) => Promise<CommitteesActionResult>;

/**
 * The public committee-directory opt-in/opt-out control on a "Serving now" row.
 * A COPY of the groups admin's control (strings unchanged; the committees tree
 * imports nothing from `admin/groups/`), with the committees action passed in as a
 * prop. A shadcn `Switch`, never a native checkbox; an `AlertDialog` for BOTH
 * directions so the "off does not retract" disclosure always reaches the person
 * acting; the dialog is controlled by `pendingValue` so the `Switch` never flips
 * ahead of the write succeeding; the `min-h-11 min-w-11` wrap for the 44px target.
 */
export function PublicListingToggle({
  action,
  slug,
  committeeId,
  membershipId,
  committeeName,
  personName,
  publicListed,
}: {
  action: ListedAction;
  slug: string;
  committeeId: string;
  membershipId: string;
  committeeName: string;
  personName: string;
  publicListed: boolean;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(publicListed);
  const [pendingValue, setPendingValue] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (pendingValue === null) return;
    const next = pendingValue;
    setPending(true);
    const result = await action(slug, { committeeId, membershipId, publicListed: next });
    setPending(false);
    setPendingValue(null);
    if (result.ok) {
      const confirmed = result.data?.publicListed ?? next;
      setChecked(confirmed);
      toast.success(confirmed ? TOAST.listed(personName, committeeName) : TOAST.unlisted(personName, committeeName));
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {checked ? <Badge variant="secondary">{PAGE.public}</Badge> : null}
      <AlertDialog
        open={pendingValue !== null}
        onOpenChange={(next) => {
          if (!next) setPendingValue(null);
        }}
      >
        <label className="inline-flex min-h-11 min-w-11 items-center justify-center">
          <span className="sr-only">
            List {personName} publicly on {committeeName}&apos;s public roster, currently {checked ? "on" : "off"}
          </span>
          <Switch checked={checked} disabled={pending} onCheckedChange={setPendingValue} />
        </label>
        <AlertDialogContent className="max-h-[90dvh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="[overflow-wrap:anywhere]">
              {pendingValue
                ? `List ${personName} publicly on ${committeeName}'s roster?`
                : `Stop listing ${personName} publicly on ${committeeName}'s roster?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingValue
                ? listingConsentCopy(personName)
                : `This stops serving ${personName}'s listing going forward. It does not retract anything already cached or indexed elsewhere (search engines, web archives) — turning this off is not a full retraction.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <AlertDialogCancel className="min-h-11 w-full sm:w-auto">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirm} disabled={pending} className="min-h-11 w-full sm:w-auto">
              {pending ? "Saving…" : pendingValue ? "Yes, list publicly" : "Yes, stop listing"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
