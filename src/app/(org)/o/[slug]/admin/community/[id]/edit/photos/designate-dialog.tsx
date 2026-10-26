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
 * component, three variants. A `Dialog` (the choice is reversible, so not an
 * `AlertDialog`) with a NATIVE checkbox, the `branding-form.tsx` idiom; no
 * checkbox primitive is added.
 *
 *   - directory: the box starts UNTICKED and is optional. Ticked, it records
 *     the website attestation, so the photo can stand in on the public website
 *     while no website photo is chosen (DECISION-286). The consequence lines
 *     are recomputed from the live state on every tick.
 *   - website: the box is REQUIRED and the confirm button stays disabled until
 *     it is ticked (the server also refuses without it).
 *   - clear (`clear` set, purpose "directory"): the current directory photo's
 *     "Clear for website" button (Phase 5 run 1, R-b). Records the website
 *     attestation on the same photo (the store ends the old designation and
 *     inserts the attested one); the box is REQUIRED, like the website's.
 *
 * Every variant disables its confirm when the person appears to be under 18:
 * the store would refuse, and the consequence line says so before the click.
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
  clear = false,
  state,
  name,
  open,
  onOpenChange,
}: {
  slug: string;
  personId: string;
  photoId: string;
  purpose: Purpose;
  /** The "Clear for website" variant of the directory purpose. */
  clear?: boolean;
  state: PhotoStateSnapshot;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [ticked, setTicked] = useState(false);
  const [pending, setPending] = useState(false);
  const isWebsite = purpose === "website";
  const copy = isWebsite ? DESIGNATE_COPY.website : clear ? DESIGNATE_COPY.clear : DESIGNATE_COPY.directory;
  const description = isWebsite
    ? DESIGNATE_COPY.website.body
    : clear
      ? DESIGNATE_COPY.clear.body(state.first)
      : DESIGNATE_COPY.directory.body(name, state.first);
  const needsTick = isWebsite || clear;
  const lines = consequencesFor(
    state,
    isWebsite
      ? { kind: "designate_website", photoId }
      : { kind: "designate_directory", photoId, attested: ticked },
  );
  const checkboxId = `designate-${clear ? "clear" : purpose}-${photoId}`;

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
          <DialogDescription>{description}</DialogDescription>
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
          <Button type="button" className="min-h-11" onClick={confirm} disabled={pending || state.minor || (needsTick && !ticked)}>
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
