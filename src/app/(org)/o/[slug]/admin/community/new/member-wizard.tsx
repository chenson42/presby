"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { toNewPersonEmailInputs } from "@/components/org-portal/email-addresses-form";
import { notifySaved } from "@/components/org-portal/person-save-notes";
import { Button } from "@/components/ui/button";
import type { CreatePersonInput, MatchCandidate } from "@/lib/people";
import {
  memberWizardSchema,
  WIZARD_DEFAULT_VALUES,
  type MemberWizardValues,
} from "./member-wizard-schema";
import { WizardStepIndicator } from "./wizard-step-indicator";
import { SearchStep } from "./search-step";
import { ConfirmStep } from "./confirm-step";
import { IdentityStep } from "./identity-step";
import { ContactAddressStep } from "./contact-address-step";
import { HouseholdStep } from "./household-step";
import { ConnectionStep } from "./connection-step";
import { ReviewStep } from "./review-step";
import { createPersonAction, matchPersonAction } from "./actions";
import { SUCCESS_COPY } from "../participant-copy";
import { HydrationGate } from "@/components/shared/hydration-gate";

type StepId =
  | "search"
  | "confirm"
  | "identity"
  | "contact"
  | "household"
  | "connection"
  | "review";

const STEP_LABELS: Record<StepId, string> = {
  search: "Find a matching record",
  confirm: "Confirm the match",
  identity: "Name & birth date",
  contact: "Contact & address",
  household: "Household",
  connection: "Connection",
  review: "Review & submit",
};

const IDENTITY_FIELDS = [
  "identity.firstName",
  "identity.lastName",
  "identity.dateOfBirth",
] as const;
const CONTACT_FIELDS = [
  "contact.emails",
  "contact.phone",
  "address.line1",
  "address.city",
  "address.region",
  "address.postalCode",
] as const;
const HOUSEHOLD_FIELDS = [
  "household.mode",
  "household.name",
  "household.householdId",
] as const;
const CONNECTION_FIELDS = [
  "relationship",
  "visit.firstVisitDate",
  "visit.howHeard",
  "rollAction.effectiveDate",
  "rollAction.minuteReference",
] as const;

/**
 * The whole add-a-person flow — ONE client component, ONE `useForm()`
 * instance (Phase 1 requirement 5: single route, client-side step state, no
 * per-step routes — closes a URL-skip shortcut and makes Back lossless by
 * construction, since nothing ever unmounts the form).
 *
 * STEP SEQUENCE IS ADAPTIVE, computed from state every render rather than a
 * fixed array: `confirm` only appears once a search has run AND returned a
 * candidate; `identity` only appears while `identityMode === "new"`.
 * Navigation always targets a STEP ID, never an index — `steps.indexOf()`
 * looks the id up fresh each render, so Back/Next can never desync from a
 * step list that just changed shape (e.g. re-searching after Back).
 *
 * MID-WIZARD FAILURE NEVER DISCARDS DATA (req 9): only the `ok: true`
 * branch of `createPersonAction` calls `form.reset()`. A denied or failed
 * submit leaves every field exactly as entered, on the Review step, so the
 * admin can see what will be re-submitted.
 */
export function MemberWizard({
  slug,
  organization,
  households,
  canProposeRoll,
  memberAvailable = true,
  sessionWaits = false,
}: {
  slug: string;
  /** The organization's name, for the restore dialog on an archived match. */
  organization: string;
  households: { householdId: string; name: string }[];
  /** `roll.propose`. Without it only Visitor is offered; the server re-checks. */
  canProposeRoll: boolean;
  /** The organization has a Session (R15); false hides the Member choice. */
  memberAvailable?: boolean;
  /** The Session exists but cannot approve yet (Flow 7): the review note says so. */
  sessionWaits?: boolean;
}) {
  const router = useRouter();
  const form = useForm<MemberWizardValues>({
    resolver: zodResolver(memberWizardSchema),
    defaultValues: WIZARD_DEFAULT_VALUES,
  });

  const [currentStepId, setCurrentStepId] = useState<StepId>("search");
  const [searched, setSearched] = useState(false);
  const [matchCandidate, setMatchCandidate] = useState<MatchCandidate | null>(
    null,
  );
  const [searching, setSearching] = useState(false);
  // The address last copied from the search step into the contact list, so a
  // re-search can replace it without ever overwriting something typed since.
  const prefilledEmail = useRef("");
  const [submitting, setSubmitting] = useState(false);

  // `useWatch` (a proper subscribing hook), not `form.watch()` (an
  // imperative function react-hook-form returns) — the React Compiler
  // cannot safely memoize around `watch()`'s return value, and warns on it
  // (`react-hooks/incompatible-library`). `useWatch` is react-hook-form's
  // own compiler-friendly replacement for exactly this read.
  const identityMode = useWatch({ control: form.control, name: "identityMode" });
  const householdMode = useWatch({ control: form.control, name: "household.mode" });
  const householdId = useWatch({ control: form.control, name: "household.householdId" });

  const steps = useMemo<StepId[]>(() => {
    const s: StepId[] = ["search"];
    if (searched && matchCandidate) s.push("confirm");
    if (identityMode === "new") s.push("identity");
    s.push("contact", "household", "connection", "review");
    return s;
  }, [searched, matchCandidate, identityMode]);

  const currentIndex = Math.max(0, steps.indexOf(currentStepId));

  function goBack() {
    const prev = steps[currentIndex - 1];
    if (prev) setCurrentStepId(prev);
  }

  /**
   * D6: the match step still takes ONE address; the contact step's first row
   * starts from it. Only a blank first row, or one still holding the previous
   * copy, is replaced, so nothing the administrator typed is overwritten.
   */
  function prefillFirstEmail(searchEmail: string | undefined) {
    const typed = (searchEmail ?? "").trim();
    const first = form.getValues("contact.emails.0");
    if (!first || first.id) return;
    if (first.value !== "" && first.value !== prefilledEmail.current) return;
    form.setValue("contact.emails.0.value", typed);
    prefilledEmail.current = typed;
  }

  async function handleSearch() {
    setSearching(true);
    const { firstName, lastName, dateOfBirth, email } =
      form.getValues("search");
    const result = await matchPersonAction(slug, {
      firstName,
      lastName,
      dateOfBirth: dateOfBirth || undefined,
      identifiers: email ? [{ kind: "email", value: email }] : undefined,
    });
    setSearching(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    setSearched(true);
    prefillFirstEmail(email);
    const top = result.data?.candidates[0];
    if (top) {
      setMatchCandidate(top);
      form.setValue("matchedPersonId", top.personId);
      form.setValue("matchedDisplayName", top.displayName);
      setCurrentStepId("confirm");
    } else {
      setMatchCandidate(null);
      form.setValue("identityMode", "new");
      form.setValue("identity.firstName", firstName);
      form.setValue("identity.lastName", lastName);
      setCurrentStepId("identity");
    }
  }

  function handleConfirmMatch() {
    form.setValue("identityMode", "existing");
    setCurrentStepId("contact");
  }

  function handleRejectMatch() {
    form.setValue("identityMode", "new");
    const { firstName, lastName } = form.getValues("search");
    form.setValue("identity.firstName", firstName);
    form.setValue("identity.lastName", lastName);
    setCurrentStepId("identity");
  }

  async function handleIdentityNext() {
    // `identity.dateOfBirth` is a native <input type="date">. On real
    // hardware, the browser's own commit of a picker-selected date into the
    // DOM's change event can land one animation frame after the visible
    // value updates — a fast tap on Next right after picking a date can run
    // this handler's `form.trigger()` before that change event (and RHF's
    // corresponding state update) has arrived, reading a stale value. An
    // explicit blur forces browsers that defer commit-to-blur to fire it
    // now; the animation-frame wait covers browsers that defer it to their
    // own close-animation instead. jsdom's synchronous fireEvent never hits
    // this window, which is why the original test suite didn't catch it —
    // see the "real device timing" regression test below.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const valid = await form.trigger(IDENTITY_FIELDS);
    if (valid) setCurrentStepId("contact");
  }

  async function handleContactNext() {
    const valid = await form.trigger(CONTACT_FIELDS);
    if (valid) setCurrentStepId("household");
  }

  async function handleHouseholdNext() {
    const valid = await form.trigger(HOUSEHOLD_FIELDS);
    if (valid) setCurrentStepId("connection");
  }

  async function handleConnectionNext() {
    const valid = await form.trigger(CONNECTION_FIELDS);
    if (valid) setCurrentStepId("review");
  }

  async function handleSubmit() {
    const valid = await form.trigger();
    if (!valid) return;
    const values = form.getValues();

    const input: CreatePersonInput = {
      identity:
        values.identityMode === "existing"
          ? { mode: "existing", matchedPersonId: values.matchedPersonId! }
          : {
              mode: "new",
              firstName: values.identity.firstName!,
              lastName: values.identity.lastName!,
              middleName: values.identity.middleName || undefined,
              preferredName: values.identity.preferredName || undefined,
              suffix: values.identity.suffix || undefined,
              dateOfBirth: values.identity.dateOfBirth || undefined,
            },
      contact: {
        emails: toNewPersonEmailInputs(values.contact.emails),
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
      // The roll KIND is fixed by the choice; what takes effect on record is
      // decided by the server from the kind alone (DECISION-198).
      rollAction:
        values.relationship === "visitor"
          ? {
              kind: "visitor",
              firstVisitDate: values.visit.firstVisitDate || undefined,
              howHeard: values.visit.howHeard || undefined,
            }
          : {
              kind:
                values.relationship === "participant"
                  ? "other_participant_enrolled"
                  : "profession_of_faith",
              effectiveDate: values.rollAction.effectiveDate ?? "",
              minuteReference: values.rollAction.minuteReference || undefined,
            },
    };

    setSubmitting(true);
    const result = await createPersonAction(slug, input);
    setSubmitting(false);

    if (result.ok) {
      const effect = result.data?.effect;
      notifySaved(
        effect === "recorded"
          ? SUCCESS_COPY.participantAdded
          : effect === "pending"
            ? SUCCESS_COPY.memberProposed
            : SUCCESS_COPY.visitorAdded,
        result.data?.notes,
      );
      if (result.data?.affectsFiledPeriod) {
        toast.warning(SUCCESS_COPY.filedPeriodWarning);
      }
      form.reset(WIZARD_DEFAULT_VALUES);
      // Land on the list that now holds the person.
      const landing =
        effect === "recorded"
          ? "?view=participants"
          : effect === "none"
            ? "?view=visitors"
            : "";
      router.push(`/o/${slug}/admin/community${landing}`);
    } else {
      // NO reset here — see this component's own header (req 9).
      toast.error(result.error);
    }
  }

  const selectedHousehold = households.find(
    (h) => h.householdId === householdId,
  );

  return (
    <HydrationGate>
      <div className="space-y-6">
        <WizardStepIndicator
          currentIndex={currentIndex}
          totalSteps={steps.length}
          label={STEP_LABELS[currentStepId]}
        />

        {currentStepId === "search" && (
          <SearchStep form={form} onSearch={handleSearch} searching={searching} />
        )}
        {currentStepId === "confirm" && matchCandidate && (
          <>
            <ConfirmStep
              displayName={matchCandidate.displayName}
              onConfirm={handleConfirmMatch}
              onReject={handleRejectMatch}
              alreadyHere={matchCandidate.alreadyHere}
              recordHref={`/o/${slug}/admin/community/${matchCandidate.personId}/edit`}
              restore={{
                slug,
                personId: matchCandidate.personId,
                organization,
                onRestored: () =>
                  router.push(`/o/${slug}/admin/community/${matchCandidate.personId}/edit`),
              }}
            />
            {/* Confirm's own two full-width buttons ARE the forward action —
             * only Back is offered here, in case the search itself needs
             * revising, matching req 6's "Back never discards data" even on
             * this forced-choice screen. */}
            <Button
              type="button"
              variant="outline"
              onClick={goBack}
              className="min-h-[44px] min-w-[44px]"
            >
              Back
            </Button>
          </>
        )}
        {currentStepId === "identity" && <IdentityStep form={form} />}
        {currentStepId === "contact" && <ContactAddressStep form={form} />}
        {currentStepId === "household" && (
          <HouseholdStep form={form} households={households} mode={householdMode} />
        )}
        {currentStepId === "connection" && (
          <ConnectionStep
            form={form}
            canProposeRoll={canProposeRoll}
            memberAvailable={memberAvailable}
          />
        )}
        {currentStepId === "review" && (
          <ReviewStep
            form={form}
            householdName={selectedHousehold?.name}
            sessionWaits={sessionWaits}
          />
        )}

        {currentStepId !== "confirm" && currentStepId !== "search" && (
          <div className="flex items-center justify-between gap-3 pt-2">
            {currentIndex > 0 ? (
              <Button
                type="button"
                variant="outline"
                onClick={goBack}
                disabled={searching || submitting}
                className="min-h-[44px] min-w-[44px]"
              >
                Back
              </Button>
            ) : (
              <span />
            )}

            {currentStepId === "identity" && (
              <Button
                type="button"
                onClick={handleIdentityNext}
                className="min-h-[44px] min-w-[44px]"
              >
                Next
              </Button>
            )}
            {currentStepId === "contact" && (
              <Button
                type="button"
                onClick={handleContactNext}
                className="min-h-[44px] min-w-[44px]"
              >
                Next
              </Button>
            )}
            {currentStepId === "household" && (
              <Button
                type="button"
                onClick={handleHouseholdNext}
                disabled={
                  householdMode === "existing" && households.length === 0
                }
                className="min-h-[44px] min-w-[44px]"
              >
                Next
              </Button>
            )}
            {currentStepId === "connection" && (
              <Button
                type="button"
                onClick={handleConnectionNext}
                className="min-h-[44px] min-w-[44px]"
              >
                Next
              </Button>
            )}
            {currentStepId === "review" && (
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="min-h-[44px] min-w-[44px]"
              >
                {submitting ? "Adding…" : "Add person"}
              </Button>
            )}
          </div>
        )}
      </div>
    </HydrationGate>
  );
}
