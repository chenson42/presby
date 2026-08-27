// @vitest-environment jsdom
/**
 * Tests for the credentials pages' three non-data-bearing states —
 * presbytery-functionality Increment 2, mirroring
 * `../officers/officers-states.test.tsx`'s convention verbatim.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  CredentialsFlagOff,
  CredentialsForbidden,
  CredentialsLoadError,
} from "./credentials-states";

afterEach(cleanup);

const FLAG_OFF_PHRASE = /isn.t turned on for/i;
const FORBIDDEN_PHRASE = /don.t have permission to manage ministry credentials/i;
const LOAD_ERROR_PHRASE = /couldn.t load credentials records/i;

describe("CredentialsFlagOff", () => {
  it("names the organization with a product-not-here message, no permission or error framing", () => {
    render(<CredentialsFlagOff name="Presbytery of the Northern Reach" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(FLAG_OFF_PHRASE);
    expect(body).toContain("Presbytery of the Northern Reach");
    expect(body).not.toMatch(FORBIDDEN_PHRASE);
    expect(body).not.toMatch(LOAD_ERROR_PHRASE);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("CredentialsForbidden", () => {
  it("reads as a single-capability denial, not a whole-portal denial, and names the org", () => {
    render(<CredentialsForbidden name="Some Other Presbytery" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(FORBIDDEN_PHRASE);
    expect(body).toContain("Some Other Presbytery");
    expect(body).toMatch(/ask your stated clerk/i);
    expect(body).not.toMatch(/you don.t have access to/i);
    expect(body).not.toMatch(FLAG_OFF_PHRASE);
    expect(body).not.toMatch(LOAD_ERROR_PHRASE);
  });
});

describe("CredentialsLoadError", () => {
  it("reads as broken-right-now with a retry link to the credentials path, not a denial", () => {
    render(<CredentialsLoadError slug="northern-reach" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(LOAD_ERROR_PHRASE);
    expect(body).not.toMatch(FORBIDDEN_PHRASE);
    expect(body).not.toMatch(FLAG_OFF_PHRASE);

    const retry = screen.getByRole("link", { name: /try again/i });
    expect(retry.getAttribute("href")).toBe("/o/northern-reach/admin/credentials");
  });
});
