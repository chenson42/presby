"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { OrgAccessError, resolveOrgContext } from "@/lib/authz";
import {
  createPosting,
  movePosting,
  setPostingStatus,
  updatePosting,
  type CareersActor,
  type CareersResult,
  type PostingStatus,
} from "@/lib/careers/postings";
import {
  GENERIC_SAVE_ERROR,
  firstIssue,
  postingInputSchema,
  postingMoveSchema,
  postingStatusSchema,
  postingUpdateSchema,
  type PostingInput,
  type PostingUpdateInput,
} from "@/lib/careers/input";
import type { ActionResult } from "@/types/actions";

/**
 * Server Actions for `/o/<slug>/admin/careers` - docs/work-log/2026-10-25-careers-inc1.md,
 * Phase 3 "Server actions" and Copy S8. All correctness (the toggle and
 * `careers.manage` gate, the state machine, the compare-and-set, the audit rows)
 * lives in and is proven by `src/lib/careers/postings.ts`; this file's only job
 * is the authenticate step, the schema parse and the result-to-Copy mapping.
 * Read paths (`listPostings`/`getPosting`) are called directly from their pages.
 *
 * `organizationId` NEVER comes from client-supplied data. Every action takes the
 * URL `slug` and re-resolves it through `resolveOrgContext()` - inside THIS
 * user's own membership set - and uses the organization and person that
 * resolution returns. The schemas STRIP unknown keys, so an input carrying
 * `organizationId`, `status` or `version` on a create cannot reach the lib, and
 * the lib re-parses and re-gates regardless of this file.
 *
 * AUDIT LIVES IN THE LIB, NOT HERE (the events precedent, DECISION-240): the
 * three status changes that change what the public can read (publish, close,
 * reopen) write their `audit_events` row inside `postings.ts`, in the same
 * transaction as the change. Create, edit, reorder and discarding a draft are
 * deliberately not audited (not disclosure changes). This file therefore carries
 * no `recordAudit()` and no `db.*` call, which is why `check:audit` (it scans
 * `actions.ts` for `db.insert/update/delete/execute`) has nothing to flag; the
 * `// audit-exempt:` comments below name the reason for the three that write no
 * row, and `boundaries.test.ts` pins that every status writer in the lib audits.
 *
 * An unauthenticated caller, a slug that does not resolve for this user and a
 * membership that ended mid-request all get the SAME refusal as a missing
 * permission (Copy S8 "forbidden"): this surface does not distinguish them, and
 * the copy set has no separate sign-in string because `/o/*` is behind the proxy.
 *
 * USES `auth()` DIRECTLY, NOT `cachedAuth()` - server actions are each a separate
 * invocation, so `cache()` is a no-op; same convention every other `actions.ts`
 * in this tree follows.
 */

const FORBIDDEN = "You don't have permission to manage job openings.";

async function resolveActingIdentity(slug: string): Promise<
  | { ok: true; personId: string; organizationId: string; slug: string; actor: CareersActor }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: FORBIDDEN };

  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") return { ok: false, error: FORBIDDEN };

  return {
    ok: true,
    personId: resolved.org.personId,
    organizationId: resolved.org.organizationId,
    slug: resolved.org.slug,
    actor: { userId: session.user.id, email: session.user.email ?? null },
  };
}

/** "summary" / "summary and location" / "summary, location and description". */
function joinMissing(missing: readonly string[]): string {
  if (missing.length <= 1) return missing.join("");
  return `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
}

/** Copy S8, for every non-ok result the lib can return. */
function mapFailure(result: Exclude<CareersResult<unknown>, { kind: "ok" }>): { ok: false; error: string } {
  switch (result.kind) {
    case "forbidden":
      return { ok: false, error: FORBIDDEN };
    case "not_found":
      return { ok: false, error: "That job opening no longer exists." };
    case "feature_off":
      return { ok: false, error: "Job openings aren't turned on." };
    case "stale":
      return {
        ok: false,
        error:
          "This opening was changed by someone else after you opened it, so your changes were not saved. Reload the page to see what changed.",
      };
    case "slug_taken":
      return { ok: false, error: "Another opening already uses that web address. Choose a different one." };
    case "incomplete":
      return { ok: false, error: `Add a ${joinMissing(result.missing)} before publishing.` };
    case "closing_date_passed":
      return {
        ok: false,
        error: result.reopening
          ? "The closing date has already passed. Change it, save, then reopen."
          : "The closing date has already passed. Change it before publishing.",
      };
    case "publish_limit":
      return {
        ok: false,
        error:
          "You already have 100 job openings published, which is the most we can show. Close one before publishing another.",
      };
    case "invalid_transition":
      return { ok: false, error: "That can't be done to this opening right now. Reload the page and try again." };
    case "invalid_input":
      return { ok: false, error: result.message };
  }
}

/** A thrown `OrgAccessError` means the membership ended between the resolve and the transaction. */
async function guarded<T>(call: () => Promise<CareersResult<T>>): Promise<CareersResult<T>> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof OrgAccessError) return { kind: "forbidden" };
    throw err;
  }
}

function parseFailure(error: { issues: { path: PropertyKey[]; message: string }[] }): { ok: false; error: string } {
  return { ok: false, error: firstIssue(error).message };
}

// ---------------------------------------------------------------------------
// createPostingAction
// ---------------------------------------------------------------------------

export async function createPostingAction(
  slug: string,
  input: PostingInput,
): Promise<ActionResult<{ id: string }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const parsed = postingInputSchema.safeParse(input);
  if (!parsed.success) return parseFailure(parsed.error);

  // audit-exempt: a new draft is not public and changes no disclosure; publishing audits (postings.ts)
  const result = await guarded(() =>
    createPosting(identity.personId, identity.organizationId, identity.actor, parsed.data),
  );
  if (result.kind !== "ok") return mapFailure(result);

  revalidatePath(`/o/${identity.slug}/admin/careers`);
  return { ok: true, data: { id: result.data.id } };
}

// ---------------------------------------------------------------------------
// updatePostingAction
// ---------------------------------------------------------------------------

export async function updatePostingAction(
  slug: string,
  input: PostingUpdateInput,
): Promise<ActionResult<{ version: number }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const parsed = postingUpdateSchema.safeParse(input);
  if (!parsed.success) return parseFailure(parsed.error);

  // audit-exempt: an edit is content, not a status change; the public sees it live but no disclosure boundary moved
  const result = await guarded(() =>
    updatePosting(identity.personId, identity.organizationId, identity.actor, parsed.data),
  );
  if (result.kind !== "ok") return mapFailure(result);

  revalidatePath(`/o/${identity.slug}/admin/careers`);
  revalidatePath(`/o/${identity.slug}/admin/careers/${parsed.data.id}`);
  return { ok: true, data: { version: result.data.version } };
}

// ---------------------------------------------------------------------------
// setPostingStatusAction
// ---------------------------------------------------------------------------

/**
 * Publish, close, reopen (all audited inside the lib) and discard (a draft to
 * closed; never audited, nothing was ever public). The caller toasts the status
 * in the RETURNED data, not the one it asked for.
 */
export async function setPostingStatusAction(
  slug: string,
  input: { id: string; version: number; to: "published" | "closed" },
): Promise<ActionResult<{ status: PostingStatus; version: number }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const parsed = postingStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_SAVE_ERROR };

  const result = await guarded(() =>
    setPostingStatus(identity.personId, identity.organizationId, identity.actor, parsed.data),
  );
  if (result.kind !== "ok") return mapFailure(result);

  revalidatePath(`/o/${identity.slug}/admin/careers`);
  revalidatePath(`/o/${identity.slug}/admin/careers/${parsed.data.id}`);
  return { ok: true, data: { status: result.data.status, version: result.data.version } };
}

// ---------------------------------------------------------------------------
// movePostingAction
// ---------------------------------------------------------------------------

export async function movePostingAction(
  slug: string,
  input: { id: string; direction: "up" | "down" },
): Promise<ActionResult<{ moved: boolean }>> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const parsed = postingMoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_SAVE_ERROR };

  // audit-exempt: ordering the published list is presentation, not a disclosure change
  const result = await guarded(() =>
    movePosting(identity.personId, identity.organizationId, identity.actor, parsed.data),
  );
  if (result.kind !== "ok") return mapFailure(result);

  revalidatePath(`/o/${identity.slug}/admin/careers`);
  return { ok: true, data: { moved: result.data.moved } };
}
