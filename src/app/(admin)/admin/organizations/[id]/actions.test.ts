// vi.mock() calls are hoisted before imports by Vitest's transform. All
// mocks that close over a shared variable must be declared through
// vi.hoisted(); everything else is wired up after the imports below, once
// the REAL src/lib/db/domain/org.ts table objects are available (they are
// plain drizzle column builders with no DB connection at import time — same
// reasoning src/lib/storage/blob-store.test.ts documents for importing
// @/lib/db/domain/assets directly).

vi.mock("server-only", () => ({}));

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { AUDIT_ACTIONS: actual.AUDIT_ACTIONS, recordAudit: mockRecordAudit };
});

const mockStore = vi.hoisted(() => vi.fn());
vi.mock("@/lib/storage/blob-store", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/storage/blob-store")>(
      "@/lib/storage/blob-store",
    );
  return {
    ...actual,
    getBlobStore: vi.fn(() => ({ store: mockStore, resolve: vi.fn() })),
  };
});

// --- getPlatformDb(): select chain (existing-row lookup) --------------------
const mockLimit = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockWhere = vi.hoisted(() => vi.fn().mockReturnValue({ limit: mockLimit }));
const mockFrom = vi.hoisted(() => vi.fn().mockReturnValue({ where: mockWhere }));
const mockSelect = vi.hoisted(() => vi.fn().mockReturnValue({ from: mockFrom }));

// --- getPlatformDb(): transaction chain -------------------------------------
const mockOnConflictDoUpdate = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
const mockBrandsValues = vi.hoisted(() =>
  vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate }),
);
const mockHistoryValues = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockTxInsert = vi.hoisted(() => vi.fn());
const mockDeleteWhere = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockTxDelete = vi.hoisted(() =>
  vi.fn().mockReturnValue({ where: mockDeleteWhere }),
);
const mockTransaction = vi.hoisted(() =>
  vi.fn(async (cb: (tx: unknown) => unknown) =>
    cb({ insert: mockTxInsert, delete: mockTxDelete }),
  ),
);

const mockGetPlatformDb = vi.hoisted(() =>
  vi.fn(() => ({
    select: mockSelect,
    transaction: mockTransaction,
  })),
);
vi.mock("@/lib/db", () => ({ getPlatformDb: mockGetPlatformDb }));

// A PRE-EXISTING circular import (org.ts -> schema.ts -> domain/index.ts ->
// authz.ts -> org.ts) breaks when `@/lib/db/domain/org` is the FIRST module
// in that cycle to load — authz.ts's top-level `organizationType(...)` call
// runs before org.ts's own `organizationType` export has been assigned.
// Real app code never hits this because `@/lib/db` (index.ts) always
// imports `./schema` before anything reaches `domain/org` directly; this
// test file imports `@/lib/db/domain/org` in isolation (real, unmocked —
// see the comment at the top of this file), so it must force the same safe
// ordering by importing schema.ts first. Confirmed as the exact root cause
// by a minimal repro during Phase 4 of P0.5 slice c2; not something this
// commit introduces, but worth a TODO for database-admin to un-cycle
// authz.ts's own import of org.ts's enum.
import "@/lib/db/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  setOrganizationBrandAction,
  neutralizeOrganizationBrandAction,
} from "./actions";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { FEATURES } from "@/lib/permissions";
import {
  organizationBrands,
  organizationBrandHistory,
} from "@/lib/db/domain/org";

// tx.insert(table) must return the history chain for organizationBrandHistory
// and the brands chain for organizationBrands — real table objects, so
// identity comparison is exact.
mockTxInsert.mockImplementation((table: unknown) => {
  if (table === organizationBrandHistory) {
    return { values: mockHistoryValues };
  }
  if (table === organizationBrands) {
    return { values: mockBrandsValues };
  }
  throw new Error(`mockTxInsert: unexpected table ${String(table)}`);
});

const VALID_ORG = "11111111-2222-3333-4444-555555555555";
const VALID_HEX = "#7a1f2b";
const OTHER_HEX = "#2b4f7a";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00,
]);

// Buffer's backing ArrayBufferLike is typed as possibly-SharedArrayBuffer,
// which lib.dom's BlobPart rejects. Copy into a plain-ArrayBuffer-backed
// Uint8Array to satisfy File's constructor type.
function toBlobPart(buf: Buffer): BlobPart {
  const out = new ArrayBuffer(buf.byteLength);
  new Uint8Array(out).set(buf);
  return out;
}

function pngFile(bytes: Buffer = PNG_BYTES, name = "logo.png"): File {
  return new File([toBlobPart(bytes)], name, { type: "image/png" });
}

function formData(
  fields: Record<string, string>,
  file?: File,
): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (file) fd.set("logo", file);
  return fd;
}

function sessionWith(features: string[]) {
  return { user: { id: "operator-1", features } };
}

const ADMIN_SESSION = sessionWith([FEATURES.ADMIN_ORGANIZATIONS]);

const EXISTING_ROW = {
  seedHex: VALID_HEX,
  typePairing: "classic",
  markAssetKey: "aaaaaaaa-0000-0000-0000-000000000000",
  wordmarkAssetKey: null,
  brandTokenVersion: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(ADMIN_SESSION);
  mockLimit.mockResolvedValue([]);
  mockOnConflictDoUpdate.mockResolvedValue(undefined);
  mockHistoryValues.mockResolvedValue(undefined);
  mockDeleteWhere.mockResolvedValue(undefined);
  mockStore.mockResolvedValue({
    key: "bbbbbbbb-1111-1111-1111-111111111111",
    contentType: "image/png",
    byteSize: PNG_BYTES.byteLength,
  });
});

// ---------------------------------------------------------------------------
// Authorization — both actions
// ---------------------------------------------------------------------------

describe("setOrganizationBrandAction — authorization", () => {
  it("rejects an unauthenticated caller without touching the database", async () => {
    mockAuth.mockResolvedValue(null);
    const result = await setOrganizationBrandAction(
      formData({ organizationId: VALID_ORG, seedHex: VALID_HEX, typePairing: "classic" }),
    );
    expect(result).toEqual({ ok: false, error: "Unauthorized." });
    expect(mockGetPlatformDb).not.toHaveBeenCalled();
  });

  it("rejects a signed-in user lacking admin.organizations", async () => {
    mockAuth.mockResolvedValue(sessionWith([FEATURES.ADMIN_DASHBOARD]));
    const result = await setOrganizationBrandAction(
      formData({ organizationId: VALID_ORG, seedHex: VALID_HEX, typePairing: "classic" }),
    );
    expect(result).toEqual({ ok: false, error: "Forbidden." });
    expect(mockGetPlatformDb).not.toHaveBeenCalled();
  });
});

describe("neutralizeOrganizationBrandAction — authorization", () => {
  it("rejects an unauthenticated caller without touching the database", async () => {
    mockAuth.mockResolvedValue(null);
    const result = await neutralizeOrganizationBrandAction(
      formData({ organizationId: VALID_ORG }),
    );
    expect(result).toEqual({ ok: false, error: "Unauthorized." });
    expect(mockGetPlatformDb).not.toHaveBeenCalled();
  });

  it("rejects a signed-in user lacking admin.organizations", async () => {
    mockAuth.mockResolvedValue(sessionWith([FEATURES.ADMIN_DASHBOARD]));
    const result = await neutralizeOrganizationBrandAction(
      formData({ organizationId: VALID_ORG }),
    );
    expect(result).toEqual({ ok: false, error: "Forbidden." });
    expect(mockGetPlatformDb).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// setOrganizationBrandAction — input validation
// ---------------------------------------------------------------------------

describe("setOrganizationBrandAction — input validation", () => {
  it("rejects an invalid organizationId", async () => {
    const result = await setOrganizationBrandAction(
      formData({ organizationId: "not-a-uuid", seedHex: VALID_HEX, typePairing: "classic" }),
    );
    expect(result).toEqual({ ok: false, error: "Invalid organization." });
    expect(mockGetPlatformDb).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", ""],
    ["missing hash", "7a1f2b"],
    ["short", "#7a1f2"],
    ["not hex", "#zzzzzz"],
    ["css named colour", "red"],
  ])("rejects a seedHex that is %s (A7: never trust the client string)", async (_label, value) => {
    const result = await setOrganizationBrandAction(
      formData({ organizationId: VALID_ORG, seedHex: value, typePairing: "classic" }),
    );
    expect(result).toEqual({
      ok: false,
      error: "Enter a colour as a 6-digit hex code, like #7a1f2b.",
    });
    expect(mockGetPlatformDb).not.toHaveBeenCalled();
  });

  it("accepts an uppercase hex (case-insensitive)", async () => {
    const result = await setOrganizationBrandAction(
      formData({ organizationId: VALID_ORG, seedHex: "#7A1F2B", typePairing: "classic" }),
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects a typePairing outside the curated TYPE_PAIRINGS set", async () => {
    const result = await setOrganizationBrandAction(
      formData({ organizationId: VALID_ORG, seedHex: VALID_HEX, typePairing: "gothic" }),
    );
    expect(result).toEqual({
      ok: false,
      error: "Choose one of the curated type pairings.",
    });
    expect(mockGetPlatformDb).not.toHaveBeenCalled();
  });

  it.each(["classic", "modern", "warm"])(
    "accepts the curated pairing %s",
    async (pairing) => {
      const result = await setOrganizationBrandAction(
        formData({ organizationId: VALID_ORG, seedHex: VALID_HEX, typePairing: pairing }),
      );
      expect(result).toEqual({ ok: true });
    },
  );
});

// ---------------------------------------------------------------------------
// setOrganizationBrandAction — the write (no file)
// ---------------------------------------------------------------------------

describe("setOrganizationBrandAction — creating a brand (no prior row)", () => {
  it("uses the platform connection, never withOrgContext", async () => {
    await setOrganizationBrandAction(
      formData({ organizationId: VALID_ORG, seedHex: VALID_HEX, typePairing: "classic" }),
    );
    expect(mockGetPlatformDb).toHaveBeenCalled();
  });

  it("writes no history row when there was no prior brand", async () => {
    await setOrganizationBrandAction(
      formData({ organizationId: VALID_ORG, seedHex: VALID_HEX, typePairing: "classic" }),
    );
    expect(mockHistoryValues).not.toHaveBeenCalled();
  });

  it("upserts organization_brands with the submitted seedHex/typePairing", async () => {
    await setOrganizationBrandAction(
      formData({ organizationId: VALID_ORG, seedHex: VALID_HEX, typePairing: "classic" }),
    );
    expect(mockBrandsValues).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: VALID_ORG,
        seedHex: VALID_HEX,
        typePairing: "classic",
        updatedBy: "operator-1",
      }),
    );
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: organizationBrands.organizationId,
        set: expect.objectContaining({ seedHex: VALID_HEX, typePairing: "classic" }),
      }),
    );
  });

  it("audits ORG_BRAND_SET with seedHex, typePairing and adjustmentCount", async () => {
    await setOrganizationBrandAction(
      formData({ organizationId: VALID_ORG, seedHex: VALID_HEX, typePairing: "classic" }),
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.ORG_BRAND_SET,
        resourceType: "organization",
        resourceId: VALID_ORG,
        metadata: expect.objectContaining({
          seedHex: VALID_HEX,
          typePairing: "classic",
          adjustmentCount: expect.any(Number),
        }),
      }),
    );
  });
});

describe("setOrganizationBrandAction — updating an existing brand", () => {
  beforeEach(() => {
    mockLimit.mockResolvedValue([EXISTING_ROW]);
  });

  it("writes a history row capturing the value about to be superseded", async () => {
    await setOrganizationBrandAction(
      formData({ organizationId: VALID_ORG, seedHex: OTHER_HEX, typePairing: "modern" }),
    );
    expect(mockHistoryValues).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: VALID_ORG,
        action: "updated",
        seedHex: EXISTING_ROW.seedHex,
        typePairing: EXISTING_ROW.typePairing,
        markAssetKey: EXISTING_ROW.markAssetKey,
        changedBy: "operator-1",
      }),
    );
  });

  it("upserts with the NEW seedHex/typePairing, not the old ones", async () => {
    await setOrganizationBrandAction(
      formData({ organizationId: VALID_ORG, seedHex: OTHER_HEX, typePairing: "modern" }),
    );
    expect(mockBrandsValues).toHaveBeenCalledWith(
      expect.objectContaining({ seedHex: OTHER_HEX, typePairing: "modern" }),
    );
  });
});

// ---------------------------------------------------------------------------
// setOrganizationBrandAction — the generator boundary
// ---------------------------------------------------------------------------

describe("setOrganizationBrandAction — generator boundary", () => {
  it("does not re-run contrast checks itself — trusts generateBrandTokens for a validated hex", async () => {
    // A seed that historically needed the near-grey/hue-nudge fallback paths
    // in generate.ts still succeeds end-to-end; this action only re-throws
    // if the generator itself throws, which it does not for any 6-digit hex.
    const result = await setOrganizationBrandAction(
      formData({ organizationId: VALID_ORG, seedHex: "#fafafa", typePairing: "classic" }),
    );
    expect(result).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// File upload — validation (E-c1) and the store() boundary (E-c2)
// ---------------------------------------------------------------------------

describe("setOrganizationBrandAction — logo upload validation (E-c1)", () => {
  // Isolate pure file-validation rejection from the E-c2 partial-save
  // question below: an EXISTING row with the SAME seedHex/typePairing means
  // this submission changes nothing but the (rejected) file, so the bare
  // Flow-2 copy is what the caller sees — no "colour saved" prefix.
  beforeEach(() => {
    mockLimit.mockResolvedValue([EXISTING_ROW]);
  });

  it("rejects an oversized file with the exact copy, without calling store()", async () => {
    const big = new File([toBlobPart(Buffer.alloc(3 * 1024 * 1024, 1))], "big.png", {
      type: "image/png",
    });
    const result = await setOrganizationBrandAction(
      formData(
        { organizationId: VALID_ORG, seedHex: EXISTING_ROW.seedHex, typePairing: EXISTING_ROW.typePairing },
        big,
      ),
    );
    expect(result).toEqual({
      ok: false,
      error: "That file is 3 MB — we can take up to 2 MB.",
    });
    expect(mockStore).not.toHaveBeenCalled();
    // Colour/pairing unchanged and the file was rejected before store() —
    // nothing landed in the database for this no-op-but-for-the-logo resubmit.
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("rejects a wrong-type file by sniffing magic bytes, not the browser's declared MIME type", async () => {
    // Browser claims image/png; the bytes are plain text. Sniffing must win.
    const spoofed = new File([toBlobPart(Buffer.from("not actually a png"))], "fake.png", {
      type: "image/png",
    });
    const result = await setOrganizationBrandAction(
      formData(
        { organizationId: VALID_ORG, seedHex: EXISTING_ROW.seedHex, typePairing: EXISTING_ROW.typePairing },
        spoofed,
      ),
    );
    expect(result).toEqual({
      ok: false,
      error:
        "That doesn't look like an image we can use — upload a PNG, JPEG, or WEBP file.",
    });
    expect(mockStore).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("accepts a real PNG and includes its stored key in the upsert", async () => {
    const result = await setOrganizationBrandAction(
      formData({ organizationId: VALID_ORG, seedHex: VALID_HEX, typePairing: "classic" }, pngFile()),
    );
    expect(result).toEqual({ ok: true });
    expect(mockStore).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: VALID_ORG, contentType: "image/png" }),
    );
    expect(mockBrandsValues).toHaveBeenCalledWith(
      expect.objectContaining({
        markAssetKey: "bbbbbbbb-1111-1111-1111-111111111111",
      }),
    );
  });

  it("store() runs BEFORE the transaction opens", async () => {
    const callOrder: string[] = [];
    mockStore.mockImplementationOnce(async () => {
      callOrder.push("store");
      return {
        key: "bbbbbbbb-1111-1111-1111-111111111111",
        contentType: "image/png",
        byteSize: PNG_BYTES.byteLength,
      };
    });
    mockTransaction.mockImplementationOnce(async (cb) => {
      callOrder.push("transaction");
      return cb({ insert: mockTxInsert, delete: mockTxDelete });
    });
    await setOrganizationBrandAction(
      formData({ organizationId: VALID_ORG, seedHex: VALID_HEX, typePairing: "classic" }, pngFile()),
    );
    expect(callOrder).toEqual(["store", "transaction"]);
  });
});

// ---------------------------------------------------------------------------
// E-c2 — partial-save honesty
// ---------------------------------------------------------------------------

describe("setOrganizationBrandAction — E-c2 partial-save honesty", () => {
  it("a file-only failure (colour/pairing unchanged) touches NOTHING in the database", async () => {
    mockLimit.mockResolvedValue([EXISTING_ROW]);
    const big = new File([toBlobPart(Buffer.alloc(3 * 1024 * 1024, 1))], "big.png", {
      type: "image/png",
    });

    const result = await setOrganizationBrandAction(
      formData(
        { organizationId: VALID_ORG, seedHex: EXISTING_ROW.seedHex, typePairing: EXISTING_ROW.typePairing },
        big,
      ),
    );

    expect(result).toEqual({
      ok: false,
      error: "That file is 3 MB — we can take up to 2 MB.",
    });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("storage failure (store() throws) alongside a real colour change still commits the colour, and the error names only the logo", async () => {
    mockLimit.mockResolvedValue([EXISTING_ROW]);
    mockStore.mockRejectedValueOnce(new Error("connection reset"));

    const result = await setOrganizationBrandAction(
      formData(
        { organizationId: VALID_ORG, seedHex: OTHER_HEX, typePairing: "modern" },
        pngFile(),
      ),
    );

    // The colour/pairing change committed...
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockBrandsValues).toHaveBeenCalledWith(
      expect.objectContaining({ seedHex: OTHER_HEX, typePairing: "modern" }),
    );
    // ...but markAssetKey was NOT touched (the existing logo survives).
    const brandsCallArg = mockBrandsValues.mock.calls[0]?.[0];
    expect(brandsCallArg).not.toHaveProperty("markAssetKey");
    const updateSetArg = mockOnConflictDoUpdate.mock.calls[0]?.[0]?.set;
    expect(updateSetArg).not.toHaveProperty("markAssetKey");

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUDIT_ACTIONS.ORG_BRAND_SET }),
    );

    // The error is honest about what succeeded and names only the logo —
    // never a blanket "save failed."
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain(
      "Colour and type pairing saved.",
    );
    expect((result as { ok: false; error: string }).error).toContain(
      "logo could not be stored",
    );
    expect((result as { ok: false; error: string }).error).not.toMatch(
      /save failed/i,
    );
  });

  it("a BlobValidationError from store() surfaces its own message in the combined error", async () => {
    mockLimit.mockResolvedValue([EXISTING_ROW]);
    const { BlobValidationError } = await vi.importActual<
      typeof import("@/lib/storage/blob-store")
    >("@/lib/storage/blob-store");
    mockStore.mockRejectedValueOnce(
      new BlobValidationError("blob-store: content type rejected"),
    );

    const result = await setOrganizationBrandAction(
      formData(
        { organizationId: VALID_ORG, seedHex: OTHER_HEX, typePairing: "modern" },
        pngFile(),
      ),
    );

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain(
      "blob-store: content type rejected",
    );
  });
});

// ---------------------------------------------------------------------------
// neutralizeOrganizationBrandAction
// ---------------------------------------------------------------------------

describe("neutralizeOrganizationBrandAction", () => {
  it("rejects an invalid organizationId", async () => {
    const result = await neutralizeOrganizationBrandAction(
      formData({ organizationId: "not-a-uuid" }),
    );
    expect(result).toEqual({ ok: false, error: "Invalid organization." });
    expect(mockGetPlatformDb).not.toHaveBeenCalled();
  });

  it("records history capturing the deleted brand, deletes the row, and audits hadBrand: true", async () => {
    mockLimit.mockResolvedValue([EXISTING_ROW]);

    const result = await neutralizeOrganizationBrandAction(
      formData({ organizationId: VALID_ORG }),
    );

    expect(result).toEqual({ ok: true });
    expect(mockHistoryValues).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: VALID_ORG,
        action: "neutralized",
        seedHex: EXISTING_ROW.seedHex,
        typePairing: EXISTING_ROW.typePairing,
        markAssetKey: EXISTING_ROW.markAssetKey,
        changedBy: "operator-1",
      }),
    );
    expect(mockDeleteWhere).toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.ORG_BRAND_NEUTRALIZED,
        resourceType: "organization",
        resourceId: VALID_ORG,
        metadata: { hadBrand: true },
      }),
    );
  });

  it("is idempotent — neutralizing an org with no brand writes an all-null history row and audits hadBrand: false", async () => {
    mockLimit.mockResolvedValue([]);

    const result = await neutralizeOrganizationBrandAction(
      formData({ organizationId: VALID_ORG }),
    );

    expect(result).toEqual({ ok: true });
    expect(mockHistoryValues).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "neutralized",
        seedHex: null,
        typePairing: null,
        markAssetKey: null,
        wordmarkAssetKey: null,
        brandTokenVersion: null,
      }),
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { hadBrand: false } }),
    );
  });
});
