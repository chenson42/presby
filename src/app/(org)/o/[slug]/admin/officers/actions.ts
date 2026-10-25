"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import {
  endOfficerTerm,
  setOfficerTermPublicDisplayOrder,
  setOfficerTermPublicListed,
  startOfficerTerm,
  type EndOfficerTermInput,
  type OfficersResult,
  type SetOfficerTermPublicDisplayOrderInput,
  type SetOfficerTermPublicListedInput,
  type StartOfficerTermInput,
} from "@/lib/officers";
import { OFFICE_LABELS } from "@/lib/officer-offices";
import type { ActionResult } from "@/types/actions";

/**
 * Server Actions for `/o/<slug>/admin/officers` — groups-and-officers Phase 3
 * design (`docs/work-log/2026-08-26-groups-and-officers.md`), commit 2/3.
 * All SQL correctness (the `officers.manage` gate, the F21-shaped
 * membership/org_unit scoping, the exclusion-constraint mapping, the no-
 * upsert/no-delete write path) lives in and is proven by `src/lib/officers.ts`
 * / `officers.test.ts` — this file's only job is the auth-in-the-action-body
 * plumbing and the error→copy mapping named in Phase 3's API contract. The
 * audit rows for starting and ending a term are written by `startOfficerTerm()`
 * and `endOfficerTerm()` themselves, in the same transaction as the term
 * (Increment 2, R13); this file calls no `recordAudit()` at all. Read paths
 * (`listOfficerRoster`/`getOfficerHistory`/`getOfficerFormOptions`) are called
 * directly from the page (a Server Component), not through this file — same
 * shape as `admin/roles/page.tsx` calling `listGrants`/`getGrantFormOptions`
 * directly.
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
 *   - `on_roll`          → a pastor can't also be on this congregation's roll
 *     (S1, DECISION-206).
 *   - `invalid_office_for_org` → Session and Board of Deacons offices belong
 *     to congregations (F189: this used to be a raw foreign-key error).
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
  | {
      ok: true;
      userId: string;
      email: string | null;
      personId: string;
      organizationId: string;
    }
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
    email: session.user.email ?? null,
    personId: resolved.org.personId,
    organizationId: resolved.org.organizationId,
  };
}

const FORBIDDEN_COPY = "You don't have permission to manage officer terms here.";

/** The one copy for every non-ok `OfficersResult`, so the actions cannot
 * drift (a type error if a new kind is added without copy). `invalidTarget`
 * differs by action ("that person or district" vs "that officer term"). */
function describeOfficersFailure(
  result: Exclude<OfficersResult<unknown>, { kind: "ok" }>,
  invalidTarget: string,
): string {
  switch (result.kind) {
    case "forbidden":
      return FORBIDDEN_COPY;
    case "invalid_target":
      return invalidTarget;
    case "invalid_input":
      return result.message;
    case "overlap":
      return `${result.personName} already has an open term as ${result.officeLabel} — end it first.`;
    case "on_roll":
      return `${result.personName} is on this congregation's roll. A pastor's membership is held by the presbytery, so a pastor can't also be recorded on the roll here.`;
    case "invalid_office_for_org":
      return `${result.officeLabel} isn't available for this kind of organization. Session and Board of Deacons offices belong to congregations.`;
    case "district_unavailable":
      return "That district is archived. Choose an active district.";
  }
}

const PERSON_OR_DISTRICT_COPY =
  "That person or district doesn't belong to this organization.";
const TERM_GONE_COPY = "That officer term no longer exists.";

// ---------------------------------------------------------------------------
// startOfficerTermAction
// ---------------------------------------------------------------------------

export async function startOfficerTermAction(
  slug: string,
  input: StartOfficerTermInput,
): Promise<ActionResult<{ termId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  // An unknown office would make the lib throw (bad input is a caller bug);
  // a user must see a message, not a 500, so the action checks it first. The
  // list is the pure vocabulary, not a client-supplied one.
  if (!input || typeof input.office !== "string" || !(input.office in OFFICE_LABELS)) {
    return { ok: false, error: "That office isn't available." };
  }

  const result = await startOfficerTerm(
    identity.personId,
    identity.organizationId,
    identity.userId,
    input,
    { actingUserEmail: identity.email },
  );

  if (result.kind !== "ok") {
    return {
      ok: false,
      error: describeOfficersFailure(result, PERSON_OR_DISTRICT_COPY),
    };
  }

  // The audit row (`tenant.officer_term.started`, with `selfRecorded`) was
  // written by startOfficerTerm() in the same transaction as the term.
  revalidatePath(`/o/${slug}/admin/officers`);

  return { ok: true, data: { termId: result.data.termId } };
}

// ---------------------------------------------------------------------------
// endOfficerTermAction
// ---------------------------------------------------------------------------

/**
 * The input is the term id, the end date and the reason ONLY. It used to also
 * carry the person and office so this action could write an audit row; the lib
 * now reads both from the term's own row, so the audit metadata is no longer
 * client-supplied (Increment 2, R13).
 */
export async function endOfficerTermAction(
  slug: string,
  input: EndOfficerTermInput,
): Promise<ActionResult<{ termId: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await endOfficerTerm(
    identity.personId,
    identity.organizationId,
    identity.userId,
    {
      termId: input.termId,
      endsOn: input.endsOn,
      endReason: input.endReason,
    },
    { actingUserEmail: identity.email },
  );

  if (result.kind !== "ok") {
    return { ok: false, error: describeOfficersFailure(result, TERM_GONE_COPY) };
  }

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

  if (result.kind !== "ok") {
    return { ok: false, error: describeOfficersFailure(result, TERM_GONE_COPY) };
  }

  revalidatePath(`/o/${slug}/admin/officers`);

  return {
    ok: true,
    data: { termId: result.data.termId, publicListed: result.data.publicListed },
  };
}

// ---------------------------------------------------------------------------
// setOfficerTermPublicDisplayOrderAction
// ---------------------------------------------------------------------------

/**
 * Public-directory display-order curation (docs/work-log/
 * 2026-08-28-public-directory-primitives.md, Phase 3). A SEPARATE action
 * from `setOfficerTermPublicListedAction` above — see `src/lib/officers.ts`'s
 * own doc comment on `setOfficerTermPublicDisplayOrder()` for why. This
 * action calls no `recordAudit()` (matching the underlying mutation's own
 * no-audit ruling — presentation-order only, not a disclosure fact).
 */
export async function setOfficerTermPublicDisplayOrderAction(
  slug: string,
  input: SetOfficerTermPublicDisplayOrderInput,
): Promise<ActionResult<{ termId: string; publicDisplayOrder: number | null }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const result = await setOfficerTermPublicDisplayOrder(
    identity.personId,
    identity.organizationId,
    input,
  );

  if (result.kind !== "ok") {
    return { ok: false, error: describeOfficersFailure(result, TERM_GONE_COPY) };
  }

  revalidatePath(`/o/${slug}/admin/officers`);

  return {
    ok: true,
    data: {
      termId: result.data.termId,
      publicDisplayOrder: result.data.publicDisplayOrder,
    },
  };
}
