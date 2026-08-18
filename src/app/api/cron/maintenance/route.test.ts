// vi.mock() calls are hoisted before imports by Vitest's transform.
// Mocks for modules that are not available or require env vars in plain Node.js.

// Chainable mock for the Drizzle db object.
// db.execute(sql`...`) → Promise<{ rows: Row[] }>
const mockExecute = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ rows: [] }),
);

vi.mock("@/lib/db", () => ({
  db: {
    execute: mockExecute,
  },
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
      .mockResolvedValueOnce({ rows: [] }) // totp_pending
      .mockResolvedValueOnce({ rows: [{ fixed: 4 }] }); // roll reconcile

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

  it("runs the roll-cache reconcile as the fourth statement", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");

    await GET(makeRequest("Bearer test-secret"));

    // Three DELETEs must fire (Promise.all — not short-circuited), plus the
    // F29 reconcile: future-dated roll actions take effect on a day with no
    // corresponding write, so nothing but this daily call fixes the cache.
    // Assert what the fourth statement IS, not just that there are four — a
    // bare count goes stale the next time this route grows a statement.
    expect(mockExecute).toHaveBeenCalledTimes(4);
    const fourth = mockExecute.mock.calls[3][0];
    expect(JSON.stringify(fourth)).toContain("presby_reconcile_current_roll");
  });
});
