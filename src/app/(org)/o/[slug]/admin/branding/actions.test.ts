/**
 * Orchestration tests for setOrgBrandAction.
 *
 * Mocked at the `@/lib/tenant-branding` boundary — same principle as
 * `admin/roles/actions.test.ts`: the SQL correctness (the `branding.manage`
 * gate, the three-step transaction ordering, the contrast-floor-enforcing
 * generator call, the E-c1/E-c2 logo discipline) is already proven by
 * `tenant-branding.test.ts` against a real Postgres connection. What this
 * file exists to pin is the CONTRACT this actions.ts layer owns and nothing
 * else does:
 *
 *   1. `organizationId` comes from a FRESH `resolveOrgContext(session.user.id,
 *      slug)` call, never from client-supplied FormData — there is no
 *      `organizationId` field anywhere in the FormData this action reads.
 *   2. `setBrand` receives `identity.personId` (a `people.id`) for
 *      authorization and `identity.userId` (a `users.id`, from
 *      `session.user.id`) for `changedBy`/`updatedBy` — never the same value
 *      for both.
 *   3. Every `SetBrandResult` kind maps to the correct `PolicyResult` shape,
 *      and `recordAudit()` fires ONLY on `{ kind: "ok" }` with a non-null
 *      `partialSaveLogoError` — never on a denial, never on a `logo_rejected`
 *      no-op, and never before the mutation succeeds (regression target: the
 *      `TENANT_BRAND_SET` audit event must never fire on a rejected input).
 *   4. `revalidatePath` fires only after `setBrand` returns `"ok"`.
 *   5. A partial-save (`partialSaveLogoError` non-null) still audits and
 *      revalidates (the colour/pairing DID commit), but returns `ok: false`
 *      with the `PARTIAL_SAVE_PREFIX`-matching copy the client form keys off.
 *
 * vi.mock() calls are hoisted before imports by Vitest's transform; every
 * mock factory referencing an outer `vi.fn()` uses `vi.hoisted()`.
 */

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
}));

const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    TENANT_BRAND_SET: "tenant.brand.set",
  },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const mockSetBrand = vi.hoisted(() => vi.fn());
vi.mock("@/lib/tenant-branding", () => ({
  setBrand: (...args: unknown[]) => mockSetBrand(...args),
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setOrgBrandAction } from "./actions";

const SESSION = {
  user: { id: "user-tenant-id-1", email: "brand-admin@example.invalid" },
};

const RESOLVED_OK = {
  kind: "ok" as const,
  org: {
    organizationId: "org-1",
    personId: "person-1",
    name: "Alder Creek Presbyterian Church",
    organizationType: "congregation" as const,
    slug: "alder-creek",
    platformStatus: "managed" as const,
  },
};

function brandFormData(
  overrides: Partial<{ seedHex: string; typePairing: string; lightOnly: boolean }> = {},
): FormData {
  const fd = new FormData();
  fd.set("seedHex", overrides.seedHex ?? "#7a1f2b");
  fd.set("typePairing", overrides.typePairing ?? "classic");
  if (overrides.lightOnly) fd.set("lightOnly", "on");
  return fd;
}

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Identity resolution — the contract this file owns
// ---------------------------------------------------------------------------

describe("identity resolution — organizationId never comes from client input", () => {
  it("not signed in returns an error without calling resolveOrgContext or setBrand", async () => {
    mockAuth.mockResolvedValueOnce(null);

    const result = await setOrgBrandAction("alder-creek", brandFormData());

    expect(result).toEqual({
      ok: false,
      error: "You must be signed in to do that.",
    });
    expect(mockResolveOrgContext).not.toHaveBeenCalled();
    expect(mockSetBrand).not.toHaveBeenCalled();
  });

  it("calls resolveOrgContext with session.user.id and the slug argument", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    mockSetBrand.mockResolvedValueOnce({
      kind: "ok",
      adjustmentCount: 0,
      partialSaveLogoError: null,
    });

    await setOrgBrandAction("alder-creek", brandFormData());

    expect(mockResolveOrgContext).toHaveBeenCalledWith(
      "user-tenant-id-1",
      "alder-creek",
    );
  });

  it("a non-'ok' resolution returns an error without calling setBrand", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce({
      kind: "forbidden",
      name: "Bramblewood Presbyterian Church",
      organizationType: "congregation",
    });

    const result = await setOrgBrandAction("bramblewood", brandFormData());

    expect(result).toEqual({
      ok: false,
      error: "You don't have access to that organization.",
    });
    expect(mockSetBrand).not.toHaveBeenCalled();
  });

  it("passes resolved personId/organizationId AND session.user.id (users.id) as the separate actorUserId — never the same value for both", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    mockSetBrand.mockResolvedValueOnce({
      kind: "ok",
      adjustmentCount: 0,
      partialSaveLogoError: null,
    });

    await setOrgBrandAction("alder-creek", brandFormData());

    // (actorPersonId, organizationId, actorUserId, input)
    expect(mockSetBrand).toHaveBeenCalledWith(
      "person-1", // resolved.org.personId — a people.id
      "org-1", // resolved.org.organizationId
      "user-tenant-id-1", // session.user.id — a users.id, NEVER personId
      {
        seedHex: "#7a1f2b",
        typePairing: "classic",
        lightOnly: false,
        logo: null,
      },
    );
  });

  it("no `organizationId` field is read off the submitted FormData at all", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    mockSetBrand.mockResolvedValueOnce({
      kind: "ok",
      adjustmentCount: 0,
      partialSaveLogoError: null,
    });

    const fd = brandFormData();
    fd.set("organizationId", "attacker-supplied-org-id");

    await setOrgBrandAction("alder-creek", fd);

    expect(mockSetBrand).toHaveBeenCalledWith(
      "person-1",
      "org-1", // the RESOLVED org, never the client-supplied "attacker-supplied-org-id"
      "user-tenant-id-1",
      expect.objectContaining({ seedHex: "#7a1f2b" }),
    );
  });
});

// ---------------------------------------------------------------------------
// setOrgBrandAction — result-kind mapping
// ---------------------------------------------------------------------------

describe("setOrgBrandAction — SetBrandResult → PolicyResult mapping", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(SESSION);
    mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
  });

  it("forbidden → ok:false, no audit, no revalidate", async () => {
    mockSetBrand.mockResolvedValueOnce({ kind: "forbidden" });

    const result = await setOrgBrandAction("alder-creek", brandFormData());

    expect(result).toEqual({
      ok: false,
      error: "You don't have permission to manage this organization's brand.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("invalid_hex → ok:false, matches the platform action's own copy, no audit", async () => {
    mockSetBrand.mockResolvedValueOnce({ kind: "invalid_hex" });

    const result = await setOrgBrandAction(
      "alder-creek",
      brandFormData({ seedHex: "not-a-colour" }),
    );

    expect(result).toEqual({
      ok: false,
      error: "Enter a colour as a 6-digit hex code, like #7a1f2b.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("invalid_pairing → ok:false, no audit", async () => {
    mockSetBrand.mockResolvedValueOnce({ kind: "invalid_pairing" });

    const result = await setOrgBrandAction(
      "alder-creek",
      brandFormData({ typePairing: "not-a-real-pairing" }),
    );

    expect(result).toEqual({
      ok: false,
      error: "Choose one of the curated type pairings.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("generation_failed → ok:false, no audit", async () => {
    mockSetBrand.mockResolvedValueOnce({ kind: "generation_failed" });

    const result = await setOrgBrandAction("alder-creek", brandFormData());

    expect(result).toEqual({
      ok: false,
      error: "That colour could not be processed. Try a different hex code.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("logo_rejected → ok:false with the message from setBrand, no audit, no revalidate (E-c2 no-op)", async () => {
    mockSetBrand.mockResolvedValueOnce({
      kind: "logo_rejected",
      message: "That doesn't look like an image we can use — upload a PNG, JPEG, or WEBP file.",
    });

    const result = await setOrgBrandAction("alder-creek", brandFormData());

    expect(result).toEqual({
      ok: false,
      error: "That doesn't look like an image we can use — upload a PNG, JPEG, or WEBP file.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("ok (no logo issue) → returns ok:true, records TENANT_BRAND_SET with full metadata, revalidates", async () => {
    mockSetBrand.mockResolvedValueOnce({
      kind: "ok",
      adjustmentCount: 2,
      partialSaveLogoError: null,
    });

    const result = await setOrgBrandAction(
      "alder-creek",
      brandFormData({ seedHex: "#7a1f2b", typePairing: "warm", lightOnly: true }),
    );

    expect(result).toEqual({ ok: true });
    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: "tenant.brand.set",
      resourceType: "organization",
      resourceId: "org-1",
      metadata: {
        seedHex: "#7a1f2b",
        typePairing: "warm",
        lightOnly: true,
        adjustmentCount: 2,
      },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/o/alder-creek/admin/branding",
    );
  });

  it("ok with partialSaveLogoError → audits and revalidates (the colour DID commit), but returns ok:false with the PARTIAL_SAVE_PREFIX copy", async () => {
    mockSetBrand.mockResolvedValueOnce({
      kind: "ok",
      adjustmentCount: 0,
      partialSaveLogoError: "That file is 3.1 MB — we can take up to 2 MB.",
    });

    const result = await setOrgBrandAction("alder-creek", brandFormData());

    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/o/alder-creek/admin/branding",
    );
    expect(result).toEqual({
      ok: false,
      error:
        "Colour and type pairing saved. The logo could not be stored: That file is 3.1 MB — we can take up to 2 MB.",
    });
  });
});
