"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { HydrationGate } from "@/components/shared/hydration-gate";
import { FormField, NativeSelect, fieldA11y } from "@/components/giving/form-field";
import type { ReimbursementActionResult } from "@/lib/reimbursement/action-result";
import { COPY } from "@/lib/reimbursement/copy";
import type { TreasuryTeamRole } from "@/lib/treasury/team";

/**
 * Give a treasury role to a member (Copy C9, F296): two native selects (a role, a
 * person), PERSON-ARM ONLY. The role list is exactly the org's active roles made
 * only of treasury keys. No default is chosen: handing out a role must be a
 * deliberate choice. A `useForm` root, so it renders `<HydrationGate>`
 * (DECISION-159): a select picked before hydration would otherwise be reset.
 * The action's refusals (`You can't grant permissions you don't hold yourself`,
 * `That person already has this role.`, ...) land in a toast with what was picked
 * left as it was.
 */

interface Values {
  roleId: string;
  personId: string;
}

export function TeamGrantForm({
  roles,
  people,
  grant,
}: {
  roles: TreasuryTeamRole[];
  people: Array<{ personId: string; displayName: string }>;
  grant: (input: { roleId: string; personId: string }) => Promise<ReimbursementActionResult<{ grantId: string }>>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const panel = COPY.team.panel;
  const form = useForm<Values>({ defaultValues: { roleId: "", personId: "" } });
  const {
    register,
    setError,
    reset,
    getValues,
    formState: { errors },
  } = form;

  async function submit() {
    if (busy.current) return;
    const values = getValues();
    let missing = false;
    if (!values.roleId) {
      setError("roleId", { type: "required", message: panel.chooseRole }, { shouldFocus: true });
      missing = true;
    }
    if (!values.personId) {
      setError("personId", { type: "required", message: panel.choosePerson }, { shouldFocus: !missing });
      missing = true;
    }
    if (missing) return;
    busy.current = true;
    setPending(true);
    try {
      const result = await grant(values);
      if (result.ok) {
        toast.success(panel.roleGiven);
        reset({ roleId: "", personId: "" });
        router.refresh();
        return;
      }
      if (result.kind === "two_factor_required" && result.redirectTo) {
        router.push(result.redirectTo);
        return;
      }
      toast.error(result.error);
    } catch {
      toast.error(COPY.form.saveFailed);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  if (roles.length === 0) return <p className="text-base text-muted-foreground">{panel.noRoleToGive}</p>;
  if (people.length === 0) return <p className="text-base text-muted-foreground">{panel.noMembers}</p>;

  return (
    <HydrationGate>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-4"
        data-testid="team-grant-form"
      >
        <FormField id="team-role" label={panel.roleLabel} error={errors.roleId?.message}>
          <NativeSelect className="min-h-11" {...fieldA11y("team-role", errors.roleId?.message)} {...register("roleId")}>
            <option value="">{panel.chooseRole}</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <FormField id="team-person" label={panel.personLabel} error={errors.personId?.message}>
          <NativeSelect className="min-h-11" {...fieldA11y("team-person", errors.personId?.message)} {...register("personId")}>
            <option value="">{panel.choosePerson}</option>
            {people.map((person) => (
              <option key={person.personId} value={person.personId}>
                {person.displayName}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <Button type="submit" className="min-h-11" disabled={pending} data-testid="team-grant-submit">
          {panel.giveButton}
        </Button>
      </form>
    </HydrationGate>
  );
}
