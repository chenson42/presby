import { z } from "zod";

/**
 * Client-side validation for `/o/<slug>/admin/staff` — staff-and-personnel
 * Phase 3 design (`docs/work-log/2026-08-27-staff-and-personnel.md`),
 * ux-developer slice. Mirrors `admin/officers/officer-term-schema.ts`'s
 * single-file shape (one form, not big enough to earn a directory of its
 * own) and `admin/groups/group-schema.ts`'s free-text `name` field pattern
 * for `position` (`.trim()` before `.min()`/`.max()`, matching
 * `createGroupSchema.name` verbatim).
 *
 * NOT THE ONLY GATE. `startStaffPosition()` server-side re-validates
 * `position`'s 1–200-char trimmed length and re-confirms `personId` is a
 * CURRENT member of this org (F21 shape) — this file's job is only to block
 * an obviously-doomed submit before a round trip, matching every sibling
 * schema's own header note.
 */
export const staffPositionSchema = z.object({
  personId: z.string().min(1, "Choose a person"),
  position: z
    .string()
    .trim()
    .min(1, "Position is required")
    .max(200, "Position must be 200 characters or fewer"),
  department: z.string().max(200, "That's too long").optional(),
  /** 'YYYY-MM-DD'. */
  startsOn: z.string().min(1, "Start date is required"),
  minuteReference: z.string().max(500, "That's too long").optional(),
});
export type StaffPositionFormValues = z.infer<typeof staffPositionSchema>;

/**
 * The compact "add a new person" fallback sub-form (Phase 3's Component/Page
 * Plan: "name + optional contact, no household/roll-action steps"). Kept
 * intentionally small — this is NOT `member-wizard-schema.ts`'s full
 * identity/contact/address/household/roll-action shape; it collects just
 * enough to call `createStaffPersonAction()`.
 */
export const newStaffPersonSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(200),
  lastName: z.string().trim().min(1, "Last name is required").max(200),
  email: z.string().trim().max(320).optional(),
  phone: z.string().trim().max(40).optional(),
});
export type NewStaffPersonFormValues = z.infer<typeof newStaffPersonSchema>;
