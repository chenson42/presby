"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { claimDomain, type ProofRecord } from "@/lib/domains/service";
import { claimRefusalMessage } from "@/lib/domains/messages";
import { OPERATOR_TOGGLE_KEYS, setOperatorOrgToggle } from "@/lib/domains/toggles";

/**
 * Platform-admin domain actions at `/admin/organizations/<id>` (Batch 1a-ii:
 * the Q2 on-behalf web claim and the two operator-enabled org toggles; the
 * check / pause / force-release actions and the page are Batches 1b and 1d).
 * docs/work-log/2026-10-19-custom-domains.md Phase 3 API Contract section 6,
 * operator rulings Q1 and Q2, R9.
 *
 * AUDIT IS DELEGATED (R8): the claim is written, with its `domain.claimed`
 * audit rows, by `claimDomain()` in `src/lib/domains/service.ts` in one
 * transaction, as the PLATFORM actor (`metadata.actorKind = "platform"`,
 * `via = "platform"`); the toggle is audited in the same transaction by
 * `setOperatorOrgToggle()` with the existing `tenant.org_feature.toggled` key
 * and `via = "platform"`. Neither is visible to `npm run check:audit`; the DB
 * tests prove both.
 *
 * GATE. `auth()` -> `hasFeature(session.user.features, ADMIN_ORGANIZATIONS)`
 * (R9: reuse, no new platform key). The platform admin never holds
 * `domains.manage` and gains no ecclesiastical authority: the on-behalf claim
 * is WEB ONLY (there is no mail claim in this batch, and church mail stays
 * tenant-only regardless), DNS proof is still required before anything is
 * attached, and the org's `org_portal.domains` toggle must already be on. The
 * actions run on the platform connection and never `withOrgContext`: an
 * operator has no membership, and fabricating one is the phantom membership
 * "Two Hierarchies Intersect Nowhere" forbids.
 */

export type PlatformDomainActionResult<T = void> =
  | { ok: true; data?: T }
  | {
      ok: false;
      error: string;
      code: "unauthorized" | "forbidden" | "invalid" | "exists" | "cap_reached" | "conflict" | "rate_limited" | "feature_off" | "not_found" | "invalid_key";
      field?: "domain";
      retryAfterSeconds?: number;
    };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const claimInputSchema = z.object({
  domain: z.string().max(2048),
  canonical: z.enum(["www", "apex"]),
});

type Fail = Extract<PlatformDomainActionResult, { ok: false }>;
const fail = (code: Fail["code"], error: string, extra: Partial<Fail> = {}): Fail => ({
  ok: false,
  code,
  error,
  ...extra,
});

async function platformSession(): Promise<
  { ok: true; userId: string; email: string | null } | { ok: false; result: Fail }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, result: fail("unauthorized", "Unauthorized.") };
  if (!hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return { ok: false, result: fail("forbidden", "Forbidden.") };
  }
  return { ok: true, userId: session.user.id, email: session.user.email ?? null };
}

export interface PlatformClaimData {
  claimName: string;
  displayName: string;
  hostnames: string[];
  proof: ProofRecord;
}

/**
 * Records a WEB claim on an organization's behalf (Q2). The organization must
 * already have `org_portal.domains` on. The proof record it returns is for the
 * church's DNS operator; nothing is attached until that record is published
 * and verified, exactly as for a claim the church makes itself.
 */
export async function claimDomainForOrgAction(
  organizationId: string,
  input: { domain: string; canonical: "www" | "apex" },
): Promise<PlatformDomainActionResult<PlatformClaimData>> {
  const who = await platformSession();
  if (!who.ok) return who.result;
  if (!UUID_RE.test(organizationId)) return fail("not_found", "Invalid organization.");
  const parsed = claimInputSchema.safeParse(input);
  if (!parsed.success) {
    return fail("invalid", claimRefusalMessage("invalid_format"), { field: "domain" });
  }

  const result = await claimDomain(
    { kind: "platform", userId: who.userId, email: who.email },
    organizationId,
    parsed.data,
  );
  switch (result.kind) {
    case "invalid":
      return fail("invalid", claimRefusalMessage(result.reason), { field: "domain" });
    case "exists":
      return fail("exists", "This organization already has that domain.", { field: "domain" });
    case "cap_reached":
      return fail("cap_reached", "This organization has reached its limit of domains.");
    case "conflict":
      return fail("conflict", "Something changed while saving. Try again.");
    case "rate_limited":
      return fail("rate_limited", "Too many claims for this organization just now. Try again later.", {
        retryAfterSeconds: result.retryAfterSeconds,
      });
    case "feature_off":
      return fail("feature_off", "Turn on Website domain for this organization first.");
    case "forbidden":
      return fail("forbidden", "Forbidden.");
    case "not_found":
      return fail("not_found", "That organization doesn't exist.");
    case "ok":
      revalidatePath(`/admin/organizations/${organizationId}`);
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

/**
 * Turns one of the two operator-enabled org toggles on or off (Q1). The tenant
 * features page cannot do this: the catalog marks these `operatorEnabled`.
 */
export async function setOrgDomainFeatureAction(
  organizationId: string,
  key: string,
  enabled: boolean,
): Promise<PlatformDomainActionResult<{ changed: boolean }>> {
  const who = await platformSession();
  if (!who.ok) return who.result;
  if (!UUID_RE.test(organizationId)) return fail("not_found", "Invalid organization.");
  if (typeof enabled !== "boolean" || !OPERATOR_TOGGLE_KEYS.includes(key)) {
    return fail("invalid_key", "That feature can't be changed here.");
  }

  const result = await setOperatorOrgToggle(
    { userId: who.userId, email: who.email },
    organizationId,
    key,
    enabled,
  );
  switch (result.kind) {
    case "invalid_key":
      return fail("invalid_key", "That feature can't be changed here.");
    case "not_found":
      return fail("not_found", "That organization doesn't exist.");
    case "ok":
      revalidatePath(`/admin/organizations/${organizationId}`);
      return { ok: true, data: { changed: result.changed } };
  }
}
