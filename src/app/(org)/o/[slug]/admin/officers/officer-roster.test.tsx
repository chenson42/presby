// @vitest-environment jsdom
/**
 * Tests for <OfficerRoster> — groups-and-officers Phase 3, commit 3/3.
 *
 * `./actions` and `sonner` are mocked purely so `<EndTermDialog>` (rendered
 * per row) can mount without pulling `@/lib/officers` into the module graph
 * — see `admin/roles/grant-role-form.test.tsx`'s header for the identical
 * reasoning. `<EndTermDialog>`'s OWN behaviour is covered by
 * `end-term-dialog.test.tsx`; this file only asserts an "End term" trigger
 * exists per row.
 *
 * What this file exists to pin, per Phase 3 and this pipeline's brief:
 *   - the empty state ("No officers recorded yet — add the first one"),
 *     not a blank table;
 *   - table columns render office, person (linked), class year, since, ends;
 *   - the District column is CONDITIONAL — present only when at least one
 *     row carries an `orgUnitName`, absent otherwise (not a column of solid
 *     em dashes).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("./actions", () => ({
  startOfficerTermAction: vi.fn(),
  endOfficerTermAction: vi.fn(),
  setOfficerTermPublicListedAction: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { OfficerRoster } from "./officer-roster";
import type { OfficerRosterEntry } from "@/lib/officers";

afterEach(cleanup);

const ELDER_ENTRY: OfficerRosterEntry = {
  termId: "term-1",
  personId: "person-1",
  displayName: "Tobias Renwick",
  office: "ruling_elder",
  classYear: 2028,
  startsOn: "2023-01-08",
  endsOn: null,
  orgUnitId: null,
  orgUnitName: null,
  publicListed: false,
  publicDisplayOrder: null,
};

const DEACON_ENTRY: OfficerRosterEntry = {
  termId: "term-2",
  personId: "person-2",
  displayName: "Marguerite Ashcombe",
  office: "deacon",
  classYear: null,
  startsOn: "2024-06-01",
  endsOn: null,
  orgUnitId: "org-unit-1",
  orgUnitName: "North District",
  publicListed: false,
  publicDisplayOrder: null,
};

const PUBLIC_ENTRY: OfficerRosterEntry = {
  termId: "term-3",
  personId: "person-3",
  displayName: "Corwin Aldridge",
  office: "clerk_of_session",
  classYear: null,
  startsOn: "2022-01-08",
  endsOn: null,
  orgUnitId: null,
  orgUnitName: null,
  publicListed: true,
  publicDisplayOrder: null,
};

describe("OfficerRoster — empty state", () => {
  it("renders a designed empty state, not a blank table, when there are zero entries", () => {
    render(<OfficerRoster entries={[]} slug="alder-creek" />);
    expect(screen.getByText(/no officers recorded yet/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("OfficerRoster — table columns", () => {
  it("renders office label, a linked person name, class year, since, and an End term trigger", () => {
    render(<OfficerRoster entries={[ELDER_ENTRY]} slug="alder-creek" />);
    expect(screen.getByText("Ruling Elder")).toBeTruthy();
    const personLink = screen.getByRole("link", { name: "Tobias Renwick" });
    expect(personLink.getAttribute("href")).toBe(
      "/o/alder-creek/admin/officers/person-1?name=Tobias%20Renwick",
    );
    expect(screen.getByText("2028")).toBeTruthy();
    expect(screen.getByRole("button", { name: /end term/i })).toBeTruthy();
  });

  it("renders an em dash for a null class year and a null ends date, rather than a blank cell", () => {
    render(<OfficerRoster entries={[DEACON_ENTRY]} slug="alder-creek" />);
    // classYear null and endsOn null both render em dashes; at least two
    // present in the row (class year and ends columns).
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });
});

describe("OfficerRoster — the District column is conditional", () => {
  it("omits the District column entirely when no row carries a district", () => {
    render(<OfficerRoster entries={[ELDER_ENTRY]} slug="alder-creek" />);
    expect(screen.queryByRole("columnheader", { name: /district/i })).toBeNull();
  });

  it("renders the District column and value when a row carries one", () => {
    render(
      <OfficerRoster entries={[ELDER_ENTRY, DEACON_ENTRY]} slug="alder-creek" />,
    );
    expect(screen.getByRole("columnheader", { name: /district/i })).toBeTruthy();
    expect(screen.getByText("North District")).toBeTruthy();
  });
});

describe("OfficerRoster — public listing control (docs/work-log/2026-08-27-public-staff-directory.md)", () => {
  it("renders a 'List publicly' switch per row and no Public badge when not opted in", () => {
    render(<OfficerRoster entries={[ELDER_ENTRY]} slug="alder-creek" />);
    expect(screen.getByRole("switch")).toBeTruthy();
    expect(screen.queryByText("Public")).toBeNull();
  });

  it("shows a Public badge and a checked switch for a row already opted in", () => {
    render(<OfficerRoster entries={[PUBLIC_ENTRY]} slug="alder-creek" />);
    expect(screen.getByText("Public")).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "true",
    );
  });
});
