"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog";
import { useUnsavedChangesGuard } from "@/components/shared/use-unsaved-changes-guard";
import { reportFailure } from "@/components/oversight/form-result";
import { MoneyField } from "@/components/oversight/money-field";
import { TextField } from "@/components/oversight/text-field";
import { YearField } from "@/components/oversight/year-field";
import { TOAST } from "@/lib/oversight/copy";
import { appraisalSchema, type AppraisalValues, type ValidationEnv } from "@/lib/oversight/validate";
import { recordAppraisalAction } from "./actions";

/**
 * "Record an appraisal" (C6): the year assessed, the amount in dollars (text with
 * the decimal keypad) and notes. Appraisals are never edited (T4): to correct an
 * amount, remove the appraisal and record it again, which the duplicate-year
 * message says. A save returns to the building's page.
 */
export function AppraisalForm({
  slug,
  aboutOrgId,
  buildingId,
  env,
}: {
  slug: string;
  aboutOrgId: string;
  buildingId: string;
  env: ValidationEnv;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const schema = useMemo(() => appraisalSchema(env), [env]);
  const form = useForm<AppraisalValues>({
    resolver: zodResolver(schema),
    defaultValues: { assessedYear: "", amount: "", notes: "" },
  });
  const {
    register,
    formState: { errors, isDirty },
  } = form;
  const { discardOpen, setDiscardOpen, confirmDiscard } = useUnsavedChangesGuard(isDirty);
  const buildingHref = `/o/${slug}/admin/oversight/${aboutOrgId}/buildings/${buildingId}`;

  async function onSubmit(values: AppraisalValues) {
    setSubmitting(true);
    const result = await recordAppraisalAction(slug, aboutOrgId, buildingId, values);
    setSubmitting(false);
    if (!result.ok) {
      reportFailure(result, form, "assessedYear");
      return;
    }
    toast.success(TOAST.appraisalRecorded);
    form.reset(values);
    router.push(buildingHref);
  }

  return (
    <HydrationGate>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="max-w-xl space-y-4">
        <YearField
          id="appraisal-year"
          label="Year assessed"
          error={errors.assessedYear?.message}
          registration={register("assessedYear")}
        />
        <MoneyField
          id="appraisal-amount"
          label="Appraised amount (dollars)"
          hint="Dollars, for example 1250000 or 1250000.50."
          error={errors.amount?.message}
          registration={register("amount")}
        />
        <TextField id="appraisal-notes" label="Notes" rows={3} error={errors.notes?.message} registration={register("notes")} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={submitting} className="min-h-11">
            {submitting ? "Saving…" : "Save appraisal"}
          </Button>
          <Button asChild variant="outline" className="min-h-11">
            <Link href={buildingHref}>Cancel</Link>
          </Button>
        </div>
        <UnsavedChangesDialog open={discardOpen} onOpenChange={setDiscardOpen} onConfirmDiscard={confirmDiscard} />
      </form>
    </HydrationGate>
  );
}
