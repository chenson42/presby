"use server";

import { revalidatePath } from "next/cache";
import { ACTION_COPY } from "@/lib/worship/copy";
import { guardedCall, resolveActionIdentity, toActionResult } from "@/lib/worship/action-gate";
import {
  addPositionSchema,
  addTeamMemberSchema,
  adoptTeamSchema,
  cancelServiceSchema,
  createServiceSchema,
  createServiceTypeSchema,
  createTeamSchema,
  endTeamMemberSchema,
  generateServicesSchema,
  setServiceTeamsForEventSchema,
  updateServiceSchema,
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
  cancelService,
  createService,
  createServiceType,
  createTeam,
  endTeamMember,
  generateServices,
  setServiceTeams,
  updateService,
  type CreateServiceData,
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
 * QUALIFICATION, ROSTER, SERVICE-TYPE and SERVICE actions (the scheduling
 * actions - place, remove, record, send - live in the member tree's
 * `worship/actions.ts`, which the board imports, so it has one set). Each action: authenticate and resolve the organization from the
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

// ---------------------------------------------------------------------------
// Services (worship.plan)
// ---------------------------------------------------------------------------

const SERVICES = (slug: string) => `/o/${slug}/admin/worship/services`;

function revalidateServices(slug: string, eventId?: string) {
  revalidatePath(`/o/${slug}/admin/worship`);
  revalidatePath(SERVICES(slug));
  if (eventId) revalidatePath(`${SERVICES(slug)}/${eventId}`);
  revalidatePath(`/o/${slug}/worship`);
  revalidatePath(`/o/${slug}/calendar`);
}

/** Add one service. When another service starts at the same minute, nothing is created and the duplicate is returned; resend with `allowDuplicate`. */
export async function createServiceAction(slug: string, input: unknown): Promise<ActionResult<CreateServiceData>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = createServiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => createService(who.identity.viewer, parsed.data));
  revalidateServices(who.identity.slug);
  return toActionResult(result, who.identity.organizationName);
}

/** Add several services from a service type. */
export async function generateServicesAction(slug: string, input: unknown): Promise<ActionResult<{ eventIds: string[] }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = generateServicesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => generateServices(who.identity.viewer, parsed.data));
  revalidateServices(who.identity.slug);
  return toActionResult(result, who.identity.organizationName);
}

export async function updateServiceAction(slug: string, input: unknown): Promise<ActionResult<{ eventId: string }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = updateServiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => updateService(who.identity.viewer, parsed.data));
  revalidateServices(who.identity.slug, parsed.data.eventId);
  return toActionResult(result, who.identity.organizationName);
}

/** Cancel a service: the one cancel writer, so the people involved are told by the cancel hook (queued, sent by the cron). */
export async function cancelServiceAction(slug: string, input: unknown): Promise<ActionResult<{ changed: boolean }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = cancelServiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => cancelService(who.identity.viewer, parsed.data));
  revalidateServices(who.identity.slug, parsed.data.eventId);
  return toActionResult(result, who.identity.organizationName);
}

export async function setServiceTeamsAction(slug: string, input: unknown): Promise<ActionResult<{ eventId: string }>> {
  const who = await resolveActionIdentity(slug);
  if (!who.ok) return { ok: false, error: who.error };
  const parsed = setServiceTeamsForEventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ACTION_COPY.generic };

  const result = await guardedCall(() => setServiceTeams(who.identity.viewer, parsed.data));
  revalidateServices(who.identity.slug, parsed.data.eventId);
  return toActionResult(result, who.identity.organizationName);
}
