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
}));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toggleFeatureAction } from "./actions";

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
    // No @/lib/audit mock is registered at all for this file — if the
    // action imported and called recordAudit(), the real module would load
    // (pulling in the DB client) and this test would fail/hang rather than
    // silently pass, which is the point: it proves the import doesn't exist.
    mockToggleOrgFeature.mockResolvedValueOnce({ kind: "ok" });
    await expect(
      toggleFeatureAction("alder-creek", {
        key: "org_portal.members_create",
        enabled: true,
      }),
    ).resolves.toEqual({ ok: true });
  });
});
