import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const count = vi.fn();
vi.mock("@/lib/domains/platform-read", () => ({ countDomainsNeedingAttention: () => count() }));

import { readDomainsCard } from "./domains";

beforeEach(() => {
  count.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("readDomainsCard", () => {
  it("is the shared attention count and nothing else (E21, E22)", async () => {
    count.mockResolvedValue(3);
    expect(await readDomainsCard()).toEqual({ kind: "ok", needAttention: 3 });
    expect(count).toHaveBeenCalledTimes(1);
  });

  it("zero is zero", async () => {
    count.mockResolvedValue(0);
    expect(await readDomainsCard()).toEqual({ kind: "ok", needAttention: 0 });
  });

  it("a failed read is kind: error, never zero (E5)", async () => {
    count.mockRejectedValue(new Error("x"));
    expect(await readDomainsCard()).toEqual({ kind: "error" });
  });
});
