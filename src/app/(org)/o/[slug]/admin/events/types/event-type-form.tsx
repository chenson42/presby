"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequiredMark } from "@/components/shared/required-mark";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { EventTypeIcon } from "@/components/org-portal/event-types/event-type-icon";
import { EventTypeSwatch } from "@/components/org-portal/event-types/event-type-swatch";
import {
  DEFAULT_EVENT_TYPE_ICON,
  EVENT_TYPE_COLOR_LABELS,
  EVENT_TYPE_ICON_LABELS,
  EVENT_TYPE_ICONS,
  SELECTABLE_EVENT_TYPE_COLORS,
  type EventTypeColor,
  type EventTypeIcon as EventTypeIconKey,
} from "@/lib/events/type-palette";
import {
  EVENT_TYPE_NAME_MAX,
  eventTypeFormSchema,
  type EventTypeFormValues,
} from "./event-type-schema";
import { createEventTypeAction, updateEventTypeAction } from "./actions";

const OPTION_CLASSES =
  // ui-ok: a radio option card (native radio + swatch/icon + text), not a button
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-input px-3 text-sm has-[:checked]:border-2 has-[:checked]:border-foreground has-[:checked]:font-semibold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background";

export interface EventTypeFormInitial {
  id: string;
  name: string;
  color: EventTypeColor;
  icon: EventTypeIconKey;
}

/**
 * Adds or edits one event type. react-hook-form + zod (name, colour and icon
 * with a closed vocabulary), wrapped in `HydrationGate` (DECISION-159).
 *
 * The colour and icon pickers are visible native radios with a text label each
 * - a colour is never offered as a bare swatch. The default type's colour is
 * read-only ("always neutral"); it is still submitted so the server's rule
 * ("the default type keeps its neutral color") is satisfied.
 *
 * A failed save shows the server's message in a toast and does NOT reset the
 * form: a duplicate name must not cost the user their other choices.
 */
export function EventTypeForm({
  slug,
  mode,
  initial,
  isFallback = false,
  onDone,
}: {
  slug: string;
  mode: "create" | "edit";
  initial?: EventTypeFormInitial;
  isFallback?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const uid = useId();
  const [submitting, setSubmitting] = useState(false);

  const defaults: EventTypeFormValues = {
    name: initial?.name ?? "",
    color: isFallback ? "neutral" : (initial?.color ?? SELECTABLE_EVENT_TYPE_COLORS[0]),
    icon: initial?.icon ?? DEFAULT_EVENT_TYPE_ICON,
  };

  const form = useForm<EventTypeFormValues>({
    resolver: zodResolver(eventTypeFormSchema),
    defaultValues: defaults,
  });
  const {
    register,
    formState: { errors },
  } = form;

  async function onSubmit(values: EventTypeFormValues) {
    setSubmitting(true);
    const result =
      mode === "edit" && initial
        ? await updateEventTypeAction(slug, { ...values, id: initial.id })
        : await createEventTypeAction(slug, values);
    setSubmitting(false);

    if (result.ok) {
      toast.success(mode === "edit" ? "Event type saved." : "Event type added.");
      if (mode === "create") form.reset(defaults);
      router.refresh();
      onDone?.();
    } else {
      toast.error(result.error);
    }
  }

  const nameId = `${uid}-name`;

  return (
    <HydrationGate>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <Label htmlFor={nameId}>
            Name
            <RequiredMark />
          </Label>
          <Input
            id={nameId}
            type="text"
            maxLength={EVENT_TYPE_NAME_MAX}
            placeholder="e.g. Choir rehearsal"
            className="mt-1"
            aria-invalid={errors.name ? "true" : undefined}
            aria-required="true"
            {...register("name")}
          />
          {errors.name && <p className="mt-1 text-sm text-destructive">{errors.name.message}</p>}
        </div>

        {isFallback ? (
          <p className="text-sm text-muted-foreground">
            Color: Neutral (the default type is always neutral)
          </p>
        ) : (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Color</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SELECTABLE_EVENT_TYPE_COLORS.map((color) => (
                <label key={color} className={OPTION_CLASSES}>
                  <input type="radio" value={color} className="size-4" {...register("color")} />
                  <EventTypeSwatch colorToken={color} />
                  {EVENT_TYPE_COLOR_LABELS[color]}
                </label>
              ))}
            </div>
            {errors.color && <p className="text-sm text-destructive">{errors.color.message}</p>}
          </fieldset>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Icon</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {EVENT_TYPE_ICONS.map((icon) => (
              <label key={icon} className={OPTION_CLASSES}>
                <input type="radio" value={icon} className="size-4" {...register("icon")} />
                <EventTypeIcon iconKey={icon} />
                {EVENT_TYPE_ICON_LABELS[icon]}
              </label>
            ))}
          </div>
          {errors.icon && <p className="text-sm text-destructive">{errors.icon.message}</p>}
        </fieldset>

        <Button type="submit" disabled={submitting} className="min-h-11">
          {mode === "edit"
            ? submitting
              ? "Saving…"
              : "Save changes"
            : submitting
              ? "Adding…"
              : "Add event type"}
        </Button>
      </form>
    </HydrationGate>
  );
}
