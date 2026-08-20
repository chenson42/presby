// @vitest-environment jsdom
/**
 * Tests for <RevokeDialog> — P9 commit 3/3.
 *
 * `./actions` is mocked for the same reason `grant-role-form.test.tsx`'s
 * header gives — it is a "use server" module whose real implementation
 * pulls `@/lib/role-grants` into the module graph.
 *
 * What this file exists to pin, per the Phase 3 design and this pipeline's
 * brief:
 *   - the confirmation copy names BOTH the grantee and the role — never a
 *     generic "Are you sure?" (mirrors
 *     `(admin)/admin/organizations/[id]/neutralize-dialog.tsx`'s own A2
 *     precedent);
 *   - Cancel calls `revokeRoleAction` zero times;
 *   - Confirm calls `revokeRoleAction` with the exact grant/role/grantee
 *     identifiers passed in as props;
 *   - `self_lockout_blocked` (and any other denial) surfaces via
 *     `toast.error` with the server's own message, never a generic failure.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockRevokeRoleAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  revokeRoleAction: (...args: unknown[]) => mockRevokeRoleAction(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const mockRouterRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRouterRefresh }),
}));

import { RevokeDialog } from "./revoke-dialog";

afterEach(() => {
  cleanup();
  mockRevokeRoleAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  mockRouterRefresh.mockReset();
});

function renderDialog() {
  return render(
    <RevokeDialog
      slug="alder-creek"
      grantId="grant-1"
      roleId="role-1"
      roleKey="stated_clerk"
      roleName="Stated Clerk"
      granteeType="person"
      granteeId="person-1"
      granteeName="Tobias Renwick"
    />,
  );
}

describe("RevokeDialog — confirmation copy names both the grantee and the role", () => {
  it("shows a title naming the exact person and role, not a generic 'Are you sure?'", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^revoke$/i }));

    expect(
      screen.getByText("Revoke Stated Clerk from Tobias Renwick?"),
    ).toBeTruthy();
    expect(screen.queryByText(/^are you sure\??$/i)).toBeNull();
  });
});

describe("RevokeDialog — cancel", () => {
  it("does not call revokeRoleAction when Cancel is clicked", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^revoke$/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(mockRevokeRoleAction).not.toHaveBeenCalled();
  });
});

describe("RevokeDialog — confirm", () => {
  it("calls revokeRoleAction with the exact grant/role/grantee identifiers, and toasts success on ok", async () => {
    mockRevokeRoleAction.mockResolvedValueOnce({ ok: true });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^revoke$/i }));

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /yes, revoke stated clerk/i }),
      );
    });

    expect(mockRevokeRoleAction).toHaveBeenCalledWith("alder-creek", {
      grantId: "grant-1",
      roleId: "role-1",
      roleKey: "stated_clerk",
      granteeType: "person",
      granteeId: "person-1",
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      "Stated Clerk revoked from Tobias Renwick.",
    );
    expect(mockRouterRefresh).toHaveBeenCalled();
  });

  it("surfaces self_lockout_blocked's server message via toast.error, verbatim — not a generic failure", async () => {
    mockRevokeRoleAction.mockResolvedValueOnce({
      ok: false,
      error:
        "Revoking this would leave nobody able to grant or revoke roles at this organization. Contact support if you need to change this.",
    });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^revoke$/i }));

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /yes, revoke stated clerk/i }),
      );
    });

    expect(toastError).toHaveBeenCalledWith(
      "Revoking this would leave nobody able to grant or revoke roles at this organization. Contact support if you need to change this.",
    );
  });
});
