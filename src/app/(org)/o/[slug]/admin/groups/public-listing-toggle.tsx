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
import { setGroupMembershipPublicListedAction } from "./actions";

interface PublicListingToggleProps {
  slug: string;
  groupId: string;
  groupMembershipId: string;
  groupName: string;
  personName: string;
  publicListed: boolean;
}

/**
 * The public committee-directory opt-in/opt-out control on a single
 * `admin/groups/[groupId]` roster row (docs/work-log/2026-08-28-public-
 * directory-primitives.md, Phase 3/4) — the `group_memberships` twin of
 * `admin/staff`/`admin/officers`'s own `public-listing-toggle.tsx`. See
 * those files' own header for the full rationale this one shares verbatim:
 * a shadcn `Switch`, never a native checkbox; a shadcn `AlertDialog`, never
 * `confirm()` (Workflow Rule 2), shown for BOTH directions so the
 * "off does not retract" disclosure always reaches the admin; the dialog is
 * CONTROLLED by `pendingValue` so the `Switch`'s own visible `checked` state
 * never flips ahead of the mutation actually succeeding; the `min-h-11
 * min-w-11` touch-target wrap for the same sub-44px `Switch` reason.
 *
 * Duplicated rather than shared, matching this codebase's own
 * per-domain-file convention for these small, structurally similar controls
 * (`end-position-dialog.tsx`/`end-term-dialog.tsx`/
 * `end-group-membership-dialog.tsx` are three separate copies of an
 * analogous "end this row" action; `admin/staff`/`admin/officers`'s own
 * `public-listing-toggle.tsx` are already two separate copies of THIS exact
 * control — this is the third, not the first departure from sharing).
 *
 * This route (`getGroup()`) ALREADY excludes every derived group at the
 * query layer (`membership_source = 'managed'`, `src/lib/groups.ts`) — a
 * `group_membership` row reachable by this component is therefore always
 * already a managed group's row, so this control renders unconditionally on
 * every roster row here, with the SERVER-SIDE mutation
 * (`setGroupMembershipPublicListed()`) still independently re-checking and
 * refusing a derived row as its own defense-in-depth layer, exactly as
 * documented in that function's own header.
 *
 * `groupId` is caller-supplied (the group detail page, which already
 * fetched `getGroup()` to render the row being toggled) purely for
 * `revalidatePath` — mirroring `endGroupMembershipAction`'s identical shape.
 */
export function PublicListingToggle({
  slug,
  groupId,
  groupMembershipId,
  groupName,
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
    const result = await setGroupMembershipPublicListedAction(slug, {
      groupMembershipId,
      publicListed: next,
      groupId,
    });
    setPending(false);
    setPendingValue(null);

    if (result.ok) {
      const confirmed = result.data?.publicListed ?? next;
      setChecked(confirmed);
      toast.success(
        confirmed
          ? `${personName} is now listed publicly on ${groupName}'s roster.`
          : `${personName} is no longer listed publicly on ${groupName}'s roster.`,
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
            List {personName} publicly on {groupName}&apos;s public roster,
            currently {checked ? "on" : "off"}
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
                ? `List ${personName} publicly on ${groupName}'s roster?`
                : `Stop listing ${personName} publicly on ${groupName}'s roster?`}
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
