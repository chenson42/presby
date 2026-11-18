"use server";

import { revalidatePath } from "next/cache";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { resolveOversightActor } from "@/lib/oversight/action-gate";
import { setCongregationOversight, type SetOversightInput } from "@/lib/presbytery";
import type { ActionResult } from "@/types/actions";

/**
 * Server Action for `/o/<slug>/admin/oversight/<aboutOrgId>/assessment/edit` —
 * Presbytery program Increment 3 (`docs/work-log/2026-08-27-presbytery-program.md`),
 * moved here from `<aboutOrgId>/` by the congregation-records pipeline (T1,
 * docs/work-log/2026-11-17-congregation-profile.md). Same shape as
 * `../../../../credentials/actions.ts`: all SQL correctness (the
 * `congregation_oversight.manage` gate, the parent-path re-validation of
 * `aboutOrgId`) lives in and is proven by `src/lib/presbytery.ts`/
 * `presbytery.test.ts` — this file's only job is auth-in-the-action-body
 * plumbing, the error->copy mapping, and the audit write.
 *
 * F452: the action now runs the Node-side second-factor recheck BEFORE it reads
 * the organization (`resolveOversightActor` runs `assertOrgSession` first) and
 * refuses a malformed `aboutOrgId` before any SQL. F451: the input no longer
 * carries the superseded carrier and expiry, so a save cannot null them.
 *
 * `organizationId` NEVER comes from client-supplied form data — every call
 * re-resolves the URL `slug` through `resolveOrgContext()`. `aboutOrgId` is a URL
 * segment too, but `setCongregationOversight()` re-validates it belongs to THIS
 * presbytery before writing — belt-and-suspenders, not the only gate.
 *
 * The write is audited with `recordAudit()` AFTER the transaction commits and
 * `recordAudit` swallows its own failure, so a committed change can lack its row
 * (F455, a pre-existing residual deferred to the monthly security review; the new
 * oversight writes in `src/lib/oversight/store.ts` audit in their own transaction).
 */
export async function setCongregationOversightAction(
  slug: string,
  aboutOrgId: string,
  input: SetOversightInput,
): Promise<ActionResult<{ id: string }>> {
  const gate = await resolveOversightActor(slug, { aboutOrgId });
  if (!gate.ok) return gate.result;
  const { ctx } = gate.identity;

  const result = await setCongregationOversight(ctx.personId, ctx.organizationId, ctx.actor.userId, aboutOrgId, input);

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
      organizationId: ctx.organizationId,
      aboutOrgId,
      viabilityScore: input.viabilityScore ?? null,
    },
  });

  revalidatePath(`/o/${gate.identity.slug}/admin/oversight`);
  revalidatePath(`/o/${gate.identity.slug}/admin/oversight/${aboutOrgId}`);

  return { ok: true, data: { id: result.data.id } };
}
