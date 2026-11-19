import "server-only";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { isFlagEnabled } from "@/lib/flags";
import { isUuid } from "@/lib/is-uuid";
import { assertOrgSession } from "@/lib/org-portal/session-check";
import { COMMITTEES_FLAG, type ActionData, type CommitteesActionResult, type CommitteesCtx, type Outcome, type Written } from "./contract";
import { GATE_COPY, REFUSAL, refusalMessage } from "./copy";
import type { Parsed, ValidationEnv } from "./validate";

/**
 * The first steps of every committees Server Action (docs/work-log/2026-11-19-
 * presbytery-committees.md, Phase 3 "API Contract: common body"; the oversight
 * `action-gate.ts` shape), in this order:
 *
 *   1. `assertOrgSession(await auth())`: signed in, and the NODE-SIDE
 *      second-factor recheck (the Edge reads a claim that refreshes only when the
 *      session is re-derived), BEFORE anything reads the organization;
 *   2. `resolveOrgContext(userId, slug)` inside THIS user's own memberships: the
 *      organization and the acting person come from the URL slug and the session,
 *      never from a client value (`organizationId` is not a parameter of any
 *      action);
 *   3. the `org_portal.committees` flag, as the pages check it (a refusal in the
 *      page's own flag-off sentence, so the rollback sentence "a presbytery's
 *      committees cannot be edited at all" is true of Server Actions too);
 *   4. every id the action names is a UUID, or the answer is the one `not_found`
 *      string, before any SQL runs (a malformed id is a genuine Postgres cast
 *      error otherwise: F446).
 *
 * `auth()` and not `cachedAuth()`: each action is its own invocation, where
 * `cache()` is a no-op. A signed-out caller and a stale second factor get the
 * same refusal string (`kind` tells a form which); an unresolvable slug or an
 * ended membership is "You don't have access to that organization." The key
 * (`groups.manage`), the organization type and the committee are checked AGAIN
 * inside the store's own transaction.
 *
 * `boundaries.test.ts` pins that every exported action calls
 * `resolveCommitteesActor(` first and that this file runs `assertOrgSession`
 * before `resolveOrgContext`.
 *
 * VALIDATION ENV. The server's backstop for "the date can't be in the future" and
 * the years-ahead limits uses the server's UTC calendar day (a parse must return
 * before any transaction opens, and the organization's own zone is a database
 * read). Every organization is behind UTC, so this can be at most a few hours
 * lenient at the day boundary; the store re-checks the dissolve date against the
 * organization's own day, and the form's schema is injected the organization's
 * local date by the page and is the strict check.
 */

export interface CommitteesActionIdentity {
  ctx: CommitteesCtx;
  /** The resolved slug (validated by `resolveOrgContext`), safe to build a revalidate path from. */
  slug: string;
  env: ValidationEnv;
}

type Refused = Extract<CommitteesActionResult, { ok: false }>;

export type ActorResult = { ok: true; identity: CommitteesActionIdentity } | { ok: false; result: Refused };

export const serverEnv = (now: Date = new Date()): ValidationEnv => ({ today: now.toISOString().slice(0, 10) });

const refuse = (error: string, kind: Refused["kind"]): ActorResult => ({
  ok: false,
  result: { ok: false, error, kind },
});

/** Authenticate, resolve the organization from the slug, and check every id: or return the refusal. */
export async function resolveCommitteesActor(slug: unknown, ids: Record<string, unknown> = {}): Promise<ActorResult> {
  const session = await auth();
  const check = assertOrgSession(session);
  if (check.kind === "unauthenticated") return refuse(GATE_COPY.signedOut, "unauthenticated");
  if (check.kind === "two_factor_required") return refuse(GATE_COPY.signedOut, "two_factor_required");

  if (typeof slug !== "string") return refuse(GATE_COPY.noAccess, "forbidden");
  const resolved = await resolveOrgContext(check.userId, slug);
  if (resolved.kind !== "ok") return refuse(GATE_COPY.noAccess, "forbidden");

  // The global flag, as the pages check it (flag, then organization type, then
  // `groups.manage`; the type and the key are checked in the store's own
  // transaction). After the organization resolves, so a non-member learns nothing
  // about a rollout; before the ids, so a switched-off area answers one sentence.
  if (!(await isFlagEnabled(COMMITTEES_FLAG))) return refuse(GATE_COPY.flagOff(resolved.org.name), "forbidden");

  for (const value of Object.values(ids)) {
    if (!isUuid(value)) return refuse(REFUSAL.not_found, "not_found");
  }

  return {
    ok: true,
    identity: {
      slug: resolved.org.slug,
      env: serverEnv(),
      ctx: {
        personId: resolved.org.personId,
        organizationId: resolved.org.organizationId,
        actor: { userId: check.userId, email: session?.user?.email ?? null },
      },
    },
  };
}

/** A failed parse as the action's result: the first message, and the field it belongs under. */
export function invalidResult(parsed: Extract<Parsed<unknown>, { ok: false }>): CommitteesActionResult {
  return { ok: false, error: parsed.message, field: parsed.field, kind: "invalid" };
}

/** A value the form could never have sent (a non-boolean switch): the generic line, nothing written. */
export const tamperedResult: CommitteesActionResult = { ok: false, error: REFUSAL.save_failed, kind: "invalid" };

/**
 * A store outcome as the `ActionResult` the client toasts, revalidating the list
 * and the committee page when something was written. Every sentence is a
 * `copy.ts` string; a refusal never carries database text.
 */
export function finish(
  identity: CommitteesActionIdentity,
  committeeId: string | null,
  outcome: Outcome<Written & Partial<Omit<ActionData, keyof Written>> & { newMembershipId?: string }>,
): CommitteesActionResult {
  switch (outcome.kind) {
    case "ok": {
      const { id, unchanged, seatsEnded, cancelled, publicListed } = outcome.data;
      if (!unchanged) {
        revalidatePath(`/o/${identity.slug}/admin/committees`);
        revalidatePath(`/o/${identity.slug}/admin/committees/${committeeId ?? id}`);
      }
      return {
        ok: true,
        data: {
          id,
          ...(unchanged ? { unchanged } : {}),
          ...(seatsEnded !== undefined ? { seatsEnded } : {}),
          ...(cancelled !== undefined ? { cancelled } : {}),
          ...(publicListed !== undefined ? { publicListed } : {}),
        },
      };
    }
    case "refused":
      return { ok: false, error: refusalMessage(outcome.reason, outcome.detail), kind: outcome.reason };
    case "invalid":
      return { ok: false, error: outcome.message, field: outcome.field, kind: "invalid" };
  }
}

/**
 * A commission store outcome as the `ActionResult` the client toasts (Increment 2): the
 * same shape as `finish`, revalidating the list and the commission's own page when
 * something was written. The commission pages are not the committee's, so the path
 * differs (`/commissions/<id>`). Every sentence is a `copy.ts` string.
 */
export function finishCommission(
  identity: CommitteesActionIdentity,
  commissionId: string | null,
  outcome: Outcome<Written & Partial<Omit<ActionData, keyof Written>>>,
): CommitteesActionResult {
  switch (outcome.kind) {
    case "ok": {
      const { id, unchanged, membersEnded, cancelled } = outcome.data;
      if (!unchanged) {
        revalidatePath(`/o/${identity.slug}/admin/committees`);
        revalidatePath(`/o/${identity.slug}/admin/committees/commissions/${commissionId ?? id}`);
      }
      return {
        ok: true,
        data: {
          id,
          ...(unchanged ? { unchanged } : {}),
          ...(membersEnded !== undefined ? { membersEnded } : {}),
          ...(cancelled !== undefined ? { cancelled } : {}),
        },
      };
    }
    case "refused":
      return { ok: false, error: refusalMessage(outcome.reason, outcome.detail), kind: outcome.reason };
    case "invalid":
      return { ok: false, error: outcome.message, field: outcome.field, kind: "invalid" };
  }
}
