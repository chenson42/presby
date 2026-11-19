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
import { changeCommitteeSeatRoleAction } from "@/app/(org)/o/[slug]/admin/committees/[committeeId]/actions";
import { COMMITTEE_ROLE_OPTIONS } from "@/lib/committees/contract";
import { dateText, TOAST } from "@/lib/committees/copy";
import type { SeatRow } from "@/lib/committees/reads";
import { changeRoleSchema, type ChangeRoleValues } from "@/lib/committees/validate";
import { CHANGE, FORM } from "@/lib/committees/ui-copy";
import { reportFailure } from "./form-failure";
import { SelectField } from "./select-field";
import { TextField } from "./text-field";

/**
 * The change-a-role form (C6): one new role and one effective date. The old role
 * ends on that date and the new one starts on it (one atomic change), so the helper
 * says there is no gap. The form validates against the seat it was opened on, so its
 * messages agree with the store; a stale form is a toast.
 */
export function ChangeRoleForm({
  slug,
  committeeId,
  seat,
  today,
}: {
  slug: string;
  committeeId: string;
  seat: Pick<SeatRow, "membershipId" | "displayName" | "role" | "startsOn" | "endsOn" | "publicListed">;
  today: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const schema = useMemo(
    () => changeRoleSchema({ today }, { role: seat.role, startsOn: seat.startsOn, endsOn: seat.endsOn }),
    [today, seat.role, seat.startsOn, seat.endsOn],
  );
  const form = useForm<ChangeRoleValues>({
    resolver: zodResolver(schema),
    defaultValues: { newRole: "", effectiveOn: today < seat.startsOn ? seat.startsOn : today },
  });
  const {
    register,
    formState: { errors, isDirty },
  } = form;
  const { discardOpen, setDiscardOpen, confirmDiscard } = useUnsavedChangesGuard(isDirty);
  const committeeHref = `/o/${slug}/admin/committees/${committeeId}`;

  async function onSubmit(values: ChangeRoleValues) {
    setSubmitting(true);
    const result = await changeCommitteeSeatRoleAction(slug, {
      ...values,
      committeeId,
      membershipId: seat.membershipId,
      expectedRole: seat.role,
    });
    setSubmitting(false);
    if (!result.ok) {
      reportFailure(result, form, { same_role: "newRole" });
      return;
    }
    toast.success(TOAST.roleChanged);
    form.reset(values);
    router.push(committeeHref);
  }

  const hint = [
    CHANGE.helper,
    seat.endsOn ? CHANGE.keepsEnd(dateText(seat.endsOn)) : null,
    seat.publicListed ? CHANGE.listed(seat.displayName) : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <HydrationGate>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        <SelectField
          id="change-role"
          label={CHANGE.newRole}
          error={errors.newRole?.message}
          registration={register("newRole")}
          emptyLabel={CHANGE.chooseRole}
          options={COMMITTEE_ROLE_OPTIONS.filter((o) => o.value !== seat.role)}
        />
        <TextField id="change-effective" label={CHANGE.effectiveOn} type="date" hint={hint} error={errors.effectiveOn?.message} registration={register("effectiveOn")} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={submitting} className="min-h-11">
            {submitting ? FORM.saving : CHANGE.submit}
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
