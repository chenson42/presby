"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequiredMark } from "@/components/shared/required-mark";
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog";
import { useUnsavedChangesGuard } from "@/components/shared/use-unsaved-changes-guard";
import {
  DAYS_OF_WEEK,
  ORDINALS,
  SIMPLE_PATTERNS,
  PATTERN_LABELS,
  buildDayOfWeekPattern,
} from "@/lib/events/recurrence";
import type { CreateEventInput } from "@/lib/events";
import { createEventSchema, type CreateEventFormValues } from "./event-schema";
import { createEventAction } from "./actions";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function defaultValues(): CreateEventFormValues {
  return {
    title: "",
    description: "",
    location: "",
    startsAt: "",
    endsAt: "",
    isPublic: true,
    allowsCheckin: false,
    repeats: false,
    patternType: "simple",
    simplePattern: "weekly",
    ordinal: "1st",
    dayOfWeek: "Monday",
    count: "",
  };
}

/**
 * Creates a new event — Flow 1/2. `react-hook-form` + `zod`
 * (`docs/ui-standards.md`'s >4-field threshold: title, description,
 * location, two date/times, visibility, check-in, and a conditional repeat
 * block is well past it).
 *
 * THE "REPEATS" TOGGLE REVEALS PATTERN/COUNT INPUTS — matches
 * `add-officer-term-form.tsx`'s conditional-district pattern exactly.
 * `patternType`/`simplePattern`/`ordinal`/`dayOfWeek`/`count` are FORM-ONLY
 * fields; `onSubmit` collapses them into `CreateEventInput["recurrence"]`
 * (a single pattern STRING, per `src/lib/events/recurrence.ts`'s own
 * convenience-generation format — DECISION-113 ruling 1) or omits
 * `recurrence` entirely when `repeats` is unchecked.
 *
 * SERVER-SIDE VALIDATION IS THE REAL GATE (Phase 1's Adversarial Pass): the
 * end-before-start check and the 52-occurrence cap are both re-enforced in
 * `src/lib/events.ts`, not just this form's own zod shape.
 */
export function NewEventForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<CreateEventFormValues>({
    resolver: zodResolver(createEventSchema),
    defaultValues: defaultValues(),
  });

  const {
    register,
    formState: { errors, isDirty },
  } = form;
  const repeats = useWatch({ control: form.control, name: "repeats" });
  const patternType = useWatch({ control: form.control, name: "patternType" });

  // H3 (docs/reviews/2026-08-26-portal-ux.md) — no in-form Back/Cancel link
  // of its own; the guard's document-level click interception protects a
  // dirty draft from the surrounding page's own navigation.
  const { discardOpen, setDiscardOpen, confirmDiscard } = useUnsavedChangesGuard(isDirty);

  async function onSubmit(values: CreateEventFormValues) {
    const pattern =
      values.patternType === "simple"
        ? values.simplePattern!
        : buildDayOfWeekPattern(values.ordinal!, values.dayOfWeek!);

    const input: CreateEventInput = {
      title: values.title,
      description: values.description || undefined,
      location: values.location || undefined,
      startsAt: values.startsAt,
      endsAt: values.endsAt || undefined,
      isPublic: values.isPublic,
      allowsCheckin: values.allowsCheckin,
      recurrence: values.repeats ? { pattern, count: Number(values.count) } : undefined,
    };

    setSubmitting(true);
    const result = await createEventAction(slug, input);
    setSubmitting(false);

    if (result.ok) {
      toast.success("Event created.");
      router.push(`/o/${slug}/admin/events/${result.data!.eventId}`);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="new-event-title">
          Title
          <RequiredMark />
        </Label>
        <Input
          id="new-event-title"
          type="text"
          placeholder="e.g. Session meeting"
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
        <Label htmlFor="new-event-description">Description (optional)</Label>
        <Input id="new-event-description" type="text" className="mt-1" {...register("description")} />
        {errors.description && (
          <p className="mt-1 text-sm text-destructive">{errors.description.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="new-event-location">Location (optional)</Label>
        <Input id="new-event-location" type="text" className="mt-1" {...register("location")} />
        {errors.location && (
          <p className="mt-1 text-sm text-destructive">{errors.location.message}</p>
        )}
      </div>

      <div>
        <Label htmlFor="new-event-starts-at">
          Starts
          <RequiredMark />
        </Label>
        <Input
          id="new-event-starts-at"
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
        <Label htmlFor="new-event-ends-at">Ends (optional)</Label>
        <Input
          id="new-event-ends-at"
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
        <input
          type="checkbox"
          className="h-4 w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          {...register("isPublic")}
        />
        Visible on the public calendar
      </label>

      <label className="inline-flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          {...register("allowsCheckin")}
        />
        Allow check-in for this event
      </label>

      <label className="inline-flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          {...register("repeats")}
        />
        This event repeats
      </label>

      {repeats && (
        <div className="space-y-4 rounded-md border border-border p-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Repeat pattern</legend>
            <div className="flex flex-col gap-2">
              <label className="inline-flex min-h-11 items-center gap-2 text-sm">
                <input type="radio" value="simple" {...register("patternType")} className="h-4 w-4" />
                A simple interval
              </label>
              <label className="inline-flex min-h-11 items-center gap-2 text-sm">
                <input type="radio" value="dayofweek" {...register("patternType")} className="h-4 w-4" />
                A specific day of the month
              </label>
            </div>
          </fieldset>

          {patternType === "simple" ? (
            <div>
              <Label htmlFor="new-event-simple-pattern">Repeats</Label>
              <div className="relative mt-1">
                <select
                  id="new-event-simple-pattern"
                  className={SELECT_CLASSES}
                  {...register("simplePattern")}
                >
                  {SIMPLE_PATTERNS.map((p) => (
                    <option key={p} value={p}>
                      {PATTERN_LABELS[p]}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
              </div>
            </div>
          ) : (
            <div className="flex gap-3">
              <div className="flex-1">
                <Label htmlFor="new-event-ordinal">Which</Label>
                <div className="relative mt-1">
                  <select id="new-event-ordinal" className={SELECT_CLASSES} {...register("ordinal")}>
                    {ORDINALS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                </div>
              </div>
              <div className="flex-1">
                <Label htmlFor="new-event-day-of-week">Day</Label>
                <div className="relative mt-1">
                  <select id="new-event-day-of-week" className={SELECT_CLASSES} {...register("dayOfWeek")}>
                    {DAYS_OF_WEEK.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                </div>
              </div>
            </div>
          )}

          <div>
            <Label htmlFor="new-event-count">
              Number of occurrences
              <RequiredMark />
            </Label>
            <Input
              id="new-event-count"
              type="text"
              inputMode="numeric"
              placeholder="e.g. 12"
              className="mt-1"
              aria-invalid={errors.count ? "true" : undefined}
              {...register("count")}
            />
            {errors.count && (
              <p className="mt-1 text-sm text-destructive">{errors.count.message}</p>
            )}
          </div>
        </div>
      )}

      <Button type="submit" disabled={submitting} className="min-h-11">
        {submitting ? "Creating…" : "Create event"}
      </Button>
      <UnsavedChangesDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirmDiscard={confirmDiscard}
      />
    </form>
  );
}
