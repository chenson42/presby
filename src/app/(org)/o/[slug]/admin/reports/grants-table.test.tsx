// @vitest-environment jsdom
/**
 * Tests for <GrantsTable> — increment 6 (D16/DECISION-147),
 * `docs/work-log/2026-09-25-submission-grants.md` Phase 4 batch C.
 *
 * `./actions` is mocked for the same reason `issue-grant-form.test.tsx`
 * mocks it. Covers: the empty state, status rendering (crucially "already
 * filed" vs "revoked, never filed" are DISTINCT — Phase 1 Flow 2), Revoke
 * only appearing on a LIVE ("issued") row, and the AlertDialog confirm flow
 * (Workflow Rule 2 — no native confirm()).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { StatisticsGrantRow } from "@/lib/statistics-grants";

const mockRevokeStatisticsGrantAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  revokeStatisticsGrantAction: (...args: unknown[]) =>
    mockRevokeStatisticsGrantAction(...args),
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

import { GrantsTable } from "./grants-table";

afterEach(() => {
  cleanup();
  mockRevokeStatisticsGrantAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  mockRouterRefresh.mockReset();
});

function grant(overrides: Partial<StatisticsGrantRow>): StatisticsGrantRow {
  return {
    id: "grant-1",
    aboutOrgId: "cong-1",
    aboutOrgName: "Quillhaven Presbyterian Church",
    reportYear: 2026,
    issuedToName: "Odalys Fenwick",
    issuedToEmail: "clerk@quillhaven.example.invalid",
    issuedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-10-15T00:00:00.000Z",
    submittedAt: null,
    returnId: null,
    revokedAt: null,
    status: "issued",
    ...overrides,
  };
}

describe("GrantsTable — empty state", () => {
  it("renders a helpful empty state with no table when there are no grants", () => {
    render(<GrantsTable slug="northern-reach" grants={[]} />);
    expect(screen.getByText(/no submission grants issued yet/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("GrantsTable — status rendering", () => {
  it("distinguishes 'Filed' (submitted) from 'Revoked' — never conflated", () => {
    render(
      <GrantsTable
        slug="northern-reach"
        grants={[
          grant({ id: "g-filed", status: "submitted", submittedAt: "2026-09-10T00:00:00.000Z" }),
          grant({ id: "g-revoked", status: "revoked", revokedAt: "2026-09-05T00:00:00.000Z" }),
        ]}
      />,
    );
    expect(screen.getByText("Filed")).toBeTruthy();
    expect(screen.getByText("Revoked")).toBeTruthy();
  });

  it("renders 'Expired' and 'Issued' distinctly too", () => {
    render(
      <GrantsTable
        slug="northern-reach"
        grants={[grant({ id: "g-issued", status: "issued" }), grant({ id: "g-expired", status: "expired" })]}
      />,
    );
    expect(screen.getByText("Issued")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
  });

  it("only a LIVE ('issued') grant shows a Revoke button", () => {
    render(
      <GrantsTable
        slug="northern-reach"
        grants={[
          grant({ id: "g-issued", status: "issued" }),
          grant({ id: "g-filed", status: "submitted" }),
          grant({ id: "g-revoked", status: "revoked" }),
          grant({ id: "g-expired", status: "expired" }),
        ]}
      />,
    );
    expect(screen.getAllByRole("button", { name: /^revoke$/i }).length).toBe(1);
  });
});

describe("GrantsTable — revoke flow", () => {
  it("opens a confirmation dialog before calling the action (no native confirm())", async () => {
    render(<GrantsTable slug="northern-reach" grants={[grant({})]} />);
    fireEvent.click(screen.getByRole("button", { name: /^revoke$/i }));
    expect(
      screen.getByText(/revoke the 2026 grant for quillhaven presbyterian church\?/i),
    ).toBeTruthy();
    expect(mockRevokeStatisticsGrantAction).not.toHaveBeenCalled();
  });

  it("confirming calls revokeStatisticsGrantAction and shows a success toast", async () => {
    mockRevokeStatisticsGrantAction.mockResolvedValueOnce({ ok: true, data: { id: "grant-1" } });
    render(<GrantsTable slug="northern-reach" grants={[grant({})]} />);
    fireEvent.click(screen.getByRole("button", { name: /^revoke$/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^yes, revoke$/i }));
    });

    expect(mockRevokeStatisticsGrantAction).toHaveBeenCalledWith("northern-reach", "grant-1");
    expect(toastSuccess).toHaveBeenCalled();
    expect(mockRouterRefresh).toHaveBeenCalled();
  });

  it("surfaces a denial via toast.error, verbatim", async () => {
    mockRevokeStatisticsGrantAction.mockResolvedValueOnce({
      ok: false,
      error: "This grant was already used to file a return on 9/10/2026.",
    });
    render(<GrantsTable slug="northern-reach" grants={[grant({})]} />);
    fireEvent.click(screen.getByRole("button", { name: /^revoke$/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^yes, revoke$/i }));
    });

    expect(toastError).toHaveBeenCalledWith(
      "This grant was already used to file a return on 9/10/2026.",
    );
  });
});
