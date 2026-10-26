import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getPlatformDb: vi.fn() }));

import { summarizeIngestHealth, type IngestHealthRow } from "./giving-ingest-health";

function row(over: Partial<IngestHealthRow>): IngestHealthRow {
  return {
    organizationId: "o",
    connectionId: "c",
    provider: "stripe",
    livemode: false,
    status: "active",
    receivedCount: 0,
    appliedCount: 0,
    parkedCount: 0,
    deadLetterCount: 0,
    lastReceivedAt: null,
    oldestPendingSeconds: null,
    ...over,
  };
}

describe("summarizeIngestHealth", () => {
  it("is all zero for no connections", () => {
    expect(summarizeIngestHealth([])).toEqual({ connections: 0, waiting: 0, deadLetters: 0, restricted: 0 });
  });

  it("sums parked and dead-letter counts across connections and counts restricted connections", () => {
    const summary = summarizeIngestHealth([
      row({ parkedCount: 2, deadLetterCount: 1 }),
      row({ parkedCount: 3, status: "restricted" }),
      row({ deadLetterCount: 4, status: "restricted" }),
      row({ status: "disconnected" }),
    ]);
    expect(summary).toEqual({ connections: 4, waiting: 5, deadLetters: 5, restricted: 2 });
  });

  it("carries numbers only: no id, amount or donor field exists on the result", () => {
    expect(Object.keys(summarizeIngestHealth([row({})])).sort()).toEqual(["connections", "deadLetters", "restricted", "waiting"]);
  });
});
