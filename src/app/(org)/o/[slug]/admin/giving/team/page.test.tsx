// @vitest-environment jsdom
/**
 * `/o/<slug>/admin/giving/team` page (docs/work-log/2026-10-15-online-giving.md,
 * R3 / F138, Batch 2): giving.manage, the current team, the roles-to-set-up
 * block, and the honest load-error state.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const gate = vi.fn();
vi.mock("../giving-page-gate", () => ({ gateGivingPage: (...a: unknown[]) => gate(...a) }));
const listGivingTeam = vi.fn();
vi.mock("@/lib/giving/team", () => ({ listGivingTeam: (...a: unknown[]) => listGivingTeam(...a) }));
const { OrgAccessError } = vi.hoisted(() => ({ OrgAccessError: class OrgAccessError extends Error {} }));
vi.mock("@/lib/authz", () => ({ OrgAccessError }));
vi.mock("./team-list", () => ({ TeamList: ({ grants }: { grants: unknown[] }) => <div data-testid="team-list">{grants.length} grants</div> }));
vi.mock("./grant-form", () => ({ GrantGivingRoleForm: ({ roles, people }: { roles: unknown[]; people: unknown[] }) => <div data-testid="grant-form">{roles.length}/{people.length}</div> }));
vi.mock("./setup-role-button", () => ({ SetUpRoleButton: ({ label }: { label: string }) => <button type="button">{label}</button> }));

import GivingTeamPage from "./page";

const OK = { ok: true, userId: "u1", org: { personId: "p1", organizationId: "o1", name: "Alder Creek Presbyterian Church", organizationType: "congregation", slug: "alder-creek" }, has: { view: false, record: false, manage: true } };
const params = Promise.resolve({ slug: "alder-creek" });
const team = (over: Record<string, unknown> = {}) => ({ kind: "ok", grants: [{ grantId: "g1" }], assignableRoles: [{ id: "r1" }], people: [{ personId: "x" }, { personId: "y" }], missingTemplates: [], ...over });

afterEach(() => {
  cleanup();
  gate.mockReset();
  listGivingTeam.mockReset();
});

describe("GivingTeamPage", () => {
  it("asks the gate for giving.manage and renders the team and the grant form with the roles and people it was given", async () => {
    gate.mockResolvedValue(OK);
    listGivingTeam.mockResolvedValue(team());
    render(await GivingTeamPage({ params }));
    expect(gate).toHaveBeenCalledWith({ slug: "alder-creek", path: "/o/alder-creek/admin/giving/team", anyOf: ["manage"], section: "Giving team" });
    expect(screen.getByRole("heading", { level: 1, name: "Giving team" })).toBeTruthy();
    expect(screen.getByText(/signs in with two-factor authentication/)).toBeTruthy();
    expect(screen.getByTestId("team-list").textContent).toBe("1 grants");
    expect(screen.getByTestId("grant-form").textContent).toBe("1/2");
    expect(screen.queryByRole("heading", { name: "Roles to set up" })).toBeNull();
  });

  it("offers to set up exactly the giving templates the church has no active role for", async () => {
    gate.mockResolvedValue(OK);
    listGivingTeam.mockResolvedValue(team({ missingTemplates: ["giving_recorder"] }));
    render(await GivingTeamPage({ params }));
    expect(screen.getByRole("heading", { name: "Roles to set up" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set up the Giving Recorder role" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Set up the Treasurer role" })).toBeNull();
    cleanup();
    listGivingTeam.mockResolvedValue(team({ missingTemplates: ["treasurer", "giving_recorder"] }));
    render(await GivingTeamPage({ params }));
    expect(screen.getAllByRole("button", { name: /^Set up the/ })).toHaveLength(2);
  });

  it("returns the gate's refusal untouched; a read failure is the load-error state; an OrgAccessError is rethrown", async () => {
    gate.mockResolvedValue({ ok: false, node: <p>REFUSED</p> });
    render(await GivingTeamPage({ params }));
    expect(screen.getByText("REFUSED")).toBeTruthy();
    expect(listGivingTeam).not.toHaveBeenCalled();
    cleanup();
    gate.mockResolvedValue(OK);
    listGivingTeam.mockRejectedValue(new Error("reset"));
    render(await GivingTeamPage({ params }));
    expect(screen.getByText(/we can.t load giving right now/i)).toBeTruthy();
    expect(screen.queryByTestId("team-list")).toBeNull();
    listGivingTeam.mockRejectedValue(new OrgAccessError("gone"));
    await expect(GivingTeamPage({ params })).rejects.toBeInstanceOf(OrgAccessError);
  });
});
