"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import {
  changeCanonical,
  checkClaim,
  claimDomain,
  reconnectClaim,
  removeClaim,
  type DomainActor,
  type CheckOutcome,
  type ProofRecord,
} from "@/lib/domains/service";
import { claimRefusalMessage } from "@/lib/domains/messages";

/**
 * Server Actions for `/o/<slug>/admin/domains` (Batch 1a-ii; the page is 1d).
 * docs/work-log/2026-10-19-custom-domains.md Phase 3 API Contract section 6.
 *
 * AUDIT IS DELEGATED (R8). Every state change these actions cause is written
 * by `transitionDomain()` in `src/lib/domains/service.ts` in the SAME
 * transaction as the change - one `audit_events` row per transition, plus
 * `domain.claimed` and `domain.canonical_changed` for the two non-edge writes.
 * `npm run check:audit` scans only this file's text for direct mutation calls,
 * and there are none here, so it cannot see that coverage; the proof is
 * `src/lib/domains/service.db.test.ts` (one test per edge asserting exactly one
 * audit row), which QA verifies instead of the tripwire.
 *
 * GATES. Each action: `auth()` (never the cached variant - an action is its own
 * invocation) -> `resolveOrgContext()` for the URL slug INSIDE this user's own
 * membership set -> the service, which inside `withOrgContext` checks the
 * `domains.manage` permission and then the operator-enabled `org_portal.domains`
 * toggle. `organizationId` is NEVER read from client input: it is the server's
 * own answer to "what org may this signed-in user act at, given this slug".
 *
 * RESULTS. `{ ok: true, data }` or `{ ok: false, error, code }`. `error` is
 * end-user copy and structurally an `ActionResult`; `code` lets the form pick
 * a field or a retry (it carries no provider text and names no organization).
 */

export type DomainActionCode =
  | "unauthenticated"
  | "no_access"
  | "invalid"
  | "exists"
  | "cap_reached"
  | "conflict"
  | "rate_limited"
  | "forbidden"
  | "feature_off"
  | "not_found"
  | "not_live"
  | "needs_canonical"
  | "invalid_target"
  | "proof_missing"
  | "dns_unknown"
  | "not_parked"
  | "stale";

export type DomainActionResult<T = void> =
  | { ok: true; data?: T }
  | {
      ok: false;
      error: string;
      code: DomainActionCode;
      /** Set for `invalid`: which field the message belongs to. */
      field?: "domain";
      retryAfterSeconds?: number;
    };

const fail = (
  code: DomainActionCode,
  error: string,
  extra: { field?: "domain"; retryAfterSeconds?: number } = {},
): DomainActionResult<never> => ({ ok: false, code, error, ...extra });

const COPY = {
  unauthenticated: "You must be signed in to do that.",
  no_access: "You don't have access to that organization.",
  forbidden: "You don't have permission to manage this organization's domains.",
  feature_off: "Website domains aren't turned on for your organization.",
  not_found: "We couldn't find that domain.",
  stale: "That changed while you were working. Refresh and try again.",
  conflict: "Something changed while we were saving. Try again.",
} as const;

function waitCopy(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `You've done that a lot just now. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

async function resolveActor(
  slug: string,
): Promise<
  | { ok: true; actor: Extract<DomainActor, { kind: "tenant" }>; organizationId: string }
  | { ok: false; result: DomainActionResult<never> }
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, result: fail("unauthenticated", COPY.unauthenticated) };
  }
  const resolved = await resolveOrgContext(session.user.id, slug);
  if (resolved.kind !== "ok") {
    return { ok: false, result: fail("no_access", COPY.no_access) };
  }
  return {
    ok: true,
    organizationId: resolved.org.organizationId,
    actor: {
      kind: "tenant",
      userId: session.user.id,
      email: session.user.email ?? null,
      personId: resolved.org.personId,
    },
  };
}

const claimInputSchema = z.object({
  domain: z.string().max(2048),
  canonical: z.enum(["www", "apex"]),
});
const claimNameSchema = z.string().min(1).max(253);
const uuidSchema = z.string().uuid();

const page = (slug: string) => `/o/${slug}/admin/domains`;

export interface ClaimData {
  claimName: string;
  displayName: string;
  hostnames: string[];
  proof: ProofRecord;
}

/** Starts a claim. Nothing is attached anywhere; the result carries the TXT record to publish. */
export async function claimDomainAction(
  slug: string,
  input: { domain: string; canonical: "www" | "apex" },
): Promise<DomainActionResult<ClaimData>> {
  const who = await resolveActor(slug);
  if (!who.ok) return who.result;

  const parsed = claimInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail("invalid", claimRefusalMessage("invalid_format"), { field: "domain" });
  }

  const result = await claimDomain(who.actor, who.organizationId, parsed.data);
  switch (result.kind) {
    case "invalid":
      return fail("invalid", claimRefusalMessage(result.reason), { field: "domain" });
    case "exists":
      return fail(
        "exists",
        result.parked
          ? "You already have this domain, and it was removed. Reconnect it instead of adding it again."
          : "Your organization already has this domain.",
        { field: "domain" },
      );
    case "cap_reached":
      return fail(
        "cap_reached",
        "You've reached the limit of domains for your organization. Remove one you aren't using, or contact support.",
      );
    case "conflict":
      return fail("conflict", COPY.conflict);
    case "rate_limited":
      return fail("rate_limited", waitCopy(result.retryAfterSeconds), {
        retryAfterSeconds: result.retryAfterSeconds,
      });
    case "forbidden":
      return fail("forbidden", COPY.forbidden);
    case "feature_off":
      return fail("feature_off", COPY.feature_off);
    case "not_found":
      return fail("no_access", COPY.no_access);
    case "ok":
      revalidatePath(page(slug));
      return {
        ok: true,
        data: {
          claimName: result.claimName,
          displayName: result.displayName,
          hostnames: result.created.map((c) => c.hostname),
          proof: result.proof,
        },
      };
  }
}

export interface CheckData {
  outcome: CheckOutcome;
  checkedAt: string;
}

/** "Check now": looks the proof up for one claim group (rate-limited). */
export async function checkDomainAction(
  slug: string,
  claimName: string,
): Promise<DomainActionResult<CheckData>> {
  const who = await resolveActor(slug);
  if (!who.ok) return who.result;
  const name = claimNameSchema.safeParse(claimName);
  if (!name.success) return fail("not_found", COPY.not_found);

  const result = await checkClaim(who.actor, who.organizationId, name.data, { forced: true });
  switch (result.kind) {
    case "rate_limited":
      return fail("rate_limited", waitCopy(result.retryAfterSeconds), {
        retryAfterSeconds: result.retryAfterSeconds,
      });
    case "forbidden":
      return fail("forbidden", COPY.forbidden);
    case "feature_off":
      return fail("feature_off", COPY.feature_off);
    case "not_found":
      return fail("not_found", COPY.not_found);
    case "ok":
      revalidatePath(page(slug));
      return { ok: true, data: { outcome: result.outcome, checkedAt: result.checkedAt } };
  }
}

/** Makes a live host the canonical one. Only a live host qualifies. */
export async function changeCanonicalAction(
  slug: string,
  domainId: string,
): Promise<DomainActionResult> {
  const who = await resolveActor(slug);
  if (!who.ok) return who.result;
  const id = uuidSchema.safeParse(domainId);
  if (!id.success) return fail("not_found", COPY.not_found);

  const result = await changeCanonical(who.actor, who.organizationId, id.data);
  switch (result.kind) {
    case "not_live":
      return fail("not_live", "That address isn't live yet. Make it your main address once it is.");
    case "not_found":
      return fail("not_found", COPY.not_found);
    case "forbidden":
      return fail("forbidden", COPY.forbidden);
    case "feature_off":
      return fail("feature_off", COPY.feature_off);
    case "ok":
      revalidatePath(page(slug));
      return { ok: true };
  }
}

/** Removes a claim group. Removing the main address while others are live needs a replacement. */
export async function removeClaimAction(
  slug: string,
  claimName: string,
  promoteDomainId?: string,
): Promise<DomainActionResult> {
  const who = await resolveActor(slug);
  if (!who.ok) return who.result;
  const name = claimNameSchema.safeParse(claimName);
  if (!name.success) return fail("not_found", COPY.not_found);
  let promote: string | undefined;
  if (promoteDomainId !== undefined) {
    const id = uuidSchema.safeParse(promoteDomainId);
    if (!id.success) return fail("invalid_target", "Choose one of your live addresses as the new main address.");
    promote = id.data;
  }

  const result = await removeClaim(who.actor, who.organizationId, name.data, promote);
  switch (result.kind) {
    case "needs_canonical":
      return fail(
        "needs_canonical",
        "This is your main address, and other addresses are live. Choose which one becomes the main address first.",
      );
    case "invalid_target":
      return fail("invalid_target", "Choose one of your live addresses as the new main address.");
    case "not_found":
      return fail("not_found", COPY.not_found);
    case "forbidden":
      return fail("forbidden", COPY.forbidden);
    case "feature_off":
      return fail("feature_off", COPY.feature_off);
    case "ok":
      revalidatePath(page(slug));
      return { ok: true };
  }
}

/** Brings a removed (parked) claim back, once its ownership record is confirmed. */
export async function reconnectClaimAction(
  slug: string,
  claimName: string,
): Promise<DomainActionResult> {
  const who = await resolveActor(slug);
  if (!who.ok) return who.result;
  const name = claimNameSchema.safeParse(claimName);
  if (!name.success) return fail("not_found", COPY.not_found);

  const result = await reconnectClaim(who.actor, who.organizationId, name.data);
  switch (result.kind) {
    case "proof_missing":
      return fail(
        "proof_missing",
        "We can't find your ownership record yet. Add it back at your DNS provider, then try again.",
      );
    case "dns_unknown":
      return fail("dns_unknown", "We couldn't check right now. Try again in a few minutes.");
    case "not_parked":
      return fail("not_parked", "That domain isn't waiting to be reconnected.");
    case "stale":
      return fail("stale", COPY.stale);
    case "rate_limited":
      return fail("rate_limited", waitCopy(result.retryAfterSeconds), {
        retryAfterSeconds: result.retryAfterSeconds,
      });
    case "not_found":
      return fail("not_found", COPY.not_found);
    case "forbidden":
      return fail("forbidden", COPY.forbidden);
    case "feature_off":
      return fail("feature_off", COPY.feature_off);
    case "ok":
      revalidatePath(page(slug));
      return { ok: true };
  }
}
