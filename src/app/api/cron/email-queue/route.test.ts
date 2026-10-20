/**
 * GET /api/cron/email-queue - the guard shape, and the one-line host-class log
 * (T6 / A6: Vercel does not say which host a scheduled invocation uses; the
 * real-domain acceptance pass reads this line). CRON_SECRET is read at MODULE
 * scope in this route, so each test loads a fresh copy under its own env.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const processQueueBatch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email/queue", () => ({ processQueueBatch: (...a: unknown[]) => processQueueBatch(...a) }));

async function load(secret: string | undefined) {
  vi.resetModules();
  vi.stubEnv("CRON_SECRET", secret as string);
  return (await import("./route")).GET;
}
const req = (headers: Record<string, string> = {}, search = "") =>
  new Request(`http://localhost/api/cron/email-queue${search}`, { headers });

beforeEach(() => {
  processQueueBatch.mockReset();
  processQueueBatch.mockResolvedValue({ processed: 0 });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubEnv("NEXT_PUBLIC_PLATFORM_HOSTS", "app.example.invalid");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/cron/email-queue", () => {
  it("503 without CRON_SECRET and does nothing", async () => {
    const GET = await load("");
    expect((await GET(req({ authorization: "Bearer x" }))).status).toBe(503);
    expect(processQueueBatch).not.toHaveBeenCalled();
  });

  it("401 for a missing or wrong bearer and does nothing", async () => {
    const GET = await load("cron-secret-fixture");
    for (const authorization of [undefined, "Bearer wrong", "cron-secret-fixture"]) {
      const res = await GET(req(authorization ? { authorization } : {}));
      expect(res.status, String(authorization)).toBe(401);
    }
    expect(processQueueBatch).not.toHaveBeenCalled();
  });

  it("runs the worker with a clamped limit", async () => {
    const GET = await load("cron-secret-fixture");
    const headers = { authorization: "Bearer cron-secret-fixture" };
    await GET(req(headers, "?limit=1"));
    await GET(req(headers, "?limit=99999"));
    await GET(req(headers, "?limit=-5"));
    await GET(req(headers));
    expect(processQueueBatch.mock.calls.map((c) => c[0])).toEqual([1, 200, 1, 25]);
  });
});

describe("GET /api/cron/email-queue - the host-class log line (T6 / A6)", () => {
  it("logs which class of host the invocation arrived on; the response body never names it", async () => {
    const GET = await load("cron-secret-fixture");
    const bodies: unknown[] = [];
    for (const [host, expected] of [
      ["app.example.invalid", "platform"],
      ["church-one.invalid", "custom"],
      ["bad host", "invalid"],
    ] as const) {
      const res = await GET(req({ authorization: "Bearer cron-secret-fixture", host }));
      expect(res.status, host).toBe(200);
      bodies.push(await res.json());
      const line = JSON.parse(vi.mocked(console.info).mock.calls.at(-1)![1] as string) as Record<string, unknown>;
      expect(line).toEqual({ hostClass: expected });
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
  });
});
