"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequiredMark } from "@/components/shared/required-mark";
import { UnsavedChangesDialog } from "@/components/shared/unsaved-changes-dialog";
import { useUnsavedChangesGuard } from "@/components/shared/use-unsaved-changes-guard";
import type { PersonForEdit, UpdatePersonInput } from "@/lib/people";
import { editPersonSchema, type EditPersonValues } from "./edit-person-schema";
import { updatePersonAction } from "./actions";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function initialHouseholdMode(
  person: PersonForEdit,
): EditPersonValues["household"]["mode"] {
  return person.householdId ? "existing" : "none";
}

/**
 * A single scrollable screen, single column throughout (req 3), native
 * text/email/tel inputs (no custom widgets), Save/Cancel at `min-h-11`
 * (req 8). MID-FAILURE NEVER DISCARDS DATA (req 9): `form.reset()` only
 * runs on a successful submit — a denied or failed save leaves every field
 * exactly as entered, same discipline as `MemberWizard`.
 */
export function EditPersonForm({
  slug,
  person,
  households,
}: {
  slug: string;
  person: PersonForEdit;
  households: { householdId: string; name: string }[];
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<EditPersonValues>({
    resolver: zodResolver(editPersonSchema),
    defaultValues: {
      identity: {
        firstName: person.firstName,
        lastName: person.lastName,
        middleName: person.middleName ?? "",
        preferredName: person.preferredName ?? "",
        suffix: person.suffix ?? "",
      },
      contact: {
        email: person.email ?? "",
        phone: person.phone ?? "",
      },
      address: {
        line1: person.address?.line1 ?? "",
        city: person.address?.city ?? "",
        region: person.address?.region ?? "",
        postalCode: person.address?.postalCode ?? "",
      },
      household: {
        mode: initialHouseholdMode(person),
        name: "",
        householdId: person.householdId ?? "",
      },
    },
  });

  const {
    register,
    formState: { errors, isDirty },
  } = form;
  const householdMode = useWatch({ control: form.control, name: "household.mode" });

  // H3 (docs/reviews/2026-08-26-portal-ux.md) — this is the exact form the
  // review reproduced live data loss on. RHF's own `formState.isDirty`
  // already tracks every field change; see the hook's own header for what
  // "guarded" covers (this form's Cancel button, PLUS any same-origin link
  // clicked anywhere on the page while dirty, PLUS a hard navigation/tab
  // close).
  const { discardOpen, setDiscardOpen, guardedNavigate, confirmDiscard } =
    useUnsavedChangesGuard(isDirty);

  async function onSubmit(values: EditPersonValues) {
    const input: UpdatePersonInput = {
      personId: person.personId,
      identity: {
        firstName: values.identity.firstName,
        lastName: values.identity.lastName,
        middleName: values.identity.middleName || undefined,
        preferredName: values.identity.preferredName || undefined,
        suffix: values.identity.suffix || undefined,
      },
      contact: {
        email: values.contact.email || undefined,
        phone: values.contact.phone || undefined,
      },
      address:
        values.address.line1 ||
        values.address.city ||
        values.address.region ||
        values.address.postalCode
          ? {
              line1: values.address.line1 || undefined,
              city: values.address.city || undefined,
              region: values.address.region || undefined,
              postalCode: values.address.postalCode || undefined,
            }
          : undefined,
      household:
        values.household.mode === "new"
          ? { mode: "new", name: values.household.name! }
          : values.household.mode === "existing"
            ? { mode: "existing", householdId: values.household.householdId! }
            : { mode: "none" },
    };

    setSubmitting(true);
    const result = await updatePersonAction(slug, input);
    setSubmitting(false);

    if (result.ok) {
      toast.success("Person updated.");
      router.push(`/o/${slug}/admin/members`);
    } else {
      // NO reset here — see this component's own header (req 9).
      toast.error(result.error);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-4">
        <h2 className="text-lg font-medium">Name</h2>
        <TextField id="firstName" label="First name" register={register} name="identity.firstName" error={errors.identity?.firstName?.message} required />
        <TextField id="lastName" label="Last name" register={register} name="identity.lastName" error={errors.identity?.lastName?.message} required />
        <TextField id="middleName" label="Middle name (optional)" register={register} name="identity.middleName" />
        <TextField id="preferredName" label="Preferred name (optional)" register={register} name="identity.preferredName" />
        <TextField id="suffix" label="Suffix (optional)" register={register} name="identity.suffix" />
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-medium">Contact & address</h2>
        <TextField id="email" label="Email (optional)" type="email" register={register} name="contact.email" />
        <TextField id="phone" label="Phone (optional)" type="tel" register={register} name="contact.phone" />
        <TextField id="line1" label="Address (optional)" register={register} name="address.line1" />
        <TextField id="city" label="City" register={register} name="address.city" />
        <TextField id="region" label="State" register={register} name="address.region" />
        <TextField id="postalCode" label="ZIP code" register={register} name="address.postalCode" />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-lg font-medium">Household</legend>
        <div className="flex flex-col gap-2">
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              value="none"
              {...register("household.mode")}
              className="h-4 w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            No household
          </label>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              value="existing"
              {...register("household.mode")}
              className="h-4 w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              disabled={households.length === 0}
            />
            Add to an existing household
          </label>
          <label className="inline-flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              value="new"
              {...register("household.mode")}
              className="h-4 w-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            Create a new household
          </label>
        </div>
      </fieldset>

      {householdMode === "existing" &&
        (households.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No households exist yet. Choose &quot;Create a new household&quot; instead.
          </p>
        ) : (
          <div>
            <Label htmlFor="edit-person-household-id">
              Household
              <RequiredMark />
            </Label>
            <div className="relative mt-1">
              <select
                id="edit-person-household-id"
                className={SELECT_CLASSES}
                aria-required="true"
                {...register("household.householdId")}
              >
                <option value="">Choose a household…</option>
                {households.map((h) => (
                  <option key={h.householdId} value={h.householdId}>
                    {h.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
            </div>
            {errors.household?.householdId && (
              <p className="mt-1 text-sm text-destructive">
                {errors.household.householdId.message}
              </p>
            )}
          </div>
        ))}

      {householdMode === "new" && (
        <TextField
          id="householdName"
          label="Household name"
          register={register}
          name="household.name"
          error={errors.household?.name?.message}
          required
        />
      )}

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={submitting} className="min-h-[44px] min-w-[44px]">
          {submitting ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={submitting}
          className="min-h-[44px] min-w-[44px]"
          onClick={() => guardedNavigate(`/o/${slug}/admin/members`)}
        >
          Cancel
        </Button>
      </div>
      <UnsavedChangesDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        onConfirmDiscard={confirmDiscard}
      />
    </form>
  );
}

function TextField({
  id,
  label,
  register,
  name,
  type = "text",
  error,
  required,
}: {
  id: string;
  label: string;
  register: ReturnType<typeof useForm<EditPersonValues>>["register"];
  name: Parameters<ReturnType<typeof useForm<EditPersonValues>>["register"]>[0];
  type?: string;
  error?: string;
  required?: boolean;
}) {
  const fieldId = `edit-person-${id}`;
  return (
    <div>
      <Label htmlFor={fieldId}>
        {label}
        {required && <RequiredMark />}
      </Label>
      <Input
        id={fieldId}
        type={type}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        aria-required={required ? "true" : undefined}
        className="mt-1"
        autoComplete="off"
        {...register(name)}
      />
      {error && (
        <p id={`${fieldId}-error`} className="mt-1 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
