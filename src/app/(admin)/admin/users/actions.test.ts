/**
 * Unit tests for unlockUserAction.
 *
 * The full server action imports next/cache (revalidatePath), next-auth (auth()),
 * drizzle-orm against Neon, and server-only — all modules that cannot run in
 * Vitest's Node.js environment without mocking. vi.mock() is used here to
 * isolate the action's guard and audit logic.
 *
 * Three scenarios per the Phase 3 design:
 * 1. requireAdminUsers returns null (unauthenticated/unauthorized) → Forbidden.
 * 2. User not found → User not found.
 * 3. Valid unlock → ok:true, db.update called, recordAudit called with correct args.
 */

// vi.mock() calls are hoisted before imports by Vitest's transform.
vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
  unstable_update: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      users: { findFirst: vi.fn() },
      roles: {},
    },
    update: vi.fn(),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({ onConflictDoNothing: vi.fn() }),
    }),
    delete: vi.fn().mockReturnValue({ where: vi.fn() }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  users: {},
  roles: {},
  userRoles: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  ADMIN_ROLE: "admin",
  FEATURES: { ADMIN_USERS: "admin.users" },
  hasFeature: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: { USER_ACCOUNT_UNLOCKED: "user.account_unlocked" },
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { hasFeature } from "@/lib/permissions";
import { AUDIT_ACTIONS, recordAudit } from "@/lib/audit";
import { unlockUserAction } from "./actions";

describe("unlockUserAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore recordAudit to resolve successfully after clearAllMocks.
    vi.mocked(recordAudit).mockResolvedValue(undefined);
  });

  // ── Test 1: Guard blocks unauthenticated / unauthorized caller ───────────

  it("returns Forbidden when requireAdminUsers returns null (auth() returns null session)", async () => {
    // Arrange — no session; requireAdminUsers() will return null.
    vi.mocked(auth).mockResolvedValue(null as any);
    vi.mocked(hasFeature).mockReturnValue(false);

    // Act
    const result = await unlockUserAction({ userId: "u1" });

    // Assert
    expect(result).toEqual({ ok: false, error: "Forbidden." });
    expect(db.update).not.toHaveBeenCalled();
  });

  // ── Test 2: User not found ───────────────────────────────────────────────

  it("returns User not found when the target userId does not exist in the DB", async () => {
    // Arrange — valid admin session; user row missing.
    vi.mocked(auth).mockResolvedValue({
      user: { id: "admin-id", features: [] },
    } as any);
    vi.mocked(hasFeature).mockReturnValue(true);
    vi.mocked(db.query.users.findFirst).mockResolvedValue(undefined as any);

    // Act
    const result = await unlockUserAction({ userId: "nonexistent-id" });

    // Assert
    expect(result).toEqual({ ok: false, error: "User not found." });
    expect(db.update).not.toHaveBeenCalled();
  });

  // ── Test 3: Idempotent success + audit call ──────────────────────────────

  it("returns ok:true, calls db.update with null+0 reset, and calls recordAudit with USER_ACCOUNT_UNLOCKED", async () => {
    // Arrange — valid admin session; user exists.
    vi.mocked(auth).mockResolvedValue({
      user: { id: "admin-id", features: [] },
    } as any);
    vi.mocked(hasFeature).mockReturnValue(true);
    vi.mocked(db.query.users.findFirst).mockResolvedValue({ id: "target-id" } as any);

    const mockWhere = vi.fn().mockResolvedValue(undefined);
    const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
    vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

    // Act
    const result = await unlockUserAction({ userId: "target-id" });

    // Assert — success result
    expect(result).toEqual({ ok: true });

    // Assert — update called with idempotent null+0 reset
    expect(db.update).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledWith({ lockedUntil: null, failedLoginAttempts: 0 });

    // Assert — audit event written with correct action, resourceId, and metadata
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.USER_ACCOUNT_UNLOCKED,
        resourceType: "user",
        resourceId: "target-id",
        metadata: { clearedByAdminId: "admin-id" },
      }),
    );
  });
});
