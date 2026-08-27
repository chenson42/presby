import { z } from "zod";
import { WIZARD_ROLL_ACTION_KINDS } from "@/lib/roll-action-kinds";

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
      email: z.string().optional(),
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
    rollAction: z.object({
      // Same 2 values as before this extraction — WIZARD_ROLL_ACTION_KINDS
      // is the shared module's own copy of this exact literal list, not a
      // behavior change (docs/work-log/2026-08-26-member-roll-on-edit.md
      // Phase 3 step 6).
      kind: z.enum(WIZARD_ROLL_ACTION_KINDS),
      effectiveDate: z.string().min(1, "Effective date is required"),
      minuteReference: z.string().optional(),
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

    if (!DATE_RE.test(data.rollAction.effectiveDate)) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a valid date",
        path: ["rollAction", "effectiveDate"],
      });
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
  contact: { email: "", phone: "" },
  address: { line1: "", city: "", region: "", postalCode: "" },
  household: { mode: "none", name: "", householdId: "" },
  rollAction: {
    kind: "profession_of_faith",
    effectiveDate: "",
    minuteReference: "",
  },
};

// Source of truth extraction only, no behavior change (docs/work-log/
// 2026-08-26-member-roll-on-edit.md Phase 3 step 6): the full 17-kind label
// map now lives in the shared, plain `src/lib/roll-action-kinds.ts` (needed
// by both this wizard and the edit screen's own `RecordRollActionForm`).
// `rollAction.kind`'s zod enum above stays the same 2 values — re-exported
// here so every existing importer (`roll-action-step.tsx`, `review-step.tsx`)
// keeps working unchanged.
export { ROLL_ACTION_KIND_LABELS } from "@/lib/roll-action-kinds";
