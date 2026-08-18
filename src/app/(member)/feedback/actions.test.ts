// vi.mock() calls are hoisted before imports by Vitest's transform.
// All mocks must be declared before any import statements.

vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// auth() mock
// ---------------------------------------------------------------------------
const mockAuth = vi.hoisted(() => vi.fn());
vi.mock("@/auth", () => ({ auth: mockAuth }));

// ---------------------------------------------------------------------------
// checkRateLimit mock (default: allowed)
// ---------------------------------------------------------------------------
const mockCheckRateLimit = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ allowed: true }),
);
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));

// ---------------------------------------------------------------------------
// enqueueEmail mock
// ---------------------------------------------------------------------------
const mockEnqueueEmail = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ id: "queued-email-id", sentInline: false }),
);
vi.mock("@/lib/email", () => ({ enqueueEmail: mockEnqueueEmail }));

// escapeHtml: passthrough in tests (XSS correctness is tested separately in escape-html.test.ts)
vi.mock("@/lib/email/escape-html", () => ({
  escapeHtml: (s: string) => s,
}));

// ---------------------------------------------------------------------------
// Drizzle db mock — chainable insert, update, select, query
// ---------------------------------------------------------------------------

// Insert chain:
//   db.insert(t).values({}) → { returning: fn, onConflictDoUpdate: fn }
const mockOnConflictDoUpdate = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
const mockReturning = vi.hoisted(() =>
  vi.fn().mockResolvedValue([{ id: "new-feedback-row-id" }]),
);
const mockInsertValues = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    returning: mockReturning,
    onConflictDoUpdate: mockOnConflictDoUpdate,
  }),
);
const mockInsert = vi.hoisted(() =>
  vi.fn().mockReturnValue({ values: mockInsertValues }),
);

// Update chain:
//   db.update(t).set({}).where(cond) → Promise<void>
const mockUpdateWhere = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockUpdateSet = vi.hoisted(() =>
  vi.fn().mockReturnValue({ where: mockUpdateWhere }),
);
const mockUpdate = vi.hoisted(() =>
  vi.fn().mockReturnValue({ set: mockUpdateSet }),
);

// Select chain (used for admin notification recipient query):
//   db.select({}).from(t).innerJoin().innerJoin().where() → Promise<[]>
const mockSelectWhere = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockSelectInnerJoin2 = vi.hoisted(() =>
  vi.fn().mockReturnValue({ where: mockSelectWhere }),
);
const mockSelectInnerJoin1 = vi.hoisted(() =>
  vi.fn().mockReturnValue({ innerJoin: mockSelectInnerJoin2 }),
);
const mockSelectFrom = vi.hoisted(() =>
  vi.fn().mockReturnValue({ innerJoin: mockSelectInnerJoin1 }),
);
const mockSelect = vi.hoisted(() =>
  vi.fn().mockReturnValue({ from: mockSelectFrom }),
);

// Query API (used by updateFeedbackStatus to fetch current status):
//   db.query.feedback.findFirst({ where, columns }) → Promise<Row | undefined>
const mockFeedbackFindFirst = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    insert: mockInsert,
    update: mockUpdate,
    select: mockSelect,
    query: {
      feedback: { findFirst: mockFeedbackFindFirst },
    },
  },
}));

// ---------------------------------------------------------------------------
// Schema mock — minimal column stubs for Drizzle table references
// ---------------------------------------------------------------------------
vi.mock("@/lib/db/schema", () => ({
  feedback: {
    id: { name: "id" },
    userId: { name: "user_id" },
    category: { name: "category" },
    body: { name: "body" },
    contextPath: { name: "context_path" },
    appVersion: { name: "app_version" },
    status: { name: "status" },
  },
  feedbackPromptState: {
    userId: { name: "user_id" },
    optedOut: { name: "opted_out" },
    lastSnoozedDate: { name: "last_snoozed_date" },
    lastSubmittedDate: { name: "last_submitted_date" },
  },
  users: {
    email: { name: "email" },
    name: { name: "name" },
    id: { name: "id" },
  },
  userRoles: {
    userId: { name: "user_id" },
    roleId: { name: "role_id" },
  },
  roles: {
    id: { name: "id" },
    name: { name: "name" },
  },
}));

// ---------------------------------------------------------------------------
// Permissions mock
// ---------------------------------------------------------------------------
const mockHasFeature = vi.hoisted(() => vi.fn().mockReturnValue(true));
vi.mock("@/lib/permissions", () => ({
  FEATURES: { ADMIN_FEEDBACK: "admin.feedback" },
  ADMIN_ROLE: "admin",
  hasFeature: mockHasFeature,
}));

// ---------------------------------------------------------------------------
// drizzle-orm mock — pass through real sql; stub eq to a sentinel
// ---------------------------------------------------------------------------
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn().mockReturnValue("eq-condition"),
  };
});

// ---------------------------------------------------------------------------
// Import modules under test (after all vi.mock() declarations)
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach } from "vitest";
// computeLocalDate is in date-utils.ts (extracted from actions.ts because Next.js 16
// Turbopack requires all "use server" exports to be async Server Actions).
import { computeLocalDate } from "./date-utils";
import {
  submitFeedback,
  snoozeFeedbackPrompt,
  setFeedbackOptOut,
} from "./actions";
import { updateFeedbackStatus } from "../../(admin)/admin/feedback/actions";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SESSION_MEMBER = {
  user: {
    id: "user-member-123",
    email: "member@example.com",
    name: "Test Member",
  },
};

const SESSION_ADMIN = {
  user: {
    id: "user-admin-456",
    email: "admin@example.com",
    name: "Test Admin",
    features: ["admin.feedback"],
  },
};

// ---------------------------------------------------------------------------
// computeLocalDate — pure function, no mocks needed
// ---------------------------------------------------------------------------

describe("computeLocalDate — TZ offset to YYYY-MM-DD (DECISION-023)", () => {
  it("offset=0 returns UTC date", () => {
    const result = computeLocalDate(0);
    const expected = new Date().toISOString().slice(0, 10);
    expect(result).toBe(expected);
  });

  it("null falls back to UTC (same as offset=0)", () => {
    // Both should produce the same string within the same tick.
    expect(computeLocalDate(null)).toBe(computeLocalDate(0));
  });

  it("undefined falls back to UTC (same as offset=0)", () => {
    expect(computeLocalDate(undefined)).toBe(computeLocalDate(0));
  });

  it("offset=9999 is clamped to 840 (UTC+14 maximum)", () => {
    // After clamping, result equals computeLocalDate(840)
    expect(computeLocalDate(9999)).toBe(computeLocalDate(840));
  });

  it("offset=-9999 is clamped to -720 (UTC-12 minimum)", () => {
    expect(computeLocalDate(-9999)).toBe(computeLocalDate(-720));
  });

  it("offset=300 (UTC-5) produces a date 5 hours behind UTC", () => {
    // The returned date should be at most 1 day behind the UTC date.
    const utcDate = computeLocalDate(0);
    const localDate = computeLocalDate(300);
    // Both must be a valid YYYY-MM-DD string
    expect(localDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // localDate cannot be in the future relative to UTC
    expect(localDate <= utcDate).toBe(true);
  });

  it("returns a string in YYYY-MM-DD format", () => {
    expect(computeLocalDate(0)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(computeLocalDate(300)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(computeLocalDate(-540)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ---------------------------------------------------------------------------
// submitFeedback — input validation
// ---------------------------------------------------------------------------

describe("submitFeedback — authentication gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
  });

  it("returns error when session is null", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await submitFeedback({
      body: "A suggestion",
      category: null,
      contextPath: null,
      appVersion: null,
      tzOffsetMinutes: null,
    });
    expect(result).toEqual({ ok: false, error: "Not signed in." });
  });

  it("returns error when session.user is null", async () => {
    mockAuth.mockResolvedValueOnce({ user: null });
    const result = await submitFeedback({
      body: "A suggestion",
      category: null,
      contextPath: null,
      appVersion: null,
      tzOffsetMinutes: null,
    });
    expect(result).toEqual({ ok: false, error: "Not signed in." });
  });
});

describe("submitFeedback — rate limiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns rate-limit error when checkRateLimit returns allowed=false", async () => {
    mockAuth.mockResolvedValueOnce(SESSION_MEMBER);
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 600,
    });
    const result = await submitFeedback({
      body: "A suggestion",
      category: null,
      contextPath: null,
      appVersion: null,
      tzOffsetMinutes: null,
    });
    expect(result).toEqual({
      ok: false,
      error: "Too many submissions — come back in a bit.",
    });
  });
});

describe("submitFeedback — body validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(SESSION_MEMBER);
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
  });

  it("rejects empty body (whitespace only)", async () => {
    const result = await submitFeedback({
      body: "   ",
      category: null,
      contextPath: null,
      appVersion: null,
      tzOffsetMinutes: null,
    });
    expect(result).toEqual({ ok: false, error: "Say something first." });
  });

  it("rejects empty string body", async () => {
    const result = await submitFeedback({
      body: "",
      category: null,
      contextPath: null,
      appVersion: null,
      tzOffsetMinutes: null,
    });
    expect(result).toEqual({ ok: false, error: "Say something first." });
  });

  it("rejects body over 2000 chars (after trim)", async () => {
    const result = await submitFeedback({
      body: "x".repeat(2001),
      category: null,
      contextPath: null,
      appVersion: null,
      tzOffsetMinutes: null,
    });
    expect(result).toEqual({
      ok: false,
      error: "Feedback must be 2,000 characters or fewer.",
    });
  });

  it("accepts body of exactly 2000 chars", async () => {
    const result = await submitFeedback({
      body: "x".repeat(2000),
      category: null,
      contextPath: null,
      appVersion: null,
      tzOffsetMinutes: null,
    });
    expect(result.ok).toBe(true);
  });
});

describe("submitFeedback — category validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(SESSION_MEMBER);
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
  });

  it("rejects invalid category string", async () => {
    const result = await submitFeedback({
      body: "Some feedback",
      category: "invalid-category",
      contextPath: null,
      appVersion: null,
      tzOffsetMinutes: null,
    });
    expect(result).toEqual({ ok: false, error: "Invalid category." });
  });

  it("accepts null category (no selection)", async () => {
    const result = await submitFeedback({
      body: "Some feedback",
      category: null,
      contextPath: null,
      appVersion: null,
      tzOffsetMinutes: null,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts valid category "suggestion"', async () => {
    const result = await submitFeedback({
      body: "My suggestion",
      category: "suggestion",
      contextPath: null,
      appVersion: null,
      tzOffsetMinutes: null,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts valid category "bug"', async () => {
    const result = await submitFeedback({
      body: "Bug report",
      category: "bug",
      contextPath: "/home",
      appVersion: "0.5.2",
      tzOffsetMinutes: null,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts valid category "other"', async () => {
    const result = await submitFeedback({
      body: "General feedback",
      category: "other",
      contextPath: null,
      appVersion: null,
      tzOffsetMinutes: null,
    });
    expect(result.ok).toBe(true);
  });
});

describe("submitFeedback — bug-only metadata handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(SESSION_MEMBER);
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
  });

  it("includes contextPath in insert when category=bug", async () => {
    await submitFeedback({
      body: "Bug report",
      category: "bug",
      contextPath: "/home/dashboard",
      appVersion: "0.5.2",
      tzOffsetMinutes: null,
    });
    const insertedValues = mockInsertValues.mock.calls[0][0];
    expect(insertedValues.contextPath).toBe("/home/dashboard");
  });

  it("truncates contextPath to 512 chars when category=bug", async () => {
    await submitFeedback({
      body: "Bug report",
      category: "bug",
      contextPath: "a".repeat(600),
      appVersion: "0.5.2",
      tzOffsetMinutes: null,
    });
    const insertedValues = mockInsertValues.mock.calls[0][0];
    expect(insertedValues.contextPath).toHaveLength(512);
  });

  it("strips contextPath to null when category=suggestion", async () => {
    await submitFeedback({
      body: "A suggestion",
      category: "suggestion",
      contextPath: "/some/path",
      appVersion: "0.5.2",
      tzOffsetMinutes: null,
    });
    const insertedValues = mockInsertValues.mock.calls[0][0];
    expect(insertedValues.contextPath).toBeNull();
  });

  it("strips appVersion to null when category=other", async () => {
    await submitFeedback({
      body: "General feedback",
      category: "other",
      contextPath: null,
      appVersion: "0.5.2",
      tzOffsetMinutes: null,
    });
    const insertedValues = mockInsertValues.mock.calls[0][0];
    expect(insertedValues.appVersion).toBeNull();
  });

  it("truncates appVersion to 32 chars when category=bug", async () => {
    await submitFeedback({
      body: "Bug report",
      category: "bug",
      contextPath: "/home",
      appVersion: "x".repeat(50),
      tzOffsetMinutes: null,
    });
    const insertedValues = mockInsertValues.mock.calls[0][0];
    expect(insertedValues.appVersion).toHaveLength(32);
  });
});

// ---------------------------------------------------------------------------
// updateFeedbackStatus — state machine transitions
// ---------------------------------------------------------------------------

describe("updateFeedbackStatus — authentication and authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when not signed in", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const result = await updateFeedbackStatus("some-id", "triaged");
    expect(result).toEqual({ ok: false, error: "Not signed in." });
  });

  it("returns Forbidden when hasFeature returns false", async () => {
    mockAuth.mockResolvedValueOnce(SESSION_ADMIN);
    mockHasFeature.mockReturnValueOnce(false);
    const result = await updateFeedbackStatus("some-id", "triaged");
    expect(result).toEqual({ ok: false, error: "Forbidden." });
  });
});

describe("updateFeedbackStatus — legal transitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(SESSION_ADMIN);
    mockHasFeature.mockReturnValue(true);
  });

  it("new → triaged is allowed", async () => {
    mockFeedbackFindFirst.mockResolvedValueOnce({ status: "new" });
    const result = await updateFeedbackStatus("row-id", "triaged");
    expect(result).toEqual({ ok: true });
  });

  it("new → declined is allowed", async () => {
    mockFeedbackFindFirst.mockResolvedValueOnce({ status: "new" });
    const result = await updateFeedbackStatus("row-id", "declined");
    expect(result).toEqual({ ok: true });
  });

  it("triaged → done is allowed", async () => {
    mockFeedbackFindFirst.mockResolvedValueOnce({ status: "triaged" });
    const result = await updateFeedbackStatus("row-id", "done");
    expect(result).toEqual({ ok: true });
  });

  it("triaged → declined is allowed", async () => {
    mockFeedbackFindFirst.mockResolvedValueOnce({ status: "triaged" });
    const result = await updateFeedbackStatus("row-id", "declined");
    expect(result).toEqual({ ok: true });
  });
});

describe("updateFeedbackStatus — illegal transitions (terminal states)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(SESSION_ADMIN);
    mockHasFeature.mockReturnValue(true);
  });

  it("done → anything is rejected (terminal state)", async () => {
    mockFeedbackFindFirst.mockResolvedValueOnce({ status: "done" });
    const result = await updateFeedbackStatus("row-id", "new");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain("done");
  });

  it("done → triaged is rejected", async () => {
    mockFeedbackFindFirst.mockResolvedValueOnce({ status: "done" });
    const result = await updateFeedbackStatus("row-id", "triaged");
    expect(result.ok).toBe(false);
  });

  it("declined → anything is rejected (terminal state)", async () => {
    mockFeedbackFindFirst.mockResolvedValueOnce({ status: "declined" });
    const result = await updateFeedbackStatus("row-id", "new");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain("declined");
  });

  it("declined → done is rejected", async () => {
    mockFeedbackFindFirst.mockResolvedValueOnce({ status: "declined" });
    const result = await updateFeedbackStatus("row-id", "done");
    expect(result.ok).toBe(false);
  });

  it("triaged → new is rejected (regression prevented)", async () => {
    mockFeedbackFindFirst.mockResolvedValueOnce({ status: "triaged" });
    const result = await updateFeedbackStatus("row-id", "new");
    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain("triaged");
  });

  it("returns not-found when row does not exist", async () => {
    mockFeedbackFindFirst.mockResolvedValueOnce(undefined);
    const result = await updateFeedbackStatus("nonexistent-id", "triaged");
    expect(result).toEqual({ ok: false, error: "Feedback not found." });
  });

  it("rejects unknown target status before DB lookup", async () => {
    const result = await updateFeedbackStatus("row-id", "unknown-status");
    expect(result.ok).toBe(false);
    // findFirst should NOT have been called (validation runs first)
    expect(mockFeedbackFindFirst).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Clobber-prevention — each upsert sets ONLY its own field
// ---------------------------------------------------------------------------

describe("clobber-prevention — onConflictDoUpdate sets only one field per action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(SESSION_MEMBER);
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
  });

  it("snoozeFeedbackPrompt: onConflictDoUpdate.set has ONLY lastSnoozedDate", async () => {
    await snoozeFeedbackPrompt(0);
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1);
    const callArg = mockOnConflictDoUpdate.mock.calls[0][0];
    expect(Object.keys(callArg.set)).toEqual(["lastSnoozedDate"]);
  });

  it("setFeedbackOptOut: onConflictDoUpdate.set has ONLY optedOut", async () => {
    await setFeedbackOptOut(true);
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1);
    const callArg = mockOnConflictDoUpdate.mock.calls[0][0];
    expect(Object.keys(callArg.set)).toEqual(["optedOut"]);
  });

  it("setFeedbackOptOut(false): onConflictDoUpdate.set has ONLY optedOut", async () => {
    await setFeedbackOptOut(false);
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1);
    const callArg = mockOnConflictDoUpdate.mock.calls[0][0];
    expect(Object.keys(callArg.set)).toEqual(["optedOut"]);
  });

  it("submitFeedback: feedbackPromptState upsert sets ONLY lastSubmittedDate", async () => {
    // submitFeedback calls db.insert twice:
    //   1. feedback table → uses .returning() (not onConflictDoUpdate)
    //   2. feedbackPromptState table → uses .onConflictDoUpdate()
    await submitFeedback({
      body: "A suggestion",
      category: null,
      contextPath: null,
      appVersion: null,
      tzOffsetMinutes: null,
    });
    // onConflictDoUpdate is called once — for the feedbackPromptState upsert.
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1);
    const callArg = mockOnConflictDoUpdate.mock.calls[0][0];
    expect(Object.keys(callArg.set)).toEqual(["lastSubmittedDate"]);
  });
});

// escapeHtml is tested in src/lib/email/escape-html.test.ts (dedicated file
// with no module-level mock, so the real implementation is exercised).
