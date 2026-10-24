"use client";

import { useWatch, type UseFormReturn } from "react-hook-form";
import { ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { RequiredMark } from "@/components/shared/required-mark";
import { WizardField } from "./wizard-field";
import type { MemberWizardValues, Relationship } from "./member-wizard-schema";

const SELECT_CLASSES =
  "w-full appearance-none rounded-md border border-input bg-background px-3 py-2 pr-8 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

const OPTION_TEXT: Record<Relationship, string> = {
  visitor: "Visitor",
  participant: "Participant (takes effect now)",
  member: "Member: profession of faith (needs Session approval)",
};

const DESCRIPTIONS: Record<Relationship, string> = {
  visitor:
    "Someone who has visited. Not on any roll, and not listed in the Directory.",
  participant:
    "Takes part in the life of the congregation but isn't a member. Counted as an other participant from the effective date. No approval is needed.",
  member:
    "Received by profession of faith. The Session must approve before they count as a member.",
};

/**
 * The wizard's "Connection" step (replaces the old Roll action step): how is
 * this person connected? A native `<select>` (the house style, no new
 * primitive), a one-sentence description that follows the selection, then only
 * the fields that choice needs (DECISION-200). Dates are native
 * `<input type="date">` (req 4).
 *
 * Without `roll.propose` the select holds only Visitor, with a line saying who
 * can record the others. That is a convenience: `createPerson()` and the
 * database function re-check `roll.propose` regardless of what was posted.
 */
export function ConnectionStep({
  form,
  canProposeRoll,
  memberAvailable = true,
}: {
  form: UseFormReturn<MemberWizardValues>;
  canProposeRoll: boolean;
  /** The organization has a Session, so a member can be proposed (R15, F185).
   * The server refuses `no_session` regardless of what was posted. */
  memberAvailable?: boolean;
}) {
  const {
    register,
    formState: { errors },
  } = form;
  const relationship = useWatch({ control: form.control, name: "relationship" });
  const options: Relationship[] = canProposeRoll
    ? memberAvailable
      ? ["visitor", "participant", "member"]
      : ["visitor", "participant"]
    : ["visitor"];

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="member-wizard-relationship" className="text-base">
          How is this person connected?
          <RequiredMark />
        </Label>
        <div className="relative mt-1">
          <select
            id="member-wizard-relationship"
            className={SELECT_CLASSES}
            aria-required="true"
            aria-describedby="member-wizard-relationship-help"
            {...register("relationship")}
          >
            {options.map((value) => (
              <option key={value} value={value}>
                {OPTION_TEXT[value]}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>
        <p
          id="member-wizard-relationship-help"
          className="mt-2 text-sm text-muted-foreground"
        >
          {DESCRIPTIONS[relationship]}
        </p>
        {!canProposeRoll && (
          <p className="mt-2 text-sm text-muted-foreground">
            Participants and members are recorded by someone who can propose
            roll actions, such as the Clerk of Session.
          </p>
        )}
        {canProposeRoll && !memberAvailable && (
          <p
            className="mt-2 text-sm text-muted-foreground"
            data-testid="no-session-note"
          >
            This organization has no Session, so members can&apos;t be proposed
            here. Participants and visitors can still be added.
          </p>
        )}
      </div>

      {relationship === "visitor" ? (
        <>
          <WizardField
            name="visit.firstVisitDate"
            label="First visit (optional)"
            type="date"
            register={register}
            errors={errors}
          />
          <WizardField
            name="visit.howHeard"
            label="How did they hear about us? (optional)"
            register={register}
            errors={errors}
            autoComplete="off"
          />
        </>
      ) : (
        <>
          <WizardField
            name="rollAction.effectiveDate"
            label="Effective date"
            type="date"
            register={register}
            errors={errors}
            required
          />
          <WizardField
            name="rollAction.minuteReference"
            label="Minute reference (optional)"
            register={register}
            errors={errors}
            autoComplete="off"
          />
        </>
      )}
    </div>
  );
}
