"use client";

import type { UseFormReturn } from "react-hook-form";
import { FormattedDate } from "@/components/shared/formatted-date";
import {
  ROLL_ACTION_KIND_LABELS,
  type MemberWizardValues,
} from "./member-wizard-schema";

/** A read-only summary of everything the wizard collected — the last thing
 * a volunteer admin sees before the single transactional submit. Nulls/
 * empty strings are omitted, never shown as "—", matching
 * `directory-list.tsx`'s own "a field is null because it's genuinely
 * unset, not a UI bug" convention. */
export function ReviewStep({
  form,
  householdName,
}: {
  form: UseFormReturn<MemberWizardValues>;
  /** Resolved display name for `household.householdId`, when in "existing"
   * mode — the raw id is not useful to show a human. */
  householdName?: string;
}) {
  const values = form.getValues();

  const displayName =
    values.identityMode === "existing"
      ? values.matchedDisplayName
      : [values.identity.firstName, values.identity.lastName]
          .filter(Boolean)
          .join(" ");

  const householdLine =
    values.household.mode === "new"
      ? values.household.name
      : values.household.mode === "existing"
        ? householdName
        : "None yet";

  return (
    <dl className="space-y-4 text-sm">
      <ReviewRow label="Person" value={displayName || "—"} />
      {values.identityMode === "new" && values.identity.dateOfBirth && (
        <ReviewRow
          label="Date of birth"
          value={
            <FormattedDate value={values.identity.dateOfBirth} mode="date" />
          }
        />
      )}
      {values.contact.email && (
        <ReviewRow label="Email" value={values.contact.email} />
      )}
      {values.contact.phone && (
        <ReviewRow label="Phone" value={values.contact.phone} />
      )}
      {values.address.line1 && (
        <ReviewRow
          label="Address"
          value={[
            values.address.line1,
            [values.address.city, values.address.region, values.address.postalCode]
              .filter(Boolean)
              .join(", "),
          ]
            .filter(Boolean)
            .join(" — ")}
        />
      )}
      <ReviewRow label="Household" value={householdLine || "None yet"} />
      <ReviewRow
        label="Roll action"
        value={ROLL_ACTION_KIND_LABELS[values.rollAction.kind]}
      />
      <ReviewRow
        label="Effective date"
        value={
          <FormattedDate value={values.rollAction.effectiveDate} mode="date" />
        }
      />
      {values.rollAction.minuteReference && (
        <ReviewRow
          label="Minute reference"
          value={values.rollAction.minuteReference}
        />
      )}
      <p className="pt-2 text-sm text-muted-foreground">
        This person&apos;s roll action will need to be approved before they
        appear as a full member.
      </p>
    </dl>
  );
}

function ReviewRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border pb-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-base">{value}</dd>
    </div>
  );
}
