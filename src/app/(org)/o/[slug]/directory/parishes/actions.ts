"use server";

import { revalidatePath } from "next/cache";
import { districtNameFormSchema } from "@/lib/parishes-pure";
import {
  archiveDistrict,
  defineDistrict,
  renameDistrict,
  restoreDistrict,
} from "@/lib/parishes";
import { isUuid } from "@/lib/is-uuid";
import type { ActionResult } from "@/types/actions";
import { resolveActingIdentity } from "./acting-identity";
import { describeParishFailure, describeParishThrow } from "./parish-failure";

/**
 * Server actions for `/o/<slug>/directory/parishes` - define, rename, archive and
 * restore a district (docs/work-log/2026-10-25-parish-management.md, Phase 3
 * "Server actions"; DECISIONS 243 to 245).
 *
 * Every rule - the per-org toggle, the `officers.manage` check, the name rule,
 * the unique active name, the archive state machine - and every audit row lives
 * in and is proven by `src/lib/parishes.ts` / `parishes.test.ts`, inside one
 * transaction. This file's only jobs are the auth-in-the-action-body plumbing
 * (`resolveActingIdentity`, never a client-supplied organization id), shape
 * validation of the client's input, and the error-to-copy mapping
 * (`describeParishFailure`). It calls no `recordAudit()` (the library writes the
 * audit row in the same transaction as the change; `parishes-boundaries.test.ts`
 * pins that). A refusal for the toggle being off and one for missing authority
 * are the same copy.
 */

function revalidate(slug: string): void {
  revalidatePath(`/o/${slug}/directory/parishes`, "layout");
}

function invalidInput(): { ok: false; error: string } {
  return { ok: false, error: "We couldn't save that. Nothing was changed." };
}

export async function defineDistrictAction(
  slug: string,
  input: { name: string },
): Promise<ActionResult<{ orgUnitId: string; name: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const parsed = districtNameFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? invalidInput().error };
  }

  try {
    const result = await defineDistrict(
      identity.personId,
      identity.organizationId,
      { userId: identity.userId, email: identity.email },
      { name: parsed.data.name },
    );
    if (result.kind !== "ok") {
      return { ok: false, error: describeParishFailure(result, { action: "define" }) };
    }
    revalidate(slug);
    return { ok: true, data: { orgUnitId: result.orgUnitId, name: result.name } };
  } catch (err) {
    return { ok: false, error: describeParishThrow(err, "define") };
  }
}

export async function renameDistrictAction(
  slug: string,
  input: { orgUnitId: string; name: string },
): Promise<ActionResult<{ name: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const parsed = districtNameFormSchema.safeParse({ name: input?.name });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? invalidInput().error };
  }
  if (!isUuid(input?.orgUnitId)) {
    return { ok: false, error: describeParishFailure({ kind: "not_found" }, { action: "rename" }) };
  }

  try {
    const result = await renameDistrict(
      identity.personId,
      identity.organizationId,
      { userId: identity.userId, email: identity.email },
      { orgUnitId: input.orgUnitId, name: parsed.data.name },
    );
    if (result.kind !== "ok") {
      return { ok: false, error: describeParishFailure(result, { action: "rename" }) };
    }
    revalidate(slug);
    return { ok: true, data: { name: result.name } };
  } catch (err) {
    return { ok: false, error: describeParishThrow(err, "rename") };
  }
}

export async function archiveDistrictAction(
  slug: string,
  input: { orgUnitId: string },
): Promise<ActionResult<{ name: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  if (!isUuid(input?.orgUnitId)) {
    return { ok: false, error: describeParishFailure({ kind: "not_found" }, { action: "archive" }) };
  }

  try {
    const result = await archiveDistrict(
      identity.personId,
      identity.organizationId,
      { userId: identity.userId, email: identity.email },
      { orgUnitId: input.orgUnitId },
    );
    if (result.kind !== "ok") {
      return { ok: false, error: describeParishFailure(result, { action: "archive" }) };
    }
    revalidate(slug);
    return { ok: true, data: { name: result.name } };
  } catch (err) {
    return { ok: false, error: describeParishThrow(err, "archive") };
  }
}

export async function restoreDistrictAction(
  slug: string,
  input: { orgUnitId: string },
): Promise<ActionResult<{ name: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  if (!isUuid(input?.orgUnitId)) {
    return { ok: false, error: describeParishFailure({ kind: "not_found" }, { action: "restore" }) };
  }

  try {
    const result = await restoreDistrict(
      identity.personId,
      identity.organizationId,
      { userId: identity.userId, email: identity.email },
      { orgUnitId: input.orgUnitId },
    );
    if (result.kind !== "ok") {
      return { ok: false, error: describeParishFailure(result, { action: "restore" }) };
    }
    revalidate(slug);
    return { ok: true, data: { name: result.name } };
  } catch (err) {
    return { ok: false, error: describeParishThrow(err, "restore") };
  }
}
