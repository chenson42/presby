import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const execute = vi.fn();
vi.mock("@/lib/db", () => ({ getPlatformDb: () => ({ execute }) }));

import { readEmailCard } from "./email";

beforeEach(() => {
  execute.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("readEmailCard", () => {
  it("one statement; failed and overdue only (E22)", async () => {
    execute.mockResolvedValue({ rows: [{ failed: "2", overdue: 1, to_email: "leaked@example.invalid" }] });
    const result = await readEmailCard();
    expect(result).toEqual({ kind: "ok", failed: 2, overdue: 1 });
    expect(Object.keys(result).sort()).toEqual(["failed", "kind", "overdue"]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("selects no address, subject or body, and keeps to the queue's status index", async () => {
    execute.mockResolvedValue({ rows: [{ failed: 0, overdue: 0 }] });
    await readEmailCard();
    const text = JSON.stringify(execute.mock.calls[0]![0]);
    for (const column of ["to_email", "subject", "html_body", "text_body"]) expect(text).not.toContain(column);
    expect(text).toContain("status in ('failed', 'queued')");
    expect(text).toContain("30 minutes");
  });

  it("zero is zero", async () => {
    execute.mockResolvedValue({ rows: [{ failed: 0, overdue: 0 }] });
    expect(await readEmailCard()).toEqual({ kind: "ok", failed: 0, overdue: 0 });
  });

  it("a failed read is kind: error, never zero (E5)", async () => {
    execute.mockRejectedValue(new Error("x"));
    expect(await readEmailCard()).toEqual({ kind: "error" });
  });
});
