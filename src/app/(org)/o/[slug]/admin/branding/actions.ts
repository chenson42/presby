"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { resolveOrgContext } from "@/lib/authz";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { setBrand, type SetBrandInput } from "@/lib/tenant-branding";

/**
 * Server Actions for `/o/<slug>/admin/branding` — tenant-branding-permission
 * pipeline (`docs/work-log/2026-08-26-tenant-branding-permission.md`), Phase
 * 3 design, commit 2/3. All SQL correctness (the `branding.manage` gate, the
 * three-step transaction ordering, the E-c1/E-c2 logo discipline replicated
 * from the platform action) lives in and is proven by
 * `src/lib/tenant-branding.ts` / `tenant-branding.test.ts` — this file's only
 * job is the auth-in-the-action-body plumbing, the error→copy mapping, and
 * the audit write.
 *
 * `organizationId` NEVER comes from client-supplied form data. This action
 * takes the URL `slug` and re-resolves it through `resolveOrgContext()` —
 * inside THIS user's own membership set — via `resolveActingIdentity()`,
 * duplicated verbatim from `admin/roles/actions.ts`/`admin/officers/
 * actions.ts`'s own copy (same convention, not a shared import — no
 * route-group-crossing helper import exists anywhere in this tree, and this
 * pipeline isn't the one to start).
 *
 * USES `auth()` DIRECTLY, NOT `cachedAuth()` — `src/lib/auth/cached-auth.ts`'s
 * own header: "Server actions — each action is a separate invocation;
 * cache() is a no-op ... Call auth() directly." Same convention every other
 * `(org)/admin/*` actions.ts file in this tree follows.
 *
 * `organization_brand_history.changed_by` / `organization_brands.updated_by`
 * ARE `users.id` FKs (mirrors `role_grants.granted_by`/`officer_terms.
 * recorded_by`) — `src/lib/tenant-branding.ts`'s own membership/permission
 * checks run against `people.id`. This layer has both: `session.user.id` (a
 * `users.id`, from `auth()`) and `resolved.org.personId` (a `people.id`,
 * from `resolveOrgContext()`) — it passes both into `setBrand()` rather than
 * either function re-deriving one from the other. Same bug class
 * `src/lib/brand/read-org-brand.ts`'s header documents for the equivalent
 * `personId`-vs-`users.id` mixup (P0.5).
 *
 * `PolicyResult` IS A LOCAL TYPE, NOT IMPORTED FROM `(admin)/admin/
 * organizations/[id]/actions.ts` — no route-group-crossing action-type
 * import exists anywhere in this tree, and this pipeline isn't the one to
 * start. Same shape as the platform file's own `PolicyResult` so the
 * client form's `PARTIAL_SAVE_PREFIX` string-match logic (commit 3)
 * transplants unchanged.
 *
 * SIGNATURE DEVIATION, NAMED EXPLICITLY (DECISION-103): every other `(org)`
 * `actions.ts` in this tree takes `(slug, input)` with a plain object
 * (role-grants, officers, org-features) — none of them has a file upload.
 * This is the one tenant action that does, and a Server Action bound to a
 * `<form action={...}>` with a file input receives `FormData`, not a
 * hand-built object. So this combines BOTH existing conventions rather than
 * inventing a third: `slug` stays a trusted, server-bound first argument
 * (role-grants.ts's discipline — organizationId is never trusted from
 * client data), and the SECOND argument is `FormData` (the platform brand
 * action's own necessity, for the one field that needs it).
 *
 * NO `revalidateLiveSitePath()` EQUIVALENT — see Phase 3's Edge Cases /
 * DECISION-103. `(org)` route handlers run exclusively on the RLS-enforced
 * `db`/`presby_app` connection, and `organization_sites` carries no
 * `presby_app` grant at all (DECISION-081) — this action cannot read it, and
 * `getPlatformDb()` is forbidden in this subtree by the `(org)` contract. A
 * tenant-set brand change therefore cannot itself invalidate a live public
 * site's cached render the way the platform action does; that gap is named
 * and deferred, tracked in `docs/TODO.md`, not solved here.
 */

export type PolicyResult = { ok: true } | { ok: false; error: string };

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

/**
 * FormData fields: `seedHex` (#rrggbb), `typePairing` (one of
 * `TYPE_PAIRINGS`' keys), `lightOnly` (native checkbox semantics — present
 * with value `"on"` when checked, absent entirely when unchecked), `logo`
 * (optional File — PNG, JPEG, or WEBP, <=2MB). No `organizationId` field —
 * see the module header; the organization is always the server's own answer
 * to "what org is this signed-in user allowed to act at, given this slug."
 */
export async function setOrgBrandAction(
  slug: string,
  formData: FormData,
): Promise<PolicyResult> {
  const identity = await resolveActingIdentity(slug);
  if (!identity.ok) return { ok: false, error: identity.error };

  const seedHex = String(formData.get("seedHex") ?? "").toLowerCase();
  const typePairing = String(formData.get("typePairing") ?? "");
  // Native checkbox semantics: present with value "on" when checked, absent
  // entirely from FormData when unchecked — never a literal "false" to
  // parse. Same convention the platform action's own lightOnly read uses.
  const lightOnly = formData.get("lightOnly") === "on";

  let logo: SetBrandInput["logo"] = null;
  const logoFile = formData.get("logo");
  if (logoFile instanceof File && logoFile.size > 0) {
    logo = {
      bytes: Buffer.from(await logoFile.arrayBuffer()),
      declaredContentType: logoFile.type,
    };
  }

  const result = await setBrand(
    identity.personId,
    identity.organizationId,
    identity.userId,
    { seedHex, typePairing, lightOnly, logo },
  );

  switch (result.kind) {
    case "forbidden":
      return {
        ok: false,
        error: "You don't have permission to manage this organization's brand.",
      };
    case "invalid_hex":
      return {
        ok: false,
        error: "Enter a colour as a 6-digit hex code, like #7a1f2b.",
      };
    case "invalid_pairing":
      return { ok: false, error: "Choose one of the curated type pairings." };
    case "generation_failed":
      return {
        ok: false,
        error: "That colour could not be processed. Try a different hex code.",
      };
    case "logo_rejected":
      return { ok: false, error: result.message };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.TENANT_BRAND_SET,
    resourceType: "organization",
    resourceId: identity.organizationId,
    metadata: {
      seedHex,
      typePairing,
      lightOnly,
      adjustmentCount: result.adjustmentCount,
    },
  });

  revalidatePath(`/o/${slug}/admin/branding`);

  // E-c2 parity: a logo failure alongside a real colour/pairing change still
  // commits the colour/pairing — the returned error names the logo
  // specifically, never a blanket "save failed." This is the exact
  // `PARTIAL_SAVE_PREFIX` string the platform's own brand-form.tsx already
  // keys off (commit 3's client copy transplants unchanged).
  if (result.partialSaveLogoError) {
    return {
      ok: false,
      error: `Colour and type pairing saved. The logo could not be stored: ${result.partialSaveLogoError}`,
    };
  }

  return { ok: true };
}
