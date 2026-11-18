"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog";
import { useUnsavedChangesGuard } from "@/components/shared/use-unsaved-changes-guard";
import { reportFailure } from "@/components/oversight/form-result";
import { SelectField } from "@/components/oversight/select-field";
import { TextField } from "@/components/oversight/text-field";
import { YearField } from "@/components/oversight/year-field";
import { BUILDING_TYPES, CONDITIONS } from "@/lib/oversight/contract";
import { TOAST } from "@/lib/oversight/copy";
import type { BuildingRow } from "@/lib/oversight/reads";
import { buildingSchema, type BuildingValues, type ValidationEnv } from "@/lib/oversight/validate";
import { createBuildingAction, updateBuildingAction } from "./actions";

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;

const triState = (value: boolean | null): string => (value === null ? "" : value ? "yes" : "no");

function defaultValues(building: BuildingRow | null): BuildingValues {
  const text = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
  return {
    name: building?.name ?? "",
    buildingType: building?.buildingType ?? "",
    primary: building?.isPrimary ?? false,
    yearBuilt: text(building?.yearBuilt),
    firstAdditionYear: text(building?.firstAdditionYear),
    secondAdditionYear: text(building?.secondAdditionYear),
    squareFeet: text(building?.squareFeet),
    roofCondition: building?.roofCondition ?? "",
    plumbingCondition: building?.plumbingCondition ?? "",
    hvacCondition: building?.hvacCondition ?? "",
    boilerCondition: building?.boilerCondition ?? "",
    hasSprinklers: triState(building?.hasSprinklers ?? null),
    hasFireAlarm: triState(building?.hasFireAlarm ?? null),
    hasSecuritySystem: triState(building?.hasSecuritySystem ?? null),
    notes: building?.notes ?? "",
  };
}

/**
 * The building form (C5), one component for "Add a building" and "Edit
 * building". A name and a type are required; every other fact is optional (an
 * empty choice reads "Not recorded"). A retired building cannot be primary, so
 * the checkbox is disabled for one. A create returns to the record page; an edit
 * stays and refreshes (and resets the form to what was saved).
 */
export function BuildingForm({
  slug,
  aboutOrgId,
  env,
  building,
}: {
  slug: string;
  aboutOrgId: string;
  env: ValidationEnv;
  /** Null for "Add a building". */
  building: BuildingRow | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const schema = useMemo(() => buildingSchema(env), [env]);
  const form = useForm<BuildingValues>({ resolver: zodResolver(schema), defaultValues: defaultValues(building) });
  const {
    register,
    formState: { errors, isDirty },
  } = form;
  const { discardOpen, setDiscardOpen, confirmDiscard } = useUnsavedChangesGuard(isDirty);
  const recordHref = `/o/${slug}/admin/oversight/${aboutOrgId}`;
  const cancelHref = building ? `${recordHref}/buildings/${building.id}` : recordHref;
  const retired = building?.retiredOn != null;

  async function onSubmit(values: BuildingValues) {
    setSubmitting(true);
    const result = building
      ? await updateBuildingAction(slug, aboutOrgId, building.id, values, building.rowVersion)
      : await createBuildingAction(slug, aboutOrgId, values);
    setSubmitting(false);
    if (!result.ok) {
      reportFailure(result, form, "name");
      return;
    }
    if (result.data?.unchanged) {
      toast.info(TOAST.noChanges);
      return;
    }
    form.reset(values);
    if (building) {
      toast.success(TOAST.buildingSaved);
      router.refresh();
    } else {
      toast.success(TOAST.buildingAdded);
      router.push(recordHref);
    }
  }

  return (
    <HydrationGate>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="max-w-xl space-y-4">
        <TextField id="building-name" label="Name" error={errors.name?.message} registration={register("name")} />
        <SelectField
          id="building-type"
          label="Type"
          error={errors.buildingType?.message}
          registration={register("buildingType")}
          options={BUILDING_TYPES}
          emptyLabel="Choose a type"
        />
        <div>
          <div className="flex min-h-11 items-center gap-3">
            {/* A retired building cannot be primary: a disabled, UNREGISTERED box (react-hook-form reads a disabled control as undefined), so the value stays false. */}
            <input
              id="building-primary"
              type="checkbox"
              aria-describedby="building-primary-hint"
              className="size-5 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
              {...(retired ? { disabled: true, checked: false, readOnly: true } : register("primary"))}
            />
            <Label htmlFor="building-primary">Primary building</Label>
          </div>
          <p id="building-primary-hint" className="text-sm text-muted-foreground">
            Only one building can be the primary. Choosing this one moves the mark from the current primary building, if there is one.
          </p>
        </div>
        <YearField id="building-year-built" label="Year built" error={errors.yearBuilt?.message} registration={register("yearBuilt")} />
        <YearField
          id="building-first-addition"
          label="First addition"
          error={errors.firstAdditionYear?.message}
          registration={register("firstAdditionYear")}
        />
        <YearField
          id="building-second-addition"
          label="Second addition"
          error={errors.secondAdditionYear?.message}
          registration={register("secondAdditionYear")}
        />
        <TextField
          id="building-square-feet"
          label="Square feet"
          inputMode="numeric"
          error={errors.squareFeet?.message}
          registration={register("squareFeet")}
        />
        <SelectField
          id="building-roof"
          label="Roof condition"
          error={errors.roofCondition?.message}
          registration={register("roofCondition")}
          options={CONDITIONS}
          emptyLabel="Not recorded"
        />
        <SelectField
          id="building-plumbing"
          label="Plumbing condition"
          error={errors.plumbingCondition?.message}
          registration={register("plumbingCondition")}
          options={CONDITIONS}
          emptyLabel="Not recorded"
        />
        <SelectField
          id="building-hvac"
          label="Heating and cooling (HVAC) condition"
          error={errors.hvacCondition?.message}
          registration={register("hvacCondition")}
          options={CONDITIONS}
          emptyLabel="Not recorded"
        />
        <SelectField
          id="building-boiler"
          label="Boiler condition"
          error={errors.boilerCondition?.message}
          registration={register("boilerCondition")}
          options={CONDITIONS}
          emptyLabel="Not recorded"
        />
        <SelectField
          id="building-sprinklers"
          label="Sprinklers"
          error={errors.hasSprinklers?.message}
          registration={register("hasSprinklers")}
          options={YES_NO}
          emptyLabel="Not recorded"
        />
        <SelectField
          id="building-fire-alarm"
          label="Fire alarm"
          error={errors.hasFireAlarm?.message}
          registration={register("hasFireAlarm")}
          options={YES_NO}
          emptyLabel="Not recorded"
        />
        <SelectField
          id="building-security"
          label="Security system"
          error={errors.hasSecuritySystem?.message}
          registration={register("hasSecuritySystem")}
          options={YES_NO}
          emptyLabel="Not recorded"
        />
        <TextField id="building-notes" label="Notes" rows={4} error={errors.notes?.message} registration={register("notes")} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={submitting} className="min-h-11">
            {submitting ? "Saving…" : "Save building"}
          </Button>
          <Button asChild variant="outline" className="min-h-11">
            <Link href={cancelHref}>Cancel</Link>
          </Button>
        </div>
        <UnsavedChangesDialog open={discardOpen} onOpenChange={setDiscardOpen} onConfirmDiscard={confirmDiscard} />
      </form>
    </HydrationGate>
  );
}
