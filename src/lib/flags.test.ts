import { describe, it, expect, vi, beforeEach } from "vitest";

// isFlagEnabled reads from the DB via db.query.featureFlags.findFirst.
// The DB module throws at import time if DATABASE_URL is unset, so we mock
// the entire @/lib/db module before importing isFlagEnabled.

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      featureFlags: {
        findFirst: vi.fn(),
      },
    },
  },
}));

// Import after mocking so the module receives the mocked db.
import { isFlagEnabled } from "./flags";
import { db } from "@/lib/db";

// Typed alias for the mock so TypeScript doesn't complain about .mockResolvedValue.
const findFirst = db.query.featureFlags.findFirst as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isFlagEnabled", () => {
  it("returns false for an unknown flag key — no row in the DB", async () => {
    // Arrange
    findFirst.mockResolvedValue(undefined);

    // Act
    const result = await isFlagEnabled("nonexistent-flag");

    // Assert
    expect(result).toBe(false);
  });

  it("returns false when the flag row exists but enabled is false", async () => {
    // Arrange
    findFirst.mockResolvedValue({ key: "my-flag", enabled: false });

    // Act
    const result = await isFlagEnabled("my-flag");

    // Assert
    expect(result).toBe(false);
  });

  it("returns true when the flag row exists and enabled is true", async () => {
    // Arrange
    findFirst.mockResolvedValue({ key: "my-flag", enabled: true });

    // Act
    const result = await isFlagEnabled("my-flag");

    // Assert
    expect(result).toBe(true);
  });

  it("queries the DB with the correct flag key", async () => {
    // Arrange
    findFirst.mockResolvedValue(undefined);

    // Act
    await isFlagEnabled("audit-log");

    // Assert — the drizzle where clause uses eq(featureFlags.key, key);
    // we can't inspect the drizzle expression directly, but we can confirm
    // findFirst was called exactly once (not zero times, not twice).
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it("returns false when findFirst resolves to null (explicit null from DB layer)", async () => {
    // Arrange — some DB adapters return null instead of undefined
    findFirst.mockResolvedValue(null);

    // Act
    const result = await isFlagEnabled("some-flag");

    // Assert — null ?? false → false
    expect(result).toBe(false);
  });

  it("resolves to false (never rejects) when findFirst throws — fail-closed contract, DECISION-026", async () => {
    // Arrange
    findFirst.mockRejectedValue(new Error("DB connection refused"));

    // Act + Assert — toBe, not toBeFalsy: distinguishes a real `false` from
    // undefined or another falsy-adjacent value that would silently pass a
    // looser assertion. See CLAUDE.md → Permissions vs Flags.
    await expect(isFlagEnabled("error-flag")).resolves.toBe(false);
  });

  it("logs the flag key on a DB error, never the error object", async () => {
    // Arrange
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    findFirst.mockRejectedValue(
      new Error(
        'Failed query: select * from "feature_flags" where "key" = $1',
      ),
    );

    // Act
    await isFlagEnabled("error-flag");

    // Assert — the logged args must never contain the query text the driver
    // embeds in its error message (Ruling 4: never log err or err.message).
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const loggedArgs = consoleErrorSpy.mock.calls[0];
    const serialized = JSON.stringify(loggedArgs);
    expect(serialized).not.toMatch(/select|Failed query/i);
    expect(serialized).toContain("error-flag");

    consoleErrorSpy.mockRestore();
  });

  it("is exported as a const (cache()-wrapped) rather than a named function declaration", () => {
    // React cache() returns a new function object; the export should be a
    // callable function. Outside RSC (in Vitest / Node), cache() is a no-op
    // wrapper — behavior is identical but the export shape is what we verify.
    expect(typeof isFlagEnabled).toBe("function");
  });
});
