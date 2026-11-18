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
import { TextField } from "@/components/oversight/text-field";
import { YearField } from "@/components/oversight/year-field";
import { TOAST } from "@/lib/oversight/copy";
import type { ProfileRow } from "@/lib/oversight/reads";
import { profileSchema, type ProfileValues, type ValidationEnv } from "@/lib/oversight/validate";
import { setProfileAction } from "./actions";

function defaultValues(profile: ProfileRow | null): ProfileValues {
  return {
    streetAddress: profile?.streetAddress ?? "",
    city: profile?.city ?? "",
    county: profile?.county ?? "",
    yearOrganized: profile?.yearOrganized != null ? String(profile.yearOrganized) : "",
    phone: profile?.phone ?? "",
  };
}

/**
 * The profile form (C3): address, city, county, year organized and phone, none
 * required. `profile` is null when none is recorded yet (a create: the action
 * gets `expectedVersion: null` and the form returns to the record page); an edit
 * stays on the page and refreshes, resetting the form to what was saved so the
 * unsaved-changes guard reads clean.
 */
export function ProfileForm({
  slug,
  aboutOrgId,
  profile,
  env,
}: {
  slug: string;
  aboutOrgId: string;
  profile: ProfileRow | null;
  env: ValidationEnv;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const schema = useMemo(() => profileSchema(env), [env]);
  const form = useForm<ProfileValues>({ resolver: zodResolver(schema), defaultValues: defaultValues(profile) });
  const {
    register,
    formState: { errors, isDirty },
  } = form;
  const { discardOpen, setDiscardOpen, confirmDiscard } = useUnsavedChangesGuard(isDirty);
  const recordHref = `/o/${slug}/admin/oversight/${aboutOrgId}`;

  async function onSubmit(values: ProfileValues) {
    setSubmitting(true);
    const result = await setProfileAction(slug, aboutOrgId, values, profile?.rowVersion ?? null);
    setSubmitting(false);
    if (!result.ok) {
      reportFailure(result, form);
      return;
    }
    if (result.data?.unchanged) {
      toast.info(TOAST.noChanges);
      return;
    }
    toast.success(TOAST.profileSaved);
    form.reset(values);
    if (profile === null) router.push(recordHref);
    else router.refresh();
  }

  return (
    <HydrationGate>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="max-w-xl space-y-4">
        <TextField
          id="profile-address"
          label="Address"
          hint="Type it as you would write it on an envelope: one line for each line of the address, including the city, state and ZIP."
          error={errors.streetAddress?.message}
          registration={register("streetAddress")}
          rows={4}
          autoComplete="off"
        />
        <TextField id="profile-city" label="City" error={errors.city?.message} registration={register("city")} />
        <TextField id="profile-county" label="County" error={errors.county?.message} registration={register("county")} />
        <YearField
          id="profile-year-organized"
          label="Year organized"
          error={errors.yearOrganized?.message}
          registration={register("yearOrganized")}
        />
        <TextField
          id="profile-phone"
          label="Phone"
          inputMode="tel"
          autoComplete="off"
          error={errors.phone?.message}
          registration={register("phone")}
        />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={submitting} className="min-h-11">
            {submitting ? "Saving…" : "Save"}
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
