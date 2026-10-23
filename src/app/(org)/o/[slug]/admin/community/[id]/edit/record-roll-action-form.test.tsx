// @vitest-environment jsdom
/**
 * `RecordRollActionForm` — submit (success + failure), the "already
 * pending" notice, no-reset-on-failure. Mocked at the `./actions` boundary,
 * same posture as `edit-person-form.test.tsx`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockRefresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }),
}));

const mockRecordRollActionAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  recordRollActionAction: (...args: unknown[]) =>
    mockRecordRollActionAction(...args),
}));

const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const toastWarning = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError, warning: toastWarning },
}));

import { RecordRollActionForm } from "./record-roll-action-form";

afterEach(() => {
  cleanup();
  mockRefresh.mockClear();
  mockRecordRollActionAction.mockReset();
  toastSuccess.mockClear();
  toastError.mockClear();
  toastWarning.mockClear();
});

describe("RecordRollActionForm — pending notice", () => {
  it("renders no notice when there are no pending actions", () => {
    render(
      <RecordRollActionForm slug="alder-creek" personId="p-1" pendingActions={[]} />,
    );
    expect(screen.queryByText(/already pending review/i)).toBeNull();
  });

  it("renders the singular notice for one pending action", () => {
    render(
      <RecordRollActionForm
        slug="alder-creek"
        personId="p-1"
        pendingActions={[{ id: "ra-1", kind: "restoration", effectiveDate: "2026-06-01" }]}
      />,
    );
    expect(screen.getByText(/an action is already pending review/i)).toBeTruthy();
    // Scoped to the pending-notice <li> specifically — "Restoration" is
    // ALSO one of the <select>'s own <option> labels, so an unscoped
    // getByText(/restoration/i) matches both and throws.
    const item = screen.getByRole("listitem");
    expect(item.textContent).toMatch(/restoration/i);
    expect(item.textContent).toMatch(/2026-06-01/);
  });

  it("renders the plural notice for more than one pending action", () => {
    render(
      <RecordRollActionForm
        slug="alder-creek"
        personId="p-1"
        pendingActions={[
          { id: "ra-1", kind: "restoration", effectiveDate: "2026-06-01" },
          { id: "ra-2", kind: "reaffirmation", effectiveDate: "2026-07-01" },
        ]}
      />,
    );
    expect(screen.getByText(/actions are already pending review/i)).toBeTruthy();
  });
});

describe("RecordRollActionForm — select chevron (H2)", () => {
  it("wraps the 'Roll action' select with a relative wrapper carrying a decorative chevron icon", () => {
    render(
      <RecordRollActionForm slug="alder-creek" personId="p-1" pendingActions={[]} />,
    );
    const select = screen.getByLabelText(/roll action/i);
    const wrapper = select.parentElement as HTMLElement;
    expect(wrapper.className).toMatch(/relative/);
    const chevron = wrapper.querySelector("svg");
    expect(chevron).not.toBeNull();
    expect(chevron?.getAttribute("aria-hidden")).toBe("true");
    expect(select.className).toMatch(/appearance-none/);
  });
});

describe("RecordRollActionForm — submit", () => {
  it("blank effective date blocks submit", async () => {
    render(
      <RecordRollActionForm slug="alder-creek" personId="p-1" pendingActions={[]} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /record roll action/i }));

    await waitFor(() => {
      expect(screen.getByText(/effective date is required/i)).toBeTruthy();
    });
    expect(mockRecordRollActionAction).not.toHaveBeenCalled();
  });

  it("submits the chosen kind/date/minute reference and, on success, resets and refreshes", async () => {
    mockRecordRollActionAction.mockResolvedValueOnce({
      ok: true,
      data: { rollActionId: "ra-1" },
    });
    render(
      <RecordRollActionForm slug="alder-creek" personId="p-1" pendingActions={[]} />,
    );

    fireEvent.change(screen.getByLabelText(/roll action/i), {
      target: { value: "reaffirmation" },
    });
    fireEvent.change(screen.getByLabelText(/effective date/i), {
      target: { value: "2026-06-01" },
    });
    fireEvent.change(screen.getByLabelText(/minute reference/i), {
      target: { value: "Session 2026-06-01, item 3" },
    });
    fireEvent.click(screen.getByRole("button", { name: /record roll action/i }));

    await waitFor(() => {
      expect(mockRecordRollActionAction).toHaveBeenCalledWith("alder-creek", {
        personId: "p-1",
        kind: "reaffirmation",
        effectiveDate: "2026-06-01",
        minuteReference: "Session 2026-06-01, item 3",
      });
    });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalled();
    });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("a failed submit does NOT discard the entered values (same discipline as EditPersonForm)", async () => {
    mockRecordRollActionAction.mockResolvedValueOnce({
      ok: false,
      error: "You don't have permission to record roll actions here.",
    });
    render(
      <RecordRollActionForm slug="alder-creek" personId="p-1" pendingActions={[]} />,
    );

    fireEvent.change(screen.getByLabelText(/effective date/i), {
      target: { value: "2026-06-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /record roll action/i }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith(
        "You don't have permission to record roll actions here.",
      );
    });
    expect(
      (screen.getByLabelText(/effective date/i) as HTMLInputElement).value,
    ).toBe("2026-06-01");
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});

describe("RecordRollActionForm — what the success says depends on what happened", () => {
  async function submitWith(data: Record<string, unknown>) {
    mockRecordRollActionAction.mockResolvedValueOnce({ ok: true, data });
    render(
      <RecordRollActionForm slug="alder-creek" personId="p-1" pendingActions={[]} />,
    );
    fireEvent.change(screen.getByLabelText(/effective date/i), {
      target: { value: "2026-06-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /record roll action/i }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  }

  it("a participant enrolment is recorded, with no approval", async () => {
    await submitWith({ effect: "recorded", affectsFiledPeriod: false, shadowed: null });
    expect(toastSuccess).toHaveBeenCalledWith("Participant recorded. No approval is needed.");
  });

  it("a proposal says it is waiting for the Session", async () => {
    await submitWith({ effect: "pending", affectsFiledPeriod: false, shadowed: null });
    expect(toastSuccess).toHaveBeenCalledWith(
      "Roll action proposed. It's waiting for the Session to approve.",
    );
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("a shadowed proposal carries the S1 note", async () => {
    await submitWith({
      effect: "pending",
      affectsFiledPeriod: false,
      shadowed: { kind: "other_participant_enrolled", effectiveDate: "2026-07-01" },
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      expect.stringMatching(/dated before this person's latest roll entry/i),
    );
  });

  it("an entry in a filed year adds the filed-period warning as a second toast", async () => {
    await submitWith({ effect: "recorded", affectsFiledPeriod: true, shadowed: null });
    expect(toastWarning).toHaveBeenCalledWith(
      expect.stringMatching(/year that has already been filed.*file a correcting return/i),
    );
  });

  it("explains the new behaviour in its own description", () => {
    render(
      <RecordRollActionForm slug="alder-creek" personId="p-1" pendingActions={[]} />,
    );
    expect(
      screen.getByText(/enrolling someone as a participant takes effect now/i),
    ).toBeTruthy();
  });
});
