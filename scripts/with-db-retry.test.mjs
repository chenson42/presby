/**
 * Unit tests for withDbRetry / isDbDrop (e2e/support/db.ts). The helper retries
 * a fixture step ONLY on a dropped connection. The old pattern also matched the
 * bare word "timeout", so a statement timeout was retried five times (a 20 s
 * stall became 100 s+). A unique violation was already not retried by accident
 * (the driver puts the class name in name, not message); this pins that as a
 * rule, with the timeout cases. The spec was always "fetch failed, Connection
 * terminated, ECONNRESET, connection timeouts". This pins the classification,
 * the schedule, the rethrow of the ORIGINAL error, and that nested wrappers do
 * not multiply attempts.
 *
 * Run via: npm test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDbDrop, withDbRetry } from "../e2e/support/db.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FAST = { baseMs: 1 };

/** An error shaped like the Neon driver's NeonDbError carrying a SQLSTATE. */
function neonDbError(code, message) {
  const e = new Error(message);
  e.name = "NeonDbError";
  e.code = code;
  return e;
}

/** `fetch failed` as undici raises it: no code of its own, the reason on `cause`. */
function fetchFailed(causeMessage) {
  const e = new TypeError("fetch failed");
  if (causeMessage) e.cause = new Error(causeMessage);
  return e;
}

describe("isDbDrop", () => {
  it.each([
    ["fetch failed", fetchFailed()],
    ["Connection terminated unexpectedly", new Error("Connection terminated unexpectedly")],
    ["terminating connection due to administrator command", new Error("terminating connection due to administrator command")],
    ["ECONNRESET in the message", new Error("read ECONNRESET")],
    ["ECONNREFUSED in the message", new Error("connect ECONNREFUSED 127.0.0.1:5432")],
    ["socket hang up", new Error("socket hang up")],
    ["a connect timeout", new Error("Connect Timeout Error")],
    ["UND_ERR_CONNECT_TIMEOUT", new Error("UND_ERR_CONNECT_TIMEOUT")],
    ["ETIMEDOUT only on the cause", fetchFailed("connect ETIMEDOUT 1.2.3.4:443")],
    ["ECONNRESET only on the cause", fetchFailed("read ECONNRESET")],
    ["SQLSTATE 08006 (connection failure)", neonDbError("08006", "connection failure")],
    ["SQLSTATE 08003", neonDbError("08003", "connection does not exist")],
    ["SQLSTATE 57P01 (admin shutdown)", neonDbError("57P01", "terminating connection due to administrator command")],
    ["SQLSTATE 57P02", neonDbError("57P02", "crash shutdown")],
    ["SQLSTATE 57P03", neonDbError("57P03", "the database system is starting up")],
    ["SQLSTATE 53300 (too many connections)", neonDbError("53300", "too many connections")],
    ["EPIPE (5 letters, no digit: a Node code, not a SQLSTATE)", Object.assign(new Error("write EPIPE"), { code: "EPIPE" })],
  ])("%s retries", (_name, err) => {
    expect(isDbDrop(err)).toBe(true);
  });

  it.each([
    ["a unique violation", neonDbError("23505", "duplicate key value violates unique constraint")],
    ["a missing table", neonDbError("42P01", 'relation "x" does not exist')],
    ["a cancelled query (57014)", neonDbError("57014", "canceling statement due to statement timeout")],
    ["a statement timeout by text alone", new Error("canceling statement due to statement timeout")],
    ["a lock timeout", new Error("canceling statement due to lock timeout")],
    ["an idle-in-transaction timeout", new Error("terminating connection due to idle-in-transaction timeout")],
    ["the bare word timeout", new Error("timeout")],
    ["the bare class name NeonDbError", Object.assign(new Error("something else"), { name: "NeonDbError" })],
    ["a plain bug", new TypeError("x is not a function")],
    ["a statement timeout wrapped as the cause of fetch failed", fetchFailed("canceling statement due to statement timeout")],
    ["a non-error value", "boom"],
    ["undefined", undefined],
  ])("%s throws at once", (_name, err) => {
    expect(isDbDrop(err)).toBe(false);
  });
});

describe("withDbRetry", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the step's value", async () => {
    await expect(withDbRetry("ok", async () => 42, FAST)).resolves.toBe(42);
  });

  it("succeeds on the third try after two fetch failures", async () => {
    const step = vi.fn()
      .mockRejectedValueOnce(fetchFailed())
      .mockRejectedValueOnce(fetchFailed())
      .mockResolvedValueOnce("done");
    await expect(withDbRetry("flaky", step, FAST)).resolves.toBe("done");
    expect(step).toHaveBeenCalledTimes(3);
    expect(console.warn).toHaveBeenCalledWith("[e2e-db] flaky: connection dropped, retry 1/4");
    expect(console.warn).toHaveBeenCalledWith("[e2e-db] flaky: connection dropped, retry 2/4");
  });

  it("a unique violation runs once and throws", async () => {
    const err = neonDbError("23505", "duplicate key");
    const step = vi.fn().mockRejectedValue(err);
    await expect(withDbRetry("dup", step, FAST)).rejects.toBe(err);
    expect(step).toHaveBeenCalledTimes(1);
  });

  it("a statement timeout runs once", async () => {
    const step = vi.fn().mockRejectedValue(neonDbError("57014", "canceling statement due to statement timeout"));
    await expect(withDbRetry("slow", step, FAST)).rejects.toThrow(/statement timeout/);
    expect(step).toHaveBeenCalledTimes(1);
  });

  it("the bare message 'timeout' runs once", async () => {
    const step = vi.fn().mockRejectedValue(new Error("timeout"));
    await expect(withDbRetry("bare", step, FAST)).rejects.toThrow("timeout");
    expect(step).toHaveBeenCalledTimes(1);
  });

  it("five attempts, then the SAME error object is rethrown", async () => {
    const err = fetchFailed();
    const step = vi.fn().mockRejectedValue(err);
    await expect(withDbRetry("down", step, FAST)).rejects.toBe(err);
    expect(step).toHaveBeenCalledTimes(5);
  });

  it("sleeps 0.5, 1, 2, 4 s between attempts", async () => {
    vi.useFakeTimers();
    try {
      const step = vi.fn().mockRejectedValue(fetchFailed());
      const done = withDbRetry("schedule", step).catch((e) => e);
      for (const [ms, calls] of [[499, 1], [1, 2], [999, 2], [1, 3], [1999, 3], [1, 4], [3999, 4], [1, 5]]) {
        await vi.advanceTimersByTimeAsync(ms);
        expect(step).toHaveBeenCalledTimes(calls);
      }
      expect(await done).toBeInstanceOf(TypeError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("nested wrappers: the inner step runs once per OUTER attempt", async () => {
    let innerRuns = 0;
    let outerRuns = 0;
    const err = fetchFailed();
    await expect(
      withDbRetry("outer", async () => {
        outerRuns++;
        await withDbRetry("inner", async () => {
          innerRuns++;
          throw err;
        }, FAST);
      }, FAST),
    ).rejects.toBe(err);
    expect(outerRuns).toBe(5);
    expect(innerRuns).toBe(5);
  });

  it("nested wrappers: a drop inside the inner is retried by the outer, which then succeeds", async () => {
    let innerRuns = 0;
    const out = await withDbRetry("outer", async () => {
      return withDbRetry("inner", async () => {
        innerRuns++;
        if (innerRuns < 3) throw fetchFailed();
        return "ok";
      }, FAST);
    }, FAST);
    expect(out).toBe("ok");
    expect(innerRuns).toBe(3);
  });
});

describe("one definition", () => {
  it("withDbRetry is defined only in db.ts, and fixtures import it from ./db", () => {
    const dir = path.join(ROOT, "e2e", "support");
    const defining = readdirSync(dir)
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => /export (async )?function withDbRetry/.test(readFileSync(path.join(dir, f), "utf8")));
    expect(defining).toEqual(["db.ts"]);
    const inv = readFileSync(path.join(dir, "invitation-fixture.ts"), "utf8");
    expect(inv).toMatch(/import \{[^}]*withDbRetry[^}]*\} from "\.\/db"/);
    expect(inv).not.toMatch(/from "\.\/domains-ui-fixture"/);
  });
});
