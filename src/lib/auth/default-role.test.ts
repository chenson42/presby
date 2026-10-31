/**
 * ensureDefaultRole, unit level: a missing role row returns without writing
 * (the early returns survive the move out of src/auth.ts, P3-4).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const transaction = vi.fn();
const findUserRole = vi.fn();
const findRole = vi.fn();
vi.mock("@/lib/db", () => ({
  db: {
    query: { userRoles: { findFirst: findUserRole }, roles: { findFirst: findRole } },
    transaction,
  },
}));
vi.mock("@/lib/auth/platform-role-two-factor", () => ({ requireTwoFactorForPlatformRole: vi.fn() }));

describe("ensureDefaultRole early returns", () => {
  it("a user who already holds a role: no lookup of the default role, no transaction", async () => {
    const { ensureDefaultRole } = await import("./default-role");
    findUserRole.mockResolvedValueOnce({ userId: "u" });
    await ensureDefaultRole("u", "a@example.invalid", []);
    expect(findRole).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("the default role row is missing: returns without writing", async () => {
    const { ensureDefaultRole } = await import("./default-role");
    findUserRole.mockResolvedValueOnce(undefined);
    findRole.mockResolvedValueOnce(undefined);
    await ensureDefaultRole("u", "a@example.invalid", []);
    expect(transaction).not.toHaveBeenCalled();
  });
});
