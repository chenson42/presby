"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { setCongregationOversight, type SetOversightInput } from "@/lib/presbytery";
import type { ActionResult } from "@/types/actions";

/**
 * Server Action for `/o/<slug>/admin/oversight/<aboutOrgId>` — Presbytery
 * program Increment 3 (`docs/work-log/2026-08-27-presbytery-program.md`).
 * Same shape as `../../credentials/actions.ts`: all SQL correctness (the
 * `congregation_oversight.manage` gate, the parent-path re-validation of
 * `aboutOrgId`) lives in and is proven by `src/lib/presbytery.ts`/
 * `presbytery.test.ts` — this file's only job is auth-in-the-action-body
 * plumbing, the error->copy mapping, and the audit write.
 *
 * `organizationId` NEVER comes from client-supplied form data — every call
 * re-resolves the URL `slug` through `resolveOrgContext()`, same as every
 * other `actions.ts` under `(org)`. `aboutOrgId` is a URL segment too, but
 * `setCongregationOversight()` re-validates it belongs to THIS presbytery
 * before writing — belt-and-suspenders, not the only gate.
 */
export async function setCongregationOversightAction(
  slug: string,
  aboutOrgId: string,
  input: SetOversightInput,
): Promise<ActionResult<{ id: string }>> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: "You don't have access to that organization." };
  }

  const result = await setCongregationOversight(
    resolved.org.personId,
    resolved.org.organizationId,
    session.user.id,
    aboutOrgId,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to manage congregation oversight here.",
      };
    case "invalid_target":
      return {
        ok: false,
        error: "That congregation doesn't belong to this presbytery.",
      };
    case "invalid_input":
      return { ok: false, error: result.message };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.CONGREGATION_OVERSIGHT_SET,
    resourceType: "congregation_oversight",
    resourceId: result.data.id,
    metadata: {
      organizationId: resolved.org.organizationId,
      aboutOrgId,
      viabilityScore: input.viabilityScore ?? null,
    },
  });

  revalidatePath(`/o/${slug}/admin/oversight`);
  revalidatePath(`/o/${slug}/admin/oversight/${aboutOrgId}`);

  return { ok: true, data: { id: result.data.id } };
}
