import { z } from "zod";

/**
 * Single-screen edit form (docs/work-log/2026-08-26-member-management-
 * edit-person.md Phase 3): unlike the Increment 1 wizard, there is no
 * duplicate-match or roll-action step to coordinate, and every value is
 * already known rather than being entered for the first time, so Phase 1
 * confirmed one scrollable screen over a multi-step wizard. Still
 * single-column per the elderly/mobile UX requirements Increment 1
 * established (req 3).
 */

export const editPersonSchema = z.object({
  identity: z.object({
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    middleName: z.string().optional(),
    preferredName: z.string().optional(),
    suffix: z.string().optional(),
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
}).superRefine((data, ctx) => {
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
});

export type EditPersonValues = z.infer<typeof editPersonSchema>;
