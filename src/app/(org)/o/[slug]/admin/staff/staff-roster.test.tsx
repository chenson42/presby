// @vitest-environment jsdom
/**
 * Tests for <StaffRoster> — staff-and-personnel Phase 3, ux-developer slice.
 *
 * `./actions` and `sonner` are mocked purely so `<EndPositionDialog>`
 * (rendered per row) can mount without pulling `@/lib/staff` into the module
 * graph — see `admin/officers/officer-roster.test.tsx`'s header for the
 * identical reasoning. `<EndPositionDialog>`'s OWN behaviour is covered by
 * `end-position-dialog.test.tsx`; this file only asserts an "End position"
 * trigger exists per open row, and that an already-ended row shows "Ended"
 * instead.
 *
 * What this file exists to pin:
 *   - the empty state ("No staff positions recorded yet"), not a blank
 *     table;
 *   - table columns render position, person (linked), since, ends;
 *   - the Department column is CONDITIONAL — present only when at least one
 *     row carries a department, absent otherwise;
 *   - an open row (endsOn === null) shows the "End position" trigger; an
 *     already-ended row shows "Ended" text instead, never a trigger that
 *     would re-end an already-ended row.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("./actions", () => ({
  startStaffPositionAction: vi.fn(),
  endStaffPositionAction: vi.fn(),
  createStaffPersonAction: vi.fn(),
  setStaffPositionPublicListedAction: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { StaffRoster } from "./staff-roster";
import type { StaffPositionEntry } from "@/lib/staff";

afterEach(cleanup);

const OPEN_ENTRY: StaffPositionEntry = {
  positionId: "position-1",
  personId: "person-1",
  displayName: "Marisol Windham",
  position: "Church Secretary",
  department: null,
  startsOn: "2024-06-01",
  endsOn: null,
  minuteReference: null,
  publicListed: false,
  publicDisplayOrder: null,
};

const ENDED_ENTRY: StaffPositionEntry = {
  positionId: "position-2",
  personId: "person-2",
  displayName: "Idris Calloway",
  position: "Part-Time Bookkeeper",
  department: "Finance",
  startsOn: "2022-01-01",
  endsOn: "2025-12-31",
  minuteReference: null,
  publicListed: false,
  publicDisplayOrder: null,
};

const PUBLIC_ENTRY: StaffPositionEntry = {
  positionId: "position-3",
  personId: "person-3",
  displayName: "Wren Halloway",
  position: "Office Administrator",
  department: null,
  startsOn: "2023-03-01",
  endsOn: null,
  minuteReference: null,
  publicListed: true,
  publicDisplayOrder: null,
};

describe("StaffRoster — empty state", () => {
  it("renders a designed empty state, not a blank table, when there are zero entries", () => {
    render(<StaffRoster entries={[]} slug="alder-creek" />);
    expect(screen.getByText(/no staff positions recorded yet/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("StaffRoster — table columns", () => {
  it("renders position, a linked person name, since, and an End position trigger for an open row", () => {
    render(<StaffRoster entries={[OPEN_ENTRY]} slug="alder-creek" />);
    expect(screen.getByText("Church Secretary")).toBeTruthy();
    const personLink = screen.getByRole("link", { name: "Marisol Windham" });
    expect(personLink.getAttribute("href")).toBe(
      "/o/alder-creek/admin/staff/person-1?name=Marisol%20Windham",
    );
    expect(screen.getByRole("button", { name: /end position/i })).toBeTruthy();
  });

  it("shows 'Ended' text instead of an End position trigger for an already-ended row", () => {
    render(<StaffRoster entries={[ENDED_ENTRY]} slug="alder-creek" />);
    expect(screen.getByText("Ended")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /end position/i })).toBeNull();
  });

  it("renders an em dash for a null ends date", () => {
    render(<StaffRoster entries={[OPEN_ENTRY]} slug="alder-creek" />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });
});

describe("StaffRoster — the Department column is conditional", () => {
  it("omits the Department column entirely when no row carries one", () => {
    render(<StaffRoster entries={[OPEN_ENTRY]} slug="alder-creek" />);
    expect(
      screen.queryByRole("columnheader", { name: /department/i }),
    ).toBeNull();
  });

  it("renders the Department column and value when a row carries one", () => {
    render(
      <StaffRoster entries={[OPEN_ENTRY, ENDED_ENTRY]} slug="alder-creek" />,
    );
    expect(
      screen.getByRole("columnheader", { name: /department/i }),
    ).toBeTruthy();
    expect(screen.getByText("Finance")).toBeTruthy();
  });
});

describe("StaffRoster — public listing control (docs/work-log/2026-08-27-public-staff-directory.md)", () => {
  it("renders a 'List publicly' switch per row and no Public badge when not opted in", () => {
    render(<StaffRoster entries={[OPEN_ENTRY]} slug="alder-creek" />);
    expect(screen.getByRole("switch")).toBeTruthy();
    expect(screen.queryByText("Public")).toBeNull();
  });

  it("shows a Public badge and a checked switch for a row already opted in", () => {
    render(<StaffRoster entries={[PUBLIC_ENTRY]} slug="alder-creek" />);
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "true",
    );
  });
});
