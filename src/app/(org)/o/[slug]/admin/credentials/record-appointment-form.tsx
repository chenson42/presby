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
import type { RecordAppointmentInput } from "@/lib/credentials";
import { APPOINTMENT_CALL_TYPES, CALL_TYPE_LABELS } from "./credential-labels";
import {
  recordAppointmentSchema,
  type RecordAppointmentFormValues,
} from "./credential-schema";
import { recordAppointmentAction } from "./actions";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

interface ServingOrgOption {
  organizationId: string;
  name: string;
  platformStatus: string;
}

function defaultValues(
  people: Array<{ personId: string; displayName: string }>,
  servingOrgs: ServingOrgOption[],
): RecordAppointmentFormValues {
  return {
    personId: people[0]?.personId ?? "",
    servingOrgId: servingOrgs[0]?.organizationId ?? "",
    callType: "installed_pastor",
    startsOn: "",
    minuteReference: "",
  };
}

/**
 * Records a new pastoral appointment — Flow 2. `react-hook-form` + `zod`,
 * same pattern as `record-ordination-form.tsx`/`../officers/
 * add-officer-term-form.tsx`.
 *
 * `platformStatus` IS SHOWN alongside each serving-org option (Phase 3 Edge
 * Cases: this is presbytery-internal information, legitimate to surface —
 * see `src/lib/credentials.ts`'s `getCredentialsFormOptions` header).
 *
 * SAME TRANSFERRING-IN-MINISTER EMPTY STATE as `record-ordination-form.tsx`
 * when `people` is empty. A SEPARATE empty state covers a presbytery with
 * no member congregations at all (`servingOrgs` empty) — naming that
 * directly rather than rendering a form with a dead dropdown.
 */
export function RecordAppointmentForm({
  slug,
  people,
  servingOrgs,
}: {
  slug: string;
  people: Array<{ personId: string; displayName: string }>;
  servingOrgs: ServingOrgOption[];
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<RecordAppointmentFormValues>({
    resolver: zodResolver(recordAppointmentSchema),
    defaultValues: defaultValues(people, servingOrgs),
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

  if (servingOrgs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No member congregations are on record for this presbytery yet.
      </p>
    );
  }

  async function onSubmit(values: RecordAppointmentFormValues) {
    const input: RecordAppointmentInput = {
      personId: values.personId,
      servingOrgId: values.servingOrgId,
      callType: values.callType,
      startsOn: values.startsOn,
      minuteReference: values.minuteReference || undefined,
    };

    setSubmitting(true);
    const result = await recordAppointmentAction(slug, input);
    setSubmitting(false);

    if (result.ok) {
      toast.success("Appointment recorded.");
      form.reset(defaultValues(people, servingOrgs));
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="appointment-person">
          Person
          <RequiredMark />
        </Label>
        <div className="relative mt-1">
          <select
            id="appointment-person"
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
        <Label htmlFor="appointment-serving-org">
          Serving at
          <RequiredMark />
        </Label>
        <div className="relative mt-1">
          <select
            id="appointment-serving-org"
            className={SELECT_CLASSES}
            aria-required="true"
            {...register("servingOrgId")}
          >
            {servingOrgs.map((org) => (
              <option key={org.organizationId} value={org.organizationId}>
                {org.name} ({org.platformStatus})
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>
        {errors.servingOrgId && (
          <p className="mt-1 text-sm text-destructive">
            {errors.servingOrgId.message}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="appointment-call-type">
          Call type
          <RequiredMark />
        </Label>
        <div className="relative mt-1">
          <select
            id="appointment-call-type"
            className={SELECT_CLASSES}
            aria-required="true"
            {...register("callType")}
          >
            {APPOINTMENT_CALL_TYPES.map((value) => (
              <option key={value} value={value}>
                {CALL_TYPE_LABELS[value]}
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
        <Label htmlFor="appointment-starts-on">
          Start date
          <RequiredMark />
        </Label>
        <Input
          id="appointment-starts-on"
          type="date"
          aria-invalid={errors.startsOn ? "true" : undefined}
          aria-describedby={
            errors.startsOn ? "appointment-starts-on-error" : undefined
          }
          aria-required="true"
          className="mt-1"
          {...register("startsOn")}
        />
        {errors.startsOn && (
          <p
            id="appointment-starts-on-error"
            className="mt-1 text-sm text-destructive"
          >
            {errors.startsOn.message}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="appointment-minute-reference">
          Minute reference (optional)
        </Label>
        <Input
          id="appointment-minute-reference"
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
      </div>

      <Button type="submit" disabled={submitting} className="min-h-11">
        {submitting ? "Recording…" : "Record appointment"}
      </Button>
      <UnsavedChangesDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirmDiscard={confirmDiscard}
      />
    </form>
  );
}
