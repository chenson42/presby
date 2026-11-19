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
import { addCommissionMemberAction } from "@/app/(org)/o/[slug]/admin/committees/commissions/[commissionId]/actions";
import { COMMITTEE_ROLE_OPTIONS } from "@/lib/committees/contract";
import { TOAST } from "@/lib/committees/copy";
import type { SeatFormPerson } from "@/lib/committees/reads";
import { commissionMemberSchema, type SeatValues } from "@/lib/committees/validate";
import { ADD, COMMISSION_MEMBER, FORM } from "@/lib/committees/ui-copy";
import { reportFailure } from "./form-failure";
import { SelectField } from "./select-field";
import { TextField } from "./text-field";

/**
 * The add-a-member form of a commission record (C15): the person, role and date fields
 * of the committee's (C5), the same six titles and date rules, worded for a commission.
 * A person already serving is disabled and says so. A refusal keeps the form's
 * contents: an overlap or a person no longer connected goes under "Person", the rest
 * in a toast. The empty state (no one selectable) and the ended-record state are the
 * page's, not this form's.
 */
export function CommissionMemberForm({
  slug,
  commissionId,
  people,
  today,
}: {
  slug: string;
  commissionId: string;
  people: readonly SeatFormPerson[];
  today: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const schema = useMemo(() => commissionMemberSchema({ today }), [today]);
  const form = useForm<SeatValues>({
    resolver: zodResolver(schema),
    defaultValues: { personId: "", role: "member", startsOn: today, endsOn: "" },
  });
  const {
    register,
    formState: { errors, isDirty },
  } = form;
  const { discardOpen, setDiscardOpen, confirmDiscard } = useUnsavedChangesGuard(isDirty);
  const recordHref = `/o/${slug}/admin/committees/commissions/${commissionId}`;

  async function onSubmit(values: SeatValues) {
    setSubmitting(true);
    const result = await addCommissionMemberAction(slug, { ...values, commissionId });
    setSubmitting(false);
    if (!result.ok) {
      reportFailure(result, form, { overlap: "personId", not_a_member: "personId" });
      return;
    }
    toast.success(TOAST.commissionMemberAdded);
    form.reset(values);
    router.push(recordHref);
  }

  return (
    <HydrationGate>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        <SelectField
          id="commission-person"
          label={ADD.person}
          hint={COMMISSION_MEMBER.personHelper}
          error={errors.personId?.message}
          registration={register("personId")}
          emptyLabel={ADD.personChoose}
          options={people.map((p) => ({
            value: p.personId,
            label: p.alreadyServes ? ADD.alreadyServes(p.displayName) : p.displayName,
            disabled: p.alreadyServes,
          }))}
        />
        <SelectField
          id="commission-role"
          label={ADD.role}
          hint={ADD.roleHelper}
          error={errors.role?.message}
          registration={register("role")}
          options={COMMITTEE_ROLE_OPTIONS}
        />
        <TextField id="commission-starts" label={ADD.startsOn} type="date" hint={ADD.startsHelper} error={errors.startsOn?.message} registration={register("startsOn")} />
        <TextField id="commission-ends" label={ADD.endsOn} type="date" hint={COMMISSION_MEMBER.endsHelper} error={errors.endsOn?.message} registration={register("endsOn")} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={submitting} className="min-h-11">
            {submitting ? FORM.saving : COMMISSION_MEMBER.submit}
          </Button>
          <Button asChild variant="outline" className="min-h-11">
            <Link href={recordHref}>{FORM.cancel}</Link>
          </Button>
        </div>
        <UnsavedChangesDialog open={discardOpen} onOpenChange={setDiscardOpen} onConfirmDiscard={confirmDiscard} />
      </form>
    </HydrationGate>
  );
}
