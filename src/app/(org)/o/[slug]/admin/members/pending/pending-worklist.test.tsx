// @vitest-environment jsdom
/**
 * `PendingWorklist` — the approve/deny UI. Mocked at the `./actions`
 * boundary. Pins: the empty state, the "You proposed this" self-approval
 * badge (Phase 2's surfaced-not-blocked resolution), the required-reason
 * guard on Deny, and that Approve/Deny use `Dialog` (never a native
 * `confirm()`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockApprove = vi.hoisted(() => vi.fn());
const mockDeny = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  approveRollActionAction: (...args: unknown[]) => mockApprove(...args),
  denyRollActionAction: (...args: unknown[]) => mockDeny(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { PendingWorklist } from "./pending-worklist";
import type { PendingRollAction } from "@/lib/roll";

const ACTION: PendingRollAction = {
  id: "ra-1",
  personDisplayName: "Nora Ashgrove",
  kind: "profession_of_faith",
  effectiveDate: "2026-06-01",
  proposedByIsViewer: false,
};

afterEach(() => {
  cleanup();
  mockRefresh.mockClear();
  mockApprove.mockReset();
  mockDeny.mockReset();
  toastSuccess.mockClear();
  toastError.mockClear();
});

describe("PendingWorklist — empty state", () => {
  it("shows a designed empty state, not a blank screen", () => {
    render(<PendingWorklist slug="alder-creek" actions={[]} />);
    expect(screen.getByText(/nothing waiting for your approval/i)).toBeTruthy();
  });
});

describe("PendingWorklist — self-approval badge (Phase 2)", () => {
  it("shows 'You proposed this' only when proposedByIsViewer is true", () => {
    render(
      <PendingWorklist
        slug="alder-creek"
        actions={[{ ...ACTION, proposedByIsViewer: true }]}
      />,
    );
    expect(screen.getByText(/you proposed this/i)).toBeTruthy();
  });

  it("does not show the badge when proposedByIsViewer is false", () => {
    render(<PendingWorklist slug="alder-creek" actions={[ACTION]} />);
    expect(screen.queryByText(/you proposed this/i)).toBeNull();
  });
});

describe("PendingWorklist — approve", () => {
  it("opens a Dialog (not a native confirm) with an optional minute-reference field", () => {
    render(<PendingWorklist slug="alder-creek" actions={[ACTION]} />);
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByLabelText(/minute reference/i)).toBeTruthy();
  });

  it("submits with the minute reference and shows a success toast", async () => {
    mockApprove.mockResolvedValue({ ok: true });
    render(<PendingWorklist slug="alder-creek" actions={[ACTION]} />);
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    fireEvent.change(screen.getByLabelText(/minute reference/i), {
      target: { value: "2026-06 §4" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: /^approve$/i }).slice(-1)[0],
    );

    await waitFor(() => {
      expect(mockApprove).toHaveBeenCalledWith("alder-creek", {
        rollActionId: "ra-1",
        minuteReference: "2026-06 §4",
      });
    });
    expect(toastSuccess).toHaveBeenCalled();
  });
});

describe("PendingWorklist — deny", () => {
  it("requires a reason before submitting (never a native confirm)", () => {
    render(<PendingWorklist slug="alder-creek" actions={[ACTION]} />);
    fireEvent.click(screen.getByRole("button", { name: /^deny$/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(
      screen.getAllByRole("button", { name: /^deny$/i }).slice(-1)[0],
    );

    expect(mockDeny).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "A reason is required to deny a roll action.",
    );
  });

  it("submits with the reason and shows a success toast", async () => {
    mockDeny.mockResolvedValue({ ok: true });
    render(<PendingWorklist slug="alder-creek" actions={[ACTION]} />);
    fireEvent.click(screen.getByRole("button", { name: /^deny$/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), {
      target: { value: "Duplicate entry" },
    });
    fireEvent.click(
      screen.getAllByRole("button", { name: /^deny$/i }).slice(-1)[0],
    );

    await waitFor(() => {
      expect(mockDeny).toHaveBeenCalledWith("alder-creek", {
        rollActionId: "ra-1",
        reason: "Duplicate entry",
      });
    });
    expect(toastSuccess).toHaveBeenCalled();
  });
});
