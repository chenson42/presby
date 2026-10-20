// @vitest-environment jsdom
/**
 * The giving team list (docs/work-log/2026-10-15-online-giving.md, R3): who
 * holds what in words, an AlertDialog-confirmed "End this role" only on grants
 * this page may end, and the last-manager refusal shown to the user.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const revokeGivingRoleAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ revokeGivingRoleAction: (...a: unknown[]) => revokeGivingRoleAction(...a) }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { TeamList } from "./team-list";

const grant = (over: Record<string, unknown> = {}) => ({
  grantId: "g1", roleId: "r1", roleKey: "treasurer", roleName: "Treasurer",
  grantee: { kind: "person", personId: "p1", displayName: "Tess Treasurer" }, startsOn: "2026-03-01",
  givingKeys: ["giving.manage", "giving.record", "giving.view"], endableHere: true, ...over,
}) as never;

afterEach(() => {
  cleanup();
  for (const fn of [revokeGivingRoleAction, refresh, toastSuccess, toastError]) fn.mockReset();
});

describe("TeamList", () => {
  it("empty: a designed state", () => {
    render(<TeamList slug="s" grants={[]} />);
    expect(screen.getByText("No one holds a giving role yet")).toBeTruthy();
  });

  it("names the person, the role and what it can do, in words", () => {
    render(<TeamList slug="s" grants={[grant()]} />);
    expect(screen.getByText("Tess Treasurer")).toBeTruthy();
    expect(screen.getByText(/Treasurer · since/)).toBeTruthy();
    for (const word of ["Manage giving", "Record gifts", "View giving"]) expect(screen.getByText(word)).toBeTruthy();
  });

  it("ending a role asks in an AlertDialog first, then calls the action with the grant id", async () => {
    revokeGivingRoleAction.mockResolvedValue({ ok: true });
    render(<TeamList slug="alder-creek" grants={[grant()]} />);
    fireEvent.click(screen.getByRole("button", { name: "End this role" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/Tess Treasurer.s Treasurer role/);
    expect(revokeGivingRoleAction).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "End role" }));
    await waitFor(() => expect(revokeGivingRoleAction).toHaveBeenCalledWith("alder-creek", { grantId: "g1" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Tess Treasurer no longer has this role."));
    expect(refresh).toHaveBeenCalled();
  });

  it("the last-manager block is shown, not swallowed", async () => {
    revokeGivingRoleAction.mockResolvedValue({ ok: false, error: "That would leave no one able to manage giving. Give the role to someone else first." });
    render(<TeamList slug="s" grants={[grant()]} />);
    fireEvent.click(screen.getByRole("button", { name: "End this role" }));
    fireEvent.click(await screen.findByRole("button", { name: "End role" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/no one able to manage giving/)));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a group grant or a mixed-permission role has NO end control here and says where to go", () => {
    render(<TeamList slug="s" grants={[grant({ grantId: "g2", endableHere: false, grantee: { kind: "group", groupName: "Finance Team" } })]} />);
    expect(screen.getByText("Finance Team (group)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "End this role" })).toBeNull();
    expect(screen.getByText(/managed under Roles/)).toBeTruthy();
  });
});
