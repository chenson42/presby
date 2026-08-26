// @vitest-environment jsdom
/**
 * Tests for the officers pages' three non-data-bearing states — groups-and-
 * officers Phase 3, commit 3/3.
 *
 * Each test asserts the state's copy contains ITS OWN distinguishing phrase
 * and does NOT contain the other two states' distinguishing phrases,
 * mirroring `admin/roles/roles-states.test.tsx`'s convention verbatim — a
 * future edit that accidentally homogenizes the copy fails loudly here
 * instead of shipping.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  OfficersFlagOff,
  OfficersForbidden,
  OfficersLoadError,
} from "./officers-states";

afterEach(cleanup);

const FLAG_OFF_PHRASE = /isn.t turned on for/i;
const FORBIDDEN_PHRASE = /don.t have permission to manage officer terms/i;
const LOAD_ERROR_PHRASE = /couldn.t load officer records/i;

describe("OfficersFlagOff", () => {
  it("names the organization with a product-not-here message, no permission or error framing", () => {
    render(<OfficersFlagOff name="Alder Creek Presbyterian Church" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(FLAG_OFF_PHRASE);
    expect(body).toContain("Alder Creek Presbyterian Church");
    expect(body).not.toMatch(FORBIDDEN_PHRASE);
    expect(body).not.toMatch(LOAD_ERROR_PHRASE);
    // No retry control — there is nothing to retry, this is not an error.
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("OfficersForbidden", () => {
  it("reads as a single-capability denial, not a whole-portal denial, and names the org", () => {
    render(<OfficersForbidden name="Bramblewood Presbyterian Church" />);
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

describe("OfficersLoadError", () => {
  it("reads as broken-right-now with a retry link to the roster path, not a denial", () => {
    render(<OfficersLoadError slug="alder-creek" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(LOAD_ERROR_PHRASE);
    expect(body).not.toMatch(FORBIDDEN_PHRASE);
    expect(body).not.toMatch(FLAG_OFF_PHRASE);

    const retry = screen.getByRole("link", { name: /try again/i });
    expect(retry.getAttribute("href")).toBe("/o/alder-creek/admin/officers");
  });
});
