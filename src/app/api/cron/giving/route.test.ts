import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fns = vi.hoisted(() => ({ dueEvents: vi.fn(), purgeBodies: vi.fn(), expireIntents: vi.fn() }));
vi.mock("@/lib/giving/ingest/functions", () => fns);
const proc = vi.hoisted(() => ({ processInboxEvent: vi.fn() }));
vi.mock("@/lib/giving/ingest/process", () => proc);

import { GET } from "./route";

const get = (authorization?: string) =>
  new Request("http://localhost/api/cron/giving", { headers: authorization ? { authorization } : {} });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("CRON_SECRET", "giving-e2e-cron-secret");
  fns.dueEvents.mockResolvedValue([]);
  fns.purgeBodies.mockResolvedValue(0);
  fns.expireIntents.mockResolvedValue(0);
  proc.processInboxEvent.mockResolvedValue({ claimed: true });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("GET /api/cron/giving", () => {
  it("503 when CRON_SECRET is unset (a visible failure, not a silent no-op)", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(get("Bearer anything"));
    expect(res.status).toBe(503);
    expect(fns.dueEvents).not.toHaveBeenCalled();
  });

  it("401 for a missing or wrong bearer, and does nothing", async () => {
    for (const header of [undefined, "Bearer wrong", "giving-e2e-cron-secret", "bearer giving-e2e-cron-secret", "Bearer giving-e2e-cron-secre", "Bearer giving-e2e-cron-secretx"]) {
      const res = await GET(get(header));
      expect(res.status, String(header)).toBe(401);
    }
    expect(fns.dueEvents).not.toHaveBeenCalled();
    expect(fns.purgeBodies).not.toHaveBeenCalled();
  });

  it("processes due events in order, then purges and expires, and reports counts only", async () => {
    fns.dueEvents.mockResolvedValue(["a", "b", "c"]);
    proc.processInboxEvent.mockResolvedValueOnce({ claimed: true }).mockResolvedValueOnce({ claimed: false }).mockResolvedValueOnce({ claimed: true });
    fns.purgeBodies.mockResolvedValue(4);
    fns.expireIntents.mockResolvedValue(2);
    const res = await GET(get("Bearer giving-e2e-cron-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, processed: 2, purged: 4, expired: 2 });
    expect(fns.dueEvents).toHaveBeenCalledWith(25);
    expect(proc.processInboxEvent.mock.calls.map((c) => c[0])).toEqual(["a", "b", "c"]);
  });

  it("processes serially: the second starts only after the first finished", async () => {
    fns.dueEvents.mockResolvedValue(["a", "b"]);
    const order: string[] = [];
    proc.processInboxEvent.mockImplementation(async (id: string) => {
      order.push(`start:${id}`);
      await Promise.resolve();
      order.push(`end:${id}`);
      return { claimed: true };
    });
    await GET(get("Bearer giving-e2e-cron-secret"));
    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });

  it("stops at the 25 second budget and leaves the rest for the next run", async () => {
    vi.useFakeTimers();
    fns.dueEvents.mockResolvedValue(["a", "b", "c"]);
    proc.processInboxEvent.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 30_000);
      return { claimed: true };
    });
    const res = await GET(get("Bearer giving-e2e-cron-secret"));
    expect(await res.json()).toMatchObject({ processed: 1 });
    expect(proc.processInboxEvent).toHaveBeenCalledTimes(1);
    expect(fns.purgeBodies).toHaveBeenCalled(); // hygiene still runs
  });

  it("500 with a generic body when the database fails; nothing leaks", async () => {
    fns.dueEvents.mockRejectedValue(new Error("password authentication failed for user presby_app"));
    const res = await GET(get("Bearer giving-e2e-cron-secret"));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "Internal server error." });
    expect(text).not.toContain("password");
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("presby_app");
  });

  it("the summary log carries counts only", async () => {
    fns.dueEvents.mockResolvedValue(["secret-looking-inbox-id"]);
    await GET(get("Bearer giving-e2e-cron-secret"));
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain("secret-looking-inbox-id");
  });
});

describe("GET /api/cron/giving - the host-class log line (T6 / A6)", () => {
  const withHost = (host: string | null) =>
    new Request("http://localhost/api/cron/giving", {
      headers: { authorization: "Bearer giving-e2e-cron-secret", ...(host ? { host } : {}) },
    });
  const logged = () => JSON.parse(vi.mocked(console.info).mock.calls.at(-1)![1] as string) as Record<string, unknown>;

  it("logs which class of host the invocation arrived on, beside the counts - and nothing else varies", async () => {
    vi.stubEnv("NEXT_PUBLIC_PLATFORM_HOSTS", "app.example.invalid");
    const bodies: unknown[] = [];
    for (const [host, expected] of [
      ["app.example.invalid", "platform"],
      ["church-one.invalid", "custom"],
      ["bad host", "invalid"],
      [null, "invalid"],
    ] as const) {
      const res = await GET(withHost(host));
      expect(res.status, String(host)).toBe(200);
      bodies.push(await res.json());
      expect(logged().hostClass, String(host)).toBe(expected);
    }
    // The response body never names the host class: only the log does.
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
  });
});
