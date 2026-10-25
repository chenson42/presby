import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const execute = vi.fn();
vi.mock("@/lib/db", () => ({ getPlatformDb: () => ({ execute }) }));

import { readFeedbackCard } from "./feedback";

beforeEach(() => {
  execute.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("readFeedbackCard", () => {
  it("one statement, one number (E18, E22)", async () => {
    execute.mockResolvedValue({ rows: [{ new_count: 4, body: "Leaked" }] });
    const result = await readFeedbackCard();
    expect(result).toEqual({ kind: "ok", newCount: 4 });
    expect(Object.keys(result).sort()).toEqual(["kind", "newCount"]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("zero is zero", async () => {
    execute.mockResolvedValue({ rows: [{ new_count: 0 }] });
    expect(await readFeedbackCard()).toEqual({ kind: "ok", newCount: 0 });
  });

  it("a failed read is kind: error, never zero (E5)", async () => {
    execute.mockRejectedValue(new Error("x"));
    expect(await readFeedbackCard()).toEqual({ kind: "error" });
  });
});
