"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { HydrationGate } from "@/components/shared/hydration-gate";
import {
  removePhotoAction,
  setPhotoCaptionAction,
  setPhotoCoverAction,
} from "@/app/(org)/o/[slug]/admin/oversight/[aboutOrgId]/buildings/[buildingId]/photos/actions";
import { PHOTO_COPY, TOAST } from "@/lib/oversight/copy";
import { captionSchema, type CaptionValues } from "@/lib/oversight/validate";
import { TextField } from "./text-field";

interface Ids {
  slug: string;
  aboutOrgId: string;
  buildingId: string;
  photoId: string;
}

/**
 * The controls under the larger view (C14): "Edit caption" (an inline form with
 * the one "Caption (optional)" field; an empty caption clears it), "Make this the
 * cover" (hidden on the cover), and "Remove photo" (an `AlertDialog`, never a
 * native confirm: Workflow Rule 2). Every refusal is the action's own fixed
 * string, in a toast or under the caption field. Removing returns to the grid
 * (the `?view=` photo is gone); the others refresh in place.
 */
export function PhotoControls({
  caption,
  isCover,
  photosHref,
  ...ids
}: Ids & { caption: string | null; isCover: boolean; photosHref: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function makeCover() {
    setBusy(true);
    const result = await setPhotoCoverAction(ids.slug, ids.aboutOrgId, ids.buildingId, ids.photoId);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    if (!result.data.unchanged) toast.success(TOAST.coverChanged);
    router.refresh();
  }

  return (
    <HydrationGate>
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setEditing(true)} disabled={editing}>
            {PHOTO_COPY.editCaption}
          </Button>
          {isCover ? null : (
            <Button type="button" variant="outline" className="min-h-11" onClick={makeCover} disabled={busy}>
              {PHOTO_COPY.makeCover}
            </Button>
          )}
          <RemoveDialog {...ids} photosHref={photosHref} />
        </div>
        {editing ? <CaptionForm {...ids} caption={caption} onDone={() => setEditing(false)} /> : null}
      </div>
    </HydrationGate>
  );
}

function CaptionForm({ caption, onDone, ...ids }: Ids & { caption: string | null; onDone: () => void }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<CaptionValues>({
    resolver: zodResolver(captionSchema()),
    defaultValues: { caption: caption ?? "" },
  });

  async function onSubmit(values: CaptionValues) {
    setSubmitting(true);
    const result = await setPhotoCaptionAction(ids.slug, ids.aboutOrgId, ids.buildingId, ids.photoId, values);
    setSubmitting(false);
    if (!result.ok) {
      if (result.field === "caption") {
        form.setError("caption", { type: "server", message: result.error });
        form.setFocus("caption");
      } else {
        toast.error(result.error);
      }
      return;
    }
    if (!result.data.unchanged) toast.success(TOAST.captionSaved);
    onDone();
    router.refresh();
  }

  return (
    <HydrationGate>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="max-w-xl space-y-3">
        <TextField
          id="photo-caption"
          label={PHOTO_COPY.captionLabel}
          error={form.formState.errors.caption?.message}
          registration={form.register("caption")}
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={submitting} className="min-h-11">
            {submitting ? PHOTO_COPY.saving : PHOTO_COPY.saveCaption}
          </Button>
          <Button type="button" variant="outline" className="min-h-11" onClick={onDone}>
            {PHOTO_COPY.removeDialog.cancel}
          </Button>
        </div>
      </form>
    </HydrationGate>
  );
}

function RemoveDialog({ photosHref, ...ids }: Ids & { photosHref: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const copy = PHOTO_COPY.removeDialog;

  async function onConfirm() {
    setPending(true);
    const result = await removePhotoAction(ids.slug, ids.aboutOrgId, ids.buildingId, ids.photoId);
    setPending(false);
    if (result.ok) {
      toast.success(TOAST.photoRemoved);
      router.push(photosHref);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="min-h-11">
          {PHOTO_COPY.removePhoto}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>{copy.body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11">{copy.cancel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" className="min-h-11" onClick={onConfirm} disabled={pending}>
            {copy.confirm}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
