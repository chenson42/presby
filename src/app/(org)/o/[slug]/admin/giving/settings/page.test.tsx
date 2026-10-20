// @vitest-environment jsdom
/**
 * `/o/<slug>/admin/giving/settings` page (docs/work-log/2026-10-15-online-giving.md,
 * Batch 2, R5): giving.manage, the "what blocks a statement run" panel in words,
 * and the honest load-error state.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const gate = vi.fn();
vi.mock("../giving-page-gate", () => ({ gateGivingPage: (...a: unknown[]) => gate(...a) }));
const getGivingSettings = vi.fn();
vi.mock("@/lib/giving/settings", () => ({ getGivingSettings: (...a: unknown[]) => getGivingSettings(...a) }));
const { OrgAccessError } = vi.hoisted(() => ({ OrgAccessError: class OrgAccessError extends Error {} }));
vi.mock("@/lib/authz", () => ({ OrgAccessError }));
vi.mock("./settings-form", () => ({ SettingsForm: ({ initial }: { initial: { doneeLegalName: string | null } }) => <div data-testid="settings-form">{initial.doneeLegalName ?? "blank"}</div> }));

import GivingSettingsPage from "./page";

const OK = { ok: true, userId: "u1", org: { personId: "p1", organizationId: "o1", name: "Alder Creek Presbyterian Church", organizationType: "congregation", slug: "alder-creek" }, has: { view: false, record: false, manage: true } };
const params = Promise.resolve({ slug: "alder-creek" });
const settings = (over: Record<string, unknown> = {}) => ({ doneeLegalName: null, ...over });

afterEach(() => {
  cleanup();
  gate.mockReset();
  getGivingSettings.mockReset();
});

describe("GivingSettingsPage", () => {
  it("asks the gate for giving.manage", async () => {
    gate.mockResolvedValue(OK);
    getGivingSettings.mockResolvedValue({ kind: "ok", settings: settings(), blockers: [], saved: false });
    await GivingSettingsPage({ params });
    expect(gate).toHaveBeenCalledWith({ slug: "alder-creek", path: "/o/alder-creek/admin/giving/settings", anyOf: ["manage"], section: "Statement details" });
  });

  it("names exactly what blocks a statement run", async () => {
    gate.mockResolvedValue(OK);
    getGivingSettings.mockResolvedValue({ kind: "ok", settings: settings(), blockers: ["donee_name", "donee_address"], saved: false });
    render(await GivingSettingsPage({ params }));
    const box = screen.getByTestId("statement-blockers");
    expect(box.textContent).toMatch(/Statements can.t be issued yet/);
    expect(box.textContent).toMatch(/legal name of the church/);
    expect(box.textContent).toMatch(/complete mailing address/);
    expect(screen.getByTestId("settings-form")).toBeTruthy();
  });

  it("only the address missing names only the address; nothing missing says it is complete", async () => {
    gate.mockResolvedValue(OK);
    getGivingSettings.mockResolvedValue({ kind: "ok", settings: settings({ doneeLegalName: "Fixture Church" }), blockers: ["donee_address"], saved: true });
    render(await GivingSettingsPage({ params }));
    expect(screen.getByTestId("statement-blockers").textContent).not.toMatch(/legal name/);
    expect(screen.getByTestId("statement-blockers").textContent).toMatch(/mailing address/);
    cleanup();
    getGivingSettings.mockResolvedValue({ kind: "ok", settings: settings({ doneeLegalName: "Fixture Church" }), blockers: [], saved: true });
    render(await GivingSettingsPage({ params }));
    expect(screen.queryByTestId("statement-blockers")).toBeNull();
    expect(screen.getByTestId("statement-ready")).toBeTruthy();
    expect(screen.getByTestId("settings-form").textContent).toBe("Fixture Church");
  });

  it("returns the gate's refusal untouched; a read failure is the load-error state; an OrgAccessError is rethrown", async () => {
    gate.mockResolvedValue({ ok: false, node: <p>REFUSED</p> });
    render(await GivingSettingsPage({ params }));
    expect(screen.getByText("REFUSED")).toBeTruthy();
    expect(getGivingSettings).not.toHaveBeenCalled();
    cleanup();
    gate.mockResolvedValue(OK);
    getGivingSettings.mockRejectedValue(new Error("reset"));
    render(await GivingSettingsPage({ params }));
    expect(screen.getByText(/we can.t load giving right now/i)).toBeTruthy();
    getGivingSettings.mockRejectedValue(new OrgAccessError("gone"));
    await expect(GivingSettingsPage({ params })).rejects.toBeInstanceOf(OrgAccessError);
  });
});
