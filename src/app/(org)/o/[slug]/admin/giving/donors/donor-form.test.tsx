// @vitest-environment jsdom
/**
 * The donor form (docs/work-log/2026-10-15-online-giving.md, G24). Create (any
 * recorder) warns on a same-name/email donor without blocking; edit
 * (giving.manage) saves through the contact action. HydrationGate root.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const createDonorAction = vi.hoisted(() => vi.fn());
const updateDonorContactAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  createDonorAction: (...a: unknown[]) => createDonorAction(...a),
  updateDonorContactAction: (...a: unknown[]) => updateDonorContactAction(...a),
}));
const push = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { DonorForm } from "./donor-form";

afterEach(() => {
  cleanup();
  for (const fn of [createDonorAction, updateDonorContactAction, push, refresh, toastSuccess, toastError]) fn.mockReset();
});

describe("DonorForm (create)", () => {
  it("is a HydrationGate root and requires a name", async () => {
    const { container } = render(<DonorForm slug="alder-creek" />);
    expect(container.querySelector('fieldset[data-slot="hydration-gate"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add donor" }));
    await waitFor(() => expect(screen.getByText("Enter the donor's name")).toBeTruthy());
    expect(createDonorAction).not.toHaveBeenCalled();
  });

  it("refuses a malformed email inline", async () => {
    render(<DonorForm slug="alder-creek" />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Ottoline Vance" } });
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Add donor" }));
    await waitFor(() => expect(screen.getByText(/Enter an email address like name@example\.org/)).toBeTruthy());
  });

  it("creates the donor and goes to their page", async () => {
    createDonorAction.mockResolvedValue({ ok: true, data: { status: "created", donorId: "d7" } });
    render(<DonorForm slug="alder-creek" />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Ottoline Vance" } });
    fireEvent.change(screen.getByLabelText(/^City/), { target: { value: "Dover" } });
    fireEvent.click(screen.getByRole("button", { name: "Add donor" }));
    await waitFor(() => expect(createDonorAction).toHaveBeenCalled());
    expect(createDonorAction).toHaveBeenCalledWith("alder-creek", expect.objectContaining({ displayName: "Ottoline Vance", city: "Dover", country: "US" }), { acknowledgeDuplicate: false });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/o/alder-creek/admin/giving/donors/d7"));
    expect(toastSuccess).toHaveBeenCalledWith("Donor added.");
  });

  it("a possible duplicate offers the existing donors as links and 'add anyway', which resubmits acknowledged", async () => {
    createDonorAction.mockResolvedValueOnce({ ok: true, data: { status: "duplicate_donor", donors: [{ id: "d2", displayName: "Ottoline Vance" }] } });
    render(<DonorForm slug="alder-creek" />);
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "ottoline vance" } });
    fireEvent.click(screen.getByRole("button", { name: "Add donor" }));
    const warning = await screen.findByTestId("duplicate-donor-warning");
    expect(screen.getByRole("link", { name: "Open Ottoline Vance" }).getAttribute("href")).toBe("/o/alder-creek/admin/giving/donors/d2");
    expect(push).not.toHaveBeenCalled();
    createDonorAction.mockResolvedValueOnce({ ok: true, data: { status: "created", donorId: "d8" } });
    fireEvent.click(screen.getByRole("button", { name: /different person/ }));
    await waitFor(() => expect(createDonorAction).toHaveBeenCalledTimes(2));
    expect(createDonorAction.mock.calls[1]![2]).toEqual({ acknowledgeDuplicate: true });
    await waitFor(() => expect(warning.isConnected).toBe(false));
  });
});

describe("DonorForm (edit)", () => {
  const donor = { id: "d1", displayName: "Edwina Edit", email: "edwina@example.invalid", addressLine1: "1 Mill Road", addressLine2: null, city: "Dover", region: "DE", postalCode: "19901", country: "US" };

  it("starts with the donor's details and saves through updateDonorContactAction with the donor id", async () => {
    updateDonorContactAction.mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(<DonorForm slug="alder-creek" donor={donor} onDone={onDone} />);
    expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe("Edwina Edit");
    expect((screen.getByLabelText(/Email/) as HTMLInputElement).value).toBe("edwina@example.invalid");
    fireEvent.change(screen.getByLabelText(/^City/), { target: { value: "Newark" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateDonorContactAction).toHaveBeenCalled());
    expect(updateDonorContactAction).toHaveBeenCalledWith("alder-creek", expect.objectContaining({ donorId: "d1", city: "Newark" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Donor updated."));
    expect(createDonorAction).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it("a server refusal toasts the message", async () => {
    updateDonorContactAction.mockResolvedValue({ ok: false, error: "That donor can't be edited." });
    render(<DonorForm slug="s" donor={donor} />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("That donor can't be edited."));
  });
});
