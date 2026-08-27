// @vitest-environment jsdom
/**
 * Tests for <EditRoleForm> — docs/work-log/
 * 2026-08-26-role-permissions-admin.md, Phase 4 (ux-developer).
 *
 * What this file exists to pin, per the Phase 3 design and Edge Cases:
 *
 *   - Key/name render as plain text, not editable inputs (`setRolePermissions()`
 *     has no such parameter).
 *   - The checklist is pre-checked from the role's CURRENT `permissionKeys`.
 *   - The "N people currently hold this role" copy uses the server-fetched
 *     `holderCount` at render time — this test does not imply it re-fetches.
 *   - Submits the full toggled key set via `setRolePermissionsAction`.
 *   - `escalation_denied` / `self_lockout_blocked` surface via `toast.error`
 *     with the server's own message, verbatim.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockSetRolePermissionsAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  setRolePermissionsAction: (...args: unknown[]) =>
    mockSetRolePermissionsAction(...args),
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
const mockRouterPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRouterRefresh, push: mockRouterPush }),
}));

import { EditRoleForm } from "./edit-role-form";

afterEach(() => {
  cleanup();
  mockSetRolePermissionsAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  mockRouterRefresh.mockReset();
  mockRouterPush.mockReset();
});

const CATALOG = [
  { key: "directory.view", module: "directory", description: "View the directory.", sensitivityTier: 1 },
  { key: "branding.manage", module: "branding", description: "Edit branding.", sensitivityTier: 2 },
];

const ROLE = {
  id: "role-1",
  key: "worship_committee",
  name: "Worship Committee",
  roleKind: "custom",
  isProtected: false,
  deactivatedAt: null,
  permissionKeys: ["directory.view"],
  holderCount: 4,
};

describe("EditRoleForm — read-only identity, editable permissions", () => {
  it("shows name and key as plain text, not inputs", () => {
    render(<EditRoleForm slug="alder-creek" role={ROLE} catalog={CATALOG} />);
    expect(screen.getByText("Worship Committee")).toBeTruthy();
    expect(screen.getByText(/key: worship_committee/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^key$/i)).toBeNull();
    expect(screen.queryByLabelText(/^name$/i)).toBeNull();
  });

  it("pre-checks the checklist from the role's current permissionKeys", () => {
    render(<EditRoleForm slug="alder-creek" role={ROLE} catalog={CATALOG} />);
    const directoryCheckbox = screen.getByLabelText(
      /directory\.view/i,
    ) as HTMLInputElement;
    const brandingCheckbox = screen.getByLabelText(
      /branding\.manage/i,
    ) as HTMLInputElement;
    expect(directoryCheckbox.checked).toBe(true);
    expect(brandingCheckbox.checked).toBe(false);
  });
});

describe("EditRoleForm — the holder-count copy (Phase 1 Flow 3)", () => {
  it("names the exact holderCount and states the change takes effect for all of them immediately", () => {
    render(<EditRoleForm slug="alder-creek" role={ROLE} catalog={CATALOG} />);
    expect(
      screen.getByText(
        /4 people currently hold this role — this change takes effect for all of them immediately/i,
      ),
    ).toBeTruthy();
  });

  it("uses singular phrasing for exactly one holder", () => {
    render(
      <EditRoleForm
        slug="alder-creek"
        role={{ ...ROLE, holderCount: 1 }}
        catalog={CATALOG}
      />,
    );
    expect(
      screen.getByText(/1 person currently holds this role/i),
    ).toBeTruthy();
  });

  it("says nobody holds it when holderCount is zero", () => {
    render(
      <EditRoleForm
        slug="alder-creek"
        role={{ ...ROLE, holderCount: 0 }}
        catalog={CATALOG}
      />,
    );
    expect(
      screen.getByText(/nobody currently holds this role/i),
    ).toBeTruthy();
  });
});

describe("EditRoleForm — submit and error surfacing", () => {
  it("submits the full toggled permission set and toasts success on ok", async () => {
    mockSetRolePermissionsAction.mockResolvedValueOnce({
      ok: true,
      data: { addedKeys: ["branding.manage"], removedKeys: [] },
    });

    render(<EditRoleForm slug="alder-creek" role={ROLE} catalog={CATALOG} />);
    fireEvent.click(screen.getByLabelText(/branding\.manage/i));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    });

    expect(mockSetRolePermissionsAction).toHaveBeenCalledWith(
      "alder-creek",
      "role-1",
      expect.arrayContaining(["directory.view", "branding.manage"]),
    );
    expect(toastSuccess).toHaveBeenCalled();
    expect(mockRouterRefresh).toHaveBeenCalled();
  });

  it("surfaces escalation_denied's server message via toast.error, verbatim", async () => {
    mockSetRolePermissionsAction.mockResolvedValueOnce({
      ok: false,
      error: "You can't add permissions you don't hold yourself: branding.manage.",
    });

    render(<EditRoleForm slug="alder-creek" role={ROLE} catalog={CATALOG} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    });

    expect(toastError).toHaveBeenCalledWith(
      "You can't add permissions you don't hold yourself: branding.manage.",
    );
  });

  it("surfaces self_lockout_blocked's server message via toast.error, verbatim", async () => {
    mockSetRolePermissionsAction.mockResolvedValueOnce({
      ok: false,
      error:
        "Removing this would leave nobody able to create or edit roles at this organization. Contact support if you need to change this.",
    });

    render(<EditRoleForm slug="alder-creek" role={ROLE} catalog={CATALOG} />);
    fireEvent.click(screen.getByLabelText(/directory\.view/i));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    });

    expect(toastError).toHaveBeenCalledWith(
      "Removing this would leave nobody able to create or edit roles at this organization. Contact support if you need to change this.",
    );
  });
});

describe("EditRoleForm — unsaved-changes guard (H3)", () => {
  it("intercepts a same-origin link click (standing in for page.tsx's 'Back to roles' link) once a permission is toggled", () => {
    render(
      <div>
        <a href="/o/alder-creek/admin/roles">Back to roles</a>
        <EditRoleForm slug="alder-creek" role={ROLE} catalog={CATALOG} />
      </div>,
    );

    fireEvent.click(screen.getByLabelText(/branding\.manage/i));
    fireEvent.click(screen.getByRole("link", { name: /back to roles/i }));

    expect(screen.getByText(/discard unsaved changes\?/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(mockRouterPush).toHaveBeenCalledWith("/o/alder-creek/admin/roles");
  });

  it("does not intercept the link when the checklist is untouched", () => {
    render(
      <div>
        <a href="/o/alder-creek/admin/roles">Back to roles</a>
        <EditRoleForm slug="alder-creek" role={ROLE} catalog={CATALOG} />
      </div>,
    );
    fireEvent.click(screen.getByRole("link", { name: /back to roles/i }));
    expect(screen.queryByText(/discard unsaved changes\?/i)).toBeNull();
  });

  it("re-checking the box back to its original state clears the guard again", () => {
    render(
      <div>
        <a href="/o/alder-creek/admin/roles">Back to roles</a>
        <EditRoleForm slug="alder-creek" role={ROLE} catalog={CATALOG} />
      </div>,
    );
    const checkbox = screen.getByLabelText(/branding\.manage/i);
    fireEvent.click(checkbox);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("link", { name: /back to roles/i }));
    expect(screen.queryByText(/discard unsaved changes\?/i)).toBeNull();
  });

  it("saving successfully clears the guard for the new permission set", async () => {
    mockSetRolePermissionsAction.mockResolvedValueOnce({
      ok: true,
      data: { addedKeys: ["branding.manage"], removedKeys: [] },
    });
    render(
      <div>
        <a href="/o/alder-creek/admin/roles">Back to roles</a>
        <EditRoleForm slug="alder-creek" role={ROLE} catalog={CATALOG} />
      </div>,
    );
    fireEvent.click(screen.getByLabelText(/branding\.manage/i));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    });

    fireEvent.click(screen.getByRole("link", { name: /back to roles/i }));
    expect(screen.queryByText(/discard unsaved changes\?/i)).toBeNull();
  });
});
