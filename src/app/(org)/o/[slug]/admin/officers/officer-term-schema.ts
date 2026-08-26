import { z } from "zod";
import { OFFICER_OFFICES } from "./office-labels";

/**
 * Client-side validation for "Add officer term" — groups-and-officers Phase 3
 * design (`docs/work-log/2026-08-26-groups-and-officers.md`), commit 3/3.
 *
 * THE DEACON/ORG_UNIT "IFF" RULE, ENFORCED HERE FIRST (client-side), same
 * rule `src/lib/officers.ts`'s `startOfficerTerm` re-checks server-side as
 * defense in depth, and the same rule the `officer_terms_org_unit_deacon_
 * check` CHECK constraint enforces (looser: it only forbids the non-deacon
 * direction) as the last-resort backstop. Three layers, same rule, matching
 * Phase 3's API-contract table — this file is the FIRST of the three, so the
 * `org_unit` field never even reaches the server on a doomed submission for
 * the common case.
 */
export const officerTermSchema = z
  .object({
    personId: z.string().min(1, "Choose a person"),
    office: z.enum(OFFICER_OFFICES),
    /** 'YYYY-MM-DD'. */
    startsOn: z.string().min(1, "Start date is required"),
    electedOn: z.string().optional(),
    installedOn: z.string().optional(),
    classYear: z.string().optional(),
    minuteReference: z.string().optional(),
    orgUnitId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.office === "deacon" && !data.orgUnitId) {
      ctx.addIssue({
        code: "custom",
        message: "A deacon term needs a district selected.",
        path: ["orgUnitId"],
      });
    }
    if (data.office !== "deacon" && data.orgUnitId) {
      ctx.addIssue({
        code: "custom",
        message: "Only deacon terms take a district.",
        path: ["orgUnitId"],
      });
    }
    if (
      data.classYear !== undefined &&
      data.classYear !== "" &&
      !/^\d{4}$/.test(data.classYear)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Class year must be a four-digit year.",
        path: ["classYear"],
      });
    }
  });

export type OfficerTermFormValues = z.infer<typeof officerTermSchema>;
