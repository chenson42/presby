"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  assertOrgAccess,
  OrgAccessError,
  resolveOrgContext,
  type OrganizationType,
} from "@/lib/authz";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { isFlagEnabled } from "@/lib/flags";
import { withdrawFiling, MINUTE_REFERENCE_MAX } from "@/lib/filings";
import type { ActionResult } from "@/types/actions";

/**
 * Server Actions for `/o/<slug>/admin/filings` — the congregation's own
 * withdraw-a-published-return act (DECISION-152,
 * `docs/work-log/2026-09-26-withdraw-publication.md`). Same shape as every
 * other `actions.ts` under `(org)`: all SQL correctness lives in and is
 * proven by `src/lib/filings.ts`/`filings.test.ts` — this file's only job is
 * auth-in-the-action-body plumbing, the flag/org-type gate, the
 * `FilingsResult` -> `ActionResult` copy mapping, and the audit write.
 * `organizationId` NEVER comes from client-supplied form data, and neither
 * does the withdrawing user's identity — see `withdrawFilingAction`'s own
 * note below.
 */

const FILINGS_FLAG = "org_portal.filings";
const FILINGS_ORG_TYPES: readonly OrganizationType[] = ["congregation"];

const withdrawFilingSchema = z.object({
  publicationId: z.string().uuid(),
  minuteReference: z
    .string()
    .trim()
    .min(1, "Enter a minute reference.")
    .max(
      MINUTE_REFERENCE_MAX,
      `Minute reference must be ${MINUTE_REFERENCE_MAX} characters or fewer.`,
    ),
});

async function resolveActingIdentity(slug: string): Promise<
  | {
      ok: true;
      userId: string;
      personId: string;
      organizationId: string;
      organizationType: OrganizationType;
    }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, error: "You don't have access to that organization." };
  }

  // Re-verify membership right before acting — the same relationship
  // resolveOrgContext() already found, re-checked at the moment of the
  // mutation rather than trusted from an earlier read (the `(org)` contract:
  // "no page may assume the user arrived via the chooser," applied here to
  // the action boundary instead of the page render).
  try {
    await assertOrgAccess(resolved.org.personId, resolved.org.organizationId);
  } catch (err) {
    if (err instanceof OrgAccessError) {
      return { ok: false, error: "You don't have access to that organization." };
    }
    throw err;
  }

  return {
    ok: true,
    userId: session.user.id,
    personId: resolved.org.personId,
    organizationId: resolved.org.organizationId,
    organizationType: resolved.org.organizationType,
  };
}

// ---------------------------------------------------------------------------
// withdrawFilingAction
// ---------------------------------------------------------------------------

export async function withdrawFilingAction(
  slug: string,
  input: { publicationId: string; minuteReference: string },
): Promise<ActionResult<{ id: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  // Flag and org-type gates, defense-in-depth beyond the page that hides
  // this action's own button (same "flag-only tile, permission is a second,
  // independent question" discipline `tiles.ts` states as a standing rule) —
  // a direct call to this action while the flag is off, or from an org type
  // this feature was never built for, is refused here rather than reaching
  // src/lib/filings.ts at all.
  const filingsEnabled = await isFlagEnabled(FILINGS_FLAG);
  if (!filingsEnabled) {
    return {
      ok: false,
      error: "Statistical filings aren't turned on for this organization.",
    };
  }
  if (!FILINGS_ORG_TYPES.includes(identity.organizationType)) {
    return {
      ok: false,
      error: "Statistical filings aren't available for this organization.",
    };
  }

  const parsed = withdrawFilingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  // `identity.userId` — the AUTHENTICATED SESSION's own user id — is the
  // ONLY source of `withdrawnBy`/`actingUserId`. `input` is validated above
  // through `withdrawFilingSchema`, which has NO field shaped like a user or
  // actor id (`publicationId`, `minuteReference` only) — there is no key in
  // the client-supplied payload this action could read a withdrawing
  // identity out of even if it tried. `withdrawFiling()`'s own TypeScript
  // signature repeats the enforcement: its third parameter is a plain
  // positional `actingUserId: string`, filled in here from `identity.userId`
  // and nowhere else, matching `setCongregationStatistics()`'s
  // `actingUserId` precedent (`src/lib/presbytery.ts:618-621`).
  const result = await withdrawFiling(
    identity.personId,
    identity.organizationId,
    identity.userId,
    parsed.data.publicationId,
    parsed.data.minuteReference,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to withdraw filings here.",
      };
    case "invalid_target":
      return {
        ok: false,
        error: "That filing can't be withdrawn. Refresh the page and try again.",
      };
    case "invalid_input":
      return { ok: false, error: result.message };
    case "already_withdrawn":
      return { ok: false, error: "This filing has already been withdrawn." };
    case "superseded":
      return {
        ok: false,
        error:
          "A newer filing supersedes this one — only the current filing can be withdrawn.",
      };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.STATISTICS_RETURN_WITHDRAWN,
    resourceType: "publications",
    resourceId: result.data.id,
    // Both organization ids, per Phase 2's Audit Events ruling. aboutOrgId is
    // identity.organizationId itself, never a second read: a congregation's
    // OWN publication is always about itself (src/lib/filings.ts's header —
    // "the congregation owns its publications and statistical_returns rows
    // outright"). recipientOrgId/reportYear come from withdrawFiling()'s own
    // read-back — no extra round trip from this file.
    metadata: {
      organizationId: identity.organizationId,
      recipientOrgId: result.data.recipientOrgId,
      aboutOrgId: identity.organizationId,
      reportYear: result.data.reportYear,
      publicationId: result.data.id,
    },
  });

  revalidatePath(`/o/${slug}/admin/filings`);

  return { ok: true, data: { id: result.data.id } };
}
