"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { FormField, fieldA11y } from "@/components/giving/form-field";
import {
  createDonorSchema,
  type CreateDonorInput,
  type CreateDonorValues,
} from "@/lib/giving/donor-input";
import { createDonorAction, updateDonorContactAction } from "./actions";

/**
 * Add a donor (`giving.record`) or edit one's contact detail (`giving.manage`) -
 * docs/work-log/2026-10-15-online-giving.md, Phase 3 "Pages to create".
 * React Hook Form over `createDonorSchema` (the actions re-parse the same
 * schema), inside `<HydrationGate>` (DECISION-159).
 *
 * Adding warns, and does not block, when a donor with the same name or email
 * already exists (G24: search before you create) - the matches are offered as
 * links, with "add anyway" for a genuinely different person.
 */

export interface DonorFormDonor {
  id: string;
  displayName: string;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string;
}

export function DonorForm({
  slug,
  donor,
  onDone,
}: {
  slug: string;
  /** Present when editing. */
  donor?: DonorFormDonor;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [duplicates, setDuplicates] = useState<Array<{ id: string; displayName: string }> | null>(null);
  const editing = Boolean(donor);

  const form = useForm<CreateDonorInput, unknown, CreateDonorValues>({
    resolver: zodResolver(createDonorSchema),
    defaultValues: {
      displayName: donor?.displayName ?? "",
      email: donor?.email ?? "",
      addressLine1: donor?.addressLine1 ?? "",
      addressLine2: donor?.addressLine2 ?? "",
      city: donor?.city ?? "",
      region: donor?.region ?? "",
      postalCode: donor?.postalCode ?? "",
      country: donor?.country ?? "US",
    },
  });
  const {
    register,
    setError,
    formState: { errors },
  } = form;
  const idp = donor ? `donor-${donor.id}` : "new-donor";

  async function submit(acknowledgeDuplicate: boolean) {
    const input = form.getValues();
    setSubmitting(true);
    const result = donor
      ? await updateDonorContactAction(slug, { ...input, donorId: donor.id })
      : await createDonorAction(slug, input, { acknowledgeDuplicate });
    setSubmitting(false);

    if (!result.ok) {
      if (result.kind === "two_factor_required" && result.redirectTo) {
        window.location.assign(result.redirectTo);
        return;
      }
      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        setError(field as keyof CreateDonorInput, { message });
      }
      toast.error(result.error);
      return;
    }

    if (!donor) {
      const data = result.data as
        | { status: "created"; donorId: string }
        | { status: "duplicate_donor"; donors: Array<{ id: string; displayName: string }> }
        | undefined;
      if (data?.status === "duplicate_donor") {
        setDuplicates(data.donors);
        return;
      }
      setDuplicates(null);
      form.reset();
      toast.success("Donor added.");
      if (data?.status === "created") router.push(`/o/${slug}/admin/giving/donors/${data.donorId}`);
    } else {
      toast.success("Donor updated.");
    }
    router.refresh();
    onDone?.();
  }

  return (
    <HydrationGate>
      <form onSubmit={form.handleSubmit(() => submit(false))} className="space-y-4" noValidate>
        <FormField id={`${idp}-name`} label="Name" required error={errors.displayName?.message}>
          <Input type="text" autoComplete="off" {...fieldA11y(`${idp}-name`, errors.displayName?.message)} {...register("displayName")} />
        </FormField>
        <FormField
          id={`${idp}-email`}
          label="Email (optional)"
          hint="Used to suggest a link to a member, and for their statement."
          error={errors.email?.message}
        >
          <Input type="email" inputMode="email" autoComplete="off" {...fieldA11y(`${idp}-email`, errors.email?.message, true)} {...register("email")} />
        </FormField>
        <FormField id={`${idp}-address1`} label="Street address (optional)" error={errors.addressLine1?.message}>
          <Input type="text" autoComplete="off" {...fieldA11y(`${idp}-address1`, errors.addressLine1?.message)} {...register("addressLine1")} />
        </FormField>
        <FormField id={`${idp}-address2`} label="Address line 2 (optional)" error={errors.addressLine2?.message}>
          <Input type="text" autoComplete="off" {...fieldA11y(`${idp}-address2`, errors.addressLine2?.message)} {...register("addressLine2")} />
        </FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormField id={`${idp}-city`} label="City" error={errors.city?.message}>
            <Input type="text" autoComplete="off" {...fieldA11y(`${idp}-city`, errors.city?.message)} {...register("city")} />
          </FormField>
          <FormField id={`${idp}-region`} label="State" error={errors.region?.message}>
            <Input type="text" autoComplete="off" {...fieldA11y(`${idp}-region`, errors.region?.message)} {...register("region")} />
          </FormField>
          <FormField id={`${idp}-zip`} label="ZIP" error={errors.postalCode?.message}>
            <Input type="text" inputMode="numeric" autoComplete="off" {...fieldA11y(`${idp}-zip`, errors.postalCode?.message)} {...register("postalCode")} />
          </FormField>
        </div>
        <input type="hidden" {...register("country")} />

        {duplicates && (
          <div role="alert" className="space-y-3 rounded-lg border border-border bg-muted p-4" data-testid="duplicate-donor-warning">
            <p className="text-sm font-medium">Someone with that name or email is already in your records.</p>
            <ul className="space-y-2">
              {duplicates.map((match) => (
                <li key={match.id}>
                  <Button asChild variant="outline" className="min-h-11 w-full justify-start">
                    <Link href={`/o/${slug}/admin/giving/donors/${match.id}`}>Open {match.displayName}</Link>
                  </Button>
                </li>
              ))}
            </ul>
            <Button type="button" variant="outline" className="min-h-11" disabled={submitting} onClick={() => submit(true)}>
              This is a different person. Add them anyway
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="min-h-11" disabled={submitting}>
            {submitting ? "Saving…" : editing ? "Save changes" : "Add donor"}
          </Button>
          {editing && onDone && (
            <Button type="button" variant="outline" className="min-h-11" onClick={onDone}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </HydrationGate>
  );
}
