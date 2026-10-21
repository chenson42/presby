// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const hydrated = vi.hoisted(() => ({ value: true }));
vi.mock("@/components/shared/use-hydrated", () => ({
  useHydrated: () => hydrated.value,
}));

const completeEnrollment = vi.hoisted(() => vi.fn());
vi.mock("./actions", () => ({ completeEnrollment }));

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

vi.mock("qrcode", () => ({ default: { toDataURL: async () => "data:image/png;base64,AAAA" }, toDataURL: async () => "data:image/png;base64,AAAA" }));

import { TotpEnrollForm } from "./totp-enroll-form";

beforeEach(() => {
  hydrated.value = true;
  completeEnrollment.mockReset();
  toastError.mockReset();
});
afterEach(cleanup);

const boxes = () =>
  Array.from({ length: 6 }, (_, i) => screen.getByLabelText(`Digit ${i + 1} of 6`)) as HTMLInputElement[];
const typeCode = (code: string) =>
  code.split("").forEach((d, i) => fireEvent.change(boxes()[i]!, { target: { value: d } }));
const renderForm = () =>
  render(<TotpEnrollForm uri="otpauth://totp/x" secret="SECRET" pendingTtlMinutes={15} />);

describe("TotpEnrollForm — one-time-code boxes", () => {
  it("renders the shared six-box group inside a HydrationGate and does not grab focus", () => {
    renderForm();
    expect(screen.getByRole("group", { name: /6-digit code from your app/i })).toBeTruthy();
    expect(boxes()).toHaveLength(6);
    expect(document.activeElement).toBe(document.body);
    const gate = document.querySelector('fieldset[data-slot="hydration-gate"]');
    expect(gate?.querySelector("form")).not.toBeNull();
  });

  it("is inoperable until hydration", () => {
    hydrated.value = false;
    renderForm();
    const gate = document.querySelector('fieldset[data-slot="hydration-gate"]') as HTMLFieldSetElement;
    expect(gate.disabled).toBe(true);
  });

  it("a short code does not reach the server and shows the toast", async () => {
    renderForm();
    typeCode("123");
    fireEvent.click(screen.getByRole("button", { name: /confirm enrollment/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(completeEnrollment).not.toHaveBeenCalled();
  });

  it("submits the joined six digits to completeEnrollment", async () => {
    completeEnrollment.mockResolvedValue({ ok: true, data: { recoveryCodes: ["AAAA-BBBB"] } });
    renderForm();
    typeCode("123456");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm enrollment/i }));
    });
    expect(completeEnrollment).toHaveBeenCalledWith({ code: "123456" });
    await waitFor(() => expect(screen.getByText("AAAA-BBBB")).toBeTruthy());
  });

  it("a pasted code with a space fills the boxes and submits", async () => {
    completeEnrollment.mockResolvedValue({ ok: false, error: "That code did not match." });
    renderForm();
    fireEvent.paste(boxes()[0]!, { clipboardData: { getData: () => "123 456" } });
    expect(boxes().map((b) => b.value).join("")).toBe("123456");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm enrollment/i }));
    });
    expect(completeEnrollment).toHaveBeenCalledWith({ code: "123456" });
    expect(toastError).toHaveBeenCalledWith("That code did not match.");
  });
});
