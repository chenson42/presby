"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { consequencesFor, type PhotoStateSnapshot } from "@/lib/person-photos/consequences";
import { DESIGNATE_COPY } from "@/lib/person-photos/copy";
import type { Purpose } from "@/lib/person-photos/types";
import { designatePersonPhotoAction } from "./actions";

/**
 * "Use this photo in the directory / on the public website" (Copy C4). One
 * component, two variants. A `Dialog` (the choice is reversible, so not an
 * `AlertDialog`) with a NATIVE checkbox, the `branding-form.tsx` idiom; no
 * checkbox primitive is added.
 *
 *   - directory: the box starts UNTICKED and is optional. Ticked, it records
 *     the website attestation, so the photo can stand in on the public website
 *     while no website photo is chosen (DECISION-286). The consequence lines
 *     are recomputed from the live state on every tick.
 *   - website: the box is REQUIRED and the confirm button stays disabled until
 *     it is ticked (the server also refuses without it).
 *
 * The confirm is a plain `Button`, not `AlertDialogAction`, so a refusal leaves
 * the dialog open with the reason in a toast. Ticks reset each time it opens
 * (the parent keys it by open state).
 */
export function DesignateDialog({
  slug,
  personId,
  photoId,
  purpose,
  state,
  name,
  open,
  onOpenChange,
}: {
  slug: string;
  personId: string;
  photoId: string;
  purpose: Purpose;
  state: PhotoStateSnapshot;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [ticked, setTicked] = useState(false);
  const [pending, setPending] = useState(false);
  const isWebsite = purpose === "website";
  const copy = isWebsite ? DESIGNATE_COPY.website : DESIGNATE_COPY.directory;
  const lines = consequencesFor(
    state,
    isWebsite
      ? { kind: "designate_website", photoId }
      : { kind: "designate_directory", photoId, attested: ticked },
  );
  const checkboxId = `designate-${purpose}-${photoId}`;

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (next) setTicked(false);
    onOpenChange(next);
  }

  async function confirm() {
    setPending(true);
    try {
      const result = await designatePersonPhotoAction(slug, personId, { photoId, purpose, attested: ticked });
      if (result.ok) {
        onOpenChange(false);
      } else {
        toast.error(result.error);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{isWebsite ? DESIGNATE_COPY.website.body : DESIGNATE_COPY.directory.body(name)}</DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-3">
          <input
            id={checkboxId}
            type="checkbox"
            checked={ticked}
            onChange={(e) => setTicked(e.target.checked)}
            className="mt-0.5 size-4 shrink-0 rounded border-input"
          />
          <Label htmlFor={checkboxId} className="cursor-pointer text-sm font-normal leading-snug">
            {copy.checkbox(state.first)}
          </Label>
        </div>
        {lines.length > 0 && (
          <div className="space-y-2 text-sm text-muted-foreground" aria-live="polite">
            {lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" className="min-h-11" onClick={() => handleOpenChange(false)} disabled={pending}>
            {DESIGNATE_COPY.cancel}
          </Button>
          <Button type="button" className="min-h-11" onClick={confirm} disabled={pending || (isWebsite && !ticked)}>
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
