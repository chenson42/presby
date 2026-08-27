// @vitest-environment jsdom
/**
 * Tests for the tickets page's three non-data-bearing states — mirrors
 * `admin/roles/roles-states.test.tsx`'s "own distinguishing phrase, not the
 * other two's" discipline.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { TicketsFlagOff, TicketsForbidden, TicketsLoadError } from "./tickets-states";

afterEach(cleanup);

const FLAG_OFF_PHRASE = /aren.t turned on for/i;
const FORBIDDEN_PHRASE = /don.t have permission to file or manage support tickets/i;
const LOAD_ERROR_PHRASE = /couldn.t load tickets/i;

describe("TicketsFlagOff", () => {
  it("names the organization with a product-not-here message, no permission or error framing", () => {
    render(<TicketsFlagOff name="Alder Creek Presbyterian Church" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(FLAG_OFF_PHRASE);
    expect(body).toContain("Alder Creek Presbyterian Church");
    expect(body).not.toMatch(FORBIDDEN_PHRASE);
    expect(body).not.toMatch(LOAD_ERROR_PHRASE);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("TicketsForbidden", () => {
  it("reads as a single-capability denial, not a whole-portal denial, and names the org", () => {
    render(<TicketsForbidden name="Bramblewood Presbyterian Church" slug="bramblewood" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(FORBIDDEN_PHRASE);
    expect(body).toContain("Bramblewood Presbyterian Church");
    expect(body).not.toMatch(/you don.t have access to/i);
    expect(body).not.toMatch(FLAG_OFF_PHRASE);
    expect(body).not.toMatch(LOAD_ERROR_PHRASE);
  });

  it("points to the org's own feedback form, using an absolute slug-scoped href", () => {
    render(<TicketsForbidden name="Bramblewood Presbyterian Church" slug="bramblewood" />);
    const link = screen.getByRole("link", { name: /the feedback form/i });
    expect(link.getAttribute("href")).toBe("/o/bramblewood/feedback");
  });

  it("carries the lock-badge visual — regression for L6, bare unstyled text", () => {
    render(<TicketsForbidden name="Bramblewood Presbyterian Church" slug="bramblewood" />);
    const lockIcon = document.querySelector("svg.lucide-lock");
    expect(lockIcon).toBeTruthy();
    expect(screen.getByText("Restricted")).toBeTruthy();
  });
});

describe("TicketsLoadError", () => {
  it("reads as broken-right-now with a retry link to the same path, not a denial", () => {
    render(<TicketsLoadError slug="alder-creek" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(LOAD_ERROR_PHRASE);
    expect(body).not.toMatch(FORBIDDEN_PHRASE);
    expect(body).not.toMatch(FLAG_OFF_PHRASE);

    const retry = screen.getByRole("link", { name: /try again/i });
    expect(retry.getAttribute("href")).toBe("/o/alder-creek/tickets");
  });
});
