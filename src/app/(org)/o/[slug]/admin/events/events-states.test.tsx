// @vitest-environment jsdom
/**
 * Tests for the events pages' three non-data-bearing states — docs/work-log/
 * 2026-08-26-events-model.md, Phase 4 commit 2.
 *
 * Each test asserts the state's copy contains ITS OWN distinguishing phrase
 * and does NOT contain the other two states' distinguishing phrases,
 * mirroring `groups/groups-states.test.tsx`'s convention verbatim.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EventsFlagOff, EventsForbidden, EventsLoadError } from "./events-states";

afterEach(cleanup);

const FLAG_OFF_PHRASE = /isn.t turned on for/i;
const FORBIDDEN_PHRASE = /don.t have permission to manage events/i;
const LOAD_ERROR_PHRASE = /couldn.t load event records/i;

describe("EventsFlagOff", () => {
  it("names the organization with a product-not-here message, no permission or error framing", () => {
    render(<EventsFlagOff name="Alder Creek Presbyterian Church" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(FLAG_OFF_PHRASE);
    expect(body).toContain("Alder Creek Presbyterian Church");
    expect(body).not.toMatch(FORBIDDEN_PHRASE);
    expect(body).not.toMatch(LOAD_ERROR_PHRASE);
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("EventsForbidden", () => {
  it("reads as a single-capability denial, not a whole-portal denial, and names the org", () => {
    render(<EventsForbidden name="Bramblewood Presbyterian Church" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(FORBIDDEN_PHRASE);
    expect(body).toContain("Bramblewood Presbyterian Church");
    expect(body).toMatch(/ask your stated clerk/i);
    expect(body).not.toMatch(/you don.t have access to/i);
    expect(body).not.toMatch(FLAG_OFF_PHRASE);
    expect(body).not.toMatch(LOAD_ERROR_PHRASE);
  });
});

describe("EventsLoadError", () => {
  it("reads as broken-right-now with a retry link to the events list, not a denial", () => {
    render(<EventsLoadError slug="alder-creek" />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(LOAD_ERROR_PHRASE);
    expect(body).not.toMatch(FORBIDDEN_PHRASE);
    expect(body).not.toMatch(FLAG_OFF_PHRASE);

    const retry = screen.getByRole("link", { name: /try again/i });
    expect(retry.getAttribute("href")).toBe("/o/alder-creek/admin/events");
  });
});
