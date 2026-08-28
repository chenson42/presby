"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import {
  endOfficerTerm,
  setOfficerTermPublicListed,
  startOfficerTerm,
  type EndOfficerTermInput,
  type OfficerOffice,
  type SetOfficerTermPublicListedInput,
  type StartOfficerTermInput,
} from "@/lib/officers";
import type { ActionResult } from "@/types/actions";

/**
 * Server Actions for `/o/<slug>/admin/officers` — groups-and-officers Phase 3
 * design (`docs/work-log/2026-08-26-groups-and-officers.md`), commit 2/3.
 * All SQL correctness (the `officers.manage` gate, the F21-shaped
 * membership/org_unit scoping, the exclusion-constraint mapping, the no-
 * upsert/no-delete write path) lives in and is proven by `src/lib/officers.ts`
 * / `officers.test.ts` — this file's only job is the auth-in-the-action-body
 * plumbing, the error→copy mapping named in Phase 3's API contract, and the
 * audit write. Read paths (`listOfficerRoster`/`getOfficerHistory`/
 * `getOfficerFormOptions`) are called directly from the page (a Server
 * Component), not through this file — same shape as `admin/roles/page.tsx`
 * calling `listGrants`/`getGrantFormOptions` directly.
 *
 * `organizationId` NEVER comes from client-supplied form data. Both actions
 * take the URL `slug` and re-resolve it through `resolveOrgContext()` —
 * inside THIS user's own membership set — via `resolveActingIdentity()`,
 * verbatim the same helper `admin/roles/actions.ts` defines (Phase 3's own
 * instruction: "mirroring `admin/roles/actions.ts`'s `resolveActingIdentity()`
 * helper verbatim"). `src/lib/officers.ts` additionally re-validates the
 * person/org_unit belong to this same org before writing, so this is
 * belt-and-suspenders, not the only gate.
 *
 * USES `auth()` DIRECTLY, NOT `cachedAuth()` — `src/lib/auth/cached-auth.ts`'s
 * own header: "Server actions — each action is a separate invocation;
 * cache() is a no-op ... Call auth() directly." Same convention
 * `admin/roles/actions.ts` follows.
 *
 * `officer_terms.recorded_by` IS A `users.id` FK (mirrors `role_grants.
 * granted_by`) — `src/lib/officers.ts`'s own membership/permission checks run
 * against `people.id`. This layer has both: `session.user.id` (a `users.id`,
 * from `auth()`) and `resolved.org.personId` (a `people.id`, from
 * `resolveOrgContext()`) — it passes both into `startOfficerTerm()` rather
 * than either function re-deriving one from the other. Same bug class
 * `src/lib/brand/read-org-brand.ts`'s header documents for the equivalent
 * mixup (P0.5).
 *
 * ERROR-MAPPING DISCIPLINE (Phase 3's API-contract table, not improvised
 * here):
 *   - `overlap`          → "{personName} already has an open term as
 *     {officeLabel} — end it first." (isExclusionViolation()'s copy,
 *     mapped inside `startOfficerTerm` itself; this file only reads the
 *     already-formatted `personName`/`officeLabel` off the result.)
 *   - `invalid_input`    → the message `officers.ts` already composed
 *     (the deacon/org_unit "iff" rule, or `endsOn` before `startsOn`).
 *   - `invalid_target`   → generic "that person/org unit doesn't belong to
 *     this organization" copy — `officers.ts` does not distinguish which
 *     one failed (mirrors `grantRole`'s `invalid_target` shape, which the
 *     caller disambiguates by input shape; officers has no such shape to
 *     disambiguate on, so one message covers both).
 *   - `forbidden`        → "You don't have permission to manage officer
 *     terms here."
 *
 * `setOfficerTermPublicListedAction` (docs/work-log/
 * 2026-08-27-public-staff-directory.md) IS A DELIBERATE DIVERGENCE from this
 * file's own "actions.ts calls recordAudit()" convention above —
 * `recordAudit()` for that mutation is called from INSIDE `src/lib/
 * officers.ts`'s `setOfficerTermPublicListed()` instead, per that
 * work-log's explicit Phase 3 instruction. This action calls no
 * `recordAudit()` itself. See that function's own doc comment for the
 * `check:audit` tripwire-coverage finding this produced.
 */

async function resolveActingIdentity(slug: string): Promise<
  | { ok: true; userId: string; personId: string; organizationId: string }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: "You must be signed in to do that." };
  }

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return {
      ok: false,
      error: "You don't have access to that organization.",
    };
  }

  return {
    ok: true,
    userId: session.user.id,
    personId: resolved.org.personId,
    organizationId: resolved.org.organizationId,
  };
}

// ---------------------------------------------------------------------------
// startOfficerTermAction
// ---------------------------------------------------------------------------

export async function startOfficerTermAction(
  slug: string,
  input: StartOfficerTermInput,
): Promise<ActionResult<{ termId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await startOfficerTerm(
    identity.personId,
    identity.organizationId,
    identity.userId,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to manage officer terms here.",
      };
    case "invalid_target":
      return {
        ok: false,
        error:
          "That person or district doesn't belong to this organization.",
      };
    case "invalid_input":
      return { ok: false, error: result.message };
    case "overlap":
      return {
        ok: false,
        error: `${result.personName} already has an open term as ${result.officeLabel} — end it first.`,
      };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.OFFICER_TERM_STARTED,
    resourceType: "officer_term",
    resourceId: result.data.termId,
    metadata: {
      organizationId: identity.organizationId,
      personId: input.personId,
      office: input.office,
      startsOn: input.startsOn,
      orgUnitId: input.orgUnitId ?? null,
    },
  });

  revalidatePath(`/o/${slug}/admin/officers`);

  return { ok: true, data: { termId: result.data.termId } };
}

// ---------------------------------------------------------------------------
// endOfficerTermAction
// ---------------------------------------------------------------------------

/**
 * `officers.ts`'s `endOfficerTerm()` returns only a result kind, not the
 * term's person/office details — the caller (the roster page, which already
 * fetched `listOfficerRoster()` to render the row being ended) supplies them
 * so this can write a complete audit-metadata record without a second read
 * inside the action. Mirrors `revokeRoleAction`'s identical shape.
 */
export async function endOfficerTermAction(
  slug: string,
  input: EndOfficerTermInput & {
    personId: string;
    office: OfficerOffice;
  },
): Promise<ActionResult<{ termId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await endOfficerTerm(
    identity.personId,
    identity.organizationId,
    {
      termId: input.termId,
      endsOn: input.endsOn,
      endReason: input.endReason,
    },
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to manage officer terms here.",
      };
    case "invalid_target":
      return { ok: false, error: "That officer term no longer exists." };
    case "invalid_input":
      return { ok: false, error: result.message };
    case "overlap":
      // Unreachable from endOfficerTerm in practice — no insert happens on
      // this path, so no exclusion constraint can fire. Handled for
      // exhaustiveness, not because officers.ts ever returns it here.
      return { ok: false, error: "Couldn't save that — try again." };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.OFFICER_TERM_ENDED,
    resourceType: "officer_term",
    resourceId: input.termId,
    metadata: {
      organizationId: identity.organizationId,
      personId: input.personId,
      office: input.office,
      endsOn: input.endsOn,
      endReason: input.endReason,
    },
  });

  revalidatePath(`/o/${slug}/admin/officers`);

  return { ok: true, data: { termId: result.data.termId } };
}

// ---------------------------------------------------------------------------
// setOfficerTermPublicListedAction
// ---------------------------------------------------------------------------

/**
 * Public staff-directory opt-in/opt-out (docs/work-log/
 * 2026-08-27-public-staff-directory.md, Phase 3). All SQL correctness (the
 * `officers.manage` gate, the `(id, organizationId)` row scoping, the
 * `recordAudit()` call) lives in and is proven by
 * `src/lib/officers.ts`/`officers.test.ts` — this action's only job is the
 * auth-in-the-action-body plumbing and the error->copy mapping, same shape
 * as `startOfficerTermAction`/`endOfficerTermAction`.
 */
export async function setOfficerTermPublicListedAction(
  slug: string,
  input: SetOfficerTermPublicListedInput,
): Promise<ActionResult<{ termId: string; publicListed: boolean }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await setOfficerTermPublicListed(
    identity.personId,
    identity.organizationId,
    identity.userId,
    input,
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to manage officer terms here.",
      };
    case "invalid_target":
      return { ok: false, error: "That officer term no longer exists." };
    case "invalid_input":
      return { ok: false, error: result.message };
    case "overlap":
      // Unreachable from setOfficerTermPublicListed in practice — no insert
      // happens on this path, so no exclusion constraint can fire. Handled
      // for exhaustiveness, matching endOfficerTermAction's own precedent.
      return { ok: false, error: "Couldn't save that — try again." };
    case "ok":
      break;
  }

  revalidatePath(`/o/${slug}/admin/officers`);

  return {
    ok: true,
    data: { termId: result.data.termId, publicListed: result.data.publicListed },
  };
}
