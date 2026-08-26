// @vitest-environment jsdom
/**
 * Tests for the branding page's three non-data-bearing states, mirroring
 * `admin/features/features-states.test.tsx`'s exact convention: each state's
 * copy must contain its own distinguishing phrase and must NOT contain
 * either other state's phrase.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  BrandingFlagOff,
  BrandingForbidden,
  BrandingLoadError,
} from "./branding-states";

afterEach(cleanup);

const FLAG_OFF_PHRASE = /isn.t turned on for/i;
const FORBIDDEN_PHRASE = /don.t have permission to manage branding/i;
const LOAD_ERROR_PHRASE = /couldn.t load brand settings/i;

describe("BrandingFlagOff", () => {
  it("names the organization with a product-not-here message, no permission or error framing", () => {
    render(<BrandingFlagOff name="Alder Creek Presbyterian Church" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(FLAG_OFF_PHRASE);
    expect(body).toContain("Alder Creek Presbyterian Church");
    expect(body).not.toMatch(FORBIDDEN_PHRASE);
    expect(body).not.toMatch(LOAD_ERROR_PHRASE);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("BrandingForbidden", () => {
  it("reads as a single-capability denial, not a whole-portal denial, and names the org", () => {
    render(<BrandingForbidden name="Bramblewood Presbyterian Church" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(FORBIDDEN_PHRASE);
    expect(body).toContain("Bramblewood Presbyterian Church");
    expect(body).not.toMatch(/you don.t have access to/i);
    expect(body).not.toMatch(FLAG_OFF_PHRASE);
    expect(body).not.toMatch(LOAD_ERROR_PHRASE);
  });
});

describe("BrandingLoadError", () => {
  it("reads as broken-right-now with a retry link to the same path, not a denial", () => {
    render(<BrandingLoadError slug="alder-creek" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(LOAD_ERROR_PHRASE);
    expect(body).not.toMatch(FORBIDDEN_PHRASE);
    expect(body).not.toMatch(FLAG_OFF_PHRASE);

    const retry = screen.getByRole("link", { name: /try again/i });
    expect(retry.getAttribute("href")).toBe("/o/alder-creek/admin/branding");
  });
});
