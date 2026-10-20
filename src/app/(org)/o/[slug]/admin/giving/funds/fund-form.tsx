"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { HydrationGate } from "@/components/shared/hydration-gate";
import {
  CHECKBOX_CLASSES,
  CheckboxField,
  FormField,
  NativeSelect,
  fieldA11y,
} from "@/components/giving/form-field";
import {
  RESTRICTION_CLASSES,
  RESTRICTION_LABELS,
  fundSchema,
  type FundInput,
  type FundValues,
} from "@/lib/giving/fund-input";
import { createFundAction, updateFundAction } from "./actions";

/**
 * Create / edit a fund - docs/work-log/2026-10-15-online-giving.md, G23.
 * React Hook Form + zod over `fundSchema` (the server action re-parses the same
 * schema; this form is advisory), wrapped in `<HydrationGate>` (DECISION-159)
 * so nothing can be typed before the page's JavaScript attaches.
 *
 * "Offer this fund on the public give page" is OFF by default, and ticking it
 * asks for the public name: fund names offered online are PUBLIC, so a
 * restricted or discretionary fund is never exposed by accident.
 */
export function FundForm({
  slug,
  fund,
  canOfferOnline = true,
  onDone,
}: {
  slug: string;
  /** Present when editing. */
  fund?: {
    id: string;
    name: string;
    onlineDisplayName: string | null;
    description: string | null;
    restrictionClass: FundInput["restrictionClass"];
    offeredOnline: boolean;
  };
  /** False for a retired fund (it cannot be offered). */
  canOfferOnline?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const editing = Boolean(fund);

  const form = useForm<FundInput, unknown, FundValues>({
    resolver: zodResolver(fundSchema),
    defaultValues: {
      name: fund?.name ?? "",
      onlineDisplayName: fund?.onlineDisplayName ?? "",
      description: fund?.description ?? "",
      restrictionClass: fund?.restrictionClass ?? "unrestricted",
      offeredOnline: fund?.offeredOnline ?? false,
    },
  });
  const {
    register,
    control,
    setError,
    formState: { errors },
  } = form;
  const offeredOnline = useWatch({ control, name: "offeredOnline" });
  const idp = fund ? `fund-${fund.id}` : "new-fund";

  async function onSubmit() {
    const input = form.getValues();
    setSubmitting(true);
    const result = fund
      ? await updateFundAction(slug, { ...input, fundId: fund.id })
      : await createFundAction(slug, input);
    setSubmitting(false);

    if (result.ok) {
      toast.success(editing ? "Fund updated." : "Fund added.");
      if (!editing) form.reset();
      router.refresh();
      onDone?.();
      return;
    }
    if (result.kind === "two_factor_required" && result.redirectTo) {
      window.location.assign(result.redirectTo);
      return;
    }
    for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
      setError(field as keyof FundInput, { message });
    }
    toast.error(result.error);
  }

  return (
    <HydrationGate>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField id={`${idp}-name`} label="Fund name" required error={errors.name?.message}>
          <Input type="text" autoComplete="off" {...fieldA11y(`${idp}-name`, errors.name?.message)} {...register("name")} />
        </FormField>

        <FormField
          id={`${idp}-description`}
          label="Description (optional)"
          hint="For your own records. It is not shown to donors."
          error={errors.description?.message}
        >
          <Textarea
            rows={2}
            {...fieldA11y(`${idp}-description`, errors.description?.message, true)}
            {...register("description")}
          />
        </FormField>

        <FormField id={`${idp}-class`} label="Restriction" error={errors.restrictionClass?.message}>
          <NativeSelect {...fieldA11y(`${idp}-class`, errors.restrictionClass?.message)} {...register("restrictionClass")}>
            {RESTRICTION_CLASSES.map((value) => (
              <option key={value} value={value}>
                {RESTRICTION_LABELS[value]}
              </option>
            ))}
          </NativeSelect>
        </FormField>

        <CheckboxField
          id={`${idp}-online`}
          label="Offer this fund on the public give page"
          hint={
            canOfferOnline
              ? "Donors will see its public name. Leave this off for restricted or discretionary funds."
              : "A retired fund can't be offered. Reactivate it first."
          }
        >
          <input
            type="checkbox"
            className={CHECKBOX_CLASSES}
            disabled={!canOfferOnline}
            aria-describedby={`${idp}-online-hint`}
            {...register("offeredOnline")}
            id={`${idp}-online`}
          />
        </CheckboxField>

        {offeredOnline && canOfferOnline && (
          <FormField
            id={`${idp}-public-name`}
            label="Name donors will see"
            required
            hint="For example, Building Fund."
            error={errors.onlineDisplayName?.message}
          >
            <Input
              type="text"
              autoComplete="off"
              {...fieldA11y(`${idp}-public-name`, errors.onlineDisplayName?.message, true)}
              {...register("onlineDisplayName")}
            />
          </FormField>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={submitting} className="min-h-11">
            {submitting ? "Saving…" : editing ? "Save changes" : "Add fund"}
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
