// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DomainsFeatureOff, DomainsForbidden, DomainsUnavailable } from "./domains-states";

afterEach(cleanup);

const OFF = /isn.t turned on for/i;
const FORBIDDEN = /don.t have permission to manage the website domain/i;
const UNAVAILABLE = /couldn.t load your domain settings/i;

describe("the three non-data states", () => {
  it("feature off: a not-here message that names the org, with no permission or error framing and no link", () => {
    render(<DomainsFeatureOff name="Alder Creek Church" />);
    const body = document.body.textContent!;
    expect(body).toMatch(OFF);
    expect(body).toContain("Alder Creek Church");
    expect(body).not.toMatch(FORBIDDEN);
    expect(body).not.toMatch(UNAVAILABLE);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Website domain" })).toBeTruthy();
  });

  it("forbidden: a single-capability denial naming the org and what to do", () => {
    render(<DomainsForbidden name="Alder Creek Church" />);
    const body = document.body.textContent!;
    expect(body).toMatch(FORBIDDEN);
    expect(body).toMatch(/ask your stated clerk/);
    expect(body).not.toMatch(OFF);
  });

  it("unavailable: human copy, says nothing changed, and a 44px retry link back to the page", () => {
    render(<DomainsUnavailable slug="alder-creek" />);
    const body = document.body.textContent!;
    expect(body).toMatch(UNAVAILABLE);
    expect(body).toMatch(/Nothing has changed/);
    const retry = screen.getByRole("link", { name: "Try again" });
    expect(retry.getAttribute("href")).toBe("/o/alder-creek/admin/domains");
    expect(retry.className).toMatch(/min-h-11/);
    expect(body).not.toMatch(/error|exception|500/i);
  });
});
