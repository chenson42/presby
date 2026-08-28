// @vitest-environment jsdom
/**
 * Tests for <EndPositionDialog> — staff-and-personnel Phase 3, ux-developer
 * slice. `./actions` is mocked for the same reason
 * `admin/officers/end-term-dialog.test.tsx`'s header gives — it is a
 * "use server" module whose real implementation pulls `@/lib/staff` into
 * the module graph.
 *
 * What this file exists to pin:
 *   - the confirmation copy names BOTH the person and the position — never
 *     a generic "Are you sure?";
 *   - the confirm button stays disabled until a non-blank reason is entered
 *     (`endReason` is required on `EndStaffPositionInput`, unlike officer's
 *     always-populated `<select>`);
 *   - Cancel calls `endStaffPositionAction` zero times;
 *   - Confirm calls `endStaffPositionAction` with the exact positionId/
 *     personId/position/endsOn/endReason;
 *   - every mapped `ActionResult` denial surfaces via `toast.error` with the
 *     server's own message, never a generic failure.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockEndStaffPositionAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  endStaffPositionAction: (...args: unknown[]) =>
    mockEndStaffPositionAction(...args),
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

import { EndPositionDialog } from "./end-position-dialog";

afterEach(() => {
  cleanup();
  mockEndStaffPositionAction.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  mockRouterRefresh.mockReset();
});

function renderDialog() {
  return render(
    <EndPositionDialog
      slug="alder-creek"
      positionId="position-1"
      personId="person-1"
      position="Church Secretary"
      personName="Marisol Windham"
      startsOn="2022-01-01"
    />,
  );
}

describe("EndPositionDialog — confirmation copy names both the person and the position", () => {
  it("shows a title naming the exact person and position, not a generic 'Are you sure?'", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^end position$/i }));

    expect(
      screen.getByText("End Marisol Windham's position as Church Secretary?"),
    ).toBeTruthy();
    expect(screen.queryByText(/^are you sure\??$/i)).toBeNull();
  });
});

describe("EndPositionDialog — the required-reason gate", () => {
  it("keeps the confirm button disabled until a reason is entered", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^end position$/i }));

    const confirm = screen.getByRole("button", {
      name: /yes, end this position/i,
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/^reason/i), {
      target: { value: "Resigned" },
    });
    expect(confirm.disabled).toBe(false);
  });
});

describe("EndPositionDialog — cancel", () => {
  it("does not call endStaffPositionAction when Cancel is clicked", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^end position$/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(mockEndStaffPositionAction).not.toHaveBeenCalled();
  });
});

describe("EndPositionDialog — confirm", () => {
  it("calls endStaffPositionAction with positionId/personId/position and the entered endsOn/endReason, toasts success on ok", async () => {
    mockEndStaffPositionAction.mockResolvedValueOnce({
      ok: true,
      data: { positionId: "position-1" },
    });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^end position$/i }));

    fireEvent.change(screen.getByLabelText(/end date/i), {
      target: { value: "2026-06-30" },
    });
    fireEvent.change(screen.getByLabelText(/^reason/i), {
      target: { value: "Resigned" },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /yes, end this position/i }),
      );
    });

    expect(mockEndStaffPositionAction).toHaveBeenCalledWith("alder-creek", {
      positionId: "position-1",
      endsOn: "2026-06-30",
      endReason: "Resigned",
      personId: "person-1",
      position: "Church Secretary",
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      "Church Secretary position ended for Marisol Windham.",
    );
    expect(mockRouterRefresh).toHaveBeenCalled();
  });

  it("surfaces an overlap-shaped message via toast.error, verbatim — not a generic failure", async () => {
    mockEndStaffPositionAction.mockResolvedValueOnce({
      ok: false,
      error: "That staff position no longer exists.",
    });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^end position$/i }));
    fireEvent.change(screen.getByLabelText(/^reason/i), {
      target: { value: "Resigned" },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /yes, end this position/i }),
      );
    });

    expect(toastError).toHaveBeenCalledWith(
      "That staff position no longer exists.",
    );
  });

  it("surfaces a forbidden message via toast.error, verbatim", async () => {
    mockEndStaffPositionAction.mockResolvedValueOnce({
      ok: false,
      error: "You don't have permission to manage staff here.",
    });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^end position$/i }));
    fireEvent.change(screen.getByLabelText(/^reason/i), {
      target: { value: "Resigned" },
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /yes, end this position/i }),
      );
    });

    expect(toastError).toHaveBeenCalledWith(
      "You don't have permission to manage staff here.",
    );
  });
});
