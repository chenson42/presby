"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequiredMark } from "@/components/shared/required-mark";
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog";
import { useUnsavedChangesGuard } from "@/components/shared/use-unsaved-changes-guard";
import type { RecordOrdinationInput } from "@/lib/credentials";
import { MINISTRY_LABELS, ORDAINED_MINISTRIES } from "./credential-labels";
import {
  recordOrdinationSchema,
  type RecordOrdinationFormValues,
} from "./credential-schema";
import { recordOrdinationAction } from "./actions";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function defaultValues(
  people: Array<{ personId: string; displayName: string }>,
): RecordOrdinationFormValues {
  return {
    personId: people[0]?.personId ?? "",
    ministry: "ruling_elder",
    ordainedOn: "",
    minuteReference: "",
  };
}

/**
 * Records a new ordination — Flow 1. `react-hook-form` + `zod`
 * (DECISION-096's already-approved deps, matching
 * `../officers/add-officer-term-form.tsx`'s pattern).
 *
 * THE TRANSFERRING-IN-MINISTER EMPTY STATE (Phase 3 Edge Cases, verbatim
 * copy): if `people` is empty, this renders a message naming the actual
 * next step (add them via Members) rather than a dead end — never a
 * create-person affordance inline here (DECISION-116 ruling 3).
 */
export function RecordOrdinationForm({
  slug,
  people,
}: {
  slug: string;
  people: Array<{ personId: string; displayName: string }>;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<RecordOrdinationFormValues>({
    resolver: zodResolver(recordOrdinationSchema),
    defaultValues: defaultValues(people),
  });

  const {
    register,
    formState: { errors, isDirty },
  } = form;

  const { discardOpen, setDiscardOpen, confirmDiscard } =
    useUnsavedChangesGuard(isDirty);

  if (people.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No one available to record. A minister must hold membership at this
        presbytery first —{" "}
        <a
          href={`/o/${slug}/admin/members`}
          className="text-primary underline-offset-4 hover:underline"
        >
          add them via Members
        </a>
        .
      </p>
    );
  }

  async function onSubmit(values: RecordOrdinationFormValues) {
    const input: RecordOrdinationInput = {
      personId: values.personId,
      ministry: values.ministry,
      ordainedOn: values.ordainedOn,
      minuteReference: values.minuteReference || undefined,
    };

    setSubmitting(true);
    const result = await recordOrdinationAction(slug, input);
    setSubmitting(false);

    if (result.ok) {
      toast.success("Ordination recorded.");
      form.reset(defaultValues(people));
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="ordination-person">
          Person
          <RequiredMark />
        </Label>
        <div className="relative mt-1">
          <select
            id="ordination-person"
            className={SELECT_CLASSES}
            aria-required="true"
            {...register("personId")}
          >
            {people.map((person) => (
              <option key={person.personId} value={person.personId}>
                {person.displayName}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>
        {errors.personId && (
          <p className="mt-1 text-sm text-destructive">
            {errors.personId.message}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="ordination-ministry">
          Ministry
          <RequiredMark />
        </Label>
        <div className="relative mt-1">
          <select
            id="ordination-ministry"
            className={SELECT_CLASSES}
            aria-required="true"
            {...register("ministry")}
          >
            {ORDAINED_MINISTRIES.map((value) => (
              <option key={value} value={value}>
                {MINISTRY_LABELS[value]}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>
      </div>

      <div>
        <Label htmlFor="ordination-ordained-on">
          Ordained on
          <RequiredMark />
        </Label>
        <Input
          id="ordination-ordained-on"
          type="date"
          aria-invalid={errors.ordainedOn ? "true" : undefined}
          aria-describedby={
            errors.ordainedOn ? "ordination-ordained-on-error" : undefined
          }
          aria-required="true"
          className="mt-1"
          {...register("ordainedOn")}
        />
        {errors.ordainedOn && (
          <p
            id="ordination-ordained-on-error"
            className="mt-1 text-sm text-destructive"
          >
            {errors.ordainedOn.message}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="ordination-minute-reference">
          Minute reference (optional)
        </Label>
        <Input
          id="ordination-minute-reference"
          type="text"
          placeholder="e.g. Presbytery minutes, 12 Jan 2026"
          className="mt-1"
          {...register("minuteReference")}
        />
        {errors.minuteReference && (
          <p className="mt-1 text-sm text-destructive">
            {errors.minuteReference.message}
          </p>
        )}
        <p className="mt-1 text-sm text-muted-foreground">
          Recommended — this is the only paper trail confirming the
          ordination actually happened.
        </p>
      </div>

      <Button type="submit" disabled={submitting} className="min-h-11">
        {submitting ? "Recording…" : "Record ordination"}
      </Button>
      <UnsavedChangesDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirmDiscard={confirmDiscard}
      />
    </form>
  );
}
