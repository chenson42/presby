// @vitest-environment jsdom
/**
 * The offline-gift form (docs/work-log/2026-10-15-online-giving.md, Flow 8).
 * Pins: inline validation through the SAME schema the server parses, the mapped
 * server input, the two soft warnings and their "anyway" re-submit, server field
 * errors landing on the right field, the 2FA hand-off, what the form keeps after
 * a save (fund, date, method), and the HydrationGate root. The donor picker is
 * stubbed (it has its own test) so a donor can be chosen without a server round
 * trip.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const recordOfflineGiftAction = vi.hoisted(() => vi.fn());
vi.mock("../actions", () => ({ recordOfflineGiftAction: (...a: unknown[]) => recordOfflineGiftAction(...a) }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("./donor-picker", () => ({
  DonorPicker: ({ value, onChange }: { value: { displayName: string } | null; onChange: (d: { id: string; displayName: string } | null) => void }) =>
    value ? (
      <div>
        <span data-testid="chosen">{value.displayName}</span>
        <button type="button" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    ) : (
      <button type="button" onClick={() => onChange({ id: "11111111-1111-4111-8111-111111111111", displayName: "Josephine Marlowe" })}>
        pick Josephine
      </button>
    ),
}));

import { OfflineGiftForm } from "./offline-gift-form";

const FUND_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FUND_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DONOR = "11111111-1111-4111-8111-111111111111";
const FUNDS = [{ id: FUND_A, name: "General Fund" }, { id: FUND_B, name: "Building Fund" }];

function renderForm() {
  return render(<OfflineGiftForm slug="alder-creek" funds={FUNDS} today="2026-04-12" />);
}
const amount = () => screen.getByLabelText(/Amount/) as HTMLInputElement;
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Record gift" }));
const recorded = (id = "gift-1") => ({ ok: true, data: { status: "recorded", giftId: id, donorId: DONOR } });

afterEach(() => {
  cleanup();
  recordOfflineGiftAction.mockReset();
  refresh.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("OfflineGiftForm", () => {
  it("is rooted in a HydrationGate (DECISION-159) and states the deductibility rule in words", () => {
    const { container } = renderForm();
    expect(container.querySelector('fieldset[data-slot="hydration-gate"]')).toBeTruthy();
    expect(screen.getByText(/Record only the deductible amount\. Dinners, raffles and purchases are not gifts\./)).toBeTruthy();
  });

  it("defaults: the first fund, the organization's local date, cash, an existing donor", () => {
    renderForm();
    expect((screen.getByLabelText(/^Fund/) as HTMLSelectElement).value).toBe(FUND_A);
    expect((screen.getByLabelText(/Date received/) as HTMLInputElement).value).toBe("2026-04-12");
    expect((screen.getByLabelText(/How was it given/) as HTMLSelectElement).value).toBe("cash");
    expect((screen.getByRole("radio", { name: "Someone in our records" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText(/Check number/)).toBeNull();
  });

  it("shows only the fields that belong to the chosen method", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/How was it given/), { target: { value: "check" } });
    expect(screen.getByLabelText(/Check number/)).toBeTruthy();
    expect(screen.queryByLabelText(/What was given/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/How was it given/), { target: { value: "stock" } });
    expect(screen.getByLabelText(/What was given/)).toBeTruthy();
    expect(screen.getByLabelText(/Number of shares/)).toBeTruthy();
    expect(screen.queryByLabelText(/Check number/)).toBeNull();
  });

  it("echoes the parsed amount as you type", () => {
    renderForm();
    fireEvent.change(amount(), { target: { value: "1250.5" } });
    expect(screen.getByText("Recording $1,250.50")).toBeTruthy();
    fireEvent.change(amount(), { target: { value: "$12" } });
    expect(screen.getByText("For example, 125 or 125.50")).toBeTruthy();
  });

  it("blocks an empty submit with inline, labelled errors and never calls the server", async () => {
    renderForm();
    submit();
    await waitFor(() => expect(screen.getByText("Enter the amount")).toBeTruthy());
    expect(screen.getByText("Choose a donor")).toBeTruthy();
    expect(amount().getAttribute("aria-invalid")).toBe("true");
    expect(amount().getAttribute("aria-describedby")).toContain("gift-amount-error");
    expect(recordOfflineGiftAction).not.toHaveBeenCalled();
  });

  it("only cash may be recorded without a donor", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("radio", { name: "Unidentified (plate offering)" }));
    fireEvent.change(amount(), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText(/How was it given/), { target: { value: "check" } });
    submit();
    await waitFor(() => expect(screen.getByText(/Only cash can be recorded without a donor/)).toBeTruthy());
    expect(recordOfflineGiftAction).not.toHaveBeenCalled();
  });

  it("submits the mapped server input for an existing donor and a NON-DEFAULT fund, then keeps fund, date and method", async () => {
    recordOfflineGiftAction.mockResolvedValue(recorded());
    renderForm();
    fireEvent.click(screen.getByText("pick Josephine"));
    fireEvent.change(screen.getByLabelText(/^Fund/), { target: { value: FUND_B } });
    fireEvent.change(screen.getByLabelText(/How was it given/), { target: { value: "check" } });
    fireEvent.change(screen.getByLabelText(/Check number/), { target: { value: "1042" } });
    fireEvent.change(amount(), { target: { value: "125.50" } });
    submit();
    await waitFor(() => expect(recordOfflineGiftAction).toHaveBeenCalledTimes(1));
    expect(recordOfflineGiftAction).toHaveBeenCalledWith("alder-creek", expect.objectContaining({
      donor: { mode: "existing", donorId: DONOR },
      fundId: FUND_B,
      occurredOn: "2026-04-12",
      method: "check",
      amount: "125.50",
      checkNumber: "1042",
      acknowledgeDuplicate: false,
    }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Gift recorded."));
    expect(screen.getByTestId("gift-recorded").textContent).toMatch(/Recorded \$125\.50 from Josephine Marlowe\./);
    expect(screen.getByRole("link", { name: "View it" }).getAttribute("href")).toBe("/o/alder-creek/admin/giving/gifts/gift-1");
    expect(refresh).toHaveBeenCalled();
    // cleared for the next gift...
    expect(amount().value).toBe("");
    expect(screen.queryByTestId("chosen")).toBeNull();
    // ...but a stack of checks keeps its fund, date and method
    expect((screen.getByLabelText(/^Fund/) as HTMLSelectElement).value).toBe(FUND_B);
    expect((screen.getByLabelText(/How was it given/) as HTMLSelectElement).value).toBe("check");
    expect((screen.getByLabelText(/Date received/) as HTMLInputElement).value).toBe("2026-04-12");
  });

  it("a new donor goes up as the 'new' branch with the typed details", async () => {
    recordOfflineGiftAction.mockResolvedValue(recorded());
    renderForm();
    fireEvent.click(screen.getByRole("radio", { name: "A new donor" }));
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Barnaby Quill" } });
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "barnaby@example.invalid" } });
    fireEvent.change(amount(), { target: { value: "40" } });
    submit();
    await waitFor(() => expect(recordOfflineGiftAction).toHaveBeenCalled());
    expect(recordOfflineGiftAction.mock.calls[0]![1]).toMatchObject({
      donor: { mode: "new", displayName: "Barnaby Quill", email: "barnaby@example.invalid" },
      amount: "40",
    });
  });

  it("a plate offering goes up as 'unidentified'", async () => {
    recordOfflineGiftAction.mockResolvedValue(recorded());
    renderForm();
    fireEvent.click(screen.getByRole("radio", { name: "Unidentified (plate offering)" }));
    fireEvent.change(amount(), { target: { value: "312.40" } });
    submit();
    await waitFor(() => expect(recordOfflineGiftAction).toHaveBeenCalled());
    expect(recordOfflineGiftAction.mock.calls[0]![1]).toMatchObject({ donor: { mode: "unidentified" }, method: "cash", amount: "312.40" });
  });

  it("a possible duplicate GIFT warns inline (not a toast, not a block); 'record it anyway' resubmits acknowledged", async () => {
    recordOfflineGiftAction.mockResolvedValueOnce({ ok: true, data: { status: "duplicate_gift", giftId: "earlier-1" } });
    renderForm();
    fireEvent.click(screen.getByText("pick Josephine"));
    fireEvent.change(amount(), { target: { value: "50" } });
    submit();
    const warning = await screen.findByTestId("duplicate-gift-warning");
    expect(warning.textContent).toMatch(/already recorded/);
    expect(screen.getByRole("link", { name: "View the earlier gift" }).getAttribute("href")).toBe("/o/alder-creek/admin/giving/gifts/earlier-1");
    expect(toastError).not.toHaveBeenCalled();

    recordOfflineGiftAction.mockResolvedValueOnce(recorded("gift-2"));
    fireEvent.click(screen.getByRole("button", { name: /Record it anyway/ }));
    await waitFor(() => expect(recordOfflineGiftAction).toHaveBeenCalledTimes(2));
    expect(recordOfflineGiftAction.mock.calls[1]![1]).toMatchObject({ acknowledgeDuplicate: true });
    await waitFor(() => expect(screen.queryByTestId("duplicate-gift-warning")).toBeNull());
  });

  it("a new donor matching an existing one offers 'Use <name>' (switches to that donor) or 'add anyway'", async () => {
    recordOfflineGiftAction.mockResolvedValueOnce({ ok: true, data: { status: "duplicate_donor", donors: [{ id: DONOR, displayName: "Josephine Marlowe" }] } });
    renderForm();
    fireEvent.click(screen.getByRole("radio", { name: "A new donor" }));
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "josephine marlowe" } });
    fireEvent.change(amount(), { target: { value: "25" } });
    submit();
    const warning = await screen.findByTestId("duplicate-donor-warning");
    fireEvent.click(screen.getByRole("button", { name: "Use Josephine Marlowe" }));
    expect(warning.isConnected).toBe(false);
    expect(screen.getByTestId("chosen").textContent).toBe("Josephine Marlowe");
    expect((screen.getByRole("radio", { name: "Someone in our records" }) as HTMLInputElement).checked).toBe(true);
  });

  it("'This is a different person' re-submits the new donor acknowledged", async () => {
    recordOfflineGiftAction.mockResolvedValueOnce({ ok: true, data: { status: "duplicate_donor", donors: [{ id: DONOR, displayName: "Josephine Marlowe" }] } });
    renderForm();
    fireEvent.click(screen.getByRole("radio", { name: "A new donor" }));
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Josephine Marlowe" } });
    fireEvent.change(amount(), { target: { value: "25" } });
    submit();
    await screen.findByTestId("duplicate-donor-warning");
    recordOfflineGiftAction.mockResolvedValueOnce(recorded());
    fireEvent.click(screen.getByRole("button", { name: /different person/ }));
    await waitFor(() => expect(recordOfflineGiftAction).toHaveBeenCalledTimes(2));
    expect(recordOfflineGiftAction.mock.calls[1]![1]).toMatchObject({ acknowledgeDuplicate: true, donor: { mode: "new" } });
  });

  it("server field errors land on the field they name, with a toast for the headline", async () => {
    recordOfflineGiftAction.mockResolvedValue({ ok: false, error: "That date is in the future.", fieldErrors: { occurredOn: "That date can't be recorded" } });
    renderForm();
    fireEvent.click(screen.getByText("pick Josephine"));
    fireEvent.change(amount(), { target: { value: "5" } });
    submit();
    await waitFor(() => expect(screen.getByText("That date can't be recorded")).toBeTruthy());
    expect(toastError).toHaveBeenCalledWith("That date is in the future.");
    expect(screen.getByLabelText(/Date received/).getAttribute("aria-invalid")).toBe("true");
  });

  it("a server donor error maps back onto the donor picker", async () => {
    recordOfflineGiftAction.mockResolvedValue({ ok: false, error: "x", fieldErrors: { "donor.donorId": "That donor is no longer available. Pick them again." } });
    renderForm();
    fireEvent.click(screen.getByText("pick Josephine"));
    fireEvent.change(amount(), { target: { value: "5" } });
    submit();
    await waitFor(() => expect(screen.getByText("That donor is no longer available. Pick them again.")).toBeTruthy());
  });

  it("a 2FA refusal sends the user to the challenge instead of leaving a toast", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    recordOfflineGiftAction.mockResolvedValue({ ok: false, kind: "two_factor_required", error: "Confirm your code.", redirectTo: "/totp?callbackUrl=%2Fx" });
    renderForm();
    fireEvent.click(screen.getByText("pick Josephine"));
    fireEvent.change(amount(), { target: { value: "5" } });
    await act(async () => submit());
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/totp?callbackUrl=%2Fx"));
    expect(toastError).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("disables Save while the request is in flight (no double submit)", async () => {
    let resolve!: (v: unknown) => void;
    recordOfflineGiftAction.mockReturnValue(new Promise((r) => (resolve = r)));
    renderForm();
    fireEvent.click(screen.getByText("pick Josephine"));
    fireEvent.change(amount(), { target: { value: "5" } });
    submit();
    const button = await screen.findByRole("button", { name: "Recording…" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve(recorded()));
  });
});
