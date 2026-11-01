import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const execute = vi.fn();
vi.mock("@/lib/db", () => ({ getPlatformDb: () => ({ execute }) }));

import { readContactMessagesCard } from "./messages";

beforeEach(() => {
  execute.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("readContactMessagesCard", () => {
  it("one statement, one number (E18, E22)", async () => {
    execute.mockResolvedValue({ rows: [{ new_count: 4, name: "Leaked", email: "leak@example.invalid", message: "Leaked" }] });
    const result = await readContactMessagesCard();
    expect(result).toEqual({ kind: "ok", newCount: 4 });
    expect(Object.keys(result).sort()).toEqual(["kind", "newCount"]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("zero is zero", async () => {
    execute.mockResolvedValue({ rows: [{ new_count: 0 }] });
    expect(await readContactMessagesCard()).toEqual({ kind: "ok", newCount: 0 });
  });

  it("a failed read is kind: error, never zero (E5)", async () => {
    execute.mockRejectedValue(new Error("x"));
    expect(await readContactMessagesCard()).toEqual({ kind: "error" });
  });

  it("counts only new messages in a statement that names no personal column", async () => {
    execute.mockResolvedValue({ rows: [{ new_count: 1 }] });
    await readContactMessagesCard();
    const text = JSON.stringify(execute.mock.calls[0]?.[0] ?? {});
    expect(text).toContain("help_contact_messages");
    expect(text).toContain("status = 'new'");
    expect(text).not.toMatch(/\b(name|email|congregation|message)\b\s*(,|from)/);
  });
});
