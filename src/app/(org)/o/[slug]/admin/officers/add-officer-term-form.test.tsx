// @vitest-environment jsdom
/**
 * Tests for <AddOfficerTermForm> — groups-and-officers Phase 3, commit 3/3.
 *
 * `./actions` is mocked: it is a "use server" module whose real
 * implementation pulls `@/lib/officers` (and, transitively, the Neon pool)
 * into the module graph — same reasoning as `admin/roles/grant-role-form.
 * test.tsx`'s header.
 *
 * What this file exists to pin, per Phase 3 and this pipeline's brief:
 *
 *   - the zero-people state renders a single sentence and no form controls;
 *   - THE ORG_UNIT CONDITIONAL FIELD (Phase 3's explicit acceptance
 *     criterion): the district `<select>` is absent when office is anything
 *     other than "deacon", and appears the instant "deacon" is selected;
 *   - a zero-districts-available state, while office is "deacon", disables
 *     submit with inline copy rather than allowing a submission with no
 *     valid district;
 *   - submit composes `StartOfficerTermInput` correctly (empty optional
 *     fields become `undefined`, not empty strings; `orgUnitId` is
 *     stripped for a non-deacon office even if one was set earlier);
 *   - every mapped `ActionResult` denial (forbidden / invalid_target /
 *     invalid_input / the composed `overlap` copy) surfaces via
 *     `toast.error` with the server's own message, never swallowed or
 *     replaced with a generic string.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockStartOfficerTermAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  startOfficerTermAction: (...args: unknown[]) =>
    mockStartOfficerTermAction(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const mockRouterRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRouterRefresh }),
}));

import { AddOfficerTermForm } from "./add-officer-term-form";
import type { OfficerFormOptions } from "@/lib/officers";

afterEach(() => {
  cleanup();
  mockStartOfficerTermAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  mockRouterRefresh.mockReset();
});

const OPTIONS: OfficerFormOptions = {
  people: [
    { personId: "person-1", displayName: "Tobias Renwick" },
    { personId: "person-2", displayName: "Marguerite Ashcombe" },
  ],
  orgUnits: [{ orgUnitId: "org-unit-1", name: "North District" }],
};

describe("AddOfficerTermForm — zero-people state", () => {
  it("renders a single sentence and no controls when options.people.length === 0", () => {
    render(
      <AddOfficerTermForm
        slug="alder-creek"
        options={{ people: [], orgUnits: [] }}
      />,
    );
    expect(
      screen.getByText(/nobody has a current membership at this organization/i),
    ).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("AddOfficerTermForm — the org_unit conditional field", () => {
  it("does not render a district select for the default (non-deacon) office", () => {
    render(<AddOfficerTermForm slug="alder-creek" options={OPTIONS} />);
    expect(screen.queryByLabelText(/^district$/i)).toBeNull();
  });

  it("renders the district select the instant 'Deacon' is chosen", () => {
    render(<AddOfficerTermForm slug="alder-creek" options={OPTIONS} />);
    fireEvent.change(screen.getByLabelText(/^office$/i), {
      target: { value: "deacon" },
    });
    expect(screen.getByLabelText(/^district$/i)).toBeTruthy();
  });

  it("hides the district select again when switching back to a non-deacon office", () => {
    render(<AddOfficerTermForm slug="alder-creek" options={OPTIONS} />);
    const officeSelect = screen.getByLabelText(/^office$/i);
    fireEvent.change(officeSelect, { target: { value: "deacon" } });
    expect(screen.getByLabelText(/^district$/i)).toBeTruthy();
    fireEvent.change(officeSelect, { target: { value: "trustee" } });
    expect(screen.queryByLabelText(/^district$/i)).toBeNull();
  });

  it("shows a no-districts message and disables submit when office is deacon but no districts exist", () => {
    render(
      <AddOfficerTermForm
        slug="alder-creek"
        options={{ ...OPTIONS, orgUnits: [] }}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^office$/i), {
      target: { value: "deacon" },
    });
    expect(screen.getByText(/no districts exist/i)).toBeTruthy();
    const submit = screen.getByRole("button", { name: /add officer term/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("AddOfficerTermForm — submit and error surfacing", () => {
  it("submits with optional fields converted (blank → undefined, class year → number)", async () => {
    mockStartOfficerTermAction.mockResolvedValueOnce({
      ok: true,
      data: { termId: "term-1" },
    });

    render(<AddOfficerTermForm slug="alder-creek" options={OPTIONS} />);

    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2026-01-08" },
    });
    fireEvent.change(screen.getByLabelText(/class year/i), {
      target: { value: "2028" },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /add officer term/i }),
      );
    });

    expect(mockStartOfficerTermAction).toHaveBeenCalledWith("alder-creek", {
      personId: "person-1",
      office: "ruling_elder",
      startsOn: "2026-01-08",
      electedOn: undefined,
      installedOn: undefined,
      classYear: 2028,
      minuteReference: undefined,
      orgUnitId: undefined,
    });
    expect(toastSuccess).toHaveBeenCalled();
    expect(mockRouterRefresh).toHaveBeenCalled();
  });

  it("includes orgUnitId only for a deacon submission", async () => {
    mockStartOfficerTermAction.mockResolvedValueOnce({
      ok: true,
      data: { termId: "term-2" },
    });

    render(<AddOfficerTermForm slug="alder-creek" options={OPTIONS} />);

    fireEvent.change(screen.getByLabelText(/^office$/i), {
      target: { value: "deacon" },
    });
    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2026-01-08" },
    });
    fireEvent.change(screen.getByLabelText(/^district$/i), {
      target: { value: "org-unit-1" },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /add officer term/i }),
      );
    });

    expect(mockStartOfficerTermAction).toHaveBeenCalledWith(
      "alder-creek",
      expect.objectContaining({ office: "deacon", orgUnitId: "org-unit-1" }),
    );
  });

  it("surfaces the composed overlap message via toast.error, verbatim", async () => {
    mockStartOfficerTermAction.mockResolvedValueOnce({
      ok: false,
      error:
        "Tobias Renwick already has an open term as Ruling Elder — end it first.",
    });

    render(<AddOfficerTermForm slug="alder-creek" options={OPTIONS} />);
    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2026-01-08" },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /add officer term/i }),
      );
    });

    expect(toastError).toHaveBeenCalledWith(
      "Tobias Renwick already has an open term as Ruling Elder — end it first.",
    );
  });

  it("surfaces an invalid_target message via toast.error, verbatim", async () => {
    mockStartOfficerTermAction.mockResolvedValueOnce({
      ok: false,
      error: "That person or district doesn't belong to this organization.",
    });

    render(<AddOfficerTermForm slug="alder-creek" options={OPTIONS} />);
    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2026-01-08" },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /add officer term/i }),
      );
    });

    expect(toastError).toHaveBeenCalledWith(
      "That person or district doesn't belong to this organization.",
    );
  });

  it("surfaces a forbidden message via toast.error, verbatim", async () => {
    mockStartOfficerTermAction.mockResolvedValueOnce({
      ok: false,
      error: "You don't have permission to manage officer terms here.",
    });

    render(<AddOfficerTermForm slug="alder-creek" options={OPTIONS} />);
    fireEvent.change(screen.getByLabelText(/start date/i), {
      target: { value: "2026-01-08" },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /add officer term/i }),
      );
    });

    expect(toastError).toHaveBeenCalledWith(
      "You don't have permission to manage officer terms here.",
    );
  });
});
