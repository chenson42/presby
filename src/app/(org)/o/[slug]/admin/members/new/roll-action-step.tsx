"use client";

import type { UseFormReturn } from "react-hook-form";
import { ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { RequiredMark } from "@/components/shared/required-mark";
import { WizardField } from "./wizard-field";
import type { MemberWizardValues } from "./member-wizard-schema";
import {
  ROLL_ACTION_KIND_LABELS,
  WIZARD_ROLL_ACTION_KINDS,
} from "@/lib/roll-action-kinds";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

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
        <Label htmlFor="member-wizard-roll-kind">
          Roll action
          <RequiredMark />
        </Label>
        <div className="relative mt-1">
          <select
            id="member-wizard-roll-kind"
            className={SELECT_CLASSES}
            aria-required="true"
            {...register("rollAction.kind")}
          >
            {/* Allow-list, not the full label map (Phase 2 Note 3): the
                wizard offers only its own 2-kind enrollment subset — the
                same behavior as before this extraction, unchanged. */}
            {WIZARD_ROLL_ACTION_KINDS.map((kind) => (
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
      </div>
      <WizardField
        name="rollAction.effectiveDate"
        label="Effective date"
        type="date"
        register={register}
        errors={errors}
        required
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
