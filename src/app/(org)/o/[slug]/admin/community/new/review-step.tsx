"use client";

import type { UseFormReturn } from "react-hook-form";
import { reviewEmailLines } from "@/components/org-portal/email-addresses-form";
import { FormattedDate } from "@/components/shared/formatted-date";
import {
  RELATIONSHIP_LABELS,
  type MemberWizardValues,
} from "./member-wizard-schema";

const RELATIONSHIP_NOTES = {
  visitor: "Visitors aren't listed in the Directory.",
  participant:
    "This takes effect immediately and is counted in the statistical report from the effective date.",
  member:
    "This person's roll action will wait for the Session to approve before they appear as a member.",
} as const;

/** A read-only summary of everything the wizard collected — the last thing
 * a volunteer admin sees before the single transactional submit. Nulls/
 * empty strings are omitted, never shown as "—", matching
 * `directory-list.tsx`'s own "a field is null because it's genuinely
 * unset, not a UI bug" convention. */
export function ReviewStep({
  form,
  householdName,
  sessionWaits = false,
}: {
  /** The Session cannot approve yet (Flow 7), so a member proposal will wait. */
  sessionWaits?: boolean;
  form: UseFormReturn<MemberWizardValues>;
  /** Resolved display name for `household.householdId`, when in "existing"
   * mode — the raw id is not useful to show a human. */
  householdName?: string;
}) {
  const values = form.getValues();
  const emailLines = reviewEmailLines(values.contact.emails);

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
      {emailLines.length > 0 && (
        <ReviewRow
          label="Email addresses"
          value={
            <ul className="space-y-1">
              {emailLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          }
        />
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
        label="Connection"
        value={RELATIONSHIP_LABELS[values.relationship]}
      />
      {values.relationship === "visitor" ? (
        <>
          {values.visit.firstVisitDate && (
            <ReviewRow
              label="First visit"
              value={
                <FormattedDate value={values.visit.firstVisitDate} mode="date" />
              }
            />
          )}
          {values.visit.howHeard && (
            <ReviewRow label="How they heard" value={values.visit.howHeard} />
          )}
        </>
      ) : (
        <>
          <ReviewRow
            label="Effective date"
            value={
              <FormattedDate
                value={values.rollAction.effectiveDate ?? ""}
                mode="date"
              />
            }
          />
          {values.rollAction.minuteReference && (
            <ReviewRow
              label="Minute reference"
              value={values.rollAction.minuteReference}
            />
          )}
        </>
      )}
      <p className="pt-2 text-sm text-muted-foreground">
        {values.relationship === "member" && sessionWaits
          ? "This person's roll action will wait. No one on your Session can approve yet."
          : RELATIONSHIP_NOTES[values.relationship]}
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
