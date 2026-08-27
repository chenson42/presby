// @vitest-environment jsdom
/**
 * Tests for the roles page's three non-data-bearing states.
 *
 * Each test below asserts the state's copy contains ITS OWN distinguishing
 * phrase and does NOT contain the other two states' distinguishing phrases,
 * mirroring directory/directory-states.test.tsx's convention — a future edit
 * that accidentally homogenizes the copy fails loudly here instead of
 * shipping.
 *
 * No jest-dom matchers — matches the rest of this codebase's component specs.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  RoleDefinitionForbidden,
  RoleDefinitionLoadError,
  RoleDefinitionNotFound,
  RoleDefinitionProtected,
  RolesFlagOff,
  RolesForbidden,
  RolesLoadError,
} from "./roles-states";

afterEach(cleanup);

const FLAG_OFF_PHRASE = /isn.t turned on for/i;
const FORBIDDEN_PHRASE = /don.t have permission to grant or revoke roles/i;
const LOAD_ERROR_PHRASE = /couldn.t load role assignments/i;

describe("RolesFlagOff", () => {
  it("names the organization with a product-not-here message, no permission or error framing", () => {
    render(<RolesFlagOff name="Alder Creek Presbyterian Church" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(FLAG_OFF_PHRASE);
    expect(body).toContain("Alder Creek Presbyterian Church");
    expect(body).not.toMatch(FORBIDDEN_PHRASE);
    expect(body).not.toMatch(LOAD_ERROR_PHRASE);
    // No retry control — there is nothing to retry, this is not an error.
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("RolesForbidden", () => {
  it("reads as a single-capability denial, not a whole-portal denial, and names the org", () => {
    render(<RolesForbidden name="Bramblewood Presbyterian Church" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(FORBIDDEN_PHRASE);
    expect(body).toContain("Bramblewood Presbyterian Church");
    expect(body).toMatch(/ask your stated clerk/i);
    // Must NOT reuse OrgAccessDenied's whole-portal wording.
    expect(body).not.toMatch(/you don.t have access to/i);
    expect(body).not.toMatch(FLAG_OFF_PHRASE);
    expect(body).not.toMatch(LOAD_ERROR_PHRASE);
  });
});

describe("RolesLoadError", () => {
  it("reads as broken-right-now with a retry link to the same path, not a denial", () => {
    render(<RolesLoadError slug="alder-creek" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(LOAD_ERROR_PHRASE);
    expect(body).not.toMatch(FORBIDDEN_PHRASE);
    expect(body).not.toMatch(FLAG_OFF_PHRASE);

    const retry = screen.getByRole("link", { name: /try again/i });
    expect(retry.getAttribute("href")).toBe("/o/alder-creek/admin/roles");
  });
});

/**
 * The four `roles.manage`-gated states (docs/work-log/
 * 2026-08-26-role-permissions-admin.md, Phase 3). Same "own distinguishing
 * phrase, and not the others'" convention as the three grant-side states
 * above — RolesForbidden denies GRANTS (`role_grants.manage`), these deny
 * DEFINITION (`roles.manage`), and the two copy blocks must not read alike.
 */

const ROLE_DEF_FORBIDDEN_PHRASE = /don.t have permission to create or edit role definitions/i;
const ROLE_DEF_NOT_FOUND_PHRASE = /that role no longer exists at this organization/i;
const ROLE_DEF_PROTECTED_PHRASE = /can.t be edited or deactivated here/i;
const ROLE_DEF_LOAD_ERROR_PHRASE = /couldn.t load that right now/i;

describe("RoleDefinitionForbidden", () => {
  it("names the org and reads distinct from RolesForbidden's grant-side wording", () => {
    render(<RoleDefinitionForbidden name="Bramblewood Presbyterian Church" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(ROLE_DEF_FORBIDDEN_PHRASE);
    expect(body).toContain("Bramblewood Presbyterian Church");
    expect(body).not.toMatch(FORBIDDEN_PHRASE);
    expect(body).not.toMatch(ROLE_DEF_NOT_FOUND_PHRASE);
    expect(body).not.toMatch(ROLE_DEF_PROTECTED_PHRASE);
  });
});

describe("RoleDefinitionNotFound", () => {
  it("names the not-found copy with a link back to the roles list", () => {
    render(<RoleDefinitionNotFound slug="alder-creek" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(ROLE_DEF_NOT_FOUND_PHRASE);
    expect(body).not.toMatch(ROLE_DEF_FORBIDDEN_PHRASE);
    expect(body).not.toMatch(ROLE_DEF_PROTECTED_PHRASE);

    const back = screen.getByRole("link", { name: /back to roles/i });
    expect(back.getAttribute("href")).toBe("/o/alder-creek/admin/roles");
  });
});

describe("RoleDefinitionProtected", () => {
  it("names the role and states it's read-only, without offering a form", () => {
    render(
      <RoleDefinitionProtected
        slug="alder-creek"
        role={{
          name: "Role Administrator",
          key: "role_admin",
          permissionKeys: ["roles.manage"],
        }}
      />,
    );
    const body = document.body.textContent ?? "";
    expect(body).toMatch(ROLE_DEF_PROTECTED_PHRASE);
    expect(body).toContain("Role Administrator");
    expect(body).toContain("role_admin");
    expect(body).not.toMatch(ROLE_DEF_FORBIDDEN_PHRASE);
    expect(body).not.toMatch(ROLE_DEF_NOT_FOUND_PHRASE);
    // No form controls — this state never offers editing.
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });
});

describe("RoleDefinitionLoadError", () => {
  it("reads as broken-right-now with a link back to the roles list", () => {
    render(<RoleDefinitionLoadError slug="alder-creek" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(ROLE_DEF_LOAD_ERROR_PHRASE);
    expect(body).not.toMatch(ROLE_DEF_FORBIDDEN_PHRASE);

    const back = screen.getByRole("link", { name: /back to roles/i });
    expect(back.getAttribute("href")).toBe("/o/alder-creek/admin/roles");
  });
});
