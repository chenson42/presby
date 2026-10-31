import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const execute = vi.fn();
vi.mock("@/lib/db", () => ({ getPlatformDb: () => ({ execute }) }));

import { readAccountsCard } from "./accounts";

beforeEach(() => {
  execute.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("readAccountsCard", () => {
  it("one statement; a count of locked accounts and nothing else (E22)", async () => {
    execute.mockResolvedValue({ rows: [{ locked: "2", email: "leaked@example.invalid" }] });
    const result = await readAccountsCard();
    expect(result).toEqual({ kind: "ok", locked: 2 });
    expect(Object.keys(result).sort()).toEqual(["kind", "locked"]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(execute.mock.calls[0]![0])).toContain("locked_until > now()");
  });

  it("a failed read is kind: error, never zero (E5)", async () => {
    execute.mockRejectedValue(new Error("x"));
    expect(await readAccountsCard()).toEqual({ kind: "error" });
  });
});
