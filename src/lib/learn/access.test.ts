/**
 * T11 - the (org) page's toggle read (docs/work-log/2026-11-10-learn-inc1a.md, Phase 3
 * "TypeScript surface"). `withOrgContext`, `orgFeatureEnabledInTx` and the flag reads are mocked:
 * what is pinned is the composition (one transaction, the manage-permission read only when off,
 * the category axis read outside it) and that a failure is never an "off".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const tx = vi.hoisted(() => ({ execute: vi.fn() }));
const withOrgContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authz", () => ({ withOrgContext: (...a: unknown[]) => withOrgContext(...a) }));
const isFlagEnabled = vi.hoisted(() => vi.fn());
vi.mock("@/lib/flags", () => ({ isFlagEnabled: (...a: unknown[]) => isFlagEnabled(...a) }));
const orgFeatureEnabledInTx = vi.hoisted(() => vi.fn());
const isCategoryAxisOn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/org-features", () => ({
  ORG_FEATURE_CATALOG: [{ key: "org_portal.spot_the_scam", flag: null }],
  isCategoryAxisOn: () => isCategoryAxisOn(),
  orgFeatureEnabledInTx: (...a: unknown[]) => orgFeatureEnabledInTx(...a),
}));

import { getLearnPageContext } from "./access";

const VIEWER = { personId: "00000000-0000-4087-8000-000000000001", organizationId: "00000000-0000-4087-8000-0000000000a1" };

beforeEach(() => {
  for (const m of [tx.execute, withOrgContext, isFlagEnabled, orgFeatureEnabledInTx, isCategoryAxisOn]) m.mockReset();
  isCategoryAxisOn.mockResolvedValue(true);
  withOrgContext.mockImplementation(async (_p: string, _o: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
});

describe("getLearnPageContext", () => {
  it("on: one transaction for the viewer and organization, the axis read outside it, and no permission read", async () => {
    orgFeatureEnabledInTx.mockResolvedValue(true);
    expect(await getLearnPageContext(VIEWER)).toEqual({ kind: "on" });
    expect(withOrgContext).toHaveBeenCalledTimes(1);
    expect(withOrgContext.mock.calls[0]!.slice(0, 2)).toEqual([VIEWER.personId, VIEWER.organizationId]);
    expect(orgFeatureEnabledInTx).toHaveBeenCalledWith(tx, VIEWER.organizationId, "org_portal.spot_the_scam", true);
    expect(tx.execute).not.toHaveBeenCalled();
    // The catalog entry has no platform flag, so none is read.
    expect(isFlagEnabled).not.toHaveBeenCalled();
  });

  it("off for a manager: the manage permission is read in the SAME transaction", async () => {
    orgFeatureEnabledInTx.mockResolvedValue(false);
    tx.execute.mockResolvedValue({ rows: [{ allowed: true }] });
    expect(await getLearnPageContext(VIEWER)).toEqual({ kind: "off", canManageFeatures: true });
    expect(withOrgContext).toHaveBeenCalledTimes(1);
    expect(tx.execute).toHaveBeenCalledTimes(1);
  });

  it("off for a non-manager (and for a row-less answer): canManageFeatures is false", async () => {
    orgFeatureEnabledInTx.mockResolvedValue(false);
    tx.execute.mockResolvedValue({ rows: [{ allowed: false }] });
    expect(await getLearnPageContext(VIEWER)).toEqual({ kind: "off", canManageFeatures: false });
    tx.execute.mockResolvedValue({ rows: [] });
    expect(await getLearnPageContext(VIEWER)).toEqual({ kind: "off", canManageFeatures: false });
    tx.execute.mockResolvedValue([{ allowed: true }]); // the array driver shape
    expect(await getLearnPageContext(VIEWER)).toEqual({ kind: "off", canManageFeatures: true });
  });

  it("the category axis answer is handed to the composition as is (category off is off; axis off is inert, both decided there)", async () => {
    orgFeatureEnabledInTx.mockResolvedValue(false);
    tx.execute.mockResolvedValue({ rows: [{ allowed: false }] });
    isCategoryAxisOn.mockResolvedValue(false);
    await getLearnPageContext(VIEWER);
    expect(orgFeatureEnabledInTx).toHaveBeenCalledWith(tx, VIEWER.organizationId, "org_portal.spot_the_scam", false);
  });

  it("a database failure THROWS (the page renders its load error): it is never an off answer", async () => {
    orgFeatureEnabledInTx.mockRejectedValue(new Error("connection terminated"));
    await expect(getLearnPageContext(VIEWER)).rejects.toThrow("connection terminated");
    withOrgContext.mockRejectedValue(new Error("pool exhausted"));
    await expect(getLearnPageContext(VIEWER)).rejects.toThrow("pool exhausted");
  });
});
