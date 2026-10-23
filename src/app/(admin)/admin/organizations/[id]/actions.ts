"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { getPlatformDb } from "@/lib/db";
import {
  organizationBrands,
  organizationBrandHistory,
  organizations,
} from "@/lib/db/domain/org";
import { organizationSites } from "@/lib/db/domain/sites";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { generateBrandTokens, type GeneratedBrand } from "@/lib/brand/generate";
import { TYPE_PAIRINGS, type TypePairingKey } from "@/lib/brand/contract";
import {
  getBlobStore,
  BlobValidationError,
  type BlobRef,
} from "@/lib/storage/blob-store";
import {
  provisionSite,
  setSiteStatus,
  setOrganizationProfile,
  replaceOrganizationServiceTimes,
} from "@/lib/sites";
import {
  createInvitation,
  resendInvitation,
  revokeInvitation,
  revokeAllOpenInvitations,
  type CreateInvitationResult,
  type ResendInvitationResult,
} from "@/lib/onboarding/issue";
import { INVITATION_RATE_LIMIT_COPY } from "@/lib/onboarding/labels";
import { revokeDesignationHolder } from "@/lib/onboarding/designation-holders";
import {
  OUTCOME_COPY,
  parseReason,
  revokeHolderFieldsSchema,
} from "@/lib/onboarding/designation-holder-copy";
import type { RevokeHolderActionResult } from "@/lib/onboarding/designation-holder-types";
import { slugSitePath } from "@/lib/site-urls";

/**
 * The platform operator's brand actions — P0.5 slice c2 (Phase 3 re-run,
 * commit `c2`). Sets or neutralises a congregation's brand at
 * `/admin/organizations/<id>`. No page/component lands in this commit
 * (that's `c3`) — these are the server actions and nothing else.
 *
 * WHY getPlatformDb() AND NEVER withOrgContext(): the caller is a platform
 * operator, not a congregation member. `withOrgContext(personId, orgId, fn)`
 * verifies an ACTIVE MEMBERSHIP before trusting the org id — there is no
 * `personId` to hand it here that would not be fabricated, and fabricating
 * one is exactly the "phantom membership" violation of "Two Hierarchies
 * Intersect Nowhere" that this pipeline's design ruled out by name (see
 * src/lib/storage/blob-store.ts's own header comment, and
 * docs/work-log/2026-08-19-brand-foundation.md's Phase 3 (re-run), "Data
 * model": "The (admin) write path is getPlatformDb() throughout, never
 * withOrgContext() — no tenant membership exists for a platform operator").
 * Authorization here is `FEATURES.ADMIN_ORGANIZATIONS` — a platform-shell
 * permission, not a tenant one. A future tenant-facing editor (slice d,
 * still blocked on P1's tenant permission catalog) calls
 * getBlobStore()/organizationBrands the same way, after ITS OWN action has
 * run the request through withOrgContext() for whatever else it needs.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A7: never trust the client's colour string. The editor should already
// enforce this shape, but the server re-validates independently — the
// generator also refuses anything else, and the DB CHECK
// (organization_brands_seed_hex_format) is the third and final backstop.
const SEED_HEX_RE = /^#[0-9a-f]{6}$/i;

const TYPE_PAIRING_KEYS = new Set<string>(TYPE_PAIRINGS.map((p) => p.key));
function isTypePairingKey(value: string): value is TypePairingKey {
  return TYPE_PAIRING_KEYS.has(value);
}

// Mirrors blob-store.ts's private MAX_BYTE_SIZE and the
// blob_assets_byte_size_bounds CHECK — kept local rather than exported from
// blob-store.ts, which owns no public constant surface beyond store/resolve.
const MAX_LOGO_BYTES = 2_097_152;

/**
 * Sniff magic bytes rather than trust the browser's reported MIME type
 * (E-c1: "sniff magic bytes not the browser MIME string"). Mirrors
 * blob-store.ts's ALLOWED_CONTENT_TYPES / the blob_assets CHECK: PNG, JPEG,
 * WEBP only. SVG is rejected by construction — it has no magic-byte
 * signature this function recognizes, so it falls through to `null` (G7:
 * <script> and <foreignObject> make sanitising it its own project).
 */
function sniffImageContentType(
  bytes: Buffer,
): "image/png" | "image/jpeg" | "image/webp" | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "");
}

/**
 * ADDITION beyond DECISION-081/083's own file list, named explicitly per
 * Phase 3's own instruction: "after either [brand] transaction commits, if
 * this org has organization_sites.status = 'live', also
 * revalidatePath(...)" — otherwise a live public site's colours go stale
 * until the next content ingest, since brand changes and site ingest are two
 * independent write paths that would otherwise never tell each other's cache
 * to invalidate. `organization_sites` has no `presby_app` grant at all
 * (DECISION-081), so this MUST run on the platform connection already in
 * scope in this file — never `withOrgContext()`.
 */
async function revalidateLiveSitePath(
  platformDb: ReturnType<typeof getPlatformDb>,
  organizationId: string,
): Promise<void> {
  const [row] = await platformDb
    .select({ slug: organizations.slug, siteStatus: organizationSites.status })
    .from(organizations)
    .leftJoin(organizationSites, eq(organizationSites.organizationId, organizations.id))
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (row?.siteStatus === "live") {
    revalidatePath(slugSitePath(row.slug), "layout");
  }
}

export type PolicyResult = { ok: true } | { ok: false; error: string };

type ExistingBrand = {
  seedHex: string;
  typePairing: string;
  markAssetKey: string | null;
  wordmarkAssetKey: string | null;
  brandTokenVersion: number;
  lightOnly: boolean;
};

async function fetchExistingBrand(
  platformDb: ReturnType<typeof getPlatformDb>,
  organizationId: string,
): Promise<ExistingBrand | null> {
  const rows = await platformDb
    .select({
      seedHex: organizationBrands.seedHex,
      typePairing: organizationBrands.typePairing,
      markAssetKey: organizationBrands.markAssetKey,
      wordmarkAssetKey: organizationBrands.wordmarkAssetKey,
      brandTokenVersion: organizationBrands.brandTokenVersion,
      lightOnly: organizationBrands.lightOnly,
    })
    .from(organizationBrands)
    .where(eq(organizationBrands.organizationId, organizationId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Set (create or update) a congregation's brand: seed colour, type pairing,
 * and optionally a logo mark. Exact step list per the Phase 3 (re-run)
 * design (`docs/work-log/2026-08-19-brand-foundation.md`):
 *
 *   1. auth + FEATURES.ADMIN_ORGANIZATIONS
 *   2. validate seedHex (#rrggbb)
 *   3. validate typePairing against TYPE_PAIRINGS
 *   4. generateBrandTokens(seedHex) — reject only if it throws
 *   5. if a file is present: validate content-type/size, then
 *      blobStore.store() BEFORE opening the DB transaction
 *   6. one getPlatformDb() transaction: history row (if a prior brand
 *      existed) capturing what's about to be superseded, then upsert
 *      organization_brands
 *   7. recordAudit(ORG_BRAND_SET, ...)
 *   8. revalidatePath
 *
 * E-c2 (partial-save honesty): a logo failure that is the ONLY change in
 * this submission touches nothing in the database — the caller gets the
 * specific logo error and nothing else changes. A logo failure alongside a
 * genuine colour/pairing change still commits the colour/pairing; the
 * returned error names the logo specifically, never a blanket "save
 * failed."
 *
 * FormData fields: `organizationId` (uuid), `seedHex` (#rrggbb),
 * `typePairing` (one of TYPE_PAIRINGS' keys), `logo` (optional File — PNG,
 * JPEG or WEBP, <=2MB, becomes the square `mark`). Wordmark upload is not
 * wired in this minimal (S18) operator surface; the schema column
 * (`wordmarkAssetKey`) is reserved for slice d.
 */
export async function setOrganizationBrandAction(
  formData: FormData,
): Promise<PolicyResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Unauthorized." };
  if (!hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return { ok: false, error: "Forbidden." };
  }

  const organizationId = String(formData.get("organizationId") ?? "");
  if (!UUID_RE.test(organizationId)) {
    return { ok: false, error: "Invalid organization." };
  }

  const seedHex = String(formData.get("seedHex") ?? "").toLowerCase();
  if (!SEED_HEX_RE.test(seedHex)) {
    return {
      ok: false,
      error: "Enter a colour as a 6-digit hex code, like #7a1f2b.",
    };
  }

  const typePairing = String(formData.get("typePairing") ?? "");
  if (!isTypePairingKey(typePairing)) {
    return { ok: false, error: "Choose one of the curated type pairings." };
  }

  // Native checkbox semantics: present with value "on" when checked, absent
  // entirely from FormData when unchecked — never a literal "false" to parse.
  const lightOnly = formData.get("lightOnly") === "on";

  // Only reject if the generator itself throws — it shouldn't for a
  // validated 6-digit hex. The property test (commit b1) is what guarantees
  // every legal pair clears the accessibility floor; re-checking contrast
  // here would duplicate that guarantee rather than trust it.
  let generated: GeneratedBrand;
  try {
    generated = generateBrandTokens(seedHex);
  } catch {
    return {
      ok: false,
      error: "That colour could not be processed. Try a different hex code.",
    };
  }

  const platformDb = getPlatformDb();
  const existing = await fetchExistingBrand(platformDb, organizationId);

  // E-c1/E-c2: validate BEFORE ever calling store() — a bad type or an
  // oversized file is a client input error, not a storage failure, and must
  // never leave a dangling asset reference. Sniff magic bytes; never trust
  // the browser's reported MIME type.
  let fileError: string | null = null;
  let newMarkAssetKey: string | undefined;

  const logoFile = formData.get("logo");
  if (logoFile instanceof File && logoFile.size > 0) {
    const logoBytes = Buffer.from(await logoFile.arrayBuffer());

    if (logoBytes.byteLength > MAX_LOGO_BYTES) {
      fileError = `That file is ${formatMB(logoBytes.byteLength)} MB — we can take up to 2 MB.`;
    } else {
      const sniffed = sniffImageContentType(logoBytes);
      if (!sniffed) {
        fileError =
          "That doesn't look like an image we can use — upload a PNG, JPEG, or WEBP file.";
      } else {
        // E-c2's ordering: store() happens BEFORE the DB transaction opens,
        // so a row never points at bytes that were never stored.
        try {
          const ref: BlobRef = await getBlobStore().store({
            organizationId,
            bytes: logoBytes,
            contentType: sniffed,
          });
          newMarkAssetKey = ref.key;
        } catch (err) {
          fileError =
            err instanceof BlobValidationError
              ? err.message
              : "We couldn't store that logo right now — try again in a moment.";
        }
      }
    }
  }

  const hexOrPairingChanged =
    !existing ||
    existing.seedHex !== seedHex ||
    existing.typePairing !== typePairing ||
    existing.lightOnly !== lightOnly;

  // E-c2: a logo failure that is the ONLY thing this submission changed
  // touches nothing — no dangling half-applied row for a no-op resubmit.
  if (fileError && !hexOrPairingChanged) {
    return { ok: false, error: fileError };
  }

  await platformDb.transaction(async (tx) => {
    if (existing) {
      await tx.insert(organizationBrandHistory).values({
        organizationId,
        action: "updated",
        seedHex: existing.seedHex,
        typePairing: existing.typePairing,
        markAssetKey: existing.markAssetKey,
        wordmarkAssetKey: existing.wordmarkAssetKey,
        brandTokenVersion: existing.brandTokenVersion,
        changedBy: session.user.id,
      });
    }

    const insertValues: typeof organizationBrands.$inferInsert = {
      organizationId,
      seedHex,
      typePairing,
      lightOnly,
      brandTokenVersion: generated.tokens.version,
      updatedBy: session.user.id,
      ...(newMarkAssetKey ? { markAssetKey: newMarkAssetKey } : {}),
    };

    // A logo failure alongside a real colour/pairing change omits
    // markAssetKey from BOTH the insert values and the update `set` below —
    // onConflictDoUpdate only sets the columns listed, so an existing logo
    // is left untouched rather than clobbered by a failed upload.
    await tx
      .insert(organizationBrands)
      .values(insertValues)
      .onConflictDoUpdate({
        target: organizationBrands.organizationId,
        set: {
          seedHex,
          typePairing,
          lightOnly,
          brandTokenVersion: generated.tokens.version,
          updatedBy: session.user.id,
          updatedAt: new Date(),
          ...(newMarkAssetKey ? { markAssetKey: newMarkAssetKey } : {}),
        },
      });
  });

  await recordAudit({
    action: AUDIT_ACTIONS.ORG_BRAND_SET,
    resourceType: "organization",
    resourceId: organizationId,
    metadata: {
      seedHex,
      typePairing,
      lightOnly,
      adjustmentCount: generated.adjustments.length,
    },
  });

  revalidatePath(`/admin/organizations/${organizationId}`);
  await revalidateLiveSitePath(platformDb, organizationId);

  if (fileError) {
    return {
      ok: false,
      error: `Colour and type pairing saved. The logo could not be stored: ${fileError}`,
    };
  }

  return { ok: true };
}

/**
 * Neutralise an abusive tenant's brand: delete the `organization_brands`
 * row (reverting the org to the platform default), after recording a
 * history row capturing what is about to be deleted (DECISION-059: a
 * 'neutralized' row may have nothing to snapshot if the org never had a
 * prior brand — the columns are nullable for exactly that case).
 *
 * FormData fields: `organizationId` (uuid).
 */
export async function neutralizeOrganizationBrandAction(
  formData: FormData,
): Promise<PolicyResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Unauthorized." };
  if (!hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return { ok: false, error: "Forbidden." };
  }

  const organizationId = String(formData.get("organizationId") ?? "");
  if (!UUID_RE.test(organizationId)) {
    return { ok: false, error: "Invalid organization." };
  }

  const platformDb = getPlatformDb();
  const existing = await fetchExistingBrand(platformDb, organizationId);

  await platformDb.transaction(async (tx) => {
    await tx.insert(organizationBrandHistory).values({
      organizationId,
      action: "neutralized",
      seedHex: existing?.seedHex ?? null,
      typePairing: existing?.typePairing ?? null,
      markAssetKey: existing?.markAssetKey ?? null,
      wordmarkAssetKey: existing?.wordmarkAssetKey ?? null,
      brandTokenVersion: existing?.brandTokenVersion ?? null,
      changedBy: session.user.id,
    });

    await tx
      .delete(organizationBrands)
      .where(eq(organizationBrands.organizationId, organizationId));
  });

  await recordAudit({
    action: AUDIT_ACTIONS.ORG_BRAND_NEUTRALIZED,
    resourceType: "organization",
    resourceId: organizationId,
    metadata: { hadBrand: existing !== null },
  });

  revalidatePath(`/admin/organizations/${organizationId}`);
  await revalidateLiveSitePath(platformDb, organizationId);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Public site provisioning (docs/work-log/2026-08-20-public-sites.md Phase 3
// "Server actions — call sites") — thin wrappers over src/lib/sites.ts's
// provisionSite/setSiteStatus; all SQL correctness lives there and is proven
// by sites.test.ts.
// ---------------------------------------------------------------------------

/**
 * FormData fields: `organizationId` (uuid), `repo` ("owner/repo").
 */
export async function provisionSiteAction(
  formData: FormData,
): Promise<PolicyResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Unauthorized." };
  if (!hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return { ok: false, error: "Forbidden." };
  }

  const organizationId = String(formData.get("organizationId") ?? "");
  if (!UUID_RE.test(organizationId)) {
    return { ok: false, error: "Invalid organization." };
  }
  const repo = String(formData.get("repo") ?? "");

  const result = await provisionSite(organizationId, repo, session.user.id);
  switch (result.kind) {
    case "invalid_input":
      return { ok: false, error: result.error };
    case "already_provisioned":
      return {
        ok: false,
        error: "This organization already has a site provisioned.",
      };
    case "ok":
      break;
  }

  await recordAudit({
    action: AUDIT_ACTIONS.SITE_PROVISIONED,
    resourceType: "organization",
    resourceId: organizationId,
    metadata: { repo: repo.trim() },
  });

  revalidatePath(`/admin/organizations/${organizationId}`);
  revalidatePath("/admin/sites");

  return { ok: true };
}

/**
 * Admin-manual status flips only (suspend / reactivate) — ingest sets
 * `'live'` itself on a successful commit and never calls this. FormData
 * fields: `organizationId` (uuid), `status` (`"live"` | `"suspended"`).
 */
export async function setSiteStatusAction(
  formData: FormData,
): Promise<PolicyResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Unauthorized." };
  if (!hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return { ok: false, error: "Forbidden." };
  }

  const organizationId = String(formData.get("organizationId") ?? "");
  if (!UUID_RE.test(organizationId)) {
    return { ok: false, error: "Invalid organization." };
  }
  const status = String(formData.get("status") ?? "");
  if (status !== "live" && status !== "suspended") {
    return { ok: false, error: "Invalid status." };
  }

  const result = await setSiteStatus(organizationId, status, session.user.id);
  if (result.kind === "not_found") {
    return {
      ok: false,
      error: "This organization has no site provisioned.",
    };
  }

  await recordAudit({
    action: AUDIT_ACTIONS.SITE_STATUS_CHANGED,
    resourceType: "organization",
    resourceId: organizationId,
    metadata: { status },
  });

  revalidatePath(`/admin/organizations/${organizationId}`);
  revalidatePath("/admin/sites");
  // A suspend must take the public page down promptly, not wait for the next
  // content ingest — unlike the brand-change addition above, this write IS
  // the site's own status, so the revalidate is unconditional on the new
  // status rather than gated on "is it currently live" (there is no live
  // status left to gate on once suspended, and reactivating needs the same
  // treatment for the opposite reason).
  const platformDb = getPlatformDb();
  const [orgRow] = await platformDb
    .select({ slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (orgRow) {
    revalidatePath(slugSitePath(orgRow.slug), "layout");
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Public-site profile + service times (docs/work-log/2026-08-21-public-site-
// org-profile.md Phase 3 "API Contract") — thin wrappers over
// src/lib/sites.ts's setOrganizationProfile/replaceOrganizationServiceTimes,
// matching provisionSiteAction/setSiteStatusAction's wrapping pattern (not
// setOrganizationBrandAction's own inline-query pattern) per Phase 3's
// explicit placement ruling: this data is "sites" domain, not "org brand"
// domain. No recordAudit call in either action — deliberate, not an
// oversight (Phase 1 Gap 8 / Phase 3 Edge Cases: routine content editing,
// not an access-control mutation, matching markSiteContactMessageReadAction's
// identical posture, DECISION-089).
// ---------------------------------------------------------------------------

/**
 * FormData fields: `organizationId` (uuid), `address`, `phone`,
 * `facebookUrl`, `instagramUrl`, `xTwitterUrl`, `youtubeUrl`, `otherUrl`
 * (all optional strings — empty maps to `null` inside setOrganizationProfile,
 * not here).
 */
export async function setOrganizationProfileAction(
  formData: FormData,
): Promise<PolicyResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Unauthorized." };
  if (!hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return { ok: false, error: "Forbidden." };
  }

  const organizationId = String(formData.get("organizationId") ?? "");
  if (!UUID_RE.test(organizationId)) {
    return { ok: false, error: "Invalid organization." };
  }

  const field = (name: string) => String(formData.get(name) ?? "");

  const result = await setOrganizationProfile(
    organizationId,
    {
      address: field("address"),
      phone: field("phone"),
      facebookUrl: field("facebookUrl"),
      instagramUrl: field("instagramUrl"),
      xTwitterUrl: field("xTwitterUrl"),
      youtubeUrl: field("youtubeUrl"),
      otherUrl: field("otherUrl"),
    },
    session.user.id,
  );
  if (result.kind === "invalid_input") {
    return { ok: false, error: result.error };
  }

  revalidatePath(`/admin/organizations/${organizationId}`);
  const platformDb = getPlatformDb();
  await revalidateLiveSitePath(platformDb, organizationId);

  return { ok: true };
}

const SERVICE_TIME_KINDS = ["service", "office_hours"] as const;
type ServiceTimeKind = (typeof SERVICE_TIME_KINDS)[number];

function isServiceTimeKind(value: string): value is ServiceTimeKind {
  return (SERVICE_TIME_KINDS as readonly string[]).includes(value);
}

/**
 * Whole-list replace per `(organizationId, kind)` — DECISION-092. FormData
 * fields: `organizationId` (uuid), `kind` (`"service"` | `"office_hours"`),
 * `rows` (JSON string: `Array<{ dayOfWeek, startTime, endTime, label }>`).
 * All row-shape/CHECK-mirroring validation lives in
 * `replaceOrganizationServiceTimes` — this wrapper's own parsing is limited
 * to "is this even well-formed JSON naming the right fields," never a
 * duplicate of the domain validation.
 */
export async function setOrganizationServiceTimesAction(
  formData: FormData,
): Promise<PolicyResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Unauthorized." };
  if (!hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return { ok: false, error: "Forbidden." };
  }

  const organizationId = String(formData.get("organizationId") ?? "");
  if (!UUID_RE.test(organizationId)) {
    return { ok: false, error: "Invalid organization." };
  }

  const kindRaw = String(formData.get("kind") ?? "");
  if (!isServiceTimeKind(kindRaw)) {
    return { ok: false, error: "Invalid kind." };
  }

  const rowsRaw = String(formData.get("rows") ?? "[]");
  let parsedRows: unknown;
  try {
    parsedRows = JSON.parse(rowsRaw);
  } catch {
    return { ok: false, error: "Malformed row data." };
  }
  if (!Array.isArray(parsedRows)) {
    return { ok: false, error: "Malformed row data." };
  }

  const rows: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    label: string | null;
  }> = [];
  for (const raw of parsedRows) {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: "Malformed row data." };
    }
    const r = raw as Record<string, unknown>;
    rows.push({
      dayOfWeek: Number(r.dayOfWeek),
      startTime: String(r.startTime ?? ""),
      endTime: String(r.endTime ?? ""),
      label: r.label ? String(r.label) : null,
    });
  }

  const result = await replaceOrganizationServiceTimes(
    organizationId,
    kindRaw,
    rows,
    session.user.id,
  );
  if (result.kind === "invalid_input") {
    return { ok: false, error: result.error };
  }

  revalidatePath(`/admin/organizations/${organizationId}`);
  const platformDb = getPlatformDb();
  await revalidateLiveSitePath(platformDb, organizationId);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// The invitation actions - docs/work-log/2026-10-21-invitations.md, Phase 3
// section 3 (DECISION-183/186/189). They REPLACE designateFoundingAdministrator-
// Action and designateTreasurerAction: designating a person by email no longer
// looks anyone up by account (an account that did not exist yet was the
// production blocker of 2026-10-21, and a mistyped address that matched a real
// account silently received administrator authority). A designation is now an
// INVITATION to an email address; it takes effect only when the email's owner
// accepts through `/invite` (src/app/(invite)/), and the designation audit
// event is written at acceptance.
//
// Every action: auth() -> hasFeature(ADMIN_ORGANIZATIONS) -> zod/field
// validation -> src/lib/onboarding/issue.ts (getPlatformDb() throughout, never
// withOrgContext()) -> revalidatePath. NO `db.*` CALL IN THIS FILE and no
// recordAudit(): issue.ts inserts every audit row (invitation.created /
// resent / revoked) inside the mutation's own transaction, so a failed audit
// insert rolls the change back. That is why `check:audit` has nothing to see
// here; Rule 7 is proven by src/lib/onboarding/issue.db.test.ts, one test per
// outcome (R7).
//
// Refusal copy describes the organization or the roster, NEVER whether an
// address has an account (the send step reads no `users` row).
// ---------------------------------------------------------------------------

const designeeEmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(320));
const inviteeNameSchema = z.string().trim().min(1).max(100);

export type InvitationActionResult =
  | {
      ok: true;
      invitationId?: string;
      /** ISO timestamp. */
      expiresAt?: string;
      delivery?: "sent" | "queued";
      selfAddressed?: boolean;
    }
  | { ok: false; error: string; needsAcknowledgement?: "do_not_contact" };

const DB_ERROR_COPY = "We couldn't complete that just now — try again in a moment.";

function holdersCopy(purpose: "founding_administrator" | "treasurer"): string {
  return purpose === "founding_administrator"
    ? "This organization already has someone who can manage roles — an invitation is only available while nobody does (including as a lockout recovery)."
    : "This organization already has someone who can manage giving — an invitation is only available while nobody does (including as a lockout recovery).";
}

function createFailure(
  result: Exclude<CreateInvitationResult, { kind: "ok" }>,
  purpose: "founding_administrator" | "treasurer",
): InvitationActionResult {
  switch (result.kind) {
    case "has_holders":
      return { ok: false, error: holdersCopy(purpose) };
    case "already_pending":
      return {
        ok: false,
        error: result.expired
          ? "An invitation is already pending and has expired. Resend or revoke it."
          : "An invitation is already pending. Resend or revoke it.",
      };
    case "not_applicable":
      return {
        ok: false,
        error:
          purpose === "treasurer"
            ? "Giving applies to congregations and new worshiping communities only."
            : "That role does not apply to this organization.",
      };
    case "provisioning_incomplete":
      return {
        ok: false,
        error:
          "This organization is missing its baseline setup or a role template — contact an engineer before sending an invitation.",
      };
    case "no_matching_person":
      return {
        ok: false,
        error:
          "Nobody enrolled at this congregation has that email on file. The congregation's administrator enrols them first.",
      };
    case "ambiguous_person":
      return {
        ok: false,
        error:
          "More than one person at this congregation has that email on file. The congregation's administrator corrects the roster first.",
      };
    case "membership_ended":
      return { ok: false, error: "That person's relationship with this organization has ended." };
    case "needs_acknowledgement":
      return {
        ok: false,
        error:
          "That address is marked do not contact. An invitation is account mail, not marketing — confirm to send it anyway.",
        needsAcknowledgement: result.reason,
      };
    case "totp_unavailable":
      return {
        ok: false,
        error:
          "Two-factor sign-in is not configured on this deployment, so an invitee could not finish signing in. Contact an engineer.",
      };
    case "link_origin_unavailable":
      return {
        ok: false,
        error:
          "The platform's public address is not configured, so a safe invitation link can't be built. Contact an engineer.",
      };
    case "rate_limited":
      return { ok: false, error: INVITATION_RATE_LIMIT_COPY };
    case "invalid_input":
      return {
        ok: false,
        error:
          result.field === "email"
            ? "Enter a valid email address."
            : result.field === "firstName"
              ? "Enter a first name (up to 100 characters)."
              : result.field === "lastName"
                ? "Enter a last name (up to 100 characters)."
                : "Invalid organization.",
      };
    case "db_error":
      return { ok: false, error: DB_ERROR_COPY };
  }
}

function acknowledged(formData: FormData): boolean {
  const raw = formData.get("acknowledge");
  return raw === "true" || raw === "on";
}

/**
 * FormData fields: `organizationId` (uuid), `email`, `firstName`, `lastName`,
 * optional `acknowledge`. There is no person-picker: the invitee confirms
 * their own name at acceptance and the database links an existing person at
 * the org by on-file email or creates one.
 */
export async function inviteFoundingAdministratorAction(
  formData: FormData,
): Promise<InvitationActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Unauthorized." };
  if (!hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return { ok: false, error: "Forbidden." };
  }

  const organizationId = String(formData.get("organizationId") ?? "");
  if (!UUID_RE.test(organizationId)) return { ok: false, error: "Invalid organization." };

  const email = designeeEmailSchema.safeParse(formData.get("email"));
  if (!email.success) return { ok: false, error: "Enter a valid email address." };
  const firstName = inviteeNameSchema.safeParse(formData.get("firstName"));
  if (!firstName.success) return { ok: false, error: "Enter a first name (up to 100 characters)." };
  const lastName = inviteeNameSchema.safeParse(formData.get("lastName"));
  if (!lastName.success) return { ok: false, error: "Enter a last name (up to 100 characters)." };

  const result = await createInvitation({
    organizationId,
    purpose: "founding_administrator",
    email: email.data,
    firstName: firstName.data,
    lastName: lastName.data,
    inviter: { userId: session.user.id, email: session.user.email ?? null },
    acknowledgeDoNotContact: acknowledged(formData),
  });

  if (result.kind !== "ok") return createFailure(result, "founding_administrator");
  revalidatePath(`/admin/organizations/${organizationId}`);
  return {
    ok: true,
    invitationId: result.invitationId,
    expiresAt: result.expiresAt.toISOString(),
    delivery: result.delivery,
    selfAddressed: result.selfAddressed,
  };
}

/**
 * FormData fields: `organizationId` (uuid), `email`, optional `acknowledge`.
 * The address must match exactly one live person with an active membership at
 * THIS organization (the roster is resolved first, C6); nothing is created.
 */
export async function inviteTreasurerAction(
  formData: FormData,
): Promise<InvitationActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Unauthorized." };
  if (!hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return { ok: false, error: "Forbidden." };
  }

  const organizationId = String(formData.get("organizationId") ?? "");
  if (!UUID_RE.test(organizationId)) return { ok: false, error: "Invalid organization." };

  const email = designeeEmailSchema.safeParse(formData.get("email"));
  if (!email.success) return { ok: false, error: "Enter a valid email address." };

  const result = await createInvitation({
    organizationId,
    purpose: "treasurer",
    email: email.data,
    inviter: { userId: session.user.id, email: session.user.email ?? null },
    acknowledgeDoNotContact: acknowledged(formData),
  });

  if (result.kind !== "ok") return createFailure(result, "treasurer");
  revalidatePath(`/admin/organizations/${organizationId}`);
  return {
    ok: true,
    invitationId: result.invitationId,
    expiresAt: result.expiresAt.toISOString(),
    delivery: result.delivery,
    selfAddressed: result.selfAddressed,
  };
}

function resendFailure(result: Exclude<ResendInvitationResult, { kind: "ok" }>): InvitationActionResult {
  switch (result.kind) {
    case "not_found":
      return { ok: false, error: "That invitation no longer exists." };
    case "not_open":
      return { ok: false, error: "That invitation has already ended. Send a new one." };
    case "has_holders":
      return {
        ok: false,
        error: "Someone has gained this access since the invitation was sent, so it can't be resent.",
      };
    case "link_origin_unavailable":
      return {
        ok: false,
        error:
          "The platform's public address is not configured, so a safe invitation link can't be built. Contact an engineer.",
      };
    case "rate_limited":
      return { ok: false, error: INVITATION_RATE_LIMIT_COPY };
    case "db_error":
      return { ok: false, error: DB_ERROR_COPY };
  }
}

/** FormData fields: `organizationId`, `invitationId`. The invitation must belong to that organization. */
export async function resendInvitationAction(
  formData: FormData,
): Promise<InvitationActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Unauthorized." };
  if (!hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return { ok: false, error: "Forbidden." };
  }

  const organizationId = String(formData.get("organizationId") ?? "");
  const invitationId = String(formData.get("invitationId") ?? "");
  if (!UUID_RE.test(organizationId) || !UUID_RE.test(invitationId)) {
    return { ok: false, error: "Invalid invitation." };
  }

  const result = await resendInvitation({
    organizationId,
    invitationId,
    actor: { userId: session.user.id, email: session.user.email ?? null },
  });
  if (result.kind !== "ok") return resendFailure(result);
  revalidatePath(`/admin/organizations/${organizationId}`);
  return {
    ok: true,
    invitationId: result.invitationId,
    expiresAt: result.expiresAt.toISOString(),
    delivery: result.delivery,
  };
}

/** FormData fields: `organizationId`, `invitationId`. Revoke is terminal. */
export async function revokeInvitationAction(
  formData: FormData,
): Promise<InvitationActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Unauthorized." };
  if (!hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return { ok: false, error: "Forbidden." };
  }

  const organizationId = String(formData.get("organizationId") ?? "");
  const invitationId = String(formData.get("invitationId") ?? "");
  if (!UUID_RE.test(organizationId) || !UUID_RE.test(invitationId)) {
    return { ok: false, error: "Invalid invitation." };
  }

  const result = await revokeInvitation({
    organizationId,
    invitationId,
    actor: { userId: session.user.id, email: session.user.email ?? null },
  });
  switch (result.kind) {
    case "not_found":
      return { ok: false, error: "That invitation no longer exists." };
    case "not_open":
      return { ok: false, error: "That invitation has already ended." };
    case "db_error":
      return { ok: false, error: DB_ERROR_COPY };
    case "ok":
      revalidatePath(`/admin/organizations/${organizationId}`);
      return { ok: true, invitationId };
  }
}

/** FormData fields: `organizationId`. The abuse takedown: revokes every open invitation of the organization. */
export async function revokeAllInvitationsAction(
  formData: FormData,
): Promise<InvitationActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Unauthorized." };
  if (!hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return { ok: false, error: "Forbidden." };
  }

  const organizationId = String(formData.get("organizationId") ?? "");
  if (!UUID_RE.test(organizationId)) return { ok: false, error: "Invalid organization." };

  const result = await revokeAllOpenInvitations({
    organizationId,
    actor: { userId: session.user.id, email: session.user.email ?? null },
  });
  if (result.kind === "db_error") return { ok: false, error: DB_ERROR_COPY };
  revalidatePath(`/admin/organizations/${organizationId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Revoke a designation holder (docs/work-log/2026-10-22-designation-revoke.md,
// Phase 3; DECISION-194/195/196). Lockout recovery: a platform admin ends the
// current holders of an organization's founding-administrator or treasurer slot.
// Same chain as every action above, and the same discipline: NO `db.*` CALL IN
// THIS FILE and no recordAudit(): `designation-holders.ts` runs the owner-only
// SQL function and inserts the `org.*.revoked` audit row in ONE transaction, so
// a failed audit insert rolls the revoke back. That is why `check:audit` has
// nothing to see here; Rule 7 is proven by designation-holders.db.test.ts.
//
// The client supplies only the organization id, the slot, the subject and the
// grant ids its dialog displayed. The ACTOR comes only from `auth()` (a
// `userId` in the form is never read), and no redirect target is accepted. The
// database refuses any grant the dialog did not name (`changed`), any grant that
// is not a counted holder of this slot at this organization (`not_a_holder`),
// and a derived group's roster (`derived_group_refused`), so this action can
// never become a general "end any grant" tool.
// ---------------------------------------------------------------------------

/**
 * FormData fields: `organizationId`, `slot` (`founding_administrator` |
 * `treasurer`), `subjectKind` (`person` | `group`), `subjectId`,
 * `expectedGrantId` (repeated, 1 to 20: exactly the ids the dialog displayed,
 * contributing plus companion) and `reason`.
 */
export async function revokeDesignationHolderAction(
  formData: FormData,
): Promise<RevokeHolderActionResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: OUTCOME_COPY.unauthorized };
  if (!hasFeature(session.user.features, FEATURES.ADMIN_ORGANIZATIONS)) {
    return { ok: false, error: OUTCOME_COPY.forbidden };
  }

  const expectedGrantIds = formData.getAll("expectedGrantId").map((v) => String(v));
  const fields = revokeHolderFieldsSchema.safeParse({
    organizationId: String(formData.get("organizationId") ?? ""),
    slot: String(formData.get("slot") ?? ""),
    subjectKind: String(formData.get("subjectKind") ?? ""),
    subjectId: String(formData.get("subjectId") ?? ""),
    expectedGrantIds: [...new Set(expectedGrantIds.map((id) => id.toLowerCase()))],
  });
  if (!fields.success) return { ok: false, error: OUTCOME_COPY.invalid };

  const reason = parseReason(formData.get("reason"));
  if (!reason.ok) return { ok: false, error: reason.message, field: "reason" };

  const { organizationId, slot, subjectKind, subjectId } = fields.data;
  const result = await revokeDesignationHolder({
    organizationId,
    slot,
    subjectKind,
    subjectId,
    expectedGrantIds: fields.data.expectedGrantIds,
    reason: reason.reason,
    actor: { userId: session.user.id, email: session.user.email ?? null },
  });

  const refreshed = (error: string): RevokeHolderActionResult => {
    revalidatePath(`/admin/organizations/${organizationId}`);
    return { ok: false, error, refresh: true };
  };

  switch (result.kind) {
    case "revoked":
      revalidatePath(`/admin/organizations/${organizationId}`);
      return { ok: true, reachedZero: result.reachedZero };
    case "already_removed":
      return refreshed(OUTCOME_COPY.already_removed);
    case "changed":
      return refreshed(OUTCOME_COPY.changed);
    case "not_a_holder":
      return refreshed(OUTCOME_COPY.not_found);
    case "no_organization":
      // Same string as not_a_holder (no oracle), and the same re-read prompt.
      return { ok: false, error: OUTCOME_COPY.not_found, refresh: true };
    case "derived_group_refused":
      return { ok: false, error: OUTCOME_COPY.derived_group_refused };
    case "not_applicable":
      return { ok: false, error: OUTCOME_COPY.not_applicable };
    case "invalid_input":
      return { ok: false, error: result.message, field: result.field };
    case "db_error":
      return { ok: false, error: DB_ERROR_COPY };
  }
}
