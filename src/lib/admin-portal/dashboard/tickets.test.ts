import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TICKET_STATUSES } from "@/lib/tickets-labels";

vi.mock("server-only", () => ({}));
const execute = vi.fn();
vi.mock("@/lib/db", () => ({ getPlatformDb: () => ({ execute }) }));

import { readTicketsCard } from "./tickets";

beforeEach(() => {
  execute.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("readTicketsCard", () => {
  it("issues exactly one statement and maps it (E22)", async () => {
    execute.mockResolvedValue({ rows: [{ new_count: "3", unassigned_open: 5, oldest_new_seconds: 7200 }] });
    expect(await readTicketsCard()).toEqual({ kind: "ok", newCount: 3, unassignedOpen: 5, oldestNewSeconds: 7200 });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns numbers only: the keys are exactly the contract (E18)", async () => {
    execute.mockResolvedValue({ rows: [{ new_count: 1, unassigned_open: 1, oldest_new_seconds: 1, subject: "Leaked", body: "Leaked" }] });
    const result = await readTicketsCard();
    expect(Object.keys(result).sort()).toEqual(["kind", "newCount", "oldestNewSeconds", "unassignedOpen"]);
    expect(JSON.stringify(result)).not.toContain("Leaked");
  });

  it("has no age when no ticket is new", async () => {
    execute.mockResolvedValue({ rows: [{ new_count: 0, unassigned_open: 2, oldest_new_seconds: null }] });
    expect(await readTicketsCard()).toEqual({ kind: "ok", newCount: 0, unassignedOpen: 2, oldestNewSeconds: null });
  });

  it("an empty table is zeros, with the open statuses taken from TICKET_STATUSES", async () => {
    execute.mockResolvedValue({ rows: [{ new_count: 0, unassigned_open: 0, oldest_new_seconds: null }] });
    expect(await readTicketsCard()).toMatchObject({ kind: "ok", newCount: 0, unassignedOpen: 0 });
    const text = JSON.stringify(execute.mock.calls[0]![0]);
    for (const open of ["new", "triaged", "in_progress"]) {
      expect(TICKET_STATUSES).toContain(open);
      expect(text).toContain(`'${open}'`);
    }
  });

  it("a failed read is kind: error, never zero (E5)", async () => {
    execute.mockRejectedValue(new Error("select secret"));
    expect(await readTicketsCard()).toEqual({ kind: "error" });
  });
});
