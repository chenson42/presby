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

// The careers sweep (src/lib/careers/sweep.ts) is its own module with its own
// tests; here only the route's ISOLATION of that step is under test. The real
// sweep opens a transaction on the platform connection, which this mock (and
// the "exactly one platform execute" assertions below) deliberately does not model.
const mockRunCareersSweep = vi.hoisted(() => vi.fn().mockResolvedValue(0));
vi.mock("@/lib/careers/sweep", () => ({ runCareersSweep: mockRunCareersSweep }));

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
  mockRunCareersSweep.mockResolvedValue(0);
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
      careersPostingsClosed: 0,
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

describe("GET /api/cron/maintenance - the host-class log line (T6 / A6)", () => {
  it("logs which class of host the invocation arrived on", async () => {
    vi.stubEnv("CRON_SECRET", "maint-secret");
    vi.stubEnv("NEXT_PUBLIC_PLATFORM_HOSTS", "app.example.invalid");
    mockExecute.mockResolvedValue({ rows: [] });
    mockPlatformExecute.mockResolvedValue({ rows: [{ fixed: 0 }] });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    for (const [host, expected] of [
      ["app.example.invalid", "platform"],
      ["church-one.invalid", "custom"],
      ["bad host", "invalid"],
    ] as const) {
      const res = await GET(
        new Request("http://localhost/api/cron/maintenance", {
          headers: { authorization: "Bearer maint-secret", host },
        }),
      );
      expect(res.status, host).toBe(200);
      const line = JSON.parse(log.mock.calls.at(-1)![1] as string) as Record<string, unknown>;
      expect(line.hostClass, host).toBe(expected);
      expect(line).toHaveProperty("deletedPwdReset");
    }
    log.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Careers sweep (docs/work-log/2026-10-25-careers-inc1.md, Phase 3 T23)
// ---------------------------------------------------------------------------

describe("GET /api/cron/maintenance - the careers sweep step", () => {
  it("reports how many postings it closed, in the response and the structured log", async () => {
    vi.stubEnv("CRON_SECRET", "careers-secret");
    mockPlatformExecute.mockResolvedValueOnce({ rows: [{ fixed: 2 }] });
    mockRunCareersSweep.mockResolvedValueOnce(3);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await GET(makeRequest("Bearer careers-secret"));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, rollCacheRolledForward: 2, careersPostingsClosed: 3 });
    const line = JSON.parse(log.mock.calls.at(-1)![1] as string) as Record<string, unknown>;
    expect(line.careersPostingsClosed).toBe(3);
    log.mockRestore();
  });

  it("a throwing sweep still answers 200 with every other count, and logs a fixed label with no error text", async () => {
    vi.stubEnv("CRON_SECRET", "careers-secret");
    mockExecute
      .mockResolvedValueOnce({ rows: [{ id: "a" }, { id: "b" }] })
      .mockResolvedValueOnce({ rows: [{ id: "c" }] })
      .mockResolvedValueOnce({ rows: [] });
    mockPlatformExecute.mockResolvedValueOnce({ rows: [{ fixed: 4 }] });
    mockRunCareersSweep.mockRejectedValueOnce(
      new Error('function presby_careers_sweep(integer) does not exist SECRET-SQL password=hunter2'),
    );
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(makeRequest("Bearer careers-secret"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      deletedPwdReset: 2,
      deletedEmailVerify: 1,
      deletedTotpPending: 0,
      rollCacheRolledForward: 4,
      careersPostingsClosed: 0,
    });
    expect(err).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledWith("[cron/maintenance] careers sweep failed");
    const logged = JSON.stringify(err.mock.calls);
    expect(logged).not.toContain("SECRET-SQL");
    expect(logged).not.toContain("hunter2");
    err.mockRestore();
  });

  it("runs AFTER the token pruning and the roll reconcile, so a failing sweep cannot stop either", async () => {
    vi.stubEnv("CRON_SECRET", "careers-secret");
    const order: string[] = [];
    mockExecute.mockImplementation(async () => {
      order.push("tokens");
      return { rows: [] };
    });
    mockPlatformExecute.mockImplementation(async () => {
      order.push("reconcile");
      return { rows: [{ fixed: 0 }] };
    });
    mockRunCareersSweep.mockImplementation(async () => {
      order.push("careers");
      throw new Error("boom");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(makeRequest("Bearer careers-secret"));

    expect(res.status).toBe(200);
    expect(order).toEqual(["tokens", "tokens", "tokens", "reconcile", "careers"]);
    // The reconcile is still platform call 0: the sweep opens its own transaction elsewhere.
    expect(mockPlatformExecute).toHaveBeenCalledTimes(1);
    mockExecute.mockResolvedValue({ rows: [] });
    mockPlatformExecute.mockResolvedValue({ rows: [] });
  });

  it("does not run for an unauthenticated request", async () => {
    vi.stubEnv("CRON_SECRET", "careers-secret");
    await GET(makeRequest("Bearer wrong"));
    expect(mockRunCareersSweep).not.toHaveBeenCalled();
  });
});
