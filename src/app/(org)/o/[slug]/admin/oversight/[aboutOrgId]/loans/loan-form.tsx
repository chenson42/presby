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
import { loanToValues } from "@/components/oversight/loan-values";
import { MoneyField } from "@/components/oversight/money-field";
import { SelectField } from "@/components/oversight/select-field";
import { TextField } from "@/components/oversight/text-field";
import { LOAN_KINDS } from "@/lib/oversight/contract";
import { TOAST } from "@/lib/oversight/copy";
import type { LoanRow } from "@/lib/oversight/reads";
import { loanSchema, type LoanValues, type ValidationEnv } from "@/lib/oversight/validate";
import { recordLoanAction, updateLoanAction } from "./actions";

const EMPTY: LoanValues = {
  kind: "",
  lender: "",
  originalAmount: "",
  currentBalance: "",
  balanceAsOf: "",
  grantsAmount: "",
  guaranteeNote: "",
  notes: "",
  status: "open",
};

/**
 * "Record a loan" and "Edit loan" (C8). Money is dollars typed as text. The loan's
 * status is not a field here: a loan is recorded open, "Mark paid off" and
 * "Reopen this loan" are their own controls on the card, and an edit carries the
 * status it already has. A changed balance needs a new "as of" date (the
 * validator's message, shown under that field). A create returns to the record
 * page; an edit stays and refreshes.
 */
export function LoanForm({
  slug,
  aboutOrgId,
  env,
  loan,
}: {
  slug: string;
  aboutOrgId: string;
  env: ValidationEnv;
  /** Null to record a new loan. */
  loan: LoanRow | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const schema = useMemo(() => loanSchema(env), [env]);
  const form = useForm<LoanValues>({ resolver: zodResolver(schema), defaultValues: loan ? loanToValues(loan) : EMPTY });
  const {
    register,
    formState: { errors, isDirty },
  } = form;
  const { discardOpen, setDiscardOpen, confirmDiscard } = useUnsavedChangesGuard(isDirty);
  const recordHref = `/o/${slug}/admin/oversight/${aboutOrgId}`;

  async function onSubmit(values: LoanValues) {
    setSubmitting(true);
    const result = loan
      ? await updateLoanAction(slug, aboutOrgId, loan.id, values, loan.rowVersion)
      : await recordLoanAction(slug, aboutOrgId, values);
    setSubmitting(false);
    if (!result.ok) {
      reportFailure(result, form);
      return;
    }
    if (result.data?.unchanged) {
      toast.info(TOAST.noChanges);
      return;
    }
    toast.success(TOAST.loanSaved);
    form.reset(values);
    if (loan) router.refresh();
    else router.push(recordHref);
  }

  return (
    <HydrationGate>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="max-w-xl space-y-4">
        <SelectField
          id="loan-kind"
          label="Kind of loan"
          error={errors.kind?.message}
          registration={register("kind")}
          options={LOAN_KINDS}
          emptyLabel="Choose the kind of loan"
        />
        <TextField id="loan-lender" label="Lender" error={errors.lender?.message} registration={register("lender")} />
        <MoneyField
          id="loan-original"
          label="Original amount (dollars)"
          error={errors.originalAmount?.message}
          registration={register("originalAmount")}
        />
        <MoneyField
          id="loan-balance"
          label="Current balance (dollars)"
          error={errors.currentBalance?.message}
          registration={register("currentBalance")}
        />
        <TextField
          id="loan-balance-as-of"
          label="Balance as of"
          type="date"
          error={errors.balanceAsOf?.message}
          registration={register("balanceAsOf")}
        />
        <MoneyField id="loan-grants" label="Grants (dollars)" error={errors.grantsAmount?.message} registration={register("grantsAmount")} />
        <TextField
          id="loan-guarantee"
          label="Guarantee"
          hint="Describe the guarantee, if there is one."
          rows={3}
          error={errors.guaranteeNote?.message}
          registration={register("guaranteeNote")}
        />
        <TextField id="loan-notes" label="Notes" rows={3} error={errors.notes?.message} registration={register("notes")} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={submitting} className="min-h-11">
            {submitting ? "Saving…" : "Save loan"}
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
