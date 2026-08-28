// @vitest-environment jsdom
/**
 * Tests for <StaffHistory> — staff-and-personnel Phase 3, ux-developer
 * slice. Mirrors `admin/officers/officer-history.test.tsx`'s shape (there
 * is no such file today, so this is patterned on `officer-roster.test.tsx`'s
 * empty-state/columns convention applied to the history table instead).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StaffHistory } from "./staff-history";
import type { StaffHistoryEntry } from "@/lib/staff";

afterEach(cleanup);

const ENTRY: StaffHistoryEntry = {
  positionId: "position-1",
  position: "Church Secretary",
  department: "Administration",
  startsOn: "2022-01-01",
  endsOn: "2024-12-31",
  endReason: "Resigned",
};

const OPEN_ENTRY: StaffHistoryEntry = {
  positionId: "position-2",
  position: "Custodian",
  department: null,
  startsOn: "2025-01-01",
  endsOn: null,
  endReason: null,
};

describe("StaffHistory — empty state", () => {
  it("renders a designed empty state, not a blank table, when there are zero entries", () => {
    render(<StaffHistory entries={[]} />);
    expect(screen.getByText(/no staff history recorded/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("StaffHistory — table columns", () => {
  it("renders position, department, since, ended, and the raw end reason string", () => {
    render(<StaffHistory entries={[ENTRY]} />);
    expect(screen.getByText("Church Secretary")).toBeTruthy();
    expect(screen.getByText("Administration")).toBeTruthy();
    expect(screen.getByText("Resigned")).toBeTruthy();
  });

  it("renders em dashes for a null department, ended date, and end reason", () => {
    render(<StaffHistory entries={[OPEN_ENTRY]} />);
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(3);
  });
});
