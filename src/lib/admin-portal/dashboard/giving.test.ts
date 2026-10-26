import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const execute = vi.fn();
vi.mock("@/lib/db", () => ({ getPlatformDb: () => ({ execute }) }));

import { readGivingCard } from "./giving";

beforeEach(() => {
  execute.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const health = (over: Record<string, unknown>) => ({
  organization_id: "o",
  connection_id: "c",
  provider: "stripe",
  livemode: false,
  status: "active",
  received_count: 0,
  applied_count: 0,
  parked_count: 0,
  dead_letter_count: 0,
  last_received_at: null,
  oldest_pending_seconds: null,
  ...over,
});

describe("readGivingCard", () => {
  it("one call of the ingest-health function, reduced to four numbers (E22)", async () => {
    execute.mockResolvedValue({
      rows: [
        health({ parked_count: 2, dead_letter_count: 1 }),
        health({ parked_count: "3", status: "restricted" }),
      ],
    });
    const result = await readGivingCard();
    expect(result).toEqual({ kind: "ok", connections: 2, waiting: 5, deadLetters: 1, restricted: 1 });
    expect(Object.keys(result).sort()).toEqual(["connections", "deadLetters", "kind", "restricted", "waiting"]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("no connections is zeros", async () => {
    execute.mockResolvedValue({ rows: [] });
    expect(await readGivingCard()).toEqual({ kind: "ok", connections: 0, waiting: 0, deadLetters: 0, restricted: 0 });
  });

  it("a failed read is kind: error, never zero (E5)", async () => {
    execute.mockRejectedValue(new Error("x"));
    expect(await readGivingCard()).toEqual({ kind: "error" });
  });
});
