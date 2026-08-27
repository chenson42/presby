"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EDIT_TIME_ROLL_ACTION_KINDS,
  ROLL_ACTION_KIND_LABELS,
} from "@/lib/roll-action-kinds";
import type { PendingRollActionForPerson } from "@/lib/roll";
import {
  RECORD_ROLL_ACTION_DEFAULT_VALUES,
  recordRollActionSchema,
  type RecordRollActionValues,
} from "./record-roll-action-schema";
import { recordRollActionAction } from "./actions";

// Same standard treatment as the household select in `edit-person-form.tsx`
// on the same page (H2, docs/reviews/2026-08-26-portal-ux.md) — without
// `appearance-none` + a manual chevron, the browser's native control chrome
// paints over the box and this select reads as a different, greyer control
// than its neighbor.
const SELECT_CLASSES =
  "mt-1 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * A second, independent form beside `EditPersonForm` (Phase 2's placement
 * ruling — NOT folded into that form's own `<form>`): a different
 * permission requirement (`roll.propose` here, `people.manage` there)
 * submitted through one shared form would risk a partial-success UX neither
 * form has a story for. Its own submit/success/error state, its own
 * "no-reset-on-failure" discipline (mid-failure never discards data), same
 * conventions `EditPersonForm` already established (native
 * `<input type="date">`, `min-h-11`/`min-w-11` targets).
 *
 * On a SUCCESSFUL submit the form resets (unlike `EditPersonForm`, which
 * navigates away) and the page is refreshed — a clerk may reasonably record
 * a second roll action for the same person in one sitting, and the
 * "already pending" notice below needs the freshly-inserted row to appear.
 */
export function RecordRollActionForm({
  slug,
  personId,
  pendingActions,
}: {
  slug: string;
  personId: string;
  pendingActions: PendingRollActionForPerson[];
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<RecordRollActionValues>({
    resolver: zodResolver(recordRollActionSchema),
    defaultValues: RECORD_ROLL_ACTION_DEFAULT_VALUES,
  });
  const {
    register,
    formState: { errors },
  } = form;

  async function onSubmit(values: RecordRollActionValues) {
    setSubmitting(true);
    const result = await recordRollActionAction(slug, {
      personId,
      kind: values.kind,
      effectiveDate: values.effectiveDate,
      minuteReference: values.minuteReference || undefined,
    });
    setSubmitting(false);

    if (result.ok) {
      toast.success("Roll action recorded.");
      form.reset(RECORD_ROLL_ACTION_DEFAULT_VALUES);
      router.refresh();
    } else {
      // NO reset here — same discipline as EditPersonForm (req 9).
      toast.error(result.error);
    }
  }

  return (
    // M2 (docs/reviews/2026-08-26-portal-ux.md): the `border-t pt-6` divider
    // this wrapper used to carry is gone — `page.tsx` now wraps this form in
    // its own `bg-card` panel, which supplies the visual separation from
    // `EditPersonForm` above it.
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Record a roll action</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Proposes a new roll action for this person. A holder of
          roll.approve must still approve it on the pending worklist before
          it takes effect.
        </p>
      </div>

      {pendingActions.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">
            {pendingActions.length === 1
              ? "An action is already pending review:"
              : "Actions are already pending review:"}
          </p>
          <ul className="mt-1 list-inside list-disc">
            {pendingActions.map((action) => (
              <li key={action.id}>
                {ROLL_ACTION_KIND_LABELS[action.kind]} effective{" "}
                {action.effectiveDate}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <Label htmlFor="record-roll-action-kind">Roll action</Label>
          <div className="relative">
            <select
              id="record-roll-action-kind"
              className={SELECT_CLASSES}
              aria-invalid={errors.kind ? "true" : undefined}
              aria-describedby={
                errors.kind ? "record-roll-action-kind-error" : undefined
              }
              {...register("kind")}
            >
              {EDIT_TIME_ROLL_ACTION_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {ROLL_ACTION_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
            <ChevronDown
              className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>
          {errors.kind && (
            <p
              id="record-roll-action-kind-error"
              className="mt-1 text-sm text-destructive"
            >
              {errors.kind.message}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="record-roll-action-effective-date">
            Effective date
          </Label>
          <Input
            id="record-roll-action-effective-date"
            type="date"
            aria-invalid={errors.effectiveDate ? "true" : undefined}
            aria-describedby={
              errors.effectiveDate
                ? "record-roll-action-effective-date-error"
                : undefined
            }
            className="mt-1"
            {...register("effectiveDate")}
          />
          {errors.effectiveDate && (
            <p
              id="record-roll-action-effective-date-error"
              className="mt-1 text-sm text-destructive"
            >
              {errors.effectiveDate.message}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="record-roll-action-minute-reference">
            Minute reference (optional)
          </Label>
          <Input
            id="record-roll-action-minute-reference"
            autoComplete="off"
            className="mt-1"
            {...register("minuteReference")}
          />
        </div>

        <Button
          type="submit"
          disabled={submitting}
          className="min-h-[44px] min-w-[44px]"
        >
          {submitting ? "Recording…" : "Record roll action"}
        </Button>
      </form>
    </div>
  );
}
