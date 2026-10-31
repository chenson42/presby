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

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

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
// revalidateLiveSitePath (this commit's own addition, see actions.ts) chains
// .from(organizations).leftJoin(organizationSites)....where()....limit() —
// a SECOND shape off the same .from() return value the pre-existing
// fetchExistingBrand() chain (.from().where().limit()) already uses. Both
// methods live on the same mock object so either chain resolves.
const mockLeftJoin = vi.hoisted(() => vi.fn().mockReturnValue({ where: mockWhere }));
const mockFrom = vi.hoisted(() =>
  vi.fn().mockReturnValue({ where: mockWhere, leftJoin: mockLeftJoin }),
);
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

// @/lib/sites — mocked wholesale, same principle as tickets/actions.test.ts
// mocking @/lib/tickets: the SQL correctness of provisionSite/setSiteStatus
// is proven by sites.test.ts against a real Postgres connection. This file's
// own mockGetPlatformDb harness (above) has no `.insert`/`.update` chain
// configured — those real functions would crash against it if exercised for
// real here. This also avoids pulling in @/lib/sites' own transitive
// `next/font/google` import path in a plain Node vitest environment.
const mockProvisionSite = vi.hoisted(() => vi.fn());
const mockSetSiteStatus = vi.hoisted(() => vi.fn());
const mockSetOrganizationProfile = vi.hoisted(() => vi.fn());
const mockReplaceOrganizationServiceTimes = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sites", () => ({
  provisionSite: (...args: unknown[]) => mockProvisionSite(...args),
  setSiteStatus: (...args: unknown[]) => mockSetSiteStatus(...args),
  setOrganizationProfile: (...args: unknown[]) =>
    mockSetOrganizationProfile(...args),
  replaceOrganizationServiceTimes: (...args: unknown[]) =>
    mockReplaceOrganizationServiceTimes(...args),
}));

// @/lib/onboarding/issue - mocked wholesale, same principle as @/lib/sites
// above: the SQL, the audit-in-transaction behaviour and the full outcome
// matrix are proven against a real Postgres by src/lib/onboarding/
// issue.db.test.ts. This file proves only the invitation actions' own layer:
// the auth/feature gate, zod validation, the result -> copy switch, and that
// revalidatePath fires exactly once, only on `ok` (and that no recordAudit()
// is called from here: issue.ts writes the audit rows in its own transaction).
const mockCreateInvitation = vi.hoisted(() => vi.fn());
const mockResendInvitation = vi.hoisted(() => vi.fn());
const mockRevokeInvitation = vi.hoisted(() => vi.fn());
const mockRevokeAll = vi.hoisted(() => vi.fn());
vi.mock("@/lib/onboarding/issue", () => ({
  createInvitation: (...args: unknown[]) => mockCreateInvitation(...args),
  resendInvitation: (...args: unknown[]) => mockResendInvitation(...args),
  revokeInvitation: (...args: unknown[]) => mockRevokeInvitation(...args),
  revokeAllOpenInvitations: (...args: unknown[]) => mockRevokeAll(...args),
}));

// @/lib/onboarding/designation-holders - mocked wholesale for the same reason:
// the SQL function, the audit-in-transaction behaviour and the outcome matrix
// are proven against a real Postgres by designation-holders.db.test.ts and
// designation-revoke.db.test.ts. This file proves the revoke action's own layer.
const mockRevokeHolder = vi.hoisted(() => vi.fn());
vi.mock("@/lib/onboarding/designation-holders", () => ({
  revokeDesignationHolder: (...args: unknown[]) => mockRevokeHolder(...args),
}));

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
  provisionSiteAction,
  setSiteStatusAction,
  setOrganizationProfileAction,
  setOrganizationServiceTimesAction,
  inviteFoundingAdministratorAction,
  inviteTreasurerAction,
  resendInvitationAction,
  revokeInvitationAction,
  revokeAllInvitationsAction,
  revokeDesignationHolderAction,
} from "./actions";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { INVITATION_WARNING_COPY } from "@/lib/onboarding/invitation-copy";
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
  lightOnly: false,
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
  mockProvisionSite.mockResolvedValue({ kind: "ok" });
  mockSetSiteStatus.mockResolvedValue({ kind: "ok" });
  mockSetOrganizationProfile.mockResolvedValue({ kind: "ok" });
  mockReplaceOrganizationServiceTimes.mockResolvedValue({ kind: "ok" });
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

  it("upserts lightOnly: false when the checkbox field is absent (unchecked), never a crash on a missing field", async () => {
    await setOrganizationBrandAction(
      formData({ organizationId: VALID_ORG, seedHex: VALID_HEX, typePairing: "classic" }),
    );
    expect(mockBrandsValues).toHaveBeenCalledWith(
      expect.objectContaining({ lightOnly: false }),
    );
  });

  it("upserts lightOnly: true when the checkbox submitted \"on\"", async () => {
    await setOrganizationBrandAction(
      formData({
        organizationId: VALID_ORG,
        seedHex: VALID_HEX,
        typePairing: "classic",
        lightOnly: "on",
      }),
    );
    expect(mockBrandsValues).toHaveBeenCalledWith(
      expect.objectContaining({ lightOnly: true }),
    );
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ set: expect.objectContaining({ lightOnly: true }) }),
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

  it("still commits when ONLY lightOnly changed (same seedHex/typePairing), even alongside a rejected file — not treated as a no-op resubmit", async () => {
    const big = new File([toBlobPart(Buffer.alloc(3 * 1024 * 1024, 1))], "big.png", {
      type: "image/png",
    });
    const result = await setOrganizationBrandAction(
      formData(
        {
          organizationId: VALID_ORG,
          seedHex: EXISTING_ROW.seedHex,
          typePairing: EXISTING_ROW.typePairing,
          lightOnly: "on",
        },
        big,
      ),
    );
    expect(mockTransaction).toHaveBeenCalled();
    expect(mockBrandsValues).toHaveBeenCalledWith(
      expect.objectContaining({ lightOnly: true }),
    );
    // Partial-save phrasing, same as a colour change alongside a bad logo.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("The logo could not be stored");
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
      expect.objectContaining({ organizationId: VALID_ORG, contentType: "image/png", audience: "public_site" }),
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

// ---------------------------------------------------------------------------
// provisionSiteAction / setSiteStatusAction (docs/work-log/2026-08-20-
// public-sites.md Phase 3 "Server actions — call sites") — thin wrappers
// over @/lib/sites' provisionSite/setSiteStatus, mocked here; SQL
// correctness lives in sites.test.ts.
// ---------------------------------------------------------------------------

describe("provisionSiteAction — authorization", () => {
  it("rejects an unauthenticated caller without calling provisionSite", async () => {
    mockAuth.mockResolvedValue(null);
    const result = await provisionSiteAction(
      formData({ organizationId: VALID_ORG, repo: "presby-churches/site-alder-creek" }),
    );
    expect(result).toEqual({ ok: false, error: "Unauthorized." });
    expect(mockProvisionSite).not.toHaveBeenCalled();
  });

  it("rejects a signed-in user lacking admin.organizations", async () => {
    mockAuth.mockResolvedValue(sessionWith([FEATURES.ADMIN_DASHBOARD]));
    const result = await provisionSiteAction(
      formData({ organizationId: VALID_ORG, repo: "presby-churches/site-alder-creek" }),
    );
    expect(result).toEqual({ ok: false, error: "Forbidden." });
    expect(mockProvisionSite).not.toHaveBeenCalled();
  });

  it("rejects an invalid organizationId without calling provisionSite", async () => {
    const result = await provisionSiteAction(
      formData({ organizationId: "not-a-uuid", repo: "presby-churches/site-alder-creek" }),
    );
    expect(result).toEqual({ ok: false, error: "Invalid organization." });
    expect(mockProvisionSite).not.toHaveBeenCalled();
  });
});

describe("provisionSiteAction — result mapping", () => {
  it("passes organizationId, repo, and the acting operator's userId through", async () => {
    await provisionSiteAction(
      formData({ organizationId: VALID_ORG, repo: "presby-churches/site-alder-creek" }),
    );
    expect(mockProvisionSite).toHaveBeenCalledWith(
      VALID_ORG,
      "presby-churches/site-alder-creek",
      "operator-1",
    );
  });

  it("maps invalid_input to a client-visible error, writes no audit row", async () => {
    mockProvisionSite.mockResolvedValue({
      kind: "invalid_input",
      error: 'Enter a repo as "owner/repo".',
    });
    const result = await provisionSiteAction(
      formData({ organizationId: VALID_ORG, repo: "not-a-repo" }),
    );
    expect(result).toEqual({ ok: false, error: 'Enter a repo as "owner/repo".' });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("maps already_provisioned to a client-visible error, writes no audit row", async () => {
    mockProvisionSite.mockResolvedValue({ kind: "already_provisioned" });
    const result = await provisionSiteAction(
      formData({ organizationId: VALID_ORG, repo: "presby-churches/site-alder-creek" }),
    );
    expect(result).toEqual({
      ok: false,
      error: "This organization already has a site provisioned.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("on success, writes SITE_PROVISIONED and revalidates both admin pages", async () => {
    const result = await provisionSiteAction(
      formData({ organizationId: VALID_ORG, repo: "presby-churches/site-alder-creek" }),
    );
    expect(result).toEqual({ ok: true });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.SITE_PROVISIONED,
        resourceType: "organization",
        resourceId: VALID_ORG,
        metadata: { repo: "presby-churches/site-alder-creek" },
      }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/admin/organizations/${VALID_ORG}`);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/sites");
  });
});

describe("setSiteStatusAction — authorization", () => {
  it("rejects an unauthenticated caller without calling setSiteStatus", async () => {
    mockAuth.mockResolvedValue(null);
    const result = await setSiteStatusAction(
      formData({ organizationId: VALID_ORG, status: "suspended" }),
    );
    expect(result).toEqual({ ok: false, error: "Unauthorized." });
    expect(mockSetSiteStatus).not.toHaveBeenCalled();
  });

  it("rejects a signed-in user lacking admin.organizations", async () => {
    mockAuth.mockResolvedValue(sessionWith([FEATURES.ADMIN_DASHBOARD]));
    const result = await setSiteStatusAction(
      formData({ organizationId: VALID_ORG, status: "suspended" }),
    );
    expect(result).toEqual({ ok: false, error: "Forbidden." });
    expect(mockSetSiteStatus).not.toHaveBeenCalled();
  });
});

describe("setSiteStatusAction — input validation and result mapping", () => {
  it("rejects an invalid organizationId without calling setSiteStatus", async () => {
    const result = await setSiteStatusAction(
      formData({ organizationId: "not-a-uuid", status: "suspended" }),
    );
    expect(result).toEqual({ ok: false, error: "Invalid organization." });
    expect(mockSetSiteStatus).not.toHaveBeenCalled();
  });

  it.each(["provisioning", "", "deleted"])(
    "rejects a status outside live/suspended (%s) without calling setSiteStatus",
    async (status) => {
      const result = await setSiteStatusAction(
        formData({ organizationId: VALID_ORG, status }),
      );
      expect(result).toEqual({ ok: false, error: "Invalid status." });
      expect(mockSetSiteStatus).not.toHaveBeenCalled();
    },
  );

  it("maps not_found to a client-visible error, writes no audit row", async () => {
    mockSetSiteStatus.mockResolvedValue({ kind: "not_found" });
    const result = await setSiteStatusAction(
      formData({ organizationId: VALID_ORG, status: "suspended" }),
    );
    expect(result).toEqual({
      ok: false,
      error: "This organization has no site provisioned.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("on success (suspend), writes SITE_STATUS_CHANGED, revalidates the admin pages and the public site path", async () => {
    mockLimit.mockResolvedValue([{ slug: "alder-creek" }]);
    const result = await setSiteStatusAction(
      formData({ organizationId: VALID_ORG, status: "suspended" }),
    );
    expect(result).toEqual({ ok: true });
    expect(mockSetSiteStatus).toHaveBeenCalledWith(VALID_ORG, "suspended", "operator-1");
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.SITE_STATUS_CHANGED,
        resourceType: "organization",
        resourceId: VALID_ORG,
        metadata: { status: "suspended" },
      }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/admin/organizations/${VALID_ORG}`);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/sites");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/site/alder-creek", "layout");
  });

  it("on success (reactivate), accepts status=live", async () => {
    const result = await setSiteStatusAction(
      formData({ organizationId: VALID_ORG, status: "live" }),
    );
    expect(result).toEqual({ ok: true });
    expect(mockSetSiteStatus).toHaveBeenCalledWith(VALID_ORG, "live", "operator-1");
  });
});

// ---------------------------------------------------------------------------
// setOrganizationProfileAction / setOrganizationServiceTimesAction
// (docs/work-log/2026-08-21-public-site-org-profile.md Phase 3 "API
// Contract") — thin wrappers over @/lib/sites' setOrganizationProfile/
// replaceOrganizationServiceTimes, mocked here; SQL correctness and
// validation both live in sites.test.ts.
// ---------------------------------------------------------------------------

describe("setOrganizationProfileAction — authorization", () => {
  it("rejects an unauthenticated caller without calling setOrganizationProfile", async () => {
    mockAuth.mockResolvedValue(null);
    const result = await setOrganizationProfileAction(
      formData({ organizationId: VALID_ORG, address: "1 Fixture Way" }),
    );
    expect(result).toEqual({ ok: false, error: "Unauthorized." });
    expect(mockSetOrganizationProfile).not.toHaveBeenCalled();
  });

  it("rejects a signed-in user lacking admin.organizations", async () => {
    mockAuth.mockResolvedValue(sessionWith([FEATURES.ADMIN_DASHBOARD]));
    const result = await setOrganizationProfileAction(
      formData({ organizationId: VALID_ORG, address: "1 Fixture Way" }),
    );
    expect(result).toEqual({ ok: false, error: "Forbidden." });
    expect(mockSetOrganizationProfile).not.toHaveBeenCalled();
  });

  it("rejects an invalid organizationId without calling setOrganizationProfile", async () => {
    const result = await setOrganizationProfileAction(
      formData({ organizationId: "not-a-uuid" }),
    );
    expect(result).toEqual({ ok: false, error: "Invalid organization." });
    expect(mockSetOrganizationProfile).not.toHaveBeenCalled();
  });
});

describe("setOrganizationProfileAction — result mapping", () => {
  it("passes every field through as plain strings, empty when absent from the FormData", async () => {
    await setOrganizationProfileAction(
      formData({ organizationId: VALID_ORG, address: "1 Fixture Way", facebookUrl: "https://facebook.com/fixture" }),
    );
    expect(mockSetOrganizationProfile).toHaveBeenCalledWith(
      VALID_ORG,
      {
        address: "1 Fixture Way",
        phone: "",
        facebookUrl: "https://facebook.com/fixture",
        instagramUrl: "",
        xTwitterUrl: "",
        youtubeUrl: "",
        otherUrl: "",
      },
      "operator-1",
    );
  });

  it("maps invalid_input to a client-visible error, writes no audit row", async () => {
    mockSetOrganizationProfile.mockResolvedValue({
      kind: "invalid_input",
      error: "Enter a valid Facebook URL, or leave it blank.",
    });
    const result = await setOrganizationProfileAction(
      formData({ organizationId: VALID_ORG, facebookUrl: "not a url" }),
    );
    expect(result).toEqual({
      ok: false,
      error: "Enter a valid Facebook URL, or leave it blank.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("on success, revalidates the admin page and writes no audit row (routine content editing, DECISION-089's posture)", async () => {
    const result = await setOrganizationProfileAction(
      formData({ organizationId: VALID_ORG, address: "1 Fixture Way" }),
    );
    expect(result).toEqual({ ok: true });
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/admin/organizations/${VALID_ORG}`);
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("on success, revalidates the public site path when the site is live", async () => {
    mockLimit.mockResolvedValue([{ slug: "alder-creek", siteStatus: "live" }]);
    await setOrganizationProfileAction(
      formData({ organizationId: VALID_ORG, address: "1 Fixture Way" }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/site/alder-creek", "layout");
  });
});

describe("setOrganizationServiceTimesAction — authorization", () => {
  it("rejects an unauthenticated caller without calling replaceOrganizationServiceTimes", async () => {
    mockAuth.mockResolvedValue(null);
    const result = await setOrganizationServiceTimesAction(
      formData({ organizationId: VALID_ORG, kind: "service", rows: "[]" }),
    );
    expect(result).toEqual({ ok: false, error: "Unauthorized." });
    expect(mockReplaceOrganizationServiceTimes).not.toHaveBeenCalled();
  });

  it("rejects a signed-in user lacking admin.organizations", async () => {
    mockAuth.mockResolvedValue(sessionWith([FEATURES.ADMIN_DASHBOARD]));
    const result = await setOrganizationServiceTimesAction(
      formData({ organizationId: VALID_ORG, kind: "service", rows: "[]" }),
    );
    expect(result).toEqual({ ok: false, error: "Forbidden." });
    expect(mockReplaceOrganizationServiceTimes).not.toHaveBeenCalled();
  });

  it("rejects an invalid organizationId without calling replaceOrganizationServiceTimes", async () => {
    const result = await setOrganizationServiceTimesAction(
      formData({ organizationId: "not-a-uuid", kind: "service", rows: "[]" }),
    );
    expect(result).toEqual({ ok: false, error: "Invalid organization." });
    expect(mockReplaceOrganizationServiceTimes).not.toHaveBeenCalled();
  });
});

describe("setOrganizationServiceTimesAction — kind and rows parsing", () => {
  it.each(["", "office-hours", "worship"])(
    "rejects a kind outside service/office_hours (%s) without calling replaceOrganizationServiceTimes",
    async (kind) => {
      const result = await setOrganizationServiceTimesAction(
        formData({ organizationId: VALID_ORG, kind, rows: "[]" }),
      );
      expect(result).toEqual({ ok: false, error: "Invalid kind." });
      expect(mockReplaceOrganizationServiceTimes).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed JSON in rows without calling replaceOrganizationServiceTimes", async () => {
    const result = await setOrganizationServiceTimesAction(
      formData({ organizationId: VALID_ORG, kind: "service", rows: "not json" }),
    );
    expect(result).toEqual({ ok: false, error: "Malformed row data." });
    expect(mockReplaceOrganizationServiceTimes).not.toHaveBeenCalled();
  });

  it("rejects rows that parse to a non-array", async () => {
    const result = await setOrganizationServiceTimesAction(
      formData({ organizationId: VALID_ORG, kind: "service", rows: '{"not":"an array"}' }),
    );
    expect(result).toEqual({ ok: false, error: "Malformed row data." });
    expect(mockReplaceOrganizationServiceTimes).not.toHaveBeenCalled();
  });

  it("parses well-formed rows and passes organizationId, kind, rows, actorUserId through", async () => {
    const rows = [
      { dayOfWeek: 0, startTime: "10:15", endTime: "11:15", label: "Traditional" },
      { dayOfWeek: 0, startTime: "09:00", endTime: "10:00", label: null },
    ];
    const result = await setOrganizationServiceTimesAction(
      formData({ organizationId: VALID_ORG, kind: "service", rows: JSON.stringify(rows) }),
    );
    expect(result).toEqual({ ok: true });
    expect(mockReplaceOrganizationServiceTimes).toHaveBeenCalledWith(
      VALID_ORG,
      "service",
      rows,
      "operator-1",
    );
  });

  it("maps invalid_input to a client-visible error, writes no audit row", async () => {
    mockReplaceOrganizationServiceTimes.mockResolvedValue({
      kind: "invalid_input",
      error: "End time must be after start time (Sunday).",
    });
    const result = await setOrganizationServiceTimesAction(
      formData({
        organizationId: VALID_ORG,
        kind: "service",
        rows: JSON.stringify([{ dayOfWeek: 0, startTime: "11:00", endTime: "10:00", label: null }]),
      }),
    );
    expect(result).toEqual({
      ok: false,
      error: "End time must be after start time (Sunday).",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("an empty rows array is a legal submission (clears a kind)", async () => {
    const result = await setOrganizationServiceTimesAction(
      formData({ organizationId: VALID_ORG, kind: "office_hours", rows: "[]" }),
    );
    expect(result).toEqual({ ok: true });
    expect(mockReplaceOrganizationServiceTimes).toHaveBeenCalledWith(
      VALID_ORG,
      "office_hours",
      [],
      "operator-1",
    );
  });

  it("on success, revalidates the admin page and writes no audit row", async () => {
    const result = await setOrganizationServiceTimesAction(
      formData({ organizationId: VALID_ORG, kind: "service", rows: "[]" }),
    );
    expect(result).toEqual({ ok: true });
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/admin/organizations/${VALID_ORG}`);
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The invitation actions - docs/work-log/2026-10-21-invitations.md, Phase 3
// section 3. issue.ts is mocked wholesale (see the top of this file). This
// suite proves only the actions' own layer.
// ---------------------------------------------------------------------------

const VALID_EMAIL = "designee@example.invalid";
const VALID_INVITATION = "66666666-7777-8888-9999-000000000000";
const EXPIRES = new Date("2026-10-28T12:00:00Z");

const FA_FIELDS = { organizationId: VALID_ORG, email: VALID_EMAIL, firstName: "Marisol", lastName: "Quenby" };
const TR_FIELDS = { organizationId: VALID_ORG, email: VALID_EMAIL };
const INVITE_OK = {
  kind: "ok",
  invitationId: VALID_INVITATION,
  expiresAt: EXPIRES,
  delivery: "sent",
  selfAddressed: false,
  inviteeDisplayName: "Marisol Quenby",
};

const ALL_ACTIONS: Array<[string, (fd: FormData) => Promise<unknown>, Record<string, string>, ReturnType<typeof vi.fn>]> = [
  ["inviteFoundingAdministratorAction", inviteFoundingAdministratorAction, FA_FIELDS, mockCreateInvitation],
  ["inviteTreasurerAction", inviteTreasurerAction, TR_FIELDS, mockCreateInvitation],
  ["resendInvitationAction", resendInvitationAction, { organizationId: VALID_ORG, invitationId: VALID_INVITATION }, mockResendInvitation],
  ["revokeInvitationAction", revokeInvitationAction, { organizationId: VALID_ORG, invitationId: VALID_INVITATION }, mockRevokeInvitation],
  ["revokeAllInvitationsAction", revokeAllInvitationsAction, { organizationId: VALID_ORG, scope: "designations" }, mockRevokeAll],
];

describe.each(ALL_ACTIONS)("%s - authorization", (_name, action, fields, issueMock) => {
  it("rejects an unauthenticated caller without calling issue.ts", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await action(formData(fields))).toEqual({ ok: false, error: "Unauthorized." });
    expect(issueMock).not.toHaveBeenCalled();
  });

  it("rejects a signed-in user lacking admin.organizations", async () => {
    mockAuth.mockResolvedValue(sessionWith([FEATURES.ADMIN_DASHBOARD]));
    expect(await action(formData(fields))).toEqual({ ok: false, error: "Forbidden." });
    expect(issueMock).not.toHaveBeenCalled();
  });
});

describe("inviteFoundingAdministratorAction", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { id: "operator-1", email: "operator@example.invalid", features: [FEATURES.ADMIN_ORGANIZATIONS] } });
  });

  it.each([
    ["an invalid organizationId", { ...FA_FIELDS, organizationId: "not-a-uuid" }, "Invalid organization."],
    ["a missing email", { ...FA_FIELDS, email: "" }, "Enter a valid email address."],
    ["a malformed email", { ...FA_FIELDS, email: "nope" }, "Enter a valid email address."],
    ["a missing first name", { ...FA_FIELDS, firstName: "  " }, "Enter a first name (up to 100 characters)."],
    ["an over-long last name", { ...FA_FIELDS, lastName: "x".repeat(101) }, "Enter a last name (up to 100 characters)."],
  ])("rejects %s without calling issue.ts", async (_label, fields, error) => {
    expect(await inviteFoundingAdministratorAction(formData(fields))).toEqual({ ok: false, error });
    expect(mockCreateInvitation).not.toHaveBeenCalled();
  });

  it("normalizes the email and passes the session user as inviter (never form data)", async () => {
    mockCreateInvitation.mockResolvedValue(INVITE_OK);
    await inviteFoundingAdministratorAction(
      formData({ ...FA_FIELDS, email: "  Designee@Example.INVALID ", inviter: "forged" }),
    );
    expect(mockCreateInvitation).toHaveBeenCalledWith({
      organizationId: VALID_ORG,
      purpose: "founding_administrator",
      email: "designee@example.invalid",
      firstName: "Marisol",
      lastName: "Quenby",
      inviter: { userId: "operator-1", email: "operator@example.invalid" },
      acknowledgeDoNotContact: false,
    });
  });

  it("passes the do-not-contact acknowledgement through", async () => {
    mockCreateInvitation.mockResolvedValue(INVITE_OK);
    await inviteFoundingAdministratorAction(formData({ ...FA_FIELDS, acknowledge: "true" }));
    expect(mockCreateInvitation).toHaveBeenCalledWith(expect.objectContaining({ acknowledgeDoNotContact: true }));
  });

  it("on ok returns the contract shape, revalidates once, and writes no audit row from this file", async () => {
    mockCreateInvitation.mockResolvedValue({ ...INVITE_OK, delivery: "queued", selfAddressed: true });
    const result = await inviteFoundingAdministratorAction(formData(FA_FIELDS));
    expect(result).toEqual({
      ok: true,
      invitationId: VALID_INVITATION,
      expiresAt: EXPIRES.toISOString(),
      delivery: "queued",
      selfAddressed: true,
      inviteeDisplayName: "Marisol Quenby",
    });
    expect(mockRevalidatePath).toHaveBeenCalledTimes(1);
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/admin/organizations/${VALID_ORG}`);
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "has_holders" }, /already has someone who can manage roles/],
    [{ kind: "already_pending", invitationId: VALID_INVITATION, expired: false }, /^An invitation is already pending\. Resend or revoke it\.$/],
    [{ kind: "already_pending", invitationId: VALID_INVITATION, expired: true }, /pending and has expired/],
    [{ kind: "not_applicable" }, /does not apply/],
    [{ kind: "provisioning_incomplete" }, /baseline setup/],
    [{ kind: "totp_unavailable" }, /Two-factor sign-in is not configured/],
    [{ kind: "link_origin_unavailable" }, /public address is not configured/],
    [{ kind: "rate_limited" }, /^Too many invitations right now\. Try again later\.$/],
    [{ kind: "invalid_input", field: "email" }, /valid email/],
    [{ kind: "db_error" }, /couldn't complete that just now/],
  ])("maps %j to its copy and does not revalidate", async (result, copy) => {
    mockCreateInvitation.mockResolvedValue(result);
    const out = await inviteFoundingAdministratorAction(formData(FA_FIELDS));
    expect(out).toMatchObject({ ok: false });
    expect((out as { error: string }).error).toMatch(copy);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("never says anything about account existence, and no copy tells anyone to sign up first (C5)", async () => {
    const kinds = ["has_holders", "already_pending", "not_applicable", "provisioning_incomplete", "no_matching_person",
      "ambiguous_person", "membership_ended", "needs_acknowledgement", "totp_unavailable", "link_origin_unavailable",
      "rate_limited", "db_error"];
    for (const kind of kinds) {
      mockCreateInvitation.mockResolvedValue({ kind, invitationId: VALID_INVITATION, expired: false, reason: "do_not_contact" });
      const out = (await inviteFoundingAdministratorAction(formData(FA_FIELDS))) as { error?: string };
      expect(out.error ?? "").not.toMatch(/sign up|account (exists|did not)|no platform account|already has an account/i);
    }
  });
});

describe("inviteTreasurerAction", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { id: "operator-1", email: null, features: [FEATURES.ADMIN_ORGANIZATIONS] } });
  });

  it("rejects an invalid organizationId or email without calling issue.ts", async () => {
    expect(await inviteTreasurerAction(formData({ ...TR_FIELDS, organizationId: "x" }))).toEqual({ ok: false, error: "Invalid organization." });
    expect(await inviteTreasurerAction(formData({ ...TR_FIELDS, email: "nope" }))).toEqual({ ok: false, error: "Enter a valid email address." });
    expect(mockCreateInvitation).not.toHaveBeenCalled();
  });

  it("calls issue.ts with the treasurer purpose, no names, and the session inviter", async () => {
    mockCreateInvitation.mockResolvedValue(INVITE_OK);
    const result = await inviteTreasurerAction(formData({ ...TR_FIELDS, firstName: "ignored" }));
    expect(result).toMatchObject({ ok: true, invitationId: VALID_INVITATION });
    expect(mockCreateInvitation).toHaveBeenCalledWith({
      organizationId: VALID_ORG,
      purpose: "treasurer",
      email: VALID_EMAIL,
      inviter: { userId: "operator-1", email: null },
      acknowledgeDoNotContact: false,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/admin/organizations/${VALID_ORG}`);
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: "has_holders" }, /already has someone who can manage giving/],
    [{ kind: "not_applicable" }, /^Giving applies to congregations and new worshiping communities only\.$/],
    [{ kind: "no_matching_person" }, /^Nobody enrolled at this congregation has that email on file\. The congregation's administrator enrols them first\.$/],
    [{ kind: "ambiguous_person" }, /More than one person at this congregation has that email on file/],
    [{ kind: "membership_ended" }, /relationship with this organization has ended/],
    [{ kind: "rate_limited" }, /Too many invitations/],
    [{ kind: "db_error" }, /couldn't complete that just now/],
  ])("maps %j to its copy", async (result, copy) => {
    mockCreateInvitation.mockResolvedValue(result);
    const out = await inviteTreasurerAction(formData(TR_FIELDS));
    expect((out as { error: string }).error).toMatch(copy);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("a do-not-contact refusal carries the flag so the UI can ask for confirmation, and an acknowledged retry passes it on", async () => {
    mockCreateInvitation.mockResolvedValue({ kind: "needs_acknowledgement", reason: "do_not_contact" });
    expect(await inviteTreasurerAction(formData(TR_FIELDS))).toMatchObject({ ok: false, needsAcknowledgement: "do_not_contact" });
    mockCreateInvitation.mockResolvedValue(INVITE_OK);
    await inviteTreasurerAction(formData({ ...TR_FIELDS, acknowledge: "true" }));
    expect(mockCreateInvitation).toHaveBeenLastCalledWith(expect.objectContaining({ acknowledgeDoNotContact: true }));
  });

  // Operator ruling 2026-10-23 (person-emails): a SENT invitation to an address on a person who
  // already signs in carries a non-blocking warning. The action only maps it to a sentence.
  describe("the signed-in-address warning is a non-blocking note on a SENT invitation", () => {
    // Imported from the shared copy module, not copied: the action maps the code to this string.
    const WARNING_COPY = INVITATION_WARNING_COPY.address_on_signed_in_person;

    it.each([
      ["inviteTreasurerAction", inviteTreasurerAction, TR_FIELDS],
      ["inviteFoundingAdministratorAction", inviteFoundingAdministratorAction, FA_FIELDS],
    ] as const)("%s maps the code to its sentence, still ok:true, still revalidates", async (_name, action, fields) => {
      mockCreateInvitation.mockResolvedValue({ ...INVITE_OK, warnings: ["address_on_signed_in_person"] });
      const out = await action(formData(fields));
      expect(out).toEqual({
        ok: true,
        invitationId: VALID_INVITATION,
        expiresAt: EXPIRES.toISOString(),
        delivery: "sent",
        selfAddressed: false,
        inviteeDisplayName: "Marisol Quenby",
        warnings: [{ code: "address_on_signed_in_person", message: WARNING_COPY }],
      });
      expect(mockRevalidatePath).toHaveBeenCalledWith(`/admin/organizations/${VALID_ORG}`);
    });

    it.each([
      ["inviteTreasurerAction", inviteTreasurerAction, TR_FIELDS],
      ["inviteFoundingAdministratorAction", inviteFoundingAdministratorAction, FA_FIELDS],
    ] as const)("%s adds no `warnings` key when there is none (the result shape is unchanged)", async (_name, action, fields) => {
      mockCreateInvitation.mockResolvedValue(INVITE_OK);
      expect(await action(formData(fields))).not.toHaveProperty("warnings");
      mockCreateInvitation.mockResolvedValue({ ...INVITE_OK, warnings: [] });
      expect(await action(formData(fields))).not.toHaveProperty("warnings");
    });

    it("the copy describes the roster and the sign-in, never account existence elsewhere or any other organization", () => {
      expect(WARNING_COPY).not.toMatch(/another (congregation|organization)|exists|users?\b/i);
    });
  });
});

describe("resendInvitationAction / revokeInvitationAction / revokeAllInvitationsAction", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({ user: { id: "operator-1", email: "operator@example.invalid", features: [FEATURES.ADMIN_ORGANIZATIONS] } });
  });
  const FIELDS = { organizationId: VALID_ORG, invitationId: VALID_INVITATION };

  it("reject malformed ids without calling issue.ts", async () => {
    expect(await resendInvitationAction(formData({ ...FIELDS, invitationId: "x" }))).toEqual({ ok: false, error: "Invalid invitation." });
    expect(await revokeInvitationAction(formData({ ...FIELDS, organizationId: "x" }))).toEqual({ ok: false, error: "Invalid invitation." });
    expect(await revokeAllInvitationsAction(formData({ organizationId: "x" }))).toEqual({ ok: false, error: "Invalid organization." });
    expect(mockResendInvitation).not.toHaveBeenCalled();
    expect(mockRevokeInvitation).not.toHaveBeenCalled();
    expect(mockRevokeAll).not.toHaveBeenCalled();
  });

  it("resend passes the organization AND the invitation (the invitation must belong to the organization) and the session actor", async () => {
    mockResendInvitation.mockResolvedValue({
      kind: "ok", invitationId: "new-id", expiresAt: EXPIRES, delivery: "sent", inviteeDisplayName: "Perpetua",
    });
    const out = await resendInvitationAction(formData(FIELDS));
    expect(out).toEqual({
      ok: true, invitationId: "new-id", expiresAt: EXPIRES.toISOString(), delivery: "sent", inviteeDisplayName: "Perpetua",
    });
    expect(mockResendInvitation).toHaveBeenCalledWith({
      organizationId: VALID_ORG, invitationId: VALID_INVITATION,
      actor: { userId: "operator-1", email: "operator@example.invalid" },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/admin/organizations/${VALID_ORG}`);
  });

  it("the invitee name is passed through as given and omitted (no key) when the server derived none", async () => {
    mockCreateInvitation.mockResolvedValue({ ...INVITE_OK, inviteeDisplayName: "Perpetua" });
    expect(await inviteTreasurerAction(formData(TR_FIELDS))).toMatchObject({ ok: true, inviteeDisplayName: "Perpetua" });
    mockCreateInvitation.mockResolvedValue({ ...INVITE_OK, inviteeDisplayName: null });
    expect(await inviteTreasurerAction(formData(TR_FIELDS))).not.toHaveProperty("inviteeDisplayName");
    mockResendInvitation.mockResolvedValue({
      kind: "ok", invitationId: "new-id", expiresAt: EXPIRES, delivery: "sent", inviteeDisplayName: null,
    });
    expect(await resendInvitationAction(formData(FIELDS))).not.toHaveProperty("inviteeDisplayName");
  });

  it.each([
    [{ kind: "not_found" }, /no longer exists/],
    [{ kind: "not_open" }, /already ended/],
    [{ kind: "has_holders" }, /gained this access/],
    [{ kind: "link_origin_unavailable" }, /public address/],
    [{ kind: "rate_limited" }, /^Too many invitations right now\. Try again later\.$/],
    [{ kind: "db_error" }, /couldn't complete that just now/],
  ])("resend maps %j", async (result, copy) => {
    mockResendInvitation.mockResolvedValue(result);
    const out = await resendInvitationAction(formData(FIELDS));
    expect((out as { error: string }).error).toMatch(copy);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("revoke succeeds, revalidates, and maps each refusal", async () => {
    mockRevokeInvitation.mockResolvedValue({ kind: "ok" });
    expect(await revokeInvitationAction(formData(FIELDS))).toEqual({ ok: true, invitationId: VALID_INVITATION });
    expect(mockRevokeInvitation).toHaveBeenCalledWith({
      organizationId: VALID_ORG, invitationId: VALID_INVITATION,
      actor: { userId: "operator-1", email: "operator@example.invalid" },
    });
    expect(mockRevalidatePath).toHaveBeenCalledTimes(1);
    mockRevalidatePath.mockClear();
    mockRevokeInvitation.mockResolvedValue({ kind: "not_found" });
    expect(await revokeInvitationAction(formData(FIELDS))).toMatchObject({ ok: false, error: expect.stringMatching(/no longer exists/) });
    mockRevokeInvitation.mockResolvedValue({ kind: "not_open" });
    expect(await revokeInvitationAction(formData(FIELDS))).toMatchObject({ ok: false, error: expect.stringMatching(/already ended/) });
    mockRevokeInvitation.mockResolvedValue({ kind: "db_error" });
    expect(await revokeInvitationAction(formData(FIELDS))).toMatchObject({ ok: false, error: expect.stringMatching(/couldn't complete/) });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("revoke-all revokes the organization's open invitations within the posted scope and revalidates; a failure does not", async () => {
    mockRevokeAll.mockResolvedValue({ kind: "ok", revoked: 2 });
    expect(await revokeAllInvitationsAction(formData({ organizationId: VALID_ORG, scope: "designations" }))).toEqual({ ok: true });
    expect(mockRevokeAll).toHaveBeenCalledWith({
      organizationId: VALID_ORG,
      scope: "designations",
      actor: { userId: "operator-1", email: "operator@example.invalid" },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/admin/organizations/${VALID_ORG}`);
    mockRevalidatePath.mockClear();
    mockRevokeAll.mockResolvedValue({ kind: "db_error" });
    expect(await revokeAllInvitationsAction(formData({ organizationId: VALID_ORG, scope: "designations" }))).toMatchObject({ ok: false });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("revoke-all passes the org_sent scope through (the congregation's own sign-in invitations, F198)", async () => {
    mockRevokeAll.mockResolvedValue({ kind: "ok", revoked: 1 });
    expect(await revokeAllInvitationsAction(formData({ organizationId: VALID_ORG, scope: "org_sent" }))).toEqual({ ok: true });
    expect(mockRevokeAll).toHaveBeenCalledWith(expect.objectContaining({ scope: "org_sent" }));
  });

  it.each([
    ["missing", {}],
    ["empty", { scope: "" }],
    ["unknown", { scope: "everything" }],
    ["inherited key name", { scope: "constructor" }],
    ["wrong case", { scope: "Designations" }],
  ])("revoke-all refuses a %s scope and never calls the library (a caller cannot revoke the other origin by omission)", async (_name, extra) => {
    mockRevokeAll.mockClear();
    expect(await revokeAllInvitationsAction(formData({ organizationId: VALID_ORG, ...extra }))).toEqual({
      ok: false,
      error: "Invalid scope.",
    });
    expect(mockRevokeAll).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// revokeDesignationHolderAction - docs/work-log/2026-10-22-designation-revoke.md,
// Phase 3 "API Contract". designation-holders.ts is mocked wholesale: this suite
// proves the action's own layer (the gate, validation, the reason, the result ->
// copy mapping, revalidation, the actor, no db call).
// ---------------------------------------------------------------------------

const SUBJECT = "77777777-8888-9999-aaaa-bbbbbbbbbbbb";
const GRANT_A = "88888888-9999-aaaa-bbbb-cccccccccccc";
const GRANT_B = "99999999-aaaa-bbbb-cccc-dddddddddddd";
const GOOD_REASON = "Fixture grant left over from the first test setup.";

function revokeForm(overrides: Record<string, string | string[]> = {}): FormData {
  const fields: Record<string, string | string[]> = {
    organizationId: VALID_ORG,
    slot: "founding_administrator",
    subjectKind: "person",
    subjectId: SUBJECT,
    expectedGrantId: [GRANT_A, GRANT_B],
    reason: GOOD_REASON,
    ...overrides,
  };
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) for (const v of value) fd.append(key, v);
    else fd.set(key, value);
  }
  return fd;
}

describe("revokeDesignationHolderAction", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue({
      user: { id: "operator-1", email: "operator@example.invalid", features: [FEATURES.ADMIN_ORGANIZATIONS] },
    });
    mockRevokeHolder.mockResolvedValue({ kind: "revoked", reachedZero: false });
  });

  it("rejects an unauthenticated caller before anything else", async () => {
    mockAuth.mockResolvedValue(null);
    expect(await revokeDesignationHolderAction(revokeForm())).toEqual({ ok: false, error: "Unauthorized." });
    expect(mockRevokeHolder).not.toHaveBeenCalled();
  });

  it("rejects a signed-in user lacking admin.organizations", async () => {
    mockAuth.mockResolvedValue(sessionWith([FEATURES.ADMIN_DASHBOARD]));
    expect(await revokeDesignationHolderAction(revokeForm())).toEqual({ ok: false, error: "Forbidden." });
    expect(mockRevokeHolder).not.toHaveBeenCalled();
  });

  it.each([
    ["a malformed organization id", { organizationId: "x" }],
    ["a malformed subject id", { subjectId: "x" }],
    ["an unknown slot", { slot: "treasurer_emeritus" }],
    ["an unknown subject kind", { subjectKind: "everyone" }],
    ["no expected grant ids", { expectedGrantId: [] as string[] }],
    ["a malformed expected grant id", { expectedGrantId: [GRANT_A, "nope"] }],
    ["more than 20 expected grant ids", {
      expectedGrantId: Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
    }],
  ])("returns one neutral 'Invalid request.' for %s", async (_label, overrides) => {
    expect(await revokeDesignationHolderAction(revokeForm(overrides))).toEqual({ ok: false, error: "Invalid request." });
    expect(mockRevokeHolder).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", "", /at least 10 characters/],
    ["whitespace only", "          ", /at least 10 characters/],
    ["too short", "too short", /at least 10 characters/],
    ["a control character", "A reason with a bell \u0007 inside", /can't contain control characters/],
    ["too long", "x".repeat(501), /500 characters or fewer/],
  ])("a reason that is %s is a field error and nothing is called", async (_label, reason, copy) => {
    const out = await revokeDesignationHolderAction(revokeForm({ reason }));
    expect(out).toMatchObject({ ok: false, field: "reason" });
    expect((out as { error: string }).error).toMatch(copy);
    expect(mockRevokeHolder).not.toHaveBeenCalled();
  });

  it("counts the reason in code points: 500 emoji pass, 501 fail", async () => {
    expect(await revokeDesignationHolderAction(revokeForm({ reason: "\u{1F600}".repeat(500) }))).toEqual({ ok: true, reachedZero: false });
    mockRevokeHolder.mockClear();
    expect(await revokeDesignationHolderAction(revokeForm({ reason: "\u{1F600}".repeat(501) }))).toMatchObject({ ok: false, field: "reason" });
    expect(mockRevokeHolder).not.toHaveBeenCalled();
  });

  it("passes the trimmed reason, the ids and the SESSION actor, and revalidates once on revoked", async () => {
    mockRevokeHolder.mockResolvedValue({ kind: "revoked", reachedZero: true });
    const fd = revokeForm({ reason: `   ${GOOD_REASON}   `, slot: "treasurer" });
    // A client-supplied identity is never read.
    fd.set("userId", "attacker-1");
    fd.set("actorEmail", "attacker@example.invalid");
    fd.set("next", "https://evil.example.invalid/");
    expect(await revokeDesignationHolderAction(fd)).toEqual({ ok: true, reachedZero: true });
    expect(mockRevokeHolder).toHaveBeenCalledTimes(1);
    expect(mockRevokeHolder).toHaveBeenCalledWith({
      organizationId: VALID_ORG,
      slot: "treasurer",
      subjectKind: "person",
      subjectId: SUBJECT,
      expectedGrantIds: [GRANT_A, GRANT_B],
      reason: GOOD_REASON,
      actor: { userId: "operator-1", email: "operator@example.invalid" },
    });
    expect(mockRevalidatePath).toHaveBeenCalledTimes(1);
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/admin/organizations/${VALID_ORG}`);
  });

  it("de-duplicates repeated expected grant ids", async () => {
    await revokeDesignationHolderAction(revokeForm({ expectedGrantId: [GRANT_A, GRANT_A, GRANT_B] }));
    expect(mockRevokeHolder.mock.calls[0]![0].expectedGrantIds).toEqual([GRANT_A, GRANT_B]);
  });

  it.each([
    [{ kind: "already_removed" }, /already been removed/, true, true],
    [{ kind: "changed" }, /changed while you were looking/, true, true],
    [{ kind: "not_a_holder" }, /couldn't find that access/, true, true],
    [{ kind: "no_organization" }, /couldn't find that access/, true, false],
    [{ kind: "derived_group_refused" }, /roster comes from the organization's own officers/, false, false],
    [{ kind: "not_applicable" }, /doesn't apply to this type of organization/, false, false],
    [{ kind: "db_error" }, /couldn't complete that just now/, false, false],
  ])("maps %j to its copy (refresh=%s, revalidated=%s)", async (result, copy, refresh, revalidated) => {
    mockRevokeHolder.mockResolvedValue(result);
    const out = (await revokeDesignationHolderAction(revokeForm())) as { ok: boolean; error: string; refresh?: boolean };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(copy);
    expect(Boolean(out.refresh)).toBe(refresh);
    expect(mockRevalidatePath).toHaveBeenCalledTimes(revalidated ? 1 : 0);
  });

  it("not_a_holder and no_organization return the SAME string (no oracle on which it was)", async () => {
    mockRevokeHolder.mockResolvedValue({ kind: "not_a_holder" });
    const a = await revokeDesignationHolderAction(revokeForm());
    mockRevokeHolder.mockResolvedValue({ kind: "no_organization" });
    const b = await revokeDesignationHolderAction(revokeForm());
    expect((a as { error: string }).error).toBe((b as { error: string }).error);
  });

  it("writes no audit row from here (the library writes it in the revoke's own transaction)", async () => {
    await revokeDesignationHolderAction(revokeForm());
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
