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
    // Simulate: 2 expired pwd-reset rows, 1 email-verify row, 0 totp rows.
    mockExecute
      .mockResolvedValueOnce({ rows: [{ id: "a" }, { id: "b" }] }) // pwd_reset
      .mockResolvedValueOnce({ rows: [{ id: "c" }] }) // email_verify
      .mockResolvedValueOnce({ rows: [] }); // totp_pending

    const res = await GET(makeRequest("Bearer test-secret"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      deletedPwdReset: 2,
      deletedEmailVerify: 1,
      deletedTotpPending: 0,
    });
  });

  it("calls db.execute three times in parallel for a valid request", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");

    await GET(makeRequest("Bearer test-secret"));

    // All three DELETE statements must fire (Promise.all — not short-circuited).
    expect(mockExecute).toHaveBeenCalledTimes(3);
  });
});
