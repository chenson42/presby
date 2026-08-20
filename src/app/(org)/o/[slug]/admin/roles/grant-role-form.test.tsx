// @vitest-environment jsdom
/**
 * Tests for <GrantRoleForm> — P9 commit 3/3.
 *
 * `./actions` is mocked: it is a "use server" module whose real
 * implementation pulls `@/lib/role-grants` (and, transitively, the Neon
 * pool) into the module graph, which a unit test has no business booting —
 * same reasoning as `brand-form.test.tsx`'s header, which this file mirrors.
 *
 * What this file exists to pin, per the Phase 3 design and this pipeline's
 * brief:
 *
 *   - Finding 3 (no wildcard template): the role `<select>` renders EXACTLY
 *     `options.roles.length` `<option>`s — no "select all", no synthesized
 *     extra entry.
 *   - `options.roles.length === 0` renders a single sentence and NO controls
 *     at all.
 *   - Only the relevant native `<select>` (person or group) is visible at a
 *     time.
 *   - An empty target list for the selected kind disables submit with
 *     inline copy, rather than allowing a submission with no valid
 *     selection.
 *   - `escalation_denied` / `forbidden` errors surface via `toast.error`
 *     with the server's own message — never swallowed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockGrantRoleAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  grantRoleAction: (...args: unknown[]) => mockGrantRoleAction(...args),
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

import { GrantRoleForm } from "./grant-role-form";

afterEach(() => {
  cleanup();
  mockGrantRoleAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  mockRouterRefresh.mockReset();
});

const OPTIONS = {
  roles: [
    { id: "role-1", key: "stated_clerk", name: "Stated Clerk" },
    { id: "role-2", key: "viewer", name: "Viewer" },
  ],
  people: [
    { personId: "person-1", displayName: "Tobias Renwick" },
    { personId: "person-2", displayName: "Marguerite Ashcombe" },
  ],
  groups: [{ groupId: "group-1", name: "Session", derived: true }],
};

describe("GrantRoleForm — zero-roles state", () => {
  it("renders a single sentence and no controls when options.roles.length === 0", () => {
    render(
      <GrantRoleForm
        slug="alder-creek"
        options={{ roles: [], people: [], groups: [] }}
      />,
    );
    expect(
      screen.getByText(/no roles have been set up for this organization/i),
    ).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("GrantRoleForm — no wildcard template (Phase 1 finding 3)", () => {
  it("the role select renders exactly options.roles.length options, no 'select all'", () => {
    render(<GrantRoleForm slug="alder-creek" options={OPTIONS} />);
    const roleSelect = screen.getByLabelText(/^role$/i) as HTMLSelectElement;
    expect(roleSelect.options.length).toBe(OPTIONS.roles.length);
    expect(Array.from(roleSelect.options).map((o) => o.textContent)).toEqual([
      "Stated Clerk",
      "Viewer",
    ]);
  });
});

describe("GrantRoleForm — target kind toggle", () => {
  it("shows only the person select by default, hides the group select", () => {
    render(<GrantRoleForm slug="alder-creek" options={OPTIONS} />);
    expect(screen.getByLabelText(/^person$/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^group$/i)).toBeNull();
  });

  it("switches to the group select when the group radio is chosen, hides the person select", () => {
    render(<GrantRoleForm slug="alder-creek" options={OPTIONS} />);
    fireEvent.click(screen.getByRole("radio", { name: /a group/i }));
    expect(screen.getByLabelText(/^group$/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^person$/i)).toBeNull();
  });
});

describe("GrantRoleForm — empty target list disables submit", () => {
  it("disables submit and shows inline copy when there are no eligible people", () => {
    render(
      <GrantRoleForm
        slug="alder-creek"
        options={{ ...OPTIONS, people: [] }}
      />,
    );
    expect(
      screen.getByText(/nobody has a current membership/i),
    ).toBeTruthy();
    const submit = screen.getByRole("button", { name: /grant role/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables submit and shows inline copy when there are no groups, after switching to group", () => {
    render(
      <GrantRoleForm
        slug="alder-creek"
        options={{ ...OPTIONS, groups: [] }}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: /a group/i }));
    expect(screen.getByText(/no groups exist/i)).toBeTruthy();
    const submit = screen.getByRole("button", { name: /grant role/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("GrantRoleForm — submit and error surfacing", () => {
  it("submits the selected role and person target, toasts success on ok", async () => {
    mockGrantRoleAction.mockResolvedValueOnce({
      ok: true,
      data: { grantId: "grant-1" },
    });

    render(<GrantRoleForm slug="alder-creek" options={OPTIONS} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /grant role/i }));
    });

    expect(mockGrantRoleAction).toHaveBeenCalledWith("alder-creek", {
      roleId: "role-1",
      target: { kind: "person", personId: "person-1" },
    });
    expect(toastSuccess).toHaveBeenCalled();
    // Confirmed live in a real-browser walkthrough: revalidatePath() alone
    // does not re-render an already-mounted page — router.refresh() is what
    // makes the new grant appear without a manual reload.
    expect(mockRouterRefresh).toHaveBeenCalled();
  });

  it("surfaces escalation_denied's server message via toast.error, verbatim — not swallowed", async () => {
    mockGrantRoleAction.mockResolvedValueOnce({
      ok: false,
      error:
        "You can't grant permissions you don't hold yourself: financial.approve.",
    });

    render(<GrantRoleForm slug="alder-creek" options={OPTIONS} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /grant role/i }));
    });

    expect(toastError).toHaveBeenCalledWith(
      "You can't grant permissions you don't hold yourself: financial.approve.",
    );
  });

  it("surfaces a forbidden message via toast.error, verbatim", async () => {
    mockGrantRoleAction.mockResolvedValueOnce({
      ok: false,
      error: "You don't have permission to grant roles here.",
    });

    render(<GrantRoleForm slug="alder-creek" options={OPTIONS} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /grant role/i }));
    });

    expect(toastError).toHaveBeenCalledWith(
      "You don't have permission to grant roles here.",
    );
  });
});
