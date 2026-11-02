"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { OrgAccessError, resolveOrgContext } from "@/lib/authz";
import {
  archivePerson,
  changeEngagement,
  restorePerson,
  updateVisitDetails,
  type EngagementActor,
} from "@/lib/community-engagement";
import { isUuid } from "@/lib/is-uuid";
import {
  isEditableEngagement,
  isEngagement,
  type Engagement,
  type MembershipStanding,
} from "@/lib/membership-standing";
import type { ActionResult } from "@/types/actions";
import {
  ARCHIVE_COPY,
  CHANGE_ENGAGEMENT_COPY,
  RESTORE_COPY,
  VISIT_DETAILS_COPY,
} from "./engagement-copy";
import { VALIDATION_COPY } from "./participant-copy";

/**
 * Server Actions for the Community engagement, archive and visit-detail writes
 * (Increment 3a, docs/work-log/2026-10-22-founding-admin-directory-inc3.md,
 * Phase 3 section 5; DECISION-234, DECISION-235). Plumbing identical to
 * `[id]/edit/actions.ts`'s `removeParticipantAction`: `auth()` (not
 * `cachedAuth()`), `resolveOrgContext()` re-run inside the body, and the
 * ORGANIZATION, the ACTING PERSON and the AUDIT ACTOR all derived here from the
 * session and the slug, never from the client.
 *
 * Every input is PARSED AND REBUILT from its known fields (a Server Action's
 * parameter type is not a runtime boundary): `personId` through `isUuid`, `to`
 * through the closed list of four, the optional stale-guard through the
 * five-value vocabulary, free text as strings only. A forged extra property
 * (`organizationId`, `from`, `actor`) is never read, and `staff` is never an
 * accepted target.
 *
 * These actions hold no `db.*` call and write no audit row of their own: the
 * library writes it with `insertAuditRow(tx, ...)` in the transaction that made
 * the change (a failed audit insert rolls the change back, EC-16), so
 * `check:audit` passes vacuously, as it does for the participant actions.
 *
 * A thrown database error is logged by CLASS only (a message can carry a
 * value) and shown as the one fixed "Nothing was changed" sentence. No action
 * redirects.
 */

/** Error CLASS only, for logs: never the message (it can carry values). */
function errorClass(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code)
      : undefined;
  return code ? `${name}/${code}` : name;
}

type Gate =
  | { ok: true; viewerPersonId: string; organizationId: string; actor: EngagementActor }
  | { ok: false; error: string };

/** authenticate, then resolve the organization from the slug; never from input. */
async function gate(slug: unknown): Promise<Gate> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: VALIDATION_COPY.signedOut };
  if (typeof slug !== "string") return { ok: false, error: VALIDATION_COPY.noAccess };
  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") return { ok: false, error: VALIDATION_COPY.noAccess };
  return {
    ok: true,
    viewerPersonId: resolved.org.personId,
    organizationId: resolved.org.organizationId,
    actor: { userId: session.user.id, email: session.user.email ?? null },
  };
}

/** The input as an object, or null: a primitive, null or array is not an input. */
function asRecord(input: unknown): Record<string, unknown> | null {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}

function revalidatePerson(slug: string, personId: string): void {
  revalidatePath(`/o/${slug}/admin/community`);
  revalidatePath(`/o/${slug}/admin/community/${personId}/edit`);
  // Engagement and archive move people in and out of the member directory.
  revalidatePath(`/o/${slug}/directory`);
}

/**
 * The shared catch: a membership that ended between the page and the click is
 * "no access", anything else is the fixed database sentence (class logged).
 */
function failure(name: string, err: unknown, dbError: string): { ok: false; error: string } {
  if (err instanceof OrgAccessError) return { ok: false, error: VALIDATION_COPY.noAccess };
  console.error(`[${name}] failed:`, errorClass(err));
  return { ok: false, error: dbError };
}

// ---------------------------------------------------------------------------
// changeEngagementAction
// ---------------------------------------------------------------------------

/**
 * Sets a person's engagement to Visitor, Regular attender, Inactive or Moved
 * away. Gate: a signed-in member of this organization who holds `people.manage`
 * (the library checks it in the write's own transaction). `to` is one of the
 * four editable values; `expectedFrom` is an optional guard: the engagement the
 * page was showing, so a change made by someone else in the meantime answers
 * "This changed while you were looking" instead of overwriting it.
 */
export async function changeEngagementAction(
  slug: string,
  input: { personId: string; to: string; expectedFrom?: string },
): Promise<ActionResult<{ from: Engagement; to: Engagement; standingTo: MembershipStanding }>> {
  const g = await gate(slug);
  if (!g.ok) return { ok: false, error: g.error };

  const raw = asRecord(input);
  if (!raw || typeof raw.personId !== "string" || !isUuid(raw.personId)) {
    return { ok: false, error: CHANGE_ENGAGEMENT_COPY.not_found };
  }
  if (!isEditableEngagement(raw.to)) {
    return { ok: false, error: VALIDATION_COPY.unknownKind };
  }
  const expectedFrom = isEngagement(raw.expectedFrom) ? raw.expectedFrom : undefined;
  const personId = raw.personId;

  let result: Awaited<ReturnType<typeof changeEngagement>>;
  try {
    result = await changeEngagement(
      g.viewerPersonId,
      g.organizationId,
      { personId, to: raw.to, ...(expectedFrom ? { expectedFrom } : {}) },
      g.actor,
    );
  } catch (err) {
    return failure("changeEngagementAction", err, CHANGE_ENGAGEMENT_COPY.db_error);
  }

  if (result.kind !== "ok") {
    return { ok: false, error: CHANGE_ENGAGEMENT_COPY[result.kind] };
  }

  revalidatePerson(slug, personId);
  return { ok: true, data: { from: result.from, to: result.to, standingTo: result.standingTo } };
}

// ---------------------------------------------------------------------------
// archivePersonAction / restorePersonAction
// ---------------------------------------------------------------------------

/**
 * Archives a visitor, or a person marked inactive or moved away: ends their
 * membership with the fixed archive marker (nothing is deleted). Gate: signed
 * in, a member of this organization, `people.manage`. A member on the roll, a
 * participant, a staff anchor, the viewer's own record, a person holding an
 * office, a role or a staff position, and a person with a pending roll action
 * are each refused with their own sentence.
 */
export async function archivePersonAction(
  slug: string,
  input: { personId: string },
): Promise<ActionResult<{ personId: string }>> {
  const g = await gate(slug);
  if (!g.ok) return { ok: false, error: g.error };

  const raw = asRecord(input);
  if (!raw || typeof raw.personId !== "string" || !isUuid(raw.personId)) {
    return { ok: false, error: ARCHIVE_COPY.not_found };
  }
  const personId = raw.personId;

  let result: Awaited<ReturnType<typeof archivePerson>>;
  try {
    result = await archivePerson(g.viewerPersonId, g.organizationId, { personId }, g.actor);
  } catch (err) {
    return failure("archivePersonAction", err, ARCHIVE_COPY.db_error);
  }

  if (result.kind !== "ok") return { ok: false, error: ARCHIVE_COPY[result.kind] };

  revalidatePerson(slug, personId);
  return { ok: true, data: { personId } };
}

/**
 * Restores an archived person (only the archive marker is reopened; a removed
 * participant or any other ended membership is `not_archived`). Gate: signed in,
 * a member of this organization, `people.manage`. `list` says which list they
 * return to: Visitors for an archived visitor, Inactive otherwise (the
 * engagement kept on the ended row decides).
 */
export async function restorePersonAction(
  slug: string,
  input: { personId: string },
): Promise<ActionResult<{ personId: string; list: "visitors" | "inactive" }>> {
  const g = await gate(slug);
  if (!g.ok) return { ok: false, error: g.error };

  const raw = asRecord(input);
  if (!raw || typeof raw.personId !== "string" || !isUuid(raw.personId)) {
    return { ok: false, error: RESTORE_COPY.not_found };
  }
  const personId = raw.personId;

  let result: Awaited<ReturnType<typeof restorePerson>>;
  try {
    result = await restorePerson(g.viewerPersonId, g.organizationId, { personId }, g.actor);
  } catch (err) {
    return failure("restorePersonAction", err, RESTORE_COPY.db_error);
  }

  if (result.kind !== "ok") return { ok: false, error: RESTORE_COPY[result.kind] };

  revalidatePerson(slug, personId);
  return {
    ok: true,
    data: { personId, list: result.engagement === "visitor" ? "visitors" : "inactive" },
  };
}

// ---------------------------------------------------------------------------
// updateVisitDetailsAction
// ---------------------------------------------------------------------------

/**
 * Corrects a visit's first date and how the person heard about the congregation.
 * Gate: signed in, a member of this organization, `people.manage`. A blank or
 * null field clears it; the date must be real, from 1900 up to today; the text
 * is trimmed and at most 200 characters. Saving what is already stored is a
 * quiet success (no audit row is written).
 */
export async function updateVisitDetailsAction(
  slug: string,
  input: { personId: string; firstVisitDate: string | null; howHeard: string | null },
): Promise<ActionResult<{ personId: string }>> {
  const g = await gate(slug);
  if (!g.ok) return { ok: false, error: g.error };

  const raw = asRecord(input);
  if (!raw || typeof raw.personId !== "string" || !isUuid(raw.personId)) {
    return { ok: false, error: VISIT_DETAILS_COPY.not_found };
  }
  const personId = raw.personId;
  // A non-string is "clear it": the form sends null or "" for an empty field.
  const firstVisitDate = typeof raw.firstVisitDate === "string" ? raw.firstVisitDate : null;
  const howHeard = typeof raw.howHeard === "string" ? raw.howHeard : null;

  let result: Awaited<ReturnType<typeof updateVisitDetails>>;
  try {
    result = await updateVisitDetails(
      g.viewerPersonId,
      g.organizationId,
      { personId, firstVisitDate, howHeard },
      g.actor,
    );
  } catch (err) {
    return failure("updateVisitDetailsAction", err, VISIT_DETAILS_COPY.db_error);
  }

  if (result.kind !== "ok" && result.kind !== "unchanged") {
    return { ok: false, error: VISIT_DETAILS_COPY[result.kind] };
  }

  revalidatePerson(slug, personId);
  return { ok: true, data: { personId } };
}
