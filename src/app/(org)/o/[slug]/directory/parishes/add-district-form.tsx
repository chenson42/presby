"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DISTRICT_NAME_MAX,
  districtNameFormSchema,
  type DistrictNameFormValues,
} from "@/lib/parishes-pure";
import { defineDistrictAction } from "./actions";

/**
 * "Add district" - a one-field `react-hook-form` form (copy C1). It is a
 * `useForm` root, so it renders inside `<HydrationGate>` (DECISION-159): a name
 * typed before the page's JavaScript runs would be overwritten by the default,
 * and a pre-hydration Submit would post an empty name. Every error is shown
 * inline under the field (the server's mapped copy verbatim); nothing is added
 * on failure.
 */
export function AddDistrictForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<DistrictNameFormValues>({
    resolver: zodResolver(districtNameFormSchema),
    defaultValues: { name: "" },
  });
  const {
    register,
    formState: { errors },
  } = form;

  async function onSubmit(values: DistrictNameFormValues) {
    setSubmitting(true);
    try {
      const result = await defineDistrictAction(slug, { name: values.name });
      if (result.ok) {
        toast.success("District added.");
        form.reset({ name: "" });
        router.refresh();
      } else {
        form.setError("name", { message: result.error });
      }
    } catch {
      form.setError("name", { message: "We couldn't save that. Nothing was changed." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <HydrationGate>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
        noValidate
      >
        <div className="flex-1">
          <Label htmlFor="add-district-name">District name</Label>
          <Input
            id="add-district-name"
            type="text"
            autoComplete="off"
            aria-invalid={errors.name ? "true" : undefined}
            aria-describedby={
              errors.name ? "add-district-name-error" : "add-district-name-help"
            }
            className="mt-1"
            {...register("name")}
          />
          {errors.name ? (
            <p id="add-district-name-error" role="alert" className="mt-1 text-sm text-destructive">
              {errors.name.message}
            </p>
          ) : (
            <p id="add-district-name-help" className="mt-1 text-sm text-muted-foreground">
              Up to {DISTRICT_NAME_MAX} characters.
            </p>
          )}
        </div>
        <Button type="submit" disabled={submitting} className="min-h-11 w-full sm:w-auto">
          {submitting ? "Adding…" : "Add district"}
        </Button>
      </form>
    </HydrationGate>
  );
}
