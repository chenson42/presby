import "server-only";
import { eq, sql } from "drizzle-orm";
import { withOrgContext } from "@/lib/authz";
import type { db } from "@/lib/db";
import { organizationBrandHistory, organizationBrands } from "@/lib/db/domain/org";
import { TYPE_PAIRINGS, type TypePairingKey } from "@/lib/brand/contract";
import { generateBrandTokens, type GeneratedBrand } from "@/lib/brand/generate";
import {
  BlobValidationError,
  getBlobStore,
  type BlobRef,
} from "@/lib/storage/blob-store";

/**
 * Tenant-facing brand editor — P0.5 slice d
 * (`docs/work-log/2026-08-26-tenant-branding-permission.md`, Phase 3, commit
 * 2/3). Lets a congregation's own `branding.manage` holder set the exact
 * same `organization_brands` row the platform operator's
 * `(admin)/admin/organizations/[id]/actions.ts` already writes — a second,
 * independently-scoped writer onto one table, not a replacement for the
 * first (DECISION-101). No schema change: `organization_brands`/
 * `organization_brand_history` were already `FORCE RLS` with a full
 * `presby_app` grant since `drizzle/0016_presby_brand_storage.sql`, declared
 * that early specifically so this module would need no migration of its own
 * (see that migration's own comment).
 *
 * NOT PART OF `src/lib/brand/` — that directory's contract is closed
 * (`contract.ts`/`generate.ts`/`fonts.ts`/`read-org-brand.ts` only, zero
 * runtime imports beyond `./contrast`). This module IMPORTS
 * `generateBrandTokens`/`TYPE_PAIRINGS` from there, read-only, the same way
 * the platform action does — it is a sibling to `role-grants.ts`/
 * `officers.ts`/`org-features.ts`, not a fifth file inside `brand/`.
 *
 * SAME SHAPE AS `role-grants.ts`/`officers.ts` (DECISION-096/-101's
 * precedent): the `branding.manage` gate is checked FIRST in every exported
 * function, via the private `hasBrandingManage` helper below — before any
 * other read. `getOrgBrandForEdit` re-checks the gate on every call, same
 * "every read re-checks the gate" discipline `listGrants`/`listOfficerRoster`
 * establish; it is NOT a replacement for `src/lib/brand/read-org-brand.ts`
 * (that one function is the layout's single, unconditional, ungated
 * token-emission read for every visitor — this is the editor's own gated
 * pre-fill read, and it additionally carries `markAssetKey`/
 * `wordmarkAssetKey`, which the layout read has no reason to expose).
 *
 * VALIDATION/GENERATION/LOGO-HANDLING IS REPLICATED FROM THE PLATFORM
 * ACTION, NOT REINVENTED (Phase 2's explicit instruction) —
 * `SEED_HEX_RE`/`MAX_LOGO_BYTES`/`sniffImageContentType`/`formatMB` below are
 * a duplicated-by-convention copy of
 * `(admin)/admin/organizations/[id]/actions.ts`'s own private constants and
 * function, the same "no cross-route-group import of another actions.ts's
 * private constants" discipline `role-grants.ts`'s own header names for
 * `DATE_RE`. The E-c1 (sniff magic bytes, never trust the browser's reported
 * MIME type) and E-c2 (a logo failure that is the ONLY change in a
 * submission touches nothing in the database) disciplines are reproduced
 * verbatim.
 *
 * THREE-STEP ORDERING (Phase 2's explicit instruction, re-stated in Phase 3's
 * API contract) — each step is its own paragraph below because a reorder
 * would reopen the exact "phantom membership" / "logo-store-then-forbidden
 * race" concerns Phase 2/3 already closed:
 *
 *   A. ONE `withOrgContext()` transaction: the `branding.manage` gate FIRST
 *      (matching every other module in this tree's "forbidden check runs
 *      before anything else" discipline), THEN the existing brand row, read
 *      in the same transaction — both reads, no write yet. Unlike the
 *      platform action (which checks `FEATURES.ADMIN_ORGANIZATIONS` as a
 *      bare session claim before anything else), `branding.manage` requires
 *      a `presby_has_permission()` database round-trip, so this gate cannot
 *      run before a transaction exists — it IS the first transaction. A
 *      caller who fails this gate never reaches `store()` at all, which is
 *      why the "logo-store-then-forbidden" race Phase 2 worried about is
 *      structurally impossible here.
 *   B. Outside any transaction: sniff/size-validate the logo if present, then
 *      `getBlobStore().store()` — byte-identical ordering to the platform
 *      action's own logo handling (validate BEFORE ever calling `store()`, so
 *      a bad type/oversized file is a client input error, never a storage
 *      failure, and never leaves a dangling asset reference).
 *   C. A SECOND `withOrgContext()` transaction: a history row (if a prior
 *      brand existed) capturing what is about to be superseded, then the
 *      `organization_brands` upsert.
 *
 * `hexOrPairingChanged`/partial-save-on-logo-failure honesty (E-c2) is
 * replicated verbatim from the platform action, not reinvented, per Phase
 * 2's explicit instruction.
 */

type OrgTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const BRANDING_MANAGE = "branding.manage";

// Private, duplicated-by-convention — see the module header. No
// cross-route-group import of another actions.ts's private constants exists
// anywhere in this tree, and this module isn't the first.
const SEED_HEX_RE = /^#[0-9a-f]{6}$/i;
// Mirrors blob-store.ts's private MAX_BYTE_SIZE and the platform action's own
// MAX_LOGO_BYTES / the blob_assets_byte_size_bounds CHECK.
const MAX_LOGO_BYTES = 2_097_152;

const TYPE_PAIRING_KEYS = new Set<string>(TYPE_PAIRINGS.map((p) => p.key));
function isTypePairingKey(value: string): value is TypePairingKey {
  return TYPE_PAIRING_KEYS.has(value);
}

/**
 * Byte-identical copy of the platform action's own
 * `sniffImageContentType()`. Sniffs magic bytes rather than trusting the
 * browser's reported MIME type (E-c1). SVG is rejected by construction — it
 * has no magic-byte signature this function recognizes, so it falls through
 * to `null` (G7: `<script>`/`<foreignObject>` make sanitising it its own
 * project).
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
 * The single-permission gate every exported function in this module checks
 * FIRST. Not exported — same discipline `hasRoleGrantsManage`/
 * `hasOfficersManage`/`hasOrgFeaturesManage` document: one place
 * `presby_has_permission(..., 'branding.manage')` is spelled out, so the two
 * call sites below cannot drift.
 */
async function hasBrandingManage(
  tx: OrgTx,
  personId: string,
  organizationId: string,
): Promise<boolean> {
  const result = await tx.execute(sql`
    select presby_has_permission(
             ${personId}::uuid,
             ${organizationId}::uuid,
             ${BRANDING_MANAGE}
           ) as allowed
  `);
  return (
    (result as unknown as { rows?: Array<{ allowed?: boolean }> }).rows?.[0]
      ?.allowed === true
  );
}

// ---------------------------------------------------------------------------
// Shared read
// ---------------------------------------------------------------------------

export interface ExistingTenantBrand {
  seedHex: string;
  typePairing: TypePairingKey;
  markAssetKey: string | null;
  wordmarkAssetKey: string | null;
  brandTokenVersion: number;
  lightOnly: boolean;
}

async function fetchExistingBrand(
  tx: OrgTx,
  organizationId: string,
): Promise<ExistingTenantBrand | null> {
  const rows = await tx
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
  const row = rows[0];
  if (!row) return null;
  return {
    seedHex: row.seedHex,
    // No CHECK enum on this column yet (contract.ts's own comment) — this
    // module only ever WRITES a validated TypePairingKey (isTypePairingKey()
    // gates setBrand()'s own input below), so casting a value this module
    // itself put there is safe; it is not re-validated on read.
    typePairing: row.typePairing as TypePairingKey,
    markAssetKey: row.markAssetKey,
    wordmarkAssetKey: row.wordmarkAssetKey,
    brandTokenVersion: row.brandTokenVersion,
    lightOnly: row.lightOnly,
  };
}

export type GetOrgBrandResult =
  | { kind: "ok"; brand: ExistingTenantBrand | null }
  | { kind: "forbidden" };

/**
 * The editor's own pre-fill read. Gated on `branding.manage`, same
 * "every read re-checks the gate" discipline as `listGrants`/
 * `listOfficerRoster`/`listFeatureToggles` — a third, distinct reader of
 * `organization_brands`, for a third distinct purpose (see module header).
 */
export async function getOrgBrandForEdit(
  viewerPersonId: string,
  organizationId: string,
): Promise<GetOrgBrandResult> {
  return withOrgContext(viewerPersonId, organizationId, async (tx) => {
    if (!(await hasBrandingManage(tx, viewerPersonId, organizationId))) {
      return { kind: "forbidden" };
    }
    const brand = await fetchExistingBrand(tx, organizationId);
    return { kind: "ok", brand };
  });
}

// ---------------------------------------------------------------------------
// setBrand
// ---------------------------------------------------------------------------

export interface SetBrandInput {
  seedHex: string;
  typePairing: string;
  lightOnly: boolean;
  /** Present only when a file was submitted and had a non-zero size. */
  logo: { bytes: Buffer; declaredContentType: string } | null;
}

export type SetBrandResult =
  | { kind: "forbidden" }
  | { kind: "invalid_hex" }
  | { kind: "invalid_pairing" }
  | { kind: "generation_failed" }
  /** E-c2 parity: the ONLY thing this submission changed was a bad logo —
   * nothing written. */
  | { kind: "logo_rejected"; message: string }
  | {
      kind: "ok";
      adjustmentCount: number;
      /** Non-null = colour/pairing saved, logo specifically failed
       * (E-c2 partial-save). */
      partialSaveLogoError: string | null;
    };

/**
 * Sets (creates or updates) `organizationId`'s brand: seed colour, curated
 * type pairing, light-only toggle, and optionally a logo mark. See the
 * module header for the three-step ordering this function follows.
 */
export async function setBrand(
  actorPersonId: string,
  organizationId: string,
  actorUserId: string,
  input: SetBrandInput,
): Promise<SetBrandResult> {
  // Step A — gate FIRST (before validating anything about the input, same
  // "forbidden check runs before any other work" discipline every other
  // module in this tree follows), then the existing brand read, both inside
  // one transaction.
  const gated = await withOrgContext(
    actorPersonId,
    organizationId,
    async (tx): Promise<
      | { kind: "forbidden" }
      | { kind: "ok"; existing: ExistingTenantBrand | null }
    > => {
      if (!(await hasBrandingManage(tx, actorPersonId, organizationId))) {
        return { kind: "forbidden" };
      }
      const existing = await fetchExistingBrand(tx, organizationId);
      return { kind: "ok", existing };
    },
  );
  if (gated.kind === "forbidden") {
    return { kind: "forbidden" };
  }
  const existing = gated.existing;

  // A7: never trust the client's colour string. Re-validated here
  // independently of whatever the editor's own client-side check does — the
  // generator also refuses anything else, and the DB CHECK
  // (organization_brands_seed_hex_format) is the third and final backstop.
  const seedHex = input.seedHex.toLowerCase();
  if (!SEED_HEX_RE.test(seedHex)) {
    return { kind: "invalid_hex" };
  }

  if (!isTypePairingKey(input.typePairing)) {
    return { kind: "invalid_pairing" };
  }
  const typePairing = input.typePairing;

  // Only reject if the generator itself throws — it shouldn't for a
  // validated 6-digit hex. The property test (brand foundation pipeline,
  // commit b1) is what guarantees every legal pair clears the accessibility
  // floor; re-checking contrast here would duplicate that guarantee rather
  // than trust it.
  let generated: GeneratedBrand;
  try {
    generated = generateBrandTokens(seedHex);
  } catch {
    return { kind: "generation_failed" };
  }

  // Step B — outside any transaction. E-c1/E-c2: validate BEFORE ever
  // calling store() — a bad type or an oversized file is a client input
  // error, not a storage failure, and must never leave a dangling asset
  // reference. Sniff magic bytes; never trust the browser's reported MIME
  // type.
  let fileError: string | null = null;
  let newMarkAssetKey: string | undefined;

  if (input.logo) {
    const logoBytes = input.logo.bytes;
    if (logoBytes.byteLength > MAX_LOGO_BYTES) {
      fileError = `That file is ${formatMB(logoBytes.byteLength)} MB — we can take up to 2 MB.`;
    } else {
      const sniffed = sniffImageContentType(logoBytes);
      if (!sniffed) {
        fileError =
          "That doesn't look like an image we can use — upload a PNG, JPEG, or WEBP file.";
      } else {
        // E-c2's ordering: store() happens BEFORE the second transaction
        // opens, so a row never points at bytes that were never stored.
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
    existing.lightOnly !== input.lightOnly;

  // E-c2: a logo failure that is the ONLY thing this submission changed
  // touches nothing — no dangling half-applied row for a no-op resubmit.
  if (fileError && !hexOrPairingChanged) {
    return { kind: "logo_rejected", message: fileError };
  }

  // Step C — a second, independent withOrgContext() transaction: the
  // history row (if a prior brand existed), then the upsert.
  await withOrgContext(actorPersonId, organizationId, async (tx) => {
    if (existing) {
      await tx.insert(organizationBrandHistory).values({
        organizationId,
        action: "updated",
        seedHex: existing.seedHex,
        typePairing: existing.typePairing,
        markAssetKey: existing.markAssetKey,
        wordmarkAssetKey: existing.wordmarkAssetKey,
        brandTokenVersion: existing.brandTokenVersion,
        changedBy: actorUserId,
      });
    }

    const insertValues: typeof organizationBrands.$inferInsert = {
      organizationId,
      seedHex,
      typePairing,
      lightOnly: input.lightOnly,
      brandTokenVersion: generated.tokens.version,
      updatedBy: actorUserId,
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
          lightOnly: input.lightOnly,
          brandTokenVersion: generated.tokens.version,
          updatedBy: actorUserId,
          updatedAt: new Date(),
          ...(newMarkAssetKey ? { markAssetKey: newMarkAssetKey } : {}),
        },
      });
  });

  return {
    kind: "ok",
    adjustmentCount: generated.adjustments.length,
    partialSaveLogoError: fileError,
  };
}
