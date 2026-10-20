/**
 * Orchestration tests for the funds server actions (docs/work-log/
 * 2026-10-15-online-giving.md, Batch 2). The SQL is proven by
 * src/lib/giving/funds.db.test.ts; this pins what the action layer owns: the
 * gate is asked for `manage`, input is validated BEFORE the library runs, each
 * result maps to the right message, and the audit fires AFTER success only,
 * with ids and flags - never a fund's name.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/action-gate", async () => {
  const { zodFieldErrors } = await import("@/lib/giving/field-errors");
  return {
    gateGivingAction: (...a: unknown[]) => gate(...a),
    invalidInput: (e: import("zod").ZodError) => ({ ok: false, error: "Check the highlighted fields and try again.", fieldErrors: zodFieldErrors(e) }),
  };
});
const recordAudit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@/lib/audit", () => ({
  AUDIT_ACTIONS: {
    GIVING_FUND_CREATED: "tenant.giving_fund.created",
    GIVING_FUND_UPDATED: "tenant.giving_fund.updated",
    GIVING_FUND_RETIRED: "tenant.giving_fund.retired",
    GIVING_FUND_REACTIVATED: "tenant.giving_fund.reactivated",
  },
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));
const lib = vi.hoisted(() => ({ createFund: vi.fn(), updateFund: vi.fn(), retireFund: vi.fn(), reactivateFund: vi.fn() }));
vi.mock("@/lib/giving/funds", () => lib);
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import {
  createFundAction,
  createGeneralFundAction,
  reactivateFundAction,
  retireFundAction,
  updateFundAction,
} from "./actions";

const IDENTITY = { ok: true, userId: "user-1", personId: "person-1", organizationId: "org-1", has: { view: true, record: true, manage: true } };
const FUND_ID = "11111111-1111-4111-8111-111111111111";
const valid = { name: "Building Fund", restrictionClass: "temporarily_restricted", offeredOnline: true, onlineDisplayName: "Building Fund" };

afterEach(() => {
  gate.mockReset();
  recordAudit.mockClear();
  revalidatePath.mockReset();
  for (const fn of Object.values(lib)) fn.mockReset();
});

describe("every fund action asks the gate for giving.manage first", () => {
  it("returns the gate's refusal untouched and runs nothing else", async () => {
    gate.mockResolvedValue({ ok: false, error: "You don't have permission to do that." });
    for (const call of [
      () => createFundAction("s", valid),
      () => updateFundAction("s", { ...valid, fundId: FUND_ID }),
      () => retireFundAction("s", { fundId: FUND_ID }),
      () => reactivateFundAction("s", { fundId: FUND_ID }),
      () => createGeneralFundAction("s"),
    ]) {
      expect(await call()).toEqual({ ok: false, error: "You don't have permission to do that." });
    }
    expect(gate).toHaveBeenCalledWith("s", ["manage"]);
    for (const fn of Object.values(lib)) expect(fn).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("createFundAction", () => {
  it("validates before the library: an offered-online fund without a public name is an inline error", async () => {
    gate.mockResolvedValue(IDENTITY);
    const result = await createFundAction("s", { name: "X", restrictionClass: "unrestricted", offeredOnline: true });
    expect(result).toMatchObject({ ok: false, fieldErrors: { onlineDisplayName: expect.stringMatching(/name donors will see/) } });
    expect(lib.createFund).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("maps duplicate_name to an inline name error and audits nothing", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.createFund.mockResolvedValue({ kind: "duplicate_name" });
    const result = await createFundAction("s", valid);
    expect(result).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String) } });
    expect(recordAudit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("on ok: audits with ids and flags only (no fund name), revalidates, returns the id", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.createFund.mockResolvedValue({ kind: "ok", fundId: FUND_ID });
    const result = await createFundAction("alder-creek", valid);
    expect(result).toEqual({ ok: true, data: { fundId: FUND_ID } });
    expect(lib.createFund).toHaveBeenCalledWith("person-1", "org-1", "user-1", expect.objectContaining({ name: "Building Fund" }));
    expect(recordAudit).toHaveBeenCalledWith({
      action: "tenant.giving_fund.created",
      resourceType: "giving_fund",
      resourceId: FUND_ID,
      metadata: { organizationId: "org-1", fundId: FUND_ID, restrictionClass: "temporarily_restricted", offeredOnline: true },
    });
    expect(JSON.stringify(recordAudit.mock.calls)).not.toContain("Building Fund");
    expect(revalidatePath).toHaveBeenCalledWith("/o/alder-creek/admin/giving/funds");
  });

  it("the empty state's one-click action creates an unrestricted General Fund that is NOT online", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.createFund.mockResolvedValue({ kind: "ok", fundId: FUND_ID });
    await createGeneralFundAction("s");
    expect(lib.createFund).toHaveBeenCalledWith("person-1", "org-1", "user-1", expect.objectContaining({ name: "General Fund", restrictionClass: "unrestricted", offeredOnline: false }));
  });
});

describe("updateFundAction", () => {
  it("audits the changed field NAMES; an edit that changes nothing writes no audit row", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.updateFund.mockResolvedValue({ kind: "ok", changedFields: ["name", "description"] });
    expect(await updateFundAction("s", { ...valid, fundId: FUND_ID })).toEqual({ ok: true });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "tenant.giving_fund.updated",
      metadata: { organizationId: "org-1", fundId: FUND_ID, fields: ["name", "description"] },
    }));
    recordAudit.mockClear();
    lib.updateFund.mockResolvedValue({ kind: "ok", changedFields: [] });
    expect(await updateFundAction("s", { ...valid, fundId: FUND_ID })).toEqual({ ok: true });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("maps not_found and duplicate_name", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.updateFund.mockResolvedValue({ kind: "not_found" });
    expect(await updateFundAction("s", { ...valid, fundId: FUND_ID })).toEqual({ ok: false, error: "That fund no longer exists." });
    lib.updateFund.mockResolvedValue({ kind: "duplicate_name" });
    expect(await updateFundAction("s", { ...valid, fundId: FUND_ID })).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String) } });
  });
});

describe("retireFundAction", () => {
  it("surfaces 'confirm required' as ok-with-data so the client can open the second dialog - and audits nothing yet", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.retireFund.mockResolvedValue({ kind: "confirm_required", reason: "last_online_fund" });
    expect(await retireFundAction("s", { fundId: FUND_ID })).toEqual({ ok: true, data: { confirmRequired: "last_online_fund" } });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("passes confirm through and audits the retirement", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.retireFund.mockResolvedValue({ kind: "ok" });
    expect(await retireFundAction("s", { fundId: FUND_ID, confirm: true })).toEqual({ ok: true, data: {} });
    expect(lib.retireFund).toHaveBeenCalledWith("person-1", "org-1", "user-1", FUND_ID, { confirm: true });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "tenant.giving_fund.retired", resourceId: FUND_ID }));
  });

  it("only an explicit confirm: true counts (a truthy string does not)", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.retireFund.mockResolvedValue({ kind: "ok" });
    await retireFundAction("s", { fundId: FUND_ID, confirm: "yes" as never });
    expect(lib.retireFund).toHaveBeenCalledWith("person-1", "org-1", "user-1", FUND_ID, { confirm: false });
  });

  it("rejects a malformed id before the library runs", async () => {
    gate.mockResolvedValue(IDENTITY);
    expect(await retireFundAction("s", { fundId: "nope" })).toMatchObject({ ok: false, fieldErrors: expect.any(Object) });
    expect(lib.retireFund).not.toHaveBeenCalled();
  });
});

describe("reactivateFundAction", () => {
  it("audits success and maps already_active", async () => {
    gate.mockResolvedValue(IDENTITY);
    lib.reactivateFund.mockResolvedValue({ kind: "already_active" });
    expect(await reactivateFundAction("s", { fundId: FUND_ID })).toEqual({ ok: false, error: "That fund is already active." });
    expect(recordAudit).not.toHaveBeenCalled();
    lib.reactivateFund.mockResolvedValue({ kind: "ok" });
    expect(await reactivateFundAction("s", { fundId: FUND_ID })).toEqual({ ok: true });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "tenant.giving_fund.reactivated" }));
  });
});
