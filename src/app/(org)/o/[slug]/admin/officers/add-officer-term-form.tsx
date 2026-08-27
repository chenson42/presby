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
import type {
  OfficerFormOptions,
  StartOfficerTermInput,
} from "@/lib/officers";
import { OFFICE_LABELS, OFFICER_OFFICES } from "./office-labels";
import {
  officerTermSchema,
  type OfficerTermFormValues,
} from "./officer-term-schema";
import { startOfficerTermAction } from "./actions";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function defaultValues(options: OfficerFormOptions): OfficerTermFormValues {
  return {
    personId: options.people[0]?.personId ?? "",
    office: "ruling_elder",
    startsOn: "",
    electedOn: "",
    installedOn: "",
    classYear: "",
    minuteReference: "",
    orgUnitId: "",
  };
}

/**
 * Records a new officer term — Flow 1. `react-hook-form` + `zod`
 * (DECISION-096, already-approved deps; this form clears
 * `docs/ui-standards.md`'s field-count threshold for the pattern: person,
 * office, three dates, class year, minute reference, and a conditional
 * district is eight possible fields).
 *
 * THE `org_unit` `<select>` ONLY RENDERS WHEN `office === "deacon"` — client
 * mirror of the DB's `officer_terms_org_unit_deacon_check` CHECK constraint,
 * enforced FIRST by `officer-term-schema.ts`'s `superRefine`, and again,
 * defensively, server-side inside `startOfficerTerm` (Phase 3's
 * three-layer discipline: this file, the server function, the DB
 * constraint as a last-resort backstop that should never actually fire).
 *
 * ERROR SURFACING: `startOfficerTermAction` already maps every
 * `OfficersResult` denial (forbidden / invalid_target / invalid_input /
 * the exclusion-violation `overlap` case) to one human-readable
 * `ActionResult.error` string server-side (Phase 3's API-contract table) —
 * this form's only job is to show that string verbatim via `toast.error()`,
 * never to re-interpret or replace it. On success, the form resets (a
 * fresh term is a fresh entry, unlike `EditPersonForm`'s "don't discard
 * on failure" rule, which applies to edits of existing data, not adds).
 *
 * THE TWO-UNLINKED-SYSTEMS COPY (Phase 1/2/3's naming-trap finding) lives one
 * level up, in `page.tsx`, next to this form's own heading — not duplicated
 * here.
 */
export function AddOfficerTermForm({
  slug,
  options,
}: {
  slug: string;
  options: OfficerFormOptions;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<OfficerTermFormValues>({
    resolver: zodResolver(officerTermSchema),
    defaultValues: defaultValues(options),
  });

  const {
    register,
    formState: { errors, isDirty },
  } = form;
  const office = useWatch({ control: form.control, name: "office" });
  const isDeacon = office === "deacon";

  // H3 (docs/reviews/2026-08-26-portal-ux.md) — this form has no in-form
  // Back/Cancel link of its own; the guard's document-level click
  // interception (see the hook's header) is what protects a dirty draft
  // from the surrounding page's own navigation while this component is
  // mounted.
  const { discardOpen, setDiscardOpen, confirmDiscard } =
    useUnsavedChangesGuard(isDirty);

  if (options.people.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nobody has a current membership at this organization yet. Add a
        member first, then come back to record an officer term.
      </p>
    );
  }

  const districtListEmpty = isDeacon && options.orgUnits.length === 0;

  async function onSubmit(values: OfficerTermFormValues) {
    const input: StartOfficerTermInput = {
      personId: values.personId,
      office: values.office,
      startsOn: values.startsOn,
      electedOn: values.electedOn || undefined,
      installedOn: values.installedOn || undefined,
      classYear: values.classYear ? Number(values.classYear) : undefined,
      minuteReference: values.minuteReference || undefined,
      orgUnitId: values.office === "deacon" ? values.orgUnitId : undefined,
    };

    setSubmitting(true);
    const result = await startOfficerTermAction(slug, input);
    setSubmitting(false);

    if (result.ok) {
      toast.success("Officer term recorded.");
      form.reset(defaultValues(options));
      // `startOfficerTermAction` already calls `revalidatePath()`
      // server-side, which marks the cache stale but does not re-render an
      // already-mounted page — same fix `grant-role-form.tsx`'s identical
      // comment documents, confirmed live in a real-browser walkthrough.
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Label htmlFor="officer-term-person">
          Person
          <RequiredMark />
        </Label>
        <div className="relative mt-1">
          <select
            id="officer-term-person"
            className={SELECT_CLASSES}
            aria-required="true"
            {...register("personId")}
          >
            {options.people.map((person) => (
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
        <Label htmlFor="officer-term-office">
          Office
          <RequiredMark />
        </Label>
        <div className="relative mt-1">
          <select
            id="officer-term-office"
            className={SELECT_CLASSES}
            aria-required="true"
            {...register("office")}
          >
            {OFFICER_OFFICES.map((value) => (
              <option key={value} value={value}>
                {OFFICE_LABELS[value]}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>
      </div>

      {isDeacon &&
        (districtListEmpty ? (
          <p className="text-sm text-muted-foreground">
            No districts exist at this organization yet. Add one before
            recording a deacon term.
          </p>
        ) : (
          <div>
            <Label htmlFor="officer-term-org-unit">
              District
              <RequiredMark />
            </Label>
            <div className="relative mt-1">
              <select
                id="officer-term-org-unit"
                className={SELECT_CLASSES}
                aria-required="true"
                {...register("orgUnitId")}
              >
                <option value="">Choose a district…</option>
                {options.orgUnits.map((orgUnit) => (
                  <option key={orgUnit.orgUnitId} value={orgUnit.orgUnitId}>
                    {orgUnit.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
            </div>
            {errors.orgUnitId && (
              <p className="mt-1 text-sm text-destructive">
                {errors.orgUnitId.message}
              </p>
            )}
          </div>
        ))}

      <div>
        <Label htmlFor="officer-term-starts-on">
          Start date
          <RequiredMark />
        </Label>
        <Input
          id="officer-term-starts-on"
          type="date"
          aria-invalid={errors.startsOn ? "true" : undefined}
          aria-describedby={
            errors.startsOn ? "officer-term-starts-on-error" : undefined
          }
          aria-required="true"
          className="mt-1"
          {...register("startsOn")}
        />
        {errors.startsOn && (
          <p
            id="officer-term-starts-on-error"
            className="mt-1 text-sm text-destructive"
          >
            {errors.startsOn.message}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="officer-term-elected-on">
          Elected on (optional)
        </Label>
        <Input
          id="officer-term-elected-on"
          type="date"
          className="mt-1"
          {...register("electedOn")}
        />
      </div>

      <div>
        <Label htmlFor="officer-term-installed-on">
          Installed on (optional)
        </Label>
        <Input
          id="officer-term-installed-on"
          type="date"
          className="mt-1"
          {...register("installedOn")}
        />
      </div>

      <div>
        <Label htmlFor="officer-term-class-year">
          Class year (optional)
        </Label>
        <Input
          id="officer-term-class-year"
          type="text"
          inputMode="numeric"
          placeholder="e.g. 2028"
          className="mt-1"
          {...register("classYear")}
        />
        {errors.classYear && (
          <p className="mt-1 text-sm text-destructive">
            {errors.classYear.message}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="officer-term-minute-reference">
          Minute reference (optional)
        </Label>
        <Input
          id="officer-term-minute-reference"
          type="text"
          placeholder="e.g. Session minutes, 12 Jan 2026"
          className="mt-1"
          {...register("minuteReference")}
        />
        <p className="mt-1 text-sm text-muted-foreground">
          Recommended — this is the only paper trail confirming the
          election or installation actually happened.
        </p>
      </div>

      <Button
        type="submit"
        disabled={submitting || districtListEmpty}
        className="min-h-11"
      >
        {submitting ? "Recording…" : "Add officer term"}
      </Button>
      <UnsavedChangesDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirmDiscard={confirmDiscard}
      />
    </form>
  );
}
