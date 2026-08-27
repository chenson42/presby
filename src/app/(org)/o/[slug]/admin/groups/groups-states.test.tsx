// @vitest-environment jsdom
/**
 * Tests for the groups pages' three non-data-bearing states — docs/work-log/
 * 2026-08-26-groups-admin.md, Phase 4 commit 2.
 *
 * Each test asserts the state's copy contains ITS OWN distinguishing phrase
 * and does NOT contain the other two states' distinguishing phrases,
 * mirroring `officers/officers-states.test.tsx`'s convention verbatim.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { GroupsFlagOff, GroupsForbidden, GroupsLoadError } from "./groups-states";

afterEach(cleanup);

const FLAG_OFF_PHRASE = /isn.t turned on for/i;
const FORBIDDEN_PHRASE = /don.t have permission to manage groups/i;
const LOAD_ERROR_PHRASE = /couldn.t load group records/i;

describe("GroupsFlagOff", () => {
  it("names the organization with a product-not-here message, no permission or error framing", () => {
    render(<GroupsFlagOff name="Alder Creek Presbyterian Church" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(FLAG_OFF_PHRASE);
    expect(body).toContain("Alder Creek Presbyterian Church");
    expect(body).not.toMatch(FORBIDDEN_PHRASE);
    expect(body).not.toMatch(LOAD_ERROR_PHRASE);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("GroupsForbidden", () => {
  it("reads as a single-capability denial, not a whole-portal denial, and names the org", () => {
    render(<GroupsForbidden name="Bramblewood Presbyterian Church" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(FORBIDDEN_PHRASE);
    expect(body).toContain("Bramblewood Presbyterian Church");
    expect(body).toMatch(/ask your stated clerk/i);
    expect(body).not.toMatch(/you don.t have access to/i);
    expect(body).not.toMatch(FLAG_OFF_PHRASE);
    expect(body).not.toMatch(LOAD_ERROR_PHRASE);
  });
});

describe("GroupsLoadError", () => {
  it("reads as broken-right-now with a retry link to the groups list, not a denial", () => {
    render(<GroupsLoadError slug="alder-creek" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(LOAD_ERROR_PHRASE);
    expect(body).not.toMatch(FORBIDDEN_PHRASE);
    expect(body).not.toMatch(FLAG_OFF_PHRASE);

    const retry = screen.getByRole("link", { name: /try again/i });
    expect(retry.getAttribute("href")).toBe("/o/alder-creek/admin/groups");
  });
});
