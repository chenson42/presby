// @vitest-environment jsdom
/**
 * Tests for <CreateRoleForm> — docs/work-log/
 * 2026-08-26-role-permissions-admin.md, Phase 4 (ux-developer).
 *
 * `./actions` is mocked for the same reason `grant-role-form.test.tsx`'s
 * header names: it's a "use server" module whose real implementation pulls
 * `@/lib/role-definitions` (and, transitively, the Neon pool) into the
 * module graph, which a unit test has no business booting.
 *
 * What this file exists to pin, per the Phase 3 design and Edge Cases:
 *
 *   - The permission checklist is TIER-GROUPED (1/directory, 2/financial,
 *     3/pastoral-demographic-medical) — the tier-3 boundary must be visible,
 *     not buried in a flat list.
 *   - "Create a custom role" posts to `createRoleAction` with the actor's
 *     freely-toggled permission set.
 *   - "Adopt a template" (only rendered when templates exist) posts to
 *     `adoptTemplateAction`, a DIFFERENT action, with the template's own id —
 *     never a bypass of the create path.
 *   - `escalation_denied` / `duplicate_key` / `invalid_input` surface via
 *     `toast.error` with the server's own message, verbatim.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";

const mockCreateRoleAction = vi.hoisted(() => vi.fn());
const mockAdoptTemplateAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  createRoleAction: (...args: unknown[]) => mockCreateRoleAction(...args),
  adoptTemplateAction: (...args: unknown[]) => mockAdoptTemplateAction(...args),
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

import { CreateRoleForm } from "./create-role-form";

afterEach(() => {
  cleanup();
  mockCreateRoleAction.mockReset();
  mockAdoptTemplateAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  mockRouterPush.mockReset();
  mockRouterRefresh.mockReset();
});

const CATALOG = [
  { key: "directory.view", module: "directory", description: "View the directory.", sensitivityTier: 1 },
  { key: "branding.manage", module: "branding", description: "Edit branding.", sensitivityTier: 2 },
  { key: "member.view_medical", module: "members", description: "View medical notes.", sensitivityTier: 3 },
];

describe("CreateRoleForm — tier-grouped checklist", () => {
  it("groups permissions under their own tier heading, tier-3 visible and not flattened", () => {
    render(<CreateRoleForm slug="alder-creek" catalog={CATALOG} templates={[]} />);
    expect(screen.getByText(/tier 1 — directory/i)).toBeTruthy();
    expect(screen.getByText(/tier 2 — financial/i)).toBeTruthy();
    expect(
      screen.getByText(/tier 3 — pastoral, demographic, and medical/i),
    ).toBeTruthy();
    expect(screen.getByText("directory.view")).toBeTruthy();
    expect(screen.getByText("member.view_medical")).toBeTruthy();
  });

  it("checking a permission is reflected in its own tier group's selected count", () => {
    render(<CreateRoleForm slug="alder-creek" catalog={CATALOG} templates={[]} />);
    const tier1 = screen.getByText(/tier 1 — directory/i).closest("details")!;
    expect(within(tier1).getByText(/\(0\/1 selected\)/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/directory\.view/i));
    expect(within(tier1).getByText(/\(1\/1 selected\)/)).toBeTruthy();
  });
});

describe("CreateRoleForm — no templates", () => {
  it("does not render the 'Or adopt a template' section when templates is empty", () => {
    render(<CreateRoleForm slug="alder-creek" catalog={CATALOG} templates={[]} />);
    expect(screen.queryByText(/or adopt a template/i)).toBeNull();
  });
});

describe("CreateRoleForm — create a custom role", () => {
  it("requires a key and a name before submitting, without calling the server", async () => {
    render(<CreateRoleForm slug="alder-creek" catalog={CATALOG} templates={[]} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^create role$/i }));
    });
    expect(toastError).toHaveBeenCalledWith("Enter a key and a name.");
    expect(mockCreateRoleAction).not.toHaveBeenCalled();
  });

  it("submits trimmed key/name and the toggled permission set, toasts success, and navigates back", async () => {
    mockCreateRoleAction.mockResolvedValueOnce({ ok: true, data: { roleId: "role-1" } });

    render(<CreateRoleForm slug="alder-creek" catalog={CATALOG} templates={[]} />);
    fireEvent.change(screen.getByLabelText(/^key$/i), {
      target: { value: "worship_committee" },
    });
    fireEvent.change(screen.getByLabelText(/^name$/i), {
      target: { value: "Worship Committee" },
    });
    fireEvent.click(screen.getByLabelText(/directory\.view/i));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^create role$/i }));
    });

    expect(mockCreateRoleAction).toHaveBeenCalledWith("alder-creek", {
      key: "worship_committee",
      name: "Worship Committee",
      permissionKeys: ["directory.view"],
    });
    expect(toastSuccess).toHaveBeenCalled();
    expect(mockRouterPush).toHaveBeenCalledWith("/o/alder-creek/admin/roles");
    expect(mockRouterRefresh).toHaveBeenCalled();
  });

  it("surfaces escalation_denied's server message via toast.error, verbatim", async () => {
    mockCreateRoleAction.mockResolvedValueOnce({
      ok: false,
      error:
        "You can't create a role with permissions you don't hold yourself: member.view_medical.",
    });

    render(<CreateRoleForm slug="alder-creek" catalog={CATALOG} templates={[]} />);
    fireEvent.change(screen.getByLabelText(/^key$/i), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "X" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^create role$/i }));
    });

    expect(toastError).toHaveBeenCalledWith(
      "You can't create a role with permissions you don't hold yourself: member.view_medical.",
    );
  });

  it("surfaces duplicate_key's server message via toast.error, verbatim", async () => {
    mockCreateRoleAction.mockResolvedValueOnce({
      ok: false,
      error: "A role with that key already exists at this organization.",
    });

    render(<CreateRoleForm slug="alder-creek" catalog={CATALOG} templates={[]} />);
    fireEvent.change(screen.getByLabelText(/^key$/i), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "X" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^create role$/i }));
    });

    expect(toastError).toHaveBeenCalledWith(
      "A role with that key already exists at this organization.",
    );
  });
});

const TEMPLATES = [
  {
    id: "template-1",
    key: "committee_chair",
    name: "Committee Chair",
    permissionKeys: ["directory.view"],
  },
];

describe("CreateRoleForm — adopt a template", () => {
  it("renders the section, pre-fills key/name from the selected template, and previews its permission set", () => {
    render(
      <CreateRoleForm slug="alder-creek" catalog={CATALOG} templates={TEMPLATES} />,
    );
    expect(screen.getByText(/or adopt a template/i)).toBeTruthy();
    expect((screen.getByLabelText(/^key$/i, { selector: "#template-key" }) as HTMLInputElement).value).toBe(
      "committee_chair",
    );
    expect(screen.getByText(/this template carries/i)).toBeTruthy();
  });

  it("calls adoptTemplateAction (NOT createRoleAction) with the template id and the edited key/name", async () => {
    mockAdoptTemplateAction.mockResolvedValueOnce({ ok: true, data: { roleId: "role-2" } });

    render(
      <CreateRoleForm slug="alder-creek" catalog={CATALOG} templates={TEMPLATES} />,
    );
    const templateKeyInput = screen.getByLabelText(/^key$/i, {
      selector: "#template-key",
    }) as HTMLInputElement;
    fireEvent.change(templateKeyInput, { target: { value: "worship_chair" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /adopt template/i }));
    });

    expect(mockAdoptTemplateAction).toHaveBeenCalledWith("alder-creek", {
      templateRoleId: "template-1",
      key: "worship_chair",
      name: "Committee Chair",
    });
    expect(mockCreateRoleAction).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalled();
    expect(mockRouterPush).toHaveBeenCalledWith("/o/alder-creek/admin/roles");
  });

  it("surfaces adoptTemplateAction's escalation_denied message via toast.error, verbatim", async () => {
    mockAdoptTemplateAction.mockResolvedValueOnce({
      ok: false,
      error: "That template carries permissions you don't hold yourself: directory.view.",
    });

    render(
      <CreateRoleForm slug="alder-creek" catalog={CATALOG} templates={TEMPLATES} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /adopt template/i }));
    });

    expect(toastError).toHaveBeenCalledWith(
      "That template carries permissions you don't hold yourself: directory.view.",
    );
  });
});

describe("CreateRoleForm — unsaved-changes guard (H3)", () => {
  it("intercepts a same-origin link click (standing in for page.tsx's 'Back to roles' link) once a key is typed", () => {
    render(
      <div>
        <a href="/o/alder-creek/admin/roles">Back to roles</a>
        <CreateRoleForm slug="alder-creek" catalog={CATALOG} templates={[]} />
      </div>,
    );

    fireEvent.change(screen.getByLabelText(/^key$/i), {
      target: { value: "worship_committee" },
    });
    fireEvent.click(screen.getByRole("link", { name: /back to roles/i }));

    expect(screen.getByText(/discard unsaved changes\?/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));
    expect(mockRouterPush).toHaveBeenCalledWith("/o/alder-creek/admin/roles");
  });

  it("does not intercept the link on an untouched form", () => {
    render(
      <div>
        <a href="/o/alder-creek/admin/roles">Back to roles</a>
        <CreateRoleForm slug="alder-creek" catalog={CATALOG} templates={[]} />
      </div>,
    );
    fireEvent.click(screen.getByRole("link", { name: /back to roles/i }));
    expect(screen.queryByText(/discard unsaved changes\?/i)).toBeNull();
  });

  it("toggling a permission checkbox alone also counts as dirty", () => {
    render(
      <div>
        <a href="/o/alder-creek/admin/roles">Back to roles</a>
        <CreateRoleForm slug="alder-creek" catalog={CATALOG} templates={[]} />
      </div>,
    );
    fireEvent.click(screen.getByLabelText(/directory\.view/i));
    fireEvent.click(screen.getByRole("link", { name: /back to roles/i }));
    expect(screen.getByText(/discard unsaved changes\?/i)).toBeTruthy();
  });
});
