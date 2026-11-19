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
import { createCommitteeAction } from "@/app/(org)/o/[slug]/admin/committees/new/actions";
import { updateCommitteeAction } from "@/app/(org)/o/[slug]/admin/committees/[committeeId]/actions";
import { COMMITTEE_KINDS } from "@/lib/committees/contract";
import { TOAST } from "@/lib/committees/copy";
import { committeeSchema, type CommitteeValues } from "@/lib/committees/validate";
import { FORM } from "@/lib/committees/ui-copy";
import { reportFailure } from "./form-failure";
import { SelectField } from "./select-field";
import { TextField } from "./text-field";

/**
 * The create and edit form (C4). `committee` absent is a create (back to the list
 * on Cancel, on to the new committee's page on success); present is an edit (back
 * to the committee). Every save requires a kind, so saving an unlabelled committee
 * labels it. A refusal keeps the form's contents: a duplicate name goes under "Committee
 * name", the rest in a toast.
 */
export function CommitteeForm({
  slug,
  committee,
}: {
  slug: string;
  committee?: { id: string; name: string; kind: string | null; purpose: string; meetsWhen: string };
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const schema = useMemo(() => committeeSchema(), []);
  const form = useForm<CommitteeValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: committee?.name ?? "",
      kind: committee?.kind ?? "",
      purpose: committee?.purpose ?? "",
      meetsWhen: committee?.meetsWhen ?? "",
    },
  });
  const {
    register,
    formState: { errors, isDirty },
  } = form;
  const { discardOpen, setDiscardOpen, confirmDiscard } = useUnsavedChangesGuard(isDirty);
  const base = `/o/${slug}/admin/committees`;
  const cancelHref = committee ? `${base}/${committee.id}` : base;

  async function onSubmit(values: CommitteeValues) {
    setSubmitting(true);
    const result = committee
      ? await updateCommitteeAction(slug, { ...values, committeeId: committee.id })
      : await createCommitteeAction(slug, values);
    setSubmitting(false);
    if (!result.ok) {
      reportFailure(result, form, { duplicate_name: "name" });
      return;
    }
    toast.success(committee ? TOAST.saved : TOAST.created);
    form.reset(values);
    router.push(committee ? `${base}/${committee.id}` : result.data?.id ? `${base}/${result.data.id}` : base);
  }

  return (
    <HydrationGate>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-4">
        <TextField id="committee-name" label={FORM.name} error={errors.name?.message} registration={register("name")} />
        <SelectField
          id="committee-kind"
          label={FORM.kind}
          hint={FORM.kindHelper}
          error={errors.kind?.message}
          registration={register("kind")}
          emptyLabel={FORM.kindChoose}
          options={COMMITTEE_KINDS}
        />
        <TextField id="committee-purpose" label={FORM.purpose} rows={4} error={errors.purpose?.message} registration={register("purpose")} />
        <TextField id="committee-meets" label={FORM.meetsWhen} error={errors.meetsWhen?.message} registration={register("meetsWhen")} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={submitting} className="min-h-11">
            {submitting ? FORM.saving : committee ? FORM.save : FORM.create}
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
