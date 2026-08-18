/**
 * Unit tests for retryEmailAction.
 *
 * Covers the Phase 3 test spec:
 *   1. No session → { ok: false }
 *   2. Session without admin.email_queue feature → { ok: false }
 *   3. Row with status='sent' → { ok: false, error: "Only failed rows..." }
 *   4. Row with status='failed' → UPDATE called with correct fields; { ok: true }
 *   5. Row not found → { ok: false, error: "Row not found." }
 */

// vi.mock() calls are hoisted before imports by Vitest's transform.

vi.mock("server-only", () => ({}));

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

const mockFindFirst = vi.hoisted(() => vi.fn());
const mockUpdateReturning = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockUpdateWhere = vi.hoisted(() =>
  vi.fn().mockReturnValue({ returning: mockUpdateReturning }),
);
const mockUpdateSet = vi.hoisted(() =>
  vi.fn().mockReturnValue({ where: mockUpdateWhere }),
);
const mockUpdate = vi.hoisted(() =>
  vi.fn().mockReturnValue({ set: mockUpdateSet }),
);

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      emailQueue: { findFirst: mockFindFirst },
    },
    update: mockUpdate,
  },
}));

vi.mock("@/lib/db/schema", () => ({
  emailQueue: {
    id: {},
    status: {},
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn().mockReturnValue("eq-condition"),
}));

const mockHasFeature = vi.hoisted(() => vi.fn());
vi.mock("@/lib/permissions", () => ({
  FEATURES: { ADMIN_EMAIL_QUEUE: "admin.email_queue" },
  hasFeature: mockHasFeature,
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { retryEmailAction } from "./actions";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const sessionWithFeature = {
  user: {
    id: "admin-user-id",
    email: "admin@example.com",
    features: ["admin.email_queue"],
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("retryEmailAction — auth guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-wire mocks after clearAllMocks
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
  });

  it("returns { ok: false } when there is no session", async () => {
    const { auth } = await import("@/auth");
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    mockHasFeature.mockReturnValue(false);

    const result = await retryEmailAction("some-id");
    expect(result.ok).toBe(false);
  });

  it("returns { ok: false } when session has no user id", async () => {
    const { auth } = await import("@/auth");
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue({ user: {} });
    mockHasFeature.mockReturnValue(false);

    const result = await retryEmailAction("some-id");
    expect(result.ok).toBe(false);
  });
});

describe("retryEmailAction — feature gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
  });

  it("returns { ok: false, error: 'Forbidden.' } when user lacks admin.email_queue", async () => {
    const { auth } = await import("@/auth");
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue(sessionWithFeature);
    mockHasFeature.mockReturnValue(false);

    const result = await retryEmailAction("some-id");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Forbidden.");
  });
});

describe("retryEmailAction — status guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
  });

  it("returns { ok: false } when row status is 'sent' (not retryable)", async () => {
    const { auth } = await import("@/auth");
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue(sessionWithFeature);
    mockHasFeature.mockReturnValue(true);
    mockFindFirst.mockResolvedValue({ id: "row-1", status: "sent" });

    const result = await retryEmailAction("row-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/only failed rows/i);
  });

  it("returns { ok: false } when row status is 'queued' (not retryable in V1)", async () => {
    const { auth } = await import("@/auth");
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue(sessionWithFeature);
    mockHasFeature.mockReturnValue(true);
    mockFindFirst.mockResolvedValue({ id: "row-1", status: "queued" });

    const result = await retryEmailAction("row-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/only failed rows/i);
  });

  it("returns { ok: false } when row status is 'processing'", async () => {
    const { auth } = await import("@/auth");
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue(sessionWithFeature);
    mockHasFeature.mockReturnValue(true);
    mockFindFirst.mockResolvedValue({ id: "row-1", status: "processing" });

    const result = await retryEmailAction("row-1");
    expect(result.ok).toBe(false);
  });
});

describe("retryEmailAction — successful retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
    mockUpdateReturning.mockResolvedValue([]);
  });

  it("calls db.update with status='queued', nextAttemptAt, attemptCount=0 and returns { ok: true }", async () => {
    const { auth } = await import("@/auth");
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue(sessionWithFeature);
    mockHasFeature.mockReturnValue(true);
    mockFindFirst.mockResolvedValue({ id: "row-failed", status: "failed" });

    const result = await retryEmailAction("row-failed");

    expect(result.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledOnce();

    const setArg = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg.status).toBe("queued");
    expect(setArg.attemptCount).toBe(0);
    expect(setArg.nextAttemptAt).toBeInstanceOf(Date);
  });
});

describe("retryEmailAction — row not found", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning });
    mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdate.mockReturnValue({ set: mockUpdateSet });
  });

  it("returns { ok: false, error: 'Row not found.' } when findFirst returns undefined", async () => {
    const { auth } = await import("@/auth");
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue(sessionWithFeature);
    mockHasFeature.mockReturnValue(true);
    mockFindFirst.mockResolvedValue(undefined);

    const result = await retryEmailAction("nonexistent-id");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Row not found.");
  });
});
