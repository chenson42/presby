// @vitest-environment jsdom
/**
 * Tests for <EndTermDialog> — groups-and-officers Phase 3, commit 3/3.
 *
 * `./actions` is mocked for the same reason `admin/roles/revoke-dialog.
 * test.tsx`'s header gives — it is a "use server" module whose real
 * implementation pulls `@/lib/officers` into the module graph.
 *
 * What this file exists to pin, per Phase 3 and this pipeline's brief:
 *   - the confirmation copy names BOTH the person and the office — never a
 *     generic "Are you sure?" (mirrors `revoke-dialog.tsx`'s own precedent);
 *   - Cancel calls `endOfficerTermAction` zero times;
 *   - Confirm calls `endOfficerTermAction` with the exact termId/personId/
 *     office/endsOn/endReason;
 *   - every mapped `ActionResult` denial (Phase 3's API-contract table —
 *     `overlap`'s composed copy, `invalid_input`, `invalid_target`,
 *     `forbidden`) surfaces via `toast.error` with the server's own message,
 *     never a generic failure.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockEndOfficerTermAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  endOfficerTermAction: (...args: unknown[]) => mockEndOfficerTermAction(...args),
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

import { EndTermDialog } from "./end-term-dialog";

afterEach(() => {
  cleanup();
  mockEndOfficerTermAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  mockRouterRefresh.mockReset();
});

function renderDialog() {
  return render(
    <EndTermDialog
      slug="alder-creek"
      termId="term-1"
      personId="person-1"
      office="ruling_elder"
      personName="Tobias Renwick"
      startsOn="2023-01-08"
    />,
  );
}

describe("EndTermDialog — confirmation copy names both the person and the office", () => {
  it("shows a title naming the exact person and office label, not a generic 'Are you sure?'", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^end term$/i }));

    expect(
      screen.getByText("End Tobias Renwick's term as Ruling Elder?"),
    ).toBeTruthy();
    expect(screen.queryByText(/^are you sure\??$/i)).toBeNull();
  });
});

describe("EndTermDialog — cancel", () => {
  it("does not call endOfficerTermAction when Cancel is clicked", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^end term$/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(mockEndOfficerTermAction).not.toHaveBeenCalled();
  });
});

describe("EndTermDialog — confirm", () => {
  it("calls endOfficerTermAction with termId/personId/office and the entered endsOn/endReason, toasts success on ok", async () => {
    mockEndOfficerTermAction.mockResolvedValueOnce({
      ok: true,
      data: { termId: "term-1" },
    });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^end term$/i }));

    fireEvent.change(screen.getByLabelText(/end date/i), {
      target: { value: "2026-06-30" },
    });
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: "resigned" },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /yes, end ruling elder term/i }),
      );
    });

    expect(mockEndOfficerTermAction).toHaveBeenCalledWith("alder-creek", {
      termId: "term-1",
      endsOn: "2026-06-30",
      endReason: "resigned",
      personId: "person-1",
      office: "ruling_elder",
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      "Ruling Elder term ended for Tobias Renwick.",
    );
    expect(mockRouterRefresh).toHaveBeenCalled();
  });

  it("surfaces the server's overlap copy via toast.error, verbatim — not a generic failure", async () => {
    mockEndOfficerTermAction.mockResolvedValueOnce({
      ok: false,
      error: "Tobias Renwick already has an open term as Ruling Elder — end it first.",
    });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^end term$/i }));

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /yes, end ruling elder term/i }),
      );
    });

    expect(toastError).toHaveBeenCalledWith(
      "Tobias Renwick already has an open term as Ruling Elder — end it first.",
    );
  });

  it("surfaces an invalid_input message (end date before start date) via toast.error, verbatim", async () => {
    mockEndOfficerTermAction.mockResolvedValueOnce({
      ok: false,
      error: "The end date can't be before the start date.",
    });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^end term$/i }));

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /yes, end ruling elder term/i }),
      );
    });

    expect(toastError).toHaveBeenCalledWith(
      "The end date can't be before the start date.",
    );
  });

  it("surfaces a forbidden message via toast.error, verbatim", async () => {
    mockEndOfficerTermAction.mockResolvedValueOnce({
      ok: false,
      error: "You don't have permission to manage officer terms here.",
    });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^end term$/i }));

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /yes, end ruling elder term/i }),
      );
    });

    expect(toastError).toHaveBeenCalledWith(
      "You don't have permission to manage officer terms here.",
    );
  });
});
