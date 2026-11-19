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
import { addCommitteeSeatAction } from "@/app/(org)/o/[slug]/admin/committees/[committeeId]/actions";
import { COMMITTEE_ROLE_OPTIONS } from "@/lib/committees/contract";
import { TOAST } from "@/lib/committees/copy";
import type { SeatFormPerson } from "@/lib/committees/reads";
import { seatSchema, type SeatValues } from "@/lib/committees/validate";
import { ADD, FORM } from "@/lib/committees/ui-copy";
import { reportFailure } from "./form-failure";
import { SelectField } from "./select-field";
import { TextField } from "./text-field";

/**
 * The add-a-member form (C5). The person list is the presbytery's own records; an
 * option already serving is disabled and says so. A refusal keeps the form's
 * contents: an overlap goes under "Person", the rest in a toast. The empty state (no
 * one selectable) is the page's, not this form's.
 */
export function AddMemberForm({
  slug,
  committeeId,
  people,
  today,
}: {
  slug: string;
  committeeId: string;
  people: readonly SeatFormPerson[];
  today: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const schema = useMemo(() => seatSchema({ today }), [today]);
  const form = useForm<SeatValues>({
    resolver: zodResolver(schema),
    defaultValues: { personId: "", role: "member", startsOn: today, endsOn: "" },
  });
  const {
    register,
    formState: { errors, isDirty },
  } = form;
  const { discardOpen, setDiscardOpen, confirmDiscard } = useUnsavedChangesGuard(isDirty);
  const committeeHref = `/o/${slug}/admin/committees/${committeeId}`;

  async function onSubmit(values: SeatValues) {
    setSubmitting(true);
    const result = await addCommitteeSeatAction(slug, { ...values, committeeId });
    setSubmitting(false);
    if (!result.ok) {
      reportFailure(result, form, { overlap: "personId", not_a_member: "personId" });
      return;
    }
    toast.success(TOAST.memberAdded);
    form.reset(values);
    router.push(committeeHref);
  }

  return (
    <HydrationGate>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        <SelectField
          id="add-person"
          label={ADD.person}
          hint={ADD.personHelper}
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
          id="add-role"
          label={ADD.role}
          hint={ADD.roleHelper}
          error={errors.role?.message}
          registration={register("role")}
          options={COMMITTEE_ROLE_OPTIONS}
        />
        <TextField id="add-starts" label={ADD.startsOn} type="date" hint={ADD.startsHelper} error={errors.startsOn?.message} registration={register("startsOn")} />
        <TextField id="add-ends" label={ADD.endsOn} type="date" hint={ADD.endsHelper} error={errors.endsOn?.message} registration={register("endsOn")} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={submitting} className="min-h-11">
            {submitting ? FORM.saving : ADD.submit}
          </Button>
          <Button asChild variant="outline" className="min-h-11">
            <Link href={committeeHref}>{FORM.cancel}</Link>
          </Button>
        </div>
        <UnsavedChangesDialog open={discardOpen} onOpenChange={setDiscardOpen} onConfirmDiscard={confirmDiscard} />
      </form>
    </HydrationGate>
  );
}
