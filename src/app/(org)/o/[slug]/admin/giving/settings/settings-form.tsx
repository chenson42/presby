"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog";
import { useUnsavedChangesGuard } from "@/components/shared/use-unsaved-changes-guard";
import { FormField, fieldA11y } from "@/components/giving/form-field";
import {
  GREETING_TOKEN,
  givingSettingsSchema,
  type GivingSettingsInput,
  type GivingSettingsValues,
} from "@/lib/giving/settings-input";
import { updateGivingSettingsAction } from "./actions";

/**
 * Statement details (`giving.manage`) - docs/work-log/2026-10-15-online-giving.md,
 * R5 / DECISION-172. React Hook Form over `givingSettingsSchema` (the action
 * re-parses it), inside `<HydrationGate>` (DECISION-159). Eleven fields with an
 * explicit Save, so it carries the unsaved-changes guard (docs/ui-standards.md
 * "Forms - Unsaved Changes Guard"): leaving with edits opens the shared
 * AlertDialog, and a successful save resets the dirty state.
 */
export function SettingsForm({
  slug,
  initial,
}: {
  slug: string;
  initial: Record<keyof GivingSettingsValues, string | null>;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<GivingSettingsInput, unknown, GivingSettingsValues>({
    resolver: zodResolver(givingSettingsSchema),
    defaultValues: Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, v ?? ""])) as GivingSettingsInput,
  });
  const {
    register,
    setError,
    formState: { errors, isDirty },
  } = form;
  const guard = useUnsavedChangesGuard(isDirty);

  async function onSubmit() {
    setSubmitting(true);
    const result = await updateGivingSettingsAction(slug, form.getValues());
    setSubmitting(false);
    if (result.ok) {
      toast.success("Statement details saved.");
      form.reset(form.getValues());
      router.refresh();
      return;
    }
    if (result.kind === "two_factor_required" && result.redirectTo) {
      window.location.assign(result.redirectTo);
      return;
    }
    for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
      setError(field as keyof GivingSettingsInput, { message });
    }
    toast.error(result.error);
  }

  return (
    <>
    <HydrationGate>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8" noValidate>
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Who the statement is from</h3>
          <FormField
            id="settings-legal-name"
            label="Legal name of the church"
            hint="Exactly as it appears on your IRS determination letter."
            error={errors.doneeLegalName?.message}
          >
            <Input type="text" autoComplete="off" {...fieldA11y("settings-legal-name", errors.doneeLegalName?.message, true)} {...register("doneeLegalName")} />
          </FormField>
          <FormField id="settings-address1" label="Street address" error={errors.doneeAddressLine1?.message}>
            <Input type="text" autoComplete="off" {...fieldA11y("settings-address1", errors.doneeAddressLine1?.message)} {...register("doneeAddressLine1")} />
          </FormField>
          <FormField id="settings-address2" label="Address line 2 (optional)" error={errors.doneeAddressLine2?.message}>
            <Input type="text" autoComplete="off" {...fieldA11y("settings-address2", errors.doneeAddressLine2?.message)} {...register("doneeAddressLine2")} />
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FormField id="settings-city" label="City" error={errors.doneeCity?.message}>
              <Input type="text" autoComplete="off" {...fieldA11y("settings-city", errors.doneeCity?.message)} {...register("doneeCity")} />
            </FormField>
            <FormField id="settings-region" label="State" hint="Two letters, like OH." error={errors.doneeRegion?.message}>
              <Input type="text" autoComplete="off" maxLength={2} {...fieldA11y("settings-region", errors.doneeRegion?.message, true)} {...register("doneeRegion")} />
            </FormField>
            <FormField id="settings-zip" label="ZIP" error={errors.doneePostalCode?.message}>
              <Input type="text" inputMode="numeric" autoComplete="off" {...fieldA11y("settings-zip", errors.doneePostalCode?.message)} {...register("doneePostalCode")} />
            </FormField>
          </div>
          <FormField
            id="settings-ein"
            label="EIN (optional)"
            hint="Written like 12-3456789."
            error={errors.doneeEin?.message}
          >
            <Input type="text" autoComplete="off" {...fieldA11y("settings-ein", errors.doneeEin?.message, true)} {...register("doneeEin")} />
          </FormField>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-medium">Who signs it</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField id="settings-signatory" label="Name" error={errors.signatoryName?.message}>
              <Input type="text" autoComplete="off" {...fieldA11y("settings-signatory", errors.signatoryName?.message)} {...register("signatoryName")} />
            </FormField>
            <FormField id="settings-signatory-title" label="Title" error={errors.signatoryTitle?.message}>
              <Input type="text" autoComplete="off" {...fieldA11y("settings-signatory-title", errors.signatoryTitle?.message)} {...register("signatoryTitle")} />
            </FormField>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-medium">Wording</h3>
          <FormField
            id="settings-greeting"
            label="Greeting"
            hint={`Use ${GREETING_TOKEN} where each donor's name should go. For example: Dear ${GREETING_TOKEN},`}
            error={errors.greetingText?.message}
          >
            <Textarea rows={3} {...fieldA11y("settings-greeting", errors.greetingText?.message, true)} {...register("greetingText")} />
          </FormField>
          <FormField
            id="settings-closing"
            label="Closing"
            hint="Printed after the list of gifts."
            error={errors.closingText?.message}
          >
            <Textarea rows={3} {...fieldA11y("settings-closing", errors.closingText?.message, true)} {...register("closingText")} />
          </FormField>
        </div>

        <Button type="submit" className="min-h-11" disabled={submitting}>
          {submitting ? "Saving…" : "Save statement details"}
        </Button>
      </form>
    </HydrationGate>
    <UnsavedChangesDialog
      open={guard.discardOpen}
      onOpenChange={guard.setDiscardOpen}
      onConfirmDiscard={guard.confirmDiscard}
    />
    </>
  );
}
