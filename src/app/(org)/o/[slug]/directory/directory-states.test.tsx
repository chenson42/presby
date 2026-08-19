// @vitest-environment jsdom
/**
 * Tests for the directory's three non-data-bearing states.
 *
 * The whole point of Phase 3's design is that these three read as genuinely
 * different messages to a member — not one generic "nothing here" string
 * with the noun swapped. Each test below asserts the state's copy contains
 * ITS OWN distinguishing phrase and does NOT contain the other two states'
 * distinguishing phrases, so a future edit that accidentally homogenizes the
 * copy fails loudly here instead of shipping.
 *
 * No jest-dom matchers: this repo's existing component specs (org-mark.
 * test.tsx, avatar-menu.test.tsx) use plain vitest/chai assertions against
 * Testing Library queries, and this file follows the same convention.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  DirectoryFlagOff,
  DirectoryForbidden,
  DirectoryLoadError,
} from "./directory-states";

afterEach(cleanup);

const FLAG_OFF_PHRASE = /isn.t available for/i;
const FORBIDDEN_PHRASE = /don.t have permission/i;
const LOAD_ERROR_PHRASE = /couldn.t load the directory/i;

describe("DirectoryFlagOff", () => {
  it("names the organization with a product-not-here message, no permission or error framing", () => {
    render(<DirectoryFlagOff name="Alder Creek Presbyterian Church" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(FLAG_OFF_PHRASE);
    expect(body).toContain("Alder Creek Presbyterian Church");
    expect(body).not.toMatch(FORBIDDEN_PHRASE);
    expect(body).not.toMatch(LOAD_ERROR_PHRASE);
    // No retry control — there is nothing to retry, this is not an error.
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("DirectoryForbidden", () => {
  it("reads as a single-feature denial, not a whole-portal denial, and names the org", () => {
    render(<DirectoryForbidden name="Bramblewood Presbyterian Church" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(FORBIDDEN_PHRASE);
    expect(body).toContain("Bramblewood Presbyterian Church");
    expect(body).toMatch(/ask an administrator/i);
    // Must NOT reuse OrgAccessDenied's whole-portal wording.
    expect(body).not.toMatch(/you don.t have access to/i);
    expect(body).not.toMatch(FLAG_OFF_PHRASE);
    expect(body).not.toMatch(LOAD_ERROR_PHRASE);
  });
});

describe("DirectoryLoadError", () => {
  it("reads as broken-right-now with a retry link to the same path, not a denial", () => {
    render(<DirectoryLoadError slug="alder-creek" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(LOAD_ERROR_PHRASE);
    expect(body).not.toMatch(FORBIDDEN_PHRASE);
    expect(body).not.toMatch(FLAG_OFF_PHRASE);

    const retry = screen.getByRole("link", { name: /try again/i });
    expect(retry.getAttribute("href")).toBe("/o/alder-creek/directory");
  });
});
