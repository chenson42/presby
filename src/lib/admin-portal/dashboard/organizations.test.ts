import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const execute = vi.fn();
vi.mock("@/lib/db", () => ({ getPlatformDb: () => ({ execute }) }));

import { ORG_TYPE_KEYS, PLATFORM_STATUS_KEYS, readOrganizationsCard } from "./organizations";

beforeEach(() => {
  execute.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const row = {
  total: 10,
  t_general_assembly: 0,
  t_synod: 1,
  t_presbytery: 2,
  t_congregation: "6",
  t_new_worshiping_community: 1,
  s_managed: 3,
  s_invited: 1,
  s_unmanaged: 6,
  inactive: 2,
  default_palette: 7,
};

describe("readOrganizationsCard", () => {
  it("one statement, mapped into typed records (E22)", async () => {
    execute.mockResolvedValue({ rows: [row] });
    expect(await readOrganizationsCard()).toEqual({
      kind: "ok",
      total: 10,
      byType: { general_assembly: 0, synod: 1, presbytery: 2, congregation: 6, new_worshiping_community: 1 },
      byStatus: { managed: 3, invited: 1, unmanaged: 6 },
      inactive: 2,
      defaultPalette: 7,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("covers every organization type and every platform status", async () => {
    execute.mockResolvedValue({ rows: [row] });
    const result = await readOrganizationsCard();
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(Object.keys(result.byType).sort()).toEqual([...ORG_TYPE_KEYS].sort());
    expect(Object.keys(result.byStatus).sort()).toEqual([...PLATFORM_STATUS_KEYS].sort());
  });

  it("an empty install is all zeros, not an error", async () => {
    execute.mockResolvedValue({ rows: [{ total: 0 }] });
    const result = await readOrganizationsCard();
    expect(result).toMatchObject({ kind: "ok", total: 0, inactive: 0, defaultPalette: 0 });
  });

  it("a failed read is kind: error, never zero (E5)", async () => {
    execute.mockRejectedValue(new Error("x"));
    expect(await readOrganizationsCard()).toEqual({ kind: "error" });
  });
});
