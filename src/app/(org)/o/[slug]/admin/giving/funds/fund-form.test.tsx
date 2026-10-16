// @vitest-environment jsdom
/**
 * The fund form (docs/work-log/2026-10-15-online-giving.md, G23). Pins: the
 * HydrationGate root, "offered online" OFF by default with the public name
 * appearing only when ticked, inline validation, field errors from the server,
 * the create/edit split, and that a retired fund cannot be offered.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const createFundAction = vi.hoisted(() => vi.fn());
const updateFundAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({
  createFundAction: (...a: unknown[]) => createFundAction(...a),
  updateFundAction: (...a: unknown[]) => updateFundAction(...a),
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { FundForm } from "./fund-form";

afterEach(() => {
  cleanup();
  for (const fn of [createFundAction, updateFundAction, refresh, toastSuccess, toastError]) fn.mockReset();
});

describe("FundForm (create)", () => {
  it("is a HydrationGate root, and 'offer online' is OFF with no public-name field", () => {
    const { container } = render(<FundForm slug="alder-creek" />);
    expect(container.querySelector('fieldset[data-slot="hydration-gate"]')).toBeTruthy();
    expect((screen.getByLabelText(/Offer this fund on the public give page/) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByLabelText(/Name donors will see/)).toBeNull();
  });

  it("ticking 'offer online' asks for the public name, and an empty one is an inline error", async () => {
    render(<FundForm slug="alder-creek" />);
    fireEvent.change(screen.getByLabelText(/Fund name/), { target: { value: "Building Fund" } });
    fireEvent.click(screen.getByLabelText(/Offer this fund on the public give page/));
    expect(screen.getByLabelText(/Name donors will see/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add fund" }));
    await waitFor(() => expect(screen.getByText(/Enter the name donors will see/)).toBeTruthy());
    expect(createFundAction).not.toHaveBeenCalled();
  });

  it("requires a fund name", async () => {
    render(<FundForm slug="alder-creek" />);
    fireEvent.click(screen.getByRole("button", { name: "Add fund" }));
    await waitFor(() => expect(screen.getByText("Enter a name for the fund")).toBeTruthy());
    expect(screen.getByLabelText(/Fund name/).getAttribute("aria-invalid")).toBe("true");
  });

  it("submits the typed values, toasts, refreshes and resets", async () => {
    createFundAction.mockResolvedValue({ ok: true, data: { fundId: "f1" } });
    render(<FundForm slug="alder-creek" />);
    fireEvent.change(screen.getByLabelText(/Fund name/), { target: { value: "Missions" } });
    fireEvent.change(screen.getByLabelText(/^Restriction/), { target: { value: "temporarily_restricted" } });
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: "Support for our partners" } });
    fireEvent.click(screen.getByRole("button", { name: "Add fund" }));
    await waitFor(() => expect(createFundAction).toHaveBeenCalledTimes(1));
    expect(createFundAction).toHaveBeenCalledWith("alder-creek", expect.objectContaining({
      name: "Missions", restrictionClass: "temporarily_restricted", description: "Support for our partners", offeredOnline: false,
    }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Fund added."));
    expect(refresh).toHaveBeenCalled();
    expect((screen.getByLabelText(/Fund name/) as HTMLInputElement).value).toBe("");
  });

  it("a duplicate name from the server lands on the name field", async () => {
    createFundAction.mockResolvedValue({ ok: false, error: "A fund with that name already exists.", fieldErrors: { name: "A fund with that name already exists" } });
    render(<FundForm slug="alder-creek" />);
    fireEvent.change(screen.getByLabelText(/Fund name/), { target: { value: "General Fund" } });
    fireEvent.click(screen.getByRole("button", { name: "Add fund" }));
    await waitFor(() => expect(screen.getByText("A fund with that name already exists")).toBeTruthy());
    expect(toastError).toHaveBeenCalled();
  });

  it("a 2FA refusal redirects to the challenge", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    createFundAction.mockResolvedValue({ ok: false, kind: "two_factor_required", error: "x", redirectTo: "/totp?callbackUrl=%2Fx" });
    render(<FundForm slug="alder-creek" />);
    fireEvent.change(screen.getByLabelText(/Fund name/), { target: { value: "Missions" } });
    fireEvent.click(screen.getByRole("button", { name: "Add fund" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/totp?callbackUrl=%2Fx"));
    vi.unstubAllGlobals();
  });
});

describe("FundForm (edit)", () => {
  const fund = { id: "f1", name: "Building Fund", onlineDisplayName: "Building Fund", description: null, restrictionClass: "temporarily_restricted" as const, offeredOnline: true };

  it("starts with the fund's values, shows the public name, and saves through updateFundAction with the id", async () => {
    updateFundAction.mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(<FundForm slug="alder-creek" fund={fund} onDone={onDone} />);
    expect((screen.getByLabelText(/Fund name/) as HTMLInputElement).value).toBe("Building Fund");
    expect((screen.getByLabelText(/Name donors will see/) as HTMLInputElement).value).toBe("Building Fund");
    fireEvent.change(screen.getByLabelText(/Fund name/), { target: { value: "Sanctuary Fund" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(updateFundAction).toHaveBeenCalled());
    expect(updateFundAction).toHaveBeenCalledWith("alder-creek", expect.objectContaining({ fundId: "f1", name: "Sanctuary Fund", offeredOnline: true }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith("Fund updated.");
  });

  it("Cancel is offered when there is somewhere to go back to", () => {
    const onDone = vi.fn();
    render(<FundForm slug="alder-creek" fund={fund} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDone).toHaveBeenCalled();
  });

  it("a retired fund cannot be offered online: the checkbox is disabled and says to reactivate first", () => {
    render(<FundForm slug="alder-creek" fund={{ ...fund, offeredOnline: false }} canOfferOnline={false} />);
    expect((screen.getByLabelText(/Offer this fund on the public give page/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Reactivate it first/)).toBeTruthy();
    expect(screen.queryByLabelText(/Name donors will see/)).toBeNull();
  });
});
