// @vitest-environment jsdom
/**
 * Tests for <ServiceTimesSection> — docs/work-log/2026-08-21-public-site-
 * org-profile.md Phase 4 commit 2. `./actions` is mocked, same reasoning
 * brand-form.test.tsx/site-section.test.tsx give for their own mocks.
 *
 * What this file pins:
 *   - two independent editors (service / office_hours) — saving one never
 *     touches the other's submission;
 *   - Add row / Remove row mutate client state only, no action call;
 *   - Save serializes the current row array to JSON in a hidden `rows`
 *     field, alongside `organizationId` and the fixed `kind`;
 *   - an empty row list is a legal submission (Phase 3 Edge Cases: "save an
 *     empty list" clears a kind, no confirmation step).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { PolicyResult } from "./actions";
import type { ServiceTimeAdminEntry } from "@/lib/sites";

const setOrganizationServiceTimesAction =
  vi.fn<(fd: FormData) => Promise<PolicyResult>>();
vi.mock("./actions", () => ({
  setOrganizationServiceTimesAction: (fd: FormData) =>
    setOrganizationServiceTimesAction(fd),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { ServiceTimesSection } from "./service-times-section";

afterEach(() => {
  cleanup();
  setOrganizationServiceTimesAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

const SERVICE_ENTRY: ServiceTimeAdminEntry = {
  id: "11111111-1111-1111-1111-111111111111",
  kind: "service",
  dayOfWeek: 0,
  startTime: "10:15:00",
  endTime: "11:15:00",
  label: "Traditional",
};

const OFFICE_HOURS_ENTRY: ServiceTimeAdminEntry = {
  id: "22222222-2222-2222-2222-222222222222",
  kind: "office_hours",
  dayOfWeek: 1,
  startTime: "09:00:00",
  endTime: "17:00:00",
  label: null,
};

function renderSection() {
  return render(
    <ServiceTimesSection
      organizationId="org-1"
      serviceEntries={[SERVICE_ENTRY]}
      officeHoursEntries={[OFFICE_HOURS_ENTRY]}
    />,
  );
}

describe("ServiceTimesSection — initial render", () => {
  it("renders both editors, each seeded from its own entries", () => {
    renderSection();
    expect(screen.getByText("Service times")).toBeTruthy();
    expect(screen.getByText("Office hours")).toBeTruthy();
    // Postgres "HH:MM:SS" truncated to "HH:MM" for the <input type="time">.
    expect(screen.getAllByDisplayValue("10:15").length).toBeGreaterThan(0);
    expect(screen.getAllByDisplayValue("09:00").length).toBeGreaterThan(0);
  });

  it("shows an empty-state message when a kind has no rows", () => {
    render(
      <ServiceTimesSection
        organizationId="org-1"
        serviceEntries={[]}
        officeHoursEntries={[]}
      />,
    );
    expect(screen.getAllByText(/no rows yet/i)).toHaveLength(2);
  });
});

describe("ServiceTimesSection — Add row / Remove row", () => {
  it("Add row appends a new row with no action call", () => {
    renderSection();
    // "Service times" h3's grandparent is that editor's own top-level
    // container — scopes the query to just this editor, not office hours'.
    const editor = screen.getByText("Service times").closest("div")!.parentElement!;

    const addButton = within(editor).getByRole("button", { name: /add row/i });
    fireEvent.click(addButton);

    expect(setOrganizationServiceTimesAction).not.toHaveBeenCalled();
    // A second row now exists for the Service times editor — two "Remove"
    // buttons where there was one.
    expect(within(editor).getAllByRole("button", { name: /remove/i }).length).toBe(2);
  });
});

describe("ServiceTimesSection — Save (per-kind submission)", () => {
  it("Save service times posts organizationId, kind='service', and the row array as JSON — independent of office hours", async () => {
    setOrganizationServiceTimesAction.mockResolvedValue({ ok: true });
    renderSection();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save service times/i }));
    });

    expect(setOrganizationServiceTimesAction).toHaveBeenCalledTimes(1);
    const fd = setOrganizationServiceTimesAction.mock.calls[0][0];
    expect(fd.get("organizationId")).toBe("org-1");
    expect(fd.get("kind")).toBe("service");
    const rows = JSON.parse(String(fd.get("rows")));
    expect(rows).toEqual([
      { dayOfWeek: 0, startTime: "10:15", endTime: "11:15", label: "Traditional" },
    ]);
  });

  it("Save office hours posts kind='office_hours' with a null label preserved", async () => {
    setOrganizationServiceTimesAction.mockResolvedValue({ ok: true });
    renderSection();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save office hours/i }));
    });

    expect(setOrganizationServiceTimesAction).toHaveBeenCalledTimes(1);
    const fd = setOrganizationServiceTimesAction.mock.calls[0][0];
    expect(fd.get("kind")).toBe("office_hours");
    const rows = JSON.parse(String(fd.get("rows")));
    expect(rows).toEqual([
      { dayOfWeek: 1, startTime: "09:00", endTime: "17:00", label: null },
    ]);
  });

  it("removing every row and saving submits an empty array — a legal 'clear all', no confirmation step", async () => {
    setOrganizationServiceTimesAction.mockResolvedValue({ ok: true });
    renderSection();

    fireEvent.click(screen.getAllByRole("button", { name: /remove/i })[0]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save service times/i }));
    });

    const fd = setOrganizationServiceTimesAction.mock.calls[0][0];
    const rows = JSON.parse(String(fd.get("rows")));
    expect(rows).toEqual([]);
  });

  it("surfaces the server's error inline and via toast on failure", async () => {
    setOrganizationServiceTimesAction.mockResolvedValue({
      ok: false,
      error: "End time must be after start time (Sunday).",
    });
    renderSection();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /save service times/i }));
    });

    expect(
      screen.getByText("End time must be after start time (Sunday)."),
    ).toBeTruthy();
    expect(toastError).toHaveBeenCalled();
  });
});
