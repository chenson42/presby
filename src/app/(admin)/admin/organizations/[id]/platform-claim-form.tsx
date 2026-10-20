"use client";

import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { FormField, fieldA11y } from "@/components/giving/form-field";
import { claimDomainForOrgAction } from "./domains-actions";

/**
 * Records a WEB claim on an organization's behalf (operator ruling Q2). The
 * organization must already have the website toggle on. It does not skip the
 * proof: the TXT record still has to be published and found before anything is
 * attached, so this only saves the church the typing. Same form shape and
 * hydration rules as the church's own claim form (RHF inside `<HydrationGate>`,
 * DECISION-159).
 */

interface FormValues {
  domain: string;
  canonical: "www" | "apex";
}

export function PlatformClaimForm({ organizationId, organizationName }: { organizationId: string; organizationName: string }) {
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: { domain: "", canonical: "www" } });

  async function onSubmit(values: FormValues) {
    let result;
    try {
      result = await claimDomainForOrgAction(organizationId, values);
    } catch {
      toast.error("That didn't go through. Try again.");
      return;
    }
    if (result.ok) {
      toast.success(`Claim recorded for ${organizationName}. The proof record is shown above.`);
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
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="max-w-md space-y-4" aria-label="Record a claim on this organization's behalf">
        <FormField id="platform-claim-domain" label="Domain" hint="If it is a bare domain, its www twin is claimed with it." error={errors.domain?.message}>
          <Input
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="yourchurch.org"
            {...fieldA11y("platform-claim-domain", errors.domain?.message, true)}
            {...register("domain", { required: "Enter a domain." })}
          />
        </FormField>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Primary address, if it pairs</legend>
          <label className="flex min-h-11 items-center gap-3 rounded-md border border-input px-3">
            <input type="radio" value="www" className="size-4" {...register("canonical")} />
            <span className="text-base">www (recommended)</span>
          </label>
          <label className="flex min-h-11 items-center gap-3 rounded-md border border-input px-3">
            <input type="radio" value="apex" className="size-4" {...register("canonical")} />
            <span className="text-base">Without www</span>
          </label>
        </fieldset>
        <Button type="submit" className="min-h-11" disabled={isSubmitting}>
          {isSubmitting ? "Recording…" : "Record claim"}
        </Button>
      </form>
    </HydrationGate>
  );
}
