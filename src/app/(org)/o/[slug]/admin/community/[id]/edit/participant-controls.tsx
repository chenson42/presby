"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SUCCESS_COPY } from "../../participant-copy";
import { RemoveParticipantDialog } from "./remove-participant-dialog";
import { UndoEntryDialog } from "./undo-entry-dialog";

/**
 * Owns the two dialogs so the removal toast's "Undo" can open the undo dialog
 * (Phase 3). Each control renders only when the page said it may: Remove for a
 * current participant, Undo when the person's latest effective entry is one
 * recorded without approval; both need the roll-action edit flag and
 * `roll.propose`, decided on the server (the actions and the database function
 * re-check regardless).
 *
 * After a removal the person leaves every live list, so the page refreshes and
 * the Undo target becomes the removal just recorded: the toast carries that id
 * itself, so Undo works before the refreshed props arrive.
 */
export function ParticipantControls({
  slug,
  personId,
  personName,
  orgName,
  canRemove,
  undo,
}: {
  slug: string;
  personId: string;
  personName: string;
  orgName: string;
  canRemove: boolean;
  undo: {
    rollActionId: string;
    entryLabel: "enrolment" | "removal";
  } | null;
}) {
  const router = useRouter();
  const [undoOpen, setUndoOpen] = useState(false);
  // Set only by the removal toast: the removal this session just recorded.
  const [fromToast, setFromToast] = useState<string | null>(null);

  const target = fromToast
    ? { rollActionId: fromToast, entryLabel: "removal" as const }
    : undo;

  function handleRemoved(rollActionId: string) {
    toast.success(SUCCESS_COPY.participantRemoved, {
      action: {
        label: "Undo",
        onClick: () => {
          setFromToast(rollActionId);
          setUndoOpen(true);
        },
      },
    });
    router.refresh();
  }

  function handleUndone() {
    setFromToast(null);
    router.refresh();
  }

  if (!canRemove && !target) return null;

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      {canRemove && (
        <RemoveParticipantDialog
          slug={slug}
          personId={personId}
          personName={personName}
          orgName={orgName}
          onRemoved={handleRemoved}
        />
      )}
      {target && (
        <UndoEntryDialog
          slug={slug}
          open={undoOpen}
          onOpenChange={setUndoOpen}
          rollActionId={target.rollActionId}
          entryLabel={target.entryLabel}
          showTrigger={!fromToast}
          onUndone={handleUndone}
        />
      )}
    </div>
  );
}
