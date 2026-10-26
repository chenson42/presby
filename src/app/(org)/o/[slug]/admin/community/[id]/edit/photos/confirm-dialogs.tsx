"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { consequencesFor, type PhotoIntent, type PhotoStateSnapshot } from "@/lib/person-photos/consequences";
import { CONFIRM_COPY } from "@/lib/person-photos/copy";
import type { ActionResult } from "@/types/actions";
import { removePersonPhotoAction, undesignatePersonPhotoAction } from "./actions";

type Confirm =
  | { kind: "stop_directory" }
  | { kind: "stop_website" }
  | { kind: "remove"; photoId: string };

/**
 * The three destructive-or-withdrawing confirmations (Copy C5): stop using a
 * photo in the directory, stop using it on the website, and remove it. An
 * `AlertDialog` (Rule 2; the `public-listing-toggle.tsx` idiom). The body is the
 * ordered consequence sentences `consequences.ts` chooses from the person's LIVE
 * state, so what the dialog says is what the action will do. The confirm is a
 * plain `Button`, so a refusal keeps the dialog open with the reason in a toast.
 */
export function ConfirmDialog({
  slug,
  personId,
  state,
  action,
  open,
  onOpenChange,
}: {
  slug: string;
  personId: string;
  state: PhotoStateSnapshot;
  action: Confirm;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const copy =
    action.kind === "stop_directory" ? CONFIRM_COPY.stopDirectory : action.kind === "stop_website" ? CONFIRM_COPY.stopWebsite : CONFIRM_COPY.remove;
  const intent: PhotoIntent =
    action.kind === "stop_directory"
      ? { kind: "undesignate_directory" }
      : action.kind === "stop_website"
        ? { kind: "undesignate_website" }
        : { kind: "remove", photoId: action.photoId };
  const lines = consequencesFor(state, intent);

  async function confirm() {
    setPending(true);
    try {
      let result: ActionResult;
      if (action.kind === "remove") result = await removePersonPhotoAction(slug, personId, action.photoId);
      else result = await undesignatePersonPhotoAction(slug, personId, action.kind === "stop_directory" ? "directory" : "website");
      if (result.ok) onOpenChange(false);
      else toast.error(result.error);
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {lines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} className="min-h-11">
            {CONFIRM_COPY.cancel}
          </AlertDialogCancel>
          <Button
            type="button"
            variant={action.kind === "remove" ? "destructive" : "default"}
            className="min-h-11"
            onClick={confirm}
            disabled={pending}
          >
            {copy.confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
