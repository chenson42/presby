import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { withTwoFactorGrant, takeTwoFactorGrant } = await import(
  "./two-factor-grant"
);

describe("two-factor grant", () => {
  it("is absent outside a scope", () => {
    expect(takeTwoFactorGrant("u1")).toBe(false);
  });

  it("is taken once, for the named user only, then spent", async () => {
    await withTwoFactorGrant("u1", "totp", async () => {
      expect(takeTwoFactorGrant("someone-else")).toBe(false);
      expect(takeTwoFactorGrant("u1")).toBe(true);
      expect(takeTwoFactorGrant("u1")).toBe(false);
    });
  });

  it("reaches across awaits inside the scope and ends with it", async () => {
    await withTwoFactorGrant("u1", "recovery", async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 1));
      expect(takeTwoFactorGrant("u1")).toBe(true);
    });
    expect(takeTwoFactorGrant("u1")).toBe(false);
  });

  it("does not leak between concurrent scopes", async () => {
    const results = await Promise.all([
      withTwoFactorGrant("a", "totp", async () => {
        await new Promise((r) => setTimeout(r, 5));
        return [takeTwoFactorGrant("b"), takeTwoFactorGrant("a")];
      }),
      withTwoFactorGrant("b", "totp", async () => {
        return [takeTwoFactorGrant("a"), takeTwoFactorGrant("b")];
      }),
    ]);
    expect(results).toEqual([
      [false, true],
      [false, true],
    ]);
  });
});
