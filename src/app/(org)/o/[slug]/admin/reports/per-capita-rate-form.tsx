"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequiredMark } from "@/components/shared/required-mark";
import type { PerCapitaRateRow } from "@/lib/presbytery";
import {
  perCapitaRateSchema,
  type PerCapitaRateFormValues,
} from "./per-capita-schema";
import { setPerCapitaRateAction } from "./actions";

/**
 * Sets the presbytery's per-capita rate for `billingYear`. `basisYear`
 * defaults server-side to `billingYear - 2` (Operator Answer 1's two-year-
 * arrears practice) when left blank — the placeholder names that default
 * rather than silently pre-filling a value the clerk didn't choose.
 */
export function PerCapitaRateForm({
  slug,
  billingYear,
  rate,
}: {
  slug: string;
  billingYear: number;
  rate: PerCapitaRateRow | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<PerCapitaRateFormValues>({
    resolver: zodResolver(perCapitaRateSchema),
    defaultValues: {
      billingYear: String(billingYear),
      basisYear: rate ? String(rate.basisYear) : "",
      ratePerMember: rate?.ratePerMember ?? "",
    },
  });

  const {
    register,
    formState: { errors },
  } = form;

  async function onSubmit(values: PerCapitaRateFormValues) {
    setSubmitting(true);
    const result = await setPerCapitaRateAction(slug, Number(values.billingYear), {
      basisYear: values.basisYear ? Number(values.basisYear) : undefined,
      ratePerMember: values.ratePerMember,
    });
    setSubmitting(false);

    if (result.ok) {
      toast.success("Per-capita rate saved.");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="max-w-md space-y-4">
      <input type="hidden" {...register("billingYear")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="rate-basis-year">
            Basis year
          </Label>
          <Input
            id="rate-basis-year"
            type="number"
            placeholder={String(billingYear - 2)}
            className="mt-1"
            {...register("basisYear")}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Defaults to {billingYear - 2} (two years prior) if left blank.
          </p>
          {errors.basisYear && (
            <p className="mt-1 text-sm text-destructive">{errors.basisYear.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="rate-per-member">
            Rate per member
            <RequiredMark />
          </Label>
          <Input
            id="rate-per-member"
            type="number"
            step="0.01"
            min={0}
            aria-required="true"
            className="mt-1"
            {...register("ratePerMember")}
          />
          {errors.ratePerMember && (
            <p className="mt-1 text-sm text-destructive">
              {errors.ratePerMember.message}
            </p>
          )}
        </div>
      </div>
      <Button type="submit" disabled={submitting} className="min-h-11">
        {submitting ? "Saving…" : `Save rate for ${billingYear}`}
      </Button>
    </form>
  );
}
