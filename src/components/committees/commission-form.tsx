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
import { recordCommissionAction } from "@/app/(org)/o/[slug]/admin/committees/commissions/actions";
import { updateCommissionAction } from "@/app/(org)/o/[slug]/admin/committees/commissions/[commissionId]/actions";
import { TOAST } from "@/lib/committees/copy";
import { commissionSchema, type CommissionValues } from "@/lib/committees/validate";
import { COMMISSIONS, FORM } from "@/lib/committees/ui-copy";
import { reportFailure } from "./form-failure";
import { SelectField, type SelectOption } from "./select-field";
import { TextField } from "./text-field";

/** The record being edited, as the commission page's reader returns it. Absent is a new record. */
export interface CommissionFormRecord {
  id: string;
  title: string;
  charge: string | null;
  aboutOrgId: string | null;
  congregationName: string | null;
  congregationIsMember: boolean;
  appointedOn: string;
  minuteReference: string | null;
  rowVersion: number;
}

/**
 * The record-a-commission and edit form (C15): title, charge, an optional
 * congregation ("No congregation" is the first option), the appointed date and the
 * minute reference. An edit carries the reader's `rowVersion` back as
 * `expectedVersion`, so a stale form is a toast, not a silent overwrite. A record whose
 * congregation has left the presbytery is not among the options, so it is added under
 * its stored name and stays selected (an unrelated edit keeps it). The charge helper
 * says who can read it. A refusal keeps the form's contents: a congregation the store
 * cannot resolve goes under "Congregation (optional)", the rest in a toast.
 */
export function CommissionForm({
  slug,
  congregations,
  today,
  commission,
}: {
  slug: string;
  congregations: readonly { id: string; name: string }[];
  today: string;
  commission?: CommissionFormRecord;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const schema = useMemo(() => commissionSchema({ today }), [today]);
  const form = useForm<CommissionValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: commission?.title ?? "",
      charge: commission?.charge ?? "",
      aboutOrgId: commission?.aboutOrgId ?? "",
      appointedOn: commission?.appointedOn ?? today,
      minuteReference: commission?.minuteReference ?? "",
    },
  });
  const {
    register,
    formState: { errors, isDirty },
  } = form;
  const { discardOpen, setDiscardOpen, confirmDiscard } = useUnsavedChangesGuard(isDirty);
  const base = `/o/${slug}/admin/committees`;
  const cancelHref = commission ? `${base}/commissions/${commission.id}` : base;

  const options: SelectOption[] = congregations.map((c) => ({ value: c.id, label: c.name }));
  if (commission?.aboutOrgId && !options.some((o) => o.value === commission.aboutOrgId)) {
    options.push({ value: commission.aboutOrgId, label: COMMISSIONS.leftOption(commission.congregationName ?? "") });
  }

  async function onSubmit(values: CommissionValues) {
    setSubmitting(true);
    const result = commission
      ? await updateCommissionAction(slug, { ...values, commissionId: commission.id, expectedVersion: commission.rowVersion })
      : await recordCommissionAction(slug, values);
    setSubmitting(false);
    if (!result.ok) {
      reportFailure(result, form, { congregation_not_found: "aboutOrgId" });
      return;
    }
    toast.success(commission ? TOAST.commissionSaved : TOAST.commissionRecorded);
    form.reset(values);
    const id = commission?.id ?? result.data?.id;
    router.push(id ? `${base}/commissions/${id}` : base);
  }

  return (
    <HydrationGate>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        <TextField id="commission-title" label={COMMISSIONS.fieldTitle} error={errors.title?.message} registration={register("title")} />
        <TextField
          id="commission-charge"
          label={COMMISSIONS.fieldCharge}
          hint={COMMISSIONS.chargeHelper}
          rows={4}
          error={errors.charge?.message}
          registration={register("charge")}
        />
        <SelectField
          id="commission-congregation"
          label={COMMISSIONS.fieldCongregation}
          error={errors.aboutOrgId?.message}
          registration={register("aboutOrgId")}
          emptyLabel={COMMISSIONS.congregationNone}
          options={options}
        />
        <TextField
          id="commission-appointed"
          label={COMMISSIONS.fieldAppointed}
          type="date"
          max={today}
          error={errors.appointedOn?.message}
          registration={register("appointedOn")}
        />
        <TextField
          id="commission-minute"
          label={COMMISSIONS.fieldMinute}
          hint={COMMISSIONS.minuteHelper}
          error={errors.minuteReference?.message}
          registration={register("minuteReference")}
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={submitting} className="min-h-11">
            {submitting ? FORM.saving : commission ? FORM.save : COMMISSIONS.submitRecord}
          </Button>
          <Button asChild variant="outline" className="min-h-11">
            <Link href={cancelHref}>{FORM.cancel}</Link>
          </Button>
        </div>
        <UnsavedChangesDialog open={discardOpen} onOpenChange={setDiscardOpen} onConfirmDiscard={confirmDiscard} />
      </form>
    </HydrationGate>
  );
}
