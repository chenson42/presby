// @vitest-environment jsdom
/**
 * Tests for <OrdinationList> — presbytery-functionality Increment 2.
 *
 * `./actions` and `sonner` are mocked so `<ChangeStatusDialog>`/
 * `<EndOrdinationDialog>` (rendered per row) can mount without pulling
 * `@/lib/credentials` into the module graph — same reasoning
 * `../officers/officer-roster.test.tsx` documents. Each dialog's OWN
 * internal behaviour is out of scope here; this file pins the property
 * Phase 3's Edge Cases section names explicitly: THE STATUS-VS-REMOVAL
 * DISTINCTION MUST BE LEGIBLE — a current ordination shows both "Change
 * status" and "End ordination" as two SEPARATE controls, never one
 * dropdown/button mixing both action classes, and an already-removed
 * ordination never re-offers "End ordination".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("./actions", () => ({
  recordOrdinationAction: vi.fn(),
  changeOrdinationStatusAction: vi.fn(),
  recordAppointmentAction: vi.fn(),
  endAppointmentAction: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { OrdinationList } from "./ordination-list";
import type { OrdinationEntry } from "@/lib/credentials";

afterEach(cleanup);

const ACTIVE_ENTRY: OrdinationEntry = {
  ordinationId: "ord-1",
  personId: "person-1",
  displayName: "Idris Calloway",
  ministry: "minister_of_word_and_sacrament",
  ordainedOn: "2015-06-01",
  status: "active",
  minuteReference: "Presbytery minutes, 1 June 2015",
  endedOn: null,
  endedReason: null,
};

const RETIRED_ENTRY: OrdinationEntry = {
  ...ACTIVE_ENTRY,
  ordinationId: "ord-2",
  status: "honorably_retired",
};

const REMOVED_ENTRY: OrdinationEntry = {
  ...ACTIVE_ENTRY,
  ordinationId: "ord-3",
  status: "removed",
};

describe("OrdinationList — empty state", () => {
  it("renders a designed empty state, not a blank table, when there are zero entries", () => {
    render(<OrdinationList entries={[]} slug="northern-reach" />);
    expect(screen.getByText(/no ordinations recorded yet/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("OrdinationList — table columns", () => {
  it("renders person, ministry label, minute reference, and a status badge", () => {
    render(<OrdinationList entries={[ACTIVE_ENTRY]} slug="northern-reach" />);
    expect(screen.getByText("Idris Calloway")).toBeTruthy();
    expect(screen.getByText("Minister of Word and Sacrament")).toBeTruthy();
    expect(screen.getByText("Presbytery minutes, 1 June 2015")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
  });
});

describe("OrdinationList — the status-vs-removal distinction (Phase 3 Edge Cases)", () => {
  it("a current (non-removed) ordination shows TWO SEPARATE controls: Change status AND End ordination", () => {
    render(<OrdinationList entries={[ACTIVE_ENTRY]} slug="northern-reach" />);
    expect(
      screen.getByRole("button", { name: /change status/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /end ordination/i }),
    ).toBeTruthy();
  });

  it("an honorably-retired ordination ALSO still shows both controls — retirement is a status, not a removal", () => {
    render(<OrdinationList entries={[RETIRED_ENTRY]} slug="northern-reach" />);
    expect(screen.getByText("Honorably Retired")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /change status/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /end ordination/i }),
    ).toBeTruthy();
  });

  it("a removed ordination shows the destructive-styled badge and NO 'End ordination' control (already ended)", () => {
    render(<OrdinationList entries={[REMOVED_ENTRY]} slug="northern-reach" />);
    expect(screen.getByText("Removed from Ordered Ministry")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /end ordination/i }),
    ).toBeNull();
    // "Change status" remains available even after removal (e.g. correcting
    // a mistaken entry) — only the destructive "End" control is withheld.
    expect(
      screen.getByRole("button", { name: /change status/i }),
    ).toBeTruthy();
  });

  it("never offers 'removed' inside the Change-status picker's own option set (credential-labels.ts's CHANGEABLE_CREDENTIAL_STATUSES)", () => {
    render(<OrdinationList entries={[ACTIVE_ENTRY]} slug="northern-reach" />);
    fireEvent.click(screen.getByRole("button", { name: /change status/i }));
    const options = screen
      .getAllByRole("option")
      .map((el) => el.textContent);
    expect(options).not.toContain("Removed from Ordered Ministry");
  });
});
