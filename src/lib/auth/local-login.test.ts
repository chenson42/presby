/**
 * Unit tests for src/lib/auth/local-login.ts
 *
 * Two helpers under test:
 *   isLocalLoginEnabled() — fail-open DB read for the auth.local_login flag
 *   computeEffectiveTwoFactor() — short-circuiting require_2fa gate
 *
 * Mocking strategy:
 *   isLocalLoginEnabled queries the DB directly (same pattern as sign-in-gate.ts)
 *   → mock @/lib/db
 *   computeEffectiveTwoFactor delegates to isFlagEnabled
 *   → mock @/lib/flags
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @/lib/db before importing the module under test.
// The DB module throws at import time if DATABASE_URL is unset.
vi.mock("@/lib/db", () => ({
  db: {
    query: {
      featureFlags: {
        findFirst: vi.fn(),
      },
    },
    // computeEffectiveTwoFactor's per-church arm calls
    // presby_two_factor_required() through db.execute().
    execute: vi.fn(),
  },
}));

// Mock @/lib/flags for computeEffectiveTwoFactor tests.
vi.mock("@/lib/flags", () => ({
  isFlagEnabled: vi.fn(),
}));

import { isLocalLoginEnabled, computeEffectiveTwoFactor } from "./local-login";
import { db } from "@/lib/db";
import { isFlagEnabled } from "@/lib/flags";

const findFirst = db.query.featureFlags.findFirst as ReturnType<typeof vi.fn>;
const mockExecute = db.execute as unknown as ReturnType<typeof vi.fn>;

/** presby_two_factor_required() result shape. */
function orgRequires(required: boolean) {
  return { rows: [{ required }] };
}
const mockIsFlagEnabled = isFlagEnabled as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// isLocalLoginEnabled — four branches
// ---------------------------------------------------------------------------

describe("isLocalLoginEnabled", () => {
  it("row missing (undefined) → true — fail-open when flag is not seeded", async () => {
    findFirst.mockResolvedValue(undefined);

    const result = await isLocalLoginEnabled();

    expect(result).toBe(true);
  });

  it("row.enabled = true → true — admin has credentials enabled", async () => {
    findFirst.mockResolvedValue({ key: "auth.local_login", enabled: true });

    const result = await isLocalLoginEnabled();

    expect(result).toBe(true);
  });

  it("row.enabled = false → false — admin explicitly disabled credentials", async () => {
    findFirst.mockResolvedValue({ key: "auth.local_login", enabled: false });

    const result = await isLocalLoginEnabled();

    expect(result).toBe(false);
  });

  it("DB error (findFirst throws) → true — fail-open during DB blip", async () => {
    findFirst.mockRejectedValue(new Error("connection refused"));

    const result = await isLocalLoginEnabled();

    expect(result).toBe(true);
  });

  it("queries featureFlags exactly once per call", async () => {
    findFirst.mockResolvedValue(undefined);

    await isLocalLoginEnabled();

    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// computeEffectiveTwoFactor — five cases
// ---------------------------------------------------------------------------

describe("computeEffectiveTwoFactor", () => {
  it("rawRequired = false → false without reading the flag (short-circuit)", async () => {
    mockExecute.mockResolvedValue(orgRequires(false));
    const result = await computeEffectiveTwoFactor(false);

    expect(result).toBe(false);
    expect(mockIsFlagEnabled).not.toHaveBeenCalled();
  });

  it("rawRequired = true, flag ON → true — org-level gate is active", async () => {
    mockIsFlagEnabled.mockResolvedValue(true);

    const result = await computeEffectiveTwoFactor(true);

    expect(result).toBe(true);
    expect(mockIsFlagEnabled).toHaveBeenCalledWith("auth.require_2fa");
  });

  it("rawRequired = true, flag OFF → false — master switch disables enforcement", async () => {
    mockIsFlagEnabled.mockResolvedValue(false);

    const result = await computeEffectiveTwoFactor(true);

    expect(result).toBe(false);
    expect(mockIsFlagEnabled).toHaveBeenCalledWith("auth.require_2fa");
  });

  it("rawRequired = true, isFlagEnabled throws → rawRequired (pre-feature fallback)", async () => {
    mockIsFlagEnabled.mockRejectedValue(new Error("DB connection refused"));

    const result = await computeEffectiveTwoFactor(true);

    // Falls back to raw column value, NOT fail-open. This reproduces
    // pre-feature behavior: the user still gets twoFactorRequired=true during
    // a DB outage. Correct: we don't want to accidentally ungate TOTP users.
    expect(result).toBe(true);
  });

  it("rawRequired = true, flag missing (isFlagEnabled returns false) → false", async () => {
    // Standard isFlagEnabled returns false on missing row.
    // For require_2fa this is safe: missing flag = no enforcement.
    mockIsFlagEnabled.mockResolvedValue(false);

    const result = await computeEffectiveTwoFactor(true);

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeEffectiveTwoFactor — the per-church arm
//
// This is the arm F26 predicts will fail silently: presby_two_factor_required()
// runs at sign-in with no org GUC set, so if it were ever rewritten as a plain
// query, RLS would filter it to zero rows and it would return false for exactly
// the users it protects. These tests pin the behavior, not the SQL.
// ---------------------------------------------------------------------------

describe("computeEffectiveTwoFactor — per-congregation policy", () => {
  it("requires 2FA when the user's own column is false but their church requires it", async () => {
    mockExecute.mockResolvedValue(orgRequires(true));
    mockIsFlagEnabled.mockResolvedValue(true);

    const result = await computeEffectiveTwoFactor(false, "user-1");

    expect(result).toBe(true);
  });

  it("does not require 2FA when neither the user nor any church requires it", async () => {
    mockExecute.mockResolvedValue(orgRequires(false));

    const result = await computeEffectiveTwoFactor(false, "user-1");

    expect(result).toBe(false);
    // Master switch is irrelevant when nothing requires 2FA — don't read it.
    expect(mockIsFlagEnabled).not.toHaveBeenCalled();
  });

  it("skips the church lookup entirely when the user's own column already requires it", async () => {
    mockIsFlagEnabled.mockResolvedValue(true);

    const result = await computeEffectiveTwoFactor(true, "user-1");

    expect(result).toBe(true);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("the master switch still turns off a church-imposed requirement", async () => {
    mockExecute.mockResolvedValue(orgRequires(true));
    mockIsFlagEnabled.mockResolvedValue(false);

    const result = await computeEffectiveTwoFactor(false, "user-1");

    expect(result).toBe(false);
  });

  it("a database error does not newly impose 2FA — nobody gets stranded by a blip", async () => {
    mockExecute.mockRejectedValue(new Error("connection reset"));

    const result = await computeEffectiveTwoFactor(false, "user-1");

    expect(result).toBe(false);
  });

  it("without a userId, behaves exactly as before the per-church feature", async () => {
    mockIsFlagEnabled.mockResolvedValue(true);

    const result = await computeEffectiveTwoFactor(true);

    expect(result).toBe(true);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
