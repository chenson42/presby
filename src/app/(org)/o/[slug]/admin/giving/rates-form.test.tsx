// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const updateRatesAction = vi.hoisted(() => vi.fn());
vi.mock("./connect/actions", () => ({ updateRatesAction: (...a: unknown[]) => updateRatesAction(...a) }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { RatesForm } from "./rates-form";

const RATES = { cardFeeBps: 290, cardFeeFixedCents: 30, achFeeBps: 80, achFeeCapCents: 500 };
afterEach(() => {
  cleanup();
  for (const fn of [updateRatesAction, refresh, toastSuccess, toastError]) fn.mockReset();
});

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("RatesForm", () => {
  it("shows the stored rates as a treasurer says them, every field labelled", () => {
    render(<RatesForm slug="s" rates={RATES} onDone={() => {}} />);
    expect((screen.getByLabelText("Card percentage") as HTMLInputElement).value).toBe("2.9");
    expect((screen.getByLabelText("Card fixed fee (dollars)") as HTMLInputElement).value).toBe("0.30");
    expect((screen.getByLabelText("Bank percentage") as HTMLInputElement).value).toBe("0.8");
    expect((screen.getByLabelText("Bank fee cap (dollars)") as HTMLInputElement).value).toBe("5.00");
  });

  it("converts percent and dollars to basis points and cents for the action", async () => {
    updateRatesAction.mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(<RatesForm slug="alder-creek" rates={RATES} onDone={onDone} />);
    type("Card percentage", "2.7");
    type("Card fixed fee (dollars)", "0.25");
    type("Bank percentage", "0.5");
    type("Bank fee cap (dollars)", "4");
    fireEvent.click(screen.getByRole("button", { name: "Save fee rates" }));
    await waitFor(() =>
      expect(updateRatesAction).toHaveBeenCalledWith("alder-creek", { cardFeeBps: 270, cardFeeFixedCents: 25, achFeeBps: 50, achFeeCapCents: 400 }),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Fee rates saved."));
    expect(refresh).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalled();
  });

  it("a malformed entry is refused before the server is called, with aria-invalid and a described error", () => {
    render(<RatesForm slug="s" rates={RATES} onDone={() => {}} />);
    type("Card percentage", "2,9");
    fireEvent.click(screen.getByRole("button", { name: "Save fee rates" }));
    const input = screen.getByLabelText("Card percentage");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const described = input.getAttribute("aria-describedby") ?? "";
    expect(described).toContain("rate-cardFeeBps-error");
    expect(document.getElementById("rate-cardFeeBps-error")?.textContent).toMatch(/enter a number like 2\.9/);
    expect(updateRatesAction).not.toHaveBeenCalled();
  });

  it("shows the server's per-field message when the bounds refuse a value", async () => {
    updateRatesAction.mockResolvedValue({ ok: false, error: "Check the highlighted fields.", fieldErrors: { cardFeeBps: "Card percentage (basis points) must be between 0 and 1000." } });
    render(<RatesForm slug="s" rates={RATES} onDone={() => {}} />);
    type("Card percentage", "99");
    fireEvent.click(screen.getByRole("button", { name: "Save fee rates" }));
    await waitFor(() => expect(document.getElementById("rate-cardFeeBps-error")?.textContent).toMatch(/must be between 0 and 1000/));
    expect(toastError).toHaveBeenCalledWith("Check the highlighted fields.");
  });

  it("Cancel closes without saving", () => {
    const onDone = vi.fn();
    render(<RatesForm slug="s" rates={RATES} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDone).toHaveBeenCalled();
    expect(updateRatesAction).not.toHaveBeenCalled();
  });
});
