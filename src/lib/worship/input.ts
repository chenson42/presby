import { z } from "zod";
import { STARTER_KEYS } from "./starters";
import { TEAM_KINDS } from "./vocab";

/**
 * The shape of every worship action input - docs/work-log/2026-11-04-worship-
 * inc1.md, Phase 3 "Server actions". PURE (zod only).
 *
 * What these own: TYPES. A server action is a public entry point and the
 * TypeScript types do not survive the wire, so every input is parsed before it
 * reaches the store. What they do not own: lengths, ranges, uniqueness and
 * every rule that needs the database - the store re-validates all of those and
 * returns the Copy sentence, so this file never carries one.
 *
 * Unknown keys are STRIPPED, not rejected: an input that carries
 * `organizationId`, `personId` of the actor or `status` is ignored, and nothing
 * a client sends outside this list can reach a column. Ids are plain strings
 * here; the store checks their shape (`isUuidShaped`) and answers `not_found`.
 */

const text = z.string();
const id = z.string();

export const createTeamSchema = z.object({
  name: text,
  kind: z.enum(TEAM_KINDS),
  description: text.optional(),
  starter: z.enum(STARTER_KEYS).optional(),
});

export const adoptTeamSchema = z.object({ groupId: id });

export const updateTeamSchema = z.object({ groupId: id, name: text, description: text.optional() });

export const retireTeamSchema = z.object({ groupId: id });

export const addPositionSchema = z.object({ groupId: id, name: text, slots: z.number() });

export const updatePositionSchema = z.object({ positionId: id, name: text, slots: z.number() });

export const retirePositionSchema = z.object({ positionId: id });

export const setQualificationsSchema = z.object({
  groupId: id,
  personId: id,
  positionIds: z.array(id).max(100),
});

export const addTeamMemberSchema = z.object({ groupId: id, personId: id });

export const endTeamMemberSchema = z.object({ groupId: id, groupMembershipId: id });

export const searchRosterSchema = z.object({ groupId: id, q: text.max(200) });

const serviceTypeFields = {
  name: text,
  startTime: text,
  durationMinutes: z.number().nullable().optional(),
  location: text.nullable().optional(),
  groupIds: z.array(id).max(100).optional(),
};

export const createServiceTypeSchema = z.object(serviceTypeFields);

export const updateServiceTypeSchema = z.object({ serviceTypeId: id, ...serviceTypeFields });

export const retireServiceTypeSchema = z.object({ serviceTypeId: id });

export const setServiceTypeTeamsSchema = z.object({ serviceTypeId: id, groupIds: z.array(id).max(100) });
