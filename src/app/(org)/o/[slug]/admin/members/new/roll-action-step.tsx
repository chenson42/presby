"use client";

import type { UseFormReturn } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { WizardField } from "./wizard-field";
import {
  ROLL_ACTION_KIND_LABELS,
  type MemberWizardValues,
} from "./member-wizard-schema";

const SELECT_CLASSES =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Req 4: `effectiveDate` is a native `<input type="date">`, never a
 * hand-rolled calendar grid. */
export function RollActionStep({
  form,
}: {
  form: UseFormReturn<MemberWizardValues>;
}) {
  const {
    register,
    formState: { errors },
  } = form;

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="member-wizard-roll-kind">Roll action</Label>
        <select
          id="member-wizard-roll-kind"
          className={SELECT_CLASSES}
          {...register("rollAction.kind")}
        >
          {Object.entries(ROLL_ACTION_KIND_LABELS).map(([kind, label]) => (
            <option key={kind} value={kind}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <WizardField
        name="rollAction.effectiveDate"
        label="Effective date"
        type="date"
        register={register}
        errors={errors}
      />
      <WizardField
        name="rollAction.minuteReference"
        label="Minute reference (optional)"
        register={register}
        errors={errors}
        autoComplete="off"
      />
    </div>
  );
}
