// @vitest-environment jsdom
/**
 * Tests for `RoleCatalogList` — the table rendering `RoleDefinitionEntry`
 * rows on `/o/<slug>/admin/roles`'s third section.
 *
 * Pins the shape the Phase 3 Component Plan calls out explicitly:
 *   - one row per role: name, key, permission count, holder count
 *   - a `deactivatedAt` badge if set
 *   - an "Edit" link, OMITTED for `isProtected` rows
 *   - a designed empty state (never a blank table)
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RoleCatalogList } from "./role-catalog-list";
import type { RoleDefinitionEntry } from "@/lib/role-definitions";

afterEach(cleanup);

function makeRole(overrides: Partial<RoleDefinitionEntry> = {}): RoleDefinitionEntry {
  return {
    id: "role-1",
    key: "worship_committee",
    name: "Worship Committee",
    roleKind: "custom",
    isProtected: false,
    deactivatedAt: null,
    permissionKeys: ["directory.view", "branding.manage"],
    holderCount: 3,
    ...overrides,
  };
}

describe("RoleCatalogList — empty state", () => {
  it("renders a designed empty state, not a blank table, when there are no roles", () => {
    render(<RoleCatalogList roles={[]} slug="alder-creek" />);
    expect(screen.getByText(/no custom roles yet/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("RoleCatalogList — a custom, active role", () => {
  it("shows name, key, permission count, holder count, an Active badge, and an Edit link", () => {
    render(<RoleCatalogList roles={[makeRole()]} slug="alder-creek" />);

    expect(screen.getByText("Worship Committee")).toBeTruthy();
    expect(screen.getByText("worship_committee")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy(); // permission count
    expect(screen.getByText("3")).toBeTruthy(); // holder count
    expect(screen.getByText(/^active$/i)).toBeTruthy();

    const edit = screen.getByRole("link", { name: /edit/i });
    expect(edit.getAttribute("href")).toBe(
      "/o/alder-creek/admin/roles/role-1/edit",
    );
  });
});

describe("RoleCatalogList — a deactivated role", () => {
  it("shows a Deactivated badge instead of Active, and still offers Edit (it's not protected)", () => {
    render(
      <RoleCatalogList
        roles={[makeRole({ deactivatedAt: "2026-08-20T00:00:00.000Z" })]}
        slug="alder-creek"
      />,
    );
    expect(screen.getByText(/deactivated/i)).toBeTruthy();
    expect(screen.queryByText(/^active$/i)).toBeNull();
    expect(screen.getByRole("link", { name: /edit/i })).toBeTruthy();
  });
});

describe("RoleCatalogList — a protected (constitutional) role", () => {
  it("omits the Edit link and shows a Constitutional badge instead of Active", () => {
    render(
      <RoleCatalogList
        roles={[
          makeRole({
            id: "role-admin",
            key: "role_admin",
            name: "Role Administrator",
            roleKind: "constitutional",
            isProtected: true,
          }),
        ]}
        slug="alder-creek"
      />,
    );
    expect(screen.getByText(/constitutional/i)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /edit/i })).toBeNull();
  });
});
