"use client";

import type { UseFormReturn } from "react-hook-form";
import { ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { RequiredMark } from "@/components/shared/required-mark";
import { WizardField } from "./wizard-field";
import type { MemberWizardValues } from "./member-wizard-schema";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function HouseholdStep({
  form,
  households,
  mode,
}: {
  form: UseFormReturn<MemberWizardValues>;
  households: { householdId: string; name: string }[];
  /** Lifted from the parent's own `useWatch()` subscription (compiler-
   * friendly) rather than this component calling `form.watch()` itself —
   * see `member-wizard.tsx`'s identical comment on why `watch()` is
   * avoided. */
  mode: MemberWizardValues["household"]["mode"];
}) {
  const {
    register,
    formState: { errors },
  } = form;

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Household</legend>
        <div className="flex flex-col gap-2">
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              value="none"
              {...register("household.mode")}
              className="h-4 w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            No household yet
          </label>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              value="existing"
              {...register("household.mode")}
              className="h-4 w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              disabled={households.length === 0}
            />
            Add to an existing household
          </label>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              value="new"
              {...register("household.mode")}
              className="h-4 w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            Create a new household
          </label>
        </div>
      </fieldset>

      {mode === "existing" && (
        households.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No households exist yet. Choose &quot;Create a new household&quot;
            instead.
          </p>
        ) : (
          <div>
            <Label htmlFor="member-wizard-household-id">
              Household
              <RequiredMark />
            </Label>
            <div className="relative mt-1">
              <select
                id="member-wizard-household-id"
                className={SELECT_CLASSES}
                aria-required="true"
                {...register("household.householdId")}
              >
                <option value="">Choose a household…</option>
                {households.map((h) => (
                  <option key={h.householdId} value={h.householdId}>
                    {h.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
            </div>
            {errors.household?.householdId && (
              <p className="mt-1 text-sm text-destructive">
                {errors.household.householdId.message}
              </p>
            )}
          </div>
        )
      )}

      {mode === "new" && (
        <WizardField
          name="household.name"
          label="Household name"
          register={register}
          errors={errors}
          autoComplete="off"
          required
        />
      )}
    </div>
  );
}
