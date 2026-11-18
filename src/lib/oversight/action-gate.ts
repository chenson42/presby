import "server-only";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { isUuid } from "@/lib/is-uuid";
import { assertOrgSession } from "@/lib/org-portal/session-check";
import type { ActionData, Outcome, OversightActionResult, OversightCtx, Refusal, Written } from "./contract";
import { GATE_COPY, REFUSAL, refusalMessage } from "./copy";
import type { Parsed, ValidationEnv } from "./validate";

/**
 * The first steps of every congregation-records Server Action (docs/work-log/
 * 2026-11-17-congregation-profile.md, Phase 3 "API Contract: common body"; R3;
 * F452), in this order:
 *
 *   1. `assertOrgSession(await auth())`: signed in, and the NODE-SIDE
 *      second-factor recheck (the Edge reads a claim that refreshes only when the
 *      session is re-derived, and the finance key is two-factor-flagged), BEFORE
 *      anything reads the organization;
 *   2. `resolveOrgContext(userId, slug)` inside THIS user's own memberships: the
 *      organization and the acting person come from the URL slug and the session,
 *      never from a client value (`organizationId` is not a parameter of any
 *      action);
 *   3. every id the action names is a UUID, or the answer is the one `not_found`
 *      string, before any SQL runs (a malformed id is a genuine Postgres cast
 *      error otherwise).
 *
 * `auth()` and not `cachedAuth()`: each action is its own invocation, where
 * `cache()` is a no-op. A signed-out caller and a stale second factor get the
 * same refusal string (`kind` tells a form which); an unresolvable slug or an
 * ended membership is "You don't have access to that organization."
 *
 * `boundaries.test.ts` pins that every exported action calls
 * `resolveOversightActor(` first and that this file runs `assertOrgSession` before
 * `resolveOrgContext`.
 *
 * VALIDATION ENV. The server's backstop for "the date can't be in the future" and
 * the year ceiling uses the server's UTC calendar day and year (a parse must
 * return before any transaction opens, and the organization's own zone is a
 * database read). Every organization is behind UTC, so this can be at most a few
 * hours lenient at the day boundary; the form's own schema is injected the
 * organization's local date by the page (`readTodayInOrg`) and is the strict
 * check.
 */

export interface OversightActionIdentity {
  ctx: OversightCtx;
  /** The resolved slug (validated by `resolveOrgContext`), safe to build a revalidate path from. */
  slug: string;
  env: ValidationEnv;
}

type Refused = Extract<OversightActionResult, { ok: false }>;

export type ActorResult = { ok: true; identity: OversightActionIdentity } | { ok: false; result: Refused };

export const serverEnv = (now: Date = new Date()): ValidationEnv => ({
  year: now.getUTCFullYear(),
  today: now.toISOString().slice(0, 10),
});

const refuse = (error: string, kind: Refused["kind"]): ActorResult => ({
  ok: false,
  result: { ok: false, error, kind },
});

/** Authenticate, resolve the organization from the slug, and check every id: or return the refusal. */
export async function resolveOversightActor(slug: unknown, ids: Record<string, unknown> = {}): Promise<ActorResult> {
  const session = await auth();
  const check = assertOrgSession(session);
  if (check.kind === "unauthenticated") return refuse(GATE_COPY.signedOut, "unauthenticated");
  if (check.kind === "two_factor_required") return refuse(GATE_COPY.signedOut, "two_factor_required");

  if (typeof slug !== "string") return refuse(GATE_COPY.noAccess, "forbidden");
  const resolved = await resolveOrgContext(check.userId, slug);
  if (resolved.kind !== "ok") return refuse(GATE_COPY.noAccess, "forbidden");

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

/** A form's `expectedVersion`: a positive integer, or null (which an edit reads as `stale`). */
export function parseVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

/** The refusal an edit with no usable `expectedVersion` gets. */
export const staleResult: OversightActionResult = { ok: false, error: REFUSAL.stale, kind: "stale" };

/** A failed parse as the action's result: the first message, and the field it belongs under. */
export function invalidResult(parsed: Extract<Parsed<unknown>, { ok: false }>): OversightActionResult {
  return { ok: false, error: parsed.message, field: parsed.field, kind: "invalid" };
}

/**
 * A store outcome as the `ActionResult` the client toasts, revalidating the list
 * and the record page when something was written. Every sentence is a `copy.ts`
 * string; a refusal never carries database text.
 */
export function finish(
  identity: OversightActionIdentity,
  aboutOrgId: string,
  outcome: Outcome<Written & Partial<Pick<ActionData, "created" | "reopened">>>,
  detail: { assessedYear?: number } = {},
): OversightActionResult {
  switch (outcome.kind) {
    case "ok": {
      if (!outcome.data.unchanged) {
        revalidatePath(`/o/${identity.slug}/admin/oversight`);
        revalidatePath(`/o/${identity.slug}/admin/oversight/${aboutOrgId}`);
      }
      return { ok: true, data: outcome.data };
    }
    case "refused":
      return { ok: false, error: refusalMessage(outcome.reason as Refusal, detail), kind: outcome.reason };
    case "invalid":
      return { ok: false, error: outcome.message, field: outcome.field, kind: "invalid" };
  }
}
