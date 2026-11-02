"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shared/use-hydrated";
import type { Engagement } from "@/lib/membership-standing";
import { ArchiveDialog } from "../../archive-dialog";
import { RestoreDialog } from "../../restore-dialog";
import { listNameForEngagement } from "../../engagement-copy";

/**
 * Archive and Restore on the person's own record (Copy group D), under the
 * Connection line beside the participant controls: Archive for a visitor or a
 * person marked inactive or moved away, Restore for an archived person. The
 * page decides which one applies (`mode`); the actions and the database
 * re-check regardless, and a refusal (an office held, a roll action waiting,
 * your own record) is shown in the dialog's toast. Both buttons are disabled
 * until hydration (DECISION-159) and sit on a full-width row at 360px.
 */
export function ArchiveRestoreControls({
  slug,
  personId,
  personName,
  organization,
  mode,
  engagement,
  signInConnected,
  invitationOpen,
}: {
  slug: string;
  personId: string;
  personName: string;
  organization: string;
  mode: "archive" | "restore";
  /** The engagement kept on the row: the list a person leaves, or returns to. */
  engagement: Engagement;
  signInConnected: boolean;
  /** A sign-in invitation is open and working (the card's state is `pending`). */
  invitationOpen: boolean;
}) {
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const list = listNameForEngagement(engagement);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full sm:w-auto"
        disabled={!hydrated}
        onClick={() => setOpen(true)}
      >
        {mode === "archive" ? "Archive" : "Restore"}{" "}
        <span className="sr-only">{personName}</span>
      </Button>
      {mode === "archive" ? (
        <ArchiveDialog
          open={open}
          onOpenChange={setOpen}
          slug={slug}
          personId={personId}
          personName={personName}
          organization={organization}
          facts={{ list, signInConnected, invitationOpen }}
        />
      ) : (
        <RestoreDialog
          open={open}
          onOpenChange={setOpen}
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
