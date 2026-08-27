// @vitest-environment jsdom
/**
 * Tests for <DeactivateRoleDialog> — modeled on `../../revoke-dialog.test.tsx`
 * (same file mirrors `revoke-dialog.tsx`'s own shape). Pins:
 *
 *   - An `AlertDialog`, never `confirm()` (Workflow Rule 2) — no native
 *     dialog API is ever invoked.
 *   - The confirmation copy NAMES `holderCount` and states grants are ENDED,
 *     never that the role is deleted.
 *   - `self_lockout_blocked` (or any other denial) surfaces via
 *     `toast.error` with the server's own message, verbatim — the dialog
 *     does not close silently on failure.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockDeactivateRoleAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  deactivateRoleAction: (...args: unknown[]) => mockDeactivateRoleAction(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const mockRouterPush = vi.hoisted(() => vi.fn());
const mockRouterRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush, refresh: mockRouterRefresh }),
}));

import { DeactivateRoleDialog } from "./deactivate-role-dialog";

afterEach(() => {
  cleanup();
  mockDeactivateRoleAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  mockRouterPush.mockReset();
  mockRouterRefresh.mockReset();
});

describe("DeactivateRoleDialog — confirmation copy", () => {
  it("names the holder count and states grants are ENDED, not the role deleted", () => {
    render(
      <DeactivateRoleDialog
        slug="alder-creek"
        roleId="role-1"
        roleName="Worship Committee"
        holderCount={3}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /deactivate role/i }),
    );
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/3 people currently hold this role/i);
    expect(body).toMatch(/ends every current grant/i);
    expect(body).toMatch(/the role itself is not deleted/i);
  });

  it("says nobody holds it when holderCount is zero", () => {
    render(
      <DeactivateRoleDialog
        slug="alder-creek"
        roleId="role-1"
        roleName="Worship Committee"
        holderCount={0}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /deactivate role/i }),
    );
    expect(
      screen.getByText(/nobody currently holds this role/i),
    ).toBeTruthy();
  });
});

describe("DeactivateRoleDialog — confirm and error surfacing", () => {
  it("calls deactivateRoleAction on confirm and toasts success", async () => {
    mockDeactivateRoleAction.mockResolvedValueOnce({ ok: true });

    render(
      <DeactivateRoleDialog
        slug="alder-creek"
        roleId="role-1"
        roleName="Worship Committee"
        holderCount={2}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /deactivate role/i }),
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /yes, deactivate worship committee/i }),
      );
    });

    expect(mockDeactivateRoleAction).toHaveBeenCalledWith("alder-creek", "role-1");
    expect(toastSuccess).toHaveBeenCalled();
    expect(mockRouterPush).toHaveBeenCalledWith("/o/alder-creek/admin/roles");
  });

  it("surfaces self_lockout_blocked's server message via toast.error, verbatim, without closing silently", async () => {
    mockDeactivateRoleAction.mockResolvedValueOnce({
      ok: false,
      error:
        "Deactivating this would leave nobody able to create or edit roles at this organization. Contact support if you need to change this.",
    });

    render(
      <DeactivateRoleDialog
        slug="alder-creek"
        roleId="role-1"
        roleName="Worship Committee"
        holderCount={1}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /deactivate role/i }),
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /yes, deactivate worship committee/i }),
      );
    });

    expect(toastError).toHaveBeenCalledWith(
      "Deactivating this would leave nobody able to create or edit roles at this organization. Contact support if you need to change this.",
    );
    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});
