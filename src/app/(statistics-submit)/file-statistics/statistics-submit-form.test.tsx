// @vitest-environment jsdom
/**
 * Tests for <StatisticsSubmitForm> — increment 6 (D16/DECISION-147),
 * `docs/work-log/2026-09-25-submission-grants.md` Phase 4 batch C.
 *
 * `../actions` (`submitGrantedReturnAction`) is mocked — a "use server"
 * module whose real implementation pulls `next/headers`,
 * `@/lib/rate-limit`, and `@/lib/statistics-grants` (and the Neon pool)
 * into the module graph, same reasoning `file-ticket-form.test.tsx`'s
 * header gives for mocking its own actions module.
 *
 * What this file exists to pin, per the ux-developer brief:
 *   - Field rendering is DRIVEN BY THE SPEC PROP, not hard-coded — a group's
 *     title becomes its `<fieldset>` legend and each field's label/key
 *     produce a labeled input, for whatever `groups`/`bounds` the server
 *     passed down.
 *   - Client-side validation: a blank attestation name is refused, and a
 *     bounded field's out-of-range value is refused with the bound named in
 *     the message — before any network call.
 *   - The three server-side result mappings the contract promises: the
 *     generic "link no longer active" string, the generic "check the
 *     highlighted fields" string, and success (no error banner, the mocked
 *     action never actually redirects in a unit test — see the file's own
 *     "no try/catch" header comment for why that's fine to elide here).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockSubmitGrantedReturnAction = vi.hoisted(() => vi.fn());
vi.mock("../actions", () => ({
  submitGrantedReturnAction: (...args: unknown[]) =>
    mockSubmitGrantedReturnAction(...args),
}));

import { StatisticsSubmitForm, type SasrFieldBounds } from "./statistics-submit-form";
import type { SasrFieldGroup } from "@/lib/sasr-fields";

afterEach(() => {
  cleanup();
  mockSubmitGrantedReturnAction.mockReset();
});

const GROUPS: SasrFieldGroup[] = [
  {
    title: "Gains",
    fields: [
      { key: "gains_professions_under18", label: "Professions of faith, under 18", inputType: "count" },
      { key: "gains_other", label: "Other means", inputType: "count" },
    ],
  },
  {
    title: "Receipts",
    fields: [
      { key: "receipts_contributions", label: "Contributions", inputType: "currency" },
    ],
  },
];

const BOUNDS: Record<string, SasrFieldBounds> = {
  gains_professions_under18: { min: 0, max: 500, type: "integer" },
  gains_other: { min: 0, max: 500, type: "integer" },
  receipts_contributions: { min: 0, max: 100_000_000, type: "numeric" },
};

function renderForm() {
  return render(
    <StatisticsSubmitForm
      token="dev-token"
      reportYear={2026}
      formVersionKey="2024"
      groups={GROUPS}
      bounds={BOUNDS}
    />,
  );
}

function fillAttestation() {
  fireEvent.change(screen.getByLabelText(/^your name/i), {
    target: { value: "Odalys Fenwick" },
  });
}

describe("StatisticsSubmitForm — field rendering from the spec prop", () => {
  it("renders one fieldset per group, legended with the group's title", () => {
    renderForm();
    expect(screen.getByText("Gains")).toBeTruthy();
    expect(screen.getByText("Receipts")).toBeTruthy();
  });

  it("renders one labeled input per field, keyed off the spec — not hard-coded", () => {
    renderForm();
    expect(screen.getByLabelText("Professions of faith, under 18")).toBeTruthy();
    expect(screen.getByLabelText("Other means")).toBeTruthy();
    expect(screen.getByLabelText("Contributions")).toBeTruthy();
  });

  it("every count/currency input carries inputMode=numeric", () => {
    renderForm();
    const input = screen.getByLabelText("Contributions") as HTMLInputElement;
    expect(input.getAttribute("inputmode")).toBe("numeric");
  });

  it("the attestation role select offers exactly the three closed options", () => {
    renderForm();
    const select = screen.getByLabelText(/^your role/i) as HTMLSelectElement;
    expect(select.options.length).toBe(3);
    expect(select.value).toBe("clerk_of_session");
  });

  it("selecting 'Other' reveals the free-text role field", () => {
    renderForm();
    expect(screen.queryByLabelText(/describe your role/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^your role/i), {
      target: { value: "other" },
    });
    expect(screen.getByLabelText(/describe your role/i)).toBeTruthy();
  });
});

describe("StatisticsSubmitForm — client-side validation before any network call", () => {
  it("refuses a blank attestation name", async () => {
    renderForm();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^submit 2026 report$/i }));
    });
    expect(
      screen.getByText(/enter the name of the person attesting/i),
    ).toBeTruthy();
    expect(mockSubmitGrantedReturnAction).not.toHaveBeenCalled();
  });

  it("refuses an out-of-range bounded field, naming the bound", async () => {
    renderForm();
    fillAttestation();
    fireEvent.change(screen.getByLabelText("Professions of faith, under 18"), {
      target: { value: "9999" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^submit 2026 report$/i }));
    });
    expect(screen.getByText(/between 0 and 500/i)).toBeTruthy();
    expect(mockSubmitGrantedReturnAction).not.toHaveBeenCalled();
  });

  it("refuses a non-numeric value in a count field", async () => {
    renderForm();
    fillAttestation();
    fireEvent.change(screen.getByLabelText("Other means"), {
      target: { value: "abc" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^submit 2026 report$/i }));
    });
    expect(mockSubmitGrantedReturnAction).not.toHaveBeenCalled();
  });

  it("requires the free-text role when 'Other' is selected", async () => {
    renderForm();
    fillAttestation();
    fireEvent.change(screen.getByLabelText(/^your role/i), {
      target: { value: "other" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^submit 2026 report$/i }));
    });
    expect(screen.getByText(/enter their role/i)).toBeTruthy();
    expect(mockSubmitGrantedReturnAction).not.toHaveBeenCalled();
  });
});

describe("StatisticsSubmitForm — the three result mappings", () => {
  it("blank fields are sent as undefined, not zero — the server records the zero default", async () => {
    mockSubmitGrantedReturnAction.mockResolvedValueOnce({ ok: true });
    renderForm();
    fillAttestation();
    fireEvent.change(screen.getByLabelText("Professions of faith, under 18"), {
      target: { value: "3" },
    });
    // "Other means" and "Contributions" left blank.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^submit 2026 report$/i }));
    });

    expect(mockSubmitGrantedReturnAction).toHaveBeenCalledTimes(1);
    const [input] = mockSubmitGrantedReturnAction.mock.calls[0];
    expect(input.token).toBe("dev-token");
    expect(input.payload.gains_professions_under18).toBe(3);
    expect(input.payload.gains_other).toBeUndefined();
    expect(input.payload.receipts_contributions).toBeUndefined();
    expect(input.attestedByName).toBe("Odalys Fenwick");
    expect(input.attestedRole).toBe("clerk_of_session");
    expect(input.attestedRoleOther).toBeUndefined();
  });

  it("kind: invalid — renders the generic 'link no longer active' copy verbatim", async () => {
    mockSubmitGrantedReturnAction.mockResolvedValueOnce({
      ok: false,
      error:
        "This link is no longer active. If you still need to file, ask the presbytery for a new link.",
    });
    renderForm();
    fillAttestation();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^submit 2026 report$/i }));
    });
    expect(
      screen.getByText(/this link is no longer active/i),
    ).toBeTruthy();
  });

  it("kind: invalid_input — renders the generic 'check the highlighted fields' copy verbatim", async () => {
    mockSubmitGrantedReturnAction.mockResolvedValueOnce({
      ok: false,
      error: "Some entries could not be saved — check the highlighted fields and try again.",
    });
    renderForm();
    fillAttestation();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^submit 2026 report$/i }));
    });
    expect(
      screen.getByText(/check the highlighted fields/i),
    ).toBeTruthy();
  });

  it("success: no error banner is rendered", async () => {
    mockSubmitGrantedReturnAction.mockResolvedValueOnce({ ok: true });
    renderForm();
    fillAttestation();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^submit 2026 report$/i }));
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("collapses attestedRole 'other' into the free text before calling the action", async () => {
    mockSubmitGrantedReturnAction.mockResolvedValueOnce({ ok: true });
    renderForm();
    fillAttestation();
    fireEvent.change(screen.getByLabelText(/^your role/i), {
      target: { value: "other" },
    });
    fireEvent.change(screen.getByLabelText(/describe your role/i), {
      target: { value: "Session treasurer" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^submit 2026 report$/i }));
    });
    const [input] = mockSubmitGrantedReturnAction.mock.calls[0];
    expect(input.attestedRole).toBe("other");
    expect(input.attestedRoleOther).toBe("Session treasurer");
  });
});
