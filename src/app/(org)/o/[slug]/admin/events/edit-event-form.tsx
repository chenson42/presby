"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequiredMark } from "@/components/shared/required-mark";
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog";
import { useUnsavedChangesGuard } from "@/components/shared/use-unsaved-changes-guard";
import type { EventDetail, UpdateEventInput } from "@/lib/events";
import { editEventSchema, type EditEventFormValues } from "./event-schema";
import { updateEventAction } from "./actions";

/**
 * Edits ONE occurrence's own fields — Flow 2's "single occurrence" case. NO
 * RECURRENCE CONTROLS HERE, EVER (Phase 3's Component Plan) — recurrence
 * editing is `extend-series-form.tsx`'s job, rendered only on a parent
 * event's own detail page. `updateEventAction` → `updateEvent()` never
 * touches `recurrencePattern`/`recurrenceCount` regardless of what this form
 * sends, so this is belt-and-suspenders, not the only reason it's absent.
 *
 * MID-FAILURE NEVER DISCARDS DATA (same discipline `edit-person-form.tsx`
 * documents): `form.reset()` never runs here — a denied or failed save
 * leaves every field exactly as entered.
 */
export function EditEventForm({
  slug,
  event,
}: {
  slug: string;
  event: EventDetail;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<EditEventFormValues>({
    resolver: zodResolver(editEventSchema),
    defaultValues: {
      title: event.title,
      description: event.description ?? "",
      location: event.location ?? "",
      startsAt: event.startsAt.slice(0, 16),
      endsAt: event.endsAt ? event.endsAt.slice(0, 16) : "",
      isPublic: event.isPublic,
      allowsCheckin: event.allowsCheckin,
    },
  });

  const {
    register,
    formState: { errors, isDirty },
  } = form;

  const { discardOpen, setDiscardOpen, guardedNavigate, confirmDiscard } =
    useUnsavedChangesGuard(isDirty);

  async function onSubmit(values: EditEventFormValues) {
    const input: UpdateEventInput = {
      eventId: event.eventId,
      title: values.title,
      description: values.description || undefined,
      location: values.location || undefined,
      startsAt: values.startsAt,
      endsAt: values.endsAt || undefined,
      isPublic: values.isPublic,
      allowsCheckin: values.allowsCheckin,
    };

    setSubmitting(true);
    const result = await updateEventAction(slug, input);
    setSubmitting(false);

    if (result.ok) {
      toast.success("Event updated.");
      router.push(`/o/${slug}/admin/events/${event.eventId}`);
    } else {
      // NO reset here — see this component's own header.
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="edit-event-title">
          Title
          <RequiredMark />
        </Label>
        <Input
          id="edit-event-title"
          type="text"
          className="mt-1"
          aria-invalid={errors.title ? "true" : undefined}
          aria-required="true"
          {...register("title")}
        />
        {errors.title && (
          <p className="mt-1 text-sm text-destructive">{errors.title.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="edit-event-description">Description (optional)</Label>
        <Input id="edit-event-description" type="text" className="mt-1" {...register("description")} />
        {errors.description && (
          <p className="mt-1 text-sm text-destructive">{errors.description.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="edit-event-location">Location (optional)</Label>
        <Input id="edit-event-location" type="text" className="mt-1" {...register("location")} />
        {errors.location && (
          <p className="mt-1 text-sm text-destructive">{errors.location.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="edit-event-starts-at">
          Starts
          <RequiredMark />
        </Label>
        <Input
          id="edit-event-starts-at"
          type="datetime-local"
          className="mt-1"
          aria-invalid={errors.startsAt ? "true" : undefined}
          aria-required="true"
          {...register("startsAt")}
        />
        {errors.startsAt && (
          <p className="mt-1 text-sm text-destructive">{errors.startsAt.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="edit-event-ends-at">Ends (optional)</Label>
        <Input
          id="edit-event-ends-at"
          type="datetime-local"
          className="mt-1"
          aria-invalid={errors.endsAt ? "true" : undefined}
          {...register("endsAt")}
        />
        {errors.endsAt && (
          <p className="mt-1 text-sm text-destructive">{errors.endsAt.message}</p>
        )}
      </div>

      <label className="inline-flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" {...register("isPublic")} />
        Visible on the public calendar
      </label>

      <label className="inline-flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" {...register("allowsCheckin")} />
        Allow check-in for this event
      </label>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={submitting} className="min-h-11">
          {submitting ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={submitting}
          className="min-h-11"
          onClick={() => guardedNavigate(`/o/${slug}/admin/events/${event.eventId}`)}
        >
          Cancel
        </Button>
      </div>
      <UnsavedChangesDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirmDiscard={confirmDiscard}
      />
    </form>
  );
}
