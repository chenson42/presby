/**
 * Orchestration test for updateGivingSettingsAction (docs/work-log/
 * 2026-10-15-online-giving.md, Batch 2): giving.manage, validation before
 * the write, and ONE audit event carrying the NAMES of the changed fields.
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
  AUDIT_ACTIONS: { GIVING_SETTINGS_CHANGED: "tenant.giving_settings.changed" },
  recordAudit: (...a: unknown[]) => recordAudit(...a),
}));
const update = vi.hoisted(() => vi.fn());
vi.mock("@/lib/giving/settings", () => ({ updateGivingSettings: (...a: unknown[]) => update(...a) }));
const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

import { updateGivingSettingsAction } from "./actions";

const IDENTITY = { ok: true, userId: "user-1", personId: "person-1", organizationId: "org-1", has: { view: true, record: true, manage: true } };

afterEach(() => {
  gate.mockReset();
  recordAudit.mockClear();
  update.mockReset();
  revalidatePath.mockReset();
});

describe("updateGivingSettingsAction", () => {
  it("asks for giving.manage and returns the gate's refusal untouched", async () => {
    gate.mockResolvedValue({ ok: false, error: "nope" });
    expect(await updateGivingSettingsAction("s", {})).toEqual({ ok: false, error: "nope" });
    expect(gate).toHaveBeenCalledWith("s", ["manage"]);
    expect(update).not.toHaveBeenCalled();
  });

  it("returns inline errors for the shapes the migration CHECKs enforce", async () => {
    gate.mockResolvedValue(IDENTITY);
    const result = await updateGivingSettingsAction("s", { doneeRegion: "Ohio", doneePostalCode: "123", doneeEin: "1", greetingText: "Dear {nope}," });
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { doneeRegion: expect.any(String), doneePostalCode: expect.any(String), doneeEin: expect.any(String), greetingText: expect.any(String) },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("audits field NAMES only - never the legal name, address or EIN", async () => {
    gate.mockResolvedValue(IDENTITY);
    update.mockResolvedValue({ kind: "ok", changedFields: ["doneeLegalName", "doneeEin"] });
    expect(await updateGivingSettingsAction("alder-creek", { doneeLegalName: "Fixture Presbyterian Church", doneeEin: "00-0000000" })).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith("person-1", "org-1", "user-1", expect.objectContaining({ doneeLegalName: "Fixture Presbyterian Church" }));
    expect(recordAudit).toHaveBeenCalledWith({
      action: "tenant.giving_settings.changed",
      resourceType: "giving_settings",
      resourceId: "org-1",
      metadata: { organizationId: "org-1", fields: ["doneeLegalName", "doneeEin"] },
    });
    expect(JSON.stringify(recordAudit.mock.calls)).not.toMatch(/Fixture Presbyterian|00-0000000/);
    expect(revalidatePath).toHaveBeenCalledWith("/o/alder-creek/admin/giving/settings");
  });

  it("a save that changes nothing writes no audit row", async () => {
    gate.mockResolvedValue(IDENTITY);
    update.mockResolvedValue({ kind: "ok", changedFields: [] });
    expect(await updateGivingSettingsAction("s", {})).toEqual({ ok: true });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("a library 'forbidden' (key lost mid-request) is a plain refusal with no audit", async () => {
    gate.mockResolvedValue(IDENTITY);
    update.mockResolvedValue({ kind: "forbidden" });
    expect(await updateGivingSettingsAction("s", {})).toMatchObject({ ok: false, error: expect.stringMatching(/permission/) });
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
