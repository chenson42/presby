// vi.mock() calls are hoisted before imports by Vitest's transform. Mirrors
// `[id]/actions.test.ts`'s own harness shape: mock everything this action
// touches except pure application logic (`@/lib/reserved-slugs` — a plain
// Set lookup with no DB, used for real here).

vi.mock("server-only", () => ({}));

const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

const mockRevalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidatePath }));

// @/lib/db is mocked here (unused by this action directly) SOLELY because
// @/lib/audit's own top-level `import { db } from "@/lib/db"` would
// otherwise reach @/lib/db's real module-scope pool construction — which
// throws on a missing DATABASE_URL — the moment vi.importActual below loads
// the real audit.ts to grab AUDIT_ACTIONS. Same root cause [id]/actions.test.ts
// already works around by mocking @/lib/db wholesale.
vi.mock("@/lib/db", () => ({ db: {}, getPlatformDb: vi.fn() }));

const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>(
    "@/lib/audit",
  );
  return { AUDIT_ACTIONS: actual.AUDIT_ACTIONS, recordAudit: mockRecordAudit };
});

// SQL correctness of createOrganization() is proven by
// org-provisioning.test.ts against a real Postgres connection — this file's
// own mock has no DB behind it, so createOrganization is mocked wholesale,
// same principle as [id]/actions.test.ts mocking @/lib/sites wholesale.
const mockCreateOrganization = vi.hoisted(() => vi.fn());
vi.mock("@/lib/org-provisioning", () => ({
  createOrganization: (...args: unknown[]) => mockCreateOrganization(...args),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOrganizationAction } from "./actions";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { FEATURES } from "@/lib/permissions";

function sessionWith(features: string[]) {
  return { user: { id: "operator-1", features } };
}

const ADMIN_SESSION = sessionWith([FEATURES.ADMIN_ORGANIZATIONS]);

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const VALID_FIELDS = {
  name: "First Presbyterian Church of Anytown",
  slug: "first-pres-anytown",
  organizationType: "congregation",
  platformStatus: "managed",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(ADMIN_SESSION);
  mockCreateOrganization.mockResolvedValue({
    kind: "ok",
    organizationId: "aaaaaaaa-0000-0000-0000-000000000000",
  });
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe("createOrganizationAction — authorization", () => {
  it("rejects an unauthenticated caller without calling createOrganization", async () => {
    mockAuth.mockResolvedValue(null);
    const result = await createOrganizationAction(formData(VALID_FIELDS));
    expect(result).toEqual({ ok: false, error: "Unauthorized." });
    expect(mockCreateOrganization).not.toHaveBeenCalled();
  });

  it("rejects a signed-in user lacking admin.organizations", async () => {
    mockAuth.mockResolvedValue(sessionWith([FEATURES.ADMIN_DASHBOARD]));
    const result = await createOrganizationAction(formData(VALID_FIELDS));
    expect(result).toEqual({ ok: false, error: "Forbidden." });
    expect(mockCreateOrganization).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Field-shape validation — owned by this action, per Phase 3's division of
// labor ("the action validates shape, the library validates against the
// database"). None of these should ever reach createOrganization().
// ---------------------------------------------------------------------------

describe("createOrganizationAction — input validation", () => {
  it("rejects an empty name", async () => {
    const result = await createOrganizationAction(
      formData({ ...VALID_FIELDS, name: "   " }),
    );
    expect(result).toEqual({
      ok: false,
      error: "Enter an organization name.",
    });
    expect(mockCreateOrganization).not.toHaveBeenCalled();
  });

  it("rejects a name over 200 characters", async () => {
    const result = await createOrganizationAction(
      formData({ ...VALID_FIELDS, name: "a".repeat(201) }),
    );
    expect(result).toEqual({
      ok: false,
      error: "That name is too long — keep it under 200 characters.",
    });
    expect(mockCreateOrganization).not.toHaveBeenCalled();
  });

  it("accepts a name at exactly 200 characters", async () => {
    const result = await createOrganizationAction(
      formData({ ...VALID_FIELDS, name: "a".repeat(200) }),
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    ["uppercase letters", "FPCW"],
    ["a leading hyphen", "-fpcw"],
    ["a trailing hyphen", "fpcw-"],
    ["a space", "first pres"],
    ["an underscore", "first_pres"],
    ["empty string", ""],
  ])("rejects a malformed slug (%s)", async (_label, slug) => {
    const result = await createOrganizationAction(
      formData({ ...VALID_FIELDS, slug }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/lowercase letters, numbers, and hyphens/);
    }
    expect(mockCreateOrganization).not.toHaveBeenCalled();
  });

  it("rejects an invalid organizationType", async () => {
    const result = await createOrganizationAction(
      formData({ ...VALID_FIELDS, organizationType: "diocese" }),
    );
    expect(result).toEqual({
      ok: false,
      error: "Choose a valid organization type.",
    });
    expect(mockCreateOrganization).not.toHaveBeenCalled();
  });

  it("rejects an invalid platformStatus", async () => {
    const result = await createOrganizationAction(
      formData({ ...VALID_FIELDS, platformStatus: "active" }),
    );
    expect(result).toEqual({
      ok: false,
      error: "Choose a valid platform status.",
    });
    expect(mockCreateOrganization).not.toHaveBeenCalled();
  });

  it("rejects a reserved slug before ever calling createOrganization", async () => {
    const result = await createOrganizationAction(
      formData({ ...VALID_FIELDS, slug: "admin" }),
    );
    expect(result).toEqual({
      ok: false,
      error: "That slug is reserved for platform use — choose another.",
    });
    expect(mockCreateOrganization).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createOrganization() result mapping
// ---------------------------------------------------------------------------

describe("createOrganizationAction — result mapping", () => {
  it("maps ok: audits ORG_CREATED with the new org id, revalidates, returns organizationId", async () => {
    mockCreateOrganization.mockResolvedValue({
      kind: "ok",
      organizationId: "bbbbbbbb-1111-1111-1111-111111111111",
    });
    const result = await createOrganizationAction(formData(VALID_FIELDS));
    expect(result).toEqual({
      ok: true,
      organizationId: "bbbbbbbb-1111-1111-1111-111111111111",
    });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.ORG_CREATED,
        resourceType: "organization",
        resourceId: "bbbbbbbb-1111-1111-1111-111111111111",
        metadata: expect.objectContaining({
          name: VALID_FIELDS.name,
          slug: VALID_FIELDS.slug,
        }),
      }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/organizations");
  });

  it("maps slug_taken to the specific inline copy, writes no audit event", async () => {
    mockCreateOrganization.mockResolvedValue({ kind: "slug_taken" });
    const result = await createOrganizationAction(formData(VALID_FIELDS));
    expect(result).toEqual({
      ok: false,
      error: "That slug is already taken — choose another.",
    });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("maps reserved_slug (belt-and-suspenders) to the reserved-slug copy", async () => {
    mockCreateOrganization.mockResolvedValue({ kind: "reserved_slug" });
    const result = await createOrganizationAction(formData(VALID_FIELDS));
    expect(result).toEqual({
      ok: false,
      error: "That slug is reserved for platform use — choose another.",
    });
  });

  it("maps provisioning_incomplete to an infra-problem message, distinct from a typo", async () => {
    mockCreateOrganization.mockResolvedValue({
      kind: "provisioning_incomplete",
    });
    const result = await createOrganizationAction(formData(VALID_FIELDS));
    expect(result).toEqual({
      ok: false,
      error:
        "We can't create organizations right now — platform setup is incomplete. Contact an engineer.",
    });
  });

  it("passes an invalid_input error string through unchanged", async () => {
    mockCreateOrganization.mockResolvedValue({
      kind: "invalid_input",
      error: "Some library-level validation message.",
    });
    const result = await createOrganizationAction(formData(VALID_FIELDS));
    expect(result).toEqual({
      ok: false,
      error: "Some library-level validation message.",
    });
  });

  it("returns a generic message if createOrganization throws, never a raw exception", async () => {
    mockCreateOrganization.mockRejectedValue(new Error("connection reset"));
    const result = await createOrganizationAction(formData(VALID_FIELDS));
    expect(result).toEqual({
      ok: false,
      error:
        "We couldn't create that organization right now — try again in a moment.",
    });
  });
});
