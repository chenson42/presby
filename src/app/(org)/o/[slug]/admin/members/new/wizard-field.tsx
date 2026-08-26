"use client";

import type { FieldErrors, Path, UseFormRegister } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MemberWizardValues } from "./member-wizard-schema";

/**
 * Walks a dotted RHF path ("identity.firstName") through the nested
 * `errors` object react-hook-form returns. Small and local rather than a
 * lodash `get()` import — the paths here are always 1-2 segments deep.
 */
function getNestedError(
  errors: FieldErrors<MemberWizardValues>,
  path: string,
): string | undefined {
  const parts = path.split(".");
  let current: Record<string, unknown> | undefined =
    errors as unknown as Record<string, unknown>;
  for (const part of parts) {
    if (!current) return undefined;
    current = current[part] as Record<string, unknown> | undefined;
  }
  const message = current?.message;
  return typeof message === "string" ? message : undefined;
}

/**
 * One labeled text/date input, wired to the wizard's single RHF instance.
 * Carries `aria-invalid`/`aria-describedby` on every field per
 * docs/ui-standards.md's Accessibility section — required any time
 * per-field errors are shown.
 */
export function WizardField({
  name,
  label,
  register,
  errors,
  type = "text",
  ...rest
}: {
  name: Path<MemberWizardValues>;
  label: string;
  register: UseFormRegister<MemberWizardValues>;
  errors: FieldErrors<MemberWizardValues>;
  type?: string;
} & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "name" | "type" | "id"
>) {
  const error = getNestedError(errors, name);
  const id = `member-wizard-${name.replace(/\./g, "-")}`;
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className="mt-1"
        {...register(name)}
        {...rest}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
