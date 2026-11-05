"use server";

import { revalidatePath } from "next/cache";
import { ACTION_COPY } from "@/lib/worship/copy";
import { guardedCall, resolveActionIdentity, toActionResult } from "@/lib/worship/action-gate";
import {
  addPositionSchema,
  addTeamMemberSchema,
  adoptTeamSchema,
  createServiceTypeSchema,
  createTeamSchema,
  endTeamMemberSchema,
  retirePositionSchema,
  retireServiceTypeSchema,
  retireTeamSchema,
  searchRosterSchema,
  setQualificationsSchema,
  setServiceTypeTeamsSchema,
  updatePositionSchema,
  updateServiceTypeSchema,
  updateTeamSchema,
} from "@/lib/worship/input";
import { searchRosterCandidates, type RosterCandidate } from "@/lib/worship/reads";
import {
  addPosition,
  addTeamMember,
  adoptTeam,
  createServiceType,
  createTeam,
  endTeamMember,
  retirePosition,
  retireServiceType,
  retireTeam,
  setQualifications,
  setServiceTypeTeams,
  updatePosition,
  updateServiceType,
  updateTeam,
} from "@/lib/worship/store";
import type { ActionResult } from "@/types/actions";

/**
 * Server actions for `/o/<slug>/admin/worship/**` - docs/work-log/
 * 2026-11-04-worship-inc1.md, Phase 3 "Server actions": the TEAM, POSITION,
 * QUALIFICATION, ROSTER and SERVICE-TYPE actions (the service actions are added
 * in Batch 3). Each action: authenticate and resolve the organization from the
 * URL slug (`resolveActionIdentity`), parse the input (`input.ts`), call ONE
 * store export with a viewer derived from the session, and map the result to
 * the `{ ok, data } | { ok: false, error }` shape the client toasts.
 *
 * No action takes an organization id or the acting person from its input, and
 * none touches a table. All correctness - the gate (applicability, the toggle,
 * `worship.manage`), the validation, the sole-writer rule and the audit rows -
 * lives in and is proven by `src/lib/worship/store.ts`. `check:audit` scans
 * only these bodies for literal database writes, so it is blind to them; the
 * audit rows are pinned by `store.audit.db.test.ts` instead (the groups
 * precedent).
 *
 * Uses `auth()` directly: each action is its own invocation.
 */

const TEAMS = (slug: string) => `/o/${slug}/admin/worship/teams`;
const TYPES = (slug: string) => `/o/${slug}/admin/worship/service-types`;

function revalidateTeams(slug: string, groupId?: string) {
  revalidatePath(`/o/${slug}/admin/worship`);
  revalidatePath(TEAMS(slug));
  if (groupId) revalidatePath(`${TEAMS(slug)}/${groupId}`);
  revalidatePath(`/o/${slug}/admin/groups`);
}

function revalidateTypes(slug: string) {
  revalidatePath(`/o/${slug}/admin/worship`);
  revalidatePath(TYPES(slug));
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export async function createTeamAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ groupId: string }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = createTeamSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => createTeam(who.identity.viewer, parsed.data));
  revalidateTeams(who.identity.slug);
  return toActionResult(result, who.identity.organizationName, (d) => ({ groupId: d.groupId }));
}

export async function adoptTeamAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ groupId: string }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = adoptTeamSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => adoptTeam(who.identity.viewer, parsed.data));
  revalidateTeams(who.identity.slug);
  return toActionResult(result, who.identity.organizationName);
}

export async function updateTeamAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ groupId: string }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = updateTeamSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => updateTeam(who.identity.viewer, parsed.data));
  revalidateTeams(who.identity.slug, parsed.data.groupId);
  return toActionResult(result, who.identity.organizationName);
}

export async function retireTeamAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ groupId: string }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = retireTeamSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => retireTeam(who.identity.viewer, parsed.data));
  revalidateTeams(who.identity.slug, parsed.data.groupId);
  return toActionResult(result, who.identity.organizationName);
}

// ---------------------------------------------------------------------------
// Positions and qualifications
// ---------------------------------------------------------------------------

export async function addPositionAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ positionId: string }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = addPositionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => addPosition(who.identity.viewer, parsed.data));
  revalidateTeams(who.identity.slug, parsed.data.groupId);
  return toActionResult(result, who.identity.organizationName);
}

export async function updatePositionAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ positionId: string }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = updatePositionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => updatePosition(who.identity.viewer, parsed.data));
  revalidateTeams(who.identity.slug);
  return toActionResult(result, who.identity.organizationName);
}

export async function retirePositionAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ positionId: string }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = retirePositionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => retirePosition(who.identity.viewer, parsed.data));
  revalidateTeams(who.identity.slug);
  return toActionResult(result, who.identity.organizationName);
}

export async function setQualificationsAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ added: number; ended: number }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = setQualificationsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => setQualifications(who.identity.viewer, parsed.data));
  revalidateTeams(who.identity.slug, parsed.data.groupId);
  return toActionResult(result, who.identity.organizationName);
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export async function addTeamMemberAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ changed: boolean }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = addTeamMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => addTeamMember(who.identity.viewer, parsed.data));
  revalidateTeams(who.identity.slug, parsed.data.groupId);
  return toActionResult(result, who.identity.organizationName);
}

export async function endTeamMemberAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ changed: boolean }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = endTeamMemberSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => endTeamMember(who.identity.viewer, parsed.data));
  revalidateTeams(who.identity.slug, parsed.data.groupId);
  return toActionResult(result, who.identity.organizationName);
}

/** The roster search the "Add a person" box calls as the viewer types. A read; names only. */
export async function searchRosterCandidatesAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<RosterCandidate[]>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = searchRosterSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => searchRosterCandidates(who.identity.viewer, parsed.data));
  return toActionResult(result, who.identity.organizationName);
}

// ---------------------------------------------------------------------------
// Service types
// ---------------------------------------------------------------------------

export async function createServiceTypeAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ serviceTypeId: string }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = createServiceTypeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => createServiceType(who.identity.viewer, parsed.data));
  revalidateTypes(who.identity.slug);
  return toActionResult(result, who.identity.organizationName);
}

export async function updateServiceTypeAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ serviceTypeId: string }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = updateServiceTypeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => updateServiceType(who.identity.viewer, parsed.data));
  revalidateTypes(who.identity.slug);
  return toActionResult(result, who.identity.organizationName);
}

export async function retireServiceTypeAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ serviceTypeId: string }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = retireServiceTypeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => retireServiceType(who.identity.viewer, parsed.data));
  revalidateTypes(who.identity.slug);
  return toActionResult(result, who.identity.organizationName);
}

export async function setServiceTypeTeamsAction(
  slug: string,
  input: unknown,
): Promise<ActionResult<{ serviceTypeId: string }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = setServiceTypeTeamsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => setServiceTypeTeams(who.identity.viewer, parsed.data));
  revalidateTypes(who.identity.slug);
  return toActionResult(result, who.identity.organizationName);
}
