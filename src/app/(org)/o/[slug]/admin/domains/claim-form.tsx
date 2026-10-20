"use client";

import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { FormField, fieldA11y } from "@/components/giving/form-field";
import { claimDomainAction } from "./actions";
import { looksLikeApex } from "./claim-input";

/**
 * Starts a domain claim: one field for the domain and, only when what was typed
 * is a bare domain, a choice of which of it and its `www.` twin is the primary
 * address (`www` is the default and recommended). Nothing is attached anywhere
 * until the person publishes the ownership record the page then shows.
 *
 * React Hook Form inside `<HydrationGate>` (DECISION-159, F116): the field and
 * the radio are inoperable until the page has hydrated, because registering
 * writes `defaultValues` over the live DOM and anything typed before that would
 * be lost, or a radio would silently fall back to the default. Server errors are
 * mapped to the field they belong to; everything else is a toast.
 */

interface FormValues {
  domain: string;
  canonical: "www" | "apex";
}

export function ClaimForm({
  slug,
  submitLabel = "Start",
  idPrefix = "claim",
}: {
  slug: string;
  submitLabel?: string;
  idPrefix?: string;
}) {
  const {
    register,
    handleSubmit,
    setError,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { domain: "", canonical: "www" } });

  const typed = useWatch({ control, name: "domain" });
  const showChoice = looksLikeApex(typed ?? "");
  const domainId = `${idPrefix}-domain`;

  async function onSubmit(values: FormValues) {
    let result;
    try {
      result = await claimDomainAction(slug, { domain: values.domain, canonical: values.canonical });
    } catch {
      toast.error("We couldn't add that right now. Try again in a few minutes.");
      return;
    }
    if (result.ok) {
      toast.success("Domain added. Now publish the record shown below.");
      reset({ domain: "", canonical: values.canonical });
      return;
    }
    if (result.field === "domain") {
      setError("domain", { message: result.error });
      return;
    }
    toast.error(result.error);
  }

  return (
    <HydrationGate>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4" aria-label="Add a domain">
        <FormField
          id={domainId}
          label="Your domain"
          hint="Just the name, like yourchurch.org. No https:// needed."
          error={errors.domain?.message}
        >
          <Input
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="yourchurch.org"
            {...fieldA11y(domainId, errors.domain?.message, true)}
            {...register("domain", { required: "Enter your domain, like yourchurch.org." })}
          />
        </FormField>

        {showChoice && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Which address should be your main one?</legend>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-input px-3">
              <input type="radio" value="www" className="size-4" {...register("canonical")} />
              <span className="text-base">
                The <strong>www</strong> address (recommended)
              </span>
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-input px-3">
              <input type="radio" value="apex" className="size-4" {...register("canonical")} />
              <span className="text-base">The address without www</span>
            </label>
            <p className="text-sm text-muted-foreground">
              The other one will send visitors to your main address, so both work.
            </p>
          </fieldset>
        )}

        <Button type="submit" className="min-h-11" disabled={isSubmitting}>
          {isSubmitting ? "Adding…" : submitLabel}
        </Button>
      </form>
    </HydrationGate>
  );
}
