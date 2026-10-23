"use client";

import type { UseFormReturn } from "react-hook-form";
import { WizardField } from "./wizard-field";
import type { MemberWizardValues } from "./member-wizard-schema";

/**
 * Only rendered when `identityMode === "new"` — an "existing" match skips
 * straight to Contact & Address, since `PersonIdentityInput`'s "existing"
 * variant carries only `matchedPersonId`, no name/DOB fields to collect.
 *
 * Req 3: single column. Req 4: `dateOfBirth` is a native
 * `<input type="date">`.
 */
export function IdentityStep({
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
        name="identity.firstName"
        label="First name"
        register={register}
        errors={errors}
        autoComplete="off"
        required
      />
      <WizardField
        name="identity.lastName"
        label="Last name"
        register={register}
        errors={errors}
        autoComplete="off"
        required
      />
      <WizardField
        name="identity.middleName"
        label="Middle name (optional)"
        register={register}
        errors={errors}
        autoComplete="off"
      />
      <WizardField
        name="identity.preferredName"
        label="Preferred name (optional)"
        register={register}
        errors={errors}
        autoComplete="off"
      />
      <WizardField
        name="identity.dateOfBirth"
        label="Date of birth (optional)"
        type="date"
        register={register}
        errors={errors}
      />
    </div>
  );
}
