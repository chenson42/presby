/**
 * GET /api/cron/domains - auth, batching, the host-class log, and that the
 * response carries counts only. The sweep itself is mocked here; its behaviour
 * is proven in src/lib/domains/sweep.db.test.ts.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const sweep = vi.hoisted(() => ({ sweepDueDomains: vi.fn() }));
vi.mock("@/lib/domains/service", () => sweep);

import { GET, maxDuration, dynamic, runtime } from "./route";

// leak-ok: a throwaway value used only inside this test
const SECRET = "domains-cron-secret-for-tests";
const SUMMARY = { picked: 3, groups: 2, advanced: 1, failed: 0, outcomes: { live: 1, unchanged: 1 } };

const get = (authorization?: string, path = "/api/cron/domains", host = "localhost:3000") =>
  new Request(`http://localhost:3000${path}`, { headers: { ...(authorization ? { authorization } : {}), host } });

let info: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("CRON_SECRET", SECRET);
  sweep.sweepDueDomains.mockResolvedValue(SUMMARY);
  info = vi.spyOn(console, "info").mockImplementation(() => {});
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("route config", () => {
  it("is a dynamic Node route with a 60 second ceiling", () => {
    expect(runtime).toBe("nodejs");
    expect(dynamic).toBe("force-dynamic");
    expect(maxDuration).toBe(60);
  });

  it("is scheduled every five minutes in vercel.json (and the A6 allow-list in Batch 1c must include this exact path)", () => {
    const { crons } = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Array<{ path: string; schedule: string }> };
    expect(crons.filter((c) => c.path === "/api/cron/domains")).toEqual([{ path: "/api/cron/domains", schedule: "*/5 * * * *" }]);
  });
});

describe("GET /api/cron/domains - authentication", () => {
  it("503 when CRON_SECRET is unset (a visible failure, not a silent no-op), and nothing runs", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(get(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(sweep.sweepDueDomains).not.toHaveBeenCalled();
  });

  it("401 for a missing, wrong, empty, malformed, truncated or extended bearer, and nothing runs", async () => {
    for (const header of [
      undefined,
      "",
      "Bearer",
      "Bearer ",
      "Bearer wrong",
      SECRET,
      `bearer ${SECRET}`,
      `Bearer ${SECRET.slice(0, -1)}`,
      `Bearer ${SECRET}x`,
      `Bearer  ${SECRET}`,
      `Basic ${SECRET}`,
    ]) {
      const res = await GET(get(header));
      expect(res.status, String(header)).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized." });
    }
    expect(sweep.sweepDueDomains).not.toHaveBeenCalled();
  });

  it("the secret is in no response body", async () => {
    const res = await GET(get("Bearer wrong"));
    expect(JSON.stringify(await res.json())).not.toContain(SECRET);
  });
});

describe("GET /api/cron/domains - batching", () => {
  it("runs one sweep with the default batch of 50 and a time budget, and returns counts only", async () => {
    const before = Date.now();
    const res = await GET(get(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ...SUMMARY });
    expect(sweep.sweepDueDomains).toHaveBeenCalledTimes(1);
    const arg = sweep.sweepDueDomains.mock.calls[0]![0] as { limit: number; deadlineMs: number };
    expect(arg.limit).toBe(50);
    expect(arg.deadlineMs).toBeGreaterThanOrEqual(before + 49_000);
    expect(arg.deadlineMs).toBeLessThanOrEqual(Date.now() + 51_000);
  });

  it("honours ?limit= within 1..200 and ignores nonsense", async () => {
    const limits: Array<[string, number]> = [
      ["10", 10],
      ["1", 1],
      ["200", 200],
      ["201", 200],
      ["99999", 200],
      ["0", 1],
      ["-4", 1],
      ["abc", 50],
      ["", 50],
      ["7.9", 7],
    ];
    for (const [raw, expected] of limits) {
      sweep.sweepDueDomains.mockClear();
      await GET(get(`Bearer ${SECRET}`, `/api/cron/domains?limit=${raw}`));
      expect((sweep.sweepDueDomains.mock.calls[0]![0] as { limit: number }).limit, raw).toBe(expected);
    }
  });

  it("a failure is a bare 500 and logs no message, hostname or provider text", async () => {
    sweep.sweepDueDomains.mockRejectedValue(new Error("connect ECONNREFUSED church-one.invalid vercel token tok_abc"));
    const res = await GET(get(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error." });
    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toBe("[cron/domains] failed");
  });
});

describe("GET /api/cron/domains - the host-class log (T6)", () => {
  const logged = () => JSON.parse(String(info.mock.calls[0]![1])) as Record<string, unknown>;

  it("logs one line with the host class and the counts, and nothing that names a host", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.platform.example");
    vi.stubEnv("VERCEL_ENV", "production");
    await GET(get(`Bearer ${SECRET}`, "/api/cron/domains", "www.platform.example"));
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]![0]).toBe("[cron/domains]");
    expect(logged()).toEqual({ hostClass: "platform", ...SUMMARY });
  });

  it("classifies a church host as 'custom' and a malformed host as 'invalid'", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://www.platform.example");
    vi.stubEnv("VERCEL_ENV", "production");
    await GET(get(`Bearer ${SECRET}`, "/api/cron/domains", "church-one.invalid"));
    expect(logged().hostClass).toBe("custom");
    info.mockClear();
    await GET(get(`Bearer ${SECRET}`, "/api/cron/domains", "bad host!"));
    expect(logged().hostClass).toBe("invalid");
    expect(JSON.stringify(info.mock.calls)).not.toContain("church-one");
  });
});
