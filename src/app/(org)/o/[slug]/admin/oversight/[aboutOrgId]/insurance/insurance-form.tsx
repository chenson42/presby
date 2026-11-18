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
import { SelectField } from "@/components/oversight/select-field";
import { TextField } from "@/components/oversight/text-field";
import { TOAST } from "@/lib/oversight/copy";
import type { InsuranceRow } from "@/lib/oversight/reads";
import { insuranceSchema, type InsuranceValues, type ValidationEnv } from "@/lib/oversight/validate";
import { recordInsuranceAction, updateInsuranceAction } from "./actions";

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;

const triState = (value: boolean | null): string => (value === null ? "" : value ? "yes" : "no");

function defaultValues(year: InsuranceRow | null): InsuranceValues {
  return {
    policyYear: year ? String(year.policyYear) : "",
    carrier: year?.carrier ?? "",
    policyNumber: year?.policyNumber ?? "",
    policyExpiresOn: year?.policyExpiresOn ?? "",
    recentClaims: triState(year?.recentClaims ?? null),
    poolInterest: triState(year?.poolInterest ?? null),
    notes: year?.notes ?? "",
  };
}

/**
 * One policy year (C7), for "Record insurance for a year" and "Edit insurance for
 * {year}". The policy year is read-only on an edit (remove and re-record). A
 * create returns to the record page; an edit stays and refreshes.
 */
export function InsuranceForm({
  slug,
  aboutOrgId,
  env,
  year,
}: {
  slug: string;
  aboutOrgId: string;
  env: ValidationEnv;
  /** Null to record a new year. */
  year: InsuranceRow | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const mode = year ? "edit" : "create";
  const schema = useMemo(() => insuranceSchema(env, mode), [env, mode]);
  const form = useForm<InsuranceValues>({ resolver: zodResolver(schema), defaultValues: defaultValues(year) });
  const {
    register,
    formState: { errors, isDirty },
  } = form;
  const { discardOpen, setDiscardOpen, confirmDiscard } = useUnsavedChangesGuard(isDirty);
  const recordHref = `/o/${slug}/admin/oversight/${aboutOrgId}`;

  async function onSubmit(values: InsuranceValues) {
    setSubmitting(true);
    const result = year
      ? await updateInsuranceAction(slug, aboutOrgId, year.id, values, year.rowVersion)
      : await recordInsuranceAction(slug, aboutOrgId, values);
    setSubmitting(false);
    if (!result.ok) {
      reportFailure(result, form, "policyYear");
      return;
    }
    if (result.data?.unchanged) {
      toast.info(TOAST.noChanges);
      return;
    }
    toast.success(TOAST.insuranceSaved);
    form.reset(values);
    if (year) router.refresh();
    else router.push(recordHref);
  }

  return (
    <HydrationGate>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="max-w-xl space-y-4">
        <TextField
          id="insurance-year"
          label="Policy year"
          inputMode="numeric"
          readOnly={year !== null}
          error={errors.policyYear?.message}
          registration={register("policyYear")}
        />
        <TextField id="insurance-carrier" label="Carrier" error={errors.carrier?.message} registration={register("carrier")} />
        <TextField
          id="insurance-policy-number"
          label="Policy number"
          error={errors.policyNumber?.message}
          registration={register("policyNumber")}
        />
        <TextField
          id="insurance-expires"
          label="Policy expires"
          type="date"
          error={errors.policyExpiresOn?.message}
          registration={register("policyExpiresOn")}
        />
        <SelectField
          id="insurance-claims"
          label="Recent claims"
          error={errors.recentClaims?.message}
          registration={register("recentClaims")}
          options={YES_NO}
          emptyLabel="Not recorded"
        />
        <SelectField
          id="insurance-pool"
          label="Interested in the insurance pool"
          error={errors.poolInterest?.message}
          registration={register("poolInterest")}
          options={YES_NO}
          emptyLabel="Not recorded"
        />
        <TextField id="insurance-notes" label="Notes" rows={4} error={errors.notes?.message} registration={register("notes")} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={submitting} className="min-h-11">
            {submitting ? "Saving…" : "Save insurance"}
          </Button>
          <Button asChild variant="outline" className="min-h-11">
            <Link href={recordHref}>Cancel</Link>
          </Button>
        </div>
        <UnsavedChangesDialog open={discardOpen} onOpenChange={setDiscardOpen} onConfirmDiscard={confirmDiscard} />
      </form>
    </HydrationGate>
  );
}
