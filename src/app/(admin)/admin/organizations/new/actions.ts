"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { isReservedSlug } from "@/lib/reserved-slugs";
import {
  createOrganization,
  type CreateOrganizationInput,
} from "@/lib/org-provisioning";
import type { OrganizationType, PlatformStatus } from "@/lib/authz";

/**
 * The one write path for `organizations` — see this repo's own
 * `docs/work-log/2026-08-24-admin-org-create.md` Phase 3 "API Contract".
 * A new file, not appended to `[id]/actions.ts`: every action there takes an
 * EXISTING `organizationId`; creation is a different resource-lifecycle
 * stage. All SQL correctness (the group_types bootstrap check, path
 * derivation, the conditional F16 group seed, the slug-uniqueness race)
 * lives in `src/lib/org-provisioning.ts` — this file owns only FormData
 * parsing, field-shape validation, and the response mapping.
 *
 * NO redirect() inside this action (Phase 3's explicit ruling): every other
 * action on this surface returns `{ ok }` and revalidates in place, because
 * they mutate an org the caller is already looking at. This is the first
 * action that must navigate to a page that didn't exist before submission —
 * it returns `{ ok: true, organizationId }` and lets the client component
 * `router.push()` in a `useEffect`, both because `redirect()`'s
 * `NEXT_REDIRECT` throw is awkward to assert in a Vitest unit test and
 * because every sibling action on this surface already establishes "return a
 * result, let the client decide" as the house pattern.
 */

export type CreateOrgPolicyResult =
  | { ok: true; organizationId: string }
  | { ok: false; error: string };

const ORG_TYPES: readonly OrganizationType[] = [
  "general_assembly",
  "synod",
  "presbytery",
  "congregation",
  "new_worshiping_community",
];
function isOrganizationType(value: string): value is OrganizationType {
  return (ORG_TYPES as readonly string[]).includes(value);
}

const PLATFORM_STATUSES: readonly PlatformStatus[] = [
  "managed",
  "unmanaged",
  "invited",
];
function isPlatformStatus(value: string): value is PlatformStatus {
  return (PLATFORM_STATUSES as readonly string[]).includes(value);
}

const MAX_NAME_LEN = 200;

// Reused verbatim from src/lib/db/domain/org.ts's `organizations_slug_format`
// CHECK — the slug is permanent, so what the admin sees in the box is what
// gets stored, or they get told exactly why not (no auto-lowercasing, no
// auto-slugify).
const SLUG_FORMAT_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

const RESERVED_SLUG_ERROR =
  "That slug is reserved for platform use — choose another.";

/**
 * FormData fields: `name`, `slug`, `organizationType`, `platformStatus`.
 */
export async function createOrganizationAction(
  formData: FormData,
): Promise<CreateOrgPolicyResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Unauthorized." };
  if (!hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return { ok: false, error: "Forbidden." };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (name.length === 0) {
    return { ok: false, error: "Enter an organization name." };
  }
  if (name.length > MAX_NAME_LEN) {
    return {
      ok: false,
      error: `That name is too long — keep it under ${MAX_NAME_LEN} characters.`,
    };
  }

  const slug = String(formData.get("slug") ?? "").trim();
  if (!SLUG_FORMAT_RE.test(slug)) {
    return {
      ok: false,
      error:
        "Slugs are lowercase letters, numbers, and hyphens only, and must start and end with a letter or number (max 63 characters) — for example, fpcw or first-pres-anytown.",
    };
  }

  const organizationTypeRaw = String(formData.get("organizationType") ?? "");
  if (!isOrganizationType(organizationTypeRaw)) {
    return { ok: false, error: "Choose a valid organization type." };
  }

  const platformStatusRaw = String(formData.get("platformStatus") ?? "");
  if (!isPlatformStatus(platformStatusRaw)) {
    return { ok: false, error: "Choose a valid platform status." };
  }

  // Cheap, no DB round-trip needed to reject a reserved slug.
  if (isReservedSlug(slug)) {
    return { ok: false, error: RESERVED_SLUG_ERROR };
  }

  const input: CreateOrganizationInput = {
    name,
    slug,
    organizationType: organizationTypeRaw,
    platformStatus: platformStatusRaw,
  };

  let result;
  try {
    result = await createOrganization(input);
  } catch {
    return {
      ok: false,
      error: "We couldn't create that organization right now — try again in a moment.",
    };
  }

  switch (result.kind) {
    case "slug_taken":
      return { ok: false, error: "That slug is already taken — choose another." };
    case "reserved_slug":
      // Belt-and-suspenders against a race where the reserved list changes
      // between the check above and this call — low value but free, since
      // the field already returned early for the common case.
      return { ok: false, error: RESERVED_SLUG_ERROR };
    case "provisioning_incomplete":
      return {
        ok: false,
        error:
          "We can't create organizations right now — platform setup is incomplete. Contact an engineer.",
      };
    case "invalid_input":
      // Defense-in-depth only; the validation above should catch everything
      // this branch could return.
      return { ok: false, error: result.error };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.ORG_CREATED,
    resourceType: "organization",
    resourceId: result.organizationId,
    metadata: {
      name,
      slug,
      organizationType: organizationTypeRaw,
      platformStatus: platformStatusRaw,
    },
  });

  revalidatePath("/admin/organizations");

  return { ok: true, organizationId: result.organizationId };
}
