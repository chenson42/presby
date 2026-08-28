// @vitest-environment jsdom
/**
 * Tests for the staff pages' three non-data-bearing states —
 * staff-and-personnel Phase 3, ux-developer slice. Mirrors
 * `admin/officers/officers-states.test.tsx`'s convention verbatim: each
 * state's copy must contain its own distinguishing phrase and must NOT
 * contain the other two states' phrases, so a future edit that accidentally
 * homogenizes the copy fails loudly here instead of shipping.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StaffFlagOff, StaffForbidden, StaffLoadError } from "./staff-states";

afterEach(cleanup);

const FLAG_OFF_PHRASE = /isn.t turned on for/i;
const FORBIDDEN_PHRASE = /don.t have permission to manage staff/i;
const LOAD_ERROR_PHRASE = /couldn.t load staff records/i;

describe("StaffFlagOff", () => {
  it("names the organization with a product-not-here message, no permission or error framing", () => {
    render(<StaffFlagOff name="Alder Creek Presbyterian Church" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(FLAG_OFF_PHRASE);
    expect(body).toContain("Alder Creek Presbyterian Church");
    expect(body).not.toMatch(FORBIDDEN_PHRASE);
    expect(body).not.toMatch(LOAD_ERROR_PHRASE);
    // No retry control — there is nothing to retry, this is not an error.
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("StaffForbidden", () => {
  it("reads as a single-capability denial, not a whole-portal denial, and names the org", () => {
    render(<StaffForbidden name="Bramblewood Presbyterian Church" />);
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

describe("StaffLoadError", () => {
  it("reads as broken-right-now with a retry link to the roster path, not a denial", () => {
    render(<StaffLoadError slug="alder-creek" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(LOAD_ERROR_PHRASE);
    expect(body).not.toMatch(FORBIDDEN_PHRASE);
    expect(body).not.toMatch(FLAG_OFF_PHRASE);

    const retry = screen.getByRole("link", { name: /try again/i });
    expect(retry.getAttribute("href")).toBe("/o/alder-creek/admin/staff");
  });
});
