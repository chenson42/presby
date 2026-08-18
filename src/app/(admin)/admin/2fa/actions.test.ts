import { vi, describe, it, expect, beforeEach } from "vitest";

/**
 * setOrganizationTwoFactorAction — the per-congregation 2FA policy write.
 *
 * This file replaces the old admin/2fa cookie tests. Those guarded BUG-2 for a
 * copy of the self-enrolment flow that no longer exists here; the identical
 * regression lives in (account)/account/2fa/actions.test.ts, next to the one
 * remaining implementation.
 *
 * What matters now: the action is gated (security finding M5 was four ungated
 * exports on this exact route), validates its input, uses the platform
 * connection deliberately, and writes an audit event.
 */

const mockAuth = vi.hoisted(() => vi.fn());
const mockExecute = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ rows: [{ organization_id: "org-1" }] }),
);
const mockRecordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetPlatformDb = vi.hoisted(() =>
  vi.fn(() => ({ execute: mockExecute })),
);

vi.mock("server-only", () => ({}));
vi.mock("@/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/db", () => ({ getPlatformDb: mockGetPlatformDb }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { AUDIT_ACTIONS: actual.AUDIT_ACTIONS, recordAudit: mockRecordAudit };
});

import { setOrganizationTwoFactorAction } from "./actions";
import { AUDIT_ACTIONS } from "@/lib/audit";
import { FEATURES } from "@/lib/permissions";

const VALID_ORG = "11111111-2222-3333-4444-555555555555";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

function sessionWith(features: string[]) {
  return { user: { id: "user-1", features } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue({ rows: [{ organization_id: VALID_ORG }] });
});

describe("setOrganizationTwoFactorAction — authorization", () => {
  it("rejects an unauthenticated caller without touching the database", async () => {
    mockAuth.mockResolvedValue(null);

    const result = await setOrganizationTwoFactorAction(
      formData({ organizationId: VALID_ORG, required: "true" }),
    );

    expect(result).toEqual({ ok: false, error: "Unauthorized." });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("rejects a signed-in user lacking admin.two_factor — regression for M5", async () => {
    mockAuth.mockResolvedValue(sessionWith([FEATURES.ADMIN_DASHBOARD]));

    const result = await setOrganizationTwoFactorAction(
      formData({ organizationId: VALID_ORG, required: "true" }),
    );

    expect(result).toEqual({ ok: false, error: "Forbidden." });
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});

describe("setOrganizationTwoFactorAction — input validation", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(sessionWith([FEATURES.ADMIN_TWO_FACTOR]));
  });

  it.each([
    ["missing", ""],
    ["not a uuid", "org-1"],
    ["sql-ish", "' OR 1=1 --"],
  ])("rejects an organizationId that is %s", async (_label, value) => {
    const result = await setOrganizationTwoFactorAction(
      formData({ organizationId: value, required: "true" }),
    );

    expect(result).toEqual({ ok: false, error: "Invalid organization." });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("reports a miss rather than claiming success when no row comes back", async () => {
    mockExecute.mockResolvedValue({ rows: [] });

    const result = await setOrganizationTwoFactorAction(
      formData({ organizationId: VALID_ORG, required: "true" }),
    );

    expect(result).toEqual({ ok: false, error: "Organization not found." });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});

describe("setOrganizationTwoFactorAction — the write", () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(sessionWith([FEATURES.ADMIN_TWO_FACTOR]));
  });

  it("uses the platform connection — the tenant connection would see zero orgs", async () => {
    await setOrganizationTwoFactorAction(
      formData({ organizationId: VALID_ORG, required: "true" }),
    );

    expect(mockGetPlatformDb).toHaveBeenCalled();
  });

  it("audits the change with the new value", async () => {
    await setOrganizationTwoFactorAction(
      formData({ organizationId: VALID_ORG, required: "true" }),
    );

    expect(mockRecordAudit).toHaveBeenCalledWith({
      action: AUDIT_ACTIONS.ORG_2FA_POLICY_CHANGED,
      resourceType: "organization",
      resourceId: VALID_ORG,
      metadata: { requireTwoFactor: true },
    });
  });

  it("treats anything other than the string 'true' as turning the policy off", async () => {
    await setOrganizationTwoFactorAction(
      formData({ organizationId: VALID_ORG, required: "false" }),
    );

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { requireTwoFactor: false } }),
    );
  });
});
