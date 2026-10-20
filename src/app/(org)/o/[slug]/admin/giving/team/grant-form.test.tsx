// @vitest-environment jsdom
/**
 * The give-a-role form (docs/work-log/2026-10-15-online-giving.md, R3 / F138):
 * person-arm only, role options that say what they can do, a HydrationGate
 * root, and the server's reason (e.g. escalation) shown in full.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const grantGivingRoleAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ grantGivingRoleAction: (...a: unknown[]) => grantGivingRoleAction(...a) }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { GrantGivingRoleForm } from "./grant-form";

const ROLES = [
  { id: "r-rec", key: "giving_recorder", name: "Giving Recorder", givingKeys: ["giving.record"] },
  { id: "r-tre", key: "treasurer", name: "Treasurer", givingKeys: ["giving.manage", "giving.record", "giving.view"] },
];
const PEOPLE = [{ personId: "p1", displayName: "Rex Recorder" }, { personId: "p2", displayName: "Pia Plain" }];

afterEach(() => {
  cleanup();
  for (const fn of [grantGivingRoleAction, refresh, toastSuccess, toastError]) fn.mockReset();
});

describe("GrantGivingRoleForm", () => {
  it("is a HydrationGate root, with role options that say what each can do and a person list - and no 'group' choice", () => {
    const { container } = render(<GrantGivingRoleForm slug="s" roles={ROLES} people={PEOPLE} />);
    expect(container.querySelector('fieldset[data-slot="hydration-gate"]')).toBeTruthy();
    expect(screen.getByRole("option", { name: "Giving Recorder (record gifts)" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Treasurer (manage giving, record gifts, view giving)" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Pia Plain" })).toBeTruthy();
    expect(screen.queryByText(/group/i)).toBeNull();
  });

  it("grants the chosen role to the chosen person", async () => {
    grantGivingRoleAction.mockResolvedValue({ ok: true, data: { grantId: "g1" } });
    render(<GrantGivingRoleForm slug="alder-creek" roles={ROLES} people={PEOPLE} />);
    fireEvent.change(screen.getByLabelText(/^Role/), { target: { value: "r-tre" } });
    fireEvent.change(screen.getByLabelText(/^Person/), { target: { value: "p2" } });
    fireEvent.click(screen.getByRole("button", { name: "Give role" }));
    await waitFor(() => expect(grantGivingRoleAction).toHaveBeenCalledWith("alder-creek", { roleId: "r-tre", personId: "p2" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Role given."));
    expect(refresh).toHaveBeenCalled();
  });

  it("starts with NOTHING chosen and refuses to submit until a role and a person are picked (no accidental treasurer)", async () => {
    render(<GrantGivingRoleForm slug="s" roles={ROLES} people={PEOPLE} />);
    expect((screen.getByLabelText(/^Role/) as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText(/^Person/) as HTMLSelectElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Give role" }));
    await waitFor(() => expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual(["Choose a role", "Choose a person"]));
    expect(grantGivingRoleAction).not.toHaveBeenCalled();
  });

  it("shows the server's reason in full (an escalation names the keys)", async () => {
    grantGivingRoleAction.mockResolvedValue({ ok: false, error: "You can't grant permissions you don't hold yourself: giving.record." });
    render(<GrantGivingRoleForm slug="s" roles={ROLES} people={PEOPLE} />);
    fireEvent.change(screen.getByLabelText(/^Role/), { target: { value: "r-rec" } });
    fireEvent.change(screen.getByLabelText(/^Person/), { target: { value: "p1" } });
    fireEvent.click(screen.getByRole("button", { name: "Give role" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("You can't grant permissions you don't hold yourself: giving.record."));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("no giving role to hand out, or nobody to hand it to, is a sentence - not a broken form", () => {
    render(<GrantGivingRoleForm slug="s" roles={[]} people={PEOPLE} />);
    expect(screen.getByText(/no giving role to hand out yet/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    render(<GrantGivingRoleForm slug="s" roles={ROLES} people={[]} />);
    expect(screen.getByText(/Nobody has a current membership here yet/)).toBeTruthy();
  });
});
