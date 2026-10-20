"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { FormField, NativeSelect, fieldA11y } from "@/components/giving/form-field";
import type { TeamRole } from "@/lib/giving/team";
import { grantGivingRoleAction } from "./actions";

/**
 * Give a giving role to a member - docs/work-log/2026-10-15-online-giving.md,
 * Phase 2 R3 (F138). Two native selects (a role, a person), PERSON-ARM ONLY
 * (there is no "group" choice: giving by group membership would widen
 * silently). The role list is exactly the org's active roles made ONLY of
 * giving permissions; each option names what it can do so nobody grants more
 * than they mean to. React Hook Form + `<HydrationGate>` (DECISION-159): a
 * select picked before hydration would otherwise be silently reset.
 */

const KEY_WORDS: Record<string, string> = {
  "giving.view": "view giving",
  "giving.record": "record gifts",
  "giving.manage": "manage giving",
};

interface FormValues {
  roleId: string;
  personId: string;
}

export function GrantGivingRoleForm({
  slug,
  roles,
  people,
}: {
  slug: string;
  roles: TeamRole[];
  people: Array<{ personId: string; displayName: string }>;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<FormValues>({
    // No default: handing out a role (the first in the list can be the
    // treasurer's) must be a deliberate choice, never a one-tap accident.
    defaultValues: { roleId: "", personId: "" },
  });
  const {
    register,
    setError,
    formState: { errors },
  } = form;

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    const result = await grantGivingRoleAction(slug, values);
    setSubmitting(false);
    if (result.ok) {
      toast.success("Role given.");
      router.refresh();
      return;
    }
    if (result.kind === "two_factor_required" && result.redirectTo) {
      window.location.assign(result.redirectTo);
      return;
    }
    for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
      setError(field as keyof FormValues, { message });
    }
    toast.error(result.error);
  }

  if (roles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        There is no giving role to hand out yet. Set one up above, then come back.
      </p>
    );
  }
  if (people.length === 0) {
    return <p className="text-sm text-muted-foreground">Nobody has a current membership here yet.</p>;
  }

  return (
    <HydrationGate>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField id="team-role" label="Role" required error={errors.roleId?.message}>
          <NativeSelect {...fieldA11y("team-role", errors.roleId?.message)} {...register("roleId", { required: "Choose a role" })}>
            <option value="">Choose a role</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name} ({role.givingKeys.map((k) => KEY_WORDS[k] ?? k).join(", ")})
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="team-person" label="Person" required error={errors.personId?.message}>
          <NativeSelect {...fieldA11y("team-person", errors.personId?.message)} {...register("personId", { required: "Choose a person" })}>
            <option value="">Choose a person</option>
            {people.map((person) => (
              <option key={person.personId} value={person.personId}>
                {person.displayName}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <Button type="submit" className="min-h-11" disabled={submitting}>
          {submitting ? "Giving role…" : "Give role"}
        </Button>
      </form>
    </HydrationGate>
  );
}
