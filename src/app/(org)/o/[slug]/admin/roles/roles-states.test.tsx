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
import { RolesFlagOff, RolesForbidden, RolesLoadError } from "./roles-states";

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
