"use client";

import { useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequiredMark } from "@/components/shared/required-mark";
import type { SasrFieldGroup, SasrFieldInputType } from "@/lib/sasr-fields";
import {
  submitGrantedReturnAction,
  type AttestedRole,
} from "../actions";

export interface SasrFieldBounds {
  min: number;
  max: number;
  type: "integer" | "numeric";
}

const ATTESTED_ROLE_OPTIONS: Array<{ value: AttestedRole; label: string }> = [
  { value: "clerk_of_session", label: "Clerk of session" },
  { value: "moderator", label: "Moderator" },
  { value: "other", label: "Other" },
];

interface FormValues {
  attestedByName: string;
  attestedRole: AttestedRole;
  attestedRoleOther: string;
  fields: Record<string, string>;
}

/**
 * Builds the client-side zod schema from the SAME two inputs the server
 * validates against: the DB-owned bounds (`sasr_form_versions.field_spec`,
 * passed down as `bounds`) and the labels/order (`SASR_FIELD_GROUPS`). This
 * is deliberately re-derived per render inputs rather than hard-coded — the
 * server (`presby_enforce_sasr_field_spec()`) is always the authoritative
 * validator (`docs/ui-standards.md` "Forms — State Patterns"); this schema
 * only saves the visitor a round trip for an out-of-range value.
 */
function buildSchema(groups: SasrFieldGroup[], bounds: Record<string, SasrFieldBounds>) {
  const fieldsShape: Record<string, z.ZodTypeAny> = {};
  for (const group of groups) {
    for (const field of group.fields) {
      const b = bounds[field.key];
      fieldsShape[field.key] = z.string().refine(
        (raw) => {
          const v = raw.trim();
          if (v === "") return true;
          if (!/^\d+$/.test(v)) return false;
          const n = Number(v);
          if (b) return n >= b.min && n <= b.max;
          return n >= 0;
        },
        b
          ? `Enter a whole number between ${b.min} and ${b.max}.`
          : "Enter a non-negative whole number.",
      );
    }
  }

  return z
    .object({
      attestedByName: z
        .string()
        .trim()
        .min(1, "Enter the name of the person attesting to this report.")
        .max(255, "Must be 255 characters or fewer."),
      attestedRole: z.enum(["clerk_of_session", "moderator", "other"]),
      attestedRoleOther: z.string().trim().max(100, "Must be 100 characters or fewer."),
      fields: z.object(fieldsShape),
    })
    .refine(
      (v) => v.attestedRole !== "other" || v.attestedRoleOther.length > 0,
      {
        message: "Enter their role.",
        path: ["attestedRoleOther"],
      },
    );
}

function affixFor(inputType: SasrFieldInputType): string | null {
  return inputType === "currency" ? "$" : null;
}

/**
 * The 60-field submission form itself — `react-hook-form` + `zod`, the
 * established pattern (`../../(org)/o/[slug]/admin/reports/statistics-
 * form.tsx`). Grouped `<fieldset>`s per `SASR_FIELD_GROUPS`, single column
 * below `sm`, `inputMode="numeric"` on every count/currency input, a sticky
 * submit bar, and NOTHING SAVED ON ANY FAILURE PATH — a failed submit
 * re-renders this same filled-in form with the mapped error, never a partial
 * redirect (Phase 2/3 mobile plan — this is the one page whose user cannot
 * call support and gets one attempt).
 *
 * Calling the action: no `try`/`catch` around the `await` — the action calls
 * `redirect()` on success, which throws a special `NEXT_REDIRECT` error the
 * framework's own router intercepts; wrapping it in a `catch` here would
 * swallow that navigation exactly the way `(admin)/admin/organizations/new/
 * actions.ts`'s header warns about. `(auth)/signin/signin-credentials-form.tsx`
 * is the precedent this mirrors.
 */
export function StatisticsSubmitForm({
  token,
  reportYear,
  formVersionKey: _formVersionKey,
  groups,
  bounds,
}: {
  token: string;
  reportYear: number;
  formVersionKey: string;
  groups: SasrFieldGroup[];
  bounds: Record<string, SasrFieldBounds>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const schema = useMemo(() => buildSchema(groups, bounds), [groups, bounds]);

  const defaultValues = useMemo<FormValues>(() => {
    const fields: Record<string, string> = {};
    for (const group of groups) {
      for (const field of group.fields) fields[field.key] = "";
    }
    return {
      attestedByName: "",
      attestedRole: "clerk_of_session",
      attestedRoleOther: "",
      fields,
    };
  }, [groups]);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });

  const attestedRole = watch("attestedRole");

  function onSubmit(values: FormValues) {
    setError(null);
    const payload: Record<string, number | boolean | undefined> = {};
    for (const [key, raw] of Object.entries(values.fields)) {
      payload[key] = raw.trim() === "" ? undefined : Number(raw);
    }

    startTransition(async () => {
      const result = await submitGrantedReturnAction({
        token,
        payload,
        attestedByName: values.attestedByName,
        attestedRole: values.attestedRole,
        attestedRoleOther:
          values.attestedRole === "other" ? values.attestedRoleOther : undefined,
      });
      // On success submitGrantedReturnAction() redirects and never resolves
      // here — only a failure returns.
      if (!result.ok) {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8 pb-24">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <fieldset className="space-y-3 rounded-lg border border-border p-4">
        <legend className="px-1 text-sm font-medium">Attestation</legend>
        <div>
          <Label htmlFor="attested-by-name">
            Your name
            <RequiredMark />
          </Label>
          <Input
            id="attested-by-name"
            type="text"
            className="mt-1"
            aria-required="true"
            aria-invalid={!!errors.attestedByName}
            aria-describedby={errors.attestedByName ? "attested-by-name-error" : undefined}
            {...register("attestedByName")}
          />
          {errors.attestedByName && (
            <p id="attested-by-name-error" className="mt-1 text-sm text-destructive">
              {errors.attestedByName.message}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="attested-role">
            Your role
            <RequiredMark />
          </Label>
          <select
            id="attested-role"
            className="mt-1 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            aria-required="true"
            {...register("attestedRole")}
          >
            {ATTESTED_ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {attestedRole === "other" && (
          <div>
            <Label htmlFor="attested-role-other">
              Describe your role
              <RequiredMark />
            </Label>
            <Input
              id="attested-role-other"
              type="text"
              className="mt-1"
              aria-required="true"
              aria-invalid={!!errors.attestedRoleOther}
              aria-describedby={
                errors.attestedRoleOther ? "attested-role-other-error" : undefined
              }
              {...register("attestedRoleOther")}
            />
            {errors.attestedRoleOther && (
              <p id="attested-role-other-error" className="mt-1 text-sm text-destructive">
                {errors.attestedRoleOther.message}
              </p>
            )}
          </div>
        )}
      </fieldset>

      {groups.map((group) => (
        <fieldset key={group.title} className="space-y-3 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium">{group.title}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {group.fields.map((field) => {
              const affix = affixFor(field.inputType);
              const fieldError = errors.fields?.[field.key]?.message;
              const inputId = `field-${field.key}`;
              return (
                <div key={field.key}>
                  <Label htmlFor={inputId}>{field.label}</Label>
                  <div className="relative mt-1">
                    {affix && (
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                      >
                        {affix}
                      </span>
                    )}
                    <Input
                      id={inputId}
                      type="text"
                      inputMode="numeric"
                      className={affix ? "pl-6" : undefined}
                      aria-invalid={!!fieldError}
                      aria-describedby={fieldError ? `${inputId}-error` : undefined}
                      {...register(`fields.${field.key}` as const)}
                    />
                  </div>
                  {fieldError && (
                    <p id={`${inputId}-error`} className="mt-1 text-sm text-destructive">
                      {fieldError}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}

      <div className="sticky bottom-0 -mx-4 border-t border-border bg-background px-4 py-3 sm:mx-0 sm:rounded-lg sm:border">
        <Button type="submit" disabled={isPending} className="min-h-11 w-full sm:w-auto">
          {isPending ? "Submitting…" : `Submit ${reportYear} report`}
        </Button>
        <p className="mt-2 text-sm text-muted-foreground">
          This link can only be used once. If submission fails, nothing is
          saved and you can try again with the same link.
        </p>
      </div>
    </form>
  );
}
