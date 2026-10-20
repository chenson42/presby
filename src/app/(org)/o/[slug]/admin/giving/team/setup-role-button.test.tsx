// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const ensureGivingRoleAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ ensureGivingRoleAction: (...a: unknown[]) => ensureGivingRoleAction(...a) }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { SetUpRoleButton } from "./setup-role-button";

afterEach(() => {
  cleanup();
  for (const fn of [ensureGivingRoleAction, refresh, toastSuccess, toastError]) fn.mockReset();
});

describe("SetUpRoleButton (P3-18)", () => {
  it("sets up the named template and refreshes", async () => {
    ensureGivingRoleAction.mockResolvedValue({ ok: true, data: { roleId: "r1", skippedKeys: [] } });
    render(<SetUpRoleButton slug="alder-creek" templateKey="giving_recorder" label="Set up the Giving Recorder role" />);
    fireEvent.click(screen.getByRole("button", { name: "Set up the Giving Recorder role" }));
    await waitFor(() => expect(ensureGivingRoleAction).toHaveBeenCalledWith("alder-creek", { templateKey: "giving_recorder" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Role set up."));
    expect(refresh).toHaveBeenCalled();
  });

  it("says plainly which permissions it could NOT include because the user doesn't hold them", async () => {
    ensureGivingRoleAction.mockResolvedValue({ ok: true, data: { roleId: "r1", skippedKeys: ["giving.view"] } });
    render(<SetUpRoleButton slug="s" templateKey="treasurer" label="Set up the Treasurer role" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(toastSuccess.mock.calls[0]![0]).toMatch(/without giving\.view \(you don't hold it yourself\)/));
  });

  it("a refusal toasts the reason", async () => {
    ensureGivingRoleAction.mockResolvedValue({ ok: false, error: "You can't set up a role with permissions you don't hold yourself: giving.record." });
    render(<SetUpRoleButton slug="s" templateKey="giving_recorder" label="Set up" />);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/giving\.record/)));
    expect(refresh).not.toHaveBeenCalled();
  });
});
