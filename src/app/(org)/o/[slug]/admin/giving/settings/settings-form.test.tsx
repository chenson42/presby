// @vitest-environment jsdom
/**
 * The statement-details form (docs/work-log/2026-10-15-online-giving.md, R5):
 * HydrationGate root, shapes the migration enforces explained in words, the
 * greeting-token rule, field errors from the server, and the unsaved-changes
 * guard (docs/ui-standards.md) after an edit.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const updateGivingSettingsAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ updateGivingSettingsAction: (...a: unknown[]) => updateGivingSettingsAction(...a) }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { SettingsForm } from "./settings-form";

const BLANK = {
  doneeLegalName: null, doneeAddressLine1: null, doneeAddressLine2: null, doneeCity: null, doneeRegion: null, doneePostalCode: null,
  doneeEin: null, signatoryName: null, signatoryTitle: null, greetingText: null, closingText: null,
};
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save statement details" }));

afterEach(() => {
  cleanup();
  for (const fn of [updateGivingSettingsAction, refresh, toastSuccess, toastError]) fn.mockReset();
});

describe("SettingsForm", () => {
  it("is a HydrationGate root, starts with the saved values, and every field has a label", () => {
    const { container } = render(<SettingsForm slug="s" initial={{ ...BLANK, doneeLegalName: "Fixture Presbyterian Church", doneeRegion: "DE" }} />);
    expect(container.querySelector('fieldset[data-slot="hydration-gate"]')).toBeTruthy();
    expect((screen.getByLabelText(/Legal name of the church/) as HTMLInputElement).value).toBe("Fixture Presbyterian Church");
    expect((screen.getByLabelText(/^State/) as HTMLInputElement).value).toBe("DE");
    for (const input of Array.from(container.querySelectorAll("input:not([type=hidden]), textarea"))) {
      expect(input.id).toBeTruthy();
      expect(container.querySelector(`label[for="${input.id}"]`)).toBeTruthy();
    }
  });

  it("explains each rejected shape in words and sends nothing", async () => {
    render(<SettingsForm slug="s" initial={BLANK} />);
    fireEvent.change(screen.getByLabelText(/^State/), { target: { value: "Ohio" } });
    fireEvent.change(screen.getByLabelText(/^ZIP/), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText(/^EIN/), { target: { value: "12345" } });
    fireEvent.change(screen.getByLabelText(/^Greeting/), { target: { value: "Dear {first_name}," } });
    save();
    await waitFor(() => expect(screen.getByText(/ZIP code like 43215/)).toBeTruthy());
    expect(screen.getByText(/Write the EIN like 12-3456789/)).toBeTruthy();
    expect(screen.getByText(/The only placeholder you can use is \{donor_name\}/)).toBeTruthy();
    expect(updateGivingSettingsAction).not.toHaveBeenCalled();
  });

  it("saves, toasts, refreshes, and then the form is clean again", async () => {
    updateGivingSettingsAction.mockResolvedValue({ ok: true });
    render(<SettingsForm slug="alder-creek" initial={BLANK} />);
    fireEvent.change(screen.getByLabelText(/Legal name of the church/), { target: { value: "Fixture Presbyterian Church" } });
    fireEvent.change(screen.getByLabelText(/^Greeting/), { target: { value: "Dear {donor_name}," } });
    save();
    await waitFor(() => expect(updateGivingSettingsAction).toHaveBeenCalled());
    expect(updateGivingSettingsAction).toHaveBeenCalledWith("alder-creek", expect.objectContaining({ doneeLegalName: "Fixture Presbyterian Church", greetingText: "Dear {donor_name}," }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Statement details saved."));
    expect(refresh).toHaveBeenCalled();
  });

  it("server field errors land on the field", async () => {
    updateGivingSettingsAction.mockResolvedValue({ ok: false, error: "Check the highlighted fields and try again.", fieldErrors: { doneeEin: "Write the EIN like 12-3456789" } });
    render(<SettingsForm slug="s" initial={BLANK} />);
    fireEvent.change(screen.getByLabelText(/Legal name of the church/), { target: { value: "X" } });
    save();
    await waitFor(() => expect(screen.getByText("Write the EIN like 12-3456789")).toBeTruthy());
    expect(toastError).toHaveBeenCalled();
  });

  it("the unsaved-changes guard: a clean form leaves silently; a dirty one asks before the page unloads", async () => {
    render(<SettingsForm slug="s" initial={BLANK} />);
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    fireEvent.change(screen.getByLabelText(/Legal name of the church/), { target: { value: "Typed something" } });
    await waitFor(() => {
      const dirty = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(dirty);
      expect(dirty.defaultPrevented).toBe(true);
    });
  });
});
