import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FakeHosting } from "./adapters/fake";
import { REATTACH_STATES, reattachAll, type ReattachRow } from "./reattach";

const rows: ReattachRow[] = [
  { hostname: "b.invalid", state: "live" },
  { hostname: "a.invalid", state: "attached" },
  { hostname: "c.invalid", state: "lapsed" },
  { hostname: "d.invalid", state: "parked" },
  { hostname: "e.invalid", state: "attach_pending" },
  { hostname: "f.invalid", state: "release_pending" },
  { hostname: "g.invalid", state: "pending" },
  { hostname: "h.invalid", state: "verified" },
  { hostname: "i.invalid", state: "released" },
  { hostname: "j.invalid", state: "expired" },
  { hostname: "a.invalid", state: "attached" }, // a duplicate is attached once
];
const noSleep = async () => {};

describe("reattachAll", () => {
  it("covers exactly the states the database believes are attached", () => {
    expect([...REATTACH_STATES]).toEqual(["attached", "live", "lapsed", "parked"]);
  });

  it("a DRY RUN lists what it would do and makes no provider call at all", async () => {
    const h = new FakeHosting();
    const lines: string[] = [];
    const r = await reattachAll(rows, h, { apply: false, log: (l) => lines.push(l), sleep: noSleep });
    expect(h.calls).toHaveLength(0);
    expect(r).toMatchObject({ apply: false, total: 4, failed: [], aborted: false });
    expect(lines).toEqual([
      "DRY RUN: 4 host(s) to ensure are attached",
      "would attach a.invalid",
      "would attach b.invalid",
      "would attach c.invalid",
      "would attach d.invalid",
    ]);
  });

  it("APPLY attaches only the attached-class hosts, sorted, once each, and is idempotent on a re-run", async () => {
    const h = new FakeHosting();
    const first = await reattachAll(rows, h, { apply: true, sleep: noSleep });
    expect(h.callsOf("add")).toEqual(["a.invalid", "b.invalid", "c.invalid", "d.invalid"]);
    expect(first.byOutcome).toEqual({ attached: 4 });
    const second = await reattachAll(rows, h, { apply: true, sleep: noSleep });
    expect(second.byOutcome).toEqual({ already_attached: 4 });
    expect(second.failed).toEqual([]);
  });

  it("paces its calls", async () => {
    const sleeps: number[] = [];
    await reattachAll(rows, new FakeHosting(), { apply: true, delayMs: 123, sleep: async (ms) => void sleeps.push(ms) });
    expect(sleeps).toEqual([123, 123, 123, 123]);
  });

  it("reports blocked / retryable / rejected hosts and carries on", async () => {
    const h = new FakeHosting();
    h.failWith("add", "blocked_other_project", { times: 1 });
    h.failWith("all", "rate_limited", { times: 0 });
    const r = await reattachAll(rows, h, { apply: true, sleep: noSleep });
    expect(r.failed).toEqual([{ hostname: "a.invalid", outcome: "blocked" }]);
    expect(r.byOutcome).toEqual({ blocked: 1, attached: 3 });
    expect(r.aborted).toBe(false);
  });

  it("stops at once when the credentials are refused (every further call would fail the same way)", async () => {
    const h = new FakeHosting().failWith("add", "token_invalid");
    const r = await reattachAll(rows, h, { apply: true, sleep: noSleep });
    expect(h.callsOf("add")).toEqual(["a.invalid"]);
    expect(r.aborted).toBe(true);
    expect(r.failed).toEqual([{ hostname: "a.invalid", outcome: "config_error" }]);
  });

  it("no rows is a clean no-op", async () => {
    const h = new FakeHosting();
    expect(await reattachAll([], h, { apply: true, sleep: noSleep })).toMatchObject({ total: 0, failed: [], aborted: false });
    expect(h.calls).toHaveLength(0);
  });
});
