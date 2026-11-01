"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shared/use-hydrated";
import type { Engagement } from "@/lib/membership-standing";
import { ArchiveDialog } from "./archive-dialog";
import { EngagementDialog } from "./engagement-dialog";
import { RestoreDialog } from "./restore-dialog";
import { engagementImpact, listNameForEngagement } from "./engagement-copy";

type Dialog = "engagement" | "archive" | "restore" | null;

/**
 * The row buttons of the admin-only lists (Copy group C): Visitors get
 * Archive, Inactive gets Mark as regular and Archive, and a Former row that
 * ended by an archive gets Restore (a participant removal is undone from the
 * person's record, not here). One client island per row, owning the dialogs its
 * buttons open; each name is appended in screen-reader-only text so a list of
 * identical buttons is still distinguishable.
 *
 * Every control is disabled until hydration (DECISION-159): a click before
 * React's listeners exist would otherwise do nothing and look like a bug.
 *
 * "Mark as regular" always opens its dialog from this list: an Inactive row has
 * no listed roll, so the change always gives listing. It sends the row's own
 * `engagementStatus` as `expectedFrom`, the engagement the page rendered.
 */
export function CommunityRowActions({
  slug,
  view,
  personId,
  personName,
  organization,
  engagementStatus,
  archived,
  signInConnected,
  hasAddress,
  invitationOpen,
  selfConnectEnabled,
  isSelf = false,
}: {
  slug: string;
  view: "visitors" | "inactive" | "former";
  personId: string;
  personName: string;
  organization: string;
  engagementStatus: Engagement;
  /** The Former row ended by an archive (so it can be restored), not a participant removal. */
  archived: boolean;
  signInConnected: boolean;
  /** The row carries an active address (`CommunityRow.email`). */
  hasAddress: boolean;
  /** A sign-in invitation is open and working (the marker is `pending`). */
  invitationOpen: boolean;
  /** `org_portal.sign_in_connect`, or null when the page could not read it. */
  selfConnectEnabled: boolean | null;
  /**
   * The row is the viewer's own record. Archive is not offered (the action
   * refuses `self_target`; that stays as the backstop); Mark as regular and
   * Restore are unaffected.
   */
  isSelf?: boolean;
}) {
  const hydrated = useHydrated();
  const [dialog, setDialog] = useState<Dialog>(null);

  const canArchive = (view === "visitors" || view === "inactive") && !isSelf;
  const canMarkRegular = view === "inactive";
  const canRestore = view === "former" && archived;
  // Mark as regular counts: on your own Inactive row it is the only button left.
  if (!canArchive && !canMarkRegular && !canRestore) return null;

  const list = view === "visitors" ? "Visitors" : view === "inactive" ? "Inactive" : listNameForEngagement(engagementStatus);

  // The engagement dialog's impact, from the facts this row carries. The row
  // has no roll in the four (it is on the Inactive list), and no sign-in fact
  // is unknown: `signInConnected` is read for every row.
  const impact = engagementImpact({
    from: engagementStatus,
    to: "regular",
    currentRoll: null,
    signInConnected,
    addressOnFile: hasAddress,
    selfConnectEnabled,
  });

  // The space sits in the visible text node ("Archive "), not in the hidden one:
  // a leading space inside the hidden span is trimmed from the accessible name
  // by some engines.
  const name = <span className="sr-only">{personName}</span>;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canMarkRegular && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={!hydrated}
            onClick={() => setDialog("engagement")}
          >
            Mark as regular{" "}
            {name}
          </Button>
        )}
        {canArchive && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={!hydrated}
            onClick={() => setDialog("archive")}
          >
            Archive{" "}
            {name}
          </Button>
        )}
        {canRestore && (
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={!hydrated}
            onClick={() => setDialog("restore")}
          >
            Restore{" "}
            {name}
          </Button>
        )}
      </div>
      {canMarkRegular && (
        <EngagementDialog
          open={dialog === "engagement"}
          onOpenChange={(open) => setDialog(open ? "engagement" : null)}
          slug={slug}
          personId={personId}
          personName={personName}
          from={engagementStatus}
          to="regular"
          impact={impact}
        />
      )}
      {canArchive && (
        <ArchiveDialog
          open={dialog === "archive"}
          onOpenChange={(open) => setDialog(open ? "archive" : null)}
          slug={slug}
          personId={personId}
          personName={personName}
          organization={organization}
          facts={{ list, signInConnected, invitationOpen }}
        />
      )}
      {canRestore && (
        <RestoreDialog
          open={dialog === "restore"}
          onOpenChange={(open) => setDialog(open ? "restore" : null)}
          slug={slug}
          personId={personId}
          personName={personName}
          organization={organization}
          list={list}
          signInConnected={signInConnected}
        />
      )}
    </>
  );
}
