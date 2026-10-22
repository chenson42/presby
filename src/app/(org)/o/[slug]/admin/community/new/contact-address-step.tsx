"use client";

import type { UseFormReturn } from "react-hook-form";
import { WizardField } from "./wizard-field";
import type { MemberWizardValues } from "./member-wizard-schema";

/**
 * Req 3: single column, ALWAYS — address lines stack top to bottom, never a
 * side-by-side City/State/Zip row even on a wide desktop viewport, per
 * Phase 1's explicit call-out of that exact pattern as hostile to older
 * users.
 */
export function ContactAddressStep({
  form,
}: {
  form: UseFormReturn<MemberWizardValues>;
}) {
  const {
    register,
    formState: { errors },
  } = form;

  return (
    <div className="space-y-4">
      <WizardField
        name="contact.email"
        label="Email (optional)"
        type="email"
        register={register}
        errors={errors}
        autoComplete="off"
      />
      <WizardField
        name="contact.phone"
        label="Phone (optional)"
        type="tel"
        register={register}
        errors={errors}
        autoComplete="off"
      />
      <WizardField
        name="address.line1"
        label="Address (optional)"
        register={register}
        errors={errors}
        autoComplete="off"
      />
      <WizardField
        name="address.city"
        label="City"
        register={register}
        errors={errors}
        autoComplete="off"
      />
      <WizardField
        name="address.region"
        label="State"
        register={register}
        errors={errors}
        autoComplete="off"
      />
      <WizardField
        name="address.postalCode"
        label="ZIP code"
        register={register}
        errors={errors}
        autoComplete="off"
      />
    </div>
  );
}
