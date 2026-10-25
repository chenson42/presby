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

  it("submits the joined six digits to completeEnrollment when the button is pressed (fallback)", async () => {
    completeEnrollment.mockResolvedValue({ ok: true, data: { recoveryCodes: ["AAAA-BBBB"] } });
    renderForm();
    // Seven digits fill six boxes but do not auto-submit; the button is the way out.
    fireEvent.paste(boxes()[0]!, { clipboardData: { getData: () => "1234567" } });
    expect(completeEnrollment).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm enrollment/i }));
    });
    expect(completeEnrollment).toHaveBeenCalledTimes(1);
    expect(completeEnrollment).toHaveBeenCalledWith({ code: "123456" });
    await waitFor(() => expect(screen.getByText("AAAA-BBBB")).toBeTruthy());
  });

  it("a pasted code with a space fills the boxes and submits by itself", async () => {
    completeEnrollment.mockResolvedValue({ ok: false, error: "That code did not match." });
    renderForm();
    fireEvent.paste(boxes()[0]!, { clipboardData: { getData: () => "123 456" } });
    await waitFor(() => expect(completeEnrollment).toHaveBeenCalledWith({ code: "123456" }));
    expect(completeEnrollment).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("That code did not match."));
  });
});

describe("TotpEnrollForm — auto-submit (DECISION-257)", () => {
  it("N-1: the sixth digit calls completeEnrollment once with no button press; boxes are disabled while pending", async () => {
    let resolve!: (v: unknown) => void;
    completeEnrollment.mockReturnValue(new Promise((r) => (resolve = r)));
    renderForm();
    typeCode("123456");
    await waitFor(() => expect(completeEnrollment).toHaveBeenCalledTimes(1));
    expect(completeEnrollment).toHaveBeenCalledWith({ code: "123456" });
    expect(boxes().every((b) => b.disabled)).toBe(true);
    const button = screen.getByRole("button", { name: /verifying/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await act(async () => {
      resolve({ ok: true, data: { recoveryCodes: ["AAAA-BBBB"] } });
    });
    await waitFor(() => expect(screen.getByText("AAAA-BBBB")).toBeTruthy());
    expect(completeEnrollment).toHaveBeenCalledTimes(1);
  });

  it("N-2: five digits never submit; the button with a short code toasts and does not call", async () => {
    renderForm();
    typeCode("12345");
    await act(async () => {});
    expect(completeEnrollment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /confirm enrollment/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Enter the 6-digit code from your authenticator app."));
    expect(completeEnrollment).not.toHaveBeenCalled();
  });

  it("N-3: a paste of more than six digits does not submit; Confirm calls with the first six", async () => {
    completeEnrollment.mockResolvedValue({ ok: true, data: { recoveryCodes: ["AAAA-BBBB"] } });
    renderForm();
    fireEvent.paste(boxes()[0]!, { clipboardData: { getData: () => "1234567" } });
    await act(async () => {});
    expect(completeEnrollment).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /confirm enrollment/i }));
    });
    expect(completeEnrollment).toHaveBeenCalledWith({ code: "123456" });
  });

  it("N-4: after { ok: false } the toast shows, the boxes are cleared and re-enabled with box 1 focused, and a new code submits once", async () => {
    completeEnrollment.mockResolvedValue({ ok: false, error: "That code did not match. Try again." });
    renderForm();
    typeCode("123456");
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("That code did not match. Try again."));
    await waitFor(() => expect(boxes().map((b) => b.value).join("")).toBe(""));
    expect(boxes().every((b) => !b.disabled)).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(boxes()[0]));
    typeCode("654321");
    await waitFor(() => expect(completeEnrollment).toHaveBeenCalledTimes(2));
    expect(completeEnrollment).toHaveBeenLastCalledWith({ code: "654321" });
  });

  it("N-4b: the same wrong code typed again after a failure is submitted again", async () => {
    completeEnrollment.mockResolvedValue({ ok: false, error: "nope" });
    renderForm();
    typeCode("000000");
    await waitFor(() => expect(boxes().map((b) => b.value).join("")).toBe(""));
    typeCode("000000");
    await waitFor(() => expect(completeEnrollment).toHaveBeenCalledTimes(2));
  });

  it("N-5: a rejected completeEnrollment clears the guard, so a new code submits", async () => {
    completeEnrollment.mockRejectedValueOnce(new Error("network"));
    completeEnrollment.mockResolvedValue({ ok: false, error: "nope" });
    renderForm();
    typeCode("123456");
    await waitFor(() => expect(completeEnrollment).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(boxes().every((b) => !b.disabled)).toBe(true));
    // The boxes still hold the code (no reset on a throw); change it and complete again.
    boxes()[5]!.focus();
    fireEvent.keyDown(boxes()[5]!, { key: "Backspace" });
    typeCode("123457");
    await waitFor(() => expect(completeEnrollment).toHaveBeenCalledTimes(2));
  });

  it("N-6: the status region is empty at rest and says Verifying your code. while pending", async () => {
    let resolve!: (v: unknown) => void;
    completeEnrollment.mockReturnValue(new Promise((r) => (resolve = r)));
    renderForm();
    expect(screen.getByRole("status").textContent).toBe("");
    typeCode("123456");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Verifying your code."));
    await act(async () => {
      resolve({ ok: false, error: "nope" });
    });
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(""));
  });
});
