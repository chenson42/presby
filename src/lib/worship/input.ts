import { z } from "zod";
import { STARTER_KEYS } from "./starters";
import { ANSWERS, REASONS, SERVICE_PATTERNS, TEAM_KINDS } from "./vocab";

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

// ---------------------------------------------------------------------------
// Scheduling (Batch 3)
// ---------------------------------------------------------------------------

const reason = z.enum(REASONS).nullable().optional();

export const createServiceSchema = z.object({
  title: text,
  startsAt: text,
  endsAt: text.optional(),
  location: text.optional(),
  serviceTypeId: id.optional(),
  groupIds: z.array(id).max(100),
  allowDuplicate: z.boolean().optional(),
});

export const generateServicesSchema = z.object({
  serviceTypeId: id,
  firstDate: text,
  pattern: z.enum(SERVICE_PATTERNS),
  count: z.number(),
});

export const updateServiceSchema = z.object({
  eventId: id,
  title: text,
  startsAt: text,
  endsAt: text.optional(),
  location: text.nullable().optional(),
});

export const cancelServiceSchema = z.object({ eventId: id });

export const setServiceTeamsForEventSchema = z.object({ eventId: id, groupIds: z.array(id).max(100) });

export const placePersonSchema = z.object({ eventId: id, groupId: id, positionId: id, personId: id });

export const placeGuestSchema = z.object({ eventId: id, groupId: id, positionId: id, guestName: text.max(500) });

export const removeAssignmentSchema = z.object({ assignmentId: id });

export const recordResponseSchema = z.object({ assignmentId: id, answer: z.enum(ANSWERS), reason });

export const sendRequestsSchema = z.object({ eventIds: z.array(id).max(200).optional(), groupId: id.optional() });

export const respondToRequestSchema = z.object({ assignmentId: id, answer: z.enum(ANSWERS), reason });

export const addBlockoutSchema = z.object({ startsOn: text, endsOn: text, reason });

export const endBlockoutSchema = z.object({ blockoutId: id });
