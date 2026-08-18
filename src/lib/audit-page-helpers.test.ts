/**
 * Unit tests for src/lib/audit-page-helpers.ts
 *
 * The three input-guard helpers (validateAuditAction, clampPage, truncateActor)
 * are pure functions — no DB, no auth, no request context.  All 13 cases from
 * the Phase 3 design table are covered below.
 *
 * vi.mock("server-only") is required because audit-page-helpers.ts imports
 * from @/lib/audit, which declares `import "server-only"`.  The guard is a
 * build-time bundler signal only; mocking it prevents the (optional) runtime
 * throw in test environments that enforce it.
 *
 * The remaining mocks match audit.test.ts: they stub the server-only modules
 * that audit.ts imports so the module graph resolves cleanly without a running
 * Next.js server or database connection.
 */

vi.mock("server-only", () => ({}));

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { insert: vi.fn().mockReturnValue({ values: vi.fn() }) },
}));
vi.mock("@/lib/db/schema", () => ({ auditEvents: {} }));
vi.mock("@/lib/request-ip", () => ({ getRequestIp: vi.fn() }));

import { describe, it, expect, vi } from "vitest";
import {
  validateAuditAction,
  clampPage,
  truncateActor,
} from "./audit-page-helpers";

// ---------------------------------------------------------------------------
// validateAuditAction — 4 cases
// ---------------------------------------------------------------------------

describe("validateAuditAction", () => {
  it("returns undefined when value is undefined", () => {
    expect(validateAuditAction(undefined)).toBeUndefined();
  });

  it("returns the typed action when value is a valid AUDIT_ACTIONS string", () => {
    expect(validateAuditAction("feature_flag.toggled")).toBe(
      "feature_flag.toggled",
    );
  });

  it("returns undefined when value is not in the AUDIT_ACTIONS catalog", () => {
    expect(validateAuditAction("injected.value")).toBeUndefined();
  });

  it("returns undefined when value is an empty string", () => {
    expect(validateAuditAction("")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// clampPage — 5 cases
// ---------------------------------------------------------------------------

describe("clampPage", () => {
  it("returns 1 when value is undefined", () => {
    expect(clampPage(undefined)).toBe(1);
  });

  it("returns 1 when value is not a number", () => {
    expect(clampPage("abc")).toBe(1);
  });

  it("returns 1 when value is negative", () => {
    expect(clampPage("-5")).toBe(1);
  });

  it("returns 1 when value is zero", () => {
    expect(clampPage("0")).toBe(1);
  });

  it("returns the parsed integer when value is a valid positive integer", () => {
    expect(clampPage("3")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// truncateActor — 4 cases
// ---------------------------------------------------------------------------

describe("truncateActor", () => {
  it("returns undefined when value is undefined", () => {
    expect(truncateActor(undefined)).toBeUndefined();
  });

  it("returns undefined when value is an empty string", () => {
    expect(truncateActor("")).toBeUndefined();
  });

  it("truncates to 256 characters when the string exceeds the limit", () => {
    const long = "x".repeat(300);
    expect(truncateActor(long)).toBe("x".repeat(256));
  });

  it("returns the string unchanged when it is within the 256-character limit", () => {
    expect(truncateActor("alice@example.com")).toBe("alice@example.com");
  });
});
