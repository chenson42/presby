import { z } from "zod";
import { GROUP_ROLES } from "./group-type-labels";

/**
 * Client-side validation for the groups admin surface (docs/work-log/
 * 2026-08-26-groups-admin.md, Phase 3 design). One file, mirroring
 * `officer-term-schema.ts`'s single-file shape for the same reason: four
 * small forms, none of them individually large enough to earn its own file.
 *
 * NONE OF THESE SCHEMAS ARE THE ONLY GATE. `createGroupSchema`'s
 * `groupTypeId` is validated here only as "chosen from the rendered
 * options" — the actual manageable-subset filter lives server-side in
 * `getGroupFormOptions()`/`createGroup()` (Phase 3's Edge Cases & Risks,
 * named load-bearing) — this file's job is only to block an empty submit
 * before a round trip, not to re-implement that gate client-side.
 */

export const createGroupSchema = z.object({
  groupTypeId: z.string().min(1, "Choose a group type"),
  name: z.string().trim().min(1, "Name is required").max(200, "Name must be 200 characters or fewer"),
  description: z.string().max(2000, "Description is too long").optional(),
  meetsWhen: z.string().max(200, "That's too long").optional(),
});
export type CreateGroupFormValues = z.infer<typeof createGroupSchema>;

export const editGroupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200, "Name must be 200 characters or fewer"),
  description: z.string().max(2000, "Description is too long").optional(),
  meetsWhen: z.string().max(200, "That's too long").optional(),
});
export type EditGroupFormValues = z.infer<typeof editGroupSchema>;

export const addGroupMemberSchema = z.object({
  personId: z.string().min(1, "Choose a person"),
  groupRole: z.enum(GROUP_ROLES),
  /** 'YYYY-MM-DD'. */
  startsOn: z.string().min(1, "Start date is required"),
});
export type AddGroupMemberFormValues = z.infer<typeof addGroupMemberSchema>;

export const endGroupMembershipSchema = z.object({
  /** 'YYYY-MM-DD'. */
  endsOn: z.string().min(1, "End date is required"),
});
export type EndGroupMembershipFormValues = z.infer<
  typeof endGroupMembershipSchema
>;
