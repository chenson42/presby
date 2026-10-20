// @vitest-environment jsdom
/**
 * The void-a-gift dialog (docs/work-log/2026-10-15-online-giving.md, Flow 8):
 * an AlertDialog (never a native confirm) that REQUIRES a reason and says the
 * gift stays on record.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const voidGiftAction = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ voidGiftAction: (...a: unknown[]) => voidGiftAction(...a) }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));

import { VoidGiftDialog } from "./void-dialog";

const open = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Void gift" }));
  return screen.findByRole("alertdialog");
};

afterEach(() => {
  cleanup();
  voidGiftAction.mockReset();
  refresh.mockReset();
  toastSuccess.mockReset();
});

describe("VoidGiftDialog", () => {
  it("states the amount and donor and that the gift stays on record", async () => {
    render(<VoidGiftDialog slug="s" giftId="g1" amountCents={12_550} donorName="Imogen Thackeray" />);
    const dialog = await open();
    expect(within(dialog).getByText("Void this $125.50 gift?")).toBeTruthy();
    expect(dialog.textContent).toMatch(/From Imogen Thackeray\. The gift stays on record, marked as voided with your reason/);
    expect(dialog.textContent).toMatch(/can.t be undone/);
  });

  it("will not submit without a reason of at least three characters", async () => {
    render(<VoidGiftDialog slug="s" giftId="g1" amountCents={100} donorName="D" />);
    const dialog = await open();
    const confirm = within(dialog).getByRole("button", { name: "Void gift" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "ab" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "abc" } });
    expect(confirm.disabled).toBe(false);
  });

  it("sends the gift id and reason, toasts, and refreshes", async () => {
    voidGiftAction.mockResolvedValue({ ok: true });
    render(<VoidGiftDialog slug="alder-creek" giftId="g1" amountCents={100} donorName="D" />);
    const dialog = await open();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Keyed twice" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Void gift" }));
    await waitFor(() => expect(voidGiftAction).toHaveBeenCalledWith("alder-creek", { giftId: "g1", reason: "Keyed twice" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Gift voided."));
    expect(refresh).toHaveBeenCalled();
  });

  it("a refusal stays INSIDE the dialog next to the reason field (the person can fix it)", async () => {
    voidGiftAction.mockResolvedValue({ ok: false, error: "You can void your own entries for 30 days.", fieldErrors: undefined });
    render(<VoidGiftDialog slug="s" giftId="g1" amountCents={100} donorName="D" />);
    const dialog = await open();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Keyed twice" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Void gift" }));
    await waitFor(() => expect(within(dialog).getByText("You can void your own entries for 30 days.")).toBeTruthy());
    expect(within(dialog).getByLabelText(/Reason/).getAttribute("aria-invalid")).toBe("true");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("'Keep the gift' closes without calling the server", async () => {
    render(<VoidGiftDialog slug="s" giftId="g1" amountCents={100} donorName="D" />);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Keep the gift" }));
    expect(voidGiftAction).not.toHaveBeenCalled();
  });
});
