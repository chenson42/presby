"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getPlatformDb } from "@/lib/db";
import {
  organizationBrands,
  organizationBrandHistory,
} from "@/lib/db/domain/org";
import { FEATURES, hasFeature } from "@/lib/permissions";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { generateBrandTokens, type GeneratedBrand } from "@/lib/brand/generate";
import { TYPE_PAIRINGS, type TypePairingKey } from "@/lib/brand/contract";
import {
  getBlobStore,
  BlobValidationError,
  type BlobRef,
} from "@/lib/storage/blob-store";

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

export type PolicyResult = { ok: true } | { ok: false; error: string };

type ExistingBrand = {
  seedHex: string;
  typePairing: string;
  markAssetKey: string | null;
  wordmarkAssetKey: string | null;
  brandTokenVersion: number;
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
    existing.typePairing !== typePairing;

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
      adjustmentCount: generated.adjustments.length,
    },
  });

  revalidatePath(`/admin/organizations/${organizationId}`);

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

  return { ok: true };
}
