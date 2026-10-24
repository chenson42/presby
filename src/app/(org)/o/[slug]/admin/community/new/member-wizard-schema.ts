import { z } from "zod";
import {
  blankEmailRow,
  contactEmailsSchema,
} from "@/components/org-portal/email-addresses-form";

/**
 * ONE combined zod schema for the whole wizard (Phase 3's explicit choice
 * over one-schema-per-step): at ~12 total fields, five separate resolvers
 * would need to be merged for Back-lossless single-form-state anyway, which
 * is more code for the same guarantee one schema already gives.
 * `.superRefine` carries every cross-field rule (household name required
 * only in "new" mode, identity name required only in "new" identity mode,
 * date shape). Each wizard step calls `form.trigger([...fieldsForThisStep])`
 * to scope validation to its own fields (req 2: ≤~5 fields visible per
 * screen) without splitting the schema.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The three connections the wizard offers, in select order. */
export const RELATIONSHIPS = ["visitor", "participant", "member"] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

/** The review step's names for each choice (the select's option text is
 * longer: it carries the approval hint). */
export const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  visitor: "Visitor",
  participant: "Participant",
  member: "Member (profession of faith)",
};

export const memberWizardSchema = z
  .object({
    search: z.object({
      firstName: z.string().min(1, "First name is required"),
      lastName: z.string().min(1, "Last name is required"),
      dateOfBirth: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
    }),
    /** Set by the Confirm step (or defaulted to "new" when the search found
     * no candidate) — drives whether the Identity step is shown at all and
     * which `PersonIdentityInput` variant the final submit sends. */
    identityMode: z.enum(["new", "existing"]),
    matchedPersonId: z.string().optional(),
    matchedDisplayName: z.string().optional(),
    identity: z.object({
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      middleName: z.string().optional(),
      preferredName: z.string().optional(),
      suffix: z.string().optional(),
      dateOfBirth: z.string().optional(),
    }),
    contact: z.object({
      emails: contactEmailsSchema,
      phone: z.string().optional(),
    }),
    address: z.object({
      line1: z.string().optional(),
      city: z.string().optional(),
      region: z.string().optional(),
      postalCode: z.string().optional(),
    }),
    household: z.object({
      mode: z.enum(["new", "existing", "none"]),
      name: z.string().optional(),
      householdId: z.string().optional(),
    }),
    /** How the person is connected (the wizard's "Connection" step). The
     * ROLL KIND is not a field: Participant is always an on-record enrolment
     * and Member is always a profession-of-faith proposal. The server decides
     * what takes effect from the kind alone (DECISION-198). */
    relationship: z.enum(RELATIONSHIPS),
    /** Visitor only. */
    visit: z.object({
      firstVisitDate: z.string().optional(),
      howHeard: z.string().max(200, "Keep this under 200 characters").optional(),
    }),
    /** Participant and Member only. */
    rollAction: z.object({
      effectiveDate: z.string().optional(),
      minuteReference: z
        .string()
        .max(200, "Keep this under 200 characters")
        .optional(),
    }),
  })
  .superRefine((data, ctx) => {
    if (data.identityMode === "new") {
      if (!data.identity.firstName?.trim()) {
        ctx.addIssue({
          code: "custom",
          message: "First name is required",
          path: ["identity", "firstName"],
        });
      }
      if (!data.identity.lastName?.trim()) {
        ctx.addIssue({
          code: "custom",
          message: "Last name is required",
          path: ["identity", "lastName"],
        });
      }
      if (
        data.identity.dateOfBirth &&
        !DATE_RE.test(data.identity.dateOfBirth)
      ) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a valid date",
          path: ["identity", "dateOfBirth"],
        });
      }
    }

    if (data.household.mode === "new" && !data.household.name?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "Household name is required",
        path: ["household", "name"],
      });
    }
    if (data.household.mode === "existing" && !data.household.householdId) {
      ctx.addIssue({
        code: "custom",
        message: "Choose a household",
        path: ["household", "householdId"],
      });
    }

    if (data.relationship === "visitor") {
      if (data.visit.firstVisitDate && !DATE_RE.test(data.visit.firstVisitDate)) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a valid date",
          path: ["visit", "firstVisitDate"],
        });
      }
    } else {
      const date = data.rollAction.effectiveDate ?? "";
      if (!date) {
        ctx.addIssue({
          code: "custom",
          message: "Effective date is required",
          path: ["rollAction", "effectiveDate"],
        });
      } else if (!DATE_RE.test(date)) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a valid date",
          path: ["rollAction", "effectiveDate"],
        });
      }
    }
  });

export type MemberWizardValues = z.infer<typeof memberWizardSchema>;

export const WIZARD_DEFAULT_VALUES: MemberWizardValues = {
  search: { firstName: "", lastName: "", dateOfBirth: "", email: "", phone: "" },
  identityMode: "new",
  matchedPersonId: undefined,
  matchedDisplayName: undefined,
  identity: {
    firstName: "",
    lastName: "",
    middleName: "",
    preferredName: "",
    suffix: "",
    dateOfBirth: "",
  },
  // One blank, valid row so the step can be walked with no input (the editor's
  // own empty state is for a person who has none).
  contact: { emails: [blankEmailRow(true)], phone: "" },
  address: { line1: "", city: "", region: "", postalCode: "" },
  household: { mode: "none", name: "", householdId: "" },
  relationship: "visitor",
  visit: { firstVisitDate: "", howHeard: "" },
  rollAction: { effectiveDate: "", minuteReference: "" },
};
