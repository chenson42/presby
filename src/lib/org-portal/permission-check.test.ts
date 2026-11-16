import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { holdsPermissions } from "./permission-check";
import { holdsPermissions as treasuryHolds } from "@/lib/treasury/keys";
import type { OrgTx } from "@/lib/authz";

const viewer = { personId: "11111111-1111-4111-8111-111111111111", organizationId: "22222222-2222-4222-8222-222222222222" };

function txReturning(row: Record<string, unknown> | undefined) {
  const execute = vi.fn(async () => ({ rows: row ? [row] : [] }));
  return { tx: { execute } as unknown as OrgTx, execute };
}

describe("holdsPermissions (DECISION-338)", () => {
  it("maps each key to its own column, true only on a strict true", async () => {
    const { tx, execute } = txReturning({ k0: true, k1: false, k2: "t" });
    expect(await holdsPermissions(tx, viewer, ["a.manage", "b.manage", "c.manage"])).toEqual([true, false, false]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the read returns no row", async () => {
    const { tx } = txReturning(undefined);
    expect(await holdsPermissions(tx, viewer, ["a.manage", "b.manage"])).toEqual([false, false]);
  });

  it("is the same function the treasury alias exports", () => {
    expect(treasuryHolds).toBe(holdsPermissions);
  });
});
