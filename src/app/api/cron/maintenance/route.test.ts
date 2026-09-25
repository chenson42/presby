// vi.mock() calls are hoisted before imports by Vitest's transform.
// Mocks for modules that are not available or require env vars in plain Node.js.

// Chainable mocks for the Drizzle handles. TWO of them, deliberately: this
// route is the one place in the codebase that deliberately uses both
// connections in a single request (C-4 / drizzle/0048 section 6). The three
// token DELETEs stay on `db` (presby_app, least privilege); only
// presby_reconcile_current_roll() — a parameterless CROSS-ORG writer that
// presby_app no longer holds EXECUTE on — runs on getPlatformDb().
// A single shared mock would make the split untestable, which is the whole
// behaviour under test.
// db.execute(sql`...`) → Promise<{ rows: Row[] }>
const mockExecute = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ rows: [] }),
);
const mockPlatformExecute = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ rows: [] }),
);

vi.mock("@/lib/db", () => ({
  db: {
    execute: mockExecute,
  },
  getPlatformDb: () => ({
    execute: mockPlatformExecute,
  }),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(authHeader?: string): Request {
  return new Request("http://localhost/api/cron/maintenance", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// Auth behavior
// ---------------------------------------------------------------------------

describe("GET /api/cron/maintenance — auth", () => {
  it("returns 503 when CRON_SECRET is not set", async () => {
    // Stub to empty string (falsy) so the guard fires regardless of what
    // the test environment has set.
    vi.stubEnv("CRON_SECRET", "");

    const res = await GET(makeRequest());

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/disabled/i);
  });

  it("returns 401 when Authorization header is absent", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");

    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header has the wrong bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");

    const res = await GET(makeRequest("Bearer wrong-secret"));

    expect(res.status).toBe(401);
  });

  it("returns 200 with numeric deleted counts on a correct bearer token", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    // Simulate: 2 expired pwd-reset rows, 1 email-verify row, 0 totp rows,
    // then the roll reconcile rolling 4 memberships forward.
    mockExecute
      .mockResolvedValueOnce({ rows: [{ id: "a" }, { id: "b" }] }) // pwd_reset
      .mockResolvedValueOnce({ rows: [{ id: "c" }] }) // email_verify
      .mockResolvedValueOnce({ rows: [] }); // totp_pending
    mockPlatformExecute.mockResolvedValueOnce({ rows: [{ fixed: 4 }] }); // reconcile

    const res = await GET(makeRequest("Bearer test-secret"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      deletedPwdReset: 2,
      deletedEmailVerify: 1,
      deletedTotpPending: 0,
      rollCacheRolledForward: 4,
    });
  });

  it("runs the roll-cache reconcile on the PLATFORM connection, and the three token DELETEs on the tenant one — regression for C-4 presby_reconcile_current_roll grant", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");

    await GET(makeRequest("Bearer test-secret"));

    // Three DELETEs must fire on `db` (Promise.all — not short-circuited),
    // and NOT a fourth: presby_app lost EXECUTE on
    // presby_reconcile_current_roll() in drizzle/0048 section 6, so leaving
    // the call on this handle would 500 the cron every night.
    expect(mockExecute).toHaveBeenCalledTimes(3);
    expect(
      mockExecute.mock.calls.map((c) => JSON.stringify(c[0])).join(" "),
    ).not.toContain("presby_reconcile_current_roll");

    // ...and exactly the reconcile on the platform connection. F29: a
    // future-dated roll action takes effect on a day with no corresponding
    // write, so nothing but this daily call fixes the cache. Assert what the
    // statement IS, not merely that one was issued.
    expect(mockPlatformExecute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mockPlatformExecute.mock.calls[0][0])).toContain(
      "presby_reconcile_current_roll",
    );
  });

  it("the three token DELETEs stay on the tenant connection — the platform handle is not a shortcut for the whole handler", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");

    await GET(makeRequest("Bearer test-secret"));

    // Least privilege (Phase 2 §2(b)): moving the whole handler to one
    // connection would widen these three from presby_app to neondb_owner for
    // no reason. Each statement names its own table, so this is a real
    // assertion about which handle carries which statement.
    const tenantSql = mockExecute.mock.calls
      .map((c) => JSON.stringify(c[0]))
      .join(" ");
    expect(tenantSql).toContain("password_reset_tokens");
    expect(tenantSql).toContain("email_verification_tokens");
    expect(tenantSql).toContain("user_totp_pending_enrollments");

    const platformSql = mockPlatformExecute.mock.calls
      .map((c) => JSON.stringify(c[0]))
      .join(" ");
    expect(platformSql).not.toContain("password_reset_tokens");
    expect(platformSql).not.toContain("email_verification_tokens");
    expect(platformSql).not.toContain("user_totp_pending_enrollments");
  });
});
