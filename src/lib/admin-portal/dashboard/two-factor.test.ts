import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const count = vi.fn();
vi.mock("@/lib/admin/two-factor-stranded", () => ({ countStranded: () => count() }));

import { readTwoFactorCard } from "./two-factor";

beforeEach(() => {
  count.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("readTwoFactorCard", () => {
  it("is the shared stranded count: a number, no address (E20, E21, E22)", async () => {
    count.mockResolvedValue(4);
    const result = await readTwoFactorCard();
    expect(result).toEqual({ kind: "ok", notEnrolled: 4 });
    expect(Object.keys(result).sort()).toEqual(["kind", "notEnrolled"]);
    expect(count).toHaveBeenCalledTimes(1);
  });

  it("a failed read is kind: error, never zero (E5)", async () => {
    count.mockRejectedValue(new Error("x"));
    expect(await readTwoFactorCard()).toEqual({ kind: "error" });
  });
});
