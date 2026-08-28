/**
 * Orchestration tests for `toggleFeatureAction`. Mocked at the
 * `@/lib/org-features` boundary — same principle as `admin/roles/
 * actions.test.ts`: `toggleOrgFeature()`'s own SQL correctness (and its own
 * `recordAudit()` call — see this action's header comment) is proven by
 * `org-features.test.ts` against a real Postgres connection.
 */

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockResolveOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({
  resolveOrgContext: (...args: unknown[]) => mockResolveOrgContext(...args),
}));

const mockToggleOrgFeature = vi.hoisted(() => vi.fn());
vi.mock("@/lib/org-features", () => ({
  toggleOrgFeature: (...args: unknown[]) => mockToggleOrgFeature(...args),
  // toggleFeatureCategoryAction's affectedFeatureKeys computation reads this
  // directly — a real, small catalog fixture, not a mock function, since it
  // is filtered/mapped over synchronously.
  ORG_FEATURE_CATALOG: [
    { key: "org_portal.members_create", name: "x", description: "x", category: "people" },
    { key: "org_portal.sensitive_info", name: "x", description: "x", category: "people" },
  ],
}));

const mockToggleOrgFeatureCategory = vi.hoisted(() => vi.fn());
vi.mock("@/lib/org-feature-categories", () => ({
  toggleOrgFeatureCategory: (...args: unknown[]) =>
    mockToggleOrgFeatureCategory(...args),
}));

const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    ORG_FEATURE_CATEGORY_TOGGLED: "tenant.org_feature_category.toggled",
  },
  recordAudit: (...args: unknown[]) => mockRecordAudit(...args),
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toggleFeatureAction, toggleFeatureCategoryAction } from "./actions";

const SESSION = { user: { id: "user-1", email: "clerk@example.invalid" } };
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

afterEach(() => {
  vi.clearAllMocks();
});

describe("toggleFeatureAction — identity resolution", () => {
  it("not signed in returns an error without calling resolveOrgContext", async () => {
    mockAuth.mockResolvedValueOnce(null);

    const result = await toggleFeatureAction("alder-creek", {
      key: "org_portal.members_create",
      enabled: true,
    });

    expect(result).toEqual({
      ok: false,
      error: "You must be signed in to do that.",
    });
    expect(mockResolveOrgContext).not.toHaveBeenCalled();
    expect(mockToggleOrgFeature).not.toHaveBeenCalled();
  });

  it("a non-'ok' resolution returns an error without calling toggleOrgFeature", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce({ kind: "forbidden" });

    const result = await toggleFeatureAction("alder-creek", {
      key: "org_portal.members_create",
      enabled: true,
    });

    expect(result).toEqual({
      ok: false,
      error: "You don't have access to that organization.",
    });
    expect(mockToggleOrgFeature).not.toHaveBeenCalled();
  });

  it("passes resolved personId/organizationId AND session.user.id (users.id) to toggleOrgFeature", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    mockToggleOrgFeature.mockResolvedValueOnce({ kind: "ok" });

    await toggleFeatureAction("alder-creek", {
      key: "org_portal.members_create",
      enabled: true,
    });

    expect(mockToggleOrgFeature).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "user-1",
      "org_portal.members_create",
      true,
    );
  });
});

describe("toggleFeatureAction — ToggleOrgFeatureResult mapping", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(SESSION);
    mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
  });

  it("forbidden → ok:false, no revalidate", async () => {
    mockToggleOrgFeature.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await toggleFeatureAction("alder-creek", {
      key: "org_portal.members_create",
      enabled: true,
    });
    expect(result.ok).toBe(false);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("invalid_key → ok:false", async () => {
    mockToggleOrgFeature.mockResolvedValueOnce({ kind: "invalid_key" });
    const result = await toggleFeatureAction("alder-creek", {
      key: "not.a.real.key",
      enabled: true,
    });
    expect(result).toEqual({ ok: false, error: "That feature doesn't exist." });
  });

  it("ok → returns ok:true and revalidates the features page", async () => {
    mockToggleOrgFeature.mockResolvedValueOnce({ kind: "ok" });
    const result = await toggleFeatureAction("alder-creek", {
      key: "org_portal.members_create",
      enabled: false,
    });
    expect(result).toEqual({ ok: true });
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/o/alder-creek/admin/features",
    );
  });

  it("does NOT call recordAudit — that already happened inside toggleOrgFeature()", async () => {
    // @/lib/audit IS now mocked in this file (toggleFeatureCategoryAction's
    // own tests below need it), so this test proves the negative directly
    // against the mock rather than by relying on the real module failing to
    // load — toggleFeatureAction's own header comment states why it must
    // never call recordAudit a second time.
    mockToggleOrgFeature.mockResolvedValueOnce({ kind: "ok" });
    await expect(
      toggleFeatureAction("alder-creek", {
        key: "org_portal.members_create",
        enabled: true,
      }),
    ).resolves.toEqual({ ok: true });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});

describe("toggleFeatureCategoryAction — identity resolution", () => {
  it("not signed in returns an error without calling resolveOrgContext", async () => {
    mockAuth.mockResolvedValueOnce(null);

    const result = await toggleFeatureCategoryAction("alder-creek", {
      category: "people",
      enabled: true,
    });

    expect(result).toEqual({
      ok: false,
      error: "You must be signed in to do that.",
    });
    expect(mockResolveOrgContext).not.toHaveBeenCalled();
    expect(mockToggleOrgFeatureCategory).not.toHaveBeenCalled();
  });

  it("a non-'ok' resolution returns an error without calling toggleOrgFeatureCategory", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce({ kind: "forbidden" });

    const result = await toggleFeatureCategoryAction("alder-creek", {
      category: "people",
      enabled: true,
    });

    expect(result).toEqual({
      ok: false,
      error: "You don't have access to that organization.",
    });
    expect(mockToggleOrgFeatureCategory).not.toHaveBeenCalled();
  });

  it("passes resolved personId/organizationId AND session.user.id (users.id) to toggleOrgFeatureCategory", async () => {
    mockAuth.mockResolvedValueOnce(SESSION);
    mockResolveOrgContext.mockResolvedValueOnce(RESOLVED_OK);
    mockToggleOrgFeatureCategory.mockResolvedValueOnce({ kind: "ok" });

    await toggleFeatureCategoryAction("alder-creek", {
      category: "people",
      enabled: true,
    });

    expect(mockToggleOrgFeatureCategory).toHaveBeenCalledWith(
      "person-1",
      "org-1",
      "user-1",
      "people",
      true,
    );
  });
});

describe("toggleFeatureCategoryAction — ToggleOrgFeatureCategoryResult mapping", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(SESSION);
    mockResolveOrgContext.mockResolvedValue(RESOLVED_OK);
  });

  it("forbidden → ok:false, no revalidate, no audit", async () => {
    mockToggleOrgFeatureCategory.mockResolvedValueOnce({ kind: "forbidden" });
    const result = await toggleFeatureCategoryAction("alder-creek", {
      category: "people",
      enabled: true,
    });
    expect(result.ok).toBe(false);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("invalid_category → ok:false, no audit", async () => {
    mockToggleOrgFeatureCategory.mockResolvedValueOnce({
      kind: "invalid_category",
    });
    const result = await toggleFeatureCategoryAction("alder-creek", {
      category: "administration",
      enabled: true,
    });
    expect(result).toEqual({ ok: false, error: "That category doesn't exist." });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("ok → returns ok:true, revalidates, and audits with every affected feature key named", async () => {
    mockToggleOrgFeatureCategory.mockResolvedValueOnce({ kind: "ok" });
    const result = await toggleFeatureCategoryAction("alder-creek", {
      category: "people",
      enabled: false,
    });
    expect(result).toEqual({ ok: true });
    expect(mockRevalidatePath).toHaveBeenCalledWith(
      "/o/alder-creek/admin/features",
    );
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tenant.org_feature_category.toggled",
        resourceType: "organization_feature_category",
        resourceId: "people",
        metadata: {
          organizationId: "org-1",
          category: "people",
          enabled: false,
          // Both fixture ORG_FEATURE_CATALOG.people entries — never one
          // opaque "category changed" event (architect's Phase 2 conditional
          // approval of reusing org_features.manage for this mutation).
          affectedFeatureKeys: [
            "org_portal.members_create",
            "org_portal.sensitive_info",
          ],
        },
      }),
    );
  });

  it("ok with a category that has zero catalog entries → affectedFeatureKeys is an accurate empty array", async () => {
    mockToggleOrgFeatureCategory.mockResolvedValueOnce({ kind: "ok" });
    await toggleFeatureCategoryAction("alder-creek", {
      category: "worship",
      enabled: true,
    });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ affectedFeatureKeys: [] }),
      }),
    );
  });

  it("does NOT call recordAudit when toggleOrgFeatureCategory rejects the write", async () => {
    mockToggleOrgFeatureCategory.mockResolvedValueOnce({ kind: "forbidden" });
    await toggleFeatureCategoryAction("alder-creek", {
      category: "people",
      enabled: true,
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
