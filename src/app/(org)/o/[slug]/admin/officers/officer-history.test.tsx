// @vitest-environment jsdom
/**
 * Tests for <OfficerHistory> — groups-and-officers Phase 3, commit 3/3.
 *
 * What this file exists to pin, per Phase 3 and this pipeline's brief:
 *   - the empty state ("No officer history recorded"), for a person with
 *     zero terms — a real, reachable state per Phase 1/3's own note;
 *   - table columns render office, since, ended, reason, years served;
 *   - an open (unended) term renders an em dash for both "Ended" and
 *     "Reason", not a blank cell;
 *   - `endReason` maps to a friendly label, falling back to the raw string
 *     for an unrecognized value rather than a blank cell.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { OfficerHistory } from "./officer-history";
import type { OfficerHistoryEntry } from "@/lib/officers";

afterEach(cleanup);

const OPEN_TERM: OfficerHistoryEntry = {
  termId: "term-1",
  office: "ruling_elder",
  classYear: 2028,
  startsOn: "2023-01-08",
  endsOn: null,
  endReason: null,
  yearsServed: 3.5,
};

const ENDED_TERM: OfficerHistoryEntry = {
  termId: "term-2",
  office: "clerk_of_session",
  classYear: null,
  startsOn: "2018-01-01",
  endsOn: "2022-12-31",
  endReason: "resigned",
  yearsServed: 5,
};

const IMPORTED_TERM: OfficerHistoryEntry = {
  termId: "term-3",
  office: "trustee",
  classYear: null,
  startsOn: "2010-01-01",
  endsOn: "2015-01-01",
  endReason: "some_future_reason",
  yearsServed: 5,
};

describe("OfficerHistory — empty state", () => {
  it("renders a designed empty state, not a blank table, when there are zero terms", () => {
    render(<OfficerHistory entries={[]} />);
    expect(screen.getByText(/no officer history recorded/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("OfficerHistory — table columns", () => {
  it("renders office label, since, and years served", () => {
    render(<OfficerHistory entries={[OPEN_TERM]} />);
    expect(screen.getByText("Ruling Elder")).toBeTruthy();
    expect(screen.getByText("3.5")).toBeTruthy();
  });

  it("renders em dashes for Ended and Reason on an open (unended) term", () => {
    render(<OfficerHistory entries={[OPEN_TERM]} />);
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBe(2);
  });

  it("renders a friendly label for a recognized end reason", () => {
    render(<OfficerHistory entries={[ENDED_TERM]} />);
    expect(screen.getByText("Resigned")).toBeTruthy();
  });

  it("falls back to the raw string for an unrecognized end reason, not a blank cell", () => {
    render(<OfficerHistory entries={[IMPORTED_TERM]} />);
    expect(screen.getByText("some_future_reason")).toBeTruthy();
  });
});
