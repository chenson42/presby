"use client";

import type { UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { WizardField } from "./wizard-field";
import type { MemberWizardValues } from "./member-wizard-schema";

const SEARCH_FIELDS = [
  "search.firstName",
  "search.lastName",
] as const;

/**
 * Step 1 — duplicate-match search (req 7's screen is the NEXT step,
 * `ConfirmStep`; this step only collects the query). One field-group, ≤5
 * fields (req 2). `dateOfBirth` is a native `<input type="date">` (req 4).
 *
 * "Search" is its own action, not the wizard's shared Next button — it
 * calls the server, so it needs its own pending state and it decides which
 * step comes next (Confirm vs. straight to Identity) rather than a fixed
 * forward step.
 */
export function SearchStep({
  form,
  onSearch,
  searching,
}: {
  form: UseFormReturn<MemberWizardValues>;
  onSearch: () => void;
  searching: boolean;
}) {
  const {
    register,
    formState: { errors },
    trigger,
  } = form;

  async function handleSearch() {
    const valid = await trigger(SEARCH_FIELDS);
    if (!valid) return;
    onSearch();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Search for this person first, so we don&apos;t create a duplicate
        record.
      </p>
      <WizardField
        name="search.firstName"
        label="First name"
        register={register}
        errors={errors}
        autoComplete="off"
      />
      <WizardField
        name="search.lastName"
        label="Last name"
        register={register}
        errors={errors}
        autoComplete="off"
      />
      <WizardField
        name="search.dateOfBirth"
        label="Date of birth (optional)"
        type="date"
        register={register}
        errors={errors}
      />
      <WizardField
        name="search.email"
        label="Email (optional)"
        type="email"
        register={register}
        errors={errors}
        autoComplete="off"
      />
      <Button
        type="button"
        onClick={handleSearch}
        disabled={searching}
        className="min-h-[44px] min-w-[44px] w-full sm:w-auto"
      >
        {searching ? "Searching…" : "Search"}
      </Button>
    </div>
  );
}
