import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const list = vi.fn();
vi.mock("@/lib/sites", () => ({ listSitesForAdmin: () => list() }));

import { readSitesCard } from "./sites";

beforeEach(() => {
  list.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const site = (status: string) => ({
  organizationId: "o",
  organizationName: "Leaked Name",
  slug: "leaked",
  repo: "leaked/repo",
  status,
  lastIngestedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
});

describe("readSitesCard", () => {
  it("reduces the destination's own list to counts by status (E21)", async () => {
    list.mockResolvedValue([site("live"), site("live"), site("provisioning"), site("suspended"), site("live")]);
    const result = await readSitesCard();
    expect(result).toEqual({ kind: "ok", live: 3, provisioning: 1, suspended: 1 });
    expect(JSON.stringify(result)).not.toContain("Leaked");
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("no sites is zeros", async () => {
    list.mockResolvedValue([]);
    expect(await readSitesCard()).toEqual({ kind: "ok", live: 0, provisioning: 0, suspended: 0 });
  });

  it("a failed read is kind: error, never zero (E5)", async () => {
    list.mockRejectedValue(new Error("x"));
    expect(await readSitesCard()).toEqual({ kind: "error" });
  });
});
